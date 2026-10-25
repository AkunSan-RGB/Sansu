import { ApprovalsService } from '../../common/approvals/approvals.service';
import { inventoryLines, semiSet } from './inventory-accounts';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { allowedWarehouses, assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { D, type Dec, money, ZERO } from '../../common/utils/money';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { stockCounts, stockTransferLines, stockTransfers } from '../../db/schema';
import { InventoryService } from './inventory.service';
import { StockService } from './stock.service';
import { CreateTransferDto, ReceiveTransferDto, CancelTransferDto, CreateCountDto, UpdateCountDto, SaveMinimumsDto } from './warehouse-ops.dto';
import { WarehouseRepository } from './warehouse.repository';
import { ReferenceRepository } from '../../db/reference.repository';
import { patchById } from '../../db/owned';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class WarehouseOpsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly inventory: InventoryService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly approvals: ApprovalsService,
    private readonly repo: WarehouseRepository,
    private readonly refs: ReferenceRepository,
  ) {}

  async warehouse(db: Db | Tx, tenantId: string, id: string) {
    const w = await this.refs.warehouse(db, tenantId, id);
    if (!w) throw new BadRequestException('Gudang tidak ditemukan');
    return w;
  }

  /** Filter gudang sesuai hak akses pengguna */
  scope(u: AuthUser, col: PgColumn, requested?: string) {
    if (requested && !UUID.test(requested)) throw new BadRequestException('Gudang tidak valid');
    const allowed = allowedWarehouses(u);
    if (requested) {
      assertWarehouseAccess(u, requested);
      return eq(col, requested);
    }
    return allowed ? inArray(col, allowed) : undefined;
  }

  /**
   * Transfer antar gudang.
   * - DIRECT: stok keluar dari asal (HPP rata-rata asal) & langsung masuk ke tujuan dengan HPP yang sama — tanpa jurnal (akun persediaan sama).
   * - IN_TRANSIT: stok keluar dari asal; nilainya pindah ke akun "Persediaan dalam Perjalanan" sampai gudang tujuan menerima.
   */
  async createTransfer(u: AuthUser, dto: CreateTransferDto, opts: { special?: boolean } = {}) {
    if (dto.fromWarehouseId === dto.toWarehouseId)
      throw new BadRequestException('Gudang asal dan tujuan harus berbeda');
    const date = toDocDate(dto.date);
    const transit = dto.mode === 'IN_TRANSIT';
    // gabungkan baris produk yang sama
    const merged = new Map<string, ReturnType<typeof D>>();
    const binPick = new Map<string, { from?: string; to?: string }>();
    for (const l of dto.lines) {
      binPick.set(l.productId, { from: l.fromBinId ?? binPick.get(l.productId)?.from, to: l.toBinId ?? binPick.get(l.productId)?.to });
      const q = D(l.qty);
      if (!q.isPositive()) throw new BadRequestException('Jumlah transfer harus lebih dari nol');
      merged.set(l.productId, (merged.get(l.productId) ?? ZERO).plus(q));
    }
    return this.db.transaction(async (tx) => {
      const from = await this.warehouse(tx, u.tenantId, dto.fromWarehouseId);
      const to = await this.warehouse(tx, u.tenantId, dto.toWarehouseId);
      assertWarehouseAccess(u, from.id);
      if (!to.isActive) throw new BadRequestException(`Gudang tujuan ${to.name} nonaktif`);
      // stok titipan outlet / mobil sales hanya berpindah lewat menu Konsinyasi / Kanvas (dokumen, pemisahan fungsi, batas nilai)
      if (!opts.special && (from.kind !== 'MAIN' || to.kind !== 'MAIN')) throw new BadRequestException('Gudang konsinyasi/mobil dipindah lewat menu Konsinyasi / Kanvas');
      const ids = [...merged.keys()];
      const found = await this.repo.listProductsById(tx, u.tenantId, ids);
      if (found.length !== ids.length) throw new BadRequestException('Ada produk yang tidak ditemukan');

      const id = randomUUID();
      const number = await this.seq.next(tx, u.tenantId, 'STOCK_TRANSFER', date);
      await this.repo.insertStockTransfers(tx, id, u.tenantId, number, date, from.id, to, dto, u.sub, transit);
      let total = ZERO;
      const sentItems: { productId: string; value: Dec }[] = [];
      for (const [productId, qty] of merged) {
        const out = await this.stock.move(tx, {
          tenantId: u.tenantId,
          productId,
          warehouseId: from.id,
          type: 'TRANSFER_OUT',
          qty: qty.negated(),
          refType: 'STOCK_TRANSFER',
          refId: id,
          refNumber: number,
          date,
          binId: binPick.get(productId)?.from,
        });
        total = total.plus(out.value);
        sentItems.push({ productId, value: out.value });
        if (transit) {
          await this.repo.insertStockTransferLines(tx, id, productId, qty, out.unitCost, out.writedownUnit);
          continue;
        }
        await this.stock.move(tx, {
          tenantId: u.tenantId,
          productId,
          warehouseId: to.id,
          type: 'TRANSFER_IN',
          qty,
          unitCost: out.unitCost,
          writedownUnit: out.writedownUnit,
          refType: 'STOCK_TRANSFER',
          refId: id,
          refNumber: number,
          date,
          skipAccessCheck: true,
          binId: binPick.get(productId)?.to,
        });
        await this.repo.insertStockTransferLinesForCreateTransfer(tx, id, productId, qty, out.unitCost, out.writedownUnit);
      }
      await patchById(tx, stockTransfers, id, { totalValue: total.toFixed(2) });
      // Kirim langsung antar-cabang: persediaan pindah cabang lewat Rekening Antar Cabang (nol saat digabung), agar neraca tiap cabang tetap seimbang
      if (!transit && total.gt(0) && (from.branchId ?? null) !== (to.branchId ?? null)) {
        const semi = await semiSet(tx, u.tenantId, sentItems.map((x) => x.productId));
        await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Mutasi antar-cabang ${number}: ${from.name} → ${to.name}`,
          sourceType: 'STOCK_TRANSFER',
          sourceId: id,
          reference: number,
          createdById: u.sub,
          lines: [
            ...inventoryLines(sentItems, semi, 'debit').map((l) => ({ ...l, branchId: to.branchId ?? null })),
            { key: SYS.INTERBRANCH, credit: total, branchId: to.branchId ?? null },
            { key: SYS.INTERBRANCH, debit: total, branchId: from.branchId ?? null },
            ...inventoryLines(sentItems, semi, 'credit').map((l) => ({ ...l, branchId: from.branchId ?? null })),
          ],
        });
      }
      if (transit && total.gt(0)) {
        await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Kirim barang ${number}: ${from.name} → ${to.name}`,
          sourceType: 'STOCK_TRANSFER',
          sourceId: id,
          reference: number,
          createdById: u.sub,
          lines: [{ key: SYS.INVENTORY_TRANSIT, debit: total }, ...inventoryLines(sentItems, await semiSet(tx, u.tenantId, sentItems.map((x) => x.productId)), 'credit')],
        });
      }
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'CREATE',
        entity: 'StockTransfer',
        entityId: id,
        data: { number, mode: transit ? 'IN_TRANSIT' : 'DIRECT', from: from.code, to: to.code, lines: dto.lines },
      });
      return { id, number, totalValue: total.toFixed(2), status: transit ? 'IN_TRANSIT' : 'RECEIVED' };
    });
  }

  /** Lock transfer dalam perjalanan */
  private async lockTransit(tx: Tx, u: AuthUser, id: string) {
    const r = await this.repo.queryStockTransfer(tx, id, u.tenantId);
    if (!r.rows.length) throw new NotFoundException('Transfer tidak ditemukan');
    const t = await this.repo.transferById(tx, id);
    if (t.status !== 'IN_TRANSIT')
      throw new BadRequestException(
        t.status === 'RECEIVED' ? 'Barang transfer ini sudah diterima' : 'Transfer ini sudah dibatalkan',
      );
    const lines = await this.repo.listStockTransferLinesByTransferId(tx, id);
    return { t, lines };
  }

  /**
   * Gudang tujuan menerima barang. Barang masuk dengan HPP saat dikirim.
   * Kekurangan (rusak/hilang di jalan) dibebankan ke Selisih Persediaan.
   */
  async receiveTransfer(u: AuthUser, id: string, dto: ReceiveTransferDto) {
    return this.db.transaction(async (tx) => {
      const { t, lines } = await this.lockTransit(tx, u, id);
      assertWarehouseAccess(u, t.toWarehouseId);
      // Pemisahan fungsi (bila dinyalakan): pembuat transfer tidak boleh menerimanya sendiri (selain Pemilik)
      if (u.role !== 'OWNER' && t.createdById && t.createdById === u.sub && (await this.approvals.policy(tx, u.tenantId)).transferSod) {
        throw new ForbiddenException('Transfer yang Anda buat tidak boleh Anda terima sendiri. Minta Gudang tujuan atau Admin lain menerimanya.');
      }
      const to = await this.warehouse(tx, u.tenantId, t.toWarehouseId);
      const date = toDocDate(dto.date);
      if (date < t.date) throw new BadRequestException('Tanggal terima tidak boleh sebelum tanggal kirim');
      const given = new Map<string, ReturnType<typeof D>>();
      const givenBin = new Map<string, string>();
      for (const l of dto.lines ?? []) {
        if (!lines.some((x) => x.productId === l.productId))
          throw new BadRequestException('Produk tidak ada di transfer ini');
        given.set(l.productId, D(l.receivedQty));
        if (l.binId) givenBin.set(l.productId, l.binId);
      }
      let received = ZERO;
      let shortage = ZERO;
      const recItems: { productId: string; value: Dec }[] = [];
      const short: string[] = [];
      for (const l of lines) {
        const sent = D(l.qty);
        const rq = given.get(l.productId) ?? sent;
        if (rq.isNegative()) throw new BadRequestException('Jumlah diterima tidak boleh negatif');
        if (rq.gt(sent)) throw new BadRequestException('Jumlah diterima tidak boleh melebihi jumlah yang dikirim');
        const lineValue = money(sent.times(l.unitCost));
        const recValue = rq.eq(sent) ? lineValue : money(rq.times(l.unitCost));
        if (rq.gt(0)) {
          await this.stock.move(tx, {
            tenantId: u.tenantId,
            productId: l.productId,
            warehouseId: to.id,
            type: 'TRANSFER_IN',
            qty: rq,
            unitCost: l.unitCost,
            writedownUnit: l.writedownUnit,
            refType: 'STOCK_TRANSFER',
            refId: id,
            refNumber: t.number,
            date,
            skipAccessCheck: true,
            binId: givenBin.get(l.productId),
          });
        }
        if (rq.lt(sent)) short.push(l.productId);
        received = received.plus(recValue);
        recItems.push({ productId: l.productId, value: recValue });
        shortage = shortage.plus(lineValue.minus(recValue));
        await patchById(tx, stockTransferLines, l.id, { receivedQty: rq.toFixed(4) });
      }
      // selisih pembulatan antar baris → ikut ke kekurangan agar akun transit kembali nol
      const total = D(t.totalValue);
      shortage = total.minus(received);
      if (total.gt(0)) {
        const from = await this.warehouse(tx, u.tenantId, t.fromWarehouseId);
        const fb = from.branchId ?? null;
        const tb = to.branchId ?? null;
        const cross = fb !== tb;
        const dest = (l: object) => (cross ? { ...l, branchId: tb } : l);
        await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Terima barang ${t.number} di ${to.name}${short.length ? ' (ada kekurangan)' : ''}`,
          sourceType: 'STOCK_TRANSFER',
          sourceId: id,
          reference: t.number,
          createdById: u.sub,
          lines: [
            ...inventoryLines(recItems, await semiSet(tx, u.tenantId, recItems.map((x) => x.productId)), 'debit').map(dest),
            dest({
              key: SYS.INVENTORY_ADJ,
              debit: shortage,
              memo: shortage.gt(0) ? 'Kekurangan barang transfer' : undefined,
            }),
            // antar-cabang: transit ada di cabang pengirim; pasangannya lewat Rekening Antar Cabang (nol saat digabung)
            ...(cross
              ? [
                  { key: SYS.INTERBRANCH, credit: total, branchId: tb },
                  { key: SYS.INTERBRANCH, debit: total, branchId: fb },
                  { key: SYS.INVENTORY_TRANSIT, credit: total, branchId: fb },
                ]
              : [{ key: SYS.INVENTORY_TRANSIT, credit: total }]),
          ],
        });
      }
      await patchById(tx, stockTransfers, id, {
          status: 'RECEIVED',
          receivedDate: date,
          receivedAt: new Date(),
          receivedById: u.sub,
          receiveNotes: dto.notes ?? null,
        });
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'RECEIVE',
        entity: 'StockTransfer',
        entityId: id,
        data: { number: t.number, date, shortage: shortage.toFixed(2), lines: dto.lines ?? 'ALL' },
      });
      return {
        ok: true,
        receivedValue: received.toFixed(2),
        shortageValue: shortage.toFixed(2),
        shortItems: short.length,
      };
    });
  }

  /** Batalkan kiriman yang belum diterima: barang kembali ke gudang asal */
  async cancelTransfer(u: AuthUser, id: string, dto: CancelTransferDto) {
    return this.db.transaction(async (tx) => {
      const { t, lines } = await this.lockTransit(tx, u, id);
      assertWarehouseAccess(u, t.fromWarehouseId);
      const date = toDocDate(dto.date);
      if (date < t.date) throw new BadRequestException('Tanggal batal tidak boleh sebelum tanggal kirim');
      for (const l of lines) {
        await this.stock.move(tx, {
          tenantId: u.tenantId,
          productId: l.productId,
          warehouseId: t.fromWarehouseId,
          type: 'TRANSFER_IN',
          qty: l.qty,
          unitCost: l.unitCost,
          writedownUnit: l.writedownUnit,
          refType: 'STOCK_TRANSFER',
          refId: id,
          refNumber: t.number,
          date,
        });
        await patchById(tx, stockTransferLines, l.id, { receivedQty: '0' });
      }
      const total = D(t.totalValue);
      // nilai per barang dari biaya kirim; selisih pembulatan terhadap total ditambahkan ke barang pertama
      const backItems = lines.map((l) => ({ productId: l.productId, value: money(D(l.qty).times(l.unitCost)) }));
      if (backItems.length) backItems[0].value = backItems[0].value.plus(total.minus(backItems.reduce((a, x) => a.plus(x.value), ZERO)));
      if (total.gt(0)) {
        await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Batal kirim ${t.number} — barang kembali ke gudang asal`,
          sourceType: 'STOCK_TRANSFER',
          sourceId: id,
          reference: t.number,
          createdById: u.sub,
          lines: [...inventoryLines(backItems, await semiSet(tx, u.tenantId, backItems.map((x) => x.productId)), 'debit'), { key: SYS.INVENTORY_TRANSIT, credit: total }],
        });
      }
      await patchById(tx, stockTransfers, id, {
          status: 'CANCELLED',
          receivedDate: date,
          receivedAt: new Date(),
          receivedById: u.sub,
          receiveNotes: dto.notes ?? 'Dibatalkan',
        });
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'CANCEL',
        entity: 'StockTransfer',
        entityId: id,
        data: { number: t.number, date },
      });
      return { ok: true };
    });
  }

  /** Buat lembar hitung: semua produk aktif (atau yang masih punya stok) beserta stok sistem saat ini */
  async createCount(u: AuthUser, dto: CreateCountDto) {
    assertWarehouseAccess(u, dto.warehouseId);
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const wh = await this.warehouse(tx, u.tenantId, dto.warehouseId);
      if (dto.binId) {
        if (!wh.binsEnabled) throw new BadRequestException('Opname per rak hanya untuk gudang yang lokasi raknya aktif');
        const b = await this.repo.queryWarehouseBin(tx, dto.binId, wh.id, u.tenantId);
        if (!b.rows[0]) throw new BadRequestException('Rak tidak ditemukan di gudang ini');
      }
      // satu opname berjalan per cakupan: opname seluruh gudang memblokir semuanya; opname rak memblokir opname rak yang sama dan opname seluruh gudang
      const [open] = await this.repo.findStockCountsByWarehouseIdAndStatusAndBinId(tx, u.tenantId, wh.id, dto);
      if (open) throw new BadRequestException(`Masih ada stock opname ${open.number} yang belum selesai di ${dto.binId ? 'rak/gudang ini' : 'gudang ini'}`);
      const rows = dto.binId
        ? (
            await this.repo.queryStockBinBalance(tx, dto, u.tenantId)
          ).rows
        : await this.repo.listProductsWithStockBalancesByIsActiveAndCategory(tx, wh.id, u.tenantId, dto);
      if (!rows.length) throw new BadRequestException(dto.binId ? 'Rak ini kosong: tidak ada barang untuk dihitung. Pindahkan dulu barang yang ditemukan ke rak ini.' : 'Tidak ada produk untuk dihitung');
      const id = randomUUID();
      const number = await this.seq.next(tx, u.tenantId, 'STOCK_COUNT', date);
      await this.repo.insertStockCounts(tx, id, u.tenantId, number, date, wh.id, dto, u.sub);
      for (let i = 0; i < rows.length; i += 1000) {
        await this.repo.insertStockCountLines(tx, rows, i, id);
      }
      return { id, number, lines: rows.length };
    });
  }

  /** `lock`: kunci baris opname (di dalam transaksi) supaya dua permintaan serentak tidak membukukan selisih dua kali */
  async ownCount(u: AuthUser, id: string, db: Db | Tx = this.db, lock = false) {
    const q = this.repo.listStockCountsById(db, id, u.tenantId);
    const [c] = lock ? await q.for('update') : await q;
    if (!c) throw new NotFoundException('Stock opname tidak ditemukan');
    assertWarehouseAccess(u, c.warehouseId);
    return c;
  }

  async updateCount(u: AuthUser, id: string, dto: UpdateCountDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.ownCount(u, id, tx, true);
      if (c.status !== 'DRAFT') throw new BadRequestException('Stock opname ini sudah selesai');
      for (const l of dto.lines) {
        if (l.countedQty !== null && D(l.countedQty).isNegative())
          throw new BadRequestException('Jumlah fisik tidak boleh negatif');
        await this.repo.updateStockCountLinesByCountIdAndProductId(tx, l, id);
      }
      await patchById(tx, stockCounts, id, { countedById: u.sub });
      if (dto.notes !== undefined) await patchById(tx, stockCounts, id, { notes: dto.notes });
      return { ok: true };
    });
  }

  /** Bukukan selisih: jumlah fisik dibandingkan stok sistem SAAT DIPOSTING → penyesuaian stok + jurnal */
  async postCount(u: AuthUser, id: string, opts: { approved?: boolean } = {}) {
    const pol = await this.approvals.policy(this.db, u.tenantId);
    const cur = await this.ownCount(u, id);
    // Pemisahan fungsi: yang mengisi jumlah fisik tidak boleh memposting selisihnya (selain Pemilik)
    if (!opts.approved && pol.stockCountSod && u.role !== 'OWNER' && cur.countedById && cur.countedById === u.sub) {
      throw new ForbiddenException('Yang mengisi jumlah fisik tidak boleh memposting selisihnya sendiri. Minta Keuangan/Admin lain yang memposting.');
    }
    // Nilai selisih (|selisih| × HPP rata-rata) untuk persetujuan dan pemberitahuan Pemilik
    const diffs = await this.repo.sumStockCountLinesWithStockBalancesByCountIdAndCountedQty(this.db, cur, id);
    const gross = diffs.reduce((a, l) => a + Math.abs(Number(l.counted) - Number(l.qty)) * Number(l.avg), 0);
    // Selisih besar wajib dijelaskan (catatan alasan) sebelum diposting; yang sudah disetujui Pemilik/Admin dikecualikan
    if (!opts.approved && pol.stockAlertValue > 0 && gross >= pol.stockAlertValue && (cur.notes ?? '').trim().length < 5) {
      throw new BadRequestException(`Selisih opname bernilai besar (≈ Rp${Math.round(gross).toLocaleString('id-ID')}). Isi catatan alasan selisih (mis. barang rusak, salah catat, retur belum tercatat) sebelum memposting.`);
    }
    if (!opts.approved) {
      const limit = await this.approvals.needs(this.db, u, 'STOCK_COUNT', gross);
      await this.approvals.gateIf(this.db, u, { kind: 'STOCK_COUNT', refId: id, title: `Selisih stock opname ${cur.number} (≈ Rp${Math.round(gross).toLocaleString('id-ID')})`, amount: gross }, limit !== null, 'Nilai selisih opname mencapai batas persetujuan');
    }
    const result = await this.postCountTx(u, id);
    if (pol.stockAlertValue > 0 && gross >= pol.stockAlertValue && u.role !== 'OWNER') {
      void this.approvals.notifyRoles(u.tenantId, { roles: ['OWNER'], excludeUserId: u.sub, info: true, title: `⚠ Selisih stock opname ${cur.number} bernilai besar (≈ Rp${Math.round(gross).toLocaleString('id-ID')})`, lines: [`Diposting ${u.role === 'ADMIN' ? 'Admin' : 'Keuangan'}. Kurang Rp${Number(result.valueOut).toLocaleString('id-ID')}, lebih Rp${Number(result.valueIn).toLocaleString('id-ID')}.`], path: '/inventory/counts' });
    }
    return result;
  }

  private async postCountTx(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.ownCount(u, id, tx, true);
      if (c.status !== 'DRAFT') throw new BadRequestException('Stock opname ini sudah selesai');
      const lines = await this.repo.sumStockCountLinesByCountIdAndCountedQty(tx, c, id);
      if (!lines.length) throw new BadRequestException('Belum ada produk yang diisi jumlah fisiknya');
      const adj: { productId: string; qty: string; unitCost?: string; lotId?: string; noLot?: boolean; binId?: string }[] = [];
      for (const l of lines) {
        const diff = D(l.countedQty!).minus(l.qty);
        await this.repo.updateStockCountLinesByCountIdAndProductIdForPostCountTx(tx, l.qty, diff, id, l.productId);
        if (diff.isZero()) continue;
        if (!c.binId) {
          adj.push({ productId: l.productId, qty: diff.toFixed(4), unitCost: diff.isPositive() ? D(l.avgCost).toFixed(4) : undefined });
        } else if (diff.isPositive()) {
          // lebih: barang yang tidak tercatat di rak ini ditambahkan ke rak ini
          adj.push({ productId: l.productId, qty: diff.toFixed(4), unitCost: D(l.avgCost).toFixed(4), binId: c.binId });
        } else {
          // kurang: dikurangi tepat dari isi rak ini (bagian tanpa lot dulu, lalu lot paling cepat kedaluwarsa), agar rak sama dengan hasil hitung
          let need = diff.abs();
          const rows = await this.repo.queryStockBinBalanceForPostCountTx(tx, c.binId, l.productId);
          for (const r of rows.rows) {
            if (need.lte(0)) break;
            const take = D(r.qty).lt(need) ? D(r.qty) : need;
            adj.push({ productId: l.productId, qty: take.negated().toFixed(4), binId: c.binId, ...(r.lot_id ? { lotId: r.lot_id } : { noLot: true }) });
            need = need.minus(take);
          }
        }
      }
      let adjustmentNumber: string | null = null;
      let valueIn = '0.00';
      let valueOut = '0.00';
      if (adj.length) {
        const r = await this.inventory.adjust(
          u,
          {
            warehouseId: c.warehouseId,
            date: c.date,
            reason: 'STOCK_OPNAME',
            notes: `Stock opname ${c.number}`,
            lines: adj,
          },
          tx,
          { special: true }, // opname boleh di gudang konsinyasi/mobil: satu-satunya cara resmi mengoreksi stoknya
        );
        adjustmentNumber = r.number;
        valueIn = r.valueIn;
        valueOut = r.valueOut;
      }
      await patchById(tx, stockCounts, id, { status: 'POSTED', postedAt: new Date(), adjustmentNumber });
      return { ok: true, counted: lines.length, adjusted: new Set(adj.map((a) => a.productId)).size, adjustmentNumber, valueIn, valueOut };
    });
  }

  async cancelCount(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.ownCount(u, id, tx, true);
      if (c.status !== 'DRAFT')
        throw new BadRequestException('Hanya stock opname yang belum selesai yang bisa dibatalkan');
      await patchById(tx, stockCounts, id, { status: 'CANCELLED' });
      return { ok: true };
    });
  }

  async saveMinimums(u: AuthUser, dto: SaveMinimumsDto) {
    assertWarehouseAccess(u, dto.warehouseId);
    await this.warehouse(this.db, u.tenantId, dto.warehouseId);
    const ids = [...new Set(dto.items.map((i) => i.productId))];
    if (!ids.length) return { saved: 0 };
    const found = await this.repo.listProductsByIdForSaveMinimums(this.db, u.tenantId, ids);
    if (found.length !== ids.length) throw new BadRequestException('Ada produk yang tidak ditemukan');
    await this.db.transaction(async (tx) => {
      for (const i of dto.items) {
        if (i.minQty === null || D(i.minQty).lte(0)) {
          await this.repo.deleteStockMinimumsByProductIdAndWarehouseId(tx, i.productId, dto.warehouseId);
        } else {
          await this.repo.insertStockMinimums(tx, u.tenantId, i.productId, dto.warehouseId, i.minQty);
        }
      }
    });
    return { saved: dto.items.length };
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Bom, ProductionOrder, ProductionReport } from '@sansu/shared';
import { WorkflowService } from '../workflow/workflow.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { assertWarehouseAccess } from '../../common/auth/warehouse-access';
import { SequenceService } from '../../common/sequence/sequence.service';
import { addDays, toDocDate } from '../../common/utils/dates';
import { D, Dec, money, qty4, ZERO } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { bomLines, boms, productionOrderLines, productionOrders, products, warehouses } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { inventoryLines, semiSet } from '../inventory/inventory-accounts';
import { StockService } from '../inventory/stock.service';
import { WorkCenterService } from './work-centers.service';
import { QcService } from './qc.service';
import { SaveBomDto, CreateProductionDto, StartProductionDto, CompleteProductionDto, CancelProductionDto } from './production.dto';
import { ReferenceRepository } from '../../db/reference.repository';
import { findOwned, patchById } from '../../db/owned';
import { ProductionRepository } from './production.repository';

@Injectable()
export class ProductionService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly workCenters: WorkCenterService,
    private readonly qc: QcService,
    private readonly refs: ReferenceRepository,
    private readonly repo: ProductionRepository,
  ) {}

  /** Biaya rata-rata per satuan dasar seluruh gudang (untuk taksiran harga pokok resep) */
  private async avgCosts(db: DbOrTx, tenantId: string, ids: string[]) {
    if (!ids.length) return new Map<string, Dec>();
    const rows = (
      await this.repo.queryStockBalance(db, tenantId, ids)
    ).rows;
    return new Map(rows.map((r) => [r.product_id, D(r.c ?? 0)]));
  }

  // ================= Resep / BOM =================

  async listBoms(tenantId: string, id?: string): Promise<Bom[]> {
    const rows = await this.db.query.boms.findMany({
      where: and(eq(boms.tenantId, tenantId), id ? eq(boms.id, id) : undefined),
      orderBy: [desc(boms.isActive), asc(boms.code)],
    });
    if (!rows.length) return [];
    const lines = await this.repo.listBomLinesWithProductsByBomId(this.db, rows);
    const outs = await this.repo.listProductsById(this.db, rows);
    const costs = await this.avgCosts(this.db, tenantId, [...new Set(lines.map((l) => l.productId))]);
    return rows.map((b) => {
      const ls = lines.filter((l) => l.bomId === b.id);
      const material = ls.reduce<Dec>((a, l) => a.plus(D(l.qty).times(costs.get(l.productId) ?? 0)), ZERO);
      const batchCost = money(material.plus(b.laborCost).plus(b.overheadCost));
      const o = outs.find((x) => x.id === b.productId)!;
      return {
        id: b.id,
        code: b.code,
        name: b.name,
        productId: b.productId,
        product: { sku: o.sku, name: o.name, unit: o.unit },
        outputQty: D(b.outputQty).toString(),
        laborCost: b.laborCost,
        overheadCost: b.overheadCost,
        notes: b.notes,
        isActive: b.isActive,
        lines: ls.map((l) => ({
          id: l.id,
          productId: l.productId,
          sku: l.sku,
          name: l.name,
          unit: l.unit,
          qty: D(l.qty).toString(),
          unitCost: (costs.get(l.productId) ?? ZERO).toFixed(2),
        })),
        estimate: {
          material: money(material).toFixed(2),
          batchCost: batchCost.toFixed(2),
          unitCost: D(b.outputQty).gt(0) ? batchCost.div(b.outputQty).toFixed(2) : '0.00',
        },
      };
    });
  }

  private async validateBom(tx: DbOrTx, tenantId: string, dto: SaveBomDto) {
    const ids = [dto.productId, ...dto.lines.map((l) => l.productId)];
    if (dto.lines.some((l) => l.productId === dto.productId))
      throw new BadRequestException('Produk jadi tidak boleh menjadi bahannya sendiri');
    if (new Set(dto.lines.map((l) => l.productId)).size !== dto.lines.length)
      throw new BadRequestException('Bahan yang sama tercantum lebih dari sekali');
    if (D(dto.outputQty).lte(0)) throw new BadRequestException('Hasil per batch harus > 0');
    if (dto.lines.some((l) => D(l.qty).lte(0))) throw new BadRequestException('Kebutuhan bahan harus > 0');
    if (D(dto.laborCost ?? 0).isNegative() || D(dto.overheadCost ?? 0).isNegative())
      throw new BadRequestException('Biaya tidak boleh negatif');
    const found = await this.repo.listProductsByIdForValidateBom(tx, tenantId, ids);
    if (found.length !== new Set(ids).size) throw new BadRequestException('Ada produk yang tidak ditemukan');
    return found.find((p) => p.id === dto.productId)!;
  }

  async createBom(user: AuthUser, dto: SaveBomDto) {
    const id = await this.db.transaction(async (tx) => {
      const out = await this.validateBom(tx, user.tenantId, dto);
      const code = (dto.code?.trim() || `BOM-${out.sku}`).toUpperCase();
      const [dup] = await this.repo.findBomsByCode(tx, user.tenantId, code);
      if (dup) throw new BadRequestException(`Kode resep ${code} sudah dipakai`);
      const [b] = await this.repo.insertBoms(tx, user.tenantId, code, dto.name, dto.productId, dto.outputQty, dto.laborCost, dto.overheadCost, dto.notes);
      await tx
        .insert(bomLines)
        .values(dto.lines.map((l) => ({ bomId: b.id, productId: l.productId, qty: qty4(l.qty).toFixed(4) })));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'Bom',
        entityId: b.id,
        data: { code },
      });
      return b.id;
    });
    return (await this.listBoms(user.tenantId, id))[0];
  }

  async updateBom(user: AuthUser, id: string, dto: SaveBomDto) {
    const b = await findOwned(this.db, boms, user.tenantId, id);
    if (!b) throw new NotFoundException('Resep tidak ditemukan');
    await this.db.transaction(async (tx) => {
      await this.validateBom(tx, user.tenantId, dto);
      await patchById(tx, boms, id, {
          name: dto.name.trim(),
          productId: dto.productId,
          outputQty: qty4(dto.outputQty).toFixed(4),
          laborCost: money(dto.laborCost ?? 0).toFixed(2),
          overheadCost: money(dto.overheadCost ?? 0).toFixed(2),
          notes: dto.notes,
          isActive: dto.isActive ?? b.isActive,
        });
      // Perintah produksi menyimpan salinan bahan sendiri, jadi resep aman diubah
      await this.repo.deleteBomLinesByBomId(tx, id);
      await tx
        .insert(bomLines)
        .values(dto.lines.map((l) => ({ bomId: id, productId: l.productId, qty: qty4(l.qty).toFixed(4) })));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'UPDATE',
        entity: 'Bom',
        entityId: id,
      });
    });
    return (await this.listBoms(user.tenantId, id))[0];
  }

  // ================= Perintah produksi =================

  async listOrders(tenantId: string, id?: string): Promise<ProductionOrder[]> {
    const rows = await this.repo.listProductionOrdersWithBomsAndProductsByIdAndDateAndNumber(this.db, tenantId, id);
    if (!rows.length) return [];
    const relIds = [...new Set(rows.flatMap((r) => [r.o.id, r.o.parentOrderId]).filter((x): x is string => !!x))];
    const rel = (await this.repo.listProductionOrdersByIdAndParentOrderId(this.db, tenantId, relIds));
    const numberOf = new Map(rel.map((x) => [x.id, x.number]));
    const lines = await this.repo.listProductionOrderLinesWithProductsByOrderId(this.db, rows);
    return rows.map(({ o, ...r }) => ({
      id: o.id,
      number: o.number,
      date: o.date,
      status: o.status,
      parentOrderId: o.parentOrderId,
      parentNumber: o.parentOrderId ? (numberOf.get(o.parentOrderId) ?? null) : null,
      childCount: rel.filter((x) => x.parentOrderId === o.id).length,
      planNo: o.planNo,
      bom: { id: o.bomId, code: r.bomCode, name: r.bomName },
      product: { id: o.productId, sku: r.sku, name: r.name, unit: r.unit },
      warehouse: { id: o.warehouseId, name: r.warehouseName },
      batches: D(o.batches).toString(),
      plannedQty: D(o.plannedQty).toString(),
      outputQty: D(o.outputQty).toString(),
      startedDate: o.startedDate,
      completedDate: o.completedDate,
      materialCost: o.materialCost,
      laborCost: o.laborCost,
      overheadCost: o.overheadCost,
      totalCost: o.totalCost,
      unitCost: D(o.unitCost).toFixed(2),
      notes: o.notes,
      lines: lines
        .filter((x) => x.l.orderId === o.id)
        .map((x) => ({
          id: x.l.id,
          productId: x.l.productId,
          sku: x.sku,
          name: x.name,
          unit: x.unit,
          plannedQty: D(x.l.plannedQty).toString(),
          issuedQty: D(x.l.issuedQty).toString(),
          unitCost: D(x.l.unitCost).toFixed(2),
          value: x.l.value,
        })),
    }));
  }

  async getOrder(tenantId: string, id: string) {
    const [o] = await this.listOrders(tenantId, id);
    if (!o) throw new NotFoundException('Perintah produksi tidak ditemukan');
    return o;
  }

  async createOrder(user: AuthUser, dto: CreateProductionDto) {
    const id = await this.db.transaction((tx) => this.createOrderIn(tx, user, dto));
    return this.getOrder(user.tenantId, id);
  }

  /** Buat perintah draft di dalam transaksi pemanggil (dipakai juga oleh rencana produksi berjenjang) */
  async createOrderIn(tx: Tx, user: AuthUser, dto: CreateProductionDto, extra: { parentOrderId?: string; planNo?: string } = {}): Promise<string> {
    const date = toDocDate(dto.date);
    const batches = qty4(dto.batches);
    if (batches.lte(0)) throw new BadRequestException('Jumlah batch harus > 0');
    assertWarehouseAccess(user, dto.warehouseId);
    {
      const b = await findOwned(tx, boms, user.tenantId, dto.bomId);
      if (!b || !b.isActive) throw new BadRequestException('Resep tidak ditemukan / nonaktif');
      const wh = await this.refs.warehouse(tx, user.tenantId, dto.warehouseId);
      if (!wh) throw new BadRequestException('Gudang tidak ditemukan');
      const ls = await this.repo.listBomLinesByBomId(tx, b.id);
      const number = await this.seq.next(tx, user.tenantId, 'PRODUCTION_ORDER', date);
      const [o] = await this.repo.insertProductionOrders(tx, user.tenantId, number, date, b.id, b.productId, wh.id, batches, b.outputQty, dto.notes, user.sub, extra.parentOrderId, extra.planNo);
      await this.repo.insertProductionOrderLines(tx, ls, o.id, batches);
      await this.workCenters.copyToOrder(tx, user.tenantId, b.id, o.id, batches.toNumber());
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'ProductionOrder',
        entityId: o.id,
        data: { number },
      });
      return o.id;
    }
  }

  private async lock(tx: Tx, tenantId: string, id: string) {
    const r = await this.repo.queryProductionOrder(tx, id, tenantId);
    if (!r.rows.length) throw new NotFoundException('Perintah produksi tidak ditemukan');
    const [o] = await this.repo.findProductionOrdersById(tx, id);
    return o;
  }

  /** Keluarkan bahan ke produksi: Dr Barang dalam Proses | Cr Persediaan */
  async start(user: AuthUser, id: string, dto: StartProductionDto) {
    const date = toDocDate(dto.date);
    await this.workflow.gate(user.tenantId, 'START_PRODUCTION', id);
    await this.db.transaction(async (tx) => {
      const o = await this.lock(tx, user.tenantId, id);
      if (o.status !== 'DRAFT') throw new BadRequestException('Produksi sudah dimulai / selesai / batal');
      if (date < o.date) throw new BadRequestException('Tanggal mulai tidak boleh sebelum tanggal perintah');
      // perintah berjenjang: barang setengah jadi harus selesai dulu
      const open = await this.repo.listProductionOrdersByParentOrderIdAndStatus(tx, id);
      if (open.length) throw new BadRequestException(`Selesaikan dulu perintah barang setengah jadi: ${open.map((x) => x.number).join(', ')}`);
      const ls = await this.repo.listProductionOrderLinesByOrderId(tx, id);
      const override = new Map((dto.lines ?? []).map((l) => [l.productId, qty4(l.qty)]));
      for (const k of override.keys())
        if (!ls.some((l) => l.productId === k))
          throw new BadRequestException('Bahan di luar resep — ubah resepnya dulu');
      let material: Dec = ZERO;
      const issued: { productId: string; value: Dec }[] = [];
      for (const l of ls) {
        const q = override.get(l.productId) ?? D(l.plannedQty);
        if (q.isNegative()) throw new BadRequestException('Jumlah bahan tidak boleh negatif');
        if (q.isZero()) continue;
        const moved = await this.stock.move(tx, {
          tenantId: user.tenantId,
          productId: l.productId,
          warehouseId: o.warehouseId,
          type: 'PRODUCTION_ISSUE',
          qty: q.negated(),
          refType: 'PRODUCTION_ORDER',
          refId: o.id,
          refNumber: o.number,
          date,
        });
        material = material.plus(moved.value);
        issued.push({ productId: l.productId, value: moved.value });
        await patchById(tx, productionOrderLines, l.id, { issuedQty: q.toFixed(4), unitCost: moved.unitCost.toFixed(4), value: moved.value.toFixed(2) });
      }
      let journalId: string | null = null;
      if (material.gt(0)) {
        const j = await this.posting.post(tx, {
          tenantId: user.tenantId,
          date,
          description: `Bahan ke produksi ${o.number}`,
          sourceType: 'PRODUCTION',
          sourceId: o.id,
          createdById: user.sub,
          lines: [{ key: SYS.WIP, debit: material }, ...inventoryLines(issued, await semiSet(tx, user.tenantId, issued.map((x) => x.productId)), 'credit')],
        });
        journalId = j.id;
      }
      await patchById(tx, productionOrders, id, { status: 'IN_PROGRESS', startedDate: date, materialCost: material.toFixed(2), startJournalId: journalId });
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'START',
        entity: 'ProductionOrder',
        entityId: id,
        data: { material: material.toFixed(2) },
      });
    });
    return this.getOrder(user.tenantId, id);
  }

  /** Produk jadi masuk: Dr Persediaan | Cr Barang dalam Proses (bahan), Cr Biaya Produksi Dibebankan (upah & overhead) */
  async complete(user: AuthUser, id: string, dto: CompleteProductionDto) {
    await this.workflow.gate(user.tenantId, 'COMPLETE_PRODUCTION', id);
    const date = toDocDate(dto.date);
    await this.db.transaction(async (tx) => {
      const o = await this.lock(tx, user.tenantId, id);
      if (o.status !== 'IN_PROGRESS')
        throw new BadRequestException('Mulai produksi (keluarkan bahan) dulu sebelum menyelesaikan');
      if (date < (o.startedDate ?? o.date))
        throw new BadRequestException('Tanggal selesai tidak boleh sebelum tanggal mulai');
      const out = qty4(dto.outputQty);
      if (out.lte(0))
        throw new BadRequestException(
          'Hasil produksi harus > 0. Bila gagal total, batalkan produksi atau catat sebagai kerugian.',
        );
      const [b] = await this.repo.findBomsById(tx, o.bomId);
      // resep beroperasi: biaya konversi = jumlah biaya operasi (jam aktual × tarif pusat kerja), tidak boleh diketik
      const ops = await this.workCenters.orderConversionCost(tx, user.tenantId, id);
      if (ops && (dto.laborCost !== undefined || dto.overheadCost !== undefined)) throw new BadRequestException('Biaya upah dan overhead dihitung dari operasi pusat kerja; koreksi lewat operasinya (Admin)');
      const labor = ops ? money(ops.labor) : money(dto.laborCost ?? D(b.laborCost).times(o.batches));
      const overhead = ops ? money(ops.overhead) : money(dto.overheadCost ?? D(b.overheadCost).times(o.batches));
      if (labor.isNegative() || overhead.isNegative()) throw new BadRequestException('Biaya tidak boleh negatif');
      const material = D(o.materialCost);
      const total = material.plus(labor).plus(overhead);
      const unitCost = qty4(total.div(out));
      // Barang dengan umur simpan: hasil produksi menjadi lot dengan tanggal kedaluwarsa = tanggal selesai + umur simpan
      const [prod] = await this.repo.findProductsById(tx, o.productId);
      // produk wajib QC: hasil masuk gudang karantina dulu, bukan gudang tujuan
      const quarantineId = prod?.qc ? await this.qc.quarantineWarehouse(tx, user.tenantId) : null;
      if (prod?.qc && !quarantineId) throw new BadRequestException('Produk ini wajib QC tetapi gudang karantina belum disiapkan (Pengendalian mutu › Siapkan karantina)');
      const moved = await this.stock.move(tx, {
        tenantId: user.tenantId,
        productId: o.productId,
        warehouseId: quarantineId ?? o.warehouseId,
        type: 'PRODUCTION_OUTPUT',
        qty: out,
        unitCost,
        refType: 'PRODUCTION_ORDER',
        refId: o.id,
        refNumber: o.number,
        date,
        lot: prod?.shelf ? { lotNo: o.number, expiryDate: addDays(date, prod.shelf) } : undefined,
      });
      const rounding = money(total.minus(moved.value)); // + : nilai stok sedikit di bawah total biaya
      const j = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Hasil produksi ${o.number}: ${out.toString()} unit @ ${unitCost.toFixed(2)}`,
        sourceType: 'PRODUCTION',
        sourceId: o.id,
        createdById: user.sub,
        lines: [
          ...inventoryLines([{ productId: o.productId, value: moved.value }], await semiSet(tx, user.tenantId, [o.productId]), 'debit'),
          { key: SYS.INVENTORY_ADJ, debit: rounding.gt(0) ? rounding : 0, credit: rounding.lt(0) ? rounding.abs() : 0 },
          { key: SYS.WIP, credit: material },
          {
            key: SYS.APPLIED_PRODUCTION_COST,
            credit: labor.plus(overhead),
            memo: `Upah ${labor.toFixed(0)} + overhead ${overhead.toFixed(0)}`,
          },
        ],
      });
      await patchById(tx, productionOrders, id, {
          status: 'COMPLETED',
          completedDate: date,
          outputQty: out.toFixed(4),
          laborCost: labor.toFixed(2),
          overheadCost: overhead.toFixed(2),
          totalCost: total.toFixed(2),
          unitCost: unitCost.toFixed(4),
          completeJournalId: j.id,
        });
      if (quarantineId) await this.qc.createForOrderTx(tx, user, { orderId: o.id, productId: o.productId, warehouseId: quarantineId, releaseWarehouseId: o.warehouseId, qty: out.toFixed(4), unitCost: unitCost.toFixed(4), lot: prod?.shelf ? { lotNo: o.number, expiryDate: addDays(date, prod.shelf) } : undefined });
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'COMPLETE',
        entity: 'ProductionOrder',
        entityId: id,
        data: { output: out.toString(), total: total.toFixed(2) },
      });
    });
    return this.getOrder(user.tenantId, id);
  }

  /** Batal: rencana langsung batal; yang sedang berjalan → bahan kembali ke gudang dengan biaya saat dikeluarkan */
  async cancel(user: AuthUser, id: string, dto: CancelProductionDto) {
    const date = toDocDate(dto.date);
    await this.db.transaction(async (tx) => {
      const o = await this.lock(tx, user.tenantId, id);
      if (o.status === 'COMPLETED' || o.status === 'CANCELLED')
        throw new BadRequestException('Produksi yang sudah selesai / batal tidak bisa dibatalkan');
      await this.workCenters.cancelOrderOps(tx, user.tenantId, id);
      if (o.status === 'IN_PROGRESS') {
        if (date < (o.startedDate ?? o.date))
          throw new BadRequestException('Tanggal batal tidak boleh sebelum tanggal mulai');
        const ls = await this.repo.listProductionOrderLinesByOrderId(tx, id);
        let back: Dec = ZERO;
        const returned: { productId: string; value: Dec }[] = [];
        for (const l of ls.filter((x) => D(x.issuedQty).gt(0))) {
          const moved = await this.stock.move(tx, {
            tenantId: user.tenantId,
            productId: l.productId,
            warehouseId: o.warehouseId,
            type: 'PRODUCTION_RETURN',
            qty: l.issuedQty,
            unitCost: l.unitCost,
            refType: 'PRODUCTION_ORDER',
            refId: o.id,
            refNumber: o.number,
            date,
          });
          back = back.plus(moved.value);
          returned.push({ productId: l.productId, value: moved.value });
        }
        const material = D(o.materialCost);
        const diff = money(material.minus(back));
        if (material.gt(0)) {
          await this.posting.post(tx, {
            tenantId: user.tenantId,
            date,
            description: `Batal produksi ${o.number} — bahan kembali ke gudang`,
            sourceType: 'PRODUCTION',
            sourceId: o.id,
            createdById: user.sub,
            lines: [
              ...inventoryLines(returned, await semiSet(tx, user.tenantId, returned.map((x) => x.productId)), 'debit'),
              { key: SYS.INVENTORY_ADJ, debit: diff.gt(0) ? diff : 0, credit: diff.lt(0) ? diff.abs() : 0 },
              { key: SYS.WIP, credit: material },
            ],
          });
        }
      }
      await patchById(tx, productionOrders, id, { status: 'CANCELLED', cancelledDate: date });
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CANCEL',
        entity: 'ProductionOrder',
        entityId: id,
      });
    });
    return this.getOrder(user.tenantId, id);
  }

  // ================= Laporan harga pokok produksi =================

  async report(tenantId: string, period: string): Promise<ProductionReport> {
    if (!/^\d{4}(-\d{2})?$/.test(period)) throw new BadRequestException('Periode harus YYYY atau YYYY-MM');
    const from = period.length === 4 ? `${period}-01-01` : `${period}-01`;
    const to = period.length === 4 ? `${period}-12-31` : addDays(`${addDays(`${period}-01`, 32).slice(0, 7)}-01`, -1);
    const bal = async (key: string, upTo: string, since?: string) => {
      const [r] = (
        await this.repo.queryJournalLine(this.db, tenantId, key, upTo, since)
      ).rows;
      return D(r.v);
    };
    const wipStart = await bal(SYS.WIP, addDays(from, -1));
    const wipEnd = await bal(SYS.WIP, to);
    // bahan masuk produksi bersih: dikeluarkan dalam periode − dikembalikan karena batal dalam periode
    const [m] = (
      await this.repo.queryProductionOrderForReport(this.db, from, to, tenantId)
    ).rows;
    const done = await this.repo.listProductionOrdersByStatusAndCompletedDate(this.db, tenantId, from, to);
    const sum = (f: 'laborCost' | 'overheadCost' | 'totalCost' | 'materialCost') =>
      done.reduce<Dec>((a, o) => a.plus(o[f]), ZERO);
    const laborApplied = sum('laborCost');
    const overheadApplied = sum('overheadCost');
    const cogm = sum('totalCost');
    const laborActual = await bal(SYS.DIRECT_LABOR, to, from);
    const overheadActual = await bal(SYS.FACTORY_OVERHEAD, to, from);
    const prodIds = [...new Set(done.map((o) => o.productId))];
    const prods = prodIds.length
      ? await this.repo.listProductsByIdForReport(this.db, prodIds)
      : [];
    const byProduct = prods
      .map((p) => {
        const os = done.filter((o) => o.productId === p.id);
        const q = os.reduce<Dec>((a, o) => a.plus(o.outputQty), ZERO);
        const c = os.reduce<Dec>((a, o) => a.plus(o.totalCost), ZERO);
        const mat = os.reduce<Dec>((a, o) => a.plus(o.materialCost), ZERO);
        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          orders: os.length,
          qty: q.toString(),
          material: mat.toFixed(2),
          conversion: c.minus(mat).toFixed(2),
          total: c.toFixed(2),
          unitCost: q.gt(0) ? c.div(q).toFixed(2) : '0.00',
        };
      })
      .sort((a, b) => Number(b.total) - Number(a.total));
    const f = (d: Dec) => d.toFixed(2);
    const materialUsed = D(m.issued).minus(m.returned);
    return {
      period,
      from,
      to,
      wipStart: f(wipStart),
      materialUsed: f(materialUsed),
      laborApplied: f(laborApplied),
      overheadApplied: f(overheadApplied),
      wipEnd: f(wipEnd),
      costOfGoodsManufactured: f(cogm),
      check: f(wipStart.plus(materialUsed).plus(laborApplied).plus(overheadApplied).minus(wipEnd).minus(cogm)),
      laborActual: f(laborActual),
      overheadActual: f(overheadActual),
      variance: f(laborActual.plus(overheadActual).minus(laborApplied).minus(overheadApplied)),
      byProduct,
    };
  }
}

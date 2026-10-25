import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { addDays, toDocDate } from '../../common/utils/dates';
import { D, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { goodsSwaps, invoices } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { inventoryLines, semiSet } from '../inventory/inventory-accounts';
import { StockService } from '../inventory/stock.service';
import { CreateSwapDto } from './swaps.dto';
import { findOwned, insertOne, lockOwned, patchById } from '../../db/owned';
import { SwapsRepository } from './swaps.repository';

const MAX_AGE_DAYS = 180;

@Injectable()
export class SwapsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly repo: SwapsRepository,
  ) {}

  async list(tenantId: string, status?: string) {
    const rows = await this.db.query.goodsSwaps.findMany({
      where: and(eq(goodsSwaps.tenantId, tenantId), status ? eq(goodsSwaps.status, status as 'PENDING') : undefined),
      orderBy: [desc(goodsSwaps.date), desc(goodsSwaps.number)],
      limit: 300,
    });
    const cust = rows.length ? await this.repo.listCustomersById(this.db, rows) : [];
    const inv = rows.length ? await this.repo.listInvoicesById(this.db, rows) : [];
    const lines = rows.length ? await this.repo.listGoodsSwapLinesBySwapId(this.db, rows) : [];
    return rows.map((r) => ({ ...r, customer: cust.find((c) => c.id === r.customerId), invoiceNumber: inv.find((i) => i.id === r.invoiceId)?.number, lines: lines.filter((l) => l.swapId === r.id) }));
  }

  async create(u: AuthUser, dto: CreateSwapDto) {
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      await this.repo.queryInvoice(tx, dto.invoiceId, u.tenantId);
      const inv = await tx.query.invoices.findFirst({ where: and(eq(invoices.id, dto.invoiceId), eq(invoices.tenantId, u.tenantId)), with: { lines: true } });
      if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
      if (inv.kind === 'SERVICE') throw new BadRequestException('Faktur jasa tidak dapat ditukar-guling');
      if (date < inv.date) throw new BadRequestException('Tanggal tukar tidak boleh sebelum tanggal faktur');
      if (date > addDays(inv.date, MAX_AGE_DAYS)) throw new BadRequestException(`Tukar-guling hanya untuk faktur yang berumur paling lama ${MAX_AGE_DAYS} hari`);
      const [order] = inv.salesOrderId ? await this.repo.listSalesOrdersById(tx, inv.salesOrderId) : [];
      if (!order) throw new BadRequestException('Gudang asal faktur tidak diketahui');
      const seen = new Set<string>();
      for (const l of dto.lines) {
        if (seen.has(l.invoiceLineId)) throw new BadRequestException('Satu baris faktur hanya boleh sekali per dokumen tukar');
        seen.add(l.invoiceLineId);
        const src = inv.lines.find((x) => x.id === l.invoiceLineId);
        if (!src) throw new BadRequestException('Baris faktur tidak ditemukan pada faktur ini');
        const q = D(l.qty);
        if (q.lte(0)) throw new BadRequestException('Jumlah tukar harus lebih dari nol');
        const used = await this.repo.queryGoodsSwapLine(tx, src.id);
        const room = D(src.qty).minus(src.returnedQty).minus(used.rows[0].q);
        if (q.gt(room)) throw new BadRequestException(`Jumlah tukar melebihi yang tersisa pada baris faktur (${room.toFixed(4).replace(/\.?0+$/, '')}) setelah retur dan tukar sebelumnya`);
      }
      const number = await this.seq.next(tx, u.tenantId, 'GOODS_SWAP', date);
      const swap = await insertOne(tx, goodsSwaps, { tenantId: u.tenantId, number, date, customerId: inv.customerId, invoiceId: inv.id, warehouseId: order.warehouseId, reason: dto.reason, notes: dto.notes, createdById: u.sub });
      await this.repo.insertGoodsSwapLines(tx, dto.lines, inv.lines, swap.id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'GoodsSwap', entityId: swap.id, data: { number, invoice: inv.number, reason: dto.reason, lines: dto.lines.length } });
      return swap;
    });
  }

  async approve(u: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const swap = await lockOwned(tx, goodsSwaps, u.tenantId, id);
      if (!swap) throw new NotFoundException('Dokumen tukar-guling tidak ditemukan');
      if (swap.status !== 'PENDING') throw new BadRequestException('Dokumen ini sudah diputuskan');
      if (swap.createdById === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Tukar-guling disetujui oleh orang lain dari pembuatnya (pemisahan fungsi)');
      const lines = await this.repo.listGoodsSwapLinesBySwapIdForApprove(tx, id);
      // periksa ulang batas jumlah saat disetujui (retur lain mungkin masuk sejak dibuat)
      for (const l of lines) {
        const [src] = await this.repo.findInvoiceLinesById(tx, l.invoiceLineId);
        const used = await this.repo.queryGoodsSwapLineForApprove(tx, l.invoiceLineId);
        if (D(l.qty).gt(D(src.qty).minus(src.returnedQty).minus(used.rows[0].q))) throw new BadRequestException('Jumlah tukar sudah melebihi sisa baris faktur (ada retur/tukar lain); tolak dan buat ulang');
      }
      const items: { productId: string; value: ReturnType<typeof D> }[] = [];
      let cost = ZERO;
      for (const l of lines) {
        const out = await this.stock.move(tx, {
          tenantId: u.tenantId,
          productId: l.productId,
          warehouseId: swap.warehouseId,
          type: 'ADJUSTMENT_OUT',
          qty: D(l.qty).times(l.uomFactor).negated(),
          refType: 'GOODS_SWAP',
          refId: swap.id,
          refNumber: swap.number,
          date: swap.date,
          // penarikan produk / kedaluwarsa: pengganti tidak boleh diambil dari lot yang sama dengan yang ditarik
          excludeLotNos: l.lotNo ? [l.lotNo] : undefined,
        });
        items.push({ productId: l.productId, value: out.value });
        cost = cost.plus(out.value);
      }
      const semi = await semiSet(tx, u.tenantId, items.map((i) => i.productId));
      const journal = await this.posting.post(tx, {
        tenantId: u.tenantId,
        date: swap.date,
        description: `Tukar-guling ${swap.number} (${swap.reason === 'EXPIRED' ? 'kedaluwarsa' : swap.reason === 'DAMAGED' ? 'rusak' : 'penarikan produk'})`,
        sourceType: 'GOODS_SWAP',
        sourceId: swap.id,
        createdById: u.sub,
        lines: [{ key: swap.reason === 'DAMAGED' ? SYS.DAMAGE_LOSS : swap.reason === 'EXPIRED' ? SYS.EXPIRED_LOSS : SYS.RECALL_LOSS, debit: cost }, ...inventoryLines(items, semi, 'credit')],
      });
      await patchById(tx, goodsSwaps, id, { status: 'APPROVED', decidedById: u.sub, decidedAt: new Date(), journalId: journal.id, costAmount: cost.toFixed(2) });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'GoodsSwap', entityId: id, data: { number: swap.number, cost: cost.toFixed(2), journal: journal.number } });
      return { id, status: 'APPROVED', cost: cost.toFixed(2), journalNumber: journal.number };
    });
  }

  async reject(u: AuthUser, id: string, reason: string) {
    const swap = await findOwned(this.db, goodsSwaps, u.tenantId, id);
    if (!swap) throw new NotFoundException('Dokumen tukar-guling tidak ditemukan');
    if (swap.status !== 'PENDING') throw new BadRequestException('Dokumen ini sudah diputuskan');
    await patchById(this.db, goodsSwaps, id, { status: 'REJECTED', decidedById: u.sub, decidedAt: new Date(), rejectReason: reason });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'GoodsSwap', entityId: id, data: { number: swap.number, reason } });
    return { id, status: 'REJECTED' };
  }
}

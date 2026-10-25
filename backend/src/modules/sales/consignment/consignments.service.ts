import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { consignmentDocs, customers, products, users, warehouses } from '../../../db/schema';
import { SubscriptionService } from '../../../common/billing/subscription.service';
import { WarehouseOpsService } from '../../inventory/warehouse-ops.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SalesOrdersService } from '../orders/sales-orders.service';
import { ShipDto, ReportSoldDto, ReturnConsignDto } from './consignments.dto';
import { ReferenceRepository } from '../../../db/reference.repository';
import { findOwned, insertOne, patchById } from '../../../db/owned';
import { ConsignmentsRepository } from './consignments.repository';

const STALE_DAYS = 45;

@Injectable()
export class ConsignmentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly ops: WarehouseOpsService,
    private readonly orders: SalesOrdersService,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
    private readonly subs: SubscriptionService,
    private readonly refs: ReferenceRepository,
    private readonly repo: ConsignmentsRepository,
  ) {}

  private async customer(tenantId: string, id: string) {
    const c = await this.refs.customer(this.db, tenantId, id);
    if (!c || !c.isActive) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');
    return c;
  }

  private async mainWarehouse(tenantId: string, id: string) {
    const w = await this.refs.warehouse(this.db, tenantId, id);
    if (!w) throw new BadRequestException('Gudang tidak ditemukan');
    if (w.kind !== 'MAIN') throw new BadRequestException('Pilih gudang biasa (bukan gudang konsinyasi atau mobil)');
    return w;
  }

  private async consignWarehouse(tenantId: string, customer: { id: string; code: string; name: string }, create: boolean) {
    const [w] = await this.repo.findWarehousesByKindAndConsigneeCustomerId(this.db, tenantId, customer.id);
    if (w) return w;
    if (!create) throw new BadRequestException('Outlet ini belum memiliki stok konsinyasi');
    await this.subs.assertCanAdd(tenantId, 'warehouses');
    const row = await insertOne(this.db, warehouses, { tenantId, code: `KSG-${customer.code}`.slice(0, 30), name: `Konsinyasi ${customer.name}`.slice(0, 120), kind: 'CONSIGNMENT', consigneeCustomerId: customer.id });
    return row;
  }

  /** Sisa titipan yang bisa dilaporkan/ditarik per produk (satuan dasar) = stok di outlet − laporan yang belum ditagih */
  private async available(tenantId: string, warehouseId: string): Promise<Map<string, ReturnType<typeof D>>> {
    const bal = await this.repo.queryStockBalance(this.db, tenantId, warehouseId);
    const out = new Map(bal.rows.map((r) => [r.product_id, D(r.qty)]));
    const pending = await this.repo.listConsignmentDocsByWarehouseIdAndKindAndStatus(this.db, tenantId, warehouseId);
    const prods = await this.db.query.products.findMany({ where: eq(products.tenantId, tenantId), with: { uoms: true }, columns: { id: true, baseUom: true } });
    const byId = new Map(prods.map((p) => [p.id, p]));
    for (const d of pending) for (const l of d.lines) {
      const p = byId.get(l.productId);
      const f = !p || l.uom === p.baseUom ? '1' : (p.uoms.find((u) => u.uom === l.uom)?.factor ?? '1');
      out.set(l.productId, (out.get(l.productId) ?? D(0)).minus(D(l.qty).times(f)));
    }
    return out;
  }

  async stockReport(tenantId: string, role?: string) {
    const rows = await this.repo.queryWarehouse(this.db, tenantId);
    const docs = await this.repo.queryConsignmentDoc(this.db, tenantId);
    const today = todayJakarta();
    const map = new Map<string, { warehouseId: string; warehouseCode: string; customerId: string; customerCode: string; customerName: string; creditLimit: string; items: { productId: string; sku: string; name: string; uom: string; qty: string; cost: string; sell: string }[]; costValue: ReturnType<typeof D>; sellValue: ReturnType<typeof D> }>();
    for (const r of rows.rows) {
      const e = map.get(r.wid) ?? { warehouseId: r.wid, warehouseCode: r.wcode, customerId: r.cid, customerCode: r.ccode, customerName: r.cname, creditLimit: r.credit, items: [], costValue: D(0), sellValue: D(0) };
      if (r.pid) {
        e.items.push({ productId: r.pid, sku: r.sku, name: r.pname, uom: r.uom, qty: r.qty, cost: D(r.cost).toFixed(2), sell: D(r.sell).toFixed(2) });
        e.costValue = e.costValue.plus(r.cost);
        e.sellValue = e.sellValue.plus(r.sell);
      }
      map.set(r.wid, e);
    }
    return [...map.values()].map((e) => {
      const hideCost = role === 'SALES'; // harga pokok tidak ditampilkan ke Sales
      const mine = docs.rows.filter((d) => d.wid === e.warehouseId);
      const last = (k: string) => mine.find((d) => d.kind === k)?.last ?? null;
      const lastActivity = [last('SHIP'), last('REPORT'), last('RETURN')].filter(Boolean).sort().pop() ?? null;
      const reportBase = last('REPORT') ?? last('SHIP');
      const days = reportBase ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${reportBase}T00:00:00Z`)) / 86_400_000) : null;
      return { ...e, items: hideCost ? e.items.map((i) => ({ ...i, cost: '0.00' })) : e.items, costValue: hideCost ? '0.00' : e.costValue.toFixed(2), sellValue: e.sellValue.toFixed(2), lastShip: last('SHIP'), lastReport: last('REPORT'), lastActivity, pendingReports: Number(mine.find((d) => d.kind === 'REPORT')?.pending ?? 0), daysSinceReport: days, stale: e.items.length > 0 && days !== null && days > STALE_DAYS, staleDays: STALE_DAYS };
    });
  }

  async docs(tenantId: string, customerId?: string) {
    const rows = await this.repo.listConsignmentDocsWithCustomersByCustomerIdAndDateAndNumber(this.db, tenantId, customerId);
    return rows.map((r) => ({ ...r.d, customerCode: r.code, customerName: r.name }));
  }

  async ship(u: AuthUser, dto: ShipDto) {
    const cust = await this.customer(u.tenantId, dto.customerId);
    const from = await this.mainWarehouse(u.tenantId, dto.fromWarehouseId);
    const cw = await this.consignWarehouse(u.tenantId, cust, true);
    const merged = new Map<string, ReturnType<typeof D>>();
    for (const l of dto.lines) merged.set(l.productId, (merged.get(l.productId) ?? D(0)).plus(l.qty));
    // batas nilai titipan = limit kredit outlet (bila ada): menahan titipan berlebih ke satu outlet
    if (D(cust.creditLimit).gt(0)) {
      const cur = await this.repo.queryStockBalanceForShip(this.db, cw.id);
      const add = await this.db.execute<{ pid: string; avg: string }>(sql`SELECT product_id AS pid, avg_cost AS avg FROM stock_balances WHERE warehouse_id = ${from.id} AND product_id IN (${sql.join([...merged.keys()].map((k) => sql`${k}`), sql`, `)})`);
      const addValue = [...merged].reduce((a, [pid, q]) => a.plus(q.times(add.rows.find((r) => r.pid === pid)?.avg ?? 0)), D(0));
      if (D(cur.rows[0].v).plus(addValue).gt(cust.creditLimit)) throw new BadRequestException(`Nilai titipan di ${cust.name} akan melebihi limit kredit outlet (${D(cust.creditLimit).toFixed(0)}); naikkan limit atau tarik sebagian titipan dulu`);
    }
    const date = toDocDate(dto.date);
    const transfer = (await this.ops.createTransfer(u, { fromWarehouseId: from.id, toWarehouseId: cw.id, date, mode: 'DIRECT', notes: `Titipan konsinyasi ke ${cust.name}${dto.notes ? ` — ${dto.notes}` : ''}`.slice(0, 255), lines: [...merged].map(([productId, q]) => ({ productId, qty: q.toFixed(4) })) }, { special: true })) as { id: string };
    return this.insertDoc(u, 'SHIP', { customerId: cust.id, warehouseId: cw.id, date, transferId: transfer.id, notes: dto.notes, lines: [...merged].map(([productId, q]) => ({ productId, uom: '', qty: q.toFixed(4) })) });
  }

  private async insertDoc(u: AuthUser, kind: 'SHIP' | 'REPORT' | 'RETURN', v: { customerId: string; warehouseId: string; date: string; transferId?: string; reference?: string; notes?: string; lines: { productId: string; uom: string; qty: string }[] }) {
    return this.db.transaction(async (tx) => {
      const number = await this.seq.next(tx, u.tenantId, 'CONSIGNMENT', v.date);
      const row = await insertOne(tx, consignmentDocs, { tenantId: u.tenantId, number, kind, date: v.date, customerId: v.customerId, warehouseId: v.warehouseId, reference: v.reference ?? null, status: kind === 'REPORT' ? 'REPORTED' : 'DONE', lines: v.lines, transferId: v.transferId, notes: v.notes, createdById: u.sub });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'ConsignmentDoc', entityId: row.id, data: { number, kind, reference: v.reference, lines: v.lines.length } });
      return row;
    });
  }

  async report(u: AuthUser, dto: ReportSoldDto) {
    const cust = await this.customer(u.tenantId, dto.customerId);
    const cw = await this.consignWarehouse(u.tenantId, cust, false);
    const date = toDocDate(dto.date);
    const avail = await this.available(u.tenantId, cw.id);
    const prods = await this.db.query.products.findMany({ where: eq(products.tenantId, u.tenantId), with: { uoms: true }, columns: { id: true, baseUom: true, sku: true } });
    const byId = new Map(prods.map((p) => [p.id, p]));
    const need = new Map<string, ReturnType<typeof D>>();
    const lines = dto.lines.map((l) => {
      const p = byId.get(l.productId);
      if (!p) throw new BadRequestException('Produk tidak ditemukan');
      const uom = l.uom ?? p.baseUom;
      const f = uom === p.baseUom ? '1' : p.uoms.find((x) => x.uom === uom)?.factor;
      if (!f) throw new BadRequestException(`Satuan ${uom} tidak terdaftar untuk ${p.sku}`);
      if (D(l.qty).lte(0)) throw new BadRequestException('Jumlah harus lebih dari nol');
      need.set(l.productId, (need.get(l.productId) ?? D(0)).plus(D(l.qty).times(f)));
      return { productId: l.productId, uom, qty: D(l.qty).toFixed(4) };
    });
    for (const [pid, q] of need) {
      const have = avail.get(pid) ?? D(0);
      if (q.gt(have)) throw new BadRequestException(`Laporan ${byId.get(pid)!.sku} (${q.toFixed(0)}) melebihi sisa titipan di outlet (${have.lt(0) ? '0' : have.toFixed(0)}, sudah termasuk laporan yang belum ditagih)`);
    }
    try {
      return await this.insertDoc(u, 'REPORT', { customerId: cust.id, warehouseId: cw.id, date, reference: dto.reference.trim(), notes: dto.notes, lines });
    } catch (e) {
      if ((e as { code?: string; cause?: { code?: string } }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505') throw new BadRequestException(`Laporan outlet nomor "${dto.reference}" sudah pernah dicatat (tidak boleh ditagih dua kali)`);
      throw e;
    }
  }

  async invoice(u: AuthUser, id: string) {
    const doc = await findOwned(this.db, consignmentDocs, u.tenantId, id);
    if (!doc || doc.kind !== 'REPORT') throw new NotFoundException('Laporan konsinyasi tidak ditemukan');
    if (doc.status !== 'REPORTED') throw new BadRequestException('Laporan ini sudah diputuskan');
    if (doc.createdById === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Laporan ditagih oleh orang lain dari pelapornya (pemisahan fungsi)');
    // klaim dulu agar dua orang tidak menagih bersamaan
    const claimed = await this.repo.updateConsignmentDocsByIdAndStatus(this.db, u.sub, id);
    if (!claimed.length) throw new BadRequestException('Laporan ini sedang/sudah ditagih');
    let soId: string | undefined;
    let inv: { id: string; number: string };
    try {
      const [reporter] = doc.createdById ? await this.repo.listUsersById(this.db, doc.createdById) : [];
      const so = await this.orders.create(u, {
        customerId: doc.customerId,
        warehouseId: doc.warehouseId,
        date: doc.date,
        notes: `Konsinyasi — laporan outlet ${doc.reference} (${doc.number})`,
        // nomor laporan outlet dipakai sebagai acuan PO: unik per outlet, dan menggantikan kewajiban nomor PO peritel modern
        customerPoNo: `KSG-${doc.reference}`,
        // hanya yang dilaporkan outlet yang ditagih: tanpa promo/bonus tambahan; daftar harga outlet tetap berlaku
        applyPromos: false,
        salespersonId: reporter?.role === 'SALES' ? reporter.id : undefined,
        lines: doc.lines.map((l) => ({ productId: l.productId, uom: l.uom, qty: l.qty })),
      }, { consignment: true });
      soId = so.id;
      await this.orders.confirm(u, so.id, { internal: true });
      inv = await this.invoices.createFromOrder(u, { salesOrderId: so.id, date: doc.date });
    } catch (e) {
      // gagal SEBELUM faktur terbit: kembalikan laporan agar bisa diproses ulang dan batalkan pesanan yang terlanjur dibuat
      await patchById(this.db, consignmentDocs, id, { status: 'REPORTED', decidedById: null });
      if (soId) await this.orders.cancel(u, soId, 'Pembatalan otomatis: proses konsinyasi gagal').catch(() => undefined);
      throw e;
    }
    // faktur sudah terbit: laporan tetap INVOICED walau pencatatan tautan/audit di bawah gagal (mencegah penagihan ganda)
    try {
      await patchById(this.db, consignmentDocs, id, { salesOrderId: soId, invoiceId: inv.id });
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'INVOICE', entity: 'ConsignmentDoc', entityId: id, data: { number: doc.number, reference: doc.reference, invoice: inv.number } });
    } catch {
      /* tidak dibatalkan: status INVOICED sudah benar */
    }
    return { id, status: 'INVOICED', invoiceId: inv.id, invoiceNumber: inv.number };
  }

  async reject(u: AuthUser, id: string, reason: string) {
    const doc = await findOwned(this.db, consignmentDocs, u.tenantId, id);
    if (!doc || doc.kind !== 'REPORT') throw new NotFoundException('Laporan konsinyasi tidak ditemukan');
    if (doc.status !== 'REPORTED') throw new BadRequestException('Laporan ini sudah diputuskan');
    await patchById(this.db, consignmentDocs, id, { status: 'REJECTED', decidedById: u.sub, rejectReason: reason });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'ConsignmentDoc', entityId: id, data: { number: doc.number, reason } });
    return { id, status: 'REJECTED' };
  }

  async pullBack(u: AuthUser, dto: ReturnConsignDto) {
    const cust = await this.customer(u.tenantId, dto.customerId);
    const to = await this.mainWarehouse(u.tenantId, dto.toWarehouseId);
    const cw = await this.consignWarehouse(u.tenantId, cust, false);
    const avail = await this.available(u.tenantId, cw.id);
    const merged = new Map<string, ReturnType<typeof D>>();
    for (const l of dto.lines) merged.set(l.productId, (merged.get(l.productId) ?? D(0)).plus(l.qty));
    for (const [pid, q] of merged) {
      if (q.lte(0)) throw new BadRequestException('Jumlah harus lebih dari nol');
      if (q.gt(avail.get(pid) ?? D(0))) throw new BadRequestException('Jumlah tarik melebihi sisa titipan di outlet (sudah dikurangi laporan yang belum ditagih)');
    }
    const date = toDocDate(dto.date);
    const transfer = (await this.ops.createTransfer(u, { fromWarehouseId: cw.id, toWarehouseId: to.id, date, mode: 'DIRECT', notes: `Tarik titipan dari ${cust.name}${dto.notes ? ` — ${dto.notes}` : ''}`.slice(0, 255), lines: [...merged].map(([productId, q]) => ({ productId, qty: q.toFixed(4) })) }, { special: true })) as { id: string };
    return this.insertDoc(u, 'RETURN', { customerId: cust.id, warehouseId: cw.id, date, transferId: transfer.id, notes: dto.notes, lines: [...merged].map(([productId, q]) => ({ productId, uom: '', qty: q.toFixed(4) })) });
  }
}

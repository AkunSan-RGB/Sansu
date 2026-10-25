import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { purchaseRequestLines, purchaseRequests, suppliers, users, warehouses, type PurchaseRequestStatus } from '../../db/schema';
import { buildLines } from '../master-data/products/line-builder';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ConvertPurchaseRequestDto, CreatePurchaseRequestDto } from './purchase-requests.dto';
import { ReferenceRepository } from '../../db/reference.repository';
import { patchById } from '../../db/owned';
import { PurchaseRequestsRepository } from './purchase-requests.repository';

const rp = (v: number) => `Rp${Math.round(v).toLocaleString('id-ID')}`;

/**
 * Permintaan pembelian internal: gudang / divisi mengajukan kebutuhan barang → disetujui (atau otomatis bila nilainya kecil)
 * → diubah menjadi pesanan pembelian per supplier hanya dengan satu klik. Memangkas bolak-balik antara peminta, pemberi
 * persetujuan, dan bagian pembelian.
 */
@Injectable()
export class PurchaseRequestsService {
  private readonly logger = new Logger('PermintaanPembelian');
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly orders: PurchaseOrdersService,
    private readonly refs: ReferenceRepository,
    private readonly repo: PurchaseRequestsRepository,
  ) {}

  private async names(db: DbOrTx, ids: (string | null)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map<string, string>();
    const rows = await this.repo.listUsersById(db, uniq);
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Harga beli terakhir per satuan dasar (utamakan supplier yang sama) */
  private async lastBasePrice(db: DbOrTx, tenantId: string, productId: string, supplierId?: string | null): Promise<number | null> {
    const row = (
      await this.repo.queryPurchaseOrderLine(db, tenantId, productId, supplierId)
    ).rows[0];
    return row?.p != null ? Number(row.p) : null;
  }

  /** Perkiraan nilai (DPP): harga perkiraan baris, atau harga beli terakhir; `complete` false bila ada baris tanpa harga */
  private async estimate(db: DbOrTx, tenantId: string, lines: { productId: string; qty: string; uomFactor: string; supplierId: string | null; estPrice: string | null }[]) {
    let total = 0;
    let complete = true;
    for (const l of lines) {
      const unit = l.estPrice != null ? Number(l.estPrice) : ((await this.lastBasePrice(db, tenantId, l.productId, l.supplierId)) ?? NaN) * Number(l.uomFactor);
      if (Number.isFinite(unit)) total += unit * Number(l.qty);
      else complete = false;
    }
    return { total: Math.round(total), complete };
  }

  async list(tenantId: string, status?: PurchaseRequestStatus) {
    const rows = await this.db.query.purchaseRequests.findMany({
      where: and(eq(purchaseRequests.tenantId, tenantId), status ? eq(purchaseRequests.status, status) : undefined),
      with: { warehouse: { columns: { code: true, name: true } }, lines: { columns: { id: true, purchaseOrderId: true } } },
      orderBy: [desc(purchaseRequests.date), desc(purchaseRequests.number)],
      limit: 300,
    });
    const names = await this.names(this.db, rows.map((r) => r.requestedById));
    return rows.map(({ lines, ...r }) => ({
      ...r,
      requestedBy: r.requestedById ? (names.get(r.requestedById) ?? null) : null,
      lineCount: lines.length,
      orderedCount: lines.filter((l) => l.purchaseOrderId).length,
    }));
  }

  async get(tenantId: string, id: string, db: DbOrTx = this.db) {
    const r = await db.query.purchaseRequests.findFirst({
      where: and(eq(purchaseRequests.id, id), eq(purchaseRequests.tenantId, tenantId)),
      with: {
        warehouse: { columns: { id: true, code: true, name: true } },
        lines: {
          with: {
            product: { columns: { sku: true, name: true, baseUom: true } },
            supplier: { columns: { id: true, code: true, name: true } },
            order: { columns: { id: true, number: true, status: true } },
          },
        },
      },
    });
    if (!r) throw new NotFoundException('Permintaan pembelian tidak ditemukan');
    const names = await this.names(db, [r.requestedById, r.decidedById]);
    const est = await this.estimate(db, tenantId, r.lines);
    return {
      ...r,
      requestedBy: r.requestedById ? (names.get(r.requestedById) ?? null) : null,
      decidedBy: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
      estimatedTotal: est.total,
      estimateComplete: est.complete,
    };
  }

  async create(user: AuthUser, dto: CreatePurchaseRequestDto) {
    const id = await this.db.transaction(async (tx) => {
      const wh = await this.refs.warehouse(tx, user.tenantId, dto.warehouseId);
      if (!wh) throw new BadRequestException('Gudang tidak ditemukan');
      if (wh.kind !== 'MAIN') throw new BadRequestException('Gudang konsinyasi/mobil hanya dipakai lewat menu Konsinyasi / Kanvas');
      const supIds = [...new Set(dto.lines.map((l) => l.supplierId).filter((x): x is string => !!x))];
      if (supIds.length) {
        const found = await this.repo.listSuppliersById(tx, user.tenantId, supIds);
        if (found.length !== supIds.length) throw new BadRequestException('Supplier tidak ditemukan');
      }
      // validasi produk & satuan memakai pembangun baris yang sama dengan PO (harga tidak dipakai di sini)
      const built = await buildLines(tx, user.tenantId, dto.lines.map((l) => ({ productId: l.productId, uom: l.uom, qty: l.qty, price: '0' })), 'required');
      const date = toDocDate(dto.date);
      const number = await this.seq.next(tx, user.tenantId, 'PURCHASE_REQUEST', date);
      const [req] = await this.repo.insertPurchaseRequests(tx, user.tenantId, number, date, wh.id, dto, user.sub);
      await tx.insert(purchaseRequestLines).values(
        built.map((b, i) => ({
          requestId: req.id,
          productId: b.productId,
          uom: b.uom,
          uomFactor: b.uomFactor,
          qty: b.qty,
          supplierId: dto.lines[i].supplierId ?? null,
          estPrice: dto.lines[i].estPrice ?? null,
        })),
      );
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PurchaseRequest', entityId: req.id });
      if (dto.submit) await this.submitIn(tx, user, req.id);
      return req.id;
    });
    const out = await this.get(user.tenantId, id);
    if (out.status === 'SUBMITTED') void this.notifyApprovers(user.tenantId, out);
    return out;
  }

  async submit(user: AuthUser, id: string) {
    await this.db.transaction((tx) => this.submitIn(tx, user, id));
    const out = await this.get(user.tenantId, id);
    if (out.status === 'SUBMITTED') void this.notifyApprovers(user.tenantId, out);
    return out;
  }

  private async submitIn(tx: Tx, user: AuthUser, id: string) {
    const r = await this.lock(tx, user.tenantId, id);
    if (r.status !== 'DRAFT') throw new BadRequestException(`Permintaan berstatus ${r.status}, tidak bisa diajukan`);
    const policy = await this.approvals.policy(tx, user.tenantId);
    const est = await this.estimate(tx, user.tenantId, r.lines);
    const isApprover = this.approvals.isApprover(user.role);
    // Pemberi persetujuan yang mengajukan = otomatis disetujui; peminta lain: otomatis bila nilainya ≤ batas dan semua harga diketahui
    // Supplier favorit: bila semua barang sudah punya supplier favorit, batasnya adalah yang terkecil di antara mereka
    const supIds = [...new Set(r.lines.map((l) => l.supplierId))];
    let preferredLimit = 0;
    if (supIds.length && supIds.every((x): x is string => !!x)) {
      const sups = await this.repo.listSuppliersByIdForSubmitIn(tx, user.tenantId, supIds);
      if (sups.length === supIds.length && sups.every((x) => x.preferred && Number(x.limit) > 0)) preferredLimit = Math.min(...sups.map((x) => Number(x.limit)));
    }
    const auto = !isApprover && est.complete && ((policy.purchaseRequestAuto > 0 && est.total <= policy.purchaseRequestAuto) || (preferredLimit > 0 && est.total <= preferredLimit));
    const approved = isApprover || auto;
    await patchById(tx, purchaseRequests, id, {
        status: approved ? 'APPROVED' : 'SUBMITTED',
        submittedAt: sql`now()`,
        ...(approved ? { decidedById: isApprover ? user.sub : null, decidedAt: sql`now()`, autoApproved: auto, decisionNote: auto ? 'Disetujui otomatis (di bawah batas persetujuan otomatis)' : null } : {}),
      });
    await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: approved ? 'SUBMIT_APPROVED' : 'SUBMIT', entity: 'PurchaseRequest', entityId: id });
  }

  async decide(user: AuthUser, id: string, approve: boolean, note?: string) {
    if (!approve && !note?.trim()) throw new BadRequestException('Alasan penolakan wajib diisi');
    await this.db.transaction(async (tx) => {
      const r = await this.lock(tx, user.tenantId, id);
      if (r.status !== 'SUBMITTED') throw new BadRequestException(`Permintaan berstatus ${r.status}; hanya yang menunggu persetujuan bisa diputuskan`);
      await patchById(tx, purchaseRequests, id, { status: approve ? 'APPROVED' : 'REJECTED', decidedById: user.sub, decidedAt: sql`now()`, decisionNote: note?.trim() || null });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: approve ? 'APPROVE' : 'REJECT', entity: 'PurchaseRequest', entityId: id });
    });
    return this.get(user.tenantId, id);
  }

  async cancel(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const r = await this.lock(tx, user.tenantId, id);
      if (!['DRAFT', 'SUBMITTED', 'APPROVED'].includes(r.status)) throw new BadRequestException(`Permintaan berstatus ${r.status}, tidak bisa dibatalkan`);
      if (r.lines.some((l) => l.purchaseOrderId)) throw new BadRequestException('Sebagian barang sudah dipesan; batalkan PO-nya dulu');
      if (r.requestedById !== user.sub && !this.approvals.isApprover(user.role)) throw new BadRequestException('Hanya peminta atau pemberi persetujuan yang bisa membatalkan');
      await patchById(tx, purchaseRequests, id, { status: 'CANCELLED' });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CANCEL', entity: 'PurchaseRequest', entityId: id });
    });
    return this.get(user.tenantId, id);
  }

  /** Ubah permintaan yang sudah disetujui menjadi PO draft — satu per supplier */
  async convert(user: AuthUser, id: string, dto: ConvertPurchaseRequestDto) {
    await this.db.transaction(async (tx) => {
      const r = await this.lock(tx, user.tenantId, id);
      if (r.status !== 'APPROVED') throw new BadRequestException(r.status === 'CONVERTED' ? 'Permintaan ini sudah dijadikan PO seluruhnya' : `Permintaan berstatus ${r.status}; harus disetujui dulu`);
      const open = r.lines.filter((l) => !l.purchaseOrderId);
      const over = new Map((dto.lines ?? []).map((o) => [o.lineId, o]));
      for (const o of over.values()) if (!open.some((l) => l.id === o.lineId)) throw new BadRequestException('Baris tidak ditemukan pada permintaan ini');
      const prods = await tx.query.products.findMany({ where: (p, { inArray: inA }) => inA(p.id, open.map((l) => l.productId)), columns: { id: true, sku: true } });
      const sku = new Map(prods.map((p) => [p.id, p.sku]));
      const bySupplier = new Map<string, { lineId: string; productId: string; uom: string; qty: string; price: string }[]>();
      for (const l of open) {
        const o = over.get(l.id);
        const supplierId = o?.supplierId ?? l.supplierId;
        if (!supplierId) throw new BadRequestException(`Tentukan supplier untuk ${sku.get(l.productId)}`);
        let price = o?.price ?? l.estPrice;
        if (price == null) {
          const base = await this.lastBasePrice(tx, user.tenantId, l.productId, supplierId);
          if (base == null) throw new BadRequestException(`Harga ${sku.get(l.productId)} belum diketahui; isi harga belinya`);
          price = String(Math.round(base * Number(l.uomFactor) * 100) / 100);
        }
        const arr = bySupplier.get(supplierId) ?? [];
        arr.push({ lineId: l.id, productId: l.productId, uom: l.uom, qty: l.qty, price });
        bySupplier.set(supplierId, arr);
      }
      for (const [supplierId, lines] of bySupplier) {
        const poId = await this.orders.createIn(tx, user, {
          supplierId,
          warehouseId: r.warehouseId,
          date: dto.date,
          notes: `Dari permintaan pembelian ${r.number}`,
          lines: lines.map((x) => ({ productId: x.productId, uom: x.uom, qty: x.qty, price: x.price })),
        });
        await this.repo.updatePurchaseRequestLinesById(tx, poId, supplierId, lines);
      }
      await patchById(tx, purchaseRequests, id, { status: 'CONVERTED' });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CONVERT', entity: 'PurchaseRequest', entityId: id });
    });
    return this.get(user.tenantId, id);
  }

  /**
   * Usulan pembelian dari stok minimum: produk yang posisinya (stok + sedang dipesan + sudah diminta) masih di bawah minimum,
   * disarankan dipesan sampai 2× minimum. Supplier dan harga diambil dari pembelian terakhir.
   */
  async suggestions(tenantId: string, warehouseId?: string) {
    const rows = (
      await this.repo.queryStockMinimum(this.db, tenantId, warehouseId)
    ).rows;
    return rows.map((r) => {
      const position = Number(r.on_hand) + Number(r.on_order) + Number(r.requested);
      return {
        productId: r.product_id,
        sku: r.sku,
        name: r.name,
        baseUom: r.base_uom,
        warehouseId: r.warehouse_id,
        warehouseCode: r.wh_code,
        minQty: Number(r.min_qty),
        onHand: Number(r.on_hand),
        onOrder: Number(r.on_order),
        requested: Number(r.requested),
        suggestedQty: Math.ceil(Number(r.min_qty) * 2 - position),
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        lastPrice: r.last_price != null ? Math.round(Number(r.last_price) * 100) / 100 : null,
      };
    });
  }

  private async lock(tx: Tx, tenantId: string, id: string) {
    const locked = await this.repo.queryPurchaseRequest(tx, id, tenantId);
    if (!locked.rows.length) throw new NotFoundException('Permintaan pembelian tidak ditemukan');
    return (await tx.query.purchaseRequests.findFirst({ where: eq(purchaseRequests.id, id), with: { lines: true } }))!;
  }

  /** Beri tahu pemilik dan admin lewat email (dengan tautan persetujuan tanpa login) */
  private notifyApprovers(tenantId: string, r: { id: string; number: string; requestedById: string | null; requestedBy: string | null; estimatedTotal: number; estimateComplete: boolean; lines: unknown[]; warehouse: { name: string } }) {
    return this.approvals.notifyApprovers(tenantId, {
      kind: 'PR',
      id: r.id,
      requesterId: r.requestedById,
      title: `Permintaan pembelian ${r.number}`,
      lines: [
        `${r.requestedBy ?? 'Seorang pengguna'} meminta ${r.lines.length} barang untuk gudang ${r.warehouse.name}${r.estimateComplete ? `, perkiraan ${rp(r.estimatedTotal)}` : ''}.`,
      ],
    });
  }
}

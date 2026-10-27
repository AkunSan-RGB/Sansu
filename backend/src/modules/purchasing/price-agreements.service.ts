import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { addDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec } from '../../common/utils/money';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { products, supplierPriceAgreements, suppliers } from '../../db/schema';
import { CreateAgreementDto, DecideAgreementDto, ReasonDto, LookupDto } from './price-agreements.dto';
import { insertOne } from '../../db/owned';
import { PriceAgreementsRepository } from './price-agreements.repository';

export const MAX_CONTRACT_DAYS = 3 * 366;

export const SUSPICIOUS_PCT_OVER_LAST = 20;

@Injectable()
export class PriceAgreementsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly repo: PriceAgreementsRepository,
  ) {}

  async list(u: AuthUser, status?: string) {
    const rows = await this.repo.querySupplierPriceAgreement(this.db, u, status);
    return rows.rows.map((r) => {
      const last = r.lastPrice != null ? D(r.lastPrice as string) : null;
      const over = last && last.gt(0) ? D(r.price as string).minus(last).div(last).times(100) : null;
      return { ...r, lastPrice: last ? last.toFixed(2) : null, overLastPct: over ? Number(over.toFixed(1)) : null, suspicious: !!over && over.gt(SUSPICIOUS_PCT_OVER_LAST) };
    });
  }

  async create(u: AuthUser, dto: CreateAgreementDto) {
    const price = D(dto.price);
    if (!price.isFinite() || price.lte(0)) throw new BadRequestException('Harga kontrak harus lebih dari 0');
    const from = toDocDate(dto.validFrom);
    const to = toDocDate(dto.validTo);
    if (to < from) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    if (to < todayJakarta()) throw new BadRequestException('Kontrak yang sudah berakhir tidak perlu dicatat');
    if (to > addDays(from, MAX_CONTRACT_DAYS)) throw new BadRequestException('Masa kontrak maksimal 3 tahun');
    const [sup] = await this.repo.findSuppliersById(this.db, dto.supplierId, u.tenantId);
    if (!sup) throw new BadRequestException('Pemasok tidak ditemukan');
    const [prod] = await this.repo.findProductsById(this.db, dto.productId, u.tenantId);
    if (!prod) throw new BadRequestException('Barang tidak ditemukan');
    const clash = await this.repo.querySupplierPriceAgreementForCreate(this.db, u.tenantId, dto.supplierId, dto.productId, to, from);
    if (clash.rows.length) throw new BadRequestException('Barang ini sudah punya kontrak (atau pengajuan) yang periodenya tumpang tindih dengan pemasok yang sama');
    const row = await insertOne(this.db, supplierPriceAgreements, { tenantId: u.tenantId, supplierId: dto.supplierId, productId: dto.productId, price: price.toFixed(2), validFrom: from, validTo: to, note: dto.note ?? null, createdById: u.sub });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'SupplierPriceAgreement', entityId: row.id, data: { price: row.price, from, to } });
    void this.approvals.notifyRoles(u.tenantId, { roles: ['FINANCE', 'ADMIN', 'OWNER'], excludeUserId: u.sub, title: `Kontrak harga pemasok menunggu persetujuan: Rp${Math.round(price.toNumber()).toLocaleString('id-ID')} per satuan`, lines: [`Berlaku ${from} s.d. ${to}`], path: '/price-agreements' });
    return row;
  }

  private async lockRow(tx: DbOrTx, tenantId: string, id: string) {
    const r = await this.repo.querySupplierPriceAgreementForLockRow(tx, id, tenantId);
    if (!r.rows.length) throw new NotFoundException('Kontrak tidak ditemukan');
    return r.rows[0];
  }

  private assertChecker(u: AuthUser, createdBy: string) {
    if (createdBy === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Kontrak harus disetujui orang lain dari pembuatnya (pemisahan fungsi)');
  }

  async approve(u: AuthUser, id: string, dto: DecideAgreementDto) {
    return this.db.transaction(async (tx) => {
      const a = await this.lockRow(tx, u.tenantId, id);
      if (a.status !== 'PENDING') throw new BadRequestException('Kontrak ini sudah diputuskan');
      this.assertChecker(u, a.created_by_id);
      const [row] = await this.repo.updateSupplierPriceAgreementsById(tx, u.sub, dto, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'SupplierPriceAgreement', entityId: id, data: { price: a.price } });
      return row;
    });
  }

  async reject(u: AuthUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (tx) => {
      const a = await this.lockRow(tx, u.tenantId, id);
      if (a.status !== 'PENDING') throw new BadRequestException('Kontrak ini sudah diputuskan');
      this.assertChecker(u, a.created_by_id);
      const [row] = await this.repo.updateSupplierPriceAgreementsByIdForReject(tx, u.sub, dto.reason, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'SupplierPriceAgreement', entityId: id, data: { reason: dto.reason } });
      return row;
    });
  }

  /** Akhiri kontrak lebih awal (PO yang sudah dibuat tidak berubah) */
  async end(u: AuthUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (tx) => {
      const a = await this.lockRow(tx, u.tenantId, id);
      if (a.status !== 'ACTIVE' && a.status !== 'PENDING') throw new BadRequestException('Kontrak ini sudah tidak berlaku');
      const [row] = await this.repo.updateSupplierPriceAgreementsByIdForEnd(tx, u.sub, dto.reason, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'END', entity: 'SupplierPriceAgreement', entityId: id, data: { reason: dto.reason, was: a.status } });
      return row;
    });
  }

  lookupFor(u: AuthUser, q: LookupDto) {
    return this.lookup(this.db, u.tenantId, q.supplierId, q.productId, q.date ? toDocDate(q.date) : todayJakarta());
  }

  /** Harga kontrak aktif untuk pemasok + barang pada tanggal tertentu (per satuan dasar) */
  async lookup(db: DbOrTx, tenantId: string, supplierId: string, productId: string, date: string) {
    const r = await this.repo.querySupplierPriceAgreementForLookup(db, tenantId, supplierId, productId, date);
    return r.rows[0] ? { id: r.rows[0].id, price: r.rows[0].price, validTo: r.rows[0].valid_to } : null;
  }

  /**
   * Dipanggil saat PO dibuat: harga efektif per satuan dasar (setelah diskon) tidak boleh melebihi harga kontrak aktif.
   * Admin/Pemilik boleh melewati, tercatat di audit. Hanya untuk PO Rupiah (kontrak dalam Rupiah).
   */
  async enforce(tx: DbOrTx, u: AuthUser, supplierId: string, date: string, lines: { productId: string; price: Dec; discountPct: Dec; uomFactor: string }[]) {
    const over: string[] = [];
    for (const l of lines) {
      const ag = await this.lookup(tx, u.tenantId, supplierId, l.productId, date);
      if (!ag) continue;
      const eff = l.price.times(D(1).minus(l.discountPct.div(100))).div(D(l.uomFactor));
      if (eff.gt(D(ag.price).times('1.0001'))) {
        const [p] = await this.repo.findProductsByIdForEnforce(tx, l.productId);
        over.push(`${p?.sku ?? l.productId}: ${eff.toFixed(2)} > kontrak ${D(ag.price).toFixed(2)}`);
      }
    }
    if (!over.length) return;
    if (u.role !== 'OWNER' && u.role !== 'ADMIN') throw new BadRequestException(`Harga melebihi kontrak harga pemasok (${over.join('; ')}). Sesuaikan harga atau minta Admin/Pemilik menyetujui.`);
    await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'OVERRIDE', entity: 'SupplierPriceAgreement', entityId: supplierId, data: { over } });
  }
}

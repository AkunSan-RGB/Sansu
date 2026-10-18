import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../../common/approvals/approvals.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, invoices, priceLists } from '../../../db/schema';
import { supplierNameKey } from '../../purchasing/suppliers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  list(tenantId: string, q?: string) {
    return this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, tenantId),
          q ? or(ilike(customers.code, `%${q}%`), ilike(customers.name, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(asc(customers.code))
      .limit(500);
  }

  async get(tenantId: string, id: string) {
    const [c] = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Pelanggan tidak ditemukan');
    const [open] = await this.db
      .select({ outstanding: sql<string>`COALESCE(SUM(${invoices.total} - ${invoices.paidAmount} - ${invoices.returnedAmount}), 0)` })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, id), ne(invoices.status, 'PAID')));
    return { ...c, outstanding: D(open.outstanding).toFixed(2) };
  }

  /** Daftar harga harus milik perusahaan yang sama (kunci asing saja tidak membatasi per perusahaan) */
  private async checkPriceList(tenantId: string, priceListId?: string | null) {
    if (!priceListId) return;
    const [l] = await this.db.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.id, priceListId), eq(priceLists.tenantId, tenantId)));
    if (!l) throw new BadRequestException('Daftar harga tidak ditemukan');
  }

  async create(tenantId: string, dto: CreateCustomerDto) {
    await this.checkPriceList(tenantId, dto.priceListId);
    const { confirmDuplicate: _c, ...rest } = dto;
    const [row] = await this.db
      .insert(customers)
      .values({ ...rest, geoLat: dto.geoLat?.toFixed(6), geoLng: dto.geoLng?.toFixed(6), code: dto.code.trim().toUpperCase(), tenantId })
      .returning();
    return row;
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    await this.get(tenantId, id);
    await this.checkPriceList(tenantId, dto.priceListId);
    const { confirmDuplicate: _c, ...rest } = dto;
    const [row] = await this.db
      .update(customers)
      .set({ ...rest, geoLat: dto.geoLat?.toFixed(6), geoLng: dto.geoLng?.toFixed(6), code: dto.code?.trim().toUpperCase() })
      .where(eq(customers.id, id))
      .returning();
    return row;
  }

  /** Anti pelanggan fiktif / ganda: NPWP sama (angka saja) atau nama sangat mirip → 409 sampai dikonfirmasi; konfirmasi tercatat di jejak audit */
  private async assertNoLookalike(u: AuthUser, dto: { name?: string; npwp?: string; confirmDuplicate?: boolean }, exceptId?: string) {
    const npwp = dto.npwp?.replace(/\D/g, '') ?? '';
    const key = dto.name ? supplierNameKey(dto.name) : '';
    if (npwp.length < 10 && !key) return null;
    const all = await this.db.select({ id: customers.id, code: customers.code, name: customers.name, npwp: customers.npwp }).from(customers).where(eq(customers.tenantId, u.tenantId));
    const dup = all.filter((o) => o.id !== exceptId && ((npwp.length >= 10 && (o.npwp ?? '').replace(/\D/g, '') === npwp) || (key && supplierNameKey(o.name) === key)));
    if (!dup.length) return null;
    if (!dto.confirmDuplicate) {
      throw new ConflictException({
        statusCode: 409,
        code: 'POSSIBLE_DUPLICATE_CUSTOMER',
        message: `Pelanggan ini mirip dengan: ${dup.map((d) => `${d.code} ${d.name}`).join(', ')}. Pastikan bukan pelanggan yang sama (NPWP atau nama serupa) sebelum menyimpan.`,
        matches: dup.map((d) => ({ id: d.id, code: d.code, name: d.name })),
      });
    }
    return dup;
  }

  async createBy(u: AuthUser, dto: CreateCustomerDto) {
    const dup = await this.assertNoLookalike(u, dto);
    const row = await this.create(u.tenantId, dto);
    if (dup) await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CONFIRM_DUPLICATE', entity: 'Customer', entityId: row.id, data: { similarTo: dup.map((d) => d.code) } });
    return row;
  }

  /**
   * Ubah pelanggan. Menaikkan limit kredit, memperpanjang termin, atau melepas wajib PO oleh selain Pemilik/Admin butuh persetujuan
   * (melonggarkan syarat adalah cara umum menutupi tagihan macet); menurunkannya langsung berlaku. Perubahan syarat tercatat dan Pemilik diberi tahu.
   */
  async updateBy(u: AuthUser, id: string, dto: UpdateCustomerDto) {
    const cur = await this.get(u.tenantId, id);
    const changed = (dto.npwp !== undefined && dto.npwp !== cur.npwp) || (dto.name !== undefined && dto.name !== cur.name);
    const dup = changed ? await this.assertNoLookalike(u, { name: dto.name ?? cur.name, npwp: dto.npwp ?? cur.npwp ?? undefined, confirmDuplicate: dto.confirmDuplicate }, id) : null;
    const { confirmDuplicate: _c, ...rest } = dto;
    const loosens =
      (rest.creditLimit !== undefined && (Number(rest.creditLimit) === 0 ? Number(cur.creditLimit) !== 0 : Number(cur.creditLimit) !== 0 && Number(rest.creditLimit) > Number(cur.creditLimit))) ||
      (rest.paymentTermDays !== undefined && rest.paymentTermDays > cur.paymentTermDays) ||
      (rest.requirePo === false && cur.requirePo);
    let pending: { id: string } | undefined;
    let toApply: UpdateCustomerDto = rest;
    if (loosens && !this.approvals.isApprover(u.role)) {
      const terms = { creditLimit: rest.creditLimit, paymentTermDays: rest.paymentTermDays, requirePo: rest.requirePo };
      pending = await this.approvals.create(this.db, u, {
        kind: 'CUSTOMER_TERMS',
        refId: id,
        title: `Ubah syarat pelanggan ${cur.code} ${cur.name}: limit ${Number(cur.creditLimit).toLocaleString('id-ID')} → ${rest.creditLimit !== undefined ? Number(rest.creditLimit).toLocaleString('id-ID') : 'tetap'}, termin ${cur.paymentTermDays} → ${rest.paymentTermDays ?? 'tetap'} hari`,
        amount: Number(rest.creditLimit ?? cur.creditLimit),
        payload: { customerId: id, ...JSON.parse(JSON.stringify(terms)) },
      });
      // bagian lain (nama, alamat, dll.) tetap disimpan; syarat komersial menunggu
      const { creditLimit: _a, paymentTermDays: _b, requirePo: _d, ...others } = rest;
      toApply = others;
    }
    const hasChange = Object.values(toApply).some((v) => v !== undefined);
    const row = hasChange ? await this.update(u.tenantId, id, toApply) : cur;
    if (dup) await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CONFIRM_DUPLICATE', entity: 'Customer', entityId: id, data: { similarTo: dup.map((d) => d.code) } });
    if (!pending && (rest.creditLimit !== undefined || rest.paymentTermDays !== undefined || rest.requirePo !== undefined) && (Number(rest.creditLimit ?? cur.creditLimit) !== Number(cur.creditLimit) || (rest.paymentTermDays ?? cur.paymentTermDays) !== cur.paymentTermDays)) {
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE_TERMS', entity: 'Customer', entityId: id, data: { before: { limit: cur.creditLimit, term: cur.paymentTermDays }, after: { limit: rest.creditLimit, term: rest.paymentTermDays } } });
      void this.approvals.notifyRoles(u.tenantId, { roles: ['OWNER'], excludeUserId: u.sub, info: true, title: `Syarat pelanggan ${cur.code} ${cur.name} diubah`, lines: [`Limit ${Number(cur.creditLimit).toLocaleString('id-ID')} → ${Number(rest.creditLimit ?? cur.creditLimit).toLocaleString('id-ID')}; termin ${cur.paymentTermDays} → ${rest.paymentTermDays ?? cur.paymentTermDays} hari`], path: '/customers' });
    }
    return pending ? { ...row, termsPending: true, approvalId: pending.id, message: 'Perubahan syarat (limit kredit / termin) dikirim ke Pemilik/Admin dan berlaku setelah disetujui.' } : row;
  }

  /** Dijalankan saat permintaan ubah syarat pelanggan disetujui (atas nama pemohon; penyetuju tercatat di permintaan) */
  async applyTerms(u: AuthUser, p: { customerId: string; creditLimit?: string; paymentTermDays?: number; requirePo?: boolean }) {
    const { customerId, ...terms } = p;
    const cur = await this.get(u.tenantId, customerId);
    const row = await this.update(u.tenantId, customerId, terms);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE_TERMS', entity: 'Customer', entityId: customerId, data: { before: { limit: cur.creditLimit, term: cur.paymentTermDays }, after: terms } });
    return row;
  }
}

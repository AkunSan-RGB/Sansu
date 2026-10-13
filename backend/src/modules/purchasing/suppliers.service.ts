import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { and, asc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { D } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { purchaseInvoices, suppliers } from '../../db/schema';
import { CreateSupplierDto, UpdateSupplierDto } from './purchasing.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Supplier favorit + batas persetujuan otomatis menembus kontrol persetujuan: hanya pemilik/admin yang boleh menetapkannya */
  assertCanSetPreferred(u: AuthUser, dto: { isPreferred?: boolean; autoApproveLimit?: string }) {
    if ((dto.isPreferred !== undefined || dto.autoApproveLimit !== undefined) && !['OWNER', 'ADMIN'].includes(u.role)) {
      throw new ForbiddenException('Hanya pemilik atau admin yang dapat menetapkan supplier favorit dan batas persetujuan otomatis');
    }
  }

  list(tenantId: string, q?: string) {
    return this.db
      .select()
      .from(suppliers)
      .where(
        and(
          eq(suppliers.tenantId, tenantId),
          q ? or(ilike(suppliers.code, `%${q}%`), ilike(suppliers.name, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(asc(suppliers.code))
      .limit(500);
  }

  async get(tenantId: string, id: string) {
    const [s] = await this.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
    if (!s) throw new NotFoundException('Supplier tidak ditemukan');
    const [open] = await this.db
      .select({
        v: sql<string>`COALESCE(SUM(${purchaseInvoices.total} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.returnedAmount}), 0)`,
      })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.tenantId, tenantId), eq(purchaseInvoices.supplierId, id), ne(purchaseInvoices.status, 'PAID')));
    return { ...s, outstanding: D(open.v).toFixed(2) };
  }

  /**
   * Anti pemasok fiktif / ganda: NPWP sama (angka saja) atau nama sangat mirip (tanpa PT/CV/UD, tanda baca, spasi)
   * dengan pemasok lain → 409 sampai dikonfirmasi. Konfirmasi tercatat di jejak audit.
   */
  private async findLookalikes(tenantId: string, dto: { name?: string; npwp?: string }, exceptId?: string) {
    const npwp = dto.npwp?.replace(/\D/g, '') ?? '';
    const key = dto.name ? supplierNameKey(dto.name) : '';
    if (npwp.length < 10 && !key) return [];
    const all = await this.db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, npwp: suppliers.npwp }).from(suppliers).where(eq(suppliers.tenantId, tenantId));
    return all.filter((o) => o.id !== exceptId && ((npwp.length >= 10 && (o.npwp ?? '').replace(/\D/g, '') === npwp) || (key && supplierNameKey(o.name) === key)));
  }

  private async assertNoLookalike(u: AuthUser, dto: { name?: string; npwp?: string; confirmDuplicate?: boolean }, exceptId?: string) {
    const dup = await this.findLookalikes(u.tenantId, dto, exceptId);
    if (!dup.length) return null;
    if (!dto.confirmDuplicate) {
      throw new ConflictException({
        statusCode: 409,
        code: 'POSSIBLE_DUPLICATE_SUPPLIER',
        message: `Supplier ini mirip dengan: ${dup.map((d) => `${d.code} ${d.name}`).join(', ')}. Pastikan bukan pemasok yang sama (NPWP atau nama serupa) sebelum menyimpan.`,
        matches: dup.map((d) => ({ id: d.id, code: d.code, name: d.name })),
      });
    }
    return dup;
  }

  async create(u: AuthUser, dto: CreateSupplierDto) {
    const dup = await this.assertNoLookalike(u, dto);
    const { confirmDuplicate: _c, ...rest } = dto;
    const [row] = await this.db
      .insert(suppliers)
      .values({ ...rest, code: dto.code.trim().toUpperCase(), tenantId: u.tenantId })
      .returning();
    if (dup) await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CONFIRM_DUPLICATE', entity: 'Supplier', entityId: row.id, data: { similarTo: dup.map((d) => d.code) } });
    return row;
  }

  async update(u: AuthUser, id: string, dto: UpdateSupplierDto) {
    const cur = await this.get(u.tenantId, id);
    const changed = (dto.npwp !== undefined && dto.npwp !== cur.npwp) || (dto.name !== undefined && dto.name !== cur.name);
    const dup = changed ? await this.assertNoLookalike(u, { name: dto.name ?? cur.name, npwp: dto.npwp ?? cur.npwp ?? undefined, confirmDuplicate: dto.confirmDuplicate }, id) : null;
    const { confirmDuplicate: _c, ...rest } = dto;
    const [row] = await this.db
      .update(suppliers)
      .set({ ...rest, code: dto.code?.trim().toUpperCase() })
      .where(eq(suppliers.id, id))
      .returning();
    if (dup) await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CONFIRM_DUPLICATE', entity: 'Supplier', entityId: id, data: { similarTo: dup.map((d) => d.code) } });
    return row;
  }
}

/** Kunci perbandingan nama: huruf kecil, tanpa bentuk badan usaha, tanda baca, dan spasi */
export function supplierNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pt|cv|ud|pd|tbk|toko|firma|koperasi|persero)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

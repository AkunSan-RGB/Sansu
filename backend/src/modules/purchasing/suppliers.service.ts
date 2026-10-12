import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { and, asc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { D } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { purchaseInvoices, suppliers } from '../../db/schema';
import { CreateSupplierDto, UpdateSupplierDto } from './purchasing.dto';

@Injectable()
export class SuppliersService {
  constructor(@InjectDb() private readonly db: Db) {}

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

  async create(tenantId: string, dto: CreateSupplierDto) {
    const [row] = await this.db
      .insert(suppliers)
      .values({ ...dto, code: dto.code.trim().toUpperCase(), tenantId })
      .returning();
    return row;
  }

  async update(tenantId: string, id: string, dto: UpdateSupplierDto) {
    await this.get(tenantId, id);
    const [row] = await this.db
      .update(suppliers)
      .set({ ...dto, code: dto.code?.trim().toUpperCase() })
      .where(eq(suppliers.id, id))
      .returning();
    return row;
  }
}

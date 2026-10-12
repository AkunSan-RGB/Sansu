import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, invoices } from '../../../db/schema';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';

@Injectable()
export class CustomersService {
  constructor(@InjectDb() private readonly db: Db) {}

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

  async create(tenantId: string, dto: CreateCustomerDto) {
    const [row] = await this.db
      .insert(customers)
      .values({ ...dto, code: dto.code.trim().toUpperCase(), tenantId })
      .returning();
    return row;
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    await this.get(tenantId, id);
    const [row] = await this.db
      .update(customers)
      .set({ ...dto, code: dto.code?.trim().toUpperCase() })
      .where(eq(customers.id, id))
      .returning();
    return row;
  }
}

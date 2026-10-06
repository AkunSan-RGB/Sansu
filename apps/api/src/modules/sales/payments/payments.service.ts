import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { AuthUser } from '../../../common/auth/auth-user';
import { AuditService } from '../../../common/audit/audit.service';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate } from '../../../common/utils/dates';
import { D, money } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customers, invoices, payments } from '../../../db/schema';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';
import { CreatePaymentDto } from '../sales.dto';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.db.query.payments.findMany({
      where: eq(payments.tenantId, tenantId),
      with: { customer: { columns: { code: true, name: true } }, invoice: { columns: { number: true } } },
      orderBy: [desc(payments.date), desc(payments.number)],
      limit: 300,
    });
  }

  /** Pelunasan piutang: Dr Kas/Bank | Cr Piutang Usaha */
  async create(user: AuthUser, dto: CreatePaymentDto) {
    const date = toDocDate(dto.date);
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah pembayaran harus > 0');

    return this.db.transaction(async (tx) => {
      // Kunci faktur agar dua pembayaran bersamaan tidak melebihi sisa tagihan
      const locked = await tx.execute(sql`
        SELECT id FROM invoices WHERE id = ${dto.invoiceId} AND tenant_id = ${user.tenantId} FOR UPDATE`);
      if (!locked.rows.length) throw new NotFoundException('Faktur tidak ditemukan');
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, dto.invoiceId));
      const [customer] = await tx.select().from(customers).where(eq(customers.id, inv.customerId));

      const outstanding = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
      if (amount.gt(outstanding)) {
        throw new BadRequestException(`Pembayaran ${amount.toFixed(2)} melebihi sisa tagihan ${outstanding.toFixed(2)}`);
      }

      const method = dto.method ?? 'CASH';
      const cashAccount = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, method === 'CASH' ? 'CASH' : 'BANK');
      const number = await this.seq.next(tx, user.tenantId, 'PAYMENT', date);
      const [payment] = await tx
        .insert(payments)
        .values({
          tenantId: user.tenantId,
          number,
          date,
          customerId: inv.customerId,
          invoiceId: inv.id,
          amount: amount.toFixed(2),
          method,
          cashAccountId: cashAccount.id,
          notes: dto.notes,
        })
        .returning();

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pelunasan ${inv.number} - ${customer.name} (${number})`,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
        createdById: user.sub,
        lines: [
          { accountId: cashAccount.id, debit: amount },
          { key: SYS.AR, credit: amount },
        ],
      });

      const paid = D(inv.paidAmount).plus(amount);
      await tx
        .update(invoices)
        .set({ paidAmount: paid.toFixed(2), status: paid.plus(inv.returnedAmount).gte(inv.total) ? 'PAID' : 'PARTIAL' })
        .where(eq(invoices.id, inv.id));
      await tx.update(payments).set({ journalId: journal.id }).where(eq(payments.id, payment.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'Payment', entityId: payment.id });

      return { ...payment, journalId: journal.id, journalNumber: journal.number };
    });
  }
}

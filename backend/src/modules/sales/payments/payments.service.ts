import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuthUser } from '../../../common/auth/auth-user';
import { ApprovalsService } from '../../../common/approvals/approvals.service';
import { AuditService } from '../../../common/audit/audit.service';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { toDocDate } from '../../../common/utils/dates';
import { D, money } from '../../../common/utils/money';
import { settleForeign } from '../../../common/utils/fx';
import { FxService } from '../../fx/fx.service';
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
    private readonly fx: FxService,
    private readonly approvals: ApprovalsService,
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
  async create(user: AuthUser, dto: CreatePaymentDto, opts: { approved?: boolean } = {}) {
    const date = toDocDate(dto.date);
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah pembayaran harus > 0');
    // Pemisahan fungsi (bila dinyalakan): pembayaran atas faktur yang dibuat orang yang sama menunggu persetujuan Pemilik/Admin
    if (!opts.approved && !this.approvals.isApprover(user.role) && (await this.approvals.policy(this.db, user.tenantId)).salesSeparateDuties) {
      const creator = await this.approvals.invoiceCreator(this.db, user.tenantId, dto.invoiceId);
      if (creator && creator === user.sub) {
        const [inv] = await this.db.select({ n: invoices.number }).from(invoices).where(and(eq(invoices.id, dto.invoiceId), eq(invoices.tenantId, user.tenantId)));
        const req = await this.approvals.create(this.db, user, { kind: 'CUSTOMER_PAYMENT', refId: null, title: `Pembayaran faktur ${inv?.n ?? ''} oleh pembuat fakturnya`, amount: Number(dto.amount), payload: JSON.parse(JSON.stringify(dto)) });
        throw this.approvals.required(req.id, 'Pembayaran atas faktur yang Anda buat sendiri menunggu persetujuan pemilik atau admin (pemisahan fungsi); permintaan dikirim dan pembayaran dicatat setelah disetujui.');
      }
    }

    return this.db.transaction(async (tx) => {
      // Kunci faktur agar dua pembayaran bersamaan tidak melebihi sisa tagihan
      const locked = await tx.execute(sql`
        SELECT id FROM invoices WHERE id = ${dto.invoiceId} AND tenant_id = ${user.tenantId} FOR UPDATE`);
      if (!locked.rows.length) throw new NotFoundException('Faktur tidak ditemukan');
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, dto.invoiceId));
      const [customer] = await tx.select().from(customers).where(eq(customers.id, inv.customerId));

      const outstanding = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
      const foreign = inv.currency !== 'IDR';
      // Faktur valas: `amount` dalam mata uang faktur; nilai piutang yang dilunasi memakai kurs faktur, kas memakai kurs hari bayar
      const outstandingForeign = foreign ? D(inv.totalForeign ?? 0).minus(inv.paidForeign).minus(inv.returnedForeign) : outstanding;
      if (amount.gt(outstandingForeign)) {
        throw new BadRequestException(`Pembayaran ${amount.toFixed(2)}${foreign ? ` ${inv.currency}` : ''} melebihi sisa tagihan ${outstandingForeign.toFixed(2)}${foreign ? ` ${inv.currency}` : ''}`);
      }
      const payRate = foreign ? (await this.fx.resolve(tx, user.tenantId, inv.currency, date, dto.fxRate)).rate : D(1);
      const settle = foreign ? settleForeign({ amountForeign: amount, outstandingForeign, outstandingIdr: outstanding, invoiceRate: inv.fxRate, payRate }) : null;
      const carrying = settle ? settle.carrying : amount;
      const cash = settle ? settle.cash : amount;
      const diff = settle ? settle.diff : D(0);

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
          amount: carrying.toFixed(2),
          currency: inv.currency,
          amountForeign: foreign ? amount.toFixed(2) : null,
          fxRate: foreign ? payRate.toFixed(6) : null,
          cashAmount: foreign ? cash.toFixed(2) : null,
          fxGainLoss: diff.toFixed(2),
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
          { accountId: cashAccount.id, debit: cash, memo: foreign ? `${amount.toFixed(2)} ${inv.currency} @ ${payRate.toFixed(2)}` : undefined },
          { key: SYS.AR, credit: carrying, memo: foreign ? `Faktur ${inv.currency} @ ${D(inv.fxRate).toFixed(2)}` : undefined },
          // kas diterima lebih besar dari nilai piutang tercatat = laba kurs terealisasi; lebih kecil = rugi
          { key: SYS.FX_GAIN, credit: diff.gt(0) ? diff : 0 },
          { key: SYS.FX_LOSS, debit: diff.lt(0) ? diff.abs() : 0 },
        ],
      });

      const paid = D(inv.paidAmount).plus(carrying);
      await tx
        .update(invoices)
        .set({ paidForeign: foreign ? D(inv.paidForeign).plus(amount).toFixed(2) : inv.paidForeign, paidAmount: paid.toFixed(2), status: paid.plus(inv.returnedAmount).gte(inv.total) ? 'PAID' : 'PARTIAL' })
        .where(eq(invoices.id, inv.id));
      await tx.update(payments).set({ journalId: journal.id }).where(eq(payments.id, payment.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'Payment', entityId: payment.id });

      return { ...payment, journalId: journal.id, journalNumber: journal.number };
    });
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuthUser } from '../../../common/auth/auth-user';
import { ApprovalsService } from '../../../common/approvals/approvals.service';
import { AuditService } from '../../../common/audit/audit.service';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { diffDays, todayJakarta, toDocDate } from '../../../common/utils/dates';
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
  async create(user: AuthUser, dto: CreatePaymentDto, opts: { approved?: boolean; inTx?: (tx: Parameters<Parameters<Db['transaction']>[0]>[0], payment: { id: string; number: string; amount: string }) => Promise<void> } = {}) {
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
      // pekerjaan tambahan milik pemanggil (mis. catatan penerimaan loket) ikut transaksi: sama-sama tersimpan atau sama-sama batal
      await opts.inTx?.(tx, { id: payment.id, number: payment.number, amount: payment.amount });

      return { ...payment, journalId: journal.id, journalNumber: journal.number };
    });
  }

  /**
   * Hapus piutang (write-off): Dr Cadangan kerugian piutang (sebatas saldonya, sisanya Dr Beban kerugian piutang) | Cr Piutang usaha.
   * Dicatat sebagai pelunasan bermetode WRITE_OFF tanpa kas, sehingga sisa tagihan di semua laporan ikut berkurang.
   * Syarat: lewat jatuh tempo ≥ 90 hari (kecuali Pemilik), alasan wajib; selain Pemilik/Admin harus disetujui; Pemilik diberi tahu.
   */
  async writeOff(user: AuthUser, dto: { invoiceId: string; amount?: string; reason: string; date?: string }, opts: { approved?: boolean } = {}) {
    const date = toDocDate(dto.date);
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 5) throw new BadRequestException('Isi alasan penghapusan piutang (minimal 5 huruf)');
    const [pre] = await this.db.select().from(invoices).where(and(eq(invoices.id, dto.invoiceId), eq(invoices.tenantId, user.tenantId)));
    if (!pre) throw new NotFoundException('Faktur tidak ditemukan');
    if (pre.currency !== 'IDR') throw new BadRequestException('Penghapusan piutang faktur valas belum didukung; lunasi/koreksi lewat retur atau jurnal.');
    if (user.role !== 'OWNER' && diffDays(pre.dueDate, todayJakarta()) < 90) throw new BadRequestException('Piutang baru bisa dihapus bila sudah lewat jatuh tempo minimal 90 hari.');
    if (!opts.approved && !this.approvals.isApprover(user.role)) {
      const req = await this.approvals.create(this.db, user, { kind: 'AR_WRITE_OFF', refId: null, title: `Hapus piutang faktur ${pre.number}`, amount: Number(dto.amount ?? D(pre.total).minus(pre.paidAmount).minus(pre.returnedAmount).toFixed(2)), payload: JSON.parse(JSON.stringify(dto)) });
      throw this.approvals.required(req.id, 'Penghapusan piutang menunggu persetujuan pemilik atau admin; permintaan dikirim dan piutang dihapus setelah disetujui.');
    }
    const res = await this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`SELECT id FROM invoices WHERE id = ${dto.invoiceId} AND tenant_id = ${user.tenantId} FOR UPDATE`);
      if (!locked.rows.length) throw new NotFoundException('Faktur tidak ditemukan');
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, dto.invoiceId));
      const [customer] = await tx.select().from(customers).where(eq(customers.id, inv.customerId));
      const outstanding = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
      if (outstanding.lte(0)) throw new BadRequestException('Faktur ini tidak punya sisa tagihan');
      const amount = dto.amount ? money(dto.amount) : outstanding;
      if (amount.lte(0) || amount.gt(outstanding)) throw new BadRequestException(`Jumlah penghapusan harus > 0 dan tidak melebihi sisa tagihan ${outstanding.toFixed(2)}`);

      const allow = (await tx.execute<{ id: string; bal: string }>(sql`
        SELECT a.id::text, COALESCE((SELECT SUM(l.credit - l.debit) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id WHERE l.account_id = a.id AND j.tenant_id = ${user.tenantId}), 0)::text AS bal
        FROM accounts a WHERE a.tenant_id = ${user.tenantId} AND a.report_group = 'ALLOWANCE_RECEIVABLE' ORDER BY a.code LIMIT 1`)).rows[0];
      const useAllow = allow ? D(allow.bal).gt(0) ? (D(allow.bal).lt(amount) ? D(allow.bal) : amount) : D(0) : D(0);
      const rest = amount.minus(useAllow);
      let expenseId: string | null = null;
      if (rest.gt(0)) {
        const e = (await tx.execute<{ id: string }>(sql`SELECT id::text FROM accounts WHERE tenant_id = ${user.tenantId} AND code = '6-7300' LIMIT 1`)).rows[0];
        if (!e) throw new BadRequestException('Akun "Beban Kerugian Penurunan Nilai Piutang" (6-7300) belum ada di bagan akun; tambahkan dulu atau buat cadangan kerugian piutang.');
        expenseId = e.id;
      }
      const number = await this.seq.next(tx, user.tenantId, 'PAYMENT', date);
      const [payment] = await tx.insert(payments).values({ tenantId: user.tenantId, number, date, customerId: inv.customerId, invoiceId: inv.id, amount: amount.toFixed(2), method: 'WRITE_OFF', notes: `Hapus piutang: ${reason}` }).returning();
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Hapus piutang ${inv.number} - ${customer.name} (${number})`,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
        createdById: user.sub,
        lines: [
          ...(useAllow.gt(0) ? [{ accountId: allow.id, debit: useAllow, memo: 'Dipakai dari cadangan kerugian piutang' }] : []),
          ...(expenseId ? [{ accountId: expenseId, debit: rest, memo: 'Melebihi cadangan' }] : []),
          { key: SYS.AR, credit: amount },
        ],
      });
      const paid = D(inv.paidAmount).plus(amount);
      await tx.update(invoices).set({ paidAmount: paid.toFixed(2), status: paid.plus(inv.returnedAmount).gte(inv.total) ? 'PAID' : 'PARTIAL' }).where(eq(invoices.id, inv.id));
      await tx.update(payments).set({ journalId: journal.id }).where(eq(payments.id, payment.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'ReceivableWriteOff', entityId: payment.id, data: { invoice: inv.number, amount: amount.toFixed(2), reason } });
      return { ...payment, journalId: journal.id, journalNumber: journal.number, invoiceNumber: inv.number, customerName: customer.name, amount: amount.toFixed(2) };
    });
    void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER'], excludeUserId: user.sub, info: true, title: `Piutang dihapus: ${res.invoiceNumber} ${res.customerName} Rp${Math.round(Number(res.amount)).toLocaleString('id-ID')}`, lines: [`Alasan: ${reason}`], path: '/invoices' });
    return res;
  }
}

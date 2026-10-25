import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuthUser } from '../../common/auth/auth-user';
import { WorkflowService } from '../workflow/workflow.service';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { assertNotFuture, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { settleForeign } from '../../common/utils/fx';
import { FxService } from '../fx/fx.service';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { purchaseInvoices, supplierPayments } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { CreateSupplierPaymentDto } from './purchasing.dto';
import { PurchaseInvoiceRepository } from './purchase-invoice.repository';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { insertOne, patchById } from '../../db/owned';
import { SupplierPaymentsRepository } from './supplier-payments.repository';

@Injectable()
export class SupplierPaymentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly workflow: WorkflowService,
    private readonly fx: FxService,
    private readonly repo: PurchaseInvoiceRepository,
    private readonly invoices: PurchaseInvoicesService,
    private readonly queries: SupplierPaymentsRepository,
  ) {}

  /** Pembayaran hutang: Dr Hutang Usaha | Cr Kas/Bank */
  async pay(user: AuthUser, dto: CreateSupplierPaymentDto, opts: { approved?: boolean } = {}) {
    const date = toDocDate(dto.date);
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah pembayaran harus > 0');
    assertNotFuture(date, 'Tanggal pembayaran');
    await this.workflow.gate(user.tenantId, 'PAY_SUPPLIER', dto.purchaseInvoiceId);
    // Pemisahan fungsi: pembayaran besar oleh peran selain pemilik/admin menunggu persetujuan (batas sama dengan kas keluar)
    if (!opts.approved) {
      const limit = await this.approvals.needs(this.db, user, 'SUPPLIER_PAYMENT', amount.toNumber());
      if (limit !== null) {
        const [inv] = await this.queries.findPurchaseInvoicesById(this.db, dto.purchaseInvoiceId, user.tenantId);
        if (!inv) throw new NotFoundException('Faktur pembelian tidak ditemukan');
        const req = await this.approvals.create(this.db, user, {
          kind: 'SUPPLIER_PAYMENT',
          refId: null,
          title: `Pembayaran faktur supplier ${inv.n}`,
          amount: amount.toNumber(),
          payload: JSON.parse(JSON.stringify(dto)),
        });
        throw this.approvals.required(
          req.id,
          'Nilai pembayaran mencapai batas persetujuan; permintaan dikirim ke pemilik atau admin dan dibayar setelah disetujui.',
        );
      }
    }

    // Rekening supplier baru diubah: pembayaran oleh staf ditahan untuk persetujuan beberapa hari (anti pengalihan pembayaran)
    if (!opts.approved && !this.approvals.isApprover(user.role)) {
      const hold = (await this.approvals.policy(this.db, user.tenantId)).bankChangeHoldDays;
      if (hold > 0) {
        const r = (
          await this.queries.queryPurchaseInvoice(this.db, dto.purchaseInvoiceId, user.tenantId, hold)
        ).rows[0];
        if (r) {
          const req = await this.approvals.create(this.db, user, {
            kind: 'SUPPLIER_PAYMENT',
            refId: null,
            title: `Pembayaran ke supplier ${r.code} (rekening baru diubah ≤ ${hold} hari) — faktur ${r.no}`,
            amount: amount.toNumber(),
            payload: JSON.parse(JSON.stringify(dto)),
          });
          throw this.approvals.required(
            req.id,
            `Rekening supplier ini baru diubah (dalam ${hold} hari terakhir); pembayaran menunggu persetujuan pemilik atau admin.`,
          );
        }
      }
    }

    // Pembayaran pertama ke supplier (belum pernah dibayar sama sekali) oleh staf: wajib disetujui bila kebijakan menyalakannya
    if (
      !opts.approved &&
      !this.approvals.isApprover(user.role) &&
      (await this.approvals.policy(this.db, user.tenantId)).firstSupplierPayment
    ) {
      const first = await this.queries.queryPurchaseInvoiceForPay(this.db, user.tenantId, dto.purchaseInvoiceId);
      if (first.rows[0] && first.rows[0].n === 0) {
        const req = await this.approvals.create(this.db, user, {
          kind: 'SUPPLIER_PAYMENT',
          refId: null,
          title: `Pembayaran PERTAMA ke supplier baru — faktur ${first.rows[0].no}`,
          amount: amount.toNumber(),
          payload: JSON.parse(JSON.stringify(dto)),
        });
        throw this.approvals.required(
          req.id,
          'Ini pembayaran pertama ke supplier tersebut; permintaan dikirim ke pemilik atau admin dan dibayar setelah disetujui.',
        );
      }
    }

    return this.db.transaction(async (tx) => {
      const locked = await this.queries.queryPurchaseInvoiceForPay2(tx, dto.purchaseInvoiceId, user.tenantId);
      if (!locked.rows.length) throw new NotFoundException('Faktur pembelian tidak ditemukan');
      const inv = await this.repo.invoiceById(tx, dto.purchaseInvoiceId);
      const supplier = await this.repo.supplierById(tx, inv.supplierId);

      const outstanding = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
      const foreign = inv.currency !== 'IDR';
      // Faktur valas: `amount` dalam mata uang faktur; hutang berkurang pada kurs faktur, kas keluar pada kurs hari bayar
      const outstandingForeign = foreign
        ? D(inv.totalForeign ?? 0)
            .minus(inv.paidForeign)
            .minus(inv.returnedForeign)
        : outstanding;
      const cur = foreign ? ` ${inv.currency}` : '';
      if (amount.gt(outstandingForeign)) {
        throw new BadRequestException(
          `Pembayaran ${amount.toFixed(2)}${cur} melebihi sisa hutang ${outstandingForeign.toFixed(2)}${cur}`,
        );
      }
      const payRate = foreign ? (await this.fx.resolve(tx, user.tenantId, inv.currency, date, dto.fxRate)).rate : D(1);
      const settle = foreign
        ? settleForeign({
            amountForeign: amount,
            outstandingForeign,
            outstandingIdr: outstanding,
            invoiceRate: inv.fxRate,
            payRate,
          })
        : null;
      const carrying = settle ? settle.carrying : amount;
      const cashOut = settle ? settle.cash : amount;
      const diff = settle ? settle.diff : D(0);
      const cash = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK');
      await this.posting.assertCashCovers(tx, user.tenantId, cash, cashOut);
      const number = await this.seq.next(tx, user.tenantId, 'SUPPLIER_PAYMENT', date);
      const payment = await insertOne(tx, supplierPayments, {
          tenantId: user.tenantId,
          number,
          date,
          supplierId: inv.supplierId,
          purchaseInvoiceId: inv.id,
          amount: carrying.toFixed(2),
          currency: inv.currency,
          amountForeign: foreign ? amount.toFixed(2) : null,
          fxRate: foreign ? payRate.toFixed(6) : null,
          cashAmount: foreign ? cashOut.toFixed(2) : null,
          fxGainLoss: diff.negated().toFixed(2),
          cashAccountId: cash.id,
          notes: dto.notes,
        });

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Bayar hutang ${inv.number} - ${supplier.name} (${number})`,
        sourceType: 'SUPPLIER_PAYMENT',
        sourceId: payment.id,
        createdById: user.sub,
        lines: [
          {
            key: SYS.AP,
            debit: carrying,
            memo: foreign ? `Faktur ${inv.currency} @ ${D(inv.fxRate).toFixed(2)}` : undefined,
          },
          {
            accountId: cash.id,
            credit: cashOut,
            memo: foreign ? `${amount.toFixed(2)} ${inv.currency} @ ${payRate.toFixed(2)}` : undefined,
          },
          // bayar lebih banyak Rupiah dari nilai hutang tercatat = rugi kurs terealisasi; lebih sedikit = laba
          { key: SYS.FX_LOSS, debit: diff.gt(0) ? diff : 0 },
          { key: SYS.FX_GAIN, credit: diff.lt(0) ? diff.abs() : 0 },
        ],
      });

      const paid = D(inv.paidAmount).plus(carrying);
      await patchById(tx, purchaseInvoices, inv.id, {
          paidForeign: foreign ? D(inv.paidForeign).plus(amount).toFixed(2) : inv.paidForeign,
          paidAmount: paid.toFixed(2),
          status: paid.plus(inv.returnedAmount).gte(inv.total) ? 'PAID' : 'PARTIAL',
        });
      await patchById(tx, supplierPayments, payment.id, { journalId: journal.id });
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'SupplierPayment',
        entityId: payment.id,
      });
      return { ...payment, journalNumber: journal.number };
    });
  }

  /** Batalkan pembayaran supplier yang salah: jurnal dibalik, hutang faktur kembali terbuka; pembayaran tidak dihapus */
  async voidPayment(user: AuthUser, id: string, reasonInput: string) {
    const reason = reasonInput?.trim() ?? '';
    if (reason.length < 5) throw new BadRequestException('Alasan pembatalan wajib diisi (minimal 5 karakter)');
    return this.db.transaction(async (tx) => {
      const [p0] = await this.queries.findSupplierPaymentsById(tx, id, user.tenantId);
      if (!p0) throw new NotFoundException('Pembayaran tidak ditemukan');
      // urutan kunci sama dengan pay(): faktur dulu, lalu pembayaran
      await this.queries.queryPurchaseInvoiceForVoidPayment(tx, p0.invoiceId, user.tenantId);
      await this.queries.querySupplierPayment(tx, id, user.tenantId);
      const p = await this.repo.paymentById(tx, id);
      if (p.status === 'VOID') throw new BadRequestException('Pembayaran ini sudah dibatalkan');
      if (!p.journalId) throw new BadRequestException('Pembayaran belum punya jurnal');
      const matched = await this.queries.queryVoidPayment(tx, p.journalId);
      if (matched.rows[0].n > 0)
        throw new BadRequestException(
          'Pembayaran ini sudah dicocokkan dengan mutasi bank. Batalkan pencocokannya di Rekonsiliasi Bank dulu',
        );
      const rev = await this.posting.reverse(tx, user.tenantId, p.journalId, todayJakarta(), user.sub, true);
      const inv = await this.repo.invoiceById(tx, p.purchaseInvoiceId);
      const paid = D(inv.paidAmount).minus(p.amount);
      const foreign = inv.currency !== 'IDR';
      await patchById(tx, purchaseInvoices, inv.id, {
          paidAmount: paid.toFixed(2),
          paidForeign: foreign
            ? D(inv.paidForeign)
                .minus(p.amountForeign ?? 0)
                .toFixed(2)
            : inv.paidForeign,
          status: paid.lte(0) ? 'UNPAID' : paid.plus(inv.returnedAmount).gte(inv.total) ? 'PAID' : 'PARTIAL',
        });
      await patchById(tx, supplierPayments, id, { status: 'VOID', voidedAt: new Date(), voidedById: user.sub, voidReason: reason, voidJournalId: rev.id });
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'VOID',
        entity: 'SupplierPayment',
        entityId: id,
        data: { number: p.number, amount: p.amount, reason },
      });
      return { id, number: p.number, status: 'VOID', reversalJournal: rev.number };
    });
  }
}

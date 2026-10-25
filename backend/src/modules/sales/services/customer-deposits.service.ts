import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { type CustomerDeposit } from '@sansu/shared';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { outputVatRate } from '../../../common/settings.service';
import { toDocDate } from '../../../common/utils/dates';
import { D, money } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { customerDeposits, customers, depositApplications, invoices, projects, tenants } from '../../../db/schema';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';
import { CreateDepositDto, ApplyDepositDto } from './service-billing.dto';
import { ReferenceRepository } from '../../../db/reference.repository';
import { ServiceBillingService, outstandingOf } from './service-billing.service';
import { findOwned } from '../../../db/owned';

@Injectable()
export class CustomerDepositsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly refs: ReferenceRepository,
    private readonly billing: ServiceBillingService,
  ) {}

  // ================= Uang muka pelanggan =================

  async listDeposits(
    tenantId: string,
    q: { customerId?: string; projectId?: string; open?: boolean } = {},
  ): Promise<CustomerDeposit[]> {
    const rows = await this.db.query.customerDeposits.findMany({
      where: and(
        eq(customerDeposits.tenantId, tenantId),
        q.customerId ? eq(customerDeposits.customerId, q.customerId) : undefined,
        q.projectId ? eq(customerDeposits.projectId, q.projectId) : undefined,
        q.open ? sql`${customerDeposits.amount} > ${customerDeposits.appliedAmount}` : undefined,
      ),
      orderBy: [desc(customerDeposits.date), desc(customerDeposits.number)],
      limit: 500,
    });
    if (!rows.length) return [];
    const custs = await this.db
      .select({ id: customers.id, code: customers.code, name: customers.name })
      .from(customers)
      .where(inArray(customers.id, [...new Set(rows.map((r) => r.customerId))]));
    const projIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
    const projs = projIds.length
      ? await this.db
          .select({ id: projects.id, code: projects.code, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projIds))
      : [];
    const apps = await this.db
      .select({
        id: depositApplications.id,
        depositId: depositApplications.depositId,
        date: depositApplications.date,
        amount: depositApplications.amount,
        invoiceId: invoices.id,
        invoiceNumber: invoices.number,
      })
      .from(depositApplications)
      .innerJoin(invoices, eq(invoices.id, depositApplications.invoiceId))
      .where(
        inArray(
          depositApplications.depositId,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((r) => {
      const c = custs.find((x) => x.id === r.customerId)!;
      const p = projs.find((x) => x.id === r.projectId);
      return {
        id: r.id,
        number: r.number,
        date: r.date,
        customerId: r.customerId,
        customer: { code: c.code, name: c.name },
        projectId: r.projectId,
        project: p ? { code: p.code, name: p.name } : null,
        method: r.method,
        amount: r.amount,
        dpp: r.dpp,
        taxAmount: r.taxAmount,
        appliedAmount: r.appliedAmount,
        remaining: D(r.amount).minus(r.appliedAmount).toFixed(2),
        description: r.description,
        applications: apps
          .filter((a) => a.depositId === r.id)
          .map((a) => ({
            id: a.id,
            date: a.date,
            amount: a.amount,
            invoice: { id: a.invoiceId, number: a.invoiceNumber },
          })),
      };
    });
  }

  /** Terima uang muka: Dr Kas/Bank | Cr Uang Muka Pelanggan (DPP), Cr PPN Keluaran (PPN uang muka) */
  async createDeposit(user: AuthUser, dto: CreateDepositDto) {
    const date = toDocDate(dto.date);
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah uang muka harus > 0');
    return this.db.transaction(async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId));
      const customer = await this.refs.customer(tx, user.tenantId, dto.customerId);
      if (!customer) throw new BadRequestException('Pelanggan tidak ditemukan');
      if (dto.projectId) {
        const p = await findOwned(tx, projects, user.tenantId, dto.projectId);
        if (!p || p.customerId !== customer.id)
          throw new BadRequestException('Proyek tidak ditemukan untuk pelanggan ini');
      }
      const rate = D(dto.withVat === false ? '0' : outputVatRate(tenant));
      const dpp = rate.gt(0) ? money(amount.times(100).div(D(100).plus(rate))) : amount;
      const tax = amount.minus(dpp);
      const method = dto.method ?? 'TRANSFER';
      const cash = await this.posting.resolveCashAccount(
        tx,
        user.tenantId,
        dto.cashAccountId,
        method === 'CASH' ? 'CASH' : 'BANK',
      );
      const number = await this.seq.next(tx, user.tenantId, 'CUSTOMER_DEPOSIT', date);
      const [d] = await tx
        .insert(customerDeposits)
        .values({
          tenantId: user.tenantId,
          number,
          date,
          customerId: customer.id,
          projectId: dto.projectId,
          method,
          cashAccountId: cash.id,
          amount: amount.toFixed(2),
          dpp: dpp.toFixed(2),
          taxAmount: tax.toFixed(2),
          description: dto.description,
          createdById: user.sub,
        })
        .returning();
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Uang muka ${number} - ${customer.name}${dto.description ? ` · ${dto.description}` : ''}`.slice(
          0,
          500,
        ),
        sourceType: 'CUSTOMER_DEPOSIT',
        sourceId: d.id,
        createdById: user.sub,
        lines: [
          { accountId: cash.id, debit: amount },
          { key: SYS.CUSTOMER_DEPOSIT, credit: dpp },
          { key: SYS.VAT_OUT, credit: tax, memo: tax.gt(0) ? 'PPN atas uang muka' : undefined },
        ],
      });
      await tx.update(customerDeposits).set({ journalId: journal.id }).where(eq(customerDeposits.id, d.id));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'CustomerDeposit',
        entityId: d.id,
        data: { number, amount: amount.toFixed(2) },
      });
      return { ...d, journalNumber: journal.number };
    });
  }

  /** Pakai uang muka untuk melunasi faktur: Dr Uang Muka Pelanggan (DPP), Dr PPN Keluaran (PPN uang muka) | Cr Piutang */
  async applyDeposit(user: AuthUser, id: string, dto: ApplyDepositDto) {
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const lockD = await tx.execute(
        sql`SELECT id FROM customer_deposits WHERE id = ${id} AND tenant_id = ${user.tenantId} FOR UPDATE`,
      );
      if (!lockD.rows.length) throw new NotFoundException('Uang muka tidak ditemukan');
      const lockI = await tx.execute(
        sql`SELECT id FROM invoices WHERE id = ${dto.invoiceId} AND tenant_id = ${user.tenantId} FOR UPDATE`,
      );
      if (!lockI.rows.length) throw new NotFoundException('Faktur tidak ditemukan');
      const [d] = await tx.select().from(customerDeposits).where(eq(customerDeposits.id, id));
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, dto.invoiceId));
      if (inv.customerId !== d.customerId)
        throw new BadRequestException('Uang muka dan faktur harus dari pelanggan yang sama');
      if (inv.isOpening) throw new BadRequestException('Uang muka tidak bisa dipakai untuk faktur saldo awal');
      if (inv.currency !== 'IDR')
        throw new BadRequestException(`Faktur dalam ${inv.currency}: uang muka rupiah belum bisa dipakai melunasinya`);
      if (D(d.taxAmount).gt(0) && D(inv.taxAmount).lte(0))
        throw new BadRequestException('Uang muka ber-PPN hanya bisa dipakai untuk faktur ber-PPN');
      if (date < d.date || date < inv.date)
        throw new BadRequestException('Tanggal pemakaian tidak boleh sebelum tanggal uang muka / faktur');

      const remaining = D(d.amount).minus(d.appliedAmount);
      const outstanding = outstandingOf(inv);
      const max = remaining.lt(outstanding) ? remaining : outstanding;
      if (max.lte(0))
        throw new BadRequestException(remaining.lte(0) ? 'Uang muka sudah habis dipakai' : 'Faktur sudah lunas');
      const amount = dto.amount ? money(dto.amount) : max;
      if (amount.lte(0)) throw new BadRequestException('Jumlah harus > 0');
      if (amount.gt(max))
        throw new BadRequestException(
          `Paling banyak ${max.toFixed(2)} (sisa uang muka ${remaining.toFixed(2)}, sisa tagihan ${outstanding.toFixed(2)})`,
        );

      // Bagian DPP & PPN dari uang muka; pemakaian terakhir mengambil sisanya agar tidak ada sisa pembulatan
      const [used] = (
        await tx.execute<{ dpp: string; tax: string }>(sql`
          SELECT COALESCE(SUM(dpp), 0) AS dpp, COALESCE(SUM(tax_amount), 0) AS tax FROM deposit_applications WHERE deposit_id = ${id}`)
      ).rows;
      const dppShare = amount.eq(remaining) ? D(d.dpp).minus(used.dpp) : money(amount.times(d.dpp).div(d.amount));
      const taxShare = amount.minus(dppShare);

      const number = await this.seq.next(tx, user.tenantId, 'DEPOSIT_APPLICATION', date);
      const [app] = await tx
        .insert(depositApplications)
        .values({
          tenantId: user.tenantId,
          number,
          depositId: d.id,
          invoiceId: inv.id,
          date,
          amount: amount.toFixed(2),
          dpp: dppShare.toFixed(2),
          taxAmount: taxShare.toFixed(2),
        })
        .returning();
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pemakaian uang muka ${d.number} untuk ${inv.number}`,
        sourceType: 'DEPOSIT_APPLICATION',
        sourceId: app.id,
        createdById: user.sub,
        lines: [
          { key: SYS.CUSTOMER_DEPOSIT, debit: dppShare },
          {
            key: SYS.VAT_OUT,
            debit: taxShare,
            memo: taxShare.gt(0) ? 'PPN uang muka sudah dipungut saat DP diterima' : undefined,
          },
          { key: SYS.AR, credit: amount },
        ],
      });
      await tx.update(depositApplications).set({ journalId: journal.id }).where(eq(depositApplications.id, app.id));
      await tx
        .update(customerDeposits)
        .set({ appliedAmount: D(d.appliedAmount).plus(amount).toFixed(2) })
        .where(eq(customerDeposits.id, d.id));
      const paid = D(inv.paidAmount).plus(amount);
      await tx
        .update(invoices)
        .set({
          paidAmount: paid.toFixed(2),
          depositApplied: D(inv.depositApplied).plus(amount).toFixed(2),
          status: paid.plus(inv.returnedAmount).gte(inv.total) ? 'PAID' : 'PARTIAL',
        })
        .where(eq(invoices.id, inv.id));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'APPLY',
        entity: 'CustomerDeposit',
        entityId: d.id,
        data: { invoice: inv.number, amount: amount.toFixed(2) },
      });
      return { id: app.id, number, amount: amount.toFixed(2), journalNumber: journal.number };
    });
  }
}

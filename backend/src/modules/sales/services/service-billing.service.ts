import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { type CustomerDeposit, type Project, type WithheldByCustomerReport } from '@sansu/shared';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { outputVatRate, taxProfileOf } from '../../../common/settings.service';
import { addDays, toDocDate } from '../../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../../common/utils/money';
import { Db, Tx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { accounts, customerDeposits, customers, depositApplications, invoices, projectProgress, projects, serviceInvoiceLines, tenants } from '../../../db/schema';
import { frameworkOf } from '../../accounting/coa-sync';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';
import { documentTotals, inclusiveDocument } from '../pricing';
import { projectCostsSql } from './project-costs';
import { decryptField } from '../../../common/utils/secret';
import { CreateServiceInvoiceDto, WithholdingSlipDto, ProjectProgressDto, CreateProjectDto, UpdateProjectDto, CreateDepositDto, ApplyDepositDto } from './service-billing.dto';
import { ReferenceRepository } from '../../../db/reference.repository';
import { findOwned, insertOne, patchById } from '../../../db/owned';
import { ServiceBillingRepository } from './service-billing.repository';

export const outstandingOf = (i: { total: string; paidAmount: string; returnedAmount: string }) =>
  D(i.total).minus(i.paidAmount).minus(i.returnedAmount);

@Injectable()
export class ServiceBillingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly refs: ReferenceRepository,
    private readonly repo: ServiceBillingRepository,
  ) {}

  async keyAccount(tx: Tx | Db, tenantId: string, key: string) {
    const [a] = await this.repo.findAccountsBySystemKey(tx, tenantId, key);
    if (!a)
      throw new BadRequestException(`Akun ${key} belum tersedia — jalankan ulang aplikasi agar bagan akun diperbarui`);
    return a.id;
  }

  // ================= Faktur jasa =================

  async createInvoice(user: AuthUser, dto: CreateServiceInvoiceDto, opts: { inTx?: (tx: Tx, invoice: { id: string; number: string }) => Promise<void> } = {}) {
    const date = toDocDate(dto.date);
    const result = await this.db.transaction(async (tx) => {
      const [tenant] = await this.repo.findTenantsById(tx, user.tenantId);
      const customer = await this.refs.customer(tx, user.tenantId, dto.customerId);
      if (!customer || !customer.isActive) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');

      // PPh dipotong pelanggan
      let whRate = ZERO;
      if (dto.withholdingType) {
        whRate = D(dto.withholdingRate ?? (dto.withholdingType === 'PPH23' ? '2' : '0'));
        if (whRate.lte(0) || whRate.gt(30))
          throw new BadRequestException('Tarif PPh yang dipotong harus di antara 0 dan 30%');
      }
      const defaultKey =
        dto.withholdingType === 'PPH4_2'
          ? whRate.eq(10)
            ? SYS.RENTAL_REVENUE
            : SYS.CONSTRUCTION_REVENUE
          : SYS.SERVICE_REVENUE;
      const defaultAccount = await this.keyAccount(tx, user.tenantId, defaultKey);

      const ids = [...new Set(dto.lines.map((l) => l.accountId).filter((x): x is string => !!x))];
      const accs = ids.length
        ? await this.repo.listAccountsById(tx, user.tenantId, ids)
        : [];
      for (const a of accs)
        if (a.type !== 'REVENUE' || !a.isPostable)
          throw new BadRequestException(`Akun ${a.code} bukan akun pendapatan`);
      if (accs.length !== ids.length) throw new BadRequestException('Ada akun pendapatan yang tidak ditemukan');

      const raw = dto.lines.map((l) => {
        const qty = D(l.qty ?? '1');
        const price = money(l.price);
        if (qty.lte(0) || price.lte(0)) throw new BadRequestException(`Jumlah & harga "${l.description}" harus > 0`);
        return { ...l, qty: qty.toString(), price, discountPct: '0', accountId: l.accountId ?? defaultAccount };
      });
      const rate = dto.withVat === false ? '0' : outputVatRate(tenant);
      const inclusive = !!dto.pricesIncludeVat && D(rate).gt(0);
      const doc = inclusive
        ? inclusiveDocument(raw, rate)
        : {
            lines: raw.map((l) => ({ ...l, lineTotal: money(D(l.qty).times(l.price)) })),
            ...documentTotals(raw, rate, taxProfileOf(tenant.settings).vatRounding),
          };

      // Proyek: tagihan tidak boleh melebihi nilai kontrak
      if (dto.projectId) {
        const p = await findOwned(tx, projects, user.tenantId, dto.projectId);
        if (!p) throw new BadRequestException('Proyek tidak ditemukan');
        if (p.customerId !== customer.id) throw new BadRequestException('Proyek ini milik pelanggan lain');
        if (p.status !== 'ACTIVE') throw new BadRequestException('Proyek sudah selesai / dibatalkan');
        const [b] = (
          await this.repo.queryInvoice(tx, p.id, user.tenantId)
        ).rows;
        const after = D(b.v).plus(doc.subtotal);
        if (D(p.contractValue).gt(0) && after.gt(p.contractValue)) {
          throw new BadRequestException(
            `Total tagihan proyek (${after.toFixed(2)}) melebihi nilai kontrak ${D(p.contractValue).toFixed(2)}. Ubah nilai kontrak bila ada addendum.`,
          );
        }
      }

      const withholding = money(doc.subtotal.times(whRate).div(100));
      const number = await this.seq.next(tx, user.tenantId, 'INVOICE', date);
      const invoice = await insertOne(tx, invoices, {
          tenantId: user.tenantId,
          number,
          kind: 'SERVICE',
          date,
          dueDate: dto.dueDate ? toDocDate(dto.dueDate) : addDays(date, customer.paymentTermDays),
          customerId: customer.id,
          description: dto.description,
          projectId: dto.projectId,
          termLabel: dto.termLabel,
          subtotal: doc.subtotal.toFixed(2),
          taxAmount: doc.taxAmount.toFixed(2),
          total: doc.total.toFixed(2),
          withholdingType: withholding.gt(0) ? dto.withholdingType : null,
          withholdingRate: withholding.gt(0) ? whRate.toFixed(2) : null,
          withholdingBase: withholding.gt(0) ? doc.subtotal.toFixed(2) : '0',
          withholdingAmount: withholding.toFixed(2),
          // PPh yang dipotong pelanggan mengurangi piutang sejak faktur terbit
          paidAmount: withholding.toFixed(2),
        });
      await this.repo.insertServiceInvoiceLines(tx, doc.lines, invoice.id);

      const byAccount = new Map<string, Dec>();
      for (const l of doc.lines) byAccount.set(l.accountId, (byAccount.get(l.accountId) ?? ZERO).plus(l.lineTotal));
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description:
          `Faktur jasa ${number} - ${customer.name}${dto.termLabel ? ` · ${dto.termLabel}` : ''}${dto.description ? ` · ${dto.description}` : ''}`.slice(
            0,
            500,
          ),
        sourceType: 'INVOICE',
        sourceId: invoice.id,
        createdById: user.sub,
        lines: [
          { key: SYS.AR, debit: doc.total.minus(withholding) },
          {
            key: dto.withholdingType === 'PPH4_2' ? SYS.FINAL_TAX_WITHHELD : SYS.PREPAID_TAX,
            debit: withholding,
            memo: withholding.gt(0)
              ? `PPh ${dto.withholdingType === 'PPH23' ? '23' : '4(2) final'} ${whRate.toString()}% dipotong pelanggan`
              : undefined,
          },
          ...[...byAccount].map(([accountId, v]) => ({ accountId, credit: v })),
          { key: SYS.VAT_OUT, credit: doc.taxAmount },
        ],
      });
      await patchById(tx, invoices, invoice.id, { journalId: journal.id });
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'ServiceInvoice',
        entityId: invoice.id,
        data: { number, total: doc.total.toFixed(2), withholding: withholding.toFixed(2), journal: journal.number },
      });
      // pekerjaan tambahan milik pemanggil (mis. menandai catatan waktu tertagih) ikut transaksi: sama-sama tersimpan atau sama-sama batal
      await opts.inTx?.(tx, { id: invoice.id, number });
      return { id: invoice.id, number, journalNumber: journal.number };
    });
    return result;
  }

  async setSlip(user: AuthUser, id: string, dto: WithholdingSlipDto) {
    const inv = await findOwned(this.db, invoices, user.tenantId, id);
    if (!inv) throw new NotFoundException('Faktur tidak ditemukan');
    if (!inv.withholdingType) throw new BadRequestException('Faktur ini tidak dipotong PPh oleh pelanggan');
    const slipDate = toDocDate(dto.slipDate);
    if (slipDate < inv.date) throw new BadRequestException('Tanggal bukti potong tidak boleh sebelum tanggal faktur');
    await patchById(this.db, invoices, id, { withholdingSlipNo: dto.slipNo.trim(), withholdingSlipDate: slipDate });
    await this.audit.log(this.db, {
      tenantId: user.tenantId,
      userId: user.sub,
      action: 'UPDATE',
      entity: 'WithholdingSlip',
      entityId: id,
      data: dto,
    });
    return { ok: true };
  }

  /** Rekap PPh yang dipotong pelanggan (bahan kredit pajak & pencocokan bukti potong di Coretax) */
  async withheld(tenantId: string, period: string): Promise<WithheldByCustomerReport> {
    if (!/^\d{4}(-\d{2})?$/.test(period)) throw new BadRequestException('Periode harus YYYY atau YYYY-MM');
    const from = period.length === 4 ? `${period}-01-01` : `${period}-01`;
    const to = period.length === 4 ? `${period}-12-31` : addDays(`${addDays(`${period}-01`, 32).slice(0, 7)}-01`, -1);
    const rows = (
      await this.repo.queryInvoiceForWithheld(this.db, tenantId, from, to)
    ).rows;
    const totals = (['PPH23', 'PPH4_2'] as const)
      .map((type) => {
        const rs = rows.filter((r) => r.type === type);
        return {
          type,
          base: rs.reduce<Dec>((a, r) => a.plus(r.base), ZERO).toFixed(2),
          amount: rs.reduce<Dec>((a, r) => a.plus(r.amount), ZERO).toFixed(2),
          missingSlips: rs.filter((r) => !r.slip_no).length,
        };
      })
      .filter((t) => Number(t.amount) > 0);
    return {
      period,
      rows: rows.map((r) => ({
        invoiceId: r.id,
        number: r.number,
        date: r.date,
        customer: r.customer,
        customerNpwp: decryptField(r.npwp),
        type: r.type,
        rate: D(r.rate).toFixed(2),
        base: D(r.base).toFixed(2),
        amount: D(r.amount).toFixed(2),
        slipNo: r.slip_no,
        slipDate: r.slip_date,
      })),
      totals,
    };
  }
}

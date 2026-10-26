import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { UtilityService } from '../utility/utility.service';
import { AdjustmentsRepository } from './adjustments.repository';
import { DepositDto, DepositOffsetDto, DepositRefundDto } from './deposits.dto';
import { DepositsRepository } from './deposits.repository';
import { StaffRepository } from './staff.repository';

const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

/**
 * Jaminan (deposit) sambungan: uang diterima dicatat sebagai utang kepada pelanggan, bukan pendapatan. Dapat dipakai melunasi
 * tunggakan pelanggan itu (nilai pindah dari utang jaminan ke pelunasan piutang) atau dikembalikan bila tidak ada tunggakan.
 */
@Injectable()
export class DepositsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: DepositsRepository,
    private readonly invoices: AdjustmentsRepository,
    private readonly staff: StaffRepository,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly util: UtilityService,
  ) {}

  list(tenantId: string, openOnly: boolean) { return this.repo.list(this.db, tenantId, openOnly); }
  async summary(tenantId: string) { const s = await this.repo.summary(this.db, tenantId); return { held: Number(s?.held ?? 0), count: s?.count ?? 0 }; }
  async get(tenantId: string, id: string) {
    const d = await this.repo.byId(this.db, tenantId, id);
    if (!d) throw new NotFoundException('Jaminan tidak ditemukan');
    return { ...d, movements: await this.repo.movements(this.db, tenantId, id) };
  }

  private async method(tenantId: string, m?: 'CASH' | 'TRANSFER') {
    const rules = await this.util.rules(tenantId);
    const method = m ?? (rules.cashless ? 'TRANSFER' : 'CASH');
    if (rules.cashless && method === 'CASH') throw new BadRequestException('Mode non-tunai aktif: jaminan diterima/dikembalikan lewat transfer');
    return method;
  }

  async receive(u: AuthUser, dto: DepositDto) {
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Jumlah jaminan harus lebih dari 0');
    if (!(await this.staff.customer(this.db, u.tenantId, dto.customerId))) throw new BadRequestException('Pelanggan tidak ditemukan');
    if (dto.connectionId) {
      const c = await this.staff.connection(this.db, u.tenantId, dto.connectionId);
      if (!c || c.customer_id !== dto.customerId) throw new BadRequestException('Sambungan tidak ditemukan untuk pelanggan ini');
    }
    const method = await this.method(u.tenantId, dto.method);
    await this.posting.ensureSystemAccounts(this.db, u.tenantId, [SYS.UTILITY_DEPOSIT]);
    return this.db.transaction(async (tx) => {
      const cash = await this.posting.resolveCashAccount(tx, u.tenantId, dto.cashAccountId, method === 'CASH' ? 'CASH' : 'BANK');
      const date = toDocDate(undefined);
      const number = await this.seq.next(tx, u.tenantId, 'UTILITY_DEPOSIT', date);
      const id = await this.repo.insert(tx, { tenantId: u.tenantId, number, customerId: dto.customerId, connectionId: dto.connectionId ?? null, amount: amount.toFixed(2), receivedOn: date, method, cashAccountId: cash.id, note: dto.note?.trim() || null, createdById: u.sub });
      const journal = await this.posting.post(tx, { tenantId: u.tenantId, date, description: `Jaminan sambungan ${number}`, sourceType: 'UTILITY_DEPOSIT', sourceId: id, createdById: u.sub, lines: [{ accountId: cash.id, debit: amount }, { key: SYS.UTILITY_DEPOSIT, credit: amount }] });
      await this.repo.setJournal(tx, u.tenantId, id, journal.id);
      await this.repo.addMovement(tx, { tenantId: u.tenantId, depositId: id, date, kind: 'PENERIMAAN', amount: amount.toFixed(2), journalId: journal.id, userId: u.sub, note: dto.note });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityDeposit', entityId: id, data: { number, amount: amount.toFixed(2) } });
      return { id, number, journal: journal.number };
    });
  }

  async offset(u: AuthUser, id: string, dto: DepositOffsetDto) {
    const dep = await this.repo.byId(this.db, u.tenantId, id);
    if (!dep) throw new NotFoundException('Jaminan tidak ditemukan');
    if (dep.created_by_id === u.sub && !['OWNER', 'ADMIN'].includes(u.role)) throw new ForbiddenException('Pemakaian jaminan harus oleh orang lain dari penerimanya (pemisahan fungsi)');
    await this.posting.ensureSystemAccounts(this.db, u.tenantId, [SYS.UTILITY_DEPOSIT, SYS.AR]);
    return this.db.transaction(async (tx) => {
      const d = await this.repo.byId(tx, u.tenantId, id, true);
      const inv = await this.invoices.invoice(tx, u.tenantId, dto.invoiceId, true);
      if (!d || !inv) throw new NotFoundException('Jaminan atau tagihan tidak ditemukan');
      if (!inv.is_utility) throw new BadRequestException('Jaminan hanya melunasi tagihan air atau layanan non-air');
      if (inv.customer_id !== d.customer_id) throw new BadRequestException('Tagihan harus milik pelanggan yang sama dengan pemilik jaminan');
      const remaining = Number(d.remaining);
      const open = Number(inv.total) - Number(inv.paid_amount) - Number(inv.returned_amount);
      const max = Math.min(remaining, open);
      if (max <= 0.005) throw new BadRequestException(remaining <= 0.005 ? 'Jaminan sudah habis dipakai' : 'Tagihan sudah lunas');
      const amount = dto.amount ? money(dto.amount).toNumber() : max;
      if (!(amount > 0)) throw new BadRequestException('Jumlah harus lebih dari 0');
      if (amount > max + 0.005) throw new BadRequestException(`Paling banyak ${rp(max)} (sisa jaminan ${rp(remaining)}, sisa tagihan ${rp(open)})`);
      const date = toDocDate(undefined);
      const payNo = await this.seq.next(tx, u.tenantId, 'PAYMENT', date);
      const paymentId = await this.repo.insertPayment(tx, { tenantId: u.tenantId, number: payNo, date, customerId: inv.customer_id, invoiceId: inv.id, amount: amount.toFixed(2), notes: `Dari jaminan ${d.number}` });
      const journal = await this.posting.post(tx, { tenantId: u.tenantId, date, description: `Pelunasan ${inv.number} dari jaminan ${d.number}`, sourceType: 'PAYMENT', sourceId: paymentId, createdById: u.sub, lines: [{ key: SYS.UTILITY_DEPOSIT, debit: D(amount) }, { key: SYS.AR, credit: D(amount) }] });
      await this.repo.setPaymentJournal(tx, u.tenantId, paymentId, journal.id);
      await this.repo.payInvoice(tx, u.tenantId, inv.id, amount.toFixed(2));
      await this.repo.addMovement(tx, { tenantId: u.tenantId, depositId: id, date, kind: 'PELUNASAN_TUNGGAKAN', amount: amount.toFixed(2), invoiceId: inv.id, paymentId, journalId: journal.id, userId: u.sub });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPLY', entity: 'UtilityDeposit', entityId: id, data: { invoice: inv.number, amount, payment: payNo } });
      return { payment: payNo, amount: amount.toFixed(2), journal: journal.number };
    });
  }

  async refund(u: AuthUser, id: string, dto: DepositRefundDto) {
    const dep = await this.repo.byId(this.db, u.tenantId, id);
    if (!dep) throw new NotFoundException('Jaminan tidak ditemukan');
    if (dep.created_by_id === u.sub && !['OWNER', 'ADMIN'].includes(u.role)) throw new ForbiddenException('Pengembalian jaminan harus oleh orang lain dari penerimanya (pemisahan fungsi)');
    const remaining = Number(dep.remaining);
    if (remaining <= 0.005) throw new BadRequestException('Jaminan sudah habis');
    const open = await this.repo.customerOpenUtility(this.db, u.tenantId, dep.customer_id);
    if (open > 0.5) throw new BadRequestException(`Pelanggan masih punya tagihan belum lunas ${rp(open)}; pakai jaminan untuk melunasi tunggakan lebih dulu`);
    const amount = dto.amount ? money(dto.amount).toNumber() : remaining;
    if (!(amount > 0) || amount > remaining + 0.005) throw new BadRequestException(`Jumlah pengembalian paling banyak ${rp(remaining)}`);
    const method = await this.method(u.tenantId, dto.method);
    await this.posting.ensureSystemAccounts(this.db, u.tenantId, [SYS.UTILITY_DEPOSIT]);
    return this.db.transaction(async (tx) => {
      const cash = await this.posting.resolveCashAccount(tx, u.tenantId, dto.cashAccountId, method === 'CASH' ? 'CASH' : 'BANK');
      const date = toDocDate(undefined);
      const journal = await this.posting.post(tx, { tenantId: u.tenantId, date, description: `Pengembalian jaminan ${dep.number} — ${dep.customer_name}`, sourceType: 'UTILITY_DEPOSIT', sourceId: id, createdById: u.sub, lines: [{ key: SYS.UTILITY_DEPOSIT, debit: D(amount) }, { accountId: cash.id, credit: D(amount) }] });
      await this.repo.addMovement(tx, { tenantId: u.tenantId, depositId: id, date, kind: 'PENGEMBALIAN', amount: amount.toFixed(2), journalId: journal.id, userId: u.sub, note: dto.note });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REFUND', entity: 'UtilityDeposit', entityId: id, data: { amount } });
      return { amount: amount.toFixed(2), journal: journal.number };
    });
  }
}

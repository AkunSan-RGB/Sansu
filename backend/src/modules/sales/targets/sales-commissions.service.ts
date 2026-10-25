import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { SequenceService } from '../../../common/sequence/sequence.service';
import { addDays, toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { salesCommissions, users } from '../../../db/schema';
import { SYS } from '../../accounting/default-coa';
import { PostingService } from '../../accounting/posting.service';
import { SalesTargetsService } from './sales-targets.service';
import { PayCommissionDto, VoidCommissionDto } from './sales-commissions.dto';
import { lockOwned, patchById } from '../../../db/owned';

const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

@Injectable()
export class SalesCommissionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly targets: SalesTargetsService,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  async list(u: AuthUser, period?: string) {
    const rows = await this.db
      .select({ c: salesCommissions, name: users.name })
      .from(salesCommissions)
      .innerJoin(users, eq(users.id, salesCommissions.userId))
      .where(and(eq(salesCommissions.tenantId, u.tenantId), period ? eq(salesCommissions.period, period) : undefined, u.role === 'SALES' ? eq(salesCommissions.userId, u.sub) : undefined))
      .orderBy(desc(salesCommissions.period), desc(salesCommissions.number))
      .limit(500);
    return rows.map((r) => ({ ...r.c, userName: r.name }));
  }

  async close(u: AuthUser, period: string) {
    if (period >= todayJakarta().slice(0, 7)) throw new BadRequestException('Komisi baru dapat ditutup setelah bulannya berakhir');
    const perf = await this.targets.performance({ ...u, role: 'ADMIN' }, period);
    const date = toDocDate(lastDay(period));
    const made = await this.db.transaction(async (tx) => {
      const out: { id: string; number: string; userId: string; amount: string }[] = [];
      for (const r of perf.rows) {
        if (!r.hasTarget || D(r.commission).lte(0)) continue;
        const [dup] = await tx.select({ id: salesCommissions.id }).from(salesCommissions).where(and(eq(salesCommissions.tenantId, u.tenantId), eq(salesCommissions.userId, r.userId), eq(salesCommissions.period, period), eq(salesCommissions.status, 'ACCRUED')));
        const [paid] = dup ? [] : await tx.select({ id: salesCommissions.id }).from(salesCommissions).where(and(eq(salesCommissions.tenantId, u.tenantId), eq(salesCommissions.userId, r.userId), eq(salesCommissions.period, period), eq(salesCommissions.status, 'PAID')));
        if (dup || paid) continue; // sudah ditutup: tidak dobel
        const number = await this.seq.next(tx, u.tenantId, 'SALES_COMMISSION', date);
        const [row] = await tx
          .insert(salesCommissions)
          .values({ tenantId: u.tenantId, number, userId: r.userId, period, netSales: r.net, targetAmount: r.target, commissionPct: r.commissionPct, amount: r.commission, accruedById: u.sub })
          .returning();
        const journal = await this.posting.post(tx, {
          tenantId: u.tenantId,
          date,
          description: `Komisi sales ${r.name} periode ${period} (${number})`,
          sourceType: 'SALES_COMMISSION',
          sourceId: row.id,
          createdById: u.sub,
          lines: [{ key: SYS.SALES_COMMISSION, debit: r.commission }, { key: SYS.COMMISSION_PAYABLE, credit: r.commission }],
        });
        await patchById(tx, salesCommissions, row.id, { accrualJournalId: journal.id });
        await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'POST', entity: 'SalesCommission', entityId: row.id, data: { number, period, sales: r.name, net: r.net, amount: r.commission, journal: journal.number } });
        out.push({ id: row.id, number, userId: r.userId, amount: r.commission });
      }
      return out;
    });
    return { period, created: made.length, total: made.reduce((a, m) => a.plus(m.amount), D(0)).toFixed(2), items: made };
  }

  async pay(u: AuthUser, id: string, dto: PayCommissionDto) {
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const c = await lockOwned(tx, salesCommissions, u.tenantId, id);
      if (!c) throw new NotFoundException('Komisi tidak ditemukan');
      if (c.status !== 'ACCRUED') throw new BadRequestException(c.status === 'PAID' ? 'Komisi ini sudah dibayar' : 'Komisi ini sudah dibatalkan');
      // pemisahan fungsi: yang menutup komisi tidak membayarnya sendiri (Pemilik dikecualikan agar usaha kecil tetap bisa berjalan)
      if (c.accruedById === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Komisi dibayar oleh orang lain dari yang menutupnya (pemisahan fungsi)');
      if (c.userId === u.sub) throw new ForbiddenException('Komisi sendiri tidak dapat Anda bayarkan');
      const pph = D(dto.pph21 ?? 0);
      if (pph.lt(0) || pph.gt(c.amount)) throw new BadRequestException('PPh 21 tidak valid');
      const cash = await this.posting.resolveCashAccount(tx, u.tenantId, dto.cashAccountId, 'BANK');
      await this.posting.assertCashCovers(tx, u.tenantId, cash, D(c.amount).minus(pph));
      const journal = await this.posting.post(tx, {
        tenantId: u.tenantId,
        date,
        description: `Pembayaran komisi ${c.number}`,
        sourceType: 'SALES_COMMISSION_PAYMENT',
        sourceId: c.id,
        createdById: u.sub,
        lines: [
          { key: SYS.COMMISSION_PAYABLE, debit: c.amount },
          { accountId: cash.id, credit: D(c.amount).minus(pph), ...(cash.branchId ? { branchId: cash.branchId } : {}) },
          { key: SYS.PPH21_PAYABLE, credit: pph },
        ],
      });
      await patchById(tx, salesCommissions, id, { status: 'PAID', paymentJournalId: journal.id, cashAccountId: cash.id, paidById: u.sub, paidAt: date, pph21Withheld: pph.toFixed(2) });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'PAY', entity: 'SalesCommission', entityId: id, data: { number: c.number, amount: c.amount, pph21: pph.toFixed(2), journal: journal.number } });
      return { id, status: 'PAID', journalNumber: journal.number };
    });
  }

  async voidIt(u: AuthUser, id: string, dto: VoidCommissionDto) {
    return this.db.transaction(async (tx) => {
      const c = await lockOwned(tx, salesCommissions, u.tenantId, id);
      if (!c) throw new NotFoundException('Komisi tidak ditemukan');
      if (c.status !== 'ACCRUED') throw new BadRequestException('Hanya komisi yang belum dibayar yang dapat dibatalkan');
      const rev = await this.posting.reverse(tx, u.tenantId, c.accrualJournalId!, toDocDate(addDays(todayJakarta(), 0)), u.sub, true);
      await patchById(tx, salesCommissions, id, { status: 'VOID', voidReason: dto.reason });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'VOID', entity: 'SalesCommission', entityId: id, data: { number: c.number, reason: dto.reason, reversal: (rev as { number?: string })?.number } });
      return { id, status: 'VOID' };
    });
  }
}

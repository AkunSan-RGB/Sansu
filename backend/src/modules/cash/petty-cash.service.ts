import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { addDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, pettyCashFunds, pettyCashReplenishments, pettyCashVouchers } from '../../db/schema';
import { CashService } from './cash.service';
import { PettyFundDto, PettyFundTopUpDto, PettyVoucherDto, PettyVoidDto, PettyReplenishDto } from './petty-cash.dto';
import { ReferenceRepository } from '../../db/reference.repository';
import { findOwned, patchById } from '../../db/owned';

type Fund = typeof pettyCashFunds.$inferSelect;

const OLD_VOUCHER_DAYS = 14;

@Injectable()
export class PettyCashService {
  constructor(
    @InjectDb() private readonly db: Db,
    @Inject(forwardRef(() => CashService)) private readonly cash: CashService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly refs: ReferenceRepository,
  ) {}

  private async balanceOf(db: Db | Tx, accountId: string): Promise<Dec> {
    const [r] = (await db.execute<{ bal: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM journal_lines l WHERE l.account_id = ${accountId}`)).rows;
    return D(r.bal);
  }

  private async getFund(db: Db | Tx, tenantId: string, id: string): Promise<Fund> {
    const f = await findOwned(db, pettyCashFunds, tenantId, id);
    if (!f) throw new NotFoundException('Dana kas kecil tidak ditemukan');
    return f;
  }

  /** Dana kas kecil beserta posisi: saldo buku, bukti belum diganti, dan selisih terhadap plafon */
  async funds(tenantId: string) {
    const rows = await this.db.select().from(pettyCashFunds).where(eq(pettyCashFunds.tenantId, tenantId)).orderBy(pettyCashFunds.createdAt);
    const out = [];
    for (const f of rows) {
      const balance = await this.balanceOf(this.db, f.accountId);
      const [o] = (
        await this.db.execute<{ total: string; n: number; oldest: string | null }>(sql`
          SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS n, MIN(date)::text AS oldest
          FROM petty_cash_vouchers WHERE fund_id = ${f.id} AND status = 'OPEN'`)
      ).rows;
      const [c] = (await this.db.execute<{ last: string | null }>(sql`SELECT MAX(date)::text AS last FROM cash_counts WHERE tenant_id = ${tenantId} AND account_id = ${f.accountId} AND status = 'POSTED'`)).rows;
      const open = D(o.total);
      out.push({
        ...f,
        balance: balance.toFixed(2),
        openVouchers: open.toFixed(2),
        openCount: o.n,
        oldestOpen: o.oldest,
        lastCount: c.last,
        /** Plafon − (kas kecil + bukti belum diganti): 0 = dana tetap utuh; ≠ 0 = ada kekurangan/kelebihan yang harus ditelusuri */
        variance: D(f.imprestAmount).minus(balance).minus(open).toFixed(2),
        toReplenish: D(f.imprestAmount).minus(balance).toFixed(2),
      });
    }
    return out;
  }

  async saveFund(user: AuthUser, dto: PettyFundDto) {
    const imprest = money(dto.imprestAmount);
    const max = money(dto.maxVoucher);
    if (imprest.lte(0)) throw new BadRequestException('Dana tetap harus lebih dari 0');
    if (max.lte(0) || max.gt(imprest)) throw new BadRequestException('Batas per bukti harus lebih dari 0 dan tidak melebihi dana tetap');
    if (dto.accountId === dto.fundingAccountId) throw new BadRequestException('Sumber pengisian harus akun yang berbeda dari kas kecil');
    const accs = await this.db.select().from(accounts).where(and(eq(accounts.tenantId, user.tenantId), inArray(accounts.id, [dto.accountId, dto.fundingAccountId])));
    if (accs.length !== 2 || accs.some((a) => !a.isCashAccount || !a.isPostable)) throw new BadRequestException('Kas kecil dan sumber pengisian harus akun kas/bank');
    const [exist] = await this.db.select().from(pettyCashFunds).where(and(eq(pettyCashFunds.tenantId, user.tenantId), eq(pettyCashFunds.accountId, dto.accountId)));
    if (exist) {
      const bal = await this.balanceOf(this.db, exist.accountId);
      if (imprest.lt(bal)) throw new BadRequestException('Plafon baru lebih kecil dari saldo kas kecil saat ini. Setor kelebihannya dulu');
      const [f] = await this.db
        .update(pettyCashFunds)
        .set({ fundingAccountId: dto.fundingAccountId, name: dto.name.trim(), custodianName: dto.custodianName.trim(), imprestAmount: imprest.toFixed(2), maxVoucher: max.toFixed(2) })
        .where(eq(pettyCashFunds.id, exist.id))
        .returning();
      await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'PettyCashFund', entityId: f.id, data: { imprest: imprest.toFixed(2), custodian: f.custodianName } });
      return f;
    }
    const [f] = await this.db
      .insert(pettyCashFunds)
      .values({ tenantId: user.tenantId, accountId: dto.accountId, fundingAccountId: dto.fundingAccountId, name: dto.name.trim(), custodianName: dto.custodianName.trim(), imprestAmount: imprest.toFixed(2), maxVoucher: max.toFixed(2) })
      .returning();
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PettyCashFund', entityId: f.id, data: { imprest: imprest.toFixed(2) } });
    return f;
  }

  /** Isi dana sampai plafon dari sumber pengisian (pendirian dana atau penambahan plafon). Hanya untuk dana yang belum punya bukti terbuka. */
  async topUp(user: AuthUser, fundId: string, dto: PettyFundTopUpDto) {
    return this.db.transaction(async (tx) => {
      const f = await this.getFund(tx, user.tenantId, fundId);
      if (f.status !== 'ACTIVE') throw new BadRequestException('Dana kas kecil sudah ditutup');
      const [o] = (await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM petty_cash_vouchers WHERE fund_id = ${f.id} AND status = 'OPEN'`)).rows;
      if (o.n > 0) throw new BadRequestException('Ada bukti yang belum diganti. Gunakan Pengisian kembali');
      const need = D(f.imprestAmount).minus(await this.balanceOf(tx, f.accountId));
      if (need.lte(0)) throw new BadRequestException('Dana kas kecil sudah penuh');
      const t = await this.cash.create(user, { type: 'TRANSFER', cashAccountId: f.fundingAccountId, toCashAccountId: f.accountId, date: toDocDate(dto.date ?? todayJakarta()), description: `Pengisian dana kas kecil ${f.name}`, amount: need.toFixed(2), reference: `DANA-${f.name}` }, { petty: true, approved: true, tx });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'FUND', entity: 'PettyCashFund', entityId: f.id, data: { amount: need.toFixed(2) } });
      return { amount: need.toFixed(2), cashNumber: t.number };
    });
  }

  async vouchers(tenantId: string, fundId?: string, status?: string) {
    const rows = await this.db.query.pettyCashVouchers.findMany({
      where: and(eq(pettyCashVouchers.tenantId, tenantId), fundId ? eq(pettyCashVouchers.fundId, fundId) : undefined, status ? eq(pettyCashVouchers.status, status as 'OPEN') : undefined),
      orderBy: [desc(pettyCashVouchers.date), desc(pettyCashVouchers.number)],
      limit: 300,
    });
    const accs = await this.db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(eq(accounts.tenantId, tenantId));
    const byId = new Map(accs.map((a) => [a.id, a]));
    return rows.map((r) => ({ ...r, expenseAccount: byId.get(r.expenseAccountId) ?? null }));
  }

  /** Bukti kas kecil: pengeluaran kecil dengan nota, langsung dibebankan dan mengurangi kas kecil */
  async createVoucher(user: AuthUser, dto: PettyVoucherDto) {
    return this.db.transaction(async (tx) => {
      const f = await this.getFund(tx, user.tenantId, dto.fundId);
      if (f.status !== 'ACTIVE') throw new BadRequestException('Dana kas kecil sudah ditutup');
      const amount = money(dto.amount);
      const date = toDocDate(dto.date);
      if (amount.lte(0)) throw new BadRequestException('Jumlah harus lebih dari 0');
      if (amount.gt(f.maxVoucher)) throw new BadRequestException(`Melebihi batas per bukti kas kecil (Rp${D(f.maxVoucher).toNumber().toLocaleString('id-ID')}). Pengeluaran sebesar itu dicatat lewat Kas keluar dengan persetujuan`);
      if (date > todayJakarta()) throw new BadRequestException('Tanggal bukti tidak boleh di masa depan');
      if (date < addDays(todayJakarta(), -30)) throw new BadRequestException('Bukti lebih dari 30 hari tidak diterima di kas kecil');
      const acc = await this.refs.account(tx, user.tenantId, dto.expenseAccountId);
      if (!acc || !acc.isPostable) throw new BadRequestException('Akun beban tidak valid');
      if (acc.type !== 'EXPENSE') throw new BadRequestException('Kas kecil hanya untuk biaya operasional. Prive, pinjaman karyawan, dan pembelian aset tidak boleh lewat kas kecil');
      const receipt = dto.receiptRef.trim();
      const dup = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM petty_cash_vouchers WHERE fund_id = ${f.id} AND lower(receipt_ref) = lower(${receipt}) AND status <> 'VOID'`);
      if (dup.rows[0].n > 0) throw new BadRequestException(`Nomor nota "${receipt}" sudah pernah dipakai di bukti kas kecil lain`);
      const bal = await this.balanceOf(tx, f.accountId);
      if (amount.gt(bal)) throw new BadRequestException(`Saldo kas kecil tidak cukup (Rp${bal.toNumber().toLocaleString('id-ID')}). Ajukan pengisian kembali`);
      const number = await this.seq.next(tx, user.tenantId, 'PETTY_VOUCHER', date);
      const t = await this.cash.create(
        user,
        { type: 'OUT', cashAccountId: f.accountId, date, description: `Kas kecil ${number}: ${dto.description.trim()} (${dto.payee.trim()})`, reference: receipt, lines: [{ accountId: acc.id, amount: amount.toFixed(2), memo: dto.description.trim() }] },
        { petty: true, approved: true, tx },
      );
      const [v] = await tx
        .insert(pettyCashVouchers)
        .values({ tenantId: user.tenantId, fundId: f.id, number, date, payee: dto.payee.trim(), description: dto.description.trim(), expenseAccountId: acc.id, amount: amount.toFixed(2), receiptRef: receipt, cashTransactionId: t.id, createdById: user.sub })
        .returning();
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'PettyCashVoucher', entityId: v.id, data: { number, amount: amount.toFixed(2), receipt } });
      return v;
    });
  }

  /** Batalkan bukti (belum diganti) — pemilik/admin; jurnal dibalik dan dana kembali */
  async voidVoucher(user: AuthUser, id: string, dto: PettyVoidDto) {
    return this.db.transaction(async (tx) => {
      const v = await findOwned(tx, pettyCashVouchers, user.tenantId, id);
      if (!v) throw new NotFoundException('Bukti tidak ditemukan');
      if (v.status !== 'OPEN') throw new BadRequestException(v.status === 'VOID' ? 'Bukti sudah dibatalkan' : 'Bukti sudah diganti lewat pengisian kembali dan tidak bisa dibatalkan');
      await this.cash.void(user, v.cashTransactionId!, { reason: dto.reason }, tx);
      await patchById(tx, pettyCashVouchers, id, { status: 'VOID' });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'VOID', entity: 'PettyCashVoucher', entityId: id, data: { number: v.number, reason: dto.reason } });
      return { id, status: 'VOID' };
    });
  }

  /** Pengajuan pengisian kembali: pemilik/admin langsung dijalankan; peran lain menunggu persetujuan */
  async replenish(user: AuthUser, fundId: string, dto: PettyReplenishDto) {
    const f = await this.getFund(this.db, user.tenantId, fundId);
    const picked = await this.pickVouchers(this.db, f, dto.voucherIds);
    const total = picked.reduce<Dec>((a, v) => a.plus(v.amount), ZERO);
    if (!picked.length) throw new BadRequestException('Tidak ada bukti yang perlu diganti');
    if (!this.approvals.isApprover(user.role)) {
      const req = await this.approvals.create(this.db, user, {
        kind: 'PETTY_REPLENISH',
        refId: null,
        title: `Pengisian kembali kas kecil ${f.name} (${picked.length} bukti)`,
        amount: total.toNumber(),
        payload: JSON.parse(JSON.stringify({ fundId, date: dto.date, voucherIds: picked.map((v) => v.id) })),
      });
      throw this.approvals.required(req.id, 'Pengisian kembali kas kecil menunggu persetujuan pemilik atau admin; dana diisi setelah disetujui.');
    }
    return this.executeReplenish(user, { fundId, date: dto.date, voucherIds: picked.map((v) => v.id) });
  }

  private async pickVouchers(db: Db | Tx, f: Fund, ids?: string[]) {
    const open = await db.select().from(pettyCashVouchers).where(and(eq(pettyCashVouchers.fundId, f.id), eq(pettyCashVouchers.status, 'OPEN')));
    if (!ids?.length) return open;
    const set = new Set(ids);
    const picked = open.filter((v) => set.has(v.id));
    if (picked.length !== set.size) throw new BadRequestException('Ada bukti yang sudah diganti, dibatalkan, atau bukan milik dana ini');
    return picked;
  }

  /** Dijalankan langsung oleh pemilik/admin atau setelah persetujuan (atas nama pemohon) */
  async executeReplenish(user: AuthUser, dto: { fundId: string; date?: string; voucherIds: string[] }) {
    return this.db.transaction(async (tx) => {
      const f = await this.getFund(tx, user.tenantId, dto.fundId);
      if (f.status !== 'ACTIVE') throw new BadRequestException('Dana kas kecil sudah ditutup');
      const picked = await this.pickVouchers(tx, f, dto.voucherIds);
      if (!picked.length) throw new BadRequestException('Tidak ada bukti yang perlu diganti');
      const total = picked.reduce<Dec>((a, v) => a.plus(v.amount), ZERO);
      const bal = await this.balanceOf(tx, f.accountId);
      if (bal.plus(total).gt(f.imprestAmount)) throw new BadRequestException('Pengisian akan melebihi dana tetap. Periksa kas kecil dengan hitung kas fisik');
      const date = toDocDate(dto.date ?? todayJakarta());
      const number = await this.seq.next(tx, user.tenantId, 'PETTY_REPLENISH', date);
      const t = await this.cash.create(user, { type: 'TRANSFER', cashAccountId: f.fundingAccountId, toCashAccountId: f.accountId, date, description: `Pengisian kembali kas kecil ${f.name} ${number}`, amount: total.toFixed(2), reference: number }, { petty: true, approved: true, tx });
      const [r] = await tx.insert(pettyCashReplenishments).values({ tenantId: user.tenantId, fundId: f.id, number, date, total: total.toFixed(2), voucherCount: picked.length, cashTransactionId: t.id, requestedById: user.sub }).returning();
      await tx.update(pettyCashVouchers).set({ status: 'REPLENISHED', replenishmentId: r.id }).where(inArray(pettyCashVouchers.id, picked.map((v) => v.id)));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'REPLENISH', entity: 'PettyCashFund', entityId: f.id, data: { number, total: total.toFixed(2), vouchers: picked.length } });
      return { number, total: total.toFixed(2), vouchers: picked.length };
    });
  }

  /** Temuan kontrol kas kecil */
  async controls(tenantId: string) {
    const funds = await this.funds(tenantId);
    const today = todayJakarta();
    type Finding = { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string };
    const out: Finding[] = [];
    for (const f of funds.filter((x) => x.status === 'ACTIVE')) {
      const n = f.name;
      const imprest = D(f.imprestAmount);
      const bal = D(f.balance);
      if (!D(f.variance).abs().lt(1)) {
        out.push({
          key: `MISMATCH:${f.id}`,
          level: 'error',
          title: `${n}: dana tetap tidak sesuai`,
          detail: `Plafon Rp${imprest.toNumber().toLocaleString('id-ID')} ≠ saldo kas kecil Rp${bal.toNumber().toLocaleString('id-ID')} + bukti belum diganti Rp${D(f.openVouchers).toNumber().toLocaleString('id-ID')}. Selisih Rp${D(f.variance).toNumber().toLocaleString('id-ID')} ${D(f.variance).gt(0) ? '(kekurangan)' : '(kelebihan)'}. Lakukan hitung kas fisik dan telusuri penyebabnya.`,
        });
      }
      if (bal.gt(imprest)) out.push({ key: `OVER:${f.id}`, level: 'error', title: `${n}: saldo melebihi plafon`, detail: 'Kas kecil tidak boleh melebihi dana tetap. Setor kelebihannya ke kas besar/bank.' });
      if (f.openCount > 0 && f.oldestOpen && f.oldestOpen < addDays(today, -OLD_VOUCHER_DAYS)) {
        out.push({ key: `OLD:${f.id}`, level: 'warning', title: `${n}: bukti lebih dari ${OLD_VOUCHER_DAYS} hari belum diganti`, detail: `Bukti tertua ${f.oldestOpen}. Ajukan pengisian kembali agar beban tercatat lengkap dan dana kembali penuh.` });
      }
      if (imprest.gt(0) && bal.lt(imprest.times(0.25))) out.push({ key: `LOW:${f.id}`, level: 'info', title: `${n}: dana tinggal ${bal.div(imprest).times(100).toFixed(0)}% dari plafon`, detail: 'Ajukan pengisian kembali sebelum dana habis.' });
      if (!f.lastCount || f.lastCount < addDays(today, -30)) out.push({ key: `COUNT:${f.id}`, level: 'warning', title: `${n}: belum ada hitung kas fisik dalam 30 hari`, detail: 'Lakukan hitung kas mendadak oleh orang selain juru kas (Kas › Hitung kas).' });
    }
    return { count: out.length, items: out };
  }
}

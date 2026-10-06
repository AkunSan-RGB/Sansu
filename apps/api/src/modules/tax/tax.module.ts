/**
 * Setoran pajak & BPJS: menghitung kewajiban per masa dari buku besar, lalu mencatat setoran
 * (kode billing / NTPN) dengan jurnal otomatis.
 *
 *  PPN      : kompensasi PPN Keluaran vs Masukan per masa → Dr PPN Keluaran | Cr PPN Masukan, Cr Bank (kurang bayar)
 *  PPh 21/23/4(2), BPJS, PPh 29 : Dr Utang pajak/BPJS | Cr Bank
 *  PPh 25   : Dr Pajak Dibayar Dimuka | Cr Bank (jadi kredit pajak di Rekonsiliasi Fiskal)
 *  PPh final UMKM 0,5% : Dr Beban PPh Final | Cr Bank
 */
import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { nextWorkday, TAX_PAYMENT_TYPES, type TaxPaymentType, taxDeadline } from '@sansu/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { DocDate, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, taxPayments } from '../../db/schema';
import { AccountingModule } from '../accounting/accounting.module';
import { SYS, type SystemKey } from '../accounting/default-coa';
import { loadAccounts, sumByAccount } from '../accounting/ledger-data';
import { PostingService } from '../accounting/posting.service';
import { FiscalService } from '../insights/fiscal.service';
import { InsightsModule } from '../insights/insights.module';
import { yearQuery } from '../../common/pipes/year.pipe';

// ---------- DTO ----------
export class CreateTaxPaymentDto {
  @ApiProperty({ enum: TAX_PAYMENT_TYPES }) @IsIn(TAX_PAYMENT_TYPES) type: TaxPaymentType;
  @ApiProperty({ example: '2026-09', description: 'Masa pajak (PPh 29: YYYY-12)' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string;
  @ApiPropertyOptional({ example: '2026-10-10' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Kosong = sebesar kewajiban terhitung' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiPropertyOptional({ description: 'Rekening pembayar; kosong = Bank' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ example: '123456789012345' }) @IsOptional() @IsString() @MaxLength(30) billingCode?: string;
  @ApiPropertyOptional({ example: 'A1B2C3D4E5F6G7H8' }) @IsOptional() @IsString() @MaxLength(30) ntpn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) notes?: string;
}

const LIABILITY_KEY: Partial<Record<TaxPaymentType, SystemKey>> = {
  PPH21: SYS.PPH21_PAYABLE,
  PPH23: SYS.PPH23_PAYABLE,
  PPH4_2: SYS.PPH4_2_PAYABLE,
  PPH29: SYS.CORPORATE_TAX_PAYABLE,
  BPJS: SYS.BPJS_PAYABLE,
};

function monthEnd(period: string): DocDate {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
const nextMonth = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

export type RecapStatus = 'NIHIL' | 'TEPAT' | 'TERLAMBAT' | 'KURANG' | 'KURANG_TERLAMBAT' | 'BELUM' | 'TERLAMBAT_BELUM' | 'LEBIH_BAYAR' | 'BELUM_MASA';

export interface TaxObligation {
  type: TaxPaymentType;
  period: string;
  /** Kewajiban terhitung yang belum disetor (s/d akhir masa) */
  outstanding: string;
  /** Sudah disetor untuk masa ini */
  paid: string;
  dueDate: string;
  status: 'NIHIL' | 'BELUM' | 'LUNAS' | 'TERLAMBAT' | 'LEBIH_BAYAR' | 'OPSIONAL';
  detail?: Record<string, string>;
  note?: string;
}

// ---------- Service ----------
@Injectable()
export class TaxService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly settings: SettingsService,
    private readonly fiscal: FiscalService,
    private readonly audit: AuditService,
  ) {}

  private async keyAccounts(db: DbOrTx, tenantId: string) {
    const rows = await db
      .select({ id: accounts.id, key: accounts.systemKey })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.systemKey, Object.values(SYS))));
    return new Map(rows.map((r) => [r.key!, r.id]));
  }

  /** Total setoran per jenis s/d masa tertentu (inklusif) */
  private async paidThrough(db: DbOrTx, tenantId: string, type: TaxPaymentType, period: string) {
    const [r] = (
      await db.execute<{ amount: string; vat_out: string; vat_in: string }>(sql`
        SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(vat_out), 0) AS vat_out, COALESCE(SUM(vat_in), 0) AS vat_in
        FROM tax_payments WHERE tenant_id = ${tenantId} AND type = ${type} AND period <= ${period}`)
    ).rows;
    return { amount: D(r.amount), vatOut: D(r.vat_out), vatIn: D(r.vat_in) };
  }

  private async paidIn(db: DbOrTx, tenantId: string, type: TaxPaymentType, period: string) {
    const [r] = (
      await db.execute<{ amount: string }>(sql`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM tax_payments WHERE tenant_id = ${tenantId} AND type = ${type} AND period = ${period}`)
    ).rows;
    return D(r.amount);
  }

  /** Saldo kredit (liabilitas) akun s/d akhir masa, tanpa jurnal setoran pajak */
  private async balanceExclPayments(db: DbOrTx, tenantId: string, accountId: string | undefined, to: DocDate, normal: 'credit' | 'debit') {
    if (!accountId) return ZERO;
    const m = await sumByAccount(db, tenantId, { to, excludeSources: ['TAX_PAYMENT', 'CLOSING'] });
    const s = m.get(accountId);
    if (!s) return ZERO;
    return normal === 'credit' ? s.credit.minus(s.debit) : s.debit.minus(s.credit);
  }

  /** Perhitungan PPN masa: sisa keluaran & masukan yang belum dikompensasi s/d akhir masa */
  private async vatPosition(db: DbOrTx, tenantId: string, period: string) {
    const keys = await this.keyAccounts(db, tenantId);
    const to = monthEnd(period);
    const out = await this.balanceExclPayments(db, tenantId, keys.get(SYS.VAT_OUT), to, 'credit');
    const inn = await this.balanceExclPayments(db, tenantId, keys.get(SYS.VAT_IN), to, 'debit');
    const settled = await this.paidThrough(db, tenantId, 'PPN', period);
    const remOut = out.minus(settled.vatOut);
    const remIn = inn.minus(settled.vatIn);
    const payable = remOut.minus(remIn);
    return { remOut, remIn, payable };
  }

  /** Peredaran bruto bulan itu (penjualan kotor) untuk PPh final 0,5% */
  private async grossRevenue(db: DbOrTx, tenantId: string, period: string) {
    const accs = await loadAccounts(db, tenantId);
    const m = await sumByAccount(db, tenantId, { from: `${period}-01`, to: monthEnd(period), excludeSources: ['CLOSING'] });
    return accs
      .filter((a) => a.reportGroup === 'SALES_REVENUE' || a.reportGroup === 'SALES_DEDUCTION')
      .reduce<Dec>((s, a) => {
        const x = m.get(a.id);
        return x ? s.plus(x.credit.minus(x.debit)) : s;
      }, ZERO);
  }

  /** Aturan tenggat ada di @sansu/shared (taxDeadline) agar cek kesehatan dan rekap pajak selalu sama; digeser bila jatuh di akhir pekan/libur */
  private async holidays(tenantId: string): Promise<string[]> {
    return (await this.settings.taxProfile(this.db, tenantId)).holidays ?? [];
  }

  private dueDate(type: TaxPaymentType, period: string, holidays: readonly string[]) {
    return taxDeadline(type, period, holidays);
  }

  private status(outstanding: Dec, paid: Dec, due: string, optional = false): TaxObligation['status'] {
    if (outstanding.lt(0)) return 'LEBIH_BAYAR';
    if (outstanding.isZero()) return paid.gt(0) ? 'LUNAS' : optional ? 'OPSIONAL' : 'NIHIL';
    return todayJakarta() > due ? 'TERLAMBAT' : 'BELUM';
  }

  /** Daftar kewajiban setor untuk satu masa */
  async obligations(tenantId: string, period: string): Promise<TaxObligation[]> {
    const db = this.db;
    const keys = await this.keyAccounts(db, tenantId);
    const reporting = await this.settings.reporting(db, tenantId);
    const holidays = (await this.settings.taxProfile(db, tenantId)).holidays ?? [];
    const to = monthEnd(period);
    const result: TaxObligation[] = [];

    // PPN: perusahaan non-PKP tidak memungut PPN; barisnya hanya muncul bila ternyata ada saldo PPN
    const vat = await this.vatPosition(db, tenantId, period);
    const vatPaid = await this.paidIn(db, tenantId, 'PPN', period);
    const vatDue = this.dueDate('PPN', period, holidays);
    const pkp = (await this.settings.taxProfile(db, tenantId)).pkp;
    const showVat = pkp || !vat.remOut.isZero() || !vat.remIn.isZero() || vatPaid.gt(0);
    if (showVat) result.push({
      type: 'PPN',
      period,
      outstanding: (vat.payable.gt(0) ? vat.payable : vat.remOut.gt(0) ? ZERO : vat.payable).toFixed(2),
      paid: vatPaid.toFixed(2),
      dueDate: vatDue,
      status: vat.remOut.isZero() && vat.remIn.lte(0) ? (vatPaid.gt(0) ? 'LUNAS' : 'NIHIL') : vat.payable.gt(0) ? this.status(vat.payable, vatPaid, vatDue) : vat.remOut.gt(0) ? 'BELUM' : 'LEBIH_BAYAR',
      detail: { ppnKeluaran: vat.remOut.toFixed(2), ppnMasukan: vat.remIn.toFixed(2) },
      note: vat.payable.gt(0)
        ? 'Kurang bayar — setor sebelum melapor SPT Masa PPN.'
        : vat.remOut.gt(0)
          ? 'Lebih bayar: PPN masukan lebih besar. Catat kompensasi agar sisa masukan dibawa ke masa berikutnya.'
          : undefined,
    });

    for (const type of ['PPH21', 'PPH23', 'PPH4_2', 'BPJS'] as TaxPaymentType[]) {
      const accrued = await this.balanceExclPayments(db, tenantId, keys.get(LIABILITY_KEY[type]!), to, 'credit');
      const paidAll = (await this.paidThrough(db, tenantId, type, period)).amount;
      const paid = await this.paidIn(db, tenantId, type, period);
      const outstanding = accrued.minus(paidAll);
      const due = this.dueDate(type, period, holidays);
      result.push({ type, period, outstanding: outstanding.toFixed(2), paid: paid.toFixed(2), dueDate: due, status: this.status(outstanding, paid, due) });
    }

    if (reporting.taxScheme === 'FINAL_UMKM') {
      const gross = await this.grossRevenue(db, tenantId, period);
      const tax = money(gross.times(0.5).div(100)).floor();
      const paid = await this.paidIn(db, tenantId, 'PPH_FINAL', period);
      const outstanding = tax.minus(paid);
      const due = this.dueDate('PPH_FINAL', period, holidays);
      result.push({
        type: 'PPH_FINAL',
        period,
        outstanding: outstanding.toFixed(2),
        paid: paid.toFixed(2),
        dueDate: due,
        status: this.status(outstanding, paid, due),
        detail: { peredaranBruto: gross.toFixed(2) },
      });
    } else {
      const year = Number(period.slice(0, 4));
      let installment = ZERO;
      try {
        installment = D((await this.fiscal.reconcile(tenantId, year - 1)).installment25);
      } catch {
        installment = ZERO;
      }
      const paid = await this.paidIn(db, tenantId, 'PPH25', period);
      const outstanding = installment.minus(paid);
      const due = this.dueDate('PPH25', period, holidays);
      result.push({
        type: 'PPH25',
        period,
        outstanding: (outstanding.gt(0) ? outstanding : ZERO).toFixed(2),
        paid: paid.toFixed(2),
        dueDate: due,
        status: this.status(outstanding.gt(0) ? outstanding : ZERO, paid, due, installment.isZero()),
        detail: { angsuranTahunLalu: installment.toFixed(2) },
        note: installment.isZero() ? 'Angsuran dari SPT tahun lalu nihil. Isi manual bila DJP menetapkan angsuran.' : undefined,
      });
      if (period.endsWith('-12') || period.endsWith('-03') || period.endsWith('-04')) {
        const pphYear = period.endsWith('-12') ? period : `${year - 1}-12`;
        const accrued = await this.balanceExclPayments(db, tenantId, keys.get(SYS.CORPORATE_TAX_PAYABLE), monthEnd(pphYear), 'credit');
        const paidAll = (await this.paidThrough(db, tenantId, 'PPH29', pphYear)).amount;
        const outstanding29 = accrued.minus(paidAll);
        const due = this.dueDate('PPH29', pphYear, holidays);
        if (!outstanding29.isZero() || period === pphYear) {
          result.push({
            type: 'PPH29',
            period: pphYear,
            outstanding: outstanding29.toFixed(2),
            paid: (await this.paidIn(db, tenantId, 'PPH29', pphYear)).toFixed(2),
            dueDate: due,
            status: this.status(outstanding29, ZERO, due),
            note: 'Dari jurnal beban pajak di Rekonsiliasi Fiskal.',
          });
        }
      }
    }
    return result;
  }

  list(tenantId: string, year?: number) {
    return this.db.query.taxPayments.findMany({
      where: and(eq(taxPayments.tenantId, tenantId), year ? sql`${taxPayments.period} LIKE ${`${year}-%`}` : undefined),
      with: { cashAccount: { columns: { code: true, name: true } } },
      orderBy: [desc(taxPayments.date), desc(taxPayments.number)],
    });
  }

  async create(user: AuthUser, dto: CreateTaxPaymentDto) {
    const date = toDocDate(dto.date);
    if (date < `${dto.period}-01` && dto.type !== 'PPH25') throw new BadRequestException('Tanggal setor tidak boleh sebelum masa pajaknya');
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`tax:${user.tenantId}`}))`);
      const keys = await this.keyAccounts(tx, user.tenantId);
      const bank = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK');
      const label = TAX_LABEL[dto.type];
      let amount: Dec;
      let vatOut = ZERO;
      let vatIn = ZERO;
      type Line = { accountId?: string; key?: SystemKey; debit?: Dec; credit?: Dec; memo?: string };
      let lines: Line[];

      if (dto.type === 'PPN') {
        const vat = await this.vatPosition(tx, user.tenantId, dto.period);
        if (vat.remOut.lte(0) && vat.remIn.lte(0)) throw new BadRequestException(`Tidak ada PPN yang perlu dikompensasi untuk masa ${dto.period}`);
        if (vat.payable.gt(0)) {
          vatOut = vat.remOut;
          vatIn = vat.remIn.gt(0) ? vat.remIn : ZERO;
          amount = vatOut.minus(vatIn);
        } else {
          // Lebih bayar tanpa PPN keluaran: tidak ada yang disetor maupun dikompensasikan; masukan dibawa otomatis
          if (vat.remOut.lte(0)) {
            throw new BadRequestException(
              `Masa ${dto.period} tidak punya PPN keluaran. PPN masukan Rp${vat.remIn.toDecimalPlaces(0).toNumber().toLocaleString('id-ID')} dibawa ke masa berikutnya secara otomatis, tidak perlu disetor atau dicatat kompensasinya.`,
            );
          }
          // Lebih bayar: keluaran dinolkan dengan masukan, sisa masukan dibawa ke masa berikutnya
          vatOut = vat.remOut.gt(0) ? vat.remOut : ZERO;
          vatIn = vatOut;
          amount = ZERO;
        }
        lines = [
          { key: SYS.VAT_OUT, debit: vatOut, memo: `PPN keluaran ${dto.period}` },
          { key: SYS.VAT_IN, credit: vatIn, memo: `PPN masukan dikreditkan ${dto.period}` },
          { accountId: bank.id, credit: amount },
        ];
      } else {
        const ob = (await this.obligations(user.tenantId, dto.period)).find((o) => o.type === dto.type);
        amount = dto.amount ? money(dto.amount) : D(ob?.outstanding ?? 0);
        if (amount.lte(0)) throw new BadRequestException(`Tidak ada ${label} terutang untuk masa ${dto.period}. Isi jumlah bila ingin menyetor manual.`);
        if (LIABILITY_KEY[dto.type] && ob && amount.gt(D(ob.outstanding)) && !D(ob.outstanding).isZero()) {
          throw new BadRequestException(`Setoran ${amount.toFixed(0)} melebihi ${label} terutang ${D(ob.outstanding).toFixed(0)}`);
        }
        const debitKey: SystemKey =
          dto.type === 'PPH25' ? SYS.PREPAID_TAX : dto.type === 'PPH_FINAL' ? SYS.FINAL_TAX_EXPENSE : LIABILITY_KEY[dto.type]!;
        if (!keys.get(debitKey)) throw new BadRequestException(`Akun untuk ${label} belum ada di Bagan Akun`);
        lines = [
          { key: debitKey, debit: amount },
          { accountId: bank.id, credit: amount },
        ];
      }

      const number = await this.seq.next(tx, user.tenantId, 'TAX_PAYMENT', date);
      const [row] = await tx
        .insert(taxPayments)
        .values({
          tenantId: user.tenantId,
          number,
          type: dto.type,
          period: dto.period,
          date,
          amount: amount.toFixed(2),
          vatOut: vatOut.toFixed(2),
          vatIn: vatIn.toFixed(2),
          cashAccountId: amount.gt(0) ? bank.id : null,
          billingCode: dto.billingCode,
          ntpn: dto.ntpn,
          notes: dto.notes,
        })
        .returning();
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description:
          dto.type === 'PPN' && amount.isZero()
            ? `Kompensasi PPN masa ${dto.period} (lebih bayar dibawa ke masa berikutnya)`
            : `Setor ${label} masa ${dto.period}${dto.ntpn ? ` · NTPN ${dto.ntpn}` : ''}`,
        sourceType: 'TAX_PAYMENT',
        sourceId: row.id,
        reference: dto.ntpn ?? dto.billingCode,
        createdById: user.sub,
        lines,
      });
      await tx.update(taxPayments).set({ journalId: journal.id }).where(eq(taxPayments.id, row.id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'TaxPayment', entityId: row.id, data: { number } });
      return { ...row, journalId: journal.id, journalNumber: journal.number };
    });
  }

  // ===================== Rekap =====================

  /**
   * Rekap pajak & BPJS setahun per masa: terutang (dari buku besar), disetor (tanggal & NTPN),
   * selisih, dan ketepatan waktu setor terhadap jatuh tempo.
   */
  async annualRecap(tenantId: string, year: number) {
    const db = this.db;
    const holidays = await this.holidays(tenantId);
    const keys = await this.keyAccounts(db, tenantId);
    const reporting = await this.settings.reporting(db, tenantId);
    const today = todayJakarta();
    const lastMonth = String(year) === today.slice(0, 4) ? Number(today.slice(5, 7)) : String(year) < today.slice(0, 4) ? 12 : 0;
    const payments = (
      await db.execute<{ type: TaxPaymentType; period: string; amount: string; last_date: string; first_date: string; ntpn: string | null; n: number }>(sql`
        SELECT type, period, SUM(amount)::text AS amount, MAX(date)::text AS last_date, MIN(date)::text AS first_date,
               STRING_AGG(NULLIF(ntpn, ''), ', ' ORDER BY date) AS ntpn, COUNT(*)::int AS n
        FROM tax_payments WHERE tenant_id = ${tenantId} AND period LIKE ${`${year}-%`} GROUP BY type, period`)
    ).rows;
    const pay = (type: TaxPaymentType, period: string) => payments.find((p) => p.type === type && p.period === period);

    let installment = ZERO;
    if (reporting.taxScheme !== 'FINAL_UMKM') {
      try {
        installment = D((await this.fiscal.reconcile(tenantId, year - 1)).installment25);
      } catch {
        installment = ZERO;
      }
    }

    // lebih bayar PPN dari masa sebelumnya dikompensasikan ke masa berikutnya
    const prevVat = await this.vatPosition(db, tenantId, `${year - 1}-12`);
    let vatCarry = prevVat.payable.lt(0) ? prevVat.payable.negated() : ZERO;
    const types: TaxPaymentType[] = ['PPN', 'PPH21', 'PPH23', 'PPH4_2', reporting.taxScheme === 'FINAL_UMKM' ? 'PPH_FINAL' : 'PPH25', 'BPJS'];
    type Cell = { period: string; payable: string; paid: string; diff: string; dueDate: string; paidDate: string | null; ntpn: string | null; status: RecapStatus; detail?: Record<string, string> };
    const rows = new Map<TaxPaymentType, Cell[]>(types.map((t) => [t, []]));

    for (let m = 1; m <= 12; m++) {
      const period = `${year}-${String(m).padStart(2, '0')}`;
      const future = m > lastMonth;
      const sums = future ? new Map() : await sumByAccount(db, tenantId, { from: `${period}-01`, to: monthEnd(period), excludeSources: ['TAX_PAYMENT', 'CLOSING'] });
      const credit = (key: SystemKey) => {
        const s = sums.get(keys.get(key) ?? '');
        return s ? s.credit.minus(s.debit) : ZERO;
      };
      for (const type of types) {
        let payable = ZERO;
        let detail: Record<string, string> | undefined;
        if (type === 'PPN') {
          const out = credit(SYS.VAT_OUT);
          const inn = credit(SYS.VAT_IN).negated();
          const comp = vatCarry;
          payable = out.minus(inn).minus(comp);
          if (!future) vatCarry = payable.lt(0) ? payable.negated() : ZERO;
          detail = { keluaran: out.toFixed(2), masukan: inn.toFixed(2), kompensasi: comp.toFixed(2) };
        } else if (type === 'PPH_FINAL') {
          const gross = future ? ZERO : await this.grossRevenue(db, tenantId, period);
          payable = money(gross.times(0.5).div(100)).floor();
          detail = { peredaranBruto: gross.toFixed(2) };
        } else if (type === 'PPH25') {
          payable = future ? ZERO : installment;
        } else {
          payable = credit(LIABILITY_KEY[type]!);
        }
        const p = pay(type, period);
        const paid = D(p?.amount ?? 0);
        const due = this.dueDate(type, period, holidays);
        // PPN lebih bayar: tidak ada yang disetor, selisih dikompensasi ke masa berikutnya
        const target = type === 'PPN' && payable.lt(0) ? ZERO : payable;
        const diff = target.minus(paid);
        let status: RecapStatus;
        if (future) status = 'BELUM_MASA';
        else if (type === 'PPN' && payable.lt(0)) status = 'LEBIH_BAYAR';
        else if (target.isZero() && paid.isZero()) status = 'NIHIL';
        else if (diff.lte(0)) status = p && p.last_date > due ? 'TERLAMBAT' : 'TEPAT';
        else if (paid.gt(0)) status = today > due ? 'KURANG_TERLAMBAT' : 'KURANG';
        else status = today > due ? 'TERLAMBAT_BELUM' : 'BELUM';
        rows.get(type)!.push({
          period,
          payable: payable.toFixed(2),
          paid: paid.toFixed(2),
          diff: diff.toFixed(2),
          dueDate: due,
          paidDate: p?.last_date ?? null,
          ntpn: p?.ntpn ?? null,
          status,
          detail,
        });
      }
    }
    return {
      year,
      taxScheme: reporting.taxScheme,
      types: types.map((type) => {
        const months = rows.get(type)!;
        const sum = (k: 'payable' | 'paid' | 'diff') => months.reduce<Dec>((s, x) => s.plus(x[k]), ZERO).toFixed(2);
        return { type, label: TAX_LABEL[type], months, total: { payable: sum('payable'), paid: sum('paid'), diff: sum('diff') } };
      }),
      corporate: reporting.taxScheme === 'FINAL_UMKM' ? null : await this.corporateSummary(tenantId, year),
    };
  }

  /** Ringkasan PPh Badan tahunan (dari rekonsiliasi fiskal) */
  private async corporateSummary(tenantId: string, year: number) {
    try {
      const f = await this.fiscal.reconcile(tenantId, year);
      const paid29 = (await this.paidIn(this.db, tenantId, 'PPH29', `${year}-12`)).toFixed(2);
      return {
        profitBeforeTax: f.profitBeforeTax,
        fiscalProfit: f.fiscalProfit,
        pkp: f.pkp,
        taxDue: f.taxDue,
        credits: f.credits,
        pph29: f.pph29,
        installment25Next: f.installment25,
        method: f.method,
        journalPosted: !!f.journal,
        paid29,
        dueDate: this.dueDate('PPH29', `${year}-12`, await this.holidays(tenantId)),
      };
    } catch {
      return null;
    }
  }

  /**
   * Rekap PPh 23 & PPh 4(2) yang dipotong dari supplier (bahan bukti potong e-Bupot Unifikasi di Coretax).
   * `period` = YYYY-MM (satu masa) atau YYYY (setahun).
   */
  async withholdingRecap(tenantId: string, period: string) {
    const holidays = await this.holidays(tenantId);
    const isYear = /^\d{4}$/.test(period);
    const from = isYear ? `${period}-01-01` : `${period}-01`;
    const to = isYear ? `${period}-12-31` : monthEnd(period);
    const rows = (
      await this.db.execute<Record<string, string | null>>(sql`
        SELECT pi.id, pi.number, pi.supplier_invoice_no AS "supplierInvoiceNo", pi.date::text AS date, pi.description,
               pi.withholding_type AS type, pi.withholding_base AS base, pi.withholding_rate AS rate, pi.withholding_amount AS amount,
               s.id AS "supplierId", s.code AS "supplierCode", s.name AS "supplierName", s.npwp AS "supplierNpwp", s.address AS "supplierAddress"
        FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
        WHERE pi.tenant_id = ${tenantId} AND pi.withholding_amount > 0 AND pi.date BETWEEN ${from} AND ${to}
        ORDER BY pi.withholding_type, pi.date, pi.number`)
    ).rows;
    const keys = await this.keyAccounts(this.db, tenantId);
    const sums = await sumByAccount(this.db, tenantId, { from, to, excludeSources: ['TAX_PAYMENT', 'CLOSING'] });
    const gl = (key: SystemKey) => {
      const s = sums.get(keys.get(key) ?? '');
      return s ? s.credit.minus(s.debit) : ZERO;
    };
    const summary = (['PPH23', 'PPH4_2'] as const).map((type) => {
      const list = rows.filter((r) => r.type === type);
      const amount = list.reduce<Dec>((s, r) => s.plus(r.amount ?? 0), ZERO);
      const ledger = gl(LIABILITY_KEY[type]!);
      return {
        type,
        label: TAX_LABEL[type],
        count: list.length,
        base: list.reduce<Dec>((s, r) => s.plus(r.base ?? 0), ZERO).toFixed(2),
        amount: amount.toFixed(2),
        ledger: ledger.toFixed(2),
        /** selisih buku besar vs daftar faktur (mis. jurnal manual ke akun utang PPh) */
        unexplained: ledger.minus(amount).toFixed(2),
        dueDate: isYear ? null : this.dueDate(type, period, holidays),
        reportDue: isYear ? null : nextWorkday(`${nextMonth(period)}-20`, holidays),
      };
    });
    const bySupplier = new Map<string, { supplierName: string; supplierNpwp: string | null; type: string; base: Dec; amount: Dec; count: number }>();
    for (const r of rows) {
      const k = `${r.supplierId}|${r.type}`;
      const x = bySupplier.get(k) ?? { supplierName: r.supplierName!, supplierNpwp: r.supplierNpwp, type: r.type!, base: ZERO, amount: ZERO, count: 0 };
      x.base = x.base.plus(r.base ?? 0);
      x.amount = x.amount.plus(r.amount ?? 0);
      x.count++;
      bySupplier.set(k, x);
    }
    return {
      period,
      rows,
      summary,
      bySupplier: [...bySupplier.values()].map((x) => ({ ...x, base: x.base.toFixed(2), amount: x.amount.toFixed(2) })),
      missingNpwp: [...new Set(rows.filter((r) => !r.supplierNpwp?.trim()).map((r) => r.supplierName))],
    };
  }

  /** Batalkan setoran yang salah input: jurnal dibalik, catatan setoran dihapus */
  async remove(user: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(taxPayments).where(and(eq(taxPayments.id, id), eq(taxPayments.tenantId, user.tenantId)));
      if (!row) throw new NotFoundException('Setoran tidak ditemukan');
      const later = await tx
        .select({ n: taxPayments.number })
        .from(taxPayments)
        .where(and(eq(taxPayments.tenantId, user.tenantId), eq(taxPayments.type, row.type), sql`${taxPayments.period} > ${row.period}`))
        .limit(1);
      if (row.type === 'PPN' && later.length) throw new BadRequestException(`Batalkan dulu setoran PPN masa berikutnya (${later[0].n})`);
      if (row.journalId) await this.posting.reverse(tx, user.tenantId, row.journalId, todayJakarta() < row.date ? row.date : todayJakarta(), user.sub, true);
      await tx.delete(taxPayments).where(eq(taxPayments.id, id));
      return { ok: true };
    });
  }
}

export const TAX_LABEL: Record<TaxPaymentType, string> = {
  PPN: 'PPN',
  PPH21: 'PPh 21',
  PPH23: 'PPh 23',
  PPH4_2: 'PPh 4 ayat 2',
  PPH25: 'PPh 25',
  PPH29: 'PPh 29',
  PPH_FINAL: 'PPh final 0,5%',
  BPJS: 'Iuran BPJS',
};

// ---------- Controller ----------
@ApiTags('Setoran pajak')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE')
@Controller('tax')
export class TaxController {
  constructor(private readonly svc: TaxService) {}

  @Get('obligations')
  obligations(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : todayJakarta().slice(0, 7);
    return this.svc.obligations(u.tenantId, p);
  }
  @Get('reports/annual')
  annual(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.svc.annualRecap(u.tenantId, yearQuery(year, Number(todayJakarta().slice(0, 4))));
  }
  @Get('reports/withholding')
  withholding(@CurrentUser() u: AuthUser, @Query('period') period?: string) {
    const p = period && /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(period) ? period : todayJakarta().slice(0, 7);
    return this.svc.withholdingRecap(u.tenantId, p);
  }
  @Get('payments')
  list(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.svc.list(u.tenantId, yearQuery(year, undefined));
  }
  @Post('payments')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTaxPaymentDto) {
    return this.svc.create(u, dto);
  }
  @Delete('payments/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(u, id);
  }
}

@Module({
  imports: [AccountingModule, InsightsModule],
  controllers: [TaxController],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}

/**
 * Laporan keuangan sesuai SAK EP (Entitas Privat) dan SAK EMKM:
 *  - Laporan Posisi Keuangan (lancar / tidak lancar) dengan angka pembanding
 *  - Laporan Laba Rugi bertingkat (fungsi beban) / bentuk sederhana EMKM
 *  - Laporan Perubahan Ekuitas
 *  - Laporan Arus Kas metode tidak langsung & langsung (rekonsiliasi otomatis ke saldo kas)
 *  - Neraca Saldo lengkap (saldo awal, mutasi, saldo akhir) dan Neraca Lajur (worksheet)
 */
import { Injectable } from '@nestjs/common';
import { asFramework, REPORT_GROUPS, type ReportGroup, type ReportingFramework, SECTION_LABELS, type StatementSection, BUSINESS_MODEL_KEYS, type BusinessModel, REPORT_TERMS } from '@sansu/shared';
import { eq, sql } from 'drizzle-orm';
import { addDays, DocDate, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { tenants } from '../../db/schema';
import {
  AccountMeta,
  ADJUSTING_SOURCES,
  dayBefore,
  get,
  loadAccounts,
  natural,
  Sum,
  sumByAccount,
  unclosedEarnings,
} from './ledger-data';

const s2 = (d: Dec) => d.toFixed(2);

export interface AccountAmount {
  id: string;
  code: string;
  name: string;
  amount: string;
  compare: string;
}
export interface StatementLine {
  key: string;
  label: string;
  kind: 'group' | 'subtotal' | 'total';
  parts?: string[];
  amount: string;
  compare: string;
  accounts?: AccountAmount[];
}

/** Rentang pembanding bawaan: periode yang sama tahun sebelumnya */
export function previousYear(d: DocDate) {
  const y = Number(d.slice(0, 4)) - 1;
  const md = d.slice(5);
  // 29 Februari → 28 Februari
  return md === '02-29' ? `${y}-02-28` : `${y}-${md}`;
}

interface Range {
  from: DocDate;
  to: DocDate;
}

@Injectable()
export class StatementsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async framework(tenantId: string): Promise<ReportingFramework> {
    const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const fw = (t?.settings as { reporting?: { framework?: string } })?.reporting?.framework;
    return asFramework(fw);
  }

  /** Jenis usaha perusahaan (Dagang bila belum pernah dipilih) — menentukan istilah di laporan */
  async businessModel(tenantId: string): Promise<BusinessModel> {
    const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const m = (t?.settings as { business?: { model?: string } })?.business?.model ?? '';
    return (BUSINESS_MODEL_KEYS as readonly string[]).includes(m) ? (m as BusinessModel) : 'DAGANG';
  }

  /**
   * Normalisasi parameter periode: bawaan awal tahun berjalan s/d hari ini.
   * Pembanding: bila periode dimulai 1 Januari, tahun buku lalu penuh (1 Jan – 31 Des) sehingga kolom pembanding laba rugi
   * berakhir di 31 Desember seperti pembanding laporan posisi keuangan; periode lain dibandingkan dengan rentang yang sama tahun lalu.
   */
  ranges(q: { from?: string; to?: string; compareFrom?: string; compareTo?: string }) {
    const to = toDocDate(q.to);
    const from = q.from ? toDocDate(q.from) : `${to.slice(0, 4)}-01-01`;
    const cmp: Range = {
      from: q.compareFrom ? toDocDate(q.compareFrom) : previousYear(from),
      to: q.compareTo ? toDocDate(q.compareTo) : from.slice(5) === '01-01' ? `${Number(from.slice(0, 4)) - 1}-12-31` : previousYear(to),
    };
    return { cur: { from, to }, cmp };
  }

  // ---------- Laporan posisi keuangan ----------

  async financialPosition(tenantId: string, asOf?: string, compareAsOf?: string) {
    const date = toDocDate(asOf);
    const cDate = compareAsOf ? toDocDate(compareAsOf) : `${Number(date.slice(0, 4)) - 1}-12-31`;
    const accs = await loadAccounts(this.db, tenantId);
    const [cur, cmp] = await Promise.all([sumByAccount(this.db, tenantId, { to: date }), sumByAccount(this.db, tenantId, { to: cDate })]);
    const earnings = { cur: unclosedEarnings(accs, cur), cmp: unclosedEarnings(accs, cmp) };

    const sections: StatementSection[] = ['CURRENT_ASSET', 'NONCURRENT_ASSET', 'CURRENT_LIABILITY', 'NONCURRENT_LIABILITY', 'EQUITY'];
    const out = sections.map((section) => {
      const groups = (Object.keys(REPORT_GROUPS) as ReportGroup[])
        .filter((g) => REPORT_GROUPS[g].section === section)
        .sort((a, b) => REPORT_GROUPS[a].order - REPORT_GROUPS[b].order);
      const lines: StatementLine[] = [];
      for (const g of groups) {
        const members = accs.filter((a) => a.isPostable && a.reportGroup === g);
        const items: AccountAmount[] = members.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          amount: s2(natural(a.type, get(cur, a.id))),
          compare: s2(natural(a.type, get(cmp, a.id))),
        }));
        if (g === 'RETAINED_EARNINGS') {
          items.push({ id: 'unclosed', code: '', name: 'Laba (rugi) belum ditutup ke saldo laba', amount: s2(earnings.cur), compare: s2(earnings.cmp) });
        }
        const amount = items.reduce<Dec>((a, i) => a.plus(i.amount), ZERO);
        const compare = items.reduce<Dec>((a, i) => a.plus(i.compare), ZERO);
        if (amount.isZero() && compare.isZero() && g !== 'RETAINED_EARNINGS') continue;
        lines.push({
          key: g,
          label: REPORT_GROUPS[g].label,
          kind: 'group',
          amount: s2(amount),
          compare: s2(compare),
          accounts: items.filter((i) => !D(i.amount).isZero() || !D(i.compare).isZero()),
        });
      }
      const total = lines.reduce<Dec>((a, l) => a.plus(l.amount), ZERO);
      const compare = lines.reduce<Dec>((a, l) => a.plus(l.compare), ZERO);
      return { key: section, label: SECTION_LABELS[section], lines, total: s2(total), compareTotal: s2(compare) };
    });
    const t = (keys: StatementSection[], k: 'total' | 'compareTotal') => keys.reduce<Dec>((a, s) => a.plus(out.find((o) => o.key === s)![k]), ZERO);
    const assets = { amount: t(['CURRENT_ASSET', 'NONCURRENT_ASSET'], 'total'), compare: t(['CURRENT_ASSET', 'NONCURRENT_ASSET'], 'compareTotal') };
    const liabilities = { amount: t(['CURRENT_LIABILITY', 'NONCURRENT_LIABILITY'], 'total'), compare: t(['CURRENT_LIABILITY', 'NONCURRENT_LIABILITY'], 'compareTotal') };
    const equity = { amount: t(['EQUITY'], 'total'), compare: t(['EQUITY'], 'compareTotal') };
    const le = { amount: liabilities.amount.plus(equity.amount), compare: liabilities.compare.plus(equity.compare) };
    const fmt = (x: { amount: Dec; compare: Dec }) => ({ amount: s2(x.amount), compare: s2(x.compare) });
    return {
      asOf: date,
      compareAsOf: cDate,
      sections: out,
      totals: { assets: fmt(assets), liabilities: fmt(liabilities), equity: fmt(equity), liabilitiesEquity: fmt(le) },
      balanced: assets.amount.eq(le.amount) && assets.compare.eq(le.compare),
    };
  }

  // ---------- Laporan laba rugi ----------

  async income(tenantId: string, q: { from?: string; to?: string; compareFrom?: string; compareTo?: string }, fw?: ReportingFramework) {
    const framework = fw ?? (await this.framework(tenantId));
    const terms = REPORT_TERMS[await this.businessModel(tenantId)];
    const { cur, cmp } = this.ranges(q);
    const accs = await loadAccounts(this.db, tenantId);
    const [a, b] = await Promise.all([
      sumByAccount(this.db, tenantId, { ...cur, excludeSources: ['CLOSING'] }),
      sumByAccount(this.db, tenantId, { ...cmp, excludeSources: ['CLOSING'] }),
    ]);
    // Kontribusi terhadap laba: pendapatan (+), beban (−)
    const contrib = (acc: AccountMeta, m: Map<string, Sum>) => {
      const n = natural(acc.type, get(m, acc.id));
      return acc.type === 'EXPENSE' ? n.negated() : n;
    };
    const group = (g: ReportGroup | ReportGroup[], key: string, label: string): StatementLine => {
      const gs = Array.isArray(g) ? g : [g];
      const members = accs.filter((x) => x.isPostable && gs.includes(x.reportGroup));
      const items = members
        .map((x) => ({ id: x.id, code: x.code, name: x.name, amount: s2(contrib(x, a)), compare: s2(contrib(x, b)) }))
        .filter((i) => !D(i.amount).isZero() || !D(i.compare).isZero());
      return {
        key,
        label,
        kind: 'group',
        amount: s2(items.reduce<Dec>((s, i) => s.plus(i.amount), ZERO)),
        compare: s2(items.reduce<Dec>((s, i) => s.plus(i.compare), ZERO)),
        accounts: items,
      };
    };
    const sub = (key: string, label: string, parts: StatementLine[], kind: 'subtotal' | 'total' = 'subtotal'): StatementLine => ({
      key,
      label,
      kind,
      parts: parts.map((p) => p.key),
      amount: s2(parts.reduce<Dec>((s, p) => s.plus(p.amount), ZERO)),
      compare: s2(parts.reduce<Dec>((s, p) => s.plus(p.compare), ZERO)),
    });

    let lines: StatementLine[];
    if (framework === 'SAK_EMKM') {
      const revenue = group(['SALES_REVENUE', 'SALES_DEDUCTION'], 'REVENUE', terms.revenueLabel);
      const other = group(['OTHER_INCOME', 'FINANCE_INCOME'], 'OTHER_REVENUE', 'Pendapatan lain-lain');
      const totalRev = sub('TOTAL_REVENUE', 'Jumlah pendapatan', [revenue, other]);
      const cos = group('COST_OF_SALES', 'COST_OF_SALES', terms.cogsLabel);
      const opex = group(['SELLING_EXPENSE', 'ADMIN_EXPENSE'], 'OPERATING_EXPENSE', 'Beban usaha');
      const otherExp = group(['OTHER_EXPENSE', 'FINANCE_COST'], 'OTHER_EXPENSE', 'Beban lain-lain');
      const totalExp = sub('TOTAL_EXPENSE', 'Jumlah beban', [cos, opex, otherExp]);
      const pbt = sub('PROFIT_BEFORE_TAX', 'Laba (rugi) sebelum pajak penghasilan', [totalRev, totalExp]);
      const tax = group('INCOME_TAX', 'INCOME_TAX', 'Beban pajak penghasilan');
      const net = sub('NET_PROFIT', 'Laba (rugi) periode berjalan', [pbt, tax], 'total');
      lines = [revenue, other, totalRev, cos, opex, otherExp, totalExp, pbt, tax, net];
    } else {
      const sales = group('SALES_REVENUE', 'SALES_REVENUE', terms.revenueLabel);
      const ded = group('SALES_DEDUCTION', 'SALES_DEDUCTION', 'Retur dan potongan penjualan');
      const netRev = sub('NET_REVENUE', 'Pendapatan neto', [sales, ded]);
      const cos = group('COST_OF_SALES', 'COST_OF_SALES', terms.cogsLabel);
      const gross = sub('GROSS_PROFIT', 'Laba bruto', [netRev, cos]);
      const selling = group('SELLING_EXPENSE', 'SELLING_EXPENSE', 'Beban penjualan');
      const admin = group('ADMIN_EXPENSE', 'ADMIN_EXPENSE', 'Beban umum dan administrasi');
      const opProfit = sub('OPERATING_PROFIT', 'Laba (rugi) usaha', [gross, selling, admin]);
      const oi = group('OTHER_INCOME', 'OTHER_INCOME', 'Pendapatan lain-lain');
      const oe = group('OTHER_EXPENSE', 'OTHER_EXPENSE', 'Beban lain-lain');
      const fi = group('FINANCE_INCOME', 'FINANCE_INCOME', 'Pendapatan keuangan');
      const fc = group('FINANCE_COST', 'FINANCE_COST', 'Beban keuangan');
      const pbt = sub('PROFIT_BEFORE_TAX', 'Laba (rugi) sebelum pajak penghasilan', [opProfit, oi, oe, fi, fc]);
      const tax = group('INCOME_TAX', 'INCOME_TAX', 'Beban pajak penghasilan');
      const net = sub('NET_PROFIT', 'Laba (rugi) tahun berjalan', [pbt, tax], 'total');
      const oci: StatementLine = { key: 'OCI', label: 'Penghasilan komprehensif lain', kind: 'group', amount: '0.00', compare: '0.00', accounts: [] };
      const tci = sub('TOTAL_COMPREHENSIVE', 'Total penghasilan komprehensif tahun berjalan', [net, oci], 'total');
      lines = [sales, ded, netRev, cos, gross, selling, admin, opProfit, oi, oe, fi, fc, pbt, tax, net, oci, tci];
    }
    const pick = (k: string) => lines.find((l) => l.key === k)!;
    return {
      framework,
      period: cur,
      comparePeriod: cmp,
      lines,
      netProfit: pick('NET_PROFIT').amount,
      compareNetProfit: pick('NET_PROFIT').compare,
    };
  }

  // ---------- Laporan perubahan ekuitas ----------

  async equityChanges(tenantId: string, q: { from?: string; to?: string; compareFrom?: string; compareTo?: string }) {
    const { cur, cmp } = this.ranges(q);
    const accs = await loadAccounts(this.db, tenantId);
    const [current, previous] = await Promise.all([this.equityFor(tenantId, accs, cur), this.equityFor(tenantId, accs, cmp)]);
    return { period: cur, comparePeriod: cmp, columns: EQUITY_COLUMNS, current, previous };
  }

  private async equityFor(tenantId: string, accs: AccountMeta[], r: Range) {
    const [opening, moves] = await Promise.all([
      sumByAccount(this.db, tenantId, { to: dayBefore(r.from) }),
      sumByAccount(this.db, tenantId, { ...r, excludeSources: ['CLOSING'] }),
    ]);
    const col = (g: ReportGroup): EquityColumn =>
      g === 'SHARE_CAPITAL' ? 'SHARE_CAPITAL' : g === 'ADDITIONAL_CAPITAL' ? 'ADDITIONAL_CAPITAL' : g === 'OTHER_EQUITY' ? 'OTHER' : 'RETAINED';
    const zero = () => ({ SHARE_CAPITAL: ZERO, ADDITIONAL_CAPITAL: ZERO, RETAINED: ZERO, OTHER: ZERO }) as Record<EquityColumn, Dec>;
    const open = zero();
    const contributions = zero();
    const dividends = zero();
    const others = zero();
    for (const a of accs.filter((x) => x.type === 'EQUITY' && x.isPostable)) {
      const c = col(a.reportGroup);
      open[c] = open[c].plus(natural(a.type, get(opening, a.id)));
      const m = natural(a.type, get(moves, a.id));
      if (a.reportGroup === 'SHARE_CAPITAL' || a.reportGroup === 'ADDITIONAL_CAPITAL') contributions[c] = contributions[c].plus(m);
      else if (a.reportGroup === 'DIVIDEND') dividends[c] = dividends[c].plus(m);
      else others[c] = others[c].plus(m);
    }
    open.RETAINED = open.RETAINED.plus(unclosedEarnings(accs, opening));
    const profit = zero();
    profit.RETAINED = unclosedEarnings(accs, moves);
    const oci = zero();
    const closing = zero();
    for (const k of Object.keys(closing) as EquityColumn[]) {
      closing[k] = open[k].plus(profit[k]).plus(contributions[k]).plus(dividends[k]).plus(others[k]);
    }
    const row = (key: string, label: string, v: Record<EquityColumn, Dec>, kind: 'balance' | 'movement' = 'movement') => ({
      key,
      label,
      kind,
      values: {
        SHARE_CAPITAL: s2(v.SHARE_CAPITAL),
        ADDITIONAL_CAPITAL: s2(v.ADDITIONAL_CAPITAL),
        RETAINED: s2(v.RETAINED),
        OTHER: s2(v.OTHER),
        TOTAL: s2(v.SHARE_CAPITAL.plus(v.ADDITIONAL_CAPITAL).plus(v.RETAINED).plus(v.OTHER)),
      },
    });
    return {
      period: r,
      rows: [
        row('OPENING', `Saldo per ${dayBefore(r.from)}`, open, 'balance'),
        row('PROFIT', 'Laba (rugi) periode berjalan', profit),
        row('OCI', 'Penghasilan komprehensif lain', oci),
        row('CONTRIBUTION', 'Setoran modal', contributions),
        row('DIVIDEND', 'Dividen / prive', dividends),
        row('OTHER', 'Saldo awal & mutasi ekuitas lainnya', others),
        row('CLOSING', `Saldo per ${r.to}`, closing, 'balance'),
      ].filter((x) => x.kind === 'balance' || x.key === 'PROFIT' || x.values.TOTAL !== '0.00' || Object.values(x.values).some((v) => v !== '0.00')),
    };
  }

  // ---------- Laporan arus kas ----------

  async cashFlow(tenantId: string, q: { from?: string; to?: string; compareFrom?: string; compareTo?: string; method?: string }) {
    const { cur, cmp } = this.ranges(q);
    const method = q.method === 'direct' ? 'direct' : 'indirect';
    const accs = await loadAccounts(this.db, tenantId);
    const fn = method === 'direct' ? (r: Range) => this.cashDirect(tenantId, accs, r) : (r: Range) => this.cashIndirect(tenantId, accs, r);
    const [current, previous] = await Promise.all([fn(cur), fn(cmp)]);
    return { method, period: cur, comparePeriod: cmp, current, previous };
  }

  private async cashBalance(tenantId: string, accs: AccountMeta[], to: DocDate) {
    const m = await sumByAccount(this.db, tenantId, { to });
    return accs.filter((a) => a.reportGroup === 'CASH_EQUIVALENT').reduce<Dec>((s, a) => s.plus(natural(a.type, get(m, a.id))), ZERO);
  }

  /** Kas awal = saldo sebelum periode + kas dari jurnal saldo awal di dalam periode (bukan arus kas) */
  private async openingCash(tenantId: string, accs: AccountMeta[], r: Range) {
    const [before, op] = await Promise.all([
      this.cashBalance(tenantId, accs, dayBefore(r.from)),
      sumByAccount(this.db, tenantId, { ...r, openingLike: 'only' }),
    ]);
    return accs.filter((a) => a.reportGroup === 'CASH_EQUIVALENT').reduce<Dec>((x, a) => x.plus(natural(a.type, get(op, a.id))), before);
  }

  private pack(opening: Dec, closing: Dec, sec: Record<'operating' | 'investing' | 'financing', Map<string, Dec>>) {
    const section = (m: Map<string, Dec>) => {
      const items = [...m.entries()].filter(([, v]) => !v.isZero()).map(([label, amount]) => ({ label, amount: s2(amount) }));
      return { items, total: s2([...m.values()].reduce<Dec>((a, v) => a.plus(v), ZERO)) };
    };
    const operating = section(sec.operating);
    const investing = section(sec.investing);
    const financing = section(sec.financing);
    const net = D(operating.total).plus(investing.total).plus(financing.total);
    return {
      opening: s2(opening),
      operating,
      investing,
      financing,
      netChange: s2(net),
      closing: s2(opening.plus(net)),
      actualClosing: s2(closing),
      difference: s2(closing.minus(opening.plus(net))),
    };
  }

  /** Metode tidak langsung: laba + penyesuaian non-kas + perubahan modal kerja */
  private async cashIndirect(tenantId: string, accs: AccountMeta[], r: Range) {
    const [moves, depMoves, opening, closing] = await Promise.all([
      sumByAccount(this.db, tenantId, { ...r, excludeSources: ['CLOSING'], openingLike: 'exclude' }),
      // penyusutan dari jurnal mana pun kecuali pelepasan aset
      sumByAccount(this.db, tenantId, { ...r, excludeSources: ['CLOSING', 'ASSET_DISPOSAL'], openingLike: 'exclude' }),
      this.openingCash(tenantId, accs, r),
      this.cashBalance(tenantId, accs, r.to),
    ]);
    const sec = { operating: new Map<string, Dec>(), investing: new Map<string, Dec>(), financing: new Map<string, Dec>() };
    const add = (s: keyof typeof sec, label: string, v: Dec) => sec[s].set(label, (sec[s].get(label) ?? ZERO).plus(v));

    add('operating', 'Laba (rugi) periode berjalan', unclosedEarnings(accs, moves));
    // Penyusutan & amortisasi (beban non-kas)
    const dep = accs
      .filter((a) => REPORT_GROUPS[a.reportGroup].cashFlow === 'DEPRECIATION')
      .reduce<Dec>((s, a) => s.plus(get(depMoves, a.id).credit).minus(get(depMoves, a.id).debit), ZERO);
    add('operating', 'Penyusutan dan amortisasi', dep);
    // (Laba) rugi pelepasan aset tetap → dipindah ke investasi
    const gain = accs
      .filter((a) => a.systemKey === 'ASSET_DISPOSAL_GAIN' || a.systemKey === 'ASSET_DISPOSAL_LOSS')
      .reduce<Dec>((s, a) => s.plus(get(moves, a.id).credit).minus(get(moves, a.id).debit), ZERO);
    add('operating', '(Laba) rugi pelepasan aset tetap', gain.negated());

    let noncurrentNet: Dec = ZERO;
    let purchases: Dec = ZERO;
    for (const a of accs.filter((x) => x.isPostable && ['ASSET', 'LIABILITY', 'EQUITY'].includes(x.type))) {
      const info = REPORT_GROUPS[a.reportGroup];
      const s = get(moves, a.id);
      const m = natural(a.type, s);
      if (m.isZero() && s.debit.isZero()) continue;
      switch (info.cashFlow) {
        case 'CASH':
          break;
        case 'WORKING_CAPITAL': {
          // Aset naik = kas turun; liabilitas naik = kas naik
          const v = a.type === 'ASSET' ? m.negated() : m;
          const label = a.type === 'ASSET' ? `(Kenaikan) penurunan ${info.label.toLowerCase()}` : `Kenaikan (penurunan) ${info.label.toLowerCase()}`;
          add('operating', label, v);
          break;
        }
        case 'NONCURRENT':
        case 'DEPRECIATION':
          noncurrentNet = noncurrentNet.plus(m);
          if (info.cashFlow === 'NONCURRENT') purchases = purchases.plus(s.debit);
          break;
        case 'FINANCING': {
          const label =
            a.reportGroup === 'SHARE_CAPITAL' || a.reportGroup === 'ADDITIONAL_CAPITAL'
              ? 'Setoran modal'
              : a.reportGroup === 'DIVIDEND'
                ? 'Pembayaran dividen / prive'
                : a.reportGroup === 'OTHER_EQUITY'
                  ? 'Saldo awal / ekuitas lainnya'
                  : a.type === 'LIABILITY'
                    ? 'Penerimaan (pembayaran) pinjaman'
                    : info.label;
          add('financing', label, m);
          break;
        }
        case 'RETAINED':
          add('operating', 'Koreksi saldo laba', m);
          break;
      }
    }
    // Investasi = −(perubahan aset tidak lancar neto) − penyusutan + laba pelepasan
    const investing = noncurrentNet.negated().minus(dep).plus(gain);
    add('investing', 'Perolehan aset tetap dan aset tidak lancar lainnya', purchases.negated());
    add('investing', 'Hasil pelepasan aset tetap', investing.plus(purchases));
    return this.pack(opening, closing, sec);
  }

  /** Metode langsung: setiap jurnal kas dialokasikan ke jenis penerimaan / pembayaran dari akun lawannya */
  private async cashDirect(tenantId: string, accs: AccountMeta[], r: Range) {
    const byId = new Map(accs.map((a) => [a.id, a]));
    const [opening, closing] = await Promise.all([this.openingCash(tenantId, accs, r), this.cashBalance(tenantId, accs, r.to)]);
    const res = await this.db.execute<{ journal_id: string; account_id: string; debit: string; credit: string }>(sql`
      SELECT l.journal_id, l.account_id, l.debit, l.credit
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${r.from} AND ${r.to} AND j.source_type NOT IN ('CLOSING', 'OPENING')
        AND EXISTS (SELECT 1 FROM journal_lines l2 JOIN accounts a2 ON a2.id = l2.account_id
                    WHERE l2.journal_id = j.id AND (a2.is_cash_account = true OR a2.report_group = 'CASH_EQUIVALENT'))`);
    const journals = new Map<string, typeof res.rows>();
    for (const row of res.rows) journals.set(row.journal_id, [...(journals.get(row.journal_id) ?? []), row]);

    const sec = { operating: new Map<string, Dec>(), investing: new Map<string, Dec>(), financing: new Map<string, Dec>() };
    const add = (s: keyof typeof sec, label: string, v: Dec) => sec[s].set(label, (sec[s].get(label) ?? ZERO).plus(v));
    const SALARY = ['SALARY_PAYABLE', 'BPJS_PAYABLE', 'SALARY_EXPENSE', 'BPJS_EXPENSE'];

    const classify = (a: AccountMeta): [keyof typeof sec, string] | null => {
      const g = a.reportGroup;
      if (a.systemKey && SALARY.includes(a.systemKey)) return ['operating', 'Pembayaran kepada karyawan'];
      if (['SALES_REVENUE', 'SALES_DEDUCTION', 'TRADE_RECEIVABLE', 'ALLOWANCE_RECEIVABLE', 'UNEARNED_REVENUE'].includes(g)) return ['operating', 'Penerimaan dari pelanggan'];
      if (['TRADE_PAYABLE', 'INVENTORY', 'COST_OF_SALES'].includes(g)) return ['operating', 'Pembayaran kepada pemasok'];
      if (['TAX_PAYABLE', 'PREPAID_TAX', 'INCOME_TAX', 'DEFERRED_TAX_ASSET', 'DEFERRED_TAX_LIABILITY'].includes(g)) return null; // ikut konteks
      if (g === 'FINANCE_COST') return ['operating', 'Pembayaran bunga dan beban keuangan'];
      if (g === 'FINANCE_INCOME') return ['operating', 'Penerimaan bunga'];
      const cf = REPORT_GROUPS[g].cashFlow;
      if (cf === 'NONCURRENT' || cf === 'DEPRECIATION' || a.systemKey === 'ASSET_DISPOSAL_GAIN' || a.systemKey === 'ASSET_DISPOSAL_LOSS')
        return ['investing', 'Aset tetap'];
      if (g === 'SHARE_CAPITAL' || g === 'ADDITIONAL_CAPITAL') return ['financing', 'Setoran modal'];
      if (g === 'DIVIDEND') return ['financing', 'Pembayaran dividen / prive'];
      if (g === 'OTHER_EQUITY') return ['financing', 'Saldo awal / ekuitas lainnya'];
      if (g === 'SHORT_TERM_LOAN' || g === 'LONG_TERM_LOAN' || g === 'OTHER_NONCURRENT_LIABILITY') return ['financing', 'Penerimaan (pembayaran) pinjaman'];
      return ['operating', 'Pembayaran beban operasional lainnya'];
    };

    for (const lines of journals.values()) {
      const nonCash = lines.filter((l) => byId.get(l.account_id)?.reportGroup !== 'CASH_EQUIVALENT');
      if (!nonCash.length) continue; // transfer antar kas/bank
      // Konteks jurnal = akun non-pajak terbesar
      const ranked = nonCash
        .map((l) => ({ l, a: byId.get(l.account_id)!, size: D(l.debit).plus(l.credit) }))
        .sort((x, y) => y.size.comparedTo(x.size));
      const ctx = ranked.map((x) => classify(x.a)).find((c) => c) ?? (['operating', 'Pembayaran pajak'] as [keyof typeof sec, string]);
      const local = new Map<string, { section: keyof typeof sec; value: Dec; revenue: boolean }>();
      for (const { l, a } of ranked) {
        // Kontribusi ke kas = kredit − debit pada akun lawan
        const v = D(l.credit).minus(l.debit);
        if (v.isZero()) continue;
        let c = classify(a);
        if (!c) c = ctx[1] === 'Penerimaan dari pelanggan' || ctx[1] === 'Pembayaran kepada pemasok' ? ctx : ['operating', 'Pembayaran pajak'];
        const cur = local.get(c[1]) ?? { section: c[0], value: ZERO, revenue: false };
        local.set(c[1], { section: c[0], value: cur.value.plus(v), revenue: cur.revenue || a.type === 'REVENUE' });
      }
      // Satu jurnal → satu nilai neto per jenis (mis. pelepasan aset: kas masuk neto, bukan per baris)
      for (const [label0, { section, value, revenue }] of local) {
        if (value.isZero()) continue;
        let label = label0;
        if (label === 'Aset tetap') label = value.isNegative() ? 'Perolehan aset tetap' : 'Hasil pelepasan aset tetap';
        if (label === 'Pembayaran beban operasional lainnya' && value.isPositive() && revenue) label = 'Penerimaan operasional lainnya';
        add(section, label, value);
      }
    }
    return this.pack(opening, closing, sec);
  }

  // ---------- Neraca saldo lengkap ----------

  async trialBalance(tenantId: string, q: { from?: string; to?: string; hideZero?: string }) {
    const to = toDocDate(q.to);
    const from = q.from ? toDocDate(q.from) : `${to.slice(0, 4)}-01-01`;
    const accs = await loadAccounts(this.db, tenantId);
    const [open, mov] = await Promise.all([sumByAccount(this.db, tenantId, { to: dayBefore(from) }), sumByAccount(this.db, tenantId, { from, to })]);
    const side = (net: Dec) => ({ debit: s2(net.gt(0) ? net : ZERO), credit: s2(net.lt(0) ? net.abs() : ZERO) });
    const rows = accs
      .filter((a) => a.isPostable)
      .map((a) => {
        const o = get(open, a.id);
        const m = get(mov, a.id);
        const openNet = o.debit.minus(o.credit);
        const closeNet = openNet.plus(m.debit).minus(m.credit);
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          type: a.type,
          reportGroup: a.reportGroup,
          opening: side(openNet),
          movement: { debit: s2(m.debit), credit: s2(m.credit) },
          closing: side(closeNet),
        };
      })
      .filter((r) => q.hideZero === 'false' || [r.opening.debit, r.opening.credit, r.movement.debit, r.movement.credit].some((v) => v !== '0.00'));
    const tot = (f: (r: (typeof rows)[number]) => string) => s2(rows.reduce<Dec>((s, r) => s.plus(f(r)), ZERO));
    const totals = {
      opening: { debit: tot((r) => r.opening.debit), credit: tot((r) => r.opening.credit) },
      movement: { debit: tot((r) => r.movement.debit), credit: tot((r) => r.movement.credit) },
      closing: { debit: tot((r) => r.closing.debit), credit: tot((r) => r.closing.credit) },
    };
    return {
      period: { from, to },
      rows,
      totals,
      balanced: totals.opening.debit === totals.opening.credit && totals.movement.debit === totals.movement.credit && totals.closing.debit === totals.closing.credit,
    };
  }

  // ---------- Neraca lajur (worksheet) ----------

  async worksheet(tenantId: string, q: { from?: string; to?: string }) {
    const to = toDocDate(q.to);
    const from = q.from ? toDocDate(q.from) : `${to.slice(0, 4)}-01-01`;
    const accs = await loadAccounts(this.db, tenantId);
    const [open, unadj, adj] = await Promise.all([
      sumByAccount(this.db, tenantId, { to: dayBefore(from) }),
      sumByAccount(this.db, tenantId, { from, to, excludeSources: ['CLOSING', ...ADJUSTING_SOURCES], reversalInheritsSource: true }),
      sumByAccount(this.db, tenantId, { from, to, onlySources: ADJUSTING_SOURCES, reversalInheritsSource: true }),
    ]);
    const isPL = (a: AccountMeta) => a.type === 'REVENUE' || a.type === 'EXPENSE';
    const pair = (net: Dec) => ({ debit: net.gt(0) ? net : ZERO, credit: net.lt(0) ? net.abs() : ZERO });
    type W = { ns: Dec; adj: Sum; adjusted: Dec };
    const rows: { id: string; code: string; name: string; isPL: boolean; w: W }[] = [];
    for (const a of accs.filter((x) => x.isPostable)) {
      const base = isPL(a) ? ZERO : get(open, a.id).debit.minus(get(open, a.id).credit);
      const ns = base.plus(get(unadj, a.id).debit).minus(get(unadj, a.id).credit);
      const ad = get(adj, a.id);
      const adjusted = ns.plus(ad.debit).minus(ad.credit);
      if (ns.isZero() && ad.debit.isZero() && ad.credit.isZero()) continue;
      rows.push({ id: a.id, code: a.code, name: a.name, isPL: isPL(a), w: { ns, adj: ad, adjusted } });
    }
    // Laba tahun-tahun lalu yang belum ditutup (agar lajur seimbang)
    const prior = unclosedEarnings(accs, open);
    if (!prior.isZero()) {
      rows.push({
        id: 'prior',
        code: '',
        name: 'Laba (rugi) tahun lalu belum ditutup',
        isPL: false,
        w: { ns: prior.negated(), adj: { debit: ZERO, credit: ZERO }, adjusted: prior.negated() },
      });
    }
    const out = rows.map((r) => {
      const ns = pair(r.w.ns);
      const ad = pair(r.w.adjusted);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        isPL: r.isPL,
        trial: { debit: s2(ns.debit), credit: s2(ns.credit) },
        adjustment: { debit: s2(r.w.adj.debit), credit: s2(r.w.adj.credit) },
        adjusted: { debit: s2(ad.debit), credit: s2(ad.credit) },
        incomeStatement: r.isPL ? { debit: s2(ad.debit), credit: s2(ad.credit) } : { debit: '0.00', credit: '0.00' },
        balanceSheet: r.isPL ? { debit: '0.00', credit: '0.00' } : { debit: s2(ad.debit), credit: s2(ad.credit) },
      };
    });
    type Col = 'trial' | 'adjustment' | 'adjusted' | 'incomeStatement' | 'balanceSheet';
    const total = (c: Col) => ({
      debit: s2(out.reduce<Dec>((s, r) => s.plus(r[c].debit), ZERO)),
      credit: s2(out.reduce<Dec>((s, r) => s.plus(r[c].credit), ZERO)),
    });
    const totals = {
      trial: total('trial'),
      adjustment: total('adjustment'),
      adjusted: total('adjusted'),
      incomeStatement: total('incomeStatement'),
      balanceSheet: total('balanceSheet'),
    };
    const netProfit = D(totals.incomeStatement.credit).minus(totals.incomeStatement.debit);
    return {
      period: { from, to },
      rows: out,
      totals,
      netProfit: s2(netProfit),
      balanced:
        totals.trial.debit === totals.trial.credit &&
        totals.adjusted.debit === totals.adjusted.credit &&
        D(totals.balanceSheet.debit).minus(totals.balanceSheet.credit).eq(netProfit),
    };
  }

  /** Paket laporan lengkap satu tahun buku (untuk cetak / CALK) */
  async annualPackage(tenantId: string, year: number) {
    const to = `${year}-12-31` < todayJakarta() ? `${year}-12-31` : todayJakarta();
    const from = `${year}-01-01`;
    const q = { from, to, compareFrom: `${year - 1}-01-01`, compareTo: `${year - 1}-12-31` };
    const [framework, position, income, equity, cash] = await Promise.all([
      this.framework(tenantId),
      this.financialPosition(tenantId, to, `${year - 1}-12-31`),
      this.income(tenantId, q),
      this.equityChanges(tenantId, q),
      this.cashFlow(tenantId, { ...q, method: 'indirect' }),
    ]);
    return { year, from, to, framework, position, income, equity, cash };
  }

  /** Total debit & kredit untuk tanggal tertentu (dipakai modul lain) */
  async balancesAt(tenantId: string, to: DocDate) {
    return { accs: await loadAccounts(this.db, tenantId), sums: await sumByAccount(this.db, tenantId, { to }) };
  }

  static addDays = addDays;
}

export const EQUITY_COLUMNS = [
  { key: 'SHARE_CAPITAL', label: 'Modal disetor' },
  { key: 'ADDITIONAL_CAPITAL', label: 'Tambahan modal disetor' },
  { key: 'RETAINED', label: 'Saldo laba' },
  { key: 'OTHER', label: 'Ekuitas lainnya' },
  { key: 'TOTAL', label: 'Jumlah ekuitas' },
] as const;
type EquityColumn = 'SHARE_CAPITAL' | 'ADDITIONAL_CAPITAL' | 'RETAINED' | 'OTHER';

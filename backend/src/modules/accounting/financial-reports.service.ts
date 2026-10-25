import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { AccountType, accounts } from '../../db/schema';
import { resolveSourceRoutes } from './source-route';
import { decryptField } from '../../common/utils/secret';
import { AccountingService, LEDGER_ROW_LIMIT, normal, CashCategory } from './accounting.service';
import { ReferenceRepository } from '../../db/reference.repository';

@Injectable()
export class FinancialReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly accounting: AccountingService,
    private readonly refs: ReferenceRepository,
  ) {}


  // ---------- Laporan ----------

  async trialBalance(tenantId: string, from?: string, to?: string, branchId?: string) {
    const rows = await this.accounting.balances(tenantId, from, to, false, this.db, branchId);
    const totalDebit = rows.reduce<Dec>((a, r) => a.plus(r.debit), ZERO);
    const totalCredit = rows.reduce<Dec>((a, r) => a.plus(r.credit), ZERO);
    return { rows, totalDebit, totalCredit, balanced: totalDebit.eq(totalCredit) };
  }


  async profitLoss(tenantId: string, from?: string, to?: string) {
    const rows = await this.accounting.balances(tenantId, from, to, true);
    const revenue = rows.filter((r) => r.type === 'REVENUE');
    const expense = rows.filter((r) => r.type === 'EXPENSE');
    const totalRevenue = revenue.reduce<Dec>((a, r) => a.plus(r.balance), ZERO);
    const totalExpense = expense.reduce<Dec>((a, r) => a.plus(r.balance), ZERO);
    return { revenue, expense, totalRevenue, totalExpense, netIncome: totalRevenue.minus(totalExpense) };
  }


  /** Neraca per tanggal. Laba berjalan = pendapatan − beban yang belum ditutup ke Laba Ditahan. */
  async balanceSheet(tenantId: string, asOf?: string) {
    const rows = await this.accounting.balances(tenantId, undefined, asOf);
    const pick = (t: AccountType) => rows.filter((r) => r.type === t && !r.balance.isZero());
    const total = (rs: { balance: Dec }[]) => rs.reduce<Dec>((a, r) => a.plus(r.balance), ZERO);

    const currentEarnings = total(rows.filter((r) => r.type === 'REVENUE')).minus(
      total(rows.filter((r) => r.type === 'EXPENSE')),
    );
    const assets = pick('ASSET');
    const liabilities = pick('LIABILITY');
    const equity = pick('EQUITY');
    const totalAssets = total(assets);
    const totalLiabilitiesEquity = total(liabilities).plus(total(equity)).plus(currentEarnings);
    return {
      assets,
      liabilities,
      equity,
      currentEarnings,
      totalAssets,
      totalLiabilitiesEquity,
      balanced: totalAssets.eq(totalLiabilitiesEquity),
    };
  }


  /** Buku besar satu akun: saldo awal, mutasi, saldo berjalan. */
  async ledger(tenantId: string, accountId: string, from?: string, to?: string, rowLimit = LEDGER_ROW_LIMIT, branchId?: string) {
    const brCond = branchId ? (branchId === 'NONE' ? sql`AND l.branch_id IS NULL` : sql`AND l.branch_id = ${branchId}`) : sql``;
    const acc = await this.refs.account(this.db, tenantId, accountId);
    if (!acc) throw new NotFoundException('Akun tidak ditemukan');

    const fromDate = from ? toDocDate(from) : undefined;
    const toDate = to ? toDocDate(to) : undefined;
    const [open] = fromDate
      ? (
          await this.db.execute<{ debit: string; credit: string }>(sql`
            SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
            FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
            WHERE l.account_id = ${accountId} AND j.date < ${fromDate} ${brCond}`)
        ).rows
      : [{ debit: '0', credit: '0' }];
    const opening = normal(acc.type, open.debit, open.credit);

    const res = await this.db.execute<{
      journal_id: string;
      number: string;
      date: string;
      description: string;
      source_type: string;
      source_id: string | null;
      debit: string;
      credit: string;
      memo: string | null;
    }>(sql`
      SELECT j.id AS journal_id, j.number, j.date, j.description, j.source_type, j.source_id, l.debit, l.credit, l.memo
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE l.account_id = ${accountId} ${brCond}
        ${fromDate ? sql`AND j.date >= ${fromDate}` : sql``}
        ${toDate ? sql`AND j.date <= ${toDate}` : sql``}
      ORDER BY j.date, j.number, l.id
      LIMIT ${Math.min(Math.max(1, Math.floor(rowLimit)), 20000)}`);

    // Total, jumlah baris, dan saldo akhir SELALU dari seluruh data rentang itu (bukan dari baris yang ditampilkan):
    // akun dengan baris lebih banyak dari batas tidak boleh menghasilkan saldo akhir yang salah.
    const [agg] = (
      await this.db.execute<{ debit: string; credit: string; n: number }>(sql`
        SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit, COUNT(*)::int AS n
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE l.account_id = ${accountId} ${brCond}
          ${fromDate ? sql`AND j.date >= ${fromDate}` : sql``}
          ${toDate ? sql`AND j.date <= ${toDate}` : sql``}`)
    ).rows;

    const routes = await resolveSourceRoutes(this.db, tenantId, res.rows.map((r) => ({ id: r.journal_id, sourceType: r.source_type, sourceId: r.source_id })));
    let running = opening;
    const rows = res.rows.map((r, idx) => {
      running = running.plus(normal(acc.type, r.debit, r.credit));
      return {
        journalId: r.journal_id,
        number: r.number,
        date: r.date,
        description: r.memo ? `${r.description} — ${r.memo}` : r.description,
        sourceType: r.source_type,
        docRoute: routes[idx],
        debit: D(r.debit).toFixed(2),
        credit: D(r.credit).toFixed(2),
        balance: running.toFixed(2),
      };
    });
    return {
      account: { id: acc.id, code: acc.code, name: acc.name, type: acc.type },
      opening: opening.toFixed(2),
      rows,
      totalDebit: D(agg.debit).toFixed(2),
      totalCredit: D(agg.credit).toFixed(2),
      closing: opening.plus(normal(acc.type, agg.debit, agg.credit)).toFixed(2),
      /** true = baris yang ditampilkan dipotong batas; total & saldo akhir tetap lengkap — persempit rentang tanggal untuk melihat semua baris */
      truncated: agg.n > res.rows.length,
      totalRows: agg.n,
    };
  }


  /**
   * Laporan arus kas metode langsung: setiap jurnal yang menyentuh akun kas/bank
   * diklasifikasikan dari akun lawannya (operasi / investasi / pendanaan).
   */
  async cashFlow(tenantId: string, from?: string, to?: string) {
    const fromDate = from ? toDocDate(from) : '1900-01-01';
    const toDate = to ? toDocDate(to) : '2999-12-31';

    const openRes = await this.db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account = true AND j.date < ${fromDate}`);
    const opening = D(openRes.rows[0].v);

    const res = await this.db.execute<{
      journal_id: string;
      debit: string;
      credit: string;
      account_id: string;
      code: string;
      name: string;
      type: AccountType;
      is_cash: boolean;
      system_key: string | null;
    }>(sql`
      SELECT j.id AS journal_id, l.debit, l.credit, a.id AS account_id, a.code, a.name, a.type,
             a.is_cash_account AS is_cash, a.system_key
      FROM journal_entries j
      JOIN journal_lines l ON l.journal_id = j.id
      JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${fromDate} AND ${toDate}
        AND j.source_type <> 'CLOSING'
        AND EXISTS (SELECT 1 FROM journal_lines l2 JOIN accounts a2 ON a2.id = l2.account_id
                    WHERE l2.journal_id = j.id AND a2.is_cash_account = true)`);

    const byJournal = new Map<string, typeof res.rows>();
    for (const r of res.rows) byJournal.set(r.journal_id, [...(byJournal.get(r.journal_id) ?? []), r]);

    const LABEL: Record<string, string> = {
      AR: 'Penerimaan dari pelanggan',
      AP: 'Pembayaran ke supplier',
    };
    const groups: Record<CashCategory, Map<string, Dec>> = { operating: new Map(), investing: new Map(), financing: new Map() };

    for (const lines of byJournal.values()) {
      const cash = lines.filter((l) => l.is_cash);
      const delta = cash.reduce<Dec>((a, l) => a.plus(l.debit).minus(l.credit), ZERO);
      if (delta.isZero()) continue; // transfer antar kas/bank
      const others = lines.filter((l) => !l.is_cash);
      const category: CashCategory = others.some(
        (l) => l.type === 'EQUITY' || (l.type === 'LIABILITY' && l.code.startsWith('2-2')),
      )
        ? 'financing'
        : others.some((l) => l.type === 'ASSET' && l.code.startsWith('1-2'))
          ? 'investing'
          : 'operating';
      const main = others.sort((a, b) => D(b.debit).plus(b.credit).comparedTo(D(a.debit).plus(a.credit)))[0];
      const label = main ? (main.system_key && LABEL[main.system_key]) || `${main.code} ${main.name}` : 'Lain-lain';
      groups[category].set(label, (groups[category].get(label) ?? ZERO).plus(delta));
    }

    const section = (c: CashCategory) => {
      const items = [...groups[c].entries()]
        .map(([label, amount]) => ({ label, amount: amount.toFixed(2) }))
        .sort((a, b) => D(a.amount).comparedTo(b.amount) * -1);
      const total = [...groups[c].values()].reduce<Dec>((a, v) => a.plus(v), ZERO);
      return { items, total: total.toFixed(2) };
    };
    const operating = section('operating');
    const investing = section('investing');
    const financing = section('financing');
    const net = D(operating.total).plus(investing.total).plus(financing.total);
    return {
      opening: opening.toFixed(2),
      operating,
      investing,
      financing,
      netChange: net.toFixed(2),
      closing: opening.plus(net).toFixed(2),
    };
  }


  /** Rekap PPN: keluaran vs masukan per periode + daftar dokumen (bahan lapor SPT Masa PPN / e-Faktur). */
  async vatReport(tenantId: string, from?: string, to?: string) {
    const fromDate = from ? toDocDate(from) : '1900-01-01';
    const toDate = to ? toDocDate(to) : '2999-12-31';
    const gl = await this.db.execute<{ key: string; debit: string; credit: string }>(sql`
      SELECT a.system_key AS key, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${fromDate} AND ${toDate}
        AND a.system_key IN ('VAT_OUT', 'VAT_IN')
      GROUP BY a.system_key`);
    const get = (k: string) => gl.rows.find((r) => r.key === k);
    const vatOut = get('VAT_OUT') ? D(get('VAT_OUT')!.credit).minus(get('VAT_OUT')!.debit) : ZERO;
    const vatIn = get('VAT_IN') ? D(get('VAT_IN')!.debit).minus(get('VAT_IN')!.credit) : ZERO;

    const docs = await this.db.execute<{
      kind: string;
      number: string;
      ref: string | null;
      date: string;
      party: string;
      npwp: string | null;
      dpp: string;
      ppn: string;
    }>(sql`
      SELECT 'Faktur jual' AS kind, i.number, NULL AS ref, i.date, c.name AS party, c.npwp, i.subtotal AS dpp, i.tax_amount AS ppn
        FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.date BETWEEN ${fromDate} AND ${toDate} AND NOT i.is_opening
      UNION ALL
      SELECT 'Retur jual', r.number, i.number, r.date, c.name, c.npwp, -r.subtotal, -r.tax_amount
        FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id JOIN customers c ON c.id = r.customer_id
        WHERE r.tenant_id = ${tenantId} AND r.date BETWEEN ${fromDate} AND ${toDate}
      UNION ALL
      SELECT 'Faktur beli', p.number, p.supplier_invoice_no, p.date, s.name, s.npwp, p.subtotal, p.tax_amount
        FROM purchase_invoices p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.tenant_id = ${tenantId} AND p.date BETWEEN ${fromDate} AND ${toDate} AND p.kind <> 'OPENING'
      UNION ALL
      SELECT 'Retur beli', r.number, p.number, r.date, s.name, s.npwp, -r.subtotal, -r.tax_amount
        FROM purchase_returns r JOIN purchase_invoices p ON p.id = r.purchase_invoice_id JOIN suppliers s ON s.id = r.supplier_id
        WHERE r.tenant_id = ${tenantId} AND r.date BETWEEN ${fromDate} AND ${toDate}
      ORDER BY date, number`);

    const net = vatOut.minus(vatIn);
    return {
      vatOut: vatOut.toFixed(2),
      vatIn: vatIn.toFixed(2),
      net: net.toFixed(2),
      status: net.isPositive() ? 'KURANG_BAYAR' : net.isNegative() ? 'LEBIH_BAYAR' : 'NIHIL',
      documents: docs.rows.map((d) => ({ ...d, npwp: decryptField(d.npwp), dpp: D(d.dpp).toFixed(2), ppn: D(d.ppn).toFixed(2) })),
    };
  }
}

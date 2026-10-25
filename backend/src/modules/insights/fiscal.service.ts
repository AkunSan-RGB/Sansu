/**
 * Rekonsiliasi fiskal & estimasi PPh Badan (bahan SPT Tahunan PPh Badan).
 *  - Laba komersial sebelum pajak (laporan laba rugi SAK EP)
 *  - Koreksi positif: beban tidak dapat dikurangkan (Pasal 9 UU PPh) sesuai tanda di bagan akun,
 *    selisih penyusutan komersial > fiskal, koreksi manual
 *  - Koreksi negatif: penghasilan sudah PPh final / bukan objek pajak, selisih penyusutan fiskal > komersial
 *  - PKP = laba fiskal − kompensasi kerugian, dibulatkan ke bawah ribuan penuh
 *  - Tarif umum 22% dengan fasilitas Pasal 31E (peredaran bruto s/d Rp50 miliar), atau PPh final UMKM 0,5%
 *  - Pajak tangguhan dari beda temporer aset tetap (SAK EP)
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { FACILITY_31E_REVENUE_LIMIT, FINAL_TAX_EXCLUDED_FORMS, type LegalForm, TAX_REVENUE_LIMIT } from '@sansu/shared';
import { and, eq, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { D, Dec, Decimal, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { fiscalAdjustments, fiscalYears } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { get, loadAccounts, natural, sumByAccount } from '../accounting/ledger-data';
import { PostingService } from '../accounting/posting.service';
import { projectCostsSql } from '../sales/services/project-costs';
import { StatementsService } from '../accounting/statements.service';
import { AssetsService } from '../assets/assets.service';
import { AssetReportsService } from '../assets/asset-reports.service';

export const CORPORATE_RATE = 22;
const THRESHOLD_FULL = D(TAX_REVENUE_LIMIT);
const THRESHOLD_31E = D(FACILITY_31E_REVENUE_LIMIT);

/** PPh Badan tarif umum dengan fasilitas Pasal 31E UU PPh */
export function corporateTax(pkp: Dec, grossRevenue: Dec) {
  if (pkp.lte(0)) return { facilitatedPkp: ZERO, tax: ZERO, method: 'Nihil' };
  if (grossRevenue.lte(THRESHOLD_FULL)) {
    return { facilitatedPkp: pkp, tax: pkp.times(CORPORATE_RATE / 2).div(100).floor(), method: 'Pasal 31E: seluruh PKP mendapat pengurangan tarif 50% (11%)' };
  }
  if (grossRevenue.lte(THRESHOLD_31E)) {
    const fac = THRESHOLD_FULL.times(pkp).div(grossRevenue).floor();
    const tax = fac.times(CORPORATE_RATE / 2).div(100).plus(pkp.minus(fac).times(CORPORATE_RATE).div(100)).floor();
    return { facilitatedPkp: fac, tax, method: 'Pasal 31E: PKP fasilitas = (Rp4,8 miliar ÷ peredaran bruto) × PKP dikenai 11%, sisanya 22%' };
  }
  return { facilitatedPkp: ZERO, tax: pkp.times(CORPORATE_RATE).div(100).floor(), method: 'Tarif umum Pasal 17 ayat (1) huruf b: 22%' };
}

@Injectable()
export class FiscalService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly statements: StatementsService,
    private readonly assets: AssetsService,
    private readonly settings: SettingsService,
    private readonly posting: PostingService,
    private readonly assetReports: AssetReportsService,
  ) {}

  async reconcile(tenantId: string, year: number) {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [reporting, accs, moves, yearEnd, income, assetRows, manual, [fy]] = await Promise.all([
      this.settings.reporting(this.db, tenantId),
      loadAccounts(this.db, tenantId),
      sumByAccount(this.db, tenantId, { from, to, excludeSources: ['CLOSING'] }),
      sumByAccount(this.db, tenantId, { to }),
      this.statements.income(tenantId, { from, to }, 'SAK_EP'),
      this.assetReports.fiscalComparison(tenantId, year),
      this.db.select().from(fiscalAdjustments).where(and(eq(fiscalAdjustments.tenantId, tenantId), eq(fiscalAdjustments.year, year))),
      this.db.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.year, year))),
    ]);
    const pbt = D(income.lines.find((l) => l.key === 'PROFIT_BEFORE_TAX')!.amount);

    type Item = { source: 'ACCOUNT' | 'DEPRECIATION' | 'INVENTORY' | 'FINAL_COST' | 'MANUAL'; id?: string; label: string; amount: string };
    const positive: Item[] = [];
    const negative: Item[] = [];
    for (const a of accs.filter((x) => x.isPostable && x.reportGroup !== 'INCOME_TAX')) {
      const n = natural(a.type, get(moves, a.id));
      if (n.isZero()) continue;
      if (a.type === 'EXPENSE' && a.fiscalTreatment === 'NON_DEDUCTIBLE') {
        // saldo kredit (mis. pemulihan penurunan nilai > penurunan tahun ini) = koreksi negatif
        if (n.gt(0)) positive.push({ source: 'ACCOUNT', id: a.id, label: `${a.code} ${a.name}`, amount: n.toFixed(2) });
        else negative.push({ source: 'ACCOUNT', id: a.id, label: `${a.code} ${a.name} (pemulihan, bukan penghasilan fiskal)`, amount: n.abs().toFixed(2) });
      }
      if (a.type === 'REVENUE' && (a.fiscalTreatment === 'FINAL_INCOME' || a.fiscalTreatment === 'NON_TAXABLE')) {
        negative.push({ source: 'ACCOUNT', id: a.id, label: `${a.code} ${a.name}${a.fiscalTreatment === 'FINAL_INCOME' ? ' (PPh final)' : ' (bukan objek pajak)'}`, amount: n.toFixed(2) });
      }
    }
    // Biaya untuk mendapatkan penghasilan PPh final (jasa konstruksi, sewa) tidak dapat dikurangkan (Pasal 9 ayat 1 huruf c UU PPh):
    //  biaya langsung proyek ber-PPh final seluruhnya + biaya bersama secara proporsional (pendapatan final / pendapatan usaha)
    let finalCost: null | { finalRevenue: string; totalRevenue: string; ratio: number; direct: string; common: string; auto: string; override: string | null; applied: string } = null;
    const rp = (v: Dec) => Math.round(v.toNumber()).toLocaleString('id-ID');
    const nat = (pred: (a: (typeof accs)[number]) => boolean) =>
      accs.filter((a) => a.isPostable && pred(a)).reduce<Dec>((sum, a) => sum.plus(natural(a.type, get(moves, a.id))), ZERO);
    const finalRevenue = nat((a) => a.type === 'REVENUE' && a.fiscalTreatment === 'FINAL_INCOME' && a.reportGroup === 'SALES_REVENUE');
    if (finalRevenue.gt(0)) {
      const totalRevenue = nat((a) => a.type === 'REVENUE' && ['SALES_REVENUE', 'SALES_DEDUCTION'].includes(a.reportGroup ?? ''));
      const costGroups = ['COST_OF_SALES', 'SELLING_EXPENSE', 'ADMIN_EXPENSE', 'OTHER_EXPENSE', 'FINANCE_COST'];
      // HPP barang dagang (HPP, selisih & penurunan nilai persediaan) bukan biaya bersama jasa
      const goodsCost = new Set<string>([SYS.COGS, SYS.INVENTORY_ADJ, SYS.INVENTORY_WRITEDOWN]);
      const pool = nat(
        (a) => a.type === 'EXPENSE' && a.fiscalTreatment === 'NORMAL' && costGroups.includes(a.reportGroup ?? '') && !goodsCost.has(a.systemKey ?? ''),
      );
      const [dc] = (
        await this.db.execute<{ final: string; other: string }>(sql`
          WITH proj AS (
            SELECT p.id, EXISTS (
              SELECT 1 FROM invoices i JOIN service_invoice_lines sl ON sl.invoice_id = i.id JOIN accounts ra ON ra.id = sl.account_id
              WHERE i.project_id = p.id AND ra.fiscal_treatment = 'FINAL_INCOME') AS is_final
            FROM projects p WHERE p.tenant_id = ${tenantId}
          )
          SELECT COALESCE(SUM(x.amount) FILTER (WHERE proj.is_final), 0) AS final,
                 COALESCE(SUM(x.amount) FILTER (WHERE NOT proj.is_final), 0) AS other
          FROM ${projectCostsSql(tenantId, from, to)} x
          JOIN proj ON proj.id = x.project_id
          JOIN accounts a ON a.id = x.account_id
          WHERE a.type = 'EXPENSE' AND a.fiscal_treatment = 'NORMAL'
            AND a.report_group IN ('COST_OF_SALES', 'SELLING_EXPENSE', 'ADMIN_EXPENSE', 'OTHER_EXPENSE', 'FINANCE_COST')
            AND COALESCE(a.system_key, '') NOT IN ('COGS', 'INVENTORY_ADJ', 'INVENTORY_WRITEDOWN')`)
      ).rows;
      const direct = D(dc.final);
      const common = Decimal.max(pool.minus(direct).minus(dc.other), ZERO);
      const ratio = totalRevenue.gt(0) ? Decimal.min(finalRevenue.div(totalRevenue), D(1)) : D(1);
      const auto = money(direct.plus(common.times(ratio)));
      const override = fy?.finalCostOverride != null ? D(fy.finalCostOverride) : null;
      const applied = override ?? auto;
      finalCost = {
        finalRevenue: finalRevenue.toFixed(2),
        totalRevenue: totalRevenue.toFixed(2),
        ratio: Math.round(ratio.toNumber() * 10000) / 100,
        direct: direct.toFixed(2),
        common: common.toFixed(2),
        auto: auto.toFixed(2),
        override: override ? override.toFixed(2) : null,
        applied: applied.toFixed(2),
      };
      if (applied.gt(0)) {
        positive.push({
          source: 'FINAL_COST',
          label: override
            ? 'Biaya untuk penghasilan PPh final (diisi manual)'
            : `Biaya untuk penghasilan PPh final: langsung proyek Rp${rp(direct)} + biaya bersama ${finalCost.ratio.toLocaleString('id-ID')}% × Rp${rp(common)}`,
          amount: applied.toFixed(2),
        });
      }
    }

    // Penurunan nilai persediaan yang terealisasi (barang dijual/keluar): HPP fiskal memakai biaya sebelum diturunkan
    const [wd] = (
      await this.db.execute<{ realized: string; reserve: string }>(sql`
        SELECT COALESCE(-SUM(writedown_value) FILTER (WHERE type <> 'REVALUATION' AND date >= ${from}), 0) AS realized,
               COALESCE(SUM(writedown_value), 0) AS reserve
        FROM stock_moves WHERE tenant_id = ${tenantId} AND date <= ${to}`)
    ).rows;
    const realized = D(wd.realized);
    if (realized.gt(0)) negative.push({ source: 'INVENTORY', label: 'Penurunan nilai persediaan yang terealisasi (barang sudah terjual/keluar)', amount: realized.toFixed(2) });
    if (realized.lt(0)) positive.push({ source: 'INVENTORY', label: 'Penurunan nilai persediaan atas barang retur (dibalik)', amount: realized.abs().toFixed(2) });
    const depDiff = assetRows.reduce<Dec>((s, r) => s.plus(r.difference), ZERO);
    if (depDiff.gt(0)) positive.push({ source: 'DEPRECIATION', label: 'Selisih penyusutan komersial di atas fiskal', amount: depDiff.toFixed(2) });
    if (depDiff.lt(0)) negative.push({ source: 'DEPRECIATION', label: 'Selisih penyusutan fiskal di atas komersial', amount: depDiff.abs().toFixed(2) });
    const dispDiff = assetRows.reduce<Dec>((s, r) => s.plus(r.disposalDifference), ZERO);
    if (dispDiff.gt(0)) positive.push({ source: 'DEPRECIATION', label: 'Selisih laba/rugi pelepasan aset (komersial vs fiskal)', amount: dispDiff.toFixed(2) });
    if (dispDiff.lt(0)) negative.push({ source: 'DEPRECIATION', label: 'Selisih laba/rugi pelepasan aset (komersial vs fiskal)', amount: dispDiff.abs().toFixed(2) });
    for (const m of manual) (m.kind === 'POSITIVE' ? positive : negative).push({ source: 'MANUAL', id: m.id, label: m.description, amount: D(m.amount).toFixed(2) });

    const sumItems = (xs: Item[]) => xs.reduce<Dec>((s, i) => s.plus(i.amount), ZERO);
    const totalPositive = sumItems(positive);
    const totalNegative = sumItems(negative);
    const fiscalProfit = pbt.plus(totalPositive).minus(totalNegative);
    const lossCf = D(fy?.lossCarryforward ?? 0);
    const pkpRaw = fiscalProfit.minus(lossCf);
    const pkp = pkpRaw.gt(0) ? pkpRaw.div(1000).floor().times(1000) : ZERO;

    // Peredaran bruto: pendapatan usaha neto + pendapatan lain yang bukan PPh final / bukan objek
    const autoGross = accs
      .filter((a) => a.isPostable && a.type === 'REVENUE' && a.fiscalTreatment === 'NORMAL' && ['SALES_REVENUE', 'SALES_DEDUCTION', 'OTHER_INCOME'].includes(a.reportGroup))
      .reduce<Dec>((s, a) => s.plus(natural(a.type, get(moves, a.id))), ZERO);
    const grossRevenue = fy?.grossRevenueOverride != null ? D(fy.grossRevenueOverride) : autoGross;

    const warnings: string[] = [];
    let taxDue: Dec;
    let method: string;
    let facilitatedPkp: Dec = ZERO;
    if (reporting.taxScheme === 'FINAL_UMKM') {
      taxDue = money(grossRevenue.times(0.5).div(100)).floor();
      method = 'PPh final 0,5% × peredaran bruto (PP 55/2022 jo. PP 20/2026)';
      if (FINAL_TAX_EXCLUDED_FORMS.includes(reporting.legalForm as LegalForm)) {
        warnings.push(
          'Sejak PP 20/2026, CV, Firma, dan PT (bukan PT Perorangan) tidak lagi menjadi subjek PPh final 0,5% kecuali masih dalam masa transisi jangka waktu semula. Pastikan perusahaan masih berhak.',
        );
      }
      if (grossRevenue.gt(THRESHOLD_FULL)) warnings.push('Peredaran bruto melebihi Rp4,8 miliar: PPh final UMKM tidak berlaku lagi tahun berikutnya.');
    } else {
      const r = corporateTax(pkp, grossRevenue);
      taxDue = r.tax;
      method = r.method;
      facilitatedPkp = r.facilitatedPkp;
    }

    // Kredit pajak = saldo Pajak Dibayar Dimuka (PPh 22, 23, 25) akhir tahun
    const prepaid = accs.find((a) => a.systemKey === SYS.PREPAID_TAX);
    const credits = prepaid ? natural(prepaid.type, get(yearEnd, prepaid.id)) : ZERO;
    const pph29 = taxDue.minus(credits);

    // Dasar angsuran PPh 25 tahun berikutnya (PMK 215/PMK.03/2018): PPh terutang dikurangi PPh 21/22/23/24 yang
    // dipotong/dipungut pihak lain pada tahun itu. PPh 25 yang sudah disetor sendiri TIDAK dikurangkan
    // (ia hanya mengurangi PPh 29). Kredit pihak lain = debit akun Pajak Dibayar Dimuka tahun itu di luar
    // setoran pajak sendiri dan jurnal pajak akhir tahun.
    const [wc] = (
      await this.db.execute<{ v: string }>(sql`
        SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE j.tenant_id = ${tenantId} AND a.system_key = ${SYS.PREPAID_TAX} AND j.date BETWEEN ${from} AND ${to}
          AND j.source_type NOT IN ('TAX_PAYMENT', 'INCOME_TAX', 'CLOSING')`)
    ).rows;
    const withheldCredits = Decimal.max(D(wc?.v), ZERO);
    const installmentBase = taxDue.minus(withheldCredits);

    // Pajak tangguhan (hanya SAK EP + tarif umum): beda temporer nilai buku aset tetap
    let deferred = null as null | { temporaryDifference: string; target: string; current: string; adjustment: string };
    if (reporting.framework !== 'SAK_EMKM' && reporting.taxScheme === 'GENERAL') {
      // beda temporer: nilai buku aset tetap (fiskal − komersial) + penurunan nilai persediaan yang masih melekat
      const temp = assetRows.reduce<Dec>((s, r) => s.plus(r.fiscalBookValue).minus(r.commercialBookValue), ZERO).plus(wd.reserve);
      const target = money(temp.times(CORPORATE_RATE).div(100));
      const dta = accs.find((a) => a.systemKey === SYS.DEFERRED_TAX_ASSET);
      const dtl = accs.find((a) => a.systemKey === SYS.DEFERRED_TAX_LIABILITY);
      const current = (dta ? natural(dta.type, get(yearEnd, dta.id)) : ZERO).minus(dtl ? natural(dtl.type, get(yearEnd, dtl.id)) : ZERO);
      deferred = { temporaryDifference: temp.toFixed(2), target: target.toFixed(2), current: current.toFixed(2), adjustment: target.minus(current).toFixed(2) };
    }

    const posted = await this.postedJournal(tenantId, year);
    const f = (d: Dec) => d.toFixed(2);
    return {
      year,
      scheme: reporting.taxScheme,
      framework: reporting.framework,
      legalForm: reporting.legalForm,
      profitBeforeTax: f(pbt),
      positive,
      negative,
      totalPositive: f(totalPositive),
      totalNegative: f(totalNegative),
      fiscalProfit: f(fiscalProfit),
      lossCarryforward: f(lossCf),
      pkp: f(pkp),
      grossRevenue: f(grossRevenue),
      grossRevenueAuto: f(autoGross),
      grossRevenueOverridden: fy?.grossRevenueOverride != null,
      finalCost,
      facilitatedPkp: f(facilitatedPkp),
      method,
      taxDue: f(taxDue),
      credits: f(credits),
      pph29: f(pph29),
      withheldCredits: f(withheldCredits),
      installment25: f(reporting.taxScheme === 'GENERAL' && installmentBase.gt(0) ? installmentBase.div(12).floor() : ZERO),
      deferred,
      depreciation: assetRows,
      warnings,
      journal: posted,
    };
  }

  private async postedJournal(tenantId: string, year: number) {
    const res = await this.db.execute<{ id: string; number: string; date: string }>(sql`
      SELECT j.id, j.number, j.date FROM journal_entries j
      WHERE j.tenant_id = ${tenantId} AND j.source_type = 'INCOME_TAX' AND j.source_id = ${String(year)}
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id)
      ORDER BY j.created_at DESC LIMIT 1`);
    return res.rows[0] ?? null;
  }

  async saveYear(tenantId: string, year: number, dto: { lossCarryforward?: string; grossRevenueOverride?: string | null; finalCostOverride?: string | null }) {
    await this.db
      .insert(fiscalYears)
      .values({
        tenantId,
        year,
        lossCarryforward: dto.lossCarryforward ?? '0',
        grossRevenueOverride: dto.grossRevenueOverride ?? null,
        finalCostOverride: dto.finalCostOverride ?? null,
      })
      .onConflictDoUpdate({
        target: [fiscalYears.tenantId, fiscalYears.year],
        set: {
          ...(dto.lossCarryforward !== undefined ? { lossCarryforward: dto.lossCarryforward } : {}),
          ...(dto.grossRevenueOverride !== undefined ? { grossRevenueOverride: dto.grossRevenueOverride } : {}),
          ...(dto.finalCostOverride !== undefined ? { finalCostOverride: dto.finalCostOverride } : {}),
        },
      });
    return this.reconcile(tenantId, year);
  }

  async addAdjustment(tenantId: string, year: number, dto: { description: string; kind: 'POSITIVE' | 'NEGATIVE'; amount: string }) {
    await this.db.insert(fiscalAdjustments).values({ tenantId, year, ...dto, amount: money(dto.amount).toFixed(2) });
    return this.reconcile(tenantId, year);
  }

  async removeAdjustment(tenantId: string, year: number, id: string) {
    await this.db.delete(fiscalAdjustments).where(and(eq(fiscalAdjustments.id, id), eq(fiscalAdjustments.tenantId, tenantId)));
    return this.reconcile(tenantId, year);
  }

  /**
   * Jurnal pajak penghasilan akhir tahun (31 Desember):
   *  Dr Beban pajak kini | Cr Pajak dibayar dimuka (kredit pajak) | Cr Utang PPh Badan (PPh 29)
   *  ± pajak tangguhan: Dr/Cr Aset (Liabilitas) pajak tangguhan | Cr/Dr Beban (manfaat) pajak tangguhan
   */
  async postTax(user: AuthUser, year: number) {
    const r = await this.reconcile(user.tenantId, year);
    if (r.journal) throw new BadRequestException(`Jurnal pajak ${year} sudah diposting (${r.journal.number}). Balik jurnal itu dulu bila ingin menghitung ulang.`);
    const tax = D(r.taxDue);
    const credits = D(r.credits);
    const lines: Parameters<PostingService['post']>[1]['lines'] = [];
    if (tax.gt(0)) {
      lines.push({ key: SYS.CURRENT_TAX_EXPENSE, debit: tax });
      const use = Decimal.min(credits.gt(0) ? credits : ZERO, tax);
      if (use.gt(0)) lines.push({ key: SYS.PREPAID_TAX, credit: use });
      if (tax.minus(use).gt(0)) lines.push({ key: SYS.CORPORATE_TAX_PAYABLE, credit: tax.minus(use) });
    }
    if (r.deferred && !D(r.deferred.adjustment).isZero()) {
      const target = D(r.deferred.target);
      const current = D(r.deferred.current);
      // Posisikan saldo: aset pajak tangguhan bila target positif, liabilitas bila negatif
      const curDta = current.gt(0) ? current : ZERO;
      const curDtl = current.lt(0) ? current.abs() : ZERO;
      const newDta = target.gt(0) ? target : ZERO;
      const newDtl = target.lt(0) ? target.abs() : ZERO;
      const dDta = newDta.minus(curDta);
      const dDtl = newDtl.minus(curDtl);
      if (!dDta.isZero()) lines.push({ key: SYS.DEFERRED_TAX_ASSET, debit: dDta.gt(0) ? dDta : 0, credit: dDta.lt(0) ? dDta.abs() : 0 });
      if (!dDtl.isZero()) lines.push({ key: SYS.DEFERRED_TAX_LIABILITY, credit: dDtl.gt(0) ? dDtl : 0, debit: dDtl.lt(0) ? dDtl.abs() : 0 });
      const expense = dDtl.minus(dDta); // beban tangguhan = kenaikan liabilitas − kenaikan aset
      lines.push({ key: SYS.DEFERRED_TAX_EXPENSE, debit: expense.gt(0) ? expense : 0, credit: expense.lt(0) ? expense.abs() : 0 });
    }
    if (!lines.length) throw new BadRequestException('Tidak ada pajak terutang maupun pajak tangguhan untuk dijurnal');
    return this.db.transaction(async (tx) => {
      const j = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date: `${year}-12-31`,
        description: `Pajak penghasilan badan tahun ${year}`,
        sourceType: 'INCOME_TAX',
        sourceId: String(year),
        createdById: user.sub,
        lines,
      });
      await tx
        .insert(fiscalYears)
        .values({ tenantId: user.tenantId, year, taxJournalId: j.id })
        .onConflictDoUpdate({ target: [fiscalYears.tenantId, fiscalYears.year], set: { taxJournalId: j.id } });
      return { number: j.number, id: j.id };
    });
  }
}

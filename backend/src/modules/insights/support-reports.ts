/**
 * Laporan pendukung: rincian per bidang (penjualan, pembelian, persediaan, kas & bank, akun lainnya, dan per jenis usaha)
 * yang dapat dipertanggungjawabkan di luar laporan keuangan. Setiap laporan memuat rincian dari dokumen/kartu pembantu dan
 * "pencocokan dengan buku besar": angka rincian dibandingkan dengan saldo/mutasi akun di buku besar, selisihnya ditampilkan apa adanya.
 * Isi tiap laporan ada di berkas `support-reports-*.ts`; service ini memilih pembuat laporan menurut jenisnya.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { toDocDate, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { SettingsService } from '../../common/settings.service';
import { conclude, DEFAULT_THRESHOLDS, type InsightThresholds } from './support-insights';
import { IndustrySupportReports } from './support-reports-industry';
import { ManufacturingSupportReports } from './support-reports-manufacturing';
import { ServiceSupportReports } from './support-reports-service';
import { StockCashSupportReports } from './support-reports-stock-cash';
import { TradeSupportReports } from './support-reports-trade';
import { CAP, SUPPORT_KINDS, type Reconciliation, type SupportKind, type SupportSection } from './support-shared';

export * from './support-shared';

interface SupportReport {
  title: string;
  summary: string;
  sections: SupportSection[];
  reconciliation: Reconciliation[];
}
type ReportBuilder = (tenantId: string, from: string, to: string) => Promise<SupportReport>;

@Injectable()
export class SupportReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly trade: TradeSupportReports,
    private readonly stockCash: StockCashSupportReports,
    private readonly retail: IndustrySupportReports,
    private readonly manufacturing: ManufacturingSupportReports,
    private readonly service: ServiceSupportReports,
  ) {}

  thresholds(tenantId: string): Promise<InsightThresholds> {
    return this.settings.section(this.db, tenantId, 'supportInsights', DEFAULT_THRESHOLDS);
  }

  saveThresholds(tenantId: string, value: InsightThresholds): Promise<InsightThresholds> {
    return this.settings.saveSection(this.db, tenantId, 'supportInsights', DEFAULT_THRESHOLDS, value);
  }

  /** Pembuat laporan menurut jenisnya; tipe `Record<SupportKind, …>` memastikan setiap jenis punya pembuat */
  private builders(): Record<SupportKind, ReportBuilder> {
    return {
      sales: (t, f, e) => this.trade.sales(t, f, e),
      purchases: (t, f, e) => this.trade.purchases(t, f, e),
      inventory: (t, f, e) => this.stockCash.inventory(t, f, e),
      cash: (t, f, e) => this.stockCash.cash(t, f, e),
      other: (t, f, e) => this.stockCash.other(t, f, e),
      pos: (t, f, e) => this.retail.pos(t, f, e),
      fnb: (t, f, e) => this.retail.fnb(t, f, e),
      fmcg: (t, f, e) => this.manufacturing.fmcg(t, f, e),
      mfg: (t, f, e) => this.manufacturing.mfg(t, f, e),
      jasa: (t, f, e) => this.service.jasa(t, f, e),
      utility: (t, f, e) => this.service.utility(t, f, e),
    };
  }

  async build(tenantId: string, kind: SupportKind, fromIn?: string, toIn?: string) {
    if (!SUPPORT_KINDS.includes(kind)) throw new BadRequestException('Jenis laporan pendukung tidak dikenal');
    const to = toDocDate(toIn);
    const from = fromIn ? toDocDate(fromIn) : `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('Tanggal awal tidak boleh setelah tanggal akhir');
    const out = await this.builders()[kind](tenantId, from, to);
    for (const sec of out.sections)
      if (sec.tables.some((t) => t.rows.length >= CAP))
        sec.paragraphs = [
          ...sec.paragraphs,
          `Tabel dipotong pada ${CAP} baris pertama; persempit periode untuk melihat sisanya.`,
        ];
    const period = { from, to };
    return {
      kind,
      ...out,
      period,
      conclusion: conclude(kind, { ...out, period }, await this.thresholds(tenantId)),
      generatedAt: new Date().toISOString(),
      today: todayJakarta(),
    };
  }
}

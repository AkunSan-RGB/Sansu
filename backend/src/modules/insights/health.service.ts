/**
 * Cek kesehatan pembukuan: pemeriksaan otomatis yang biasanya dilakukan akuntan sebelum
 * laporan ditandatangani, ditambah rasio keuangan dengan penjelasan bahasa awam.
 * Pemeriksaan dikelompokkan per berkas `health-checks-*.ts`; nilai bersama dibangun di `health-context.ts`.
 */
import { Injectable } from '@nestjs/common';
import { PeriodService } from '../../common/period/period.service';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { StatementsService } from '../accounting/statements.service';
import { AssetsService } from '../assets/assets.service';
import { AssetReportsService } from '../assets/asset-reports.service';
import { ThresholdsService } from './thresholds.service';
import { buildHealthContext } from './health-context';
import { ledgerChecks } from './health-checks-ledger';
import { assetChecks } from './health-checks-assets';
import { journalChecks } from './health-checks-journals';
import { controlChecks } from './health-checks-controls';
import { closingChecks } from './health-checks-closing';
import { ratioScore } from './health-ratios';
export type { Check } from './health-context';

@Injectable()
export class HealthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly statements: StatementsService,
    private readonly assets: AssetsService,
    private readonly period: PeriodService,
    private readonly thresholds: ThresholdsService,
    private readonly assetReports: AssetReportsService,
  ) {}
  async run(tenantId: string, asOfInput?: string) {
    const c = await buildHealthContext(
      {
        db: this.db,
        statements: this.statements,
        assets: this.assets,
        period: this.period,
        thresholds: this.thresholds,
        assetReports: this.assetReports,
      },
      tenantId,
      asOfInput,
    );
    const o0 = await ledgerChecks(c);
    const o1 = await assetChecks(c, o0);
    const o2 = await journalChecks(c);
    const o3 = await controlChecks(c);
    const o4 = await closingChecks(c, o0);
    const o5 = await ratioScore(c, { ...o0, ...o4 });
    return o5;
  }
}

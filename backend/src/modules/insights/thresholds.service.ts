/**
 * Peringatan ambang pajak: peredaran bruto tahun berjalan dibandingkan batas PKP / PPh final (Rp4,8 miliar),
 * fasilitas Pasal 31E (Rp50 miliar), dan kriteria UMKM. Aturannya fungsi murni di @sansu/shared.
 */
import { Injectable } from '@nestjs/common';
import { evaluateThresholds, type LegalForm, type TaxThresholdReport, worstLevel } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { toDocDate } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { EntityProfileService } from './entity-profile.service';

@Injectable()
export class ThresholdsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly profile: EntityProfileService,
  ) {}

  async evaluate(tenantId: string, asOfInput?: string): Promise<TaxThresholdReport> {
    const asOf = toDocDate(asOfInput);
    const year = Number(asOf.slice(0, 4));
    const [reporting, tax, state, revenueYtd] = await Promise.all([
      this.settings.reporting(this.db, tenantId),
      this.settings.taxProfile(this.db, tenantId),
      this.profile.state(tenantId),
      this.profile.revenueBetween(tenantId, `${year}-01-01`, asOf),
    ]);
    const alerts = evaluateThresholds({
      asOf,
      revenueYtd,
      pkp: tax.pkp,
      taxScheme: reporting.taxScheme,
      framework: reporting.framework,
      legalForm: reporting.legalForm as LegalForm,
      size: state.recommendation.size,
    });
    return { asOf, year, revenueYtd, worst: worstLevel(alerts), alerts };
  }
}

import { Injectable } from '@nestjs/common';
import { classifyMovement, MOVEMENT_PROFILES, type MovementClass } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { allowedWarehouses } from '../../common/auth/warehouse-access';
import { SettingsService } from '../../common/settings.service';
import { diffDays, todayJakarta, addDays } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { MovementAnalysisRepository } from './movement-analysis.repository';

const ORDER: MovementClass[] = ['OUT', 'FAST', 'DEAD', 'SLOW', 'NORMAL', 'NEW', 'EMPTY'];

const MAX_ROWS = 1000;

@Injectable()
export class MovementAnalysisService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly repo: MovementAnalysisRepository,
  ) {}

  /** Barang cepat & lambat keluar. Satuan "keluar" = penjualan (faktur/surat jalan/kasir) dan pemakaian produksi, dikurangi retur. */
  async analyze(u: AuthUser) {
    const tenantId = u.tenantId;
    const model = await this.settings.businessModel(this.db, tenantId);
    const profile = MOVEMENT_PROFILES[model] ?? MOVEMENT_PROFILES.DAGANG;
    const today = todayJakarta();
    const since = addDays(today, -profile.windowDays);
    const allowed = allowedWarehouses(u);
    const wh = allowed ? sql`AND warehouse_id IN (${sql.join(allowed.map((a) => sql`${a}`), sql`, `)})` : sql``;

    const rows = await this.repo.queryProduct(this.db, tenantId, wh, since);

    const items = rows.rows.map((r) => {
      const onHand = Number(r.on_hand);
      const res = classifyMovement(model, {
        onHand,
        netOut: Number(r.net_out ?? 0),
        ageDays: r.first_move ? Math.max(0, diffDays(r.first_move, today)) : 0,
        lastOutDaysAgo: r.last_out ? Math.max(0, diffDays(r.last_out, today)) : null,
      });
      return {
        productId: r.id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        uom: r.base_uom,
        onHand,
        value: Number(r.value),
        soldInWindow: Math.max(0, Number(r.net_out ?? 0)),
        perDay: res.perDay,
        coverDays: res.coverDays === null ? null : Math.round(res.coverDays),
        lastOutDate: r.last_out,
        cls: res.cls,
      };
    });
    items.sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls) || b.value - a.value);

    const summary = Object.fromEntries(ORDER.map((c) => [c, { count: 0, value: 0 }])) as Record<MovementClass, { count: number; value: number }>;
    for (const i of items) {
      summary[i.cls].count += 1;
      summary[i.cls].value += i.value;
    }
    return { model, asOf: today, profile, summary, items: items.slice(0, MAX_ROWS), truncated: items.length > MAX_ROWS, total: items.length };
  }
}

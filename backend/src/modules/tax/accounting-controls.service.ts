import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { HealthService } from '../insights/health.service';
import { TaxFocusService } from './tax-focus';

export interface AccountingControlFinding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

/**
 * Kontrol pembukuan & pajak: satu halaman yang menggabungkan pemeriksaan kesehatan pembukuan yang bermasalah (WARN/ERROR),
 * butir daftar periksa pajak yang masih "perlu", dan jurnal yang dibuat jauh setelah tanggal transaksinya.
 */
@Injectable()
export class AccountingControlsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly health: HealthService,
    private readonly taxFocus: TaxFocusService,
  ) {}

  async controls(tenantId: string) {
    const today = todayJakarta();
    const since = addDays(today, -60);
    const items: AccountingControlFinding[] = [];

    const h = await this.health.run(tenantId);
    for (const c of h.checks) {
      if (c.status !== 'WARN' && c.status !== 'ERROR') continue;
      items.push({ key: `HEALTH_${c.key}`, level: c.status === 'ERROR' ? 'error' : 'warning', title: c.title, detail: c.message, refs: c.detail?.length ? c.detail.map((d) => `${d.label}: ${d.value}`) : [c.message] });
    }

    const t = await this.taxFocus.focus(tenantId);
    for (const c of t.checks) {
      if (c.status !== 'PERLU') continue;
      items.push({ key: `TAXFOCUS_${c.key}`, level: 'warning', title: c.title, detail: c.detail, refs: [c.detail] });
    }

    // Jurnal dibuat jauh setelah tanggal transaksinya (masuk ke bulan yang sudah lewat lebih dari satu bulan penuh)
    const cutoff = `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
    const late = await this.db.execute<{ number: string; d: string; c: string; who: string | null; src: string }>(sql`
      SELECT j.number, j.date::text AS d, j.created_at::date::text AS c, u.name AS who, j.source_type AS src
      FROM journal_entries j LEFT JOIN users u ON u.id = j.created_by_id
      WHERE j.tenant_id = ${tenantId} AND j.created_at::date >= ${since} AND j.date < ${cutoff}
        AND j.source_type NOT IN ('RECURRING', 'REVERSAL', 'CLOSING', 'OPENING', 'ADJUSTMENT')
      ORDER BY j.created_at DESC LIMIT 30`);
    if (late.rows.length) {
      items.push({
        key: 'JE_BACKDATED',
        level: 'warning',
        title: `Jurnal dibuat jauh setelah tanggal transaksinya (${late.rows.length})`,
        detail: 'Jurnal bertanggal lebih dari satu bulan penuh sebelum dibuat. Mengubah angka bulan yang sudah dilaporkan bisa membuat laporan dan SPT berbeda dari yang sudah disampaikan. Kunci periode yang sudah selesai.',
        refs: late.rows.map((r) => `${r.number} (${r.src}) tanggal ${r.d}, dibuat ${r.c}${r.who ? ` oleh ${r.who}` : ''}`),
      });
    }

    const rank = { error: 0, warning: 1, info: 2 } as const;
    items.sort((a, b) => rank[a.level] - rank[b.level]);
    return { asOf: today, since, items };
  }
}

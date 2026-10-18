import { Controller, Get, Injectable } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CONTROL_PROFILES } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { SettingsService } from '../../common/settings.service';
import { RequireApp } from '../../common/apps/app.guard';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';

export interface InventoryControlFinding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

const rp = (v: number | string) => `Rp${Math.round(Number(v)).toLocaleString('id-ID')}`;
/** Gudang aktif yang belum diopname lebih dari sekian hari dianggap lewat jadwal */
export const COUNT_INTERVAL_DAYS = 35;
/** Transfer yang masih di perjalanan lebih dari sekian hari dianggap menggantung */
export const TRANSFER_STUCK_DAYS = 3;

/**
 * Temuan kontrol persediaan (anti-fraud) 60 hari terakhir: penyesuaian stok keluar berulang atau besar, selisih opname besar,
 * gudang lewat jadwal opname, transfer menggantung. Terpisah dari kontrol pembelian agar bisa dibuka tanpa aplikasi Pembelian.
 */
@Injectable()
export class InventoryControlsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
  ) {}

  async controls(tenantId: string) {
    const today = todayJakarta();
    const since = addDays(today, -60);
    const out: InventoryControlFinding[] = [];
    const add = (key: string, level: InventoryControlFinding['level'], title: string, refs: string[], detail: string) => {
      if (refs.length) out.push({ key, level, title: `${title} (${refs.length})`, detail, refs });
    };
    const pol = await this.approvals.policy(this.db, tenantId);
    const cp = CONTROL_PROFILES[await this.settings.businessModel(this.db, tenantId)];

    // 1. Penyesuaian stok keluar (di luar stock opname) berulang di satu gudang dalam 30 hari (tidak relevan untuk jasa)
    if (cp.adjOutRepeat !== null) {
    const adj = await this.db.execute<{ wh: string; n: number }>(sql`
      SELECT w.name AS wh, COUNT(DISTINCT m.ref_id)::int AS n
      FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
      WHERE m.tenant_id = ${tenantId} AND m.type = 'ADJUSTMENT_OUT' AND m.ref_type = 'STOCK_ADJUSTMENT' AND m.date >= ${addDays(today, -30)}
        AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.tenant_id = ${tenantId} AND c.adjustment_number = m.ref_number)
      GROUP BY w.name HAVING COUNT(DISTINCT m.ref_id) >= ${cp.adjOutRepeat}`);
    add('ADJ_OUT_REPEAT', 'warning', 'Penyesuaian stok keluar berulang', adj.rows.map((r) => `${r.wh}: ${r.n} kali`), 'Stok dikurangi lewat penyesuaian (bukan opname) berulang kali dalam 30 hari — salah satu modus pencurian barang. Tinjau alasan & pelakunya.');
    }

    // 2. Penyesuaian stok keluar bernilai besar (≥ batas pemberitahuan Pemilik)
    if (pol.stockAlertValue > 0) {
      const big = await this.db.execute<{ number: string; wh: string; v: string }>(sql`
        SELECT m.ref_number AS number, w.name AS wh, SUM(ABS(m.qty) * m.unit_cost)::text AS v
        FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
        WHERE m.tenant_id = ${tenantId} AND m.type = 'ADJUSTMENT_OUT' AND m.ref_type = 'STOCK_ADJUSTMENT' AND m.date >= ${since}
          AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.tenant_id = ${tenantId} AND c.adjustment_number = m.ref_number)
        GROUP BY m.ref_number, w.name HAVING SUM(ABS(m.qty) * m.unit_cost) >= ${pol.stockAlertValue} ORDER BY SUM(ABS(m.qty) * m.unit_cost) DESC`);
      add('ADJ_OUT_LARGE', 'warning', 'Penyesuaian stok keluar bernilai besar', big.rows.map((r) => `${r.number} ${r.wh} ${rp(r.v)}`), 'Stok dikurangi tanpa penjualan atau opname. Pastikan alasannya jelas (rusak, hilang, kedaluwarsa) dan ada bukti.');

      // 3. Selisih opname kurang bernilai besar
      const loss = await this.db.execute<{ number: string; wh: string; v: string }>(sql`
        SELECT c.number, w.name AS wh, SUM(ABS(m.qty) * m.unit_cost)::text AS v
        FROM stock_counts c JOIN warehouses w ON w.id = c.warehouse_id
        JOIN stock_moves m ON m.tenant_id = c.tenant_id AND m.ref_number = c.adjustment_number AND m.type = 'ADJUSTMENT_OUT'
        WHERE c.tenant_id = ${tenantId} AND c.status = 'POSTED' AND c.date >= ${since}
        GROUP BY c.number, w.name HAVING SUM(ABS(m.qty) * m.unit_cost) >= ${pol.stockAlertValue} ORDER BY SUM(ABS(m.qty) * m.unit_cost) DESC`);
      add('COUNT_LOSS', 'warning', 'Stock opname dengan kekurangan besar', loss.rows.map((r) => `${r.number} ${r.wh} kurang ${rp(r.v)}`), 'Barang fisik lebih sedikit dari catatan. Telusuri penyebabnya (pencurian, salah catat, retur belum tercatat).');
    }

    // 2b. Penyesuaian stok MASUK bernilai besar (stok bertambah tanpa pembelian; bisa menggelembungkan nilai persediaan)
    if (pol.stockAlertValue > 0) {
      const inBig = await this.db.execute<{ number: string; wh: string; v: string }>(sql`
        SELECT m.ref_number AS number, w.name AS wh, SUM(ABS(m.qty) * m.unit_cost)::text AS v
        FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
        WHERE m.tenant_id = ${tenantId} AND m.type = 'ADJUSTMENT_IN' AND m.ref_type = 'STOCK_ADJUSTMENT' AND m.date >= ${since}
          AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.tenant_id = ${tenantId} AND c.adjustment_number = m.ref_number)
          AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.tenant_id = ${tenantId} AND j.source_type = 'STOCK_ADJUSTMENT' AND j.source_id::text = m.ref_id::text AND j.description LIKE '%(OPENING)%')
        GROUP BY m.ref_number, w.name HAVING SUM(ABS(m.qty) * m.unit_cost) >= ${pol.stockAlertValue} ORDER BY SUM(ABS(m.qty) * m.unit_cost) DESC`);
      add('ADJ_IN_LARGE', 'warning', 'Penyesuaian stok masuk bernilai besar', inBig.rows.map((r) => `${r.number} ${r.wh} ${rp(r.v)}`), 'Stok bertambah tanpa pembelian atau opname. Periksa harga pokok yang diketik dan buktinya; nilainya langsung menambah persediaan.');
    }

    // 2c. Penyesuaian keluar dipecah di bawah batas persetujuan: ≥ 2 penyesuaian dalam 3 hari di satu gudang, masing-masing di bawah batas tetapi jumlahnya melewati
    const splitLimit = pol.stockAdjustment > 0 ? pol.stockAdjustment : pol.stockAlertValue;
    if (splitLimit > 0) {
      const adjs = await this.db.execute<{ number: string; wh: string; date: string; v: string }>(sql`
        SELECT m.ref_number AS number, w.name AS wh, MIN(m.date)::text AS date, SUM(ABS(m.qty) * m.unit_cost)::text AS v
        FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
        WHERE m.tenant_id = ${tenantId} AND m.type = 'ADJUSTMENT_OUT' AND m.ref_type = 'STOCK_ADJUSTMENT' AND m.date >= ${since}
          AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.tenant_id = ${tenantId} AND c.adjustment_number = m.ref_number)
        GROUP BY m.ref_number, w.name ORDER BY MIN(m.date)`);
      const byWh = new Map<string, typeof adjs.rows>();
      for (const r of adjs.rows.filter((x) => Number(x.v) < splitLimit)) byWh.set(r.wh, [...(byWh.get(r.wh) ?? []), r]);
      const flagged = new Set<string>();
      for (const rows of byWh.values()) {
        for (let i = 0; i < rows.length; i++) {
          const win = rows.filter((r) => Date.parse(r.date) >= Date.parse(rows[i].date) && Date.parse(r.date) - Date.parse(rows[i].date) <= 3 * 86_400_000);
          if (win.length >= 2 && win.reduce((a, r) => a + Number(r.v), 0) >= splitLimit) win.forEach((r) => flagged.add(`${r.number} (${r.wh})`));
        }
      }
      add('ADJ_OUT_SPLIT', 'warning', 'Penyesuaian stok keluar dipecah di bawah batas', [...flagged], `Beberapa penyesuaian keluar dalam 3 hari di gudang yang sama, tiap penyesuaian di bawah Rp${splitLimit.toLocaleString('id-ID')} tetapi jumlahnya melewati batas. Pastikan bukan cara menghindari persetujuan.`);
    }

    // 4. Gudang utama berisi stok yang lewat jadwal opname (belum pernah atau terakhir > {COUNT_INTERVAL_DAYS} hari)
    const stale = await this.db.execute<{ name: string; last: string | null }>(sql`
      SELECT w.name, MAX(c.posted_at)::date::text AS last
      FROM warehouses w LEFT JOIN stock_counts c ON c.warehouse_id = w.id AND c.status = 'POSTED'
      WHERE w.tenant_id = ${tenantId} AND w.kind = 'MAIN'
        AND EXISTS (SELECT 1 FROM stock_balances b WHERE b.warehouse_id = w.id AND b.qty > 0)
        AND EXISTS (SELECT 1 FROM stock_moves m WHERE m.warehouse_id = w.id AND m.date <= ${addDays(today, -COUNT_INTERVAL_DAYS)})
      GROUP BY w.id, w.name
      HAVING MAX(c.posted_at) IS NULL OR MAX(c.posted_at)::date < ${addDays(today, -COUNT_INTERVAL_DAYS)}`);
    add('COUNT_STALE', 'warning', `Gudang belum diopname > ${COUNT_INTERVAL_DAYS} hari`, stale.rows.map((r) => `${r.name} (${r.last ? `terakhir ${r.last}` : 'belum pernah'})`), 'Tanpa hitung fisik berkala, selisih dan kehilangan terdeteksi terlambat. Jadwalkan stock opname.');

    // 5. Transfer antar gudang menggantung di perjalanan
    const stuck = await this.db.execute<{ number: string; from_wh: string; to_wh: string; days: number }>(sql`
      SELECT t.number, fw.name AS from_wh, tw.name AS to_wh, (CURRENT_DATE - t.date)::int AS days
      FROM stock_transfers t JOIN warehouses fw ON fw.id = t.from_warehouse_id JOIN warehouses tw ON tw.id = t.to_warehouse_id
      WHERE t.tenant_id = ${tenantId} AND t.status = 'IN_TRANSIT' AND t.date <= ${addDays(today, -TRANSFER_STUCK_DAYS)}
      ORDER BY t.date`);
    add('TRANSFER_STUCK', 'warning', `Transfer gudang belum diterima > ${TRANSFER_STUCK_DAYS} hari`, stuck.rows.map((r) => `${r.number} ${r.from_wh} → ${r.to_wh} (${r.days} hari)`), 'Barang sudah keluar dari gudang asal tetapi belum diterima. Konfirmasi ke gudang tujuan atau batalkan transfer.');

    const rank = { error: 0, warning: 1, info: 2 } as const;
    out.sort((a, b) => rank[a.level] - rank[b.level]);
    const setup = {
      active: pol.stockAdjustment > 0 || pol.stockInCostTolerancePct > 0 || pol.blindCount || pol.stockCountSod,
      message: 'Persetujuan penyesuaian stok dan selisih opname, pengecekan harga pokok barang masuk, dan opname buta belum aktif. Tanpa itu, Gudang atau Admin bisa menyesuaikan stok sendirian (hanya Pemilik yang diberi tahu).',
      recommended: { stockAdjustment: 5_000_000, stockInCostTolerancePct: 25, blindCount: true },
      recommendedText: 'penyesuaian dan selisih opname ≥ Rp5 juta butuh persetujuan, harga masuk > 25% di atas rata-rata butuh persetujuan, opname buta',
    };
    return { asOf: today, since, items: out, setup };
  }
}

@ApiTags('Inventori')
@ApiBearerAuth()
@RequireApp('inventory')
@Controller('inventory-controls')
export class InventoryControlsController {
  constructor(private readonly svc: InventoryControlsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
}

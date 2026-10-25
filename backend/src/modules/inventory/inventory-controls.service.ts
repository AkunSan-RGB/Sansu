import { Injectable } from '@nestjs/common';
import { CONTROL_PROFILES } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { BinsService } from './bins.service';
import { InventoryControlsRepository, COUNT_INTERVAL_DAYS, TRANSFER_STUCK_DAYS, CYCLE_COUNT_DAYS } from './inventory-controls.repository';
export { COUNT_INTERVAL_DAYS } from './inventory-controls.repository';
export { TRANSFER_STUCK_DAYS } from './inventory-controls.repository';
export { CYCLE_COUNT_DAYS } from './inventory-controls.repository';

export interface InventoryControlFinding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

const rp = (v: number | string) => `Rp${Math.round(Number(v)).toLocaleString('id-ID')}`;

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
    private readonly bins: BinsService,
    private readonly repo: InventoryControlsRepository,
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
    const adj = await this.repo.queryStockMove(this.db, tenantId, today, cp.adjOutRepeat);
    add('ADJ_OUT_REPEAT', 'warning', 'Penyesuaian stok keluar berulang', adj.rows.map((r) => `${r.wh}: ${r.n} kali`), 'Stok dikurangi lewat penyesuaian (bukan opname) berulang kali dalam 30 hari — salah satu modus pencurian barang. Tinjau alasan & pelakunya.');
    }

    // 2. Penyesuaian stok keluar bernilai besar (≥ batas pemberitahuan Pemilik)
    if (pol.stockAlertValue > 0) {
      const big = await this.repo.queryStockMoveForControls(this.db, tenantId, since, pol.stockAlertValue);
      add('ADJ_OUT_LARGE', 'warning', 'Penyesuaian stok keluar bernilai besar', big.rows.map((r) => `${r.number} ${r.wh} ${rp(r.v)}`), 'Stok dikurangi tanpa penjualan atau opname. Pastikan alasannya jelas (rusak, hilang, kedaluwarsa) dan ada bukti.');

      // 3. Selisih opname kurang bernilai besar
      const loss = await this.repo.queryStockCount(this.db, tenantId, since, pol.stockAlertValue);
      add('COUNT_LOSS', 'warning', 'Stock opname dengan kekurangan besar', loss.rows.map((r) => `${r.number} ${r.wh} kurang ${rp(r.v)}`), 'Barang fisik lebih sedikit dari catatan. Telusuri penyebabnya (pencurian, salah catat, retur belum tercatat).');
    }

    // 2b. Penyesuaian stok MASUK bernilai besar (stok bertambah tanpa pembelian; bisa menggelembungkan nilai persediaan)
    if (pol.stockAlertValue > 0) {
      const inBig = await this.repo.queryStockMoveForControls2(this.db, tenantId, since, pol.stockAlertValue);
      add('ADJ_IN_LARGE', 'warning', 'Penyesuaian stok masuk bernilai besar', inBig.rows.map((r) => `${r.number} ${r.wh} ${rp(r.v)}`), 'Stok bertambah tanpa pembelian atau opname. Periksa harga pokok yang diketik dan buktinya; nilainya langsung menambah persediaan.');
    }

    // 2c. Penyesuaian keluar dipecah di bawah batas persetujuan: ≥ 2 penyesuaian dalam 3 hari di satu gudang, masing-masing di bawah batas tetapi jumlahnya melewati
    const splitLimit = pol.stockAdjustment > 0 ? pol.stockAdjustment : pol.stockAlertValue;
    if (splitLimit > 0) {
      const adjs = await this.repo.queryStockMoveForControls3(this.db, tenantId, since);
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
    const stale = await this.repo.queryWarehouse(this.db, tenantId, today);
    add('COUNT_STALE', 'warning', `Gudang belum diopname > ${COUNT_INTERVAL_DAYS} hari`, stale.rows.map((r) => `${r.name} (${r.last ? `terakhir ${r.last}` : 'belum pernah'})`), 'Tanpa hitung fisik berkala, selisih dan kehilangan terdeteksi terlambat. Jadwalkan stock opname.');

    // 5. Transfer antar gudang menggantung di perjalanan
    const stuck = await this.repo.queryStockTransfer(this.db, tenantId, today);
    add('TRANSFER_STUCK', 'warning', `Transfer gudang belum diterima > ${TRANSFER_STUCK_DAYS} hari`, stuck.rows.map((r) => `${r.number} ${r.from_wh} → ${r.to_wh} (${r.days} hari)`), 'Barang sudah keluar dari gudang asal tetapi belum diterima. Konfirmasi ke gudang tujuan atau batalkan transfer.');

    // 6. Rekonsiliasi nilai stok (buku pembantu) vs saldo akun persediaan di buku besar
    const rec = (await this.repo.queryControls(this.db, tenantId)).rows[0];
    const diff = Number(rec.stock) - Number(rec.gl);
    if (Math.abs(diff) >= Math.max(100_000, Math.abs(Number(rec.gl)) * 0.01)) {
      add('STOCK_GL_DIFF', 'error', 'Nilai stok tidak sama dengan buku besar', [`Stok ${rp(rec.stock)} · Buku besar ${rp(rec.gl)} · selisih ${rp(diff)}`], 'Nilai persediaan di kartu stok berbeda dari saldo akun Persediaan. Biasanya karena jurnal manual ke akun persediaan, stok awal belum dijurnal, atau penyesuaian tanpa jurnal. Telusuri sebelum tutup buku.');
    }

    // 7. Opname siklus: barang kelas A (80% nilai stok teratas, maks 20) yang belum dihitung fisik dalam {CYCLE_COUNT_DAYS} hari
    const abc = await this.repo.queryRanked(this.db, tenantId, today);
    add('COUNT_CYCLE', 'info', `Barang bernilai tinggi belum dihitung > ${CYCLE_COUNT_DAYS} hari`, abc.rows.map((r) => `${r.sku} ${r.name} ${rp(r.v)} (${r.last ? `terakhir ${r.last}` : 'belum pernah'})`), 'Barang yang membentuk ±80% nilai stok sebaiknya dihitung lebih sering daripada yang murah. Buat opname sebagian untuk barang-barang ini.');

    out.push(...(await this.bins.controls(tenantId)));
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

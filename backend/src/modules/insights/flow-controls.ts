/**
 * Kontrol anti-fraud per alur (60 hari terakhir), melengkapi Kontrol pembelian: penjualan, kasir, kas, dan SDM.
 * Hanya MENANDAI pola yang patut diperiksa — tidak menuduh; setiap temuan menyebut dokumen/orangnya agar bisa ditelusuri.
 */
import { Controller, Get, Injectable } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AppsService } from '../../common/apps/apps.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';

export interface FlowFinding {
  key: string;
  flow: 'PENJUALAN' | 'KASIR' | 'KAS' | 'SDM';
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

export const THRESHOLDS = { discountPct: 25, returnedShare: 0.5, repeatReturns: 3, cashierDiffSessions: 3, cashierReturns: 5, structuringCount: 3 } as const;
const list = (rows: string[]) => rows.slice(0, 6).join(', ') + (rows.length > 6 ? `, dan ${rows.length - 6} lainnya` : '');
const rp = (v: number | string) => `Rp${Math.round(Number(v)).toLocaleString('id-ID')}`;

@Injectable()
export class FlowControlsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly approvals: ApprovalsService,
    private readonly apps: AppsService,
  ) {}

  async findings(tenantId: string): Promise<FlowFinding[]> {
    const since = addDays(todayJakarta(), -60);
    const since30 = addDays(todayJakarta(), -30);
    const on = await this.apps.enabled(tenantId);
    const out: FlowFinding[] = [];
    const add = (key: string, flow: FlowFinding['flow'], level: FlowFinding['level'], title: string, refs: string[], detail: string) => {
      if (refs.length) out.push({ key, flow, level, title: `${title} (${refs.length})`, detail, refs });
    };
    const q = async <T extends Record<string, unknown>>(s: ReturnType<typeof sql>) => (await this.db.execute<T>(s)).rows;

    if (on.has('sales')) {
      const disc = await q<{ number: string; pct: string }>(sql`
        SELECT i.number, MAX(l.discount_pct) AS pct FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
        WHERE i.tenant_id = ${tenantId} AND i.date >= ${since} AND i.is_opening = false AND l.discount_pct >= ${THRESHOLDS.discountPct} GROUP BY i.number ORDER BY pct DESC`);
      add('sales-discount-high', 'PENJUALAN', 'warning', `Diskon baris ≥ ${THRESHOLDS.discountPct}%`, disc.map((r) => `${r.number} (${Number(r.pct)}%)`), 'Diskon besar tanpa persetujuan lazim dipakai untuk menguntungkan pembeli tertentu. Pastikan ada dasarnya (promo, kontrak).');
      const loss = await q<{ number: string; loss: string }>(sql`
        SELECT i.number, SUM((l.unit_cost * l.uom_factor - l.line_total / NULLIF(l.qty, 0)) * l.qty) AS loss FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
        WHERE i.tenant_id = ${tenantId} AND i.date >= ${since} AND i.is_opening = false AND l.qty > 0 AND l.unit_cost > 0 AND l.line_total / l.qty < l.unit_cost * l.uom_factor
        GROUP BY i.number ORDER BY loss DESC`);
      add('sales-below-cost', 'PENJUALAN', 'warning', 'Faktur dijual di bawah harga pokok', loss.map((r) => `${r.number} (rugi ${rp(r.loss)})`), 'Periksa harga, diskon, atau salah input; penjualan rugi berulang ke pelanggan yang sama patut ditelusuri.');
      const ret = await q<{ number: string; pct: string }>(sql`
        SELECT number, ROUND(returned_amount / NULLIF(total, 0) * 100) AS pct FROM invoices
        WHERE tenant_id = ${tenantId} AND date >= ${since} AND is_opening = false AND total > 0 AND returned_amount >= total * ${THRESHOLDS.returnedShare} ORDER BY pct DESC`);
      add('sales-returned-heavy', 'PENJUALAN', 'warning', `Faktur diretur ≥ ${THRESHOLDS.returnedShare * 100}% nilainya`, ret.map((r) => `${r.number} (${r.pct}%)`), 'Retur besar bisa menutupi penjualan fiktif atau pengembalian dana tersembunyi. Cek alasan dan barang yang kembali ke gudang.');
      const rep = await q<{ name: string; n: number }>(sql`
        SELECT c.name, COUNT(*)::int AS n FROM sales_returns r JOIN customers c ON c.id = r.customer_id
        WHERE r.tenant_id = ${tenantId} AND r.date >= ${since30} GROUP BY c.name HAVING COUNT(*) >= ${THRESHOLDS.repeatReturns} ORDER BY n DESC`);
      add('sales-return-repeat', 'PENJUALAN', 'info', `Pelanggan dengan ≥ ${THRESHOLDS.repeatReturns} retur dalam 30 hari`, rep.map((r) => `${r.name} (${r.n}×)`), 'Retur berulang dari pelanggan yang sama: periksa kualitas barang atau penyalahgunaan retur.');
      const over = await q<{ name: string; ar: string; lim: string }>(sql`
        SELECT c.name, SUM(i.total - i.paid_amount - i.returned_amount) AS ar, c.credit_limit AS lim FROM customers c JOIN invoices i ON i.customer_id = c.id AND i.status <> 'PAID'
        WHERE c.tenant_id = ${tenantId} AND c.credit_limit > 0 GROUP BY c.id, c.name, c.credit_limit HAVING SUM(i.total - i.paid_amount - i.returned_amount) > c.credit_limit`);
      add('sales-credit-over', 'PENJUALAN', 'error', 'Piutang melebihi batas kredit pelanggan', over.map((r) => `${r.name} (${rp(r.ar)} dari batas ${rp(r.lim)})`), 'Batas kredit dilampaui, mungkin lewat faktur langsung tanpa pesanan. Tahan pengiriman berikutnya sampai ada pelunasan atau persetujuan.');
    }

    if (on.has('pos')) {
      const diff = await q<{ name: string; n: number; total: string }>(sql`
        SELECT u.name, COUNT(*)::int AS n, SUM(s.difference) AS total FROM pos_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.tenant_id = ${tenantId} AND s.status = 'CLOSED' AND s.closed_at >= ${since}::date AND COALESCE(s.difference, 0) <> 0
        GROUP BY u.id, u.name HAVING COUNT(*) >= ${THRESHOLDS.cashierDiffSessions} ORDER BY n DESC`);
      add('pos-diff-repeat', 'KASIR', 'error', `Kasir dengan selisih kas di ≥ ${THRESHOLDS.cashierDiffSessions} sesi`, diff.map((r) => `${r.name}: ${r.n} sesi, selisih bersih ${rp(r.total)}`), 'Selisih berulang pada kasir yang sama adalah tanda klasik penggelapan kecil. Hitung ulang uang bersama orang lain dan tinjau rekaman.');
      const pr = await q<{ name: string; n: number; total: string }>(sql`
        SELECT u.name, COUNT(*)::int AS n, SUM(r.total) AS total FROM pos_returns r JOIN users u ON u.id = r.created_by_id
        WHERE r.tenant_id = ${tenantId} AND r.date >= ${since30} GROUP BY u.id, u.name HAVING COUNT(*) >= ${THRESHOLDS.cashierReturns} ORDER BY n DESC`);
      add('pos-returns-heavy', 'KASIR', 'warning', `Kasir dengan ≥ ${THRESHOLDS.cashierReturns} retur dalam 30 hari`, pr.map((r) => `${r.name}: ${r.n} retur, ${rp(r.total)}`), 'Retur kasir bisa dipakai mengambil uang tunai. Cocokkan dengan barang yang benar-benar kembali.');
      const night = await q<{ number: string; name: string }>(sql`
        SELECT s.number, u.name FROM pos_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.tenant_id = ${tenantId} AND s.opened_at >= ${since}::date AND EXTRACT(HOUR FROM s.opened_at AT TIME ZONE 'Asia/Jakarta') < 4`);
      add('pos-after-hours', 'KASIR', 'info', 'Sesi kasir dibuka dini hari (00.00–04.00 WIB)', night.map((r) => `${r.number} (${r.name})`), 'Wajar bila ada shift malam; bila tidak, periksa siapa yang membuka kasir di luar jam usaha.');
    }

    if (on.has('cash')) {
      const policy = await this.approvals.policy(this.db, tenantId);
      if (policy.cashOut > 0) {
        const lo = policy.cashOut * 0.9;
        const split = await q<{ name: string; n: number; total: string }>(sql`
          SELECT u.name, COUNT(*)::int AS n, SUM(t.amount) AS total FROM cash_transactions t JOIN users u ON u.id = t.created_by_id
          WHERE t.tenant_id = ${tenantId} AND t.type = 'OUT' AND t.status = 'POSTED' AND t.date >= ${since30} AND t.amount >= ${lo} AND t.amount < ${policy.cashOut}
          GROUP BY u.id, u.name HAVING COUNT(*) >= ${THRESHOLDS.structuringCount} ORDER BY n DESC`);
        add('cash-structuring', 'KAS', 'error', `Kas keluar tepat di bawah batas persetujuan (${rp(policy.cashOut)}) berulang`, split.map((r) => `${r.name}: ${r.n}× (total ${rp(r.total)})`), 'Nilai yang selalu di bawah batas persetujuan adalah pola memecah transaksi agar tidak perlu disetujui.');
      }
      const voids = await q<{ number: string; name: string }>(sql`
        SELECT t.number, u.name FROM cash_transactions t JOIN users u ON u.id = t.voided_by_id JOIN users c ON c.id = t.created_by_id
        WHERE t.tenant_id = ${tenantId} AND t.status = 'VOID' AND t.date >= ${since} AND t.voided_by_id = t.created_by_id AND u.role NOT IN ('OWNER')`);
      add('cash-void-own', 'KAS', 'warning', 'Transaksi kas dibatalkan oleh pembuatnya sendiri', voids.map((r) => `${r.number} (${r.name})`), 'Pembatalan oleh orang yang sama dengan pembuat tidak melewati pemeriksa kedua. Pastikan alasannya sah.');
    }

    if (on.has('hr')) {
      const bank = await q<{ acct: string; codes: string[] }>(sql`
        SELECT bank_account AS acct, array_agg(code ORDER BY code) AS codes FROM employees
        WHERE tenant_id = ${tenantId} AND is_active AND COALESCE(trim(bank_account), '') <> '' GROUP BY bank_account HAVING COUNT(*) > 1`);
      add('emp-shared-bank', 'SDM', 'error', 'Rekening bank dipakai lebih dari satu karyawan', bank.map((r) => `${r.codes.join(' & ')} (rek. ${r.acct})`), 'Rekening ganda adalah tanda karyawan fiktif ("ghost employee") atau gaji dialihkan. Verifikasi identitas dan buku tabungan.');
      if (on.has('payroll')) {
        const ghost = await q<{ code: string; name: string }>(sql`
          WITH last_run AS (SELECT id, period FROM payroll_runs WHERE tenant_id = ${tenantId} AND status <> 'DRAFT' ORDER BY period DESC LIMIT 1),
          att AS (SELECT a.employee_id, COUNT(*) FILTER (WHERE a.status = 'HADIR') AS hadir FROM attendances a, last_run r WHERE a.tenant_id = ${tenantId} AND to_char(a.date, 'YYYY-MM') = r.period GROUP BY a.employee_id)
          SELECT e.code, e.name FROM payslips p JOIN last_run r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
          WHERE e.employment_type = 'TETAP' AND COALESCE((SELECT hadir FROM att WHERE att.employee_id = e.id), 0) = 0
            AND (SELECT COUNT(*) FROM att WHERE hadir > 0) >= 0.5 * GREATEST((SELECT COUNT(*) FROM payslips WHERE run_id = r.id), 1)`);
        add('emp-paid-no-attendance', 'SDM', 'warning', 'Digaji tanpa satu pun absensi hadir pada periode gaji terakhir', ghost.map((r) => `${r.code} ${r.name}`), 'Sebagian besar karyawan lain punya absensi, tetapi mereka tidak. Pastikan mereka benar-benar bekerja (atau sedang cuti tercatat).');
      }
    }
    const order = { error: 0, warning: 1, info: 2 };
    return out.sort((a, b) => order[a.level] - order[b.level]);
  }
}

@ApiTags('Kontrol alur')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('controls')
export class FlowControlsController {
  constructor(private readonly svc: FlowControlsService) {}

  @Get('flows')
  flows(@CurrentUser() u: AuthUser) {
    return this.svc.findings(u.tenantId);
  }
}

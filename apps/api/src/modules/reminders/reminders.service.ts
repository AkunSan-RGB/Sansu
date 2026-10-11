/**
 * Pengingat otomatis: daftar hal yang perlu ditindaklanjuti, dihitung langsung dari data (tidak perlu dibuat manual) dan
 * disaring menurut peran pengguna. Pengguna bisa menunda satu pengingat beberapa hari. Ambang waktu diatur per perusahaan.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import { AppsService } from '../../common/apps/apps.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { SettingsService } from '../../common/settings.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { reminderSnoozes } from '../../db/schema';
import { TAX_LABEL, TaxService } from '../tax/tax.module';

export type ReminderCategory = 'PIUTANG' | 'UTANG' | 'STOK' | 'PEMBELIAN' | 'PENJUALAN' | 'PAJAK' | 'PERSETUJUAN' | 'SDM' | 'LANGGANAN';
export type ReminderLevel = 'error' | 'warning' | 'info';

export interface ReminderItem {
  key: string;
  category: ReminderCategory;
  level: ReminderLevel;
  title: string;
  detail: string;
  link: string;
  count?: number;
  /** Diisi bila pengingat sedang ditunda pengguna (hanya pada daftar lengkap) */
  snoozedUntil?: string;
}

export interface ReminderSettings {
  /** Seluruh pengingat aktif */
  enabled: boolean;
  /** Piutang: hari sebelum jatuh tempo mulai diingatkan */
  arLeadDays: number;
  /** Utang supplier: hari sebelum jatuh tempo mulai diingatkan */
  apLeadDays: number;
  /** Barang diterima belum ditagih lebih dari ... hari */
  grniDays: number;
  /** Pesanan pembelian terkonfirmasi belum diterima lebih dari ... hari */
  poDays: number;
  /** Surat jalan belum difakturkan lebih dari ... hari */
  deliveryDays: number;
  /** Setoran pajak: hari sebelum jatuh tempo mulai diingatkan */
  taxLeadDays: number;
  /** Tanggal mulai mengingatkan gaji bulan berjalan yang belum diproses */
  payrollDay: number;
  /** Kirim ringkasan harian lewat email ke pemilik, admin, dan keuangan */
  emailDigest: boolean;
  /** Pengingat tagihan otomatis ke pelanggan lewat email */
  customerReminders: boolean;
  /** Hari sebelum jatuh tempo pengingat pertama dikirim ke pelanggan (0 = hanya saat jatuh tempo dan sesudahnya) */
  customerLeadDays: number;
  /** Pengingat tunggakan diulang setiap ... hari */
  customerRepeatDays: number;
  /** Banyaknya pengingat tunggakan yang dikirim per faktur */
  customerMaxOverdue: number;
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: true,
  arLeadDays: 3,
  apLeadDays: 7,
  grniDays: 14,
  poDays: 14,
  deliveryDays: 7,
  taxLeadDays: 14,
  payrollDay: 25,
  emailDigest: true,
  customerReminders: false,
  customerLeadDays: 3,
  customerRepeatDays: 7,
  customerMaxOverdue: 3,
};

/** Peran yang melihat tiap pengingat */
const AUDIENCE: Record<string, readonly string[]> = {
  'ar-overdue': ['OWNER', 'ADMIN', 'FINANCE', 'SALES'],
  'ar-due-soon': ['OWNER', 'ADMIN', 'FINANCE', 'SALES'],
  'ap-overdue': ['OWNER', 'ADMIN', 'FINANCE'],
  'ap-due-soon': ['OWNER', 'ADMIN', 'FINANCE'],
  'low-stock': ['OWNER', 'ADMIN', 'WAREHOUSE', 'FINANCE'],
  'grni-old': ['OWNER', 'ADMIN', 'FINANCE'],
  'po-not-received': ['OWNER', 'ADMIN', 'FINANCE', 'WAREHOUSE'],
  'delivery-not-invoiced': ['OWNER', 'ADMIN', 'FINANCE', 'SALES'],
  tax: ['OWNER', 'ADMIN', 'FINANCE'],
  approvals: ['OWNER', 'ADMIN'],
  'pr-pending': ['OWNER', 'ADMIN'],
  'pr-approved': ['OWNER', 'ADMIN', 'FINANCE', 'WAREHOUSE'],
  payroll: ['OWNER', 'ADMIN', 'FINANCE', 'HR'],
  subscription: ['OWNER', 'ADMIN'],
};
const audienceOf = (key: string) => AUDIENCE[key.startsWith('tax-') ? 'tax' : key] ?? [];

const rp = (v: number | string) => `Rp${Math.round(Number(v)).toLocaleString('id-ID')}`;
const names = (rows: { name: string }[], total: number) => {
  const shown = [...new Set(rows.map((r) => r.name))].slice(0, 3).join(', ');
  return total > 3 ? `${shown}, dan lainnya` : shown;
};

@Injectable()
export class RemindersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly apps: AppsService,
    private readonly subs: SubscriptionService,
    private readonly tax: TaxService,
  ) {}

  async config(tenantId: string): Promise<ReminderSettings> {
    return this.settings.section(this.db, tenantId, 'reminders', DEFAULT_REMINDERS);
  }

  async saveConfig(tenantId: string, patch: Partial<ReminderSettings>): Promise<ReminderSettings> {
    return this.settings.saveSection(this.db, tenantId, 'reminders', DEFAULT_REMINDERS, patch);
  }

  private async rows<T extends Record<string, unknown>>(q: ReturnType<typeof sql>) {
    return (await this.db.execute<T>(q)).rows;
  }

  /** Semua pengingat perusahaan (belum disaring peran/tunda) */
  async compute(tenantId: string, cfg?: ReminderSettings): Promise<ReminderItem[]> {
    const c = cfg ?? (await this.config(tenantId));
    if (!c.enabled) return [];
    const today = todayJakarta();
    const on = await this.apps.enabled(tenantId);
    const items: ReminderItem[] = [];

    // ---- piutang pelanggan ----
    if (on.has('sales') || on.has('pos') || on.has('crm')) {
      const ar = await this.rows<{ name: string; out: string; due: string }>(sql`
        SELECT cu.name, (i.total - i.paid_amount - i.returned_amount)::numeric AS out, i.due_date::text AS due
        FROM invoices i JOIN customers cu ON cu.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND (i.total - i.paid_amount - i.returned_amount) > 0.005
        ORDER BY i.due_date`);
      const days = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
      const overdue = ar.filter((r) => r.due < today);
      if (overdue.length) {
        const sum = overdue.reduce((a, r) => a + Number(r.out), 0);
        const oldest = Math.max(...overdue.map((r) => days(r.due)));
        items.push({
          key: 'ar-overdue',
          category: 'PIUTANG',
          level: oldest > 30 ? 'error' : 'warning',
          title: `${overdue.length} faktur pelanggan lewat jatuh tempo`,
          detail: `${rp(sum)} · terlama ${oldest} hari · ${names(overdue.sort((a, b) => Number(b.out) - Number(a.out)), overdue.length)}`,
          link: '/invoices',
          count: overdue.length,
        });
      }
      const soonTo = addDays(today, c.arLeadDays);
      const soon = ar.filter((r) => r.due >= today && r.due <= soonTo);
      if (soon.length) {
        items.push({
          key: 'ar-due-soon',
          category: 'PIUTANG',
          level: 'info',
          title: `${soon.length} faktur pelanggan jatuh tempo ≤ ${c.arLeadDays} hari`,
          detail: `${rp(soon.reduce((a, r) => a + Number(r.out), 0))} · ${names(soon, soon.length)}`,
          link: '/invoices',
          count: soon.length,
        });
      }
    }

    // ---- utang supplier ----
    if (on.has('purchase')) {
      const ap = await this.rows<{ name: string; out: string; due: string }>(sql`
        SELECT s.name, (i.total - i.paid_amount - i.returned_amount)::numeric AS out, i.due_date::text AS due
        FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND (i.total - i.paid_amount - i.returned_amount) > 0.005
        ORDER BY i.due_date`);
      const overdue = ap.filter((r) => r.due < today);
      if (overdue.length) {
        items.push({
          key: 'ap-overdue',
          category: 'UTANG',
          level: 'error',
          title: `${overdue.length} faktur supplier lewat jatuh tempo`,
          detail: `${rp(overdue.reduce((a, r) => a + Number(r.out), 0))} · ${names(overdue, overdue.length)}`,
          link: '/purchase-invoices',
          count: overdue.length,
        });
      }
      const soon = ap.filter((r) => r.due >= today && r.due <= addDays(today, c.apLeadDays));
      if (soon.length) {
        items.push({
          key: 'ap-due-soon',
          category: 'UTANG',
          level: 'warning',
          title: `${soon.length} faktur supplier jatuh tempo ≤ ${c.apLeadDays} hari`,
          detail: `${rp(soon.reduce((a, r) => a + Number(r.out), 0))} · siapkan dana pembayaran`,
          link: '/purchase-invoices',
          count: soon.length,
        });
      }

      // ---- barang diterima belum ditagih ----
      const grni = (await this.rows<{ n: number; v: string; oldest: string | null }>(sql`
        SELECT COUNT(DISTINCT g.id)::int AS n, COALESCE(SUM(l.value - l.billed_value), 0)::text AS v, MIN(g.date)::text AS oldest
        FROM goods_receipts g JOIN goods_receipt_lines l ON l.receipt_id = g.id
        WHERE g.tenant_id = ${tenantId} AND g.status = 'RECEIVED' AND g.auto_invoice_id IS NULL
          AND (l.qty - l.billed_qty) > 0.00005 AND g.date <= ${addDays(today, -c.grniDays)}`))[0];
      if (grni?.n) {
        items.push({
          key: 'grni-old',
          category: 'PEMBELIAN',
          level: 'warning',
          title: `${grni.n} penerimaan barang belum difakturkan > ${c.grniDays} hari`,
          detail: `Nilai ${rp(grni.v)} · tagih faktur ke supplier atau catat fakturnya`,
          link: '/goods-receipts',
          count: grni.n,
        });
      }
      const po = (await this.rows<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM purchase_orders o
        WHERE o.tenant_id = ${tenantId} AND o.status = 'CONFIRMED' AND o.date <= ${addDays(today, -c.poDays)}
          AND NOT EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.order_id = o.id AND l.received_qty > 0)`))[0];
      if (po?.n) {
        items.push({
          key: 'po-not-received',
          category: 'PEMBELIAN',
          level: 'info',
          title: `${po.n} pesanan pembelian belum diterima > ${c.poDays} hari`,
          detail: 'Konfirmasi pengiriman ke supplier',
          link: '/purchase-orders',
          count: po.n,
        });
      }
    }

    // ---- stok di bawah minimum ----
    if (on.has('inventory') || on.has('purchase') || on.has('sales')) {
      const low = (await this.rows<{ n: number; wh: number }>(sql`
        SELECT COUNT(*)::int AS n, COUNT(DISTINCT m.warehouse_id)::int AS wh
        FROM stock_minimums m
        JOIN products p ON p.id = m.product_id AND p.is_active
        JOIN warehouses w ON w.id = m.warehouse_id AND w.is_active
        LEFT JOIN stock_balances b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id
        WHERE m.tenant_id = ${tenantId} AND COALESCE(b.qty, 0) < m.min_qty`))[0];
      if (low?.n) {
        items.push({
          key: 'low-stock',
          category: 'STOK',
          level: 'warning',
          title: `${low.n} produk di bawah stok minimum`,
          detail: `Di ${low.wh} gudang — buat pesanan pembelian atau transfer antar gudang`,
          link: '/inventory/warehouses?tab=low',
          count: low.n,
        });
      }
    }

    // ---- surat jalan belum difakturkan ----
    if (on.has('sales')) {
      const dn = (await this.rows<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM delivery_orders
        WHERE tenant_id = ${tenantId} AND status = 'DELIVERED' AND invoice_id IS NULL AND date <= ${addDays(today, -c.deliveryDays)}`))[0];
      if (dn?.n) {
        items.push({
          key: 'delivery-not-invoiced',
          category: 'PENJUALAN',
          level: 'warning',
          title: `${dn.n} surat jalan belum difakturkan > ${c.deliveryDays} hari`,
          detail: 'Barang sudah keluar tetapi belum ditagih ke pelanggan',
          link: '/deliveries',
          count: dn.n,
        });
      }
    }

    // ---- pajak ----
    if (on.has('accounting')) {
      const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
      for (const period of [prev, today.slice(0, 7)]) {
        for (const o of await this.tax.obligations(tenantId, period)) {
          if (Number(o.outstanding) <= 0) continue;
          const days = Math.round((Date.parse(o.dueDate) - Date.parse(today)) / 86400000);
          if (days > c.taxLeadDays) continue;
          items.push({
            key: `tax-${o.type}-${o.period}`,
            category: 'PAJAK',
            level: days < 0 ? 'error' : days <= 3 ? 'warning' : 'info',
            title: `${TAX_LABEL[o.type]} masa ${o.period}: ${rp(o.outstanding)}`,
            detail: days < 0 ? `Lewat jatuh tempo ${-days} hari (${o.dueDate})` : days === 0 ? 'Jatuh tempo hari ini' : `Jatuh tempo ${days} hari lagi (${o.dueDate})`,
            link: '/tax',
          });
        }
      }
    }

    // ---- persetujuan menunggu ----
    const ap = (await this.rows<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE tenant_id = ${tenantId} AND status = 'PENDING'`))[0];
    if (ap?.n) {
      items.push({ key: 'approvals', category: 'PERSETUJUAN', level: 'warning', title: `${ap.n} permintaan persetujuan menunggu keputusan`, detail: 'Pesanan pembelian atau jurnal manual bernilai besar', link: '/approvals', count: ap.n });
    }

    // ---- permintaan pembelian: menunggu keputusan & sudah disetujui tapi belum dipesan ----
    if (on.has('purchase')) {
      const pr = (await this.rows<{ pending: number; oldest: number; approved: number }>(sql`
        SELECT COUNT(*) FILTER (WHERE status = 'SUBMITTED')::int AS pending,
               COALESCE(MAX(CURRENT_DATE - COALESCE(submitted_at, created_at)::date) FILTER (WHERE status = 'SUBMITTED'), 0)::int AS oldest,
               COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved
        FROM purchase_requests WHERE tenant_id = ${tenantId}`))[0];
      if (pr?.pending) {
        items.push({ key: 'pr-pending', category: 'PERSETUJUAN', level: pr.oldest >= 2 ? 'error' : 'warning', title: `${pr.pending} permintaan pembelian menunggu persetujuan`, detail: pr.oldest >= 1 ? `Yang terlama menunggu ${pr.oldest} hari` : 'Segera putuskan agar pembelian tidak tertunda', link: '/purchase-requests?status=SUBMITTED', count: pr.pending });
      }
      if (pr?.approved) {
        items.push({ key: 'pr-approved', category: 'PEMBELIAN', level: 'info', title: `${pr.approved} permintaan pembelian disetujui, belum dijadikan PO`, detail: 'Buka permintaan lalu pilih "Buat PO"', link: '/purchase-requests?status=APPROVED', count: pr.approved });
      }
    }

    // ---- gaji bulan berjalan ----
    if (on.has('payroll') && Number(today.slice(8, 10)) >= c.payrollDay) {
      const run = (await this.rows<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM payroll_runs WHERE tenant_id = ${tenantId} AND period = ${today.slice(0, 7)} AND status <> 'DRAFT'`))[0];
      if (!run?.n) {
        items.push({ key: 'payroll', category: 'SDM', level: 'warning', title: `Gaji ${today.slice(0, 7)} belum diproses`, detail: 'Proses dan posting penggajian bulan ini sebelum tanggal pembayaran', link: '/payroll', });
      }
    }

    // ---- langganan ----
    const st = await this.subs.state(tenantId);
    if (st.status === 'OVERDUE' || st.status === 'EXPIRED' || st.status === 'SUSPENDED') {
      items.push({ key: 'subscription', category: 'LANGGANAN', level: 'error', title: 'Langganan SANSU perlu diperpanjang', detail: 'Perpanjang agar data tetap bisa diubah', link: '/billing' });
    } else if ((st.status === 'TRIAL' || st.status === 'ACTIVE') && st.daysLeft !== null && st.daysLeft <= 7) {
      items.push({
        key: 'subscription',
        category: 'LANGGANAN',
        level: st.daysLeft <= 3 ? 'warning' : 'info',
        title: st.status === 'TRIAL' ? `Uji coba berakhir ${st.daysLeft} hari lagi` : `Langganan berakhir ${st.daysLeft} hari lagi`,
        detail: 'Pilih atau perpanjang paket agar tidak terkunci',
        link: '/billing',
      });
    }

    const order = { error: 0, warning: 1, info: 2 };
    return items.sort((a, b) => order[a.level] - order[b.level]);
  }

  /** Pengingat untuk satu pengguna: disaring peran, yang sedang ditunda disembunyikan (kecuali `includeSnoozed`) */
  async forUser(user: AuthUser, includeSnoozed = false) {
    const all = (await this.compute(user.tenantId)).filter((i) => audienceOf(i.key).includes(user.role));
    const today = todayJakarta();
    const snoozes = await this.db
      .select({ key: reminderSnoozes.key, until: reminderSnoozes.until })
      .from(reminderSnoozes)
      .where(and(eq(reminderSnoozes.userId, user.sub), gt(reminderSnoozes.until, today)));
    const until = new Map(snoozes.map((s) => [s.key, s.until]));
    const visible = all.filter((i) => !until.has(i.key));
    const snoozed = all.filter((i) => until.has(i.key)).map((i) => ({ ...i, snoozedUntil: until.get(i.key) }));
    return {
      items: visible,
      snoozed: includeSnoozed ? snoozed : undefined,
      snoozedCount: snoozed.length,
      counts: { error: visible.filter((i) => i.level === 'error').length, warning: visible.filter((i) => i.level === 'warning').length, info: visible.filter((i) => i.level === 'info').length },
    };
  }

  async snooze(user: AuthUser, key: string, days: number) {
    if (!audienceOf(key).length) throw new BadRequestException('Pengingat tidak dikenal');
    const until = addDays(todayJakarta(), days);
    await this.db
      .insert(reminderSnoozes)
      .values({ tenantId: user.tenantId, userId: user.sub, key, until })
      .onConflictDoUpdate({ target: [reminderSnoozes.userId, reminderSnoozes.key], set: { until } });
    return { key, until };
  }

  async unsnooze(user: AuthUser, key: string) {
    await this.db.delete(reminderSnoozes).where(and(eq(reminderSnoozes.userId, user.sub), eq(reminderSnoozes.key, key)));
    return { key };
  }

  /** Pengingat yang masuk ringkasan email seorang pengguna (tanpa memperhatikan tunda) */
  async forRole(tenantId: string, role: string, cfg?: ReminderSettings) {
    return (await this.compute(tenantId, cfg)).filter((i) => audienceOf(i.key).includes(role));
  }
}

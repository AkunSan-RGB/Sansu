import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppsService } from '../../common/apps/apps.service';
import { AuthUser } from '../../common/auth/auth-user';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { WorkflowService } from '../workflow/workflow.service';

export interface TaskItem {
  key: string;
  title: string;
  detail: string;
  /** Alamat halaman tempat tindakan dilakukan; juga dipakai menampilkan lencana di menu */
  link: string;
  count: number;
  oldestDays: number;
}

const DECIDERS = ['OWNER', 'ADMIN', 'FINANCE'];

@Injectable()
export class TaskInboxService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly apps: AppsService,
    private readonly workflow: WorkflowService,
  ) {}

  private async one(q: ReturnType<typeof sql>) {
    const r = await this.db.execute<{ n: number; oldest: number }>(q);
    return { n: Number(r.rows[0]?.n ?? 0), oldest: Number(r.rows[0]?.oldest ?? 0) };
  }

  async mine(u: AuthUser): Promise<TaskItem[]> {
    const on = await this.apps.enabled(u.tenantId);
    const out: TaskItem[] = [];
    const add = (key: string, link: string, title: (n: number) => string, detail: string, r: { n: number; oldest: number }) => {
      if (r.n > 0) out.push({ key, link, title: title(r.n), detail: r.oldest >= 1 ? `${detail} · terlama ${r.oldest} hari` : detail, count: r.n, oldestDays: r.oldest });
    };
    const isOwner = u.role === 'OWNER';
    const is = (roles: string[]) => isOwner || roles.includes(u.role);

    if (is(['ADMIN'])) {
      add('approvals', '/approvals', (n) => `${n} permintaan persetujuan menunggu keputusan Anda`, 'Ditujukan ke Anda atau ke semua penyetuju', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - requested_at::date), 0)::int AS oldest FROM approval_requests
        WHERE tenant_id = ${u.tenantId} AND status = 'PENDING' AND requested_by_id <> ${u.sub} ${isOwner ? sql`` : sql`AND (assigned_to_id IS NULL OR assigned_to_id = ${u.sub})`}`));
      if (on.has('purchase')) {
        add('purchase-requests', '/purchase-requests?status=SUBMITTED', (n) => `${n} permintaan pembelian menunggu persetujuan Anda`, 'Diajukan gudang / divisi', await this.one(sql`
          SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - COALESCE(submitted_at, created_at)::date), 0)::int AS oldest FROM purchase_requests
          WHERE tenant_id = ${u.tenantId} AND status = 'SUBMITTED' AND requested_by_id IS DISTINCT FROM ${u.sub}`));
      }
    }
    if (is(['WAREHOUSE', 'ADMIN']) && on.has('inventory')) {
      add('count-stale', '/inventory/counts', (n) => `${n} gudang belum diopname lebih dari 35 hari`, 'Jadwalkan hitung fisik (stock opname)', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - COALESCE(l.last, CURRENT_DATE - 35)), 0)::int AS oldest FROM (
          SELECT w.id, MAX(c.posted_at)::date AS last FROM warehouses w LEFT JOIN stock_counts c ON c.warehouse_id = w.id AND c.status = 'POSTED'
          WHERE w.tenant_id = ${u.tenantId} AND w.kind = 'MAIN' AND EXISTS (SELECT 1 FROM stock_balances b WHERE b.warehouse_id = w.id AND b.qty > 0)
            AND EXISTS (SELECT 1 FROM stock_moves m WHERE m.warehouse_id = w.id AND m.date <= CURRENT_DATE - 35)
          GROUP BY w.id HAVING MAX(c.posted_at) IS NULL OR MAX(c.posted_at)::date < CURRENT_DATE - 35) l`));
      add('transfer-stuck', '/inventory/transfers', (n) => `${n} transfer gudang belum diterima lebih dari 3 hari`, 'Konfirmasi ke gudang tujuan atau batalkan', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - date), 0)::int AS oldest FROM stock_transfers
        WHERE tenant_id = ${u.tenantId} AND status = 'IN_TRANSIT' AND date <= CURRENT_DATE - 3`));
    }
    if (is(['WAREHOUSE', 'ADMIN']) && on.has('sales')) {
      add('so-awaiting-delivery', '/sales-orders?status=CONFIRMED', (n) => `${n} pesanan penjualan menunggu dikirim`, 'Siapkan, hitung, lalu catat surat jalan', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - o.date), 0)::int AS oldest FROM sales_orders o
        WHERE o.tenant_id = ${u.tenantId} AND o.status = 'CONFIRMED'`));
    }
    if (is(['FINANCE', 'ADMIN']) && on.has('sales')) {
      add('dn-awaiting-invoice', '/deliveries', (n) => `${n} surat jalan menunggu ditagih`, 'Barang sudah keluar; catat faktur penjualan', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - d.date), 0)::int AS oldest FROM delivery_orders d
        WHERE d.tenant_id = ${u.tenantId} AND d.status = 'DELIVERED' AND d.invoice_id IS NULL`));
    }
    if (is(['WAREHOUSE', 'PURCHASING', 'ADMIN']) && on.has('purchase')) {
      add('po-awaiting-goods', '/purchase-orders?status=CONFIRMED', (n) => `${n} PO menunggu barang diterima`, u.role === 'PURCHASING' ? 'Pantau pengiriman pemasok' : 'Hitung barang yang tiba lalu catat penerimaan', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - o.date), 0)::int AS oldest FROM purchase_orders o
        WHERE o.tenant_id = ${u.tenantId} AND o.status = 'CONFIRMED'
          AND EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.order_id = o.id AND l.received_qty < l.qty)`));
    }
    if (is(DECIDERS) && on.has('payroll')) {
      add('work-entries', '/payroll/jasa', (n) => `${n} catatan upah kerja menunggu persetujuan Anda`, 'Dicatat HR; pembuat tidak boleh menyetujui sendiri', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - w.created_at::date), 0)::int AS oldest FROM service_work_entries w JOIN employees e ON e.id = w.employee_id
        WHERE w.tenant_id = ${u.tenantId} AND w.status = 'PENDING' AND w.created_by_id <> ${u.sub} AND e.user_id IS DISTINCT FROM ${u.sub}`));
      add('employee-changes', '/employees/controls', (n) => `${n} perubahan data karyawan menunggu persetujuan Anda`, 'Perubahan gaji / status / rekening', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - created_at::date), 0)::int AS oldest FROM employee_change_requests
        WHERE tenant_id = ${u.tenantId} AND status = 'PENDING' AND requested_by_id <> ${u.sub}`));
    }
    if (is(DECIDERS) && on.has('purchase')) {
      add('price-agreements', '/price-agreements', (n) => `${n} kontrak harga pemasok menunggu persetujuan Anda`, 'Diajukan bagian pembelian', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - created_at::date), 0)::int AS oldest FROM supplier_price_agreements
        WHERE tenant_id = ${u.tenantId} AND status = 'PENDING' AND created_by_id <> ${u.sub}`));
    }
    if (is(['HR']) && on.has('hr')) {
      add('leaves', '/leaves', (n) => `${n} pengajuan cuti menunggu keputusan Anda`, 'Cuti sendiri tidak ikut dihitung', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - l.created_at::date), 0)::int AS oldest FROM leave_requests l JOIN employees e ON e.id = l.employee_id
        WHERE l.tenant_id = ${u.tenantId} AND l.status = 'PENDING' AND e.user_id IS DISTINCT FROM ${u.sub}`));
    }
    if (is(['ACCOUNTANT', 'ADMIN']) && on.has('payroll')) {
      add('payroll-post', '/payroll', (n) => `${n} penggajian menunggu diperiksa dan diposting`, 'Disiapkan HR; diposting Akuntan', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - created_at::date), 0)::int AS oldest FROM payroll_runs WHERE tenant_id = ${u.tenantId} AND status = 'DRAFT'`));
    }
    if (on.has('utility')) {
      if (is(['ADMIN', 'FINANCE'])) {
        add('utility-verify', '/utility/meter', (n) => `${n} pencatatan meter menunggu verifikasi Anda`, 'Dicatat petugas lapangan; angka janggal wajib catatan pemeriksa', await this.one(sql`
          SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - entered_at::date), 0)::int AS oldest FROM utility_readings
          WHERE tenant_id = ${u.tenantId} AND status = 'ENTERED' AND entered_by_id <> ${u.sub}`));
        add('utility-bill', '/utility/tagihan', (n) => `${n} pencatatan meter terverifikasi siap ditagih`, 'Jalankan penagihan bulanan agar faktur terbit', await this.one(sql`
          SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - verified_at::date), 0)::int AS oldest FROM utility_readings WHERE tenant_id = ${u.tenantId} AND status = 'VERIFIED'`));
        add('utility-suspend', '/utility/tunggakan', (n) => `${n} sambungan menunggak melewati batas pemutusan`, 'Tinjau dan putus sementara sesuai aturan', await this.one(sql`
          SELECT COUNT(DISTINCT c.id)::int AS n, COALESCE(MAX(CURRENT_DATE - i.due_date), 0)::int AS oldest
          FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id JOIN utility_connections c ON c.id = b.connection_id
          WHERE b.tenant_id = ${u.tenantId} AND c.status = 'ACTIVE' AND i.status <> 'PAID' AND CURRENT_DATE - i.due_date > 30`));
      }
      if (is(['WAREHOUSE'])) {
        add('utility-read', '/utility/meter', (n) => `${n} sambungan belum dicatat meternya bulan ini`, 'Catat angka meter lalu kirim untuk diverifikasi', await this.one(sql`
          SELECT COUNT(*)::int AS n, 0 AS oldest FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id
          WHERE c.tenant_id = ${u.tenantId} AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= to_char(CURRENT_DATE, 'YYYY-MM')
            AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.period = to_char(CURRENT_DATE, 'YYYY-MM') AND r.status <> 'REJECTED')`));
      }
    }
    if (on.has('cash')) {
      if (isOwner) {
        add('cash-count-approval', '/cash/counts', (n) => `${n} opname kas dengan selisih besar menunggu persetujuan Anda`, 'Hanya Pemilik yang menyetujui; diajukan Keuangan/Admin', await this.one(sql`
          SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - date), 0)::int AS oldest FROM cash_counts WHERE tenant_id = ${u.tenantId} AND status = 'WAITING_APPROVAL'`));
      }
      if (is(['ADMIN', 'FINANCE'])) {
        add('bank-unmatched', '/bank', (n) => `${n} mutasi bank belum dicocokkan`, 'Cocokkan dengan catatan kas atau catat sebagai transaksi baru', await this.one(sql`
          SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - date), 0)::int AS oldest FROM bank_statement_lines WHERE tenant_id = ${u.tenantId} AND status = 'UNMATCHED'`));
        add('petty-replenish', '/petty-cash', (n) => `${n} bukti kas kecil belum diganti (pengisian kembali)`, 'Bukti sudah lebih dari 7 hari; ajukan pengisian kembali agar kas kecil tidak kosong', await this.one(sql`
          SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - date), 0)::int AS oldest FROM petty_cash_vouchers WHERE tenant_id = ${u.tenantId} AND status = 'OPEN' AND date < CURRENT_DATE - 7`));
      }
    }
    const wf = await this.workflow.tasksFor(u);
    if (wf.count > 0) out.push({ key: 'workflow', link: '/workflow', title: `${wf.count} kasus alur kerja menunggu tindakan Anda`, detail: wf.oldestDays >= 1 ? `Sesuai peran Anda · terlama ${wf.oldestDays} hari di tahap ini` : 'Sesuai peran Anda', count: wf.count, oldestDays: wf.oldestDays });
    return out.sort((a, b) => b.oldestDays - a.oldestDays);
  }
}

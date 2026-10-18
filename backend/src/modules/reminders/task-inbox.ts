/**
 * Kotak tugas: proses yang MENUNGGU TINDAKAN pengguna ini. Disusun menurut pemisahan fungsi — pengguna hanya melihat yang memang
 * boleh dia putuskan, tidak termasuk yang dia buat sendiri (pembuat ≠ pemutus) dan yang ditujukan ke penyetuju lain.
 */
import { Controller, Get, Injectable } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { AppsService } from '../../common/apps/apps.service';
import { SettingsService } from '../../common/settings.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { WorkflowService } from '../workflow/workflow.module';

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
    private readonly settings: SettingsService,
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
    if (is(['ADMIN', 'HR']) && on.has('hr')) {
      add('leaves', '/leaves', (n) => `${n} pengajuan cuti menunggu keputusan Anda`, 'Cuti sendiri tidak ikut dihitung', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - l.created_at::date), 0)::int AS oldest FROM leave_requests l JOIN employees e ON e.id = l.employee_id
        WHERE l.tenant_id = ${u.tenantId} AND l.status = 'PENDING' AND e.user_id IS DISTINCT FROM ${u.sub}`));
    }
    if (is(['ACCOUNTANT', 'ADMIN']) && on.has('payroll')) {
      add('payroll-post', '/payroll', (n) => `${n} penggajian menunggu diperiksa dan diposting`, 'Disiapkan HR; diposting Akuntan', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - created_at::date), 0)::int AS oldest FROM payroll_runs WHERE tenant_id = ${u.tenantId} AND status = 'DRAFT'`));
    }
    // ---- serah terima dokumen antar bagian: antrean kerja tiap bagian (dihitung dari status dokumen, selalu mutakhir) ----
    const model = await this.settings.businessModel(this.db, u.tenantId);
    const goods = model !== 'JASA';
    if (is(['WAREHOUSE', 'ADMIN']) && on.has('sales') && !['JASA', 'RITEL', 'FNB'].includes(model)) {
      add('handoff-ship', '/sales-orders', (n) => `${n} pesanan menunggu dikirim`, 'Dikonfirmasi Sales; siapkan barang dan buat surat jalan', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - date), 0)::int AS oldest FROM sales_orders WHERE tenant_id = ${u.tenantId} AND status = 'CONFIRMED'`));
    }
    if (is(['FINANCE', 'ADMIN']) && on.has('sales') && !['JASA', 'RITEL', 'FNB'].includes(model)) {
      add('handoff-invoice', '/deliveries', (n) => `${n} surat jalan belum difakturkan`, 'Barang sudah terkirim; terbitkan faktur', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - date), 0)::int AS oldest FROM delivery_orders WHERE tenant_id = ${u.tenantId} AND status = 'DELIVERED' AND invoice_id IS NULL`));
    }
    if (goods && is(['WAREHOUSE', 'ADMIN']) && on.has('purchase')) {
      add('handoff-receive', '/purchase-orders', (n) => `${n} PO menunggu penerimaan barang`, 'Sudah dikonfirmasi ke pemasok', await this.one(sql`
        SELECT COUNT(DISTINCT o.id)::int AS n, COALESCE(MAX(CURRENT_DATE - o.date), 0)::int AS oldest FROM purchase_orders o JOIN purchase_order_lines l ON l.order_id = o.id
        WHERE o.tenant_id = ${u.tenantId} AND o.status = 'CONFIRMED' AND l.received_qty < l.qty`));
    }
    if (goods && is(['FINANCE', 'ADMIN']) && on.has('purchase')) {
      add('handoff-bill', '/purchase-invoices', (n) => `${n} PO sudah diterima tetapi belum ditagih`, 'Catat tagihan pemasok dan cocokkan (3-way match)', await this.one(sql`
        SELECT COUNT(DISTINCT o.id)::int AS n, COALESCE(MAX(CURRENT_DATE - o.date), 0)::int AS oldest FROM purchase_orders o JOIN purchase_order_lines l ON l.order_id = o.id
        WHERE o.tenant_id = ${u.tenantId} AND o.status = 'CONFIRMED' AND l.received_qty > l.billed_qty`));
    }
    if (is(['PURCHASING', 'ADMIN']) && on.has('purchase')) {
      add('handoff-pr', '/purchase-requests?status=APPROVED', (n) => `${n} permintaan beli disetujui, belum jadi PO`, 'Buka permintaan lalu buat PO', await this.one(sql`
        SELECT COUNT(DISTINCT r.id)::int AS n, COALESCE(MAX(CURRENT_DATE - COALESCE(r.decided_at, r.created_at)::date), 0)::int AS oldest FROM purchase_requests r JOIN purchase_request_lines l ON l.request_id = r.id
        WHERE r.tenant_id = ${u.tenantId} AND r.status = 'APPROVED' AND l.purchase_order_id IS NULL`));
    }
    if (is(['FINANCE', 'ADMIN']) && on.has('pos')) {
      add('handoff-cash', '/pos/sessions', (n) => `${n} sesi kasir berselisih kas perlu diperiksa`, '7 hari terakhir; hitung ulang dan telusuri selisihnya', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - closed_at::date), 0)::int AS oldest FROM pos_sessions
        WHERE tenant_id = ${u.tenantId} AND status = 'CLOSED' AND COALESCE(difference, 0) <> 0 AND closed_at >= now() - interval '7 days' AND user_id <> ${u.sub}`));
    }
    if (is(['FINANCE', 'ADMIN']) && on.has('payroll')) {
      add('handoff-payroll-pay', '/payroll', (n) => `${n} penggajian sudah diposting, belum dibayar`, 'Lakukan pembayaran gaji dari kas/bank', await this.one(sql`
        SELECT COUNT(*)::int AS n, COALESCE(MAX(CURRENT_DATE - pay_date), 0)::int AS oldest FROM payroll_runs WHERE tenant_id = ${u.tenantId} AND status = 'POSTED'`));
    }
    const wf = await this.workflow.tasksFor(u);
    if (wf.count > 0) out.push({ key: 'workflow', link: '/workflow', title: `${wf.count} kasus alur kerja menunggu tindakan Anda`, detail: wf.oldestDays >= 1 ? `Sesuai peran Anda · terlama ${wf.oldestDays} hari di tahap ini` : 'Sesuai peran Anda', count: wf.count, oldestDays: wf.oldestDays });
    return out.sort((a, b) => b.oldestDays - a.oldestDays);
  }
}

@ApiTags('Kotak tugas')
@ApiBearerAuth()
@Controller('tasks')
export class TaskInboxController {
  constructor(private readonly svc: TaskInboxService) {}

  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.mine(u);
  }
}

import { Controller, Get, Injectable } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CONTROL_PROFILES } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { SettingsService } from '../../common/settings.service';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';

export interface SalesControlFinding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

/**
 * Temuan kontrol penjualan (anti-fraud) untuk 60 hari terakhir: surat jalan belum difakturkan, pesanan dibatalkan setelah dikonfirmasi,
 * surat jalan dibatalkan, dan diskon besar. Terpisah dari kontrol pembelian agar bisa dibuka tanpa aplikasi Pembelian.
 */
@Injectable()
export class SalesControlsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
  ) {}

  async controls(tenantId: string) {
    const today = todayJakarta();
    const since = addDays(today, -60);
    const out: SalesControlFinding[] = [];
    const add = (key: string, level: SalesControlFinding['level'], title: string, refs: string[], detail: string) => {
      if (refs.length) out.push({ key, level, title: `${title} (${refs.length})`, detail, refs });
    };
    const cp = CONTROL_PROFILES[await this.settings.businessModel(this.db, tenantId)];

    // 5. Surat jalan belum difakturkan (ambang menurut jenis usaha; tidak relevan untuk jasa)
    if (cp.deliveryNotBilledDays !== null) {
    const dn = await this.db.execute<{ number: string }>(sql`
      SELECT d.number FROM delivery_orders d
      WHERE d.tenant_id = ${tenantId} AND d.status = 'DELIVERED' AND d.invoice_id IS NULL AND d.date <= ${addDays(today, -cp.deliveryNotBilledDays)}
      ORDER BY d.date`);
    add('DELIVERY_NOT_BILLED', 'warning', `Surat jalan belum difakturkan > ${cp.deliveryNotBilledDays} hari`, dn.rows.map((r) => r.number), 'Barang sudah keluar tetapi belum ditagih. Tagih sekarang atau pastikan tidak ada barang keluar tanpa tagihan.');

    }

    // 12. Penjualan: pesanan dibatalkan setelah dikonfirmasi
    const sc = await this.db.execute<{ number: string; reason: string | null }>(sql`
      SELECT o.number, o.cancel_reason AS reason FROM sales_orders o
      WHERE o.tenant_id = ${tenantId} AND o.status = 'CANCELLED' AND o.cancelled_by_id IS NOT NULL AND o.date >= ${since}
        AND EXISTS (SELECT 1 FROM audit_logs l WHERE l.entity = 'SalesOrder' AND l.entity_id = o.id::text AND l.action = 'CONFIRM')`);
    add('SO_CANCELLED_AFTER_CONFIRM', 'info', 'Pesanan penjualan dibatalkan setelah dikonfirmasi', sc.rows.map((r) => `${r.number}${r.reason ? ` — ${r.reason}` : ''}`), 'Pastikan pembatalan wajar dan bukan menghilangkan jejak penjualan.');

    // 13. Penjualan: surat jalan dibatalkan (barang sudah keluar fisik)
    const dc = await this.db.execute<{ number: string; reason: string | null }>(sql`
      SELECT number, cancel_reason AS reason FROM delivery_orders WHERE tenant_id = ${tenantId} AND status = 'CANCELLED' AND date >= ${since}`);
    add('DN_CANCELLED', 'warning', 'Surat jalan dibatalkan', dc.rows.map((r) => `${r.number}${r.reason ? ` — ${r.reason}` : ''}`), 'Barang sudah sempat keluar gudang. Pastikan barang benar-benar kembali ke stok.');

    // 14. Penjualan: diskon besar (>= 20% per baris) pada pesanan yang dikonfirmasi
    const dh = await this.db.execute<{ number: string; pct: string }>(sql`
      SELECT DISTINCT o.number, MAX(l.discount_pct)::text AS pct FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
      WHERE o.tenant_id = ${tenantId} AND o.date >= ${since} AND o.status <> 'CANCELLED' AND l.discount_pct >= 20 GROUP BY o.number ORDER BY o.number DESC`);
    add('DISCOUNT_HEAVY', 'info', 'Diskon besar (≥ 20%) pada pesanan penjualan', dh.rows.map((r) => `${r.number} (${Number(r.pct)}%)`), 'Diskon besar yang berulang pada pelanggan atau sales yang sama patut ditanyakan.');

    // 15. Pesanan bernilai di atas batas persetujuan yang dikonfirmasi tanpa persetujuan terpisah (pemilik/admin): ditinjau Pemilik
    const pol = await this.approvals.policy(this.db, tenantId);
    if (pol.salesOrder > 0) {
      const na = await this.db.execute<{ number: string; name: string }>(sql`
        SELECT o.number, c.name FROM sales_orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.tenant_id = ${tenantId} AND o.date >= ${since} AND o.status IN ('CONFIRMED', 'DELIVERED', 'INVOICED') AND o.total >= ${pol.salesOrder}
          AND NOT EXISTS (SELECT 1 FROM approval_requests a WHERE a.tenant_id = ${tenantId} AND a.kind = 'SALES_ORDER' AND a.ref_id = o.id::text AND a.status = 'APPROVED')
        ORDER BY o.date DESC`);
      add('SO_NO_APPROVAL', 'info', 'Pesanan besar dikonfirmasi tanpa persetujuan terpisah', na.rows.map((r) => `${r.number} (${r.name})`), 'Dikonfirmasi pemilik/admin. Tinjau berkala apakah pantas.');
    }

    // 16. Pembayaran pelanggan dicatat jauh setelah tanggal terima (tanda uang ditahan lalu dicatat belakangan / menutup piutang lain)
    const lp = await this.db.execute<{ number: string | null; name: string; days: number }>(sql`
      SELECT p.number, c.name, (p.created_at::date - p.date)::int AS days
      FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id
      WHERE p.tenant_id = ${tenantId} AND p.date >= ${since} AND (p.created_at::date - p.date) >= 3
      ORDER BY days DESC`);
    add('PAYMENT_LATE_RECORDED', 'warning', 'Pembayaran pelanggan dicatat ≥ 3 hari setelah tanggal terima', lp.rows.map((r) => `${r.number ?? 'bayar'} ${r.name} (${r.days} hari)`), 'Uang yang diterima lalu baru dicatat belakangan adalah tanda uang tertahan atau dipakai menutup piutang pelanggan lain. Cocokkan dengan mutasi bank.');

    // 17. Retur setelah komisi periodenya ditutup (komisi sudah dibayar atas penjualan yang kemudian diretur)
    const cb = await this.db.execute<{ who: string; period: string; v: string }>(sql`
      SELECT u.name AS who, sc.period, SUM(r.subtotal)::text AS v
      FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id JOIN sales_orders o ON o.id = i.sales_order_id
      JOIN sales_commissions sc ON sc.tenant_id = r.tenant_id AND sc.user_id = o.salesperson_id AND sc.period = to_char(i.date, 'YYYY-MM') AND sc.status IN ('ACCRUED', 'PAID')
      JOIN users u ON u.id = o.salesperson_id
      WHERE r.tenant_id = ${tenantId} AND r.date >= ${since} AND to_char(r.date, 'YYYY-MM') > sc.period
      GROUP BY u.name, sc.period`);
    add('COMMISSION_CLAWBACK', 'warning', 'Retur atas penjualan yang komisinya sudah ditutup', cb.rows.map((r) => `${r.who} periode ${r.period}: retur Rp${Math.round(Number(r.v)).toLocaleString('id-ID')}`), 'Komisi periode itu dihitung sebelum retur terjadi. Pertimbangkan koreksi komisi (potong di periode berikutnya).');

    // 18. Syarat pelanggan dilonggarkan / diubah
    const ct = await this.db.execute<{ code: string; name: string }>(sql`
      SELECT DISTINCT c.code, c.name FROM audit_logs l JOIN customers c ON c.id::text = l.entity_id
      WHERE l.tenant_id = ${tenantId} AND l.entity = 'Customer' AND l.action = 'UPDATE_TERMS' AND l.created_at >= ${since}::date`);
    add('CUSTOMER_TERMS_CHANGED', 'info', 'Limit kredit / termin pelanggan diubah', ct.rows.map((r) => `${r.code} ${r.name}`), 'Melonggarkan syarat adalah cara umum menutupi tagihan macet. Pastikan ada dasar komersialnya.');

    // 19. Pembayaran transfer/non-tunai yang tidak ada di mutasi bank padahal mutasi periodenya sudah diimpor (kemungkinan pembayaran fiktif)
    const bu = await this.db.execute<{ number: string; name: string }>(sql`
      SELECT p.number, c.name
      FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id
      JOIN journal_lines jl ON jl.journal_id = p.journal_id AND jl.account_id = p.cash_account_id AND jl.debit > 0
      WHERE p.tenant_id = ${tenantId} AND p.method <> 'CASH' AND p.date >= ${since} AND p.date <= ${addDays(today, -3)}
        AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.tenant_id = ${tenantId} AND s.cash_account_id = p.cash_account_id AND p.date BETWEEN s.period_from AND s.period_to)
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.journal_line_id = jl.id)
        AND NOT EXISTS (SELECT 1 FROM bank_line_extra_matches x WHERE x.journal_line_id = jl.id)
      ORDER BY p.date DESC`);
    add('PAYMENT_NOT_IN_BANK', 'warning', 'Pembayaran transfer pelanggan tidak ada di mutasi bank', bu.rows.map((r) => `${r.number} ${r.name}`), 'Mutasi bank periode itu sudah diimpor, tetapi tidak ada baris yang cocok dengan pembayaran ini. Bisa pembayaran fiktif atau salah rekening; cocokkan di Kas & Bank › Cocokkan dengan bank.');

    // 20. Pemisahan fungsi: pembayaran / retur atas faktur oleh orang yang sama dengan pembuat fakturnya
    // Hanya relevan bila ada lebih dari satu Keuangan aktif (satu orang pasti memegang kedua langkah, sehingga temuannya hanya kebisingan)
    const [{ n: financeCount }] = (await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = ${tenantId} AND role = 'FINANCE' AND is_active`)).rows;
    if (financeCount >= 2) {
    const sp = await this.db.execute<{ who: string; n: number }>(sql`
      SELECT u.name AS who, COUNT(DISTINCT p.invoice_id)::int AS n
      FROM payments p
      JOIN audit_logs ap ON ap.tenant_id = p.tenant_id AND ap.entity = 'Payment' AND ap.entity_id = p.id::text AND ap.action = 'CREATE'
      JOIN audit_logs ai ON ai.tenant_id = p.tenant_id AND ai.entity = 'Invoice' AND ai.entity_id = p.invoice_id::text AND ai.action = 'CREATE' AND ai.user_id = ap.user_id
      JOIN users u ON u.id = ap.user_id
      WHERE p.tenant_id = ${tenantId} AND p.date >= ${since} GROUP BY u.name ORDER BY n DESC`);
    add('PAYMENT_BY_INVOICE_CREATOR', 'info', 'Pembayaran dicatat oleh pembuat fakturnya sendiri', sp.rows.map((r) => `${r.who}: ${r.n} faktur`), 'Satu orang membuat tagihan sekaligus mencatat uang masuknya, padahal ada lebih dari satu Keuangan. Bagi tugasnya dan aktifkan "Pemisahan fungsi penjualan" di Pengaturan › Perusahaan › Kebijakan.');
    const sr = await this.db.execute<{ who: string; n: number }>(sql`
      SELECT u.name AS who, COUNT(DISTINCT r.invoice_id)::int AS n
      FROM sales_returns r
      JOIN audit_logs ar ON ar.tenant_id = r.tenant_id AND ar.entity = 'SalesReturn' AND ar.entity_id = r.id::text AND ar.action = 'CREATE'
      JOIN audit_logs ai ON ai.tenant_id = r.tenant_id AND ai.entity = 'Invoice' AND ai.entity_id = r.invoice_id::text AND ai.action = 'CREATE' AND ai.user_id = ar.user_id
      JOIN users u ON u.id = ar.user_id
      WHERE r.tenant_id = ${tenantId} AND r.date >= ${since} GROUP BY u.name ORDER BY n DESC`);
    add('RETURN_BY_INVOICE_CREATOR', 'info', 'Retur dicatat oleh pembuat fakturnya sendiri', sr.rows.map((r) => `${r.who}: ${r.n} faktur`), 'Orang yang membuat faktur juga membuat kredit nota (retur) atasnya, padahal ada lebih dari satu Keuangan. Aktifkan "Pemisahan fungsi penjualan" di Pengaturan › Perusahaan › Kebijakan.');
    }

    const rank = { error: 0, warning: 1, info: 2 } as const;
    out.sort((a, b) => rank[a.level] - rank[b.level]);
    return { asOf: today, since, items: out, policy: { salesOrder: pol.salesOrder, salesDiscountMaxPct: pol.salesDiscountMaxPct, salesReturn: pol.salesReturn, salesBelowCost: pol.salesBelowCost, salesSeparateDuties: pol.salesSeparateDuties, blindDelivery: pol.blindDelivery } };
  }
}

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('sales-controls')
export class SalesControlsController {
  constructor(private readonly svc: SalesControlsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
}

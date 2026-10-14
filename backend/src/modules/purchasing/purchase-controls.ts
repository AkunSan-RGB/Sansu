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

export interface ControlFinding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

const list = (rows: string[]) => rows.slice(0, 6).join(', ') + (rows.length > 6 ? `, dan ${rows.length - 6} lainnya` : '');

/**
 * Temuan kontrol pembelian & stok (anti-fraud) untuk 60 hari terakhir: PO dipecah di bawah batas persetujuan,
 * pembayaran akhir pekan, supplier baru langsung dibayar, penyesuaian stok keluar berulang, surat jalan belum ditagih,
 * barang diterima lama belum ditagih, pembayaran yang dibatalkan, dan harga faktur yang disetujui di atas toleransi.
 */
@Injectable()
export class PurchaseControlsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly approvals: ApprovalsService,
    private readonly settings: SettingsService,
  ) {}

  async controls(tenantId: string) {
    const today = todayJakarta();
    const since = addDays(today, -60);
    const out: ControlFinding[] = [];
    const add = (key: string, level: ControlFinding['level'], title: string, refs: string[], detail: string) => {
      if (refs.length) out.push({ key, level, title: `${title} (${refs.length})`, detail, refs });
    };
    const pol = await this.approvals.policy(this.db, tenantId);
    const cp = CONTROL_PROFILES[await this.settings.businessModel(this.db, tenantId)];

    // 1. PO dipecah: ≥2 PO ke supplier yang sama dalam 7 hari, masing-masing di bawah batas tetapi jumlahnya melewati batas
    if (pol.purchaseOrder > 0) {
      const pos = await this.db.execute<{ number: string; supplier: string; sid: string; date: string; total: string }>(sql`
        SELECT o.number, s.name AS supplier, s.id AS sid, o.date::text AS date, o.total
        FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.tenant_id = ${tenantId} AND o.status <> 'CANCELLED' AND o.date >= ${since}
        ORDER BY o.supplier_id, o.date`);
      const bySup = new Map<string, typeof pos.rows>();
      for (const r of pos.rows) bySup.set(r.sid, [...(bySup.get(r.sid) ?? []), r]);
      const flagged = new Set<string>();
      for (const rows of bySup.values()) {
        const small = rows.filter((r) => Number(r.total) < pol.purchaseOrder);
        for (let i = 0; i < small.length; i++) {
          const win = small.filter((r) => Date.parse(r.date) >= Date.parse(small[i].date) && Date.parse(r.date) - Date.parse(small[i].date) <= 7 * 86_400_000);
          if (win.length >= 2 && win.reduce((a, r) => a + Number(r.total), 0) >= pol.purchaseOrder) win.forEach((r) => flagged.add(`${r.number} (${r.supplier})`));
        }
      }
      add('PO_SPLIT', 'warning', 'PO dipecah di bawah batas persetujuan', [...flagged], `Beberapa PO ke pemasok yang sama dalam 7 hari, tiap PO di bawah batas Rp${pol.purchaseOrder.toLocaleString('id-ID')} tetapi jumlahnya melewati batas. Pastikan bukan cara menghindari persetujuan.`);
    }

    // 2. Pembayaran supplier di akhir pekan
    const wk = await this.db.execute<{ number: string; name: string }>(sql`
      SELECT p.number, s.name FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.tenant_id = ${tenantId} AND p.status = 'POSTED' AND p.date >= ${since} AND EXTRACT(DOW FROM p.date) IN (0, 6)
      ORDER BY p.date DESC`);
    add('WEEKEND_PAY', 'info', 'Pembayaran supplier di akhir pekan', wk.rows.map((r) => `${r.number} (${r.name})`), 'Transaksi di luar jam kerja lebih rentan disalahgunakan; pastikan ada alasannya.');

    // 3. Supplier baru (dibuat ≤14 hari sebelum pembayaran pertamanya) langsung dibayar
    const fresh = await this.db.execute<{ code: string; name: string }>(sql`
      SELECT s.code, s.name FROM suppliers s
      JOIN LATERAL (SELECT MIN(p.date) AS d FROM supplier_payments p WHERE p.supplier_id = s.id AND p.status = 'POSTED') f ON f.d IS NOT NULL
      WHERE s.tenant_id = ${tenantId} AND f.d >= ${since} AND f.d::date - s.created_at::date <= 14`);
    add('NEW_SUPPLIER_PAID', 'warning', 'Supplier baru langsung dibayar', fresh.rows.map((r) => `${r.code} ${r.name}`), 'Pemasok fiktif biasanya dibuat lalu cepat dibayar. Pastikan pemasok & barangnya nyata (NPWP, kontak, bukti terima).');

    // 4. Penyesuaian stok keluar (di luar stock opname) berulang di satu gudang dalam 30 hari (tidak relevan untuk jasa)
    if (cp.adjOutRepeat !== null) {
    const adj = await this.db.execute<{ wh: string; n: number }>(sql`
      SELECT w.name AS wh, COUNT(DISTINCT m.ref_id)::int AS n
      FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
      WHERE m.tenant_id = ${tenantId} AND m.type = 'ADJUSTMENT_OUT' AND m.ref_type = 'STOCK_ADJUSTMENT' AND m.date >= ${addDays(today, -30)}
        AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.tenant_id = ${tenantId} AND c.adjustment_number = m.ref_number)
      GROUP BY w.name HAVING COUNT(DISTINCT m.ref_id) >= ${cp.adjOutRepeat}`);
    add('ADJ_OUT_REPEAT', 'warning', 'Penyesuaian stok keluar berulang', adj.rows.map((r) => `${r.wh}: ${r.n} kali`), 'Stok dikurangi lewat penyesuaian (bukan opname) berulang kali dalam 30 hari — salah satu modus pencurian barang. Tinjau alasan & pelakunya.');
    }

    // 5. Surat jalan belum difakturkan (ambang menurut jenis usaha; tidak relevan untuk jasa)
    if (cp.deliveryNotBilledDays !== null) {
    const dn = await this.db.execute<{ number: string }>(sql`
      SELECT d.number FROM delivery_orders d
      WHERE d.tenant_id = ${tenantId} AND d.status = 'DELIVERED' AND d.invoice_id IS NULL AND d.date <= ${addDays(today, -cp.deliveryNotBilledDays)}
      ORDER BY d.date`);
    add('DELIVERY_NOT_BILLED', 'warning', `Surat jalan belum difakturkan > ${cp.deliveryNotBilledDays} hari`, dn.rows.map((r) => r.number), 'Barang sudah keluar tetapi belum ditagih. Tagih sekarang atau pastikan tidak ada barang keluar tanpa tagihan.');

    }

    // 6. Barang diterima belum ditagih pemasok (ambang menurut jenis usaha; tidak relevan untuk jasa)
    if (cp.grniDays !== null) {
    const gr = await this.db.execute<{ number: string; name: string }>(sql`
      SELECT g.number, s.name FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id
      WHERE g.tenant_id = ${tenantId} AND g.status = 'RECEIVED' AND g.date <= ${addDays(today, -cp.grniDays)}
        AND EXISTS (SELECT 1 FROM goods_receipt_lines l WHERE l.receipt_id = g.id AND l.billed_qty < l.qty)
      ORDER BY g.date`);
    add('GRNI_OLD', 'info', `Barang diterima > ${cp.grniDays} hari belum ditagih`, gr.rows.map((r) => `${r.number} (${r.name})`), 'Hutang belum tercatat. Minta faktur pemasok atau periksa apakah penerimaan benar.');
    }

    // 7. Pembayaran supplier dibatalkan
    const vd = await this.db.execute<{ number: string; reason: string | null }>(sql`
      SELECT number, void_reason AS reason FROM supplier_payments WHERE tenant_id = ${tenantId} AND status = 'VOID' AND voided_at >= ${since}::date`);
    add('PAY_VOIDED', 'info', 'Pembayaran supplier dibatalkan', vd.rows.map((r) => `${r.number}${r.reason ? ` — ${r.reason}` : ''}`), 'Tinjau alasan pembatalan.');

    // 8. Harga faktur di atas toleransi yang disetujui
    const pr = await this.db.execute<{ title: string }>(sql`
      SELECT title FROM approval_requests WHERE tenant_id = ${tenantId} AND kind = 'PURCHASE_INVOICE_PRICE' AND status = 'APPROVED' AND decided_at >= ${since}::date`);
    add('PRICE_APPROVED', 'info', 'Faktur harga di atas toleransi yang disetujui', pr.rows.map((r) => r.title), 'Pastikan kenaikan harga itu wajar (bandingkan dengan pemasok lain).');

    const rank = { error: 0, warning: 1, info: 2 } as const;
    out.sort((a, b) => rank[a.level] - rank[b.level]);
    return { asOf: today, since, items: out };
  }
}

@ApiTags('Pembelian')
@ApiBearerAuth()
@RequireApp('purchase')
@Controller('purchase-controls')
export class PurchaseControlsController {
  constructor(private readonly svc: PurchaseControlsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
}

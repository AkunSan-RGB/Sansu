import { Injectable } from '@nestjs/common';
import { CONTROL_PROFILES } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { SettingsService } from '../../common/settings.service';
import { ApprovalsService } from '../../common/approvals/approvals.service';
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

/**
 * Temuan kontrol pembelian & stok (anti-fraud) untuk 60 hari terakhir: PO dipecah di bawah batas persetujuan,
 * pembayaran akhir pekan, supplier baru langsung dibayar, barang diterima lama belum ditagih, pembayaran yang dibatalkan, dan harga faktur yang disetujui di atas toleransi.
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

    // 9. PO bernilai di atas batas persetujuan yang dikonfirmasi tanpa persetujuan (pemasok favorit / dikonfirmasi pemilik-admin): ditinjau Pemilik
    if (pol.purchaseOrder > 0) {
      const na = await this.db.execute<{ number: string; name: string }>(sql`
        SELECT o.number, s.name FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.tenant_id = ${tenantId} AND o.date >= ${since} AND o.status IN ('CONFIRMED', 'BILLED') AND o.total >= ${pol.purchaseOrder}
          AND NOT EXISTS (SELECT 1 FROM approval_requests a WHERE a.tenant_id = ${tenantId} AND a.kind = 'PURCHASE_ORDER' AND a.ref_id = o.id::text AND a.status = 'APPROVED')
        ORDER BY o.date DESC`);
      add('PO_NO_APPROVAL', 'info', 'PO bernilai besar dikonfirmasi tanpa persetujuan terpisah', na.rows.map((r) => `${r.number} (${r.name})`), 'Dikonfirmasi pemilik/admin atau lewat batas otomatis pemasok favorit. Tinjau berkala apakah pantas.');
    }

    // 10. PO yang sudah dikonfirmasi lalu dibatalkan
    const pc = await this.db.execute<{ number: string; reason: string | null }>(sql`
      SELECT o.number, o.cancel_reason AS reason FROM purchase_orders o
      WHERE o.tenant_id = ${tenantId} AND o.status = 'CANCELLED' AND o.cancelled_by_id IS NOT NULL AND o.date >= ${since}
        AND EXISTS (SELECT 1 FROM audit_logs l WHERE l.entity = 'PurchaseOrder' AND l.entity_id = o.id::text AND l.action = 'CONFIRM')`);
    add('PO_CANCELLED_AFTER_CONFIRM', 'info', 'PO dibatalkan setelah dikonfirmasi', pc.rows.map((r) => `${r.number}${r.reason ? ` — ${r.reason}` : ''}`), 'Pesanan tidak dapat diubah setelah dikonfirmasi; pembatalan dan penggantiannya perlu dipantau (mis. dipakai mengakali persetujuan).');

    // 11. Rekening supplier diubah
    const bk = await this.db.execute<{ code: string; name: string }>(sql`
      SELECT code, name FROM suppliers WHERE tenant_id = ${tenantId} AND bank_changed_at >= ${since}::date AND bank_changed_at IS NOT NULL`);
    add('SUPPLIER_BANK_CHANGED', 'warning', 'Rekening supplier diubah', bk.rows.map((r) => `${r.code} ${r.name}`), 'Pengalihan rekening pembayaran adalah modus penipuan yang umum. Konfirmasi perubahan ke pemasok lewat kontak yang sudah dikenal.');

    const rank = { error: 0, warning: 1, info: 2 } as const;
    out.sort((a, b) => rank[a.level] - rank[b.level]);
    return { asOf: today, since, items: out };
  }
}

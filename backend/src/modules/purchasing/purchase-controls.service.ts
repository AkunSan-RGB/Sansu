import { Injectable } from '@nestjs/common';
import { CONTROL_PROFILES } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { PurchaseControlsRepository } from './purchase-controls.repository';

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
    private readonly repo: PurchaseControlsRepository,
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
      const pos = await this.repo.queryPurchaseOrder(this.db, tenantId, since);
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
    const wk = await this.repo.querySupplierPayment(this.db, tenantId, since);
    add('WEEKEND_PAY', 'info', 'Pembayaran supplier di akhir pekan', wk.rows.map((r) => `${r.number} (${r.name})`), 'Transaksi di luar jam kerja lebih rentan disalahgunakan; pastikan ada alasannya.');

    // 3. Supplier baru (dibuat ≤14 hari sebelum pembayaran pertamanya) langsung dibayar
    const fresh = await this.repo.querySupplier(this.db, tenantId, since);
    add('NEW_SUPPLIER_PAID', 'warning', 'Supplier baru langsung dibayar', fresh.rows.map((r) => `${r.code} ${r.name}`), 'Pemasok fiktif biasanya dibuat lalu cepat dibayar. Pastikan pemasok & barangnya nyata (NPWP, kontak, bukti terima).');

    // 6. Barang diterima belum ditagih pemasok (ambang menurut jenis usaha; tidak relevan untuk jasa)
    if (cp.grniDays !== null) {
    const gr = await this.repo.queryGoodsReceipt(this.db, tenantId, today, cp.grniDays);
    add('GRNI_OLD', 'info', `Barang diterima > ${cp.grniDays} hari belum ditagih`, gr.rows.map((r) => `${r.number} (${r.name})`), 'Hutang belum tercatat. Minta faktur pemasok atau periksa apakah penerimaan benar.');
    }

    // 7. Pembayaran supplier dibatalkan
    const vd = await this.repo.querySupplierPaymentForControls(this.db, tenantId, since);
    add('PAY_VOIDED', 'info', 'Pembayaran supplier dibatalkan', vd.rows.map((r) => `${r.number}${r.reason ? ` — ${r.reason}` : ''}`), 'Tinjau alasan pembatalan.');

    // 8. Harga faktur di atas toleransi yang disetujui
    const pr = await this.repo.queryApprovalRequest(this.db, tenantId, since);
    add('PRICE_APPROVED', 'info', 'Faktur harga di atas toleransi yang disetujui', pr.rows.map((r) => r.title), 'Pastikan kenaikan harga itu wajar (bandingkan dengan pemasok lain).');

    // 9. PO bernilai di atas batas persetujuan yang dikonfirmasi tanpa persetujuan (pemasok favorit / dikonfirmasi pemilik-admin): ditinjau Pemilik
    if (pol.purchaseOrder > 0) {
      const na = await this.repo.queryPurchaseOrderForControls(this.db, tenantId, since, pol.purchaseOrder);
      add('PO_NO_APPROVAL', 'info', 'PO bernilai besar dikonfirmasi tanpa persetujuan terpisah', na.rows.map((r) => `${r.number} (${r.name})`), 'Dikonfirmasi pemilik/admin atau lewat batas otomatis pemasok favorit. Tinjau berkala apakah pantas.');
    }

    // 10. PO yang sudah dikonfirmasi lalu dibatalkan
    const pc = await this.repo.queryPurchaseOrderForControls2(this.db, tenantId, since);
    add('PO_CANCELLED_AFTER_CONFIRM', 'info', 'PO dibatalkan setelah dikonfirmasi', pc.rows.map((r) => `${r.number}${r.reason ? ` — ${r.reason}` : ''}`), 'Pesanan tidak dapat diubah setelah dikonfirmasi; pembatalan dan penggantiannya perlu dipantau (mis. dipakai mengakali persetujuan).');

    // 11. Rekening supplier diubah
    const bk = await this.repo.querySupplierForControls(this.db, tenantId, since);
    add('SUPPLIER_BANK_CHANGED', 'warning', 'Rekening supplier diubah', bk.rows.map((r) => `${r.code} ${r.name}`), 'Pengalihan rekening pembayaran adalah modus penipuan yang umum. Konfirmasi perubahan ke pemasok lewat kontak yang sudah dikenal.');

    const rank = { error: 0, warning: 1, info: 2 } as const;
    out.sort((a, b) => rank[a.level] - rank[b.level]);
    return { asOf: today, since, items: out };
  }
}

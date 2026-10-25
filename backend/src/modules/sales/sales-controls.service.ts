import { Injectable } from '@nestjs/common';
import { CONTROL_PROFILES } from '@sansu/shared';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { SettingsService } from '../../common/settings.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { SalesControlsRepository } from './sales-controls.repository';

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
    private readonly repo: SalesControlsRepository,
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
    const dn = await this.repo.queryDeliveryOrder(this.db, tenantId, today, cp.deliveryNotBilledDays);
    add('DELIVERY_NOT_BILLED', 'warning', `Surat jalan belum difakturkan > ${cp.deliveryNotBilledDays} hari`, dn.rows.map((r) => r.number), 'Barang sudah keluar tetapi belum ditagih. Tagih sekarang atau pastikan tidak ada barang keluar tanpa tagihan.');

    }

    // 12. Penjualan: pesanan dibatalkan setelah dikonfirmasi
    const sc = await this.repo.querySalesOrder(this.db, tenantId, since);
    add('SO_CANCELLED_AFTER_CONFIRM', 'info', 'Pesanan penjualan dibatalkan setelah dikonfirmasi', sc.rows.map((r) => `${r.number}${r.reason ? ` — ${r.reason}` : ''}`), 'Pastikan pembatalan wajar dan bukan menghilangkan jejak penjualan.');

    // 13. Penjualan: surat jalan dibatalkan (barang sudah keluar fisik)
    const dc = await this.repo.queryDeliveryOrderForControls(this.db, tenantId, since);
    add('DN_CANCELLED', 'warning', 'Surat jalan dibatalkan', dc.rows.map((r) => `${r.number}${r.reason ? ` — ${r.reason}` : ''}`), 'Barang sudah sempat keluar gudang. Pastikan barang benar-benar kembali ke stok.');

    // 14. Penjualan: diskon besar (>= 20% per baris) pada pesanan yang dikonfirmasi
    const dh = await this.repo.querySalesOrderLine(this.db, tenantId, since);
    add('DISCOUNT_HEAVY', 'info', 'Diskon besar (≥ 20%) pada pesanan penjualan', dh.rows.map((r) => `${r.number} (${Number(r.pct)}%)`), 'Diskon besar yang berulang pada pelanggan atau sales yang sama patut ditanyakan.');

    // 15. Pesanan bernilai di atas batas persetujuan yang dikonfirmasi tanpa persetujuan terpisah (pemilik/admin): ditinjau Pemilik
    const pol = await this.approvals.policy(this.db, tenantId);
    if (pol.salesOrder > 0) {
      const na = await this.repo.querySalesOrderForControls(this.db, tenantId, since, pol.salesOrder);
      add('SO_NO_APPROVAL', 'info', 'Pesanan besar dikonfirmasi tanpa persetujuan terpisah', na.rows.map((r) => `${r.number} (${r.name})`), 'Dikonfirmasi pemilik/admin. Tinjau berkala apakah pantas.');
    }

    // 15a. Pesanan terkirim sebagian dan sisanya tak kunjung dikirim
    const ps = await this.repo.querySalesOrderForControls2(this.db, tenantId, today);
    add('PARTIAL_DELIVERY_STUCK', 'warning', 'Pesanan terkirim sebagian, sisanya belum dikirim > 14 hari', ps.rows.map((r) => `${r.number} ${r.name} (${r.days} hari sejak kirim terakhir)`), 'Selama sisa barang belum terkirim, pesanan tidak bisa difakturkan. Kirim sisanya, atau batalkan surat jalan bila pesanan dibatalkan.');

    // 15b. Piutang dihapus (write-off) 60 hari terakhir — pintu belakang untuk menghilangkan tagihan
    const wo = await this.repo.queryPayment(this.db, tenantId, since);
    add('AR_WRITE_OFF', 'warning', 'Piutang dihapus (write-off)', wo.rows.map((r) => `${r.inv} ${r.name} Rp${Math.round(Number(r.v)).toLocaleString('id-ID')}${r.who ? ` oleh ${r.who}` : ''}`), 'Tagihan dihapus dari piutang tanpa uang masuk. Pastikan sudah ditagih, ada bukti, dan disetujui Pemilik; piutang yang dihapus tetap ditagih bila pelanggan membayar belakangan (catat sebagai pendapatan lain).');

    // 16. Pembayaran pelanggan dicatat jauh setelah tanggal terima (tanda uang ditahan lalu dicatat belakangan / menutup piutang lain)
    const lp = await this.repo.queryPaymentForControls(this.db, tenantId, since);
    add('PAYMENT_LATE_RECORDED', 'warning', 'Pembayaran pelanggan dicatat ≥ 3 hari setelah tanggal terima', lp.rows.map((r) => `${r.number ?? 'bayar'} ${r.name} (${r.days} hari)`), 'Uang yang diterima lalu baru dicatat belakangan adalah tanda uang tertahan atau dipakai menutup piutang pelanggan lain. Cocokkan dengan mutasi bank.');

    // 17. Retur setelah komisi periodenya ditutup (komisi sudah dibayar atas penjualan yang kemudian diretur)
    const cb = await this.repo.querySalesReturn(this.db, tenantId, since);
    add('COMMISSION_CLAWBACK', 'warning', 'Retur atas penjualan yang komisinya sudah ditutup', cb.rows.map((r) => `${r.who} periode ${r.period}: retur Rp${Math.round(Number(r.v)).toLocaleString('id-ID')}`), 'Komisi periode itu dihitung sebelum retur terjadi. Pertimbangkan koreksi komisi (potong di periode berikutnya).');

    // 18. Syarat pelanggan dilonggarkan / diubah
    const ct = await this.repo.queryAuditLog(this.db, tenantId, since);
    add('CUSTOMER_TERMS_CHANGED', 'info', 'Limit kredit / termin pelanggan diubah', ct.rows.map((r) => `${r.code} ${r.name}`), 'Melonggarkan syarat adalah cara umum menutupi tagihan macet. Pastikan ada dasar komersialnya.');

    // 19. Pembayaran transfer/non-tunai yang tidak ada di mutasi bank padahal mutasi periodenya sudah diimpor (kemungkinan pembayaran fiktif)
    const bu = await this.repo.queryPaymentForControls2(this.db, tenantId, since, today);
    add('PAYMENT_NOT_IN_BANK', 'warning', 'Pembayaran transfer pelanggan tidak ada di mutasi bank', bu.rows.map((r) => `${r.number} ${r.name}`), 'Mutasi bank periode itu sudah diimpor, tetapi tidak ada baris yang cocok dengan pembayaran ini. Bisa pembayaran fiktif atau salah rekening; cocokkan di Kas & Bank › Cocokkan dengan bank.');

    // 20. Pemisahan fungsi: pembayaran / retur atas faktur oleh orang yang sama dengan pembuat fakturnya
    // Hanya relevan bila ada lebih dari satu Keuangan aktif (satu orang pasti memegang kedua langkah, sehingga temuannya hanya kebisingan)
    const [{ n: financeCount }] = (await this.repo.queryUser(this.db, tenantId)).rows;
    if (financeCount >= 2) {
    const sp = await this.repo.queryPaymentForControls3(this.db, tenantId, since);
    add('PAYMENT_BY_INVOICE_CREATOR', 'info', 'Pembayaran dicatat oleh pembuat fakturnya sendiri', sp.rows.map((r) => `${r.who}: ${r.n} faktur`), 'Satu orang membuat tagihan sekaligus mencatat uang masuknya, padahal ada lebih dari satu Keuangan. Bagi tugasnya dan aktifkan "Pemisahan fungsi penjualan" di Pengaturan › Perusahaan › Kebijakan.');
    const sr = await this.repo.querySalesReturnForControls(this.db, tenantId, since);
    add('RETURN_BY_INVOICE_CREATOR', 'info', 'Retur dicatat oleh pembuat fakturnya sendiri', sr.rows.map((r) => `${r.who}: ${r.n} faktur`), 'Orang yang membuat faktur juga membuat kredit nota (retur) atasnya, padahal ada lebih dari satu Keuangan. Aktifkan "Pemisahan fungsi penjualan" di Pengaturan › Perusahaan › Kebijakan.');
    }

    const rank = { error: 0, warning: 1, info: 2 } as const;
    out.sort((a, b) => rank[a.level] - rank[b.level]);
    const setup = {
      active: pol.salesOrder > 0 || pol.salesDiscountMaxPct > 0 || pol.salesReturn > 0 || pol.salesBelowCost,
      message: 'Pesanan besar, diskon besar, penjualan di bawah harga pokok, dan retur besar belum butuh persetujuan, sehingga staf bisa melakukannya sendiri.',
      recommended: { salesOrder: 50_000_000, salesDiscountMaxPct: 15, salesReturn: 5_000_000, salesBelowCost: true },
      recommendedText: 'pesanan ≥ Rp50 juta, diskon > 15%, retur ≥ Rp5 juta, dan harga di bawah pokok butuh persetujuan Pemilik/Admin',
    };
    return { asOf: today, since, items: out, setup, policy: { salesOrder: pol.salesOrder, salesDiscountMaxPct: pol.salesDiscountMaxPct, salesReturn: pol.salesReturn, salesBelowCost: pol.salesBelowCost, salesSeparateDuties: pol.salesSeparateDuties, blindDelivery: pol.blindDelivery } };
  }
}

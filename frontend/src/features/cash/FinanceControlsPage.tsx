import { ControlFindingsPage } from '@/features/purchasing/PurchaseControlsPage';

export default function FinanceControlsPage() {
  return (
    <ControlFindingsPage
      title="Kontrol keuangan"
      endpoint="/cash/controls"
      intro="Pola yang patut diperiksa pada uang keluar, saldo kas/bank, hitung kas, dan jurnal manual"
      settings={['uang keluar & pembayaran pemasok mulai nilai berapa butuh persetujuan', 'jurnal manual mulai nilai berapa butuh persetujuan', 'batas saldo kas dan hitung kas (Kas › pengaturan kontrol kas)']}
      fixedRules="Aturan tetap (tidak bisa diatur): uang keluar tanpa nomor bukti, di akhir pekan, atau dipecah di bawah batas ditandai; saldo negatif ditandai; periode yang sudah dikunci tidak bisa diubah; Keuangan dan Akuntan dipisah (pembuat transaksi ≠ pembukunya)."
    />
  );
}

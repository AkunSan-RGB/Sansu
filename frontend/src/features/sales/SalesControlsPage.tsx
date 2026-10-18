import { ControlFindingsPage } from '@/features/purchasing/PurchaseControlsPage';

export default function SalesControlsPage() {
  return (
    <ControlFindingsPage
      title="Kontrol penjualan"
      endpoint="/sales-controls"
      intro="Pola yang patut diperiksa pada pesanan, pengiriman, faktur, dan diskon penjualan"
      settings={['pesanan penjualan mulai nilai berapa butuh persetujuan', 'diskon per baris di atas berapa persen butuh persetujuan', 'retur penjualan mulai nilai berapa butuh persetujuan', 'penjualan di bawah harga pokok', 'pengiriman buta']}
      fixedRules="Aturan tetap (tidak bisa diatur): alasan wajib saat membatalkan pesanan atau surat jalan, faktur hanya atas barang yang sudah dikirim Gudang, dan pelanggan dengan NPWP/nama mirip harus dikonfirmasi. Limit kredit dan termin pelanggan diubah di Penjualan › Pelanggan; menaikkannya oleh staf butuh persetujuan."
    />
  );
}

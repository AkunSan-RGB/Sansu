import { ControlFindingsPage } from '@/features/purchasing/PurchaseControlsPage';

export default function InventoryControlsPage() {
  return (
    <ControlFindingsPage
      title="Kontrol persediaan"
      endpoint="/inventory-controls"
      intro="Pola yang patut diperiksa pada penyesuaian stok, stock opname, dan transfer gudang"
      settings={['penyesuaian stok / selisih opname mulai nilai berapa butuh persetujuan', 'harga pokok penyesuaian stok masuk di atas rata-rata (%)', 'pembuat transfer ≠ penerima', 'Pemilik diberi tahu bila penyesuaian keluar / selisih opname ≥ nilai berapa', 'penghitung ≠ pemosting selisih opname', 'opname buta', 'penerimaan buta (barang masuk)']}
      fixedRules="Aturan tetap (tidak bisa diatur): stok tidak boleh negatif, alasan wajib saat penyesuaian, selisih opname besar wajib dijelaskan dengan catatan alasan, selisih opname dibukukan terhadap stok saat diposting, dan gudang dengan stok yang lewat 35 hari tanpa opname ditandai."
    />
  );
}

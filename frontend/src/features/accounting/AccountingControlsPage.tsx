import { ControlFindingsPage } from '@/features/purchasing/PurchaseControlsPage';

export default function AccountingControlsPage() {
  return (
    <ControlFindingsPage
      title="Kontrol pembukuan & pajak"
      endpoint="/accounting-controls"
      intro="Gabungan pemeriksaan kesehatan pembukuan, daftar periksa pajak, dan jurnal yang dibuat jauh setelah tanggal transaksinya"
      settings={['batas persetujuan jurnal manual']}
      fixedRules="Aturan tetap (tidak bisa diatur): jurnal tidak bisa diubah atau dihapus (hanya dibalik), neraca saldo wajib seimbang, periode yang dikunci tidak bisa dimasuki transaksi, dan Keuangan dipisah dari Akuntan. Kunci periode dan tutup buku ada di Akuntansi › Akhir periode. Halaman ini hanya memeriksa kelengkapan dan kewajaran data; perhitungan pajak perlu dikonfirmasi konsultan pajak."
    />
  );
}

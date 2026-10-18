/**
 * Fokus pajak per jenis usaha: kewajiban yang umumnya relevan. Panduan umum untuk membantu menyiapkan data — bukan nasihat pajak;
 * penerapannya tetap perlu dikonfirmasi konsultan pajak.
 */
import type { BusinessModel } from './apps.js';

export interface TaxFocus {
  title: string;
  points: string[];
}

export const TAX_FOCUS: Record<BusinessModel, TaxFocus> = {
  DAGANG: { title: 'Dagang: jual-beli barang', points: ['PPN keluaran atas penjualan dan PPN masukan atas pembelian dikreditkan lewat faktur pajak yang sah.', 'Pelanggan umumnya tidak memotong PPh atas penjualan barang.', 'PPh 21 untuk pegawai dan PPh badan / final UMKM sesuai skema.'] },
  RITEL: { title: 'Ritel: penjualan kasir', points: ['Tentukan apakah harga di kasir sudah termasuk PPN; pengaturan ini mempengaruhi seluruh struk dan rekap PPN.', 'Penjualan tunai ke konsumen akhir: pastikan omzet harian di kasir sama dengan yang dibukukan.', 'PPh 21 untuk pegawai dan PPh badan / final UMKM sesuai skema.'] },
  UTILITAS: { title: 'Utilitas: tagihan berkala ke pelanggan', points: ['Perlakuan PPN berbeda per layanan (air bersih, listrik, internet/TV kabel): pastikan status tiap tarif dengan konsultan pajak sebelum menyalakan PPN pada tarif.', 'Denda keterlambatan dan biaya sambung baru adalah penghasilan; perlakuan pajaknya perlu dikonfirmasi.', 'Deposit/jaminan pelanggan adalah titipan, bukan pendapatan, selama belum dipakai.'] },
  JASA: { title: 'Jasa: tagihan dan potongan klien', points: ['Klien badan sering memotong PPh 23 saat membayar; catat bukti potong di pembayaran agar menjadi kredit pajak.', 'PPN atas jasa kena pajak hanya bila PKP.', 'Tenaga lepas dan mitra: perlakuan PPh 21 berbeda dari pegawai tetap.'] },
  FMCG: { title: 'FMCG: distribusi barang konsumen', points: ['PPN atas penjualan ke outlet; potongan, rebate, dan bonus barang mempengaruhi dasar pengenaan PPN.', 'Klaim trade promo ke prinsipal dicatat terpisah dari penjualan.', 'PPh 21 komisi sales lapangan dipotong saat dibayar.'] },
  MANUFAKTUR: { title: 'Manufaktur: bahan baku dan barang jadi', points: ['PPN masukan atas bahan baku dan barang modal dikreditkan hanya bila faktur pajak pemasok sah.', 'Pekerjaan maklon: klien bisa memotong PPh; catat bukti potongnya.', 'Upah borongan dan per hasil: PPh 21 menyesuaikan status pekerja.'] },
  FNB: { title: 'F&B: pajak restoran', points: ['Pajak restoran daerah (PB1/PBJT) dipungut dari penjualan kasir dan disetor ke pemerintah daerah.', 'Bahan baku segar dari pasar sering tanpa faktur pajak: PPN masukan tidak dapat dikreditkan.', 'PPh 21 untuk pegawai dan PPh badan / final UMKM sesuai skema.'] },
};

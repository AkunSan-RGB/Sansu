import { localize } from '@sansu/shared';

describe('istilah antarmuka per jenis usaha', () => {
  it('dagang membaca barang; ritel juga membaca toko', () => {
    expect(localize('Produk', 'DAGANG')).toBe('Barang');
    expect(localize('Persediaan per gudang', 'DAGANG')).toBe('Persediaan per gudang');
    expect(localize('Persediaan per gudang', 'RITEL')).toBe('Persediaan per toko');
    expect(localize('Transfer gudang', 'RITEL')).toBe('Transfer toko');
  });
  it('jasa membaca klien, tagihan, dan pendapatan jasa', () => {
    expect(localize('Pelanggan', 'JASA')).toBe('Klien');
    expect(localize('Uang muka pelanggan', 'JASA')).toBe('Uang muka klien');
    expect(localize('Faktur & piutang', 'JASA')).toBe('Tagihan & piutang');
    expect(localize('Penjualan', 'JASA')).toBe('Pendapatan jasa');
    expect(localize('Sales Order', 'JASA')).toBe('Pesanan kerja');
    expect(localize('Pipeline calon pelanggan', 'JASA')).toBe('Pipeline calon klien');
    expect(localize('Supplier', 'JASA')).toBe('Pemasok & subkontraktor');
    expect(localize('Inventori', 'JASA')).toBe('Bahan kerja');
    expect(localize('Penjualan bulan ini (DPP)', 'JASA')).toBe('Pendapatan bulan ini (DPP)');
  });
  it('jasa: retur dan perputaran persediaan memakai istilah bahan; jenis usaha lain tidak berubah', () => {
    expect(localize('Retur penjualan', 'JASA')).toBe('Retur bahan dari klien');
    expect(localize('Retur Pembelian', 'JASA')).toBe('Retur bahan ke pemasok');
    expect(localize('Retur', 'JASA')).toBe('Retur bahan');
    expect(localize('Perputaran persediaan', 'JASA')).toBe('Pemakaian bahan');
    expect(localize('Persediaan & mutasi', 'JASA')).toBe('Bahan & mutasi');
    expect(localize('Tidak bergerak', 'JASA')).toBe('Tidak terpakai');
    for (const m of ['DAGANG', 'RITEL', 'FMCG', 'MANUFAKTUR', 'FNB'] as const) {
      expect(localize('Retur penjualan', m)).toBe('Retur penjualan');
      expect(localize('Retur', m)).toBe('Retur');
      expect(localize('Perputaran persediaan', m)).toBe('Perputaran persediaan');
      expect(localize('Lambat', m)).toBe('Lambat');
      expect(localize('Tidak bergerak', m)).toBe('Tidak bergerak');
    }
  });
  it('judul dokumen cetak huruf besar ikut berubah', () => {
    expect(localize('FAKTUR', 'JASA')).toBe('TAGIHAN');
    expect(localize('FAKTUR JASA', 'JASA')).toBe('FAKTUR JASA');
    expect(localize('FAKTUR', 'DAGANG')).toBe('FAKTUR');
  });
  it('kata penjualan di dalam kalimat lain tidak ikut berubah untuk jasa', () => {
    expect(localize('Laporan penjualan harian', 'JASA')).toBe('Laporan penjualan harian');
  });
  it('FMCG membaca prinsipal, outlet, dan SKU; manufaktur tetap membaca bahan', () => {
    expect(localize('Pembelian', 'FMCG')).toBe('Pembelian dari prinsipal');
    expect(localize('Supplier', 'FMCG')).toBe('Prinsipal / pemasok');
    expect(localize('Pelanggan', 'FMCG')).toBe('Outlet');
    expect(localize('Produk', 'FMCG')).toBe('Produk (SKU)');
    expect(localize('Pembelian', 'MANUFAKTUR')).toBe('Pembelian bahan');
  });
  it('kata yang bukan istilah utuh tidak tersentuh dan model tak dikenal jatuh ke dagang', () => {
    expect(localize('Produksi', 'DAGANG')).toBe('Produksi');
    expect(localize('Pelangganku', 'JASA')).toBe('Pelangganku');
    expect(localize('Produk', undefined)).toBe('Barang');
    expect(localize('Dashboard', 'JASA')).toBe('Dashboard');
  });
});

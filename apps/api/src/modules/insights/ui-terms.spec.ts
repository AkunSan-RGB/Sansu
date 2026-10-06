import { localize } from '@sansu/shared';

describe('istilah antarmuka per jenis usaha', () => {
  it('dagang membaca barang; ritel juga membaca toko', () => {
    expect(localize('Produk', 'DAGANG')).toBe('Barang');
    expect(localize('Stok per gudang', 'DAGANG')).toBe('Stok per gudang');
    expect(localize('Stok per gudang', 'RITEL')).toBe('Stok per toko');
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
  it('judul dokumen cetak huruf besar ikut berubah', () => {
    expect(localize('FAKTUR', 'JASA')).toBe('TAGIHAN');
    expect(localize('FAKTUR JASA', 'JASA')).toBe('FAKTUR JASA');
    expect(localize('FAKTUR', 'DAGANG')).toBe('FAKTUR');
  });
  it('kata penjualan di dalam kalimat lain tidak ikut berubah untuk jasa', () => {
    expect(localize('Laporan penjualan harian', 'JASA')).toBe('Laporan penjualan harian');
  });
  it('produksi membaca pesanan bahan dan stok bahan', () => {
    expect(localize('Purchase Order', 'PRODUKSI')).toBe('Pesanan bahan');
    expect(localize('Pembelian', 'PRODUKSI')).toBe('Pembelian bahan');
    expect(localize('Inventori', 'PRODUKSI')).toBe('Stok bahan & produk jadi');
    expect(localize('Produk', 'PRODUKSI')).toBe('Produk & bahan baku');
  });
  it('kata yang bukan istilah utuh tidak tersentuh dan model tak dikenal jatuh ke dagang', () => {
    expect(localize('Produksi', 'DAGANG')).toBe('Produksi');
    expect(localize('Pelangganku', 'JASA')).toBe('Pelangganku');
    expect(localize('Produk', undefined)).toBe('Barang');
    expect(localize('Dashboard', 'JASA')).toBe('Dashboard');
  });
});

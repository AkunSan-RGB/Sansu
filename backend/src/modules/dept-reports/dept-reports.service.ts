import { BadRequestException, Injectable } from '@nestjs/common';
import type { BusinessModel } from '@sansu/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { cashReport } from './cash';
import { fmcgReport } from './fmcg';
import { hrReport } from './hr';
import { inventoryReport } from './inventory';
import { fnbReport, posReport } from './pos';
import { mfgReport } from './production';
import { purchasesReport } from './purchasing';
import { salesReport } from './sales';
import { jasaReport } from './services';
import { Builder, DEPTS, type DeptKey, type DeptReport, spanDays } from './types';
import { utilityReport } from './utility';
import { DeptRangeQuery } from './dept-reports.shared';

const MAX_DAYS = 800;

const META: Record<DeptKey, { title: string; description: string; build: Builder }> = {
  sales: { title: 'Laporan penjualan', description: 'Penjualan per periode, pelanggan, produk, dan sales; umur piutang, faktur lewat jatuh tempo, retur, dan surat jalan yang belum ditagih.', build: salesReport },
  purchases: { title: 'Laporan pembelian', description: 'Pembelian per periode, pemasok, dan produk; umur utang, selisih harga beli, pesanan belum diterima, dan penerimaan belum difakturkan.', build: purchasesReport },
  inventory: { title: 'Laporan persediaan', description: 'Nilai persediaan per gudang dan produk, perputaran, stok di bawah minimum, dan lot yang akan kedaluwarsa.', build: inventoryReport },
  cash: { title: 'Laporan kas & bank', description: 'Saldo per akun kas/bank, arus per hari dan per sumber, serta status pencocokan bank.', build: cashReport },
  pos: { title: 'Laporan kasir', description: 'Penjualan kasir per periode, kasir, sesi, metode bayar, produk terlaris, dan jam ramai; selisih uang di laci dan pencairan QRIS/kartu.', build: posReport },
  fnb: { title: 'Laporan F&B', description: 'Penjualan per menu dan jenis pesanan, pajak restoran daerah, saluran online, dan bahan terpakai.', build: fnbReport },
  fmcg: { title: 'Laporan FMCG', description: 'Penjualan per sales dan outlet, komisi, bonus promo, klaim prinsipal, setoran kanvas, tukar-guling, dan konsinyasi.', build: fmcgReport },
  mfg: { title: 'Laporan produksi', description: 'Biaya dan hasil produksi, perintah yang menggantung, pemakaian pusat kerja, dan tingkat gagal QC.', build: mfgReport },
  jasa: { title: 'Laporan jasa & proyek', description: 'Proyek dan penagihannya, jam belum ditagih, utilisasi karyawan, retainer, uang muka klien, dan umur piutang.', build: jasaReport },
  utility: { title: 'Laporan utilitas', description: 'Sambungan, tagihan bulanan, tunggakan, pemakaian per tarif, dan temuan pencatatan meter.', build: utilityReport },
  hr: { title: 'Laporan SDM', description: 'Karyawan per bagian, absensi, cuti, penggajian, dan rekap PPh 21/BPJS.', build: hrReport },
};

@Injectable()
export class DeptReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async build(u: AuthUser, dept: string, q: DeptRangeQuery): Promise<DeptReport> {
    if (!(DEPTS as readonly string[]).includes(dept)) throw new BadRequestException('Bagian laporan tidak dikenal');
    const key = dept as DeptKey;
    const today = todayJakarta();
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('Tanggal awal tidak boleh setelah tanggal akhir');
    if (spanDays(from, to) > MAX_DAYS) throw new BadRequestException(`Rentang tanggal paling lama ${MAX_DAYS} hari`);
    const model: BusinessModel = await this.settings.businessModel(this.db, u.tenantId);
    const m = META[key];
    const body = await m.build({ db: this.db, tenantId: u.tenantId, from: from.slice(0, 10), to: to.slice(0, 10), today, model });
    return { dept: key, title: m.title, description: m.description, period: { from, to }, ...body };
  }
}

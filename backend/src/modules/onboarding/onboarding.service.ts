import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { BUSINESS_MODEL_BY_KEY, MODEL_SETUP, isProductionModel, type AppKey, type BusinessModel } from '@sansu/shared';
import { AppsService } from '../../common/apps/apps.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { syncChartOfAccounts } from '../accounting/coa-sync';
import { BusinessModelDto, ServiceProfilesDto } from './onboarding.dto';
import { OnboardingRepository } from './onboarding.repository';

export interface OnboardingStep {
  key: string;
  title: string;
  description: string;
  done: boolean;
  link: string;
  /** aplikasi yang dibutuhkan (langkah disembunyikan bila tidak terpasang) */
  app?: AppKey | AppKey[];
}

const DEFAULTS = { dismissed: false };

/** Tabel yang menandai perusahaan sudah bertransaksi (dokumen, mutasi, jurnal) — satu baris saja cukup untuk mengunci jenis usaha */
const TRANSACTION_PROBES = [
  'journal_entries', 'sales_orders', 'quotations', 'invoices', 'payments', 'delivery_orders', 'purchase_requests', 'purchase_orders', 'goods_receipts', 'purchase_invoices',
  'supplier_payments', 'stock_moves', 'stock_transfers', 'stock_counts', 'production_orders', 'pos_sessions', 'pos_orders', 'cash_transactions', 'payroll_runs', 'fixed_assets',
  'customer_deposits', 'sales_returns', 'purchase_returns', 'consignment_docs', 'canvass_collections', 'marketplace_orders', 'tax_payments', 'leads',
];

/** Daftar langkah awal untuk perusahaan baru — status terdeteksi otomatis dari data */
@Injectable()
export class OnboardingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly apps: AppsService,
    private readonly audit: AuditService,
    private readonly repo: OnboardingRepository,
  ) {}

  /** Perusahaan yang sudah punya transaksi atau dokumen tidak boleh berganti jenis usaha (data antar jenis usaha tidak boleh tercampur) */
  async hasTransactions(tenantId: string): Promise<boolean> {
    const checks = TRANSACTION_PROBES.map((t) => sql.raw(`SELECT 1 FROM "${t}" WHERE tenant_id = '${tenantId.replace(/'/g, '')}'`));
    const r = await this.repo.queryHasTransactions(this.db, checks);
    return r.rows.length > 0;
  }

  /** Jenis usaha sudah pernah dipilih secara sadar (bukan nilai bawaan perusahaan lama) */
  private async chosen(tenantId: string): Promise<boolean> {
    const [t] = await this.repo.findTenantsById(this.db, tenantId);
    return !!(t?.settings as { business?: { model?: string } } | null)?.business?.model;
  }

  async business(tenantId: string) {
    const model = await this.settings.businessModel(this.db, tenantId);
    const locked = (await this.chosen(tenantId)) && (await this.hasTransactions(tenantId));
    return { model, info: BUSINESS_MODEL_BY_KEY[model], locked };
  }

  async serviceProfiles(tenantId: string) {
    return { profiles: await this.settings.serviceProfiles(this.db, tenantId) };
  }

  /** Profil layanan hanya mengatur tampilan (menu, ruang kerja, bantuan) perusahaan Jasa; akun, pajak, dan SDM tidak berubah */
  async setServiceProfiles(u: AuthUser, dto: ServiceProfilesDto) {
    if ((await this.settings.businessModel(this.db, u.tenantId)) !== 'JASA') throw new BadRequestException('Profil layanan hanya untuk jenis usaha Jasa');
    const before = await this.settings.serviceProfiles(this.db, u.tenantId);
    const profiles = [...new Set(dto.profiles)];
    await this.settings.saveServiceProfiles(this.db, u.tenantId, profiles);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ServiceProfiles', entityId: u.tenantId, data: { before, after: profiles } });
    return { profiles };
  }

  async setBusiness(u: AuthUser, dto: BusinessModelDto) {
    const current = await this.settings.businessModel(this.db, u.tenantId);
    if (dto.model !== current && (await this.chosen(u.tenantId)) && (await this.hasTransactions(u.tenantId))) {
      throw new ConflictException(
        `Jenis usaha dikunci: perusahaan ini sudah punya transaksi sebagai ${BUSINESS_MODEL_BY_KEY[current].name}. Data antar jenis usaha tidak boleh tercampur — untuk jenis usaha lain, buat perusahaan baru.`,
      );
    }
    await this.settings.saveSection(
      this.db,
      u.tenantId,
      'business',
      { model: 'DAGANG' as BusinessModel },
      { model: dto.model },
    );
    const installed: AppKey[] = [];
    if (dto.applyApps) {
      const on = await this.apps.enabled(u.tenantId);
      for (const k of BUSINESS_MODEL_BY_KEY[dto.model].apps) {
        if (!on.has(k)) {
          await this.apps.install(u.tenantId, k);
          installed.push(k);
        }
      }
    }
    // Akun khusus jenis usaha ditambahkan, nama bawaan disesuaikan, dan akun yang tidak relevan dinonaktifkan; akun model sebelumnya tidak dihapus
    await this.db.transaction(async (tx) => syncChartOfAccounts(tx, u.tenantId, { apps: await this.apps.enabled(u.tenantId, tx) }));
    await this.audit.log(this.db, {
      tenantId: u.tenantId,
      userId: u.sub,
      action: 'UPDATE',
      entity: 'BusinessModel',
      entityId: u.tenantId,
      data: { ...dto, installed },
    });
    return { ...(await this.business(u.tenantId)), installed };
  }

  async status(u: AuthUser) {
    const r = await this.repo.queryTenant(this.db, u.sub, u.tenantId);
    const s = r.rows[0] ?? {};
    const model = await this.settings.businessModel(this.db, u.tenantId);
    const productStep: Record<BusinessModel, [string, string]> = {
      DAGANG: [
        'Masukkan produk',
        'Ketik satu per satu atau impor sekaligus dari Excel, lengkap dengan satuan (PCS, DUS).',
      ],
      RITEL: [
        'Masukkan produk & barcode',
        'Isi harga jual dan barcode agar bisa langsung di-scan di kasir. Bisa impor dari Excel.',
      ],
      JASA: [
        'Daftar layanan / jasa',
        'Masukkan jenis pekerjaan beserta tarifnya agar penawaran dan faktur cepat dibuat.',
      ],
      FMCG: ['Masukkan produk (SKU) & satuan dus/pak', 'Isi harga jual per satuan, barcode, dan satuan dus/pak. Tandai masa simpan agar kedaluwarsa dipantau. Bisa impor dari Excel.'],
      MANUFAKTUR: ['Masukkan bahan, barang setengah jadi & barang jadi', 'Daftarkan bahan baku, bahan penolong, barang setengah jadi, dan barang jadi — atau impor dari Excel.'],
      UTILITAS: ['Atur tarif & daftar sambungan', 'Buat tarif (blok pemakaian, abonemen) di Layanan Utilitas → Tarif, lalu daftarkan sambungan pelanggan beserta nomor meter.'],
      FNB: ['Masukkan bahan & menu', 'Daftarkan bahan (kopi, susu, tepung) dan menu yang dijual. Tandai menu sebagai "dibuat saat dipesan" agar bahan terpotong otomatis di kasir.'],
    };
    const saleStep: Record<BusinessModel, [string, string, string]> = {
      DAGANG: ['Catat penjualan pertama', 'Buat sales order, lalu jadikan faktur.', '/sales-orders/new'],
      RITEL: ['Buka kasir & jual pertama', 'Buka sesi kasir, scan barang, terima pembayaran.', '/pos'],
      JASA: [
        'Kirim tagihan jasa pertama',
        'Buat faktur jasa (bisa per termin proyek). PPh 23 / PPh 4(2) yang dipotong pelanggan dihitung otomatis.',
        '/invoices/services/new',
      ],
      FMCG: ['Catat pesanan outlet pertama', 'Buat sales order untuk outlet (daftar harga dan promo mengikuti segmen pelanggan), lalu jadikan faktur.', '/sales-orders/new'],
      MANUFAKTUR: ['Catat penjualan pertama', 'Buat sales order barang jadi, lalu jadikan faktur.', '/sales-orders/new'],
      UTILITAS: ['Tagih bulan pertama', 'Catat meter, verifikasi oleh orang lain, lalu jalankan penagihan bulanan.', '/utility'],
      FNB: ['Buka kasir & jual menu pertama', 'Buka sesi kasir, pilih menu, terima pembayaran. Bahan sesuai resep terpotong otomatis.', '/pos'],
    };
    const steps: OnboardingStep[] = [
      {
        key: 'company',
        title: 'Lengkapi profil perusahaan',
        description: 'NPWP dan alamat tampil di faktur dan laporan pajak.',
        done: !!s.company,
        link: '/settings/company',
      },
      {
        key: 'standard',
        title: 'Tentukan standar akuntansi & pajak',
        description: 'Wizard mengukur ukuran usaha dari pembukuan lalu menyarankan SAK EMKM atau SAK EP, skema PPh, dan status PKP.',
        done: !!s.standard,
        link: '/settings/company?wizard=1',
        app: 'accounting',
      },
      {
        key: 'logo',
        title: 'Pasang logo & info rekening',
        description: 'Faktur, penawaran, dan surat jalan tampil lebih profesional.',
        done: !!s.logo,
        link: '/settings/company',
      },
      {
        key: 'products',
        title: productStep[model][0],
        description: productStep[model][1],
        done: !!s.products,
        link: '/products',
        app: ['inventory', 'sales', 'pos'],
      },
      {
        key: 'customers',
        title: 'Masukkan pelanggan',
        description: 'Data pelanggan dipakai untuk faktur, piutang, dan CRM.',
        done: !!s.customers,
        link: '/customers',
        app: ['sales', 'crm'],
      },
      {
        key: 'opening',
        title: 'Isi saldo awal',
        description: 'Saldo kas, bank, piutang, utang, dan stok awal agar laporan keuangan benar sejak hari pertama.',
        done: !!s.opening,
        link: '/opening-balance',
        app: 'accounting',
      },
      {
        key: 'users',
        title: 'Undang tim Anda',
        description: 'Buat akun untuk admin, sales, gudang, atau kasir — hak aksesnya diatur per peran.',
        done: Number(s.users) > 1,
        link: '/settings/users',
      },
      ...(isProductionModel(model)
        ? [
            {
              key: 'production',
              title: 'Buat resep & produksi pertama',
              description:
                model === 'MANUFAKTUR'
                  ? 'Susun resep bertingkat (bahan → barang setengah jadi → barang jadi), cek kebutuhan bahan, lalu jalankan perintah produksi — harga pokok dihitung otomatis.'
                  : model === 'FNB'
                    ? 'Susun resep tiap menu (bahan per porsi) di Produksi › Resep. Setelah itu menu yang terjual di kasir otomatis memotong bahan dan menghitung harga pokok.'
                    : 'Susun resep (bahan per batch), lalu jalankan perintah produksi — harga pokok produk jadi dihitung otomatis.',
              done: !!s.production,
              link: model === 'FNB' ? '/production/boms' : '/production/orders',
              app: 'inventory' as const,
            },
          ]
        : []),
      {
        key: 'sale',
        title: saleStep[model][0],
        description: saleStep[model][1],
        done: !!s.sale,
        link: saleStep[model][2],
        app: model === 'RITEL' || model === 'FNB' ? 'pos' : model === 'JASA' ? ['crm', 'sales'] : 'sales',
      },
      {
        key: 'security',
        title: 'Aktifkan verifikasi 2 langkah',
        description: 'Lindungi akun pemilik dengan kode dari HP.',
        done: !!s.security,
        link: '/account/security',
      },
    ];
    const { dismissed } = await this.settings.section(this.db, u.tenantId, 'onboarding', DEFAULTS);
    return { model, steps, done: steps.filter((x) => x.done).length, total: steps.length, dismissed };
  }

  /** Pengaturan yang relevan bagi jenis usaha perusahaan ini beserta status terisi/belum (dari data nyata) */
  async setup(u: AuthUser) {
    const model = await this.settings.businessModel(this.db, u.tenantId);
    const defs = MODEL_SETUP[model];
    const row = (await this.repo.queryModelSetup(this.db, u.tenantId, defs.map((d) => d.key))).rows[0] ?? {};
    const items = defs.map((d) => ({ ...d, done: row[d.key] === true }));
    return { model, name: BUSINESS_MODEL_BY_KEY[model].name, items, done: items.filter((i) => i.done).length, total: items.length };
  }

  async dismiss(u: AuthUser, dismissed: boolean) {
    await this.settings.saveSection(this.db, u.tenantId, 'onboarding', DEFAULTS, { dismissed });
    return this.status(u);
  }
}

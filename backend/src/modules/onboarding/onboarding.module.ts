import { Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { eq, sql } from 'drizzle-orm';
import { BUSINESS_MODEL_BY_KEY, BUSINESS_MODEL_KEYS, isProductionModel, type AppKey, type BusinessModel } from '@sansu/shared';
import { AppsService } from '../../common/apps/apps.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AllowWhenLocked } from '../../common/auth/platform-admin';
import { SettingsService } from '../../common/settings.service';
import { Db } from '../../db/db';
import { tenants } from '../../db/schema';
import { InjectDb } from '../../db/db.module';
import { syncChartOfAccounts } from '../accounting/coa-sync';

export class BusinessModelDto {
  @ApiProperty({ enum: BUSINESS_MODEL_KEYS }) @IsIn(BUSINESS_MODEL_KEYS) model: BusinessModel;
  @ApiProperty({
    required: false,
    description: 'Nyalakan aplikasi yang disarankan untuk model ini (aplikasi lain tidak dimatikan)',
  })
  @IsOptional()
  @IsBoolean()
  applyApps?: boolean;
}

export class DismissDto {
  @ApiProperty() @IsBoolean() dismissed: boolean;
}

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
  ) {}

  /** Perusahaan yang sudah punya transaksi atau dokumen tidak boleh berganti jenis usaha (data antar jenis usaha tidak boleh tercampur) */
  async hasTransactions(tenantId: string): Promise<boolean> {
    const checks = TRANSACTION_PROBES.map((t) => sql.raw(`SELECT 1 FROM "${t}" WHERE tenant_id = '${tenantId.replace(/'/g, '')}'`));
    const r = await this.db.execute<{ x: number }>(sql`SELECT 1 AS x WHERE ${sql.join(checks.map((c) => sql`EXISTS (${c})`), sql` OR `)}`);
    return r.rows.length > 0;
  }

  /** Jenis usaha sudah pernah dipilih secara sadar (bukan nilai bawaan perusahaan lama) */
  private async chosen(tenantId: string): Promise<boolean> {
    const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    return !!(t?.settings as { business?: { model?: string } } | null)?.business?.model;
  }

  async business(tenantId: string) {
    const model = await this.settings.businessModel(this.db, tenantId);
    const locked = (await this.chosen(tenantId)) && (await this.hasTransactions(tenantId));
    return { model, info: BUSINESS_MODEL_BY_KEY[model], locked };
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
    const r = await this.db.execute<Record<string, boolean | number | string | null>>(sql`
      SELECT
        (t.npwp IS NOT NULL AND t.npwp <> '' AND t.address IS NOT NULL AND t.address <> '') AS company,
        COALESCE(t.settings->'branding'->>'logo', '') <> '' AS logo,
        COALESCE(t.settings->'entityProfile'->>'appliedAt', '') <> '' AS standard,
        EXISTS (SELECT 1 FROM products p WHERE p.tenant_id = t.id) AS products,
        EXISTS (SELECT 1 FROM customers c WHERE c.tenant_id = t.id) AS customers,
        EXISTS (SELECT 1 FROM journal_entries j WHERE j.tenant_id = t.id
                AND (j.source_type = 'OPENING' OR (j.source_type = 'STOCK_ADJUSTMENT' AND j.description LIKE '%(OPENING)%'))) AS opening,
        (SELECT COUNT(*) FROM users x WHERE x.tenant_id = t.id AND x.is_active)::int AS users,
        (EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = t.id) OR EXISTS (SELECT 1 FROM pos_orders o WHERE o.tenant_id = t.id)) AS sale,
        (EXISTS (SELECT 1 FROM production_orders po WHERE po.tenant_id = t.id AND po.status = 'COMPLETED')
         OR EXISTS (SELECT 1 FROM pos_orders po2 JOIN pos_order_lines pl ON pl.order_id = po2.id WHERE po2.tenant_id = t.id AND pl.from_recipe)) AS production,
        EXISTS (SELECT 1 FROM users x WHERE x.id = ${u.sub} AND x.totp_enabled_at IS NOT NULL) AS security
      FROM tenants t WHERE t.id = ${u.tenantId}`);
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

  async dismiss(u: AuthUser, dismissed: boolean) {
    await this.settings.saveSection(this.db, u.tenantId, 'onboarding', DEFAULTS, { dismissed });
    return this.status(u);
  }
}

@ApiTags('Pengaturan')
@ApiBearerAuth()
@Roles('ADMIN')
@AllowWhenLocked()
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get()
  status(@CurrentUser() u: AuthUser) {
    return this.svc.status(u);
  }
  @HttpCode(200)
  @Post('dismiss')
  dismiss(@CurrentUser() u: AuthUser, @Body() dto: DismissDto) {
    return this.svc.dismiss(u, dto.dismissed);
  }
}

/** Model bisnis perusahaan (Dagang / Ritel / Jasa / Produksi) */
@ApiTags('Pengaturan')
@ApiBearerAuth()
@Controller('settings/business')
export class BusinessModelController {
  constructor(private readonly svc: OnboardingService) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.svc.business(u.tenantId);
  }
  @Put()
  @Roles('ADMIN')
  set(@CurrentUser() u: AuthUser, @Body() dto: BusinessModelDto) {
    return this.svc.setBusiness(u, dto);
  }
}

@Module({
  controllers: [OnboardingController, BusinessModelController],
  providers: [OnboardingService],
})
export class OnboardingModule {}

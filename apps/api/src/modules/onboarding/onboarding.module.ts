import { Body, Controller, Get, HttpCode, Injectable, Module, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { sql } from 'drizzle-orm';
import { BUSINESS_MODEL_BY_KEY, BUSINESS_MODEL_KEYS, type AppKey, type BusinessModel } from '@sansu/shared';
import { AppsService } from '../../common/apps/apps.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AllowWhenLocked } from '../../common/auth/platform-admin';
import { SettingsService } from '../../common/settings.service';
import { Db } from '../../db/db';
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

/** Daftar langkah awal untuk perusahaan baru — status terdeteksi otomatis dari data */
@Injectable()
export class OnboardingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly apps: AppsService,
    private readonly audit: AuditService,
  ) {}

  async business(tenantId: string) {
    const model = await this.settings.businessModel(this.db, tenantId);
    return { model, info: BUSINESS_MODEL_BY_KEY[model] };
  }

  async setBusiness(u: AuthUser, dto: BusinessModelDto) {
    await this.settings.saveSection(
      this.db,
      u.tenantId,
      'business',
      { model: 'DAGANG' as BusinessModel },
      { model: dto.model },
    );
    // Akun khusus jenis usaha yang baru ditambahkan; akun model sebelumnya tidak dihapus
    await this.db.transaction((tx) => syncChartOfAccounts(tx, u.tenantId));
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
        EXISTS (SELECT 1 FROM production_orders po WHERE po.tenant_id = t.id AND po.status = 'COMPLETED') AS production,
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
      PRODUKSI: ['Masukkan bahan baku & produk jadi', 'Daftarkan bahan yang dibeli dan produk yang dijual.'],
    };
    const saleStep: Record<BusinessModel, [string, string, string]> = {
      DAGANG: ['Catat penjualan pertama', 'Buat sales order, lalu jadikan faktur.', '/sales-orders/new'],
      RITEL: ['Buka kasir & jual pertama', 'Buka sesi kasir, scan barang, terima pembayaran.', '/pos'],
      JASA: [
        'Kirim tagihan jasa pertama',
        'Buat faktur jasa (bisa per termin proyek). PPh 23 / PPh 4(2) yang dipotong pelanggan dihitung otomatis.',
        '/invoices/services/new',
      ],
      PRODUKSI: ['Catat penjualan pertama', 'Buat sales order produk jadi, lalu jadikan faktur.', '/sales-orders/new'],
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
      ...(model === 'PRODUKSI'
        ? [
            {
              key: 'production',
              title: 'Buat resep & produksi pertama',
              description: 'Susun resep (bahan per batch), lalu jalankan perintah produksi — harga pokok produk jadi dihitung otomatis.',
              done: !!s.production,
              link: '/production/orders',
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
        app: model === 'RITEL' ? 'pos' : model === 'JASA' ? ['crm', 'sales'] : 'sales',
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

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TenantScopeInterceptor } from './common/db/tenant-scope.interceptor';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { ReadCacheInterceptor } from './common/read-cache.interceptor';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppGuard } from './common/apps/app.guard';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { SubscriptionGuard } from './common/billing/subscription.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { CommonModule } from './common/common.module';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { DbExceptionFilter } from './common/filters/db-exception.filter';
import { DbModule } from './db/db.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { PermissionsModule } from './common/auth/permissions';
import { CustomRolesModule } from './modules/platform/custom-roles';
import { AutoBookkeepingModule } from './modules/accounting/auto-bookkeeping.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardModule } from './modules/dashboard/dashboard';
import { RemindersModule } from './modules/reminders/reminders.module';
import { HealthModule } from './modules/health/health';
import { CashModule } from './modules/cash/cash.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { FxModule } from './modules/fx/fx.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { SalesModule } from './modules/sales/sales.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PosModule } from './modules/pos/pos.module';
import { PosTabsModule } from './modules/pos/pos-tabs.module';
import { PosOnlineModule } from './modules/pos/pos-online.module';
import { CrmModule } from './modules/crm/crm.module';
import { HrModule } from './modules/hr/hr.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { AssetsModule } from './modules/assets/assets.module';
import { InsightsModule } from './modules/insights/insights.module';
import { DeptReportsModule } from './modules/dept-reports/dept-reports.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { UtilityModule } from './modules/utility/utility.module';
import { UtilityFieldModule } from './modules/utility/utility-field.module';
import { StorageModule } from './common/storage/storage.service';
import { CardSettlementModule } from './modules/pos/pos-settlement.module';
import { BankModule } from './modules/bank/bank.module';
import { BranchesModule } from './modules/branches/branches.module';
import { DemoModule } from './modules/demo/demo.module';
import { TaxModule } from './modules/tax/tax.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ImportsModule } from './modules/imports/imports.module';
import { AuditLogModule } from './modules/audit/audit.module';
import { BillingModule } from './modules/billing/billing.module';
import { MarketplaceSyncModule } from './modules/integrations/marketplace/sync.module';
import { ProductionModule } from './modules/production/production.module';
import { MailModule } from './mail/mail.module';
import { DataRightsModule } from './modules/data-rights/data-rights.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: (cfg.get<string>('JWT_EXPIRES_IN') ?? '12h') as never },
      }),
    }),
    // Pembatas laju per alamat IP (anti-spam & tebak sandi). Default longgar; endpoint sensitif lebih ketat.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 600) }],
      skipIf: () => process.env.NODE_ENV === 'test' && !process.env.TEST_THROTTLE,
    }),
    DbModule,
    CommonModule,
    MailModule, // pengirim email via Brevo API (BREVO_API_KEY)
    // Modul domain — batas modul tegas (modular monolith)
    AuthModule,
    PermissionsModule,
    CustomRolesModule,
    MasterDataModule,
    AccountingModule,
    InventoryModule,
    ProductionModule,
    DataRightsModule,
    SalesModule,
    PurchasingModule,
    FxModule,
    ApprovalsModule,
    ReturnsModule,
    CashModule,
    PlatformModule,
    PosModule,
    PosTabsModule,
    PosOnlineModule,
    CrmModule,
    HrModule,
    PayrollModule,
    AutoBookkeepingModule,
    AssetsModule,
    InsightsModule,
    DeptReportsModule,
    OnboardingModule,
    WorkflowModule,
    UtilityModule,
    UtilityFieldModule,
    StorageModule,
    CardSettlementModule,
    TaxModule,
    BankModule,
    BranchesModule,
    DemoModule,
    IntegrationsModule,
    ImportsModule,
    AuditLogModule,
    BillingModule,
    MarketplaceSyncModule,
    DashboardModule,
    RemindersModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useExisting: AppGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    { provide: APP_FILTER, useClass: DbExceptionFilter },
    // seluruh query permintaan terautentikasi dibatasi ke perusahaan pengguna (row-level security) — harus paling luar
    { provide: APP_INTERCEPTOR, useClass: TenantScopeInterceptor },
    // kirim ulang dengan Idempotency-Key yang sama tidak menjalankan transaksi dua kali (jawaban pertama diputar ulang)
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    // jejak audit otomatis untuk setiap perubahan data
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // laporan: penjumlahan buku besar yang sama dihitung sekali per permintaan
    { provide: APP_INTERCEPTOR, useClass: ReadCacheInterceptor },
  ],
})
export class AppModule {}

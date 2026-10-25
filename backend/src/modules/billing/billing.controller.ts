import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { AllowWhenLocked, PlatformAdminGuard, platformAdminEmails } from '../../common/auth/platform-admin';
import { BillingSettings, SubscriptionService } from '../../common/billing/subscription.service';
import { appUrl, MailService } from '../../common/mail/mail.service';
import { collectMailFacts, evaluateMailSetup } from '../../common/mail/mail-check';
import { systemStatus, telegram } from '../../common/monitor/error-monitor';
import { activeGateway, midtrans, xendit } from './gateways';
import { BillingService } from './billing.service';
import { CreateBillingInvoiceDto, ProofDto, UpdateSubscriptionDto, RejectDto, PlanDto, BillingSettingsDto, TestEmailDto } from './billing.dto';
import { PlatformBillingService } from './platform-billing.service';

@ApiTags('Langganan')
@ApiBearerAuth()
@AllowWhenLocked()
@Controller('billing')
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  @Get()
  @Roles('ADMIN')
  overview(@CurrentUser() u: AuthUser) {
    return this.svc.overview(u);
  }
  @Get('support')
  support() {
    return this.svc.support();
  }
  @Get('invoices/:id')
  @Roles('ADMIN')
  invoice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.invoiceDoc(id, u.tenantId);
  }
  @Roles('ADMIN')
  @Post('invoices')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBillingInvoiceDto) {
    return this.svc.createInvoice(u, dto);
  }
  @Roles('ADMIN')
  @HttpCode(200)
  @Post('invoices/:id/pay')
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.payOnline(u, id);
  }
  @Roles('ADMIN')
  @HttpCode(200)
  @Post('invoices/:id/proof')
  proof(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProofDto) {
    return this.svc.submitProof(u, id, dto);
  }
  @Roles('ADMIN')
  @HttpCode(200)
  @Post('invoices/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelInvoice(u, id);
  }
}

@ApiTags('Langganan')
@Public()
@SkipThrottle()
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(private readonly svc: BillingService) {}

  @HttpCode(200)
  @Post('midtrans')
  midtrans(@Body() body: Record<string, string>) {
    return this.svc.handleNotice(midtrans.verify(body));
  }
  @HttpCode(200)
  @Post('xendit')
  xendit(@Headers('x-callback-token') token: string | undefined, @Body() body: Record<string, unknown>) {
    return this.svc.handleNotice(xendit.verify(token, body));
  }
}

@ApiTags('Panel Admin SANSU')
@ApiBearerAuth()
@AllowWhenLocked()
@UseGuards(PlatformAdminGuard)
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly svc: BillingService,
    private readonly subs: SubscriptionService,
    private readonly mail: MailService,
    private readonly platformBilling: PlatformBillingService,
  ) {}

  @Get('overview')
  overview() {
    return this.platformBilling.platformOverview();
  }
  @Get('pulse')
  pulse() {
    return this.platformBilling.platformPulse();
  }
  @Get('tenants')
  tenants(@Query('q') q?: string) {
    return this.platformBilling.platformTenants(q);
  }
  @Get('tenants/:id')
  tenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.platformBilling.platformTenant(id);
  }
  @Patch('tenants/:id/subscription')
  updateSub(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.platformBilling.updateSubscription(u, id, dto);
  }
  @Get('invoices')
  invoices(@Query('status') status?: string) {
    return this.platformBilling.platformInvoices(status);
  }
  @Get('invoices/:id')
  invoiceDoc(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.invoiceDoc(id);
  }
  @Get('vat-report')
  vatReport(@Query('month') month: string) {
    return this.svc.vatReport(month);
  }
  @Get('invoices/:id/proof')
  proof(@Param('id', ParseUUIDPipe) id: string) {
    return this.platformBilling.proof(id);
  }
  @HttpCode(200)
  @Post('invoices/:id/confirm')
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markPaid(id, u.email);
  }
  @HttpCode(200)
  @Post('invoices/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) {
    return this.platformBilling.reject(u, id, dto);
  }
  @Get('plans')
  plans() {
    return this.platformBilling.plansAll();
  }
  @Post('plans')
  createPlan(@Body() dto: PlanDto) {
    return this.platformBilling.createPlan(dto);
  }
  @Patch('plans/:id')
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanDto) {
    return this.platformBilling.updatePlan(id, dto);
  }
  @Get('settings')
  async settings() {
    return {
      ...(await this.subs.settings()),
      smtp: { configured: this.mail.configured, from: this.mail.from },
      gateway: activeGateway(),
      admins: platformAdminEmails(),
    };
  }
  @Put('settings')
  saveSettings(@Body() dto: BillingSettingsDto) {
    return this.subs.saveSettings(dto as Partial<BillingSettings>);
  }
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('test-email')
  async testEmail(@Body() dto: TestEmailDto) {
    try {
      await this.mail.send(
        {
          to: dto.to,
          subject: 'Email uji dari SANSU',
          heading: 'Email berhasil terkirim',
          paragraphs: [
            'Pengaturan SMTP SANSU sudah benar. Email reset sandi, verifikasi, dan tagihan akan terkirim seperti ini.',
          ],
        },
        true,
      );
    } catch (e) {
      // Tampilkan sebab sebenarnya (bukan "kesalahan server 500") agar pemilik layanan tahu apa yang harus diperbaiki
      throw new BadRequestException(`Email uji gagal dikirim: ${(e as Error).message}`.slice(0, 400));
    }
    return { ok: true };
  }
  /** Periksa kesiapan email agar tidak masuk spam: domain pengirim, SPF, DKIM, DMARC, alamat aplikasi */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('mail-check')
  async mailCheck() {
    const facts = await collectMailFacts(this.mail.from, appUrl(), this.mail.configured);
    return { from: this.mail.from, domain: facts.domain, checks: evaluateMailSetup(facts) };
  }
  @Get('system')
  system() {
    return systemStatus(this.svc.database);
  }
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('test-alert')
  async testAlert() {
    const ok = await telegram('✅ Uji peringatan SANSU: notifikasi Telegram sudah tersambung.');
    if (!ok)
      throw new BadRequestException(
        'Telegram belum diatur atau token/chat ID salah (TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID di file .env server).',
      );
    return { ok };
  }
  @HttpCode(200)
  @Post('run-reminders')
  runReminders() {
    return this.svc.runReminders();
  }
}

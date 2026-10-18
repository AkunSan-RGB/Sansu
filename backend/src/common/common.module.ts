import { ErrorMonitor } from './monitor/error-monitor';
import { Global, Module } from '@nestjs/common';
import { AppGuard } from './apps/app.guard';
import { AppsService } from './apps/apps.service';
import { AuditService } from './audit/audit.service';
import { PeriodService } from './period/period.service';
import { SequenceService } from './sequence/sequence.service';
import { SettingsService } from './settings.service';
import { MailService } from './mail/mail.service';
import { SubscriptionService } from './billing/subscription.service';
import { TwoFactorPolicy } from './auth/two-factor-policy';
import { ApprovalsService } from './approvals/approvals.service';
import { TelegramController } from './telegram/telegram.controller';
import { TelegramService } from './telegram/telegram.service';

@Global()
@Module({
  controllers: [TelegramController],
  providers: [TelegramService, ApprovalsService, SequenceService, AuditService, PeriodService, AppsService, AppGuard, SettingsService, MailService, SubscriptionService, TwoFactorPolicy, ErrorMonitor],
  exports: [TelegramService, ApprovalsService, SequenceService, AuditService, PeriodService, AppsService, AppGuard, SettingsService, MailService, SubscriptionService, TwoFactorPolicy, ErrorMonitor],
})
export class CommonModule {}

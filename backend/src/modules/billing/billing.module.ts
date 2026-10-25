import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../../common/auth/platform-admin';
import { BillingController, BillingWebhookController, PlatformAdminController } from './billing.controller';
import { BillingService, BillingScheduler } from './billing.service';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformBillingRepository } from './platform-billing.repository';
import { BillingRepository } from './billing.repository';

@Module({
  controllers: [BillingController, BillingWebhookController, PlatformAdminController],
  providers: [BillingRepository, PlatformBillingRepository, BillingService, PlatformBillingService, BillingScheduler, PlatformAdminGuard],
  exports: [BillingService, PlatformBillingService],
})
export class BillingModule {}

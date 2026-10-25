import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations.module';
import { MarketplaceSyncController, MarketplaceOAuthController } from './sync.controller';
import { MarketplaceSyncService, MarketplaceScheduler } from './sync.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [MarketplaceSyncController, MarketplaceOAuthController],
  providers: [MarketplaceSyncService, MarketplaceScheduler],
})
export class MarketplaceSyncModule {}

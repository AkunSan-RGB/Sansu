import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations.module';
import { MarketplaceSyncController, MarketplaceOAuthController } from './sync.controller';
import { MarketplaceSyncService, MarketplaceScheduler } from './sync.service';
import { SyncRepository } from './sync.repository';

@Module({
  imports: [IntegrationsModule],
  controllers: [MarketplaceSyncController, MarketplaceOAuthController],
  providers: [SyncRepository, MarketplaceSyncService, MarketplaceScheduler],
})
export class MarketplaceSyncModule {}

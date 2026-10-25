import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { PosTabsModule } from './pos-tabs.module';
import { PosOnlineController, InboundOrdersController } from './pos-online.controller';
import { OnlineSettingsService, OnlineKeysService, PlatformSettlementsService, OnlineKeyGuard } from './pos-online.service';
import { PosOnlineRepository } from './pos-online.repository';

@Module({
  imports: [AccountingModule, PosTabsModule],
  controllers: [PosOnlineController, InboundOrdersController],
  providers: [PosOnlineRepository, OnlineSettingsService, OnlineKeysService, PlatformSettlementsService, OnlineKeyGuard],
})
export class PosOnlineModule {}

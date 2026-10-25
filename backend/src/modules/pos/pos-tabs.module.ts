import { Module } from '@nestjs/common';
import { PosModule } from './pos.module';
import { PosTabsController } from './pos-tabs.controller';
import { PosTabsService } from './pos-tabs.service';
import { PosTabRepository } from './pos-tab.repository';

@Module({ imports: [PosModule], controllers: [PosTabsController], providers: [PosTabRepository, PosTabsService], exports: [PosTabsService] })
export class PosTabsModule {}

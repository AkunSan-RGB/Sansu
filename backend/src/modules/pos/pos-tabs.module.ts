import { Module } from '@nestjs/common';
import { PosModule } from './pos.module';
import { PosTabsController } from './pos-tabs.controller';
import { PosTabsService } from './pos-tabs.service';

@Module({ imports: [PosModule], controllers: [PosTabsController], providers: [PosTabsService], exports: [PosTabsService] })
export class PosTabsModule {}

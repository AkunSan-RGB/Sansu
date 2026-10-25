import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { UtilityController } from './utility.controller';
import { UtilityService } from './utility.service';

@Module({ imports: [SalesModule], controllers: [UtilityController], providers: [UtilityService], exports: [UtilityService] })
export class UtilityModule {}

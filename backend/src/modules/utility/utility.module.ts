import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SalesModule } from '../sales/sales.module';
import { UtilityController } from './utility.controller';
import { UtilityService } from './utility.service';
import { UtilityRepository } from './utility.repository';

@Module({ imports: [SalesModule, AccountingModule], controllers: [UtilityController], providers: [UtilityRepository, UtilityService], exports: [UtilityService] })
export class UtilityModule {}

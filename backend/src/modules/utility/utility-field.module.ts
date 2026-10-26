import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SalesModule } from '../sales/sales.module';
import { UtilityModule } from './utility.module';
import { UtilityFieldController, UtilityIngestController } from './utility-field.controller';
import { UtilityFieldService, UtilityIngestGuard } from './utility-field.service';
import { UtilityFieldRepository } from './utility-field.repository';
import { UtilityChargesRepository } from './utility-charges.repository';
import { UtilityChargesService } from './utility-charges.service';
import { UtilityCountersController } from './utility-counters.controller';
import { UtilityCountersRepository } from './utility-counters.repository';
import { UtilityCountersService } from './utility-counters.service';

@Module({
  imports: [UtilityModule, SalesModule, AccountingModule],
  controllers: [UtilityFieldController, UtilityCountersController, UtilityIngestController],
  providers: [UtilityFieldRepository, UtilityFieldService, UtilityIngestGuard, UtilityChargesRepository, UtilityChargesService, UtilityCountersRepository, UtilityCountersService],
  exports: [UtilityChargesService, UtilityFieldService],
})
export class UtilityFieldModule {}

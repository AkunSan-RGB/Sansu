import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SalesModule } from '../sales/sales.module';
import { UtilityModule } from './utility.module';
import { UtilityFieldController, UtilityIngestController } from './utility-field.controller';
import { UtilityFieldService, UtilityIngestGuard } from './utility-field.service';

@Module({
  imports: [UtilityModule, SalesModule, AccountingModule],
  controllers: [UtilityFieldController, UtilityIngestController],
  providers: [UtilityFieldService, UtilityIngestGuard],
})
export class UtilityFieldModule {}

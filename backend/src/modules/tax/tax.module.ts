import { TaxFocusService } from './tax-focus';
import { AccountingControlsController } from './accounting-controls.controller';
import { AccountingControlsService } from './accounting-controls.service';
import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InsightsModule } from '../insights/insights.module';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';
import { TaxRepository } from './tax.repository';

@Module({
  imports: [AccountingModule, InsightsModule],
  controllers: [TaxController, AccountingControlsController],
  providers: [TaxRepository, TaxService, TaxFocusService, AccountingControlsService],
  exports: [TaxService],
})
export class TaxModule {}

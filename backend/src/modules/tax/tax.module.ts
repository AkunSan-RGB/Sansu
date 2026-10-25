import { TaxFocusService } from './tax-focus';
import { AccountingControlsController, AccountingControlsService } from './accounting-controls';
import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InsightsModule } from '../insights/insights.module';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';

@Module({
  imports: [AccountingModule, InsightsModule],
  controllers: [TaxController, AccountingControlsController],
  providers: [TaxService, TaxFocusService, AccountingControlsService],
  exports: [TaxService],
})
export class TaxModule {}

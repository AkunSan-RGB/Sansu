import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { PayrollModule } from '../payroll/payroll.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AutoBookkeepingController } from './auto-bookkeeping.controller';
import { AutoBookkeepingService, AutoBookkeepingScheduler } from './auto-bookkeeping.service';

@Module({
  imports: [AccountingModule, PayrollModule, FxModule],
  controllers: [AutoBookkeepingController],
  providers: [AutoBookkeepingService, AutoBookkeepingScheduler],
  exports: [AutoBookkeepingService],
})
export class AutoBookkeepingModule {}

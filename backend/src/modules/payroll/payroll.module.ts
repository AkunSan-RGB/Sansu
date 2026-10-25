import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { ServiceWorkController } from './service-work.controller';
import { ServiceWorkService } from './service-work.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { ServiceWorkRepository } from './service-work.repository';
import { PayrollRepository } from './payroll.repository';

@Module({
  imports: [AccountingModule],
  controllers: [PayrollController, ServiceWorkController],
  providers: [PayrollRepository, ServiceWorkRepository, PayrollService, ServiceWorkService],
  exports: [PayrollService],
})
export class PayrollModule {}

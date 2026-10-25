import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmRepository } from './crm.repository';

@Module({
  imports: [SalesModule],
  controllers: [CrmController],
  providers: [CrmRepository, CrmService],
})
export class CrmModule {}

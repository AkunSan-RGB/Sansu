import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { BankController } from './bank.controller';
import { BankService } from './bank.service';

@Module({
  imports: [AccountingModule],
  controllers: [BankController],
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}

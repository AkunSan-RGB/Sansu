import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { BankController } from './bank.controller';
import { BankService } from './bank.service';
import { BankRepository } from './bank.repository';

@Module({
  imports: [AccountingModule],
  controllers: [BankController],
  providers: [BankRepository, BankService],
  exports: [BankService],
})
export class BankModule {}

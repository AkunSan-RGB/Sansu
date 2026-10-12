import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { AdjustmentsService } from './adjustments.service';
import { PostingService } from './posting.service';
import { StatementsService } from './statements.service';

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, PostingService, StatementsService, AdjustmentsService],
  exports: [PostingService, AccountingService, StatementsService],
})
export class AccountingModule {}

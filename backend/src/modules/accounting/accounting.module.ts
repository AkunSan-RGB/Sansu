import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { AdjustmentsService } from './adjustments.service';
import { BudgetController, BudgetScheduler, BudgetService } from './budget';
import { PostingService } from './posting.service';
import { StatementsService } from './statements.service';

@Module({
  controllers: [AccountingController, BudgetController],
  providers: [AccountingService, PostingService, StatementsService, AdjustmentsService, BudgetService, BudgetScheduler],
  exports: [PostingService, AccountingService, StatementsService, BudgetService],
})
export class AccountingModule {}

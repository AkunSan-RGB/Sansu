import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingRepository } from './accounting.repository';
import { AccountingService } from './accounting.service';
import { RecurringJournalsService } from './recurring-journals.service';
import { AdjustmentsService } from './adjustments.service';
import { BudgetController } from './budget.controller';
import { BudgetScheduler, BudgetService } from './budget.service';
import { FinancialReportsService } from './financial-reports.service';
import { PostingService } from './posting.service';
import { StatementsService } from './statements.service';

@Module({
  controllers: [AccountingController, BudgetController],
  providers: [AccountingRepository, AccountingService, RecurringJournalsService, FinancialReportsService, PostingService, StatementsService, AdjustmentsService, BudgetService, BudgetScheduler],
  exports: [PostingService, AccountingService, RecurringJournalsService, FinancialReportsService, StatementsService, BudgetService],
})
export class AccountingModule {}

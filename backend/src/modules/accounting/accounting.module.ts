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
import { BudgetRepository } from './budget.repository';
import { RecurringJournalsRepository } from './recurring-journals.repository';
import { PostingRepository } from './posting.repository';
import { StatementsRepository } from './statements.repository';
import { FinancialReportsRepository } from './financial-reports.repository';
import { AdjustmentsRepository } from './adjustments.repository';

@Module({
  controllers: [AccountingController, BudgetController],
  providers: [AdjustmentsRepository, FinancialReportsRepository, StatementsRepository, PostingRepository, RecurringJournalsRepository, BudgetRepository, AccountingRepository, AccountingService, RecurringJournalsService, FinancialReportsService, PostingService, StatementsService, AdjustmentsService, BudgetService, BudgetScheduler],
  exports: [PostingService, AccountingService, RecurringJournalsService, FinancialReportsService, StatementsService, BudgetService],
})
export class AccountingModule {}

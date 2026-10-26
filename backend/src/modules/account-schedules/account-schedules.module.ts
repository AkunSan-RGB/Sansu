import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { BankModule } from '../bank/bank.module';
import { ScheduleRegistry } from './account-schedule.registry';
import { AccountSchedulesController } from './account-schedules.controller';
import { AccountSchedulesRepository } from './account-schedules.repository';
import { AccountSchedulesService } from './account-schedules.service';
import { ReportSnapshotsRepository } from './report-snapshots.repository';
import { ReportSnapshotsService } from './report-snapshots.service';
import { ReportedBalanceService } from './reported-balances.service';
import { BankReconciliationSchedule } from './schedules/bank.schedule';
import { DepreciationExpenseSchedule, FixedAssetAccumulatedSchedule, FixedAssetCostSchedule } from './schedules/fixed-asset.schedules';
import { InventorySchedule } from './schedules/inventory.schedule';
import { PayableSchedule, ReceivableSchedule } from './schedules/party.schedules';
import { CashSchedule, CostOfSalesSchedule, ExpenseSchedule, RevenueSchedule, TaxSchedule } from './schedules/profile.schedules';
import { ContractExtras } from './schedules/contract-extras';
import { FinancingContractsController } from './financing-contracts.controller';
import { FinancingContractsRepository } from './financing-contracts.repository';
import { FinancingContractsService } from './financing-contracts.service';
import { AccrualSchedule, DeferredRevenueSchedule, EquitySchedule, GenericSchedule, LeaseSchedule, LoanSchedule, PrepaidSchedule } from './schedules/journal-item.schedules';
import { UnclosedEarningsSchedule } from './schedules/unclosed-earnings.schedule';

@Module({
  imports: [AccountingModule, BankModule],
  controllers: [AccountSchedulesController, FinancingContractsController],
  providers: [
    AccountSchedulesRepository,
    AccountSchedulesService,
    ReportSnapshotsRepository,
    ReportSnapshotsService,
    ReportedBalanceService,
    ScheduleRegistry,
    UnclosedEarningsSchedule,
    FixedAssetCostSchedule,
    FixedAssetAccumulatedSchedule,
    DepreciationExpenseSchedule,
    ReceivableSchedule,
    PayableSchedule,
    InventorySchedule,
    BankReconciliationSchedule,
    CashSchedule,
    TaxSchedule,
    PrepaidSchedule,
    AccrualSchedule,
    DeferredRevenueSchedule,
    LeaseSchedule,
    LoanSchedule,
    ContractExtras,
    FinancingContractsRepository,
    FinancingContractsService,
    EquitySchedule,
    CostOfSalesSchedule,
    RevenueSchedule,
    ExpenseSchedule,
    GenericSchedule,
  ],
})
export class AccountSchedulesModule {}

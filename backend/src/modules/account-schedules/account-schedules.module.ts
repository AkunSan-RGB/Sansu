import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { BankModule } from '../bank/bank.module';
import { ScheduleRegistry } from './account-schedule.registry';
import { AccountSchedulesController } from './account-schedules.controller';
import { AccountSchedulesRepository } from './account-schedules.repository';
import { AccountSchedulesService } from './account-schedules.service';
import { ReportedBalanceService } from './reported-balances.service';
import { BankReconciliationSchedule } from './schedules/bank.schedule';
import { DepreciationExpenseSchedule, FixedAssetAccumulatedSchedule, FixedAssetCostSchedule } from './schedules/fixed-asset.schedules';
import { InventorySchedule } from './schedules/inventory.schedule';
import { PayableSchedule, ReceivableSchedule } from './schedules/party.schedules';
import { CashSchedule, CostOfSalesSchedule, ExpenseSchedule, RevenueSchedule, TaxSchedule } from './schedules/profile.schedules';
import { AllowanceSchedule, DeferredTaxSchedule, EmployeeBenefitSchedule, FxRevaluationSchedule, InventoryOtherSchedule, OtherAssetSchedule, OtherLiabilitySchedule, OtherTaxSchedule } from './schedules/specific.schedules';
import { FxModule } from '../fx/fx.module';
import { AccrualSchedule, DeferredRevenueSchedule, EquitySchedule, GenericSchedule, LoanSchedule, PrepaidSchedule } from './schedules/journal-item.schedules';
import { UnclosedEarningsSchedule } from './schedules/unclosed-earnings.schedule';

@Module({
  imports: [AccountingModule, BankModule, FxModule],
  controllers: [AccountSchedulesController],
  providers: [
    AccountSchedulesRepository,
    AccountSchedulesService,
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
    LoanSchedule,
    EquitySchedule,
    CostOfSalesSchedule,
    RevenueSchedule,
    ExpenseSchedule,
    GenericSchedule,
    FxRevaluationSchedule,
    InventoryOtherSchedule,
    AllowanceSchedule,
    DeferredTaxSchedule,
    EmployeeBenefitSchedule,
    OtherTaxSchedule,
    OtherAssetSchedule,
    OtherLiabilitySchedule,
  ],
})
export class AccountSchedulesModule {}

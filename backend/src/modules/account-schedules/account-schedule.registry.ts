import { Injectable } from '@nestjs/common';
import type { AccountMeta } from '../accounting/ledger-data';
import type { AccountSchedule, ScheduleCatalog } from './account-schedule.types';
import { BankReconciliationSchedule } from './schedules/bank.schedule';
import { DepreciationExpenseSchedule, FixedAssetAccumulatedSchedule, FixedAssetCostSchedule } from './schedules/fixed-asset.schedules';
import { InventorySchedule } from './schedules/inventory.schedule';
import { ReceivableSchedule, PayableSchedule } from './schedules/party.schedules';
import { CashSchedule, CostOfSalesSchedule, ExpenseSchedule, RevenueSchedule, TaxSchedule } from './schedules/profile.schedules';
import { AccrualSchedule, DeferredRevenueSchedule, EquitySchedule, GenericSchedule, LeaseSchedule, LoanSchedule, PrepaidSchedule } from './schedules/journal-item.schedules';
import { UnclosedEarningsSchedule } from './schedules/unclosed-earnings.schedule';

/**
 * Menjodohkan akun dengan jadwalnya: jadwal pertama (urutan dari yang paling khusus) yang `supports` akun itu.
 * GenericSchedule di urutan terakhir menerima semua akun, jadi akun baru selalu punya jadwal tanpa perubahan kode.
 */
@Injectable()
export class ScheduleRegistry {
  private readonly ordered: AccountSchedule[];

  constructor(
    unclosed: UnclosedEarningsSchedule,
    assetCost: FixedAssetCostSchedule,
    assetAccumulated: FixedAssetAccumulatedSchedule,
    depreciation: DepreciationExpenseSchedule,
    receivable: ReceivableSchedule,
    payable: PayableSchedule,
    inventory: InventorySchedule,
    bank: BankReconciliationSchedule,
    cash: CashSchedule,
    tax: TaxSchedule,
    prepaid: PrepaidSchedule,
    accrual: AccrualSchedule,
    deferred: DeferredRevenueSchedule,
    lease: LeaseSchedule,
    loan: LoanSchedule,
    equity: EquitySchedule,
    costOfSales: CostOfSalesSchedule,
    revenue: RevenueSchedule,
    expense: ExpenseSchedule,
    generic: GenericSchedule,
  ) {
    this.ordered = [unclosed, assetCost, assetAccumulated, depreciation, receivable, payable, inventory, bank, cash, tax, prepaid, accrual, deferred, lease, loan, equity, costOfSales, revenue, expense, generic];
  }

  resolve(account: AccountMeta, catalog: ScheduleCatalog): AccountSchedule {
    return this.ordered.find((s) => s.supports(account, catalog))!;
  }
}

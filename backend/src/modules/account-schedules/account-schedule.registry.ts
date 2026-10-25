import { Injectable } from '@nestjs/common';
import type { AccountMeta } from '../accounting/ledger-data';
import type { AccountSchedule, ScheduleCatalog } from './account-schedule.types';
import { DepreciationExpenseSchedule, FixedAssetAccumulatedSchedule, FixedAssetCostSchedule } from './schedules/fixed-asset.schedules';
import { InventorySchedule } from './schedules/inventory.schedule';
import { ReceivableSchedule, PayableSchedule } from './schedules/party.schedules';
import { CashSchedule, CostOfSalesSchedule, EquitySchedule, ExpenseSchedule, GenericSchedule, RevenueSchedule, TaxSchedule } from './schedules/profile.schedules';
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
    cash: CashSchedule,
    tax: TaxSchedule,
    equity: EquitySchedule,
    costOfSales: CostOfSalesSchedule,
    revenue: RevenueSchedule,
    expense: ExpenseSchedule,
    generic: GenericSchedule,
  ) {
    this.ordered = [unclosed, assetCost, assetAccumulated, depreciation, receivable, payable, inventory, cash, tax, equity, costOfSales, revenue, expense, generic];
  }

  resolve(account: AccountMeta, catalog: ScheduleCatalog): AccountSchedule {
    return this.ordered.find((s) => s.supports(account, catalog))!;
  }
}

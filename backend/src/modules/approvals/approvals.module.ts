import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { SalesModule } from '../sales/sales.module';
import { ReturnsModule } from '../returns/returns.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { AssetsModule } from '../assets/assets.module';
import { CashModule } from '../cash/cash.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ApprovalsController, PublicApprovalLinksController } from './approvals.controller';
import { ApprovalRequestsService } from './approvals.service';

@Module({
  imports: [AccountingModule, PurchasingModule, AssetsModule, CashModule, InventoryModule, SalesModule, ReturnsModule, MasterDataModule],
  controllers: [ApprovalsController, PublicApprovalLinksController],
  providers: [ApprovalRequestsService],
})
export class ApprovalsModule {}

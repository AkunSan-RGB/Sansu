import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetsModule } from '../assets/assets.module';
import { FxModule } from '../fx/fx.module';
import { ForeignCashTxService } from './foreign-cash-tx.service';
import { CashCountController } from './cash-count.controller';
import { CashCountService } from './cash-count.service';
import { PettyCashController } from './petty-cash.controller';
import { PettyCashService } from './petty-cash.service';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';
import { CashCountRepository } from './cash-count.repository';
import { CashRepository } from './cash.repository';
import { PettyCashRepository } from './petty-cash.repository';

@Module({
  imports: [AccountingModule, AssetsModule, FxModule],
  controllers: [CashController, CashCountController, PettyCashController],
  providers: [PettyCashRepository, CashRepository, CashCountRepository, CashService, ForeignCashTxService, CashCountService, PettyCashService],
  exports: [CashService, PettyCashService],
})
export class CashModule {}

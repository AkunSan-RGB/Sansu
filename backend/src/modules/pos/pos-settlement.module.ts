import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { CardSettlementController } from './pos-settlement.controller';
import { CardSettlementService } from './pos-settlement.service';

@Module({ imports: [AccountingModule], controllers: [CardSettlementController], providers: [CardSettlementService], exports: [CardSettlementService] })
export class CardSettlementModule {}

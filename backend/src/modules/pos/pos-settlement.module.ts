import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { CardSettlementController } from './pos-settlement.controller';
import { CardSettlementService } from './pos-settlement.service';
import { PosSettlementRepository } from './pos-settlement.repository';

@Module({ imports: [AccountingModule], controllers: [CardSettlementController], providers: [PosSettlementRepository, CardSettlementService], exports: [CardSettlementService] })
export class CardSettlementModule {}

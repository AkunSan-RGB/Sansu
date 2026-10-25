import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

@Module({ imports: [AccountingModule], controllers: [LoyaltyController], providers: [LoyaltyService], exports: [LoyaltyService] })
export class LoyaltyModule {}

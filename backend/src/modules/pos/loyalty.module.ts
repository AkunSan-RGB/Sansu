import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyRepository } from './loyalty.repository';

@Module({ imports: [AccountingModule], controllers: [LoyaltyController], providers: [LoyaltyRepository, LoyaltyService], exports: [LoyaltyService] })
export class LoyaltyModule {}

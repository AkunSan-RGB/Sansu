import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';
import { FxRepository } from './fx.repository';

@Module({
  imports: [AccountingModule],
  controllers: [FxController],
  providers: [FxRepository, FxService],
  exports: [FxService],
})
export class FxModule {}

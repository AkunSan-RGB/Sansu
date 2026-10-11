import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';

@Module({
  imports: [AccountingModule],
  controllers: [FxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}

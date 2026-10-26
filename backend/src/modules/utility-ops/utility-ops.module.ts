import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SalesModule } from '../sales/sales.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { UtilityFieldModule } from '../utility/utility-field.module';
import { UtilityModule } from '../utility/utility.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsRepository } from './applications.repository';
import { ApplicationsService } from './applications.service';
import { ChangesController } from './changes.controller';
import { ChangesRepository } from './changes.repository';
import { ChangesService } from './changes.service';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsRepository } from './complaints.repository';
import { ComplaintsService } from './complaints.service';
import { NetworkAssetsController } from './network-assets.controller';
import { NetworkAssetsRepository } from './network-assets.repository';
import { NetworkAssetsService } from './network-assets.service';
import { StaffController } from './staff.controller';
import { StaffRepository } from './staff.repository';
import { StaffService } from './staff.service';

@Module({
  imports: [UtilityModule, UtilityFieldModule, MasterDataModule, SalesModule, AccountingModule],
  controllers: [StaffController, ComplaintsController, NetworkAssetsController, ApplicationsController, ChangesController],
  providers: [StaffRepository, StaffService, ComplaintsRepository, ComplaintsService, NetworkAssetsRepository, NetworkAssetsService, ApplicationsRepository, ApplicationsService, ChangesRepository, ChangesService],
})
export class UtilityOpsModule {}

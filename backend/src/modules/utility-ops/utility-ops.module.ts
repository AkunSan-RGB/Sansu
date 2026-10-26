import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SalesModule } from '../sales/sales.module';
import { DepositsController } from './deposits.controller';
import { DepositsRepository } from './deposits.repository';
import { DepositsService } from './deposits.service';
import { InstallmentsController } from './installments.controller';
import { InstallmentsRepository } from './installments.repository';
import { InstallmentsService } from './installments.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { UtilityFieldModule } from '../utility/utility-field.module';
import { UtilityModule } from '../utility/utility.module';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentsRepository } from './adjustments.repository';
import { AdjustmentsService } from './adjustments.service';
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
import { MetersController } from './meters.controller';
import { MetersRepository } from './meters.repository';
import { MetersService } from './meters.service';
import { RoutesController } from './routes.controller';
import { RoutesRepository } from './routes.repository';
import { RoutesService } from './routes.service';
import { StaffController } from './staff.controller';
import { StaffRepository } from './staff.repository';
import { StaffService } from './staff.service';

@Module({
  imports: [UtilityModule, UtilityFieldModule, MasterDataModule, SalesModule, AccountingModule],
  controllers: [StaffController, ComplaintsController, NetworkAssetsController, ApplicationsController, ChangesController, AdjustmentsController, DepositsController, InstallmentsController, RoutesController, MetersController],
  providers: [StaffRepository, StaffService, ComplaintsRepository, ComplaintsService, NetworkAssetsRepository, NetworkAssetsService, ApplicationsRepository, ApplicationsService, ChangesRepository, ChangesService, AdjustmentsRepository, AdjustmentsService, DepositsRepository, DepositsService, InstallmentsRepository, InstallmentsService, RoutesRepository, RoutesService, MetersRepository, MetersService],
})
export class UtilityOpsModule {}

import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { Module } from '@nestjs/common';
import { EmploymentController } from './employment.controller';
import { EmploymentService } from './employment.service';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

@Module({
  controllers: [HrController, EmploymentController, ShiftsController],
  providers: [HrService, EmploymentService, ShiftsService],
  exports: [HrService, EmploymentService],
})
export class HrModule {}

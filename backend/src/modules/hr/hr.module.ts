import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { Module } from '@nestjs/common';
import { EmploymentController } from './employment.controller';
import { EmploymentService } from './employment.service';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { ShiftsRepository } from './shifts.repository';
import { EmploymentRepository } from './employment.repository';
import { HrRepository } from './hr.repository';

@Module({
  controllers: [HrController, EmploymentController, ShiftsController],
  providers: [HrRepository, EmploymentRepository, ShiftsRepository, HrService, EmploymentService, ShiftsService],
  exports: [HrService, EmploymentService],
})
export class HrModule {}

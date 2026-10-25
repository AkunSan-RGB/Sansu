import { Module } from '@nestjs/common';
import { DeptReportsController } from './dept-reports.controller';
import { DeptReportsService } from './dept-reports.service';

@Module({ controllers: [DeptReportsController], providers: [DeptReportsService] })
export class DeptReportsModule {}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { DeptReportsService } from './dept-reports.service';
import { DeptRangeQuery } from './dept-reports.shared';

@ApiTags('Laporan bagian')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('dept-reports')
export class DeptReportsController {
  constructor(private readonly svc: DeptReportsService) {}

  @RequireApp('sales') @Get('sales') sales(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'sales', q); }
  @RequireApp('purchase') @Get('purchases') purchases(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'purchases', q); }
  @RequireApp('inventory') @Get('inventory') inventory(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'inventory', q); }
  @RequireApp('cash') @Get('cash') cash(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'cash', q); }
  @RequireApp('pos') @Get('pos') pos(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'pos', q); }
  @RequireApp('pos') @Get('fnb') fnb(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'fnb', q); }
  @RequireApp('sales') @Get('fmcg') fmcg(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'fmcg', q); }
  @RequireApp('inventory') @Get('mfg') mfg(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'mfg', q); }
  @RequireApp('sales') @Get('jasa') jasa(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'jasa', q); }
  @RequireApp('sales') @Get('jasa-konsultan') jasaKonsultan(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'jasa-konsultan', q); }
  @RequireApp('sales') @Get('jasa-kontraktor') jasaKontraktor(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'jasa-kontraktor', q); }
  @RequireApp('sales') @Get('jasa-pendidikan') jasaPendidikan(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'jasa-pendidikan', q); }
  @RequireApp('sales') @Get('jasa-alihdaya') jasaAlihDaya(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'jasa-alihdaya', q); }
  @RequireApp('sales') @Get('jasa-bengkel') jasaBengkel(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'jasa-bengkel', q); }
  @RequireApp('utility') @Get('utility') utility(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'utility', q); }
  @RequireApp('utility') @Get('utility-kinerja') utilityKinerja(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'utility-kinerja', q); }
  @RequireApp('utility') @Get('utility-nonair') utilityNonAir(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'utility-nonair', q); }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'HR') @RequireApp('hr') @Get('hr') hr(@CurrentUser() u: AuthUser, @Query() q: DeptRangeQuery) { return this.svc.build(u, 'hr', q); }
}

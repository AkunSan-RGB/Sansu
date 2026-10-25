import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { todayJakarta } from '../../common/utils/dates';
import { summarize } from './insight-rules';
import { DashboardInsightsService } from './dashboard-insights.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardInsightsController {
  constructor(private readonly svc: DashboardInsightsService) {}

  @Get('insights')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  insights(@CurrentUser() u: AuthUser) {
    // data perusahaan utuh, bukan per cabang (sama dengan daftar "perlu perhatian")
    if (u.branchIds?.length) return { asOf: todayJakarta(), summary: summarize([]), trend: [], insights: [], note: 'Saran tersedia untuk akun tingkat perusahaan.' };
    return this.svc.build(u.tenantId);
  }
}

import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { scopeBranch } from '../../common/auth/branch-access';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { DashboardService } from './dashboard.service';
import { ProfileKpiService } from './profile-kpis.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly svc: DashboardService,
    private readonly profileKpis: ProfileKpiService,
  ) {}

  /** Ubin KPI khas profil layanan (Jasa); data perusahaan utuh sehingga hanya untuk pimpinan dan keuangan */
  @Get('profile-kpis')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  profileKpiTiles(@CurrentUser() u: AuthUser) {
    if (u.branchIds?.length) return { tiles: [] };
    return this.profileKpis.tiles(u.tenantId);
  }

  @Get()
  summary(@CurrentUser() u: AuthUser, @Query('branchId') branchId?: string) {
    if (branchId && !/^(NONE|[0-9a-f-]{36})$/i.test(branchId)) throw new BadRequestException('branchId tidak valid');
    return this.svc.summary(u.tenantId, u.role, scopeBranch(u, branchId));
  }

  @Get('attention')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  attention(@CurrentUser() u: AuthUser) {
    if (u.branchIds?.length) return { score: null, grade: null, items: [] }; // data perusahaan utuh, bukan per cabang
    return this.svc.attention(u.tenantId);
  }
}

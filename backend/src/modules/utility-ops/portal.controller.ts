import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { PortalComplaintDto } from './portal.dto';
import { PortalScope, PortalService, UtilityPortalGuard } from './portal.service';

@ApiTags('Layanan air — portal pelanggan (petugas)')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'SALES')
@Controller('utility/portal')
export class PortalAdminController {
  constructor(private readonly svc: PortalService) {}
  @Get(':connectionId') link(@CurrentUser() u: AuthUser, @Param('connectionId', ParseUUIDPipe) id: string) { return this.svc.link(u.tenantId, id); }
  @Post(':connectionId') issue(@CurrentUser() u: AuthUser, @Param('connectionId', ParseUUIDPipe) id: string) { return this.svc.issue(u, id); }
  @Post(':connectionId/revoke') revoke(@CurrentUser() u: AuthUser, @Param('connectionId', ParseUUIDPipe) id: string) { return this.svc.revoke(u, id); }
}

/** Halaman publik pelanggan: tanpa login, dilindungi token acak di alamat dan pembatasan laju */
@ApiTags('Layanan air — portal pelanggan')
@Public()
@UseGuards(UtilityPortalGuard)
@Throttle({ default: { limit: 40, ttl: 60_000 } })
@Controller('portal/utility/:token')
export class PortalPublicController {
  constructor(private readonly svc: PortalService) {}
  @Get() view(@Req() req: { portal: PortalScope }) { return this.svc.view(req.portal); }
  @Post('complaints') complain(@Req() req: { portal: PortalScope }, @Body() dto: PortalComplaintDto) { return this.svc.complain(req.portal, dto); }
}

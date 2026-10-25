import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { ApprovalLinksService } from './approval-links.service';
import { ApprovalRequestsService } from './approvals.service';
import { ListDto, AssignDto, PolicyDto, DecisionDto, LinkDecisionDto } from './approvals.dto';

@ApiTags('Persetujuan')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly svc: ApprovalRequestsService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListDto) {
    return this.svc.list(u, q);
  }

  @Get('approvers')
  approvers(@CurrentUser() u: AuthUser) {
    return this.svc.approvers(u);
  }

  @Post(':id/assign')
  assign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.svc.assign(u, id, dto);
  }

  @Get('pending-count')
  count(@CurrentUser() u: AuthUser) {
    return this.svc.pendingCount(u);
  }

  @Get('policy')
  @Roles('ADMIN')
  policy(@CurrentUser() u: AuthUser) {
    return this.svc.policy(u);
  }

  @Put('policy')
  @Roles('ADMIN')
  savePolicy(@CurrentUser() u: AuthUser, @Body() dto: PolicyDto) {
    return this.svc.savePolicy(u, dto);
  }

  @Post(':id/approve')
  @Roles('ADMIN')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.svc.approve(u, id, dto);
  }

  @Post(':id/reject')
  @Roles('ADMIN')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.svc.reject(u, id, dto);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(u, id);
  }
}

/** Persetujuan lewat tautan email pribadi (tanpa login) */
@ApiTags('Persetujuan')
@Controller('public/approval-links')
export class PublicApprovalLinksController {
  constructor(private readonly links: ApprovalLinksService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  summary(@Param('token') token: string) {
    return this.links.summary(token);
  }

  @Public()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':token/decide')
  decide(@Param('token') token: string, @Body() dto: LinkDecisionDto) {
    return this.links.decide(token, dto);
  }
}

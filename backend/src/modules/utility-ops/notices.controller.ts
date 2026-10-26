import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NOTICE_KINDS, type NoticeKind } from '@sansu/shared';
import { BadRequestException } from '@nestjs/common';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { NoticeLogDto } from './notices.dto';
import { NoticesService } from './notices.service';

@ApiTags('Layanan air — cetak dan kirim massal')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
@Controller('utility/notices')
export class NoticesController {
  constructor(private readonly svc: NoticesService) {}

  @Get('candidates') candidates(@CurrentUser() u: AuthUser, @Query('kind') kind: string, @Query('period') period?: string) {
    if (!NOTICE_KINDS.includes(kind as NoticeKind)) throw new BadRequestException('Jenis surat tidak dikenal');
    return this.svc.candidates(u.tenantId, kind as NoticeKind, period);
  }
  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
  @Get('history') history(@CurrentUser() u: AuthUser, @Query('connectionId') connectionId?: string, @Query('kind') kind?: string) { return this.svc.history(u.tenantId, connectionId, kind); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('log') log(@CurrentUser() u: AuthUser, @Body() dto: NoticeLogDto) { return this.svc.log(u, dto); }
}

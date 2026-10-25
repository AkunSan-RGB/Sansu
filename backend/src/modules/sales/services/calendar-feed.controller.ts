import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../../common/auth/decorators';
import { CalendarFeedService } from './calendar-feed.service';
import { FeedDto } from './calendar-feed.dto';

@ApiTags('Penjadwalan')
@ApiBearerAuth()
@RequireApp('sales')
@Roles('ADMIN')
@Controller('scheduling/feeds')
export class CalendarFeedController {
  constructor(private readonly svc: CalendarFeedService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: FeedDto) { return this.svc.create(u, dto); }
  @Post(':id/revoke') revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.revoke(u, id); }
}

/** Alamat publik yang dilanggan aplikasi kalender; dilindungi token rahasia, bukan login */
@ApiTags('Penjadwalan')
@Public()
@Controller('calendar')
export class CalendarPublicController {
  constructor(private readonly svc: CalendarFeedService) {}
  @Get(':token')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex')
  feed(@Param('token') token: string) { return this.svc.render(token); }
}

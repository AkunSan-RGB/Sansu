import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../../common/apps/app.guard';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { RetainerService } from './retainers.service';
import { RetainerDto, RetainerUpdateDto, RetainerBillDto } from './retainers.dto';

@ApiTags('Retainer jasa')
@ApiBearerAuth()
@RequireApp('sales')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('retainers')
export class RetainerController {
  constructor(private readonly svc: RetainerService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: RetainerDto) { return this.svc.create(u, dto); }
  @Roles('ADMIN') @Put(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetainerUpdateDto) { return this.svc.update(u, id, dto); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/bill') bill(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetainerBillDto) { return this.svc.bill(u, id, dto); }
}

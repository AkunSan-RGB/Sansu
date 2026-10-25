import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { PriceAgreementsService } from './price-agreements.service';
import { LookupDto, CreateAgreementDto, DecideAgreementDto, ReasonDto } from './price-agreements.dto';

@ApiTags('Kontrak harga pemasok')
@ApiBearerAuth()
@RequireApp('purchase')
@Roles('PURCHASING', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
@Controller('price-agreements')
export class PriceAgreementsController {
  constructor(private readonly svc: PriceAgreementsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.svc.list(u, status);
  }
  @Get('lookup')
  async lookup(@CurrentUser() u: AuthUser, @Query() q: LookupDto) {
    return this.svc.lookupFor(u, q);
  }
  @Roles('PURCHASING', 'ADMIN')
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateAgreementDto) {
    return this.svc.create(u, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post(':id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideAgreementDto) {
    return this.svc.approve(u, id, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post(':id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.svc.reject(u, id, dto);
  }
  @Roles('PURCHASING', 'FINANCE', 'ADMIN')
  @Post(':id/end')
  end(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.svc.end(u, id, dto);
  }
}

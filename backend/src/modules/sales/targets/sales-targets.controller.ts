import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { SalesTargetsService } from './sales-targets.service';
import { TargetQueryDto, SaveTargetsDto } from './sales-targets.dto';

@ApiTags('Penjualan')
@ApiBearerAuth()
@Controller('sales-targets')
export class SalesTargetsController {
  constructor(private readonly svc: SalesTargetsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  list(@CurrentUser() u: AuthUser, @Query() q: TargetQueryDto) {
    return this.svc.performance(u, q.month);
  }

  @Put()
  @Roles('ADMIN')
  save(@CurrentUser() u: AuthUser, @Body() dto: SaveTargetsDto) {
    return this.svc.save(u, dto);
  }
}

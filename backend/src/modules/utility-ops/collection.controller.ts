import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { VisitDto } from './collection.dto';
import { CollectionService } from './collection.service';
import { wantsPage } from '../../common/pagination';

@ApiTags('Layanan air — penagihan lapangan')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE')
@Controller('utility/collection')
export class CollectionController {
  constructor(private readonly svc: CollectionService) {}

  @Get('worklist') worklist(@CurrentUser() u: AuthUser, @Query('collectorId') collectorId?: string, @Query('routeId') routeId?: string, @Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.svc.worklist(u, { collectorId, routeId, q }, wantsPage({ page }) ? { page, pageSize } : undefined); }
  @Get('summary') summary(@CurrentUser() u: AuthUser, @Query('collectorId') collectorId?: string) { return this.svc.summary(u, collectorId); }
  @Get('visits') visits(@CurrentUser() u: AuthUser, @Query('connectionId') connectionId?: string) { return this.svc.visits(u, connectionId); }
  @Roles('ADMIN', 'FINANCE', 'WAREHOUSE') @Post('visits') record(@CurrentUser() u: AuthUser, @Body() dto: VisitDto) { return this.svc.record(u, dto); }
}

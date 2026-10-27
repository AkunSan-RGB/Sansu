import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { MessagingConfigDto, OutboxEnqueueDto, TestSendDto } from './outbox.dto';
import { OutboxService } from './outbox.service';

@ApiTags('Layanan air — antrean pesan')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
@Controller('utility/outbox')
export class OutboxController {
  constructor(private readonly svc: OutboxService) {}
  @Get('config') config(@CurrentUser() u: AuthUser) { return this.svc.getConfig(u.tenantId); }
  @Roles('ADMIN') @Put('config') save(@CurrentUser() u: AuthUser, @Body() dto: MessagingConfigDto) { return this.svc.saveConfig(u, dto); }
  @Roles('ADMIN') @Post('test') test(@CurrentUser() u: AuthUser, @Body() dto: TestSendDto) { return this.svc.testSend(u, dto.to); }
  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u.tenantId); }
  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.svc.list(u.tenantId, status); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post('enqueue') enqueue(@CurrentUser() u: AuthUser, @Body() dto: OutboxEnqueueDto) { return this.svc.enqueue(u, dto); }
  @Roles('ADMIN', 'FINANCE') @Post('process') process(@CurrentUser() u: AuthUser) { return this.svc.process(u.tenantId); }
  @Roles('ADMIN', 'FINANCE') @Post(':id/retry') retry(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.retry(u, id); }
  @Roles('ADMIN', 'FINANCE', 'SALES') @Post(':id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.cancel(u, id); }
}

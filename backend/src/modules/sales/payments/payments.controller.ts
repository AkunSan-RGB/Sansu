import { Body, Controller, Get, Post } from '@nestjs/common';
import { RequireApp } from '../../../common/apps/app.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { CreatePaymentDto } from '../sales.dto';
import { PaymentsService } from './payments.service';
import { WriteOffDto } from './payments.dto';

@ApiTags('Penjualan')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@RequireApp('sales')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE')
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.svc.create(u, dto);
  }

  /** Hapus piutang macet (≥ 90 hari lewat jatuh tempo); selain Pemilik/Admin menunggu persetujuan */
  @Roles('ADMIN', 'FINANCE')
  @Post('write-off')
  writeOff(@CurrentUser() u: AuthUser, @Body() dto: WriteOffDto) {
    return this.svc.writeOff(u, dto);
  }
}

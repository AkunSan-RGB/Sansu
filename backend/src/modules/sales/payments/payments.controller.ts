import { Body, Controller, Get, Post } from '@nestjs/common';
import { RequireApp } from '../../../common/apps/app.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { CreatePaymentDto } from '../sales.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Penjualan')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE')
@RequireApp('sales')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.svc.create(u, dto);
  }
}

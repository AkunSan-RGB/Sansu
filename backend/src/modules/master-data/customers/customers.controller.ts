import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { ListQueryDto } from '../products/products.dto';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';
import { CustomersService } from './customers.service';

@ApiTags('Master Data')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'CASHIER', 'ACCOUNTANT')
  list(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.svc.list(u.tenantId, q.q);
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'CASHIER', 'ACCOUNTANT')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN', 'SALES', 'FINANCE')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCustomerDto) {
    // Sales boleh mendaftarkan outlet baru, tetapi syarat komersialnya (limit kredit, termin, daftar harga, wajib PO) diatur Admin/Keuangan lewat ubah pelanggan
    if (u.role === 'SALES' && (dto.creditLimit !== undefined || dto.paymentTermDays !== undefined || dto.priceListId !== undefined || dto.requirePo !== undefined)) {
      throw new ForbiddenException('Limit kredit, termin, daftar harga, dan wajib PO outlet diatur oleh Admin/Keuangan');
    }
    return this.svc.create(u.tenantId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'FINANCE')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.svc.update(u.tenantId, id, dto);
  }
}

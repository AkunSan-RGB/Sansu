import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { CreateProductDto, ListQueryDto, UpdateProductDto } from './products.dto';
import { ProductsService } from './products.service';

@ApiTags('Master Data')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly svc: ProductsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.svc.list(u.tenantId, q.q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateProductDto) {
    return this.svc.create(u.tenantId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.svc.update(u.tenantId, id, dto);
  }
}

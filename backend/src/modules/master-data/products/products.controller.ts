import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { AddCategoryDto, CreateProductDto, ListQueryDto, MergeCategoriesDto, UpdateProductDto } from './products.dto';
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

  /** Pilihan form produk sesuai jenis usaha: kategori, satuan, bidang yang tampil (harus di atas rute :id) */
  @Get('options')
  options(@CurrentUser() u: AuthUser) {
    return this.svc.options(u.tenantId);
  }

  @Post('categories')
  @Roles('ADMIN')
  addCategory(@CurrentUser() u: AuthUser, @Body() dto: AddCategoryDto) {
    return this.svc.addCategory(u.tenantId, dto);
  }

  /** Kategori produk + usulan penyatuan ejaan ganda (harus di atas rute :id) */
  @Get('categories')
  categories(@CurrentUser() u: AuthUser) {
    return this.svc.categories(u.tenantId);
  }

  @Post('categories/merge')
  @Roles('ADMIN')
  mergeCategories(@CurrentUser() u: AuthUser, @Body() dto: MergeCategoriesDto) {
    return this.svc.mergeCategories(u.tenantId, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.tenantId, id);
  }

  @Post('generate-barcodes')
  @Roles('ADMIN')
  generateBarcodes(@CurrentUser() u: AuthUser) {
    return this.svc.generateMissingBarcodes(u.tenantId);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateProductDto) {
    return this.svc.create(u.tenantId, dto, true);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.svc.update(u.tenantId, id, dto, true);
  }
}

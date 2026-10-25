import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ShoppingListService } from './shopping-list.service';
import { ListQueryDto, DraftOrderDto } from './shopping-list.dto';

@ApiTags('Daftar belanja')
@ApiBearerAuth()
@RequireApp('purchase')
@Roles('PURCHASING', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE', 'ADMIN')
@Controller('shopping-list')
export class ShoppingListController {
  constructor(private readonly svc: ShoppingListService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.svc.list(u, q.warehouseId);
  }
  @Roles('PURCHASING', 'ADMIN')
  @Post('draft-order')
  draft(@CurrentUser() u: AuthUser, @Body() dto: DraftOrderDto) {
    return this.svc.draft(u, dto);
  }
}

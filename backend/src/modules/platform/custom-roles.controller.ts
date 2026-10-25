import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { CustomRolesService } from './custom-roles.service';
import { CatalogQueryDto, RoleDto, UpdateRoleDto } from './custom-roles.dto';

@ApiTags('settings')
@ApiBearerAuth()
@Roles('OWNER')
@Controller('settings/roles')
export class CustomRolesController {
  constructor(private readonly svc: CustomRolesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId);
  }

  @Get('catalog')
  catalog(@Query() q: CatalogQueryDto) {
    return this.svc.catalog(q.baseRole);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: RoleDto) {
    return this.svc.create(u, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.svc.update(u, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(u, id);
  }
}

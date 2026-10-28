import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { RoleCustomizationDto } from './role-customization.dto';
import { RoleCustomizationService } from './role-customization.service';

@ApiTags('Pengaturan')
@ApiBearerAuth()
@Controller('settings/customization/roles')
export class RoleCustomizationController {
  constructor(private readonly svc: RoleCustomizationService) {}

  @Get() get(@CurrentUser() u: AuthUser) { return this.svc.get(u.tenantId); }
  @Roles('ADMIN') @Put() set(@CurrentUser() u: AuthUser, @Body() dto: RoleCustomizationDto) { return this.svc.set(u, dto); }
  @Roles('ADMIN') @Delete() reset(@CurrentUser() u: AuthUser) { return this.svc.reset(u); }
}

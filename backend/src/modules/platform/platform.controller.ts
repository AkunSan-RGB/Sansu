import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { APP_KEYS, type AppKey } from '@sansu/shared';
import { AppsService } from '../../common/apps/apps.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { PlatformService } from './platform.service';
import { UpdateUserDto, UpdateCompanyDto, BrandingDto, TermsSettingsDto, ReportingSettingsDto, PayrollSettingsDto } from './platform.dto';

@ApiTags('Platform')
@ApiBearerAuth()
@Controller()
export class PlatformController {
  constructor(
    private readonly apps: AppsService,
    private readonly svc: PlatformService,
  ) {}

  /** Katalog aplikasi + status aktif (semua pengguna boleh melihat) */
  @Get('apps')
  catalog(@CurrentUser() u: AuthUser) {
    return this.apps.catalog(u.tenantId);
  }

  @Roles('ADMIN')
  @Post('apps/:key/install')
  install(@CurrentUser() u: AuthUser, @Param('key') key: string) {
    return this.apps.install(u.tenantId, this.key(key));
  }

  @Roles('ADMIN')
  @Post('apps/:key/uninstall')
  uninstall(@CurrentUser() u: AuthUser, @Param('key') key: string) {
    return this.apps.uninstall(u.tenantId, this.key(key));
  }

  @Roles('ADMIN')
  @Patch('users/:id')
  updateUser(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.svc.updateUser(u, id, dto);
  }

  @Roles('ADMIN', 'FINANCE', 'HR', 'ACCOUNTANT')
  @Get('settings/company')
  company(@CurrentUser() u: AuthUser) {
    return this.svc.company(u.tenantId);
  }

  @Roles('ADMIN')
  @Patch('settings/company')
  updateCompany(@CurrentUser() u: AuthUser, @Body() dto: UpdateCompanyDto) {
    return this.svc.updateCompany(u, dto);
  }

  /** Kop surat untuk faktur, surat jalan, PO, penawaran — semua peran */
  @Get('settings/letterhead')
  letterhead(@CurrentUser() u: AuthUser) {
    return this.svc.letterhead(u.tenantId);
  }

  @Roles('ADMIN')
  @Patch('settings/branding')
  updateBranding(@CurrentUser() u: AuthUser, @Body() dto: BrandingDto) {
    return this.svc.updateBranding(u, dto);
  }

  @Roles('ADMIN')
  @Patch('settings/terms')
  updateTerms(@CurrentUser() u: AuthUser, @Body() dto: TermsSettingsDto) {
    return this.svc.updateTerms(u, dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch('settings/reporting')
  updateReporting(@CurrentUser() u: AuthUser, @Body() dto: ReportingSettingsDto) {
    return this.svc.updateReporting(u, dto);
  }

  @Roles('ADMIN', 'HR')
  @Patch('settings/payroll')
  updatePayroll(@CurrentUser() u: AuthUser, @Body() dto: PayrollSettingsDto) {
    return this.svc.updatePayroll(u, dto);
  }

  private key(k: string): AppKey {
    if (!APP_KEYS.includes(k as AppKey)) throw new BadRequestException('Aplikasi tidak dikenal');
    return k as AppKey;
  }
}

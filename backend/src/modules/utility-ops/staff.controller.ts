import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { StaffService } from './staff.service';

@ApiTags('Layanan air')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'WAREHOUSE')
@Controller('utility')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** Daftar pegawai untuk memilih penerima tugas (teknisi, petugas baca, kolektor) */
  @Get('staff') list(@CurrentUser() u: AuthUser) { return this.staff.list(u.tenantId); }
}

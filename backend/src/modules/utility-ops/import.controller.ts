import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ImportConnectionsDto } from './import.dto';
import { ImportService } from './import.service';

@ApiTags('Layanan air — impor data pelanggan')
@ApiBearerAuth()
@RequireApp('utility')
@Roles('ADMIN', 'FINANCE')
@Controller('utility/import')
export class ImportController {
  constructor(private readonly svc: ImportService) {}
  /** Pratinjau (dryRun) atau simpan sampai 300 baris per permintaan; berkas besar dikirim bertahap oleh tampilan */
  @Post('connections') run(@CurrentUser() u: AuthUser, @Body() dto: ImportConnectionsDto) { return this.svc.run(u, dto); }
}

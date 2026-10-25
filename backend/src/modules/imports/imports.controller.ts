import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ImportsService } from './imports.service';
import { ImportDto } from './imports.dto';

@ApiTags('Impor data')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly svc: ImportsService) {}

  /** dryRun (default) = pratinjau tanpa menyimpan; dryRun=false = simpan semua dalam satu transaksi */
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @HttpCode(200)
  @Post()
  run(@CurrentUser() u: AuthUser, @Body() dto: ImportDto) {
    return this.svc.run(u, dto);
  }
}

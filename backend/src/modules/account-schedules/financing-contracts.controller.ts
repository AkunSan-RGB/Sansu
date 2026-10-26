import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ContractDto, UpdateContractDto } from './financing-contracts.dto';
import { FinancingContractsService } from './financing-contracts.service';

@ApiTags('Kontrak pembiayaan')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('financing-contracts')
export class FinancingContractsController {
  constructor(private readonly service: FinancingContractsService) {}

  @Get()
  @ApiOperation({ summary: 'Daftar kontrak pembiayaan beserta saldo kontraktual akhir tahun' })
  list(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    const y = year ? Number(year) : new Date().getUTCFullYear();
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('Tahun tidak valid');
    return this.service.list(u.tenantId, y);
  }

  @Get(':id/schedule')
  @ApiOperation({ summary: 'Jadwal kontraktual per bulan (pokok, bunga/amortisasi, saldo)' })
  schedule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.schedule(u.tenantId, id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  @ApiOperation({ summary: 'Daftarkan kontrak pinjaman, sewa pembiayaan, atau biaya dibayar di muka' })
  create(@CurrentUser() u: AuthUser, @Body() dto: ContractDto) {
    return this.service.create(u, dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch(':id')
  @ApiOperation({ summary: 'Ubah kontrak atau tutup kontrak (status CLOSED)' })
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractDto) {
    return this.service.update(u, id, dto);
  }
}

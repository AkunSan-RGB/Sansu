import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AutoBookkeepingDto {
  @ApiPropertyOptional({ description: 'Posting jurnal gaji otomatis setelah tanggal bayar' }) @IsOptional() @IsBoolean() payroll?: boolean;
  @ApiPropertyOptional({ description: 'Penilaian ulang valas akhir bulan otomatis' }) @IsOptional() @IsBoolean() fx?: boolean;
  @ApiPropertyOptional({ description: 'Kunci periode bulan lalu otomatis' }) @IsOptional() @IsBoolean() lock?: boolean;
  @ApiPropertyOptional({ description: 'Tanggal (1-28) kunci otomatis bulan lalu', example: 10 }) @IsOptional() @IsInt() @Min(1) @Max(28) lockDay?: number;
  @ApiPropertyOptional({ description: 'Tutup buku tahun lalu otomatis (setelah Februari, periode harus terkunci)' }) @IsOptional() @IsBoolean() closeYear?: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class SitePostDto {
  @ApiProperty({ example: 'Satpam shift pagi' }) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiProperty({ example: 2, description: 'Jumlah petugas yang wajib hadir tiap hari' }) @IsInt() @Min(1) @Max(500) headcount: number;
  @ApiProperty({ example: '4200000', description: 'Tarif per petugas per bulan' }) @IsNumberString() monthlyRate: string;
}

export class SiteContractDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ example: 'Gedung Menara Satu' }) @IsString() @MinLength(2) @MaxLength(120) siteName: string;
  @ApiProperty({ example: 'Jasa pengamanan' }) @IsString() @MinLength(3) @MaxLength(120) title: string;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ description: 'Dikenai PPN (kosong = bawaan perusahaan)' }) @IsOptional() @IsBoolean() withVat?: boolean;
  @ApiProperty({ type: [SitePostDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SitePostDto) posts: SitePostDto[];
}

export class SiteContractUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ description: 'Alasan perubahan (tercatat di jejak audit)' }) @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class SiteRosterDto {
  @ApiProperty() @IsUUID() postId: string;
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @IsDateString() from: string;
  @ApiProperty() @IsDateString() to: string;
}

export class SiteBillDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Periode berformat YYYY-MM' }) period: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Potong tagihan sebesar kekurangan petugas (hari-orang) menurut jadwal jaga' }) @IsOptional() @IsBoolean() deductShortfall?: boolean;
}

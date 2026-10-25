import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { LEGAL_FORMS, type LegalForm, REPORTING_FRAMEWORKS, type ReportingFramework, TAX_SCHEMES, type TaxScheme } from '@sansu/shared';

export class EntityAnswersDto {
  @ApiProperty() @IsBoolean() publicAccountability: boolean;
  @ApiProperty({ enum: LEGAL_FORMS }) @IsIn(LEGAL_FORMS) legalForm: LegalForm;
  @ApiProperty({ description: 'Total aset di luar tanah & bangunan (Rp)' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e15) assets: number;
  @ApiProperty({ description: 'Peredaran bruto setahun (Rp)' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e15) revenue: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1980) @Max(2100) taxRegisteredYear?: number;
}

export class ApplyEntityProfileDto extends EntityAnswersDto {
  @ApiProperty({ enum: REPORTING_FRAMEWORKS }) @IsIn(REPORTING_FRAMEWORKS) framework: ReportingFramework;
  @ApiProperty({ enum: TAX_SCHEMES }) @IsIn(TAX_SCHEMES) taxScheme: TaxScheme;
  @ApiPropertyOptional({ description: 'Kosong = status PKP tidak diubah' }) @IsOptional() @IsBoolean() pkp?: boolean;
}

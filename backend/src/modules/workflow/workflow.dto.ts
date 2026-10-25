import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsNumberString, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { WORKFLOW_LINK_TYPES, type WorkflowLinkType, type WorkflowOverrides } from '@sansu/shared';

export class CreateCaseDto {
  @ApiProperty({ example: 'JASA_PROYEK' }) @IsString() @MaxLength(40) pipeline: string;
  @ApiProperty({ example: 'Renovasi kantor PT Maju' }) @IsString() @MinLength(3) @MaxLength(160) title: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ example: '25000000' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
}

export class AddLinkDto {
  @ApiProperty({ enum: WORKFLOW_LINK_TYPES }) @IsIn(WORKFLOW_LINK_TYPES as unknown as string[]) type: WorkflowLinkType;
  @ApiProperty() @IsUUID() docId: string;
}

export class AdvanceDto {
  @ApiProperty() @IsString() @MaxLength(40) to: string;
  @ApiPropertyOptional({ description: 'Catatan / bukti (wajib untuk tahap tertentu)' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class NoteDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) note: string;
}

export class CaseQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() pipeline?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['ACTIVE', 'DONE', 'CANCELLED']) status?: string;
}

export class WorkflowSettingsDto {
  @ApiPropertyOptional({ description: 'Buka kasus otomatis dari dokumen baru dan stok di bawah minimum' }) @IsOptional() @IsBoolean() autoOpen?: boolean;
  @ApiPropertyOptional({ description: 'Alur wajib: dokumen berisiko (bayar tagihan pemasok, mulai produksi) diblokir bila tahap alur belum tercapai' }) @IsOptional() @IsBoolean() enforce?: boolean;
  @ApiPropertyOptional({ description: 'Penyesuaian tahap per alur — hanya boleh memperketat' }) @IsOptional() @IsObject() overrides?: WorkflowOverrides;
}

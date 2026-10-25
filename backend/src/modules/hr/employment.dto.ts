import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ProposeReasonDto {
  @ApiPropertyOptional({ description: 'Alasan perubahan (tampil bagi penyetuju)' }) @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

export class DecideChangeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class RejectChangeDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

export class ChangeQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']) status?: string;
}

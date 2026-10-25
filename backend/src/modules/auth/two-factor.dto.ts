import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { type TwoFactorRequirement } from '../../common/auth/two-factor-policy';

export class TwoFactorLoginDto {
  @ApiProperty() @IsString() @MaxLength(1000) challenge: string;
  @ApiProperty({ example: '123456', description: 'Kode 6 digit atau kode cadangan' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code: string;
}

export class TwoFactorCodeDto {
  @ApiProperty({ example: '123456' }) @IsString() @MinLength(6) @MaxLength(20) code: string;
}

export class TwoFactorDisableDto {
  @ApiProperty() @IsString() @MaxLength(200) password: string;
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(20) code: string;
}

export class SecuritySettingsDto {
  @ApiProperty({ enum: ['NONE', 'ADMINS', 'ALL'] }) @IsIn(['NONE', 'ADMINS', 'ALL']) require2fa: TwoFactorRequirement;
}

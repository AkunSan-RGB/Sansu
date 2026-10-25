import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { type LoyaltySettings } from '@sansu/shared';

export class LoyaltySettingsDto implements LoyaltySettings {
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiProperty({ example: 10000 }) @IsInt() @Min(1000) @Max(10_000_000) earnPerRp: number;
  @ApiProperty({ example: 100 }) @IsInt() @Min(1) @Max(10_000) pointValueRp: number;
  @ApiProperty({ example: 50 }) @IsInt() @Min(1) @Max(100_000) minRedeemPoints: number;
  @ApiProperty({ example: 50 }) @IsNumber() @Min(1) @Max(100) maxRedeemPct: number;
  @ApiProperty({ example: 12 }) @IsInt() @Min(0) @Max(60) expiryMonths: number;
}

export class AdjustDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ example: 100, description: 'Positif menambah, negatif mengurangi' }) @IsInt() @Min(-100_000) @Max(100_000) points: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}

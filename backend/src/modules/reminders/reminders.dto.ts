import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SnoozeKeyDto {
  @IsString() @MaxLength(80) @Matches(/^[A-Za-z0-9-]+$/, { message: 'Kunci pengingat tidak valid' }) key: string;
}

export class SnoozeDto extends SnoozeKeyDto {
  @ApiPropertyOptional({ enum: [1, 3, 7, 30] }) @IsIn([1, 3, 7, 30]) days: number;
}

const days = (min: number, max: number) => (target: object, key: string) => {
  Type(() => Number)(target, key);
  IsInt()(target, key);
  Min(min)(target, key);
  Max(max)(target, key);
  IsOptional()(target, key);
  ApiPropertyOptional()(target, key);
};

export class UpdateReminderSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @days(0, 60) arLeadDays?: number;
  @days(0, 60) apLeadDays?: number;
  @days(1, 180) grniDays?: number;
  @days(1, 180) poDays?: number;
  @days(1, 90) deliveryDays?: number;
  @days(0, 60) taxLeadDays?: number;
  @days(1, 28) payrollDay?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emailDigest?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() customerReminders?: boolean;
  @days(0, 30) customerLeadDays?: number;
  @days(1, 60) customerRepeatDays?: number;
  @days(1, 10) customerMaxOverdue?: number;
}

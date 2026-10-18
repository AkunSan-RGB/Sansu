import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { TaxModule } from '../tax/tax.module';
import { ReminderMailer, ReminderScheduler } from './reminder-mailer.service';
import { RemindersService } from './reminders.service';
import { TaskInboxController, TaskInboxService } from './task-inbox';

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

@ApiTags('Pengingat')
@ApiBearerAuth()
@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly svc: RemindersService,
    private readonly mailer: ReminderMailer,
  ) {}

  /** Pengingat untuk pengguna ini (menurut peran); `all=true` menyertakan yang sedang ditunda */
  @Get()
  list(@CurrentUser() u: AuthUser, @Query('all') all?: string) {
    return this.svc.forUser(u, all === 'true');
  }

  @Post('snooze')
  snooze(@CurrentUser() u: AuthUser, @Body() dto: SnoozeDto) {
    return this.svc.snooze(u, dto.key, dto.days);
  }

  /** Kirim ringkasan ke email pengguna ini (contoh / uji pengiriman) */
  @Post('digest/test')
  digestTest(@CurrentUser() u: AuthUser) {
    return this.mailer.sendDigestTo(u);
  }

  /** Kirim sekarang ringkasan harian ke semua penerima perusahaan (admin) */
  @Post('digest/send')
  @Roles('ADMIN')
  digestSend(@CurrentUser() u: AuthUser) {
    return this.mailer.sendDigest(u.tenantId, { force: true });
  }

  /** Kirim pengingat tagihan ke pelanggan untuk satu faktur */
  @Post('invoices/:id/customer')
  @Roles('ADMIN', 'FINANCE', 'SALES')
  remindCustomer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.mailer.remindCustomer(u, id);
  }

  /** Tampilkan lagi pengingat yang ditunda */
  @Post('unsnooze')
  unsnooze(@CurrentUser() u: AuthUser, @Body() dto: SnoozeKeyDto) {
    return this.svc.unsnooze(u, dto.key);
  }
}

@ApiTags('Pengingat')
@ApiBearerAuth()
@Controller('settings/reminders')
export class ReminderSettingsController {
  constructor(private readonly svc: RemindersService) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.svc.config(u.tenantId);
  }

  @Put()
  @Roles('ADMIN')
  put(@CurrentUser() u: AuthUser, @Body() dto: UpdateReminderSettingsDto) {
    return this.svc.saveConfig(u.tenantId, { ...dto });
  }
}

@Module({
  imports: [TaxModule],
  controllers: [RemindersController, ReminderSettingsController, TaskInboxController],
  providers: [RemindersService, ReminderMailer, ReminderScheduler, TaskInboxService],
  exports: [RemindersService, ReminderMailer],
})
export class RemindersModule {}

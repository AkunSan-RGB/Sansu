import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ReminderMailer } from './reminder-mailer.service';
import { RemindersService } from './reminders.service';
import { SnoozeDto, SnoozeKeyDto, UpdateReminderSettingsDto } from './reminders.dto';

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

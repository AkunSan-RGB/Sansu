import { Module } from '@nestjs/common';
import { TaxModule } from '../tax/tax.module';
import { ReminderMailer, ReminderScheduler } from './reminder-mailer.service';
import { RemindersService } from './reminders.service';
import { TaskInboxController } from './task-inbox.controller';
import { TaskInboxService } from './task-inbox.service';
import { RemindersController, ReminderSettingsController } from './reminders.controller';
import { ReminderMailerRepository } from './reminder-mailer.repository';
import { RemindersRepository } from './reminders.repository';

@Module({
  imports: [TaxModule],
  controllers: [RemindersController, ReminderSettingsController, TaskInboxController],
  providers: [RemindersRepository, ReminderMailerRepository, RemindersService, ReminderMailer, ReminderScheduler, TaskInboxService],
  exports: [RemindersService, ReminderMailer],
})
export class RemindersModule {}

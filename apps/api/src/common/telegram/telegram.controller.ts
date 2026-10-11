import { Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators';
import { TelegramService } from './telegram.service';

@ApiTags('Telegram')
@ApiBearerAuth()
@Controller('auth/telegram')
export class TelegramController {
  constructor(private readonly svc: TelegramService) {}

  @Get()
  status(@CurrentUser() u: AuthUser) {
    return this.svc.status(u.sub);
  }

  @Post('link')
  link(@CurrentUser() u: AuthUser) {
    return this.svc.createLink(u.sub);
  }

  @Delete()
  unlink(@CurrentUser() u: AuthUser) {
    return this.svc.unlink(u.sub);
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { TaskInboxService } from './task-inbox.service';

@ApiTags('Kotak tugas')
@ApiBearerAuth()
@Controller('tasks')
export class TaskInboxController {
  constructor(private readonly svc: TaskInboxService) {}

  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.mine(u);
  }
}

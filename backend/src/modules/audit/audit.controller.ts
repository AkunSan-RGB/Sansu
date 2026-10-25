import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AuditLogService } from './audit.service';
import { AuditQueryDto } from './audit.dto';

@ApiTags('Jejak audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly svc: AuditLogService) {}

  @Roles('ADMIN')
  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: AuditQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  @Roles('ADMIN')
  @Get('users')
  users(@CurrentUser() u: AuthUser) {
    return this.svc.users(u.tenantId);
  }
}

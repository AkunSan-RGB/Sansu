import { Module } from '@nestjs/common';
import { AuditLogController } from './audit.controller';
import { AuditLogService } from './audit.service';
import { AuditRepository } from './audit.repository';

@Module({ controllers: [AuditLogController], providers: [AuditRepository, AuditLogService] })
export class AuditLogModule {}

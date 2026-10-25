import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HealthRepository } from './health.repository';

@Module({ controllers: [HealthController], providers: [HealthRepository, HealthService] })
export class HealthModule {}

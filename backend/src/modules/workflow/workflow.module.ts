import { Global, Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService, WorkflowScheduler } from './workflow.service';
import { WorkflowRepository } from './workflow.repository';

@Global()
@Module({ controllers: [WorkflowController], providers: [WorkflowRepository, WorkflowService, WorkflowScheduler], exports: [WorkflowService] })
export class WorkflowModule {}

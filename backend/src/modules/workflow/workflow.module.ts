import { Global, Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService, WorkflowScheduler } from './workflow.service';

@Global()
@Module({ controllers: [WorkflowController], providers: [WorkflowService, WorkflowScheduler], exports: [WorkflowService] })
export class WorkflowModule {}

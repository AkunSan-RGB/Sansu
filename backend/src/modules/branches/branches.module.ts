import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BranchesRepository } from './branches.repository';

@Module({ controllers: [BranchesController], providers: [BranchesRepository, BranchesService] })
export class BranchesModule {}

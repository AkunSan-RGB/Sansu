import { Module } from '@nestjs/common';
import { PermissionsModule } from '../../common/auth/permissions';
import { CustomRolesController } from './custom-roles.controller';
import { CustomRolesService } from './custom-roles.service';
import { CustomRolesRepository } from './custom-roles.repository';

@Module({ imports: [PermissionsModule], controllers: [CustomRolesController], providers: [CustomRolesRepository, CustomRolesService] })
export class CustomRolesModule {}

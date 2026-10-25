import { Module } from '@nestjs/common';
import { PermissionsModule } from '../../common/auth/permissions';
import { CustomRolesController } from './custom-roles.controller';
import { CustomRolesService } from './custom-roles.service';

@Module({ imports: [PermissionsModule], controllers: [CustomRolesController], providers: [CustomRolesService] })
export class CustomRolesModule {}

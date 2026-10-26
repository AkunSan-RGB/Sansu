import { Injectable } from '@nestjs/common';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { StaffRepository } from './staff.repository';

@Injectable()
export class StaffService {
  constructor(@InjectDb() private readonly db: Db, private readonly repo: StaffRepository) {}
  list(tenantId: string) { return this.repo.list(this.db, tenantId); }
}

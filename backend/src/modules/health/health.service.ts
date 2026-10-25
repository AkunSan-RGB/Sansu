import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SANSU_BUILD } from '@sansu/shared';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { HealthRepository } from './health.repository';

/** Pemeriksaan kesehatan API dan koneksi database (dipakai Docker / load balancer). */
@Injectable()
export class HealthService {
  constructor(@InjectDb() private readonly db: Db,
    private readonly repo: HealthRepository) {}

  async check() {
    try {
      await this.repo.queryCheck(this.db);
      return { status: 'ok', database: 'up', build: SANSU_BUILD, signup: process.env.ALLOW_SIGNUP !== 'false', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}

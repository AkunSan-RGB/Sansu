import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SANSU_BUILD } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';

/** Pemeriksaan kesehatan API dan koneksi database (dipakai Docker / load balancer). */
@Injectable()
export class HealthService {
  constructor(@InjectDb() private readonly db: Db) {}

  async check() {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { status: 'ok', database: 'up', build: SANSU_BUILD, signup: process.env.ALLOW_SIGNUP !== 'false', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}

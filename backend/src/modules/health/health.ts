import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SANSU_BUILD } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { Public } from '../../common/auth/decorators';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';

/** Dipakai Docker / load balancer untuk memeriksa API dan koneksi database. */
@ApiTags('Sistem')
@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { status: 'ok', database: 'up', build: SANSU_BUILD, signup: process.env.ALLOW_SIGNUP !== 'false', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}

import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { createAppPool, createDb, DB, POOL } from './db';
import { ReferenceRepository } from './reference.repository';

@Global()
@Module({
  providers: [
    { provide: POOL, useFactory: () => createAppPool() },
    ReferenceRepository,
    { provide: DB, inject: [POOL], useFactory: (pool: Pool) => createDb(pool) },
  ],
  exports: [DB, POOL, ReferenceRepository],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}

/** `constructor(@InjectDb() private readonly db: Db)` */
export const InjectDb = () => Inject(DB);

import { BadRequestException, Body, Controller, HttpCode, HttpException, HttpStatus, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Post } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BUSINESS_MODEL_KEYS, type BusinessModel } from '@sansu/shared';
import { IsIn } from 'class-validator';
import { sql } from 'drizzle-orm';
import { Public } from '../../common/auth/decorators';
import { AuthUser } from '../../common/auth/auth-user';
import { Db, createDb, createPool } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { removeTenant } from '../../db/remove-tenant';
import { AuthService } from '../auth/auth.service';
import { buildDemo } from './demo.kit';
import { SEEDS } from './demo.seeds';

/** Perusahaan demo dihapus setelah sekian hari */
const DEMO_TTL_DAYS = 3;
/** Batas pembuatan demo per jam untuk seluruh sistem (pembuatannya memakai CPU/DB) */
const HOURLY_CAP = 60;

export class StartDemoDto {
  @ApiProperty({ enum: BUSINESS_MODEL_KEYS }) @IsIn(BUSINESS_MODEL_KEYS) businessModel: BusinessModel;
}

@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Demo');
  private timer?: NodeJS.Timeout;
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ref: ModuleRef,
  ) {}

  /** Buat PT DEMO baru berisi transaksi contoh sesuai jenis usaha, lalu kembalikan sesi masuk */
  async start(model: BusinessModel) {
    const recent = await this.db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM tenants WHERE settings ? 'demo' AND created_at > now() - interval '1 hour'`,
    );
    if ((recent.rows[0]?.n ?? 0) >= HOURLY_CAP) throw new HttpException('Demo sedang ramai. Coba lagi beberapa menit lagi.', HttpStatus.TOO_MANY_REQUESTS);

    const { user, session } = await this.ref.get(AuthService, { strict: false }).createDemoAccount(model);
    const admin: AuthUser = { sub: user.id, tenantId: user.tenantId, role: user.role, email: user.email };
    try {
      const demo = await buildDemo(this.ref, this.db, admin, model);
      await SEEDS[model](demo);
    } catch (e) {
      this.logger.error(`Data demo ${model} gagal: ${(e as Error).message}`);
      if (process.env.DEMO_STRICT === 'true') throw e;
      // akun tetap bisa dipakai walau sebagian data contoh gagal dibuat
    }
    return session;
  }

  /** Hapus perusahaan demo yang sudah lewat masa berlakunya (memakai koneksi admin karena menghapus jurnal) */
  async purgeExpired() {
    const old = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM tenants WHERE settings ? 'demo' AND created_at < now() - (${DEMO_TTL_DAYS} * interval '1 day') LIMIT 20`,
    );
    if (!old.rows.length) return 0;
    const pool = createPool();
    try {
      const admin = createDb(pool);
      for (const t of old.rows) await removeTenant(admin, t.id);
    } finally {
      await pool.end();
    }
    return old.rows.length;
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.purgeExpired().then((n) => n && this.logger.log(`${n} perusahaan demo kedaluwarsa dihapus`)).catch((e) => this.logger.error(`Pembersihan demo gagal: ${(e as Error).message}`));
    setTimeout(run, 180_000).unref();
    this.timer = setInterval(run, 6 * 60 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

@ApiTags('Demo')
@Controller('demo')
export class DemoController {
  constructor(private readonly svc: DemoService) {}

  @Public()
  @Throttle({ default: { limit: 4, ttl: 60 * 60_000 } })
  @HttpCode(200)
  @Post('start')
  start(@Body() dto: StartDemoDto) {
    if (!BUSINESS_MODEL_KEYS.includes(dto.businessModel)) throw new BadRequestException('Jenis usaha tidak dikenal');
    return this.svc.start(dto.businessModel);
  }
}

@Module({ controllers: [DemoController], providers: [DemoService] })
export class DemoModule {}

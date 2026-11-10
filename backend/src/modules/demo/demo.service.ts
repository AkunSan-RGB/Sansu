import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { type BusinessModel, type ServiceProfile } from '@sansu/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { Db, createDb, createPool } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { removeTenant } from '../../db/remove-tenant';
import { AuthService } from '../auth/auth.service';
import { CashService } from '../cash/cash.service';
import { buildDemo } from './demo.kit';
import { SEEDS } from './demo.seeds';
import { DemoRepository } from './demo.repository';
import { schedulersEnabled } from '../../common/schedulers';

/** Batas pembuatan demo per jam untuk seluruh sistem (pembuatannya memakai CPU/DB) */
const HOURLY_CAP = 60;

@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Demo');
  private timer?: NodeJS.Timeout;
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ref: ModuleRef,
    private readonly repo: DemoRepository,
  ) {}

  /** Buat PT DEMO baru berisi transaksi contoh sesuai jenis usaha, lalu kembalikan sesi masuk. `email` = email pengunjung (opsional). */
  async start(model: BusinessModel, serviceProfile: ServiceProfile = 'KONTRAKTOR', email?: string) {
    const recent = await this.repo.queryTenant(this.db);
    if ((recent.rows[0]?.n ?? 0) >= HOURLY_CAP) throw new HttpException('Demo sedang ramai. Coba lagi beberapa menit lagi.', HttpStatus.TOO_MANY_REQUESTS);

    const { user, session } = await this.ref.get(AuthService, { strict: false }).createDemoAccount(model, serviceProfile, email);
    const admin: AuthUser = { sub: user.id, tenantId: user.tenantId, role: user.role, email: user.email };
    // Data contoh dibuat dengan tanggal mundur dan urutan yang tidak selalu menjaga saldo kas: larangan saldo negatif dimatikan hanya selama pengisian
    const cash = this.ref.get(CashService, { strict: false });
    await cash.saveCashSettings(user.tenantId, { blockNegative: false });
    try {
      const demo = await buildDemo(this.ref, this.db, admin, model, serviceProfile);
      await SEEDS[model](demo, serviceProfile);
    } catch (e) {
      this.logger.error(`Data demo ${model} gagal: ${(e as Error).message}`);
      if (process.env.DEMO_STRICT === 'true') throw e;
      // akun tetap bisa dipakai walau sebagian data contoh gagal dibuat
    } finally {
      await cash.saveCashSettings(user.tenantId, { blockNegative: true });
    }
    return session;
  }

  /** Hapus perusahaan demo yang sudah lewat masa berlakunya (memakai koneksi admin karena menghapus jurnal) */
  async purgeExpired() {
    const old = await this.repo.queryTenantForPurgeExpired(this.db);
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

    if (!schedulersEnabled()) return; // banyak proses: hanya satu yang menjalankan tugas berkala
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.purgeExpired().then((n) => n && this.logger.log(`${n} perusahaan demo kedaluwarsa dihapus`)).catch((e) => this.logger.error(`Pembersihan demo gagal: ${(e as Error).message}${(e as { cause?: Error }).cause ? ` — penyebab: ${(e as { cause?: Error }).cause!.message}` : ''}`));
    setTimeout(run, 180_000).unref();
    this.timer = setInterval(run, 6 * 60 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { dbScope } from '../../db/db-scope';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { UtilityService } from '../utility/utility.service';
import { BillingJobsRepository } from './billing-jobs.repository';
import { opsAlert } from '../../common/monitor/ops-alert';

/**
 * Tagih bulanan berlatar. Permintaan langsung dijawab dengan nomor pekerjaan; penagihan berjalan di server dan kemajuannya dibaca berkala.
 * Satu pekerjaan per perusahaan (indeks unik). Aman diulang: sambungan yang sudah ditagih (klaim periode) otomatis dilewati.
 */
@Injectable()
export class BillingJobsService {
  private readonly log = new Logger('TagihBerlatar');
  constructor(@InjectDb() private readonly db: Db, private readonly repo: BillingJobsRepository, private readonly util: UtilityService, private readonly audit: AuditService) {}

  async start(u: AuthUser, period: string) {
    await this.repo.expireStale(this.db, u.tenantId);
    let id: string;
    try {
      id = await this.repo.insert(this.db, u.tenantId, period, u.sub);
    } catch (e) {
      const code = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
      if (code === '23505') throw new BadRequestException('Penagihan lain sedang berjalan untuk perusahaan ini; tunggu sampai selesai');
      throw e;
    }
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityBillingJob', entityId: id, data: { period } });
    // berjalan di latar dengan lingkup perusahaan yang sama (row-level security tetap berlaku)
    dbScope.run({ tenantId: u.tenantId, bypass: false }, () => { void this.execute(u, id, period); });
    return this.get(u.tenantId, id);
  }

  private async execute(u: AuthUser, id: string, period: string) {
    try {
      // klaim yatim dari proses sebelumnya yang mati di tengah dilepas dulu agar sambungan itu ikut ditagih
      let released = await this.repo.releaseStaleClaims(this.db, u.tenantId, period);
      const hook = { onProgress: (done: number, total: number, failed: number) => this.repo.progress(this.db, id, { total, done, failed }) };
      const r = await this.util.run(u, { period }, undefined, hook);
      let billed = r.billedCount, failed = r.failedCount, amount = r.billedTotal, held = r.heldCount;
      // klaim yang baru menjadi yatim selama jalannya pekerjaan ini (proses lain mati) disapu dan ditagih sekali lagi
      released = await this.repo.releaseStaleClaims(this.db, u.tenantId, period);
      if (released > 0) {
        this.log.warn(`Tagih berlatar ${id}: ${released} klaim tanpa faktur dilepas dan ditagih ulang`);
        const r2 = await this.util.run(u, { period }, undefined, hook);
        billed += r2.billedCount; failed += r2.failedCount; amount += r2.billedTotal; held = Math.max(held, r2.heldCount);
      }
      await this.repo.finish(this.db, id, { status: 'SELESAI', total: billed + failed, done: billed + failed, failed, billedTotal: amount, held });
    } catch (e) {
      this.log.error(`Tagih berlatar ${id} gagal: ${(e as Error).message}`);
      opsAlert('billing-job', `tagih berlatar ${id} gagal: ${(e as Error).message}`.slice(0, 500));
      await this.repo.finish(this.db, id, { status: 'GAGAL', total: 0, done: 0, failed: 0, billedTotal: 0, held: 0, error: (e as Error).message.slice(0, 500) }).catch(() => undefined);
    }
  }

  async get(tenantId: string, id: string) {
    await this.repo.expireStale(this.db, tenantId);
    const j = await this.repo.byId(this.db, tenantId, id);
    if (!j) throw new NotFoundException('Pekerjaan penagihan tidak ditemukan');
    return j;
  }
  async recent(tenantId: string) {
    await this.repo.expireStale(this.db, tenantId);
    return this.repo.recent(this.db, tenantId);
  }
}

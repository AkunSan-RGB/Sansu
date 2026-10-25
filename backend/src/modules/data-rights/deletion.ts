/**
 * Penghapusan seluruh data perusahaan atas permintaan pemilik, dengan banyak pengaman karena tidak dapat dibatalkan:
 *  1. hanya OWNER, dengan verifikasi ulang (kata sandi + 2FA bila aktif) dan mengetik nama perusahaan;
 *  2. pemilik wajib menyatakan memahami kewajiban menyimpan pembukuan/dokumen pajak;
 *  3. masa tenggang (bawaan 30 hari) yang dapat dibatalkan; pemilik dan admin diberi tahu lewat email dan diingatkan menjelang eksekusi;
 *  4. penghapusan menunggu ekspor data diunduh, kecuali pemilik secara eksplisit melepaskannya;
 *  5. pemilik layanan dapat menahan penghapusan (mis. sengketa atau permintaan hukum);
 *  6. eksekusi dalam satu transaksi dengan pemeriksaan jumlah baris (lihat erase.ts) dan bukti tanpa data bisnis disimpan.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { and, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { platformAdminEmails } from '../../common/auth/platform-admin';
import { AuditService } from '../../common/audit/audit.service';
import { appUrl, MailService } from '../../common/mail/mail.service';
import { telegram } from '../../common/monitor/error-monitor';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { createDb, createPool, Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { auditLogs, dataDeletionRequests, dataErasureLog, tenants, users } from '../../db/schema';
import { StorageService } from '../../common/storage/storage.service';
import { eraseTenant } from './erase';
import { ReauthService } from './reauth';

export const GRACE_DAYS = () => Math.max(7, Number(process.env.DATA_DELETION_GRACE_DAYS ?? 30) || 30);
/** Lama salinan cadangan menyimpan data setelah penghapusan (BACKUP_RETENTION_DAYS = jendela pemulihan/retensi backup yang Anda atur di penyedia database); kosong = belum ditetapkan */
export const BACKUP_RETENTION_DAYS = (): number | null => {
  const n = Math.floor(Number(process.env.BACKUP_RETENTION_DAYS));
  return Number.isFinite(n) && n > 0 ? n : null;
};
export const backupNote = (): string => {
  const n = BACKUP_RETENTION_DAYS();
  return n
    ? `Salinan cadangan sistem tidak ikut terhapus saat itu dan hilang otomatis paling lama ${n} hari setelah penghapusan.`
    : 'Salinan cadangan sistem tidak ikut terhapus saat itu dan hilang sesuai siklus penyimpanan cadangan penyedia; lama pastinya diberitahukan atas permintaan.';
};
const REMIND_EVERY_DAYS = 3;
const REMIND_WITHIN_DAYS = 7;

type Req = typeof dataDeletionRequests.$inferSelect;

export interface DeletionDto {
  password: string;
  code?: string;
  confirmName: string;
  reason?: string;
  ackRetention: boolean;
  exportWaived?: boolean;
}

@Injectable()
export class DeletionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PenghapusanData');
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly reauth: ReauthService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
  ) {}

  /** Penerima pemberitahuan: pemilik dan admin aktif perusahaan */
  private async recipients(tenantId: string): Promise<string[]> {
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, ['OWNER', 'ADMIN'])));
    return [...new Set(rows.map((r) => r.email))];
  }

  private async notify(tenantId: string, subject: string, heading: string, paragraphs: string[], cta = true) {
    for (const to of await this.recipients(tenantId))
      await this.mail.send({
        to,
        subject,
        heading,
        paragraphs,
        ...(cta ? { action: { label: 'Buka Pengaturan › Data & privasi', url: `${appUrl()}/settings/company` } } : {}),
      });
  }

  private async hasExport(tenantId: string, since: Date): Promise<boolean> {
    const [r] = await this.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'DATA_EXPORT'), gt(auditLogs.createdAt, since)))
      .limit(1);
    return !!r;
  }

  private view(r: Req | undefined, exported: boolean) {
    if (!r) return null;
    return {
      id: r.id,
      status: r.status,
      requestedAt: r.requestedAt,
      requestedByEmail: r.requestedByEmail,
      scheduledFor: r.scheduledFor,
      exportWaived: r.exportWaived,
      exportDone: r.exportWaived || exported,
      holdReason: r.status === 'ON_HOLD' ? r.holdReason : null,
    };
  }

  async status(tenantId: string) {
    const [active] = await this.db
      .select()
      .from(dataDeletionRequests)
      .where(
        and(
          eq(dataDeletionRequests.tenantId, tenantId),
          inArray(dataDeletionRequests.status, ['SCHEDULED', 'ON_HOLD']),
        ),
      );
    const [lastExport] = await this.db
      .select({ at: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'DATA_EXPORT')))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    const exported = active ? await this.hasExport(tenantId, active.requestedAt) : false;
    return {
      graceDays: GRACE_DAYS(),
      backupRetentionDays: BACKUP_RETENTION_DAYS(),
      backupNote: backupNote(),
      lastExportAt: lastExport?.at ?? null,
      deletion: this.view(active, exported),
    };
  }

  async request(u: AuthUser, dto: DeletionDto) {
    if (u.role !== 'OWNER')
      throw new ForbiddenException('Hanya pemilik perusahaan yang boleh meminta penghapusan data');
    if (!dto.ackRetention)
      throw new BadRequestException('Anda harus menyatakan memahami kewajiban menyimpan pembukuan dan dokumen pajak');
    const [company] = await this.db.select().from(tenants).where(eq(tenants.id, u.tenantId));
    if (!company) throw new NotFoundException('Perusahaan tidak ditemukan');
    if ((dto.confirmName ?? '').trim() !== company.name.trim())
      throw new BadRequestException('Nama perusahaan yang diketik tidak sama');
    await this.assertNotPlatform(u.tenantId);
    await this.reauth.verify(u, dto.password, dto.code, 'DATA_DELETION');

    const scheduledFor = addDays(todayJakarta(), GRACE_DAYS());
    let created: Req;
    try {
      [created] = await this.db
        .insert(dataDeletionRequests)
        .values({
          tenantId: u.tenantId,
          requestedById: u.sub,
          requestedByEmail: u.email,
          scheduledFor,
          reason: dto.reason?.slice(0, 500) || null,
          ackRetention: true,
          exportWaived: !!dto.exportWaived,
        })
        .returning();
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('Sudah ada permintaan penghapusan yang aktif');
      throw e;
    }
    await this.audit.log(this.db, {
      tenantId: u.tenantId,
      userId: u.sub,
      action: 'DATA_DELETION_REQUEST',
      entity: 'Tenant',
      entityId: u.tenantId,
      data: { scheduledFor, exportWaived: !!dto.exportWaived },
    });
    await this.notify(u.tenantId, 'Penghapusan data perusahaan dijadwalkan', 'Penghapusan data dijadwalkan', [
      `${u.email} meminta penghapusan PERMANEN seluruh data perusahaan ${company.name} di SANSU.`,
      `Penghapusan dijadwalkan pada ${scheduledFor}. Sebelum tanggal itu Anda dapat membatalkannya kapan saja di Pengaturan › Data & privasi.`,
      dto.exportWaived
        ? 'Pemilik memilih menghapus tanpa mengunduh ekspor data.'
        : 'Penghapusan hanya dijalankan setelah ekspor data diunduh.',
      backupNote(),
      'Jika ini bukan permintaan Anda, segera batalkan, ganti kata sandi, dan hubungi dukungan SANSU.',
    ]);
    void telegram(`🗑️ Permintaan penghapusan data: ${company.name} (dijadwalkan ${scheduledFor})`).catch(
      () => undefined,
    );
    return this.status(u.tenantId);
  }

  async cancel(u: AuthUser) {
    if (u.role !== 'OWNER' && u.role !== 'ADMIN')
      throw new ForbiddenException('Hanya pemilik atau admin yang boleh membatalkan penghapusan data');
    const [r] = await this.db
      .select()
      .from(dataDeletionRequests)
      .where(
        and(
          eq(dataDeletionRequests.tenantId, u.tenantId),
          inArray(dataDeletionRequests.status, ['SCHEDULED', 'ON_HOLD']),
        ),
      );
    if (!r) throw new NotFoundException('Tidak ada permintaan penghapusan yang aktif');
    await this.db
      .update(dataDeletionRequests)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: u.email })
      .where(eq(dataDeletionRequests.id, r.id));
    await this.audit.log(this.db, {
      tenantId: u.tenantId,
      userId: u.sub,
      action: 'DATA_DELETION_CANCEL',
      entity: 'Tenant',
      entityId: u.tenantId,
    });
    await this.notify(
      u.tenantId,
      'Penghapusan data perusahaan dibatalkan',
      'Penghapusan data dibatalkan',
      [`${u.email} membatalkan permintaan penghapusan data. Data perusahaan Anda tetap aman dan tidak akan dihapus.`],
      false,
    );
    return this.status(u.tenantId);
  }

  private async assertNotPlatform(tenantId: string) {
    const admins = platformAdminEmails();
    if (!admins.length) return;
    const [hit] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(sql`lower(${users.email})`, admins)))
      .limit(1);
    if (hit)
      throw new BadRequestException(
        'Perusahaan ini memuat akun pemilik layanan SANSU dan tidak dapat dihapus lewat jalur ini',
      );
  }

  // ----------------------------------------------------------------- pemilik layanan
  async list() {
    const rows = await this.db
      .select({ r: dataDeletionRequests, name: tenants.name })
      .from(dataDeletionRequests)
      .innerJoin(tenants, eq(tenants.id, dataDeletionRequests.tenantId))
      .orderBy(desc(dataDeletionRequests.requestedAt))
      .limit(200);
    const log = await this.db.select().from(dataErasureLog).orderBy(desc(dataErasureLog.executedAt)).limit(200);
    return {
      requests: rows.map((x) => ({
        id: x.r.id,
        tenantId: x.r.tenantId,
        company: x.name,
        status: x.r.status,
        requestedAt: x.r.requestedAt,
        requestedByEmail: x.r.requestedByEmail,
        scheduledFor: x.r.scheduledFor,
        exportWaived: x.r.exportWaived,
        holdReason: x.r.holdReason,
      })),
      erased: log.map((l) => ({
        id: l.id,
        tenantId: l.tenantId,
        company: l.companyName,
        requestedByEmail: l.requestedByEmail,
        requestedAt: l.requestedAt,
        executedAt: l.executedAt,
        exportWaived: l.exportWaived,
        rowsDeleted: l.rowsDeleted,
        tablesTouched: l.tablesTouched,
      })),
    };
  }

  async hold(by: string, id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Alasan penahanan wajib diisi');
    const [r] = await this.db
      .update(dataDeletionRequests)
      .set({ status: 'ON_HOLD', holdReason: reason.slice(0, 500), heldBy: by })
      .where(and(eq(dataDeletionRequests.id, id), eq(dataDeletionRequests.status, 'SCHEDULED')))
      .returning();
    if (!r) throw new NotFoundException('Permintaan tidak ditemukan atau tidak sedang terjadwal');
    return { id, status: r.status };
  }

  async release(by: string, id: string) {
    const [r] = await this.db
      .update(dataDeletionRequests)
      .set({ status: 'SCHEDULED', holdReason: null, heldBy: null })
      .where(and(eq(dataDeletionRequests.id, id), eq(dataDeletionRequests.status, 'ON_HOLD')))
      .returning();
    if (!r) throw new NotFoundException('Permintaan tidak ditemukan atau tidak sedang ditahan');
    this.logger.log(`Penahanan ${id} dilepas oleh ${by}`);
    return { id, status: r.status };
  }

  // ----------------------------------------------------------------- penjadwal
  /** Jalankan permintaan yang sudah jatuh tempo dan kirim pengingat. Aman dipanggil berulang. */
  async runDue(today = todayJakarta()) {
    const result = { executed: 0, waitingExport: 0, reminded: 0, failed: 0 };
    const due = await this.db
      .select()
      .from(dataDeletionRequests)
      .where(and(eq(dataDeletionRequests.status, 'SCHEDULED'), lte(dataDeletionRequests.scheduledFor, today)));
    for (const r of due) {
      try {
        const exported = r.exportWaived || (await this.hasExport(r.tenantId, r.requestedAt));
        if (!exported) {
          // Tanpa ekspor dan tanpa pelepasan eksplisit, data TIDAK dihapus; pemilik diingatkan berkala
          result.waitingExport++;
          if (
            await this.remind(r, today, 'Penghapusan data menunggu ekspor Anda', [
              `Penghapusan data perusahaan sudah jatuh tempo (${r.scheduledFor}), tetapi belum ada ekspor data yang diunduh.`,
              'Unduh ekspor di Pengaturan › Data & privasi agar penghapusan dapat dijalankan, atau batalkan permintaan bila Anda berubah pikiran.',
            ])
          )
            result.reminded++;
          continue;
        }
        await this.execute(r);
        result.executed++;
      } catch (e) {
        result.failed++;
        this.logger.error(`Penghapusan ${r.tenantId} gagal (tidak ada data yang terhapus): ${(e as Error).message}`);
        void telegram(
          `⚠️ Penghapusan data gagal dan dibatalkan seluruhnya (tenant ${r.tenantId}): ${(e as Error).message.slice(0, 300)}`,
        ).catch(() => undefined);
      }
    }
    const soon = await this.db
      .select()
      .from(dataDeletionRequests)
      .where(
        and(
          eq(dataDeletionRequests.status, 'SCHEDULED'),
          gt(dataDeletionRequests.scheduledFor, today),
          lte(dataDeletionRequests.scheduledFor, addDays(today, REMIND_WITHIN_DAYS)),
        ),
      );
    for (const r of soon)
      if (
        await this.remind(r, today, 'Pengingat: data perusahaan akan dihapus', [
          `Seluruh data perusahaan Anda dijadwalkan dihapus permanen pada ${r.scheduledFor}.`,
          'Jika Anda ingin membatalkannya, lakukan sebelum tanggal itu di Pengaturan › Data & privasi.',
        ])
      )
        result.reminded++;
    return result;
  }

  private async remind(r: Req, today: string, subject: string, lines: string[]): Promise<boolean> {
    if (r.lastReminderAt && Date.now() - r.lastReminderAt.getTime() < REMIND_EVERY_DAYS * 86_400_000) return false;
    await this.notify(r.tenantId, subject, subject, lines);
    await this.db
      .update(dataDeletionRequests)
      .set({ lastReminderAt: new Date() })
      .where(eq(dataDeletionRequests.id, r.id));
    this.logger.log(`Pengingat penghapusan terkirim (${r.tenantId}, ${today})`);
    return true;
  }

  private async execute(r: Req) {
    await this.assertNotPlatform(r.tenantId);
    const [company] = await this.db.select().from(tenants).where(eq(tenants.id, r.tenantId));
    if (!company) return;
    const to = await this.recipients(r.tenantId);
    if (!to.includes(r.requestedByEmail)) to.push(r.requestedByEmail);
    // Cabut semua sesi selagi penghapusan berjalan; catat siapa yang aktif agar bisa dipulihkan persis bila penghapusan dibatalkan
    const wasActive = (
      await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, r.tenantId), eq(users.isActive, true)))
    ).map((x) => x.id);
    await this.db
      .update(users)
      .set({ isActive: false, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.tenantId, r.tenantId));

    const pool = createPool(); // koneksi admin (pemilik tabel): satu-satunya yang boleh menghapus jurnal dan lintas RLS
    let res;
    try {
      res = await eraseTenant(createDb(pool), r.tenantId);
      await createDb(pool)
        .insert(dataErasureLog)
        .values({
          tenantId: r.tenantId,
          companyName: company.name,
          requestedByEmail: r.requestedByEmail,
          requestedAt: r.requestedAt,
          exportWaived: r.exportWaived,
          rowsDeleted: res.rowsDeleted,
          tablesTouched: res.tablesTouched,
          detail: res.perTable,
        });
    } catch (e) {
      // Penghapusan dibatalkan seluruhnya oleh transaksi; aktifkan kembali hanya pengguna yang tadinya aktif
      if (wasActive.length) await this.db.update(users).set({ isActive: true }).where(inArray(users.id, wasActive));
      throw e;
    } finally {
      await pool.end();
    }
    // gambar bukti di penyimpanan objek ikut dihapus; gagal tidak membatalkan penghapusan basis data (sudah selesai) tetapi dilaporkan
    try {
      const files = await this.storage.deleteTenant(r.tenantId);
      if (files) this.logger.log(`${files} berkas gambar perusahaan ${r.tenantId} dihapus dari penyimpanan`);
    } catch (e) {
      this.logger.error(`Gagal menghapus berkas gambar perusahaan ${r.tenantId}: ${(e as Error).message}`);
      void telegram(
        `⚠️ Berkas gambar perusahaan ${company.name} (${r.tenantId}) belum terhapus dari penyimpanan: ${(e as Error).message}`,
      ).catch(() => undefined);
    }
    this.logger.log(`Data perusahaan ${r.tenantId} dihapus: ${res.rowsDeleted} baris, ${res.tablesTouched} tabel`);
    for (const email of to) {
      await this.mail.send({
        to: email,
        subject: 'Data perusahaan Anda telah dihapus',
        heading: 'Penghapusan data selesai',
        paragraphs: [
          `Seluruh data perusahaan ${company.name} telah dihapus permanen dari SANSU sesuai permintaan.`,
          backupNote(),
          'Terima kasih telah memakai SANSU.',
        ],
      });
    }
    void telegram(`🗑️ Data perusahaan dihapus: ${company.name} (${res.rowsDeleted} baris)`).catch(() => undefined);
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () =>
      void this.runDue().catch((e) => this.logger.error(`Penjadwal penghapusan error: ${(e as Error).message}`));
    setTimeout(run, 300_000).unref();
    this.timer = setInterval(run, 6 * 60 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

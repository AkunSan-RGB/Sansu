import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { telegram } from '../../common/monitor/error-monitor';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { BackupReportDto } from './backup-status.dto';
import { BackupKind } from './backup-status.shared';
import { PlatformSettingsRepository } from '../../common/platform-settings.repository';
import { schedulersEnabled } from '../../common/schedulers';

export interface BackupEntry extends Omit<BackupReportDto, 'detail'> {
  at: string;
  detail?: Record<string, number>;
}

export type BackupState = 'NEVER' | 'OK' | 'FAILED' | 'STALE';

export interface BackupKindStatus {
  state: BackupState;
  last: BackupEntry | null;
  lastOk: BackupEntry | null;
  ageHours: number | null;
}

export interface BackupOverview {
  configured: boolean;
  maxAgeHours: number;
  restoreMaxAgeDays: number;
  dump: BackupKindStatus;
  restoreTest: BackupKindStatus;
  history: BackupEntry[];
}

const HISTORY_KEY = 'backup.history';

const lastKey = (k: BackupKind) => `backup.last.${k}`;

const lastOkKey = (k: BackupKind) => `backup.lastOk.${k}`;

const HISTORY_MAX = 30;

export const backupToken = () => {
  const t = process.env.BACKUP_REPORT_TOKEN ?? '';
  return t.length >= 24 ? t : null;
};

const num = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

export const BACKUP_MAX_AGE_HOURS = () => num(process.env.BACKUP_MAX_AGE_HOURS, 26);

export const RESTORE_MAX_AGE_DAYS = () => num(process.env.RESTORE_TEST_MAX_AGE_DAYS, 40);

export function kindState(last: BackupEntry | null, lastOk: BackupEntry | null, maxAgeHours: number, now = Date.now()): BackupKindStatus {
  const ageHours = lastOk ? (now - new Date(lastOk.at).getTime()) / 3_600_000 : null;
  if (!last) return { state: 'NEVER', last, lastOk, ageHours };
  // gagal terakhir lebih baru daripada sukses terakhir → GAGAL; sukses terakhir terlalu lama → BASI
  if (last.status === 'FAILED') return { state: 'FAILED', last, lastOk, ageHours };
  return { state: ageHours !== null && ageHours > maxAgeHours ? 'STALE' : 'OK', last, lastOk, ageHours };
}

@Injectable()
export class BackupStatusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Backup');
  private timer?: NodeJS.Timeout;
  private lastAlertAt = 0;
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly platformSettings: PlatformSettingsRepository,
  ) {}

  private async read<T>(key: string): Promise<T | null> {
    const r = await this.platformSettings.find(this.db, key);
    return (r?.value as T) ?? null;
  }
  private async write(key: string, value: unknown) {
    await this.platformSettings.upsert(this.db, key, value);
  }

  /** Token laporan sah? (perbandingan waktu-tetap; nonaktif bila token belum diisi) */
  authorize(header: string | undefined) {
    const t = backupToken();
    if (!t) throw new NotFoundException('Pelaporan backup belum diaktifkan');
    const a = createHash('sha256').update(String(header ?? '')).digest();
    const b = createHash('sha256').update(t).digest();
    if (!timingSafeEqual(a, b)) throw new UnauthorizedException('Token backup salah');
  }

  async report(dto: BackupReportDto): Promise<BackupEntry> {
    const entry: BackupEntry = { ...dto, at: new Date().toISOString() };
    await this.write(lastKey(dto.kind), entry);
    if (dto.status === 'OK') await this.write(lastOkKey(dto.kind), entry);
    const history = ((await this.read<BackupEntry[]>(HISTORY_KEY)) ?? []).slice(0, HISTORY_MAX - 1);
    await this.write(HISTORY_KEY, [entry, ...history]);
    if (dto.status === 'FAILED') void telegram(`⚠️ ${dto.kind === 'DUMP' ? 'Backup database' : 'Uji pemulihan backup'} GAGAL (${dto.source}): ${dto.note ?? 'tanpa keterangan'}`).catch(() => undefined);
    else if (dto.kind === 'DUMP' && dto.offsite === false) void telegram(`⚠️ Backup database tersimpan, tetapi TANPA salinan di luar penyedia (${dto.source}).`).catch(() => undefined);
    return entry;
  }

  async overview(): Promise<BackupOverview> {
    const state = async (k: BackupKind, maxAgeHours: number) => kindState(await this.read<BackupEntry>(lastKey(k)), await this.read<BackupEntry>(lastOkKey(k)), maxAgeHours);
    return {
      configured: backupToken() !== null,
      maxAgeHours: BACKUP_MAX_AGE_HOURS(),
      restoreMaxAgeDays: RESTORE_MAX_AGE_DAYS(),
      dump: await state('DUMP', BACKUP_MAX_AGE_HOURS()),
      restoreTest: await state('RESTORE_TEST', RESTORE_MAX_AGE_DAYS() * 24),
      history: (await this.read<BackupEntry[]>(HISTORY_KEY)) ?? [],
    };
  }

  /** Pesan Telegram bila backup gagal atau basi (paling sering sekali per 24 jam); hanya bila pelaporan aktif dan pernah ada laporan */
  async alertIfNeeded(now = Date.now()): Promise<string | null> {
    if (!backupToken()) return null;
    const o = await this.overview();
    const problem = o.dump.state === 'FAILED' ? 'backup terakhir GAGAL' : o.dump.state === 'STALE' ? `backup terakhir sukses sudah ${Math.floor(o.dump.ageHours ?? 0)} jam lalu (batas ${o.maxAgeHours} jam)` : null;
    if (!problem || now - this.lastAlertAt < 24 * 3_600_000) return null;
    this.lastAlertAt = now;
    await telegram(`⚠️ Backup database SANSU bermasalah: ${problem}. Periksa pelaksana backup (GitHub Actions / server).`).catch(() => undefined);
    return problem;
  }

  onModuleInit() {

    if (!schedulersEnabled()) return; // banyak proses: hanya satu yang menjalankan tugas berkala
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.alertIfNeeded().catch((e: Error) => this.logger.warn(`Pemeriksaan status backup gagal: ${e.message}`)), 60 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

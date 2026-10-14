/**
 * Pembukuan otomatis: pekerjaan Akuntan yang bisa dikerjakan sistem sehingga perusahaan tanpa Akuntan tetap terbukukan rapi.
 * Semua langkah berdasarkan aturan tetap (tanpa keputusan subjektif), idempoten, tercatat di jejak audit (AUTO_*),
 * dan dikerjakan atas nama Pemilik. Kegagalan memberi tahu Pemilik lewat Telegram dan tidak menghentikan langkah lain.
 *   - payroll    : posting jurnal gaji draf yang sudah lewat tanggal bayar dan sudah >24 jam (jeda koreksi SDM)
 *   - fx         : penilaian ulang piutang/utang valas pada akhir bulan lalu (bila semua kurs tersedia)
 *   - lock       : kunci periode bulan lalu pada tanggal tertentu (hanya maju, tidak pernah membuka)
 *   - closeYear  : tutup buku tahun lalu setelah Februari, bila periodenya sudah terkunci
 * Yang sudah otomatis sebelumnya: penyusutan aset (Aset Tetap), jurnal berulang & jurnal balik terjadwal, aturan bank, anggaran.
 */
import { Body, Controller, Get, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { PeriodService } from '../../common/period/period.service';
import { SettingsService } from '../../common/settings.service';
import { TelegramService } from '../../common/telegram/telegram.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { FxModule } from '../fx/fx.module';
import { FxService } from '../fx/fx.service';
import { PayrollModule } from '../payroll/payroll.module';
import { PayrollService } from '../payroll/payroll.module';
import { AccountingModule } from './accounting.module';
import { AccountingService } from './accounting.service';

export const AUTO_BOOKKEEPING_DEFAULTS = { payroll: true, fx: true, lock: false, lockDay: 10, closeYear: false };
export type AutoBookkeepingSettings = typeof AUTO_BOOKKEEPING_DEFAULTS;

export class AutoBookkeepingDto {
  @ApiPropertyOptional({ description: 'Posting jurnal gaji otomatis setelah tanggal bayar' }) @IsOptional() @IsBoolean() payroll?: boolean;
  @ApiPropertyOptional({ description: 'Penilaian ulang valas akhir bulan otomatis' }) @IsOptional() @IsBoolean() fx?: boolean;
  @ApiPropertyOptional({ description: 'Kunci periode bulan lalu otomatis' }) @IsOptional() @IsBoolean() lock?: boolean;
  @ApiPropertyOptional({ description: 'Tanggal (1-28) kunci otomatis bulan lalu', example: 10 }) @IsOptional() @IsInt() @Min(1) @Max(28) lockDay?: number;
  @ApiPropertyOptional({ description: 'Tutup buku tahun lalu otomatis (setelah Februari, periode harus terkunci)' }) @IsOptional() @IsBoolean() closeYear?: boolean;
}

export interface AutoRunOptions {
  today?: string;
  /** Jeda minimal sejak draf gaji dibuat sebelum diposting otomatis (jam); 24 bila tidak diisi */
  payrollMinAgeHours?: number;
}
export interface AutoRunResult {
  payrollPosted: string[];
  fxRevalued: string | null;
  locked: string | null;
  closedYear: number | null;
  skipped: string[];
}

@Injectable()
export class AutoBookkeepingService {
  private readonly logger = new Logger('PembukuanOtomatis');
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly payroll: PayrollService,
    private readonly fx: FxService,
    private readonly accounting: AccountingService,
    private readonly period: PeriodService,
    private readonly telegram: TelegramService,
  ) {}

  get(tenantId: string): Promise<AutoBookkeepingSettings> {
    return this.settings.section(this.db, tenantId, 'autoBookkeeping', AUTO_BOOKKEEPING_DEFAULTS);
  }

  async save(user: AuthUser, dto: AutoBookkeepingDto) {
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<AutoBookkeepingSettings>;
    const before = await this.get(user.tenantId);
    const after = await this.settings.saveSection(this.db, user.tenantId, 'autoBookkeeping', AUTO_BOOKKEEPING_DEFAULTS, patch);
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'AutoBookkeeping', entityId: user.tenantId, data: { before, after } });
    return after;
  }

  /** Kandidat: perusahaan dengan draf gaji, utang valas/piutang valas, atau kunci/tutup buku otomatis yang menyala */
  private async candidates(): Promise<string[]> {
    const r = await this.db.execute<{ id: string }>(sql`
      SELECT DISTINCT id FROM (
        SELECT tenant_id AS id FROM payroll_runs WHERE status = 'DRAFT'
        UNION SELECT tenant_id FROM invoices WHERE currency <> 'IDR' AND status <> 'PAID'
        UNION SELECT tenant_id FROM purchase_invoices WHERE currency <> 'IDR' AND status <> 'PAID'
        UNION SELECT id FROM tenants WHERE settings->'autoBookkeeping'->>'lock' = 'true' OR settings->'autoBookkeeping'->>'closeYear' = 'true'
      ) t`);
    return r.rows.map((x) => x.id);
  }

  async runAll() {
    for (const id of await this.candidates()) {
      try {
        const r = await this.runTenant(id);
        if (r.payrollPosted.length || r.fxRevalued || r.locked || r.closedYear) this.logger.log(`Otomatis ${id}: ${JSON.stringify(r)}`);
      } catch (e) {
        this.logger.warn(`Pembukuan otomatis gagal untuk ${id}: ${(e as Error).message}`);
      }
    }
  }

  async runTenant(tenantId: string, opts: AutoRunOptions = {}): Promise<AutoRunResult> {
    const out: AutoRunResult = { payrollPosted: [], fxRevalued: null, locked: null, closedYear: null, skipped: [] };
    const [owner] = (await this.db.execute<{ id: string; email: string }>(sql`SELECT id, email FROM users WHERE tenant_id = ${tenantId} AND role = 'OWNER' AND is_active ORDER BY created_at LIMIT 1`)).rows;
    if (!owner) return out;
    const user: AuthUser = { sub: owner.id, tenantId, role: 'OWNER', email: owner.email };
    const cfg = await this.get(tenantId);
    const today = opts.today ?? todayJakarta();
    const prevMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
    const fail = async (what: string, e: unknown) => {
      const reason = (e as Error).message;
      out.skipped.push(`${what}: ${reason}`);
      this.logger.warn(`${what} gagal untuk ${tenantId}: ${reason}`);
      try {
        await this.telegram.notifyUsers([owner.id], `⚠️ ${what} gagal: ${reason}\nKerjakan manual di menu terkait atau perbaiki penyebabnya.`);
      } catch {
        /* pemberitahuan opsional */
      }
    };

    // 1. Posting jurnal gaji
    if (cfg.payroll) {
      const minAge = opts.payrollMinAgeHours ?? 24;
      const runs = (await this.db.execute<{ id: string; number: string; period: string }>(sql`
        SELECT id, number, period FROM payroll_runs
        WHERE tenant_id = ${tenantId} AND status = 'DRAFT' AND pay_date <= ${today} AND created_at <= now() - (${minAge} * interval '1 hour')
        ORDER BY period`)).rows;
      for (const run of runs) {
        try {
          await this.payroll.post(user, run.id);
          out.payrollPosted.push(run.number);
          await this.audit.log(this.db, { tenantId, userId: owner.id, action: 'AUTO_PAYROLL_POST', entity: 'PayrollRun', entityId: run.id, data: { number: run.number, period: run.period } });
        } catch (e) {
          await fail(`Posting gaji otomatis ${run.period}`, e);
        }
      }
    }

    // 2. Penilaian ulang valas akhir bulan lalu
    if (cfg.fx) {
      try {
        const exp = await this.fx.exposure(tenantId, prevMonthEnd);
        const [dup] = (await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'FX_REVAL' AND date = ${prevMonthEnd}`)).rows;
        if (!exp.rows.length) out.skipped.push('Penilaian ulang valas: tidak ada piutang/utang valas terbuka');
        else if (exp.missingRates.length) out.skipped.push(`Penilaian ulang valas: kurs ${exp.missingRates.join(', ')} belum diisi`);
        else if (!dup.n) {
          const lockedUntil = await this.period.lockedUntil(this.db, tenantId);
          if (lockedUntil && prevMonthEnd <= lockedUntil) out.skipped.push('Penilaian ulang valas: periode sudah terkunci');
          else {
            await this.fx.revalue(user, { date: prevMonthEnd });
            out.fxRevalued = prevMonthEnd;
            await this.audit.log(this.db, { tenantId, userId: owner.id, action: 'AUTO_FX_REVALUATION', entity: 'Tenant', entityId: tenantId, data: { date: prevMonthEnd } });
          }
        }
      } catch (e) {
        await fail(`Penilaian ulang valas otomatis ${prevMonthEnd}`, e);
      }
    }

    // 3. Kunci periode bulan lalu (hanya maju)
    if (cfg.lock && Number(today.slice(8, 10)) >= cfg.lockDay) {
      try {
        const current = await this.period.lockedUntil(this.db, tenantId);
        if (!current || current < prevMonthEnd) {
          const [draft] = (await this.db.execute<{ period: string }>(sql`SELECT period FROM payroll_runs WHERE tenant_id = ${tenantId} AND status = 'DRAFT' AND period <= ${prevMonthEnd.slice(0, 7)} ORDER BY period LIMIT 1`)).rows;
          const [pending] = (await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE tenant_id = ${tenantId} AND status = 'PENDING'`)).rows;
          if (draft) out.skipped.push(`Kunci periode: gaji ${draft.period} masih draf`);
          else if (pending.n) out.skipped.push(`Kunci periode: ${pending.n} permintaan persetujuan masih menunggu`);
          else {
            await this.accounting.lockPeriod(user, prevMonthEnd);
            out.locked = prevMonthEnd;
            await this.audit.log(this.db, { tenantId, userId: owner.id, action: 'AUTO_LOCK_PERIOD', entity: 'Tenant', entityId: tenantId, data: { from: current, to: prevMonthEnd } });
          }
        }
      } catch (e) {
        await fail(`Kunci periode otomatis ${prevMonthEnd}`, e);
      }
    }

    // 4. Tutup buku tahun lalu
    const year = Number(today.slice(0, 4)) - 1;
    if (cfg.closeYear && today >= `${year + 1}-03-01`) {
      try {
        const lockedUntil = await this.period.lockedUntil(this.db, tenantId);
        const [closed] = (await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'CLOSING' AND source_id = ${String(year)}`)).rows;
        if (closed.n) {
          /* sudah ditutup */
        } else if (!lockedUntil || lockedUntil < `${year}-12-31`) out.skipped.push(`Tutup buku ${year}: periode belum terkunci sampai 31 Desember ${year}`);
        else {
          try {
            await this.accounting.closeYear(user, { year });
            out.closedYear = year;
            await this.audit.log(this.db, { tenantId, userId: owner.id, action: 'AUTO_CLOSE_YEAR', entity: 'Tenant', entityId: tenantId, data: { year } });
          } catch (e) {
            if (!/Tidak ada saldo/.test((e as Error).message)) throw e;
          }
        }
      } catch (e) {
        await fail(`Tutup buku otomatis ${year}`, e);
      }
    }
    return out;
  }
}

@ApiTags('accounting')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('accounting/auto')
export class AutoBookkeepingController {
  constructor(private readonly svc: AutoBookkeepingService) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.svc.get(u.tenantId);
  }

  @Put()
  @Roles('ADMIN', 'ACCOUNTANT')
  save(@CurrentUser() u: AuthUser, @Body() dto: AutoBookkeepingDto) {
    return this.svc.save(u, dto);
  }

  /** Jalankan sekarang (biasanya berjalan sendiri tiap jam) */
  @Post('run')
  @Roles('ADMIN', 'ACCOUNTANT')
  run(@CurrentUser() u: AuthUser) {
    return this.svc.runTenant(u.tenantId);
  }
}

@Injectable()
export class AutoBookkeepingScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger('PembukuanOtomatis');
  constructor(private readonly svc: AutoBookkeepingService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.svc.runAll().catch((e) => this.logger.error(e));
    setTimeout(run, 120_000).unref();
    this.timer = setInterval(run, 60 * 60_000); // tiap jam; idempoten
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

@Module({
  imports: [AccountingModule, PayrollModule, FxModule],
  controllers: [AutoBookkeepingController],
  providers: [AutoBookkeepingService, AutoBookkeepingScheduler],
  exports: [AutoBookkeepingService],
})
export class AutoBookkeepingModule {}

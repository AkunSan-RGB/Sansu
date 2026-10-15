/**
 * Target & komisi sales lapangan. Pesanan penjualan dikaitkan ke sales (salesperson_id); omzet = DPP faktur bulan itu
 * dikurangi DPP retur penjualan bulan itu. Komisi = persen × omzet neto, hanya bila pencapaian ≥ ambang. Ini perhitungan
 * informasi untuk penggajian/insentif; sistem tidak membuat jurnal komisi otomatis. Hanya Pemilik/Admin yang mengatur target.
 */
import { BadRequestException, Body, Controller, Get, Injectable, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumberString, IsOptional, IsUUID, Matches, ValidateNested } from 'class-validator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../../common/auth/decorators';
import { todayJakarta } from '../../../common/utils/dates';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { salesTargets, users } from '../../../db/schema';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class TargetQueryDto {
  @ApiPropertyOptional({ example: '2026-10', description: 'Bulan; kosong = bulan berjalan' }) @IsOptional() @Matches(PERIOD) month?: string;
}
export class TargetItemDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty({ example: '150000000' }) @IsNumberString() targetAmount: string;
  @ApiProperty({ example: '1.5' }) @IsNumberString() commissionPct: string;
  @ApiPropertyOptional({ example: '80', description: 'Komisi hanya bila pencapaian ≥ persen ini' }) @IsOptional() @IsNumberString() minAchievementPct?: string;
}
export class SaveTargetsDto {
  @ApiProperty({ example: '2026-10' }) @Matches(PERIOD) period: string;
  @ApiProperty({ type: [TargetItemDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => TargetItemDto) items: TargetItemDto[];
}

const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
};

@Injectable()
export class SalesTargetsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async performance(u: AuthUser, month?: string) {
    const period = month ?? todayJakarta().slice(0, 7);
    const from = `${period}-01`;
    const to = nextMonth(period);
    const people = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, u.tenantId), eq(users.role, 'SALES'), eq(users.isActive, true)));
    const targets = await this.db.select().from(salesTargets).where(and(eq(salesTargets.tenantId, u.tenantId), eq(salesTargets.period, period)));
    const sold = await this.db.execute<{ sp: string; v: string; n: string }>(sql`
      SELECT o.salesperson_id AS sp, COALESCE(SUM(i.subtotal), 0) AS v, COUNT(*)::text AS n
      FROM invoices i JOIN sales_orders o ON o.id = i.sales_order_id
      WHERE i.tenant_id = ${u.tenantId} AND o.salesperson_id IS NOT NULL AND i.date >= ${from} AND i.date < ${to}
      GROUP BY o.salesperson_id`);
    const returned = await this.db.execute<{ sp: string; v: string }>(sql`
      SELECT o.salesperson_id AS sp, COALESCE(SUM(r.subtotal), 0) AS v
      FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id JOIN sales_orders o ON o.id = i.sales_order_id
      WHERE r.tenant_id = ${u.tenantId} AND o.salesperson_id IS NOT NULL AND r.date >= ${from} AND r.date < ${to}
      GROUP BY o.salesperson_id`);
    const soldBy = new Map(sold.rows.map((r) => [r.sp, r]));
    const retBy = new Map(returned.rows.map((r) => [r.sp, r.v]));
    const tBy = new Map(targets.map((t) => [t.userId, t]));
    // orang yang pernah punya target atau penjualan bulan itu tetap tampil walau perannya sudah berubah
    const extraIds = [...new Set([...tBy.keys(), ...soldBy.keys()])].filter((id) => !people.some((p) => p.id === id));
    const extra = extraIds.length ? await this.db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.tenantId, u.tenantId), inArray(users.id, extraIds))) : [];
    let rows = [...people, ...extra].map((p) => {
      const t = tBy.get(p.id);
      const gross = D(soldBy.get(p.id)?.v);
      const ret = D(retBy.get(p.id));
      const net = gross.minus(ret);
      const target = D(t?.targetAmount);
      const pct = target.gt(0) ? net.div(target).times(100) : null;
      const eligible = !!t && D(t.commissionPct).gt(0) && (pct === null ? false : pct.gte(t.minAchievementPct));
      const commission = eligible ? net.times(t!.commissionPct).div(100) : D(0);
      return {
        userId: p.id,
        name: p.name,
        invoices: Number(soldBy.get(p.id)?.n ?? 0),
        gross: gross.toFixed(2),
        returns: ret.toFixed(2),
        net: net.toFixed(2),
        target: target.toFixed(2),
        hasTarget: !!t,
        achievementPct: pct ? pct.toFixed(1) : null,
        commissionPct: D(t?.commissionPct).toFixed(2),
        minAchievementPct: D(t?.minAchievementPct).toFixed(2),
        commission: commission.round().toFixed(2),
        commissionNote: !t ? 'Belum ada target' : eligible ? null : D(t.commissionPct).isZero() ? 'Tanpa komisi' : 'Pencapaian di bawah ambang komisi',
      };
    });
    // Sales hanya melihat angkanya sendiri
    if (u.role === 'SALES') rows = rows.filter((r) => r.userId === u.sub);
    rows.sort((a, b) => Number(b.net) - Number(a.net));
    const sum = (k: 'net' | 'target' | 'commission') => rows.reduce((a, r) => a.plus(r[k]), D(0)).toFixed(2);
    return { period, rows, totals: { net: sum('net'), target: sum('target'), commission: sum('commission') } };
  }

  async save(u: AuthUser, dto: SaveTargetsDto) {
    const ids = [...new Set(dto.items.map((i) => i.userId))];
    if (ids.length !== dto.items.length) throw new BadRequestException('Satu sales tidak boleh muncul dua kali');
    if (ids.length) {
      const found = await this.db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, u.tenantId), eq(users.role, 'SALES'), inArray(users.id, ids)));
      if (found.length !== ids.length) throw new BadRequestException('Target hanya untuk pengguna berperan Sales di perusahaan ini');
    }
    for (const i of dto.items) {
      if (D(i.targetAmount).lt(0)) throw new BadRequestException('Target tidak boleh negatif');
      const c = D(i.commissionPct);
      const m = D(i.minAchievementPct);
      if (c.lt(0) || c.gt(100)) throw new BadRequestException('Komisi harus 0–100%');
      if (m.lt(0) || m.gt(100)) throw new BadRequestException('Ambang pencapaian harus 0–100%');
    }
    const before = await this.db.select().from(salesTargets).where(and(eq(salesTargets.tenantId, u.tenantId), eq(salesTargets.period, dto.period)));
    await this.db.transaction(async (tx) => {
      await tx.delete(salesTargets).where(and(eq(salesTargets.tenantId, u.tenantId), eq(salesTargets.period, dto.period)));
      if (dto.items.length) {
        await tx.insert(salesTargets).values(
          dto.items.map((i) => ({ tenantId: u.tenantId, userId: i.userId, period: dto.period, targetAmount: D(i.targetAmount).toFixed(2), commissionPct: D(i.commissionPct).toFixed(2), minAchievementPct: D(i.minAchievementPct).toFixed(2) })),
        );
      }
      await this.audit.log(tx, {
        tenantId: u.tenantId,
        userId: u.sub,
        action: 'UPDATE',
        entity: 'SalesTargets',
        entityId: dto.period,
        data: { period: dto.period, before: before.map((b) => ({ userId: b.userId, target: b.targetAmount, commissionPct: b.commissionPct })), after: dto.items },
      });
    });
    return this.performance(u, dto.period);
  }
}

@ApiTags('Penjualan')
@ApiBearerAuth()
@Controller('sales-targets')
export class SalesTargetsController {
  constructor(private readonly svc: SalesTargetsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES')
  list(@CurrentUser() u: AuthUser, @Query() q: TargetQueryDto) {
    return this.svc.performance(u, q.month);
  }

  @Put()
  @Roles('ADMIN')
  save(@CurrentUser() u: AuthUser, @Body() dto: SaveTargetsDto) {
    return this.svc.save(u, dto);
  }
}

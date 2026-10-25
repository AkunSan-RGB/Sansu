import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DEPRECIATION_METHOD_LABELS } from '@sansu/shared';
import { and, eq, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { todayJakarta } from '../../common/utils/dates';
import { D, ZERO } from '../../common/utils/money';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { assetCategories, assetUsage, fixedAssets } from '../../db/schema';
import { AssetRepository } from './asset.repository';
import { monthIndex, periodOf, type MethodChange } from './depreciation';
import { UsageDto, ChangeMethodDto } from './assets.dto';
import { AssetsService } from './assets.service';
import { patchById } from '../../db/owned';
import { AssetMethodRepository } from './asset-method.repository';

@Injectable()
export class AssetMethodService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly repo: AssetRepository,
    private readonly assets: AssetsService,
    private readonly queries: AssetMethodRepository,
  ) {}

  /** Catatan pemakaian bulanan (metode unit produksi) */
  async usageList(tenantId: string, id: string, db: DbOrTx = this.db) {
    const a = await this.repo.assetById(db, tenantId, id);
    if (!a) throw new NotFoundException('Aset tidak ditemukan');
    const rows = await this.repo.usageRowsOrdered(db, tenantId, id);
    const total = rows.reduce((t, r) => t.plus(r.units), ZERO);
    return {
      method: a.method,
      totalUnits: a.totalUnits,
      unitLabel: a.unitLabel,
      usedUnits: total.toFixed(4),
      remainingUnits: D(a.totalUnits ?? 0)
        .minus(total)
        .toFixed(4),
      rows,
    };
  }

  /**
   * Catat (atau koreksi) pemakaian satu bulan. Hanya untuk bulan yang belum disusutkan; total pemakaian tidak boleh melebihi kapasitas.
   * Staf Gudang/Produksi tidak punya akses: pemakaian menentukan beban penyusutan, jadi dicatat Admin/Akuntan dan terekam di jejak audit.
   */
  async setUsage(user: AuthUser, id: string, dto: UsageDto) {
    const units = D(dto.units);
    if (units.lt(0)) throw new BadRequestException('Pemakaian tidak boleh negatif');
    return this.db.transaction(async (tx) => {
      const a = await tx.query.fixedAssets.findFirst({
        where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)),
      });
      if (!a) throw new NotFoundException('Aset tidak ditemukan');
      if (a.method !== 'UNITS_OF_PRODUCTION')
        throw new BadRequestException('Aset ini tidak memakai metode unit produksi');
      if (a.status !== 'ACTIVE') throw new BadRequestException('Aset sudah dilepas');
      if (dto.period < a.depreciationStart.slice(0, 7))
        throw new BadRequestException('Bulan sebelum penyusutan dimulai');
      if (dto.period > todayJakarta().slice(0, 7))
        throw new BadRequestException('Pemakaian bulan depan belum bisa dicatat');
      const last = (await this.assets.postedTotals(tx, user.tenantId, '9999-12')).get(a.id)?.last;
      if (last && dto.period <= last)
        throw new BadRequestException(
          `Penyusutan sudah diposting sampai ${last}; pemakaian bulan itu tidak bisa diubah.`,
        );
      const [existing] = await this.queries.findAssetUsageByAssetIdAndPeriod(tx, id, dto.period);
      const others = (await this.queries.listAssetUsageByAssetId(tx, id))
        .filter((r) => r.period !== dto.period)
        .reduce((t, r) => t.plus(r.units), ZERO);
      if (others.plus(units).gt(D(a.totalUnits ?? 0)))
        throw new BadRequestException(
          `Total pemakaian melebihi kapasitas ${D(a.totalUnits ?? 0).toFixed(0)} ${a.unitLabel ?? 'unit'}`,
        );
      if (existing)
        await patchById(tx, assetUsage, existing.id, { units: units.toFixed(4), note: dto.note ?? null, createdById: user.sub });
      else
        await tx
          .insert(assetUsage)
          .values({
            tenantId: user.tenantId,
            assetId: id,
            period: dto.period,
            units: units.toFixed(4),
            note: dto.note ?? null,
            createdById: user.sub,
          });
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: existing ? 'UPDATE' : 'CREATE',
        entity: 'AssetUsage',
        entityId: id,
        data: { period: dto.period, units: units.toFixed(4), previous: existing?.units ?? null },
      });
      return this.usageList(user.tenantId, id, tx);
    });
  }

  /**
   * Ubah metode penyusutan satu aset: berlaku ke depan saja (tidak pernah mundur). Penyusutan sampai bulan sebelum bulan berlaku
   * diposting dulu dengan metode lama; sisa nilai buku (dikurangi residu) lalu disusutkan dengan metode baru selama sisa masa manfaat.
   * Staf selain Pemilik/Admin: menunggu persetujuan. Pemilik diberi tahu bila diubah orang lain.
   */
  async changeMethod(
    user: AuthUser,
    id: string,
    dto: ChangeMethodDto,
    opts: { approved?: boolean; silent?: boolean } = {},
  ) {
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 5) throw new BadRequestException('Isi alasan perubahan metode (minimal 5 huruf)');
    if (dto.method === 'NONE')
      throw new BadRequestException(
        'Aset yang disusutkan tidak bisa diubah menjadi "tidak disusutkan"; lepaskan asetnya bila sudah tidak dipakai.',
      );
    if (dto.method === 'UNITS_OF_PRODUCTION')
      throw new BadRequestException(
        'Metode unit produksi butuh total unit dan catatan pemakaian sejak awal; tidak bisa dipilih untuk aset yang sudah berjalan. Daftarkan aset baru dengan metode itu.',
      );
    const pre = await this.db.query.fixedAssets.findFirst({
      where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)),
    });
    if (!pre) throw new NotFoundException('Aset tidak ditemukan');
    if (!opts.approved && !this.approvals.isApprover(user.role)) {
      const req = await this.approvals.create(this.db, user, {
        kind: 'ASSET_METHOD',
        refId: id,
        title: `Ubah metode penyusutan ${pre.code} ${pre.name}`,
        amount: D(pre.cost).toNumber(),
        payload: JSON.parse(JSON.stringify({ id, ...dto })),
      });
      throw this.approvals.required(
        req.id,
        'Perubahan metode penyusutan menunggu persetujuan pemilik atau admin; permintaan dikirim dan metode diubah setelah disetujui.',
      );
    }
    const effective = dto.effectiveMonth ?? todayJakarta().slice(0, 7);
    const res = await this.db.transaction(async (tx) => {
      const a = await tx.query.fixedAssets.findFirst({
        where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)),
      });
      if (!a) throw new NotFoundException('Aset tidak ditemukan');
      if (a.status !== 'ACTIVE') throw new BadRequestException('Aset sudah dilepas');
      if (a.method === 'NONE') throw new BadRequestException('Aset ini tidak disusutkan (mis. tanah)');
      if (a.method === dto.method) throw new BadRequestException('Metode baru sama dengan metode sekarang');
      if (a.method === 'UNITS_OF_PRODUCTION')
        throw new BadRequestException(
          'Aset dengan metode unit produksi tidak bisa dipindah ke metode lain; riwayat pemakaiannya menjadi dasar penyusutan.',
        );
      if (effective < a.depreciationStart.slice(0, 7))
        throw new BadRequestException('Bulan berlaku sebelum penyusutan dimulai');
      if (effective > todayJakarta().slice(0, 7))
        throw new BadRequestException('Bulan berlaku tidak boleh di masa depan');
      const lastChange = [...(a.methodChanges ?? [])].sort((x, y) => y.from.localeCompare(x.from))[0];
      if (lastChange && effective <= lastChange.from)
        throw new BadRequestException(
          `Metode sudah pernah diubah berlaku ${lastChange.from}; bulan berlaku harus sesudahnya`,
        );
      const last = (await this.assets.postedTotals(tx, user.tenantId, '9999-12')).get(a.id)?.last;
      if (last && effective <= last)
        throw new BadRequestException(
          `Penyusutan sudah diposting sampai ${last}; perubahan metode hanya berlaku ke depan, mulai ${periodOf(monthIndex(last) + 1)} atau sesudahnya.`,
        );
      // Susutkan dulu sampai bulan sebelum bulan berlaku dengan metode lama
      await this.assets.run(user, periodOf(monthIndex(effective) - 1), a.id, tx);
      const [p] = (
        await this.queries.queryAssetDepreciation(tx, a.id)
      ).rows;
      const acc = D(a.openingAccumulated).plus(p.total);
      if (D(a.cost).minus(acc).minus(a.residualValue).lte(0))
        throw new BadRequestException('Aset sudah habis disusutkan; tidak ada lagi yang perlu diubah metodenya');
      if (a.usefulLifeMonths - (monthIndex(effective) - monthIndex(a.depreciationStart.slice(0, 7))) <= 0)
        throw new BadRequestException('Masa manfaat aset sudah lewat');
      const change: MethodChange = {
        from: effective,
        method: dto.method,
        prevMethod: a.method,
        accumulatedAt: acc.toFixed(2),
      };
      await patchById(tx, fixedAssets, a.id, { method: dto.method, methodChanges: [...(a.methodChanges ?? []), change] });
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CHANGE_METHOD',
        entity: 'FixedAsset',
        entityId: a.id,
        data: {
          from: a.method,
          to: dto.method,
          effective,
          reason,
          accumulated: acc.toFixed(2),
          bookValue: D(a.cost).minus(acc).toFixed(2),
        },
      });
      return { name: `${a.code} ${a.name}`, from: a.method, to: dto.method };
    });
    if (!opts.silent && user.role !== 'OWNER') {
      void this.approvals.notifyRoles(user.tenantId, {
        roles: ['OWNER'],
        excludeUserId: user.sub,
        info: true,
        title: `Metode penyusutan diubah: ${res.name}`,
        lines: [
          `${DEPRECIATION_METHOD_LABELS[res.from as keyof typeof DEPRECIATION_METHOD_LABELS] ?? res.from} → ${DEPRECIATION_METHOD_LABELS[res.to as keyof typeof DEPRECIATION_METHOD_LABELS] ?? res.to}, berlaku ${effective}`,
          `Alasan: ${reason}`,
        ],
        path: '/fixed-assets',
      });
    }
    return this.assets.get(user.tenantId, id);
  }

  /** Ubah metode untuk semua aset aktif satu kategori (ke depan saja) dan jadikan metode bawaan aset baru di kategori itu */
  async changeCategoryMethod(
    user: AuthUser,
    categoryId: string,
    dto: ChangeMethodDto,
    opts: { approved?: boolean } = {},
  ) {
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 5) throw new BadRequestException('Isi alasan perubahan metode (minimal 5 huruf)');
    const cat = await this.repo.categoryById(this.db, user.tenantId, categoryId);
    if (!cat) throw new NotFoundException('Kategori tidak ditemukan');
    if (cat.method === 'NONE') throw new BadRequestException('Kategori ini tidak disusutkan (mis. tanah)');
    if (dto.method === 'UNITS_OF_PRODUCTION')
      throw new BadRequestException(
        'Metode unit produksi tidak bisa diterapkan ke aset yang sudah ada (butuh total unit per aset).',
      );
    if (!opts.approved && !this.approvals.isApprover(user.role)) {
      const req = await this.approvals.create(this.db, user, {
        kind: 'ASSET_METHOD',
        refId: categoryId,
        title: `Ubah metode penyusutan kategori ${cat.name}`,
        amount: 0,
        payload: JSON.parse(JSON.stringify({ categoryId, ...dto })),
      });
      throw this.approvals.required(
        req.id,
        'Perubahan metode penyusutan menunggu persetujuan pemilik atau admin; permintaan dikirim dan metode diubah setelah disetujui.',
      );
    }
    const list = await this.db.query.fixedAssets.findMany({
      where: and(
        eq(fixedAssets.tenantId, user.tenantId),
        eq(fixedAssets.categoryId, categoryId),
        eq(fixedAssets.status, 'ACTIVE'),
      ),
    });
    const changed: string[] = [];
    const skipped: { asset: string; why: string }[] = [];
    for (const a of list) {
      if (a.method === 'NONE' || a.method === dto.method || a.method === 'UNITS_OF_PRODUCTION') continue;
      try {
        await this.changeMethod(user, a.id, dto, { approved: true, silent: true });
        changed.push(`${a.code} ${a.name}`);
      } catch (e) {
        skipped.push({ asset: `${a.code} ${a.name}`, why: (e as Error).message });
      }
    }
    await patchById(this.db, assetCategories, categoryId, { method: dto.method });
    await this.audit.log(this.db, {
      tenantId: user.tenantId,
      userId: user.sub,
      action: 'CHANGE_METHOD',
      entity: 'AssetCategory',
      entityId: categoryId,
      data: {
        from: cat.method,
        to: dto.method,
        effective: dto.effectiveMonth ?? todayJakarta().slice(0, 7),
        reason,
        changed: changed.length,
        skipped: skipped.length,
      },
    });
    if (user.role !== 'OWNER') {
      void this.approvals.notifyRoles(user.tenantId, {
        roles: ['OWNER'],
        excludeUserId: user.sub,
        info: true,
        title: `Metode penyusutan kategori ${cat.name} diubah`,
        lines: [`${changed.length} aset diubah, ${skipped.length} dilewati`, `Alasan: ${reason}`],
        path: '/fixed-assets',
      });
    }
    return { changed, skipped };
  }
}

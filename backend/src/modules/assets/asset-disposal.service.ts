import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { fixedAssets } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { monthIndex, periodOf } from './depreciation';
import { TransferAssetBranchDto, DisposeDto } from './assets.dto';
import { AssetsService, ASSET_ALERT_VALUE } from './assets.service';

@Injectable()
export class AssetDisposalService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly assets: AssetsService,
  ) {}

  /**
   * Pindahkan aset ke cabang lain: harga perolehan dan akumulasi penyusutan berpindah cabang; selisihnya (nilai buku) ditutup
   * Rekening Antar Cabang otomatis, nol saat digabung. Penyusutan berikutnya masuk cabang baru.
   */
  async transferBranch(user: AuthUser, id: string, dto: TransferAssetBranchDto) {
    const target = dto.branchId ?? null;
    const date = toDocDate(dto.date);
    let notice: { name: string; cost: Dec; bookValue: Dec; price: Dec } | null = null;
    await this.db.transaction(async (tx) => {
      const a = await tx.query.fixedAssets.findFirst({
        where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)),
        with: { category: true },
      });
      if (!a) throw new NotFoundException('Aset tidak ditemukan');
      if (a.status !== 'ACTIVE') throw new BadRequestException('Aset sudah dilepas');
      if ((a.branchId ?? null) === target) throw new BadRequestException('Aset sudah berada di cabang itu');
      if (target) {
        const [b] = (
          await tx.execute<{ id: string }>(
            sql`SELECT id FROM branches WHERE id = ${target} AND tenant_id = ${user.tenantId} AND is_active`,
          )
        ).rows;
        if (!b) throw new BadRequestException('Cabang tidak ditemukan atau nonaktif');
      }
      if (date < a.acquisitionDate) throw new BadRequestException('Tanggal pindah sebelum tanggal perolehan');
      // penyusutan sampai bulan sebelumnya dibukukan di cabang lama dulu
      await this.assets.run(user, periodOf(monthIndex(date.slice(0, 7)) - 1), a.id, tx);
      const [p] = (
        await tx.execute<{ total: string }>(
          sql`SELECT COALESCE(SUM(amount), 0) AS total FROM asset_depreciations WHERE asset_id = ${a.id}`,
        )
      ).rows;
      const accumulated = D(a.openingAccumulated).plus(p.total);
      const cost = D(a.cost);
      const from = a.branchId ?? null;
      const lines: Parameters<PostingService['post']>[1]['lines'] = [
        { accountId: a.category.assetAccountId, credit: cost, branchId: from },
        { accountId: a.category.assetAccountId, debit: cost, branchId: target },
      ];
      if (accumulated.gt(0)) {
        if (!a.category.accumulatedAccountId) throw new BadRequestException('Kategori tanpa akun akumulasi');
        lines.push(
          { accountId: a.category.accumulatedAccountId, debit: accumulated, branchId: from },
          { accountId: a.category.accumulatedAccountId, credit: accumulated, branchId: target },
        );
      }
      const j = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pindah cabang aset ${a.code} ${a.name}`,
        sourceType: 'ASSET_TRANSFER',
        sourceId: `${a.id}:${date}`,
        createdById: user.sub,
        lines,
      });
      await tx.update(fixedAssets).set({ branchId: target }).where(eq(fixedAssets.id, a.id));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'TRANSFER_BRANCH',
        entity: 'FixedAsset',
        entityId: a.id,
        data: { from, to: target, journal: j.number },
      });
    });
    return this.assets.get(user.tenantId, id);
  }

  async dispose(user: AuthUser, id: string, dto: DisposeDto, opts: { approved?: boolean } = {}) {
    const date = toDocDate(dto.date);
    if (!opts.approved) {
      // Pelepasan aset di atas batas nilai buku/harga perolehan perlu persetujuan (peran selain pemilik/admin)
      const asset = await this.db.query.fixedAssets.findFirst({
        where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)),
      });
      if (asset?.status === 'ACTIVE') {
        const amount = D(asset.cost).toNumber();
        const limit = await this.approvals.needs(this.db, user, 'ASSET_DISPOSAL', amount);
        if (limit !== null) {
          const req = await this.approvals.create(this.db, user, {
            kind: 'ASSET_DISPOSAL',
            refId: id,
            title: `Pelepasan aset ${asset.code} ${asset.name}`,
            amount,
            payload: JSON.parse(JSON.stringify({ id, ...dto })),
          });
          throw this.approvals.required(
            req.id,
            'Pelepasan aset ini mencapai batas persetujuan; permintaan dikirim ke pemilik atau admin dan dijalankan setelah disetujui.',
          );
        }
      }
    }
    let notice: { name: string; cost: Dec; bookValue: Dec; price: Dec } | null = null;
    await this.db.transaction(async (tx) => {
      const a = await tx.query.fixedAssets.findFirst({
        where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, user.tenantId)),
        with: { category: true },
      });
      if (!a) throw new NotFoundException('Aset tidak ditemukan');
      if (a.status !== 'ACTIVE') throw new BadRequestException('Aset sudah dilepas');
      if (date < a.acquisitionDate) throw new BadRequestException('Tanggal pelepasan sebelum tanggal perolehan');
      const prevPeriod = periodOf(monthIndex(date.slice(0, 7)) - 1);
      await this.assets.run(user, prevPeriod, a.id, tx);
      const [p] = (
        await tx.execute<{ total: string }>(
          sql`SELECT COALESCE(SUM(amount), 0) AS total FROM asset_depreciations WHERE asset_id = ${a.id}`,
        )
      ).rows;
      const accumulated = D(a.openingAccumulated).plus(p.total);
      const cost = D(a.cost);
      const price = money(dto.price);
      const bookValue = cost.minus(accumulated);
      const gain = price.minus(bookValue);
      const ab = a.branchId ?? null;
      const lines: Parameters<PostingService['post']>[1]['lines'] = [
        { accountId: a.category.assetAccountId, credit: cost, branchId: ab },
      ];
      if (accumulated.gt(0)) {
        if (!a.category.accumulatedAccountId) throw new BadRequestException('Kategori tanpa akun akumulasi');
        lines.push({ accountId: a.category.accumulatedAccountId, debit: accumulated, branchId: ab });
      }
      if (price.gt(0)) {
        const cashAcc = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK');
        lines.push({ accountId: cashAcc.id, debit: price, branchId: cashAcc.branchId ?? ab });
      }
      if (gain.gt(0)) lines.push({ key: SYS.ASSET_DISPOSAL_GAIN, credit: gain, branchId: ab });
      if (gain.lt(0)) lines.push({ key: SYS.ASSET_DISPOSAL_LOSS, debit: gain.abs(), branchId: ab });
      const j = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pelepasan aset ${a.code} ${a.name} (nilai buku ${bookValue.toFixed(0)}, ${gain.gte(0) ? 'laba' : 'rugi'} ${gain.abs().toFixed(0)})`,
        sourceType: 'ASSET_DISPOSAL',
        sourceId: a.id,
        createdById: user.sub,
        lines,
      });
      await tx
        .update(fixedAssets)
        .set({ status: 'DISPOSED', disposalDate: date, disposalPrice: price.toFixed(2), disposalJournalId: j.id })
        .where(eq(fixedAssets.id, a.id));
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'DISPOSE',
        entity: 'FixedAsset',
        entityId: a.id,
        data: {
          gain: gain.toFixed(2),
          price: price.toFixed(2),
          cost: cost.toFixed(2),
          bookValue: bookValue.toFixed(2),
        },
      });
      notice = { name: `${a.code} ${a.name}`, cost, bookValue, price };
    });
    // Pemilik diberi tahu bila aset bernilai besar dilepas oleh orang lain (pelepasan adalah jalan umum memindahkan aset keluar)
    const n = notice as { name: string; cost: Dec; bookValue: Dec; price: Dec } | null;
    if (n && user.role !== 'OWNER' && n.cost.toNumber() >= ASSET_ALERT_VALUE) {
      const rp = (d: Dec) => `Rp${Math.round(d.toNumber()).toLocaleString('id-ID')}`;
      void this.approvals.notifyRoles(user.tenantId, {
        roles: ['OWNER'],
        excludeUserId: user.sub,
        info: true,
        title: `Aset dilepas: ${n.name}`,
        lines: [`Harga perolehan ${rp(n.cost)} · nilai buku ${rp(n.bookValue)} · harga lepas ${rp(n.price)}`],
        path: '/fixed-assets',
      });
    }
    return this.assets.get(user.tenantId, id);
  }
}

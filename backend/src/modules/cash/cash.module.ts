import { findReceivableLookalike } from './receivable-guard';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { RequireApp } from '../../common/apps/app.guard';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { CASH_TX_TYPES, CashTxType, CASH_SOURCE_KEYS, CASH_IN_SOURCES_TO_VERIFY, cashInSource, cashOutSource, type CashInSourceKey, type CashOutSourceKey } from '@sansu/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings.service';
import { taxFindings } from './tax-controls';
import { SequenceService } from '../../common/sequence/sequence.service';
import { addDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, branches, cashTransactionLines, cashTransactions, fixedAssets, journalEntries, projects } from '../../db/schema';
import { AccountingModule } from '../accounting/accounting.module';
import { BudgetService } from '../accounting/budget';
import { PostingService } from '../accounting/posting.service';
import { AssetsModule, AssetsService } from '../assets/assets.module';
import { CashCountController, CashCountService } from './cash-count';
import { PettyCashController, PettyCashService } from './petty-cash';

// ---------- DTO ----------
export class CashLineDto {
  @ApiPropertyOptional({ description: 'Akun lawan, mis. Beban Listrik atau Modal Pemilik (khusus pembukuan; kosong bila memakai sumber)' }) @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional({ enum: CASH_SOURCE_KEYS, description: 'Kas masuk: sumber uang (Keuangan wajib). Kas keluar: jenis biaya. Sistem menentukan akun' }) @IsOptional() @IsIn(CASH_SOURCE_KEYS as unknown as string[]) source?: CashInSourceKey | CashOutSourceKey;
  @ApiProperty({ example: '350000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) memo?: string;
  @ApiPropertyOptional({ description: 'Kas keluar: biaya langsung proyek (usaha jasa)' }) @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'Kas keluar ke akun aset tetap: kategori aset (wajib bila akun dipakai >1 kategori)' }) @IsOptional() @IsUUID() assetCategoryId?: string;
  @ApiPropertyOptional({ description: 'Nama aset (kosong = memo/keterangan transaksi)' }) @IsOptional() @IsString() @MaxLength(160) assetName?: string;
  @ApiPropertyOptional({ description: 'Masa manfaat bulan (kosong = ikut kategori)' }) @IsOptional() @IsInt() @Min(0) @Max(600) assetUsefulLifeMonths?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) assetLocation?: string;
  @ApiPropertyOptional({ description: 'Kategori bermetode unit produksi: kapasitas total aset' }) @IsOptional() @IsNumberString() assetTotalUnits?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) assetUnitLabel?: string;
}

export class CreateCashTxDto {
  @ApiProperty({ enum: CASH_TX_TYPES }) @IsIn(CASH_TX_TYPES) type: CashTxType;
  @ApiProperty({ description: 'Akun kas/bank (sumber untuk OUT/TRANSFER, tujuan untuk IN)' }) @IsUUID() cashAccountId: string;
  @ApiPropertyOptional({ description: 'TRANSFER: akun kas/bank tujuan' }) @IsOptional() @IsUUID() toCashAccountId?: string;
  @ApiPropertyOptional({ example: '1000000', description: 'TRANSFER: jumlah' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ example: 'Bayar listrik gudang Oktober' }) @IsString() @MaxLength(255) description: string;
  @ApiPropertyOptional({ example: 'No. tagihan PLN 123' }) @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @ApiPropertyOptional({ description: 'Cabang transaksi ini (biaya/pendapatan cabang tertentu); kosong = pusat' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Hanya Pemilik: alasan menembus blokir anggaran (min. 10 karakter)' }) @IsOptional() @IsString() @MaxLength(300) budgetOverrideReason?: string;
  @ApiPropertyOptional({ type: [CashLineDto], description: 'IN/OUT: rincian akun lawan' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CashLineDto)
  @ArrayMinSize(1)
  lines?: CashLineDto[];
}

/** Kas yang sudah melewati penentuan sumber: setiap baris punya akun */
export type ResolvedCashTx = Omit<CreateCashTxDto, 'lines'> & { lines?: (Omit<CashLineDto, 'accountId'> & { accountId: string; sourceKey?: string })[] };

export class CashQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class VoidCashDto {
  @ApiProperty({ description: 'Alasan pembatalan (wajib, min. 5 karakter)' }) @IsString() @MaxLength(300) reason: string;
}

export class CashEvidenceDto {
  @ApiProperty({ description: 'Nomor bukti (kuitansi/nota/bukti transfer)', example: 'KW-2026-0123' }) @IsString() @MaxLength(100) reference: string;
}

export class CashSettingsDto {
  @ApiPropertyOptional({ description: 'Kas keluar/transfer mulai nilai ini wajib punya nomor bukti (0 = tidak wajib)' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) evidenceFrom?: number;
  @ApiPropertyOptional({ description: 'Tolak kas keluar/transfer yang membuat saldo akun kas/bank negatif' }) @IsOptional() @IsBoolean() blockNegative?: boolean;
  @ApiPropertyOptional({ description: 'Peringatkan bila saldo satu akun kas melebihi nilai ini (0 = nonaktif)' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) @Max(1_000_000_000_000) maxCashBalance?: number;
}
export const DEFAULT_CASH_SETTINGS = { evidenceFrom: 0, blockNegative: false, maxCashBalance: 0 };

const PREFIX = { IN: 'CASH_IN', OUT: 'CASH_OUT', TRANSFER: 'TRANSFER' } as const;
const SOURCE = { IN: 'CASH_IN', OUT: 'CASH_OUT', TRANSFER: 'TRANSFER' } as const;

// ---------- Service ----------
@Injectable()
export class CashService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
    private readonly approvals: ApprovalsService,
    private readonly settings: SettingsService,
    private readonly budget: BudgetService,
  ) {}

  /** Akun kas & bank beserta saldo per hari ini */
  async accounts(tenantId: string) {
    const res = await this.db.execute<{ id: string; code: string; name: string; balance: string }>(sql`
      SELECT a.id, a.code, a.name,
             COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l WHERE l.account_id = a.id), 0) AS balance
      FROM accounts a
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account = true AND a.is_postable = true
      ORDER BY a.code`);
    return res.rows.map((r) => ({ ...r, balance: D(r.balance).toFixed(2) }));
  }

  async list(tenantId: string, q: CashQueryDto, branchIds?: string[] | null) {
    const rows = await this.db.query.cashTransactions.findMany({
      where: and(
        eq(cashTransactions.tenantId, tenantId),
        branchIds?.length ? inArray(cashTransactions.branchId, branchIds) : undefined,
        q.cashAccountId
          ? or(eq(cashTransactions.cashAccountId, q.cashAccountId), eq(cashTransactions.toCashAccountId, q.cashAccountId))
          : undefined,
        q.from ? gte(cashTransactions.date, toDocDate(q.from)) : undefined,
        q.to ? lte(cashTransactions.date, toDocDate(q.to)) : undefined,
      ),
      with: {
        cashAccount: { columns: { code: true, name: true } },
        toCashAccount: { columns: { code: true, name: true } },
        lines: { with: { account: { columns: { code: true, name: true } } } },
      },
      orderBy: [desc(cashTransactions.date), desc(cashTransactions.number)],
      limit: 300,
    });
    if (!rows.length) return [];
    // pelengkap: nomor jurnal, cabang, dan kartu aset tetap yang lahir dari transaksi ini (satu query per jenis, bukan per baris)
    const jids = rows.map((r) => r.journalId).filter((x): x is string => !!x);
    const [journals, assets, brs] = await Promise.all([
      jids.length ? this.db.select({ id: journalEntries.id, number: journalEntries.number }).from(journalEntries).where(inArray(journalEntries.id, jids)) : [],
      jids.length ? this.db.select({ journalId: fixedAssets.acquisitionJournalId, id: fixedAssets.id, code: fixedAssets.code, name: fixedAssets.name }).from(fixedAssets).where(and(eq(fixedAssets.tenantId, tenantId), inArray(fixedAssets.acquisitionJournalId, jids))) : [],
      this.db.select({ id: branches.id, code: branches.code, name: branches.name }).from(branches).where(eq(branches.tenantId, tenantId)),
    ]);
    const jn = new Map(journals.map((j) => [j.id, j.number]));
    const bn = new Map(brs.map((b) => [b.id, `${b.code} · ${b.name}`]));
    return rows.map((r) => ({
      ...r,
      journalNumber: r.journalId ? (jn.get(r.journalId) ?? null) : null,
      branchName: r.branchId ? (bn.get(r.branchId) ?? null) : null,
      assets: assets.filter((a) => a.journalId === r.journalId).map((a) => ({ id: a.id, code: a.code, name: a.name })),
    }));
  }

  /**
   * Kas masuk  : Dr Kas/Bank | Cr akun lawan (pendapatan lain, modal, pinjaman, ...)
   * Kas keluar : Dr akun lawan (beban, aset, prive, ...) | Cr Kas/Bank
   * Transfer   : Dr Kas/Bank tujuan | Cr Kas/Bank asal
   */
  /**
   * Kas masuk dengan "sumber uang" (modal, pinjaman, bunga, pendapatan lain): sistem menentukan akun, bukan Keuangan.
   * Keuangan wajib memakai sumber (tidak memilih akun pembukuan); Pemilik/Admin boleh memakai akun langsung.
   * Sumber yang mengubah modal/utang/pendapatan wajib bukti (referensi).
   */
  private async withSources(user: AuthUser, dto: CreateCashTxDto): Promise<ResolvedCashTx> {
    const res = await this.resolveSources(user, dto);
    if ((res.lines ?? []).some((l) => !l.accountId)) throw new BadRequestException('Pilih akun lawan (atau sumber uang untuk kas masuk) di setiap baris');
    return res as ResolvedCashTx;
  }

  private async resolveSources(user: AuthUser, dto: CreateCashTxDto): Promise<CreateCashTxDto> {
    const lines = dto.lines ?? [];
    if (dto.type === 'TRANSFER') {
      if (lines.some((l) => l.source)) throw new BadRequestException('Sumber uang tidak dipakai untuk transfer');
      return dto;
    }
    const lookup = (k: string | undefined) => (dto.type === 'IN' ? cashInSource(k) : cashOutSource(k));
    if (lines.some((l) => l.source && !lookup(l.source))) throw new BadRequestException(dto.type === 'IN' ? 'Sumber uang ini hanya untuk kas keluar' : 'Sumber uang ini hanya untuk kas masuk');
    if (dto.type === 'OUT') {
      // Kas keluar: sumber (jenis biaya) disarankan untuk semua; akun yang dipilih langsung dibatasi pada Keuangan (lihat create)
      if (!lines.some((l) => l.source)) return dto;
    }
    if (dto.type === 'IN' && user.role === 'FINANCE' && lines.some((l) => !l.source)) {
      throw new BadRequestException('Pilih sumber uang untuk setiap baris (mis. Modal dari pemilik, Bunga bank). Pencatatan akunnya dilakukan sistem. Pembayaran pelanggan dicatat lewat Faktur & piutang.');
    }
    if (!lines.some((l) => l.source)) return dto;
    const keys = [...new Set(lines.filter((l) => l.source).map((l) => lookup(l.source)!))];
    if (lines.some((l) => l.source && l.accountId)) throw new BadRequestException('Isi sumber uang ATAU akun, bukan keduanya');
    if (keys.some((k) => k.needsRef) && !dto.reference?.trim()) {
      throw new BadRequestException(`Isi nomor bukti/referensi untuk ${keys.filter((k) => k.needsRef).map((k) => `"${k.label}"`).join(', ')} (mis. bukti setor, perjanjian pinjaman, nota)`);
    }
    const found = await this.db.execute<{ id: string; code: string }>(sql`SELECT id, code FROM accounts WHERE tenant_id = ${user.tenantId} AND is_postable AND code IN (${sql.join(keys.map((k) => sql`${k.code}`), sql`, `)})`);
    const byCode = new Map(found.rows.map((r) => [r.code, r.id]));
    const out = lines.map((l) => {
      if (!l.source) return l;
      const k = lookup(l.source)!;
      const accountId = byCode.get(k.code);
      if (!accountId) throw new BadRequestException(`Akun untuk "${k.label}" (${k.code}) belum tersedia di Bagan Akun. Hubungi Admin/Akuntan.`);
      return { ...l, accountId, source: undefined, sourceKey: l.source };
    });
    return { ...dto, lines: out };
  }

  async create(user: AuthUser, dto0: CreateCashTxDto, opts: { approved?: boolean; petty?: boolean; tx?: Tx } = {}) {
    const dto = await this.withSources(user, dto0);
    const date = toDocDate(dto.date);
    // ---- SOP: bukti wajib & persetujuan untuk uang keluar (kas keluar, transfer) di atas batas ----
    if (dto.type !== 'IN') {
      const gross = dto.type === 'TRANSFER' ? Number(dto.amount ?? 0) : (dto.lines ?? []).reduce((a, l) => a + Number(l.amount ?? 0), 0);
      if (Number.isFinite(gross) && gross > 0) {
        const cfg = await this.cashSettings(user.tenantId);
        if (cfg.evidenceFrom > 0 && gross >= cfg.evidenceFrom && !dto.reference?.trim()) {
          throw new BadRequestException(`Isi nomor bukti/referensi (kuitansi, nota, atau bukti transfer): wajib untuk uang keluar mulai Rp${cfg.evidenceFrom.toLocaleString('id-ID')}`);
        }
        if (!opts.approved) {
          const limit = await this.approvals.needs(this.db, user, 'CASH_TX', gross);
          if (limit !== null) {
            const req = await this.approvals.create(this.db, user, {
              kind: 'CASH_TX',
              refId: null,
              title: `${dto.type === 'TRANSFER' ? 'Transfer' : 'Kas keluar'}: ${dto.description}`,
              amount: gross,
              payload: JSON.parse(JSON.stringify(dto)),
            });
            throw this.approvals.required(req.id, 'Nilai transaksi mencapai batas persetujuan; permintaan dikirim ke pemilik atau admin dan transaksi diposting setelah disetujui.');
          }
        }
      }
    }
    // ---- Anggaran: belanja beban yang melewati anggaran (kas kecil dikecualikan; dana tetap sudah punya batasnya sendiri) ----
    if (dto.type === 'OUT' && !opts.petty) {
      await this.budget.guard(
        user,
        (dto.lines ?? []).filter((l) => Number(l.amount) > 0).map((l) => ({ accountId: l.accountId, amount: money(l.amount), date })),
        { kind: 'CASH_TX', title: `Kas keluar: ${dto.description}`, payload: JSON.parse(JSON.stringify(dto)), approved: opts.approved, overrideReason: dto.budgetOverrideReason },
      );
    }
    const run = async (tx: Tx) => {
      const cash = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'CASH');

      let amount: Dec;
      let to: { id: string; branchId: string | null } | undefined;
      let assetCats = new Map<string, { id: string; name: string }[]>();
      const lines = dto.lines ?? [];
      if (dto.type === 'TRANSFER') {
        if (!dto.toCashAccountId || !dto.amount) throw new BadRequestException('Transfer membutuhkan akun tujuan dan jumlah');
        if (dto.toCashAccountId === cash.id) throw new BadRequestException('Akun asal dan tujuan transfer harus berbeda');
        to = await this.posting.resolveCashAccount(tx, user.tenantId, dto.toCashAccountId, 'BANK');
        amount = money(dto.amount);
      } else {
        if (!lines.length) throw new BadRequestException('Isi minimal satu baris akun lawan');
        const ids = [...new Set(lines.map((l) => l.accountId))];
        const accs = await tx
          .select()
          .from(accounts)
          .where(and(eq(accounts.tenantId, user.tenantId), inArray(accounts.id, ids)));
        if (accs.length !== ids.length) throw new BadRequestException('Ada akun lawan yang tidak ditemukan');
        if (accs.some((a) => a.isCashAccount)) {
          throw new BadRequestException('Akun lawan tidak boleh akun kas/bank; gunakan Transfer');
        }
        if (accs.some((a) => a.systemKey === 'AR' || a.systemKey === 'AP' || a.systemKey === 'INVENTORY' || a.systemKey === 'INVENTORY_SEMI')) {
          throw new BadRequestException(
            'Piutang, hutang, dan persediaan dicatat lewat dokumennya (pembayaran faktur / pembelian), bukan kas umum',
          );
        }
        // Akun aset tetap: pembelian tunai harus menjadi kartu aset (agar daftar aset = buku besar); penjualan lewat menu Aset Tetap
        assetCats = await this.assets.categoriesByAssetAccount(tx, user.tenantId, ids);
        // Keuangan hanya mengeluarkan uang untuk biaya (atau membeli aset); prive, modal, utang, dan pajak bukan keputusan Keuangan
        if (dto.type === 'OUT' && user.role === 'FINANCE' && !opts.petty && accs.some((a) => a.type !== 'EXPENSE' && !assetCats.has(a.id))) {
          throw new BadRequestException('Keuangan hanya dapat mencatat uang keluar untuk biaya operasional atau pembelian aset. Prive, pembayaran utang/pajak, dan modal dicatat oleh Pemilik/Admin atau lewat dokumennya.');
        }
        if (dto.type === 'IN' && lines.some((l) => assetCats.has(l.accountId))) {
          throw new BadRequestException('Akun aset tetap tidak dipakai di kas masuk. Penjualan aset dicatat lewat Aset Tetap › Jual / hapus aset');
        }
        amount = lines.reduce<Dec>((a, l) => a.plus(money(l.amount)), ZERO);
        const pids = [...new Set(lines.map((l) => l.projectId).filter((x): x is string => !!x))];
        if (pids.length) {
          if (dto.type !== 'OUT') throw new BadRequestException('Proyek hanya untuk kas keluar (biaya proyek)');
          const ps = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.tenantId, user.tenantId), inArray(projects.id, pids)));
          if (ps.length !== pids.length) throw new BadRequestException('Proyek tidak ditemukan');
        }
      }
      if (amount.lte(0)) throw new BadRequestException('Jumlah harus > 0');
      // Pembayaran pelanggan tidak boleh "dibelokkan" jadi pendapatan lain/modal: jumlah sama dengan sisa piutang atau menyebut nama pelanggannya
      const lookalikes: string[] = [];
      if (dto.type === 'IN') {
        for (const l of lines as { sourceKey?: string; amount: string }[]) {
          if (!l.sourceKey) continue;
          const hit = await findReceivableLookalike(tx, user.tenantId, Number(l.amount), `${dto.description ?? ''} ${dto.reference ?? ''}`);
          if (!hit) continue;
          if (user.role === 'FINANCE') {
            throw new BadRequestException(`Uang masuk ini ${hit.why === 'JUMLAH' ? 'sama dengan sisa piutang' : 'menyebut pelanggan'} ${hit.customer} (faktur ${hit.number}, sisa Rp${hit.outstanding.toLocaleString('id-ID')}). Pembayaran pelanggan dicatat lewat Faktur & piutang, bukan Kas masuk. Bila memang bukan pembayaran pelanggan, minta Admin/Pemilik yang mencatat.`);
          }
          lookalikes.push(`${hit.customer} ${hit.number}`);
        }
      }
      if (dto.branchId) {
        const [br] = (await tx.execute<{ id: string }>(sql`SELECT id FROM branches WHERE id = ${dto.branchId} AND tenant_id = ${user.tenantId}`)).rows;
        if (!br) throw new BadRequestException('Cabang tidak ditemukan');
      }
      // pengguna terbatas cabang hanya boleh memakai rekening & cabang miliknya
      if (user.branchIds?.length) {
        const eff = dto.branchId ?? cash.branchId;
        if (!eff || !user.branchIds.includes(eff) || (cash.branchId && !user.branchIds.includes(cash.branchId))) throw new ForbiddenException('Anda hanya boleh mencatat kas untuk cabang Anda');
      }
      if (!opts.petty) await this.assertNotPettyCash(tx, user.tenantId, dto, cash.id, to?.id, amount);
      if (dto.type !== 'IN' && (await this.cashSettings(user.tenantId)).blockNegative) {
        const [b] = (await tx.execute<{ bal: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM journal_lines l WHERE l.account_id = ${cash.id}`)).rows;
        if (D(b.bal).minus(amount).lt(0)) {
          throw new BadRequestException(`Saldo ${cash.name ?? 'akun kas'} tidak cukup (Rp${D(b.bal).toNumber().toLocaleString('id-ID')}); kas keluar akan membuat saldo negatif`);
        }
      }

      const number = await this.seq.next(tx, user.tenantId, PREFIX[dto.type], date);
      const [trx] = await tx
        .insert(cashTransactions)
        .values({
          tenantId: user.tenantId,
          number,
          date,
          type: dto.type,
          cashAccountId: cash.id,
          toCashAccountId: to?.id,
          amount: amount.toFixed(2),
          description: dto.description,
          reference: dto.reference,
          createdById: user.sub,
          branchId: dto.branchId ?? cash.branchId ?? null,
        })
        .returning();
      if (lines.length && dto.type !== 'TRANSFER') {
        await tx.insert(cashTransactionLines).values(
          lines.map((l) => ({
            transactionId: trx.id,
            accountId: l.accountId as string,
            amount: money(l.amount).toFixed(2),
            memo: l.memo,
            projectId: dto.type === 'OUT' ? l.projectId : undefined,
            sourceKey: (l as { sourceKey?: string }).sourceKey,
          })),
        );
      }

      // Rekening kas/bank milik cabang: barisnya berlabel cabang rekening itu; selisih dengan cabang transaksi ditutup otomatis (antar cabang)
      const cashBranch = cash.branchId ? { branchId: cash.branchId } : {};
      const journalLines =
        dto.type === 'TRANSFER'
          ? [
              { accountId: to!.id, debit: amount, ...(to!.branchId ? { branchId: to!.branchId } : {}) },
              { accountId: cash.id, credit: amount, ...cashBranch },
            ]
          : dto.type === 'IN'
            ? [{ accountId: cash.id, debit: amount, ...cashBranch }, ...lines.map((l) => ({ accountId: l.accountId, credit: l.amount, memo: l.memo }))]
            : [...lines.map((l) => ({ accountId: l.accountId, debit: l.amount, memo: l.memo })), { accountId: cash.id, credit: amount, ...cashBranch }];

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `${number} ${dto.description}`,
        sourceType: SOURCE[dto.type],
        sourceId: trx.id,
        createdById: user.sub,
        lines: journalLines,
      });
      await tx.update(cashTransactions).set({ journalId: journal.id }).where(eq(cashTransactions.id, trx.id));
      if (dto.type === 'OUT') {
        for (const l of lines) {
          const cats = assetCats.get(l.accountId);
          if (!cats) continue;
          const cat = l.assetCategoryId ? cats.find((c) => c.id === l.assetCategoryId) : cats.length === 1 ? cats[0] : undefined;
          if (!cat) {
            throw new BadRequestException(
              l.assetCategoryId ? 'Kategori aset tidak sesuai dengan akun yang dipilih' : `Akun ini dipakai beberapa kategori aset (${cats.map((c) => c.name).join(', ')}); pilih kategori asetnya`,
            );
          }
          await this.assets.registerFromCash(tx, user, {
            categoryId: cat.id,
            name: l.assetName?.trim() || l.memo?.trim() || dto.description,
            date,
            cost: money(l.amount),
            usefulLifeMonths: l.assetUsefulLifeMonths,
            location: l.assetLocation,
            totalUnits: l.assetTotalUnits,
            unitLabel: l.assetUnitLabel,
            journalId: journal.id,
            notes: `Dibeli tunai, ${number}`,
            branchId: dto.branchId ?? cash.branchId ?? null,
          });
          this.assets.notifyAcquisition(user, l.assetName?.trim() || l.memo?.trim() || dto.description, money(l.amount), `dibayar dari kas/bank (${number})`);
        }
      }
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'CashTransaction', entityId: trx.id });
      // Modal/pinjaman/pendapatan lain: pemilik dan Akuntan diberi tahu agar bisa memverifikasi sumbernya (bukan penjualan yang "dibelokkan")
      const verify = lines.filter((l) => CASH_IN_SOURCES_TO_VERIFY.includes((l as { sourceKey?: string }).sourceKey as CashInSourceKey));
      if (verify.length) {
        const names = [...new Set(verify.map((l) => cashInSource((l as { sourceKey?: string }).sourceKey)!.label))].join(', ');
        void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER', 'ACCOUNTANT'], excludeUserId: user.sub, title: `Kas masuk non-penjualan ${number}: ${names} Rp${amount.toNumber().toLocaleString('id-ID')}`, lines: [dto.description, dto.reference ? `Bukti: ${dto.reference}` : ''], path: '/cash' });
      }
      if (lookalikes.length) {
        await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CASH_IN_LOOKALIKE_RECEIVABLE', entity: 'CashTransaction', entityId: trx.id, data: { invoices: lookalikes } });
        void this.approvals.notifyRoles(user.tenantId, { roles: ['OWNER', 'ACCOUNTANT'], excludeUserId: user.sub, title: `⚠ Kas masuk ${number} mirip pembayaran pelanggan: ${lookalikes.join(', ')}`, lines: ['Dicatat sebagai non-penjualan padahal ada piutang yang cocok. Periksa agar piutang dan penjualan benar.'], path: '/cash' });
      }
      // Real-time ke Keuangan: setiap uang masuk di luar penjualan (kas masuk) dikabarkan lewat Telegram agar tidak terlewat
      if (dto.type === 'IN') {
        void this.approvals.notifyRoles(user.tenantId, { roles: ['FINANCE'], excludeUserId: user.sub, info: true, title: `Uang masuk non-penjualan ${number}: Rp${amount.toNumber().toLocaleString('id-ID')}`, lines: [dto.description, dto.reference ? `Bukti: ${dto.reference}` : ''], path: '/cash' });
      }
      return { ...trx, journalNumber: journal.number };
    };
    return opts.tx ? run(opts.tx) : this.db.transaction(run);
  }

  /**
   * Kas kecil memakai sistem dana tetap: pengeluarannya hanya lewat bukti kas kecil, dan dana hanya diisi lewat pengisian kembali,
   * jadi transaksi kas umum tidak boleh keluar/masuk langsung dari akun kas kecil atau mengisinya melebihi plafon.
   */
  private async assertNotPettyCash(tx: Tx, tenantId: string, dto: CreateCashTxDto, cashId: string, toId: string | undefined, amount: Dec) {
    const res = await tx.execute<{ account_id: string; imprest_amount: string }>(
      sql`SELECT account_id, imprest_amount FROM petty_cash_funds WHERE tenant_id = ${tenantId} AND status = 'ACTIVE'`,
    );
    if (!res.rows.length) return;
    const fund = new Map(res.rows.map((r) => [r.account_id, D(r.imprest_amount)]));
    if (dto.type === 'OUT' && fund.has(cashId)) throw new BadRequestException('Akun ini adalah kas kecil (dana tetap). Pengeluarannya dicatat lewat menu Kas Kecil › Bukti kas kecil');
    if (dto.type === 'IN' && fund.has(cashId)) throw new BadRequestException('Kas kecil tidak menerima kas masuk langsung. Isi dananya lewat Kas Kecil › Pengisian kembali');
    if (dto.type === 'TRANSFER') {
      if (fund.has(cashId)) throw new BadRequestException('Kas kecil tidak boleh dipakai sebagai sumber transfer. Pengeluarannya lewat bukti kas kecil');
      if (toId && fund.has(toId)) {
        const [b] = (await tx.execute<{ bal: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM journal_lines l WHERE l.account_id = ${toId}`)).rows;
        if (D(b.bal).plus(amount).gt(fund.get(toId)!)) throw new BadRequestException(`Pengisian melebihi dana tetap kas kecil (plafon Rp${fund.get(toId)!.toNumber().toLocaleString('id-ID')})`);
      }
    }
  }

  // ---------------------------------------------------------------- SOP & kontrol kas
  cashSettings(tenantId: string) {
    return this.settings.section(this.db, tenantId, 'cashControl', DEFAULT_CASH_SETTINGS);
  }
  saveCashSettings(tenantId: string, patch: Partial<typeof DEFAULT_CASH_SETTINGS>) {
    return this.settings.saveSection(this.db, tenantId, 'cashControl', DEFAULT_CASH_SETTINGS, patch);
  }

  /**
   * Pembatalan terkontrol: transaksi kas tidak dihapus, dibalik dengan jurnal pembalik (hanya pemilik/admin, alasan wajib).
   * Ditolak bila sudah dicocokkan dengan mutasi bank, atau sudah menjadi kartu aset tetap.
   */
  async void(user: AuthUser, id: string, dto: VoidCashDto, outer?: Tx) {
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 5) throw new BadRequestException('Alasan pembatalan wajib diisi (minimal 5 karakter)');
    const work = async (tx: Tx) => {
      const locked = await tx.execute<{ id: string }>(sql`SELECT id FROM cash_transactions WHERE id = ${id} AND tenant_id = ${user.tenantId} FOR UPDATE`);
      if (!locked.rows.length) throw new NotFoundException('Transaksi kas tidak ditemukan');
      const [t] = await tx.select().from(cashTransactions).where(eq(cashTransactions.id, id));
      if (t.status === 'VOID') throw new BadRequestException('Transaksi ini sudah dibatalkan');
      if (!t.journalId) throw new BadRequestException('Transaksi belum punya jurnal');
      const matched = await tx.execute<{ n: number }>(sql`
        SELECT (SELECT COUNT(*) FROM bank_statement_lines b
                WHERE b.status IN ('MATCHED', 'CREATED')
                  AND (b.journal_id = ${t.journalId} OR b.journal_line_id IN (SELECT id FROM journal_lines WHERE journal_id = ${t.journalId})))::int
             + (SELECT COUNT(*) FROM bank_line_extra_matches x WHERE x.journal_line_id IN (SELECT id FROM journal_lines WHERE journal_id = ${t.journalId}))::int AS n`);
      if (matched.rows[0].n > 0) throw new BadRequestException('Transaksi ini sudah dicocokkan dengan mutasi bank. Batalkan pencocokannya di Rekonsiliasi Bank dulu');
      const assetRows = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM fixed_assets WHERE tenant_id = ${user.tenantId} AND acquisition_journal_id = ${t.journalId}`);
      if (assetRows.rows[0].n > 0) throw new BadRequestException('Transaksi ini sudah menjadi kartu Aset Tetap. Lepaskan atau hapus asetnya dulu di Aset Tetap');
      const rev = await this.posting.reverse(tx, user.tenantId, t.journalId, todayJakarta(), user.sub, true);
      await tx.update(cashTransactions).set({ status: 'VOID', voidedAt: new Date(), voidedById: user.sub, voidReason: reason, voidJournalId: rev.id }).where(eq(cashTransactions.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'VOID', entity: 'CashTransaction', entityId: id, data: { number: t.number, amount: t.amount, reason } });
      return { id, number: t.number, status: 'VOID', reversalJournal: rev.number };
    };
    return outer ? work(outer) : this.db.transaction(work);
  }

  /** Lengkapi nomor bukti pada transaksi yang sudah diposting (hanya bila masih kosong; tidak mengubah angka/jurnal) */
  async setEvidence(user: AuthUser, id: string, dto: CashEvidenceDto) {
    const reference = dto.reference?.trim() ?? '';
    if (reference.length < 2) throw new BadRequestException('Isi nomor bukti (minimal 2 karakter)');
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute<{ id: string }>(sql`SELECT id FROM cash_transactions WHERE id = ${id} AND tenant_id = ${user.tenantId} FOR UPDATE`);
      if (!locked.rows.length) throw new NotFoundException('Transaksi kas tidak ditemukan');
      const [t] = await tx.select().from(cashTransactions).where(eq(cashTransactions.id, id));
      if (t.status === 'VOID') throw new BadRequestException('Transaksi ini sudah dibatalkan');
      if (t.reference?.trim()) throw new BadRequestException('Transaksi ini sudah punya nomor bukti dan tidak bisa diubah');
      await tx.update(cashTransactions).set({ reference }).where(eq(cashTransactions.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'CashTransaction', entityId: id, data: { number: t.number, reference } });
      return { id, number: t.number, reference };
    });
  }

  /**
   * Temuan kontrol kas & bank 60 hari terakhir: uang keluar tanpa bukti, di akhir pekan, dipecah di bawah batas persetujuan,
   * saldo negatif/melebihi batas, rekening bank lama belum direkonsiliasi, selisih hitung kas, dan pembatalan baru-baru ini.
   */
  async controls(tenantId: string) {
    const cfg = await this.cashSettings(tenantId);
    const pol = await this.approvals.policy(this.db, tenantId);
    const today = todayJakarta();
    const since = addDays(today, -60);
    type Finding = { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; refs: string[] };
    const out: Finding[] = [];
    const add = (key: string, level: Finding['level'], title: string, refs: string[], detail: string) => {
      if (refs.length) out.push({ key, level, title: `${title} (${refs.length})`, detail, refs });
    };
    const txs = await this.db.query.cashTransactions.findMany({
      where: and(eq(cashTransactions.tenantId, tenantId), gte(cashTransactions.date, since), eq(cashTransactions.status, 'POSTED')),
      with: { cashAccount: { columns: { code: true, name: true } } },
      orderBy: [desc(cashTransactions.date)],
    });
    const spend = txs.filter((t) => t.type !== 'IN');
    const list = (rows: { number: string }[]) => rows.slice(0, 6).map((r) => r.number).join(', ') + (rows.length > 6 ? `, dan ${rows.length - 6} lainnya` : '');

    const noRef = spend.filter((t) => !t.reference?.trim() && Number(t.amount) >= Math.max(cfg.evidenceFrom, 1));
    add('NO_EVIDENCE', 'warning', 'Uang keluar tanpa nomor bukti', noRef.map((t) => t.number), `Lengkapi bukti (kuitansi/nota/bukti transfer): ${list(noRef)}`);

    const weekend = spend.filter((t) => [0, 6].includes(new Date(`${t.date}T00:00:00Z`).getUTCDay()));
    add('WEEKEND', 'info', 'Uang keluar pada akhir pekan', weekend.map((t) => t.number), `Pastikan memang ada keperluan: ${list(weekend)}`);

    if (pol.cashOut > 0) {
      const byDay = new Map<string, typeof spend>();
      for (const t of spend) {
        if (Number(t.amount) >= pol.cashOut) continue;
        const k = `${t.date}|${t.cashAccountId}`;
        byDay.set(k, [...(byDay.get(k) ?? []), t]);
      }
      const split = [...byDay.values()].filter((g) => g.length >= 3 && g.reduce((a, t) => a + Number(t.amount), 0) >= pol.cashOut);
      add('SPLIT', 'warning', 'Pengeluaran terpecah tepat di bawah batas persetujuan', split.map((g) => `${g[0].date} ${g[0].cashAccount.name}`), 'Beberapa uang keluar kecil di hari dan akun yang sama totalnya melewati batas persetujuan. Periksa apakah sengaja dipecah.');
    }

    out.push(...(await taxFindings(this.db, tenantId, since, today)));

    const bal = await this.accounts(tenantId);
    const neg = bal.filter((a) => D(a.balance).lt(0));
    add('NEGATIVE', 'error', 'Saldo kas/bank negatif', neg.map((a) => `${a.code} ${a.name}`), neg.map((a) => `${a.code} ${a.name}: Rp${D(a.balance).toNumber().toLocaleString('id-ID')}`).join('; '));
    if (cfg.maxCashBalance > 0) {
      const over = bal.filter((a) => D(a.balance).gt(cfg.maxCashBalance));
      add('OVER_MAX', 'warning', 'Saldo kas melebihi batas simpanan', over.map((a) => `${a.code} ${a.name}`), `Batas Rp${cfg.maxCashBalance.toLocaleString('id-ID')}. Setor sebagian ke bank: ${over.map((a) => `${a.name} Rp${D(a.balance).toNumber().toLocaleString('id-ID')}`).join('; ')}`);
    }

    const stale = await this.db.execute<{ id: string; code: string; name: string; last: string | null }>(sql`
      SELECT a.id, a.code, a.name, (SELECT MAX(s.period_to) FROM bank_statements s WHERE s.cash_account_id = a.id) AS last
      FROM accounts a
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account = true AND a.is_postable = true
        AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.cash_account_id = a.id)`);
    const old = stale.rows.filter((r) => r.last && r.last < addDays(today, -30));
    add('BANK_STALE', 'warning', 'Rekening bank lama belum direkonsiliasi', old.map((r) => `${r.code} ${r.name}`), old.map((r) => `${r.code} ${r.name}: mutasi terakhir ${r.last}`).join('; '));

    // Mutasi bank yang sudah diimpor tetapi tidak ada padanannya di catatan (uang keluar/masuk yang tidak tercatat), lebih dari 7 hari
    const orphanBank = async (sign: '<' | '>') => (await this.db.execute<{ d: string; amt: string; descr: string; acc: string }>(sql`
      SELECT b.date::text AS d, b.amount::text AS amt, b.description AS descr, a.name AS acc
      FROM bank_statement_lines b JOIN bank_statements s ON s.id = b.statement_id JOIN accounts a ON a.id = s.cash_account_id
      WHERE b.tenant_id = ${tenantId} AND b.status = 'UNMATCHED' AND b.date >= ${since} AND b.date <= ${addDays(today, -7)}
        AND ${sign === '<' ? sql`b.amount < 0` : sql`b.amount > 0`}
      ORDER BY ABS(b.amount) DESC LIMIT 30`)).rows;
    const bankLine = (r: { d: string; amt: string; descr: string; acc: string }) => `${r.d} ${r.acc} Rp${Math.abs(Math.round(Number(r.amt))).toLocaleString('id-ID')} ${r.descr}`.slice(0, 120);
    add('BANK_OUT_UNRECORDED', 'error', 'Uang keluar di rekening koran tidak ada di catatan', (await orphanBank('<')).map(bankLine), 'Bank mencatat uang keluar yang belum dicatat/dicocokkan di sistem lebih dari 7 hari. Bisa transfer tak sah, biaya bank yang belum dibukukan, atau pencatatan yang terlupa.');
    add('BANK_IN_UNRECORDED', 'warning', 'Uang masuk di rekening koran belum dicatat', (await orphanBank('>')).map(bankLine), 'Ada uang masuk di bank yang belum dicocokkan lebih dari 7 hari. Pastikan semua tercatat sebagai penjualan/pembayaran yang benar, bukan dipakai pihak lain.');
    // Uang keluar tercatat di buku (rekening bank) pada periode mutasi yang sudah diimpor, tetapi tidak ada di mutasi bank (kemungkinan pembayaran fiktif)
    const ghost = await this.db.execute<{ number: string; d: string; v: string; acc: string }>(sql`
      SELECT j.number, j.date::text AS d, jl.credit::text AS v, a.name AS acc
      FROM journal_lines jl JOIN journal_entries j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account AND jl.credit > 0 AND j.date >= ${since} AND j.date <= ${addDays(today, -3)}
        AND j.source_type NOT IN ('TRANSFER', 'CLOSING', 'OPENING', 'REVERSAL')
        AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.tenant_id = ${tenantId} AND s.cash_account_id = a.id AND j.date BETWEEN s.period_from AND s.period_to)
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.journal_line_id = jl.id)
        AND NOT EXISTS (SELECT 1 FROM bank_line_extra_matches x WHERE x.journal_line_id = jl.id)
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id OR r.id = j.reversal_of_id)
      ORDER BY jl.credit DESC LIMIT 30`);
    add('BANK_OUT_NOT_IN_STATEMENT', 'error', 'Uang keluar tercatat tetapi tidak ada di mutasi bank', ghost.rows.map((r) => `${r.number} (${r.d}) ${r.acc} Rp${Math.round(Number(r.v)).toLocaleString('id-ID')}`), 'Mutasi bank periode itu sudah diimpor, tetapi tidak ada baris yang cocok dengan pembayaran ini. Kemungkinan pembayaran fiktif atau salah rekening. Periksa bukti transfernya.');
    // Saldo akhir rekening koran terbaru vs saldo buku pada tanggal itu
    const bb = await this.db.execute<{ acc: string; to_d: string; closing: string; book: string }>(sql`
      SELECT a.name AS acc, s.period_to::text AS to_d, s.closing_balance::text AS closing,
        (SELECT COALESCE(SUM(jl.debit - jl.credit), 0) FROM journal_lines jl JOIN journal_entries j ON j.id = jl.journal_id WHERE jl.account_id = a.id AND j.tenant_id = ${tenantId} AND j.date <= s.period_to)::text AS book
      FROM bank_statements s JOIN accounts a ON a.id = s.cash_account_id
      WHERE s.tenant_id = ${tenantId} AND s.closing_balance IS NOT NULL
        AND s.period_to = (SELECT MAX(s2.period_to) FROM bank_statements s2 WHERE s2.cash_account_id = s.cash_account_id AND s2.closing_balance IS NOT NULL)`);
    const bd = bb.rows.filter((r) => Math.abs(Number(r.closing) - Number(r.book)) >= 1);
    add('BANK_BALANCE_DIFF', 'warning', 'Saldo akhir rekening koran berbeda dari saldo buku', bd.map((r) => `${r.acc} per ${r.to_d}: bank Rp${Math.round(Number(r.closing)).toLocaleString('id-ID')} · buku Rp${Math.round(Number(r.book)).toLocaleString('id-ID')} · selisih Rp${Math.round(Number(r.closing) - Number(r.book)).toLocaleString('id-ID')}`), 'Selisih saldo harus bisa dijelaskan (cek yang belum cair, biaya bank, mutasi belum dicatat). Selisih tanpa penjelasan adalah tanda uang tidak tercatat.');

    // Penggajian: lonjakan total gaji, gaji untuk karyawan yang sudah berhenti, tambahan manual besar, karyawan bergaji tanpa rekening
    const runs = await this.db.execute<{ period: string; net: string }>(sql`SELECT period, total_net::text AS net FROM payroll_runs WHERE tenant_id = ${tenantId} ORDER BY period DESC LIMIT 2`);
    if (runs.rows.length === 2 && Number(runs.rows[1].net) > 0) {
      const ratio = Number(runs.rows[0].net) / Number(runs.rows[1].net);
      if (ratio > 1.2 || ratio < 0.8) {
        add('PAYROLL_JUMP', 'warning', 'Total gaji bersih berubah > 20% dari bulan sebelumnya', [`${runs.rows[1].period}: Rp${Math.round(Number(runs.rows[1].net)).toLocaleString('id-ID')} → ${runs.rows[0].period}: Rp${Math.round(Number(runs.rows[0].net)).toLocaleString('id-ID')} (${ratio > 1 ? '+' : ''}${Math.round((ratio - 1) * 100)}%)`], 'Cocokkan dengan karyawan masuk/keluar, kenaikan gaji, atau lembur. Lonjakan tanpa sebab adalah tanda karyawan fiktif atau tambahan manual yang tidak sah.');
      }
    }
    const resigned = await this.db.execute<{ period: string; name: string; resign: string }>(sql`
      SELECT r.period, e.name, e.resign_date::text AS resign FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
      WHERE r.tenant_id = ${tenantId} AND e.resign_date IS NOT NULL AND (r.period || '-01')::date > e.resign_date AND p.net_pay > 0
      ORDER BY r.period DESC LIMIT 30`);
    add('PAYROLL_AFTER_RESIGN', 'error', 'Gaji dibayarkan setelah karyawan berhenti', resigned.rows.map((r) => `${r.name} (berhenti ${r.resign}) — slip ${r.period}`), 'Karyawan sudah berhenti tetapi masih menerima slip gaji. Telusuri: bisa karyawan fiktif/terlupa dinonaktifkan atau tanggal berhenti salah.');
    const extra = await this.db.execute<{ period: string; name: string; v: string }>(sql`
      SELECT r.period, e.name, p.other_income::text AS v FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
      WHERE r.tenant_id = ${tenantId} AND r.period >= to_char(${addDays(today, -90)}::date, 'YYYY-MM') AND p.other_income >= GREATEST(1000000, p.base_salary * 0.2)
      ORDER BY p.other_income DESC LIMIT 30`);
    add('PAYROLL_OTHER_INCOME', 'warning', 'Tambahan penghasilan manual besar pada slip gaji', extra.rows.map((r) => `${r.name} ${r.period}: Rp${Math.round(Number(r.v)).toLocaleString('id-ID')}`), 'Penghasilan lain yang diisi manual oleh HR (≥ Rp1 juta atau ≥ 20% gaji pokok). Pastikan ada dasar (bonus, THR, persetujuan).');
    const nobank = await this.db.execute<{ name: string }>(sql`
      SELECT name FROM employees WHERE tenant_id = ${tenantId} AND is_active AND base_salary > 0 AND COALESCE(NULLIF(TRIM(bank_account), ''), '') = '' ORDER BY name LIMIT 30`);
    add('PAYROLL_NO_BANK', 'info', 'Karyawan bergaji tanpa nomor rekening', nobank.rows.map((r) => r.name), 'Gaji sulit ditelusuri bila dibayar tunai tanpa rekening. Lengkapi rekening atau pastikan tanda terimanya.');

    const diff = await this.db.execute<{ number: string }>(sql`
      SELECT number FROM cash_counts WHERE tenant_id = ${tenantId} AND date >= ${addDays(today, -30)} AND status = 'POSTED' AND difference <> 0`);
    add('COUNT_DIFF', 'warning', 'Hitung kas fisik dengan selisih (30 hari)', diff.rows.map((r) => r.number), `Telusuri penyebab selisih: ${list(diff.rows)}`);

    const voided = await this.db.query.cashTransactions.findMany({ where: and(eq(cashTransactions.tenantId, tenantId), eq(cashTransactions.status, 'VOID'), gte(cashTransactions.voidedAt, new Date(`${addDays(today, -30)}T00:00:00Z`))) });
    add('VOIDED', 'info', 'Transaksi kas dibatalkan (30 hari)', voided.map((t) => t.number), `Tinjau alasan pembatalan: ${list(voided)}`);

    // Jurnal manual 60 hari terakhir: jalan pintas yang tidak lewat faktur/kas/stok — sering dipakai menutupi kecurangan
    const limit = pol.manualJournal > 0 ? pol.manualJournal : 10_000_000;
    const jrows = async (q: ReturnType<typeof sql>) => (await this.db.execute<{ number: string; d: string; v: string }>(q)).rows;
    const fmtJ = (r: { number: string; d: string; v: string }) => `${r.number} (${r.d}) Rp${Math.round(Number(r.v)).toLocaleString('id-ID')}`;
    const big = await jrows(sql`
      SELECT j.number, j.date::text AS d, SUM(l.debit)::text AS v FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id
      WHERE j.tenant_id = ${tenantId} AND j.source_type = 'MANUAL' AND j.date >= ${since}
      GROUP BY j.id, j.number, j.date HAVING SUM(l.debit) >= ${limit} ORDER BY SUM(l.debit) DESC`);
    add('JE_LARGE', 'warning', 'Jurnal manual bernilai besar', big.map(fmtJ), `Jurnal manual ≥ Rp${limit.toLocaleString('id-ID')} tidak lewat faktur/kas/stok. Pastikan ada dokumen dasar dan penyetujunya.`);
    const ctl = await jrows(sql`
      SELECT j.number, j.date::text AS d, SUM(l.debit)::text AS v FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND j.source_type = 'MANUAL' AND j.date >= ${since} AND (a.is_cash_account OR COALESCE(a.system_key, '') IN ('AR', 'AP', 'INVENTORY'))
      GROUP BY j.id, j.number, j.date ORDER BY j.date DESC`);
    add('JE_CONTROL_ACCOUNT', 'warning', 'Jurnal manual menyentuh kas/bank, piutang, utang, atau persediaan', ctl.map(fmtJ), 'Akun ini seharusnya bergerak lewat kas, faktur, pembayaran, atau stok. Jurnal manual ke sana melewati kontrol dokumen dan bisa membuat saldo tidak cocok dengan kartu pembantu.');
    const wk = await jrows(sql`
      SELECT j.number, j.date::text AS d, SUM(l.debit)::text AS v FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id
      WHERE j.tenant_id = ${tenantId} AND j.source_type = 'MANUAL' AND j.date >= ${since} AND EXTRACT(DOW FROM j.date) IN (0, 6)
      GROUP BY j.id, j.number, j.date ORDER BY j.date DESC`);
    add('JE_WEEKEND', 'info', 'Jurnal manual bertanggal akhir pekan', wk.map(fmtJ), 'Tidak selalu salah, tetapi jurnal di luar hari kerja layak ditinjau.');
    const rev = await jrows(sql`
      SELECT j.number, j.date::text AS d, SUM(l.debit)::text AS v FROM journal_entries j JOIN journal_lines l ON l.journal_id = j.id
      JOIN journal_entries r ON r.reversal_of_id = j.id
      WHERE j.tenant_id = ${tenantId} AND j.source_type = 'MANUAL' AND j.date >= ${since} AND r.created_at - j.created_at <= interval '3 days'
      GROUP BY j.id, j.number, j.date ORDER BY j.date DESC`);
    add('JE_REVERSED_FAST', 'info', 'Jurnal manual dibalik dalam 3 hari', rev.map(fmtJ), 'Dibuat lalu cepat dibatalkan: wajar untuk salah input, tetapi juga pola menyembunyikan angka sementara (mis. di tutup periode).');

    const setup = {
      active: pol.cashOut > 0 || pol.manualJournal > 0,
      message: 'Batas persetujuan uang keluar dan jurnal manual masih 0 (mati): berapa pun nilainya langsung tercatat tanpa persetujuan Pemilik/Admin.',
      recommended: { cashOut: 5_000_000, manualJournal: 10_000_000 },
      recommendedText: 'uang keluar ≥ Rp5 juta dan jurnal manual ≥ Rp10 juta butuh persetujuan',
    };
    return { generatedAt: new Date().toISOString(), asOf: today, since, count: out.length, items: out, setup };
  }

  /**
   * Uang masuk per sumber: penjualan (faktur, kasir, platform, uang muka) vs bukan penjualan (modal, pinjaman, bunga, lain-lain),
   * dihitung dari jurnal ke akun kas/bank. Kas masuk/mutasi bank yang dikreditkan ke akun penjualan ditandai: seharusnya lewat faktur atau kasir.
   */
  async incomeSources(tenantId: string, q: { from?: string; to?: string }) {
    const to = toDocDate(q.to);
    const from = q.from ? toDocDate(q.from) : addDays(to, -29);
    const base = await this.db.execute<{ st: string; amount: string; n: number }>(sql`
      SELECT j.source_type AS st, COALESCE(SUM(l.debit), 0) AS amount, COUNT(DISTINCT j.id)::int AS n
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account AND l.debit > 0 AND j.date BETWEEN ${from} AND ${to}
        AND j.source_type NOT IN ('TRANSFER', 'CLOSING', 'OPENING', 'REVERSAL', 'CASH_COUNT', 'CASH_IN', 'BANK')
      GROUP BY j.source_type`);
    const counter = await this.db.execute<{ st: string; code: string; name: string; type: string; system_key: string | null; amount: string; n: number }>(sql`
      SELECT j.source_type AS st, ca.code, ca.name, ca.type, ca.system_key, COALESCE(SUM(lc.credit), 0) AS amount, COUNT(DISTINCT j.id)::int AS n
      FROM journal_entries j
      JOIN journal_lines l ON l.journal_id = j.id AND l.debit > 0 JOIN accounts a ON a.id = l.account_id AND a.is_cash_account
      JOIN journal_lines lc ON lc.journal_id = j.id AND lc.credit > 0 JOIN accounts ca ON ca.id = lc.account_id AND NOT ca.is_cash_account
      WHERE j.tenant_id = ${tenantId} AND j.source_type IN ('CASH_IN', 'BANK') AND j.date BETWEEN ${from} AND ${to}
      GROUP BY j.source_type, ca.code, ca.name, ca.type, ca.system_key`);
    type Row = { key: string; label: string; group: 'SALES' | 'NONSALES' | 'OTHER'; category: 'SALES' | 'CAPITAL' | 'LOAN' | 'OTHER'; amount: number; count: number; suspect?: string };
    const LABEL: Record<string, [string, Row['group']]> = {
      PAYMENT: ['Pembayaran pelanggan (faktur)', 'SALES'],
      POS: ['Penjualan kasir', 'SALES'],
      PLATFORM_SETTLEMENT: ['Pencairan platform pesan-antar', 'SALES'],
      CUSTOMER_DEPOSIT: ['Uang muka pelanggan', 'SALES'],
      POS_CLOSE: ['Penutupan kasir (setoran/selisih)', 'OTHER'],
    };
    const rows: Row[] = base.rows.map((r) => ({ key: r.st, label: LABEL[r.st]?.[0] ?? r.st, group: LABEL[r.st]?.[1] ?? 'OTHER', category: LABEL[r.st]?.[1] === 'SALES' ? 'SALES' : 'OTHER', amount: Number(r.amount), count: r.n }));
    for (const r of counter.rows) {
      const isSalesAcc = r.type === 'REVENUE' && ['SALES', 'SERVICE_REVENUE', 'CONSTRUCTION_REVENUE'].includes(r.system_key ?? '');
      rows.push({
        key: `${r.st}:${r.code}`,
        label: `${r.st === 'BANK' ? 'Mutasi bank → ' : 'Kas masuk → '}${r.name}`,
        group: isSalesAcc ? 'SALES' : 'NONSALES',
        category: isSalesAcc ? 'SALES' : r.type === 'EQUITY' ? 'CAPITAL' : r.type === 'LIABILITY' ? 'LOAN' : 'OTHER',
        amount: Number(r.amount),
        count: r.n,
        ...(isSalesAcc ? { suspect: 'Penjualan dicatat lewat kas masuk/mutasi bank, bukan lewat faktur atau kasir — periksa agar piutang dan stok ikut benar' } : {}),
      });
    }
    rows.sort((a, b) => b.amount - a.amount);
    const sum = (g: Row['group']) => rows.filter((r) => r.group === g).reduce((a, r) => a + r.amount, 0);
    const cat = (c: Row['category']) => rows.filter((r) => r.category === c).reduce((a, r) => a + r.amount, 0);
    return {
      from, to, rows,
      totals: { sales: sum('SALES'), nonSales: sum('NONSALES'), other: sum('OTHER') },
      categories: { sales: cat('SALES'), capital: cat('CAPITAL'), loan: cat('LOAN'), other: cat('OTHER') },
    };
  }

  /** Akun yang boleh dipakai sebagai lawan kas (bukan kas, bukan piutang/hutang/persediaan) */
  counterAccounts(tenantId: string) {
    return this.db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, tenantId),
          eq(accounts.isPostable, true),
          eq(accounts.isCashAccount, false),
          sql`COALESCE(${accounts.systemKey}, '') NOT IN ('AR', 'AP', 'INVENTORY', 'INVENTORY_SEMI')`,
        ),
      )
      .orderBy(asc(accounts.code));
  }
}

// ---------- Controller ----------
@ApiTags('Kas & Bank')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@RequireApp('cash')
@Controller('cash')
export class CashController {
  constructor(private readonly svc: CashService) {}

  /** Dipakai juga layar kasir untuk memilih laci kas & rekening QRIS */
  @Get('accounts')
  @Roles('ADMIN', 'FINANCE', 'CASHIER', 'ACCOUNTANT')
  @RequireApp('cash', 'pos')
  accounts(@CurrentUser() u: AuthUser) {
    return this.svc.accounts(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('counter-accounts')
  counter(@CurrentUser() u: AuthUser) {
    return this.svc.counterAccounts(u.tenantId);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('transactions')
  list(@CurrentUser() u: AuthUser, @Query() q: CashQueryDto) {
    return this.svc.list(u.tenantId, q, u.branchIds);
  }

  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('income-sources')
  incomeSources(@CurrentUser() u: AuthUser, @Query() q: CashQueryDto) {
    return this.svc.incomeSources(u.tenantId, q);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('controls')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  @Get('settings')
  cashSettings(@CurrentUser() u: AuthUser) {
    return this.svc.cashSettings(u.tenantId);
  }
  @Roles('ADMIN')
  @Put('settings')
  saveCashSettings(@CurrentUser() u: AuthUser, @Body() dto: CashSettingsDto) {
    return this.svc.saveCashSettings(u.tenantId, dto);
  }
  @Roles('ADMIN', 'FINANCE')
  @Post('transactions/:id/evidence')
  evidence(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CashEvidenceDto) {
    return this.svc.setEvidence(u, id, dto);
  }
  @Roles('ADMIN')
  @Post('transactions/:id/void')
  void(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidCashDto) {
    return this.svc.void(u, id, dto);
  }

  @Roles('ADMIN', 'FINANCE')
  @Post('transactions')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCashTxDto) {
    return this.svc.create(u, dto);
  }
}

@Module({
  imports: [AccountingModule, AssetsModule],
  controllers: [CashController, CashCountController, PettyCashController],
  providers: [CashService, CashCountService, PettyCashService],
  exports: [CashService, PettyCashService],
})
export class CashModule {}

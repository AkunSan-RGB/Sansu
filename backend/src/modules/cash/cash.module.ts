import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
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
import { CASH_TX_TYPES, CashTxType } from '@sansu/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { addDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, cashTransactionLines, cashTransactions, projects } from '../../db/schema';
import { AccountingModule } from '../accounting/accounting.module';
import { PostingService } from '../accounting/posting.service';
import { AssetsModule, AssetsService } from '../assets/assets.module';
import { CashCountController, CashCountService } from './cash-count';
import { PettyCashController, PettyCashService } from './petty-cash';

// ---------- DTO ----------
export class CashLineDto {
  @ApiProperty({ description: 'Akun lawan, mis. Beban Listrik atau Modal Pemilik' }) @IsUUID() accountId: string;
  @ApiProperty({ example: '350000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) memo?: string;
  @ApiPropertyOptional({ description: 'Kas keluar: biaya langsung proyek (usaha jasa)' }) @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'Kas keluar ke akun aset tetap: kategori aset (wajib bila akun dipakai >1 kategori)' }) @IsOptional() @IsUUID() assetCategoryId?: string;
  @ApiPropertyOptional({ description: 'Nama aset (kosong = memo/keterangan transaksi)' }) @IsOptional() @IsString() @MaxLength(160) assetName?: string;
  @ApiPropertyOptional({ description: 'Masa manfaat bulan (kosong = ikut kategori)' }) @IsOptional() @IsInt() @Min(0) @Max(600) assetUsefulLifeMonths?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) assetLocation?: string;
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
  @ApiPropertyOptional({ type: [CashLineDto], description: 'IN/OUT: rincian akun lawan' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CashLineDto)
  @ArrayMinSize(1)
  lines?: CashLineDto[];
}

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

  list(tenantId: string, q: CashQueryDto) {
    return this.db.query.cashTransactions.findMany({
      where: and(
        eq(cashTransactions.tenantId, tenantId),
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
  }

  /**
   * Kas masuk  : Dr Kas/Bank | Cr akun lawan (pendapatan lain, modal, pinjaman, ...)
   * Kas keluar : Dr akun lawan (beban, aset, prive, ...) | Cr Kas/Bank
   * Transfer   : Dr Kas/Bank tujuan | Cr Kas/Bank asal
   */
  async create(user: AuthUser, dto: CreateCashTxDto, opts: { approved?: boolean; petty?: boolean; tx?: Tx } = {}) {
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
    const run = async (tx: Tx) => {
      const cash = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'CASH');

      let amount: Dec;
      let to: { id: string } | undefined;
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
      if (dto.branchId) {
        const [br] = (await tx.execute<{ id: string }>(sql`SELECT id FROM branches WHERE id = ${dto.branchId} AND tenant_id = ${user.tenantId}`)).rows;
        if (!br) throw new BadRequestException('Cabang tidak ditemukan');
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
          branchId: dto.branchId ?? null,
        })
        .returning();
      if (lines.length && dto.type !== 'TRANSFER') {
        await tx.insert(cashTransactionLines).values(
          lines.map((l) => ({
            transactionId: trx.id,
            accountId: l.accountId,
            amount: money(l.amount).toFixed(2),
            memo: l.memo,
            projectId: dto.type === 'OUT' ? l.projectId : undefined,
          })),
        );
      }

      const journalLines =
        dto.type === 'TRANSFER'
          ? [
              { accountId: to!.id, debit: amount },
              { accountId: cash.id, credit: amount },
            ]
          : dto.type === 'IN'
            ? [{ accountId: cash.id, debit: amount }, ...lines.map((l) => ({ accountId: l.accountId, credit: l.amount, memo: l.memo }))]
            : [...lines.map((l) => ({ accountId: l.accountId, debit: l.amount, memo: l.memo })), { accountId: cash.id, credit: amount }];

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
            journalId: journal.id,
            notes: `Dibeli tunai, ${number}`,
          });
        }
      }
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'CashTransaction', entityId: trx.id });
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
        SELECT COUNT(*)::int AS n FROM bank_statement_lines b
        WHERE b.status IN ('MATCHED', 'CREATED')
          AND (b.journal_id = ${t.journalId} OR b.journal_line_id IN (SELECT id FROM journal_lines WHERE journal_id = ${t.journalId}))`);
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

    const diff = await this.db.execute<{ number: string }>(sql`
      SELECT number FROM cash_counts WHERE tenant_id = ${tenantId} AND date >= ${addDays(today, -30)} AND status = 'POSTED' AND difference <> 0`);
    add('COUNT_DIFF', 'warning', 'Hitung kas fisik dengan selisih (30 hari)', diff.rows.map((r) => r.number), `Telusuri penyebab selisih: ${list(diff.rows)}`);

    const voided = await this.db.query.cashTransactions.findMany({ where: and(eq(cashTransactions.tenantId, tenantId), eq(cashTransactions.status, 'VOID'), gte(cashTransactions.voidedAt, new Date(`${addDays(today, -30)}T00:00:00Z`))) });
    add('VOIDED', 'info', 'Transaksi kas dibatalkan (30 hari)', voided.map((t) => t.number), `Tinjau alasan pembatalan: ${list(voided)}`);
    return { generatedAt: new Date().toISOString(), count: out.length, items: out };
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
@Roles('ADMIN', 'FINANCE')
@RequireApp('cash')
@Controller('cash')
export class CashController {
  constructor(private readonly svc: CashService) {}

  /** Dipakai juga layar kasir untuk memilih laci kas & rekening QRIS */
  @Get('accounts')
  @Roles('ADMIN', 'FINANCE', 'CASHIER')
  @RequireApp('cash', 'pos')
  accounts(@CurrentUser() u: AuthUser) {
    return this.svc.accounts(u.tenantId);
  }

  @Get('counter-accounts')
  counter(@CurrentUser() u: AuthUser) {
    return this.svc.counterAccounts(u.tenantId);
  }

  @Get('transactions')
  list(@CurrentUser() u: AuthUser, @Query() q: CashQueryDto) {
    return this.svc.list(u.tenantId, q);
  }

  @Get('controls')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
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

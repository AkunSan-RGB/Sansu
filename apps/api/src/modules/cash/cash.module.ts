import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { RequireApp } from '../../common/apps/app.guard';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { CASH_TX_TYPES, CashTxType } from '@sansu/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, cashTransactionLines, cashTransactions, projects } from '../../db/schema';
import { AccountingModule } from '../accounting/accounting.module';
import { PostingService } from '../accounting/posting.service';
import { CashCountController, CashCountService } from './cash-count';

// ---------- DTO ----------
export class CashLineDto {
  @ApiProperty({ description: 'Akun lawan, mis. Beban Listrik atau Modal Pemilik' }) @IsUUID() accountId: string;
  @ApiProperty({ example: '350000' }) @IsNumberString() amount: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) memo?: string;
  @ApiPropertyOptional({ description: 'Kas keluar: biaya langsung proyek (usaha jasa)' }) @IsOptional() @IsUUID() projectId?: string;
}

export class CreateCashTxDto {
  @ApiProperty({ enum: CASH_TX_TYPES }) @IsIn(CASH_TX_TYPES) type: CashTxType;
  @ApiProperty({ description: 'Akun kas/bank (sumber untuk OUT/TRANSFER, tujuan untuk IN)' }) @IsUUID() cashAccountId: string;
  @ApiPropertyOptional({ description: 'TRANSFER: akun kas/bank tujuan' }) @IsOptional() @IsUUID() toCashAccountId?: string;
  @ApiPropertyOptional({ example: '1000000', description: 'TRANSFER: jumlah' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ example: 'Bayar listrik gudang Oktober' }) @IsString() @MaxLength(255) description: string;
  @ApiPropertyOptional({ example: 'No. tagihan PLN 123' }) @IsOptional() @IsString() @MaxLength(100) reference?: string;
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
  async create(user: AuthUser, dto: CreateCashTxDto) {
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const cash = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'CASH');

      let amount: Dec;
      let to: { id: string } | undefined;
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
        if (accs.some((a) => a.systemKey === 'AR' || a.systemKey === 'AP' || a.systemKey === 'INVENTORY')) {
          throw new BadRequestException(
            'Piutang, hutang, dan persediaan dicatat lewat dokumennya (pembayaran faktur / pembelian), bukan kas umum',
          );
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
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'CashTransaction', entityId: trx.id });
      return { ...trx, journalNumber: journal.number };
    });
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
          sql`COALESCE(${accounts.systemKey}, '') NOT IN ('AR', 'AP', 'INVENTORY')`,
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

  @Post('transactions')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCashTxDto) {
    return this.svc.create(u, dto);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [CashController, CashCountController],
  providers: [CashService, CashCountService],
})
export class CashModule {}

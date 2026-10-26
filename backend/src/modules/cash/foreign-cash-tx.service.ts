import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { assertNotFarFuture, toDocDate } from '../../common/utils/dates';
import { D, Dec, money } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { cashTransactions } from '../../db/schema';
import { insertOne, patchById } from '../../db/owned';
import { SYS } from '../accounting/default-coa';
import { ForeignCashService } from '../accounting/foreign-cash.service';
import { PostLine, PostingService } from '../accounting/posting.service';
import { FxService } from '../fx/fx.service';
import { CashRepository } from './cash.repository';
import { CashService } from './cash.service';
import { CreateForeignCashDto } from './foreign-cash-tx.dto';

type CashAcc = Awaited<ReturnType<PostingService['resolveCashAccount']>>;

/**
 * Transaksi kas dalam mata uang asing. Satu-satunya jalur menggerakkan rekening valas selain pelunasan faktur:
 *  - IN/OUT: terima/bayar valas dengan akun lawan; Rupiah dicatat pada kurs transaksi,
 *  - BUY/SELL: beli/jual valas terhadap Rupiah (selisih terhadap nilai tercatat = laba/rugi kurs terealisasi),
 *  - MOVE: pindah antar rekening valas yang mata uangnya sama (nilai Rupiah ikut berpindah, tanpa selisih).
 * Uang valas keluar dinilai pada biaya rata-rata tertimbang rekening (ForeignCashService.costOut).
 */
@Injectable()
export class ForeignCashTxService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly foreignCash: ForeignCashService,
    private readonly fx: FxService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly cash: CashService,
    private readonly repo: CashRepository,
  ) {}

  async create(user: AuthUser, dto: CreateForeignCashDto) {
    const date = toDocDate(dto.date);
    assertNotFarFuture(date, 'transaksi kas');
    const amountForeign = money(dto.amountForeign);
    if (amountForeign.lte(0)) throw new BadRequestException('Jumlah valas harus lebih dari 0');

    return this.db.transaction(async (tx) => {
      const from = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK', true);
      const to = dto.toCashAccountId ? await this.posting.resolveCashAccount(tx, user.tenantId, dto.toCashAccountId, 'BANK', true) : undefined;
      const isForeign = (a?: CashAcc) => !!a && a.currency !== 'IDR';
      let lines: PostLine[];
      let prefix: 'CASH_IN' | 'CASH_OUT' | 'TRANSFER';
      let txType: 'IN' | 'OUT' | 'TRANSFER';
      let currency: string;
      let valueIdr: Dec; // nilai Rupiah transaksi (untuk daftar, bukti, dan batas persetujuan)
      let outflow = true;

      const need = (ok: boolean, msg: string) => { if (!ok) throw new BadRequestException(msg); };
      const idr = () => {
        const v = dto.amountIdr ? money(dto.amountIdr) : D(0);
        need(v.gt(0), 'Isi jumlah Rupiah yang dibayar/diterima');
        return v;
      };

      switch (dto.kind) {
        case 'IN':
        case 'OUT': {
          need(isForeign(from), 'Pilih rekening valas');
          need(!!dto.counterAccountId, 'Pilih akun lawan');
          const counter = await this.counterAccount(tx, user, dto.counterAccountId!, dto.kind);
          currency = from.currency;
          const rate = (await this.fx.resolve(tx, user.tenantId, currency, date, dto.fxRate)).rate;
          valueIdr = money(amountForeign.times(rate));
          need(valueIdr.gt(0), 'Nilai Rupiah transaksi terlalu kecil');
          if (dto.kind === 'IN') {
            outflow = false;
            txType = 'IN'; prefix = 'CASH_IN';
            lines = [
              { accountId: from.id, debit: valueIdr, foreignAmount: amountForeign, memo: `${amountForeign.toFixed(2)} ${currency} @ ${rate.toFixed(2)}` },
              { accountId: counter.id, credit: valueIdr },
            ];
          } else {
            txType = 'OUT'; prefix = 'CASH_OUT';
            const cost = await this.foreignCash.costOut(tx, user.tenantId, from, amountForeign);
            const diff = valueIdr.minus(cost); // beban dinilai kurs transaksi, kas keluar di biaya tercatat
            lines = [
              { accountId: counter.id, debit: valueIdr },
              { accountId: from.id, credit: cost, foreignAmount: amountForeign, memo: `${amountForeign.toFixed(2)} ${currency}` },
              { key: SYS.FX_GAIN, credit: diff.gt(0) ? diff : 0 },
              { key: SYS.FX_LOSS, debit: diff.lt(0) ? diff.abs() : 0 },
            ];
          }
          break;
        }
        case 'BUY': {
          need(!isForeign(from), 'Sumber pembelian valas harus rekening Rupiah');
          need(isForeign(to), 'Pilih rekening valas tujuan');
          currency = to!.currency;
          valueIdr = idr();
          txType = 'TRANSFER'; prefix = 'TRANSFER';
          await this.posting.assertCashCovers(tx, user.tenantId, from, valueIdr);
          lines = [
            { accountId: to!.id, debit: valueIdr, foreignAmount: amountForeign, memo: `Beli ${amountForeign.toFixed(2)} ${currency} @ ${valueIdr.div(amountForeign).toFixed(2)}` },
            { accountId: from.id, credit: valueIdr },
          ];
          break;
        }
        case 'SELL': {
          need(isForeign(from), 'Sumber penjualan valas harus rekening valas');
          need(!!to && !isForeign(to), 'Pilih rekening Rupiah tujuan');
          currency = from.currency;
          valueIdr = idr();
          txType = 'TRANSFER'; prefix = 'TRANSFER';
          const cost = await this.foreignCash.costOut(tx, user.tenantId, from, amountForeign);
          const diff = valueIdr.minus(cost);
          lines = [
            { accountId: to!.id, debit: valueIdr },
            { accountId: from.id, credit: cost, foreignAmount: amountForeign, memo: `Jual ${amountForeign.toFixed(2)} ${currency} @ ${valueIdr.div(amountForeign).toFixed(2)}` },
            { key: SYS.FX_GAIN, credit: diff.gt(0) ? diff : 0 },
            { key: SYS.FX_LOSS, debit: diff.lt(0) ? diff.abs() : 0 },
          ];
          break;
        }
        case 'MOVE': {
          need(isForeign(from) && isForeign(to), 'Pilih dua rekening valas');
          need(from.id !== to!.id, 'Rekening asal dan tujuan harus berbeda');
          need(from.currency === to!.currency, `Mata uang berbeda (${from.currency} ke ${to!.currency}). Jual dulu ke Rupiah, lalu beli mata uang tujuan.`);
          currency = from.currency;
          txType = 'TRANSFER'; prefix = 'TRANSFER';
          const cost = await this.foreignCash.costOut(tx, user.tenantId, from, amountForeign);
          valueIdr = cost;
          lines = [
            { accountId: to!.id, debit: cost, foreignAmount: amountForeign },
            { accountId: from.id, credit: cost, foreignAmount: amountForeign },
          ];
          break;
        }
      }

      // kontrol yang sama dengan kas Rupiah: bukti untuk uang keluar besar, persetujuan untuk non-approver
      if (outflow) {
        const gross = valueIdr.toNumber();
        const cfg = await this.cash.cashSettings(user.tenantId, tx);
        if (cfg.evidenceFrom > 0 && gross >= cfg.evidenceFrom && !dto.reference?.trim()) {
          throw new BadRequestException(`Isi nomor bukti/referensi: wajib untuk uang keluar mulai Rp${cfg.evidenceFrom.toLocaleString('id-ID')}`);
        }
        if ((await this.approvals.needs(tx, user, 'CASH_TX', gross)) !== null) {
          throw new BadRequestException('Nilai transaksi valas mencapai batas persetujuan; hanya Pemilik/Admin yang dapat mencatatnya.');
        }
      }

      const number = await this.seq.next(tx, user.tenantId, prefix, date);
      const trx = await insertOne(tx, cashTransactions, {
        tenantId: user.tenantId,
        number,
        date,
        type: txType,
        cashAccountId: from.id,
        toCashAccountId: to?.id,
        amount: valueIdr.toFixed(2),
        currency,
        amountForeign: amountForeign.toFixed(2),
        description: dto.description,
        reference: dto.reference,
        createdById: user.sub,
        branchId: dto.branchId ?? from.branchId ?? null,
      });
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `${number} ${dto.description}`,
        sourceType: txType === 'IN' ? 'CASH_IN' : txType === 'OUT' ? 'CASH_OUT' : 'TRANSFER',
        sourceId: trx.id,
        createdById: user.sub,
        lines,
      });
      await patchById(tx, cashTransactions, trx.id, { journalId: journal.id });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'CashTransaction', entityId: trx.id, data: { kind: dto.kind, currency, amountForeign: amountForeign.toFixed(2) } });
      return { ...trx, journalNumber: journal.number };
    });
  }

  /** Akun lawan IN/OUT valas: bukan kas/bank, bukan piutang/hutang/persediaan (dicatat lewat dokumennya); Keuangan hanya untuk biaya */
  private async counterAccount(tx: Parameters<CashRepository['listAccountsById']>[0], user: AuthUser, id: string, kind: 'IN' | 'OUT') {
    const [acc] = await this.repo.listAccountsById(tx, user.tenantId, [id]);
    if (!acc) throw new BadRequestException('Akun lawan tidak ditemukan');
    if (acc.isCashAccount) throw new BadRequestException('Akun lawan tidak boleh akun kas/bank; gunakan Beli/Jual/Pindah valas');
    if (['AR', 'AP', 'INVENTORY', 'INVENTORY_SEMI'].includes(acc.systemKey ?? '')) {
      throw new BadRequestException('Piutang, hutang, dan persediaan dicatat lewat dokumennya (pembayaran faktur / pembelian), bukan kas umum');
    }
    if (kind === 'OUT' && user.role === 'FINANCE' && acc.type !== 'EXPENSE') {
      throw new BadRequestException('Keuangan hanya dapat mencatat uang keluar untuk biaya operasional. Selain itu dicatat oleh Pemilik/Admin atau lewat dokumennya.');
    }
    return acc;
  }
}

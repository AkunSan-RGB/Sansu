import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lte } from 'drizzle-orm';
import { BASE_CURRENCY, isForeignCurrency, isKnownForeignCurrency } from '@sansu/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { addDays, assertNotFarFuture, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { exchangeRates } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { RevaluationDto, UpsertRateDto } from './fx.dto';
import { FxRepository } from './fx.repository';
import type { OpenItemRow } from './fx.repository';

interface OpenItem {
  kind: 'AR' | 'AP';
  id: string;
  number: string;
  party: string;
  currency: string;
  date: string;
  outstandingForeign: Dec;
  carrying: Dec;
}

@Injectable()
export class FxService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly repo: FxRepository,
  ) {}

  list(tenantId: string, currency?: string) {
    return this.db.query.exchangeRates.findMany({
      where: and(eq(exchangeRates.tenantId, tenantId), currency ? eq(exchangeRates.currency, currency) : undefined),
      orderBy: [desc(exchangeRates.date), exchangeRates.currency],
      limit: 400,
    });
  }

  /** Kurs terbaru pada atau sebelum tanggal; kosong bila belum pernah diisi */
  async rateOn(db: DbOrTx, tenantId: string, currency: string, date: string): Promise<string | null> {
    const [r] = await this.repo.findExchangeRatesByCurrencyAndDate(db, tenantId, currency, date);
    return r?.rate ?? null;
  }

  /**
   * Kurs yang dipakai dokumen: IDR → 1; valas → kurs yang diketik pengguna, atau kurs tersimpan terbaru pada/sebelum tanggal dokumen.
   * Mata uang tak dikenal atau kurs belum ada ditolak agar tidak ada transaksi dengan kurs tebakan.
   */
  async resolve(db: DbOrTx, tenantId: string, currency: string | undefined, date: string, explicit?: string): Promise<{ currency: string; rate: Dec }> {
    const cur = (currency ?? BASE_CURRENCY).toUpperCase();
    if (!isForeignCurrency(cur)) return { currency: BASE_CURRENCY, rate: D(1) };
    if (!isKnownForeignCurrency(cur)) throw new BadRequestException(`Mata uang ${cur} tidak dikenal`);
    if (explicit !== undefined && explicit !== '') {
      const r = D(explicit);
      if (!r.isFinite() || r.lte(0)) throw new BadRequestException('Kurs harus lebih dari 0');
      return { currency: cur, rate: r };
    }
    const stored = await this.rateOn(db, tenantId, cur, date);
    if (!stored) throw new BadRequestException(`Kurs ${cur} belum ada. Isi kurs di Pengaturan › Kurs mata uang atau ketik kurs pada dokumen.`);
    return { currency: cur, rate: D(stored) };
  }

  /** Kurs tersimpan terbaru pada/sebelum tanggal (kosong = hari ini), untuk mengisi formulir */
  rateFor(tenantId: string, currency: string, date?: string) {
    return this.rateOn(this.db, tenantId, currency, toDocDate(date));
  }

  async upsert(user: AuthUser, dto: UpsertRateDto) {
    if (!isKnownForeignCurrency(dto.currency)) throw new BadRequestException(`Mata uang ${dto.currency} tidak dikenal`);
    const rate = D(dto.rate);
    if (rate.lte(0)) throw new BadRequestException('Kurs harus lebih dari 0');
    const date = toDocDate(dto.date);
    assertNotFarFuture(date, 'kurs');
    const [row] = await this.repo.insertExchangeRates(this.db, user.tenantId, dto, date, rate);
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPSERT', entity: 'ExchangeRate', entityId: row.id, data: { currency: dto.currency, date, rate: rate.toFixed(6) } });
    return row;
  }

  async remove(user: AuthUser, id: string) {
    const [row] = await this.repo.deleteExchangeRatesById(this.db, id, user.tenantId);
    if (!row) throw new NotFoundException('Kurs tidak ditemukan');
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'DELETE', entity: 'ExchangeRate', entityId: id });
    return { ok: true };
  }

  /** Piutang dan utang valas yang masih terbuka per tanggal (pelunasan sesudahnya tidak dihitung) */
  private async openItems(tenantId: string, asOf: string): Promise<OpenItem[]> {
    const ar = await this.repo.queryInvoice(this.db, asOf, tenantId);
    const ap = await this.repo.queryPurchaseInvoice(this.db, asOf, tenantId);
    const map = (kind: 'AR' | 'AP') => (r: OpenItemRow): OpenItem => ({ kind, id: r.id, number: r.number, party: r.party, currency: r.currency, date: r.date, outstandingForeign: D(r.out_f), carrying: D(r.carrying) });
    return [...ar.rows.map(map('AR')), ...ap.rows.map(map('AP'))].filter((x) => x.outstandingForeign.gt(0.004));
  }

  /** Posisi valas terbuka dan selisih kurs belum terealisasi bila dinilai pada kurs tanggal tersebut */
  async exposure(tenantId: string, asOfInput?: string) {
    const asOf = toDocDate(asOfInput);
    const items = await this.openItems(tenantId, asOf);
    const rates = new Map<string, string | null>();
    for (const cur of new Set(items.map((i) => i.currency))) rates.set(cur, await this.rateOn(this.db, tenantId, cur, asOf));
    const rows = items.map((i) => {
      const rate = rates.get(i.currency) ?? null;
      const value = rate ? money(i.outstandingForeign.times(rate)) : null;
      // piutang: nilai lebih tinggi = laba; utang: nilai lebih tinggi = rugi
      const unrealized = value ? (i.kind === 'AR' ? value.minus(i.carrying) : i.carrying.minus(value)) : null;
      return {
        kind: i.kind, id: i.id, number: i.number, party: i.party, currency: i.currency, date: i.date,
        outstandingForeign: i.outstandingForeign.toFixed(2), carrying: i.carrying.toFixed(2),
        rate, valueAtRate: value?.toFixed(2) ?? null, unrealized: unrealized?.toFixed(2) ?? null,
      };
    });
    const byCurrency = new Map<string, { currency: string; rate: string | null; receivable: Dec; payable: Dec; unrealized: Dec }>();
    for (const r of rows) {
      const g = byCurrency.get(r.currency) ?? { currency: r.currency, rate: r.rate, receivable: ZERO, payable: ZERO, unrealized: ZERO };
      if (r.kind === 'AR') g.receivable = g.receivable.plus(r.outstandingForeign);
      else g.payable = g.payable.plus(r.outstandingForeign);
      g.unrealized = g.unrealized.plus(r.unrealized ?? 0);
      byCurrency.set(r.currency, g);
    }
    return {
      asOf,
      rows,
      byCurrency: [...byCurrency.values()].map((g) => ({ currency: g.currency, rate: g.rate, receivable: g.receivable.toFixed(2), payable: g.payable.toFixed(2), net: g.receivable.minus(g.payable).toFixed(2), unrealized: g.unrealized.toFixed(2) })),
      unrealized: rows.reduce<Dec>((a, r) => a.plus(r.unrealized ?? 0), ZERO).toFixed(2),
      missingRates: [...rates.entries()].filter(([, r]) => !r).map(([c]) => c),
    };
  }

  /**
   * Penilaian ulang akhir periode (PSAK 10 / IAS 21): saldo piutang dan utang valas dinilai pada kurs penutup; selisih terhadap nilai
   * tercatat menjadi laba/rugi selisih kurs BELUM terealisasi. Jurnal dibalik otomatis sehari sesudahnya sehingga pelunasan
   * berikutnya menghitung selisih terealisasi dari nilai tercatat awal (tidak ada penghitungan ganda). Dicatat di akun
   * penyesuaian terpisah agar saldo Piutang/Utang Usaha tetap sama dengan rincian fakturnya.
   */
  async revalue(user: AuthUser, dto: RevaluationDto) {
    const date = toDocDate(dto.date);
    if (date > todayJakarta()) throw new BadRequestException('Penilaian ulang tidak bisa untuk tanggal yang belum tiba');
    const exp = await this.exposure(user.tenantId, date);
    if (!exp.rows.length) throw new BadRequestException('Tidak ada piutang atau utang valas yang terbuka pada tanggal itu');
    if (exp.missingRates.length) throw new BadRequestException(`Kurs ${exp.missingRates.join(', ')} belum ada pada atau sebelum ${date}. Isi kurs penutup dulu.`);

    return this.db.transaction(async (tx) => {
      const [dup] = (await this.repo.queryJournalEntry(tx, user.tenantId, date)).rows;
      if (dup) throw new BadRequestException(`Penilaian ulang tanggal ${date} sudah dicatat (${dup.number})`);

      const sum = (kind: 'AR' | 'AP') => exp.rows.filter((r) => r.kind === kind).reduce<Dec>((a, r) => a.plus(r.unrealized ?? 0), ZERO);
      const ar = sum('AR');
      const ap = sum('AP');
      if (ar.isZero() && ap.isZero()) throw new BadRequestException('Nilai tercatat sudah sama dengan nilai pada kurs penutup; tidak ada selisih untuk dicatat');
      const pos = (v: Dec) => (v.gt(0) ? v : 0);
      const neg = (v: Dec) => (v.lt(0) ? v.abs() : 0);
      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Penilaian ulang piutang dan utang valas per ${date}`,
        sourceType: 'FX_REVAL',
        createdById: user.sub,
        lines: [
          // `ar` dan `ap` bernilai positif bila laba: piutang naik / utang turun menambah laba
          { key: SYS.FX_REVAL_AR, debit: pos(ar), credit: neg(ar), memo: 'Penyesuaian kurs piutang valas' },
          { key: SYS.FX_REVAL_AP, debit: pos(ap), credit: neg(ap), memo: 'Penyesuaian kurs utang valas' },
          { key: SYS.FX_GAIN, credit: ar.plus(ap).gt(0) ? ar.plus(ap) : 0 },
          { key: SYS.FX_LOSS, debit: ar.plus(ap).lt(0) ? ar.plus(ap).abs() : 0 },
        ],
      });
      const reversal = await this.posting.reverse(tx, user.tenantId, journal.id, addDays(date, 1), user.sub, true);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'FxRevaluation', entityId: journal.id, data: { date, receivable: ar.toFixed(2), payable: ap.toFixed(2) } });
      return { date, journalNumber: journal.number, reversalNumber: reversal.number, receivable: ar.toFixed(2), payable: ap.toFixed(2), net: ar.plus(ap).toFixed(2), items: exp.rows.length };
    });
  }
}

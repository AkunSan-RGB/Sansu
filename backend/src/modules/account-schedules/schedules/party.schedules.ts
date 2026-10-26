import { Injectable } from '@nestjs/common';
import { D, Dec, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import type { AccountMeta } from '../../accounting/ledger-data';
import { AccountSchedulesRepository, AP_SPEC, AR_SPEC, type PartySpec } from '../account-schedules.repository';
import { col, money, movementTable, openingOf } from '../account-schedule.support';
import { agingDate } from './aging';
import type { AccountSchedule, ScheduleBody, ScheduleContext, ScheduleMethod, ScheduleRow, ScheduleTable } from '../account-schedule.types';

interface PartyLabels {
  title: string;
  party: string;
  addLabel: string;
  paidLabel: string;
  method: ScheduleMethod;
  systemKey: string;
}

/** Umur per faktur terbuka dan rekap umur per pihak; jatuh tempo dihitung terhadap akhir tahun laporan (atau hari ini bila tahun berjalan) */
const BUCKETS = ['Belum jatuh tempo', '1–30 hari', '31–60 hari', '61–90 hari', 'Lebih dari 90 hari'];
const bucketOf = (days: number) => (days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4);

/**
 * Jadwal piutang/utang usaha per pihak lawan: saldo awal, penambahan (faktur), pengurangan (pembayaran, retur), saldo akhir.
 * Selisih terhadap buku besar (PPh dipotong, uang muka, jurnal manual) ditampilkan sebagai baris penyesuaian tersendiri, bukan disembunyikan.
 */
abstract class PartySchedule implements AccountSchedule {
  abstract readonly kind: string;
  protected abstract spec: PartySpec;
  protected abstract labels: PartyLabels;

  constructor(
    @InjectDb() protected readonly db: DbOrTx,
    protected readonly repo: AccountSchedulesRepository,
  ) {}

  supports(a: AccountMeta) {
    return a.systemKey === this.labels.systemKey;
  }


  /** Umur faktur terbuka: rekap per pihak dan daftar per faktur; temuan bila jumlahnya berbeda dari buku besar */
  protected async agingTables(cx: ScheduleContext, glClosing: Dec, findings: string[]): Promise<ScheduleTable[]> {
  const asOf = agingDate(cx.to);
  const open = (await this.repo.openDocuments(this.db, cx.tenantId, this.spec, cx.to)).rows.filter((r) => D(r.outstanding).abs().gte(0.005));
  if (!open.length) return [];
  const days = (due: string) => Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
  const byParty = new Map<string, Dec[]>();
  const docRows: ScheduleRow[] = open.map((r) => {
    const d = days(r.due_date);
    const out = D(r.outstanding);
    const k = `${r.party_code} ${r.party}`;
    const b = byParty.get(k) ?? BUCKETS.map(() => ZERO);
    b[bucketOf(d)] = b[bucketOf(d)].plus(out);
    byParty.set(k, b);
    return { cells: { number: r.number, party: `${r.party_code} ${r.party}`, date: r.date, due: r.due_date, total: money(D(r.total)), outstanding: money(out), late: Math.max(d, 0), bucket: BUCKETS[bucketOf(d)] } };
  });
  const sum = open.reduce((s, r) => s.plus(r.outstanding), ZERO);
  const totals = BUCKETS.map((_, i) => [...byParty.values()].reduce((s, b) => s.plus(b[i]), ZERO));
  if (sum.minus(glClosing).abs().gte(0.5)) findings.push(`Sisa faktur terbuka (${money(sum)}) berbeda dari saldo buku besar (${money(glClosing)}); selisih berasal dari uang muka, PPh dipotong, atau jurnal manual.`);
  return [
    {
      key: 'aging-by-party',
      title: `Umur ${this.labels.title.toLowerCase()} per ${this.labels.party.toLowerCase()}`,
      note: `Per ${asOf}, menurut tanggal jatuh tempo faktur yang belum lunas.`,
      columns: [col('party', this.labels.party, 'text'), ...BUCKETS.map((b, i) => col(`b${i}`, b)), col('total', 'Jumlah')],
      rows: [...byParty.entries()].map(([name, b]) => ({ cells: { party: name, ...Object.fromEntries(b.map((v, i) => [`b${i}`, money(v)])), total: money(b.reduce((s, v) => s.plus(v), ZERO)) } })),
      total: { party: 'Jumlah', ...Object.fromEntries(totals.map((v, i) => [`b${i}`, money(v)])), total: money(sum) },
    },
    {
      key: 'open-documents',
      title: `Daftar faktur belum lunas`,
      note: 'Sisa = total faktur − pembayaran − retur sampai akhir periode.',
      columns: [col('number', 'No. faktur', 'text'), col('party', this.labels.party, 'text'), col('date', 'Tanggal', 'date'), col('due', 'Jatuh tempo', 'date'), col('total', 'Total faktur'), col('outstanding', 'Sisa'), col('late', 'Terlambat (hari)', 'qty'), col('bucket', 'Umur', 'text')],
      rows: docRows,
      total: { number: 'Jumlah sisa', outstanding: money(sum) },
    },
  ];
  }

  async build(cx: ScheduleContext): Promise<ScheduleBody> {
    const L = this.labels;
    const raw = (await this.repo.partyMovements(this.db, cx.tenantId, this.spec, cx.from, cx.to)).rows;
    const rows: ScheduleRow[] = [];
    let tOpen = ZERO, tAdd = ZERO, tPaid = ZERO, tRet = ZERO, tClose = ZERO;
    for (const r of raw) {
      const open = D(r.opening), add = D(r.added), paid = D(r.paid), ret = D(r.returned);
      const close = open.plus(add).minus(paid).minus(ret);
      if ([open, add, paid, ret, close].every((v) => v.abs().lt(0.005))) continue;
      tOpen = tOpen.plus(open); tAdd = tAdd.plus(add); tPaid = tPaid.plus(paid); tRet = tRet.plus(ret); tClose = tClose.plus(close);
      rows.push({ cells: { party: `${r.code} ${r.name}`, opening: money(open), add: money(add), paid: money(paid), ret: money(ret), closing: money(close) } });
    }
    const gl = movementTable(cx.account, cx.movement, cx.year, { add: L.addLabel, sub: L.paidLabel }, 'Pembanding: mutasi buku besar per bulan');
    const glOpen = openingOf(cx.account, cx.movement);
    const other: Dec = gl.closing.minus(tClose);
    const adjust = (a: Dec, b: Dec) => a.minus(b);
    const detail = {
      key: 'party-rollforward',
      title: `${L.title} per ${L.party}`,
      note: 'Dasar: total faktur − pembayaran − retur menurut tanggal dokumen. Baris "Penyesuaian lain" adalah selisih terhadap buku besar.',
      columns: [col('party', L.party, 'text'), col('opening', 'Saldo awal'), col('add', L.addLabel), col('paid', L.paidLabel), col('ret', 'Retur'), col('closing', 'Saldo akhir')],
      rows: [
        ...rows,
        { cells: { party: 'Penyesuaian lain (PPh dipotong, uang muka, jurnal manual)', opening: money(adjust(glOpen, tOpen)), add: null, paid: null, ret: null, closing: money(other) } },
      ],
      total: { party: 'Saldo akun menurut jadwal', opening: money(glOpen), add: money(tAdd), paid: money(tPaid), ret: money(tRet), closing: money(gl.closing) },
    };
    const findings: string[] = [];
    if (other.abs().gte(0.005)) {
      findings.push(`Saldo akhir menurut dokumen (${money(tClose)}) berbeda dari buku besar (${money(gl.closing)}): ${money(other)} berasal dari penyesuaian di luar faktur/pembayaran/retur. Tinjau jurnal manual dan PPh/uang muka.`);
    }
    const aging = await this.agingTables(cx, gl.closing, findings);
    return { title: L.title, method: L.method, tables: [detail, ...aging, gl.table], closing: gl.closing, findings };
  }
}

@Injectable()
export class ReceivableSchedule extends PartySchedule {
  readonly kind = 'RECEIVABLE';
  protected spec = AR_SPEC;
  protected labels: PartyLabels = {
    title: 'Piutang usaha',
    party: 'Pelanggan',
    addLabel: 'Faktur penjualan',
    paidLabel: 'Pembayaran',
    systemKey: 'AR',
    method: {
      basis: 'Piutang diakui saat faktur penjualan dibukukan dan berkurang oleh pembayaran dan retur penjualan.',
      formulas: ['Saldo akhir = saldo awal + faktur − pembayaran − retur', 'Umur piutang dihitung sejak tanggal jatuh tempo (lihat Lampiran L1)', 'Penyisihan kerugian piutang menurut kebijakan akuntansi perusahaan'],
    },
  };
}

@Injectable()
export class PayableSchedule extends PartySchedule {
  readonly kind = 'PAYABLE';
  protected spec = AP_SPEC;
  protected labels: PartyLabels = {
    title: 'Utang usaha',
    party: 'Pemasok',
    addLabel: 'Tagihan pembelian',
    paidLabel: 'Pembayaran',
    systemKey: 'AP',
    method: {
      basis: 'Utang diakui saat tagihan pemasok dibukukan dan berkurang oleh pembayaran dan retur pembelian.',
      formulas: ['Saldo akhir = saldo awal + tagihan − pembayaran − retur', 'Umur utang dihitung sejak tanggal jatuh tempo (lihat Lampiran L2)'],
    },
  };
}

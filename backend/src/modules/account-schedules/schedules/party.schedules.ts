import { Injectable } from '@nestjs/common';
import { D, Dec, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import type { AccountMeta } from '../../accounting/ledger-data';
import { AccountSchedulesRepository, AP_SPEC, AR_SPEC, type PartySpec } from '../account-schedules.repository';
import { col, money, movementTable, openingOf } from '../account-schedule.support';
import type { AccountSchedule, ScheduleBody, ScheduleContext, ScheduleMethod, ScheduleRow } from '../account-schedule.types';

interface PartyLabels {
  title: string;
  party: string;
  addLabel: string;
  paidLabel: string;
  method: ScheduleMethod;
  systemKey: string;
}

/**
 * Jadwal piutang/utang usaha per pihak lawan: saldo awal, penambahan (faktur), pengurangan (pembayaran, retur), saldo akhir.
 * Selisih terhadap buku besar (PPh dipotong, uang muka, jurnal manual) ditampilkan sebagai baris penyesuaian tersendiri, bukan disembunyikan.
 */
abstract class PartySchedule implements AccountSchedule {
  abstract readonly kind: string;
  protected abstract spec: PartySpec;
  protected abstract labels: PartyLabels;

  constructor(
    @InjectDb() private readonly db: DbOrTx,
    private readonly repo: AccountSchedulesRepository,
  ) {}

  supports(a: AccountMeta) {
    return a.systemKey === this.labels.systemKey;
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
    return { title: L.title, method: L.method, tables: [detail, gl.table], closing: gl.closing, findings };
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

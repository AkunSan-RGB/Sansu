import { Injectable } from '@nestjs/common';
import { D, Dec, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import type { AccountMeta } from '../../accounting/ledger-data';
import { FxService } from '../../fx/fx.service';
import { AccountSchedulesRepository } from '../account-schedules.repository';
import { col, money, netOf, openingOf } from '../account-schedule.support';
import type { ScheduleContext, ScheduleRow, ScheduleTable } from '../account-schedule.types';
import { agingDate, agingTable, fifoAging, OVERDUE_DAYS } from './aging';
import { JournalItemSchedule, type Extras, type JournalItemProfile, type JournalLine } from './journal-item.schedule';

const rp = (v: Dec | string) => Math.round(Number(v)).toLocaleString('id-ID');
const TOL = D('0.5');

/** Profil jurnal-per-item dengan judul sisi penambahan/pengurangan yang konsisten */
const profile = (o: { title: string; groups?: JournalItemProfile['groups']; increases: 'debit' | 'credit'; add: string; sub: string; basis: string; formulas: string[]; policies?: string[] }): JournalItemProfile => ({
  title: o.title,
  groups: o.groups ?? [],
  increases: o.increases,
  addTitle: `${o.add} (saldo awal dan penambahan tahun ini)`,
  subTitle: `${o.sub} tahun ini`,
  addLabel: `${o.add} (${o.increases === 'debit' ? 'debit' : 'kredit'})`,
  subLabel: `${o.sub} (${o.increases === 'debit' ? 'kredit' : 'debit'})`,
  method: { basis: o.basis, formulas: o.formulas, policies: o.policies },
});

/**
 * Dasar jadwal akun neraca tanpa daftar dokumen sendiri: rincian per jurnal (dari kelas induk) ditambah umur saldo (FIFO) dan,
 * bila ada, tabel pendukung dari kartu pembantu akun itu. `subledger` mengembalikan tabel/temuan khas akun; saldo akhir tetap dari buku besar.
 */
abstract class AgedBalanceSchedule extends JournalItemSchedule {
  /** Sebutan saldo pada judul tabel umur (mis. "piutang karyawan") */
  protected noun(_a: AccountMeta): string {
    return 'saldo';
  }
  /** Tabel dan temuan khas akun dari kartu pembantunya */
  protected subledger(_cx: ScheduleContext, _closing: Dec): Promise<Extras> {
    return Promise.resolve({ tables: [], findings: [] });
  }

  protected async extras(cx: ScheduleContext, lines: JournalLine[], closing: Dec): Promise<Extras> {
    const p = this.profileFor(cx.account);
    const sub = await this.subledger(cx, closing);
    const asOf = agingDate(cx.to);
    const net = (l: JournalLine) => (p.increases === 'debit' ? D(l.debit).minus(l.credit) : D(l.credit).minus(l.debit));
    const tables = [...sub.tables];
    const findings = [...sub.findings];
    if (closing.gt(0.005)) {
      const ag = fifoAging({ opening: openingOf(cx.account, cx.movement), openingDate: `${cx.year - 1}-12-31`, lines: lines.map((l) => ({ date: l.date, net: net(l) })), asOf });
      tables.push(agingTable(ag, asOf, this.noun(cx.account)));
      const old = ag.buckets[3];
      if (old.gt(TOL)) findings.push(`Rp${rp(old)} (${ag.remaining.gt(0) ? old.div(ag.remaining).times(100).toFixed(0) : 0}% dari saldo) sudah lebih dari ${OVERDUE_DAYS} hari. Tindak lanjuti penyelesaiannya atau nilai kemungkinan tidak tertagih/terselesaikan.`);
    }
    return { tables, findings };
  }
}

const OTHER_ASSET_GROUPS: JournalItemProfile['groups'] = ['OTHER_RECEIVABLE', 'OTHER_CURRENT_ASSET', 'OTHER_NONCURRENT_ASSET', 'INTANGIBLE_ASSET', 'ACCUMULATED_AMORTIZATION'];

/** Piutang lain-lain dan aset lain: kasbon, klaim, titipan, jaminan, platform/QRIS belum cair, retensi, aset kontrak, antar cabang */
@Injectable()
export class OtherAssetSchedule extends AgedBalanceSchedule {
  readonly kind = 'OTHER_ASSET';
  protected profile = profile({
    title: 'Piutang lain-lain dan aset lain',
    groups: OTHER_ASSET_GROUPS,
    increases: 'debit',
    add: 'Penambahan',
    sub: 'Penyelesaian / pelunasan',
    basis: 'Tagihan dan aset non-faktur dicatat sebesar jumlah yang diharapkan diterima atau dimanfaatkan, dengan penyelesaian dicatat pada periode terjadinya.',
    formulas: ['Saldo akhir = saldo awal + penambahan − penyelesaian', 'Umur saldo: penyelesaian melunasi penambahan tertua lebih dulu (FIFO)'],
    policies: ['Saldo yang tidak punya jadwal penyelesaian atau sudah lama tidak bergerak dinilai kemungkinan tertagih/terpakainya.'],
  });

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository) {
    super(db, repo);
  }

  protected noun(a: AccountMeta) {
    return a.name.toLowerCase();
  }

  protected profileFor(a: AccountMeta): JournalItemProfile {
    const k = a.systemKey;
    if (a.reportGroup === 'ACCUMULATED_AMORTIZATION') {
      return profile({ title: 'Akumulasi amortisasi', increases: 'credit', add: 'Amortisasi', sub: 'Pengurangan (pelepasan)', basis: 'Aset takberwujud diamortisasi sepanjang masa manfaatnya; akumulasi mengurangi nilai tercatat.', formulas: ['Akumulasi akhir = akumulasi awal + amortisasi − pelepasan', 'Nilai tercatat = harga perolehan − akumulasi amortisasi'] });
    }
    if (a.reportGroup === 'INTANGIBLE_ASSET') {
      return profile({ title: 'Aset takberwujud', increases: 'debit', add: 'Perolehan', sub: 'Pelepasan / penghapusan', basis: 'Aset takberwujud diakui pada biaya perolehan bila manfaat ekonomi masa depan dapat diidentifikasi dan diukur andal.', formulas: ['Saldo akhir = saldo awal + perolehan − pelepasan', 'Amortisasi dicatat di akun akumulasi amortisasi'] });
    }
    if (k === 'PLATFORM_RECEIVABLE') {
      return profile({ title: 'Piutang platform pesan-antar (belum cair)', increases: 'debit', add: 'Penjualan lewat platform', sub: 'Pencairan dan komisi platform', basis: 'Penjualan lewat platform diakui saat pesanan selesai; kas diterima saat platform mencairkan dana setelah dipotong komisi.', formulas: ['Saldo = penjualan platform − pencairan − komisi', 'Selisih pencairan = pencairan seharusnya − pencairan diterima'] });
    }
    if (k === 'PRINCIPAL_CLAIM') {
      return profile({ title: 'Piutang klaim promo ke prinsipal', increases: 'debit', add: 'Klaim disetujui', sub: 'Pembayaran klaim', basis: 'Promo yang ditanggung prinsipal diakui sebagai piutang saat klaim disetujui prinsipal.', formulas: ['Saldo = klaim disetujui − klaim dibayar prinsipal', 'Klaim diajukan belum menjadi piutang sampai disetujui'] });
    }
    if (k === 'INTERBRANCH') {
      return profile({ title: 'Rekening antar cabang', increases: 'debit', add: 'Piutang antar cabang', sub: 'Utang antar cabang / penyelesaian', basis: 'Transaksi lintas cabang ditutup lewat rekening antar cabang: piutang di satu cabang dan utang di cabang lain; saldo gabungan nol.', formulas: ['Saldo gabungan seluruh cabang = 0', 'Saldo per cabang = Σ debit − Σ kredit cabang itu'] });
    }
    if (k === 'UNBILLED_REVENUE') {
      return profile({ title: 'Pendapatan belum ditagih (aset kontrak)', increases: 'debit', add: 'Pendapatan diakui melebihi tagihan', sub: 'Penagihan / pembalikan', basis: 'Pendapatan proyek diakui menurut kemajuan pekerjaan; selisih lebih besar dari yang ditagih menjadi aset kontrak.', formulas: ['Aset kontrak proyek = pendapatan diakui kumulatif − ditagih kumulatif', 'Pendapatan diakui = nilai kontrak × persentase kemajuan'] });
    }
    if (a.code === '1-1130') {
      return profile({ title: 'Piutang pembayaran digital (QRIS & kartu, belum cair)', increases: 'debit', add: 'Penjualan non-tunai', sub: 'Pencairan (neto MDR)', basis: 'Penjualan dengan QRIS/kartu diakui saat transaksi; kas diterima saat penyelenggara mencairkan dana setelah dipotong MDR.', formulas: ['Saldo = penjualan non-tunai − pencairan − MDR', 'Pencairan seharusnya = bruto − MDR (persen kesepakatan)'] });
    }
    if (a.code === '1-1380') {
      return profile({ title: 'Piutang retensi proyek', increases: 'debit', add: 'Retensi ditahan pelanggan', sub: 'Retensi dibayar', basis: 'Bagian tagihan yang ditahan pelanggan sampai masa pemeliharaan selesai diakui sebagai piutang retensi.', formulas: ['Retensi = tagihan proyek × persen retensi', 'Saldo = retensi ditahan − retensi dibayar'] });
    }
    if (a.code === '1-1600') {
      return profile({ title: 'Piutang karyawan (kasbon)', increases: 'debit', add: 'Kasbon diberikan', sub: 'Pelunasan / potong gaji', basis: 'Pinjaman ke karyawan dicatat sebagai piutang dan dilunasi lewat pemotongan gaji atau setoran tunai.', formulas: ['Saldo = kasbon diberikan − pelunasan', 'Cicilan potong gaji dibukukan lewat penggajian'] });
    }
    if (a.code === '1-2700') {
      return profile({ title: 'Uang jaminan', increases: 'debit', add: 'Jaminan diserahkan', sub: 'Jaminan dikembalikan / dihapus', basis: 'Uang jaminan (sewa, listrik, pemasok) dicatat sebesar yang dibayarkan dan dikembalikan pada akhir kontrak.', formulas: ['Saldo = jaminan diserahkan − jaminan dikembalikan', 'Jaminan jangka panjang dinilai bila ada efek diskonto yang material'] });
    }
    return this.profile;
  }

  protected async subledger(cx: ScheduleContext, closing: Dec): Promise<Extras> {
    const a = cx.account;
    const tables: ScheduleTable[] = [];
    const findings: string[] = [];
    if (a.systemKey === 'PLATFORM_RECEIVABLE') {
      const r = (await this.repo.platformSettlements(this.db, cx.tenantId, cx.from, cx.to)).rows;
      tables.push({
        key: 'platform-settlements',
        title: 'Pencairan platform per kanal',
        note: 'Pencairan yang sudah dicatat tahun ini; selisih = diterima − seharusnya (komisi/denda platform).',
        columns: [col('channel', 'Kanal', 'text'), col('n', 'Pencairan', 'qty'), col('orders', 'Pesanan', 'qty'), col('expected', 'Seharusnya cair'), col('received', 'Diterima'), col('difference', 'Selisih')],
        rows: r.map((x) => ({ cells: { channel: x.channel, n: x.n, orders: x.orders, expected: money(D(x.expected)), received: money(D(x.received)), difference: money(D(x.difference)) } })),
        total: { channel: 'Jumlah', expected: money(r.reduce((s, x) => s.plus(x.expected), ZERO)), received: money(r.reduce((s, x) => s.plus(x.received), ZERO)), difference: money(r.reduce((s, x) => s.plus(x.difference), ZERO)) },
      });
    } else if (a.code === '1-1130') {
      const r = (await this.repo.cardSettlements(this.db, cx.tenantId, cx.from, cx.to)).rows;
      tables.push({
        key: 'card-settlements',
        title: 'Pencairan QRIS/kartu per metode',
        note: 'Bruto − MDR = seharusnya cair; selisih = diterima − seharusnya.',
        columns: [col('method', 'Metode', 'text'), col('n', 'Pencairan', 'qty'), col('gross', 'Bruto'), col('mdr', 'MDR'), col('received', 'Diterima'), col('difference', 'Selisih')],
        rows: r.map((x) => ({ cells: { method: x.method, n: x.n, gross: money(D(x.gross)), mdr: money(D(x.mdr)), received: money(D(x.received)), difference: money(D(x.difference)) } })),
        total: { method: 'Jumlah', gross: money(r.reduce((s, x) => s.plus(x.gross), ZERO)), mdr: money(r.reduce((s, x) => s.plus(x.mdr), ZERO)), received: money(r.reduce((s, x) => s.plus(x.received), ZERO)), difference: money(r.reduce((s, x) => s.plus(x.difference), ZERO)) },
      });
    } else if (a.systemKey === 'PRINCIPAL_CLAIM') {
      const r = (await this.repo.openPrincipalClaims(this.db, cx.tenantId, cx.to)).rows;
      const open = r.reduce((s, x) => s.plus(x.status === 'APPROVED' ? (x.approved ?? x.claimed) : 0), ZERO);
      tables.push({
        key: 'principal-claims',
        title: 'Klaim ke prinsipal yang belum dibayar',
        note: 'Hanya klaim berstatus disetujui yang sudah menjadi piutang di buku besar.',
        columns: [col('number', 'No. klaim', 'text'), col('supplier', 'Prinsipal', 'text'), col('period', 'Periode', 'text'), col('claimed', 'Diajukan'), col('approved', 'Disetujui'), col('status', 'Status', 'text')],
        rows: r.map((x) => ({ cells: { number: x.number, supplier: x.supplier, period: x.period, claimed: money(D(x.claimed)), approved: x.approved ? money(D(x.approved)) : null, status: x.status === 'APPROVED' ? 'Disetujui' : 'Diajukan' } })),
        total: { number: 'Piutang klaim disetujui', approved: money(open) },
      });
      if (open.minus(closing).abs().gte(TOL)) findings.push(`Klaim disetujui yang belum dibayar (Rp${rp(open)}) berbeda dari saldo akun (Rp${rp(closing)}); periksa jurnal klaim yang dicatat manual.`);
    } else if (a.systemKey === 'INTERBRANCH') {
      const r = (await this.repo.branchBalances(this.db, cx.tenantId, a.id, cx.to)).rows;
      const net = r.reduce((s, x) => s.plus(D(x.debit).minus(x.credit)), ZERO);
      tables.push({
        key: 'branch-balances',
        title: 'Saldo per cabang',
        note: 'Piutang (positif) di satu cabang dan utang (negatif) di cabang lain; gabungannya harus nol.',
        columns: [col('branch', 'Cabang', 'text'), col('debit', 'Debit'), col('credit', 'Kredit'), col('net', 'Saldo (piutang +, utang −)')],
        rows: r.map((x) => ({ cells: { branch: x.branch, debit: money(D(x.debit)), credit: money(D(x.credit)), net: money(D(x.debit).minus(x.credit)) } })),
        total: { branch: 'Gabungan', net: money(net) },
      });
      if (net.abs().gte(TOL)) findings.push(`Rekening antar cabang tidak nol saat digabung (Rp${rp(net)}): ada transaksi lintas cabang yang hanya tercatat di satu sisi.`);
    } else if (a.systemKey === 'UNBILLED_REVENUE') {
      const r = (await this.repo.projectContractAssets(this.db, cx.tenantId, cx.to)).rows;
      const rows: ScheduleRow[] = r.map((x) => ({ cells: { code: x.code, name: x.name, contract: money(D(x.contract)), percent: D(x.percent).toFixed(1), earned: money(D(x.earned)), billed: money(D(x.billed)), accrual: money(D(x.accrual)) }, muted: D(x.accrual).isZero() }));
      const total = r.reduce((s, x) => s.plus(x.accrual), ZERO);
      tables.push({
        key: 'contract-assets',
        title: 'Aset kontrak per proyek (kemajuan terakhir)',
        note: 'Akrual setelah kemajuan terakhir sampai akhir periode: pendapatan diakui kumulatif dikurangi ditagih kumulatif.',
        columns: [col('code', 'Proyek', 'text'), col('name', 'Nama', 'text'), col('contract', 'Nilai kontrak'), col('percent', 'Kemajuan (%)', 'percent'), col('earned', 'Diakui kumulatif'), col('billed', 'Ditagih kumulatif'), col('accrual', 'Aset kontrak')],
        rows,
        total: { code: 'Jumlah', accrual: money(total) },
      });
      if (total.minus(closing).abs().gte(TOL)) findings.push(`Aset kontrak menurut kemajuan proyek (Rp${rp(total)}) berbeda dari saldo akun (Rp${rp(closing)}).`);
    }
    return { tables, findings };
  }
}

const OTHER_LIABILITY_GROUPS: JournalItemProfile['groups'] = ['OTHER_PAYABLE', 'OTHER_NONCURRENT_LIABILITY'];

/** Utang lain-lain: titipan, retensi, poin loyalitas, dan liabilitas non-faktur lainnya */
@Injectable()
export class OtherLiabilitySchedule extends AgedBalanceSchedule {
  readonly kind = 'OTHER_LIABILITY';
  protected profile = profile({
    title: 'Utang lain-lain',
    groups: OTHER_LIABILITY_GROUPS,
    increases: 'credit',
    add: 'Penambahan',
    sub: 'Pembayaran / penyelesaian',
    basis: 'Liabilitas non-faktur diakui saat kewajiban timbul dan dihentikan saat dibayar atau gugur.',
    formulas: ['Saldo akhir = saldo awal + penambahan − pembayaran/penyelesaian', 'Umur saldo: pembayaran melunasi penambahan tertua lebih dulu (FIFO)'],
    policies: ['Saldo lama yang tidak bergerak dinilai apakah kewajibannya masih ada.'],
  });

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository) {
    super(db, repo);
  }

  protected noun(a: AccountMeta) {
    return a.name.toLowerCase();
  }

  protected profileFor(a: AccountMeta): JournalItemProfile {
    if (a.systemKey === 'LOYALTY_LIABILITY') {
      return profile({ title: 'Utang poin loyalitas pelanggan', increases: 'credit', add: 'Poin diberikan', sub: 'Poin ditukar / kedaluwarsa', basis: 'Poin yang diberikan kepada pelanggan menunda sebagian pendapatan sebagai liabilitas kontrak sebesar nilai poin yang diperkirakan ditukar.', formulas: ['Liabilitas = poin beredar × nilai tukar per poin', 'Saldo akhir = saldo awal + poin diberikan − poin ditukar − poin kedaluwarsa'] });
    }
    if (a.code === '2-1760') {
      return profile({ title: 'Utang retensi proyek (ditahan)', increases: 'credit', add: 'Retensi ditahan', sub: 'Retensi dibayar', basis: 'Bagian pembayaran ke subkontraktor yang ditahan sampai masa pemeliharaan selesai diakui sebagai utang retensi.', formulas: ['Retensi = tagihan subkontraktor × persen retensi', 'Saldo = retensi ditahan − retensi dibayar'] });
    }
    return this.profile;
  }

  protected async subledger(cx: ScheduleContext, closing: Dec): Promise<Extras> {
    if (cx.account.systemKey !== 'LOYALTY_LIABILITY') return { tables: [], findings: [] };
    const [kinds, out] = await Promise.all([this.repo.loyaltyByKind(this.db, cx.tenantId, cx.from, cx.to), this.repo.loyaltyOutstanding(this.db, cx.tenantId, cx.to)]);
    const KIND: Record<string, string> = { EARN: 'Poin diberikan', REDEEM: 'Poin ditukar', EXPIRE: 'Poin kedaluwarsa', ADJUST: 'Penyesuaian', REVERSE: 'Pembalikan (retur)', REFUND: 'Pengembalian' };
    const o = out.rows[0];
    const value = D(o?.value ?? 0);
    const findings: string[] = [];
    if (value.minus(closing).abs().gte(TOL)) findings.push(`Nilai poin beredar menurut kartu poin (Rp${rp(value)}) berbeda dari saldo akun (Rp${rp(closing)}); periksa penilaian poin atau jurnal manual.`);
    return {
      tables: [
        {
          key: 'loyalty-movement',
          title: 'Gerakan poin tahun ini',
          columns: [col('kind', 'Jenis', 'text'), col('points', 'Poin', 'qty'), col('value', 'Nilai')],
          rows: kinds.rows.map((x) => ({ cells: { kind: KIND[x.kind] ?? x.kind, points: x.points, value: money(D(x.value)) } })),
        },
        {
          key: 'loyalty-outstanding',
          title: 'Poin beredar',
          note: 'Poin yang belum ditukar atau kedaluwarsa per akhir periode; nilainya dibandingkan dengan saldo akun.',
          columns: [col('label', 'Keterangan', 'text'), col('points', 'Poin', 'qty'), col('value', 'Nilai')],
          rows: [
            { cells: { label: 'Poin beredar', points: o?.points ?? '0', value: money(value) } },
            { cells: { label: 'Akan kedaluwarsa ≤ 90 hari', points: o?.expiring ?? '0', value: null } },
          ],
          total: { label: 'Saldo akun di buku besar', value: money(closing) },
        },
      ],
      findings,
    };
  }
}

/** Penyesuaian kurs piutang/utang/kas-bank valas: penilaian ulang akhir periode dan pembaliknya, dengan posisi valas per mata uang */
@Injectable()
export class FxRevaluationSchedule extends JournalItemSchedule {
  readonly kind = 'FX_REVALUATION';
  protected profile = profile({
    title: 'Penyesuaian kurs valas (belum terealisasi)',
    increases: 'debit',
    add: 'Penyesuaian kurs',
    sub: 'Pembalikan',
    basis: 'Saldo piutang, utang, dan kas/bank valas dinilai pada kurs penutup (PSAK 10 / IAS 21). Selisih dicatat di akun penyesuaian ini dan dibalik otomatis keesokan harinya agar selisih terealisasi dihitung dari nilai tercatat awal.',
    formulas: ['Selisih = saldo valas × kurs penutup − nilai tercatat', 'Laba/rugi kurs belum terealisasi = Σ selisih piutang + kas/bank − selisih utang', 'Saldo akun ini nol sesudah jurnal balik'],
    policies: ['Akun ini hanya bersaldo pada tanggal penilaian ulang sampai dibalik.'],
  });

  constructor(
    @InjectDb() db: DbOrTx,
    repo: AccountSchedulesRepository,
    private readonly fx: FxService,
  ) {
    super(db, repo);
  }

  supports(a: AccountMeta) {
    return a.systemKey === 'FX_REVAL_AR' || a.systemKey === 'FX_REVAL_AP' || a.systemKey === 'FX_REVAL_CASH';
  }

  protected profileFor(a: AccountMeta): JournalItemProfile {
    return a.type === 'LIABILITY' ? { ...this.profile, increases: 'credit', addLabel: 'Penyesuaian kurs (kredit)', subLabel: 'Pembalikan (debit)' } : this.profile;
  }

  protected async extras(cx: ScheduleContext, _lines: JournalLine[], _closing: Dec): Promise<Extras> {
    const exp = await this.fx.exposure(cx.tenantId, agingDate(cx.to));
    const rows: ScheduleRow[] = exp.byCurrency.map((c) => ({ cells: { currency: c.currency, rate: c.rate, receivable: c.receivable, payable: c.payable, bank: c.bank, net: c.net, unrealized: c.unrealized } }));
    const findings = exp.missingRates.length ? [`Kurs ${exp.missingRates.join(', ')} belum tersedia pada tanggal acuan; isi kurs penutup agar penilaian ulang dapat dicatat.`] : [];
    return {
      tables: [
        {
          key: 'fx-position',
          title: `Posisi valas per ${exp.asOf}`,
          note: 'Posisi bersih = piutang + saldo bank − utang dalam valas; selisih belum terealisasi bila dinilai pada kurs tersebut.',
          columns: [col('currency', 'Mata uang', 'text'), col('rate', 'Kurs', 'text'), col('receivable', 'Piutang (valas)'), col('payable', 'Utang (valas)'), col('bank', 'Saldo bank (valas)'), col('net', 'Posisi bersih (valas)'), col('unrealized', 'Selisih belum terealisasi (Rp)')],
          rows,
          total: { currency: 'Jumlah', unrealized: exp.unrealized },
        },
      ],
      findings,
    };
  }
}

/** Utang pajak (PB1/PBJT, pajak daerah, dan lainnya) dan pajak dibayar di muka di luar PPN/PPh: pemungutan dan penyetoran, dengan setoran per jenis */
@Injectable()
export class OtherTaxSchedule extends JournalItemSchedule {
  readonly kind = 'OTHER_TAX';
  protected profile = profile({
    title: 'Utang pajak lainnya',
    groups: ['TAX_PAYABLE', 'PREPAID_TAX'],
    increases: 'credit',
    add: 'Pajak dipungut / terutang',
    sub: 'Pajak disetor / dikompensasi',
    basis: 'Pajak yang dipungut dari pelanggan atau terutang diakui sebagai liabilitas sampai disetor ke kas negara/daerah.',
    formulas: ['Saldo akhir = saldo awal + pajak dipungut − pajak disetor', 'Kurang bayar = saldo kredit; lebih bayar = saldo debit'],
    policies: ['Setoran dicatat lewat menu Pajak dan dicocokkan dengan bukti penerimaan (NTPN/kode billing).'],
  });

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository) {
    super(db, repo);
  }

  protected profileFor(a: AccountMeta): JournalItemProfile {
    return a.type === 'ASSET'
      ? profile({ title: 'Pajak dibayar di muka', increases: 'debit', add: 'Pajak dibayar di muka', sub: 'Dikompensasi / diperhitungkan', basis: 'Pajak yang dibayar atau dipotong pihak lain lebih dulu diakui sebagai aset dan diperhitungkan terhadap pajak terutang.', formulas: ['Saldo akhir = saldo awal + pajak dibayar di muka − dikompensasi'] })
      : this.profile;
  }

  protected async extras(cx: ScheduleContext, _lines: JournalLine[], _closing: Dec): Promise<Extras> {
    const r = (await this.repo.taxPaymentsByType(this.db, cx.tenantId, cx.from, cx.to)).rows;
    return {
      tables: [
        {
          key: 'tax-payments',
          title: 'Setoran pajak tahun ini menurut jenis (semua akun pajak)',
          note: 'Dari menu Pajak › Setoran; dibandingkan dengan pengurangan saldo di buku besar.',
          columns: [col('type', 'Jenis pajak', 'text'), col('n', 'Setoran', 'qty'), col('amount', 'Jumlah')],
          rows: r.map((x) => ({ cells: { type: x.type, n: x.n, amount: money(D(x.amount)) } })),
          total: { type: 'Jumlah', amount: money(r.reduce((s, x) => s.plus(x.amount), ZERO)) },
        },
      ],
      findings: [],
    };
  }
}

/** Pajak tangguhan (aset dan liabilitas): perubahan saldo dan dasar perhitungannya dari beda temporer */
@Injectable()
export class DeferredTaxSchedule extends JournalItemSchedule {
  readonly kind = 'DEFERRED_TAX';
  protected profile = profile({
    title: 'Pajak tangguhan',
    groups: ['DEFERRED_TAX_ASSET', 'DEFERRED_TAX_LIABILITY'],
    increases: 'debit',
    add: 'Aset pajak tangguhan diakui',
    sub: 'Dipulihkan / dihapus',
    basis: 'Pajak tangguhan diakui atas beda temporer antara dasar akuntansi dan dasar pajak, dengan tarif yang berlaku saat pemulihan (PSAK 46 / SAK EP bab pajak penghasilan).',
    formulas: ['Pajak tangguhan = beda temporer × tarif pajak', 'Aset pajak tangguhan bila beda temporer dapat dikurangkan; liabilitas bila kena pajak', 'Saldo akhir = saldo awal ± beban (manfaat) pajak tangguhan tahun ini'],
    policies: ['Aset pajak tangguhan diakui bila besar kemungkinan tersedia laba kena pajak masa depan.'],
  });

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository) {
    super(db, repo);
  }

  protected profileFor(a: AccountMeta): JournalItemProfile {
    return a.type === 'LIABILITY'
      ? profile({ title: 'Liabilitas pajak tangguhan', increases: 'credit', add: 'Liabilitas pajak tangguhan diakui', sub: 'Dipulihkan', basis: this.profile.method.basis, formulas: this.profile.method.formulas, policies: this.profile.method.policies })
      : this.profile;
  }
}

/** Liabilitas imbalan kerja (pesangon, penghargaan masa kerja): akrual dan pembayaran per jurnal */
@Injectable()
export class EmployeeBenefitSchedule extends JournalItemSchedule {
  readonly kind = 'EMPLOYEE_BENEFIT';
  protected profile = profile({
    title: 'Liabilitas imbalan kerja',
    groups: ['EMPLOYEE_BENEFIT'],
    increases: 'credit',
    add: 'Beban imbalan diakru',
    sub: 'Pembayaran imbalan',
    basis: 'Imbalan pascakerja dan imbalan kerja jangka panjang diakui selama masa kerja karyawan (PSAK 24 / SAK EP bab imbalan kerja).',
    formulas: ['Liabilitas = nilai kini imbalan yang telah menjadi hak karyawan', 'Saldo akhir = saldo awal + beban imbalan − pembayaran', 'Beban imbalan = biaya jasa kini + bunga atas liabilitas'],
    policies: ['Perhitungan aktuaria dilakukan berkala; di antara penilaian, akrual memakai estimasi manajemen.'],
  });

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository) {
    super(db, repo);
  }
}

/** Persediaan di luar kartu stok utama: dalam perjalanan, barang dalam proses, setengah jadi */
@Injectable()
export class InventoryOtherSchedule extends JournalItemSchedule {
  readonly kind = 'INVENTORY_OTHER';
  protected profile = profile({
    title: 'Persediaan lain (dalam perjalanan, proses, setengah jadi)',
    groups: ['INVENTORY'],
    increases: 'debit',
    add: 'Penambahan persediaan',
    sub: 'Pengurangan / penyelesaian',
    basis: 'Persediaan dalam perjalanan, barang dalam proses, dan barang setengah jadi dinilai pada biaya yang telah dikeluarkan sampai selesai/diterima.',
    formulas: ['Saldo akhir = saldo awal + penambahan − dipindah ke persediaan jadi/diterima', 'Barang dalam proses = bahan + tenaga kerja + overhead yang telah dibebankan ke perintah produksi berjalan'],
  });

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository) {
    super(db, repo);
  }

  supports(a: AccountMeta) {
    return a.reportGroup === 'INVENTORY' && a.systemKey !== 'INVENTORY';
  }

  protected profileFor(a: AccountMeta): JournalItemProfile {
    if (a.systemKey === 'WIP') return profile({ title: 'Barang dalam proses produksi', increases: 'debit', add: 'Biaya masuk proses (bahan, tenaga kerja, overhead)', sub: 'Dipindah ke barang jadi', basis: 'Biaya produksi dikumpulkan per perintah produksi sampai selesai, lalu dipindah ke persediaan barang jadi.', formulas: ['Saldo = Σ biaya perintah produksi yang masih berjalan', 'Biaya per perintah = bahan terpakai + tenaga kerja + overhead'] });
    if (a.systemKey === 'INVENTORY_SEMI') return profile({ title: 'Persediaan barang setengah jadi', increases: 'debit', add: 'Barang setengah jadi dihasilkan', sub: 'Dipakai produksi lanjutan / dijual', basis: 'Barang setengah jadi dinilai pada biaya produksi sampai tahap itu dengan biaya rata-rata tertimbang.', formulas: ['Saldo akhir = saldo awal + hasil produksi tahap − pemakaian'] });
    return profile({ title: 'Persediaan dalam perjalanan', increases: 'debit', add: 'Barang dikirim antar gudang / pembelian dalam perjalanan', sub: 'Barang diterima di gudang tujuan', basis: 'Barang yang sudah keluar dari gudang asal tetapi belum diterima gudang tujuan dicatat sebagai persediaan dalam perjalanan.', formulas: ['Saldo = nilai transfer berstatus dalam perjalanan', 'Saldo akhir = saldo awal + dikirim − diterima'] });
  }

  protected async extras(cx: ScheduleContext, _lines: JournalLine[], closing: Dec): Promise<Extras> {
    const a = cx.account;
    if (a.systemKey === 'WIP') {
      const r = (await this.repo.productionInProgress(this.db, cx.tenantId)).rows;
      const total = r.reduce((s, x) => s.plus(x.material).plus(x.labor).plus(x.overhead), ZERO);
      return {
        tables: [
          {
            key: 'wip-orders',
            title: 'Perintah produksi yang masih berjalan',
            note: 'Biaya yang tercatat pada perintah produksi sampai saat ini.',
            columns: [col('number', 'No. perintah', 'text'), col('product', 'Produk', 'text'), col('started', 'Mulai', 'date'), col('planned', 'Rencana', 'qty'), col('material', 'Bahan'), col('labor', 'Tenaga kerja'), col('overhead', 'Overhead')],
            rows: r.map((x) => ({ cells: { number: x.number, product: x.product, started: x.started, planned: x.planned, material: money(D(x.material)), labor: money(D(x.labor)), overhead: money(D(x.overhead)) } })),
            total: { number: 'Jumlah biaya', material: money(total) },
          },
        ],
        findings: closing.gt(0.5) && !r.length ? ['Ada saldo barang dalam proses tetapi tidak ada perintah produksi yang sedang berjalan; periksa perintah yang belum diselesaikan atau jurnal manual.'] : [],
      };
    }
    if (a.reportGroup === 'INVENTORY' && !a.systemKey) {
      const r = (await this.repo.transfersInTransit(this.db, cx.tenantId, cx.to)).rows;
      const total = r.reduce((s, x) => s.plus(x.value), ZERO);
      return {
        tables: [
          {
            key: 'transit',
            title: 'Transfer antar gudang yang masih dalam perjalanan',
            columns: [col('number', 'No. transfer', 'text'), col('date', 'Tanggal', 'date'), col('from', 'Dari', 'text'), col('to', 'Ke', 'text'), col('value', 'Nilai')],
            rows: r.map((x) => ({ cells: { number: x.number, date: x.date, from: x.from_wh, to: x.to_wh, value: money(D(x.value)) } })),
            total: { number: 'Jumlah', value: money(total) },
          },
        ],
        findings: total.minus(closing).abs().gte(TOL) && closing.gt(0) ? [`Nilai transfer dalam perjalanan (Rp${rp(total)}) berbeda dari saldo akun (Rp${rp(closing)}).`] : [],
      };
    }
    return { tables: [], findings: [] };
  }
}

/** Cadangan kerugian piutang: perubahan cadangan (pembentukan, penghapusan) dan rasio terhadap piutang usaha */
@Injectable()
export class AllowanceSchedule extends JournalItemSchedule {
  readonly kind = 'ALLOWANCE';
  protected profile = profile({
    title: 'Cadangan kerugian piutang',
    groups: ['ALLOWANCE_RECEIVABLE'],
    increases: 'credit',
    add: 'Pembentukan cadangan',
    sub: 'Penghapusan piutang / pemulihan',
    basis: 'Piutang dinilai atas kemungkinan tidak tertagih; cadangan dibentuk sebesar kerugian kredit yang diperkirakan dan dikurangkan dari piutang.',
    formulas: ['Cadangan akhir = cadangan awal + beban kerugian piutang − piutang dihapus', 'Cakupan cadangan = cadangan ÷ piutang usaha'],
    policies: ['Piutang dihapus (write-off) mengurangi cadangan dan piutang usaha sekaligus tanpa mempengaruhi laba.'],
  });

  constructor(@InjectDb() db: DbOrTx, repo: AccountSchedulesRepository) {
    super(db, repo);
  }

  protected extras(cx: ScheduleContext, _lines: JournalLine[], closing: Dec): Promise<Extras> {
    const ar = cx.accounts.filter((a) => a.systemKey === 'AR');
    const gross = ar.reduce((s, a) => {
      const m = cx.movementOf(a.id);
      return s.plus(openingOf(a, m)).plus(m.months.reduce((x, mm) => x.plus(netOf(a.type, mm.debit, mm.credit)), ZERO));
    }, ZERO);
    const pct = gross.gt(0) ? closing.div(gross).times(100) : null;
    return Promise.resolve({
      tables: [
        {
          key: 'allowance-coverage',
          title: 'Cakupan cadangan terhadap piutang usaha',
          note: 'Piutang usaha dari akun piutang di buku besar per akhir periode.',
          columns: [col('label', 'Keterangan', 'text'), col('amount', 'Jumlah')],
          rows: [
            { cells: { label: 'Piutang usaha (bruto)', amount: money(gross) } },
            { cells: { label: 'Cadangan kerugian piutang', amount: money(closing) } },
            { cells: { label: 'Piutang neto', amount: money(gross.minus(closing)) } },
            { cells: { label: 'Cakupan cadangan (%)', amount: pct ? pct.toFixed(2) : '0.00' } },
          ],
        },
      ],
      findings: gross.gt(0) && closing.lte(0) ? ['Ada piutang usaha tetapi belum ada cadangan kerugian; nilai apakah ada piutang yang kemungkinan tidak tertagih.'] : [],
    });
  }
}

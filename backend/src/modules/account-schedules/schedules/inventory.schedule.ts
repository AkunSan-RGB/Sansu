import { Injectable } from '@nestjs/common';
import { D, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import type { AccountMeta } from '../../accounting/ledger-data';
import { AccountSchedulesRepository } from '../account-schedules.repository';
import { col, money, movementTable, netOf, openingOf } from '../account-schedule.support';
import type { AccountSchedule, ScheduleBody, ScheduleContext, ScheduleRow } from '../account-schedule.types';

const KEYS = ['INVENTORY', 'INVENTORY_SEMI'];

/** Kartu persediaan per produk (jumlah dan nilai), dicocokkan dengan seluruh akun persediaan di buku besar */
@Injectable()
export class InventorySchedule implements AccountSchedule {
  readonly kind = 'INVENTORY';

  constructor(
    @InjectDb() private readonly db: DbOrTx,
    private readonly repo: AccountSchedulesRepository,
  ) {}

  supports(a: AccountMeta) {
    return a.systemKey === 'INVENTORY';
  }

  async build(cx: ScheduleContext): Promise<ScheduleBody> {
    const raw = (await this.repo.stockMovementsByProduct(this.db, cx.tenantId, cx.from, cx.to)).rows;
    const t = { q0: ZERO, qin: ZERO, qout: ZERO, q1: ZERO, v0: ZERO, vin: ZERO, vout: ZERO, v1: ZERO };
    const qty: ScheduleRow[] = [];
    const val: ScheduleRow[] = [];
    for (const r of raw) {
      const n = { q0: D(r.q0), qin: D(r.qin), qout: D(r.qout), q1: D(r.q1), v0: D(r.v0), vin: D(r.vin), vout: D(r.vout), v1: D(r.v1) };
      (Object.keys(t) as (keyof typeof t)[]).forEach((k) => (t[k] = t[k].plus(n[k])));
      qty.push({ cells: { sku: r.sku, name: r.name, uom: r.uom, q0: n.q0.toFixed(4), qin: n.qin.toFixed(4), qout: n.qout.toFixed(4), q1: n.q1.toFixed(4) } });
      val.push({ cells: { sku: r.sku, name: r.name, v0: money(n.v0), vin: money(n.vin), vout: money(n.vout), v1: money(n.v1) } });
    }
    const gl = movementTable(cx.account, cx.movement, cx.year, { add: 'Masuk (debit)', sub: 'Keluar (kredit)' }, 'Pembanding: mutasi buku besar per bulan');
    const peers = cx.accounts.filter((a) => a.systemKey && KEYS.includes(a.systemKey));
    const peerClosing = peers.reduce((s, a) => {
      const m = cx.movementOf(a.id);
      return s.plus(openingOf(a, m)).plus(m.months.reduce((x, mm) => x.plus(netOf(a.type, mm.debit, mm.credit)), ZERO));
    }, ZERO);
    const other = peerClosing.minus(t.v1);
    const findings: string[] = [];
    if (other.abs().gte(0.5)) {
      findings.push(`Nilai kartu stok (${money(t.v1)}) berbeda dari saldo akun persediaan di buku besar (${money(peerClosing)}): selisih ${money(other)}. Biasanya dari persediaan awal lewat jurnal, jurnal manual ke akun persediaan, atau pembulatan biaya.`);
    }
    const wh = (await this.repo.stockByWarehouse(this.db, cx.tenantId, cx.to)).rows;
    const whTable = {
      key: 'inventory-warehouse',
      title: 'Persediaan per gudang',
      note: 'Jumlah dan nilai persediaan per gudang pada akhir periode.',
      columns: [col('code', 'Gudang', 'text'), col('name', 'Nama', 'text'), col('products', 'Jenis produk', 'qty'), col('qty', 'Jumlah', 'qty'), col('value', 'Nilai')],
      rows: wh.map((x) => ({ cells: { code: x.code, name: x.name, products: x.products, qty: D(x.qty).toFixed(4), value: money(D(x.value)) } })),
      total: { code: 'Jumlah', value: money(wh.reduce((s, x) => s.plus(x.value), ZERO)) },
    };
    const qtyTable = {
      key: 'inventory-qty',
      title: 'Kartu persediaan per produk: jumlah',
      note: 'Jumlah dalam satuan dasar produk.',
      columns: [col('sku', 'SKU', 'text'), col('name', 'Produk', 'text'), col('uom', 'Satuan', 'text'), col('q0', 'Saldo awal', 'qty'), col('qin', 'Masuk', 'qty'), col('qout', 'Keluar', 'qty'), col('q1', 'Saldo akhir', 'qty')],
      rows: qty,
      total: { sku: 'Jumlah', q0: t.q0.toFixed(4), qin: t.qin.toFixed(4), qout: t.qout.toFixed(4), q1: t.q1.toFixed(4) },
    };
    const valTable = {
      key: 'inventory-value',
      title: 'Kartu persediaan per produk: nilai',
      note: 'Nilai = jumlah × biaya rata-rata tertimbang pada setiap mutasi.',
      columns: [col('sku', 'SKU', 'text'), col('name', 'Produk', 'text'), col('v0', 'Nilai awal'), col('vin', 'Nilai masuk'), col('vout', 'Nilai keluar'), col('v1', 'Nilai akhir')],
      rows: val,
      total: { sku: 'Jumlah', v0: money(t.v0), vin: money(t.vin), vout: money(t.vout), v1: money(t.v1) },
    };
    return {
      title: 'Persediaan',
      method: {
        basis: 'Persediaan dinilai pada biaya perolehan atau nilai realisasi neto, mana yang lebih rendah, dengan biaya rata-rata tertimbang.',
        formulas: ['Saldo akhir = saldo awal + masuk − keluar', 'Biaya rata-rata baru = (nilai persediaan lama + nilai penerimaan) ÷ (jumlah lama + jumlah diterima)', 'Penurunan nilai dibukukan bila nilai realisasi neto lebih rendah dari biaya'],
      },
      tables: [qtyTable, valTable, whTable, gl.table],
      closing: gl.closing,
      findings,
    };
  }
}

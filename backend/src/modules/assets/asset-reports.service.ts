import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type FiscalAssetGroup } from '@sansu/shared';
import { and, eq, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { SettingsService } from '../../common/settings.service';
import { addDays, diffDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { fixedAssets } from '../../db/schema';
import { depreciationFor, fiscalDepreciation, monthIndex, periodOf } from './depreciation';
import { AssetsService } from './assets.service';

@Injectable()
export class AssetReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
    private readonly assets: AssetsService,
  ) {}


  async reconciliation(tenantId: string, asOf?: string) {
    const date = toDocDate(asOf);
    const assets = (await this.assets.list(tenantId, date)).filter((a) => a.acquisitionDate <= date);
    const cats = await this.assets.listCategories(tenantId);
    type Acc = { id: string; code: string; name: string };
    const accs = new Map<string, { acc: Acc; kind: 'COST' | 'ACCUMULATED'; register: Dec }>();
    const bump = (acc: Acc | null | undefined, kind: 'COST' | 'ACCUMULATED', v: Dec) => {
      if (!acc) return;
      const k = `${kind}:${acc.id}`;
      const cur = accs.get(k) ?? { acc, kind, register: ZERO };
      cur.register = cur.register.plus(v);
      accs.set(k, cur);
    };
    for (const c of cats) {
      bump(c.assetAccount, 'COST', ZERO);
      bump(c.accumulatedAccount, 'ACCUMULATED', ZERO);
    }
    const catById = new Map(cats.map((c) => [c.id, c]));
    for (const a of assets) {
      const c = catById.get(a.categoryId);
      if (!c) continue;
      bump(c.assetAccount, 'COST', D(a.status === 'DISPOSED' && a.disposalDate && a.disposalDate <= date ? 0 : a.cost));
      bump(c.accumulatedAccount, 'ACCUMULATED', D(a.accumulated));
    }
    const ids = [...new Set([...accs.values()].map((x) => x.acc.id))];
    const gl = new Map<string, { debit: Dec; credit: Dec }>();
    if (ids.length) {
      const res = await this.db.execute<{ account_id: string; debit: string; credit: string }>(sql`
        SELECT l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} AND j.date <= ${date} AND l.account_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        GROUP BY l.account_id`);
      for (const r of res.rows) gl.set(r.account_id, { debit: D(r.debit), credit: D(r.credit) });
    }
    const rows = [...accs.values()].map((x) => {
      const g = gl.get(x.acc.id) ?? { debit: ZERO, credit: ZERO };
      const ledger = x.kind === 'COST' ? g.debit.minus(g.credit) : g.credit.minus(g.debit);
      const diff = ledger.minus(x.register);
      return { accountId: x.acc.id, code: x.acc.code, name: x.acc.name, kind: x.kind, register: x.register.toFixed(2), ledger: ledger.toFixed(2), diff: diff.toFixed(2) };
    });
    return { asOf: date, rows, mismatched: rows.filter((r) => D(r.diff).abs().gte(1)).length };
  }


  /**
   * Temuan kontrol aset tetap: penyusutan tertinggal, aset habis disusutkan tetapi masih aktif, aset tanpa penanggung jawab/lokasi,
   * aset yang belum diperiksa fisik >12 bulan, serta aset yang dilaporkan hilang/rusak.
   */
  async controls(tenantId: string) {
    const today = todayJakarta();
    const prev = periodOf(monthIndex(today.slice(0, 7)) - 1);
    const active = (await this.assets.list(tenantId, today)).filter((a) => a.status === 'ACTIVE');
    const posted = await this.assets.postedTotals(this.db, tenantId, '9999-12');
    type Finding = { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; assetIds: string[] };
    const out: Finding[] = [];
    const add = (key: string, level: Finding['level'], title: string, ids: string[], detail: string) => {
      if (ids.length) out.push({ key, level, title: `${title} (${ids.length})`, detail, assetIds: ids });
    };
    const names = (list: { code: string; name: string }[]) => list.slice(0, 5).map((a) => `${a.code} ${a.name}`).join(', ') + (list.length > 5 ? `, dan ${list.length - 5} lainnya` : '');

    const behind = active.filter((a) => {
      if (a.method === 'NONE' || a.usefulLifeMonths <= 0) return false;
      const acc = D(a.openingAccumulated).plus(posted.get(a.id)?.total ?? ZERO);
      const last = posted.get(a.id)?.last;
      const from = Math.max(monthIndex(a.depreciationStart.slice(0, 7)), last ? monthIndex(last) + 1 : 0);
      return from <= monthIndex(prev) && !depreciationFor(a, acc, periodOf(from)).isZero();
    });
    add('DEP_BEHIND', 'warning', 'Penyusutan belum dijalankan sampai bulan lalu', behind.map((a) => a.id), `Jalankan penyusutan sampai ${prev}. ${names(behind)}`);

    const full = active.filter((a) => a.method !== 'NONE' && D(a.accumulated).gte(D(a.cost).minus(D(a.residualValue))) && D(a.cost).gt(0));
    add('FULLY_DEPRECIATED', 'info', 'Aset sudah habis disusutkan tetapi masih aktif', full.map((a) => a.id), `Jika sudah tidak dipakai, lepaskan agar daftar aset bersih. ${names(full)}`);

    const missing = active.filter((a) => a.verificationStatus === 'MISSING');
    add('MISSING', 'error', 'Aset dilaporkan tidak ditemukan', missing.map((a) => a.id), `Telusuri, lalu lepaskan sebagai rugi bila memang hilang. ${names(missing)}`);
    const damaged = active.filter((a) => a.verificationStatus === 'DAMAGED');
    add('DAMAGED', 'warning', 'Aset dilaporkan rusak', damaged.map((a) => a.id), `Pertimbangkan perbaikan atau pelepasan. ${names(damaged)}`);

    const noCustodian = active.filter((a) => !a.custodian?.trim());
    add('NO_CUSTODIAN', 'warning', 'Aset belum punya penanggung jawab', noCustodian.map((a) => a.id), names(noCustodian));
    const noLocation = active.filter((a) => !a.location?.trim());
    add('NO_LOCATION', 'info', 'Aset belum punya lokasi', noLocation.map((a) => a.id), names(noLocation));

    const cutoff = Date.now() - 365 * 86_400_000;
    const stale = active.filter((a) => a.category.fiscalGroup !== 'LAND' && (!a.lastVerifiedAt || new Date(a.lastVerifiedAt).getTime() < cutoff));
    add('NOT_VERIFIED', 'info', 'Aset belum diperiksa fisik dalam 12 bulan', stale.map((a) => a.id), `Lakukan pemeriksaan fisik berkala. ${names(stale)}`);

    const noUsage = active.filter((a) => a.method === 'UNITS_OF_PRODUCTION' && (a as { units?: { byPeriod: Record<string, number> } }).units?.byPeriod[prev] === undefined && a.depreciationStart.slice(0, 7) <= prev);
    add('USAGE_MISSING', 'warning', 'Pemakaian bulan lalu belum diisi (metode unit produksi)', noUsage.map((a) => a.id), `Tanpa catatan pemakaian, penyusutan bulan ${prev} tidak terhitung. ${names(noUsage)}`);

    // Pembelian peralatan kecil yang dibebankan karena di bawah batas kapitalisasi tetapi berulang tepat di bawah batas pada pemasok yang sama
    const { capitalizationThreshold: threshold } = await this.settings.reporting(this.db, tenantId);
    if (threshold > 0) {
      const small = await this.db.execute<{ supplier: string; n: number; total: string; first: string; last: string }>(sql`
        WITH lines AS (
          SELECT s.name AS supplier, j.date, l.debit
          FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
          JOIN purchase_invoices i ON i.id::text = j.source_id AND j.source_type = 'PURCHASE_INVOICE' JOIN suppliers s ON s.id = i.supplier_id
          WHERE j.tenant_id = ${tenantId} AND a.system_key = 'SMALL_ASSET_EXPENSE' AND l.debit >= ${threshold * 0.7} AND l.debit < ${threshold}
            AND j.date >= ${addDays(today, -60)}
        )
        SELECT a.supplier, COUNT(*)::int AS n, SUM(a.debit)::text AS total, MIN(a.date)::text AS first, MAX(a.date)::text AS last
        FROM lines a JOIN lines b ON b.supplier = a.supplier AND b.date BETWEEN a.date - 14 AND a.date + 14
        GROUP BY a.supplier HAVING COUNT(DISTINCT (a.date, a.debit)) >= 2 AND SUM(a.debit) >= ${threshold}`);
      out.push(...(small.rows.length ? [{ key: 'ASSET_SPLIT', level: 'warning' as const, title: `Pembelian di bawah batas kapitalisasi berulang pada pemasok yang sama (${small.rows.length})`, detail: `Beberapa barang masing-masing ≥ 70% dari batas Rp${threshold.toLocaleString('id-ID')} tetapi di bawahnya, dibeli dari pemasok yang sama dalam 14 hari dan dibebankan, bukan dicatat sebagai aset. Bisa wajar (banyak barang kecil) atau pembelian aset yang dipecah agar langsung menjadi beban.`, assetIds: small.rows.map((r) => `${r.supplier}: ${r.n} baris, total Rp${Math.round(Number(r.total)).toLocaleString('id-ID')} (${r.first} s/d ${r.last})`) }] : []));
    }

    // Pelepasan 180 hari terakhir: segera setelah dibeli, atau harga lepas jauh di bawah nilai buku
    const disposed = await this.db.execute<{ code: string; name: string; acq: string; disp: string; cost: string; opening: string; dep: string; price: string }>(sql`
      SELECT f.code, f.name, f.acquisition_date::text AS acq, f.disposal_date::text AS disp, f.cost::text AS cost, f.opening_accumulated::text AS opening, f.disposal_price::text AS price,
        COALESCE((SELECT SUM(d.amount) FROM asset_depreciations d WHERE d.asset_id = f.id), 0)::text AS dep
      FROM fixed_assets f WHERE f.tenant_id = ${tenantId} AND f.status = 'DISPOSED' AND f.disposal_date >= ${addDays(today, -180)}
      ORDER BY f.disposal_date DESC`);
    const quick = disposed.rows.filter((r) => diffDays(r.acq, r.disp) <= 90);
    out.push(...(quick.length ? [{ key: 'DISPOSE_QUICK', level: 'warning' as const, title: `Aset dilepas ≤ 90 hari setelah dibeli (${quick.length})`, detail: 'Aset baru dibeli lalu cepat dilepas bisa berarti pembelian fiktif atau barang dialihkan. Periksa dokumen pembelian dan pembelinya.', assetIds: quick.map((r) => `${r.code} ${r.name} (beli ${r.acq}, lepas ${r.disp})`) }] : []));
    const low = disposed.rows.filter((r) => {
      const book = D(r.cost).minus(r.opening).minus(r.dep).toNumber();
      return book >= 1_000_000 && Number(r.price) < book * 0.5;
    });
    out.push(...(low.length ? [{ key: 'DISPOSE_LOW_PRICE', level: 'warning' as const, title: `Aset dilepas jauh di bawah nilai buku (${low.length})`, detail: 'Harga lepas kurang dari separuh nilai buku (atau nol). Pastikan ada alasan (rusak/hilang), bukti, dan pembelinya bukan pihak terkait.', assetIds: low.map((r) => `${r.code} ${r.name} harga Rp${Math.round(Number(r.price)).toLocaleString('id-ID')}`) }] : []));

    const pol = await this.approvals.policy(this.db, tenantId);
    const setup = {
      active: pol.assetDisposal > 0,
      message: 'Batas persetujuan pelepasan aset masih 0 (mati): aset berapa pun nilainya bisa dilepas oleh staf tanpa persetujuan Pemilik/Admin.',
      recommended: { assetDisposal: 5_000_000 },
      recommendedText: 'pelepasan aset ≥ Rp5 juta butuh persetujuan',
    };
    return { generatedAt: new Date().toISOString(), count: out.length, items: out, setup };
  }


  /** Pratinjau 12 bulan: penyusutan per bulan dengan metode sekarang vs metode baru (tanpa menyimpan apa pun) */
  async methodPreview(tenantId: string, id: string, method: string, effectiveMonth?: string) {
    const a = await this.db.query.fixedAssets.findFirst({ where: and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId)) });
    if (!a) throw new NotFoundException('Aset tidak ditemukan');
    if (a.status !== 'ACTIVE' || a.method === 'NONE') throw new BadRequestException('Aset ini tidak disusutkan atau sudah dilepas');
    if (a.method === 'UNITS_OF_PRODUCTION' || method === 'UNITS_OF_PRODUCTION') throw new BadRequestException('Pratinjau tidak tersedia untuk metode unit produksi: penyusutannya mengikuti pemakaian.');
    const effective = effectiveMonth ?? todayJakarta().slice(0, 7);
    const posted = (await this.assets.postedTotals(this.db, tenantId, '9999-12')).get(a.id);
    let acc = D(a.openingAccumulated).plus(posted?.total ?? ZERO);
    const from = Math.max(monthIndex(a.depreciationStart.slice(0, 7)), posted?.last ? monthIndex(posted.last) + 1 : 0);
    if (posted?.last && monthIndex(effective) <= monthIndex(posted.last)) throw new BadRequestException(`Penyusutan sudah diposting sampai ${posted.last}; bulan berlaku harus sesudahnya`);
    for (let i = from; i < monthIndex(effective); i++) acc = acc.plus(depreciationFor(a, acc, periodOf(i)));
    const proposed = { ...a, methodChanges: [...(a.methodChanges ?? []), { from: effective, method, prevMethod: a.method, accumulatedAt: acc.toFixed(2) }] };
    let accCur = acc;
    let accNew = acc;
    const rows: { period: string; current: string; proposed: string }[] = [];
    for (let i = monthIndex(effective); i < monthIndex(effective) + 12; i++) {
      const cur = depreciationFor(a, accCur, periodOf(i));
      const nw = depreciationFor(proposed, accNew, periodOf(i));
      accCur = accCur.plus(cur);
      accNew = accNew.plus(nw);
      rows.push({ period: periodOf(i), current: cur.toFixed(2), proposed: nw.toFixed(2) });
    }
    const sum = (k: 'current' | 'proposed') => rows.reduce((t, r) => t.plus(r[k]), ZERO).toFixed(2);
    return { effectiveMonth: effective, bookValueAtEffective: D(a.cost).minus(acc).toFixed(2), rows, total12: { current: sum('current'), proposed: sum('proposed') } };
  }


  /**
   * Mutasi aset tetap per kategori dalam satu tahun (tabel CALK):
   * saldo awal, penambahan, pengurangan, saldo akhir — untuk harga perolehan & akumulasi penyusutan.
   */
  async rollForward(tenantId: string, year: number) {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const assets = await this.db.query.fixedAssets.findMany({ where: eq(fixedAssets.tenantId, tenantId), with: { category: true } });
    const dep = await this.db.execute<{ asset_id: string; before: string; during: string }>(sql`
      SELECT asset_id,
             COALESCE(SUM(amount) FILTER (WHERE period < ${`${year}-01`}), 0) AS before,
             COALESCE(SUM(amount) FILTER (WHERE period BETWEEN ${`${year}-01`} AND ${`${year}-12`}), 0) AS during
      FROM asset_depreciations WHERE tenant_id = ${tenantId} GROUP BY asset_id`);
    const depBy = new Map(dep.rows.map((r) => [r.asset_id, r]));
    type Row = { category: string; costOpen: Dec; costAdd: Dec; costDisp: Dec; accOpen: Dec; accAdd: Dec; accDisp: Dec };
    const rows = new Map<string, Row>();
    for (const a of assets) {
      const r = rows.get(a.categoryId) ?? { category: a.category.name, costOpen: ZERO, costAdd: ZERO, costDisp: ZERO, accOpen: ZERO, accAdd: ZERO, accDisp: ZERO };
      const cost = D(a.cost);
      const d = depBy.get(a.id);
      const accBefore = D(a.openingAccumulated).plus(d?.before ?? 0);
      const accDuring = D(d?.during ?? 0);
      if (a.acquisitionDate < from) {
        if (!(a.disposalDate && a.disposalDate < from)) {
          r.costOpen = r.costOpen.plus(cost);
          r.accOpen = r.accOpen.plus(accBefore);
        }
      } else if (a.acquisitionDate <= to) {
        r.costAdd = r.costAdd.plus(cost);
        // akumulasi awal aset lama yang baru didaftarkan dianggap penambahan akumulasi
        r.accAdd = r.accAdd.plus(D(a.openingAccumulated));
      }
      r.accAdd = r.accAdd.plus(accDuring);
      if (a.disposalDate && a.disposalDate >= from && a.disposalDate <= to) {
        r.costDisp = r.costDisp.plus(cost);
        r.accDisp = r.accDisp.plus(accBefore.plus(accDuring));
      }
      rows.set(a.categoryId, r);
    }
    const f = (d: Dec) => d.toFixed(2);
    return [...rows.values()].map((r) => {
      const costClose = r.costOpen.plus(r.costAdd).minus(r.costDisp);
      const accClose = r.accOpen.plus(r.accAdd).minus(r.accDisp);
      return {
        category: r.category,
        cost: { opening: f(r.costOpen), additions: f(r.costAdd), disposals: f(r.costDisp), closing: f(costClose) },
        accumulated: { opening: f(r.accOpen), additions: f(r.accAdd), disposals: f(r.accDisp), closing: f(accClose) },
        bookValue: { opening: f(r.costOpen.minus(r.accOpen)), closing: f(costClose.minus(accClose)) },
      };
    });
  }


  /** Penyusutan komersial vs fiskal per aset untuk satu tahun (bahan koreksi fiskal & pajak tangguhan) */
  async fiscalComparison(tenantId: string, year: number) {
    const assets = await this.db.query.fixedAssets.findMany({ where: eq(fixedAssets.tenantId, tenantId), with: { category: true } });
    const dep = await this.db.execute<{ asset_id: string; during: string; upto: string }>(sql`
      SELECT asset_id,
             COALESCE(SUM(amount) FILTER (WHERE period BETWEEN ${`${year}-01`} AND ${`${year}-12`}), 0) AS during,
             COALESCE(SUM(amount) FILTER (WHERE period <= ${`${year}-12`}), 0) AS upto
      FROM asset_depreciations WHERE tenant_id = ${tenantId} GROUP BY asset_id`);
    const depBy = new Map(dep.rows.map((r) => [r.asset_id, r]));
    return assets
      .filter((a) => a.acquisitionDate <= `${year}-12-31` && !(a.disposalDate && a.disposalDate < `${year}-01-01`))
      .map((a) => {
        const fiscal = fiscalDepreciation(a.cost, a.acquisitionDate, a.category.fiscalGroup as FiscalAssetGroup, a.category.fiscalMethod, year, a.disposalDate);
        const commercial = D(depBy.get(a.id)?.during ?? 0);
        const disposed = !!(a.disposalDate && a.disposalDate <= `${year}-12-31`);
        const commercialAcc = D(a.openingAccumulated).plus(depBy.get(a.id)?.upto ?? 0);
        // Aset dilepas tahun ini: beda nilai buku komersial vs fiskal saat pelepasan = beda laba/rugi pelepasan
        const disposedThisYear = !!(a.disposalDate && a.disposalDate.startsWith(String(year)));
        const disposalDifference = disposedThisYear ? D(a.cost).minus(commercialAcc).minus(D(a.cost).minus(fiscal.accumulatedEnd)) : ZERO;
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          category: a.category.name,
          fiscalGroup: a.category.fiscalGroup,
          cost: a.cost,
          commercial: commercial.toFixed(2),
          fiscal: fiscal.amount.toFixed(2),
          difference: commercial.minus(fiscal.amount).toFixed(2),
          // Nilai buku akhir tahun (untuk pajak tangguhan); aset yang sudah dilepas = 0
          commercialBookValue: disposed ? '0.00' : D(a.cost).minus(commercialAcc).toFixed(2),
          fiscalBookValue: disposed ? '0.00' : D(a.cost).minus(fiscal.accumulatedEnd).toFixed(2),
          /** + = laba fiskal pelepasan lebih besar (koreksi positif) */
          disposalDifference: disposalDifference.toFixed(2),
        };
      });
  }


  /** Total register (untuk cek kesehatan: buku besar vs daftar aset) */
  async registerTotals(tenantId: string, asOf: string) {
    const list = await this.assets.list(tenantId, asOf);
    const active = list.filter((a) => a.acquisitionDate <= asOf && !(a.status === 'DISPOSED' && a.disposalDate && a.disposalDate <= asOf));
    return {
      cost: active.reduce<Dec>((s, a) => s.plus(a.cost), ZERO),
      accumulated: active.reduce<Dec>((s, a) => s.plus(a.accumulated), ZERO),
      count: active.length,
      pendingPeriods: active.filter((a) => a.method !== 'NONE' && !D(a.monthlyEstimate).isZero() && (!a.lastDepreciation || a.lastDepreciation < asOf.slice(0, 7))).length,
    };
  }
}

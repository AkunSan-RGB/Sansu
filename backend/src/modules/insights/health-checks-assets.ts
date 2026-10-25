import { REPORT_GROUPS } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';
import { get, natural } from '../accounting/ledger-data';
import { rp, reconCheck } from './health-context';
import type { Check, HealthContext } from './health-context';
import type { Out0 } from './health-checks-ledger';

export async function assetChecks(c: HealthContext, prev: Out0) {
  const { deps, tenantId, asOf, accs, bal, groupTotal, q, checks } = c;
  const { dep } = prev;
  // 6. Aset tetap: buku besar vs daftar aset
  const reg = await deps.assetReports.registerTotals(tenantId, asOf);
  const faGl = groupTotal(['FIXED_ASSET', 'INTANGIBLE_ASSET']);
  const accGl = groupTotal(['ACCUMULATED_DEPRECIATION', 'ACCUMULATED_AMORTIZATION']).negated();
  if (reg.count || !faGl.isZero()) {
    checks.push(
      reconCheck(
        'fixed-assets',
        'Aset tetap: buku besar = daftar aset',
        faGl,
        reg.cost,
        '/fixed-assets',
        'Aset yang dibeli lewat kas keluar/jurnal manual belum didaftarkan di menu Aset Tetap (pilih "aset lama" agar tidak dijurnal dua kali).',
      ),
    );
    checks.push(
      reconCheck(
        'accumulated',
        'Akumulasi penyusutan: buku besar = daftar aset',
        accGl,
        reg.accumulated,
        '/fixed-assets',
        'Penyusutan dicatat manual atau saldo awal akumulasi belum diisi di daftar aset.',
      ),
    );
  }

  // 7. Penyusutan bulan lalu sudah diproses
  const lastMonth = addDays(`${asOf.slice(0, 7)}-01`, -1).slice(0, 7);
  if (reg.count) {
    const [dep] = await q<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM asset_depreciations WHERE tenant_id = ${tenantId} AND period = ${lastMonth}`,
    );
    const due = reg.pendingPeriods > 0 && dep.n === 0;
    checks.push({
      key: 'depreciation',
      category: 'Kelengkapan',
      title: `Penyusutan ${lastMonth} sudah diproses`,
      status: due ? 'WARN' : 'OK',
      message: due
        ? 'Ada aset aktif yang belum disusutkan. Jalankan penyusutan agar laba tidak terlalu tinggi.'
        : 'Penyusutan sudah mutakhir',
      link: '/fixed-assets',
    });
  }

  // 8. Saldo kas / bank negatif
  const negCash = accs.filter(
    (a) => a.reportGroup === 'CASH_EQUIVALENT' && natural(a.type, get(bal, a.id)).isNegative(),
  );
  checks.push({
    key: 'cash-negative',
    category: 'Kewajaran',
    title: 'Tidak ada saldo kas / bank minus',
    status: negCash.length ? 'ERROR' : 'OK',
    message: negCash.length
      ? 'Uang fisik tidak mungkin minus: ada penerimaan yang belum dicatat atau pengeluaran tercatat ganda.'
      : 'Semua saldo kas & bank wajar',
    detail: negCash.map((a) => ({ label: `${a.code} ${a.name}`, value: rp(natural(a.type, get(bal, a.id))) })),
    link: '/cash',
  });

  // 9. Akun bersaldo tidak normal
  const ALLOW = [
    'PREPAID_TAX',
    'TAX_PAYABLE',
    'OTHER_EQUITY',
    'RETAINED_EARNINGS',
    'DEFERRED_TAX_ASSET',
    'DEFERRED_TAX_LIABILITY',
  ];
  const abnormal = accs.filter((a) => {
    if (
      !a.isPostable ||
      ['REVENUE', 'EXPENSE'].includes(a.type) ||
      ALLOW.includes(a.reportGroup) ||
      a.reportGroup === 'CASH_EQUIVALENT'
    )
      return false;
    const n = natural(a.type, get(bal, a.id));
    const contra = (REPORT_GROUPS[a.reportGroup] as { contra?: boolean }).contra === true;
    return contra ? n.gt(0) : n.lt(-1);
  });
  checks.push({
    key: 'abnormal',
    category: 'Kewajaran',
    title: 'Saldo akun sesuai saldo normalnya',
    status: abnormal.length ? 'WARN' : 'OK',
    message: abnormal.length
      ? 'Akun berikut bersaldo terbalik (mis. piutang bersaldo kredit = pelanggan bayar lebih / salah posting).'
      : 'Tidak ada saldo terbalik',
    detail: abnormal
      .slice(0, 10)
      .map((a) => ({ label: `${a.code} ${a.name}`, value: rp(natural(a.type, get(bal, a.id))) })),
    link: '/ledger',
  });
  return {};
}

export type Out1 = Awaited<ReturnType<typeof assetChecks>>;

import { sql } from 'drizzle-orm';
import { PeriodService } from '../../common/period/period.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { get, loadAccounts, natural, sumByAccount } from '../accounting/ledger-data';
import { StatementsService } from '../accounting/statements.service';
import { AssetsService } from '../assets/assets.service';
import { ThresholdsService } from './thresholds.service';
import { AssetReportsService } from '../assets/asset-reports.service';

export type Status = 'OK' | 'WARN' | 'ERROR' | 'INFO';
export interface Check {
  key: string;
  category: 'Integritas' | 'Rekonsiliasi' | 'Kelengkapan' | 'Kewajaran' | 'Kepatuhan';
  title: string;
  status: Status;
  message: string;
  detail?: { label: string; value: string }[];
  link?: string;
}

export const rp = (d: Dec) => `Rp${d.toNumber().toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
/** Pemeriksaan rekonsiliasi: buku besar vs rincian */
export function reconCheck(
  key: string,
  title: string,
  gl: Dec,
  sub: Dec,
  link: string,
  hint: string,
  tolerance = D(1),
): Check {
  const diff = gl.minus(sub);
  const ok = diff.abs().lte(tolerance);
  return {
    key,
    category: 'Rekonsiliasi',
    title,
    status: ok ? 'OK' : 'ERROR',
    message: ok ? `Cocok (${rp(gl)})` : `Selisih ${rp(diff)}. ${hint}`,
    detail: [
      { label: 'Buku besar', value: rp(gl) },
      { label: 'Rincian / buku pembantu', value: rp(sub) },
    ],
    link,
  };
}

export interface HealthDeps {
  db: Db;
  statements: StatementsService;
  assets: AssetsService;
  period: PeriodService;
  thresholds: ThresholdsService;
  assetReports: AssetReportsService;
}

/** Nilai bersama yang dibaca setiap kelompok pemeriksaan kesehatan */
export async function buildHealthContext(deps: HealthDeps, tenantId: string, asOfInput?: string) {
  const asOf = toDocDate(asOfInput);
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const accs = await loadAccounts(deps.db, tenantId);
  const bal = await sumByAccount(deps.db, tenantId, { to: asOf });
  const sys = (k: string) => accs.find((a) => a.systemKey === k);
  const bySys = (k: string) => {
    const a = sys(k);
    return a ? natural(a.type, get(bal, a.id)) : ZERO;
  };
  const groupTotal = (groups: string[]) =>
    accs
      .filter((a) => groups.includes(a.reportGroup))
      .reduce<Dec>((s, a) => s.plus(natural(a.type, get(bal, a.id))), ZERO);
  const checks: Check[] = [];
  const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
    deps.db.execute<T>(query).then((r) => r.rows);
  return { deps, tenantId, asOf, yearStart, accs, bal, sys, bySys, groupTotal, q, checks };
}
export type HealthContext = Awaited<ReturnType<typeof buildHealthContext>>;

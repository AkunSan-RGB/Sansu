import type { Db } from '../../db/db';
import { queryZ } from './zones.repository';

/** Batas kehilangan yang diberi tanda (persen dari pasokan). Air bersih umumnya diwaspadai di atas 20%. */
export const LOSS_WARN_PCT = 20;

export interface ZoneLossRow {
  zone: string;
  period: string;
  unit: string | null;
  mixedUnits: boolean;
  connections: number;
  supplied: number | null;
  usage: number;
  loss: number | null;
  lossPct: number | null;
  unverified: number;
  missing: number;
  note: string | null;
  status: 'NO_SUPPLY' | 'INCOMPLETE' | 'HIGH' | 'OK' | 'NEGATIVE';
}

/** Kehilangan per zona untuk rentang periode (YYYY-MM). `withEmpty`: sertakan zona yang belum punya data pasokan (untuk satu periode). */
export async function zoneLoss(
  db: Db,
  tenantId: string,
  pFrom: string,
  pTo: string,
  withEmpty = false,
): Promise<ZoneLossRow[]> {
  const r = await queryZ(db, tenantId, pFrom, pTo, withEmpty);
  return r.rows.map((x) => {
    const supplied = x.supplied == null ? null : Number(x.supplied);
    const usage = Number(x.usage ?? 0);
    const units = (x.units as string[] | null) ?? [];
    const loss = supplied == null ? null : supplied - usage;
    const lossPct = supplied != null && supplied > 0 ? (loss! / supplied) * 100 : null;
    const unverified = Number(x.unverified ?? 0);
    const missing = Number(x.missing ?? 0);
    const status: ZoneLossRow['status'] =
      supplied == null
        ? 'NO_SUPPLY'
        : unverified > 0 || missing > 0
          ? 'INCOMPLETE'
          : loss! < 0
            ? 'NEGATIVE'
            : lossPct != null && lossPct > LOSS_WARN_PCT
              ? 'HIGH'
              : 'OK';
    return {
      zone: String(x.zone),
      period: String(x.period),
      unit: units[0] ?? null,
      mixedUnits: units.length > 1,
      connections: Number(x.connections ?? 0),
      supplied,
      usage,
      loss,
      lossPct: lossPct == null ? null : Math.round(lossPct * 10) / 10,
      unverified,
      missing,
      note: (x.note as string | null) ?? null,
      status,
    };
  });
}

export const ZONE_STATUS_LABEL: Record<ZoneLossRow['status'], string> = {
  NO_SUPPLY: 'Pasokan belum diisi',
  INCOMPLETE: 'Belum lengkap (ada pencatatan belum diverifikasi/belum dicatat)',
  HIGH: `Kehilangan tinggi (> ${LOSS_WARN_PCT}%)`,
  OK: 'Wajar',
  NEGATIVE: 'Pemakaian melebihi pasokan (periksa meter induk)',
};

import { BadRequestException } from '@nestjs/common';
import { WORK_UNIT_LABELS } from '@sansu/shared';
import { D, Dec } from '../../common/utils/money';
import { Tx } from '../../db/db';
import { monthRange } from '../hr/hr.service';
import {
  queryServiceWorkEntry,
  queryServiceWorkEntryForAttachServiceEntries,
  queryServiceWorkEntryForAttachServiceEntries2,
  queryServiceWorkEntryForAttachServiceEntries3,
  queryServiceWorkEntryForAssertServiceEntriesMatch,
  invoiceUsable,
} from './service-work.repository';
export { invoiceUsable } from './service-work.repository';

export const UNIT_LABELS = WORK_UNIT_LABELS;

export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Dipanggil penggajian saat menghitung slip. Mengaitkan catatan kerja yang DISETUJUI dan layak ke penggajian ini,
 * melepas yang tidak layak lagi (dibatalkan, faktur dibatalkan/diretur, pegawai keluar dari slip), lalu mengembalikan jumlah per pegawai.
 */
export async function attachServiceEntries(
  tx: Tx,
  tenantId: string,
  runId: string,
  period: string,
  keepEmployeeIds: Set<string> | null,
  onlyEmployeeId?: string,
): Promise<Map<string, Dec>> {
  const { to } = monthRange(period);
  await queryServiceWorkEntry(tx, tenantId, runId, to, onlyEmployeeId);
  // lepas: tidak lagi disetujui, atau pegawai tidak lagi ada di slip, atau komisi yang fakturnya tidak layak lagi
  await queryServiceWorkEntryForAttachServiceEntries(tx, tenantId, runId, onlyEmployeeId, keepEmployeeIds);
  // kaitkan yang baru layak
  await queryServiceWorkEntryForAttachServiceEntries2(tx, runId, tenantId, to, onlyEmployeeId, keepEmployeeIds);
  const sums = await queryServiceWorkEntryForAttachServiceEntries3(tx, tenantId, runId);
  return new Map(sums.rows.map((r) => [r.employee_id, D(r.total)]));
}

/** Dipanggil saat posting gaji: jumlah catatan kerja harus sama dengan upah jasa di slip (mencegah selisih diam-diam) */
export async function assertServiceEntriesMatch(
  tx: Tx,
  tenantId: string,
  runId: string,
  slips: { employeeId: string; serviceIncome: string }[],
) {
  const sums = await queryServiceWorkEntryForAssertServiceEntriesMatch(tx, tenantId, runId);
  const by = new Map(sums.rows.map((r) => [r.employee_id, r]));
  for (const s of slips) {
    const e = by.get(s.employeeId);
    if ((e && e.bad > 0) || !D(e?.total ?? 0).eq(D(s.serviceIncome))) {
      throw new BadRequestException(
        'Catatan kerja jasa berubah sesudah gaji dihitung. Klik "Hitung ulang" dulu, lalu periksa slipnya.',
      );
    }
  }
  const slipEmp = new Set(slips.map((s) => s.employeeId));
  if (sums.rows.some((r) => !slipEmp.has(r.employee_id)))
    throw new BadRequestException('Ada catatan kerja jasa yang tidak punya slip. Klik "Hitung ulang" dulu.');
}

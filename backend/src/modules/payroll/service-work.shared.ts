import { BadRequestException } from '@nestjs/common';
import { WORK_UNIT_LABELS } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { D, Dec } from '../../common/utils/money';
import { Tx } from '../../db/db';
import { monthRange } from '../hr/hr.service';

export const UNIT_LABELS = WORK_UNIT_LABELS;

export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Faktur jasa yang boleh dikomisikan: lunas, tidak dibatalkan (jurnal tidak dibalik), tanpa retur */
const employeeOk = sql`EXISTS (SELECT 1 FROM employees em WHERE em.id = w.employee_id AND em.verified
  AND (em.contract_end IS NULL OR em.contract_end >= w.work_date) AND (em.resign_date IS NULL OR em.resign_date >= w.work_date))`;

export const invoiceUsable = sql`i.kind = 'SERVICE' AND i.status = 'PAID' AND i.returned_amount = 0 AND i.is_opening = false
  AND i.journal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversal_of_id = i.journal_id)`;

/**
 * Dipanggil penggajian saat menghitung slip. Mengaitkan catatan kerja yang DISETUJUI dan layak ke penggajian ini,
 * melepas yang tidak layak lagi (dibatalkan, faktur dibatalkan/diretur, pegawai keluar dari slip), lalu mengembalikan jumlah per pegawai.
 */
export async function attachServiceEntries(tx: Tx, tenantId: string, runId: string, period: string, keepEmployeeIds: Set<string> | null, onlyEmployeeId?: string): Promise<Map<string, Dec>> {
  const { to } = monthRange(period);
  await tx.execute(sql`SELECT id FROM service_work_entries WHERE tenant_id = ${tenantId} AND (run_id = ${runId} OR (run_id IS NULL AND status = 'APPROVED' AND work_date <= ${to})) ${onlyEmployeeId ? sql`AND employee_id = ${onlyEmployeeId}` : sql``} FOR UPDATE`);
  // lepas: tidak lagi disetujui, atau pegawai tidak lagi ada di slip, atau komisi yang fakturnya tidak layak lagi
  await tx.execute(sql`
    UPDATE service_work_entries w SET run_id = NULL
    WHERE w.tenant_id = ${tenantId} AND w.run_id = ${runId} ${onlyEmployeeId ? sql`AND w.employee_id = ${onlyEmployeeId}` : sql``}
      AND (w.status <> 'APPROVED' OR NOT ${employeeOk}
        ${keepEmployeeIds ? sql`OR w.employee_id NOT IN (${keepEmployeeIds.size ? sql.join([...keepEmployeeIds].map((x) => sql`${x}::uuid`), sql`, `) : sql`NULL::uuid`})` : sql``}
        OR (w.unit = 'PERCENT' AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = w.invoice_id AND ${invoiceUsable})))`);
  // kaitkan yang baru layak
  await tx.execute(sql`
    UPDATE service_work_entries w SET run_id = ${runId}
    WHERE w.tenant_id = ${tenantId} AND w.run_id IS NULL AND w.status = 'APPROVED' AND w.work_date <= ${to}
      ${onlyEmployeeId ? sql`AND w.employee_id = ${onlyEmployeeId}` : sql``}
      ${keepEmployeeIds ? sql`AND w.employee_id IN (${keepEmployeeIds.size ? sql.join([...keepEmployeeIds].map((x) => sql`${x}::uuid`), sql`, `) : sql`NULL::uuid`})` : sql``}
      AND ${employeeOk}
      AND (w.unit <> 'PERCENT' OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = w.invoice_id AND ${invoiceUsable}))`);
  const sums = await tx.execute<{ employee_id: string; total: string }>(sql`
    SELECT employee_id, SUM(amount) AS total FROM service_work_entries WHERE tenant_id = ${tenantId} AND run_id = ${runId} AND status = 'APPROVED' GROUP BY employee_id`);
  return new Map(sums.rows.map((r) => [r.employee_id, D(r.total)]));
}

/** Dipanggil saat posting gaji: jumlah catatan kerja harus sama dengan upah jasa di slip (mencegah selisih diam-diam) */
export async function assertServiceEntriesMatch(tx: Tx, tenantId: string, runId: string, slips: { employeeId: string; serviceIncome: string }[]) {
  const sums = await tx.execute<{ employee_id: string; total: string; bad: number }>(sql`
    SELECT employee_id, SUM(amount) AS total, COUNT(*) FILTER (WHERE status <> 'APPROVED')::int AS bad
    FROM service_work_entries WHERE tenant_id = ${tenantId} AND run_id = ${runId} GROUP BY employee_id`);
  const by = new Map(sums.rows.map((r) => [r.employee_id, r]));
  for (const s of slips) {
    const e = by.get(s.employeeId);
    if ((e && e.bad > 0) || !D(e?.total ?? 0).eq(D(s.serviceIncome))) {
      throw new BadRequestException('Catatan kerja jasa berubah sesudah gaji dihitung. Klik "Hitung ulang" dulu, lalu periksa slipnya.');
    }
  }
  const slipEmp = new Set(slips.map((s) => s.employeeId));
  if (sums.rows.some((r) => !slipEmp.has(r.employee_id))) throw new BadRequestException('Ada catatan kerja jasa yang tidak punya slip. Klik "Hitung ulang" dulu.');
}

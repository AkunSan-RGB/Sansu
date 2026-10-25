import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { QcPlanDto, DecideDto } from './qc.dto';
import { AuthUser } from '../../common/auth/auth-user';
import { todayJakarta } from '../../common/utils/dates';
import type { QcParamDto } from './qc.dto';
import type { ResultDto } from './qc.dto';
import type { Decimal } from 'decimal.js';
import type { SQL } from 'drizzle-orm';

export type Insp = {
  source_type: string;
  receipt_id: string | null;
  parent_id: string | null;
  attempt: number;
  qty_reworked: string;
  lot_no: string | null;
  expiry_date: string | null;
  sample_size: string | null;
  accept_defects: number | null;
  id: string;
  number: string;
  order_id: string | null;
  product_id: string;
  warehouse_id: string;
  release_warehouse_id: string;
  qty: string;
  unit_cost: string;
  status: string;
  qty_pass: string | null;
  qty_fail: string | null;
  qty_scrapped: string;
  completed_by_id: string | null;
  inspector_id: string | null;
};

/** Akses data untuk Qc: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class QcRepository {
  /** Dipakai oleh QcService.quarantineWarehouse */
  queryWarehouse(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM warehouses WHERE tenant_id = ${tenantId} AND is_quarantine AND is_active`,
    );
  }

  /** Dipakai oleh QcService.setup */
  queryWarehouseForSetup(db: DbOrTx, tenantId: string, code: 'KARANTINA') {
    return db.execute<{ id: string }>(
      sql`INSERT INTO warehouses (tenant_id, code, name, is_quarantine) VALUES (${tenantId}, ${code}, 'Gudang Karantina (QC)', true) ON CONFLICT DO NOTHING RETURNING id`,
    );
  }

  /** Dipakai oleh QcService.savePlan */
  queryProduct(db: DbOrTx, productId: string, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM products WHERE id = ${productId} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh QcService.savePlan */
  queryQcPlan(db: DbOrTx, tenantId: string, productId: string, dto: QcPlanDto) {
    return db.execute<{ id: string }>(
      sql`INSERT INTO qc_plans (tenant_id, product_id, name, sample_pct, sample_min, sample_max, accept_defects) VALUES (${tenantId}, ${productId}, ${dto.name.trim()}, ${dto.samplePct ?? null}, ${dto.sampleMin ?? null}, ${dto.sampleMax ?? null}, ${dto.acceptDefects ?? null}) ON CONFLICT (tenant_id, product_id) DO UPDATE SET name = EXCLUDED.name, is_active = true, sample_pct = EXCLUDED.sample_pct, sample_min = EXCLUDED.sample_min, sample_max = EXCLUDED.sample_max, accept_defects = EXCLUDED.accept_defects RETURNING id`,
    );
  }

  /** Dipakai oleh QcService.savePlan */
  queryQcPlanParam(db: DbOrTx, id: string) {
    return db.execute(sql`DELETE FROM qc_plan_params WHERE plan_id = ${id}`);
  }

  /** Dipakai oleh QcService.savePlan */
  querySavePlan(db: DbOrTx, require: boolean, productId: string) {
    return db.execute(sql`UPDATE products SET qc_required = ${require} WHERE id = ${productId}`);
  }

  /** Dipakai oleh QcService.createTx */
  queryQcPlanForCreateTx(db: DbOrTx, tenantId: string, productId: string) {
    return db.execute<{
      id: string;
      sample_pct: string | null;
      sample_min: number | null;
      sample_max: number | null;
      accept_defects: number | null;
    }>(
      sql`SELECT id, sample_pct, sample_min, sample_max, accept_defects FROM qc_plans WHERE tenant_id = ${tenantId} AND product_id = ${productId} AND is_active`,
    );
  }

  /** Dipakai oleh QcService.createTx */
  queryQcInspectionResult(db: DbOrTx, id: string, parentId: string) {
    return db.execute(
      sql`INSERT INTO qc_inspection_results (tenant_id, inspection_id, sequence, name, kind, min_value, max_value, unit, critical) SELECT tenant_id, ${id}::uuid, sequence, name, kind, min_value, max_value, unit, critical FROM qc_inspection_results WHERE inspection_id = ${parentId} ORDER BY sequence`,
    );
  }

  /** Dipakai oleh QcService.createTx */
  queryQcInspectionResultForCreateTx(db: DbOrTx, id: string, planId: string) {
    return db.execute(
      sql`INSERT INTO qc_inspection_results (tenant_id, inspection_id, sequence, name, kind, min_value, max_value, unit, critical) SELECT tenant_id, ${id}::uuid, sequence, name, kind, min_value, max_value, unit, critical FROM qc_plan_params WHERE plan_id = ${planId}`,
    );
  }

  /** Dipakai oleh QcService.inboundQuarantine */
  queryProductForInboundQuarantine(db: DbOrTx, tenantId: string, productIds: string[]) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM products WHERE tenant_id = ${tenantId} AND qc_required AND id IN (${sql.join(
        productIds.map((i) => sql`${i}::uuid`),
        sql`, `,
      )})`,
    );
  }

  /** Dipakai oleh QcService.get */
  queryQcInspectionResultForGet(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(
      sql`SELECT id, sequence, name, kind, min_value AS "minValue", max_value AS "maxValue", unit, critical, value, passed FROM qc_inspection_results WHERE inspection_id = ${id} AND tenant_id = ${tenantId} ORDER BY sequence`,
    );
  }

  /** Dipakai oleh QcService.get */
  queryQcAttachment(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(
      sql`SELECT a.id, a.kind, a.filename, a.mime, a.created_at AS "createdAt", u.name AS "uploadedBy" FROM qc_attachments a LEFT JOIN users u ON u.id = a.uploaded_by_id WHERE a.inspection_id = ${id} AND a.tenant_id = ${tenantId} ORDER BY a.created_at`,
    );
  }

  /** Dipakai oleh QcService.decide */
  queryQcInspectionResultForDecide(db: DbOrTx, id: string) {
    return db.execute<{
      id: string;
      name: string;
      kind: string;
      min_value: string | null;
      max_value: string | null;
      critical: boolean;
    }>(
      sql`SELECT id, name, kind, min_value, max_value, critical FROM qc_inspection_results WHERE inspection_id = ${id} ORDER BY sequence`,
    );
  }

  /** Dipakai oleh QcService.decide */
  queryDecide(db: DbOrTx, sampleDefects: number, id: string) {
    return db.execute(sql`UPDATE qc_inspections SET sample_defects = ${sampleDefects} WHERE id = ${id}`);
  }

  /** Dipakai oleh QcService.addAttachment */
  queryQcAttachmentForAddAttachment(db: DbOrTx, id: string) {
    return db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM qc_attachments WHERE inspection_id = ${id}`);
  }

  /** Dipakai oleh QcService.addAttachment */
  queryQcAttachmentForAddAttachment2(
    db: DbOrTx,
    tenantId: string,
    id: string,
    kind: 'PHOTO' | 'COA',
    filename: string,
    mime: string,
    ref: string | null,
    sub: string,
  ) {
    return db.execute(
      sql`INSERT INTO qc_attachments (tenant_id, inspection_id, kind, filename, mime, ref, uploaded_by_id) VALUES (${tenantId}, ${id}, ${kind}, ${filename.trim()}, ${mime}, ${ref}, ${sub})`,
    );
  }

  /** Dipakai oleh QcService.attachment */
  queryQcAttachmentForAttachment(db: DbOrTx, attId: string, id: string, tenantId: string) {
    return db.execute<{ filename: string; mime: string; ref: string }>(
      sql`SELECT filename, mime, ref FROM qc_attachments WHERE id = ${attId} AND inspection_id = ${id} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh QcService.removeAttachment */
  queryQcAttachmentForRemoveAttachment(db: DbOrTx, attId: string, id: string, tenantId: string) {
    return db.execute<{ ref: string; filename: string }>(
      sql`DELETE FROM qc_attachments WHERE id = ${attId} AND inspection_id = ${id} AND tenant_id = ${tenantId} RETURNING ref, filename`,
    );
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh QcService.savePlan */
  queryQcPlanParamForSavePlan(db: DbOrTx, u: AuthUser, id: string, i: number, p: QcParamDto) {
    return db.execute(
      sql`INSERT INTO qc_plan_params (tenant_id, plan_id, sequence, name, kind, min_value, max_value, unit, critical) VALUES (${u.tenantId}, ${id}, ${i + 1}, ${p.name.trim()}, ${p.kind}, ${p.kind === 'NUMERIC' ? (p.minValue ?? null) : null}, ${p.kind === 'NUMERIC' ? (p.maxValue ?? null) : null}, ${p.unit ?? null}, ${p.critical ?? false})`,
    );
  }

  /** Dipakai oleh QcService.createTx */
  queryQcInspection(
    db: DbOrTx,
    u: AuthUser,
    number: string,
    pValues: string,
    pPValues: string | null | undefined,
    pValues2: string | null | undefined,
    pValues3: string,
    plan: {
      id: string;
      sample_pct: string | null;
      sample_min: number | null;
      sample_max: number | null;
      accept_defects: number | null;
    },
    pValues4: string,
    pValues5: string,
    pValues6: string,
    pValues7: string,
    pValues8: string | null | undefined,
    pValues9: string | null | undefined,
    pValues10: string | undefined,
    pValues11: number | undefined,
    sampleSize: number | null,
  ) {
    return db.execute<{ id: string }>(
      sql`INSERT INTO qc_inspections (tenant_id, number, source_type, order_id, receipt_id, product_id, plan_id, warehouse_id, release_warehouse_id, qty, unit_cost, completed_by_id, lot_no, expiry_date, parent_id, attempt, sample_size, accept_defects) VALUES (${u.tenantId}, ${number}, ${pValues}, ${pPValues ?? null}, ${pValues2 ?? null}, ${pValues3}, ${plan?.id ?? null}, ${pValues4}, ${pValues5}, ${pValues6}, ${pValues7}, ${u.sub}, ${pValues8 ?? null}, ${pValues9 ?? null}, ${pValues10 ?? null}, ${pValues11 ?? 1}, ${sampleSize}, ${sampleSize != null ? plan!.accept_defects : null}) RETURNING id`,
    );
  }

  /** Dipakai oleh QcService.lock */
  queryQcInspectionForLock(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<Insp>(sql`SELECT * FROM qc_inspections WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh QcService.decide */
  queryDecideForDecide(db: DbOrTx, v: ResultDto, ok: boolean, id: string) {
    return db.execute(
      sql`UPDATE qc_inspection_results SET value = ${v.value ?? null}, passed = ${ok} WHERE id = ${id}`,
    );
  }

  /** Dipakai oleh QcService.decide */
  queryStockLot(
    db: DbOrTx,
    tenantId: string,
    product_id: string,
    release_warehouse_id: string,
    lot_no: string | null,
    expiry_date: string | null,
    qtyPass: Decimal,
    id: string,
  ) {
    return db.execute<{ id: string }>(
      sql`INSERT INTO stock_lots (tenant_id, product_id, warehouse_id, lot_no, expiry_date, received_date, qty_received, qty_remaining, source_type, source_ref) VALUES (${tenantId}, ${product_id}, ${release_warehouse_id}, ${lot_no}, ${expiry_date}, ${todayJakarta()}, ${qtyPass.toFixed(4)}, ${qtyPass.toFixed(4)}, 'QC_INSPECTION', ${id}) RETURNING id`,
    );
  }

  /** Dipakai oleh QcService.decide */
  queryDecideForDecide2(
    db: DbOrTx,
    status: string,
    qtyPass: Decimal,
    qtyFail: Decimal,
    sub: string,
    dto: DecideDto,
    id: string,
  ) {
    return db.execute(
      sql`UPDATE qc_inspections SET status = ${status}, qty_pass = ${qtyPass.toFixed(4)}, qty_fail = ${qtyFail.toFixed(4)}, inspector_id = ${sub}, decided_at = now(), note = ${dto.note ?? null} WHERE id = ${id}`,
    );
  }

  /** Dipakai oleh QcService.scrap */
  queryScrap(db: DbOrTx, q: Decimal, id: string) {
    return db.execute(sql`UPDATE qc_inspections SET qty_scrapped = qty_scrapped + ${q.toFixed(4)} WHERE id = ${id}`);
  }

  /** Dipakai oleh QcService.rework */
  queryRework(db: DbOrTx, q: Decimal, id: string) {
    return db.execute(sql`UPDATE qc_inspections SET qty_reworked = qty_reworked + ${q.toFixed(4)} WHERE id = ${id}`);
  }

  /** Dipakai oleh QcService.controls */
  queryControls(db: DbOrTx, t: SQL<unknown>) {
    return db.execute(t);
  }
}

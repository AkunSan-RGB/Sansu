import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { QcPlanDto } from './qc.dto';

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
}

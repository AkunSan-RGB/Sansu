import { Injectable, Logger } from '@nestjs/common';
import { HANDOFFS, type HandoffEvent } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { ApprovalsService } from '../approvals/approvals.service';

/** Tabel dokumen yang boleh dicari nomornya (daftar tetap; bukan input pengguna) */
const NUMBER_TABLES = {
  SALES_ORDER_CONFIRMED: 'sales_orders',
  DELIVERY_POSTED: 'delivery_orders',
  PO_CONFIRMED: 'purchase_orders',
  GOODS_RECEIVED: 'goods_receipts',
  PR_APPROVED: 'purchase_requests',
  PRODUCTION_COMPLETED: 'production_orders',
  POS_SESSION_CLOSED: 'pos_sessions',
  PAYROLL_POSTED: 'payroll_runs',
} as const satisfies Record<HandoffEvent, string>;

/**
 * Pemberitahuan serah terima antar bagian (Telegram / email bila terhubung). Gagal kirim tidak pernah menggagalkan proses utama,
 * dan tidak ditunggu (dijalankan di latar belakang).
 */
@Injectable()
export class HandoffService {
  private readonly logger = new Logger('SerahTerima');
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly approvals: ApprovalsService,
  ) {}

  /** Beri tahu bagian berikutnya tentang dokumen `docId` milik perusahaan `tenantId`; `actorId` (pelaku) tidak diberi tahu */
  fire(tenantId: string, event: HandoffEvent, actorId: string, docId: string, extra?: string) {
    void this.send(tenantId, event, actorId, docId, extra).catch((e) => this.logger.warn(`Serah terima ${event} gagal: ${(e as Error).message}`));
  }

  private async send(tenantId: string, event: HandoffEvent, actorId: string, docId: string, extra?: string) {
    const rule = HANDOFFS[event];
    const r = await this.db.execute<{ number: string }>(sql.raw(`SELECT number FROM ${NUMBER_TABLES[event]} WHERE id = '${docId.replace(/[^0-9a-f-]/gi, '')}' AND tenant_id = '${tenantId}'`));
    const no = r.rows[0]?.number;
    if (!no) return;
    await this.approvals.notifyRoles(tenantId, { roles: rule.to, excludeUserId: actorId, title: rule.title.replace('{no}', no), lines: [rule.action, ...(extra ? [extra] : [])], path: rule.path });
  }
}

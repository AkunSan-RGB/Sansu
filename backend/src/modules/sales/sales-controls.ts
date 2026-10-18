import { Controller, Get, Injectable } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CONTROL_PROFILES } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { SettingsService } from '../../common/settings.service';
import { RequireApp } from '../../common/apps/app.guard';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';

export interface SalesControlFinding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

/**
 * Temuan kontrol penjualan (anti-fraud) untuk 60 hari terakhir: surat jalan belum difakturkan, pesanan dibatalkan setelah dikonfirmasi,
 * surat jalan dibatalkan, dan diskon besar. Terpisah dari kontrol pembelian agar bisa dibuka tanpa aplikasi Pembelian.
 */
@Injectable()
export class SalesControlsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async controls(tenantId: string) {
    const today = todayJakarta();
    const since = addDays(today, -60);
    const out: SalesControlFinding[] = [];
    const add = (key: string, level: SalesControlFinding['level'], title: string, refs: string[], detail: string) => {
      if (refs.length) out.push({ key, level, title: `${title} (${refs.length})`, detail, refs });
    };
    const cp = CONTROL_PROFILES[await this.settings.businessModel(this.db, tenantId)];

    // 5. Surat jalan belum difakturkan (ambang menurut jenis usaha; tidak relevan untuk jasa)
    if (cp.deliveryNotBilledDays !== null) {
    const dn = await this.db.execute<{ number: string }>(sql`
      SELECT d.number FROM delivery_orders d
      WHERE d.tenant_id = ${tenantId} AND d.status = 'DELIVERED' AND d.invoice_id IS NULL AND d.date <= ${addDays(today, -cp.deliveryNotBilledDays)}
      ORDER BY d.date`);
    add('DELIVERY_NOT_BILLED', 'warning', `Surat jalan belum difakturkan > ${cp.deliveryNotBilledDays} hari`, dn.rows.map((r) => r.number), 'Barang sudah keluar tetapi belum ditagih. Tagih sekarang atau pastikan tidak ada barang keluar tanpa tagihan.');

    }

    // 12. Penjualan: pesanan dibatalkan setelah dikonfirmasi
    const sc = await this.db.execute<{ number: string; reason: string | null }>(sql`
      SELECT o.number, o.cancel_reason AS reason FROM sales_orders o
      WHERE o.tenant_id = ${tenantId} AND o.status = 'CANCELLED' AND o.cancelled_by_id IS NOT NULL AND o.date >= ${since}
        AND EXISTS (SELECT 1 FROM audit_logs l WHERE l.entity = 'SalesOrder' AND l.entity_id = o.id::text AND l.action = 'CONFIRM')`);
    add('SO_CANCELLED_AFTER_CONFIRM', 'info', 'Pesanan penjualan dibatalkan setelah dikonfirmasi', sc.rows.map((r) => `${r.number}${r.reason ? ` — ${r.reason}` : ''}`), 'Pastikan pembatalan wajar dan bukan menghilangkan jejak penjualan.');

    // 13. Penjualan: surat jalan dibatalkan (barang sudah keluar fisik)
    const dc = await this.db.execute<{ number: string; reason: string | null }>(sql`
      SELECT number, cancel_reason AS reason FROM delivery_orders WHERE tenant_id = ${tenantId} AND status = 'CANCELLED' AND date >= ${since}`);
    add('DN_CANCELLED', 'warning', 'Surat jalan dibatalkan', dc.rows.map((r) => `${r.number}${r.reason ? ` — ${r.reason}` : ''}`), 'Barang sudah sempat keluar gudang. Pastikan barang benar-benar kembali ke stok.');

    // 14. Penjualan: diskon besar (>= 20% per baris) pada pesanan yang dikonfirmasi
    const dh = await this.db.execute<{ number: string; pct: string }>(sql`
      SELECT DISTINCT o.number, MAX(l.discount_pct)::text AS pct FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
      WHERE o.tenant_id = ${tenantId} AND o.date >= ${since} AND o.status <> 'CANCELLED' AND l.discount_pct >= 20 GROUP BY o.number ORDER BY o.number DESC`);
    add('DISCOUNT_HEAVY', 'info', 'Diskon besar (≥ 20%) pada pesanan penjualan', dh.rows.map((r) => `${r.number} (${Number(r.pct)}%)`), 'Diskon besar yang berulang pada pelanggan atau sales yang sama patut ditanyakan.');

    const rank = { error: 0, warning: 1, info: 2 } as const;
    out.sort((a, b) => rank[a.level] - rank[b.level]);
    return { asOf: today, since, items: out };
  }
}

@ApiTags('Penjualan')
@ApiBearerAuth()
@RequireApp('sales')
@Controller('sales-controls')
export class SalesControlsController {
  constructor(private readonly svc: SalesControlsService) {}

  @Get()
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  controls(@CurrentUser() u: AuthUser) {
    return this.svc.controls(u.tenantId);
  }
}

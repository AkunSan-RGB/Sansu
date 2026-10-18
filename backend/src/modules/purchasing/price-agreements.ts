/**
 * Kontrak harga pemasok / prinsipal. Harga disepakati per barang untuk periode tertentu (mis. kontrak tahunan dengan prinsipal FMCG,
 * harga tetap bahan baku pabrik, harga bahan segar mingguan kafe). Pesanan pembelian di atas harga kontrak ditahan.
 *
 * Pencegahan kecurangan:
 *  - kontrak baru berstatus MENUNGGU dan baru berlaku setelah disetujui orang lain (Keuangan/Admin; Pemilik dikecualikan)
 *  - satu barang dari satu pemasok tidak boleh punya dua kontrak yang periodenya tumpang tindih
 *  - PO di atas harga kontrak aktif ditolak; hanya Admin/Pemilik yang boleh melewati, dan tercatat di jejak audit
 *  - kontrak yang harganya jauh di atas harga beli terakhir ditandai untuk diperiksa
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { and, eq, sql } from 'drizzle-orm';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { addDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec } from '../../common/utils/money';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { products, supplierPriceAgreements, suppliers } from '../../db/schema';

export const MAX_CONTRACT_DAYS = 3 * 366;
export const SUSPICIOUS_PCT_OVER_LAST = 20;

export class CreateAgreementDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '9000', description: 'Rupiah per satuan dasar, sebelum PPN' }) @IsNumberString() price: string;
  @ApiProperty({ example: '2026-11-01' }) @IsDateString() validFrom: string;
  @ApiProperty({ example: '2027-10-31' }) @IsDateString() validTo: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class DecideAgreementDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) note?: string;
}
export class ReasonDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) reason: string;
}
export class LookupDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

@Injectable()
export class PriceAgreementsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(u: AuthUser, status?: string) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.supplier_id AS "supplierId", s.name AS "supplierName", a.product_id AS "productId", p.sku, p.name AS "productName", p.base_uom AS "baseUom",
             a.price, a.valid_from::text AS "validFrom", a.valid_to::text AS "validTo", a.status, a.note, a.decision_note AS "decisionNote",
             cu.name AS "createdByName", du.name AS "decidedByName",
             (SELECT (l.price * (1 - l.discount_pct / 100) / NULLIF(l.uom_factor, 0)) FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
               WHERE o.tenant_id = a.tenant_id AND o.supplier_id = a.supplier_id AND l.product_id = a.product_id AND o.status <> 'CANCELLED' ORDER BY o.date DESC, o.created_at DESC LIMIT 1) AS "lastPrice"
      FROM supplier_price_agreements a JOIN suppliers s ON s.id = a.supplier_id JOIN products p ON p.id = a.product_id
      LEFT JOIN users cu ON cu.id = a.created_by_id LEFT JOIN users du ON du.id = a.decided_by_id
      WHERE a.tenant_id = ${u.tenantId} ${status ? sql`AND a.status = ${status}` : sql``}
      ORDER BY a.created_at DESC LIMIT 500`);
    return rows.rows.map((r) => {
      const last = r.lastPrice != null ? D(r.lastPrice as string) : null;
      const over = last && last.gt(0) ? D(r.price as string).minus(last).div(last).times(100) : null;
      return { ...r, lastPrice: last ? last.toFixed(2) : null, overLastPct: over ? Number(over.toFixed(1)) : null, suspicious: !!over && over.gt(SUSPICIOUS_PCT_OVER_LAST) };
    });
  }

  async create(u: AuthUser, dto: CreateAgreementDto) {
    const price = D(dto.price);
    if (!price.isFinite() || price.lte(0)) throw new BadRequestException('Harga kontrak harus lebih dari 0');
    const from = toDocDate(dto.validFrom);
    const to = toDocDate(dto.validTo);
    if (to < from) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    if (to < todayJakarta()) throw new BadRequestException('Kontrak yang sudah berakhir tidak perlu dicatat');
    if (to > addDays(from, MAX_CONTRACT_DAYS)) throw new BadRequestException('Masa kontrak maksimal 3 tahun');
    const [sup] = await this.db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, dto.supplierId), eq(suppliers.tenantId, u.tenantId)));
    if (!sup) throw new BadRequestException('Pemasok tidak ditemukan');
    const [prod] = await this.db.select({ id: products.id }).from(products).where(and(eq(products.id, dto.productId), eq(products.tenantId, u.tenantId)));
    if (!prod) throw new BadRequestException('Barang tidak ditemukan');
    const clash = await this.db.execute(sql`
      SELECT 1 FROM supplier_price_agreements WHERE tenant_id = ${u.tenantId} AND supplier_id = ${dto.supplierId} AND product_id = ${dto.productId}
        AND status IN ('PENDING','ACTIVE') AND valid_from <= ${to} AND valid_to >= ${from} LIMIT 1`);
    if (clash.rows.length) throw new BadRequestException('Barang ini sudah punya kontrak (atau pengajuan) yang periodenya tumpang tindih dengan pemasok yang sama');
    const [row] = await this.db.insert(supplierPriceAgreements).values({ tenantId: u.tenantId, supplierId: dto.supplierId, productId: dto.productId, price: price.toFixed(2), validFrom: from, validTo: to, note: dto.note ?? null, createdById: u.sub }).returning();
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'SupplierPriceAgreement', entityId: row.id, data: { price: row.price, from, to } });
    return row;
  }

  private async lockRow(tx: DbOrTx, tenantId: string, id: string) {
    const r = await tx.execute<typeof supplierPriceAgreements.$inferSelect & { created_by_id: string }>(sql`SELECT * FROM supplier_price_agreements WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    if (!r.rows.length) throw new NotFoundException('Kontrak tidak ditemukan');
    return r.rows[0] as unknown as { id: string; status: string; created_by_id: string; supplier_id: string; product_id: string; valid_from: string; valid_to: string; price: string };
  }

  private assertChecker(u: AuthUser, createdBy: string) {
    if (createdBy === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Kontrak harus disetujui orang lain dari pembuatnya (pemisahan fungsi)');
  }

  async approve(u: AuthUser, id: string, dto: DecideAgreementDto) {
    return this.db.transaction(async (tx) => {
      const a = await this.lockRow(tx, u.tenantId, id);
      if (a.status !== 'PENDING') throw new BadRequestException('Kontrak ini sudah diputuskan');
      this.assertChecker(u, a.created_by_id);
      const [row] = await tx.update(supplierPriceAgreements).set({ status: 'ACTIVE', decidedById: u.sub, decidedAt: new Date(), decisionNote: dto.note ?? null }).where(eq(supplierPriceAgreements.id, id)).returning();
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'SupplierPriceAgreement', entityId: id, data: { price: a.price } });
      return row;
    });
  }

  async reject(u: AuthUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (tx) => {
      const a = await this.lockRow(tx, u.tenantId, id);
      if (a.status !== 'PENDING') throw new BadRequestException('Kontrak ini sudah diputuskan');
      this.assertChecker(u, a.created_by_id);
      const [row] = await tx.update(supplierPriceAgreements).set({ status: 'REJECTED', decidedById: u.sub, decidedAt: new Date(), decisionNote: dto.reason }).where(eq(supplierPriceAgreements.id, id)).returning();
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'SupplierPriceAgreement', entityId: id, data: { reason: dto.reason } });
      return row;
    });
  }

  /** Akhiri kontrak lebih awal (PO yang sudah dibuat tidak berubah) */
  async end(u: AuthUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (tx) => {
      const a = await this.lockRow(tx, u.tenantId, id);
      if (a.status !== 'ACTIVE' && a.status !== 'PENDING') throw new BadRequestException('Kontrak ini sudah tidak berlaku');
      const [row] = await tx.update(supplierPriceAgreements).set({ status: 'ENDED', decidedById: u.sub, decidedAt: new Date(), decisionNote: dto.reason }).where(eq(supplierPriceAgreements.id, id)).returning();
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'END', entity: 'SupplierPriceAgreement', entityId: id, data: { reason: dto.reason, was: a.status } });
      return row;
    });
  }

  lookupFor(u: AuthUser, q: LookupDto) {
    return this.lookup(this.db, u.tenantId, q.supplierId, q.productId, q.date ? toDocDate(q.date) : todayJakarta());
  }

  /** Harga kontrak aktif untuk pemasok + barang pada tanggal tertentu (per satuan dasar) */
  async lookup(db: DbOrTx, tenantId: string, supplierId: string, productId: string, date: string) {
    const r = await db.execute<{ id: string; price: string; valid_to: string }>(sql`
      SELECT id, price, valid_to::text FROM supplier_price_agreements
      WHERE tenant_id = ${tenantId} AND supplier_id = ${supplierId} AND product_id = ${productId} AND status = 'ACTIVE' AND valid_from <= ${date} AND valid_to >= ${date} LIMIT 1`);
    return r.rows[0] ? { id: r.rows[0].id, price: r.rows[0].price, validTo: r.rows[0].valid_to } : null;
  }

  /**
   * Dipanggil saat PO dibuat: harga efektif per satuan dasar (setelah diskon) tidak boleh melebihi harga kontrak aktif.
   * Admin/Pemilik boleh melewati, tercatat di audit. Hanya untuk PO Rupiah (kontrak dalam Rupiah).
   */
  async enforce(tx: DbOrTx, u: AuthUser, supplierId: string, date: string, lines: { productId: string; price: Dec; discountPct: Dec; uomFactor: string }[]) {
    const over: string[] = [];
    for (const l of lines) {
      const ag = await this.lookup(tx, u.tenantId, supplierId, l.productId, date);
      if (!ag) continue;
      const eff = l.price.times(D(1).minus(l.discountPct.div(100))).div(D(l.uomFactor));
      if (eff.gt(D(ag.price).times('1.0001'))) {
        const [p] = await tx.select({ sku: products.sku }).from(products).where(eq(products.id, l.productId));
        over.push(`${p?.sku ?? l.productId}: ${eff.toFixed(2)} > kontrak ${D(ag.price).toFixed(2)}`);
      }
    }
    if (!over.length) return;
    if (u.role !== 'OWNER' && u.role !== 'ADMIN') throw new BadRequestException(`Harga melebihi kontrak harga pemasok (${over.join('; ')}). Sesuaikan harga atau minta Admin/Pemilik menyetujui.`);
    await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'OVERRIDE', entity: 'SupplierPriceAgreement', entityId: supplierId, data: { over } });
  }
}

@ApiTags('Kontrak harga pemasok')
@ApiBearerAuth()
@RequireApp('purchase')
@Roles('PURCHASING', 'FINANCE', 'ACCOUNTANT', 'ADMIN')
@Controller('price-agreements')
export class PriceAgreementsController {
  constructor(private readonly svc: PriceAgreementsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.svc.list(u, status);
  }
  @Get('lookup')
  async lookup(@CurrentUser() u: AuthUser, @Query() q: LookupDto) {
    return this.svc.lookupFor(u, q);
  }
  @Roles('PURCHASING', 'ADMIN')
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateAgreementDto) {
    return this.svc.create(u, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post(':id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideAgreementDto) {
    return this.svc.approve(u, id, dto);
  }
  @Roles('FINANCE', 'ADMIN')
  @Post(':id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.svc.reject(u, id, dto);
  }
  @Roles('PURCHASING', 'FINANCE', 'ADMIN')
  @Post(':id/end')
  end(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.svc.end(u, id, dto);
  }
}

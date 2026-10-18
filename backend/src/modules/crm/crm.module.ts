import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { ACTIVITY_TYPES, type ActivityType, CRM_PROFILES, isValidLostReason, LEAD_STATUSES, type LeadStatus, QUOTATION_STATUSES, type QuotationStatus } from '@sansu/shared';
import { RequireApp } from '../../common/apps/app.guard';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SequenceService } from '../../common/sequence/sequence.service';
import { outputVatRate, SettingsService, taxProfileOf } from '../../common/settings.service';
import { addDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { crmActivities, crmStages, customers, leads, quotationLines, quotations, tenants, warehouses } from '../../db/schema';
import { buildLines } from '../master-data/products/line-builder';
import { SalesOrdersService } from '../sales/orders/sales-orders.service';
import { documentTotals, inclusiveDocument } from '../sales/pricing';
import { SalesModule } from '../sales/sales.module';


// ---------- DTO ----------
export class CreateLeadDto {
  @ApiProperty({ example: 'Toko Makmur — pasok mi & minuman' }) @IsString() @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) companyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ example: 'Kunjungan lapangan' }) @IsOptional() @IsString() @MaxLength(80) source?: string;
  @ApiPropertyOptional({ example: '15000000' }) @IsOptional() @IsNumberString() expectedRevenue?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) probability?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() stageId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedCloseDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
export class UpdateLeadDto extends PartialType(CreateLeadDto) {}

export class MarkLeadDto {
  @ApiProperty({ enum: ['WON', 'LOST', 'OPEN'] }) @IsIn(LEAD_STATUSES) status: LeadStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) lostReason?: string;
  @ApiPropertyOptional({ description: 'Menang: buat pelanggan baru dari data prospek bila belum ada' })
  @IsOptional()
  @IsBoolean()
  createCustomer?: boolean;
}

export class CreateActivityDto {
  @ApiProperty() @IsUUID() leadId: string;
  @ApiProperty({ enum: ACTIVITY_TYPES }) @IsIn(ACTIVITY_TYPES) type: ActivityType;
  @ApiProperty({ example: 'Telepon tanya kebutuhan bulanan' }) @IsString() @MaxLength(255) summary: string;
  @ApiProperty({ example: '2026-10-05' }) @IsDateString() dueDate: string;
}

export class DoneActivityDto {
  @ApiPropertyOptional({ example: 'Minta penawaran 50 dus' }) @IsOptional() @IsString() @MaxLength(500) result?: string;
}

export class StageDto {
  @ApiProperty() @IsString() @MaxLength(60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) probability?: number;
}

export class QuotationLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() uom?: string;
  @ApiProperty({ example: '10' }) @IsNumberString() qty: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() price?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumberString() discountPct?: string;
}

export class CreateQuotationDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() leadId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ example: 14, description: 'Masa berlaku (hari)' }) @IsOptional() @IsInt() @Min(1) @Max(365) validDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ example: 'Harga belum termasuk ongkos kirim. Pembayaran 30 hari.' }) @IsOptional() @IsString() terms?: string;
  @ApiPropertyOptional({ description: 'Harga yang diinput sudah termasuk PPN' }) @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
  @ApiProperty({ type: [QuotationLineDto] })
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  @ArrayMinSize(1)
  lines: QuotationLineDto[];
}

export class QuotationQueryDto {
  @ApiPropertyOptional({ enum: QUOTATION_STATUSES }) @IsOptional() @IsIn(QUOTATION_STATUSES) status?: QuotationStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() leadId?: string;
}

// ---------- Service ----------
@Injectable()
export class CrmService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly orders: SalesOrdersService,
    private readonly settings: SettingsService,
  ) {}

  /** Tahap pipeline; dibuat otomatis saat pertama dipakai */
  async stages(tenantId: string, db: DbOrTx = this.db) {
    let rows = await db.select().from(crmStages).where(eq(crmStages.tenantId, tenantId)).orderBy(asc(crmStages.sequence));
    if (!rows.length) {
      // tahap bawaan mengikuti jenis usaha (survei untuk jasa, kunjungan outlet untuk FMCG, dst.)
      const model = await this.settings.businessModel(db, tenantId);
      rows = await db
        .insert(crmStages)
        .values(CRM_PROFILES[model].stages.map((s, i) => ({ tenantId, sequence: i + 1, ...s })))
        .returning();
    }
    return rows;
  }

  async addStage(tenantId: string, dto: StageDto) {
    const all = await this.stages(tenantId);
    const [s] = await this.db
      .insert(crmStages)
      .values({ tenantId, name: dto.name, probability: dto.probability ?? 50, sequence: (all.at(-1)?.sequence ?? 0) + 1 })
      .returning();
    return s;
  }

  async renameStage(tenantId: string, id: string, dto: StageDto) {
    const [s] = await this.db
      .update(crmStages)
      .set({ name: dto.name, probability: dto.probability })
      .where(and(eq(crmStages.id, id), eq(crmStages.tenantId, tenantId)))
      .returning();
    if (!s) throw new NotFoundException('Tahap tidak ditemukan');
    return s;
  }

  async deleteStage(tenantId: string, id: string) {
    const [mine] = await this.db.select({ id: crmStages.id }).from(crmStages).where(and(eq(crmStages.id, id), eq(crmStages.tenantId, tenantId)));
    if (!mine) throw new NotFoundException('Tahap tidak ditemukan');
    const [used] = await this.db.select({ id: leads.id }).from(leads).where(eq(leads.stageId, id)).limit(1);
    if (used) throw new BadRequestException('Tahap masih berisi prospek; pindahkan dulu prospeknya');
    const all = await this.stages(tenantId);
    if (all.length <= 1) throw new BadRequestException('Minimal harus ada satu tahap');
    await this.db.delete(crmStages).where(and(eq(crmStages.id, id), eq(crmStages.tenantId, tenantId)));
    return { ok: true };
  }

  /** Data papan kanban: tahap + prospek berjalan (dan yang ditutup 30 hari terakhir bila diminta) */
  async pipeline(tenantId: string, ownerId?: string) {
    const stages = await this.stages(tenantId);
    const rows = await this.db.query.leads.findMany({
      where: and(eq(leads.tenantId, tenantId), eq(leads.status, 'OPEN'), ownerId ? eq(leads.ownerId, ownerId) : undefined),
      with: {
        customer: { columns: { code: true, name: true } },
        owner: { columns: { id: true, name: true } },
        activities: { where: eq(crmActivities.done, false), orderBy: asc(crmActivities.dueDate), limit: 1 },
      },
      orderBy: desc(leads.createdAt),
    });
    return { stages, leads: rows };
  }

  async listLeads(tenantId: string, status?: LeadStatus) {
    return this.db.query.leads.findMany({
      where: and(eq(leads.tenantId, tenantId), status ? eq(leads.status, status) : undefined),
      with: { stage: { columns: { name: true } }, owner: { columns: { name: true } }, customer: { columns: { name: true } } },
      orderBy: desc(leads.createdAt),
      limit: 500,
    });
  }

  async getLead(tenantId: string, id: string) {
    const l = await this.db.query.leads.findFirst({
      where: and(eq(leads.id, id), eq(leads.tenantId, tenantId)),
      with: {
        stage: true,
        customer: { columns: { id: true, code: true, name: true } },
        owner: { columns: { id: true, name: true } },
        activities: { orderBy: [asc(crmActivities.done), desc(crmActivities.dueDate)], with: { user: { columns: { name: true } } } },
        quotations: { columns: { id: true, number: true, date: true, status: true, total: true } },
      },
    });
    if (!l) throw new NotFoundException('Prospek tidak ditemukan');
    return l;
  }

  /** Profil CRM jenis usaha ini (tahap bawaan, sumber, alasan kalah) untuk layar */
  async profile(tenantId: string) {
    const model = await this.settings.businessModel(this.db, tenantId);
    return { model, ...CRM_PROFILES[model] };
  }

  private async assertSource(tenantId: string, source: string | undefined | null, current?: string | null) {
    if (!source || source === current) return;
    const model = await this.settings.businessModel(this.db, tenantId);
    if (!CRM_PROFILES[model].sources.includes(source)) throw new BadRequestException(`Sumber prospek harus salah satu: ${CRM_PROFILES[model].sources.join(', ')}`);
  }

  async createLead(user: AuthUser, dto: CreateLeadDto) {
    await this.assertSource(user.tenantId, dto.source);
    const stages = await this.stages(user.tenantId);
    const stage = dto.stageId ? stages.find((s) => s.id === dto.stageId) : stages[0];
    if (!stage) throw new BadRequestException('Tahap tidak ditemukan');
    await this.assertCustomer(user.tenantId, dto.customerId);
    const [l] = await this.db
      .insert(leads)
      .values({
        ...dto,
        tenantId: user.tenantId,
        stageId: stage.id,
        ownerId: dto.ownerId ?? user.sub,
        probability: dto.probability ?? stage.probability,
        expectedRevenue: dto.expectedRevenue ?? '0',
      })
      .returning();
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'Lead', entityId: l.id });
    return this.getLead(user.tenantId, l.id);
  }

  async updateLead(user: AuthUser, id: string, dto: UpdateLeadDto) {
    const lead = await this.getLead(user.tenantId, id);
    await this.assertSource(user.tenantId, dto.source, lead.source);
    await this.assertCustomer(user.tenantId, dto.customerId);
    let probability = dto.probability;
    if (dto.stageId && dto.stageId !== lead.stageId) {
      const stages = await this.stages(user.tenantId);
      const stage = stages.find((s) => s.id === dto.stageId);
      if (!stage) throw new BadRequestException('Tahap tidak ditemukan');
      probability ??= stage.probability;
    }
    await this.db
      .update(leads)
      .set({ ...dto, probability })
      .where(eq(leads.id, id));
    return this.getLead(user.tenantId, id);
  }

  /** Tandai menang / kalah / buka kembali. Menang dapat sekaligus membuat pelanggan. */
  async mark(user: AuthUser, id: string, dto: MarkLeadDto) {
    const lead = await this.getLead(user.tenantId, id);
    if (dto.status === 'LOST' && !dto.lostReason) throw new BadRequestException('Isi alasan kalah agar bisa dianalisis');
    if (dto.status === 'LOST' && !isValidLostReason(await this.settings.businessModel(this.db, user.tenantId), dto.lostReason!)) throw new BadRequestException('Pilih alasan kalah dari daftar, atau tulis "Lainnya: …" dengan keterangan');
    return this.db.transaction(async (tx) => {
      let customerId = lead.customerId;
      if (dto.status === 'WON' && !customerId && dto.createCustomer) {
        const name = lead.companyName || lead.contactName || lead.title;
        const [{ n }] = (await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM customers WHERE tenant_id = ${user.tenantId}`)).rows;
        const [c] = await tx
          .insert(customers)
          .values({
            tenantId: user.tenantId,
            code: `CUST-${String(n + 1).padStart(4, '0')}`,
            name,
            phone: lead.phone,
          })
          .returning();
        customerId = c.id;
      }
      await tx
        .update(leads)
        .set({
          status: dto.status,
          lostReason: dto.status === 'LOST' ? dto.lostReason : null,
          probability: dto.status === 'WON' ? 100 : dto.status === 'LOST' ? 0 : undefined,
          closedAt: dto.status === 'OPEN' ? null : new Date(),
          customerId,
        })
        .where(eq(leads.id, id));
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: dto.status, entity: 'Lead', entityId: id });
      return { id, status: dto.status, customerId };
    });
  }

  async addActivity(user: AuthUser, dto: CreateActivityDto) {
    await this.getLead(user.tenantId, dto.leadId);
    const [a] = await this.db
      .insert(crmActivities)
      .values({ ...dto, dueDate: toDocDate(dto.dueDate), tenantId: user.tenantId, userId: user.sub })
      .returning();
    return a;
  }

  async doneActivity(user: AuthUser, id: string, dto: DoneActivityDto) {
    const [a] = await this.db
      .update(crmActivities)
      .set({ done: true, doneAt: new Date(), result: dto.result })
      .where(and(eq(crmActivities.id, id), eq(crmActivities.tenantId, user.tenantId)))
      .returning();
    if (!a) throw new NotFoundException('Aktivitas tidak ditemukan');
    return a;
  }

  /** Aktivitas yang belum selesai sampai hari ini (untuk pengingat harian sales) */
  myAgenda(user: AuthUser) {
    return this.db.query.crmActivities.findMany({
      where: and(eq(crmActivities.tenantId, user.tenantId), eq(crmActivities.done, false), lte(crmActivities.dueDate, addDays(todayJakarta(), 7))),
      with: { lead: { columns: { id: true, title: true, contactName: true, phone: true } }, user: { columns: { name: true } } },
      orderBy: asc(crmActivities.dueDate),
      limit: 200,
    });
  }

  /** Ringkasan pipeline: nilai per tahap, nilai tertimbang, rasio menang */
  async summary(tenantId: string) {
    const stages = await this.stages(tenantId);
    const res = await this.db.execute<{ stage_id: string; n: number; value: string; weighted: string }>(sql`
      SELECT stage_id, COUNT(*)::int AS n, COALESCE(SUM(expected_revenue), 0) AS value,
             COALESCE(SUM(expected_revenue * probability / 100.0), 0) AS weighted
      FROM leads WHERE tenant_id = ${tenantId} AND status = 'OPEN' GROUP BY stage_id`);
    const [wl] = (
      await this.db.execute<{ won: number; lost: number; won_value: string }>(sql`
      SELECT COUNT(*) FILTER (WHERE status = 'WON')::int AS won, COUNT(*) FILTER (WHERE status = 'LOST')::int AS lost,
             COALESCE(SUM(expected_revenue) FILTER (WHERE status = 'WON'), 0) AS won_value
      FROM leads WHERE tenant_id = ${tenantId} AND closed_at >= now() - interval '90 days'`)
    ).rows;
    const byStage = new Map(res.rows.map((r) => [r.stage_id, r]));
    return {
      stages: stages.map((s) => ({
        id: s.id,
        name: s.name,
        count: byStage.get(s.id)?.n ?? 0,
        value: Number(byStage.get(s.id)?.value ?? 0).toFixed(2),
        weighted: Number(byStage.get(s.id)?.weighted ?? 0).toFixed(2),
      })),
      won90: wl.won,
      lost90: wl.lost,
      wonValue90: Number(wl.won_value).toFixed(2),
      winRate90: wl.won + wl.lost ? Math.round((wl.won / (wl.won + wl.lost)) * 100) : 0,
    };
  }

  // ---------- Penawaran harga ----------
  listQuotations(tenantId: string, q: QuotationQueryDto) {
    return this.db.query.quotations.findMany({
      where: and(
        eq(quotations.tenantId, tenantId),
        q.status ? eq(quotations.status, q.status) : undefined,
        q.leadId ? eq(quotations.leadId, q.leadId) : undefined,
      ),
      with: { customer: { columns: { code: true, name: true } }, salesOrder: { columns: { id: true, number: true } } },
      orderBy: [desc(quotations.date), desc(quotations.number)],
      limit: 300,
    });
  }

  async getQuotation(tenantId: string, id: string) {
    const q = await this.db.query.quotations.findFirst({
      where: and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)),
      with: {
        customer: true,
        warehouse: { columns: { id: true, name: true } },
        lead: { columns: { id: true, title: true } },
        salesOrder: { columns: { id: true, number: true } },
        lines: { with: { product: { columns: { sku: true, name: true } } } },
      },
    });
    if (!q) throw new NotFoundException('Penawaran tidak ditemukan');
    const [tenant] = await this.db.select({ name: tenants.name, address: tenants.address, npwp: tenants.npwp }).from(tenants).where(eq(tenants.id, tenantId));
    return { ...q, company: tenant };
  }

  async createQuotation(user: AuthUser, dto: CreateQuotationDto) {
    const date = toDocDate(dto.date);
    const id = await this.db.transaction(async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId));
      await this.assertCustomer(user.tenantId, dto.customerId, tx);
      const [wh] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, user.tenantId)));
      if (!wh) throw new BadRequestException('Gudang tidak ditemukan');
      if (dto.leadId) {
        const [l] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.id, dto.leadId), eq(leads.tenantId, user.tenantId)));
        if (!l) throw new BadRequestException('Prospek tidak ditemukan');
      }
      const built = await buildLines(tx, user.tenantId, dto.lines, 'sell');
      const rate = outputVatRate(tenant);
      const inclusive = !!dto.pricesIncludeVat && D(rate).gt(0);
      const totals = inclusive
        ? inclusiveDocument(built, rate)
        : { lines: built.map((l) => ({ ...l, priceInclVat: null })), ...documentTotals(built, rate, taxProfileOf(tenant.settings).vatRounding) };
      const lines = totals.lines;
      const number = await this.seq.next(tx, user.tenantId, 'QUOTATION', date);
      const [q] = await tx
        .insert(quotations)
        .values({
          tenantId: user.tenantId,
          number,
          date,
          validUntil: addDays(date, dto.validDays ?? 14),
          customerId: dto.customerId,
          leadId: dto.leadId,
          warehouseId: dto.warehouseId,
          notes: dto.notes,
          terms: dto.terms,
          subtotal: totals.subtotal.toFixed(2),
          taxAmount: totals.taxAmount.toFixed(2),
          total: totals.total.toFixed(2),
          pricesIncludeVat: inclusive,
          createdById: user.sub,
        })
        .returning({ id: quotations.id });
      await tx.insert(quotationLines).values(
        lines.map((l) => ({
          quotationId: q.id,
          productId: l.productId,
          uom: l.uom,
          uomFactor: l.uomFactor,
          qty: l.qty,
          price: l.price.toFixed(2),
          discountPct: l.discountPct.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
          priceInclVat: l.priceInclVat ? l.priceInclVat.toFixed(2) : null,
        })),
      );
      // Tautkan prospek ke pelanggan yang diberi penawaran
      if (dto.leadId) {
        await tx.update(leads).set({ customerId: dto.customerId }).where(and(eq(leads.id, dto.leadId), sql`${leads.customerId} IS NULL`));
      }
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'Quotation', entityId: q.id });
      return q.id;
    });
    return this.getQuotation(user.tenantId, id);
  }

  async setQuotationStatus(user: AuthUser, id: string, status: 'SENT' | 'REJECTED' | 'CANCELLED') {
    const q = await this.getQuotation(user.tenantId, id);
    const allowed: Record<string, QuotationStatus[]> = { SENT: ['DRAFT'], REJECTED: ['DRAFT', 'SENT'], CANCELLED: ['DRAFT', 'SENT'] };
    if (!allowed[status].includes(q.status)) throw new BadRequestException(`Penawaran berstatus ${q.status}`);
    await this.db.update(quotations).set({ status }).where(eq(quotations.id, id));
    return this.getQuotation(user.tenantId, id);
  }

  /** Pelanggan setuju → buat Sales Order (draft) dengan harga & diskon yang sama persis */
  async convert(user: AuthUser, id: string) {
    const q = await this.getQuotation(user.tenantId, id);
    if (q.status !== 'DRAFT' && q.status !== 'SENT') throw new BadRequestException(`Penawaran berstatus ${q.status}`);
    const so = await this.orders.create(user, {
      customerId: q.customerId,
      warehouseId: q.warehouseId,
      notes: `Dari penawaran ${q.number}${q.notes ? ` — ${q.notes}` : ''}`,
      pricesIncludeVat: q.pricesIncludeVat,
      // harga & potongan penawaran dipakai persis seperti disetujui pelanggan: promo/daftar harga tidak boleh mengubahnya
      applyPromos: false,
      lines: q.lines.map((l) => ({
        productId: l.productId,
        uom: l.uom,
        qty: l.qty,
        // harga termasuk PPN dipakai ulang apa adanya agar total pesanan = total penawaran
        price: q.pricesIncludeVat && l.priceInclVat ? l.priceInclVat : l.price,
        discountPct: l.discountPct,
      })),
    });
    const updated = await this.db
      .update(quotations)
      .set({ status: 'ACCEPTED', salesOrderId: so.id })
      .where(and(eq(quotations.id, id), inArray(quotations.status, ['DRAFT', 'SENT'])))
      .returning({ id: quotations.id });
    if (!updated.length) throw new BadRequestException('Penawaran sudah diproses pengguna lain');
    if (q.leadId) {
      await this.db.update(leads).set({ status: 'WON', probability: 100, closedAt: new Date() }).where(and(eq(leads.id, q.leadId), eq(leads.status, 'OPEN')));
    }
    return { quotation: await this.getQuotation(user.tenantId, id), salesOrder: so };
  }

  private async assertCustomer(tenantId: string, customerId?: string | null, db: DbOrTx = this.db) {
    if (!customerId) return;
    const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
    if (!c) throw new BadRequestException('Pelanggan tidak ditemukan');
  }
}

// ---------- Controller ----------
@ApiTags('CRM')
@ApiBearerAuth()
@RequireApp('crm')
@Roles('SALES', 'ADMIN')
@Controller('crm')
export class CrmController {
  constructor(private readonly svc: CrmService) {}

  @Get('profile')
  profile(@CurrentUser() u: AuthUser) {
    return this.svc.profile(u.tenantId);
  }
  @Get('stages')
  stages(@CurrentUser() u: AuthUser) {
    return this.svc.stages(u.tenantId);
  }
  @Roles('ADMIN')
  @Post('stages')
  addStage(@CurrentUser() u: AuthUser, @Body() dto: StageDto) {
    return this.svc.addStage(u.tenantId, dto);
  }
  @Roles('ADMIN')
  @Patch('stages/:id')
  renameStage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StageDto) {
    return this.svc.renameStage(u.tenantId, id, dto);
  }
  @Roles('ADMIN')
  @Delete('stages/:id')
  deleteStage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteStage(u.tenantId, id);
  }

  @Get('pipeline')
  pipeline(@CurrentUser() u: AuthUser, @Query('mine') mine?: string) {
    return this.svc.pipeline(u.tenantId, mine === '1' ? u.sub : undefined);
  }
  @Get('summary')
  summary(@CurrentUser() u: AuthUser) {
    return this.svc.summary(u.tenantId);
  }
  @Get('agenda')
  agenda(@CurrentUser() u: AuthUser) {
    return this.svc.myAgenda(u);
  }

  @Get('leads')
  leads(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.svc.listLeads(u.tenantId, LEAD_STATUSES.includes(status as LeadStatus) ? (status as LeadStatus) : undefined);
  }
  @Get('leads/:id')
  lead(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getLead(u.tenantId, id);
  }
  @Post('leads')
  createLead(@CurrentUser() u: AuthUser, @Body() dto: CreateLeadDto) {
    return this.svc.createLead(u, dto);
  }
  @Patch('leads/:id')
  updateLead(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.svc.updateLead(u, id, dto);
  }
  @Post('leads/:id/mark')
  mark(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkLeadDto) {
    return this.svc.mark(u, id, dto);
  }

  @Post('activities')
  addActivity(@CurrentUser() u: AuthUser, @Body() dto: CreateActivityDto) {
    return this.svc.addActivity(u, dto);
  }
  @Post('activities/:id/done')
  done(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DoneActivityDto) {
    return this.svc.doneActivity(u, id, dto);
  }

  @Get('quotations')
  quotations(@CurrentUser() u: AuthUser, @Query() q: QuotationQueryDto) {
    return this.svc.listQuotations(u.tenantId, q);
  }
  @Get('quotations/:id')
  quotation(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getQuotation(u.tenantId, id);
  }
  @Post('quotations')
  createQuotation(@CurrentUser() u: AuthUser, @Body() dto: CreateQuotationDto) {
    return this.svc.createQuotation(u, dto);
  }
  @Post('quotations/:id/send')
  send(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setQuotationStatus(u, id, 'SENT');
  }
  @Post('quotations/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setQuotationStatus(u, id, 'REJECTED');
  }
  @Post('quotations/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setQuotationStatus(u, id, 'CANCELLED');
  }
  @Post('quotations/:id/convert')
  convert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.convert(u, id);
  }
}

@Module({
  imports: [SalesModule],
  controllers: [CrmController],
  providers: [CrmService],
})
export class CrmModule {}

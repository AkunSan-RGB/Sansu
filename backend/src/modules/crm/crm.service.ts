import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { CRM_PROFILES, isValidLostReason, type LeadStatus, type QuotationStatus } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
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
import { StageDto, CreateLeadDto, UpdateLeadDto, MarkLeadDto, CreateActivityDto, DoneActivityDto, QuotationQueryDto, CreateQuotationDto } from './crm.dto';
import { insertOne, patchById } from '../../db/owned';

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
    const s = await insertOne(this.db, crmStages, { tenantId, name: dto.name, probability: dto.probability ?? 50, sequence: (all.at(-1)?.sequence ?? 0) + 1 });
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
    const l = await insertOne(this.db, leads, {
        ...dto,
        tenantId: user.tenantId,
        stageId: stage.id,
        ownerId: dto.ownerId ?? user.sub,
        probability: dto.probability ?? stage.probability,
        expectedRevenue: dto.expectedRevenue ?? '0',
      });
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
    await patchById(this.db, leads, id, { ...dto, probability });
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
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-code:${user.tenantId}`}))`); // kode dari hitungan baris: serialkan agar tidak ganda
        const [{ n }] = (await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM customers WHERE tenant_id = ${user.tenantId}`)).rows;
        const c = await insertOne(tx, customers, {
            tenantId: user.tenantId,
            code: `CUST-${String(n + 1).padStart(4, '0')}`,
            name,
            phone: lead.phone,
          });
        customerId = c.id;
      }
      await patchById(tx, leads, id, {
          status: dto.status,
          lostReason: dto.status === 'LOST' ? dto.lostReason : null,
          probability: dto.status === 'WON' ? 100 : dto.status === 'LOST' ? 0 : undefined,
          closedAt: dto.status === 'OPEN' ? null : new Date(),
          customerId,
        });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: dto.status, entity: 'Lead', entityId: id });
      return { id, status: dto.status, customerId };
    });
  }

  async addActivity(user: AuthUser, dto: CreateActivityDto) {
    await this.getLead(user.tenantId, dto.leadId);
    const a = await insertOne(this.db, crmActivities, { ...dto, dueDate: toDocDate(dto.dueDate), tenantId: user.tenantId, userId: user.sub });
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
    await patchById(this.db, quotations, id, { status });
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

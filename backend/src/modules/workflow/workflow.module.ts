/**
 * Alur kerja operasional per jenis usaha. Definisi tahap ada di shared/src/workflow.ts; di sini mesin yang menjalankannya:
 *  - hanya pipeline milik jenis usaha perusahaan itu yang bisa dipakai (jenis usaha dikunci, jadi alurnya tidak tercampur)
 *  - kasus hanya maju satu tahap sesuai urutan, oleh peran yang berhak; tidak bisa loncat atau mundur diam-diam
 *  - syarat tahap: dokumen terkait yang nyata (milik perusahaan ini, tidak dibatalkan), catatan/bukti, dan pemeriksa berbeda (SoD)
 *  - tahap yang bisa dipastikan dari dokumen (mis. faktur lunas) maju otomatis; tahap yang butuh keputusan manusia tidak pernah dilompati
 *  - satu dokumen hanya boleh dipakai satu kasus; kasus selesai/batal tidak bisa diubah lagi; semua langkah tercatat
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  pipelinesFor, stageOf, WORKFLOW_LINK_LABELS, WORKFLOW_LINK_TYPES, WORKFLOW_PIPELINE_BY_KEY,
  type WorkflowLinkType, type WorkflowPipeline, type WorkflowStage,
} from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { toDocDate, todayJakarta } from '../../common/utils/dates';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { customers, suppliers, workflowCases, workflowEvents, workflowLinks } from '../../db/schema';

/** Tabel dokumen sumber tiap jenis tautan (semua ber-tenant_id) */
const col = (c: string) => (a: string) => `${a}.${c}::text`;
const SOURCES: Record<WorkflowLinkType, { table: string; number: (a: string) => string; status: (a: string) => string }> = {
  QUOTATION: { table: 'quotations', number: col('number'), status: col('status') },
  SALES_ORDER: { table: 'sales_orders', number: col('number'), status: col('status') },
  DELIVERY_ORDER: { table: 'delivery_orders', number: col('number'), status: col('status') },
  INVOICE: { table: 'invoices', number: col('number'), status: col('status') },
  PURCHASE_ORDER: { table: 'purchase_orders', number: col('number'), status: col('status') },
  GOODS_RECEIPT: { table: 'goods_receipts', number: col('number'), status: col('status') },
  PURCHASE_INVOICE: { table: 'purchase_invoices', number: col('number'), status: (a) => `(CASE WHEN ${a}.paid_amount >= ${a}.total THEN 'PAID' WHEN ${a}.paid_amount > 0 THEN 'PARTIAL' ELSE 'UNPAID' END)` },
  PRODUCTION_ORDER: { table: 'production_orders', number: col('number'), status: col('status') },
  PROJECT: { table: 'projects', number: col('code'), status: col('status') },
  POS_SESSION: { table: 'pos_sessions', number: col('number'), status: col('status') },
  PRINCIPAL_CLAIM: { table: 'principal_claims', number: col('number'), status: col('status') },
  CANVASS: { table: 'canvass_collections', number: col('number'), status: col('status') },
  STOCK_TRANSFER: { table: 'stock_transfers', number: col('number'), status: col('status') },
};
const DEAD = new Set(['CANCELLED', 'REJECTED', 'VOID']);

export class CreateCaseDto {
  @ApiProperty({ example: 'JASA_PROYEK' }) @IsString() @MaxLength(40) pipeline: string;
  @ApiProperty({ example: 'Renovasi kantor PT Maju' }) @IsString() @MinLength(3) @MaxLength(160) title: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ example: '25000000' }) @IsOptional() @IsNumberString() amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
}
export class AddLinkDto {
  @ApiProperty({ enum: WORKFLOW_LINK_TYPES }) @IsIn(WORKFLOW_LINK_TYPES as unknown as string[]) type: WorkflowLinkType;
  @ApiProperty() @IsUUID() docId: string;
}
export class AdvanceDto {
  @ApiProperty() @IsString() @MaxLength(40) to: string;
  @ApiPropertyOptional({ description: 'Catatan / bukti (wajib untuk tahap tertentu)' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class NoteDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) note: string;
}
export class CaseQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() pipeline?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['ACTIVE', 'DONE', 'CANCELLED']) status?: string;
}

type CaseRow = typeof workflowCases.$inferSelect;
const allows = (u: AuthUser, roles: string[]) => u.role === 'OWNER' || roles.includes(u.role);

@Injectable()
export class WorkflowService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  private async pipelineOf(tenantId: string, key: string): Promise<WorkflowPipeline> {
    const model = await this.settings.businessModel(this.db, tenantId);
    const p = WORKFLOW_PIPELINE_BY_KEY[key];
    // jenis usaha dikunci per perusahaan, jadi alur jenis usaha lain tidak pernah bisa dipakai
    if (!p || p.model !== model) throw new BadRequestException('Alur kerja ini bukan untuk jenis usaha perusahaan Anda');
    return p;
  }

  /** Status terkini semua dokumen yang ditautkan ke kasus (dibaca dari tabel sumber, tidak disalin) */
  private async liveLinks(db: DbOrTx, tenantId: string, caseId: string) {
    const links = await db.select().from(workflowLinks).where(and(eq(workflowLinks.caseId, caseId), eq(workflowLinks.tenantId, tenantId))).orderBy(asc(workflowLinks.createdAt));
    const out: { id: string; type: WorkflowLinkType; docId: string; number: string; status: string | null; dead: boolean }[] = [];
    for (const l of links) {
      const src = SOURCES[l.linkType as WorkflowLinkType];
      const r = await db.execute<{ number: string; status: string }>(sql.raw(`SELECT ${src.number('t')} AS number, ${src.status('t')} AS status FROM "${src.table}" t WHERE t.tenant_id = '${tenantId}' AND t.id = '${l.docId}'`));
      const row = r.rows[0];
      out.push({ id: l.id, type: l.linkType as WorkflowLinkType, docId: l.docId, number: row?.number ?? l.docNumber, status: row?.status ?? null, dead: !row || DEAD.has(row.status) });
    }
    return out;
  }

  private reasonsBlocked(u: AuthUser, p: WorkflowPipeline, c: CaseRow, to: WorkflowStage, links: { type: WorkflowLinkType; dead: boolean; status?: string | null }[], lastMoverId: string | null, note?: string): string[] {
    const out: string[] = [];
    if (!allows(u, to.roles)) out.push(`Hanya peran ${to.roles.join('/')} yang boleh memindahkan ke "${to.label}"`);
    for (const need of to.requireLink ?? []) {
      if (!links.some((l) => l.type === need && !l.dead)) out.push(`Tautkan dulu ${WORKFLOW_LINK_LABELS[need]} (yang masih berlaku)`);
    }
    // tahap yang bisa dibuktikan dari dokumen tidak bisa diklaim manual tanpa bukti
    if (to.auto?.length && !to.auto.some((r) => links.some((l) => l.type === r.link && !l.dead && !!l.status && r.status.includes(l.status)))) {
      out.push(`Belum ada bukti di dokumen terkait: ${to.auto.map((r) => `${WORKFLOW_LINK_LABELS[r.link]} berstatus ${r.status.join('/')}`).join(' atau ')}`);
    }
    if (to.requireNote && !(note && note.trim().length >= 5)) out.push('Isi catatan / bukti (minimal 5 huruf)');
    if (to.sod && lastMoverId && lastMoverId === u.sub && u.role !== 'OWNER') out.push('Harus dilakukan orang lain dari yang memindahkan kasus ke tahap saat ini (pemisahan fungsi)');
    return out;
  }

  // ---------- baca ----------
  async pipelines(u: AuthUser) {
    const model = await this.settings.businessModel(this.db, u.tenantId);
    const counts = await this.db.execute<{ pipeline: string; stage: string; n: number }>(sql`SELECT pipeline, stage, COUNT(*)::int AS n FROM workflow_cases WHERE tenant_id = ${u.tenantId} AND status = 'ACTIVE' GROUP BY pipeline, stage`);
    return pipelinesFor(model).map((p) => ({
      ...p,
      stages: p.stages.map((s) => ({ ...s, count: counts.rows.find((c) => c.pipeline === p.key && c.stage === s.key)?.n ?? 0 })),
    }));
  }

  async list(u: AuthUser, q: CaseQueryDto) {
    await this.refresh(u);
    const model = await this.settings.businessModel(this.db, u.tenantId);
    const keys = pipelinesFor(model).map((p) => p.key);
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.pipeline, c.number, c.title, c.stage, c.status, c.amount, c.due_date::text AS "dueDate", c.stage_entered_at AS "stageEnteredAt", c.created_at AS "createdAt",
             cu.name AS "customerName", su.name AS "supplierName",
             (SELECT COUNT(*)::int FROM workflow_links l WHERE l.case_id = c.id) AS "linkCount"
      FROM workflow_cases c LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN suppliers su ON su.id = c.supplier_id
      WHERE c.tenant_id = ${u.tenantId} AND c.pipeline = ANY(${sql.raw(`ARRAY[${keys.map((k) => `'${k}'`).join(',')}]::text[]`)})
        ${q.pipeline ? sql`AND c.pipeline = ${q.pipeline}` : sql``} ${q.status ? sql`AND c.status = ${q.status}` : sql``}
      ORDER BY c.created_at DESC LIMIT 300`);
    return rows.rows;
  }

  async get(u: AuthUser, id: string) {
    const [c] = await this.db.select().from(workflowCases).where(and(eq(workflowCases.id, id), eq(workflowCases.tenantId, u.tenantId)));
    if (!c) throw new NotFoundException('Kasus tidak ditemukan');
    const p = await this.pipelineOf(u.tenantId, c.pipeline);
    const links = await this.liveLinks(this.db, u.tenantId, id);
    const events = await this.db.execute<Record<string, unknown>>(sql`
      SELECT e.id, e.kind, e.from_stage AS "fromStage", e.to_stage AS "toStage", e.note, e.auto, e.at, us.name AS "byName"
      FROM workflow_events e LEFT JOIN users us ON us.id = e.by_id WHERE e.tenant_id = ${u.tenantId} AND e.case_id = ${id} ORDER BY e.id`);
    const cur = stageOf(p, c.stage)!;
    const lastMover = c.stageEnteredById;
    const moves = c.status === 'ACTIVE'
      ? cur.next.filter((k) => k !== 'BATAL').map((k) => {
          const to = stageOf(p, k)!;
          return { to: k, label: to.label, needsNote: !!to.requireNote, blocked: this.reasonsBlocked(u, p, c, to, links, lastMover, 'x'.repeat(5)).filter((r) => !r.startsWith('Isi catatan')) };
        })
      : [];
    const cancel = stageOf(p, 'BATAL');
    return {
      ...c,
      pipelineLabel: p.label,
      stageLabel: cur.label,
      stageHint: cur.hint,
      stages: p.stages.map((s) => ({ key: s.key, label: s.label, terminal: !!s.terminal })),
      links,
      linkTypes: p.links.map((t) => ({ type: t, label: WORKFLOW_LINK_LABELS[t] })),
      events: events.rows,
      moves,
      canCancel: c.status === 'ACTIVE' && !!cancel && allows(u, cancel.roles),
      canBack: c.status === 'ACTIVE' && (u.role === 'OWNER' || u.role === 'ADMIN'),
    };
  }

  /** Dokumen yang bisa ditautkan: milik perusahaan ini, belum dipakai kasus lain, belum dibatalkan */
  async candidates(u: AuthUser, type: WorkflowLinkType) {
    const src = SOURCES[type];
    if (!src) throw new BadRequestException('Jenis dokumen tidak dikenal');
    const r = await this.db.execute<{ id: string; number: string; status: string }>(sql.raw(`
      SELECT d.id, ${src.number('d')} AS number, ${src.status('d')} AS status FROM "${src.table}" d
      WHERE d.tenant_id = '${u.tenantId}' AND NOT EXISTS (SELECT 1 FROM workflow_links l WHERE l.tenant_id = d.tenant_id AND l.link_type = '${type}' AND l.doc_id = d.id)
      ORDER BY d.created_at DESC LIMIT 50`));
    return r.rows.filter((x) => !DEAD.has(x.status));
  }

  async alerts(u: AuthUser) {
    const model = await this.settings.businessModel(this.db, u.tenantId);
    const out: { kind: string; severity: 'warn' | 'info'; caseId: string; number: string; message: string }[] = [];
    const rows = await this.db.select().from(workflowCases).where(and(eq(workflowCases.tenantId, u.tenantId), eq(workflowCases.status, 'ACTIVE')));
    const today = Date.now();
    for (const c of rows) {
      const p = WORKFLOW_PIPELINE_BY_KEY[c.pipeline];
      if (!p || p.model !== model) continue;
      const s = stageOf(p, c.stage);
      if (s?.slaDays) {
        const days = Math.floor((today - c.stageEnteredAt.getTime()) / 86400000);
        if (days > s.slaDays) out.push({ kind: 'MACET', severity: 'warn', caseId: c.id, number: c.number, message: `${c.number} · ${c.title}: ${days} hari di tahap "${s.label}" (batas ${s.slaDays} hari)` });
      }
      if (c.dueDate && c.dueDate < todayJakarta()) out.push({ kind: 'LEWAT_TEMPO', severity: 'warn', caseId: c.id, number: c.number, message: `${c.number} · ${c.title}: tenggat ${c.dueDate} sudah lewat` });
      for (const l of await this.liveLinks(this.db, u.tenantId, c.id)) {
        if (l.dead) out.push({ kind: 'DOKUMEN_BATAL', severity: 'warn', caseId: c.id, number: c.number, message: `${c.number} · ${c.title}: ${WORKFLOW_LINK_LABELS[l.type]} ${l.number} dibatalkan / hilang — periksa kasus ini` });
      }
    }
    return out;
  }

  // ---------- tulis ----------
  private async event(tx: DbOrTx, tenantId: string, caseId: string, e: { kind: string; from?: string; to?: string; note?: string; by?: string; auto?: boolean }) {
    await tx.insert(workflowEvents).values({ tenantId, caseId, kind: e.kind, fromStage: e.from ?? null, toStage: e.to ?? null, note: e.note ?? null, byId: e.by ?? null, auto: !!e.auto });
  }

  async create(u: AuthUser, dto: CreateCaseDto) {
    const p = await this.pipelineOf(u.tenantId, dto.pipeline);
    const start = stageOf(p, p.start)!;
    if (!allows(u, start.roles)) throw new ForbiddenException(`Kasus ${p.label} hanya dibuka oleh peran ${start.roles.join('/')}`);
    if (dto.customerId && p.subject !== 'CUSTOMER') throw new BadRequestException('Alur ini tidak memakai pelanggan');
    if (dto.supplierId && p.subject !== 'SUPPLIER') throw new BadRequestException('Alur ini tidak memakai pemasok');
    if (dto.dueDate && toDocDate(dto.dueDate) < todayJakarta()) throw new BadRequestException('Tenggat tidak boleh di masa lalu');
    return this.db.transaction(async (tx) => {
      if (dto.customerId) {
        const [x] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, u.tenantId)));
        if (!x) throw new BadRequestException('Pelanggan tidak ditemukan');
      }
      if (dto.supplierId) {
        const [x] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, dto.supplierId), eq(suppliers.tenantId, u.tenantId)));
        if (!x) throw new BadRequestException('Pemasok tidak ditemukan');
      }
      const number = await this.seq.next(tx, u.tenantId, 'WORKFLOW_CASE', toDocDate(todayJakarta()));
      const [c] = await tx
        .insert(workflowCases)
        .values({ tenantId: u.tenantId, pipeline: p.key, number, title: dto.title.trim(), stage: p.start, customerId: dto.customerId ?? null, supplierId: dto.supplierId ?? null, amount: dto.amount ?? '0', dueDate: dto.dueDate ? toDocDate(dto.dueDate) : null, createdById: u.sub, stageEnteredById: u.sub })
        .returning();
      await this.event(tx, u.tenantId, c.id, { kind: 'CREATE', to: p.start, by: u.sub });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'WorkflowCase', entityId: c.id, data: { number, pipeline: p.key } });
      return c;
    });
  }

  private async lock(tx: Tx, tenantId: string, id: string) {
    const [c] = await tx.select().from(workflowCases).where(and(eq(workflowCases.id, id), eq(workflowCases.tenantId, tenantId))).for('update');
    if (!c) throw new NotFoundException('Kasus tidak ditemukan');
    if (c.status !== 'ACTIVE') throw new BadRequestException(c.status === 'DONE' ? 'Kasus sudah selesai dan tidak bisa diubah' : 'Kasus sudah dibatalkan dan tidak bisa diubah');
    return c;
  }

  private async setStage(tx: Tx, c: CaseRow, p: WorkflowPipeline, to: WorkflowStage, by: string | null, e: { kind: string; note?: string; auto?: boolean }) {
    const done = to.terminal === 'DONE';
    const status: CaseRow['status'] = to.key === 'BATAL' ? 'CANCELLED' : done ? 'DONE' : 'ACTIVE';
    await tx.update(workflowCases).set({ stage: to.key, status, stageEnteredAt: new Date(), stageEnteredById: by, closedAt: status === 'ACTIVE' ? null : new Date() }).where(eq(workflowCases.id, c.id));
    await this.event(tx, c.tenantId, c.id, { kind: e.kind, from: c.stage, to: to.key, note: e.note, by: by ?? undefined, auto: e.auto });
    c.stage = to.key;
    c.status = status;
    c.stageEnteredById = by;
  }

  async addLink(u: AuthUser, id: string, dto: AddLinkDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      const p = await this.pipelineOf(u.tenantId, c.pipeline);
      if (!allows(u, [...new Set(p.stages.flatMap((s) => s.roles))])) throw new ForbiddenException('Peran Anda tidak terlibat di alur ini');
      if (!p.links.includes(dto.type)) throw new BadRequestException(`${WORKFLOW_LINK_LABELS[dto.type]} tidak dipakai di alur ini`);
      const src = SOURCES[dto.type];
      const r = await tx.execute<{ number: string; status: string }>(sql.raw(`SELECT ${src.number('t')} AS number, ${src.status('t')} AS status FROM "${src.table}" t WHERE t.tenant_id = '${u.tenantId}' AND t.id = '${dto.docId}'`));
      const doc = r.rows[0];
      if (!doc) throw new BadRequestException('Dokumen tidak ditemukan di perusahaan ini');
      if (DEAD.has(doc.status)) throw new BadRequestException('Dokumen yang dibatalkan tidak bisa ditautkan');
      const used = await tx.execute(sql`SELECT 1 FROM workflow_links WHERE tenant_id = ${u.tenantId} AND link_type = ${dto.type} AND doc_id = ${dto.docId}`);
      if (used.rows.length) throw new BadRequestException(`${WORKFLOW_LINK_LABELS[dto.type]} ${doc.number} sudah dipakai kasus lain`);
      await tx.insert(workflowLinks).values({ tenantId: u.tenantId, caseId: id, linkType: dto.type, docId: dto.docId, docNumber: doc.number, createdById: u.sub });
      await this.event(tx, u.tenantId, id, { kind: 'LINK', note: `${WORKFLOW_LINK_LABELS[dto.type]} ${doc.number}`, by: u.sub });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'LINK', entity: 'WorkflowCase', entityId: id, data: { type: dto.type, doc: doc.number } });
      await this.autoAdvance(tx, c, p);
    });
    // hasil ada di get()
  }

  async advance(u: AuthUser, id: string, dto: AdvanceDto) {
    await this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      const p = await this.pipelineOf(u.tenantId, c.pipeline);
      const cur = stageOf(p, c.stage)!;
      if (dto.to === 'BATAL') throw new BadRequestException('Untuk membatalkan kasus pakai tombol Batalkan');
      if (!cur.next.includes(dto.to)) throw new BadRequestException(`Dari tahap "${cur.label}" kasus tidak bisa langsung ke "${dto.to}"`);
      const to = stageOf(p, dto.to)!;
      const links = await this.liveLinks(tx, u.tenantId, id);
      const blocked = this.reasonsBlocked(u, p, c, to, links, c.stageEnteredById, dto.note);
      if (blocked.length) throw new BadRequestException(blocked.join('; '));
      await this.setStage(tx, c, p, to, u.sub, { kind: 'ADVANCE', note: dto.note?.trim() });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'ADVANCE', entity: 'WorkflowCase', entityId: id, data: { from: cur.key, to: to.key, note: dto.note } });
      await this.autoAdvance(tx, c, p);
    });
    return this.get(u, id);
  }

  /** Kembali ke tahap sebelumnya untuk dikerjakan ulang: hanya Admin/Pemilik, wajib alasan */
  async back(u: AuthUser, id: string, dto: NoteDto) {
    if (u.role !== 'OWNER' && u.role !== 'ADMIN') throw new ForbiddenException('Hanya Admin / Pemilik yang dapat mengembalikan kasus ke tahap sebelumnya');
    await this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      const p = await this.pipelineOf(u.tenantId, c.pipeline);
      const [prev] = await tx.select().from(workflowEvents).where(and(eq(workflowEvents.caseId, id), eq(workflowEvents.toStage, c.stage))).orderBy(desc(workflowEvents.id)).limit(1);
      if (!prev?.fromStage) throw new BadRequestException('Kasus ini belum punya tahap sebelumnya');
      const to = stageOf(p, prev.fromStage)!;
      await this.setStage(tx, c, p, to, u.sub, { kind: 'BACK', note: dto.note.trim() });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'BACK', entity: 'WorkflowCase', entityId: id, data: { to: to.key, note: dto.note } });
    });
    return this.get(u, id);
  }

  async cancel(u: AuthUser, id: string, dto: NoteDto) {
    await this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      const p = await this.pipelineOf(u.tenantId, c.pipeline);
      const to = stageOf(p, 'BATAL');
      if (!to) throw new BadRequestException('Alur ini tidak bisa dibatalkan');
      if (!allows(u, to.roles)) throw new ForbiddenException(`Hanya peran ${to.roles.join('/')} yang dapat membatalkan kasus`);
      await this.setStage(tx, c, p, to, u.sub, { kind: 'CANCEL', note: dto.note.trim() });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'WorkflowCase', entityId: id, data: { note: dto.note } });
    });
    return this.get(u, id);
  }

  /**
   * Maju otomatis selama ada tahap berikutnya yang BUKTINYA sudah ada di dokumen terkait (mis. faktur lunas).
   * Tahap yang butuh catatan/keputusan manusia tidak pernah dilompati.
   */
  private async autoAdvance(tx: Tx, c: CaseRow, p: WorkflowPipeline) {
    for (let guard = 0; guard < 12 && c.status === 'ACTIVE'; guard++) {
      const cur = stageOf(p, c.stage)!;
      const links = await this.liveLinks(tx, c.tenantId, c.id);
      const next = cur.next
        .filter((k) => k !== 'BATAL')
        .map((k) => stageOf(p, k)!)
        .find((s) => !s.requireNote && !!s.auto?.length && (s.requireLink ?? []).every((t) => links.some((l) => l.type === t && !l.dead)) && s.auto.some((r) => links.some((l) => l.type === r.link && !l.dead && l.status && r.status.includes(l.status))));
      if (!next) return;
      await this.setStage(tx, c, p, next, null, { kind: 'AUTO', note: 'Maju otomatis dari status dokumen terkait', auto: true });
    }
  }

  /** Cek semua kasus aktif: yang buktinya sudah ada di dokumen maju otomatis */
  async refresh(u: AuthUser): Promise<number> {
    const model = await this.settings.businessModel(this.db, u.tenantId);
    const rows = await this.db.select({ id: workflowCases.id }).from(workflowCases).where(and(eq(workflowCases.tenantId, u.tenantId), eq(workflowCases.status, 'ACTIVE'))).limit(300);
    let moved = 0;
    for (const r of rows) {
      await this.db.transaction(async (tx) => {
        const [c] = await tx.select().from(workflowCases).where(eq(workflowCases.id, r.id)).for('update');
        if (!c || c.status !== 'ACTIVE') return;
        const p = WORKFLOW_PIPELINE_BY_KEY[c.pipeline];
        if (!p || p.model !== model) return;
        const before = c.stage;
        await this.autoAdvance(tx, c, p);
        if (c.stage !== before) {
          moved++;
          await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'AUTO', entity: 'WorkflowCase', entityId: c.id, data: { from: before, to: c.stage } });
        }
      });
    }
    return moved;
  }
}

const ACT = ['ADMIN', 'FINANCE', 'SALES', 'PURCHASING', 'WAREHOUSE', 'CASHIER'] as const;

@ApiTags('Alur kerja')
@ApiBearerAuth()
@Roles(...ACT, 'ACCOUNTANT')
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly svc: WorkflowService) {}

  @Get('pipelines')
  pipelines(@CurrentUser() u: AuthUser) {
    return this.svc.pipelines(u);
  }
  @Get('cases')
  cases(@CurrentUser() u: AuthUser, @Query() q: CaseQueryDto) {
    return this.svc.list(u, q);
  }
  @Get('alerts')
  alerts(@CurrentUser() u: AuthUser) {
    return this.svc.alerts(u);
  }
  @Get('candidates')
  candidates(@CurrentUser() u: AuthUser, @Query('type') type: WorkflowLinkType) {
    return this.svc.candidates(u, type);
  }
  @Get('cases/:id')
  one(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
  @Roles(...ACT)
  @Post('cases')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCaseDto) {
    return this.svc.create(u, dto);
  }
  @Roles(...ACT)
  @Post('cases/:id/links')
  async link(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddLinkDto) {
    await this.svc.addLink(u, id, dto);
    return this.svc.get(u, id);
  }
  @Roles(...ACT)
  @Post('cases/:id/advance')
  advance(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdvanceDto) {
    return this.svc.advance(u, id, dto);
  }
  @Roles('ADMIN')
  @Post('cases/:id/back')
  back(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.svc.back(u, id, dto);
  }
  @Roles('ADMIN')
  @Post('cases/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.svc.cancel(u, id, dto);
  }
}

@Module({ controllers: [WorkflowController], providers: [WorkflowService] })
export class WorkflowModule {}

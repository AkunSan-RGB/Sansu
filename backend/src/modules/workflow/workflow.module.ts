/**
 * Alur kerja operasional per jenis usaha. Definisi tahap ada di shared/src/workflow.ts; di sini mesin yang menjalankannya:
 *  - hanya pipeline milik jenis usaha perusahaan itu yang bisa dipakai (jenis usaha dikunci, jadi alurnya tidak tercampur)
 *  - kasus hanya maju satu tahap sesuai urutan, oleh peran yang berhak; tidak bisa loncat atau mundur diam-diam
 *  - syarat tahap: dokumen terkait yang nyata (milik perusahaan ini, tidak dibatalkan), catatan/bukti, dan pemeriksa berbeda (SoD)
 *  - kasus dibuka OTOMATIS dari dokumen baru (pesanan, pembelian, sesi kasir, produksi, ...) dan dari stok di bawah minimum;
 *    dokumen turunan (faktur, surat jalan, penerimaan, tagihan) tertaut otomatis; tahap yang buktinya ada di dokumen maju otomatis
 *  - perusahaan boleh MEMPERKETAT alur (peran, catatan wajib, pemeriksa berbeda, batas hari, nama tahap), tidak boleh melonggarkan
 *  - gerbang opsional di dokumen berisiko (mis. bayar tagihan pemasok sebelum barang diterima)
 *  - satu dokumen hanya boleh dipakai satu kasus; kasus selesai/batal tidak bisa diubah lagi; semua langkah tercatat
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Global, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsNumberString, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  effectivePipelines, pipelinesFor, stageOf, validateWorkflowOverrides, WORKFLOW_LINK_LABELS, WORKFLOW_LINK_TYPES,
  type WorkflowLinkType, type WorkflowOverrides, type WorkflowPipeline, type WorkflowStage,
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
type Source = { table: string; number: (a: string) => string; status: (a: string) => string; created: string };
const src = (table: string, number = 'number', status: (a: string) => string = col('status'), created = 'created_at'): Source => ({ table, number: col(number), status, created });
const SOURCES: Record<WorkflowLinkType, Source> = {
  QUOTATION: src('quotations'),
  SALES_ORDER: src('sales_orders'),
  DELIVERY_ORDER: src('delivery_orders'),
  INVOICE: src('invoices'),
  PURCHASE_ORDER: src('purchase_orders'),
  GOODS_RECEIPT: src('goods_receipts'),
  PURCHASE_INVOICE: src('purchase_invoices', 'number', (a) => `(CASE WHEN ${a}.paid_amount >= ${a}.total THEN 'PAID' WHEN ${a}.paid_amount > 0 THEN 'PARTIAL' ELSE 'UNPAID' END)`),
  PRODUCTION_ORDER: src('production_orders'),
  PROJECT: src('projects', 'code'),
  POS_SESSION: src('pos_sessions', 'number', col('status'), 'opened_at'),
  PRINCIPAL_CLAIM: src('principal_claims'),
  CANVASS: src('canvass_collections'),
  STOCK_TRANSFER: src('stock_transfers'),
  SALES_RETURN: src('sales_returns', 'number', () => `'POSTED'`),
  PURCHASE_RETURN: src('purchase_returns', 'number', () => `'POSTED'`),
  POS_TAB: src('pos_tabs'),
};
const DEAD = new Set(['CANCELLED', 'REJECTED', 'VOID']);

/** Dokumen turunan yang otomatis ditautkan ke kasus bila dokumen induknya sudah tertaut (id dokumen berasal dari DB, bukan input) */
const FOLLOW: Partial<Record<WorkflowLinkType, { to: WorkflowLinkType; ids: (tenant: string, id: string) => string }[]>> = {
  QUOTATION: [{ to: 'SALES_ORDER', ids: (t, id) => `SELECT sales_order_id AS id FROM quotations WHERE tenant_id = '${t}' AND id = '${id}' AND sales_order_id IS NOT NULL` }],
  SALES_ORDER: [
    { to: 'INVOICE', ids: (t, id) => `SELECT id FROM invoices WHERE tenant_id = '${t}' AND sales_order_id = '${id}'` },
    { to: 'DELIVERY_ORDER', ids: (t, id) => `SELECT id FROM delivery_orders WHERE tenant_id = '${t}' AND sales_order_id = '${id}'` },
  ],
  PURCHASE_ORDER: [
    { to: 'GOODS_RECEIPT', ids: (t, id) => `SELECT id FROM goods_receipts WHERE tenant_id = '${t}' AND purchase_order_id = '${id}'` },
    { to: 'PURCHASE_INVOICE', ids: (t, id) => `SELECT id FROM purchase_invoices WHERE tenant_id = '${t}' AND purchase_order_id = '${id}'` },
  ],
};

/** Gerbang di dokumen berisiko (bila "Alur wajib" dinyalakan): aksi hanya boleh bila kasus sudah mencapai tahap ini */
const GATES = {
  // tagihan bisa belum tertaut sendiri; kasusnya dicari juga lewat pesanan pembelian induknya
  PAY_SUPPLIER: { link: 'PURCHASE_INVOICE' as WorkflowLinkType, stage: 'DITERIMA', what: 'membayar tagihan pemasok', viaPo: true },
  START_PRODUCTION: { link: 'PRODUCTION_ORDER' as WorkflowLinkType, stage: 'MATERIAL_SIAP', what: 'memulai produksi', viaPo: false },
  // hasil produksi tidak boleh dicatat selesai sebelum pemeriksaan mutu (QC) oleh orang lain
  COMPLETE_PRODUCTION: { link: 'PRODUCTION_ORDER' as WorkflowLinkType, stage: 'QC', what: 'menyelesaikan produksi', viaPo: false },
  // barang tidak keluar gudang bila pesanan belum disetujui atau piutang pelanggan sudah melebihi batas kredit
  DELIVER: { link: 'SALES_ORDER' as WorkflowLinkType, stage: 'DISETUJUI', what: 'mengirim barang', viaPo: false },
};
export type WorkflowGateAction = keyof typeof GATES;

interface WorkflowSettings {
  autoOpen: boolean;
  enforce: boolean;
  since: string | null;
  overrides: WorkflowOverrides;
}
const DEFAULT_SETTINGS: WorkflowSettings = { autoOpen: true, enforce: false, since: null, overrides: {} };

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
export class WorkflowSettingsDto {
  @ApiPropertyOptional({ description: 'Buka kasus otomatis dari dokumen baru dan stok di bawah minimum' }) @IsOptional() @IsBoolean() autoOpen?: boolean;
  @ApiPropertyOptional({ description: 'Alur wajib: dokumen berisiko (bayar tagihan pemasok, mulai produksi) diblokir bila tahap alur belum tercapai' }) @IsOptional() @IsBoolean() enforce?: boolean;
  @ApiPropertyOptional({ description: 'Penyesuaian tahap per alur — hanya boleh memperketat' }) @IsOptional() @IsObject() overrides?: WorkflowOverrides;
}

type CaseRow = typeof workflowCases.$inferSelect;
const allows = (u: { role: string }, roles: string[]) => u.role === 'OWNER' || roles.includes(u.role);
type LiveLink = { id: string; type: WorkflowLinkType; docId: string; number: string; status: string | null; dead: boolean };

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger('AlurKerja');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  // ---------- pengaturan & definisi ----------
  async cfg(tenantId: string): Promise<WorkflowSettings> {
    const s = await this.settings.section(this.db, tenantId, 'workflow', DEFAULT_SETTINGS);
    if (s.since) return s;
    // pertama kali: kasus otomatis hanya untuk dokumen yang dibuat sejak hari ini (riwayat lama tidak dibanjiri)
    return this.settings.saveSection(this.db, tenantId, 'workflow', DEFAULT_SETTINGS, { since: todayJakarta() });
  }

  private async defs(tenantId: string): Promise<WorkflowPipeline[]> {
    const model = await this.settings.businessModel(this.db, tenantId);
    return effectivePipelines(model, (await this.cfg(tenantId)).overrides);
  }

  private async pipelineOf(tenantId: string, key: string): Promise<WorkflowPipeline> {
    const p = (await this.defs(tenantId)).find((x) => x.key === key);
    // jenis usaha dikunci per perusahaan, jadi alur jenis usaha lain tidak pernah bisa dipakai
    if (!p) throw new BadRequestException('Alur kerja ini bukan untuk jenis usaha perusahaan Anda');
    return p;
  }

  async getSettings(u: AuthUser) {
    const model = await this.settings.businessModel(this.db, u.tenantId);
    return { settings: await this.cfg(u.tenantId), defaults: pipelinesFor(model) };
  }

  async saveSettings(u: AuthUser, dto: WorkflowSettingsDto) {
    const model = await this.settings.businessModel(this.db, u.tenantId);
    const before = await this.cfg(u.tenantId);
    let overrides = before.overrides;
    if (dto.overrides !== undefined) {
      const errs = validateWorkflowOverrides(model, dto.overrides);
      if (errs.length) throw new BadRequestException(errs.join('; '));
      overrides = {};
      for (const [k, stages] of Object.entries(dto.overrides)) {
        const kept = Object.fromEntries(Object.entries(stages).filter(([, o]) => Object.keys(o).length));
        if (Object.keys(kept).length) overrides[k] = kept;
      }
    }
    const saved = await this.settings.saveSection(this.db, u.tenantId, 'workflow', DEFAULT_SETTINGS, { autoOpen: dto.autoOpen, enforce: dto.enforce, overrides });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'WorkflowSettings', entityId: u.tenantId, data: { before: { autoOpen: before.autoOpen, enforce: before.enforce, overrides: before.overrides }, after: { autoOpen: saved.autoOpen, enforce: saved.enforce, overrides: saved.overrides } } });
    return this.getSettings(u);
  }

  // ---------- baca ----------
  /** Status terkini semua dokumen yang ditautkan ke kasus (dibaca dari tabel sumber, tidak disalin) */
  private async liveLinks(db: DbOrTx, tenantId: string, caseId: string): Promise<LiveLink[]> {
    const links = await db.select().from(workflowLinks).where(and(eq(workflowLinks.caseId, caseId), eq(workflowLinks.tenantId, tenantId))).orderBy(asc(workflowLinks.createdAt));
    const out: LiveLink[] = [];
    for (const l of links) {
      const s = SOURCES[l.linkType as WorkflowLinkType];
      const r = await db.execute<{ number: string; status: string }>(sql.raw(`SELECT ${s.number('t')} AS number, ${s.status('t')} AS status FROM "${s.table}" t WHERE t.tenant_id = '${tenantId}' AND t.id = '${l.docId}'`));
      const row = r.rows[0];
      out.push({ id: l.id, type: l.linkType as WorkflowLinkType, docId: l.docId, number: row?.number ?? l.docNumber, status: row?.status ?? null, dead: !row || DEAD.has(row.status) });
    }
    return out;
  }

  private reasonsBlocked(u: { role: string; sub: string }, to: WorkflowStage, links: LiveLink[], lastMoverId: string | null, note?: string): string[] {
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

  async pipelines(u: AuthUser) {
    const counts = await this.db.execute<{ pipeline: string; stage: string; n: number }>(sql`SELECT pipeline, stage, COUNT(*)::int AS n FROM workflow_cases WHERE tenant_id = ${u.tenantId} AND status = 'ACTIVE' GROUP BY pipeline, stage`);
    return (await this.defs(u.tenantId)).map((p) => ({
      ...p,
      stages: p.stages.map((s) => ({ ...s, count: counts.rows.find((c) => c.pipeline === p.key && c.stage === s.key)?.n ?? 0 })),
    }));
  }

  async list(u: AuthUser, q: CaseQueryDto) {
    await this.sweep(u.tenantId, u.sub);
    const keys = (await this.defs(u.tenantId)).map((p) => p.key);
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.pipeline, c.number, c.title, c.stage, c.status, c.amount, c.due_date::text AS "dueDate", c.stage_entered_at AS "stageEnteredAt", c.created_at AS "createdAt", c.auto_opened AS "autoOpened",
             cu.name AS "customerName", su.name AS "supplierName",
             (SELECT COUNT(*)::int FROM workflow_links l WHERE l.case_id = c.id) AS "linkCount"
      FROM workflow_cases c LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN suppliers su ON su.id = c.supplier_id
      WHERE c.tenant_id = ${u.tenantId} AND c.pipeline = ANY(${sql.raw(`ARRAY[${keys.map((k) => `'${k}'`).join(',')}]::text[]`)})
        ${q.pipeline ? sql`AND c.pipeline = ${q.pipeline}` : sql``} ${q.status ? sql`AND c.status = ${q.status}` : sql``}
      ORDER BY c.created_at DESC LIMIT 300`);
    return rows.rows;
  }

  async get(u: AuthUser, id: string) {
    await this.refreshCase(u.tenantId, id);
    const [c] = await this.db.select().from(workflowCases).where(and(eq(workflowCases.id, id), eq(workflowCases.tenantId, u.tenantId)));
    if (!c) throw new NotFoundException('Kasus tidak ditemukan');
    const p = await this.pipelineOf(u.tenantId, c.pipeline);
    const links = await this.liveLinks(this.db, u.tenantId, id);
    const events = await this.db.execute<Record<string, unknown>>(sql`
      SELECT e.id, e.kind, e.from_stage AS "fromStage", e.to_stage AS "toStage", e.note, e.auto, e.at, us.name AS "byName"
      FROM workflow_events e LEFT JOIN users us ON us.id = e.by_id WHERE e.tenant_id = ${u.tenantId} AND e.case_id = ${id} ORDER BY e.id`);
    const cur = stageOf(p, c.stage)!;
    const moves = c.status === 'ACTIVE'
      ? cur.next.filter((k) => k !== 'BATAL').map((k) => {
          const to = stageOf(p, k)!;
          return { to: k, label: to.label, needsNote: !!to.requireNote, blocked: this.reasonsBlocked(u, to, links, c.stageEnteredById, 'x'.repeat(5)).filter((r) => !r.startsWith('Isi catatan')) };
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

  /** Tahap alur sebuah dokumen (untuk lencana di halaman dokumen) */
  async byDoc(u: AuthUser, type: WorkflowLinkType, docId: string) {
    if (!SOURCES[type]) throw new BadRequestException('Jenis dokumen tidak dikenal');
    const r = await this.db.execute<{ id: string; number: string; stage: string; status: string; pipeline: string }>(sql`
      SELECT c.id, c.number, c.stage, c.status, c.pipeline FROM workflow_links l JOIN workflow_cases c ON c.id = l.case_id
      WHERE l.tenant_id = ${u.tenantId} AND l.link_type = ${type} AND l.doc_id = ${docId} LIMIT 1`);
    const row = r.rows[0];
    if (!row) return null;
    const p = (await this.defs(u.tenantId)).find((x) => x.key === row.pipeline);
    return { caseId: row.id, number: row.number, status: row.status, stage: row.stage, stageLabel: (p && stageOf(p, row.stage)?.label) ?? row.stage, pipelineLabel: p?.label ?? row.pipeline };
  }

  /** Dokumen yang bisa ditautkan: milik perusahaan ini, belum dipakai kasus lain, belum dibatalkan */
  async candidates(u: AuthUser, type: WorkflowLinkType) {
    const s = SOURCES[type];
    if (!s) throw new BadRequestException('Jenis dokumen tidak dikenal');
    const r = await this.db.execute<{ id: string; number: string; status: string }>(sql.raw(`
      SELECT d.id, ${s.number('d')} AS number, ${s.status('d')} AS status FROM "${s.table}" d
      WHERE d.tenant_id = '${u.tenantId}' AND NOT EXISTS (SELECT 1 FROM workflow_links l WHERE l.tenant_id = d.tenant_id AND l.link_type = '${type}' AND l.doc_id = d.id)
      ORDER BY d."${s.created}" DESC LIMIT 50`));
    return r.rows.filter((x) => !DEAD.has(x.status));
  }

  /** Piutang berjalan pelanggan (setelah retur) dan batas kreditnya */
  private async creditPosition(tenantId: string, customerId: string) {
    const r = await this.db.execute<{ lim: string; ar: string }>(sql`
      SELECT cu.credit_limit AS lim, COALESCE((SELECT SUM(i.total - i.paid_amount - i.returned_amount) FROM invoices i WHERE i.tenant_id = cu.tenant_id AND i.customer_id = cu.id AND i.status <> 'PAID'), 0) AS ar
      FROM customers cu WHERE cu.id = ${customerId} AND cu.tenant_id = ${tenantId}`);
    return { limit: Number(r.rows[0]?.lim ?? 0), ar: Number(r.rows[0]?.ar ?? 0) };
  }

  async alerts(u: AuthUser) {
    const defs = await this.defs(u.tenantId);
    const out: { kind: string; severity: 'warn' | 'info'; caseId: string; number: string; message: string }[] = [];
    const rows = await this.db.select().from(workflowCases).where(and(eq(workflowCases.tenantId, u.tenantId), eq(workflowCases.status, 'ACTIVE')));
    const today = Date.now();
    const rp = (v: number) => `Rp${Math.round(v).toLocaleString('id-ID')}`;
    for (const c of rows) {
      const p = defs.find((x) => x.key === c.pipeline);
      if (!p) continue;
      const s = stageOf(p, c.stage);
      if (s?.slaDays) {
        const days = Math.floor((today - c.stageEnteredAt.getTime()) / 86400000);
        if (days > s.slaDays) out.push({ kind: 'MACET', severity: 'warn', caseId: c.id, number: c.number, message: `${c.number} · ${c.title}: ${days} hari di tahap "${s.label}" (batas ${s.slaDays} hari)` });
      }
      if (c.dueDate && c.dueDate < todayJakarta()) out.push({ kind: 'LEWAT_TEMPO', severity: 'warn', caseId: c.id, number: c.number, message: `${c.number} · ${c.title}: tenggat ${c.dueDate} sudah lewat` });
      const links = await this.liveLinks(this.db, u.tenantId, c.id);
      for (const l of links) {
        if (l.dead) out.push({ kind: 'DOKUMEN_BATAL', severity: 'warn', caseId: c.id, number: c.number, message: `${c.number} · ${c.title}: ${WORKFLOW_LINK_LABELS[l.type]} ${l.number} dibatalkan / hilang — periksa kasus ini` });
      }
      // Dagang/FMCG: piutang pelanggan melebihi batas kredit saat kasus masih berjalan
      if (c.customerId) {
        const { limit: lim, ar } = await this.creditPosition(u.tenantId, c.customerId);
        if (lim > 0 && ar > lim) out.push({ kind: 'KREDIT', severity: 'warn', caseId: c.id, number: c.number, message: `${c.number} · ${c.title}: piutang pelanggan ${rp(ar)} melebihi batas kredit ${rp(lim)}` });
      }
      // Dagang/Ritel/FMCG: faktur terjual di bawah harga pokok (rugi) — perlu dicek harga, diskon, atau salah input
      for (const l of links.filter((x) => x.type === 'INVOICE' && !x.dead)) {
        const r = await this.db.execute<{ n: number; loss: string }>(sql`
          SELECT COUNT(*)::int AS n, COALESCE(SUM((il.unit_cost * il.uom_factor - il.line_total / NULLIF(il.qty, 0)) * il.qty), 0) AS loss
          FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
          WHERE i.id = ${l.docId} AND i.tenant_id = ${u.tenantId} AND il.qty > 0 AND il.unit_cost > 0 AND il.line_total / il.qty < il.unit_cost * il.uom_factor`);
        if (r.rows[0]?.n) out.push({ kind: 'JUAL_RUGI', severity: 'warn', caseId: c.id, number: c.number, message: `${c.number} · ${c.title}: ${r.rows[0].n} baris di faktur ${l.number} dijual di bawah harga pokok (rugi sekitar ${rp(Number(r.rows[0].loss))})` });
      }
      // Ritel/F&B: selisih kas pada sesi kasir
      const sess = links.find((l) => l.type === 'POS_SESSION' && !l.dead);
      if (sess) {
        const r = await this.db.execute<{ difference: string | null }>(sql`SELECT difference FROM pos_sessions WHERE id = ${sess.docId} AND tenant_id = ${u.tenantId}`);
        const diff = Number(r.rows[0]?.difference ?? 0);
        if (diff !== 0) out.push({ kind: 'SELISIH_KAS', severity: 'warn', caseId: c.id, number: c.number, message: `${c.number} · ${c.title}: selisih kas ${rp(diff)} pada sesi ${sess.number} — periksa saat menghitung ulang uang` });
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
      return this.insertCase(tx, u.tenantId, u.sub, p, { title: dto.title.trim(), customerId: dto.customerId, supplierId: dto.supplierId, amount: dto.amount, dueDate: dto.dueDate ? toDocDate(dto.dueDate) : undefined });
    });
  }

  private async insertCase(tx: Tx, tenantId: string, actor: string, p: WorkflowPipeline, v: { title: string; customerId?: string | null; supplierId?: string | null; amount?: string; dueDate?: string; refKey?: string; auto?: boolean }) {
    const number = await this.seq.next(tx, tenantId, 'WORKFLOW_CASE', toDocDate(todayJakarta()));
    const [c] = await tx
      .insert(workflowCases)
      .values({ tenantId, pipeline: p.key, number, title: v.title, stage: p.start, customerId: v.customerId ?? null, supplierId: v.supplierId ?? null, amount: v.amount ?? '0', dueDate: v.dueDate ?? null, createdById: actor, stageEnteredById: v.auto ? null : actor, refKey: v.refKey ?? null, autoOpened: !!v.auto })
      .returning();
    await this.event(tx, tenantId, c.id, { kind: 'CREATE', to: p.start, by: v.auto ? undefined : actor, auto: v.auto, note: v.auto ? 'Dibuka otomatis' : undefined });
    await this.audit.log(tx, { tenantId, userId: actor, action: 'CREATE', entity: 'WorkflowCase', entityId: c.id, data: { number, pipeline: p.key, auto: !!v.auto } });
    return c;
  }

  private async lock(tx: Tx, tenantId: string, id: string) {
    const [c] = await tx.select().from(workflowCases).where(and(eq(workflowCases.id, id), eq(workflowCases.tenantId, tenantId))).for('update');
    if (!c) throw new NotFoundException('Kasus tidak ditemukan');
    if (c.status !== 'ACTIVE') throw new BadRequestException(c.status === 'DONE' ? 'Kasus sudah selesai dan tidak bisa diubah' : 'Kasus sudah dibatalkan dan tidak bisa diubah');
    return c;
  }

  private async setStage(tx: Tx, c: CaseRow, to: WorkflowStage, by: string | null, e: { kind: string; note?: string; auto?: boolean }) {
    const done = to.terminal === 'DONE';
    const status: CaseRow['status'] = to.key === 'BATAL' ? 'CANCELLED' : done ? 'DONE' : 'ACTIVE';
    await tx.update(workflowCases).set({ stage: to.key, status, stageEnteredAt: new Date(), stageEnteredById: by, closedAt: status === 'ACTIVE' ? null : new Date() }).where(eq(workflowCases.id, c.id));
    await this.event(tx, c.tenantId, c.id, { kind: e.kind, from: c.stage, to: to.key, note: e.note, by: by ?? undefined, auto: e.auto });
    c.stage = to.key;
    c.status = status;
    c.stageEnteredById = by;
  }

  async addLink(u: AuthUser, id: string, dto: AddLinkDto) {
    await this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      const p = await this.pipelineOf(u.tenantId, c.pipeline);
      if (!allows(u, [...new Set(p.stages.flatMap((s) => s.roles))])) throw new ForbiddenException('Peran Anda tidak terlibat di alur ini');
      if (!p.links.includes(dto.type)) throw new BadRequestException(`${WORKFLOW_LINK_LABELS[dto.type]} tidak dipakai di alur ini`);
      const s = SOURCES[dto.type];
      const r = await tx.execute<{ number: string; status: string }>(sql.raw(`SELECT ${s.number('t')} AS number, ${s.status('t')} AS status FROM "${s.table}" t WHERE t.tenant_id = '${u.tenantId}' AND t.id = '${dto.docId}'`));
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
  }

  async advance(u: AuthUser, id: string, dto: AdvanceDto) {
    await this.db.transaction(async (tx) => {
      const c = await this.lock(tx, u.tenantId, id);
      const p = await this.pipelineOf(u.tenantId, c.pipeline);
      const cur = stageOf(p, c.stage)!;
      if (dto.to === 'BATAL') throw new BadRequestException('Untuk membatalkan kasus pakai tombol Batalkan');
      if (!cur.next.includes(dto.to)) throw new BadRequestException(`Dari tahap "${cur.label}" kasus tidak bisa langsung ke "${dto.to}"`);
      const to = stageOf(p, dto.to)!;
      await this.followLinks(tx, c, p);
      const links = await this.liveLinks(tx, u.tenantId, id);
      const blocked = this.reasonsBlocked(u, to, links, c.stageEnteredById, dto.note);
      if (blocked.length) throw new BadRequestException(blocked.join('; '));
      await this.setStage(tx, c, to, u.sub, { kind: 'ADVANCE', note: dto.note?.trim() });
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
      await this.setStage(tx, c, to, u.sub, { kind: 'BACK', note: dto.note.trim() });
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
      await this.setStage(tx, c, to, u.sub, { kind: 'CANCEL', note: dto.note.trim() });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'WorkflowCase', entityId: id, data: { note: dto.note } });
    });
    return this.get(u, id);
  }

  // ---------- otomatisasi ----------
  /** Tautkan dokumen turunan (faktur, surat jalan, penerimaan, tagihan, ...) dari dokumen yang sudah tertaut */
  private async followLinks(tx: Tx, c: CaseRow, p: WorkflowPipeline) {
    for (const l of await tx.select().from(workflowLinks).where(and(eq(workflowLinks.caseId, c.id), eq(workflowLinks.tenantId, c.tenantId)))) {
      for (const f of FOLLOW[l.linkType as WorkflowLinkType] ?? []) {
        if (!p.links.includes(f.to)) continue;
        const found = await tx.execute<{ id: string | null }>(sql.raw(f.ids(c.tenantId, l.docId)));
        for (const d of found.rows) {
          if (!d.id) continue;
          const s = SOURCES[f.to];
          const r = await tx.execute<{ number: string; status: string }>(sql.raw(`SELECT ${s.number('t')} AS number, ${s.status('t')} AS status FROM "${s.table}" t WHERE t.tenant_id = '${c.tenantId}' AND t.id = '${d.id}'`));
          const doc = r.rows[0];
          if (!doc || DEAD.has(doc.status)) continue;
          const ins = await tx.execute(sql`INSERT INTO workflow_links (tenant_id, case_id, link_type, doc_id, doc_number, created_by_id) VALUES (${c.tenantId}, ${c.id}, ${f.to}, ${d.id}, ${doc.number}, ${c.createdById}) ON CONFLICT DO NOTHING RETURNING id`);
          if (ins.rows.length) await this.event(tx, c.tenantId, c.id, { kind: 'LINK', note: `${WORKFLOW_LINK_LABELS[f.to]} ${doc.number} (otomatis)`, auto: true });
        }
      }
    }
  }

  /**
   * Maju otomatis selama ada tahap berikutnya yang BUKTINYA sudah ada di dokumen terkait (mis. faktur lunas).
   * Tahap yang butuh catatan/keputusan manusia tidak pernah dilompati.
   */
  private async autoAdvance(tx: Tx, c: CaseRow, p: WorkflowPipeline) {
    for (let guard = 0; guard < 12 && c.status === 'ACTIVE'; guard++) {
      await this.followLinks(tx, c, p);
      const cur = stageOf(p, c.stage)!;
      const links = await this.liveLinks(tx, c.tenantId, c.id);
      const next = cur.next
        .filter((k) => k !== 'BATAL' && p.stages.findIndex((x) => x.key === k) > p.stages.findIndex((x) => x.key === cur.key)) // otomatis hanya maju, tidak pernah mundur (mis. QC → Produksi)
        .map((k) => stageOf(p, k)!)
        .find((s) => !s.requireNote && !!s.auto?.length && (s.requireLink ?? []).every((t) => links.some((l) => l.type === t && !l.dead)) && s.auto.some((r) => links.some((l) => l.type === r.link && !l.dead && l.status && r.status.includes(l.status))));
      if (!next) return;
      await this.setStage(tx, c, next, null, { kind: 'AUTO', note: 'Maju otomatis dari status dokumen terkait', auto: true });
    }
  }

  /** Kasus dibuka otomatis dari dokumen baru yang belum punya kasus (hanya dokumen sejak "since") */
  private async discoverDocs(tenantId: string, actor: string, defs: WorkflowPipeline[], since: string) {
    let opened = 0;
    for (const p of defs.filter((x) => x.open)) {
      const o = p.open!;
      const s = SOURCES[o.link];
      const subjectCol = o.subject === 'customer' ? 'd.customer_id' : o.subject === 'supplier' ? 'd.supplier_id' : 'NULL::uuid';
      const docs = await this.db.execute<{ id: string; number: string; status: string; subject_id: string | null }>(sql.raw(`
        SELECT d.id, ${s.number('d')} AS number, ${s.status('d')} AS status, ${subjectCol} AS subject_id FROM "${s.table}" d
        WHERE d.tenant_id = '${tenantId}' AND d."${s.created}"::date >= '${since}' ${o.where ? `AND ${o.where}` : ''}
          AND NOT EXISTS (SELECT 1 FROM workflow_links l WHERE l.tenant_id = d.tenant_id AND l.link_type = '${o.link}' AND l.doc_id = d.id)
        ORDER BY d."${s.created}" LIMIT 50`));
      for (const d of docs.rows.filter((x) => !DEAD.has(x.status))) {
        try {
          await this.db.transaction(async (tx) => {
            const c = await this.insertCase(tx, tenantId, actor, p, { title: `${o.label} ${d.number}`, customerId: o.subject === 'customer' ? d.subject_id : null, supplierId: o.subject === 'supplier' ? d.subject_id : null, auto: true });
            await tx.insert(workflowLinks).values({ tenantId, caseId: c.id, linkType: o.link, docId: d.id, docNumber: d.number, createdById: actor });
            await this.event(tx, tenantId, c.id, { kind: 'LINK', note: `${WORKFLOW_LINK_LABELS[o.link]} ${d.number} (otomatis)`, auto: true });
            await this.autoAdvance(tx, c, p);
          });
          opened++;
        } catch (e) {
          // dokumen yang sama diambil sweep lain bersamaan: abaikan (tautan dokumen unik)
          this.logger.debug(`Lewati ${o.link} ${d.number}: ${(e as Error).message}`);
        }
      }
    }
    return opened;
  }

  /** Restok otomatis: stok di bawah minimum membuka kasus; kasus yang belum dikerjakan ditutup bila stok sudah pulih */
  private async discoverRestock(tenantId: string, actor: string, defs: WorkflowPipeline[]) {
    const p = defs.find((x) => x.restock);
    if (!p) return 0;
    let opened = 0;
    // posisi stok = ada di gudang + sedang dipesan + sedang diminta; kasus hanya dibuka bila posisi ini masih di bawah minimum
    const low = await this.db.execute<{ product_id: string; warehouse_id: string; min_qty: string; qty: string; incoming: string; sku: string; name: string; supplier_id: string | null; supplier_name: string | null }>(sql`
      SELECT sm.product_id, sm.warehouse_id, sm.min_qty, COALESCE(sb.qty, 0) AS qty, COALESCE(po.qty, 0) + COALESCE(pr.qty, 0) AS incoming, pr0.sku, pr0.name, ls.supplier_id, ls.supplier_name
      FROM stock_minimums sm JOIN products pr0 ON pr0.id = sm.product_id AND pr0.tenant_id = sm.tenant_id AND pr0.is_active
      LEFT JOIN stock_balances sb ON sb.tenant_id = sm.tenant_id AND sb.product_id = sm.product_id AND sb.warehouse_id = sm.warehouse_id
      LEFT JOIN (SELECT l.product_id, o.warehouse_id, SUM((l.qty - l.received_qty) * l.uom_factor) AS qty
                 FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
                 WHERE o.tenant_id = ${tenantId} AND o.status IN ('DRAFT', 'CONFIRMED') AND l.qty > l.received_qty GROUP BY 1, 2) po ON po.product_id = sm.product_id AND po.warehouse_id = sm.warehouse_id
      LEFT JOIN (SELECT l.product_id, r.warehouse_id, SUM(l.qty * l.uom_factor) AS qty
                 FROM purchase_request_lines l JOIN purchase_requests r ON r.id = l.request_id
                 WHERE r.tenant_id = ${tenantId} AND r.status IN ('SUBMITTED', 'APPROVED') AND l.purchase_order_id IS NULL GROUP BY 1, 2) pr ON pr.product_id = sm.product_id AND pr.warehouse_id = sm.warehouse_id
      LEFT JOIN LATERAL (SELECT o.supplier_id, s.name AS supplier_name FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id JOIN suppliers s ON s.id = o.supplier_id
                         WHERE o.tenant_id = sm.tenant_id AND l.product_id = sm.product_id AND o.status <> 'CANCELLED' ORDER BY o.date DESC, o.created_at DESC LIMIT 1) ls ON true
      WHERE sm.tenant_id = ${tenantId} AND COALESCE(sb.qty, 0) + COALESCE(po.qty, 0) + COALESCE(pr.qty, 0) < sm.min_qty
        AND NOT EXISTS (SELECT 1 FROM workflow_cases c WHERE c.tenant_id = sm.tenant_id AND c.status = 'ACTIVE' AND c.ref_key = 'RESTOCK:' || sm.product_id || ':' || sm.warehouse_id)
      ORDER BY pr0.sku LIMIT 30`);
    for (const r of low.rows) {
      try {
        await this.db.transaction(async (tx) => {
          await this.insertCase(tx, tenantId, actor, p, { title: `Stok menipis: ${r.sku} ${r.name} (ada ${Number(r.qty)}, minimum ${Number(r.min_qty)}; disarankan pesan ${Math.max(1, Math.ceil(Number(r.min_qty) * 2 - Number(r.qty) - Number(r.incoming)))}${r.supplier_name ? `, pemasok terakhir ${r.supplier_name}` : ''})`, supplierId: p.subject === 'SUPPLIER' ? r.supplier_id : null, refKey: `RESTOCK:${r.product_id}:${r.warehouse_id}`, auto: true });
        });
        opened++;
      } catch {
        /* kunci kasus unik: sudah dibuka sweep lain */
      }
    }
    // stok sudah pulih dan belum ada dokumen: kasus ditutup
    const open = await this.db.select().from(workflowCases).where(and(eq(workflowCases.tenantId, tenantId), eq(workflowCases.status, 'ACTIVE'), eq(workflowCases.pipeline, p.key), sql`${workflowCases.refKey} LIKE 'RESTOCK:%'`));
    for (const c of open) {
      if (c.stage !== p.start) continue;
      const [, pid, wid] = (c.refKey ?? '').split(':');
      const r = await this.db.execute<{ ok: boolean; links: number }>(sql`
        SELECT (COALESCE((SELECT qty FROM stock_balances WHERE tenant_id = ${tenantId} AND product_id = ${pid}::uuid AND warehouse_id = ${wid}::uuid), 0)
                + COALESCE((SELECT SUM((l.qty - l.received_qty) * l.uom_factor) FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id WHERE o.tenant_id = ${tenantId} AND l.product_id = ${pid}::uuid AND o.warehouse_id = ${wid}::uuid AND o.status IN ('DRAFT', 'CONFIRMED') AND l.qty > l.received_qty), 0)
                >= COALESCE((SELECT min_qty FROM stock_minimums WHERE tenant_id = ${tenantId} AND product_id = ${pid}::uuid AND warehouse_id = ${wid}::uuid), 0)) AS ok,
               (SELECT COUNT(*)::int FROM workflow_links WHERE case_id = ${c.id}) AS links`);
      if (!r.rows[0]?.ok || r.rows[0].links > 0) continue;
      await this.db.transaction(async (tx) => {
        const [locked] = await tx.select().from(workflowCases).where(eq(workflowCases.id, c.id)).for('update');
        if (locked?.status !== 'ACTIVE' || locked.stage !== p.start) return;
        await this.setStage(tx, locked, stageOf(p, 'BATAL')!, null, { kind: 'CANCEL', note: 'Stok sudah di atas minimum; kasus ditutup otomatis', auto: true });
      });
    }
    return opened;
  }

  /** Satu putaran otomatisasi untuk satu perusahaan: buka kasus baru, tautkan dokumen turunan, majukan yang buktinya sudah ada */
  async sweep(tenantId: string, actor: string): Promise<{ opened: number; moved: number }> {
    const cfg = await this.cfg(tenantId);
    const defs = await this.defs(tenantId);
    let opened = 0;
    if (cfg.autoOpen && cfg.since) {
      opened += await this.discoverDocs(tenantId, actor, defs, cfg.since);
      opened += await this.discoverRestock(tenantId, actor, defs);
    }
    let moved = 0;
    const rows = await this.db.select({ id: workflowCases.id }).from(workflowCases).where(and(eq(workflowCases.tenantId, tenantId), eq(workflowCases.status, 'ACTIVE'))).limit(300);
    for (const r of rows) moved += await this.refreshCase(tenantId, r.id, defs);
    return { opened, moved };
  }

  /** Cek satu kasus: tautkan dokumen turunan dan majukan bila bukti ada. Mengembalikan 1 bila tahap berubah. */
  async refreshCase(tenantId: string, id: string, defs?: WorkflowPipeline[]): Promise<number> {
    const all = defs ?? (await this.defs(tenantId));
    let moved = 0;
    await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(workflowCases).where(and(eq(workflowCases.id, id), eq(workflowCases.tenantId, tenantId))).for('update');
      if (!c || c.status !== 'ACTIVE') return;
      const p = all.find((x) => x.key === c.pipeline);
      if (!p) return;
      const before = c.stage;
      await this.autoAdvance(tx, c, p);
      if (c.stage !== before) {
        moved = 1;
        await this.audit.log(tx, { tenantId, userId: c.createdById, action: 'AUTO', entity: 'WorkflowCase', entityId: c.id, data: { from: before, to: c.stage } });
      }
    });
    return moved;
  }

  // ---------- gerbang di dokumen berisiko ----------
  /**
   * Bila "Alur wajib" menyala dan dokumen itu tertaut ke kasus, aksi berisiko hanya boleh setelah kasus mencapai tahap yang disyaratkan
   * (mis. tagihan pemasok baru boleh dibayar setelah barang DITERIMA). Dokumen tanpa kasus tidak dihalangi.
   */
  async gate(tenantId: string, action: WorkflowGateAction, docId: string): Promise<void> {
    const cfg = await this.settings.section(this.db, tenantId, 'workflow', DEFAULT_SETTINGS);
    if (!cfg.enforce) return;
    const g = GATES[action];
    let row = (await this.db.execute<{ case_id: string }>(sql`SELECT case_id FROM workflow_links WHERE tenant_id = ${tenantId} AND link_type = ${g.link} AND doc_id = ${docId} LIMIT 1`)).rows[0];
    if (!row && g.viaPo) {
      row = (await this.db.execute<{ case_id: string }>(sql`
        SELECT l.case_id FROM purchase_invoices i JOIN workflow_links l ON l.tenant_id = i.tenant_id AND l.link_type = 'PURCHASE_ORDER' AND l.doc_id = i.purchase_order_id
        WHERE i.tenant_id = ${tenantId} AND i.id = ${docId} LIMIT 1`)).rows[0];
    }
    if (!row) return;
    await this.refreshCase(tenantId, row.case_id);
    const [c] = await this.db.select().from(workflowCases).where(and(eq(workflowCases.id, row.case_id), eq(workflowCases.tenantId, tenantId)));
    const p = c && (await this.defs(tenantId)).find((x) => x.key === c.pipeline);
    if (!c || !p) return;
    if (c.status === 'CANCELLED') throw new BadRequestException(`Alur kerja ${c.number} dibatalkan; ${g.what} ditolak. Periksa kasus di menu Alur kerja.`);
    if (c.status === 'DONE') return;
    const need = p.stages.findIndex((s) => s.key === g.stage);
    const have = p.stages.findIndex((s) => s.key === c.stage);
    if (action === 'DELIVER' && c.customerId) {
      const { limit, ar } = await this.creditPosition(tenantId, c.customerId);
      if (limit > 0 && ar > limit) throw new BadRequestException(`Menurut alur kerja ${c.number}, ${g.what} ditahan: piutang pelanggan Rp${Math.round(ar).toLocaleString('id-ID')} melebihi batas kredit Rp${Math.round(limit).toLocaleString('id-ID')}. Minta pelunasan dulu atau naikkan batas kredit pelanggan di data pelanggan.`);
    }
    if (need >= 0 && have < need) {
      throw new BadRequestException(`Menurut alur kerja ${c.number}, ${g.what} belum boleh: kasus masih di tahap "${stageOf(p, c.stage)?.label}", harus sudah mencapai "${stageOf(p, g.stage)?.label}".`);
    }
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
  @Get('settings')
  settings(@CurrentUser() u: AuthUser) {
    return this.svc.getSettings(u);
  }
  @Roles('ADMIN')
  @Put('settings')
  saveSettings(@CurrentUser() u: AuthUser, @Body() dto: WorkflowSettingsDto) {
    return this.svc.saveSettings(u, dto);
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
  @Get('by-doc')
  byDoc(@CurrentUser() u: AuthUser, @Query('type') type: WorkflowLinkType, @Query('id', ParseUUIDPipe) id: string) {
    return this.svc.byDoc(u, type, id);
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

/** Putaran otomatisasi berkala untuk semua perusahaan (tanpa perlu ada yang membuka halaman Alur kerja) */
@Injectable()
export class WorkflowScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger('AlurKerja');
  constructor(@InjectDb() private readonly db: Db, private readonly svc: WorkflowService) {}

  async sweepAll() {
    const t = await this.db.execute<{ id: string; owner: string | null }>(sql`
      SELECT t.id, (SELECT u.id FROM users u WHERE u.tenant_id = t.id AND u.role = 'OWNER' ORDER BY u.created_at LIMIT 1) AS owner
      FROM tenants t LIMIT 500`);
    for (const r of t.rows) {
      if (!r.owner) continue;
      try {
        await this.svc.sweep(r.id, r.owner);
      } catch (e) {
        this.logger.warn(`Otomatisasi alur kerja gagal untuk ${r.id}: ${(e as Error).message}`);
      }
    }
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.sweepAll().catch((e) => this.logger.error(e));
    setTimeout(run, 150_000).unref();
    this.timer = setInterval(run, 10 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

@Global()
@Module({ controllers: [WorkflowController], providers: [WorkflowService, WorkflowScheduler], exports: [WorkflowService] })
export class WorkflowModule {}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { addDays, toDocDate } from '../../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { BoqProgressDto, ReleaseRetentionDto, SaveBoqDto } from './service-contracting.dto';
import { ServiceContractingRepository } from './service-contracting.repository';
import { CreateServiceInvoiceDto } from './service-billing.dto';
import { ServiceBillingService } from './service-billing.service';
import { ServiceProjectsService } from './service-projects.service';
import { splitRetention } from './retention-split';

export interface BoqView {
  items: { id: string; lineNo: number; code: string | null; description: string; unit: string; qty: string; unitPrice: string; value: string; completedQty: string; completedValue: string; pct: number }[];
  total: string;
  completedValue: string;
  pct: number;
  contractValue: string;
  /** Selisih nilai kontrak terhadap total BoQ (0 = sama) */
  difference: string;
}

/** Fitur kontraktor: retensi (tagihan terpisah jatuh tempo setelah masa pemeliharaan) dan BoQ/RAB sebagai dasar persentase kemajuan */
@Injectable()
export class ServiceContractingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly billing: ServiceBillingService,
    private readonly projects: ServiceProjectsService,
    private readonly repo: ServiceContractingRepository,
  ) {}

  // ================= Retensi =================

  /**
   * Tagihan termin proyek beretensi dipecah menjadi dua faktur dalam satu transaksi: tagihan jalan (setelah retensi) dan tagihan
   * retensi yang jatuh tempo setelah masa pemeliharaan. Piutang, umur piutang, dan pembayaran memakai faktur biasa; total DPP keduanya
   * sama dengan termin semula. Proyek tanpa retensi tidak berubah.
   */
  async createInvoice(user: AuthUser, dto: CreateServiceInvoiceDto) {
    if (!dto.projectId) return this.billing.createInvoice(user, dto);
    const [p] = await this.repo.findProject(this.db, user.tenantId, dto.projectId);
    const pct = D(p?.retentionPct ?? 0);
    if (!p || pct.lte(0)) return this.billing.createInvoice(user, dto);
    if (dto.withoutRetention) {
      await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'ProjectRetention', entityId: p.id, data: { withoutRetention: true, termLabel: dto.termLabel ?? null } });
      return this.billing.createInvoice(user, dto);
    }
    const { main, retention } = splitRetention(dto.lines, pct);
    if (retention.lte(0)) return this.billing.createInvoice(user, dto);
    const date = toDocDate(dto.date);
    return this.db.transaction(async (tx) => {
      const first = await this.billing.createInvoiceIn(tx, user, { ...dto, lines: main }, {});
      const label = dto.termLabel ?? dto.description ?? 'termin';
      const retDto: CreateServiceInvoiceDto = {
        ...dto,
        description: `Retensi ${pct.toString()}% — ${label}`.slice(0, 500),
        termLabel: `Retensi ${pct.toString()}%`.slice(0, 80),
        dueDate: addDays(date, p.retentionDays),
        lines: [{ description: `Retensi ${pct.toString()}% — ${label}`.slice(0, 200), qty: '1', price: retention.toFixed(2), accountId: dto.lines[0].accountId } as CreateServiceInvoiceDto['lines'][number]],
      };
      const second = await this.billing.createInvoiceIn(tx, user, retDto, { retentionOfInvoiceId: first.id });
      return { ...first, retentionInvoice: { id: second.id, number: second.number, amount: retention.toFixed(2), dueDate: retDto.dueDate } };
    });
  }

  async retentions(tenantId: string, projectId: string) {
    const [p] = await this.repo.findProject(this.db, tenantId, projectId);
    if (!p) throw new NotFoundException('Proyek tidak ditemukan');
    const rows = await this.repo.listRetentionInvoices(this.db, tenantId, projectId);
    const list = rows.map((r) => {
      const outstanding = D(r.total).minus(r.paid_amount).minus(r.returned_amount);
      return { invoiceId: r.id, number: r.number, parentNumber: r.parent_number, date: r.date, dueDate: r.due_date, total: D(r.total).toFixed(2), outstanding: outstanding.toFixed(2) };
    });
    return { retentionPct: D(p.retentionPct).toFixed(2), retentionDays: p.retentionDays, held: list.reduce<Dec>((a, r) => a.plus(r.outstanding), ZERO).toFixed(2), invoices: list };
  }

  /** Pencairan retensi: ubah jatuh tempo semua tagihan retensi yang belum lunas (mis. setelah serah terima akhir), dengan dasar yang tercatat */
  async releaseRetention(user: AuthUser, projectId: string, dto: ReleaseRetentionDto) {
    const [p] = await this.repo.findProject(this.db, user.tenantId, projectId);
    if (!p) throw new NotFoundException('Proyek tidak ditemukan');
    const due = toDocDate(dto.dueDate);
    const done = await this.db.transaction(async (tx) => {
      const rows = await this.repo.releaseRetentionInvoices(tx, user.tenantId, projectId, due);
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'ProjectRetention', entityId: projectId, data: { release: due, reason: dto.reason.trim(), invoices: rows.length } });
      return rows.length;
    });
    if (!done) throw new BadRequestException('Tidak ada tagihan retensi yang belum lunas pada proyek ini');
    return { released: done, dueDate: due };
  }

  // ================= BoQ / RAB =================

  private view(p: { contractValue: string }, items: Awaited<ReturnType<ServiceContractingRepository['listBoqItems']>>): BoqView {
    const rows = items.map((i) => {
      const value = money(D(i.qty).times(i.unitPrice));
      const done = D(i.qty).gt(0) ? money(value.times(i.completedQty).div(i.qty)) : ZERO;
      return {
        id: i.id,
        lineNo: i.lineNo,
        code: i.code,
        description: i.description,
        unit: i.unit,
        qty: D(i.qty).toString(),
        unitPrice: money(i.unitPrice).toFixed(2),
        value: value.toFixed(2),
        completedQty: D(i.completedQty).toString(),
        completedValue: done.toFixed(2),
        pct: D(i.qty).gt(0) ? Math.round(D(i.completedQty).div(i.qty).times(1000).toNumber()) / 10 : 0,
      };
    });
    const total = rows.reduce<Dec>((a, r) => a.plus(r.value), ZERO);
    const done = rows.reduce<Dec>((a, r) => a.plus(r.completedValue), ZERO);
    return {
      items: rows,
      total: total.toFixed(2),
      completedValue: done.toFixed(2),
      pct: total.gt(0) ? Math.round(done.div(total).times(1000).toNumber()) / 10 : 0,
      contractValue: D(p.contractValue).toFixed(2),
      difference: D(p.contractValue).minus(total).toFixed(2),
    };
  }

  async boq(tenantId: string, projectId: string): Promise<BoqView> {
    const [p] = await this.repo.findProject(this.db, tenantId, projectId);
    if (!p) throw new NotFoundException('Proyek tidak ditemukan');
    return this.view(p, await this.repo.listBoqItems(this.db, projectId));
  }

  /** Simpan BoQ: item bergerak id diperbarui, tanpa id ditambah, yang hilang dihapus (hanya bila belum ada volume selesai) */
  async saveBoq(user: AuthUser, projectId: string, dto: SaveBoqDto): Promise<BoqView> {
    await this.db.transaction(async (tx) => {
      await this.repo.lockProject(tx, user.tenantId, projectId);
      const [p] = await this.repo.findProject(tx, user.tenantId, projectId);
      if (!p) throw new NotFoundException('Proyek tidak ditemukan');
      if (p.status !== 'ACTIVE') throw new BadRequestException('Proyek sudah selesai / dibatalkan');
      const existing = await this.repo.listBoqItems(tx, projectId);
      const byId = new Map(existing.map((i) => [i.id, i]));
      const keep = new Set<string>();
      for (const it of dto.items) {
        if (D(it.qty).lte(0)) throw new BadRequestException(`Volume "${it.description}" harus > 0`);
        if (D(it.unitPrice).isNegative()) throw new BadRequestException(`Harga satuan "${it.description}" tidak boleh negatif`);
        if (it.id) {
          const cur = byId.get(it.id);
          if (!cur) throw new BadRequestException('Ada item BoQ yang bukan milik proyek ini');
          if (keep.has(it.id)) throw new BadRequestException('Item BoQ yang sama tercantum dua kali');
          if (D(it.qty).lt(cur.completedQty)) throw new BadRequestException(`Volume "${cur.description}" tidak boleh di bawah volume yang sudah selesai (${D(cur.completedQty).toString()})`);
          keep.add(it.id);
        }
      }
      const removed = existing.filter((i) => !keep.has(i.id));
      const blocked = removed.find((i) => D(i.completedQty).gt(0));
      if (blocked) throw new BadRequestException(`Item "${blocked.description}" sudah punya volume selesai dan tidak bisa dihapus`);
      await this.repo.deleteBoqItems(tx, removed.map((i) => i.id));
      for (const [idx, it] of dto.items.entries()) {
        const v = { lineNo: idx + 1, code: it.code?.trim() || null, description: it.description.trim(), unit: it.unit.trim().toUpperCase(), qty: D(it.qty).toFixed(4), unitPrice: money(it.unitPrice).toFixed(2) };
        if (it.id) await this.repo.updateBoqItem(tx, it.id, v);
        else await this.repo.insertBoqItem(tx, { tenantId: user.tenantId, projectId, ...v });
      }
      const total = dto.items.reduce<Dec>((a, it) => a.plus(money(D(it.qty).times(it.unitPrice))), ZERO);
      if (dto.syncContract) {
        const [b] = (await this.projects.billedOf(tx, projectId)).rows;
        if (D(b.v).gt(total)) throw new BadRequestException(`Total BoQ (${total.toFixed(2)}) di bawah yang sudah ditagih (${D(b.v).toFixed(2)})`);
        await this.projects.setContractValue(tx, projectId, total);
      }
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'ProjectBoq', entityId: projectId, data: { items: dto.items.length, total: total.toFixed(2), syncContract: !!dto.syncContract } });
    });
    return this.boq(user.tenantId, projectId);
  }

  /**
   * Catat kemajuan dari volume selesai per item BoQ: persentase proyek dihitung dari nilai item yang selesai, lalu dicatat sebagai
   * kemajuan pekerjaan biasa (pendapatan diakui menurut persentase). Volume bersifat kumulatif dan tidak boleh turun.
   */
  async boqProgress(user: AuthUser, projectId: string, dto: BoqProgressDto) {
    const [p] = await this.repo.findProject(this.db, user.tenantId, projectId);
    if (!p) throw new NotFoundException('Proyek tidak ditemukan');
    const items = await this.repo.listBoqItems(this.db, projectId);
    if (!items.length) throw new BadRequestException('Isi BoQ proyek dulu');
    const next = new Map(items.map((i) => [i.id, D(i.completedQty)]));
    for (const r of dto.items) {
      const cur = items.find((i) => i.id === r.itemId);
      if (!cur) throw new BadRequestException('Ada item BoQ yang bukan milik proyek ini');
      const q = D(r.completedQty);
      if (q.lt(cur.completedQty)) throw new BadRequestException(`Volume selesai "${cur.description}" tidak boleh turun (sebelumnya ${D(cur.completedQty).toString()})`);
      if (q.gt(cur.qty)) throw new BadRequestException(`Volume selesai "${cur.description}" melebihi volume BoQ (${D(cur.qty).toString()})`);
      next.set(cur.id, q);
    }
    let total = ZERO;
    let done = ZERO;
    for (const i of items) {
      const value = money(D(i.qty).times(i.unitPrice));
      total = total.plus(value);
      done = done.plus(D(i.qty).gt(0) ? value.times(next.get(i.id)!).div(i.qty) : ZERO);
    }
    if (total.lte(0)) throw new BadRequestException('Total BoQ nol: isi harga satuan dulu');
    const percent = done.div(total).times(100).toDecimalPlaces(2);
    const progress = await this.projects.recordProgress(user, projectId, { date: dto.date, percent: percent.toFixed(2), notes: dto.notes ?? 'Kemajuan dari volume BoQ' });
    await this.db.transaction(async (tx) => {
      for (const [id, q] of next) await this.repo.updateBoqItem(tx, id, { completedQty: q.toFixed(4) });
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'ProjectBoq', entityId: projectId, data: { progress: percent.toFixed(2), items: dto.items.length } });
    });
    return { progress, boq: await this.boq(user.tenantId, projectId) };
  }
}

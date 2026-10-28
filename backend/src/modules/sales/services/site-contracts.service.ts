import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { addDays, toDocDate, todayJakarta } from '../../../common/utils/dates';
import { guessSitePostKind, SITE_POST_REVENUE, type SitePostKind } from '@sansu/shared';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { ServiceBillingService } from './service-billing.service';
import { SiteBillDto, SiteContractDto, SiteContractUpdateDto, SiteRosterDto } from './site-contracts.dto';
import { SiteContractsRepository } from './site-contracts.repository';
import { daysBetween, postBilling, shortfallHeadDays } from './site-coverage';

const MAX_ROSTER_DAYS = 62;
const monthOf = (d: string) => d.slice(0, 7);
const isUnique = (e: unknown) => ((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === '23505';

function monthRange(period: string): { first: string; last: string; days: number } {
  const first = `${period}-01`;
  const [y, m] = period.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first, last: `${period}-${String(days).padStart(2, '0')}`, days };
}

/** Kontrak per lokasi (kebersihan/keamanan/alih daya): pos jaga, jadwal jaga harian, tagihan bulanan per kontrak */
@Injectable()
export class SiteContractsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly billing: ServiceBillingService,
    private readonly repo: SiteContractsRepository,
  ) {}

  async list(tenantId: string) {
    const [rows, posts, billed] = await Promise.all([this.repo.listContracts(this.db, tenantId), this.repo.listPosts(this.db, tenantId), this.repo.listBilled(this.db, tenantId)]);
    const now = monthOf(todayJakarta());
    return rows.rows.map((r) => {
      const mine = posts.rows.filter((p) => p.contract_id === r.id);
      const done = new Set(billed.rows.filter((b) => b.contract_id === r.id).map((b) => b.period));
      const lastPeriod = r.end_date && monthOf(String(r.end_date)) < now ? monthOf(String(r.end_date)) : now;
      const unbilled: string[] = [];
      if (r.is_active) for (let p = monthOf(String(r.start_date)); p <= lastPeriod; p = monthOf(addDays(`${p}-28`, 4))) if (!done.has(p)) unbilled.push(p);
      const monthly = mine.reduce((a, p) => a.plus(D(p.monthly_rate).times(p.headcount)), D(0));
      return {
        id: r.id, customerId: r.customer_id, customerName: r.customer_name, siteName: r.site_name, title: r.title, startDate: r.start_date, endDate: r.end_date, isActive: r.is_active,
        posts: mine.map((p) => ({ id: p.id, name: p.name, headcount: p.headcount, monthlyRate: p.monthly_rate, serviceKind: p.service_kind })),
        monthlyTotal: monthly.toFixed(2),
        billedPeriods: billed.rows.filter((b) => b.contract_id === r.id).map((b) => ({ period: b.period, invoice: b.number, shortfall: b.shortfall })).sort((a, b) => a.period.localeCompare(b.period)),
        unbilledPeriods: unbilled.slice(-36),
      };
    });
  }

  async create(u: AuthUser, dto: SiteContractDto) {
    if (!(await this.repo.findCustomer(this.db, u.tenantId, dto.customerId)).rows.length) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');
    const start = toDocDate(dto.startDate);
    const end = dto.endDate ? toDocDate(dto.endDate) : null;
    if (end && end < start) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    for (const p of dto.posts) if (!D(p.monthlyRate).isFinite() || D(p.monthlyRate).lte(0)) throw new BadRequestException(`Tarif pos "${p.name}" harus lebih dari 0`);
    return this.db.transaction(async (tx) => {
      const c = (await this.repo.insertContract(tx, u.tenantId, { customerId: dto.customerId, siteName: dto.siteName, title: dto.title, withVat: dto.withVat ?? null, start, end })).rows[0];
      for (const p of dto.posts) await this.repo.insertPost(tx, u.tenantId, c.id, { name: p.name, headcount: p.headcount, rate: D(p.monthlyRate).toFixed(2), kind: p.serviceKind ?? guessSitePostKind(p.name) });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'SiteContract', entityId: c.id, data: dto });
      return { id: c.id };
    });
  }

  async update(u: AuthUser, id: string, dto: SiteContractUpdateDto) {
    const cur = (await this.repo.findContract(this.db, u.tenantId, id)).rows[0];
    if (!cur) throw new NotFoundException('Kontrak tidak ditemukan');
    const end = dto.endDate ? toDocDate(dto.endDate) : null;
    if (end && end < String(cur.start_date)) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    await this.repo.updateContract(this.db, id, end, dto.isActive ?? null);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'SiteContract', entityId: id, data: { reason: dto.reason, before: { endDate: cur.end_date, isActive: cur.is_active }, after: dto } });
    return { id };
  }

  /** Jadwalkan petugas di satu pos untuk rentang tanggal; satu petugas satu pos per hari */
  async assign(u: AuthUser, contractId: string, dto: SiteRosterDto) {
    const from = toDocDate(dto.from);
    const to = toDocDate(dto.to);
    if (to < from) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    const days = daysBetween(from, to);
    if (days.length > MAX_ROSTER_DAYS) throw new BadRequestException(`Maksimal ${MAX_ROSTER_DAYS} hari per penjadwalan`);
    const c = (await this.repo.findContract(this.db, u.tenantId, contractId)).rows[0];
    if (!c) throw new NotFoundException('Kontrak tidak ditemukan');
    if (!c.is_active) throw new BadRequestException('Kontrak sudah dinonaktifkan');
    if (from < String(c.start_date) || (c.end_date && to > String(c.end_date))) throw new BadRequestException('Tanggal di luar masa kontrak');
    if (!(await this.repo.findPost(this.db, u.tenantId, contractId, dto.postId)).rows.length) throw new NotFoundException('Pos tidak ditemukan di kontrak ini');
    const emp = (await this.repo.findEmployee(this.db, u.tenantId, dto.employeeId)).rows[0];
    if (!emp) throw new BadRequestException('Petugas tidak ditemukan / nonaktif');
    const busy = (await this.repo.employeeBusyDays(this.db, dto.employeeId, from, to)).rows;
    if (busy.length) throw new ConflictException(`${emp.name} sudah terjadwal di pos lain pada ${busy.slice(0, 3).map((b) => String(b.duty_date)).join(', ')}${busy.length > 3 ? ` (+${busy.length - 3} hari)` : ''}`);
    try {
      await this.repo.insertDuty(this.db, u.tenantId, dto.postId, dto.employeeId, days);
    } catch (e) {
      if (isUnique(e)) throw new ConflictException(`${emp.name} sudah terjadwal di pos lain pada rentang ini`);
      throw e;
    }
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'SiteDuty', entityId: contractId, data: { ...dto, days: days.length } });
    return { days: days.length };
  }

  async unassign(u: AuthUser, contractId: string, dutyId: string) {
    const r = await this.repo.deleteDuty(this.db, u.tenantId, contractId, dutyId);
    if (!r.rows.length) throw new NotFoundException('Jadwal tidak ditemukan');
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'DELETE', entity: 'SiteDuty', entityId: dutyId, data: { contractId } });
    return { id: dutyId };
  }

  /** Cakupan jadwal jaga per pos per hari: petugas hadir vs wajib, dan kekurangan hari-orang */
  async coverage(tenantId: string, contractId: string, from: string, to: string) {
    const a = toDocDate(from);
    const b = toDocDate(to);
    if (b < a) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    const days = daysBetween(a, b);
    if (days.length > 93) throw new BadRequestException('Rentang maksimal 93 hari');
    const c = (await this.repo.findContract(this.db, tenantId, contractId)).rows[0];
    if (!c) throw new NotFoundException('Kontrak tidak ditemukan');
    const [posts, duty] = await Promise.all([this.repo.listPosts(this.db, tenantId, [contractId]), this.repo.dutyRows(this.db, tenantId, contractId, a, b)]);
    const inContract = days.filter((d) => d >= String(c.start_date) && (!c.end_date || d <= String(c.end_date)));
    return {
      contractId, from: a, to: b,
      posts: posts.rows.map((p) => {
        const mine = duty.rows.filter((d) => d.post_id === p.id);
        const byDay = new Map<string, number>();
        for (const d of mine) byDay.set(String(d.duty_date), (byDay.get(String(d.duty_date)) ?? 0) + 1);
        return {
          postId: p.id, name: p.name, headcount: p.headcount,
          shortfallHeadDays: shortfallHeadDays(inContract, p.headcount, byDay),
          days: days.map((d) => ({ date: d, assigned: byDay.get(d) ?? 0, required: inContract.includes(d) ? p.headcount : 0 })),
          duty: mine.map((d) => ({ id: d.id, employeeId: d.employee_id, employeeName: d.employee_name, date: String(d.duty_date) })),
        };
      }),
    };
  }

  /** Tagih satu periode: satu baris per pos (petugas × tarif); potongan kekurangan dari jadwal jaga bila diminta */
  async bill(u: AuthUser, id: string, dto: SiteBillDto) {
    const c = (await this.repo.findContract(this.db, u.tenantId, id)).rows[0];
    if (!c) throw new NotFoundException('Kontrak tidak ditemukan');
    if (!c.is_active) throw new BadRequestException('Kontrak sudah dinonaktifkan');
    if (dto.period < monthOf(String(c.start_date))) throw new BadRequestException('Periode sebelum masa mulai kontrak');
    if (c.end_date && dto.period > monthOf(String(c.end_date))) throw new BadRequestException('Periode setelah masa berakhir kontrak');
    if (dto.period > monthOf(todayJakarta())) throw new BadRequestException('Periode di masa depan belum dapat ditagih');
    if ((await this.repo.isBilled(this.db, id, dto.period)).rows.length) throw new BadRequestException(`Periode ${dto.period} sudah ditagih`);
    const { first, last, days: dim } = monthRange(dto.period);
    const posts = (await this.repo.listPosts(this.db, u.tenantId, [id])).rows;
    const cov = dto.deductShortfall ? await this.coverage(u.tenantId, id, first, last) : null;
    let totalShort = D(0);
    // Tiap pos dibukukan ke akun pendapatan jenis layanannya (keamanan / kebersihan / lainnya) bila profil Alih daya dipilih
    const accountByKind = new Map<SitePostKind, string | undefined>();
    for (const k of new Set(posts.map((p) => p.service_kind))) accountByKind.set(k, await this.billing.revenueAccountFor(this.db, u.tenantId, SITE_POST_REVENUE[k]));
    const lines = posts.map((p) => {
      const short = cov?.posts.find((x) => x.postId === p.id)?.shortfallHeadDays ?? 0;
      const b = postBilling(p.headcount, p.monthly_rate, dim, short, !!dto.deductShortfall);
      totalShort = totalShort.plus(short);
      const note = dto.deductShortfall && short ? ` — dipotong kekurangan ${short} hari-orang` : '';
      return { description: `${c.title} ${c.site_name} — ${p.name} (${p.headcount} petugas) periode ${dto.period}${note}`, qty: b.qty, unit: 'Petugas', price: D(p.monthly_rate).toFixed(2), accountId: accountByKind.get(p.service_kind) };
    });
    return this.billing.createInvoice(
      u,
      { customerId: c.customer_id, date: dto.date, description: `${c.title} ${c.site_name} — periode ${dto.period}`, termLabel: `${c.site_name} ${dto.period}`, withVat: c.with_vat ?? undefined, lines },
      {
        inTx: async (tx, invoice) => {
          try {
            await this.repo.insertBilled(tx, u.tenantId, id, dto.period, invoice.id, totalShort.toFixed(2));
          } catch (e) {
            if (isUnique(e)) throw new ConflictException(`Periode ${dto.period} sudah ditagih`);
            throw e;
          }
          await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'SiteBilling', entityId: invoice.id, data: { contractId: id, period: dto.period, deductShortfall: !!dto.deductShortfall, shortfallHeadDays: totalShort.toFixed(2) } });
        },
      },
    );
  }
}

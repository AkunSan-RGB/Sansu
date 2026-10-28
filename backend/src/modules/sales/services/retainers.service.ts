import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { ServiceBillingService } from './service-billing.service';
import { RetainerDto, RetainerUpdateDto, RetainerBillDto } from './retainers.dto';
import { RetainersRepository } from './retainers.repository';
import { retainerOverage } from './service-limits';

const MAX_PERIODS = 36;

const monthOf = (d: string) => d.slice(0, 7);

function* periods(from: string, to: string) {
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    yield `${y}-${String(m).padStart(2, '0')}`;
    if (++m > 12) { m = 1; y++; }
  }
}

@Injectable()
export class RetainerService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly billing: ServiceBillingService,
    private readonly repo: RetainersRepository,
  ) {}

  async list(tenantId: string) {
    const rows = (await this.repo.queryServiceRetainer(this.db, tenantId)).rows;
    const billed = (await this.repo.queryServiceRetainerInvoice(this.db, tenantId)).rows;
    const now = monthOf(todayJakarta());
    return rows.map((r) => {
      const mine = billed.filter((b) => b.retainer_id === r.id);
      const done = new Set(mine.map((b) => b.period));
      const last = r.end_date && monthOf(String(r.end_date)) < now ? monthOf(String(r.end_date)) : now;
      const due = r.is_active ? [...periods(monthOf(String(r.start_date)), last)].filter((p) => !done.has(p)).slice(-MAX_PERIODS) : [];
      return { id: r.id, customerId: r.customer_id, customerName: r.customer_name, projectId: r.project_id, projectName: r.project_name, title: r.title, monthlyFee: r.monthly_fee, includedHours: r.included_hours, overageRate: r.overage_rate, withVat: r.with_vat, startDate: r.start_date, endDate: r.end_date, isActive: r.is_active, billedPeriods: mine.map((b) => ({ period: b.period, invoice: b.number })).sort((a, b) => a.period.localeCompare(b.period)), unbilledPeriods: due };
    });
  }

  /** Jam termasuk harus disertai tarif kelebihan; keduanya tidak boleh negatif */
  private assertHours(hours?: string, rate?: string) {
    if (hours === undefined || D(hours).lte(0)) return;
    if (!rate || D(rate).lte(0)) throw new BadRequestException('Isi tarif kelebihan jam per jam bila ada jam yang sudah termasuk');
  }

  async create(u: AuthUser, dto: RetainerDto) {
    const fee = D(dto.monthlyFee);
    if (!fee.isFinite() || fee.lte(0)) throw new BadRequestException('Biaya bulanan harus lebih dari 0');
    const start = toDocDate(dto.startDate);
    const end = dto.endDate ? toDocDate(dto.endDate) : null;
    if (end && end < start) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    const c = await this.repo.queryCustomer(this.db, dto.customerId, u.tenantId);
    if (!c.rows.length) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');
    if (dto.projectId) {
      const p = (await this.repo.queryProject(this.db, dto.projectId, u.tenantId)).rows[0];
      if (!p) throw new BadRequestException('Proyek tidak ditemukan');
      if (p.customer_id !== dto.customerId) throw new BadRequestException('Proyek ini milik pelanggan lain');
    }
    this.assertHours(dto.includedHours, dto.overageRate);
    const r = await this.repo.queryServiceRetainerForCreate(this.db, u.tenantId, dto, fee, start, end, u.sub);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'ServiceRetainer', entityId: r.rows[0].id, data: dto });
    return { id: r.rows[0].id };
  }

  /** Perubahan biaya hanya berlaku untuk periode yang belum ditagih (yang sudah ditagih tidak berubah karena faktur sudah terbit) */
  async update(u: AuthUser, id: string, dto: RetainerUpdateDto) {
    const cur = (await this.repo.queryServiceRetainerForUpdate(this.db, id, u.tenantId)).rows[0];
    if (!cur) throw new NotFoundException('Retainer tidak ditemukan');
    const fee = dto.monthlyFee !== undefined ? D(dto.monthlyFee) : null;
    if (fee && (!fee.isFinite() || fee.lte(0))) throw new BadRequestException('Biaya bulanan harus lebih dari 0');
    const end = dto.endDate ? toDocDate(dto.endDate) : undefined;
    if (end && end < String(cur.start_date)) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    this.assertHours(dto.includedHours ?? cur.included_hours ?? undefined, dto.overageRate ?? cur.overage_rate ?? undefined);
    await this.repo.queryUpdate(this.db, fee, cur.monthly_fee, end, cur.end_date, dto, cur.is_active, id, cur.included_hours, cur.overage_rate);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ServiceRetainer', entityId: id, data: { reason: dto.reason, before: { fee: cur.monthly_fee, endDate: cur.end_date, isActive: cur.is_active }, after: { fee: fee?.toFixed(2), endDate: end, isActive: dto.isActive } } });
    return { id };
  }

  async bill(u: AuthUser, id: string, dto: RetainerBillDto) {
    const r = (await this.repo.queryServiceRetainerForUpdate(this.db, id, u.tenantId)).rows[0];
    if (!r) throw new NotFoundException('Retainer tidak ditemukan');
    if (!r.is_active) throw new BadRequestException('Retainer sudah dinonaktifkan');
    if (dto.period < monthOf(String(r.start_date))) throw new BadRequestException('Periode sebelum masa mulai retainer');
    if (r.end_date && dto.period > monthOf(String(r.end_date))) throw new BadRequestException('Periode setelah masa berakhir retainer');
    if (dto.period > monthOf(todayJakarta())) throw new BadRequestException('Periode di masa depan belum dapat ditagih');
    const exists = await this.repo.queryServiceRetainerInvoiceForBill(this.db, id, dto.period);
    if (exists.rows.length) throw new BadRequestException(`Periode ${dto.period} sudah ditagih`);
    // Retainer berjatah jam: jam yang sudah disetujui bulan itu dihitung; kelebihan dari jatah ditagih dengan tarif kelebihan
    const cap = r.included_hours && D(r.included_hours).gt(0) ? D(r.included_hours) : null;
    let usedIds: string[] = [];
    const lines = [{ description: `${r.title} periode ${dto.period}`, qty: '1', unit: 'Bulan', price: r.monthly_fee }];
    if (cap) {
      const pending = Number((await this.repo.countPendingHours(this.db, u.tenantId, r.customer_id, r.project_id, dto.period)).rows[0].n);
      if (pending) throw new BadRequestException(`Ada ${pending} catatan waktu periode ${dto.period} yang belum disetujui: putuskan dulu agar jam terpakai lengkap`);
      const used = (await this.repo.queryApprovedHours(this.db, u.tenantId, r.customer_id, r.project_id, dto.period)).rows;
      usedIds = used.map((x) => x.id);
      const o = retainerOverage(used.reduce((a, x) => a.plus(x.hours), D(0)), cap, r.overage_rate ?? '0');
      if (o.amount.gt(0))
        lines.push({ description: `Kelebihan jam ${o.over} jam (terpakai ${o.used} dari ${cap.toFixed(2)} jam) periode ${dto.period}`, qty: o.over, unit: 'Jam', price: D(r.overage_rate).toFixed(2) });
    }
    // Retainer dibukukan ke Pendapatan Retainer bila profil Konsultan dipilih (selain itu akun pendapatan jasa bawaan)
    const accountId = await this.billing.revenueAccountFor(this.db, u.tenantId, 'RETAINER');
    const inv = await this.billing.createInvoice(
      u,
      { customerId: r.customer_id, projectId: r.project_id ?? undefined, date: dto.date, description: `${r.title} — periode ${dto.period}`, withVat: r.with_vat ?? undefined, lines: lines.map((l) => ({ ...l, accountId })) },
      {
        inTx: async (tx, invoice) => {
          // indeks unik (retainer, periode) menjamin dua penagihan bersamaan hanya satu yang berhasil; yang kalah dibatalkan utuh bersama fakturnya
          try {
            await this.repo.queryServiceRetainerInvoiceForBill2(tx, u.tenantId, id, dto.period, invoice.id);
          } catch (e) {
            if (((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === '23505') throw new ConflictException(`Periode ${dto.period} sudah ditagih`);
            throw e;
          }
          if (usedIds.length) {
            const marked = await this.repo.markHoursBilled(tx, u.tenantId, usedIds, invoice.id);
            if (marked.rows.length !== usedIds.length) throw new ConflictException('Catatan waktu berubah saat penagihan: ulangi');
          }
          await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'RetainerBilling', entityId: invoice.id, data: { retainerId: id, period: dto.period, invoice: invoice.number, amount: r.monthly_fee, hoursCovered: usedIds.length } });
        },
      },
    );
    return inv;
  }
}

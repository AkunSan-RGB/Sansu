import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { ServiceBillingService } from './service-billing.service';
import { RetainerDto, RetainerUpdateDto, RetainerBillDto } from './retainers.dto';

const MAX_PERIODS = 36;

type Ret = { id: string; customer_id: string; project_id: string | null; title: string; monthly_fee: string; with_vat: boolean | null; start_date: string; end_date: string | null; is_active: boolean };

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
  ) {}

  async list(tenantId: string) {
    const rows = (await this.db.execute<Ret & { customer_name: string; project_name: string | null }>(sql`SELECT r.*, c.name AS customer_name, p.name AS project_name FROM service_retainers r JOIN customers c ON c.id = r.customer_id LEFT JOIN projects p ON p.id = r.project_id WHERE r.tenant_id = ${tenantId} ORDER BY r.is_active DESC, c.name, r.title`)).rows;
    const billed = (await this.db.execute<{ retainer_id: string; period: string; number: string }>(sql`SELECT ri.retainer_id, ri.period, i.number FROM service_retainer_invoices ri JOIN invoices i ON i.id = ri.invoice_id WHERE ri.tenant_id = ${tenantId}`)).rows;
    const now = monthOf(todayJakarta());
    return rows.map((r) => {
      const mine = billed.filter((b) => b.retainer_id === r.id);
      const done = new Set(mine.map((b) => b.period));
      const last = r.end_date && monthOf(String(r.end_date)) < now ? monthOf(String(r.end_date)) : now;
      const due = r.is_active ? [...periods(monthOf(String(r.start_date)), last)].filter((p) => !done.has(p)).slice(-MAX_PERIODS) : [];
      return { id: r.id, customerId: r.customer_id, customerName: r.customer_name, projectId: r.project_id, projectName: r.project_name, title: r.title, monthlyFee: r.monthly_fee, withVat: r.with_vat, startDate: r.start_date, endDate: r.end_date, isActive: r.is_active, billedPeriods: mine.map((b) => ({ period: b.period, invoice: b.number })).sort((a, b) => a.period.localeCompare(b.period)), unbilledPeriods: due };
    });
  }

  async create(u: AuthUser, dto: RetainerDto) {
    const fee = D(dto.monthlyFee);
    if (!fee.isFinite() || fee.lte(0)) throw new BadRequestException('Biaya bulanan harus lebih dari 0');
    const start = toDocDate(dto.startDate);
    const end = dto.endDate ? toDocDate(dto.endDate) : null;
    if (end && end < start) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    const c = await this.db.execute(sql`SELECT 1 FROM customers WHERE id = ${dto.customerId} AND tenant_id = ${u.tenantId} AND is_active`);
    if (!c.rows.length) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');
    if (dto.projectId) {
      const p = (await this.db.execute<{ customer_id: string; status: string }>(sql`SELECT customer_id, status FROM projects WHERE id = ${dto.projectId} AND tenant_id = ${u.tenantId}`)).rows[0];
      if (!p) throw new BadRequestException('Proyek tidak ditemukan');
      if (p.customer_id !== dto.customerId) throw new BadRequestException('Proyek ini milik pelanggan lain');
    }
    const r = await this.db.execute<{ id: string }>(sql`INSERT INTO service_retainers (tenant_id, customer_id, project_id, title, monthly_fee, with_vat, start_date, end_date, created_by_id) VALUES (${u.tenantId}, ${dto.customerId}, ${dto.projectId ?? null}, ${dto.title.trim()}, ${fee.toFixed(2)}, ${dto.withVat ?? null}, ${start}, ${end}, ${u.sub}) RETURNING id`);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'ServiceRetainer', entityId: r.rows[0].id, data: dto });
    return { id: r.rows[0].id };
  }

  /** Perubahan biaya hanya berlaku untuk periode yang belum ditagih (yang sudah ditagih tidak berubah karena faktur sudah terbit) */
  async update(u: AuthUser, id: string, dto: RetainerUpdateDto) {
    const cur = (await this.db.execute<Ret>(sql`SELECT * FROM service_retainers WHERE id = ${id} AND tenant_id = ${u.tenantId}`)).rows[0];
    if (!cur) throw new NotFoundException('Retainer tidak ditemukan');
    const fee = dto.monthlyFee !== undefined ? D(dto.monthlyFee) : null;
    if (fee && (!fee.isFinite() || fee.lte(0))) throw new BadRequestException('Biaya bulanan harus lebih dari 0');
    const end = dto.endDate ? toDocDate(dto.endDate) : undefined;
    if (end && end < String(cur.start_date)) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    await this.db.execute(sql`UPDATE service_retainers SET monthly_fee = ${fee ? fee.toFixed(2) : cur.monthly_fee}, end_date = ${end ?? cur.end_date}, is_active = ${dto.isActive ?? cur.is_active} WHERE id = ${id}`);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ServiceRetainer', entityId: id, data: { reason: dto.reason, before: { fee: cur.monthly_fee, endDate: cur.end_date, isActive: cur.is_active }, after: { fee: fee?.toFixed(2), endDate: end, isActive: dto.isActive } } });
    return { id };
  }

  async bill(u: AuthUser, id: string, dto: RetainerBillDto) {
    const r = (await this.db.execute<Ret>(sql`SELECT * FROM service_retainers WHERE id = ${id} AND tenant_id = ${u.tenantId}`)).rows[0];
    if (!r) throw new NotFoundException('Retainer tidak ditemukan');
    if (!r.is_active) throw new BadRequestException('Retainer sudah dinonaktifkan');
    if (dto.period < monthOf(String(r.start_date))) throw new BadRequestException('Periode sebelum masa mulai retainer');
    if (r.end_date && dto.period > monthOf(String(r.end_date))) throw new BadRequestException('Periode setelah masa berakhir retainer');
    if (dto.period > monthOf(todayJakarta())) throw new BadRequestException('Periode di masa depan belum dapat ditagih');
    const exists = await this.db.execute(sql`SELECT 1 FROM service_retainer_invoices WHERE retainer_id = ${id} AND period = ${dto.period}`);
    if (exists.rows.length) throw new BadRequestException(`Periode ${dto.period} sudah ditagih`);
    const inv = await this.billing.createInvoice(
      u,
      { customerId: r.customer_id, projectId: r.project_id ?? undefined, date: dto.date, description: `${r.title} — periode ${dto.period}`, withVat: r.with_vat ?? undefined, lines: [{ description: `${r.title} periode ${dto.period}`, qty: '1', unit: 'Bulan', price: r.monthly_fee }] },
      {
        inTx: async (tx, invoice) => {
          // indeks unik (retainer, periode) menjamin dua penagihan bersamaan hanya satu yang berhasil; yang kalah dibatalkan utuh bersama fakturnya
          try {
            await tx.execute(sql`INSERT INTO service_retainer_invoices (tenant_id, retainer_id, period, invoice_id) VALUES (${u.tenantId}, ${id}, ${dto.period}, ${invoice.id})`);
          } catch (e) {
            if (((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === '23505') throw new ConflictException(`Periode ${dto.period} sudah ditagih`);
            throw e;
          }
          await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'RetainerBilling', entityId: invoice.id, data: { retainerId: id, period: dto.period, invoice: invoice.number, amount: r.monthly_fee } });
        },
      },
    );
    return inv;
  }
}

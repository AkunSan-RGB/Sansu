import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { addDays, toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D, money } from '../../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { ServiceBillingService } from './service-billing.service';
import { TimeEntryDto, UpdateTimeEntryDto, ApproveDto, ReasonDto, RateDto, BillDto, TimerStartDto, TimerWhoDto } from './timesheets.dto';
import { EntriesQuery, RangeQuery } from './timesheets.shared';
import { TimesheetsRepository } from './timesheets.repository';
import type { Entry } from './timesheets.repository';

export const MAX_HOURS_PER_DAY = 16;

export const LONG_DAY_HOURS = 12;

export const BACKDATE_DAYS = 31;

const PRIVILEGED = ['OWNER', 'ADMIN', 'FINANCE'];

const num = (v: unknown) => Number(v ?? 0);

const isPriv = (u: AuthUser) => PRIVILEGED.includes(u.role);

@Injectable()
export class TimesheetService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly billing: ServiceBillingService,
    private readonly repo: TimesheetsRepository,
  ) {}

  /** Karyawan yang terhubung dengan akun pengguna ini */
  private async ownEmployee(db: DbOrTx, u: AuthUser) {
    const r = await this.repo.queryEmployee(db, u.tenantId, u.sub);
    return r.rows[0]?.id ?? null;
  }

  /** Tarif paling spesifik yang berlaku pada tanggal kerja; null bila belum ada */
  async resolveRate(db: DbOrTx, tenantId: string, employeeId: string, projectId: string | null, date: string): Promise<string | null> {
    const r = await this.repo.queryResolveRate(db, projectId, employeeId, tenantId, date);
    return r.rows[0]?.rate ?? null;
  }

  private checkHours(raw: string) {
    const h = D(raw);
    if (!h.isFinite() || h.lte(0) || h.gt(MAX_HOURS_PER_DAY)) throw new BadRequestException(`Jam kerja harus lebih dari 0 dan paling banyak ${MAX_HOURS_PER_DAY} per catatan`);
    if (!h.times(100).isInteger()) throw new BadRequestException('Jam kerja maksimal dua desimal');
    return h;
  }

  private checkDate(u: AuthUser, date: string) {
    const d = toDocDate(date);
    if (d > todayJakarta()) throw new BadRequestException('Tanggal kerja tidak boleh di masa depan');
    if (d < addDays(todayJakarta(), -BACKDATE_DAYS) && !isPriv(u)) throw new ForbiddenException(`Catatan lebih dari ${BACKDATE_DAYS} hari ke belakang hanya boleh dibuat Admin/Keuangan`);
    return d;
  }

  /** Total jam aktif karyawan pada hari itu (tidak termasuk catatan ditolak/dihapus-tagih dan `exceptId`) */
  private async dayHours(tx: DbOrTx, tenantId: string, employeeId: string, date: string, exceptId?: string) {
    const r = await this.repo.queryTimeEntry(tx, tenantId, employeeId, date, exceptId);
    return num(r.rows[0].h);
  }

  async create(u: AuthUser, dto: TimeEntryDto) {
    const own = await this.ownEmployee(this.db, u);
    const employeeId = dto.employeeId ?? own;
    if (!employeeId) throw new BadRequestException('Akun Anda belum terhubung dengan data karyawan; minta bagian SDM atau Pemilik menghubungkannya di Karyawan › Hubungkan akun (aplikasi Karyawan harus aktif)');
    if (employeeId !== own && !isPriv(u)) throw new ForbiddenException('Anda hanya dapat mencatat waktu untuk diri sendiri');
    const hours = this.checkHours(dto.hours);
    const date = this.checkDate(u, dto.workDate);
    const id = await this.db.transaction(async (tx) => {
      const emp = await this.repo.queryEmployeeForCreate(tx, employeeId, u.tenantId);
      if (!emp.rows.length) throw new BadRequestException('Karyawan tidak ditemukan');
      let customerId = dto.customerId ?? null;
      let projectId: string | null = null;
      if (dto.projectId) {
        const p = (await this.repo.queryProject(tx, dto.projectId, u.tenantId)).rows[0];
        if (!p) throw new BadRequestException('Proyek tidak ditemukan');
        if (p.status !== 'ACTIVE') throw new BadRequestException('Proyek sudah selesai / dibatalkan');
        if (customerId && customerId !== p.customer_id) throw new BadRequestException('Proyek ini milik pelanggan lain');
        customerId = p.customer_id;
        projectId = p.id;
      }
      if (!customerId) throw new BadRequestException('Pilih proyek atau pelanggan');
      const c = await this.repo.queryCustomer(tx, customerId, u.tenantId);
      if (!c.rows.length) throw new BadRequestException('Pelanggan tidak ditemukan');
      const already = await this.dayHours(tx, u.tenantId, employeeId, date);
      if (already + hours.toNumber() > MAX_HOURS_PER_DAY) throw new BadRequestException(`Total jam karyawan pada ${date} akan menjadi ${already + hours.toNumber()} (batas ${MAX_HOURS_PER_DAY} jam per hari)`);
      const billable = dto.billable ?? true;
      const rate = billable ? await this.resolveRate(tx, u.tenantId, employeeId, projectId, date) : null;
      const r = await this.repo.queryTimeEntryForCreate(tx, u.tenantId, employeeId, projectId, customerId, date, hours, dto.description, billable, rate, u.sub);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'TimeEntry', entityId: r.rows[0].id, data: { employeeId, customerId, projectId, date, hours: hours.toFixed(2), billable, rate } });
      return r.rows[0].id;
    });
    return this.get(u, id);
  }

  private async lock(tx: Tx, u: AuthUser, id: string) {
    const r = await this.repo.queryTimeEntryForLock(tx, id, u.tenantId);
    if (!r.rows.length) throw new NotFoundException('Catatan waktu tidak ditemukan');
    return r.rows[0];
  }

  /** Pemilik catatan atau karyawannya boleh mengubah/mengajukan; selain itu hanya Admin/Keuangan/Pemilik */
  private async assertOwner(tx: Tx, u: AuthUser, e: Entry) {
    if (isPriv(u)) return;
    const own = await this.ownEmployee(tx, u);
    if (e.created_by_id !== u.sub && e.employee_id !== own) throw new ForbiddenException('Catatan ini milik orang lain');
  }

  async update(u: AuthUser, id: string, dto: UpdateTimeEntryDto) {
    await this.db.transaction(async (tx) => {
      const e = await this.lock(tx, u, id);
      await this.assertOwner(tx, u, e);
      if (!['DRAFT', 'REJECTED'].includes(e.status)) throw new BadRequestException('Hanya catatan draf atau yang ditolak yang dapat diubah');
      const hours = dto.hours ? this.checkHours(dto.hours) : D(e.hours);
      const date = dto.workDate ? this.checkDate(u, dto.workDate) : e.work_date;
      const already = await this.dayHours(tx, u.tenantId, e.employee_id, date, id);
      if (already + hours.toNumber() > MAX_HOURS_PER_DAY) throw new BadRequestException(`Total jam pada ${date} melebihi ${MAX_HOURS_PER_DAY} jam`);
      const billable = dto.billable ?? e.billable;
      const rate = billable ? await this.resolveRate(tx, u.tenantId, e.employee_id, e.project_id, date) : null;
      await this.repo.queryUpdate(tx, date, hours, dto, e, billable, rate, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'TimeEntry', entityId: id, data: { before: { date: e.work_date, hours: e.hours, billable: e.billable }, after: { date, hours: hours.toFixed(2), billable } } });
    });
    return this.get(u, id);
  }

  async submit(u: AuthUser, ids: string[]) {
    const done: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const id of [...new Set(ids)]) {
        const e = await this.lock(tx, u, id);
        await this.assertOwner(tx, u, e);
        if (!['DRAFT', 'REJECTED'].includes(e.status)) throw new BadRequestException('Hanya catatan draf atau yang ditolak yang dapat diajukan');
        await this.repo.querySubmit(tx, id);
        done.push(id);
      }
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'TimeEntry', entityId: done[0], data: { submitted: done.length } });
    });
    return { submitted: done.length };
  }

  async approve(u: AuthUser, id: string, dto: ApproveDto) {
    await this.db.transaction(async (tx) => {
      const e = await this.lock(tx, u, id);
      if (e.status !== 'SUBMITTED') throw new BadRequestException('Hanya catatan yang diajukan yang dapat disetujui');
      const empUser = (await this.repo.queryEmployeeForApprove(tx, e.employee_id)).rows[0]?.user_id;
      if (u.role !== 'OWNER' && (e.created_by_id === u.sub || empUser === u.sub)) throw new ForbiddenException('Catatan waktu harus disetujui orang lain dari pencatatnya (pemisahan fungsi)');
      let rate = e.rate;
      if (e.billable) {
        if (dto.rate !== undefined) {
          if (!['OWNER', 'ADMIN'].includes(u.role)) throw new ForbiddenException('Mengubah tarif hanya boleh Admin/Pemilik');
          if ((dto.rateNote ?? '').trim().length < 5) throw new BadRequestException('Mengubah tarif wajib disertai alasan (min. 5 huruf)');
          const r = money(dto.rate);
          if (r.lte(0)) throw new BadRequestException('Tarif harus lebih dari 0');
          rate = r.toFixed(2);
        } else if (!rate) {
          rate = await this.resolveRate(tx, u.tenantId, e.employee_id, e.project_id, e.work_date);
        }
        if (!rate) throw new BadRequestException('Belum ada tarif tagih untuk catatan ini; atur di tab Tarif');
      }
      await this.repo.queryApprove(tx, rate, dto, u, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'TimeEntry', entityId: id, data: { hours: e.hours, rate, overridden: dto.rate !== undefined, note: dto.rateNote } });
    });
    return this.get(u, id);
  }

  async reject(u: AuthUser, id: string, dto: ReasonDto) {
    await this.db.transaction(async (tx) => {
      const e = await this.lock(tx, u, id);
      if (e.status !== 'SUBMITTED') throw new BadRequestException('Hanya catatan yang diajukan yang dapat ditolak');
      await this.repo.queryReject(tx, u.sub, dto.reason, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'TimeEntry', entityId: id, data: { reason: dto.reason } });
    });
    return this.get(u, id);
  }

  async writeOff(u: AuthUser, id: string, dto: ReasonDto) {
    await this.db.transaction(async (tx) => {
      const e = await this.lock(tx, u, id);
      if (e.status !== 'APPROVED') throw new BadRequestException('Hanya catatan yang disetujui dan belum ditagih yang dapat dihapus-tagih');
      await this.repo.queryWriteOff(tx, dto.reason, u.sub, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CANCEL', entity: 'TimeEntry', entityId: id, data: { reason: dto.reason, hours: e.hours, rate: e.rate } });
    });
    return this.get(u, id);
  }

  async get(u: AuthUser, id: string) {
    const rows = await this.list(u, {}, id);
    if (!rows.length) throw new NotFoundException('Catatan waktu tidak ditemukan');
    return rows[0];
  }

  /** Karyawan biasa hanya melihat catatannya sendiri */
  async list(u: AuthUser, q: EntriesQuery, onlyId?: string) {
    const own = isPriv(u) || u.role === 'ACCOUNTANT' ? null : await this.ownEmployee(this.db, u);
    const scoped = !isPriv(u) && u.role !== 'ACCOUNTANT';
    const r = await this.repo.queryTimeEntryForList(this.db, u, onlyId, scoped, own, q);
    return r.rows as Record<string, unknown>[];
  }

  rates(tenantId: string) {
    return this.repo.queryBillingRateForRates(this.db, tenantId);
  }

  async createRate(u: AuthUser, dto: RateDto) {
    const rate = money(dto.rate);
    if (rate.lte(0) || rate.gt(100_000_000)) throw new BadRequestException('Tarif per jam tidak wajar');
    if (dto.employeeId) {
      const e = await this.repo.queryEmployeeForCreateRate(this.db, dto.employeeId, u.tenantId);
      if (!e.rows.length) throw new BadRequestException('Karyawan tidak ditemukan');
    }
    if (dto.projectId) {
      const p = await this.repo.queryProjectForCreateRate(this.db, dto.projectId, u.tenantId);
      if (!p.rows.length) throw new BadRequestException('Proyek tidak ditemukan');
    }
    const r = await this.repo.queryBillingRate(this.db, u.tenantId, dto, rate, u.sub);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'BillingRate', entityId: r.rows[0].id, data: { employeeId: dto.employeeId, projectId: dto.projectId, rate: rate.toFixed(2), validFrom: dto.validFrom } });
    return { id: r.rows[0].id };
  }

  /** Waktu disetujui yang belum ditagih, dikelompokkan per pelanggan/proyek */
  async unbilled(tenantId: string) {
    const r = await this.repo.queryTimeEntryForUnbilled(this.db, tenantId);
    return r.rows;
  }

  async bill(u: AuthUser, dto: BillDto) {
    const ids = [...new Set(dto.entryIds)];
    if (ids.length !== dto.entryIds.length) throw new BadRequestException('Catatan yang sama dipilih lebih dari sekali');
    const rows = (await this.repo.queryTimeEntryForBill2(this.db, u.tenantId, ids)).rows;
    if (rows.length !== ids.length) throw new BadRequestException('Ada catatan yang tidak ditemukan');
    for (const r of rows) {
      if (r.status !== 'APPROVED' || !r.billable || !r.rate) throw new BadRequestException(`Catatan ${r.work_date} (${r.employee_name}) belum disetujui, tidak dapat ditagih, atau sudah ditagih`);
      if (r.customer_id !== dto.customerId) throw new BadRequestException('Semua catatan harus milik pelanggan yang sama');
    }
    const projects = [...new Set(rows.map((r) => r.project_id))];
    if (projects.length > 1) throw new BadRequestException('Catatan berasal dari proyek berbeda; tagih per proyek (atau per catatan tanpa proyek)');
    // satu baris faktur per karyawan dan tarif
    const groups = new Map<string, { name: string; hours: ReturnType<typeof D>; rate: string; from: string; to: string }>();
    for (const r of rows) {
      const k = `${r.employee_id}|${r.rate}`;
      const g = groups.get(k) ?? { name: r.employee_name, hours: D(0), rate: r.rate!, from: r.work_date, to: r.work_date };
      g.hours = g.hours.plus(r.hours);
      if (r.work_date < g.from) g.from = r.work_date;
      if (r.work_date > g.to) g.to = r.work_date;
      groups.set(k, g);
    }
    const total = rows.reduce((a, r) => a.plus(D(r.hours).times(r.rate!)), D(0));
    const inv = await this.billing.createInvoice(
      u,
      {
        customerId: dto.customerId,
        projectId: projects[0] ?? undefined,
        date: dto.date,
        description: dto.description ?? 'Jasa berdasarkan lembar waktu',
        withVat: dto.withVat,
        lines: [...groups.values()].map((g) => ({ description: `Jasa ${g.name} ${g.from === g.to ? g.from : `${g.from} s/d ${g.to}`}`, qty: g.hours.toFixed(2), unit: 'Jam', price: g.rate })),
      },
      {
        // penandaan tertagih satu transaksi dengan faktur; bila ada yang berubah sejak dibaca, seluruhnya dibatalkan
        inTx: async (tx, invoice) => {
          const locked = (await this.repo.queryTimeEntryForBill(tx, u.tenantId, ids)).rows;
          const sum = locked.reduce((a, r) => a.plus(D(r.hours).times(r.rate)), D(0));
          if (locked.length !== ids.length || !sum.eq(total)) throw new BadRequestException('Catatan waktu berubah sejak dipilih (sudah ditagih atau diubah); muat ulang daftar');
          await this.repo.queryBill(tx, invoice.id, ids);
          await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'TimesheetBilling', entityId: invoice.id, data: { invoice: invoice.number, entries: ids.length, hours: rows.reduce((a, r) => a.plus(r.hours), D(0)).toFixed(2), amount: total.toFixed(2) } });
        },
      },
    );
    return { ...inv, entries: ids.length, amount: money(total).toFixed(2) };
  }

  /** Satu timer berjalan per karyawan. Saat dihentikan menjadi draf catatan waktu (dibulatkan ke atas per 15 menit); jam tidak diketik. */
  private async timerOwner(u: AuthUser, employeeId?: string) {
    const own = await this.ownEmployee(this.db, u);
    const emp = employeeId ?? own;
    if (!emp) throw new BadRequestException('Akun Anda belum terhubung dengan data karyawan; minta bagian SDM atau Pemilik menghubungkannya di Karyawan › Hubungkan akun (aplikasi Karyawan harus aktif)');
    if (emp !== own && !isPriv(u)) throw new ForbiddenException('Anda hanya dapat memakai timer untuk diri sendiri');
    return emp;
  }

  /** Status timer: akun yang belum terhubung ke data karyawan bukan galat bagi pembaca, cukup diberi tahu (`linked: false`) */
  async timer(u: AuthUser, employeeId?: string) {
    if (!employeeId && !(await this.ownEmployee(this.db, u))) return { linked: false as const };
    const emp = await this.timerOwner(u, employeeId);
    const r = await this.repo.queryTimeTimer(this.db, u.tenantId, emp);
    return r.rows[0] ?? null;
  }

  async startTimer(u: AuthUser, dto: TimerStartDto) {
    const emp = await this.timerOwner(u, dto.employeeId);
    let customerId = dto.customerId ?? null;
    let projectId: string | null = null;
    if (dto.projectId) {
      const p = (await this.repo.queryProject(this.db, dto.projectId, u.tenantId)).rows[0];
      if (!p) throw new BadRequestException('Proyek tidak ditemukan');
      if (p.status !== 'ACTIVE') throw new BadRequestException('Proyek sudah selesai / dibatalkan');
      if (customerId && customerId !== p.customer_id) throw new BadRequestException('Proyek ini milik pelanggan lain');
      customerId = p.customer_id;
      projectId = p.id;
    }
    if (!customerId) throw new BadRequestException('Pilih proyek atau pelanggan');
    const c = await this.repo.queryCustomer(this.db, customerId, u.tenantId);
    if (!c.rows.length) throw new BadRequestException('Pelanggan tidak ditemukan');
    try {
      await this.repo.queryTimeTimerForStartTimer(this.db, u.tenantId, emp, projectId, customerId, dto, u.sub);
    } catch (e) {
      if (((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === '23505') throw new BadRequestException('Timer karyawan ini masih berjalan; hentikan atau buang dulu');
      throw e;
    }
    return this.timer(u, emp);
  }

  async stopTimer(u: AuthUser, dto: TimerWhoDto) {
    const emp = await this.timerOwner(u, dto.employeeId);
    // DELETE ... RETURNING atomik: dua permintaan henti bersamaan hanya satu yang mendapat baris
    const t = (await this.repo.queryTimeTimerForStopTimer(this.db, u.tenantId, emp)).rows[0];
    if (!t) throw new BadRequestException('Tidak ada timer yang berjalan');
    const restore = () => this.repo.queryTimeTimerForStopTimer2(this.db, u.tenantId, emp, t.project_id, t.customer_id, t.description, t.billable, t.started_at, t.created_by_id);
    const hoursRaw = (Date.now() - new Date(t.started_at).getTime()) / 3_600_000;
    if (hoursRaw > MAX_HOURS_PER_DAY) {
      await restore();
      throw new BadRequestException(`Timer berjalan ${hoursRaw.toFixed(1)} jam (lebih dari ${MAX_HOURS_PER_DAY}); buang timer dengan alasan lalu catat jamnya manual`);
    }
    const hours = Math.max(0.25, Math.ceil(hoursRaw * 4) / 4);
    const workDate = new Date(new Date(t.started_at).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    try {
      const entry = await this.create(u, { employeeId: emp, projectId: t.project_id ?? undefined, customerId: t.customer_id, workDate, hours: hours.toFixed(2), description: t.description, billable: t.billable });
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'TimeTimer', entityId: (entry as { id: string }).id, data: { startedAt: t.started_at, hours: hours.toFixed(2) } });
      return entry;
    } catch (e) {
      await restore(); // pencatatan gagal (mis. melebihi batas jam harian): timer tidak hilang
      throw e;
    }
  }

  async discardTimer(u: AuthUser, dto: TimerWhoDto & { reason: string }) {
    const emp = await this.timerOwner(u, dto.employeeId);
    const r = await this.repo.queryTimeTimerForDiscardTimer(this.db, u.tenantId, emp);
    if (!r.rows.length) throw new BadRequestException('Tidak ada timer yang berjalan');
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'DELETE', entity: 'TimeTimer', entityId: emp, data: { reason: dto.reason, startedAt: (r.rows[0] as { started_at: Date }).started_at } });
    return { ok: true };
  }

  async controls(tenantId: string) {
    const q = async (text: ReturnType<typeof sql>) => (await this.repo.queryControls(this.db, text)).rows;
    const today = todayJakarta();
    const submittedOld = await q(sql`SELECT t.id, e.name AS employee, t.work_date AS "workDate", t.hours FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${tenantId} AND t.status = 'SUBMITTED' AND t.submitted_at < now() - interval '3 days' ORDER BY t.submitted_at LIMIT 50`);
    const unbilledOld = await q(sql`SELECT c.name AS customer, COUNT(*)::int AS entries, SUM(t.hours) AS hours, SUM(t.hours * t.rate) AS amount, MIN(t.work_date) AS oldest FROM time_entries t JOIN customers c ON c.id = t.customer_id WHERE t.tenant_id = ${tenantId} AND t.status = 'APPROVED' AND t.billable AND t.decided_at < now() - interval '30 days' GROUP BY c.name ORDER BY MIN(t.work_date)`);
    const noRate = await q(sql`SELECT t.id, e.name AS employee, t.work_date AS "workDate", t.hours FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${tenantId} AND t.billable AND t.rate IS NULL AND t.status IN ('DRAFT', 'SUBMITTED', 'REJECTED') ORDER BY t.work_date LIMIT 50`);
    const longDays = await q(sql`SELECT e.name AS employee, t.work_date AS "workDate", SUM(t.hours) AS hours FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${tenantId} AND t.status NOT IN ('REJECTED', 'WRITTEN_OFF') AND t.work_date >= ${addDays(today, -60)} GROUP BY e.name, t.work_date HAVING SUM(t.hours) > ${LONG_DAY_HOURS} ORDER BY t.work_date DESC LIMIT 50`);
    const overrides = await q(sql`SELECT e.name AS employee, t.work_date AS "workDate", t.rate, t.rate_note AS note FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${tenantId} AND t.rate_note IS NOT NULL AND t.decided_at > now() - interval '60 days' ORDER BY t.decided_at DESC LIMIT 50`);
    const writeOffs = await q(sql`SELECT e.name AS employee, t.work_date AS "workDate", t.hours, t.rate, t.decision_note AS reason FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.tenant_id = ${tenantId} AND t.status = 'WRITTEN_OFF' AND t.decided_at > now() - interval '60 days' ORDER BY t.decided_at DESC LIMIT 50`);
    return { submittedOver3Days: submittedOld, approvedUnbilledOver30Days: unbilledOld, billableWithoutRate: noRate, longDays, rateOverrides: overrides, writtenOff: writeOffs };
  }

  /** Utilisasi per karyawan: jam dicatat, jam tertagih, nilai tertagih dan yang belum ditagih */
  async utilization(tenantId: string, q: RangeQuery) {
    const to = q.to ?? todayJakarta();
    const from = q.from ?? addDays(to, -30);
    const r = await this.repo.queryEmployeeForUtilization(this.db, from, to, tenantId);
    return { from, to, rows: r.rows };
  }
}

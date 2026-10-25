import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WORK_LIMITS, WORK_UNIT_LABELS, WORK_UNITS_BY_MODEL, type WorkUnit } from '@sansu/shared';
import { and, eq, sql } from 'drizzle-orm';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { D, Dec, money } from '../../common/utils/money';
import { Db, DbOrTx, Tx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { attendances, employees, productionOrders, projects, serviceRates, serviceWorkEntries } from '../../db/schema';
import { monthRange } from '../hr/hr.service';
import { CreateRateDto, UpdateRateDto, EntryQueryDto, CreateEntryDto, DecideEntryDto, VoidEntryDto } from './service-work.dto';
import { invoiceUsable } from './service-work.shared';
import { findOwned, insertOne, lockOwned } from '../../db/owned';
import { ServiceWorkRepository } from './service-work.repository';

export const MAX_HOURS_PER_DAY = 16;

export const MAX_BACKDATE_DAYS = 62;

export const MAX_HOURS_PER_MONTH = 260;

@Injectable()
export class ServiceWorkService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly repo: ServiceWorkRepository,
  ) {}

  /** Nama pegawai aktif untuk memilih pegawai pada catatan kerja — tanpa gaji/rekening, jadi aman dibuka untuk Admin */
  async staff(u: AuthUser) {
    const r = await this.repo.queryEmployee(this.db, u.tenantId);
    return r.rows;
  }

  private async requireJasa(tenantId: string) {
    if ((await this.settings.businessModel(this.db, tenantId)) !== 'JASA') throw new BadRequestException('Fitur ini khusus usaha jasa');
  }

  /** Satuan upah yang berlaku untuk jenis usaha perusahaan ini */
  private async unitsOf(tenantId: string, db: DbOrTx = this.db): Promise<WorkUnit[]> {
    return WORK_UNITS_BY_MODEL[await this.settings.businessModel(db, tenantId)];
  }

  /** Satuan upah dan batas wajar untuk layar (judul, pilihan satuan tarif) */
  async profile(u: AuthUser) {
    const model = await this.settings.businessModel(this.db, u.tenantId);
    return { model, units: WORK_UNITS_BY_MODEL[model].map((k) => ({ key: k, label: WORK_UNIT_LABELS[k] })), limits: WORK_LIMITS };
  }

  async listRates(u: AuthUser) {
    return this.db.select().from(serviceRates).where(eq(serviceRates.tenantId, u.tenantId)).orderBy(serviceRates.unit, serviceRates.name);
  }

  async createRate(u: AuthUser, dto: CreateRateDto) {
    if (!(await this.unitsOf(u.tenantId)).includes(dto.unit)) throw new BadRequestException(`Satuan "${WORK_UNIT_LABELS[dto.unit]}" tidak dipakai di jenis usaha Anda`);
    const rate = D(dto.rate);
    this.checkRate(dto.unit, rate);
    const [dup] = await this.repo.findServiceRatesByName(this.db, u.tenantId, dto.name);
    if (dup) throw new BadRequestException('Nama tarif sudah dipakai');
    const row = await insertOne(this.db, serviceRates, { tenantId: u.tenantId, name: dto.name.trim(), unit: dto.unit, rate: rate.toFixed(2), createdById: u.sub });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'ServiceRate', entityId: row.id, data: { name: row.name, unit: row.unit, rate: row.rate } });
    return row;
  }

  async updateRate(u: AuthUser, id: string, dto: UpdateRateDto) {
    const r = await findOwned(this.db, serviceRates, u.tenantId, id);
    if (!r) throw new NotFoundException('Tarif tidak ditemukan');
    const rate = dto.rate !== undefined ? D(dto.rate) : D(r.rate);
    this.checkRate(r.unit, rate);
    const [row] = await this.repo.updateServiceRatesById(this.db, rate, dto, r.isActive, id);
    // tarif baru hanya berlaku untuk catatan berikutnya; catatan lama memakai tarif saat dibuat
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'ServiceRate', entityId: id, data: { before: { rate: r.rate, isActive: r.isActive }, after: { rate: row.rate, isActive: row.isActive } } });
    return row;
  }

  private checkRate(unit: string, rate: Dec) {
    if (rate.lte(0)) throw new BadRequestException('Tarif harus lebih dari 0');
    if (unit === 'PERCENT' && rate.gt(100)) throw new BadRequestException('Persen komisi maksimal 100');
    if (unit !== 'PERCENT' && rate.gt(1_000_000_000)) throw new BadRequestException('Tarif tidak masuk akal');
  }

  async list(u: AuthUser, q: EntryQueryDto) {
    const range = q.period ? monthRange(q.period) : null;
    const rows = await this.repo.queryServiceWorkEntry(this.db, u, range, q);
    return rows.rows;
  }

  /** Perintah produksi yang bisa dijadikan dasar upah per hasil (sedang berjalan atau selesai) */
  async productionOrdersForPay(u: AuthUser) {
    const rows = await this.repo.queryProductionOrder(this.db, u.tenantId);
    return rows.rows;
  }

  /** Faktur jasa lunas yang bisa dikomisikan, beserta persen yang sudah dibagikan */
  async commissionableInvoices(u: AuthUser) {
    await this.requireJasa(u.tenantId);
    const since = addDays(todayJakarta(), -180);
    const rows = await this.repo.queryInvoice(this.db, u.tenantId, since);
    return rows.rows;
  }

  async create(u: AuthUser, dto: CreateEntryDto) {
    const today = todayJakarta();
    const workDate = dto.workDate ?? today;
    if (workDate > today) throw new BadRequestException('Tanggal kerja tidak boleh di masa depan');
    if (workDate < addDays(today, -MAX_BACKDATE_DAYS)) throw new BadRequestException(`Catatan kerja maksimal ${MAX_BACKDATE_DAYS} hari ke belakang`);

    return this.db.transaction(async (tx) => {
      // kunci baris pegawai: mencegah dua catatan bersamaan melewati batas jam harian
      const lock = await this.repo.queryEmployeeForCreate(tx, dto.employeeId, u.tenantId);
      if (!lock.rows.length) throw new NotFoundException('Pegawai tidak ditemukan');
      const [emp] = await this.repo.findEmployeesById(tx, dto.employeeId);
      if (!emp.isActive && !emp.resignDate) throw new BadRequestException('Pegawai tidak aktif');
      if (emp.userId && emp.userId === u.sub) throw new ForbiddenException('Anda tidak dapat mencatat upah jasa untuk diri sendiri');
      if (!emp.verified) throw new BadRequestException('Karyawan ini belum diverifikasi; belum bisa dicatat upahnya');
      if (workDate < emp.joinDate) throw new BadRequestException('Tanggal kerja sebelum pegawai bergabung');
      if (emp.resignDate && workDate > emp.resignDate) throw new BadRequestException('Tanggal kerja setelah pegawai keluar');
      if (emp.contractEnd && workDate > emp.contractEnd) throw new BadRequestException(`Kontrak pegawai berakhir ${emp.contractEnd}; perpanjang kontrak (dengan persetujuan) sebelum mencatat kerja sesudahnya`);
      if (emp.contractStart && workDate < emp.contractStart) throw new BadRequestException('Tanggal kerja sebelum kontrak dimulai');

      const rate = await findOwned(tx, serviceRates, u.tenantId, dto.rateId);
      if (!rate) throw new NotFoundException('Tarif tidak ditemukan');
      if (!rate.isActive) throw new BadRequestException('Tarif ini sudah tidak aktif');
      if (!(await this.unitsOf(u.tenantId, tx)).includes(rate.unit)) throw new BadRequestException('Satuan tarif ini tidak dipakai di jenis usaha Anda');

      let projectId = dto.projectId ?? null;
      if (projectId) {
        const [p] = await this.repo.findProjectsById(tx, projectId, u.tenantId);
        if (!p) throw new BadRequestException('Proyek tidak ditemukan');
      }

      let productionOrderId: string | null = null;
      let quantity: Dec;
      let baseAmount: Dec | null = null;
      let amount: Dec;
      let invoiceId: string | null = null;
      if (rate.unit === 'PERCENT') {
        if (!dto.invoiceId) throw new BadRequestException('Komisi harus dikaitkan ke faktur jasa yang sudah lunas');
        const inv = await this.repo.queryInvoiceForCreate(tx, dto.invoiceId, u.tenantId);
        if (!inv.rows.length) throw new BadRequestException('Faktur harus faktur jasa yang sudah LUNAS, tidak dibatalkan, dan tanpa retur');
        const allocated = await this.repo.queryServiceWorkEntryForCreate(tx, dto.invoiceId);
        if (D(allocated.rows[0].pct).plus(rate.rate).gt(100)) throw new BadRequestException('Total persen komisi untuk faktur ini melebihi 100%');
        invoiceId = dto.invoiceId;
        projectId = projectId ?? inv.rows[0].project_id;
        baseAmount = D(inv.rows[0].subtotal);
        quantity = D(1);
        amount = money(baseAmount.times(rate.rate).div(100));
      } else {
        if (dto.invoiceId) throw new BadRequestException('Faktur hanya untuk tarif komisi');
        if (dto.productionOrderId && rate.unit !== 'PIECE') throw new BadRequestException('Perintah produksi hanya untuk tarif per hasil');
        quantity = D(dto.quantity ?? NaN);
        if (!quantity.isFinite() || quantity.lte(0)) throw new BadRequestException('Jumlah harus lebih dari 0');
        if (quantity.decimalPlaces() > 2) throw new BadRequestException('Jumlah maksimal 2 angka di belakang koma');
        if (rate.unit === 'HOUR') {
          if (quantity.gt(MAX_HOURS_PER_DAY)) throw new BadRequestException(`Satu catatan maksimal ${MAX_HOURS_PER_DAY} jam`);
          const day = await this.repo.queryServiceWorkEntryForCreate2(tx, emp.id, workDate);
          if (D(day.rows[0].h).plus(quantity).gt(MAX_HOURS_PER_DAY)) throw new BadRequestException(`Jam kerja pegawai pada tanggal itu melebihi ${MAX_HOURS_PER_DAY} jam per hari`);
        } else if (rate.unit === 'SHIFT') {
          if (!quantity.isInteger()) throw new BadRequestException('Jumlah shift harus bilangan bulat');
          const day = await this.repo.queryServiceWorkEntryForCreate3(tx, emp.id, workDate);
          if (D(day.rows[0].n).plus(quantity).gt(WORK_LIMITS.shiftPerDay)) throw new BadRequestException(`Satu pegawai maksimal ${WORK_LIMITS.shiftPerDay} shift per hari`);
        } else if (rate.unit === 'PIECE') {
          if (quantity.gt(WORK_LIMITS.maxPieceQty)) throw new BadRequestException('Jumlah hasil terlalu besar untuk satu catatan');
          if (dto.productionOrderId) {
            // jumlah hasil yang dibayarkan per perintah produksi tidak boleh melebihi keluarannya (aktual bila selesai, rencana bila berjalan)
            const po = await lockOwned(tx, productionOrders, u.tenantId, dto.productionOrderId);
            if (!po) throw new BadRequestException('Perintah produksi tidak ditemukan');
            if (po.status !== 'IN_PROGRESS' && po.status !== 'COMPLETED') throw new BadRequestException('Perintah produksi harus sedang berjalan atau sudah selesai');
            const cap = D(po.status === 'COMPLETED' ? po.outputQty : po.plannedQty);
            const used = await this.repo.queryServiceWorkEntryForCreate4(tx, po.id, rate.id);
            if (D(used.rows[0].q).plus(quantity).gt(cap)) throw new BadRequestException(`Jumlah hasil melebihi keluaran perintah produksi ${po.number} (${cap.toFixed(2)} sudah termasuk catatan lain untuk tarif ini)`);
            productionOrderId = po.id;
          }
        } else if (quantity.gt(100)) {
          throw new BadRequestException('Jumlah sesi / pekerjaan terlalu besar untuk satu catatan');
        }
        const [att] = await this.repo.findAttendancesByEmployeeIdAndDate(tx, emp.id, workDate);
        if (att && att.status !== 'HADIR') throw new BadRequestException(`Absensi pegawai pada ${workDate} tercatat ${att.status}; tidak bisa ada catatan kerja`);
        amount = money(quantity.times(rate.rate));
      }
      const dup = await this.repo.queryServiceWorkEntryForCreate5(tx, emp.id, workDate, rate.id, quantity, projectId, invoiceId, productionOrderId);
      if (dup.rows.length) throw new BadRequestException('Catatan yang sama persis sudah ada');

      const row = await insertOne(tx, serviceWorkEntries, {
          tenantId: u.tenantId,
          employeeId: emp.id,
          rateId: rate.id,
          unit: rate.unit,
          workDate,
          projectId,
          invoiceId,
          productionOrderId,
          quantity: quantity.toFixed(2),
          rate: D(rate.rate).toFixed(2),
          baseAmount: baseAmount ? baseAmount.toFixed(2) : null,
          amount: amount.toFixed(2),
          description: dto.description ?? null,
          createdById: u.sub,
        });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'ServiceWorkEntry', entityId: row.id, data: { employee: emp.code, unit: row.unit, workDate, quantity: row.quantity, rate: row.rate, amount: row.amount, invoiceId } });
      void this.approvals.notifyRoles(u.tenantId, { roles: ['FINANCE', 'ADMIN', 'OWNER'], excludeUserId: u.sub, title: `Catatan upah kerja menunggu persetujuan: ${emp.code} · Rp${Math.round(amount.toNumber()).toLocaleString('id-ID')}`, lines: [`Dicatat oleh ${u.email ?? 'HR'} untuk tanggal ${workDate}`], path: '/payroll/jasa' });
      return row;
    });
  }

  private async lockEntry(tx: Tx, tenantId: string, id: string) {
    const e = await lockOwned(tx, serviceWorkEntries, tenantId, id);
    if (!e) throw new NotFoundException('Catatan kerja tidak ditemukan');
    return e;
  }

  /** Pemisahan fungsi saat memutuskan: bukan pegawai yang bersangkutan, dan bukan pembuat catatan (kecuali Pemilik) */
  private async assertCanDecide(tx: Tx, u: AuthUser, e: typeof serviceWorkEntries.$inferSelect) {
    const [emp] = await this.repo.findEmployeesByIdForAssertCanDecide(tx, e.employeeId);
    if (emp?.userId && emp.userId === u.sub) throw new ForbiddenException('Anda tidak dapat memutuskan catatan upah Anda sendiri');
    if (e.createdById === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Catatan harus diputuskan oleh orang lain dari pembuatnya (pemisahan fungsi)');
  }

  async approve(u: AuthUser, id: string, dto: DecideEntryDto) {
    return this.db.transaction(async (tx) => {
      const e = await this.lockEntry(tx, u.tenantId, id);
      if (e.status !== 'PENDING') throw new BadRequestException('Catatan ini sudah diputuskan');
      await this.assertCanDecide(tx, u, e);
      if (e.unit === 'PERCENT') {
        const ok = await this.repo.queryInvoiceForApprove(tx, e.invoiceId);
        if (!ok.rows.length) throw new BadRequestException('Faktur komisi ini tidak lagi layak (belum lunas / dibatalkan / ada retur)');
      }
      const [row] = await this.repo.updateServiceWorkEntriesById(tx, u.sub, dto, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'ServiceWorkEntry', entityId: id, data: { amount: e.amount, createdBy: e.createdById } });
      return row;
    });
  }

  async reject(u: AuthUser, id: string, dto: VoidEntryDto) {
    return this.db.transaction(async (tx) => {
      const e = await this.lockEntry(tx, u.tenantId, id);
      if (e.status !== 'PENDING') throw new BadRequestException('Catatan ini sudah diputuskan');
      await this.assertCanDecide(tx, u, e);
      const [row] = await this.repo.updateServiceWorkEntriesByIdForReject(tx, u.sub, dto.reason, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'ServiceWorkEntry', entityId: id, data: { reason: dto.reason } });
      return row;
    });
  }

  /** Batalkan: pembuat boleh menarik catatan yang masih menunggu; keuangan boleh membatalkan yang sudah disetujui selama gajinya belum diposting */
  async voidIt(u: AuthUser, id: string, dto: VoidEntryDto) {
    return this.db.transaction(async (tx) => {
      const e = await this.lockEntry(tx, u.tenantId, id);
      if (e.status === 'REJECTED' || e.status === 'VOID') throw new BadRequestException('Catatan ini sudah ditolak / dibatalkan');
      const isDecider = ['FINANCE', 'ADMIN', 'OWNER'].includes(u.role);
      if (e.status === 'APPROVED' && !isDecider) throw new ForbiddenException('Catatan yang sudah disetujui hanya dapat dibatalkan oleh Keuangan / Admin');
      if (e.status === 'PENDING' && !isDecider && e.createdById !== u.sub) throw new ForbiddenException('Hanya pembuat catatan yang dapat menariknya');
      if (e.runId) {
        const [run] = await this.repo.queryPayrollRun(tx, e.runId);
        if (run && run.status !== 'DRAFT') throw new BadRequestException(`Sudah masuk gaji ${run.number} yang diposting; tidak bisa dibatalkan`);
      }
      const [row] = await this.repo.updateServiceWorkEntriesByIdForVoidIt(tx, dto.reason, u.sub, id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'VOID', entity: 'ServiceWorkEntry', entityId: id, data: { reason: dto.reason, wasStatus: e.status, amount: e.amount } });
      return row;
    });
  }

  /** Hal yang patut diperiksa pemilik / keuangan sebelum memposting gaji */
  async anomalies(u: AuthUser, period: string) {
    const { from, to } = monthRange(period);
    const out: { kind: string; severity: 'warn' | 'info'; message: string; employeeId?: string }[] = [];
    const hours = await this.db.execute<{ employee_id: string; name: string; h: string }>(sql`
      SELECT w.employee_id, e.name, SUM(w.quantity) AS h FROM service_work_entries w JOIN employees e ON e.id = w.employee_id
      WHERE w.tenant_id = ${u.tenantId} AND w.unit = 'HOUR' AND w.status IN ('PENDING','APPROVED') AND w.work_date BETWEEN ${from} AND ${to}
      GROUP BY w.employee_id, e.name HAVING SUM(w.quantity) > ${MAX_HOURS_PER_MONTH}`);
    for (const r of hours.rows) out.push({ kind: 'JAM_BERLEBIH', severity: 'warn', employeeId: r.employee_id, message: `${r.name}: ${D(r.h).toFixed(1)} jam dalam sebulan (batas wajar ${MAX_HOURS_PER_MONTH})` });
    const stuck = await this.repo.queryServiceWorkEntryForAnomalies(this.db, u.tenantId, to);
    for (const r of stuck.rows) out.push({ kind: 'KOMISI_TERTAHAN', severity: 'warn', employeeId: r.employee_id, message: `Komisi ${r.name} dari faktur ${r.number ?? '-'} tertahan: faktur belum lunas, dibatalkan, atau diretur` });
    const conflict = await this.repo.queryServiceWorkEntryForAnomalies2(this.db, u.tenantId, from, to);
    for (const r of conflict.rows) out.push({ kind: 'BENTROK_ABSENSI', severity: 'warn', employeeId: r.employee_id, message: `${r.name}: ada catatan kerja pada ${r.d} padahal absensi ${r.st}` });
    const big = await this.repo.queryServiceWorkEntryForAnomalies3(this.db, u.tenantId, from, to);
    for (const r of big.rows) out.push({ kind: 'UPAH_JASA_BESAR', severity: 'info', employeeId: r.employee_id, message: `${r.name}: upah kerja bulan ini lebih dari 3× gaji tetapnya` });
    // premi shift berlebihan dan hasil per perintah produksi yang sudah melebihi keluaran (mis. setelah keluaran dikoreksi)
    const shifts = await this.repo.queryServiceWorkEntryForAnomalies4(this.db, u.tenantId, from, to);
    for (const r of shifts.rows) out.push({ kind: 'SHIFT_BERLEBIH', severity: 'warn', employeeId: r.employee_id, message: `${r.name}: ${D(r.n).toFixed(0)} shift dalam sebulan (lebih dari 31)` });
    const over = await this.repo.queryServiceWorkEntryForAnomalies5(this.db, u.tenantId);
    for (const r of over.rows) out.push({ kind: 'HASIL_MELEBIHI_PRODUKSI', severity: 'warn', message: `Perintah produksi ${r.number}: hasil yang dibayar ${D(r.paid).toFixed(2)} melebihi keluaran ${D(r.cap).toFixed(2)}` });
    return out;
  }
}

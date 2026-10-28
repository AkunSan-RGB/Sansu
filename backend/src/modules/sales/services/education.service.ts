import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthUser } from '../../../common/auth/auth-user';
import { toDocDate, todayJakarta } from '../../../common/utils/dates';
import { D } from '../../../common/utils/money';
import { Db } from '../../../db/db';
import { InjectDb } from '../../../db/db.module';
import { EduBillDto, EduClassDto, EduClassUpdateDto, EduEnrollDto, EduLeaveDto } from './education.dto';
import { EducationRepository } from './education.repository';
import { ServiceBillingService } from './service-billing.service';

const isUnique = (e: unknown) => ((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === '23505';

/** Pendidikan/kursus: kelas, pendaftaran peserta, dan tagihan SPP bulanan (satu faktur per wali, satu baris per peserta) */
@Injectable()
export class EducationService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly billing: ServiceBillingService,
    private readonly repo: EducationRepository,
  ) {}

  async classes(tenantId: string) {
    const rows = (await this.repo.listClasses(this.db, tenantId)).rows;
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, monthlyFee: r.monthly_fee, capacity: r.capacity, startDate: r.start_date, endDate: r.end_date, isActive: r.is_active, students: Number(r.active_students) }));
  }

  async createClass(u: AuthUser, dto: EduClassDto) {
    if (D(dto.monthlyFee).lte(0)) throw new BadRequestException('SPP per bulan harus lebih dari 0');
    const start = toDocDate(dto.startDate);
    const end = dto.endDate ? toDocDate(dto.endDate) : null;
    if (end && end < start) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    try {
      const r = (await this.repo.insertClass(this.db, u.tenantId, { code: dto.code.trim().toUpperCase(), name: dto.name, fee: D(dto.monthlyFee).toFixed(2), capacity: dto.capacity ?? null, start, end })).rows[0];
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'EduClass', entityId: r.id, data: dto });
      return { id: r.id };
    } catch (e) {
      if (isUnique(e)) throw new ConflictException(`Kode kelas ${dto.code} sudah dipakai`);
      throw e;
    }
  }

  /** Perubahan SPP berlaku untuk periode yang belum ditagih saja */
  async updateClass(u: AuthUser, id: string, dto: EduClassUpdateDto) {
    const cur = (await this.repo.findClass(this.db, u.tenantId, id)).rows[0];
    if (!cur) throw new NotFoundException('Kelas tidak ditemukan');
    if (dto.monthlyFee !== undefined && D(dto.monthlyFee).lte(0)) throw new BadRequestException('SPP per bulan harus lebih dari 0');
    const end = dto.endDate ? toDocDate(dto.endDate) : null;
    if (end && end < String(cur.start_date)) throw new BadRequestException('Tanggal akhir sebelum tanggal mulai');
    await this.repo.updateClass(this.db, id, { fee: dto.monthlyFee !== undefined ? D(dto.monthlyFee).toFixed(2) : null, capacity: dto.capacity ?? null, end, isActive: dto.isActive ?? null });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'EduClass', entityId: id, data: { reason: dto.reason, before: { fee: cur.monthly_fee, capacity: cur.capacity, isActive: cur.is_active }, after: dto } });
    return { id };
  }

  async enrollments(tenantId: string, classId?: string) {
    const rows = (await this.repo.listEnrollments(this.db, tenantId, classId)).rows;
    return rows.map((r) => ({ id: r.id, classId: r.class_id, className: r.class_name, customerId: r.customer_id, customerName: r.customer_name, studentName: r.student_name, enrolledOn: r.enrolled_on, leftOn: r.left_on, discountPct: r.discount_pct, monthlyFee: r.monthly_fee, billedPeriods: r.billed }));
  }

  /** Kuota diperiksa di bawah kunci baris kelas agar dua pendaftaran bersamaan tidak melampaui kapasitas */
  async enroll(u: AuthUser, dto: EduEnrollDto) {
    const disc = D(dto.discountPct ?? '0');
    if (!disc.isFinite() || disc.lt(0) || disc.gt(100)) throw new BadRequestException('Diskon harus 0–100%');
    if (!(await this.repo.findCustomer(this.db, u.tenantId, dto.customerId)).rows.length) throw new BadRequestException('Wali/pelanggan tidak ditemukan / nonaktif');
    const date = toDocDate(dto.enrolledOn);
    return this.db.transaction(async (tx) => {
      const cls = (await this.repo.findClass(tx, u.tenantId, dto.classId, true)).rows[0];
      if (!cls) throw new NotFoundException('Kelas tidak ditemukan');
      if (!cls.is_active) throw new BadRequestException('Kelas sudah ditutup');
      if (cls.capacity && Number((await this.repo.countActiveStudents(tx, dto.classId)).rows[0].n) >= cls.capacity) throw new BadRequestException(`Kelas ${cls.name} sudah penuh (kuota ${cls.capacity})`);
      const r = (await this.repo.insertEnrollment(tx, u.tenantId, { classId: dto.classId, customerId: dto.customerId, studentName: dto.studentName.trim(), enrolledOn: date, discount: disc.toFixed(2) })).rows[0];
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'EduEnrollment', entityId: r.id, data: dto });
      return { id: r.id };
    });
  }

  /** Peserta keluar: SPP dihentikan mulai bulan setelah bulan keluar (bulan keluar tetap ditagih penuh) */
  async leave(u: AuthUser, id: string, dto: EduLeaveDto) {
    const e = (await this.repo.findEnrollment(this.db, u.tenantId, id)).rows[0];
    if (!e) throw new NotFoundException('Pendaftaran tidak ditemukan');
    if (e.left_on) throw new BadRequestException('Peserta sudah tercatat keluar');
    const leftOn = toDocDate(dto.leftOn);
    if (leftOn < String(e.enrolled_on)) throw new BadRequestException('Tanggal keluar sebelum tanggal masuk');
    await this.repo.leave(this.db, id, leftOn);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'EduEnrollment', entityId: id, data: { reason: dto.reason, leftOn } });
    return { id };
  }

  private async lines(tenantId: string, period: string) {
    const due = (await this.repo.dueEnrollments(this.db, tenantId, period)).rows;
    const byParent = new Map<string, typeof due>();
    for (const d of due) byParent.set(d.customer_id, [...(byParent.get(d.customer_id) ?? []), d]);
    return byParent;
  }

  /** SPP yang belum ditagih pada periode: dikelompokkan per wali */
  async due(tenantId: string, period: string) {
    const map = await this.lines(tenantId, period);
    return [...map.entries()].map(([customerId, rows]) => ({
      customerId,
      students: rows.map((r) => ({ enrollmentId: r.id, studentName: r.student_name, className: r.class_name, amount: D(r.monthly_fee).times(D(100).minus(r.discount_pct)).div(100).toFixed(2) })),
      total: rows.reduce((a, r) => a.plus(D(r.monthly_fee).times(D(100).minus(r.discount_pct)).div(100)), D(0)).toFixed(2),
    }));
  }

  /** Tagih SPP satu periode: satu faktur per wali; indeks unik (peserta, periode) menggagalkan penagihan ganda bersamaan secara utuh */
  async bill(u: AuthUser, dto: EduBillDto) {
    if (dto.period > todayJakarta().slice(0, 7)) throw new BadRequestException('Periode di masa depan belum dapat ditagih');
    const map = await this.lines(u.tenantId, dto.period);
    if (!map.size) throw new BadRequestException(`Tidak ada SPP yang perlu ditagih untuk periode ${dto.period}`);
    const out: { customerId: string; invoiceId: string; number: string; total: string }[] = [];
    for (const [customerId, rows] of map) {
      const lines = rows.map((r) => ({ description: `SPP ${r.class_name} — ${r.student_name} (${dto.period})`, qty: '1', unit: 'Bulan', price: D(r.monthly_fee).times(D(100).minus(r.discount_pct)).div(100).toFixed(2) }));
      const inv = await this.billing.createInvoice(
        u,
        { customerId, date: dto.date, description: `SPP periode ${dto.period}`, termLabel: `SPP ${dto.period}`, lines },
        {
          inTx: async (tx, invoice) => {
            try {
              for (const [i, r] of rows.entries()) await this.repo.insertFee(tx, u.tenantId, r.id, dto.period, invoice.id, lines[i].price);
            } catch (e) {
              if (isUnique(e)) throw new ConflictException(`SPP periode ${dto.period} sudah ditagih`);
              throw e;
            }
            await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'EduBilling', entityId: invoice.id, data: { period: dto.period, students: rows.length } });
          },
        },
      );
      out.push({ customerId, invoiceId: inv.id, number: inv.number, total: lines.reduce((a, l) => a.plus(l.price), D(0)).toFixed(2) });
    }
    return { period: dto.period, invoices: out };
  }
}

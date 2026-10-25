// Skema database — hr
import { relations, sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, encryptedText, id, money } from './columns';
import { branches, tenantId, users } from './tenancy';
import { attendanceStatusEnum, leaveStatusEnum, leaveTypeEnum, payrollStatusEnum } from './enums';
import { accounts } from './accounting';
import { invoices } from './sales';
import { productionOrders } from './production';

export const employees = pgTable(
  'employees',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    nik: encryptedText('nik'),
    npwp: encryptedText('npwp'),
    ptkp: text('ptkp').notNull().default('TK/0'),
    jobTitle: text('job_title'),
    department: text('department'),
    joinDate: date('join_date').notNull(),
    birthDate: date('birth_date'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    bankName: text('bank_name'),
    bankAccount: encryptedText('bank_account'),
    baseSalary: money('base_salary').notNull().default('0'),
    /** Tunjangan tetap bulanan (ikut dasar BPJS) */
    fixedAllowance: money('fixed_allowance').notNull().default('0'),
    /** Uang makan/transport per hari hadir */
    dailyAllowance: money('daily_allowance').notNull().default('0'),
    bpjsKes: boolean('bpjs_kes').notNull().default(true),
    bpjsTk: boolean('bpjs_tk').notNull().default(true),
    /** Jaminan Pensiun (umumnya diikuti karyawan < usia pensiun) */
    bpjsJp: boolean('bpjs_jp').notNull().default(true),
    annualLeave: integer('annual_leave').notNull().default(12),
    userId: uuid('user_id').references(() => users.id),
    /** Ditempatkan di proyek: gaji & iuran BPJS perusahaan menjadi biaya langsung proyek */
    projectId: uuid('project_id'),
    /** Tenaga kerja langsung produksi: gaji & iuran BPJS perusahaan dicatat ke Upah Langsung Produksi (bagian HPP) */
    isProduction: boolean('is_production').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    resignDate: date('resign_date'),
    /** Status kepegawaian: TETAP · KONTRAK (PKWT) · HARIAN · TENAGA_LEPAS (dibayar per catatan kerja) · MAGANG · MITRA. Selain TETAP hanya untuk usaha jasa. */
    employmentType: text('employment_type').$type<'TETAP' | 'KONTRAK' | 'HARIAN' | 'TENAGA_LEPAS' | 'MAGANG' | 'MITRA'>().notNull().default('TETAP'),
    contractStart: date('contract_start'),
    /** Akhir kontrak / magang: gaji otomatis berhenti di tanggal ini kecuali diperpanjang lewat persetujuan */
    contractEnd: date('contract_end'),
    /** Upah per hari hadir (status HARIAN) */
    dailyWage: money('daily_wage').notNull().default('0'),
    /** Usaha jasa: karyawan baru baru ikut penggajian setelah diverifikasi orang lain (cegah karyawan fiktif) */
    verified: boolean('verified').notNull().default(true),
    createdById: uuid('created_by_id'),
    verifiedById: uuid('verified_by_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
    /** Cabang tempat karyawan bekerja: gaji & BPJS otomatis berlabel cabang ini */
    branchId: uuid('branch_id').references((): AnyPgColumn => branches.id),
  },
  (t) => [uniqueIndex('employees_code_uq').on(t.tenantId, t.code)],
);

export const attendances = pgTable(
  'attendances',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    date: date('date').notNull(),
    status: attendanceStatusEnum('status').notNull(),
    checkIn: text('check_in'),
    checkOut: text('check_out'),
    overtimeHours: numeric('overtime_hours', { precision: 5, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('attendances_emp_date_uq').on(t.employeeId, t.date), index('attendances_tenant_date_idx').on(t.tenantId, t.date)],
);

export const leaveRequests = pgTable('leave_requests', {
  id: id(),
  tenantId: tenantId(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  type: leaveTypeEnum('type').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  days: integer('days').notNull(),
  reason: text('reason'),
  status: leaveStatusEnum('status').notNull().default('PENDING'),
  decidedById: uuid('decided_by_id'),
  createdAt: createdAt(),
});

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    /** YYYY-MM */
    period: text('period').notNull(),
    payDate: date('pay_date').notNull(),
    status: payrollStatusEnum('status').notNull().default('DRAFT'),
    totalGross: money('total_gross').notNull().default('0'),
    totalEmployerCost: money('total_employer_cost').notNull().default('0'),
    totalPph21: money('total_pph21').notNull().default('0'),
    totalNet: money('total_net').notNull().default('0'),
    journalId: uuid('journal_id'),
    paymentJournalId: uuid('payment_journal_id'),
    cashAccountId: uuid('cash_account_id').references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payroll_runs_period_uq').on(t.tenantId, t.period), uniqueIndex('payroll_runs_number_uq').on(t.tenantId, t.number)],
);

export const payslips = pgTable(
  'payslips',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    workDays: integer('work_days').notNull(),
    presentDays: integer('present_days').notNull(),
    absentDays: integer('absent_days').notNull().default(0),
    overtimeHours: numeric('overtime_hours', { precision: 6, scale: 2 }).notNull().default('0'),
    baseSalary: money('base_salary').notNull(),
    fixedAllowance: money('fixed_allowance').notNull(),
    dailyAllowance: money('daily_allowance').notNull(),
    overtimePay: money('overtime_pay').notNull(),
    otherIncome: money('other_income').notNull().default('0'),
    /** Upah jasa (jam, sesi, borongan, komisi faktur) dari catatan kerja yang sudah disetujui; sudah termasuk di gross_pay */
    serviceIncome: money('service_income').notNull().default('0'),
    absenceDeduction: money('absence_deduction').notNull().default('0'),
    /** Penghasilan tunai sebelum potongan */
    grossPay: money('gross_pay').notNull(),
    bpjsKesEmployee: money('bpjs_kes_employee').notNull(),
    jhtEmployee: money('jht_employee').notNull(),
    jpEmployee: money('jp_employee').notNull(),
    bpjsKesCompany: money('bpjs_kes_company').notNull(),
    jhtCompany: money('jht_company').notNull(),
    jpCompany: money('jp_company').notNull(),
    jkkCompany: money('jkk_company').notNull(),
    jkmCompany: money('jkm_company').notNull(),
    /** Penghasilan bruto untuk PPh 21 (termasuk premi JKK, JKM, BPJS Kes dari perusahaan) */
    taxableGross: money('taxable_gross').notNull(),
    terCategory: text('ter_category').notNull(),
    terRate: numeric('ter_rate', { precision: 5, scale: 2 }).notNull(),
    pph21: money('pph21').notNull(),
    otherDeduction: money('other_deduction').notNull().default('0'),
    netPay: money('net_pay').notNull(),
    notes: text('notes'),
    /** Proyek tempat karyawan bekerja pada periode ini (salinan saat gaji dihitung) */
    projectId: uuid('project_id'),
  },
  (t) => [uniqueIndex('payslips_run_emp_uq').on(t.runId, t.employeeId)],
);

/** Usaha jasa: perubahan data sensitif karyawan (gaji, rekening, status, kontrak, pajak) oleh HR baru berlaku setelah disetujui orang lain */
export const employeeChangeRequests = pgTable(
  'employee_change_requests',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    /** { kolom: { from, to } } */
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    reason: text('reason'),
    status: text('status').$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>().notNull().default('PENDING'),
    requestedById: uuid('requested_by_id').notNull(),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('employee_change_pending_uq').on(t.employeeId).where(sql`status = 'PENDING'`)],
);

/** Kartu tarif usaha jasa: tarif per jam / sesi / borongan, atau persen komisi faktur. Yang mengisi catatan kerja tidak bisa mengubah tarif. */
export const serviceRates = pgTable(
  'service_rates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** HOUR = per jam · SESSION = per sesi · JOB = borongan per pekerjaan · PERCENT = persen dari nilai faktur jasa */
    unit: text('unit').$type<'HOUR' | 'SESSION' | 'JOB' | 'PERCENT' | 'SHIFT' | 'PIECE'>().notNull(),
    rate: numeric('rate', { precision: 18, scale: 2 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('service_rates_name_uq').on(t.tenantId, t.name)],
);

/** Catatan kerja pegawai jasa → upah variabel di slip gaji. Dibuat HR, disetujui orang lain; angka dihitung server dari tarif (disalin saat dibuat). */
export const serviceWorkEntries = pgTable(
  'service_work_entries',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    rateId: uuid('rate_id')
      .notNull()
      .references(() => serviceRates.id),
    unit: text('unit').$type<'HOUR' | 'SESSION' | 'JOB' | 'PERCENT' | 'SHIFT' | 'PIECE'>().notNull(),
    workDate: date('work_date').notNull(),
    projectId: uuid('project_id'),
    /** Hanya untuk komisi: faktur jasa yang dikomisikan */
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    /** Upah per hasil (pabrik): perintah produksi yang dikerjakan; jumlah hasil dibatasi oleh keluaran perintah itu */
    productionOrderId: uuid('production_order_id').references(() => productionOrders.id),
    /** Premi shift otomatis dari jadwal: penugasan yang menjadi dasarnya (satu penugasan hanya satu premi) */
    shiftAssignmentId: uuid('shift_assignment_id'),
    /** Jam / sesi / pekerjaan; untuk komisi = persen */
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
    rate: numeric('rate', { precision: 18, scale: 2 }).notNull(),
    /** Dasar komisi (nilai faktur sebelum PPN) — kosong untuk jam/sesi/borongan */
    baseAmount: money('base_amount'),
    amount: money('amount').notNull(),
    description: text('description'),
    /** PENDING → APPROVED | REJECTED; APPROVED → VOID (sebelum dibayar) */
    status: text('status').$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'VOID'>().notNull().default('PENDING'),
    createdById: uuid('created_by_id').notNull(),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    /** Penggajian yang memuat catatan ini (kosong = belum digaji) */
    runId: uuid('run_id').references(() => payrollRuns.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('service_work_emp_date_idx').on(t.tenantId, t.employeeId, t.workDate),
    index('service_work_status_idx').on(t.tenantId, t.status, t.runId),
    uniqueIndex('service_work_commission_uq').on(t.tenantId, t.invoiceId, t.employeeId).where(sql`invoice_id IS NOT NULL AND status IN ('PENDING','APPROVED')`),
  ],
);

export const employeesRelations = relations(employees, ({ one, many }) => ({
  user: one(users, { fields: [employees.userId], references: [users.id] }),
  attendances: many(attendances),
  leaves: many(leaveRequests),
}));

export const attendancesRelations = relations(attendances, ({ one }) => ({
  employee: one(employees, { fields: [attendances.employeeId], references: [employees.id] }),
}));

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  employee: one(employees, { fields: [leaveRequests.employeeId], references: [employees.id] }),
}));

export const payrollRunsRelations = relations(payrollRuns, ({ many, one }) => ({
  payslips: many(payslips),
  cashAccount: one(accounts, { fields: [payrollRuns.cashAccountId], references: [accounts.id] }),
}));

export const payslipsRelations = relations(payslips, ({ one }) => ({
  run: one(payrollRuns, { fields: [payslips.runId], references: [payrollRuns.id] }),
  employee: one(employees, { fields: [payslips.employeeId], references: [employees.id] }),
}));

/** Templat shift: jam kerja, jumlah minimal petugas, dan tarif premi (kartu tarif satuan SHIFT) */
export const shiftTemplates = pgTable(
  'shift_templates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    minStaff: integer('min_staff').notNull().default(1),
    premiumRateId: uuid('premium_rate_id').references(() => serviceRates.id),
    isActive: boolean('is_active').notNull().default(true),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('shift_templates_name_uq').on(t.tenantId, t.name)],
);

/** Penugasan pegawai ke shift pada tanggal tertentu (jadwal / roster) */
export const shiftAssignments = pgTable(
  'shift_assignments',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => shiftTemplates.id),
    workDate: date('work_date').notNull(),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('shift_assignments_uq').on(t.employeeId, t.workDate, t.templateId), index('shift_assignments_date_idx').on(t.tenantId, t.workDate)],
);

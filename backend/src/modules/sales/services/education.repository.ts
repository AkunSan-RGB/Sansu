import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../../db/db';

export type EduClassRow = { id: string; code: string; name: string; monthly_fee: string; capacity: number | null; start_date: string; end_date: string | null; is_active: boolean; active_students: string };
export type EduEnrollRow = { id: string; class_id: string; class_name: string; monthly_fee: string; customer_id: string; customer_name: string; student_name: string; enrolled_on: string; left_on: string | null; discount_pct: string };

/** Akses data modul pendidikan: kueri dipisah dari logika bisnis */
@Injectable()
export class EducationRepository {
  listClasses(db: DbOrTx, tenantId: string) {
    return db.execute<EduClassRow>(
      sql`SELECT c.id, c.code, c.name, c.monthly_fee, c.capacity, c.start_date, c.end_date, c.is_active,
          (SELECT COUNT(*) FROM edu_enrollments e WHERE e.class_id = c.id AND e.left_on IS NULL)::text AS active_students
          FROM edu_classes c WHERE c.tenant_id = ${tenantId} ORDER BY c.code`,
    );
  }

  findClass(db: DbOrTx, tenantId: string, id: string, lock = false) {
    return db.execute<EduClassRow>(
      lock
        ? sql`SELECT c.*, '0' AS active_students FROM edu_classes c WHERE c.id = ${id} AND c.tenant_id = ${tenantId} FOR UPDATE`
        : sql`SELECT c.*, '0' AS active_students FROM edu_classes c WHERE c.id = ${id} AND c.tenant_id = ${tenantId}`,
    );
  }

  insertClass(db: DbOrTx, tenantId: string, v: { code: string; name: string; fee: string; capacity: number | null; start: string; end: string | null }) {
    return db.execute<{ id: string }>(
      sql`INSERT INTO edu_classes (tenant_id, code, name, monthly_fee, capacity, start_date, end_date) VALUES (${tenantId}, ${v.code}, ${v.name}, ${v.fee}, ${v.capacity}, ${v.start}, ${v.end}) RETURNING id`,
    );
  }

  updateClass(db: DbOrTx, id: string, v: { fee: string | null; capacity: number | null; end: string | null; isActive: boolean | null }) {
    return db.execute(
      sql`UPDATE edu_classes SET monthly_fee = COALESCE(${v.fee}::numeric, monthly_fee), capacity = COALESCE(${v.capacity}::int, capacity), end_date = COALESCE(${v.end}::date, end_date), is_active = COALESCE(${v.isActive}::boolean, is_active) WHERE id = ${id}`,
    );
  }

  countActiveStudents(db: DbOrTx, classId: string) {
    return db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM edu_enrollments WHERE class_id = ${classId} AND left_on IS NULL`);
  }

  findCustomer(db: DbOrTx, tenantId: string, id: string) {
    return db.execute(sql`SELECT 1 FROM customers WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active`);
  }

  insertEnrollment(db: DbOrTx, tenantId: string, v: { classId: string; customerId: string; studentName: string; enrolledOn: string; discount: string }) {
    return db.execute<{ id: string }>(
      sql`INSERT INTO edu_enrollments (tenant_id, class_id, customer_id, student_name, enrolled_on, discount_pct) VALUES (${tenantId}, ${v.classId}, ${v.customerId}, ${v.studentName}, ${v.enrolledOn}, ${v.discount}) RETURNING id`,
    );
  }

  listEnrollments(db: DbOrTx, tenantId: string, classId?: string) {
    return db.execute<EduEnrollRow & { billed: string[] }>(
      sql`SELECT e.id, e.class_id, c.name AS class_name, c.monthly_fee, e.customer_id, cu.name AS customer_name, e.student_name, e.enrolled_on, e.left_on, e.discount_pct,
          COALESCE((SELECT array_agg(f.period ORDER BY f.period) FROM edu_fee_invoices f WHERE f.enrollment_id = e.id), '{}') AS billed
          FROM edu_enrollments e JOIN edu_classes c ON c.id = e.class_id JOIN customers cu ON cu.id = e.customer_id
          WHERE e.tenant_id = ${tenantId} ${classId ? sql`AND e.class_id = ${classId}` : sql``} ORDER BY c.code, e.student_name`,
    );
  }

  findEnrollment(db: DbOrTx, tenantId: string, id: string) {
    return db.execute<{ id: string; enrolled_on: string; left_on: string | null; student_name: string }>(
      sql`SELECT id, enrolled_on, left_on, student_name FROM edu_enrollments WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  leave(db: DbOrTx, id: string, leftOn: string) {
    return db.execute(sql`UPDATE edu_enrollments SET left_on = ${leftOn} WHERE id = ${id}`);
  }

  /** Peserta yang wajib ditagih pada periode (YYYY-MM) dan belum punya tagihan SPP periode itu */
  dueEnrollments(db: DbOrTx, tenantId: string, period: string) {
    return db.execute<{ id: string; customer_id: string; student_name: string; class_name: string; monthly_fee: string; discount_pct: string }>(
      sql`SELECT e.id, e.customer_id, e.student_name, c.name AS class_name, c.monthly_fee, e.discount_pct
          FROM edu_enrollments e JOIN edu_classes c ON c.id = e.class_id
          WHERE e.tenant_id = ${tenantId} AND c.is_active
            AND to_char(e.enrolled_on, 'YYYY-MM') <= ${period}
            AND (e.left_on IS NULL OR to_char(e.left_on, 'YYYY-MM') >= ${period})
            AND to_char(c.start_date, 'YYYY-MM') <= ${period}
            AND (c.end_date IS NULL OR to_char(c.end_date, 'YYYY-MM') >= ${period})
            AND NOT EXISTS (SELECT 1 FROM edu_fee_invoices f WHERE f.enrollment_id = e.id AND f.period = ${period})
          ORDER BY e.customer_id, e.student_name`,
    );
  }

  insertFee(db: DbOrTx, tenantId: string, enrollmentId: string, period: string, invoiceId: string, amount: string) {
    return db.execute(sql`INSERT INTO edu_fee_invoices (tenant_id, enrollment_id, period, invoice_id, amount) VALUES (${tenantId}, ${enrollmentId}, ${period}, ${invoiceId}, ${amount})`);
  }
}

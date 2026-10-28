import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../../db/db';

export type SiteContractRow = { id: string; customer_id: string; customer_name: string; site_name: string; title: string; with_vat: boolean | null; start_date: string; end_date: string | null; is_active: boolean };
export type SitePostRow = { id: string; contract_id: string; name: string; headcount: number; monthly_rate: string };

/** Akses data kontrak per lokasi */
@Injectable()
export class SiteContractsRepository {
  listContracts(db: DbOrTx, tenantId: string) {
    return db.execute<SiteContractRow>(
      sql`SELECT s.id, s.customer_id, c.name AS customer_name, s.site_name, s.title, s.with_vat, s.start_date, s.end_date, s.is_active
          FROM site_contracts s JOIN customers c ON c.id = s.customer_id WHERE s.tenant_id = ${tenantId} ORDER BY s.site_name`,
    );
  }

  findContract(db: DbOrTx, tenantId: string, id: string) {
    return db.execute<SiteContractRow>(
      sql`SELECT s.id, s.customer_id, c.name AS customer_name, s.site_name, s.title, s.with_vat, s.start_date, s.end_date, s.is_active
          FROM site_contracts s JOIN customers c ON c.id = s.customer_id WHERE s.id = ${id} AND s.tenant_id = ${tenantId}`,
    );
  }

  listPosts(db: DbOrTx, tenantId: string, contractIds?: string[]) {
    return db.execute<SitePostRow>(
      contractIds?.length
        ? sql`SELECT id, contract_id, name, headcount, monthly_rate FROM site_posts WHERE tenant_id = ${tenantId} AND contract_id IN (${sql.join(contractIds.map((c) => sql`${c}::uuid`), sql`, `)}) ORDER BY created_at, name`
        : sql`SELECT id, contract_id, name, headcount, monthly_rate FROM site_posts WHERE tenant_id = ${tenantId} ORDER BY created_at, name`,
    );
  }

  listBilled(db: DbOrTx, tenantId: string) {
    return db.execute<{ contract_id: string; period: string; number: string; shortfall: string }>(
      sql`SELECT ci.contract_id, ci.period, i.number, ci.shortfall_head_days AS shortfall FROM site_contract_invoices ci JOIN invoices i ON i.id = ci.invoice_id WHERE ci.tenant_id = ${tenantId}`,
    );
  }

  findCustomer(db: DbOrTx, tenantId: string, id: string) {
    return db.execute(sql`SELECT 1 FROM customers WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active`);
  }

  insertContract(db: DbOrTx, tenantId: string, v: { customerId: string; siteName: string; title: string; withVat: boolean | null; start: string; end: string | null }) {
    return db.execute<{ id: string }>(
      sql`INSERT INTO site_contracts (tenant_id, customer_id, site_name, title, with_vat, start_date, end_date) VALUES (${tenantId}, ${v.customerId}, ${v.siteName}, ${v.title}, ${v.withVat}, ${v.start}, ${v.end}) RETURNING id`,
    );
  }

  insertPost(db: DbOrTx, tenantId: string, contractId: string, v: { name: string; headcount: number; rate: string }) {
    return db.execute(sql`INSERT INTO site_posts (tenant_id, contract_id, name, headcount, monthly_rate) VALUES (${tenantId}, ${contractId}, ${v.name}, ${v.headcount}, ${v.rate})`);
  }

  updateContract(db: DbOrTx, id: string, end: string | null, isActive: boolean | null) {
    return db.execute(sql`UPDATE site_contracts SET end_date = COALESCE(${end}::date, end_date), is_active = COALESCE(${isActive}::boolean, is_active) WHERE id = ${id}`);
  }

  findPost(db: DbOrTx, tenantId: string, contractId: string, postId: string) {
    return db.execute<SitePostRow>(sql`SELECT id, contract_id, name, headcount, monthly_rate FROM site_posts WHERE id = ${postId} AND contract_id = ${contractId} AND tenant_id = ${tenantId}`);
  }

  /** Pemilih petugas: hanya id, kode, dan nama (tanpa gaji atau data pribadi) agar peran operasional tidak perlu membuka data SDM */
  listStaff(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string; code: string; name: string }>(sql`SELECT id, code, name FROM employees WHERE tenant_id = ${tenantId} AND is_active ORDER BY name`);
  }

  findEmployee(db: DbOrTx, tenantId: string, id: string) {
    return db.execute<{ name: string }>(sql`SELECT name FROM employees WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active`);
  }

  /** Tanggal di rentang yang sudah dipakai petugas ini (di pos mana pun) */
  employeeBusyDays(db: DbOrTx, employeeId: string, from: string, to: string) {
    return db.execute<{ duty_date: string }>(sql`SELECT duty_date FROM site_duty WHERE employee_id = ${employeeId} AND duty_date BETWEEN ${from} AND ${to} ORDER BY duty_date`);
  }

  insertDuty(db: DbOrTx, tenantId: string, postId: string, employeeId: string, days: string[]) {
    return db.execute(sql`INSERT INTO site_duty (tenant_id, post_id, employee_id, duty_date) VALUES ${sql.join(days.map((d) => sql`(${tenantId}, ${postId}, ${employeeId}, ${d}::date)`), sql`, `)}`);
  }

  deleteDuty(db: DbOrTx, tenantId: string, contractId: string, dutyId: string) {
    return db.execute<{ id: string }>(
      sql`DELETE FROM site_duty d USING site_posts p WHERE d.id = ${dutyId} AND d.post_id = p.id AND p.contract_id = ${contractId} AND d.tenant_id = ${tenantId} RETURNING d.id`,
    );
  }

  /** Jadwal jaga kontrak di rentang tanggal */
  dutyRows(db: DbOrTx, tenantId: string, contractId: string, from: string, to: string) {
    return db.execute<{ id: string; post_id: string; employee_id: string; employee_name: string; duty_date: string }>(
      sql`SELECT d.id, d.post_id, d.employee_id, e.name AS employee_name, d.duty_date FROM site_duty d JOIN site_posts p ON p.id = d.post_id JOIN employees e ON e.id = d.employee_id
          WHERE d.tenant_id = ${tenantId} AND p.contract_id = ${contractId} AND d.duty_date BETWEEN ${from} AND ${to} ORDER BY d.duty_date, e.name`,
    );
  }

  insertBilled(db: DbOrTx, tenantId: string, contractId: string, period: string, invoiceId: string, shortfall: string) {
    return db.execute(sql`INSERT INTO site_contract_invoices (tenant_id, contract_id, period, invoice_id, shortfall_head_days) VALUES (${tenantId}, ${contractId}, ${period}, ${invoiceId}, ${shortfall})`);
  }

  isBilled(db: DbOrTx, contractId: string, period: string) {
    return db.execute(sql`SELECT 1 FROM site_contract_invoices WHERE contract_id = ${contractId} AND period = ${period}`);
  }
}

// =============================================================
//  SANSU — skema database (Drizzle ORM, PostgreSQL)
//  Prinsip:
//   * Setiap tabel bisnis punya tenant_id (multi-tenant, skema bersama)
//   * Uang NUMERIC(18,2), kuantitas & biaya satuan NUMERIC(18,4) — tidak pernah float
//   * Tanggal dokumen bertipe DATE (string 'YYYY-MM-DD')
//   * Jurnal yang sudah diposting tidak diubah; koreksi lewat jurnal balik
//  Dipecah per domain (satu berkas per bidang); semua diekspor ulang di sini sehingga impor tetap dari '../db/schema'.
//  Ubah berkas domainnya lalu jalankan `npm run db:generate -w backend` untuk membuat migrasi.
// =============================================================

export * from './columns';
export * from './enums';
export * from './accounting';
export * from './assets';
export * from './billing';
export * from './cash-bank';
export * from './crm';
export * from './delivery';
export * from './fmcg';
export * from './hr';
export * from './inventory';
export * from './master-data';
export * from './pos';
export * from './pricing';
export * from './production';
export * from './purchasing';
export * from './reminders';
export * from './sales';
export * from './services';
export * from './tenancy';
export * from './utility';
export * from './workflow';

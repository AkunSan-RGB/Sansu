/**
 * Menyelaraskan bagan akun perusahaan dengan bagan akun standar terbaru (SAK EP):
 *  - membuat akun/induk yang belum ada (perusahaan lama)
 *  - mengisi kelompok laporan & perlakuan fiskal yang masih kosong
 *  - memindahkan akun lama ke induk baru (mis. Utang Usaha → Liabilitas Jangka Pendek)
 *  - menyiapkan kategori aset tetap bawaan
 * Aman dijalankan berulang (idempoten) dan tidak pernah mengubah nama akun buatan pengguna.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { asFramework, BUSINESS_MODEL_BY_KEY, BUSINESS_MODEL_KEYS, type AppKey, type BusinessModel, type ReportingFramework, withDependencies } from '@sansu/shared';
import { accounts, assetCategories, journalLines, tenantApps, tenants } from '../../db/schema';
import { COA_FAMILIES, COA_UNUSED_MARK, coaName, coaNameVariants, DEFAULT_COA, guessReportGroup } from './default-coa';

/** Nama induk lama yang boleh diganti ke nama standar baru */
const HEADER_RENAMES: Record<string, string[]> = {
  '1-2000': ['Aset Tetap'],
  '6-0000': ['Beban Operasional'],
};

const DEFAULT_CATEGORIES = [
  { name: 'Tanah', asset: '1-2050', accum: null, expense: null, method: 'NONE', life: 0, fiscalGroup: 'LAND' },
  { name: 'Bangunan', asset: '1-2060', accum: '1-2910', expense: '6-5000', method: 'STRAIGHT_LINE', life: 240, fiscalGroup: 'BUILDING_PERMANENT' },
  { name: 'Kendaraan', asset: '1-2100', accum: '1-2900', expense: '6-5000', method: 'STRAIGHT_LINE', life: 96, fiscalGroup: 'GROUP_2' },
  { name: 'Peralatan Gudang & Mesin', asset: '1-2200', accum: '1-2920', expense: '6-5000', method: 'STRAIGHT_LINE', life: 96, fiscalGroup: 'GROUP_2' },
  { name: 'Inventaris Kantor', asset: '1-2300', accum: '1-2930', expense: '6-5000', method: 'STRAIGHT_LINE', life: 48, fiscalGroup: 'GROUP_1' },
  { name: 'Perangkat Lunak', asset: '1-2500', accum: '1-2950', expense: '6-5100', method: 'STRAIGHT_LINE', life: 48, fiscalGroup: 'GROUP_1' },
] as const;

/** Jenis usaha perusahaan dari pengaturan (Dagang bila belum pernah dipilih) */
async function businessModelOf(db: DbOrTx, tenantId: string): Promise<BusinessModel> {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const m = (t?.settings as { business?: { model?: string } } | null)?.business?.model ?? '';
  return (BUSINESS_MODEL_KEYS as readonly string[]).includes(m) ? (m as BusinessModel) : 'DAGANG';
}

/**
 * Sesuaikan relevansi akun dengan jenis usaha dan aplikasi aktif: akun tidak relevan yang belum pernah dipakai dinonaktifkan,
 * akun yang sebelumnya dinonaktifkan otomatis diaktifkan kembali bila kini relevan. Nonaktif buatan pengguna tidak disentuh.
 */
export async function applyChartRelevance(db: DbOrTx, tenantId: string, model: BusinessModel, apps: ReadonlySet<string>, framework: ReportingFramework = 'SAK_EP') {
  const all = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId));
  const byCode = new Map(all.map((a) => [a.code, a]));
  let deactivated = 0;
  let activated = 0;
  for (const fam of COA_FAMILIES) {
    const rows = fam.codes.map((c) => byCode.get(c)).filter((a): a is NonNullable<typeof a> => !!a);
    if (!rows.length) continue;
    if (fam.relevant(model, apps, framework)) {
      for (const a of rows.filter((x) => !x.isActive && x.description === COA_UNUSED_MARK)) {
        await db.update(accounts).set({ isActive: true, description: null }).where(eq(accounts.id, a.id));
        activated++;
      }
      continue;
    }
    const used = await db
      .selectDistinct({ id: journalLines.accountId })
      .from(journalLines)
      .where(inArray(journalLines.accountId, rows.map((a) => a.id)));
    const usedIds = new Set(used.map((u) => u.id));
    for (const a of rows.filter((x) => x.isActive && !usedIds.has(x.id))) {
      await db.update(accounts).set({ isActive: false, description: COA_UNUSED_MARK }).where(eq(accounts.id, a.id));
      deactivated++;
    }
  }
  return { deactivated, activated };
}

/** Standar pelaporan perusahaan (SAK EP bila belum dipilih) */
export async function frameworkOf(db: DbOrTx, tenantId: string): Promise<ReportingFramework> {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const fw = (t?.settings as { reporting?: { framework?: string } } | null)?.reporting?.framework;
  return asFramework(fw);
}

/**
 * Selaraskan relevansi bagan akun dengan profil perusahaan saat ini (jenis usaha, standar pelaporan, aplikasi aktif).
 * Dipanggil setiap kali salah satunya berubah, sehingga bagan akun mengikuti otomatis.
 */
export async function refreshChartRelevance(db: DbOrTx, tenantId: string) {
  const model = await businessModelOf(db, tenantId);
  const framework = await frameworkOf(db, tenantId);
  const rows = await db.select({ k: tenantApps.appKey }).from(tenantApps).where(eq(tenantApps.tenantId, tenantId));
  // Aplikasi yang hanya terpasang sebagai dependensi paket jenis usaha (mis. Inventori pada usaha jasa) tidak membuat akunnya relevan;
  // sama dengan perhitungan saat perusahaan dibuat, sehingga pergantian standar pelaporan tidak mengubah tampilan bagan akun
  const base: AppKey[] = BUSINESS_MODEL_BY_KEY[model].apps;
  const implied = new Set<string>(base.flatMap((k) => withDependencies(k)).filter((k) => !base.includes(k)));
  const apps = new Set<string>([...rows.map((r) => r.k).filter((k) => !implied.has(k)), 'accounting']);
  return applyChartRelevance(db, tenantId, model, apps, framework);
}

export async function syncChartOfAccounts(db: DbOrTx, tenantId: string, opts: { apps?: ReadonlySet<string> } = {}) {
  const model = await businessModelOf(db, tenantId);
  const existing = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId));
  const byCode = new Map(existing.map((a) => [a.code, a]));
  const byKey = new Map(existing.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]));
  let created = 0;

  for (const row of DEFAULT_COA) {
    const parent = row.parent ? byCode.get(row.parent) : undefined;
    let acc = byCode.get(row.code);
    // Akun khusus jenis usaha lain tidak dibuat; yang sudah ada (model sebelumnya) dibiarkan apa adanya
    if (!acc && row.models && !row.models.includes(model)) continue;
    if (!acc && row.skip?.includes(model) && !row.key) continue;
    // Akun sistem yang dulu dibuat otomatis dengan kode lain (mis. 2-1310-S) tetap dipakai
    if (!acc && row.key && byKey.has(row.key)) acc = byKey.get(row.key);

    if (!acc) {
      const [ins] = await db
        .insert(accounts)
        .values({
          tenantId,
          code: row.code,
          name: coaName(row, model),
          type: row.type,
          isPostable: !row.header,
          systemKey: row.key && !byKey.has(row.key) ? row.key : undefined,
          isCashAccount: !!row.cash,
          parentId: parent?.id,
          reportGroup: row.group,
          fiscalTreatment: row.fiscal ?? 'NORMAL',
        })
        .returning();
      byCode.set(row.code, ins);
      if (row.key) byKey.set(row.key, ins);
      created++;
      continue;
    }

    const patch: Partial<typeof accounts.$inferInsert> = {};
    if (!acc.reportGroup && row.group && acc.type === row.type) patch.reportGroup = row.group;
    if (acc.fiscalTreatment === 'NORMAL' && row.fiscal && !acc.reportGroup) patch.fiscalTreatment = row.fiscal;
    if (row.key && !acc.systemKey && !byKey.has(row.key) && acc.type === row.type && acc.isPostable) {
      patch.systemKey = row.key;
      byKey.set(row.key, acc);
    }
    if (row.header && HEADER_RENAMES[row.code]?.includes(acc.name)) patch.name = row.name;
    // Akun yang dulu menggabungkan beberapa jenis beban: nama bawaan lama diganti ke nama tunggal (riwayat tetap di akun yang sama)
    if (row.was?.includes(acc.name)) patch.name = coaName(row, model);
    // Nama inti mengikuti jenis usaha, tetapi hanya bila akun masih bernama bawaan (tidak menimpa nama buatan pengguna)
    const target = coaName(row, model);
    if (row.names && acc.name !== target && coaNameVariants(row).has(acc.name)) patch.name = target;
    // Pindahkan ke induk baru bila masih menempel di induk lama (kakek dari induk baru)
    if (parent && acc.parentId !== parent.id && parent.parentId && acc.parentId === parent.parentId && acc.id !== parent.id) {
      patch.parentId = parent.id;
    }
    if (Object.keys(patch).length) {
      const [upd] = await db.update(accounts).set(patch).where(eq(accounts.id, acc.id)).returning();
      byCode.set(upd.code, upd);
    }
  }

  // Akun buatan pengguna yang belum punya kelompok laporan
  const unclassified = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.reportGroup), eq(accounts.isPostable, true)));
  for (const a of unclassified) {
    await db
      .update(accounts)
      .set({ reportGroup: a.isCashAccount ? 'CASH_EQUIVALENT' : guessReportGroup(a.code, a.type) })
      .where(eq(accounts.id, a.id));
  }

  // Kategori aset tetap bawaan
  const [anyCat] = await db.select({ id: assetCategories.id }).from(assetCategories).where(eq(assetCategories.tenantId, tenantId)).limit(1);
  if (!anyCat) {
    for (const c of DEFAULT_CATEGORIES) {
      const asset = byCode.get(c.asset);
      if (!asset) continue;
      await db.insert(assetCategories).values({
        tenantId,
        name: c.name,
        assetAccountId: asset.id,
        accumulatedAccountId: c.accum ? byCode.get(c.accum)?.id : undefined,
        expenseAccountId: c.expense ? byCode.get(c.expense)?.id : undefined,
        method: c.method,
        usefulLifeMonths: c.life,
        fiscalGroup: c.fiscalGroup,
        fiscalMethod: 'STRAIGHT_LINE',
      });
    }
  }
  // Relevansi hanya diterapkan bila pemanggil menyebut aplikasi aktif (perusahaan baru / ganti jenis usaha), bukan tiap startup
  const relevance = opts.apps ? await applyChartRelevance(db, tenantId, model, opts.apps, await frameworkOf(db, tenantId)) : { deactivated: 0, activated: 0 };
  return { created, classified: unclassified.length, ...relevance };
}

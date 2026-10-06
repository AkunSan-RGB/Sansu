/**
 * Menyelaraskan bagan akun perusahaan dengan bagan akun standar terbaru (SAK EP):
 *  - membuat akun/induk yang belum ada (perusahaan lama)
 *  - mengisi kelompok laporan & perlakuan fiskal yang masih kosong
 *  - memindahkan akun lama ke induk baru (mis. Utang Usaha → Liabilitas Jangka Pendek)
 *  - menyiapkan kategori aset tetap bawaan
 * Aman dijalankan berulang (idempoten) dan tidak pernah mengubah nama akun buatan pengguna.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { BUSINESS_MODEL_KEYS, type BusinessModel } from '@sansu/shared';
import { accounts, assetCategories, tenants } from '../../db/schema';
import { DEFAULT_COA, guessReportGroup } from './default-coa';

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

export async function syncChartOfAccounts(db: DbOrTx, tenantId: string) {
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
    // Akun sistem yang dulu dibuat otomatis dengan kode lain (mis. 2-1310-S) tetap dipakai
    if (!acc && row.key && byKey.has(row.key)) acc = byKey.get(row.key);

    if (!acc) {
      const [ins] = await db
        .insert(accounts)
        .values({
          tenantId,
          code: row.code,
          name: row.name,
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
  return { created, classified: unclassified.length };
}

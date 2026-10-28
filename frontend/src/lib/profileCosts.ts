import { costTypesFor, type BusinessModel, type ServiceProfile } from '@sansu/shared';

interface Acc {
  id: string;
  code: string;
  name: string;
}
type Opt = { value: string; label: string };

/**
 * Jenis biaya khas profil layanan (Jasa) sebagai kelompok pilihan akun pertama: mis. kontraktor melihat "Subkontraktor",
 * "Material proyek", "Mobilisasi"; pendidikan melihat "Honor pengajar". Akun yang tidak ada / nonaktif di bagan akun dilewati.
 */
export function profileCostOptions(model: BusinessModel | undefined, profiles: ServiceProfile[] | undefined, accounts: Acc[] | undefined): Opt[] {
  if (model !== 'JASA' || !accounts?.length) return [];
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  return costTypesFor(profiles)
    .map((c) => {
      const a = byCode.get(c.account);
      return a ? { value: a.id, label: `${c.label} — ${a.code} · ${a.name}` } : null;
    })
    .filter((o): o is Opt => !!o);
}

/** Pilihan akun dikelompokkan: biaya khas profil di atas, akun lain di bawah (tanpa duplikat) */
export function withProfileCosts(model: BusinessModel | undefined, profiles: ServiceProfile[] | undefined, accounts: Acc[] | undefined, rest: Opt[]): (Opt | { label: string; options: Opt[] })[] {
  const mine = profileCostOptions(model, profiles, accounts);
  if (!mine.length) return rest;
  const used = new Set(mine.map((o) => o.value));
  return [
    { label: 'Biaya khas layanan Anda', options: mine },
    { label: 'Akun lain', options: rest.filter((o) => !used.has(o.value)) },
  ];
}

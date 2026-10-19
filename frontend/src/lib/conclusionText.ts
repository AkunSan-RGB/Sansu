import type { SupportConclusion, SupportFinding } from '@sansu/shared';

export interface ConclusionItem {
  /** Nomor urut berlanjut antar kelompok */
  no: number;
  lead: string;
  body: string;
  level: SupportFinding['level'];
}
export interface ConclusionGroup {
  heading: string;
  items: ConclusionItem[];
}

const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** Mengelompokkan temuan menjadi uraian bernomor: yang perlu ditindaklanjuti, catatan, dan kondisi baik */
export function conclusionGroups(c: SupportConclusion): ConclusionGroup[] {
  const defs: { heading: string; levels: SupportFinding['level'][] }[] = [
    { heading: 'Perlu ditindaklanjuti', levels: ['danger', 'warning'] },
    { heading: 'Catatan', levels: ['info'] },
    { heading: 'Kondisi baik', levels: ['ok'] },
  ];
  let no = 0;
  return defs
    .map((d) => ({
      heading: d.heading,
      items: c.findings
        .filter((f) => d.levels.includes(f.level))
        .map((f) => ({ no: ++no, lead: sentence(f.title), body: [sentence(f.detail), f.action ? `Saran: ${sentence(f.action)}` : ''].filter(Boolean).join(' '), level: f.level })),
    }))
    .filter((g) => g.items.length);
}

/** Teks polos (untuk Excel): ringkasan, lalu tiap kelompok dan uraiannya */
export function conclusionParagraphs(c: SupportConclusion): string[] {
  const out = [sentence(c.summary)];
  for (const g of conclusionGroups(c)) {
    out.push(g.heading.toUpperCase());
    for (const i of g.items) out.push(`${i.no}. ${i.lead} ${i.body}`);
  }
  return out;
}

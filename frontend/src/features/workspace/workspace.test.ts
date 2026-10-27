import { BUSINESS_MODEL_KEYS, MODEL_WORKSPACE, type AppKey } from '@sansu/shared';
import { describe, expect, it } from 'vitest';
import { pathVisible, type VisibilityCtx } from '@/layout/menuData';

const ctx = (model: (typeof BUSINESS_MODEL_KEYS)[number]): VisibilityCtx => ({
  role: 'OWNER',
  model,
  framework: 'SAK_EP',
  multiBranch: true,
  hasBudget: true,
  subscriptionEnabled: true,
  can: (_a: AppKey) => true,
});

describe('Ruang kerja per jenis usaha', () => {
  it('semua 7 jenis usaha punya ruang kerja dengan tahap dan tautan', () => {
    for (const m of BUSINESS_MODEL_KEYS) {
      const w = MODEL_WORKSPACE[m];
      expect(w.title.length).toBeGreaterThan(3);
      expect(w.stages.length).toBeGreaterThanOrEqual(4);
      for (const s of w.stages) expect(s.links.length).toBeGreaterThan(0);
    }
  });

  it('setiap tautan menuju halaman yang terlihat di menu jenis usaha itu (tidak ada tautan mati)', () => {
    const dead: string[] = [];
    for (const m of BUSINESS_MODEL_KEYS) {
      for (const s of MODEL_WORKSPACE[m].stages) for (const l of s.links) if (!pathVisible(l.to, ctx(m))) dead.push(`${m}: ${l.label} → ${l.to}`);
    }
    expect(dead).toEqual([]);
  });

  it('tidak ada tautan ganda di satu ruang kerja', () => {
    for (const m of BUSINESS_MODEL_KEYS) {
      const all = MODEL_WORKSPACE[m].stages.flatMap((s) => s.links.map((l) => l.to));
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

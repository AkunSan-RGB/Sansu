import { BUSINESS_MODELS, MODEL_SETUP, type BusinessModel } from '@sansu/shared';
import { describe, expect, it } from 'vitest';
import { MENU, menuFor, subItems, type Group } from '@/layout/menuData';
import { articlesFor, articlesVisibleTo, HELP_ARTICLES, searchArticles } from './articles';

const MODELS = BUSINESS_MODELS.map((m) => m.key) as BusinessModel[];
const path = (to: string) => to.split('?')[0];
const visibleMenuKeys = (m: BusinessModel) => {
  const keys = new Set<string>();
  const walk = (g: Group) => {
    if ((g.models && !g.models.includes(m)) || g.hideFor?.includes(m)) return;
    keys.add(g.key);
    for (const i of subItems(g.children)) if ((!i.models || i.models.includes(m)) && !i.hideFor?.includes(m)) keys.add(i.key);
  };
  menuFor(m).forEach(walk);
  return keys;
};

describe('bantuan per jenis usaha', () => {
  it('id artikel unik', () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    expect(ids.filter((x, i) => ids.indexOf(x) !== i)).toEqual([]);
  });

  it.each(MODELS)('%s: punya panduan sendiri yang hanya terlihat oleh jenis usaha itu', (m) => {
    const id = `panduan-${m.toLowerCase()}`;
    expect(articlesVisibleTo(m).some((a) => a.id === id)).toBe(true);
    for (const other of MODELS.filter((x) => x !== m)) expect(articlesVisibleTo(other).some((a) => a.id === id)).toBe(false);
    const g = HELP_ARTICLES.find((a) => a.id === id)!;
    expect(g.category).toBe('Panduan jenis usaha');
    expect(g.steps!.length).toBeGreaterThanOrEqual(5);
    expect(g.link?.to).toBe('/settings/company?tab=usaha');
  });

  it.each(MODELS)('%s: cukup artikel dan tidak ada artikel jenis usaha lain', (m) => {
    const list = articlesVisibleTo(m);
    expect(list.length).toBeGreaterThanOrEqual(25);
    expect(list.filter((a) => a.models && !a.models.includes(m))).toEqual([]);
  });

  it('artikel khusus tidak bocor: utilitas/F&B/FMCG tidak terlihat oleh Dagang', () => {
    const ids = new Set(articlesVisibleTo('DAGANG').map((a) => a.id));
    for (const hidden of ['utilitas-tagihan-bulanan', 'air-loket-non-tunai', 'menu-resep', 'meja-dapur', 'pb1', 'fmcg-recall', 'fmcg-kanvas', 'kasir']) expect(ids.has(hidden)).toBe(false);
    const util = new Set(articlesVisibleTo('UTILITAS').map((a) => a.id));
    for (const hidden of ['kasir', 'menu-resep', 'fmcg-harga-promo', 'jasa', 'produksi']) expect(util.has(hidden)).toBe(false);
  });

  it('bantuan kontekstual dan pencarian mengikuti jenis usaha', () => {
    expect(articlesFor('/pos', 'FNB').some((a) => a.id === 'kasir')).toBe(true);
    expect(articlesFor('/pos', 'DAGANG').some((a) => a.id === 'kasir')).toBe(false);
    expect(searchArticles('virtual account', 'UTILITAS').length).toBeGreaterThan(0);
    expect(searchArticles('virtual account', 'FMCG')).toEqual([]);
    expect(searchArticles('kanvas', 'FMCG').length).toBeGreaterThan(0);
    expect(searchArticles('kanvas', 'RITEL')).toEqual([]);
  });

  it('semua artikel yang bertaut ke halaman menunjuk halaman yang terlihat oleh jenis usaha pemilik artikel', () => {
    const extra = (p: string) => p.startsWith('/settings') || p === '/pos' || p === '/pos/sessions' || p === '/utility' || p === '/products' || p === '/invoices/services/new';
    const bad: string[] = [];
    for (const a of HELP_ARTICLES) {
      if (!a.link) continue;
      expect(a.link.to.startsWith('/')).toBe(true);
      for (const m of a.models ?? []) if (!visibleMenuKeys(m).has(path(a.link.to)) && !extra(path(a.link.to))) bad.push(`${a.id} -> ${a.link.to} (${m})`);
    }
    expect(bad).toEqual([]);
  });
});

describe('pengaturan per jenis usaha', () => {
  it.each(MODELS)('%s: setiap tautan "Atur" menuju halaman yang terlihat di menu jenis usaha itu', (m) => {
    const keys = visibleMenuKeys(m);
    const bad = MODEL_SETUP[m].filter((i) => !(keys.has(path(i.link)) || path(i.link).startsWith('/settings'))).map((i) => `${i.key} -> ${i.link}`);
    expect(bad).toEqual([]);
  });
  it('MENU tidak kosong (penjaga uji)', () => expect(MENU.length).toBeGreaterThan(5));
});

import { writeFileSync } from 'node:fs';
import { BUSINESS_MODEL_KEYS } from '@sansu/shared';
import { it } from 'vitest';
import { itemVisible, MENU, subItems } from '@/layout/menuData';

it('daftar rute menu per jenis usaha (OWNER)', () => {
  const out: Record<string, string[]> = {};
  for (const m of BUSINESS_MODEL_KEYS) {
    const ctx = { role: 'OWNER', model: m, framework: 'SAK_EP', multiBranch: false, hasBudget: false, subscriptionEnabled: true, can: () => true };
    const keys = new Set<string>();
    for (const g of MENU) {
      if ((g.models && !g.models.includes(m)) || g.hideFor?.includes(m)) continue;
      if (g.to) keys.add(g.to);
      for (const i of subItems(g.children)) if (itemVisible(i, ctx)) keys.add(i.key);
    }
    out[m] = [...keys];
  }
  writeFileSync('/tmp/menu-routes.json', JSON.stringify(out, null, 1));
});

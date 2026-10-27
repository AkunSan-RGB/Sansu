import { sql, type SQL } from 'drizzle-orm';

/**
 * Cara memeriksa apakah suatu pengaturan jenis usaha sudah diatur, dari data perusahaan itu sendiri (alias `t` = tenants).
 * Semua potongan SQL adalah konstanta di berkas ini — tidak ada masukan pengguna yang masuk ke SQL.
 * Pengaturan tersimpan (JSON `tenants.settings`) dianggap diatur bila bagiannya pernah disimpan; yang berupa tombol dianggap diatur bila aktif.
 */
const own = (table: string, where = '') => `EXISTS (SELECT 1 FROM ${table} x WHERE x.tenant_id = t.id${where ? ` AND ${where}` : ''})`;

export const SETUP_PROBES: Record<string, string> = {
  priceLists: own('price_lists'),
  creditLimit: own('customers', 'x.credit_limit > 0'),
  inventoryMethod: `(t.settings ? 'inventory')`,
  vehicles: own('delivery_vehicles'),
  supplierPrices: own('supplier_price_agreements'),
  stockMin: own('stock_minimums'),
  posSession: own('pos_sessions'),
  barcodes: own('products', `x.barcode IS NOT NULL AND x.barcode <> ''`),
  cardBank: own('pos_card_settlement_banks'),
  loyalty: `COALESCE(t.settings->'loyalty'->>'enabled', 'false') = 'true'`,
  branches: `COALESCE(t.settings->'branches'->>'enabled', 'false') = 'true'`,
  serviceRates: own('service_rates'),
  projects: own('projects'),
  resources: own('scheduling_resources'),
  retainers: own('service_retainers'),
  leads: own('leads'),
  lots: own('stock_lots'),
  promos: own('promos'),
  salesTargets: own('sales_targets'),
  tradeTerms: own('trade_terms'),
  salesRoutes: own('sales_routes'),
  boms: own('boms'),
  workCenters: own('work_centers'),
  qcPlans: own('qc_plans'),
  tables: own('pos_tables'),
  platforms: `(t.settings ? 'platforms')`,
  localTax: `COALESCE(t.settings->'tax'->>'localTaxEnabled', 'false') = 'true'`,
  shelfLife: own('products', 'x.shelf_life_days IS NOT NULL'),
  recipeTerm: `(t.settings ? 'terms')`,
  tariffs: own('utility_tariffs'),
  counters: own('utility_counters'),
  utilRules: `(t.settings ? 'utility')`,
  vaSetup: `(t.settings ? 'utilityVa')`,
  messaging: `COALESCE(t.settings->'utilityMessaging'->>'enabled', 'false') = 'true'`,
  utilRoutes: own('utility_routes'),
};

/** Satu kueri untuk semua kunci yang diminta: kolom bernama kunci, nilai true/false */
export function probeQuery(keys: string[], tenantId: string): SQL {
  const cols = keys.map((k) => {
    const frag = SETUP_PROBES[k];
    if (!frag) throw new Error(`Pemeriksaan pengaturan tidak dikenal: ${k}`);
    return sql.raw(`${frag} AS "${k}"`);
  });
  return sql`SELECT ${sql.join(cols, sql`, `)} FROM tenants t WHERE t.id = ${tenantId}`;
}

import { AppstoreOutlined, CrownOutlined, MenuOutlined } from '@ant-design/icons';
import { localize, type AppKey, type BusinessModel } from '@sansu/shared';
import { Button, Drawer, Grid, Layout, Menu, type MenuProps, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BRAND } from '@sansu/shared';
import { useAuth } from '@/auth/AuthContext';
import Logo from '@/brand/Logo';
import ServerStatus from '@/components/ServerStatus';
import AccountStatusBanner from '@/components/AccountStatusBanner';
import AccountMenu from '@/components/AccountMenu';
import { HelpButton } from '@/features/help/HelpCenter';
import { APP_ICONS, useApps } from '@/lib/apps';
import { t } from '@/lib/terms';

/** `app`: item hanya tampil bila aplikasi itu aktif (mis. menu pajak yang butuh aplikasi Penjualan) */
type Item = { key: string; label: string; app?: AppKey; /** Hanya tampil bila fitur pajak ini relevan (lihat taxFeatures di @sansu/shared) */ tax?: 'vat' | 'coretax' | 'withheldByCustomers' | 'fiscalReconciliation' };
/** Submenu boleh dikelompokkan dengan judul kecil (mis. "Akhir periode") */
type Sub = Item | { section: string; items: Item[] };
type Group = {
  key: string;
  app?: AppKey;
  /** Hanya tampil untuk model bisnis tertentu (mis. Produksi) */
  models?: BusinessModel[];
  admin?: boolean;
  label: string;
  icon: React.ReactNode;
  children?: Sub[];
  to?: string;
  /** Judul bagian di sidebar (Penjualan, Pembelian & stok, Keuangan, SDM, Administrasi) */
  part: string;
};
const PART_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: '#7c8aa5',
};
const SECTION_STYLE: React.CSSProperties = { fontSize: 11, letterSpacing: 0.6, color: '#8b97ad' };
const subItems = (c: Sub[] = []): Item[] => c.flatMap((x) => ('section' in x ? x.items : [x]));

/**
 * Sidebar disusun mengikuti alur kerja usaha:
 * jual (calon pelanggan → pesanan → faktur → retur) → beli & stok → uang masuk/keluar →
 * pembukuan (persiapan → harian → akhir periode) → pajak → SDM → administrasi.
 * Submenu juga berurutan dari langkah pertama ke terakhir; data master di akhir.
 */
const MENU: Group[] = [
  { part: '', key: '/dashboard', label: 'Dashboard', icon: APP_ICONS.dashboard, to: '/dashboard' },

  // ---------- Penjualan ----------
  {
    part: 'Penjualan',
    key: 'crm',
    app: 'crm',
    label: 'CRM',
    icon: APP_ICONS.crm,
    children: [
      { key: '/crm', label: t('Pipeline calon pelanggan') },
      { key: '/quotations', label: 'Penawaran harga' },
    ],
  },
  {
    part: 'Penjualan',
    key: 'sales',
    app: 'sales',
    label: t('Penjualan'),
    icon: APP_ICONS.sales,
    children: [
      { key: '/sales-orders', label: t('Sales Order') },
      { key: '/integrations?tab=marketplace', label: 'Marketplace' },
      { key: '/invoices', label: t('Faktur & piutang') },
      { key: '/projects', label: 'Proyek & termin' },
      { key: '/customer-deposits', label: t('Uang muka pelanggan') },
      { key: '/returns?tab=sales', label: t('Retur penjualan') },
      { section: 'Data', items: [{ key: '/customers', label: t('Pelanggan') }] },
    ],
  },
  {
    part: 'Penjualan',
    key: 'pos',
    app: 'pos',
    label: 'Kasir (POS)',
    icon: APP_ICONS.pos,
    children: [
      { key: '/pos', label: 'Layar kasir' },
      { key: '/pos/sessions', label: 'Riwayat sesi kasir' },
    ],
  },

  // ---------- Pembelian & stok ----------
  {
    part: 'Pembelian & stok',
    key: 'purchase',
    app: 'purchase',
    label: t('Pembelian'),
    icon: APP_ICONS.purchase,
    children: [
      { key: '/purchase-orders', label: t('Purchase Order') },
      { key: '/purchase-invoices', label: t('Faktur & hutang') },
      { key: '/returns?tab=purchase', label: t('Retur pembelian') },
      { section: 'Data', items: [{ key: '/suppliers', label: t('Supplier') }] },
    ],
  },
  {
    part: 'Pembelian & stok',
    key: 'inventory',
    app: 'inventory',
    label: t('Inventori'),
    icon: APP_ICONS.inventory,
    children: [
      { key: '/inventory', label: 'Stok & mutasi' },
      { key: '/inventory/warehouses', label: t('Stok per gudang') },
      { key: '/inventory/transfers', label: t('Transfer gudang') },
      { key: '/inventory/counts', label: 'Stock opname' },
      { key: '/inventory/writedowns', label: 'Penurunan nilai' },
      {
        section: 'Data',
        items: [
          { key: '/products', label: t('Produk') },
          { key: '/warehouses', label: t('Gudang') },
        ],
      },
    ],
  },

  {
    part: 'Pembelian & stok',
    key: 'production',
    app: 'inventory',
    models: ['PRODUKSI'],
    label: 'Produksi',
    icon: APP_ICONS.production,
    children: [
      { key: '/production/orders', label: 'Perintah produksi' },
      { key: '/production/report', label: 'Harga pokok produksi' },
      { section: 'Data', items: [{ key: '/production/boms', label: 'Resep (BOM)' }] },
    ],
  },

  // ---------- Keuangan ----------
  {
    part: 'Keuangan',
    key: 'cash',
    app: 'cash',
    label: 'Kas & Bank',
    icon: APP_ICONS.cash,
    children: [
      { key: '/cash', label: 'Transaksi kas & bank' },
      { key: '/bank', label: 'Rekonsiliasi bank' },
      { key: '/cash/counts', label: 'Opname kas' },
    ],
  },
  {
    part: 'Keuangan',
    key: 'accounting',
    app: 'accounting',
    label: 'Akuntansi',
    icon: APP_ICONS.accounting,
    children: [
      {
        section: 'Persiapan',
        items: [
          { key: '/accounts', label: 'Bagan akun' },
          { key: '/opening-balance', label: 'Saldo awal' },
        ],
      },
      {
        section: 'Harian',
        items: [
          { key: '/journals', label: 'Jurnal umum' },
          { key: '/fixed-assets', label: 'Aset tetap' },
        ],
      },
      {
        section: 'Akhir periode',
        items: [
          { key: '/adjustments', label: 'Jurnal penyesuaian' },
          { key: '/health', label: 'Cek kesehatan' },
          { key: '/ledger', label: 'Buku besar' },
          { key: '/trial-balance', label: 'Neraca saldo' },
          { key: '/worksheet', label: 'Neraca lajur' },
          { key: '/reports', label: 'Laporan keuangan' },
          { key: '/closing', label: 'Tutup buku' },
        ],
      },
    ],
  },
  {
    part: 'Keuangan',
    key: 'tax',
    app: 'accounting',
    label: 'Pajak',
    icon: APP_ICONS.tax,
    children: [
      { key: '/vat', label: 'Rekap PPN', tax: 'vat' },
      { key: '/integrations?tab=coretax', label: t('e-Faktur Coretax'), tax: 'coretax' },
      { key: '/tax', label: 'Setoran pajak & BPJS' },
      { key: '/tax/recap', label: 'Rekap pajak & BPJS' },
      { key: '/tax/withheld', label: t('PPh dipotong pelanggan'), app: 'sales', tax: 'withheldByCustomers' },
      { key: '/fiscal', label: 'Rekonsiliasi fiskal', tax: 'fiscalReconciliation' },
    ],
  },

  // ---------- SDM ----------
  {
    part: 'SDM',
    key: 'hr',
    app: 'hr',
    label: 'Karyawan',
    icon: APP_ICONS.hr,
    children: [
      { key: '/employees', label: 'Data karyawan' },
      { key: '/attendance', label: 'Absensi' },
      { key: '/leaves', label: 'Cuti' },
    ],
  },
  {
    part: 'SDM',
    key: 'payroll',
    app: 'payroll',
    label: 'Penggajian',
    icon: APP_ICONS.payroll,
    children: [
      { key: '/payroll', label: 'Proses gaji' },
      { key: '/payroll/pph21', label: 'Rekap PPh 21' },
      { key: '/payroll/bpjs', label: 'Rekap BPJS' },
    ],
  },

  // ---------- Administrasi ----------
  {
    part: 'Administrasi',
    key: 'settings',
    admin: true,
    label: 'Pengaturan',
    icon: APP_ICONS.settings,
    children: [
      { key: '/settings/company', label: 'Perusahaan' },
      { key: '/settings/users', label: 'Pengguna' },
      { key: '/settings/apps', label: 'Aplikasi' },
      { key: '/settings/import', label: 'Impor data (Excel)' },
      { key: '/billing', label: 'Langganan' },
      { key: '/settings/audit', label: 'Jejak audit' },
    ],
  },
];

export default function AppLayout() {
  const { me, loading } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { can, isAdmin } = useApps();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openState, setOpenState] = useState<{ for: string | undefined; keys: string[] }>();

  if (loading) return <Spin fullscreen tip="Menghubungkan ke server SANSU…" />;
  if (!me) return <Navigate to="/login" replace />;
  // Perusahaan mewajibkan 2FA tetapi akun ini belum mengaktifkan → harus diatur dulu
  if (me.twoFactor?.required && !me.twoFactor.enabled && pathname !== '/account/security')
    return <Navigate to="/account/security" replace />;

  const isDesktop = screens.lg !== false && screens.lg !== undefined;
  // Dashboard memuat angka penjualan/keuangan: hanya untuk peran yang berhak melihatnya (sama dengan aturan di server)
  const dashboardRole = ['OWNER', 'ADMIN', 'FINANCE', 'SALES'].includes(me.role);
  const visible = MENU.filter(
    (g) =>
      (!g.models || g.models.includes(me.businessModel)) &&
      (g.admin ? isAdmin : g.app ? can(g.app) : (can('accounting') || can('sales')) && (g.key !== '/dashboard' || dashboardRole)),
  );
  const L = (text: string) => localize(text, me.businessModel);
  // Fitur pajak yang tidak relevan (non-PKP, PPh final, usaha penjualan barang) tidak ditampilkan
  const taxOk = (i: Item) => !i.tax || me.taxFeatures?.[i.tax] !== false;
  const toMenu = (g: Group): NonNullable<MenuProps['items']>[number] =>
    g.children
      ? {
          key: g.key,
          icon: g.icon,
          label: L(g.label),
          children: g.children
            .filter((c) => 'section' in c || ((!c.app || can(c.app)) && taxOk(c)))
            .map((c) =>
              'section' in c
                ? {
                    type: 'group' as const,
                    key: `${g.key}:${c.section}`,
                    label: <span style={SECTION_STYLE}>{L(c.section)}</span>,
                    children: c.items.filter((i) => (!i.app || can(i.app)) && taxOk(i)).map(({ key, label }) => ({ key, label: L(label) })),
                  }
                : { key: c.key, label: L(c.label) },
            ),
        }
      : { key: g.key, icon: g.icon, label: L(g.label) };
  // Menu utama dikelompokkan per bagian alur kerja (judul kecil hanya tampil saat sidebar terbuka)
  const parts = [...new Set(visible.map((g) => g.part))];
  const items: MenuProps['items'] = [
    { key: '/', icon: <AppstoreOutlined />, label: 'Semua aplikasi' },
    ...parts.flatMap((part): NonNullable<MenuProps['items']> => {
      const groups = visible.filter((g) => g.part === part).map(toMenu);
      return part && !(collapsed && isDesktop)
        ? [
            {
              type: 'group' as const,
              key: `part:${part}`,
              label: <span style={PART_STYLE}>{L(part)}</span>,
              children: groups,
            },
          ]
        : groups;
    }),
    ...(me.isPlatformAdmin
      ? [{ type: 'divider' as const }, { key: '/platform', icon: <CrownOutlined />, label: 'Panel SANSU' }]
      : []),
  ];
  // Kunci menu terpanjang yang cocok dengan URL (mis. /pos/sessions, /returns?tab=purchase)
  const allKeys = [
    ...visible.flatMap((g) => (g.children ? subItems(g.children).map((c) => c.key) : [g.key])),
    '/platform',
  ];
  const url = pathname + search;
  const selected =
    allKeys
      .filter((k) => (k.includes('?') ? url.startsWith(k) : pathname === k || pathname.startsWith(`${k}/`)))
      .sort((a, b) => b.length - a.length)[0] ?? pathname;
  const openGroup = visible.find((g) => subItems(g.children).some((c) => c.key === selected))?.key;
  // Hanya satu submenu terbuka sekaligus agar sidebar tetap ringkas
  const openKeys = openState && openState.for === openGroup ? openState.keys : openGroup ? [openGroup] : [];

  const brand = (
    <div
      style={{
        padding: collapsed && isDesktop ? '18px 0' : '18px 20px',
        textAlign: collapsed && isDesktop ? 'center' : 'left',
      }}
    >
      <Logo size={30} tone="light" showName={!(collapsed && isDesktop)} />
    </div>
  );
  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selected]}
      openKeys={collapsed && isDesktop ? undefined : openKeys}
      onOpenChange={(keys) => setOpenState({ for: openGroup, keys: keys.slice(-1) })}
      items={items}
      onClick={(e) => {
        navigate(e.key);
        setDrawerOpen(false);
      }}
    />
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {isDesktop ? (
        <Layout.Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={220}
          style={{ position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}
        >
          {brand}
          {menu}
        </Layout.Sider>
      ) : (
        <Drawer
          placement="left"
          width={240}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          closable={false}
          styles={{ body: { padding: 0, background: BRAND.colors.ink } }}
        >
          {brand}
          {menu}
        </Drawer>
      )}
      <Layout>
        <Layout.Header
          style={{
            padding: '0 16px',
            borderBottom: '1px solid #e6e9ef',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {!isDesktop && <Button icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="Menu" />}
            {pathname !== '/' && isDesktop && (
              <Button
                type="text"
                icon={<AppstoreOutlined />}
                onClick={() => navigate('/')}
                aria-label="Semua aplikasi"
              />
            )}
            <Typography.Text strong ellipsis style={{ maxWidth: isDesktop ? 400 : 200 }}>
              {me.tenantName}
            </Typography.Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HelpButton />
            <AccountMenu />
          </div>
        </Layout.Header>
        <Layout.Content style={{ margin: screens.md ? 24 : 12, minWidth: 0 }}>
          <ServerStatus />
          <AccountStatusBanner />
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

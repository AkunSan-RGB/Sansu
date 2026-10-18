import { rememberReturnTo } from '@/auth/returnTo';
import { ApartmentOutlined, AppstoreOutlined, AuditOutlined, CrownOutlined, MenuOutlined } from '@ant-design/icons';
import { BUSINESS_MODELS, localize, type AppKey, type BusinessModel } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Drawer, Grid, Layout, Menu, type MenuProps, message, Segmented, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BRAND } from '@sansu/shared';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import Logo from '@/brand/Logo';
import ServerStatus from '@/components/ServerStatus';
import AccountStatusBanner from '@/components/AccountStatusBanner';
import AccountMenu from '@/components/AccountMenu';
import ReminderBell from '@/components/ReminderBell';
import { HelpButton } from '@/features/help/HelpCenter';
import { APP_ICONS, useApps } from '@/lib/apps';
import { t } from '@/lib/terms';

/** `app`: item hanya tampil bila aplikasi itu aktif (mis. menu pajak yang butuh aplikasi Penjualan) */
type Item = { key: string; label: string; /** Hanya untuk peran ini (OWNER selalu boleh) */ roles?: string[]; /** Hanya tampil bila fitur langganan dinyalakan di Panel SANSU */ billing?: boolean; /** Hanya untuk SAK EP (tidak diakui SAK EMKM) */ epOnly?: boolean; app?: AppKey; /** Disembunyikan untuk jenis usaha ini (mis. surat jalan untuk usaha jasa murni) */ hideFor?: BusinessModel[]; /** Hanya tampil untuk jenis usaha ini */ models?: BusinessModel[]; /** Hanya tampil bila perusahaan punya cabang usaha */ branch?: boolean; /** Hanya tampil bila perusahaan sudah membuat anggaran */ budget?: boolean; /** Hanya tampil bila fitur pajak ini relevan (lihat taxFeatures di @sansu/shared) */ tax?: 'vat' | 'coretax' | 'withheldByCustomers' | 'fiscalReconciliation' };
/** Menu pembukuan: Keuangan (pemegang uang) tidak memilikinya; OWNER selalu boleh */
const BOOKKEEPING = ['ADMIN', 'ACCOUNTANT'];
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
  /** Judul bagian di sidebar (Penjualan, Pembelian, Persediaan, Produksi, Keuangan, Pembukuan & pajak, SDM, Administrasi) */
  part: string;
  /** Peran yang hanya melihat menu ini (tanpa hak mengubah): diberi keterangan "lihat" pada judul grup */
  readOnlyFor?: string[];
  /** Menu inti: tampil untuk peran di `roles` tanpa syarat aplikasi */
  core?: boolean;
  roles?: string[];
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
 * pembukuan (persiapan → harian → aset & penyusutan → akhir periode) → pajak → SDM → administrasi.
 * Submenu juga berurutan dari langkah pertama ke terakhir; data master di akhir.
 */
const MENU: Group[] = [
  { part: '', key: '/dashboard', label: 'Dashboard', icon: APP_ICONS.dashboard, to: '/dashboard' },
  { part: '', key: '/workflow', label: 'Alur kerja', icon: <ApartmentOutlined />, to: '/workflow', core: true, roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'PURCHASING', 'WAREHOUSE', 'CASHIER'] },

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
      { key: '/customer-deposits', label: t('Uang muka pelanggan'), hideFor: ['RITEL'] },
      { key: '/projects', label: 'Proyek & termin', models: ['JASA'] },
      { key: '/deliveries', label: 'Surat jalan', hideFor: ['JASA', 'RITEL', 'FNB'] },
      { key: '/invoices', label: t('Faktur & piutang') },
      { key: '/returns?tab=sales', label: t('Retur penjualan') },
      { key: '/price-lists', label: 'Daftar harga', models: ['FMCG'] },
      { key: '/promos', label: 'Promo & bonus barang', models: ['FMCG'] },
      { key: '/consignments', label: 'Konsinyasi (titipan outlet)', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT'] },
      { key: '/goods-swaps', label: 'Tukar-guling', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT'] },
      { key: '/canvass', label: 'Kanvas (van sales)', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE', 'ACCOUNTANT'] },
      { key: '/trade', label: 'Modern trade & klaim prinsipal', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'] },
      { key: '/sales-targets', label: 'Target & komisi sales', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'] },
      { key: '/integrations?tab=marketplace', label: 'Marketplace' },
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
      { key: '/pos/tables', label: 'Meja & pesanan', models: ['FNB'] },
      { key: '/pos/kitchen', label: 'Layar dapur', models: ['FNB'] },
      { key: '/pos/online', label: 'Pesanan online', models: ['FNB'], roles: ['ADMIN', 'FINANCE'] },
      { key: '/pos/sessions', label: 'Riwayat sesi kasir' },
    ],
  },

  // ---------- Pembelian & stok ----------
  {
    part: 'Pembelian',
    key: 'purchase',
    app: 'purchase',
    label: t('Pembelian'),
    icon: APP_ICONS.purchase,
    children: [
      { key: '/purchase-requests', label: 'Permintaan beli' },
      { key: '/purchase-orders', label: t('Purchase Order') },
      { key: '/goods-receipts', label: 'Penerimaan barang', hideFor: ['JASA'] },
      { key: '/purchase-invoices', label: t('Faktur & hutang') },
      { key: '/returns?tab=purchase', label: t('Retur pembelian'), roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'WAREHOUSE'] },
      { key: '/price-agreements', label: 'Kontrak harga prinsipal', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING'] },
      { key: '/price-agreements', label: 'Harga pemasok bahan', models: ['FNB'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING'] },
      { key: '/price-agreements', label: 'Kontrak harga pemasok', models: ['DAGANG', 'RITEL', 'MANUFAKTUR'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'PURCHASING'] },
      { key: '/purchase-controls', label: 'Kontrol pembelian', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'], hideFor: ['JASA'] },
      { section: 'Data', items: [{ key: '/suppliers', label: t('Supplier') }] },
    ],
  },
  {
    part: 'Persediaan',
    key: 'inventory',
    app: 'inventory',
    label: t('Inventori'),
    icon: APP_ICONS.inventory,
    children: [
      { key: '/inventory', label: t('Persediaan & mutasi') },
      { key: '/inventory/warehouses', label: t('Persediaan per gudang') },
      { key: '/inventory/transfers', label: t('Transfer gudang') },
      { key: '/inventory/counts', label: 'Stock opname' },
      { key: '/inventory/expiry', label: 'Kedaluwarsa bahan', hideFor: ['JASA'] },
      { key: '/inventory/lot-trace', label: 'Telusuri lot (recall)', models: ['FMCG'], roles: ['OWNER', 'ADMIN', 'FINANCE', 'WAREHOUSE', 'SALES', 'ACCOUNTANT'] },
      { key: '/inventory/movement', label: t('Perputaran persediaan') },
      { key: '/inventory/writedowns', label: 'Penurunan nilai', epOnly: true, hideFor: ['JASA'] },
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
    part: 'Produksi',
    key: 'production',
    app: 'inventory',
    models: ['MANUFAKTUR', 'FNB'],
    label: 'Produksi',
    icon: APP_ICONS.production,
    children: [
      { key: '/production/boms', label: t('Resep (BOM)') },
      { key: '/production/requirements', label: 'Kebutuhan bahan (MRP)', models: ['MANUFAKTUR'] },
      { key: '/production/orders', label: 'Perintah produksi' },
      { key: '/production/report', label: 'Harga pokok produksi' },
      { key: '/production/variance', label: 'Analisis selisih', models: ['MANUFAKTUR'] },
    ],
  },

  // ---------- Keuangan ----------
  {
    part: 'Keuangan',
    key: 'cash',
    app: 'cash',
    label: 'Kas & Bank',
    icon: APP_ICONS.cash,
    readOnlyFor: ['ACCOUNTANT'],
    children: [
      { key: '/cash', label: 'Transaksi kas & bank' },
      { key: '/petty-cash', label: 'Kas kecil' },
      { key: '/bank', label: 'Rekonsiliasi bank' },
      { key: '/cash/counts', label: 'Opname kas' },
    ],
  },
  {
    part: 'Pembukuan & pajak',
    key: 'accounting',
    app: 'accounting',
    label: 'Akuntansi',
    icon: APP_ICONS.accounting,
    readOnlyFor: ['FINANCE'],
    // Urut mengikuti alur kerja pembukuan. Yang memegang uang (Keuangan) hanya melihat pencatatan dan laporan,
    // sedangkan persiapan dan tutup periode khusus yang membukukan (Akuntan/Admin/Pemilik).
    children: [
      {
        section: 'Persiapan',
        items: [
          { key: '/accounts', label: 'Bagan akun', roles: BOOKKEEPING },
          { key: '/opening-balance', label: 'Saldo awal', roles: BOOKKEEPING },
        ],
      },
      {
        section: 'Pencatatan',
        items: [
          { key: '/journals', label: 'Jurnal umum' },
          { key: '/adjustments', label: 'Jurnal penyesuaian', roles: BOOKKEEPING },
          { key: '/fixed-assets', label: 'Aset tetap' },
          { key: '/fx', label: 'Mata uang asing' },
        ],
      },
      {
        section: 'Laporan',
        items: [
          { key: '/ledger', label: 'Buku besar' },
          { key: '/trial-balance', label: 'Neraca saldo' },
          { key: '/worksheet', label: 'Neraca lajur' },
          { key: '/reports', label: 'Laporan keuangan' },
          { key: '/health', label: 'Cek kesehatan' },
        ],
      },
      {
        section: 'Akhir periode',
        items: [
          { key: '/closing', label: 'Tutup buku', roles: BOOKKEEPING },
          { key: '/settings/company?tab=pelaporan', label: 'Pelaporan keuangan', roles: BOOKKEEPING },
        ],
      },
    ],
  },
  {
    part: 'Pembukuan & pajak',
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
      { key: '/fiscal', label: 'Rekonsiliasi fiskal', tax: 'fiscalReconciliation', roles: BOOKKEEPING },
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
      { key: '/employees/controls', label: 'Persetujuan & peringatan', models: ['JASA'], roles: ['OWNER', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT'] },
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
      { key: '/payroll/jasa', label: 'Upah jasa (jam, sesi, komisi)', models: ['JASA'], roles: ['OWNER', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT'] },
      { key: '/payroll/jasa', label: 'Premi shift & borongan', models: ['RITEL', 'FNB'], roles: ['OWNER', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT'] },
      { key: '/payroll/jasa', label: 'Upah borongan & per hasil', models: ['MANUFAKTUR', 'DAGANG', 'FMCG'], roles: ['OWNER', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT'] },
      { key: '/payroll/pph21', label: 'Rekap PPh 21' },
      { key: '/payroll/bpjs', label: 'Rekap BPJS' },
    ],
  },

  // ---------- Administrasi ----------
  { part: 'Administrasi', key: '/approvals', label: 'Persetujuan', icon: <AuditOutlined />, to: '/approvals' },
  {
    part: 'Administrasi',
    key: 'settings',
    admin: true,
    label: 'Pengaturan',
    icon: APP_ICONS.settings,
    children: [
      { key: '/settings/company', label: 'Perusahaan' },
      { key: '/settings/users', label: 'Pengguna' },
      { key: '/settings/branches', label: 'Cabang & toko', branch: true },
      { key: '/settings/apps', label: 'Aplikasi' },
      { key: '/settings/import', label: 'Impor data (Excel)' },
      { key: '/billing', label: 'Langganan', billing: true },
      { key: '/settings/audit', label: 'Jejak audit' },
    ],
  },
];

export default function AppLayout() {
  const { me, loading, logout, startDemo } = useAuth();
  const [switching, setSwitching] = useState(false);
  const switchDemo = async (model: BusinessModel) => {
    setSwitching(true);
    try {
      await startDemo(model);
      window.location.assign('/dashboard');
    } catch (e) {
      message.error((e as Error).message || 'Gagal membuat demo baru');
      setSwitching(false);
    }
  };
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { can, isAdmin } = useApps();
  const screens = Grid.useBreakpoint();
  const pendingApprovals = useQuery({
    queryKey: ['approvals', 'count'],
    queryFn: () => get<{ count: number }>('/approvals/pending-count'),
    enabled: !!me && ['OWNER', 'ADMIN'].includes(me.role),
    refetchInterval: 60_000,
  });
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openState, setOpenState] = useState<{ for: string | undefined; keys: string[] }>();

  if (loading) return <Spin fullscreen tip="Menghubungkan ke server SANSU…" />;
  if (!me) {
    rememberReturnTo(pathname + search);
    return <Navigate to="/login" replace />;
  }
  // Perusahaan mewajibkan 2FA tetapi akun ini belum mengaktifkan → harus diatur dulu
  if (me.twoFactor?.required && !me.twoFactor.enabled && pathname !== '/account/security')
    return <Navigate to="/account/security" replace />;

  const isDesktop = screens.lg !== false && screens.lg !== undefined;
  // Dashboard memuat angka penjualan/keuangan: hanya untuk peran yang berhak melihatnya (sama dengan aturan di server)
  const dashboardRole = ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES'].includes(me.role);
  // Akuntan bekerja di pembukuan: Akuntansi dan Pajak lebih dulu, Kas & Bank (hanya lihat) sesudahnya
  const ordered = (() => {
    if (me.role !== 'ACCOUNTANT') return MENU;
    const rest = MENU.filter((g) => g.key !== 'cash');
    const at = rest.findIndex((g) => g.key === 'tax');
    return [...rest.slice(0, at + 1), ...MENU.filter((g) => g.key === 'cash'), ...rest.slice(at + 1)];
  })();
  const visible = ordered.filter(
    (g) =>
      (!g.models || g.models.includes(me.businessModel)) &&
      (g.core ? me.role === 'OWNER' || !!g.roles?.includes(me.role) : g.admin ? isAdmin : g.app ? can(g.app) : (can('accounting') || can('sales')) && (g.key !== '/dashboard' || dashboardRole)),
  );
  const L = (text: string) => localize(text, me.businessModel);
  // Fitur pajak yang tidak relevan (non-PKP, PPh final, usaha penjualan barang) tidak ditampilkan
  const taxOk = (i: Item) => (!i.roles || me.role === 'OWNER' || i.roles.includes(me.role)) && (!i.models || i.models.includes(me.businessModel)) && (!i.tax || me.taxFeatures?.[i.tax] !== false) && !i.hideFor?.includes(me.businessModel) && !(i.epOnly && me.framework === 'SAK_EMKM') && !(i.billing && me.subscription?.enabled === false) && !(i.branch && !me.multiBranch) && !(i.budget && !me.hasBudget);
  const toMenu = (g: Group): NonNullable<MenuProps['items']>[number] =>
    g.children
      ? {
          key: g.key,
          icon: g.icon,
          label: g.readOnlyFor?.includes(me.role) ? <span>{L(g.label)} <span style={{ fontSize: 11, opacity: 0.6 }}>· lihat</span></span> : L(g.label),
          children: g.children
            .filter((c) => ('section' in c ? c.items.some((i) => (!i.app || can(i.app)) && taxOk(i)) : (!c.app || can(c.app)) && taxOk(c)))
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
      : { key: g.key, icon: g.icon, label: g.key === '/approvals' && pendingApprovals.data?.count ? <Badge count={pendingApprovals.data.count} offset={[14, 2]}>{L(g.label)}</Badge> : L(g.label) };
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
          width={248}
          style={{ position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}
        >
          {brand}
          {menu}
        </Layout.Sider>
      ) : (
        <Drawer
          placement="left"
          width={288}
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
          className="sansu-header"
          style={{
            padding: '0 24px',
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
            <span className="sh-chip" style={{ maxWidth: isDesktop ? 400 : 190 }}>
              <i />
              <Typography.Text strong ellipsis style={{ color: 'inherit' }}>
                {me.tenantName}
              </Typography.Text>
            </span>
            {screens.lg && <span className="sh-date">{new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ReminderBell />
            <HelpButton />
            <AccountMenu />
          </div>
        </Layout.Header>
        <Layout.Content style={{ margin: screens.md ? 24 : 12, minWidth: 0 }}>
          {me.demo && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Mode demo — PT DEMO berisi data contoh"
              description={
                <div>
                  <div>{`Jangan memasukkan data asli. Perusahaan demo ini dihapus otomatis pada ${new Date(me.demo.expiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}.`}</div>
                  <div style={{ marginTop: 8, maxWidth: '100%', overflowX: 'auto' }}>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>Lihat contoh jenis usaha lain (produk dan transaksinya berbeda):</div>
                    <Segmented
                      size="small"
                      disabled={switching}
                      value={me.businessModel}
                      onChange={(v) => switchDemo(v as BusinessModel)}
                      options={BUSINESS_MODELS.map((m) => ({ value: m.key, label: m.name }))}
                    />
                  </div>
                  <Button size="small" type="primary" style={{ marginTop: 8 }} onClick={() => logout()}>
                    Keluar & daftar sendiri
                  </Button>
                </div>
              }
            />
          )}
          <ServerStatus />
          <AccountStatusBanner />
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

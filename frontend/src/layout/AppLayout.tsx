import { taskCountByPath, useTasks } from './useTasks';
import ApprovalAssignListener from '@/features/approvals/ApprovalAssignListener';
import { rememberReturnTo } from '@/auth/returnTo';
import { AppstoreOutlined, CrownOutlined, MenuOutlined, SettingOutlined } from '@ant-design/icons';
import { BUSINESS_MODELS, SERVICE_PROFILES, SERVICE_PROFILE_KEYS, localize, type BusinessModel, type ServiceProfile } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Checkbox, Drawer, Grid, Layout, Menu, type MenuProps, message, Segmented, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
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
import { useApps } from '@/lib/apps';
import { type Group, type Item, menuFor, profileOk, subItems } from './menuData';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import QueryErrorBanner from '@/components/QueryErrorBanner';

const PART_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: '#7c8aa5',
};
const SECTION_STYLE: React.CSSProperties = { fontSize: 11, letterSpacing: 0.6, color: '#8b97ad' };

export default function AppLayout() {
  const { me, loading, logout, startDemo } = useAuth();
  const [switching, setSwitching] = useState(false);
  const switchDemo = async (model: BusinessModel, profile?: ServiceProfile) => {
    setSwitching(true);
    try {
      await startDemo(model, profile);
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
  const tasks = useTasks();
  const taskCounts = taskCountByPath(tasks.data);
  const taskTotal = (tasks.data ?? []).reduce((a, t) => a + t.count, 0);
  const hiddenKey = `sansu.menu.hidden.${me?.id ?? ''}`;
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(hiddenKey) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem(hiddenKey) ?? '[]') as string[]);
    } catch {
      setHidden([]);
    }
  }, [hiddenKey]);
  const [customizing, setCustomizing] = useState(false);
  const saveHidden = (h: string[]) => {
    setHidden(h);
    try {
      localStorage.setItem(hiddenKey, JSON.stringify(h));
    } catch {
      /* penyimpanan browser tidak tersedia */
    }
  };
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
  const byModel = menuFor(me.businessModel);
  const ordered = (() => {
    if (me.role !== 'ACCOUNTANT') return byModel;
    const rest = byModel.filter((g) => g.key !== 'cash');
    const at = rest.findIndex((g) => g.key === 'tax');
    return [...rest.slice(0, at + 1), ...byModel.filter((g) => g.key === 'cash'), ...rest.slice(at + 1)];
  })();
  const visible = ordered.filter(
    (g) =>
      (!g.models || g.models.includes(me.businessModel)) &&
      !g.hideFor?.includes(me.businessModel) &&
      profileOk(g.profiles, me.businessModel, me.serviceProfiles) &&
      (g.core ? me.role === 'OWNER' || !!g.roles?.includes(me.role) : g.admin ? isAdmin : g.app ? can(g.app) : (can('accounting') || can('sales')) && (g.key !== '/dashboard' || dashboardRole)),
  );
  const L = (text: string) => localize(text, me.businessModel);
  // Fitur pajak yang tidak relevan (non-PKP, PPh final, usaha penjualan barang) tidak ditampilkan
  const taxOk = (i: Item) => profileOk(i.profiles, me.businessModel, me.serviceProfiles) && (!i.roles || me.role === 'OWNER' || i.roles.includes(me.role)) && (!i.models || i.models.includes(me.businessModel)) && (!i.tax || me.taxFeatures?.[i.tax] !== false) && !i.hideFor?.includes(me.businessModel) && !(i.epOnly && me.framework === 'SAK_EMKM') && !(i.billing && me.subscription?.enabled === false) && !(i.branch && !me.multiBranch) && !(i.budget && !me.hasBudget);
  // Menu yang disembunyikan pengguna sendiri (preferensi pribadi); menu yang sedang dibuka dan menu inti tidak pernah hilang
  const keepKeys = new Set(['/tasks', '/approvals', '/dashboard']);
  const shown = (key: string) => !hidden.includes(key) || keepKeys.has(key) || key === pathname + search || (key.split('?')[0] === pathname && !key.includes('?'));
  const withBadge = (key: string, label: React.ReactNode) => {
    const n = taskCounts.get(key.split('?')[0]) ?? 0;
    return n ? <Badge count={n} size="small" offset={[10, 0]}>{label}</Badge> : label;
  };
  const toMenu = (g: Group): NonNullable<MenuProps['items']>[number] =>
    g.children
      ? {
          key: g.key,
          icon: g.icon,
          label: g.readOnlyFor?.includes(me.role) ? <span>{L(g.label)} <span style={{ fontSize: 11, opacity: 0.6 }}>· lihat</span></span> : L(g.label),
          children: g.children
            .filter((c) => ('section' in c ? c.items.some((i) => (!i.app || can(i.app)) && taxOk(i) && shown(i.key)) : (!c.app || can(c.app)) && taxOk(c) && shown(c.key)))
            .map((c) =>
              'section' in c
                ? {
                    type: 'group' as const,
                    key: `${g.key}:${c.section}`,
                    label: <span style={SECTION_STYLE}>{L(c.section)}</span>,
                    children: c.items.filter((i) => (!i.app || can(i.app)) && taxOk(i) && shown(i.key)).map(({ key, label }) => ({ key, label: withBadge(key, L(label)) })),
                  }
                : { key: c.key, label: withBadge(c.key, L(c.label)) },
            ),
        }
      : { key: g.key, icon: g.icon, label: g.key === '/tasks' && taskTotal ? <Badge count={taskTotal} offset={[14, 2]}>{L(g.label)}</Badge> : g.key === '/approvals' && pendingApprovals.data?.count ? <Badge count={pendingApprovals.data.count} offset={[14, 2]}>{L(g.label)}</Badge> : L(g.label) };
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
  // Kas kecil adalah tab di dalam halaman Kas (menunya satu)
  const menuPath = pathname.startsWith('/petty-cash') ? '/cash' : pathname;
  const selected =
    allKeys
      .filter((k) => (k.includes('?') ? url.startsWith(k) : menuPath === k || menuPath.startsWith(`${k}/`)))
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
        void navigate(e.key);
        setDrawerOpen(false);
      }}
    />
  );

  // Semua submenu yang boleh dilihat peran ini (untuk dipilih disembunyikan)
  const customizable = visible.flatMap((g) =>
    g.children
      ? subItems(g.children)
          .filter((i) => (!i.app || can(i.app)) && taxOk(i) && !keepKeys.has(i.key))
          .map((i) => ({ key: i.key, label: `${L(g.label)} › ${L(i.label)}` }))
      : [],
  );
  const customizer = (
    <div style={{ padding: collapsed && isDesktop ? 8 : '8px 20px 16px', textAlign: collapsed && isDesktop ? 'center' : 'left' }}>
      <Button size="small" type="text" icon={<SettingOutlined />} onClick={() => setCustomizing(true)} style={{ color: '#8b97ad' }}>
        {collapsed && isDesktop ? '' : 'Sesuaikan menu'}
      </Button>
    </div>
  );
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Drawer open={customizing} onClose={() => setCustomizing(false)} width={Math.min(420, window.innerWidth)} title="Sesuaikan menu Anda"
        extra={<Button onClick={() => saveHidden([])} disabled={!hidden.length}>Tampilkan semua</Button>}>
        <Typography.Paragraph type="secondary">Hilangkan menu yang tidak Anda pakai supaya sidebar lebih ringkas. Ini hanya mengubah tampilan Anda sendiri; hak akses tidak berubah, dan menu bisa ditampilkan lagi kapan saja.</Typography.Paragraph>
        {customizable.map((i) => (
          <div key={i.key} style={{ padding: '4px 0' }}>
            <Checkbox checked={!hidden.includes(i.key)} onChange={(e) => saveHidden(e.target.checked ? hidden.filter((k) => k !== i.key) : [...hidden, i.key])}>{i.label}</Checkbox>
          </div>
        ))}
      </Drawer>
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
          {customizer}
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
          {customizer}
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
                    {me.businessModel === 'JASA' && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>Layanan jasa yang didemokan (data tiap layanan berbeda):</div>
                        <Segmented
                          size="small"
                          disabled={switching}
                          value={me.serviceProfiles?.[0]}
                          onChange={(v) => switchDemo('JASA', v as ServiceProfile)}
                          options={SERVICE_PROFILE_KEYS.map((k) => ({ value: k, label: SERVICE_PROFILES[k].label }))}
                        />
                      </div>
                    )}
                  </div>
                  <Button size="small" type="primary" style={{ marginTop: 8 }} onClick={() => logout()}>
                    Keluar & daftar sendiri
                  </Button>
                </div>
              }
            />
          )}
          <ServerStatus />
          <QueryErrorBanner />
          <AccountStatusBanner />
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
          <ApprovalAssignListener />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

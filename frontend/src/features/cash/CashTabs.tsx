import { Tabs } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

/** Satu rumah untuk semua urusan uang tunai & rekening: tiap tab tetap halaman dan aturan sendiri (alamat terpisah, bisa ditautkan langsung) */
const TABS = [
  { key: '/cash', label: 'Uang masuk & keluar' },
  { key: '/petty-cash', label: 'Kas kecil' },
  { key: '/cash/counts', label: 'Hitung uang kas (opname)' },
];

export default function CashTabs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = pathname.startsWith('/cash/counts') ? '/cash/counts' : pathname.startsWith('/petty-cash') ? '/petty-cash' : '/cash';
  return <Tabs activeKey={active} items={TABS} onChange={(k) => navigate(k)} style={{ marginBottom: 4 }} />;
}

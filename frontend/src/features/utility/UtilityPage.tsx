import { DEFAULT_UTILITY_RULES, READING_FLAG_LABELS, UTILITY_CONNECTION_LABELS, UTILITY_SERVICE_LABELS, type ReadingFlag, type UtilityConnectionStatus, type UtilityRules, type UtilityServiceType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney, fmtQty } from '@/lib/format';
import { FieldTab, ImportTab } from './UtilityFieldTabs';
import { ChargesTab } from './utility/ChargesTab';
import { CounterPayTab, CounterRecapTab, CountersAdminTab } from './utility/CounterPages';
import { ConnectionsTab } from './utility/ConnectionsTab';
import { ReadingsTab } from './utility/ReadingsTab';
import { BillingTab } from './utility/BillingTab';
import { TariffsTab } from './utility/TariffsTab';
import { STATUS_COLOR } from './utility/shared';
import { AdjustmentsTab } from './ops/AdjustmentsTab';
import { ApplicationsTab } from './ops/ApplicationsTab';
import { ChangesTab } from './ops/ChangesTab';
import { CollectionTab } from './ops/CollectionTab';
import { ComplaintsTab } from './ops/ComplaintsTab';
import { DepositsTab } from './ops/DepositsTab';
import { InstallmentsTab } from './ops/InstallmentsTab';
import { MetersTab } from './ops/MetersTab';
import { NetworkAssetsTab, WorkOrdersTab } from './ops/NetworkTabs';
import { NoticesTab } from './ops/NoticesTab';
import { PortalTab } from './ops/PortalTab';
import { ProductionTab, QualityTab } from './ops/ProductionTabs';
import { RoutesTab } from './ops/RoutesTab';
import { OutboxTab, VaTab } from './ops/VaOutboxTabs';

const SEV: Record<string, string> = { high: 'red', medium: 'orange' };

const COL: Record<string, string> = { number: 'Sambungan', customer: 'Pelanggan', address: 'Alamat', lastPeriod: 'Pencatatan terakhir', period: 'Periode', days: 'Hari', usage: 'Pemakaian', flags: 'Tanda', userName: 'Petugas', service: 'Layanan', n: 'Jumlah', numbers: 'Nomor sambungan', zone: 'Zona', supplied: 'Pasokan', lossPct: 'Kehilangan (%)', loss: 'Kehilangan', status: 'Keterangan' };

const ZONE_STATUS: Record<string, { label: string; color: string }> = { NO_SUPPLY: { label: 'Pasokan belum diisi', color: 'default' }, INCOMPLETE: { label: 'Belum lengkap', color: 'gold' }, HIGH: { label: 'Kehilangan tinggi', color: 'red' }, OK: { label: 'Wajar', color: 'green' }, NEGATIVE: { label: 'Pemakaian melebihi pasokan', color: 'volcano' } };

interface Summary { period: string; active: number; suspended: number; awaitingVerification: number; readyToBill: number; missingReadings: number; overdueCount: number; overdueTotal: number; suggestSuspend: number; complaintsOpen?: number; complaintsOverdue?: number; complaintsNew?: number; applicationsOpen?: number; applicationsToActivate?: number; changesPending?: number; adjustmentsPending?: number; installmentsPending?: number; metersOverdue?: number; revenueAir: number; revenueNonAir: number; receiptsToday: number; counters: number; unconfirmedDays: number }

interface ZoneRow { zone: string; period: string; unit: string | null; mixedUnits: boolean; connections: number; supplied: number | null; usage: number; loss: number | null; lossPct: number | null; unverified: number; missing: number; note: string | null; status: string }

interface Overdue { id: string; number: string; status: UtilityConnectionStatus; address: string; customerName: string; phone: string | null; outstanding: string; daysLate: number; bills: number; suggestSuspend: boolean }

interface Control { key: string; title: string; severity: string; items: Record<string, unknown>[] }

const WATER_TITLES: Record<string, string> = {
  ringkasan: 'Ringkasan layanan air',
  sambungan: 'Pelanggan & sambungan',
  meter: 'Catat & verifikasi meter',
  lapangan: 'Petugas lapangan',
  impor: 'Impor & alat meter',
  tagihan: 'Tagihan air bulanan',
  'non-air': 'Layanan non-air',
  loket: 'Terima pembayaran (loket)',
  rekap: 'Rekap harian loket',
  lokasi: 'Daftar loket',
  tunggakan: 'Tunggakan & pemutusan',
  zona: 'Kehilangan air per zona',
  tarif: 'Tarif air & aturan',
  kontrol: 'Kontrol kebocoran pendapatan',
  permohonan: 'Permohonan sambungan baru',
  mutasi: 'Balik nama, ganti golongan, tutup sambungan',
  pengaduan: 'Pengaduan & gangguan',
  portal: 'Portal pelanggan',
  rute: 'Rute baca & tagih',
  koreksi: 'Koreksi tagihan & pemutihan denda',
  cetak: 'Cetak & kirim tagihan / surat peringatan',
  penagihan: 'Penagihan lapangan',
  angsuran: 'Angsuran tunggakan',
  jaminan: 'Deposit / jaminan sambungan',
  inventaris: 'Inventaris & tera ulang meter',
  aset: 'Aset jaringan',
  'perintah-kerja': 'Perintah kerja',
  produksi: 'Produksi air & air tak berekening',
  kualitas: 'Kualitas air',
  va: 'Pembayaran virtual account',
  antrean: 'Antrean pesan otomatis',
};

export default function UtilityPage() {
  const { tab = 'ringkasan' } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const can = useCan();
  const fin = !!me && ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'].includes(me.role);
  const summary = useQuery({ queryKey: ['utility', 'summary'], queryFn: () => get<Summary>('/utility/summary'), refetchInterval: 60_000 });
  const go = (t: string) => navigate(`/utility/${t}`);
  const tabs = [
    { key: 'ringkasan', label: 'Ringkasan', children: <Overview s={summary.data} go={go} /> },
    { key: 'sambungan', label: 'Sambungan', children: <ConnectionsTab /> },
    ...(can('POST', '/utility/field/readings') ? [{ key: 'lapangan', label: 'Petugas lapangan', children: <FieldTab /> }] : []),
    ...(can('POST', '/utility/readings/import') || can('POST', '/utility/ingest-keys') ? [{ key: 'impor', label: 'Impor & alat meter', children: <ImportTab /> }] : []),
    ...(can('POST', '/utility/counter/pay') || can('POST', '/utility/counter/remit') ? [{ key: 'loket', label: 'Loket', children: <CounterPayTab /> }] : []),
    ...(fin ? [{ key: 'rekap', label: 'Rekap loket', children: <CounterRecapTab /> }, { key: 'lokasi', label: 'Daftar loket', children: <CountersAdminTab /> }] : []),
    ...(fin ? [{ key: 'zona', label: 'Zona & kehilangan', children: <ZonesTab /> }] : []),
    { key: 'meter', label: `Catat meter${summary.data?.awaitingVerification ? ` (${summary.data.awaitingVerification})` : ''}`, children: <ReadingsTab /> },
    ...(can('POST', '/utility/charges/issue') || fin ? [{ key: 'non-air', label: 'Layanan non-air', children: <ChargesTab /> }] : []),
    ...(fin ? [{ key: 'tagihan', label: 'Tagihan bulanan', children: <BillingTab /> }, { key: 'tunggakan', label: `Tunggakan${summary.data?.overdueCount ? ` (${summary.data.overdueCount})` : ''}`, children: <OverdueTab /> }] : []),
    ...(me?.businessModel === 'UTILITAS' ? [
      { key: 'permohonan', label: 'Permohonan baru', children: <ApplicationsTab /> },
      { key: 'mutasi', label: 'Perubahan sambungan', children: <ChangesTab /> },
      { key: 'pengaduan', label: 'Pengaduan', children: <ComplaintsTab /> },
      { key: 'portal', label: 'Portal pelanggan', children: <PortalTab /> },
      { key: 'rute', label: 'Rute', children: <RoutesTab /> },
      { key: 'koreksi', label: 'Koreksi tagihan', children: <AdjustmentsTab /> },
      { key: 'cetak', label: 'Cetak & kirim', children: <NoticesTab /> },
      { key: 'penagihan', label: 'Penagihan lapangan', children: <CollectionTab /> },
      { key: 'angsuran', label: 'Angsuran', children: <InstallmentsTab /> },
      { key: 'jaminan', label: 'Jaminan', children: <DepositsTab /> },
      { key: 'inventaris', label: 'Inventaris meter', children: <MetersTab /> },
      { key: 'aset', label: 'Aset jaringan', children: <NetworkAssetsTab /> },
      { key: 'perintah-kerja', label: 'Perintah kerja', children: <WorkOrdersTab /> },
      { key: 'produksi', label: 'Produksi air', children: <ProductionTab /> },
      { key: 'kualitas', label: 'Kualitas air', children: <QualityTab /> },
      { key: 'va', label: 'Pembayaran VA', children: <VaTab /> },
      { key: 'antrean', label: 'Antrean pesan', children: <OutboxTab /> },
    ] : []),
    { key: 'tarif', label: 'Tarif & aturan', children: <TariffsTab /> },
    ...(fin ? [{ key: 'kontrol', label: 'Kontrol', children: <ControlsTab /> }] : []),
  ];
  const active = tabs.find((t) => t.key === tab) ?? tabs[0];
  // Perusahaan Utilitas: tiap menu membuka satu halaman fokus (tanpa deretan tab); jenis usaha lain tetap memakai tab seperti semula
  if (me?.businessModel === 'UTILITAS') {
    return (
      <>
        <PageHeader title={WATER_TITLES[active.key] ?? 'Layanan air'} />
        {active.children}
      </>
    );
  }
  return (
    <>
      <PageHeader title="Layanan utilitas" />
      <Tabs activeKey={active.key} onChange={go} items={tabs} destroyOnHidden />
    </>
  );
}

function Overview({ s, go }: { s?: Summary; go: (tab: string) => void }) {
  const { me } = useAuth();
  if (!s) return null;
  const water = me?.businessModel === 'UTILITAS';
  const Card1 = ({ title, value, tab, warn, hint }: { title: string; value: number | string; tab: string; warn?: boolean; hint?: string }) => (
    <Col xs={12} md={8} lg={6}><Card size="small" hoverable onClick={() => go(tab)}><Statistic title={title} value={value} valueStyle={warn ? { color: '#d97706' } : undefined} />{hint && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{hint}</div>}</Card></Col>
  );
  const todo = [
    s.missingReadings > 0 && { text: `${s.missingReadings} sambungan belum dicatat meternya bulan ${s.period}`, tab: 'meter', action: 'Catat meter' },
    s.awaitingVerification > 0 && { text: `${s.awaitingVerification} catatan meter menunggu verifikasi`, tab: 'meter', action: 'Verifikasi' },
    s.readyToBill > 0 && { text: `${s.readyToBill} catatan terverifikasi siap ditagih`, tab: 'tagihan', action: 'Terbitkan tagihan' },
    s.unconfirmedDays > 0 && { text: `${s.unconfirmedDays} rekap harian loket belum dicek Keuangan`, tab: 'rekap', action: 'Cek rekap' },
    s.suggestSuspend > 0 && { text: `${s.suggestSuspend} sambungan diusulkan diputus sementara karena menunggak`, tab: 'tunggakan', action: 'Tinjau' },
    (s.complaintsOverdue ?? 0) > 0 && { text: `${s.complaintsOverdue} pengaduan sudah lewat batas waktu penanganan`, tab: 'pengaduan', action: 'Tangani' },
    (s.complaintsNew ?? 0) > 0 && { text: `${s.complaintsNew} pengaduan baru belum ditugaskan ke petugas`, tab: 'pengaduan', action: 'Tugaskan' },
    (s.applicationsToActivate ?? 0) > 0 && { text: `${s.applicationsToActivate} sambungan baru sudah dipasang dan siap diaktifkan`, tab: 'permohonan', action: 'Aktifkan' },
    (s.changesPending ?? 0) > 0 && { text: `${s.changesPending} pengajuan perubahan sambungan menunggu persetujuan`, tab: 'mutasi', action: 'Putuskan' },
    (s.adjustmentsPending ?? 0) > 0 && { text: `${s.adjustmentsPending} pengajuan koreksi tagihan menunggu persetujuan`, tab: 'koreksi', action: 'Putuskan' },
    (s.installmentsPending ?? 0) > 0 && { text: `${s.installmentsPending} rencana angsuran menunggu persetujuan`, tab: 'angsuran', action: 'Putuskan' },
    (s.metersOverdue ?? 0) > 0 && { text: `${s.metersOverdue} meter terpasang sudah lewat jadwal tera ulang`, tab: 'inventaris', action: 'Jadwalkan tera' },
  ].filter(Boolean) as { text: string; tab: string; action: string }[];
  const total = s.revenueAir + s.revenueNonAir;
  return (
    <>
      {water && (
        <Card size="small" title={`Perlu tindakan${todo.length ? ` (${todo.length})` : ''}`} style={{ marginBottom: 16 }}>
          {todo.length ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              {todo.map((t) => (
                <div key={t.tab + t.text} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><span>{t.text}</span><Button size="small" type="link" onClick={() => go(t.tab)}>{t.action} ›</Button></div>
              ))}
            </Space>
          ) : <Typography.Text type="success">Semua pekerjaan bulan ini sudah beres.</Typography.Text>}
        </Card>
      )}
      {water && (
        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Card1 title={`Pendapatan air (${s.period})`} value={fmtMoney(Math.round(s.revenueAir))} tab="tagihan" hint={total ? `${Math.round(((s.revenueAir) / total) * 100)}% dari total pendapatan` : 'Pemakaian + abonemen'} />
          <Card1 title={`Pendapatan non-air (${s.period})`} value={fmtMoney(Math.round(s.revenueNonAir))} tab="non-air" hint="Sambung baru, administrasi, denda, dll." />
          <Card1 title="Diterima di loket hari ini" value={fmtMoney(Math.round(s.receiptsToday))} tab="rekap" hint={`${s.counters} loket aktif`} />
          <Card1 title="Rekap belum dicek" value={s.unconfirmedDays} tab="rekap" warn={s.unconfirmedDays > 0} hint="Hari lampau, per loket" />
        </Row>
      )}
      <Row gutter={[12, 12]}>
        <Card1 title="Sambungan aktif" value={s.active} tab="sambungan" />
        <Card1 title="Diputus sementara" value={s.suspended} tab="sambungan" />
        <Card1 title={`Belum dicatat (${s.period})`} value={s.missingReadings} tab="meter" warn={s.missingReadings > 0} />
        <Card1 title="Menunggu verifikasi" value={s.awaitingVerification} tab="meter" warn={s.awaitingVerification > 0} />
        <Card1 title="Siap ditagih" value={s.readyToBill} tab="tagihan" />
        <Card1 title="Tunggakan lewat jatuh tempo" value={fmtMoney(Math.round(s.overdueTotal))} tab="tunggakan" warn={s.overdueTotal > 0} />
        <Card1 title="Pelanggan menunggak" value={s.overdueCount} tab="tunggakan" />
        <Card1 title="Usulan pemutusan" value={s.suggestSuspend} tab="tunggakan" warn={s.suggestSuspend > 0} />
        {water && <Card1 title="Pengaduan belum tuntas" value={s.complaintsOpen ?? 0} tab="pengaduan" warn={(s.complaintsOverdue ?? 0) > 0} hint={(s.complaintsOverdue ?? 0) ? `${s.complaintsOverdue} lewat batas waktu` : undefined} />}
        {water && <Card1 title="Permohonan berjalan" value={s.applicationsOpen ?? 0} tab="permohonan" />}
      </Row>
      {water ? <WorkflowGuide /> : (
        <Alert style={{ marginTop: 16 }} type="info" showIcon message="Alur bulanan"
          description="1) Petugas mencatat meter  →  2) Orang lain memverifikasi (angka janggal ditandai)  →  3) Keuangan menerbitkan tagihan (faktur otomatis, denda ikut dihitung)  →  4) Pembayaran lewat Penjualan › Faktur  →  5) Tunggakan melewati batas diusulkan putus dan disambung kembali oleh orang lain setelah lunas." />
      )}
    </>
  );
}

interface FlowStep { title: string; who: string; roles: string[]; text: string; links: [string, string][] }
const FLOW: FlowStep[] = [
  { title: 'Siapkan data induk', who: 'Admin / Keuangan', roles: ['OWNER', 'ADMIN', 'FINANCE'], text: 'Sekali di awal, lalu bila ada perubahan: tarif air, pelanggan dan sambungannya, daftar loket, harga layanan non-air.', links: [['Tarif air', '/utility/tarif'], ['Sambungan', '/utility/sambungan'], ['Daftar loket', '/utility/lokasi'], ['Layanan non-air', '/utility/non-air']] },
  { title: 'Catat meter', who: 'Petugas lapangan', roles: ['OWNER', 'ADMIN', 'WAREHOUSE'], text: 'Tiap bulan, angka meter setiap sambungan dicatat: langsung di lokasi (dengan GPS dan foto), diimpor dari Excel, atau dikirim alat meter.', links: [['Catat meter', '/utility/meter'], ['Mode lapangan', '/utility/lapangan'], ['Impor & alat meter', '/utility/impor']] },
  { title: 'Verifikasi meter', who: 'Keuangan atau Admin (bukan yang mencatat)', roles: ['OWNER', 'ADMIN', 'FINANCE'], text: 'Angka yang janggal (melonjak, nol, meter diganti) ditandai dan wajib diberi catatan pemeriksa.', links: [['Verifikasi meter', '/utility/meter']] },
  { title: 'Terbitkan tagihan air', who: 'Keuangan', roles: ['OWNER', 'ADMIN', 'FINANCE'], text: 'Satu tagihan per sambungan per bulan dari meter yang sudah diverifikasi; denda tunggakan ikut dihitung.', links: [['Tagihan air bulanan', '/utility/tagihan']] },
  { title: 'Terima pembayaran di loket', who: 'Kasir loket (non-tunai)', roles: ['OWNER', 'ADMIN', 'FINANCE', 'CASHIER'], text: 'Pelanggan membayar lewat transfer, QRIS, virtual account, EDC, atau dompet digital; uang langsung masuk rekening, tanpa uang tunai.', links: [['Terima pembayaran', '/utility/loket']] },
  { title: 'Cek rekap harian loket', who: 'Keuangan (bukan kasir penerima)', roles: ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'], text: 'Rekap tiap loket per hari dicocokkan dengan mutasi bank, lalu dikonfirmasi atau ditandai selisih.', links: [['Rekap harian loket', '/utility/rekap']] },
  { title: 'Tagih layanan non-air', who: 'Pelayanan pelanggan (sewaktu-waktu)', roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES'], text: 'Sambung baru, sambung kembali, ganti meter, administrasi. Tagihannya dibayar di loket yang sama.', links: [['Layanan non-air', '/utility/non-air']] },
  { title: 'Tangani tunggakan', who: 'Keuangan / Admin', roles: ['OWNER', 'ADMIN', 'FINANCE'], text: 'Pelanggan yang menunggak, denda, dan usulan pemutusan sementara; sambung kembali setelah lunas oleh orang lain.', links: [['Tunggakan & pemutusan', '/utility/tunggakan']] },
  { title: 'Layani pelanggan baru dan pengaduan', who: 'Pelayanan pelanggan, petugas lapangan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE'], text: 'Permohonan sambungan baru dari survei sampai aktif; pengaduan dan gangguan ditugaskan, dikerjakan, lalu ditutup orang lain. Pelanggan juga bisa mengadu lewat tautan portal.', links: [['Permohonan baru', '/utility/permohonan'], ['Pengaduan', '/utility/pengaduan'], ['Portal pelanggan', '/utility/portal']] },
  { title: 'Ubah data sambungan dan koreksi tagihan', who: 'Pelayanan mengajukan, Keuangan menyetujui', roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES'], text: 'Balik nama, ganti golongan, pindah alamat, tutup permanen, pengurangan tagihan, dan pemutihan denda selalu disetujui orang lain dan terjurnal otomatis.', links: [['Perubahan sambungan', '/utility/mutasi'], ['Koreksi tagihan', '/utility/koreksi']] },
  { title: 'Tagih tunggakan', who: 'Pelayanan, kolektor, Keuangan', roles: ['OWNER', 'ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE'], text: 'Cetak atau kirim WhatsApp pengingat dan surat peringatan SP1–SP3; kolektor mengunjungi per rute dan mencatat janji bayar; tunggakan besar bisa dicicil atau dilunasi dari uang jaminan.', links: [['Cetak & kirim', '/utility/cetak'], ['Penagihan lapangan', '/utility/penagihan'], ['Angsuran', '/utility/angsuran'], ['Jaminan', '/utility/jaminan']] },
  { title: 'Rawat jaringan dan meter', who: 'Teknisi, petugas lapangan', roles: ['OWNER', 'ADMIN', 'WAREHOUSE'], text: 'Aset jaringan dan perintah kerja perawatan; inventaris meter dengan jadwal tera ulang; rute baca meter; produksi air harian dan kualitas air terhadap baku mutu.', links: [['Perintah kerja', '/utility/perintah-kerja'], ['Aset jaringan', '/utility/aset'], ['Inventaris meter', '/utility/inventaris'], ['Rute', '/utility/rute'], ['Produksi air', '/utility/produksi'], ['Kualitas air', '/utility/kualitas']] },
  { title: 'Pantau laporan dan kontrol', who: 'Pemilik / Akuntan', roles: ['OWNER', 'ADMIN', 'ACCOUNTANT'], text: 'Pendapatan air dan non-air terpisah, kehilangan air per zona, dan temuan kebocoran pendapatan.', links: [['Laporan kinerja', '/laporan/utility-kinerja'], ['Laporan layanan air', '/laporan/utility'], ['Laporan non-air', '/laporan/utility-nonair'], ['Kehilangan air', '/utility/zona'], ['Kontrol', '/utility/kontrol']] },
];

/** Alur kerja bernomor: siapa mengerjakan apa dan menu mana yang dipakai; langkah milik peran yang sedang masuk ditandai */
function WorkflowGuide() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const mine = (st: FlowStep) => !!me && st.roles.includes(me.role) && me.role !== 'OWNER';
  return (
    <Card size="small" style={{ marginTop: 16 }} title="Alur kerja layanan air — siapa mengerjakan apa" extra={me?.role !== 'OWNER' && <Tag color="blue">Langkah Anda ditandai</Tag>}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {FLOW.map((st, i) => (
          <div key={st.title} style={{ display: 'flex', gap: 12, padding: 8, borderRadius: 8, background: mine(st) ? 'rgba(22,119,255,0.08)' : undefined }}>
            <div style={{ width: 28, height: 28, borderRadius: 14, background: mine(st) ? '#1677ff' : '#94a3b8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontWeight: 600 }}>{i + 1}</div>
            <div style={{ flex: 1 }}>
              <div><b>{st.title}</b> <Tag style={{ marginLeft: 4 }}>{st.who}</Tag></div>
              <div style={{ color: '#64748b', fontSize: 13 }}>{st.text}</div>
              <Space wrap size={4} style={{ marginTop: 4 }}>{st.links.map(([label, to]) => <Button key={to + label} size="small" onClick={() => navigate(to)}>{label}</Button>)}</Space>
            </div>
          </div>
        ))}
      </Space>
    </Card>
  );
}

// ---------- Tunggakan ----------
function OverdueTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['utility', 'overdue'], queryFn: () => get<Overdue[]>('/utility/overdue') });
  const rules = useQuery({ queryKey: ['utility', 'rules'], queryFn: () => get<UtilityRules>('/utility/rules') });
  const [act, setAct] = useState<Overdue | null>(null);
  const [af] = Form.useForm<{ reason: string }>();
  const suspend = useAction((v: { id: string; reason: string }) => post(`/utility/connections/${v.id}/suspend`, { reason: v.reason }), { success: 'Sambungan diputus sementara', invalidate: ['utility'], onSuccess: () => setAct(null) });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Denda ${rules.data?.lateFeePct ?? DEFAULT_UTILITY_RULES.lateFeePct}% setelah ${rules.data?.graceDays ?? DEFAULT_UTILITY_RULES.graceDays} hari dari jatuh tempo (sekali per tagihan, ikut di tagihan bulan berikutnya). Usulan putus bila lewat ${rules.data?.suspendAfterDays ?? DEFAULT_UTILITY_RULES.suspendAfterDays} hari.`} />
      <ResponsiveTable<Overdue> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 20 }} scroll={{ x: 800 }} locale={{ emptyText: 'Tidak ada tunggakan melewati jatuh tempo' }}
        columns={[
          { title: 'Sambungan', render: (_: unknown, o: Overdue) => `${o.number} · ${o.customerName}` },
          { title: 'Alamat', dataIndex: 'address', ellipsis: true },
          { title: 'Telepon', dataIndex: 'phone' },
          { title: 'Tagihan', dataIndex: 'bills', align: 'right' as const },
          { title: 'Tunggakan', align: 'right' as const, render: (_: unknown, o: Overdue) => fmtMoney(o.outstanding) },
          { title: 'Terlambat', render: (_: unknown, o: Overdue) => <Tag color={o.daysLate > 30 ? 'red' : 'orange'}>{o.daysLate} hari</Tag> },
          { title: 'Status', render: (_: unknown, o: Overdue) => <Tag color={STATUS_COLOR[o.status]}>{UTILITY_CONNECTION_LABELS[o.status]}</Tag> },
          { render: (_: unknown, o: Overdue) => (o.suggestSuspend && can('POST', '/utility/connections/:id/suspend') ? <Button size="small" danger onClick={() => { af.resetFields(); setAct(o); }}>Putus sementara</Button> : null) },
        ]}
      />
      <Modal title={act ? `Putus sementara — ${act.number}` : ''} open={!!act} onCancel={() => setAct(null)} onOk={() => af.submit()} confirmLoading={suspend.isPending} okText="Putus" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={af} layout="vertical" onFinish={(v) => suspend.mutate({ id: act!.id, reason: v.reason })}>
          <Form.Item name="reason" label="Dasar pemutusan" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input.TextArea rows={3} maxLength={255} placeholder="mis. menunggak 2 tagihan; sudah diingatkan 3x" /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// ---------- Kontrol ----------
function ControlsTab() {
  const { data, isLoading } = useQuery({ queryKey: ['utility', 'controls'], queryFn: () => get<Control[]>('/utility/controls') });
  if (isLoading) return null;
  const any = (data ?? []).some((c) => c.items.length);
  return (
    <>
      {!any && <Alert type="success" showIcon message="Tidak ada temuan saat ini." />}
      {(data ?? []).filter((c) => c.items.length).map((c) => (
        <Card key={c.key} size="small" style={{ marginBottom: 12 }} title={<span><Tag color={SEV[c.severity]}>{c.items.length}</Tag> {c.title}</span>}>
          <Table size="small" rowKey={(r) => JSON.stringify(r)} pagination={{ pageSize: 5 }} dataSource={c.items}
            columns={Object.keys(c.items[0]).map((k) => ({ title: COL[k] ?? k, dataIndex: k, render: (v: unknown) => (Array.isArray(v) ? v.map((f) => READING_FLAG_LABELS[f as ReadingFlag] ?? String(f)).join(', ') : k === 'status' && ZONE_STATUS[String(v)] ? ZONE_STATUS[String(v)].label : k === 'service' ? UTILITY_SERVICE_LABELS[v as UtilityServiceType] ?? String(v) : String(v ?? '-')) }))} />
        </Card>
      ))}
    </>
  );
}

// ---------- Zona & kehilangan ----------
function ZonesTab() {
  const can = useCan();
  const [period, setPeriod] = useState(dayjs().subtract(1, 'month').format('YYYY-MM'));
  const { data, isLoading } = useQuery({ queryKey: ['utility', 'zones', period], queryFn: () => get<{ period: string; warnPct: number; rows: ZoneRow[] }>(`/utility/zones?period=${period}`) });
  const [row, setRow] = useState<ZoneRow | null>(null);
  const [f] = Form.useForm<{ supplied: number; note?: string }>();
  const save = useAction((v: { zone: string; supplied: number; note?: string }) => put('/utility/zones/supply', { zone: v.zone, period, supplied: String(v.supplied), note: v.note }), { success: 'Pasokan tersimpan', invalidate: ['utility'], onSuccess: () => setRow(null) });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Kehilangan = jumlah masuk zona (meter induk/sumber) dikurangi pemakaian pelanggan terverifikasi. Di atas ${data?.warnPct ?? 20}% perlu dicek: kebocoran, sambungan liar, atau meter rusak. Pasokan diisi Admin/Keuangan, pencatat meter orang lain.`} />
      <Space style={{ marginBottom: 12 }}><span>Periode</span><DatePicker picker="month" allowClear={false} value={dayjs(`${period}-01`)} onChange={(d) => d && setPeriod(d.format('YYYY-MM'))} disabledDate={(d) => d.isAfter(dayjs())} /></Space>
      <ResponsiveTable<ZoneRow> rowKey="zone" size="small" loading={isLoading} dataSource={data?.rows} pagination={false} locale={{ emptyText: 'Belum ada zona. Isi zona pada sambungan di tab Sambungan.' }}
        columns={[
          { title: 'Zona', dataIndex: 'zone' },
          { title: 'Sambungan', dataIndex: 'connections', align: 'right' },
          { title: 'Pasokan', align: 'right', render: (_: unknown, r: ZoneRow) => (r.supplied == null ? '-' : `${fmtQty(r.supplied)} ${r.unit ?? ''}`) },
          { title: 'Pemakaian', align: 'right', render: (_: unknown, r: ZoneRow) => `${fmtQty(r.usage)} ${r.unit ?? ''}` },
          { title: 'Kehilangan', align: 'right', render: (_: unknown, r: ZoneRow) => (r.loss == null ? '-' : `${fmtQty(r.loss)} ${r.unit ?? ''} (${r.lossPct ?? 0}%)`) },
          { title: 'Keterangan', render: (_: unknown, r: ZoneRow) => <Space direction="vertical" size={0}><Tag color={ZONE_STATUS[r.status]?.color}>{ZONE_STATUS[r.status]?.label ?? r.status}</Tag>{(r.unverified > 0 || r.missing > 0) && <Typography.Text type="secondary">{r.unverified} belum diverifikasi, {r.missing} belum dicatat</Typography.Text>}{r.mixedUnits && <Typography.Text type="danger">Satuan layanan berbeda dalam satu zona</Typography.Text>}</Space> },
          { render: (_: unknown, r: ZoneRow) => can('PUT', '/utility/zones/supply') && !r.mixedUnits && <Button size="small" onClick={() => { f.setFieldsValue({ supplied: r.supplied ?? undefined, note: r.note ?? undefined }); setRow(r); }}>Isi pasokan</Button> },
        ]}
      />
      <Modal title={row ? `Pasokan ${row.zone} — ${period}` : ''} open={!!row} onCancel={() => setRow(null)} onOk={() => f.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden>
        <Form form={f} layout="vertical" onFinish={(v) => save.mutate({ zone: row!.zone, ...v })}>
          <Form.Item name="supplied" label={`Jumlah masuk zona${row?.unit ? ` (${row.unit})` : ''}`} rules={[{ required: true }]}><InputNumber min={0} style={{ width: 220 }} /></Form.Item>
          <Form.Item name="note" label="Catatan / sumber angka"><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

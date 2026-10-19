import { EnvironmentOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction, useCashAccounts } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { compressImage } from '@/lib/image';
import { fmtDate, fmtMoney } from '@/lib/format';

const KEY = ['utility'];
const thisMonth = () => dayjs().format('YYYY-MM');

/* ---------------------------------------------------------------- Mode petugas lapangan */
interface Stop { id: string; number: string; meterNo: string | null; address: string; customerName: string; lat: string | null; lng: string | null; unit: string; previous: string }

export function FieldTab() {
  const [period, setPeriod] = useState(thisMonth());
  const route = useQuery({ queryKey: [...KEY, 'field-route', period], queryFn: () => get<Stop[]>(`/utility/field/route?period=${period}`) });
  const [stop, setStop] = useState<Stop | null>(null);
  const [photo, setPhoto] = useState<string>();
  const [geo, setGeo] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [geoErr, setGeoErr] = useState(false);
  const [form] = Form.useForm<{ current: number; note?: string }>();
  const save = useAction((v: { current: number; note?: string }) => post('/utility/field/readings', { connectionId: stop!.id, period, current: String(v.current), note: v.note, ...(geo ? { lat: geo.lat, lng: geo.lng } : {}), photo }), {
    success: 'Tercatat — menunggu verifikasi',
    invalidate: KEY,
    onSuccess: () => { setStop(null); setPhoto(undefined); },
  });
  const open = (s: Stop) => {
    setStop(s);
    setPhoto(undefined);
    setGeo(null);
    setGeoErr(false);
    navigator.geolocation?.getCurrentPosition((p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }), () => setGeoErr(true), { enableHighAccuracy: true, timeout: 8000 });
  };
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <span>Periode</span>
        <DatePicker picker="month" allowClear={false} value={dayjs(period + '-01')} onChange={(d) => d && setPeriod(d.format('YYYY-MM'))} disabledDate={(d) => d.isAfter(dayjs(), 'month')} />
        <Typography.Text type="secondary">{route.data?.length ?? 0} sambungan belum dicatat</Typography.Text>
      </Space>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Lokasi dan foto meter ikut tersimpan sebagai bukti. Pencatatan yang jauh dari lokasi pelanggan akan ditandai untuk diperiksa." />
      <ResponsiveTable<Stop>
        rowKey="id"
        size="small"
        loading={route.isLoading}
        dataSource={route.data}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: 'Semua sambungan sudah dicatat untuk periode ini' }}
        columns={[
          { title: 'Pelanggan', render: (_: unknown, s: Stop) => <div>{s.customerName}<div style={{ fontSize: 12, color: '#64748b' }}>{s.number} · meter {s.meterNo ?? '-'}</div></div> },
          { title: 'Alamat', dataIndex: 'address' },
          { title: 'Angka sebelumnya', render: (_: unknown, s: Stop) => `${Number(s.previous)} ${s.unit}` },
          { render: (_: unknown, s: Stop) => <Button type="primary" size="small" onClick={() => open(s)}>Catat</Button> },
        ]}
      />
      <Modal title={stop ? `${stop.customerName} · ${stop.number}` : ''} open={!!stop} onCancel={() => setStop(null)} onOk={() => form.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden>
        {stop && <Typography.Paragraph type="secondary">{stop.address}<br />Angka sebelumnya: <b>{Number(stop.previous)} {stop.unit}</b></Typography.Paragraph>}
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="current" label="Angka meter sekarang" rules={[{ required: true }]}><InputNumber min={0} inputMode="decimal" style={{ width: 220 }} /></Form.Item>
          <Form.Item label="Foto meter (disarankan)">
            <input type="file" accept="image/*" capture="environment" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setPhoto(await compressImage(f)); } catch { setPhoto(undefined); } } }} />
            {photo && <img src={photo} alt="Foto meter" style={{ display: 'block', maxWidth: 200, marginTop: 6 }} />}
          </Form.Item>
          <Form.Item name="note" label="Catatan"><Input maxLength={255} /></Form.Item>
        </Form>
        <Typography.Text type="secondary"><EnvironmentOutlined /> {geo ? `Lokasi terbaca (±${geo.acc} m) dan disimpan.` : geoErr ? 'Lokasi tidak terbaca; tetap bisa disimpan tanpa lokasi.' : 'Membaca lokasi…'}</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>Meter diganti? Gunakan menu Catat meter biasa.</Typography.Paragraph>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- Impor & alat meter */
interface ImportResult { total: number; accepted: number; rejected: number; results: { row: number; connectionNumber: string; ok: boolean; flags?: string[]; error?: string }[] }
interface IngestKey { id: string; name: string; keyPrefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

/** Format baris: nomor_sambungan, periode (YYYY-MM), angka_meter, catatan (opsional); dipisah koma, titik koma, atau tab */
function parseRows(text: string, defaultPeriod: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^nomor|^sambungan|^connection/i.test(l))
    .slice(0, 500)
    .map((l) => {
      const p = l.split(/[;\t,]/).map((x) => x.trim());
      const hasPeriod = /^\d{4}-\d{2}$/.test(p[1] ?? '');
      return hasPeriod ? { connectionNumber: p[0], period: p[1], current: (p[2] ?? '').replace(',', '.'), note: p[3] || undefined } : { connectionNumber: p[0], period: defaultPeriod, current: (p[1] ?? '').replace(',', '.'), note: p[2] || undefined };
    });
}

export function ImportTab() {
  const can = useCan();
  const [period, setPeriod] = useState(thisMonth());
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const rows = parseRows(text, period);
  const run = useAction((r: typeof rows) => post<ImportResult>('/utility/readings/import', { rows: r }), { invalidate: KEY, success: 'Impor diproses', onSuccess: (x) => setResult(x as ImportResult) });
  const keys = useQuery({ queryKey: [...KEY, 'ingest-keys'], queryFn: () => get<IngestKey[]>('/utility/ingest-keys'), enabled: can('POST', '/utility/ingest-keys') });
  const [kf] = Form.useForm<{ name: string }>();
  const [fresh, setFresh] = useState<string | null>(null);
  const create = useAction((v: { name: string }) => post<{ key: string }>('/utility/ingest-keys', v), { invalidate: KEY, onSuccess: (x) => { setFresh((x as { key: string }).key); kf.resetFields(); } });
  const revoke = useAction((id: string) => post(`/utility/ingest-keys/${id}/revoke`), { invalidate: KEY, success: 'Kunci dicabut' });
  return (
    <>
      {can('POST', '/utility/readings/import') && (
        <Card title="Impor angka meter (CSV)" style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary">
            Tempel satu baris per sambungan: <code>nomor_sambungan, angka_meter, catatan</code> atau <code>nomor_sambungan, YYYY-MM, angka_meter</code>. Setiap baris diperiksa aturan yang sama dengan input manual (angka tidak boleh turun, satu periode satu catatan, tanda janggal) dan hasilnya tetap menunggu verifikasi orang lain.
          </Typography.Paragraph>
          <Space wrap style={{ marginBottom: 8 }}>
            <span>Periode bawaan</span>
            <DatePicker picker="month" allowClear={false} value={dayjs(period + '-01')} onChange={(d) => d && setPeriod(d.format('YYYY-MM'))} disabledDate={(d) => d.isAfter(dayjs(), 'month')} />
          </Space>
          <Input.TextArea rows={6} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} placeholder={'SBG/2026/00001, 1250.5\nSBG/2026/00002, 980'} />
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" disabled={!rows.length} loading={run.isPending} onClick={() => run.mutate(rows)}>Proses {rows.length} baris</Button>
            <Typography.Text type="secondary">Maksimal 500 baris</Typography.Text>
          </Space>
          {result && (
            <div style={{ marginTop: 12 }}>
              <Alert type={result.rejected ? 'warning' : 'success'} showIcon message={`${result.accepted} diterima, ${result.rejected} ditolak dari ${result.total} baris`} />
              {result.results.filter((r) => !r.ok).length > 0 && (
                <ResponsiveTable size="small" rowKey="row" pagination={false} style={{ marginTop: 8 }} dataSource={result.results.filter((r) => !r.ok)} columns={[{ title: 'Baris', dataIndex: 'row' }, { title: 'Sambungan', dataIndex: 'connectionNumber' }, { title: 'Alasan', dataIndex: 'error' }]} />
              )}
            </div>
          )}
        </Card>
      )}
      {can('POST', '/utility/ingest-keys') && (
        <Card title="Kunci API alat meter">
          <Typography.Paragraph type="secondary">
            Untuk gateway/alat meter yang mengirim angka otomatis: <code>POST /api/ingest/utility/readings</code> dengan header <code>X-Api-Key</code> dan isi <code>{'{ "rows": [{ "connectionNumber", "period", "current" }] }'}</code>. Kunci hanya bisa mengirim angka (tetap menunggu verifikasi) dan tidak membaca data apa pun.
          </Typography.Paragraph>
          <Form form={kf} layout="inline" onFinish={(v) => create.mutate(v)} style={{ marginBottom: 12 }}>
            <Form.Item name="name" rules={[{ required: true, min: 3 }]}><Input placeholder="Nama alat / gateway" maxLength={80} /></Form.Item>
            <Button htmlType="submit" type="primary" loading={create.isPending}>Buat kunci</Button>
          </Form>
          <ResponsiveTable<IngestKey>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={keys.data}
            locale={{ emptyText: 'Belum ada kunci' }}
            columns={[
              { title: 'Nama', dataIndex: 'name' },
              { title: 'Awalan', dataIndex: 'keyPrefix' },
              { title: 'Terakhir dipakai', render: (_: unknown, k: IngestKey) => (k.lastUsedAt ? fmtDate(k.lastUsedAt) : '-') },
              { title: 'Status', render: (_: unknown, k: IngestKey) => (k.revokedAt ? <Tag>Dicabut</Tag> : <Tag color="green">Aktif</Tag>) },
              { render: (_: unknown, k: IngestKey) => (!k.revokedAt ? <Button size="small" danger onClick={() => revoke.mutate(k.id)}>Cabut</Button> : null) },
            ]}
          />
        </Card>
      )}
      <Modal title="Simpan kunci ini sekarang" open={!!fresh} onCancel={() => setFresh(null)} footer={<Button type="primary" onClick={() => setFresh(null)}>Sudah saya simpan</Button>} destroyOnHidden>
        <Alert type="warning" showIcon message="Kunci tidak bisa ditampilkan lagi." style={{ marginBottom: 8 }} />
        <Typography.Paragraph copyable code>{fresh}</Typography.Paragraph>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- Loket */
interface Hit { invoiceId: string; invoiceNumber: string; connectionNumber: string; customerName: string; address: string; period: string; outstanding: string; dueDate: string }
interface Open { items: { id: string; amount: string; receivedAt: string }[]; expected: string }
interface Rem { id: string; number: string; date: string; collectorId: string; expected: string; counted: string; difference: string; receiptCount: number; status: 'SUBMITTED' | 'CONFIRMED' | 'DISPUTED'; note: string | null; decisionNote: string | null }
interface CounterControls { receiptsWithoutRecord: { number: string; invoiceNumber: string; amount: string }[]; unremittedOverOneDay: { count: number; amount: string }[]; remittancesNotConfirmed: { number: string }[]; remittancesWithDifference: { number: string; difference: string; status: string }[] }
const REM_TAG = { SUBMITTED: { color: 'gold', label: 'Menunggu konfirmasi' }, CONFIRMED: { color: 'green', label: 'Dikonfirmasi' }, DISPUTED: { color: 'red', label: 'Disengketakan' } } as const;

export function CounterTab() {
  const can = useCan();
  const { me } = useAuth();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const hits = useQuery({ queryKey: [...KEY, 'counter-search', term], queryFn: () => get<Hit[]>(`/utility/counter/search?q=${encodeURIComponent(term)}`), enabled: term.trim().length >= 2 && can('POST', '/utility/counter/pay') });
  const open = useQuery({ queryKey: [...KEY, 'counter-open'], queryFn: () => get<Open>('/utility/counter/open'), enabled: can('POST', '/utility/counter/remit') });
  const rems = useQuery({ queryKey: [...KEY, 'counter-rems'], queryFn: () => get<Rem[]>('/utility/counter/remittances') });
  const ctl = useQuery({ queryKey: [...KEY, 'counter-controls'], queryFn: () => get<CounterControls>('/utility/counter/controls'), retry: false });
  const [paying, setPaying] = useState<Hit | null>(null);
  const [pf] = Form.useForm<{ amount: number; method: 'CASH' | 'TRANSFER'; cashAccountId?: string; notes?: string }>();
  const payMethod = Form.useWatch('method', pf);
  const cash = useCashAccounts();
  const banks = (cash.data ?? []).filter((a) => !/^kas\b/i.test(a.name));
  const [remitting, setRemitting] = useState(false);
  const [rf] = Form.useForm<{ counted: number; note?: string }>();
  const [deciding, setDeciding] = useState<{ r: Rem; dispute: boolean } | null>(null);
  const [df] = Form.useForm<{ note?: string; depositAccountId?: string }>();
  const pay = useAction((v: { amount: number; method: 'CASH' | 'TRANSFER'; cashAccountId?: string; notes?: string }) => post('/utility/counter/pay', { invoiceId: paying!.invoiceId, amount: String(v.amount), method: v.method, cashAccountId: v.method === 'TRANSFER' ? v.cashAccountId : undefined, notes: v.notes }), { success: 'Pembayaran diterima', invalidate: KEY, onSuccess: () => setPaying(null) });
  const remit = useAction((v: { counted: number; note?: string }) => post('/utility/counter/remit', { counted: String(v.counted), note: v.note }), { success: 'Setoran dicatat — menunggu konfirmasi', invalidate: KEY, onSuccess: () => setRemitting(false) });
  const decide = useAction((v: { note?: string; depositAccountId?: string }) => post(`/utility/counter/remittances/${deciding!.r.id}/decide`, { note: v.note, dispute: deciding!.dispute, depositAccountId: deciding!.dispute ? undefined : v.depositAccountId }), { success: 'Tersimpan', invalidate: KEY, onSuccess: () => setDeciding(null) });
  const exp = Number(open.data?.expected ?? 0);
  const warn = ctl.data ? ctl.data.receiptsWithoutRecord.length + ctl.data.unremittedOverOneDay.length + ctl.data.remittancesNotConfirmed.length : 0;
  return (
    <>
      {warn > 0 && ctl.data && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Perlu ditindaklanjuti"
          description={<ul style={{ margin: 0, paddingLeft: 18 }}>
            {ctl.data.receiptsWithoutRecord.length > 0 && <li>Pembayaran loket tanpa catatan penerimaan: {ctl.data.receiptsWithoutRecord.map((r) => r.number).join(', ')}</li>}
            {ctl.data.unremittedOverOneDay.length > 0 && <li>Ada penerimaan loket lebih dari sehari yang belum disetor ({ctl.data.unremittedOverOneDay.reduce((a, b) => a + b.count, 0)} transaksi)</li>}
            {ctl.data.remittancesNotConfirmed.length > 0 && <li>Setoran belum dikonfirmasi lebih dari 2 hari: {ctl.data.remittancesNotConfirmed.map((r) => r.number).join(', ')}</li>}
          </ul>} />
      )}
      {can('POST', '/utility/counter/pay') && (
        <Card title="Terima pembayaran" style={{ marginBottom: 16 }}>
          <Input.Search placeholder="Cari nomor sambungan, nama pelanggan, atau nomor faktur" enterButton="Cari" value={q} onChange={(e) => setQ(e.target.value)} onSearch={(v) => setTerm(v)} style={{ maxWidth: 520, marginBottom: 12 }} />
          <ResponsiveTable<Hit>
            rowKey="invoiceId"
            size="small"
            loading={hits.isFetching}
            dataSource={term.trim().length >= 2 ? hits.data : []}
            pagination={false}
            locale={{ emptyText: term ? 'Tidak ada tagihan terbuka yang cocok' : 'Cari pelanggan untuk menerima pembayaran' }}
            columns={[
              { title: 'Pelanggan', render: (_: unknown, h: Hit) => <div>{h.customerName}<div style={{ fontSize: 12, color: '#64748b' }}>{h.connectionNumber} · {h.address}</div></div> },
              { title: 'Faktur', render: (_: unknown, h: Hit) => `${h.invoiceNumber} (${h.period})` },
              { title: 'Jatuh tempo', render: (_: unknown, h: Hit) => fmtDate(h.dueDate) },
              { title: 'Sisa tagihan', render: (_: unknown, h: Hit) => fmtMoney(h.outstanding) },
              { render: (_: unknown, h: Hit) => <Button size="small" type="primary" onClick={() => { setPaying(h); pf.setFieldsValue({ amount: Number(h.outstanding), method: 'CASH', cashAccountId: undefined, notes: undefined }); }}>Terima</Button> },
            ]}
          />
        </Card>
      )}
      {can('POST', '/utility/counter/remit') && (
        <Card title="Setoran saya" style={{ marginBottom: 16 }}>
          <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Penerimaan belum disetor">{open.data?.items.length ?? 0} transaksi</Descriptions.Item>
            <Descriptions.Item label="Seharusnya disetor"><b>{fmtMoney(exp)}</b></Descriptions.Item>
          </Descriptions>
          <Button type="primary" disabled={!open.data?.items.length} onClick={() => { rf.setFieldsValue({ counted: exp, note: undefined }); setRemitting(true); }}>Setor sekarang</Button>
        </Card>
      )}
      <Typography.Title level={5}>Riwayat setoran</Typography.Title>
      <ResponsiveTable<Rem>
        rowKey="id"
        size="small"
        loading={rems.isLoading}
        dataSource={rems.data}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: 'Belum ada setoran' }}
        columns={[
          { title: 'Nomor', render: (_: unknown, r: Rem) => <div>{r.number}<div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(r.date)} · {r.receiptCount} transaksi</div></div> },
          { title: 'Seharusnya', render: (_: unknown, r: Rem) => fmtMoney(r.expected) },
          { title: 'Disetor', render: (_: unknown, r: Rem) => fmtMoney(r.counted) },
          { title: 'Selisih', render: (_: unknown, r: Rem) => (Number(r.difference) === 0 ? '-' : <Tag color="red">{fmtMoney(r.difference)}</Tag>) },
          { title: 'Status', render: (_: unknown, r: Rem) => <div><Tag color={REM_TAG[r.status].color}>{REM_TAG[r.status].label}</Tag>{r.note && <div style={{ fontSize: 12 }}>{r.note}</div>}{r.decisionNote && <div style={{ fontSize: 12, color: '#64748b' }}>{r.decisionNote}</div>}</div> },
          {
            render: (_: unknown, r: Rem) =>
              r.status === 'SUBMITTED' && can('POST', '/utility/counter/remittances/:id/decide') && (r.collectorId !== me?.id || me?.role === 'OWNER') ? (
                <Space wrap>
                  <Button size="small" type="primary" onClick={() => { df.resetFields(); setDeciding({ r, dispute: false }); }}>Konfirmasi</Button>
                  <Button size="small" danger onClick={() => { df.resetFields(); setDeciding({ r, dispute: true }); }}>Sengketakan</Button>
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal title={paying ? `Terima pembayaran — ${paying.customerName}` : ''} open={!!paying} onCancel={() => setPaying(null)} onOk={() => pf.submit()} confirmLoading={pay.isPending} okText="Terima pembayaran" destroyOnHidden>
        {paying && <Typography.Paragraph type="secondary">{paying.invoiceNumber} · sisa {fmtMoney(paying.outstanding)}</Typography.Paragraph>}
        <Form form={pf} layout="vertical" onFinish={(v) => pay.mutate(v)}>
          <Form.Item name="amount" label="Jumlah diterima (Rp)" rules={[{ required: true }]}><InputNumber min={1} style={{ width: 220 }} /></Form.Item>
          <Form.Item name="method" label="Cara bayar" initialValue="CASH"><Select style={{ width: 220 }} options={[{ value: 'CASH', label: 'Tunai (masuk setoran harian)' }, { value: 'TRANSFER', label: 'Transfer / QRIS (langsung ke bank)' }]} /></Form.Item>
          {payMethod === 'TRANSFER' && <Form.Item name="cashAccountId" label="Rekening penerima"><Select allowClear placeholder="Bank utama" options={banks.map((a) => ({ value: a.id, label: a.name }))} /></Form.Item>}
          <Form.Item name="notes" label="Catatan"><Input maxLength={200} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Setor penerimaan loket" open={remitting} onCancel={() => setRemitting(false)} onOk={() => rf.submit()} confirmLoading={remit.isPending} okText="Setor" destroyOnHidden>
        <Typography.Paragraph type="secondary">Hitung uang tunai di tangan, lalu isi jumlahnya. Sistem mengharapkan <b>{fmtMoney(exp)}</b>; bila berbeda, tulis penjelasannya.</Typography.Paragraph>
        <Form form={rf} layout="vertical" onFinish={(v) => remit.mutate(v)}>
          <Form.Item name="counted" label="Uang tunai yang disetor (Rp)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 220 }} /></Form.Item>
          <Form.Item name="note" label="Penjelasan selisih (wajib bila berbeda)"><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={deciding?.dispute ? 'Sengketakan setoran' : 'Konfirmasi setoran'} open={!!deciding} onCancel={() => setDeciding(null)} onOk={() => df.submit()} confirmLoading={decide.isPending} okText="Simpan" destroyOnHidden>
        {deciding && <Typography.Paragraph type="secondary">{deciding.r.number} · selisih {fmtMoney(deciding.r.difference)}</Typography.Paragraph>}
        <Form form={df} layout="vertical" onFinish={(v) => decide.mutate(v)}>
          {!deciding?.dispute && <Form.Item name="depositAccountId" label="Setor ke rekening bank (opsional)" extra="Bila dipilih, sistem menjurnal Kas → Bank sebesar uang yang disetor."><Select allowClear placeholder="Tidak dijurnal" options={banks.map((a) => ({ value: a.id, label: a.name }))} /></Form.Item>}
          <Form.Item name="note" label="Catatan keputusan" rules={deciding && (deciding.dispute || Number(deciding.r.difference) !== 0) ? [{ required: true, min: 5, message: 'Wajib diisi (min. 5 huruf)' }] : []}><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

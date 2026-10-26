import { COUNTER_CHANNELS, COUNTER_CHANNEL_LABELS, type CounterChannel } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction, useCashAccounts } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtMoney } from '@/lib/format';
import { CounterTab } from '../UtilityFieldTabs';

const KEY = ['utility'];

export interface Counter { id: string; code: string; name: string; location: string | null; bankAccountId: string | null; bankName?: string | null; isActive: boolean }
interface Hit { invoiceId: string; invoiceNumber: string; connectionNumber: string; customerName: string; address: string; period: string; outstanding: string; dueDate: string }
interface RecapCell { counterId: string | null; code: string; name: string; count: number; total: string; channels: Record<string, { label: string; count: number; total: string }>; closing: { status: string; note: string | null; decidedAt: string } | null }
interface Recap { from: string; to: string; total: string; count: number; days: { date: string; total: string; count: number; counters: RecapCell[] }[] }
interface DayRow { id: string; time: string; counter: string | null; channelLabel: string; amount: string; invoice: string; customer: string; connection: string | null; collector: string | null; payment: string }
export interface Rules { cashless: boolean }

export const useCounters = () => useQuery({ queryKey: [...KEY, 'counters'], queryFn: () => get<Counter[]>('/utility/counters') });
export const useCashless = () => useQuery({ queryKey: [...KEY, 'rules'], queryFn: () => get<Rules>('/utility/rules') });

const CLOSING: Record<string, { color: string; label: string }> = { CONFIRMED: { color: 'green', label: 'Sudah dicek Keuangan' }, DISPUTED: { color: 'red', label: 'Berselisih' } };

/* ---------------------------------------------------------------- Terima pembayaran di loket */
export function CounterPayTab() {
  const rules = useCashless();
  const counters = useCounters();
  const can = useCan();
  const cash = useCashAccounts();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [paying, setPaying] = useState<Hit | null>(null);
  const [form] = Form.useForm<{ amount: number; counterId?: string; channel: CounterChannel; cashAccountId?: string; notes?: string }>();
  const active = (counters.data ?? []).filter((c) => c.isActive);
  const hits = useQuery({ queryKey: [...KEY, 'counter-search', term], queryFn: () => get<Hit[]>(`/utility/counter/search?q=${encodeURIComponent(term)}`), enabled: term.trim().length >= 2 && can('POST', '/utility/counter/pay') });
  const pay = useAction(
    (v: { amount: number; counterId?: string; channel: CounterChannel; cashAccountId?: string; notes?: string }) =>
      post('/utility/counter/pay', { invoiceId: paying!.invoiceId, amount: String(v.amount), method: 'TRANSFER', channel: v.channel, counterId: v.counterId, cashAccountId: v.cashAccountId, notes: v.notes }),
    { success: 'Pembayaran diterima dan masuk rekap loket', invalidate: KEY, onSuccess: () => setPaying(null) },
  );
  if (rules.isLoading) return null;
  if (!rules.data?.cashless) return <CounterTab />;
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Loket hanya menerima pembayaran non-tunai"
        description="Uang pelanggan langsung masuk rekening perusahaan lewat transfer, QRIS, virtual account, kartu EDC, atau dompet digital. Tidak ada uang tunai yang dipegang kasir dan tidak ada setoran kas. Keuangan mencocokkan rekap harian tiap loket dengan mutasi bank di menu Rekap harian loket." />
      {!active.length && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Belum ada loket" description="Tambahkan loket (lokasi penerimaan) di menu Daftar loket sebelum menerima pembayaran." />}
      <Card title="Terima pembayaran">
        <Input.Search placeholder="Cari nomor sambungan, nama pelanggan, atau nomor faktur" enterButton="Cari" value={q} onChange={(e) => setQ(e.target.value)} onSearch={setTerm} style={{ maxWidth: 520, marginBottom: 12 }} allowClear />
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
            { title: 'Sisa tagihan', align: 'right' as const, render: (_: unknown, h: Hit) => fmtMoney(h.outstanding) },
            { render: (_: unknown, h: Hit) => <Button size="small" type="primary" disabled={!active.length} onClick={() => { setPaying(h); form.setFieldsValue({ amount: Number(h.outstanding), counterId: active.length === 1 ? active[0].id : undefined, channel: 'TRANSFER', cashAccountId: undefined, notes: undefined }); }}>Terima</Button> },
          ]}
        />
      </Card>
      <Modal title={paying ? `Terima pembayaran — ${paying.customerName}` : ''} open={!!paying} onCancel={() => setPaying(null)} onOk={() => form.submit()} confirmLoading={pay.isPending} okText="Terima pembayaran" destroyOnHidden>
        {paying && <Typography.Paragraph type="secondary">{paying.invoiceNumber} · sisa {fmtMoney(paying.outstanding)}</Typography.Paragraph>}
        <Form form={form} layout="vertical" onFinish={(v) => pay.mutate(v)}>
          <Form.Item name="counterId" label="Loket penerima" rules={[{ required: true, message: 'Pilih loket' }]}><Select placeholder="Pilih loket" options={active.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          <Form.Item name="channel" label="Kanal pembayaran" rules={[{ required: true }]}><Select options={COUNTER_CHANNELS.map((c) => ({ value: c, label: COUNTER_CHANNEL_LABELS[c] }))} /></Form.Item>
          <Form.Item name="amount" label="Jumlah diterima (Rp)" rules={[{ required: true }]}><InputNumber min={1} style={{ width: 220 }} /></Form.Item>
          <Form.Item name="cashAccountId" label="Rekening penerima" extra="Kosong = rekening bank milik loket, atau bank utama."><Select allowClear placeholder="Otomatis" options={(cash.data ?? []).filter((a) => !/^kas\b/i.test(a.name)).map((a) => ({ value: a.id, label: a.name }))} /></Form.Item>
          <Form.Item name="notes" label="Catatan / nomor referensi"><Input maxLength={200} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- Rekap harian per loket */
export function CounterRecapTab() {
  const can = useCan();
  const [range, setRange] = useState<[string, string]>([dayjs().subtract(6, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')]);
  const recap = useQuery({ queryKey: [...KEY, 'recap', range], queryFn: () => get<Recap>(`/utility/counter/recap?from=${range[0]}&to=${range[1]}`) });
  const [detail, setDetail] = useState<{ date: string; cell: RecapCell } | null>(null);
  const [deciding, setDeciding] = useState<{ date: string; cell: RecapCell; dispute: boolean } | null>(null);
  const [form] = Form.useForm<{ note?: string }>();
  const rows = useQuery({ queryKey: [...KEY, 'day', detail?.date, detail?.cell.counterId], queryFn: () => get<DayRow[]>(`/utility/counter/day?date=${detail!.date}${detail!.cell.counterId ? `&counterId=${detail!.cell.counterId}` : ''}`), enabled: !!detail });
  const close = useAction((v: { note?: string }) => post('/utility/counter/close-day', { counterId: deciding!.cell.counterId, date: deciding!.date, dispute: deciding!.dispute, note: v.note }), { success: 'Rekap dicatat', invalidate: KEY, onSuccess: () => setDeciding(null) });
  const today = dayjs().format('YYYY-MM-DD');
  const waiting = (recap.data?.days ?? []).flatMap((d) => d.counters.filter((c) => c.counterId && !c.closing && d.date < today)).length;
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Cara membaca"
        description="Setiap baris adalah penerimaan satu loket pada satu hari. Keuangan (yang bukan penerima pembayaran) mencocokkan jumlahnya dengan mutasi bank lalu menekan Konfirmasi; bila tidak cocok pilih Selisih dan tulis alasannya." />
      {waiting > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`${waiting} rekap hari lampau belum dicek Keuangan`} />}
      <Space style={{ marginBottom: 12 }} wrap>
        <span>Tanggal</span>
        <DatePicker.RangePicker allowClear={false} value={[dayjs(range[0]), dayjs(range[1])]} onChange={(v) => v?.[0] && v[1] && setRange([v[0].format('YYYY-MM-DD'), v[1].format('YYYY-MM-DD')])} />
        {recap.data && <Tag color="blue">{recap.data.count} transaksi · {fmtMoney(recap.data.total)}</Tag>}
      </Space>
      {(recap.data?.days ?? []).map((d) => (
        <Card key={d.date} size="small" style={{ marginBottom: 12 }} title={<span>{fmtDate(d.date)} <Tag>{d.count} transaksi</Tag></span>} extra={<b>{fmtMoney(d.total)}</b>}>
          <ResponsiveTable<RecapCell>
            rowKey={(c) => c.counterId ?? 'none'}
            size="small"
            pagination={false}
            dataSource={d.counters}
            columns={[
              { title: 'Loket', render: (_: unknown, c: RecapCell) => `${c.code} · ${c.name}` },
              { title: 'Kanal', render: (_: unknown, c: RecapCell) => Object.values(c.channels).map((x) => <Tag key={x.label}>{x.label}: {x.count}× {fmtMoney(x.total)}</Tag>) },
              { title: 'Transaksi', dataIndex: 'count', align: 'right' as const },
              { title: 'Penerimaan', align: 'right' as const, render: (_: unknown, c: RecapCell) => fmtMoney(c.total) },
              { title: 'Status', render: (_: unknown, c: RecapCell) => (c.closing ? <div><Tag color={CLOSING[c.closing.status]?.color}>{CLOSING[c.closing.status]?.label}</Tag>{c.closing.note && <div style={{ fontSize: 12 }}>{c.closing.note}</div>}</div> : <Tag color="gold">Belum dicek</Tag>) },
              {
                render: (_: unknown, c: RecapCell) => (
                  <Space>
                    <Button size="small" onClick={() => setDetail({ date: d.date, cell: c })}>Rincian</Button>
                    {c.counterId && !c.closing && can('POST', '/utility/counter/close-day') && (
                      <>
                        <Button size="small" type="primary" onClick={() => { form.resetFields(); setDeciding({ date: d.date, cell: c, dispute: false }); }}>Konfirmasi</Button>
                        <Button size="small" danger onClick={() => { form.resetFields(); setDeciding({ date: d.date, cell: c, dispute: true }); }}>Selisih</Button>
                      </>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      ))}
      {recap.data && !recap.data.days.length && <Alert type="success" showIcon message="Belum ada penerimaan loket pada rentang ini." />}
      <Modal title={detail ? `${detail.cell.name} — ${fmtDate(detail.date)}` : ''} open={!!detail} onCancel={() => setDetail(null)} footer={null} width={860} destroyOnHidden>
        <Table<DayRow> rowKey="id" size="small" loading={rows.isLoading} dataSource={rows.data} pagination={{ pageSize: 10 }} scroll={{ x: 640 }}
          columns={[
            { title: 'Jam', dataIndex: 'time' },
            { title: 'Pelanggan', render: (_: unknown, r: DayRow) => <div>{r.customer}<div style={{ fontSize: 12, color: '#64748b' }}>{r.connection ?? r.invoice}</div></div> },
            { title: 'Kanal', dataIndex: 'channelLabel' },
            { title: 'Penerima', dataIndex: 'collector' },
            { title: 'Jumlah', align: 'right' as const, render: (_: unknown, r: DayRow) => fmtMoney(r.amount) },
          ]} />
      </Modal>
      <Modal title={deciding?.dispute ? 'Rekap berselisih dengan bank' : 'Konfirmasi rekap harian'} open={!!deciding} onCancel={() => setDeciding(null)} onOk={() => form.submit()} confirmLoading={close.isPending} okText="Simpan" destroyOnHidden>
        {deciding && <Typography.Paragraph type="secondary">{deciding.cell.name} · {fmtDate(deciding.date)} · {fmtMoney(deciding.cell.total)}</Typography.Paragraph>}
        <Form form={form} layout="vertical" onFinish={(v) => close.mutate(v)}>
          <Form.Item name="note" label={deciding?.dispute ? 'Alasan selisih (wajib)' : 'Catatan (opsional)'} rules={deciding?.dispute ? [{ required: true, min: 5, message: 'Minimal 5 huruf' }] : []}><Input.TextArea rows={3} maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- Daftar loket */
export function CountersAdminTab() {
  const can = useCan();
  const counters = useCounters();
  const cash = useCashAccounts();
  const [editing, setEditing] = useState<Counter | 'new' | null>(null);
  const [form] = Form.useForm<{ code: string; name: string; location?: string; bankAccountId?: string; isActive: boolean }>();
  const save = useAction((v: { code: string; name: string; location?: string; bankAccountId?: string; isActive: boolean }) => (editing && editing !== 'new' ? put(`/utility/counters/${editing.id}`, v) : post('/utility/counters', v)), { success: 'Loket disimpan', invalidate: KEY, onSuccess: () => setEditing(null) });
  const edit = can('POST', '/utility/counters');
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Loket = tempat pelanggan membayar" description="Perusahaan dapat memiliki beberapa loket di lokasi berbeda. Tiap penerimaan dicatat atas nama loketnya sehingga rekap harian bisa dicek per lokasi. Isi rekening bank bila loket memakai rekening sendiri." />
      {edit && <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { form.resetFields(); form.setFieldsValue({ isActive: true }); setEditing('new'); }}>Tambah loket</Button>}
      <ResponsiveTable<Counter>
        rowKey="id"
        size="small"
        loading={counters.isLoading}
        dataSource={counters.data}
        pagination={false}
        locale={{ emptyText: 'Belum ada loket' }}
        columns={[
          { title: 'Kode', dataIndex: 'code' },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Lokasi', dataIndex: 'location' },
          { title: 'Rekening bank', render: (_: unknown, c: Counter) => c.bankName ?? 'Bank utama' },
          { title: 'Status', render: (_: unknown, c: Counter) => (c.isActive ? <Tag color="green">Aktif</Tag> : <Tag>Nonaktif</Tag>) },
          { render: (_: unknown, c: Counter) => edit && <Button size="small" onClick={() => { form.setFieldsValue({ code: c.code, name: c.name, location: c.location ?? undefined, bankAccountId: c.bankAccountId ?? undefined, isActive: c.isActive }); setEditing(c); }}>Ubah</Button> },
        ]}
      />
      <Modal title={editing === 'new' ? 'Tambah loket' : 'Ubah loket'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="code" label="Kode" rules={[{ required: true, min: 2 }]}><Input maxLength={20} placeholder="LKT-01" style={{ width: 200 }} /></Form.Item>
          <Form.Item name="name" label="Nama loket" rules={[{ required: true, min: 3 }]}><Input maxLength={120} placeholder="Loket Kantor Pusat" /></Form.Item>
          <Form.Item name="location" label="Lokasi / alamat"><Input maxLength={255} /></Form.Item>
          <Form.Item name="bankAccountId" label="Rekening bank penerima"><Select allowClear placeholder="Bank utama" options={(cash.data ?? []).filter((a) => !/^kas\b/i.test(a.name)).map((a) => ({ value: a.id, label: a.name }))} /></Form.Item>
          <Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

import { NOTICE_KIND_LABELS, type NoticeKind } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Radio, Space, Switch, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtMoney } from '@/lib/format';
import dayjs from 'dayjs';
import { ConnectionSelect, Stats } from './kit';

// ------------------------------------------------------------------ virtual account
interface VaPay { id: string; reference: string; va_number: string; connection_number: string | null; customer_name: string | null; amount: string; paid_at: string; channel: string | null; status: string; applied: string; unapplied: string; payment_numbers: string[]; message: string | null }
interface VaSummary { received: number; receivedAmount: number; unmatched: number; unmatchedAmount: number; excess: number; excessAmount: number; partial: number }
const VA_STATUS: Record<string, { label: string; color: string }> = { DITERIMA: { label: 'Diterima', color: 'blue' }, DITERAPKAN: { label: 'Sudah melunasi tagihan', color: 'green' }, SEBAGIAN: { label: 'Sebagian gagal', color: 'orange' }, KELEBIHAN: { label: 'Ada kelebihan', color: 'gold' }, TAK_COCOK: { label: 'Nomor tak dikenal', color: 'red' } };

/** Pembayaran virtual account: bank/penyedia memberi tahu pembayaran masuk, sistem melunasi tagihan tertua otomatis; yang janggal ditahan untuk Keuangan */
export function VaTab() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const [fixing, setFixing] = useState<VaPay | null>(null);
  const [conn, setConn] = useState<string>();
  const sum = useQuery({ queryKey: ['utility', 'va', 'summary'], queryFn: () => get<VaSummary>('/utility/va/summary') });
  const list = useQuery({ queryKey: ['utility', 'va', 'list', status], queryFn: () => get<VaPay[]>(`/utility/va/payments${status ? `?status=${status}` : ''}`) });
  const cfg = useQuery({ queryKey: ['utility', 'va', 'settings'], queryFn: () => get<{ prefix: string; bankName: string }>('/utility/va/settings') });
  const [f] = Form.useForm<{ prefix: string; bankName: string }>();
  const saveCfg = useAction((v: { prefix: string; bankName: string }) => put('/utility/va/settings', v), { success: 'Pengaturan VA disimpan', invalidate: ['utility'] });
  const apply = useAction((v: { id: string; connectionId?: string }) => post(`/utility/va/payments/${v.id}/apply`, { connectionId: v.connectionId }), { success: 'Dana diterapkan ke tagihan', invalidate: ['utility', 'invoices'], onSuccess: () => { setFixing(null); setConn(undefined); } });
  const s = sum.data;
  const hook = `${window.location.origin}/api/ingest/utility/va-payments`;
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Cara kerja pembayaran virtual account"
        description={<>Setiap sambungan punya nomor VA tetap (kode perusahaan dari bank + 8 digit). Pelanggan membayar ke nomor itu lewat ATM/mobile banking; bank atau penyedia pembayaran mengirim pemberitahuan ke alamat di bawah dan tagihan tertua langsung lunas (dengan jurnalnya). Pengiriman ulang tidak membayar dua kali. Pembayaran ke nomor tak dikenal atau yang melebihi tagihan ditahan di sini sampai Keuangan memutuskan.</>} />
      <Stats items={[
        { title: 'Pembayaran masuk', value: s?.received ?? 0, hint: s ? fmtMoney(s.receivedAmount) : undefined },
        { title: 'Nomor tak dikenal', value: s?.unmatched ?? 0, warn: (s?.unmatched ?? 0) > 0, hint: s?.unmatched ? fmtMoney(s.unmatchedAmount) : undefined, onClick: () => setStatus('TAK_COCOK') },
        { title: 'Kelebihan bayar', value: s?.excess ?? 0, warn: (s?.excess ?? 0) > 0, hint: s?.excess ? fmtMoney(s.excessAmount) : undefined, onClick: () => setStatus('KELEBIHAN') },
        { title: 'Sebagian gagal', value: s?.partial ?? 0, warn: (s?.partial ?? 0) > 0, onClick: () => setStatus('SEBAGIAN') },
      ]} />
      <Card size="small" title="Sambungkan ke bank / penyedia pembayaran" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>Alamat penerima pemberitahuan: <Typography.Text code copyable>{`POST ${hook}`}</Typography.Text></div>
          <div>Header <Typography.Text code>X-Api-Key</Typography.Text> berisi kunci dari menu <b>Impor & alat meter</b> (kunci yang sama dengan alat meter). Isi: <Typography.Text code>{'{"vaNumber":"880800000012","amount":"132090","reference":"TRX-123","paidAt":"2026-10-26T10:00:00+07:00","channel":"BCA"}'}</Typography.Text></div>
          {can('PUT', '/utility/va/settings') && cfg.data && (
            <Form form={f} layout="inline" initialValues={cfg.data} key={cfg.data.prefix + cfg.data.bankName} onFinish={(v) => saveCfg.mutate(v)}>
              <Form.Item name="prefix" label="Kode perusahaan bank" rules={[{ pattern: /^\d{0,8}$/, message: 'Angka saja' }]}><Input style={{ width: 120 }} /></Form.Item>
              <Form.Item name="bankName" label="Nama bank"><Input style={{ width: 160 }} /></Form.Item>
              <Button htmlType="submit" loading={saveCfg.isPending}>Simpan</Button>
            </Form>
          )}
        </Space>
      </Card>
      <Radio.Group optionType="button" style={{ marginBottom: 12 }} value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Semua' }, ...Object.entries(VA_STATUS).map(([value, v]) => ({ value, label: v.label }))]} />
      <ResponsiveTable<VaPay> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 20 }}
        columns={[
          { title: 'Waktu', render: (_: unknown, p: VaPay) => dayjs(p.paid_at).format('DD MMM HH:mm') }, { title: 'Referensi', dataIndex: 'reference' },
          { title: 'Nomor VA', dataIndex: 'va_number' }, { title: 'Sambungan', render: (_: unknown, p: VaPay) => (p.connection_number ? <>{p.connection_number}<div style={{ fontSize: 12, color: '#64748b' }}>{p.customer_name}</div></> : '-') },
          { title: 'Jumlah', align: 'right' as const, render: (_: unknown, p: VaPay) => fmtMoney(p.amount) },
          { title: 'Status', render: (_: unknown, p: VaPay) => <><Tag color={VA_STATUS[p.status]?.color}>{VA_STATUS[p.status]?.label ?? p.status}</Tag>{Number(p.unapplied) > 0 && <div style={{ fontSize: 12 }}>Belum teralokasi {fmtMoney(p.unapplied)}</div>}{p.message && <div style={{ fontSize: 12, color: '#64748b' }}>{p.message}</div>}</> },
          { render: (_: unknown, p: VaPay) => Number(p.unapplied) > 0 && can('POST', '/utility/va/payments/:id/apply') ? <Button size="small" type="primary" onClick={() => { setConn(undefined); setFixing(p); }}>{p.connection_number ? 'Terapkan lagi' : 'Cocokkan'}</Button> : null },
        ]} />
      <Modal open={!!fixing} title={fixing?.connection_number ? 'Terapkan dana ke tagihan' : 'Cocokkan ke sambungan'} okText="Terapkan" cancelText="Batal" okButtonProps={{ disabled: !fixing?.connection_number && !conn, loading: apply.isPending }} onCancel={() => setFixing(null)} onOk={() => fixing && apply.mutate({ id: fixing.id, connectionId: conn })}>
        {fixing && <Typography.Paragraph>Dana {fmtMoney(fixing.unapplied)} (referensi {fixing.reference}) akan melunasi tagihan air tertua sambungan{fixing.connection_number ? ` ${fixing.connection_number}` : ''}. Sisa yang melebihi tagihan tetap ditahan.</Typography.Paragraph>}
        {!fixing?.connection_number && <ConnectionSelect value={conn} onChange={setConn} />}
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ antrean pesan
interface OutRow { id: string; kind: NoticeKind; channel: string; to_address: string; message: string; status: string; attempts: number; last_error: string | null; sent_at: string | null; created_at: string; customer: string; connection: string }
const OUT_STATUS: Record<string, { label: string; color: string }> = { ANTRE: { label: 'Menunggu', color: 'gold' }, MENGIRIM: { label: 'Dikirim…', color: 'blue' }, TERKIRIM: { label: 'Terkirim', color: 'green' }, GAGAL: { label: 'Gagal', color: 'red' }, BATAL: { label: 'Dibatalkan', color: 'default' } };

/** Antrean pesan otomatis: tagihan dan surat peringatan dikirim ke penyedia WhatsApp/SMS perusahaan di server, dengan percobaan ulang */
export function OutboxTab() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const [testTo, setTestTo] = useState('');
  const cfg = useQuery({ queryKey: ['utility', 'outbox', 'config'], queryFn: () => get<{ enabled: boolean; url: string; authHeader: string; hasToken: boolean; bodyTemplate: string }>('/utility/outbox/config') });
  const sum = useQuery({ queryKey: ['utility', 'outbox', 'summary'], queryFn: () => get<Record<string, number>>('/utility/outbox/summary'), refetchInterval: 10_000 });
  const list = useQuery({ queryKey: ['utility', 'outbox', 'list', status], queryFn: () => get<OutRow[]>(`/utility/outbox${status ? `?status=${status}` : ''}`), refetchInterval: 10_000 });
  const [f] = Form.useForm();
  const save = useAction((v: Record<string, unknown>) => put('/utility/outbox/config', v), { success: 'Pengaturan penyedia disimpan', invalidate: ['utility'] });
  const test = useAction(() => post('/utility/outbox/test', { to: testTo }), { success: 'Pesan uji terkirim ke penyedia' });
  const run = useAction(() => post<{ sent: number; failed: number }>('/utility/outbox/process', {}), { success: (r) => `${r.sent} terkirim, ${r.failed} gagal`, invalidate: ['utility'] });
  const retry = useAction((id: string) => post(`/utility/outbox/${id}/retry`, {}), { success: 'Dicoba lagi', invalidate: ['utility'] });
  const cancel = useAction((id: string) => post(`/utility/outbox/${id}/cancel`, {}), { success: 'Dibatalkan', invalidate: ['utility'] });
  const c = cfg.data;
  const s = sum.data ?? {};
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Pengiriman pesan otomatis" description="Isi alamat penyedia pesan (WhatsApp/SMS gateway) milik perusahaan. Dari menu Cetak & kirim, pilih Antrekan: pesan dikirim di server satu per satu, gagal dicoba ulang sampai 3 kali, dan yang terkirim tercatat di riwayat. Pelanggan yang sudah menerima jenis surat yang sama hari ini dilewati." />
      <Stats items={[
        { title: 'Menunggu', value: (s.ANTRE ?? 0) + (s.MENGIRIM ?? 0), onClick: () => setStatus('ANTRE') },
        { title: 'Terkirim', value: s.TERKIRIM ?? 0, ok: true, onClick: () => setStatus('TERKIRIM') },
        { title: 'Gagal', value: s.GAGAL ?? 0, warn: (s.GAGAL ?? 0) > 0, onClick: () => setStatus('GAGAL') },
      ]} />
      {can('PUT', '/utility/outbox/config') && c && (
        <Card size="small" title="Pengaturan penyedia pesan" style={{ marginBottom: 12 }}>
          <Form form={f} layout="vertical" key={`${c.url}${c.enabled}`} initialValues={{ enabled: c.enabled, url: c.url, authHeader: c.authHeader, bodyTemplate: c.bodyTemplate, token: c.hasToken ? '••••••••' : '' }} onFinish={(v) => save.mutate(v)}>
            <Space wrap align="start">
              <Form.Item name="enabled" label="Aktif" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name="url" label="Alamat penyedia (https)" style={{ minWidth: 360 }}><Input placeholder="https://api.penyedia.example/send" /></Form.Item>
              <Form.Item name="authHeader" label="Nama header kunci"><Input style={{ width: 140 }} /></Form.Item>
              <Form.Item name="token" label="Kunci / token" extra="Kosongkan untuk tidak mengubah"><Input.Password style={{ width: 220 }} /></Form.Item>
            </Space>
            <Form.Item name="bodyTemplate" label="Badan permintaan (JSON; {to} nomor tujuan, {message} isi pesan)"><Input.TextArea rows={2} /></Form.Item>
            <Space wrap>
              <Button type="primary" htmlType="submit" loading={save.isPending}>Simpan pengaturan</Button>
              <Input placeholder="Nomor uji, mis. 0812…" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ width: 180 }} />
              <Button disabled={!testTo || !c.enabled} loading={test.isPending} onClick={() => test.mutate(undefined)}>Kirim pesan uji</Button>
            </Space>
          </Form>
        </Card>
      )}
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Semua' }, ...Object.entries(OUT_STATUS).map(([value, v]) => ({ value, label: v.label }))]} />
        {can('POST', '/utility/outbox/process') && <Button loading={run.isPending} onClick={() => run.mutate(undefined)}>Kirim sekarang</Button>}
      </Space>
      <ResponsiveTable<OutRow> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 20 }}
        columns={[
          { title: 'Dibuat', render: (_: unknown, r: OutRow) => dayjs(r.created_at).format('DD MMM HH:mm') },
          { title: 'Pelanggan', render: (_: unknown, r: OutRow) => <>{r.customer}<div style={{ fontSize: 12, color: '#64748b' }}>{r.connection} · {r.to_address}</div></> },
          { title: 'Jenis', render: (_: unknown, r: OutRow) => NOTICE_KIND_LABELS[r.kind] },
          { title: 'Status', render: (_: unknown, r: OutRow) => <><Tag color={OUT_STATUS[r.status]?.color}>{OUT_STATUS[r.status]?.label ?? r.status}</Tag>{r.attempts > 0 && r.status !== 'TERKIRIM' && <span style={{ fontSize: 12 }}> percobaan {r.attempts}</span>}{r.last_error && <div style={{ fontSize: 12, color: '#dc2626' }}>{r.last_error}</div>}{r.sent_at && <div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(r.sent_at)}</div>}</> },
          { render: (_: unknown, r: OutRow) => <Space>{['GAGAL', 'BATAL'].includes(r.status) && can('POST', '/utility/outbox/:id/retry') && <Button size="small" onClick={() => retry.mutate(r.id)}>Coba lagi</Button>}{['ANTRE', 'GAGAL'].includes(r.status) && <Button size="small" danger onClick={() => cancel.mutate(r.id)}>Batalkan</Button>}</Space> },
        ]} />
    </>
  );
}

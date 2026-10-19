import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Row, Space, Statistic, Switch, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

const KEY = ['loyalty'];
interface Cfg { enabled: boolean; earnPerRp: number; pointValueRp: number; minRedeemPoints: number; maxRedeemPct: number; expiryMonths: number }
interface Summary {
  settings: Cfg; pointsOutstanding: number; members: number; ledgerLiability: string; glLiability: string; difference: string;
  dueForExpiry: { lots: number; points: number }; expiringIn30Days: number;
  negativeBalances: { id: string; name: string; balance: number }[];
  recentAdjustments: { customer: string; points: number; note: string; createdAt: string }[];
}
interface Hit { id: string; code: string; name: string; phone: string | null; balance: number }
interface Member { customer: { id: string; code: string; name: string }; balance: number; expiredPending: number; valueRp: number; expiring: { expires_on: string; remaining: number }[]; history: { kind: string; points: number; value: string; note: string | null; createdAt: string }[] }
const KIND: Record<string, string> = { EARN: 'Diperoleh', REDEEM: 'Ditukar', EXPIRE: 'Kedaluwarsa', ADJUST: 'Penyesuaian', REVERSE: 'Dibalik (retur)', REFUND: 'Dikembalikan (retur)' };

export default function LoyaltyPage() {
  const can = useCan();
  const summary = useQuery({ queryKey: [...KEY, 'summary'], queryFn: () => get<Summary>('/loyalty/summary'), retry: false });
  return (
    <>
      <PageHeader title="Program loyalitas" />
      <Tabs
        destroyOnHidden
        items={[
          ...(summary.data ? [{ key: 'ringkasan', label: 'Ringkasan & kontrol', children: <Overview s={summary.data} canExpire={can('POST', '/loyalty/expire')} /> }] : []),
          { key: 'member', label: 'Member', children: <Members canAdjust={can('POST', '/loyalty/adjust')} /> },
          { key: 'pengaturan', label: 'Pengaturan', children: <Settings canEdit={can('PUT', '/loyalty/settings')} /> },
        ]}
      />
    </>
  );
}

function Overview({ s, canExpire }: { s: Summary; canExpire: boolean }) {
  const expire = useAction(() => post<{ points: number; value: string }>('/loyalty/expire'), { invalidate: KEY, success: 'Poin kedaluwarsa diproses' });
  const mismatch = Number(s.difference) !== 0;
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {!s.settings.enabled && <Alert type="info" showIcon message="Program loyalitas belum diaktifkan. Atur di tab Pengaturan." />}
      {mismatch && <Alert type="error" showIcon message={`Kewajiban poin di buku poin (${fmtMoney(s.ledgerLiability)}) berbeda dari akun Utang Poin di akuntansi (${fmtMoney(s.glLiability)}); selisih ${fmtMoney(s.difference)}. Periksa jurnal manual pada akun tersebut.`} />}
      {s.dueForExpiry.points > 0 && (
        <Alert type="warning" showIcon message={`${s.dueForExpiry.points} poin sudah lewat tanggal kedaluwarsa dan belum diproses`}
          action={canExpire && <Button size="small" type="primary" loading={expire.isPending} onClick={() => expire.mutate(undefined)}>Proses kedaluwarsa</Button>} />
      )}
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card><Statistic title="Member berpoin" value={s.members} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Poin beredar" value={s.pointsOutstanding} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Kewajiban poin" value={fmtMoney(s.ledgerLiability)} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Kedaluwarsa 30 hari" value={s.expiringIn30Days} suffix="poin" /></Card></Col>
      </Row>
      {s.negativeBalances.length > 0 && (
        <Alert type="warning" showIcon message="Saldo poin negatif (poin sudah terpakai sebelum transaksi diretur)" description={s.negativeBalances.map((n) => `${n.name} (${n.balance})`).join(', ')} />
      )}
      <Typography.Title level={5}>Penyesuaian manual 30 hari terakhir</Typography.Title>
      <ResponsiveTable size="small" rowKey={(r: Summary['recentAdjustments'][number]) => `${r.customer}-${r.createdAt}`} pagination={false} dataSource={s.recentAdjustments} locale={{ emptyText: 'Tidak ada penyesuaian manual' }}
        columns={[{ title: 'Pelanggan', dataIndex: 'customer' }, { title: 'Poin', dataIndex: 'points' }, { title: 'Alasan', dataIndex: 'note' }, { title: 'Tanggal', render: (_: unknown, r: Summary['recentAdjustments'][number]) => fmtDate(r.createdAt) }]} />
    </Space>
  );
}

function Members({ canAdjust }: { canAdjust: boolean }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const hits = useQuery({ queryKey: [...KEY, 'lookup', q], queryFn: () => get<Hit[]>(`/loyalty/lookup?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });
  const member = useQuery({ queryKey: [...KEY, 'member', sel], queryFn: () => get<Member>(`/loyalty/members/${sel}`), enabled: !!sel });
  const [adj, setAdj] = useState(false);
  const [af] = Form.useForm<{ points: number; reason: string }>();
  const adjust = useAction((v: { points: number; reason: string }) => post('/loyalty/adjust', { customerId: sel, ...v }), { invalidate: KEY, success: 'Poin disesuaikan', onSuccess: () => setAdj(false) });
  const m = member.data;
  return (
    <>
      <Input.Search placeholder="Cari nama, kode, atau telepon pelanggan" allowClear onSearch={setQ} style={{ maxWidth: 420, marginBottom: 12 }} enterButton="Cari" />
      <ResponsiveTable<Hit> size="small" rowKey="id" pagination={false} dataSource={q.trim().length >= 2 ? hits.data : []} loading={hits.isFetching} locale={{ emptyText: q ? 'Tidak ada pelanggan yang cocok' : 'Cari pelanggan untuk melihat poinnya' }}
        columns={[{ title: 'Pelanggan', render: (_: unknown, h: Hit) => `${h.code} · ${h.name}` }, { title: 'Telepon', dataIndex: 'phone' }, { title: 'Poin', dataIndex: 'balance' }, { render: (_: unknown, h: Hit) => <Button size="small" onClick={() => setSel(h.id)}>Lihat</Button> }]} />
      {m && (
        <Card style={{ marginTop: 16 }} title={`${m.customer.code} · ${m.customer.name}`} extra={canAdjust && <Button onClick={() => { af.resetFields(); setAdj(true); }}>Sesuaikan poin</Button>}>
          <Descriptions size="small" column={{ xs: 1, sm: 3 }}>
            <Descriptions.Item label="Poin tersedia"><b>{m.balance}</b></Descriptions.Item>
            <Descriptions.Item label="Nilai">{fmtMoney(m.valueRp)}</Descriptions.Item>
            <Descriptions.Item label="Segera kedaluwarsa">{m.expiring[0] ? `${m.expiring[0].remaining} poin pada ${fmtDate(m.expiring[0].expires_on)}` : '-'}</Descriptions.Item>
          </Descriptions>
          {m.expiredPending > 0 && <Alert type="info" showIcon style={{ marginBottom: 8 }} message={`${m.expiredPending} poin sudah lewat masa berlaku (menunggu diproses)`} />}
          <ResponsiveTable size="small" rowKey={(r: Member['history'][number]) => `${r.createdAt}-${r.kind}-${r.points}`} pagination={{ pageSize: 10 }} dataSource={m.history}
            columns={[{ title: 'Tanggal', render: (_: unknown, r: Member['history'][number]) => fmtDate(r.createdAt) }, { title: 'Jenis', render: (_: unknown, r: Member['history'][number]) => <Tag>{KIND[r.kind] ?? r.kind}</Tag> }, { title: 'Poin', render: (_: unknown, r: Member['history'][number]) => <b style={{ color: r.points < 0 ? '#cf1322' : '#389e0d' }}>{r.points > 0 ? `+${r.points}` : r.points}</b> }, { title: 'Catatan', dataIndex: 'note' }]} />
        </Card>
      )}
      <Modal title="Sesuaikan poin" open={adj} onCancel={() => setAdj(false)} onOk={() => af.submit()} confirmLoading={adjust.isPending} okText="Simpan" destroyOnHidden>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Tercatat di jejak audit dan dijurnal ke akun Utang Poin." />
        <Form form={af} layout="vertical" onFinish={(v) => adjust.mutate(v)}>
          <Form.Item name="points" label="Perubahan poin (negatif = kurangi)" rules={[{ required: true }]}><InputNumber precision={0} style={{ width: 200 }} /></Form.Item>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function Settings({ canEdit }: { canEdit: boolean }) {
  const cfg = useQuery({ queryKey: [...KEY, 'settings'], queryFn: () => get<Cfg>('/loyalty/settings') });
  const save = useAction((v: Cfg) => put<Cfg>('/loyalty/settings', v), { invalidate: [...KEY, 'loyalty-settings'], success: 'Pengaturan disimpan' });
  if (!cfg.data) return null;
  return (
    <Card>
      <Form layout="vertical" initialValues={cfg.data} onFinish={(v) => save.mutate(v)} disabled={!canEdit} style={{ maxWidth: 460 }}>
        <Form.Item name="enabled" label="Program aktif" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="earnPerRp" label="Belanja per 1 poin (Rp)" extra="Dihitung dari jumlah yang dibayar nyata (setelah potongan poin)" rules={[{ required: true }]}><InputNumber min={1000} style={{ width: 200 }} /></Form.Item>
        <Form.Item name="pointValueRp" label="Nilai 1 poin saat ditukar (Rp)" rules={[{ required: true }]}><InputNumber min={1} style={{ width: 200 }} /></Form.Item>
        <Form.Item name="minRedeemPoints" label="Minimum poin sekali tukar" rules={[{ required: true }]}><InputNumber min={1} style={{ width: 200 }} /></Form.Item>
        <Form.Item name="maxRedeemPct" label="Maksimum potongan dari total belanja (%)" rules={[{ required: true }]}><InputNumber min={1} max={100} style={{ width: 200 }} /></Form.Item>
        <Form.Item name="expiryMonths" label="Masa berlaku poin (bulan, 0 = tanpa batas)" rules={[{ required: true }]}><InputNumber min={0} max={60} style={{ width: 200 }} /></Form.Item>
        {canEdit && <Button type="primary" htmlType="submit" loading={save.isPending}>Simpan</Button>}
        {!canEdit && <Typography.Text type="secondary">Hanya Admin/Pemilik yang dapat mengubah.</Typography.Text>}
      </Form>
    </Card>
  );
}

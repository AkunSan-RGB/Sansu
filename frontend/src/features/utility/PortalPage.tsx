import { COMPLAINT_CATEGORIES, COMPLAINT_CATEGORY_LABELS, COMPLAINT_STATUS_LABELS, type ComplaintCategory, type ComplaintStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, Progress, Result, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';

interface View {
  connection: { number: string; address: string; status: string; customer: string; tariff: string; meterNo: string | null; zone: string | null };
  company: { name: string; address: string | null };
  outstanding: number;
  bills: { period: string; invoice: string; total: string; outstanding: string; due_date: string; usage: string | null }[];
  usage: { period: string; usage: string | null; total: string; paid: boolean }[];
  counters: { name: string; location: string | null }[];
  va?: { number: string; bankName: string } | null;
  complaints: { number: string; category: ComplaintCategory; status: ComplaintStatus; created_at: string; resolution: string | null }[];
}
const STATUS: Record<string, string> = { ACTIVE: 'Aktif', SUSPENDED: 'Disegel sementara', DISCONNECTED: 'Diputus' };

/** Halaman pelanggan tanpa login: dibuka lewat tautan pribadi dari PAM. Hanya menampilkan data satu sambungan. */
export default function PortalPage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['portal', token], queryFn: () => get<View>(`/portal/utility/${token}`), retry: false });
  const [f] = Form.useForm();
  const send = useAction((v: Record<string, unknown>) => post<{ number: string }>(`/portal/utility/${token}/complaints`, v), { success: (r) => `Pengaduan ${r.number} terkirim. Petugas kami akan menindaklanjuti.`, invalidate: ['portal'], onSuccess: () => f.resetFields() });
  if (q.isLoading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>;
  if (q.isError || !q.data) return <Result status="404" title="Tautan tidak berlaku" subTitle="Tautan ini salah atau sudah dicabut. Mintalah tautan baru kepada petugas PAM." />;
  const v = q.data;
  const maxUse = Math.max(1, ...v.usage.map((u) => Number(u.usage ?? 0)));
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px 16px 48px' }}>
      <Typography.Title level={3} style={{ marginBottom: 0 }}>{v.company.name}</Typography.Title>
      <Typography.Text type="secondary">Layanan pelanggan air bersih{v.company.address ? ` · ${v.company.address}` : ''}</Typography.Text>
      <Card size="small" style={{ marginTop: 16 }}>
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="Pelanggan">{v.connection.customer}</Descriptions.Item>
          <Descriptions.Item label="Nomor sambungan">{v.connection.number}</Descriptions.Item>
          <Descriptions.Item label="Alamat">{v.connection.address}</Descriptions.Item>
          <Descriptions.Item label="Golongan">{v.connection.tariff}</Descriptions.Item>
          <Descriptions.Item label="Status"><Tag color={v.connection.status === 'ACTIVE' ? 'green' : 'orange'}>{STATUS[v.connection.status] ?? v.connection.status}</Tag></Descriptions.Item>
        </Descriptions>
      </Card>
      {v.outstanding > 0.5 ? <Alert style={{ marginTop: 16 }} type="warning" showIcon message={`Tagihan yang belum dibayar: ${fmtMoney(v.outstanding)}`} description={v.counters.length ? `Bayar di: ${v.counters.map((c) => c.name + (c.location ? ` (${c.location})` : '')).join(', ')}. Sebutkan nomor sambungan ${v.connection.number}.` : 'Bayar di loket PAM dengan menyebutkan nomor sambungan.'} /> : <Alert style={{ marginTop: 16 }} type="success" showIcon message="Tidak ada tagihan yang tertunggak. Terima kasih!" />}
      {v.va && <Alert style={{ marginTop: 16 }} type="info" showIcon message={`Nomor virtual account Anda: ${v.va.number}`} description={`Bayar lewat ATM, mobile banking, atau internet banking${v.va.bankName ? ` ${v.va.bankName}` : ''} ke nomor ini; tagihan lunas otomatis.`} />}
      {v.bills.length > 0 && <Card size="small" title="Tagihan terbuka" style={{ marginTop: 16 }}><Table size="small" rowKey="invoice" pagination={false} scroll={{ x: 'max-content' }} dataSource={v.bills} columns={[
        { title: 'Periode', dataIndex: 'period' }, { title: 'Pemakaian', render: (_: unknown, b: View['bills'][number]) => (b.usage ? `${fmtQty(b.usage)} m³` : '-') },
        { title: 'Sisa', align: 'right' as const, render: (_: unknown, b: View['bills'][number]) => fmtMoney(b.outstanding) }, { title: 'Jatuh tempo', render: (_: unknown, b: View['bills'][number]) => <span style={dayjs(b.due_date).isBefore(dayjs(), 'day') ? { color: '#dc2626' } : undefined}>{fmtDate(b.due_date)}</span> },
      ]} /></Card>}
      <Card size="small" title="Pemakaian 12 bulan terakhir" style={{ marginTop: 16 }}>
        {v.usage.length === 0 ? <Typography.Text type="secondary">Belum ada tagihan.</Typography.Text> : (
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            {[...v.usage].reverse().map((u) => (
              <div key={u.period} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 64, fontSize: 12 }}>{u.period}</span>
                <Progress style={{ flex: 1, margin: 0 }} size="small" percent={Math.round((Number(u.usage ?? 0) / maxUse) * 100)} showInfo={false} strokeColor={u.paid ? '#16a34a' : '#f59e0b'} />
                <span style={{ width: 120, textAlign: 'right', fontSize: 12 }}>{u.usage ? `${fmtQty(u.usage)} m³` : '-'} · {fmtMoney(u.total)}</span>
              </div>
            ))}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Hijau = lunas, kuning = belum lunas.</Typography.Text>
          </Space>
        )}
      </Card>
      <Card size="small" title="Laporkan gangguan atau pertanyaan tagihan" style={{ marginTop: 16 }}>
        <Form form={f} layout="vertical" onFinish={(x) => send.mutate(x)}>
          <Form.Item name="category" label="Jenis" rules={[{ required: true, message: 'Pilih jenis pengaduan' }]}><Select options={COMPLAINT_CATEGORIES.filter((c) => c !== 'SAMBUNGAN_ILEGAL').map((c) => ({ value: c, label: COMPLAINT_CATEGORY_LABELS[c] }))} /></Form.Item>
          <Form.Item name="description" label="Ceritakan masalahnya" rules={[{ required: true, min: 5, message: 'Tulis sedikitnya 5 huruf' }]}><Input.TextArea rows={3} maxLength={1000} showCount /></Form.Item>
          <Form.Item name="phone" label="Nomor HP yang bisa dihubungi"><Input /></Form.Item>
          <Button type="primary" htmlType="submit" loading={send.isPending} block>Kirim pengaduan</Button>
        </Form>
        {v.complaints.length > 0 && <Table style={{ marginTop: 16 }} size="small" rowKey="number" pagination={false} dataSource={v.complaints} columns={[
          { title: 'Nomor', dataIndex: 'number' }, { title: 'Jenis', render: (_: unknown, c: View['complaints'][number]) => COMPLAINT_CATEGORY_LABELS[c.category] },
          { title: 'Status', render: (_: unknown, c: View['complaints'][number]) => <Tag color={c.status === 'SELESAI' || c.status === 'DITUTUP' ? 'green' : 'blue'}>{COMPLAINT_STATUS_LABELS[c.status]}</Tag> },
        ]} />}
      </Card>
    </div>
  );
}

import { DeleteOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, DatePicker, Drawer, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { del, get, post } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

const KEY = ['site-contracts'];
interface Post { id: string; name: string; headcount: number; monthlyRate: string }
interface Row { id: string; customerName: string; siteName: string; title: string; startDate: string; endDate: string | null; isActive: boolean; posts: Post[]; monthlyTotal: string; billedPeriods: { period: string; invoice: string; shortfall: string }[]; unbilledPeriods: string[] }
interface Coverage { posts: { postId: string; name: string; headcount: number; shortfallHeadDays: number; days: { date: string; assigned: number; required: number }[]; duty: { id: string; employeeName: string; date: string }[] }[] }

/** Kontrak per lokasi (kebersihan/keamanan/alih daya): pos dengan jumlah petugas, jadwal jaga, tagihan bulanan */
export default function SiteContractsPage() {
  const can = useCan();
  const rows = useQuery({ queryKey: KEY, queryFn: () => get<Row[]>('/services/sites') });
  const customers = useCustomers();
  const [creating, setCreating] = useState(false);
  const [deduct, setDeduct] = useState(false);
  const [roster, setRoster] = useState<Row | null>(null);
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [cf] = Form.useForm<{ customerId: string; siteName: string; title: string; startDate: dayjs.Dayjs; posts: { name: string; headcount: number; monthlyRate: number }[] }>();
  const [rf] = Form.useForm<{ postId: string; employeeId: string; range: [dayjs.Dayjs, dayjs.Dayjs] }>();
  // pemilih petugas: hanya id, kode, dan nama (peran operasional tidak perlu membuka data SDM)
  const emps = useQuery({ queryKey: [...KEY, 'staff'], queryFn: () => get<{ id: string; code: string; name: string }[]>('/services/sites/staff'), enabled: !!roster });
  const first = `${month}-01`;
  const last = dayjs(first).endOf('month').format('YYYY-MM-DD');
  const cov = useQuery({ queryKey: [...KEY, 'coverage', roster?.id, month], queryFn: () => get<Coverage>(`/services/sites/${roster!.id}/coverage?from=${first}&to=${last}`), enabled: !!roster });
  const create = useAction((v: { customerId: string; siteName: string; title: string; startDate: dayjs.Dayjs; posts: { name: string; headcount: number; monthlyRate: number }[] }) => post('/services/sites', { ...v, startDate: v.startDate.format('YYYY-MM-DD'), posts: v.posts.map((p) => ({ ...p, monthlyRate: String(p.monthlyRate) })) }), { invalidate: KEY, success: 'Kontrak lokasi dibuat', onSuccess: () => setCreating(false) });
  const bill = useAction((v: { id: string; period: string }) => post(`/services/sites/${v.id}/bill`, { period: v.period, deductShortfall: deduct }), { invalidate: [...KEY, 'invoices'], success: 'Faktur kontrak dibuat' });
  const assign = useAction((v: { postId: string; employeeId: string; range: [dayjs.Dayjs, dayjs.Dayjs] }) => post(`/services/sites/${roster!.id}/roster`, { postId: v.postId, employeeId: v.employeeId, from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD') }), { invalidate: KEY, success: 'Petugas dijadwalkan' });
  const unassign = useAction((dutyId: string) => del(`/services/sites/${roster!.id}/roster/${dutyId}`), { invalidate: KEY, success: 'Jadwal dihapus' });
  const missed = (rows.data ?? []).filter((r) => r.isActive).reduce((a, r) => a + r.unbilledPeriods.length, 0);
  return (
    <>
      <PageHeader title="Kontrak lokasi" extra={can('POST', '/services/sites') && <Button type="primary" onClick={() => { cf.resetFields(); setCreating(true); }}>Kontrak baru</Button>} />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Untuk jasa kebersihan, keamanan, dan alih daya per lokasi" description="Tiap kontrak punya pos (mis. satpam shift malam, 2 orang). Tagihan bulanan = jumlah petugas × tarif per pos. Jadwal jaga mencatat siapa bertugas tiap hari; bila ada hari kurang petugas, tagihan dapat dipotong proporsional." />
      {missed > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`${missed} periode kontrak belum ditagih`} />}
      <Checkbox checked={deduct} onChange={(e) => setDeduct(e.target.checked)} style={{ marginBottom: 8 }}>Potong tagihan sebesar kekurangan petugas menurut jadwal jaga</Checkbox>
      <Table<Row> size="small" rowKey="id" loading={rows.isLoading} dataSource={rows.data} pagination={false} locale={{ emptyText: 'Belum ada kontrak lokasi' }} scroll={{ x: 900 }}
        columns={[
          { title: 'Lokasi', render: (_: unknown, r: Row) => <div>{r.siteName}<div style={{ fontSize: 12, color: '#64748b' }}>{r.customerName} · {r.title}</div></div> },
          { title: 'Pos', render: (_: unknown, r: Row) => r.posts.map((p) => <div key={p.id}>{p.name}: {p.headcount} × {fmtMoney(p.monthlyRate)}</div>) },
          { title: 'Per bulan', align: 'right', render: (_: unknown, r: Row) => <b>{fmtMoney(r.monthlyTotal)}</b> },
          { title: 'Masa', render: (_: unknown, r: Row) => `${fmtDate(r.startDate)} – ${r.endDate ? fmtDate(r.endDate) : 'berjalan'}` },
          { title: 'Sudah ditagih', render: (_: unknown, r: Row) => r.billedPeriods.length ? r.billedPeriods.slice(-3).map((b) => <Tag key={b.period} color={Number(b.shortfall) ? 'orange' : 'green'}>{b.period}</Tag>) : '-' },
          { title: 'Belum ditagih', render: (_: unknown, r: Row) => r.unbilledPeriods.length ? <Space wrap>{r.unbilledPeriods.map((p) => <Button key={p} size="small" disabled={!can('POST', '/services/sites/:id/bill')} loading={bill.isPending} onClick={() => bill.mutate({ id: r.id, period: p })}>Tagih {p}</Button>)}</Space> : <Typography.Text type="secondary">{r.isActive ? 'Lengkap' : 'Nonaktif'}</Typography.Text> },
          { title: '', render: (_: unknown, r: Row) => <Button size="small" onClick={() => { rf.resetFields(); setRoster(r); }}>Jadwal jaga</Button> },
        ]} />
      <Modal title="Kontrak lokasi baru" width={640} open={creating} onCancel={() => setCreating(false)} onOk={() => cf.submit()} confirmLoading={create.isPending} okText="Simpan" destroyOnHidden>
        <Form form={cf} layout="vertical" onFinish={(v) => create.mutate(v)} initialValues={{ startDate: dayjs().startOf('month'), posts: [{}] }}>
          <Form.Item name="customerId" label="Pelanggan" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(customers.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          <Space align="start" wrap>
            <Form.Item name="siteName" label="Lokasi" rules={[{ required: true, min: 2 }]}><Input maxLength={120} placeholder="mis. Gedung Menara Satu" style={{ width: 260 }} /></Form.Item>
            <Form.Item name="title" label="Layanan" rules={[{ required: true, min: 3 }]}><Input maxLength={120} placeholder="mis. Jasa pengamanan" style={{ width: 220 }} /></Form.Item>
            <Form.Item name="startDate" label="Mulai" rules={[{ required: true }]}><DatePicker /></Form.Item>
          </Space>
          <Form.List name="posts">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" wrap>
                    <Form.Item name={[f.name, 'name']} rules={[{ required: true, message: 'Nama pos' }]}><Input placeholder="Pos (mis. Satpam shift pagi)" style={{ width: 240 }} /></Form.Item>
                    <Form.Item name={[f.name, 'headcount']} rules={[{ required: true, message: 'Jumlah' }]}><InputNumber min={1} placeholder="Petugas" /></Form.Item>
                    <Form.Item name={[f.name, 'monthlyRate']} rules={[{ required: true, message: 'Tarif' }]}><InputNumber min={1} placeholder="Tarif / petugas / bulan" prefix="Rp" style={{ width: 200 }} /></Form.Item>
                    {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} />}
                  </Space>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({})}>Tambah pos</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
      <Drawer title={`Jadwal jaga — ${roster?.siteName ?? ''}`} width={760} open={!!roster} onClose={() => setRoster(null)} destroyOnHidden>
        <Space style={{ marginBottom: 12 }}><span>Bulan</span><DatePicker picker="month" allowClear={false} value={dayjs(first)} onChange={(d) => d && setMonth(d.format('YYYY-MM'))} /></Space>
        {can('POST', '/services/sites/:id/roster') && roster?.isActive && (
          <Form form={rf} layout="inline" onFinish={(v) => assign.mutate(v)} style={{ marginBottom: 16, rowGap: 8 }}>
            <Form.Item name="postId" rules={[{ required: true, message: 'Pilih pos' }]}><Select placeholder="Pos" style={{ width: 200 }} options={(roster?.posts ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.headcount})` }))} /></Form.Item>
            <Form.Item name="employeeId" rules={[{ required: true, message: 'Pilih petugas' }]}><Select showSearch optionFilterProp="label" placeholder="Petugas" style={{ width: 200 }} options={(emps.data ?? []).map((e) => ({ value: e.id, label: e.name }))} /></Form.Item>
            <Form.Item name="range" rules={[{ required: true, message: 'Pilih tanggal' }]}><DatePicker.RangePicker /></Form.Item>
            <Button type="primary" htmlType="submit" loading={assign.isPending}>Jadwalkan</Button>
          </Form>
        )}
        {(cov.data?.posts ?? []).map((p) => (
          <div key={p.postId} style={{ marginBottom: 20 }}>
            <Space style={{ marginBottom: 6 }}><b>{p.name}</b><span>wajib {p.headcount} petugas/hari</span>{p.shortfallHeadDays > 0 ? <Tag color="red">kurang {p.shortfallHeadDays} hari-orang</Tag> : <Tag color="green">terpenuhi</Tag>}</Space>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {p.days.map((d) => (
                <span key={d.date} title={`${fmtDate(d.date)}: ${d.assigned} dari ${d.required}`} style={{ width: 26, textAlign: 'center', fontSize: 11, borderRadius: 4, padding: '2px 0', background: d.required === 0 ? '#f1f5f9' : d.assigned >= d.required ? '#dcfce7' : d.assigned === 0 ? '#fee2e2' : '#fef3c7' }}>{Number(d.date.slice(8))}</span>
              ))}
            </div>
            <Table size="small" rowKey="id" style={{ marginTop: 6 }} pagination={{ pageSize: 5, hideOnSinglePage: true }} dataSource={p.duty} locale={{ emptyText: 'Belum ada petugas dijadwalkan bulan ini' }}
              columns={[{ title: 'Tanggal', dataIndex: 'date', render: fmtDate }, { title: 'Petugas', dataIndex: 'employeeName' }, { title: '', width: 40, render: (_: unknown, d: { id: string }) => can('DELETE', '/services/sites/:id/roster/:dutyId') && <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => unassign.mutate(d.id)} /> }]} />
          </div>
        ))}
      </Drawer>
    </>
  );
}

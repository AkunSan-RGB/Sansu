import { PlusOutlined } from '@ant-design/icons';
import { canBookkeep } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Table, Tag } from 'antd';
import { useState } from 'react';
import { get, patch, post, qs } from '@/api/client';
import { useAccounts, useAction } from '@/api/queries';
import type { ContractKind, ContractScheduleRow, FinancingContract } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import { fmtDate, fmtMoney } from '@/lib/format';

const KIND: Record<ContractKind, { label: string; account: 'ASSET' | 'LIABILITY'; amount: string; expense: string }> = {
  LOAN: { label: 'Pinjaman', account: 'LIABILITY', amount: 'Pokok pinjaman', expense: 'Akun beban bunga' },
  LEASE: { label: 'Sewa pembiayaan', account: 'LIABILITY', amount: 'Nilai kini liabilitas sewa', expense: 'Akun beban bunga sewa' },
  PREPAID: { label: 'Biaya dibayar di muka', account: 'ASSET', amount: 'Jumlah dibayar di muka', expense: 'Akun beban amortisasi' },
};
const METHOD: Record<string, string> = { ANNUITY: 'Anuitas (cicilan tetap)', STRAIGHT_PRINCIPAL: 'Pokok tetap', BULLET: 'Pokok di akhir (bullet)', STRAIGHT_LINE: 'Garis lurus' };
const METHODS: Record<ContractKind, string[]> = { LOAN: ['ANNUITY', 'STRAIGHT_PRINCIPAL', 'BULLET'], LEASE: ['ANNUITY', 'STRAIGHT_PRINCIPAL', 'BULLET'], PREPAID: ['STRAIGHT_LINE'] };

interface FormValues {
  kind: ContractKind;
  name: string;
  counterparty?: string;
  accountId: string;
  expenseAccountId?: string;
  startDate: string;
  termMonths: number;
  amount: number;
  ratePct?: number;
  method: string;
  notes?: string;
}

/**
 * Data induk kontrak pembiayaan (pinjaman, sewa pembiayaan, biaya dibayar di muka). Jadwal pokok, bunga, dan amortisasinya dihitung dari
 * syarat kontrak, lalu dibandingkan dengan buku besar di rincian akun terkait.
 */
export default function ContractsTab({ year }: { year: number }) {
  const { me } = useAuth();
  const canEdit = canBookkeep(me?.role);
  const accounts = useAccounts();
  const [form] = Form.useForm<FormValues>();
  const kind = Form.useWatch('kind', form) ?? 'LOAN';
  const [editing, setEditing] = useState<FinancingContract | 'new' | null>(null);
  const [viewing, setViewing] = useState<FinancingContract | null>(null);
  const list = useQuery({ queryKey: ['account-schedules', 'contracts', year], queryFn: () => get<FinancingContract[]>(`/financing-contracts${qs({ year: String(year) })}`) });
  const sched = useQuery({
    queryKey: ['account-schedules', 'contract-schedule', viewing?.id],
    enabled: !!viewing,
    queryFn: () => get<{ rows: ContractScheduleRow[] }>(`/financing-contracts/${viewing!.id}/schedule`),
  });
  const save = useAction(
    (v: FormValues) => {
      const body = { ...v, amount: String(v.amount), ratePct: v.kind === 'PREPAID' || v.ratePct == null ? undefined : String(v.ratePct), expenseAccountId: v.expenseAccountId || undefined };
      return editing && editing !== 'new' ? patch(`/financing-contracts/${editing.id}`, body) : post('/financing-contracts', body);
    },
    { success: 'Kontrak disimpan', invalidate: ['account-schedules'], onSuccess: () => setEditing(null) },
  );
  const close = useAction((c: FinancingContract) => patch(`/financing-contracts/${c.id}`, { status: c.status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE' }), { success: 'Status kontrak diperbarui', invalidate: ['account-schedules'] });
  const accountOptions = (type: 'ASSET' | 'LIABILITY' | 'EXPENSE') =>
    (accounts.data ?? []).filter((a) => a.type === type && a.isPostable).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  const open = (c: FinancingContract | 'new') => {
    setEditing(c);
    form.resetFields();
    form.setFieldsValue(c === 'new' ? { kind: 'LOAN', method: 'ANNUITY', startDate: new Date().toISOString().slice(0, 10) } : { ...c, amount: Number(c.amount), ratePct: c.ratePct == null ? undefined : Number(c.ratePct), expenseAccountId: c.expenseAccountId ?? undefined, counterparty: c.counterparty ?? undefined, notes: c.notes ?? undefined });
  };
  const accountName = (id: string) => (accounts.data ?? []).find((a) => a.id === id);
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Daftarkan kontrak pinjaman, sewa pembiayaan, dan biaya dibayar di muka"
        description="Jadwal pokok, bunga, dan amortisasinya dihitung dari syarat kontrak lalu dibandingkan dengan buku besar di rincian akun terkait. Pendaftaran kontrak tidak membuat jurnal; pembukuan tetap lewat jurnal atau jurnal berulang."
        action={canEdit ? <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>Daftarkan kontrak</Button> : undefined}
      />
      <QueryState q={list}>
        {(rows) => (
          <Table<FinancingContract>
            size="small"
            rowKey="id"
            dataSource={rows}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            locale={{ emptyText: 'Belum ada kontrak terdaftar' }}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: 'Kontrak', dataIndex: 'name', render: (n: string, r) => <a onClick={() => setViewing(r)}>{n}</a> },
              { title: 'Jenis', dataIndex: 'kind', render: (k: ContractKind) => <Tag color="blue">{KIND[k].label}</Tag> },
              { title: 'Pihak', dataIndex: 'counterparty', render: (v: string | null) => v ?? '-' },
              { title: 'Akun', dataIndex: 'accountId', render: (id: string) => { const a = accountName(id); return a ? `${a.code} ${a.name}` : '-'; } },
              { title: 'Mulai', dataIndex: 'startDate', render: (v: string) => fmtDate(v) },
              { title: 'Jangka', dataIndex: 'termMonths', align: 'right', render: (v: number) => `${v} bln` },
              { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
              { title: 'Bunga', dataIndex: 'ratePct', align: 'right', render: (v: string | null) => (v == null ? '-' : `${Number(v)}%`) },
              { title: `Saldo akhir ${year}`, dataIndex: 'balance', align: 'right', render: fmtMoney },
              { title: 'Status', dataIndex: 'status', render: (v: string) => (v === 'ACTIVE' ? <Tag color="green">Aktif</Tag> : <Tag>Ditutup</Tag>) },
              {
                title: '',
                render: (_: unknown, r) =>
                  canEdit && (
                    <>
                      <Button size="small" type="link" onClick={() => open(r)}>Ubah</Button>
                      <Button size="small" type="link" loading={close.isPending} onClick={() => close.mutate(r)}>{r.status === 'ACTIVE' ? 'Tutup' : 'Aktifkan'}</Button>
                    </>
                  ),
              },
            ]}
          />
        )}
      </QueryState>
      <Modal title={editing === 'new' ? 'Daftarkan kontrak' : 'Ubah kontrak'} open={!!editing} width={720} onCancel={() => setEditing(null)} onOk={() => form.submit()} okText="Simpan" confirmLoading={save.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="kind" label="Jenis kontrak" rules={[{ required: true }]}>
                <Select disabled={editing !== 'new'} options={(Object.keys(KIND) as ContractKind[]).map((k) => ({ value: k, label: KIND[k].label }))} onChange={(k: ContractKind) => form.setFieldsValue({ method: METHODS[k][0], accountId: undefined, expenseAccountId: undefined })} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="Nama kontrak" rules={[{ required: true }]}><Input placeholder="Kredit modal kerja Bank X" /></Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="counterparty" label={kind === 'PREPAID' ? 'Pemasok / pihak' : kind === 'LEASE' ? 'Pesewa (lessor)' : 'Pemberi pinjaman'}><Input /></Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="accountId" label={`Akun saldo (${KIND[kind].account === 'ASSET' ? 'aset' : 'liabilitas'})`} rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="label" options={accountOptions(KIND[kind].account)} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="expenseAccountId" label={KIND[kind].expense} extra="Dipakai membandingkan bunga/amortisasi dengan beban di buku besar">
                <Select allowClear showSearch optionFilterProp="label" options={accountOptions('EXPENSE')} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="startDate" label="Tanggal mulai" rules={[{ required: true }]}><Input type="date" /></Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="termMonths" label="Jangka (bulan)" rules={[{ required: true }]}><InputNumber min={1} max={600} style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="amount" label={KIND[kind].amount} rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
            </Col>
            {kind !== 'PREPAID' && (
              <Col xs={24} md={8}>
                <Form.Item name="ratePct" label="Bunga per tahun (%)" rules={[{ required: true, message: 'Isi 0 bila tanpa bunga' }]}><InputNumber min={0} max={100} step={0.25} style={{ width: '100%' }} /></Form.Item>
              </Col>
            )}
            <Col xs={24}>
              <Form.Item name="method" label="Metode" rules={[{ required: true }]}>
                <Select options={METHODS[kind].map((m) => ({ value: m, label: METHOD[m] }))} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="notes" label="Catatan"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
      <Modal title={viewing ? `Jadwal kontraktual · ${viewing.name}` : ''} open={!!viewing} width={900} footer={null} onCancel={() => setViewing(null)}>
        <QueryState q={sched}>
          {(d) => (
            <Table<ContractScheduleRow>
              size="small"
              rowKey="period"
              pagination={{ pageSize: 24, hideOnSinglePage: true }}
              dataSource={d.rows}
              scroll={{ x: 'max-content' }}
              columns={[
                { title: 'Periode', dataIndex: 'period' },
                { title: 'Saldo awal', dataIndex: 'opening', align: 'right', render: fmtMoney },
                { title: 'Penambahan', dataIndex: 'additions', align: 'right', render: fmtMoney },
                { title: viewing?.kind === 'PREPAID' ? 'Amortisasi' : 'Pokok', dataIndex: 'principal', align: 'right', render: fmtMoney },
                { title: 'Bunga', dataIndex: 'interest', align: 'right', render: fmtMoney },
                { title: 'Cicilan', dataIndex: 'payment', align: 'right', render: fmtMoney },
                { title: 'Saldo akhir', dataIndex: 'closing', align: 'right', render: fmtMoney },
              ]}
            />
          )}
        </QueryState>
      </Modal>
    </>
  );
}

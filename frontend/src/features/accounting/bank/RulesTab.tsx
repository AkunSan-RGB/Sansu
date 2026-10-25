import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Table } from 'antd';
import { useState } from 'react';
import { api, get, post, put } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useAccounts, useAction } from '@/api/queries';
import { fmtMoney } from '@/lib/format';

interface BankRule {
  id: string;
  name: string;
  keyword: string;
  direction: 'IN' | 'OUT' | 'ANY';
  accountId: string;
  maxAmount: string;
  isActive: boolean;
}

/** Aturan kategori otomatis: mutasi dengan kata tertentu langsung dijurnal saat impor */
export function RulesTab() {
  const accounts = useAccounts();
  const q = useQuery({ queryKey: ['bank', 'rules'], queryFn: () => get<BankRule[]>('/bank/rules') });
  const [editing, setEditing] = useState<BankRule | 'new' | null>(null);
  const [form] = Form.useForm<{ name: string; keyword: string; direction: 'IN' | 'OUT' | 'ANY'; accountId: string; maxAmount: number }>();
  const save = useAction(
    (v: { name: string; keyword: string; direction: 'IN' | 'OUT' | 'ANY'; accountId: string; maxAmount: number }) => {
      const body = { ...v, maxAmount: String(v.maxAmount ?? 5000000) };
      return editing && editing !== 'new' ? put(`/bank/rules/${editing.id}`, body) : post('/bank/rules', body);
    },
    { success: 'Aturan disimpan', invalidate: ['bank', 'rules'], onSuccess: () => setEditing(null) },
  );
  const del = useAction((id: string) => api(`/bank/rules/${id}`, { method: 'DELETE' }), { success: 'Aturan dihapus', invalidate: ['bank', 'rules'] });
  const { me } = useAuth();
  const admin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const defaults = useAction(() => post<{ added: number }>('/bank/rules/defaults'), { success: (r) => (r.added ? `${r.added} aturan bawaan dipasang` : 'Aturan bawaan sudah ada semua'), invalidate: ['bank', 'rules'] });
  const options = (accounts.data ?? []).filter((a) => a.isPostable && (a.type === 'EXPENSE' || a.type === 'REVENUE')).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const name = (id: string) => accounts.data?.find((a) => a.id === id);
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Saat mutasi diimpor, mutasi yang belum cocok dengan buku dan memuat kata kunci aturan langsung dijurnal otomatis (mis. 'BIAYA ADM' → Beban Administrasi Bank). Hanya akun pendapatan/beban, dan hanya sampai batas nilai aturan; di atasnya tetap manual." />
      {admin ? (
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" onClick={() => { form.resetFields(); form.setFieldsValue({ direction: 'OUT', maxAmount: 5000000 }); setEditing('new'); }}>
            Aturan baru
          </Button>
          <Button onClick={() => defaults.mutate(undefined)} loading={defaults.isPending}>
            Pasang aturan bawaan untuk usaha Anda
          </Button>
        </Space>
      ) : (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Aturan otomatis hanya dapat diubah Pemilik/Admin." />
      )}
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={q.data}
        pagination={false}
        columns={[
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Kata kunci', dataIndex: 'keyword' },
          { title: 'Arah', dataIndex: 'direction', render: (d: string) => ({ IN: 'Uang masuk', OUT: 'Uang keluar', ANY: 'Keduanya' })[d] },
          { title: 'Akun', render: (_, r: BankRule) => `${name(r.accountId)?.code ?? ''} ${name(r.accountId)?.name ?? ''}` },
          { title: 'Batas nilai', dataIndex: 'maxAmount', align: 'right', render: fmtMoney },
          {
            render: (_, r: BankRule) => admin && (
              <Space>
                <Button size="small" type="link" onClick={() => { form.setFieldsValue({ ...r, maxAmount: Number(r.maxAmount) }); setEditing(r); }}>Ubah</Button>
                <Popconfirm title="Hapus aturan ini?" onConfirm={() => del.mutate(r.id)}>
                  <Button size="small" type="link" danger>Hapus</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal title={editing === 'new' ? 'Aturan baru' : 'Ubah aturan'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="name" label="Nama" rules={[{ required: true }]}><Input maxLength={80} /></Form.Item>
          <Form.Item name="keyword" label="Kata kunci di keterangan mutasi" rules={[{ required: true, min: 3, message: 'Min. 3 huruf' }]}><Input maxLength={80} placeholder="BIAYA ADM" /></Form.Item>
          <Form.Item name="direction" label="Arah"><Radio.Group options={[{ label: 'Uang keluar', value: 'OUT' }, { label: 'Uang masuk', value: 'IN' }, { label: 'Keduanya', value: 'ANY' }]} /></Form.Item>
          <Form.Item name="accountId" label="Akun lawan (pendapatan / beban)" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={options} /></Form.Item>
          <Form.Item name="maxAmount" label="Otomatis sampai nilai" extra="Mutasi lebih besar dari ini tetap diproses manual."><InputNumber min={1} style={{ width: '100%' }} prefix="Rp" /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

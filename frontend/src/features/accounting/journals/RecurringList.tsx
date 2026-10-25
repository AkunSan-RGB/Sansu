import { PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { canBookkeep, RECURRING_FREQUENCY_LABELS, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from 'antd';
import { useAuth } from '@/auth/AuthContext';
import { useState } from 'react';
import { api, get, patch, post } from '@/api/client';
import { LEDGER_KEYS, useAccounts, useAction } from '@/api/queries';
import type { RecurringJournal } from '@/api/types';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { t } from '@/lib/terms';
import { LineValue, toLines } from './shared';
import { LinesEditor } from './LinesEditor';

export function RecurringList() {
  const bookkeeper = canBookkeep(useAuth().me?.role);
  const [editing, setEditing] = useState<RecurringJournal | 'new' | null>(null);
  const [form] = Form.useForm();
  const accounts = useAccounts();
  const name = (id: string) => accounts.data?.find((a) => a.id === id);
  const list = useQuery({ queryKey: ['recurring'], queryFn: () => get<RecurringJournal[]>('/accounting/recurring') });
  const save = useAction(
    (v: Record<string, unknown> & { lines: LineValue[] }) => {
      const body = { ...v, endDate: v.endDate || undefined, remaining: v.remaining || undefined, lines: toLines(v.lines) };
      return editing === 'new' ? post('/accounting/recurring', body) : patch(`/accounting/recurring/${(editing as RecurringJournal).id}`, body);
    },
    { success: 'Jurnal berulang disimpan', invalidate: ['recurring'], onSuccess: () => setEditing(null) },
  );
  const toggle = useAction((r: RecurringJournal) => patch(`/accounting/recurring/${r.id}`, { isActive: !r.isActive }), { invalidate: ['recurring'] });
  const remove = useAction((id: string) => api(`/accounting/recurring/${id}`, { method: 'DELETE' }), { success: 'Dihapus', invalidate: ['recurring'] });
  const run = useAction(() => post<{ posted: { name: string; number: string; date: string }[]; errors: { name: string; error: string }[] }>('/accounting/recurring/run'), {
    success: (r) => (r.posted.length ? `${r.posted.length} jurnal diposting` : 'Tidak ada yang jatuh tempo') + (r.errors.length ? ` · ${r.errors.length} gagal: ${r.errors[0].error}` : ''),
    invalidate: ['recurring', ...LEDGER_KEYS],
  });

  return (
    <Card>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Jurnal berulang diposting otomatis setiap jatuh tempo — cocok untuk amortisasi sewa/asuransi dibayar dimuka, akrual gaji, atau angsuran pinjaman."
      />
      {bookkeeper && (
      <Space style={{ marginBottom: 12 }} wrap>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({ frequency: 'MONTHLY', nextDate: today(), isAdjustment: true, lines: [{}, {}] });
            setEditing('new');
          }}
        >
          Jurnal berulang baru
        </Button>
        <Button icon={<PlayCircleOutlined />} loading={run.isPending} onClick={() => run.mutate(undefined)}>
          Posting yang jatuh tempo sekarang
        </Button>
      </Space>
      )}
      <Table
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data}
        scroll={{ x: 900 }}
        locale={{ emptyText: <Empty description="Belum ada jurnal berulang" /> }}
        expandable={{
          expandedRowRender: (r) => (
            <Table
              rowKey="_k"
              size="small"
              pagination={false}
              dataSource={r.lines.map((l, i) => ({ ...l, _k: i }))}
              columns={[
                { title: 'Akun', render: (_, l) => `${name(l.accountId)?.code ?? ''} · ${name(l.accountId)?.name ?? ''}` },
                { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => (Number(v) ? fmtMoney(v) : '') },
                { title: 'Kredit', dataIndex: 'credit', align: 'right', render: (v) => (Number(v) ? fmtMoney(v) : '') },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Frekuensi', dataIndex: 'frequency', render: (f: keyof typeof RECURRING_FREQUENCY_LABELS) => RECURRING_FREQUENCY_LABELS[f] },
          { title: 'Berikutnya', dataIndex: 'nextDate', render: fmtDate },
          { title: 'Sisa', dataIndex: 'remaining', render: (r) => (r == null ? 'Tanpa batas' : `${r}×`) },
          { title: 'Nilai', render: (_, r) => fmtMoney(r.lines.reduce((a, l) => a + Number(l.debit ?? 0), 0)) },
          { title: 'Jenis', dataIndex: 'isAdjustment', render: (a) => (a ? <Tag color="orange">Penyesuaian</Tag> : <Tag>Biasa</Tag>) },
          { title: 'Aktif', render: (_, r) => <Switch size="small" checked={r.isActive} disabled={!bookkeeper} onChange={() => toggle.mutate(r)} /> },
          {
            render: (_, r) => bookkeeper && (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    form.setFieldsValue({ ...r, lines: r.lines.map((l) => ({ ...l, debit: Number(l.debit ?? 0) || undefined, credit: Number(l.credit ?? 0) || undefined })) });
                    setEditing(r);
                  }}
                >
                  Ubah
                </Button>
                <Popconfirm title="Hapus jurnal berulang? Jurnal yang sudah diposting tetap ada." onConfirm={() => remove.mutate(r.id)}>
                  <Button size="small" danger>
                    Hapus
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing === 'new' ? 'Jurnal berulang baru' : 'Ubah jurnal berulang'}
        width={900}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okText="Simpan"
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Space wrap>
            <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
              <Input style={{ width: 240 }} placeholder={t('Amortisasi sewa gudang')} />
            </Form.Item>
            <Form.Item name="description" label="Keterangan jurnal" rules={[{ required: true }]}>
              <Input style={{ width: 320 }} />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="frequency" label="Frekuensi">
              <Select style={{ width: 150 }} options={toOptions(RECURRING_FREQUENCY_LABELS)} />
            </Form.Item>
            <Form.Item name="nextDate" label="Tanggal posting berikutnya" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="remaining" label="Jumlah kali (opsional)">
              <InputNumber min={1} max={600} />
            </Form.Item>
            <Form.Item name="endDate" label="Berakhir (opsional)">
              <Input type="date" />
            </Form.Item>
          </Space>
          <Form.Item name="isAdjustment" valuePropName="checked">
            <Checkbox>Jurnal penyesuaian</Checkbox>
          </Form.Item>
          <LinesEditor form={form} />
        </Form>
      </Modal>
    </Card>
  );
}

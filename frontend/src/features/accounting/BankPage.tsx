import { UploadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Form, Input, Modal, Radio, Space, Table, Tabs, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, get, post } from '@/api/client';
import { canBookkeep, canHandleMoney } from '@sansu/shared';
import { useAuth } from '@/auth/AuthContext';
import { useAction, useCashAccounts } from '@/api/queries';
import type { BankStatementSummary } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { fmtDate } from '@/lib/format';
import { bankMoney, KEYS, setBankCurrency } from './bank/shared';
import { ReconciliationTab } from './bank/ReconciliationTab';
import { RulesTab } from './bank/RulesTab';
import { ImportModal } from './bank/ImportModal';
import { StatementDrawer } from './bank/StatementDrawer';

interface BankFinding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

/** Pengesahan rekonsiliasi akhir bulan oleh orang selain pengimpor */
function SignoffTab({ cashAccountId }: { cashAccountId?: string }) {
  const canSign = canBookkeep(useAuth().me?.role);
  const q = useQuery({ queryKey: ['bank', 'signoffs', cashAccountId], queryFn: () => get<{ id: string; period: string; bookBalance: string; signedAt: string }[]>(`/bank/signoffs?cashAccountId=${cashAccountId}`), enabled: !!cashAccountId });
  const periods = Array.from({ length: 6 }, (_, i) => dayjs().subtract(i + 1, 'month').format('YYYY-MM'));
  const sign = useAction((period: string) => post('/bank/signoffs', { cashAccountId, period }), { success: 'Rekonsiliasi disahkan', invalidate: ['bank', 'signoffs'] });
  const done = new Map((q.data ?? []).map((x) => [x.period, x]));
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Setelah rekonsiliasi akhir bulan selisihnya nol, sahkan di sini. Pengesah harus orang lain dari yang mengimpor rekening koran bulan itu (Pemilik boleh)." />
      <Table
        rowKey="period"
        size="small"
        pagination={false}
        dataSource={periods.map((p) => ({ period: p }))}
        columns={[
          { title: 'Bulan', dataIndex: 'period' },
          { title: 'Status', render: (_, r: { period: string }) => (done.has(r.period) ? <Tag color="green">Disahkan</Tag> : <Tag>Belum</Tag>) },
          { title: 'Saldo buku', render: (_, r: { period: string }) => (done.has(r.period) ? bankMoney(done.get(r.period)!.bookBalance) : '-'), align: 'right' },
          { title: 'Disahkan', render: (_, r: { period: string }) => (done.has(r.period) ? fmtDate(done.get(r.period)!.signedAt) : '-') },
          { render: (_, r: { period: string }) => (done.has(r.period) || !canSign ? null : <Button size="small" onClick={() => sign.mutate(r.period)} loading={sign.isPending}>Sahkan</Button>) },
        ]}
      />
    </>
  );
}

export default function BankPage() {
  const cash = useCashAccounts('all');
  const [params, setParams] = useSearchParams();
  const banks = cash.data ?? [];
  const accountId = params.get('account') ?? banks.find((b) => /bank/i.test(b.name))?.id ?? banks[0]?.id;
  setBankCurrency(banks.find((b) => b.id === accountId)?.currency);
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState('statements');
  const list = useQuery({
    queryKey: ['bank', 'statements', accountId],
    queryFn: () => get<BankStatementSummary[]>(`/bank/statements?cashAccountId=${accountId}`),
    enabled: !!accountId,
  });
  const { me } = useAuth();
  const admin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const controls = useQuery({ queryKey: ['bank', 'controls'], queryFn: () => get<{ items: BankFinding[] }>('/bank/controls') });
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeForm] = Form.useForm<{ reason: string }>();
  const remove = useAction((v: { id: string; reason: string }) => api(`/bank/statements/${v.id}?reason=${encodeURIComponent(v.reason)}`, { method: 'DELETE' }), { success: 'Rekening koran dihapus', invalidate: KEYS, onSuccess: () => setRemoving(null) });

  return (
    <>
      <PageHeader
        title="Cocokkan dengan bank (rekonsiliasi)"
        extra={
          <Space wrap>
            <Radio.Group
              value={accountId}
              onChange={(e) => setParams({ account: e.target.value }, { replace: true })}
              optionType="button"
              options={banks.map((b) => ({ value: b.id, label: b.currency === 'IDR' ? b.name : `${b.name} (${b.currency})` }))}
            />
            {canHandleMoney(me?.role) && (
              <Button type="primary" icon={<UploadOutlined />} onClick={() => setImporting(true)}>
                Impor mutasi
              </Button>
            )}
          </Space>
        }
      />
      {!!controls.data?.items.length && (
        <Card size="small" title="Kontrol bank" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {controls.data.items.map((c) => (
              <Alert key={c.key} type={c.level} showIcon message={c.title} description={<div><div>{c.detail}</div><div style={{ marginTop: 4 }}><strong>Contoh:</strong> {c.refs.slice(0, 4).join(' · ')}{c.refs.length > 4 ? ` · +${c.refs.length - 4}` : ''}</div></div>} />
            ))}
          </Space>
        </Card>
      )}
      <Card>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'statements',
              label: 'Rekening koran',
              children: (
                <Table
                  rowKey="id"
                  loading={list.isLoading}
                  dataSource={list.data}
                  onRow={(r) => ({ onClick: () => setOpen(r.id), style: { cursor: 'pointer' } })}
                  locale={{ emptyText: <Empty description="Belum ada mutasi. Unduh mutasi rekening (CSV/Excel) dari internet banking, lalu klik Impor mutasi." /> }}
                  columns={[
                    { title: 'Periode', render: (_, r) => `${fmtDate(r.period_from)} – ${fmtDate(r.period_to)}` },
                    { title: 'File', dataIndex: 'file_name', render: (f) => f ?? '-' },
                    { title: 'Mutasi', dataIndex: 'lines' },
                    {
                      title: 'Sudah cocok',
                      render: (_, r) => (
                        <Tag color={r.matched === r.lines ? 'green' : 'orange'}>
                          {r.matched} / {r.lines}
                        </Tag>
                      ),
                    },
                    { title: 'Saldo akhir bank', dataIndex: 'closing_balance', align: 'right', render: (v) => (v ? bankMoney(v) : '-') },
                    {
                      render: (_, r) => (
                        <span onClick={(e) => e.stopPropagation()}>
                          {admin && (
                            <Button size="small" type="text" danger onClick={() => { removeForm.resetFields(); setRemoving(r.id); }}>
                              Hapus
                            </Button>
                          )}
                        </span>
                      ),
                    },
                  ]}
                />
              ),
            },
            { key: 'rec', label: 'Laporan rekonsiliasi', children: <ReconciliationTab cashAccountId={accountId} /> },
            { key: 'sign', label: 'Pengesahan bulanan', children: <SignoffTab cashAccountId={accountId} /> },
            { key: 'rules', label: 'Aturan otomatis', children: <RulesTab /> },
          ]}
        />
      </Card>
      <ImportModal key={accountId} open={importing} onClose={() => setImporting(false)} cashAccountId={accountId} onDone={setOpen} />
      <StatementDrawer id={open} onClose={() => setOpen(null)} />
      <Modal title="Hapus rekening koran" open={!!removing} onCancel={() => setRemoving(null)} onOk={() => removeForm.submit()} confirmLoading={remove.isPending} okText="Hapus" okButtonProps={{ danger: true }}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Jurnal yang sudah dibuat dari mutasi tetap ada; hanya pencocokannya yang dilepas. Alasan tercatat di jejak audit." />
        <Form form={removeForm} layout="vertical" onFinish={(v) => removing && remove.mutate({ id: removing, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Isi alasan (min. 5 karakter)' }]}><Input.TextArea rows={2} maxLength={300} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

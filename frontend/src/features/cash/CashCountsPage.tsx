import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { BRAND, CASH_COUNT_STATUS_LABELS, type CashCount, type CashCountSettings, type CashCountStatus, canHandleMoney } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Drawer, InputNumber, Modal, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, put, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import CashTabs from './CashTabs';
import { fmtDate, fmtMoney } from '@/lib/format';
import { KasAccount, STATUS_COLOR, diffColor, diffText } from './cash-counts/shared';
import { NewCount } from './cash-counts/NewCount';
import { CountDetail } from './cash-counts/CountDetail';

/** Opname kas: hitung fisik uang per pecahan dan cocokkan dengan saldo buku */
export default function CashCountsPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [accountId, setAccountId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const detailId = params.get('id');
  const kas = useQuery({
    queryKey: ['cash-counts', 'accounts'],
    queryFn: () => get<KasAccount[]>('/cash/counts/accounts'),
  });
  const list = useQuery({
    queryKey: ['cash-counts', 'list', accountId],
    queryFn: () => get<CashCount[]>(`/cash/counts${qs({ accountId })}`),
  });
  const waiting = (list.data ?? []).filter((c) => c.status === 'WAITING_APPROVAL');

  return (
    <>
      <PageHeader
        title="Hitung uang kas (opname)"
        extra={
          <Space wrap>
            {me?.role === 'OWNER' && (
              <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} aria-label="Pengaturan opname" />
            )}
            {canHandleMoney(me?.role) && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                Opname baru
              </Button>
            )}
          </Space>
        }
      />
      <CashTabs />
      {me?.role === 'OWNER' && waiting.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${waiting.length} opname menunggu persetujuan Anda`}
          action={
            <Button size="small" type="primary" onClick={() => setParams({ id: waiting[0].id })}>
              Periksa
            </Button>
          }
        />
      )}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {(kas.data ?? []).map((a) => {
          const stale = !a.lastCount || Date.now() - Date.parse(a.lastCount) > 35 * 86_400_000;
          return (
            <Col key={a.id} xs={24} sm={12} lg={8}>
              <Card
                size="small"
                hoverable
                onClick={() => setAccountId(accountId === a.id ? undefined : a.id)}
                style={{ borderColor: accountId === a.id ? BRAND.colors.primary : undefined }}
              >
                <Statistic title={`${a.code} · ${a.name}`} value={fmtMoney(a.balance)} valueStyle={{ fontSize: 20 }} />
                <Typography.Text type={stale ? 'warning' : 'secondary'} style={{ fontSize: 12 }}>
                  {a.lastCount ? `Opname terakhir ${fmtDate(a.lastCount)}` : 'Belum pernah diopname'}
                  {stale && ' · sudah waktunya opname'}
                </Typography.Text>
              </Card>
            </Col>
          );
        })}
      </Row>
      <Card>
        <Table
          rowKey="id"
          loading={list.isLoading}
          dataSource={list.data}
          scroll={{ x: 820 }}
          onRow={(r) => ({ onClick: () => setParams({ id: r.id }), style: { cursor: 'pointer' } })}
          locale={{ emptyText: 'Belum ada opname kas. Klik "Opname baru" untuk mulai menghitung uang.' }}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: 'Kas', render: (_, c) => `${c.account.code} · ${c.account.name}` },
            { title: 'Saldo buku', dataIndex: 'bookBalance', align: 'right', render: fmtMoney },
            { title: 'Uang fisik', dataIndex: 'countedTotal', align: 'right', render: fmtMoney },
            {
              title: 'Selisih',
              dataIndex: 'difference',
              align: 'right',
              render: (v: string, c) =>
                c.status === 'DRAFT' ? (
                  <Typography.Text type="secondary">—</Typography.Text>
                ) : (
                  <span style={{ color: diffColor(Number(v)), fontWeight: 600 }}>{diffText(Number(v))}</span>
                ),
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: CashCountStatus) => <Tag color={STATUS_COLOR[s]}>{CASH_COUNT_STATUS_LABELS[s]}</Tag>,
            },
          ]}
        />
      </Card>
      <NewCount
        open={creating}
        accounts={kas.data ?? []}
        onClose={() => setCreating(false)}
        onDone={(id) => setParams({ id })}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Drawer open={!!detailId} onClose={() => setParams({})} width={980} title="Opname kas" destroyOnHidden>
        {detailId && <CountDetail id={detailId} onClosed={() => setParams({})} />}
      </Drawer>
    </>
  );
}

function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['cash-counts', 'settings'],
    queryFn: () => get<CashCountSettings>('/cash/counts/settings'),
    enabled: open,
  });
  const [v, setV] = useState<number | null>(null);
  useEffect(() => setV(q.data?.approvalThreshold ?? null), [q.data]);
  const save = useAction(() => put('/cash/counts/settings', { approvalThreshold: v ?? 0 }), {
    success: 'Pengaturan disimpan',
    invalidate: ['cash-counts'],
    onSuccess: onClose,
  });
  return (
    <Modal
      title="Pengaturan opname kas"
      open={open}
      onCancel={onClose}
      onOk={() => save.mutate(undefined)}
      okText="Simpan"
      confirmLoading={save.isPending}
    >
      <Typography.Paragraph>
        Selisih di atas batas ini harus disetujui Pemilik sebelum dibukukan. Selisih di bawahnya langsung dibukukan ke
        akun Selisih Kas.
      </Typography.Paragraph>
      <InputNumber
        value={v}
        onChange={setV}
        min={0}
        step={10000}
        prefix="Rp"
        style={{ width: '100%' }}
        formatter={(x) => `${x}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
        parser={(x) => Number((x ?? '').replace(/\./g, ''))}
      />
    </Modal>
  );
}

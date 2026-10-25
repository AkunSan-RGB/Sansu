import { CheckOutlined } from '@ant-design/icons';
import { BRAND, type BillingOverview, type Plan } from '@sansu/shared';
import { App, Button, Card, Col, Row, Segmented, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtMoney } from '@/lib/format';
import { CYCLE } from './shared';

export function Plans({
  plans,
  current,
  currentCycle,
  usage,
  hasOpen,
}: {
  plans: Plan[];
  current?: string;
  currentCycle: 'MONTHLY' | 'YEARLY';
  usage: BillingOverview['usage'];
  hasOpen: boolean;
}) {
  const { modal } = App.useApp();
  const [cycle, setCycle] = useState<'MONTHLY' | 'YEARLY'>(currentCycle);
  const create = useAction((v: { planId: string; cycle: string }) => post('/billing/invoices', v), {
    success: 'Tagihan dibuat — silakan lakukan pembayaran',
    invalidate: ['billing'],
  });
  const choose = (p: Plan) => {
    const price = cycle === 'YEARLY' ? p.priceYearly : p.priceMonthly;
    modal.confirm({
      title: `Pilih paket ${p.name} (${CYCLE[cycle].toLowerCase()})?`,
      content: (
        <>
          Tagihan sebesar <b>{fmtMoney(price)}</b> akan dibuat.
          {hasOpen && ' Tagihan lama yang belum dibayar akan dibatalkan.'} Masa aktif dihitung setelah masa aktif/uji
          coba Anda saat ini berakhir.
        </>
      ),
      okText: 'Buat tagihan',
      cancelText: 'Batal',
      onOk: () => create.mutateAsync({ planId: p.id, cycle }),
    });
  };
  return (
    <Card
      title="Pilih paket"
      extra={
        <Segmented
          value={cycle}
          onChange={(v) => setCycle(v as 'MONTHLY' | 'YEARLY')}
          options={[
            { value: 'MONTHLY', label: 'Bulanan' },
            { value: 'YEARLY', label: 'Tahunan · hemat' },
          ]}
        />
      }
    >
      <Row gutter={[16, 16]}>
        {plans.map((p) => {
          const monthly = Number(p.priceMonthly);
          const yearly = Number(p.priceYearly);
          const saving = monthly * 12 - yearly;
          const isCurrent = p.id === current;
          const tooSmall =
            (p.maxUsers != null && usage.users > p.maxUsers) ||
            (p.maxWarehouses != null && usage.warehouses > p.maxWarehouses);
          return (
            <Col xs={24} md={8} key={p.id}>
              <div
                style={{
                  height: '100%',
                  border: `1px solid ${isCurrent ? BRAND.colors.primary : '#e3e8f0'}`,
                  boxShadow: isCurrent ? `0 0 0 3px ${BRAND.colors.primarySoft}` : undefined,
                  borderRadius: 14,
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    {p.name}
                  </Typography.Title>
                  {isCurrent && <Tag color="green">Paket Anda</Tag>}
                </Space>
                <div>
                  <span style={{ fontSize: 26, fontWeight: 700, color: BRAND.colors.mark }}>
                    {fmtMoney(cycle === 'YEARLY' ? yearly : monthly)}
                  </span>
                  <Typography.Text type="secondary"> / {cycle === 'YEARLY' ? 'tahun' : 'bulan'}</Typography.Text>
                  {cycle === 'YEARLY' && saving > 0 && (
                    <div>
                      <Tag color="green" style={{ marginTop: 4 }}>
                        Hemat {fmtMoney(saving)}
                      </Tag>
                    </div>
                  )}
                </div>
                <Typography.Text type="secondary">{p.description}</Typography.Text>
                <Space direction="vertical" size={2}>
                  <span>
                    <CheckOutlined style={{ color: BRAND.colors.accent }} /> {p.maxUsers ?? 'Tanpa batas'} pengguna
                    aktif
                  </span>
                  <span>
                    <CheckOutlined style={{ color: BRAND.colors.accent }} /> {p.maxWarehouses ?? 'Tanpa batas'} gudang
                  </span>
                  <span>
                    <CheckOutlined style={{ color: BRAND.colors.accent }} /> Semua aplikasi SANSU
                  </span>
                </Space>
                <div style={{ flex: 1 }} />
                <Button
                  type={isCurrent ? 'default' : 'primary'}
                  block
                  disabled={tooSmall}
                  onClick={() => choose(p)}
                  title={tooSmall ? 'Pemakaian Anda melebihi batas paket ini' : undefined}
                >
                  {isCurrent ? 'Perpanjang' : 'Pilih paket'}
                </Button>
                {tooSmall && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Pemakaian Anda melebihi batas paket ini.
                  </Typography.Text>
                )}
              </div>
            </Col>
          );
        })}
      </Row>
    </Card>
  );
}

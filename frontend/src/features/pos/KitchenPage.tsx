import { ONLINE_CHANNEL_LABELS, POS_ORDER_TYPE_LABELS } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Empty, Row, Select, Space, Spin, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post, qs } from '@/api/client';
import { useAction, useWarehouses } from '@/api/queries';
import type { KitchenBoard, KitchenTicket } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { fmtQty } from '@/lib/format';
import { LINE_STATUS } from './tables/TabDrawer';

const NEXT: Record<string, { to: 'PREPARING' | 'READY' | 'SERVED'; label: string }> = {
  NEW: { to: 'PREPARING', label: 'Mulai masak' },
  PREPARING: { to: 'READY', label: 'Siap' },
  READY: { to: 'SERVED', label: 'Sudah diantar' },
};

/** Layar dapur: antrean menu dari semua meja, yang paling lama di atas; diperbarui otomatis tiap 8 detik */
export default function KitchenPage() {
  const { data: warehouses } = useWarehouses();
  const [wh, setWh] = useState<string>();
  const board = useQuery({ queryKey: ['pos-kitchen', wh], queryFn: () => get<KitchenBoard>(`/pos/kitchen${qs({ warehouseId: wh })}`), refetchInterval: 8_000 });
  const move = useAction((v: { id: string; status: 'PREPARING' | 'READY' | 'SERVED' }) => post(`/pos/kitchen/lines/${v.id}/status`, { status: v.status }), { invalidate: ['pos-kitchen', 'pos-tab', 'pos-tables', 'pos-tabs'] });
  const s = board.data?.summary;

  return (
    <>
      <PageHeader
        title="Layar dapur"
        extra={
          <Space wrap>
            {(warehouses?.length ?? 0) > 1 && <Select allowClear placeholder="Semua outlet" style={{ width: 200 }} value={wh} onChange={setWh} options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />}
            <Tag color="blue">Antre {s?.NEW ?? 0}</Tag>
            <Tag color="orange">Dimasak {s?.PREPARING ?? 0}</Tag>
            <Tag color="green">Siap diantar {s?.READY ?? 0}</Tag>
          </Space>
        }
      />
      {board.isLoading ? (
        <Spin />
      ) : !board.data?.tickets.length ? (
        <Card><Empty description="Tidak ada pesanan di dapur" /></Card>
      ) : (
        <Row gutter={[12, 12]}>
          {board.data.tickets.map((t: KitchenTicket) => (
            <Col key={t.tabId} xs={24} md={12} xl={8}>
              <Card
                size="small"
                style={{ borderColor: t.waitingMinutes >= 20 ? '#ff4d4f' : t.waitingMinutes >= 10 ? '#fa8c16' : undefined }}
                title={
                  <Space wrap>
                    <Typography.Text strong style={{ fontSize: 18 }}>{t.tableLabel ?? t.guestName ?? t.number}</Typography.Text>
                    <Tag color={t.channel ? 'purple' : undefined}>{t.channel ? ONLINE_CHANNEL_LABELS[t.channel] : POS_ORDER_TYPE_LABELS[t.orderType]}</Tag>
                  </Space>
                }
                extra={<Tag color={t.waitingMinutes >= 20 ? 'red' : t.waitingMinutes >= 10 ? 'orange' : 'default'}>{t.waitingMinutes} mnt</Tag>}
              >
                {t.items.map((i) => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ minWidth: 0 }}>
                      <Typography.Text strong style={{ fontSize: 16 }}>{fmtQty(Number(i.qty))} × {i.product}</Typography.Text>
                      {i.notes && <div style={{ color: '#d46b08', fontWeight: 600 }}>{i.notes}</div>}
                      <Tag color={LINE_STATUS[i.status].color} style={{ marginTop: 2 }}>{LINE_STATUS[i.status].label}</Tag>
                    </div>
                    {NEXT[i.status] && (
                      <Button type={i.status === 'NEW' ? 'primary' : 'default'} loading={move.isPending && move.variables?.id === i.id} onClick={() => move.mutate({ id: i.id, status: NEXT[i.status].to })}>
                        {NEXT[i.status].label}
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </>
  );
}

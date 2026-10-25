import { FileTextOutlined } from '@ant-design/icons';
import { BILLING_STATUS_LABELS, type BillingInvoice, type BillingOverview } from '@sansu/shared';
import { Button, Card, Empty, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import BillingInvoiceModal from '../BillingInvoiceDoc';
import { fmtDate, fmtMoney } from '@/lib/format';
import { StatusCard } from './StatusCard';
import { OpenInvoice } from './OpenInvoice';
import { Plans } from './Plans';
import { CYCLE, INV_COLOR } from './shared';

export function Billing({ d }: { d: BillingOverview }) {
  const s = d.subscription;
  const open = d.invoices.find((i) => i.status === 'UNPAID' || i.status === 'WAITING');
  const [doc, setDoc] = useState<string | null>(null);
  const anyVat = d.invoices.some((i) => Number(i.vatAmount) > 0);
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <StatusCard d={d} />
      {open && <OpenInvoice inv={open} payment={d.payment} />}
      <Plans plans={d.plans} current={s.plan?.id} currentCycle={s.cycle} usage={d.usage} hasOpen={!!open} />
      <Card title="Riwayat tagihan">
        <Table
          rowKey="id"
          size="small"
          dataSource={d.invoices}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{ emptyText: <Empty description="Belum ada tagihan" /> }}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'createdAt', render: fmtDate },
            { title: 'Paket', render: (_, i) => `${i.planName} · ${CYCLE[i.cycle]}` },
            ...(anyVat
              ? [
                  { title: 'DPP', dataIndex: 'subtotal', align: 'right' as const, render: fmtMoney },
                  { title: 'PPN', dataIndex: 'vatAmount', align: 'right' as const, render: fmtMoney },
                ]
              : []),
            { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (v: BillingInvoice['status']) => <Tag color={INV_COLOR[v]}>{BILLING_STATUS_LABELS[v]}</Tag>,
            },
            {
              title: 'Masa aktif',
              render: (_, i) => (i.periodEnd ? `${fmtDate(i.periodStart)} – ${fmtDate(i.periodEnd)}` : '-'),
            },
            {
              title: '',
              width: 90,
              render: (_, i) =>
                i.status !== 'CANCELLED' && (
                  <Button size="small" icon={<FileTextOutlined />} onClick={() => setDoc(i.id)}>
                    Invoice
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <BillingInvoiceModal id={doc} onClose={() => setDoc(null)} />
    </Space>
  );
}

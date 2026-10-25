import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Tabs } from 'antd';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';
import { t } from '@/lib/terms';
import { CFG, Kind } from './returns/shared';
import { ReturnList } from './returns/ReturnList';
import { NewReturnModal } from './returns/NewReturnModal';

export default function ReturnsPage() {
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const { me } = useAuth();
  const tab: Kind = params.get('tab') === 'purchase' ? 'purchase' : 'sales';
  const invoiceParam = params.get('invoice') ?? undefined;
  const [open, setOpen] = useState(!!invoiceParam);

  const close = () => {
    setOpen(false);
    if (invoiceParam) setParams({ tab });
  };

  return (
    <>
      <PageHeader
        title={t('Retur')}
        extra={
          (tab === 'sales' ? can('POST', '/sales-returns') : can('POST', '/purchase-returns')) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              {CFG[tab].label} baru
            </Button>
          )
        }
      />
      {me?.businessModel === 'JASA' && tab === 'sales' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Halaman ini untuk bahan yang dikembalikan klien. Untuk mengurangi atau membatalkan tagihan jasa, catat nota kredit lewat Jurnal penyesuaian (Akuntansi › Jurnal penyesuaian)."
        />
      )}
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => setParams({ tab: k })}
          items={(['sales', 'purchase'] as const).map((k) => ({ key: k, label: CFG[k].label, children: <ReturnList kind={k} /> }))}
        />
      </Card>
      <NewReturnModal kind={tab} open={open} initialInvoice={invoiceParam} onClose={close} />
    </>
  );
}

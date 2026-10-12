import { ApiOutlined, DeleteOutlined, LinkOutlined, SyncOutlined } from '@ant-design/icons';
import { BRAND } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Col, Empty, Form, List, Modal, Popconfirm, Row, Select, Space, Switch, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, get, patch, post } from '@/api/client';
import { LEDGER_KEYS, useAction, useWarehouses } from '@/api/queries';
import { t } from '@/lib/terms';

interface ProviderInfo {
  key: 'SHOPEE' | 'TIKTOK' | 'LAZADA' | 'SIMULASI';
  label: string;
  configured: boolean;
  envVars: string[];
  redirectUri: string | null;
}
interface SyncResult {
  importedCount?: number;
  skippedCount?: number;
  fetched?: number;
  waiting?: number;
  imported?: { orderNo: string; invoice: string; total: string }[];
  skipped?: { orderNo: string; reason: string }[];
  cancelledAfterImport?: string[];
}
interface Connection {
  id: string;
  provider: ProviderInfo['key'];
  channel: string;
  shopId: string;
  shopName: string;
  warehouseId: string;
  warehouseName: string;
  pricesIncludeVat: boolean;
  isActive: boolean;
  lastSyncAt: string | null;
  lastResult: SyncResult | null;
  lastError: string | null;
}

const COLORS: Record<ProviderInfo['key'], string> = { SHOPEE: '#EE4D2D', TIKTOK: '#111111', LAZADA: '#0F146D', SIMULASI: BRAND.colors.accent };
const KEYS = ['marketplace', 'invoices', 'stock', ...LEDGER_KEYS];

/** Sinkron pesanan otomatis lewat API marketplace */
export default function MarketplaceSyncTab() {
  const { message, notification } = App.useApp();
  const [params, setParams] = useSearchParams();
  const providers = useQuery({ queryKey: ['marketplace', 'providers'], queryFn: () => get<ProviderInfo[]>('/integrations/marketplace/providers') });
  const conns = useQuery({ queryKey: ['marketplace', 'connections'], queryFn: () => get<Connection[]>('/integrations/marketplace/connections'), refetchInterval: 60_000 });
  const wh = useWarehouses();
  const [adding, setAdding] = useState<ProviderInfo | null>(null);
  const [details, setDetails] = useState<Connection | null>(null);
  const [form] = Form.useForm();

  // kembali dari halaman izin marketplace
  useEffect(() => {
    const ok = params.get('connected');
    const err = params.get('error');
    if (ok) message.success(`Toko ${ok} tersambung. Pesanan akan ditarik otomatis.`);
    if (err) message.error(err, 8);
    if (ok || err) setParams({ tab: 'sync' }, { replace: true });
  }, [params, setParams, message]);

  const start = useAction((v: { provider: string; warehouseId: string; pricesIncludeVat: boolean }) => post<{ url?: string; connected?: boolean }>('/integrations/marketplace/connections', v), {
    invalidate: ['marketplace'],
    onSuccess: (r) => {
      setAdding(null);
      if (r.url) window.location.href = r.url;
      else message.success('Toko tersambung');
    },
  });
  const sync = useAction((id: string) => post<SyncResult & { imported: unknown[] }>(`/integrations/marketplace/connections/${id}/sync`), {
    invalidate: KEYS,
    onSuccess: (r) =>
      notification.success({
        message: 'Sinkron selesai',
        description: `${r.fetched ?? 0} pesanan dibaca · ${r.imported.length} faktur dibuat · ${r.skipped?.length ?? 0} dilewati · ${r.waiting ?? 0} menunggu dikirim`,
      }),
  });
  const update = useAction((v: { id: string } & Partial<Connection>) => patch(`/integrations/marketplace/connections/${v.id}`, { warehouseId: v.warehouseId, pricesIncludeVat: v.pricesIncludeVat, isActive: v.isActive }), {
    invalidate: ['marketplace'],
  });
  const remove = useAction((id: string) => api(`/integrations/marketplace/connections/${id}`, { method: 'DELETE' }), { success: 'Koneksi diputus', invalidate: ['marketplace'] });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Cara kerja sinkron otomatis"
        description={t('Setelah toko tersambung, SANSU menarik pesanan setiap 15 menit. Pesanan yang sudah DIKIRIM otomatis menjadi faktur (stok keluar, HPP, PPN, piutang ke marketplace). Pesanan yang belum dikirim ditunggu, pesanan batal dilewati. SKU di marketplace harus sama dengan SKU produk di SANSU. Pencairan dana tetap dicatat di tab Pesanan marketplace.')}
      />

      <Row gutter={[16, 16]}>
        {(providers.data ?? []).map((p) => (
          <Col xs={24} sm={12} lg={6} key={p.key}>
            <Card size="small" style={{ height: '100%', borderTop: `3px solid ${COLORS[p.key]}` }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  {p.label}
                </Typography.Text>
                {p.configured ? <Tag color="green">Siap disambungkan</Tag> : <Tag>Perlu kunci API partner</Tag>}
                {p.configured ? (
                  <Button type="primary" icon={<LinkOutlined />} block onClick={() => setAdding(p)}>
                    {p.key === 'SIMULASI' ? 'Coba simulasi' : 'Sambungkan toko'}
                  </Button>
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Pemilik server mengisi {p.envVars.join(', ')} setelah mendaftar sebagai partner {p.label}.
                    {p.redirectUri && (
                      <>
                        {' '}
                        URL redirect: <Typography.Text code copyable style={{ fontSize: 11 }}>{p.redirectUri}</Typography.Text>
                      </>
                    )}
                  </Typography.Text>
                )}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="Toko tersambung">
        <List
          loading={conns.isLoading}
          dataSource={conns.data}
          locale={{ emptyText: <Empty description="Belum ada toko tersambung" /> }}
          renderItem={(c) => (
            <List.Item
              actions={[
                <Button key="s" icon={<SyncOutlined />} loading={sync.isPending && sync.variables === c.id} onClick={() => sync.mutate(c.id)}>
                  Sinkron sekarang
                </Button>,
                <Button key="d" type="link" onClick={() => setDetails(c)}>
                  Detail
                </Button>,
                <Popconfirm key="x" title={t('Putuskan toko ini? Faktur yang sudah dibuat tidak terhapus.')} okText="Putuskan" cancelText="Batal" onConfirm={() => remove.mutate(c.id)}>
                  <Button type="text" danger icon={<DeleteOutlined />} aria-label="Putuskan" />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                avatar={<ApiOutlined style={{ fontSize: 22, color: COLORS[c.provider] }} />}
                title={
                  <Space wrap>
                    {c.shopName}
                    <Tag>{c.channel}</Tag>
                    {!c.isActive && <Tag>Nonaktif</Tag>}
                    {c.lastError ? <Tag color="red">Gagal</Tag> : c.lastSyncAt ? <Tag color="green">OK</Tag> : null}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={2}>
                    <span>
                      Stok dari {c.warehouseName} · harga {c.pricesIncludeVat ? 'termasuk' : 'belum termasuk'} PPN ·{' '}
                      {c.lastSyncAt ? `sinkron terakhir ${dayjs(c.lastSyncAt).format('DD MMM HH:mm')}` : 'belum pernah sinkron'}
                      {c.lastResult && !c.lastError && ` · ${c.lastResult.importedCount ?? 0} faktur baru, ${c.lastResult.skippedCount ?? 0} dilewati, ${c.lastResult.waiting ?? 0} menunggu dikirim`}
                    </span>
                    {c.lastError && <Typography.Text type="danger">{c.lastError}</Typography.Text>}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      <Modal
        open={!!adding}
        title={adding ? `Sambungkan ${adding.label}` : ''}
        okText={adding?.key === 'SIMULASI' ? 'Buat toko simulasi' : 'Lanjut ke halaman izin'}
        cancelText="Batal"
        confirmLoading={start.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAdding(null)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={{ warehouseId: wh.data?.[0]?.id, pricesIncludeVat: true }} onFinish={(v) => start.mutate({ ...v, provider: adding!.key })}>
          <Form.Item name="warehouseId" label={t('Stok diambil dari gudang')} rules={[{ required: true }]}>
            <Select options={(wh.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
          </Form.Item>
          <Form.Item name="pricesIncludeVat" valuePropName="checked">
            <Checkbox>Harga jual di marketplace sudah termasuk PPN</Checkbox>
          </Form.Item>
          {adding?.key !== 'SIMULASI' ? (
            <Typography.Paragraph type="secondary">Anda akan diarahkan ke {adding?.label} untuk masuk dengan akun penjual dan memberi izin kepada SANSU membaca pesanan.</Typography.Paragraph>
          ) : (
            <Typography.Paragraph type="secondary">{t('Toko simulasi membuat 1–3 pesanan contoh dari produk Anda setiap kali tombol "Sinkron sekarang" ditekan — untuk mencoba alurnya tanpa akun marketplace.')}</Typography.Paragraph>
          )}
        </Form>
      </Modal>

      <Modal open={!!details} title={details?.shopName} footer={null} onCancel={() => setDetails(null)} width={640}>
        {details && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <span>Sinkron otomatis</span>
              <Switch checked={details.isActive} onChange={(v) => update.mutate({ id: details.id, isActive: v }, { onSuccess: () => setDetails({ ...details, isActive: v }) })} />
            </Space>
            <Select
              style={{ width: '100%' }}
              value={details.warehouseId}
              onChange={(v) => update.mutate({ id: details.id, warehouseId: v }, { onSuccess: () => setDetails({ ...details, warehouseId: v }) })}
              options={(wh.data ?? []).map((w) => ({ value: w.id, label: `Gudang: ${w.code} · ${w.name}` }))}
            />
            {details.lastResult?.imported?.length ? (
              <Card size="small" title={t('Faktur dibuat (sinkron terakhir)')}>
                {details.lastResult.imported.map((i) => (
                  <div key={i.orderNo}>
                    #{i.orderNo} → {i.invoice}
                  </div>
                ))}
              </Card>
            ) : null}
            {details.lastResult?.skipped?.length ? (
              <Card size="small" title="Dilewati">
                {details.lastResult.skipped.map((i) => (
                  <div key={i.orderNo}>
                    #{i.orderNo}: <Typography.Text type="secondary">{i.reason}</Typography.Text>
                  </div>
                ))}
              </Card>
            ) : null}
            {details.lastResult?.cancelledAfterImport?.length ? (
              <Alert type="warning" showIcon message="Dibatalkan setelah dibukukan" description={`Pesanan ${details.lastResult.cancelledAfterImport.join(', ')} dibatalkan di marketplace setelah faktur dibuat. Buat retur penjualan secara manual.`} />
            ) : null}
          </Space>
        )}
      </Modal>
    </Space>
  );
}

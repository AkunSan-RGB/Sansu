import { InboxOutlined, ShopOutlined } from '@ant-design/icons';
import { canHandleMoney } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, AutoComplete, Button, Card, Checkbox, Col, Form, Input, InputNumber, List, Modal, Row, Select, Space, Statistic, Table, Typography, Upload } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction, useWarehouses } from '@/api/queries';
import type { MarketplaceOrderRow } from '@/api/types';
import CashAccountSelect from '@/components/CashAccountSelect';
import { findHeader, type Grid, parseAmount, parseDate, readGrid } from '@/lib/bankParse';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { InvoiceStatusTag } from '../../sales/status';
import { useAuth } from '@/auth/AuthContext';
import { t } from '@/lib/terms';

const CHANNELS = ['Shopee', 'Tokopedia', 'TikTok Shop', 'Lazada', 'Blibli', 'Website'];

type MpMap = { orderNo?: number; date?: number; sku?: number; qty?: number; price?: number };

function guessMp(header: (string | number | null)[]): MpMap {
  const h = header.map((x) => String(x ?? '').toLowerCase());
  const f = (re: RegExp, not?: RegExp) => {
    const i = h.findIndex((c) => re.test(c) && !(not && not.test(c)));
    return i >= 0 ? i : undefined;
  };
  return {
    orderNo: f(/(no\.? ?pesanan|nomor pesanan|order id|order no|invoice|no\. invoice|order number)/),
    date: f(/(waktu pesanan|tanggal pesanan|order date|created time|waktu dibuat|tanggal|date|paid time|waktu pembayaran)/),
    sku: f(/(sku induk|nomor referensi sku|seller sku|sku)/),
    qty: f(/(jumlah|quantity|qty|kuantitas)/, /(harga|total|price)/),
    price: f(/(harga setelah diskon|harga satuan|deal price|unit price|harga jual|price|harga)/, /(total|awal|original)/),
  };
}

export function MarketplaceTab() {
  const money = canHandleMoney(useAuth().me?.role);
  const [channel, setChannel] = useState('Shopee');
  const [grid, setGrid] = useState<Grid>([]);
  const [fileName, setFileName] = useState<string>();
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState<MpMap>({});
  const [inclVat, setInclVat] = useState(true);
  const [warehouseId, setWarehouseId] = useState<string>();
  const [settling, setSettling] = useState(false);
  const [result, setResult] = useState<{ imported: { orderNo: string; invoice: string; total: string }[]; skipped: { orderNo: string; reason: string }[] } | null>(null);
  const [form] = Form.useForm();
  const wh = useWarehouses();
  const channels = useQuery({ queryKey: ['marketplace', 'channels'], queryFn: () => get<{ channel: string; orders: number; open: string }[]>('/integrations/marketplace/channels') });
  const orders = useQuery({ queryKey: ['marketplace', 'orders', channel], queryFn: () => get<MarketplaceOrderRow[]>(`/integrations/marketplace/orders?channel=${encodeURIComponent(channel)}`) });
  const header = grid[headerRow] ?? [];
  const colOptions = header.map((h, i) => ({ value: i, label: `${String.fromCharCode(65 + (i % 26))} · ${String(h ?? '').slice(0, 30)}` }));

  const parsed = useMemo(() => {
    if (!grid.length || map.orderNo === undefined || map.sku === undefined || map.qty === undefined || map.price === undefined || map.date === undefined) return [];
    const byOrder = new Map<string, { orderNo: string; date: string; lines: { sku: string; qty: string; price: string }[] }>();
    for (const r of grid.slice(headerRow + 1)) {
      const no = String(r[map.orderNo] ?? '').trim();
      const sku = String(r[map.sku] ?? '').trim();
      const qty = parseAmount(r[map.qty]);
      const price = parseAmount(r[map.price]);
      const date = parseDate(r[map.date], dayjs().year());
      if (!no || !sku || !qty?.value || !price?.value || !date) continue;
      const o = byOrder.get(no) ?? { orderNo: no, date, lines: [] };
      o.lines.push({ sku, qty: String(qty.value), price: String(price.value) });
      byOrder.set(no, o);
    }
    return [...byOrder.values()];
  }, [grid, headerRow, map]);

  const imp = useAction(
    () => post<typeof result>('/integrations/marketplace/import', { channel, warehouseId: warehouseId ?? wh.data?.[0]?.id, pricesIncludeVat: inclVat, orders: parsed }),
    {
      success: (r) => `${r!.imported.length} pesanan menjadi faktur${r!.skipped.length ? ` · ${r!.skipped.length} dilewati` : ''}`,
      invalidate: ['marketplace', 'invoices', 'stock', ...LEDGER_KEYS],
      onSuccess: (r) => {
        setResult(r);
        setGrid([]);
      },
    },
  );
  const settle = useAction((v: { date: string; cashAccountId: string; amount: number }) => post<{ journalNumber: string; orders: number; fee: string }>('/integrations/marketplace/settle', { ...v, channel, amount: String(v.amount) }), {
    success: (r) => `${r.orders} pesanan lunas · biaya marketplace ${fmtMoney(r.fee)} · jurnal ${r.journalNumber}`,
    invalidate: ['marketplace', 'invoices', ...LEDGER_KEYS],
    onSuccess: () => setSettling(false),
  });
  const open = (orders.data ?? []).filter((o) => o.status !== 'PAID').reduce((a, o) => a + Number(o.total) - Number(o.paidAmount ?? 0), 0);

  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {(channels.data ?? []).map((c) => (
          <Col xs={12} md={6} key={c.channel}>
            <Card size="small" hoverable onClick={() => setChannel(c.channel)} style={{ borderColor: c.channel === channel ? '#111111' : undefined }}>
              <Statistic title={`${c.channel} · ${c.orders} pesanan`} value={Number(c.open)} formatter={(v) => fmtMoney(Number(v))} prefix={<ShopOutlined />} />
              <Typography.Text type="secondary">belum dicairkan</Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>
      <Card title="Impor pesanan" style={{ marginBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <AutoComplete value={channel} onChange={setChannel} options={CHANNELS.map((c) => ({ value: c }))} style={{ width: 180 }} placeholder="Marketplace" />
          <Select
            value={warehouseId ?? wh.data?.[0]?.id}
            onChange={setWarehouseId}
            options={wh.data?.map((w) => ({ value: w.id, label: w.name }))}
            style={{ width: 200 }}
          />
          <Checkbox checked={inclVat} onChange={(e) => setInclVat(e.target.checked)}>
            Harga di file sudah termasuk PPN
          </Checkbox>
        </Space>
        {money && (
          <>
        <Upload.Dragger
          accept=".csv,.xls,.xlsx"
          maxCount={1}
          showUploadList={false}
          beforeUpload={async (f) => {
            const g = await readGrid(f);
            const h = findHeader(g) || g.findIndex((r) => r.some((c) => /pesanan|order/i.test(String(c ?? ''))));
            setGrid(g);
            setFileName(f.name);
            setHeaderRow(Math.max(0, h));
            setMap(guessMp(g[Math.max(0, h)] ?? []));
            setResult(null);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p>{fileName ?? 'Seret file ekspor pesanan (Excel/CSV) dari Seller Center ke sini'}</p>
          <Typography.Text type="secondary">{t('Satu baris per produk; pesanan dengan nomor sama digabung. SKU harus sama dengan SKU di SANSU.')}</Typography.Text>
        </Upload.Dragger>
        {grid.length > 0 && (
          <>
            <Space wrap style={{ marginTop: 12 }}>
              <span>Baris judul</span>
              <InputNumber min={1} value={headerRow + 1} onChange={(v) => v && (setHeaderRow(v - 1), setMap(guessMp(grid[v - 1] ?? [])))} />
              {(
                [
                  ['orderNo', 'No. pesanan'],
                  ['date', 'Tanggal'],
                  ['sku', 'SKU'],
                  ['qty', 'Jumlah'],
                  ['price', 'Harga satuan'],
                ] as const
              ).map(([k, label]) => (
                <Space key={k} size={4}>
                  <span>{label}</span>
                  <Select value={map[k]} onChange={(v) => setMap((m) => ({ ...m, [k]: v }))} options={colOptions} style={{ width: 180 }} />
                </Space>
              ))}
            </Space>
            <Alert
              style={{ marginTop: 12 }}
              type={parsed.length ? 'info' : 'warning'}
              showIcon
              message={parsed.length ? `${parsed.length} pesanan siap diimpor (${parsed.reduce((a, o) => a + o.lines.length, 0)} baris produk)` : 'Lengkapi pemetaan kolom'}
              action={
                <Button type="primary" disabled={!parsed.length} loading={imp.isPending} onClick={() => imp.mutate(undefined)}>
                  Impor jadi faktur
                </Button>
              }
            />
          </>
        )}
        {result && (
          <Alert
            style={{ marginTop: 12 }}
            type={result.skipped.length ? 'warning' : 'success'}
            showIcon
            message={`${result.imported.length} pesanan diimpor, ${result.skipped.length} dilewati`}
            description={
              result.skipped.length ? (
                <List size="small" dataSource={result.skipped.slice(0, 10)} renderItem={(s) => <List.Item>{`${s.orderNo}: ${s.reason}`}</List.Item>} />
              ) : undefined
            }
          />
        )}
          </>
        )}
      </Card>
      <Card
        title={`Pesanan ${channel}`}
        extra={
          money && (
          <Button
            type="primary"
            disabled={open <= 0}
            onClick={() => {
              form.setFieldsValue({ date: today(), amount: undefined });
              setSettling(true);
            }}
          >
            Catat pencairan dana
          </Button>
          )
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={orders.isLoading}
          dataSource={orders.data}
          scroll={{ x: 700 }}
          columns={[
            { title: 'No. pesanan', dataIndex: 'orderNo' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: t('Faktur'), dataIndex: 'invoiceNumber' },
            { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
            { title: 'Status', dataIndex: 'status', render: (s) => s && <InvoiceStatusTag status={s} /> },
          ]}
        />
      </Card>
      <Modal title={`Pencairan dana ${channel}`} open={settling} onCancel={() => setSettling(false)} onOk={() => form.submit()} confirmLoading={settle.isPending} okText="Posting">
        <Typography.Paragraph type="secondary">
          Isi dana yang masuk ke rekening. SANSU melunasi pesanan terlama yang belum cair; selisihnya dicatat sebagai beban komisi & layanan marketplace. Tagihan terbuka:{' '}
          <strong>{fmtMoney(open)}</strong>.
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(v) => settle.mutate(v)}>
          <Form.Item name="date" label="Tanggal dana masuk" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="cashAccountId" label="Rekening" rules={[{ required: true }]}>
            <CashAccountSelect />
          </Form.Item>
          <Form.Item name="amount" label="Dana diterima" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

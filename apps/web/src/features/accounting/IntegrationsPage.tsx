import { CloudDownloadOutlined, InboxOutlined, ShopOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { download, get, post, api } from '@/api/client';
import { LEDGER_KEYS, useAction, useWarehouses } from '@/api/queries';
import type { CoretaxPreview, IntegrationSettings, MarketplaceOrderRow } from '@/api/types';
import { useApps } from '@/lib/apps';
import CashAccountSelect from '@/components/CashAccountSelect';
import PageHeader from '@/layout/PageHeader';
import { findHeader, type Grid, parseAmount, parseDate, readGrid } from '@/lib/bankParse';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { InvoiceStatusTag } from '../sales/status';
import MarketplaceSyncTab from './MarketplaceSyncTab';
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

function MarketplaceTab() {
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
            <Card size="small" hoverable onClick={() => setChannel(c.channel)} style={{ borderColor: c.channel === channel ? '#1677ff' : undefined }}>
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
          <Typography.Text type="secondary">Satu baris per produk; pesanan dengan nomor sama digabung. SKU harus sama dengan SKU di SANSU.</Typography.Text>
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
      </Card>
      <Card
        title={`Pesanan ${channel}`}
        extra={
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

function CoretaxTab() {
  const [from, setFrom] = useState(dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD'));
  const [selected, setSelected] = useState<string[]>([]);
  const [units, setUnits] = useState<Record<string, string>>({});
  const conf = useQuery({ queryKey: ['integrations', 'settings'], queryFn: () => get<IntegrationSettings>('/integrations/settings') });
  const pre = useQuery({ queryKey: ['integrations', 'coretax', from, to], queryFn: () => get<CoretaxPreview>(`/integrations/coretax/preview?from=${from}&to=${to}`) });
  const saveUnits = useAction(() => api('/integrations/settings', { method: 'PUT', json: { coretaxUnits: units } }), { success: 'Kode satuan disimpan', invalidate: ['integrations'] });
  const dl = useAction(
    () =>
      download(
        `/integrations/coretax/faktur-keluaran.xml?from=${from}&to=${to}${selected.length ? `&ids=${selected.join(',')}` : ''}`,
        `faktur-keluaran-${from.slice(0, 7)}.xml`,
      ),
    { success: 'File XML diunduh — impor di Coretax: e-Faktur → Pajak Keluaran → Impor Data' },
  );
  const d = pre.data;
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Ekspor faktur penjualan & uang muka ber-PPN ke file XML Coretax"
        description="Unggah file di Coretax DJP (e-Faktur → Pajak Keluaran → Impor Data), periksa draf, lalu tanda tangani. Format mengikuti template XML impor faktur keluaran DJP (TrxCode 04, DPP nilai lain 11/12 untuk PPN 12%). Selalu cek ulang dengan template terbaru di pajak.go.id."
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>s/d</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button type="primary" icon={<CloudDownloadOutlined />} disabled={!d?.count || d.problems.length > 0} loading={dl.isPending} onClick={() => dl.mutate(undefined)}>
          Unduh XML {selected.length ? `(${selected.length} faktur)` : d ? `(${d.count} faktur)` : ''}
        </Button>
      </Space>
      {d?.problems.map((p) => (
        <Alert key={p} type="warning" showIcon message={p} style={{ marginBottom: 8 }} />
      ))}
      {d?.warnings?.map((p) => (
        <Alert key={p} type="info" showIcon message={p} style={{ marginBottom: 8 }} />
      ))}
      {d && d.units.length > 0 && (
        <Card size="small" title="Kode satuan Coretax" style={{ marginBottom: 12 }}>
          <Typography.Paragraph type="secondary">
            Coretax memakai kode satuan resmi (UM.00xx). Isi sekali per satuan barang — lihat daftar kode di sheet referensi converter e-Faktur Coretax dari DJP.
          </Typography.Paragraph>
          <Space wrap>
            {d.units.map((u) => (
              <Input
                key={u}
                prefix={u}
                placeholder="UM.00xx"
                style={{ width: 200 }}
                value={units[u] ?? conf.data?.coretaxUnits[u] ?? ''}
                onChange={(e) => setUnits((x) => ({ ...x, [u]: e.target.value.trim().toUpperCase() }))}
              />
            ))}
            <Button onClick={() => saveUnits.mutate(undefined)} loading={saveUnits.isPending}>
              Simpan
            </Button>
          </Space>
        </Card>
      )}
      <Table
        rowKey="id"
        size="small"
        loading={pre.isLoading}
        dataSource={d?.invoices}
        rowSelection={{ selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]) }}
        scroll={{ x: 900 }}
        columns={[
          {
            title: t('Faktur'),
            dataIndex: 'number',
            render: (v: string, r) =>
              r.kind === 'DEPOSIT' ? (
                <>
                  {v} <Tag color="blue">Uang muka</Tag>
                </>
              ) : Number(r.depositDpp ?? 0) > 0 ? (
                <>
                  {v} <Tag color="purple">Pelunasan − DPP uang muka {fmtMoney(r.depositDpp)}</Tag>
                </>
              ) : (
                v
              ),
          },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: 'Pembeli', dataIndex: 'customer' },
          { title: 'Identitas', render: (_, r) => (r.buyerType === 'NPWP' ? <Tag color="green">NPWP {r.npwp}</Tag> : <Tag color="orange">Tanpa NPWP</Tag>) },
          { title: 'DPP', dataIndex: 'subtotal', align: 'right', render: fmtMoney },
          { title: 'PPN', dataIndex: 'taxAmount', align: 'right', render: fmtMoney },
        ]}
      />
    </>
  );
}

export default function IntegrationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = ['coretax', 'sync'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'marketplace';
  const { can } = useApps();
  const { me } = useAuth();
  const isFinance = !!me && ['OWNER', 'ADMIN', 'FINANCE'].includes(me.role);
  return (
    <>
      <PageHeader title="Integrasi: Marketplace & Coretax" />
      <Tabs
        activeKey={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        items={[
          { key: 'marketplace', label: 'Pesanan marketplace', children: <MarketplaceTab /> },
          ...(isFinance ? [{ key: 'sync', label: 'Sinkron otomatis', children: <MarketplaceSyncTab /> }] : []),
          ...(can('accounting') ? [{ key: 'coretax', label: 'e-Faktur Coretax', children: <CoretaxTab /> }] : []),
        ]}
      />
    </>
  );
}

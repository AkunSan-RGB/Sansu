import {
  AppstoreOutlined,
  BarcodeOutlined,
  DeleteOutlined,
  LockOutlined,
  MinusOutlined,
  PlusOutlined,
  PrinterOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { BRAND, POS_ORDER_TYPE_LABELS, POS_ORDER_TYPES, POS_PAYMENT_LABELS, type PosOrderType, type PosPaymentMethod } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Form,
  Grid,
  Input,
  InputNumber,
  type InputRef,
  Modal,
  Result,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAction, useCustomers, useWarehouses } from '@/api/queries';
import type { PosOrder, PosProduct, PosSession } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { LogoMark } from '@/brand/Logo';
import CashAccountSelect from '@/components/CashAccountSelect';
import DenominationCounter, { denomTotal, type Denoms } from '@/components/DenominationCounter';
import { fmtMoney, fmtQty } from '@/lib/format';
import Receipt, { printReceipt } from './Receipt';
import { posTax, vatTotals } from '@/lib/vat';
import { t } from '@/lib/terms';

interface CartLine {
  product: PosProduct;
  uom: string;
  factor: number;
  qty: number;
  unitPrice: number; // per uom (belum PPN, atau sudah termasuk PPN bila harga kasir termasuk PPN)
  discountPct: number;
}

const lineTotal = (l: CartLine) => Math.round(l.qty * l.unitPrice * (100 - l.discountPct)) / 100;
const QUICK_CASH = [10_000, 20_000, 50_000, 100_000];

// ---------- Buka sesi ----------
function OpenSession() {
  const { data: warehouses } = useWarehouses();
  const [form] = Form.useForm();
  const qc = useQueryClient();
  useEffect(() => {
    if (warehouses?.length && !form.getFieldValue('warehouseId')) form.setFieldValue('warehouseId', warehouses[0].id);
  }, [warehouses, form]);
  const open = useAction(
    (v: { warehouseId: string; cashAccountId?: string; bankAccountId?: string; openingCash: number }) =>
      post<PosSession>('/pos/sessions', { ...v, openingCash: String(v.openingCash ?? 0) }),
    { success: (s) => `Sesi ${s.number} dibuka`, onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-session'] }) },
  );
  return (
    <div style={{ maxWidth: 460, margin: '48px auto', padding: 16 }}>
      <Card title="Buka kasir">
        <Typography.Paragraph type="secondary">Hitung uang modal di laci sebelum mulai berjualan.</Typography.Paragraph>
        <Form form={form} layout="vertical" initialValues={{ openingCash: 0 }} onFinish={(v) => open.mutate(v)}>
          <Form.Item name="warehouseId" label={t('Toko / gudang (stok diambil dari sini)')} rules={[{ required: true }]}>
            <Select options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
          </Form.Item>
          <Form.Item name="openingCash" label="Modal awal di laci">
            <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" size="large" />
          </Form.Item>
          <Form.Item name="cashAccountId" label="Akun kas laci" extra="Kosongkan = Kas">
            <CashAccountSelect allowClear />
          </Form.Item>
          <Form.Item name="bankAccountId" label="Rekening QRIS / debit / transfer" extra="Kosongkan = Bank">
            <CashAccountSelect allowClear />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={open.isPending}>
            Mulai jualan
          </Button>
        </Form>
      </Card>
    </div>
  );
}

// ---------- Tutup sesi ----------
function CloseSession({ session, open, onClose }: { session: PosSession; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [counted, setCounted] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [byDenom, setByDenom] = useState(false);
  const [denoms, setDenoms] = useState<Denoms>({});
  const [result, setResult] = useState<(PosSession & { journalNumber?: string }) | null>(null);
  const s = session.summary!;
  const close = useAction(
    () => post<PosSession & { journalNumber?: string }>(`/pos/sessions/${session.id}/close`, { countedCash: String(counted ?? 0), notes: notes || undefined }),
    { invalidate: LEDGER_KEYS, onSuccess: setResult },
  );
  const diff = (counted ?? 0) - Number(s.expectedCash);
  return (
    <Modal
      title={`Tutup kasir ${session.number}`}
      open={open}
      onCancel={() => (result ? qc.invalidateQueries({ queryKey: ['pos-session'] }) : onClose())}
      footer={
        result ? (
          <Button type="primary" onClick={() => qc.invalidateQueries({ queryKey: ['pos-session'] })}>
            Selesai
          </Button>
        ) : (
          <Space>
            <Button onClick={onClose}>Batal</Button>
            <Button type="primary" danger icon={<LockOutlined />} disabled={counted === null} loading={close.isPending} onClick={() => close.mutate(undefined)}>
              Tutup kasir
            </Button>
          </Space>
        )
      }
    >
      {result ? (
        <Result
          status={Number(result.difference) === 0 ? 'success' : 'warning'}
          title={Number(result.difference) === 0 ? 'Kas cocok' : `Selisih ${fmtMoney(result.difference)}`}
          subTitle={result.journalNumber ? `Selisih dijurnal ke "Selisih Kas Kasir" (${result.journalNumber})` : 'Sesi ditutup tanpa selisih'}
        />
      ) : (
        <>
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Transaksi">{s.orderCount}</Descriptions.Item>
            <Descriptions.Item label={t('Total penjualan')}>{fmtMoney(s.totalSales)}</Descriptions.Item>
            {(Object.keys(s.byMethod) as PosPaymentMethod[]).map((m) => (
              <Descriptions.Item key={m} label={POS_PAYMENT_LABELS[m]}>
                {fmtMoney(s.byMethod[m])}
              </Descriptions.Item>
            ))}
            <Descriptions.Item label="Modal awal">{fmtMoney(session.openingCash)}</Descriptions.Item>
            <Descriptions.Item label={<strong>Tunai seharusnya di laci</strong>}>
              <strong>{fmtMoney(s.expectedCash)}</strong>
            </Descriptions.Item>
          </Descriptions>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Typography.Text strong>Uang tunai yang Anda hitung</Typography.Text>
            <Segmented
              size="small"
              value={byDenom ? 'p' : 't'}
              onChange={(v) => {
                setByDenom(v === 'p');
                if (v === 'p') setCounted(denomTotal(denoms) || null);
              }}
              options={[
                { value: 't', label: 'Total' },
                { value: 'p', label: 'Per pecahan' },
              ]}
            />
          </div>
          {byDenom && (
            <div style={{ maxHeight: 320, overflowY: 'auto', margin: '8px 0' }}>
              <DenominationCounter
                compact
                value={denoms}
                onChange={(d) => {
                  setDenoms(d);
                  setCounted(denomTotal(d));
                }}
              />
            </div>
          )}
          <InputNumber min={0} value={counted} onChange={setCounted} disabled={byDenom} style={{ width: '100%', margin: '6px 0 8px' }} size="large" prefix="Rp" autoFocus />
          {counted !== null && (
            <Alert
              type={diff === 0 ? 'success' : 'warning'}
              showIcon
              message={diff === 0 ? 'Cocok' : diff < 0 ? `Kurang ${fmtMoney(-diff)}` : `Lebih ${fmtMoney(diff)}`}
              style={{ marginBottom: 8 }}
            />
          )}
          <Input placeholder="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </>
      )}
    </Modal>
  );
}

// ---------- Layar kasir ----------
function Register({ session }: { session: PosSession }) {
  const { me } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const searchRef = useRef<InputRef>(null);
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string>('Semua');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string>();
  const fnb = me?.businessModel === 'FNB';
  const [orderType, setOrderType] = useState<PosOrderType>('DINE_IN');
  const [tableLabel, setTableLabel] = useState('');
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<PosPaymentMethod>('CASH');
  const [amount, setAmount] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<PosOrder | null>(null);
  const [closing, setClosing] = useState(false);
  const { data: customers } = useCustomers();

  const products = useQuery({
    queryKey: ['pos-products', session.warehouse.id],
    queryFn: () => get<PosProduct[]>(`/pos/products${qs({ warehouseId: session.warehouse.id })}`),
  });
  const { rate: ppnRate, label: taxLabel } = posTax(me);
  const inclusive = !!me?.taxProfile?.posPricesIncludeVat && ppnRate > 0;
  const categories = ['Semua', ...new Set((products.data ?? []).map((p) => p.category ?? 'Lainnya'))];
  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (products.data ?? []).filter(
      (p) =>
        (category === 'Semua' || (p.category ?? 'Lainnya') === category) &&
        (!t || p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t) || p.barcode === term.trim()),
    );
  }, [products.data, term, category]);

  const add = (p: PosProduct, uom = p.baseUom) => {
    const factor = uom === p.baseUom ? 1 : Number(p.uoms.find((u) => u.uom === uom)?.factor ?? 1);
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id && l.uom === uom);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { product: p, uom, factor, qty: 1, unitPrice: Number(p.sellPrice) * factor, discountPct: 0 }];
    });
  };
  const setQty = (i: number, qty: number) => setCart((c) => (qty <= 0 ? c.filter((_, j) => j !== i) : c.map((l, j) => (j === i ? { ...l, qty } : l))));

  const onSearchEnter = () => {
    const t = term.trim();
    if (!t) return;
    const exact = products.data?.find((p) => p.barcode === t || p.sku.toLowerCase() === t.toLowerCase());
    const pick = exact ?? (shown.length === 1 ? shown[0] : undefined);
    if (pick) {
      add(pick);
      setTerm('');
    } else message.warning(`Produk "${t}" tidak ditemukan`);
  };

  const { subtotal, tax, total } = vatTotals(
    cart.reduce((a, l) => a + lineTotal(l), 0),
    ppnRate,
    inclusive,
  );
  const change = method === 'CASH' ? Math.max(0, (amount ?? 0) - total) : 0;
  const enough = method === 'CASH' ? (amount ?? 0) >= total : true;

  const pay = useAction(
    () =>
      post<PosOrder>('/pos/orders', {
        sessionId: session.id,
        customerId,
        ...(fnb ? { orderType, tableLabel: tableLabel.trim() || undefined } : {}),
        lines: cart.map((l) => ({ productId: l.product.id, uom: l.uom, qty: String(l.qty), price: String(l.unitPrice), discountPct: String(l.discountPct) })),
        payments: [{ method, amount: (method === 'CASH' ? (amount ?? 0) : total).toFixed(2) }],
      }),
    {
      invalidate: ['pos-products', 'stock', ...LEDGER_KEYS],
      onSuccess: (o) => {
        setPaying(false);
        setCart([]);
        setCustomerId(undefined);
        setTableLabel('');
        setReceipt(o);
        qc.invalidateQueries({ queryKey: ['pos-session'] });
      },
    },
  );

  // F2 = cari, F9 = bayar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'F9' && cart.length && !paying) {
        e.preventDefault();
        setMethod('CASH');
        setAmount(null);
        setPaying(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart.length, paying]);

  const cartPanel = (
    <Card
      title={`Keranjang (${cart.reduce((a, l) => a + l.qty, 0)})`}
      extra={cart.length > 0 && <Button type="text" danger size="small" onClick={() => setCart([])}>Kosongkan</Button>}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', padding: 12, minHeight: 0 } }}
    >
      {fnb && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <Segmented size="small" value={orderType} onChange={(v) => setOrderType(v as PosOrderType)} options={POS_ORDER_TYPES.map((k) => ({ value: k, label: POS_ORDER_TYPE_LABELS[k] }))} />
          <Input size="small" allowClear maxLength={40} placeholder="Meja / nama pemesan" value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
        </div>
      )}
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder={t('Pelanggan umum')}
        value={customerId}
        onChange={setCustomerId}
        options={customers?.filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
        style={{ marginBottom: 8 }}
      />
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 120 }}>
        {cart.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Scan barcode atau klik produk')} />
        ) : (
          cart.map((l, i) => (
            <div key={`${l.product.id}-${l.uom}`} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <Typography.Text strong ellipsis style={{ flex: 1 }}>
                  {l.product.name}
                </Typography.Text>
                <Typography.Text strong>{fmtMoney(lineTotal(l))}</Typography.Text>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Button size="small" icon={<MinusOutlined />} onClick={() => setQty(i, l.qty - 1)} />
                <InputNumber size="small" min={0} value={l.qty} onChange={(v) => setQty(i, Number(v ?? 0))} style={{ width: 64 }} />
                <Button size="small" icon={<PlusOutlined />} onClick={() => setQty(i, l.qty + 1)} />
                {l.product.uoms.length > 0 ? (
                  <Select
                    size="small"
                    value={l.uom}
                    style={{ width: 80 }}
                    options={[l.product.baseUom, ...l.product.uoms.map((u) => u.uom)].map((u) => ({ value: u, label: u }))}
                    onChange={(u) => {
                      const factor = u === l.product.baseUom ? 1 : Number(l.product.uoms.find((x) => x.uom === u)?.factor ?? 1);
                      setCart((c) => c.map((x, j) => (j === i ? { ...x, uom: u, factor, unitPrice: Number(l.product.sellPrice) * factor } : x)));
                    }}
                  />
                ) : (
                  <Typography.Text type="secondary">{l.uom}</Typography.Text>
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
                  @{fmtMoney(l.unitPrice)}
                </Typography.Text>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setQty(i, 0)} />
              </div>
            </div>
          ))
        )}
      </div>
      <Divider style={{ margin: '8px 0' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 2 }}>
        {ppnRate > 0 && (
          <>
            <span>{inclusive ? 'DPP' : 'Subtotal'}</span>
            <span>{fmtMoney(subtotal)}</span>
            <span>
              {taxLabel} {ppnRate}%{inclusive && ' (sudah termasuk)'}
            </span>
            <span>{fmtMoney(tax)}</span>
          </>
        )}
        <Typography.Title level={3} style={{ margin: '6px 0 0' }}>
          Total
        </Typography.Title>
        <Typography.Title level={3} style={{ margin: '6px 0 0', color: BRAND.colors.primary }}>
          {fmtMoney(total)}
        </Typography.Title>
      </div>
      <Button
        type="primary"
        size="large"
        block
        disabled={!cart.length}
        style={{ marginTop: 12, height: 56, fontSize: 18 }}
        onClick={() => {
          setMethod('CASH');
          setAmount(null);
          setPaying(true);
        }}
      >
        Bayar (F9)
      </Button>
    </Card>
  );

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: BRAND.colors.surface }}>
      <div
        style={{ background: BRAND.colors.ink, color: '#fff', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        className="no-print"
      >
        <Button type="text" icon={<AppstoreOutlined style={{ color: '#fff' }} />} onClick={() => navigate('/')} aria-label="Semua aplikasi" />
        <LogoMark size={26} tone="light" />
        <Typography.Text strong style={{ color: '#fff' }}>
          Kasir · {session.warehouse.name}
        </Typography.Text>
        <Tag color="gold">{session.number}</Tag>
        <span style={{ flex: 1 }} />
        {screens.md && (
          <Typography.Text style={{ color: '#cbd5e1' }}>
            {me?.name} · {session.summary?.orderCount ?? 0} transaksi · {fmtMoney(session.summary?.totalSales)}
          </Typography.Text>
        )}
        <Button icon={<LockOutlined />} onClick={() => setClosing(true)}>
          Tutup kasir
        </Button>
      </div>

      <Row gutter={12} style={{ flex: 1, padding: 12, minHeight: 0, margin: 0 }} className="no-print">
        <Col xs={24} md={14} lg={16} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Input
            ref={searchRef}
            autoFocus
            size="large"
            prefix={<SearchOutlined />}
            suffix={<BarcodeOutlined />}
            placeholder="Scan barcode / ketik nama atau SKU lalu Enter (F2)"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onPressEnter={onSearchEnter}
            style={{ marginBottom: 8 }}
          />
          <Segmented options={categories} value={category} onChange={(v) => setCategory(String(v))} style={{ marginBottom: 8, overflowX: 'auto' }} />
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 200 }}>
            {products.isLoading ? (
              <Spin />
            ) : (
              <Row gutter={[8, 8]}>
                {shown.map((p) => {
                  const stock = Number(p.stock);
                  return (
                    <Col key={p.id} xs={12} sm={8} lg={6} xl={4}>
                      <Badge.Ribbon text={p.madeToOrder ? `${fmtQty(stock)} porsi` : fmtQty(stock)} color={stock > 0 ? 'cyan' : 'red'}>
                        <Card hoverable size="small" onClick={() => add(p)} style={{ height: 104 }} styles={{ body: { padding: 10 } }}>
                          <Typography.Paragraph strong ellipsis={{ rows: 2 }} style={{ marginBottom: 4, minHeight: 44, paddingRight: 24 }}>
                            {p.name}
                          </Typography.Paragraph>
                          <Typography.Text style={{ color: BRAND.colors.primary, fontWeight: 600 }}>{fmtMoney(p.sellPrice)}</Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            {' '}
                            /{p.baseUom}
                          </Typography.Text>
                        </Card>
                      </Badge.Ribbon>
                    </Col>
                  );
                })}
              </Row>
            )}
          </div>
        </Col>
        <Col xs={24} md={10} lg={8} style={{ display: 'flex', flexDirection: 'column', minHeight: screens.md ? 0 : 420, marginTop: screens.md ? 0 : 12 }}>
          {cartPanel}
        </Col>
      </Row>

      <Modal title="Pembayaran" open={paying} onCancel={() => setPaying(false)} footer={null} width={460} destroyOnHidden>
        <Typography.Title level={2} style={{ textAlign: 'center', margin: '4px 0 16px', color: BRAND.colors.primary }}>
          {fmtMoney(total)}
        </Typography.Title>
        <Segmented
          block
          size="large"
          value={method}
          onChange={(v) => setMethod(v as PosPaymentMethod)}
          options={(Object.keys(POS_PAYMENT_LABELS) as PosPaymentMethod[]).map((m) => ({ value: m, label: POS_PAYMENT_LABELS[m] }))}
          style={{ marginBottom: 16 }}
        />
        {method === 'CASH' ? (
          <>
            <InputNumber
              autoFocus
              size="large"
              min={0}
              value={amount}
              onChange={setAmount}
              style={{ width: '100%' }}
              prefix="Uang diterima"
              onPressEnter={() => enough && pay.mutate(undefined)}
            />
            <Space wrap style={{ margin: '10px 0' }}>
              <Button onClick={() => setAmount(total)}>Uang pas</Button>
              {QUICK_CASH.filter((q) => q >= total || q === 100_000).map((q) => (
                <Button key={q} onClick={() => setAmount(q)}>
                  {fmtMoney(q)}
                </Button>
              ))}
            </Space>
            <Alert
              type={enough ? 'success' : 'warning'}
              showIcon
              message={enough ? `Kembalian ${fmtMoney(change)}` : `Kurang ${fmtMoney(total - (amount ?? 0))}`}
            />
          </>
        ) : (
          <Alert type="info" showIcon message={`Pastikan pembayaran ${POS_PAYMENT_LABELS[method]} sebesar ${fmtMoney(total)} sudah masuk.`} />
        )}
        <Button type="primary" size="large" block style={{ marginTop: 16, height: 52 }} disabled={!enough} loading={pay.isPending} onClick={() => pay.mutate(undefined)}>
          Selesaikan transaksi
        </Button>
      </Modal>

      <Modal
        title="Transaksi berhasil"
        open={!!receipt}
        onCancel={() => {
          setReceipt(null);
          searchRef.current?.focus();
        }}
        footer={
          <Space>
            <Button icon={<PrinterOutlined />} onClick={printReceipt}>
              Cetak struk
            </Button>
            <Button
              type="primary"
              onClick={() => {
                setReceipt(null);
                searchRef.current?.focus();
              }}
            >
              Transaksi baru
            </Button>
          </Space>
        }
        width={380}
      >
        {receipt && (
          <>
            {Number(receipt.change) > 0 && (
              <Alert type="success" showIcon style={{ marginBottom: 12 }} message={<strong>Kembalian {fmtMoney(receipt.change)}</strong>} />
            )}
            <Receipt order={receipt} company={me?.tenantName ?? ''} cashier={me?.name ?? ''} warehouse={session.warehouse.name} />
          </>
        )}
      </Modal>

      {session.summary && <CloseSession session={session} open={closing} onClose={() => setClosing(false)} />}
    </div>
  );
}

/** Kasir layar penuh: buka sesi → jual → tutup kasir */
export default function PosPage() {
  const { data, isLoading } = useQuery({ queryKey: ['pos-session'], queryFn: () => get<PosSession | null>('/pos/sessions/current') });
  if (isLoading) return <Spin fullscreen />;
  return data ? <Register session={data} /> : <OpenSession />;
}

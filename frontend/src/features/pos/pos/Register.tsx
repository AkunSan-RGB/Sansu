import { AppstoreOutlined, BarcodeOutlined, DeleteOutlined, LockOutlined, MinusOutlined, PlusOutlined, PrinterOutlined, SearchOutlined } from '@ant-design/icons';
import { BRAND, POS_CASHIER_PAYMENT_METHODS, POS_ORDER_TYPE_LABELS, POS_ORDER_TYPES, POS_PAYMENT_LABELS, type PosOrderType, type PosPaymentMethod } from '@sansu/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Badge, Button, Card, Col, Divider, Empty, Grid, Input, InputNumber, type InputRef, Modal, Row, Segmented, Select, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAction, useCustomers } from '@/api/queries';
import type { PosOrder, PosProduct, PosSession } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { LogoMark } from '@/brand/Logo';
import { fmtMoney, fmtQty } from '@/lib/format';
import Receipt, { printReceipt } from '../Receipt';
import { posTax, vatTotals } from '@/lib/vat';
import { t } from '@/lib/terms';
import { CloseSession } from './CloseSession';
import { addToCart, applyQuote, checkAdd, lineTotal, loyaltyMath, paymentMath, setCartQty, type CartLine, type LoyaltyCfg, type QuoteLine } from './posCart';

const QUICK_CASH = [10_000, 20_000, 50_000, 100_000];

// ---------- Layar kasir ----------
export function Register({ session }: { session: PosSession }) {
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
  const [redeem, setRedeem] = useState<number | null>(null);
  const loyaltyCfg = useQuery({ queryKey: ['loyalty-settings'], queryFn: () => get<LoyaltyCfg>('/loyalty/settings'), staleTime: 60_000 });
  const member = useQuery({ queryKey: ['loyalty-member', customerId], queryFn: () => get<{ balance: number; valueRp: number }>(`/loyalty/members/${customerId}`), enabled: !!customerId && !!loyaltyCfg.data?.enabled });
  const [receipt, setReceipt] = useState<PosOrder | null>(null);
  const [closing, setClosing] = useState(false);
  const { data: customers } = useCustomers();

  const products = useQuery({
    queryKey: ['pos-products', session.warehouse.id],
    queryFn: () => get<PosProduct[]>(`/pos/products${qs({ warehouseId: session.warehouse.id })}`),
  });
  // harga & potongan dari server (daftar harga toko/pelanggan + promo aktif); server juga memeriksa ulang saat bayar
  const cartKey = cart.map((l) => `${l.product.id}|${l.uom}|${l.qty}`).join(',');
  const quoted = useQuery({
    queryKey: ['pos-quote', session.id, customerId ?? null, cartKey],
    queryFn: () => post<{ lines: QuoteLine[] }>('/pos/quote', { sessionId: session.id, customerId, lines: cart.map((l) => ({ productId: l.product.id, uom: l.uom, qty: String(l.qty) })) }),
    enabled: cart.length > 0,
    placeholderData: keepPreviousData,
  });
  const priced = useMemo(() => applyQuote(cart, quoted.data?.lines), [cart, quoted.data]);
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
    const check = checkAdd(p, uom, cart);
    if (!check.ok) {
      message.warning(check.message);
      return;
    }
    setCart((c) => addToCart(c, p, uom, check.factor));
  };
  const setQty = (i: number, qty: number) => setCart((c) => setCartQty(c, i, qty));

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
    priced.reduce((a, l) => a + lineTotal(l), 0),
    ppnRate,
    inclusive,
  );
  // poin loyalitas: potongan dihitung dari aturan; server memeriksa ulang saldo dan batas
  const cfg = loyaltyCfg.data;
  const balance = member.data?.balance ?? 0;
  const { maxRedeem, redeemPts, redeemValue, payable, willEarn } = loyaltyMath({ cfg, customerId, balance, redeem, total });
  const { change, enough } = paymentMath(method, amount, payable);

  const pay = useAction(
    () =>
      post<PosOrder>('/pos/orders', {
        sessionId: session.id,
        customerId,
        redeemPoints: redeemPts || undefined,
        ...(fnb ? { orderType, tableLabel: tableLabel.trim() || undefined } : {}),
        lines: priced.map((l) => ({ productId: l.product.id, uom: l.uom, qty: String(l.qty), price: String(l.unitPrice), discountPct: String(l.discountPct) })),
        payments: [{ method, amount: (method === 'CASH' ? (amount ?? 0) : payable).toFixed(2) }],
      }),
    {
      invalidate: ['pos-products', 'stock', ...LEDGER_KEYS],
      onSuccess: (o) => {
        setPaying(false);
        setCart([]);
        setCustomerId(undefined);
        setTableLabel('');
        setReceipt(o);
        setRedeem(null);
        const earned = (o as { loyaltyEarnedPoints?: number }).loyaltyEarnedPoints;
        if (earned) message.success(`Pelanggan memperoleh ${earned} poin`);
        void qc.invalidateQueries({ queryKey: ['pos-session'] });
        void qc.invalidateQueries({ queryKey: ['loyalty-member'] });
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
        onChange={(v) => { setCustomerId(v); setRedeem(null); }}
        options={customers?.filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
        style={{ marginBottom: 8 }}
      />
      {cfg?.enabled && customerId && member.data && <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Poin tersedia {member.data.balance} (≈ {fmtMoney(member.data.valueRp)})</Typography.Text>}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 120 }}>
        {cart.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Scan barcode atau klik produk')} />
        ) : (
          priced.map((l, i) => (
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
                  {l.discountPct > 0 && <Tag color="green" style={{ marginLeft: 6, marginRight: 0 }}>{l.promoName ?? 'Promo'} −{l.discountPct}%</Tag>}
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
                        <Card hoverable size="small" onClick={() => add(p)} style={{ height: 104, ...(Number(p.sellPrice) <= 0 ? { opacity: 0.55 } : {}) }} styles={{ body: { padding: 10 } }}>
                          <Typography.Paragraph strong ellipsis={{ rows: 2 }} style={{ marginBottom: 4, minHeight: 44, paddingRight: 24 }}>
                            {p.name}
                          </Typography.Paragraph>
                          {Number(p.sellPrice) <= 0 ? (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Belum ada harga</Typography.Text>
                          ) : (
                            <Typography.Text style={{ color: BRAND.colors.primary, fontWeight: 600 }}>{fmtMoney(p.sellPrice)}</Typography.Text>
                          )}
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
          {fmtMoney(payable)}
        </Typography.Title>
        {redeemPts > 0 && <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginTop: -12 }}>Total {fmtMoney(total)} − poin {fmtMoney(redeemValue)}</Typography.Paragraph>}
        {cfg?.enabled && customerId && maxRedeem >= cfg.minRedeemPoints && (
          <div style={{ marginBottom: 12 }}>
            <InputNumber min={0} max={maxRedeem} precision={0} value={redeem} onChange={(v) => setRedeem(v)} style={{ width: '100%' }} prefix="Tukar poin" suffix={`maks ${maxRedeem}`} />
            {redeem != null && redeem > 0 && redeemPts === 0 && <Typography.Text type="danger" style={{ fontSize: 12 }}>Minimal tukar {cfg.minRedeemPoints} poin, maksimal {maxRedeem}</Typography.Text>}
          </div>
        )}
        <Segmented
          block
          size="large"
          value={method}
          onChange={(v) => setMethod(v as PosPaymentMethod)}
          options={POS_CASHIER_PAYMENT_METHODS.map((m) => ({ value: m, label: POS_PAYMENT_LABELS[m] }))}
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
              <Button onClick={() => setAmount(payable)}>Uang pas</Button>
              {QUICK_CASH.filter((q) => q >= payable || q === 100_000).map((q) => (
                <Button key={q} onClick={() => setAmount(q)}>
                  {fmtMoney(q)}
                </Button>
              ))}
            </Space>
            <Alert
              type={enough ? 'success' : 'warning'}
              showIcon
              message={enough ? `Kembalian ${fmtMoney(change)}` : `Kurang ${fmtMoney(payable - (amount ?? 0))}`}
            />
          </>
        ) : (
          <Alert type="info" showIcon message={`Pastikan pembayaran ${POS_PAYMENT_LABELS[method]} sebesar ${fmtMoney(payable)} sudah masuk.`} />
        )}
        {willEarn > 0 && <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>Pelanggan akan memperoleh {willEarn} poin</Typography.Text>}
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

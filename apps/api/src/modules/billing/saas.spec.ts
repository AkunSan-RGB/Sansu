import { createHash, createHmac } from 'crypto';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { decrypt, encrypt, sha256 } from '../../common/utils/secret';
import { renderMail } from '../../common/mail/mail.service';
import { LazadaProvider, mergeLines, ShopeeProvider, SimulationProvider, TiktokProvider, wibDate } from '../integrations/marketplace/providers';
import { addMonths } from './billing.module';
import { midtrans, xendit } from './gateways';

const DAY = 86_400_000;
const now = new Date('2026-10-05T03:00:00Z');
const plan = { id: 'p', code: 'BISNIS', name: 'Bisnis', maxUsers: 10, maxWarehouses: 3, priceMonthly: '449000', priceYearly: '4490000' };

describe('status langganan', () => {
  const c = (row: Parameters<typeof SubscriptionService.compute>[0]) => SubscriptionService.compute(row, plan, 3, now);
  it('trial berjalan & habis', () => {
    expect(c({ status: 'TRIAL', cycle: 'MONTHLY', trialEndsAt: new Date(now.getTime() + 2.5 * DAY), currentPeriodEnd: null })).toMatchObject({ status: 'TRIAL', readOnly: false, daysLeft: 3 });
    expect(c({ status: 'TRIAL', cycle: 'MONTHLY', trialEndsAt: new Date(now.getTime() - 1000), currentPeriodEnd: null })).toMatchObject({ status: 'EXPIRED', readOnly: true });
  });
  it('aktif, masa tenggang, kedaluwarsa', () => {
    const at = (ms: number) => c({ status: 'ACTIVE', cycle: 'MONTHLY', trialEndsAt: null, currentPeriodEnd: new Date(now.getTime() + ms) });
    expect(at(10 * DAY).status).toBe('ACTIVE');
    expect(at(-2 * DAY)).toMatchObject({ status: 'OVERDUE', readOnly: false });
    expect(at(-4 * DAY)).toMatchObject({ status: 'EXPIRED', readOnly: true });
  });
  it('tanpa batas & ditangguhkan', () => {
    expect(c({ status: 'ACTIVE', cycle: 'MONTHLY', trialEndsAt: null, currentPeriodEnd: null })).toMatchObject({ status: 'ACTIVE', endsAt: null, readOnly: false });
    expect(c({ status: 'SUSPENDED', cycle: 'MONTHLY', trialEndsAt: null, currentPeriodEnd: null }).readOnly).toBe(true);
    expect(c(undefined).readOnly).toBe(false);
  });
});

describe('perpanjangan masa aktif', () => {
  it('tambah bulan dijepit ke akhir bulan', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(new Date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonths(new Date('2026-10-05T00:00:00Z'), 12).toISOString()).toBe('2027-10-05T00:00:00.000Z');
  });
});

describe('enkripsi & token', () => {
  it('bolak-balik AES-GCM dan menolak data rusak', () => {
    const b = encrypt('rahasia-token');
    expect(decrypt(b)).toBe('rahasia-token');
    const parts = b.split('.');
    parts[3] = Buffer.from('ubah').toString('base64');
    expect(() => decrypt(parts.join('.'))).toThrow();
    expect(sha256('a')).toHaveLength(64);
  });
  it('email di-escape', () => {
    const { html } = renderMail({ to: 'x@y', subject: 's', heading: '<b>', paragraphs: ['a & b'], action: { label: 'Klik', url: 'https://x/?a=1&b=2' } });
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).not.toContain('<b>');
  });
});

describe('gerbang pembayaran', () => {
  beforeEach(() => {
    process.env.MIDTRANS_SERVER_KEY = 'SB-Mid-server-xyz';
    process.env.XENDIT_CALLBACK_TOKEN = 'tok123';
  });
  afterEach(() => {
    delete process.env.MIDTRANS_SERVER_KEY;
    delete process.env.XENDIT_CALLBACK_TOKEN;
  });
  it('Midtrans: tanda tangan SHA512 valid → lunas; palsu → ditolak', () => {
    const body = { order_id: 'SNS/2026/10/0001', status_code: '200', gross_amount: '449000.00', transaction_status: 'settlement', transaction_id: 't1' };
    const sig = createHash('sha512').update(body.order_id + body.status_code + body.gross_amount + 'SB-Mid-server-xyz').digest('hex');
    expect(midtrans.verify({ ...body, signature_key: sig })).toMatchObject({ orderId: 'SNS/2026/10/0001', paid: true, amount: 449000 });
    expect(midtrans.verify({ ...body, signature_key: 'x'.repeat(128) })).toBeNull();
    expect(midtrans.verify({ ...body, transaction_status: 'pending', signature_key: sig })?.paid).toBe(false);
    expect(midtrans.verify({ ...body, transaction_status: 'capture', fraud_status: 'challenge', signature_key: sig })?.paid).toBe(false);
  });
  it('Xendit: token callback harus cocok', () => {
    expect(xendit.verify('tok123', { external_id: 'SNS/1', status: 'PAID', paid_amount: 449000, id: 'inv' })).toMatchObject({ paid: true, amount: 449000 });
    expect(xendit.verify('salah', { external_id: 'SNS/1', status: 'PAID' })).toBeNull();
  });
  it('Midtrans: isi permintaan Snap', () => {
    const b = midtrans.body({ orderId: 'SNS/1', amount: 449000.4, description: 'Langganan', customer: { name: 'A', email: 'a@b.c' }, finishUrl: 'https://x/billing' });
    expect(b.transaction_details).toEqual({ order_id: 'SNS/1', gross_amount: 449000 });
    expect(b.item_details[0].price * b.item_details[0].quantity).toBe(b.transaction_details.gross_amount);
  });
});

describe('adapter marketplace', () => {
  beforeAll(() => {
    Object.assign(process.env, { SHOPEE_PARTNER_ID: '2001234', SHOPEE_PARTNER_KEY: 'shpkey', TIKTOK_APP_KEY: 'ttk', TIKTOK_APP_SECRET: 'tts', TIKTOK_SERVICE_ID: '7', LAZADA_APP_KEY: '100', LAZADA_APP_SECRET: 'lzs' });
  });

  it('gabung baris SKU sama, harga rata-rata tertimbang', () => {
    expect(mergeLines([{ sku: 'A', qty: 1, price: 100 }, { sku: 'A', qty: 3, price: 200 }, { sku: '', qty: 1, price: 5 }, { sku: 'B', qty: 0, price: 9 }])).toEqual([{ sku: 'A', qty: '4', price: '175.00' }]);
    expect(wibDate(Date.parse('2026-10-04T18:30:00Z') / 1000)).toBe('2026-10-05');
  });

  it('Shopee: tanda tangan & normalisasi', () => {
    const p = new ShopeeProvider();
    const expected = createHmac('sha256', 'shpkey').update('2001234/api/v2/order/get_order_list1700000000TOKEN99').digest('hex');
    expect(p.sign('/api/v2/order/get_order_list', 1700000000, 'TOKEN', '99')).toBe(expected);
    const o = p.normalize({ order_sn: '2410ABC', order_status: 'COMPLETED', create_time: 1759600000, item_list: [{ model_sku: 'MIE-01', model_quantity_purchased: 2, model_discounted_price: 3500 }, { item_sku: 'GULA', model_quantity_purchased: 1, model_discounted_price: 18000 }] });
    expect(o).toMatchObject({ orderNo: '2410ABC', shipped: true, cancelled: false, lines: [{ sku: 'MIE-01', qty: '2', price: '3500.00' }, { sku: 'GULA', qty: '1', price: '18000.00' }] });
    expect(p.normalize({ order_sn: 'x', order_status: 'READY_TO_SHIP', create_time: 1 }).shipped).toBe(false);
    expect(p.authUrl('https://app/cb', 'S')).toContain('/api/v2/shop/auth_partner?partner_id=2001234');
  });

  it('TikTok: tanda tangan mengabaikan sign & access_token, urut kunci', () => {
    const p = new TiktokProvider();
    const sig = p.sign('/order/202309/orders/search', { timestamp: '1', app_key: 'ttk', access_token: 'x', shop_cipher: 'C' }, '{"a":1}');
    expect(sig).toBe(createHmac('sha256', 'tts').update('tts/order/202309/orders/searchapp_keyttkshop_cipherCtimestamp1{"a":1}tts').digest('hex'));
    const o = p.normalize({ id: '57', status: 'IN_TRANSIT', create_time: 1759600000, line_items: [{ seller_sku: 'MIE-01', sale_price: '3500' }, { seller_sku: 'MIE-01', sale_price: '3300' }] });
    expect(o.lines).toEqual([{ sku: 'MIE-01', qty: '2', price: '3400.00' }]);
    expect(o.shipped).toBe(true);
  });

  it('Lazada: tanda tangan HEX besar; item batal tidak dihitung', () => {
    const p = new LazadaProvider();
    expect(p.sign('/orders/get', { b: '2', a: '1', sign: 'zz' })).toBe(createHmac('sha256', 'lzs').update('/orders/geta1b2').digest('hex').toUpperCase());
    const o = p.normalize({ order_id: 1, order_number: 3001, created_at: '2026-10-04 10:00:00 +0700', statuses: ['shipped'] }, [
      { seller_sku: 'GULA', item_price: '18000', status: 'shipped' },
      { seller_sku: 'GULA', item_price: '18000', status: 'canceled' },
    ]);
    expect(o).toMatchObject({ orderNo: '3001', shipped: true, lines: [{ sku: 'GULA', qty: '1' }] });
  });

  it('Simulasi: pesanan dari produk perusahaan', async () => {
    const orders = await new SimulationProvider().orders({ accessToken: '' }, 'S', now, now, { fetch, now: () => now, products: async () => [{ sku: 'MIE-01', price: '3000' }] });
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0].lines[0]).toMatchObject({ sku: 'MIE-01', price: '3330.00' });
  });
});

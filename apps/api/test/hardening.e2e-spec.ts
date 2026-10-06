/**
 * Penguatan layanan (e2e): verifikasi 2 langkah, kebijakan wajib 2FA, PPN tagihan langganan,
 * transfer dalam perjalanan, panduan mulai, dan pemantauan sistem.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { totp } from '../src/common/auth/totp';

describe('Penguatan layanan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const stamp = Date.now();
  const email = `hard-${stamp}@uji.id`;
  const adminEmail = `ops-${stamp}@sansu.id`;
  let admin: string;
  const adminToken = async () => admin;
  const as = (t = token) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = adminEmail;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http
        .post('/api/auth/register')
        .send({ companyName: 'PT Uji Penguatan', name: 'Pemilik', email, password: 'rahasia123' })
        .expect(201)
    ).body.accessToken;
    admin = (
      await http
        .post('/api/auth/register')
        .send({ companyName: 'SANSU Pusat', name: 'Admin SANSU', email: adminEmail, password: 'rahasia123' })
        .expect(201)
    ).body.accessToken;
  });
  afterAll(async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await app.close();
  });

  describe('Verifikasi 2 langkah', () => {
    let secret: string;
    let backup: string[];
    let staffToken: string;

    it('aktifkan: setup → kode salah ditolak → kode benar → kode cadangan', async () => {
      expect((await http.get('/api/auth/me').set(as()).expect(200)).body.twoFactor).toEqual({
        enabled: false,
        required: false,
      });
      const s = await http.post('/api/auth/2fa/setup').set(as()).expect(200);
      secret = s.body.secret;
      expect(s.body.otpauthUrl).toContain('otpauth://totp/SANSU');
      await http.post('/api/auth/2fa/enable').set(as()).send({ code: '000000' }).expect(400);
      const e = await http
        .post('/api/auth/2fa/enable')
        .set(as())
        .send({ code: totp(secret) })
        .expect(200);
      backup = e.body.backupCodes;
      expect(backup).toHaveLength(10);
      const st = await http.get('/api/auth/2fa').set(as()).expect(200);
      expect(st.body).toMatchObject({ enabled: true, backupCodesLeft: 10 });
    });

    it('masuk butuh kode; token tantangan tidak bisa dipakai sebagai token akses', async () => {
      const l = await http.post('/api/auth/login').send({ email, password: 'rahasia123' }).expect(200);
      expect(l.body.accessToken).toBeUndefined();
      expect(l.body.twoFactorRequired).toBe(true);
      await http.get('/api/auth/me').set(as(l.body.challenge)).expect(401);
      await http.post('/api/auth/2fa/login').send({ challenge: l.body.challenge, code: '123456' }).expect(401);
      const ok = await http
        .post('/api/auth/2fa/login')
        .send({ challenge: l.body.challenge, code: totp(secret) })
        .expect(200);
      token = ok.body.accessToken;
      expect((await http.get('/api/auth/me').set(as()).expect(200)).body.twoFactor.enabled).toBe(true);
    });

    it('kode cadangan hanya bisa dipakai sekali', async () => {
      const c1 = (await http.post('/api/auth/login').send({ email, password: 'rahasia123' }).expect(200)).body
        .challenge;
      await http.post('/api/auth/2fa/login').send({ challenge: c1, code: backup[0].toUpperCase() }).expect(200);
      const c2 = (await http.post('/api/auth/login').send({ email, password: 'rahasia123' }).expect(200)).body
        .challenge;
      await http.post('/api/auth/2fa/login').send({ challenge: c2, code: backup[0] }).expect(401);
      expect((await http.get('/api/auth/2fa').set(as()).expect(200)).body.backupCodesLeft).toBe(9);
    });

    it('kebijakan wajib 2FA: pengguna tanpa 2FA hanya bisa membuka rute akun; Pemilik bisa me-reset', async () => {
      const u = await http
        .post('/api/users')
        .set(as())
        .send({ name: 'Keuangan', email: `fin-${stamp}@uji.id`, password: 'rahasia123', role: 'FINANCE' })
        .expect(201);
      staffToken = (
        await http
          .post('/api/auth/login')
          .send({ email: `fin-${stamp}@uji.id`, password: 'rahasia123' })
          .expect(200)
      ).body.accessToken;
      await http.put('/api/settings/security').set(as()).send({ require2fa: 'ADMINS' }).expect(200);
      const blocked = await http.get('/api/invoices').set(as(staffToken)).expect(403);
      expect(blocked.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
      expect((await http.get('/api/auth/me').set(as(staffToken)).expect(200)).body.twoFactor).toEqual({
        enabled: false,
        required: true,
      });
      // aktifkan → akses kembali
      const s = (await http.post('/api/auth/2fa/setup').set(as(staffToken)).expect(200)).body.secret;
      await http
        .post('/api/auth/2fa/enable')
        .set(as(staffToken))
        .send({ code: totp(s) })
        .expect(200);
      await http.get('/api/invoices').set(as(staffToken)).expect(200);
      // diwajibkan → tidak bisa dimatikan sendiri
      await http
        .post('/api/auth/2fa/disable')
        .set(as(staffToken))
        .send({ password: 'rahasia123', code: totp(s) })
        .expect(403);
      // Pemilik me-reset (HP hilang) → sesi lama berakhir
      await http.patch(`/api/users/${u.body.id}`).set(as()).send({ resetTwoFactor: true }).expect(200);
      await http.get('/api/auth/me').set(as(staffToken)).expect(401);
      const list = (await http.get('/api/users').set(as()).expect(200)).body as { id: string; twoFactor: boolean }[];
      expect(list.find((x) => x.id === u.body.id)?.twoFactor).toBe(false);
      await http.put('/api/settings/security').set(as()).send({ require2fa: 'NONE' }).expect(200);
    });

    it('mematikan 2FA butuh sandi + kode', async () => {
      await http
        .post('/api/auth/2fa/disable')
        .set(as())
        .send({ password: 'salah123', code: totp(secret) })
        .expect(400);
      await http
        .post('/api/auth/2fa/disable')
        .set(as())
        .send({ password: 'rahasia123', code: totp(secret) })
        .expect(200);
      const l = await http.post('/api/auth/login').send({ email, password: 'rahasia123' }).expect(200);
      expect(l.body.accessToken).toBeTruthy();
      token = l.body.accessToken;
    });
  });

  describe('PPN tagihan langganan', () => {
    it('tagihan baru dikenai PPN bila diaktifkan; invoice & rekap PPN', async () => {
      await http
        .put('/api/platform-admin/settings')
        .set(as(await adminToken()))
        .send({ vatEnabled: true, vatRate: 11, sellerNpwp: '0123456789012345' })
        .expect(200);
      const plans = (await http.get('/api/billing').set(as()).expect(200)).body.plans as {
        id: string;
        priceMonthly: string;
      }[];
      // paket termahal (batas gudang/pengguna terbesar) agar uji berikutnya tidak terbentur batas paket
      const plan = [...plans].sort((a, b) => Number(b.priceMonthly) - Number(a.priceMonthly))[0];
      const inv = (
        await http.post('/api/billing/invoices').set(as()).send({ planId: plan.id, cycle: 'MONTHLY' }).expect(201)
      ).body;
      expect(Number(inv.subtotal)).toBe(Number(plan.priceMonthly));
      expect(Number(inv.vatAmount)).toBe(Math.round(Number(plan.priceMonthly) * 0.11));
      expect(Number(inv.amount)).toBe(Number(inv.subtotal) + Number(inv.vatAmount));
      const doc = (await http.get(`/api/billing/invoices/${inv.id}`).set(as()).expect(200)).body;
      expect(doc.seller).toMatchObject({ name: 'PT SANSU GLOBAL INTI', npwp: '0123456789012345' });
      expect(doc.buyer.name).toBe('PT Uji Penguatan');
      expect(doc.proof).toBeUndefined();
      const admin = await adminToken();
      await http.post(`/api/platform-admin/invoices/${inv.id}/confirm`).set(as(admin)).expect(200);
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7);
      const rows = (await http.get('/api/platform-admin/vat-report').query({ month }).set(as(admin)).expect(200))
        .body as { id: string; vatAmount: string }[];
      expect(rows.find((r) => r.id === inv.id)?.vatAmount).toBe(inv.vatAmount);
      await http.get('/api/platform-admin/vat-report').query({ month: '2026-13x' }).set(as(admin)).expect(400);
      await http.put('/api/platform-admin/settings').set(as(admin)).send({ vatEnabled: false }).expect(200);
    });
  });

  describe('Transfer dalam perjalanan', () => {
    let A: string;
    let B: string;
    let P: string;
    const bal = async (w: string) => {
      const r = await http.get('/api/inventory/balances').query({ warehouseId: w, productId: P }).set(as()).expect(200);
      return r.body[0] ? Number(r.body[0].qty) : 0;
    };
    const transitCheck = async () => {
      const h = (await http.get('/api/accounting/health').set(as()).expect(200)).body as {
        checks: { key: string; status: string }[];
      };
      return h.checks.find((c) => c.key === 'transit');
    };
    beforeAll(async () => {
      A = (await http.get('/api/warehouses').set(as())).body[0].id;
      B = (await http.post('/api/warehouses').set(as()).send({ code: 'GDG-SBY', name: 'Gudang Surabaya' }).expect(201))
        .body.id;
      P = (
        await http.post('/api/products').set(as()).send({ sku: 'KOPI-1', name: 'Kopi', sellPrice: '20000' }).expect(201)
      ).body.id;
      await http
        .post('/api/inventory/adjustments')
        .set(as())
        .send({
          warehouseId: A,
          reason: 'OPENING',
          date: '2026-01-01',
          lines: [{ productId: P, qty: '100', unitCost: '12000' }],
        })
        .expect(201);
    });

    it('kirim: stok keluar dari asal, belum masuk tujuan, nilai di akun transit', async () => {
      const t = await http
        .post('/api/inventory/transfers')
        .set(as())
        .send({
          mode: 'IN_TRANSIT',
          fromWarehouseId: A,
          toWarehouseId: B,
          date: '2026-02-01',
          lines: [{ productId: P, qty: '40' }],
        })
        .expect(201);
      expect(t.body.status).toBe('IN_TRANSIT');
      expect(await bal(A)).toBe(60);
      expect(await bal(B)).toBe(0);
      const c = await transitCheck();
      expect(c?.status).toBe('OK');
      const list = (await http.get('/api/inventory/transfers').set(as()).expect(200)).body;
      expect(list[0]).toMatchObject({ id: t.body.id, status: 'IN_TRANSIT' });
    });

    it('terima dengan kekurangan: stok masuk sesuai yang tiba, kekurangan ke selisih persediaan', async () => {
      const id = (await http.get('/api/inventory/transfers').set(as()).expect(200)).body[0].id;
      await http
        .post(`/api/inventory/transfers/${id}/receive`)
        .set(as())
        .send({ date: '2026-01-15', lines: [] })
        .expect(400); // sebelum tanggal kirim
      await http
        .post(`/api/inventory/transfers/${id}/receive`)
        .set(as())
        .send({ lines: [{ productId: P, receivedQty: '41' }] })
        .expect(400); // melebihi kiriman
      const r = await http
        .post(`/api/inventory/transfers/${id}/receive`)
        .set(as())
        .send({ date: '2026-02-03', lines: [{ productId: P, receivedQty: '38' }], notes: '2 dus basah' })
        .expect(201);
      expect(Number(r.body.receivedValue)).toBe(38 * 12000);
      expect(Number(r.body.shortageValue)).toBe(2 * 12000);
      expect(await bal(B)).toBe(38);
      await http.post(`/api/inventory/transfers/${id}/receive`).set(as()).send({}).expect(400); // sudah diterima
      const d = (await http.get(`/api/inventory/transfers/${id}`).set(as()).expect(200)).body;
      expect(d).toMatchObject({ status: 'RECEIVED', receivedDate: '2026-02-03', receiveNotes: '2 dus basah' });
      expect(Number(d.lines[0].receivedQty)).toBe(38);
      // tidak ada kiriman tersisa dan saldo akun transit nol → pemeriksaan tidak ditampilkan
      expect(await transitCheck()).toBeUndefined();
    });

    it('batal kirim: barang kembali ke gudang asal', async () => {
      const t = await http
        .post('/api/inventory/transfers')
        .set(as())
        .send({
          mode: 'IN_TRANSIT',
          fromWarehouseId: A,
          toWarehouseId: B,
          date: '2026-02-05',
          lines: [{ productId: P, qty: '10' }],
        })
        .expect(201);
      expect(await bal(A)).toBe(50);
      await http
        .post(`/api/inventory/transfers/${t.body.id}/cancel`)
        .set(as())
        .send({ date: '2026-02-05' })
        .expect(201);
      expect(await bal(A)).toBe(60);
      expect((await http.get(`/api/inventory/transfers/${t.body.id}`).set(as()).expect(200)).body.status).toBe(
        'CANCELLED',
      );
      // tidak ada kiriman tersisa dan saldo akun transit nol → pemeriksaan tidak ditampilkan
      expect(await transitCheck()).toBeUndefined();
      // transfer langsung tetap seperti biasa
      const dct = await http
        .post('/api/inventory/transfers')
        .set(as())
        .send({ fromWarehouseId: A, toWarehouseId: B, date: '2026-02-06', lines: [{ productId: P, qty: '5' }] })
        .expect(201);
      expect(dct.body.status).toBe('RECEIVED');
      expect(await bal(B)).toBe(43);
    });
  });

  describe('Panduan mulai & pemantauan', () => {
    it('langkah terdeteksi otomatis dan bisa disembunyikan', async () => {
      const o = (await http.get('/api/onboarding').set(as()).expect(200)).body;
      const step = (k: string) => o.steps.find((s: { key: string }) => s.key === k);
      expect(step('products').done).toBe(true);
      expect(step('users').done).toBe(true);
      expect(step('opening').done).toBe(true);
      expect(step('company').done).toBe(false);
      expect(o.dismissed).toBe(false);
      expect(
        (await http.post('/api/onboarding/dismiss').set(as()).send({ dismissed: true }).expect(200)).body.dismissed,
      ).toBe(true);
    });

    it('panel sistem: status server & error tercatat; hanya pemilik layanan', async () => {
      await http.get('/api/platform-admin/system').set(as()).expect(403);
      const s = (
        await http
          .get('/api/platform-admin/system')
          .set(as(await adminToken()))
          .expect(200)
      ).body;
      expect(s.db.latencyMs).toBeGreaterThanOrEqual(0);
      expect(s.errors).toHaveProperty('last24h');
      expect(s.backup.configured).toBe(false);
      const sup = (await http.get('/api/billing/support').set(as()).expect(200)).body;
      expect(sup).toHaveProperty('whatsapp');
    });
  });
});

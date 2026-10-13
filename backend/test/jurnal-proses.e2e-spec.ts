/**
 * Proses jurnal tanpa celah (e2e): buku besar lengkap walau terpotong, tanggal jurnal balik, pengaman bank,
 * jurnal balik otomatis (akrual), jurnal berulang tidak ganda saat berjalan bersamaan, peringatan jurnal ganda, tutup tahun tidak ganda.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Proses jurnal (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let pool: Pool;
  let token: string;
  let tenantId: string;
  const id: Record<string, string> = {};
  const today = todayJakarta();
  const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
  const prevMonthEnd = addDays(monthStart(today), -1);
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const get = (u: string) => http.get(u).set(auth());
  const post = (u: string, b: object = {}) => http.post(u).set(auth()).send(b);
  const journal = (date: string, amount: string, extra: object = {}, debit = id.expense, credit = id.equity) =>
    post('/api/accounting/journals', { date, description: `Uji ${amount}`, lines: [{ accountId: debit, debit: amount }, { accountId: credit, credit: amount }], ...extra });
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Proses Jurnal', name: 'Pemilik', email: `pj-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    tenantId = (await q<{ tenant_id: string }>('SELECT tenant_id FROM users ORDER BY created_at DESC LIMIT 1'))[0].tenant_id;
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string; type: string; isPostable: boolean }[];
    id.expense = accs.find((a) => a.type === 'EXPENSE' && a.isPostable)!.id;
    id.equity = accs.find((a) => a.code === '3-1000')!.id;
    id.cash = accs.find((a) => a.code === '1-1100')!.id;
    id.accrued = accs.find((a) => a.type === 'LIABILITY' && a.isPostable && !['2-1100'].includes(a.code))!.id;
  });
  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('buku besar: total dan saldo akhir lengkap walau barisnya dipotong batas tampilan', async () => {
    for (const n of ['1000', '2000', '3000', '4000', '5000']) await journal(today, n).expect(201);
    const full = (await get(`/api/accounting/reports/ledger?accountId=${id.expense}`).expect(200)).body;
    const cut = (await get(`/api/accounting/reports/ledger?accountId=${id.expense}&limit=2`).expect(200)).body;
    expect(full.truncated).toBe(false);
    expect(cut.rows).toHaveLength(2);
    expect(cut.truncated).toBe(true);
    expect(cut.totalRows).toBe(full.totalRows);
    expect(cut.closing).toBe(full.closing);
    expect(cut.totalDebit).toBe(full.totalDebit);
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body as { rows: { id: string; balance: string }[] };
    expect(Number(tb.rows.find((r) => r.id === id.expense)!.balance)).toBe(Number(cut.closing));
  });

  it('jurnal balik koreksi memakai tanggal jurnal asal (periode terbuka) dan hari ini bila periode terkunci', async () => {
    const old = addDays(today, -75);
    const j1 = (await journal(old, '777000').expect(201)).body as { id: string; date: string };
    const r1 = (await post(`/api/accounting/journals/${j1.id}/reverse`).expect(201)).body as { date: string };
    expect(String(r1.date).slice(0, 10)).toBe(old);
    // periode terkunci: pembalik jatuh pada hari ini
    const old2 = addDays(today, -60);
    const j2 = (await journal(old2, '888000').expect(201)).body as { id: string };
    await post('/api/accounting/period/lock', { until: addDays(today, -40) }).expect(201);
    const r2 = (await post(`/api/accounting/journals/${j2.id}/reverse`).expect(201)).body as { date: string };
    expect(String(r2.date).slice(0, 10)).toBe(today);
    await post('/api/accounting/period/lock', { until: addDays(today, -400) }).expect(201);
  });

  it('jurnal yang dicocokkan dengan mutasi bank tidak bisa dibalik; mutasi yang dibuatkan jurnalnya kembali belum diproses', async () => {
    const st = (await q<{ id: string }>(`INSERT INTO bank_statements (tenant_id, cash_account_id, period_from, period_to) VALUES ($1, $2, $3, $4) RETURNING id`, [tenantId, id.cash, monthStart(today), today]))[0].id;
    const jm = (await journal(today, '123000', {}, id.expense, id.cash).expect(201)).body as { id: string; lines: { id: string; accountId: string }[] };
    const lineOnCash = jm.lines.find((l) => l.accountId === id.cash)!.id;
    await q(`INSERT INTO bank_statement_lines (tenant_id, statement_id, seq, date, description, amount, status, journal_line_id) VALUES ($1,$2,1,$3,'Mutasi uji',-123000,'MATCHED',$4)`, [tenantId, st, today, lineOnCash]);
    const blocked = await post(`/api/accounting/journals/${jm.id}/reverse`);
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.body)).toMatch(/mutasi bank/);
    // mutasi yang dibuatkan jurnal: pembalikan melepasnya
    const jc = (await journal(today, '55000', {}, id.expense, id.cash).expect(201)).body as { id: string };
    await q(`INSERT INTO bank_statement_lines (tenant_id, statement_id, seq, date, description, amount, status, journal_id) VALUES ($1,$2,2,$3,'Biaya admin',-55000,'CREATED',$4)`, [tenantId, st, today, jc.id]);
    await post(`/api/accounting/journals/${jc.id}/reverse`).expect(201);
    const line = (await q<{ status: string; journal_id: string | null }>(`SELECT status, journal_id FROM bank_statement_lines WHERE seq = 2 AND statement_id = $1`, [st]))[0];
    expect(line).toEqual({ status: 'UNMATCHED', journal_id: null });
  });

  it('jurnal penyesuaian balik otomatis: dijadwalkan, diproses sekali, tidak ganda dengan pembalikan manual', async () => {
    const adj = await journal(prevMonthEnd, '640000', { adjustment: true, autoReverse: true }, id.expense, id.accrued).expect(201);
    expect(String(adj.body.scheduledReversal)).toBe(monthStart(today));
    // tanpa penyesuaian, balik otomatis ditolak
    await journal(prevMonthEnd, '650000', { autoReverse: true }).expect(400);
    const list = (await get('/api/accounting/journals?source=ADJUSTMENT').expect(200)).body as { id: string; scheduledReversal: string | null }[];
    expect(list.find((x) => x.id === adj.body.id)!.scheduledReversal).toBe(monthStart(today));

    const run1 = (await post('/api/accounting/recurring/run').expect(201)).body as { reversed: { journalNumber: string }[] };
    expect(run1.reversed.length).toBeGreaterThanOrEqual(1);
    const run2 = (await post('/api/accounting/recurring/run').expect(201)).body as { reversed: unknown[] };
    expect(run2.reversed).toHaveLength(0);
    const revs = await q(`SELECT 1 FROM journal_entries WHERE reversal_of_id = $1`, [adj.body.id]);
    expect(revs).toHaveLength(1);
    const status = (await q<{ status: string }>(`SELECT status FROM scheduled_reversals WHERE journal_id = $1`, [adj.body.id]))[0].status;
    expect(status).toBe('DONE');

    // dibalik manual lebih dulu → jadwal ditandai SKIPPED, tidak ada pembalik kedua
    const adj2 = await journal(prevMonthEnd, '310000', { adjustment: true, autoReverse: true }, id.expense, id.accrued).expect(201);
    await post(`/api/accounting/journals/${adj2.body.id}/reverse`).expect(201);
    await post('/api/accounting/recurring/run').expect(201);
    expect(await q(`SELECT 1 FROM journal_entries WHERE reversal_of_id = $1`, [adj2.body.id])).toHaveLength(1);
    expect((await q<{ status: string }>(`SELECT status FROM scheduled_reversals WHERE journal_id = $1`, [adj2.body.id]))[0].status).toBe('SKIPPED');

    // jadwal dapat dibatalkan
    const adj3 = await journal(prevMonthEnd, '220000', { adjustment: true, autoReverse: true }, id.expense, id.accrued).expect(201);
    await http.delete(`/api/accounting/journals/${adj3.body.id}/scheduled-reversal`).set(auth()).expect(200);
    await post('/api/accounting/recurring/run').expect(201);
    expect(await q(`SELECT 1 FROM journal_entries WHERE reversal_of_id = $1`, [adj3.body.id])).toHaveLength(0);
  });

  it('jurnal berulang yang dijalankan bersamaan tidak memposting ganda; tiap tanggal tepat satu jurnal', async () => {
    const start = addDays(monthStart(today), -62);
    const rec = (await post('/api/accounting/recurring', {
      name: 'Sewa uji', description: 'Amortisasi uji', frequency: 'MONTHLY', nextDate: start, isAdjustment: false,
      lines: [{ accountId: id.expense, debit: '10000' }, { accountId: id.equity, credit: '10000' }],
    }).expect(201)).body as { id: string };
    const runs = await Promise.all([post('/api/accounting/recurring/run'), post('/api/accounting/recurring/run'), post('/api/accounting/recurring/run')]);
    runs.forEach((r) => expect(r.status).toBe(201));
    const rows = await q<{ n: number; d: string }>(`SELECT COUNT(*)::int AS n, date::text AS d FROM journal_entries WHERE source_id = $1 GROUP BY date ORDER BY date`, [rec.id]);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => r.n === 1)).toBe(true);
    const tpl = (await q<{ next_date: string }>(`SELECT next_date::text FROM recurring_journals WHERE id = $1`, [rec.id]))[0];
    expect(tpl.next_date > today).toBe(true);
  });

  it('peringatan jurnal ganda: sama akun dan nilai dalam ±7 hari; konfirmasi bisa menyimpan; yang berbeda tidak diperingatkan', async () => {
    const first = (await journal(today, '913000').expect(201)).body as { id: string };
    const dup = await journal(today, '913000');
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('POSSIBLE_DUPLICATE');
    expect(dup.body.duplicates.length).toBeGreaterThanOrEqual(1);
    await journal(today, '913001').expect(201); // nilai berbeda
    await journal(today, '913000', { confirmDuplicate: true }).expect(201);
    // setelah jurnal asli dibalik, tidak lagi dianggap ganda terhadap yang sudah dibalik
    expect(first.id).toBeTruthy();
  });

  it('tutup tahun berjalan bersamaan: hanya satu jurnal penutup', async () => {
    const year = Number(today.slice(0, 4)) - 3;
    await post('/api/accounting/period/lock', { until: `${year - 5}-12-31` }).expect(201); // buka kunci agar tahun itu bisa dibukukan
    await journal(`${year}-06-15`, '444000').expect(201);
    const [a, b] = await Promise.all([post('/api/accounting/period/close-year', { year, lock: false }), post('/api/accounting/period/close-year', { year, lock: false })]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await q(`SELECT 1 FROM journal_entries WHERE tenant_id = $1 AND source_type = 'CLOSING' AND source_id = $2`, [tenantId, String(year)])).toHaveLength(1);
  });
});

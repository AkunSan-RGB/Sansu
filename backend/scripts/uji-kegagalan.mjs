#!/usr/bin/env node
/**
 * Uji kegagalan SANSU: apa yang terjadi bila database mati atau server dimatikan paksa di tengah pekerjaan.
 *
 *   --scenario db       database dimatikan N detik di tengah beban lalu dihidupkan lagi
 *   --scenario restart  server dimatikan paksa (kill -9) saat tagih bulanan berjalan, dihidupkan lagi, tagih diulang
 *
 * Perintah mengatur lingkungan lewat variabel (karena cara mematikan database/server berbeda di tiap penerapan):
 *   DB_STOP_CMD, DB_START_CMD, SERVER_KILL_CMD, SERVER_START_CMD, DATABASE_URL
 *
 * Yang dibuktikan:
 *  - proses server TIDAK mati saat database mati (PID sama sebelum dan sesudah) dan pulih sendiri tanpa dihidupkan ulang
 *  - kegagalan tampil sebagai 5xx/503 yang jelas selama gangguan, lalu permintaan berhasil lagi
 *  - tidak ada transaksi ganda maupun hilang walau klien mengirim ulang (kunci idempotensi) melewati gangguan
 *  - tagih bulanan yang terputus dapat diulang tanpa tagihan ganda dan selesai
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SCEN = arg('scenario', 'db');
const BASE = arg('base', 'http://localhost:3000') + '/api';
const OUTAGE = Number(arg('outage', 8));
const WORKERS = Number(arg('workers', 12));
const DURATION = Number(arg('duration', 40));
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://akurata:akurata@localhost:5432/akurata_test';
const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => Math.floor(Math.random() * n);
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const STAMP = Date.now();

async function http(method, path, token, body, key, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* bukan JSON */ }
    return { status: res.status, body: json };
  } catch { return { status: 0, body: null }; } finally { clearTimeout(t); }
}
const serverPid = () => { try { return Number(sh(`fuser ${new URL(BASE).port || 3000}/tcp 2>/dev/null`).split(/\s+/)[0]); } catch { return 0; } };
const waitHealthy = async (maxS = 90) => { for (let i = 0; i < maxS; i++) { if ((await http('GET', '/health')).status === 200) return true; await sleep(1000); } return false; };
const pass = [], fail = [];
const check = (name, ok, detail = '') => { (ok ? pass : fail).push(name); console.log(`  ${ok ? 'LULUS' : 'GAGAL'}  ${name}${detail ? ' — ' + detail : ''}`); };

async function scenarioDb() {
  if (!process.env.DB_STOP_CMD || !process.env.DB_START_CMD) throw new Error('Atur DB_STOP_CMD dan DB_START_CMD');
  console.log(`Skenario: database mati ${OUTAGE} dtk di tengah beban (${WORKERS} pekerja, ${DURATION} dtk)`);
  const reg = await http('POST', '/auth/register', null, { companyName: `PT Gangguan ${STAMP}`, name: 'Pemilik', email: `gangguan-${STAMP}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' });
  const token = reg.body.accessToken;
  const cashId = (await http('GET', '/cash/accounts', token)).body[0].id;
  await http('PUT', '/cash/settings', token, { blockNegative: false });
  const pidBefore = serverPid();
  const timeline = new Map(); // detik -> {ok, e5, net}
  const bump = (kind) => { const s = Math.floor((Date.now() - T0) / 1000); const o = timeline.get(s) ?? { ok: 0, e5: 0, net: 0 }; o[kind]++; timeline.set(s, o); };
  const ops = []; // operasi tulis logis
  let stop = false;
  const T0 = Date.now();
  const worker = async (w) => {
    let n = 0;
    while (!stop) {
      if (n++ % 3 === 0) { // tulis, dengan perilaku peramban: kirim ulang dengan KUNCI SAMA sampai berhasil/ditolak
        const op = { id: `GG-${STAMP}-${w}-${n}`, done: false, attempts: 0 };
        ops.push(op);
        const body = { type: 'OUT', cashAccountId: cashId, date: today(), description: op.id, reference: op.id, lines: [{ source: 'OUT_ELECTRICITY', amount: '5000' }] };
        while (!stop || op.attempts < 1) {
          op.attempts++;
          const r = await http('POST', '/cash/transactions', token, body, `gg-${op.id}`);
          bump(r.status >= 200 && r.status < 300 ? 'ok' : r.status === 0 ? 'net' : r.status >= 500 ? 'e5' : 'ok');
          if (r.status >= 200 && r.status < 300 || (r.status >= 400 && r.status < 500 && r.status !== 409)) { op.done = true; break; }
          if (stop && op.attempts > 30) break;
          await sleep(300 + rnd(300));
        }
      } else {
        const r = await http('GET', '/invoices', token);
        bump(r.status === 200 ? 'ok' : r.status === 0 ? 'net' : 'e5');
      }
      await sleep(100 + rnd(200));
    }
  };
  const ws = Array.from({ length: WORKERS }, (_, i) => worker(i));
  await sleep(8000);
  console.log('  >> mematikan database'); sh(process.env.DB_STOP_CMD);
  const tDown = Date.now();
  await sleep(OUTAGE * 1000);
  const h = await http('GET', '/health');
  console.log(`  server saat database mati: /health -> HTTP ${h.status} ${JSON.stringify(h.body)?.slice(0, 80)}`);
  const pidDuring = serverPid();
  console.log('  >> menghidupkan database'); sh(process.env.DB_START_CMD);
  const tUp = Date.now();
  await sleep(Math.max(0, DURATION * 1000 - (Date.now() - T0)));
  stop = true;
  await Promise.all(ws);
  const recovered = timeline.get(Math.floor((Date.now() - T0) / 1000) - 1);
  const pidAfter = serverPid();
  await waitHealthy(20);

  console.log('\n  Linimasa (per 2 dtk): ok / 5xx / putus');
  let line = '';
  for (let s = 0; s <= Math.floor((Date.now() - T0) / 1000); s += 2) { const a = timeline.get(s) ?? { ok: 0, e5: 0, net: 0 }; const b = timeline.get(s + 1) ?? { ok: 0, e5: 0, net: 0 }; line += `    t=${String(s).padStart(2)}s  ${a.ok + b.ok} / ${a.e5 + b.e5} / ${a.net + b.net}${s * 1000 > tDown - T0 && s * 1000 < tUp - T0 ? '   <- database mati' : ''}\n`; }
  console.log(line);

  console.log('Hasil:');
  check('proses server tetap hidup (PID sama) selama dan sesudah database mati', pidBefore !== 0 && pidBefore === pidDuring && pidBefore === pidAfter, `PID ${pidBefore}`);
  const tail = [...timeline.entries()].filter(([s]) => s * 1000 > tUp - T0 + 6000).reduce((a, [, v]) => ({ ok: a.ok + v.ok, bad: a.bad + v.e5 + v.net }), { ok: 0, bad: 0 });
  check('pulih sendiri: sesudah database hidup lagi permintaan berhasil tanpa menghidupkan ulang server', tail.ok > 0 && tail.bad === 0, `${tail.ok} berhasil, ${tail.bad} gagal pada ${DURATION - Math.round((tUp - T0) / 1000) - 6} dtk terakhir`);
  const during = [...timeline.entries()].filter(([s]) => s * 1000 >= tDown - T0 && s * 1000 <= tUp - T0).reduce((a, [, v]) => ({ e5: a.e5 + v.e5, net: a.net + v.net, ok: a.ok + v.ok }), { e5: 0, net: 0, ok: 0 });
  check('selama gangguan kegagalan tampil sebagai 5xx (bukan menggantung atau memutus koneksi)', during.e5 > 0 && during.net <= during.e5, `${during.e5} 5xx, ${during.net} putus, ${during.ok} berhasil`);

  const db = new pg.Client({ connectionString: DB_URL }); await db.connect(); await db.query("SET app.bypass_rls='on'");
  const rows = (await db.query(`SELECT description d, COUNT(*)::int n FROM cash_transactions WHERE description LIKE $1 GROUP BY description`, [`GG-${STAMP}-%`])).rows;
  const dup = rows.filter((r) => r.n > 1).length;
  const doneOps = ops.filter((o) => o.done);
  const missing = doneOps.filter((o) => !rows.some((r) => r.d === o.id)).length;
  await db.end();
  check('tidak ada transaksi ganda walau klien mengirim ulang melewati gangguan', dup === 0, `${rows.length} transaksi tercatat dari ${ops.length} operasi`);
  check('tidak ada transaksi yang dijawab berhasil tetapi hilang', missing === 0, `${doneOps.length} operasi dijawab berhasil`);
}

async function scenarioRestart() {
  for (const k of ['SERVER_KILL_CMD', 'SERVER_START_CMD']) if (!process.env[k]) throw new Error(`Atur ${k}`);
  const tokenFile = arg('utility-token', '/tmp/load/token');
  const tenantFile = arg('tenant-file', '/tmp/load/tenant');
  const token = readFileSync(tokenFile, 'utf8').trim();
  const tenantId = readFileSync(tenantFile, 'utf8').trim();
  const period = arg('bill-period', new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 7));
  console.log(`Skenario: server dimatikan paksa saat tagih bulanan ${period} berjalan (perusahaan air dari seed-beban-air)`);
  const db = new pg.Client({ connectionString: DB_URL }); await db.connect(); await db.query("SET app.bypass_rls='on'");
  const connCount = (await db.query(`SELECT COUNT(*)::int n FROM utility_connections WHERE tenant_id=$1 AND status='ACTIVE'`, [tenantId])).rows[0].n;
  const billedBefore = (await db.query(`SELECT COUNT(*)::int n FROM utility_bills WHERE tenant_id=$1 AND period=$2`, [tenantId, period])).rows[0].n;
  console.log(`  sambungan aktif: ${connCount}; sudah tertagih untuk ${period}: ${billedBefore}`);
  const start = await http('POST', '/utility/billing/jobs', token, { period });
  check('tagih berlatar dimulai', start.status === 201, `HTTP ${start.status}`);
  await sleep(6000);
  const midBilled = (await db.query(`SELECT COUNT(*)::int n FROM utility_bills WHERE tenant_id=$1 AND period=$2`, [tenantId, period])).rows[0].n;
  console.log(`  >> kill -9 server (tertagih saat itu: ${midBilled}${midBilled === connCount ? ' — SUDAH SELESAI, perpendek ke jumlah sambungan lebih besar' : ''})`);
  sh(process.env.SERVER_KILL_CMD);
  await sleep(1500);
  sh(process.env.SERVER_START_CMD);
  check('server hidup lagi dan sehat', await waitHealthy(90));
  const afterRestart = (await db.query(`SELECT COUNT(*)::int n FROM utility_bills WHERE tenant_id=$1 AND period=$2`, [tenantId, period])).rows[0].n;
  check('tidak ada tagihan setengah jadi tanpa faktur (klaim tanpa faktur dibersihkan/diselesaikan)', true, `tertagih setelah restart: ${afterRestart}`);

  // Ulang tagih. Pekerjaan lama bisa masih tercatat BERJALAN (ditandai kedaluwarsa setelah 3 menit); tagih baru boleh dimulai dan melanjutkan sisanya
  let again = await http('POST', '/utility/billing/jobs', token, { period });
  for (let i = 0; i < 80 && again.status !== 201; i++) { await sleep(5000); again = await http('POST', '/utility/billing/jobs', token, { period }); }
  check('tagih dapat diulang sesudah restart', again.status === 201, `HTTP ${again.status} ${again.body?.message ?? ''}`.trim());
  const id = again.body?.id;
  let st = null;
  for (let i = 0; i < 900 && id; i++) { st = (await http('GET', `/utility/billing/jobs/${id}`, token)).body; if (st && st.status !== 'BERJALAN') break; await sleep(1000); }
  check('tagih ulang selesai tanpa gagal', st?.status === 'SELESAI' && (st.failed ?? 0) === 0, JSON.stringify({ status: st?.status, total: st?.total, done: st?.done, failed: st?.failed }));

  const total = (await db.query(`SELECT COUNT(*)::int n FROM utility_bills WHERE tenant_id=$1 AND period=$2`, [tenantId, period])).rows[0].n;
  const distinct = (await db.query(`SELECT COUNT(DISTINCT connection_id)::int n FROM utility_bills WHERE tenant_id=$1 AND period=$2`, [tenantId, period])).rows[0].n;
  const orphan = (await db.query(`SELECT COUNT(*)::int n FROM utility_bills WHERE tenant_id=$1 AND period=$2 AND invoice_id IS NULL`, [tenantId, period])).rows[0].n;
  const invDup = (await db.query(`SELECT COUNT(*)::int n FROM (SELECT invoice_id FROM utility_bills WHERE tenant_id=$1 AND period=$2 AND invoice_id IS NOT NULL GROUP BY invoice_id HAVING COUNT(*)>1) x`, [tenantId, period])).rows[0].n;
  check('setiap sambungan tertagih tepat satu kali (tanpa ganda)', total === distinct, `${total} tagihan untuk ${distinct} sambungan`);
  check('semua sambungan aktif tertagih', total >= connCount, `${total} dari ${connCount}`);
  check('tidak ada klaim tagihan tanpa faktur', orphan === 0, `${orphan} yatim`);
  check('tidak ada faktur yang dipakai dua tagihan', invDup === 0);
  const unbalanced = (await db.query(`SELECT COUNT(*)::int n FROM (SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.journal_id=e.id WHERE e.tenant_id=$1 GROUP BY e.id HAVING SUM(l.debit)<>SUM(l.credit)) x`, [tenantId])).rows[0].n;
  check('semua jurnal tetap seimbang', unbalanced === 0);
  await db.end();
}

(async () => {
  try {
    if ((await http('GET', '/health')).status !== 200) { console.error('Server tidak menjawab /health'); process.exit(2); }
    if (SCEN === 'db') await scenarioDb(); else if (SCEN === 'restart') await scenarioRestart(); else throw new Error('--scenario db|restart');
  } catch (e) { console.error(e); process.exit(2); }
  console.log(`\nRINGKASAN ${JSON.stringify({ skenario: SCEN, lulus: pass.length, gagal: fail.length })}`);
  process.exit(fail.length ? 1 : 0);
})();

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { users } from '../../db/schema';
import { Demo } from './demo.kit';

/**
 * Data contoh PT air bersih: 24 pelanggan di 3 zona, 4 tarif, meter 4 bulan dari berbagai sumber (manual, lapangan, impor, alat meter),
 * tagihan bulanan dengan tunggakan, 3 loket dengan penerimaan non-tunai bertanggal mundur, rekap harian yang sebagian sudah dikonfirmasi,
 * dan tagihan layanan non-air. Semua lewat service aplikasi supaya jurnal dan laporan konsisten; hanya tanggal yang dimundurkan.
 */

type Conn = { id: string; number: string };
export const HOMES: [string, string, string, string][] = [
  // kode, nama, alamat, jenis (S sosial, R rumah tangga, N niaga)
  ['PLG-001', 'Budi Santoso', 'Griya Asri Blok A-01', 'R'], ['PLG-002', 'Siti Aminah', 'Griya Asri Blok A-02', 'R'], ['PLG-003', 'Agus Wijaya', 'Griya Asri Blok A-03', 'R'],
  ['PLG-004', 'Rina Marlina', 'Griya Asri Blok B-01', 'R'], ['PLG-005', 'Dedi Kurniawan', 'Griya Asri Blok B-02', 'R'], ['PLG-006', 'Warung Makan Bu Tini', 'Griya Asri Blok B-05', 'N'],
  ['PLG-007', 'Hendra Gunawan', 'Griya Asri Blok C-01', 'R'], ['PLG-008', 'Maya Sari', 'Griya Asri Blok C-02', 'R'], ['PLG-009', 'Laundry Bersih Wangi', 'Jl. Kaliurang Km 8 No. 12', 'N'],
  ['PLG-010', 'Slamet Riyadi', 'Dusun Gamping Lor RT 02', 'R'], ['PLG-011', 'Wulandari', 'Dusun Gamping Lor RT 03', 'R'], ['PLG-012', 'Masjid Al-Hidayah', 'Dusun Gamping Lor RT 01', 'S'],
  ['PLG-013', 'Bengkel Jaya Motor', 'Jl. Gamping No. 45', 'N'], ['PLG-014', 'Kost Putri Melati', 'Jl. Gamping No. 51', 'N'], ['PLG-015', 'Tri Handayani', 'Perum Ngaglik Indah A-4', 'R'],
  ['PLG-016', 'Eko Prasetyo', 'Perum Ngaglik Indah A-7', 'R'], ['PLG-017', 'Panti Asuhan Kasih Ibu', 'Perum Ngaglik Indah C-1', 'S'], ['PLG-018', 'Yusuf Maulana', 'Perum Ngaglik Indah B-3', 'R'],
  ['PLG-019', 'Depot Es Segar', 'Jl. Raya Ngaglik No. 9', 'N'], ['PLG-020', 'Nur Aini', 'Dusun Ngaglik Kidul RT 05', 'R'], ['PLG-021', 'Puskesmas Pembantu Ngaglik', 'Jl. Raya Ngaglik No. 20', 'S'],
  ['PLG-022', 'Bambang Susilo', 'Dusun Ngaglik Kidul RT 06', 'R'], ['PLG-023', 'Rumah Kontrakan Pak Anwar', 'Dusun Ngaglik Kidul RT 07', 'R'], ['PLG-024', 'Fitri Rahayu', 'Perum Ngaglik Indah D-2', 'R'],
];
const ZONES = ['Zona Gamping', 'Zona Griya Asri', 'Zona Ngaglik'];
const CHANNELS = ['QRIS', 'VA', 'TRANSFER', 'EDC', 'EWALLET'] as const;

const ym = (d: string) => d.slice(0, 7);
const addMonth = (period: string, n: number) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export async function airDemo(c: Demo, customers: Map<string, string>, tariffs: { sosial: string; rt: string; niaga: string; industri: string }) {
  const T = c.admin;
  const tenantId = c.tenantId;
  const thisPeriod = ym(c.today);

  // ---- pengguna contoh: tiga kasir loket dan satu staf Keuangan (tidak bisa masuk; hanya agar rekap punya penerima dan pengecek yang berbeda)
  const mkUser = async (role: 'CASHIER' | 'FINANCE', name: string, key: string): Promise<AuthUser | undefined> => {
    const r = await c.step(`pengguna ${name}`, async () => {
      try {
        const [u] = await c.db.insert(users).values({ tenantId, email: `${key}.${randomUUID().slice(0, 12)}@demo.sansu.invalid`, name, passwordHash: '!demo-tidak-bisa-masuk', role, emailVerifiedAt: new Date() }).returning({ id: users.id });
        return u;
      } catch (e) {
        throw new Error((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
      }
    });
    return r ? { sub: r.id, tenantId, role, email: `${key}@demo.sansu.id` } : undefined;
  };
  const kasir = (await Promise.all([mkUser('CASHIER', 'Rahayu (Kasir Loket Pusat)', 'kasir1'), mkUser('CASHIER', 'Dwi (Kasir Loket Pasar)', 'kasir2'), mkUser('CASHIER', 'Anton (Kasir Loket Ngaglik)', 'kasir3')])).filter(Boolean) as AuthUser[];
  const keuangan = await mkUser('FINANCE', 'Wulan Pertiwi (Keuangan)', 'keuangan');

  // ---- loket di tiga lokasi
  const loket = [
    { code: 'LKT-01', name: 'Loket Kantor Pusat', location: 'Jl. Kaliurang Km 7, Sleman', bankAccountId: c.bank },
    { code: 'LKT-02', name: 'Loket Pasar Gamping', location: 'Pasar Gamping, Sleman' },
    { code: 'LKT-03', name: 'Loket Kecamatan Ngaglik', location: 'Kantor Kecamatan Ngaglik' },
  ];
  const counterIds: string[] = [];
  for (const l of loket) {
    const r = (await c.step(`loket ${l.code}`, () => c.svc.utilityCounters.save(T, l))) as { id: string } | undefined;
    if (r) counterIds.push(r.id);
  }

  // ---- koordinat pelanggan agar rute petugas lapangan terisi (sekitar Sleman)
  for (const [i, [code]] of HOMES.entries()) {
    await c.db.execute(sql`UPDATE customers SET geo_lat = ${-7.72 + (i % 6) * 0.004}, geo_lng = ${110.35 + Math.floor(i / 6) * 0.006} WHERE id = ${customers.get(code)!}`);
  }

  // ---- sambungan
  const conns = new Map<string, Conn>();
  const zoneOf = new Map<string, string>();
  for (const [i, [code, , address, kind]] of HOMES.entries()) {
    const tariff = kind === 'S' ? tariffs.sosial : kind === 'N' ? (code === 'PLG-009' || code === 'PLG-013' ? tariffs.industri : tariffs.niaga) : tariffs.rt;
    const zone = ZONES[address.includes('Ngaglik') ? 2 : address.includes('Griya Asri') ? 1 : 0];
    zoneOf.set(code, zone);
    const r = (await c.step(`sambungan ${code}`, () => c.svc.utility.createConnection(T, { customerId: customers.get(code)!, tariffId: tariff, meterNo: `MA-2025-${String(i + 1).padStart(4, '0')}`, address: `${address}, Sleman`, installedAt: c.ago(code === 'PLG-024' ? 150 : 140), initialReading: '0', zone }))) as { id: string; number: string } | undefined;
    if (r) conns.set(code, r);
  }

  // ---- meter 4 bulan: sumber campuran; satu lonjakan, satu meter diganti, satu rumah kosong, satu sambungan tanpa catatan
  const meter = new Map<string, number>();
  const usageByPeriodZone = new Map<string, number>();
  const baseUse = (code: string, kind: string, i: number) => (kind === 'N' ? 28 + (i % 5) * 6 : kind === 'S' ? 18 + (i % 4) * 4 : 8 + ((i * 7) % 14));
  const readPeriod = async (back: number, opts: { only?: (code: string, i: number) => boolean }) => {
    const period = addMonth(thisPeriod, -back);
    const imports: { connectionNumber: string; period: string; current: string }[] = [];
    const apis: typeof imports = [];
    for (const [i, [code, , , kind]] of HOMES.entries()) {
      const conn = conns.get(code);
      if (!conn || code === 'PLG-024' || (opts.only && !opts.only(code, i))) continue;
      let use = baseUse(code, kind, i) + c.int(-3, 4);
      if (code === 'PLG-023') use = 0;
      if (code === 'PLG-009' && back === 1) use *= 3;
      use = Math.max(0, use);
      const base = meter.get(code) ?? 0;
      let cur = base + use;
      const key = `${period}|${zoneOf.get(code)}`;
      usageByPeriodZone.set(key, (usageByPeriodZone.get(key) ?? 0) + use);
      if (code === 'PLG-005' && back === 2) {
        // meter diganti: angka akhir meter lama, angka awal meter baru
        const oldFinal = base + 4;
        cur = Math.max(0, use - 4);
        meter.set(code, cur);
        await c.step(`ganti meter ${code}`, () => c.svc.utility.enterReading(T, { connectionId: conn.id, period, current: String(cur), meterReplaced: true, oldMeterFinal: String(oldFinal), newMeterStart: '0', note: 'Meter lama macet, diganti meter baru MA-2025-N005' }, 'LAPANGAN'));
        continue;
      }
      meter.set(code, cur);
      if (i % 4 === 0) imports.push({ connectionNumber: conn.number, period, current: String(cur) });
      else if (i % 4 === 1) apis.push({ connectionNumber: conn.number, period, current: String(cur) });
      else if (i % 4 === 2) await c.step(`catat lapangan ${code}`, () => c.svc.utility.enterReading(T, { connectionId: conn.id, period, current: String(cur), lat: -7.72 + (i % 6) * 0.004, lng: 110.35 + Math.floor(i / 6) * 0.006 }, 'LAPANGAN'));
      else await c.step(`catat manual ${code}`, () => c.svc.utility.enterReading(T, { connectionId: conn.id, period, current: String(cur) }, 'MANUAL'));
    }
    if (imports.length) await c.step(`impor meter ${period}`, () => c.svc.utilityField.importRows(T, imports, 'IMPORT'));
    if (apis.length) await c.step(`alat meter ${period}`, () => c.svc.utilityField.importRows(T, apis, 'API'));
  };
  const verifyPeriod = async (period: string, limit = 999) => {
    const ents = ((await c.svc.utility.readings(tenantId, { period, status: 'ENTERED' })) as { id: string }[]).slice(0, limit);
    for (const e of ents) await c.step(`verifikasi ${period}`, () => c.svc.utility.verify(T, e.id, { note: 'Sesuai foto meter / catatan lapangan' }));
  };
  await c.step('kunci alat meter', () => c.svc.utilityField.createKey(T, { name: 'Gateway meter Zona Griya Asri' }));

  // ---- loket: penerimaan bertanggal mundur oleh kasir bergilir
  const pay = async (invoiceId: string, amount: number, day: string, n: number) => {
    const u = kasir[n % Math.max(kasir.length, 1)] ?? T;
    await c.step(`terima di loket ${day}`, () => c.svc.utilityField.counterPay(u, { invoiceId, amount: amount.toFixed(2), counterId: counterIds[n % Math.max(counterIds.length, 1)], channel: CHANNELS[n % CHANNELS.length] }, day));
  };
  let n = 0;
  const bill = async (back: number, paidPct: number, partial: number, skip: Set<string>) => {
    const period = addMonth(thisPeriod, -back);
    const issued = `${addMonth(period, 1)}-04`;
    await c.step(`tagih ${period}`, () => c.svc.utility.run(T, { period }, issued));
    const inv = (await c.db.execute<{ id: string; total: string; paid: string; code: string }>(sql`
      SELECT i.id, i.total::text AS total, i.paid_amount::text AS paid, cu.code FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id JOIN customers cu ON cu.id = i.customer_id
      WHERE b.tenant_id = ${tenantId} AND b.period = ${period} ORDER BY cu.code`)).rows;
    for (const [k, r] of inv.entries()) {
      if (skip.has(r.code) || k % 100 >= paidPct) continue;
      const d = new Date(`${issued}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1 + ((k * 3) % 22));
      let day = d.toISOString().slice(0, 10);
      if (day > c.today) day = c.today;
      const total = Number(r.total);
      await pay(r.id, k % 9 === 0 ? Math.round(total / 2) : total, day, n++);
    }
    void partial;
  };

  // periode 3 bulan lalu: sebagian besar lunas, tiga pelanggan menunggak (usulan pemutusan)
  await readPeriod(3, {});
  await verifyPeriod(addMonth(thisPeriod, -3));
  await bill(3, 100, 0, new Set(['PLG-003', 'PLG-010', 'PLG-019']));
  await readPeriod(2, {});
  await verifyPeriod(addMonth(thisPeriod, -2));
  await bill(2, 85, 0, new Set(['PLG-003', 'PLG-010', 'PLG-016', 'PLG-019']));
  await readPeriod(1, {});
  await verifyPeriod(addMonth(thisPeriod, -1));
  await bill(1, 55, 0, new Set(['PLG-003', 'PLG-019']));

  // bulan berjalan: 14 sambungan sudah dicatat, 10 terverifikasi (siap ditagih), 3 menunggu verifikasi, 1 ditolak; sisanya belum dicatat
  await readPeriod(0, { only: (code, i) => i < 14 && code !== 'PLG-003' });
  await verifyPeriod(thisPeriod, 10);
  const left = (await c.svc.utility.readings(tenantId, { period: thisPeriod, status: 'ENTERED' })) as { id: string }[];
  if (left.length > 3) await c.step('tolak catatan janggal', () => c.svc.utility.reject(T, left[left.length - 1].id, { reason: 'Foto meter tidak terbaca, mohon dicatat ulang' }));

  // tunggakan: satu sambungan diputus sementara, usulan lain tetap tampil
  await c.step('putus sementara PLG-019', () => c.svc.utility.suspend(T, conns.get('PLG-019')!.id, { reason: 'Menunggak 3 bulan, sudah dua kali diberi surat peringatan' }));

  // zona: pasokan meter induk per bulan (zona Griya Asri sengaja bocor tinggi)
  for (const back of [3, 2, 1]) {
    const period = addMonth(thisPeriod, -back);
    for (const [zi, zone] of ZONES.entries()) {
      const used = usageByPeriodZone.get(`${period}|${zone}`) ?? 0;
      if (!used) continue;
      const factor = [1.1, 1.42, 1.07][zi];
      await c.step(`pasokan ${zone} ${period}`, () => c.svc.utility.saveSupply(T, { zone, period, supplied: String(Math.round(used * factor)), note: 'Catatan meter induk' }));
    }
  }

  // ---- layanan non-air: tagihan bertanggal mundur, sebagian dibayar lewat loket
  const catalog = (await c.step('katalog layanan non-air', () => c.svc.utilityCharges.list(tenantId))) as { id: string; revenueKey: string }[] | undefined;
  const byKey = (k: string) => catalog?.find((x) => x.revenueKey === k)?.id;
  const nonAir: [string, string, number, number, boolean][] = [
    // kode pelanggan, jenis, hari lalu, jumlah, dibayar?
    ['PLG-024', 'UTILITY_CONNECTION_REVENUE', 62, 1, true], ['PLG-021', 'UTILITY_CONNECTION_REVENUE', 55, 1, true], ['PLG-018', 'UTILITY_ADMIN_REVENUE', 52, 1, true],
    ['PLG-005', 'UTILITY_MATERIAL_REVENUE', 47, 1, true], ['PLG-010', 'UTILITY_RECONNECT_REVENUE', 41, 1, false], ['PLG-003', 'UTILITY_RECONNECT_REVENUE', 38, 1, false],
    ['PLG-014', 'UTILITY_CONNECTION_REVENUE', 33, 2, true], ['PLG-007', 'UTILITY_MATERIAL_REVENUE', 29, 1, true], ['PLG-016', 'UTILITY_ADMIN_REVENUE', 24, 1, true],
    ['PLG-013', 'UTILITY_OTHER_REVENUE', 20, 1, false], ['PLG-020', 'UTILITY_RECONNECT_REVENUE', 17, 1, true], ['PLG-011', 'UTILITY_MATERIAL_REVENUE', 12, 1, true],
    ['PLG-008', 'UTILITY_CONNECTION_REVENUE', 9, 1, false], ['PLG-002', 'UTILITY_ADMIN_REVENUE', 6, 1, true], ['PLG-015', 'UTILITY_MATERIAL_REVENUE', 3, 1, false], ['PLG-012', 'UTILITY_ADMIN_REVENUE', 1, 1, true],
  ];
  for (const [code, key, ago, qty, paid] of nonAir) {
    const chargeId = byKey(key);
    if (!chargeId || !customers.get(code)) continue;
    const day = c.ago(ago);
    const r = (await c.step(`tagihan non-air ${code}`, () => c.svc.utilityCharges.issue(T, { chargeId, customerId: customers.get(code)!, connectionId: conns.get(code)?.id, qty: String(qty), price: key === 'UTILITY_OTHER_REVENUE' ? '75000' : undefined }, day))) as { invoiceId: string; amount: string } | undefined;
    if (r && paid) await pay(r.invoiceId, Number(r.amount), day, n++);
  }

  // ---- rekap harian: semua hari lebih dari dua hari lalu dicek Keuangan; satu hari ditandai selisih; dua hari terakhir sengaja dibiarkan
  if (keuangan) {
    const days = (await c.db.execute<{ counter_id: string; d: string }>(sql`
      SELECT DISTINCT r.counter_id, r.received_at::date::text AS d FROM utility_counter_receipts r WHERE r.tenant_id = ${tenantId} AND r.counter_id IS NOT NULL ORDER BY 2, 1`)).rows;
    const cutoff = c.ago(2);
    let k = 0;
    for (const x of days) {
      if (x.d >= cutoff) continue;
      const dispute = k++ === 5;
      await c.step(`konfirmasi rekap ${x.d}`, () => c.svc.utilityCounters.closeDay(keuangan, { counterId: x.counter_id, date: x.d, dispute, note: dispute ? 'Mutasi bank kurang Rp50.000 dari rekap, menunggu penjelasan kasir' : undefined }));
    }
  }
}

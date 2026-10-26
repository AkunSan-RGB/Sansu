import { sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { Demo } from './demo.kit';

/**
 * Data contoh layanan air lanjutan: pengaduan, perintah kerja, aset jaringan, permohonan sambungan, mutasi, koreksi tagihan, jaminan,
 * angsuran, rute, inventaris meter, taksiran, penagihan lapangan, surat peringatan, portal pelanggan, produksi, dan kualitas air.
 * Semua lewat service aplikasi supaya aturan (pemisahan fungsi, SLA, jurnal) ikut berlaku; hanya tanggal yang dimundurkan lewat SQL.
 */
export interface AirOpsInput {
  conns: Map<string, { id: string; number: string }>;
  customers: Map<string, string>;
  zoneOf: Map<string, string>;
  kasir: AuthUser[];
  keuangan?: AuthUser;
  lapangan: AuthUser[];
  pelayanan?: AuthUser;
  counterIds: string[];
  tariffRt: string;
}

const dayOf = (c: Demo, n: number) => c.ago(n);

export async function airOpsDemo(c: Demo, x: AirOpsInput) {
  const T = c.admin;
  const tenantId = c.tenantId;
  const w = c.svc.water;
  const [lap1, lap2] = x.lapangan;
  const cs = x.pelayanan ?? T;
  const fin = x.keuangan ?? T;
  const conn = (code: string) => x.conns.get(code)!;
  const cust = (code: string) => x.customers.get(code)!;
  const thisPeriod = c.today.slice(0, 7);
  if (!lap1 || !lap2) return;

  // ------------------------------------------------------------------ rute baca dan tagih
  const routeDefs = [
    { code: 'R-01', name: 'Rute Griya Asri', zone: 'Zona Griya Asri', readerId: lap1.sub, collectorId: lap2.sub },
    { code: 'R-02', name: 'Rute Gamping', zone: 'Zona Gamping', readerId: lap2.sub, collectorId: lap2.sub },
    { code: 'R-03', name: 'Rute Ngaglik', zone: 'Zona Ngaglik', readerId: lap1.sub, collectorId: lap1.sub },
  ];
  for (const r of routeDefs) {
    const saved = (await c.step(`rute ${r.code}`, () => w.routes.save(T, r))) as { id: string } | undefined;
    if (!saved) continue;
    const ids = [...x.conns.entries()].filter(([code]) => x.zoneOf.get(code) === r.zone).map(([, v]) => v.id);
    await c.step(`isi rute ${r.code}`, () => w.routes.assign(T, { routeId: saved.id, connectionIds: ids }));
  }

  // ------------------------------------------------------------------ inventaris meter, tera, ganti meter, taksiran
  await c.step('impor meter terpasang', () => w.meters.sync(lap1));
  const stock = ['S001', 'S002', 'S003', 'S004'];
  for (const [i, s] of stock.entries()) {
    await c.step(`meter stok ${s}`, () => w.meters.register(lap1, { serial: `MA-2026-${s}`, brand: i % 2 ? 'Sensus' : 'Itron', size: i === 3 ? '3/4"' : '1/2"', lastCalibratedOn: dayOf(c, 20 + i * 5) }));
  }
  const meterId = async (serial: string) => (await c.db.execute<{ id: string }>(sql`SELECT id FROM utility_meters WHERE tenant_id = ${tenantId} AND serial = ${serial}`)).rows[0]?.id;
  const newMeter = await meterId('MA-2026-S001');
  if (newMeter) await c.step('ganti meter PLG-011', () => w.meters.replace(lap1, { connectionId: conn('PLG-011').id, newMeterId: newMeter, oldStatus: 'RUSAK', reason: 'Kaca meter buram, angka tidak terbaca' }));
  // jadwal tera: dua sudah lewat, tiga jatuh tempo dalam 90 hari, satu baru ditera
  const due: [string, number][] = [['MA-2025-0003', -40], ['MA-2025-0012', -12], ['MA-2025-0007', 25], ['MA-2025-0015', 48], ['MA-2025-0021', 80]];
  for (const [serial, days] of due) {
    await c.db.execute(sql`UPDATE utility_meters SET next_calibration_on = ${dayOf(c, -days)}::date, last_calibrated_on = (${dayOf(c, -days)}::date - interval '5 years')::date WHERE tenant_id = ${tenantId} AND serial = ${serial}`);
  }
  const caliber = await meterId('MA-2025-0009');
  if (caliber) await c.step('tera ulang meter', () => w.meters.calibrate(lap1, caliber, { date: dayOf(c, 3), note: 'Ditera di UPT Metrologi, hasil sesuai' }));
  await c.step('taksir PLG-020', () => c.svc.utility.estimateReading(T, { connectionId: conn('PLG-020').id, period: thisPeriod, note: 'Meter tertutup tumpukan material bangunan, pemilik tidak di rumah' }));

  // ------------------------------------------------------------------ aset jaringan dan perintah kerja
  const assetDefs = [
    { code: 'SMR-01', name: 'Sumur Bor 1', type: 'SUMUR', zone: 'Zona Gamping', location: 'Dusun Gamping Lor', condition: 'BAIK' },
    { code: 'SMR-02', name: 'Sumur Bor 2', type: 'SUMUR', zone: 'Zona Gamping', location: 'Dusun Gamping Lor', condition: 'PERLU_PERAWATAN' },
    { code: 'IPA-01', name: 'Instalasi Pengolahan Sungai Tirta', type: 'IPA', zone: 'Zona Griya Asri', location: 'Tepi Sungai Tirta', condition: 'BAIK' },
    { code: 'PMP-01', name: 'Pompa Distribusi 1', type: 'POMPA', zone: 'Zona Griya Asri', location: 'Rumah pompa utama', condition: 'BAIK' },
    { code: 'PMP-02', name: 'Pompa Distribusi 2', type: 'POMPA', zone: 'Zona Griya Asri', location: 'Rumah pompa utama', condition: 'RUSAK' },
    { code: 'RSV-01', name: 'Reservoir Utama 500 m³', type: 'RESERVOIR', zone: 'Zona Griya Asri', location: 'Bukit Griya Asri', condition: 'PERLU_PERAWATAN' },
    { code: 'VLV-01', name: 'Valve Pembagi Griya Asri', type: 'VALVE', zone: 'Zona Griya Asri', location: 'Simpang Blok A', condition: 'BAIK' },
    { code: 'HDR-07', name: 'Hidran Pasar Gamping', type: 'HIDRAN', zone: 'Zona Gamping', location: 'Pasar Gamping', condition: 'BAIK' },
    { code: 'PTR-01', name: 'Pipa Transmisi Ø200 mm', type: 'PIPA_TRANSMISI', zone: 'Zona Ngaglik', location: 'Jl. Raya Ngaglik', condition: 'BAIK' },
    { code: 'MI-01', name: 'Meter Induk Zona Griya Asri', type: 'METER_INDUK', zone: 'Zona Griya Asri', location: 'Keluaran reservoir', condition: 'BAIK' },
  ] as const;
  const assetId = new Map<string, string>();
  for (const a of assetDefs) {
    const r = (await c.step(`aset ${a.code}`, () => w.assets.saveAsset(lap1, { ...a, installedOn: dayOf(c, 900) }))) as { id: string } | undefined;
    if (r) assetId.set(a.code, r.id);
  }

  // ------------------------------------------------------------------ pengaduan
  type Cat = 'AIR_MATI' | 'AIR_KERUH' | 'PIPA_BOCOR' | 'TEKANAN_KECIL' | 'METER_RUSAK' | 'TAGIHAN_SALAH';
  const ticket = async (label: string, dto: { code?: string; reporter?: string; phone?: string; category: Cat; description: string; location?: string; channel?: 'TELEPON' | 'DATANG' | 'WHATSAPP' | 'PETUGAS' }, hoursAgo: number) => {
    const r = (await c.step(`pengaduan ${label}`, () =>
      w.complaints.create(cs, { connectionId: dto.code ? conn(dto.code).id : undefined, reporterName: dto.reporter, reporterPhone: dto.phone, category: dto.category, description: dto.description, location: dto.location, channel: dto.channel ?? 'TELEPON' }),
    )) as { id: string } | undefined;
    if (r) {
      await c.db.execute(sql`UPDATE utility_complaints SET due_at = due_at - (created_at - (now() - make_interval(hours => ${hoursAgo}))), created_at = now() - make_interval(hours => ${hoursAgo}) WHERE id = ${r.id}`);
      await c.db.execute(sql`UPDATE utility_complaint_events SET at = now() - make_interval(hours => ${hoursAgo}) WHERE complaint_id = ${r.id}`);
    }
    return r?.id;
  };
  const resolvedAfter = (id: string, hours: number) => c.db.execute(sql`UPDATE utility_complaints SET resolved_at = created_at + make_interval(hours => ${hours}) WHERE id = ${id}`);

  const t1 = await ticket('pipa bocor', { code: 'PLG-007', phone: '081234567007', category: 'PIPA_BOCOR', description: 'Pipa dinas bocor di depan rumah, air meluap ke jalan sejak kemarin sore', location: 'Depan Griya Asri Blok C-01', channel: 'TELEPON' }, 20);
  const t2 = await ticket('air mati blok', { reporter: 'Pak RT 03 Griya Asri', phone: '081200000003', category: 'AIR_MATI', description: 'Air tidak mengalir sejak pagi di Blok A dan Blok B, sekitar 20 rumah terdampak', location: 'Griya Asri Blok A–B', channel: 'WHATSAPP' }, 5);
  if (t2) await c.step('tugaskan air mati', () => w.complaints.assign(cs, t2, { assigneeId: lap2.sub, note: 'Cek valve pembagi dan pompa distribusi' }));
  const t3 = await ticket('air keruh', { code: 'PLG-015', category: 'AIR_KERUH', description: 'Air berwarna kecokelatan dan berbau sejak dua hari', location: 'Perum Ngaglik Indah A-4', channel: 'DATANG' }, 30);
  if (t3) {
    await c.step('tugaskan air keruh', () => w.complaints.assign(cs, t3, { assigneeId: lap1.sub }));
    await c.step('mulai air keruh', () => w.complaints.setStatus(lap1, t3, { status: 'DIKERJAKAN', note: 'Menguras jaringan di ujung pipa' }));
  }
  const t4 = await ticket('tagihan salah', { code: 'PLG-009', category: 'TAGIHAN_SALAH', description: 'Tagihan bulan lalu tiga kali lipat dari biasanya, pelanggan menduga ada kebocoran di instalasi dalam', channel: 'DATANG' }, 96);
  if (t4) {
    await c.step('tugaskan tagihan', () => w.complaints.assign(cs, t4, { assigneeId: cs.sub }));
    await c.step('mulai tagihan', () => w.complaints.setStatus(cs, t4, { status: 'DIKERJAKAN' }));
    await c.step('selesai tagihan', () => w.complaints.setStatus(cs, t4, { status: 'SELESAI', resolution: 'Meter dicek ulang bersama pelanggan: ada kebocoran instalasi dalam. Diajukan koreksi pemakaian.' }));
    await c.step('tutup tagihan', () => w.complaints.setStatus(T, t4, { status: 'DITUTUP', note: 'Pelanggan sudah dihubungi' }));
    await resolvedAfter(t4, 20);
  }
  const t5 = await ticket('meter rusak', { code: 'PLG-005', category: 'METER_RUSAK', description: 'Meter macet, angka tidak bergerak walau air mengalir', channel: 'TELEPON' }, 150);
  if (t5) {
    await c.step('tugaskan meter', () => w.complaints.assign(cs, t5, { assigneeId: lap1.sub }));
    await c.step('mulai meter', () => w.complaints.setStatus(lap1, t5, { status: 'DIKERJAKAN' }));
    await c.step('selesai meter', () => w.complaints.setStatus(lap1, t5, { status: 'SELESAI', resolution: 'Meter lama diganti meter baru, angka awal dicatat 0' }));
    await c.step('tutup meter', () => w.complaints.setStatus(T, t5, { status: 'DITUTUP' }));
    await resolvedAfter(t5, 40);
  }
  const t6 = await ticket('tekanan kecil', { code: 'PLG-021', category: 'TEKANAN_KECIL', description: 'Air mengalir kecil di jam sibuk pagi hari', channel: 'PETUGAS' }, 52);
  if (t6) {
    await c.step('tugaskan tekanan', () => w.complaints.assign(cs, t6, { assigneeId: lap2.sub }));
    await c.step('mulai tekanan', () => w.complaints.setStatus(lap2, t6, { status: 'DIKERJAKAN' }));
    await c.step('selesai tekanan', () => w.complaints.setStatus(lap2, t6, { status: 'SELESAI', resolution: 'Valve di simpang dibuka penuh, tekanan normal kembali' }));
    await resolvedAfter(t6, 30);
  }
  const t7 = await ticket('air mati lama', { code: 'PLG-013', category: 'AIR_MATI', description: 'Air mati dari subuh, bengkel tidak bisa beroperasi', channel: 'TELEPON' }, 220);
  if (t7) {
    await c.step('tugaskan air mati lama', () => w.complaints.assign(cs, t7, { assigneeId: lap1.sub }));
    await c.step('mulai air mati lama', () => w.complaints.setStatus(lap1, t7, { status: 'DIKERJAKAN' }));
    await c.step('selesai air mati lama', () => w.complaints.setStatus(lap1, t7, { status: 'SELESAI', resolution: 'Pipa sambungan tersumbat endapan, dibersihkan dan dialirkan kembali' }));
    await c.step('tutup air mati lama', () => w.complaints.setStatus(fin, t7, { status: 'DITUTUP' }));
    await resolvedAfter(t7, 30); // melewati batas 24 jam: terhitung terlambat
  }

  // perintah kerja: dari pengaduan pipa bocor, perbaikan pompa, perawatan reservoir, penggantian valve
  const wo = async (label: string, dto: Parameters<typeof w.assets.createOrder>[1]) => ((await c.step(`PK ${label}`, () => w.assets.createOrder(cs, dto))) as { id: string } | undefined)?.id;
  const backdateWo = (id: string, daysAgo: number, doneDays?: number) => c.db.execute(sql`UPDATE utility_work_orders SET created_at = now() - make_interval(days => ${daysAgo}), started_at = CASE WHEN started_at IS NOT NULL THEN now() - make_interval(days => ${doneDays ?? daysAgo}) END, finished_at = CASE WHEN finished_at IS NOT NULL THEN now() - make_interval(days => ${doneDays ?? daysAgo}) END WHERE id = ${id}`);
  if (t1) {
    const id = await wo('pipa bocor', { complaintId: t1, type: 'PERBAIKAN', title: 'Perbaiki pipa bocor depan Griya Asri C-01', priority: 'TINGGI', assigneeId: lap2.sub, plannedOn: c.today });
    if (id) await c.step('mulai PK pipa bocor', () => w.assets.setOrderStatus(lap2, id, { status: 'DIKERJAKAN' }));
  }
  const pk2 = await wo('pompa', { assetId: assetId.get('PMP-02'), type: 'PERBAIKAN', title: 'Ganti bearing dan seal Pompa Distribusi 2', priority: 'TINGGI', assigneeId: lap2.sub, plannedOn: dayOf(c, -2) });
  void pk2;
  const pk3 = await wo('reservoir', { assetId: assetId.get('RSV-01'), type: 'PERAWATAN', title: 'Kuras dan sikat dinding Reservoir Utama', priority: 'NORMAL', assigneeId: lap1.sub, plannedOn: dayOf(c, -9) });
  void pk3;
  const pk4 = await wo('valve', { assetId: assetId.get('VLV-01'), type: 'PENGGANTIAN', title: 'Ganti valve pembagi yang macet', priority: 'NORMAL', assigneeId: lap2.sub, plannedOn: dayOf(c, 12) });
  if (pk4) {
    await c.step('mulai PK valve', () => w.assets.setOrderStatus(lap2, pk4, { status: 'DIKERJAKAN' }));
    await c.step('selesai PK valve', () => w.assets.setOrderStatus(lap2, pk4, { status: 'SELESAI', result: 'Valve gate 6 inci diganti baru, tidak ada kebocoran setelah diuji tekanan', laborCost: '650000', materialCost: '2400000', assetCondition: 'BAIK' }));
    await backdateWo(pk4, 14, 12);
  }
  const pk5 = await wo('hidran', { assetId: assetId.get('HDR-07'), type: 'PERAWATAN', title: 'Pelumasan dan uji semprot hidran pasar', priority: 'RENDAH', assigneeId: lap1.sub });
  if (pk5) {
    await c.step('mulai PK hidran', () => w.assets.setOrderStatus(lap1, pk5, { status: 'DIKERJAKAN' }));
    await c.step('selesai PK hidran', () => w.assets.setOrderStatus(lap1, pk5, { status: 'SELESAI', result: 'Hidran diuji semprot 10 menit, tekanan baik', laborCost: '200000', materialCost: '85000' }));
    await backdateWo(pk5, 8, 7);
  }
  const pk6 = await wo('sumur', { assetId: assetId.get('SMR-02'), type: 'PERAWATAN', title: 'Servis pompa celup Sumur Bor 2', priority: 'NORMAL', assigneeId: lap1.sub });
  if (pk6) await c.step('batal PK sumur', () => w.assets.setOrderStatus(lap1, pk6, { status: 'BATAL', result: 'Ditunda menunggu suku cadang dari pemasok' }));

  // ------------------------------------------------------------------ permohonan sambungan baru di tiap tahap
  const apply = async (name: string, address: string, phone: string, daysAgo: number) => {
    const r = (await c.step(`permohonan ${name}`, () => w.applications.create(cs, { applicantName: name, phone, idNumber: `34040${c.int(10000000000, 99999999999)}`, address, tariffId: x.tariffRt }))) as { id: string } | undefined;
    if (r) await c.db.execute(sql`UPDATE utility_applications SET requested_on = ${dayOf(c, daysAgo)}::date WHERE id = ${r.id}`);
    return r?.id;
  };
  await apply('Bambang Hermawan', 'Perum Ngaglik Indah E-5, Sleman', '081322110001', 1);
  const a2 = await apply('Citra Dewi', 'Griya Asri Blok D-04, Sleman', '081322110002', 4);
  if (a2) await c.step('survei Citra', () => w.applications.survey(lap1, a2, { feasible: true, pipeLength: '35', note: 'Pipa distribusi 35 m dari lokasi, tidak melewati jalan provinsi', tariffId: x.tariffRt }));
  const a3 = await apply('Toko Sembako Berkah', 'Jl. Pelosok Km 12, Sleman', '081322110003', 6);
  if (a3) await c.step('survei Toko', () => w.applications.survey(lap1, a3, { feasible: false, note: 'Pipa distribusi terdekat 400 m, belum terjangkau jaringan' }));
  const a4 = await apply('Endang Lestari', 'Dusun Gamping Lor RT 04, Sleman', '081322110004', 8);
  if (a4) {
    await c.step('survei Endang', () => w.applications.survey(lap2, a4, { feasible: true, pipeLength: '12', note: 'Lokasi dekat pipa tersier, mudah dipasang', tariffId: x.tariffRt }));
    await c.step('tagihan Endang', () => w.applications.quote(cs, a4, {}));
  }
  const a5 = await apply('Fajar Nugroho', 'Perum Ngaglik Indah F-2, Sleman', '081322110005', 11);
  const a6 = await apply('Gunawan Setiadi', 'Griya Asri Blok E-01, Sleman', '081322110006', 20);
  for (const [idx, id] of [a5, a6].entries()) {
    if (!id) continue;
    await c.step(`survei ${idx}`, () => w.applications.survey(lap1, id, { feasible: true, pipeLength: String(20 + idx * 8), note: 'Layak, jarak pipa dekat', tariffId: x.tariffRt }));
    await c.step(`tagihan ${idx}`, () => w.applications.quote(cs, id, {}));
    const app = (await c.step(`baca permohonan ${idx}`, () => w.applications.get(tenantId, id))) as { cost_invoice_id: string; invoice_total: string } | undefined;
    if (app?.cost_invoice_id) await c.step(`bayar sambung ${idx}`, () => c.svc.utilityField.counterPay(x.kasir[idx % Math.max(x.kasir.length, 1)] ?? T, { invoiceId: app.cost_invoice_id, amount: Number(app.invoice_total).toFixed(2), counterId: x.counterIds[idx % Math.max(x.counterIds.length, 1)], channel: 'QRIS' }));
    const serial = `MA-2026-${stock[1 + idx]}`;
    await c.step(`pasang ${idx}`, () => w.applications.install(cs, id, { installerId: (idx ? lap2 : lap1).sub, meterSerial: serial, note: 'Dipasang bersama pemohon' }));
  }
  if (a6) await c.step('aktifkan Gunawan', () => w.applications.activate(fin, a6, { initialReading: '0', zone: 'Zona Griya Asri' }));

  // ------------------------------------------------------------------ mutasi pelanggan (diajukan pelayanan, disetujui orang lain)
  const heri = await c.step('pelanggan baru Heri', () => c.svc.customers.create(tenantId, { code: 'PLG-025', name: 'Heri Setiawan', address: 'Perum Ngaglik Indah D-2, Sleman', phone: '081322119999', creditLimit: '0', paymentTermDays: 14 }));
  const heriId = (heri as { id: string } | undefined)?.id;
  if (heriId) {
    const ch = (await c.step('ajukan balik nama', () => w.changes.request(cs, { connectionId: conn('PLG-024').id, kind: 'BALIK_NAMA', newCustomerId: heriId, reason: 'Rumah dijual, pemilik baru membawa akta jual beli' }))) as { id: string } | undefined;
    if (ch) await c.step('setujui balik nama', () => w.changes.approve(fin, ch.id, { note: 'Dokumen AJB lengkap' }));
  }
  const tariffNiaga = (await c.db.execute<{ id: string }>(sql`SELECT id FROM utility_tariffs WHERE tenant_id = ${tenantId} AND name ILIKE '%niaga%' AND metered ORDER BY name LIMIT 1`)).rows[0]?.id;
  if (tariffNiaga) await c.step('ajukan ganti golongan', () => w.changes.request(cs, { connectionId: conn('PLG-023').id, kind: 'GANTI_TARIF', newTariffId: tariffNiaga, reason: 'Rumah kontrakan kini dipakai usaha laundry' }));
  const mv = (await c.step('ajukan pindah alamat', () => w.changes.request(cs, { connectionId: conn('PLG-020').id, kind: 'PINDAH_ALAMAT', newAddress: 'Dusun Ngaglik Kidul RT 09, Sleman', newZone: 'Zona Ngaglik', reason: 'Meter dipindah ke depan pagar agar mudah dibaca' }))) as { id: string } | undefined;
  if (mv) await c.step('tolak pindah alamat', () => w.changes.reject(fin, mv.id, { note: 'Belum ada surat izin dari ketua RT' }));
  await c.step('ajukan tutup permanen', () => w.changes.request(cs, { connectionId: conn('PLG-022').id, kind: 'TUTUP_PERMANEN', reason: 'Bangunan dibongkar untuk pelebaran jalan' }));

  // ------------------------------------------------------------------ koreksi tagihan dan pemutihan denda
  const openInvoice = async (code: string) => (await c.db.execute<{ id: string; open: string }>(sql`
    SELECT i.id, (i.total - i.paid_amount - i.returned_amount)::text AS open FROM invoices i JOIN utility_bills b ON b.invoice_id = i.id JOIN customers cu ON cu.id = i.customer_id
    WHERE b.tenant_id = ${tenantId} AND cu.code = ${code} AND i.total - i.paid_amount - i.returned_amount > 20000 ORDER BY i.date DESC LIMIT 1`)).rows[0];
  const part = (open: string, cap: number, share: number) => String(Math.round(Math.min(cap, Number(open) * share)));
  const inv9 = await openInvoice('PLG-004');
  if (inv9) {
    const a = (await c.step('ajukan koreksi PLG-004', () => w.adjustments.request(cs, { invoiceId: inv9.id, kind: 'KOREKSI_PEMAKAIAN', amount: part(inv9.open, 45000, 0.4), reason: 'Kebocoran instalasi dalam terbukti saat pengecekan, pemakaian dikoreksi' }))) as { id: string } | undefined;
    if (a) await c.step('setujui koreksi PLG-004', () => w.adjustments.approve(fin, a.id, { note: 'Sesuai berita acara pengecekan' }));
  }
  const inv7 = await openInvoice('PLG-008');
  if (inv7) await c.step('ajukan kompensasi PLG-008', () => w.adjustments.request(cs, { invoiceId: inv7.id, kind: 'KOMPENSASI', amount: part(inv7.open, 25000, 0.5), reason: 'Air mati 20 jam akibat pipa bocor, diberi kompensasi' }));
  const inv21 = await openInvoice('PLG-011');
  if (inv21) {
    const a = (await c.step('ajukan kompensasi PLG-011', () => w.adjustments.request(cs, { invoiceId: inv21.id, kind: 'KOMPENSASI', amount: part(inv21.open, 30000, 0.5), reason: 'Tekanan air kecil beberapa hari' }))) as { id: string } | undefined;
    if (a) await c.step('tolak kompensasi PLG-011', () => w.adjustments.reject(fin, a.id, { note: 'Penyebab sudah diperbaiki dalam SLA, tidak ada kompensasi' }));
  }
  const inv1 = await openInvoice('PLG-001');
  if (inv1) await c.step('ajukan pembatalan PLG-001', () => w.adjustments.request(cs, { invoiceId: inv1.id, kind: 'KOREKSI_PEMAKAIAN', amount: part(inv1.open, 60000, 0.6), reason: 'Rumah ditinggal seminggu, pemakaian tercatat janggal; pelanggan melapor lewat portal' }));
  const withFee = (await c.db.execute<{ id: string; fee: string }>(sql`
    SELECT i.id, b.late_fee::text AS fee FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.tenant_id = ${tenantId} AND b.late_fee > 0 AND i.total - i.paid_amount - i.returned_amount > b.late_fee ORDER BY b.late_fee DESC LIMIT 1`)).rows[0];
  if (withFee) {
    const a = (await c.step('ajukan pemutihan denda', () => w.adjustments.request(cs, { invoiceId: withFee.id, kind: 'PEMUTIHAN_DENDA', amount: withFee.fee, reason: 'Program pemutihan denda bulan ini bagi pelanggan yang melunasi pokok' }))) as { id: string } | undefined;
    if (a) await c.step('setujui pemutihan denda', () => w.adjustments.approve(fin, a.id, { note: 'Sesuai kebijakan direksi' }));
  }

  // ------------------------------------------------------------------ jaminan sambungan
  const dep = async (code: string, amount: string, note: string) => ((await c.step(`jaminan ${code}`, () => w.deposits.receive(T, { customerId: cust(code), connectionId: conn(code).id, amount, note }))) as { id: string } | undefined)?.id;
  const d3 = await dep('PLG-003', '300000', 'Jaminan sambungan baru');
  await dep('PLG-021', '500000', 'Jaminan sambungan instansi');
  await dep('PLG-014', '750000', 'Jaminan sambungan niaga (kost)');
  const d17 = await dep('PLG-017', '250000', 'Jaminan sambungan sosial');
  const arrears3 = await openInvoice('PLG-003');
  if (d3 && arrears3) await c.step('pakai jaminan PLG-003', () => w.deposits.offset(fin, d3, { invoiceId: arrears3.id, amount: part(arrears3.open, 150000, 0.5) }));
  if (d17) await c.step('kembalikan jaminan PLG-017', () => w.deposits.refund(fin, d17, { amount: '100000', note: 'Pengembalian sebagian karena penurunan daya' }));

  // ------------------------------------------------------------------ angsuran tunggakan
  for (const [code, count, approve] of [['PLG-010', 3, true], ['PLG-016', 2, false]] as const) {
    const cover = (await c.step(`tunggakan ${code}`, () => w.installments.coverable(tenantId, conn(code).id))) as { id: string }[] | undefined;
    if (!cover?.length) continue;
    const plan = (await c.step(`ajukan angsuran ${code}`, () => w.installments.request(cs, { connectionId: conn(code).id, invoiceIds: cover.map((r) => r.id), count, firstDue: dayOf(c, -7), intervalDays: 30, note: 'Pelanggan terdampak PHK, minta dicicil' }))) as { id: string } | undefined;
    if (plan && approve) await c.step(`setujui angsuran ${code}`, () => w.installments.approve(fin, plan.id, { note: 'Disetujui dengan syarat cicilan pertama tepat waktu' }));
  }

  // ------------------------------------------------------------------ penagihan lapangan (kolektor)
  const visit = async (u: AuthUser, code: string, dto: { outcome: 'BAYAR' | 'JANJI_BAYAR' | 'TIDAK_ADA' | 'MENOLAK' | 'PINDAH' | 'LAINNYA'; promisedOn?: string; promisedAmount?: number; note?: string }, daysAgo = 0) => {
    const r = (await c.step(`kunjungan ${code}`, () => w.collection.record(u, { connectionId: conn(code).id, ...dto, lat: -7.72, lng: 110.35 }))) as { id: string } | undefined;
    if (r && daysAgo) await c.db.execute(sql`UPDATE utility_collection_visits SET visited_at = now() - make_interval(days => ${daysAgo}) WHERE id = ${r.id}`);
    return r?.id;
  };
  await visit(lap2, 'PLG-003', { outcome: 'TIDAK_ADA', note: 'Rumah kosong, dititipkan surat ke tetangga' }, 6);
  await visit(lap2, 'PLG-003', { outcome: 'JANJI_BAYAR', promisedOn: dayOf(c, -3), note: 'Gajian tanggal tiga, janji bayar sebagian' });
  const v10 = await visit(lap2, 'PLG-010', { outcome: 'JANJI_BAYAR', promisedOn: dayOf(c, -2), note: 'Menunggu pencairan arisan' }, 4);
  if (v10) await c.db.execute(sql`UPDATE utility_collection_visits SET promised_on = ${dayOf(c, 2)}::date WHERE id = ${v10}`); // janji sudah lewat: ingkar
  await visit(lap1, 'PLG-016', { outcome: 'MENOLAK', note: 'Merasa tagihan terlalu besar, minta pengecekan meter' }, 2);
  await visit(lap1, 'PLG-019', { outcome: 'LAINNYA', note: 'Usaha tutup sejak tiga bulan, pemilik belum bisa dihubungi' }, 1);

  // ------------------------------------------------------------------ cetak dan kirim massal (rekening, pengingat, SP1–SP3)
  const sendNotices = async (kind: 'REKENING' | 'PENGINGAT' | 'SP1' | 'SP2' | 'SP3', channel: 'CETAK' | 'WHATSAPP' | 'SMS', take: number, daysAgo: number) => {
    const cand = (await c.step(`calon ${kind}`, () => w.notices.candidates(tenantId, kind, kind === 'REKENING' ? `${thisPeriod.slice(0, 5)}${String(Number(thisPeriod.slice(5)) - 1 || 12).padStart(2, '0')}` : undefined))) as { rows: { connection_id: string; invoice_id: string }[] } | undefined;
    const rows = (cand?.rows ?? []).slice(0, take);
    if (!rows.length) return;
    await c.step(`kirim ${kind}`, () => w.notices.log(cs, { kind, channel, items: rows.map((r) => ({ connectionId: r.connection_id, invoiceId: r.invoice_id })) }));
    await c.db.execute(sql`UPDATE utility_notices SET sent_at = now() - make_interval(days => ${daysAgo}) WHERE tenant_id = ${tenantId} AND kind = ${kind} AND created_at >= now() - interval '1 minute'`);
  };
  await sendNotices('REKENING', 'CETAK', 24, 12);
  await sendNotices('PENGINGAT', 'WHATSAPP', 8, 5);
  await sendNotices('SP1', 'WHATSAPP', 1, 9); // sisanya sengaja belum dikirim agar halaman Cetak & kirim punya pekerjaan

  // ------------------------------------------------------------------ portal pelanggan
  for (const code of ['PLG-001', 'PLG-009', 'PLG-008']) {
    const link = (await c.step(`tautan portal ${code}`, () => w.portal.issue(cs, conn(code).id))) as { token: string } | undefined;
    if (!link) continue;
    const scope = { tenantId, connectionId: conn(code).id, tokenId: '' };
    if (code === 'PLG-008') await c.step('pengaduan portal air mati', () => w.portal.complain(scope, { category: 'AIR_MATI', description: 'Air mengalir sangat kecil sejak semalam, mohon dicek', phone: '081200008888' }));
    if (code === 'PLG-001') await c.step('pengaduan portal tagihan', () => w.portal.complain(scope, { category: 'TAGIHAN_SALAH', description: 'Pemakaian bulan lalu tercatat 40 m³ padahal rumah ditinggal seminggu', phone: '081200001111' }));
  }

  // ------------------------------------------------------------------ produksi air dan kualitas air
  const billed = (await c.db.execute<{ period: string; v: string }>(sql`SELECT period, SUM(usage)::text AS v FROM utility_bills WHERE tenant_id = ${tenantId} GROUP BY period`)).rows;
  const billedBy = new Map(billed.map((r) => [r.period, Number(r.v)]));
  const avgBilled = billed.length ? [...billedBy.values()].reduce((a, v) => a + v, 0) / billed.length : 400;
  const dim = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
  const factor: Record<number, number> = { 0: 1.3, 1: 1.34, 2: 1.28, 3: 1.31 };
  for (let n = 0; n <= 125; n++) {
    const date = dayOf(c, n);
    const period = date.slice(0, 7);
    const back = (Number(thisPeriod.slice(0, 4)) * 12 + Number(thisPeriod.slice(5))) - (Number(period.slice(0, 4)) * 12 + Number(period.slice(5)));
    const perDay = ((billedBy.get(period) ?? avgBilled) * (factor[back] ?? 1.3)) / dim(period);
    const dist = Math.round(perDay * (0.94 + ((n * 7) % 13) / 100));
    const sources: [string, number][] = [['IPA Sungai Tirta', 0.62], ['Sumur Bor 1', 0.38]];
    for (const [source, share] of sources) {
      const d = Math.round(dist * share * 10) / 10;
      await c.step(`produksi ${date} ${source}`, () => w.production.save(lap1, { date, source, produced: Math.round(d * 1.05 * 10) / 10, distributed: d, ownUse: Math.round(d * 0.02 * 10) / 10, energyKwh: Math.round(d * 0.45), note: n === 0 ? 'Data hari ini' : undefined }));
    }
  }
  const points = ['Instalasi pengolahan (IPA)', 'Reservoir utama', 'Ujung jaringan Griya Asri', 'Ujung jaringan Ngaglik'];
  const sampleDays = [30, 27, 23, 20, 16, 13, 9, 6, 3, 0];
  for (const [i, days] of sampleDays.entries()) {
    for (const [pi, point] of points.entries()) {
      if ((i + pi) % 2 && days > 6) continue;
      const bad = (days === 13 && pi === 3) || (days === 6 && pi === 2);
      const dto = bad
        ? days === 13 ? { ph: 7.1, turbidity: 2.2, chlorine: 0.08, coliform: 3, tds: 260, note: 'Sisa klor rendah dan coliform positif; diambil sampel ulang dan jaringan dikuras' } : { ph: 7.3, turbidity: 6.2, chlorine: 0.4, coliform: 0, tds: 310, note: 'Kekeruhan tinggi setelah perbaikan pipa, jaringan dikuras' }
        : { ph: 6.9 + ((i + pi) % 6) / 10, turbidity: 0.7 + ((i * 3 + pi) % 9) / 6, chlorine: 0.35 + ((i + pi * 2) % 5) / 10, coliform: 0, tds: 190 + ((i * 11 + pi * 17) % 90) };
      await c.step(`uji ${point} ${days}`, () => w.production.qualitySave(lap1, { sampledOn: dayOf(c, days), point, ...dto }));
    }
  }
}

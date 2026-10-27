import { Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

const logger = new Logger('DemoData');
import { addDays } from '../../common/utils/dates';
import { boms, employeeChangeRequests, employees, stockBalances, utilityConnections } from '../../db/schema';
import { OutboxService } from '../utility-ops/outbox.service';
import { VaService } from '../utility-ops/va.service';
import { ServiceWorkService } from '../payroll/service-work.service';
import { QcService } from '../production/qc.service';
import { WorkCenterService } from '../production/work-centers.service';
import { SwapsService } from '../returns/swaps.service';
import { ConsignmentsService } from '../sales/consignment/consignments.service';
import { LoyaltyService } from '../pos/loyalty.service';
import { PriceAgreementsService } from '../purchasing/price-agreements.service';
import { SupplierAdvancesService } from '../purchasing/supplier-advances.service';
import { DeliveryTripsService, DeliveryVehiclesService } from '../sales/deliveries/delivery-trips.service';
import { RetainerService } from '../sales/services/retainers.service';
import { SchedulingService } from '../sales/services/scheduling.service';
import { TimesheetService } from '../sales/services/timesheets.service';
import { Demo, addCustomers, receive, sell } from './demo.kit';

/**
 * Pengisi lanjutan: halaman yang tidak terisi oleh transaksi utama tiap jenis usaha (stok minimum, kontrak harga, uang muka pemasok,
 * rute pengiriman, upah borongan, tutup buku, dst.). Semuanya lewat service aplikasi; tiap langkah boleh gagal tanpa menghentikan sisanya.
 */

/** Stok minimum: sebagian barang diset di atas stok (masuk daftar belanja & insight), sisanya aman */
export async function minimums(c: Demo, productIds: string[]) {
  if (!productIds.length) return;
  const rows = await c.db
    .select({ productId: stockBalances.productId, qty: stockBalances.qty })
    .from(stockBalances)
    .where(and(eq(stockBalances.tenantId, c.tenantId), eq(stockBalances.warehouseId, c.wh), inArray(stockBalances.productId, productIds)));
  const items = rows.map((r, i) => {
    const q = Number(r.qty);
    return { productId: r.productId, minQty: String(i % 3 === 0 ? Math.ceil(q * 1.4) + 1 : Math.max(1, Math.floor(q * 0.3))) };
  });
  await c.step('stok minimum', () => c.svc.ops.saveMinimums(c.admin, { warehouseId: c.wh, items }));
}

/** Kontrak harga pemasok: satu berlaku (disetujui), satu menunggu persetujuan */
export async function priceAgreements(c: Demo, rows: { supplierId: string; productId: string; price: number }[]) {
  const svc = c.get(PriceAgreementsService);
  for (const [i, r] of rows.entries()) {
    const a = (await c.step(`kontrak harga ${i + 1}`, () =>
      svc.create(c.admin, { supplierId: r.supplierId, productId: r.productId, price: String(r.price), validFrom: c.ago(30), validTo: c.ago(-335), note: 'Harga tetap setahun, volume sesuai pesanan' }),
    )) as { id: string } | undefined;
    if (a && i === 0) await c.step('setujui kontrak harga', () => svc.approve(c.admin, a.id, { note: 'Sesuai penawaran pemasok' }));
  }
}

/** Uang muka (DP) ke pemasok untuk pesanan yang belum diterima */
export async function supplierAdvance(c: Demo, supplierId: string, productId: string, price: number, qty = 50) {
  const po = (await c.step('pesanan dengan uang muka', () =>
    c.svc.po.create(c.admin, { supplierId, warehouseId: c.wh, date: c.ago(6), lines: [{ productId, qty: String(qty), price: String(price) }] }),
  )) as { id: string } | undefined;
  if (!po) return;
  await c.step('konfirmasi pesanan', () => c.svc.po.confirm(c.admin, po.id));
  const amount = Math.max(1000, Math.round((qty * price * 0.3) / 1000) * 1000);
  await c.step('uang muka pemasok', () =>
    c.get(SupplierAdvancesService).create(c.admin, { supplierId, purchaseOrderId: po.id, amount: String(amount), date: c.ago(5), method: 'TRANSFER', cashAccountId: c.bank, description: 'DP 30% pesanan barang' }),
  );
}

/** Barang bertanggal kedaluwarsa: satu lot sudah lewat, satu hampir, satu masih lama */
export async function expiringLots(c: Demo, supplierId: string, items: { productId: string; qty: number; price: number; expiresInDays: number }[]) {
  const po = (await c.step('pembelian barang berkedaluwarsa', () =>
    c.svc.po.create(c.admin, { supplierId, warehouseId: c.wh, date: c.ago(40), lines: items.map((l) => ({ productId: l.productId, qty: String(l.qty), price: String(l.price) })) }),
  )) as { id: string; lines: { id: string }[] } | undefined;
  if (!po) return;
  await c.step('konfirmasi', () => c.svc.po.confirm(c.admin, po.id));
  await c.step('terima barang berlot', () =>
    c.svc.grn.receive(c.admin, po.id, {
      date: c.ago(40),
      lines: po.lines.map((pl, i) => ({ orderLineId: pl.id, qty: String(items[i].qty), lotNo: `LOT-${c.today.slice(2, 4)}${String(i + 1).padStart(3, '0')}`, expiryDate: addDays(c.today, items[i].expiresInDays) })),
    }),
  );
}

/** Tutup buku: kunci pembukuan sampai akhir dua bulan lalu */
export async function closePeriod(c: Demo) {
  const firstOfLastMonth = addDays(`${c.today.slice(0, 7)}-01`, -1).slice(0, 7) + '-01';
  const until = addDays(firstOfLastMonth, -1);
  await c.step('kunci periode', () => c.svc.accounting.lockPeriod(c.admin, until));
}

/** Upah per satuan kerja (jam/sesi/borongan/shift) untuk karyawan yang ada: sebagian disetujui, sebagian menunggu */
export async function serviceWork(c: Demo, rates: { name: string; unit: 'HOUR' | 'SESSION' | 'JOB' | 'SHIFT'; rate: string; qty: string }[]) {
  const svc = c.get(ServiceWorkService);
  const staff = await c.db.select({ id: employees.id }).from(employees).where(eq(employees.tenantId, c.tenantId));
  if (!staff.length) return;
  for (const [ri, r] of rates.entries()) {
    const rate = (await c.step(`tarif ${r.name}`, () => svc.createRate(c.admin, { name: r.name, unit: r.unit, rate: r.rate }))) as { id: string } | undefined;
    if (!rate) continue;
    for (const [si, e] of staff.slice(0, 3).entries()) {
      // tanggal bentrok dengan absensi sakit/cuti ditolak: coba tanggal lain
      let en: { id: string } | undefined;
      for (let k = 0; k < 6 && !en; k++) {
        try {
          en = (await svc.create(c.admin, { employeeId: e.id, rateId: rate.id, workDate: c.ago(4 + si * 3 + ri + k * 11), quantity: r.qty, description: `${r.name} — minggu berjalan` })) as { id: string };
        } catch {
          /* tanggal bentrok: coba tanggal lain */
        }
      }
      if (en && si < 2) await c.step('setujui catatan kerja', () => svc.approve(c.admin, en.id, { note: 'Sesuai absensi' }));
    }
  }
}

/** Armada + rute: satu rute selesai (terkirim), satu masih direncanakan */
export async function deliveryTrips(c: Demo) {
  const veh = (await c.step('armada', () => c.get(DeliveryVehiclesService).create(c.admin, { plate: 'B 9120 CKG', name: 'Truk engkel', capacityKg: '2500', defaultDriver: 'Pak Slamet' }))) as { id: string } | undefined;
  const trips = c.get(DeliveryTripsService);
  const dels = (await trips.unscheduled(c.tenantId)) as { id: string }[];
  if (dels.length < 1) return;
  const first = dels.slice(0, 2).map((d) => d.id);
  const t1 = (await c.step('rute selesai', () => trips.create(c.admin, { date: c.ago(2), vehicleId: veh?.id, driverName: 'Pak Slamet', deliveryIds: first }))) as { id: string } | undefined;
  if (t1) {
    await c.step('berangkat', () => trips.depart(c.admin, t1.id, {}));
    const full = (await trips.get(c.tenantId, t1.id)) as { stops: { id: string }[] };
    for (const s of full.stops) await c.step('stop terkirim', () => trips.markStop(c.admin, t1.id, s.id, { result: 'DELIVERED', receivedBy: 'Penerima di lokasi' }));
    await c.step('rute selesai', () => trips.complete(c.admin, t1.id));
  }
  const rest = dels.slice(2, 4).map((d) => d.id);
  if (rest.length) await c.step('rute berikutnya', () => trips.create(c.admin, { date: addDays(c.today, 1), vehicleId: veh?.id, driverName: 'Pak Slamet', notes: 'Rute besok pagi', deliveryIds: rest }));
}

/** Daftar harga bertingkat untuk pelanggan grosir */
export async function priceLists(c: Demo, lists: { name: string; description: string; items: { productId: string; minQty: string; price: string }[] }[]) {
  for (const l of lists) {
    const pl = (await c.step(`daftar harga ${l.name}`, () => c.svc.pricing.createPriceList(c.admin, { name: l.name, description: l.description }))) as { id: string } | undefined;
    if (pl) await c.step(`isi daftar harga ${l.name}`, () => c.svc.pricing.replaceItems(c.admin, pl.id, l.items));
  }
}

/** Program loyalitas: pengaturan + anggota dengan saldo poin */
export async function loyalty(c: Demo) {
  const svc = c.get(LoyaltyService);
  await c.step('pengaturan loyalitas', () => svc.saveSettings(c.admin, { enabled: true, earnPerRp: 10000, pointValueRp: 100, minRedeemPoints: 50, maxRedeemPct: 50, expiryMonths: 12 }));
  const members = await addCustomers(c, [
    { code: `MBR-${c.model.slice(0, 3)}-02`, name: 'Ibu Sari (member)', address: 'Pasar Minggu, Jakarta', term: 0 },
    { code: `MBR-${c.model.slice(0, 3)}-03`, name: 'Pak Anwar (member)', address: 'Tanjung Barat, Jakarta', term: 0 },
    { code: `MBR-${c.model.slice(0, 3)}-04`, name: 'Ibu Maya (member)', address: 'Jagakarsa, Jakarta', term: 0 },
  ]);
  const pts = [420, 180, 75];
  let i = 0;
  for (const id of members.values()) {
    const points = pts[i++ % pts.length];
    await c.step('poin anggota', () => svc.adjust(c.admin, { customerId: id, points, reason: 'Saldo awal poin anggota (migrasi)' }));
  }
}

/** Permintaan perubahan data karyawan yang menunggu persetujuan (halaman Persetujuan & peringatan) */
export async function employmentChange(c: Demo) {
  const [e] = await c.db.select().from(employees).where(eq(employees.tenantId, c.tenantId)).limit(1);
  if (!e) return;
  await c.step('permintaan ubah gaji', async () => {
    const to = String(Math.round(Number(e.baseSalary) * 1.08));
    await c.db.insert(employeeChangeRequests).values({
      tenantId: c.tenantId,
      employeeId: e.id,
      changes: { baseSalary: { from: e.baseSalary, to } },
      reason: 'Penyesuaian gaji tahunan',
      requestedById: c.admin.sub,
    });
  });
}

/** Jasa: sumber daya (orang/ruang/alat) + jadwal (satu berulang, satu selesai jadi lembar waktu), tarif per jam + lembar waktu, retainer */
export async function jasaOperations(c: Demo, customerIds: string[], projectId?: string) {
  const sched = c.get(SchedulingService);
  const ts = c.get(TimesheetService);
  const ret = c.get(RetainerService);
  const staff = await c.db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.tenantId, c.tenantId));
  const person = staff[0] && ((await c.step('sumber daya orang', () => sched.saveResource(c.admin, { name: staff[0].name, kind: 'PERSON', employeeId: staff[0].id, workStart: 8, workEnd: 17, workDays: '1,2,3,4,5' }))) as { id: string } | undefined);
  const room = (await c.step('sumber daya ruang', () => sched.saveResource(c.admin, { name: 'Ruang Rapat A', kind: 'ROOM', workStart: 8, workEnd: 18, workDays: '1,2,3,4,5,6' }))) as { id: string } | undefined;
  await c.step('sumber daya alat', () => sched.saveResource(c.admin, { name: 'Proyektor & perangkat presentasi', kind: 'EQUIPMENT' }));
  const at = (days: number, h: number) => `${addDays(c.today, days)}T${String(h).padStart(2, '0')}:00:00+07:00`;
  if (person) {
    await c.step('jadwal 1', () => sched.book(c.admin, { resourceId: person.id, title: 'Workshop kebutuhan klien', startsAt: at(1, 9), endsAt: at(1, 12), customerId: customerIds[0], projectId }));
    await c.step('jadwal berulang', () => sched.bookRecurring(c.admin, { resourceId: person.id, title: 'Rapat kemajuan mingguan', startsAt: at(2, 14), endsAt: at(2, 15), repeat: 'WEEKLY', count: 4, customerId: customerIds[0] }));
    const past = (await c.step('jadwal selesai', () => sched.book(c.admin, { resourceId: person.id, title: 'Survei lokasi klien', startsAt: at(-3, 9), endsAt: at(-3, 11), customerId: customerIds[1] ?? customerIds[0] }))) as { id: string } | undefined;
    if (past) {
      await c.step('tandai selesai', () => sched.done(c.admin, past.id));
      await c.step('jadi lembar waktu', () => sched.toTimeEntry(c.admin, past.id));
    }
  }
  if (room) await c.step('jadwal ruang', () => sched.book(c.admin, { resourceId: room.id, title: 'Presentasi hasil ke klien', startsAt: at(3, 13), endsAt: at(3, 15), customerId: customerIds[0] }));

  await c.step('tarif per jam', () => ts.createRate(c.admin, { rate: '350000', validFrom: c.ago(120), note: 'Tarif standar konsultan' }));
  const entryIds: string[] = [];
  for (const [i, e] of staff.slice(0, 3).entries()) {
    for (let d = 0; d < 3; d++) {
      const en = (await c.step('lembar waktu', () =>
        ts.create(c.admin, { employeeId: e.id, customerId: customerIds[i % customerIds.length], workDate: c.ago(6 + d + i * 2), hours: String(2 + d), description: `Pekerjaan klien hari ke-${d + 1}`, billable: true }),
      )) as { id: string } | undefined;
      if (en) entryIds.push(en.id);
    }
  }
  if (entryIds.length) {
    await c.step('kirim lembar waktu', () => ts.submit(c.admin, entryIds));
    for (const id of entryIds.slice(0, 6)) await c.step('setujui lembar waktu', () => ts.approve(c.admin, id, {}));
  }

  const r1 = (await c.step('retainer 1', () => ret.create(c.admin, { customerId: customerIds[0], title: 'Retainer konsultasi bulanan', monthlyFee: '7500000', startDate: c.ago(120) }))) as { id: string } | undefined;
  await c.step('retainer 2', () => ret.create(c.admin, { customerId: customerIds[1] ?? customerIds[0], title: 'Retainer dukungan teknis', monthlyFee: '4200000', startDate: c.ago(60) }));
  if (r1) await c.step('tagih retainer', () => ret.bill(c.admin, r1.id, { period: addDays(c.today, -30).slice(0, 7), date: c.ago(28) }));
}

/** FMCG: tukar-guling barang kedaluwarsa/rusak (satu disetujui, satu menunggu) dan konsinyasi ke outlet (kirim, laporan terjual, faktur) */
export async function fmcgExtras(c: Demo, ids: Map<string, string>, cu: Map<string, string>) {
  const swaps = c.get(SwapsService);
  const cons = c.get(ConsignmentsService);
  const outlet = cu.get('OTL-ALFA')!;
  const inv = await c.step('faktur untuk tukar-guling', () => sell(c, outlet, 14, [{ productId: ids.get('FM-MIE')!, qty: 8 }]));
  if (inv) {
    await receive(c, inv, 6);
    const full = (await c.svc.inv.get(c.tenantId, inv)) as { lines: { id: string }[] };
    const line = full.lines[0]?.id;
    if (line) {
      const a = (await c.step('tukar-guling kedaluwarsa', () => swaps.create(c.admin, { invoiceId: inv, reason: 'EXPIRED', date: c.ago(5), notes: 'Mendekati kedaluwarsa, ditarik dan diganti baru', lines: [{ invoiceLineId: line, qty: '2', lotNo: 'MIE-2409A' }] }))) as { id: string } | undefined;
      if (a) await c.step('setujui tukar-guling', () => swaps.approve(c.admin, a.id));
      await c.step('tukar-guling rusak', () => swaps.create(c.admin, { invoiceId: inv, reason: 'DAMAGED', date: c.ago(3), notes: 'Dus penyok, isi aman; minta ganti', lines: [{ invoiceLineId: line, qty: '1' }] }));
    }
  }
  await c.step('kirim konsinyasi', () => cons.ship(c.admin, { customerId: outlet, fromWarehouseId: c.wh, date: c.ago(18), notes: 'Titipan produk baru ke rak minimarket', lines: [{ productId: ids.get('FM-KOPI')!, qty: '120' }, { productId: ids.get('FM-SHAMP')!, qty: '60' }] }));
  const r1 = (await c.step('laporan terjual 1', () => cons.report(c.admin, { customerId: outlet, reference: 'LP-ALFA-1010', date: c.ago(8), lines: [{ productId: ids.get('FM-KOPI')!, qty: '45' }, { productId: ids.get('FM-SHAMP')!, qty: '20' }] }))) as { id: string } | undefined;
  if (r1) await c.step('faktur konsinyasi', () => cons.invoice(c.admin, r1.id));
  await c.step('laporan terjual 2', () => cons.report(c.admin, { customerId: outlet, reference: 'LP-ALFA-1017', date: c.ago(2), lines: [{ productId: ids.get('FM-KOPI')!, qty: '30' }] }));
}

/** Manufaktur: pusat kerja + operasi per resep + jadwal mesin, dan pengendalian mutu (rencana mutu, inspeksi barang masuk) */
export async function manufakturExtras(c: Demo, ids: Map<string, string>, supplierId: string) {
  const wc = c.get(WorkCenterService);
  const centers: { id: string; name: string }[] = [];
  for (const w of [
    { code: 'MSN-POTONG', name: 'Mesin Potong & Ketam', kind: 'MACHINE' as const, laborRate: 28_000, overheadRate: 45_000 },
    { code: 'LIN-RAKIT', name: 'Lini Perakitan', kind: 'LINE' as const, laborRate: 32_000, overheadRate: 18_000 },
    { code: 'STS-FINISH', name: 'Stasiun Finishing & Politur', kind: 'STATION' as const, laborRate: 30_000, overheadRate: 22_000 },
  ]) {
    const r = (await c.step(`pusat kerja ${w.code}`, () => wc.save(c.admin, { ...w, capacityHours: 8 }))) as { id: string; name: string } | undefined;
    if (r) centers.push(r);
  }
  if (centers.length === 3) {
    await c.step('henti mesin terjadwal', () => wc.addDowntime(c.admin, centers[0].id, { startsAt: `${addDays(c.today, 2)}T13:00:00+07:00`, endsAt: `${addDays(c.today, 2)}T16:00:00+07:00`, reason: 'Penajaman pisau dan pelumasan berkala' }));
    const bomRows = await c.db.select({ id: boms.id }).from(boms).where(eq(boms.tenantId, c.tenantId));
    for (const b of bomRows) {
      await c.step('operasi resep', () =>
        wc.setBomOperations(c.admin, b.id, { operations: [{ name: 'Potong & ketam', workCenterId: centers[0].id, minutesPerBatch: 90 }, { name: 'Rakit', workCenterId: centers[1].id, minutesPerBatch: 120 }, { name: 'Finishing', workCenterId: centers[2].id, minutesPerBatch: 60 }] }),
      );
    }
    if (bomRows[0]) {
      const o = (await c.step('perintah produksi terjadwal', () => c.svc.production.createOrder(c.admin, { bomId: bomRows[0].id, warehouseId: c.wh, batches: '1', date: c.today }))) as { id: string } | undefined;
      if (o) {
        const ops = (await wc.orderOperations(c.tenantId, o.id)) as { id: string }[];
        for (const [i, op] of ops.entries()) {
          const day = addDays(c.today, 1 + i);
          await c.step('jadwalkan operasi', () => wc.schedule(c.admin, op.id, { startsAt: `${day}T08:00:00+07:00`, endsAt: `${day}T11:00:00+07:00` }));
        }
      }
    }
  }

  const qc = c.get(QcService);
  await c.step('gudang karantina', () => qc.setup(c.admin));
  await c.step('rencana mutu kayu', () =>
    qc.savePlan(c.admin, ids.get('FN-JATI')!, {
      name: 'Mutu kayu jati masuk',
      requireOnProduction: true,
      params: [
        { name: 'Kadar air (%)', kind: 'NUMERIC', minValue: 8, maxValue: 14, unit: '%', critical: true },
        { name: 'Tidak ada retak/rayap', kind: 'PASSFAIL' },
      ],
    }),
  );
  const po = (await c.step('beli kayu untuk QC', () =>
    c.svc.po.create(c.admin, { supplierId, warehouseId: c.wh, date: c.ago(5), lines: [{ productId: ids.get('FN-JATI')!, qty: '3', price: '9100000' }] }),
  )) as { id: string; lines: { id: string }[] } | undefined;
  if (!po) return;
  await c.step('konfirmasi', () => c.svc.po.confirm(c.admin, po.id));
  await c.step('terima kayu (karantina)', () => c.svc.grn.receive(c.admin, po.id, { date: c.ago(5), lines: po.lines.map((pl) => ({ orderLineId: pl.id, qty: '3' })) }));
  const list = (await qc.list(c.tenantId, {})) as { id: string }[];
  if (list[0]) {
    const full = (await qc.get(c.tenantId, list[0].id)) as unknown as { results: { id: string; kind: string }[] };
    await c.step('putuskan inspeksi', () => qc.decide(c.admin, list[0].id, { results: full.results.map((r) => (r.kind === 'NUMERIC' ? { resultId: r.id, value: 11 } : { resultId: r.id, pass: true })), note: 'Sesuai standar' }));
  }
}

/** Faktur jasa yang dipotong PPh 23 oleh pelanggan (halaman PPh dipotong) */
export async function withheldInvoices(c: Demo, rows: { customerId: string; ago: number; description: string; price: number }[]) {
  for (const [i, r] of rows.entries()) {
    const w = (await c.step('faktur dipotong PPh 23', () =>
      c.svc.billing.createInvoice(c.admin, { customerId: r.customerId, date: c.ago(r.ago), description: r.description, termLabel: 'Paket', withholdingType: 'PPH23', withholdingRate: '2', lines: [{ description: r.description, price: String(r.price) }] }),
    )) as { id: string } | undefined;
    if (w && i === 0) await c.step('bayar faktur dipotong', () => receive(c, w.id, Math.max(r.ago - 10, 1), 'TRANSFER', 0.98));
  }
}

/** Utilitas: pembayaran virtual account (cocok dan tak dikenal) + antrean pesan penagihan */
export async function utilityChannels(c: Demo) {
  const va = c.get(VaService);
  const outbox = c.get(OutboxService);
  await c.step('pengaturan VA', () => va.saveSettings(c.admin, { prefix: '8808', bankName: 'Bank Mitra Daerah' }));
  const conns = await c.db.select({ id: utilityConnections.id }).from(utilityConnections).where(eq(utilityConnections.tenantId, c.tenantId)).limit(4);
  for (const [i, cn] of conns.entries()) {
    const no = (await c.step('nomor VA', () => va.numberOf(c.tenantId, cn.id))) as { vaNumber?: string } | undefined;
    const number = no?.vaNumber;
    if (number) await c.step('pembayaran VA', () => va.receive(c.admin, { vaNumber: number, amount: String(85_000 + i * 12_500), reference: `VA-${c.today.replace(/-/g, '')}-${i + 1}`, channel: 'BCA', paidAt: new Date().toISOString() }));
  }
  await c.step('pembayaran VA tak dikenal', () => va.receive(c.admin, { vaNumber: '880899999999', amount: '120000', reference: `VA-${c.today.replace(/-/g, '')}-X`, channel: 'Mandiri' }));
  await c.step('pengaturan pesan', () => outbox.saveConfig(c.admin, { enabled: true, url: 'https://api.penyedia-pesan.example/send', authHeader: 'Authorization', token: 'demo-token', bodyTemplate: '{"to":"{to}","message":"{message}"}' }));
  // nomor ponsel contoh agar surat bisa diantrekan (tidak ada yang benar-benar terkirim: penyedia contoh tidak nyata)
  await c.step('nomor ponsel pelanggan', () => c.db.execute(sql`UPDATE customers SET phone = '0812' || LPAD((ABS(HASHTEXT(id::text)) % 100000000)::text, 8, '0') WHERE tenant_id = ${c.tenantId} AND (phone IS NULL OR phone = '')`));
  // surat tunggakan (SP1–SP3 menurut lama telat) dan rekening bulan lalu
  for (const kind of ['SP1', 'SP2', 'SP3', 'REKENING'] as const)
    await c.step(`antrekan ${kind}`, async () => {
      const r = await outbox.enqueue(c.admin, { kind, channel: 'WHATSAPP', all: true, period: addDays(`${c.today.slice(0, 7)}-01`, -1).slice(0, 7) });
      logger.log(`antrean ${kind}: ${JSON.stringify(r)}`);
    });
}

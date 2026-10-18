import { CRM_PROFILES } from '@sansu/shared';
import { and, eq, sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';
import { assetCategories, crmStages, journalEntries, journalLines, leads, suppliers, warehouses } from '../../db/schema';
import { Demo, receive } from './demo.kit';

/** Isi pelengkap yang khas tiap jenis usaha (supaya contoh tidak seragam) */
const FLAVOR: Record<string, {
  capital: [number, string, string];
  deposit: [number, string];
  prepaid: { amount: number; monthly: number; label: string; ref: string; months: number };
  petty: { fund: number; max: number; custodian: string; payee: string; items: [string, string, number, string][] };
  bankOpening: number;
  bankFee: number;
  countNote: string;
  denominations: Record<string, number>;
}> = {
  RITEL: {
    capital: [75_000_000, 'Tambahan modal untuk membuka cabang rak baru', 'SM-01'],
    deposit: [4_000_000, 'Setor tunai hasil penjualan kasir ke bank'],
    prepaid: { amount: 12_000_000, monthly: 1_000_000, label: 'sewa ruko toko (12 bulan)', ref: 'SWA-TOKO', months: 12 },
    petty: { fund: 1_500_000, max: 250_000, custodian: 'Kepala toko', payee: 'Toko kelontong sekitar', items: [['Plastik belanja & kertas struk', '6-6000', 85000, 'NT-101'], ['Galon air & kebersihan toko', '6-6000', 60000, 'NT-102'], ['Parkir & ongkos antar belanja', '6-2000', 70000, 'NT-103']] },
    bankOpening: 120_000_000,
    bankFee: 12000,
    countNote: 'Hitung laci kasir akhir shift',
    denominations: { K100000: 20, K50000: 60, K20000: 50, K10000: 80, K5000: 60, K2000: 100, K1000: 80 },
  },
  DAGANG: {
    capital: [100_000_000, 'Setoran modal tambahan untuk stok musim proyek', 'SM-01'],
    deposit: [10_000_000, 'Setor tunai pelunasan pelanggan ke bank'],
    prepaid: { amount: 9_000_000, monthly: 750_000, label: 'asuransi gudang & barang dagangan (12 bulan)', ref: 'ASR-GDG', months: 12 },
    petty: { fund: 3_000_000, max: 500_000, custodian: 'Admin gudang', payee: 'Toko bangunan setempat', items: [['Tali & lakban pengemasan', '6-6000', 140000, 'NT-101'], ['Solar forklift & kuli bongkar', '6-2000', 250000, 'NT-102'], ['Materai & fotokopi surat jalan', '6-6000', 75000, 'NT-103']] },
    bankOpening: 350_000_000,
    bankFee: 25000,
    countNote: 'Hitung kas penagihan sales lapangan',
    denominations: { K100000: 120, K50000: 60, K20000: 20, K10000: 10, K5000: 0, K2000: 0, K1000: 0 },
  },
  JASA: {
    capital: [40_000_000, 'Tambahan modal kerja untuk proyek baru', 'SM-01'],
    deposit: [2_000_000, 'Setor tunai pengganti biaya perjalanan klien ke bank'],
    prepaid: { amount: 18_000_000, monthly: 1_500_000, label: 'langganan lisensi perangkat lunak (12 bulan)', ref: 'LIS-2026', months: 12 },
    petty: { fund: 1_000_000, max: 200_000, custodian: 'Office manager', payee: 'Kafe & percetakan dekat kantor', items: [['Konsumsi rapat klien', '6-6000', 180000, 'NT-101'], ['Cetak & jilid laporan proyek', '6-6000', 95000, 'NT-102'], ['Transport taksi online ke klien', '6-2000', 120000, 'NT-103']] },
    bankOpening: 150_000_000,
    bankFee: 15000,
    countNote: 'Hitung kas kecil kantor',
    denominations: { K100000: 6, K50000: 8, K20000: 10, K10000: 10, K5000: 10, K2000: 5, K1000: 0 },
  },
  FMCG: {
    capital: [150_000_000, 'Setoran modal tambahan untuk stok menjelang musim lebaran', 'SM-01'],
    deposit: [8_000_000, 'Setor tunai hasil tagihan sales lapangan ke bank'],
    prepaid: { amount: 12_000_000, monthly: 1_000_000, label: 'asuransi gudang, armada & barang dagangan (12 bulan)', ref: 'ASR-FMCG', months: 12 },
    petty: { fund: 3_000_000, max: 500_000, custodian: 'Admin gudang', payee: 'Toko perlengkapan gudang', items: [['Lakban, tali & stretch film', '6-6000', 160000, 'NT-101'], ['Solar forklift & kuli bongkar muat', '6-2700', 280000, 'NT-102'], ['Parkir & tol sales kanvas', '6-2000', 90000, 'NT-103']] },
    bankOpening: 300_000_000,
    bankFee: 25000,
    countNote: 'Hitung setoran tagihan sales lapangan',
    denominations: { K100000: 90, K50000: 80, K20000: 40, K10000: 30, K5000: 10, K2000: 0, K1000: 0 },
  },
  FNB: {
    capital: [80_000_000, 'Tambahan modal untuk membuka outlet kedua', 'SM-01'],
    deposit: [3_500_000, 'Setor tunai hasil penjualan kasir kafe ke bank'],
    prepaid: { amount: 15_000_000, monthly: 1_250_000, label: 'sewa kios kafe (12 bulan)', ref: 'SWA-KAFE', months: 12 },
    petty: { fund: 1_500_000, max: 250_000, custodian: 'Kepala outlet', payee: 'Pasar dan toko bahan sekitar', items: [['Es batu & daun mint', '6-6000', 95000, 'NT-101'], ['Gas elpiji 3kg', '6-4000', 70000, 'NT-102'], ['Sabun cuci piring & lap dapur', '6-6000', 65000, 'NT-103']] },
    bankOpening: 140_000_000,
    bankFee: 15000,
    countNote: 'Hitung laci kasir akhir shift kafe',
    denominations: { K100000: 15, K50000: 50, K20000: 60, K10000: 80, K5000: 60, K2000: 80, K1000: 60 },
  },
  MANUFAKTUR: {
    capital: [150_000_000, 'Setoran modal untuk perluasan lini produksi', 'SM-01'],
    deposit: [5_000_000, 'Setor tunai penjualan eceran showroom ke bank'],
    prepaid: { amount: 24_000_000, monthly: 2_000_000, label: 'sewa gudang bahan baku (12 bulan)', ref: 'SWA-GDG', months: 12 },
    petty: { fund: 3_000_000, max: 400_000, custodian: 'Staf umum pabrik', payee: 'Toko teknik & bahan', items: [['Amplas, lem, dan kuas', '6-6000', 160000, 'NT-101'], ['APD sarung tangan & masker', '6-6000', 130000, 'NT-102'], ['Bensin pickup antar bahan', '6-2000', 150000, 'NT-103']] },
    bankOpening: 500_000_000,
    bankFee: 30000,
    countNote: 'Hitung kas showroom dan kas kecil pabrik',
    denominations: { K100000: 50, K50000: 40, K20000: 40, K10000: 40, K5000: 20, K2000: 10, K1000: 10 },
  },
};
const flavorOf = (c: Demo) => FLAVOR[c.model] ?? FLAVOR.DAGANG;

/** Pola operasi persediaan dan kehadiran yang khas tiap jenis usaha (isi, jumlah kejadian, dan jenisnya berbeda) */
type Ops = {
  warehouse2: string; transfers: { mode: 'IN_TRANSIT' | 'DIRECT'; qty: string; ago: number; notes: string }[]; countNote: string; shortages: number[];
  writedown: [number, string] | null; salesReturn: [string, string]; purchaseReturn: [string, string]; poQty: string; poPrice: string; requestNote: string; requestQty: string;
  sick: number; checkIn: [number, number]; checkOut: [number, number]; overtime: number; days: number; leave: [string, string];
};
const OPS: Record<string, Ops> = {
  RITEL: {
    warehouse2: 'Rak Display Toko 2',
    transfers: [{ mode: 'DIRECT', qty: '24', ago: 21, notes: 'Isi ulang rak toko cabang' }, { mode: 'DIRECT', qty: '12', ago: 14, notes: 'Tambahan barang promo akhir pekan' }, { mode: 'DIRECT', qty: '18', ago: 7, notes: 'Pindah barang laris ke rak kasir' }],
    countNote: 'Opname rak dan gudang belakang (cek harian kasir)', shortages: [3, 1, 2], writedown: [0.8, 'Barang mendekati kedaluwarsa, harga jual diturunkan'],
    salesReturn: ['Kemasan rusak, pembeli minta tukar', '1'], purchaseReturn: ['Barang mendekati kedaluwarsa saat diterima', '6'], poQty: '48', poPrice: '8000', requestNote: 'Stok rak cepat habis saat akhir pekan', requestQty: '60',
    sick: 0.03, checkIn: [8, 9], checkOut: [17, 21], overtime: 1, days: 12, leave: ['Libur keluarga', 'Menghadiri acara keluarga'],
  },
  DAGANG: {
    warehouse2: 'Gudang Cabang Proyek',
    transfers: [{ mode: 'IN_TRANSIT', qty: '40', ago: 20, notes: 'Pasok material ke gudang dekat proyek (dikirim truk)' }, { mode: 'DIRECT', qty: '15', ago: 8, notes: 'Pindah sisa stok untuk pesanan kontraktor' }],
    countNote: 'Opname gudang menjelang akhir bulan', shortages: [2], writedown: [0.9, 'Stok lama bergeser model, harga pasar turun'],
    salesReturn: ['Barang salah ukuran, dikembalikan kontraktor', '5'], purchaseReturn: ['Material retak saat bongkar muat', '10'], poQty: '100', poPrice: '55000', requestNote: 'Persediaan menipis, proyek besar bulan depan', requestQty: '120',
    sick: 0.04, checkIn: [7, 8], checkOut: [16, 17], overtime: 0, days: 10, leave: ['Cuti tahunan', 'Mengurus keperluan keluarga'],
  },
  FMCG: {
    warehouse2: 'Gudang Satelit (Mobil Kanvas)',
    transfers: [{ mode: 'IN_TRANSIT', qty: '12', ago: 20, notes: 'Isi mobil kanvas untuk rute pagi' }, { mode: 'DIRECT', qty: '6', ago: 9, notes: 'Tambah stok mobil kanvas rute Depok' }],
    countNote: 'Opname gudang distribusi (cek barang mendekati kedaluwarsa)', shortages: [2, 1, 0], writedown: [0.8, 'Barang mendekati kedaluwarsa, nilai diturunkan ke nilai jual bersih'],
    salesReturn: ['Kemasan penyok saat pengiriman, outlet minta tukar', '3'], purchaseReturn: ['Barang mendekati kedaluwarsa dikembalikan ke prinsipal', '6'], poQty: '100', poPrice: '41500', requestNote: 'Stok menipis menjelang musim lebaran', requestQty: '200',
    sick: 0.04, checkIn: [7, 8], checkOut: [16, 18], overtime: 2, days: 11, leave: ['Cuti tahunan', 'Keperluan keluarga'],
  },
  FNB: {
    warehouse2: 'Outlet Cabang 2 (Dapur Satelit)',
    transfers: [{ mode: 'IN_TRANSIT', qty: '3000', ago: 20, notes: 'Pasok bahan ke outlet cabang kedua' }, { mode: 'DIRECT', qty: '1500', ago: 9, notes: 'Tambah bahan untuk acara akhir pekan' }],
    countNote: 'Opname dapur dan gudang bahan (cek mingguan)', shortages: [800, 300, 0], writedown: [0.85, 'Susu cair dan bahan segar mendekati kedaluwarsa, nilai diturunkan'],
    salesReturn: ['Kemasan bocor saat diantar, diganti baru', '10'], purchaseReturn: ['Bahan tidak segar saat diterima', '500'], poQty: '20000', poPrice: '17', requestNote: 'Bahan cepat habis saat akhir pekan', requestQty: '30000',
    sick: 0.04, checkIn: [7, 9], checkOut: [17, 22], overtime: 2, days: 12, leave: ['Cuti tahunan', 'Mengurus keperluan keluarga'],
  },
  MANUFAKTUR: {
    warehouse2: 'Gudang Barang Jadi',
    transfers: [{ mode: 'IN_TRANSIT', qty: '10', ago: 19, notes: 'Pindah bahan ke gudang produksi' }],
    countNote: 'Opname bahan dan komponen pabrik', shortages: [2, 1], writedown: null,
    salesReturn: ['Cacat finishing, ditukar baru', '1'], purchaseReturn: ['Kadar air kayu melebihi standar', '4'], poQty: '30', poPrice: '120000', requestNote: 'Bahan untuk pesanan hotel kuartal depan', requestQty: '50',
    sick: 0.04, checkIn: [7, 8], checkOut: [16, 17], overtime: 3, days: 10, leave: ['Cuti tahunan', 'Keperluan keluarga'],
  },
};
const opsOf = (c: Demo) => OPS[c.model] ?? OPS.DAGANG;

const periodAgo = (c: Demo, monthsBack: number) => {
  const d = new Date(`${c.today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.toISOString().slice(0, 7);
};
const lastDayOf = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Biaya rutin tiap bulan selama 4 bulan terakhir (riwayat yang tampak hidup di laporan bulanan) */
export async function monthlyOps(c: Demo, items: { code: string; desc: string; amount: number; from: 'kas' | 'bank'; day?: number }[]) {
  for (let m = 3; m >= 0; m--) {
    for (const it of items) {
      const ago = m * 30 + (it.day ?? 4) + c.int(0, 3);
      if (ago >= 118 || ago < 1) continue;
      await c.step(`${it.desc} H-${ago}`, () =>
        c.svc.cash.create(c.admin as never, {
          type: 'OUT',
          cashAccountId: it.from === 'kas' ? c.kas : c.bank,
          date: c.ago(ago),
          description: it.desc,
          reference: `BKT-${c.int(1000, 9999)}`,
          lines: [{ accountId: c.acc(it.code), amount: String(Math.round((it.amount * (0.92 + c.rnd() * 0.16)) / 1000) * 1000) }],
        } as never),
      );
    }
  }
}

/** Setoran modal tambahan, pinjaman, dan setor tunai ke bank */
export async function cashMovements(c: Demo) {
  const f = flavorOf(c);
  await c.step('setoran modal', () =>
    c.svc.cash.create(c.admin as never, { type: 'IN', cashAccountId: c.bank, date: c.ago(100), description: f.capital[1], reference: f.capital[2], lines: [{ accountId: c.acc('3-1000'), amount: String(f.capital[0]) }] } as never),
  );
  await c.step('setor tunai', () =>
    c.svc.cash.create(c.admin as never, { type: 'TRANSFER', cashAccountId: c.kas, toCashAccountId: c.bank, amount: String(f.deposit[0]), date: c.ago(40), description: f.deposit[1] } as never),
  );
}

/** Aset tetap dibeli lewat tagihan (kartu aset otomatis) + penyusutan bulan-bulan lalu */
export async function fixedAssets(c: Demo, supplierCode: string, list: { cat: string; name: string; cost: number; ago: number; location: string }[]) {
  const [sup] = await c.db.select().from(suppliers).where(and(eq(suppliers.tenantId, c.tenantId), eq(suppliers.code, supplierCode)));
  if (!sup) return;
  const cats = await c.db.select().from(assetCategories).where(eq(assetCategories.tenantId, c.tenantId));
  for (const [i, a] of list.entries()) {
    const cat = cats.find((x) => x.name.toLowerCase().includes(a.cat.toLowerCase())) ?? cats[0];
    await c.step(`aset ${a.name}`, () =>
      c.svc.pi.createBill(c.admin as never, {
        supplierId: sup.id,
        supplierInvoiceNo: `AST-${i + 1}-${c.int(100, 999)}`,
        date: c.ago(a.ago),
        description: `Pembelian ${a.name}`,
        lines: [{ type: 'ASSET', description: a.name, assetCategoryId: cat.id, price: String(a.cost), location: a.location }],
      } as never),
    );
  }
  for (let m = 3; m >= 1; m--) await c.step(`penyusutan ${periodAgo(c, m)}`, () => c.svc.assets.run(c.admin as never, periodAgo(c, m)));
}

/** Jurnal umum: jurnal manual, jurnal penyesuaian, dan jurnal berulang */
export async function journals(c: Demo) {
  const lines = (a: string, b: string, amount: number) => [
    { accountId: c.acc(a), debit: String(amount), credit: '0' },
    { accountId: c.acc(b), debit: '0', credit: String(amount) },
  ];
  const pp = flavorOf(c).prepaid;
  await c.step('jurnal manual', () =>
    c.svc.accounting.createManualJournal(c.admin as never, { date: c.ago(45), description: `Pembayaran ${pp.label} dibayar dimuka`, reference: pp.ref, lines: lines('1-1700', '1-1200', pp.amount) } as never),
  );
  await c.step('jurnal penyesuaian', () =>
    c.svc.accounting.createManualJournal(c.admin as never, { date: c.ago(15), description: `Penyesuaian: amortisasi ${pp.label.replace(/ \(.*\)/, '')} bulan ini`, adjustment: true, lines: lines('6-5100', '1-1700', pp.monthly) } as never),
  );
  await c.step('jurnal berulang', () =>
    c.svc.accounting.createRecurring(c.admin as never, {
      name: `Amortisasi ${pp.label.replace(/ \(.*\)/, '')} bulanan`,
      description: `Amortisasi ${pp.label.replace(/ \(.*\)/, '')} dibayar dimuka (1/${pp.months})`,
      frequency: 'MONTHLY',
      nextDate: addDays(c.today, 12),
      remaining: 8,
      isAdjustment: true,
      lines: lines('6-5100', '1-1700', pp.monthly),
    } as never),
  );
}

/** Anggaran tahun berjalan (menu Anggaran vs realisasi muncul) */
export async function budget(c: Demo, rows: { code: string; monthly: number }[]) {
  const year = Number(c.today.slice(0, 4));
  await c.step('anggaran', () =>
    c.svc.budget.save(c.admin as never, year, {
      name: `Anggaran ${year}`,
      tolerancePct: 5,
      rows: rows.map((r) => ({ accountId: c.acc(r.code), months: Array.from({ length: 12 }, () => String(r.monthly)) })),
    } as never),
  );
  await c.step('setujui anggaran', () => c.svc.budget.approve(c.admin as never, year));
}

/** Pajak bulan lalu: setoran PPN dan PPh 21 (bila ada kewajiban) */
export async function taxes(c: Demo) {
  const period = periodAgo(c, 1);
  const obs = await c.svc.tax.obligations(c.tenantId, period);
  for (const o of obs) {
    const vatComp = o.type === 'PPN' && Number(o.detail?.ppnKeluaran ?? 0) > 0;
    if (Number(o.outstanding) <= 0 && !vatComp) continue;
    const billing = `${c.int(1, 9)}${String(c.int(0, 99999999)).padStart(8, '0')}${String(c.int(0, 999999)).padStart(6, '0')}`;
    await c.step(`setoran ${o.type}`, () =>
      c.svc.tax.create(c.admin as never, {
        type: o.type,
        period: o.period,
        date: c.ago(2),
        cashAccountId: c.bank,
        billingCode: billing,
        ntpn: Number(o.outstanding) > 0 ? `${billing.slice(0, 4)}${Math.floor(c.rnd() * 1e12).toString(36).toUpperCase()}`.slice(0, 16).padEnd(16, '0') : undefined,
      } as never),
    );
  }
}

/** Rekening koran bank bulan lalu (diimpor dari jurnal bank) + biaya admin & bunga otomatis jadi jurnal */
export async function bankStatement(c: Demo) {
  const period = periodAgo(c, 1);
  const from = `${period}-01`;
  const to = lastDayOf(period);
  const rows = await c.db
    .select({ debit: journalLines.debit, credit: journalLines.credit, date: journalEntries.date, source: journalEntries.sourceType, description: journalEntries.description })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalId))
    .where(and(eq(journalLines.accountId, c.bank), eq(journalEntries.tenantId, c.tenantId), sql`${journalEntries.date} >= ${from}`, sql`${journalEntries.date} <= ${to}`, sql`${journalEntries.sourceType} NOT IN ('OPENING', 'BANK', 'CLOSING')`))
    .orderBy(journalEntries.date);
  if (!rows.length) return;
  const f = flavorOf(c);
  let running = f.bankOpening;
  const label = (s: string, d: string) =>
    s === 'PAYMENT' ? `TRSF E-BANKING CR ${d.toUpperCase().slice(0, 28)}` : s === 'SUPPLIER_PAYMENT' ? `TRSF E-BANKING DB ${d.toUpperCase().slice(0, 28)}` : s === 'PAYROLL_PAYMENT' ? 'PAYROLL GAJI KARYAWAN' : s === 'TRANSFER' ? 'SETORAN TUNAI' : `DB ${d.toUpperCase().slice(0, 36)}`;
  const lines = [
    ...rows.map((r) => ({ date: r.date, description: label(r.source, r.description), amount: Number(r.debit) - Number(r.credit) })),
    { date: to, description: 'BIAYA ADM BULANAN', amount: -f.bankFee },
    { date: to, description: 'BUNGA JASA GIRO NETTO', amount: 38000 },
  ].map((l) => {
    running += l.amount;
    return { date: l.date, description: l.description, amount: l.amount.toFixed(2), balance: running.toFixed(2) };
  });
  const st = (await c.step('impor mutasi bank', () => c.svc.bank.import(c.admin as never, { cashAccountId: c.bank, fileName: `mutasi-${period}.csv`, lines } as never))) as { lines: { id: string; description: string; status: string }[] } | undefined;
  for (const l of (st?.lines ?? []).filter((x) => x.status === 'UNMATCHED')) {
    const target = l.description.startsWith('BIAYA ADM') ? c.acc('8-1100') : l.description.startsWith('BUNGA') ? c.acc('4-9100') : undefined;
    if (target) await c.step('jurnal dari mutasi', () => c.svc.bank.createFromLine(c.admin as never, l.id, { accountId: target, description: l.description.startsWith('BUNGA') ? `Bunga jasa giro ${period}` : `Biaya administrasi bank ${period}` } as never));
  }
}

/** Kas kecil: dana tetap, beberapa bukti, dan pengisian kembali */
export async function pettyCash(c: Demo) {
  const pf = flavorOf(c).petty;
  const accId = c.acc('1-1110');
  if (!accId) return;
  const fund = (await c.step('dana kas kecil', () =>
    c.svc.petty.saveFund(c.admin as never, { accountId: accId, fundingAccountId: c.kas, name: 'Kas Kecil Kantor', custodianName: pf.custodian, imprestAmount: String(pf.fund), maxVoucher: String(pf.max) } as never),
  )) as { id: string } | undefined;
  if (!fund) return;
  await c.step('isi kas kecil', () => c.svc.petty.topUp(c.admin as never, fund.id, { date: c.ago(30) } as never));
  const exps = pf.items;
  for (const [i, [d, code, amt, ref]] of exps.entries()) {
    await c.step(`bukti kas kecil ${ref}`, () =>
      c.svc.petty.createVoucher(c.admin as never, { fundId: fund.id, date: c.ago(25 - i * 4), payee: pf.payee, description: d, expenseAccountId: c.acc(code), amount: String(amt), receiptRef: ref } as never),
    );
  }
  await c.step('ganti kas kecil', () => c.svc.petty.replenish(c.admin as never, fund.id, { date: c.ago(6) } as never));
}

/** Opname kas (hitung fisik uang) */
export async function cashCount(c: Demo) {
  const cc = (await c.step('opname kas', () => c.svc.cashCount.create(c.admin as never, { accountId: c.kas, date: c.ago(3), custodianName: flavorOf(c).petty.custodian } as never))) as { id: string } | undefined;
  if (!cc) return;
  await c.step('isi hitungan', () => c.svc.cashCount.update(c.admin as never, cc.id, { denominations: flavorOf(c).denominations, reason: 'Selisih kecil karena pembulatan uang kembalian', notes: flavorOf(c).countNote } as never));
  await c.step('selesai hitung', () => c.svc.cashCount.finish(c.admin as never, cc.id));
}

/** Absensi 10 hari kerja terakhir + satu cuti disetujui */
export async function attendance(c: Demo) {
  const { employees } = await import('../../db/schema');
  const emp = await c.db.select().from(employees).where(eq(employees.tenantId, c.tenantId));
  if (!emp.length) return;
  const o = opsOf(c);
  let done = 0;
  for (let n = 1; n <= 20 && done < o.days; n++) {
    const d = c.ago(n);
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    done++;
    await c.step(`absen ${d}`, () =>
      c.svc.hr.saveAttendance(c.admin as never, {
        date: d,
        rows: emp.map((e) => {
          const x = c.rnd();
          const st = x < o.sick ? 'SAKIT' : 'HADIR';
          return { employeeId: e.id, status: st, checkIn: st === 'HADIR' ? `0${c.int(o.checkIn[0], o.checkIn[1])}:${String(c.int(0, 59)).padStart(2, '0')}` : undefined, checkOut: st === 'HADIR' ? `${c.int(o.checkOut[0], o.checkOut[1])}:${String(c.int(0, 59)).padStart(2, '0')}` : undefined, overtimeHours: st === 'HADIR' && o.overtime && c.rnd() < 0.3 ? String(o.overtime) : '0' };
        }),
      } as never),
    );
  }
  const lv = (await c.step('ajukan cuti', () => c.svc.hr.createLeave(c.admin as never, { employeeId: emp[0].id, type: 'ANNUAL', startDate: c.ago(30), endDate: c.ago(28), reason: o.leave[0] } as never))) as { id: string } | undefined;
  await c.step('cuti menunggu persetujuan', () => c.svc.hr.createLeave(c.admin as never, { employeeId: emp[emp.length > 1 ? 1 : 0].id, type: 'ANNUAL', startDate: addDays(c.today, 6), endDate: addDays(c.today, 8), reason: o.leave[1] } as never));
  if (lv) await c.step('setujui cuti', () => c.svc.hr.decideLeave(c.admin as never, lv.id, { decision: 'APPROVED' } as never));
}

/** Pipeline CRM + penawaran */
export async function crm(c: Demo, customerId: string, productId: string, items: { title: string; company: string; contact: string; value: number; source: string }[]) {
  const prof = CRM_PROFILES[c.model];
  const stages = await c.db
    .insert(crmStages)
    .values(prof.stages.map((st, i) => ({ tenantId: c.tenantId, name: st.name, sequence: i + 1, probability: st.probability })))
    .returning();
  const created = await c.db.insert(leads).values(
    items.map((it, i) => ({ tenantId: c.tenantId, title: it.title, contactName: it.contact, phone: `0813-${c.int(1000, 9999)}-${c.int(1000, 9999)}`, companyName: it.company, source: prof.sources.includes(it.source) ? it.source : prof.sources[i % prof.sources.length], expectedRevenue: String(it.value), stageId: stages[i % 4].id, probability: stages[i % 4].probability, ownerId: c.admin.sub })),
  ).returning();
  // satu prospek menang (jadi pelanggan), satu gagal — supaya angka "menang/gagal" di CRM terisi
  if (created[0]) await c.step('prospek menang', () => c.svc.crm.mark(c.admin as never, created[0].id, { status: 'WON', createCustomer: false } as never));
  if (created[1]) await c.step('prospek gagal', () => c.svc.crm.mark(c.admin as never, created[1].id, { status: 'LOST', lostReason: prof.lostReasons[0] } as never));
  if (productId) {
    for (const [i, days] of [20, 8].entries()) {
      await c.step(`penawaran ${i + 1}`, () =>
        c.svc.crm.createQuotation(c.admin as never, { customerId, warehouseId: c.wh, date: c.ago(days), validDays: 14, terms: 'Harga belum termasuk ongkos kirim. Pembayaran 30 hari.', lines: [{ productId, qty: String(10 + i * 5) }] } as never),
      );
    }
  }
}

/** Gudang kedua + transfer barang (tiba kemudian), opname stok, retur penjualan & pembelian, penerimaan barang, permintaan beli */
export async function stockOps(c: Demo, ids: Map<string, string>, skus: string[], opts: { saleInvoiceId?: string; billId?: string; supplierId?: string }) {
  const o = opsOf(c);
  const [wh2] = await c.db.insert(warehouses).values({ tenantId: c.tenantId, code: 'GD-2', name: o.warehouse2 }).returning();
  for (const [i, t] of o.transfers.entries()) {
    const lines = skus.slice(i, i + 3).filter((k) => ids.get(k)).map((k) => ({ productId: ids.get(k)!, qty: t.qty }));
    const tr = (await c.step(`transfer barang ${i + 1}`, () => c.svc.ops.createTransfer(c.admin as never, { fromWarehouseId: c.wh, toWarehouseId: wh2.id, date: c.ago(t.ago), mode: t.mode, notes: t.notes, lines } as never))) as { id: string } | undefined;
    if (tr && t.mode === 'IN_TRANSIT') await c.step(`terima transfer ${i + 1}`, () => c.svc.ops.receiveTransfer(c.admin as never, tr.id, { date: c.ago(t.ago - 2) } as never));
  }
  // opname stok di gudang utama: dua barang berselisih
  const cnt = (await c.step('opname stok', () => c.svc.ops.createCount(c.admin as never, { warehouseId: c.wh, date: c.ago(5), notes: o.countNote } as never))) as { id: string; lines?: { productId: string; systemQty: string }[] } | undefined;
  if (cnt) {
    const full = (await c.svc.ops.getCount(c.admin as never, cnt.id)) as { lines: { productId: string; systemQty: string }[] };
    const lines = full.lines.slice(0, 8).map((l, i) => ({ productId: l.productId, countedQty: String(Math.max(0, Number(l.systemQty) - (o.shortages[i] ?? 0))) }));
    await c.step('isi hasil opname', () => c.svc.ops.updateCount(c.admin as never, cnt.id, { lines } as never));
    await c.step('posting opname', () => c.svc.ops.postCount(c.admin as never, cnt.id));
  }
  // penurunan nilai persediaan: satu barang diturunkan 15% dari biaya rata-rata (harga pasar turun)
  const bal = await c.db.execute<{ product_id: string; avg_cost: string }>(sql`SELECT product_id, avg_cost FROM stock_balances WHERE tenant_id = ${c.tenantId} AND warehouse_id = ${c.wh} AND qty > 0 AND product_id = ${ids.get(skus[0])!} LIMIT 1`);
  if (bal.rows[0] && o.writedown) {
    const wd = o.writedown;
    await c.step('penurunan nilai persediaan', () =>
      c.svc.writedown.create(c.admin as never, { date: c.ago(4), warehouseId: c.wh, reason: wd[1], lines: [{ productId: bal.rows[0].product_id, newCost: String(Math.floor(Number(bal.rows[0].avg_cost) * wd[0])) }] } as never),
    );
  }
  if (opts.saleInvoiceId) {
    const inv = (await c.svc.inv.get(c.tenantId, opts.saleInvoiceId)) as { lines: { id: string }[] };
    if (inv.lines[0]) await c.step('retur penjualan', () => c.svc.returns.createSales(c.admin as never, { invoiceId: opts.saleInvoiceId!, date: c.ago(2), reason: o.salesReturn[0], lines: [{ invoiceLineId: inv.lines[0].id, qty: o.salesReturn[1] }] } as never));
  }
  if (opts.billId) {
    const bill = (await c.svc.pi.get(c.tenantId, opts.billId)) as { lines: { id: string }[] };
    if (bill.lines[0]) await c.step('retur pembelian', () => c.svc.returns.createPurchase(c.admin as never, { invoiceId: opts.billId!, date: c.ago(1), reason: o.purchaseReturn[0], lines: [{ invoiceLineId: bill.lines[0].id, qty: o.purchaseReturn[1] }] } as never));
  }
  // penerimaan barang dari PO (belum difakturkan) + permintaan beli
  if (opts.supplierId) {
    const po = (await c.step('PO untuk penerimaan', async () => {
      const r = await c.svc.po.create(c.admin as never, { supplierId: opts.supplierId, warehouseId: c.wh, date: c.ago(6), lines: skus.slice(0, 2).map((s) => ({ productId: ids.get(s)!, qty: o.poQty, price: o.poPrice })) } as never);
      await c.svc.po.confirm(c.admin as never, r.id);
      return r;
    })) as { id: string } | undefined;
    if (po) await c.step('terima barang', () => c.svc.grn.receive(c.admin as never, po.id, { date: c.ago(4), supplierDeliveryNo: `SJ-${c.int(1000, 9999)}` }));
    const pr = (await c.step('permintaan beli', () =>
      c.svc.prq.create(c.admin as never, { warehouseId: c.wh, date: c.ago(3), neededBy: addDays(c.today, 7), notes: o.requestNote, submit: true, lines: skus.slice(0, 2).map((s) => ({ productId: ids.get(s)!, qty: o.requestQty, supplierId: opts.supplierId })) } as never),
    )) as { id: string } | undefined;
    void pr;
  }
}

/** Uang muka pelanggan (diterima di muka, dipakai pada faktur berikutnya) */
export async function deposit(c: Demo, customerId: string, amount: number, note: string) {
  await c.step('uang muka pelanggan', () =>
    c.svc.billing.createDeposit(c.admin as never, { customerId, date: c.ago(12), amount: String(amount), method: 'TRANSFER', cashAccountId: c.bank, notes: note } as never),
  );
}

export { receive };

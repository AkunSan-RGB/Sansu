/**
 * Lembar Excel untuk setiap laporan SANSU. Semua fungsi murni: data API → SheetSpec.
 * Angka turunan ditulis sebagai rumus (dengan nilai hasil), angka sumber sebagai nilai.
 */
import { FISCAL_ASSET_GROUP_INFO, TAX_PAYMENT_LABELS, type AnnualTaxRecap, type BpjsRecap, type FiscalAssetGroup, type FiscalReconciliation, type TaxPayment, type VatReport, type VatReportRow, type WithholdingRecap } from '@sansu/shared';
import { d, n, SheetBuilder, total, type SheetSpec, type Val } from './book';
import { BULAN, tgl, periodeText, RP, money, basis } from './reports.shared';

// ============ Pajak ============
export function vatSheets(v: VatReport, from: string, to: string, company?: string): SheetSpec[] {
  const docs = new SheetBuilder('Daftar Dokumen', {
    company,
    title: 'Rekap PPN · daftar dokumen',
    subtitle: [periodeText(from, to), RP],
    columns: [
      { key: 'kind', header: 'Jenis', width: 14 },
      { key: 'no', header: 'Nomor', fmt: 'code', width: 20 },
      { key: 'ref', header: 'Referensi', fmt: 'code', width: 18 },
      { key: 'date', header: 'Tanggal', fmt: 'date', width: 12 },
      { key: 'party', header: 'Lawan transaksi', width: 32 },
      { key: 'npwp', header: 'NPWP', fmt: 'code', width: 22 },
      money('dpp', 'DPP'),
      money('ppn', 'PPN'),
    ],
    filter: true,
  });
  const a = docs.next;
  for (const x of v.documents)
    docs.row({
      kind: x.kind,
      no: x.number,
      ref: x.ref ?? '',
      date: d(x.date),
      party: x.party,
      npwp: x.npwp ?? '',
      dpp: n(x.dpp),
      ppn: n(x.ppn),
    });
  const b = docs.next - 1;
  docs.totals(`Jumlah (${v.documents.length} dokumen)`, a, b, ['dpp', 'ppn'], {
    style: 'grand',
    labelKey: 'party',
    cache: { dpp: total(v.documents.map((x) => n(x.dpp))), ppn: total(v.documents.map((x) => n(x.ppn))) },
  });

  const s = new SheetBuilder('Ringkasan PPN', {
    company,
    title: 'Rekap PPN',
    subtitle: [periodeText(from, to), RP],
    columns: [{ key: 'label', header: 'Uraian', width: 40 }, money('amt', 'Jumlah', 20)],
    landscape: false,
  });
  const out = s.row({ label: 'PPN keluaran', amt: n(v.vatOut) }, 'body', 1);
  const inn = s.row({ label: 'PPN masukan', amt: n(v.vatIn) }, 'body', 1);
  const net = s.row(
    {
      label: 'Selisih (keluaran − masukan)',
      amt: s.verified(`${s.ref('amt', out)}-${s.ref('amt', inn)}`, n(v.net), (n(v.vatOut) ?? 0) - (n(v.vatIn) ?? 0)),
    },
    'grand',
  );
  s.row(
    {
      label: 'Status',
      amt: s.fx(
        `IF(${s.ref('amt', net)}>0,"Kurang bayar",IF(${s.ref('amt', net)}<0,"Lebih bayar","Nihil"))`,
        v.status === 'KURANG_BAYAR' ? 'Kurang bayar' : v.status === 'LEBIH_BAYAR' ? 'Lebih bayar' : 'Nihil',
      ),
    },
    'body',
  );
  s.blank();
  s.note(
    'Angka keluaran/masukan diambil dari saldo akun PPN di buku besar; rincian dokumen ada di lembar "Daftar Dokumen".',
  );
  return [s.spec, docs.spec];
}
export function taxPaymentsSheet(rows: TaxPayment[], year: number, company?: string): SheetSpec[] {
  const s = new SheetBuilder(`Setoran Pajak ${year}`, {
    company,
    title: `Riwayat Setoran Pajak ${year}`,
    subtitle: [RP],
    columns: [
      { key: 'no', header: 'Nomor', fmt: 'code', width: 18 },
      { key: 'date', header: 'Tanggal', fmt: 'date', width: 12 },
      { key: 'type', header: 'Jenis pajak', width: 24 },
      { key: 'period', header: 'Masa', width: 10 },
      money('amt', 'Jumlah disetor'),
      { key: 'bill', header: 'Kode billing', fmt: 'code', width: 18 },
      { key: 'ntpn', header: 'NTPN', fmt: 'code', width: 18 },
      { key: 'acct', header: 'Dibayar dari', width: 22 },
    ],
    filter: true,
  });
  const a = s.next;
  for (const p of rows)
    s.row({
      no: p.number,
      date: d(p.date),
      type: TAX_PAYMENT_LABELS[p.type] ?? p.type,
      period: p.period,
      amt: n(p.amount),
      bill: p.billingCode ?? '',
      ntpn: p.ntpn ?? '',
      acct: p.cashAccount?.name ?? '',
    });
  s.totals('Jumlah', a, s.next - 1, ['amt'], {
    style: 'grand',
    labelKey: 'type',
    cache: { amt: total(rows.map((x) => n(x.amount))) },
  });
  return [s.spec];
}
export function fiscalSheets(f: FiscalReconciliation, company?: string): SheetSpec[] {
  const s = new SheetBuilder('Rekonsiliasi Fiskal', {
    company,
    title: `Rekonsiliasi Fiskal & PPh Badan Tahun ${f.year}`,
    subtitle: [
      `${f.scheme === 'FINAL_UMKM' ? 'Skema PPh final UMKM' : 'Skema umum'} · ${f.legalForm} · ${basis(f.framework)}`,
      RP,
    ],
    columns: [{ key: 'label', header: 'Uraian', width: 64 }, money('amt', 'Jumlah', 20)],
    landscape: false,
  });
  const pbt = s.row({ label: 'Laba (rugi) sebelum pajak — komersial', amt: n(f.profitBeforeTax) }, 'subtotal');
  s.section('Koreksi fiskal positif');
  const p1 = s.next;
  for (const i of f.positive) s.row({ label: i.label, amt: n(i.amount) }, 'body', 1);
  const pos = s.row(
    { label: 'Jumlah koreksi positif', amt: s.sum('amt', p1, s.next - 1, n(f.totalPositive)) },
    'subtotal',
  );
  s.section('Koreksi fiskal negatif');
  const n1 = s.next;
  for (const i of f.negative) s.row({ label: i.label, amt: n(i.amount) }, 'body', 1);
  const neg = s.row(
    { label: 'Jumlah koreksi negatif', amt: s.sum('amt', n1, s.next - 1, n(f.totalNegative)) },
    'subtotal',
  );
  const A = (r: number) => s.ref('amt', r);
  const fp = s.row(
    {
      label: 'Laba (rugi) fiskal',
      amt: s.verified(
        `${A(pbt)}+${A(pos)}-${A(neg)}`,
        n(f.fiscalProfit),
        (n(f.profitBeforeTax) ?? 0) + (n(f.totalPositive) ?? 0) - (n(f.totalNegative) ?? 0),
      ),
    },
    'total',
  );
  const loss = s.row({ label: 'Kompensasi kerugian tahun lalu', amt: n(f.lossCarryforward) }, 'body', 1);
  const pkpJs = Math.max(0, Math.floor(((n(f.fiscalProfit) ?? 0) - (n(f.lossCarryforward) ?? 0)) / 1000) * 1000);
  const pkp = s.row(
    {
      label: 'Penghasilan kena pajak (dibulatkan ke ribuan)',
      amt: s.verified(`MAX(0,ROUNDDOWN(${A(fp)}-${A(loss)},-3))`, n(f.pkp), pkpJs),
    },
    'subtotal',
  );
  s.row({ label: 'Peredaran bruto', amt: n(f.grossRevenue) }, 'body', 1);
  if (n(f.facilitatedPkp))
    s.row({ label: 'PKP yang mendapat fasilitas Pasal 31E', amt: n(f.facilitatedPkp) }, 'body', 1);
  const due = s.row({ label: `PPh terutang (${f.method})`, amt: n(f.taxDue) }, 'subtotal');
  const cr = s.row(
    { label: 'Kredit pajak (PPh 22, 23, 25 yang sudah dibayar/dipotong)', amt: n(f.credits) },
    'body',
    1,
  );
  s.row(
    {
      label: 'PPh Pasal 29 (kurang/lebih bayar)',
      amt: s.verified(`${A(due)}-${A(cr)}`, n(f.pph29), (n(f.taxDue) ?? 0) - (n(f.credits) ?? 0)),
    },
    'grand',
  );
  s.row({ label: 'Angsuran PPh Pasal 25 per bulan tahun berikutnya', amt: n(f.installment25) }, 'body');
  void pkp;
  if (f.warnings.length) {
    s.blank();
    for (const w of f.warnings) s.note(`Catatan: ${w}`);
  }

  const dep = new SheetBuilder('Penyusutan Fiskal', {
    company,
    title: `Perbandingan Penyusutan Komersial & Fiskal ${f.year}`,
    subtitle: [RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Aset', width: 32 },
      { key: 'cat', header: 'Kategori', width: 16 },
      { key: 'grp', header: 'Kelompok fiskal', width: 22 },
      money('cost', 'Harga perolehan'),
      money('com', 'Penyusutan komersial'),
      money('fis', 'Penyusutan fiskal'),
      money('dif', 'Selisih (komersial − fiskal)'),
      money('cbv', 'Nilai buku komersial'),
      money('fbv', 'Nilai sisa buku fiskal'),
    ],
    filter: true,
    freezeCols: 2,
  });
  const d1 = dep.next;
  for (const r of f.depreciation) {
    const row = dep.next;
    dep.row({
      code: r.code,
      name: r.name,
      cat: r.category,
      grp: FISCAL_ASSET_GROUP_INFO[r.fiscalGroup as FiscalAssetGroup]?.label ?? r.fiscalGroup,
      cost: n(r.cost),
      com: n(r.commercial),
      fis: n(r.fiscal),
      dif: dep.verified(
        `${dep.ref('com', row)}-${dep.ref('fis', row)}`,
        n(r.difference),
        (n(r.commercial) ?? 0) - (n(r.fiscal) ?? 0),
      ),
      cbv: n(r.commercialBookValue),
      fbv: n(r.fiscalBookValue),
    });
  }
  const sumOf = (k: 'cost' | 'commercial' | 'fiscal' | 'difference' | 'commercialBookValue' | 'fiscalBookValue') =>
    total(f.depreciation.map((x) => n(x[k])));
  dep.totals('Jumlah', d1, dep.next - 1, ['cost', 'com', 'fis', 'dif', 'cbv', 'fbv'], {
    style: 'grand',
    labelKey: 'name',
    cache: {
      cost: sumOf('cost'),
      com: sumOf('commercial'),
      fis: sumOf('fiscal'),
      dif: sumOf('difference'),
      cbv: sumOf('commercialBookValue'),
      fbv: sumOf('fiscalBookValue'),
    },
  });
  return [s.spec, dep.spec];
}
/** Rekap PPN keluaran langganan SANSU per bulan (Panel SANSU) — bahan faktur pajak Coretax */
export function subscriptionVatSheet(rows: VatReportRow[], month: string, seller?: string): SheetSpec[] {
  const [y, m] = month.split('-').map(Number);
  const s = new SheetBuilder(`PPN ${month}`, {
    company: seller,
    title: `Rekap PPN Keluaran Langganan — ${BULAN[m - 1]} ${y}`,
    subtitle: [RP, 'Tagihan yang lunas pada bulan ini'],
    columns: [
      { key: 'no', header: 'Nomor invoice', fmt: 'code', width: 20 },
      { key: 'date', header: 'Tgl lunas', fmt: 'date', width: 12 },
      { key: 'buyer', header: 'Pembeli', width: 30 },
      { key: 'npwp', header: 'NPWP pembeli', fmt: 'code', width: 22 },
      { key: 'plan', header: 'Paket', width: 16 },
      money('dpp', 'DPP'),
      { key: 'rate', header: 'Tarif %', fmt: 'dec', width: 8 },
      money('vat', 'PPN'),
      money('amt', 'Total'),
    ],
    filter: true,
  });
  const a = s.next;
  for (const r of rows) {
    const row = s.next;
    const dpp = n(r.subtotal) ?? 0;
    const vat = n(r.vatAmount) ?? 0;
    s.row({
      no: r.number,
      date: d(r.paidAt?.slice(0, 10)),
      buyer: r.buyer,
      npwp: r.buyerNpwp ?? '',
      plan: `${r.plan} · ${r.cycle === 'YEARLY' ? 'tahunan' : 'bulanan'}`,
      dpp,
      rate: n(r.vatRate),
      vat,
      amt: s.verified(`${s.ref('dpp', row)}+${s.ref('vat', row)}`, n(r.amount), dpp + vat),
    });
  }
  s.totals('Jumlah', a, s.next - 1, ['dpp', 'vat', 'amt'], {
    style: 'grand',
    labelKey: 'buyer',
    cache: {
      dpp: total(rows.map((x) => n(x.subtotal))),
      vat: total(rows.map((x) => n(x.vatAmount))),
      amt: total(rows.map((x) => n(x.amount))),
    },
  });
  return [s.spec];
}
const RECAP_STATUS: Record<string, string> = {
  NIHIL: 'Nihil',
  TEPAT: 'Tepat waktu',
  TERLAMBAT: 'Disetor terlambat',
  KURANG: 'Kurang setor',
  KURANG_TERLAMBAT: 'Kurang setor, lewat jatuh tempo',
  BELUM: 'Belum disetor',
  TERLAMBAT_BELUM: 'Belum disetor, lewat jatuh tempo',
  LEBIH_BAYAR: 'Lebih bayar (dikompensasi)',
  BELUM_MASA: '-',
};
/** Rekap pajak & BPJS tahunan: lembar ringkasan (matriks) + satu lembar rinci per jenis */
export function annualTaxSheets(r: AnnualTaxRecap, company?: string): SheetSpec[] {
  const s = new SheetBuilder(`Rekap Pajak ${r.year}`, {
    company,
    title: `Rekap Pajak & BPJS Tahun ${r.year}`,
    subtitle: [RP, 'Terutang dari buku besar; disetor dari catatan setoran (NTPN). Selisih = terutang − disetor'],
    columns: [{ key: 'masa', header: 'Masa', width: 14 }, ...r.types.flatMap((t) => [money(`${t.type}_u`, 'Terutang', 15), money(`${t.type}_s`, 'Disetor', 15), money(`${t.type}_d`, 'Selisih', 13)])],
    groups: r.types.map((t) => ({ label: t.label, from: `${t.type}_u`, to: `${t.type}_d` })),
    freezeCols: 1,
    landscape: true,
  });
  const a = s.next;
  for (let i = 0; i < 12; i++) {
    const row = s.next;
    const v: Record<string, Val> = { masa: `${BULAN[i]} ${r.year}` };
    for (const t of r.types) {
      const c = t.months[i];
      const target = t.type === 'PPN' && Number(c.payable) < 0 ? 0 : n(c.payable);
      v[`${t.type}_u`] = target;
      v[`${t.type}_s`] = n(c.paid);
      v[`${t.type}_d`] = s.fx(`${s.ref(`${t.type}_u`, row)}-${s.ref(`${t.type}_s`, row)}`, n(c.diff));
    }
    s.row(v);
  }
  s.totals(
    'Jumlah',
    a,
    s.next - 1,
    r.types.flatMap((t) => [`${t.type}_u`, `${t.type}_s`, `${t.type}_d`]),
    { style: 'grand' },
  );
  s.note('PPN: terutang = PPN keluaran − PPN masukan − kompensasi lebih bayar masa sebelumnya; masa lebih bayar ditulis 0.');
  const sheets = [s.spec];

  for (const t of r.types) {
    const d1 = new SheetBuilder(t.label, {
      company,
      title: `Rekap ${t.label} ${r.year}`,
      subtitle: [RP],
      columns: [
        { key: 'masa', header: 'Masa', width: 14 },
        ...(t.type === 'PPN'
          ? [money('out', 'PPN keluaran'), money('in', 'PPN masukan'), money('comp', 'Kompensasi')]
          : t.type === 'PPH_FINAL'
            ? [money('gross', 'Peredaran bruto')]
            : []),
        money('u', 'Terutang'),
        money('p', 'Disetor'),
        money('dd', 'Selisih'),
        { key: 'due', header: 'Jatuh tempo setor', fmt: 'date', width: 13 },
        { key: 'paid', header: 'Tanggal setor', fmt: 'date', width: 13 },
        { key: 'ntpn', header: 'NTPN', fmt: 'code', width: 22 },
        { key: 'st', header: 'Status', width: 30 },
      ],
    });
    const b = d1.next;
    t.months.forEach((c, i) => {
      const row = d1.next;
      const v: Record<string, Val> = {
        masa: `${BULAN[i]} ${r.year}`,
        u: t.type === 'PPN' && Number(c.payable) < 0 ? 0 : n(c.payable),
        p: n(c.paid),
        due: d(c.dueDate),
        paid: d(c.paidDate),
        ntpn: c.ntpn ?? '',
        st: RECAP_STATUS[c.status] ?? c.status,
      };
      if (t.type === 'PPN') {
        v.out = n(c.detail?.keluaran);
        v.in = n(c.detail?.masukan);
        v.comp = n(c.detail?.kompensasi);
        const calc = (v.out as number) - (v.in as number) - (v.comp as number);
        v.u = calc < 0 ? 0 : d1.verified(`MAX(0,${d1.ref('out', row)}-${d1.ref('in', row)}-${d1.ref('comp', row)})`, n(c.payable), calc);
      }
      if (t.type === 'PPH_FINAL') {
        v.gross = n(c.detail?.peredaranBruto);
        v.u = d1.verified(`ROUNDDOWN(${d1.ref('gross', row)}*0.5%,0)`, n(c.payable), Math.floor(((v.gross as number) ?? 0) * 0.005));
      }
      v.dd = d1.fx(`${d1.ref('u', row)}-${d1.ref('p', row)}`, n(c.diff));
      d1.row(v);
    });
    d1.totals('Jumlah', b, d1.next - 1, ['u', 'p', 'dd', ...(t.type === 'PPN' ? ['out', 'in'] : t.type === 'PPH_FINAL' ? ['gross'] : [])], { style: 'grand' });
    sheets.push(d1.spec);
  }
  return sheets;
}
/** Rekap PPh 23 / 4(2) yang dipotong — bahan bukti potong e-Bupot Unifikasi */
export function withholdingSheets(w: WithholdingRecap, company?: string): SheetSpec[] {
  const label = /^\d{4}$/.test(w.period) ? `Tahun ${w.period}` : `Masa ${BULAN[Number(w.period.slice(5, 7)) - 1]} ${w.period.slice(0, 4)}`;
  const s = new SheetBuilder('Daftar Pemotongan', {
    company,
    title: 'Daftar Pemotongan PPh 23 & PPh 4 ayat (2)',
    subtitle: [label, RP],
    columns: [
      { key: 'jenis', header: 'Jenis', width: 10 },
      { key: 'tgl', header: 'Tanggal', fmt: 'date', width: 12 },
      { key: 'no', header: 'No. faktur', fmt: 'code', width: 18 },
      { key: 'ref', header: 'No. tagihan supplier', fmt: 'code', width: 18 },
      { key: 'sup', header: 'Nama dipotong', width: 28 },
      { key: 'npwp', header: 'NPWP / NIK', fmt: 'code', width: 22 },
      { key: 'uraian', header: 'Uraian', width: 28 },
      money('dpp', 'DPP'),
      { key: 'tarif', header: 'Tarif %', fmt: 'dec', width: 8 },
      money('pph', 'PPh dipotong'),
    ],
    filter: true,
  });
  const a = s.next;
  for (const r of w.rows) {
    const row = s.next;
    s.row({
      jenis: r.type === 'PPH23' ? 'PPh 23' : 'PPh 4(2)',
      tgl: d(r.date),
      no: r.number,
      ref: r.supplierInvoiceNo,
      sup: r.supplierName,
      npwp: r.supplierNpwp ?? '(belum ada)',
      uraian: r.description ?? '',
      dpp: n(r.base),
      tarif: n(r.rate),
      pph: s.verified(`ROUND(${s.ref('dpp', row)}*${s.ref('tarif', row)}/100,2)`, n(r.amount), Math.round((n(r.base) ?? 0) * (n(r.rate) ?? 0)) / 100),
    });
  }
  s.totals('Jumlah', a, s.next - 1, ['dpp', 'pph'], { style: 'grand', labelKey: 'sup' });
  s.blank();
  s.heading('Ringkasan');
  for (const x of w.summary) {
    s.row({ sup: `${x.label} — ${x.count} transaksi`, dpp: n(x.base), pph: n(x.amount) }, 'subtotal');
    s.row({ sup: `   Saldo buku besar ${x.label}`, pph: n(x.ledger) });
    const r1 = s.next - 2;
    const r2 = s.next - 1;
    const chk = s.row({ sup: '   Selisih (harus 0)', pph: s.fx(`${s.ref('pph', r2)}-${s.ref('pph', r1)}`, n(x.unexplained)) });
    s.check(s.ref('pph', chk));
  }
  if (w.missingNpwp.length) s.note(`Belum ada NPWP/NIK: ${w.missingNpwp.join(', ')} — lengkapi di data supplier (tanpa NPWP, tarif PPh 23 menjadi 100% lebih tinggi).`);
  return [s.spec];
}
/** Rekap iuran BPJS per karyawan — cocokkan dengan tagihan SIPP & e-Dabu */
export function bpjsSheets(b: BpjsRecap, company?: string): SheetSpec[] {
  const [y, m] = b.period.split('-').map(Number);
  const s = new SheetBuilder(`BPJS ${b.period}`, {
    company,
    title: `Rekap Iuran BPJS — ${BULAN[m - 1]} ${y}`,
    subtitle: [RP, `Penggajian ${b.run?.number ?? '-'}`],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama', width: 24 },
      { key: 'nik', header: 'NIK', fmt: 'code', width: 18 },
      money('wage', 'Dasar upah'),
      money('kesC', 'Perusahaan 4%', 13),
      money('kesE', 'Karyawan 1%', 13),
      money('jhtC', 'JHT 3,7%', 13),
      money('jhtE', 'JHT 2%', 13),
      money('jkk', `JKK ${b.caps.jkkRate}%`, 12),
      money('jkm', `JKM ${b.caps.jkmRate}%`, 12),
      money('jpC', 'JP 2%', 12),
      money('jpE', 'JP 1%', 12),
      money('kes', 'Total Kesehatan', 15),
      money('tk', 'Total Ketenagakerjaan', 17),
    ],
    groups: [
      { label: 'BPJS Kesehatan', from: 'kesC', to: 'kesE' },
      { label: 'BPJS Ketenagakerjaan', from: 'jhtC', to: 'jpE' },
    ],
    freezeCols: 2,
    landscape: true,
  });
  const a = s.next;
  for (const r of b.rows) {
    const row = s.next;
    const kes = Number(r.kesCompany) + Number(r.kesEmployee);
    const tk = Number(r.jhtCompany) + Number(r.jhtEmployee) + Number(r.jkkCompany) + Number(r.jkmCompany) + Number(r.jpCompany) + Number(r.jpEmployee);
    s.row({
      code: r.code,
      name: r.name,
      nik: r.nik ?? '',
      wage: n(r.wage),
      kesC: n(r.kesCompany),
      kesE: n(r.kesEmployee),
      jhtC: n(r.jhtCompany),
      jhtE: n(r.jhtEmployee),
      jkk: n(r.jkkCompany),
      jkm: n(r.jkmCompany),
      jpC: n(r.jpCompany),
      jpE: n(r.jpEmployee),
      kes: s.fx(`${s.ref('kesC', row)}+${s.ref('kesE', row)}`, kes),
      tk: s.fx(`SUM(${s.ref('jhtC', row)}:${s.ref('jpE', row)})`, tk),
    });
  }
  const tot = s.totals('Jumlah', a, s.next - 1, ['wage', 'kesC', 'kesE', 'jhtC', 'jhtE', 'jkk', 'jkm', 'jpC', 'jpE', 'kes', 'tk'], { style: 'grand', labelKey: 'name' });
  s.blank();
  s.row({ name: 'Bayar ke BPJS Kesehatan', tk: s.fx(s.ref('kes', tot), n(b.kesehatan)) }, 'subtotal');
  s.note(`Jatuh tempo ${tgl(b.dueKesehatan)}`);
  s.row({ name: 'Bayar ke BPJS Ketenagakerjaan', tk: s.fx(s.ref('tk', tot), n(b.ketenagakerjaan)) }, 'subtotal');
  s.note(`Jatuh tempo ${tgl(b.dueKetenagakerjaan)}`);
  s.note(`Batas upah: BPJS Kesehatan Rp${b.caps.kesehatan.toLocaleString('id-ID')}, Jaminan Pensiun Rp${b.caps.jp.toLocaleString('id-ID')} (sesuaikan di Pengaturan penggajian bila ada perubahan).`);
  for (const c of b.changes) s.note(`${c.kind === 'MASUK' ? 'Peserta baru' : 'Peserta keluar'}: ${c.code} ${c.name} (${tgl(c.date)}) — laporkan ke BPJS.`);
  return [s.spec];
}

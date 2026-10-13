import { Alert, Descriptions, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import type { CashFlowStatement, EquityStatement, FinancialPosition, FullTrialBalance, IncomeStatement, StatementLine, VatReport, Worksheet } from '@/api/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Amount, longDate, SignatureBlock, type Signer } from './format';

type Row = {
  key: string;
  /** Akun asal baris rincian: label menjadi tautan ke buku besar */
  accountId?: string;
  label: string;
  note?: string;
  amount?: string;
  compare?: string;
  kind: 'header' | 'line' | 'account' | 'subtotal' | 'total' | 'grand' | 'spacer';
  /** Saat dicetak, baris ini memulai halaman baru */
  breakBefore?: boolean;
};

/** Tabel laporan bergaya laporan keuangan: kolom pos, catatan, tahun berjalan, pembanding */
function StatementTable({ rows, current, previous, compare, ledgerRange }: { rows: Row[]; current: string; previous: string; compare: boolean; ledgerRange: { from: string; to: string } }) {
  const strong = (r: Row) => ['subtotal', 'total', 'grand'].includes(r.kind);
  const columns: ColumnsType<Row> = [
    {
      title: '',
      dataIndex: 'label',
      render: (l: string, r) => {
        if (r.kind === 'header') return <Typography.Text strong>{l.toUpperCase()}</Typography.Text>;
        if (r.kind === 'account')
          return r.accountId ? (
            <Link to={`/ledger?accountId=${r.accountId}&from=${ledgerRange.from}&to=${ledgerRange.to}`} style={{ paddingLeft: 32 }} title="Buka buku besar akun ini">
              {l}
            </Link>
          ) : (
            <Typography.Text type="secondary" style={{ paddingLeft: 32 }}>{l}</Typography.Text>
          );
        if (r.kind === 'grand') return <Typography.Text strong>{l.toUpperCase()}</Typography.Text>;
        if (strong(r)) return <Typography.Text strong>{l}</Typography.Text>;
        return <span style={{ paddingLeft: 16 }}>{l}</span>;
      },
    },
    { title: 'Catatan', dataIndex: 'note', width: 80, align: 'center' },
    {
      title: current,
      dataIndex: 'amount',
      align: 'right',
      width: 180,
      render: (v, r) => (['header', 'spacer'].includes(r.kind) ? null : <Amount v={v} strong={strong(r)} double={r.kind === 'grand'} />),
    },
  ];
  if (compare)
    columns.push({
      title: previous,
      dataIndex: 'compare',
      align: 'right',
      width: 180,
      render: (v, r) => (['header', 'spacer'].includes(r.kind) ? null : <Amount v={v} strong={strong(r)} double={r.kind === 'grand'} />),
    });
  return (
    <Table
      className="statement-table"
      size="small"
      rowKey="key"
      pagination={false}
      dataSource={rows}
      columns={columns}
      scroll={{ x: 560 }}
      rowClassName={(r) => `st-${r.kind}${r.breakBefore ? ' st-pagebreak' : ''}`}
    />
  );
}

const lineRows = (lines: StatementLine[], refs: Record<string, string>, detail: boolean, prefix = ''): Row[] =>
  lines.flatMap((l) => {
    const kind: Row['kind'] = l.kind === 'group' ? 'line' : l.kind === 'total' ? 'grand' : 'subtotal';
    const row: Row = { key: `${prefix}${l.key}`, label: l.label, note: refs[l.key], amount: l.amount, compare: l.compare, kind };
    const acc: Row[] = detail
      ? (l.accounts ?? []).map((a) => ({ key: `${prefix}${l.key}-${a.id}`, accountId: a.id, label: `${a.code} · ${a.name}`, amount: a.amount, compare: a.compare, kind: 'account' }))
      : [];
    return [row, ...acc];
  });

export function PositionView({ d, refs, compare, detail, signer }: { d: FinancialPosition; refs: Record<string, string>; compare: boolean; detail: boolean; signer?: Signer }) {
  const rows: Row[] = [];
  const isAsset = (k: string) => k.endsWith('_ASSET');
  const isLiab = (k: string) => k.endsWith('_LIABILITY');
  d.sections.forEach((s, i) => {
    const next = d.sections[i + 1]?.key ?? '';
    // cetak: aset di halaman pertama, liabilitas dan ekuitas mulai di halaman kedua
    const prevKey = d.sections[i - 1]?.key ?? '';
    rows.push({ key: `h-${s.key}`, label: s.label, kind: 'header', breakBefore: isLiab(s.key) && !isLiab(prevKey) });
    rows.push(...lineRows(s.lines, refs, detail, `${s.key}-`));
    rows.push({ key: `t-${s.key}`, label: `Jumlah ${s.label.toLowerCase()}`, amount: s.total, compare: s.compareTotal, kind: 'total' });
    if (isAsset(s.key) && !isAsset(next)) rows.push({ key: 'g-assets', label: 'Jumlah aset', amount: d.totals.assets.amount, compare: d.totals.assets.compare, kind: 'grand' });
    if (isLiab(s.key) && !isLiab(next))
      rows.push({ key: 'g-liab', label: 'Jumlah liabilitas', amount: d.totals.liabilities.amount, compare: d.totals.liabilities.compare, kind: 'total' });
    rows.push({ key: `sp-${s.key}`, label: '', kind: 'spacer' });
  });
  rows.push({
    key: 'g-le',
    label: 'Jumlah liabilitas dan ekuitas',
    amount: d.totals.liabilitiesEquity.amount,
    compare: d.totals.liabilitiesEquity.compare,
    kind: 'grand',
  });
  return (
    <>
      {!d.balanced && <Alert type="error" showIcon message="Aset tidak sama dengan liabilitas + ekuitas — buka Cek Kesehatan untuk mencari penyebabnya." style={{ marginBottom: 12 }} />}
      <StatementTable rows={rows} current={longDate(d.asOf)} previous={longDate(d.compareAsOf)} compare={compare} ledgerRange={{ from: `${d.asOf.slice(0, 4)}-01-01`, to: d.asOf }} />
      <SignatureBlock signer={signer} year={Number(d.asOf.slice(0, 4))} />
    </>
  );
}

/** Judul bagian laporan laba rugi, ditampilkan sebelum kelompok pertama tiap bagian (seperti "ASET LANCAR" di posisi keuangan) */
const INCOME_HEADERS: Record<string, Record<string, string>> = {
  SAK_EMKM: { REVENUE: 'Pendapatan', COST_OF_SALES: 'Beban', INCOME_TAX: 'Pajak penghasilan' },
  DEFAULT: {
    SALES_REVENUE: 'Pendapatan',
    COST_OF_SALES: 'Beban pokok penjualan',
    SELLING_EXPENSE: 'Beban usaha',
    OTHER_INCOME: 'Pendapatan dan beban lain-lain',
    INCOME_TAX: 'Pajak penghasilan',
    OCI: 'Penghasilan komprehensif lain',
  },
};

/** Judul kolom: tanggal akhir periode saja, sama seperti posisi keuangan; rentang lengkap ada di judul laporan */
const periodText = (x: { from: string; to: string }) => longDate(x.to);

export function IncomeView({ d, refs, compare, detail, signer }: { d: IncomeStatement; refs: Record<string, string>; compare: boolean; detail: boolean; signer?: Signer }) {
  const headers = INCOME_HEADERS[d.framework] ?? INCOME_HEADERS.DEFAULT;
  const rows: Row[] = [];
  d.lines.forEach((l) => {
    if (headers[l.key]) rows.push({ key: `h-${l.key}`, label: headers[l.key], kind: 'header' });
    rows.push(...lineRows([l], refs, detail));
    if (l.kind !== 'group') rows.push({ key: `sp-${l.key}`, label: '', kind: 'spacer' });
  });
  return (
    <>
      <StatementTable rows={rows} current={periodText(d.period)} previous={periodText(d.comparePeriod)} compare={compare} ledgerRange={d.period} />
      <SignatureBlock signer={signer} year={Number(d.period.to.slice(0, 4))} />
    </>
  );
}

export function EquityView({ d, compare }: { d: EquityStatement; compare: boolean }) {
  const part = (p: EquityStatement['current'], tag: string) =>
    p.rows.map((r) => ({
      key: `${tag}-${r.key}`,
      label: r.kind === 'balance' ? `Saldo per ${longDate(r.key === 'OPENING' ? p.period.from : p.period.to)}` : r.label,
      kind: r.kind,
      values: r.values,
    }));
  type ERow = ReturnType<typeof part>[number];
  const rows: ERow[] = [...(compare ? part(d.previous, 'p') : []), ...part(d.current, 'c')];
  // saldo awal tahun berjalan = saldo akhir pembanding, jangan tampil dua kali
  const prevEnd = new Date(`${d.previous.period.to}T00:00:00Z`);
  prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
  const contiguous = prevEnd.toISOString().slice(0, 10) === d.current.period.from;
  const shown = compare && contiguous ? rows.filter((r) => r.key !== 'c-OPENING') : rows;
  return (
    <Table
      size="small"
      rowKey="key"
      pagination={false}
      dataSource={shown}
      scroll={{ x: 900 }}
      columns={[
        { title: '', dataIndex: 'label', render: (l, r) => (r.kind === 'balance' ? <strong>{l}</strong> : <span style={{ paddingLeft: 16 }}>{l}</span>) },
        ...d.columns.map((c) => ({
          title: c.label,
          align: 'right' as const,
          width: 150,
          render: (_: unknown, r: ERow) => <Amount v={r.values[c.key]} strong={r.kind === 'balance' || c.key === 'TOTAL'} double={r.kind === 'balance' && r.key.endsWith('CLOSING')} />,
        })),
      ]}
    />
  );
}

export function CashFlowView({ d, compare }: { d: CashFlowStatement; compare: boolean }) {
  const rows: Row[] = [];
  const sec = (title: string, k: 'operating' | 'investing' | 'financing') => {
    rows.push({ key: `h-${k}`, label: `Arus kas dari ${title}`, kind: 'header' });
    const labels = [...new Set([...d.current[k].items.map((i) => i.label), ...(compare ? d.previous[k].items.map((i) => i.label) : [])])];
    labels.forEach((lb, i) =>
      rows.push({
        key: `${k}-${i}`,
        label: lb,
        amount: d.current[k].items.find((x) => x.label === lb)?.amount ?? '0',
        compare: d.previous[k].items.find((x) => x.label === lb)?.amount ?? '0',
        kind: 'line',
      }),
    );
    rows.push({ key: `t-${k}`, label: `Arus kas bersih dari ${title}`, amount: d.current[k].total, compare: d.previous[k].total, kind: 'total' });
    rows.push({ key: `sp-${k}`, label: '', kind: 'spacer' });
  };
  sec('aktivitas operasi', 'operating');
  sec('aktivitas investasi', 'investing');
  sec('aktivitas pendanaan', 'financing');
  rows.push({ key: 'net', label: 'Kenaikan (penurunan) bersih kas dan setara kas', amount: d.current.netChange, compare: d.previous.netChange, kind: 'subtotal' });
  rows.push({ key: 'open', label: 'Kas dan setara kas awal periode', amount: d.current.opening, compare: d.previous.opening, kind: 'line' });
  rows.push({ key: 'close', label: 'Kas dan setara kas akhir periode', amount: d.current.closing, compare: d.previous.closing, kind: 'grand' });
  const p = periodText;
  return (
    <>
      <Typography.Paragraph type="secondary" className="no-print">
        {d.method === 'indirect'
          ? 'Metode tidak langsung — dimulai dari laba bersih, disesuaikan dengan beban non-kas (penyusutan) dan perubahan modal kerja.'
          : 'Metode langsung — penerimaan & pengeluaran kas dikelompokkan dari lawan akun setiap transaksi kas.'}
      </Typography.Paragraph>
      {Number(d.current.difference) !== 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Selisih rekonsiliasi kas ${fmtMoney(d.current.difference)} — saldo kas di buku besar ${fmtMoney(d.current.actualClosing)}. Biasanya karena akun belum diklasifikasikan dengan benar di Bagan Akun.`}
        />
      )}
      <StatementTable rows={rows} current={p(d.period)} previous={p(d.comparePeriod)} compare={compare} ledgerRange={d.period} />
    </>
  );
}

const dc = (title: string, k: string) => ({
  title,
  children: [
    { title: 'Debit', align: 'right' as const, width: 130, render: (_: unknown, r: object) => <Amount v={(r as Record<string, { debit: string }>)[k]?.debit} /> },
    { title: 'Kredit', align: 'right' as const, width: 130, render: (_: unknown, r: object) => <Amount v={(r as Record<string, { credit: string }>)[k]?.credit} /> },
  ],
});

function totalsRow(keys: string[], totals: Record<string, { debit: string; credit: string }>, label: string) {
  let i = 1;
  return (
    <Table.Summary fixed>
      <Table.Summary.Row>
        <Table.Summary.Cell index={0}>
          <strong>{label}</strong>
        </Table.Summary.Cell>
        {keys.flatMap((k) => [
          <Table.Summary.Cell key={`${k}d`} index={i++} align="right">
            <Amount v={totals[k].debit} strong double />
          </Table.Summary.Cell>,
          <Table.Summary.Cell key={`${k}c`} index={i++} align="right">
            <Amount v={totals[k].credit} strong double />
          </Table.Summary.Cell>,
        ])}
      </Table.Summary.Row>
    </Table.Summary>
  );
}

export function TrialBalanceView({ d, onAccount }: { d: FullTrialBalance; onAccount?: (id: string) => void }) {
  const keys = ['opening', 'movement', 'closing'];
  return (
    <>
      <Tag color={d.balanced ? 'green' : 'red'} style={{ marginBottom: 8 }}>
        {d.balanced ? 'Seimbang' : 'TIDAK seimbang'}
      </Tag>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        bordered
        scroll={{ x: 1100 }}
        dataSource={d.rows}
        columns={[
          {
            title: 'Akun',
            fixed: 'left',
            width: 260,
            render: (_, r) => (onAccount ? <a onClick={() => onAccount(r.id)}>{`${r.code} · ${r.name}`}</a> : `${r.code} · ${r.name}`),
          },
          dc('Saldo awal', 'opening'),
          dc('Mutasi', 'movement'),
          dc('Saldo akhir', 'closing'),
        ]}
        summary={() => totalsRow(keys, d.totals as never, 'Jumlah')}
      />
    </>
  );
}

export function WorksheetView({ d, onAdjustments }: { d: Worksheet; onAdjustments?: () => void }) {
  const keys = ['trial', 'adjustment', 'adjusted', 'incomeStatement', 'balanceSheet'];
  const np = Number(d.netProfit);
  return (
    <>
      <Typography.Paragraph type="secondary" className="no-print">
        Neraca lajur (kertas kerja) — neraca saldo sebelum penyesuaian, kolom penyesuaian dari menu Jurnal Penyesuaian (termasuk penyusutan aset, amortisasi berulang, dan
        pajak penghasilan), neraca saldo setelah penyesuaian, lalu dipisah ke laba rugi dan posisi keuangan.
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        bordered
        scroll={{ x: 1600 }}
        dataSource={d.rows}
        columns={[
          { title: 'Akun', fixed: 'left', width: 240, render: (_, r) => `${r.code} · ${r.name}` },
          dc('Neraca saldo', 'trial'),
          { ...dc('Penyesuaian', 'adjustment'), title: onAdjustments ? <a onClick={onAdjustments}>Penyesuaian ↗</a> : 'Penyesuaian' },
          dc('NS disesuaikan', 'adjusted'),
          dc('Laba rugi', 'incomeStatement'),
          dc('Posisi keuangan', 'balanceSheet'),
        ]}
        summary={() => (
          <>
            {totalsRow(keys, d.totals as never, 'Jumlah')}
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={7}>
                <strong>{np >= 0 ? 'Laba bersih' : 'Rugi bersih'}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right">
                {np >= 0 ? <Amount v={np} strong /> : null}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={8} align="right">
                {np < 0 ? <Amount v={-np} strong /> : null}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={9} align="right">
                {np < 0 ? <Amount v={-np} strong /> : null}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={10} align="right">
                {np >= 0 ? <Amount v={np} strong /> : null}
              </Table.Summary.Cell>
            </Table.Summary.Row>
          </>
        )}
      />
      {!d.balanced && <Alert type="error" message="Neraca lajur tidak seimbang" style={{ marginTop: 12 }} />}
    </>
  );
}

export function VatView({ d }: { d: VatReport }) {
  return (
    <>
      <Descriptions size="small" bordered column={{ xs: 1, md: 4 }} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="PPN keluaran">{fmtMoney(d.vatOut)}</Descriptions.Item>
        <Descriptions.Item label="PPN masukan">{fmtMoney(d.vatIn)}</Descriptions.Item>
        <Descriptions.Item label="Selisih">
          <strong>{fmtMoney(d.net)}</strong>
        </Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color={d.status === 'KURANG_BAYAR' ? 'red' : d.status === 'LEBIH_BAYAR' ? 'blue' : 'default'}>
            {d.status === 'KURANG_BAYAR' ? 'Kurang bayar — setor ke kas negara' : d.status === 'LEBIH_BAYAR' ? 'Lebih bayar — dikompensasi' : 'Nihil'}
          </Tag>
        </Descriptions.Item>
      </Descriptions>
      <Table
        size="small"
        rowKey={(r) => `${r.kind}-${r.number}`}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
        dataSource={d.documents}
        columns={[
          { title: 'Jenis', dataIndex: 'kind', render: (k: string) => <Tag color={k.includes('jual') ? 'cyan' : 'purple'}>{k}</Tag> },
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Referensi', dataIndex: 'ref' },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: 'Pihak', dataIndex: 'party' },
          { title: 'NPWP', dataIndex: 'npwp' },
          { title: 'DPP', dataIndex: 'dpp', align: 'right', render: fmtMoney },
          { title: 'PPN', dataIndex: 'ppn', align: 'right', render: fmtMoney },
        ]}
      />
    </>
  );
}

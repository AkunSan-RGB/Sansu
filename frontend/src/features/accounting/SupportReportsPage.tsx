import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from '@ant-design/icons';
import type { SupportConclusion, SupportReport } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Input, Row, Space, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { type ReactNode, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { supportSheet } from '@/lib/xlsx/reports';
import { NoteTableView } from './statements/NotesView';

const KINDS: { key: SupportReport['kind']; label: string; hint: string; models?: string[] }[] = [
  { key: 'sales', label: 'Penjualan', hint: 'Faktur dan retur, dicocokkan dengan akun pendapatan dan piutang.' },
  { key: 'purchases', label: 'Pembelian', hint: 'Faktur pemasok dan retur, dicocokkan dengan akun utang usaha.' },
  { key: 'inventory', label: 'Persediaan', hint: 'Kartu stok per produk, dicocokkan dengan akun persediaan.' },
  { key: 'cash', label: 'Kas & Bank', hint: 'Mutasi per akun dan sumber, dicocokkan dengan rekening koran.' },
  { key: 'pos', label: 'Kasir', models: ['RITEL', 'FNB'], hint: 'Penjualan per kasir, sesi, dan metode bayar, selisih uang di laci, dicocokkan dengan pendapatan, kas, dan bank.' },
  { key: 'fnb', label: 'F&B', models: ['FNB'], hint: 'Penjualan per menu dan jenis pesanan, pajak restoran daerah, pencairan platform, dan bahan terpakai dibanding resep.' },
  { key: 'fmcg', label: 'FMCG', models: ['FMCG'], hint: 'Penjualan per sales, komisi, promo dan klaim prinsipal, rebate outlet, tukar-guling, konsinyasi, dan setoran kanvas.' },
  { key: 'mfg', label: 'Produksi', models: ['MANUFAKTUR'], hint: 'Hasil dan biaya per perintah, pemakaian bahan dibanding resep, barang dalam proses, dan biaya konversi.' },
  { key: 'jasa', label: 'Jasa & proyek', models: ['JASA'], hint: 'Proyek, termin, kemajuan pekerjaan, dan uang muka pelanggan.' },
  { key: 'utility', label: 'Utilitas', models: ['UTILITAS'], hint: 'Pencatatan meter, tagihan, denda, tunggakan, dan sambungan.' },
  { key: 'other', label: 'Akun lainnya', hint: 'Aset lain, liabilitas, ekuitas, pendapatan/beban lain, dan saldo pajak.' },
];

const LEVELS: Record<SupportConclusion['status'], { label: string; color: string; alert: 'success' | 'info' | 'warning' | 'error'; icon: ReactNode }> = {
  ok: { label: 'Baik', color: 'green', alert: 'success', icon: <CheckCircleFilled style={{ color: '#2e9d5b' }} /> },
  info: { label: 'Info', color: 'blue', alert: 'info', icon: <InfoCircleFilled style={{ color: '#1677ff' }} /> },
  warning: { label: 'Perhatian', color: 'orange', alert: 'warning', icon: <ExclamationCircleFilled style={{ color: '#d9822b' }} /> },
  danger: { label: 'Kritis', color: 'red', alert: 'error', icon: <CloseCircleFilled style={{ color: '#d4380d' }} /> },
};

/** Kesimpulan, temuan, dan saran otomatis yang diturunkan dari angka pada laporan */
function ConclusionPanel({ c }: { c: SupportConclusion }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <Typography.Title level={5} style={{ margin: '12px 0 8px' }}>Kesimpulan dan saran</Typography.Title>
      <Alert type={LEVELS[c.status].alert} showIcon message={c.summary} style={{ marginBottom: 8 }} />
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {c.findings.map((f, i) => (
          <Card key={i} size="small">
            <Space align="start">
              <span style={{ fontSize: 18, marginTop: 2 }}>{LEVELS[f.level].icon}</span>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {f.title} <Tag color={LEVELS[f.level].color}>{LEVELS[f.level].label}</Tag>
                </div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{f.detail}</div>
                {f.action && <div style={{ fontSize: 13, marginTop: 4, color: '#555' }}><b>Saran:</b> {f.action}</div>}
              </div>
            </Space>
          </Card>
        ))}
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
        Kesimpulan dihasilkan otomatis dari angka pada laporan ini dengan aturan tetap; bukan pengganti pertimbangan akuntan.
      </Typography.Paragraph>
    </section>
  );
}

/**
 * Laporan pendukung per bidang: rincian dari dokumen dan kartu pembantu yang angkanya dicocokkan dengan buku besar,
 * sehingga laporan keuangan dapat dipertanggungjawabkan. Selisih ditampilkan apa adanya beserta kemungkinan penyebabnya.
 */
export default function SupportReportsPage() {
  const [params, setParams] = useSearchParams();
  const { me } = useAuth();
  const kinds = KINDS.filter((k) => !k.models || (me && k.models.includes(me.businessModel)));
  const kind = (kinds.find((k) => k.key === params.get('kind'))?.key ?? 'sales') as SupportReport['kind'];
  const [from, setFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));
  const fw = useQuery({ queryKey: ['framework'], queryFn: () => get<{ framework: 'SAK_EP' | 'SAK_EMKM' | 'IFRS' }>('/accounting/statements/framework') });
  const q = useQuery({
    queryKey: ['support-report', kind, from, to],
    queryFn: () => get<SupportReport>(`/accounting/support/${kind}?from=${from}&to=${to}`),
    enabled: !!from && !!to && from <= to,
  });
  const sheets = useMemo(() => (q.data ? supportSheet(q.data, fw.data?.framework ?? 'SAK_EP', me?.tenantName) : []), [q.data, fw.data, me?.tenantName]);
  const preset = (label: string, f: string, t: string) => (
    <Button size="small" key={label} type={from === f && to === t ? 'primary' : 'default'} onClick={() => { setFrom(f); setTo(t); }}>
      {label}
    </Button>
  );
  const now = dayjs();
  const lastMonth = now.subtract(1, 'month');

  return (
    <>
      <PageHeader
        title="Laporan pendukung"
        extra={
          <Space wrap className="no-print">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>s/d</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <ExportButtons filename={`laporan-pendukung-${kind}-${to}`} title={`${q.data?.title ?? 'Laporan pendukung'} ${fmtDate(from)} s/d ${fmtDate(to)}`} sheets={() => (sheets.length ? sheets : null)} />
          </Space>
        }
      />
      <Card className="print-area">
        <Tabs
          activeKey={kind}
          onChange={(k) => setParams({ kind: k }, { replace: true })}
          className="no-print"
          items={kinds.map((k) => ({ key: k.key, label: k.label }))}
        />
        <Typography.Paragraph type="secondary" className="no-print">
          {kinds.find((k) => k.key === kind)?.hint} Angka dihitung ulang dari pembukuan setiap dibuka.
        </Typography.Paragraph>
        <Space wrap size={[8, 8]} className="no-print" style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary">Periode:</Typography.Text>
          {preset('Bulan ini', now.startOf('month').format('YYYY-MM-DD'), now.format('YYYY-MM-DD'))}
          {preset('Bulan lalu', lastMonth.startOf('month').format('YYYY-MM-DD'), lastMonth.endOf('month').format('YYYY-MM-DD'))}
          {preset('Tahun ini', now.startOf('year').format('YYYY-MM-DD'), now.format('YYYY-MM-DD'))}
        </Space>
        {from > to && <Alert type="warning" showIcon message="Tanggal awal tidak boleh setelah tanggal akhir" style={{ marginBottom: 16 }} />}
        <QueryState q={q}>
          {(d) => (
            <div className="calk" style={{ maxWidth: 1000, margin: '0 auto' }}>
              <Typography.Title level={4} style={{ margin: '0 0 2px' }}>{d.title}</Typography.Title>
              <Typography.Paragraph type="secondary">
                Periode {fmtDate(d.period.from)} s/d {fmtDate(d.period.to)}. {d.summary}
              </Typography.Paragraph>


              <ConclusionPanel c={d.conclusion} />

              <Typography.Title level={5} style={{ margin: '12px 0 8px' }}>Pencocokan dengan buku besar</Typography.Title>
              <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
                {d.reconciliation.map((r) => (
                  <Col xs={24} md={12} key={r.key}>
                    <Card size="small" style={{ height: '100%', borderColor: r.ok ? '#b7e4c7' : '#f5c2a8' }}>
                      <Space align="start">
                        {r.ok ? <CheckCircleFilled style={{ color: '#2e9d5b', fontSize: 18, marginTop: 2 }} /> : <ExclamationCircleFilled style={{ color: '#d9822b', fontSize: 18, marginTop: 2 }} />}
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {r.title} <Tag color={r.ok ? 'green' : 'orange'}>{r.ok ? 'Cocok' : 'Selisih'}</Tag>
                          </div>
                          <div style={{ fontSize: 13, marginTop: 4 }}>
                            {r.left.label}: <b>{fmtMoney(r.left.value)}</b>
                          </div>
                          <div style={{ fontSize: 13 }}>
                            {r.right.label}: <b>{fmtMoney(r.right.value)}</b>
                          </div>
                          {!r.ok && (
                            <div style={{ fontSize: 13, color: '#b45309', marginTop: 4 }}>
                              Selisih {fmtMoney(r.diff)}. {r.note}
                            </div>
                          )}
                        </div>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>

              {d.sections.map((s) => (
                <section key={s.key} style={{ marginBottom: 28, breakInside: 'avoid-page' }}>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    {s.number}. {s.title}
                  </Typography.Title>
                  {s.paragraphs.map((p, i) => (
                    <Typography.Paragraph key={i} type="secondary" style={{ margin: '4px 0' }}>
                      {p}
                    </Typography.Paragraph>
                  ))}
                  {s.tables.map((t, i) => (
                    <div key={i} style={{ overflowX: 'auto' }}>
                      <NoteTableView t={t} />
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </QueryState>
      </Card>
    </>
  );
}

import { CheckCircleFilled, ExclamationCircleFilled } from '@ant-design/icons';
import { canViewFinancials, type SupportConclusion, type SupportReport } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Input, Row, Select, Space, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { conclusionGroups } from '@/lib/conclusionText';
import { fmtDate, fmtMoney } from '@/lib/format';
import { supportSheet } from '@/lib/xlsx/reports';
import SchedulesPanel, { type ScheduleSection } from './schedules/SchedulesPanel';
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

/** Tab rincian dan perhitungan per akun: angka tahunan, bukan rentang tanggal, dan tidak memakai laporan bidang di atas */
const SCHEDULE_TABS: { key: ScheduleSection; label: string; hint: string }[] = [
  { key: 'rincian', label: 'Rincian per akun', hint: 'Rincian, perhitungan, dan metode setiap akun di laporan keuangan, dicocokkan dengan saldo akhirnya. Klik akun untuk membukanya.' },
  { key: 'kontrak', label: 'Kontrak & pinjaman', hint: 'Daftar pinjaman, sewa pembiayaan, dan biaya dibayar di muka; jadwal pokok, bunga, dan amortisasinya dibandingkan dengan buku besar.' },
  { key: 'beku', label: 'Laporan dibekukan', hint: 'Angka laporan yang sudah ditandatangani disimpan tak bisa diubah, lalu dibandingkan dengan pembukuan sesudahnya.' },
  { key: 'aset', label: 'Aset tetap', hint: 'Daftar aset, penyusutan bulanan, dan kategori aset. Rincian perhitungannya ada di tab Rincian per akun.' },
];

/** Paragraf rata kiri-kanan; pemenggalan kata otomatis (bahasa Indonesia) menjaga jarak antarkata tetap rapat di layar sempit */
const JUSTIFY = { textAlign: 'justify', hyphens: 'auto' } as const;

/** Kesimpulan dan saran otomatis, ditulis sebagai paragraf bernomor di akhir laporan */
function ConclusionSection({ c }: { c: SupportConclusion }) {
  const groups = conclusionGroups(c);
  return (
    <section style={{ marginTop: 8, paddingTop: 20, borderTop: '2px solid #d9dde6', breakInside: 'avoid-page' }}>
      <Typography.Title level={5} style={{ margin: '0 0 8px' }}>Kesimpulan dan saran</Typography.Title>
      <Typography.Paragraph style={JUSTIFY}>{c.summary}</Typography.Paragraph>
      {groups.map((g) => (
        <div key={g.heading} style={{ marginBottom: 12 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>{g.heading}</Typography.Text>
          {g.items.map((i) => (
            <Typography.Paragraph key={i.no} style={{ ...JUSTIFY, margin: '0 0 8px', paddingLeft: 24, textIndent: -24 }}>
              {i.no}.&nbsp;&nbsp;<b>{i.lead}</b> {i.body}
            </Typography.Paragraph>
          ))}
        </div>
      ))}
      <Typography.Paragraph type="secondary" style={{ ...JUSTIFY, fontSize: 12, margin: '12px 0 0' }}>
        Kesimpulan di atas dihasilkan otomatis dari angka pada laporan ini dengan ambang yang dapat diatur di Pengaturan perusahaan; bukan pengganti pertimbangan akuntan.
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
  const scheduleTabs = canViewFinancials(me?.role) ? SCHEDULE_TABS : [];
  const section = scheduleTabs.find((t) => t.key === params.get('kind'));
  const thisYear = new Date().getFullYear();
  const year = Number(params.get('year')) || thisYear;
  const kind = (kinds.find((k) => k.key === params.get('kind'))?.key ?? 'sales') as SupportReport['kind'];
  const [from, setFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));
  const fw = useQuery({ queryKey: ['framework'], queryFn: () => get<{ framework: 'SAK_EP' | 'SAK_EMKM' | 'IFRS' }>('/accounting/statements/framework') });
  const q = useQuery({
    queryKey: ['support-report', kind, from, to],
    queryFn: () => get<SupportReport>(`/accounting/support/${kind}?from=${from}&to=${to}`),
    enabled: !section && !!from && !!to && from <= to,
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
          section ? (
            <Select
              className="no-print"
              value={year}
              style={{ width: 150 }}
              onChange={(y) => {
                const n = new URLSearchParams(params);
                n.set('year', String(y));
                n.delete('account');
                setParams(n, { replace: true });
              }}
              options={Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => ({ value: y, label: `Tahun ${y}` }))}
            />
          ) : (
            <Space wrap className="no-print">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span>s/d</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              <ExportButtons filename={`laporan-pendukung-${kind}-${to}`} title={`${q.data?.title ?? 'Laporan pendukung'} ${fmtDate(from)} s/d ${fmtDate(to)}`} sheets={() => (sheets.length ? sheets : null)} />
            </Space>
          )
        }
      />
      <Card className="print-area">
        <Tabs
          activeKey={section?.key ?? kind}
          onChange={(k) => {
            const n = new URLSearchParams();
            n.set('kind', k);
            if (scheduleTabs.some((t) => t.key === k) && params.get('year')) n.set('year', params.get('year')!);
            setParams(n, { replace: true });
          }}
          className="no-print"
          items={[...kinds.map((k) => ({ key: k.key as string, label: k.label })), ...scheduleTabs.map((t) => ({ key: t.key as string, label: t.label }))]}
        />
        <Typography.Paragraph type="secondary" className="no-print" style={JUSTIFY}>
          {section ? section.hint : `${kinds.find((k) => k.key === kind)?.hint} Angka dihitung ulang dari pembukuan setiap dibuka.`}
        </Typography.Paragraph>
        {section && <SchedulesPanel section={section.key} year={year} />}
        {!section && (<>
        <Space wrap size={[8, 8]} className="no-print" style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary">Periode:</Typography.Text>
          {preset('Bulan ini', now.startOf('month').format('YYYY-MM-DD'), now.format('YYYY-MM-DD'))}
          {preset('Bulan lalu', lastMonth.startOf('month').format('YYYY-MM-DD'), lastMonth.endOf('month').format('YYYY-MM-DD'))}
          {preset('Tahun ini', now.startOf('year').format('YYYY-MM-DD'), now.format('YYYY-MM-DD'))}
        </Space>
        {from > to && <Alert type="warning" showIcon message="Tanggal awal tidak boleh setelah tanggal akhir" style={{ marginBottom: 16 }} />}
        <QueryState q={q}>
          {(d) => (
            <div className="calk" lang="id" style={{ maxWidth: 1000, margin: '0 auto' }}>
              <Typography.Title level={4} style={{ margin: '0 0 2px' }}>{d.title}</Typography.Title>
              <Typography.Paragraph type="secondary" style={JUSTIFY}>
                Periode {fmtDate(d.period.from)} s/d {fmtDate(d.period.to)}. {d.summary}
              </Typography.Paragraph>



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
                    <Typography.Paragraph key={i} type="secondary" style={{ ...JUSTIFY, margin: '4px 0' }}>
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

              <ConclusionSection c={d.conclusion} />
            </div>
          )}
        </QueryState>
        </>)}
      </Card>
    </>
  );
}

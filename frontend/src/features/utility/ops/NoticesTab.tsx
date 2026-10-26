import { NOTICE_CHANNELS, NOTICE_CHANNEL_LABELS, NOTICE_KIND_LABELS, type NoticeChannel, type NoticeKind } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Dropdown, Segmented, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { fmtDate, fmtMoney } from '@/lib/format';

interface Cand { connection_id: string; invoice_id: string; number: string; address: string; customer: string; phone: string | null; outstanding: string; periods: string; oldest_due: string; days_late: number; message: string; whatsapp: string | null; sentBefore: boolean; alreadyToday: boolean; last_notice_at: string | null }
interface Result { kind: NoticeKind; period: string | null; company: string; total: number; rows: Cand[] }
const KINDS: NoticeKind[] = ['REKENING', 'PENGINGAT', 'SP1', 'SP2', 'SP3'];
const HINT: Record<string, string> = { REKENING: 'Rekening tagihan satu periode yang masih terbuka.', PENGINGAT: 'Tagihan yang jatuh tempo dalam 3 hari ke depan.', SP1: 'Terlambat 7–20 hari.', SP2: 'Terlambat 21–34 hari.', SP3: 'Terlambat 35 hari atau lebih — peringatan terakhir sebelum pemutusan.' };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Buka jendela cetak berisi satu surat per halaman */
function printLetters(res: Result, rows: Cand[]) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const title = NOTICE_KIND_LABELS[res.kind];
  const pages = rows.map((r) => `<section><h2>${esc(res.company)}</h2><h3>${esc(title)}</h3><p>${dayjs().format('DD MMMM YYYY')}</p><p>Kepada Yth.<br><b>${esc(r.customer)}</b><br>${esc(r.address)}<br>Sambungan ${esc(r.number)}</p><p>${esc(r.message)}</p>
    <table><tr><td>Periode tagihan</td><td>${esc(r.periods)}</td></tr><tr><td>Jatuh tempo</td><td>${esc(fmtDate(r.oldest_due))}</td></tr><tr><td>Terlambat</td><td>${r.days_late} hari</td></tr><tr><td>Jumlah yang harus dibayar</td><td><b>${esc(fmtMoney(r.outstanding))}</b></td></tr></table>
    <p style="margin-top:48px">Hormat kami,<br><br><br>${esc(res.company)}</p></section>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:14px/1.5 Arial,sans-serif;color:#111}section{page-break-after:always;padding:32px 40px;max-width:720px}h2{margin:0}h3{margin:4px 0 16px}table{border-collapse:collapse;margin-top:12px}td{border:1px solid #999;padding:4px 10px}</style></head><body>${pages}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}

/** Cetak dan kirim massal: rekening, pengingat, dan surat peringatan bertingkat (SP1–SP3). Setiap pengiriman dicatat. */
export function NoticesTab() {
  const can = useCan();
  const [kind, setKind] = useState<NoticeKind>('SP1');
  const [period, setPeriod] = useState(dayjs().subtract(1, 'month'));
  const [sel, setSel] = useState<React.Key[]>([]);
  const q = useQuery({ queryKey: ['utility', 'notices', kind, period.format('YYYY-MM')], queryFn: () => get<Result>(`/utility/notices/candidates?kind=${kind}${kind === 'REKENING' ? `&period=${period.format('YYYY-MM')}` : ''}`) });
  const hist = useQuery({ queryKey: ['utility', 'notices', 'history'], queryFn: () => get<{ id: string; kind: NoticeKind; channel: NoticeChannel; sent_at: string; connection: string; customer: string; sent_by: string | null }[]>('/utility/notices/history') });
  const log = useAction((v: { channel: NoticeChannel; rows: Cand[]; silent?: boolean }) => post<{ count: number }>('/utility/notices/log', { kind, channel: v.channel, items: v.rows.map((r) => ({ connectionId: r.connection_id, invoiceId: r.invoice_id })) }), { success: (r) => `${r.count} pengiriman dicatat`, invalidate: ['utility'], onSuccess: () => setSel([]) });
  const res = q.data;
  const chosen = (res?.rows ?? []).filter((r) => sel.includes(r.connection_id));
  const write = can('POST', '/utility/notices/log');
  const doPrint = () => { if (res && printLetters(res, chosen)) log.mutate({ channel: 'CETAK', rows: chosen }); };
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Surat peringatan bertingkat" description="SP1 untuk keterlambatan 7 hari, SP2 21 hari, SP3 35 hari. Pilih pelanggan, lalu cetak (satu surat per halaman) atau kirim lewat WhatsApp. Setiap pengiriman dicatat supaya tidak terkirim dobel dan bisa ditelusuri." />
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented value={kind} onChange={(v) => { setKind(v as NoticeKind); setSel([]); }} options={KINDS.map((k) => ({ value: k, label: NOTICE_KIND_LABELS[k].replace(' (pemutusan)', '') }))} />
        {kind === 'REKENING' && <DatePicker picker="month" allowClear={false} value={period} onChange={(d) => d && setPeriod(d)} />}
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{HINT[kind]} {res && `${res.rows.length} pelanggan · total ${fmtMoney(res.total)}`}</Typography.Paragraph>
      {write && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Button type="primary" disabled={!chosen.length} loading={log.isPending} onClick={doPrint}>Cetak surat ({chosen.length})</Button>
          <Dropdown disabled={!chosen.length} menu={{ items: NOTICE_CHANNELS.filter((c) => c !== 'CETAK').map((c) => ({ key: c, label: `Tandai terkirim lewat ${NOTICE_CHANNEL_LABELS[c]}` })), onClick: ({ key }) => log.mutate({ channel: key as NoticeChannel, rows: chosen }) }}><Button disabled={!chosen.length}>Tandai terkirim ▾</Button></Dropdown>
          <Button onClick={() => setSel((res?.rows ?? []).filter((r) => !r.alreadyToday).map((r) => r.connection_id))}>Pilih yang belum dikirim hari ini</Button>
        </Space>
      )}
      <Table<Cand> rowKey="connection_id" size="small" loading={q.isLoading} dataSource={res?.rows} pagination={{ pageSize: 25 }} locale={{ emptyText: 'Tidak ada pelanggan pada tingkat ini' }}
        rowSelection={write ? { selectedRowKeys: sel, onChange: setSel } : undefined} scroll={{ x: 'max-content' }}
        columns={[
          { title: 'Pelanggan', render: (_: unknown, r: Cand) => <><b>{r.customer}</b><div style={{ fontSize: 12, color: '#64748b' }}>{r.number} · {r.address}</div></> },
          { title: 'Periode', dataIndex: 'periods' },
          { title: 'Jumlah', align: 'right' as const, render: (_: unknown, r: Cand) => fmtMoney(r.outstanding) },
          { title: 'Telat', render: (_: unknown, r: Cand) => (r.days_late ? `${r.days_late} hari` : '-') },
          { title: 'Status kirim', render: (_: unknown, r: Cand) => (r.alreadyToday ? <Tag color="green">Terkirim hari ini</Tag> : r.sentBefore ? <Tag>Pernah dikirim {fmtDate(r.last_notice_at)}</Tag> : <Tag color="gold">Belum</Tag>) },
          { render: (_: unknown, r: Cand) => r.whatsapp && write ? <Button size="small" href={r.whatsapp} target="_blank" rel="noreferrer" onClick={() => log.mutate({ channel: 'WHATSAPP', rows: [r] })}>Kirim WhatsApp</Button> : <Typography.Text type="secondary">{r.phone ? '' : 'tanpa nomor HP'}</Typography.Text> },
        ]} />
      <Typography.Title level={5} style={{ marginTop: 24 }}>Riwayat pengiriman</Typography.Title>
      <Table size="small" rowKey="id" loading={hist.isLoading} dataSource={hist.data} pagination={{ pageSize: 10 }} columns={[
        { title: 'Waktu', render: (_: unknown, h: NonNullable<typeof hist.data>[number]) => dayjs(h.sent_at).format('DD MMM HH:mm') }, { title: 'Jenis', render: (_: unknown, h: NonNullable<typeof hist.data>[number]) => NOTICE_KIND_LABELS[h.kind] },
        { title: 'Lewat', render: (_: unknown, h: NonNullable<typeof hist.data>[number]) => NOTICE_CHANNEL_LABELS[h.channel] }, { title: 'Pelanggan', render: (_: unknown, h: NonNullable<typeof hist.data>[number]) => `${h.customer} (${h.connection})` }, { title: 'Oleh', dataIndex: 'sent_by' },
      ]} />
    </>
  );
}

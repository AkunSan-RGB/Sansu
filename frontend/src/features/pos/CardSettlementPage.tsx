import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Segmented, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAccounts, useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

const KEY = ['card-settlements'];
interface Cfg { qrisPct: number; debitPct: number; lateAfterDays: number; toleranceRp: number }
interface Pay { id: string; method: 'QRIS' | 'DEBIT'; amount: string; orderNumber: string; date: string; returned: string; bankAccountId: string }
interface Ret { id: string; number: string; date: string; total: string; orderNumber: string; bankAccountId: string }
interface Row { id: string; number: string; date: string; method: string; gross: string; returnsTotal: string; mdrPct: string; mdrExpected: string; received: string; difference: string; itemCount: number; status: 'POSTED' | 'CANCELLED'; note: string | null; cancelReason: string | null }
interface Controls { settings: Cfg; notSettledLate: { method: string; count: number; amount: string; oldest: string }[]; withDifference: { number: string; difference: string }[]; highEffectiveMdr: { number: string; contractPct: string; effectivePct: string }[] }

export default function CardSettlementPage() {
  const can = useCan();
  const [method, setMethod] = useState<'QRIS' | 'DEBIT'>('QRIS');
  const unsettled = useQuery({ queryKey: [...KEY, 'unsettled', method], queryFn: () => get<Pay[]>(`/pos/card-settlements/unsettled?method=${method}`) });
  const rets = useQuery({ queryKey: [...KEY, 'returns', method], queryFn: () => get<Ret[]>(`/pos/card-settlements/unsettled-returns?method=${method}`) });
  const accounts = useAccounts();
  const bankName = (id: string) => { const a = (accounts.data ?? []).find((x) => x.id === id); return a ? `${a.code} · ${a.name}` : id.slice(0, 8); };
  const [pickedRets, setPickedRets] = useState<string[]>([]);
  const list = useQuery({ queryKey: [...KEY, 'list'], queryFn: () => get<Row[]>('/pos/card-settlements') });
  const controls = useQuery({ queryKey: [...KEY, 'controls'], queryFn: () => get<Controls>('/pos/card-settlements/controls'), retry: false });
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ received?: number; banks?: Record<string, number>; note?: string }>();
  const [cancelRow, setCancelRow] = useState<Row | null>(null);
  const [cf] = Form.useForm<{ reason: string }>();
  const [cfgOpen, setCfgOpen] = useState(false);
  const [sf] = Form.useForm<Cfg>();
  const cfg = controls.data?.settings;
  const pct = cfg ? (method === 'QRIS' ? cfg.qrisPct : cfg.debitPct) : 0;
  const chosenPays = (unsettled.data ?? []).filter((p) => picked.includes(p.id));
  const chosenRets = (rets.data ?? []).filter((r) => pickedRets.includes(r.id));
  // per rekening: kotor, retur, MDR atas penjualan bersih, seharusnya masuk
  const perBank = new Map<string, { gross: number; ret: number }>();
  for (const p of chosenPays) perBank.set(p.bankAccountId, { gross: (perBank.get(p.bankAccountId)?.gross ?? 0) + Number(p.amount), ret: perBank.get(p.bankAccountId)?.ret ?? 0 });
  for (const r of chosenRets) perBank.set(r.bankAccountId, { gross: perBank.get(r.bankAccountId)?.gross ?? 0, ret: (perBank.get(r.bankAccountId)?.ret ?? 0) + Number(r.total) });
  const bankRows = [...perBank.entries()].map(([bank, v]) => { const base = v.gross - v.ret; const m = Math.round((base * pct) / 100); return { bank, ...v, base, mdr: m, expected: base - m }; });
  const multi = bankRows.length > 1;
  const gross = bankRows.reduce((a, b) => a + b.gross, 0);
  const retTotal = bankRows.reduce((a, b) => a + b.ret, 0);
  const mdr = bankRows.reduce((a, b) => a + b.mdr, 0);
  const expectedNet = bankRows.reduce((a, b) => a + b.expected, 0);
  const received = Form.useWatch('received', form);
  const bankVals = Form.useWatch('banks', form);
  const diff = multi ? bankRows.reduce((a, b) => a + ((bankVals?.[b.bank] ?? b.expected) - b.expected), 0) : received == null ? 0 : received - expectedNet;
  const anyDiff = multi ? bankRows.some((b) => bankVals?.[b.bank] != null && bankVals[b.bank] !== b.expected) : received != null && diff !== 0;
  const settle = useAction((v: { received?: number; banks?: Record<string, number>; note?: string }) => post('/pos/card-settlements', { method, paymentIds: picked, returnIds: pickedRets.length ? pickedRets : undefined, ...(multi ? { bankReceipts: bankRows.map((b) => ({ bankAccountId: b.bank, received: String(v.banks?.[b.bank] ?? '') })) } : { received: String(v.received) }), note: v.note }), { invalidate: KEY, success: 'Pencairan dicatat', onSuccess: () => { setOpen(false); setPicked([]); setPickedRets([]); } });
  const cancel = useAction((v: { reason: string }) => post(`/pos/card-settlements/${cancelRow!.id}/cancel`, v), { invalidate: KEY, success: 'Pencairan dibatalkan', onSuccess: () => setCancelRow(null) });
  const saveCfg = useAction((v: Cfg) => put('/pos/card-settlements/settings', v), { invalidate: KEY, success: 'Pengaturan disimpan', onSuccess: () => setCfgOpen(false) });
  const c = controls.data;
  const warn = c ? c.notSettledLate.length + c.withDifference.length + c.highEffectiveMdr.length : 0;
  return (
    <>
      <PageHeader title="Pencairan QRIS & kartu debit" extra={can('PUT', '/pos/card-settlements/settings') && <Button onClick={() => { if (cfg) sf.setFieldsValue(cfg); setCfgOpen(true); }}>Atur MDR</Button>} />
      <Typography.Paragraph type="secondary">Penjualan QRIS/debit dicatat masuk bank sebesar penuh. Saat penyelenggara mencairkan uang bersih (dikurangi MDR), pilih pembayaran yang dicairkan, isi jumlah yang masuk di rekening koran, lalu sistem mencocokkan dan menjurnal MDR serta selisihnya.</Typography.Paragraph>
      {warn > 0 && c && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Perlu ditindaklanjuti" description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.notSettledLate.map((l) => <li key={l.method}>{l.count} pembayaran {l.method} ({fmtMoney(l.amount)}) belum cair sejak {fmtDate(l.oldest)}</li>)}
            {c.withDifference.length > 0 && <li>Pencairan berselisih (60 hari): {c.withDifference.map((x) => `${x.number} (${fmtMoney(x.difference)})`).join(', ')}</li>}
            {c.highEffectiveMdr.length > 0 && <li>MDR efektif jauh di atas kontrak: {c.highEffectiveMdr.map((x) => `${x.number} (${x.effectivePct}% vs ${x.contractPct}%)`).join(', ')}</li>}
          </ul>} />
      )}
      <Card title="Belum dicairkan" extra={<Segmented value={method} onChange={(v) => { setMethod(v as 'QRIS' | 'DEBIT'); setPicked([]); setPickedRets([]); }} options={[{ value: 'QRIS', label: 'QRIS' }, { value: 'DEBIT', label: 'Debit' }]} />} style={{ marginBottom: 16 }}>
        <ResponsiveTable<Pay> rowKey="id" size="small" loading={unsettled.isLoading} dataSource={unsettled.data} pagination={{ pageSize: 15 }} locale={{ emptyText: 'Tidak ada pembayaran yang menunggu pencairan' }}
          rowSelection={{ selectedRowKeys: picked, onChange: (k) => setPicked(k as string[]) }}
          columns={[
            { title: 'Transaksi', render: (_: unknown, p: Pay) => <div>{p.orderNumber}<div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(p.date)}</div></div> },
            { title: 'Jumlah', render: (_: unknown, p: Pay) => fmtMoney(p.amount) },
            { title: 'Retur', render: (_: unknown, p: Pay) => (Number(p.returned) > 0 ? <Tag color="orange">retur {fmtMoney(p.returned)}</Tag> : '-') },
          ]} />
        {(rets.data?.length ?? 0) > 0 && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text strong>Retur non-tunai yang dipotongkan penyelenggara</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>Retur yang dikembalikan lewat rekening dari pesanan yang seluruhnya dibayar {method}. Centang yang dipotongkan dari pencairan ini; MDR dihitung atas penjualan bersih (kotor − retur).</Typography.Paragraph>
            <ResponsiveTable<Ret> rowKey="id" size="small" pagination={false} dataSource={rets.data} rowSelection={{ selectedRowKeys: pickedRets, onChange: (k) => setPickedRets(k as string[]) }}
              columns={[{ title: 'Retur', render: (_: unknown, r: Ret) => <div>{r.number}<div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(r.date)} · pesanan {r.orderNumber}</div></div> }, { title: 'Jumlah', render: (_: unknown, r: Ret) => fmtMoney(r.total) }]} />
          </div>
        )}
        {can('POST', '/pos/card-settlements') && (
          <Space style={{ marginTop: 12 }} wrap>
            <Button type="primary" disabled={!picked.length} onClick={() => { form.resetFields(); setOpen(true); }}>Catat pencairan ({picked.length})</Button>
            {picked.length > 0 && <Typography.Text type="secondary">Kotor {fmtMoney(gross)}{retTotal > 0 ? ` − retur ${fmtMoney(retTotal)}` : ''} · MDR {pct}% ≈ {fmtMoney(mdr)} · seharusnya masuk {fmtMoney(expectedNet)}{multi ? ` (${bankRows.length} rekening)` : ''}</Typography.Text>}
          </Space>
        )}
      </Card>
      <Typography.Title level={5}>Riwayat pencairan</Typography.Title>
      <ResponsiveTable<Row> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 10 }} locale={{ emptyText: 'Belum ada pencairan' }}
        columns={[
          { title: 'Nomor', render: (_: unknown, r: Row) => <div>{r.number}<div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(r.date)} · {r.method} · {r.itemCount} transaksi</div></div> },
          { title: 'Kotor', render: (_: unknown, r: Row) => <div>{fmtMoney(r.gross)}{Number(r.returnsTotal) > 0 && <div style={{ fontSize: 12, color: '#64748b' }}>retur {fmtMoney(r.returnsTotal)}</div>}</div> },
          { title: 'MDR kontrak', render: (_: unknown, r: Row) => `${fmtMoney(r.mdrExpected)} (${Number(r.mdrPct)}%)` },
          { title: 'Diterima', render: (_: unknown, r: Row) => fmtMoney(r.received) },
          { title: 'Selisih', render: (_: unknown, r: Row) => (Number(r.difference) === 0 ? '-' : <Tag color="red">{fmtMoney(r.difference)}</Tag>) },
          { title: 'Status', render: (_: unknown, r: Row) => <div>{r.status === 'POSTED' ? <Tag color="green">Tercatat</Tag> : <Tag>Dibatalkan</Tag>}{r.note && <div style={{ fontSize: 12 }}>{r.note}</div>}{r.cancelReason && <div style={{ fontSize: 12, color: '#64748b' }}>{r.cancelReason}</div>}</div> },
          { render: (_: unknown, r: Row) => (r.status === 'POSTED' && can('POST', '/pos/card-settlements/:id/cancel') ? <Button size="small" danger onClick={() => { cf.resetFields(); setCancelRow(r); }}>Batalkan</Button> : null) },
        ]} />
      <Modal title={`Catat pencairan ${method}`} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={settle.isPending} okText="Catat" destroyOnHidden>
        <Typography.Paragraph type="secondary">{picked.length} transaksi{pickedRets.length ? ` · ${pickedRets.length} retur` : ''} · kotor {fmtMoney(gross)}{retTotal > 0 ? ` − retur ${fmtMoney(retTotal)}` : ''} · MDR {pct}% ≈ {fmtMoney(mdr)}. Seharusnya masuk <b>{fmtMoney(expectedNet)}</b>.</Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(v) => settle.mutate(v)}>
          {multi ? (
            <>
              <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Pembayaran/retur ini menyangkut lebih dari satu rekening: isi uang yang masuk di tiap rekening menurut rekening koran." />
              {bankRows.map((b) => <Form.Item key={b.bank} name={['banks', b.bank]} label={`${bankName(b.bank)} — seharusnya ${fmtMoney(b.expected)}`} rules={[{ required: true }]}><InputNumber min={0} style={{ width: 240 }} /></Form.Item>)}
            </>
          ) : <Form.Item name="received" label="Uang bersih yang masuk (Rp, dari rekening koran)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 240 }} /></Form.Item>}
          {anyDiff && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Selisih ${fmtMoney(diff)} dari hitungan MDR kontrak; wajib dijelaskan.`} />}
          <Form.Item name="note" label="Penjelasan selisih" rules={anyDiff ? [{ required: true, min: 5, message: 'Wajib diisi (min. 5 huruf)' }] : []}><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={`Batalkan ${cancelRow?.number ?? ''}`} open={!!cancelRow} onCancel={() => setCancelRow(null)} onOk={() => cf.submit()} confirmLoading={cancel.isPending} okText="Batalkan pencairan" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={cf} layout="vertical" onFinish={(v) => cancel.mutate(v)}><Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item></Form>
      </Modal>
      <Modal title="Pengaturan MDR" open={cfgOpen} onCancel={() => setCfgOpen(false)} onOk={() => sf.submit()} confirmLoading={saveCfg.isPending} okText="Simpan" destroyOnHidden>
        <Form form={sf} layout="vertical" onFinish={(v) => saveCfg.mutate(v)}>
          <Form.Item name="qrisPct" label="MDR QRIS (%)" rules={[{ required: true }]}><InputNumber min={0} max={10} step={0.1} style={{ width: 160 }} /></Form.Item>
          <Form.Item name="debitPct" label="MDR kartu debit (%)" rules={[{ required: true }]}><InputNumber min={0} max={10} step={0.1} style={{ width: 160 }} /></Form.Item>
          <Form.Item name="lateAfterDays" label="Dianggap terlambat cair setelah (hari)" rules={[{ required: true }]}><InputNumber min={1} max={30} style={{ width: 160 }} /></Form.Item>
          <Form.Item name="toleranceRp" label="Toleransi selisih untuk Keuangan (Rp)" extra="Selisih di atas ini hanya bisa dicatat Admin/Pemilik" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 160 }} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

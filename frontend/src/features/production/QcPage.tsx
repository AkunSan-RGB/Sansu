import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Radio, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post, put, del } from '@/api/client';
import { useAction, useProducts } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { compressImage } from '@/lib/image';

const KEY = ['qc'];
type St = 'PENDING' | 'PASSED' | 'FAILED' | 'PARTIAL';
const ST: Record<St, { label: string; color: string }> = { PENDING: { label: 'Menunggu inspeksi', color: 'gold' }, PASSED: { label: 'Lolos', color: 'green' }, FAILED: { label: 'Gagal', color: 'red' }, PARTIAL: { label: 'Sebagian lolos', color: 'orange' } };
interface Insp { id: string; number: string; status: St; qty: string; qtyPass: string | null; qtyFail: string | null; qtyScrapped: string; unitCost: string; createdAt: string; note: string | null; sku: string; productName: string; orderNumber: string | null; warehouseName: string; releaseWarehouseName: string; sourceType: 'PRODUCTION' | 'RECEIPT'; attempt: number; qtyReworked: string; sampleSize: string | null; acceptDefects: number | null; sampleDefects: number | null; receiptNumber: string | null; parentNumber: string | null; lotNo: string | null }
interface Attachment { id: string; kind: 'PHOTO' | 'COA'; filename: string; mime: string; uploadedBy: string | null }
interface Result { id: string; sequence: number; name: string; kind: 'NUMERIC' | 'PASSFAIL'; minValue: string | null; maxValue: string | null; unit: string | null; critical: boolean; value: string | null; passed: boolean | null }
interface Param { name: string; kind: 'NUMERIC' | 'PASSFAIL'; minValue?: number | null; maxValue?: number | null; unit?: string | null; critical?: boolean }
interface Plan { id: string; productId: string; sku: string; productName: string; name: string; qcRequired: boolean; samplePct: string | null; sampleMin: number | null; sampleMax: number | null; acceptDefects: number | null; params: (Param & { id: string })[] }
interface Controls { pendingOverOneDay: { number: string; product: string }[]; failedHeldInQuarantine: { number: string; product: string; qty: string; value: string }[]; failRateByProduct: { product: string; inspections: number; failed: string; failPct: string }[]; inspectionsWithoutPlan: { number: string }[]; reworkAttempts?: { number: string; product: string; attempt: number }[]; inboundFailRateBySupplier?: { supplier: string; inspections: number; failed: string; failPct: string }[] }

export default function QcPage() {
  const can = useCan();
  const controls = useQuery({ queryKey: [...KEY, 'controls'], queryFn: () => get<Controls>('/qc/controls'), retry: false });
  const setup = useAction(() => post('/qc/setup'), { invalidate: KEY, success: 'Gudang karantina siap' });
  const c = controls.data;
  const warn = c ? c.pendingOverOneDay.length + c.failedHeldInQuarantine.length + c.inspectionsWithoutPlan.length : 0;
  return (
    <>
      <PageHeader title="Pengendalian mutu (QC)" extra={can('POST', '/qc/setup') && <Button onClick={() => setup.mutate(undefined)} loading={setup.isPending}>Siapkan karantina</Button>} />
      {warn > 0 && c && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Perlu ditindaklanjuti" description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.pendingOverOneDay.length > 0 && <li>{c.pendingOverOneDay.length} inspeksi menunggu lebih dari sehari: {c.pendingOverOneDay.map((x) => x.number).join(', ')}</li>}
            {c.failedHeldInQuarantine.map((x) => <li key={x.number}>{x.number} · {x.product}: {Number(x.qty)} unit gagal masih di karantina ({fmtMoney(x.value)})</li>)}
            {c.inspectionsWithoutPlan.length > 0 && <li>Inspeksi tanpa rencana QC: {c.inspectionsWithoutPlan.map((x) => x.number).join(', ')}</li>}
          </ul>} />
      )}
      <Typography.Paragraph type="secondary">Produk yang ditandai wajib QC masuk gudang karantina saat produksi selesai atau barang diterima dari pemasok, dan tidak bisa dijual/dipakai sampai lolos inspeksi.</Typography.Paragraph>
      <Tabs destroyOnHidden items={[
        { key: 'inspeksi', label: 'Inspeksi', children: <Inspections /> },
        { key: 'rencana', label: 'Rencana QC', children: <Plans canEdit={can('PUT', '/qc/plans/:productId')} /> },
        ...(c ? [{ key: 'kontrol', label: 'Tingkat gagal', children: <FailRates c={c} /> }] : []),
      ]} />
    </>
  );
}

function Inspections() {
  const can = useCan();
  const [status, setStatus] = useState<string>();
  const list = useQuery({ queryKey: [...KEY, 'list', status], queryFn: () => get<Insp[]>(`/qc/inspections${status ? `?status=${status}` : ''}`) });
  const [sel, setSel] = useState<string | null>(null);
  const detail = useQuery({ queryKey: [...KEY, 'detail', sel], queryFn: () => get<Insp & { results: Result[]; attachments: Attachment[] }>(`/qc/inspections/${sel}`), enabled: !!sel });
  const [vals, setVals] = useState<Record<string, { value?: number; pass?: boolean }>>({});
  const [qtyPass, setQtyPass] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [scrap, setScrap] = useState(false);
  const [rework, setRework] = useState(false);
  const [rf] = Form.useForm<{ qty: number; reason: string }>();
  const [defects, setDefects] = useState<number | null>(null);
  const [sf] = Form.useForm<{ qty: number; reason: string }>();
  const d = detail.data;
  const decide = useAction(() => post(`/qc/inspections/${sel}/decide`, { results: (d?.results ?? []).map((r) => ({ resultId: r.id, value: vals[r.id]?.value, pass: vals[r.id]?.pass })), qtyPass: qtyPass ?? undefined, sampleDefects: d?.sampleSize != null ? defects ?? undefined : undefined, note: note || undefined }), { invalidate: KEY, success: 'Inspeksi diputuskan', onSuccess: () => { setSel(null); setVals({}); setQtyPass(null); setNote(''); setDefects(null); } });
  const doRework = useAction((v: { qty: number; reason: string }) => post<Insp>(`/qc/inspections/${sel}/rework`, v), { invalidate: KEY, success: 'Pengerjaan ulang dibuat; inspeksi baru menunggu', onSuccess: (r) => { setRework(false); if (r) setSel(r.id); } });
  const upload = useAction(async (v: { kind: 'PHOTO' | 'COA'; file: File }) => {
    const isPdf = v.file.type === 'application/pdf';
    const dataUrl = isPdf ? await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error('Gagal membaca berkas')); fr.readAsDataURL(v.file); }) : await compressImage(v.file);
    return post(`/qc/inspections/${sel}/attachments`, { kind: isPdf ? 'COA' : v.kind, filename: v.file.name.slice(0, 120), dataUrl });
  }, { invalidate: KEY, success: 'Lampiran ditambahkan' });
  const removeAtt = useAction((attId: string) => del(`/qc/inspections/${sel}/attachments/${attId}`), { invalidate: KEY, success: 'Lampiran dihapus' });
  const openAtt = async (a: Attachment) => { const r = await get<{ dataUrl: string }>(`/qc/inspections/${sel}/attachments/${a.id}`); const w = window.open(); if (w) { w.document.write(a.mime === 'application/pdf' ? `<iframe src="${r.dataUrl}" style="border:0;width:100%;height:100vh"></iframe>` : `<img src="${r.dataUrl}" style="max-width:100%">`); w.document.close(); } };
  const doScrap = useAction((v: { qty: number; reason: string }) => post(`/qc/inspections/${sel}/scrap`, v), { invalidate: KEY, success: 'Lot dibuang (dijurnal)', onSuccess: () => setScrap(false) });
  const remaining = d ? Number(d.qtyFail ?? 0) - Number(d.qtyScrapped) - Number(d.qtyReworked) : 0;
  const judgeLocal = (r: Result) => {
    const v = vals[r.id];
    if (!v) return null;
    if (r.kind === 'NUMERIC') return v.value == null ? null : (r.minValue == null || v.value >= Number(r.minValue)) && (r.maxValue == null || v.value <= Number(r.maxValue));
    return v.pass ?? null;
  };
  return (
    <>
      <Select allowClear placeholder="Semua status" value={status} onChange={setStatus} style={{ width: 200, marginBottom: 12 }} options={Object.entries(ST).map(([k, v]) => ({ value: k, label: v.label }))} />
      <Table<Insp> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 15 }} scroll={{ x: 760 }} locale={{ emptyText: 'Belum ada inspeksi' }}
        columns={[
          { title: 'Nomor', render: (_: unknown, i: Insp) => <div>{i.number}{i.attempt > 1 && <Tag color="purple" style={{ marginLeft: 6 }}>percobaan {i.attempt}</Tag>}<div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(i.createdAt)}{i.orderNumber ? ` · ${i.orderNumber}` : ''}{i.receiptNumber ? ` · terima ${i.receiptNumber}` : ''}</div></div> },
          { title: 'Produk', render: (_: unknown, i: Insp) => `${i.sku} · ${i.productName}` }, { title: 'Jumlah', render: (_: unknown, i: Insp) => Number(i.qty) },
          { title: 'Lolos / gagal', render: (_: unknown, i: Insp) => (i.qtyPass == null ? '-' : `${Number(i.qtyPass)} / ${Number(i.qtyFail)}${Number(i.qtyScrapped) ? ` (dibuang ${Number(i.qtyScrapped)})` : ''}`) },
          { title: 'Status', render: (_: unknown, i: Insp) => <Tag color={ST[i.status].color}>{ST[i.status].label}</Tag> },
          { render: (_: unknown, i: Insp) => <Button size="small" type={i.status === 'PENDING' ? 'primary' : 'default'} onClick={() => { setVals({}); setQtyPass(null); setNote(''); setDefects(null); setSel(i.id); }}>{i.status === 'PENDING' ? 'Inspeksi' : 'Lihat'}</Button> },
        ]} />
      <Modal open={!!sel} onCancel={() => setSel(null)} width={720} destroyOnHidden title={d ? `${d.number} · ${d.productName}` : 'Inspeksi'}
        footer={d?.status === 'PENDING' && can('POST', '/qc/inspections/:id/decide') ? [<Button key="x" onClick={() => setSel(null)}>Tutup</Button>, <Button key="ok" type="primary" loading={decide.isPending} onClick={() => decide.mutate(undefined)}>Putuskan</Button>] : [<Button key="x" onClick={() => setSel(null)}>Tutup</Button>, ...(['FAILED', 'PARTIAL'].includes(d?.status ?? '') && remaining > 0 && d!.attempt < 3 && can('POST', '/qc/inspections/:id/rework') ? [<Button key="r" onClick={() => { rf.setFieldsValue({ qty: remaining, reason: '' }); setRework(true); }}>Kerjakan ulang ({remaining})</Button>] : []), ...(['FAILED', 'PARTIAL'].includes(d?.status ?? '') && remaining > 0 && can('POST', '/qc/inspections/:id/scrap') ? [<Button key="s" danger onClick={() => { sf.setFieldsValue({ qty: remaining, reason: '' }); setScrap(true); }}>Buang lot gagal ({remaining})</Button>] : [])]}>
        {d && (
          <>
            <Descriptions size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Jumlah">{Number(d.qty)}</Descriptions.Item><Descriptions.Item label="Harga pokok / unit">{fmtMoney(d.unitCost)}</Descriptions.Item>
              <Descriptions.Item label="Karantina">{d.warehouseName}</Descriptions.Item><Descriptions.Item label="Tujuan bila lolos">{d.releaseWarehouseName}</Descriptions.Item>
              <Descriptions.Item label="Sumber">{d.sourceType === 'RECEIPT' ? `Penerimaan ${d.receiptNumber ?? ''}` : d.orderNumber ? `Produksi ${d.orderNumber}` : 'Produksi'}</Descriptions.Item>
              {d.attempt > 1 && <Descriptions.Item label="Percobaan">{d.attempt} (lanjutan dari {d.parentNumber})</Descriptions.Item>}
              {d.lotNo && <Descriptions.Item label="Lot">{d.lotNo}</Descriptions.Item>}
              {d.sampleSize != null && <Descriptions.Item label="Sampel">{Number(d.sampleSize)} unit · cacat diterima ≤ {d.acceptDefects}{d.sampleDefects != null ? ` · ditemukan ${d.sampleDefects}` : ''}</Descriptions.Item>}
            </Descriptions>
            {d.results.length === 0 && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="Produk ini belum punya rencana QC (parameter)." />}
            <Table<Result> size="small" rowKey="id" pagination={false} dataSource={d.results}
              columns={[
                { title: 'Parameter', render: (_: unknown, r: Result) => <div>{r.name}{r.critical && <Tag color="red" style={{ marginLeft: 6 }}>kritis</Tag>}<div style={{ fontSize: 12, color: '#64748b' }}>{r.kind === 'NUMERIC' ? `batas ${r.minValue != null ? Number(r.minValue) : '–'} s/d ${r.maxValue != null ? Number(r.maxValue) : '–'} ${r.unit ?? ''}` : 'lulus / gagal'}</div></div> },
                { title: 'Hasil', render: (_: unknown, r: Result) => d.status !== 'PENDING' ? (r.kind === 'NUMERIC' ? Number(r.value) : '') : r.kind === 'NUMERIC' ? <InputNumber value={vals[r.id]?.value} onChange={(v) => setVals((x) => ({ ...x, [r.id]: { ...x[r.id], value: v ?? undefined } }))} style={{ width: 130 }} /> : <Radio.Group value={vals[r.id]?.pass} onChange={(e) => setVals((x) => ({ ...x, [r.id]: { pass: e.target.value } }))}><Radio value>Lulus</Radio><Radio value={false}>Gagal</Radio></Radio.Group> },
                { title: 'Penilaian', render: (_: unknown, r: Result) => { const ok = d.status === 'PENDING' ? judgeLocal(r) : r.passed; return ok == null ? '-' : ok ? <Tag color="green">Lolos</Tag> : <Tag color="red">Gagal</Tag>; } },
              ]} />
            {d.status === 'PENDING' ? (
              <Space direction="vertical" style={{ width: '100%', marginTop: 12 }}>
                {d.sampleSize != null && <InputNumber min={0} max={Number(d.sampleSize)} precision={0} value={defects} onChange={setDefects} style={{ width: 300 }} prefix="Cacat dalam sampel" placeholder={`dari ${Number(d.sampleSize)} unit sampel`} />}
                <InputNumber min={0} max={Number(d.qty)} value={qtyPass} onChange={setQtyPass} style={{ width: 260 }} prefix="Jumlah lolos" placeholder={`kosong = otomatis (maks ${Number(d.qty)})`} />
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} placeholder="Catatan (wajib bila tidak seluruhnya lolos)" />
                <Typography.Text type="secondary">Penilaian akhir dilakukan server. Parameter kritis gagal = seluruh lot gagal. Inspektur harus orang lain dari yang menyelesaikan produksi / menerima barang / mengerjakan ulang.</Typography.Text>
              </Space>
            ) : d.note && <Typography.Paragraph style={{ marginTop: 8 }}>Catatan: {d.note}</Typography.Paragraph>}
            <Card size="small" style={{ marginTop: 12 }} title="Lampiran (foto, sertifikat analisis)">
              {d.attachments.length === 0 && <Typography.Text type="secondary">Belum ada lampiran</Typography.Text>}
              {d.attachments.map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <Tag color={a.kind === 'COA' ? 'blue' : 'default'}>{a.kind === 'COA' ? 'Sertifikat' : 'Foto'}</Tag>
                  <a onClick={() => openAtt(a)}>{a.filename}</a><span style={{ color: '#64748b', fontSize: 12 }}>{a.uploadedBy}</span>
                  {d.status === 'PENDING' && can('DELETE', '/qc/inspections/:id/attachments/:attId') && <Button size="small" danger onClick={() => removeAtt.mutate(a.id)}>Hapus</Button>}
                </div>
              ))}
              {can('POST', '/qc/inspections/:id/attachments') && <div style={{ marginTop: 8 }}><input type="file" accept="image/*,application/pdf" disabled={upload.isPending} onChange={(e) => { const f = e.target.files?.[0]; if (f) { upload.mutate({ kind: 'PHOTO', file: f }); e.target.value = ''; } }} /><div style={{ fontSize: 12, color: '#64748b' }}>Gambar dikompres otomatis; PDF maksimal 800 KB; paling banyak 10 lampiran. Bukti terkunci setelah inspeksi diputuskan.</div></div>}
            </Card>
          </>
        )}
      </Modal>
      <Modal title="Kerjakan ulang lot gagal" open={rework} onCancel={() => setRework(false)} onOk={() => rf.submit()} confirmLoading={doRework.isPending} okText="Buat inspeksi ulang" destroyOnHidden>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Stok tetap di karantina. Setelah dikerjakan, lot diinspeksi ulang oleh orang lain (maksimal 3 percobaan). Biaya pengerjaan ulang belum dicatat sistem." />
        <Form form={rf} layout="vertical" onFinish={(v) => doRework.mutate(v)}>
          <Form.Item name="qty" label="Jumlah dikerjakan ulang" rules={[{ required: true }]}><InputNumber min={0.0001} max={remaining} style={{ width: 200 }} /></Form.Item>
          <Form.Item name="reason" label="Apa yang dikerjakan" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Buang lot gagal" open={scrap} onCancel={() => setScrap(false)} onOk={() => sf.submit()} confirmLoading={doScrap.isPending} okText="Buang" okButtonProps={{ danger: true }} destroyOnHidden>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Stok dikurangi dan dijurnal sebagai selisih persediaan; tercatat di jejak audit." />
        <Form form={sf} layout="vertical" onFinish={(v) => doScrap.mutate(v)}>
          <Form.Item name="qty" label="Jumlah dibuang" rules={[{ required: true }]}><InputNumber min={0.0001} max={remaining} style={{ width: 200 }} /></Form.Item>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function Plans({ canEdit }: { canEdit: boolean }) {
  const plans = useQuery({ queryKey: [...KEY, 'plans'], queryFn: () => get<Plan[]>('/qc/plans') });
  const products = useProducts();
  const [editing, setEditing] = useState<{ productId: string } | null>(null);
  const [f] = Form.useForm<{ productId: string; name: string; requireOnProduction: boolean; params: Param[]; samplePct?: number | null; sampleMin?: number | null; sampleMax?: number | null; acceptDefects?: number | null }>();
  const save = useAction((v: { productId: string; name: string; requireOnProduction: boolean; params: Param[]; samplePct?: number | null; sampleMin?: number | null; sampleMax?: number | null; acceptDefects?: number | null }) => put(`/qc/plans/${v.productId}`, { name: v.name, requireOnProduction: v.requireOnProduction, samplePct: v.samplePct ?? undefined, sampleMin: v.samplePct != null ? v.sampleMin ?? undefined : undefined, sampleMax: v.samplePct != null ? v.sampleMax ?? undefined : undefined, acceptDefects: v.samplePct != null ? v.acceptDefects ?? 0 : undefined, params: v.params.map((p) => ({ ...p, minValue: p.kind === 'NUMERIC' ? p.minValue ?? undefined : undefined, maxValue: p.kind === 'NUMERIC' ? p.maxValue ?? undefined : undefined })) }), { invalidate: KEY, success: 'Rencana QC disimpan', onSuccess: () => setEditing(null) });
  const kind = (i: number) => f.getFieldValue(['params', i, 'kind']);
  return (
    <>
      {canEdit && <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { f.resetFields(); f.setFieldsValue({ requireOnProduction: true, params: [{ kind: 'NUMERIC' }] }); setEditing({ productId: '' }); }}>Rencana QC baru</Button>}
      <Table<Plan> rowKey="id" size="small" loading={plans.isLoading} dataSource={plans.data} pagination={false} locale={{ emptyText: 'Belum ada rencana QC' }}
        columns={[
          { title: 'Produk', render: (_: unknown, p: Plan) => `${p.sku} · ${p.productName}` }, { title: 'Rencana', dataIndex: 'name' },
          { title: 'Parameter', render: (_: unknown, p: Plan) => p.params.map((x) => x.name).join(', ') }, { title: 'Sampling', render: (_: unknown, p: Plan) => (p.samplePct != null ? `${Number(p.samplePct)}% (min ${p.sampleMin ?? 1}${p.sampleMax ? `, maks ${p.sampleMax}` : ''}), cacat ≤ ${p.acceptDefects}` : 'Seluruh lot') }, { title: 'Wajib QC', render: (_: unknown, p: Plan) => (p.qcRequired ? <Tag color="blue">Ya (karantina)</Tag> : <Tag>Tidak</Tag>) },
          { render: (_: unknown, p: Plan) => canEdit && <Button size="small" onClick={() => { f.setFieldsValue({ productId: p.productId, name: p.name, requireOnProduction: p.qcRequired, samplePct: p.samplePct != null ? Number(p.samplePct) : undefined, sampleMin: p.sampleMin ?? undefined, sampleMax: p.sampleMax ?? undefined, acceptDefects: p.acceptDefects ?? undefined, params: p.params.map((x) => ({ ...x, minValue: x.minValue != null ? Number(x.minValue) : undefined, maxValue: x.maxValue != null ? Number(x.maxValue) : undefined })) }); setEditing({ productId: p.productId }); }}>Ubah</Button> },
        ]} />
      <Modal title="Rencana QC" open={!!editing} onCancel={() => setEditing(null)} onOk={() => f.submit()} confirmLoading={save.isPending} okText="Simpan" width={760} destroyOnHidden>
        <Form form={f} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="productId" label="Produk" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" disabled={!!editing?.productId} options={(products.data ?? []).filter((p) => p.isActive !== false).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} /></Form.Item>
          <Form.Item name="name" label="Nama rencana" rules={[{ required: true, min: 2 }]}><Input maxLength={100} /></Form.Item>
          <Form.Item name="requireOnProduction" label="Hasil produksi dan barang masuk wajib QC (masuk karantina dulu)" valuePropName="checked"><Switch /></Form.Item>
          <Card size="small" title="Sampling (opsional)" style={{ marginBottom: 12 }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>Kosongkan untuk memeriksa seluruh lot. Ukuran sampel dihitung server dari persen jumlah lot; jumlah cacat dalam sampel dinilai terhadap batas yang Anda tetapkan (bukan tabel AQL baku).</Typography.Paragraph>
            <Space wrap>
              <Form.Item name="samplePct" label="Persen sampel"><InputNumber min={0.1} max={100} style={{ width: 120 }} addonAfter="%" /></Form.Item>
              <Form.Item name="sampleMin" label="Sampel minimum"><InputNumber min={1} precision={0} style={{ width: 120 }} /></Form.Item>
              <Form.Item name="sampleMax" label="Sampel maksimum"><InputNumber min={1} precision={0} style={{ width: 120 }} /></Form.Item>
              <Form.Item name="acceptDefects" label="Cacat yang diterima"><InputNumber min={0} precision={0} style={{ width: 140 }} /></Form.Item>
            </Space>
          </Card>
          <Form.List name="params">
            {(fields, { add, remove }) => (
              <>
                {fields.map((fl, i) => (
                  <Space key={fl.key} align="baseline" wrap>
                    <Form.Item name={[fl.name, 'name']} rules={[{ required: true, min: 2 }]}><Input placeholder="Parameter" style={{ width: 180 }} /></Form.Item>
                    <Form.Item name={[fl.name, 'kind']}><Select style={{ width: 130 }} options={[{ value: 'NUMERIC', label: 'Angka' }, { value: 'PASSFAIL', label: 'Lulus/gagal' }]} /></Form.Item>
                    <Form.Item noStyle shouldUpdate>{() => kind(i) === 'NUMERIC' ? (<><Form.Item name={[fl.name, 'minValue']}><InputNumber placeholder="Min" style={{ width: 90 }} /></Form.Item><Form.Item name={[fl.name, 'maxValue']}><InputNumber placeholder="Maks" style={{ width: 90 }} /></Form.Item><Form.Item name={[fl.name, 'unit']}><Input placeholder="Satuan" style={{ width: 80 }} /></Form.Item></>) : null}</Form.Item>
                    <Form.Item name={[fl.name, 'critical']} valuePropName="checked"><Switch checkedChildren="kritis" unCheckedChildren="biasa" /></Form.Item>
                    <Button danger size="small" onClick={() => remove(fl.name)}>Hapus</Button>
                  </Space>
                ))}
                <Button onClick={() => add({ kind: 'NUMERIC' })}>Tambah parameter</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </>
  );
}

function FailRates({ c }: { c: Controls }) {
  return (
    <Card>
      <Table size="small" rowKey="product" pagination={false} dataSource={c.failRateByProduct} locale={{ emptyText: 'Belum ada lot yang gagal (90 hari)' }}
        columns={[{ title: 'Produk', dataIndex: 'product' }, { title: 'Inspeksi', dataIndex: 'inspections' }, { title: 'Unit gagal', render: (_: unknown, r: Controls['failRateByProduct'][number]) => Number(r.failed) }, { title: '% gagal', render: (_: unknown, r: Controls['failRateByProduct'][number]) => `${r.failPct}%` }]} />
    </Card>
  );
}

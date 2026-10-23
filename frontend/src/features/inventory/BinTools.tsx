/** Alat rak tahap 3-4: kontrol, label QR, pindah cepat (pindai), dan impor rak dari berkas */
import { CloudUploadOutlined, DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Empty, Input, InputNumber, Modal, Select, Space, Tag, Typography, Upload, type InputRef } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import ResponsiveTable from '@/components/ResponsiveTable';
import { readGrid } from '@/lib/bankParse';
import { fmtDate, fmtQty } from '@/lib/format';
import BinLabels from './BinLabels';
import { resolveBin } from './binQr';
import { ScanButton } from './CameraScanner';

const KEY = 'bins';

export interface ToolBin { id: string; code: string; zone: string | null; name: string | null; kind: string; isActive: boolean }
interface StockRow { binId: string; binCode: string; productId: string; sku: string; name: string; barcode: string | null; uom: string; lotId: string | null; lotNo: string | null; expiryDate: string | null; qty: string }
interface Finding { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; refs: string[] }

/* ---------- Kontrol ---------- */
export function ControlsTab({ wid }: { wid: string }) {
  const q = useQuery({ queryKey: [KEY, 'controls', wid], queryFn: () => get<Finding[]>(`/inventory/bins/controls${qs({ warehouseId: wid })}`), retry: false });
  if (q.isError) return <Alert type="info" showIcon message="Kontrol rak hanya untuk Admin, Keuangan, dan Akuntan." />;
  const items = q.data ?? [];
  if (!q.isLoading && !items.length) return <Alert type="success" showIcon message="Tidak ada temuan: rak tertata, tidak ada barang lama belum ditata, dan stok rak cocok dengan stok gudang." />;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {items.map((f) => (
        <Alert key={f.key} type={f.level} showIcon message={f.title} description={<><div>{f.detail}</div><ul style={{ margin: '6px 0 0 18px' }}>{f.refs.slice(0, 12).map((r) => <li key={r}>{r}</li>)}{f.refs.length > 12 && <li>… dan {f.refs.length - 12} lainnya</li>}</ul></>} />
      ))}
    </Space>
  );
}

/* ---------- Label ---------- */
export function LabelsTab({ bins, warehouse }: { bins: ToolBin[]; warehouse: { code: string; name: string } }) {
  const candidates = useMemo(() => bins.filter((b) => b.kind !== 'UNASSIGNED' && b.isActive), [bins]);
  const [sel, setSel] = useState<string[] | null>(null);
  const chosen = sel ?? candidates.map((b) => b.id);
  if (!candidates.length) return <Empty description="Belum ada rak. Tambah rak dulu di tab Daftar rak." />;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Select mode="multiple" allowClear style={{ width: '100%' }} placeholder="Pilih rak (kosong = semua)" value={sel ?? []} onChange={(v) => setSel(v.length ? v : null)} optionFilterProp="label" maxTagCount="responsive"
        options={candidates.map((b) => ({ value: b.id, label: b.code }))} />
      <BinLabels bins={candidates.filter((b) => chosen.includes(b.id))} warehouseCode={warehouse.code} warehouseName={warehouse.name} />
    </Space>
  );
}

/* ---------- Pindah cepat ---------- */
export function QuickMoveTab({ wid, warehouse, bins }: { wid: string; warehouse: { code: string; name: string }; bins: ToolBin[] }) {
  const { message } = App.useApp();
  const [from, setFrom] = useState<ToolBin | null>(null);
  const [fromTxt, setFromTxt] = useState('');
  const [prodTxt, setProdTxt] = useState('');
  const [picked, setPicked] = useState<StockRow | null>(null);
  const [cands, setCands] = useState<StockRow[]>([]);
  const [qty, setQty] = useState<number>(1);
  const [toTxt, setToTxt] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const fromRef = useRef<InputRef>(null);
  const prodRef = useRef<InputRef>(null);
  const toRef = useRef<InputRef>(null);
  const rows = useQuery({ queryKey: [KEY, 'stock', wid, from?.id, 'quick'], queryFn: () => get<{ rows: StockRow[] }>(`/inventory/bins/stock${qs({ warehouseId: wid, binId: from?.id })}`), enabled: !!from });
  const move = useAction((v: { productId: string; lotId?: string; fromBinId: string; toBinId: string; qty: string }) => post('/inventory/bins/move', { warehouseId: wid, lines: [v] }), { invalidate: [KEY] });
  useEffect(() => { fromRef.current?.focus(); }, []);

  const err = (m: string) => message.error(m);
  const onFrom = (text: string) => {
    const r = resolveBin(text, warehouse.code, bins.filter((b) => b.isActive));
    if (!r.bin) return err(r.error!);
    setFrom(r.bin);
    setFromTxt(r.bin.code);
    setPicked(null);
    setCands([]);
    setProdTxt('');
    setTimeout(() => prodRef.current?.focus(), 50);
  };
  const onProduct = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const list = rows.data?.rows ?? [];
    const exact = list.filter((r) => r.sku.toLowerCase() === t.toLowerCase() || (r.barcode && r.barcode === t));
    const found = exact.length ? exact : list.filter((r) => r.sku.toLowerCase().includes(t.toLowerCase()) || r.name.toLowerCase().includes(t.toLowerCase()));
    if (!found.length) return err(`Barang "${t}" tidak ada di rak ${from?.code}`);
    const prods = new Set(found.map((r) => r.productId));
    if (prods.size > 1) return err(`"${t}" cocok dengan ${prods.size} barang; ketik kode atau pindai barcode yang lebih spesifik`);
    // lot paling cepat kedaluwarsa dulu (sama dengan urutan ambil sistem)
    const sorted = [...found].sort((a, b) => (a.lotId ? 0 : 1) - (b.lotId ? 0 : 1) || String(a.expiryDate ?? '9999').localeCompare(String(b.expiryDate ?? '9999')));
    setCands(sorted);
    setPicked(sorted[0]);
    setProdTxt(`${sorted[0].sku} · ${sorted[0].name}`);
    setQty(1);
    setTimeout(() => toRef.current?.focus(), 50);
  };
  const onTo = (text: string) => {
    if (!from || !picked) return err('Pindai rak asal dan barang dulu');
    const r = resolveBin(text, warehouse.code, bins.filter((b) => b.isActive));
    if (!r.bin) return err(r.error!);
    if (r.bin.id === from.id) return err('Rak tujuan sama dengan rak asal');
    if (qty <= 0 || qty > Number(picked.qty)) return err(`Jumlah harus 1 sampai ${fmtQty(picked.qty)}`);
    move.mutate({ productId: picked.productId, lotId: picked.lotId ?? undefined, fromBinId: from.id, toBinId: r.bin.id, qty: String(qty) }, {
      onSuccess: () => {
        setLog((l) => [`${picked.sku}${picked.lotNo ? ` (lot ${picked.lotNo})` : ''} × ${fmtQty(qty)}: ${from.code} → ${r.bin!.code}`, ...l].slice(0, 6));
        message.success('Dipindah');
        setPicked(null);
        setCands([]);
        setProdTxt('');
        setToTxt('');
        setTimeout(() => prodRef.current?.focus(), 50);
      },
    });
  };
  return (
    <Space direction="vertical" style={{ width: '100%', maxWidth: 560 }} size="middle">
      <Alert type="info" showIcon message="Pindai (atau ketik lalu Enter): rak asal → barang → rak tujuan. Alat pemindai USB/Bluetooth langsung bisa dipakai; di HP tekan ikon kamera." />
      <div>
        <Typography.Text strong>1. Rak asal</Typography.Text>
        <Space.Compact style={{ width: '100%', marginTop: 4 }}>
          <Input ref={fromRef} value={fromTxt} onChange={(e) => setFromTxt(e.target.value)} onPressEnter={() => onFrom(fromTxt)} placeholder="Pindai label rak asal" allowClear />
          <ScanButton title="Pindai rak asal" onScan={onFrom} />
        </Space.Compact>
        {from && <div style={{ marginTop: 4 }}><Tag color="blue">{from.code}</Tag><Typography.Text type="secondary">{rows.data?.rows.length ?? 0} baris isi rak</Typography.Text></div>}
      </div>
      <div>
        <Typography.Text strong>2. Barang</Typography.Text>
        <Space.Compact style={{ width: '100%', marginTop: 4 }}>
          <Input ref={prodRef} disabled={!from} value={prodTxt} onChange={(e) => { setProdTxt(e.target.value); setPicked(null); }} onPressEnter={() => onProduct(prodTxt)} placeholder="Pindai barcode / ketik kode barang" allowClear />
          <ScanButton title="Pindai barang" onScan={(t) => { setProdTxt(t); onProduct(t); }} />
        </Space.Compact>
        {picked && (
          <Space wrap style={{ marginTop: 6 }}>
            {cands.length > 1 && (
              <Select style={{ minWidth: 240 }} value={`${picked.lotId ?? ''}`} onChange={(v) => setPicked(cands.find((c) => `${c.lotId ?? ''}` === v) ?? picked)}
                options={cands.map((c) => ({ value: `${c.lotId ?? ''}`, label: `${c.lotNo ? `lot ${c.lotNo}` : 'tanpa lot'}${c.expiryDate ? ` · exp ${fmtDate(c.expiryDate)}` : ''} · ${fmtQty(c.qty)} ${c.uom}` }))} />
            )}
            <span>Jumlah</span>
            <InputNumber min={0.0001} max={Number(picked.qty)} value={qty} onChange={(v) => setQty(Number(v ?? 0))} onPressEnter={() => toRef.current?.focus()} />
            <Typography.Text type="secondary">dari {fmtQty(picked.qty)} {picked.uom}</Typography.Text>
            <Button size="small" onClick={() => setQty(Number(picked.qty))}>Semua</Button>
          </Space>
        )}
      </div>
      <div>
        <Typography.Text strong>3. Rak tujuan</Typography.Text>
        <Space.Compact style={{ width: '100%', marginTop: 4 }}>
          <Input ref={toRef} disabled={!picked} value={toTxt} onChange={(e) => setToTxt(e.target.value)} onPressEnter={() => onTo(toTxt)} placeholder="Pindai label rak tujuan (langsung memindahkan)" allowClear />
          <ScanButton title="Pindai rak tujuan" onScan={(t) => { setToTxt(t); onTo(t); }} />
        </Space.Compact>
      </div>
      {log.length > 0 && (
        <div>
          <Typography.Text type="secondary">Baru dipindah</Typography.Text>
          <ul style={{ margin: '4px 0 0 18px' }}>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
    </Space>
  );
}

/* ---------- Impor rak ---------- */
interface ImpRow { code: string; zone?: string; kind?: string; name?: string }
interface ImpRes { dryRun: boolean; summary: { total: number; create: number; skip: number; errors: number }; results: { row: number; code: string; action: 'CREATE' | 'SKIP' | 'ERROR'; errors: string[]; warnings: string[] }[] }

const HEADS: Record<keyof ImpRow, RegExp> = { code: /^(kode|kode rak|rak|code|bin)$/, zone: /^(zona|zone|area)$/, kind: /^(jenis|tipe|type|kind)$/, name: /^(nama|keterangan|name|deskripsi)$/ };
const clean = (v: unknown) => String(v ?? '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

export async function parseBinFile(file: File): Promise<ImpRow[]> {
  const grid = await readGrid(file);
  const h = grid.findIndex((r, i) => i < 10 && r.some((c) => HEADS.code.test(clean(c))));
  if (h < 0) throw new Error('Baris judul tidak ditemukan: butuh kolom "Kode" (atau "Kode rak"). Unduh templat untuk contoh.');
  const idx = (k: keyof ImpRow) => grid[h].findIndex((c) => HEADS[k].test(clean(c)));
  const [ci, zi, ki, ni] = [idx('code'), idx('zone'), idx('kind'), idx('name')];
  return grid.slice(h + 1).map((r) => ({ code: String(r[ci] ?? '').trim(), zone: zi >= 0 ? String(r[zi] ?? '').trim() : undefined, kind: ki >= 0 ? String(r[ki] ?? '').trim() : undefined, name: ni >= 0 ? String(r[ni] ?? '').trim() : undefined })).filter((r) => r.code);
}

function downloadBinTemplate() {
  const csv = 'Kode,Zona,Jenis,Nama\nA-01-01,A,Simpan,\nA-01-02,A,Simpan,\nRSK-1,,Rusak,Rak barang rusak\n';
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'templat-impor-rak.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ImportBinsModal({ open, wid, onClose }: { open: boolean; wid: string; onClose: () => void }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<ImpRow[]>([]);
  const [res, setRes] = useState<ImpRes | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setRows([]); setRes(null); } }, [open]);
  const save = useAction(() => post<ImpRes>('/inventory/bins/import', { warehouseId: wid, rows }), { success: (r) => `${r.summary.create} rak diimpor`, invalidate: [KEY], onSuccess: onClose });
  const onFile = async (f: File) => {
    setBusy(true);
    try {
      const parsed = await parseBinFile(f);
      if (!parsed.length) throw new Error('Tidak ada baris data');
      if (parsed.length > 2000) throw new Error('Maksimal 2.000 baris per impor');
      setRows(parsed);
      setRes(await post<ImpRes>('/inventory/bins/import', { warehouseId: wid, rows: parsed, dryRun: true }));
    } catch (e) {
      message.error((e as Error).message || 'Berkas tidak bisa dibaca');
    } finally {
      setBusy(false);
    }
    return false;
  };
  return (
    <Modal open={open} onCancel={onClose} title="Impor rak dari berkas" width={680} destroyOnHidden
      footer={[<Button key="x" onClick={onClose}>Batal</Button>, <Button key="ok" type="primary" disabled={!res || res.summary.errors > 0 || res.summary.create === 0} loading={save.isPending} onClick={() => save.mutate(undefined)}>Impor {res?.summary.create ?? 0} rak</Button>]}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button icon={<DownloadOutlined />} onClick={downloadBinTemplate}>Unduh templat (CSV)</Button>
        <Upload.Dragger accept=".xlsx,.xls,.csv" multiple={false} showUploadList={false} beforeUpload={onFile} disabled={busy}>
          <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
          <p>Tarik berkas .xlsx / .csv ke sini, atau klik untuk memilih</p>
          <p style={{ color: '#667085' }}>Kolom: Kode (wajib), Zona, Jenis (Simpan/Penyiapan/Rusak/Karantina), Nama</p>
        </Upload.Dragger>
        {res && (
          <>
            <Space wrap>
              <Tag color="green">Baru {res.summary.create}</Tag>
              <Tag>Sudah ada (dilewati) {res.summary.skip}</Tag>
              <Tag color={res.summary.errors ? 'red' : undefined}>Bermasalah {res.summary.errors}</Tag>
            </Space>
            {res.summary.errors > 0 && <Alert type="error" showIcon message="Perbaiki baris yang bermasalah lalu unggah ulang; tidak ada rak yang disimpan sebelum semuanya benar." />}
            <ResponsiveTable<ImpRes['results'][number]>
              rowKey="row" size="small" pagination={{ pageSize: 8, hideOnSinglePage: true }} mobileTitle={1}
              dataSource={[...res.results].sort((a, b) => Number(b.action === 'ERROR') - Number(a.action === 'ERROR'))}
              columns={[
                { title: 'Baris', dataIndex: 'row', width: 60 },
                { title: 'Kode', dataIndex: 'code' },
                { title: 'Hasil', dataIndex: 'action', render: (a: string) => <Tag color={a === 'CREATE' ? 'green' : a === 'ERROR' ? 'red' : undefined}>{a === 'CREATE' ? 'Baru' : a === 'ERROR' ? 'Bermasalah' : 'Dilewati'}</Tag> },
                { title: 'Catatan', render: (_: unknown, r) => [...r.errors, ...r.warnings].join('; ') },
              ]}
            />
          </>
        )}
      </Space>
    </Modal>
  );
}

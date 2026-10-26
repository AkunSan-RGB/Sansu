import { Alert, Button, Modal, Progress, Space, Table, Tag, Typography, Upload } from 'antd';
import { useState } from 'react';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';

interface Row { code?: string; name: string; phone?: string; email?: string; address: string; tariff: string; meterNo?: string; initialReading?: string; installedAt?: string; zone?: string; route?: string }
interface Res { dryRun: boolean; total: number; created: number; skipped: number; errors: number; results: { row: number; status: 'BARU' | 'DILEWATI' | 'GALAT'; message?: string; connection?: string }[] }

const CHUNK = 300;
/** Nama kolom yang dikenali (bahasa Indonesia atau Inggris, huruf besar/kecil dan spasi diabaikan) */
const ALIAS: Record<string, keyof Row> = {
  code: 'code', kode: 'code', kodepelanggan: 'code', idpelanggan: 'code', name: 'name', nama: 'name', namapelanggan: 'name', phone: 'phone', telepon: 'phone', hp: 'phone', nohp: 'phone', email: 'email',
  address: 'address', alamat: 'address', tariff: 'tariff', tarif: 'tariff', golongan: 'tariff', golongantarif: 'tariff', meterno: 'meterNo', nomormeter: 'meterNo', nometer: 'meterNo', meter: 'meterNo',
  initialreading: 'initialReading', angkameter: 'initialReading', standmeter: 'initialReading', angkaawal: 'initialReading', installedat: 'installedAt', tanggalpasang: 'installedAt', tglpasang: 'installedAt',
  zone: 'zone', zona: 'zone', route: 'route', rute: 'route', koderute: 'route',
};
const TEMPLATE = 'kode,nama,telepon,email,alamat,golongan,nomor meter,angka meter,tanggal pasang,zona,rute\nPLG-0001,Budi Santoso,081234567890,,"Jl. Mawar No. 1, Sleman",Air rumah tangga,MTR-0001,0,2024-01-15,Zona A,R-01\n';

async function parseFile(file: File): Promise<Row[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  return raw.map((r) => {
    const out: Partial<Row> = {};
    for (const [k, v] of Object.entries(r)) {
      const key = ALIAS[k.toLowerCase().replace(/[^a-z]/g, '')];
      if (key) out[key] = String(v ?? '').trim();
    }
    return out as Row;
  }).filter((r) => r.name || r.address);
}

/** Impor pelanggan + sambungan dari Excel/CSV: diperiksa penuh dulu (pratinjau), baru disimpan bertahap; baris bermasalah dilaporkan tanpa menahan yang lain */
export function ImportConnections({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Res | null>(null);
  const [final, setFinal] = useState<Res | null>(null);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => { setRows(null); setPreview(null); setFinal(null); setPct(0); setErr(null); setFileName(''); };
  const send = async (dryRun: boolean): Promise<Res> => {
    const all: Res = { dryRun, total: 0, created: 0, skipped: 0, errors: 0, results: [] };
    const list = rows ?? [];
    for (let i = 0; i < list.length; i += CHUNK) {
      const r = await post<Res>('/utility/import/connections', { rows: list.slice(i, i + CHUNK), dryRun });
      all.total += r.total; all.created += r.created; all.skipped += r.skipped; all.errors += r.errors;
      all.results.push(...r.results.map((x) => ({ ...x, row: x.row + i })));
      setPct(Math.round((Math.min(i + CHUNK, list.length) / list.length) * 100));
    }
    return all;
  };
  const check = useAction(() => send(true), { onSuccess: (r) => { setPreview(r as Res); setPct(0); } });
  const save = useAction(() => send(false), { success: 'Impor selesai', invalidate: ['utility', 'customers'], onSuccess: (r) => { setFinal(r as Res); setPct(100); } });

  const onFile = async (f: File) => {
    reset();
    try { const r = await parseFile(f); if (!r.length) throw new Error('Tidak ada baris data. Pastikan baris pertama berisi nama kolom.'); setRows(r); setFileName(f.name); } catch (e) { setErr((e as Error).message); }
    return false;
  };
  const result = final ?? preview;
  const busy = check.isPending || save.isPending;
  return (
    <Modal open={open} width={760} title="Impor pelanggan dan sambungan dari Excel/CSV" footer={null} onCancel={() => { if (!busy) { reset(); onClose(); } }} destroyOnHidden>
      <Typography.Paragraph>
        Untuk memindahkan data pelanggan lama. Kolom: <b>nama, alamat, golongan</b> (sama dengan di Tarif air) wajib; nomor meter wajib untuk golongan bermeter. Kolom lain (kode, telepon, email, angka meter, tanggal pasang, zona, kode rute) boleh kosong.
        Pelanggan dengan kode yang sudah ada tidak dibuat ulang; meter atau alamat yang sudah terdaftar dilewati, jadi aman diulang.
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 12 }}>
        <Button onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' })); a.download = 'template-impor-pelanggan.csv'; a.click(); }}>Unduh contoh berkas</Button>
        <Upload accept=".csv,.xlsx,.xls" showUploadList={false} beforeUpload={onFile} disabled={busy}><Button type="primary" disabled={busy}>Pilih berkas</Button></Upload>
        {fileName && <Tag>{fileName} · {rows?.length.toLocaleString('id-ID')} baris</Tag>}
      </Space>
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      {rows && !final && (
        <Space style={{ marginBottom: 12 }}>
          <Button loading={check.isPending} disabled={save.isPending} onClick={() => check.mutate(undefined)}>1. Periksa dulu (tidak menyimpan)</Button>
          <Button type="primary" loading={save.isPending} disabled={!preview || check.isPending || preview.created === 0} onClick={() => save.mutate(undefined)}>2. Simpan {preview ? preview.created.toLocaleString('id-ID') : ''} baris yang lolos</Button>
        </Space>
      )}
      {busy && <Progress percent={pct} status="active" />}
      {result && (
        <>
          <Alert style={{ marginBottom: 12 }} type={result.errors ? 'warning' : 'success'} showIcon
            message={`${final ? 'Disimpan' : 'Hasil pemeriksaan'}: ${result.created.toLocaleString('id-ID')} baru · ${result.skipped.toLocaleString('id-ID')} dilewati · ${result.errors.toLocaleString('id-ID')} bermasalah dari ${result.total.toLocaleString('id-ID')} baris`}
            description={result.errors ? 'Perbaiki baris bermasalah di berkas lalu impor lagi; baris yang sudah masuk akan dilewati.' : undefined} />
          {result.results.length > 0 && (
            <Table size="small" rowKey={(r) => `${r.row}`} pagination={{ pageSize: 8 }} dataSource={result.results} columns={[
              { title: 'Baris', dataIndex: 'row', width: 70, render: (v: number) => v + 1 },
              { title: 'Status', width: 110, render: (_: unknown, r: Res['results'][number]) => <Tag color={r.status === 'GALAT' ? 'red' : r.status === 'DILEWATI' ? 'gold' : 'green'}>{r.status === 'GALAT' ? 'Bermasalah' : r.status === 'DILEWATI' ? 'Dilewati' : 'Baru'}</Tag> },
              { title: 'Keterangan', render: (_: unknown, r: Res['results'][number]) => r.message ?? r.connection ?? '' },
            ]} />
          )}
        </>
      )}
    </Modal>
  );
}

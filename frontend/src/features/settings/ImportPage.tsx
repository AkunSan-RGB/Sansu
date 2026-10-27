import { BRAND } from '@sansu/shared';
import { CheckCircleFilled, CloudUploadOutlined, DownloadOutlined, ExclamationCircleFilled, InboxOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Col, Input, Result, Row, Segmented, Select, Space, Statistic, Steps, Table, Tag, Typography, Upload } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, post } from '@/api/client';
import { useWarehouses } from '@/api/queries';
import PageHeader from '@/layout/PageHeader';
import { readGrid } from '@/lib/bankParse';
import { downloadTemplate, findHeaderRow, IMPORT_SPECS, type ImportKind, matchHeaders, SPEC_BY_KIND } from '@/lib/importSpec';

/** Batas baris per impor di server (ImportDto) */
const MAX_ROWS = 10000;

type RowResult = { row: number; key: string; action: 'CREATE' | 'UPDATE' | 'ERROR'; errors: string[]; warnings: string[] };
type ImportResponse = { dryRun: boolean; summary: { total: number; create: number; update: number; errors: number; warnings: number }; results: RowResult[] };
type Parsed = { fileName: string; rows: Record<string, unknown>[]; excelRows: number[]; matched: Record<string, number>; header: unknown[] };

const ACTION = {
  CREATE: { color: 'green', label: 'Baru' },
  UPDATE: { color: 'blue', label: 'Perbarui' },
  ERROR: { color: 'red', label: 'Bermasalah' },
};

export default function ImportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  /** Hanya jawaban pemeriksaan TERBARU yang dipakai (ganti tanggal/gudang cepat-cepat tidak menimpa hasil baru dengan yang lama) */
  const checkSeq = useRef(0);
  const [params, setParams] = useSearchParams();
  const kind = (params.get('kind') as ImportKind) || 'products';
  const spec = SPEC_BY_KIND[kind] ?? IMPORT_SPECS[0];
  const warehouses = useWarehouses();
  const [date, setDate] = useState(() => dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD'));
  const [warehouseId, setWarehouseId] = useState<string>();
  const [parsed, setParsed] = useState<Parsed>();
  const [preview, setPreview] = useState<ImportResponse>();
  const [done, setDone] = useState<ImportResponse>();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'error' | 'warn'>('all');

  // ganti jenis → mulai dari awal
  useEffect(() => {
    setParsed(undefined);
    setPreview(undefined);
    setDone(undefined);
    setFilter('all');
  }, [kind]);
  useEffect(() => {
    if (!warehouseId && warehouses.data?.[0]) setWarehouseId(warehouses.data[0].id);
  }, [warehouses.data, warehouseId]);

  const missing = parsed ? spec.columns.filter((c) => c.required && parsed.matched[c.key] === undefined) : [];
  const body = (dryRun: boolean, p: Parsed) => ({
    kind,
    rows: p.rows,
    dryRun,
    ...(spec.needsDate ? { date } : {}),
    ...(spec.needsWarehouse && warehouseId ? { warehouseId } : {}),
  });

  const check = async (p = parsed) => {
    if (!p || !p.rows.length) return;
    const seq = ++checkSeq.current;
    setBusy(true);
    setPreview(undefined);
    try {
      const r = await post<ImportResponse>('/imports', body(true, p));
      if (seq === checkSeq.current) setPreview(r);
    } catch (e) {
      if (seq === checkSeq.current) message.error(e instanceof ApiError ? e.message : 'Gagal memeriksa file');
    } finally {
      if (seq === checkSeq.current) setBusy(false);
    }
  };

  // tanggal / gudang berubah → periksa ulang
  useEffect(() => {
    if (parsed && !missing.length) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, warehouseId]);

  const onFile = async (file: File) => {
    try {
      const grid = await readGrid(file);
      const h = findHeaderRow(spec, grid);
      const header = grid[h] ?? [];
      const matched = matchHeaders(spec, header);
      const rows: Record<string, unknown>[] = [];
      const excelRows: number[] = [];
      grid.slice(h + 1).forEach((cells, i) => {
        const obj: Record<string, unknown> = {};
        let any = false;
        for (const [k, idx] of Object.entries(matched)) {
          const v = cells?.[idx];
          if (v !== null && v !== undefined && String(v).trim() !== '') any = true;
          obj[k] = v ?? null;
        }
        if (any) {
          rows.push(obj);
          excelRows.push(h + 2 + i);
        }
      });
      if (rows.length > MAX_ROWS) {
        message.error(`File berisi ${rows.length.toLocaleString('id-ID')} baris; batas satu kali impor ${MAX_ROWS.toLocaleString('id-ID')} baris. Pecah file menjadi beberapa bagian lalu impor satu per satu.`);
        return false;
      }
      const p = { fileName: file.name, rows, excelRows, matched, header };
      setParsed(p);
      setDone(undefined);
      if (!rows.length) message.warning('Tidak ada baris data yang terbaca di file ini');
      else if (spec.columns.every((c) => !c.required || matched[c.key] !== undefined)) await check(p);
    } catch {
      message.error('File tidak bisa dibaca. Simpan sebagai .xlsx atau .csv lalu coba lagi.');
    }
    return false;
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const r = await post<ImportResponse>('/imports', body(false, parsed!));
      setDone(r);
      await qc.invalidateQueries();
      message.success(`${r.summary.create + r.summary.update} baris berhasil diimpor`);
    } catch (e) {
      const data = e instanceof ApiError ? (e.data as ImportResponse | undefined) : undefined;
      if (data?.results) setPreview({ dryRun: true, summary: data.summary, results: data.results });
      message.error(e instanceof ApiError ? e.message : 'Impor gagal');
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => {
    const list = (preview?.results ?? []).map((r, i) => ({ ...r, excelRow: r.row === 0 ? 0 : (parsed?.excelRows[i] ?? r.row) }));
    if (filter === 'error') return list.filter((r) => r.errors.length);
    if (filter === 'warn') return list.filter((r) => r.warnings.length);
    return list;
  }, [preview, parsed, filter]);

  const idx = IMPORT_SPECS.findIndex((s) => s.kind === kind);
  const next = IMPORT_SPECS[idx + 1];
  const step = done ? 2 : parsed ? 1 : 0;

  return (
    <>
      <PageHeader title="Impor Data dari Excel" />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7}>
          <Card title="1. Pilih data" size="small">
            <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
              Pindah dari sistem lain? Ikuti urutan ini — data berikutnya membutuhkan data sebelumnya.
            </Typography.Paragraph>
            <Space direction="vertical" style={{ width: '100%' }}>
              {IMPORT_SPECS.map((s, i) => (
                <Card
                  key={s.kind}
                  size="small"
                  hoverable
                  onClick={() => setParams({ kind: s.kind })}
                  style={{ borderColor: s.kind === kind ? BRAND.colors.primary : undefined, background: s.kind === kind ? BRAND.colors.primarySoft : undefined }}
                >
                  <Space align="start">
                    <Tag color={s.kind === kind ? 'volcano' : 'default'}>{i + 1}</Tag>
                    <div>
                      <Typography.Text strong>{s.title}</Typography.Text>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{s.description}</div>
                    </div>
                  </Space>
                </Card>
              ))}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={17}>
          <Card>
            <Steps
              size="small"
              current={step}
              style={{ marginBottom: 20 }}
              items={[{ title: 'Unduh templat & isi' }, { title: 'Unggah & periksa' }, { title: 'Selesai' }]}
            />
            {done ? (
              <Result
                status="success"
                title={`${spec.title}: ${done.summary.create} baru, ${done.summary.update} diperbarui`}
                subTitle={spec.needsDate ? `Jurnal saldo awal dibuat per ${dayjs(date).format('D MMMM YYYY')} (lawan: Ekuitas Saldo Awal).` : undefined}
                extra={[
                  <Button key="see" onClick={() => navigate(spec.link)}>
                    {spec.linkLabel}
                  </Button>,
                  next && (
                    <Button key="next" type="primary" onClick={() => setParams({ kind: next.kind })}>
                      Lanjut: impor {next.title.toLowerCase()} →
                    </Button>
                  ),
                  !next && (
                    <Button key="health" type="primary" onClick={() => navigate('/health')}>
                      Cek kesehatan pembukuan →
                    </Button>
                  ),
                ]}
              />
            ) : (
              <>
                <Typography.Title level={5} style={{ marginTop: 0 }}>
                  Impor {spec.title.toLowerCase()}
                </Typography.Title>
                <Typography.Paragraph type="secondary">{spec.description}</Typography.Paragraph>
                <Space wrap style={{ marginBottom: 16 }}>
                  <Button icon={<DownloadOutlined />} onClick={() => downloadTemplate(spec)}>
                    Unduh templat Excel
                  </Button>
                  {spec.needsDate && (
                    <Space.Compact>
                      <Button disabled style={{ color: 'inherit', cursor: 'default' }}>
                        Tanggal saldo awal
                      </Button>
                      <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 170 }} />
                    </Space.Compact>
                  )}
                  {spec.needsWarehouse && (
                    <Select
                      value={warehouseId}
                      onChange={setWarehouseId}
                      style={{ minWidth: 200 }}
                      options={warehouses.data?.map((w) => ({ value: w.id, label: `Gudang ${w.code} · ${w.name}` }))}
                    />
                  )}
                </Space>
                {spec.needsDate && (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="Tanggal saldo awal biasanya hari terakhir sebelum mulai memakai SANSU (mis. 31 Desember bila mulai 1 Januari). Transaksi baru dicatat setelah tanggal ini."
                  />
                )}
                <Upload.Dragger accept=".xlsx,.xls,.csv" multiple={false} showUploadList={false} beforeUpload={(f) => onFile(f)} disabled={busy}>
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-text">{parsed ? `${parsed.fileName} — klik untuk ganti file` : 'Klik atau tarik file Excel / CSV ke sini'}</p>
                  <p className="ant-upload-hint">Templat SANSU, atau ekspor dari Accurate, Jurnal, dan Excel Anda sendiri — judul kolom dikenali otomatis.</p>
                </Upload.Dragger>

                {parsed && (
                  <div style={{ marginTop: 16 }}>
                    <Typography.Text type="secondary">Kolom yang dikenali: </Typography.Text>
                    <Space size={[4, 4]} wrap>
                      {spec.columns.map((c) => {
                        const at = parsed.matched[c.key];
                        return (
                          <Tag key={c.key} color={at !== undefined ? 'green' : c.required ? 'red' : 'default'} icon={at !== undefined ? <CheckCircleFilled /> : undefined}>
                            {c.label}
                            {at !== undefined && String(parsed.header[at] ?? '') !== c.key ? ` ← "${String(parsed.header[at])}"` : ''}
                          </Tag>
                        );
                      })}
                    </Space>
                    {missing.length > 0 && (
                      <Alert
                        type="error"
                        showIcon
                        style={{ marginTop: 12 }}
                        message={`Kolom wajib tidak ditemukan: ${missing.map((c) => c.label).join(', ')}`}
                        description="Ubah judul kolom di file Anda agar sama dengan templat (baris 1), lalu unggah lagi."
                      />
                    )}
                  </div>
                )}

                {preview && (
                  <div style={{ marginTop: 20 }}>
                    <Row gutter={12} style={{ marginBottom: 12 }}>
                      <Col xs={12} md={6}>
                        <Statistic title="Baris" value={preview.summary.total} />
                      </Col>
                      <Col xs={12} md={6}>
                        <Statistic title="Baru" value={preview.summary.create} valueStyle={{ color: '#16a34a' }} />
                      </Col>
                      <Col xs={12} md={6}>
                        <Statistic title="Diperbarui" value={preview.summary.update} valueStyle={{ color: '#111111' }} />
                      </Col>
                      <Col xs={12} md={6}>
                        <Statistic title="Bermasalah" value={preview.summary.errors} valueStyle={{ color: preview.summary.errors ? '#dc2626' : undefined }} />
                      </Col>
                    </Row>
                    {preview.summary.errors > 0 ? (
                      <Alert
                        type="error"
                        showIcon
                        icon={<ExclamationCircleFilled />}
                        style={{ marginBottom: 12 }}
                        message={`${preview.summary.errors} baris perlu diperbaiki di file Excel. Belum ada data yang disimpan.`}
                        description="Perbaiki baris yang ditandai merah, simpan file, lalu unggah lagi. Impor hanya berjalan bila semua baris benar — tidak ada data setengah masuk."
                      />
                    ) : (
                      <Alert
                        type={preview.summary.warnings > 0 ? 'warning' : 'success'}
                        showIcon
                        style={{ marginBottom: 12 }}
                        message={preview.summary.warnings > 0 ? `Siap diimpor, tetapi ${preview.summary.warnings} baris punya peringatan — baca dulu sebelum menyimpan.` : 'Semua baris siap diimpor.'}
                        action={preview.summary.warnings > 0 ? <Button size="small" onClick={() => setFilter('warn')}>Lihat peringatan</Button> : undefined}
                      />
                    )}
                    <Space style={{ marginBottom: 8 }} wrap>
                      <Segmented
                        value={filter}
                        onChange={(v) => setFilter(v as typeof filter)}
                        options={[
                          { value: 'all', label: 'Semua' },
                          { value: 'error', label: `Bermasalah (${preview.summary.errors})` },
                          { value: 'warn', label: `Peringatan (${preview.summary.warnings})` },
                        ]}
                      />
                    </Space>
                    <Table
                      size="small"
                      rowKey={(r) => `${r.excelRow}-${r.key}`}
                      dataSource={shown}
                      pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
                      scroll={{ x: 640 }}
                      columns={[
                        { title: 'Baris', dataIndex: 'excelRow', width: 70, render: (v: number) => (v === 0 ? '—' : v) },
                        { title: 'Data', dataIndex: 'key', width: 200, ellipsis: true },
                        { title: 'Status', dataIndex: 'action', width: 110, render: (a: RowResult['action']) => <Tag color={ACTION[a].color}>{ACTION[a].label}</Tag> },
                        {
                          title: 'Keterangan',
                          render: (_, r) => (
                            <>
                              {r.errors.map((m, i) => (
                                <div key={`e${i}`} style={{ color: '#dc2626' }}>
                                  {m}
                                </div>
                              ))}
                              {r.warnings.map((m, i) => (
                                <div key={`w${i}`} style={{ color: '#b45309' }}>
                                  {m}
                                </div>
                              ))}
                              {!r.errors.length && !r.warnings.length && <Typography.Text type="secondary">OK</Typography.Text>}
                            </>
                          ),
                        },
                      ]}
                    />
                    <Space style={{ marginTop: 16 }}>
                      <Button
                        type="primary"
                        size="large"
                        icon={<CloudUploadOutlined />}
                        loading={busy}
                        disabled={preview.summary.errors > 0 || preview.summary.create + preview.summary.update === 0}
                        onClick={() => {
                          if (!preview.summary.warnings) return void doImport();
                          const sample = (preview.results ?? []).flatMap((r) => r.warnings.map((w) => `${r.row === 0 ? 'Ringkasan' : `Baris ${parsed?.excelRows[preview.results.indexOf(r)] ?? r.row}`}: ${w}`)).slice(0, 5);
                          modal.confirm({
                            title: `Impor dengan ${preview.summary.warnings} peringatan?`,
                            width: 560,
                            content: (
                              <div>
                                <p>Data akan langsung masuk ke pembukuan. Pastikan peringatan berikut memang disengaja:</p>
                                <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
                                  {sample.map((t, i) => (
                                    <li key={i}>{t}</li>
                                  ))}
                                </ul>
                                {preview.summary.warnings > sample.length && <p style={{ marginTop: 8 }}>…dan {preview.summary.warnings - sample.length} peringatan lain (lihat tab Peringatan).</p>}
                              </div>
                            ),
                            okText: 'Ya, impor sekarang',
                            cancelText: 'Periksa lagi',
                            onOk: () => doImport(),
                          });
                        }}
                      >
                        Impor {preview.summary.create + preview.summary.update} baris
                      </Button>
                      <Button onClick={() => check()} disabled={busy}>
                        Periksa ulang
                      </Button>
                    </Space>
                  </div>
                )}
                {busy && !preview && <Alert style={{ marginTop: 16 }} type="info" message="Memeriksa setiap baris…" />}
              </>
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}

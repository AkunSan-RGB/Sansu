import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { canBookkeep, canViewFinancials } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Radio, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import type { AssetCategory, FixedAsset } from '@/api/types';
import ExportButtons from '@/components/ExportButtons';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { assetCountSheet, fixedAssetsSheet } from '@/lib/xlsx/reports';
import { useAuth } from '@/auth/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KEYS, VerifyTag, lifeText } from './shared';
import { AssetForm } from './AssetForm';
import { AssetDetail } from './AssetDetail';

export function AssetList() {
  const { me } = useAuth();
  const bookkeeper = canBookkeep(me?.role);
  const [asOf, setAsOf] = useState(today());
  const [adding, setAdding] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // tautan dari jurnal / buku besar: ?asset=ID langsung membuka rincian aset
  const [detail, setDetail] = useState<string | null>(params.get('asset'));
  const [status, setStatus] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [search, setSearch] = useState('');
  const assets = useQuery({ queryKey: ['assets', 'list', asOf], queryFn: () => get<FixedAsset[]>(`/assets?asOf=${asOf}`) });
  const cats = useQuery({ queryKey: ['assets', 'categories'], queryFn: () => get<AssetCategory[]>('/assets/categories') });
  const recon = useQuery({
    queryKey: ['assets', 'reconciliation', asOf],
    queryFn: () => get<{ mismatched: number; rows: { accountId: string; code: string; name: string; kind: 'COST' | 'ACCUMULATED'; register: string; ledger: string; diff: string }[] }>(`/assets/reconciliation?asOf=${asOf}`),
  });
  type Unregistered = { journalId: string; journalNumber: string; date: string; description: string; accountId: string; accountCode: string; accountName: string; remaining: string; categories: { method?: string; id: string; name: string }[] };
  const unreg = useQuery({ queryKey: ['assets', 'unregistered'], queryFn: () => get<Unregistered[]>('/assets/unregistered') });
  const [regRow, setRegRow] = useState<Unregistered | null>(null);
  const [regForm] = Form.useForm<{ name: string; categoryId?: string; usefulLifeMonths?: number; location?: string; totalUnits?: number; unitLabel?: string }>();
  const register = useAction(
    (v: { name: string; categoryId?: string; usefulLifeMonths?: number; location?: string; totalUnits?: number; unitLabel?: string }) =>
      post('/assets/from-journal', { journalId: regRow!.journalId, accountId: regRow!.accountId, ...v, totalUnits: v.totalUnits ? String(v.totalUnits) : undefined }),
    { success: 'Kartu aset dibuat dari jurnal (tanpa jurnal baru)', invalidate: KEYS, onSuccess: () => setRegRow(null) },
  );
  const controls = useQuery({
    queryKey: ['assets', 'controls'],
    queryFn: () => get<{ items: { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; assetIds: string[] }[]; setup?: { active: boolean; message: string; recommended: Record<string, unknown>; recommendedText: string } }>('/assets/controls'),
  });
  const policyEditor = ['OWNER', 'ADMIN'].includes(useAuth().me?.role ?? '');
  const applySetup = useAction(() => put('/approvals/policy', controls.data?.setup?.recommended ?? {}), { success: 'Rekomendasi diterapkan', invalidate: ['assets', 'approvals'] });
  const autoSetting = useQuery({ queryKey: ['assets', 'settings'], queryFn: () => get<{ autoDepreciation: boolean }>('/assets/settings') });
  const saveAuto = useAction((v: boolean) => put('/assets/settings', { autoDepreciation: v }), { success: 'Pengaturan disimpan', invalidate: ['assets'] });
  const mismatches = (recon.data?.rows ?? []).filter((r) => Math.abs(Number(r.diff)) >= 1);
  const rows = useMemo(() => (assets.data ?? []).filter((a) => status === 'ALL' || a.status === 'ACTIVE'), [assets.data, status]);
  const total = (k: 'cost' | 'accumulated' | 'bookValue') => rows.reduce((s, a) => s + Number(a[k] ?? 0), 0);
  const shownRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? rows.filter((a) => `${a.code} ${a.name} ${a.category.name} ${a.custodian ?? ''}`.toLowerCase().includes(term)) : rows;
  }, [rows, search]);
  const monthly = rows.filter((a) => a.status === 'ACTIVE').reduce((s, a) => s + Number(a.monthlyEstimate ?? 0), 0);
  return (
    <>
      {controls.data?.setup && !controls.data.setup.active && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Pengaman belum aktif"
          description={`${controls.data.setup.message} Rekomendasi: ${controls.data.setup.recommendedText}.`}
          action={policyEditor && (
            <Button size="small" type="primary" loading={applySetup.isPending} onClick={() => applySetup.mutate(undefined)}>
              Terapkan rekomendasi
            </Button>
          )}
        />
      )}
      {!!controls.data?.items.length && (
        <Card size="small" title="Kontrol aset tetap" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {controls.data.items.map((c) => (
              <Alert key={c.key} type={c.level} showIcon message={c.title} description={c.detail} />
            ))}
          </Space>
        </Card>
      )}
      {!!unreg.data?.length && (
        <Card size="small" title="Pembelian aset yang belum menjadi kartu aset" style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            Sudah tercatat di buku besar (mis. lewat Kas Keluar sebelum pendaftaran otomatis), tetapi belum ada kartu asetnya sehingga tidak disusutkan. Daftarkan di sini; tidak ada jurnal baru, jurnal asalnya tetap satu-satunya pencatatan.
          </Typography.Paragraph>
          <Table
            size="small"
            rowKey={(r) => `${r.journalId}-${r.accountId}`}
            pagination={false}
            dataSource={unreg.data}
            scroll={{ x: 700 }}
            columns={[
              { title: 'Jurnal', dataIndex: 'journalNumber' },
              { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
              { title: 'Keterangan', dataIndex: 'description' },
              { title: 'Akun', render: (_, r) => `${r.accountCode} · ${r.accountName}` },
              { title: 'Belum terdaftar', dataIndex: 'remaining', align: 'right', render: fmtMoney },
              {
                title: '',
                render: (_, r) => bookkeeper && (
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => {
                      regForm.setFieldsValue({ name: r.description.replace(/^\S+\/\d{4}\/\d{2}\/\d+\s*/, ''), categoryId: r.categories.length === 1 ? r.categories[0].id : undefined, usefulLifeMonths: undefined, location: undefined });
                      setRegRow(r);
                    }}
                  >
                    Daftarkan sebagai aset
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}
      <Modal title="Daftarkan sebagai aset tetap" open={!!regRow} onCancel={() => setRegRow(null)} onOk={() => regForm.submit()} confirmLoading={register.isPending} okText="Buat kartu aset">
        {regRow && (
          <Typography.Paragraph type="secondary">
            Dari jurnal {regRow.journalNumber} ({fmtDate(regRow.date)}), nilai {fmtMoney(regRow.remaining)}. Penyusutan dimulai pada bulan perolehan.
          </Typography.Paragraph>
        )}
        <Form form={regForm} layout="vertical" onFinish={(v) => register.mutate(v)}>
          <Form.Item name="name" label="Nama aset" rules={[{ required: true }]}>
            <Input maxLength={160} />
          </Form.Item>
          {(regRow?.categories.length ?? 0) > 1 && (
            <Form.Item name="categoryId" label="Kategori" rules={[{ required: true }]}>
              <Select options={regRow?.categories.map((c) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
          )}
          <Form.Item name="usefulLifeMonths" label="Masa manfaat (bulan)" extra="Kosong = ikut kategori">
            <InputNumber min={0} max={600} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => {
              const chosen = getFieldValue('categoryId') as string | undefined;
              const uop = (regRow?.categories ?? []).some((c) => c.method === 'UNITS_OF_PRODUCTION' && (!chosen || c.id === chosen) && ((regRow?.categories.length ?? 0) <= 1 || !!chosen));
              return uop ? (
                <Space align="start" style={{ width: '100%' }}>
                  <Form.Item name="totalUnits" label="Total unit (kapasitas)" rules={[{ required: true, message: 'Isi kapasitas total aset' }]}>
                    <InputNumber min={1} style={{ width: 200 }} />
                  </Form.Item>
                  <Form.Item name="unitLabel" label="Satuan">
                    <Input placeholder="km / jam" maxLength={20} style={{ width: 120 }} />
                  </Form.Item>
                </Space>
              ) : null;
            }}
          </Form.Item>
          <Form.Item name="location" label="Lokasi (opsional)">
            <Input maxLength={120} />
          </Form.Item>
        </Form>
      </Modal>
      {mismatches.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Daftar aset belum sama dengan buku besar"
          description={
            <>
              {mismatches.map((m) => (
                <div key={`${m.kind}${m.accountId}`}>
                  {m.code} {m.name} ({m.kind === 'COST' ? 'harga perolehan' : 'akumulasi penyusutan'}): daftar aset {fmtMoney(Number(m.register))}, buku besar {fmtMoney(Number(m.ledger))}, selisih{' '}
                  <b>{fmtMoney(Number(m.diff))}</b>
                </div>
              ))}
              <div style={{ marginTop: 6 }}>
                Selisih positif berarti ada nilai di buku besar yang belum menjadi kartu aset: pembelian tanpa kartu (lihat daftar di atas, bisa langsung didaftarkan) atau aset lama dari saldo awal.{' '}
                <a onClick={() => navigate('/settings/import?kind=assets')}>Impor aset lama dari Excel</a>
              </div>
            </>
          }
        />
      )}
      <SummaryCards
        items={[
          { label: 'Harga perolehan', value: fmtMoney(total('cost')) },
          { label: 'Akumulasi penyusutan', value: fmtMoney(total('accumulated')) },
          { label: 'Nilai buku', value: fmtMoney(total('bookValue')), tone: 'good' },
          { label: 'Penyusutan per bulan', value: fmtMoney(monthly), hint: 'perkiraan' },
        ]}
      />
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          {bookkeeper && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)} disabled={!cats.data?.length}>
              Aset baru
            </Button>
          )}
          {canViewFinancials(me?.role) && (
            <Button icon={<UploadOutlined />} onClick={() => navigate('/settings/import?kind=assets')} disabled={!cats.data?.length}>
              Impor aset lama dari Excel
            </Button>
          )}
          <Switch
            disabled={!bookkeeper}
            checked={autoSetting.data?.autoDepreciation ?? true}
            loading={saveAuto.isPending}
            onChange={(v) => saveAuto.mutate(v)}
            checkedChildren="Penyusutan otomatis"
            unCheckedChildren="Penyusutan manual"
          />
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today())} prefix="Per" style={{ width: 220 }} />
          <Input.Search allowClear placeholder="Cari kode / nama aset" style={{ width: 220 }} onChange={(e) => setSearch(e.target.value)} />
          <Radio.Group size="small" value={status} onChange={(e) => setStatus(e.target.value)} optionType="button" options={[{ value: 'ACTIVE', label: 'Aktif' }, { value: 'ALL', label: 'Semua' }]} />
          <ExportButtons
            filename={`daftar-aset-tetap-${asOf}`}
            title={`Daftar Aset Tetap per ${fmtDate(asOf)}`}
            sheets={() => fixedAssetsSheet(rows, asOf, me?.tenantName)}
          />
          <Tooltip title="Lembar kosong untuk dibawa berkeliling: isi kondisi tiap aset, lalu catat hasilnya di SANSU">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
              <Typography.Text type="secondary">Lembar pemeriksaan fisik:</Typography.Text>
              <ExportButtons
                filename={`pemeriksaan-fisik-aset-${asOf}`}
                title={`Daftar Pemeriksaan Fisik Aset per ${fmtDate(asOf)}`}
                sheets={() =>
                  assetCountSheet(
                    [...rows].filter((a) => a.status === 'ACTIVE').sort((a, b) => (a.location ?? '').localeCompare(b.location ?? '') || a.code.localeCompare(b.code)),
                    asOf,
                    me?.tenantName,
                  )
                }
              />
            </span>
          </Tooltip>
        </Space>
        <ResponsiveTable<FixedAsset>
          rowKey="id"
          loading={assets.isLoading}
          dataSource={shownRows}
          scroll={{ x: 1000 }}
          mobileTitle={1}
          onMobileClick={(a) => setDetail(a.id)}
          locale={{ emptyText: <Empty description={search ? 'Tidak ada aset yang cocok dengan pencarian' : 'Belum ada aset tetap. Klik "Aset baru" untuk mencatat yang pertama.'} /> }}
          onRow={(a) => ({ onClick: () => setDetail(a.id), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Kode', dataIndex: 'code', width: 100 },
            { title: 'Nama', dataIndex: 'name' },
            { title: 'Kategori', render: (_, a) => a.category.name },
            { title: 'Perolehan', dataIndex: 'acquisitionDate', render: fmtDate },
            { title: 'Harga perolehan', dataIndex: 'cost', align: 'right', render: fmtMoney },
            { title: 'Umur', dataIndex: 'usefulLifeMonths', render: lifeText },
            { title: 'Akumulasi', dataIndex: 'accumulated', align: 'right', render: fmtMoney },
            { title: 'Nilai buku', dataIndex: 'bookValue', align: 'right', render: (v) => <strong>{fmtMoney(v)}</strong> },
            { title: 'Penanggung jawab', dataIndex: 'custodian', render: (v) => v || <Typography.Text type="secondary">—</Typography.Text> },
            { title: 'Pemeriksaan fisik', render: (_, a) => <VerifyTag a={a} /> },
            { title: 'Status', dataIndex: 'status', render: (s) => (s === 'ACTIVE' ? <Tag color="green">Aktif</Tag> : <Tag>Dilepas</Tag>) },
          ]}
        />
      </Card>
      <Modal title="Aset tetap baru" open={adding} onCancel={() => setAdding(false)} footer={null} width={760} destroyOnHidden>
        <AssetForm categories={cats.data ?? []} onDone={() => setAdding(false)} />
      </Modal>
      <AssetDetail id={detail} onClose={() => setDetail(null)} />
    </>
  );
}

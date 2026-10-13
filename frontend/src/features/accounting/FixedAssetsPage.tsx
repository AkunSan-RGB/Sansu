import { PlayCircleOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { DEPRECIATION_METHOD_LABELS, type DepreciationMethod, FISCAL_ASSET_GROUP_INFO, type FiscalAssetGroup, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { get, patch, post } from '@/api/client';
import { LEDGER_KEYS, useAccounts, useAction } from '@/api/queries';
import type { AssetCategory, CompanySettings, FixedAsset } from '@/api/types';
import CashAccountSelect from '@/components/CashAccountSelect';
import ExportButtons from '@/components/ExportButtons';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { Amount } from './statements/format';
import { fixedAssetsSheet } from '@/lib/xlsx/reports';
import { useAuth } from '@/auth/AuthContext';
import { t } from '@/lib/terms';
import { useNavigate, useSearchParams } from 'react-router-dom';

const KEYS = ['assets', 'asset-runs', 'asset-roll', ...LEDGER_KEYS];
const groupOptions = Object.entries(FISCAL_ASSET_GROUP_INFO).map(([k, v]) => ({ value: k, label: v.label }));
const lifeText = (m: number) => (m ? (m % 12 ? `${m} bulan` : `${m / 12} tahun`) : '—');

function AssetForm({ categories, onDone }: { categories: AssetCategory[]; onDone: () => void }) {
  const [form] = Form.useForm();
  const funding = Form.useWatch('funding', form);
  const catId = Form.useWatch('categoryId', form);
  const cat = categories.find((c) => c.id === catId);
  const cost = Form.useWatch('cost', form) as number | undefined;
  const company = useQuery({ queryKey: ['company'], queryFn: () => get<CompanySettings>('/settings/company') });
  const threshold = company.data?.reporting?.capitalizationThreshold ?? 0;
  // Sama dengan aturan server: aset baru di bawah batas ditolak, kecuali tanah / aset lama / dipaksa
  const belowThreshold = threshold > 0 && !!cost && cost < threshold && funding !== 'EXISTING' && !!cat && cat.method !== 'NONE' && cat.fiscalGroup !== 'LAND';
  const create = useAction(
    (v: Record<string, unknown>) =>
      post<FixedAsset>('/assets', {
        ...v,
        cost: String(v.cost),
        residualValue: v.residualValue ? String(v.residualValue) : undefined,
        openingAccumulated: v.openingAccumulated ? String(v.openingAccumulated) : undefined,
        usefulLifeMonths: v.usefulLifeYears != null ? Math.round(Number(v.usefulLifeYears) * 12) : undefined,
        usefulLifeYears: undefined,
        depreciationStart: v.depreciationStart || undefined,
      }),
    { success: (a) => `Aset ${a.code} didaftarkan`, invalidate: KEYS, onSuccess: onDone },
  );
  return (
    <Form form={form} layout="vertical" initialValues={{ acquisitionDate: today(), funding: 'CASH' }} onFinish={(v) => create.mutate(v)} id="asset-form">
      <Row gutter={12}>
        <Col xs={24} md={16}>
          <Form.Item name="name" label="Nama aset" rules={[{ required: true }]}>
            <Input placeholder="Truk Colt Diesel B 9123 XY" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="code" label="Kode" extra="Kosong = otomatis">
            <Input placeholder="AT-0001" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="categoryId" label="Kategori" rules={[{ required: true }]}>
            <Select
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(id) => {
                const c = categories.find((x) => x.id === id);
                if (c) form.setFieldsValue({ usefulLifeYears: c.usefulLifeMonths / 12, method: c.method });
              }}
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item name="acquisitionDate" label="Tanggal perolehan" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item name="depreciationStart" label="Mulai disusutkan" extra="Kosong = bulan perolehan">
            <Input type="date" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="cost" label="Harga perolehan" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        </Col>
        <Col xs={12} md={8}>
          <Form.Item name="residualValue" label="Nilai sisa">
            <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        </Col>
        <Col xs={12} md={4}>
          <Form.Item name="usefulLifeYears" label="Umur (tahun)">
            <InputNumber min={0} max={50} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={4}>
          <Form.Item name="method" label="Metode">
            <Select options={toOptions(DEPRECIATION_METHOD_LABELS)} />
          </Form.Item>
        </Col>
      </Row>
      {cat && (
        <Typography.Paragraph type="secondary">
          Fiskal: {FISCAL_ASSET_GROUP_INFO[cat.fiscalGroup as FiscalAssetGroup]?.label} — dipakai otomatis di Rekonsiliasi Fiskal.
        </Typography.Paragraph>
      )}
      <Form.Item name="funding" label="Cara perolehan">
        <Radio.Group
          options={[
            { value: 'CASH', label: 'Dibayar dari kas / bank' },
            { value: 'PAYABLE', label: 'Utang (belum dibayar)' },
            { value: 'EXISTING', label: 'Aset lama (sudah ada di saldo awal)' },
          ]}
        />
      </Form.Item>
      {belowThreshold && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Harga perolehan di bawah batas kapitalisasi ${fmtMoney(threshold)}`}
          description={
            <>
              Pengeluaran sekecil ini lazimnya langsung dibebankan (catat lewat Tagihan Pembelian atau Jurnal). Jika tetap ingin menjadikannya aset:
              <Form.Item name="ignoreCapitalizationThreshold" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Tetap kapitalisasi sebagai aset tetap</Checkbox>
              </Form.Item>
            </>
          }
        />
      )}
      {funding === 'CASH' && (
        <Form.Item name="cashAccountId" label="Dibayar dari" rules={[{ required: true }]}>
          <CashAccountSelect />
        </Form.Item>
      )}
      {funding === 'EXISTING' && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Aset lama tidak membuat jurnal — harga perolehan & akumulasi penyusutannya dianggap sudah masuk lewat Saldo Awal."
          />
          <Form.Item name="openingAccumulated" label="Akumulasi penyusutan sampai sebelum mulai disusutkan di SANSU">
            <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
        </>
      )}
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="location" label="Lokasi / pemegang">
            <Input placeholder={t('Gudang Cikarang')} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="notes" label="Catatan">
            <Input />
          </Form.Item>
        </Col>
      </Row>
      <Button type="primary" htmlType="submit" loading={create.isPending} block>
        Simpan & posting
      </Button>
    </Form>
  );
}

function AssetDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [dispose, setDispose] = useState(false);
  const [form] = Form.useForm();
  const a = useQuery({ queryKey: ['assets', id], queryFn: () => get<FixedAsset>(`/assets/${id}`), enabled: !!id });
  const doDispose = useAction((v: { date: string; price: number; cashAccountId?: string }) => post(`/assets/${id}/dispose`, { ...v, price: String(v.price ?? 0) }), {
    success: 'Pelepasan aset diposting',
    invalidate: KEYS,
    onSuccess: () => setDispose(false),
  });
  const price = Form.useWatch('price', form);
  const d = a.data;
  return (
    <Drawer title={d ? `${d.code} · ${d.name}` : 'Aset'} open={!!id} onClose={onClose} width={720}>
      {d && (
        <>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Kategori">{d.category.name}</Descriptions.Item>
            <Descriptions.Item label="Status">{d.status === 'ACTIVE' ? <Tag color="green">Aktif</Tag> : <Tag>Dilepas {fmtDate(d.disposalDate)}</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Tanggal perolehan">{fmtDate(d.acquisitionDate)}</Descriptions.Item>
            <Descriptions.Item label="Mulai disusutkan">{fmtDate(d.depreciationStart)}</Descriptions.Item>
            <Descriptions.Item label="Harga perolehan">{fmtMoney(d.cost)}</Descriptions.Item>
            <Descriptions.Item label="Nilai sisa">{fmtMoney(d.residualValue)}</Descriptions.Item>
            <Descriptions.Item label="Umur manfaat">{lifeText(d.usefulLifeMonths)}</Descriptions.Item>
            <Descriptions.Item label="Metode">{DEPRECIATION_METHOD_LABELS[d.method as DepreciationMethod]}</Descriptions.Item>
            <Descriptions.Item label="Akumulasi">{fmtMoney(d.accumulated)}</Descriptions.Item>
            <Descriptions.Item label="Nilai buku">
              <strong>{fmtMoney(d.bookValue)}</strong>
            </Descriptions.Item>
            {d.location && <Descriptions.Item label="Lokasi">{d.location}</Descriptions.Item>}
            {d.disposalPrice && <Descriptions.Item label="Harga jual">{fmtMoney(d.disposalPrice)}</Descriptions.Item>}
          </Descriptions>
          {d.status === 'ACTIVE' && (
            <Button
              danger
              style={{ marginBottom: 16 }}
              onClick={() => {
                form.setFieldsValue({ date: today(), price: 0 });
                setDispose(true);
              }}
            >
              Jual / hapus aset
            </Button>
          )}
          <Typography.Title level={5}>Jadwal penyusutan</Typography.Title>
          <Table
            size="small"
            rowKey="period"
            pagination={{ pageSize: 12, hideOnSinglePage: true }}
            dataSource={d.schedule}
            columns={[
              { title: 'Periode', dataIndex: 'period' },
              { title: 'Penyusutan', dataIndex: 'amount', align: 'right', render: fmtMoney },
              { title: 'Akumulasi', dataIndex: 'accumulated', align: 'right', render: fmtMoney },
              { title: 'Nilai buku', dataIndex: 'bookValue', align: 'right', render: fmtMoney },
              { title: '', dataIndex: 'posted', render: (p) => (p ? <Tag color="green">Diposting</Tag> : <Tag>Rencana</Tag>) },
            ]}
          />
          <Modal title="Jual / hapus aset" open={dispose} onCancel={() => setDispose(false)} onOk={() => form.submit()} confirmLoading={doDispose.isPending} okText="Posting">
            <Typography.Paragraph type="secondary">
              Penyusutan dikejar sampai bulan sebelum pelepasan, lalu aset & akumulasinya dikeluarkan. Selisih dengan harga jual dicatat sebagai laba / rugi pelepasan aset.
            </Typography.Paragraph>
            <Form form={form} layout="vertical" onFinish={(v) => doDispose.mutate(v)}>
              <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
              <Form.Item name="price" label="Harga jual (0 bila rusak / hilang)">
                <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
              </Form.Item>
              {Number(price) > 0 && (
                <Form.Item name="cashAccountId" label="Diterima di" rules={[{ required: true }]}>
                  <CashAccountSelect />
                </Form.Item>
              )}
            </Form>
          </Modal>
        </>
      )}
    </Drawer>
  );
}

function AssetList() {
  const { me } = useAuth();
  const [asOf, setAsOf] = useState(today());
  const [adding, setAdding] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // tautan dari jurnal / buku besar: ?asset=ID langsung membuka rincian aset
  const [detail, setDetail] = useState<string | null>(params.get('asset'));
  const [status, setStatus] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const assets = useQuery({ queryKey: ['assets', 'list', asOf], queryFn: () => get<FixedAsset[]>(`/assets?asOf=${asOf}`) });
  const cats = useQuery({ queryKey: ['assets', 'categories'], queryFn: () => get<AssetCategory[]>('/assets/categories') });
  const recon = useQuery({
    queryKey: ['assets', 'reconciliation', asOf],
    queryFn: () => get<{ mismatched: number; rows: { accountId: string; code: string; name: string; kind: 'COST' | 'ACCUMULATED'; register: string; ledger: string; diff: string }[] }>(`/assets/reconciliation?asOf=${asOf}`),
  });
  const mismatches = (recon.data?.rows ?? []).filter((r) => Math.abs(Number(r.diff)) >= 1);
  const rows = useMemo(() => (assets.data ?? []).filter((a) => status === 'ALL' || a.status === 'ACTIVE'), [assets.data, status]);
  const total = (k: 'cost' | 'accumulated' | 'bookValue') => rows.reduce((s, a) => s + Number(a[k] ?? 0), 0);
  const monthly = rows.filter((a) => a.status === 'ACTIVE').reduce((s, a) => s + Number(a.monthlyEstimate ?? 0), 0);
  return (
    <>
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
                Selisih positif biasanya berarti ada aset lama yang saldonya sudah masuk lewat saldo awal tetapi belum dirinci di daftar ini.{' '}
                <a onClick={() => navigate('/settings/import?kind=assets')}>Impor aset lama dari Excel</a>
              </div>
            </>
          }
        />
      )}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {[
          ['Harga perolehan', total('cost')],
          ['Akumulasi penyusutan', total('accumulated')],
          ['Nilai buku', total('bookValue')],
          ['Penyusutan per bulan (perkiraan)', monthly],
        ].map(([t, v]) => (
          <Col xs={12} md={6} key={t}>
            <Card size="small">
              <Statistic title={t} value={Number(v)} formatter={(x) => fmtMoney(Number(x))} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)} disabled={!cats.data?.length}>
            Aset baru
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => navigate('/settings/import?kind=assets')} disabled={!cats.data?.length}>
            Impor aset lama dari Excel
          </Button>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today())} prefix="Per" style={{ width: 220 }} />
          <Radio.Group size="small" value={status} onChange={(e) => setStatus(e.target.value)} optionType="button" options={[{ value: 'ACTIVE', label: 'Aktif' }, { value: 'ALL', label: 'Semua' }]} />
          <ExportButtons
            filename={`daftar-aset-tetap-${asOf}`}
            title={`Daftar Aset Tetap per ${fmtDate(asOf)}`}
            sheets={() => fixedAssetsSheet(rows, asOf, me?.tenantName)}
          />
        </Space>
        <Table
          rowKey="id"
          loading={assets.isLoading}
          dataSource={rows}
          scroll={{ x: 1000 }}
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

function DepreciationTab() {
  const [period, setPeriod] = useState(dayjs().subtract(dayjs().date() < 25 ? 1 : 0, 'month').format('YYYY-MM'));
  const [year, setYear] = useState(dayjs().year());
  const runs = useQuery({ queryKey: ['asset-runs'], queryFn: () => get<{ period: string; total: string; n: number; number: string }[]>('/assets/depreciation/runs') });
  const roll = useQuery({
    queryKey: ['asset-roll', year],
    queryFn: () =>
      get<
        {
          category: string;
          cost: Record<'opening' | 'additions' | 'disposals' | 'closing', string>;
          accumulated: Record<'opening' | 'additions' | 'disposals' | 'closing', string>;
          bookValue: { opening: string; closing: string };
        }[]
      >(`/assets/reports/roll-forward?year=${year}`),
  });
  const run = useAction(() => post<{ journals: { period: string; number: string; amount: string; assets: number }[] }>('/assets/depreciation/run', { period }), {
    success: (r) => (r.journals.length ? `${r.journals.length} jurnal penyusutan diposting (${r.journals.map((j) => j.period).join(', ')})` : 'Semua sudah disusutkan sampai periode ini'),
    invalidate: KEYS,
  });
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={10}>
        <Card title="Posting penyusutan">
          <Typography.Paragraph type="secondary">
            Satu klik menyusutkan semua aset sampai periode yang dipilih. Bulan yang terlewat ikut dikejar otomatis — satu jurnal per bulan, tanggal akhir bulan.
          </Typography.Paragraph>
          <Space wrap>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 180 }} />
            <Button type="primary" icon={<PlayCircleOutlined />} loading={run.isPending} onClick={() => run.mutate(undefined)}>
              Susutkan sampai {period}
            </Button>
          </Space>
          <Table
            style={{ marginTop: 16 }}
            size="small"
            rowKey="period"
            loading={runs.isLoading}
            dataSource={runs.data}
            pagination={{ pageSize: 12, hideOnSinglePage: true }}
            columns={[
              { title: 'Periode', dataIndex: 'period' },
              { title: 'Jurnal', dataIndex: 'number' },
              { title: 'Aset', dataIndex: 'n' },
              { title: 'Jumlah', dataIndex: 'total', align: 'right', render: fmtMoney },
            ]}
          />
        </Card>
      </Col>
      <Col xs={24}>
        <Card
          title="Mutasi aset tetap (bahan CALK)"
          extra={<InputNumber value={year} onChange={(v) => v && setYear(v)} min={2000} max={2100} style={{ width: 100 }} />}
        >
          <Table
            size="small"
            rowKey="category"
            pagination={false}
            bordered
            scroll={{ x: 1250 }}
            dataSource={roll.data}
            columns={[
              { title: 'Kategori', dataIndex: 'category', fixed: 'left', width: 170 },
              {
                title: 'Harga perolehan',
                children: (['opening', 'additions', 'disposals', 'closing'] as const).map((k) => ({
                  title: { opening: 'Awal', additions: 'Tambah', disposals: 'Kurang', closing: 'Akhir' }[k],
                  align: 'right' as const,
                  width: 120,
                  render: (_: unknown, r: { cost: Record<string, string> }) => <Amount v={r.cost[k]} />,
                })),
              },
              {
                title: 'Akumulasi penyusutan',
                children: (['opening', 'additions', 'disposals', 'closing'] as const).map((k) => ({
                  title: { opening: 'Awal', additions: 'Tambah', disposals: 'Kurang', closing: 'Akhir' }[k],
                  align: 'right' as const,
                  width: 120,
                  render: (_: unknown, r: { accumulated: Record<string, string> }) => <Amount v={r.accumulated[k]} />,
                })),
              },
              { title: 'Nilai buku akhir', align: 'right', width: 140, render: (_, r) => <Amount v={r.bookValue.closing} strong /> },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}

function CategoriesTab() {
  const [editing, setEditing] = useState<AssetCategory | 'new' | null>(null);
  const [form] = Form.useForm();
  const accounts = useAccounts();
  const cats = useQuery({ queryKey: ['assets', 'categories'], queryFn: () => get<AssetCategory[]>('/assets/categories') });
  const opts = (filter: (g: string | null | undefined, type: string) => boolean) =>
    accounts.data?.filter((a) => a.isPostable && filter(a.reportGroup, a.type)).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const save = useAction(
    (v: Record<string, unknown>) => {
      const body = { ...v, usefulLifeMonths: Math.round(Number(v.usefulLifeYears ?? 0) * 12), usefulLifeYears: undefined };
      return editing === 'new' ? post('/assets/categories', body) : patch(`/assets/categories/${(editing as AssetCategory).id}`, body);
    },
    { success: 'Kategori disimpan', invalidate: ['assets'], onSuccess: () => setEditing(null) },
  );
  return (
    <Card>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        style={{ marginBottom: 12 }}
        onClick={() => {
          form.resetFields();
          form.setFieldsValue({ method: 'STRAIGHT_LINE', usefulLifeYears: 4, fiscalGroup: 'GROUP_1', fiscalMethod: 'STRAIGHT_LINE' });
          setEditing('new');
        }}
      >
        Kategori baru
      </Button>
      <Table
        rowKey="id"
        size="small"
        loading={cats.isLoading}
        dataSource={cats.data}
        scroll={{ x: 900 }}
        pagination={false}
        columns={[
          { title: 'Kategori', dataIndex: 'name' },
          { title: 'Metode', dataIndex: 'method', render: (m: DepreciationMethod) => DEPRECIATION_METHOD_LABELS[m] },
          { title: 'Umur', dataIndex: 'usefulLifeMonths', render: lifeText },
          { title: 'Akun aset', render: (_, c) => c.assetAccount && `${c.assetAccount.code} · ${c.assetAccount.name}` },
          { title: 'Akun beban', render: (_, c) => c.expenseAccount && `${c.expenseAccount.code} · ${c.expenseAccount.name}` },
          { title: 'Fiskal', dataIndex: 'fiscalGroup', render: (g: FiscalAssetGroup) => FISCAL_ASSET_GROUP_INFO[g]?.label },
          {
            render: (_, c) => (
              <Button
                size="small"
                onClick={() => {
                  form.setFieldsValue({ ...c, usefulLifeYears: c.usefulLifeMonths / 12 });
                  setEditing(c);
                }}
              >
                Ubah
              </Button>
            ),
          },
        ]}
      />
      <Modal title={editing === 'new' ? 'Kategori baru' : 'Ubah kategori'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending} width={640} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="method" label="Metode komersial">
                <Select options={toOptions(DEPRECIATION_METHOD_LABELS)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="usefulLifeYears" label="Umur manfaat (tahun)">
                <InputNumber min={0} max={50} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="assetAccountId" label="Akun aset" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={opts((g) => g === 'FIXED_ASSET' || g === 'INTANGIBLE_ASSET')} />
          </Form.Item>
          <Form.Item name="accumulatedAccountId" label="Akun akumulasi penyusutan">
            <Select allowClear showSearch optionFilterProp="label" options={opts((g) => g === 'ACCUMULATED_DEPRECIATION' || g === 'ACCUMULATED_AMORTIZATION')} />
          </Form.Item>
          <Form.Item name="expenseAccountId" label="Akun beban penyusutan">
            <Select allowClear showSearch optionFilterProp="label" options={opts((_, t) => t === 'EXPENSE')} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="fiscalGroup" label="Kelompok harta fiskal (Pasal 11 UU PPh)">
                <Select options={groupOptions} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="fiscalMethod" label="Metode fiskal">
                <Select
                  options={[
                    { value: 'STRAIGHT_LINE', label: 'Garis lurus' },
                    { value: 'DECLINING_BALANCE', label: 'Saldo menurun' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Card>
  );
}

export default function FixedAssetsPage() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader title="Aset Tetap & Penyusutan" />
      <Tabs
        defaultActiveKey={params.get('tab') === 'depreciation' ? 'dep' : 'list'}
        items={[
          { key: 'list', label: 'Daftar aset', children: <AssetList /> },
          { key: 'dep', label: 'Penyusutan', children: <DepreciationTab /> },
          { key: 'cat', label: 'Kategori', children: <CategoriesTab /> },
        ]}
      />
    </>
  );
}

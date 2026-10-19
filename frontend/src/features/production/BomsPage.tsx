/** Resep / Bill of Materials: bahan per batch + biaya konversi standar → taksiran harga pokok */
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { Bom } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction, useProducts } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney, fmtQty } from '@/lib/format';
import { t } from '@/lib/terms';
import { BomOperationsEditor } from './OperationsPanels';

type FormV = {
  code?: string;
  name: string;
  productId: string;
  outputQty: number;
  laborCost?: number;
  overheadCost?: number;
  notes?: string;
  isActive?: boolean;
  lines: { productId?: string; qty?: number }[];
};

export default function BomsPage() {
  const can = useCan();
  const q = useQuery({ queryKey: ['boms'], queryFn: () => get<Bom[]>('/production/boms') });
  const [editing, setEditing] = useState<Bom | 'new' | null>(null);
  const [view, setView] = useState<'ALL' | 'ACTIVE' | 'OFF'>('ALL');
  const [search, setSearch] = useState('');
  const all = q.data ?? [];
  const active = all.filter((b) => b.isActive);
  const off = all.filter((b) => !b.isActive);
  const term = search.trim().toLowerCase();
  const shown = all.filter(
    (b) =>
      (view === 'ALL' || (view === 'ACTIVE' ? b.isActive : !b.isActive)) &&
      (!term || `${b.code} ${b.name} ${b.product.sku} ${b.product.name}`.toLowerCase().includes(term)),
  );
  return (
    <>
      <PageHeader
        title={t("Resep produksi (BOM)")}
        extra={
          can('POST', '/production/boms') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
              {t('Resep baru')}
            </Button>
          )
        }
      />
      {!q.isLoading && all.length > 0 && (
        <SummaryCards
          items={[
            { label: t('Jumlah resep'), value: String(all.length), hint: 'bahan per satu batch produksi', onClick: () => setView('ALL'), active: view === 'ALL' },
            { label: t('Resep aktif'), value: String(active.length), hint: 'bisa dipakai untuk produksi', tone: active.length ? 'good' : 'neutral', onClick: () => setView('ACTIVE'), active: view === 'ACTIVE' },
            { label: t('Resep nonaktif'), value: String(off.length), hint: 'tidak muncul saat membuat produksi', onClick: () => setView('OFF'), active: view === 'OFF' },
          ]}
        />
      )}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("Resep = bahan yang dibutuhkan untuk satu batch produksi")}
        description={t('Isi bahan per batch (termasuk susut normal) dan biaya konversi standar: upah langsung dan overhead pabrik (listrik, penyusutan mesin, dll.) per batch. Harga pokok produk jadi = bahan + upah + overhead (SAK EP Bab 13). Taksiran di bawah memakai harga rata-rata bahan saat ini.')}
      />
      <Card>
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <Segmented
              value={view}
              onChange={(v) => setView(v as typeof view)}
              options={[
                { value: 'ALL', label: `Semua (${all.length})` },
                { value: 'ACTIVE', label: `Aktif (${active.length})` },
                { value: 'OFF', label: `Nonaktif (${off.length})` },
              ]}
            />
          </div>
          <Input.Search allowClear placeholder={t("Cari resep atau produk")} style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
        </Space>
        <ResponsiveTable<Bom>
          rowKey="id"
          loading={q.isLoading}
          dataSource={shown}
          scroll={{ x: 1000 }}
          onRow={(r) => ({ onClick: () => setEditing(r), style: { cursor: 'pointer' } })}
          locale={{ emptyText: <Empty description={t(all.length ? 'Tidak ada resep yang cocok dengan pilihan ini' : 'Belum ada resep. Klik Resep baru untuk membuat yang pertama.')} /> }}
          expandable={{
            expandedRowRender: (b) => (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={b.lines}
                scroll={{ x: 480 }}
                columns={[
                  { title: 'Bahan', render: (_, l) => `${l.sku} · ${l.name}` },
                  { title: 'Per batch', align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.unit}` },
                  { title: 'Harga rata-rata', dataIndex: 'unitCost', align: 'right', render: fmtMoney },
                  { title: 'Nilai', align: 'right', render: (_, l) => fmtMoney(Number(l.qty) * Number(l.unitCost)) },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'Kode', dataIndex: 'code' },
            { title: 'Nama', dataIndex: 'name' },
            { title: t('Produk jadi'), render: (_, b) => `${b.product.sku} · ${b.product.name}` },
            { title: 'Hasil / batch', align: 'right', render: (_, b) => `${fmtQty(b.outputQty)} ${b.product.unit}` },
            { title: 'Bahan / batch', align: 'right', render: (_, b) => fmtMoney(b.estimate.material) },
            {
              title: 'Upah + overhead / batch',
              align: 'right',
              render: (_, b) => fmtMoney(Number(b.laborCost) + Number(b.overheadCost)),
            },
            { title: 'Taksiran HPP / unit', align: 'right', render: (_, b) => <b>{fmtMoney(b.estimate.unitCost)}</b> },
            {
              title: 'Status',
              dataIndex: 'isActive',
              render: (a: boolean) => (a ? <Tag color="green">Aktif</Tag> : <Tag>Nonaktif</Tag>),
            },
          ]}
        />
      </Card>
      {editing && <BomDrawer bom={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}


function BomDrawer({ bom, onClose }: { bom: Bom | null; onClose: () => void }) {
  const can = useCan();
  const canSave = bom ? can('PUT', '/production/boms/:id') : can('POST', '/production/boms');
  const [form] = Form.useForm<FormV>();
  const { data: products } = useProducts();
  const options = (products ?? [])
    .filter((p) => p.isActive !== false)
    .map((p) => ({ value: p.id, label: `${p.sku} · ${p.name} (${p.baseUom})` }));
  const save = useAction(
    (v: FormV) => {
      const body = {
        ...v,
        outputQty: String(v.outputQty),
        laborCost: String(v.laborCost ?? 0),
        overheadCost: String(v.overheadCost ?? 0),
        code: v.code || undefined,
        lines: v.lines.map((l) => ({ productId: l.productId, qty: String(l.qty) })),
      };
      return bom ? put<Bom>(`/production/boms/${bom.id}`, body) : post<Bom>('/production/boms', body);
    },
    {
      success: (b) => `${t('Resep')} ${b.code} disimpan · taksiran HPP ${fmtMoney(b.estimate.unitCost)}/unit`,
      invalidate: ['boms'],
      onSuccess: onClose,
    },
  );
  return (
    <Drawer
      open
      width={760}
      title={bom ? `${t('Resep')} ${bom.code}` : t('Resep baru')}
      onClose={onClose}
      extra={
        canSave && (
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            Simpan
          </Button>
        )
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => save.mutate(v)}
        initialValues={
          bom
            ? {
                ...bom,
                outputQty: Number(bom.outputQty),
                laborCost: Number(bom.laborCost),
                overheadCost: Number(bom.overheadCost),
                lines: bom.lines.map((l) => ({ productId: l.productId, qty: Number(l.qty) })),
              }
            : { outputQty: 1, laborCost: 0, overheadCost: 0, lines: [{}] }
        }
      >
        <Row gutter={12}>
          <Col xs={24} md={14}>
            <Form.Item name="productId" label={t('Produk jadi')} rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" options={options} />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name="name" label={t("Nama resep")} rules={[{ required: true, min: 2 }]}>
              <Input placeholder="Mis. Kemeja katun L" />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item
              name="outputQty"
              label="Hasil per batch"
              rules={[{ required: true }]}
              extra={t('Satuan dasar produk jadi')}
            >
              <InputNumber min={0.0001} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="laborCost" label="Upah langsung / batch">
              <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item
              name="overheadCost"
              label="Overhead pabrik / batch"
              tooltip="Listrik mesin, penyusutan mesin, bahan penolong, dll."
            >
              <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
            </Form.Item>
          </Col>
          {!bom && (
            <Col xs={12} md={8}>
              <Form.Item name="code" label="Kode" extra="Kosong = BOM-SKU">
                <Input />
              </Form.Item>
            </Col>
          )}
          {bom && (
            <Col xs={12} md={8}>
              <Form.Item name="isActive" label="Aktif" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          )}
        </Row>
        <Typography.Title level={5}>Bahan per batch</Typography.Title>
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Space key={f.key} align="baseline" style={{ display: 'flex' }}>
                  <Form.Item
                    name={[f.name, 'productId']}
                    rules={[{ required: true, message: 'Pilih bahan' }]}
                    style={{ width: 440 }}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="Bahan baku / bahan penolong"
                      options={options}
                    />
                  </Form.Item>
                  <Form.Item name={[f.name, 'qty']} rules={[{ required: true, message: 'Isi jumlah' }]}>
                    <InputNumber min={0.0001} placeholder="Jumlah" style={{ width: 140 }} />
                  </Form.Item>
                  {fields.length > 1 && (
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                  )}
                </Space>
              ))}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({})}>
                Tambah bahan
              </Button>
            </>
          )}
        </Form.List>
        <Form.Item name="notes" label="Catatan" style={{ marginTop: 16 }}>
          <Input.TextArea rows={2} placeholder="Langkah kerja, ukuran, standar mutu" />
        </Form.Item>
        {bom && <BomOperationsEditor bomId={bom.id} />}
        {bom && (
          <Typography.Paragraph type="secondary">
            Taksiran saat ini: bahan {fmtMoney(bom.estimate.material)} + upah & overhead{' '}
            {fmtMoney(Number(bom.laborCost) + Number(bom.overheadCost))} = {fmtMoney(bom.estimate.batchCost)} per batch
            → <b>{fmtMoney(bom.estimate.unitCost)}</b> per unit.
          </Typography.Paragraph>
        )}
      </Form>
    </Drawer>
  );
}

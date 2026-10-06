import {
  ArrowRightOutlined,
  CarOutlined,
  CheckOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  PrinterOutlined,
  RollbackOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAction, useProducts, useWarehouses } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import type { StockBalance } from '@/api/types';
import QueryState from '@/components/QueryState';
import { cell, DocHeader, head, PrintSheet, Signatures } from '@/components/print/Letterhead';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { printDoc } from '@/lib/print';

type TransferStatus = 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
const STATUS: Record<TransferStatus, { label: string; color: string }> = {
  IN_TRANSIT: { label: 'Dalam perjalanan', color: 'gold' },
  RECEIVED: { label: 'Diterima', color: 'green' },
  CANCELLED: { label: 'Dibatalkan', color: 'default' },
};

interface TransferRow {
  id: string;
  number: string;
  date: string;
  status: TransferStatus;
  receivedDate: string | null;
  fromWarehouseId: string;
  toWarehouseId: string;
  notes: string | null;
  totalValue: string;
  fromCode: string;
  fromName: string;
  toCode: string;
  toName: string;
  lines: number;
  createdBy: string | null;
}
interface TransferDetail {
  id: string;
  number: string;
  date: string;
  notes: string | null;
  totalValue: string;
  status: TransferStatus;
  receivedDate: string | null;
  receiveNotes: string | null;
  createdBy: string | null;
  receivedBy: string | null;
  from: { id: string; code: string; name: string; address: string | null };
  to: { id: string; code: string; name: string; address: string | null };
  lines: {
    productId: string;
    sku: string;
    name: string;
    baseUom: string;
    qty: string;
    unitCost: string;
    receivedQty: string | null;
  }[];
}
interface FormValues {
  mode: 'DIRECT' | 'IN_TRANSIT';
  fromWarehouseId: string;
  toWarehouseId: string;
  date: string;
  notes?: string;
  lines: { productId: string; qty: number }[];
}

const KEYS = ['transfers', 'stock', 'stock-moves', 'matrix', 'low-stock', 'dashboard', ...LEDGER_KEYS];

/** Transfer barang antar gudang + surat jalan transfer */
export default function TransfersPage() {
  const [params, setParams] = useSearchParams();
  const [warehouseId, setWarehouseId] = useState<string>();
  const [status, setStatus] = useState<'ALL' | TransferStatus>('ALL');
  const [open, setOpen] = useState(params.get('new') === '1');
  const detailId = params.get('id');
  const { data: warehouses } = useWarehouses();
  const list = useQuery({
    queryKey: ['transfers', warehouseId],
    queryFn: () => get<TransferRow[]>(`/inventory/transfers${qs({ warehouseId })}`),
  });
  const transit = (list.data ?? []).filter((r) => r.status === 'IN_TRANSIT').length;
  const rows = (list.data ?? []).filter((r) => status === 'ALL' || r.status === status);

  return (
    <>
      <PageHeader
        title="Transfer antar gudang"
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder="Semua gudang"
              style={{ width: 220 }}
              value={warehouseId}
              onChange={setWarehouseId}
              options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
            />
            <Button
              type="primary"
              icon={<SwapOutlined />}
              onClick={() => setOpen(true)}
              disabled={(warehouses?.length ?? 0) < 2}
            >
              Transfer baru
            </Button>
          </Space>
        }
      />
      {(warehouses?.length ?? 0) < 2 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Transfer butuh minimal dua gudang aktif. Tambahkan gudang di Inventori › Gudang."
        />
      )}
      {transit > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<CarOutlined />}
          style={{ marginBottom: 16 }}
          message={`${transit} kiriman masih dalam perjalanan`}
          description="Stoknya belum masuk ke gudang tujuan. Buka transfer lalu klik Terima barang setelah barang tiba dan dihitung."
          action={
            <Button size="small" onClick={() => setStatus('IN_TRANSIT')}>
              Lihat
            </Button>
          }
        />
      )}
      <Card>
        <Segmented
          style={{ marginBottom: 12 }}
          value={status}
          onChange={(v) => setStatus(v as typeof status)}
          options={[
            { value: 'ALL', label: 'Semua' },
            { value: 'IN_TRANSIT', label: `Dalam perjalanan${transit ? ` (${transit})` : ''}` },
            { value: 'RECEIVED', label: 'Diterima' },
            { value: 'CANCELLED', label: 'Dibatalkan' },
          ]}
        />
        <Table
          rowKey="id"
          loading={list.isLoading}
          dataSource={rows}
          scroll={{ x: 820 }}
          onRow={(r) => ({ onClick: () => setParams({ id: r.id }), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            {
              title: 'Dari → Ke',
              render: (_, r) => (
                <span>
                  {r.fromCode} <ArrowRightOutlined style={{ fontSize: 11, color: '#6b7280' }} /> {r.toCode}
                </span>
              ),
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: TransferStatus, r) => (
                <>
                  <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag>
                  {s === 'RECEIVED' && r.receivedDate && r.receivedDate !== r.date && (
                    <div style={{ fontSize: 11, color: '#6b7280' }}>tiba {fmtDate(r.receivedDate)}</div>
                  )}
                </>
              ),
            },
            { title: 'Item', dataIndex: 'lines', align: 'right' },
            { title: 'Nilai (HPP)', dataIndex: 'totalValue', align: 'right', render: fmtMoney },
            { title: 'Catatan', dataIndex: 'notes', ellipsis: true },
            { title: 'Oleh', dataIndex: 'createdBy' },
          ]}
        />
      </Card>
      <NewTransfer open={open} onClose={() => setOpen(false)} onDone={(id) => setParams({ id })} />
      <Drawer open={!!detailId} onClose={() => setParams({})} width={900} title="Transfer antar gudang" destroyOnHidden>
        {detailId && <TransferDoc id={detailId} />}
      </Drawer>
    </>
  );
}

function NewTransfer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [form] = Form.useForm<FormValues>();
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const from = Form.useWatch('fromWarehouseId', form);
  const mode = Form.useWatch('mode', form);
  const stock = useQuery({
    queryKey: ['stock', from],
    queryFn: () => get<StockBalance[]>(`/inventory/balances${qs({ warehouseId: from })}`),
    enabled: !!from,
  });
  const avail = useMemo(() => new Map((stock.data ?? []).map((s) => [s.productId, Number(s.qty)])), [stock.data]);
  const save = useAction(
    (v: FormValues) =>
      post<{ id: string; number: string }>('/inventory/transfers', {
        ...v,
        lines: v.lines.map((l) => ({ productId: l.productId, qty: String(l.qty) })),
      }),
    {
      success: (r) =>
        mode === 'IN_TRANSIT'
          ? `Kiriman ${r.number} tercatat — stok keluar, menunggu diterima gudang tujuan`
          : `Transfer ${r.number} berhasil — stok sudah pindah`,
      invalidate: KEYS,
      onSuccess: (r) => {
        form.resetFields();
        onClose();
        onDone(r.id);
      },
    },
  );
  const whOptions = warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  const prodOptions = (products ?? [])
    .filter((p) => !from || (avail.get(p.id) ?? 0) > 0)
    .map((p) => ({
      value: p.id,
      label: `${p.sku} · ${p.name}${from ? ` — stok ${fmtQty(avail.get(p.id) ?? 0)} ${p.baseUom}` : ''}`,
    }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={760}
      title="Transfer baru"
      destroyOnHidden
      extra={
        <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
          {mode === 'IN_TRANSIT' ? 'Simpan & kirim' : 'Simpan & pindahkan stok'}
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ date: today(), mode: 'DIRECT', lines: [{}] }}
        onFinish={(v) => save.mutate(v)}
      >
        <Space wrap align="start" style={{ width: '100%' }}>
          <Form.Item name="fromWarehouseId" label="Dari gudang" rules={[{ required: true }]} style={{ width: 260 }}>
            <Select options={whOptions} onChange={() => form.setFieldValue('lines', [{}])} />
          </Form.Item>
          <Form.Item
            name="toWarehouseId"
            label="Ke gudang"
            dependencies={['fromWarehouseId']}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator: (_, v) =>
                  v && v === getFieldValue('fromWarehouseId')
                    ? Promise.reject(new Error('Harus berbeda dari gudang asal'))
                    : Promise.resolve(),
              }),
            ]}
            style={{ width: 260 }}
          >
            <Select options={whOptions?.filter((o) => o.value !== from)} />
          </Form.Item>
          <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
        </Space>
        <Form.Item name="mode" label="Cara transfer">
          <Radio.Group>
            <Space direction="vertical">
              <Radio value="DIRECT">
                <strong>Langsung</strong> — stok langsung pindah (gudang berdekatan / dicatat setelah barang tiba)
              </Radio>
              <Radio value="IN_TRANSIT">
                <strong>Dikirim, diterima belakangan</strong> — stok keluar sekarang, masuk ke gudang tujuan setelah
                petugas di sana menerima & menghitung barang
              </Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="notes" label="Catatan (mis. nama sopir / kendaraan)">
          <Input maxLength={255} />
        </Form.Item>
        <Typography.Text strong>Barang yang dipindahkan</Typography.Text>
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Space key={f.key} align="baseline" style={{ display: 'flex', marginTop: 8 }}>
                  <Form.Item
                    name={[f.name, 'productId']}
                    rules={[{ required: true, message: 'Pilih produk' }]}
                    style={{ width: 460, marginBottom: 0 }}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder={from ? 'Pilih produk' : 'Pilih gudang asal dulu'}
                      disabled={!from}
                      options={prodOptions}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'qty']}
                    dependencies={[['lines', f.name, 'productId']]}
                    rules={[
                      { required: true, message: 'Isi jumlah' },
                      ({ getFieldValue }) => ({
                        validator: (_, v) => {
                          const pid = getFieldValue(['lines', f.name, 'productId']);
                          const max = avail.get(pid) ?? 0;
                          return v > max ? Promise.reject(new Error(`Maks. ${fmtQty(max)}`)) : Promise.resolve();
                        },
                      }),
                    ]}
                    style={{ width: 160, marginBottom: 0 }}
                  >
                    <InputNumber min={0.0001} style={{ width: '100%' }} placeholder="Jumlah" />
                  </Form.Item>
                  {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} />}
                </Space>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => add({})}
                style={{ marginTop: 12 }}
                disabled={!from}
              >
                Tambah barang
              </Button>
            </>
          )}
        </Form.List>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          Jumlah dalam satuan dasar produk. Nilai barang ikut pindah dengan HPP rata-rata gudang asal.{' '}
          {mode === 'IN_TRANSIT'
            ? 'Selama di perjalanan, nilainya dicatat di akun "Persediaan dalam Perjalanan"; kekurangan saat diterima dibebankan ke Selisih Persediaan.'
            : 'Tidak ada jurnal karena persediaan tetap milik perusahaan.'}
        </Typography.Paragraph>
      </Form>
    </Drawer>
  );
}

function TransferDoc({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['transfers', id], queryFn: () => get<TransferDetail>(`/inventory/transfers/${id}`) });
  const { me } = useAuth();
  const { modal } = App.useApp();
  const [receiving, setReceiving] = useState(false);
  const can = (whId: string) =>
    (me?.role === 'OWNER' || me?.role === 'ADMIN' || me?.role === 'WAREHOUSE') &&
    (!me?.warehouseIds?.length || me.warehouseIds.includes(whId));
  const cancel = useAction(() => post(`/inventory/transfers/${id}/cancel`, {}), {
    success: 'Kiriman dibatalkan — barang kembali ke gudang asal',
    invalidate: KEYS,
  });
  return (
    <QueryState q={q}>
      {(t) => (
        <>
          {t.status === 'IN_TRANSIT' && (
            <Alert
              className="no-print"
              type="warning"
              showIcon
              icon={<CarOutlined />}
              style={{ marginBottom: 16 }}
              message="Barang dalam perjalanan"
              description={`Stok sudah keluar dari ${t.from.name} dan akan masuk ke ${t.to.name} setelah diterima.`}
            />
          )}
          {t.status !== 'IN_TRANSIT' && t.receivedDate && t.status === 'RECEIVED' && t.receivedBy && (
            <Alert
              className="no-print"
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
              message={`Diterima ${fmtDate(t.receivedDate)} oleh ${t.receivedBy}${t.receiveNotes ? ` · ${t.receiveNotes}` : ''}`}
            />
          )}
          {t.status === 'CANCELLED' && (
            <Alert
              className="no-print"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`Dibatalkan ${fmtDate(t.receivedDate)} — barang kembali ke ${t.from.name}`}
            />
          )}
          <Space style={{ marginBottom: 16 }} className="no-print" wrap>
            <Button
              icon={<PrinterOutlined />}
              type={t.status === 'IN_TRANSIT' ? 'default' : 'primary'}
              onClick={() => printDoc(`Surat jalan transfer ${t.number}`)}
            >
              Cetak surat jalan
            </Button>
            {t.status === 'IN_TRANSIT' && can(t.to.id) && (
              <Button type="primary" icon={<CheckOutlined />} onClick={() => setReceiving(true)}>
                Terima barang
              </Button>
            )}
            {t.status === 'IN_TRANSIT' && can(t.from.id) && (
              <Button
                danger
                icon={<RollbackOutlined />}
                loading={cancel.isPending}
                onClick={() =>
                  modal.confirm({
                    title: `Batalkan kiriman ${t.number}?`,
                    content: `Semua barang dikembalikan ke stok ${t.from.name}. Gunakan bila kiriman batal berangkat atau dikembalikan utuh.`,
                    okText: 'Batalkan kiriman',
                    okButtonProps: { danger: true },
                    onOk: () => cancel.mutateAsync(undefined),
                  })
                }
              >
                Batalkan kiriman
              </Button>
            )}
          </Space>
          <ReceiveModal t={t} open={receiving} onClose={() => setReceiving(false)} />
          <PrintSheet>
            <DocHeader
              title="SURAT JALAN TRANSFER"
              meta={[
                ['Nomor', t.number],
                ['Tanggal', fmtDate(t.date)],
              ]}
            />
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13, marginBottom: 16 }}>
              {[
                ['Dari gudang', t.from],
                ['Ke gudang', t.to],
              ].map(([label, w]) => {
                const x = w as TransferDetail['from'];
                return (
                  <div key={label as string} style={{ flex: '1 1 240px' }}>
                    <div style={{ color: '#64748b' }}>{label as string}</div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {x.code} · {x.name}
                    </div>
                    {x.address && <div>{x.address}</div>}
                  </div>
                );
              })}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={head}>No</th>
                  <th style={head}>Kode</th>
                  <th style={head}>Nama barang</th>
                  <th style={{ ...head, textAlign: 'right' }}>Jumlah</th>
                  <th style={head}>Satuan</th>
                  <th style={{ ...head, textAlign: 'center' }}>Diterima</th>
                </tr>
              </thead>
              <tbody>
                {t.lines.map((l, i) => {
                  const got = t.status === 'RECEIVED' && l.receivedQty != null ? Number(l.receivedQty) : null;
                  return (
                    <tr key={l.productId}>
                      <td style={cell}>{i + 1}</td>
                      <td style={cell}>{l.sku}</td>
                      <td style={cell}>{l.name}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>{fmtQty(l.qty)}</td>
                      <td style={cell}>{l.baseUom}</td>
                      <td
                        style={{
                          ...cell,
                          width: 90,
                          textAlign: 'center',
                          color: got != null && got < Number(l.qty) ? '#dc2626' : undefined,
                          fontWeight: got != null && got < Number(l.qty) ? 700 : undefined,
                        }}
                      >
                        {got != null ? fmtQty(got) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {t.notes && <div style={{ marginTop: 12, fontSize: 13 }}>Catatan: {t.notes}</div>}
            <div className="no-print" style={{ marginTop: 12, fontSize: 13, color: '#64748b' }}>
              Nilai persediaan dipindahkan (HPP): {fmtMoney(t.totalValue)} · dibuat oleh {t.createdBy ?? '-'} ·{' '}
              {dayjs(t.date).format('DD MMM YYYY')}
            </div>
            <Signatures labels={[['Dikirim oleh'], ['Pengemudi'], ['Diterima oleh']]} />
          </PrintSheet>
        </>
      )}
    </QueryState>
  );
}

/** Penerimaan barang di gudang tujuan — isi jumlah yang benar-benar tiba */
function ReceiveModal({ t, open, onClose }: { t: TransferDetail; open: boolean; onClose: () => void }) {
  const [qty, setQty] = useState<Record<string, number | null>>({});
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const got = (l: TransferDetail['lines'][number]) => qty[l.productId] ?? Number(l.qty);
  const short = t.lines.filter((l) => got(l) < Number(l.qty));
  const shortValue = short.reduce((a, l) => a + (Number(l.qty) - got(l)) * Number(l.unitCost), 0);
  const receive = useAction(
    () =>
      post<{ shortageValue: string }>(`/inventory/transfers/${t.id}/receive`, {
        date,
        notes: notes || undefined,
        lines: t.lines.map((l) => ({ productId: l.productId, receivedQty: String(got(l)) })),
      }),
    {
      success: (r) =>
        Number(r.shortageValue) > 0
          ? `Barang diterima. Kekurangan ${fmtMoney(r.shortageValue)} dicatat sebagai selisih persediaan`
          : 'Barang diterima lengkap — stok gudang tujuan bertambah',
      invalidate: KEYS,
      onSuccess: onClose,
    },
  );
  return (
    <Modal
      title={`Terima barang ${t.number} di ${t.to.name}`}
      open={open}
      onCancel={onClose}
      width={720}
      okText={short.length ? 'Terima dengan kekurangan' : 'Terima semua'}
      okButtonProps={{ loading: receive.isPending }}
      onOk={() => receive.mutate(undefined)}
      destroyOnHidden
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <span>Tanggal terima</span>
        <Input type="date" value={date} min={t.date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
      </Space>
      <Table
        rowKey="productId"
        size="small"
        pagination={false}
        dataSource={t.lines}
        columns={[
          { title: 'Barang', render: (_, l) => `${l.sku} · ${l.name}` },
          { title: 'Dikirim', align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.baseUom}` },
          {
            title: 'Diterima',
            width: 150,
            render: (_, l) => (
              <InputNumber
                min={0}
                max={Number(l.qty)}
                value={got(l)}
                onChange={(v) => setQty((q) => ({ ...q, [l.productId]: v == null ? 0 : Number(v) }))}
                status={got(l) < Number(l.qty) ? 'warning' : undefined}
                style={{ width: '100%' }}
              />
            ),
          },
        ]}
      />
      {short.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message={`${short.length} barang kurang — nilai ${fmtMoney(Math.round(shortValue))}`}
          description="Kekurangan (rusak/hilang di jalan) dibukukan ke akun Selisih Persediaan. Isi catatan untuk keterangan."
        />
      )}
      <Input.TextArea
        rows={2}
        style={{ marginTop: 12 }}
        placeholder="Catatan penerimaan (opsional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={255}
      />
    </Modal>
  );
}

/**
 * Penurunan nilai persediaan ke nilai realisasi neto (NRV) — SAK EP Bab 13.
 * Daftar indikasi (harga jual < biaya rata-rata) → pilih barang → isi NRV per satuan → posting.
 * Pemulihan: bila harga naik lagi, nilai dipulihkan paling tinggi sebesar penurunan yang masih melekat.
 */
import { FallOutlined, PlusOutlined, RiseOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { get, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAction, useWarehouses } from '@/api/queries';
import type { InventoryWritedown, StockBalance, WritedownCandidate, WritedownRecoverable } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';

interface Line {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  avgCost: number;
  newCost: number | null;
  /** Pemulihan: batas atas per satuan (biaya sebelum diturunkan) */
  maxCost?: number;
}
type Kind = 'WRITEDOWN' | 'REVERSAL';

/** Perubahan nilai baris (selalu positif bila valid) */
const deltaOf = (l: Line, kind: Kind) => {
  if (l.newCost == null) return 0;
  const d = Math.round(l.qty * l.avgCost * 100) / 100 - Math.round(l.qty * l.newCost * 100) / 100;
  return kind === 'WRITEDOWN' ? d : -d;
};
const lineInvalid = (l: Line, kind: Kind) =>
  l.newCost == null ||
  l.newCost < 0 ||
  (kind === 'WRITEDOWN' ? l.newCost >= l.avgCost : l.newCost <= l.avgCost || l.newCost > (l.maxCost ?? 0) + 0.0001);

export default function WritedownsPage() {
  const { me } = useAuth();
  const canPost = me?.role === 'OWNER' || me?.role === 'ADMIN' || me?.role === 'FINANCE';
  const { data: warehouses } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<string>();
  const [pct, setPct] = useState<number>(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<{ kind: Kind; lines: Line[] } | null>(null);
  const [selectedUp, setSelectedUp] = useState<string[]>([]);

  const wh = warehouseId ?? warehouses?.[0]?.id;
  const candidates = useQuery({
    queryKey: ['writedowns', 'candidates', wh, pct],
    queryFn: () =>
      get<WritedownCandidate[]>(
        `/inventory/writedowns/candidates${qs({ warehouseId: wh, costToSellPct: pct ? String(pct) : undefined })}`,
      ),
    enabled: !!wh && canPost,
  });
  const recoverable = useQuery({
    queryKey: ['writedowns', 'recoverable', wh, pct],
    queryFn: () =>
      get<WritedownRecoverable[]>(
        `/inventory/writedowns/recoverable${qs({ warehouseId: wh, costToSellPct: pct ? String(pct) : undefined })}`,
      ),
    enabled: !!wh && canPost,
  });
  const history = useQuery({
    queryKey: ['writedowns'],
    queryFn: () => get<InventoryWritedown[]>('/inventory/writedowns'),
    enabled: canPost,
  });

  const start = (rows: WritedownCandidate[]) =>
    setDraft({
      kind: 'WRITEDOWN',
      lines: rows.map((r) => ({
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        qty: Number(r.qty),
        avgCost: Number(r.avgCost),
        newCost: Number(r.nrv),
      })),
    });
  const startUp = (rows: WritedownRecoverable[]) =>
    setDraft({
      kind: 'REVERSAL',
      lines: rows.map((r) => ({
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        qty: Number(r.qty),
        avgCost: Number(r.avgCost),
        maxCost: Number(r.maxCost),
        newCost: r.suggestedCost ? Number(r.suggestedCost) : null,
      })),
    });

  if (!canPost) {
    return (
      <>
        <PageHeader title="Penurunan nilai persediaan" />
        <Alert
          type="info"
          showIcon
          message="Hanya Pemilik, Admin, atau Keuangan yang bisa mencatat penurunan nilai persediaan."
        />
      </>
    );
  }

  const potential = (candidates.data ?? []).reduce((a, r) => a + Number(r.loss), 0);
  return (
    <>
      <PageHeader title="Penurunan nilai persediaan" />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Persediaan dicatat sebesar yang lebih rendah antara harga pokok dan nilai realisasi neto (SAK EP Bab 13)"
        description="Nilai realisasi neto = taksiran harga jual − taksiran biaya untuk menjual. Bila lebih rendah dari harga pokok rata-rata (barang rusak, usang, kedaluwarsa, atau harga pasar turun), turunkan nilainya di sini. Selisihnya dicatat sebagai Kerugian Penurunan Nilai Persediaan (bagian beban pokok penjualan). Lakukan minimal setiap tutup buku akhir tahun."
      />
      <Card
        title="Indikasi: harga jual di bawah harga pokok"
        extra={
          <Space wrap>
            <Select
              style={{ width: 200 }}
              value={wh}
              onChange={(v) => {
                setWarehouseId(v);
                setSelected([]);
              }}
              options={warehouses?.map((w) => ({ value: w.id, label: w.name }))}
            />
            <InputNumber
              min={0}
              max={90}
              value={pct}
              onChange={(v) => setPct(v ?? 0)}
              prefix="Biaya menjual"
              suffix="%"
              style={{ width: 200 }}
            />
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Table<WritedownCandidate>
          rowKey="productId"
          size="small"
          dataSource={candidates.data}
          loading={candidates.isLoading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          rowSelection={{ selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]) }}
          locale={{ emptyText: 'Tidak ada barang yang harga jualnya di bawah harga pokok' }}
          columns={[
            { title: 'Barang', render: (_, r) => `${r.sku} · ${r.name}` },
            { title: 'Stok', align: 'right', render: (_, r) => `${fmtQty(r.qty)} ${r.unit}` },
            { title: 'Harga pokok', dataIndex: 'avgCost', align: 'right', render: fmtMoney },
            { title: 'Harga jual', dataIndex: 'sellPrice', align: 'right', render: fmtMoney },
            { title: 'Nilai realisasi neto', dataIndex: 'nrv', align: 'right', render: fmtMoney },
            {
              title: 'Taksiran rugi',
              dataIndex: 'loss',
              align: 'right',
              render: (v: string) => <Typography.Text type="danger">{fmtMoney(v)}</Typography.Text>,
            },
          ]}
          summary={() =>
            candidates.data?.length ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={6}>
                  <b>Total taksiran rugi</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <b>{fmtMoney(potential)}</b>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
        <Space style={{ marginTop: 12 }} wrap>
          <Button
            type="primary"
            icon={<FallOutlined />}
            disabled={!selected.length}
            onClick={() => start((candidates.data ?? []).filter((r) => selected.includes(r.productId)))}
          >
            Turunkan nilai {selected.length ? `(${selected.length} barang)` : ''}
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setDraft({ kind: 'WRITEDOWN', lines: [] })}>
            Barang lain (rusak / kedaluwarsa)
          </Button>
        </Space>
      </Card>

      {!!recoverable.data?.length && (
        <Card title="Pemulihan nilai: barang yang pernah diturunkan nilainya" style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary">
            Bila harga jual naik lagi, nilai persediaan boleh dipulihkan — paling tinggi sampai harga pokok sebelum
            diturunkan (SAK EP 13.20). Pemulihan mengurangi beban penurunan nilai.
          </Typography.Paragraph>
          <Table<WritedownRecoverable>
            rowKey="productId"
            size="small"
            dataSource={recoverable.data}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            rowSelection={{ selectedRowKeys: selectedUp, onChange: (k) => setSelectedUp(k as string[]) }}
            columns={[
              { title: 'Barang', render: (_, r) => `${r.sku} · ${r.name}` },
              { title: 'Stok', align: 'right', render: (_, r) => `${fmtQty(r.qty)} ${r.unit}` },
              { title: 'Nilai buku', dataIndex: 'avgCost', align: 'right', render: fmtMoney },
              { title: 'Batas pemulihan', dataIndex: 'maxCost', align: 'right', render: fmtMoney },
              { title: 'Nilai realisasi neto', dataIndex: 'nrv', align: 'right', render: fmtMoney },
              {
                title: 'Taksiran pemulihan',
                dataIndex: 'gain',
                align: 'right',
                render: (v: string) =>
                  Number(v) > 0 ? <Typography.Text type="success">{fmtMoney(v)}</Typography.Text> : '–',
              },
            ]}
          />
          <Button
            style={{ marginTop: 12 }}
            icon={<RiseOutlined />}
            disabled={!selectedUp.length}
            onClick={() => startUp((recoverable.data ?? []).filter((r) => selectedUp.includes(r.productId)))}
          >
            Pulihkan nilai {selectedUp.length ? `(${selectedUp.length} barang)` : ''}
          </Button>
        </Card>
      )}

      <Card title="Riwayat penurunan & pemulihan nilai">
        <Table<InventoryWritedown>
          rowKey="id"
          size="small"
          dataSource={history.data}
          loading={history.isLoading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          expandable={{
            expandedRowRender: (r) => (
              <Table
                rowKey="productId"
                size="small"
                pagination={false}
                dataSource={r.lines}
                columns={[
                  { title: 'Barang', render: (_, l) => `${l.sku} · ${l.name}` },
                  { title: 'Qty', align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.unit}` },
                  { title: 'Harga pokok lama', dataIndex: 'oldCost', align: 'right', render: fmtMoney },
                  { title: 'Nilai baru', dataIndex: 'newCost', align: 'right', render: fmtMoney },
                  {
                    title: r.kind === 'REVERSAL' ? 'Pemulihan' : 'Penurunan',
                    dataIndex: 'amount',
                    align: 'right',
                    render: fmtMoney,
                  },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            {
              title: 'Jenis',
              dataIndex: 'kind',
              render: (k: Kind) =>
                k === 'REVERSAL' ? <Tag color="green">Pemulihan</Tag> : <Tag color="volcano">Penurunan</Tag>,
            },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: 'Gudang', dataIndex: 'warehouseName' },
            { title: 'Alasan', dataIndex: 'reason', ellipsis: true },
            { title: 'Barang', align: 'right', render: (_, r) => r.lines.length },
            { title: 'Nilai', dataIndex: 'total', align: 'right', render: fmtMoney },
            { title: 'Oleh', dataIndex: 'createdByName' },
          ]}
        />
      </Card>

      {draft && wh && (
        <WritedownModal
          warehouseId={wh}
          kind={draft.kind}
          initial={draft.lines}
          onClose={() => setDraft(null)}
          onDone={() => {
            setSelected([]);
            setSelectedUp([]);
          }}
        />
      )}
    </>
  );
}

function WritedownModal({
  warehouseId,
  kind,
  initial,
  onClose,
  onDone,
}: {
  warehouseId: string;
  kind: Kind;
  initial: Line[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(initial);
  const [form] = Form.useForm<{ date: dayjs.Dayjs; reason: string }>();
  const balances = useQuery({
    queryKey: ['balances', warehouseId],
    queryFn: () => get<StockBalance[]>(`/inventory/balances${qs({ warehouseId })}`),
  });
  const options = useMemo(
    () =>
      (balances.data ?? [])
        .filter((b) => Number(b.qty) > 0 && !lines.some((l) => l.productId === b.productId))
        .map((b) => ({ value: b.productId, label: `${b.sku} · ${b.productName} (${fmtQty(b.qty)} ${b.baseUom})` })),
    [balances.data, lines],
  );
  const up = kind === 'REVERSAL';
  const total = lines.reduce((a, l) => a + deltaOf(l, kind), 0);
  const invalid = lines.some((l) => lineInvalid(l, kind));

  const save = useAction(
    (v: { date: dayjs.Dayjs; reason: string }) =>
      post<{ number: string; total: string; journalNumber: string }>('/inventory/writedowns', {
        date: v.date.format('YYYY-MM-DD'),
        reason: v.reason,
        kind,
        warehouseId,
        lines: lines.map((l) => ({ productId: l.productId, newCost: String(l.newCost) })),
      }),
    {
      success: (r) =>
        `${r.number} diposting (jurnal ${r.journalNumber}) — nilai persediaan ${up ? 'naik' : 'turun'} ${fmtMoney(r.total)}`,
      invalidate: ['writedowns', 'balances', 'stock-moves', 'inventory', ...LEDGER_KEYS],
      onSuccess: () => {
        onDone();
        onClose();
      },
    },
  );

  return (
    <Modal
      open
      width={900}
      title={up ? 'Pemulihan nilai persediaan' : 'Penurunan nilai persediaan'}
      onCancel={onClose}
      okText="Posting"
      okButtonProps={{ disabled: !lines.length || invalid, loading: save.isPending }}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" initialValues={{ date: dayjs(today()) }} onFinish={(v) => save.mutate(v)}>
        <Space wrap align="start">
          <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item
            name="reason"
            label="Alasan / dasar penilaian"
            rules={[{ required: true, min: 5 }]}
            style={{ width: 560 }}
          >
            <Input
              placeholder={
                up
                  ? 'Mis. harga pasar naik kembali per daftar harga distributor Oktober 2026'
                  : 'Mis. harga jual turun di bawah harga pokok; barang mendekati kedaluwarsa (dijual diskon 50%)'
              }
            />
          </Form.Item>
        </Space>
      </Form>
      <Table<Line>
        rowKey="productId"
        size="small"
        pagination={false}
        dataSource={lines}
        columns={[
          { title: 'Barang', render: (_, l) => `${l.sku} · ${l.name}` },
          { title: 'Stok', align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.unit}` },
          { title: up ? 'Nilai buku' : 'Harga pokok', align: 'right', render: (_, l) => fmtMoney(l.avgCost) },
          ...(up
            ? [{ title: 'Batas', align: 'right' as const, render: (_: unknown, l: Line) => fmtMoney(l.maxCost ?? 0) }]
            : []),
          {
            title: up ? 'Nilai pulih / satuan' : 'Nilai realisasi neto / satuan',
            render: (_, l, i) => (
              <InputNumber
                min={0}
                value={l.newCost}
                status={l.newCost != null && lineInvalid(l, kind) ? 'error' : undefined}
                onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, newCost: v } : x)))}
                style={{ width: 150 }}
              />
            ),
          },
          { title: up ? 'Pemulihan' : 'Penurunan', align: 'right', render: (_, l) => fmtMoney(deltaOf(l, kind)) },
          {
            render: (_, _l, i) => (
              <Button type="link" danger size="small" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                Hapus
              </Button>
            ),
          },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={up ? 5 : 4}>
              <b>Total {up ? 'pemulihan' : 'penurunan'} nilai</b>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <b>{fmtMoney(total)}</b>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} />
          </Table.Summary.Row>
        )}
      />
      {!up && (
        <Select
          showSearch
          value={null}
          placeholder="+ Tambah barang (rusak, usang, kedaluwarsa)"
          optionFilterProp="label"
          style={{ width: '100%', marginTop: 12 }}
          options={options}
          loading={balances.isLoading}
          onChange={(id: string) => {
            const b = balances.data?.find((x) => x.productId === id);
            if (b)
              setLines((ls) => [
                ...ls,
                {
                  productId: b.productId,
                  sku: b.sku,
                  name: b.productName,
                  unit: b.baseUom,
                  qty: Number(b.qty),
                  avgCost: Number(b.avgCost),
                  newCost: null,
                },
              ]);
          }}
        />
      )}
      {invalid && lines.length > 0 && (
        <Typography.Paragraph type="danger" style={{ marginTop: 8, marginBottom: 0 }}>
          {up
            ? 'Nilai pulih harus di atas nilai buku dan tidak melebihi batas (harga pokok sebelum diturunkan).'
            : 'Nilai realisasi neto harus diisi dan lebih kecil dari harga pokok.'}
        </Typography.Paragraph>
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        {up
          ? 'Jurnal: Dr Persediaan Barang Dagang · Cr Kerugian Penurunan Nilai Persediaan. Secara fiskal pemulihan ini bukan penghasilan (koreksi negatif).'
          : 'Jurnal: Dr Kerugian Penurunan Nilai Persediaan · Cr Persediaan Barang Dagang. Secara fiskal kerugian ini belum dapat dikurangkan (koreksi positif); saat barangnya terjual atau keluar, sistem otomatis membuat koreksi negatif di Rekonsiliasi fiskal.'}
      </Typography.Paragraph>
    </Modal>
  );
}

import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Descriptions, Input, Select, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';

type AuditRow = {
  id: number;
  at: string;
  action: string;
  entity: string;
  entityId: string;
  label: string;
  category: string;
  categoryLabel: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  ref: string | null;
  link: string | null;
  data: { route?: string; ip?: string; agent?: string; body?: unknown; before?: unknown; [k: string]: unknown } | null;
};

const CAT_COLOR: Record<string, string> = {
  sales: 'blue',
  purchase: 'purple',
  inventory: 'orange',
  accounting: 'cyan',
  master: 'geekblue',
  hr: 'magenta',
  settings: 'default',
  security: 'red',
};
const CATEGORIES = [
  ['sales', 'Penjualan'],
  ['purchase', 'Pembelian'],
  ['inventory', 'Inventori'],
  ['accounting', 'Akuntansi'],
  ['master', 'Data master'],
  ['hr', 'SDM'],
  ['settings', 'Pengaturan'],
  ['security', 'Keamanan (login, pengguna)'],
];

const FIELD: Record<string, string> = {
  sellPrice: 'Harga jual',
  creditLimit: 'Limit kredit',
  paymentTermDays: 'Termin (hari)',
  name: 'Nama',
  code: 'Kode',
  sku: 'SKU',
  isActive: 'Aktif',
  role: 'Peran',
  phone: 'Telepon',
  address: 'Alamat',
  npwp: 'NPWP',
  category: 'Kategori',
  barcode: 'Barcode',
  baseUom: 'Satuan',
  email: 'Email',
  password: 'Kata sandi',
};
const MONEY = new Set(['sellPrice', 'creditLimit', 'amount', 'price', 'total']);
const fmt = (k: string, v: unknown) => (MONEY.has(k) && v !== null && v !== '' && !isNaN(Number(v)) ? fmtMoney(Number(v)) : show(v));
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Ya' : 'Tidak') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Perubahan: nilai lama → nilai baru per kolom */
function Changes({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const keys = Object.keys(after);
  return (
    <Table
      size="small"
      rowKey="k"
      pagination={false}
      style={{ maxWidth: 720 }}
      dataSource={keys.map((k) => ({ k, before: before[k], after: after[k], changed: show(before[k]) !== show(after[k]) && !(Number(before[k]) === Number(after[k]) && !isNaN(Number(after[k]))) }))}
      columns={[
        { title: 'Kolom', dataIndex: 'k', render: (k: string) => FIELD[k] ?? k },
        { title: 'Sebelum', dataIndex: 'before', render: (v, r) => (r.k in before ? <Typography.Text delete={r.changed}>{fmt(r.k, v)}</Typography.Text> : '—') },
        { title: 'Sesudah', dataIndex: 'after', render: (v, r) => <Typography.Text strong={r.changed}>{fmt(r.k, v)}</Typography.Text> },
      ]}
    />
  );
}

/** Tampilkan isi perubahan sebagai daftar ringkas, bukan JSON mentah */
function Detail({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined || value === '') return <Typography.Text type="secondary">—</Typography.Text>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value))
    return (
      <div>
        {value.map((v, i) => (
          <div key={i} style={{ borderLeft: '2px solid #e2e8f0', paddingLeft: 8, marginBottom: 4 }}>
            <Detail value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Descriptions size="small" column={1} bordered={depth === 0} styles={{ label: { width: 170 } }}>
      {entries.map(([k, v]) => (
        <Descriptions.Item key={k} label={k}>
          <Detail value={v} depth={depth + 1} />
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

export default function AuditPage() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [userId, setUserId] = useState<string>();
  const [category, setCategory] = useState<string>();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const users = useQuery({ queryKey: ['audit-users'], queryFn: () => get<{ id: string; name: string; email: string }[]>('/audit-logs/users') });
  const list = useQuery({
    queryKey: ['audit', from, to, userId, category, q, page],
    queryFn: () => get<{ rows: AuditRow[]; hasMore: boolean }>(`/audit-logs${qs({ from, to, userId, category, q: q || undefined, page: String(page) })}`),
    placeholderData: (prev) => prev,
  });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Jejak Audit" />
      <Card>
        <Typography.Paragraph type="secondary">
          Setiap perubahan data tercatat otomatis: siapa, kapan, dari mana, dan apa yang diubah — termasuk perubahan harga, limit kredit, jurnal, hak akses, dan
          login. Catatan tidak bisa diubah atau dihapus dari aplikasi.
        </Typography.Paragraph>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input type="date" value={from} onChange={(e) => e.target.value && reset(setFrom)(e.target.value)} />
          <span>s/d</span>
          <Input type="date" value={to} onChange={(e) => e.target.value && reset(setTo)(e.target.value)} />
          <Select
            allowClear
            placeholder="Semua pengguna"
            style={{ minWidth: 200 }}
            value={userId}
            onChange={reset(setUserId)}
            options={users.data?.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
          />
          <Select allowClear placeholder="Semua kategori" style={{ minWidth: 200 }} value={category} onChange={reset(setCategory)} options={CATEGORIES.map(([value, label]) => ({ value, label }))} />
          <Input.Search placeholder="Cari nomor dokumen / nama / isi" allowClear onSearch={reset(setQ)} style={{ width: 280 }} />
        </Space>
        <Table
          rowKey="id"
          size="small"
          loading={list.isFetching}
          dataSource={list.data?.rows}
          pagination={false}
          scroll={{ x: 900 }}
          expandable={{
            expandedRowRender: (r) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                {r.data?.route && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.data.route}
                    {r.data.agent ? ` · ${r.data.agent}` : ''}
                  </Typography.Text>
                )}
                {r.data?.before && r.data.body && typeof r.data.body === 'object' ? (
                  <Changes before={r.data.before as Record<string, unknown>} after={r.data.body as Record<string, unknown>} />
                ) : (
                  <Detail value={r.data?.body ?? Object.fromEntries(Object.entries(r.data ?? {}).filter(([k]) => !['route', 'ip', 'agent'].includes(k)))} />
                )}
              </Space>
            ),
          }}
          columns={[
            { title: 'Waktu', dataIndex: 'at', width: 150, render: (v: string) => dayjs(v).format('DD MMM YYYY HH:mm') },
            { title: 'Pengguna', width: 170, render: (_, r) => r.userName ?? <Typography.Text type="secondary">Sistem</Typography.Text> },
            { title: 'Kategori', dataIndex: 'categoryLabel', width: 120, render: (v: string, r) => <Tag color={CAT_COLOR[r.category]}>{v}</Tag> },
            { title: 'Aktivitas', dataIndex: 'label' },
            {
              title: 'Dokumen / data',
              render: (_, r) =>
                r.ref ? r.link ? <a onClick={() => navigate(r.link!)}>{r.ref}</a> : r.ref : <Typography.Text type="secondary">—</Typography.Text>,
            },
            { title: 'IP', width: 120, render: (_, r) => <Typography.Text type="secondary">{r.data?.ip ?? ''}</Typography.Text> },
          ]}
        />
        <Space style={{ marginTop: 12 }}>
          <Button icon={<LeftOutlined />} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </Button>
          <Typography.Text>Halaman {page}</Typography.Text>
          <Button disabled={!list.data?.hasMore} onClick={() => setPage((p) => p + 1)}>
            Berikutnya <RightOutlined />
          </Button>
        </Space>
      </Card>
    </>
  );
}

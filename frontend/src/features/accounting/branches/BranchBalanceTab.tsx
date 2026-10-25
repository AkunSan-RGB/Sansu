import { useQuery } from '@tanstack/react-query';
import { Alert, DatePicker, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get } from '@/api/client';
import { fmtMoney } from '@/lib/format';

interface Bs {
  asOf: string;
  columns: { key: string; code: string; name: string }[];
  summary: Record<string, { assets: string; liabilities: string; equity: string; earnings: string; balanced: boolean; difference: string }>;
  consolidated: { assets: string; liabilities: string; equity: string; earnings: string; balanced: boolean };
  interbranch: { byBranch: Record<string, string>; net: string; eliminated: boolean };
  transfers: { number: string; date: string; from: string; to: string; total: string }[];
  rows: { accountId: string; code: string; name: string; type: 'ASSET' | 'LIABILITY' | 'EQUITY'; values: Record<string, string>; total: string; isInterbranch: boolean }[];
}

/** Posisi keuangan (neraca) per cabang + gabungan dengan eliminasi Rekening Antar Cabang */
export function BranchBalanceTab() {
  const [asOf, setAsOf] = useState(dayjs());
  const q = useQuery({ queryKey: ['branches', 'bs', asOf.format('YYYY-MM-DD')], queryFn: () => get<Bs>(`/branches/balance-sheet?asOf=${asOf.format('YYYY-MM-DD')}`) });
  const r = q.data;
  const cols = r?.columns ?? [];
  const label = { ASSET: 'Aset', LIABILITY: 'Liabilitas', EQUITY: 'Ekuitas' } as const;
  const summaryRows = r
    ? ([
        ['Total aset', 'assets'],
        ['Total liabilitas', 'liabilities'],
        ['Total ekuitas (termasuk laba berjalan)', 'equity'],
      ] as [string, 'assets' | 'liabilities' | 'equity'][]).map(([name, k]) => ({ name, k }))
    : [];
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <span>Per tanggal</span>
        <DatePicker value={asOf} allowClear={false} onChange={(v) => v && setAsOf(v)} />
      </Space>
      {r && !r.interbranch.eliminated && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={`Rekening Antar Cabang tidak nol saat digabung (${fmtMoney(r.interbranch.net)}). Periksa jurnal yang memakai akun ini.`} />}
      {r && Object.values(r.summary).some((s) => !s.balanced) && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Ada neraca cabang yang tidak seimbang." />}
      <Table
        size="small"
        rowKey="name"
        pagination={false}
        loading={q.isLoading}
        dataSource={summaryRows}
        scroll={{ x: 600 + cols.length * 150 }}
        columns={[
          { title: 'Ringkasan', dataIndex: 'name', fixed: 'left', width: 260 },
          ...cols.map((c) => ({ title: c.code === '-' ? 'Pusat' : c.code, align: 'right' as const, render: (_: unknown, row: { k: 'assets' | 'liabilities' | 'equity' }) => fmtMoney(r!.summary[c.key]?.[row.k] ?? 0) })),
          { title: 'Gabungan', align: 'right', render: (_: unknown, row: { k: 'assets' | 'liabilities' | 'equity' }) => <strong>{fmtMoney(r!.consolidated[row.k])}</strong> },
        ]}
        footer={() => (
          <Space>
            {cols.map((c) => (
              <Tag key={c.key} color={r?.summary[c.key]?.balanced ? 'green' : 'red'}>
                {c.code === '-' ? 'Pusat' : c.code}: {r?.summary[c.key]?.balanced ? 'seimbang' : 'tidak seimbang'}
              </Tag>
            ))}
          </Space>
        )}
      />
      <Typography.Title level={5} style={{ marginTop: 20 }}>
        Rincian akun
      </Typography.Title>
      <Table
        size="small"
        rowKey="accountId"
        pagination={false}
        loading={q.isLoading}
        dataSource={r?.rows}
        scroll={{ x: 600 + cols.length * 150 }}
        columns={[
          { title: 'Akun', fixed: 'left', width: 280, render: (_, a: Bs['rows'][number]) => <span>{a.code} {a.name} <Tag>{label[a.type]}</Tag>{a.isInterbranch && <Tag color="purple">dieliminasi</Tag>}</span> },
          ...cols.map((c) => ({ title: c.code === '-' ? 'Pusat' : c.code, align: 'right' as const, render: (_: unknown, a: Bs['rows'][number]) => fmtMoney(a.values[c.key] ?? 0) })),
          { title: 'Gabungan', align: 'right', render: (_: unknown, a: Bs['rows'][number]) => <strong>{fmtMoney(a.total)}</strong> },
        ]}
      />
      <Typography.Title level={5} style={{ marginTop: 20 }}>
        Perpindahan barang antar-cabang
      </Typography.Title>
      <Table
        size="small"
        rowKey="number"
        pagination={false}
        dataSource={r?.transfers}
        locale={{ emptyText: 'Belum ada perpindahan barang antar-cabang' }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Tanggal', dataIndex: 'date' },
          { title: 'Dari', dataIndex: 'from' },
          { title: 'Ke', dataIndex: 'to' },
          { title: 'Nilai', dataIndex: 'total', align: 'right', render: fmtMoney },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Setiap cabang punya neraca sendiri yang seimbang. Barang yang berpindah antar-cabang dicatat lewat akun "Rekening Antar Cabang" (piutang di satu cabang, utang di cabang lain); saat digabung akun ini saling menghapus menjadi nol, sehingga kolom Gabungan sama dengan neraca perusahaan.
      </Typography.Paragraph>
    </>
  );
}

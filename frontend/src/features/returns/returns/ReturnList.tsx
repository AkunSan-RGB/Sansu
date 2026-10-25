import { useQuery } from '@tanstack/react-query';
import { Empty, Input, Segmented, Space, Table } from 'antd';
import { useState } from 'react';
import { get } from '@/api/client';
import type { ReturnDoc } from '@/api/types';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { t } from '@/lib/terms';
import { CFG, Kind } from './shared';

export function ReturnList({ kind }: { kind: Kind }) {
  const cfg = CFG[kind];
  const [view, setView] = useState<'ALL' | 'MONTH'>('ALL');
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: [kind === 'sales' ? 'sales-returns' : 'purchase-returns'],
    queryFn: () => get<ReturnDoc[]>(cfg.list),
  });
  const all = data ?? [];
  const month = today().slice(0, 7);
  const thisMonth = all.filter((r) => r.date.slice(0, 7) === month);
  const sum = (xs: ReturnDoc[]) => xs.reduce((a, r) => a + Number(r.total), 0);
  const q = search.trim().toLowerCase();
  const shown = all.filter(
    (r) => (view === 'ALL' || r.date.slice(0, 7) === month) && (!q || `${r.number} ${(r.customer ?? r.supplier)?.name ?? ''} ${r.invoice.number} ${r.reason ?? ''}`.toLowerCase().includes(q)),
  );
  return (
    <>
      {!isLoading && all.length > 0 && (
        <SummaryCards
          items={[
            { label: `Total ${cfg.label.toLowerCase()}`, value: fmtMoney(sum(all)), hint: `${all.length} retur` },
            { label: 'Retur bulan ini', value: fmtMoney(sum(thisMonth)), hint: `${thisMonth.length} retur`, tone: thisMonth.length ? 'warn' : 'neutral' },
            { label: 'Jumlah retur', value: String(all.length), hint: kind === 'sales' ? `barang kembali dari ${t('pelanggan')}` : 'barang kembali ke supplier' },
          ]}
        />
      )}
      <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
        <Segmented
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { value: 'ALL', label: `Semua (${all.length})` },
            { value: 'MONTH', label: `Bulan ini (${thisMonth.length})` },
          ]}
        />
        <Input.Search allowClear placeholder={`Cari ${cfg.party.toLowerCase()} atau nomor`} style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
      </Space>
      <ResponsiveTable<ReturnDoc>
        rowKey="id"
        loading={isLoading}
        dataSource={shown}
        scroll={{ x: 900 }}
        locale={{ emptyText: <Empty description={search || view !== 'ALL' ? 'Tidak ada data yang cocok dengan pilihan ini' : 'Belum ada retur'} /> }}
        expandable={{
          expandedRowRender: (r) => (
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={r.lines}
              columns={[
                { title: t('Produk'), render: (_, l) => `${l.product.sku} · ${l.product.name}` },
                { title: 'Qty', align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.uom}` },
                { title: 'Nilai', dataIndex: 'lineTotal', align: 'right', render: fmtMoney },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: cfg.party, render: (_, r) => (r.customer ?? r.supplier)?.name },
          { title: t('Faktur asal'), render: (_, r) => r.invoice.number + (r.invoice.supplierInvoiceNo ? ` (${r.invoice.supplierInvoiceNo})` : '') },
          { title: 'Alasan', dataIndex: 'reason', render: (v) => v ?? '-' },
          { title: 'DPP', dataIndex: 'subtotal', align: 'right', render: fmtMoney },
          { title: 'PPN', dataIndex: 'taxAmount', align: 'right', render: fmtMoney },
          { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => <strong>{fmtMoney(v)}</strong> },
        ]}
      />
    </>
  );
}

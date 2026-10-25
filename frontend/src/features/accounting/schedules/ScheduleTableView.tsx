import { Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import type { ScheduleColumn, ScheduleRow, ScheduleTable } from '@/api/types';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';

const show = (c: ScheduleColumn, v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '') return '';
  switch (c.kind) {
    case 'money':
      return fmtMoney(v);
    case 'qty':
      return fmtQty(v);
    case 'date':
      return fmtDate(String(v));
    case 'percent':
      return `${fmtQty(v)}%`;
    default:
      return String(v);
  }
};

/**
 * Menggambar satu tabel jadwal murni dari definisi kolom dari server: tidak ada kondisi per akun di sini,
 * sehingga jenis jadwal baru di backend langsung tampil tanpa mengubah halaman.
 */
export default function ScheduleTableView({ table }: { table: ScheduleTable }) {
  const columns: ColumnsType<ScheduleRow> = table.columns.map((c, i) => ({
    title: c.title,
    key: c.key,
    align: c.kind === 'text' || c.kind === 'date' ? 'left' : 'right',
    width: c.kind === 'money' ? 150 : undefined,
    render: (_: unknown, r: ScheduleRow) => {
      const text = show(c, r.cells[c.key]);
      return i === 0 && r.link ? <Link to={r.link}>{text}</Link> : text;
    },
  }));
  const total = table.total;
  return (
    <div style={{ marginBottom: 24 }}>
      <Typography.Title level={5} style={{ marginBottom: 4 }}>
        {table.title}
      </Typography.Title>
      {table.note && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          {table.note}
        </Typography.Paragraph>
      )}
      <Table<ScheduleRow>
        size="small"
        rowKey={(_, i) => String(i)}
        columns={columns}
        dataSource={table.rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'Tidak ada data pada periode ini' }}
        summary={
          total
            ? () => (
                <Table.Summary.Row style={{ fontWeight: 600, background: '#fafafa' }}>
                  {table.columns.map((c, i) => (
                    <Table.Summary.Cell key={c.key} index={i} align={c.kind === 'text' || c.kind === 'date' ? 'left' : 'right'}>
                      {show(c, total[c.key])}
                    </Table.Summary.Cell>
                  ))}
                </Table.Summary.Row>
              )
            : undefined
        }
      />
    </div>
  );
}

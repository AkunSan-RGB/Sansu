import { Button, Card, Empty, Grid, Spin, Table, type TableProps } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { type ReactNode, useState } from 'react';

type Props<T> = TableProps<T> & {
  /** Kolom yang jadi judul kartu di HP (default: kolom pertama) */
  mobileTitle?: number;
  /** Klik kartu di HP (mis. buka detail) */
  onMobileClick?: (row: T) => void;
};

const PAGE = 20;

/**
 * Tabel yang di HP berubah menjadi daftar kartu: tiap baris = satu kartu berisi pasangan label–nilai,
 * kolom tanpa judul (tombol aksi) di bagian bawah kartu. Di layar lebar tetap tabel biasa.
 */
export default function ResponsiveTable<T extends object>({ mobileTitle = 0, onMobileClick, ...props }: Props<T>) {
  const screens = Grid.useBreakpoint();
  const [shown, setShown] = useState(PAGE);
  const mobile = screens.md === false; // undefined saat awal render → anggap layar lebar
  if (!mobile || props.expandable) return <Table<T> {...props} />;

  const data = (props.dataSource ?? []) as T[];
  const cols = (props.columns ?? []) as ColumnType<T>[];
  const valueOf = (c: ColumnType<T>, row: T, i: number): ReactNode => {
    const di = c.dataIndex;
    const raw = di === undefined ? undefined : Array.isArray(di) ? di.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], row) : (row as Record<string, unknown>)[di as string];
    return (c.render ? c.render(raw, row, i) : raw) as ReactNode;
  };
  const keyOf = (row: T, i: number) => {
    const rk = props.rowKey;
    return typeof rk === 'function' ? rk(row, i) : rk ? String((row as Record<string, unknown>)[rk as string]) : String(i);
  };
  const titled = cols.filter((c) => c.title);
  const head = titled[mobileTitle] ?? titled[0];
  const actions = cols.filter((c) => !c.title);

  if (props.loading && !data.length) return <Spin style={{ display: 'block', margin: '24px auto' }} />;
  if (!data.length) return <Empty description={(typeof props.locale?.emptyText === 'function' ? props.locale.emptyText() : props.locale?.emptyText) ?? 'Belum ada data'} />;

  return (
    <div>
      {data.slice(0, shown).map((row, i) => (
        <Card
          key={keyOf(row, i)}
          size="small"
          style={{ marginBottom: 8, cursor: onMobileClick ? 'pointer' : undefined }}
          onClick={onMobileClick ? () => onMobileClick(row) : undefined}
          title={head ? <span style={{ fontWeight: 600 }}>{valueOf(head, row, i)}</span> : undefined}
        >
          {titled
            .filter((c) => c !== head)
            .map((c, k) => {
              const v = valueOf(c, row, i);
              if (v === null || v === undefined || v === '' || v === false) return null;
              return (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0', fontSize: 13 }}>
                  <span style={{ color: '#64748b', flex: '0 0 auto' }}>{c.title as ReactNode}</span>
                  <span style={{ textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
                </div>
              );
            })}
          {actions.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
              {actions.map((c, k) => (
                <span key={k}>{valueOf(c, row, i)}</span>
              ))}
            </div>
          )}
        </Card>
      ))}
      {data.length > shown && (
        <Button block onClick={() => setShown((s) => s + PAGE)}>
          Tampilkan lebih banyak ({data.length - shown} lagi)
        </Button>
      )}
    </div>
  );
}

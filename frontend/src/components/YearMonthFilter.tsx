import { Select, Space } from 'antd';
import dayjs from 'dayjs';

/** Filter masa laporan pajak: tahun, dan bulan (kosong = setahun). Dipakai bersama oleh tab PPh 21 dan tab PPh dipotong di Rekap pajak. */
export default function YearMonthFilter({ year, month, onYear, onMonth }: { year: number; month: number | null; onYear: (y: number) => void; onMonth: (m: number | null) => void }) {
  const now = dayjs().year();
  // tahun berjalan dan tiga tahun sebelumnya; tahun yang sedang dipilih (mis. dari tautan) selalu ada di daftar
  const years = [...new Set([year, ...[0, 1, 2, 3].map((i) => now - i)])].sort((a, b) => b - a);
  return (
    <Space wrap className="no-print">
      <Select aria-label="Tahun" value={year} onChange={onYear} style={{ width: 100 }} options={years.map((y) => ({ value: y, label: y }))} />
      <Select
        aria-label="Bulan"
        allowClear
        placeholder="Setahun"
        value={month}
        onChange={(v) => onMonth(v ?? null)}
        style={{ width: 150 }}
        options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: dayjs().month(i).format('MMMM') }))}
      />
    </Space>
  );
}

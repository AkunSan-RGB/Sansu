import { DownOutlined, FileExcelOutlined, FileTextOutlined, PrinterOutlined } from '@ant-design/icons';
import { App, Button, Dropdown, Space } from 'antd';
import { useState } from 'react';
import { exportCsv, exportExcel, printReport, type SheetSpec } from '@/lib/export';
import { CSV_ID, CSV_STANDARD } from '@/lib/xlsx/csv';

/** Tombol Excel + CSV + Cetak/PDF untuk halaman laporan */
export default function ExportButtons({ filename, title, sheets, print = true }: { filename: string; title: string; sheets: () => SheetSpec[] | null; print?: boolean }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Space className="no-print">
      <Button
        icon={<FileExcelOutlined />}
        loading={busy}
        onClick={async () => {
          const s = sheets();
          if (!s) return message.info('Data laporan belum dimuat');
          setBusy(true);
          try {
            await exportExcel(filename, s);
          } catch (e) {
            message.error(`Gagal membuat file Excel: ${(e as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        Excel
      </Button>
      <Dropdown
        menu={{
          items: [
            { key: 'id', label: 'CSV untuk Excel Indonesia (titik koma, koma desimal)' },
            { key: 'std', label: 'CSV standar (koma, titik desimal)' },
          ],
          onClick: ({ key }) => {
            const s = sheets();
            if (!s) return message.info('Data laporan belum dimuat');
            exportCsv(filename, s, key === 'id' ? CSV_ID : CSV_STANDARD);
          },
        }}
      >
        <Button icon={<FileTextOutlined />}>
          CSV <DownOutlined style={{ fontSize: 10 }} />
        </Button>
      </Dropdown>
      {print && (
        <Button icon={<PrinterOutlined />} onClick={() => printReport(title)}>
          Cetak / PDF
        </Button>
      )}
    </Space>
  );
}

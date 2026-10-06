import { FileExcelOutlined, PrinterOutlined } from '@ant-design/icons';
import { App, Button, Space } from 'antd';
import { useState } from 'react';
import { exportExcel, printReport, type SheetSpec } from '@/lib/export';

/** Tombol Excel + Cetak/PDF untuk halaman laporan */
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
      {print && (
        <Button icon={<PrinterOutlined />} onClick={() => printReport(title)}>
          Cetak / PDF
        </Button>
      )}
    </Space>
  );
}

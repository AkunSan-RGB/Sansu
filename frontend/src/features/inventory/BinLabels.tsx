import { PrinterOutlined } from '@ant-design/icons';
import { Button, Space, Typography } from 'antd';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { printDoc } from '@/lib/print';
import { buildBinQr } from './binQr';

export interface LabelBin { id: string; code: string; zone: string | null; name: string | null; kind: string }

/** Label rak siap cetak (QR + kode besar), dua kolom di kertas A4; tempel di rak lalu pindai saat menata/mengambil */
export default function BinLabels({ bins, warehouseCode, warehouseName }: { bins: LabelBin[]; warehouseCode: string; warehouseName: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const b of bins) out[b.id] = await QRCode.toDataURL(buildBinQr(warehouseCode, b.code), { margin: 1, width: 220, errorCorrectionLevel: 'M' });
      if (live) setUrls(out);
    })();
    return () => {
      live = false;
    };
  }, [bins, warehouseCode]);
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Button icon={<PrinterOutlined />} type="primary" style={{ width: 'fit-content' }} disabled={!bins.length} onClick={() => printDoc(`Label rak ${warehouseCode}`)}>
        Cetak {bins.length} label
      </Button>
      <Typography.Text type="secondary">Satu label per rak terpilih. Gunakan kertas stiker A4; ukuran tiap label ±9 × 5 cm.</Typography.Text>
      <div className="print-doc" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {bins.map((b) => (
          <div key={b.id} style={{ border: '1px solid #222', borderRadius: 6, padding: 8, display: 'flex', gap: 10, alignItems: 'center', breakInside: 'avoid', minHeight: 150 }}>
            {urls[b.id] ? <img src={urls[b.id]} width={120} height={120} alt={`QR ${b.code}`} /> : <div style={{ width: 120, height: 120 }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, wordBreak: 'break-all' }}>{b.code}</div>
              {b.zone && <div style={{ fontSize: 14 }}>Zona {b.zone}</div>}
              {b.name && <div style={{ fontSize: 12 }}>{b.name}</div>}
              <div style={{ fontSize: 11, marginTop: 4 }}>{warehouseCode} · {warehouseName}</div>
            </div>
          </div>
        ))}
      </div>
    </Space>
  );
}

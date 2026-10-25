import { CarOutlined, CheckOutlined, PrinterOutlined, RollbackOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Space } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import QueryState from '@/components/QueryState';
import { cell, DocHeader, head, PrintSheet, Signatures } from '@/components/print/Letterhead';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { printDoc } from '@/lib/print';
import { KEYS, TransferDetail } from './shared';
import { ReceiveModal } from './ReceiveModal';

export function TransferDoc({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['transfers', id], queryFn: () => get<TransferDetail>(`/inventory/transfers/${id}`) });
  const { me } = useAuth();
  const { modal } = App.useApp();
  const [receiving, setReceiving] = useState(false);
  const can = useCan();
  const inWarehouse = (whId: string) =>
    (me?.role === 'OWNER' || me?.role === 'ADMIN' || me?.role === 'WAREHOUSE') &&
    (!me?.warehouseIds?.length || me.warehouseIds.includes(whId));
  const cancel = useAction(() => post(`/inventory/transfers/${id}/cancel`, {}), {
    success: 'Kiriman dibatalkan — barang kembali ke gudang asal',
    invalidate: KEYS,
  });
  return (
    <QueryState q={q}>
      {(t) => (
        <>
          {t.status === 'IN_TRANSIT' && (
            <Alert
              className="no-print"
              type="warning"
              showIcon
              icon={<CarOutlined />}
              style={{ marginBottom: 16 }}
              message="Barang dalam perjalanan"
              description={`Stok sudah keluar dari ${t.from.name} dan akan masuk ke ${t.to.name} setelah diterima.`}
            />
          )}
          {t.status !== 'IN_TRANSIT' && t.receivedDate && t.status === 'RECEIVED' && t.receivedBy && (
            <Alert
              className="no-print"
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
              message={`Diterima ${fmtDate(t.receivedDate)} oleh ${t.receivedBy}${t.receiveNotes ? ` · ${t.receiveNotes}` : ''}`}
            />
          )}
          {t.status === 'CANCELLED' && (
            <Alert
              className="no-print"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`Dibatalkan ${fmtDate(t.receivedDate)} — barang kembali ke ${t.from.name}`}
            />
          )}
          <Space style={{ marginBottom: 16 }} className="no-print" wrap>
            <Button
              icon={<PrinterOutlined />}
              type={t.status === 'IN_TRANSIT' ? 'default' : 'primary'}
              onClick={() => printDoc(`Surat jalan transfer ${t.number}`)}
            >
              Cetak surat jalan
            </Button>
            {t.status === 'IN_TRANSIT' && inWarehouse(t.to.id) && can('POST', '/inventory/transfers/:id/receive') && (
              <Button type="primary" icon={<CheckOutlined />} onClick={() => setReceiving(true)}>
                Terima barang
              </Button>
            )}
            {t.status === 'IN_TRANSIT' && inWarehouse(t.from.id) && can('POST', '/inventory/transfers/:id/cancel') && (
              <Button
                danger
                icon={<RollbackOutlined />}
                loading={cancel.isPending}
                onClick={() =>
                  modal.confirm({
                    title: `Batalkan kiriman ${t.number}?`,
                    content: `Semua barang dikembalikan ke stok ${t.from.name}. Gunakan bila kiriman batal berangkat atau dikembalikan utuh.`,
                    okText: 'Batalkan kiriman',
                    okButtonProps: { danger: true },
                    onOk: () => cancel.mutateAsync(undefined),
                  })
                }
              >
                Batalkan kiriman
              </Button>
            )}
          </Space>
          <ReceiveModal t={t} open={receiving} onClose={() => setReceiving(false)} />
          <PrintSheet>
            <DocHeader
              title="SURAT JALAN TRANSFER"
              meta={[
                ['Nomor', t.number],
                ['Tanggal', fmtDate(t.date)],
              ]}
            />
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13, marginBottom: 16 }}>
              {[
                ['Dari gudang', t.from],
                ['Ke gudang', t.to],
              ].map(([label, w]) => {
                const x = w as TransferDetail['from'];
                return (
                  <div key={label as string} style={{ flex: '1 1 240px' }}>
                    <div style={{ color: '#64748b' }}>{label as string}</div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {x.code} · {x.name}
                    </div>
                    {x.address && <div>{x.address}</div>}
                  </div>
                );
              })}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={head}>No</th>
                  <th style={head}>Kode</th>
                  <th style={head}>Nama barang</th>
                  <th style={{ ...head, textAlign: 'right' }}>Jumlah</th>
                  <th style={head}>Satuan</th>
                  <th style={{ ...head, textAlign: 'center' }}>Diterima</th>
                </tr>
              </thead>
              <tbody>
                {t.lines.map((l, i) => {
                  const got = t.status === 'RECEIVED' && l.receivedQty != null ? Number(l.receivedQty) : null;
                  return (
                    <tr key={l.productId}>
                      <td style={cell}>{i + 1}</td>
                      <td style={cell}>{l.sku}</td>
                      <td style={cell}>{l.name}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>{fmtQty(l.qty)}</td>
                      <td style={cell}>{l.baseUom}</td>
                      <td
                        style={{
                          ...cell,
                          width: 90,
                          textAlign: 'center',
                          color: got != null && got < Number(l.qty) ? '#dc2626' : undefined,
                          fontWeight: got != null && got < Number(l.qty) ? 700 : undefined,
                        }}
                      >
                        {got != null ? fmtQty(got) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {t.notes && <div style={{ marginTop: 12, fontSize: 13 }}>Catatan: {t.notes}</div>}
            <div className="no-print" style={{ marginTop: 12, fontSize: 13, color: '#64748b' }}>
              Nilai persediaan dipindahkan (HPP): {fmtMoney(t.totalValue)} · dibuat oleh {t.createdBy ?? '-'} ·{' '}
              {dayjs(t.date).format('DD MMM YYYY')}
            </div>
            <Signatures labels={[['Dikirim oleh'], ['Pengemudi'], ['Diterima oleh']]} />
          </PrintSheet>
        </>
      )}
    </QueryState>
  );
}

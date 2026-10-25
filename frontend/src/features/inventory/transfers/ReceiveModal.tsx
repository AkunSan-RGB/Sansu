import { Alert, Input, InputNumber, Modal, Space, Table } from 'antd';
import { useState } from 'react';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtMoney, fmtQty, today } from '@/lib/format';
import BinSelect from '../BinSelect';
import { KEYS, TransferDetail } from './shared';

/** Penerimaan barang di gudang tujuan — isi jumlah yang benar-benar tiba */
export function ReceiveModal({ t, open, onClose }: { t: TransferDetail; open: boolean; onClose: () => void }) {
  const [qty, setQty] = useState<Record<string, number | null>>({});
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [binOf, setBinOf] = useState<Record<string, string | undefined>>({});
  const got = (l: TransferDetail['lines'][number]) => qty[l.productId] ?? Number(l.qty);
  const short = t.lines.filter((l) => got(l) < Number(l.qty));
  const shortValue = short.reduce((a, l) => a + (Number(l.qty) - got(l)) * Number(l.unitCost), 0);
  const receive = useAction(
    () =>
      post<{ shortageValue: string }>(`/inventory/transfers/${t.id}/receive`, {
        date,
        notes: notes || undefined,
        lines: t.lines.map((l) => ({ productId: l.productId, receivedQty: String(got(l)), binId: binOf[l.productId] || undefined })),
      }),
    {
      success: (r) =>
        Number(r.shortageValue) > 0
          ? `Barang diterima. Kekurangan ${fmtMoney(r.shortageValue)} dicatat sebagai selisih persediaan`
          : 'Barang diterima lengkap — stok gudang tujuan bertambah',
      invalidate: KEYS,
      onSuccess: onClose,
    },
  );
  return (
    <Modal
      title={`Terima barang ${t.number} di ${t.to.name}`}
      open={open}
      onCancel={onClose}
      width={720}
      okText={short.length ? 'Terima dengan kekurangan' : 'Terima semua'}
      okButtonProps={{ loading: receive.isPending }}
      onOk={() => receive.mutate(undefined)}
      destroyOnHidden
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <span>Tanggal terima</span>
        <Input type="date" value={date} min={t.date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
      </Space>
      <Table
        rowKey="productId"
        size="small"
        pagination={false}
        dataSource={t.lines}
        columns={[
          { title: 'Barang', render: (_, l) => `${l.sku} · ${l.name}` },
          { title: 'Dikirim', align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.baseUom}` },
          {
            title: 'Diterima',
            width: 150,
            render: (_, l) => (
              <InputNumber
                min={0}
                max={Number(l.qty)}
                value={got(l)}
                onChange={(v) => setQty((q) => ({ ...q, [l.productId]: v == null ? 0 : Number(v) }))}
                status={got(l) < Number(l.qty) ? 'warning' : undefined}
                style={{ width: '100%' }}
              />
            ),
          },
          { title: 'Rak', width: 170, render: (_, l) => <BinSelect warehouseId={t.to.id} value={binOf[l.productId]} onChange={(v) => setBinOf((b) => ({ ...b, [l.productId]: v }))} width={150} /> },
        ]}
      />
      {short.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message={`${short.length} barang kurang — nilai ${fmtMoney(Math.round(shortValue))}`}
          description="Kekurangan (rusak/hilang di jalan) dibukukan ke akun Selisih Persediaan. Isi catatan untuk keterangan."
        />
      )}
      <Input.TextArea
        rows={2}
        style={{ marginTop: 12 }}
        placeholder="Catatan penerimaan (opsional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={255}
      />
    </Modal>
  );
}

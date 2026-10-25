import { LockOutlined } from '@ant-design/icons';
import { POS_PAYMENT_LABELS, type PosPaymentMethod } from '@sansu/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Input, InputNumber, Modal, Result, Segmented, Space, Typography } from 'antd';
import { useState } from 'react';
import { post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { PosSession } from '@/api/types';
import DenominationCounter, { denomTotal, type Denoms } from '@/components/DenominationCounter';
import { fmtMoney } from '@/lib/format';
import { t } from '@/lib/terms';

// ---------- Tutup sesi ----------
export function CloseSession({ session, open, onClose }: { session: PosSession; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [counted, setCounted] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [byDenom, setByDenom] = useState(false);
  const [denoms, setDenoms] = useState<Denoms>({});
  const [result, setResult] = useState<(PosSession & { journalNumber?: string }) | null>(null);
  const s = session.summary!;
  const close = useAction(
    () => post<PosSession & { journalNumber?: string }>(`/pos/sessions/${session.id}/close`, { countedCash: String(counted ?? 0), notes: notes || undefined }),
    { invalidate: LEDGER_KEYS, onSuccess: setResult },
  );
  const diff = (counted ?? 0) - Number(s.expectedCash);
  return (
    <Modal
      title={`Tutup kasir ${session.number}`}
      open={open}
      onCancel={() => (result ? qc.invalidateQueries({ queryKey: ['pos-session'] }) : onClose())}
      footer={
        result ? (
          <Button type="primary" onClick={() => qc.invalidateQueries({ queryKey: ['pos-session'] })}>
            Selesai
          </Button>
        ) : (
          <Space>
            <Button onClick={onClose}>Batal</Button>
            <Button type="primary" danger icon={<LockOutlined />} disabled={counted === null} loading={close.isPending} onClick={() => close.mutate(undefined)}>
              Tutup kasir
            </Button>
          </Space>
        )
      }
    >
      {result ? (
        <Result
          status={Number(result.difference) === 0 ? 'success' : 'warning'}
          title={Number(result.difference) === 0 ? 'Kas cocok' : `Selisih ${fmtMoney(result.difference)}`}
          subTitle={result.journalNumber ? `Selisih dijurnal ke "Selisih Kas Kasir" (${result.journalNumber})` : 'Sesi ditutup tanpa selisih'}
        />
      ) : (
        <>
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Transaksi">{s.orderCount}</Descriptions.Item>
            <Descriptions.Item label={t('Total penjualan')}>{fmtMoney(s.totalSales)}</Descriptions.Item>
            {(Object.keys(s.byMethod) as PosPaymentMethod[]).filter((m) => (m !== 'PLATFORM' || Number(s.byMethod[m]) > 0) && !(s.blind && m === 'CASH')).map((m) => (
              <Descriptions.Item key={m} label={POS_PAYMENT_LABELS[m]}>
                {fmtMoney(s.byMethod[m])}
              </Descriptions.Item>
            ))}
            {!s.blind && <Descriptions.Item label="Modal awal">{fmtMoney(session.openingCash)}</Descriptions.Item>}
            {!s.blind && (
              <Descriptions.Item label={<strong>Tunai seharusnya di laci</strong>}>
                <strong>{fmtMoney(s.expectedCash)}</strong>
              </Descriptions.Item>
            )}
          </Descriptions>
          {s.blind && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Hitung seluruh uang di laci (termasuk modal awal)" description="Jumlah yang seharusnya tidak ditampilkan; selisih terlihat setelah Anda menutup kasir." />}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Typography.Text strong>Uang tunai yang Anda hitung</Typography.Text>
            <Segmented
              size="small"
              value={byDenom ? 'p' : 't'}
              onChange={(v) => {
                setByDenom(v === 'p');
                if (v === 'p') setCounted(denomTotal(denoms) || null);
              }}
              options={[
                { value: 't', label: 'Total' },
                { value: 'p', label: 'Per pecahan' },
              ]}
            />
          </div>
          {byDenom && (
            <div style={{ maxHeight: 320, overflowY: 'auto', margin: '8px 0' }}>
              <DenominationCounter
                compact
                value={denoms}
                onChange={(d) => {
                  setDenoms(d);
                  setCounted(denomTotal(d));
                }}
              />
            </div>
          )}
          <InputNumber min={0} value={counted} onChange={setCounted} disabled={byDenom} style={{ width: '100%', margin: '6px 0 8px' }} size="large" prefix="Rp" autoFocus />
          {counted !== null && !s.blind && (
            <Alert
              type={diff === 0 ? 'success' : 'warning'}
              showIcon
              message={diff === 0 ? 'Cocok' : diff < 0 ? `Kurang ${fmtMoney(-diff)}` : `Lebih ${fmtMoney(diff)}`}
              style={{ marginBottom: 8 }}
            />
          )}
          <Input placeholder="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </>
      )}
    </Modal>
  );
}

import { DEPRECIATION_METHOD_LABELS, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtMoney, today } from '@/lib/format';
import { KEYS } from './shared';

/** Ubah metode penyusutan (berlaku ke depan saja): satu aset, atau semua aset aktif di satu kategori */
export function ChangeMethodModal({ target, onClose }: { target: { kind: 'asset' | 'category'; id: string; name: string; method: string } | null; onClose: () => void }) {
  const [method, setMethod] = useState<string | undefined>();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [reason, setReason] = useState('');
  const preview = useQuery({
    queryKey: ['assets', 'method-preview', target?.id, method, month],
    queryFn: () => get<{ bookValueAtEffective: string; rows: { period: string; current: string; proposed: string }[]; total12: { current: string; proposed: string } }>(`/assets/${target!.id}/method-preview?method=${method}&effectiveMonth=${month}`),
    enabled: !!target && target.kind === 'asset' && !!method,
    retry: false,
  });
  const submit = useAction(
    () => post<{ changed?: string[]; skipped?: { asset: string; why: string }[] }>(target!.kind === 'asset' ? `/assets/${target!.id}/change-method` : `/assets/categories/${target!.id}/change-method`, { method, effectiveMonth: month, reason }),
    {
      success: (r) => (r?.changed ? `${r.changed.length} aset diubah${r.skipped?.length ? `, ${r.skipped.length} dilewati` : ''}` : 'Metode penyusutan diubah (berlaku ke depan)'),
      invalidate: [...KEYS, 'assets'],
      onSuccess: () => {
        setMethod(undefined);
        setReason('');
        onClose();
      },
    },
  );
  const options = toOptions(DEPRECIATION_METHOD_LABELS).filter((o) => o.value !== 'NONE' && o.value !== 'UNITS_OF_PRODUCTION' && o.value !== target?.method);
  return (
    <Modal
      title={target?.kind === 'category' ? `Ubah metode semua aset aktif — ${target?.name}` : `Ubah metode penyusutan — ${target?.name ?? ''}`}
      open={!!target}
      onCancel={onClose}
      onOk={() => submit.mutate(undefined)}
      okText="Ubah metode"
      okButtonProps={{ disabled: !method || reason.trim().length < 5 }}
      confirmLoading={submit.isPending}
      width={640}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Berlaku ke depan saja"
        description="Penyusutan yang sudah diposting tidak berubah. Mulai bulan berlaku, sisa nilai buku (dikurangi residu) disusutkan dengan metode baru selama sisa masa manfaat. Penyusutan sampai bulan sebelumnya diposting dulu dengan metode lama. Staf selain Pemilik/Admin menunggu persetujuan. Penyusutan fiskal (Pasal 11) tidak berubah; selisihnya dengan komersial masuk koreksi fiskal otomatis. Metode unit produksi tidak bisa dipilih/ditinggalkan pada aset yang sudah berjalan."
      />
      <Space direction="vertical" style={{ width: '100%' }}>
        <Select style={{ width: '100%' }} placeholder="Metode baru" options={options} value={method} onChange={setMethod} />
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} addonBefore="Berlaku mulai bulan" />
        <Input.TextArea rows={2} placeholder="Alasan perubahan (wajib, minimal 5 huruf)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {target?.kind === 'asset' && method && preview.isError && <Alert type="error" showIcon message={(preview.error as Error)?.message} />}
        {target?.kind === 'asset' && method && preview.data && (
          <>
            <Typography.Text type="secondary">Nilai buku saat berlaku {fmtMoney(preview.data.bookValueAtEffective)} · total 12 bulan: sekarang {fmtMoney(preview.data.total12.current)} → baru {fmtMoney(preview.data.total12.proposed)}</Typography.Text>
            <Table
              size="small"
              rowKey="period"
              pagination={false}
              dataSource={preview.data.rows}
              scroll={{ y: 200 }}
              columns={[
                { title: 'Bulan', dataIndex: 'period' },
                { title: 'Metode sekarang', dataIndex: 'current', align: 'right', render: fmtMoney },
                { title: 'Metode baru', dataIndex: 'proposed', align: 'right', render: fmtMoney },
              ]}
            />
          </>
        )}
      </Space>
    </Modal>
  );
}

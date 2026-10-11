import { FRAMEWORK_REFS, type InventoryMethod, type ReportingFramework } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Radio, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';

interface MethodInfo {
  method: InventoryMethod;
  framework: ReportingFramework;
  options: { key: InventoryMethod; label: string; how: string }[];
  guide: { recommended: InventoryMethod | null; notes: string[] };
}

/** Metode penentuan biaya persediaan: rata-rata bergerak atau MPKP/FIFO (LIFO tidak diakui SAK EP maupun SAK EMKM) */
export default function InventoryMethodCard() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const isAdmin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const { data } = useQuery({ queryKey: ['inventory-method'], queryFn: () => get<MethodInfo>('/settings/inventory-method') });
  const [value, setValue] = useState<InventoryMethod>('AVERAGE');
  useEffect(() => data && setValue(data.method), [data]);
  const save = useAction((method: InventoryMethod) => put<MethodInfo>('/settings/inventory-method', { method }), {
    success: 'Metode persediaan disimpan',
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-method'] });
      qc.invalidateQueries({ queryKey: ['notes'] });
    },
  });
  if (!data) return null;
  const std = FRAMEWORK_REFS[data.framework].inventory;
  return (
    <Card title="Metode biaya persediaan" extra={<Tag color="blue">{std}</Tag>}>
      <Typography.Paragraph type="secondary">
        Menentukan biaya barang yang keluar (harga pokok penjualan) dan nilai stok akhir. Berlaku untuk seluruh persediaan perusahaan dan tercantum otomatis di
        kebijakan akuntansi (CALK). Beralih metode tidak mengubah nilai stok yang sudah ada; metode baru dipakai untuk transaksi berikutnya.
      </Typography.Paragraph>
      <Radio.Group value={value} onChange={(e) => setValue(e.target.value)} disabled={!isAdmin} style={{ width: '100%' }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {data.options.map((o) => (
            <Radio key={o.key} value={o.key} style={{ alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 600 }}>
                {o.label} {data.guide.recommended === o.key && <Tag color="green">Disarankan</Tag>}
              </div>
              <div style={{ color: '#5B6477' }}>{o.how}</div>
            </Radio>
          ))}
        </Space>
      </Radio.Group>
      <Alert type="info" showIcon style={{ marginTop: 12 }} message={data.guide.notes.map((n) => <div key={n}>{n}</div>)} />
      {isAdmin && (
        <Button type="primary" style={{ marginTop: 16 }} disabled={value === data.method} loading={save.isPending} onClick={() => save.mutate(value)}>
          Simpan metode
        </Button>
      )}
    </Card>
  );
}

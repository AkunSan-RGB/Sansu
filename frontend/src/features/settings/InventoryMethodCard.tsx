import { FRAMEWORK_REFS, type InventoryMethod, type ReportingFramework } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InboxOutlined } from '@ant-design/icons';
import { Alert, Button, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { get, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import PolicyCard, { ChoiceCards } from './PolicyCard';

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
      void qc.invalidateQueries({ queryKey: ['inventory-method'] });
      void qc.invalidateQueries({ queryKey: ['notes'] });
    },
  });
  if (!data) return null;
  const std = FRAMEWORK_REFS[data.framework].inventory;
  return (
    <PolicyCard
      id="kebijakan-persediaan"
      icon={<InboxOutlined />}
      title="Metode biaya persediaan"
      tag={<Tag color="blue">{std}</Tag>}
      desc="Cara menghitung biaya barang yang keluar (harga pokok penjualan) dan nilai stok akhir. Tercantum otomatis di CALK. Beralih metode tidak mengubah nilai stok yang sudah ada; metode baru dipakai untuk transaksi berikutnya."
      footer={
        isAdmin ? (
          <Button type="primary" disabled={value === data.method} loading={save.isPending} onClick={() => save.mutate(value)}>
            Simpan metode
          </Button>
        ) : (
          <span style={{ opacity: 0.7 }}>Hanya Pemilik/Admin yang dapat mengubah.</span>
        )
      }
    >
      <ChoiceCards
        value={value}
        onChange={setValue}
        disabled={!isAdmin}
        options={data.options.map((o) => ({ value: o.key, title: o.label, desc: o.how, badge: data.guide.recommended === o.key ? <Tag color="green">Disarankan</Tag> : undefined }))}
      />
      <Alert type="info" showIcon style={{ marginTop: 14 }} message={data.guide.notes.map((n) => <div key={n}>{n}</div>)} />
    </PolicyCard>
  );
}

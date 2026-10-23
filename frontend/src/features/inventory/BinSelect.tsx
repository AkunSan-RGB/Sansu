import { useQuery } from '@tanstack/react-query';
import { Form, Select } from 'antd';
import { get, qs } from '@/api/client';

export interface BinOption { id: string; code: string; kind: string; isActive: boolean }

/** Rak aktif satu gudang; `enabled` false = gudang tidak memakai rak (atau pengguna tidak boleh melihatnya), pilihan rak tidak ditampilkan */
export function useWarehouseBins(warehouseId?: string) {
  const q = useQuery({
    queryKey: ['bins', 'list', warehouseId],
    queryFn: () => get<{ warehouse: { binsEnabled: boolean }; bins: BinOption[] }>(`/inventory/bins${qs({ warehouseId })}`),
    enabled: !!warehouseId,
    retry: false,
    staleTime: 60_000,
  });
  return { enabled: !!q.data?.warehouse.binsEnabled, bins: (q.data?.bins ?? []).filter((b) => b.isActive) };
}

const KIND: Record<string, string> = { DAMAGED: 'rusak', QUARANTINE: 'karantina', STAGING: 'penyiapan' };

/** Pilihan rak (kosong = otomatis: masuk BELUM-DITEMPATKAN / keluar mengikuti FEFO). Tidak menampilkan apa pun bila gudang tanpa rak. */
export default function BinSelect({ warehouseId, value, onChange, placeholder = 'Rak (otomatis)', width = 150 }: { warehouseId?: string; value?: string; onChange?: (v?: string) => void; placeholder?: string; width?: number }) {
  const { enabled, bins } = useWarehouseBins(warehouseId);
  if (!enabled) return null;
  return (
    <Select
      allowClear
      showSearch
      optionFilterProp="label"
      placeholder={placeholder}
      style={{ width }}
      value={value}
      onChange={onChange}
      options={bins.map((b) => ({ value: b.id, label: `${b.code}${KIND[b.kind] ? ` · ${KIND[b.kind]}` : ''}` }))}
    />
  );
}

/** Kolom form lengkap (label + pilihan rak); tidak muncul bila gudang tidak memakai rak */
export function BinFormItem({ warehouseId, name, label = 'Rak (opsional)', extra, placeholder, width = 260 }: { warehouseId?: string; name: string | (string | number)[]; label?: string; extra?: string; placeholder?: string; width?: number }) {
  const { enabled } = useWarehouseBins(warehouseId);
  if (!enabled) return null;
  return (
    <Form.Item name={name} label={label} extra={extra}>
      <BinSelect warehouseId={warehouseId} placeholder={placeholder} width={width} />
    </Form.Item>
  );
}

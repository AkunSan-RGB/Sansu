import { useQuery } from '@tanstack/react-query';
import { Select } from 'antd';
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

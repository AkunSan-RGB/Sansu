import { useQuery } from '@tanstack/react-query';
import { Select } from 'antd';
import { get } from '@/api/client';

const ROLE = { OWNER: 'Pemilik', ADMIN: 'Admin' } as Record<string, string>;

/** Pilihan penyetuju: hanya pengguna yang berwenang memutuskan (bukan pemohon sendiri) */
export default function ApproverSelect({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['approvers'], queryFn: () => get<{ id: string; name: string; role: string }[]>('/approvals/approvers'), staleTime: 60_000 });
  return (
    <Select
      allowClear
      style={{ width: '100%' }}
      loading={isLoading}
      value={value}
      onChange={onChange}
      placeholder="Semua penyetuju berwenang (default)"
      options={(data ?? []).map((a) => ({ value: a.id, label: `${a.name} · ${ROLE[a.role] ?? a.role}` }))}
    />
  );
}

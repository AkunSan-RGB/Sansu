import { ROLE_LABELS, type Role, type RoleCustomization, type RoleOption } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Input, Popconfirm, Space, Switch, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { del, get, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';

interface View { model: string; customization: RoleCustomization; catalog: RoleOption[]; baseline: RoleOption[] }
type Draft = Record<string, { label: string; offered: boolean }>;
const LOCKED: Role[] = ['OWNER', 'ADMIN'];

/**
 * Sebutan peran dan peran yang ditawarkan untuk perusahaan ini. Hanya soal nama dan siapa yang bisa diberi peran:
 * hak akses tiap peran tetap sama, dan perusahaan lain tidak terpengaruh.
 */
export default function RoleCustomizationCard() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const isAdmin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const q = useQuery({ queryKey: ['role-customization'], queryFn: () => get<View>('/settings/customization/roles') });
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => {
    if (!q.data) return;
    setDraft(Object.fromEntries(q.data.catalog.map((r) => [r.role, { label: q.data.customization.labels?.[r.role] ?? '', offered: r.offered }])));
  }, [q.data]);
  const done = () => { void qc.invalidateQueries({ queryKey: ['role-customization'] }); void qc.invalidateQueries({ queryKey: ['me'] }); };
  const save = useAction((body: RoleCustomization) => put('/settings/customization/roles', body), { success: 'Penyesuaian peran disimpan untuk perusahaan ini', onSuccess: done });
  const reset = useAction(() => del('/settings/customization/roles'), { success: 'Kembali mengikuti jenis usaha', onSuccess: done });
  if (!q.data) return null;
  const base = new Map(q.data.baseline.map((r) => [r.role, r]));
  const toBody = (): RoleCustomization => {
    const labels: Partial<Record<Role, string>> = {};
    const hidden: Role[] = [];
    const extra: Role[] = [];
    for (const r of q.data!.catalog) {
      const d = draft[r.role];
      if (!d) continue;
      const b = base.get(r.role)!;
      if (d.label.trim() && d.label.trim() !== b.label) labels[r.role] = d.label.trim();
      if (!d.offered && b.offered && !LOCKED.includes(r.role)) hidden.push(r.role);
      if (d.offered && !b.offered) extra.push(r.role);
    }
    return { labels, hidden, extra };
  };
  const customized = !!(q.data.customization.hidden?.length || q.data.customization.extra?.length || Object.keys(q.data.customization.labels ?? {}).length);
  return (
    <Card title="Peran & sebutan">
      <Typography.Paragraph type="secondary">
        Sebutan peran dan peran yang ditawarkan mengikuti jenis usaha Anda. Anda dapat menyesuaikannya untuk perusahaan ini saja: mengganti nama peran,
        menyembunyikan peran yang tidak dipakai, atau menambahkan peran yang tidak ditawarkan jenis usaha Anda. <b>Hak akses tiap peran tidak berubah</b> dan perusahaan lain tidak terpengaruh.
        Pengguna yang sudah memegang peran yang disembunyikan tidak berubah.
      </Typography.Paragraph>
      {customized && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Perusahaan ini memakai penyesuaian peran sendiri" description="Perubahan bawaan jenis usaha di versi baru tidak menimpa sebutan dan pilihan Anda di bawah." />}
      <Table<RoleOption>
        size="small"
        rowKey="role"
        pagination={false}
        dataSource={q.data.catalog}
        scroll={{ x: 760 }}
        columns={[
          { title: 'Peran dasar', render: (_: unknown, r: RoleOption) => ROLE_LABELS[r.role] },
          { title: 'Bawaan jenis usaha', render: (_: unknown, r: RoleOption) => base.get(r.role)?.label },
          { title: 'Sebutan di perusahaan ini', render: (_: unknown, r: RoleOption) => <Input disabled={!isAdmin} maxLength={40} style={{ width: 220 }} placeholder={base.get(r.role)?.label} value={draft[r.role]?.label ?? ''} onChange={(e) => setDraft({ ...draft, [r.role]: { ...draft[r.role], label: e.target.value } })} /> },
          { title: 'Ditawarkan', align: 'center', render: (_: unknown, r: RoleOption) => <Switch disabled={!isAdmin || LOCKED.includes(r.role)} checked={draft[r.role]?.offered ?? r.offered} onChange={(v) => setDraft({ ...draft, [r.role]: { ...draft[r.role], offered: v } })} /> },
          { title: 'Keterangan', render: (_: unknown, r: RoleOption) => <span style={{ fontSize: 12, color: '#64748b' }}>{r.desc ?? ''}</span> },
        ]}
      />
      {isAdmin && (
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" loading={save.isPending} onClick={() => save.mutate(toBody())}>Simpan penyesuaian</Button>
          {customized && (
            <Popconfirm title="Kembali mengikuti jenis usaha?" description="Sebutan dan pilihan peran perusahaan ini dihapus." okText="Kembalikan" onConfirm={() => reset.mutate(undefined)}>
              <Button loading={reset.isPending}>Kembalikan ke bawaan</Button>
            </Popconfirm>
          )}
        </Space>
      )}
    </Card>
  );
}

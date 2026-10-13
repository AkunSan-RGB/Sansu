import { useQueryClient } from '@tanstack/react-query';
import { Alert, Card, Space, Switch, Typography } from 'antd';
import { put } from '@/api/client';
import { useAction, useBranches } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';

/** Fitur cabang hanya untuk perusahaan yang memang punya cabang usaha */
export default function BranchFeatureCard() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const branches = useBranches();
  const hasAny = (branches.data?.branches.length ?? 0) > 0;
  const save = useAction((enabled: boolean) => put('/branches/feature', { enabled }), {
    success: 'Tersimpan',
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  return (
    <Card title="Cabang usaha" style={{ marginTop: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space>
          <Switch checked={!!me?.multiBranch} disabled={hasAny || save.isPending} onChange={(v) => save.mutate(v)} />
          <Typography.Text>Perusahaan ini punya cabang usaha</Typography.Text>
        </Space>
        <Typography.Text type="secondary">
          Nyalakan hanya bila usaha Anda punya lebih dari satu cabang/toko dengan pembukuan terpadu. Setelah menyala muncul menu Cabang & toko, pilihan cabang di karyawan, aset, dan kas, serta laporan Pusat / Cabang / Konsolidasi. Bila mati, semua itu tersembunyi dan SANSU bekerja seperti biasa.
        </Typography.Text>
        {hasAny && <Alert type="info" showIcon message="Sudah ada cabang, jadi fitur ini tetap menyala." />}
      </Space>
    </Card>
  );
}

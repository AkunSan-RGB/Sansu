import { isProductionModel, RECIPE_TERM_HINTS, RECIPE_TERMS } from '@sansu/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Card, Radio, Space, Typography } from 'antd';
import { patch } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';

/** Sebutan untuk "Resep" (BOM) disesuaikan dengan industri; berlaku di seluruh menu, halaman, dan Pusat Bantuan */
export default function RecipeTermCard() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const admin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const save = useAction((recipe: string) => patch('/settings/terms', { recipe }), {
    success: 'Istilah disimpan',
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  if (!isProductionModel(me?.businessModel)) return null;
  return (
    <Card title="Sebutan untuk Resep" style={{ marginTop: 16 }}>
      <Typography.Paragraph type="secondary">
        Daftar bahan yang dibutuhkan untuk membuat satu produk punya sebutan berbeda di tiap industri. Pilih yang paling akrab bagi tim Anda; semua menu dan halaman produksi ikut berubah.
      </Typography.Paragraph>
      <Radio.Group value={me?.recipeTerm ?? 'Resep'} disabled={!admin || save.isPending} onChange={(e) => save.mutate(e.target.value)}>
        <Space direction="vertical">
          {RECIPE_TERMS.map((r) => (
            <Radio key={r} value={r}>
              <b>{r}</b> <Typography.Text type="secondary">— {RECIPE_TERM_HINTS[r]}</Typography.Text>
            </Radio>
          ))}
        </Space>
      </Radio.Group>
    </Card>
  );
}

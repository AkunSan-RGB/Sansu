import { APP_BY_KEY, BUSINESS_MODEL_BY_KEY, type BusinessModel } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, message, Space, Steps, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import BusinessModelPicker from '@/components/BusinessModelPicker';

/** Model bisnis perusahaan: menentukan aplikasi yang disarankan & langkah panduan mulai */
export default function BusinessModelCard() {
  const { me, startDemo } = useAuth();
  const [reseeding, setReseeding] = useState(false);
  const biz = useQuery({ queryKey: ['onboarding', 'business'], queryFn: () => get<{ locked: boolean }>('/settings/business') });
  const locked = !!biz.data?.locked;
  const qc = useQueryClient();
  const [model, setModel] = useState<BusinessModel>(me?.businessModel ?? 'DAGANG');
  useEffect(() => setModel(me?.businessModel ?? 'DAGANG'), [me?.businessModel]);
  const info = BUSINESS_MODEL_BY_KEY[model];
  const missing = info.apps.filter((a) => !me?.apps.includes(a));
  const isAdmin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const save = useAction(
    (applyApps: boolean) => put<{ installed: string[] }>('/settings/business', { model, applyApps }),
    {
      success: (r) =>
        r.installed.length
          ? `Model bisnis disimpan · ${r.installed.length} aplikasi dinyalakan`
          : 'Model bisnis disimpan',
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['me'] });
        qc.invalidateQueries({ queryKey: ['onboarding'] });
        qc.invalidateQueries({ queryKey: ['onboarding', 'business'] });
        qc.invalidateQueries({ queryKey: ['apps'] });
        // bagan akun mendapat akun khusus model baru; laporan memakai istilah model baru
        for (const k of ['accounts', 'statements', 'notes', 'appendix', 'entity-profile']) qc.invalidateQueries({ queryKey: [k] });
      },
    },
  );
  const demo = !!me?.demo;
  const reseed = async () => {
    setReseeding(true);
    try {
      await startDemo(model);
      qc.clear();
      window.location.assign('/dashboard');
    } catch (e) {
      message.error((e as Error).message || 'Gagal membuat demo baru');
      setReseeding(false);
    }
  };
  const changed = model !== me?.businessModel;
  return (
    <Card title="Model bisnis">
      <Typography.Paragraph type="secondary">
        Menentukan aplikasi yang disarankan, langkah panduan mulai, akun khusus di bagan akun, dan istilah di laporan
        keuangan (mis. beban pokok penjualan atau beban pokok pendapatan). Jenis usaha dikunci begitu perusahaan
        punya transaksi, supaya data antar jenis usaha tidak tercampur. Semua aplikasi tetap bisa dinyalakan atau dimatikan di Pengaturan › Aplikasi.
      </Typography.Paragraph>
      {locked && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Jenis usaha dikunci"
          description={`Perusahaan ini sudah punya transaksi sebagai ${BUSINESS_MODEL_BY_KEY[me?.businessModel ?? 'DAGANG'].name}. Data antar jenis usaha tidak boleh tercampur. Untuk jenis usaha lain, buat perusahaan baru dengan data terpisah.`}
        />
      )}
      <BusinessModelPicker value={model} onChange={isAdmin && (!locked || demo) ? setModel : undefined} detailed />
      <div style={{ margin: '16px 0 8px', fontWeight: 600 }}>Alur yang dihubungkan SANSU</div>
      <Steps
        size="small"
        progressDot
        current={info.flow.length}
        items={info.flow.map((f) => ({ title: <span style={{ fontSize: 12 }}>{f}</span> }))}
      />
      {info.note && <Alert type="info" showIcon style={{ marginTop: 12 }} message={info.note} />}
      {demo && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="Ini perusahaan demo"
          description="Mengganti jenis usaha tidak mengubah barang, pelanggan, dan transaksi yang sudah ada. Untuk melihat contoh lengkap jenis usaha lain, buat demo baru; demo yang ini akan ditinggalkan dan dihapus otomatis."
          action={<Button type="primary" disabled={!changed} loading={reseeding} onClick={reseed}>Buat demo baru: {info.name}</Button>}
        />
      )}
      {isAdmin && !demo && !locked && (
        <Space wrap style={{ marginTop: 16 }}>
          {missing.length > 0 && (
            <Button type="primary" loading={save.isPending} onClick={() => save.mutate(true)}>
              Simpan & nyalakan {missing.map((a) => APP_BY_KEY[a].name).join(', ')}
            </Button>
          )}
          <Button
            type={missing.length ? 'default' : 'primary'}
            disabled={!changed}
            loading={save.isPending}
            onClick={() => save.mutate(false)}
          >
            Simpan
          </Button>
        </Space>
      )}
    </Card>
  );
}

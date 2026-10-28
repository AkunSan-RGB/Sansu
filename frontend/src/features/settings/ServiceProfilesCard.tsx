import { SERVICE_PROFILES, SERVICE_PROFILE_KEYS, type ServiceProfile } from '@sansu/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';

/** Profil layanan perusahaan Jasa: menentukan menu, istilah, jenis tagihan & biaya, akun khas, laporan, dan ubin dashboard. */
export default function ServiceProfilesCard() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const current = me?.serviceProfiles ?? [...SERVICE_PROFILE_KEYS];
  const [value, setValue] = useState<ServiceProfile[]>(current);
  useEffect(() => setValue(me?.serviceProfiles ?? [...SERVICE_PROFILE_KEYS]), [me?.serviceProfiles]);
  const isAdmin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const save = useAction((profiles: ServiceProfile[]) => put('/settings/business/service-profiles', { profiles }), {
    success: 'Profil layanan disimpan: menu, jenis tagihan, dan akun menyesuaikan',
    onSuccess: () => void qc.invalidateQueries(),
  });
  if (me?.businessModel !== 'JASA') return null;
  const same = value.length === current.length && value.every((v) => current.includes(v));
  return (
    <Card title="Profil layanan">
      <Typography.Paragraph type="secondary">
        Pilih jenis pekerjaan perusahaan Anda (boleh lebih dari satu). Menu, Ruang kerja, istilah, jenis tagihan dan jenis biaya, laporan, serta angka di
        beranda mengikuti profil yang dipilih. Satu profil = istilah khas profil itu (mis. kontraktor: "Pemberi kerja"). Akun pendapatan dan biaya khas profil
        ditambahkan ke bagan akun saat profil dipilih; akun dan data yang sudah ada tidak dihapus bila profil diganti.
      </Typography.Paragraph>
      <Checkbox.Group value={value} disabled={!isAdmin} onChange={(v) => setValue(v as ServiceProfile[])} style={{ width: '100%' }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {SERVICE_PROFILE_KEYS.map((k) => (
            <Checkbox key={k} value={k}>
              <b>{SERVICE_PROFILES[k].label}</b>
              <div style={{ fontSize: 12, color: '#64748b' }}>{SERVICE_PROFILES[k].desc}</div>
            </Checkbox>
          ))}
        </Space>
      </Checkbox.Group>
      {!value.length && <Alert type="warning" showIcon style={{ marginTop: 12 }} message="Pilih minimal satu profil" />}
      {isAdmin && (
        <Button type="primary" style={{ marginTop: 16 }} disabled={same || !value.length} loading={save.isPending} onClick={() => save.mutate(value)}>
          Simpan profil
        </Button>
      )}
    </Card>
  );
}

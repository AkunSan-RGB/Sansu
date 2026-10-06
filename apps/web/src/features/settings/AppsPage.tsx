import { CheckCircleFilled } from '@ant-design/icons';
import { APP_BY_KEY, type AppKey, BRAND } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, Popconfirm, Row, Space, Tag, Typography } from 'antd';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { AppItem } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { APP_ICONS } from '@/lib/apps';

/** Toko aplikasi: aktifkan hanya yang dibutuhkan perusahaan */
export default function AppsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['apps'], queryFn: () => get<AppItem[]>('/apps') });
  const after = () => qc.invalidateQueries({ queryKey: ['me'] });
  const install = useAction((k: string) => post<{ installed: AppKey[] }>(`/apps/${k}/install`), {
    success: (r) => `Diaktifkan: ${r.installed.map((k) => APP_BY_KEY[k].name).join(', ')}`,
    invalidate: ['apps'],
    onSuccess: after,
  });
  const uninstall = useAction((k: string) => post(`/apps/${k}/uninstall`), { success: 'Aplikasi dinonaktifkan', invalidate: ['apps'], onSuccess: after });

  const categories = [...new Set((data ?? []).map((a) => a.category))];

  return (
    <>
      <PageHeader title="Aplikasi" />
      <Typography.Paragraph type="secondary">
        Aktifkan aplikasi yang dipakai perusahaan Anda. Aplikasi pendukung ikut aktif otomatis. Menonaktifkan aplikasi tidak menghapus data — hanya
        menyembunyikan menu dan menutup aksesnya.
      </Typography.Paragraph>
      {categories.map((cat) => (
        <div key={cat} style={{ marginBottom: 24 }}>
          <Typography.Title level={5} style={{ textTransform: 'uppercase', letterSpacing: '.04em', color: BRAND.colors.primary }}>
            {cat}
          </Typography.Title>
          <Row gutter={[16, 16]}>
            {data
              ?.filter((a) => a.category === cat)
              .map((a) => (
                <Col key={a.key} xs={24} sm={12} lg={8}>
                  <Card loading={isLoading} style={{ height: '100%' }} styles={{ body: { display: 'flex', gap: 14 } }}>
                    <span
                      style={{ width: 52, height: 52, flex: 'none', borderRadius: 14, background: a.color, color: '#fff', fontSize: 26, display: 'grid', placeItems: 'center' }}
                    >
                      {APP_ICONS[a.key as AppKey]}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Space size={6} wrap>
                        <Typography.Text strong>{a.name}</Typography.Text>
                        {a.enabled && <Tag icon={<CheckCircleFilled />} color="success">Aktif</Tag>}
                        {a.core && <Tag>Inti</Tag>}
                      </Space>
                      <Typography.Paragraph type="secondary" style={{ margin: '4px 0 10px' }}>
                        {a.description}
                      </Typography.Paragraph>
                      {a.depends?.length ? (
                        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 10 }}>
                          Butuh: {a.depends.map((d) => APP_BY_KEY[d as AppKey].name).join(', ')}
                        </Typography.Paragraph>
                      ) : null}
                      {a.enabled ? (
                        !a.core && (
                          <Popconfirm title={`Nonaktifkan ${a.name}?`} description="Data tetap tersimpan." onConfirm={() => uninstall.mutate(a.key)}>
                            <Button size="small">Nonaktifkan</Button>
                          </Popconfirm>
                        )
                      ) : (
                        <Button type="primary" size="small" loading={install.isPending && install.variables === a.key} onClick={() => install.mutate(a.key)}>
                          Aktifkan
                        </Button>
                      )}
                    </div>
                  </Card>
                </Col>
              ))}
          </Row>
        </div>
      ))}
    </>
  );
}

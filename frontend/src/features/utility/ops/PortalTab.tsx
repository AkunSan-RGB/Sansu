import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtDate } from '@/lib/format';
import { ConnectionSelect } from './kit';

interface Link { exists: boolean; revoked: boolean; token: string | null; lastUsedAt: string | null; createdAt: string | null }

/** Portal pelanggan: tautan pribadi per sambungan (tanpa kata sandi) untuk melihat tagihan, riwayat pemakaian, dan mengirim pengaduan */
export function PortalTab() {
  const [connectionId, setConnectionId] = useState<string>();
  const q = useQuery({ queryKey: ['utility', 'portal', connectionId], queryFn: () => get<Link>(`/utility/portal/${connectionId}`), enabled: !!connectionId });
  const issue = useAction(() => post<Link>(`/utility/portal/${connectionId}`, {}), { success: 'Tautan dibuat', invalidate: ['utility'] });
  const revoke = useAction(() => post<Link>(`/utility/portal/${connectionId}/revoke`, {}), { success: 'Tautan dicabut', invalidate: ['utility'] });
  const l = q.data;
  const url = l?.token ? `${window.location.origin}/portal/air/${l.token}` : '';
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Pelanggan melayani dirinya sendiri" description="Berikan tautan ini ke pelanggan (WhatsApp/SMS/cetak). Siapa pun yang memegang tautan dapat melihat tagihan sambungan itu saja — bukan data lain. Bila tautan bocor atau pelanggan ganti, putar ulang atau cabut." />
      <Card size="small" style={{ maxWidth: 640 }}>
        <Form layout="vertical">
          <Form.Item label="Sambungan"><ConnectionSelect value={connectionId} onChange={setConnectionId} /></Form.Item>
        </Form>
        {connectionId && l && (
          <Space direction="vertical" style={{ width: '100%' }}>
            {l.token ? (
              <>
                <Input.TextArea readOnly autoSize value={url} onFocus={(e) => e.target.select()} />
                <Space wrap>
                  <Button type="primary" onClick={() => navigator.clipboard?.writeText(url)}>Salin tautan</Button>
                  <Button href={url} target="_blank" rel="noreferrer">Buka</Button>
                  <Button loading={issue.isPending} onClick={() => issue.mutate(undefined)}>Putar ulang (tautan lama mati)</Button>
                  <Button danger loading={revoke.isPending} onClick={() => revoke.mutate(undefined)}>Cabut</Button>
                </Space>
                <Typography.Text type="secondary">Dibuat {fmtDate(l.createdAt)} · {l.lastUsedAt ? `terakhir dibuka ${fmtDate(l.lastUsedAt)}` : 'belum pernah dibuka'}</Typography.Text>
              </>
            ) : (
              <>
                {l.revoked && <Tag color="red">Tautan sebelumnya sudah dicabut</Tag>}
                <Button type="primary" loading={issue.isPending} onClick={() => issue.mutate(undefined)}>Buat tautan portal</Button>
              </>
            )}
          </Space>
        )}
      </Card>
    </>
  );
}

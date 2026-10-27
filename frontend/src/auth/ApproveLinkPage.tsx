import { BRAND } from '@sansu/shared';
import { Alert, Button, Card, Descriptions, Input, Result, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import Logo from '@/brand/Logo';
import { fmtMoney } from '@/lib/format';

interface Summary {
  kind: 'AR' | 'PR';
  kindLabel: string;
  title: string;
  status: string;
  pending: boolean;
  requestedBy: string | null;
  approver: string;
  amount: number;
  details: string[];
  decisionNote: string | null;
}

const STATUS: Record<string, string> = { PENDING: 'Menunggu', SUBMITTED: 'Menunggu', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan', CONVERTED: 'Sudah jadi PO' };

/** Halaman persetujuan dari tautan email: tanpa login. Keputusan baru diambil saat tombol ditekan. */
export default function ApproveLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [s, setS] = useState<Summary>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string>();

  useEffect(() => {
    get<Summary>(`/public/approval-links/${token}`).then(setS, (e: Error) => setError(e.message));
  }, [token]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await post<{ status: string }>(`/public/approval-links/${token}/decide`, { approve, note: note.trim() || undefined });
      setDone(r.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: BRAND.colors.surface, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', gap: 24 }}>
      <Logo size={40} />
      <Card variant="borderless" style={{ width: '100%', maxWidth: 520, borderRadius: 16, boxShadow: '0 1px 2px rgba(10,10,10,0.04), 0 18px 48px -12px rgba(10,10,10,0.16)' }} styles={{ body: { padding: 28 } }}>
        {done ? (
          <Result status={done === 'APPROVED' ? 'success' : 'info'} title={done === 'APPROVED' ? 'Permintaan disetujui' : 'Permintaan ditolak'} subTitle="Keputusan Anda sudah tercatat dan peminta akan melihatnya di aplikasi. Halaman ini boleh ditutup." />
        ) : !s ? (
          error ? <Result status="warning" title="Tautan tidak bisa dibuka" subTitle={error} /> : <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Typography.Text type="secondary">{s.kindLabel}</Typography.Text>
              <Typography.Title level={4} style={{ margin: '4px 0 0' }}>
                {s.title}
              </Typography.Title>
            </div>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Diminta oleh">{s.requestedBy ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="Nilai">{s.amount ? fmtMoney(s.amount) : '-'}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={s.pending ? 'gold' : s.status === 'APPROVED' ? 'green' : s.status === 'REJECTED' ? 'red' : 'default'}>{STATUS[s.status] ?? s.status}</Tag>
              </Descriptions.Item>
            </Descriptions>
            {s.details.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {s.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            {error && <Alert type="error" showIcon message={error} />}
            {!s.pending ? (
              <Alert type="info" showIcon message={`Permintaan ini sudah diputuskan (${STATUS[s.status] ?? s.status}).${s.decisionNote ? ` Catatan: ${s.decisionNote}` : ''}`} />
            ) : rejecting ? (
              <>
                <Input.TextArea rows={3} maxLength={300} placeholder="Alasan penolakan (wajib)" value={note} onChange={(e) => setNote(e.target.value)} />
                <Space>
                  <Button danger type="primary" loading={busy} disabled={!note.trim()} onClick={() => decide(false)}>
                    Kirim penolakan
                  </Button>
                  <Button onClick={() => setRejecting(false)}>Kembali</Button>
                </Space>
              </>
            ) : (
              <Space wrap>
                <Button type="primary" size="large" loading={busy} onClick={() => decide(true)}>
                  Setujui
                </Button>
                <Button danger size="large" onClick={() => setRejecting(true)}>
                  Tolak
                </Button>
              </Space>
            )}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Tautan ini pribadi untuk {s.approver} dan berlaku 72 jam. Jangan diteruskan ke orang lain.
            </Typography.Text>
          </Space>
        )}
      </Card>
    </div>
  );
}

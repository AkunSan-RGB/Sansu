import { type BillingOverview } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { Billing } from './billing/Billing';

export default function BillingPage() {
  const { me } = useAuth();
  if (me?.subscription.enabled === false) {
    return (
      <>
        <PageHeader title="Langganan SANSU" />
        <Alert type="info" showIcon message="Langganan belum diaktifkan" description="SANSU masih dalam tahap uji, jadi semua fitur bisa dipakai tanpa batas waktu, batas pengguna, atau tagihan. Informasi paket akan muncul di sini saat langganan dibuka." />
      </>
    );
  }
  return <BillingContent />;
}

function BillingContent() {
  const q = useQuery({ queryKey: ['billing'], queryFn: () => get<BillingOverview>('/billing') });
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader title="Langganan SANSU" />
      {params.get('paid') && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Terima kasih. Status pembayaran diperbarui otomatis begitu gerbang pembayaran mengonfirmasi (biasanya beberapa detik)."
        />
      )}
      <QueryState q={q}>{(d) => <Billing d={d} />}</QueryState>
    </>
  );
}

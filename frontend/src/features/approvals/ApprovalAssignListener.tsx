import { Modal, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';
import ApproverSelect from './ApproverSelect';

/** Setelah transaksi menunggu persetujuan, tawarkan pemohon memilih penyetuju yang berwenang (bisa dilewati) */
export default function ApprovalAssignListener() {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [pick, setPick] = useState<string | undefined>();
  useEffect(() => {
    const h = (e: Event) => {
      setPick(undefined);
      setRequestId((e as CustomEvent<{ requestId: string }>).detail.requestId);
    };
    window.addEventListener('sansu:approval-required', h);
    return () => window.removeEventListener('sansu:approval-required', h);
  }, []);
  const assign = useAction((v: { id: string; approverId?: string }) => post(`/approvals/${v.id}/assign`, { approverId: v.approverId }), {
    success: 'Penyetuju dipilih — notifikasi dikirim',
    invalidate: ['approvals'],
    onSuccess: () => setRequestId(null),
  });
  return (
    <Modal title="Pilih penyetuju" open={!!requestId} onCancel={() => setRequestId(null)} okText="Kirim ke penyetuju ini" cancelText="Biarkan ke semua penyetuju"
      okButtonProps={{ disabled: !pick, loading: assign.isPending }} onOk={() => requestId && assign.mutate({ id: requestId, approverId: pick })} destroyOnHidden>
      <Typography.Paragraph>Transaksi ini menunggu persetujuan. Pilih siapa yang berwenang memutuskan; hanya pengguna berwenang yang ditampilkan.</Typography.Paragraph>
      <ApproverSelect value={pick} onChange={setPick} />
    </Modal>
  );
}

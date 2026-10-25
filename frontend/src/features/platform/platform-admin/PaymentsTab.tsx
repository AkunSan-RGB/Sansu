import { CheckOutlined, CloseOutlined, EyeOutlined, FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import { BILLING_STATUS_LABELS, type BillingInvoiceStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Input, Modal, Segmented, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { get, post, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtDate, fmtMoney } from '@/lib/format';
import BillingInvoiceModal from '../../billing/BillingInvoiceDoc';
import { t } from '@/lib/terms';
import { INV_COLOR, KEYS } from './shared';

interface PInvoice {
  id: string;
  number: string;
  tenantId: string;
  tenantName: string;
  planName: string;
  cycle: 'MONTHLY' | 'YEARLY';
  amount: string;
  status: BillingInvoiceStatus;
  method: string;
  hasProof: boolean;
  proofNote: string | null;
  rejectReason: string | null;
  paidAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
}

// ---------------- Pembayaran ----------------
export function PaymentsTab() {
  const { modal } = App.useApp();
  const [status, setStatus] = useState<string>('WAITING');
  const [proof, setProof] = useState<{ inv: PInvoice; data: string } | null>(null);
  const [rejecting, setRejecting] = useState<PInvoice | null>(null);
  const [reason, setReason] = useState('');
  const [doc, setDoc] = useState<string | null>(null);
  const q = useQuery({
    queryKey: [...KEYS, 'invoices', status],
    queryFn: () => get<PInvoice[]>(`/platform-admin/invoices${qs({ status })}`),
  });
  const confirm = useAction((id: string) => post(`/platform-admin/invoices/${id}/confirm`), {
    success: 'Pembayaran dikonfirmasi — langganan pelanggan sudah aktif',
    invalidate: KEYS,
    onSuccess: () => setProof(null),
  });
  const reject = useAction(
    (v: { id: string; reason: string }) => post(`/platform-admin/invoices/${v.id}/reject`, { reason: v.reason }),
    {
      success: 'Bukti ditolak, pelanggan diberi tahu lewat email',
      invalidate: KEYS,
      onSuccess: () => {
        setRejecting(null);
        setProof(null);
        setReason('');
      },
    },
  );
  const openProof = async (inv: PInvoice) =>
    setProof({ inv, data: (await get<{ proof: string }>(`/platform-admin/invoices/${inv.id}/proof`)).proof });
  const askConfirm = (inv: PInvoice) =>
    modal.confirm({
      title: `Konfirmasi pembayaran ${inv.number}?`,
      content: `Pastikan dana ${fmtMoney(inv.amount)} dari ${inv.tenantName} sudah masuk ke rekening. Langganan langsung diperpanjang.`,
      okText: 'Ya, sudah masuk',
      cancelText: 'Batal',
      onOk: () => confirm.mutateAsync(inv.id),
    });
  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={status}
          onChange={(v) => setStatus(String(v))}
          options={[
            { value: 'WAITING', label: 'Menunggu konfirmasi' },
            { value: 'UNPAID', label: 'Belum dibayar' },
            { value: 'PAID', label: 'Lunas' },
            { value: 'ALL', label: 'Semua' },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => q.refetch()} />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={q.data}
        scroll={{ x: 1000 }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Perusahaan', dataIndex: 'tenantName' },
          { title: 'Paket', render: (_, i) => `${i.planName} · ${i.cycle === 'YEARLY' ? 'tahunan' : 'bulanan'}` },
          { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
          { title: 'Cara', dataIndex: 'method', render: (m) => (m === 'MANUAL' ? 'Transfer' : m) },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (s: BillingInvoiceStatus, i) => (
              <>
                <Tag color={INV_COLOR[s]}>{BILLING_STATUS_LABELS[s]}</Tag>
                {i.confirmedBy && s === 'PAID' && (
                  <div style={{ fontSize: 11, color: '#6b7280' }}>oleh {i.confirmedBy}</div>
                )}
              </>
            ),
          },
          { title: 'Dibuat', dataIndex: 'createdAt', render: fmtDate },
          {
            title: '',
            align: 'right',
            render: (_, i) => (
              <Space>
                <Button size="small" icon={<FileTextOutlined />} onClick={() => setDoc(i.id)} aria-label="Invoice" />
                {i.hasProof && (
                  <Button size="small" icon={<EyeOutlined />} onClick={() => void openProof(i)}>
                    Bukti
                  </Button>
                )}
                {(i.status === 'WAITING' || i.status === 'UNPAID') && (
                  <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => askConfirm(i)}>
                    Konfirmasi
                  </Button>
                )}
                {i.status === 'WAITING' && (
                  <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejecting(i)}>
                    Tolak
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={!!proof}
        onCancel={() => setProof(null)}
        title={
          proof ? `Bukti transfer ${proof.inv.number} · ${proof.inv.tenantName} · ${fmtMoney(proof.inv.amount)}` : ''
        }
        width={720}
        footer={
          proof && (proof.inv.status === 'WAITING' || proof.inv.status === 'UNPAID') ? (
            <Space>
              <Button danger onClick={() => setRejecting(proof.inv)}>
                Tolak
              </Button>
              <Button type="primary" onClick={() => askConfirm(proof.inv)}>
                Konfirmasi lunas
              </Button>
            </Space>
          ) : null
        }
      >
        {proof?.inv.proofNote && (
          <Alert type="info" message={`Catatan pelanggan: ${proof.inv.proofNote}`} style={{ marginBottom: 12 }} />
        )}
        {proof?.data.startsWith('data:application/pdf') ? (
          <a href={proof.data} download={`bukti-${proof.inv.number.replace(/\//g, '-')}.pdf`}>
            Unduh bukti (PDF)
          </a>
        ) : (
          proof && (
            <img
              src={proof.data}
              alt="Bukti transfer"
              style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e3e8f0' }}
            />
          )
        )}
      </Modal>
      <Modal
        open={!!rejecting}
        title={`Tolak bukti ${rejecting?.number ?? ''}`}
        okText={t('Tolak & beri tahu pelanggan')}
        okButtonProps={{ danger: true, disabled: !reason.trim(), loading: reject.isPending }}
        onOk={() => rejecting && reject.mutate({ id: rejecting.id, reason })}
        onCancel={() => setRejecting(null)}
      >
        <Input.TextArea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Alasan, mis. nominal kurang Rp10.000 / foto tidak terbaca"
          maxLength={300}
        />
      </Modal>
      <BillingInvoiceModal id={doc} admin onClose={() => setDoc(null)} />
    </>
  );
}

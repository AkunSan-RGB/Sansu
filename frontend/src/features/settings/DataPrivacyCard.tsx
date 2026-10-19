import { CloudDownloadOutlined, DeleteOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Form, Input, Modal, Popconfirm, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { del, get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { fmtDate } from '@/lib/format';
import PolicyCard from './PolicyCard';

interface Status {
  graceDays: number;
  lastExportAt: string | null;
  deletion: { id: string; status: 'SCHEDULED' | 'ON_HOLD' | 'CANCELLED' | 'EXECUTED'; requestedAt: string; requestedByEmail: string; scheduledFor: string; exportWaived: boolean; exportDone: boolean; holdReason: string | null } | null;
}

/** Hak pemilik atas data perusahaannya: unduh seluruh data, dan minta penghapusan permanen dengan masa tenggang */
export default function DataPrivacyCard({ companyName }: { companyName: string }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const isOwner = me?.role === 'OWNER';
  const { data } = useQuery({ queryKey: ['company-data-status'], queryFn: () => get<Status>('/company-data/status') });
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exportForm] = Form.useForm<{ password: string; code?: string }>();
  const [deleteForm] = Form.useForm<{ password: string; code?: string; confirmName: string; reason?: string; ackRetention: boolean; exportWaived: boolean }>();
  const confirmName = Form.useWatch('confirmName', deleteForm);
  const ack = Form.useWatch('ackRetention', deleteForm);
  const waived = Form.useWatch('exportWaived', deleteForm);

  const exporter = useAction((v: { password: string; code?: string }) => post<{ path: string }>('/company-data/export', v), {
    success: 'Verifikasi berhasil. Unduhan arsip dimulai',
    onSuccess: (r) => {
      setExportOpen(false);
      exportForm.resetFields();
      window.location.assign(r.path); // browser mengunduh langsung ke disk (tanpa memuat seluruh arsip ke memori)
      window.setTimeout(() => qc.invalidateQueries({ queryKey: ['company-data-status'] }), 4000);
    },
  });
  const request = useAction((v: { password: string; code?: string; confirmName: string; reason?: string; ackRetention: boolean; exportWaived: boolean }) => post<Status>('/company-data/deletion', v), {
    success: 'Penghapusan data dijadwalkan. Anda dapat membatalkannya kapan saja sebelum tanggal itu',
    onSuccess: (r) => {
      setDeleteOpen(false);
      deleteForm.resetFields();
      qc.setQueryData(['company-data-status'], r);
    },
  });
  const cancel = useAction(() => del<Status>('/company-data/deletion'), { success: 'Penghapusan data dibatalkan', onSuccess: (r) => qc.setQueryData(['company-data-status'], r) });

  const req = data?.deletion;
  const name = companyName.trim();

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message="Data perusahaan Anda adalah milik Anda"
        description="Anda dapat mengunduh seluruh data kapan saja, dan meminta SANSU menghapusnya secara permanen. Kedua tindakan hanya untuk pemilik dan meminta verifikasi ulang kata sandi (serta kode 2 langkah bila aktif)."
      />

      <PolicyCard
        icon={<CloudDownloadOutlined />}
        title="Unduh seluruh data perusahaan"
        desc="Arsip ZIP berisi satu berkas CSV per tabel (transaksi, jurnal, stok, pelanggan, pemasok, karyawan, pengaturan, jejak audit) beserta manifest berisi jumlah baris dan checksum. Kata sandi, rahasia 2 langkah, dan token pihak ketiga tidak ikut."
      >
        <Space direction="vertical" size={8}>
          <Typography.Text type="secondary">
            {data?.lastExportAt ? `Terakhir diunduh: ${fmtDate(data.lastExportAt.slice(0, 10))}.` : 'Belum pernah diunduh.'} Tautan unduhan berlaku 5 menit dan hanya sekali pakai. Pemilik dan admin menerima pemberitahuan email setiap ekspor.
          </Typography.Text>
          <Button type="primary" icon={<CloudDownloadOutlined />} disabled={!isOwner} onClick={() => setExportOpen(true)}>
            Ekspor seluruh data
          </Button>
          {!isOwner && <Typography.Text type="secondary">Hanya pemilik perusahaan yang dapat mengekspor.</Typography.Text>}
        </Space>
      </PolicyCard>

      <PolicyCard
        icon={<DeleteOutlined />}
        title="Hapus seluruh data perusahaan"
        tag={req ? <Tag color={req.status === 'ON_HOLD' ? 'orange' : 'red'}>{req.status === 'ON_HOLD' ? 'Ditahan' : 'Terjadwal'}</Tag> : undefined}
        desc={`Penghapusan bersifat permanen dan tidak dapat dipulihkan. Ada masa tenggang ${data?.graceDays ?? 30} hari yang dapat dibatalkan, dan penghapusan baru berjalan setelah Anda mengunduh ekspor data (kecuali Anda memilih melewatinya).`}
      >
        {req ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type={req.status === 'ON_HOLD' ? 'warning' : 'error'}
              showIcon
              message={req.status === 'ON_HOLD' ? 'Penghapusan ditahan oleh pemilik layanan' : `Seluruh data akan dihapus permanen pada ${fmtDate(req.scheduledFor)}`}
              description={
                <>
                  Diminta oleh {req.requestedByEmail} pada {fmtDate(req.requestedAt.slice(0, 10))}.{' '}
                  {req.status === 'ON_HOLD'
                    ? `Alasan: ${req.holdReason ?? '-'}.`
                    : req.exportWaived
                      ? 'Dihapus tanpa menunggu ekspor.'
                      : req.exportDone
                        ? 'Ekspor data sudah diunduh.'
                        : 'Penghapusan menunggu ekspor data diunduh. Unduh ekspor di atas, atau batalkan permintaan ini.'}
                </>
              }
            />
            <Popconfirm title="Batalkan penghapusan data?" description="Data perusahaan Anda tetap aman dan tidak akan dihapus." okText="Ya, batalkan" cancelText="Tidak" onConfirm={() => cancel.mutate(undefined)}>
              <Button loading={cancel.isPending}>Batalkan penghapusan</Button>
            </Popconfirm>
          </Space>
        ) : (
          <Space direction="vertical" size={8}>
            <Typography.Text type="secondary">
              Peraturan perpajakan mewajibkan pembukuan dan dokumen pajak disimpan dalam jangka waktu tertentu. Bila Anda menghapus data di SANSU, Anda bertanggung jawab menyimpan arsip ekspornya.
            </Typography.Text>
            <Button danger icon={<DeleteOutlined />} disabled={!isOwner} onClick={() => setDeleteOpen(true)}>
              Minta penghapusan data
            </Button>
            {!isOwner && <Typography.Text type="secondary">Hanya pemilik perusahaan yang dapat meminta penghapusan.</Typography.Text>}
          </Space>
        )}
      </PolicyCard>

      <Modal title="Ekspor seluruh data" open={exportOpen} onCancel={() => setExportOpen(false)} okText="Verifikasi dan unduh" confirmLoading={exporter.isPending} onOk={() => exportForm.submit()} forceRender afterClose={() => exportForm.resetFields()}>
        <Form name="data-export" form={exportForm} layout="vertical" requiredMark={false} onFinish={(v) => exporter.mutate(v)}>
          <Typography.Paragraph type="secondary">Masukkan kata sandi Anda untuk memastikan ini benar-benar Anda.</Typography.Paragraph>
          <Form.Item name="password" label="Kata sandi" rules={[{ required: true, message: 'Wajib diisi' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="code" label="Kode verifikasi 2 langkah" extra="Isi bila verifikasi 2 langkah aktif di akun Anda (boleh kode cadangan).">
            <Input maxLength={20} autoComplete="one-time-code" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Minta penghapusan seluruh data perusahaan"
        open={deleteOpen}
        onCancel={() => setDeleteOpen(false)}
        okText="Jadwalkan penghapusan"
        okButtonProps={{ danger: true, disabled: confirmName?.trim() !== name || !ack }}
        confirmLoading={request.isPending}
        onOk={() => deleteForm.submit()}
        forceRender
        afterClose={() => deleteForm.resetFields()}
        width={560}
      >
        <Form name="data-deletion" form={deleteForm} layout="vertical" requiredMark={false} onFinish={(v) => request.mutate({ ...v, exportWaived: !!v.exportWaived, ackRetention: !!v.ackRetention })} initialValues={{ exportWaived: false, ackRetention: false }}>
          <Alert type="error" showIcon style={{ marginBottom: 16 }} message="Seluruh data akan hilang permanen" description={`Setelah ${data?.graceDays ?? 30} hari, semua transaksi, jurnal, stok, pelanggan, karyawan, dan pengguna perusahaan ini dihapus dan tidak dapat dipulihkan. Anda dan admin akan diberi tahu lewat email, dan dapat membatalkan sebelum tanggal itu.`} />
          <Form.Item name="confirmName" label={`Ketik nama perusahaan untuk melanjutkan: ${name}`} rules={[{ required: true, message: 'Wajib diisi' }]}>
            <Input placeholder={name} autoComplete="off" />
          </Form.Item>
          <Form.Item name="reason" label="Alasan (opsional)">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item name="password" label="Kata sandi" rules={[{ required: true, message: 'Wajib diisi' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="code" label="Kode verifikasi 2 langkah" extra="Isi bila verifikasi 2 langkah aktif di akun Anda.">
            <Input maxLength={20} autoComplete="one-time-code" />
          </Form.Item>
          <Form.Item name="ackRetention" valuePropName="checked" rules={[{ validator: (_, v) => (v ? Promise.resolve() : Promise.reject(new Error('Wajib dicentang'))) }]}>
            <Checkbox>Saya memahami bahwa pembukuan dan dokumen pajak wajib disimpan sesuai peraturan, dan saya bertanggung jawab menyimpan arsip ekspornya sendiri.</Checkbox>
          </Form.Item>
          <Form.Item name="exportWaived" valuePropName="checked" extra={waived ? 'Penghapusan akan berjalan pada tanggal jadwal walau Anda belum mengunduh ekspor.' : 'Bila tidak dicentang, penghapusan menunggu sampai Anda mengunduh ekspor data.'}>
            <Checkbox>Hapus tanpa menunggu ekspor data (tidak disarankan)</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

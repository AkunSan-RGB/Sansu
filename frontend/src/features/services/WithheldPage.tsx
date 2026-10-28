/** PPh yang dipotong pelanggan: daftar & pencatatan nomor bukti potong (syarat kredit pajak) */
import { withheldParty, type WithheldByCustomerReport, type WithheldByCustomerRow } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Form, Input, Modal, Segmented, Select, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, put, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { t } from '@/lib/terms';

const TYPE_LABEL = { PPH23: 'PPh 23', PPH4_2: 'PPh 4(2) final' } as const;

/** Tab "Dipotong <pihak>" di halaman Rekap pajak (embedded) atau halaman sendiri untuk peran yang tidak memegang Akuntansi */
export function WithheldRecap({ embedded }: { embedded?: boolean }) {
  const { me } = useAuth();
  // sebutan pihak yang memotong mengikuti jenis usaha: klien, pemberi kerja, pengguna jasa, pemesan, pelanggan
  const party = withheldParty(me?.businessModel ?? 'DAGANG', me?.serviceProfiles);
  const navigate = useNavigate();
  const can = useCan();
  const [year, setYear] = useState(dayjs().year());
  const [month, setMonth] = useState<number | null>(null);
  const [view, setView] = useState<'ALL' | 'MISSING'>('ALL');
  const [slip, setSlip] = useState<WithheldByCustomerRow | null>(null);
  const period = month ? `${year}-${String(month).padStart(2, '0')}` : String(year);
  const q = useQuery({
    queryKey: ['withheld', period],
    queryFn: () => get<WithheldByCustomerReport>(`/services/withheld${qs({ period })}`),
  });
  const [form] = Form.useForm();
  const save = useAction(
    (v: { slipNo: string; slipDate: string }) => put(`/services/invoices/${slip!.invoiceId}/withholding-slip`, v),
    {
      success: 'Bukti potong dicatat',
      invalidate: ['withheld', 'invoice', 'health'],
      onSuccess: () => setSlip(null),
    },
  );
  const total = (t: 'PPH23' | 'PPH4_2') => q.data?.totals.find((x) => x.type === t);

  const tools = (
    <Space>
      <Select
        value={year}
        onChange={setYear}
        style={{ width: 100 }}
        options={[0, 1, 2, 3].map((i) => ({ value: dayjs().year() - i, label: dayjs().year() - i }))}
      />
      <Select
        allowClear
        placeholder="Setahun"
        value={month}
        onChange={(v) => setMonth(v ?? null)}
        style={{ width: 130 }}
        options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: dayjs().month(i).format('MMMM') }))}
      />
    </Space>
  );
  return (
    <>
      {embedded ? <div style={{ marginBottom: 12 }}>{tools}</div> : <PageHeader title={`PPh dipotong ${party}`} extra={tools} />}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={`PPh 23 yang dipotong ${party} adalah kredit pajak Anda`}
        description={`Nilainya mengurangi PPh Badan terutang di SPT Tahunan (dicatat di akun Pajak Dibayar Dimuka) — syaratnya ada bukti potong dari ${party}; cocokkan dengan bukti potong di Coretax lalu catat nomornya di sini. PPh 4(2) (jasa konstruksi, sewa) bersifat final: tercatat sebagai beban PPh final dan pendapatannya dikeluarkan dari PPh tarif umum.`}
      />
      {!q.isLoading && !!q.data?.rows.length && (
        <SummaryCards
          items={[
            { label: 'PPh 23 dipotong (kredit pajak)', value: fmtMoney(total('PPH23')?.amount) },
            { label: 'Bukti potong PPh 23 belum dicatat', value: String(total('PPH23')?.missingSlips ?? 0), tone: total('PPH23')?.missingSlips ? 'warn' : 'neutral', hint: 'perlu dicocokkan dengan Coretax' },
            { label: 'PPh 4(2) final dipotong', value: fmtMoney(total('PPH4_2')?.amount), hint: `DPP terkait ${fmtMoney((q.data?.totals ?? []).reduce((a, x) => a + Number(x.base), 0))}` },
          ]}
        />
      )}
      <Card>
        <Segmented
          style={{ marginBottom: 12, maxWidth: '100%' }}
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { value: 'ALL', label: `Semua (${q.data?.rows.length ?? 0})` },
            { value: 'MISSING', label: `Belum ada bukti potong (${q.data?.rows.filter((r) => !r.slipNo).length ?? 0})` },
          ]}
        />
        <ResponsiveTable<WithheldByCustomerRow>
          rowKey="invoiceId"
          size="small"
          loading={q.isLoading}
          dataSource={view === 'MISSING' ? q.data?.rows.filter((r) => !r.slipNo) : q.data?.rows}
          scroll={{ x: 1000 }}
          locale={{ emptyText: <Empty description={view === 'MISSING' ? 'Semua bukti potong sudah dicatat' : 'Tidak ada faktur yang dipotong PPh pada periode ini'} /> }}
          columns={[
            {
              title: t('Faktur'),
              dataIndex: 'number',
              render: (v, r) => <a onClick={() => navigate(`/invoices/${r.invoiceId}`)}>{v}</a>,
            },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: party.charAt(0).toUpperCase() + party.slice(1), dataIndex: 'customer' },
            { title: 'NPWP pemotong', dataIndex: 'customerNpwp', render: (v) => v ?? <Tag color="orange">kosong</Tag> },
            { title: 'Jenis', dataIndex: 'type', render: (t: keyof typeof TYPE_LABEL) => TYPE_LABEL[t] },
            { title: 'Tarif', dataIndex: 'rate', align: 'right', render: (v) => `${Number(v)}%` },
            { title: 'DPP', dataIndex: 'base', align: 'right', render: fmtMoney },
            { title: 'PPh', dataIndex: 'amount', align: 'right', render: fmtMoney },
            {
              title: 'Bukti potong',
              render: (_, r) =>
                r.slipNo ? (
                  <span>
                    {r.slipNo} · {fmtDate(r.slipDate)}
                  </span>
                ) : can('PUT', '/services/invoices/:id/withholding-slip') ? (
                  <Button
                    size="small"
                    onClick={() => {
                      form.setFieldsValue({ slipNo: undefined, slipDate: today() });
                      setSlip(r);
                    }}
                  >
                    Catat
                  </Button>
                ) : (
                  '-'
                ),
            },
          ]}
        />
      </Card>
      <Modal
        title={`Bukti potong ${slip?.number ?? ''}`}
        open={!!slip}
        onCancel={() => setSlip(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="slipNo" label="Nomor bukti potong" rules={[{ required: true, min: 3 }]}>
            <Input placeholder={`Nomor dari Coretax / bukti potong ${party}`} />
          </Form.Item>
          <Form.Item name="slipDate" label="Tanggal bukti potong" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function WithheldPage() {
  return <WithheldRecap />;
}

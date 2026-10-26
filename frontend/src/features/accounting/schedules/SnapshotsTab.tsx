import { SafetyCertificateOutlined } from '@ant-design/icons';
import { canBookkeep } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Empty, Form, Input, Modal, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import type { SnapshotCompare, SnapshotListItem } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import { fmtDate, fmtMoney } from '@/lib/format';

const TOTAL_LABEL = { assets: 'Total aset', liabilities: 'Total liabilitas', equity: 'Total ekuitas', netIncome: 'Laba (rugi) bersih' } as const;
const delta = (v: string) => (Number(v) === 0 ? <Tag color="green">Tetap</Tag> : <Tag color="red">{fmtMoney(v)}</Tag>);

/**
 * Laporan keuangan yang dibekukan saat ditandatangani. Rekaman tidak dapat diubah; pembukuan sesudahnya dibandingkan
 * dengan angka yang ditandatangani (selisih per akun dan jurnal susulan) sebagai bahan untuk auditor.
 */
export default function SnapshotsTab({ year }: { year: number }) {
  const { me } = useAuth();
  const [version, setVersion] = useState<number | undefined>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ note?: string }>();
  const list = useQuery({ queryKey: ['account-schedules', 'snapshots', year], queryFn: () => get<SnapshotListItem[]>(`/account-schedules/snapshots${qs({ year: String(year) })}`) });
  const has = (list.data?.length ?? 0) > 0;
  const cmp = useQuery({
    queryKey: ['account-schedules', 'snapshots', 'compare', year, version, list.data?.length],
    queryFn: () => get<SnapshotCompare>(`/account-schedules/snapshots/compare${qs({ year: String(year), version: version ? String(version) : undefined })}`),
    enabled: has,
  });
  const freeze = useAction((v: { note?: string }) => post('/account-schedules/snapshots', { year, note: v.note }), {
    success: `Laporan ${year} dibekukan`,
    invalidate: ['account-schedules'],
    onSuccess: () => {
      setOpen(false);
      setVersion(undefined);
      form.resetFields();
    },
  });
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Bekukan angka laporan keuangan saat ditandatangani"
        description="Angka tiap akun dan total laporan disimpan sebagai rekaman yang tidak dapat diubah. Bila ada jurnal susulan sesudahnya, selisihnya tampil di sini sehingga laporan yang ditandatangani tetap dapat dibuktikan kepada auditor."
        action={
          canBookkeep(me?.role) ? (
            <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setOpen(true)}>
              Bekukan laporan {year}
            </Button>
          ) : undefined
        }
      />
      <QueryState q={list}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty description={`Laporan ${year} belum dibekukan`} />
          ) : (
            <Table<SnapshotListItem>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={rows}
              style={{ marginBottom: 16 }}
              columns={[
                { title: 'Versi', dataIndex: 'version', width: 80 },
                { title: 'Dibekukan oleh', dataIndex: 'signedByName' },
                { title: 'Waktu', dataIndex: 'signedAt', render: (v: string) => fmtDate(v) },
                { title: 'Catatan', dataIndex: 'note', render: (v: string | null) => v ?? '-' },
                { title: 'Hash isi', dataIndex: 'contentHash', render: (v: string) => <Typography.Text copyable={{ text: v }} code>{v.slice(0, 12)}…</Typography.Text> },
                { title: '', render: (_: unknown, r) => <Button size="small" type={(version ?? rows[0].version) === r.version ? 'primary' : 'default'} onClick={() => setVersion(r.version)}>Bandingkan</Button> },
              ]}
            />
          )
        }
      </QueryState>
      {has && (
        <QueryState q={cmp}>
          {(c) => (
            <Card title={`Perbandingan dengan pembukuan terkini · versi ${c.snapshot.version}`}>
              <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="Dibekukan">{`${fmtDate(c.snapshot.signedAt)} oleh ${c.snapshot.signedByName}`}</Descriptions.Item>
                <Descriptions.Item label="Keutuhan isi">{c.intact ? <Tag color="green">Hash cocok</Tag> : <Tag color="red">Isi tidak sesuai hash</Tag>}</Descriptions.Item>
                <Descriptions.Item label="Status">{c.unchanged ? <Tag color="green">Tidak ada perubahan sejak dibekukan</Tag> : <Tag color="orange">Ada perubahan sejak dibekukan</Tag>}</Descriptions.Item>
                <Descriptions.Item label="Periode">{c.snapshot.periodClosed ? 'Sudah berakhir saat dibekukan' : 'Belum berakhir saat dibekukan'}</Descriptions.Item>
              </Descriptions>
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={c.totals}
                style={{ marginBottom: 16 }}
                columns={[
                  { title: 'Total laporan', dataIndex: 'key', render: (k: keyof typeof TOTAL_LABEL) => TOTAL_LABEL[k] },
                  { title: 'Dibekukan', dataIndex: 'frozen', align: 'right', render: fmtMoney },
                  { title: 'Sekarang', dataIndex: 'current', align: 'right', render: fmtMoney },
                  { title: 'Selisih', dataIndex: 'delta', align: 'right', render: delta },
                ]}
              />
              {c.accounts.length > 0 && (
                <>
                  <Typography.Title level={5}>Akun yang berubah ({c.accounts.length} dari {c.accountsCompared})</Typography.Title>
                  <Table
                    size="small"
                    rowKey="accountId"
                    pagination={{ pageSize: 20, hideOnSinglePage: true }}
                    dataSource={c.accounts}
                    style={{ marginBottom: 16 }}
                    columns={[
                      { title: 'Kode', dataIndex: 'code', width: 90 },
                      { title: 'Akun', dataIndex: 'name' },
                      { title: 'Dibekukan', dataIndex: 'frozen', align: 'right', render: fmtMoney },
                      { title: 'Sekarang', dataIndex: 'current', align: 'right', render: fmtMoney },
                      { title: 'Selisih', dataIndex: 'delta', align: 'right', render: delta },
                    ]}
                  />
                </>
              )}
              {c.lateJournals.length > 0 && (
                <>
                  <Typography.Title level={5}>Jurnal susulan sesudah dibekukan ({c.lateJournals.length})</Typography.Title>
                  <Table
                    size="small"
                    rowKey="number"
                    pagination={{ pageSize: 20, hideOnSinglePage: true }}
                    dataSource={c.lateJournals}
                    columns={[
                      { title: 'No. jurnal', dataIndex: 'number', render: (n: string) => <Link to={`/journals?q=${encodeURIComponent(n)}`}>{n}</Link> },
                      { title: 'Tanggal', dataIndex: 'date', render: (v: string) => fmtDate(v) },
                      { title: 'Keterangan', dataIndex: 'description' },
                      { title: 'Sumber', dataIndex: 'source' },
                      { title: 'Dibukukan', dataIndex: 'createdAt', render: (v: string) => fmtDate(v) },
                      { title: 'Jumlah', dataIndex: 'total', align: 'right', render: fmtMoney },
                    ]}
                  />
                </>
              )}
            </Card>
          )}
        </QueryState>
      )}
      <Modal title={`Bekukan laporan keuangan ${year}`} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Bekukan" confirmLoading={freeze.isPending}>
        <Typography.Paragraph type="secondary">Angka laporan {year} saat ini disimpan dan tidak dapat diubah atau dihapus. Membekukan lagi membuat versi baru.</Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(v) => freeze.mutate(v)}>
          <Form.Item name="note" label="Catatan (opsional)" extra="Mis. penandatangan dan nomor persetujuan RUPS atau direksi.">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

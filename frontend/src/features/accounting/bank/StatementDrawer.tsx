import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Drawer, Empty, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { canHandleMoney, CASH_IN_SOURCES } from '@sansu/shared';
import { useAuth } from '@/auth/AuthContext';
import { useAccounts, useAction } from '@/api/queries';
import type { BankCandidate, BankLineStatus, BankStatement, BankStatementLine } from '@/api/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { KEYS, signed } from './shared';

const STATUS: Record<BankLineStatus, { color: string; label: string }> = {
  UNMATCHED: { color: 'orange', label: 'Belum cocok' },
  MATCHED: { color: 'green', label: 'Cocok' },
  CREATED: { color: 'blue', label: 'Dijurnal' },
  IGNORED: { color: 'default', label: 'Diabaikan' },
};

export function StatementDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const money = canHandleMoney(useAuth().me?.role);
  const accounts = useAccounts();
  const [filter, setFilter] = useState<BankLineStatus | 'ALL'>('ALL');
  const [creating, setCreating] = useState<BankStatementLine | null>(null);
  const [matching, setMatching] = useState<BankStatementLine | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [form] = Form.useForm();
  const st = useQuery({ queryKey: ['bank', 'statement', id], queryFn: () => get<BankStatement>(`/bank/statements/${id}`), enabled: !!id });
  const cand = useQuery({ queryKey: ['bank', 'candidates', matching?.id], queryFn: () => get<BankCandidate[]>(`/bank/lines/${matching!.id}/candidates`), enabled: !!matching });
  const auto = useAction(() => post<{ matched: number }>(`/bank/statements/${id}/auto-match`), { success: (r) => `${r.matched} mutasi baru cocok`, invalidate: KEYS });
  const create = useAction((v: { accountId: string; description?: string }) => post<{ journalNumber: string }>(`/bank/lines/${creating!.id}/create`, v.accountId.startsWith('src:') ? { source: v.accountId.slice(4), description: v.description } : v), {
    success: (r) => `Jurnal ${r.journalNumber} dibuat`,
    invalidate: KEYS,
    onSuccess: () => setCreating(null),
  });
  const match = useAction((journalLineId: string) => post(`/bank/lines/${matching!.id}/match`, { journalLineId }), {
    success: 'Dicocokkan',
    invalidate: KEYS,
    onSuccess: () => setMatching(null),
  });
  const matchMany = useAction((journalLineIds: string[]) => post(`/bank/lines/${matching!.id}/match-many`, { journalLineIds }), {
    success: 'Beberapa transaksi dicocokkan dengan satu mutasi',
    invalidate: KEYS,
    onSuccess: () => setMatching(null),
  });
  const action = useAction(({ line, act }: { line: string; act: 'unmatch' | 'ignore' }) => post(`/bank/lines/${line}/${act}`), { invalidate: KEYS });
  const [ignoring, setIgnoring] = useState<BankStatementLine | null>(null);
  const [ignoreForm] = Form.useForm<{ reason: string }>();
  const ignore = useAction((v: { reason: string }) => post(`/bank/lines/${ignoring!.id}/ignore`, v), { success: 'Mutasi diabaikan (tercatat di jejak audit)', invalidate: KEYS, onSuccess: () => setIgnoring(null) });
  const d = st.data;
  const byKey = (k: string) => accounts.data?.find((a) => a.systemKey === k)?.id;
  const meRole = useAuth().me?.role;
  const accountOpts = accounts.data?.filter((a) => a.isPostable && a.id !== d?.cashAccount.id).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })) ?? [];
  // Uang masuk: Keuangan memilih sumber uang (sistem menentukan akun); akun pembukuan hanya Pemilik/Admin. Uang keluar tetap memilih akun.
  const incoming = !!creating && Number(creating.amount) > 0;
  const sourceOpts = CASH_IN_SOURCES.map((s) => ({ value: `src:${s.key}`, label: `${s.label} — ${s.hint}` }));
  const counterOptions = incoming ? (meRole && ['OWNER', 'ADMIN'].includes(meRole) ? [{ label: 'Sumber uang (disarankan)', options: sourceOpts }, { label: 'Akun pembukuan (khusus Pemilik/Admin)', options: accountOpts }] : sourceOpts) : accountOpts;
  const rows = d?.lines.filter((l) => filter === 'ALL' || l.status === filter) ?? [];

  return (
    <Drawer title={d ? `${d.cashAccount.name} · ${fmtDate(d.periodFrom)} – ${fmtDate(d.periodTo)}` : 'Rekening koran'} open={!!id} onClose={onClose} width={1100}>
      {d && (
        <>
          <Row gutter={16} style={{ marginBottom: 12 }}>
            {(Object.keys(STATUS) as BankLineStatus[]).map((k) => (
              <Col xs={12} md={6} key={k}>
                <Card size="small" hoverable onClick={() => setFilter(filter === k ? 'ALL' : k)} style={{ borderColor: filter === k ? '#1677ff' : undefined }}>
                  <Statistic title={STATUS[k].label} value={d.summary.counts[k] ?? 0} />
                </Card>
              </Col>
            ))}
          </Row>
          <Space style={{ marginBottom: 12 }} wrap>
            {money && (
              <Button icon={<ReloadOutlined />} loading={auto.isPending} onClick={() => auto.mutate(undefined)}>
                Cocokkan otomatis lagi
              </Button>
            )}
            <Typography.Text type="secondary">
              Masuk {fmtMoney(d.summary.totalIn)} · keluar {fmtMoney(-Number(d.summary.totalOut))}
              {d.closingBalance && ` · saldo akhir bank ${fmtMoney(d.closingBalance)}`}
            </Typography.Text>
          </Space>
          <Table
            size="small"
            rowKey="id"
            dataSource={rows}
            pagination={{ pageSize: 50, hideOnSinglePage: true }}
            scroll={{ x: 1000 }}
            columns={[
              { title: 'Tanggal', dataIndex: 'date', render: fmtDate, width: 105 },
              { title: 'Keterangan bank', dataIndex: 'description', ellipsis: true },
              { title: 'Mutasi', dataIndex: 'amount', align: 'right', render: signed, width: 150 },
              { title: 'Status', dataIndex: 'status', width: 110, render: (s: BankLineStatus) => <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag> },
              {
                title: 'Transaksi di buku',
                render: (_, l) =>
                  l.book ? (
                    <span>
                      <Typography.Text code>{l.book.number}</Typography.Text> {fmtDate(l.book.date)} · <Typography.Text type="secondary">{l.book.description}</Typography.Text>
                    </span>
                  ) : null,
                ellipsis: true,
              },
              {
                width: 250,
                render: (_, l) =>
                  !money ? null : l.status === 'UNMATCHED' ? (
                    <Space size={4}>
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => {
                          const neg = Number(l.amount) < 0;
                          const text = l.description.toUpperCase();
                          const guess = /BIAYA|ADM|CHARGE|FEE/.test(text) ? byKey('BANK_CHARGES') : /BUNGA|JASA GIRO|INTEREST/.test(text) ? byKey('INTEREST_INCOME') : undefined;
                          form.setFieldsValue({ accountId: guess ?? (neg ? byKey('BANK_CHARGES') : undefined), description: l.description });
                          setCreating(l);
                        }}
                      >
                        Buat jurnal
                      </Button>
                      <Button size="small" onClick={() => setMatching(l)}>
                        Cocokkan
                      </Button>
                      <Button size="small" type="text" onClick={() => { ignoreForm.resetFields(); setIgnoring(l); }}>
                        Abaikan
                      </Button>
                    </Space>
                  ) : l.status === 'MATCHED' || l.status === 'IGNORED' ? (
                    <Button size="small" type="link" onClick={() => action.mutate({ line: l.id, act: 'unmatch' })}>
                      Batalkan
                    </Button>
                  ) : null,
              },
            ]}
          />
        </>
      )}
      <Modal title="Abaikan mutasi bank" open={!!ignoring} onCancel={() => setIgnoring(null)} onOk={() => ignoreForm.submit()} confirmLoading={ignore.isPending} okText="Abaikan">
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Mutasi yang diabaikan tidak ikut rekonsiliasi. Uang keluar hanya boleh diabaikan Pemilik/Admin. Alasan tercatat di jejak audit." />
        <Form form={ignoreForm} layout="vertical" onFinish={(v) => ignore.mutate(v)}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Isi alasan (min. 5 karakter)' }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title="Buat jurnal dari mutasi bank" open={!!creating} onCancel={() => setCreating(null)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Posting">
        {creating && (
          <Typography.Paragraph>
            {fmtDate(creating.date)} · {creating.description} · {signed(creating.amount)}
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="accountId" label={incoming ? 'Sumber uang masuk' : 'Akun lawan'} rules={[{ required: true }]} extra={incoming ? 'Pilih dari mana uang ini berasal; sistem membuat jurnalnya. Pembayaran pelanggan dicocokkan dengan faktur, bukan dibuat di sini.' : 'Biaya admin → Beban Administrasi Bank; pajak bank → Beban Pajak.'}>
            <Select showSearch optionFilterProp="label" options={counterOptions as never} />
          </Form.Item>
          <Form.Item name="description" label="Keterangan jurnal">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title="Cocokkan dengan transaksi di buku" open={!!matching} onCancel={() => setMatching(null)} afterClose={() => setPicked([])} footer={null} width={860}>
        {matching && (
          <Typography.Paragraph>
            Mutasi bank: {fmtDate(matching.date)} · {matching.description} · {signed(matching.amount)}
          </Typography.Paragraph>
        )}
        {matching && (() => {
          const sum = (cand.data ?? []).filter((c) => picked.includes(c.id)).reduce((a, c) => a + Number(c.amount), 0);
          const target = Number(matching.amount);
          const ok = picked.length >= 2 && Math.abs(sum - target) < 0.005;
          return (
            <Alert
              type={ok ? 'success' : 'info'}
              showIcon
              style={{ marginBottom: 8 }}
              message="Satu mutasi untuk beberapa transaksi (mis. setoran gabungan atau satu transfer untuk beberapa faktur)"
              description={
                <span>
                  Centang beberapa transaksi di bawah; jumlahnya harus persis {signed(matching.amount)}. Terpilih: {picked.length} transaksi, {signed(sum)}.{' '}
                  <Button size="small" type="primary" disabled={!ok} loading={matchMany.isPending} onClick={() => matchMany.mutate(picked)}>
                    Cocokkan yang dipilih
                  </Button>
                </span>
              }
            />
          );
        })()}
        <Table
          size="small"
          rowKey="id"
          loading={cand.isLoading}
          dataSource={cand.data}
          pagination={false}
          rowSelection={{ selectedRowKeys: picked, onChange: (keys) => setPicked(keys as string[]) }}
          locale={{ emptyText: <Empty description="Tidak ada transaksi buku yang belum dicocokkan di sekitar tanggal ini" /> }}
          columns={[
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: 'Jurnal', dataIndex: 'number' },
            { title: 'Keterangan', dataIndex: 'description', ellipsis: true },
            { title: 'Nilai', dataIndex: 'amount', align: 'right', render: (v, c) => <span style={{ fontWeight: c.same ? 600 : 400 }}>{signed(v)}</span> },
            {
              render: (_, c) =>
                c.same ? (
                  <Button size="small" type="primary" loading={match.isPending} onClick={() => match.mutate(c.id)}>
                    Pilih
                  </Button>
                ) : (
                  <Typography.Text type="secondary">nilai beda</Typography.Text>
                ),
            },
          ]}
        />
      </Modal>
    </Drawer>
  );
}

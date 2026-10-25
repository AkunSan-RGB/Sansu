import { CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import { CASH_COUNT_STATUS_LABELS, type CashCount, type CashCountItem, type CashCountSettings, canHandleMoney } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get, post, put } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import DenominationCounter, { denomTotal, type Denoms } from '@/components/DenominationCounter';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import { fmtDate, fmtMoney } from '@/lib/format';
import { printDoc } from '@/lib/print';
import { cashCountSheet } from '@/lib/xlsx/reports';
import { STATUS_COLOR, diffColor, diffText } from './shared';
import { BeritaAcara } from './BeritaAcara';

const KEYS = ['cash-counts', 'cash-accounts', 'cash-tx', ...LEDGER_KEYS];

export function CountDetail({ id, onClosed }: { id: string; onClosed: () => void }) {
  const { me } = useAuth();
  const { modal } = App.useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cash-counts', id], queryFn: () => get<CashCount>(`/cash/counts/${id}`) });
  const settings = useQuery({
    queryKey: ['cash-counts', 'settings'],
    queryFn: () => get<CashCountSettings>('/cash/counts/settings'),
  });
  const [denoms, setDenoms] = useState<Denoms>({});
  const [items, setItems] = useState<CashCountItem[]>([]);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [custodian, setCustodian] = useState('');
  const [dirty, setDirty] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!q.data) return;
    setDenoms(q.data.denominations);
    setItems(q.data.items);
    setReason(q.data.reason ?? '');
    setNotes(q.data.notes ?? '');
    setCustodian(q.data.custodianName ?? '');
    setDirty(false);
  }, [q.data]);

  const refresh = (c: CashCount) => qc.setQueryData(['cash-counts', id], c);
  const body = () => ({
    denominations: denoms,
    items: items.filter((i) => i.description.trim() && Number(i.amount) > 0),
    reason,
    notes,
    custodianName: custodian,
  });
  const save = useAction(() => put<CashCount>(`/cash/counts/${id}`, body()), {
    success: 'Hasil hitung disimpan',
    invalidate: ['cash-counts'],
    onSuccess: refresh,
  });
  const finish = useAction(
    async () => {
      if (dirty) await put(`/cash/counts/${id}`, body());
      return post<CashCount>(`/cash/counts/${id}/finish`);
    },
    {
      success: (c) =>
        c.status === 'WAITING_APPROVAL'
          ? 'Selisih melebihi batas — diajukan ke Pemilik untuk disetujui'
          : 'Opname selesai',
      invalidate: KEYS,
      onSuccess: refresh,
    },
  );
  const approve = useAction(() => post<CashCount>(`/cash/counts/${id}/approve`), {
    success: 'Opname disetujui & selisih dibukukan',
    invalidate: KEYS,
    onSuccess: refresh,
  });
  const reject = useAction(() => post<CashCount>(`/cash/counts/${id}/reject`, { reason: rejectReason }), {
    success: 'Dikembalikan untuk dihitung ulang',
    invalidate: ['cash-counts'],
    onSuccess: (c) => {
      setRejecting(false);
      setRejectReason('');
      refresh(c);
    },
  });
  const cancel = useAction(() => post(`/cash/counts/${id}/cancel`), {
    success: 'Opname dibatalkan',
    invalidate: KEYS,
    onSuccess: onClosed,
  });

  return (
    <QueryState q={q}>
      {(c) => {
        const money = canHandleMoney(me?.role);
        const editable = c.status === 'DRAFT' && money;
        const counted = editable ? denomTotal(denoms) : Number(c.countedTotal);
        const itemsTotal = editable
          ? items.reduce((s, i) => s + (i.type === 'ADD' ? 1 : -1) * Number(i.amount || 0), 0)
          : Number(c.itemsTotal);
        const book = Number(c.bookBalance);
        const diff = Math.round((counted + itemsTotal - book) * 100) / 100;
        const threshold = settings.data?.approvalThreshold ?? 50_000;
        const shown: CashCount = {
          ...c,
          denominations: denoms,
          items,
          reason,
          notes,
          custodianName: custodian,
          countedTotal: String(counted),
          itemsTotal: String(itemsTotal),
          difference: String(diff),
        };
        const set =
          <T,>(fn: (v: T) => void) =>
          (v: T) => {
            fn(v);
            setDirty(true);
          };
        return (
          <>
            <Space style={{ marginBottom: 16 }} wrap className="no-print">
              <Tag color={STATUS_COLOR[c.status]} style={{ fontSize: 14, padding: '2px 10px' }}>
                {CASH_COUNT_STATUS_LABELS[c.status]}
              </Tag>
              {editable && (
                <>
                  <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(undefined)}>
                    Simpan
                  </Button>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={finish.isPending}
                    disabled={counted === 0}
                    onClick={() =>
                      modal.confirm({
                        title: 'Selesaikan opname?',
                        content:
                          diff === 0
                            ? 'Uang fisik cocok dengan saldo buku.'
                            : Math.abs(diff) > threshold && me?.role !== 'OWNER'
                              ? `${diffText(diff)} — melebihi batas ${fmtMoney(threshold)}, akan diajukan ke Pemilik.`
                              : `${diffText(diff)} akan dibukukan ke akun Selisih Kas.`,
                        okText: 'Selesaikan',
                        onOk: () => finish.mutateAsync(undefined),
                      })
                    }
                  >
                    Selesaikan
                  </Button>
                </>
              )}
              {c.status === 'WAITING_APPROVAL' && me?.role === 'OWNER' && (
                <>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={approve.isPending}
                    onClick={() => approve.mutate(undefined)}
                  >
                    Setujui & bukukan
                  </Button>
                  <Button danger icon={<CloseOutlined />} onClick={() => setRejecting(true)}>
                    Tolak / hitung ulang
                  </Button>
                </>
              )}
              {c.status !== 'DRAFT' && c.status !== 'CANCELLED' && (
                <>
                  <Button icon={<PrinterOutlined />} onClick={() => printDoc(`Berita acara opname kas ${c.number}`)}>
                    Cetak berita acara
                  </Button>
                  <ExportButtons
                    filename={`opname-kas-${c.number.replace(/\//g, '-')}`}
                    title={`Opname kas ${c.number}`}
                    sheets={() => cashCountSheet(c, me?.tenantName)}
                    print={false}
                  />
                </>
              )}
              {money && (c.status === 'DRAFT' ||
                c.status === 'WAITING_APPROVAL' ||
                (c.status === 'POSTED' && me?.role === 'OWNER')) && (
                <Button
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    modal.confirm({
                      title: `Batalkan opname ${c.number}?`,
                      content:
                        c.status === 'POSTED'
                          ? 'Jurnal selisihnya dibalik dan kunci transaksi kas sampai tanggal ini dibuka kembali.'
                          : 'Hasil hitung tidak disimpan sebagai opname.',
                      okText: 'Batalkan opname',
                      okButtonProps: { danger: true },
                      onOk: () => cancel.mutateAsync(undefined),
                    })
                  }
                >
                  Batalkan
                </Button>
              )}
            </Space>

            {c.rejectReason && editable && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="Dikembalikan oleh Pemilik"
                description={c.rejectReason}
                className="no-print"
              />
            )}
            {c.status === 'WAITING_APPROVAL' && me?.role !== 'OWNER' && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="Menunggu persetujuan Pemilik karena selisih melebihi batas."
                className="no-print"
              />
            )}

            <Row gutter={[12, 12]} style={{ marginBottom: 16 }} className="no-print">
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="Saldo buku" value={fmtMoney(book)} valueStyle={{ fontSize: 18 }} />
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    per {fmtDate(c.date)}
                    {editable && ' · terkini'}
                  </Typography.Text>
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="Uang fisik" value={fmtMoney(counted)} valueStyle={{ fontSize: 18 }} />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="Pos rekonsiliasi" value={fmtMoney(itemsTotal)} valueStyle={{ fontSize: 18 }} />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small" style={{ borderColor: diffColor(diff) }}>
                  <Statistic
                    title="Selisih"
                    value={counted ? diffText(diff) : '—'}
                    valueStyle={{ fontSize: 18, color: counted ? diffColor(diff) : undefined }}
                  />
                </Card>
              </Col>
            </Row>

            {editable ? (
              <div className="no-print">
                <Card
                  size="small"
                  title={`Hitung uang — ${c.account.code} ${c.account.name}`}
                  style={{ marginBottom: 16 }}
                >
                  <DenominationCounter value={denoms} onChange={set(setDenoms)} />
                </Card>
                <Card size="small" title="Pos rekonsiliasi (opsional)" style={{ marginBottom: 16 }}>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
                    Jelaskan selisih yang wajar: <strong>(+)</strong> bon sementara / kasbon yang belum dicatat;{' '}
                    <strong>(−)</strong> uang titipan atau penerimaan yang belum dibukukan. Sisa selisih yang tidak
                    terjelaskan dibukukan ke Selisih Kas. Jangan lupa mencatat transaksi aslinya setelah opname
                    (bertanggal sesudahnya).
                  </Typography.Paragraph>
                  {items.map((it, i) => (
                    <Space key={i} style={{ display: 'flex', marginBottom: 8 }} align="start" wrap>
                      <Select
                        value={it.type}
                        style={{ width: 90 }}
                        options={[
                          { value: 'ADD', label: '(+)' },
                          { value: 'LESS', label: '(−)' },
                        ]}
                        onChange={(v) => set(setItems)(items.map((x, j) => (j === i ? { ...x, type: v } : x)))}
                      />
                      <Input
                        style={{ width: 380 }}
                        maxLength={200}
                        placeholder="Keterangan"
                        value={it.description}
                        onChange={(e) =>
                          set(setItems)(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                        }
                      />
                      <InputNumber
                        min={0}
                        prefix="Rp"
                        style={{ width: 170 }}
                        value={Number(it.amount) || null}
                        onChange={(v) =>
                          set(setItems)(items.map((x, j) => (j === i ? { ...x, amount: String(v ?? 0) } : x)))
                        }
                      />
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => set(setItems)(items.filter((_, j) => j !== i))}
                        aria-label="Hapus pos"
                      />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => set(setItems)([...items, { type: 'ADD', description: '', amount: '0' }])}
                  >
                    Tambah pos
                  </Button>
                </Card>
                <Card size="small" title="Keterangan">
                  <Form layout="vertical">
                    <Form.Item label="Pemegang kas">
                      <Input value={custodian} onChange={(e) => set(setCustodian)(e.target.value)} maxLength={120} />
                    </Form.Item>
                    <Form.Item
                      label="Penjelasan selisih"
                      required={diff !== 0 && counted > 0}
                      validateStatus={diff !== 0 && counted > 0 && !reason.trim() ? 'warning' : undefined}
                    >
                      <Input.TextArea
                        rows={2}
                        value={reason}
                        onChange={(e) => set(setReason)(e.target.value)}
                        maxLength={500}
                        placeholder="Wajib bila ada selisih, mis. uang receh kembalian tidak tercatat"
                      />
                    </Form.Item>
                    <Form.Item label="Catatan lain" style={{ marginBottom: 0 }}>
                      <Input.TextArea
                        rows={2}
                        value={notes}
                        onChange={(e) => set(setNotes)(e.target.value)}
                        maxLength={500}
                      />
                    </Form.Item>
                  </Form>
                </Card>
              </div>
            ) : (
              <BeritaAcara c={shown} />
            )}

            <Modal
              open={rejecting}
              title="Kembalikan untuk dihitung ulang"
              okText="Kembalikan"
              okButtonProps={{ danger: true, disabled: !rejectReason.trim(), loading: reject.isPending }}
              onOk={() => reject.mutate(undefined)}
              onCancel={() => setRejecting(false)}
            >
              <Input.TextArea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                maxLength={300}
                placeholder="mis. Hitung ulang, cek juga laci kedua"
              />
            </Modal>
          </>
        );
      }}
    </QueryState>
  );
}

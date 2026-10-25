import { useQuery } from '@tanstack/react-query';
import { Alert, Col, Form, Input, InputNumber, Modal, Row, Select, Table, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { Invoice, InvoiceDetail, PurchaseInvoice, PurchaseInvoiceDetail, ReturnDoc } from '@/api/types';
import { fmtMoney, fmtQty, today } from '@/lib/format';
import { t } from '@/lib/terms';
import { CFG, Kind } from './shared';

type AnyInvoice = (Invoice | PurchaseInvoice) & { customer?: { name: string }; supplier?: { name: string } };

const outstanding = (i: AnyInvoice) => Number(i.total) - Number(i.paidAmount) - Number(i.returnedAmount);

export function NewReturnModal({ kind, open, initialInvoice, onClose }: { kind: Kind; open: boolean; initialInvoice?: string; onClose: () => void }) {
  const cfg = CFG[kind];
  const [invoiceId, setInvoiceId] = useState<string | undefined>(initialInvoice);
  const [qty, setQty] = useState<Record<string, number | null>>({});
  const [form] = Form.useForm<{ date: string; reason?: string }>();

  useEffect(() => {
    if (open) {
      setInvoiceId(initialInvoice);
      setQty({});
      form.setFieldsValue({ date: today(), reason: undefined });
    }
  }, [open, initialInvoice, form]);

  const invoices = useQuery({
    queryKey: [kind === 'sales' ? 'invoices' : 'purchase-invoices', 'for-return'],
    queryFn: () => get<AnyInvoice[]>(cfg.invoices).then((rows) => rows.filter((r) => (r as { kind?: string }).kind !== 'BILL')),
    enabled: open,
  });
  const detail = useQuery({
    queryKey: [kind === 'sales' ? 'invoices' : 'purchase-invoices', 'detail', invoiceId],
    queryFn: () => get<InvoiceDetail | PurchaseInvoiceDetail>(cfg.detail(invoiceId!)),
    enabled: open && !!invoiceId,
  });

  const lines = detail.data?.lines ?? [];
  const unitNet = (l: (typeof lines)[number]) => Number(l.lineTotal) / Number(l.qty);
  const subtotal = lines.reduce((a, l) => a + Math.round((qty[l.id] ?? 0) * unitNet(l) * 100) / 100, 0);
  // PPN retur mengikuti rasio PPN faktur asal (sama seperti server)
  const inv = detail.data;
  const tax = inv && Number(inv.subtotal) > 0 ? Math.round((subtotal * Number(inv.taxAmount) * 100) / Number(inv.subtotal)) / 100 : 0;

  const create = useAction(
    (v: { date: string; reason?: string }) =>
      post<ReturnDoc & { journalNumber?: string }>(cfg.list, {
        ...v,
        invoiceId,
        lines: Object.entries(qty)
          .filter(([, q]) => q && q > 0)
          .map(([invoiceLineId, q]) => ({ invoiceLineId, qty: String(q) })),
      }),
    {
      success: (r) => `${cfg.label} ${r.number} diposting`,
      invalidate: [kind === 'sales' ? 'sales-returns' : 'purchase-returns', 'invoices', 'purchase-invoices', 'stock', 'stock-moves', ...LEDGER_KEYS],
      onSuccess: onClose,
    },
  );

  const options = useMemo(
    () =>
      (invoices.data ?? [])
        .filter((i) => outstanding(i) > 0 || i.id === invoiceId)
        .map((i) => ({
          value: i.id,
          label: `${i.number}${'supplierInvoiceNo' in i ? ` (${i.supplierInvoiceNo})` : ''} · ${i.customer?.name ?? i.supplier?.name} · sisa ${fmtMoney(outstanding(i))}`,
        })),
    [invoices.data, invoiceId],
  );

  return (
    <Modal
      title={`${cfg.label} baru`}
      open={open}
      width={860}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Posting retur"
      okButtonProps={{ disabled: subtotal <= 0 }}
      confirmLoading={create.isPending}
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={cfg.help} />
      <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
        <Form.Item label={t('Faktur asal')} required>
          <Select
            showSearch
            optionFilterProp="label"
            value={invoiceId}
            loading={invoices.isLoading}
            onChange={(v) => (setInvoiceId(v), setQty({}))}
            options={options}
            placeholder={t('Pilih faktur yang masih punya sisa tagihan')}
          />
        </Form.Item>
        {invoiceId && (
          <Table
            rowKey="id"
            size="small"
            loading={detail.isLoading}
            pagination={false}
            dataSource={lines}
            scroll={{ x: 650 }}
            style={{ marginBottom: 16 }}
            columns={[
              { title: t('Produk'), render: (_, l) => `${l.product.sku} · ${l.product.name}` },
              { title: t('Qty faktur'), align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.uom}` },
              { title: 'Sudah diretur', align: 'right', render: (_, l) => fmtQty(l.returnedQty) },
              {
                title: 'Qty retur',
                width: 130,
                render: (_, l) => {
                  const max = Number(l.qty) - Number(l.returnedQty);
                  return (
                    <InputNumber
                      min={0}
                      max={max}
                      disabled={max <= 0}
                      value={qty[l.id]}
                      onChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))}
                      suffix={l.uom}
                      style={{ width: '100%' }}
                    />
                  );
                },
              },
              { title: 'Nilai (DPP)', align: 'right', render: (_, l) => fmtMoney((qty[l.id] ?? 0) * unitNet(l)) },
            ]}
          />
        )}
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="date" label="Tanggal retur" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="reason" label="Alasan">
              <Input placeholder="Kemasan rusak, salah kirim, kedaluwarsa…" />
            </Form.Item>
          </Col>
        </Row>
        <Typography.Text>
          Perkiraan nilai retur: DPP {fmtMoney(subtotal)} + PPN {fmtMoney(tax)} = <strong>{fmtMoney(subtotal + tax)}</strong>
        </Typography.Text>
        <br />
        <Typography.Text type="secondary">{t('Nilai final dihitung server berdasarkan harga & PPN faktur asal.')}</Typography.Text>
      </Form>
    </Modal>
  );
}

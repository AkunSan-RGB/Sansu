import { ACCOUNT_TYPE_LABELS, type AccountType, FISCAL_TREATMENT_LABELS, type FiscalTreatment, REPORT_GROUPS, type ReportGroup, reportGroupsFor, toOptions } from '@sansu/shared';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { api, get, patch, post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { Account } from '@/api/types';
import PageHeader from '@/layout/PageHeader';

type Node = Account & { children?: Node[] };

/** Akun yang dinonaktifkan otomatis karena tidak relevan untuk jenis usaha perusahaan */
const isUnused = (a: Account) => a.isActive === false && !!a.description?.startsWith('Tidak dipakai pada jenis usaha ini');

/** Susun daftar akun menjadi pohon induk → anak */
function toTree(rows: Account[]): Node[] {
  const map = new Map<string, Node>(rows.map((r) => [r.id, { ...r }]));
  const roots: Node[] = [];
  for (const n of map.values()) {
    const parent = n.parentId ? map.get(n.parentId) : undefined;
    if (parent) (parent.children ??= []).push(n);
    else roots.push(n);
  }
  return roots;
}

export default function AccountsPage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const type = Form.useWatch('type', form);
  const { data, isLoading } = useQuery({ queryKey: ['accounts'], queryFn: () => get<Account[]>('/accounting/accounts') });
  const [showUnused, setShowUnused] = useState(false);
  const unusedCount = useMemo(() => (data ?? []).filter(isUnused).length, [data]);
  const tree = useMemo(() => toTree(showUnused ? (data ?? []) : (data ?? []).filter((a) => !isUnused(a))), [data, showUnused]);

  const create = useAction((v: object) => post('/accounting/accounts', v), {
    success: 'Akun ditambahkan',
    invalidate: ['accounts'],
    onSuccess: () => setOpen(false),
  });
  const update = useAction((v: object) => patch(`/accounting/accounts/${editing?.id}`, v), {
    success: 'Akun diperbarui',
    invalidate: ['accounts'],
    onSuccess: () => setEditing(null),
  });
  const remove = useAction((id: string) => api(`/accounting/accounts/${id}`, { method: 'DELETE' }), { success: 'Akun dihapus', invalidate: ['accounts'] });
  const groupOptions = (t?: AccountType) => (t ? reportGroupsFor(t).map((g) => ({ value: g, label: REPORT_GROUPS[g].label })) : []);

  return (
    <>
      <PageHeader
        title="Bagan Akun"
        extra={
          <Space wrap>
            {unusedCount > 0 && (
              <Checkbox checked={showUnused} onChange={(e) => setShowUnused(e.target.checked)}>
                Tampilkan {unusedCount} akun yang tidak dipakai di jenis usaha ini
              </Checkbox>
            )}
            <Button onClick={() => navigate('/opening-balance')}>Isi saldo awal</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => (form.resetFields(), setOpen(true))}>
              Akun baru
            </Button>
          </Space>
        }
      />
      <Card>
        {!isLoading && (
          <Table
            rowKey="id"
            dataSource={tree}
            pagination={false}
            defaultExpandAllRows
            scroll={{ x: 1300 }}
            columns={[
              { title: 'Kode', dataIndex: 'code', width: 200, render: (c: string) => <span style={{ whiteSpace: 'nowrap' }}>{c}</span> },
              { title: 'Nama', dataIndex: 'name', width: 280, render: (n, a) => (a.isPostable ? n : <strong>{n}</strong>) },
              { title: 'Tipe', dataIndex: 'type', width: 110, render: (t: Account['type']) => ACCOUNT_TYPE_LABELS[t] },
              {
                title: 'Pos laporan keuangan',
                dataIndex: 'reportGroup',
                width: 220,
                render: (g: ReportGroup | null, a) => (a.isPostable && g ? REPORT_GROUPS[g]?.label : ''),
              },
              {
                title: 'Fiskal',
                dataIndex: 'fiscalTreatment',
                width: 200,
                render: (f: FiscalTreatment, a) =>
                  a.isPostable && f && f !== 'NORMAL' ? <Tag color={f === 'NON_DEDUCTIBLE' ? 'red' : 'orange'}>{FISCAL_TREATMENT_LABELS[f]}</Tag> : '',
              },
              {
                title: 'Keterangan',
                render: (_, a) => (
                  <>
                    {a.isCashAccount && <Tag color="green">Kas / bank</Tag>}
                    {a.systemKey && <Tag color="blue">Akun sistem</Tag>}
                    {a.isActive === false && <Tag>{isUnused(a) ? 'Tidak dipakai' : 'Nonaktif'}</Tag>}
                    {a.description && (
                      <Tooltip title={a.description}>
                        <Tag>ⓘ</Tag>
                      </Tooltip>
                    )}
                  </>
                ),
              },
              {
                render: (_, a) => (
                  <Space size={0}>
                    {a.isPostable && (
                      <Button size="small" type="link" onClick={() => navigate(`/ledger?accountId=${a.id}`)}>
                        Buku besar
                      </Button>
                    )}
                    <Button
                      size="small"
                      type="link"
                      onClick={() => {
                        editForm.setFieldsValue({ ...a, isActive: a.isActive !== false });
                        setEditing(a);
                      }}
                    >
                      Ubah
                    </Button>
                    {!a.systemKey && !a.children?.length && (
                      <Popconfirm title="Hapus akun ini? Hanya bisa jika belum pernah dipakai." onConfirm={() => remove.mutate(a.id)}>
                        <Button size="small" type="link" danger>
                          Hapus
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Modal title="Akun baru" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="parentId" label="Akun induk" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={data?.filter((a) => !a.isPostable).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
              onChange={(id) => {
                const t = data?.find((a) => a.id === id)?.type;
                form.setFieldsValue({ type: t, reportGroup: undefined });
              }}
            />
          </Form.Item>
          <Form.Item name="type" label="Tipe" rules={[{ required: true }]}>
            <Select disabled options={toOptions(ACCOUNT_TYPE_LABELS)} />
          </Form.Item>
          <Form.Item name="code" label="Kode" rules={[{ required: true }]}>
            <Input placeholder="6-4000" />
          </Form.Item>
          <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
            <Input placeholder="Beban Listrik & Air" />
          </Form.Item>
          <Form.Item name="reportGroup" label="Pos di laporan keuangan" extra="Kosongkan agar ditebak otomatis dari kode akun.">
            <Select allowClear options={groupOptions(type)} />
          </Form.Item>
          {type && ['REVENUE', 'EXPENSE'].includes(type) && (
            <Form.Item name="fiscalTreatment" label="Perlakuan pajak (fiskal)" initialValue="NORMAL">
              <Select options={toOptions(FISCAL_TREATMENT_LABELS)} />
            </Form.Item>
          )}
          {type === 'ASSET' && (
            <Form.Item name="isCashAccount" valuePropName="checked" extra="Centang untuk kas kecil atau rekening bank baru (mis. Bank BRI) — akan muncul di menu Kas & Bank.">
              <Checkbox>Akun kas / rekening bank</Checkbox>
            </Form.Item>
          )}
        </Form>
      </Modal>
      <Modal title={`Ubah akun ${editing?.code ?? ''}`} open={!!editing} onCancel={() => setEditing(null)} onOk={() => editForm.submit()} confirmLoading={update.isPending} destroyOnHidden>
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(v) => update.mutate({ code: v.code, name: v.name, reportGroup: v.reportGroup ?? undefined, fiscalTreatment: v.fiscalTreatment, description: v.description ?? '', isActive: v.isActive })}
        >
          <Space wrap>
            <Form.Item name="code" label="Kode" rules={[{ required: true }]}>
              <Input disabled={!!editing?.systemKey} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
              <Input style={{ width: 300 }} />
            </Form.Item>
          </Space>
          {editing?.isPostable && (
            <>
              <Form.Item name="reportGroup" label="Pos di laporan keuangan">
                <Select options={groupOptions(editing?.type)} />
              </Form.Item>
              {['REVENUE', 'EXPENSE'].includes(editing?.type ?? '') && (
                <Form.Item name="fiscalTreatment" label="Perlakuan pajak (fiskal)" extra="Dipakai untuk koreksi fiskal otomatis di Rekonsiliasi Fiskal.">
                  <Select options={toOptions(FISCAL_TREATMENT_LABELS)} />
                </Form.Item>
              )}
            </>
          )}
          <Form.Item name="description" label="Keterangan">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="isActive" label="Aktif" valuePropName="checked">
            <Switch disabled={!!editing?.systemKey} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

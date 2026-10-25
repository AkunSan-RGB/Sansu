import { PlusOutlined } from '@ant-design/icons';
import { canBookkeep, DEPRECIATION_METHOD_LABELS, type DepreciationMethod, FISCAL_ASSET_GROUP_INFO, type FiscalAssetGroup, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Table } from 'antd';
import { useState } from 'react';
import { get, patch, post } from '@/api/client';
import { useAccounts, useAction } from '@/api/queries';
import type { AssetCategory } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { lifeText } from './shared';
import { ChangeMethodModal } from './ChangeMethodModal';

const groupOptions = Object.entries(FISCAL_ASSET_GROUP_INFO).map(([k, v]) => ({ value: k, label: v.label }));

export function CategoriesTab() {
  const bookkeeper = canBookkeep(useAuth().me?.role);
  const [editing, setEditing] = useState<AssetCategory | 'new' | null>(null);
  const [catMethod, setCatMethod] = useState<{ kind: 'asset' | 'category'; id: string; name: string; method: string } | null>(null);
  const [form] = Form.useForm();
  const accounts = useAccounts();
  const cats = useQuery({ queryKey: ['assets', 'categories'], queryFn: () => get<AssetCategory[]>('/assets/categories') });
  const opts = (filter: (g: string | null | undefined, type: string) => boolean) =>
    accounts.data?.filter((a) => a.isPostable && filter(a.reportGroup, a.type)).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const save = useAction(
    (v: Record<string, unknown>) => {
      const body = { ...v, usefulLifeMonths: Math.round(Number(v.usefulLifeYears ?? 0) * 12), usefulLifeYears: undefined };
      return editing === 'new' ? post('/assets/categories', body) : patch(`/assets/categories/${(editing as AssetCategory).id}`, body);
    },
    { success: 'Kategori disimpan', invalidate: ['assets'], onSuccess: () => setEditing(null) },
  );
  return (
    <Card>
      {bookkeeper && (
      <Button
        type="primary"
        icon={<PlusOutlined />}
        style={{ marginBottom: 12 }}
        onClick={() => {
          form.resetFields();
          form.setFieldsValue({ method: 'STRAIGHT_LINE', usefulLifeYears: 4, fiscalGroup: 'GROUP_1', fiscalMethod: 'STRAIGHT_LINE' });
          setEditing('new');
        }}
      >
        Kategori baru
      </Button>
      )}
      <Table
        rowKey="id"
        size="small"
        loading={cats.isLoading}
        dataSource={cats.data}
        scroll={{ x: 900 }}
        pagination={false}
        columns={[
          { title: 'Kategori', dataIndex: 'name' },
          { title: 'Metode', dataIndex: 'method', render: (m: DepreciationMethod) => DEPRECIATION_METHOD_LABELS[m] },
          { title: 'Umur', dataIndex: 'usefulLifeMonths', render: lifeText },
          { title: 'Akun aset', render: (_, c) => c.assetAccount && `${c.assetAccount.code} · ${c.assetAccount.name}` },
          { title: 'Akun beban', render: (_, c) => c.expenseAccount && `${c.expenseAccount.code} · ${c.expenseAccount.name}` },
          { title: 'Fiskal', dataIndex: 'fiscalGroup', render: (g: FiscalAssetGroup) => FISCAL_ASSET_GROUP_INFO[g]?.label },
          {
            render: (_, c) => bookkeeper && (
              <>
              <Button
                size="small"
                onClick={() => {
                  form.setFieldsValue({ ...c, usefulLifeYears: c.usefulLifeMonths / 12 });
                  setEditing(c);
                }}
              >
                Ubah
              </Button>
              <Button size="small" style={{ marginLeft: 6 }} disabled={c.method === 'NONE'} onClick={() => setCatMethod({ kind: 'category', id: c.id, name: c.name, method: c.method })}>
                Ubah metode semua aset
              </Button>
              </>
            ),
          },
        ]}
      />
      <ChangeMethodModal target={catMethod} onClose={() => setCatMethod(null)} />
      <Modal title={editing === 'new' ? 'Kategori baru' : 'Ubah kategori'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending} width={640} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="method" label="Metode komersial" extra="Hanya untuk aset baru di kategori ini. Untuk aset yang sudah ada, pakai Ubah metode semua aset (berlaku ke depan).">
                <Select options={toOptions(DEPRECIATION_METHOD_LABELS)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="usefulLifeYears" label="Umur manfaat (tahun)">
                <InputNumber min={0} max={50} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="assetAccountId" label="Akun aset" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={opts((g) => g === 'FIXED_ASSET' || g === 'INTANGIBLE_ASSET')} />
          </Form.Item>
          <Form.Item name="accumulatedAccountId" label="Akun akumulasi penyusutan">
            <Select allowClear showSearch optionFilterProp="label" options={opts((g) => g === 'ACCUMULATED_DEPRECIATION' || g === 'ACCUMULATED_AMORTIZATION')} />
          </Form.Item>
          <Form.Item name="expenseAccountId" label="Akun beban penyusutan">
            <Select allowClear showSearch optionFilterProp="label" options={opts((_, t) => t === 'EXPENSE')} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="fiscalGroup" label="Kelompok harta fiskal (Pasal 11 UU PPh)">
                <Select options={groupOptions} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="fiscalMethod" label="Metode fiskal">
                <Select
                  options={[
                    { value: 'STRAIGHT_LINE', label: 'Garis lurus' },
                    { value: 'DECLINING_BALANCE', label: 'Saldo menurun' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Card>
  );
}

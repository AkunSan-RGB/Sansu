import { PlusOutlined } from '@ant-design/icons';
import { type Plan } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Col, Form, Input, InputNumber, Modal, Row, Space, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, patch, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtMoney } from '@/lib/format';
import { t } from '@/lib/terms';
import { KEYS } from './shared';

// ---------------- Paket ----------------
export function PlansTab() {
  const q = useQuery({ queryKey: [...KEYS, 'plans'], queryFn: () => get<Plan[]>('/platform-admin/plans') });
  const [editing, setEditing] = useState<Partial<Plan> | null>(null);
  const [form] = Form.useForm();
  const save = useAction(
    (v: Partial<Plan>) => {
      const body = {
        ...v,
        priceMonthly: String(v.priceMonthly),
        priceYearly: String(v.priceYearly),
        maxUsers: v.maxUsers ?? null,
        maxWarehouses: v.maxWarehouses ?? null,
      };
      return editing?.id ? patch(`/platform-admin/plans/${editing.id}`, body) : post('/platform-admin/plans', body);
    },
    { success: 'Paket disimpan', invalidate: KEYS, onSuccess: () => setEditing(null) },
  );
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setEditing({ isActive: true, sortOrder: (q.data?.length ?? 0) + 1 })}
        >
          Paket baru
        </Button>
        <Typography.Text type="secondary">
          Perubahan harga berlaku untuk tagihan berikutnya; tagihan yang sudah dibuat tidak berubah.
        </Typography.Text>
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={q.data}
        pagination={false}
        scroll={{ x: 900 }}
        onRow={(p) => ({ onClick: () => setEditing(p), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Kode', dataIndex: 'code' },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Bulanan', dataIndex: 'priceMonthly', align: 'right', render: fmtMoney },
          { title: 'Tahunan', dataIndex: 'priceYearly', align: 'right', render: fmtMoney },
          { title: 'Maks. pengguna', dataIndex: 'maxUsers', render: (v) => v ?? 'Tanpa batas' },
          { title: t('Maks. gudang'), dataIndex: 'maxWarehouses', render: (v) => v ?? 'Tanpa batas' },
          {
            title: 'Dijual',
            dataIndex: 'isActive',
            render: (v) => (v ? <Tag color="green">Ya</Tag> : <Tag>Tidak</Tag>),
          },
        ]}
      />
      <Modal
        open={!!editing}
        title={editing?.id ? `Ubah paket ${editing.name}` : 'Paket baru'}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        okText="Simpan"
        confirmLoading={save.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={{
            ...editing,
            priceMonthly: editing?.priceMonthly ? Number(editing.priceMonthly) : undefined,
            priceYearly: editing?.priceYearly ? Number(editing.priceYearly) : undefined,
          }}
          onFinish={(v) => save.mutate(v)}
        >
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name="code"
                label="Kode"
                rules={[{ required: true }, { pattern: /^[A-Z0-9_-]+$/, message: 'Huruf besar/angka' }]}
              >
                <Input disabled={!!editing?.id} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="Keterangan singkat">
                <Input maxLength={300} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priceMonthly" label="Harga per bulan" rules={[{ required: true }]}>
                <InputNumber<number>
                  min={0}
                  style={{ width: '100%' }}
                  formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                  parser={(v) => Number((v ?? '').replace(/\./g, ''))}
                  prefix="Rp"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priceYearly" label="Harga per tahun" rules={[{ required: true }]}>
                <InputNumber<number>
                  min={0}
                  style={{ width: '100%' }}
                  formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                  parser={(v) => Number((v ?? '').replace(/\./g, ''))}
                  prefix="Rp"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="maxUsers" label="Maks. pengguna aktif" extra="Kosong = tanpa batas">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="maxWarehouses" label={t('Maks. gudang')} extra="Kosong = tanpa batas">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sortOrder" label="Urutan tampil">
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="isActive" label="Dijual" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}

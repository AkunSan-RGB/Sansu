import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { DEFAULT_UTILITY_RULES, UTILITY_SERVICE_DEFAULTS, UTILITY_SERVICE_LABELS, UTILITY_SERVICE_TYPES, type UtilityRules, type UtilityServiceType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtMoney } from '@/lib/format';
import { Tariff } from './shared';

// ---------- Tarif & aturan ----------
type TariffForm = { name: string; serviceType: UtilityServiceType; unit?: string; fixedFee: number; adminFee: number; minUsage?: number; blocks: { upTo: number | null; price: number }[]; vatable?: boolean; isActive?: boolean };

export function TariffsTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['utility', 'tariffs'], queryFn: () => get<Tariff[]>('/utility/tariffs') });
  const rules = useQuery({ queryKey: ['utility', 'rules'], queryFn: () => get<UtilityRules>('/utility/rules') });
  const [editing, setEditing] = useState<Tariff | 'new' | null>(null);
  const [form] = Form.useForm<TariffForm>();
  const [rf] = Form.useForm<UtilityRules>();
  const type = Form.useWatch('serviceType', form) as UtilityServiceType | undefined;
  const metered = type ? UTILITY_SERVICE_DEFAULTS[type].metered : true;
  const save = useAction((v: TariffForm) => (editing === 'new' ? post('/utility/tariffs', v) : put(`/utility/tariffs/${(editing as Tariff).id}`, v)), { success: 'Tarif tersimpan', invalidate: ['utility'], onSuccess: () => setEditing(null) });
  const saveRules = useAction((v: UtilityRules) => put('/utility/rules', v), { success: 'Aturan tersimpan', invalidate: ['utility'] });
  const canEdit = can('PUT', '/utility/tariffs/:id');
  const open = (t: Tariff | 'new') => {
    form.resetFields();
    if (t === 'new') form.setFieldsValue({ serviceType: 'AIR', fixedFee: 0, adminFee: 0, minUsage: 0, blocks: [{ upTo: 10, price: 0 }, { upTo: null, price: 0 }] });
    else form.setFieldsValue({ name: t.name, serviceType: t.serviceType, unit: t.unit, fixedFee: Number(t.fixedFee), adminFee: Number(t.adminFee), minUsage: Number(t.minUsage), blocks: t.blocks, vatable: t.vatable, isActive: t.isActive });
    setEditing(t);
  };
  return (
    <>
      <Space style={{ marginBottom: 12 }}>{can('POST', '/utility/tariffs') && <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>Tarif baru</Button>}</Space>
      <ResponsiveTable<Tariff> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={false} scroll={{ x: 800 }} locale={{ emptyText: 'Belum ada tarif — buat tarif pertama' }}
        columns={[
          { title: 'Tarif', render: (_: unknown, t: Tariff) => <span>{t.name} {!t.isActive && <Tag>nonaktif</Tag>}</span> },
          { title: 'Layanan', render: (_: unknown, t: Tariff) => UTILITY_SERVICE_LABELS[t.serviceType] },
          { title: 'Abonemen / tetap', align: 'right' as const, render: (_: unknown, t: Tariff) => fmtMoney(t.fixedFee) },
          { title: 'Admin', align: 'right' as const, render: (_: unknown, t: Tariff) => fmtMoney(t.adminFee) },
          { title: 'Blok pemakaian', render: (_: unknown, t: Tariff) => (t.metered ? t.blocks.map((b, i) => <div key={i}>{i === 0 ? 0 : t.blocks[i - 1].upTo}–{b.upTo ?? '∞'} {t.unit}: {fmtMoney(b.price)}</div>) : 'tarif tetap') },
          { title: 'Sambungan', dataIndex: 'connections', align: 'right' as const },
          { render: (_: unknown, t: Tariff) => (canEdit ? <Button size="small" onClick={() => open(t)}>Ubah</Button> : null) },
        ]}
      />
      <Typography.Title level={5} style={{ marginTop: 24 }}>Aturan denda, pemutusan, dan tanda janggal</Typography.Title>
      <Form form={rf} layout="vertical" key={JSON.stringify(rules.data)} initialValues={rules.data ?? DEFAULT_UTILITY_RULES} onFinish={(v) => saveRules.mutate(v)} disabled={!can('PUT', '/utility/rules')}>
        <Row gutter={12}>
          <Col xs={12} md={6}><Form.Item name="dueDays" label="Jatuh tempo (hari setelah terbit)"><InputNumber min={5} max={60} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="graceDays" label="Toleransi sebelum denda (hari)"><InputNumber min={0} max={60} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="lateFeePct" label="Denda (% dari sisa tagihan)"><InputNumber min={0} max={10} step={0.5} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="lateFeeCapPct" label="Batas denda (% nilai tagihan)"><InputNumber min={0} max={25} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="suspendAfterDays" label="Usulan putus setelah (hari)"><InputNumber min={14} max={180} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="spikeFactor" label="Tandai lonjakan (× rata-rata)"><InputNumber min={1.5} max={10} step={0.5} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="spikeMinUsage" label="Abaikan lonjakan di bawah"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="cashless" label="Loket hanya menerima non-tunai" valuePropName="checked" extra="Aktif: pembayaran loket lewat transfer, QRIS, virtual account, EDC, atau dompet digital; tidak ada uang tunai dan tidak ada setoran kas. Matikan hanya bila loket memang memegang uang tunai."><Switch /></Form.Item></Col>
        </Row>
        {can('PUT', '/utility/rules') && <Button type="primary" htmlType="submit" loading={saveRules.isPending}>Simpan aturan</Button>}
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>Besaran denda dan batas pemutusan harus sesuai ketentuan penyedia/regulator Anda dan perjanjian dengan pelanggan.</Typography.Paragraph>
      </Form>
      <Modal title={editing === 'new' ? 'Tarif baru' : 'Ubah tarif'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending} okText="Simpan" width={640} destroyOnHidden>
        {editing !== 'new' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Perubahan tarif berlaku untuk tagihan berikutnya dan tercatat di jejak audit (sebelum/sesudah)." />}
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate({ ...v, blocks: metered ? v.blocks : [] })}>
          <Row gutter={12}>
            <Col xs={24} md={12}><Form.Item name="name" label="Nama tarif" rules={[{ required: true, min: 2 }]}><Input maxLength={80} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="serviceType" label="Jenis layanan" rules={[{ required: true }]}><Select disabled={editing !== 'new'} options={UTILITY_SERVICE_TYPES.map((v) => ({ value: v, label: UTILITY_SERVICE_LABELS[v] }))} onChange={(v: UtilityServiceType) => form.setFieldValue('unit', UTILITY_SERVICE_DEFAULTS[v].unit)} /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="fixedFee" label={metered ? 'Abonemen / biaya tetap' : 'Biaya per periode'} rules={[{ required: true }]}><InputNumber min={0} prefix="Rp" style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="adminFee" label="Biaya administrasi"><InputNumber min={0} prefix="Rp" style={{ width: '100%' }} /></Form.Item></Col>
            {metered && <Col xs={12} md={8}><Form.Item name="minUsage" label="Pemakaian minimum ditagih"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
          </Row>
          {metered && (
            <Form.List name="blocks">
              {(fields, { add, remove }) => (
                <>
                  <Typography.Text strong>Blok tarif (progresif)</Typography.Text>
                  {fields.map((f, i) => (
                    <Space key={f.key} align="baseline" style={{ display: 'flex', marginTop: 8 }}>
                      <span>Sampai</span>
                      <Form.Item name={[f.name, 'upTo']} noStyle><InputNumber min={1} placeholder="tanpa batas" style={{ width: 130 }} /></Form.Item>
                      <span>dengan harga</span>
                      <Form.Item name={[f.name, 'price']} noStyle rules={[{ required: true }]}><InputNumber min={0} prefix="Rp" style={{ width: 150 }} /></Form.Item>
                      {fields.length > 1 && i === fields.length - 1 && <MinusCircleOutlined onClick={() => remove(f.name)} />}
                    </Space>
                  ))}
                  <Button type="dashed" size="small" style={{ marginTop: 8 }} onClick={() => { const last = form.getFieldValue('blocks') as { upTo: number | null; price: number }[]; const prev = last[last.length - 1]; if (prev && prev.upTo == null) last[last.length - 1] = { ...prev, upTo: (last[last.length - 2]?.upTo ?? 0) + 10 }; add({ upTo: null, price: 0 }); }}>Tambah blok</Button>
                  <Typography.Paragraph type="secondary" style={{ marginTop: 4 }}>Blok terakhir dikosongkan "Sampai"-nya (tanpa batas).</Typography.Paragraph>
                </>
              )}
            </Form.List>
          )}
          <Form.Item name="vatable" label="Dikenai PPN" valuePropName="checked" extra="Hanya bila layanan ini memang kena PPN — pastikan dengan konsultan pajak."><Switch /></Form.Item>
          {editing !== 'new' && <Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item>}
        </Form>
      </Modal>
    </>
  );
}

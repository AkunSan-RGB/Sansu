import { canBookkeep, DEPRECIATION_METHOD_LABELS, type DepreciationMethod } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, patch, post, put } from '@/api/client';
import { useAction, useBranches } from '@/api/queries';
import type { FixedAsset } from '@/api/types';
import CashAccountSelect from '@/components/CashAccountSelect';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { useAuth } from '@/auth/AuthContext';
import { KEYS, VerifyTag, lifeText } from './shared';
import { ChangeMethodModal } from './ChangeMethodModal';

/** Pemakaian bulanan aset dengan metode unit produksi */
function UsagePanel({ asset, canEdit }: { asset: FixedAsset; canEdit: boolean }) {
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [units, setUnits] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['assets', 'usage', asset.id],
    queryFn: () => get<{ usedUnits: string; remainingUnits: string; rows: { id: string; period: string; units: string; note: string | null }[] }>(`/assets/${asset.id}/usage`),
  });
  const save = useAction(() => put(`/assets/${asset.id}/usage`, { period, units: String(units ?? 0) }), {
    success: 'Pemakaian dicatat',
    invalidate: [...KEYS, 'assets'],
    onSuccess: () => setUnits(null),
  });
  const label = asset.unitLabel ?? 'unit';
  return (
    <Card size="small" title={`Pemakaian (${label}) — dasar penyusutan`} style={{ marginBottom: 16 }}>
      <Typography.Paragraph type="secondary">
        Kapasitas {fmtQty(asset.totalUnits ?? 0)} {label} · terpakai {fmtQty(q.data?.usedUnits ?? 0)} · sisa {fmtQty(q.data?.remainingUnits ?? 0)}. Pemakaian bulan yang sudah disusutkan tidak bisa diubah; bulan tanpa catatan tidak disusutkan.
      </Typography.Paragraph>
      {canEdit && asset.status === 'ACTIVE' && (
        <Space wrap style={{ marginBottom: 8 }}>
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 160 }} />
          <InputNumber min={0} value={units} onChange={setUnits} placeholder={`Pemakaian (${label})`} style={{ width: 180 }} />
          <Button type="primary" disabled={units == null} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Catat
          </Button>
        </Space>
      )}
      <Table size="small" rowKey="id" pagination={false} dataSource={q.data?.rows} columns={[{ title: 'Bulan', dataIndex: 'period' }, { title: `Pemakaian (${label})`, dataIndex: 'units', align: 'right', render: (v: string) => fmtQty(v) }]} />
    </Card>
  );
}

export function AssetDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { me } = useAuth();
  const bookkeeper = canBookkeep(me?.role);
  const [dispose, setDispose] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveForm] = Form.useForm();
  const branchList = useBranches();
  const activeBranches = (branchList.data?.branches ?? []).filter((b) => b.isActive);
  const [form] = Form.useForm();
  const a = useQuery({ queryKey: ['assets', id], queryFn: () => get<FixedAsset>(`/assets/${id}`), enabled: !!id });
  const doMove = useAction((v: { branchId: string | null; date: string }) => post(`/assets/${id}/transfer-branch`, v), {
    success: 'Aset dipindahkan ke cabang baru',
    invalidate: [...KEYS, 'branches'],
    onSuccess: () => setMoveOpen(false),
  });
  const doDispose = useAction((v: { date: string; price: number; cashAccountId?: string }) => post(`/assets/${id}/dispose`, { ...v, price: String(v.price ?? 0) }), {
    success: 'Pelepasan aset diposting',
    invalidate: KEYS,
    onSuccess: () => setDispose(false),
  });
  const price = Form.useWatch('price', form);
  const d = a.data;
  const [custodian, setCustodian] = useState<string>();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [vForm] = Form.useForm<{ status: 'FOUND' | 'DAMAGED' | 'MISSING'; note?: string; location?: string }>();
  const saveCustodian = useAction((v: string) => patch(`/assets/${id}`, { custodian: v }), { success: 'Penanggung jawab disimpan', invalidate: KEYS });
  const doVerify = useAction((v: { status: string; note?: string; location?: string }) => post(`/assets/${id}/verify`, v), {
    success: 'Hasil pemeriksaan fisik dicatat',
    invalidate: KEYS,
    onSuccess: () => setVerifyOpen(false),
  });
  return (
    <Drawer title={d ? `${d.code} · ${d.name}` : 'Aset'} open={!!id} onClose={onClose} width={720}>
      {d && (
        <>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Kategori">{d.category.name}</Descriptions.Item>
            <Descriptions.Item label="Status">{d.status === 'ACTIVE' ? <Tag color="green">Aktif</Tag> : <Tag>Dilepas {fmtDate(d.disposalDate)}</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Tanggal perolehan">{fmtDate(d.acquisitionDate)}</Descriptions.Item>
            <Descriptions.Item label="Mulai disusutkan">{fmtDate(d.depreciationStart)}</Descriptions.Item>
            <Descriptions.Item label="Harga perolehan">{fmtMoney(d.cost)}</Descriptions.Item>
            <Descriptions.Item label="Nilai sisa">{fmtMoney(d.residualValue)}</Descriptions.Item>
            <Descriptions.Item label="Umur manfaat">{lifeText(d.usefulLifeMonths)}</Descriptions.Item>
            <Descriptions.Item label="Metode">{DEPRECIATION_METHOD_LABELS[d.method as DepreciationMethod]}</Descriptions.Item>
            <Descriptions.Item label="Akumulasi">{fmtMoney(d.accumulated)}</Descriptions.Item>
            <Descriptions.Item label="Nilai buku">
              <strong>{fmtMoney(d.bookValue)}</strong>
            </Descriptions.Item>
            {d.location && <Descriptions.Item label="Lokasi">{d.location}</Descriptions.Item>}
            {d.disposalPrice && <Descriptions.Item label="Harga jual">{fmtMoney(d.disposalPrice)}</Descriptions.Item>}
          </Descriptions>
          {d.method === 'UNITS_OF_PRODUCTION' && <UsagePanel asset={d} canEdit={bookkeeper} />}
          {bookkeeper && d.status === 'ACTIVE' && (
            <Space wrap style={{ marginBottom: 16 }}>
              <Input
                style={{ width: 240 }}
                placeholder="Penanggung jawab (nama/divisi)"
                defaultValue={d.custodian ?? ''}
                key={`${d.id}-${d.custodian ?? ''}`}
                onChange={(e) => setCustodian(e.target.value)}
                onPressEnter={() => custodian !== undefined && saveCustodian.mutate(custodian)}
              />
              <Button loading={saveCustodian.isPending} disabled={custodian === undefined} onClick={() => custodian !== undefined && saveCustodian.mutate(custodian)}>
                Simpan
              </Button>
              <Button
                onClick={() => {
                  vForm.setFieldsValue({ status: 'FOUND', note: undefined, location: d.location ?? undefined });
                  setVerifyOpen(true);
                }}
              >
                Periksa fisik
              </Button>
              {d.lastVerifiedAt && <VerifyTag a={d} />}
            </Space>
          )}
          {(me?.role === 'OWNER' || me?.role === 'ADMIN') && d.status === 'ACTIVE' && activeBranches.length > 0 && (
            <Space style={{ marginBottom: 16, marginRight: 8 }}>
              <Typography.Text>Cabang: <b>{activeBranches.find((b) => b.id === d.branchId)?.name ?? 'Pusat'}</b></Typography.Text>
              <Button
                onClick={() => {
                  moveForm.setFieldsValue({ date: today(), branchId: undefined });
                  setMoveOpen(true);
                }}
              >
                Pindah cabang
              </Button>
            </Space>
          )}
          {bookkeeper && d.status === 'ACTIVE' && d.method !== 'NONE' && (
            <Button style={{ marginBottom: 16, marginRight: 8 }} onClick={() => setMethodOpen(true)}>
              Ubah metode penyusutan
            </Button>
          )}
          {bookkeeper && d.status === 'ACTIVE' && (
            <Button
              danger
              style={{ marginBottom: 16 }}
              onClick={() => {
                form.setFieldsValue({ date: today(), price: 0 });
                setDispose(true);
              }}
            >
              Jual / hapus aset
            </Button>
          )}
          <Typography.Title level={5}>Jadwal penyusutan</Typography.Title>
          <Table
            size="small"
            rowKey="period"
            pagination={{ pageSize: 12, hideOnSinglePage: true }}
            dataSource={d.schedule}
            columns={[
              { title: 'Periode', dataIndex: 'period' },
              { title: 'Penyusutan', dataIndex: 'amount', align: 'right', render: fmtMoney },
              { title: 'Akumulasi', dataIndex: 'accumulated', align: 'right', render: fmtMoney },
              { title: 'Nilai buku', dataIndex: 'bookValue', align: 'right', render: fmtMoney },
              { title: '', dataIndex: 'posted', render: (p) => (p ? <Tag color="green">Diposting</Tag> : <Tag>Rencana</Tag>) },
            ]}
          />
          <Modal title="Pindah cabang aset" open={moveOpen} onCancel={() => setMoveOpen(false)} onOk={() => moveForm.submit()} confirmLoading={doMove.isPending} okText="Pindahkan">
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Penyusutan dihitung dulu sampai bulan sebelumnya, lalu harga perolehan dan akumulasi penyusutan dipindah antar cabang (otomatis lewat Rekening Antar Cabang). Penyusutan berikutnya dibebankan ke cabang baru." />
            <Form form={moveForm} layout="vertical" onFinish={(v) => doMove.mutate({ branchId: v.branchId ?? null, date: v.date })}>
              <Form.Item name="branchId" label="Cabang tujuan" extra="Kosongkan untuk memindahkan ke Pusat">
                <Select allowClear placeholder="Pusat" options={activeBranches.filter((b) => b.id !== d.branchId).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
              </Form.Item>
              <Form.Item name="date" label="Tanggal pindah" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Form>
          </Modal>
          <Modal title="Pemeriksaan fisik aset" open={verifyOpen} onCancel={() => setVerifyOpen(false)} onOk={() => vForm.submit()} confirmLoading={doVerify.isPending} okText="Catat">
            <Form form={vForm} layout="vertical" onFinish={(v) => doVerify.mutate(v)}>
              <Form.Item name="status" label="Hasil pemeriksaan" rules={[{ required: true }]}>
                <Radio.Group
                  options={[
                    { value: 'FOUND', label: 'Ada & baik' },
                    { value: 'DAMAGED', label: 'Rusak' },
                    { value: 'MISSING', label: 'Tidak ditemukan' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="location" label="Lokasi saat ini">
                <Input />
              </Form.Item>
              <Form.Item name="note" label="Catatan">
                <Input.TextArea rows={2} maxLength={300} />
              </Form.Item>
            </Form>
          </Modal>
          <ChangeMethodModal target={methodOpen ? { kind: 'asset', id: d.id, name: `${d.code} ${d.name}`, method: d.method } : null} onClose={() => setMethodOpen(false)} />
          <Modal title="Jual / hapus aset" open={dispose} onCancel={() => setDispose(false)} onOk={() => form.submit()} confirmLoading={doDispose.isPending} okText="Posting">
            <Typography.Paragraph type="secondary">
              Penyusutan dikejar sampai bulan sebelum pelepasan, lalu aset & akumulasinya dikeluarkan. Selisih dengan harga jual dicatat sebagai laba / rugi pelepasan aset.
            </Typography.Paragraph>
            <Form form={form} layout="vertical" onFinish={(v) => doDispose.mutate(v)}>
              <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
              <Form.Item name="price" label="Harga jual (0 bila rusak / hilang)">
                <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
              </Form.Item>
              {Number(price) > 0 && (
                <Form.Item name="cashAccountId" label="Diterima di" rules={[{ required: true }]}>
                  <CashAccountSelect />
                </Form.Item>
              )}
            </Form>
          </Modal>
        </>
      )}
    </Drawer>
  );
}

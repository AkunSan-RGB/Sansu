import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { CashTxType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Typography, type FormInstance } from 'antd';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction, useBranches } from '@/api/queries';
import type { Project } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import CashAccountSelect from '@/components/CashAccountSelect';
import { withBudgetOverride } from '@/lib/budgetOverride';
import { fmtMoney } from '@/lib/format';
import { profileCostOptions } from '@/lib/profileCosts';
import { buildCashBody, cashAccountOptions, type AssetCatsByAccount, type CashFormValues, type CounterAccount } from './cashLogic';

const TITLE: Record<CashTxType, string> = {
  IN: 'Kas masuk — terima uang di luar penjualan',
  OUT: 'Kas keluar — bayar biaya / pengeluaran',
  TRANSFER: 'Transfer antar kas & bank',
};

/** Formulir uang masuk / uang keluar / pindah antar rekening. Formulirnya dimiliki halaman agar bisa diisi awal saat dibuka. */
export default function CashEntryModal({
  mode,
  form,
  onClose,
  assetCatsByAccount,
  activeProjects,
}: {
  mode: CashTxType | null;
  form: FormInstance<CashFormValues>;
  onClose: () => void;
  assetCatsByAccount: AssetCatsByAccount;
  activeProjects: Pick<Project, 'id' | 'code' | 'name'>[];
}) {
  const { me } = useAuth();
  const { modal } = App.useApp();
  const branches = useBranches();
  const lines = Form.useWatch('lines', form) ?? [];
  const counter = useQuery({
    queryKey: ['cash-counter-accounts'],
    queryFn: () => get<CounterAccount[]>('/cash/counter-accounts'),
    enabled: mode === 'IN' || mode === 'OUT',
  });
  const create = useAction(
    (v: CashFormValues) =>
      withBudgetOverride(modal, me?.role, (budgetOverrideReason) =>
        post<{ number: string; journalNumber: string }>('/cash/transactions', buildCashBody(mode, v, assetCatsByAccount, budgetOverrideReason)),
      ),
    {
      success: (r) => `${r.number} diposting · jurnal ${r.journalNumber}`,
      invalidate: LEDGER_KEYS,
      onSuccess: onClose,
    },
  );
  const withProject = mode === 'OUT' && activeProjects.length > 0;
  const linesTotal = lines.reduce((a, l) => a + (l?.amount ?? 0), 0);

  return (
    <Modal
      title={mode && TITLE[mode]}
      open={!!mode}
      width={mode === 'TRANSFER' ? 520 : 760}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Posting"
      confirmLoading={create.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
        <Row gutter={16}>
          <Col xs={24} md={mode === 'TRANSFER' ? 24 : 14}>
            <Form.Item
              name="cashAccountId"
              label={mode === 'IN' ? 'Masuk ke' : mode === 'OUT' ? 'Keluar dari' : 'Dari'}
              rules={[{ required: true }]}
            >
              <CashAccountSelect />
            </Form.Item>
          </Col>
          {mode === 'TRANSFER' && (
            <>
              <Col xs={24}>
                <Form.Item name="toCashAccountId" label="Ke" rules={[{ required: true }]}>
                  <CashAccountSelect />
                </Form.Item>
              </Col>
              <Col xs={24} md={14}>
                <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}>
                  <InputNumber min={1} style={{ width: '100%' }} prefix="Rp" />
                </Form.Item>
              </Col>
            </>
          )}
          <Col xs={24} md={10}>
            <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
          </Col>
          <Col xs={24} md={14}>
            <Form.Item name="description" label="Keterangan" rules={[{ required: true }]}>
              <Input placeholder={mode === 'OUT' ? 'Bayar listrik gudang Oktober' : mode === 'IN' ? 'Setoran modal pemilik' : 'Setor kas ke bank'} />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name="reference" label="No. bukti / referensi">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        {(mode === 'IN' || mode === 'OUT') && !!branches.data?.branches.filter((b) => b.isActive).length && (
          <Form.Item name="branchId" label="Cabang" extra="Kosong = pusat. Biaya/pendapatan ini masuk laporan laba rugi cabang yang dipilih.">
            <Select allowClear placeholder="Pusat / semua" options={branches.data.branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
          </Form.Item>
        )}

        {(mode === 'IN' || mode === 'OUT') && (
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                <Typography.Text strong>{mode === 'OUT' ? 'Dibebankan ke akun' : 'Sumber uang masuk'}</Typography.Text>
                {fields.map((f) => (
                  <Row gutter={8} key={f.key} style={{ marginTop: 8 }}>
                    <Col xs={24} md={withProject ? 8 : 11}>
                      <Form.Item name={[f.name, 'accountId']} rules={[{ required: true, message: mode === 'IN' ? 'Pilih sumber uang' : 'Pilih akun' }]} noStyle>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          style={{ width: '100%' }}
                          placeholder={mode === 'IN' ? 'Pilih sumber uang' : 'Pilih akun'}
                          loading={counter.isLoading}
                          options={cashAccountOptions(mode, me?.role, counter.data, assetCatsByAccount, profileCostOptions(me?.businessModel, me?.serviceProfiles, counter.data?.filter((a) => a.type === 'EXPENSE'))) as never}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={withProject ? 5 : 6}>
                      <Form.Item name={[f.name, 'amount']} rules={[{ required: true, message: 'Isi jumlah' }]} noStyle>
                        <InputNumber min={1} style={{ width: '100%' }} placeholder="Jumlah" />
                      </Form.Item>
                    </Col>
                    <Col xs={10} md={withProject ? 5 : 6}>
                      <Form.Item name={[f.name, 'memo']} noStyle>
                        <Input placeholder="Catatan" />
                      </Form.Item>
                    </Col>
                    {withProject && (
                      <Col xs={22} md={5}>
                        <Form.Item name={[f.name, 'projectId']} noStyle>
                          <Select
                            allowClear
                            style={{ width: '100%' }}
                            placeholder="Proyek (opsional)"
                            options={activeProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                          />
                        </Form.Item>
                      </Col>
                    )}
                    {mode === 'OUT' && lines[f.name]?.accountId && assetCatsByAccount.has(lines[f.name]!.accountId!) && (
                      <Col span={24}>
                        <Alert
                          type="info"
                          showIcon
                          style={{ marginTop: 6 }}
                          message="Akun aset tetap: transaksi ini otomatis masuk ke daftar Aset Tetap"
                          description={
                            <Row gutter={8} style={{ marginTop: 6 }}>
                              {(assetCatsByAccount.get(lines[f.name]!.accountId!)?.length ?? 0) > 1 && (
                                <Col xs={24} md={6}>
                                  <Form.Item name={[f.name, 'assetCategoryId']} rules={[{ required: true, message: 'Pilih kategori aset' }]} noStyle>
                                    <Select placeholder="Kategori aset" options={assetCatsByAccount.get(lines[f.name]!.accountId!)!.map((c) => ({ value: c.id, label: c.name }))} />
                                  </Form.Item>
                                </Col>
                              )}
                              <Col xs={24} md={8}>
                                <Form.Item name={[f.name, 'assetName']} noStyle>
                                  <Input placeholder="Nama aset (kosong = catatan)" maxLength={160} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} md={5}>
                                <Form.Item name={[f.name, 'assetUsefulLifeMonths']} noStyle>
                                  <InputNumber min={0} max={600} style={{ width: '100%' }} placeholder="Masa manfaat (bln)" />
                                </Form.Item>
                              </Col>
                              {(assetCatsByAccount.get(lines[f.name]!.accountId!) ?? []).some((c) => c.method === 'UNITS_OF_PRODUCTION' && (!lines[f.name]!.assetCategoryId || c.id === lines[f.name]!.assetCategoryId)) && (
                                <>
                                  <Col xs={12} md={5}>
                                    <Form.Item name={[f.name, 'assetTotalUnits']} rules={[{ required: true, message: 'Isi total unit' }]} noStyle>
                                      <InputNumber min={1} style={{ width: '100%' }} placeholder="Total unit (kapasitas)" />
                                    </Form.Item>
                                  </Col>
                                  <Col xs={12} md={4}>
                                    <Form.Item name={[f.name, 'assetUnitLabel']} noStyle>
                                      <Input placeholder="Satuan" maxLength={20} />
                                    </Form.Item>
                                  </Col>
                                </>
                              )}
                              <Col xs={12} md={5}>
                                <Form.Item name={[f.name, 'assetLocation']} noStyle>
                                  <Input placeholder="Lokasi" maxLength={120} />
                                </Form.Item>
                              </Col>
                            </Row>
                          }
                        />
                      </Col>
                    )}
                    <Col xs={2} md={1}>
                      {fields.length > 1 && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />}
                    </Col>
                  </Row>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => add({})}>
                  Tambah akun
                </Button>
                <div style={{ textAlign: 'right', marginTop: 12 }}>
                  Total: <strong>{fmtMoney(linesTotal)}</strong>
                </div>
              </>
            )}
          </Form.List>
        )}
      </Form>
    </Modal>
  );
}

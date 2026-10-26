import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Form, type FormInstance, Input, InputNumber, Select, Space, Typography } from 'antd';
import { get } from '@/api/client';
import { useAccounts } from '@/api/queries';
import type { Project } from '@/api/types';
import { useApps } from '@/lib/apps';
import { fmtMoney } from '@/lib/format';
import { LineValue } from './shared';

/** Baris jurnal (akun, debit, kredit) yang dipakai jurnal manual & jurnal berulang */
export function LinesEditor({ form }: { form: FormInstance }) {
  const accounts = useAccounts();
  const postable = accounts.data?.filter((a) => a.isPostable && a.isActive !== false).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const lines: LineValue[] = Form.useWatch('lines', form) ?? [];
  const { can } = useApps();
  const projectList = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects'), enabled: can('sales') });
  const activeProjects = (projectList.data ?? []).filter((p) => p.status === 'ACTIVE');
  const foreignCurrency = (id?: string) => {
    const c = accounts.data?.find((a) => a.id === id)?.currency;
    return c && c !== 'IDR' ? c : undefined;
  };
  const isExpense = (id?: string) => accounts.data?.find((a) => a.id === id)?.type === 'EXPENSE';
  const totalD = lines.reduce((a, l) => a + (l?.debit ?? 0), 0);
  const totalC = lines.reduce((a, l) => a + (l?.credit ?? 0), 0);
  return (
    <>
      <Form.List name="lines">
        {(fields, { add, remove }) => (
          <>
            {fields.map((f) => (
              <Space key={f.key} align="baseline" wrap>
                <Form.Item name={[f.name, 'accountId']} rules={[{ required: true, message: 'Pilih akun' }]}>
                  <Select showSearch optionFilterProp="label" placeholder="Akun" style={{ width: 300 }} options={postable} />
                </Form.Item>
                <Form.Item name={[f.name, 'debit']}>
                  <InputNumber min={0} placeholder="Debit" style={{ width: 140 }} />
                </Form.Item>
                <Form.Item name={[f.name, 'credit']}>
                  <InputNumber min={0} placeholder="Kredit" style={{ width: 140 }} />
                </Form.Item>
                <Form.Item name={[f.name, 'memo']}>
                  <Input placeholder="Catatan baris" style={{ width: 160 }} />
                </Form.Item>
                {foreignCurrency(lines[f.name]?.accountId) && (
                  <Form.Item name={[f.name, 'foreignAmount']} rules={[{ required: true, message: 'Isi jumlah valas' }]} tooltip="Rekening valas: jumlah dalam mata uangnya wajib diisi">
                    <InputNumber min={0.01} placeholder={`Jumlah ${foreignCurrency(lines[f.name]?.accountId)}`} style={{ width: 150 }} />
                  </Form.Item>
                )}
                {activeProjects.length > 0 && isExpense(lines[f.name]?.accountId) && (
                  <Form.Item name={[f.name, 'projectId']} tooltip="Biaya langsung proyek">
                    <Select
                      allowClear
                      placeholder="Proyek (opsional)"
                      style={{ width: 200 }}
                      options={activeProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                    />
                  </Form.Item>
                )}
                {fields.length > 2 && <MinusCircleOutlined onClick={() => remove(f.name)} />}
              </Space>
            ))}
            <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add()}>
              Tambah baris
            </Button>
          </>
        )}
      </Form.List>
      <Typography.Paragraph style={{ marginTop: 12 }} type={totalD === totalC && totalD > 0 ? 'success' : 'danger'}>
        Debit {fmtMoney(totalD)} · Kredit {fmtMoney(totalC)} {totalD === totalC && totalD > 0 ? '· seimbang' : '· belum seimbang'}
      </Typography.Paragraph>
    </>
  );
}

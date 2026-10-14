import { PlusOutlined } from '@ant-design/icons';
import { isProductionModel, PTKP_STATUSES } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Col, Drawer, Form, Input, InputNumber, Row, Select, Switch, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, patch, post } from '@/api/client';
import { useAction, useBranches } from '@/api/queries';
import type { Employee, Project } from '@/api/types';
import { useApps } from '@/lib/apps';
import { useAuth } from '@/auth/AuthContext';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney, today } from '@/lib/format';

const PTKP_HELP: Record<string, string> = {
  'TK/0': 'Tidak kawin, tanpa tanggungan',
  'TK/1': 'Tidak kawin, 1 tanggungan',
  'TK/2': 'Tidak kawin, 2 tanggungan',
  'TK/3': 'Tidak kawin, 3 tanggungan',
  'K/0': 'Kawin, tanpa tanggungan',
  'K/1': 'Kawin, 1 tanggungan',
  'K/2': 'Kawin, 2 tanggungan',
  'K/3': 'Kawin, 3 tanggungan',
};

const MONEY = ['baseSalary', 'fixedAllowance', 'dailyAllowance'] as const;

export default function EmployeesPage() {
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [form] = Form.useForm();
  const { data, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => get<Employee[]>('/hr/employees') });
  const detail = useQuery({
    queryKey: ['employees', 'detail', editing !== 'new' && editing?.id],
    queryFn: () => get<Employee>(`/hr/employees/${(editing as Employee).id}`),
    enabled: !!editing && editing !== 'new',
  });

  const branchList = useBranches();
  const activeBranches = (branchList.data?.branches ?? []).filter((b) => b.isActive);
  const { can } = useApps();
  const { me } = useAuth();
  const projectList = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects'), enabled: can('sales') });
  const activeProjects = (projectList.data ?? []).filter((p) => p.status === 'ACTIVE');

  const save = useAction(
    (v: Record<string, unknown>) => {
      const body = { ...v };
      MONEY.forEach((k) => (body[k] = String(v[k] ?? 0)));
      Object.keys(body).forEach((k) => body[k] === '' && delete body[k]);
      if (activeProjects.length) body.projectId = v.projectId ?? null;
      return editing === 'new' ? post('/hr/employees', body) : patch(`/hr/employees/${(editing as Employee).id}`, body);
    },
    { success: 'Data karyawan disimpan', invalidate: ['employees', 'payroll'], onSuccess: () => setEditing(null) },
  );

  const open = (e: Employee | 'new') => {
    form.resetFields();
    if (e === 'new') form.setFieldsValue({ ptkp: 'TK/0', joinDate: today(), bpjsKes: true, bpjsTk: true, bpjsJp: true, annualLeave: 12, fixedAllowance: 0, dailyAllowance: 0 });
    else form.setFieldsValue({ ...e, ...Object.fromEntries(MONEY.map((k) => [k, Number(e[k])])) });
    setEditing(e);
  };

  return (
    <>
      <ListPage<Employee>
        title="Karyawan"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            Karyawan baru
          </Button>
        }
        rows={data}
        loading={isLoading}
        summary={(all) => {
          const active = all.filter((e) => e.isActive);
          return [
            { label: 'Karyawan aktif', value: String(active.length), hint: `${all.length - active.length} nonaktif` },
            { label: 'Gaji per bulan (pokok + tunjangan tetap)', value: fmtMoney(active.reduce((a, e) => a + Number(e.baseSalary) + Number(e.fixedAllowance), 0)) },
            { label: 'Departemen', value: String(new Set(active.map((e) => e.department).filter(Boolean)).size) },
          ];
        }}
        views={[
          { value: 'ACTIVE', label: 'Aktif', test: (e) => e.isActive },
          { value: 'ALL', label: 'Semua', test: () => true },
          { value: 'OFF', label: 'Nonaktif', test: (e) => !e.isActive },
        ]}
        searchText={(e) => `${e.code} ${e.name} ${e.jobTitle ?? ''} ${e.department ?? ''}`}
        searchPlaceholder="Cari nama, jabatan, atau departemen"
        emptyText="Belum ada karyawan"
        onRowClick={(e) => open(e)}
        scrollX={820}
        columns={[
          { title: 'Karyawan', dataIndex: 'name', render: (n: string, e: Employee) => <div><div>{n}{!e.isActive && <Tag style={{ marginLeft: 6 }}>Nonaktif</Tag>}</div><span style={{ fontSize: 12, color: '#64748b' }}>{e.code}</span></div> },
          { title: 'Jabatan', render: (_: unknown, e: Employee) => <div><div>{e.jobTitle || '-'}</div><span style={{ fontSize: 12, color: '#64748b' }}>{e.department || ''}</span></div> },
          { title: 'PTKP', dataIndex: 'ptkp' },
          { title: 'Mulai kerja', dataIndex: 'joinDate', render: fmtDate },
          { title: 'Gaji pokok', dataIndex: 'baseSalary', align: 'right' as const, render: fmtMoney },
        ]}
      />

      <Drawer
        title={editing === 'new' ? 'Karyawan baru' : editing ? editing.name : ''}
        open={!!editing}
        onClose={() => setEditing(null)}
        width={Math.min(720, window.innerWidth)}
        destroyOnHidden
        extra={
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            Simpan
          </Button>
        }
      >
        {detail.data?.leave && (
          <Tag color="blue" style={{ marginBottom: 12 }}>
            Sisa cuti tahunan {detail.data.leave.year}: {detail.data.leave.remaining} dari {detail.data.leave.quota} hari
          </Tag>
        )}
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Typography.Title level={5}>Data diri</Typography.Title>
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item name="code" label="Kode / NIP" rules={[{ required: true }]}>
                <Input placeholder="EMP-005" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={16}>
              <Form.Item name="name" label="Nama lengkap" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="nik" label="NIK (KTP)" extra="NIK juga berfungsi sebagai NPWP">
                <Input maxLength={16} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="ptkp" label="Status PTKP" rules={[{ required: true }]}>
                <Select options={PTKP_STATUSES.map((p) => ({ value: p, label: `${p} — ${PTKP_HELP[p]}` }))} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="birthDate" label="Tanggal lahir">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="phone" label="Telepon">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="address" label="Alamat">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Title level={5}>Pekerjaan</Typography.Title>
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item name="jobTitle" label="Jabatan">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="department" label="Departemen">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="joinDate" label="Mulai kerja" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            {isProductionModel(me?.businessModel) && (
              <Col xs={24}>
                <Form.Item
                  name="isProduction"
                  valuePropName="checked"
                  extra="Gaji & iuran BPJS perusahaan dicatat ke Upah Langsung Produksi (bagian harga pokok produksi), bukan beban kantor."
                >
                  <Checkbox>Tenaga kerja langsung produksi (penjahit, operator mesin, tukang)</Checkbox>
                </Form.Item>
              </Col>
            )}
            {activeProjects.length > 0 && (
              <Col xs={24}>
                <Form.Item
                  name="projectId"
                  label="Ditempatkan di proyek"
                  extra="Gaji & iuran BPJS perusahaan karyawan ini dihitung sebagai biaya langsung proyek mulai penggajian berikutnya. Kosong = kantor / biaya bersama."
                >
                  <Select allowClear placeholder="Kantor (biaya bersama)" options={activeProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} />
                </Form.Item>
              </Col>
            )}
            <Col xs={12} sm={8}>
              <Form.Item name="annualLeave" label="Jatah cuti / tahun">
                <InputNumber min={0} max={60} suffix="hari" />
              </Form.Item>
            </Col>
            {editing !== 'new' && (
              <>
                <Col xs={12} sm={8}>
                  <Form.Item name="resignDate" label="Tanggal keluar">
                    <Input type="date" />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name="isActive" label="Aktif" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
              </>
            )}
          </Row>
          {activeBranches.length > 0 && (
            <Form.Item name="branchId" label="Cabang" extra="Gaji, BPJS, dan utang gaji karyawan ini dibebankan ke cabang yang dipilih. Kosong = Pusat.">
              <Select allowClear placeholder="Pusat" options={activeBranches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
            </Form.Item>
          )}
          <Typography.Title level={5}>Gaji & BPJS</Typography.Title>
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item name="baseSalary" label="Gaji pokok / bulan" rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="fixedAllowance" label="Tunjangan tetap / bulan">
                <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="dailyAllowance" label="Uang makan/transport per hari hadir">
                <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
              </Form.Item>
            </Col>
            <Col xs={8}>
              <Form.Item name="bpjsKes" valuePropName="checked">
                <Checkbox>BPJS Kesehatan</Checkbox>
              </Form.Item>
            </Col>
            <Col xs={8}>
              <Form.Item name="bpjsTk" valuePropName="checked">
                <Checkbox>BPJS TK (JHT, JKK, JKM)</Checkbox>
              </Form.Item>
            </Col>
            <Col xs={8}>
              <Form.Item name="bpjsJp" valuePropName="checked">
                <Checkbox>Jaminan Pensiun</Checkbox>
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="bankName" label="Bank">
                <Input placeholder="BCA" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={16}>
              <Form.Item name="bankAccount" label="No. rekening">
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Drawer>
    </>
  );
}

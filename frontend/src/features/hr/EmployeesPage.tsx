import { PlusOutlined } from '@ant-design/icons';
import { isProductionModel, PTKP_STATUSES } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Col, Drawer, Form, Input, InputNumber, Popconfirm, Row, Select, Switch, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, patch, post, put } from '@/api/client';
import { useAction, useBranches } from '@/api/queries';
import type { Employee, Project } from '@/api/types';
import { useApps } from '@/lib/apps';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
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

const MONEY = ['baseSalary', 'fixedAllowance', 'dailyAllowance', 'dailyWage'] as const;
export const EMP_TYPES: Record<string, { label: string; color: string; hint: string }> = {
  TETAP: { label: 'Tetap', color: 'green', hint: 'Gaji bulanan tetap, BPJS, absensi.' },
  KONTRAK: { label: 'Kontrak', color: 'blue', hint: 'Gaji bulanan sampai tanggal akhir kontrak; setelah itu gaji berhenti otomatis kecuali diperpanjang (dengan persetujuan).' },
  HARIAN: { label: 'Harian', color: 'gold', hint: 'Dibayar per hari yang dicatat HADIR di absensi (tidak dianggap hadir otomatis).' },
  TENAGA_LEPAS: { label: 'Tenaga lepas', color: 'purple', hint: 'Tanpa gaji tetap & absensi; dibayar dari catatan kerja (jam / sesi / borongan / komisi) di menu Upah jasa.' },
  MAGANG: { label: 'Magang', color: 'cyan', hint: 'Uang saku bulanan sampai tanggal akhir magang.' },
  MITRA: { label: 'Mitra / konsultan', color: 'magenta', hint: 'Dibayar dari catatan kerja; bukan karyawan tetap.' },
};

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
  const canDo = useCan();
  const isJasa = me?.businessModel === 'JASA';
  const empType = Form.useWatch('employmentType', form) as string | undefined;
  const perJob = empType === 'TENAGA_LEPAS' || empType === 'MITRA';
  const projectList = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects'), enabled: can('sales') });
  const activeProjects = (projectList.data ?? []).filter((p) => p.status === 'ACTIVE');

  const save = useAction(
    (v: Record<string, unknown>) => {
      const body = { ...v };
      MONEY.forEach((k) => (body[k] = String(v[k] ?? 0)));
      Object.keys(body).forEach((k) => body[k] === '' && delete body[k]);
      if (activeProjects.length) body.projectId = v.projectId ?? null;
      if (!isJasa) {
        ['employmentType', 'contractStart', 'contractEnd', 'dailyWage'].forEach((k) => delete body[k]);
      } else {
        if (body.contractStart === undefined || body.contractStart === '') body.contractStart = null;
        if (body.contractEnd === undefined || body.contractEnd === '') body.contractEnd = null;
        if (['TETAP', 'HARIAN', 'TENAGA_LEPAS', 'MITRA'].includes(String(body.employmentType))) body.contractEnd = null;
      }
      return editing === 'new' ? post<Employee>('/hr/employees', body) : patch<Employee>(`/hr/employees/${(editing as Employee).id}`, body);
    },
    { success: (r: Employee) => (r?.pendingChange ? 'Disimpan. Perubahan gaji / rekening / status menunggu persetujuan Keuangan atau Admin.' : editing === 'new' && isJasa && r && r.verified === false ? 'Karyawan disimpan, menunggu verifikasi Keuangan / Admin sebelum ikut penggajian.' : 'Data karyawan disimpan'), invalidate: ['employees', 'payroll'], onSuccess: () => setEditing(null) },
  );

  const open = (e: Employee | 'new') => {
    form.resetFields();
    if (e === 'new') form.setFieldsValue({ employmentType: 'TETAP', ptkp: 'TK/0', joinDate: today(), bpjsKes: true, bpjsTk: true, bpjsJp: true, annualLeave: 12, fixedAllowance: 0, dailyAllowance: 0 });
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
            isJasa
              ? { label: 'Menunggu verifikasi', value: String(active.filter((e) => e.verified === false).length), hint: 'belum ikut penggajian' }
              : { label: 'Departemen', value: String(new Set(active.map((e) => e.department).filter(Boolean)).size) },
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
          ...(isJasa ? [{ title: 'Status', render: (_: unknown, e: Employee) => <span><Tag color={EMP_TYPES[e.employmentType ?? 'TETAP']?.color}>{EMP_TYPES[e.employmentType ?? 'TETAP']?.label}</Tag>{e.verified === false && <Tag color="orange">Belum diverifikasi</Tag>}{e.contractEnd && <div style={{ fontSize: 12, color: '#64748b' }}>s/d {fmtDate(e.contractEnd)}</div>}</span> }] : []),
          { title: 'PTKP', dataIndex: 'ptkp' },
          { title: 'Mulai kerja', dataIndex: 'joinDate', render: fmtDate },
          { title: isJasa ? 'Gaji / upah' : 'Gaji pokok', dataIndex: 'baseSalary', align: 'right' as const, render: (v: string, e: Employee) => (e.employmentType === 'HARIAN' ? `${fmtMoney(e.dailyWage ?? 0)} / hari` : e.employmentType === 'TENAGA_LEPAS' || e.employmentType === 'MITRA' ? 'per catatan kerja' : fmtMoney(v)) },
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
        {editing && editing !== 'new' && canDo('PUT', '/hr/employees/:id/account') && <AccountLink employeeId={editing.id} userId={(detail.data as { userId?: string | null } | undefined)?.userId ?? null} />}
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
          {isJasa && editing !== 'new' && editing && editing.verified === false && (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Karyawan ini belum diverifikasi, jadi belum ikut penggajian dan belum bisa dicatat upah jasanya."
              action={canDo('POST', '/hr/employment/employees/:id/verify') ? <VerifyButton id={editing.id} onDone={() => setEditing(null)} /> : undefined} />
          )}
          {isJasa && editing !== 'new' && (
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Mengubah gaji, tunjangan, rekening, status, kontrak, BPJS, PTKP, NIK/NPWP perlu persetujuan Keuangan atau Admin (orang lain dari Anda). Perubahan lainnya langsung berlaku." />
          )}
          <Row gutter={12}>
            {isJasa && (
              <>
                <Col xs={24} sm={12}>
                  <Form.Item name="employmentType" label="Status kepegawaian" rules={[{ required: true }]} extra={EMP_TYPES[empType ?? 'TETAP']?.hint}>
                    <Select options={Object.entries(EMP_TYPES).map(([value, t]) => ({ value, label: t.label }))} />
                  </Form.Item>
                </Col>
                {(empType === 'KONTRAK' || empType === 'MAGANG') && (
                  <>
                    <Col xs={12} sm={6}>
                      <Form.Item name="contractStart" label="Kontrak mulai"><Input type="date" /></Form.Item>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Form.Item name="contractEnd" label="Kontrak berakhir" rules={[{ required: true, message: 'Wajib untuk kontrak / magang' }]}><Input type="date" /></Form.Item>
                    </Col>
                  </>
                )}
              </>
            )}
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
            {isJasa && empType === 'HARIAN' ? (
              <Col xs={24} sm={8}>
                <Form.Item name="dailyWage" label="Upah per hari hadir" rules={[{ required: true }]}>
                  <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                </Form.Item>
              </Col>
            ) : null}
            {!(isJasa && (perJob || empType === 'HARIAN')) && (
              <>
                <Col xs={24} sm={8}>
                  <Form.Item name="baseSalary" label={empType === 'MAGANG' ? 'Uang saku / bulan' : 'Gaji pokok / bulan'} rules={[{ required: true }]}>
                    <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={8}>
                  <Form.Item name="fixedAllowance" label="Tunjangan tetap / bulan">
                    <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                  </Form.Item>
                </Col>
              </>
            )}
            {!(isJasa && perJob) && (
              <Col xs={24} sm={8}>
                <Form.Item name="dailyAllowance" label="Uang makan/transport per hari hadir">
                  <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
                </Form.Item>
              </Col>
            )}
            {isJasa && perJob && (
              <Col span={24}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Tenaga lepas / mitra tidak punya gaji tetap, BPJS, absensi, atau cuti. Upahnya dari menu Penggajian → Upah jasa. Perlakuan PPh 21 tenaga lepas berbeda dari pegawai tetap — konsultasikan dengan konsultan pajak." />
              </Col>
            )}
            <Col xs={8}>
              <Form.Item name="bpjsKes" valuePropName="checked">
                <Checkbox disabled={isJasa && perJob}>BPJS Kesehatan</Checkbox>
              </Form.Item>
            </Col>
            <Col xs={8}>
              <Form.Item name="bpjsTk" valuePropName="checked">
                <Checkbox disabled={isJasa && perJob}>BPJS TK (JHT, JKK, JKM)</Checkbox>
              </Form.Item>
            </Col>
            <Col xs={8}>
              <Form.Item name="bpjsJp" valuePropName="checked">
                <Checkbox disabled={isJasa && perJob}>Jaminan Pensiun</Checkbox>
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

function VerifyButton({ id, onDone }: { id: string; onDone: () => void }) {
  const verify = useAction(() => post(`/hr/employment/employees/${id}/verify`, {}), { success: 'Karyawan diverifikasi — ikut penggajian', invalidate: ['employees', 'payroll'], onSuccess: onDone });
  return (
    <Popconfirm title="Verifikasi karyawan ini? Periksa nama, status, gaji, dan rekening dulu." onConfirm={() => verify.mutate(undefined)}>
      <Button size="small" type="primary" loading={verify.isPending}>Verifikasi</Button>
    </Popconfirm>
  );
}

interface Account { id: string; name: string; email: string; role: string; employeeId: string | null; employeeName: string | null }

/** Hubungan akun login ↔ data karyawan: syarat agar karyawan bisa mencatat jam kerja, melihat jadwal, dan mengajukan cuti atas namanya */
function AccountLink({ employeeId, userId }: { employeeId: string; userId: string | null }) {
  const accounts = useQuery({ queryKey: ['employees', 'accounts'], queryFn: () => get<Account[]>('/hr/employee-accounts') });
  const [sel, setSel] = useState<string | null | undefined>(undefined);
  const [reason, setReason] = useState('');
  const current = accounts.data?.find((a) => a.id === userId);
  const save = useAction((v: { userId: string | null; reason?: string }) => put(`/hr/employees/${employeeId}/account`, v), { success: 'Hubungan akun tersimpan', invalidate: ['employees'], onSuccess: () => { setSel(undefined); setReason(''); } });
  const value = sel === undefined ? userId : sel;
  const changed = sel !== undefined && sel !== userId;
  return (
    <div style={{ marginBottom: 16 }}>
      <Typography.Text strong>Akun pengguna</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ margin: '2px 0 8px' }}>
        {current ? `Terhubung dengan ${current.name} (${current.email}).` : 'Belum terhubung. Hubungkan agar karyawan ini bisa mencatat jam kerja, melihat jadwal, dan mengajukan cuti atas namanya sendiri.'}
      </Typography.Paragraph>
      <Select showSearch allowClear optionFilterProp="label" style={{ width: '100%' }} placeholder="Pilih akun pengguna" value={value ?? undefined} onChange={(v) => setSel(v ?? null)}
        options={(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.name} · ${a.email}${a.employeeId && a.employeeId !== employeeId ? ` (sudah dipakai ${a.employeeName})` : ''}`, disabled: !!a.employeeId && a.employeeId !== employeeId }))} />
      {changed && (
        <div style={{ marginTop: 8 }}>
          {userId && <Input placeholder="Alasan mengganti/melepas (min. 5 huruf)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} style={{ marginBottom: 8 }} />}
          <Button type="primary" loading={save.isPending} disabled={!!userId && reason.trim().length < 5} onClick={() => save.mutate({ userId: sel ?? null, reason: reason.trim() || undefined })}>Simpan hubungan akun</Button>
        </div>
      )}
    </div>
  );
}

import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Drawer, Empty, Form, Input, InputNumber, Modal, Select, Space, Steps, Switch, Tabs, Tag, Timeline, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction, useCustomers, useSuppliers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

interface Stage { key: string; label: string; hint: string; next: string[]; terminal?: string; requireNote?: boolean; sod?: boolean; roles?: string[]; slaDays?: number; count: number }
interface Pipeline { key: string; label: string; summary: string; subject: 'CUSTOMER' | 'SUPPLIER' | 'NONE'; start: string; stages: Stage[] }
interface CaseRow { id: string; pipeline: string; number: string; title: string; stage: string; status: 'ACTIVE' | 'DONE' | 'CANCELLED'; amount: string; dueDate: string | null; stageEnteredAt: string; customerName: string | null; supplierName: string | null; linkCount: number; autoOpened?: boolean }
interface Detail extends CaseRow {
  pipelineLabel: string; stageLabel: string; stageHint: string; stages: { key: string; label: string; terminal: boolean }[];
  links: { id: string; type: string; docId: string; number: string; status: string | null; dead: boolean }[];
  linkTypes: { type: string; label: string }[];
  events: { id: number; kind: string; fromStage: string | null; toStage: string | null; note: string | null; auto: boolean; at: string; byName: string | null }[];
  moves: { to: string; label: string; needsNote: boolean; blocked: string[] }[];
  canCancel: boolean; canBack: boolean;
}
interface Alert { kind: string; severity: 'warn' | 'info'; caseId: string; number: string; message: string }
const STATUS_TAG = { ACTIVE: { color: 'blue', text: 'Berjalan' }, DONE: { color: 'green', text: 'Selesai' }, CANCELLED: { color: 'default', text: 'Dibatalkan' } };
const KIND: Record<string, string> = { CREATE: 'Kasus dibuka', ADVANCE: 'Pindah tahap', AUTO: 'Maju otomatis', LINK: 'Dokumen ditautkan', BACK: 'Dikembalikan', CANCEL: 'Dibatalkan' };

/** Alur kerja operasional sesuai jenis usaha perusahaan: papan tahap, kasus, dokumen terkait, dan riwayat */
export default function WorkflowPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: pipelines, isLoading } = useQuery({ queryKey: ['workflow', 'pipelines'], queryFn: () => get<Pipeline[]>('/workflow/pipelines') });
  const alerts = useQuery({ queryKey: ['workflow', 'alerts'], queryFn: () => get<Alert[]>('/workflow/alerts') });
  const [openId, setOpenId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const can = useCan();
  return (
    <>
      {embedded ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ color: 'rgba(0,0,0,0.55)' }}>Pantau satu proses dari awal sampai selesai: di tahap mana, siapa berikutnya, dan mana yang macet.</span>
          {can('PUT', '/workflow/settings') && <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>Pengaturan alur</Button>}
        </div>
      ) : (
        <PageHeader title="Alur kerja" extra={can('PUT', '/workflow/settings') && <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>Pengaturan alur</Button>} />
      )}
      {settingsOpen && <SettingsDrawer onClose={() => setSettingsOpen(false)} />}
      {!!alerts.data?.length && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`${alerts.data.length} hal perlu perhatian`}
          description={<ul style={{ margin: 0, paddingLeft: 18 }}>{alerts.data.slice(0, 5).map((a, i) => <li key={i}><a onClick={() => setOpenId(a.caseId)}>{a.message}</a></li>)}</ul>} />
      )}
      {!isLoading && !pipelines?.length && <Empty description="Belum ada alur kerja untuk jenis usaha ini" />}
      <Tabs items={(pipelines ?? []).map((p) => ({ key: p.key, label: p.label.split(':')[0], children: <PipelineTab p={p} onOpen={setOpenId} /> }))} />
      {openId && <CaseDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function PipelineTab({ p, onOpen }: { p: Pipeline; onOpen: (id: string) => void }) {
  const can = useCan();
  const [stage, setStage] = useState<string | undefined>();
  const [showDone, setShowDone] = useState(false);
  const cases = useQuery({ queryKey: ['workflow', 'cases', p.key], queryFn: () => get<CaseRow[]>(`/workflow/cases?pipeline=${p.key}`) });
  const [creating, setCreating] = useState(false);
  const { data: customers } = useCustomers();
  const { data: suppliers } = useSuppliers();
  const [form] = Form.useForm<{ title: string; customerId?: string; supplierId?: string; amount?: number; dueDate?: dayjs.Dayjs }>();
  const create = useAction(
    (v: { title: string; customerId?: string; supplierId?: string; amount?: number; dueDate?: dayjs.Dayjs }) =>
      post<{ id: string }>('/workflow/cases', { pipeline: p.key, title: v.title, customerId: v.customerId, supplierId: v.supplierId, amount: v.amount !== undefined ? String(v.amount) : undefined, dueDate: v.dueDate?.format('YYYY-MM-DD') }),
    { success: 'Kasus dibuka', invalidate: ['workflow'], onSuccess: (r) => { setCreating(false); onOpen(r.id); } },
  );
  const rows = (cases.data ?? []).filter((c) => (showDone ? true : c.status === 'ACTIVE') && (!stage || c.stage === stage));
  const label = (k: string) => p.stages.find((s) => s.key === k)?.label ?? k;
  const live = p.stages.filter((s) => s.key !== 'BATAL');
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={p.summary} description="Kasus hanya maju sesuai urutan tahap, oleh peran yang berhak, dengan dokumen terkait yang nyata. Tahap yang bisa dipastikan dari dokumen (mis. faktur lunas) maju otomatis." />
      <Space wrap style={{ marginBottom: 8 }}>
        {live.map((s) => (
          <Tooltip key={s.key} title={s.hint}>
            <Tag.CheckableTag checked={stage === s.key} onChange={(v) => setStage(v ? s.key : undefined)} style={{ border: '1px solid #e3e8f0', padding: '4px 10px' }}>
              {s.label} · {s.count}
            </Tag.CheckableTag>
          </Tooltip>
        ))}
        <Button size="small" type={showDone ? 'primary' : 'default'} onClick={() => setShowDone(!showDone)}>{showDone ? 'Semua kasus' : 'Hanya yang berjalan'}</Button>
        {can('POST', '/workflow/cases') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreating(true); }}>Kasus baru</Button>}
      </Space>
      <ResponsiveTable<CaseRow> rowKey="id" size="small" loading={cases.isLoading} dataSource={rows} pagination={{ pageSize: 15 }} scroll={{ x: 760 }} locale={{ emptyText: 'Belum ada kasus' }} onMobileClick={(c) => onOpen(c.id)}
        onRow={(c) => ({ onClick: () => onOpen(c.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Kasus', render: (_: unknown, c: CaseRow) => <div><strong>{c.number}</strong>{c.autoOpened && <Tag style={{ marginLeft: 6 }}>otomatis</Tag>}<div>{c.title}</div></div> },
          { title: p.subject === 'SUPPLIER' ? 'Pemasok' : p.subject === 'CUSTOMER' ? 'Pelanggan' : 'Pihak', render: (_: unknown, c: CaseRow) => c.customerName ?? c.supplierName ?? '—' },
          { title: 'Tahap', render: (_: unknown, c: CaseRow) => <span><Tag color={STATUS_TAG[c.status].color}>{c.status === 'ACTIVE' ? label(c.stage) : STATUS_TAG[c.status].text}</Tag></span> },
          { title: 'Di tahap ini', render: (_: unknown, c: CaseRow) => (c.status === 'ACTIVE' ? `${Math.max(0, dayjs().diff(dayjs(c.stageEnteredAt), 'day'))} hari` : '—') },
          { title: 'Nilai', align: 'right' as const, render: (_: unknown, c: CaseRow) => (Number(c.amount) ? fmtMoney(c.amount) : '—') },
          { title: 'Tenggat', render: (_: unknown, c: CaseRow) => (c.dueDate ? fmtDate(c.dueDate) : '—') },
        ]}
      />
      <Modal title={`Kasus baru — ${p.label}`} open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Buka kasus" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="title" label="Judul / keterangan" rules={[{ required: true, min: 3 }]}><Input maxLength={160} /></Form.Item>
          {p.subject === 'CUSTOMER' && <Form.Item name="customerId" label="Pelanggan"><Select allowClear showSearch optionFilterProp="label" options={(customers ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>}
          {p.subject === 'SUPPLIER' && <Form.Item name="supplierId" label="Pemasok"><Select allowClear showSearch optionFilterProp="label" options={(suppliers ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} /></Form.Item>}
          <Form.Item name="amount" label="Perkiraan nilai"><InputNumber min={0} prefix="Rp" style={{ width: 220 }} /></Form.Item>
          <Form.Item name="dueDate" label="Tenggat"><DatePicker style={{ width: '100%' }} disabledDate={(d) => d.isBefore(dayjs(), 'day')} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function CaseDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const can = useCan();
  const q = useQuery({ queryKey: ['workflow', 'case', id], queryFn: () => get<Detail>(`/workflow/cases/${id}`) });
  const d = q.data;
  const [moving, setMoving] = useState<{ to: string; label: string; needsNote: boolean } | null>(null);
  const [cancelling, setCancelling] = useState<'cancel' | 'back' | null>(null);
  const [linkType, setLinkType] = useState<string | undefined>();
  const [form] = Form.useForm<{ note: string }>();
  const cands = useQuery({ queryKey: ['workflow', 'candidates', linkType], queryFn: () => get<{ id: string; number: string; status: string }[]>(`/workflow/candidates?type=${linkType}`), enabled: !!linkType });
  const refresh = ['workflow'];
  const advance = useAction((v: { to: string; note?: string }) => post(`/workflow/cases/${id}/advance`, v), { success: 'Kasus dipindahkan', invalidate: refresh, onSuccess: () => setMoving(null) });
  const decide = useAction((v: { kind: 'cancel' | 'back'; note: string }) => post(`/workflow/cases/${id}/${v.kind}`, { note: v.note }), { success: 'Tersimpan', invalidate: refresh, onSuccess: () => setCancelling(null) });
  const link = useAction((docId: string) => post(`/workflow/cases/${id}/links`, { type: linkType, docId }), { success: 'Dokumen ditautkan', invalidate: refresh, onSuccess: () => setLinkType(undefined) });
  const active = d?.status === 'ACTIVE';
  const live = (d?.stages ?? []).filter((s) => s.key !== 'BATAL');
  const idx = Math.max(0, live.findIndex((s) => s.key === d?.stage));
  return (
    <Drawer open onClose={onClose} width={Math.min(640, window.innerWidth)} title={d ? `${d.number} · ${d.title}` : 'Kasus'} loading={q.isLoading} destroyOnHidden>
      {d && (
        <>
          <Space wrap style={{ marginBottom: 8 }}>
            <Tag color={STATUS_TAG[d.status].color}>{STATUS_TAG[d.status].text}</Tag>
            <span>{d.pipelineLabel}</span>
            {Number(d.amount) > 0 && <strong>{fmtMoney(d.amount)}</strong>}
          </Space>
          <Steps size="small" direction="vertical" current={d.status === 'ACTIVE' ? idx : live.length} status={d.status === 'CANCELLED' ? 'error' : undefined}
            items={live.map((s) => ({ title: s.label, description: s.key === d.stage && d.status === 'ACTIVE' ? d.stageHint : undefined }))} style={{ marginBottom: 12 }} />

          <h4>Dokumen terkait</h4>
          {!d.links.length && <div style={{ color: '#64748b', marginBottom: 8 }}>Belum ada. Tautkan dokumen nyata (pesanan, faktur, dst.) sebagai bukti tiap tahap.</div>}
          <Space direction="vertical" style={{ width: '100%', marginBottom: 8 }}>
            {d.links.map((l) => (
              <div key={l.id}>
                <Tag>{d.linkTypes.find((t) => t.type === l.type)?.label ?? l.type}</Tag> {l.number} <Tag color={l.dead ? 'red' : 'blue'}>{l.dead ? 'Dibatalkan / hilang' : l.status}</Tag>
              </div>
            ))}
          </Space>
          {active && can('POST', '/workflow/cases/:id/links') && (
            <Space wrap style={{ marginBottom: 12 }}>
              <Select placeholder="Jenis dokumen" style={{ width: 190 }} value={linkType} onChange={setLinkType} allowClear options={d.linkTypes.map((t) => ({ value: t.type, label: t.label }))} />
              {linkType && <Select showSearch placeholder="Pilih dokumen" style={{ width: 250 }} loading={cands.isLoading} optionFilterProp="label" onChange={(v) => link.mutate(v)} options={(cands.data ?? []).map((c) => ({ value: c.id, label: `${c.number} · ${c.status}` }))} notFoundContent="Tidak ada dokumen yang bisa ditautkan" />}
            </Space>
          )}

          {active && (
            <>
              <h4>Pindahkan ke tahap berikutnya</h4>
              <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
                {d.moves.map((m) => (
                  <div key={m.to}>
                    <Button type="primary" disabled={!!m.blocked.length || !can('POST', '/workflow/cases/:id/advance')} onClick={() => (m.needsNote ? (form.resetFields(), setMoving(m)) : advance.mutate({ to: m.to }))} loading={advance.isPending}>{m.label}</Button>
                    {!!m.blocked.length && <div style={{ color: '#b45309', fontSize: 12, marginTop: 2 }}>{m.blocked.join(' · ')}</div>}
                  </div>
                ))}
                {!d.moves.length && <span style={{ color: '#64748b' }}>Tidak ada tahap berikutnya.</span>}
              </Space>
              <Space wrap>
                {d.canBack && can('POST', '/workflow/cases/:id/back') && <Button onClick={() => { form.resetFields(); setCancelling('back'); }}>Kembalikan ke tahap sebelumnya</Button>}
                {d.canCancel && can('POST', '/workflow/cases/:id/cancel') && <Button danger onClick={() => { form.resetFields(); setCancelling('cancel'); }}>Batalkan kasus</Button>}
              </Space>
            </>
          )}

          <h4 style={{ marginTop: 16 }}>Riwayat</h4>
          <Timeline items={d.events.map((e) => ({ children: (<div><strong>{KIND[e.kind] ?? e.kind}</strong>{e.toStage && e.kind !== 'LINK' ? ` → ${live.concat((d.stages ?? []).filter((s) => s.key === 'BATAL')).find((s) => s.key === e.toStage)?.label ?? e.toStage}` : ''}{e.note ? `: ${e.note}` : ''}<div style={{ color: '#64748b', fontSize: 12 }}>{e.auto ? 'Sistem' : e.byName ?? '-'} · {dayjs(e.at).format('DD MMM YYYY HH:mm')}</div></div>) }))} />
        </>
      )}
      <Modal title={moving ? `Pindah ke "${moving.label}"` : ''} open={!!moving} onCancel={() => setMoving(null)} onOk={() => form.submit()} confirmLoading={advance.isPending} okText="Pindahkan" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => advance.mutate({ to: moving!.to, note: v.note })}>
          <Form.Item name="note" label="Catatan / bukti" rules={[{ required: true, min: 5, message: 'Isi catatan minimal 5 huruf' }]} extra="Mis. nomor kontrak, nomor berita acara, hasil pemeriksaan."><Input.TextArea rows={3} maxLength={500} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={cancelling === 'back' ? 'Kembalikan ke tahap sebelumnya' : 'Batalkan kasus'} open={!!cancelling} onCancel={() => setCancelling(null)} onOk={() => form.submit()} confirmLoading={decide.isPending} okText="Simpan" okButtonProps={{ danger: cancelling === 'cancel' }} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => decide.mutate({ kind: cancelling!, note: v.note })}>
          <Form.Item name="note" label="Alasan" rules={[{ required: true, min: 5, message: 'Isi alasan minimal 5 huruf' }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}

interface StageOverride { label?: string; roles?: string[]; requireNote?: boolean; sod?: boolean; slaDays?: number | null }
type Overrides = Record<string, Record<string, StageOverride>>;
interface SettingsData { settings: { autoOpen: boolean; enforce: boolean; overrides: Overrides }; defaults: Pipeline[] }

/** Pengaturan alur: buka kasus otomatis, "alur wajib", dan penyesuaian tahap (hanya boleh memperketat) */
function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['workflow', 'settings'], queryFn: () => get<SettingsData>('/workflow/settings') });
  const [autoOpen, setAutoOpen] = useState<boolean | undefined>();
  const [enforce, setEnforce] = useState<boolean | undefined>();
  const [ov, setOv] = useState<Overrides | undefined>();
  const d = q.data;
  const cur = ov ?? d?.settings.overrides ?? {};
  const set = (pk: string, sk: string, patch: StageOverride) => setOv({ ...cur, [pk]: { ...(cur[pk] ?? {}), [sk]: { ...(cur[pk]?.[sk] ?? {}), ...patch } } });
  const save = useAction(
    () => put('/workflow/settings', { autoOpen: autoOpen ?? d?.settings.autoOpen, enforce: enforce ?? d?.settings.enforce, overrides: cur }),
    { success: 'Pengaturan alur tersimpan', invalidate: ['workflow'], onSuccess: onClose },
  );
  return (
    <Drawer open onClose={onClose} width={Math.min(720, window.innerWidth)} title="Pengaturan alur kerja" loading={q.isLoading} destroyOnHidden
      extra={<Button type="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Simpan</Button>}>
      {d && (
        <>
          <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
            <div><Switch checked={autoOpen ?? d.settings.autoOpen} onChange={setAutoOpen} /> Buka kasus otomatis dari dokumen baru (pesanan, pembelian, sesi kasir, produksi, ...) dan dari stok di bawah minimum</div>
            <div><Switch checked={enforce ?? d.settings.enforce} onChange={setEnforce} /> Alur wajib: bayar tagihan pemasok dan mulai produksi ditolak bila tahap alurnya belum tercapai</div>
          </Space>
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Penyesuaian hanya boleh memperketat" description="Anda bisa mempersempit peran, mewajibkan catatan atau pemeriksa berbeda, memperpendek batas hari, dan mengganti nama tahap. Aturan bawaan tidak bisa dilonggarkan." />
          <Tabs items={d.defaults.map((p) => ({
            key: p.key, label: p.label.split(':')[0],
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                {p.stages.filter((s) => s.key !== 'BATAL').map((s) => {
                  const o = cur[p.key]?.[s.key] ?? {};
                  return (
                    <div key={s.key} style={{ border: '1px solid #e3e8f0', borderRadius: 8, padding: 10 }}>
                      <Input value={o.label ?? s.label} maxLength={40} onChange={(e) => set(p.key, s.key, { label: e.target.value })} style={{ fontWeight: 600, marginBottom: 6 }} />
                      <Space wrap>
                        <Select mode="multiple" style={{ minWidth: 220 }} value={o.roles ?? s.roles} options={(s.roles ?? []).map((r) => ({ value: r, label: r }))} onChange={(v) => set(p.key, s.key, { roles: v })} placeholder="Peran" />
                        <span><Switch size="small" checked={o.requireNote ?? !!s.requireNote} disabled={!!s.requireNote} onChange={(v) => set(p.key, s.key, { requireNote: v })} /> Catatan wajib</span>
                        <span><Switch size="small" checked={o.sod ?? !!s.sod} disabled={!!s.sod} onChange={(v) => set(p.key, s.key, { sod: v })} /> Pemeriksa berbeda</span>
                        <span>Batas hari <InputNumber size="small" min={1} max={s.slaDays ?? 365} value={o.slaDays === undefined ? s.slaDays : o.slaDays ?? undefined} onChange={(v) => set(p.key, s.key, { slaDays: v ?? undefined })} style={{ width: 70 }} /></span>
                      </Space>
                    </div>
                  );
                })}
              </Space>
            ),
          }))} />
        </>
      )}
    </Drawer>
  );
}

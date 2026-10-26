import { useQuery } from '@tanstack/react-query';
import { Card, Col, Form, Input, Modal, Row, Select, Statistic, Tag } from 'antd';
import type { ReactNode } from 'react';
import { get } from '@/api/client';
import { Connection } from '../utility/shared';

/** Petugas/pengguna aktif perusahaan, untuk memilih penanggung jawab */
export interface Staff { id: string; name: string; role: string }
export function useStaff() {
  return useQuery({ queryKey: ['utility', 'staff'], queryFn: () => get<Staff[]>('/utility/staff'), staleTime: 60_000 });
}
export function StaffSelect({ value, onChange, placeholder = 'Pilih petugas', allowClear }: { value?: string; onChange?: (v?: string) => void; placeholder?: string; allowClear?: boolean }) {
  const staff = useStaff();
  return <Select showSearch allowClear={allowClear} optionFilterProp="label" placeholder={placeholder} value={value} onChange={onChange} options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))} style={{ width: '100%' }} />;
}

export function useConnections() {
  return useQuery({ queryKey: ['utility', 'connections'], queryFn: () => get<Connection[]>('/utility/connections') });
}
/** Pilih sambungan: dicari menurut nomor, nama pelanggan, atau alamat */
export function ConnectionSelect({ value, onChange, placeholder = 'Cari nomor, nama, atau alamat', allowClear, filter }: { value?: string; onChange?: (v?: string) => void; placeholder?: string; allowClear?: boolean; filter?: (c: Connection) => boolean }) {
  const conns = useConnections();
  const list = (conns.data ?? []).filter((c) => (filter ? filter(c) : true));
  return (
    <Select showSearch allowClear={allowClear} optionFilterProp="label" placeholder={placeholder} value={value} onChange={onChange} loading={conns.isLoading} style={{ width: '100%' }}
      options={list.map((c) => ({ value: c.id, label: `${c.number} — ${c.customerName} — ${c.address}` }))} />
  );
}

export const opt = <T extends string>(keys: readonly T[], labels: Record<T, string>) => keys.map((k) => ({ value: k, label: labels[k] }));

/** Deretan angka ringkas di atas halaman; kartu yang diberi `onClick` bisa dipakai sebagai saringan */
export interface Stat { title: string; value: number | string; warn?: boolean; ok?: boolean; hint?: string; onClick?: () => void }
export function Stats({ items }: { items: Stat[] }) {
  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
      {items.map((s) => (
        <Col key={s.title} xs={12} md={8} lg={6}>
          <Card size="small" hoverable={!!s.onClick} onClick={s.onClick}>
            <Statistic title={s.title} value={s.value} valueStyle={s.warn ? { color: '#d97706' } : s.ok ? { color: '#16a34a' } : undefined} />
            {s.hint && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{s.hint}</div>}
          </Card>
        </Col>
      ))}
    </Row>
  );
}

export const PRIORITY_COLOR: Record<string, string> = { TINGGI: 'red', NORMAL: 'blue', RENDAH: 'default' };
export const tag = (color: string, text: ReactNode) => <Tag color={color}>{text}</Tag>;

/** Kotak konfirmasi dengan satu isian alasan/catatan wajib atau opsional */
export function ReasonModal({ open, title, label = 'Alasan', required = true, okText = 'Simpan', danger, onCancel, onSubmit, loading, extra }: {
  open: boolean; title: string; label?: string; required?: boolean; okText?: string; danger?: boolean; loading?: boolean; extra?: ReactNode;
  onCancel: () => void; onSubmit: (text: string) => void;
}) {
  const [f] = Form.useForm<{ text: string }>();
  return (
    <Modal open={open} title={title} okText={okText} okButtonProps={{ danger, loading }} cancelText="Batal" destroyOnHidden onCancel={onCancel} onOk={() => f.validateFields().then((v) => onSubmit(v.text ?? ''))}>
      {extra}
      <Form form={f} layout="vertical" style={{ marginTop: extra ? 12 : 0 }}>
        <Form.Item name="text" label={label} rules={[{ required, message: `${label} wajib diisi` }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
      </Form>
    </Modal>
  );
}

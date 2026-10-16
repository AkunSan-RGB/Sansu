import { DeleteOutlined, EditOutlined, MergeCellsOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import CategoryField, { categoryUsage } from '@/components/CategoryField';
import { useApps } from '@/lib/apps';
import { t } from '@/lib/terms';

interface Cats {
  items: { name: string; count: number }[];
  duplicates: { suggested: string; variants: { name: string; count: number }[] }[];
}
type MergeResult = { updated: number; to: string | null };

/** Kelola kategori produk: satukan ejaan ganda, ganti nama, gabungkan ke kategori lain, atau hapus kategori */
export default function CategoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const can = useCan();
  const { can: hasApp } = useApps();
  const noun = t('produk');
  const canMerge = can('POST', '/products/categories/merge');
  const q = useQuery({ queryKey: ['products', 'categories'], queryFn: () => get<Cats>('/products/categories'), enabled: open });
  const [moving, setMoving] = useState<{ name: string; count: number } | null>(null);
  const [target, setTarget] = useState<string | undefined>();
  const merge = useAction((v: { from: string[]; to: string | null }) => post<MergeResult>('/products/categories/merge', v), {
    invalidate: ['products'],
    success: (r) => `${r.updated} ${noun} dipindahkan${r.to ? ` ke "${r.to}"` : ' (tanpa kategori)'}`,
    onSuccess: () => setMoving(null),
  });
  const d = q.data;
  const [newName, setNewName] = useState('');
  const add = useAction((name: string) => post<{ name: string }>('/products/categories', { name }), { success: (r) => `Kategori "${r.name}" ditambahkan ke daftar pilihan`, invalidate: ['products'], onSuccess: () => setNewName('') });

  return (
    <Modal title="Kelola kategori" open={open} onCancel={onClose} footer={<Button onClick={onClose}>Tutup</Button>} width={680} destroyOnHidden>
      <Typography.Paragraph type="secondary">
        Kategori dipakai di {categoryUsage(hasApp)}. Di form produk kategori hanya bisa dipilih dari daftar; tambahkan kategori baru di sini. Satukan kategori yang ejaannya terpecah, ganti nama, atau gabungkan ke kategori lain; semua {noun} terkait ikut berpindah.
      </Typography.Paragraph>
      {canMerge && (
        <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
          <Input placeholder="Nama kategori baru (muncul sebagai pilihan di form produk)" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} onPressEnter={() => newName.trim() && add.mutate(newName)} />
          <Button type="primary" loading={add.isPending} disabled={!newName.trim()} onClick={() => add.mutate(newName)}>Tambah kategori</Button>
        </Space.Compact>
      )}
      {d?.duplicates.length ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Ejaan kategori ganda ditemukan"
          description={
            <Space direction="vertical" style={{ width: '100%' }}>
              {d.duplicates.map((g) => (
                <div key={g.suggested} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>
                    {g.variants.map((v) => (
                      <Tag key={v.name}>{`"${v.name}" (${v.count})`}</Tag>
                    ))}
                  </span>
                  {canMerge && (
                    <Popconfirm title={`Satukan menjadi "${g.suggested}"?`} okText="Satukan" cancelText="Batal" onConfirm={() => merge.mutate({ from: g.variants.map((v) => v.name), to: g.suggested })}>
                      <Button size="small" type="primary" icon={<MergeCellsOutlined />} loading={merge.isPending}>
                        Satukan ke "{g.suggested}"
                      </Button>
                    </Popconfirm>
                  )}
                </div>
              ))}
            </Space>
          }
        />
      ) : null}
      <Table<{ name: string; count: number }>
        size="small"
        rowKey="name"
        loading={q.isLoading}
        dataSource={d?.items}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{ emptyText: 'Belum ada kategori.' }}
        columns={[
          { title: 'Kategori', dataIndex: 'name' },
          { title: t('Produk'), dataIndex: 'count', align: 'right' },
          {
            title: '',
            render: (_: unknown, r) =>
              canMerge ? (
                <Space>
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => (setTarget(undefined), setMoving(r))}>
                    Ganti nama / gabung
                  </Button>
                  <Popconfirm title={`Hapus kategori "${r.name}"?`} description={`${r.count} ${noun} menjadi tanpa kategori.`} okText="Hapus" cancelText="Batal" onConfirm={() => merge.mutate({ from: [r.name], to: null })}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />}>
                      Hapus
                    </Button>
                  </Popconfirm>
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal
        title={moving ? `Ganti nama / gabungkan "${moving.name}"` : ''}
        open={!!moving}
        onCancel={() => setMoving(null)}
        onOk={() => moving && target && merge.mutate({ from: [moving.name], to: target })}
        okButtonProps={{ disabled: !target || target.trim().toLowerCase() === moving?.name.toLowerCase() }}
        okText="Pindahkan"
        cancelText="Batal"
        confirmLoading={merge.isPending}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="Menjadi kategori" extra={`${moving?.count ?? 0} ${noun} akan dipindahkan. Pilih kategori lain untuk menggabungkan, atau ketik nama baru untuk mengganti nama.`}>
            <CategoryField value={target} onChange={setTarget} options={(d?.items ?? []).map((i) => i.name).filter((n) => n !== moving?.name)} />
          </Form.Item>
        </Form>
      </Modal>
    </Modal>
  );
}

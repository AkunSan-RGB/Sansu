import { EditOutlined, UndoOutlined } from '@ant-design/icons';
import { REPORTING_FRAMEWORK_LABELS } from '@sansu/shared';
import { Button, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { api } from '@/api/client';
import { useAction } from '@/api/queries';
import type { FinancialNotes, NoteSection, NoteTable } from '@/api/types';
import { acc } from './format';

export function NoteTableView({ t }: { t: NoteTable }) {
  const cell = (v: string | number | null, i: number) => (t.align[i] === 'right' && v !== null && v !== '' && !Number.isNaN(Number(v)) ? acc(v) : v);
  const data = t.rows.map((r, i) => ({ key: i, r }));
  return (
    <div style={{ margin: '8px 0 16px' }}>
      {t.title && <Typography.Text strong>{t.title}</Typography.Text>}
      <Table
        size="small"
        bordered
        pagination={false}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        columns={t.columns.map((c, i) => ({ title: c, align: t.align[i], render: (_: unknown, x: { r: (string | number | null)[] }) => cell(x.r[i], i) }))}
        summary={
          t.total
            ? () => (
                <Table.Summary.Row>
                  {t.total?.map((v, i) => (
                    <Table.Summary.Cell key={i} index={i} align={t.align[i]}>
                      <strong>{cell(v, i)}</strong>
                    </Table.Summary.Cell>
                  ))}
                </Table.Summary.Row>
              )
            : undefined
        }
      />
    </div>
  );
}

const Paras = ({ ps }: { ps: string[] }) => (
  <>
    {ps.map((p, i) => (
      <Typography.Paragraph key={i} style={{ textAlign: 'justify', whiteSpace: 'pre-line' }}>
        {p}
      </Typography.Paragraph>
    ))}
  </>
);

/** Catatan atas Laporan Keuangan (CALK) — disusun otomatis, paragraf bisa disunting */
export default function NotesView({ d }: { d: FinancialNotes }) {
  const [editing, setEditing] = useState<NoteSection | null>(null);
  const [text, setText] = useState('');
  const save = useAction((v: { key: string; content: string }) => api(`/accounting/notes/${d.year}/${v.key}`, { method: 'PUT', json: { content: v.content } }), {
    success: 'Catatan disimpan',
    invalidate: ['notes'],
    onSuccess: () => setEditing(null),
  });
  const reset = useAction((key: string) => api(`/accounting/notes/${d.year}/${key}`, { method: 'DELETE' }), { success: 'Dikembalikan ke teks otomatis', invalidate: ['notes'] });

  return (
    <div className="calk" style={{ maxWidth: 900, margin: '0 auto' }}>
      <Typography.Paragraph type="secondary" className="no-print">
        Disusun otomatis dari pembukuan sesuai {REPORTING_FRAMEWORK_LABELS[d.framework]}. Angka dan tabel selalu mengikuti buku besar; paragraf penjelasan bisa Anda sunting
        lewat tombol <EditOutlined />.
      </Typography.Paragraph>
      {d.sections.map((s) => (
        <section key={s.key} style={{ marginBottom: 24, breakInside: 'avoid-page' }}>
          <Space align="baseline" style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {s.number}. {s.title}
            </Typography.Title>
            {s.editable && (
              <Space className="no-print" size={4}>
                {s.edited && <Tag color="orange">Disunting</Tag>}
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setText(s.paragraphs.join('\n\n'));
                    setEditing(s);
                  }}
                />
                {s.edited && (
                  <Popconfirm title="Kembalikan ke teks otomatis?" onConfirm={() => reset.mutate(s.key)}>
                    <Button size="small" type="text" icon={<UndoOutlined />} />
                  </Popconfirm>
                )}
              </Space>
            )}
          </Space>
          <div style={{ marginTop: 8 }}>
            <Paras ps={s.paragraphs} />
            {s.subsections?.map((sub, i) => (
              <div key={i} style={{ marginLeft: 16 }}>
                <Typography.Text strong>{sub.title}</Typography.Text>
                <Paras ps={sub.paragraphs} />
                {sub.table && <NoteTableView t={sub.table} />}
              </div>
            ))}
            {s.tables.map((t, i) => (
              <NoteTableView key={i} t={t} />
            ))}
          </div>
        </section>
      ))}
      <Modal
        title={editing ? `${editing.number}. ${editing.title}` : ''}
        open={!!editing}
        width={760}
        onCancel={() => setEditing(null)}
        onOk={() => editing && save.mutate({ key: editing.key, content: text })}
        confirmLoading={save.isPending}
        okText="Simpan"
      >
        <Typography.Paragraph type="secondary">Pisahkan paragraf dengan satu baris kosong. Tabel angka tetap dibuat otomatis.</Typography.Paragraph>
        <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 8, maxRows: 24 }} />
      </Modal>
    </div>
  );
}

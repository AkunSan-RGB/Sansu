import { PlusOutlined } from '@ant-design/icons';
import type { Project } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Progress, Tag } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import { useCan } from '@/auth/useCan';
import ListPage from '@/components/ListPage';
import { fmtMoney } from '@/lib/format';
import { t } from '@/lib/terms';
import { STATUS } from './projects/shared';
import { ProjectModal } from './projects/ProjectModal';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects') });
  return (
    <>
      <ListPage<Project>
        title="Proyek & termin"
        actions={
          can('POST', '/services/projects') ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              Proyek baru
            </Button>
          ) : undefined
        }
        rows={q.data}
        loading={q.isLoading}
        summary={(rows) => {
          const active = rows.filter((p) => p.status === 'ACTIVE');
          const sum = (xs: Project[], k: 'contractValue' | 'outstanding') => xs.reduce((a, p) => a + Number(p[k] ?? 0), 0);
          return [
            { label: 'Proyek berjalan', value: String(active.length), hint: `nilai kontrak ${fmtMoney(sum(active, 'contractValue'))}` },
            { label: 'Piutang belum dibayar', value: fmtMoney(sum(rows, 'outstanding')), tone: sum(rows, 'outstanding') > 0 ? 'warn' : 'neutral', hint: 'dari semua proyek' },
            { label: 'Proyek selesai', value: String(rows.filter((p) => p.status === 'DONE').length), tone: 'good' },
          ];
        }}
        views={[
          { value: 'ALL', label: 'Semua', test: () => true },
          { value: 'ACTIVE', label: 'Berjalan', test: (p) => p.status === 'ACTIVE' },
          { value: 'DONE', label: 'Selesai', test: (p) => p.status === 'DONE' },
          { value: 'CANCELLED', label: 'Dibatalkan', test: (p) => p.status === 'CANCELLED' },
        ]}
        searchText={(p) => `${p.code} ${p.name} ${p.customer.name}`}
        searchPlaceholder="Cari proyek atau pelanggan"
        emptyText="Belum ada proyek. Buat proyek untuk kontrak yang ditagih bertahap (termin)."
        onRowClick={(r) => navigate(`/projects/${r.id}`)}
        scrollX={900}
        columns={[
          { title: 'Kode', dataIndex: 'code' },
          { title: 'Proyek', dataIndex: 'name' },
          { title: t('Pelanggan'), render: (_, r) => r.customer.name },
          { title: 'Nilai kontrak', dataIndex: 'contractValue', align: 'right', render: fmtMoney },
          {
            title: 'Ditagih',
            width: 180,
            render: (_, r) => <Progress percent={r.billedPct} size="small" format={() => fmtMoney(r.billed)} />,
          },
          { title: 'Uang muka tersisa', dataIndex: 'depositsRemaining', align: 'right', render: fmtMoney },
          { title: 'Piutang', dataIndex: 'outstanding', align: 'right', render: fmtMoney },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (s: Project['status']) => <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag>,
          },
        ]}
      />
      <ProjectModal open={open} onClose={() => setOpen(false)} onDone={(p) => navigate(`/projects/${p.id}`)} />
    </>
  );
}

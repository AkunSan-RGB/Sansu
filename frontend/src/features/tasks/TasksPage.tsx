import { CheckCircleOutlined } from '@ant-design/icons';
import { Badge, Card, Empty, List, Tabs, Typography } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import WorkflowPage from '@/features/workflow/WorkflowPage';
import PageHeader from '@/layout/PageHeader';
import { useTasks } from '@/layout/useTasks';

/** Peran yang boleh memantau proses (sama dengan menu Alur kerja sebelumnya) */
const MONITOR_ROLES = ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'PURCHASING', 'WAREHOUSE', 'CASHIER'];

/**
 * Tugas saya: proses yang menunggu tindakan pengguna ini, disusun menurut pemisahan fungsi (yang dibuat sendiri tidak ikut).
 * Tab kedua "Pantau semua proses" memuat papan alur kerja (dulu menu tersendiri).
 */
export default function TasksPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useTasks();
  const canMonitor = !!me && MONITOR_ROLES.includes(me.role);
  const tab = canMonitor && params.get('tab') === 'proses' ? 'proses' : 'tugas';
  const mine = (
    <Card>
      <Typography.Paragraph type="secondary">
        Pekerjaan yang menunggu Anda sekarang. Hanya yang memang boleh Anda putuskan; yang Anda buat sendiri atau yang ditujukan ke penyetuju lain tidak tampil di sini.
      </Typography.Paragraph>
      <List
        loading={isLoading}
        dataSource={data ?? []}
        locale={{ emptyText: <Empty image={<CheckCircleOutlined style={{ fontSize: 40, color: '#16a34a' }} />} description="Tidak ada yang menunggu tindakan Anda" /> }}
        renderItem={(t) => (
          <List.Item extra={<Link to={t.link}>Buka</Link>}>
            <List.Item.Meta avatar={<Badge count={t.count} color={t.oldestDays >= 3 ? '#d97706' : '#111111'} overflowCount={99} />} title={<Link to={t.link}>{t.title}</Link>} description={t.detail} />
          </List.Item>
        )}
      />
    </Card>
  );
  return (
    <>
      <PageHeader title="Tugas saya" />
      {canMonitor ? (
        <Tabs
          activeKey={tab}
          onChange={(k) => setParams(k === 'proses' ? { tab: 'proses' } : {}, { replace: true })}
          items={[
            { key: 'tugas', label: 'Tugas saya', children: mine },
            { key: 'proses', label: 'Pantau semua proses', children: <WorkflowPage embedded /> },
          ]}
        />
      ) : (
        mine
      )}
    </>
  );
}

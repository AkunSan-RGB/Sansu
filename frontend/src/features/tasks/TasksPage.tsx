import { CheckCircleOutlined } from '@ant-design/icons';
import { Badge, Card, Empty, List, Typography } from 'antd';
import { Link } from 'react-router-dom';
import PageHeader from '@/layout/PageHeader';
import { useTasks } from '@/layout/useTasks';

/** Tugas saya: proses yang menunggu tindakan pengguna ini, disusun menurut pemisahan fungsi (yang dibuat sendiri tidak ikut) */
export default function TasksPage() {
  const { data, isLoading } = useTasks();
  return (
    <>
      <PageHeader title="Tugas saya" />
      <Card>
        <Typography.Paragraph type="secondary">
          Hanya proses yang memang boleh Anda putuskan. Yang Anda buat sendiri atau yang ditujukan ke penyetuju lain tidak tampil di sini.
        </Typography.Paragraph>
        <List
          loading={isLoading}
          dataSource={data ?? []}
          locale={{ emptyText: <Empty image={<CheckCircleOutlined style={{ fontSize: 40, color: '#16a34a' }} />} description="Tidak ada yang menunggu tindakan Anda" /> }}
          renderItem={(t) => (
            <List.Item extra={<Link to={t.link}>Buka</Link>}>
              <List.Item.Meta avatar={<Badge count={t.count} color={t.oldestDays >= 3 ? '#d97706' : '#2563eb'} overflowCount={99} />} title={<Link to={t.link}>{t.title}</Link>} description={t.detail} />
            </List.Item>
          )}
        />
      </Card>
    </>
  );
}

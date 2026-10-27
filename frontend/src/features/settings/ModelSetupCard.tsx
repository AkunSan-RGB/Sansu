import { CheckCircleFilled, ClockCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { SETUP_GROUP_LABELS, type SetupGroup, type SetupItemDef } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, List, Progress, Skeleton, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { get } from '@/api/client';

interface Setup {
  model: string;
  name: string;
  items: (SetupItemDef & { done: boolean })[];
  done: number;
  total: number;
}

const GROUPS: SetupGroup[] = ['BEFORE_START', 'RECOMMENDED'];

/** Pengaturan yang relevan bagi jenis usaha perusahaan ini, dengan status terisi/belum dihitung dari data nyata */
export default function ModelSetupCard() {
  const q = useQuery({ queryKey: ['onboarding', 'setup'], queryFn: () => get<Setup>('/onboarding/setup') });
  if (q.isLoading) return <Skeleton active />;
  if (q.isError || !q.data) return <Alert type="error" showIcon message="Daftar pengaturan jenis usaha gagal dimuat" description={(q.error as Error | null)?.message} />;
  const d = q.data;
  const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
  return (
    <div style={{ maxWidth: 860 }}>
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Pengaturan untuk {d.name}
          </Typography.Title>
          <Typography.Text type="secondary">
            Hanya pengaturan yang berlaku untuk jenis usaha Anda. Statusnya dibaca dari data perusahaan, jadi otomatis berubah setelah Anda mengaturnya.
          </Typography.Text>
          <Progress percent={pct} format={() => `${d.done} dari ${d.total}`} style={{ maxWidth: 420 }} />
          <Link to={`/help?a=panduan-${d.model.toLowerCase()}`}>
            <Button size="small" icon={<QuestionCircleOutlined />}>
              Baca panduan {d.name}
            </Button>
          </Link>
        </Space>
      </Card>
      {GROUPS.map((g) => {
        const rows = d.items.filter((i) => i.group === g);
        if (!rows.length) return null;
        return (
          <Card key={g} size="small" title={SETUP_GROUP_LABELS[g]} style={{ marginBottom: 16 }}>
            <List
              dataSource={rows}
              renderItem={(i) => (
                <List.Item
                  actions={[
                    <Link key="go" to={i.link}>
                      <Button size="small" type={i.done ? 'default' : 'primary'}>
                        {i.done ? 'Lihat' : 'Atur'}
                      </Button>
                    </Link>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={i.done ? <CheckCircleFilled style={{ color: '#16A37B', fontSize: 20 }} /> : <ClockCircleOutlined style={{ color: '#D48806', fontSize: 20 }} />}
                    title={
                      <Space size={8} wrap>
                        <span>{i.title}</span>
                        <Tag color={i.done ? 'green' : 'orange'}>{i.done ? 'Sudah' : 'Belum'}</Tag>
                      </Space>
                    }
                    description={i.why}
                  />
                </List.Item>
              )}
            />
          </Card>
        );
      })}
    </div>
  );
}

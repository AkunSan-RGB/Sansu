import { ApartmentOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Tag, Tooltip } from 'antd';
import { Link } from 'react-router-dom';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

const WORKFLOW_ROLES: string[] = ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'PURCHASING', 'WAREHOUSE', 'CASHIER'];
interface ByDoc { caseId: string; number: string; status: 'ACTIVE' | 'DONE' | 'CANCELLED'; stageLabel: string; pipelineLabel: string }

/** Tahap alur kerja sebuah dokumen (pesanan, faktur, PO, produksi, ...); tidak tampil bila dokumen belum punya kasus */
export default function WorkflowBadge({ type, id }: { type: string; id?: string }) {
  const { me } = useAuth();
  const allowed = !!me && WORKFLOW_ROLES.includes(me.role);
  const { data } = useQuery({ queryKey: ['workflow', 'by-doc', type, id], queryFn: () => get<ByDoc | null>(`/workflow/by-doc?type=${type}&id=${id}`), enabled: !!id && allowed, retry: false });
  if (!data) return null;
  const color = data.status === 'DONE' ? 'green' : data.status === 'CANCELLED' ? 'default' : 'blue';
  return (
    <Tooltip title={`${data.pipelineLabel} · ${data.number}`}>
      <Link to="/workflow"><Tag color={color} icon={<ApartmentOutlined />} style={{ cursor: 'pointer' }}>Alur: {data.status === 'ACTIVE' ? data.stageLabel : data.status === 'DONE' ? 'Selesai' : 'Dibatalkan'}</Tag></Link>
    </Tooltip>
  );
}

import { SettingOutlined } from '@ant-design/icons';
import type { InventoryMethod } from '@sansu/shared';
import { INVENTORY_METHOD_INFO } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Tag, Tooltip } from 'antd';
import { Link } from 'react-router-dom';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

/** Lencana metode biaya persediaan yang sedang dipakai; admin mendapat tautan untuk mengubahnya di Pengaturan */
export default function InventoryMethodBadge() {
  const { me } = useAuth();
  const isAdmin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const { data } = useQuery({ queryKey: ['inventory-method'], queryFn: () => get<{ method: InventoryMethod }>('/settings/inventory-method'), staleTime: 60_000 });
  if (!data) return null;
  const info = INVENTORY_METHOD_INFO[data.method];
  return (
    <Tooltip title={`${info.how} ${isAdmin ? '' : 'Hanya admin yang dapat mengubahnya.'}`}>
      <Tag color="blue" style={{ marginInlineEnd: 0, padding: '4px 10px', fontSize: 13 }}>
        Metode biaya: <b>{info.short}</b>
        {isAdmin && (
          <>
            {' · '}
            <Link to="/settings/company?tab=kebijakan">
              <SettingOutlined /> Ubah
            </Link>
          </>
        )}
      </Tag>
    </Tooltip>
  );
}

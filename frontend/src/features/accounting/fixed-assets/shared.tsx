import { Tag, Typography } from 'antd';
import { LEDGER_KEYS } from '@/api/queries';
import type { FixedAsset } from '@/api/types';
import { fmtDate } from '@/lib/format';

export const KEYS = ['assets', 'asset-runs', 'asset-roll', ...LEDGER_KEYS];

export const lifeText = (m: number) => (m ? (m % 12 ? `${m} bulan` : `${m / 12} tahun`) : '—');

const VERIFY_LABEL = { FOUND: ['green', 'Ada'], DAMAGED: ['orange', 'Rusak'], MISSING: ['red', 'Hilang'] } as const;

export function VerifyTag({ a }: { a: FixedAsset }) {
  if (a.status !== 'ACTIVE') return null;
  if (!a.lastVerifiedAt || !a.verificationStatus) return <Typography.Text type="secondary">Belum pernah</Typography.Text>;
  const [color, label] = VERIFY_LABEL[a.verificationStatus];
  return (
    <Tag color={color}>
      {label} · {fmtDate(a.lastVerifiedAt)}
    </Tag>
  );
}

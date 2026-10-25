import { BRAND, type CashCountStatus } from '@sansu/shared';
import { fmtMoney } from '@/lib/format';

export interface KasAccount {
  id: string;
  code: string;
  name: string;
  balance: string;
  lastCount: string | null;
}

export const STATUS_COLOR: Record<CashCountStatus, string> = {
  DRAFT: 'blue',
  WAITING_APPROVAL: 'gold',
  POSTED: 'green',
  CANCELLED: 'default',
};

export const diffText = (v: number) => (v === 0 ? 'Cocok' : v < 0 ? `Kurang ${fmtMoney(-v)}` : `Lebih ${fmtMoney(v)}`);

export const diffColor = (v: number) => (v === 0 ? BRAND.colors.accent : '#dc2626');

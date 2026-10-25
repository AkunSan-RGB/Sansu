import { BRAND, type BillingInvoiceStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Typography } from 'antd';
import dayjs from 'dayjs';
import { get } from '@/api/client';

export interface Overview {
  tenants: number;
  trial: number;
  active: number;
  expired: number;
  suspended: number;
  internal: number;
  mrr: string;
  new30: number;
  paid_month: string;
  waiting: number;
  billingEnabled: boolean;
  signups: { month: string; n: number }[];
  revenue: { month: string; amount: string }[];
  gateway: string | null;
  smtp: boolean;
  admins: string[];
}

export const INV_COLOR: Record<BillingInvoiceStatus, string> = {
  UNPAID: 'gold',
  WAITING: 'blue',
  PAID: 'green',
  CANCELLED: 'default',
};

export const KEYS = ['platform-admin'];

/** Saklar langganan: mati selama tahap uji */
export function useBillingEnabled() {
  const q = useQuery({ queryKey: [...KEYS, 'overview'], queryFn: () => get<Overview>('/platform-admin/overview') });
  return q.data?.billingEnabled === true;
}

// ---------------- Ringkasan ----------------
export function Bars({
  rows,
  value,
  fmt,
  label = (r) => dayjs(`${r.month}-01`).format('MMM YY'),
}: {
  rows: { month: string }[];
  value: (r: never) => number;
  fmt: (n: number) => string;
  label?: (r: { month: string }) => string;
}) {
  const vals = rows.map((r) => value(r as never));
  const max = Math.max(1, ...vals);
  if (!rows.length) return <Typography.Text type="secondary">Belum ada data</Typography.Text>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map((r, i) => (
        <div
          key={r.month}
          style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10, alignItems: 'center', fontSize: 13 }}
        >
          <span>{label(r)}</span>
          <div style={{ background: BRAND.colors.primarySoft, borderRadius: 4, height: 14 }}>
            <div
              style={{
                width: `${(vals[i] / max) * 100}%`,
                background: BRAND.colors.primary,
                height: '100%',
                borderRadius: 4,
                minWidth: vals[i] ? 3 : 0,
              }}
            />
          </div>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(vals[i])}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------- Pengaturan ----------------
export interface PSettings {
  enabled: boolean;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  trialDays: number;
  graceDays: number;
  trialPlanCode: string;
  supportWhatsapp: string;
  renewalNoticeDays: number;
  sellerName: string;
  sellerNpwp: string;
  sellerAddress: string;
  vatEnabled: boolean;
  vatRate: number;
  smtp: { configured: boolean; from: string };
  gateway: string | null;
  admins: string[];
}

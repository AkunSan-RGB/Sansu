import { Select, type SelectProps } from 'antd';
import { useCashAccounts } from '@/api/queries';
import { fmtCurrency, fmtMoney } from '@/lib/format';

/**
 * Pilih akun kas / rekening bank, lengkap dengan saldonya. Hanya rekening Rupiah, kecuali `currency`
 * (mata uang faktur valas) diberikan: rekening bermata uang itu ikut ditawarkan.
 */
export default function CashAccountSelect({ currency, ...props }: SelectProps<string> & { currency?: string }) {
  const { data } = useCashAccounts('all');
  return (
    <Select
      placeholder="Pilih kas / bank"
      {...props}
      options={data
        ?.filter((a) => a.currency === 'IDR' || a.currency === currency)
        .map((a) => ({ value: a.id, label: a.currency === 'IDR' ? `${a.code} · ${a.name} (saldo ${fmtMoney(a.balance)})` : `${a.code} · ${a.name} (saldo ${fmtCurrency(a.balanceForeign ?? 0, a.currency)})` }))}
    />
  );
}

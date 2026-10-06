import { Select, type SelectProps } from 'antd';
import { useCashAccounts } from '@/api/queries';
import { fmtMoney } from '@/lib/format';

/** Pilih akun kas / rekening bank, lengkap dengan saldonya */
export default function CashAccountSelect(props: SelectProps<string>) {
  const { data } = useCashAccounts();
  return (
    <Select
      placeholder="Pilih kas / bank"
      {...props}
      options={data?.map((a) => ({ value: a.id, label: `${a.code} · ${a.name} (saldo ${fmtMoney(a.balance)})` }))}
    />
  );
}

import { PlusOutlined, SwapOutlined } from '@ant-design/icons';
import { canBookkeep, canHandleMoney, currencyName } from '@sansu/shared';
import { Alert, Button, Card, Space, Table } from 'antd';
import { useState } from 'react';
import { useCashAccounts } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { fmtCurrency, fmtMoney, fmtRate } from '@/lib/format';
import ForeignTxModal from './ForeignTxModal';
import NewForeignAccountModal from './NewForeignAccountModal';

/** Rekening kas/bank bermata uang asing: saldo valas, nilai Rupiah tercatat (biaya rata-rata), dan transaksi valas */
export default function ForeignAccountsTab() {
  const { me } = useAuth();
  const accounts = useCashAccounts('foreign');
  const [txOpen, setTxOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const canTx = canHandleMoney(me?.role);
  const canCreate = me?.role === 'ADMIN' || me?.role === 'OWNER' || canBookkeep(me?.role);
  return (
    <Card>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Rekening dalam mata uang asing"
        description="Saldo dicatat dalam valas dan dalam Rupiah (biaya rata-rata tertimbang). Uang valas keluar dinilai pada biaya rata-rata, selisih terhadap nilai transaksi menjadi laba/rugi kurs terealisasi. Akhir periode, saldo dinilai ulang pada kurs penutup di tab Posisi valas & penilaian ulang. Pelunasan faktur valas memilih rekening ini langsung di formulir pembayarannya."
      />
      <Space wrap style={{ marginBottom: 12 }}>
        {canCreate && <Button icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>Rekening valas baru</Button>}
        {canTx && <Button type="primary" icon={<SwapOutlined />} onClick={() => setTxOpen(true)} disabled={!accounts.data?.length}>Transaksi valas</Button>}
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={accounts.isLoading}
        dataSource={accounts.data}
        pagination={false}
        locale={{ emptyText: 'Belum ada rekening valas. Buat rekening bank/kas valas dulu untuk menyimpan dan membayar dengan mata uang asing.' }}
        columns={[
          { title: 'Rekening', render: (_: unknown, a) => `${a.code} · ${a.name}` },
          { title: 'Mata uang', dataIndex: 'currency', render: (c: string) => `${c} · ${currencyName(c)}` },
          { title: 'Saldo valas', dataIndex: 'balanceForeign', align: 'right', render: (v: string | null, a) => fmtCurrency(v ?? 0, a.currency) },
          { title: 'Nilai Rupiah tercatat', dataIndex: 'balance', align: 'right', render: fmtMoney },
          { title: 'Kurs rata-rata', align: 'right', render: (_: unknown, a) => (Number(a.balanceForeign) > 0 ? fmtRate(Number(a.balance) / Number(a.balanceForeign)) : '-') },
        ]}
      />
      <ForeignTxModal open={txOpen} onClose={() => setTxOpen(false)} />
      <NewForeignAccountModal open={newOpen} onClose={() => setNewOpen(false)} />
    </Card>
  );
}

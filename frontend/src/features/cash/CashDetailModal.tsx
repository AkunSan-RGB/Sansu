import { Button, Modal, Space, Table, Tag } from 'antd';
import type { CashTransaction } from '@/api/types';
import { fmtMoney } from '@/lib/format';

/** Rincian satu transaksi kas: nomor jurnal, cabang, dan baris akun yang dibebani */
export default function CashDetailModal({ detail, onClose }: { detail: CashTransaction | null; onClose: () => void }) {
  return (
    <Modal title={`Rincian ${detail?.number ?? ''}`} open={!!detail} onCancel={onClose} footer={<Button onClick={onClose}>Tutup</Button>} width={640}>
      {detail && (
        <>
          <Space wrap style={{ marginBottom: 8 }}>
            {detail.journalNumber && <Tag>Jurnal {detail.journalNumber}</Tag>}
            {detail.branchName && <Tag color="purple">Cabang {detail.branchName}</Tag>}
          </Space>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={detail.lines}
            columns={[
              { title: 'Untuk', render: (_, l) => `${l.account.name}` },
              { title: 'Keterangan', dataIndex: 'memo' },
              { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
            ]}
          />
        </>
      )}
    </Modal>
  );
}

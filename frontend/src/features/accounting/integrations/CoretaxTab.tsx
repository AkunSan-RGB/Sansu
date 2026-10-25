import { CloudDownloadOutlined } from '@ant-design/icons';
import { canHandleMoney } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Input, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { download, get, api } from '@/api/client';
import { useAction } from '@/api/queries';
import type { CoretaxPreview, IntegrationSettings } from '@/api/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useAuth } from '@/auth/AuthContext';
import { t } from '@/lib/terms';

export function CoretaxTab() {
  const money = canHandleMoney(useAuth().me?.role);
  const [from, setFrom] = useState(dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD'));
  const [selected, setSelected] = useState<string[]>([]);
  const [units, setUnits] = useState<Record<string, string>>({});
  const conf = useQuery({ queryKey: ['integrations', 'settings'], queryFn: () => get<IntegrationSettings>('/integrations/settings') });
  const pre = useQuery({ queryKey: ['integrations', 'coretax', from, to], queryFn: () => get<CoretaxPreview>(`/integrations/coretax/preview?from=${from}&to=${to}`) });
  const saveUnits = useAction(() => api('/integrations/settings', { method: 'PUT', json: { coretaxUnits: units } }), { success: 'Kode satuan disimpan', invalidate: ['integrations'] });
  const dl = useAction(
    () =>
      download(
        `/integrations/coretax/faktur-keluaran.xml?from=${from}&to=${to}${selected.length ? `&ids=${selected.join(',')}` : ''}`,
        `faktur-keluaran-${from.slice(0, 7)}.xml`,
      ),
    { success: 'File XML diunduh — impor di Coretax: e-Faktur → Pajak Keluaran → Impor Data' },
  );
  const d = pre.data;
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('Ekspor faktur penjualan & uang muka ber-PPN ke file XML Coretax')}
        description={t('Unggah file di Coretax DJP (e-Faktur → Pajak Keluaran → Impor Data), periksa draf, lalu tanda tangani. Format mengikuti template XML impor faktur keluaran DJP (TrxCode 04, DPP nilai lain 11/12 untuk PPN 12%). Selalu cek ulang dengan template terbaru di pajak.go.id.')}
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>s/d</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button type="primary" icon={<CloudDownloadOutlined />} disabled={!d?.count || d.problems.length > 0} loading={dl.isPending} onClick={() => dl.mutate(undefined)}>
          Unduh XML {selected.length ? `(${selected.length} faktur)` : d ? `(${d.count} faktur)` : ''}
        </Button>
      </Space>
      {d?.problems.map((p) => (
        <Alert key={p} type="warning" showIcon message={p} style={{ marginBottom: 8 }} />
      ))}
      {d?.warnings?.map((p) => (
        <Alert key={p} type="info" showIcon message={p} style={{ marginBottom: 8 }} />
      ))}
      {d && d.units.length > 0 && (
        <Card size="small" title="Kode satuan Coretax" style={{ marginBottom: 12 }}>
          <Typography.Paragraph type="secondary">
            Coretax memakai kode satuan resmi (UM.00xx). Isi sekali per satuan barang — lihat daftar kode di sheet referensi converter e-Faktur Coretax dari DJP.
          </Typography.Paragraph>
          <Space wrap>
            {d.units.map((u) => (
              <Input
                key={u}
                prefix={u}
                placeholder="UM.00xx"
                style={{ width: 200 }}
                value={units[u] ?? conf.data?.coretaxUnits[u] ?? ''}
                onChange={(e) => setUnits((x) => ({ ...x, [u]: e.target.value.trim().toUpperCase() }))}
              />
            ))}
            {money && (
              <Button onClick={() => saveUnits.mutate(undefined)} loading={saveUnits.isPending}>
                Simpan
              </Button>
            )}
          </Space>
        </Card>
      )}
      <Table
        rowKey="id"
        size="small"
        loading={pre.isLoading}
        dataSource={d?.invoices}
        rowSelection={{ selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]) }}
        scroll={{ x: 900 }}
        columns={[
          {
            title: t('Faktur'),
            dataIndex: 'number',
            render: (v: string, r) =>
              r.kind === 'DEPOSIT' ? (
                <>
                  {v} <Tag color="blue">Uang muka</Tag>
                </>
              ) : Number(r.depositDpp ?? 0) > 0 ? (
                <>
                  {v} <Tag color="purple">Pelunasan − DPP uang muka {fmtMoney(r.depositDpp)}</Tag>
                </>
              ) : (
                v
              ),
          },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: 'Pembeli', dataIndex: 'customer' },
          { title: 'Identitas', render: (_, r) => (r.buyerType === 'NPWP' ? <Tag color="green">NPWP {r.npwp}</Tag> : <Tag color="orange">Tanpa NPWP</Tag>) },
          { title: 'DPP', dataIndex: 'subtotal', align: 'right', render: fmtMoney },
          { title: 'PPN', dataIndex: 'taxAmount', align: 'right', render: fmtMoney },
        ]}
      />
    </>
  );
}

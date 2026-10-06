/** Laporan harga pokok produksi (cost of goods manufactured) per periode */
import type { ProductionReport } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Descriptions, Row, Select, Space, Table } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, qs } from '@/api/client';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney, fmtQty } from '@/lib/format';
import { t } from '@/lib/terms';

export default function ProductionReportPage() {
  const [year, setYear] = useState(dayjs().year());
  const [month, setMonth] = useState<number | null>(dayjs().month() + 1);
  const period = month ? `${year}-${String(month).padStart(2, '0')}` : String(year);
  const q = useQuery({
    queryKey: ['production', 'report', period],
    queryFn: () => get<ProductionReport>(`/production/report${qs({ period })}`),
  });
  const r = q.data;
  const variance = Number(r?.variance ?? 0);
  return (
    <>
      <PageHeader
        title="Harga pokok produksi"
        extra={
          <Space>
            <Select
              value={year}
              onChange={setYear}
              style={{ width: 100 }}
              options={[0, 1, 2].map((i) => ({ value: dayjs().year() - i, label: dayjs().year() - i }))}
            />
            <Select
              allowClear
              placeholder="Setahun"
              value={month}
              onChange={(v) => setMonth(v ?? null)}
              style={{ width: 130 }}
              options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: dayjs().month(i).format('MMMM') }))}
            />
          </Space>
        }
      />
      {r && (
        <Row gutter={16}>
          <Col xs={24} lg={12}>
            <Card title="Laporan harga pokok produksi" style={{ marginBottom: 16 }}>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Barang dalam proses awal">{fmtMoney(r.wipStart)}</Descriptions.Item>
                <Descriptions.Item label="Bahan baku dipakai">{fmtMoney(r.materialUsed)}</Descriptions.Item>
                <Descriptions.Item label="Upah langsung dibebankan">{fmtMoney(r.laborApplied)}</Descriptions.Item>
                <Descriptions.Item label="Overhead pabrik dibebankan">{fmtMoney(r.overheadApplied)}</Descriptions.Item>
                <Descriptions.Item label="Barang dalam proses akhir">({fmtMoney(r.wipEnd)})</Descriptions.Item>
                <Descriptions.Item label={<b>Harga pokok produksi</b>}>
                  <b>{fmtMoney(r.costOfGoodsManufactured)}</b>
                </Descriptions.Item>
              </Descriptions>
              {Number(r.check) !== 0 && (
                <Alert
                  style={{ marginTop: 12 }}
                  type="warning"
                  showIcon
                  message={`Selisih ${fmtMoney(r.check)} — ada jurnal manual ke akun Barang dalam Proses Produksi.`}
                />
              )}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="Biaya konversi: sesungguhnya vs dibebankan" style={{ marginBottom: 16 }}>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Upah langsung sesungguhnya (5-4100)">
                  {fmtMoney(r.laborActual)}
                </Descriptions.Item>
                <Descriptions.Item label="Overhead pabrik sesungguhnya (5-4200)">
                  {fmtMoney(r.overheadActual)}
                </Descriptions.Item>
                <Descriptions.Item label="Dibebankan ke produk">
                  {fmtMoney(Number(r.laborApplied) + Number(r.overheadApplied))}
                </Descriptions.Item>
                <Descriptions.Item label={variance >= 0 ? 'Kurang dibebankan' : 'Lebih dibebankan'}>
                  <b>{fmtMoney(Math.abs(variance))}</b>
                </Descriptions.Item>
              </Descriptions>
              <Alert
                style={{ marginTop: 12 }}
                type="info"
                showIcon
                message="Selisih tetap di beban pokok penjualan periode ini (SAK EP 13.9)."
                description="Catat gaji pekerja produksi dengan menandai karyawan sebagai tenaga kerja produksi, dan biaya pabrik (listrik mesin, sewa pabrik, penyusutan mesin) ke akun 5-4200. Bila selisih terus besar, perbarui upah & overhead standar di resep."
              />
            </Card>
          </Col>
        </Row>
      )}
      <Card title="Per produk">
        <Table
          rowKey="productId"
          size="small"
          loading={q.isLoading}
          dataSource={r?.byProduct}
          pagination={false}
          locale={{ emptyText: 'Tidak ada produksi yang selesai pada periode ini' }}
          columns={[
            { title: t('Produk'), render: (_, p) => `${p.sku} · ${p.name}` },
            { title: 'Perintah', dataIndex: 'orders', align: 'right' },
            { title: 'Hasil', align: 'right', render: (_, p) => `${fmtQty(p.qty)} ${p.unit}` },
            { title: 'Bahan', dataIndex: 'material', align: 'right', render: fmtMoney },
            { title: 'Upah + overhead', dataIndex: 'conversion', align: 'right', render: fmtMoney },
            { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
            {
              title: 'Rata-rata / unit',
              dataIndex: 'unitCost',
              align: 'right',
              render: (v: string) => <b>{fmtMoney(v)}</b>,
            },
          ]}
        />
      </Card>
    </>
  );
}

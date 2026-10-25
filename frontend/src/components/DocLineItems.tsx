import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, InputNumber, Select, Table } from 'antd';
import type { Rule } from 'antd/es/form';
import type { ReactNode } from 'react';
import type { Product } from '@/api/types';
import { type DocLine, previewLine } from '@/lib/docLines';
import { t } from '@/lib/terms';

interface Props {
  products?: Product[];
  productById: Map<string, Product>;
  lines: DocLine[];
  /** Dipanggil saat produk sebuah baris dipilih (mengisi satuan/harga sesuai formulir) */
  onProduct: (index: number, productId: string) => void;
  /** Dipanggil saat satuan sebuah baris diganti (opsional) */
  onUom?: (index: number, uom: string) => void;
  priceTitle: string;
  priceWidth?: number;
  priceRules?: Rule[];
  pricePlaceholder?: string;
  /** Jumlah desimal harga (mis. 4 untuk mata uang asing); kosong = bawaan */
  pricePrecision?: number;
  money: (v: number) => string;
  /** Isi tambahan di bawah tombol "Tambah baris" */
  footer?: ReactNode;
}

/**
 * Tabel baris dokumen (produk, satuan, qty, harga, diskon, jumlah) yang dipakai bersama
 * oleh formulir penawaran, pesanan penjualan, dan purchase order. Harus berada di dalam `Form`.
 */
export default function DocLineItems({
  products,
  productById,
  lines,
  onProduct,
  onUom,
  priceTitle,
  priceWidth = 160,
  priceRules,
  pricePlaceholder,
  pricePrecision,
  money,
  footer,
}: Props) {
  return (
    <Form.List name="lines">
      {(fields, { add, remove }) => (
        <>
          <Table
            rowKey="key"
            dataSource={fields}
            pagination={false}
            size="small"
            scroll={{ x: 900 }}
            columns={[
              {
                title: t('Produk'),
                width: 320,
                render: (_, f) => (
                  <Form.Item
                    name={[f.name, 'productId']}
                    rules={[{ required: true, message: t('Pilih produk') }]}
                    noStyle
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      style={{ width: '100%' }}
                      placeholder={t('Pilih produk')}
                      onChange={(id: string) => onProduct(f.name, id)}
                      options={products
                        ?.filter((p) => p.isActive)
                        .map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))}
                    />
                  </Form.Item>
                ),
              },
              {
                title: 'Satuan',
                width: 110,
                render: (_, f) => {
                  const p = productById.get(lines[f.name]?.productId ?? '');
                  const opts = p ? [p.baseUom, ...p.uoms.map((u) => u.uom)].map((u) => ({ value: u, label: u })) : [];
                  return (
                    <Form.Item name={[f.name, 'uom']} noStyle>
                      <Select
                        style={{ width: '100%' }}
                        options={opts}
                        onChange={onUom ? (v: string) => onUom(f.name, v) : undefined}
                      />
                    </Form.Item>
                  );
                },
              },
              {
                title: 'Qty',
                width: 100,
                render: (_, f) => (
                  <Form.Item name={[f.name, 'qty']} rules={[{ required: true }]} noStyle>
                    <InputNumber min={0.0001} style={{ width: '100%' }} />
                  </Form.Item>
                ),
              },
              {
                title: priceTitle,
                width: priceWidth,
                render: (_, f) => (
                  <Form.Item name={[f.name, 'price']} rules={priceRules} noStyle>
                    <InputNumber
                      min={0}
                      precision={pricePrecision}
                      style={{ width: '100%' }}
                      placeholder={pricePlaceholder}
                    />
                  </Form.Item>
                ),
              },
              {
                title: 'Diskon %',
                width: 90,
                render: (_, f) => (
                  <Form.Item name={[f.name, 'discountPct']} noStyle>
                    <InputNumber min={0} max={100} style={{ width: '100%' }} />
                  </Form.Item>
                ),
              },
              { title: 'Jumlah', align: 'right', render: (_, f) => money(previewLine(lines[f.name] ?? {})) },
              {
                width: 40,
                render: (_, f) =>
                  fields.length > 1 && (
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                  ),
              },
            ]}
          />
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            style={{ marginTop: 8 }}
            onClick={() => add({ qty: 1, discountPct: 0 })}
          >
            Tambah baris
          </Button>
          {footer}
        </>
      )}
    </Form.List>
  );
}

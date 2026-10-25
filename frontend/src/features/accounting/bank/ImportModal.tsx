import { InboxOutlined } from '@ant-design/icons';
import { Card, Col, Form, InputNumber, Modal, Row, Select, Space, Statistic, Table, Typography, Upload } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { post } from '@/api/client';
import { useAction, useCashAccounts } from '@/api/queries';
import type { BankStatement } from '@/api/types';
import { type ColumnMap, findHeader, type Grid, guessColumns, readGrid, toLines } from '@/lib/bankParse';
import { fmtDate, fmtMoney } from '@/lib/format';
import { KEYS, signed } from './shared';

/** Impor file mutasi: pilih file → kolom ditebak otomatis → periksa → simpan */
export function ImportModal({ open, onClose, cashAccountId, onDone }: { open: boolean; onClose: () => void; cashAccountId?: string; onDone: (id: string) => void }) {
  const cash = useCashAccounts();
  const [account, setAccount] = useState<string | undefined>(cashAccountId);
  const [file, setFile] = useState<File | null>(null);
  const [grid, setGrid] = useState<Grid>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState<ColumnMap>({});
  const [year, setYear] = useState(dayjs().year());
  const header = grid[headerRow] ?? [];
  const colOptions = header.map((h, i) => ({ value: i, label: `${String.fromCharCode(65 + (i % 26))} · ${String(h ?? '').slice(0, 30) || '(kosong)'}` }));
  const parsed = useMemo(() => (grid.length ? toLines(grid, headerRow, map, year) : { lines: [], skipped: 0, pending: 0 }), [grid, headerRow, map, year]);
  const totalIn = parsed.lines.filter((l) => Number(l.amount) > 0).reduce((a, l) => a + Number(l.amount), 0);
  const totalOut = parsed.lines.filter((l) => Number(l.amount) < 0).reduce((a, l) => a + Number(l.amount), 0);

  const save = useAction(
    () => post<BankStatement & { skippedDuplicates?: number }>('/bank/statements', { cashAccountId: account, fileName: file?.name, lines: parsed.lines }),
    {
      success: (s) => `${s.lines.length} mutasi diimpor · ${s.summary.counts.MATCHED} cocok dengan buku${s.skippedDuplicates ? ` · ${s.skippedDuplicates} mutasi ganda dilewati` : ''}`,
      invalidate: KEYS,
      onSuccess: (s) => {
        onDone(s.id);
        onClose();
        setGrid([]);
        setFile(null);
      },
    },
  );

  const load = async (f: File) => {
    const g = await readGrid(f);
    const h = findHeader(g);
    setFile(f);
    setGrid(g);
    setHeaderRow(h);
    setMap(guessColumns(g[h] ?? []));
    return false;
  };
  const sel = (k: keyof ColumnMap, label: string) => (
    <Form.Item label={label} style={{ marginBottom: 8 }}>
      <Select allowClear value={map[k]} onChange={(v) => setMap((m) => ({ ...m, [k]: v }))} options={colOptions} style={{ width: 200 }} />
    </Form.Item>
  );

  return (
    <Modal
      title="Impor mutasi rekening"
      open={open}
      width={1000}
      onCancel={onClose}
      onOk={() => save.mutate(undefined)}
      okText={`Impor ${parsed.lines.length} mutasi`}
      okButtonProps={{ disabled: !account || !parsed.lines.length }}
      confirmLoading={save.isPending}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          placeholder="Rekening bank"
          value={account}
          onChange={setAccount}
          style={{ width: 280 }}
          options={cash.data?.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
        />
        <InputNumber value={year} onChange={(v) => v && setYear(v)} prefix="Tahun" min={2000} max={2100} style={{ width: 150 }} />
      </Space>
      <Upload.Dragger accept=".csv,.xls,.xlsx,.txt" maxCount={1} beforeUpload={load} showUploadList={false}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p>{file ? file.name : 'Seret file mutasi (CSV / Excel) dari internet banking ke sini'}</p>
        <Typography.Text type="secondary">BCA, Mandiri, BRI, BNI, BSI, CIMB, dll. — kolom dikenali otomatis</Typography.Text>
      </Upload.Dragger>
      {grid.length > 0 && (
        <>
          <Card size="small" title="Kolom" style={{ marginTop: 12 }}>
            <Space wrap>
              <Form.Item label="Baris judul" style={{ marginBottom: 8 }}>
                <InputNumber min={1} max={grid.length} value={headerRow + 1} onChange={(v) => v && (setHeaderRow(v - 1), setMap(guessColumns(grid[v - 1] ?? [])))} />
              </Form.Item>
              {sel('date', 'Tanggal')}
              {sel('description', 'Keterangan')}
              {sel('debit', 'Debet (keluar)')}
              {sel('credit', 'Kredit (masuk)')}
              {sel('amount', 'Atau: mutasi')}
              {sel('dc', 'Penanda DB/CR')}
              {sel('balance', 'Saldo')}
            </Space>
          </Card>
          <Row gutter={16} style={{ margin: '12px 0' }}>
            <Col span={8}>
              <Statistic
                title="Mutasi terbaca"
                value={parsed.lines.length}
                suffix={[parsed.skipped && `${parsed.skipped} baris dilewati`, parsed.pending && `${parsed.pending} tertunda (belum dibukukan bank)`].filter(Boolean).join(' · ')}
              />
            </Col>
            <Col span={8}>
              <Statistic title="Uang masuk" value={totalIn} formatter={(v) => fmtMoney(Number(v))} valueStyle={{ color: '#389e0d' }} />
            </Col>
            <Col span={8}>
              <Statistic title="Uang keluar" value={-totalOut} formatter={(v) => fmtMoney(Number(v))} valueStyle={{ color: '#cf1322' }} />
            </Col>
          </Row>
          <Table
            size="small"
            rowKey="_k"
            dataSource={parsed.lines.slice(0, 8).map((l, i) => ({ ...l, _k: i }))}
            pagination={false}
            columns={[
              { title: 'Tanggal', dataIndex: 'date', render: fmtDate, width: 110 },
              { title: 'Keterangan', dataIndex: 'description', ellipsis: true },
              { title: 'Mutasi', dataIndex: 'amount', align: 'right', render: signed },
              { title: 'Saldo', dataIndex: 'balance', align: 'right', render: (v) => (v ? fmtMoney(v) : '') },
            ]}
            footer={() => (parsed.lines.length > 8 ? `… dan ${parsed.lines.length - 8} mutasi lainnya` : null)}
          />
        </>
      )}
    </Modal>
  );
}

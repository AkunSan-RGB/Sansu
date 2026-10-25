import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { Alert, App, Button, Space } from 'antd';

/** Daftar kode cadangan + tombol salin/unduh */
export function BackupCodes({ codes }: { codes: string[] }) {
  const { message } = App.useApp();
  const text = codes.join('\n');
  const download = () => {
    const blob = new Blob([`Kode cadangan SANSU (masing-masing hanya bisa dipakai sekali)\n\n${text}\n`], {
      type: 'text/plain',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kode-cadangan-sansu.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="Simpan kode cadangan ini sekarang"
        description="Jika HP hilang atau aplikasi authenticator terhapus, masuk dengan salah satu kode ini. Setiap kode hanya bisa dipakai sekali dan tidak akan ditampilkan lagi."
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
          fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          fontSize: 16,
          background: '#f5f7fa',
          padding: 16,
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <Space wrap>
        <Button
          icon={<CopyOutlined />}
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => message.success('Kode disalin'))
              .catch(() => message.error('Gagal menyalin'))
          }
        >
          Salin
        </Button>
        <Button icon={<DownloadOutlined />} onClick={download}>
          Unduh .txt
        </Button>
      </Space>
    </>
  );
}

import { Alert, Card } from 'antd';
import PageHeader from '@/layout/PageHeader';
import { SettingsTab } from './branches/SettingsTab';

/** Pengaturan cabang & toko (laporan per cabang ada di Laporan Keuangan › Perbandingan cabang) */
export default function BranchesPage() {
  return (
    <>
      <PageHeader title="Cabang & toko" />
      <Card>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Laporan per cabang ada di Akuntansi › Laporan keuangan: pilih cakupan Konsolidasi (pusat + semua cabang), Pusat, atau satu Cabang; tab Perbandingan cabang menampilkan semuanya berdampingan."
        />
        <SettingsTab />
      </Card>
    </>
  );
}

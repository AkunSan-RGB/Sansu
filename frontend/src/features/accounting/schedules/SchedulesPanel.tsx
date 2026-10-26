import FixedAssetsManager from '../fixed-assets/FixedAssetsManager';
import ContractsTab from './ContractsTab';

export type ScheduleSection = 'kontrak' | 'aset';

/** Isi tab Kontrak & pinjaman dan Aset tetap di halaman Laporan pendukung */
export default function SchedulesPanel({ section, year }: { section: ScheduleSection; year: number }) {
  if (section === 'kontrak') return <ContractsTab year={year} />;
  return <FixedAssetsManager />;
}

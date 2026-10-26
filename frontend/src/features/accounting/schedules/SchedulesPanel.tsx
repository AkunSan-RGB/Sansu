import FixedAssetsManager from '../fixed-assets/FixedAssetsManager';

export type ScheduleSection = 'aset';

/** Isi tab Aset tetap di halaman Laporan pendukung */
export default function SchedulesPanel(_props: { section: ScheduleSection; year: number }) {
  return <FixedAssetsManager />;
}

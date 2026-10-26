import { Navigate, useLocation } from 'react-router-dom';

/** Alamat lama /fixed-assets dan /account-schedules: kini tab di Laporan pendukung (tautan dan bookmark lama tetap jalan) */
export default function FixedAssetsRedirect({ kind = 'aset' }: { kind?: 'aset' | 'rincian' }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const legacy = params.get('view');
  // parameter lama: manage=1 → tab Aset tetap; view=contracts|snapshots → tab Kontrak / Laporan dibekukan
  const target = params.get('manage') ? 'aset' : legacy === 'contracts' ? 'kontrak' : legacy === 'snapshots' ? 'beku' : kind;
  params.delete('manage');
  params.delete('view');
  params.set('kind', target);
  return <Navigate to={`/support-reports?${params.toString()}`} replace />;
}

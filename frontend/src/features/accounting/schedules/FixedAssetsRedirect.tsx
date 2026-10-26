import { Navigate, useLocation } from 'react-router-dom';

/** Alamat lama /fixed-assets dan /account-schedules: kini tab Aset tetap di Laporan pendukung (tautan dan bookmark lama tetap jalan) */
export default function FixedAssetsRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.delete('manage');
  params.delete('view');
  params.set('kind', 'aset');
  return <Navigate to={`/support-reports?${params.toString()}`} replace />;
}

import { Navigate, useLocation } from 'react-router-dom';

/** Alamat lama /fixed-assets: aset tetap kini bagian dari menu Rincian & perhitungan akun (tautan dan bookmark lama tetap jalan) */
export default function FixedAssetsRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('manage', '1');
  return <Navigate to={`/account-schedules?${params.toString()}`} replace />;
}

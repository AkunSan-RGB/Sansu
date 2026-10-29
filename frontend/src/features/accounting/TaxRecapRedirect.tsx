import type { TaxRecapTabKey } from '@sansu/shared';
import type { ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useApps } from '@/lib/apps';

/**
 * Alamat lama halaman rekap pajak (/vat, /tax/withheld, /payroll/pph21, /payroll/bpjs) dialihkan ke tab di Rekap pajak.
 * Peran yang tidak memegang Akuntansi (mis. SDM untuk PPh 21 dan BPJS) tidak bisa membuka Rekap pajak, jadi halaman lama tetap tampil untuknya.
 */
export default function TaxRecapRedirect({ tab, children }: { tab: TaxRecapTabKey; children?: ReactNode }) {
  const { can } = useApps();
  const [params] = useSearchParams();
  if (children && !can('accounting')) return <>{children}</>;
  const next = new URLSearchParams(params); // periode (?from=&to=) ikut terbawa
  next.set('tab', tab);
  return <Navigate to={`/tax/recap?${next.toString()}`} replace />;
}

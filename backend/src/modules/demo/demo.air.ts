import { Demo } from './demo.kit';

/** Demo layanan air: tiga loket di lokasi berbeda, layanan non-air ditagih, dan penerimaan loket non-tunai pada hari ini */
export async function airCounters(c: Demo, customers: Map<string, string>) {
  const T = c.admin;
  const loket = [
    { code: 'LKT-01', name: 'Loket Kantor Pusat', location: 'Jl. Kaliurang Km 7, Sleman' },
    { code: 'LKT-02', name: 'Loket Pasar Gamping', location: 'Pasar Gamping, Sleman' },
    { code: 'LKT-03', name: 'Loket Kecamatan Ngaglik', location: 'Kantor Kecamatan Ngaglik' },
  ];
  const ids: string[] = [];
  for (const l of loket) {
    const r = (await c.step(`loket ${l.code}`, () => c.svc.utilityCounters.save(T, l))) as { id: string } | undefined;
    if (r) ids.push(r.id);
  }
  if (!ids.length) return;
  const catalog = (await c.step('katalog layanan non-air', () => c.svc.utilityCharges.list(T.tenantId))) as { id: string; revenueKey: string }[] | undefined;
  const byKey = (k: string) => catalog?.find((x) => x.revenueKey === k)?.id;
  const bill = async (code: string, key: string) => {
    const customerId = customers.get(code);
    const chargeId = byKey(key);
    if (customerId && chargeId) await c.step(`tagihan non-air ${code}`, () => c.svc.utilityCharges.issue(T, { chargeId, customerId }));
  };
  await bill('PLG-007', 'UTILITY_CONNECTION_REVENUE');
  await bill('PLG-004', 'UTILITY_MATERIAL_REVENUE');
  await bill('PLG-003', 'UTILITY_RECONNECT_REVENUE');
  const channels = ['QRIS', 'VA', 'TRANSFER', 'EDC', 'EWALLET'] as const;
  let n = 0;
  for (const name of ['Budi', 'Siti', 'Rina', 'Dedi', 'Maya', 'Hendra']) {
    const hits = (await c.step(`cari tagihan ${name}`, () => c.svc.utilityField.counterSearch(T.tenantId, name))) as { invoiceId: string; outstanding: string }[] | undefined;
    const h = hits?.[0];
    if (!h) continue;
    await c.step(`terima di loket ${name}`, () => c.svc.utilityField.counterPay(T, { invoiceId: h.invoiceId, amount: Number(h.outstanding).toFixed(2), counterId: ids[n % ids.length], channel: channels[n % channels.length] }));
    n++;
  }
}

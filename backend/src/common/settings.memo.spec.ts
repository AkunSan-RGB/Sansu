import { dbScope } from '../db/db-scope';
import { SettingsService } from './settings.service';

type Row = { settings: Record<string, unknown> | null };
function make(rows: Row[] = [{ settings: { tax: { pkp: true }, business: { model: 'FNB' } } }]) {
  const repo = { findTenantsById: jest.fn(async () => rows), writeKey: jest.fn(async () => undefined) };
  return { svc: new SettingsService(repo as never), repo };
}
const inRequest = <T>(fn: () => Promise<T>) => dbScope.run({ bypass: true, memo: new Map() }, fn);

/** Meniru kueri drizzle: malas, dan menjalankan ulang setiap kali di-await */
const lazyRepo = (rows: Row[]) => {
  const runs = jest.fn();
  return { runs, findTenantsById: (db: { name: string }) => ({ then: (ok: (v: Row[]) => unknown, no?: (e: unknown) => unknown) => { runs(db.name); return Promise.resolve(rows).then(ok, no); } }), writeKey: jest.fn(async () => undefined) };
};

describe('pengaturan perusahaan: kueri malas (drizzle) dijalankan sekali', () => {
  it('pembacaan kedua dengan db/transaksi LAIN memakai hasil pertama, tidak menjalankan ulang kueri di koneksi lain', async () => {
    const repo = lazyRepo([{ settings: { tax: { pkp: true } } }]);
    const svc = new SettingsService(repo as never);
    await dbScope.run({ bypass: true, memo: new Map() }, async () => {
      await svc.taxProfile({ name: 'luar-transaksi' } as never, 't1');
      await svc.taxProfile({ name: 'dalam-transaksi' } as never, 't1');
      await svc.businessModel({ name: 'dalam-transaksi' } as never, 't1');
    });
    expect(repo.runs).toHaveBeenCalledTimes(1);
    expect(repo.runs).toHaveBeenCalledWith('luar-transaksi');
  });
});

describe('pengaturan perusahaan: satu kueri per permintaan', () => {
  it('banyak pembacaan dalam satu permintaan hanya satu kueri', async () => {
    const { svc, repo } = make();
    await inRequest(async () => {
      await svc.businessModel({} as never, 't1');
      await svc.taxProfile({} as never, 't1');
      await svc.section({} as never, 't1', 'x', {});
      await Promise.all([svc.businessModel({} as never, 't1'), svc.taxProfile({} as never, 't1')]);
    });
    expect(repo.findTenantsById).toHaveBeenCalledTimes(1);
  });
  it('penulisan membuang catatan sehingga pembacaan berikutnya melihat nilai baru', async () => {
    const { svc, repo } = make();
    await inRequest(async () => {
      await svc.taxProfile({} as never, 't1');
      await svc.saveTaxProfile({} as never, 't1', { pkp: false });
      await svc.taxProfile({} as never, 't1');
    });
    expect(repo.findTenantsById.mock.calls.length).toBe(2); // baca awal (dipakai juga oleh simpan), lalu baca segar sesudah simpan
    expect(repo.writeKey).toHaveBeenCalledTimes(1);
  });
  it('perusahaan berbeda tidak berbagi catatan, permintaan berbeda tidak berbagi catatan', async () => {
    const { svc, repo } = make();
    await inRequest(async () => { await svc.taxProfile({} as never, 't1'); await svc.taxProfile({} as never, 't2'); });
    await inRequest(async () => { await svc.taxProfile({} as never, 't1'); });
    expect(repo.findTenantsById).toHaveBeenCalledTimes(3);
  });
  it('tanpa lingkup permintaan (tugas latar) tidak ada catatan: selalu baca segar', async () => {
    const { svc, repo } = make();
    await svc.taxProfile({} as never, 't1');
    await svc.taxProfile({} as never, 't1');
    expect(repo.findTenantsById).toHaveBeenCalledTimes(2);
  });
  it('baris belum ada (kosong) tidak diingat', async () => {
    const { svc, repo } = make([]);
    await inRequest(async () => { await svc.taxProfile({} as never, 't1'); await new Promise((r) => setImmediate(r)); await svc.taxProfile({} as never, 't1'); });
    expect(repo.findTenantsById).toHaveBeenCalledTimes(2);
  });
});

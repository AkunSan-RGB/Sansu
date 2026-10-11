import { signApprovalLink, verifyApprovalLink } from './approval-link';

describe('tautan persetujuan email', () => {
  const p = { k: 'AR' as const, r: '11111111-1111-4111-8111-111111111111', u: '22222222-2222-4222-8222-222222222222' };
  it('token sah dibaca kembali', () => {
    expect(verifyApprovalLink(signApprovalLink(p))).toMatchObject(p);
  });
  it('kedaluwarsa setelah 72 jam', () => {
    const t = signApprovalLink(p, 1_000);
    expect(verifyApprovalLink(t, 1_000 + 71 * 3600_000)).not.toBeNull();
    expect(verifyApprovalLink(t, 1_000 + 73 * 3600_000)).toBeNull();
  });
  it('menolak token yang diubah, dipotong, atau sembarang', () => {
    const t = signApprovalLink(p);
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...p, u: '33333333-3333-4333-8333-333333333333', exp: Date.now() + 1e9 })).toString('base64url');
    expect(verifyApprovalLink(`${forged}.${sig}`)).toBeNull();
    expect(verifyApprovalLink(`${body}.${sig.slice(0, -2)}`)).toBeNull();
    expect(verifyApprovalLink(`${body}.`)).toBeNull();
    expect(verifyApprovalLink('')).toBeNull();
    expect(verifyApprovalLink('a.b.c')).toBeNull();
    expect(verifyApprovalLink(`${body}.${sig}.x`)).toBeNull();
  });
});

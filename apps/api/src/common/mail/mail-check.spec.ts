import { evaluateMailSetup, senderDomain, type MailDnsFacts } from './mail-check';

const base: MailDnsFacts = { domain: 'perusahaan.co.id', spf: 'v=spf1 include:spf.brevo.com ~all', dmarc: 'v=DMARC1; p=none', dkim: ['brevo1'], appUrl: 'https://erp.perusahaan.co.id', smtpConfigured: true };
const by = (f: MailDnsFacts) => Object.fromEntries(evaluateMailSetup(f).map((c) => [c.key, c.status]));

describe('pemeriksaan email', () => {
  it('mengambil domain dari MAIL_FROM', () => {
    expect(senderDomain('SANSU <no-reply@Perusahaan.co.id>')).toBe('perusahaan.co.id');
    expect(senderDomain('no-reply@x.id')).toBe('x.id');
    expect(senderDomain('tanpa alamat')).toBeNull();
  });
  it('semua benar = OK', () => {
    expect(Object.values(by(base)).every((s) => s === 'OK')).toBe(true);
  });
  it('domain contoh/bersama = ERROR dan SPF/DKIM tidak dinilai', () => {
    const r = by({ ...base, domain: 'contoh.co.id', spf: null, dkim: [], dmarc: null });
    expect(r.from).toBe('ERROR');
    expect(r.spf).toBeUndefined();
  });
  it('SPF hilang = ERROR, +all = ERROR, DKIM/DMARC hilang = WARN', () => {
    expect(by({ ...base, spf: null }).spf).toBe('ERROR');
    expect(by({ ...base, spf: 'v=spf1 +all' }).spf).toBe('ERROR');
    const r = by({ ...base, dkim: [], dmarc: null });
    expect(r.dkim).toBe('WARN');
    expect(r.dmarc).toBe('WARN');
  });
  it('alamat aplikasi lokal, tanpa HTTPS, atau beda domain = WARN', () => {
    expect(by({ ...base, appUrl: 'http://localhost:5173' }).appurl).toBe('WARN');
    expect(by({ ...base, appUrl: 'http://erp.perusahaan.co.id' }).appurl).toBe('WARN');
    expect(by({ ...base, appUrl: 'https://lain.com' }).appurl).toBe('WARN');
  });
  it('SMTP belum diisi = ERROR', () => {
    expect(by({ ...base, smtpConfigured: false }).smtp).toBe('ERROR');
  });
});

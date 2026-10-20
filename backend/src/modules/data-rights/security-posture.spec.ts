import { isNeonUrl } from './security-posture';

describe('isNeonUrl', () => {
  it('mengenali alamat Neon (langsung maupun pooler), dan tidak yang lain', () => {
    expect(isNeonUrl('postgresql://u:p@ep-abc-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require')).toBe(true);
    expect(isNeonUrl('postgresql://u:p@ep-abc-123-pooler.ap-southeast-1.aws.neon.tech:5432/neondb')).toBe(true);
    expect(isNeonUrl('postgresql://u:p@ep-abc.neon.tech')).toBe(true);
    expect(isNeonUrl('postgresql://u:p@postgres.railway.internal:5432/railway')).toBe(false);
    expect(isNeonUrl('postgresql://u:p@evil.com/neon.tech')).toBe(false);
    expect(isNeonUrl('postgresql://neon.tech:p@evil.com/db')).toBe(false);
    expect(isNeonUrl(undefined)).toBe(false);
  });
});

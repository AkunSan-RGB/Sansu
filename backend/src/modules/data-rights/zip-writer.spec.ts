import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { crc32, ZipWriter } from './zip-writer';

async function build(files: Record<string, string[]>) {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on('data', (c) => chunks.push(c));
  const zip = new ZipWriter(out);
  for (const [name, parts] of Object.entries(files)) await zip.addFile(name, async (push) => { for (const p of parts) await push(p); });
  await zip.finish();
  return Buffer.concat(chunks);
}

describe('ZipWriter', () => {
  it('crc32 sesuai nilai baku', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('menghasilkan ZIP yang valid dan isinya utuh (diverifikasi dengan python zipfile)', async () => {
    const big = 'baris,data,uji\n'.repeat(60_000);
    const buf = await build({ 'a.csv': ['x,y\n', '1,2\n'], 'folder/laporan ü.csv': [big], 'kosong.txt': [] });
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    try {
      const f = join(dir, 'u.zip');
      writeFileSync(f, buf);
      const py = `import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({'bad':z.testzip(),'names':z.namelist(),'a':z.read('a.csv').decode(),'big':len(z.read('folder/laporan ü.csv')),'empty':len(z.read('kosong.txt'))}))`;
      const r = JSON.parse(execFileSync('python3', ['-I', '-c', py, f]).toString());
      expect(r.bad).toBeNull();
      expect(r.names).toEqual(['a.csv', 'folder/laporan ü.csv', 'kosong.txt']);
      expect(r.a).toBe('x,y\n1,2\n');
      expect(r.big).toBe(big.length);
      expect(r.empty).toBe(0);
      expect(readFileSync(f).length).toBeLessThan(big.length); // terkompresi
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

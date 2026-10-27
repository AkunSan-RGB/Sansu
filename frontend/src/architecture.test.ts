import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname);
/** Batas baris per berkas: berkas yang lebih besar dipecah per tanggung jawab (halaman besar → bagian-bagian kecil) */
const MAX_LINES = 700;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe('arsitektur frontend', () => {
  it(`tidak ada berkas sumber lebih dari ${MAX_LINES} baris`, () => {
    const big = walk(SRC)
      .map((p) => ({ file: relative(SRC, p), lines: readFileSync(p, 'utf8').split('\n').length }))
      .filter((x) => x.lines > MAX_LINES);
    expect(big).toEqual([]);
  });
});

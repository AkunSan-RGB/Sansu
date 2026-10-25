/**
 * Uji arsitektur (fitness function): aturan struktur kode yang dijaga otomatis agar tidak membusuk lagi.
 *  1. Satu berkas satu peran: NAMA.dto.ts, NAMA.service.ts, NAMA.controller.ts, NAMA.module.ts (modul hanya berisi @Module)
 *  2. Pengendali tidak menyentuh database/ORM langsung (lewat service)
 *  3. Arah dependensi: dto -> (tidak ke service/pengendali modul), service -> (tidak ke pengendali)
 *  4. Tidak ada siklus antar-modul (folder src/modules/*)
 *  5. Tidak ada berkas sumber lebih dari 1.300 baris (kecuali pembuat data demo)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const SRC = __dirname;
const files: string[] = [];
(function walk(d: string) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) files.push(p);
  }
})(SRC);

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
const layerOf = (f: string) => (/\.controller\.ts$/.test(f) ? 'controller' : /\.dto\.ts$/.test(f) ? 'dto' : /\.service\.ts$/.test(f) ? 'service' : /\.module\.ts$/.test(f) ? 'module' : null);
const parsed = new Map(files.map((f) => [f, ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true)]));
const decoratorsOf = (n: ts.Node) => (ts.canHaveDecorators(n) ? ts.getDecorators(n) ?? [] : []).map((d) => (ts.isCallExpression(d.expression) ? d.expression.expression.getText() : d.expression.getText()));
const importsOf = (f: string) => parsed.get(f)!.statements.filter(ts.isImportDeclaration).map((s) => ({ spec: (s.moduleSpecifier as ts.StringLiteral).text, typeOnly: !!s.importClause?.isTypeOnly }));

describe('arsitektur', () => {
  it('berkas NAMA.dto/service/controller/module berisi hanya perannya', () => {
    const bad: string[] = [];
    for (const f of files) {
      const layer = layerOf(f);
      if (!layer) continue;
      for (const s of parsed.get(f)!.statements) {
        if (!ts.isClassDeclaration(s)) continue;
        const d = decoratorsOf(s);
        const has = { controller: d.includes('Controller'), module: d.includes('Module'), service: d.includes('Injectable') };
        if (layer === 'controller' && (has.module || has.service)) bad.push(`${rel(f)}: ${s.name?.text} bukan pengendali`);
        if (layer === 'module' && (has.controller || has.service)) bad.push(`${rel(f)}: ${s.name?.text} tidak boleh ada di berkas modul`);
        if (layer === 'dto' && (has.controller || has.module || has.service)) bad.push(`${rel(f)}: ${s.name?.text} tidak boleh ada di berkas dto`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('pengendali tidak mengimpor ORM/skema/koneksi database', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => layerOf(x) === 'controller')) for (const { spec } of importsOf(f)) if (/^drizzle-orm/.test(spec) || /db\/schema/.test(spec) || /db\/db\.module/.test(spec)) bad.push(`${rel(f)} -> ${spec}`);
    expect(bad).toEqual([]);
  });

  it('arah dependensi: service tidak ke pengendali; dto tidak ke service/pengendali modul', () => {
    const bad: string[] = [];
    for (const f of files) {
      const layer = layerOf(f);
      if (layer !== 'service' && layer !== 'dto') continue;
      for (const { spec, typeOnly } of importsOf(f)) {
        if (!spec.startsWith('.')) continue;
        const t = layerOf(path.resolve(path.dirname(f), spec) + '.ts');
        if (layer === 'service' && t === 'controller') bad.push(`${rel(f)} -> ${spec}`);
        if (layer === 'dto' && (t === 'service' || t === 'controller') && !typeOnly && !/\/common\//.test(path.resolve(path.dirname(f), spec).split(path.sep).join('/'))) bad.push(`${rel(f)} -> ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('tidak ada siklus antar-modul (src/modules/*)', () => {
    const modOf = (f: string) => /^modules\/([^/]+)\//.exec(rel(f))?.[1] ?? null;
    const edges = new Map<string, Set<string>>();
    for (const f of files) {
      const a = modOf(f);
      if (!a) continue;
      for (const { spec } of importsOf(f)) {
        if (!spec.startsWith('.')) continue;
        const b = modOf(path.resolve(path.dirname(f), spec) + '.ts');
        if (b && b !== a) edges.set(a, (edges.get(a) ?? new Set()).add(b));
      }
    }
    const reach = (from: string, to: string, seen = new Set<string>()): boolean => {
      if (from === to) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return [...(edges.get(from) ?? [])].some((n) => reach(n, to, seen));
    };
    const cycles: string[] = [];
    for (const [a, set] of edges) for (const b of set) if (a < b && reach(b, a)) cycles.push(`${a} <-> ${b}`);
    expect(cycles).toEqual([]);
  });

  it('tidak ada berkas sumber lebih dari 1.300 baris (kecuali pembuat data demo)', () => {
    const big = files.filter((f) => !/\/(demo)\//.test(f) && !/demo\.(seeds|extra|kit)\.ts$/.test(f) && fs.readFileSync(f, 'utf8').split('\n').length > 1300).map(rel);
    expect(big).toEqual([]);
  });
});

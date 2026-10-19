import { csvCell, csvRow, neutralizeFormula } from './csv';

describe('csv', () => {
  it('menyaring tanda kutip, koma, dan baris baru', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('katanya "ok"')).toBe('"katanya ""ok"""');
    expect(csvCell('baris1\nbaris2')).toBe('"baris1\nbaris2"');
    expect(csvRow(['a', 'b'])).toBe('a,b\r\n');
  });

  it('nilai khusus', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(new Date('2026-10-19T01:02:03.000Z'))).toBe('2026-10-19T01:02:03.000Z');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(['x', 'y'])).toBe('"[""x"",""y""]"');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(Buffer.from([1, 255]))).toBe('\\x01ff');
  });

  it('teks yang tampak seperti rumus dinetralkan, angka negatif tidak diubah', () => {
    expect(neutralizeFormula('=HYPERLINK("http://jahat.example")')).toBe(`'=HYPERLINK("http://jahat.example")`);
    expect(csvCell('+62812', true)).toBe("'+62812");
    expect(csvCell('@cmd', true)).toBe("'@cmd");
    expect(csvCell('-5000.00', false)).toBe('-5000.00'); // kolom angka (bukan teks) tidak disentuh
    expect(csvCell('biasa', true)).toBe('biasa');
  });
});

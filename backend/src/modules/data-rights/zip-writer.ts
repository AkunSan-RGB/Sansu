/**
 * Penulis berkas ZIP streaming tanpa ketergantungan pustaka: setiap entri dikompres (deflate) sambil dialirkan, ukuran dan CRC
 * ditulis sesudahnya (data descriptor), lalu direktori pusat di akhir. Tanpa ZIP64, jadi satu entri maksimal ~4 GB (cukup untuk CSV).
 */
import { createDeflateRaw } from 'node:zlib';
import { Writable } from 'node:stream';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array, prev = 0): number {
  let c = ~prev >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const MAX_ENTRY = 0xfffffffe;

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

interface Central {
  name: Buffer;
  crc: number;
  csize: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export class ZipWriter {
  private offset = 0;
  private readonly entries: Central[] = [];
  private open = false;

  constructor(private readonly out: Writable) {}

  private async write(buf: Buffer) {
    this.offset += buf.length;
    if (!this.out.write(buf)) await new Promise<void>((resolve, reject) => {
      const onDrain = () => { this.out.off('error', onError); resolve(); };
      const onError = (e: Error) => { this.out.off('drain', onDrain); reject(e); };
      this.out.once('drain', onDrain);
      this.out.once('error', onError);
    });
  }

  /** Tambah satu berkas; `produce` memanggil `push(chunk)` untuk tiap potongan isi (berurutan, menunggu tekanan balik) */
  async addFile(name: string, produce: (push: (chunk: Buffer | string) => Promise<void>) => Promise<void>, when = new Date()): Promise<{ size: number; crc: number }> {
    if (this.open) throw new Error('Entri sebelumnya belum selesai');
    this.open = true;
    const nameBuf = Buffer.from(name, 'utf8');
    const { time, date } = dosDateTime(when);
    const offset = this.offset;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versi minimum
    local.writeUInt16LE(0x0808, 6); // bit 3: data descriptor, bit 11: nama UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt16LE(nameBuf.length, 26);
    await this.write(Buffer.concat([local, nameBuf]));

    const deflate = createDeflateRaw({ level: 6 });
    let csize = 0;
    let size = 0;
    let crc = 0;
    const done = new Promise<void>((resolve, reject) => {
      deflate.on('error', reject);
      deflate.on('end', resolve);
    });
    const pump = (async () => {
      for await (const chunk of deflate) {
        csize += (chunk as Buffer).length;
        await this.write(chunk as Buffer);
      }
    })();
    const push = async (chunk: Buffer | string) => {
      const b = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      if (!b.length) return;
      size += b.length;
      if (size > MAX_ENTRY) throw new Error(`Berkas ${name} terlalu besar untuk ZIP (maks 4 GB)`);
      crc = crc32(b, crc);
      if (!deflate.write(b)) await new Promise<void>((resolve) => deflate.once('drain', resolve));
    };
    try {
      await produce(push);
    } catch (e) {
      deflate.destroy();
      this.open = false;
      throw e;
    }
    deflate.end();
    await Promise.all([done, pump]);

    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc, 4);
    desc.writeUInt32LE(csize, 8);
    desc.writeUInt32LE(size, 12);
    await this.write(desc);
    this.entries.push({ name: nameBuf, crc, csize, size, offset, time, date });
    this.open = false;
    return { size, crc };
  }

  async finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0808, 8);
      c.writeUInt16LE(8, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.csize, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt32LE(e.offset, 42);
      await this.write(Buffer.concat([c, e.name]));
    }
    const size = this.offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    await new Promise<void>((resolve) => this.out.end(resolve));
  }
}

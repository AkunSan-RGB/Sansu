/**
 * Penyimpanan objek (S3-compatible, mis. Cloudflare R2) untuk gambar bukti: foto meter, foto/tanda tangan bukti kirim.
 *
 * Kolom basis data menyimpan salah satu dari dua bentuk:
 *   - `obj:<kunci>`  → gambar ada di bucket (kunci selalu diawali ID perusahaan)
 *   - `data:image/…` → gambar lama (atau penyimpanan belum dikonfigurasi) langsung di basis data
 * Bucket privat; gambar hanya keluar lewat endpoint aplikasi yang sudah memeriksa peran dan perusahaan.
 * Variabel kosong = penyimpanan nonaktif dan semuanya tetap tersimpan di basis data seperti sebelumnya.
 */
import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, Global, Injectable, Logger, Module, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
export const MAX_IMAGE_BYTES = 350_000;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const KEY_RE = /^[0-9a-f-]{36}\/[a-z-]+\/[0-9a-f-]{36}\.(png|jpg|webp)$/;

/** Tanda tangan berkas asli: isi harus sungguh gambar, bukan sekadar berlabel gambar */
function looksLike(mime: string, b: Buffer) {
  if (mime === 'image/png') return b.length > 8 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger('Penyimpanan');
  private client?: S3Client;
  private readonly bucket = process.env.STORAGE_BUCKET ?? '';

  get enabled() {
    return !!(process.env.STORAGE_ENDPOINT && this.bucket && process.env.STORAGE_ACCESS_KEY_ID && process.env.STORAGE_SECRET_ACCESS_KEY);
  }

  private s3() {
    this.client ??= new S3Client({
      region: 'auto',
      endpoint: process.env.STORAGE_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY! },
    });
    return this.client;
  }

  static isRef(v: string | null | undefined): v is string {
    return !!v && v.startsWith('obj:');
  }

  /** Periksa data URL gambar (jenis, ukuran, isi) dan kembalikan bytes-nya */
  parse(dataUrl: string) {
    const m = DATA_URL.exec(dataUrl);
    if (!m) throw new BadRequestException('Gambar harus png/jpeg/webp');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) throw new BadRequestException('Gambar terlalu besar');
    if (!looksLike(m[1], buf)) throw new BadRequestException('Isi berkas bukan gambar yang valid');
    return { mime: m[1], buf };
  }

  /**
   * Simpan gambar dan kembalikan nilai untuk kolom basis data.
   * Penyimpanan nonaktif → data URL dikembalikan apa adanya (setelah divalidasi).
   */
  async store(tenantId: string, kind: string, dataUrl: string | null | undefined): Promise<string | null> {
    if (!dataUrl) return null;
    const { mime, buf } = this.parse(dataUrl);
    if (!this.enabled) return dataUrl;
    const key = `${tenantId}/${kind}/${randomUUID()}.${EXT[mime]}`;
    await this.s3().send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentType: mime, ContentLength: buf.length }));
    return `obj:${key}`;
  }

  /** Ambil gambar sebagai data URL. Rujukan milik perusahaan lain ditolak. */
  async load(tenantId: string, value: string | null | undefined): Promise<string | null> {
    if (!value) return null;
    if (!StorageService.isRef(value)) return value;
    const key = value.slice(4);
    if (!key.startsWith(`${tenantId}/`) || !KEY_RE.test(key)) throw new NotFoundException('Gambar tidak ditemukan');
    if (!this.enabled) throw new NotFoundException('Penyimpanan gambar belum dikonfigurasi');
    const r = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = Buffer.from(await r.Body!.transformToByteArray());
    return `data:${r.ContentType ?? 'image/jpeg'};base64,${bytes.toString('base64')}`;
  }

  /** Hapus satu gambar (mis. transaksi gagal setelah unggah); kegagalan dicatat, tidak dilempar */
  async discard(value: string | null | undefined) {
    if (!StorageService.isRef(value) || !this.enabled) return;
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: value.slice(4) })).catch((e) => this.logger.warn(`Gagal menghapus ${value}: ${(e as Error).message}`));
  }

  /** Jalankan pekerjaan yang menyimpan rujukan gambar; bila gagal, gambar yang baru diunggah dihapus lagi */
  async guard<T>(refs: (string | null)[], work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      for (const r of refs) await this.discard(r);
      throw e;
    }
  }

  /** Hapus semua gambar satu perusahaan (penghapusan data perusahaan). Mengembalikan jumlah yang terhapus. */
  async deleteTenant(tenantId: string): Promise<number> {
    if (!this.enabled) return 0;
    let removed = 0;
    let token: string | undefined;
    do {
      const page = await this.s3().send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: `${tenantId}/`, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) {
        const res = await this.s3().send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
        if (res.Errors?.length) throw new Error(`Gagal menghapus ${res.Errors.length} berkas perusahaan ${tenantId}`);
        removed += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}

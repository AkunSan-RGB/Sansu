/**
 * Ekspor seluruh data satu perusahaan (portabilitas data): arsip ZIP berisi satu CSV per tabel + manifest berisi jumlah baris dan
 * checksum SHA-256 tiap berkas. Dijalankan dalam satu snapshot database (repeatable read, hanya baca) di bawah lingkup RLS
 * perusahaan peminta, sehingga isolasi antar perusahaan dijaga database sendiri; filter tenant_id ditambahkan lagi sebagai lapis kedua.
 * Rahasia (hash kata sandi, rahasia 2FA, token, kunci API) tidak pernah ikut.
 */
import {
  BadRequestException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { appUrl, MailService } from '../../common/mail/mail.service';
import { randomToken, sha256 } from '../../common/utils/secret';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { dbScope } from '../../db/db-scope';
import { auditLogs, dataExportTokens, tenants, users } from '../../db/schema';
import { CSV_BOM, csvCell, csvRow } from './csv';
import { ReauthService } from './reauth';
import { ZipWriter } from './zip-writer';

export const EXPORT_TOKEN_TTL_SECONDS = 300;
const EXPORT_COOLDOWN_MIN = 10;
const BATCH = 2000;

/** Kolom yang tidak pernah diekspor: rahasia dan token */
export const SENSITIVE_COLUMN = /(password|secret|token|credential|key_hash|api_key|backup_codes|link_code)/i;
/** Tabel yang tidak diekspor: rahasia murni, catatan teknis, atau data pemilik layanan */
export const EXCLUDED_TABLES = new Set([
  'auth_tokens',
  'error_logs',
  'data_export_tokens',
  'data_erasure_log',
  'idempotency_keys',
]);

const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hapus kunci bernuansa rahasia dari JSON pengaturan (rekursif) */
export function redactSettings(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactSettings);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !SENSITIVE_COLUMN.test(k))
        .map(([k, x]) => [k, redactSettings(x)]),
    );
  }
  return v;
}

export interface ExportTableInfo {
  name: string;
  file: string;
  rows: number;
  columns: string[];
  excludedColumns: string[];
  sha256: string;
  bytes: number;
}

const README = (company: string, at: string) => `ARSIP DATA PERUSAHAAN — ${company}
Dibuat: ${at}

Isi arsip
- data/<nama_tabel>.csv  Satu berkas CSV per tabel (UTF-8, pemisah koma, judul kolom di baris pertama).
- manifest.json          Daftar berkas, jumlah baris, kolom yang tidak disertakan, dan checksum SHA-256 tiap berkas.
- README.txt             Berkas ini.

Memeriksa keutuhan
Hitung SHA-256 tiap berkas CSV dan bandingkan dengan nilai di manifest.json (mis. "sha256sum data/*.csv" di Linux/Mac,
atau "Get-FileHash" di PowerShell).

Yang sengaja TIDAK disertakan
Kata sandi (hash), rahasia verifikasi 2 langkah, kode cadangan, token dan kunci API pihak ketiga, serta catatan teknis server.
Kolom yang dilewati tercatat per tabel di manifest.json (excludedColumns).

Catatan membuka di Excel
Sel teks yang diawali = + - atau @ diberi tanda petik di depannya (') supaya tidak dijalankan sebagai rumus. Hapus tanda itu bila
Anda memerlukan nilai aslinya. Kolom bertipe angka tidak diubah. Tanggal dan waktu memakai format ISO 8601 (UTC untuk waktu).
Kolom bertipe JSON ditulis sebagai teks JSON.

Kerahasiaan
Arsip ini memuat seluruh data bisnis dan data pribadi (pelanggan, pemasok, karyawan) perusahaan Anda. Simpan di tempat aman,
jangan dibagikan, dan hapus salinan yang tidak diperlukan. Anda bertanggung jawab atas penyimpanannya, termasuk kewajiban
menyimpan pembukuan dan dokumen pajak sesuai peraturan.
`;

@Injectable()
export class TenantExportService {
  private readonly logger = new Logger('EksporData');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly reauth: ReauthService,
    private readonly mail: MailService,
  ) {}

  /** Langkah 1: verifikasi ulang identitas, lalu terbitkan tautan unduh sekali pakai yang berlaku singkat */
  async prepare(u: AuthUser, dto: { password: string; code?: string }) {
    if (u.role !== 'OWNER')
      throw new HttpException('Hanya pemilik perusahaan yang boleh mengekspor seluruh data', HttpStatus.FORBIDDEN);
    const [{ n }] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, u.tenantId),
          eq(auditLogs.action, 'DATA_EXPORT_REQUEST'),
          gt(auditLogs.createdAt, sql`now() - (${EXPORT_COOLDOWN_MIN} * interval '1 minute')`),
        ),
      )) as [{ n: number }];
    if (n > 0)
      throw new HttpException(
        `Ekspor baru bisa diminta ${EXPORT_COOLDOWN_MIN} menit setelah ekspor sebelumnya.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    await this.reauth.verify(u, dto.password, dto.code, 'DATA_EXPORT');

    const token = randomToken();
    await this.db
      .insert(dataExportTokens)
      .values({
        tenantId: u.tenantId,
        userId: u.sub,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + EXPORT_TOKEN_TTL_SECONDS * 1000),
      });
    await this.audit.log(this.db, {
      tenantId: u.tenantId,
      userId: u.sub,
      action: 'DATA_EXPORT_REQUEST',
      entity: 'Tenant',
      entityId: u.tenantId,
      data: { by: u.email },
    });
    void this.alert(u).catch((e) => this.logger.warn(`Pemberitahuan ekspor gagal: ${(e as Error).message}`));
    return { path: `/api/company-data/export/${token}`, expiresInSeconds: EXPORT_TOKEN_TTL_SECONDS };
  }

  /** Beritahu pemilik dan admin bahwa seluruh data sedang diekspor (peringatan keamanan) */
  private async alert(u: AuthUser) {
    if (!this.mail.configured) return;
    const to = await this.db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, u.tenantId), eq(users.isActive, true), inArray(users.role, ['OWNER', 'ADMIN'])));
    for (const t of to) {
      await this.mail.send({
        to: t.email,
        subject: 'Seluruh data perusahaan Anda diekspor',
        heading: 'Ekspor seluruh data',
        paragraphs: [
          `Akun ${u.email} baru saja meminta ekspor seluruh data perusahaan Anda di SANSU.`,
          'Jika ini bukan Anda atau tim Anda, segera ganti kata sandi, aktifkan verifikasi 2 langkah, dan hubungi dukungan SANSU.',
        ],
        action: { label: 'Buka SANSU', url: appUrl() },
      });
    }
  }

  /** Langkah 2: tukar token dengan arsip ZIP yang dialirkan langsung ke browser */
  async stream(token: string, res: Response) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new NotFoundException('Tautan unduhan tidak ditemukan');
    // Sekali pakai dan atomik: dua permintaan serentak tidak bisa sama-sama lolos
    const claimed = await this.db.execute<{ tenant_id: string; user_id: string }>(sql`
      UPDATE data_export_tokens SET used_at = now() WHERE token_hash = ${sha256(token)} AND used_at IS NULL AND expires_at > now() RETURNING tenant_id, user_id`);
    const row = claimed.rows[0];
    if (!row)
      throw new GoneException(
        'Tautan unduhan sudah dipakai atau kedaluwarsa. Minta ekspor baru dari Pengaturan › Data & privasi.',
      );
    const tenantId = row.tenant_id;
    if (!UUID_RE.test(tenantId)) throw new BadRequestException('Perusahaan tidak valid');

    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, row.user_id), eq(users.tenantId, tenantId)));
    if (!user || !user.isActive || user.role !== 'OWNER')
      throw new HttpException('Akun tidak lagi berhak mengekspor data', HttpStatus.FORBIDDEN);
    const [company] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!company) throw new NotFoundException('Perusahaan tidak ditemukan');

    const stamp = new Date();
    const slug =
      company.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'perusahaan';
    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sansu-${slug}-${stamp.toISOString().slice(0, 10)}.zip"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    try {
      const summary = await dbScope.run({ tenantId, bypass: false }, () =>
        this.build(tenantId, company, user.email, stamp, res),
      );
      await dbScope.run({ tenantId, bypass: false }, () =>
        this.audit.log(this.db, {
          tenantId,
          userId: user.id,
          action: 'DATA_EXPORT',
          entity: 'Tenant',
          entityId: tenantId,
          data: { tables: summary.tables, rows: summary.rows },
        }),
      );
    } catch (e) {
      this.logger.error(`Ekspor perusahaan ${tenantId} gagal: ${(e as Error).message}`);
      await dbScope
        .run({ tenantId, bypass: false }, () =>
          this.audit.log(this.db, {
            tenantId,
            userId: user.id,
            action: 'DATA_EXPORT_FAILED',
            entity: 'Tenant',
            entityId: tenantId,
            data: { error: (e as Error).message.slice(0, 200) },
          }),
        )
        .catch(() => undefined);
      res.destroy(e as Error); // putus koneksi agar browser menandai unduhan gagal, bukan menyimpan arsip terpotong
    }
  }

  private async build(tenantId: string, company: typeof tenants.$inferSelect, by: string, stamp: Date, res: Response) {
    const files: ExportTableInfo[] = [];
    let totalRows = 0;
    await this.db.transaction(
      async (tx) => {
        const rlsTables = (
          await tx.execute<{ t: string }>(sql`
          SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity ORDER BY c.relname`)
        ).rows.map((r) => r.t);
        const tables = ['tenants', ...rlsTables.filter((t) => !EXCLUDED_TABLES.has(t) && t !== 'tenants')];
        const meta = (
          await tx.execute<{ t: string; c: string; ty: string }>(sql`
          SELECT table_name AS t, column_name AS c, data_type AS ty FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)
        ).rows;
        const byTable = new Map<string, { c: string; ty: string }[]>();
        for (const m of meta) byTable.set(m.t, [...(byTable.get(m.t) ?? []), { c: m.c, ty: m.ty }]);

        const zip = new ZipWriter(res);
        for (const t of tables) {
          const all = byTable.get(t) ?? [];
          const kept = all.filter((x) => !SENSITIVE_COLUMN.test(x.c));
          if (!kept.length) continue;
          const where =
            t === 'tenants'
              ? ` WHERE id = '${tenantId}'`
              : all.some((x) => x.c === 'tenant_id')
                ? ` WHERE tenant_id = '${tenantId}'`
                : '';
          const hash = createHash('sha256');
          let bytes = 0;
          let rows = 0;
          const isText = kept.map((x) => ['text', 'character varying', 'character'].includes(x.ty));
          await zip.addFile(
            `data/${t}.csv`,
            async (push) => {
              const emit = async (s: string) => {
                const b = Buffer.from(s, 'utf8');
                hash.update(b);
                bytes += b.length;
                await push(b);
              };
              await emit(CSV_BOM + csvRow(kept.map((x) => csvCell(x.c))));
              await tx.execute(
                sql.raw(
                  `DECLARE exp_cur NO SCROLL CURSOR FOR SELECT ${kept.map((x) => quote(x.c)).join(', ')} FROM ${quote(t)}${where}`,
                ),
              );
              for (;;) {
                const batch = (
                  await tx.execute<Record<string, unknown>>(sql.raw(`FETCH FORWARD ${BATCH} FROM exp_cur`))
                ).rows;
                if (!batch.length) break;
                let text = '';
                for (const r of batch) {
                  if (t === 'tenants' && r.settings) r.settings = redactSettings(r.settings);
                  text += csvRow(kept.map((x, i) => csvCell(r[x.c], isText[i])));
                }
                rows += batch.length;
                await emit(text);
              }
              await tx.execute(sql.raw('CLOSE exp_cur'));
            },
            stamp,
          );
          totalRows += rows;
          files.push({
            name: t,
            file: `data/${t}.csv`,
            rows,
            columns: kept.map((x) => x.c),
            excludedColumns: all.filter((x) => SENSITIVE_COLUMN.test(x.c)).map((x) => x.c),
            sha256: hash.digest('hex'),
            bytes,
          });
        }

        const manifest = {
          format: 'sansu-export-v1',
          company: { id: tenantId, name: company.name },
          exportedAt: stamp.toISOString(),
          exportedBy: by,
          snapshot: 'repeatable-read',
          tables: files,
          totals: { tables: files.length, rows: totalRows },
        };
        await zip.addFile('manifest.json', async (push) => push(JSON.stringify(manifest, null, 2)), stamp);
        await zip.addFile('README.txt', async (push) => push(README(company.name, stamp.toISOString())), stamp);
        await zip.finish();
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    return { tables: files.length, rows: totalRows };
  }
}

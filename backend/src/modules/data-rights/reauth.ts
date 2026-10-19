/**
 * Verifikasi ulang identitas untuk tindakan berisiko tinggi (ekspor seluruh data, penghapusan perusahaan): kata sandi saat ini
 * dan, bila verifikasi 2 langkah aktif, kode TOTP atau kode cadangan. Percobaan gagal dicatat di jejak audit dan dibatasi
 * (berlaku lintas instance karena disimpan di database).
 */
import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { and, eq, gt, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { normalizeBackupCode, verifyTotp } from '../../common/auth/totp';
import { AuditService } from '../../common/audit/audit.service';
import { decrypt, sha256 } from '../../common/utils/secret';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { auditLogs, users } from '../../db/schema';

export const MAX_REAUTH_FAILS = 5;
const WINDOW_MIN = 15;

@Injectable()
export class ReauthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async verify(a: AuthUser, password: string, code: string | undefined, purpose: string): Promise<void> {
    const [{ n }] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, a.tenantId), eq(auditLogs.userId, a.sub), eq(auditLogs.action, 'REAUTH_FAILED'), gt(auditLogs.createdAt, sql`now() - (${WINDOW_MIN} * interval '1 minute')`)))) as [{ n: number }];
    if (n >= MAX_REAUTH_FAILS) throw new HttpException(`Terlalu banyak percobaan verifikasi yang gagal. Coba lagi dalam ${WINDOW_MIN} menit.`, HttpStatus.TOO_MANY_REQUESTS);

    const [u] = await this.db.select().from(users).where(and(eq(users.id, a.sub), eq(users.tenantId, a.tenantId)));
    const fail = async (msg: string): Promise<never> => {
      await this.audit.log(this.db, { tenantId: a.tenantId, userId: a.sub, action: 'REAUTH_FAILED', entity: 'Security', entityId: a.sub, data: { purpose } });
      throw new BadRequestException(msg);
    };
    if (!u || !u.isActive) return fail('Akun tidak ditemukan');
    if (!password || !(await bcrypt.compare(password, u.passwordHash))) return fail('Kata sandi salah');
    if (u.totpEnabledAt && u.totpSecret) {
      if (!code) return fail('Masukkan kode verifikasi 2 langkah');
      let ok = verifyTotp(decrypt(u.totpSecret), code);
      if (!ok) {
        const h = sha256(normalizeBackupCode(code));
        const codes = u.totpBackupCodes ?? [];
        if (normalizeBackupCode(code).length === 8 && codes.includes(h)) {
          await this.db.update(users).set({ totpBackupCodes: codes.filter((x) => x !== h) }).where(eq(users.id, u.id));
          ok = true;
        }
      }
      if (!ok) return fail('Kode verifikasi salah');
    }
  }
}

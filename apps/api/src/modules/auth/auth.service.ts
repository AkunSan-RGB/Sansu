import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { taxFeatures } from '@sansu/shared';
import { AppsService } from '../../common/apps/apps.service';
import { AuthUser } from '../../common/auth/auth-user';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { authTokens, tenants, users } from '../../db/schema';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { verificationRequired } from '../../common/billing/subscription.guard';
import { isPlatformAdmin } from '../../common/auth/platform-admin';
import { appUrl, MailService } from '../../common/mail/mail.service';
import { decrypt, randomToken, sha256 } from '../../common/utils/secret';
import { normalizeBackupCode, verifyTotp } from '../../common/auth/totp';
import { TwoFactorPolicy } from '../../common/auth/two-factor-policy';
import { SettingsService } from '../../common/settings.service';
import { normalizeWarehouseIds } from '../../common/auth/warehouse-ids';
import {
  ChangePasswordDto,
  CreateUserDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { LoginLimiter } from './login-limiter';
import { TenantSetupService } from './tenant-setup.service';

type UserRow = typeof users.$inferSelect;
// hash bcrypt dari string acak — dipakai saat email tidak ditemukan
const DUMMY_HASH = '$2b$10$R6x6GPKmcHcT1F7DPULB.OSRl7Iwl/V4otbHClwea2xxA5IuBRnHO';

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly setup: TenantSetupService,
    private readonly apps: AppsService,
    private readonly limiter: LoginLimiter,
    private readonly mail: MailService,
    private readonly subs: SubscriptionService,
    private readonly twoFactor: TwoFactorPolicy,
    private readonly settings: SettingsService,
  ) {}

  /** Daftar perusahaan baru (self-service trial) + user OWNER. */
  async register(dto: RegisterDto) {
    if (process.env.ALLOW_SIGNUP === 'false')
      throw new ForbiddenException('Pendaftaran mandiri sedang ditutup. Hubungi tim SANSU.');
    const email = dto.email.toLowerCase();
    await this.assertEmailFree(email);
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.db.transaction(async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ name: dto.companyName }).returning();
      await this.setup.provision(tx, tenant.id, dto.businessModel ?? 'DAGANG');
      await this.subs.startTrial(tx, tenant.id);
      const [u] = await tx
        .insert(users)
        .values({ tenantId: tenant.id, email, name: dto.name, passwordHash, role: 'OWNER' })
        .returning();
      return u;
    });
    await this.sendVerification(user, dto.companyName);
    return this.issue(user);
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const wait = this.limiter.lockedMinutes(email);
    if (wait) {
      throw new HttpException(
        `Terlalu banyak percobaan gagal. Coba lagi dalam ${wait} menit.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    // tetap jalankan bcrypt walau email tidak ada, agar waktu respons tidak membocorkan email terdaftar
    const ok = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.isActive || !ok) {
      this.limiter.fail(email);
      throw new UnauthorizedException('Email atau kata sandi salah');
    }
    // Verifikasi 2 langkah: sandi benar → minta kode dari aplikasi authenticator
    if (user.totpEnabledAt) {
      const challenge = await this.jwt.signAsync(
        { k: '2fa', sub: user.id, tv: user.tokenVersion },
        { expiresIn: '5m' },
      );
      return { twoFactorRequired: true as const, challenge };
    }
    this.limiter.success(email);
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return this.issue(user);
  }

  /** Langkah kedua login: kode 6 digit atau kode cadangan */
  async loginTwoFactor(challenge: string, code: string) {
    let c: { k: string; sub: string; tv: number };
    try {
      c = await this.jwt.verifyAsync(challenge);
    } catch {
      throw new UnauthorizedException('Waktu verifikasi habis. Silakan masuk lagi.');
    }
    if (c.k !== '2fa') throw new UnauthorizedException('Permintaan tidak valid');
    const [user] = await this.db.select().from(users).where(eq(users.id, c.sub));
    if (!user || !user.isActive || user.tokenVersion !== c.tv || !user.totpEnabledAt || !user.totpSecret)
      throw new UnauthorizedException('Silakan masuk lagi.');
    const wait = this.limiter.lockedMinutes(user.email);
    if (wait)
      throw new HttpException(
        `Terlalu banyak percobaan gagal. Coba lagi dalam ${wait} menit.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const ok = await this.checkSecondFactor(user, code);
    if (!ok) {
      this.limiter.fail(user.email);
      throw new UnauthorizedException('Kode verifikasi salah');
    }
    this.limiter.success(user.email);
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return this.issue(user);
  }

  /** Cocokkan kode TOTP, atau pakai (dan hapus) satu kode cadangan */
  async checkSecondFactor(user: UserRow, code: string): Promise<boolean> {
    if (!user.totpSecret) return false;
    if (verifyTotp(decrypt(user.totpSecret), code)) return true;
    const h = sha256(normalizeBackupCode(code));
    const codes = user.totpBackupCodes ?? [];
    if (normalizeBackupCode(code).length === 8 && codes.includes(h)) {
      await this.db
        .update(users)
        .set({ totpBackupCodes: codes.filter((x) => x !== h) })
        .where(eq(users.id, user.id));
      return true;
    }
    return false;
  }

  /** Ganti sandi sendiri: semua sesi lain otomatis keluar, sesi ini mendapat token baru */
  async changePassword(u: AuthUser, dto: ChangePasswordDto) {
    const [user] = await this.db.select().from(users).where(eq(users.id, u.sub));
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Kata sandi lama salah');
    }
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException('Kata sandi baru harus berbeda');
    const [updated] = await this.db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(dto.newPassword, 10), tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, u.sub))
      .returning();
    return this.issue(updated);
  }

  /** Keluar dari semua perangkat (token lama tidak berlaku lagi) */
  async logoutAll(u: AuthUser) {
    await this.db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, u.sub));
    return { ok: true };
  }

  // ===== Lupa sandi & verifikasi email =====

  /** Buat token sekali pakai; token lama untuk keperluan yang sama dibatalkan */
  private async createToken(userId: string, purpose: 'RESET' | 'VERIFY', ttlMs: number) {
    const token = randomToken();
    await this.db.transaction(async (tx) => {
      await tx
        .update(authTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
      await tx
        .insert(authTokens)
        .values({ userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
    });
    return token;
  }

  /** Ambil & tandai token terpakai (atomik — token tidak bisa dipakai dua kali) */
  private async consumeToken(token: string, purpose: 'RESET' | 'VERIFY') {
    const [row] = await this.db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.tokenHash, sha256(token)),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!row) {
      throw new BadRequestException(
        purpose === 'RESET'
          ? 'Tautan atur ulang sandi tidak valid atau sudah kedaluwarsa. Minta tautan baru.'
          : 'Tautan verifikasi tidak valid atau sudah kedaluwarsa. Kirim ulang dari aplikasi.',
      );
    }
    return row;
  }

  /** Terlalu sering? (satu email per menit per pengguna & keperluan) */
  private async recentlySent(userId: string, purpose: 'RESET' | 'VERIFY') {
    const [r] = await this.db
      .select({ id: authTokens.id })
      .from(authTokens)
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          gt(authTokens.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    return !!r;
  }

  private async sendVerification(user: { id: string; email: string; name: string }, companyName?: string) {
    const token = await this.createToken(user.id, 'VERIFY', 3 * 86_400_000);
    await this.mail.send({
      to: user.email,
      subject: 'Verifikasi email akun SANSU Anda',
      heading: `Selamat datang di SANSU, ${user.name}`,
      paragraphs: [
        companyName
          ? `Akun ${companyName} sudah dibuat dan masa uji coba gratis Anda sudah dimulai.`
          : 'Akun SANSU Anda sudah dibuat.',
        'Klik tombol di bawah untuk memastikan email ini benar milik Anda.',
      ],
      action: { label: 'Verifikasi email', url: `${appUrl()}/verify-email?token=${token}` },
      footnote: 'Tautan berlaku 3 hari. Abaikan email ini jika Anda tidak merasa mendaftar.',
    });
  }

  /** Selalu menjawab sama, agar tidak bisa dipakai menebak email yang terdaftar */
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    if (user?.isActive && !(await this.recentlySent(user.id, 'RESET'))) {
      const token = await this.createToken(user.id, 'RESET', 60 * 60_000);
      await this.mail.send({
        to: user.email,
        subject: 'Atur ulang kata sandi SANSU',
        heading: 'Atur ulang kata sandi',
        paragraphs: [
          `Halo ${user.name},`,
          'Kami menerima permintaan untuk mengatur ulang kata sandi akun SANSU Anda. Klik tombol di bawah untuk membuat kata sandi baru.',
        ],
        action: { label: 'Buat kata sandi baru', url: `${appUrl()}/reset-password?token=${token}` },
        footnote:
          'Tautan berlaku 1 jam dan hanya bisa dipakai sekali. Jika Anda tidak memintanya, abaikan email ini — kata sandi Anda tidak berubah.',
      });
    }
    return {
      ok: true,
      message: 'Jika email terdaftar, tautan atur ulang sandi sudah dikirim. Cek kotak masuk & folder spam.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const t = await this.consumeToken(dto.token, 'RESET');
    const [user] = await this.db
      .update(users)
      .set({
        passwordHash: await bcrypt.hash(dto.password, 10),
        tokenVersion: sql`${users.tokenVersion} + 1`,
        // membuka tautan dari kotak masuk = email terbukti milik pengguna
        emailVerifiedAt: sql`COALESCE(${users.emailVerifiedAt}, now())`,
      })
      .where(and(eq(users.id, t.userId), eq(users.isActive, true)))
      .returning();
    if (!user) throw new BadRequestException('Akun tidak aktif. Hubungi admin perusahaan Anda.');
    this.limiter.success(user.email);
    await this.mail.send({
      to: user.email,
      subject: 'Kata sandi SANSU Anda sudah diganti',
      heading: 'Kata sandi sudah diganti',
      paragraphs: [
        `Halo ${user.name},`,
        'Kata sandi akun SANSU Anda baru saja diganti dan semua perangkat lain sudah dikeluarkan.',
        'Jika bukan Anda yang melakukannya, segera hubungi admin perusahaan Anda.',
      ],
    });
    return { ok: true };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const t = await this.consumeToken(dto.token, 'VERIFY');
    await this.db
      .update(users)
      .set({ emailVerifiedAt: sql`COALESCE(${users.emailVerifiedAt}, now())` })
      .where(eq(users.id, t.userId));
    return { ok: true };
  }

  async resendVerification(u: AuthUser) {
    const [user] = await this.db.select().from(users).where(eq(users.id, u.sub));
    if (!user) throw new UnauthorizedException();
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    if (await this.recentlySent(user.id, 'VERIFY'))
      throw new HttpException(
        'Tunggu sebentar sebelum mengirim ulang (maks. 1 email per menit).',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    await this.sendVerification(user);
    return { ok: true, sent: this.mail.configured };
  }

  async me(u: AuthUser) {
    const [row] = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        tenantId: tenants.id,
        tenantName: tenants.name,
        ppnRate: tenants.ppnRate,
        emailVerifiedAt: users.emailVerifiedAt,
        warehouseIds: users.warehouseIds,
        totpEnabledAt: users.totpEnabledAt,
      })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(users.id, u.sub));
    const { emailVerifiedAt, totpEnabledAt, ...rest } = row;
    return {
      ...rest,
      twoFactor: { enabled: !!totpEnabledAt, required: await this.twoFactor.requiredFor(u.tenantId, row.role) },
      apps: [...(await this.apps.enabled(u.tenantId))],
      businessModel: await this.settings.businessModel(this.db, u.tenantId),
      taxProfile: await this.settings.taxProfile(this.db, u.tenantId),
      taxFeatures: await this.taxFeatures(u.tenantId),
      emailVerified: !!emailVerifiedAt,
      verificationRequired: verificationRequired(this.mail),
      isPlatformAdmin: isPlatformAdmin(row.email),
      subscription: await this.subs.state(u.tenantId, true),
    };
  }

  /** Fitur pajak yang relevan: jenis usaha + status PKP + skema PPh (aturan di @sansu/shared taxFeatures) */
  private async taxFeatures(tenantId: string) {
    const [model, tax, reporting] = await Promise.all([
      this.settings.businessModel(this.db, tenantId),
      this.settings.taxProfile(this.db, tenantId),
      this.settings.reporting(this.db, tenantId),
    ]);
    const withheld = await this.db.execute<{ n: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM invoices WHERE tenant_id = ${tenantId} AND withholding_amount > 0) AS n`,
    );
    return taxFeatures({ model, pkp: tax.pkp, taxScheme: reporting.taxScheme, hasData: { withheldByCustomers: !!withheld.rows[0]?.n } });
  }

  listUsers(tenantId: string) {
    return this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        warehouseIds: users.warehouseIds,
        twoFactor: sql<boolean>`${users.totpEnabledAt} IS NOT NULL`,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .orderBy(asc(users.name));
  }

  async createUser(actor: AuthUser, dto: CreateUserDto) {
    const role = dto.role ?? 'SALES';
    if (role === 'OWNER' && actor.role !== 'OWNER')
      throw new BadRequestException('Hanya OWNER yang bisa membuat OWNER');
    const email = dto.email.toLowerCase();
    await this.assertEmailFree(email);
    await this.subs.assertCanAdd(actor.tenantId, 'users');
    const [user] = await this.db
      .insert(users)
      // dibuat & dijamin oleh admin perusahaan → dianggap terverifikasi
      .values({
        tenantId: actor.tenantId,
        email,
        name: dto.name,
        role,
        passwordHash: await bcrypt.hash(dto.password, 10),
        emailVerifiedAt: new Date(),
        warehouseIds: (await normalizeWarehouseIds(this.db, actor.tenantId, dto.warehouseIds)) ?? null,
      })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
    return user;
  }

  private async assertEmailFree(email: string) {
    const [exists] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists) throw new ConflictException('Email sudah terdaftar');
  }

  private async issue(user: UserRow) {
    const payload: AuthUser = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      tv: user.tokenVersion,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId },
    };
  }
}

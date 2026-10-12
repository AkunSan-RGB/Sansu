import { Injectable } from '@nestjs/common';

/**
 * Penahan tebak-sandi per akun (email): setelah MAX_FAILS gagal dalam WINDOW,
 * akun dikunci sementara selama LOCK. Disimpan di memori — cukup untuk satu server API.
 */
@Injectable()
export class LoginLimiter {
  static MAX_FAILS = 8;
  static WINDOW = 15 * 60_000;
  static LOCK = 15 * 60_000;
  private readonly state = new Map<string, { fails: number; first: number; lockedUntil?: number }>();

  /** Sisa menit penguncian, atau 0 bila boleh mencoba */
  lockedMinutes(key: string, now = Date.now()): number {
    const s = this.state.get(key);
    if (!s?.lockedUntil) return 0;
    if (s.lockedUntil <= now) {
      this.state.delete(key);
      return 0;
    }
    return Math.ceil((s.lockedUntil - now) / 60_000);
  }

  fail(key: string, now = Date.now()) {
    let s = this.state.get(key);
    if (!s || now - s.first > LoginLimiter.WINDOW) s = { fails: 0, first: now };
    s.fails += 1;
    if (s.fails >= LoginLimiter.MAX_FAILS) s.lockedUntil = now + LoginLimiter.LOCK;
    this.state.set(key, s);
    if (this.state.size > 50_000) this.prune(now);
  }

  success(key: string) {
    this.state.delete(key);
  }

  private prune(now: number) {
    for (const [k, s] of this.state) if ((s.lockedUntil ?? s.first + LoginLimiter.WINDOW) < now) this.state.delete(k);
  }
}

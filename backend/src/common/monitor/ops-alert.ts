import { Logger } from '@nestjs/common';
import { telegram } from './telegram-send';

const logger = new Logger('OpsAlert');
const lastSent = new Map<string, number>();
const suppressed = new Map<string, number>();
/** Jeda minimum antar peringatan dengan kunci yang sama (mencegah banjir pesan saat gangguan berulang) */
export const OPS_ALERT_GAP_MS = 15 * 60_000;

/**
 * Peringatan operasional di luar error 5xx per permintaan: proses hampir mati (unhandledRejection/uncaughtException), koneksi database
 * putus, server menolak permintaan karena kewalahan, tagih berlatar gagal. Dikirim lewat Telegram bila dikonfigurasi, selalu dicatat ke log.
 * Tidak pernah melempar dan tidak menunggu (aman dipanggil dari penangan galat proses). Mati saat NODE_ENV=test.
 */
export function opsAlert(key: string, text: string, now = Date.now()): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  const last = lastSent.get(key);
  if (last !== undefined && now - last < OPS_ALERT_GAP_MS) {
    suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
    return false;
  }
  lastSent.set(key, now);
  const extra = suppressed.get(key);
  suppressed.delete(key);
  const host = process.env.DOMAIN || 'server';
  const body = `🚨 SANSU (${host}): ${text}${extra ? `\n(+${extra} kejadian serupa sejak peringatan terakhir)` : ''}`;
  logger.error(body);
  void telegram(body).catch(() => undefined);
  return true;
}

/** Hanya untuk tes */
export function resetOpsAlertState() {
  lastSent.clear();
  suppressed.clear();
}

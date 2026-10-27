import cluster from 'node:cluster';
import { Logger } from '@nestjs/common';

/**
 * Menjalankan beberapa proses API di satu mesin (WEB_CONCURRENCY, bawaan 1). Satu proses Node memakai satu inti; uji beban menunjukkan
 * inti itulah penghambat. Aturan:
 *  - pekerja pertama dijalankan dulu (ia yang menjalankan migrasi), baru yang lain setelah ia siap menerima permintaan;
 *  - hanya pekerja pertama yang menjalankan tugas berkala (DISABLE_SCHEDULERS=true untuk lainnya);
 *  - pekerja yang mati dihidupkan lagi dengan jeda, dengan pembatas agar tidak berputar cepat bila galat berulang.
 */
const log = new Logger('Klaster');
const total = Math.max(1, Number(process.env.WEB_CONCURRENCY ?? 1));

if (cluster.isPrimary && total > 1) {
  let started = 1;
  const crashes: number[] = [];
  const spawn = (index: number) => cluster.fork({ ...process.env, DISABLE_SCHEDULERS: index === 0 ? process.env.DISABLE_SCHEDULERS ?? 'false' : 'true', WORKER_INDEX: String(index) });
  const indexOf = new Map<number, number>();
  const launch = (index: number) => {
    const w = spawn(index);
    indexOf.set(w.id, index);
    return w;
  };
  const first = launch(0);
  first.once('listening', () => {
    for (; started < total; started++) launch(started);
    log.log(`${total} proses API berjalan (tugas berkala hanya di proses pertama)`);
  });
  cluster.on('exit', (w, code, signal) => {
    const index = indexOf.get(w.id) ?? 0;
    indexOf.delete(w.id);
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 60_000) crashes.shift();
    if (crashes.length > 10) {
      log.error(`Proses API mati terlalu sering (${crashes.length}x/menit); klaster berhenti`);
      process.exit(1);
    }
    log.warn(`Proses ${index} berhenti (kode ${code ?? ''} ${signal ?? ''}); dihidupkan lagi`);
    setTimeout(() => launch(index), 1000);
  });
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      for (const w of Object.values(cluster.workers ?? {})) w?.process.kill(sig);
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
} else {
  void import('./main');
}

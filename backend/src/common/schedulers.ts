/**
 * Tugas berkala (pengingat, penyusutan, sinkronisasi, pembersihan) hanya boleh berjalan di SATU proses.
 * Pada penerapan banyak proses/kontainer, matikan di proses selain satu dengan DISABLE_SCHEDULERS=true;
 * kalau tidak, email pengingat dan sinkronisasi berjalan ganda.
 */
export const schedulersEnabled = (): boolean => process.env.DISABLE_SCHEDULERS !== 'true';

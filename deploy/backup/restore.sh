#!/bin/bash
# Pulihkan database SANSU dari file backup (.dump, atau .dump.enc terenkripsi).
# Dijalankan lewat ./sansu.sh restore <file> (API dihentikan dulu oleh skrip itu).
# Database lama TIDAK dihapus — diganti nama menjadi sansu_sebelum_<waktu> sebagai pengaman.
set -euo pipefail
f=${1:?pakai: restore.sh <file backup>}
[ -f "$f" ] || f="${BACKUP_ROOT:-/backups}/$f"
[ -f "$f" ] || { echo "File tidak ditemukan: $1"; exit 1; }
DB=${PGDATABASE:-sansu}
TMP=sansu_memulihkan
ts=$(date +%Y%m%d_%H%M%S)

if [[ "$f" == *.enc ]]; then
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE wajib untuk file terenkripsi}"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$f" -out ${TMPDIR:-/tmp}/restore.dump 2>/dev/null \
    || { echo "Kata sandi backup (BACKUP_PASSPHRASE) salah atau file rusak — pemulihan dibatalkan, data tidak diubah."; exit 1; }
  f=${TMPDIR:-/tmp}/restore.dump
fi
pg_restore --list "$f" >/dev/null || { echo "File backup tidak valid"; exit 1; }

echo "1/4 Backup pengaman kondisi sekarang…"
"$(dirname "$0")/backup.sh" once sebelum-pulih || { echo "Backup pengaman gagal — pemulihan dibatalkan"; exit 1; }

echo "2/4 Memuat backup ke database sementara…"
psql -d postgres -qc "DROP DATABASE IF EXISTS $TMP" -c "CREATE DATABASE $TMP OWNER ${PGUSER}"
pg_restore -d "$TMP" --no-owner --role="${PGUSER}" --exit-on-error "$f"

echo "3/4 Menukar database…"
psql -d postgres -v ON_ERROR_STOP=1 -q <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$DB', '$TMP') AND pid <> pg_backend_pid();
ALTER DATABASE "$DB" RENAME TO "sansu_sebelum_$ts";
ALTER DATABASE "$TMP" RENAME TO "$DB";
SQL

echo "4/4 Membersihkan salinan lama (disimpan 3 terakhir)…"
for old in $(psql -d postgres -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'sansu_sebelum_%' ORDER BY datname DESC OFFSET 3"); do
  psql -d postgres -qc "DROP DATABASE \"$old\""
done
rm -f ${TMPDIR:-/tmp}/restore.dump
echo "Pemulihan selesai. Database sebelumnya disimpan sebagai sansu_sebelum_$ts."

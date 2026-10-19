#!/bin/bash
# Backup & uji pemulihan untuk database di LUAR server SANSU (mis. Neon pada jalur Railway). Dijalankan terjadwal oleh
# GitHub Actions (.github/workflows/backup-database.yml) atau cron di komputer/server mana pun yang punya pg_dump versi 18.
#
#   external-backup.sh dump           → pg_dump → verifikasi → enkripsi AES-256 → salinan di luar penyedia → lapor ke SANSU
#   external-backup.sh restore-test   → ambil backup terbaru, dekripsi, pulihkan ke database sementara, periksa isinya → lapor ke SANSU
#
# Variabel (semua lewat environment, tidak pernah lewat argumen agar tidak tampil di daftar proses):
#   DATABASE_URL            sumber (WAJIB untuk dump). Pakai koneksi LANGSUNG dan peran PEMILIK (bukan pooler): RLS membuat peran biasa gagal/kosong.
#   BACKUP_PASSPHRASE       kata sandi enkripsi (WAJIB). Sama dengan layanan backup VPS; simpan salinannya terpisah, tanpa ini backup tidak terbuka.
#   RCLONE_REMOTE           tujuan rclone, mis. offsite:bucket/sansu (+ RCLONE_CONFIG_OFFSITE_* untuk S3)   ─┐ salah satu wajib
#   OFFSITE_DIR             folder lokal/terpasang sebagai tujuan (uji coba atau penyimpanan yang di-mount) ─┘
#   OFFSITE_KEEP_DAYS       lama simpan salinan harian (default 90); salinan bulanan (tanggal 1) tidak dihapus otomatis
#   RESTORE_TARGET_URL      database sementara untuk restore-test (WAJIB untuk restore-test; isinya akan DIHAPUS dan diganti)
#   BACKUP_REPORT_URL       alamat laporan, mis. https://app.example.com/api/backup-report   (opsional tetapi sangat disarankan)
#   BACKUP_REPORT_TOKEN     token laporan (sama dengan BACKUP_REPORT_TOKEN di server SANSU)
#   SOURCE_LABEL            label sumber pada laporan (default: github-actions)
set -uo pipefail
MODE=${1:-}
SOURCE_LABEL=${SOURCE_LABEL:-github-actions}
KEEP_DAYS=${OFFSITE_KEEP_DAYS:-90}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
START=$(date +%s)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

json_escape() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()[:480]))'; }

# report <kind> <OK|FAILED> [json tambahan tanpa kurung kurawal, mis. "sizeBytes":1]
report() {
  local kind=$1 status=$2 extra=${3:-} note=${4:-}
  [ -n "${BACKUP_REPORT_URL:-}" ] && [ -n "${BACKUP_REPORT_TOKEN:-}" ] || { log "Laporan ke SANSU dilewati (BACKUP_REPORT_URL/TOKEN belum diisi)"; return 0; }
  local body="{\"kind\":\"$kind\",\"status\":\"$status\",\"source\":\"$SOURCE_LABEL\",\"durationSec\":$(( $(date +%s) - START ))"
  [ -n "$extra" ] && body="$body,$extra"
  [ -n "$note" ] && body="$body,\"note\":$(printf '%s' "$note" | json_escape)"
  body="$body}"
  local i
  for i in 1 2 3; do
    # token lewat file konfigurasi curl (bukan argumen) agar tidak tampil di daftar proses
    if printf 'header = "x-backup-token: %s"\n' "$BACKUP_REPORT_TOKEN" | curl -fsS -m 30 -K - -H 'content-type: application/json' -d "$body" "$BACKUP_REPORT_URL" >/dev/null; then
      log "Laporan terkirim ke SANSU ($kind $status)"; return 0
    fi
    sleep $((i * 5))
  done
  log "PERINGATAN: laporan ke SANSU gagal dikirim"; return 1
}

fail() { # fail <kind> <pesan>
  log "GAGAL: $2"
  report "$1" FAILED "" "$2" || true
  exit 1
}

need() { command -v "$1" >/dev/null 2>&1 || fail "${2:-DUMP}" "perintah '$1' tidak tersedia di pelaksana backup"; }

encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$1" -out "$2"; }
decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$1" -out "$2" 2>/dev/null; }

# ---- tujuan salinan (rclone atau folder) ----
put() { # put <file> <subfolder>
  if [ -n "${RCLONE_REMOTE:-}" ]; then
    rclone copyto "$1" "$RCLONE_REMOTE/$2/$(basename "$1")" --retries 5 || return 1
    # verifikasi: berkas di tujuan harus ada dan ukurannya sama
    local want got; want=$(stat -c %s "$1"); got=$(rclone lsf --format s "$RCLONE_REMOTE/$2/$(basename "$1")" 2>/dev/null | head -1)
    [ "$want" = "$got" ] || return 1
  else
    mkdir -p "$OFFSITE_DIR/$2" && cp "$1" "$OFFSITE_DIR/$2/" || return 1
    [ "$(stat -c %s "$1")" = "$(stat -c %s "$OFFSITE_DIR/$2/$(basename "$1")")" ] || return 1
  fi
}
prune_daily() {
  if [ -n "${RCLONE_REMOTE:-}" ]; then rclone delete "$RCLONE_REMOTE/daily/" --min-age "${KEEP_DAYS}d" 2>/dev/null || true
  else find "$OFFSITE_DIR/daily" -name 'sansu-*.dump.enc' -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true; fi
}
latest_daily() { # nama berkas harian terbaru di tujuan
  if [ -n "${RCLONE_REMOTE:-}" ]; then rclone lsf "$RCLONE_REMOTE/daily/" 2>/dev/null | grep -E '^sansu-.*\.dump\.enc$' | sort | tail -1
  else ls -1 "$OFFSITE_DIR/daily" 2>/dev/null | grep -E '^sansu-.*\.dump\.enc$' | sort | tail -1; fi
}
fetch() { # fetch <nama> <tujuan>
  if [ -n "${RCLONE_REMOTE:-}" ]; then rclone copyto "$RCLONE_REMOTE/daily/$1" "$2" --retries 5; else cp "$OFFSITE_DIR/daily/$1" "$2"; fi
}

check_common() {
  local kind=$1
  [ -n "${BACKUP_PASSPHRASE:-}" ] || fail "$kind" "BACKUP_PASSPHRASE belum diisi"
  [ ${#BACKUP_PASSPHRASE} -ge 16 ] || fail "$kind" "BACKUP_PASSPHRASE terlalu pendek (minimal 16 karakter)"
  [ -n "${RCLONE_REMOTE:-}" ] || [ -n "${OFFSITE_DIR:-}" ] || fail "$kind" "tujuan salinan belum diisi (RCLONE_REMOTE atau OFFSITE_DIR)"
  need openssl "$kind"; need pg_restore "$kind"
  [ -z "${RCLONE_REMOTE:-}" ] || need rclone "$kind"
}

do_dump() {
  [ -n "${DATABASE_URL:-}" ] || fail DUMP "DATABASE_URL belum diisi"
  check_common DUMP
  need pg_dump DUMP
  local ts name plain enc size sha
  ts=$(date -u +%Y%m%d-%H%M%S); name="sansu-$ts.dump"; plain="$WORK/$name"; enc="$plain.enc"
  log "pg_dump → $name"
  pg_dump -Fc -Z 6 --dbname="$DATABASE_URL" -f "$plain" 2>"$WORK/err" || fail DUMP "pg_dump gagal: $(tr '\n' ' ' < "$WORK/err" | cut -c1-300)"
  pg_restore --list "$plain" >/dev/null 2>&1 || fail DUMP "file dump rusak saat diverifikasi (pg_restore --list)"
  size=$(stat -c %s "$plain"); [ "$size" -gt 10000 ] || fail DUMP "ukuran dump mencurigakan ($size byte)"
  # dump yang sah memuat tabel inti; dump kosong (mis. karena RLS dengan peran biasa) tidak boleh dianggap sukses
  pg_restore --list "$plain" | grep -q "TABLE DATA public tenants" || fail DUMP "dump tidak memuat data tabel tenants (peran database bukan pemilik/RLS?)"
  sha=$(sha256sum "$plain" | cut -d' ' -f1)
  encrypt "$plain" "$enc" || fail DUMP "enkripsi gagal"
  put "$enc" daily || fail DUMP "salinan di luar penyedia gagal atau ukurannya tidak cocok"
  [ "$(date -u +%d)" = 01 ] && { put "$enc" monthly || log "PERINGATAN: salinan bulanan gagal"; }
  prune_daily
  log "Selesai: $(du -h "$enc" | cut -f1) terenkripsi, tersimpan di luar penyedia"
  report DUMP OK "\"sizeBytes\":$size,\"sha256\":\"$sha\",\"offsite\":true,\"encrypted\":true"
}

do_restore_test() {
  [ -n "${RESTORE_TARGET_URL:-}" ] || fail RESTORE_TEST "RESTORE_TARGET_URL belum diisi"
  check_common RESTORE_TEST
  need psql RESTORE_TEST
  local f enc plain
  f=$(latest_daily); [ -n "$f" ] || fail RESTORE_TEST "tidak ada backup di tujuan salinan"
  enc="$WORK/$f"; plain="$WORK/restore.dump"
  fetch "$f" "$enc" || fail RESTORE_TEST "gagal mengambil $f"
  decrypt "$enc" "$plain" || fail RESTORE_TEST "dekripsi gagal: BACKUP_PASSPHRASE salah atau file rusak ($f)"
  pg_restore --list "$plain" >/dev/null 2>&1 || fail RESTORE_TEST "hasil dekripsi bukan dump yang valid ($f)"
  log "Memulihkan $f ke database sementara"
  psql "$RESTORE_TARGET_URL" -v ON_ERROR_STOP=1 -qAt -c "DROP SCHEMA IF EXISTS public CASCADE" -c "CREATE SCHEMA public" -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sansu_app') THEN CREATE ROLE sansu_app NOLOGIN; END IF; END \$\$" >/dev/null 2>"$WORK/err" \
    || fail RESTORE_TEST "database sementara tidak bisa disiapkan: $(tr '\n' ' ' < "$WORK/err" | cut -c1-200)"
  pg_restore --no-owner --dbname="$RESTORE_TARGET_URL" "$plain" >"$WORK/out" 2>"$WORK/err"
  # kesalahan yang diabaikan hanya yang wajar (peran bawaan penyedia tidak ada di database sementara); selain itu = gagal
  local bad; bad=$(grep -E '^pg_restore: error' "$WORK/err" | grep -vE 'role ".*" does not exist|extension "(plpgsql|pg_stat_statements|pgcrypto|uuid-ossp)"' | head -3 | tr '\n' ' ')
  [ -z "$bad" ] || fail RESTORE_TEST "pemulihan menghasilkan kesalahan: $(printf '%s' "$bad" | cut -c1-300)"
  local tables tenants users
  tables=$(psql "$RESTORE_TARGET_URL" -qAt -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
  tenants=$(psql "$RESTORE_TARGET_URL" -qAt -c "SELECT count(*) FROM tenants") || fail RESTORE_TEST "tabel tenants tidak terbaca setelah pemulihan"
  users=$(psql "$RESTORE_TARGET_URL" -qAt -c "SELECT count(*) FROM users") || fail RESTORE_TEST "tabel users tidak terbaca setelah pemulihan"
  [ "${tables:-0}" -ge 50 ] || fail RESTORE_TEST "hasil pemulihan hanya memuat $tables tabel"
  # bila sumber diberikan: jumlah tabel hasil pemulihan tidak boleh kurang dari sumber (selisih karena migrasi sesudah backup dimaafkan satu arah)
  if [ -n "${DATABASE_URL:-}" ]; then
    local src; src=$(psql "$DATABASE_URL" -qAt -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" 2>/dev/null || echo "")
    [ -z "$src" ] || [ "$tables" -ge $((src - 5)) ] || fail RESTORE_TEST "tabel hasil pemulihan ($tables) jauh lebih sedikit daripada sumber ($src)"
  fi
  psql "$RESTORE_TARGET_URL" -qAt -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public" >/dev/null 2>&1 || true
  log "Uji pemulihan sukses: $tables tabel, $tenants perusahaan, $users pengguna ($f)"
  report RESTORE_TEST OK "\"detail\":{\"tables\":$tables,\"tenants\":$tenants,\"users\":$users}" "memulihkan $f"
}

case "$MODE" in
  dump) do_dump ;;
  restore-test) do_restore_test ;;
  *) echo "pakai: external-backup.sh dump | restore-test"; exit 2 ;;
esac

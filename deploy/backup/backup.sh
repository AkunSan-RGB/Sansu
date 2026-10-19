#!/bin/bash
# Backup database SANSU.
#   backup.sh loop   → jalan terus, backup setiap hari pada BACKUP_TIME (default 01:30 WIB)
#   backup.sh once   → backup sekali sekarang
#   backup.sh list   → daftar file backup
# Retensi: harian (BACKUP_KEEP_DAILY, default 14), mingguan/Minggu (BACKUP_KEEP_WEEKLY, 8), bulanan/tgl 1 (BACKUP_KEEP_MONTHLY, 12).
# Offsite (opsional): RCLONE_REMOTE="nama-remote:bucket/folder" + variabel RCLONE_CONFIG_* ; bila BACKUP_PASSPHRASE diisi, file dienkripsi AES-256 sebelum dikirim.
# Notifikasi gagal (opsional): TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
set -uo pipefail
DIR=${BACKUP_ROOT:-/backups}
BACKUP_TIME=${BACKUP_TIME:-01:30}
KEEP_D=${BACKUP_KEEP_DAILY:-14}
KEEP_W=${BACKUP_KEEP_WEEKLY:-8}
KEEP_M=${BACKUP_KEEP_MONTHLY:-12}
mkdir -p "$DIR/daily" "$DIR/weekly" "$DIR/monthly"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

notify() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 0
  curl -fsS -m 20 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1" >/dev/null || true
}

# Lapor ke SANSU (Panel SANSU › Keamanan data › Backup database). Aktif bila BACKUP_REPORT_TOKEN diisi; gagal melapor tidak menggagalkan backup.
report() { # report <OK|FAILED> [ukuran_byte] [offsite true|false] [encrypted true|false] [catatan]
  [ -n "${BACKUP_REPORT_TOKEN:-}" ] || return 0
  local note; note=$(printf '%s' "${5:-}" | tr -d '"\\' | tr '\n' ' ' | cut -c1-300)
  local body="{\"kind\":\"DUMP\",\"status\":\"$1\",\"source\":\"vps:$(hostname)\""
  [ -n "${2:-}" ] && body="$body,\"sizeBytes\":$2"
  [ -n "${3:-}" ] && body="$body,\"offsite\":$3"
  [ -n "${4:-}" ] && body="$body,\"encrypted\":$4"
  [ -n "$note" ] && body="$body,\"note\":\"$note\""
  printf 'header = "x-backup-token: %s"\n' "$BACKUP_REPORT_TOKEN" \
    | curl -fsS -m 20 -K - -H 'content-type: application/json' -d "$body}" "${BACKUP_REPORT_URL:-http://api:3000/api/backup-report}" >/dev/null || log "PERINGATAN: laporan ke SANSU gagal"
}

prune() { # prune <folder> <jumlah disimpan>
  ls -1t "$DIR/$1"/sansu-*.dump 2>/dev/null | tail -n +$(($2 + 1)) | xargs -r rm -f
}

offsite() {
  [ -n "${RCLONE_REMOTE:-}" ] || return 0
  local f=$1 up=$1
  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    up="/tmp/$(basename "$f").enc"
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$f" -out "$up" || return 1
  fi
  rclone copy "$up" "$RCLONE_REMOTE/daily/" --retries 5 || { [ "$up" != "$f" ] && rm -f "$up"; return 1; }
  [ "$(date +%d)" = 01 ] && rclone copy "$up" "$RCLONE_REMOTE/monthly/" --retries 5
  [ "$up" != "$f" ] && rm -f "$up"
  # salinan harian offsite disimpan 90 hari, bulanan tidak dihapus otomatis
  rclone delete "$RCLONE_REMOTE/daily/" --min-age "${OFFSITE_KEEP_DAYS:-90}d" 2>/dev/null || true
  return 0
}

run_backup() {
  local label=${1:-} ts f
  ts=$(date +%Y%m%d-%H%M%S)
  f="$DIR/daily/sansu-${ts}${label:+-$label}.dump"
  log "Mulai backup → $f"
  if ! pg_dump -Fc -Z 6 -f "$f.tmp"; then
    rm -f "$f.tmp"; log "GAGAL: pg_dump"; date -Iseconds > "$DIR/last-failure"
    notify "⚠️ Backup SANSU GAGAL ($(hostname)) pada $(date '+%d/%m/%Y %H:%M'). Periksa: ./sansu.sh logs backup"
    report FAILED "" "" "" "pg_dump gagal"
    return 1
  fi
  # verifikasi: file harus bisa dibaca pg_restore
  if ! pg_restore --list "$f.tmp" >/dev/null; then
    rm -f "$f.tmp"; log "GAGAL: file backup rusak"; date -Iseconds > "$DIR/last-failure"
    notify "⚠️ Backup SANSU rusak saat diverifikasi ($(hostname))."
    report FAILED "" "" "" "file backup rusak saat diverifikasi"
    return 1
  fi
  mv "$f.tmp" "$f"
  [ "$(date +%u)" = 7 ] && cp "$f" "$DIR/weekly/"
  [ "$(date +%d)" = 01 ] && cp "$f" "$DIR/monthly/"
  prune daily "$KEEP_D"; prune weekly "$KEEP_W"; prune monthly "$KEEP_M"
  local off=false enc=false
  if [ -n "${RCLONE_REMOTE:-}" ]; then
    if offsite "$f"; then off=true; [ -n "${BACKUP_PASSPHRASE:-}" ] && enc=true
    else
      log "PERINGATAN: salinan offsite gagal"
      notify "⚠️ Backup SANSU tersimpan di server, tetapi salinan offsite GAGAL ($(hostname))."
    fi
  fi
  date -Iseconds > "$DIR/last-success"
  rm -f "$DIR/last-failure"
  log "Selesai: $(du -h "$f" | cut -f1)"
  report OK "$(stat -c %s "$f")" "$off" "$enc" ""
  return 0
}

# ---------- Pemantau: aplikasi mati / pulih & disk hampir penuh (pesan Telegram) ----------
watchdog() {
  local url="${HEALTH_URL:-http://api:3000/api/health}" web="${WEB_URL:-http://web/}"
  local fails=0 down_since="" last_disk=""
  sleep 120
  while true; do
    if curl -fsS -m 10 "$url" >/dev/null 2>&1 && curl -fsS -m 10 -o /dev/null "$web" 2>/dev/null; then
      if [ -n "$down_since" ]; then
        notify "✅ SANSU kembali normal ($(hostname)). Sempat tidak bisa diakses sejak $down_since."
        down_since=""
      fi
      fails=0
    else
      fails=$((fails + 1))
      if [ "$fails" -eq 3 ] && [ -z "$down_since" ]; then
        down_since="$(date '+%d/%m/%Y %H:%M')"
        notify "🔴 SANSU TIDAK BISA DIAKSES ($(hostname)) sejak $down_since. Periksa: ./sansu.sh status dan ./sansu.sh logs api"
      fi
    fi
    # disk
    local pct; pct=$(df -P "$DIR" | awk 'NR==2 {gsub("%","",$5); print $5}')
    if [ "${pct:-0}" -ge "${DISK_ALERT_PCT:-85}" ] && [ "$last_disk" != "$(date +%F)" ]; then
      notify "⚠️ Disk server SANSU terpakai ${pct}% ($(hostname)). Hapus file lama atau tambah kapasitas sebelum penuh."
      last_disk="$(date +%F)"
    fi
    sleep 60
  done
}

case "${1:-loop}" in
  once) run_backup "${2:-manual}" ;;
  list)
    for d in daily weekly monthly; do echo "== $d"; ls -1t "$DIR/$d" 2>/dev/null | head -50; done
    echo "Terakhir sukses: $(cat "$DIR/last-success" 2>/dev/null || echo belum ada)"
    ;;
  loop)
    log "Layanan backup aktif. Jadwal harian pukul $BACKUP_TIME (${TZ:-$(cat /etc/timezone 2>/dev/null || echo UTC)})."
    watchdog &
    until pg_isready -q; do sleep 3; done
    # backup awal bila belum ada backup dalam 24 jam terakhir
    if ! find "$DIR/last-success" -mmin -1440 2>/dev/null | grep -q .; then run_backup; fi
    while true; do
      now=$(date +%s)
      next=$(date -d "today $BACKUP_TIME" +%s)
      [ "$next" -le "$now" ] && next=$(date -d "tomorrow $BACKUP_TIME" +%s)
      sleep $((next - now))
      run_backup || true
    done
    ;;
  *) echo "pakai: backup.sh loop|once|list"; exit 2 ;;
esac

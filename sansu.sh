#!/bin/bash
# Alat kelola server SANSU. Jalankan dari folder sansu di server.
#   ./sansu.sh status            kondisi semua layanan + backup terakhir
#   ./sansu.sh logs [layanan]    log (api, web, db, caddy, backup)
#   ./sansu.sh backup            backup sekarang
#   ./sansu.sh backups           daftar file backup
#   ./sansu.sh restore <file>    pulihkan dari backup (aplikasi berhenti ±1–5 menit)
#   ./sansu.sh update            ambil versi terbaru, backup dulu, lalu jalankan ulang
#   ./sansu.sh restart | stop | start
set -euo pipefail
cd "$(dirname "$0")"
DC="docker compose -f docker-compose.prod.yml"
[ -f .env ] || { echo "File .env belum ada. Jalankan dulu: bash deploy/install.sh"; exit 1; }
DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2-)

wait_healthy() {
  echo -n "Menunggu aplikasi siap"
  for _ in $(seq 1 90); do
    if $DC exec -T api wget -qO- http://localhost:3000/api/health >/dev/null 2>&1; then echo " ✓"; return 0; fi
    echo -n "."; sleep 2
  done
  echo; echo "Aplikasi belum siap. Periksa: ./sansu.sh logs api"; return 1
}

case "${1:-status}" in
  status)
    $DC ps --format 'table {{.Service}}\t{{.Status}}'
    echo
    echo "Versi aplikasi : $($DC exec -T api wget -qO- http://localhost:3000/api/health 2>/dev/null | sed -n 's/.*"build":"\([^"]*\)".*/\1/p' || echo '-')"
    echo "Alamat         : https://$DOMAIN"
    echo "Backup sukses  : $($DC exec -T backup cat /backups/last-success 2>/dev/null || echo 'belum ada')"
    if $DC exec -T backup test -f /backups/last-failure 2>/dev/null; then echo "Backup gagal   : $($DC exec -T backup cat /backups/last-failure)"; fi
    echo "Ruang disk     : $(df -h . | awk 'NR==2{print $4" tersisa dari "$2}')"
    ;;
  logs) $DC logs --tail=200 -f ${2:-} ;;
  backup) $DC exec -T backup backup.sh once manual ;;
  backups) $DC exec -T backup backup.sh list ;;
  restore)
    f=${2:?pakai: ./sansu.sh restore <nama file dari ./sansu.sh backups>}
    BDIR=$(grep -E '^BACKUP_DIR=' .env | cut -d= -f2-); BDIR=${BDIR:-./backups}
    if [ ! -f "$BDIR/$f" ]; then for d in daily weekly monthly; do [ -f "$BDIR/$d/$f" ] && f="$d/$f" && break; done; fi
    [ -f "$BDIR/$f" ] || { echo "File tidak ditemukan di $BDIR: $f"; exit 1; }
    read -r -p "Pulihkan dari $f? Semua data setelah waktu backup itu akan hilang (kondisi sekarang tetap dibackup dulu). Ketik YA: " ok
    [ "$ok" = "YA" ] || { echo "Dibatalkan."; exit 1; }
    $DC stop api
    if $DC exec -T backup restore.sh "$f"; then echo "Data dipulihkan."; else echo "Pemulihan GAGAL — data lama tidak diubah."; fi
    $DC start api
    wait_healthy
    ;;
  update)
    echo "1/4 Backup sebelum update…"; $DC exec -T backup backup.sh once sebelum-update
    echo "2/4 Mengambil versi terbaru…"; if [ -d .git ]; then git pull --ff-only; else echo "(bukan repo git — pastikan file sudah disalin)"; fi
    echo "3/4 Membangun ulang…"; $DC build --pull
    echo "4/4 Menjalankan versi baru…"; $DC up -d --remove-orphans
    wait_healthy
    docker image prune -f >/dev/null
    ;;
  restart) $DC restart; wait_healthy ;;
  stop) $DC stop ;;
  start) $DC up -d; wait_healthy ;;
  demo)
    echo "Membuat perusahaan demo (admin@demo.id / demo12345). Siapa pun yang tahu sandi ini bisa masuk ke akun demo."
    $DC exec -T api node dist/db/seed.js
    ;;
  *) sed -n '2,10p' "$0" ;;
esac

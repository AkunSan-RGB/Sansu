#!/bin/bash
# Menjalankan backup/uji pemulihan database di LUAR server SANSU memakai Docker (tanpa GitHub Actions).
#   ./run-external.sh dump                 → backup sekarang
#   ./run-external.sh restore-test         → uji pemulihan (membuat database sementara lewat Docker, lalu dihapus)
# Butuh: Docker, dan berkas backup.env (salin dari backup.env.example). Jadwalkan dengan cron; lihat docs/OPERASIONAL.md.
set -euo pipefail
cd "$(dirname "$0")"
MODE=${1:-dump}
ENVF=${2:-backup.env}
[ -f "$ENVF" ] || { echo "Berkas $ENVF tidak ada. Salin backup.env.example menjadi backup.env lalu isi."; exit 1; }
case "$MODE" in dump | restore-test) ;; *) echo "pakai: run-external.sh dump | restore-test"; exit 2 ;; esac

docker build -q -t sansu-backup:latest . >/dev/null

if [ "$MODE" = dump ]; then
  exec docker run --rm --env-file "$ENVF" --entrypoint external-backup.sh sansu-backup:latest dump
fi

NET=sansu-backup-net
DB=sansu-backup-scratch
cleanup() { docker rm -f "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=scratch postgres:18.6 >/dev/null
for _ in $(seq 1 30); do docker exec "$DB" pg_isready -U postgres -d scratch >/dev/null 2>&1 && break; sleep 2; done
docker exec "$DB" pg_isready -U postgres -d scratch >/dev/null
docker run --rm --network "$NET" --env-file "$ENVF" -e RESTORE_TARGET_URL="postgresql://postgres:scratch@$DB:5432/scratch" \
  --entrypoint external-backup.sh sansu-backup:latest restore-test

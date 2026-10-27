#!/bin/sh
# Uji migrasi pada SALINAN data (bukan database asli): salin database, jalankan migrasi yang belum terpasang, bandingkan jumlah baris
# semua tabel sebelum dan sesudah, dan pastikan pengaman antar perusahaan (RLS) masih terpasang. Aman dijalankan sebelum setiap rilis.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/sansu sh scripts/uji-migrasi.sh
#
# Butuh pg_dump (versinya harus sama atau lebih baru dari server; atur PG_DUMP=/path/pg_dump bila perlu), psql, dan hak membuat database. Salinan dihapus di akhir (kecuali KEEP=1).
set -eu
SRC="${DATABASE_URL:?DATABASE_URL belum diatur}"
BASE="${SRC%/*}"
COPY="sansu_uji_migrasi_$$"
COPY_URL="$BASE/$COPY"
ADMIN="$BASE/postgres"
cleanup() { [ "${KEEP:-0}" = "1" ] || psql "$ADMIN" -qc "DROP DATABASE IF EXISTS \"$COPY\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "1/5 Menyalin database ke $COPY ..."
T0=$(date +%s)
SRCNAME="${SRC##*/}"; SRCNAME="${SRCNAME%%\?*}"
# Cara cepat dan tak bergantung versi klien: salin lewat TEMPLATE (butuh tak ada sesi lain di database asal). Bila gagal, pakai pg_dump.
if psql "$ADMIN" -qc "CREATE DATABASE \"$COPY\" TEMPLATE \"$SRCNAME\"" >/dev/null 2>&1; then
  echo "    disalin lewat TEMPLATE"
else
  psql "$ADMIN" -qc "CREATE DATABASE \"$COPY\""
  ${PG_DUMP:-pg_dump} --no-owner --no-privileges -f "/tmp/$COPY.sql" "$SRC"
  psql "$COPY_URL" -q -v ON_ERROR_STOP=1 -f "/tmp/$COPY.sql" >/dev/null
  rm -f "/tmp/$COPY.sql"
  echo "    disalin lewat pg_dump"
fi
echo "    selesai dalam $(( $(date +%s) - T0 )) dtk"

count_sql="SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM %I.%I', table_name, table_schema, table_name), ' UNION ALL ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT LIKE '\\_\\_%'"
counts() { psql "$1" -Atc "SET app.bypass_rls='on'; $(psql "$1" -Atc "$count_sql") ORDER BY 1" 2>/dev/null | grep '|' | sort; }

echo "2/5 Jumlah baris sebelum migrasi ..."
counts "$COPY_URL" > "/tmp/$COPY.before"
TABLES=$(wc -l < "/tmp/$COPY.before")
[ "$TABLES" -gt 0 ] || { echo "GAGAL: salinan kosong (penyalinan tidak berhasil; cek versi pg_dump: PG_DUMP=/path/pg_dump)"; exit 1; }
echo "    $TABLES tabel, $(awk -F'|' '{s+=$2} END{print s}' /tmp/$COPY.before) baris"

echo "3/5 Menjalankan migrasi pada salinan ..."
T1=$(date +%s)
DATABASE_URL="$COPY_URL" node dist/db/migrate.js
echo "    migrasi selesai dalam $(( $(date +%s) - T1 )) dtk"

echo "4/5 Jumlah baris sesudah migrasi ..."
counts "$COPY_URL" > "/tmp/$COPY.after"
LOST=$(join -t'|' /tmp/$COPY.before /tmp/$COPY.after | awk -F'|' '$3 < $2 {print $1" sebelum="$2" sesudah="$3}')
if [ -n "$LOST" ]; then echo "GAGAL: jumlah baris berkurang setelah migrasi:"; echo "$LOST"; exit 1; fi
echo "    tidak ada tabel yang kehilangan baris"

echo "5/5 Pengaman antar perusahaan (RLS) ..."
NO_RLS=$(psql "$COPY_URL" -Atc "SELECT string_agg(c.relname, ', ') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_name=c.relname AND k.column_name='tenant_id' AND k.table_schema='public') AND NOT c.relrowsecurity")
if [ -n "$NO_RLS" ]; then echo "GAGAL: tabel ber-tenant_id tanpa RLS: $NO_RLS"; exit 1; fi
echo "    semua tabel ber-tenant_id memakai RLS"
echo "LULUS: migrasi aman pada salinan data."

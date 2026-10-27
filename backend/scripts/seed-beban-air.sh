#!/bin/sh
# Menyiapkan satu perusahaan air dengan N sambungan (default 10.000) dan bacaan meter 3 bulan terakhir, untuk uji beban.
# Pakai: sh scripts/seed-beban-air.sh [N] ; hasil: $OUT/token dan $OUT/tenant (default /tmp/load). Server harus berjalan.
set -e
OUT=${OUT:-/tmp/load}; mkdir -p "$OUT"
API=${API:-http://localhost:3000/api}
N=${1:-10000}
STAMP=$(date +%s)
DB=${DATABASE_URL:-postgresql://akurata:akurata@localhost:5432/akurata_test}
TOK=$(curl -s -X POST $API/auth/register -H 'content-type: application/json' -d "{\"companyName\":\"PAM Beban $STAMP\",\"name\":\"Pemilik\",\"email\":\"beban-$STAMP@uji.id\",\"password\":\"rahasia123\",\"businessModel\":\"UTILITAS\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
echo $TOK > "$OUT/token"
TARIFF=$(curl -s -X POST $API/utility/tariffs -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"name":"Air RT","serviceType":"AIR","fixedFee":10000,"adminFee":2500,"blocks":[{"upTo":10,"price":3000},{"upTo":null,"price":4500}]}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
ROW=$(psql "$DB" -At -F'|' -c "select tenant_id, id from users where email='beban-$STAMP@uji.id'")
TENANT=${ROW%%|*}; USER=${ROW##*|}
echo tenant=$TENANT
psql "$DB" -v ON_ERROR_STOP=1 <<SQL
set app.bypass_rls='on';
insert into customers (tenant_id, code, name, phone, address, payment_term_days)
select '$TENANT', 'P'||lpad(g::text,6,'0'), 'Pelanggan '||g, '0812'||lpad(g::text,8,'0'), 'Jl. Uji '||g, 20 from generate_series(1,$N) g;
insert into utility_connections (tenant_id, number, customer_id, tariff_id, meter_no, address, status, installed_at, initial_reading, zone, created_by_id)
select '$TENANT', 'SBG-'||lpad(row_number() over (order by c.code)::text,6,'0'), c.id, '$TARIFF', 'M-'||c.code, c.address, 'ACTIVE', (current_date - 400), 0, 'Zona '||((row_number() over (order by c.code))%12), '$USER'
from customers c where c.tenant_id='$TENANT';
SQL
for B in 3 2 1; do
P=$(date -d "$(date +%Y-%m-01) -$B month" +%Y-%m)
psql "$DB" -v ON_ERROR_STOP=1 -c "set app.bypass_rls='on'; insert into utility_readings (tenant_id, connection_id, period, previous, current, usage, status, entered_by_id, verified_by_id, verified_at)
select '$TENANT', c.id, '$P', (4-$B)*0 + (3-$B)*15, (3-$B+1)*15, 15, 'VERIFIED', '$USER', '$USER', now() from utility_connections c where c.tenant_id='$TENANT';" 
done
echo "$TENANT" > "$OUT/tenant"
echo ok

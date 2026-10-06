#!/bin/bash
# Pasang SANSU di server baru (Ubuntu 22.04 / 24.04, min. 2 vCPU, 4 GB RAM, 40 GB disk).
# Jalankan dari folder sansu:  sudo bash deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(id -u)" = 0 ] || { echo "Jalankan dengan sudo: sudo bash deploy/install.sh"; exit 1; }
say() { echo -e "\n\033[1;36m▶ $*\033[0m"; }

say "1/6 Memeriksa Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null || { echo "Docker Compose tidak tersedia"; exit 1; }

say "2/6 Memori swap (agar proses build tidak kehabisan RAM)"
if [ "$(swapon --show | wc -l)" = 0 ] && [ "$(awk '/MemTotal/{print int($2/1024/1024)}' /proc/meminfo)" -lt 8 ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Swap 4 GB dibuat."
else
  echo "Lewati."
fi

say "3/6 Firewall"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null && echo "Hanya port SSH, 80, dan 443 yang terbuka."
fi

say "4/6 Konfigurasi (.env)"
if [ ! -f .env ]; then
  read -r -p "Domain aplikasi (mis. app.sansu.id): " DOMAIN
  read -r -p "Email admin (untuk sertifikat HTTPS & login Panel SANSU): " EMAIL
  rnd() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  PASS=$(rnd 32); JWT=$(rnd 64); BPASS=$(rnd 32); DKEY=$(rnd 48)
  sed -e "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" \
      -e "s|^ACME_EMAIL=.*|ACME_EMAIL=$EMAIL|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PASS|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" \
      -e "s|^BACKUP_PASSPHRASE=.*|BACKUP_PASSPHRASE=$BPASS|" \
      -e "s|^PLATFORM_ADMIN_EMAILS=.*|PLATFORM_ADMIN_EMAILS=$EMAIL|" \
      -e "s|^DATA_ENCRYPTION_KEY=.*|DATA_ENCRYPTION_KEY=$DKEY|" \
      .env.example > .env
  chmod 600 .env
  echo
  echo "  ┌────────────────────────────────────────────────────────────────────┐"
  echo "  │ CATAT & SIMPAN DI TEMPAT AMAN (mis. password manager):             │"
  echo "  │ Kata sandi enkripsi backup: $BPASS │"
  echo "  │ Tanpa ini, backup offsite tidak bisa dibuka.                       │"
  echo "  └────────────────────────────────────────────────────────────────────┘"
else
  echo ".env sudah ada — dipakai apa adanya."
  DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2-)
fi
mkdir -p backups

IP=$(curl -fsS -m 10 https://api.ipify.org || true)
DNS=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
if [ -n "$IP" ] && [ "$DNS" != "$IP" ]; then
  echo "⚠  Domain $DOMAIN mengarah ke '${DNS:-tidak ada}', sedangkan IP server ini $IP."
  echo "   Atur DNS A-record $DOMAIN → $IP di pengelola domain Anda. HTTPS aktif otomatis setelah DNS benar."
fi

say "5/6 Membangun & menjalankan SANSU (5–15 menit pada pemasangan pertama)"
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

say "6/6 Memeriksa"
./sansu.sh start >/dev/null 2>&1 || true
./sansu.sh status
echo
echo "Selesai. Buka https://$DOMAIN lalu daftarkan perusahaan pertama lewat tab \"Coba gratis\"."
echo "Bantuan: ./sansu.sh   ·   Panduan: docs/PANDUAN-SERVER.md"

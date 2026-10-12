# Peta Deploy SANSU

SANSU terdiri dari dua bagian yang di-deploy terpisah atau bersamaan:

| Bagian | Folder | Teknologi | Hasil build |
| --- | --- | --- | --- |
| Backend (API) | `backend` | NestJS + PostgreSQL | `backend/dist` (dijalankan `node dist/main.js`) |
| Frontend (web) | `frontend` | React + Vite | `frontend/dist` (berkas statis) |
| Kontrak bersama | `shared` | TypeScript | **harus dibangun lebih dulu** (`npm run build -w shared`) |

Frontend memanggil API lewat alamat relatif `/api/*`. Karena itu di mana pun web ditaruh, `/api/*` harus **diteruskan** ke server API (nginx/Caddy, atau rewrite Vercel/Netlify).

## Pilih jalur

| Jalur | Frontend | Backend | Berkas konfigurasi |
| --- | --- | --- | --- |
| **A. VPS satu server** (disarankan) | nginx (container `web`) | container `api` + `db` + Caddy HTTPS | `docker-compose.prod.yml`, `deploy/install.sh` |
| **B. Vercel + Render** | Vercel | Render (+ Neon) | `vercel.json`, `render.yaml` |
| **C. Netlify + Render/Railway** | Netlify | Render atau Railway (+ database luar) | `netlify.toml`, `render.yaml` / `railway.json` |
| **D. Railway penuh** | Railway (service web) | Railway (service api) | `deploy/railway/web.json`, `railway.json` |

### A. VPS (Docker Compose)
```bash
sudo bash deploy/install.sh     # sekali, di server Ubuntu
./sansu.sh status | update | backup | restore
```
Detail: [PANDUAN-SERVER.md](PANDUAN-SERVER.md).

### B/C. Frontend statis + API terpisah
1. Deploy **API** dulu (Render: *New › Blueprint* membaca `render.yaml`; Railway: `railway.json`). Isi env sesuai `.env.example` (`DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `APP_URL`, ...). Cek `https://<api>/api/health`.
2. Arahkan web ke API itu — satu perintah mengganti semua berkas sekaligus:
   ```bash
   npm run deploy:set-api -- https://sansu-api.onrender.com
   ```
3. Commit & push, lalu hubungkan repo ke Vercel/Netlify:
   - **Vercel**: Root Directory = akar repo (memakai `vercel.json`), atau `frontend` (memakai `frontend/vercel.json`).
   - **Netlify**: otomatis memakai `netlify.toml` di akar repo.
4. Di server API set `CORS_ORIGIN` dan `APP_URL` ke alamat web (mis. `https://sansu.vercel.app`).

### D. Railway penuh
- Service **api**: build memakai `railway.json` (akar repo) → `backend/Dockerfile`.
- Service **web**: *Settings › Config-as-code* → path `/deploy/railway/web.json` → `frontend/Dockerfile`. Tambahkan variabel `API_UPSTREAM` = alamat internal service api, mis. `http://api.railway.internal:3000`.

## Docker image

Semua Dockerfile dibangun dari **akar repo** sebagai context:
```bash
docker build -f backend/Dockerfile -t sansu-api .
docker build -f frontend/Dockerfile -t sansu-web .
```
- `sansu-web` meneruskan `/api/*` ke `API_UPSTREAM` (default `http://api:3000`, cocok untuk docker-compose).
- `sansu-api` menjalankan migrasi database otomatis saat start dan membuka port `PORT` (default 3000).

## Struktur berkas deploy

```
.
├─ backend/Dockerfile          image backend
├─ frontend/Dockerfile          image frontend (nginx)  ·  frontend/nginx.conf = template (API_UPSTREAM)
├─ docker-compose.yml           development: hanya database
├─ docker-compose.prod.yml      produksi VPS: caddy + web + api + db + backup
├─ deploy/                      install.sh · Caddyfile · backup/ · railway/web.json
├─ vercel.json · frontend/vercel.json   Vercel (akar repo / Root Directory frontend)
├─ netlify.toml                 Netlify
├─ render.yaml · railway.json   API di Render / Railway
└─ scripts/set-api-url.mjs      ganti alamat API di semua konfigurasi web
```

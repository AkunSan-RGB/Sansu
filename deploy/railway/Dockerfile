# SANSU satu layanan untuk Railway: API (NestJS) + tampilan web (hasil build Vite) dalam satu container.
# Build context = akar repo:  docker build -f deploy/railway/Dockerfile .
# Satu alamat untuk semuanya (web di "/", API di "/api"), tanpa nginx dan tanpa CORS.
# Railway menyuntikkan PORT; API membacanya. Database: tambahkan Postgres di Railway (DATABASE_URL).

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts
COPY shared shared
COPY backend backend
COPY frontend frontend
RUN npm run build -w shared && npm run build -w backend && npm run build -w frontend

# ---------- runtime ----------
FROM node:22-alpine
ENV NODE_ENV=production
ENV WEB_DIST=/app/frontend/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --ignore-scripts -w shared -w backend && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
COPY backend/drizzle backend/drizzle
USER node
EXPOSE 3000
WORKDIR /app/backend
# main.js menerapkan migrasi database terbaru secara otomatis sebelum menerima permintaan
CMD ["node", "dist/main.js"]

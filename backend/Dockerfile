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
RUN npm run build -w shared && npm run build -w backend

# ---------- runtime ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --ignore-scripts -w shared -w backend && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/backend/dist backend/dist
COPY backend/drizzle backend/drizzle
USER node
EXPOSE 3000
WORKDIR /app/backend
# main.js menerapkan migrasi database terbaru secara otomatis sebelum menerima permintaan
CMD ["node", "dist/main.js"]

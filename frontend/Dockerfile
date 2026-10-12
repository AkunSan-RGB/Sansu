# Web SANSU (React + Vite) disajikan oleh nginx. Build context = akar repo:
#   docker build -f frontend/Dockerfile .
# Alamat API untuk /api/* diatur lewat env API_UPSTREAM (default: layanan "api" di docker-compose).

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts
COPY shared shared
COPY frontend frontend
RUN npm run build -w shared && npm run build -w frontend

# ---------- runtime ----------
FROM nginx:alpine
ENV API_UPSTREAM=http://api:3000
# *.template di folder ini otomatis diproses envsubst saat container start
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

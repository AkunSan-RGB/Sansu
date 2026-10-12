# Stage 1: Build Frontend Vite
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json ./apps/web/
RUN npm ci
COPY apps/web ./apps/web
RUN npm run build --workspace=apps/web

# Stage 2: Serve dengan NGINX
FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Izinkan akses lewat terowongan publik (Cloudflare Tunnel) untuk uji bersama
    allowedHosts: ['.trycloudflare.com'],
    // Semua request /api diteruskan ke backend NestJS
    proxy: { '/api': 'http://localhost:3000' },
  },
});

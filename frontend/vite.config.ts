import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  test: { setupFiles: ['./src/test/setup.ts'], css: false },
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  preview: {
    allowedHosts: true, // Mengizinkan semua host domain di Railway Preview
  },
});
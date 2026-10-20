// Font disajikan dari server sendiri (tanpa Google Fonts): lebih cepat, tidak bergantung pihak ketiga, sesuai UU PDP
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider, message } from 'antd';
import idID from 'antd/locale/id_ID';
import dayjs from 'dayjs';
import 'dayjs/locale/id';
import React from 'react';
import { ApiError } from './api/client';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { sansuTheme } from './brand/theme';
import './print.css';
import './shell.css';

dayjs.locale('id');

// Setiap data yang gagal dimuat diberitahukan (sekali per pesan), kecuali saat server sedang menyala
// — itu sudah ditangani banner status server dan data dimuat ulang otomatis.
let lastToast = { text: '', at: 0 };
const queryCache = new QueryCache({
  onError: (err) => {
    if (err instanceof ApiError && (err.status === 401 || err.status === 503)) return;
    // 403: peran ini memang tidak boleh membaca data itu (umumnya data pelengkap halaman); halaman utama menampilkan pesannya sendiri lewat QueryState
    if (err instanceof ApiError && err.status === 403) return;
    const text = `Data gagal dimuat: ${err.message}`;
    if (text === lastToast.text && Date.now() - lastToast.at < 8000) return;
    lastToast = { text, at: Date.now() };
    message.error(text, 6);
  },
});

const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Server baru menyala bisa butuh beberapa detik: coba lagi lebih sabar sebelum menyerah
      retry: (count, err) => count < 4 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={idID} theme={sansuTheme}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);

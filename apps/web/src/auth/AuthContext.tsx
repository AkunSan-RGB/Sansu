import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext } from 'react';
import type { BusinessModel, LoginResponse } from '@sansu/shared';
import { ApiError, get, post, tokenStore } from '@/api/client';
import type { Me } from '@/api/types';
import { setUiModel } from '@/lib/terms';

interface AuthState {
  me: Me | undefined;
  loading: boolean;
  /** Mengembalikan `challenge` bila akun memakai verifikasi 2 langkah */
  login: (email: string, password: string) => Promise<{ challenge: string } | void>;
  loginTwoFactor: (challenge: string, code: string) => Promise<void>;
  register: (data: { companyName: string; name: string; email: string; password: string; businessModel?: BusinessModel }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const {
    data: me,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ['me'],
    queryFn: () => get<Me>('/auth/me'),
    enabled: !!tokenStore.get(),
    // Server belum menyala ≠ belum login: terus coba sampai server menjawab, jangan lempar ke halaman login
    retry: (_, err) => !(err instanceof ApiError && err.status === 401),
    retryDelay: 2000,
  });
  // Istilah antarmuka (t()) mengikuti jenis usaha; diisi sebelum halaman anak dirender
  setUiModel(me?.businessModel);
  const unauthorized = isError && error instanceof ApiError && error.status === 401;

  const afterAuth = async (res: { accessToken: string }) => {
    tokenStore.set(res.accessToken);
    // Buang cache milik sesi sebelumnya, kecuali query profil yang sedang diamati
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    // Ambil profil sebelum pindah halaman agar layout tidak mengira user belum login
    qc.setQueryData(['me'], await get<Me>('/auth/me'));
  };

  const value: AuthState = {
    me,
    loading: !!tokenStore.get() && (isPending || (isError && !unauthorized)),
    login: async (email, password) => {
      const res = await post<LoginResponse>('/auth/login', { email, password });
      if (res.twoFactorRequired) return { challenge: res.challenge };
      await afterAuth(res);
    },
    loginTwoFactor: async (challenge, code) =>
      afterAuth(await post<{ accessToken: string }>('/auth/2fa/login', { challenge, code })),
    register: async (data) => afterAuth(await post<{ accessToken: string }>('/auth/register', data)),
    logout: () => {
      tokenStore.clear();
      qc.clear();
      window.location.href = '/login';
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus di dalam AuthProvider');
  return ctx;
}

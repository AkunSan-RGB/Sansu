import { Spin } from 'antd';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

/** Halaman layar penuh (mis. kasir) yang tetap wajib login */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Spin fullscreen tip="Menghubungkan ke server SANSU…" />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.twoFactor?.required && !me.twoFactor.enabled) return <Navigate to="/account/security" replace />;
  return children;
}

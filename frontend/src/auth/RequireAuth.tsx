import { Spin } from 'antd';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { rememberReturnTo } from './returnTo';
import { useAuth } from './AuthContext';

/** Halaman layar penuh (mis. kasir) yang tetap wajib login */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spin fullscreen tip="Menghubungkan ke server SANSU…" />;
  if (!me) {
    rememberReturnTo(loc.pathname + loc.search);
    return <Navigate to="/login" replace />;
  }
  if (me.twoFactor?.required && !me.twoFactor.enabled) return <Navigate to="/account/security" replace />;
  return children;
}

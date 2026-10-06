import type { AuthUser } from '../auth/auth-user';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Konteks per permintaan: apakah handler sudah menulis jejak audit sendiri (yang lebih rinci) */
export const auditContext = new AsyncLocalStorage<{ logged: boolean; user?: AuthUser }>();

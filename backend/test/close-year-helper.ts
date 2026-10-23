import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { withSimulatedDay } from '../src/common/utils/dates';

/**
 * Tutup buku hanya boleh untuk tahun yang sudah berakhir. Data tes bertanggal hari ini (tahun berjalan), jadi penutupan
 * dijalankan lewat layanan dengan hari simulasi di awal tahun berikutnya (seperti pembuat data demo memutar tanggal).
 */
export async function closeYearLater(app: INestApplication, token: string, year: number, lock?: boolean): Promise<{ status: number; body: Record<string, any> }> {
  const me = (await request(app.getHttpServer()).get('/api/auth/me').set({ Authorization: `Bearer ${token}` })).body;
  const user = { sub: me.id, tenantId: me.tenantId, role: me.role, email: me.email };
  try {
    const body = await withSimulatedDay(`${year + 1}-01-10`, () => app.get(AccountingService).closeYear(user as never, { year, lock } as never));
    return { status: 201, body: JSON.parse(JSON.stringify(body)) };
  } catch (e) {
    return { status: (e as { getStatus?: () => number }).getStatus?.() ?? 500, body: { message: (e as Error).message } };
  }
}

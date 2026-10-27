// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const get = vi.fn();
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), get: (...a: unknown[]) => get(...a) }));

import ModelSetupCard from './ModelSetupCard';

const data = {
  model: 'FNB',
  name: 'F&B (kafe & restoran)',
  done: 1,
  total: 3,
  items: [
    { key: 'boms', group: 'BEFORE_START', title: 'Resep tiap menu', why: 'Menu terjual memotong bahan.', link: '/production/boms', done: true },
    { key: 'tables', group: 'BEFORE_START', title: 'Meja dan layar dapur', why: 'Pesanan dine-in butuh meja.', link: '/pos/tables', done: false },
    { key: 'platforms', group: 'RECOMMENDED', title: 'Komisi platform pesan-antar', why: 'Dicatat bersih setelah komisi.', link: '/pos/online', done: false },
  ],
};

describe('ModelSetupCard', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async () => data);
  });

  it('menampilkan pengaturan jenis usaha per kelompok dengan status dan tautan', async () => {
    get.mockImplementation(async () => data);
    renderWithProviders(<ModelSetupCard />);
    await screen.findByText('Pengaturan untuk F&B (kafe & restoran)');
    expect(screen.getByText('Atur sebelum mulai bertransaksi')).toBeInTheDocument();
    expect(screen.getByText('Disarankan setelah berjalan')).toBeInTheDocument();
    expect(screen.getByText('Sudah')).toBeInTheDocument();
    expect(screen.getAllByText('Belum')).toHaveLength(2);
    expect(screen.getByText('1 dari 3')).toBeInTheDocument();
    expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === '/pos/tables')).toBe(true);
    expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === '/help?a=panduan-fnb')).toBe(true);
  });

  it('galat memuat ditampilkan, bukan layar kosong', async () => {
    get.mockImplementation(async () => {
      throw new Error('Server SANSU belum siap');
    });
    renderWithProviders(<ModelSetupCard />);
    await screen.findByText('Daftar pengaturan jenis usaha gagal dimuat');
  });
});

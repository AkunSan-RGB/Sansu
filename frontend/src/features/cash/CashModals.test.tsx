// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashTransaction } from '@/api/types';
import { renderWithProviders } from '@/test/render';

const post = vi.fn();
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), post: (...a: unknown[]) => post(...a) }));

import CashProofModal from './CashProofModal';
import CashVoidModal from './CashVoidModal';

const target = { id: 'tx-1', number: 'KK-0007' } as CashTransaction;

describe('Batalkan transaksi kas', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockImplementation(async () => ({}));
  });

  it('alasan wajib (min. 5 karakter): tanpa alasan yang valid tidak ada permintaan ke server', async () => {
    renderWithProviders(<CashVoidModal target={target} onClose={() => undefined} />);
    expect(screen.getByText('Batalkan KK-0007')).toBeInTheDocument();
    expect(screen.getByText(/hanya mengoreksi pembukuan, bukan mengembalikan uang/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
    await screen.findByText('Isi alasan (min. 5 karakter)');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
    await waitFor(() => expect(screen.getByText('Isi alasan (min. 5 karakter)')).toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
  });

  it('alasan valid mengirim pembatalan ke transaksi yang benar lalu menutup modal', async () => {
    const onClose = vi.fn();
    renderWithProviders(<CashVoidModal target={target} onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Salah catat nominal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/cash/transactions/tx-1/void', { reason: 'Salah catat nominal' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('klik ganda cepat hanya mengirim satu permintaan', async () => {
    let release!: (v: unknown) => void;
    post.mockReturnValue(new Promise((r) => (release = r)));
    renderWithProviders(<CashVoidModal target={target} onClose={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Salah catat nominal' } });
    const btn = screen.getByRole('button', { name: 'Batalkan transaksi' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledTimes(1);
    release({});
  });

  it('server menolak: pesan galat tampil dan modal tetap terbuka', async () => {
    const { ApiError } = await import('@/api/client');
    post.mockImplementation(() => {
      const rejected = Promise.reject(new ApiError(400, 'Sudah dicocokkan dengan mutasi bank'));
      rejected.catch(() => undefined);
      return rejected;
    });
    const onClose = vi.fn();
    renderWithProviders(<CashVoidModal target={target} onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Salah catat nominal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    await screen.findByText('Sudah dicocokkan dengan mutasi bank');
    await new Promise((r) => setTimeout(r, 100)); // beri waktu semua pembaruan tampilan selesai sebelum modal dibongkar
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Nomor bukti transaksi kas', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockImplementation(async () => ({}));
  });
  it('nomor bukti kosong ditolak; yang valid dikirim ke alamat bukti transaksi itu', async () => {
    const onClose = vi.fn();
    renderWithProviders(<CashProofModal target={target} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await screen.findByText('Isi nomor bukti');
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'NOTA-991' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/cash/transactions/tx-1/evidence', { reference: 'NOTA-991' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
  it('tanpa transaksi terpilih modal tidak tampil', () => {
    renderWithProviders(<CashProofModal target={null} onClose={() => undefined} />);
    expect(screen.queryByText(/Nomor bukti/)).not.toBeInTheDocument();
  });
});

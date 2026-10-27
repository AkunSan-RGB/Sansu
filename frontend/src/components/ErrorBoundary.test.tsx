// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, isChunkLoadError } from './ErrorBoundary';

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('kolom tidak ada');
  return <div>Isi halaman</div>;
}

describe('ErrorBoundary', () => {
  it('menampilkan anak bila tidak ada galat', () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Isi halaman')).toBeInTheDocument();
  });

  it('galat tampilan menjadi pesan ramah, bukan layar putih; "Coba lagi" menampilkan anak kembali', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let explode = true;
    const Child = () => <Boom explode={explode} />;
    render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Halaman ini gagal ditampilkan')).toBeInTheDocument();
    expect(screen.getByText('kolom tidak ada')).toBeInTheDocument();
    explode = false;
    fireEvent.click(screen.getByText('Coba lagi'));
    expect(screen.getByText('Isi halaman')).toBeInTheDocument();
  });

  it('pindah halaman (resetKey berubah) mencoba menampilkan anak lagi', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Halaman ini gagal ditampilkan')).toBeInTheDocument();
    rerender(
      <ErrorBoundary resetKey="/b">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Isi halaman')).toBeInTheDocument();
  });

  it('galat memuat potongan kode (versi baru dirilis) diarahkan ke muat ulang', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Stale = () => {
      throw new Error('Failed to fetch dynamically imported module: /assets/x.js');
    };
    render(
      <ErrorBoundary>
        <Stale />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Ada versi SANSU yang lebih baru')).toBeInTheDocument();
    expect(screen.queryByText('Coba lagi')).not.toBeInTheDocument();
    expect(isChunkLoadError(new Error('ChunkLoadError'))).toBe(true);
    expect(isChunkLoadError(new Error('x is undefined'))).toBe(false);
  });
});

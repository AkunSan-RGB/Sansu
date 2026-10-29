// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import { describe, expect, it, vi } from 'vitest';
import YearMonthFilter from './YearMonthFilter';

describe('YearMonthFilter', () => {
  it('bulan kosong = "Setahun"; memilih bulan memanggil onMonth dengan angka 1–12', async () => {
    const onMonth = vi.fn();
    render(<YearMonthFilter year={dayjs().year()} month={null} onYear={() => {}} onMonth={onMonth} />);
    expect(screen.getByText('Setahun')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Bulan' }));
    // daftar antd dirender virtual: pilih bulan yang tampil di awal daftar
    fireEvent.click((await screen.findAllByText(/^(Maret|March)$/))[0]);
    expect(onMonth).toHaveBeenCalledWith(3);
  });

  it('tahun yang sedang dipilih selalu ada di daftar walau di luar empat tahun terakhir', async () => {
    render(<YearMonthFilter year={2019} month={null} onYear={() => {}} onMonth={() => {}} />);
    expect(screen.getByText('2019')).toBeTruthy();
  });
});

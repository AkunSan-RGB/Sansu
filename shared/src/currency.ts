/** Mata uang fungsional dan penyajian SANSU: Rupiah. Mata uang lain berlaku untuk faktur jual/beli (valas). */
export const BASE_CURRENCY = 'IDR';

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
}

/** Mata uang asing yang umum untuk perdagangan Indonesia (kode ISO 4217) */
export const FOREIGN_CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'Dolar Amerika Serikat', symbol: 'US$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'SGD', name: 'Dolar Singapura', symbol: 'S$' },
  { code: 'JPY', name: 'Yen Jepang', symbol: '¥' },
  { code: 'CNY', name: 'Yuan Tiongkok (Renminbi)', symbol: 'CN¥' },
  { code: 'MYR', name: 'Ringgit Malaysia', symbol: 'RM' },
  { code: 'AUD', name: 'Dolar Australia', symbol: 'A$' },
  { code: 'GBP', name: 'Poundsterling Inggris', symbol: '£' },
  { code: 'HKD', name: 'Dolar Hong Kong', symbol: 'HK$' },
  { code: 'THB', name: 'Baht Thailand', symbol: '฿' },
  { code: 'KRW', name: 'Won Korea Selatan', symbol: '₩' },
  { code: 'SAR', name: 'Riyal Arab Saudi', symbol: 'SR' },
  { code: 'INR', name: 'Rupee India', symbol: '₹' },
  { code: 'VND', name: 'Dong Vietnam', symbol: '₫' },
];

export const isForeignCurrency = (code?: string | null): boolean => !!code && code !== BASE_CURRENCY;
export const isKnownForeignCurrency = (code?: string | null): boolean => FOREIGN_CURRENCIES.some((c) => c.code === code);
export const currencyName = (code: string): string => (code === BASE_CURRENCY ? 'Rupiah' : (FOREIGN_CURRENCIES.find((c) => c.code === code)?.name ?? code));

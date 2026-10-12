import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Hanya angkanya: "01.234.567.8-901.000" → "012345678901000" */
export const digitsOnly = (v: string) => v.replace(/\D/g, '');

/** NPWP lama 15 digit atau NPWP/NIK 16 digit; titik, strip, dan spasi diabaikan */
export const isNpwp = (v: unknown): boolean => typeof v === 'string' && [15, 16].includes(digitsOnly(v).length) && digitsOnly(v).length === v.replace(/[\s.\-]/g, '').length;

/** NIK: 16 digit */
export const isNik = (v: unknown): boolean => typeof v === 'string' && /^\d{16}$/.test(v.replace(/\s/g, ''));

/**
 * Validasi opsional: string kosong dianggap tidak diisi. Formatnya boleh bertitik/bergaris
 * (data lama tetap sah) tetapi harus 15 atau 16 digit, tanpa huruf atau karakter lain.
 */
export function IsNpwp(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isNpwp',
      target: object.constructor,
      propertyName,
      options: { message: 'NPWP harus 15 atau 16 digit angka (boleh bertitik/bergaris)', ...options },
      validator: { validate: (v: unknown) => v === undefined || v === null || v === '' || isNpwp(v) },
    });
}

export function IsNik(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isNik',
      target: object.constructor,
      propertyName,
      options: { message: 'NIK harus 16 digit angka', ...options },
      validator: { validate: (v: unknown) => v === undefined || v === null || v === '' || isNik(v) },
    });
}

/**
 * Pembuat data demo/simulasi mengisi DTO secara sebagian (nilai bawaan diterapkan validator pada jalur HTTP).
 * Satu pintu bernama agar pelonggaran tipe ini tampak dan mudah diperketat, bukan `as never` tersebar.
 */
export function asDto(partial: object): never {
  return partial as never;
}

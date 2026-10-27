import { D, type Dec, type DecValue } from '../../../common/utils/money';

type InvoiceAmounts = { total: DecValue; paidAmount: DecValue; returnedAmount: DecValue };

/**
 * Posisi tagihan sebuah faktur (nilai, bukan baris database): total, yang sudah dibayar, dan yang sudah diretur.
 * Aturan "berapa lagi yang boleh dibayar", "apakah lunas", dan "status sesudah pembayaran" dikumpulkan di sini supaya
 * pembayaran, penghapusan piutang, dan retur memakai definisi yang sama dan bisa diuji tanpa database. Objek ini tidak bisa diubah:
 * setiap perubahan menghasilkan posisi baru.
 */
export class InvoiceBalance {
  private constructor(
    readonly total: Dec,
    readonly paid: Dec,
    readonly returned: Dec,
  ) {}

  static of(inv: InvoiceAmounts): InvoiceBalance {
    return new InvoiceBalance(D(inv.total), D(inv.paidAmount), D(inv.returnedAmount));
  }

  /** Sisa tagihan: total dikurangi pembayaran dan retur */
  get outstanding(): Dec {
    return this.total.minus(this.paid).minus(this.returned);
  }

  /** Lunas bila pembayaran + retur sudah menutup total */
  get isSettled(): boolean {
    return this.paid.plus(this.returned).gte(this.total);
  }

  get status(): 'PAID' | 'PARTIAL' {
    return this.isSettled ? 'PAID' : 'PARTIAL';
  }

  /** Jumlah ini boleh diterima/dihapus? (positif dan tidak melebihi sisa) */
  canApply(amount: DecValue): boolean {
    const a = D(amount);
    return a.gt(0) && a.lte(this.outstanding);
  }

  /** Posisi baru setelah `amount` (nilai piutang yang dilunasi) diterima atau dihapus */
  apply(amount: DecValue): InvoiceBalance {
    return new InvoiceBalance(this.total, this.paid.plus(amount), this.returned);
  }
}

import { Injectable } from '@nestjs/common';
import type { AccountMeta } from '../../accounting/ledger-data';
import { MovementSchedule, sideLabels, type MovementProfile } from './movement.schedule';

const TAX_KEYS = ['VAT_IN', 'VAT_OUT', 'PPH21_PAYABLE', 'PPH23_PAYABLE', 'PPH4_2_PAYABLE', 'FINAL_TAX_WITHHELD', 'CORPORATE_TAX_PAYABLE'];

@Injectable()
export class CashSchedule extends MovementSchedule {
  readonly kind = 'CASH';
  supports(a: AccountMeta) {
    return a.isCashAccount;
  }
  protected profile(a: AccountMeta): MovementProfile {
    return {
      title: 'Rincian kas dan bank',
      labels: sideLabels(a, 'Penerimaan', 'Pengeluaran'),
      method: {
        basis: 'Saldo buku dari seluruh jurnal yang memakai akun kas/bank ini.',
        formulas: ['Saldo akhir = saldo awal + penerimaan − pengeluaran', 'Saldo koran = saldo buku ± selisih waktu (cek yang belum cair, setoran dalam perjalanan)'],
        policies: ['Kas/bank yang tidak dibatasi penggunaannya diperlakukan sebagai kas dan setara kas.', 'Cocokkan saldo akhir dengan rekening koran lewat menu Bank.', 'Rekening valas ditampilkan dalam Rupiah (biaya tercatat rata-rata tertimbang); saldo dalam valas ada di Kas & Bank › Rekening.'],
      },
    };
  }
}

@Injectable()
export class TaxSchedule extends MovementSchedule {
  readonly kind = 'TAX';
  supports(a: AccountMeta) {
    return !!a.systemKey && TAX_KEYS.includes(a.systemKey);
  }
  protected profile(a: AccountMeta): MovementProfile {
    return {
      title: 'Rincian akun pajak',
      labels: a.type === 'ASSET' ? { add: 'Pajak masukan / lebih bayar (debit)', sub: 'Dikreditkan / dikompensasi (kredit)' } : { add: 'Pemungutan / pemotongan (kredit)', sub: 'Penyetoran / kompensasi (debit)' },
      method: {
        basis: 'Saldo pajak menurut jurnal yang memakai akun ini, per bulan masa pajak.',
        formulas: ['Saldo akhir = saldo awal + pemungutan/pemotongan − penyetoran/kompensasi', 'Kurang bayar = saldo kredit; lebih bayar = saldo debit'],
        policies: ['Cocokkan dengan Setoran Pajak dan SPT Masa tiap bulan.', 'PPN keluaran dikurangi PPN masukan menentukan PPN kurang/lebih bayar masa itu.'],
      },
    };
  }
}

@Injectable()
export class RevenueSchedule extends MovementSchedule {
  readonly kind = 'REVENUE';
  supports(a: AccountMeta) {
    return a.type === 'REVENUE';
  }
  protected profile(): MovementProfile {
    return {
      title: 'Rincian pendapatan',
      labels: { add: 'Pendapatan (kredit)', sub: 'Retur / potongan / koreksi (debit)' },
      method: {
        basis: 'Pendapatan diakui saat barang/jasa diserahkan dan faktur dibukukan (basis akrual).',
        formulas: ['Pendapatan neto bulan = pendapatan (kredit) − retur/potongan/koreksi (debit)', 'Akumulasi = jumlah pendapatan neto sejak 1 Januari'],
        policies: ['Retur dan potongan penjualan mengurangi pendapatan bruto pada bulan terjadinya.'],
      },
    };
  }
}

@Injectable()
export class CostOfSalesSchedule extends MovementSchedule {
  readonly kind = 'COST_OF_SALES';
  supports(a: AccountMeta) {
    return a.type === 'EXPENSE' && a.reportGroup === 'COST_OF_SALES';
  }
  protected profile(): MovementProfile {
    return {
      title: 'Rincian harga pokok',
      labels: { add: 'Beban pokok (debit)', sub: 'Retur / koreksi (kredit)' },
      method: {
        basis: 'Harga pokok dibebankan saat barang terjual atau jasa diserahkan, memakai biaya rata-rata tertimbang.',
        formulas: ['HPP = persediaan awal + pembelian/produksi − persediaan akhir', 'Beban pokok bulan = pengeluaran persediaan untuk penjualan − retur'],
      },
    };
  }
}

@Injectable()
export class ExpenseSchedule extends MovementSchedule {
  readonly kind = 'EXPENSE';
  supports(a: AccountMeta) {
    return a.type === 'EXPENSE';
  }
  protected profile(): MovementProfile {
    return {
      title: 'Rincian beban',
      labels: { add: 'Beban (debit)', sub: 'Koreksi / pembalikan (kredit)' },
      method: {
        basis: 'Beban diakui pada periode terjadinya (basis akrual); pembayaran di muka diamortisasi, beban yang belum dibayar diakru.',
        formulas: ['Beban bulan = beban dibukukan (debit) − koreksi/pembalikan (kredit)', 'Akumulasi = jumlah beban sejak 1 Januari'],
      },
    };
  }
}

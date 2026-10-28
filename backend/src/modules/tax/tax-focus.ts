/**
 * Daftar periksa pajak sesuai jenis usaha. Memakai data nyata perusahaan: setiap butir menyebut jumlah dan tautan untuk memperbaikinya.
 * Hanya memeriksa kelengkapan data (NPWP, bukti potong, pengaturan pajak), tidak menghitung kewajiban pajak.
 */
import { Injectable } from '@nestjs/common';
import { taxFocusForTenant, type BusinessModel, type ServiceProfile } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { SettingsService } from '../../common/settings.service';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { queryCount } from './tax-focus.repository';

export interface TaxCheck {
  key: string;
  status: 'PERLU' | 'INFO' | 'OK';
  title: string;
  detail: string;
  link?: string;
}

@Injectable()
export class TaxFocusService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  private async count(q: ReturnType<typeof sql>): Promise<number> {
    const r = await queryCount(this.db, q);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** Pemeriksaan khas profil layanan Jasa: PPh final konstruksi, PPN atas SPP, potongan PPh 23 alih daya, harga kasir bengkel */
  private async profileChecks(tenantId: string, profiles: ServiceProfile[], since: string, pkp: boolean, posIncludesVat: boolean): Promise<TaxCheck[]> {
    const out: TaxCheck[] = [];
    if (profiles.includes('KONTRAKTOR')) {
      const n = await this.count(sql`
        SELECT COUNT(*)::int AS n FROM invoices i
        WHERE i.tenant_id = ${tenantId} AND i.kind = 'SERVICE' AND i.project_id IS NOT NULL AND i.date >= ${since} AND i.is_opening = false
          AND i.withholding_type IS DISTINCT FROM 'PPH4_2'
          AND EXISTS (SELECT 1 FROM service_invoice_lines l JOIN accounts a ON a.id = l.account_id WHERE l.invoice_id = i.id AND a.fiscal_treatment = 'FINAL_INCOME')`);
      out.push(
        n > 0
          ? { key: 'KONSTRUKSI_TANPA_PPH_FINAL', status: 'PERLU', title: 'Tagihan konstruksi tanpa PPh final', detail: `${n} tagihan proyek 90 hari terakhir dibukukan sebagai pendapatan konstruksi (PPh final) tetapi tidak mencatat PPh 4(2). Bila pemberi kerja tidak memotong, PPh final perlu disetor sendiri.`, link: '/tax/withheld' }
          : { key: 'KONSTRUKSI_TANPA_PPH_FINAL', status: 'OK', title: 'PPh final konstruksi', detail: 'Semua tagihan konstruksi 90 hari terakhir mencatat PPh 4(2).' },
      );
    }
    if (profiles.includes('PENDIDIKAN')) {
      const n = await this.count(sql`
        SELECT COUNT(DISTINCT f.invoice_id)::int AS n FROM edu_fee_invoices f JOIN invoices i ON i.id = f.invoice_id
        WHERE f.tenant_id = ${tenantId} AND i.date >= ${since} AND i.tax_amount > 0`);
      out.push(
        n > 0
          ? { key: 'SPP_KENA_PPN', status: 'PERLU', title: 'Tagihan SPP memuat PPN', detail: `${n} tagihan SPP 90 hari terakhir memuat PPN. Jasa pendidikan yang memenuhi syarat umumnya dibebaskan dari PPN — periksa status lembaga Anda dan pengaturan PPN perusahaan.`, link: '/settings/company' }
          : { key: 'SPP_KENA_PPN', status: 'OK', title: 'PPN atas SPP', detail: 'Tagihan SPP 90 hari terakhir tidak memuat PPN.' },
      );
    }
    if (profiles.includes('ALIH_DAYA')) {
      const n = await this.count(sql`
        SELECT COUNT(*)::int AS n FROM site_contract_invoices s JOIN invoices i ON i.id = s.invoice_id
        WHERE s.tenant_id = ${tenantId} AND i.date >= ${since} AND i.status = 'PAID' AND i.withholding_amount = 0`);
      out.push({
        key: 'ALIH_DAYA_POTONGAN',
        status: n > 0 ? 'INFO' : 'OK',
        title: 'PPh 23 atas tagihan kontrak lokasi',
        detail: n > 0 ? `${n} tagihan kontrak lokasi lunas 90 hari terakhir tanpa catatan PPh yang dipotong. Bila pengguna jasa memotong PPh 23, catat bukti potongnya agar menjadi kredit pajak.` : 'Tidak ada tagihan kontrak lokasi lunas tanpa catatan potongan dalam 90 hari terakhir.',
        link: '/tax/withheld',
      });
    }
    if (profiles.includes('BENGKEL') && pkp) {
      out.push({
        key: 'HARGA_KASIR_PPN',
        status: 'INFO',
        title: 'Harga kasir dan PPN',
        detail: posIncludesVat ? 'Harga layanan dan suku cadang di kasir dianggap SUDAH termasuk PPN.' : 'Harga layanan dan suku cadang di kasir dianggap BELUM termasuk PPN (PPN ditambahkan di struk). Pastikan sesuai papan harga.',
        link: '/settings',
      });
    }
    return out;
  }

  async focus(tenantId: string) {
    const model: BusinessModel = await this.settings.businessModel(this.db, tenantId);
    const tax = await this.settings.taxProfile(this.db, tenantId);
    const since = addDays(todayJakarta(), -90);
    const checks: TaxCheck[] = [];
    const goods = model !== 'JASA';
    const profiles: ServiceProfile[] = model === 'JASA' ? await this.settings.serviceProfiles(this.db, tenantId) : [];

    // PPN masukan hanya sah dengan faktur pajak dari pemasok ber-NPWP
    if (goods && tax.pkp) {
      const n = await this.count(sql`
        SELECT COUNT(*)::int AS n FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.tenant_id = ${tenantId} AND i.date >= ${since} AND i.tax_amount > 0 AND COALESCE(trim(s.npwp), '') = ''`);
      checks.push(
        n > 0
          ? {
              key: 'PPN_MASUKAN_TANPA_NPWP',
              status: 'PERLU',
              title: 'PPN masukan dari pemasok tanpa NPWP',
              detail: `${n} faktur pembelian 90 hari terakhir memuat PPN tetapi pemasoknya belum punya NPWP di data. PPN masukan hanya dapat dikreditkan bila ada faktur pajak yang sah — lengkapi NPWP pemasok atau periksa apakah PPN itu boleh dikreditkan.`,
              link: '/suppliers',
            }
          : {
              key: 'PPN_MASUKAN_TANPA_NPWP',
              status: 'OK',
              title: 'PPN masukan',
              detail: 'Semua pembelian ber-PPN 90 hari terakhir berasal dari pemasok ber-NPWP.',
            },
      );
    }

    // Jasa: klien yang memotong PPh 23 — catat bukti potong agar menjadi kredit pajak
    if (model === 'JASA') {
      const n = await this.count(sql`
        SELECT COUNT(*)::int AS n FROM invoices i
        WHERE i.tenant_id = ${tenantId} AND i.kind = 'SERVICE' AND i.status = 'PAID' AND i.date >= ${since} AND i.withholding_amount = 0 AND i.is_opening = false`);
      checks.push(
        n > 0
          ? {
              key: 'JASA_TANPA_POTONGAN',
              status: 'INFO',
              title: 'Faktur jasa lunas tanpa catatan potongan PPh',
              detail: `${n} faktur jasa lunas 90 hari terakhir tidak mencatat PPh yang dipotong klien. Bila klien (badan) memotong PPh 23, catat bukti potongnya saat pembayaran agar menjadi kredit pajak.`,
              link: '/tax/withheld',
            }
          : {
              key: 'JASA_TANPA_POTONGAN',
              status: 'OK',
              title: 'Potongan PPh klien',
              detail: 'Tidak ada faktur jasa lunas tanpa catatan potongan dalam 90 hari terakhir.',
            },
      );
    }

    if (model === 'JASA') checks.push(...(await this.profileChecks(tenantId, profiles, since, !!tax.pkp, !!tax.posPricesIncludeVat)));

    // F&B: pajak restoran daerah
    if (model === 'FNB') {
      const sales = await this.count(
        sql`SELECT COUNT(*)::int AS n FROM pos_orders WHERE tenant_id = ${tenantId} AND date >= ${addDays(todayJakarta(), -30)}`,
      );
      const localOn = !!tax.localTaxEnabled;
      checks.push(
        !localOn && sales > 0
          ? {
              key: 'PB1_BELUM_AKTIF',
              status: 'PERLU',
              title: 'Pajak restoran (PB1) belum dinyalakan',
              detail: `Ada ${sales} transaksi kasir 30 hari terakhir, tetapi pajak restoran daerah belum dinyalakan. Usaha makan-minum umumnya dikenai pajak ini; tarif dan tata cara mengikuti peraturan daerah Anda.`,
              link: '/settings',
            }
          : {
              key: 'PB1_BELUM_AKTIF',
              status: localOn ? 'OK' : 'INFO',
              title: 'Pajak restoran (PB1)',
              detail: localOn
                ? `Dinyalakan dengan tarif ${tax.localTaxRate ?? '10'}%.`
                : 'Belum ada transaksi kasir; nyalakan sebelum mulai berjualan bila usaha Anda dikenai pajak ini.',
              link: '/settings',
            },
      );
    }

    // Ritel & F&B: harga kasir termasuk PPN atau tidak
    if ((model === 'RITEL' || model === 'FNB') && tax.pkp) {
      checks.push({
        key: 'HARGA_KASIR_PPN',
        status: 'INFO',
        title: 'Harga kasir dan PPN',
        detail: tax.posPricesIncludeVat
          ? 'Harga di kasir dianggap SUDAH termasuk PPN (PPN dihitung ke dalam harga).'
          : 'Harga di kasir dianggap BELUM termasuk PPN (PPN ditambahkan di struk). Pastikan sesuai dengan harga yang dipajang.',
        link: '/settings',
      });
    }

    // Barang bagi pelanggan: faktur pajak butuh identitas pembeli
    if ((model === 'DAGANG' || model === 'FMCG') && tax.pkp) {
      const n = await this.count(sql`
        SELECT COUNT(*)::int AS n FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.date >= ${since} AND i.tax_amount > 0 AND i.is_opening = false AND COALESCE(trim(c.npwp), '') = ''`);
      checks.push(
        n > 0
          ? {
              key: 'FAKTUR_TANPA_NPWP_PEMBELI',
              status: 'INFO',
              title: 'Faktur ber-PPN ke pelanggan tanpa NPWP',
              detail: `${n} faktur 90 hari terakhir ber-PPN untuk pelanggan yang belum punya NPWP di data. Lengkapi NPWP/NIK pembeli sebelum menerbitkan faktur pajak.`,
              link: '/customers',
            }
          : {
              key: 'FAKTUR_TANPA_NPWP_PEMBELI',
              status: 'OK',
              title: 'Identitas pembeli di faktur pajak',
              detail: 'Semua faktur ber-PPN 90 hari terakhir ditujukan ke pelanggan ber-NPWP.',
            },
      );
    }

    // Manufaktur: potongan pelanggan pada maklon
    if (model === 'MANUFAKTUR') {
      const n = await this.count(
        sql`SELECT COUNT(*)::int AS n FROM invoices WHERE tenant_id = ${tenantId} AND date >= ${since} AND withholding_amount > 0`,
      );
      checks.push({
        key: 'MAKLON_POTONGAN',
        status: 'INFO',
        title: 'PPh dipotong pelanggan (maklon)',
        detail:
          n > 0
            ? `${n} faktur 90 hari terakhir tercatat dipotong PPh oleh pelanggan; kumpulkan bukti potongnya untuk kredit pajak.`
            : 'Belum ada potongan PPh dari pelanggan tercatat. Bila ada pekerjaan maklon, catat bukti potong saat pembayaran.',
        link: '/tax/withheld',
      });
    }

    return {
      model,
      focus: taxFocusForTenant(model, model === 'JASA' ? profiles : undefined),
      pkp: tax.pkp,
      checks,
      disclaimer:
        'Daftar periksa ini hanya memeriksa kelengkapan data. Perhitungan dan penerapan pajak perlu dikonfirmasi konsultan pajak.',
    };
  }
}

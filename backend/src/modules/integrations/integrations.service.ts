import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, between, eq, gt, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { customerDeposits, customers, invoices, marketplaceOrders } from '../../db/schema';
import { SYS } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { InvoicesService } from '../sales/invoices/invoices.service';
import { SalesOrdersService } from '../sales/orders/sales-orders.service';
import { IntegrationSettingsDto, MarketplaceImportDto, MarketplaceSettleDto } from './integrations.dto';
import { ReferenceRepository } from '../../db/reference.repository';
import { patchById } from '../../db/owned';
import { IntegrationsRepository } from './integrations.repository';

export interface IntegrationSettings {
  /** Kode satuan Coretax per satuan barang, mis. { PCS: 'UM.00xx' } */
  coretaxUnits: Record<string, string>;
  /** Pelanggan penampung per marketplace */
  marketplaceCustomers: Record<string, string>;
}

const DEFAULT_INTEGRATIONS: IntegrationSettings = { coretaxUnits: {}, marketplaceCustomers: {} };

const xml = (s: string | number | null | undefined) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** NPWP 15 digit lama → 16 digit (diawali 0) */
const tin16 = (s: string | null | undefined) => {
  const d = digits(s);
  return d.length === 15 ? `0${d}` : d;
};

const n2 = (d: Dec) => d.toFixed(2);

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly orders: SalesOrdersService,
    private readonly invoicesSvc: InvoicesService,
    private readonly posting: PostingService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly refs: ReferenceRepository,
    private readonly repo: IntegrationsRepository,
  ) {}

  getSettings(tenantId: string) {
    return this.settings.section(this.db, tenantId, 'integrations', DEFAULT_INTEGRATIONS);
  }
  async saveSettings(tenantId: string, dto: IntegrationSettingsDto) {
    const cur = await this.getSettings(tenantId);
    return this.settings.saveSection(this.db, tenantId, 'integrations', DEFAULT_INTEGRATIONS, {
      coretaxUnits: { ...cur.coretaxUnits, ...(dto.coretaxUnits ?? {}) },
    });
  }

  // ===== Coretax =====
  /**
   * Dokumen faktur pajak keluaran dalam periode:
   *  - faktur penjualan ber-PPN; bila sudah dilunasi sebagian dengan uang muka ber-PPN, DPP-nya dikurangi
   *    DPP uang muka (faktur pajak pelunasan, PMK 131/2024 jo. PER-03/PJ/2022)
   *  - uang muka pelanggan ber-PPN (faktur pajak uang muka — PPN terutang saat uang diterima)
   */
  private async coretaxDocs(tenantId: string, from: string, to: string, ids?: string[]) {
    const rows = await this.db.query.invoices.findMany({
      where: and(
        eq(invoices.tenantId, tenantId),
        between(invoices.date, from, to),
        gt(invoices.taxAmount, '0'),
        ids?.length ? inArray(invoices.id, ids) : undefined,
      ),
      with: {
        customer: true,
        lines: { with: { product: { columns: { sku: true, name: true } } } },
        serviceLines: true,
      },
      orderBy: [asc(invoices.date), asc(invoices.number)],
    });
    // Uang muka ber-PPN yang sudah dipakai melunasi faktur
    const apps = rows.length
      ? (
          await this.repo.queryDepositApplication(this.db, tenantId, rows.map((r) => sql`${r.id}`))
        ).rows
      : [];
    const deps = await this.db.query.customerDeposits.findMany({
      where: and(
        eq(customerDeposits.tenantId, tenantId),
        between(customerDeposits.date, from, to),
        gt(customerDeposits.taxAmount, '0'),
        ids?.length ? inArray(customerDeposits.id, ids) : undefined,
      ),
      orderBy: [asc(customerDeposits.date), asc(customerDeposits.number)],
    });
    const depCustomers = deps.length
      ? await this.repo.listCustomersById(this.db, deps)
      : [];

    type Item = { opt: 'A' | 'B'; name: string; uom: string; qty: string; price: string; lineTotal: string; base: Dec };
    type Doc = {
      id: string;
      kind: 'INVOICE' | 'DEPOSIT';
      number: string;
      date: string;
      ref: string;
      customer: typeof customers.$inferSelect;
      subtotal: Dec;
      taxAmount: Dec;
      depositDpp: Dec;
      items: Item[];
    };
    const docs: Doc[] = [];
    for (const inv of rows) {
      const raw = [
        ...inv.lines.map((l) => ({
          opt: 'A' as const,
          name: l.product.name,
          uom: l.uom,
          qty: l.qty,
          price: l.price,
          lineTotal: l.lineTotal,
        })),
        ...inv.serviceLines.map((l) => ({
          opt: 'B' as const,
          name: l.description,
          uom: l.unit,
          qty: l.qty,
          price: l.price,
          lineTotal: l.lineTotal,
        })),
      ];
      const a = apps.find((x) => x.invoice_id === inv.id);
      const depositDpp = D(a?.dpp ?? 0);
      // DPP uang muka dibagi proporsional ke tiap baris; sisa pembulatan ke baris terakhir
      const sub = raw.reduce<Dec>((s, l) => s.plus(l.lineTotal), ZERO);
      let left = depositDpp;
      const items = raw.map((l, i) => {
        const cut = i === raw.length - 1 ? left : sub.gt(0) ? money(depositDpp.times(l.lineTotal).div(sub)) : ZERO;
        left = left.minus(cut);
        return { ...l, base: D(l.lineTotal).minus(cut) };
      });
      docs.push({
        id: inv.id,
        kind: 'INVOICE',
        number: inv.number,
        date: inv.date,
        ref: depositDpp.gt(0) ? `${inv.number} (pelunasan, dikurangi uang muka ${a!.numbers})` : inv.number,
        customer: inv.customer,
        subtotal: D(inv.subtotal).minus(depositDpp),
        taxAmount: D(inv.taxAmount).minus(a?.tax ?? 0),
        depositDpp,
        items,
      });
    }
    for (const d of deps) {
      docs.push({
        id: d.id,
        kind: 'DEPOSIT',
        number: d.number,
        date: d.date,
        ref: `${d.number} (uang muka)`,
        customer: depCustomers.find((c) => c.id === d.customerId)!,
        subtotal: D(d.dpp),
        taxAmount: D(d.taxAmount),
        depositDpp: ZERO,
        items: [
          {
            opt: 'B',
            name: `Uang muka${d.description ? ` — ${d.description}` : ''}`,
            uom: 'UM',
            qty: '1',
            price: d.dpp,
            lineTotal: d.dpp,
            base: D(d.dpp),
          },
        ],
      });
    }
    docs.sort((x, y) => (x.date === y.date ? x.number.localeCompare(y.number) : x.date.localeCompare(y.date)));
    return docs;
  }

  /** Faktur penjualan ber-PPN dalam periode, dengan pemeriksaan kelengkapan data sebelum ekspor */
  async coretaxPreview(tenantId: string, from: string, to: string) {
    const [tenant] = await this.repo.findTenantsById(this.db, tenantId);
    const conf = await this.getSettings(tenantId);
    const docs = await this.coretaxDocs(tenantId, from, to);
    const problems: string[] = [];
    if (tin16(tenant.npwp).length !== 16)
      problems.push('NPWP perusahaan belum diisi lengkap (16 digit) di Pengaturan → Perusahaan.');
    const units = new Set(docs.filter((d) => d.kind === 'INVOICE').flatMap((r) => r.items.map((l) => l.uom)));
    const missingUnits = [...units].filter((u) => !conf.coretaxUnits[u]);
    if (missingUnits.length) problems.push(`Kode satuan Coretax belum diisi untuk: ${missingUnits.join(', ')}.`);
    // Faktur yang pelanggannya masih punya uang muka ber-PPN belum dipakai → DPP pelunasan belum dikurangi
    const open = (
      await this.repo.queryCustomerDeposit(this.db, tenantId, to)
    ).rows.map((r) => r.customer_id);
    const pending = docs.filter((d) => d.kind === 'INVOICE' && open.includes(d.customer.id) && d.depositDpp.isZero());
    const warnings: string[] = [];
    if (pending.length) {
      warnings.push(
        `${pending.map((d) => d.number).join(', ')}: pelanggan masih punya uang muka ber-PPN yang belum dipakai. Bila faktur ini pelunasan, klik "Pakai uang muka" di faktur dulu agar DPP uang muka dikurangkan.`,
      );
    }
    const list = docs.map((r) => ({
      id: r.id,
      kind: r.kind,
      number: r.number,
      date: r.date,
      customer: r.customer.name,
      npwp: r.customer.npwp,
      buyerType: tin16(r.customer.npwp).length === 16 ? 'NPWP' : 'NIK / lainnya',
      subtotal: r.subtotal.toFixed(2),
      taxAmount: r.taxAmount.toFixed(2),
      depositDpp: r.depositDpp.toFixed(2),
      total: r.subtotal.plus(r.taxAmount).toFixed(2),
    }));
    return {
      from,
      to,
      sellerTin: tin16(tenant.npwp),
      ppnRate: tenant.ppnRate,
      count: list.length,
      invoices: list,
      problems,
      warnings,
      missingUnits,
      units: [...units],
    };
  }

  /**
   * XML impor faktur keluaran Coretax (struktur TaxInvoiceBulk sesuai contoh template DJP v1.4).
   * PPN 11% efektif → TrxCode 04, DPP nilai lain = 11/12 × DPP, tarif 12% (PMK 131/2024).
   */
  async coretaxXml(tenantId: string, from: string, to: string, ids?: string[]) {
    const [tenant] = await this.repo.findTenantsById(this.db, tenantId);
    const conf = await this.getSettings(tenantId);
    const sellerTin = tin16(tenant.npwp);
    if (sellerTin.length !== 16)
      throw new BadRequestException(
        'Isi NPWP perusahaan (16 digit) di Pengaturan → Perusahaan sebelum ekspor ke Coretax',
      );
    const docs = await this.coretaxDocs(tenantId, from, to, ids);
    const rate = D(tenant.ppnRate);
    const nilaiLain = rate.equals(11);
    const out: string[] = [];
    out.push('<?xml version="1.0" encoding="utf-8"?>');
    out.push('<TaxInvoiceBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">');
    out.push(`  <TIN>${sellerTin}</TIN>`);
    out.push('  <ListOfTaxInvoice>');
    for (const inv of docs) {
      const c = inv.customer;
      const buyerTin = tin16(c.npwp);
      const hasTin = buyerTin.length === 16;
      out.push('    <TaxInvoice>');
      out.push(`      <TaxInvoiceDate>${inv.date}</TaxInvoiceDate>`);
      out.push('      <TaxInvoiceOpt>Normal</TaxInvoiceOpt>');
      out.push(`      <TrxCode>${nilaiLain ? '04' : '01'}</TrxCode>`);
      out.push('      <AddInfo/>');
      out.push('      <CustomDoc/>');
      out.push(`      <RefDesc>${xml(inv.ref)}</RefDesc>`);
      out.push('      <FacilityStamp/>');
      out.push(`      <SellerIDTKU>${sellerTin}000000</SellerIDTKU>`);
      out.push(`      <BuyerTin>${hasTin ? buyerTin : '0000000000000000'}</BuyerTin>`);
      out.push(`      <BuyerDocument>${hasTin ? 'TIN' : 'Other ID'}</BuyerDocument>`);
      out.push('      <BuyerCountry>IDN</BuyerCountry>');
      out.push(`      <BuyerDocumentNumber>${hasTin ? '' : xml(c.code)}</BuyerDocumentNumber>`);
      out.push(`      <BuyerName>${xml(c.name)}</BuyerName>`);
      out.push(`      <BuyerAdress>${xml(c.address ?? '-')}</BuyerAdress>`);
      out.push('      <BuyerEmail/>');
      out.push(`      <BuyerIDTKU>${hasTin ? `${buyerTin}000000` : '000000'}</BuyerIDTKU>`);
      out.push('      <ListOfGoodService>');
      for (const l of inv.items) {
        const qty = D(l.qty);
        const gross = money(qty.times(l.price));
        const base = l.base;
        // potongan = diskon baris + bagian DPP uang muka (faktur pelunasan)
        const discount = gross.minus(base);
        const other = nilaiLain ? money(base.times(11).div(12)) : base;
        const vatRate = nilaiLain ? D(12) : rate;
        const vat = money(other.times(vatRate).div(100));
        out.push('        <GoodService>');
        out.push(`          <Opt>${l.opt}</Opt>`);
        out.push('          <Code>000000</Code>');
        out.push(`          <Name>${xml(l.name)}</Name>`);
        out.push(`          <Unit>${xml(conf.coretaxUnits[l.uom] ?? l.uom)}</Unit>`);
        out.push(`          <Price>${n2(D(l.price))}</Price>`);
        out.push(`          <Qty>${qty.toFixed(2)}</Qty>`);
        out.push(`          <TotalDiscount>${n2(discount.gt(0) ? discount : ZERO)}</TotalDiscount>`);
        out.push(`          <TaxBase>${n2(base)}</TaxBase>`);
        out.push(`          <OtherTaxBase>${n2(other)}</OtherTaxBase>`);
        out.push(`          <VATRate>${vatRate.toFixed(0)}</VATRate>`);
        out.push(`          <VAT>${n2(vat)}</VAT>`);
        out.push('          <STLGRate>0</STLGRate>');
        out.push('          <STLG>0</STLG>');
        out.push('        </GoodService>');
      }
      out.push('      </ListOfGoodService>');
      out.push('    </TaxInvoice>');
    }
    out.push('  </ListOfTaxInvoice>');
    out.push('</TaxInvoiceBulk>');
    return out.join('\n');
  }

  // ===== Marketplace =====
  private async channelCustomer(tenantId: string, channel: string) {
    const conf = await this.getSettings(tenantId);
    const id = conf.marketplaceCustomers[channel];
    if (id) {
      const c = await this.refs.customer(this.db, tenantId, id);
      if (c) return c;
    }
    const code = `MP-${channel.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)}`;
    let [c] = await this.repo.findCustomersByCode(this.db, tenantId, code);
    if (!c) {
      [c] = await this.repo.insertCustomers(this.db, tenantId, code, channel);
    }
    await this.settings.saveSection(this.db, tenantId, 'integrations', DEFAULT_INTEGRATIONS, {
      marketplaceCustomers: { ...conf.marketplaceCustomers, [channel]: c.id },
    });
    return c;
  }

  /**
   * Impor pesanan marketplace: tiap pesanan → Sales Order → faktur (stok keluar, HPP, PPN keluaran, piutang ke marketplace).
   * Pesanan yang sudah pernah diimpor dilewati.
   */
  async importMarketplace(user: AuthUser, dto: MarketplaceImportDto) {
    const channel = dto.channel.trim();
    const wh = await this.refs.warehouse(this.db, user.tenantId, dto.warehouseId);
    if (!wh) throw new BadRequestException('Gudang tidak ditemukan');
    const customer = await this.channelCustomer(user.tenantId, channel);
    const [tenant] = await this.repo.findTenantsByIdForImportMarketplace(this.db, user.tenantId);
    const prods = await this.repo.listProducts(this.db, user.tenantId);
    const bySku = new Map(prods.map((p) => [p.sku.toUpperCase(), p]));
    const already = new Set(
      (
        await this.repo.listMarketplaceOrdersByChannel(this.db, user.tenantId, channel)
      ).map((r) => r.orderNo),
    );
    const divisor = dto.pricesIncludeVat === false ? D(1) : D(1).plus(D(tenant.ppnRate).div(100));
    const result = { imported: [] as { orderNo: string; invoice: string; total: string }[], skipped: [] as { orderNo: string; reason: string }[] };

    for (const o of [...dto.orders].sort((a, b) => a.date.localeCompare(b.date))) {
      const orderNo = o.orderNo.trim();
      if (already.has(orderNo)) {
        result.skipped.push({ orderNo, reason: 'Sudah pernah diimpor' });
        continue;
      }
      const missing = o.lines.filter((l) => !bySku.has(l.sku.trim().toUpperCase()));
      if (missing.length) {
        result.skipped.push({ orderNo, reason: `SKU tidak dikenal: ${missing.map((m) => m.sku).join(', ')}` });
        continue;
      }
      try {
        const date = toDocDate(o.date);
        const so = await this.orders.create(user, {
          customerId: customer.id,
          warehouseId: wh.id,
          date,
          notes: `${channel} #${orderNo}`,
          // harga sudah final di platform: tanpa promo/bonus tambahan
          applyPromos: false,
          lines: o.lines.map((l) => ({
            productId: bySku.get(l.sku.trim().toUpperCase())!.id,
            qty: l.qty,
            price: money(D(l.price).div(divisor)).toFixed(2),
          })),
        });
        // Pesanan marketplace sudah dibayar pembeli ke platform → tanpa cek limit kredit
        await this.repo.updateSalesOrdersByIdAndStatus(this.db, so.id);
        const inv = await this.invoicesSvc.createFromOrder(user, { salesOrderId: so.id, date });
        await this.repo.insertMarketplaceOrders(this.db, user.tenantId, channel, orderNo, date, inv.id, inv.total);
        already.add(orderNo);
        result.imported.push({ orderNo, invoice: inv.number, total: inv.total });
      } catch (e) {
        result.skipped.push({ orderNo, reason: (e as Error).message });
      }
    }
    return result;
  }

  async marketplaceOrders(tenantId: string, channel?: string) {
    return this.repo.listMarketplaceOrdersWithInvoicesByChannelAndDateAndOrderNo(this.db, tenantId, channel);
  }

  async channels(tenantId: string) {
    const r = await this.repo.queryMarketplaceOrder(this.db, tenantId);
    return r.rows;
  }

  /**
   * Pencairan dana marketplace: satu jurnal
   *  Dr Bank (dana diterima) · Dr Beban komisi/biaya marketplace (selisih) | Cr Piutang Usaha (faktur yang dilunasi)
   */
  async settle(user: AuthUser, dto: MarketplaceSettleDto) {
    const channel = dto.channel.trim();
    const date = toDocDate(dto.date);
    const received = money(dto.amount);
    if (received.lte(0)) throw new BadRequestException('Dana diterima harus > 0');
    return this.db.transaction(async (tx) => {
      const bank = await this.posting.resolveCashAccount(tx, user.tenantId, dto.cashAccountId, 'BANK');
      const open = await this.repo.listMarketplaceOrdersWithInvoicesByChannelAndOrderNo(tx, user.tenantId, channel, date, dto);
      // Tanpa daftar pesanan: lunasi faktur terlama sampai dana (+ perkiraan biaya maks. 30%) habis
      const picked: typeof open = [];
      let gross: Dec = ZERO;
      for (const r of open) {
        const out = D(r.inv.total).minus(r.inv.paidAmount).minus(r.inv.returnedAmount);
        if (out.lte(0)) continue;
        if (!dto.orderNos?.length && gross.gte(received)) break;
        picked.push(r);
        gross = gross.plus(out);
      }
      if (!picked.length) throw new BadRequestException(`Tidak ada faktur ${channel} yang belum lunas sampai ${date}`);
      if (received.gt(gross)) throw new BadRequestException(`Dana ${received.toFixed(0)} melebihi tagihan terbuka ${gross.toFixed(0)}`);
      const fee = gross.minus(received);
      if (fee.gt(gross.times(0.3))) throw new BadRequestException('Potongan marketplace lebih dari 30% — periksa kembali pesanan yang dicairkan');

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Pencairan dana ${channel} (${picked.length} pesanan)`,
        sourceType: 'PAYMENT',
        reference: `Payout ${channel}`,
        createdById: user.sub,
        lines: [
          { accountId: bank.id, debit: received },
          { key: SYS.MARKETPLACE_FEE, debit: fee, memo: `Biaya & komisi ${channel}` },
          { key: SYS.AR, credit: gross },
        ],
      });
      for (const r of picked) {
        const out = D(r.inv.total).minus(r.inv.paidAmount).minus(r.inv.returnedAmount);
        const number = await this.seq.next(tx, user.tenantId, 'PAYMENT', date);
        await this.repo.insertPayments(tx, user.tenantId, number, date, r.inv.customerId, r.inv.id, out, bank.id, channel, r.orderNo, journal.id);
        await patchById(tx, invoices, r.inv.id, { paidAmount: D(r.inv.paidAmount).plus(out).toFixed(2), status: 'PAID' });
      }
      await this.audit.log(tx, { tenantId: user.tenantId, userId: user.sub, action: 'SETTLE', entity: 'Marketplace', entityId: journal.id, data: { channel, orders: picked.length, journal: journal.number } });
      return { journalNumber: journal.number, orders: picked.length, gross: gross.toFixed(2), fee: fee.toFixed(2), received: received.toFixed(2) };
    });
  }
}

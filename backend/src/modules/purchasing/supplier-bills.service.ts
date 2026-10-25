import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService, taxProfileOf } from '../../common/settings.service';
import { lineTotal, roundVat } from '../sales/pricing';
import { addDays, toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, purchaseInvoiceLines, purchaseInvoices, projects, tenants } from '../../db/schema';
import { AssetsService } from '../assets/assets.service';
import { SYS } from '../accounting/default-coa';
import { BudgetService } from '../accounting/budget.service';
import { PostingService } from '../accounting/posting.service';
import { CreateBillDto } from './purchasing.dto';
import { PurchaseInvoiceRepository } from './purchase-invoice.repository';
import { PurchaseInvoicesService, assetUnitCount } from './purchase-invoices.service';
import { insertOne, patchById } from '../../db/owned';
import { SupplierBillsRepository } from './supplier-bills.repository';

@Injectable()
export class SupplierBillsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly seq: SequenceService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
    private readonly settings: SettingsService,
    private readonly budget: BudgetService,
    private readonly repo: PurchaseInvoiceRepository,
    private readonly invoices: PurchaseInvoicesService,
    private readonly queries: SupplierBillsRepository,
  ) {}

  async createBill(user: AuthUser, dto: CreateBillDto, opts: { approved?: boolean } = {}) {
    const date = toDocDate(dto.date);
    // Anggaran: baris biaya yang membuat realisasi melewati anggaran (aset dikecualikan)
    await this.budget.guard(
      user,
      dto.lines
        .filter((l) => l.type !== 'ASSET' && l.accountId)
        .map((l) => ({ accountId: l.accountId!, amount: money(D(l.qty ?? '1').times(l.price)), date })),
      {
        kind: 'BILL',
        title: `Tagihan ${dto.supplierInvoiceNo}`,
        payload: JSON.parse(JSON.stringify(dto)),
        approved: opts.approved,
        overrideReason: dto.budgetOverrideReason,
      },
    );
    const result = await this.db.transaction(async (tx) => {
      const supplier = await this.repo.supplierOfTenant(tx, user.tenantId, dto.supplierId);
      if (!supplier) throw new NotFoundException('Supplier tidak ditemukan');
      const [tenant] = await this.queries.findTenantsById(tx, user.tenantId);
      const pkp = taxProfileOf(tenant.settings).pkp;
      if (dto.projectId) {
        const [p] = await this.queries.findProjectsById(tx, dto.projectId, user.tenantId);
        if (!p) throw new BadRequestException('Proyek tidak ditemukan');
      }

      type Line = { dto: (typeof dto.lines)[number]; qty: Dec; total: Dec; debitAccountId: string; exempt: boolean };
      const lines: Line[] = [];
      for (const l of dto.lines) {
        const q = D(l.qty ?? '1');
        const price = money(l.price);
        if (q.lte(0) || price.lte(0))
          throw new BadRequestException(`Jumlah & harga baris "${l.description}" harus > 0`);
        let debitAccountId: string;
        let exempt = false;
        if (l.type === 'ASSET') {
          if (!l.assetCategoryId) throw new BadRequestException(`Pilih kategori aset untuk "${l.description}"`);
          const cat = await this.assets.category(user.tenantId, l.assetCategoryId, tx);
          if (!cat) throw new BadRequestException('Kategori aset tidak ditemukan');
          debitAccountId = cat.assetAccountId;
          exempt = this.assets.isThresholdExempt(cat);
        } else {
          if (!l.accountId) throw new BadRequestException(`Pilih akun untuk "${l.description}"`);
          const acc = await this.repo.accountOfTenant(tx, user.tenantId, l.accountId);
          if (!acc || !acc.isPostable) throw new BadRequestException(`Akun untuk "${l.description}" tidak valid`);
          if (acc.isCashAccount) throw new BadRequestException('Akun kas/bank tidak bisa dipakai di baris tagihan');
          debitAccountId = acc.id;
        }
        lines.push({ dto: l, qty: q, total: money(q.times(price)), debitAccountId, exempt });
      }
      const subtotal = lines.reduce<Dec>((a, l) => a.plus(l.total), ZERO);
      const tax =
        dto.withVat === false
          ? ZERO
          : roundVat(money(subtotal.times(tenant.ppnRate).div(100)), taxProfileOf(tenant.settings).vatRounding);
      const whBase = lines
        .filter((l) => l.dto.withholding ?? l.dto.type === 'EXPENSE')
        .reduce<Dec>((a, l) => a.plus(l.total), ZERO);
      const whRate = dto.withholdingType
        ? D(dto.withholdingRate ?? (dto.withholdingType === 'PPH23' ? '2' : '10'))
        : ZERO;
      const withholding = money(whBase.times(whRate).div(100));
      const total = subtotal.plus(tax).minus(withholding);
      // Non-PKP: PPN dibagi ke tiap baris (biaya / harga perolehan aset), sisa pembulatan ke baris terakhir
      const capitalize = !pkp && tax.gt(0);
      const costs = lines.map((l) => l.total);
      if (capitalize) {
        let left = tax;
        lines.forEach((l, i) => {
          const share = i === lines.length - 1 ? left : money(tax.times(l.total).div(subtotal));
          costs[i] = l.total.plus(share);
          left = left.minus(share);
        });
      }

      // Batas kapitalisasi: harga perolehan per unit (sudah termasuk PPN yang tidak dapat dikreditkan)
      // di bawah batas → langsung beban, tidak didaftarkan sebagai aset
      const { capitalizationThreshold: threshold } = await this.settings.reporting(tx, user.tenantId);
      const expensed = lines.map(
        (l, i) =>
          l.dto.type === 'ASSET' && !l.exempt && threshold > 0 && costs[i].div(assetUnitCount(l.qty)).lt(threshold),
      );
      let smallAssetAccountId: string | undefined;
      if (expensed.some(Boolean)) {
        const [small] = await this.queries.findAccountsBySystemKey(tx, user.tenantId);
        if (!small) throw new BadRequestException('Akun "Beban Peralatan Kecil" belum ada di bagan akun');
        smallAssetAccountId = small.id;
      }

      const number = await this.seq.next(tx, user.tenantId, 'PURCHASE_INVOICE', date);
      const invoice = await insertOne(tx, purchaseInvoices, {
          tenantId: user.tenantId,
          number,
          kind: 'BILL',
          supplierInvoiceNo: dto.supplierInvoiceNo.trim(),
          date,
          dueDate: dto.dueDate ? toDocDate(dto.dueDate) : addDays(date, supplier.paymentTermDays),
          supplierId: supplier.id,
          description: dto.description,
          subtotal: subtotal.toFixed(2),
          taxAmount: tax.toFixed(2),
          withholdingType: withholding.gt(0) ? dto.withholdingType : null,
          withholdingAmount: withholding.toFixed(2),
          withholdingBase: withholding.gt(0) ? whBase.toFixed(2) : '0',
          withholdingRate: withholding.gt(0) ? whRate.toFixed(2) : null,
          total: total.toFixed(2),
          vatCapitalized: capitalize,
          projectId: dto.projectId,
        });

      const journal = await this.posting.post(tx, {
        tenantId: user.tenantId,
        date,
        description: `Tagihan ${number} (${dto.supplierInvoiceNo}) - ${supplier.name}${dto.description ? ` · ${dto.description}` : ''}`,
        sourceType: 'PURCHASE_INVOICE',
        sourceId: invoice.id,
        reference: dto.supplierInvoiceNo,
        createdById: user.sub,
        branchId: dto.branchId,
        lines: [
          ...lines.map((l, i) =>
            expensed[i]
              ? {
                  accountId: smallAssetAccountId,
                  debit: costs[i],
                  memo: `${l.dto.description} (di bawah batas kapitalisasi, dibebankan)`,
                }
              : { accountId: l.debitAccountId, debit: costs[i], memo: l.dto.description },
          ),
          { key: SYS.VAT_IN, debit: capitalize ? 0 : tax },
          { key: SYS.AP, credit: total },
          { key: dto.withholdingType === 'PPH4_2' ? SYS.PPH4_2_PAYABLE : SYS.PPH23_PAYABLE, credit: withholding },
        ],
      });

      const assetNotices: { name: string; cost: Dec }[] = [];
      for (const [idx, l] of lines.entries()) {
        let assetId: string | undefined;
        if (l.dto.type === 'ASSET' && !expensed[idx]) {
          // Satu aset per unit agar penyusutan & pelepasannya bisa per barang
          const lineCost = costs[idx];
          const n = assetUnitCount(l.qty);
          assetNotices.push({ name: l.dto.description, cost: lineCost });
          const unitCost = n > 1 ? money(lineCost.div(n)) : lineCost;
          for (let i = 0; i < n; i++) {
            const cost = i === n - 1 ? lineCost.minus(unitCost.times(n - 1)) : unitCost;
            const asset = await this.assets.registerFromPurchase(tx, user.tenantId, {
              categoryId: l.dto.assetCategoryId!,
              name: n > 1 ? `${l.dto.description} (${i + 1}/${n})` : l.dto.description,
              date,
              cost,
              usefulLifeMonths: l.dto.usefulLifeMonths,
              location: l.dto.location,
              totalUnits: l.dto.totalUnits,
              unitLabel: l.dto.unitLabel,
              journalId: journal.id,
              purchaseInvoiceId: invoice.id,
              notes: `Dibeli dari ${supplier.name}, faktur ${dto.supplierInvoiceNo}`,
              branchId: dto.branchId ?? null,
            });
            assetId ??= asset.id;
          }
        }
        await tx.insert(purchaseInvoiceLines).values({
          invoiceId: invoice.id,
          lineType: l.dto.type,
          accountId: l.dto.type === 'EXPENSE' ? l.debitAccountId : expensed[idx] ? smallAssetAccountId : null,
          assetCategoryId: l.dto.assetCategoryId,
          assetId,
          description: l.dto.description,
          uom: 'UNIT',
          uomFactor: '1',
          qty: l.qty.toFixed(4),
          price: money(l.dto.price).toFixed(2),
          lineTotal: l.total.toFixed(2),
          unitCost: '0',
        });
      }
      await patchById(tx, purchaseInvoices, invoice.id, { journalId: journal.id });
      await this.audit.log(tx, {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entity: 'PurchaseBill',
        entityId: invoice.id,
        data: { number, journal: journal.number },
      });
      return {
        id: invoice.id,
        journalNumber: journal.number,
        expensedLines: expensed.filter(Boolean).length,
        assetNotices,
        supplierName: supplier.name,
      };
    });
    for (const n of result.assetNotices)
      this.assets.notifyAcquisition(user, n.name, n.cost, `dibeli dari ${result.supplierName} (faktur pembelian)`);
    return {
      ...(await this.invoices.get(user.tenantId, result.id)),
      journalNumber: result.journalNumber,
      expensedLines: result.expensedLines,
    };
  }
}

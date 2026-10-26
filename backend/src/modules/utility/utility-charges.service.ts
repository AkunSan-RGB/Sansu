import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DEFAULT_NON_AIR_CHARGES, REVENUE_KEY_LABELS } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { addDays, todayJakarta } from '../../common/utils/dates';
import { D, money } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import type { SystemKey } from '../accounting/default-coa';
import { PostingService } from '../accounting/posting.service';
import { ServiceBillingService } from '../sales/services/service-billing.service';
import { ChargeDto, IssueChargeDto } from './utility-charges.dto';
import { UtilityChargesRepository } from './utility-charges.repository';
import { UtilityService } from './utility.service';

/**
 * Layanan non-air yang ditagihkan di luar tagihan bulanan: sambung baru, sambung kembali, penggantian meter, administrasi, dan seterusnya.
 * Tiap layanan dicatat ke akun pendapatan non-air-nya sendiri, sehingga laporan memisahkan pendapatan air dari non-air.
 */
@Injectable()
export class UtilityChargesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: UtilityChargesRepository,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly billing: ServiceBillingService,
    private readonly util: UtilityService,
  ) {}

  /** Katalog perusahaan; perusahaan baru otomatis mendapat daftar layanan non-air bawaan (harga dapat diubah) */
  async list(tenantId: string) {
    let rows = await this.repo.list(this.db, tenantId);
    if (!rows.length) {
      await this.repo.insert(this.db, DEFAULT_NON_AIR_CHARGES.map((c) => ({ tenantId, name: c.name, defaultPrice: c.price.toFixed(2), revenueKey: c.revenueKey })));
      rows = await this.repo.list(this.db, tenantId);
    }
    return rows.map((r) => ({ ...r, revenueLabel: REVENUE_KEY_LABELS[r.revenueKey] ?? r.revenueKey }));
  }

  async save(u: AuthUser, dto: ChargeDto, id?: string) {
    const price = money(dto.defaultPrice);
    if (price.isNegative()) throw new BadRequestException('Harga tidak boleh negatif');
    const set = { name: dto.name.trim(), defaultPrice: price.toFixed(2), revenueKey: dto.revenueKey, vatable: !!dto.vatable, ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }) };
    try {
      const [row] = id ? await this.repo.update(this.db, u.tenantId, id, set) : await this.repo.insert(this.db, [{ tenantId: u.tenantId, ...set }]);
      if (!row) throw new NotFoundException(id ? 'Layanan tidak ditemukan' : 'Nama layanan sudah dipakai');
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: id ? 'UPDATE' : 'CREATE', entity: 'UtilityCharge', entityId: row.id, data: set });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new BadRequestException('Nama layanan sudah dipakai');
      throw e;
    }
  }

  /** Terbitkan tagihan layanan non-air untuk satu pelanggan: faktur biasa dengan baris di akun pendapatan non-air layanan itu */
  async issue(u: AuthUser, dto: IssueChargeDto) {
    const [charge] = await this.repo.byId(this.db, u.tenantId, dto.chargeId);
    if (!charge || !charge.isActive) throw new BadRequestException('Layanan tidak ditemukan atau nonaktif');
    const qty = D(dto.qty ?? 1);
    const price = D(dto.price ?? charge.defaultPrice);
    if (qty.lte(0) || price.lte(0)) throw new BadRequestException('Jumlah dan harga harus lebih dari 0');
    await this.posting.ensureSystemAccounts(this.db, u.tenantId, [charge.revenueKey as SystemKey]);
    const [acct] = await this.repo.accountByKey(this.db, u.tenantId, charge.revenueKey);
    if (!acct) throw new BadRequestException('Akun pendapatan layanan ini belum tersedia');
    const rules = await this.util.rules(u.tenantId);
    const today = todayJakarta();
    const conn = dto.connectionId ? await this.util.connection(u.tenantId, dto.connectionId) : null;
    const invoice = await this.billing.createInvoice(u, {
      customerId: dto.customerId,
      date: today,
      dueDate: addDays(today, rules.dueDays),
      description: `${charge.name}${conn ? ` — sambungan ${(conn as { number?: string }).number ?? ''}` : ''}${dto.notes ? ` (${dto.notes})` : ''}`,
      withVat: charge.vatable ? undefined : false,
      lines: [{ description: charge.name, qty: qty.toString(), unit: 'Paket', price: price.toFixed(2), accountId: acct.id }],
    });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityChargeInvoice', entityId: invoice.id, data: { charge: charge.name, invoice: invoice.number, amount: qty.times(price).toFixed(2) } });
    return { invoiceId: invoice.id, invoiceNumber: invoice.number, amount: qty.times(price).toFixed(2) };
  }
}

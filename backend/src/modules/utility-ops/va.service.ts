import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { PaymentsService } from '../sales/payments/payments.service';
import { VaApplyDto, VaPaymentDto, VaSettingsDto } from './va.dto';
import { VaRepository, VaRow } from './va.repository';

const SECTION = 'utilityVa';
const DEFAULTS = { prefix: '8808', bankName: '' };
const cents = (v: string | number) => Math.round(Number(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

/**
 * Pembayaran virtual account: nomor VA = kode perusahaan (dari bank) + 8 digit urut tetap per sambungan.
 * Pembayaran masuk (webhook) dilunasi otomatis ke tagihan air tertua; kelebihan dan nomor tak dikenal ditahan untuk diputuskan Keuangan.
 */
@Injectable()
export class VaService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: VaRepository,
    private readonly payments: PaymentsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  getSettings(tenantId: string) { return this.settings.section(this.db, tenantId, SECTION, DEFAULTS); }
  async saveSettings(u: AuthUser, dto: VaSettingsDto) {
    const before = await this.getSettings(u.tenantId);
    const next = { ...before, ...(Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<typeof DEFAULTS>) };
    const saved = await this.settings.saveSection(this.db, u.tenantId, SECTION, DEFAULTS, next);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityVaSettings', entityId: u.tenantId, data: { before, after: saved } });
    return saved;
  }

  async numberOf(tenantId: string, connectionId: string) {
    const [c, s] = await Promise.all([this.repo.connectionById(this.db, tenantId, connectionId), this.getSettings(tenantId)]);
    if (!c) throw new NotFoundException('Sambungan tidak ditemukan');
    return { connection: c.number, vaNumber: c.va_suffix ? `${s.prefix}${c.va_suffix}` : null, bankName: s.bankName };
  }

  list(tenantId: string, status?: string) { return this.repo.list(this.db, tenantId, status || undefined); }
  async summary(tenantId: string) {
    const rows = await this.repo.summary(this.db, tenantId);
    const by = (s: string) => rows.find((r) => r.status === s);
    return { received: rows.reduce((a, r) => a + r.n, 0), receivedAmount: rows.reduce((a, r) => a + Number(r.amount), 0), unmatched: by('TAK_COCOK')?.n ?? 0, unmatchedAmount: Number(by('TAK_COCOK')?.amount ?? 0), excess: by('KELEBIHAN')?.n ?? 0, excessAmount: Number(by('KELEBIHAN')?.unapplied ?? 0), partial: by('SEBAGIAN')?.n ?? 0 };
  }

  /** Pembayaran masuk dari webhook. Aman dikirim ulang: referensi yang sama mengembalikan hasil sebelumnya. */
  async receive(u: AuthUser, dto: VaPaymentDto) {
    const amount = cents(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('Jumlah pembayaran harus lebih dari 0');
    const reference = dto.reference.trim();
    const dup = await this.repo.byReference(this.db, u.tenantId, reference);
    if (dup) return { duplicate: true, id: dup.id, status: dup.status, applied: dup.applied, unapplied: dup.unapplied, payments: dup.payment_numbers };
    const s = await this.getSettings(u.tenantId);
    const digits = dto.vaNumber.replace(/\D/g, '');
    const suffix = s.prefix && digits.startsWith(s.prefix) ? digits.slice(s.prefix.length) : digits;
    const conn = await this.repo.connectionBySuffix(this.db, u.tenantId, suffix);
    let id: string;
    try {
      id = await this.repo.insert(this.db, { tenantId: u.tenantId, reference, vaNumber: digits, connectionId: conn?.id ?? null, amount: fromCents(amount), paidAt: dto.paidAt ?? new Date().toISOString(), channel: dto.channel?.trim() || null, status: conn ? 'DITERIMA' : 'TAK_COCOK', unapplied: fromCents(amount), message: conn ? null : 'Nomor virtual account tidak dikenal; cocokkan ke sambungan secara manual' });
    } catch (e) {
      const code = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
      if (code === '23505') { const again = await this.repo.byReference(this.db, u.tenantId, reference); if (again) return { duplicate: true, id: again.id, status: again.status, applied: again.applied, unapplied: again.unapplied, payments: again.payment_numbers }; }
      throw e;
    }
    if (!conn) return { duplicate: false, id, status: 'TAK_COCOK', applied: '0.00', unapplied: fromCents(amount), payments: [] as string[] };
    const row = await this.apply(u, id, conn.id, amount, dto.paidAt, dto.channel ?? 'VA');
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityVaPayment', entityId: id, data: { reference, amount: fromCents(amount), connection: conn.number, status: row.status } });
    return { duplicate: false, id, status: row.status, applied: row.applied, unapplied: row.unapplied, payments: row.payment_numbers };
  }

  /** Lunasi tagihan air tertua sambungan itu dengan dana yang belum teralokasi */
  private async apply(u: AuthUser, id: string, connectionId: string, unappliedCents: number, paidAt: string | undefined, channel: string, handledBy?: string): Promise<VaRow> {
    const open = await this.repo.openInvoices(this.db, u.tenantId, connectionId);
    const before = await this.repo.byId(this.db, u.tenantId, id);
    let left = unappliedCents;
    let applied = cents(before?.applied ?? 0);
    const numbers = [...(before?.payment_numbers ?? [])];
    let message: string | null = null;
    for (const inv of open) {
      if (left <= 0) break;
      const pay = Math.min(left, cents(inv.outstanding));
      if (pay <= 0) continue;
      try {
        const p = await this.payments.create(u, { invoiceId: inv.id, amount: fromCents(pay), method: 'TRANSFER', date: paidAt ? paidAt.slice(0, 10) : undefined, notes: `Virtual account ${before?.reference ?? ''}` }, {
          approved: true, // uang sudah masuk rekening; bukan keputusan petugas
          inTx: async (tx, payment) => {
            await this.repo.insertReceipt(tx, { tenantId: u.tenantId, paymentId: payment.id, invoiceId: inv.id, collectorId: u.sub, amount: fromCents(pay) });
          },
        });
        numbers.push(p.number);
        applied += pay;
        left -= pay;
      } catch (e) {
        message = `Sebagian belum teralokasi: ${(e as Error).message}`;
        break;
      }
    }
    const status = message ? 'SEBAGIAN' : left <= 0 ? 'DITERAPKAN' : 'KELEBIHAN';
    if (!message && left > 0) message = open.length ? 'Dana melebihi seluruh tagihan terbuka; kelebihan menunggu keputusan Keuangan (deposit atau pengembalian)' : 'Tidak ada tagihan terbuka; dana menunggu keputusan Keuangan (deposit atau pengembalian)';
    await this.repo.update(this.db, id, { connectionId, status, applied: fromCents(applied), unapplied: fromCents(left), paymentNumbers: numbers, message, handledById: handledBy });
    void channel;
    return (await this.repo.byId(this.db, u.tenantId, id))!;
  }

  /** Terapkan lagi dana yang tertahan (nomor tak dikenal, tagihan baru terbit, atau gagal sebagian), oleh Keuangan/Admin */
  async reapply(u: AuthUser, id: string, dto: VaApplyDto) {
    const p = await this.repo.byId(this.db, u.tenantId, id);
    if (!p) throw new NotFoundException('Pembayaran VA tidak ditemukan');
    if (cents(p.unapplied) <= 0) throw new BadRequestException('Seluruh dana sudah teralokasi');
    const connectionId = p.connection_id ?? dto.connectionId;
    if (!connectionId) throw new BadRequestException('Pilih sambungan untuk pembayaran yang nomornya tidak dikenal');
    if (!(await this.repo.connectionById(this.db, u.tenantId, connectionId))) throw new BadRequestException('Sambungan tidak ditemukan');
    const row = await this.apply(u, id, connectionId, cents(p.unapplied), p.paid_at, 'VA', u.sub);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityVaPayment', entityId: id, data: { status: row.status, applied: row.applied } });
    return row;
  }
}

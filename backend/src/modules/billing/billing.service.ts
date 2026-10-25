import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { withRlsBypass } from '../../db/db-scope';
import { AuthUser } from '../../common/auth/auth-user';
import { platformAdminEmails } from '../../common/auth/platform-admin';
import { AuditService } from '../../common/audit/audit.service';
import { SubscriptionService } from '../../common/billing/subscription.service';
import { appUrl, MailService } from '../../common/mail/mail.service';
import { Db, DbOrTx } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { billingInvoices, plans, users } from '../../db/schema';
import { activeGateway, midtrans, xendit, type PaymentNotice } from './gateways';
import { CreateBillingInvoiceDto, ProofDto } from './billing.dto';
import { findOwned, insertOne, patchById } from '../../db/owned';
import { BillingRepository } from './billing.repository';

export const DAY = 86_400_000;

const rupiah = (n: number | string) => `Rp${Math.round(Number(n)).toLocaleString('id-ID')}`;

const tgl = (d: Date | string) =>
  new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

const CYCLE_LABEL = { MONTHLY: '1 bulan', YEARLY: '1 tahun' } as const;

/** Tambah n bulan, tanggal dijepit ke akhir bulan (31 Jan + 1 bln = 28/29 Feb) */
export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger('Langganan');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly subs: SubscriptionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly repo: BillingRepository,
  ) {}

  get database() {
    return this.db;
  }

  /** Kontak dukungan untuk Pusat Bantuan (semua pengguna) */
  async support() {
    const s = await this.subs.settings();
    return {
      whatsapp: s.supportWhatsapp || '',
      email: process.env.SUPPORT_EMAIL || platformAdminEmails()[0] || '',
      company: s.sellerName,
    };
  }

  /** Email pemilik & admin aktif perusahaan */
  private async ownerEmails(tenantId: string, db: DbOrTx = this.db) {
    const rows = await this.repo.listUsersByIsActiveAndRoleAndCreatedAt(db, tenantId);
    return rows;
  }

  async notifyOwners(
    tenantId: string,
    subject: string,
    heading: string,
    paragraphs: string[],
    action?: { label: string; url: string },
  ) {
    for (const o of await this.ownerEmails(tenantId)) {
      await this.mail.send({ to: o.email, subject, heading, paragraphs: [`Halo ${o.name},`, ...paragraphs], action });
    }
  }

  private async nextNumber(tx: DbOrTx) {
    await this.repo.queryNextNumber(tx);
    const now = new Date();
    const prefix = `SNS/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/`;
    // nomor tagihan berurut GLOBAL lintas perusahaan: hitung tanpa penyaringan perusahaan (pengecualian RLS yang disengaja)
    const [r] = await withRlsBypass(tx, () =>
      this.repo.countBillingInvoicesByNumber(tx, prefix),
    );
    return `${prefix}${String(r.n + 1).padStart(4, '0')}`;
  }

  // ===== Sisi pelanggan =====
  async overview(u: AuthUser) {
    const [state, usage, settings, planRows, invoices] = await Promise.all([
      this.subs.state(u.tenantId, true),
      this.subs.usage(u.tenantId),
      this.subs.settings(),
      this.repo.listPlansByIsActiveAndSortOrderAndPriceMonthly(this.db),
      this.repo.listBillingInvoicesWithPlansByCreatedAt(this.db, u.tenantId),
    ]);
    return {
      subscription: state,
      usage,
      plans: planRows,
      invoices,
      payment: {
        gateway: activeGateway(),
        bank: settings.bankAccount
          ? { name: settings.bankName, account: settings.bankAccount, holder: settings.bankHolder }
          : null,
        supportWhatsapp: settings.supportWhatsapp,
      },
    };
  }

  /** Buat tagihan untuk paket & siklus pilihan (tagihan lama yang belum dibayar dibatalkan) */
  async createInvoice(u: AuthUser, dto: CreateBillingInvoiceDto, opts: { auto?: boolean } = {}) {
    if (!(await this.subs.settings()).enabled) throw new BadRequestException('Langganan belum diaktifkan (masih tahap uji). Tidak ada tagihan yang perlu dibayar.');
    const [plan] = await this.repo.findPlansByIdAndIsActive(this.db, dto.planId);
    if (!plan) throw new BadRequestException('Paket tidak ditemukan');
    const usage = await this.subs.usage(u.tenantId);
    if (plan.maxUsers != null && usage.users > plan.maxUsers) {
      throw new BadRequestException(
        `Paket ${plan.name} maksimal ${plan.maxUsers} pengguna aktif, saat ini ada ${usage.users}. Nonaktifkan sebagian pengguna atau pilih paket lebih besar.`,
      );
    }
    if (plan.maxWarehouses != null && usage.warehouses > plan.maxWarehouses) {
      throw new BadRequestException(
        `Paket ${plan.name} maksimal ${plan.maxWarehouses} gudang, saat ini ada ${usage.warehouses}. Pilih paket lebih besar.`,
      );
    }
    const subtotal = Number(dto.cycle === 'YEARLY' ? plan.priceYearly : plan.priceMonthly);
    const bs = await this.subs.settings();
    const vatRate = bs.vatEnabled ? Number(bs.vatRate) : 0;
    const vatAmount = Math.round((subtotal * vatRate) / 100);
    const amount = (subtotal + vatAmount).toFixed(2);
    const inv = await this.db.transaction(async (tx) => {
      await this.repo.updateBillingInvoicesByStatus(tx, u.tenantId);
      const row = await insertOne(tx, billingInvoices, {
          tenantId: u.tenantId,
          number: await this.nextNumber(tx),
          planId: plan.id,
          cycle: dto.cycle,
          subtotal: subtotal.toFixed(2),
          vatRate: vatRate.toFixed(2),
          vatAmount: vatAmount.toFixed(2),
          amount,
          dueDate: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10),
          createdBy: opts.auto ? null : u.sub,
        });
      return row;
    });
    const st = await this.subs.state(u.tenantId, true);
    await this.notifyOwners(
      u.tenantId,
      `Tagihan SANSU ${inv.number}`,
      opts.auto ? 'Tagihan perpanjangan langganan' : 'Tagihan langganan dibuat',
      [
        `Tagihan ${inv.number} untuk paket ${plan.name} (${CYCLE_LABEL[dto.cycle]}) sebesar ${rupiah(amount)}${vatAmount ? ` (termasuk PPN ${rupiah(vatAmount)})` : ''}.`,
        st.endsAt
          ? `Masa aktif Anda saat ini sampai ${tgl(st.endsAt)}. Pembayaran akan memperpanjang dari tanggal tersebut.`
          : 'Pembayaran akan langsung mengaktifkan paket.',
        'Bayar lewat menu Langganan di aplikasi.',
      ],
      { label: 'Bayar tagihan', url: `${appUrl()}/billing` },
    );
    return inv;
  }

  private async ownInvoice(tenantId: string, id: string) {
    const inv = await findOwned(this.db, billingInvoices, tenantId, id);
    if (!inv) throw new NotFoundException('Tagihan tidak ditemukan');
    return inv;
  }

  /** Bayar lewat gerbang pembayaran (VA/QRIS/e-wallet) → kembalikan tautan pembayaran */
  async payOnline(u: AuthUser, id: string) {
    const gw = activeGateway();
    if (!gw)
      throw new BadRequestException('Pembayaran online belum diaktifkan. Silakan transfer manual lalu unggah bukti.');
    const inv = await this.ownInvoice(u.tenantId, id);
    if (inv.status === 'PAID' || inv.status === 'CANCELLED')
      throw new BadRequestException('Tagihan ini sudah tidak bisa dibayar');
    if (inv.gatewayUrl && inv.method === gw) return { url: inv.gatewayUrl };
    const [me] = await this.repo.findUsersById(this.db, u.sub);
    const [plan] = await this.repo.findPlansById(this.db, inv.planId);
    const input = {
      orderId: inv.number,
      amount: Number(inv.amount),
      description: `Langganan SANSU ${plan?.name ?? ''} ${CYCLE_LABEL[inv.cycle]}`.trim(),
      customer: { name: me.name, email: me.email },
      finishUrl: `${appUrl()}/billing?paid=${encodeURIComponent(inv.number)}`,
    };
    const r = gw === 'MIDTRANS' ? await midtrans.checkout(input) : await xendit.checkout(input);
    await patchById(this.db, billingInvoices, inv.id, { method: gw, gatewayRef: r.ref, gatewayUrl: r.url });
    return { url: r.url };
  }

  /** Unggah bukti transfer manual */
  async submitProof(u: AuthUser, id: string, dto: ProofDto) {
    const inv = await this.ownInvoice(u.tenantId, id);
    if (inv.status !== 'UNPAID' && inv.status !== 'WAITING')
      throw new BadRequestException('Tagihan ini sudah tidak menunggu pembayaran');
    await patchById(this.db, billingInvoices, inv.id, { status: 'WAITING', method: 'MANUAL', proof: dto.proof, proofNote: dto.note ?? null, rejectReason: null });
    const [t] = await this.repo.findTenantsById(this.db, u.tenantId);
    for (const to of platformAdminEmails()) {
      await this.mail.send({
        to,
        subject: `Bukti transfer masuk: ${inv.number}`,
        heading: 'Ada bukti transfer yang perlu dikonfirmasi',
        paragraphs: [
          `${t?.name ?? 'Pelanggan'} mengirim bukti transfer untuk ${inv.number} sebesar ${rupiah(inv.amount)}.`,
          dto.note ? `Catatan: ${dto.note}` : '',
        ].filter(Boolean),
        action: { label: 'Buka panel admin', url: `${appUrl()}/platform?tab=payments` },
      });
    }
    return { ok: true };
  }

  async cancelInvoice(u: AuthUser, id: string) {
    const inv = await this.ownInvoice(u.tenantId, id);
    if (inv.status !== 'UNPAID') throw new BadRequestException('Hanya tagihan yang belum dibayar yang bisa dibatalkan');
    await patchById(this.db, billingInvoices, inv.id, { status: 'CANCELLED' });
    return { ok: true };
  }

  /**
   * Tandai lunas & perpanjang langganan. Idempoten: tagihan yang sudah lunas tidak diproses dua kali.
   * Masa aktif baru dimulai dari akhir masa aktif/trial sekarang (bila masih berjalan), atau dari hari ini.
   */
  async markPaid(invoiceId: string, by: string, ref?: string | null) {
    const done = await this.db.transaction(async (tx) => {
      const [inv] = await this.repo.findBillingInvoicesById(tx, invoiceId);
      if (!inv) throw new NotFoundException('Tagihan tidak ditemukan');
      if (inv.status === 'PAID') return null;
      if (inv.status === 'CANCELLED' && by !== 'gateway') throw new BadRequestException('Tagihan sudah dibatalkan');
      const [sub] = await this.repo.findSubscriptions(tx, inv.tenantId);
      const now = new Date();
      let start = now;
      if (sub?.status === 'ACTIVE' && sub.currentPeriodEnd && sub.currentPeriodEnd > now) start = sub.currentPeriodEnd;
      if (sub?.status === 'TRIAL' && sub.trialEndsAt && sub.trialEndsAt > now) start = sub.trialEndsAt;
      const end = addMonths(start, inv.cycle === 'YEARLY' ? 12 : 1);
      await patchById(tx, billingInvoices, inv.id, {
          status: 'PAID',
          paidAt: now,
          confirmedBy: by,
          gatewayRef: ref ?? inv.gatewayRef,
          periodStart: start,
          periodEnd: end,
        });
      const values = {
        planId: inv.planId,
        status: 'ACTIVE' as const,
        cycle: inv.cycle,
        currentPeriodEnd: end,
        reminders: {},
        updatedAt: now,
      };
      if (sub) await this.repo.updateSubscriptions(tx, values, inv.tenantId);
      else await this.repo.insertSubscriptions(tx, inv.tenantId, values);
      await this.audit.log(tx, {
        tenantId: inv.tenantId,
        action: 'PAID',
        entity: 'Langganan',
        entityId: inv.id,
        data: { number: inv.number, amount: inv.amount, by, periodEnd: end },
      });
      return { inv, end };
    });
    this.subs.invalidate();
    if (done) {
      const [plan] = await this.repo.findPlansByIdForMarkPaid(this.db, done.inv.planId);
      await this.notifyOwners(
        done.inv.tenantId,
        `Pembayaran diterima — ${done.inv.number}`,
        'Terima kasih, pembayaran sudah diterima',
        [
          `Pembayaran ${rupiah(done.inv.amount)} untuk tagihan ${done.inv.number} sudah kami terima.`,
          `Paket ${plan?.name ?? ''} aktif sampai ${tgl(done.end)}.`,
        ],
      );
    }
    return { ok: true, alreadyPaid: !done };
  }

  /** Notifikasi dari gerbang pembayaran */
  async handleNotice(n: PaymentNotice | null) {
    if (!n) throw new ForbiddenException('Tanda tangan notifikasi tidak valid');
    const [inv] = await this.repo.findBillingInvoicesByNumber(this.db, n.orderId);
    if (!inv) return { ok: true, ignored: 'tagihan tidak dikenal' };
    if (n.paid) {
      if (n.amount != null && Math.round(n.amount) !== Math.round(Number(inv.amount))) {
        this.logger.warn(
          `Jumlah bayar ${n.amount} tidak sama dengan tagihan ${inv.number} (${inv.amount}) — tidak diproses otomatis`,
        );
        return { ok: true, ignored: 'jumlah berbeda' };
      }
      return this.markPaid(inv.id, 'gateway', n.ref);
    }
    if (n.failed && inv.status === 'UNPAID')
      await patchById(this.db, billingInvoices, inv.id, { gatewayUrl: null });
    return { ok: true };
  }

  /** Data invoice langganan untuk dicetak (penjual = pemilik SANSU, pembeli = perusahaan pelanggan) */
  async invoiceDoc(id: string, tenantId?: string) {
    const [r] = await this.repo.findBillingInvoicesWithPlansAndTenantsById(this.db, id, tenantId);
    if (!r) throw new NotFoundException('Tagihan tidak ditemukan');
    const s = await this.subs.settings();
    const { proof: _p, ...inv } = r.inv;
    void _p;
    return {
      ...inv,
      planName: r.plan,
      seller: {
        name: s.sellerName,
        npwp: s.sellerNpwp,
        address: s.sellerAddress,
        bank: s.bankAccount ? { name: s.bankName, account: s.bankAccount, holder: s.bankHolder } : null,
      },
      buyer: { name: r.tenant.name, npwp: r.tenant.npwp, address: r.tenant.address },
    };
  }

  /** Rekap PPN keluaran langganan per bulan (tagihan lunas) — bahan faktur pajak di Coretax */
  async vatReport(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('Bulan tidak valid (format YYYY-MM)');
    const r = await this.repo.queryBillingInvoice(this.db, month);
    return r.rows;
  }

  // ===== Tugas terjadwal: pengingat & tagihan perpanjangan otomatis =====
  async runReminders(now = new Date()) {
    const s = await this.subs.settings();
    if (!s.enabled) return { checked: 0, sent: 0 }; // tahap uji: tanpa pengingat/tagihan perpanjangan
    const rows = await this.repo.listSubscriptionsWithPlansByStatus(this.db);
    let sent = 0;
    for (const { sub, plan } of rows) {
      const mark = async (key: string) => {
        await this.repo.updateSubscriptionsForRunReminders(this.db, sub.reminders, key, now, sub.tenantId);
        sub.reminders = { ...sub.reminders, [key]: now.toISOString().slice(0, 10) };
        sent++;
      };
      const url = { label: 'Pilih paket & bayar', url: `${appUrl()}/billing` };
      if (sub.status === 'TRIAL' && sub.trialEndsAt) {
        const left = Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY);
        if (left <= 3 && left > 0 && !sub.reminders['trial-3']) {
          await this.notifyOwners(
            sub.tenantId,
            `Masa uji coba SANSU berakhir ${left} hari lagi`,
            'Masa uji coba hampir berakhir',
            [
              `Masa uji coba Anda berakhir pada ${tgl(sub.trialEndsAt)}.`,
              'Pilih paket sekarang agar tetap bisa mencatat transaksi tanpa jeda. Semua data selama uji coba tetap tersimpan.',
            ],
            url,
          );
          await mark('trial-3');
        } else if (left <= 0 && !sub.reminders['trial-end']) {
          await this.notifyOwners(
            sub.tenantId,
            'Masa uji coba SANSU sudah berakhir',
            'Masa uji coba sudah berakhir',
            [
              'Data Anda tetap aman dan masih bisa dilihat & diekspor.',
              'Untuk kembali mencatat transaksi, pilih paket dan lakukan pembayaran.',
            ],
            url,
          );
          await mark('trial-end');
        }
      }
      if (sub.status === 'ACTIVE' && sub.currentPeriodEnd) {
        const left = Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / DAY);
        const key = `renew-${sub.currentPeriodEnd.toISOString().slice(0, 10)}`;
        if (left <= s.renewalNoticeDays && left > -s.graceDays && !sub.reminders[key]) {
          // tagihan perpanjangan otomatis (paket & siklus yang sama) bila belum ada tagihan terbuka
          const [open] = await this.repo.findBillingInvoicesByStatus(this.db, sub.tenantId);
          if (!open && plan.isActive) {
            const [owner] = await this.repo.findUsersByRoleAndIsActive(this.db, sub.tenantId);
            if (owner)
              await this.createInvoice(
                { sub: owner.id, tenantId: sub.tenantId, role: 'OWNER', email: owner.email },
                { planId: plan.id, cycle: sub.cycle },
                { auto: true },
              );
          }
          await mark(key);
        }
      }
    }
    return { checked: rows.length, sent };
  }
}

@Injectable()
export class BillingScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger('Langganan');
  constructor(private readonly svc: BillingService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.svc.runReminders().catch((e) => this.logger.error(e));
    setTimeout(run, 60_000).unref();
    this.timer = setInterval(run, 60 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

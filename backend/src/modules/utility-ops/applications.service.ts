import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { toDocDate } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { CustomersService } from '../master-data/customers/customers.service';
import { UtilityChargesService } from '../utility/utility-charges.service';
import { UtilityService } from '../utility/utility.service';
import { ActivateDto, ApplicationDto, CloseApplicationDto, InstallDto, QuoteDto, SurveyDto } from './applications.dto';
import { ApplicationsRepository } from './applications.repository';
import { StaffRepository } from './staff.repository';

/**
 * Permohonan sambungan baru: permohonan → survei → tagihan biaya sambung → dibayar → dipasang → aktif.
 * Pelanggan dan sambungan baru dibuat saat diaktifkan; yang memasang dan yang mengaktifkan harus orang berbeda.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: ApplicationsRepository,
    private readonly staff: StaffRepository,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly charges: UtilityChargesService,
    private readonly util: UtilityService,
  ) {}

  list(tenantId: string, q: { status?: string; q?: string }) { return this.repo.list(this.db, tenantId, q.status || undefined, q.q); }
  async counts(tenantId: string) { const r = await this.repo.summary(this.db, tenantId); return Object.fromEntries(r.map((x) => [x.status, x.n])); }
  async get(tenantId: string, id: string) {
    const a = await this.repo.byId(this.db, tenantId, id);
    if (!a) throw new NotFoundException('Permohonan tidak ditemukan');
    return a;
  }

  async create(u: AuthUser, dto: ApplicationDto) {
    if (dto.tariffId && !(await this.repo.tariff(this.db, u.tenantId, dto.tariffId))) throw new BadRequestException('Golongan tarif tidak ditemukan');
    if (dto.customerId && !(await this.staff.customer(this.db, u.tenantId, dto.customerId))) throw new BadRequestException('Pelanggan tidak ditemukan');
    if ((dto.geoLat == null) !== (dto.geoLng == null)) throw new BadRequestException('Lintang dan bujur harus diisi bersamaan');
    return this.db.transaction(async (tx) => {
      const number = await this.seq.next(tx, u.tenantId, 'UTILITY_APPLICATION', toDocDate(undefined));
      const id = await this.repo.insert(tx, { tenantId: u.tenantId, number, applicantName: dto.applicantName.trim(), phone: dto.phone?.trim() || null, idNumber: dto.idNumber?.trim() || null, address: dto.address.trim(), geoLat: dto.geoLat ?? null, geoLng: dto.geoLng ?? null, tariffId: dto.tariffId ?? null, customerId: dto.customerId ?? null, createdById: u.sub });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityApplication', entityId: id, data: { number, applicant: dto.applicantName } });
      return { id, number };
    });
  }

  async survey(u: AuthUser, id: string, dto: SurveyDto) {
    const a = await this.get(u.tenantId, id);
    if (a.status !== 'PERMOHONAN') throw new BadRequestException('Survei hanya untuk permohonan yang baru masuk');
    if (dto.tariffId && !(await this.repo.tariff(this.db, u.tenantId, dto.tariffId))) throw new BadRequestException('Golongan tarif tidak ditemukan');
    if (!dto.feasible && dto.note.trim().length < 5) throw new BadRequestException('Tulis alasan tidak layak');
    await this.repo.setSurvey(this.db, u.tenantId, id, { status: dto.feasible ? 'SURVEI' : 'DITOLAK', feasible: dto.feasible, pipeLength: dto.pipeLength ?? null, note: dto.note.trim(), userId: u.sub, tariffId: dto.tariffId ?? null, closedReason: dto.feasible ? null : `Tidak layak: ${dto.note.trim()}` });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityApplication', entityId: id, data: { survey: dto.feasible ? 'layak' : 'tidak layak' } });
    return this.get(u.tenantId, id);
  }

  /** Buat tagihan biaya sambung (faktur layanan non-air); pelanggan baru dibuat bila belum terdaftar */
  async quote(u: AuthUser, id: string, dto: QuoteDto) {
    const a = await this.get(u.tenantId, id);
    if (a.status !== 'SURVEI') throw new BadRequestException('Tagihan biaya sambung dibuat setelah survei menyatakan layak');
    if (!a.tariff_id) throw new BadRequestException('Pilih golongan tarif lebih dulu (saat survei)');
    const catalog = await this.charges.list(u.tenantId);
    const charge = dto.chargeId ? catalog.find((c) => c.id === dto.chargeId) : catalog.find((c) => c.revenueKey === 'UTILITY_CONNECTION_REVENUE' && c.isActive);
    if (!charge) throw new BadRequestException('Layanan biaya sambung tidak ditemukan');
    let customerId = a.customer_id;
    if (!customerId) {
      const c = await this.customers.create(u.tenantId, { code: `PLG-${a.number.replace(/\D/g, '')}`, name: a.applicant_name, address: a.address, phone: a.phone ?? undefined, creditLimit: '0', paymentTermDays: 14 });
      customerId = c.id;
    }
    const inv = await this.charges.issue(u, { chargeId: charge.id, customerId, price: dto.price, notes: `Permohonan ${a.number}` });
    await this.repo.setCustomerAndInvoice(this.db, u.tenantId, id, customerId, inv.invoiceId);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityApplication', entityId: id, data: { invoice: inv.invoiceNumber, amount: inv.amount } });
    return this.get(u.tenantId, id);
  }

  async install(u: AuthUser, id: string, dto: InstallDto) {
    const a = await this.get(u.tenantId, id);
    if (a.status !== 'MENUNGGU_BAYAR') throw new BadRequestException('Pemasangan dijadwalkan setelah tagihan biaya sambung dibuat');
    if (!a.paid) throw new BadRequestException('Tagihan biaya sambung belum lunas; pemasangan baru boleh setelah dibayar');
    if (!(await this.staff.byId(this.db, u.tenantId, dto.installerId))) throw new BadRequestException('Petugas pemasang tidak ditemukan atau nonaktif');
    await this.repo.setInstall(this.db, u.tenantId, id, { installerId: dto.installerId, meterSerial: dto.meterSerial.trim(), note: dto.note?.trim() || null });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityApplication', entityId: id, data: { installer: dto.installerId, meter: dto.meterSerial } });
    return this.get(u.tenantId, id);
  }

  /** Aktifkan: membuat sambungan sungguhan (nomor sambungan, meter terdaftar). Bukan oleh petugas yang memasang. */
  async activate(u: AuthUser, id: string, dto: ActivateDto) {
    const a = await this.get(u.tenantId, id);
    if (a.status !== 'PEMASANGAN') throw new BadRequestException('Sambungan diaktifkan setelah tahap pemasangan');
    if (a.installer_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Pengaktifan harus oleh orang lain dari petugas pemasang (pemisahan fungsi)');
    if (!a.customer_id || !a.tariff_id) throw new BadRequestException('Data pelanggan/tarif belum lengkap');
    const tariff = await this.repo.tariff(this.db, u.tenantId, a.tariff_id);
    if (!tariff) throw new BadRequestException('Golongan tarif tidak aktif');
    const conn = (await this.util.createConnection(u, { customerId: a.customer_id, tariffId: a.tariff_id, meterNo: tariff.metered ? a.meter_serial ?? undefined : undefined, address: a.address, installedAt: dto.installedAt, initialReading: dto.initialReading ?? '0', zone: dto.zone })) as { id: string; number: string };
    await this.db.transaction(async (tx) => {
      if (tariff.metered && a.meter_serial) await this.repo.attachMeter(tx, u.tenantId, a.meter_serial, conn.id, dto.initialReading ?? '0', u.sub);
      await this.repo.setActive(tx, u.tenantId, id, conn.id);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'UtilityApplication', entityId: id, data: { connection: conn.number } });
    });
    return this.get(u.tenantId, id);
  }

  async close(u: AuthUser, id: string, dto: CloseApplicationDto) {
    const a = await this.get(u.tenantId, id);
    if (['AKTIF', 'DITOLAK', 'BATAL'].includes(a.status)) throw new BadRequestException('Permohonan ini sudah selesai');
    const status = dto.rejected ? 'DITOLAK' : 'BATAL';
    await this.repo.setClosed(this.db, u.tenantId, id, status, dto.reason.trim());
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: dto.rejected ? 'REJECT' : 'CANCEL', entity: 'UtilityApplication', entityId: id, data: { reason: dto.reason, invoice: a.invoice_number ?? undefined } });
    return { ...(await this.get(u.tenantId, id)), warning: a.cost_invoice_id && !a.paid ? `Tagihan ${a.invoice_number} masih terbuka: batalkan lewat Koreksi tagihan` : null };
  }
}

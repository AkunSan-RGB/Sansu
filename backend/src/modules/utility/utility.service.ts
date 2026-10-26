import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { haversineM } from '../sales/canvass/canvass.service';
import { AIR_REVENUE_KEYS, NON_AIR_REVENUE_KEYS, computeBill, DEFAULT_UTILITY_RULES, flagReading, isPeriod, lateFee, UTILITY_SERVICE_DEFAULTS, validateBlocks, validateRules, type TariffBlock, type UtilityRules } from '@sansu/shared';
import { ApprovalsService } from '../../common/approvals/approvals.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
import { SettingsService } from '../../common/settings.service';
import { addDays, diffDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { Db } from '../../db/db';
import { LOSS_WARN_PCT, ZONE_STATUS_LABEL, zoneLoss } from './zones';
import { InjectDb } from '../../db/db.module';
import { utilityBills, utilityConnections, utilityReadings, utilityTariffs } from '../../db/schema';
import { PostingService } from '../accounting/posting.service';
import { SYS, type SystemKey } from '../accounting/default-coa';
import { ServiceBillingService } from '../sales/services/service-billing.service';
import { RulesDto, TariffDto, ConnectionDto, SuspendDto, ReasonDto, ZoneDto, ZoneSupplyDto, ReadingDto, VerifyDto, BillRunDto } from './utility.dto';
import { findOwned, insertOne, patchById } from '../../db/owned';
import { UtilityRepository } from './utility.repository';

const SECTION = 'utility';

/** Pencatatan lebih dari ini dari lokasi pelanggan ditandai janggal */
export const FAR_READING_M = 500;

const num = (v: unknown) => Number(v ?? 0);

/** Nama zona dirapikan: spasi ganda dibuang agar "Zona  A" dan "Zona A" tidak terpisah */
const normZone = (z?: string) => z?.trim().replace(/\s+/g, ' ') || null;

const isUnique = (e: unknown) => ['23505'].includes((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? '');

const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

interface ConnRow {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string;
  tariff_id: string;
  status: string;
  installed_at: string;
  initial_reading: string;
  status_changed_by_id: string | null;
  meter_no: string | null;
  address: string;
}

@Injectable()
export class UtilityService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
    private readonly billing: ServiceBillingService,
    private readonly storage: StorageService,
    private readonly posting: PostingService,
    private readonly repo: UtilityRepository,
  ) {}

  rules(tenantId: string): Promise<UtilityRules> {
    return this.settings.section(this.db, tenantId, SECTION, DEFAULT_UTILITY_RULES);
  }
  async saveRules(u: AuthUser, dto: RulesDto) {
    const before = await this.rules(u.tenantId);
    const next: UtilityRules = { ...before, ...(Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<UtilityRules>) };
    const problems = validateRules(next);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    const saved = await this.settings.saveSection(this.db, u.tenantId, SECTION, DEFAULT_UTILITY_RULES, next);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityRules', entityId: u.tenantId, data: { before, after: saved } });
    return saved;
  }

  async tariffs(tenantId: string) {
    const r = await this.repo.queryUtilityTariff(this.db, tenantId);
    return r.rows;
  }

  private normalizeTariff(dto: TariffDto) {
    const defaults = UTILITY_SERVICE_DEFAULTS[dto.serviceType];
    const blocks: TariffBlock[] = dto.blocks.map((b) => ({ upTo: b.upTo ?? null, price: b.price }));
    const problems = validateBlocks(blocks, defaults.metered);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    if (!defaults.metered && dto.fixedFee <= 0) throw new BadRequestException('Layanan tarif tetap membutuhkan biaya tetap per periode lebih dari 0');
    if (defaults.metered && dto.fixedFee <= 0 && blocks.every((b) => b.price <= 0)) throw new BadRequestException('Tarif tidak boleh bernilai nol semua');
    return { blocks, metered: defaults.metered, unit: dto.unit?.trim() || defaults.unit };
  }

  async createTariff(u: AuthUser, dto: TariffDto) {
    const n = this.normalizeTariff(dto);
    try {
      const row = await insertOne(this.db, utilityTariffs, { tenantId: u.tenantId, name: dto.name.trim(), serviceType: dto.serviceType, unit: n.unit, metered: n.metered, fixedFee: dto.fixedFee.toFixed(2), adminFee: dto.adminFee.toFixed(2), minUsage: String(dto.minUsage ?? 0), blocks: n.blocks, vatable: !!dto.vatable, createdById: u.sub });
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityTariff', entityId: row.id, data: { name: row.name, blocks: n.blocks, fixedFee: row.fixedFee } });
      return row;
    } catch (e) {
      if (isUnique(e)) throw new BadRequestException('Nama tarif sudah dipakai');
      throw e;
    }
  }

  async updateTariff(u: AuthUser, id: string, dto: TariffDto) {
    const old = await findOwned(this.db, utilityTariffs, u.tenantId, id);
    if (!old) throw new NotFoundException('Tarif tidak ditemukan');
    if (old.serviceType !== dto.serviceType) throw new BadRequestException('Jenis layanan tarif tidak bisa diubah — buat tarif baru');
    const n = this.normalizeTariff(dto);
    try {
      const [row] = await this.repo.updateUtilityTariffsById(this.db, dto, n, old.isActive, id);
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityTariff', entityId: id, data: { before: { name: old.name, fixedFee: old.fixedFee, adminFee: old.adminFee, blocks: old.blocks, vatable: old.vatable }, after: { name: row.name, fixedFee: row.fixedFee, adminFee: row.adminFee, blocks: row.blocks, vatable: row.vatable } } });
      void this.approvals.notifyRoles(u.tenantId, { roles: ['FINANCE', 'OWNER'], excludeUserId: u.sub, title: `Tarif "${row.name}" diubah`, lines: ['Berlaku untuk tagihan berikutnya. Periksa riwayat perubahan di jejak audit.'], path: '/utility' });
      return row;
    } catch (e) {
      if (isUnique(e)) throw new BadRequestException('Nama tarif sudah dipakai');
      throw e;
    }
  }

  async connections(tenantId: string, q: { status?: string; search?: string }) {
    const r = await this.repo.queryUtilityConnection(this.db, tenantId, q);
    return r.rows;
  }

  async connection(tenantId: string, id: string) {
    const [c] = (await this.connections(tenantId, {})).filter((x) => x.id === id);
    if (!c) throw new NotFoundException('Sambungan tidak ditemukan');
    const readings = await this.repo.queryUtilityReading(this.db, id, tenantId);
    const bills = await this.repo.queryUtilityBill(this.db, id, tenantId);
    return { ...c, readings: readings.rows, bills: bills.rows };
  }

  async createConnection(u: AuthUser, dto: ConnectionDto) {
    return this.db.transaction(async (tx) => {
      const [cust] = await this.repo.findCustomersById(tx, dto.customerId, u.tenantId);
      if (!cust || !cust.isActive) throw new BadRequestException('Pelanggan tidak ditemukan / nonaktif');
      const t = await findOwned(tx, utilityTariffs, u.tenantId, dto.tariffId);
      if (!t || !t.isActive) throw new BadRequestException('Tarif tidak ditemukan / nonaktif');
      const meterNo = dto.meterNo?.trim() || null;
      if (t.metered && !meterNo) throw new BadRequestException('Nomor meter wajib untuk layanan terukur');
      if (!t.metered && meterNo) throw new BadRequestException('Layanan tarif tetap tidak memakai nomor meter');
      const installed = toDocDate(dto.installedAt);
      if (installed > todayJakarta()) throw new BadRequestException('Tanggal pasang tidak boleh di masa depan');
      const initial = D(dto.initialReading ?? '0');
      if (!initial.isFinite() || initial.lt(0)) throw new BadRequestException('Angka awal meter tidak valid');
      const dup = await this.repo.queryUtilityConnectionForCreateConnection(tx, u.tenantId, t.serviceType, dto.address, meterNo);
      if (dup.rows.length) throw new BadRequestException(`Alamat atau nomor meter ini sudah terdaftar pada sambungan ${(dup.rows[0] as { number: string }).number} (layanan sama)`);
      const number = await this.seq.next(tx, u.tenantId, 'UTILITY_CONNECTION', installed);
      const row = await insertOne(tx, utilityConnections, { tenantId: u.tenantId, number, customerId: dto.customerId, tariffId: dto.tariffId, meterNo, address: dto.address.trim(), zone: normZone(dto.zone), installedAt: installed, initialReading: initial.toString(), createdById: u.sub });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityConnection', entityId: row.id, data: { number, meterNo, tariff: t.name } });
      return row;
    });
  }

  private async lockConnection(tx: Db | Parameters<Parameters<Db['transaction']>[0]>[0], tenantId: string, id: string) {
    const r = await this.repo.queryUtilityConnectionForLockConnection(tx, id, tenantId);
    if (!r.rows.length) throw new NotFoundException('Sambungan tidak ditemukan');
    return r.rows[0] as unknown as ConnRow;
  }

  /** Tunggakan melewati jatuh tempo untuk satu sambungan */
  private async overdueOf(db: Db | Parameters<Parameters<Db['transaction']>[0]>[0], tenantId: string, connectionId: string) {
    const r = await this.repo.queryUtilityBillForOverdueOf(db, tenantId, connectionId);
    return { outstanding: num(r.rows[0]?.outstanding), daysLate: Number(r.rows[0]?.days_late ?? 0) };
  }
  private async unpaidOf(db: Db | Parameters<Parameters<Db['transaction']>[0]>[0], tenantId: string, connectionId: string) {
    const r = await this.repo.queryUtilityBillForUnpaidOf(db, tenantId, connectionId);
    return Number(r.rows[0]?.n ?? 0);
  }

  async suspend(u: AuthUser, id: string, dto: SuspendDto) {
    const rules = await this.rules(u.tenantId);
    return this.db.transaction(async (tx) => {
      const c = await this.lockConnection(tx, u.tenantId, id);
      if (c.status !== 'ACTIVE') throw new BadRequestException('Hanya sambungan aktif yang bisa diputus sementara');
      if (!dto.onRequest) {
        const od = await this.overdueOf(tx, u.tenantId, id);
        if (od.daysLate <= rules.suspendAfterDays) throw new BadRequestException(`Pemutusan hanya untuk tunggakan lebih dari ${rules.suspendAfterDays} hari setelah jatuh tempo (saat ini ${od.daysLate} hari). Pilih "atas permintaan pelanggan" bila pelanggan yang meminta.`);
      }
      await patchById(tx, utilityConnections, id, { status: 'SUSPENDED', statusChangedById: u.sub, statusChangedAt: new Date(), statusNote: dto.reason });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'SUSPEND', entity: 'UtilityConnection', entityId: id, data: { number: c.number, reason: dto.reason, onRequest: !!dto.onRequest } });
      void this.approvals.notifyRoles(u.tenantId, { roles: ['ADMIN', 'OWNER', 'FINANCE'], excludeUserId: u.sub, title: `Sambungan ${c.number} (${c.customer_name}) diputus sementara`, lines: [dto.reason, 'Penyambungan kembali harus dilakukan orang lain setelah tagihan lunas.'], path: '/utility' });
      return { ok: true };
    });
  }

  async reconnect(u: AuthUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockConnection(tx, u.tenantId, id);
      if (c.status !== 'SUSPENDED') throw new BadRequestException('Sambungan ini tidak sedang diputus sementara');
      if (c.status_changed_by_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Penyambungan kembali harus dilakukan orang lain dari yang memutus (pemisahan fungsi)');
      const od = await this.overdueOf(tx, u.tenantId, id);
      if (od.outstanding > 0) throw new BadRequestException(`Masih ada tunggakan jatuh tempo ${rp(od.outstanding)}. Lunasi dulu sebelum disambung kembali.`);
      await patchById(tx, utilityConnections, id, { status: 'ACTIVE', statusChangedById: u.sub, statusChangedAt: new Date(), statusNote: dto.reason });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'RECONNECT', entity: 'UtilityConnection', entityId: id, data: { number: c.number, reason: dto.reason } });
      return { ok: true };
    });
  }

  async disconnect(u: AuthUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockConnection(tx, u.tenantId, id);
      if (c.status === 'DISCONNECTED') throw new BadRequestException('Sambungan sudah dibongkar');
      if (await this.unpaidOf(tx, u.tenantId, id)) throw new BadRequestException('Masih ada tagihan yang belum lunas. Lunasi atau selesaikan dulu sebelum sambungan dibongkar.');
      await patchById(tx, utilityConnections, id, { status: 'DISCONNECTED', statusChangedById: u.sub, statusChangedAt: new Date(), statusNote: dto.reason });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'DISCONNECT', entity: 'UtilityConnection', entityId: id, data: { number: c.number, reason: dto.reason } });
      return { ok: true };
    });
  }

  async setZone(u: AuthUser, id: string, dto: ZoneDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockConnection(tx, u.tenantId, id);
      const zone = normZone(dto.zone);
      await patchById(tx, utilityConnections, id, { zone });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityConnection', entityId: id, data: { number: c.number, zone } });
      return { ok: true, zone };
    });
  }

  /** Pasokan zona per periode dan kehilangannya (pasokan − pemakaian terverifikasi) */
  async zones(tenantId: string, period?: string) {
    const p = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : todayJakarta().slice(0, 7);
    return { period: p, warnPct: LOSS_WARN_PCT, rows: await zoneLoss(this.db, tenantId, p, p, true) };
  }

  async saveSupply(u: AuthUser, dto: ZoneSupplyDto) {
    const zone = normZone(dto.zone)!;
    const supplied = D(dto.supplied);
    if (!supplied.isFinite() || supplied.lt(0)) throw new BadRequestException('Jumlah pasokan tidak valid');
    if (dto.period > todayJakarta().slice(0, 7)) throw new BadRequestException('Periode di masa depan belum dapat diisi');
    return this.db.transaction(async (tx) => {
      const z = await this.repo.queryUtilityConnectionForSaveSupply(tx, u.tenantId, zone);
      if (!z.rows[0]?.n) throw new BadRequestException('Zona belum punya sambungan terukur; isi zona pada sambungan lebih dulu');
      if ((z.rows[0].units ?? []).length > 1) throw new BadRequestException('Zona ini memuat layanan dengan satuan berbeda; pisahkan zona per layanan');
      const before = await this.repo.queryUtilityZoneSupply(tx, u.tenantId, zone, dto.period);
      await this.repo.queryUtilityZoneSupplyForSaveSupply(tx, u.tenantId, zone, dto, supplied, u.sub);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: before.rows.length ? 'UPDATE' : 'CREATE', entity: 'UtilityZoneSupply', entityId: `${zone}:${dto.period}`, data: { zone, period: dto.period, before: before.rows[0]?.supplied ?? null, after: supplied.toFixed(3), note: dto.note } });
      return { ok: true };
    });
  }

  async readings(tenantId: string, q: { period?: string; status?: string; connectionId?: string }) {
    const r = await this.repo.queryUtilityReadingForReadings(this.db, tenantId, q);
    return r.rows;
  }

  /** Sambungan terukur aktif yang belum punya pencatatan untuk periode ini (daftar kerja petugas) */
  async due(tenantId: string, period: string) {
    if (!isPeriod(period)) throw new BadRequestException('Periode tidak valid (YYYY-MM)');
    const r = await this.repo.queryUtilityConnectionForDue(this.db, tenantId, period);
    return r.rows;
  }

  async enterReading(u: AuthUser, dto: ReadingDto, source: 'MANUAL' | 'LAPANGAN' | 'IMPORT' | 'API' = 'MANUAL') {
    if ((dto.lat == null) !== (dto.lng == null)) throw new BadRequestException('Lintang dan bujur harus diisi bersamaan');
    const rules = await this.rules(u.tenantId);
    if (dto.period > todayJakarta().slice(0, 7)) throw new BadRequestException('Periode pencatatan tidak boleh di masa depan');
    // foto meter diunggah lebih dulu (isinya divalidasi); bila pencatatan gagal, berkas yatim dihapus lagi
    const photoRef = await this.storage.store(u.tenantId, 'meter', dto.photo);
    const result = await this.storage.guard([photoRef], () => this.db.transaction(async (tx) => {
      const c = await this.lockConnection(tx, u.tenantId, dto.connectionId);
      if (c.status !== 'ACTIVE') throw new BadRequestException('Sambungan tidak aktif');
      const [t] = await this.repo.findUtilityTariffsById(tx, c.tariff_id);
      if (!t.metered) throw new BadRequestException('Layanan ini tarif tetap — tidak perlu catat meter');
      if (dto.period < c.installed_at.slice(0, 7)) throw new BadRequestException('Periode sebelum tanggal pasang sambungan');
      const last = (await this.repo.queryUtilityReadingForEnterReading(tx, c.id)).rows[0];
      if (last && last.period >= dto.period) throw new BadRequestException(last.period === dto.period ? 'Periode ini sudah dicatat' : `Pencatatan terakhir sudah periode ${last.period}; periode harus setelahnya`);
      const prev = D(last?.current ?? c.initial_reading);
      const cur = D(dto.current);
      if (!cur.isFinite() || cur.lt(0)) throw new BadRequestException('Angka meter tidak valid');
      let usage = cur.minus(prev);
      if (dto.meterReplaced) {
        if (dto.oldMeterFinal === undefined || dto.newMeterStart === undefined) throw new BadRequestException('Meter diganti: isi angka akhir meter lama dan angka awal meter baru');
        const oldFinal = D(dto.oldMeterFinal);
        const newStart = D(dto.newMeterStart);
        if (oldFinal.lt(prev)) throw new BadRequestException('Angka akhir meter lama lebih kecil dari catatan sebelumnya');
        if (cur.lt(newStart)) throw new BadRequestException('Angka meter baru lebih kecil dari angka awalnya');
        if (!(dto.note ?? '').trim()) throw new BadRequestException('Meter diganti: tulis catatan (nomor meter baru, alasan penggantian)');
        usage = oldFinal.minus(prev).plus(cur.minus(newStart));
      } else if (cur.lt(prev)) {
        throw new BadRequestException(`Angka meter (${cur.toString()}) lebih kecil dari catatan sebelumnya (${prev.toString()}). Bila meter diganti, centang "meter diganti".`);
      }
      const hist = (await this.repo.queryUtilityReadingForEnterReading2(tx, c.id)).rows.map((x) => num(x.usage));
      const flags = flagReading(usage.toNumber(), hist, rules, !!dto.meterReplaced);
      // lokasi pencatat jauh dari lokasi pelanggan → tandai agar pemeriksa mengecek (foto/cek ulang)
      if (dto.lat != null && dto.lng != null) {
        const [cu] = await this.repo.findCustomersByIdForEnterReading(tx, c.customer_id);
        if (cu?.lat && cu?.lng && haversineM(dto.lat, dto.lng, Number(cu.lat), Number(cu.lng)) > FAR_READING_M) flags.push('JAUH_DARI_LOKASI');
      }
      try {
        const row = await insertOne(tx, utilityReadings, { tenantId: u.tenantId, connectionId: c.id, period: dto.period, previous: prev.toString(), current: cur.toString(), usage: usage.toString(), meterReplaced: !!dto.meterReplaced, flags, note: dto.note?.trim() || null, enteredById: u.sub, source, lat: dto.lat != null ? String(dto.lat) : null, lng: dto.lng != null ? String(dto.lng) : null, photo: photoRef });
        await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityReading', entityId: row.id, data: { connection: c.number, period: dto.period, usage: row.usage, flags } });
        return { row, flags };
      } catch (e) {
        if (isUnique(e)) throw new BadRequestException('Periode ini sudah dicatat');
        throw e;
      }
    }));
    return { ...result.row, flags: result.flags, photo: undefined, hasPhoto: !!photoRef };
  }

  private async lockReading(tx: Db | Parameters<Parameters<Db['transaction']>[0]>[0], tenantId: string, id: string) {
    const r = await this.repo.queryUtilityReadingForLockReading(tx, id, tenantId);
    if (!r.rows.length) throw new NotFoundException('Pencatatan tidak ditemukan');
    return r.rows[0] as unknown as { id: string; status: string; entered_by_id: string; flags: string[]; connection_id: string; period: string };
  }

  async verify(u: AuthUser, id: string, dto: VerifyDto) {
    return this.db.transaction(async (tx) => {
      const r = await this.lockReading(tx, u.tenantId, id);
      if (r.status !== 'ENTERED') throw new BadRequestException('Pencatatan ini sudah diputuskan');
      if (r.entered_by_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Pencatatan harus diverifikasi orang lain dari petugas yang mencatat (pemisahan fungsi)');
      if (r.flags.length && (dto.note ?? '').trim().length < 5) throw new BadRequestException(`Angka ini ditandai janggal (${r.flags.join(', ')}). Tulis catatan pemeriksaan (mis. hasil cek ulang lapangan).`);
      await patchById(tx, utilityReadings, id, { status: 'VERIFIED', verifiedById: u.sub, verifiedAt: new Date(), verifyNote: dto.note?.trim() || null });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'UtilityReading', entityId: id, data: { flags: r.flags, note: dto.note } });
      return { ok: true };
    });
  }

  async reject(u: AuthUser, id: string, dto: ReasonDto) {
    return this.db.transaction(async (tx) => {
      const r = await this.lockReading(tx, u.tenantId, id);
      if (r.status !== 'ENTERED') throw new BadRequestException('Hanya pencatatan yang menunggu verifikasi yang bisa ditolak');
      if (r.entered_by_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Pencatatan hanya bisa ditolak orang lain dari petugas yang mencatat');
      await patchById(tx, utilityReadings, id, { status: 'REJECTED', verifiedById: u.sub, verifiedAt: new Date(), verifyNote: dto.reason });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'UtilityReading', entityId: id, data: { reason: dto.reason } });
      return { ok: true };
    });
  }

  /** Tagihan menunggak yang belum didenda, dikelompokkan per sambungan (satu query untuk seluruh perusahaan) */
  private async lateFeesByConnection(tenantId: string, rules: UtilityRules) {
    const today = todayJakarta();
    const r = await this.repo.queryUtilityBillForLateFeesByConnection(this.db, tenantId, today);
    const out = new Map<string, { invoiceId: string; number: string; billId: string; amount: number; daysLate: number }[]>();
    for (const x of r.rows) {
      const daysLate = diffDays(x.due_date, today);
      const amount = lateFee(num(x.total), num(x.total) - num(x.paid_amount), daysLate, rules);
      if (amount <= 0) continue;
      const list = out.get(x.connection_id) ?? [];
      list.push({ invoiceId: x.invoice_id, number: x.number, billId: x.bill_id, amount, daysLate });
      out.set(x.connection_id, list);
    }
    return out;
  }

  /** Rencana penagihan satu periode: apa yang akan ditagih, apa yang tertahan dan kenapa */
  async plan(tenantId: string, period: string) {
    if (!isPeriod(period)) throw new BadRequestException('Periode tidak valid (YYYY-MM)');
    if (period > todayJakarta().slice(0, 7)) throw new BadRequestException('Periode penagihan tidak boleh di masa depan');
    const rules = await this.rules(tenantId);
    const lateFees = await this.lateFeesByConnection(tenantId, rules);
    const rows = await this.repo.queryUtilityConnectionForPlan(this.db, period, tenantId);
    const ready: { connectionId: string; number: string; customerId: string; customerName: string; tariffId: string; tariffName: string; vatable: boolean; unit: string; usage: number | null; readingId: string | null; lines: ReturnType<typeof computeBill>['lines']; subtotal: number; lateFees: { invoiceId: string; number: string; billId: string; amount: number; daysLate: number }[]; lateFeeTotal: number }[] = [];
    const held: { connectionId: string; number: string; customerName: string; reason: string }[] = [];
    for (const x of rows.rows) {
      const base = { connectionId: x.connection_id as string, number: x.number as string, customerName: x.customer_name as string };
      if (x.bill_id) {
        if (!x.bill_invoice_id) held.push({ ...base, reason: 'Penagihan periode ini tertahan di tengah jalan — periksa di Penjualan › Faktur lalu hubungi Admin' });
        continue;
      }
      const metered = x.metered as boolean;
      if (metered) {
        if (!x.reading_id) { if (x.status === 'ACTIVE') held.push({ ...base, reason: 'Meter belum dicatat' }); continue; }
        if (x.reading_status === 'ENTERED') { held.push({ ...base, reason: 'Pencatatan menunggu verifikasi' }); continue; }
        if (x.reading_status !== 'VERIFIED') continue;
      } else if (x.status !== 'ACTIVE') continue;
      const tariff = { fixedFee: num(x.fixed_fee), adminFee: num(x.admin_fee), minUsage: num(x.min_usage), blocks: x.blocks as TariffBlock[] };
      const usage = metered ? num(x.usage) : null;
      const bill = computeBill(tariff, usage, x.unit as string);
      if (bill.subtotal <= 0) { held.push({ ...base, reason: 'Nilai tagihan nol — periksa tarif' }); continue; }
      const fees = lateFees.get(base.connectionId) ?? [];
      ready.push({ ...base, customerId: x.customer_id as string, tariffId: x.tariff_id as string, tariffName: x.tariff_name as string, vatable: x.vatable as boolean, unit: x.unit as string, usage, readingId: (x.reading_id as string) ?? null, lines: bill.lines, subtotal: bill.subtotal, lateFees: fees, lateFeeTotal: Math.round(fees.reduce((s, l) => s + l.amount, 0) * 100) / 100 });
    }
    return { period, ready, held, totals: { count: ready.length, subtotal: ready.reduce((s, r) => s + r.subtotal, 0), lateFee: ready.reduce((s, r) => s + r.lateFeeTotal, 0) } };
  }

  async preview(tenantId: string, period: string) {
    const p = await this.plan(tenantId, period);
    return { ...p, ready: p.ready.map((r) => ({ connectionId: r.connectionId, number: r.number, customerName: r.customerName, tariffName: r.tariffName, usage: r.usage, unit: r.unit, subtotal: r.subtotal, lateFee: r.lateFeeTotal, lateFeeOf: r.lateFees.map((l) => `${l.number} (${l.daysLate} hari)`) })) };
  }

  private async key(tenantId: string, systemKey: string) {
    // perusahaan lama belum punya akun pendapatan non-air yang baru: dibuat otomatis dari bagan akun standar
    await this.posting.ensureSystemAccounts(this.db, tenantId, [systemKey as SystemKey]);
    const [a] = await this.repo.findAccountsBySystemKey(this.db, tenantId, systemKey);
    if (!a) throw new BadRequestException(`Akun ${systemKey} belum tersedia — pastikan jenis usaha perusahaan adalah Utilitas lalu muat ulang aplikasi`);
    return a.id;
  }

  async run(u: AuthUser, dto: BillRunDto) {
    const rules = await this.rules(u.tenantId);
    const plan = await this.plan(u.tenantId, dto.period);
    const acct = {
      FIXED: await this.key(u.tenantId, SYS.UTILITY_FIXED_REVENUE),
      USAGE: await this.key(u.tenantId, SYS.UTILITY_USAGE_REVENUE),
      ADMIN: await this.key(u.tenantId, SYS.UTILITY_ADMIN_REVENUE),
      LATE_FEE: await this.key(u.tenantId, SYS.UTILITY_LATE_FEE_REVENUE),
    } as const;
    const today = todayJakarta();
    const billed: { number: string; invoice: string; total: number }[] = [];
    const failed: { number: string; reason: string }[] = [];
    for (const item of plan.ready) {
      // klaim periode lebih dulu: unik per sambungan + periode, sehingga tidak mungkin tertagih dua kali meski dijalankan bersamaan
      let claimId: string;
      try {
        const [claim] = await this.repo.insertUtilityBills(this.db, u, item.connectionId, dto.period, item.usage, item.subtotal.toFixed(2), item.lateFeeTotal.toFixed(2));
        claimId = claim.id;
      } catch (e) {
        if (isUnique(e)) { failed.push({ number: item.number, reason: 'Sudah ditagih / sedang diproses' }); continue; }
        throw e;
      }
      try {
        const lineOf = (l: (typeof item.lines)[number]) => ({ description: l.description, qty: String(l.qty), unit: l.kind === 'USAGE' ? item.unit : 'Paket', price: l.price.toFixed(2), accountId: acct[l.kind] });
        const withLate = !item.vatable && item.lateFees.length > 0;
        const lines = [...item.lines.map(lineOf), ...(withLate ? item.lateFees.map((l) => ({ description: `Denda keterlambatan ${l.number}`, qty: '1', unit: 'Paket', price: l.amount.toFixed(2), accountId: acct.LATE_FEE })) : [])];
        const invoice = await this.billing.createInvoice(u, {
          customerId: item.customerId,
          date: today,
          dueDate: addDays(today, rules.dueDays),
          description: `${item.tariffName} periode ${dto.period} — sambungan ${item.number}`,
          withVat: item.vatable ? undefined : false,
          lines,
        });
        let lateInvoice: string | null = null;
        if (!withLate && item.lateFees.length) {
          const li = await this.billing.createInvoice(u, {
            customerId: item.customerId,
            date: today,
            dueDate: addDays(today, rules.dueDays),
            description: `Denda keterlambatan — sambungan ${item.number}`,
            withVat: false,
            lines: item.lateFees.map((l) => ({ description: `Denda keterlambatan ${l.number}`, qty: '1', unit: 'Paket', price: l.amount.toFixed(2), accountId: acct.LATE_FEE })),
          });
          lateInvoice = li.number;
        }
        await this.db.transaction(async (tx) => {
          await patchById(tx, utilityBills, claimId, { invoiceId: invoice.id });
          if (item.readingId) await patchById(tx, utilityReadings, item.readingId, { status: 'BILLED', billId: claimId });
          for (const l of item.lateFees) await this.repo.insertUtilityLateFees(tx, u.tenantId, l.invoiceId, claimId, l.amount);
          await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityBill', entityId: claimId, data: { connection: item.number, period: dto.period, invoice: invoice.number, subtotal: item.subtotal, lateFee: item.lateFeeTotal, lateInvoice } });
        });
        billed.push({ number: item.number, invoice: invoice.number, total: item.subtotal + item.lateFeeTotal });
      } catch (e) {
        // faktur gagal dibuat: lepas klaim agar bisa diulang
        await this.repo.deleteUtilityBillsByIdAndInvoiceId(this.db, claimId);
        failed.push({ number: item.number, reason: e instanceof Error ? e.message : 'Gagal membuat faktur' });
      }
    }
    return { period: dto.period, billedCount: billed.length, billedTotal: billed.reduce((s, b) => s + b.total, 0), billed, failed, held: plan.held };
  }

  async overdue(tenantId: string) {
    const rules = await this.rules(tenantId);
    const today = todayJakarta();
    const r = await this.repo.queryUtilityBillForOverdue(this.db, today, tenantId);
    return r.rows.map((x) => ({ ...x, outstanding: x.outstanding as string, suggestSuspend: x.status === 'ACTIVE' && Number(x.daysLate) > rules.suspendAfterDays }));
  }

  async controls(tenantId: string) {
    const period = todayJakarta().slice(0, 7);
    const prev2 = (() => { const [y, m] = period.split('-').map(Number); const d = new Date(Date.UTC(y, m - 3, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
    const q = async (query: ReturnType<typeof sql>) => (await this.repo.queryControls(this.db, query)).rows;
    const noReading = await q(sql`
      SELECT c.number, cu.name AS customer, c.address, (SELECT MAX(r.period) FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED') AS "lastPeriod"
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${prev2}
        AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' AND r.period > ${prev2}) LIMIT 100`);
    const zero = await q(sql`
      SELECT c.number, cu.name AS customer, c.address FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND (SELECT COUNT(*) FROM (SELECT usage FROM utility_readings r WHERE r.connection_id = c.id AND r.status <> 'REJECTED' ORDER BY period DESC LIMIT 3) z WHERE z.usage = 0) = 3 LIMIT 100`);
    const stale = await q(sql`
      SELECT c.number, cu.name AS customer, r.period, (${todayJakarta()}::date - r.entered_at::date)::int AS days FROM utility_readings r JOIN utility_connections c ON c.id = r.connection_id JOIN customers cu ON cu.id = c.customer_id
      WHERE r.tenant_id = ${tenantId} AND r.status = 'ENTERED' AND r.entered_at < now() - interval '5 days' ORDER BY r.entered_at LIMIT 100`);
    const flagged = await q(sql`
      SELECT c.number, cu.name AS customer, r.period, r.usage, r.flags FROM utility_readings r JOIN utility_connections c ON c.id = r.connection_id JOIN customers cu ON cu.id = c.customer_id
      WHERE r.tenant_id = ${tenantId} AND r.status = 'ENTERED' AND cardinality(r.flags) > 0 ORDER BY r.entered_at DESC LIMIT 100`);
    const dup = await q(sql`
      SELECT lower(btrim(c.address)) AS address, t.service_type AS service, COUNT(*)::int AS n, string_agg(c.number, ', ') AS numbers
      FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.status <> 'DISCONNECTED'
      GROUP BY lower(btrim(c.address)), t.service_type HAVING COUNT(*) > 1 LIMIT 100`);
    const selfVerified = await q(sql`
      SELECT c.number, cu.name AS customer, r.period, u.name AS "userName" FROM utility_readings r JOIN utility_connections c ON c.id = r.connection_id JOIN customers cu ON cu.id = c.customer_id JOIN users u ON u.id = r.entered_by_id
      WHERE r.tenant_id = ${tenantId} AND r.verified_by_id = r.entered_by_id AND r.status IN ('VERIFIED','BILLED') ORDER BY r.verified_at DESC LIMIT 100`);
    const zoneRows = (await zoneLoss(this.db, tenantId, prev2, period)).filter((z) => z.status === 'HIGH' || z.status === 'NEGATIVE');
    const highLoss = zoneRows.map((z) => ({ zone: z.zone, period: z.period, supplied: z.supplied, usage: z.usage, lossPct: z.lossPct, status: ZONE_STATUS_LABEL[z.status] }));
    return [
      { key: 'ZONE_LOSS', title: `Zona dengan kehilangan tinggi atau pemakaian melebihi pasokan (> ${LOSS_WARN_PCT}%)`, severity: 'high', items: highLoss },
      { key: 'NO_READING', title: 'Sambungan aktif tanpa pencatatan 2+ bulan (pendapatan bocor?)', severity: 'high', items: noReading },
      { key: 'ZERO_USAGE', title: 'Pemakaian nol 3 bulan berturut-turut (meter macet / sambungan ilegal?)', severity: 'medium', items: zero },
      { key: 'STALE', title: 'Pencatatan menunggu verifikasi lebih dari 5 hari', severity: 'medium', items: stale },
      { key: 'FLAGGED', title: 'Angka meter janggal menunggu pemeriksaan', severity: 'medium', items: flagged },
      { key: 'DUPLICATE', title: 'Beberapa sambungan di alamat dan layanan yang sama', severity: 'medium', items: dup },
      { key: 'SELF_VERIFIED', title: 'Dicatat dan diverifikasi oleh orang yang sama (hanya Pemilik)', severity: 'high', items: selfVerified },
    ];
  }

  async summary(tenantId: string) {
    const period = todayJakarta().slice(0, 7);
    const one = async (query: ReturnType<typeof sql>) => Number((await this.repo.querySummary(this.db, query)).rows[0]?.n ?? 0);
    const [active, suspended, awaiting, ready, missing] = await Promise.all([
      one(sql`SELECT COUNT(*)::int AS n FROM utility_connections WHERE tenant_id = ${tenantId} AND status = 'ACTIVE'`),
      one(sql`SELECT COUNT(*)::int AS n FROM utility_connections WHERE tenant_id = ${tenantId} AND status = 'SUSPENDED'`),
      one(sql`SELECT COUNT(*)::int AS n FROM utility_readings WHERE tenant_id = ${tenantId} AND status = 'ENTERED'`),
      one(sql`SELECT COUNT(*)::int AS n FROM utility_readings WHERE tenant_id = ${tenantId} AND status = 'VERIFIED'`),
      one(sql`SELECT COUNT(*)::int AS n FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${period}
        AND NOT EXISTS (SELECT 1 FROM utility_readings r WHERE r.connection_id = c.id AND r.period = ${period} AND r.status <> 'REJECTED')`),
    ]);
    const od = await this.overdue(tenantId);
    const today = todayJakarta();
    const monthStart = `${period}-01`;
    const rev = async (keys: readonly string[]) =>
      one(sql`SELECT COALESCE(SUM(l.credit - l.debit), 0)::numeric(18,2) AS n FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${monthStart} AND ${today} AND a.system_key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`);
    const [revenueAir, revenueNonAir, counters, receiptsToday, unconfirmedDays] = await Promise.all([
      rev(AIR_REVENUE_KEYS),
      rev(NON_AIR_REVENUE_KEYS),
      one(sql`SELECT COUNT(*)::int AS n FROM utility_counters WHERE tenant_id = ${tenantId} AND is_active`),
      one(sql`SELECT COALESCE(SUM(amount), 0)::numeric(18,2) AS n FROM utility_counter_receipts WHERE tenant_id = ${tenantId} AND received_at::date = ${today}`),
      one(sql`SELECT COUNT(*)::int AS n FROM (SELECT DISTINCT r.counter_id, r.received_at::date AS d FROM utility_counter_receipts r WHERE r.tenant_id = ${tenantId} AND r.counter_id IS NOT NULL AND r.received_at::date < ${today}) x
        WHERE NOT EXISTS (SELECT 1 FROM utility_counter_closings cl WHERE cl.tenant_id = ${tenantId} AND cl.counter_id = x.counter_id AND cl.date = x.d)`),
    ]);
    return { revenueAir, revenueNonAir, counters, receiptsToday, unconfirmedDays, period, active, suspended, awaitingVerification: awaiting, readyToBill: ready, missingReadings: missing, overdueCount: od.length, overdueTotal: od.reduce((s, x) => s + num(x.outstanding), 0), suggestSuspend: od.filter((x) => x.suggestSuspend).length };
  }
}

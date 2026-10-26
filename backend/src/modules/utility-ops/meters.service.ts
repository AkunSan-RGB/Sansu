import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { METER_CALIBRATION_YEARS, METER_STATUS_LABELS, addYears } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { CalibrateDto, MeterDto, MeterStatusDto, ReplaceMeterDto } from './meters.dto';
import { MetersRepository } from './meters.repository';

/** Inventaris meter air: stok di gudang, terpasang di sambungan, rusak, pensiun, dan jadwal tera ulang (bawaan 5 tahun) */
@Injectable()
export class MetersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: MetersRepository,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, q: { status?: string; q?: string; due?: string }) { return this.repo.list(this.db, tenantId, { status: q.status || undefined, q: q.q, due: q.due === 'true' }); }
  summary(tenantId: string) { return this.repo.summary(this.db, tenantId); }
  async get(tenantId: string, id: string) {
    const m = await this.repo.byId(this.db, tenantId, id);
    if (!m) throw new NotFoundException('Meter tidak ditemukan');
    return { ...m, events: await this.repo.events(this.db, tenantId, id) };
  }
  async sync(u: AuthUser) {
    const n = await this.repo.syncFromConnections(this.db, u.tenantId, u.sub);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityMeter', entityId: u.tenantId, data: { imported: n } });
    return { imported: n };
  }

  async register(u: AuthUser, dto: MeterDto) {
    const last = dto.lastCalibratedOn?.slice(0, 10) ?? null;
    try {
      const id = await this.repo.insert(this.db, { tenantId: u.tenantId, serial: dto.serial.trim(), brand: dto.brand?.trim() || null, size: dto.size?.trim() || null, lastCalibratedOn: last, nextCalibrationOn: last ? addYears(last, METER_CALIBRATION_YEARS) : null, initialReading: dto.initialReading ?? '0', note: dto.note?.trim() || null });
      await this.repo.event(this.db, u.tenantId, id, 'REGISTRASI', u.sub, { note: dto.note });
      await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityMeter', entityId: id, data: { serial: dto.serial } });
      return { id };
    } catch (e) {
      if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new BadRequestException('Nomor seri meter sudah terdaftar');
      throw e;
    }
  }

  async calibrate(u: AuthUser, id: string, dto: CalibrateDto) {
    const m = await this.repo.byId(this.db, u.tenantId, id);
    if (!m) throw new NotFoundException('Meter tidak ditemukan');
    if (m.status === 'PENSIUN') throw new BadRequestException('Meter yang sudah pensiun tidak ditera');
    const date = (dto.date ?? todayJakarta()).slice(0, 10);
    if (date > todayJakarta()) throw new BadRequestException('Tanggal tera tidak boleh di masa depan');
    await this.repo.setCalibration(this.db, u.tenantId, id, date, addYears(date, METER_CALIBRATION_YEARS));
    await this.repo.event(this.db, u.tenantId, id, 'TERA', u.sub, { connectionId: m.connection_id, note: dto.note });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityMeter', entityId: id, data: { serial: m.serial, calibrated: date } });
    return this.get(u.tenantId, id);
  }

  async setStatus(u: AuthUser, id: string, dto: MeterStatusDto) {
    const m = await this.repo.byId(this.db, u.tenantId, id);
    if (!m) throw new NotFoundException('Meter tidak ditemukan');
    if (m.status === 'TERPASANG') throw new BadRequestException('Meter masih terpasang di sambungan; gantikan lewat Ganti meter');
    await this.repo.setStatus(this.db, u.tenantId, id, dto.status, false);
    await this.repo.event(this.db, u.tenantId, id, dto.status === 'STOK' ? 'LEPAS' : dto.status, u.sub, { note: `${METER_STATUS_LABELS[dto.status]}: ${dto.note}` });
    return this.get(u.tenantId, id);
  }

  /** Ganti meter pada sambungan: meter lama dilepas, meter baru dipasang, nomor meter sambungan ikut berubah */
  async replace(u: AuthUser, dto: ReplaceMeterDto) {
    return this.db.transaction(async (tx) => {
      const c = await this.repo.connection(tx, u.tenantId, dto.connectionId);
      if (!c) throw new NotFoundException('Sambungan tidak ditemukan');
      if (!c.metered) throw new BadRequestException('Sambungan ini tarif tetap (tanpa meter)');
      if (c.status === 'DISCONNECTED') throw new BadRequestException('Sambungan sudah ditutup');
      const fresh = await this.repo.byId(tx, u.tenantId, dto.newMeterId, true);
      if (!fresh) throw new NotFoundException('Meter pengganti tidak ditemukan');
      if (fresh.status !== 'STOK') throw new BadRequestException(`Meter pengganti harus berstatus "${METER_STATUS_LABELS.STOK}" (sekarang: ${METER_STATUS_LABELS[fresh.status as keyof typeof METER_STATUS_LABELS]})`);
      if (await this.repo.meterNoTaken(tx, u.tenantId, c.id, fresh.serial)) throw new BadRequestException('Nomor seri itu sudah dipakai sambungan lain');
      const old = await this.repo.currentMeterOf(tx, u.tenantId, c.id);
      if (old) {
        await this.repo.setStatus(tx, u.tenantId, old.id, dto.oldStatus, true);
        await this.repo.event(tx, u.tenantId, old.id, dto.oldStatus === 'RUSAK' ? 'RUSAK' : dto.oldStatus === 'PENSIUN' ? 'PENSIUN' : 'LEPAS', u.sub, { connectionId: c.id, note: dto.reason });
      }
      await this.repo.attach(tx, u.tenantId, fresh.id, c.id);
      await this.repo.setConnectionMeter(tx, u.tenantId, c.id, fresh.serial);
      await this.repo.event(tx, u.tenantId, fresh.id, 'PASANG', u.sub, { connectionId: c.id, note: dto.reason });
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'UPDATE', entity: 'UtilityMeter', entityId: fresh.id, data: { connection: c.number, old: old?.serial ?? c.meter_no, new: fresh.serial, reason: dto.reason } });
      return { connection: c.number, oldSerial: old?.serial ?? c.meter_no, newSerial: fresh.serial, newInitialReading: fresh.initial_reading, hint: 'Pada pencatatan meter berikutnya centang "meter diganti" lalu isi angka akhir meter lama dan angka awal meter baru.' };
    });
  }
}

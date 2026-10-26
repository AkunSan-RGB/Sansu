import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { CustomersService } from '../master-data/customers/customers.service';
import { UtilityService } from '../utility/utility.service';
import { ImportConnectionsDto, ImportRowDto } from './import.dto';
import { ImportRepository } from './import.repository';
import { RoutesRepository } from './routes.repository';

export interface ImportRowResult { row: number; ok: boolean; status: 'BARU' | 'DILEWATI' | 'GALAT'; message?: string; connection?: string }

const norm = (s?: string) => (s ?? '').trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Impor massal pelanggan + sambungan dari data lama: diperiksa penuh lebih dulu (pratinjau), baru disimpan; baris bermasalah tidak menahan baris lain */
@Injectable()
export class ImportService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: ImportRepository,
    private readonly routes: RoutesRepository,
    private readonly customers: CustomersService,
    private readonly util: UtilityService,
    private readonly audit: AuditService,
  ) {}

  async run(u: AuthUser, dto: ImportConnectionsDto) {
    const rows = dto.rows;
    const [tariffs, routes] = await Promise.all([this.repo.tariffs(this.db, u.tenantId), this.repo.routes(this.db, u.tenantId)]);
    const tariffBy = new Map(tariffs.map((t) => [t.name.trim().toLowerCase(), t]));
    const routeBy = new Map(routes.map((r) => [r.code.toUpperCase(), r.id]));
    const codes = [...new Set(rows.map((r) => norm(r.code).toUpperCase()).filter(Boolean))];
    const existingCust = new Map((await this.repo.customersByCodes(this.db, u.tenantId, codes)).map((c) => [c.code, c.id]));
    const meters = [...new Set(rows.map((r) => norm(r.meterNo)).filter(Boolean))];
    const metersTaken = new Map((await this.repo.metersTaken(this.db, u.tenantId, meters)).map((m) => [m.meter_no, m.number]));
    const addrs = [...new Set(rows.map((r) => norm(r.address).toLowerCase()).filter(Boolean))];
    const addrTaken = (await this.repo.addressesTaken(this.db, u.tenantId, addrs));
    const today = todayJakarta();
    const seenMeter = new Set<string>();
    const seenAddr = new Set<string>();
    const out: ImportRowResult[] = [];
    let created = 0;

    for (const [i, r] of rows.entries()) {
      const n = i + 1;
      const err = (message: string) => out.push({ row: n, ok: false, status: 'GALAT', message });
      const name = norm(r.name);
      const address = norm(r.address);
      const tariff = tariffBy.get(norm(r.tariff).toLowerCase());
      const meterNo = norm(r.meterNo);
      if (name.length < 2) { err('Nama pelanggan kosong'); continue; }
      if (address.length < 5) { err('Alamat kurang dari 5 huruf'); continue; }
      if (!tariff) { err(`Golongan "${norm(r.tariff)}" tidak ada di Tarif air`); continue; }
      if (tariff.metered && !meterNo) { err('Nomor meter wajib untuk golongan bermeter'); continue; }
      if (!tariff.metered && meterNo) { err('Golongan tarif tetap tidak memakai nomor meter'); continue; }
      const installedAt = norm(r.installedAt) || undefined;
      if (installedAt && (!DATE.test(installedAt) || installedAt > today)) { err('Tanggal pasang harus YYYY-MM-DD dan tidak di masa depan'); continue; }
      const initial = norm(r.initialReading) || '0';
      if (!/^\d+([.,]\d+)?$/.test(initial)) { err('Angka meter harus angka tidak negatif'); continue; }
      const route = norm(r.route).toUpperCase();
      if (route && !routeBy.has(route)) { err(`Rute ${route} belum dibuat`); continue; }
      if (meterNo && (metersTaken.has(meterNo) || seenMeter.has(meterNo))) {
        out.push({ row: n, ok: true, status: 'DILEWATI', message: metersTaken.has(meterNo) ? `Nomor meter sudah terdaftar pada sambungan ${metersTaken.get(meterNo)}` : 'Nomor meter kembar di berkas ini', connection: metersTaken.get(meterNo) });
        continue;
      }
      const addrKey = address.toLowerCase();
      if (addrTaken.some((a) => a.address === addrKey && a.service_type === tariff.service_type) || seenAddr.has(`${addrKey}|${tariff.service_type}`)) {
        out.push({ row: n, ok: true, status: 'DILEWATI', message: 'Alamat ini sudah punya sambungan layanan yang sama' });
        continue;
      }
      if (meterNo) seenMeter.add(meterNo);
      seenAddr.add(`${addrKey}|${tariff.service_type}`);
      if (dto.dryRun) { out.push({ row: n, ok: true, status: 'BARU' }); continue; }

      // simpan: pelanggan (baru atau yang sudah ada menurut kode) lalu sambungannya
      let customerId = existingCust.get(norm(r.code).toUpperCase());
      let createdCustomer = false;
      try {
        if (!customerId) {
          const code = norm(r.code) ? norm(r.code).toUpperCase() : `IMP-${Date.now().toString(36)}-${n}`.toUpperCase();
          const c = await this.customers.create(u.tenantId, { code, name, address, phone: norm(r.phone) || undefined, email: norm(r.email) || undefined, creditLimit: '0', paymentTermDays: 14 } as Parameters<CustomersService['create']>[1]);
          customerId = c.id;
          createdCustomer = true;
          if (norm(r.code)) existingCust.set(code, c.id);
        }
        const conn = (await this.util.createConnection(u, { customerId, tariffId: tariff.id, meterNo: meterNo || undefined, address, installedAt, initialReading: initial.replace(',', '.'), zone: norm(r.zone) || undefined })) as { id: string; number: string };
        if (route) await this.routes.assign(this.db, u.tenantId, routeBy.get(route)!, [conn.id]);
        created++;
        out.push({ row: n, ok: true, status: 'BARU', connection: conn.number });
      } catch (e) {
        if (createdCustomer && customerId) await this.repo.deleteCustomer(this.db, u.tenantId, customerId).catch(() => undefined);
        err(e instanceof Error ? e.message : 'Gagal menyimpan');
      }
    }
    if (!dto.dryRun) await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'IMPORT', entity: 'UtilityConnection', entityId: u.tenantId, data: { rows: rows.length, created } });
    return {
      dryRun: !!dto.dryRun,
      total: rows.length,
      created: dto.dryRun ? out.filter((x) => x.status === 'BARU').length : created,
      skipped: out.filter((x) => x.status === 'DILEWATI').length,
      errors: out.filter((x) => x.status === 'GALAT').length,
      results: out.filter((x) => x.status !== 'BARU' || !dto.dryRun).slice(0, 300),
    };
  }
}

export type { ImportRowDto };
export const IMPORT_COLUMNS = ['code', 'name', 'phone', 'email', 'address', 'tariff', 'meterNo', 'initialReading', 'installedAt', 'zone', 'route'] as const;

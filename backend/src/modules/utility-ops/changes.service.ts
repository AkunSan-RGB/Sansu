import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CHANGE_KIND_LABELS } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { UtilityService } from '../utility/utility.service';
import { ChangeRequestDto, DecideChangeDto, RejectChangeDto } from './changes.dto';
import { ChangesRepository, ConnectionFacts } from './changes.repository';
import { StaffRepository } from './staff.repository';

const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

/**
 * Mutasi pelanggan: balik nama, ganti golongan tarif, ubah alamat/zona, dan tutup permanen. Diajukan satu orang, disetujui orang lain
 * (Pemilik dikecualikan); syarat dicek saat diajukan dan sekali lagi saat disetujui, dan seluruh perubahan tercatat sebelum/sesudah.
 */
@Injectable()
export class ChangesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: ChangesRepository,
    private readonly staff: StaffRepository,
    private readonly audit: AuditService,
    private readonly util: UtilityService,
  ) {}

  list(tenantId: string, q: { status?: string; connectionId?: string }) { return this.repo.list(this.db, tenantId, { status: q.status || undefined, connectionId: q.connectionId || undefined }); }

  /** Periksa syarat dan susun isi sebelum/sesudah; dipakai saat mengajukan dan saat menyetujui */
  private async prepare(tenantId: string, dto: Pick<ChangeRequestDto, 'connectionId' | 'kind' | 'newCustomerId' | 'newTariffId' | 'newAddress' | 'newZone'>, facts: ConnectionFacts) {
    switch (dto.kind) {
      case 'BALIK_NAMA': {
        if (!dto.newCustomerId) throw new BadRequestException('Pilih pelanggan pemilik baru');
        if (dto.newCustomerId === facts.customer_id) throw new BadRequestException('Pemilik baru sama dengan pemilik sekarang');
        const nc = await this.staff.customer(this.db, tenantId, dto.newCustomerId);
        if (!nc) throw new BadRequestException('Pelanggan pemilik baru tidak ditemukan');
        const open = await this.repo.openAmount(this.db, tenantId, facts.id);
        if (open > 0) throw new BadRequestException(`Masih ada tagihan belum lunas ${rp(open)} atas nama pemilik lama; lunasi dulu sebelum balik nama`);
        return { before: { customerId: facts.customer_id, customer: facts.customer_name }, after: { customerId: nc.id, customer: nc.name } };
      }
      case 'GANTI_TARIF': {
        if (!dto.newTariffId) throw new BadRequestException('Pilih golongan tarif baru');
        if (dto.newTariffId === facts.tariff_id) throw new BadRequestException('Golongan tarif baru sama dengan yang sekarang');
        const nt = await this.repo.tariff(this.db, tenantId, dto.newTariffId);
        if (!nt) throw new BadRequestException('Golongan tarif baru tidak ditemukan atau nonaktif');
        if (nt.metered !== facts.metered) throw new BadRequestException('Golongan baru harus sama jenis pengukurannya (terukur meter / tarif tetap) dengan yang sekarang');
        if ((await this.repo.pendingReadings(this.db, tenantId, facts.id)) > 0) throw new BadRequestException('Masih ada catatan meter yang belum ditagih; terbitkan tagihannya dulu agar tarif lama tidak tertukar');
        return { before: { tariffId: facts.tariff_id, tariff: facts.tariff_name }, after: { tariffId: nt.id, tariff: nt.name } };
      }
      case 'PINDAH_ALAMAT': {
        const addr = (dto.newAddress ?? '').trim();
        if (addr.length < 5) throw new BadRequestException('Isi alamat baru (minimal 5 huruf)');
        if (await this.repo.addressTaken(this.db, tenantId, facts.id, addr)) throw new BadRequestException('Alamat itu sudah dipakai sambungan lain');
        return { before: { address: facts.address, zone: facts.zone }, after: { address: addr, zone: dto.newZone?.trim() || null } };
      }
      case 'TUTUP_PERMANEN': {
        if (facts.status === 'DISCONNECTED') throw new BadRequestException('Sambungan sudah ditutup');
        const open = await this.repo.openAmount(this.db, tenantId, facts.id);
        if (open > 0) throw new BadRequestException(`Masih ada tagihan belum lunas ${rp(open)}; lunasi dulu sebelum sambungan ditutup`);
        if ((await this.repo.pendingReadings(this.db, tenantId, facts.id)) > 0) throw new BadRequestException('Masih ada catatan meter yang belum ditagih; terbitkan tagihan terakhir dulu');
        return { before: { status: facts.status }, after: { status: 'DISCONNECTED' } };
      }
    }
  }

  async request(u: AuthUser, dto: ChangeRequestDto) {
    const facts = await this.repo.facts(this.db, u.tenantId, dto.connectionId);
    if (!facts) throw new BadRequestException('Sambungan tidak ditemukan');
    if (facts.status === 'DISCONNECTED') throw new BadRequestException('Sambungan sudah ditutup');
    if (await this.repo.pendingFor(this.db, u.tenantId, facts.id, dto.kind)) throw new BadRequestException(`Sudah ada pengajuan ${CHANGE_KIND_LABELS[dto.kind].toLowerCase()} yang menunggu persetujuan untuk sambungan ini`);
    const { before, after } = await this.prepare(u.tenantId, dto, facts);
    const id = await this.repo.insert(this.db, { tenantId: u.tenantId, connectionId: facts.id, kind: dto.kind, before, after, reason: dto.reason.trim(), requestedById: u.sub });
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityConnectionChange', entityId: id, data: { kind: dto.kind, connection: facts.number } });
    return this.repo.byId(this.db, u.tenantId, id);
  }

  async approve(u: AuthUser, id: string, dto: DecideChangeDto) {
    const ch = await this.repo.byId(this.db, u.tenantId, id);
    if (!ch) throw new NotFoundException('Pengajuan tidak ditemukan');
    if (ch.status !== 'DIAJUKAN') throw new BadRequestException('Pengajuan ini sudah diputuskan');
    if (ch.requested_by_id === u.sub && u.role !== 'OWNER') throw new ForbiddenException('Pengajuan harus disetujui orang lain dari pengaju (pemisahan fungsi)');
    const facts = await this.repo.facts(this.db, u.tenantId, ch.connection_id);
    if (!facts) throw new NotFoundException('Sambungan tidak ditemukan');
    const after = (ch.after ?? {}) as Record<string, string | null>;
    // syarat dicek ulang: keadaan bisa berubah sejak diajukan
    await this.prepare(u.tenantId, { connectionId: facts.id, kind: ch.kind as ChangeRequestDto['kind'], newCustomerId: after.customerId ?? undefined, newTariffId: after.tariffId ?? undefined, newAddress: after.address ?? undefined, newZone: after.zone ?? undefined }, facts);
    if (ch.kind === 'TUTUP_PERMANEN') {
      await this.util.disconnect(u, facts.id, { reason: `Tutup permanen: ${ch.reason}` });
    } else {
      await this.db.transaction(async (tx) => {
        if (ch.kind === 'BALIK_NAMA') await this.repo.applyOwner(tx, u.tenantId, facts.id, after.customerId!);
        else if (ch.kind === 'GANTI_TARIF') await this.repo.applyTariff(tx, u.tenantId, facts.id, after.tariffId!);
        else await this.repo.applyAddress(tx, u.tenantId, facts.id, after.address!, after.zone ?? null);
      });
    }
    await this.repo.decide(this.db, u.tenantId, id, 'DISETUJUI', u.sub, dto.note?.trim() || null);
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'APPROVE', entity: 'UtilityConnectionChange', entityId: id, data: { kind: ch.kind, connection: facts.number, before: ch.before, after: ch.after } });
    return this.repo.byId(this.db, u.tenantId, id);
  }

  async reject(u: AuthUser, id: string, dto: RejectChangeDto) {
    const ch = await this.repo.byId(this.db, u.tenantId, id);
    if (!ch) throw new NotFoundException('Pengajuan tidak ditemukan');
    if (ch.status !== 'DIAJUKAN') throw new BadRequestException('Pengajuan ini sudah diputuskan');
    await this.repo.decide(this.db, u.tenantId, id, 'DITOLAK', u.sub, dto.note.trim());
    await this.audit.log(this.db, { tenantId: u.tenantId, userId: u.sub, action: 'REJECT', entity: 'UtilityConnectionChange', entityId: id, data: { kind: ch.kind } });
    return this.repo.byId(this.db, u.tenantId, id);
  }
}

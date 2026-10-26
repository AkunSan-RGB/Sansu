import { BadRequestException, Injectable } from '@nestjs/common';
import { NOTICE_KIND_LABELS, spLevelFor, whatsappLink, type NoticeKind } from '@sansu/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { NoticeLogDto } from './notices.dto';
import { CandidateRow, NoticesRepository } from './notices.repository';

const rp = (v: unknown) => `Rp${Math.round(Number(v)).toLocaleString('id-ID')}`;
const tgl = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Cetak dan kirim massal: rekening, pengingat, dan surat peringatan bertingkat; pengiriman dicatat agar tidak dobel dan bisa ditelusuri */
@Injectable()
export class NoticesService {
  constructor(@InjectDb() private readonly db: Db, private readonly repo: NoticesRepository, private readonly audit: AuditService) {}

  private message(kind: NoticeKind, r: CandidateRow, company: string): string {
    const sisa = rp(r.outstanding);
    const tutup = `Terima kasih. — ${company}`;
    switch (kind) {
      case 'REKENING': return `Yth. ${r.customer}, rekening air sambungan ${r.number} periode ${r.periods} sebesar ${sisa}, jatuh tempo ${tgl(r.oldest_due)}. Bayar di loket atau lewat tautan portal pelanggan. ${tutup}`;
      case 'PENGINGAT': return `Yth. ${r.customer}, mengingatkan tagihan air sambungan ${r.number} sebesar ${sisa} jatuh tempo ${tgl(r.oldest_due)}. ${tutup}`;
      case 'SP1': return `SURAT PERINGATAN 1. Yth. ${r.customer}, tagihan air sambungan ${r.number} sebesar ${sisa} terlambat ${r.days_late} hari. Mohon segera dilunasi agar layanan tidak terganggu. ${tutup}`;
      case 'SP2': return `SURAT PERINGATAN 2. Yth. ${r.customer}, tagihan air sambungan ${r.number} sebesar ${sisa} terlambat ${r.days_late} hari. Bila tidak dilunasi, sambungan akan diusulkan untuk disegel. ${tutup}`;
      case 'SP3': return `SURAT PERINGATAN 3. Yth. ${r.customer}, tagihan air sambungan ${r.number} sebesar ${sisa} terlambat ${r.days_late} hari. Sambungan akan diputus bila tidak dilunasi dalam waktu dekat. ${tutup}`;
      default: return `Yth. ${r.customer}, ${NOTICE_KIND_LABELS[kind]} untuk sambungan ${r.number}. ${tutup}`;
    }
  }

  /** Daftar penerima untuk satu jenis surat, siap dicetak atau dikirim lewat WhatsApp */
  async candidates(tenantId: string, kind: NoticeKind, period?: string) {
    const today = todayJakarta();
    const mode = kind === 'REKENING' ? 'REKENING' : kind === 'PENGINGAT' ? 'PENGINGAT' : 'TUNGGAKAN';
    if (kind === 'TAUTAN') throw new BadRequestException('Tautan portal dibuat dari menu Portal pelanggan');
    const p = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : today.slice(0, 7);
    const co = (await this.repo.tenantName(this.db, tenantId))?.name ?? 'PAM';
    let rows = await this.repo.candidates(this.db, tenantId, today, mode, mode === 'REKENING' ? p : null);
    if (kind === 'SP1' || kind === 'SP2' || kind === 'SP3') rows = rows.filter((r) => spLevelFor(r.days_late) === kind);
    const out = rows.map((r) => {
      const message = this.message(kind, r, co);
      const sentBefore = r.last_notice_kind === kind;
      return { ...r, message, whatsapp: whatsappLink(r.phone, message), sentBefore, alreadyToday: sentBefore && !!r.last_notice_at && r.last_notice_at.slice(0, 10) === today };
    });
    return { kind, period: kind === 'REKENING' ? p : null, company: co, total: out.reduce((a, r) => a + Number(r.outstanding), 0), rows: out };
  }

  async log(u: AuthUser, dto: NoticeLogDto) {
    const ids = [...new Set(dto.items.map((i) => i.connectionId))];
    const ok = new Set((await this.repo.validConnections(this.db, u.tenantId, ids)).map((r) => r.id));
    if (ok.size !== ids.length) throw new BadRequestException('Ada sambungan yang tidak ditemukan');
    await this.db.transaction(async (tx) => {
      await this.repo.log(tx, u.tenantId, u.sub, dto.kind, dto.channel, dto.items, dto.note?.trim() || null);
      await this.audit.log(tx, { tenantId: u.tenantId, userId: u.sub, action: 'CREATE', entity: 'UtilityNotice', entityId: u.tenantId, data: { kind: dto.kind, channel: dto.channel, count: dto.items.length } });
    });
    return { count: dto.items.length };
  }
  history(tenantId: string, connectionId?: string, kind?: string) { return this.repo.history(this.db, tenantId, { connectionId: connectionId || undefined, kind: kind || undefined }); }
  async summary(tenantId: string) { return { last30d: await this.repo.summary(this.db, tenantId) }; }
}

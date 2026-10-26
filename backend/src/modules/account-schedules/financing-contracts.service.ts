import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { D } from '../../common/utils/money';
import { ReferenceRepository } from '../../db/reference.repository';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import type { financingContracts } from '../../db/schema';
import { buildContractSchedule, contractYear, METHODS_BY_KIND, type ContractTerms } from './contract-calc';
import type { ContractDto, UpdateContractDto } from './financing-contracts.dto';
import { FinancingContractsRepository } from './financing-contracts.repository';

type Row = typeof financingContracts.$inferSelect;
const isUnique = (e: unknown) => ['23505'].includes((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? '');

export const termsOf = (c: Row): ContractTerms => ({ kind: c.kind, amount: c.amount, ratePct: c.ratePct, startDate: c.startDate, termMonths: c.termMonths, method: c.method });

/** Data induk kontrak pembiayaan: pinjaman, sewa pembiayaan, biaya dibayar di muka (jadwalnya dihitung dari syarat kontrak) */
@Injectable()
export class FinancingContractsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly repo: FinancingContractsRepository,
    private readonly refs: ReferenceRepository,
    private readonly audit: AuditService,
  ) {}

  private async validate(tenantId: string, v: ContractDto) {
    if (!METHODS_BY_KIND[v.kind].includes(v.method)) throw new BadRequestException('Metode tidak sesuai dengan jenis kontrak');
    if (D(v.amount).lte(0)) throw new BadRequestException('Jumlah kontrak harus lebih dari nol');
    if (v.kind !== 'PREPAID') {
      if (v.ratePct === undefined || v.ratePct === '') throw new BadRequestException('Bunga per tahun wajib diisi untuk pinjaman dan sewa (isi 0 bila tanpa bunga)');
      if (D(v.ratePct).lt(0) || D(v.ratePct).gt(100)) throw new BadRequestException('Bunga per tahun harus 0–100%');
    }
    const acc = await this.refs.account(this.db, tenantId, v.accountId);
    if (!acc || !acc.isPostable) throw new BadRequestException('Akun saldo kontrak tidak ditemukan atau bukan akun posting');
    const wantType = v.kind === 'PREPAID' ? 'ASSET' : 'LIABILITY';
    if (acc.type !== wantType) throw new BadRequestException(v.kind === 'PREPAID' ? 'Biaya dibayar di muka dicatat di akun aset' : 'Pinjaman dan sewa dicatat di akun liabilitas');
    if (v.expenseAccountId) {
      const exp = await this.refs.account(this.db, tenantId, v.expenseAccountId);
      if (!exp || exp.type !== 'EXPENSE') throw new BadRequestException('Akun beban tidak ditemukan atau bukan akun beban');
    }
  }

  private shape(c: Row, year: number) {
    const y = contractYear(buildContractSchedule(termsOf(c)), year);
    return { ...c, endDate: this.endDate(c), balance: y.closing.toFixed(2), yearInterest: y.interest.toFixed(2), yearPrincipal: y.principal.toFixed(2) };
  }

  private endDate(c: Row) {
    const rows = buildContractSchedule(termsOf(c));
    return `${rows[rows.length - 1].period}`;
  }

  async list(tenantId: string, year: number) {
    return (await this.repo.list(this.db, tenantId)).map((c) => this.shape(c, year));
  }

  async create(user: AuthUser, dto: ContractDto) {
    await this.validate(user.tenantId, dto);
    try {
      const row = await this.repo.insert(this.db, {
        tenantId: user.tenantId,
        kind: dto.kind,
        name: dto.name.trim(),
        counterparty: dto.counterparty?.trim() || null,
        accountId: dto.accountId,
        expenseAccountId: dto.expenseAccountId ?? null,
        startDate: dto.startDate,
        termMonths: dto.termMonths,
        amount: D(dto.amount).toFixed(2),
        ratePct: dto.kind === 'PREPAID' ? null : D(dto.ratePct).toFixed(4),
        method: dto.method,
        notes: dto.notes?.trim() || null,
        createdById: user.sub,
      });
      await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'FinancingContract', entityId: row.id, data: { kind: row.kind, name: row.name, amount: row.amount } });
      return this.shape(row, Number(row.startDate.slice(0, 4)));
    } catch (e) {
      if (isUnique(e)) throw new BadRequestException('Nama kontrak sudah dipakai');
      throw e;
    }
  }

  async update(user: AuthUser, id: string, dto: UpdateContractDto) {
    const old = await this.repo.find(this.db, user.tenantId, id);
    if (!old) throw new NotFoundException('Kontrak tidak ditemukan');
    const merged = { ...old, ...dto, kind: old.kind, ratePct: dto.ratePct ?? old.ratePct ?? undefined, expenseAccountId: dto.expenseAccountId ?? old.expenseAccountId ?? undefined } as unknown as ContractDto;
    await this.validate(user.tenantId, merged);
    const patch: Partial<typeof financingContracts.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.counterparty !== undefined) patch.counterparty = dto.counterparty.trim() || null;
    if (dto.accountId !== undefined) patch.accountId = dto.accountId;
    if (dto.expenseAccountId !== undefined) patch.expenseAccountId = dto.expenseAccountId;
    if (dto.startDate !== undefined) patch.startDate = dto.startDate;
    if (dto.termMonths !== undefined) patch.termMonths = dto.termMonths;
    if (dto.amount !== undefined) patch.amount = D(dto.amount).toFixed(2);
    if (dto.ratePct !== undefined && old.kind !== 'PREPAID') patch.ratePct = D(dto.ratePct).toFixed(4);
    if (dto.method !== undefined) patch.method = dto.method;
    if (dto.notes !== undefined) patch.notes = dto.notes.trim() || null;
    if (dto.status !== undefined) patch.status = dto.status;
    try {
      const row = await this.repo.update(this.db, user.tenantId, id, patch);
      await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'FinancingContract', entityId: id, data: { before: { amount: old.amount, ratePct: old.ratePct, termMonths: old.termMonths, status: old.status }, after: patch } });
      return this.shape(row, Number(row.startDate.slice(0, 4)));
    } catch (e) {
      if (isUnique(e)) throw new BadRequestException('Nama kontrak sudah dipakai');
      throw e;
    }
  }

  /** Jadwal kontraktual lengkap per bulan selama masa kontrak */
  async schedule(tenantId: string, id: string) {
    const c = await this.repo.find(this.db, tenantId, id);
    if (!c) throw new NotFoundException('Kontrak tidak ditemukan');
    const rows = buildContractSchedule(termsOf(c));
    const f = (d: { toFixed(n: number): string }) => d.toFixed(2);
    return {
      contract: { id: c.id, kind: c.kind, name: c.name, method: c.method, amount: c.amount, ratePct: c.ratePct, startDate: c.startDate, termMonths: c.termMonths },
      rows: rows.map((r) => ({ period: r.period, opening: f(r.opening), additions: f(r.additions), principal: f(r.principal), interest: f(r.interest), payment: f(r.payment), closing: f(r.closing) })),
    };
  }
}

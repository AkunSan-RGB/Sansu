import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { PermissionsService } from '../../common/auth/permissions';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { customRoles, Role, users } from '../../db/schema';
import { RoleDto, UpdateRoleDto } from './custom-roles.dto';
import { findOwned, insertOne } from '../../db/owned';
import { CustomRolesRepository } from './custom-roles.repository';

/** Kunci di luar katalog: aksi akun sendiri dan panel pemilik layanan tidak boleh dicabut lewat peran khusus */
const EXCLUDED = /^[A-Z]+ \/(auth|platform|platform-admin|billing)(\/|$)/;

const GROUPS: Record<string, string> = {
  accounting: 'Akuntansi (jurnal, akun, periode)', assets: 'Aset tetap', budgets: 'Anggaran', fx: 'Mata uang asing', tax: 'Pajak', bank: 'Bank & rekonsiliasi',
  cash: 'Kas', 'petty-cash': 'Kas kecil', payments: 'Penerimaan pembayaran', invoices: 'Faktur penjualan', 'sales-orders': 'Pesanan penjualan', deliveries: 'Pengiriman',
  'sales-returns': 'Retur penjualan', services: 'Jasa & proyek', customers: 'Pelanggan', crm: 'CRM', pos: 'Kasir (POS)', 'purchase-requests': 'Permintaan pembelian',
  'purchase-orders': 'Pesanan pembelian', 'goods-receipts': 'Penerimaan barang', 'purchase-invoices': 'Faktur & pembayaran pemasok', 'purchase-returns': 'Retur pembelian',
  suppliers: 'Pemasok', inventory: 'Persediaan', products: 'Produk', warehouses: 'Gudang', production: 'Produksi', payroll: 'Penggajian', hr: 'Karyawan (SDM)',
  'price-lists': 'Daftar harga', promos: 'Promo & bonus barang', pricing: 'Harga & promo', 'sales-targets': 'Target & komisi sales',
  integrations: 'Integrasi & marketplace', branches: 'Cabang', imports: 'Impor data', approvals: 'Persetujuan', reminders: 'Pengingat', users: 'Pengguna', settings: 'Pengaturan', apps: 'Aplikasi',
};

const LABELS: Record<string, string> = {
  'POST /accounting/journals': 'Membuat jurnal manual', 'POST /accounting/period/lock': 'Mengunci periode', 'POST /accounting/period/close-year': 'Tutup buku tahunan',
  'POST /payments': 'Menerima pembayaran pelanggan', 'POST /purchase-invoices/payments': 'Membayar pemasok', 'POST /cash/transactions': 'Mencatat kas masuk/keluar',
  'POST /purchase-orders': 'Membuat pesanan pembelian', 'POST /purchase-orders/:id/confirm': 'Mengonfirmasi pesanan pembelian', 'POST /purchase-orders/:id/receipts': 'Menerima barang',
  'POST /invoices': 'Membuat faktur penjualan', 'POST /sales-orders': 'Membuat pesanan penjualan', 'POST /sales-orders/:id/confirm': 'Mengonfirmasi pesanan penjualan',
  'POST /inventory/adjustments': 'Menyesuaikan stok', 'POST /tax/payments': 'Mencatat setoran pajak', 'POST /payroll/runs/:id/post': 'Memposting jurnal gaji', 'POST /payroll/runs/:id/pay': 'Membayar gaji',
  'POST /assets/depreciation/run': 'Menjalankan penyusutan', 'POST /assets/:id/dispose': 'Melepas aset', 'POST /inventory/writedowns': 'Penurunan nilai persediaan', 'POST /fx/revaluation': 'Penilaian ulang valas',
  'POST /bank/signoffs': 'Mengesahkan rekonsiliasi bank', 'POST /purchase-requests/:id/approve': 'Menyetujui permintaan pembelian', 'POST /suppliers': 'Menambah pemasok', 'POST /customers': 'Menambah pelanggan',
};

const VERB: Record<string, string> = { POST: 'Buat/jalankan', PUT: 'Simpan', PATCH: 'Ubah', DELETE: 'Hapus' };

@Injectable()
export class CustomRolesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly perms: PermissionsService,
    private readonly audit: AuditService,
    private readonly repo: CustomRolesRepository,
  ) {}

  /** Hak tulis yang dimiliki peran dasar dan boleh dicabut, beserta label dan kelompok untuk tampilan */
  catalog(baseRole: Role) {
    return this.perms
      .allowedWrites(baseRole)
      .filter((k) => !EXCLUDED.test(k))
      .map((key) => {
        const [method, path] = key.split(' ');
        const group = GROUPS[path.split('/')[1]] ?? 'Lainnya';
        return { key, group, label: LABELS[key] ?? `${VERB[method] ?? method} ${path}` };
      })
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  }

  async list(tenantId: string) {
    const rows = await this.repo.countCustomRolesByName(this.db, tenantId);
    return rows;
  }

  private validDenied(baseRole: Role, denied: string[] | undefined) {
    const allowed = new Set(this.catalog(baseRole).map((c) => c.key));
    const uniq = [...new Set(denied ?? [])];
    const bad = uniq.filter((k) => !allowed.has(k));
    if (bad.length) throw new BadRequestException(`Hak tidak dikenal atau tidak dimiliki peran dasar: ${bad.slice(0, 3).join(', ')}`);
    return uniq;
  }

  async create(user: AuthUser, dto: RoleDto) {
    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException('Nama minimal 2 huruf');
    const denied = this.validDenied(dto.baseRole, dto.denied);
    const [dup] = await this.repo.findCustomRolesByName(this.db, user.tenantId, name);
    if (dup) throw new BadRequestException('Sudah ada peran khusus dengan nama itu');
    const row = await insertOne(this.db, customRoles, { tenantId: user.tenantId, name, baseRole: dto.baseRole, denied, createdById: user.sub });
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entity: 'CustomRole', entityId: row.id, data: { name, baseRole: dto.baseRole, denied } });
    return row;
  }

  async update(user: AuthUser, id: string, dto: UpdateRoleDto) {
    const cur = await findOwned(this.db, customRoles, user.tenantId, id);
    if (!cur) throw new NotFoundException('Peran khusus tidak ditemukan');
    const name = dto.name?.trim() ?? cur.name;
    if (name.length < 2) throw new BadRequestException('Nama minimal 2 huruf');
    if (name.toLowerCase() !== cur.name.toLowerCase()) {
      const [dup] = await this.repo.findCustomRolesByName(this.db, user.tenantId, name);
      if (dup) throw new BadRequestException('Sudah ada peran khusus dengan nama itu');
    }
    const denied = dto.denied === undefined ? cur.denied : this.validDenied(cur.baseRole, dto.denied);
    const [row] = await this.repo.updateCustomRolesById(this.db, name, denied, id);
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'UPDATE', entity: 'CustomRole', entityId: id, data: { before: { name: cur.name, denied: cur.denied }, after: { name, denied } } });
    return row;
  }

  async remove(user: AuthUser, id: string) {
    const cur = await findOwned(this.db, customRoles, user.tenantId, id);
    if (!cur) throw new NotFoundException('Peran khusus tidak ditemukan');
    const [used] = await this.repo.countUsersByCustomRoleId(this.db, id);
    if (used.n) throw new BadRequestException(`Peran ini masih dipakai ${used.n} pengguna. Pindahkan pengguna ke peran lain dulu.`);
    await this.repo.deleteCustomRolesById(this.db, id);
    await this.audit.log(this.db, { tenantId: user.tenantId, userId: user.sub, action: 'DELETE', entity: 'CustomRole', entityId: id, data: { name: cur.name } });
    return { ok: true };
  }
}

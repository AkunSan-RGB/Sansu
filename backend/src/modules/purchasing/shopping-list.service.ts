import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import { DraftOrderDto } from './shopping-list.dto';
import { ShoppingListRepository, PRICE_JUMP_PCT } from './shopping-list.repository';
export { PRICE_JUMP_PCT } from './shopping-list.repository';

@Injectable()
export class ShoppingListService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly requests: PurchaseRequestsService,
    private readonly orders: PurchaseOrdersService,
    private readonly repo: ShoppingListRepository,
  ) {}

  async list(u: AuthUser, warehouseId?: string) {
    const sug = await this.requests.suggestions(u.tenantId, warehouseId);
    const fresh = await this.repo.queryProduct(this.db, u.tenantId);
    const shelf = new Map(fresh.rows.map((r) => [r.id, r.days]));
    const groups = new Map<string, { supplierId: string | null; supplierName: string; warehouseId: string; lines: ((typeof sug)[number] & { shelfLifeDays: number | null; estimate: number | null })[]; total: number }>();
    for (const s of sug) {
      const key = `${s.supplierId ?? 'NONE'}|${s.warehouseId}`;
      const g = groups.get(key) ?? { supplierId: s.supplierId, supplierName: s.supplierName ?? 'Belum ada pemasok (pilih manual)', warehouseId: s.warehouseId, lines: [], total: 0 };
      const estimate = s.lastPrice != null ? Math.round(s.lastPrice * s.suggestedQty) : null;
      g.lines.push({ ...s, shelfLifeDays: shelf.get(s.productId) ?? null, estimate });
      g.total += estimate ?? 0;
      groups.set(key, g);
    }
    return { date: todayJakarta(), groups: [...groups.values()].sort((a, b) => Number(!!b.supplierId) - Number(!!a.supplierId) || a.supplierName.localeCompare(b.supplierName)), priceAlerts: await this.priceAlerts(u.tenantId) };
  }

  /** Buat PO draf untuk satu pemasok dari daftar belanja: jumlah disarankan, harga = harga beli terakhir (baris tanpa harga dilewati) */
  async draft(u: AuthUser, dto: DraftOrderDto) {
    const list = await this.list(u, dto.warehouseId);
    const g = list.groups.find((x) => x.supplierId === dto.supplierId && x.warehouseId === dto.warehouseId);
    if (!g) throw new BadRequestException('Tidak ada kebutuhan belanja untuk pemasok dan gudang ini');
    const lines = g.lines.filter((l) => l.lastPrice != null && l.suggestedQty > 0).map((l) => ({ productId: l.productId, qty: String(l.suggestedQty), price: String(l.lastPrice) }));
    const skipped = g.lines.filter((l) => l.lastPrice == null).map((l) => l.sku);
    if (!lines.length) throw new BadRequestException('Belum ada harga beli sebelumnya untuk barang-barang ini; buat PO manual');
    const po = await this.orders.create(u, { supplierId: dto.supplierId, warehouseId: dto.warehouseId, notes: 'Dibuat dari daftar belanja harian', lines });
    return { id: (po as { id: string }).id, number: (po as { number: string }).number, lines: lines.length, skipped };
  }

  /** Barang yang harga beli terbarunya naik > 10% dari rata-rata 90 hari sebelumnya (per satuan dasar, setelah diskon) */
  async priceAlerts(tenantId: string) {
    const r = await this.repo.queryProductForPriceAlerts(this.db, tenantId);
    return r.rows.map((x) => ({ sku: x.sku, name: x.name, supplier: x.supplier, latest: Number(x.latest), average: Number(x.avg), pct: Number(x.pct), date: x.date }));
  }
}

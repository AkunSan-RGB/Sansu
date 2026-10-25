import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { ProductionService } from './production.service';
import { bomLines, boms, productionOrderLines, productionOrders, products, users, warehouses } from '../../db/schema';
import { RequirementsDto, PlanDto, VarianceQueryDto } from './manufacturing.dto';
import { ManufacturingRepository } from './manufacturing.repository';

const MAX_DEPTH = 8;

@Injectable()
export class ManufacturingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly seq: SequenceService,
    @Inject(forwardRef(() => ProductionService)) private readonly production: ProductionService,
    private readonly repo: ManufacturingRepository,
  ) {}

  private async assertManufacturing(tenantId: string) {
    if ((await this.settings.businessModel(this.db, tenantId)) !== 'MANUFAKTUR') {
      throw new ForbiddenException('Fitur ini untuk jenis usaha Manufaktur (ubah di Pengaturan › Jenis usaha)');
    }
  }

  /** Ledakkan rencana produksi melalui resep bertingkat: pohon perintah, bahan baku, dan barang setengah jadi yang perlu diproduksi */
  private async analyze(tenantId: string, dto: RequirementsDto) {
    const [wh] = await this.repo.findWarehousesById(this.db, dto.warehouseId, tenantId);
    if (!wh) throw new BadRequestException('Gudang tidak ditemukan');

    const allBoms = await this.repo.listBomsByIsActive(this.db, tenantId);
    const lineRows = allBoms.length ? await this.repo.listBomLinesByBomId(this.db, allBoms) : [];
    const linesOf = (bomId: string) => lineRows.filter((l) => l.bomId === bomId);
    const byOutput = new Map<string, (typeof allBoms)[number]>();
    for (const b of [...allBoms].sort((a, c) => a.code.localeCompare(c.code))) if (!byOutput.has(b.productId)) byOutput.set(b.productId, b);

    const stockRows = (
      await this.repo.queryStockBalance(this.db, tenantId, dto.warehouseId)
    ).rows;
    const avail = new Map(stockRows.map((r) => [r.product_id, D(r.qty)]));

    const leaves = new Map<string, Dec>();
    const semis = new Map<string, { needed: Dec; covered: Dec; toProduce: Dec; batches: Dec; bomCode: string }>();
    let labor: Dec = ZERO;
    let overhead: Dec = ZERO;

    type Bom = (typeof allBoms)[number];
    type Node = { bom: Bom; batches: Dec; children: Node[] };
    const explode = (bom: Bom, batches: Dec, depth: number, path: Set<string>): Node => {
      const node: Node = { bom, batches, children: [] };
      if (depth > MAX_DEPTH) throw new BadRequestException('Resep bertingkat terlalu dalam (maksimal 8 tingkat)');
      labor = labor.plus(D(bom.laborCost).times(batches));
      overhead = overhead.plus(D(bom.overheadCost).times(batches));
      for (const l of linesOf(bom.id)) {
        const need = D(l.qty).times(batches);
        const sub = byOutput.get(l.productId);
        if (!sub) {
          leaves.set(l.productId, (leaves.get(l.productId) ?? ZERO).plus(need));
          continue;
        }
        if (path.has(sub.id)) throw new BadRequestException(`Resep berputar: ${sub.code} memakai dirinya sendiri secara tidak langsung`);
        // barang setengah jadi: pakai stok dulu, kekurangannya harus diproduksi dari resepnya sendiri
        const have = avail.get(l.productId) ?? ZERO;
        const use = have.lt(need) ? have : need;
        avail.set(l.productId, have.minus(use));
        const net = need.minus(use);
        const row = semis.get(l.productId) ?? { needed: ZERO, covered: ZERO, toProduce: ZERO, batches: ZERO, bomCode: sub.code };
        row.needed = row.needed.plus(need);
        row.covered = row.covered.plus(use);
        if (net.gt(0)) {
          const subBatches = net.div(sub.outputQty).ceil();
          row.batches = row.batches.plus(subBatches);
          row.toProduce = row.toProduce.plus(subBatches.times(sub.outputQty));
          semis.set(l.productId, row);
          node.children.push(explode(sub, subBatches, depth + 1, new Set(path).add(sub.id)));
        } else semis.set(l.productId, row);
      }
      return node;
    };

    const planned: { bomCode: string; product: string; batches: string }[] = [];
    const trees: Node[] = [];
    for (const it of dto.items) {
      const bom = allBoms.find((b) => b.id === it.bomId);
      if (!bom) throw new BadRequestException('Resep tidak ditemukan atau nonaktif');
      const batches = D(it.batches);
      if (batches.lte(0)) throw new BadRequestException('Jumlah batch harus lebih dari 0');
      trees.push(explode(bom, batches, 1, new Set([bom.id])));
      planned.push({ bomCode: bom.code, product: bom.name, batches: batches.toString() });
    }
    return { wh, trees, leaves, semis, labor, overhead, planned };
  }

  async requirements(tenantId: string, dto: RequirementsDto) {
    await this.assertManufacturing(tenantId);
    const { wh, leaves, semis, labor, overhead, planned } = await this.analyze(tenantId, dto);

    const ids = [...new Set([...leaves.keys(), ...semis.keys()])];
    const info = ids.length ? await this.repo.listProductsById(this.db, ids) : [];
    const meta = new Map(info.map((p) => [p.id, p]));
    const flow = ids.length
      ? (
          await this.repo.queryProduct(this.db, dto.warehouseId, tenantId, ids)
        ).rows
      : [];
    const f = new Map(flow.map((r) => [r.product_id, r]));
    const r2 = (x: Dec) => Number(x.toDecimalPlaces(4).toString());

    const materials = [...leaves.entries()]
      .map(([pid, required]) => {
        const m = meta.get(pid)!;
        const x = f.get(pid);
        const onHand = D(x?.on_hand ?? 0);
        const onOrder = D(x?.on_order ?? 0);
        const requested = D(x?.requested ?? 0);
        const shortage = Decimal0(required.minus(onHand).minus(onOrder).minus(requested));
        return {
          productId: pid,
          sku: m.sku,
          name: m.name,
          unit: m.unit,
          required: r2(required),
          onHand: r2(onHand),
          onOrder: r2(onOrder),
          requested: r2(requested),
          shortage: r2(shortage),
          supplierId: x?.supplier_id ?? null,
          supplierName: x?.supplier_name ?? null,
          lastPrice: x?.last_price != null ? Math.round(Number(x.last_price) * 100) / 100 : null,
        };
      })
      .sort((a, b) => b.shortage - a.shortage || a.name.localeCompare(b.name));

    const subAssemblies = [...semis.entries()].map(([pid, s]) => {
      const m = meta.get(pid)!;
      return { productId: pid, sku: m.sku, name: m.name, unit: m.unit, bomCode: s.bomCode, needed: r2(s.needed), fromStock: r2(s.covered), toProduce: r2(s.toProduce), batches: r2(s.batches) };
    });

    return {
      warehouse: wh.name,
      planned,
      materials,
      subAssemblies,
      conversion: { labor: money(labor).toFixed(2), overhead: money(overhead).toFixed(2) },
      shortageCount: materials.filter((m) => m.shortage > 0).length,
      canProduce: materials.every((m) => m.shortage <= 0),
    };
  }

  /**
   * Buat perintah produksi berjenjang dari rencana: satu perintah untuk tiap barang jadi dan satu perintah anak untuk setiap barang
   * setengah jadi yang kekurangan stok (sampai kedalaman resep). Semua dalam satu transaksi dan bernomor rencana yang sama; perintah induk
   * baru bisa dimulai setelah perintah anaknya selesai.
   */
  async plan(user: AuthUser, dto: PlanDto) {
    await this.assertManufacturing(user.tenantId);
    const date = toDocDate(dto.date);
    const { trees } = await this.analyze(user.tenantId, dto);
    return this.db.transaction(async (tx) => {
      const planNo = await this.seq.next(tx, user.tenantId, 'PRODUCTION_PLAN', date);
      const made: { id: string; number: string; bom: string; product: string; batches: string; level: number; parent: string | null }[] = [];
      const create = async (node: (typeof trees)[number], parentId: string | null, parentNumber: string | null, level: number): Promise<void> => {
        const id = await this.production.createOrderIn(tx, user, { bomId: node.bom.id, warehouseId: dto.warehouseId, date: dto.date, batches: node.batches.toString(), notes: `Rencana ${planNo}` }, { parentOrderId: parentId ?? undefined, planNo });
        const [o] = await this.repo.findProductionOrdersById(tx, id);
        made.push({ id, number: o.number, bom: node.bom.code, product: node.bom.name, batches: node.batches.toString(), level, parent: parentNumber });
        for (const c of node.children) await create(c, id, o.number, level + 1);
      };
      for (const t of trees) await create(t, null, null, 0);
      return { planNo, orders: made };
    });
  }

  /** Analisis selisih produksi (perintah produksi selesai pada rentang tanggal) */
  async variance(tenantId: string, q: VarianceQueryDto) {
    await this.assertManufacturing(tenantId);
    const tol = q.tolerancePct ? Number(q.tolerancePct) : 3;
    const orders = await this.repo.listProductionOrdersWithBomsAndProductsByStatusAndCompletedDateAndNumber(this.db, tenantId, q);
    const lines = orders.length
      ? await this.db
          .select({ l: productionOrderLines, sku: products.sku, name: products.name })
          .from(productionOrderLines)
          .innerJoin(products, eq(products.id, productionOrderLines.productId))
          .where(inArray(productionOrderLines.orderId, orders.map((x) => x.o.id)))
      : [];
    const byMaterial = new Map<string, { sku: string; name: string; planned: number; issued: number; value: number }>();
    const rows = orders.map(({ o, bom, sku, name, by }) => {
      const mats = lines
        .filter((x) => x.l.orderId === o.id)
        .map((x) => {
          const planned = Number(x.l.plannedQty);
          const issued = Number(x.l.issuedQty);
          const value = Math.round((issued - planned) * Number(x.l.unitCost) * 100) / 100;
          const m = byMaterial.get(x.l.productId) ?? { sku: x.sku, name: x.name, planned: 0, issued: 0, value: 0 };
          m.planned += planned;
          m.issued += issued;
          m.value += value;
          byMaterial.set(x.l.productId, m);
          return { sku: x.sku, name: x.name, planned, issued, pct: planned > 0 ? Math.round(((issued - planned) / planned) * 1000) / 10 : 0, value };
        });
      const materialValue = mats.reduce((a, m) => a + m.value, 0);
      const plannedOut = Number(o.plannedQty);
      const actualOut = Number(o.outputQty);
      const yieldPct = plannedOut > 0 ? Math.round(((plannedOut - actualOut) / plannedOut) * 1000) / 10 : 0;
      const yieldValue = Math.round((plannedOut - actualOut) * Number(o.unitCost) * 100) / 100;
      const stdLabor = D(bom.laborCost).times(o.batches);
      const stdOverhead = D(bom.overheadCost).times(o.batches);
      const laborVar = Number(money(D(o.laborCost).minus(stdLabor)));
      const overheadVar = Number(money(D(o.overheadCost).minus(stdOverhead)));
      const flags: string[] = [];
      if (mats.some((m) => m.pct > tol)) flags.push('HIGH_USAGE');
      if (yieldPct > tol) flags.push('LOW_YIELD');
      return {
        orderId: o.id,
        number: o.number,
        date: o.completedDate,
        product: `${sku} · ${name}`,
        batches: Number(o.batches),
        createdBy: by ?? null,
        plannedOutput: plannedOut,
        actualOutput: actualOut,
        yieldPct,
        yieldValue,
        materials: mats,
        materialValue: Math.round(materialValue * 100) / 100,
        laborVariance: laborVar,
        overheadVariance: overheadVar,
        flags,
      };
    });
    return {
      tolerancePct: tol,
      rows,
      byMaterial: [...byMaterial.values()].sort((a, b) => b.value - a.value),
      totals: {
        orders: rows.length,
        flagged: rows.filter((r) => r.flags.length).length,
        materialValue: Math.round(rows.reduce((a, r) => a + r.materialValue, 0) * 100) / 100,
        yieldValue: Math.round(rows.reduce((a, r) => a + r.yieldValue, 0) * 100) / 100,
        laborVariance: Math.round(rows.reduce((a, r) => a + r.laborVariance, 0) * 100) / 100,
        overheadVariance: Math.round(rows.reduce((a, r) => a + r.overheadVariance, 0) * 100) / 100,
      },
    };
  }
}

const Decimal0 = (x: Dec) => (x.lt(0) ? ZERO : x);

/**
 * Fitur khusus jenis usaha Manufaktur:
 *  - Perencanaan kebutuhan bahan (MRP ringan): meledakkan resep bertingkat (bahan → barang setengah jadi → barang jadi) untuk rencana
 *    produksi, membandingkannya dengan stok, pesanan pembelian berjalan, dan permintaan pembelian, lalu menyebut kekurangan per bahan.
 *  - Analisis selisih produksi: pemakaian bahan, hasil produksi, dan biaya konversi sesungguhnya terhadap standar resep, dengan penanda
 *    untuk pemakaian berlebih / hasil rendah (indikasi pemborosan atau kebocoran bahan).
 */
import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsNumberString, IsOptional, IsUUID, Matches, ValidateNested } from 'class-validator';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { toDocDate } from '../../common/utils/dates';
import { D, Dec, money, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { ProductionService } from './production.module';
import { bomLines, boms, productionOrderLines, productionOrders, products, users, warehouses } from '../../db/schema';

export class RequirementItemDto {
  @ApiProperty() @IsUUID() bomId: string;
  @ApiProperty({ example: '5', description: 'Jumlah batch yang direncanakan' }) @IsNumberString() batches: string;
}
export class RequirementsDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty({ type: [RequirementItemDto] })
  @ValidateNested({ each: true })
  @Type(() => RequirementItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items: RequirementItemDto[];
}
export class PlanDto extends RequirementsDto {
  @ApiPropertyOptional({ example: '2026-10-05', description: 'Tanggal perintah; default hari ini' }) @IsOptional() @IsDateString() date?: string;
}
export class VarianceQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ example: '3', description: 'Toleransi pemakaian bahan di atas standar (%) sebelum ditandai' }) @IsOptional() @Matches(/^\d{1,3}(\.\d)?$/) tolerancePct?: string;
}

const MAX_DEPTH = 8;

@Injectable()
export class ManufacturingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly seq: SequenceService,
    @Inject(forwardRef(() => ProductionService)) private readonly production: ProductionService,
  ) {}

  private async assertManufacturing(tenantId: string) {
    if ((await this.settings.businessModel(this.db, tenantId)) !== 'MANUFAKTUR') {
      throw new ForbiddenException('Fitur ini untuk jenis usaha Manufaktur (ubah di Pengaturan › Jenis usaha)');
    }
  }

  /** Ledakkan rencana produksi melalui resep bertingkat: pohon perintah, bahan baku, dan barang setengah jadi yang perlu diproduksi */
  private async analyze(tenantId: string, dto: RequirementsDto) {
    const [wh] = await this.db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, tenantId)));
    if (!wh) throw new BadRequestException('Gudang tidak ditemukan');

    const allBoms = await this.db.select().from(boms).where(and(eq(boms.tenantId, tenantId), eq(boms.isActive, true)));
    const lineRows = allBoms.length ? await this.db.select().from(bomLines).where(inArray(bomLines.bomId, allBoms.map((b) => b.id))) : [];
    const linesOf = (bomId: string) => lineRows.filter((l) => l.bomId === bomId);
    const byOutput = new Map<string, (typeof allBoms)[number]>();
    for (const b of [...allBoms].sort((a, c) => a.code.localeCompare(c.code))) if (!byOutput.has(b.productId)) byOutput.set(b.productId, b);

    const stockRows = (
      await this.db.execute<{ product_id: string; qty: string }>(sql`SELECT product_id, qty FROM stock_balances WHERE tenant_id = ${tenantId} AND warehouse_id = ${dto.warehouseId}`)
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
    const info = ids.length ? await this.db.select({ id: products.id, sku: products.sku, name: products.name, unit: products.baseUom }).from(products).where(inArray(products.id, ids)) : [];
    const meta = new Map(info.map((p) => [p.id, p]));
    const flow = ids.length
      ? (
          await this.db.execute<{ product_id: string; on_order: string; requested: string; on_hand: string; supplier_id: string | null; supplier_name: string | null; last_price: string | null }>(sql`
            SELECT p.id AS product_id, COALESCE(b.qty, 0) AS on_hand, COALESCE(po.qty, 0) AS on_order, COALESCE(pr.qty, 0) AS requested,
                   ls.supplier_id, ls.supplier_name, ls.base_price AS last_price
            FROM products p
            LEFT JOIN stock_balances b ON b.product_id = p.id AND b.warehouse_id = ${dto.warehouseId}
            LEFT JOIN (
              SELECT l.product_id, SUM((l.qty - l.received_qty) * l.uom_factor) AS qty
              FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
              WHERE o.tenant_id = ${tenantId} AND o.warehouse_id = ${dto.warehouseId} AND o.status IN ('DRAFT', 'CONFIRMED') AND l.qty > l.received_qty
              GROUP BY 1) po ON po.product_id = p.id
            LEFT JOIN (
              SELECT l.product_id, SUM(l.qty * l.uom_factor) AS qty
              FROM purchase_request_lines l JOIN purchase_requests r ON r.id = l.request_id
              WHERE r.tenant_id = ${tenantId} AND r.warehouse_id = ${dto.warehouseId} AND r.status IN ('SUBMITTED', 'APPROVED') AND l.purchase_order_id IS NULL
              GROUP BY 1) pr ON pr.product_id = p.id
            LEFT JOIN LATERAL (
              SELECT o.supplier_id, s.name AS supplier_name, l.price / NULLIF(l.uom_factor, 0) AS base_price
              FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id JOIN suppliers s ON s.id = o.supplier_id
              WHERE o.tenant_id = ${tenantId} AND l.product_id = p.id AND o.status <> 'CANCELLED'
              ORDER BY o.date DESC, o.created_at DESC LIMIT 1) ls ON true
            WHERE p.tenant_id = ${tenantId} AND p.id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`)
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
        const [o] = await tx.select({ number: productionOrders.number }).from(productionOrders).where(eq(productionOrders.id, id));
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
    const orders = await this.db
      .select({ o: productionOrders, bom: boms, sku: products.sku, name: products.name, by: users.name })
      .from(productionOrders)
      .innerJoin(boms, eq(boms.id, productionOrders.bomId))
      .innerJoin(products, eq(products.id, productionOrders.productId))
      .leftJoin(users, eq(users.id, productionOrders.createdById))
      .where(and(eq(productionOrders.tenantId, tenantId), eq(productionOrders.status, 'COMPLETED'), q.from ? gte(productionOrders.completedDate, q.from) : undefined, q.to ? lte(productionOrders.completedDate, q.to) : undefined))
      .orderBy(sql`${productionOrders.completedDate} DESC, ${productionOrders.number} DESC`)
      .limit(300);
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

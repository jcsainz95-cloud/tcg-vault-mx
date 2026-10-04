import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UpdateItemDto } from '../src/modules/inventory/dto/inventory.dto';
import {
  DEFAULT_PRICING_CURVE,
  DEFAULT_SALE_PREMIUM_FLOOR_POLICY,
} from '../src/common/pricing-curve';
import { computeSealedSalePrice } from '../src/common/money';
import { BusinessException } from '../src/common/business.exception';

/**
 * ⭐ v1.80.8.7 — PRECIO FINAL DEL SELLADO (API_CONTRACT §M1 `M1-SFP`, ARCHITECTURE §4.36.5 (c-quater),
 * criterio 255; cierra `D-SFP-1`). Unitarias SFP-1…SFP-8 (las de Postgres real, incluida la carrera
 * SFP-5 con barrera y SFP-9, viven en `test/integration/inventory-price-audit.e2e-spec.ts`).
 *
 * Invariante: *ningún cambio de `status` o `listPriceCents` por el `PATCH` de M1 se confirma sin su fila
 * `inventory.item_updated` con el valor realmente sustituido y el valor escrito* — UNA fila, en la MISMA
 * `$transaction` que la escritura, en los dos caminos (no publicante y publicante), para todo `productType`.
 *
 * El arnés simula la transacción de verdad: `$transaction` fotografía las filas y, si el cuerpo lanza,
 * las RESTAURA (rollback). Así SFP-3 mide «nada escrito» y no «el doble no se llamó».
 */

type AnyRow = Record<string, any>;

const OPERATOR = { id: 'op-1', role: 'vault_operator' } as any;

function row(o: AnyRow): AnyRow {
  const id = o.id as string;
  return {
    folio: `INV-${id}`,
    cardId: `card-${id}`,
    card: {
      id: `card-${id}`,
      name: 'Charizard',
      number: '4',
      rarity: o.rarity ?? 'Rare',
      rarityCanonical: o.rarity ?? 'Rare',
      subtypes: null,
      availableFinishes: ['normal'],
      set: { id: 's1', name: 'Base' },
    },
    productType: 'sealed',
    rawCondition: null,
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    gradingCompany: null,
    gradeValue: null,
    finish: 'normal',
    ownerType: 'platform',
    ownerUserId: null,
    ownershipStatus: null,
    status: 'in_stock',
    locationId: 'loc-1',
    listPriceCents: null,
    cardProductId: null,
    sealedProductId: null,
    sealedProductName: 'ETB',
    tcgplayerProductId: null,
    tcgplayerGroupId: null,
    acquisitionType: 'compra',
    acquisitionCostCents: 40000,
    sourceSellRequestItemId: null,
    certNumber: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    __market: null as number | null,
    ...o,
  };
}

/** `where` de Prisma → predicado (igualdad, `{ in: [...] }`). */
function matches(r: AnyRow, where: AnyRow): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (v && typeof v === 'object' && Array.isArray((v as any).in))
      return (v as any).in.includes(r[k]);
    return r[k] === v;
  });
}

function build(seed: AnyRow[], opts: { openPending?: AnyRow[] } = {}) {
  const rows = seed;
  const audits: { inTx: boolean; data: AnyRow }[] = [];
  const queries: string[] = [];
  const strip = (r: AnyRow) => {
    const { card: _c, __market: _m, ...rest } = r;
    return rest;
  };
  const client = (inTx: boolean): any => ({
    $executeRaw: jest.fn(async () => 1),
    inventoryItem: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        queries.push('inventoryItem.findUnique');
        const r = rows.find((x) => x.id === where.id);
        if (!r) return null;
        if (!include) return strip({ ...r });
        return { ...r, location: null, movements: [] };
      }),
      findMany: jest.fn(async ({ where, select }: any) => {
        queries.push('inventoryItem.findMany');
        let out = rows;
        if (where?.id?.in) out = out.filter((r) => where.id.in.includes(r.id));
        for (const k of ['status', 'ownerType', 'productType', 'cardId'] as const) {
          if (where?.[k]) out = out.filter((r) => r[k] === where[k]);
        }
        if (where && 'locationId' in where && where.locationId === null)
          out = out.filter((r) => r.locationId == null);
        return select?.id
          ? out.map((r) => ({ id: r.id }))
          : out.map((r) => ({ ...r, location: null }));
      }),
      count: jest.fn(async () => {
        queries.push('inventoryItem.count');
        return rows.length;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r || !matches(r, where)) {
          throw new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
            code: 'P2025',
            clientVersion: 'test',
          });
        }
        Object.assign(r, data);
        return strip({ ...r });
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r || !matches(r, where)) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
    shipmentItem: { findMany: jest.fn(async () => []) },
    inventoryMovement: { create: jest.fn(async () => ({})) },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        audits.push({ inTx, data });
        return data;
      }),
    },
    pendingPriceEntry: {
      findMany: jest.fn(async () => {
        queries.push('pendingPriceEntry.findMany');
        return opts.openPending ?? [];
      }),
    },
  });
  const tx = client(true);
  const prisma: any = client(false);
  // Transacción con ROLLBACK de verdad (sobre el estado del arnés).
  prisma.$transaction = jest.fn(async (fn: any) => {
    const snap = rows.map((r) => ({ ...r }));
    try {
      return await fn(tx);
    } catch (e) {
      rows.forEach((r, i) => {
        for (const k of Object.keys(r)) delete r[k];
        Object.assign(r, snap[i]);
      });
      throw e;
    }
  });
  const refOf = (cardId: string) => rows.find((r) => r.cardId === cardId)?.__market ?? null;
  const pricing = {
    loadSalePremiumFloorPolicy: jest.fn(async () => {
      queries.push('pricing.loadSalePremiumFloorPolicy');
      return DEFAULT_SALE_PREMIUM_FLOOR_POLICY;
    }),
    loadPricingCurve: jest.fn(async () => {
      queries.push('pricing.loadPricingCurve');
      return DEFAULT_PRICING_CURVE;
    }),
    loadSealedSpreads: jest.fn(async () => {
      queries.push('pricing.loadSealedSpreads');
      return { spreadPctBySubtype: {}, fallbackPct: 10, sourceOn: true };
    }),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    tryGradeKeyFor: jest.fn((i: AnyRow) =>
      i.productType === 'graded'
        ? i.gradingCompany && i.gradeValue
          ? `graded:${i.gradingCompany}:${i.gradeValue}`
          : null
        : 'raw:NM',
    ),
    sealedMarketGradeKeyForItem: jest.fn((i: AnyRow) =>
      i.tcgplayerProductId != null ? `sealed:tcg:${i.tcgplayerProductId}` : null,
    ),
    resolveSealedSalePrice: jest.fn((i: AnyRow, ref: AnyRow | undefined, ctx: AnyRow) =>
      computeSealedSalePrice(
        i.listPriceCents,
        i.sealedSubtype,
        ref && ref.status === 'priced' ? ref.referenceMxnCents : null,
        ctx.spreadPctBySubtype,
        ctx.fallbackPct,
      ),
    ),
    getReferencesBatch: jest.fn(async (list: any[]) => {
      queries.push('pricing.getReferencesBatch');
      const m = new Map();
      for (const d of list) {
        const cents = refOf(d.cardId);
        if (cents != null) {
          m.set(`${d.cardId}|${d.productType}|${d.gradeKey}|${d.finish}`, {
            status: 'priced',
            referenceMxnCents: cents,
          });
        }
      }
      return m;
    }),
    getVariantOverridesBatch: jest.fn(async () => {
      queries.push('pricing.getVariantOverridesBatch');
      return new Map();
    }),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    settlePendingForVariant: jest.fn(async (reason: unknown) =>
      reason == null ? undefined : 'ppe-new',
    ),
    escalatePending: jest.fn(async () => 'ppe-new'),
  } as unknown as PricingService;
  const svc = new InventoryService(prisma as PrismaService, pricing, {
    getNumber: jest.fn(),
  } as unknown as SettingsService);
  const itemUpdated = () => audits.filter((a) => a.data.action === 'inventory.item_updated');
  return { svc, prisma, tx, rows, audits, itemUpdated, pricing, queries };
}

async function err(p: Promise<unknown>): Promise<BusinessException> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(BusinessException);
  return e as BusinessException;
}

const expectedRow = (id: string, before: AnyRow, after: AnyRow) => ({
  actorUserId: OPERATOR.id,
  actorRole: OPERATOR.role,
  action: 'inventory.item_updated',
  entityType: 'InventoryItem',
  entityId: id,
  before,
  after,
});

// =============================================================================================
describe('SFP-1 — `PATCH {listPriceCents}` (camino NO publicante) deja UNA fila con antes/después', () => {
  it.each([
    ['in_stock', 100000],
    ['in_stock', null],
    ['listed', 100000],
  ])(
    'sellado plataforma %s con precio %p ⇒ 200 y una fila con before/after',
    async (status, price) => {
      const { svc, tx, itemUpdated, rows } = build([
        row({ id: 'a', status, listPriceCents: price }),
      ]);
      const res: any = await svc.updateItem(
        'a',
        { listPriceCents: 125000 } as UpdateItemDto,
        OPERATOR,
      );
      expect(res.listPriceCents).toBe(125000);
      expect(rows[0]).toMatchObject({ status, listPriceCents: 125000 });
      const audit = itemUpdated();
      expect(audit).toHaveLength(1);
      expect(audit[0].inTx).toBe(true);
      expect(audit[0].data).toEqual(
        expectedRow(
          'a',
          { status, listPriceCents: price },
          { status, listPriceCents: 125000, fields: ['listPriceCents'] },
        ),
      );
      // El «antes» es exacto: el precio leído entra al CAS.
      expect(tx.inventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'a', status, ownerType: 'platform', ownerUserId: null, listPriceCents: price },
        data: { listPriceCents: 125000 },
      });
    },
  );

  it('todo productType: una carta suelta `listed` re-preciada también deja su fila', async () => {
    const { svc, itemUpdated } = build([
      row({ id: 'r', productType: 'raw', status: 'listed', listPriceCents: 5000 }),
    ]);
    await svc.updateItem('r', { listPriceCents: 6000 } as UpdateItemDto, OPERATOR);
    expect(itemUpdated().map((a) => a.data.after)).toEqual([
      { status: 'listed', listPriceCents: 6000, fields: ['listPriceCents'] },
    ]);
  });

  it('cambio de status + precio (`listed → in_stock`) ⇒ UNA fila con las dos claves y `fields` en orden alfabético', async () => {
    const { svc, itemUpdated } = build([
      row({ id: 'a', status: 'listed', listPriceCents: 100000 }),
    ]);
    await svc.updateItem(
      'a',
      { status: 'in_stock', listPriceCents: 90000 } as UpdateItemDto,
      OPERATOR,
    );
    expect(itemUpdated()).toHaveLength(1);
    expect(itemUpdated()[0].data.before).toEqual({ status: 'listed', listPriceCents: 100000 });
    expect(itemUpdated()[0].data.after).toEqual({
      status: 'in_stock',
      listPriceCents: 90000,
      fields: ['listPriceCents', 'status'],
    });
  });

  it('solo status (`listed → in_stock`) ⇒ la fila lleva también el precio (igual en los dos lados)', async () => {
    const { svc, itemUpdated } = build([
      row({ id: 'a', status: 'listed', listPriceCents: 100000 }),
    ]);
    await svc.updateItem('a', { status: 'in_stock' } as UpdateItemDto, OPERATOR);
    expect(itemUpdated().map((a) => [a.data.before, a.data.after])).toEqual([
      [
        { status: 'listed', listPriceCents: 100000 },
        { status: 'in_stock', listPriceCents: 100000, fields: ['status'] },
      ],
    ]);
  });
});

// =============================================================================================
describe('SFP-2 — «Guardar y publicar» (camino PUBLICANTE) deja UNA fila, en la misma tx que `claimListed`', () => {
  it('sellado `in_stock` sin precio + `{listPriceCents, status:"listed"}` ⇒ before {in_stock,null} / after {listed,125000}', async () => {
    const { svc, tx, prisma, itemUpdated, rows } = build([row({ id: 'a', listPriceCents: null })]);
    const res: any = await svc.updateItem(
      'a',
      { listPriceCents: 125000, status: 'listed' } as UpdateItemDto,
      OPERATOR,
    );
    expect(res.status).toBe('listed');
    expect(rows[0]).toMatchObject({ status: 'listed', listPriceCents: 125000 });
    const audit = itemUpdated();
    expect(audit).toHaveLength(1);
    expect(audit[0].inTx).toBe(true);
    expect(audit[0].data).toEqual(
      expectedRow(
        'a',
        { status: 'in_stock', listPriceCents: null },
        { status: 'listed', listPriceCents: 125000, fields: ['listPriceCents', 'status'] },
      ),
    );
    // El CAS publicante va DENTRO de la tx y condiciona además al precio leído.
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.inventoryItem.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'a',
      listPriceCents: null,
    });
  });

  it('`{status:"listed"}` solo, sobre una carta con precio derivable ⇒ precio igual en los dos lados', async () => {
    const { svc, itemUpdated } = build([
      row({
        id: 'r',
        productType: 'raw',
        rawCondition: 'NM',
        sealedSubtype: null,
        __market: 200000,
      }),
    ]);
    const res: any = await svc.updateItem('r', { status: 'listed' } as UpdateItemDto, OPERATOR);
    expect(res.status).toBe('listed');
    expect(itemUpdated().map((a) => [a.data.before, a.data.after])).toEqual([
      [
        { status: 'in_stock', listPriceCents: null },
        { status: 'listed', listPriceCents: null, fields: ['status'] },
      ],
    ]);
  });
});

// =============================================================================================
describe('SFP-3 — atomicidad: si la bitácora falla, NO se escribe el cambio', () => {
  const boom = (tx: any) =>
    tx.auditLog.create.mockImplementation(async () => {
      throw new Error('audit insert failed');
    });

  it('no publicante (solo precio): error y la pieza intacta', async () => {
    const { svc, tx, rows } = build([row({ id: 'a', status: 'listed', listPriceCents: 100000 })]);
    boom(tx);
    await expect(
      svc.updateItem('a', { listPriceCents: 125000 } as UpdateItemDto, OPERATOR),
    ).rejects.toThrow();
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: 'listed', listPriceCents: 100000 });
  });

  it('no publicante (status): error y la pieza intacta', async () => {
    const { svc, tx, rows } = build([row({ id: 'a', status: 'listed', listPriceCents: 100000 })]);
    boom(tx);
    await expect(
      svc.updateItem('a', { status: 'in_stock' } as UpdateItemDto, OPERATOR),
    ).rejects.toThrow();
    expect(rows[0]).toMatchObject({ status: 'listed', listPriceCents: 100000 });
  });

  it('publicante: error y la pieza intacta (ni `listed` ni precio)', async () => {
    const { svc, tx, rows } = build([row({ id: 'a', listPriceCents: null })]);
    boom(tx);
    await expect(
      svc.updateItem('a', { listPriceCents: 125000, status: 'listed' } as UpdateItemDto, OPERATOR),
    ).rejects.toThrow();
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: 'in_stock', listPriceCents: null });
  });
});

// =============================================================================================
describe('SFP-4 — sin cambio, o rechazo ⇒ CERO filas `inventory.item_updated`', () => {
  it('precio igual al leído ⇒ 200 sin fila', async () => {
    const { svc, itemUpdated } = build([row({ id: 'a', listPriceCents: 100000 })]);
    await svc.updateItem('a', { listPriceCents: 100000 } as UpdateItemDto, OPERATOR);
    expect(itemUpdated()).toEqual([]);
  });

  it('status igual al leído (`in_stock → in_stock`) ⇒ sin fila', async () => {
    const { svc, itemUpdated } = build([row({ id: 'a', listPriceCents: 100000 })]);
    await svc.updateItem('a', { status: 'in_stock' } as UpdateItemDto, OPERATOR);
    expect(itemUpdated()).toEqual([]);
  });

  it('solo `certNumber` ⇒ sin fila', async () => {
    const { svc, itemUpdated } = build([
      row({ id: 'g', productType: 'graded', gradingCompany: 'PSA', gradeValue: '10' }),
    ]);
    await svc.updateItem('g', { certNumber: '123' } as UpdateItemDto, OPERATOR);
    expect(itemUpdated()).toEqual([]);
  });

  it('`422 ITEM_NOT_ADJUSTABLE` (reserved) ⇒ sin fila', async () => {
    const { svc, itemUpdated } = build([
      row({ id: 'a', status: 'reserved', listPriceCents: 100000 }),
    ]);
    expect(
      (await err(svc.updateItem('a', { listPriceCents: 1 } as UpdateItemDto, OPERATOR))).code,
    ).toBe('ITEM_NOT_ADJUSTABLE');
    expect(itemUpdated()).toEqual([]);
  });

  it('`422 ITEM_NOT_ADJUSTABLE` (cliente) ⇒ sin fila', async () => {
    const { svc, itemUpdated } = build([
      row({
        id: 'c',
        ownerType: 'customer',
        ownerUserId: 'ana',
        ownershipStatus: 'settled',
        status: 'in_custody',
      }),
    ]);
    expect(
      (await err(svc.updateItem('c', { listPriceCents: 1 } as UpdateItemDto, OPERATOR))).code,
    ).toBe('ITEM_NOT_ADJUSTABLE');
    expect(itemUpdated()).toEqual([]);
  });

  it('`422 PRICE_PENDING` ⇒ sin fila', async () => {
    const { svc, itemUpdated } = build([row({ id: 'a', listPriceCents: null })]);
    expect(
      (await err(svc.updateItem('a', { status: 'listed' } as UpdateItemDto, OPERATOR))).code,
    ).toBe('PRICE_PENDING');
    expect(itemUpdated()).toEqual([]);
  });

  it('`422 ITEM_NOT_PUBLISHABLE` ⇒ sin fila', async () => {
    const { svc, itemUpdated } = build([row({ id: 'a', status: 'picking', listPriceCents: 100 })]);
    expect(
      (await err(svc.updateItem('a', { status: 'listed' } as UpdateItemDto, OPERATOR))).code,
    ).toBe('ITEM_NOT_PUBLISHABLE');
    expect(itemUpdated()).toEqual([]);
  });

  it('`409 CONFLICT` (la pieza se reservó entre lectura y escritura) ⇒ sin fila', async () => {
    const { svc, tx, rows, itemUpdated } = build([
      row({ id: 'a', status: 'listed', listPriceCents: 100000 }),
    ]);
    tx.inventoryItem.findUnique.mockImplementationOnce(async () => {
      const snap = { ...rows[0] };
      rows[0].status = 'reserved';
      return snap;
    });
    expect(
      (await err(svc.updateItem('a', { listPriceCents: 1 } as UpdateItemDto, OPERATOR))).code,
    ).toBe('CONFLICT');
    expect(itemUpdated()).toEqual([]);
  });
});

// =============================================================================================
describe('SFP-5 (unitaria, determinista) — el precio leído entra al CAS en los dos caminos', () => {
  it('no publicante: otro re-precio entre lectura y escritura ⇒ 409 CONFLICT, sin fila', async () => {
    const { svc, tx, rows, itemUpdated } = build([
      row({ id: 'a', status: 'listed', listPriceCents: 100000 }),
    ]);
    tx.inventoryItem.findUnique.mockImplementationOnce(async () => {
      const snap = { ...rows[0] };
      rows[0].listPriceCents = 110000; // el otro operador ganó
      return snap;
    });
    const e = await err(svc.updateItem('a', { listPriceCents: 125000 } as UpdateItemDto, OPERATOR));
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('CONFLICT');
    // (El precio final = el del ganador lo mide la integración: aquí el rollback del arnés también
    // revertiría la escritura simulada del «otro».)
    expect(itemUpdated()).toEqual([]);
  });

  it('publicante: el precio cambió (sigue publicable) ⇒ 409 CONFLICT, sin fila', async () => {
    const { svc, prisma, rows, itemUpdated } = build([row({ id: 'a', listPriceCents: null })]);
    const real = prisma.inventoryItem.findUnique.getMockImplementation();
    prisma.inventoryItem.findUnique.mockImplementation(async (args: any) => {
      const r = await real(args);
      if (args.include?.card && !args.include?.movements) rows[0].listPriceCents = 99000;
      return r;
    });
    const e = await err(
      svc.updateItem('a', { listPriceCents: 125000, status: 'listed' } as UpdateItemDto, OPERATOR),
    );
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('CONFLICT');
    expect(rows[0]).toMatchObject({ status: 'in_stock', listPriceCents: 99000 });
    expect(itemUpdated()).toEqual([]);
  });

  it('publicante: la pieza se reservó ⇒ 422 ITEM_NOT_PUBLISHABLE con el status RELEÍDO, sin fila', async () => {
    const { svc, prisma, rows, itemUpdated } = build([row({ id: 'a', listPriceCents: null })]);
    const real = prisma.inventoryItem.findUnique.getMockImplementation();
    prisma.inventoryItem.findUnique.mockImplementation(async (args: any) => {
      const r = await real(args);
      if (args.include?.card && !args.include?.movements) rows[0].status = 'reserved';
      return r;
    });
    const e = await err(
      svc.updateItem('a', { listPriceCents: 125000, status: 'listed' } as UpdateItemDto, OPERATOR),
    );
    expect(e.code).toBe('ITEM_NOT_PUBLISHABLE');
    expect(e.details).toEqual({ status: 'reserved' });
    expect(itemUpdated()).toEqual([]);
  });
});

// =============================================================================================
describe('SFP-6 — estático: el objeto antes/después se arma en UN sitio y lo llaman los dos caminos', () => {
  const dir = join(__dirname, '../src/modules/inventory');
  const files = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });

  it("un solo literal `'inventory.item_updated'` en `inventory/`", () => {
    const hits = files(dir).flatMap((f) =>
      (readFileSync(f, 'utf8').match(/['"`]inventory\.item_updated['"`]/g) ?? []).map(() => f),
    );
    // Los comentarios con backticks `inventory.item_updated` cuentan: se escriben sin comillas de código.
    const code = files(dir).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .filter((l) => /['"]inventory\.item_updated['"]/.test(l))
        .map(() => f),
    );
    expect(code).toHaveLength(1);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('`updateItem` llama al constructor único en los dos caminos (no publicante y publicante)', () => {
    const src = readFileSync(join(dir, 'inventory.service.ts'), 'utf8');
    const calls = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*)/.test(l) && /\bwriteItemUpdatedAudit\(/.test(l));
    // definición + 2 llamadas (no publicante en `updateItem`, publicante en `claimListed` con `audit`).
    expect(calls.length).toBe(3);
    const builders = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*)/.test(l) && /\bitemUpdatedAudit\(/.test(l));
    // definición + 1 uso (dentro de `writeItemUpdatedAudit`).
    expect(builders.length).toBe(2);
  });
});

// =============================================================================================
describe('SFP-7 — `pendingReason` en «Listas para publicar» = el veredicto de HOY de la derivación', () => {
  const pp = async (seed: AnyRow[], openPending: AnyRow[] = []) => {
    const h = build(seed, { openPending });
    const res: any = await h.svc.pendingPublish({ page: 1, pageSize: 50 });
    return { ...h, byId: new Map<string, any>(res.data.map((d: any) => [d.inventoryItemId, d])) };
  };
  const raw = (o: AnyRow) =>
    row({
      productType: 'raw',
      rawCondition: 'NM',
      sealedSubtype: null,
      sealedCondition: null,
      ...o,
    });

  it('raw premium en el piso que el dial NO publica ⇒ `premium_at_floor`', async () => {
    const { byId } = await pp([
      raw({ id: 'sir', rarity: 'Special Illustration Rare', __market: 1000 }),
    ]);
    expect(byId.get('sir')).toMatchObject({
      missing: ['price'],
      pendingReason: 'premium_at_floor',
    });
  });

  it('raw sin referencia ⇒ `no_market` (aunque exista una entrada abierta VIEJA `premium_at_floor`)', async () => {
    const { byId } = await pp(
      [raw({ id: 'noref' })],
      [
        {
          id: 'ppe-old',
          cardId: 'card-noref',
          productType: 'raw',
          gradeKey: 'raw:NM',
          finish: 'normal',
          cardProductId: null,
          sealedProductId: null,
          reason: 'premium_at_floor',
        },
      ],
    );
    expect(byId.get('noref')).toMatchObject({ missing: ['price'], pendingReason: 'no_market' });
  });

  it('Double Rare en el piso sin ubicación (dial seed la publica) ⇒ solo `location`, `pendingReason: null`', async () => {
    const { byId } = await pp([
      raw({ id: 'dr', rarity: 'Double Rare', __market: 1000, locationId: null }),
    ]);
    expect(byId.get('dr')).toMatchObject({
      missing: ['location'],
      pendingReason: null,
      priceBasis: 'floor',
      resolvedSalePriceCents: DEFAULT_PRICING_CURVE.sale.floorCents,
    });
  });

  it('sellado sin precio ⇒ `no_market` (el mismo motivo con que la publicación lo escala)', async () => {
    const { byId } = await pp([row({ id: 'sea' })]);
    expect(byId.get('sea')).toMatchObject({ missing: ['price'], pendingReason: 'no_market' });
  });

  it('gradeada sin identidad de slab ⇒ `pendingReason: null` y `pendingPriceEntryId: null`', async () => {
    const { byId } = await pp([
      row({ id: 'g', productType: 'graded', sealedSubtype: null, sealedCondition: null }),
    ]);
    expect(byId.get('g')).toMatchObject({
      missing: ['price'],
      pendingReason: null,
      pendingPriceEntryId: null,
    });
  });

  it('el campo viaja SIEMPRE (null incluido) en cada fila', async () => {
    const { byId } = await pp([raw({ id: 'x', __market: 200000, locationId: null })]);
    expect('pendingReason' in byId.get('x')).toBe(true);
    expect(byId.get('x').pendingReason).toBeNull();
  });
});

// =============================================================================================
describe('SFP-8 — `GET /admin/inventory/items`: precio derivado SOLO del sellado de plataforma in_stock|listed', () => {
  const sealedPriced = (id: string, o: AnyRow = {}) =>
    row({ id, tcgplayerProductId: 777, __market: 100000, locationId: null, ...o });

  it('sellado elegible ⇒ mismo precio y basis que la cola; con precio a mano ⇒ ese monto y `override`', async () => {
    const h = build([
      sealedPriced('s1'),
      row({ id: 's2', listPriceCents: 150000, status: 'listed' }),
    ]);
    const list: any = await h.svc.listItems({ page: 1, pageSize: 50 });
    const queue: any = await h.svc.pendingPublish({ page: 1, pageSize: 50 });
    const q1 = queue.data.find((d: any) => d.inventoryItemId === 's1');
    const l1 = list.data.find((d: any) => d.id === 's1');
    expect(l1.resolvedSalePriceCents).toBe(110000); // mercado × (1 + 10 %)
    expect({ p: l1.resolvedSalePriceCents, b: l1.priceBasis }).toEqual({
      p: q1.resolvedSalePriceCents,
      b: q1.priceBasis,
    });
    const l2 = list.data.find((d: any) => d.id === 's2');
    expect({ p: l2.resolvedSalePriceCents, b: l2.priceBasis }).toEqual({
      p: 150000,
      b: 'override',
    });
  });

  it('sellado sin precio derivable ⇒ `{ null, "pending" }`', async () => {
    const h = build([row({ id: 's0' })]);
    const list: any = await h.svc.listItems({ page: 1, pageSize: 50 });
    expect(list.data[0]).toMatchObject({ resolvedSalePriceCents: null, priceBasis: 'pending' });
  });

  it.each([
    ['sellado reserved', { id: 'x', status: 'reserved', listPriceCents: 1000 }],
    [
      'sellado de cliente',
      { id: 'x', ownerType: 'customer', ownerUserId: 'ana', status: 'in_custody' },
    ],
    [
      'raw',
      { id: 'x', productType: 'raw', rawCondition: 'NM', sealedSubtype: null, __market: 100000 },
    ],
    [
      'graded',
      {
        id: 'x',
        productType: 'graded',
        gradingCompany: 'PSA',
        gradeValue: '10',
        sealedSubtype: null,
      },
    ],
  ])('%s ⇒ las claves NO viajan', async (_l, o) => {
    const h = build([row(o as AnyRow)]);
    const list: any = await h.svc.listItems({ page: 1, pageSize: 50 });
    expect('resolvedSalePriceCents' in list.data[0]).toBe(false);
    expect('priceBasis' in list.data[0]).toBe(false);
  });

  it('no escribe: ni escalada ni cierre de la cola de M2, ni escrituras de pieza', async () => {
    const h = build([sealedPriced('s1'), row({ id: 's0' })]);
    await h.svc.listItems({ page: 1, pageSize: 50 });
    expect((h.pricing as any).escalatePending).not.toHaveBeenCalled();
    expect((h.pricing as any).settlePendingForVariant).not.toHaveBeenCalled();
    expect(h.prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(h.prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('número de consultas IGUAL con 1 y con 50 filas selladas (contexto izado una vez por página)', async () => {
    const one = build([sealedPriced('s0')]);
    await one.svc.listItems({ page: 1, pageSize: 50 });
    const fifty = build(Array.from({ length: 50 }, (_, i) => sealedPriced(`s${i}`)));
    await fifty.svc.listItems({ page: 1, pageSize: 50 });
    expect(fifty.queries).toEqual(one.queries);
    expect(one.queries.filter((q) => q === 'pricing.loadPricingCurve')).toHaveLength(1);
  });

  it('página sin elegibles ⇒ ninguna consulta de precio', async () => {
    const h = build([
      row({ id: 'x', productType: 'raw', rawCondition: 'NM', sealedSubtype: null }),
    ]);
    await h.svc.listItems({ page: 1, pageSize: 50 });
    expect(h.queries.filter((q) => q.startsWith('pricing.load'))).toEqual([]);
  });
});

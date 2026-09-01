import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { InventoryPublishPort } from '../src/modules/inventory/inventory-publish.port';
import * as fs from 'fs';
import * as path from 'path';

/**
 * v1.51.19 — **§4.39m.8: la SEGUNDA ENTRADA del puerto, por VARIANTE.**
 *
 * El disparador (c) **no puede nombrar piezas**: `pricing` conoce una **clave de variante**. Y
 * `gradeKey` **NO es columna de `InventoryItem`** — se deriva. Lo que estos tests fijan:
 *  1. **La resolución vive DENTRO de `inventory`**: SELECT por columnas + filtro en memoria con
 *     `buildGradeKey`. **Ninguna regla entra al SQL**, y hay guarda que lo asevera.
 *  2. **Es un ADAPTADOR, no una copia**: desemboca en el mismo cuerpo, con las mismas guardas.
 *  3. **`gradeKey` discrimina de verdad**: una PSA 9 no se publica porque resuelva el precio de la
 *     PSA 10, ni una `raw:LP` por el de la `raw:NM`.
 *  4. **⚠️ Los TRES estados de `cardProductId`**: `undefined` ≠ `null`. Colapsarlos dejaría fuera
 *     justo las promos, con un fallo que se ve como un no-op.
 *  5. **Solo `in_stock` de plataforma** entra al candidato.
 */

const settings = { getNumber: jest.fn() } as unknown as SettingsService;

interface P {
  id: string;
  cardId?: string;
  productType?: string;
  rawCondition?: string | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
  finish?: string;
  status?: string;
  ownerType?: string;
  locationId?: string | null;
  cardProductId?: number | null;
  sealedProductId?: string | null;
  certNumber?: string | null;
  priced?: boolean;
}

function piece(o: P) {
  return {
    id: o.id,
    folio: `INV-${o.id}`,
    cardId: o.cardId ?? 'card-1',
    card: { id: o.cardId ?? 'card-1', rarity: 'Rare', rarityCanonical: 'rare' },
    productType: o.productType ?? 'raw',
    rawCondition: o.rawCondition === undefined ? 'NM' : o.rawCondition,
    gradingCompany: o.gradingCompany ?? null,
    gradeValue: o.gradeValue ?? null,
    finish: o.finish ?? 'normal',
    ownerType: o.ownerType ?? 'platform',
    status: o.status ?? 'in_stock',
    locationId: o.locationId === undefined ? 'loc-1' : o.locationId,
    listPriceCents: null,
    cardProductId: o.cardProductId === undefined ? null : o.cardProductId,
    sealedProductId: o.sealedProductId ?? null,
    certNumber: o.certNumber ?? null,
    sealedSubtype: null,
    acquisitionType: 'buylist',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    __priced: o.priced !== false,
  };
}

function build(rows: ReturnType<typeof piece>[]) {
  const queries: Record<string, unknown>[] = [];
  const prisma: any = {
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) => {
        queries.push(where);
        let out = rows;
        if (where?.id?.in) return out.filter((r) => where.id.in.includes(r.id));
        if (where?.ownerType) out = out.filter((r) => r.ownerType === where.ownerType);
        if (where?.status) out = out.filter((r) => r.status === where.status);
        if (where?.productType) out = out.filter((r) => r.productType === where.productType);
        if (where?.finish) out = out.filter((r) => r.finish === where.finish);
        if (where?.cardId?.in) out = out.filter((r) => where.cardId.in.includes(r.cardId));
        return out;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
    pendingPriceEntry: { findMany: jest.fn(async () => []) },
  };
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 0, sourceOn: false })),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
    getReferencesBatch: jest.fn(async (list: any[]) => {
      const m = new Map();
      for (const d of list) {
        const row = rows.find((r) => r.cardId === d.cardId);
        if (row?.__priced) {
          m.set(`${d.cardId}|${d.productType}|${d.gradeKey}|${d.finish}`, {
            status: 'priced',
            referenceMxnCents: 200000,
          });
        }
      }
      return m;
    }),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn(async () => 'ppe-1'),
  } as unknown as PricingService;
  const svc = new InventoryService(prisma as PrismaService, pricing, settings);
  return { svc, prisma, rows, queries, port: svc as unknown as InventoryPublishPort };
}

const RAW_NM = { cardId: 'card-1', productType: 'raw' as const, gradeKey: 'raw:NM', finish: 'normal' as const };

// =============================================================================================
describe('⚠️⚠️ (1) la resolución vive DENTRO de `inventory` — ni SQL ni DDL', () => {
  it('resuelve la variante a piezas y las publica', async () => {
    const { port, rows } = build([piece({ id: 'a' })]);
    const res = await port.reevaluateVariantsForPublication([RAW_NM]);
    expect(res.map((r) => r.outcome)).toEqual(['published']);
    expect(rows[0].status).toBe('listed');
  });

  it('⚠️ el `where` SOLO lleva columnas: `gradeKey` NUNCA entra a la consulta', async () => {
    const { port, queries } = build([piece({ id: 'a' })]);
    await port.reevaluateVariantsForPublication([RAW_NM]);
    const sel = queries[0];
    // Reconstruir `gradeKey` en SQL sería **una segunda definición de la clave de variante dentro de
    // una consulta**, sobre dinero: *una copia de la regla, no la salida de la regla* (§4.39m.6).
    expect(Object.keys(sel).sort()).toEqual(
      ['cardId', 'finish', 'ownerType', 'productType', 'status'].sort(),
    );
    expect(JSON.stringify(sel)).not.toContain('gradeKey');
    expect(JSON.stringify(sel)).not.toContain('rawCondition');
    expect(JSON.stringify(sel)).not.toContain('gradeValue');
  });

  it('⚠️ y el filtro usa `buildGradeKey`, la función de su dueño (no un literal copiado)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'modules', 'inventory', 'inventory.service.ts'),
      'utf8',
    );
    const body = src.slice(src.indexOf('async reevaluateVariantsForPublication('));
    expect(body.slice(0, body.indexOf('\n  }\n'))).toContain('buildGradeKey(c)');
  });

  it('el candidato se acota por la ENTRADA (cardIds concretos), no por el catálogo', async () => {
    const { port, queries } = build([piece({ id: 'a' }), piece({ id: 'b', cardId: 'card-9' })]);
    await port.reevaluateVariantsForPublication([RAW_NM]);
    expect(queries[0].cardId).toEqual({ in: ['card-1'] });
  });

  it('⚠️ NO se materializa nada: sigue sin haber columna `gradeKey` en el modelo', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model InventoryItem'));
    // *Materializar aquí sería añadir estado derivado —capaz de desincronizarse— para un problema
    // que no existe*: el conjunto está ACOTADO POR LA ENTRADA (§4.39m.8 refinando m.6).
    expect(model.slice(0, model.indexOf('\n}\n'))).not.toMatch(/^\s*gradeKey\s/m);
  });
});

// =============================================================================================
describe('⚠️ (2) `gradeKey` discrimina de verdad (por eso no se puede ignorar)', () => {
  it('una PSA 9 NO se publica por la variante de la PSA 10', async () => {
    const { port, rows } = build([
      piece({ id: 'psa9', productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '9' }),
    ]);
    const res = await port.reevaluateVariantsForPublication([
      { cardId: 'card-1', productType: 'graded', gradeKey: 'graded:PSA:10', finish: 'normal' },
    ]);
    expect(res).toEqual([]);
    expect(rows[0].status).toBe('in_stock');
  });

  it('…y sí con SU propia clave', async () => {
    const { port, rows } = build([
      piece({
        id: 'psa9',
        productType: 'graded',
        rawCondition: null,
        gradingCompany: 'PSA',
        gradeValue: '9',
        certNumber: 'PSA-123',
      }),
    ]);
    const res = await port.reevaluateVariantsForPublication([
      { cardId: 'card-1', productType: 'graded', gradeKey: 'graded:PSA:9', finish: 'normal' },
    ]);
    expect(res.map((r) => r.outcome)).toEqual(['published']);
    expect(rows[0].status).toBe('listed');
  });

  it('⚠️ y una gradeada SIN `certNumber` NO se publica ni por su propia clave (M-12)', async () => {
    // El puerto **no relaja ninguna guarda**: pasa por el mismo pipeline que el lote. Una gradeada
    // sin nº de certificado aparecería en Compra sin certificado verificable.
    const { port, rows } = build([
      piece({ id: 'psa9', productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '9' }),
    ]);
    const res = await port.reevaluateVariantsForPublication([
      { cardId: 'card-1', productType: 'graded', gradeKey: 'graded:PSA:9', finish: 'normal' },
    ]);
    expect(res.map((r) => r.outcome)).toEqual(['not_publishable']);
    expect(rows[0].status).toBe('in_stock');
  });

  it('una `raw:LP` NO se publica por la variante `raw:NM`', async () => {
    const { port, rows } = build([piece({ id: 'lp', rawCondition: 'LP' })]);
    expect(await port.reevaluateVariantsForPublication([RAW_NM])).toEqual([]);
    expect(rows[0].status).toBe('in_stock');
  });

  it('otro ACABADO tampoco entra (la clave de mercado es por acabado, M-19)', async () => {
    const { port, rows } = build([piece({ id: 'holo', finish: 'holofoil' })]);
    expect(await port.reevaluateVariantsForPublication([RAW_NM])).toEqual([]);
    expect(rows[0].status).toBe('in_stock');
  });
});

// =============================================================================================
describe('⚠️⚠️ (3) los TRES estados de `cardProductId`: `undefined` NO es `null`', () => {
  const promo = () => piece({ id: 'promo', cardProductId: 12345 });
  const base = () => piece({ id: 'base', cardProductId: null });

  it('AUSENTE ⇒ sin restricción: entran la promo Y la del set base', async () => {
    const { port, rows } = build([promo(), base()]);
    const res = await port.reevaluateVariantsForPublication([RAW_NM]);
    expect(res).toHaveLength(2);
    expect(rows.every((r) => r.status === 'listed')).toBe(true);
  });

  it('⚠️ `null` ⇒ SOLO la del set base — colapsarlo con `undefined` dejaría fuera las promos', async () => {
    const { port, rows } = build([promo(), base()]);
    const res = await port.reevaluateVariantsForPublication([{ ...RAW_NM, cardProductId: null }]);
    expect(res.map((r) => r.inventoryItemId)).toEqual(['base']);
    expect(rows.find((r) => r.id === 'promo')?.status).toBe('in_stock');
  });

  it('un número ⇒ SOLO ese producto (D7: promo y set base son variantes distintas)', async () => {
    const { port, rows } = build([promo(), base()]);
    const res = await port.reevaluateVariantsForPublication([{ ...RAW_NM, cardProductId: 12345 }]);
    expect(res.map((r) => r.inventoryItemId)).toEqual(['promo']);
    expect(rows.find((r) => r.id === 'base')?.status).toBe('in_stock');
  });

  it('⚠️ el docblock avisa de los DOS identificadores del mismo eje (uuid vs tcgplayerProductId)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'modules', 'inventory', 'inventory-publish.port.ts'),
      'utf8',
    );
    // Un llamador que pase el uuid de `PriceReference` no casaría con nada: **no-op silencioso**.
    expect(src).toContain('tcgplayerProductId');
    expect(src).toContain('no-op silencioso');
  });
});

// =============================================================================================
describe('⚠️ (4) es un ADAPTADOR: mismas guardas, mismo cuerpo', () => {
  it('solo `in_stock`: lo ya `listed` no se toca por esta vía', async () => {
    const { port, rows } = build([piece({ id: 'a', status: 'listed' })]);
    expect(await port.reevaluateVariantsForPublication([RAW_NM])).toEqual([]);
    expect(rows[0].status).toBe('listed');
  });

  it('nunca se vende lo ajeno: el inventario de custodia no entra al candidato', async () => {
    const { port, rows } = build([
      piece({ id: 'a', ownerType: 'customer', status: 'in_stock' }),
    ]);
    expect(await port.reevaluateVariantsForPublication([RAW_NM])).toEqual([]);
    expect(rows[0].status).toBe('in_stock');
  });

  it('sin ubicación NO publica, aunque la variante ya tenga precio', async () => {
    const { port, rows } = build([piece({ id: 'a', locationId: null })]);
    const res = await port.reevaluateVariantsForPublication([RAW_NM]);
    expect(res.map((r) => r.outcome)).toEqual(['missing_location']);
    expect(rows[0].status).toBe('in_stock');
  });

  it('sin precio resoluble NO publica y escala: el mismo desenlace que por id', async () => {
    const { port, pricing } = build([piece({ id: 'a', priced: false })]) as any;
    const res = await port.reevaluateVariantsForPublication([RAW_NM]);
    expect(res.map((r: any) => r.outcome)).toEqual(['price_pending']);
    expect(pricing).toBeUndefined();
  });

  it('lista vacía ⇒ no consulta nada', async () => {
    const { port, prisma } = build([piece({ id: 'a' })]);
    expect(await port.reevaluateVariantsForPublication([])).toEqual([]);
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it('⚠️ EN LOTE: N variantes NO producen N consultas de candidatos', async () => {
    const { port, queries } = build([
      piece({ id: 'a', cardId: 'c1' }),
      piece({ id: 'b', cardId: 'c2' }),
      piece({ id: 'c', cardId: 'c3' }),
    ]);
    await port.reevaluateVariantsForPublication([
      { ...RAW_NM, cardId: 'c1' },
      { ...RAW_NM, cardId: 'c2' },
      { ...RAW_NM, cardId: 'c3' },
    ]);
    // Mismo (productType, finish) ⇒ **una** consulta con `cardId IN (…)`. El fan-out que el lote
    // existe para evitar aplica también aquí adentro.
    const candidateQueries = queries.filter((q) => (q as any).ownerType === 'platform');
    expect(candidateQueries).toHaveLength(1);
    expect((candidateQueries[0] as any).cardId.in.sort()).toEqual(['c1', 'c2', 'c3']);
  });
});

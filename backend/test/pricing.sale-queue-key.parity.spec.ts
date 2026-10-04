import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';
import { DEFAULT_PRICING_CURVE, normalizePricingCurve } from '../src/common/pricing-curve';
import { serializeSaleQueueKey } from '../src/modules/pricing/sale-queue-key';
import { stripComments } from './helpers/strip-comments';
import { identCensus } from './helpers/ident-census';

/**
 * Techlead D-1 (gate sobre `8a10153e`) — **PARIDAD de la clave de cola de VENTA entre la publicación y
 * el barrido VQ** (API_CONTRACT §M2 `M2-VQ`, ARCHITECTURE §4.36.5 c-bis).
 *
 * `derivePublishSalePrice` decide con QUÉ clave la publicación escala/cierra una fila de la cola, y el
 * barrido VQ de `price-sync` decide —con la clave de cada pieza vendible— qué filas «sin motivo» se
 * DEJAN. Si las dos claves divergen en un solo componente, el barrido cierra la fila que la publicación
 * va a reabrir en la siguiente corrida (o deja viva la de otro producto), y ninguna prueba de un módulo
 * solo lo ve. Aquí se mide **por conducta**: para cada forma de pieza (raw, graded, sellado mapeado,
 * sellado legacy, promo con `cardProductId`) se toma la `pendingKey` REAL de `derivePublishSalePrice`,
 * se siembra una fila «sin motivo» con ESA clave y se corre el barrido REAL con la pieza presente ⇒ la
 * fila tiene que quedarse; y la fila de la variante VECINA (que difiere en un componente) se cierra.
 */

function buildPrisma(items: any[], pending: any[]) {
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('in' in v) return v.in.includes(row[k]);
        if ('notIn' in v) return !v.notIn.includes(row[k]);
      }
      return (row[k] ?? null) === (v ?? null);
    });
  const prisma: any = {
    inventoryItem: { findMany: jest.fn(async ({ where }: any) => items.filter((i) => matches(i, where))) },
    pendingPriceEntry: {
      findMany: jest.fn(async ({ where }: any) => pending.filter((p) => matches(p, where))),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const p of pending) {
          if (matches(p, where)) {
            Object.assign(p, data);
            count++;
          }
        }
        return { count };
      }),
    },
  };
  return prisma;
}

function buildPricing(prisma: any): PricingService {
  const config = { get: () => undefined } as any;
  return new PricingService(
    prisma as PrismaService,
    {} as SettingsService,
    {} as FxService,
    {} as PokemonTcgIoProvider,
    new PokemonPriceTrackerProvider(config),
    new PokeTraceProvider(config),
  );
}

const piece = (over: any) => ({
  id: over.id,
  folio: `F-${over.id}`,
  productType: 'raw',
  rawCondition: 'NM',
  finish: 'normal',
  ownerType: 'platform',
  status: 'in_stock',
  listPriceCents: null,
  cardProductId: null,
  sealedProductId: null,
  sealedSubtype: null,
  tcgplayerProductId: null,
  gradingCompany: null,
  gradeValue: null,
  card: { rarity: 'Common', rarityCanonical: 'Common' },
  ...over,
});

/** Las formas de pieza que el techlead enumeró, con la variante VECINA que NO debe casar. */
const CASES: Array<{ name: string; item: any; neighbour: Record<string, unknown> }> = [
  {
    name: 'raw (set base)',
    item: piece({ id: 'raw', cardId: 'c-raw', finish: 'holofoil' }),
    neighbour: { finish: 'normal' },
  },
  {
    name: 'graded (PSA 9)',
    item: piece({
      id: 'gr',
      cardId: 'c-gr',
      productType: 'graded',
      rawCondition: null,
      gradingCompany: 'PSA',
      gradeValue: '9',
    }),
    neighbour: { gradeKey: 'graded:PSA:10' },
  },
  {
    name: 'sellado MAPEADO (`sealed:tcg:<id>`, `sealedProductId`)',
    item: piece({
      id: 'sm',
      cardId: 'c-sm',
      productType: 'sealed',
      rawCondition: null,
      tcgplayerProductId: 777,
      sealedProductId: 'sp-etb',
      sealedSubtype: 'etb',
    }),
    neighbour: { sealedProductId: 'sp-blister' },
  },
  {
    name: 'sellado LEGACY (sin mapeo ni `sealedProductId` ⇒ gradeKey estructural `sealed`)',
    item: piece({
      id: 'sl',
      cardId: 'c-sl',
      productType: 'sealed',
      rawCondition: null,
      finish: 'holofoil',
    }),
    neighbour: { gradeKey: 'sealed:tcg:1' },
  },
  {
    name: 'promo con `cardProductId`',
    item: piece({ id: 'pr', cardId: 'c-pr', cardProductId: 4242 }),
    neighbour: { cardProductId: null },
  },
];

const ctx = (refs: Map<string, any> = new Map()) => ({
  curve: normalizePricingCurve(DEFAULT_PRICING_CURVE),
  sealed: { spreadPctBySubtype: {}, fallbackPct: 0, sourceOn: true },
  refs,
  variantOverrides: new Map(),
});

function derive(pricing: PricingService, item: any, refs?: Map<string, any>) {
  return (InventoryService.prototype as any).derivePublishSalePrice.call({ pricing }, item, null, ctx(refs));
}

describe('D-1 — la clave del barrido VQ ES la `pendingKey` de `derivePublishSalePrice`', () => {
  describe.each(CASES)('$name', ({ item, neighbour }) => {
    it('SIN mercado (la publicación ESCALA): el barrido deja la fila que la publicación abre y cierra la vecina', async () => {
      const pending: any[] = [];
      const prisma = buildPrisma([item], pending);
      const pricing = buildPricing(prisma);
      const d = derive(pricing, item);
      expect(d.ok).toBe(false);
      expect(d.pendingKey).not.toBeNull();
      const row = { status: 'open', context: 'inventory', reason: null };
      pending.push({ id: 'same', ...row, ...d.pendingKey });
      pending.push({ id: 'other', ...row, ...d.pendingKey, ...neighbour });
      const res = await new PriceSyncJobService(prisma, pricing).sweepUnreasonedSaleQueue();
      expect(pending.map((p) => [p.id, p.status])).toEqual([
        ['same', 'open'],
        ['other', 'resolved'],
      ]);
      expect(res).toEqual({ closed: 1, kept: 1 });
    });
  });

  it('CON precio derivado (la publicación CIERRA): la clave de cierre es la misma que la del barrido', async () => {
    const raw = CASES[4].item; // promo: el componente que más se olvida
    const sealed = CASES[2].item;
    const refs = new Map<string, any>([
      [`${raw.cardId}|raw|raw:NM|normal`, { status: 'priced', referenceMxnCents: 100_000 }],
      [`${sealed.cardId}|sealed|sealed:tcg:777|normal`, { status: 'priced', referenceMxnCents: 200_000 }],
    ]);
    for (const item of [raw, sealed]) {
      const pending: any[] = [];
      const prisma = buildPrisma([item], pending);
      const pricing = buildPricing(prisma);
      const d = derive(pricing, item, refs);
      expect({ id: item.id, ok: d.ok, source: d.priceSource }).toEqual({
        id: item.id,
        ok: true,
        source: 'derived',
      });
      pending.push({ id: 'same', status: 'open', context: 'inventory', reason: null, ...d.pendingKey });
      await new PriceSyncJobService(prisma, pricing).sweepUnreasonedSaleQueue();
      expect({ id: item.id, status: pending[0].status }).toEqual({ id: item.id, status: 'open' });
    }
  });

  it('graded SIN identidad de slab: ni la publicación ni el barrido tienen clave', async () => {
    const item = piece({ id: 'gx', cardId: 'c-gx', productType: 'graded', rawCondition: null });
    const pending: any[] = [
      { id: 'r', status: 'open', context: 'inventory', reason: null, cardId: 'c-gx', productType: 'graded', gradeKey: 'graded:PSA:10', finish: 'normal', cardProductId: null, sealedProductId: null },
    ];
    const prisma = buildPrisma([item], pending);
    const pricing = buildPricing(prisma);
    expect(derive(pricing, item).pendingKey).toBeNull();
    await new PriceSyncJobService(prisma, pricing).sweepUnreasonedSaleQueue();
    expect(pending[0].status).toBe('resolved');
  });

  it('una sola serialización: `undefined` ≡ `null` y sin separador que colisione', () => {
    const base = { cardId: 'c', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' };
    expect(serializeSaleQueueKey(base)).toBe(
      serializeSaleQueueKey({ ...base, cardProductId: null, sealedProductId: null }),
    );
    // Con un `|`.join estas dos colisionaban (`a|b` + `c` vs `a` + `b|c`).
    expect(serializeSaleQueueKey({ ...base, cardId: 'a|raw', productType: 'x' })).not.toBe(
      serializeSaleQueueKey({ ...base, cardId: 'a', productType: 'raw|x' }),
    );
  });
});

describe('D-1 — censo: la derivación y la serialización viven en UN sitio', () => {
  const SRC = join(__dirname, '..', 'src');

  it('`saleQueueKeyOf`/`sealedSaleQueueKeyOf` solo los usan la publicación y el barrido', () => {
    expect(identCensus(SRC, /\b(?:saleQueueKeyOf|sealedSaleQueueKeyOf)\b/g)).toEqual({
      // definiciones + llamada interna (`saleQueueKeyOf` → `sealedSaleQueueKeyOf`)
      'modules/pricing/sale-queue-key.ts': 3,
      // import (2) + sellado + raw/graded en `derivePublishSalePrice`
      'modules/inventory/inventory.service.ts': 4,
      // import + barrido
      'jobs/price-sync.service.ts': 2,
    });
  });

  it('el barrido no arma claves a mano (sin `JSON.stringify` ni `.join` propios)', () => {
    const code = stripComments(readFileSync(join(SRC, 'jobs/price-sync.service.ts'), 'utf8'));
    expect(code).not.toMatch(/JSON\.stringify\(\s*\[/);
    expect(code).not.toMatch(/function\s+queueKey\b/);
    expect(code).toMatch(/serializeSaleQueueKey\(r\)/);
  });
});

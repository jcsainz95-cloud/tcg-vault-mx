import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_PRICING_CURVE,
  premiumFloorGuard,
  resolvePendingReason,
} from '../src/common/pricing-curve';

/**
 * E4 (ARCHITECTURE §4.36.5) — GUARDARRAÍL: la rareza sale del PRICING y entra a la VALIDACIÓN.
 *
 * Sustituye al invariante `premium ⇒ pct` de §4.33d, que con la curva queda sin sentido. Sin él, un
 * dato de mercado malo en una carta cara la vendería al piso — la pérdida IRREVERSIBLE que §N.0 manda
 * evitar. Cubre:
 *  - el predicado y el veredicto puros (§4.36.5b), incluida la simetría de los DOS ejes;
 *  - el CICLO COMPLETO: escalar ⇒ inyectar `PriceReference` ⇒ re-resolver ⇒ entrada `resolved` +
 *    pieza publicable, SIN intervención manual (§4.36.5c — comportamiento NUEVO: hasta v1.44 la cola
 *    solo se vaciaba con el override manual);
 *  - la razón (`no_market` vs `premium_at_floor`), que es lo que hace TRIABLE la cola;
 *  - que NO dispara con override ni bounty (decisiones deliberadas del admin).
 */

const CHASE = 'Special Illustration Rare'; // premium en el catálogo canónico
const BULK = 'Common'; // NO premium

describe('E4 — veredicto puro (§4.36.5)', () => {
  it('premium + floor ⇒ premium_at_floor en los DOS ejes (pagar de menos = vender de menos)', () => {
    expect(premiumFloorGuard(CHASE, 'floor')).toBe('premium_at_floor');
    expect(resolvePendingReason('floor', CHASE)).toBe('premium_at_floor');
  });

  it('NO premium en el piso ⇒ se publica (una Common al piso es legítima)', () => {
    expect(resolvePendingReason('floor', BULK)).toBeNull();
  });

  it('sin mercado ⇒ no_market para CUALQUIER rareza (el piso NO gana)', () => {
    expect(resolvePendingReason('pending', BULK)).toBe('no_market');
    expect(resolvePendingReason('pending', CHASE)).toBe('no_market');
  });

  it('override y bounty NUNCA disparan el guardarraíl (§4.36.6)', () => {
    expect(resolvePendingReason('override', CHASE)).toBeNull();
    expect(resolvePendingReason('bounty', CHASE)).toBeNull();
  });

  it('market ⇒ se publica', () => {
    expect(resolvePendingReason('market', CHASE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CICLO COMPLETO sobre el eje de VENTA (publicación) con PricingService REAL.
// ---------------------------------------------------------------------------

interface PendingRow {
  id: string;
  cardId: string;
  productType: string;
  gradeKey: string;
  finish: string;
  cardProductId: number | null;
  sealedProductId: string | null;
  context: string;
  status: string;
  reason: string | null;
  resolvedAt: Date | null;
}

function harness(rarity: string | null) {
  const item = {
    id: 'it-1',
    cardId: 'c1',
    productType: 'raw',
    rawCondition: 'NM',
    sealedSubtype: null,
    gradingCompany: null,
    gradeValue: null,
    certNumber: null,
    finish: 'normal',
    ownerType: 'platform',
    status: 'in_stock',
    listPriceCents: null,
    tcgplayerProductId: null,
    folio: 'INV-1',
    card: { id: 'c1', rarity, rarityCanonical: rarity, setId: 's1', name: 'X', number: '1' },
  };
  const pendingStore: PendingRow[] = [];
  let pendSeq = 0;
  /** Referencia de mercado inyectable — simula lo que escribe el barrido `price-ingest`. */
  const market: { cents: number | null } = { cents: null };

  const matchKey = (e: PendingRow, w: Record<string, unknown>) =>
    e.cardId === w.cardId &&
    e.productType === w.productType &&
    e.gradeKey === w.gradeKey &&
    e.finish === w.finish &&
    e.status === w.status;

  const prisma = {
    inventoryItem: {
      findMany: jest.fn(async () => [item]),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: { in: string[] } }; data: Record<string, unknown> }) => {
        if (item.id === where.id && where.status.in.includes(item.status)) {
          Object.assign(item, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    variantPriceOverride: { findMany: jest.fn(async () => []) },
    pendingPriceEntry: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        pendingStore.find((e) => matchKey(e, where)) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `pend-${++pendSeq}`,
          resolvedAt: null,
          reason: null,
          cardProductId: null,
          sealedProductId: null,
          ...data,
        } as PendingRow;
        pendingStore.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = pendingStore.find((e) => e.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const e of pendingStore) {
          if (matchKey(e, where)) {
            Object.assign(e, data);
            count++;
          }
        }
        return { count };
      }),
    },
    priceReference: { findMany: jest.fn(async () => []) },
  } as unknown as PrismaService;

  const settings = { getNumber: jest.fn(async () => 70), getRaw: jest.fn(async () => null) } as unknown as SettingsService;
  const pricing = new PricingService(prisma, settings, {} as FxService, {} as never, {} as never, {} as never);
  jest.spyOn(pricing, 'loadPricingCurve').mockResolvedValue(DEFAULT_PRICING_CURVE);
  jest.spyOn(pricing, 'loadSealedSpreads').mockResolvedValue({
    spreadPctBySubtype: {},
    fallbackPct: 25,
    sourceOn: false,
  });
  // El lote de referencias devuelve lo que el "barrido" haya escrito hasta el momento.
  jest.spyOn(pricing, 'getReferencesBatch').mockImplementation(async (keys) => {
    const m = new Map<string, { status: 'priced' | 'pending'; referenceMxnCents?: number }>();
    if (market.cents != null) {
      for (const k of keys) {
        m.set(`${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`, {
          status: 'priced',
          referenceMxnCents: market.cents,
        });
      }
    }
    return m as never;
  });
  const inventory = new InventoryService(prisma, pricing, settings);
  const publish = () => inventory.bulkPublish({ items: [{ inventoryItemId: 'it-1' }] } as never, 'admin');
  return { item, pendingStore, market, publish, pricing };
}

describe('E4 — ciclo completo de la cola (§4.36.5c): escalar ⇒ mercado real ⇒ cerrar SOLA', () => {
  it('chase SIN mercado ⇒ no publica, escala con reason="no_market"', async () => {
    const h = harness(CHASE);
    const res = await h.publish();
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect(h.item.status).toBe('in_stock');
    expect(h.pendingStore).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({ status: 'open', reason: 'no_market', context: 'inventory' });
  });

  it('chase con mercado ABSURDO (aterriza en el piso) ⇒ el GUARDARRAÍL bloquea y la razón CAMBIA', async () => {
    const h = harness(CHASE);
    await h.publish(); // no_market
    // El barrido escribe un dato malo: $1 de mercado en una Special Illustration Rare.
    h.market.cents = 100;
    const res = await h.publish();
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect((res.results[0] as { error: { message: string } }).error.message).toMatch(
      /Premium rarity resolved to the floor/,
    );
    expect(h.item.status).toBe('in_stock');
    // La MISMA entrada (dedupe por clave), con la razón ACTUALIZADA: la cola refleja el problema
    // VIGENTE, que es lo que la hace triable.
    expect(h.pendingStore).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({ status: 'open', reason: 'premium_at_floor' });
  });

  it('el siguiente barrido escribe mercado REAL ⇒ publica y la entrada se cierra SOLA', async () => {
    const h = harness(CHASE);
    await h.publish();
    h.market.cents = 100;
    await h.publish();
    expect(h.pendingStore[0].status).toBe('open');

    // price-ingest corrige el dato: $500 de mercado.
    h.market.cents = 50000;
    const res = await h.publish();

    expect(res.results[0]).toMatchObject({ ok: true, salePriceCents: 57500 }); // $500 × 1.15
    expect(h.item.status).toBe('listed');
    // SALIDA SIMÉTRICA, sin intervención manual.
    expect(h.pendingStore[0].status).toBe('resolved');
    expect(h.pendingStore[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('una NO premium en el piso SÍ se publica (el guardarraíl no es un piso por rareza)', async () => {
    const h = harness(BULK);
    h.market.cents = 100; // $1 de mercado ⇒ $1.60 ⇒ gana el piso $25 ⇒ redondeo ⇒ $25
    const res = await h.publish();
    expect(res.results[0]).toMatchObject({ ok: true, salePriceCents: 2500 });
    expect(h.item.status).toBe('listed');
    expect(h.pendingStore).toHaveLength(0);
  });

  it('rareza SIN clasificar (null) no dispara el guardarraíl', async () => {
    const h = harness(null);
    h.market.cents = 100;
    const res = await h.publish();
    expect(res.results[0].ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Efecto en las superficies de lectura y de cobro.
// ---------------------------------------------------------------------------

function listingHarness(rarity: string | null, referenceMxnCents: number | null) {
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    getReference: jest.fn(async () =>
      referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
    ),
    computeSalePriceForItem: jest.fn(async (ref: number | null, controls?: never) => {
      const { computeSalePriceFromCurve } = await import('../src/common/money');
      return computeSalePriceFromCurve(ref, DEFAULT_PRICING_CURVE, controls);
    }),
    getVariantOverride: jest.fn(async () => null),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    settlePendingForVariant: jest.fn(async () => undefined),
  } as unknown as PricingService;
  const item = {
    id: 'i1',
    cardId: 'c1',
    productType: 'raw',
    rawCondition: 'NM',
    sealedSubtype: null,
    gradingCompany: null,
    gradeValue: null,
    certNumber: null,
    status: 'listed',
    finish: 'normal',
    ownerType: 'platform',
    folio: 'INV-1',
    listPriceCents: null,
    createdAt: new Date('2026-08-01'),
    card: {
      id: 'c1',
      externalId: 'x',
      name: 'N',
      number: '1',
      rarity,
      supertype: 'Pokémon',
      subtypes: [],
      setId: 's',
      imageSmallUrl: null,
      imageLargeUrl: null,
      availableFinishes: ['normal'],
      set: { id: 's', name: 'Set' },
    },
  };
  return { pricing, item };
}

describe('E4 — efecto del guardarraíl en Compra y en el checkout', () => {
  it('la ficha NO publica una chase en el piso: sellable=false y priceBasis="pending"', async () => {
    const { pricing, item } = listingHarness(CHASE, 100);
    const dto = await new CatalogService({} as PrismaService, pricing).toListingDTO(item as never);
    expect(dto.sellable).toBe(false);
    expect(dto.salePriceCents).toBeUndefined();
    expect(dto.priceBasis).toBe('pending');
    // La referencia sigue viajando (el DTO alimenta superficies admin); el front OBEDECE priceBasis.
    expect(dto.referenceValue).toMatchObject({ status: 'priced', referenceMxnCents: 100 });
  });

  it('la misma carta con mercado REAL sí se publica', async () => {
    const { pricing, item } = listingHarness(CHASE, 50000);
    const dto = await new CatalogService({} as PrismaService, pricing).toListingDTO(item as never);
    expect(dto.sellable).toBe(true);
    expect(dto.salePriceCents).toBe(57500);
    expect(dto.priceBasis).toBe('market');
  });

  it('el checkout tampoco la cobra (cierra la puerta de atrás por inventoryItemId)', async () => {
    const { pricing, item } = listingHarness(CHASE, 100);
    const prisma = { inventoryItem: { findMany: jest.fn(async () => [item]) } } as unknown as PrismaService;
    const settings = {
      getNumber: jest.fn(async () => 16),
      getStripeFee: jest.fn(async () => ({ stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 })),
    } as unknown as SettingsService;
    const orders = new OrdersService(prisma, pricing, settings, {} as StripeService, {} as CatalogService);
    await expect(orders.quote(['i1'])).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });
});

describe('E4 — guardarraíl del eje de COMPRA (§4.36.5, simetría money-safe)', () => {
  function buylistFor(rarity: string, referenceMxnCents: number | null, override?: Record<string, unknown>) {
    const prisma = {
      card: {
        findUnique: jest.fn(async () => ({ id: 'c1', rarity, availableFinishes: ['normal'] })),
      },
    } as unknown as PrismaService;
    const pricing = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      gradeKeyFor: jest.fn(() => 'raw:NM'),
      getReference: jest.fn(async () =>
        referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
      ),
      getVariantOverride: jest.fn(async () => override ?? null),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      escalatePending: jest.fn(),
      settlePendingForVariant: jest.fn(async () => undefined),
    } as unknown as PricingService;
    const settings = { getRaw: jest.fn(), getNumber: jest.fn(async () => 0) } as unknown as SettingsService;
    return {
      svc: new BuylistService(
        prisma,
        pricing,
        settings,
        {} as UsersService,
        new PiiCryptoService(new ConfigService({})),
      ),
      pricing,
    };
  }

  it('una chase que aterriza en el BIN NO se cotiza: precio_pendiente (no se ofrece $1)', async () => {
    const { svc } = buylistFor(CHASE, 100); // $1 de mercado ⇒ 30 % = $0.30 ⇒ gana el bin $1
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
    expect(q.priceBasis).toBe('pending');
  });

  it('READ-ONLY: el quote público NO escribe en la cola aunque el guardarraíl dispare (v1.12)', async () => {
    const { svc, pricing } = buylistFor(CHASE, 100);
    await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(pricing.escalatePending).not.toHaveBeenCalled();
    expect(pricing.settlePendingForVariant).not.toHaveBeenCalled();
  });

  it('una Common en el bin SÍ se cotiza (bulk legítimo, $1)', async () => {
    const { svc } = buylistFor(BULK, 100);
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.quotedPriceCents).toBe(100);
    expect(q.priceBasis).toBe('floor');
  });

  it('un OVERRIDE de compra desactiva el guardarraíl (decisión deliberada del admin)', async () => {
    const { svc } = buylistFor(CHASE, 100, { buyOverrideCents: 50 });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.quotedPriceCents).toBe(50); // ABSOLUTO: incluso por debajo del bin
    expect(q.priceBasis).toBe('override');
  });

  it('un BOUNTY también lo desactiva', async () => {
    const { svc } = buylistFor(CHASE, 100, { bountyEnabled: true, bountyPriceCents: 900000 });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.quotedPriceCents).toBe(900000);
    expect(q.priceBasis).toBe('bounty');
  });
});

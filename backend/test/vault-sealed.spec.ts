import { VaultService } from '../src/modules/vault/vault.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * v1.23-sealed-sales (§3 / §4.23g) — pestaña «Sellado» de la bóveda: agrega por producto+condición,
 * valúa por `sealedMarketRef` (misma base del portafolio), EXCLUYE del total las piezas sin mercado y
 * las cuenta en `pendingPriceCount`, y desglosa la titularidad (pending|settled).
 */

function card(over: Partial<any> = {}) {
  return {
    id: 'c1',
    externalId: 'sv8-100',
    name: 'Booster Box',
    number: '1',
    numberSort: 1,
    numberPrefix: '',
    rarity: null,
    supertype: null,
    subtypes: [],
    setId: 'set1',
    imageSmallUrl: 'https://img/s.png',
    imageLargeUrl: 'https://img/l.png',
    availableFinishes: ['normal'],
    set: { id: 'set1', name: 'Surging Sparks' },
    ...over,
  };
}

function piece(over: Partial<any> = {}) {
  return {
    id: 'i1',
    cardId: 'c1',
    productType: 'sealed',
    status: 'in_custody',
    ownerType: 'customer',
    ownerUserId: 'u1',
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    finish: 'normal',
    tcgplayerProductId: 100,
    ownershipStatus: 'settled',
    // M-37 snapshot congelado por-pieza (identidad real del SealedProduct); null → cae a la Card ancla.
    sealedProductName: null,
    sealedImageUrl: null,
    sealedProductId: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    card: card(),
    ...over,
  };
}

function build(items: any[], refs: Map<string, any>) {
  const prisma = {
    inventoryItem: { findMany: jest.fn(async () => items) },
  } as unknown as PrismaService;
  const pricing = {
    sealedMarketGradeKeyForItem: jest.fn((it: any) =>
      it.tcgplayerProductId != null ? `sealed:tcg:${it.tcgplayerProductId}` : null,
    ),
    getReferencesBatch: jest.fn(async () => refs),
    // v1.22-2 / N-15: displayFinishes se deriva de este lote (default vacío = sin supresión).
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    // H-1 (v1.24): dial encendido EN RUNTIME (sourceOn:true) — el SEED del dial es `off` (fail-closed,
    // por contrato §M10); este test fija sourceOn:true para ejercer la valuación con el mercado activo.
    // El gate es la misma expresión trivial que el método real `PricingService.gateSealedMarketCents`
    // (no reimplementa la pura `computeSealedSalePrice`: `sealedTab` valúa por gate del mercado, no por spread).
    loadSealedSpreads: jest.fn(async () => ({
      spreadPctBySubtype: {},
      fallbackPct: 25,
      sourceOn: true,
    })),
    gateSealedMarketCents: (ref: any, sourceOn: boolean) => {
      if (ref?.status !== 'priced' || ref.referenceMxnCents == null) return null;
      if (ref.isManualOverride === true || ref.source === 'manual') return ref.referenceMxnCents;
      return sourceOn ? ref.referenceMxnCents : null;
    },
  } as unknown as PricingService;
  return { prisma, pricing, svc: new VaultService(prisma, pricing) };
}

describe('VaultService.sealedTab — agregación + valuación de la bóveda sellada', () => {
  it('agrupa por producto+condición, valúa a mercado, desglosa titularidad; pendientes excluidos y contados', async () => {
    const items = [
      piece({ id: 'a', tcgplayerProductId: 100, ownershipStatus: 'settled' }),
      piece({ id: 'b', tcgplayerProductId: 100, ownershipStatus: 'pending' }),
      piece({ id: 'c', tcgplayerProductId: null }), // no mapeado → sin mercado → pendiente
    ];
    const refs = new Map<string, any>([
      ['c1|sealed|sealed:tcg:100|normal', { status: 'priced', referenceMxnCents: 100000 }],
    ]);
    const { svc } = build(items, refs);
    const res = await svc.sealedTab('u1', {});

    // Dos grupos: producto 100 (mapeado) y producto no mapeado.
    expect(res.data).toHaveLength(2);
    const mapped = res.data.find((g) => g.count === 2)!;
    expect(mapped.ownership).toEqual({ pending: 1, settled: 1 });
    expect(mapped.totalMarketValueMxnCents).toBe(200000); // 2 × 100000
    expect(mapped.marketValue).toMatchObject({ status: 'priced', referenceMxnCents: 100000 });

    const unmapped = res.data.find((g) => g.count === 1)!;
    expect(unmapped.totalMarketValueMxnCents).toBeNull();
    expect(unmapped.marketValue.status).toBe('pending');

    // Total = solo lo priceado; el pendiente NO suma pero cuenta 1 pieza.
    expect(res.totalValueMxnCents).toBe(200000);
    expect(res.pendingPriceCount).toBe(1);
    expect(res.currency).toBe('MXN');
  });

  it('H-P38-1: el grid de bóveda usa la IDENTIDAD del SealedProduct (snapshot), NO el single ancla («Tropius»)', async () => {
    const items = [
      piece({
        id: 'a',
        tcgplayerProductId: 100,
        sealedSubtype: 'etb',
        sealedProductName: 'Surging Sparks Elite Trainer Box',
        sealedImageUrl: 'https://img/etb.png',
        card: card({ name: 'Tropius', imageSmallUrl: 'https://img/tropius.png' }),
      }),
    ];
    const refs = new Map<string, any>([
      ['c1|sealed|sealed:tcg:100|normal', { status: 'priced', referenceMxnCents: 100000 }],
    ]);
    const { svc } = build(items, refs);
    const res = await svc.sealedTab('u1', {});
    expect(res.data).toHaveLength(1);
    expect(res.data[0].productName).toBe('Surging Sparks Elite Trainer Box');
    expect(res.data[0].imageUrl).toBe('https://img/etb.png');
    expect(res.data[0].productName).not.toBe('Tropius');
    expect(res.data[0].imageUrl).not.toBe('https://img/tropius.png');
  });

  it('H-P38-1: sin snapshot (legacy) el grid de bóveda CAE a la Card ancla (fallback de cascada)', async () => {
    const items = [piece({ id: 'a', tcgplayerProductId: 100, sealedProductName: null, sealedImageUrl: null })];
    const refs = new Map<string, any>([
      ['c1|sealed|sealed:tcg:100|normal', { status: 'priced', referenceMxnCents: 100000 }],
    ]);
    const { svc } = build(items, refs);
    const res = await svc.sealedTab('u1', {});
    expect(res.data[0].productName).toBe('Booster Box');
    expect(res.data[0].imageUrl).toBe('https://img/s.png');
  });

  /**
   * v2.1.9 · MENOR 3 (QA) — **el filtro `sealedSubtype`, que es donde el bug MENTÍA.**
   *
   * Este spec no ejercitaba `sealedSubtype` con NINGÚN valor, y es justo el sitio del fallo de
   * v2.1.8: la lista de subtipos era de cinco a mano, así que `?sealedSubtype=upc` **no fallaba —
   * MENTÍA**: `SEALED_SUBTYPE_SET.has('upc')` daba `false`, el `if` no entraba, el WHERE salía sin
   * el filtro y el cliente recibía **todo su sellado** creyendo estar viendo solo sus UPC. «Se
   * ignoran silenciosamente los valores que no matchean» es correcto para basura desconocida; para
   * un valor que **existe en el schema**, el silencio escondía el bug.
   *
   * QA no pudo probarlo por comportamiento porque la bóveda del seed está vacía de sellado: se
   * verifica sobre el **WHERE que llega a Prisma**, que es donde el filtro se perdía.
   */
  it.each(['box', 'etb', 'bundle', 'tin', 'blister', 'upc', 'collection'])(
    'MENOR 3 — `sealedSubtype=%s` LLEGA al WHERE (los SIETE, no cinco)',
    async (subtype) => {
      const { prisma, svc } = build([], new Map());
      await svc.sealedTab('u1', { sealedSubtype: subtype });
      const where = (prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.sealedSubtype).toBe(subtype);
    },
  );

  it('MENOR 3 — `upc` FILTRA de verdad: la caja de otro subtipo no vuelve (antes volvía todo)', async () => {
    // Comportamiento, no solo forma: con el filtro perdido el servicio devolvía el sellado ENTERO.
    // El mock de Prisma respeta el WHERE para que el test mida el efecto, no la intención.
    const all = [
      piece({ id: 'a', sealedSubtype: 'upc', tcgplayerProductId: 100 }),
      piece({ id: 'b', sealedSubtype: 'box', tcgplayerProductId: 101 }),
    ];
    const prisma = {
      inventoryItem: {
        findMany: jest.fn(async (args: any) =>
          all.filter((i) => !args?.where?.sealedSubtype || i.sealedSubtype === args.where.sealedSubtype),
        ),
      },
    } as unknown as PrismaService;
    const refs = new Map<string, any>([
      ['c1|sealed|sealed:tcg:100|normal', { status: 'priced', referenceMxnCents: 100000 }],
      ['c1|sealed|sealed:tcg:101|normal', { status: 'priced', referenceMxnCents: 200000 }],
    ]);
    const { pricing } = build([], refs);
    const svc = new VaultService(prisma, pricing);

    const upcOnly = await svc.sealedTab('u1', { sealedSubtype: 'upc' });
    expect(upcOnly.data).toHaveLength(1);
    expect(upcOnly.data[0].sealedSubtype).toBe('upc');

    // Sin filtro vuelven los dos: así se ve que el 1 de arriba es EL FILTRO y no una bóveda vacía.
    const unfiltered = await svc.sealedTab('u1', {});
    expect(unfiltered.data).toHaveLength(2);
  });

  it('un subtipo INEXISTENTE se sigue ignorando (tolerar basura desconocida SÍ es correcto)', async () => {
    // La distinción del hallazgo: ignorar un valor que el schema NO conoce está bien; ignorar uno
    // que SÍ conoce es esconder un bug. Este test fija que el arreglo no volvió estricto lo otro.
    const { prisma, svc } = build([], new Map());
    await svc.sealedTab('u1', { sealedSubtype: 'no_existe' });
    const where = (prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.sealedSubtype).toBeUndefined();
  });

  it('el filtro de `condition` viaja igual (los DOS valores del enum)', async () => {
    for (const cond of ['mint', 'minor_box_damage']) {
      const { prisma, svc } = build([], new Map());
      await svc.sealedTab('u1', { condition: cond });
      const where = (prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.sealedCondition).toBe(cond);
    }
  });

  it('usa el filtro de status "en bóveda" (excluye withdrawn/shipped/delivered/lost/damaged)', async () => {
    const { prisma, svc } = build([], new Map());
    await svc.sealedTab('u1', {});
    const where = (prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.ownerType).toBe('customer');
    expect(where.ownerUserId).toBe('u1');
    expect(where.productType).toBe('sealed');
    expect(where.status).toEqual({ notIn: ['withdrawn', 'shipped', 'delivered', 'lost', 'damaged'] });
  });
});

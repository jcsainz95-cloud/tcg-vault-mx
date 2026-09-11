import {
  CardProductResolverService,
  normalizeCardNumber,
} from '../src/modules/catalog/card-product-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinishReconciler } from '../src/modules/catalog/finish-reconciler.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { TcgcsvCatalogClient } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import { TcgcsvSingleProductRef, TcgcsvPriceRow } from '../src/modules/pricing/pricing.types';
// Namespace (no import nombrado) para poder ESPIAR la llamada: el candado de «una sola
// implementación» es que el resolver LLAME a esta escalera, no que la copie.
import * as groupMatch from '../src/modules/pricing/providers/tcgcsv-group-match';

/**
 * v1.29 (ARCHITECTURE §4.27d) — CardProductResolverService: agrupa por `productId` EXACTO (no por
 * número), persiste UN `CardProduct` por productId con su `kind`/`finishes`, escribe `PriceReference`
 * POR VARIANTE (source=tcgcsv_singles) SOLO con marketPrice>0, y recomputa `availableFinishes` desde
 * `CardProduct`. Sin red (los fetch se mockean). Cubre el caso Pitch Black: la energía especial NO
 * gana un `normal` fantasma (el Deck Exclusive vive como su propio producto).
 */

// Voltaic Lightning Energy 084/084: producto de set (holofoil+reverse) + Deck Exclusive (normal).
const PRODUCTS: TcgcsvSingleProductRef[] = [
  { productId: 704841, name: 'Voltaic Lightning Energy - 084/084', number: '084/084' },
  { productId: 707029, name: 'Voltaic Lightning Energy - Deck Exclusives', number: '084/084' },
];
const PRICES: TcgcsvPriceRow[] = [
  { productId: 704841, subTypeName: 'Holofoil', marketPrice: 0.5 },
  { productId: 704841, subTypeName: 'Reverse Holofoil', marketPrice: null }, // sin precio ⇒ «—»
  { productId: 707029, subTypeName: 'Normal', marketPrice: 1.25 },
];

function clientMock(
  over: Partial<{ products: TcgcsvSingleProductRef[]; prices: TcgcsvPriceRow[]; groups: any[] }> = {},
): TcgcsvCatalogClient {
  return {
    getProducts: jest.fn(async () => over.products ?? PRODUCTS),
    getPrices: jest.fn(async () => over.prices ?? PRICES),
    listGroups: jest.fn(async () => over.groups ?? []),
  } as unknown as TcgcsvCatalogClient;
}

function prismaMock(
  set: { id: string; name: string; pptSetId: string | null },
  localCards: { id: string; number: string; tcgplayerId: string | null }[],
) {
  const cardProductUpserts: any[] = [];
  const priceUpserts: any[] = [];
  let seq = 0;
  const prisma = {
    cardSet: { findUnique: jest.fn(async () => set) },
    card: { findMany: jest.fn(async () => localCards) },
    cardProduct: {
      upsert: jest.fn(async (args: any) => {
        cardProductUpserts.push(args);
        return { id: `cp-${args.where.tcgplayerProductId}` };
      }),
    },
    priceReference: {
      findUnique: jest.fn(async () => null), // sin fila previa
      upsert: jest.fn(async (args: any) => {
        priceUpserts.push(args);
        return { id: `pr-${seq++}` };
      }),
    },
  } as unknown as PrismaService;
  return { prisma, cardProductUpserts, priceUpserts };
}

const fxMock = () =>
  ({ getCurrent: jest.fn(async () => ({ rate: 18, bufferPct: 3, source: 'banxico', effectiveDate: '2026-08-22' })) } as unknown as FxService);

describe('CardProductResolverService.resolveCardProductsForSet (§4.27d)', () => {
  it('MATA EL FANTASMA: set_base (704841)=[holofoil,reverse_holo]; Deck Exclusive (707029)=deck_exclusive con SU normal', async () => {
    const { prisma, cardProductUpserts } = prismaMock(
      { id: 'local-me05', name: 'Pitch Black', pptSetId: '24688' },
      [{ id: 'c-energy', number: '084', tcgplayerId: '704841' }], // ancla del set_base por tcgplayerId
    );
    const reconcile = jest.fn(async () => 0);
    const svc = new CardProductResolverService(prisma, clientMock(), { reconcile } as unknown as FinishReconciler, fxMock());

    const res = await svc.resolveCardProductsForSet('local-me05');

    expect((prisma as any).cardProduct.upsert).toHaveBeenCalledTimes(2);
    const byPid = new Map(cardProductUpserts.map((u) => [u.where.tcgplayerProductId, u.create]));
    // El producto de SET: EXACTAMENTE 2 acabados, sin normal fantasma.
    expect(byPid.get(704841).kind).toBe('set_base');
    expect(byPid.get(704841).finishes).toEqual(['reverse_holo', 'holofoil']);
    // El Deck Exclusive: producto APARTE (kind deck_exclusive) con su normal, colgado por número.
    expect(byPid.get(707029).kind).toBe('deck_exclusive');
    expect(byPid.get(707029).finishes).toEqual(['normal']);
    // Ambos cuelgan de la misma carta (el número enruta, no funde).
    expect(byPid.get(704841).cardId).toBe('c-energy');
    expect(byPid.get(707029).cardId).toBe('c-energy');
    // Reconcile de la carta tocada (recompone availableFinishes SOLO de set_base ⇒ 2 casillas).
    expect(reconcile).toHaveBeenCalledWith(['c-energy']);
    expect(res).toMatchObject({ groupId: 24688, joined: 2, products: 2 });
  });

  it('PRECIO POR VARIANTE money-safe: escribe tcgcsv_singles con marketPrice>0; OMITE marketPrice null («—»)', async () => {
    const { prisma, priceUpserts } = prismaMock(
      { id: 'local-me05', name: 'Pitch Black', pptSetId: '24688' },
      [{ id: 'c-energy', number: '084', tcgplayerId: '704841' }],
    );
    const svc = new CardProductResolverService(prisma, clientMock(), { reconcile: jest.fn(async () => 0) } as unknown as FinishReconciler, fxMock());

    const res = await svc.resolveCardProductsForSet('local-me05');

    // holofoil (0.5) y el normal del deck (1.25) SÍ; el reverse_holo (marketPrice null) NO.
    expect(priceUpserts).toHaveLength(2);
    const finishes = priceUpserts.map((u) => u.create.finish).sort();
    expect(finishes).toEqual(['holofoil', 'normal']);
    for (const u of priceUpserts) {
      expect(u.create.source).toBe('tcgcsv_singles');
      expect(u.create.cardProductId).toBeDefined();
      // USD→MXN Banxico: 0.5 USD → 50 usdCents → 50*18*1.03 = 927 MXN cents.
      expect(u.create.priceMxnCents).toBeGreaterThan(0);
      expect(u.create.priceUsdCents).toBeGreaterThan(0);
    }
    expect(res?.pricesWritten).toBe(2);
  });

  it('energía especial: 2 acabados (holofoil, reverse_holo), NO 3 — el set_base nunca trajo Normal', async () => {
    const { prisma, cardProductUpserts } = prismaMock(
      { id: 'local-me05', name: 'Pitch Black', pptSetId: '24688' },
      [{ id: 'c-energy', number: '084', tcgplayerId: '704841' }],
    );
    const svc = new CardProductResolverService(prisma, clientMock(), { reconcile: jest.fn(async () => 0) } as unknown as FinishReconciler, fxMock());
    await svc.resolveCardProductsForSet('local-me05');
    const setBase = cardProductUpserts.find((u) => u.where.tcgplayerProductId === 704841)!.create;
    expect(setBase.finishes).toHaveLength(2);
    expect(setBase.finishes).not.toContain('normal');
  });

  it('REGRESIÓN M-33: dos productos de la MISMA carta con el MISMO finish ⇒ 2 upserts con la CLAVE de 6 campos (distinto cardProductId), sin colisión lógica', async () => {
    // Reproduce exactamente el caso que estallaba en prod (log Railway me5): dos CardProduct de la
    // misma carta exponiendo el MISMO Finish (holofoil). Con la clave VIEJA de 5 campos (cardId,
    // productType, gradeKey, finish, capturedDate) ambos upserts apuntarían al MISMO renglón y el
    // segundo CREATE chocaría contra el índice único viejo. Con la clave de 6 campos (incluye
    // cardProductId) son renglones DISTINTOS. Este test fija que el código usa la clave de 6 campos.
    const products: TcgcsvSingleProductRef[] = [
      { productId: 704841, name: 'Voltaic Lightning Energy - 084/084', number: '084/084' },
      { productId: 707029, name: 'Voltaic Lightning Energy - Deck Exclusives', number: '084/084' },
    ];
    const prices: TcgcsvPriceRow[] = [
      { productId: 704841, subTypeName: 'Holofoil', marketPrice: 0.5 },
      { productId: 707029, subTypeName: 'Holofoil', marketPrice: 1.25 }, // MISMO finish, otro producto
    ];
    const { prisma, priceUpserts } = prismaMock(
      { id: 'local-me05', name: 'Pitch Black', pptSetId: '24688' },
      [{ id: 'c-energy', number: '084', tcgplayerId: '704841' }],
    );
    const svc = new CardProductResolverService(
      prisma,
      clientMock({ products, prices }),
      { reconcile: jest.fn(async () => 0) } as unknown as FinishReconciler,
      fxMock(),
    );

    await svc.resolveCardProductsForSet('local-me05');

    // Dos upserts, ambos holofoil, misma carta — pero DISTINTO cardProductId en la clave de 6 campos.
    expect(priceUpserts).toHaveLength(2);
    for (const u of priceUpserts) {
      const key = u.where.cardId_productType_gradeKey_finish_capturedDate_cardProductId;
      // La CLAVE es la de 6 campos (no la vieja de 5): la propiedad existe y trae cardProductId.
      expect(key).toBeDefined();
      expect(key.finish).toBe('holofoil');
      expect(key.cardId).toBe('c-energy');
      expect(key.cardProductId).toBeDefined();
      // Blindaje anti-regresión: NUNCA debe usarse la clave vieja de 5 campos.
      expect(u.where).not.toHaveProperty('cardId_productType_gradeKey_finish_capturedDate');
    }
    const cardProductIds = priceUpserts.map(
      (u) => u.where.cardId_productType_gradeKey_finish_capturedDate_cardProductId.cardProductId,
    );
    // Los dos productos generan claves DISTINTAS (difieren SOLO por cardProductId) ⇒ sin colisión.
    expect(new Set(cardProductIds).size).toBe(2);
  });

  it('sin groupId ÚNICO ⇒ null, NO toca CardProduct ni reconcilia (money-safe)', async () => {
    const { prisma } = prismaMock({ id: 'local-x', name: 'Ambiguous', pptSetId: null }, [{ id: 'c1', number: '1', tcgplayerId: null }]);
    const reconcile = jest.fn(async () => 0);
    const client = clientMock({ groups: [{ groupId: 1, name: 'Ambiguous A' }, { groupId: 2, name: 'Ambiguous B' }] });
    const svc = new CardProductResolverService(prisma, client, { reconcile } as unknown as FinishReconciler, fxMock());

    const res = await svc.resolveCardProductsForSet('local-x');

    expect(res).toBeNull();
    expect((prisma as any).cardProduct.upsert).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
});

/**
 * ⭐⭐ **La ruta de ESTRUCTURA adopta la escalera compartida** (`matchTcgcsvGroupByName`) — cierre del
 * follow-up declarado en `tcgcsv-group-match.ts` y en `docs/BACKEND_NOTES.md` (QA IMPORTANTE-3 / P-47).
 *
 * Hasta este pase, `CardProductResolverService.resolveGroupId` conservaba una **copia literal** de la
 * escalera vieja: la ruta de PRECIO ya tenía el arreglo del prefijo de colección (P-46) y ésta no. Lo
 * que estos tests vigilan, en orden de importancia:
 *
 *  1. **Que no haya una segunda implementación**: el resolver *llama* a la escalera, no la copia.
 *     Un `git revert` mental («me traigo el bloque de vuelta») tiene que morir en rojo aquí.
 *  2. **Monotonía en ESTA ruta** (la propiedad que exigió el encargo): `legacy ≠ null ⇒ nuevo ===
 *     legacy`. Sólo se permite `null → groupId`; ⛔ jamás `groupId → OTRO groupId`, que aquí
 *     significaría colgarle a un set la ESTRUCTURA (y los precios por variante) de otra colección.
 *  3. **La única desviación**, medida y acotada: un nombre que normaliza a VACÍO deja de empatar con
 *     «lo que sea». Se prueba explícitamente en vez de esconderse en el universo de la propiedad.
 */
describe('resolveGroupId — FUENTE ÚNICA del match set↔grupo (P-47 en la ruta de ESTRUCTURA)', () => {
  /** Normalización del algoritmo VIEJO (copiada tal cual: es el oráculo, no producción). */
  function legacyNormalize(raw: string): string {
    return (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * ⚠️ **Reimplementación LITERAL del `resolveGroupId` que vivía en este servicio** (rama de match por
   * NOMBRE). No es código muerto: es el ORÁCULO contra el que se mide que la adopción no pierde ni
   * desvía ningún set. Si alguien la borra, la garantía se va con ella.
   */
  function legacyResolveGroupId(setName: string, groups: { groupId: number; name: string }[]): number | null {
    const target = legacyNormalize(setName);
    const exact = groups.filter((g) => legacyNormalize(g.name) === target);
    if (exact.length === 1) return exact[0].groupId;
    const matches =
      exact.length === 0
        ? groups.filter((g) => {
            const gn = legacyNormalize(g.name);
            return gn.includes(target) || target.includes(gn);
          })
        : exact;
    return matches.length === 1 ? matches[0].groupId : null;
  }

  /** Servicio con las dependencias mínimas: aquí sólo se ejercita el paso 1 (resolver el groupId). */
  function svcWithGroups(groups: { groupId: number; name: string }[]): CardProductResolverService {
    const client = clientMock({ groups });
    return new CardProductResolverService(
      { cardSet: { findUnique: jest.fn() } } as unknown as PrismaService,
      client,
      { reconcile: jest.fn() } as unknown as FinishReconciler,
      fxMock(),
    );
  }

  /** Llama al paso 1 con un `set.id` distinto por invocación (el `groupIdCache` es por set). */
  let seq = 0;
  async function resolve(name: string, groups: { groupId: number; name: string }[]): Promise<number | null> {
    const svc = svcWithGroups(groups);
    return (svc as unknown as {
      resolveGroupId(s: { id: string; name: string; pptSetId: string | null }): Promise<number | null>;
    }).resolveGroupId({ id: `set-${seq++}`, name, pptSetId: null });
  }

  it('NO hay una segunda implementación: el resolver DELEGA en `matchTcgcsvGroupByName`', async () => {
    const spy = jest.spyOn(groupMatch, 'matchTcgcsvGroupByName');
    const groups = [{ groupId: 24688, name: 'SV08: Pitch Black' }, { groupId: 999, name: 'Pitch Black Promos' }];
    try {
      expect(await resolve('Pitch Black', groups)).toBe(24688);
      expect(spy).toHaveBeenCalledWith('Pitch Black', groups);
    } finally {
      spy.mockRestore();
    }
  });

  /** ⭐ EL HALLAZGO (P-46), ahora en la ruta que corre bajo import/`--force`. */
  it('PREFIJO de TCGCSV + un segundo candidato por contención ⇒ resuelve (antes: null y NO se escribía nada)', async () => {
    const groups = [{ groupId: 24688, name: 'SV08: Pitch Black' }, { groupId: 999, name: 'Pitch Black Promos' }];
    expect(legacyResolveGroupId('Pitch Black', groups)).toBeNull(); // lo que ESTA ruta hacía ayer
    expect(await resolve('Pitch Black', groups)).toBe(24688);
  });

  it('de punta a punta: ese mismo set ya SÍ persiste CardProduct + precios y reconcilia acabados', async () => {
    const { prisma, cardProductUpserts } = prismaMock(
      { id: 'local-me05', name: 'Pitch Black', pptSetId: null }, // sin pptSetId ⇒ match por NOMBRE
      [{ id: 'c-energy', number: '084', tcgplayerId: '704841' }],
    );
    const reconcile = jest.fn(async () => 1);
    const client = clientMock({
      groups: [{ groupId: 24688, name: 'SV08: Pitch Black' }, { groupId: 999, name: 'Pitch Black Promos' }],
    });
    const svc = new CardProductResolverService(prisma, client, { reconcile } as unknown as FinishReconciler, fxMock());

    const res = await svc.resolveCardProductsForSet('local-me05');

    // 2 productos (el del set + el Deck Exclusive) cuelgan de la MISMA carta: 2 CardProduct, 1 carta.
    expect(res).toMatchObject({ groupId: 24688, joined: 2, cardsTouched: 1 });
    expect(cardProductUpserts).toHaveLength(2);
    expect(reconcile).toHaveBeenCalledWith(['c-energy']);
  });

  it('MONEY-SAFE (sin cambios): ambigüedad real ⇒ null; el peldaño ambiguo no cae al siguiente', async () => {
    // Dos grupos que sólo se distinguen por el prefijo son DOS colecciones: no se adivina.
    expect(await resolve('Pitch Black', [{ groupId: 1, name: 'SV08: Pitch Black' }, { groupId: 2, name: 'ME05: Pitch Black' }])).toBeNull();
  });

  /**
   * ⚠️ **La ÚNICA desviación de la adopción**, explícita a propósito: un nombre que normaliza a vacío
   * («---») empataba con CUALQUIER grupo por `includes('')`, así que con un solo grupo en la fuente el
   * algoritmo viejo le colgaba ESE grupo al set. Eso no era un match: era un accidente de `includes`.
   * Ahora es `empty_name ⇒ null` y no se escribe nada. Se documenta como cambio de comportamiento
   * DELIBERADO (`groupId → null`) porque la propiedad de monotonía, en su forma cruda, lo prohibiría.
   */
  it('DESVIACIÓN DECLARADA: nombre local que normaliza a VACÍO ya no empata con «lo que sea»', async () => {
    const groups = [{ groupId: 1, name: 'Pitch Black' }];
    expect(legacyResolveGroupId('   ---   ', groups)).toBe(1); // el viejo ataba el set a ESE grupo
    expect(await resolve('   ---   ', groups)).toBeNull(); // ahora: nada se escribe
  });

  it('DESVIACIÓN DECLARADA (simétrica): un GRUPO cuyo nombre normaliza a vacío deja de ser candidato', async () => {
    expect(legacyResolveGroupId('Pitch Black', [{ groupId: 8, name: '---' }])).toBe(8); // basura, no match
    expect(await resolve('Pitch Black', [{ groupId: 8, name: '---' }])).toBeNull();
  });

  /**
   * ⭐⭐ **PROPIEDAD (régimen LIMPIO: todo nombre con al menos un alfanumérico).**
   * Fuerza bruta sobre TODOS los subconjuntos de un universo realista × varios nombres locales:
   * `legacy ≠ null ⇒ nuevo === legacy`. Lo único que puede pasar es `null → groupId`.
   */
  it('PROPIEDAD: para TODO subconjunto, legacy≠null ⇒ nuevo === legacy (y hay mejoras reales)', async () => {
    const universe = CLEAN_UNIVERSE;
    const locals = CLEAN_LOCALS;
    let upgrades = 0;
    for (let mask = 0; mask < 1 << universe.length; mask += 1) {
      const subset = universe.filter((_, i) => (mask >> i) & 1);
      for (const local of locals) {
        const before = legacyResolveGroupId(local, subset);
        const after = await resolve(local, subset);
        if (before != null) {
          expect({ local, mask, after }).toEqual({ local, mask, after: before });
        } else if (after != null) {
          upgrades += 1;
        }
      }
    }
    // MEDIDO, no «>0 y ya»: 512 pares (128 subconjuntos × 4 nombres locales) y **24** que pasan de
    // «congelado, no se escribe nada» a resolverse. Si este número cambia, el universo cambió.
    expect(upgrades).toBe(24);
  });

  /**
   * ⭐⭐ **PROPIEDAD (régimen SUCIO: se añaden nombres que normalizan a VACÍO en los dos lados).**
   * Aquí sí hay `groupId → null` — y el test lo CUANTIFICA y lo confina: toda desviación tiene un
   * lado vacío. Lo que NO puede pasar en ningún régimen es `groupId → OTRO groupId`: sería colgarle
   * a un set la estructura y los precios de otra colección. **Medido: 0 casos de 1536.**
   */
  it('PROPIEDAD money-safe: JAMÁS `groupId → OTRO groupId`; las desviaciones son sólo nombres vacíos', async () => {
    const universe = [...CLEAN_UNIVERSE, { groupId: 8, name: '---' }]; // grupo basura de la fuente
    const locals = [...CLEAN_LOCALS, '   ---   ', ''];
    let pairs = 0;
    let upgrades = 0;
    const crossed: unknown[] = [];
    const deviations: { local: string; names: string[] }[] = [];
    for (let mask = 0; mask < 1 << universe.length; mask += 1) {
      const subset = universe.filter((_, i) => (mask >> i) & 1);
      for (const local of locals) {
        pairs += 1;
        const before = legacyResolveGroupId(local, subset);
        const after = await resolve(local, subset);
        if (before === after) continue;
        if (before == null) upgrades += 1;
        else if (after == null) deviations.push({ local, names: subset.map((g) => g.name) });
        else crossed.push({ local, before, after, names: subset.map((g) => g.name) });
      }
    }
    expect(crossed).toEqual([]); // ⛔ el fallo grave: 0 casos
    // Toda desviación `groupId → null` tiene un lado que normaliza a VACÍO (el `includes('')` viejo).
    for (const d of deviations) {
      const emptySide = legacyNormalize(d.local) === '' || d.names.some((n) => legacyNormalize(n) === '');
      expect({ ...d, emptySide }).toMatchObject({ emptySide: true });
    }
    // Cifras MEDIDAS del régimen sucio (256 subconjuntos × 6 nombres).
    expect({ pairs, upgrades, deviations: deviations.length }).toEqual({
      pairs: 1536,
      upgrades: 148,
      deviations: 342,
    });
  });
});

/** Universo de nombres realistas: TCGCSV prefija (`"SV08: …"`), pokemontcg.io no. */
const CLEAN_UNIVERSE = [
  { groupId: 1, name: 'Pitch Black' },
  { groupId: 2, name: 'SV08: Pitch Black' },
  { groupId: 3, name: 'ME05: Pitch Black' },
  { groupId: 4, name: 'Pitch Black Promos' },
  { groupId: 5, name: 'Pitch Black Elite Trainer Box' },
  { groupId: 6, name: 'Surging Sparks' },
  { groupId: 7, name: 'SV08: Surging Sparks' },
];
const CLEAN_LOCALS = ['Pitch Black', 'SV08: Pitch Black', 'Surging Sparks', 'Black'];

describe('normalizeCardNumber (helper del join por NÚMERO)', () => {
  it('normalizeCardNumber colapsa "084/084"→"84" y conserva prefijos ("TG12")', () => {
    expect(normalizeCardNumber('084/084')).toBe('84');
    expect(normalizeCardNumber('84')).toBe('84');
    expect(normalizeCardNumber('TG12')).toBe('TG12');
  });
});

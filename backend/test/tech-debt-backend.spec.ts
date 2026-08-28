import { isPremiumCanonicalRarity } from '../src/common/rarity-catalog';
import { variantKey } from '../src/common/variant-key';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';

/**
 * Deuda técnica backend (TECH_DEBT) — guards unitarios:
 *  - P-34 H5: `premiumByPattern` (vía `isPremiumCanonicalRarity`) reconoce `mega`/`blackwhite`, cerrando
 *    la clase R-5 money-losing (una variante string premium NUEVA no-alias caería a bin holo barato).
 *  - P-30 H2: el helper único `variantKey` produce la clave K exacta (sin drift entre call-sites) Y
 *    productor↔consumidor comparten esa MISMA fuente (round-trip: la clave con que el batch INDEXA el
 *    Map y la clave con que el consumidor hace `.get()` provienen del mismo `variantKey`).
 */

// ===========================================================================
// ===========================================================================
// v2.0 (P-48, §4.36.4): el bloque «P-34 H4 · el seed cumple premium→pct» se RETIRA con los tiers.
// El invariante `premium ⇒ pct` quedó SIN SENTIDO (ya no hay modos que refinar) y lo SUSTITUYE el
// GUARDARRAÍL de §4.36.5 — mismo objetivo money-safe, otro mecanismo: la rareza deja de FIJAR precio
// y pasa a BLOQUEAR publicación/cotización. Su guard vive en `test/pricing.premium-floor-guard.spec.ts`.

describe('P-34 H5 · premiumByPattern reconoce mega/blackwhite (clase R-5 money-losing cerrada)', () => {
  it('una variante string «Mega …» NO-alias cae a premium por PATRÓN (no al bin holo barato)', () => {
    // 'Mega Brilliant Rare' no es un alias del catálogo → resuelve por patrón → premium.
    expect(isPremiumCanonicalRarity('Mega Brilliant Rare')).toBe(true);
  });

  it('una variante string «Black White …» NO-alias cae a premium por PATRÓN', () => {
    expect(isPremiumCanonicalRarity('Black White Star Rare')).toBe(true);
  });

  it('las canónicas ya mapeadas siguen premium (consistencia): Mega Rare, Black White Rare, Mega Hyper Rare', () => {
    expect(isPremiumCanonicalRarity('Mega Rare')).toBe(true);
    expect(isPremiumCanonicalRarity('Black White Rare')).toBe(true);
    expect(isPremiumCanonicalRarity('Mega Hyper Rare')).toBe(true);
    // MEGA_ATTACK_RARE cruda (snake_case) también premium.
    expect(isPremiumCanonicalRarity('MEGA_ATTACK_RARE')).toBe(true);
  });

  it('las no-premium NO se ven afectadas por los patrones nuevos', () => {
    expect(isPremiumCanonicalRarity('Common')).toBe(false);
    expect(isPremiumCanonicalRarity('Uncommon')).toBe(false);
    expect(isPremiumCanonicalRarity('Rare')).toBe(false);
    expect(isPremiumCanonicalRarity('Rare Holo')).toBe(false);
  });
});

// ===========================================================================
describe('P-30 H2 · variantKey produce la clave K exacta (mismo string que las 3 copias previas)', () => {
  it('cardId|productType|gradeKey|finish, en ese orden y con separador «|»', () => {
    expect(
      variantKey({ cardId: 'card-1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }),
    ).toBe('card-1|raw|raw:NM|normal');
    expect(
      variantKey({ cardId: 'c2', productType: 'graded', gradeKey: 'graded:PSA:10', finish: 'holofoil' }),
    ).toBe('c2|graded|graded:PSA:10|holofoil');
  });

  // Byte-identidad con las interpolaciones PREVIAS de los productores (pricing.service) y del eje sellado
  // (catalog.service). Si alguien cambia orden/separador/componentes en `variantKey`, ESTO se rompe y
  // avisa que se corrompió la clave de map (se perderían overrides/referencias → precio corrupto).
  it('byte-idéntico a la interpolación literal previa `${cardId}|${productType}|${gradeKey}|${finish}`', () => {
    const parts = { cardId: 'c9', productType: 'raw', gradeKey: 'raw:NM', finish: 'reverse_holo' } as const;
    expect(variantKey(parts)).toBe(
      `${parts.cardId}|${parts.productType}|${parts.gradeKey}|${parts.finish}`,
    );
    // Eje sellado (catalog.service :148/:197): `${cardId}|sealed|${gk}|normal`.
    const gk = 'sealed:tcg:12345';
    expect(variantKey({ cardId: 'c9', productType: 'sealed', gradeKey: gk, finish: 'normal' })).toBe(
      `c9|sealed|${gk}|normal`,
    );
  });
});

// ===========================================================================
// P-30 H2 · GUARD DE ROUND-TRIP productor↔consumidor. El invariante que de verdad protege contra el
// drift NO es «el helper produce X» (eso lo cubre el bloque de arriba), sino que el PRODUCTOR del Map
// (`getReferencesBatch`/`getVariantOverridesBatch` en pricing.service) INDEXA con la MISMA fuente
// (`variantKey`) con la que el CONSUMIDOR (catalog.service, etc.) hace `.get()`. Se ejercita el servicio
// REAL con un prisma mockeado: la fila que devuelve la BD la llavea el productor, y la recuperamos con
// `variantKey(mismas partes)` — si productor y consumidor no compartieran fuente, este `.get()` fallaría.
function buildPricing(refRows: any[], overrideRows: any[]) {
  const prisma = {
    priceReference: { findMany: jest.fn(async () => refRows) },
    variantPriceOverride: { findMany: jest.fn(async () => overrideRows) },
  } as unknown as PrismaService;
  const svc = new PricingService(
    prisma,
    {} as SettingsService,
    {} as FxService,
    {} as any,
    {} as any,
    {} as any,
  );
  return svc;
}

describe('P-30 H2 · round-trip productor↔consumidor (misma fuente `variantKey`)', () => {
  const parts = { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' } as const;

  it('getReferencesBatch INDEXA con la clave que el consumidor recupera vía variantKey(mismas partes)', async () => {
    const svc = buildPricing(
      [{ ...parts, priceMxnCents: 4200, source: 'manual', capturedDate: new Date('2026-08-20'), cardProductId: null, isManualOverride: true }],
      [],
    );
    const map = await svc.getReferencesBatch([{ ...parts }]);
    // El consumidor (p. ej. catalog.refFromBatch) hace exactamente esto:
    const hit = map.get(variantKey({ ...parts }));
    expect(hit).toBeDefined();
    expect(hit).toMatchObject({ status: 'priced', referenceMxnCents: 4200 });
  });

  it('getVariantOverridesBatch INDEXA con la clave que el consumidor recupera vía variantKey(mismas partes)', async () => {
    const overrideRow = { ...parts, id: 'ov1', sellOverrideCents: 999 };
    const svc = buildPricing([], [overrideRow]);
    const map = await svc.getVariantOverridesBatch([{ ...parts }]);
    // El consumidor (catalog.fetchSellable :180, buylist, etc.) hace exactamente esto:
    const hit = map.get(variantKey({ ...parts }));
    expect(hit).toBe(overrideRow);
  });

  it('eje SELLADO: getReferencesBatch INDEXA la clave que el consumidor sellado recupera vía variantKey', async () => {
    const sealed = { cardId: 'c2', productType: 'sealed', gradeKey: 'sealed:tcg:777', finish: 'normal' } as const;
    const svc = buildPricing(
      [{ ...sealed, priceMxnCents: 7700, source: 'tcgcsv', capturedDate: new Date('2026-08-21'), cardProductId: null, isManualOverride: false }],
      [],
    );
    const map = await svc.getReferencesBatch([{ ...sealed }]);
    // catalog.refFromBatch (:197) recupera el eje sellado con variantKey(productType:'sealed', ...):
    const hit = map.get(variantKey({ ...sealed }));
    expect(hit).toMatchObject({ status: 'priced', referenceMxnCents: 7700 });
  });
});

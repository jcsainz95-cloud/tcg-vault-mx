import { describe, it, expect } from 'vitest';
import {
  mockMarketReferenceForVariant,
  mockVariantControlsStore,
  mockVariantPricing,
  variantControlsKey,
} from './fixtures';

/**
 * # bounty-payout-mock.test.ts — el composer del servidor falso TOPA el bounty por el mercado (§M2-B.11)
 *
 * Canario del mock, no del servidor: `payoutCents = min(bounty, mercado)` cuando hay mercado presente,
 * `cappedByMarket = payout < bounty`, y `buy.effectiveCents === payoutCents` cuando `buy.source==='bounty'`
 * (invariante del contrato, `API_CONTRACT.md:6929`). Existe porque una mutación que dejara de topar
 * (`payout = bounty`) pasaba 15/15 en `admin-bounties-mock.test.ts`: la semilla no tiene ningún bounty
 * por encima del mercado, así que aquí se fabrica uno y se retira al final.
 */

const CARD = 'c-blastoise';
const FINISH = 'normal' as const;
const KEY = variantControlsKey(CARD, 'raw', 'raw:NM', FINISH);

function withBounty<T>(priceCents: number, fn: () => T): T {
  const before = mockVariantControlsStore.get(KEY);
  mockVariantControlsStore.set(KEY, {
    sellOverrideCents: null,
    buyOverrideCents: null,
    bountyEnabled: true,
    bountyPriceCents: priceCents,
    bountyTargetQty: null,
    bountyAcquiredQty: 0,
    bountyCompletedAt: null,
    bountyUnpublishedAt: null,
    updatedAt: '2026-09-29T00:00:00.000Z',
  });
  try {
    return fn();
  } finally {
    if (before) mockVariantControlsStore.set(KEY, before);
    else mockVariantControlsStore.delete(KEY);
  }
}

describe('mockVariantPricing · payoutCents / cappedByMarket (§M2-B.11)', () => {
  const market = mockMarketReferenceForVariant(CARD, FINISH)!;
  const curve = mockVariantPricing(CARD, FINISH).buy.suggestedCents!;

  it('la variante de prueba tiene mercado y una tarifa de curva por debajo de él', () => {
    expect(market).toBeGreaterThan(0);
    expect(curve).toBeGreaterThan(0);
    expect(curve).toBeLessThan(market);
  });

  it('bounty POR ENCIMA del mercado ⇒ se paga el mercado, cappedByMarket:true, y buy.effectiveCents lo iguala', () => {
    withBounty(market + 22_000, () => {
      const p = mockVariantPricing(CARD, FINISH);
      expect(p.bounty?.effective).toBe(true);
      expect(p.bounty?.priceCents).toBe(market + 22_000); // lo configurado no cambia
      expect(p.bounty?.payoutCents).toBe(market);
      expect(p.bounty?.cappedByMarket).toBe(true);
      expect(p.buy.source).toBe('bounty');
      expect(p.buy.effectiveCents).toBe(market);
    });
  });

  it('bounty entre la tarifa y el mercado ⇒ se paga el bounty, sin tope', () => {
    const bounty = curve + Math.floor((market - curve) / 2);
    withBounty(bounty, () => {
      const p = mockVariantPricing(CARD, FINISH);
      expect(p.bounty?.effective).toBe(true);
      expect(p.bounty?.payoutCents).toBe(bounty);
      expect(p.bounty?.cappedByMarket).toBe(false);
      expect(p.buy.effectiveCents).toBe(bounty);
    });
  });

  it('bounty POR DEBAJO de la tarifa (rebasado) ⇒ no efectivo: payoutCents null, cappedByMarket false', () => {
    withBounty(Math.max(1, curve - 1), () => {
      const p = mockVariantPricing(CARD, FINISH);
      expect(p.bounty?.effective).toBe(false);
      expect(p.bounty?.payoutCents).toBeNull();
      expect(p.bounty?.cappedByMarket).toBe(false);
      expect(p.buy.source).not.toBe('bounty');
    });
  });
});

/**
 * TL-MKT2b-a (2026-10-19) — `trackPurchase`/`trackBeginCheckout` se llaman en el camino del dinero.
 * Con `off` salen ANTES de leer nada; con `on`, un dato roto (línea con `card: null`) no lanza.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownDTO, OrderItemPreview } from '@/types/contract';
import { trackBeginCheckout, trackPurchase } from './ecommerce';
import { setRuntimeConsent } from './track';

const BREAKDOWN = {
  subtotalCents: 1000,
  ivaCents: 160,
  ivaRatePct: 16,
  processingFeeCents: 0,
  totalCents: 1160,
  currency: 'MXN',
  priceConvention: 'IVA_EXCLUSIVE',
  ivaIncluded: false,
} as BreakdownDTO;
const NULL_CARD = [{ inventoryItemId: 'inv-null', card: null, unitPriceCents: 500 }] as unknown as OrderItemPreview[];

/** Una lista que cuenta cuántas veces se la recorre. */
function spiedItems(): { items: OrderItemPreview[]; reads: () => number } {
  let reads = 0;
  const items = new Proxy(NULL_CARD, {
    get(target, key, recv) {
      if (key === Symbol.iterator || key === 'length') reads += 1;
      return Reflect.get(target, key, recv);
    },
  });
  return { items, reads: () => reads };
}

afterEach(() => {
  vi.unstubAllEnvs();
  setRuntimeConsent(null);
  window.history.replaceState(null, '', '/');
});

describe('TL-MKT2b-a · ecommerce.ts', () => {
  it('modo off: no lee la cotización (sale antes de `itemsFromQuote`)', () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'off');
    const p = spiedItems();
    trackPurchase('ord-1', BREAKDOWN, p.items);
    trackBeginCheckout(BREAKDOWN, p.items);
    expect(p.reads()).toBe(0);
  });

  it('modo on: una línea con `card: null` no lanza (ni `purchase` ni `begin_checkout`)', () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
    setRuntimeConsent({ analytics: true, ads: true });
    window.history.replaceState(null, '', '/es/checkout');
    const p = spiedItems();
    expect(() => trackPurchase('ord-1', BREAKDOWN, p.items)).not.toThrow();
    expect(() => trackBeginCheckout(BREAKDOWN, p.items)).not.toThrow();
    // Con `on` sí se leyó: la prueba ejercita el camino que lanza, no un atajo.
    expect(p.reads()).toBeGreaterThan(0);
  });
});

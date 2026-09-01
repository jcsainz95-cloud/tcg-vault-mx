import { describe, it, expect } from 'vitest';
import { readOffer } from './offer-readiness';
import type { SellItemDTO, SellOfferPublicDTO } from '@/types/contract';

const CARD = {
  id: 'c-1',
  externalId: 'x-1',
  name: 'Charizard VMAX',
  number: '020/189',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's-1',
  setName: 'Darkness Ablaze',
  imageSmallUrl: '',
  imageLargeUrl: '',
  availableFinishes: ['holofoil' as const],
};

function line(over: Partial<SellItemDTO> = {}): SellItemDTO {
  return {
    id: over.id ?? 'sri-1',
    card: CARD,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'holofoil',
    itemStatus: 'cotizada',
    ...over,
  };
}

function offer(over: Partial<SellOfferPublicDTO> = {}): SellOfferPublicDTO {
  return {
    sentAt: '2026-08-30T18:00:00Z',
    grossCents: 102000,
    shippingFeeCents: 18000,
    netCents: 84000,
    acceptDeadlineAt: '2026-09-03T18:00:00Z',
    acceptedAt: null,
    shipDeadlineAt: null,
    sellerShippedDeclaredAt: null,
    carrier: null,
    trackingNumber: null,
    terms: {
      perLineConditionLabel: 'siempre que llegue en Near Mint',
      consequence: 'Si una carta no llega en Near Mint no se compra…',
    },
    lines: [
      line({ id: 'a', offerDecision: 'buy', offeredPriceCents: 84000 }),
      line({ id: 'b', offerDecision: 'skip', offeredPriceCents: null }),
    ],
    ...over,
  };
}

describe('readOffer — la puerta que decide si se puede ofrecer ACEPTAR', () => {
  it('clasifica las líneas en compradas y no compradas, con la condición del servidor', () => {
    const r = readOffer(offer());
    expect(r.renderable).toBe(true);
    if (!r.renderable) return;
    expect(r.buy.map((b) => b.line.id)).toEqual(['a']);
    expect(r.skip.map((s) => s.line.id)).toEqual(['b']);
    expect(r.buy[0].offeredPriceCents).toBe(84000);
    expect(r.condition).toBe('siempre que llegue en Near Mint');
  });

  it('la condición POR LÍNEA manda sobre la de `terms` (el contrato la manda ya renderizada)', () => {
    const r = readOffer(
      offer({
        lines: [
          line({
            id: 'a',
            offerDecision: 'buy',
            offeredPriceCents: 1000,
            condition: 'solo si llega en Near Mint',
          }),
        ],
      }),
    );
    expect(r.renderable).toBe(true);
    if (!r.renderable) return;
    expect(r.buy[0].condition).toBe('solo si llega en Near Mint');
  });

  // R2 (§23.0): un monto ofertado sin su condición al lado promete un trato MEJOR del que le
  // estamos haciendo. Sin condición no se ofrece aceptar: es la parte del trato, no letra chica.
  it('SIN condición NM no es renderizable, aunque los tres montos vengan perfectos', () => {
    const r = readOffer(
      offer({ terms: { perLineConditionLabel: '   ', consequence: 'algo' } }),
    );
    expect(r).toEqual({ renderable: false, reason: 'missing_terms' });
  });

  it('SIN el bloque de consecuencia tampoco: los términos incompletos no se firman', () => {
    const r = readOffer(
      offer({ terms: { perLineConditionLabel: 'siempre que llegue en NM', consequence: '' } }),
    );
    expect(r).toEqual({ renderable: false, reason: 'missing_terms' });
  });

  // Criterio 118: el desglose tiene que decir QUÉ NO COMPRAMOS. Sin `offerDecision` el paquete
  // que el vendedor aceptaría tiene contenido desconocido.
  it('una línea sin `offerDecision` bloquea la oferta entera', () => {
    const r = readOffer(offer({ lines: [line({ id: 'a', offeredPriceCents: 100 })] }));
    expect(r).toEqual({ renderable: false, reason: 'unclassified_lines' });
  });

  // ⚠️ Cero es un precio. Una línea `buy` sin precio NO se rescata pintando MX$ 0.00.
  it('una línea `buy` SIN precio bloquea, en vez de degradar a MX$ 0.00', () => {
    const r = readOffer(
      offer({ lines: [line({ id: 'a', offerDecision: 'buy', offeredPriceCents: null })] }),
    );
    expect(r).toEqual({ renderable: false, reason: 'unclassified_lines' });
  });

  it('una oferta sin líneas no es un desglose: es un total suelto', () => {
    expect(readOffer(offer({ lines: [] }))).toEqual({ renderable: false, reason: 'no_lines' });
  });

  // R4: la UI no calcula ninguna cifra. Que la suma de las líneas no cuadre con `grossCents` es
  // un problema del SERVIDOR y hay que poder verlo — no un motivo para bloquear una oferta real.
  it('NO valida la aritmética: gross que no cuadra con las líneas sigue siendo renderizable', () => {
    const r = readOffer(offer({ grossCents: 999999 }));
    expect(r.renderable).toBe(true);
  });
});

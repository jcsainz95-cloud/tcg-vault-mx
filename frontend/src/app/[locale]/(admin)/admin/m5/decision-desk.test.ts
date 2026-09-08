import { describe, it, expect } from 'vitest';
import {
  defaultSelection,
  emitBlocker,
  isOverride,
  isValidOverrideReason,
  lineAmountCents,
  selectionTotals,
} from './decision-desk';
import type { BuylistDecisionLineDTO, BuylistDecisionTotalsDTO } from '@/types/contract';

const CARD = {
  id: 'c-1',
  externalId: 'x',
  name: 'Charizard VMAX',
  number: '020/189',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's',
  setName: 'Darkness Ablaze',
  imageSmallUrl: '',
  imageLargeUrl: '',
  availableFinishes: ['holofoil' as const],
};

function line(over: Partial<BuylistDecisionLineDTO> = {}): BuylistDecisionLineDTO {
  return {
    itemId: 'i-1',
    card: CARD,
    productType: 'raw',
    finish: 'holofoil',
    cardProductId: null,
    quotedPriceCents: 90000,
    derivedPriceCents: 84000,
    priceBasis: 'market',
    pendingReason: null,
    position: { stock: 5, verifying: 1, inTransit: 1, committed: 2, total: 9 },
    suggestion: { verdict: 'buy', rule: 'variant_cap', thresholdQty: 10, bountyActive: false },
    ...over,
  };
}

/** Los diales del servidor. Nunca constantes del front. */
const TOTALS: BuylistDecisionTotalsDTO = {
  buyableGrossCents: 84000,
  shippingFeeCents: 18000,
  netCents: 66000,
  minimumOfferNetCents: 20000,
  requiredGrossCents: 38000,
  netBelowMinimum: false,
};

describe('defaultSelection — el punto de partida es la solicitud tal como llegó', () => {
  it('marca las líneas con precio y NO marca las que no lo tienen', () => {
    const lines = [line({ itemId: 'a' }), line({ itemId: 'b', derivedPriceCents: null })];
    expect([...defaultSelection(lines)]).toEqual(['a']);
  });

  /**
   * ⚠️ La prueba que protege D6. Si el default siguiera a la sugerencia, «no comprar» sería un
   * BLOQUEO BLANDO: la inercia haría el trabajo que el sistema tiene prohibido hacer.
   */
  it('IGNORA la sugerencia: una línea `do_not_buy` con precio nace MARCADA', () => {
    const lines = [
      line({
        itemId: 'a',
        suggestion: { verdict: 'do_not_buy', rule: 'variant_cap', thresholdQty: 10, bountyActive: false },
      }),
    ];
    expect(defaultSelection(lines).has('a')).toBe(true);
  });
});

describe('isOverride — el borde de la igualdad', () => {
  it('mandar EXACTAMENTE el derivado NO es override (no pide motivo)', () => {
    expect(isOverride(line(), { amountCents: 84000 })).toBe(false);
  });

  // ⚠️ No existe ni existirá banda de tolerancia: «casi igual» no es una categoría del contrato.
  it('UN CENTAVO de diferencia YA es override', () => {
    expect(isOverride(line(), { amountCents: 84001 })).toBe(true);
    expect(isOverride(line(), { amountCents: 83999 })).toBe(true);
  });

  it('sin monto tecleado no hay override', () => {
    expect(isOverride(line(), {})).toBe(false);
    expect(isOverride(line(), undefined)).toBe(false);
  });

  it('una línea SIN derivado: cualquier monto a mano es override (es el rescate)', () => {
    expect(isOverride(line({ derivedPriceCents: null }), { amountCents: 50000 })).toBe(true);
  });
});

describe('lineAmountCents', () => {
  it('el override manda sobre el derivado', () => {
    expect(lineAmountCents(line(), { amountCents: 50000 })).toBe(50000);
  });
  it('sin override vale el derivado; sin ninguno de los dos es null, jamás 0', () => {
    expect(lineAmountCents(line())).toBe(84000);
    expect(lineAmountCents(line({ derivedPriceCents: null }))).toBeNull();
  });
});

describe('isValidOverrideReason — 3 a 500 caracteres', () => {
  it('rechaza vacío, espacios y menos de 3; acepta 3 y 500', () => {
    expect(isValidOverrideReason('')).toBe(false);
    expect(isValidOverrideReason('   ')).toBe(false);
    expect(isValidOverrideReason('ab')).toBe(false);
    expect(isValidOverrideReason('abc')).toBe(true);
    expect(isValidOverrideReason('x'.repeat(500))).toBe(true);
    expect(isValidOverrideReason('x'.repeat(501))).toBe(false);
  });
});

describe('selectionTotals — la UI suma; el servidor pone el umbral', () => {
  it('suma solo lo marcado y resta la tarifa DEL SERVIDOR', () => {
    const lines = [line({ itemId: 'a' }), line({ itemId: 'b', derivedPriceCents: 30000 })];
    const r = selectionTotals(lines, new Set(['a', 'b']), {}, TOTALS);
    expect(r.grossCents).toBe(114000);
    expect(r.netCents).toBe(96000);
    expect(r.selectedCount).toBe(2);
    expect(r.belowMinimum).toBe(false);
  });

  it('al desmarcar, la suma baja y el aviso del piso se enciende con el umbral del servidor', () => {
    const lines = [line({ itemId: 'a', derivedPriceCents: 30000 })];
    const r = selectionTotals(lines, new Set(['a']), {}, TOTALS);
    // 30000 − 18000 = 12000 < 20000
    expect(r.netCents).toBe(12000);
    expect(r.belowMinimum).toBe(true);
    // El faltante se expresa en BRUTO: es la palanca que el operador puede mover.
    expect(r.grossShortfallCents).toBe(8000);
  });

  /**
   * El borde INCLUSIVO. Los tres bordes numéricos del ciclo significan lo mismo —*el número
   * exacto PASA*— y el error a evitar es idéntico en los tres: implementar uno estricto y
   * rechazar exactamente la cifra que prometimos.
   */
  it.each([
    [37999, true],
    [38000, false],
    [38001, false],
  ])('bruto %i ⇒ belowMinimum %s (el piso es INCLUSIVO)', (gross, expected) => {
    const lines = [line({ itemId: 'a', derivedPriceCents: gross })];
    expect(selectionTotals(lines, new Set(['a']), {}, TOTALS).belowMinimum).toBe(expected);
  });

  it('el neto nunca es negativo, y el max(0,…) NO enmascara el aviso', () => {
    const lines = [line({ itemId: 'a', derivedPriceCents: 5000 })];
    const r = selectionTotals(lines, new Set(['a']), {}, TOTALS);
    expect(r.netCents).toBe(0);
    expect(r.belowMinimum).toBe(true);
  });

  it('una línea marcada SIN monto se señala en vez de sumar 0', () => {
    const lines = [line({ itemId: 'a', derivedPriceCents: null })];
    const r = selectionTotals(lines, new Set(['a']), {}, TOTALS);
    expect(r.hasUnpriceableLine).toBe(true);
    expect(r.grossCents).toBe(0);
  });

  it('un override sin motivo válido se lista; con motivo, no', () => {
    const lines = [line({ itemId: 'a' })];
    const sinMotivo = selectionTotals(lines, new Set(['a']), { a: { amountCents: 90000 } }, TOTALS);
    expect(sinMotivo.itemIdsMissingReason).toEqual(['a']);
    const conMotivo = selectionTotals(
      lines,
      new Set(['a']),
      { a: { amountCents: 90000, reason: 'mercado a la alza' } },
      TOTALS,
    );
    expect(conMotivo.itemIdsMissingReason).toEqual([]);
    // …y el override entra en el bruto: el tope se juzga sobre el resultante.
    expect(conMotivo.grossCents).toBe(90000);
  });

  it('mandar el derivado exacto NO exige motivo', () => {
    const lines = [line({ itemId: 'a' })];
    const r = selectionTotals(lines, new Set(['a']), { a: { amountCents: 84000 } }, TOTALS);
    expect(r.itemIdsMissingReason).toEqual([]);
  });
});

describe('emitBlocker — qué apaga «Emitir» y, sobre todo, qué NO', () => {
  const lines = [line({ itemId: 'a' })];
  const ok = selectionTotals(lines, new Set(['a']), {}, TOTALS);

  it('nada bloquea una oferta sana', () => {
    expect(emitBlocker(ok, false)).toBeNull();
  });

  /**
   * ⚠️ **La prueba más importante del archivo.** El servidor no valida la oferta contra la
   * sugerencia (D6): el admin compra una línea desaconsejada sin fricción, sin permiso extra y
   * sin confirmación adicional. Endurecerlo «por prudencia» CONTRADICE PROJECT.md.
   */
  it('`do_not_buy` NO bloquea — ni con confirmación extra', () => {
    const desaconsejada = [
      line({
        itemId: 'a',
        suggestion: { verdict: 'do_not_buy', rule: 'variant_cap', thresholdQty: 10, bountyActive: false },
      }),
    ];
    const totals = selectionTotals(desaconsejada, new Set(['a']), {}, TOTALS);
    expect(emitBlocker(totals, false)).toBeNull();
  });

  it('el conteo caído TAMPOCO bloquea: falta el consejo, no el permiso', () => {
    const sinConteo = [line({ itemId: 'a', position: null, positionUnavailable: true })];
    const totals = selectionTotals(sinConteo, new Set(['a']), {}, TOTALS);
    expect(emitBlocker(totals, false)).toBeNull();
  });

  it('sí bloquean: dirección ausente, cero líneas, línea sin monto, motivo ausente y piso', () => {
    expect(emitBlocker(ok, true)).toBe('pickupAddressMissing');
    expect(emitBlocker(selectionTotals(lines, new Set(), {}, TOTALS), false)).toBe('noLines');
    const sinMonto = [line({ itemId: 'a', derivedPriceCents: null })];
    expect(emitBlocker(selectionTotals(sinMonto, new Set(['a']), {}, TOTALS), false)).toBe(
      'unpriceableLine',
    );
    expect(
      emitBlocker(selectionTotals(lines, new Set(['a']), { a: { amountCents: 99000 } }, TOTALS), false),
    ).toBe('missingReason');
    const bajo = [line({ itemId: 'a', derivedPriceCents: 20000 })];
    expect(emitBlocker(selectionTotals(bajo, new Set(['a']), {}, TOTALS), false)).toBe('belowMinimum');
  });

  it('la dirección ausente gana a todo: es lo más barato de comprobar y hace inútil lo demás', () => {
    const bajo = [line({ itemId: 'a', derivedPriceCents: 20000 })];
    expect(emitBlocker(selectionTotals(bajo, new Set(['a']), {}, TOTALS), true)).toBe(
      'pickupAddressMissing',
    );
  });
});

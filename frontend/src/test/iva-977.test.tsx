import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import type { BreakdownDTO } from '@/types/contract';

/**
 * ⭐ Criterio 977 (dueño 2026-11-03, `HECHOS.md` «Checkout y ficha: tres cambios aprobados…» (3)) — POR AUSENCIA:
 * en catálogo, ficha, sellado, accesorios, Meta Battle Decks y carrito, ES y EN, ningún precio lleva «IVA 16 %
 * incluido», «IVA incluido», «con IVA incluido» ni «VAT included». Se queda (P-CTA-5(a)) la línea «IVA 16 % incluido:
 * MX$…» del RESUMEN del checkout, y (P-CTA-5(b), sin responder) la nota «incluye IVA» del valor de MERCADO.
 *
 * Dos capas aquí: (1) el catálogo de textos de cliente (lo que no está en el catálogo no se puede pintar) y (2) el
 * resumen del checkout conserva su línea. Las superficies una a una (teja, ficha, barra fija, sellado, accesorio, lista
 * de deseos) tienen su caso en su propio test (`CatalogTile`, `CardDetailView`, `SealedDetailView`,
 * `AccessoryDetailView`, `WishlistBlock`, `WishlistView`); el punto único es `IvaLabel` (`IvaLabel.test.tsx`).
 */
const BANNED = /IVA \{rate\} % incluido|IVA \d+ ?% incluido|IVA incluido|con IVA incluido|VAT included|\{rate\} % VAT/i;

/** Claves de cliente que SÍ pueden decirlo, cada una con su porqué. Todo lo demás, por ausencia. */
const ALLOWED: Record<string, string> = {
  'common.ivaIncluded': 'clave de la etiqueta de precio que ya NINGÚN componente pinta (IvaLabel la dejó, 977); la leen las e2e para medir su ausencia',
  'common.ivaIncludedBare': 'nota «incluye IVA» del valor de MERCADO (P-CTA-5(b), §MIV.10)',
  'card.referenceExplainerWithMarket': 'explicador del valor de MERCADO (P-CTA-5(b), §MIV)',
  'checkout.ivaIncluded': 'línea de IVA del resumen del checkout (P-CTA-5(a), criterio 195)',
};

function customerStrings(messages: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  const walk = (o: unknown, path: string[]) => {
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, [...path, k]);
    else if (typeof o === 'string') out.push([path.join('.'), o]);
  };
  for (const [ns, v] of Object.entries(messages)) if (ns !== 'admin') walk(v, [ns]);
  return out;
}

describe('977 · sin «IVA 16 % incluido» junto a los precios', () => {
  it.each([
    ['es', es],
    ['en', en],
  ] as const)('(%s) ningún texto de cliente lo dice, salvo los permitidos', (_locale, messages) => {
    const offenders = customerStrings(messages as Record<string, unknown>)
      .filter(([key, value]) => BANNED.test(value) && !(key in ALLOWED))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it('las superficies con precio que nombra el criterio: accesorios, deck del meta y carrito, sin la frase', () => {
    for (const m of [es, en]) {
      expect(m.accessories).not.toHaveProperty('vatIncluded');
      expect(m.decksMeta.bundle.note).not.toMatch(BANNED);
      expect(m.checkout.subtotalHintIvaIncluded).not.toMatch(BANNED);
      expect(m.checkout.subtotalHintProducts).not.toMatch(BANNED);
    }
  });

  it('el resumen del checkout CONSERVA «IVA 16 % incluido» como desglose (P-CTA-5(a)) y el subtotal va sin rótulo', () => {
    const b: BreakdownDTO = {
      subtotalCents: 163328,
      ivaCents: 22528,
      ivaRatePct: 16,
      processingFeeCents: 7482,
      totalCents: 170810,
      currency: 'MXN',
      priceConvention: 'IVA_INCLUSIVE',
      ivaIncluded: true,
    };
    renderWithIntl(<AmountBreakdown breakdown={b} />, 'es');
    const box = screen.getByTestId('amount-breakdown');
    expect(within(box).getByText('IVA 16 % incluido')).toBeInTheDocument();
    expect(within(box).getAllByText(/IVA 16 % incluido/)).toHaveLength(1);
    expect(box.textContent).not.toMatch(/con IVA incluido/);
  });
});

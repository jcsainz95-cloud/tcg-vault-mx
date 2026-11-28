import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import type { BuylistBreakdownDTO } from '@/types/contract';
import { BuylistBreakdown } from './BuylistBreakdown';

const ES: BuylistBreakdownDTO = {
  marketMxnCents: 100000,
  languagePenalty: { pct: 15, cents: -15000 },
  adjustedMarketCents: 85000,
  curvePct: 70,
  finalOfferCents: 59500,
};

describe('BuylistBreakdown · orden del dueño (§BUYLIST-ES §3)', () => {
  it('mercado → −idioma → ajustado → % de la curva → oferta, en ese orden', () => {
    renderWithIntl(<BuylistBreakdown breakdown={ES} />);
    const rows = Array.from(document.querySelectorAll('[data-row]')).map((r) => r.getAttribute('data-row'));
    expect(rows).toEqual(['market', 'language', 'adjusted', 'base', 'offer']);
    const txt = screen.getByTestId('buylist-breakdown').textContent ?? '';
    expect(txt).toContain('1,000.00');
    expect(txt).toContain('Idioma español −15 %');
    expect(txt).toContain('150.00');
    expect(txt).toContain('850.00');
    expect(txt).toContain('Curva de compra 70 %');
    expect(txt).toContain('Te pagamos');
    expect(txt).toContain('595.00');
  });

  it('mesa del dueño: la última fila dice «Oferta»', () => {
    renderWithIntl(<BuylistBreakdown breakdown={ES} offerLabel="offerAdmin" />);
    expect(screen.getByText('Oferta')).toBeInTheDocument();
  });

  it('línea en inglés (sin castigo) o sin desglose: no pinta nada', () => {
    const a = renderWithIntl(<BuylistBreakdown breakdown={{ ...ES, languagePenalty: null }} />);
    expect(a.container.firstChild).toBeNull();
    const b = renderWithIntl(<BuylistBreakdown breakdown={undefined} />);
    expect(b.container.firstChild).toBeNull();
  });
});

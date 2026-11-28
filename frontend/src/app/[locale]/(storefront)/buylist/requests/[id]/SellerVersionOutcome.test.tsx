import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import type { SellItemDTO } from '@/types/contract';
import { SellerVersionOutcome } from './SellerVersionOutcome';

const CARD = { id: 'c', name: 'Charizard' } as SellItemDTO['card'];
const RB = {
  marketMxnCents: 100000,
  languagePenalty: { pct: 15, cents: -15000 },
  adjustedMarketCents: 85000,
  curveBp: 7000,
  cap: null,
  source: 'received' as const,
  finalOfferCents: 59500,
};
const base = (o: Partial<SellItemDTO>): SellItemDTO =>
  ({ id: 'i1', card: CARD, productType: 'raw', finish: 'holofoil', itemStatus: 'recibida', language: 'en', receivedVersionSet: true, receivedLanguage: 'es', ...o }) as SellItemDTO;

describe('SellerVersionOutcome · §BUYLIST-ES §4.2/§4.4', () => {
  it('baja (EN→ES): «llegó como Español y declaraste Inglés», nueva oferta y antes, y el desglose de lo recibido', () => {
    renderWithIntl(
      <SellerVersionOutcome
        line={base({
          receivedBreakdown: RB,
          revision: { state: 'pending', proposedCents: 59500, previousCents: 70000, proposedAt: null, expiresAt: null },
        })}
      />,
    );
    expect(screen.getByTestId('seller-version-arrived-i1')).toHaveTextContent('Llegó como Español; declaraste Inglés');
    expect(screen.getByTestId('seller-version-outcome-i1')).toHaveTextContent(
      'Charizard llegó como Español y declaraste Inglés; nueva oferta MX$595.00 (antes MX$700.00). Acéptala o recházala en 7 días.',
    );
    const rows = Array.from(document.querySelectorAll('[data-row]')).map((r) => r.getAttribute('data-row'));
    expect(rows).toEqual(['market', 'language', 'adjusted', 'base', 'offer']);
  });

  it('alza (ES→EN): «Te pagamos MX$X por tu carta (versión)» con lo aprobado', () => {
    renderWithIntl(
      <SellerVersionOutcome
        line={base({
          language: 'es',
          receivedLanguage: 'en',
          approvedPriceCents: 70000,
          receivedBreakdown: { ...RB, languagePenalty: null, adjustedMarketCents: 100000, curveBp: null, finalOfferCents: 70000 },
        })}
      />,
      'en',
    );
    expect(screen.getByTestId('seller-version-outcome-i1')).toHaveTextContent('We pay MX$700.00 for your Charizard (English).');
    expect(screen.getByTestId('seller-version-arrived-i1')).toHaveTextContent('Arrived as English; you declared Spanish');
  });

  it('sin precio para lo recibido: «No pudimos valorar esta versión; te recogemos la carta», sin desglose', () => {
    renderWithIntl(<SellerVersionOutcome line={base({ receivedBreakdown: null, itemStatus: 'rechazada' })} />);
    expect(screen.getByTestId('seller-version-outcome-i1')).toHaveTextContent('No pudimos valorar esta versión; te recogemos la carta');
    expect(screen.queryByTestId('buylist-breakdown')).toBeNull();
  });

  it('BES-4: con piso dice «Oferta mínima de la tienda» y ningún monto de tope', () => {
    renderWithIntl(
      <SellerVersionOutcome
        line={base({
          receivedBreakdown: { ...RB, curveBp: null, cap: { reason: 'floor' }, finalOfferCents: 30000 },
          revision: { state: 'pending', proposedCents: 30000, previousCents: 70000, proposedAt: null, expiresAt: null },
        })}
      />,
    );
    expect(screen.getByText('Oferta mínima de la tienda')).toBeInTheDocument();
  });

  it('sin diferencia (o sin `receivedVersionSet`): no pinta nada', () => {
    const a = renderWithIntl(<SellerVersionOutcome line={base({ receivedLanguage: 'en' })} />);
    expect(a.container.firstChild).toBeNull();
    const b = renderWithIntl(<SellerVersionOutcome line={base({ receivedVersionSet: false })} />);
    expect(b.container.firstChild).toBeNull();
  });
});

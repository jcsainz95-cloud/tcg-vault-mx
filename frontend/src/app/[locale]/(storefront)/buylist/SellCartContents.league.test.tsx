import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import type { SellRequirements } from '@/hooks/useSellRequirements';
import * as api from '@/lib/api';
import type { BuylistQuoteResponse } from '@/types/contract';
import { SellCartContents } from './SellCartContents';
import { useSellCart, SELL_CART_KEY } from './useSellCart';

/**
 * §BUYLIST-ES F4 · segmento «Normal | De liga» (fichas por liga) combinado con el de idioma: cambiar cualquiera NO pide red,
 * el monto sale de `versions[]` del servidor y la línea conserva chips. Dial apagado = nada nuevo.
 */
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const sellReq: SellRequirements = {
  ready: true, isAuthenticated: true, emailVerified: true, emailBlocked: false, kycLoading: false,
  clabeOnFile: true, ineOnFile: true, ineExpected: false, canSubmit: true,
};

const PP = { productId: 648703, type: 'prize_pack', label: 'Prize Pack' };
const TOUR = { productId: 648704, type: 'championship', label: 'De torneo' };
const v = (language: 'en' | 'es', stamp: typeof PP | null, offerCents: number | null) => ({
  key: stamp ? `${language}.${stamp.productId}` : language, language, stamp, offerCents,
  reason: offerCents == null ? ('no_reference' as const) : null,
});
const QUOTE: BuylistQuoteResponse = {
  rarity: 'Rare', finish: 'holofoil', priceBasis: 'market',
  quote: { status: 'cotizada', quotedPriceCents: 50000, currency: 'MXN' },
  referencePrice: { status: 'priced', priceMxnCents: 100000 }, paymentNotice: 'PAY_AFTER_RECEIPT',
  spanishEligible: true, offers: { en: 50000, es: 42500 },
  stampOptions: [PP, TOUR],
  versions: [v('en', null, 50000), v('es', null, 42500), v('en', PP, 400000), v('es', PP, 340000), v('en', TOUR, null), v('es', TOUR, null)],
};

function Harness({ league = true, spanish = true }: { league?: boolean; spanish?: boolean }) {
  const c = useSellCart();
  useEffect(() => {
    c.addLine({ card: { id: 'c1', name: 'Pikachu ex', number: '238' }, productType: 'raw', rawCondition: 'NM', finish: 'holofoil', quote: QUOTE });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <SellCartContents
      cart={c.cart}
      sellReq={sellReq}
      expandedLines={c.expandedLines}
      totalEstimatedCents={c.totalEstimatedCents}
      pendingCardCount={c.pendingCardCount}
      cartCount={c.cartCount}
      onSetQuantity={c.setQuantity}
      onRemoveLine={c.removeLine}
      onToggleLineDetail={c.toggleLineDetail}
      onClearCart={c.clearCart}
      onSubmit={() => {}}
      spanishEnabled={spanish}
      onSetLanguage={c.setLineLanguage}
      leagueEnabled={league}
      onSetStamp={c.setLineStamp}
    />
  );
}

beforeEach(() => {
  window.localStorage.removeItem(SELL_CART_KEY);
});

describe('SellCartContents · liga (BUYLIST-ES F4)', () => {
  it('dial apagado: sin segmento «Normal | De liga»', () => {
    renderWithIntl(<Harness league={false} />);
    expect(screen.queryByTestId('stamp-segment')).toBeNull();
    expect(screen.getByTestId('language-segment')).toBeInTheDocument();
  });

  it('muestra Normal + una ficha por liga con su monto; la liga sin referencia queda apagada con «Sin oferta»', () => {
    renderWithIntl(<Harness />);
    const seg = screen.getByTestId('stamp-segment');
    const [normal, pp, tour] = Array.from(seg.querySelectorAll('button'));
    expect(normal).toHaveTextContent('Normal');
    expect(normal).toHaveTextContent('MX$500.00');
    expect(pp).toHaveTextContent('Prize Pack');
    expect(pp).toHaveTextContent('MX$4,000.00');
    expect(tour).toBeDisabled();
    expect(tour).toHaveTextContent('Sin oferta');
    expect(normal).toHaveAttribute('aria-pressed', 'true');
  });

  it('elegir liga cambia el monto SIN red, deja el chip y se combina con el idioma (liga × español)', () => {
    const batch = vi.spyOn(api, 'batchQuote');
    const quote = vi.spyOn(api, 'getBuylistQuote');
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Prize Pack/ }));
    const line = screen.getByTestId('sell-cart-line-prices');
    expect(within(line).getByText('MX$4,000.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prize Pack/ })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('[data-version-chip="stamp"]')).toHaveTextContent('De liga');
    // idioma: la ficha de idioma ahora ofrece las cifras de la LIGA
    const es = screen.getByTestId('language-segment').querySelector('button[data-lang="es"]')!;
    expect(es).toHaveTextContent('MX$3,400.00');
    fireEvent.click(es);
    expect(within(screen.getByTestId('sell-cart-line-prices')).getByText('MX$3,400.00')).toBeInTheDocument();
    // las fichas de liga siguen al idioma elegido
    expect(screen.getByRole('button', { name: /Prize Pack/ })).toHaveTextContent('MX$3,400.00');
    expect(document.querySelector('[data-version-chip="language"]')).toHaveTextContent('Español');
    // volver a Normal en español: la cifra española normal
    fireEvent.click(screen.getByRole('button', { name: /Normal/ }));
    expect(within(screen.getByTestId('sell-cart-line-prices')).getByText('MX$425.00')).toBeInTheDocument();
    expect(batch).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
    // la solicitud lleva el `productId` de la liga elegida
  });

  it('la solicitud lleva el productId de la liga (identidad de línea) y la liga viaja con el idioma', () => {
    let items: unknown;
    function Probe() {
      const c = useSellCart();
      useEffect(() => {
        c.addLine({ card: { id: 'c1', name: 'Pikachu ex', number: '238' }, productType: 'raw', rawCondition: 'NM', finish: 'holofoil', quote: QUOTE });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      items = c.requestItems;
      return (
        <button type="button" onClick={() => c.cart[0] && c.setLineStamp(c.cart[0].id, PP.productId)}>
          liga
        </button>
      );
    }
    renderWithIntl(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'liga' }));
    expect(items).toEqual([expect.objectContaining({ cardId: 'c1', productId: 648703 })]);
  });
});

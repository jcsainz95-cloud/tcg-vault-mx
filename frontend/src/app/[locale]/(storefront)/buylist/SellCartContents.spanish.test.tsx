import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import type { SellRequirements } from '@/hooks/useSellRequirements';
import type { CartLine } from './useSellCart';
import { SellCartContents, type SellCartContentsProps } from './SellCartContents';

/** §BUYLIST-ES F2 · segmento por carta, «Todas en español», chip y dial apagado = nada nuevo. */
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
  ready: true,
  isAuthenticated: true,
  emailVerified: true,
  emailBlocked: false,
  kycLoading: false,
  clabeOnFile: true,
  ineOnFile: true,
  ineExpected: false,
  canSubmit: true,
};

function line(id: string, name: string, over: Partial<CartLine['quote']> = {}, language?: 'es'): CartLine {
  return {
    id,
    card: { id: `c-${id}`, name, number: '1', setPtcgoCode: null },
    productType: 'raw',
    finish: 'normal',
    quantity: 1,
    ...(language ? { language } : {}),
    quote: {
      rarity: 'Rare',
      finish: 'normal',
      priceBasis: 'market',
      quote: { status: 'cotizada', quotedPriceCents: language ? 42500 : 50000, currency: 'MXN' },
      referencePrice: { status: 'priced', priceMxnCents: 100000 },
      paymentNotice: 'PAY_AFTER_RECEIPT',
      ...over,
    },
  };
}
const ELIGIBLE = { spanishEligible: true, offers: { en: 50000, es: 42500 } };

function render(cart: CartLine[], extra: Partial<SellCartContentsProps> = {}) {
  return renderWithIntl(
    <SellCartContents
      cart={cart}
      sellReq={sellReq}
      expandedLines={{}}
      totalEstimatedCents={0}
      pendingCardCount={0}
      cartCount={cart.length}
      onSetQuantity={() => {}}
      onRemoveLine={() => {}}
      onToggleLineDetail={() => {}}
      onClearCart={() => {}}
      onSubmit={() => {}}
      {...extra}
    />,
  );
}

describe('SellCartContents · español (BUYLIST-ES F2)', () => {
  it('dial apagado: sin segmento, sin «Todas en español» y sin chip (no regresión)', () => {
    render([line('1', 'Pikachu', ELIGIBLE)], {
      spanishEnabled: false,
      onSetLanguage: vi.fn(),
      onAllSpanish: vi.fn(),
    });
    expect(screen.queryByTestId('language-segment')).toBeNull();
    expect(screen.queryByText('Todas en español')).toBeNull();
    expect(screen.queryByTestId('sell-cart-bulk-status')).toBeNull();
  });

  it('dial encendido: segmento con ambos montos; un toque avisa el idioma', () => {
    const onSetLanguage = vi.fn();
    render([line('1', 'Pikachu', ELIGIBLE)], { spanishEnabled: true, onSetLanguage, onAllSpanish: vi.fn() });
    const seg = screen.getByTestId('language-segment');
    expect(seg.textContent).toContain('500.00');
    expect(seg.textContent).toContain('425.00');
    fireEvent.click(within(seg).getByRole('button', { name: /Español/ }));
    expect(onSetLanguage).toHaveBeenCalledWith('1', 'es');
  });

  it('carta no elegible: sin segmento aunque el dial esté encendido', () => {
    render([line('1', 'Pikachu', { spanishEligible: false, offers: { en: 50000, es: null } })], {
      spanishEnabled: true,
      onSetLanguage: vi.fn(),
      onAllSpanish: vi.fn(),
    });
    expect(screen.queryByTestId('language-segment')).toBeNull();
  });

  it('línea en español: chip «Español», sin «valor de mercado» y puede volver a inglés', () => {
    const onSetLanguage = vi.fn();
    render([line('1', 'Pikachu', { ...ELIGIBLE, language: 'es' }, 'es')], {
      spanishEnabled: true,
      onSetLanguage,
      onAllSpanish: vi.fn(),
    });
    const li = screen.getByText('Pikachu').closest('li')!;
    expect(li.querySelector('[data-version-chip="language"]')?.textContent).toBe('Español');
    expect(within(li).queryByText('Valor de mercado c/u')).toBeNull();
    fireEvent.click(within(li).getByRole('button', { name: /Inglés/ }));
    expect(onSetLanguage).toHaveBeenCalledWith('1', 'en');
  });

  it('«Todas en español» llama al atajo y anuncia cuántas pasaron y cuántas omitió', () => {
    const onAllSpanish = vi.fn(() => ({ switched: 2, skipped: 1 }));
    render([line('1', 'A', ELIGIBLE), line('2', 'B', ELIGIBLE), line('3', 'C')], {
      spanishEnabled: true,
      onSetLanguage: vi.fn(),
      onAllSpanish,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Todas en español' }));
    expect(onAllSpanish).toHaveBeenCalledTimes(1);
    const status = screen.getByTestId('sell-cart-bulk-status');
    expect(status.textContent).toContain('2 cartas pasaron a español.');
    expect(status.textContent).toContain('Omitimos 1 que no tiene oferta en español.');
  });

  it('«Todas en español» no aparece si ya están todas en español', () => {
    render([line('1', 'A', { ...ELIGIBLE, language: 'es' }, 'es')], {
      spanishEnabled: true,
      onSetLanguage: vi.fn(),
      onAllSpanish: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: 'Todas en español' })).toBeNull();
  });
});

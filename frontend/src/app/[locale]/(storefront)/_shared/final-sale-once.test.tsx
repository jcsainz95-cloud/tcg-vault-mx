import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import { breakdownOf, guestQuote } from '@/test/accessories.testkit';
import { mockSealedGroups } from '@/lib/mock/fixtures';
import type {
  CardDTO,
  GroupedListingDTO,
  GuestCheckoutQuoteResponse,
  ListingDTO,
  UserDTO,
} from '@/types/contract';

/**
 * B4 (BRIEF_MKT §4 Ola 1, orden del dueño 2026-10-30) — candado de CONTEO: antes de pagar, el comprador lee
 * «Todas las ventas son finales» UNA sola vez en el recorrido ficha → carrito, y siempre con T8 («Si tu carta
 * llega dañada o equivocada, te reembolsamos.», DESIGN_SYSTEM §CHK-MOVIL.4) en el mismo bloque.
 *
 * Medido en el diagnóstico de 2026-10-30 (`ux-review/m-05-carrito.txt`): 3 veces (ficha 1 + carrito 2: la casilla
 * de términos y la nota legal). Reparto vigente:
 *  - ficha (carta y sellado): 0 — solo T8, como señal de confianza;
 *  - checkout de invitado: 1 — la casilla de términos (texto legal que se conserva tal cual), con T8 debajo;
 *  - checkout con cuenta (sin casilla): 1 — la nota legal con «Ver términos» y T8 (criterio 48b).
 * Se cuenta sobre el texto VISIBLE de la página entera, no sobre un componente: una copia nueva en cualquier sitio
 * de la vista lo pone rojo.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}));

import { CardDetailView } from '../catalog/[cardId]/CardDetailView';
import { SealedDetailView } from '../sellado/[inventoryItemId]/SealedDetailView';
import { GuestCheckoutView } from '../checkout/GuestCheckoutView';
import { CheckoutView } from '../checkout/CheckoutView';
import { setCheckoutViewport } from '../checkout/test-viewport';

const FINAL = { es: /ventas son finales/gi, en: /sales are final/gi } as const;
const T8 = {
  es: 'Si tu carta llega dañada o equivocada, te reembolsamos.',
  en: 'If your card arrives damaged or wrong, we refund you.',
} as const;

function finalCount(locale: 'es' | 'en'): number {
  return (document.body.textContent ?? '').match(FINAL[locale])?.length ?? 0;
}

/** El elemento más pequeño cuyo texto contiene la frase de ventas finales. */
function finalSaleHost(locale: 'es' | 'en'): HTMLElement {
  const re = new RegExp(FINAL[locale].source, 'i');
  const all = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter((el) => re.test(el.textContent ?? ''));
  return all.filter((el) => !all.some((o) => o !== el && el.contains(o)))[0];
}

/** T8 está «junto»: dentro del bloque que contiene la frase o en el bloque padre inmediato (renglón siguiente). */
function expectT8Beside(locale: 'es' | 'en') {
  let block: HTMLElement | null = finalSaleHost(locale);
  for (let i = 0; i < 3 && block && !(block.textContent ?? '').includes(T8[locale]); i++) block = block.parentElement;
  expect(block?.textContent ?? '').toContain(T8[locale]);
}

const card: CardDTO = {
  id: 'c-test',
  externalId: 'base1-4',
  name: 'Charizard',
  number: '4',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: ['Stage 2'],
  setId: 'base1',
  setName: 'Base Set',
  setPtcgoCode: null,
  imageSmallUrl: 'https://img.example/s.png',
  imageLargeUrl: 'https://img.example/l.png',
  availableFinishes: ['normal'],
};
const refValue: ListingDTO['referenceValue'] = {
  status: 'priced',
  referenceMxnCents: 128000,
  source: 'pokemontcg_io',
  capturedDate: '2026-08-13',
};
const unit: ListingDTO = {
  inventoryItemId: 'inv-a',
  card,
  productType: 'raw',
  rawCondition: 'NM',
  finish: 'normal',
  referenceValue: refValue,
  displayPriceCents: 140800,
  ivaIncluded: true,
  ivaRatePct: 16,
  priceBasis: 'market',
  sellable: true,
};
const group: GroupedListingDTO = {
  representativeInventoryItemId: 'inv-a',
  card,
  productType: 'raw',
  rawCondition: 'NM',
  finish: 'normal',
  gradeKey: 'raw:NM',
  stockCount: 1,
  displayPriceCents: 140800,
  ivaIncluded: true,
  ivaRatePct: 16,
  priceBasis: 'market',
  referenceValue: refValue,
  referenceDisplayCents: 148480,
  currency: 'MXN',
};

const CARD_ITEM = {
  inventoryItemId: 'inv-1002',
  card: { cardId: 'c-1', name: 'Charizard', setName: 'Base Set', number: '4', productType: 'raw', rawCondition: 'NM', imageSmallUrl: null },
  unitPriceCents: 100_000,
} as unknown as GuestCheckoutQuoteResponse['items'][number];

const customer: UserDTO = { id: 'u-1', email: 'cliente@example.com', name: 'Cliente', role: 'customer', locale: 'es', emailVerified: true };

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(api, 'getAccessorySuggestions').mockResolvedValue({ items: [] });
});

describe.each(['es', 'en'] as const)('B4 · «ventas finales» una sola vez antes de pagar, con T8 al lado (%s)', (locale) => {
  it('ficha de CARTA: 0 veces «ventas finales» y T8 visible', async () => {
    vi.spyOn(api, 'getCardDetail').mockResolvedValue({ card, listings: [group], units: [unit] });
    renderWithProviders(<CardDetailView cardId="c-test" />, locale);
    expect(await screen.findByText(T8[locale])).toBeInTheDocument();
    expect(finalCount(locale)).toBe(0);
  });

  it('ficha de SELLADO: 0 veces «ventas finales» y T8 visible', async () => {
    const g = mockSealedGroups[0];
    vi.spyOn(api, 'getSealedGroupDetail').mockResolvedValue({
      group: g,
      listings: [
        {
          inventoryItemId: 'inv-a',
          card: g.card,
          productType: 'sealed',
          sealedSubtype: g.sealedSubtype ?? undefined,
          sealedCondition: g.sealedCondition,
          finish: 'normal',
          referenceValue: g.referenceValue,
          priceBasis: g.priceBasis,
          displayPriceCents: g.fromPriceCents,
          ivaIncluded: true,
          ivaRatePct: 16,
          sellable: true,
        },
      ],
      trendEnabled: false,
      restockEnabled: false,
    });
    renderWithProviders(<SealedDetailView inventoryItemId="inv-a" />, locale);
    expect(await screen.findByText(T8[locale])).toBeInTheDocument();
    expect(finalCount(locale)).toBe(0);
  });

  it.each(['desktop', 'mobile'] as const)('checkout de INVITADO (%s): 1 vez (la casilla de términos) y T8 junto a ella', async (vp) => {
    setCheckoutViewport(vp);
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], accessories: [], deckPulls: [], updatedAt: Date.now() }));
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ items: [CARD_ITEM] }));
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, locale);
    await screen.findByTestId('privacy-site-guestCheckout');
    expect(finalCount(locale)).toBe(1);
    // La única mención es la casilla de términos (se conserva), y T8 va junto a ella.
    expect(screen.getByTestId('privacy-site-guestCheckout').textContent).toMatch(new RegExp(FINAL[locale].source, 'i'));
    expectT8Beside(locale);
  });

  it.each(['desktop', 'mobile'] as const)('checkout CON CUENTA (%s): 1 vez, con «Ver términos» y T8 en el mismo bloque', async (vp) => {
    setCheckoutViewport(vp);
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], accessories: [], deckPulls: [], updatedAt: Date.now() }));
    setStoredUser(customer);
    vi.spyOn(api, 'getCheckoutQuote').mockResolvedValue({
      items: [CARD_ITEM],
      breakdown: { ...breakdownOf(100_000, undefined, 100_987), processingFeeCents: 987 },
      unavailableItems: [],
      ownReservation: null,
    });
    renderWithProviders(<CheckoutView />, locale);
    expect(await screen.findByText(T8[locale])).toBeInTheDocument();
    expect(finalCount(locale)).toBe(1);
    expectT8Beside(locale);
  });
});

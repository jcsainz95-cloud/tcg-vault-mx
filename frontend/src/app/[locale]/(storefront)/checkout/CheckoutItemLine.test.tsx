import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import { mockListings, orderItemCard } from '@/lib/mock/fixtures';
import type {
  CheckoutQuoteResponse,
  GuestCheckoutQuoteResponse,
  OrderItemCardDTO,
  UserDTO,
} from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, getCheckoutQuote: vi.fn(), getGuestCheckoutQuote: vi.fn() };
});

import { getCheckoutQuote, getGuestCheckoutQuote } from '@/lib/api';
import { CheckoutView } from './CheckoutView';
import { GuestCheckoutView } from './GuestCheckoutView';

/**
 * REGRESIÓN v1.51-b — la meta de una línea de compra.
 *
 * El bug: `CheckoutView` leía `item.productType` / `item.rawCondition` AL NIVEL DEL ÍTEM, y el
 * backend nunca los mandó ahí. El preview es `{ inventoryItemId, card, unitPriceCents }` y esos
 * dos campos viven DENTRO de `card` (`OrderItemCardDTO`, contrato §4). Resultado: el sufijo de
 * condición «· NM» —lo único que distingue una carta raw en la línea— salía SIEMPRE en blanco,
 * y en silencio, porque el tipo del front mentía diciendo que `card` era un `CardDTO`.
 *
 * Este test lee la meta REAL del DOM, no el tipo. Si alguien vuelve a subir esos campos un
 * nivel, el sufijo desaparece y el test falla.
 */
const RAW_LISTING = mockListings.find((l) => l.productType === 'raw' && l.rawCondition === 'NM')!;

const user: UserDTO = {
  id: 'u-1',
  email: 'cliente@example.com',
  name: 'Cliente',
  role: 'customer',
  locale: 'es',
  emailVerified: true,
};

const ZERO_BREAKDOWN = {
  subtotalCents: 12500,
  ivaCents: 0,
  ivaRatePct: 16,
  processingFeeCents: 0,
  totalCents: 12500,
  currency: 'MXN' as const,
};

function quote(card: OrderItemCardDTO): CheckoutQuoteResponse {
  return {
    items: [{ inventoryItemId: 'inv-x', card, unitPriceCents: 12500 }],
    breakdown: ZERO_BREAKDOWN,
    unavailableItems: [],
  };
}

function guestQuote(card: OrderItemCardDTO): GuestCheckoutQuoteResponse {
  return {
    items: [{ inventoryItemId: 'inv-x', card, unitPriceCents: 12500 }],
    fulfillmentMode: 'direct_ship',
    breakdown: { ...ZERO_BREAKDOWN, shippingFeeCents: 17500 },
    vaultBreakdown: ZERO_BREAKDOWN,
    notices: { finalSale: true, invoiceByEmail: true, termsRequired: true },
    unavailableItems: [],
  };
}

function seedCart(ids: string[]) {
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids, updatedAt: Date.now() }));
}

describe('línea de compra · meta y miniatura (contrato §4, OrderItemCardDTO)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(getCheckoutQuote).mockReset();
    vi.mocked(getGuestCheckoutQuote).mockReset();
    seedCart(['inv-x']);
  });

  it('cuenta: una carta raw muestra el sufijo de condición «· NM»', async () => {
    setStoredUser(user);
    const card = orderItemCard(RAW_LISTING);
    vi.mocked(getCheckoutQuote).mockResolvedValue(quote(card));

    renderWithProviders(<CheckoutView />, 'es');

    const meta = await screen.findByText(`${card.setName} · #${card.number} · NM`);
    expect(meta).toBeInTheDocument();
  });

  it('invitado: la misma carta muestra la misma meta (§4-G.1 comparte forma con §4)', async () => {
    const card = orderItemCard(RAW_LISTING);
    vi.mocked(getGuestCheckoutQuote).mockResolvedValue(guestQuote(card));

    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    expect(await screen.findByText(`${card.setName} · #${card.number} · NM`)).toBeInTheDocument();
  });

  it('una pieza graded NO inventa sufijo de condición (rawCondition ausente)', async () => {
    setStoredUser(user);
    const graded = mockListings.find((l) => l.productType === 'graded');
    expect(graded).toBeDefined();
    const card = orderItemCard(graded!);
    vi.mocked(getCheckoutQuote).mockResolvedValue(quote(card));

    renderWithProviders(<CheckoutView />, 'es');

    expect(await screen.findByText(`${card.setName} · #${card.number}`)).toBeInTheDocument();
  });

  it('`imageSmallUrl: null` pinta la miniatura y NO deja un esqueleto pulsando para siempre', async () => {
    setStoredUser(user);
    // `null` es legítimo por contrato (la fila `Card` puede no existir): el front pinta su
    // placeholder. Lo que NO puede hacer es dejar el `animate-pulse` eterno, que se lee como
    // «cargando» y hace parecer colgada una app que ya terminó.
    const card: OrderItemCardDTO = { ...orderItemCard(RAW_LISTING), imageSmallUrl: null };
    vi.mocked(getCheckoutQuote).mockResolvedValue(quote(card));

    const { container } = renderWithProviders(<CheckoutView />, 'es');

    await screen.findByText(card.name);
    expect(screen.queryByAltText(card.name)).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });
});

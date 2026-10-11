import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import { mockListings, orderItemCard } from '@/lib/mock/fixtures';
import type { CheckoutQuoteResponse, UserDTO } from '@/types/contract';

// Link de i18n → <a> plano para el render de prueba.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

// Arnés de `CheckoutUnavailable.test.tsx`: quote y session con cuenta mockeados; el resto del módulo intacto.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getCheckoutQuote: vi.fn(),
    createCheckoutSession: vi.fn(),
  };
});

import { createCheckoutSession, getCheckoutQuote } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { clearUnavailableNotice } from './unavailable-notice';
import { CheckoutView } from './CheckoutView';

/** Piezas muertas del escenario: id → cardName (null = ya no existe en BD). */
type Dead = Record<string, string | null>;

function listingFor(id: string) {
  const listing = mockListings.find((l) => l.inventoryItemId === id);
  if (!listing) throw new Error(`fixture sin listing ${id}`);
  return listing;
}

function pruneSplit(ids: string[], dead: Dead) {
  const live = ids.filter((id) => !(id in dead));
  const unavailableItems = ids
    .filter((id) => id in dead)
    .map((id) => ({ inventoryItemId: id, cardName: dead[id] }));
  return { live, unavailableItems };
}

/** Réplica del quote `customer` (§4): items/breakdown SOLO de los válidos + unavailableItems. */
function customerQuote(ids: string[], dead: Dead): CheckoutQuoteResponse {
  const { live, unavailableItems } = pruneSplit(ids, dead);
  const listings = live.map(listingFor);
  const subtotal = listings.reduce((s, l) => s + (l.displayPriceCents ?? 0), 0);
  return {
    // v1.51-b: el preview es `{ inventoryItemId, card, unitPriceCents }` y `card` es un
    // `OrderItemCardDTO` (§4). `productType`/`rawCondition` van DENTRO de `card`.
    items: listings.map((l) => ({
      inventoryItemId: l.inventoryItemId,
      card: orderItemCard(l),
      unitPriceCents: l.displayPriceCents ?? 0,
    })),
    breakdown: {
      subtotalCents: subtotal,
      ivaCents: 0,
      ivaRatePct: 16,
      processingFeeCents: 0,
      totalCents: subtotal,
      currency: 'MXN',
      priceConvention: 'IVA_EXCLUSIVE',
      ivaIncluded: false,
    },
    unavailableItems,
  };
}

function seedCart(ids: string[]) {
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids, updatedAt: Date.now() }));
}

/**
 * **UX-14** (`API_CONTRACT §M6-U.8 (c)`, `DESIGN_SYSTEM §42.7`, criterio 269): una cuenta del equipo sin correo
 * que intenta pagar recibe `403 ACCOUNT_WITHOUT_EMAIL` ⇒ el pago pinta SU texto (por `getMessage` ⇒
 * `error.ACCOUNT_WITHOUT_EMAIL`) y ⛔ NO el aviso de «verifica tu correo»: no hay correo que verificar.
 * Canario: tratarlo como `EMAIL_NOT_VERIFIED`.
 */
const ana: UserDTO = {
  id: 'u-ana',
  email: null,
  username: 'ana',
  name: 'Ana Operadora',
  role: 'vault_operator',
  locale: 'es',
  emailVerified: false,
};

describe('UX-14 · `403 ACCOUNT_WITHOUT_EMAIL` en el pago', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearUnavailableNotice();
    vi.mocked(getCheckoutQuote).mockReset();
    vi.mocked(createCheckoutSession).mockReset();
  });

  it('pinta el texto de la cuenta del equipo y no el aviso de verificar correo', async () => {
    const usr = userEvent.setup();
    setStoredUser(ana);
    seedCart(['inv-1001']);
    vi.mocked(getCheckoutQuote).mockImplementation(async (ids) => customerQuote(ids, {}));
    vi.mocked(createCheckoutSession).mockRejectedValue(
      new ApiClientError(403, {
        code: 'ACCOUNT_WITHOUT_EMAIL',
        message: 'Las cuentas del equipo sin correo no pueden comprar ni vender. Usa una cuenta de cliente.',
      }),
    );

    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));

    expect(
      await screen.findByText(
        'Esta es una cuenta del equipo y no tiene correo, así que no puede comprar, mandar a bóveda ni vender. Para eso, usa una cuenta de cliente.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Verifica tu correo para completar esta acción')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reenviar correo/ })).not.toBeInTheDocument();
  });
});

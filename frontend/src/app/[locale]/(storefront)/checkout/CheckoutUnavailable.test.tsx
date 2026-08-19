import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import { mockListings } from '@/lib/mock/fixtures';
import type {
  CheckoutQuoteResponse,
  GuestCheckoutQuoteResponse,
  UserDTO,
} from '@/types/contract';

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

// Los DOS quotes se mockean para controlar `unavailableItems` (v1.21.3-quote-prune) y
// las DOS sessions para simular la carrera quote→pago (F-2); el resto del módulo API
// queda intacto.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getCheckoutQuote: vi.fn(),
    getGuestCheckoutQuote: vi.fn(),
    createCheckoutSession: vi.fn(),
    createGuestCheckoutSession: vi.fn(),
  };
});

import {
  createCheckoutSession,
  createGuestCheckoutSession,
  getCheckoutQuote,
  getGuestCheckoutQuote,
} from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { clearUnavailableNotice } from './unavailable-notice';
import { GuestCheckoutView } from './GuestCheckoutView';
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
  const subtotal = listings.reduce((s, l) => s + (l.salePriceCents ?? 0), 0);
  return {
    items: listings.map((l) => ({
      inventoryItemId: l.inventoryItemId,
      card: l.card,
      productType: l.productType,
      rawCondition: l.rawCondition,
      unitPriceCents: l.salePriceCents ?? 0,
    })),
    breakdown: {
      subtotalCents: subtotal,
      ivaCents: 0,
      ivaRatePct: 16,
      processingFeeCents: 0,
      totalCents: subtotal,
      currency: 'MXN',
    },
    unavailableItems,
  };
}

/** Réplica del quote de invitado (§4-G.1): mismo criterio de poda + breakdown en ceros si todo murió. */
function guestQuote(ids: string[], dead: Dead): GuestCheckoutQuoteResponse {
  const { live, unavailableItems } = pruneSplit(ids, dead);
  const listings = live.map(listingFor);
  const subtotal = listings.reduce((s, l) => s + (l.salePriceCents ?? 0), 0);
  const shipping = live.length > 0 ? 17500 : 0;
  return {
    items: listings.map((l) => ({
      inventoryItemId: l.inventoryItemId,
      card: l.card,
      unitPriceCents: l.salePriceCents ?? 0,
    })),
    fulfillmentMode: 'direct_ship',
    breakdown: {
      subtotalCents: subtotal,
      shippingFeeCents: shipping,
      ivaCents: 0,
      ivaRatePct: 16,
      processingFeeCents: 0,
      totalCents: subtotal + shipping,
      currency: 'MXN',
    },
    // v1.21.4-dual-breakdown (§4-G.1): segundo desglose (destino bóveda) — mismo subtotal SIN
    // envío. Siempre presente en el 200 (ceros cuando todo el carrito murió).
    vaultBreakdown: {
      subtotalCents: subtotal,
      ivaCents: 0,
      ivaRatePct: 16,
      processingFeeCents: 0,
      totalCents: subtotal,
      currency: 'MXN',
    },
    notices: { finalSale: true, invoiceByEmail: true, termsRequired: true },
    unavailableItems,
  };
}

function seedCart(ids: string[]) {
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids, updatedAt: Date.now() }));
}

function storedIds(): string[] {
  return JSON.parse(window.localStorage.getItem('tcg.cart')!).ids;
}

const user: UserDTO = {
  id: 'u-1',
  email: 'cliente@example.com',
  name: 'Cliente',
  role: 'customer',
  locale: 'es',
  emailVerified: true,
};

describe('checkout · poda amable de piezas muertas (v1.21.3-quote-prune)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearUnavailableNotice();
    vi.mocked(getCheckoutQuote).mockReset();
    vi.mocked(getGuestCheckoutQuote).mockReset();
    vi.mocked(createCheckoutSession).mockReset();
    vi.mocked(createGuestCheckoutSession).mockReset();
  });

  it('invitado: 1 muerta (con nombre) + 2 vivas ⇒ banner con el nombre, 2 renglones y localStorage podado', async () => {
    const dead: Dead = { 'inv-dead': 'Antique Skull Fossil' };
    seedCart(['inv-1001', 'inv-1002', 'inv-dead']);
    vi.mocked(getGuestCheckoutQuote).mockImplementation(async (ids) => guestQuote(ids, dead));

    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    // Banner INFORMATIVO con el nombre de la carta (role=status, nunca alert/error).
    const notice = await screen.findByTestId('unavailable-notice');
    expect(notice).toHaveTextContent('Antique Skull Fossil ya no está disponible y se quitó de tu carrito.');
    expect(within(notice).getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Los 2 renglones vivos siguen cotizados y comprables.
    expect(await screen.findByText('Charizard')).toBeInTheDocument();
    expect(screen.getByText('Blastoise')).toBeInTheDocument();

    // El id muerto se podó del localStorage y se re-cotizó SOLO con los vivos.
    await waitFor(() => expect(storedIds()).toEqual(['inv-1001', 'inv-1002']));
    await waitFor(() =>
      expect(vi.mocked(getGuestCheckoutQuote).mock.calls.at(-1)?.[0]).toEqual(['inv-1001', 'inv-1002']),
    );
    // El aviso SOBREVIVE a la re-cotización (el segundo fetch trae unavailableItems: []).
    expect(screen.getByTestId('unavailable-notice')).toBeInTheDocument();
  });

  it('el aviso se puede cerrar (y solo entonces desaparece)', async () => {
    const usr = userEvent.setup();
    const dead: Dead = { 'inv-dead': 'Antique Skull Fossil' };
    seedCart(['inv-1002', 'inv-dead']);
    vi.mocked(getGuestCheckoutQuote).mockImplementation(async (ids) => guestQuote(ids, dead));

    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await screen.findByTestId('unavailable-notice');
    await usr.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByTestId('unavailable-notice')).not.toBeInTheDocument();
  });

  it('invitado: TODAS muertas ⇒ carrito vacío (EmptyState) + aviso plural, sin pantalla de error ni reintentar', async () => {
    const dead: Dead = { 'inv-dead-1': 'Antique Skull Fossil', 'inv-dead-2': null };
    seedCart(['inv-dead-1', 'inv-dead-2']);
    vi.mocked(getGuestCheckoutQuote).mockImplementation(async (ids) => guestQuote(ids, dead));

    // Se monta el CONMUTADOR real (CheckoutView sin sesión): al vaciarse el carrito,
    // es él quien pinta el EmptyState y debe conservar el aviso.
    renderWithProviders(<CheckoutView />, 'es');

    expect(await screen.findByText('Tu carrito está vacío.')).toBeInTheDocument();
    const notice = screen.getByTestId('unavailable-notice');
    expect(notice).toHaveTextContent('2 piezas de tu carrito ya no están disponibles y se quitaron.');
    expect(notice).toHaveTextContent('Antique Skull Fossil');
    // Nunca la pantalla de error genérico.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Reintentar')).not.toBeInTheDocument();
    await waitFor(() => expect(storedIds()).toEqual([]));
  });

  it('con cuenta: 1 muerta (con nombre) + 2 vivas ⇒ banner, renglones cotizados y carrito podado', async () => {
    const dead: Dead = { 'inv-dead': 'Antique Skull Fossil' };
    setStoredUser(user);
    seedCart(['inv-1001', 'inv-1002', 'inv-dead']);
    vi.mocked(getCheckoutQuote).mockImplementation(async (ids) => customerQuote(ids, dead));

    renderWithProviders(<CheckoutView />, 'es');

    const notice = await screen.findByTestId('unavailable-notice');
    expect(notice).toHaveTextContent('Antique Skull Fossil ya no está disponible y se quitó de tu carrito.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    expect(await screen.findByText('Charizard')).toBeInTheDocument();
    expect(screen.getByText('Blastoise')).toBeInTheDocument();
    // El resto del carrito sigue comprable.
    expect(screen.getByRole('button', { name: /Pagar/ })).toBeInTheDocument();

    await waitFor(() => expect(storedIds()).toEqual(['inv-1001', 'inv-1002']));
    await waitFor(() =>
      expect(vi.mocked(getCheckoutQuote).mock.calls.at(-1)?.[0]).toEqual(['inv-1001', 'inv-1002']),
    );
    expect(screen.getByTestId('unavailable-notice')).toBeInTheDocument();
  });

  it('con cuenta: TODAS muertas (cardName null) ⇒ EmptyState + aviso genérico, sin error', async () => {
    const dead: Dead = { 'inv-dead': null };
    setStoredUser(user);
    seedCart(['inv-dead']);
    vi.mocked(getCheckoutQuote).mockImplementation(async (ids) => customerQuote(ids, dead));

    renderWithProviders(<CheckoutView />, 'es');

    expect(await screen.findByText('Tu carrito está vacío.')).toBeInTheDocument();
    expect(screen.getByTestId('unavailable-notice')).toHaveTextContent(
      'Una pieza de tu carrito ya no está disponible y se quitó.',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Reintentar')).not.toBeInTheDocument();
  });

  /**
   * F-2 — carrera "pieza vendida ENTRE el quote y el pago": la session sigue estricta
   * (409 ITEM_UNAVAILABLE) y el catch de `pay()` dispara `query.refetch()`; el quote
   * nuevo trae la pieza en `unavailableItems` y la maquinaria de v1.21.3 (efecto de
   * poda + banner) poda y avisa sola. El banner ES el aviso: NO se pinta además el
   * mensaje genérico junto al botón (sin doble mensaje contradictorio).
   */
  it('con cuenta: session rechaza ITEM_UNAVAILABLE ⇒ se re-cotiza, banner y poda (sin mensaje junto al botón)', async () => {
    const usr = userEvent.setup();
    // La pieza está VIVA al cotizar; "se vende en otra sesión" justo al pagar.
    const dead: Dead = {};
    setStoredUser(user);
    seedCart(['inv-1001', 'inv-1002']);
    vi.mocked(getCheckoutQuote).mockImplementation(async (ids) => customerQuote(ids, dead));
    vi.mocked(createCheckoutSession).mockImplementation(async () => {
      dead['inv-1002'] = 'Blastoise';
      throw new ApiClientError(409, { code: 'ITEM_UNAVAILABLE', message: 'Item unavailable' });
    });

    renderWithProviders(<CheckoutView />, 'es');

    // Quote inicial sin muertas: dos renglones y ningún banner.
    expect(await screen.findByText('Blastoise')).toBeInTheDocument();
    expect(screen.queryByTestId('unavailable-notice')).not.toBeInTheDocument();

    await usr.click(screen.getByRole('button', { name: /Pagar/ }));

    // El re-quote trae la pieza muerta ⇒ banner con su nombre y renglón podado.
    const notice = await screen.findByTestId('unavailable-notice');
    expect(notice).toHaveTextContent('Blastoise ya no está disponible y se quitó de tu carrito.');
    await waitFor(() => expect(screen.queryByText('Blastoise')).not.toBeInTheDocument());
    await waitFor(() => expect(storedIds()).toEqual(['inv-1001']));
    await waitFor(() =>
      expect(vi.mocked(getCheckoutQuote).mock.calls.at(-1)?.[0]).toEqual(['inv-1001']),
    );

    // Sin doble mensaje: ni payError (role=alert) ni modal de Stripe; el resto sigue comprable.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pagar/ })).toBeInTheDocument();
  });

  it('invitado: session rechaza ITEM_UNAVAILABLE ⇒ se re-cotiza, banner y poda (sin mensaje junto al botón)', async () => {
    const usr = userEvent.setup();
    const dead: Dead = {};
    seedCart(['inv-1001', 'inv-1002']);
    vi.mocked(getGuestCheckoutQuote).mockImplementation(async (ids) => guestQuote(ids, dead));
    vi.mocked(createGuestCheckoutSession).mockImplementation(async () => {
      dead['inv-1002'] = 'Blastoise';
      throw new ApiClientError(409, { code: 'ITEM_UNAVAILABLE', message: 'Item unavailable' });
    });

    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    expect(await screen.findByText('Blastoise')).toBeInTheDocument();
    expect(screen.queryByTestId('unavailable-notice')).not.toBeInTheDocument();

    // Formulario de invitado completo y válido (§15.3) para llegar hasta la session.
    await usr.click(screen.getByRole('button', { name: 'Continuar como invitado' }));
    await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
    await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
    await usr.type(screen.getByLabelText('Calle y número'), 'Av. Reforma 123');
    await usr.type(screen.getByLabelText('Ciudad'), 'CDMX');
    await usr.type(screen.getByLabelText('Estado'), 'CDMX');
    await usr.type(screen.getByLabelText('Código postal'), '06600');
    await usr.type(screen.getByLabelText('Teléfono'), '5512345678');
    await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));

    await usr.click(screen.getByRole('button', { name: /Pagar/ }));

    const notice = await screen.findByTestId('unavailable-notice');
    expect(notice).toHaveTextContent('Blastoise ya no está disponible y se quitó de tu carrito.');
    await waitFor(() => expect(screen.queryByText('Blastoise')).not.toBeInTheDocument());
    await waitFor(() => expect(storedIds()).toEqual(['inv-1001']));
    await waitFor(() =>
      expect(vi.mocked(getGuestCheckoutQuote).mock.calls.at(-1)?.[0]).toEqual(['inv-1001']),
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('con cuenta: si la RE-COTIZACIÓN tras ITEM_UNAVAILABLE falla, sí queda un mensaje visible (respaldo)', async () => {
    const usr = userEvent.setup();
    const dead: Dead = {};
    setStoredUser(user);
    seedCart(['inv-1001', 'inv-1002']);
    vi.mocked(getCheckoutQuote).mockImplementationOnce(async (ids) => customerQuote(ids, dead));
    vi.mocked(createCheckoutSession).mockImplementation(async () => {
      // El refetch que dispara el catch fallará (red caída justo después).
      vi.mocked(getCheckoutQuote).mockRejectedValue(new Error('network down'));
      throw new ApiClientError(409, { code: 'ITEM_UNAVAILABLE', message: 'Item unavailable' });
    });

    renderWithProviders(<CheckoutView />, 'es');
    expect(await screen.findByText('Blastoise')).toBeInTheDocument();

    await usr.click(screen.getByRole('button', { name: /Pagar/ }));

    // Sin banner de poda (no hubo re-quote exitoso), pero NUNCA un callejón mudo: el
    // quote queda en error y QueryState pinta su aviso con "Reintentar". (El payError
    // de respaldo queda seteado y reaparecería junto al botón si el retry recupera la
    // vista.)
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Reintentar')).toBeInTheDocument();
    expect(screen.queryByTestId('unavailable-notice')).not.toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { accCard, breakdownOf, bundle, guestQuote, photo, quoteLine } from '@/test/accessories.testkit';
import type { GuestCheckoutQuoteResponse } from '@/types/contract';

/**
 * Carrito de invitado con accesorios — `API_CONTRACT §AC.4/§AC.7/§AC.8`, `DESIGN_SYSTEM §AC-UX.5–.8`.
 * AC-F4 (¿Te falta algo?), AC-F5 (paquete), AC-F8 (bóveda), AC-F9 (envío de la caja + total de la sesión),
 * AC-F18 (avisos con nombre y fotos del paquete); candados AC-UX-5, -6, -8, -9.
 * ⛔ Ninguna cifra se calcula aquí: todo importe sale de la cotización o de la sesión mockeadas.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

import { GuestCheckoutView } from './GuestCheckoutView';
import { clearAccessoryNotices } from './accessory-notice';

type Seed = { ids?: string[]; accessories?: { id: string; qty: number }[]; deckPulls?: unknown[] };
function seedCart({ ids = [], accessories = [], deckPulls = [] }: Seed) {
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids, accessories, deckPulls, updatedAt: Date.now() }));
}
const cart = () => JSON.parse(window.localStorage.getItem('tcg.cart')!);

const SLEEVES = quoteLine({ accessoryId: 'acc-1', name: 'Penny sleeves x100', quantity: 2, unitPriceCents: 8900, lineTotalCents: 17800 });

function render() {
  return renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(api, 'getAccessorySuggestions').mockResolvedValue({ items: [] });
  // El aviso vive en un store de módulo (sobrevive a la re-cotización): cada prueba arranca sin avisos.
  clearAccessoryNotices();
});

/** Una carta en la cotización (la bóveda solo se ofrece si hay algo que guardar, §AC-UX.7). */
const CARD_ITEM = {
  inventoryItemId: 'inv-1002',
  card: { cardId: 'c-1', name: 'Charizard', setName: 'Base Set', number: '4', productType: 'raw', rawCondition: 'NM', imageSmallUrl: null },
  unitPriceCents: 100_000,
} as unknown as GuestCheckoutQuoteResponse['items'][number];

describe('AC-F9 / AC-UX-5 · renglones de accesorio y lo que viaja a la cotización', () => {
  it('manda accessoryLines y deckPulls del carrito v3 a la cotización', async () => {
    seedCart({
      ids: ['inv-1002'],
      accessories: [{ id: 'acc-1', qty: 2 }],
      deckPulls: [{ token: 'tok-d', slug: 'dragapult-ex', withEnergyBundle: true, deckName: 'Dragapult ex' }],
    });
    const spy = vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ accessoryLines: [SLEEVES] }));
    render();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [ids, , , extras] = spy.mock.calls[0];
    expect(ids).toEqual(['inv-1002']);
    expect(extras).toEqual({
      accessoryLines: [{ accessoryId: 'acc-1', quantity: 2 }],
      deckPulls: [{ pullToken: 'tok-d', withEnergyBundle: true }],
    });
  });

  it('un carrito SOLO de accesorios cotiza y pinta el grupo «ACCESORIOS» con total, «c/u» y «Quitar»', async () => {
    seedCart({ accessories: [{ id: 'acc-1', qty: 2 }] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ accessoryLines: [SLEEVES] }));
    render();
    const row = await screen.findByTestId('cart-accessory-acc-1');
    expect(screen.getByText('ACCESORIOS')).toBeInTheDocument();
    expect(within(row).getByText('Penny sleeves x100')).toBeInTheDocument();
    expect(within(row).getByText(/178\.00/)).toBeInTheDocument();
    expect(within(row).getByText(/89\.00 c\/u/)).toBeInTheDocument();
    expect(within(row).getByRole('group', { name: 'Cantidad de Penny sleeves x100' })).toBeInTheDocument();
    await userEvent.setup().click(within(row).getByRole('button', { name: 'Quitar Penny sleeves x100' }));
    expect(cart().accessories).toEqual([]);
  });

  it('cambiar la cantidad re-cotiza con la nueva (el total del renglón lo dice el servidor)', async () => {
    const user = userEvent.setup();
    seedCart({ accessories: [{ id: 'acc-1', qty: 2 }] });
    const spy = vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ accessoryLines: [SLEEVES] }));
    render();
    const row = await screen.findByTestId('cart-accessory-acc-1');
    await user.click(within(row).getByRole('button', { name: 'Agregar una' }));
    await waitFor(() =>
      expect(spy.mock.calls.some(([, , , e]) => e?.accessoryLines?.[0]?.quantity === 3)).toBe(true),
    );
    expect(cart().accessories).toEqual([{ id: 'acc-1', qty: 3 }]);
  });
});

describe('AC-F18 · avisos de la cotización (el carrito se corrige solo)', () => {
  it('inactive con nombre ⇒ se quita y el aviso lo nombra; not_found (name null) ⇒ texto sin nombre', async () => {
    seedCart({ ids: ['inv-1002'], accessories: [{ id: 'acc-1', qty: 1 }, { id: 'acc-gone', qty: 1 }] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({
        unavailableAccessories: [
          { accessoryId: 'acc-1', name: 'Penny sleeves x100', reason: 'inactive' },
          { accessoryId: 'acc-gone', name: null, reason: 'not_found' },
        ],
      }),
    );
    render();
    expect(await screen.findByText('Penny sleeves x100 ya no está a la venta y lo quitamos de tu carrito.')).toBeInTheDocument();
    expect(screen.getByText('Un accesorio de tu carrito ya no está a la venta y lo quitamos.')).toBeInTheDocument();
    await waitFor(() => expect(cart().accessories).toEqual([]));
  });

  it('sold_out ⇒ se quita con aviso; insufficient ⇒ baja a availableQty con «Solo hay…»', async () => {
    seedCart({ accessories: [{ id: 'acc-1', qty: 5 }, { id: 'acc-2', qty: 1 }] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({
        accessoryLines: [{ ...SLEEVES, quantity: 2 }],
        unavailableAccessories: [
          { accessoryId: 'acc-1', name: 'Penny sleeves x100', reason: 'insufficient', availableQty: 2 },
          { accessoryId: 'acc-2', name: 'Toploader x25', reason: 'sold_out' },
        ],
      }),
    );
    render();
    expect(await screen.findByText('Solo hay 2 de Penny sleeves x100. Ajustamos la cantidad.')).toBeInTheDocument();
    expect(screen.getByText('Toploader x25 se agotó y lo quitamos de tu carrito.')).toBeInTheDocument();
    await waitFor(() => expect(cart().accessories).toEqual([{ id: 'acc-1', qty: 2 }]));
  });

  it('renglón del paquete: título, desglose por tipo (orden del enum), «Sueltas:» y foto de energies[].photo', async () => {
    seedCart({ ids: ['inv-1002'], deckPulls: [{ token: 'tok', slug: 'dragapult-ex', withEnergyBundle: true }] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({
        energyBundles: [
          bundle({
            energies: [
              { energyType: 'water', quantity: 4, accessoryId: 'acc-water', photo: photo('acc-water') },
              { energyType: 'fire', quantity: 8, accessoryId: 'acc-fire', photo: photo('acc-fire') },
            ],
          }),
        ],
      }),
    );
    render();
    const row = await screen.findByTestId('cart-bundle-dragapult-ex');
    expect(screen.getByText('PAQUETES DE ENERGÍAS')).toBeInTheDocument();
    expect(within(row).getByText('Paquete de energías — Dragapult ex')).toBeInTheDocument();
    expect(within(row).getByText('Fuego ×8 · Agua ×4')).toBeInTheDocument();
    expect(within(row).getByText(/Sueltas: .*60\.00/)).toBeInTheDocument();
    expect(within(row).getByText(/20\.00/)).toBeInTheDocument();
    // La miniatura es la de la energía con más cantidad (fuego), venida del servidor.
    expect(within(row).getByRole('img').getAttribute('src')).toBe(photo('acc-fire').thumbUrl);
    // Sin stepper: uno por deck.
    expect(within(row).queryByRole('group')).toBeNull();
  });

  it('AC-UX-6 (AC-F5) · deck_incomplete ⇒ el paquete sale del carrito CON aviso que nombra el deck', async () => {
    seedCart({
      ids: ['inv-1002'],
      deckPulls: [{ token: 'tok', slug: 'dragapult-ex', withEnergyBundle: true, deckName: 'Dragapult ex' }],
    });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({ unavailableBundles: [{ index: 0, withEnergyBundle: true, deckSlug: 'dragapult-ex', reason: 'deck_incomplete' }] }),
    );
    render();
    expect(
      await screen.findByText(
        'El paquete de energías de Dragapult ex salió del carrito: ya no están todas las cartas del deck.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('cart-bundle-dragapult-ex')).toBeNull();
    await waitFor(() => expect(cart().deckPulls).toEqual([]));
  });

  it('un deckPull sin paquete que se invalida se quita EN SILENCIO (no había nada que perder)', async () => {
    seedCart({ ids: ['inv-1002'], deckPulls: [{ token: 'tok', slug: 'dragapult-ex', withEnergyBundle: false, deckName: 'Dragapult ex' }] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({ unavailableBundles: [{ index: 0, withEnergyBundle: false, deckSlug: 'dragapult-ex', reason: 'deck_incomplete' }] }),
    );
    render();
    await waitFor(() => expect(cart().deckPulls).toEqual([]));
    expect(screen.queryByText(/salió del carrito/)).toBeNull();
  });
});

describe('AC-F5 · la oferta del paquete, una vez por deck', () => {
  it('«Agregar paquete» pone withEnergyBundle:true y la fila no vuelve; «No, gracias» también la retira', async () => {
    const user = userEvent.setup();
    seedCart({
      ids: ['inv-1002'],
      deckPulls: [
        { token: 'tok-a', slug: 'dragapult-ex', withEnergyBundle: false, deckName: 'Dragapult ex' },
        { token: 'tok-b', slug: 'gardevoir-ex', withEnergyBundle: false, deckName: 'Gardevoir ex' },
      ],
    });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({
        energyBundleOffers: [bundle(), bundle({ deckSlug: 'gardevoir-ex', deckName: 'Gardevoir ex' })],
      }),
    );
    render();
    const offer = await screen.findByRole('region', { name: /paquete de energías/i });
    expect(within(offer).getByText(/¿Agregas el paquete de energías de Dragapult ex\? 12 energías por .*20\.00 \(sueltas: .*60\.00\)\./)).toBeInTheDocument();
    const rows = within(offer).getAllByRole('button', { name: 'Agregar paquete' });
    await user.click(rows[0]);
    expect(cart().deckPulls.find((p: { slug: string }) => p.slug === 'dragapult-ex').withEnergyBundle).toBe(true);
    await user.click(within(offer).getAllByRole('button', { name: 'No, gracias' }).at(-1)!);
    expect(JSON.parse(window.localStorage.getItem('tcg.cart.bundleOfferSeen')!).slugs.sort()).toEqual(['dragapult-ex', 'gardevoir-ex']);
    await waitFor(() => expect(screen.queryByRole('region', { name: /paquete de energías/i })).toBeNull());
  });
});

describe('AC-UX-5 (AC-F4) · «¿Te falta algo?»', () => {
  it('no es modal, vive en la columna de renglones (no en el resumen), «Agregar» suma 1 y «No, gracias» lo oculta', async () => {
    const user = userEvent.setup();
    seedCart({ ids: ['inv-1002'], accessories: [{ id: 'acc-1', qty: 1 }] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ accessoryLines: [{ ...SLEEVES, quantity: 1, lineTotalCents: 8900 }] }));
    const sugg = vi.spyOn(api, 'getAccessorySuggestions').mockResolvedValue({
      items: [accCard({ id: 'acc-9', name: 'Deck box negra', priceCents: 15000 })],
    });
    render();
    const section = await screen.findByRole('region', { name: '¿Te falta algo?' });
    expect(sugg).toHaveBeenCalledWith(['acc-1']);
    expect(section.closest('[role="dialog"]')).toBeNull();
    expect(screen.getByRole('complementary').contains(section)).toBe(false);
    await user.click(within(section).getByRole('button', { name: 'Agregar Deck box negra al carrito' }));
    expect(cart().accessories).toEqual([
      { id: 'acc-1', qty: 1 },
      { id: 'acc-9', qty: 1 },
    ]);
    expect(within(section).getByRole('button', { name: /En el carrito/ })).toBeDisabled();
    await user.click(within(section).getByRole('button', { name: 'No, gracias' }));
    expect(screen.queryByRole('region', { name: '¿Te falta algo?' })).toBeNull();
  });

  it('con items: [] no hay sección (nunca recuadro vacío)', async () => {
    seedCart({ ids: ['inv-1002'] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote());
    const sugg = vi.spyOn(api, 'getAccessorySuggestions').mockResolvedValue({ items: [] });
    render();
    await screen.findByTestId('amount-breakdown');
    await waitFor(() => expect(sugg).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: '¿Te falta algo?' })).toBeNull();
  });
});

describe('AC-UX-8 (AC-F9) · el envío lo dice la cotización', () => {
  it('fila «Envío» = shippingFeeCents de la cotización; con caja: boxHint y ⛔ sin label; al cambiar: shippingChanged', async () => {
    const user = userEvent.setup();
    seedCart({ accessories: [{ id: 'acc-1', qty: 1 }] });
    let n = 0;
    vi.spyOn(api, 'getGuestCheckoutQuote').mockImplementation(async () => {
      n += 1;
      return n === 1
        ? guestQuote({
            accessoryLines: [{ ...SLEEVES, quantity: 1, lineTotalCents: 8900 }],
            breakdown: breakdownOf(8900, 20300, 30000),
            shippingBox: { code: 'CAJA-CHICA', label: 'Caja chica interna', review: false },
          })
        : guestQuote({
            accessoryLines: [{ ...SLEEVES, quantity: 2, lineTotalCents: 17800 }],
            breakdown: breakdownOf(17800, 25000, 44000),
            shippingBox: { code: 'CAJA-GRANDE', label: 'Caja grande interna', review: true },
          });
    });
    render();
    const breakdown = await screen.findByTestId('amount-breakdown');
    expect(within(breakdown).getByText(/203\.00/)).toBeInTheDocument();
    expect(screen.getByText('Calculado por el tamaño de la caja que necesita tu pedido.')).toBeInTheDocument();
    expect(screen.queryByText(/Caja chica interna|CAJA-CHICA/)).toBeNull();
    await user.click(within(screen.getByTestId('cart-accessory-acc-1')).getByRole('button', { name: 'Agregar una' }));
    expect(await screen.findByText(/El envío cambió a .*250\.00 por el tamaño de tu pedido\./)).toBeInTheDocument();
    // `review` nunca llega al cliente.
    expect(screen.queryByText(/REVISAR|Caja grande interna/)).toBeNull();
  });
});

describe('AC-UX-9 (AC-F8) · bóveda con accesorios', () => {
  async function chooseVault(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    const form = screen.getByRole('region', { name: 'DESTINO' });
    await user.click(within(form).getByRole('radio', { name: /Guardar en mi bóveda/ }));
  }

  it('vaultExcludesAccessories ⇒ aviso con {n} y {amount} de la cotización; los accesorios se quedan en el carrito', async () => {
    const user = userEvent.setup();
    seedCart({ ids: ['inv-1002'], accessories: [{ id: 'acc-1', qty: 2 }], deckPulls: [{ token: 't', slug: 'dragapult-ex', withEnergyBundle: true }] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({ items: [CARD_ITEM], accessoryLines: [SLEEVES], energyBundles: [bundle()], vaultExcludesAccessories: true }),
    );
    render();
    await chooseVault(user);
    const panel = await screen.findByTestId('vault-upsell');
    expect(within(panel).getByText('NO VAN A LA BÓVEDA')).toBeInTheDocument();
    // n = 2 sueltos + 1 paquete; amount = 178.00 + 20.00 (Σ de importes del servidor).
    expect(within(panel).getByText(/los accesorios \(3, .*198\.00\) no van en esta compra/)).toBeInTheDocument();
    expect(cart().accessories).toEqual([{ id: 'acc-1', qty: 2 }]);
  });

  it('carrito SOLO de accesorios: la opción «Guardar en mi bóveda» no se pinta', async () => {
    const user = userEvent.setup();
    seedCart({ accessories: [{ id: 'acc-1', qty: 1 }] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({ accessoryLines: [{ ...SLEEVES, quantity: 1 }], vaultExcludesAccessories: true }),
    );
    render();
    await user.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    expect(screen.queryByRole('radio', { name: /Guardar en mi bóveda/ })).toBeNull();
  });
});

describe('AC-F9 · F-SP-5: el importe del botón y del modal sale de la SESIÓN', () => {
  async function fillGuestForm(usr: ReturnType<typeof userEvent.setup>) {
    await usr.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
    await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
    await usr.type(screen.getByLabelText('Calle y número'), 'Av. Reforma 123');
    await usr.type(screen.getByLabelText('Código postal'), '06600');
    await screen.findByRole('option', { name: 'Juárez' });
    await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Juárez');
    await usr.type(screen.getByLabelText('Teléfono'), '5512345678');
    await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
  }

  it('sin sesión el botón no pinta importe; con sesión, el total de la sesión (≠ cotización) y lo manda todo', async () => {
    const usr = userEvent.setup();
    seedCart({
      ids: ['inv-1002'],
      accessories: [{ id: 'acc-1', qty: 2 }],
      deckPulls: [{ token: 'tok-d', slug: 'dragapult-ex', withEnergyBundle: true }],
    });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({ accessoryLines: [SLEEVES], energyBundles: [bundle()], breakdown: breakdownOf(19800, 17500, 38000) }),
    );
    const session = vi.spyOn(api, 'createGuestCheckoutSession').mockResolvedValue({
      orderId: 'ord-1',
      orderNumber: 'TCG-000200',
      breakdown: breakdownOf(19800, 17500, 38123),
      checkoutToken: 'tok',
      checkoutTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      stripe: { paymentIntentId: 'pi_1', clientSecret: 'cs_1' },
    });
    render();
    await fillGuestForm(usr);
    const aside = screen.getByRole('complementary');
    const pay = within(aside).getByRole('button', { name: /^Pagar/ });
    expect(pay.textContent).not.toMatch(/380\.00/);
    await usr.click(pay);
    await waitFor(() => expect(session).toHaveBeenCalled());
    expect(session.mock.calls[0][0]).toMatchObject({
      inventoryItemIds: ['inv-1002'],
      accessoryLines: [{ accessoryId: 'acc-1', quantity: 2 }],
      deckPulls: [{ pullToken: 'tok-d', withEnergyBundle: true }],
    });
    expect(await within(aside).findByRole('button', { name: /Pagar .*381\.23/ })).toBeInTheDocument();
  });

  it('409 ACCESSORY_INSUFFICIENT_STOCK: aviso «No se cobró nada» y la cantidad baja a availableQty', async () => {
    const usr = userEvent.setup();
    seedCart({ accessories: [{ id: 'acc-1', qty: 2 }] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ accessoryLines: [SLEEVES] }));
    vi.spyOn(api, 'createGuestCheckoutSession').mockRejectedValue(
      new ApiClientError(409, { code: 'ACCESSORY_INSUFFICIENT_STOCK', message: 'x', details: { accessoryId: 'acc-1', availableQty: 1 } }),
    );
    render();
    await fillGuestForm(usr);
    await usr.click(within(screen.getByRole('complementary')).getByRole('button', { name: /^Pagar/ }));
    expect(
      await screen.findByText('Ya no hay suficientes Penny sleeves x100: quedan 1. No se cobró nada. Ajustamos la cantidad: revisa y vuelve a pagar.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(cart().accessories).toEqual([{ id: 'acc-1', qty: 1 }]));
  });

  it('422 ENERGY_BUNDLE_INVALID: aviso con el deck y el paquete sale del carrito', async () => {
    const usr = userEvent.setup();
    seedCart({ ids: ['inv-1002'], deckPulls: [{ token: 'tok-d', slug: 'dragapult-ex', withEnergyBundle: true, deckName: 'Dragapult ex' }] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ energyBundles: [bundle()] }));
    vi.spyOn(api, 'createGuestCheckoutSession').mockRejectedValue(
      new ApiClientError(422, { code: 'ENERGY_BUNDLE_INVALID', message: 'x', details: { deckSlug: 'dragapult-ex', reason: 'deck_incomplete' } }),
    );
    render();
    await fillGuestForm(usr);
    await usr.click(within(screen.getByRole('complementary')).getByRole('button', { name: /^Pagar/ }));
    const alert = await screen.findByText(/El paquete de energías de Dragapult ex ya no se puede pagar\. No se cobró nada\./);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    await waitFor(() => expect(cart().deckPulls).toEqual([]));
  });
});

describe('AC-F21 (v1.86.3, §AC.19.4) · el carrito se corrige por `index` de unavailableBundles', () => {
  const A = { token: 'tok-a', slug: 'charizard-ex', withEnergyBundle: false, deckName: 'Charizard ex' };
  const B = { token: 'tok-b-roto', slug: 'dragapult-ex', withEnergyBundle: true, deckName: 'Dragapult ex' };

  it('dos deckPulls e invalid_token en index 1 (deckSlug null) ⇒ sale SOLO el segundo, con aviso (llevaba paquete)', async () => {
    seedCart({ ids: ['inv-1002'], deckPulls: [A, B] });
    // ⚠️ A no aparece en energyBundles ni en energyBundleOffers: la heurística «el que la respuesta no nombra» lo
    // quitaría también. Con `index` solo sale B.
    // La re-cotización (carrito ya corregido) llega limpia: un mock fijo volvería a señalar la MISMA posición.
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote()).mockResolvedValueOnce(
      guestQuote({ unavailableBundles: [{ index: 1, withEnergyBundle: true, deckSlug: null, reason: 'invalid_token' }] }),
    );
    render();
    await waitFor(() => expect(cart().deckPulls.map((p: { slug: string }) => p.slug)).toEqual(['charizard-ex']));
    expect(await screen.findByText(/salió del carrito/)).toBeInTheDocument();
  });

  it('invalid_token en index 0 sin paquete ⇒ sale el primero EN SILENCIO; el segundo se queda', async () => {
    seedCart({ ids: ['inv-1002'], deckPulls: [A, B] });
    // La re-cotización (carrito ya corregido) llega limpia: un mock fijo volvería a señalar la MISMA posición.
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote()).mockResolvedValueOnce(
      guestQuote({ unavailableBundles: [{ index: 0, withEnergyBundle: false, deckSlug: null, reason: 'invalid_token' }] }),
    );
    render();
    await waitFor(() => expect(cart().deckPulls.map((p: { slug: string }) => p.slug)).toEqual(['dragapult-ex']));
    expect(screen.queryByText(/salió del carrito/)).toBeNull();
  });

  it('el aviso lo decide `withEnergyBundle` de la respuesta (aunque el carrito local diga otra cosa)', async () => {
    seedCart({ ids: ['inv-1002'], deckPulls: [A, { ...B, token: 'tok-b' }] });
    // La re-cotización (carrito ya corregido) llega limpia: un mock fijo volvería a señalar la MISMA posición.
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote()).mockResolvedValueOnce(
      guestQuote({ unavailableBundles: [{ index: 0, withEnergyBundle: true, deckSlug: 'charizard-ex', reason: 'deck_incomplete' }] }),
    );
    render();
    expect(
      await screen.findByText('El paquete de energías de Charizard ex salió del carrito: ya no están todas las cartas del deck.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(cart().deckPulls.map((p: { slug: string }) => p.slug)).toEqual(['dragapult-ex']));
  });

  it('422 ENERGY_BUNDLE_INVALID {index, deckSlug:null}: sale el deckPull de esa posición entre los que se mandaron', async () => {
    const usr = userEvent.setup();
    const C = { token: 'tok-c-roto', slug: 'gardevoir-ex', withEnergyBundle: true, deckName: 'Gardevoir ex' };
    // La sesión manda SOLO los que llevan paquete: [B, C] ⇒ index 1 = C.
    seedCart({ ids: ['inv-1002'], deckPulls: [A, { ...B, token: 'tok-b' }, C] });
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ energyBundles: [bundle()] }));
    const post = vi.spyOn(api, 'createGuestCheckoutSession').mockRejectedValue(
      new ApiClientError(422, { code: 'ENERGY_BUNDLE_INVALID', message: 'x', details: { index: 1, deckSlug: null, reason: 'invalid_token' } }),
    );
    render();
    await fillGuestForm(usr);
    await usr.click(within(screen.getByRole('complementary')).getByRole('button', { name: /^Pagar/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0].deckPulls).toEqual([
      { pullToken: 'tok-b', withEnergyBundle: true },
      { pullToken: 'tok-c-roto', withEnergyBundle: true },
    ]);
    expect(await screen.findByText(/El paquete de energías de Gardevoir ex ya no se puede pagar\. No se cobró nada\./)).toBeInTheDocument();
    await waitFor(() => expect(cart().deckPulls.map((p: { slug: string }) => p.slug)).toEqual(['charizard-ex', 'dragapult-ex']));
  });

  async function fillGuestForm(usr: ReturnType<typeof userEvent.setup>) {
    await usr.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
    await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
    await usr.type(screen.getByLabelText('Calle y número'), 'Av. Reforma 123');
    await usr.type(screen.getByLabelText('Código postal'), '06600');
    await screen.findByRole('option', { name: 'Juárez' });
    await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Juárez');
    await usr.type(screen.getByLabelText('Teléfono'), '5512345678');
    await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
  }
});

// Tipado: que el testkit produzca la forma del contrato.
export const _shape: GuestCheckoutQuoteResponse = guestQuote();

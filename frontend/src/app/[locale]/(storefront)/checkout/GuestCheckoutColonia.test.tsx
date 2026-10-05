import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import type { GuestCheckoutSessionResponse } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

// La session se mockea para dictar el `422`; el quote y `GET /geo/postal-codes/:cp` van por la rama mock real.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, createGuestCheckoutSession: vi.fn(), getPostalCode: vi.fn(actual.getPostalCode) };
});

import { createGuestCheckoutSession, getPostalCode } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { GuestCheckoutView } from './GuestCheckoutView';
import { FIELD_ID, FIELD_ORDER } from './GuestCheckoutForm';
import { clearUnavailableNotice } from './unavailable-notice';

function seedCart(ids: string[]) {
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids, updatedAt: Date.now() }));
}

function guestSession(): GuestCheckoutSessionResponse {
  return {
    orderId: 'ord-g-1',
    orderNumber: 'TCG-000123',
    breakdown: { subtotalCents: 1000, shippingFeeCents: 17500, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 0, totalCents: 18660, currency: 'MXN', priceConvention: 'IVA_EXCLUSIVE', ivaIncluded: false },
    checkoutToken: 'tok-first',
    checkoutTokenExpiresAt: new Date(Date.now() + 120 * 60_000).toISOString(),
    stripe: { paymentIntentId: 'pi_g1', clientSecret: 'pi_g1_secret' },
    reused: false,
    reservedUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
    supersededOrderIds: [],
  };
}

async function fillGuestForm(usr: ReturnType<typeof userEvent.setup>, cp = '44100') {
  await usr.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
  await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
  await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
  await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
  await usr.type(screen.getByLabelText('Calle y número'), 'Av. Vallarta 1234');
  await usr.type(screen.getByLabelText('Código postal'), cp);
  await usr.type(screen.getByLabelText('Teléfono'), '3312345678');
  await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearUnavailableNotice();
  vi.mocked(createGuestCheckoutSession).mockReset();
  seedCart(['inv-1002']);
});

/**
 * Fase C en el checkout de invitado con la colonia como Mercado Libre (v1.80.12.5 `§M4-SHIP.19.25`,
 * `HECHOS.md:57`, `DESIGN_SYSTEM §43.18m`): colonia obligatoria como texto, de la lista o escrita; con lista,
 * municipio y estado del CP; sin lista, los tres se escriben. ⛔ Ningún `422` geográfico: la tienda nunca
 * deja de vender por el catálogo.
 */
describe('checkout de invitado · colonia de lista por CP (v1.81)', () => {
  it('sin colonia el pago no sale; con la colonia de la lista la session lleva colonia, municipio y estado DEL CP', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(guestSession());
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);
    expect(screen.queryByLabelText('Municipio o alcaldía')).toBeNull();
    expect(screen.queryByLabelText('Estado')).toBeNull();
    await screen.findByRole('option', { name: 'Guadalajara Centro' });
    expect(getPostalCode).toHaveBeenCalledWith('44100');

    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(createGuestCheckoutSession).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Elige tu colonia de la lista; si no aparece, usa «Mi colonia no está»\./).length).toBeGreaterThan(0);

    await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Guadalajara Centro');
    expect(screen.getByTestId('address-city-state')).toHaveTextContent('Municipio y estado: Guadalajara, Jalisco (salen del CP).');
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(createGuestCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createGuestCheckoutSession).mock.calls[0][0].shippingAddress).toMatchObject({
      neighborhood: 'Guadalajara Centro',
      city: 'Guadalajara',
      state: 'Jalisco',
      postalCode: '44100',
      country: 'MX',
    });
  });

  it('UX-ADR-1 / PS-114 · CP fuera del catálogo ⇒ escribe colonia, municipio y estado y la session SALE con lo tecleado', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(guestSession());
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr, '20000');
    expect(await screen.findByTestId('address-geo-intro')).toHaveTextContent(
      'No tenemos la lista de colonias del CP 20000. Si está bien escrito, escribe tu colonia, municipio y estado: los revisamos antes de enviar.',
    );
    expect(screen.queryByText(/soporte@tcghunt\.mx/)).toBeNull();
    expect(screen.getByLabelText('Código postal')).not.toHaveAttribute('aria-invalid');
    // Sin colonia, municipio ni estado: el pago no sale y el resumen nombra los tres, en el orden del DOM.
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(createGuestCheckoutSession).not.toHaveBeenCalled();
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[role="alert"] a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(expect.arrayContaining(['#guest-neighborhood', '#guest-city', '#guest-state']));
    expect(links.indexOf('#guest-neighborhood')).toBeLessThan(links.indexOf('#guest-city'));
    expect(links.indexOf('#guest-city')).toBeLessThan(links.indexOf('#guest-state'));
    // `fireEvent.change` y no `usr.type`: tras un intento fallido el resumen de errores toma el foco cada vez
    // que cambia el NÚMERO de errores (`GuestCheckoutForm.tsx`, efecto del resumen; conducta anterior a este
    // cambio, anotada en FRONTEND_NOTES §90) y `usr.type` seguiría tecleando en el resumen.
    fireEvent.change(screen.getByRole('textbox', { name: 'Colonia' }), { target: { value: 'Zona Centro' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Municipio o alcaldía' }), { target: { value: 'Aguascalientes' } });
    await usr.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'Aguascalientes');
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(createGuestCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createGuestCheckoutSession).mock.calls[0][0].shippingAddress).toMatchObject({
      postalCode: '20000',
      neighborhood: 'Zona Centro',
      city: 'Aguascalientes',
      state: 'Aguascalientes',
      country: 'MX',
    });
  });

  it('UX-ADR-8 · CP con lista + «Mi colonia no está» ⇒ la session lleva la escrita con municipio y estado DEL CP', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(guestSession());
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr, '44100');
    await screen.findByRole('option', { name: 'Americana' });
    await usr.click(screen.getByRole('button', { name: 'Mi colonia no está' }));
    const input = screen.getByRole('textbox', { name: 'Colonia' });
    expect(input).toHaveFocus();
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(createGuestCheckoutSession).not.toHaveBeenCalled();
    expect(screen.getAllByText('Escribe el nombre de tu colonia.').length).toBeGreaterThan(0);
    fireEvent.change(input, { target: { value: 'Fracc. Los Pinos' } });
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(createGuestCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createGuestCheckoutSession).mock.calls[0][0].shippingAddress).toMatchObject({
      postalCode: '44100',
      neighborhood: 'Fracc. Los Pinos',
      city: 'Guadalajara',
      state: 'Jalisco',
    });
  });

  it('§43.18m.7 · `400 {field:neighborhood, max:120}` de la session ⇒ «Hasta 120 caracteres» bajo la colonia', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockRejectedValue(
      new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'neighborhood', max: 120 } }),
    );
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr, '44100');
    await screen.findByRole('option', { name: 'Americana' });
    await usr.click(screen.getByRole('button', { name: 'Mi colonia no está' }));
    await usr.type(screen.getByRole('textbox', { name: 'Colonia' }), 'x'.repeat(121));
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(await screen.findByText('Hasta 120 caracteres: acórtalo.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Colonia' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('UX-ADR-2 · CP con una sola colonia ⇒ ya elegida, y la session la lleva sin tocar el select', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(guestSession());
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr, '06600');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Colonia' })).toHaveValue('Juárez'));
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(createGuestCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createGuestCheckoutSession).mock.calls[0][0].shippingAddress).toMatchObject({
      neighborhood: 'Juárez',
      postalCode: '06600',
    });
  });

  it('UX-ADR-2 · con dos colonias: orden alfabético y placeholder (sin preselección)', async () => {
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr, '44100');
    await screen.findByRole('option', { name: 'Americana' });
    const colonia = screen.getByRole('combobox', { name: 'Colonia' });
    expect(Array.from((colonia as HTMLSelectElement).options).map((o) => o.value)).toEqual(['', 'Americana', 'Guadalajara Centro']);
    expect(colonia).toHaveValue('');
    // §43.18m.2: la salida es un botón «Mi colonia no está», ⛔ no un «Escríbenos».
    expect(screen.getByRole('button', { name: 'Mi colonia no está' })).toHaveAttribute('type', 'button');
    expect(screen.queryByText(/soporte@tcghunt\.mx/)).toBeNull();
  });

  it('UX-ADR-5 · referencias antes que teléfono en el DOM, y FIELD_ORDER sigue el orden del DOM', async () => {
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await usr.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    // CP fuera del catálogo ⇒ «todo a mano»: municipio y estado existen y van tras la colonia (FC-23).
    await usr.type(screen.getByLabelText('Código postal'), '20000');
    await screen.findByRole('textbox', { name: 'Municipio o alcaldía' });
    const refs = screen.getByLabelText('Referencias para el repartidor (opcional)');
    const tel = document.querySelector('input[type="tel"]')!;
    expect(refs.compareDocumentPosition(tel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // El teléfono del invitado lleva la MISMA ayuda que la libreta (§43.18i).
    expect(tel).toHaveAccessibleDescription('10 dígitos. Solo lo usa la paquetería, si necesita llamar para entregar.');
    // Grupo «Envío» (§43.18b). La casilla de lectura del correo vive en otro grupo: no entra en esta cuenta.
    const shippingIds = FIELD_ORDER.slice(FIELD_ORDER.indexOf('recipientName'), FIELD_ORDER.indexOf('terms')).map(
      (f) => FIELD_ID[f],
    );
    expect(shippingIds).toContain('guest-references');
    const domOrder = Array.from(document.querySelectorAll<HTMLElement>('[id^="guest-"]'))
      .map((el) => el.id)
      .filter((id) => shippingIds.includes(id));
    expect(domOrder).toEqual(shippingIds);
    expect(domOrder.indexOf('guest-references')).toBeLessThan(domOrder.indexOf('guest-phone'));
  });
});

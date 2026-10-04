import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
 * Fase C (`API_CONTRACT §M4-SHIP.19.5`, criterio 235) en el checkout de invitado: la colonia es
 * obligatoria y DE LA LISTA del CP; municipio y estado salen del CP; los `422` de colonia/CP se pintan
 * bajo su campo (cero órdenes creadas).
 */
describe('checkout de invitado · colonia de lista por CP (v1.81)', () => {
  it('sin colonia el pago no sale; con la colonia de la lista la session lleva colonia, municipio y estado DEL CP', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(guestSession());
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);
    expect(screen.queryByLabelText('Ciudad')).toBeNull();
    expect(screen.queryByLabelText('Estado')).toBeNull();
    await screen.findByRole('option', { name: 'Guadalajara Centro' });
    expect(getPostalCode).toHaveBeenCalledWith('44100');

    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(createGuestCheckoutSession).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Elige la colonia de la lista del CP\./).length).toBeGreaterThan(0);

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

  it('422 NEIGHBORHOOD_NOT_IN_POSTAL_CODE ⇒ aviso bajo la colonia y la lista pasa a ser `allowed`', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockRejectedValue(
      new ApiClientError(422, {
        code: 'NEIGHBORHOOD_NOT_IN_POSTAL_CODE',
        message: 'x',
        details: { postalCode: '44100', allowed: ['Guadalajara Centro', 'Mexicaltzingo'] },
      }),
    );
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);
    await screen.findByRole('option', { name: 'Americana' });
    await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Americana');
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(
      await screen.findByText('Esa colonia no es del CP 44100. No se guardó nada: elige una de la lista.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Mexicaltzingo' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Colonia' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('UX-ADR-1 · CP fuera del catálogo ⇒ bajo el CP «Revisa…» y «escríbenos a soporte@tcghunt.mx»; colonia apagada', async () => {
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr, '99999');
    expect(
      await screen.findByText(
        'No encontramos el CP 99999 en nuestro catálogo y sin él no podemos enviar. Revisa que esté bien escrito; si es correcto, escríbenos a soporte@tcghunt.mx con tu CP.',
      ),
    ).toBeInTheDocument();
    const colonia = screen.getByRole('combobox', { name: 'Colonia' });
    expect(colonia).toBeDisabled();
    expect(colonia).toHaveAccessibleDescription(/Sin colonias: este CP no está en el catálogo\./);
    expect(screen.queryByTestId('neighborhood-not-listed')).toBeNull();
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
    expect(screen.getByTestId('neighborhood-not-listed')).toHaveTextContent(/Escríbenos a soporte@tcghunt\.mx/);
  });

  it('UX-ADR-5 · referencias antes que teléfono en el DOM, y FIELD_ORDER sigue el orden del DOM', async () => {
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await usr.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
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

  it('422 POSTAL_CODE_UNKNOWN de la session ⇒ aviso bajo el CP', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockRejectedValue(
      new ApiClientError(422, { code: 'POSTAL_CODE_UNKNOWN', message: 'x', details: { postalCode: '44100' } }),
    );
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);
    await screen.findByRole('option', { name: 'Guadalajara Centro' });
    await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Guadalajara Centro');
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(
      await screen.findByText(
        'No encontramos el CP 44100 en nuestro catálogo y sin él no podemos enviar. Revisa que esté bien escrito; si es correcto, escríbenos a soporte@tcghunt.mx con tu CP.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Código postal')).toHaveAttribute('aria-invalid', 'true');
    // Junto al botón: el error remite al campo, ⛔ sin repetir el correo (el remedio vive UNA vez).
    const nearButton = screen.getByText(/Ese código postal no está en nuestro catálogo y no se guardó nada\./);
    expect(nearButton).not.toHaveTextContent('soporte@tcghunt.mx');
    expect(screen.getAllByText(/soporte@tcghunt\.mx con tu CP\./)).toHaveLength(1);
  });
});

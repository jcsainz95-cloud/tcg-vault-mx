import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api';
import type { AddressDTO, UserDTO } from '@/types/contract';
import { setStoredUser } from '@/lib/session';

// useSearchParams: sin ?item= (selección arranca vacía).
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

// Link de i18n (deep-link al detalle del retiro) → <a> simple en el test.
const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Módulo de API real (rama mock) salvo createShipment, que controlamos para el caso 403.
// vi.hoisted: la fábrica de vi.mock se iza al top, así que el mock debe crearse con hoisted.
const { createShipmentMock } = vi.hoisted(() => ({ createShipmentMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, createShipment: createShipmentMock };
});

import { ShipmentsView } from './ShipmentsView';

beforeEach(() => {
  vi.restoreAllMocks();
  createShipmentMock.mockReset();
  routerPush.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/** Dirección MX del picker; `recipientName: null` = fila anterior a M-52 (contrato v1.67). */
function address(recipientName: string | null): AddressDTO {
  return {
    id: 'addr-old',
    recipientName,
    line1: 'Calle Falsa 123',
    city: 'Guadalajara',
    state: 'JAL',
    postalCode: '44100',
    country: 'MX',
    phone: '3331234567',
    isDefault: true,
  };
}

function asCustomer(overrides: Partial<UserDTO> = {}) {
  setStoredUser({
    id: 'u-777',
    email: 'ash@example.com',
    name: 'Ash Ketchum',
    role: 'customer',
    locale: 'es',
    emailVerified: true,
    ...overrides,
  });
}

describe('ShipmentsView · estado del botón de retiro (WS-F · F3)', () => {
  it('el botón se habilita solo con dirección (auto-default MX) + al menos un ítem', async () => {
    renderWithProviders(<ShipmentsView />, 'es');

    // Espera a que carguen holdings (checkbox de una carta settled) y la dirección default.
    const blastoise = await screen.findByText('Blastoise');
    await screen.findByText(/Av\. Reforma 222/);

    const button = screen.getByRole('button', { name: 'Pagar envío y solicitar' });
    // Con dirección auto-seleccionada pero sin ítems → deshabilitado.
    expect(button).toBeDisabled();

    // Selecciona la carta settled → habilitado.
    const row = blastoise.closest('label')!;
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('un 403 EMAIL_NOT_VERIFIED muestra el banner de verificación (no un error genérico)', async () => {
    createShipmentMock.mockRejectedValue(
      new ApiClientError(403, { code: 'EMAIL_NOT_VERIFIED', message: 'verify email' }),
    );
    renderWithProviders(<ShipmentsView />, 'es');

    const blastoise = await screen.findByText('Blastoise');
    await screen.findByText(/Av\. Reforma 222/);
    const checkbox = blastoise.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    const button = screen.getByRole('button', { name: 'Pagar envío y solicitar' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    // El banner de verificación (verifyEmail.blockedTitle) aparece; createShipment fue llamado.
    await screen.findByText('Verifica tu correo para completar esta acción');
    expect(createShipmentMock).toHaveBeenCalledWith(['inv-1002'], 'addr-1');
  });
});

/**
 * §33.4 — /shipments es SOLO la pantalla de solicitar: las listas «Mis retiros» y «Mis disputas»
 * viven en la pestaña «Retiros» de la bóveda (`vault/WithdrawalsList`, con sus tests).
 */
describe('ShipmentsView · solo solicitar (§33.4)', () => {
  it('no lista retiros ni disputas; título «Solicitar retiro» y vuelta «← Mi bóveda» a /vault?tab=retiros', async () => {
    const own = vi.spyOn(api, 'getShipments');
    const disputes = vi.spyOn(api, 'getDisputes');
    renderWithProviders(<ShipmentsView />, 'es');
    await screen.findByText('Blastoise');

    expect(screen.getByRole('heading', { level: 1, name: 'Solicitar retiro' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mi bóveda/ })).toHaveAttribute('href', '/vault?tab=retiros');
    expect(screen.queryByRole('heading', { name: 'Mis retiros' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mis disputas' })).not.toBeInTheDocument();
    expect(own).not.toHaveBeenCalled();
    expect(disputes).not.toHaveBeenCalled();
  });
});

/**
 * F10 · §33.10b (contrato v1.67, M-52): ningún envío sale sin destinatario. Con una dirección sin
 * `recipientName` el CTA queda deshabilitado con motivo, se captura el nombre INLINE, se guarda
 * con `PATCH /users/me/addresses/:id` y la cotización se pide sola. Si el servidor responde
 * `422 RECIPIENT_NAME_REQUIRED`, se abre la misma captura para ESA dirección.
 */
describe('ShipmentsView · destinatario del envío (F10)', () => {
  it('dirección sin destinatario: CTA deshabilitado con motivo, sin pedir cotización; «Envío a:» ausente', async () => {
    asCustomer();
    vi.spyOn(api, 'listAddresses').mockResolvedValue([address(null)]);
    const quote = vi.spyOn(api, 'getShipmentQuote');
    renderWithProviders(<ShipmentsView />, 'es');

    const blastoise = await screen.findByText('Blastoise');
    await screen.findByText(/Calle Falsa 123/);
    fireEvent.click(blastoise.closest('label')!.querySelector('input[type="checkbox"]')!);

    const capture = await screen.findByTestId('recipient-capture');
    expect(within(capture).getByText('Completa el nombre de quien recibe en la dirección elegida para continuar.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Pagar envío y solicitar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-describedby', 'recipient-required');
    expect(screen.queryByTestId('ship-to')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(quote).not.toHaveBeenCalled();
  });

  it('con `nameSource=derived` el campo nace VACÍO (nunca se propone el nombre fabricado)', async () => {
    asCustomer({ name: 'jcsainz95', nameSource: 'derived' });
    vi.spyOn(api, 'listAddresses').mockResolvedValue([address(null)]);
    renderWithProviders(<ShipmentsView />, 'es');
    await screen.findByText(/Calle Falsa 123/);

    const input = (await screen.findByLabelText('Nombre de quien recibe')) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('con `nameSource=user` se propone `user.name` (editable)', async () => {
    asCustomer({ name: 'Ash Ketchum', nameSource: 'user' });
    vi.spyOn(api, 'listAddresses').mockResolvedValue([address(null)]);
    renderWithProviders(<ShipmentsView />, 'es');
    await screen.findByText(/Calle Falsa 123/);

    const input = (await screen.findByLabelText('Nombre de quien recibe')) as HTMLInputElement;
    expect(input.value).toBe('Ash Ketchum');
  });

  it('guardar el nombre → PATCH de la dirección, la cotización se pide sola, «Envío a:» y CTA habilitado', async () => {
    asCustomer({ nameSource: 'derived' });
    const list = vi.spyOn(api, 'listAddresses').mockResolvedValue([address(null)]);
    const patch = vi.spyOn(api, 'updateAddress').mockImplementation(async (_id, input) => {
      const saved = address(input.recipientName ?? null);
      list.mockResolvedValue([saved]);
      return saved;
    });
    const quote = vi.spyOn(api, 'getShipmentQuote');
    renderWithProviders(<ShipmentsView />, 'es');

    const blastoise = await screen.findByText('Blastoise');
    await screen.findByText(/Calle Falsa 123/);
    fireEvent.click(blastoise.closest('label')!.querySelector('input[type="checkbox"]')!);

    const input = await screen.findByLabelText('Nombre de quien recibe');
    fireEvent.change(input, { target: { value: '  Misty Waterflower ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('addr-old', { recipientName: 'Misty Waterflower' }));
    // Con el nombre guardado: la captura desaparece, la cotización se pide y el CTA se habilita.
    await waitFor(() => expect(screen.queryByTestId('recipient-capture')).not.toBeInTheDocument());
    await waitFor(() => expect(quote).toHaveBeenCalledWith(['inv-1002'], 'addr-old'));
    expect(await screen.findByTestId('ship-to')).toHaveTextContent('Envío a: Misty Waterflower · Guadalajara, JAL');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pagar envío y solicitar' })).not.toBeDisabled());
  });

  it('422 RECIPIENT_NAME_REQUIRED al crear (DTO con nombre pero el servidor dice que falta) abre la captura', async () => {
    asCustomer();
    vi.spyOn(api, 'listAddresses').mockResolvedValue([address('Ash Ketchum')]);
    createShipmentMock.mockRejectedValue(
      new ApiClientError(422, {
        code: 'RECIPIENT_NAME_REQUIRED',
        message: 'recipient required',
        details: { field: 'recipientName', addressId: 'addr-old' },
      }),
    );
    renderWithProviders(<ShipmentsView />, 'es');

    const blastoise = await screen.findByText('Blastoise');
    await screen.findByText(/Calle Falsa 123/);
    fireEvent.click(blastoise.closest('label')!.querySelector('input[type="checkbox"]')!);
    const button = screen.getByRole('button', { name: 'Pagar envío y solicitar' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    expect(await screen.findByTestId('recipient-capture')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Completa el nombre de quien recibe');
    expect(button).toBeDisabled();
    expect(createShipmentMock).toHaveBeenCalledWith(['inv-1002'], 'addr-old');
  });

  it('tras pagar navega a /vault?tab=retiros y deja la marca de «Retiro solicitado»', async () => {
    asCustomer();
    vi.spyOn(api, 'listAddresses').mockResolvedValue([address('Ash Ketchum')]);
    createShipmentMock.mockResolvedValue({
      shipmentId: 'shp-new',
      status: 'solicitado',
      breakdown: { subtotalCents: 17500, ivaCents: 2800, ivaRatePct: 16, processingFeeCents: 0, totalCents: 20300, currency: 'MXN' },
      stripe: { paymentIntentId: 'pi_x', clientSecret: 'pi_x_secret_mock' },
    });
    renderWithProviders(<ShipmentsView />, 'es');

    const blastoise = await screen.findByText('Blastoise');
    await screen.findByText(/Calle Falsa 123/);
    fireEvent.click(blastoise.closest('label')!.querySelector('input[type="checkbox"]')!);
    const button = screen.getByRole('button', { name: 'Pagar envío y solicitar' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    const modal = await screen.findByRole('dialog', { name: 'Pagar envío' });
    fireEvent.click(within(modal).getByRole('button', { name: /Pagar/ }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/vault?tab=retiros'));
    expect(window.sessionStorage.getItem('tcg.vault.withdrawalRequested')).toBe('1');
  });
});

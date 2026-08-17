import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistKycForm } from './BuylistKycForm';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock-ine');
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const RAW_ITEMS = [{ cardId: 'c-charizard', productType: 'raw' as const, rawCondition: 'NM' as const }];

describe('BuylistKycForm — cableado KYC/INE del buylist (contrato §6/§8)', () => {
  it('renderiza CLABE, los dos slots de INE (anverso/reverso) y el aviso de privacidad', () => {
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    expect(screen.getByLabelText(/CLABE/)).toBeInTheDocument();
    expect(screen.getByText('INE (anverso)')).toBeInTheDocument();
    expect(screen.getByText('INE (reverso)')).toBeInTheDocument();
    expect(screen.getByText(/se guarda cifrado/)).toBeInTheDocument();
  });

  it('valida la CLABE en cliente (18 dígitos) y no llama al backend si es inválida', () => {
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    expect(screen.getByText('La CLABE debe tener 18 dígitos.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('con CLABE válida crea la solicitud con TODOS los items del carrito y reporta el id', async () => {
    const onCreated = vi.fn();
    const spy = vi.spyOn(api, 'createSellRequest');
    // Carrito expandido por cantidad: 2 Charizard + 1 Pikachu.
    const items = [
      { cardId: 'c-charizard', productType: 'raw' as const, rawCondition: 'NM' as const },
      { cardId: 'c-charizard', productType: 'raw' as const, rawCondition: 'NM' as const },
      { cardId: 'c-pikachu', productType: 'raw' as const, rawCondition: 'NM' as const },
    ];
    renderWithProviders(<BuylistKycForm items={items} onCreated={onCreated} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // El payload lleva los 3 items (sin precio/categoría; solo cardId/productType/rawCondition).
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ clabe: '002010077777777771', items }),
    );
  });

  it('mapea 422 INE_REQUIRED a la petición de subir el INE', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, { code: 'INE_REQUIRED', message: 'INE required' }),
    );
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() =>
      expect(screen.getAllByText(/sube tu INE/).length).toBeGreaterThan(0),
    );
  });

  it('mapea 403 EMAIL_NOT_VERIFIED al aviso accionable con CTA de reenvío (no error genérico)', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(403, { code: 'EMAIL_NOT_VERIFIED', message: 'Email must be verified' }),
    );
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    expect(
      await screen.findByText('Verifica tu correo para completar esta acción'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reenviar correo de verificación' }),
    ).toBeInTheDocument();
  });

  it('mapea 422 BUYLIST_LIMIT_EXCEEDED usando el tope real de details.capCents', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, {
        code: 'BUYLIST_LIMIT_EXCEEDED',
        message: 'cap exceeded',
        details: { scope: 'per_request', capCents: 300000, wouldBeCents: 500000 },
      }),
    );
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    expect(
      await screen.findByText(/Esta solicitud supera tu tope permitido \(MX\$3,000\.00\)/),
    ).toBeInTheDocument();
  });

  it('un código no mapeado cae al catálogo error.* del contrato (FINISH_NOT_AVAILABLE)', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, { code: 'FINISH_NOT_AVAILABLE', message: 'finish not available' }),
    );
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    expect(
      await screen.findByText('Ese acabado no está disponible para esta carta.'),
    ).toBeInTheDocument();
  });
});

/**
 * Gating proactivo dentro del modal (segundo cinturón; el primero vive en BuylistView):
 * sesión sin verificar bloquea el submit ANTES del 403 y los heads-up de KYC
 * (ineExpected / clabeMasked) se muestran de entrada.
 */
describe('BuylistKycForm — gating proactivo de cuenta/KYC', () => {
  it('con sesión emailVerified=false el submit queda deshabilitado y el aviso con reenvío aparece de entrada', () => {
    setStoredUser({
      id: 'u-777',
      email: 'ash@example.com',
      name: 'Ash Ketchum',
      role: 'customer',
      locale: 'es',
      emailVerified: false,
    });
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');

    const submit = screen.getByRole('button', { name: 'Confirmar y enviar' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Verifica tu correo para enviar tu solicitud.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reenviar correo de verificación' }),
    ).toBeInTheDocument();
    fireEvent.click(submit);
    expect(spy).not.toHaveBeenCalled();
  });

  it('ineExpected=true muestra la petición de INE de entrada (sin esperar al 422)', () => {
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} ineExpected />,
      'es',
    );
    expect(
      screen.getByText('Esta solicitud supera el tope: sube tu INE (anverso y reverso) para continuar.'),
    ).toBeInTheDocument();
  });

  it('con CLABE en archivo arranca en modo "usar mi CLABE" y permite cambiar a capturar otra', () => {
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} clabeMasked="****1234" />,
      'es',
    );
    // Por defecto se reusa la CLABE registrada: sin input de 18 dígitos.
    expect(screen.getByText('El pago irá a tu CLABE registrada (****1234).')).toBeInTheDocument();
    expect(screen.queryByLabelText(/CLABE \(18 dígitos/)).not.toBeInTheDocument();

    // "Usar otra CLABE" revela la captura, con el hint de la registrada.
    fireEvent.click(screen.getByRole('button', { name: 'Usar otra CLABE' }));
    expect(screen.getByLabelText(/CLABE \(18 dígitos/)).toBeInTheDocument();
    expect(screen.getByText(/Ya tienes una CLABE registrada \(\*\*\*\*1234\)/)).toBeInTheDocument();

    // Y se puede volver al atajo en un clic.
    fireEvent.click(screen.getByRole('button', { name: 'Usar mi CLABE ****1234' }));
    expect(screen.queryByLabelText(/CLABE \(18 dígitos/)).not.toBeInTheDocument();
  });

  it('en modo "usar mi CLABE" envía sin reteclear los 18 dígitos (atajo mock, useClabeOnFile)', async () => {
    const onCreated = vi.fn();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(
      <BuylistKycForm items={RAW_ITEMS} onCreated={onCreated} clabeMasked="****1234" />,
      'es',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // MOCK: pendiente de contrato — el flag useClabeOnFile es del cliente (no viaja al
    // backend real); la solicitud NO lleva la CLABE tecleada.
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ items: RAW_ITEMS, useClabeOnFile: true }),
    );
    expect(spy.mock.calls[0][0].clabe).toBeUndefined();
  });
});

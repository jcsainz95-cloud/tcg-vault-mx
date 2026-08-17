import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M5View } from './M5View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

// Reveal CLABE / pago SPEI exigen super_admin (patrón useRole): se fija para ejercer el flujo.
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('M5View · Buylist admin end-to-end', () => {
  it('renderiza la cola con solicitudes, acabado por ítem y botones de decisión', async () => {
    renderWithProviders(<M5View />, 'es');
    expect(await screen.findByText('sr-3001')).toBeInTheDocument();
    expect(screen.getByText('sr-3002')).toBeInTheDocument();
    // v1.6-finish: el acabado del ítem es visible (sri-1 = holofoil).
    expect(screen.getAllByText('Holofoil').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Aprobar' }).length).toBeGreaterThan(0);
  });

  it('el botón Verificar dispara POST /verify y muestra la confirmación', async () => {
    const spy = vi
      .spyOn(api, 'verifyBuylistRequest')
      .mockResolvedValue({ id: 'sr-3002', userId: 'u-778', status: 'verificacion', quotedTotalCents: 1200, createdAt: '', items: [] });
    renderWithProviders(<M5View />, 'es');
    // sr-3002 está en `recibida` → muestra "Iniciar verificación".
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar verificación' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3002'));
    expect(await screen.findByText('Verificación iniciada.')).toBeInTheDocument();
  });

  it('Aprobar un ítem llama a la decisión approve y confirma', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockResolvedValue({
      id: 'sri-1',
      card: { id: 'c', externalId: 'c', name: 'Charizard', number: '4', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] },
      productType: 'raw',
      finish: 'holofoil',
      itemStatus: 'aprobada',
    });
    renderWithProviders(<M5View />, 'es');
    const approveButtons = await screen.findAllByRole('button', { name: 'Aprobar' });
    fireEvent.click(approveButtons[0]);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sri-1', { decision: 'approve', approvedPriceCents: undefined }),
    );
    expect(await screen.findByText('Ítem aprobado.')).toBeInTheDocument();
  });

  it('Ajustar abre el modal, envía approvedPriceCents y muestra el error real del tope (APPROVED_PRICE_CAP_EXCEEDED)', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockRejectedValue(
      new ApiClientError(422, {
        code: 'APPROVED_PRICE_CAP_EXCEEDED',
        message: 'Approved price exceeds the allowed cap for this item',
      }),
    );
    renderWithProviders(<M5View />, 'es');
    const adjustButtons = await screen.findAllByRole('button', { name: 'Ajustar' });
    fireEvent.click(adjustButtons[0]);

    const dialog = await screen.findByRole('dialog', { name: 'Ajustar precio del ítem' });
    fireEvent.change(within(dialog).getByLabelText('Precio aprobado (MXN)'), {
      target: { value: '99999' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar ajuste' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sri-1', { decision: 'adjust', approvedPriceCents: 9999900 }),
    );
    // Copy i18n del código del contrato (tope B-4/AML), no un genérico.
    expect(
      await within(dialog).findByText(/excede el tope permitido/),
    ).toBeInTheDocument();
  });

  it('Rechazar un ítem llama a la decisión reject', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockResolvedValue({
      id: 'sri-1',
      card: { id: 'c', externalId: 'c', name: 'Charizard', number: '4', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] },
      productType: 'raw',
      finish: 'holofoil',
      itemStatus: 'rechazada',
    });
    renderWithProviders(<M5View />, 'es');
    const rejectButtons = await screen.findAllByRole('button', { name: 'Rechazar' });
    fireEvent.click(rejectButtons[0]);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sri-1', { decision: 'reject', approvedPriceCents: undefined }),
    );
    expect(await screen.findByText('Ítem rechazado.')).toBeInTheDocument();
  });

  it('Convertir a inventario está deshabilitado si el ítem no está aprobado', async () => {
    renderWithProviders(<M5View />, 'es');
    const convertButtons = await screen.findAllByRole('button', { name: 'Convertir a inventario' });
    // Fixture: ningún ítem está `aprobada` → todos los convertir están deshabilitados.
    for (const b of convertButtons) expect(b).toBeDisabled();
  });

  it('Revelar CLABE la muestra bajo demanda y Ocultar la retira (no persiste)', async () => {
    const spy = vi
      .spyOn(api, 'revealBuylistClabe')
      .mockResolvedValue({ sellRequestId: 'sr-3001', clabe: '002010077777777771' });
    renderWithProviders(<M5View />, 'es');
    const revealButtons = await screen.findAllByRole('button', { name: 'Revelar CLABE' });
    fireEvent.click(revealButtons[0]);

    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3001'));
    expect(await screen.findByText('002010077777777771')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar CLABE' }));
    expect(screen.queryByText('002010077777777771')).not.toBeInTheDocument();
  });

  it('Pagar por SPEI pide la referencia, llama al endpoint y confirma', async () => {
    const spy = vi.spyOn(api, 'paySpeiBuylist').mockResolvedValue({
      id: 'sr-3001',
      userId: 'u-777',
      status: 'pagada',
      quotedTotalCents: 50200,
      createdAt: '',
      items: [],
    });
    renderWithProviders(<M5View />, 'es');
    const payButtons = await screen.findAllByRole('button', { name: 'Pagar por SPEI' });
    // sr-3001 (verificacion) es pagable; sr-3002 (recibida) no.
    const enabled = payButtons.find((b) => !(b as HTMLButtonElement).disabled)!;
    fireEvent.click(enabled);

    const dialog = await screen.findByRole('dialog', { name: 'Registrar pago SPEI' });
    const confirm = within(dialog).getByRole('button', { name: 'Registrar pago' });
    // Referencia obligatoria: sin ella no se puede confirmar.
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Referencia SPEI'), {
      target: { value: 'MBAN-2026-081701' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3001', 'MBAN-2026-081701'));
    expect(await screen.findByText(/Pago SPEI registrado/)).toBeInTheDocument();
  });

  it('un error del pago SPEI muestra el mensaje real del backend dentro del modal', async () => {
    vi.spyOn(api, 'paySpeiBuylist').mockRejectedValue(
      new ApiClientError(422, {
        code: 'SOME_UNMAPPED_CODE',
        message: 'Payment allowed only after receipt/verification and approval',
      }),
    );
    renderWithProviders(<M5View />, 'es');
    const payButtons = await screen.findAllByRole('button', { name: 'Pagar por SPEI' });
    fireEvent.click(payButtons.find((b) => !(b as HTMLButtonElement).disabled)!);
    const dialog = await screen.findByRole('dialog', { name: 'Registrar pago SPEI' });
    fireEvent.change(within(dialog).getByLabelText('Referencia SPEI'), { target: { value: 'X' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));

    // Código sin copy i18n → cae al mensaje real del backend (useErrorMessage).
    expect(
      await within(dialog).findByText('Payment allowed only after receipt/verification and approval'),
    ).toBeInTheDocument();
  });
});

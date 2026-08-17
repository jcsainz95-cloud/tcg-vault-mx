import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M8View } from './M8View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

// La recompra es money-out (super_admin): se fija el rol para ejercer ambos botones.
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('M8View · Disputas (resolve)', () => {
  it('lista las disputas y muestra los botones de resolución para la activa', async () => {
    renderWithProviders(<M8View />, 'es');
    expect(await screen.findByText('dsp-5001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolver con recompra' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rechazar disputa' })).toBeEnabled();
  });

  it('Rechazar exige nota, llama a POST /admin/disputes/:id/resolve y confirma', async () => {
    const spy = vi.spyOn(api, 'resolveDispute').mockResolvedValue({
      id: 'dsp-5001',
      status: 'rechazada',
      createdAt: '2026-08-12T16:00:00Z',
    });
    renderWithProviders(<M8View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Rechazar disputa' }));

    const dialog = await screen.findByRole('dialog', { name: 'Rechazar disputa' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirmar resolución' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Nota de resolución'), {
      target: { value: 'evidencia no concluyente' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar resolución' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('dsp-5001', {
        resolution: 'reject',
        note: 'evidencia no concluyente',
      }),
    );
    expect(await screen.findByText('Disputa rechazada.')).toBeInTheDocument();
  });

  it('Resolver con recompra envía resolution=repurchase con su nota', async () => {
    const spy = vi.spyOn(api, 'resolveDispute').mockResolvedValue({
      id: 'dsp-5001',
      status: 'resuelta_recompra',
      createdAt: '2026-08-12T16:00:00Z',
    });
    renderWithProviders(<M8View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Resolver con recompra' }));

    const dialog = await screen.findByRole('dialog', { name: 'Resolver con recompra' });
    fireEvent.change(within(dialog).getByLabelText('Nota de resolución'), {
      target: { value: 'daño confirmado en tránsito' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar resolución' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('dsp-5001', {
        resolution: 'repurchase',
        note: 'daño confirmado en tránsito',
      }),
    );
    expect(await screen.findByText('Disputa resuelta con recompra.')).toBeInTheDocument();
  });

  it('un error muestra el copy del código del contrato (MONEY_OUT_FORBIDDEN)', async () => {
    vi.spyOn(api, 'resolveDispute').mockRejectedValue(
      new ApiClientError(403, { code: 'MONEY_OUT_FORBIDDEN', message: 'Only super_admin' }),
    );
    renderWithProviders(<M8View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Resolver con recompra' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolver con recompra' });
    fireEvent.change(within(dialog).getByLabelText('Nota de resolución'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar resolución' }));

    expect(
      await screen.findByText('Solo el súper-admin puede ejecutar movimientos de dinero saliente.'),
    ).toBeInTheDocument();
  });
});

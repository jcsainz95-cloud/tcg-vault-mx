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
  /**
   * P-97 — el dueño entró a `/es/admin/m8` con cero disputas y vio el título y NADA más: la lista
   * se pintaba con `(query.data ?? []).map(...)` sin rama de vacío, así que una pantalla SANA se
   * leía como una pantalla ROTA. Aquí no hay filtro que culpar (a diferencia de §M4, que distingue
   * «sin envíos con ese filtro» de «nada que preparar»): cero disputas es **cero disputas**, y es
   * una buena noticia — de ahí el `tone="positive"` de DESIGN_SYSTEM §8.1 («cola admin vacía»).
   */
  it('con cero disputas pinta el estado vacío, no una pantalla en blanco', async () => {
    vi.spyOn(api, 'getAdminDisputes').mockResolvedValue([]);
    renderWithProviders(<M8View />, 'es');

    expect(await screen.findByText('Sin disputas por ahora.')).toBeInTheDocument();
    expect(
      screen.getByText('Cuando un cliente abra una disputa aparecerá aquí para resolverla.'),
    ).toBeInTheDocument();
    // Y nada de la ficha de detalle: sin disputa activa no hay acciones que ofrecer.
    expect(screen.queryByRole('button', { name: 'Resolver con recompra' })).not.toBeInTheDocument();
  });

  it('en EN el vacío también tiene copy (paridad de catálogo)', async () => {
    vi.spyOn(api, 'getAdminDisputes').mockResolvedValue([]);
    renderWithProviders(<M8View />, 'en');
    expect(await screen.findByText('No disputes right now.')).toBeInTheDocument();
  });

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

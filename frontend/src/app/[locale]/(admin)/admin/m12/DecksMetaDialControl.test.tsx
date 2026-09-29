import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { DecksMetaDialControl } from './DecksMetaDialControl';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

// El rol de back-office se controla por test (patrón de VariantPriceConsole.test).
const roleState = vi.hoisted(() => ({ role: 'super_admin' as 'super_admin' | 'vault_operator' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

describe('DecksMetaDialControl · interruptor del jalado automático', () => {
  it('pinta el estado actual (Apagado / Publicar solo apagada) leído del backend', async () => {
    vi.spyOn(api, 'getDecksMetaDial').mockResolvedValue({ autofetch: 'off', autopublish: false });
    renderWithProviders(<DecksMetaDialControl />, 'es');

    // El estado en solo-lectura aparece una vez la lectura resuelve.
    expect(await screen.findByText('Estado ahora')).toBeInTheDocument();
    expect(screen.getAllByText('Apagado').length).toBeGreaterThan(0);
  });

  it('al pasar a Encendido pide confirmación ANTES de escribir, y confirma con el patch correcto', async () => {
    vi.spyOn(api, 'getDecksMetaDial').mockResolvedValue({ autofetch: 'off', autopublish: false });
    const put = vi
      .spyOn(api, 'setDecksMetaDial')
      .mockResolvedValue({ autofetch: 'on', autopublish: false });
    renderWithProviders(<DecksMetaDialControl />, 'es');

    // Espera a que el formulario se siembre con la lectura.
    await screen.findByText('Estado ahora');

    // Selecciona «Encendido» y aprieta Guardar.
    fireEvent.click(screen.getByRole('radio', { name: /Encendido/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar interruptor' }));

    // NO se escribió todavía: primero aparece la confirmación.
    expect(put).not.toHaveBeenCalled();
    expect(await screen.findByText(/corra solo cada semana/i)).toBeInTheDocument();

    // Confirmar dispara el PUT con solo la llave que cambió.
    fireEvent.click(screen.getByRole('button', { name: 'Sí, encender' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ autofetch: 'on' }));
  });

  it('un cambio que NO escala (a Ensayo) escribe directo, sin confirmación', async () => {
    vi.spyOn(api, 'getDecksMetaDial').mockResolvedValue({ autofetch: 'off', autopublish: false });
    const put = vi
      .spyOn(api, 'setDecksMetaDial')
      .mockResolvedValue({ autofetch: 'dryrun', autopublish: false });
    renderWithProviders(<DecksMetaDialControl />, 'es');
    await screen.findByText('Estado ahora');

    fireEvent.click(screen.getByRole('radio', { name: /Ensayo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar interruptor' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith({ autofetch: 'dryrun' }));
    // No hubo diálogo de confirmación de encendido.
    expect(screen.queryByRole('button', { name: 'Sí, encender' })).not.toBeInTheDocument();
  });

  it('un operador (no súper-admin) ve el estado en solo-lectura, sin controles de edición', async () => {
    roleState.role = 'vault_operator';
    vi.spyOn(api, 'getDecksMetaDial').mockResolvedValue({ autofetch: 'dryrun', autopublish: true });
    renderWithProviders(<DecksMetaDialControl />, 'es');

    expect(
      await screen.findByText(
        'Estás viendo el estado en solo-lectura. Cambiar el interruptor es solo para súper-admin.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar interruptor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('un 403 al escribir se muestra como aviso claro (no el error crudo)', async () => {
    vi.spyOn(api, 'getDecksMetaDial').mockResolvedValue({ autofetch: 'off', autopublish: false });
    vi.spyOn(api, 'setDecksMetaDial').mockRejectedValue(
      new ApiClientError(403, { code: 'FORBIDDEN', message: 'forbidden' }),
    );
    renderWithProviders(<DecksMetaDialControl />, 'es');
    await screen.findByText('Estado ahora');

    // Cambio que no escala → escribe directo → cae en 403.
    fireEvent.click(screen.getByRole('radio', { name: /Ensayo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar interruptor' }));

    expect(
      await screen.findByText('No tienes permiso para cambiar el interruptor. Solo un súper-admin puede.'),
    ).toBeInTheDocument();
  });
});

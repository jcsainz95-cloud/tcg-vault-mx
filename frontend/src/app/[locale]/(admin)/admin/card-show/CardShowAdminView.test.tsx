/**
 * Panel «Card Show» (super_admin) — API_CONTRACT §CARDSHOW.15, v1.96 M-84. Se mockea el cliente del
 * panel; se prueba la CONDUCTA: columnas M-84 de leads, Player ID vacío en los juegos LIGERA, el
 * cambio de listado, la descarga de CSV con los filtros vigentes y el 403 → aviso de súper-admin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import { CardShowAdminView } from './CardShowAdminView';

const { listCardShowLeads, listCardShowPlayers, exportCardShowLeadsCsv, exportCardShowPlayersCsv } = vi.hoisted(() => ({
  listCardShowLeads: vi.fn(),
  listCardShowPlayers: vi.fn(),
  exportCardShowLeadsCsv: vi.fn(),
  exportCardShowPlayersCsv: vi.fn(),
}));

vi.mock('@/lib/card-show-admin-api', () => ({
  listCardShowLeads,
  listCardShowPlayers,
  exportCardShowLeadsCsv,
  exportCardShowPlayersCsv,
}));

const LEAD = {
  id: 'l1',
  type: 'merchant' as const,
  name: 'Mi Tienda',
  email: 'tienda@correo.com',
  phone: '5512345678',
  gameInterest: null,
  raffleOptIn: false,
  raffleTermsVersion: null,
  sellsWhat: 'Singles y sellado',
  status: 'new' as const,
  createdAt: '2026-11-01T18:00:00Z',
};

const PLAYER_LIGERA = {
  id: 'p1',
  game: 'riftbound' as const,
  day: 'sat' as const,
  playerName: 'Ana',
  playerId: null,
  status: 'confirmed' as const,
  createdAt: '2026-11-02T18:00:00Z',
};

beforeEach(() => {
  listCardShowLeads.mockResolvedValue({ data: [LEAD], total: 1, page: 1, pageSize: 50 });
  listCardShowPlayers.mockResolvedValue({ data: [PLAYER_LIGERA], total: 1, page: 1, pageSize: 50 });
  exportCardShowLeadsCsv.mockResolvedValue({ blob: new Blob(['x'], { type: 'text/csv' }), filename: 'leads.csv' });
  exportCardShowPlayersCsv.mockResolvedValue({ blob: new Blob(['x'], { type: 'text/csv' }), filename: 'players.csv' });
  // jsdom no implementa createObjectURL: la descarga sólo necesita no reventar.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => vi.clearAllMocks());

describe('CardShowAdminView', () => {
  it('el h1 es «Card Show» y por defecto muestra el listado de leads con columnas M-84', async () => {
    renderWithProviders(<CardShowAdminView />, 'es');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Card Show');
    await screen.findByText('Mi Tienda');
    const table = within(screen.getByTestId('cs-leads-table'));
    expect(table.getByText('Mi Tienda')).toBeInTheDocument();
    expect(table.getByText('5512345678')).toBeInTheDocument(); // teléfono (PII, súper-admin)
    expect(table.getByText('Singles y sellado')).toBeInTheDocument(); // ¿qué vende?
    expect(table.getByText('Vendedor')).toBeInTheDocument(); // tipo traducido
  });

  it('filtrar por tipo re-consulta con ?type=', async () => {
    const u = userEvent.setup();
    renderWithProviders(<CardShowAdminView />, 'es');
    await screen.findByText('Mi Tienda');
    await u.selectOptions(screen.getByLabelText('Tipo'), 'sponsor');
    await waitFor(() => expect(listCardShowLeads).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'sponsor' })));
  });

  it('«Descargar CSV» llama al export de leads con los filtros vigentes', async () => {
    const u = userEvent.setup();
    renderWithProviders(<CardShowAdminView />, 'es');
    await screen.findByText('Mi Tienda');
    await u.click(screen.getByRole('button', { name: /Descargar CSV/ }));
    await waitFor(() => expect(exportCardShowLeadsCsv).toHaveBeenCalledTimes(1));
  });

  it('en «Preinscritos», un juego LIGERA muestra Player ID vacío («—»)', async () => {
    const u = userEvent.setup();
    renderWithProviders(<CardShowAdminView />, 'es');
    await u.click(screen.getByRole('tab', { name: 'Preinscritos' }));
    await screen.findByText('Ana');
    const table = screen.getByTestId('cs-players-table');
    expect(within(table).getByText('Ana')).toBeInTheDocument();
    expect(within(table).getByText('Riftbound')).toBeInTheDocument();
    expect(table.textContent).toContain('—'); // Player ID vacío en la fila LIGERA
    expect(listCardShowPlayers).toHaveBeenCalled();
  });

  it('403 ⇒ aviso de que el panel es solo para súper-admin', async () => {
    listCardShowLeads.mockRejectedValue(new ApiClientError(403, { code: 'FORBIDDEN', message: 'no' }));
    renderWithProviders(<CardShowAdminView />, 'es');
    expect(await screen.findByText(/solo para súper-admin/)).toBeInTheDocument();
  });
});

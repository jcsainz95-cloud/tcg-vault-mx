import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { VaultsView } from './VaultsView';
import * as api from '@/lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Admin · Bóvedas de clientes (GET /admin/vaults, v1.20)', () => {
  it('lista clientes con piezas y valor estimado (orden default value_desc)', async () => {
    const spy = vi.spyOn(api, 'getAdminVaults');
    renderWithProviders(<VaultsView />, 'es');

    // Ana (mockHoldings: 128000+950000+320000 = MX$13,980.00; Zapdos pendiente NO suma).
    expect(await screen.findByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('4 piezas')).toBeInTheDocument();
    expect(screen.getByText(/13,980\.00/)).toBeInTheDocument();
    // Bruno (bóveda chica) después por valor.
    expect(screen.getByText('Bruno Díaz')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sort: 'value_desc', page: 1 }));

    // value_desc: Ana (mayor valor) antes que Bruno.
    const names = screen.getAllByRole('button', { name: /Ver bóveda/ }).map((b) => b.textContent);
    expect(names[0]).toContain('Ana López');
  });

  it('clic en un cliente abre su master set en modo lectura (vista (ii))', async () => {
    const spy = vi.spyOn(api, 'getAdminVaultMasterSets');
    renderWithProviders(<VaultsView />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Ver bóveda · Ana López/ }));

    // Cabecera con el cliente + owner del DTO (con email) y el índice de SU bóveda.
    expect(await screen.findByRole('heading', { name: 'Ana López' })).toBeInTheDocument();
    expect(await screen.findByText(/Bóveda de Ana López · ana@example\.com/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Base Set/ })).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledWith('u-777', expect.anything()));
  });
});

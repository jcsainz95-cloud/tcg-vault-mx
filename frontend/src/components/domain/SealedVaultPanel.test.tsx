import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedVaultPanel } from './SealedVaultPanel';
import * as api from '@/lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SealedVaultPanel · modo self', () => {
  it('pinta las filas con imagen, condición, cantidad y valor de mercado', async () => {
    renderWithProviders(<SealedVaultPanel mode="self" />, 'es');

    // Producto + set + condición legible.
    expect(await screen.findByText('Surging Sparks Booster Box')).toBeInTheDocument();
    expect(screen.getByText('Twilight Masquerade ETB')).toBeInTheDocument();
    expect(screen.getAllByText('Como nueva').length).toBeGreaterThan(0);

    // Cantidad por grupo (1 pieza / 2 piezas) e imagen por fila (alt = nombre).
    expect(screen.getAllByText('1 pieza').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 piezas').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Surging Sparks Booster Box' }).length).toBeGreaterThan(0);

    // Total valuado a mercado + conteo de precio pendiente (el ETB no tiene mercado).
    expect(screen.getByText('Valor de mercado total')).toBeInTheDocument();
    expect(screen.getAllByText(/3,050/).length).toBeGreaterThan(0);
    expect(screen.getByText('2 productos sin precio de mercado')).toBeInTheDocument();
    expect(screen.getAllByText('Precio pendiente').length).toBeGreaterThan(0);
  });
});

describe('SealedVaultPanel · modo admin', () => {
  it('carga la bóveda sellada de un cliente por userId', async () => {
    renderWithProviders(<SealedVaultPanel mode="admin" userId="u-777" />, 'es');

    expect(await screen.findByText('Surging Sparks Booster Box')).toBeInTheDocument();
    expect(screen.getByText('Twilight Masquerade ETB')).toBeInTheDocument();
  });

  it('cliente sin sellado muestra el estado vacío', async () => {
    renderWithProviders(<SealedVaultPanel mode="admin" userId="u-000" />, 'es');

    expect(await screen.findByText('Aún no tienes sellado en tu bóveda')).toBeInTheDocument();
    expect(screen.queryByText('Surging Sparks Booster Box')).toBeNull();
  });
});

describe('SealedVaultPanel · estado de error', () => {
  it('muestra el banner de error con reintentar', async () => {
    vi.spyOn(api, 'getVaultSealed').mockRejectedValue(new Error('boom'));
    renderWithProviders(<SealedVaultPanel mode="self" />, 'es');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

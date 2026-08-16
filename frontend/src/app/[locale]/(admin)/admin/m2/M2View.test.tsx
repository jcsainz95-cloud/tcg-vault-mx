import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M2View } from './M2View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('M2View · Catálogo y precios', () => {
  it('muestra las secciones de sync, FX, rareza y catálogo', async () => {
    renderWithProviders(<M2View />, 'es');
    expect(screen.getByRole('heading', { level: 1, name: /Catálogo y precios/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Sync de precios/ })).toBeInTheDocument();
    // FX carga async desde el mock.
    expect(await screen.findByText('18.4200')).toBeInTheDocument();
  });

  it('lista la cola de precio pendiente desde la API', async () => {
    renderWithProviders(<M2View />, 'es');
    expect((await screen.findAllByText('Zapdos')).length).toBeGreaterThan(0);
  });

  it('lanza el sync de precios y muestra el resultado encolado', async () => {
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Lanzar sync de precios/ }));
    expect(await screen.findByText(/Sync encolado/)).toBeInTheDocument();
  });

  it('lista los sets remotos con estado imported/cardCount', async () => {
    renderWithProviders(<M2View />, 'es');
    expect((await screen.findAllByText('Surging Sparks')).length).toBeGreaterThan(0);
    // El botón de catálogo sync-all está disponible (contrato v1.3, condicional).
    expect(screen.getByRole('button', { name: /Sync de todo el catálogo/ })).toBeInTheDocument();
  });

  it('abre el modal de override manual de precio', async () => {
    renderWithProviders(<M2View />, 'es');
    const buttons = await screen.findAllByRole('button', { name: 'Fijar precio' });
    fireEvent.click(buttons[0]);
    expect(await screen.findByRole('dialog', { name: /Override manual de precio/ })).toBeInTheDocument();
  });

  it('muestra un Banner de error cuando el sync por set (Importar/Re-sincronizar) falla', async () => {
    // Rate limit de pokemontcg.io sin API key: el sync síncrono revienta.
    vi.spyOn(api, 'syncCatalog').mockRejectedValueOnce(
      new ApiClientError(429, { code: 'RATE_LIMITED', message: 'rate limited' }),
    );
    renderWithProviders(<M2View />, 'es');
    const [importBtn] = await screen.findAllByRole('button', { name: /Importar|Re-sincronizar/ });
    fireEvent.click(importBtn);

    // El usuario ve claramente que falló y por qué (código del contrato).
    expect(await screen.findByText('Demasiadas solicitudes, intenta más tarde.')).toBeInTheDocument();
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('muestra un Banner de error cuando el backfill falla', async () => {
    vi.spyOn(api, 'backfillCatalog').mockRejectedValueOnce(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Backfill/ }));

    expect(await screen.findByText('Error del servidor. Intenta de nuevo.')).toBeInTheDocument();
  });

  it('un error real (no 404/405) del sync total muestra Banner danger, no el aviso "no disponible"', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockRejectedValueOnce(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Sync de todo el catálogo/ }));

    expect(await screen.findByText('Error del servidor. Intenta de nuevo.')).toBeInTheDocument();
    expect(screen.queryByText(/no está disponible en el backend/)).not.toBeInTheDocument();
  });

  it('un 404/405 del sync total conserva el aviso "no disponible" (warning, no danger)', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockRejectedValueOnce(
      new ApiClientError(404, { code: 'NOT_FOUND', message: 'missing' }),
    );
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Sync de todo el catálogo/ }));

    expect(await screen.findByText(/no está disponible en el backend/)).toBeInTheDocument();
  });
});

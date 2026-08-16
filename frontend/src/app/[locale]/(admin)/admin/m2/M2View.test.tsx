import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M2View } from './M2View';

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
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
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

  it('la cola de pendientes muestra el ACABADO y el override lo reenvía (v1.8: cola por acabado)', async () => {
    const spy = vi.spyOn(api, 'overridePrice').mockResolvedValue({ ok: true });
    renderWithProviders(<M2View />, 'es');
    // El pendiente de Zapdos es del acabado holofoil (fixture): visible en la tabla.
    expect((await screen.findAllByText('Holofoil')).length).toBeGreaterThan(0);

    const buttons = await screen.findAllByRole('button', { name: 'Fijar precio' });
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog', { name: /Override manual de precio/ });
    fireEvent.change(within(dialog).getByLabelText('Precio de referencia (MXN)'), {
      target: { value: '350' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar precio' }));

    // Sin `finish` el backend defaultearía `normal` y el pendiente real seguiría abierto.
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        cardId: 'c-zapdos',
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'holofoil',
        priceMxnCents: 35000,
      }),
    );
  });

  it('muestra un Banner de error cuando el sync por set (Importar/Re-sincronizar) falla', async () => {
    // Rate limit de pokemontcg.io sin API key: el sync síncrono revienta.
    vi.spyOn(api, 'syncCatalog').mockRejectedValueOnce(
      new ApiClientError(429, { code: 'RATE_LIMITED', message: 'rate limited' }),
    );
    renderWithProviders(<M2View />, 'es');
    // Nombre EXACTO para no capturar "Re-sincronizar todo (forzar)" (sync-all force).
    const [importBtn] = await screen.findAllByRole('button', { name: /^(Importar|Re-sincronizar)$/ });
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

  it('el botón "Re-sincronizar todo (forzar)" pide confirmación y llama al endpoint con force=true', async () => {
    const spy = vi
      .spyOn(api, 'syncAllCatalog')
      .mockResolvedValue({ jobId: 'job-1', setsQueued: 42, remaining: 0 });
    renderWithProviders(<M2View />, 'es');

    // Picar el botón NO llama de inmediato: abre el modal de confirmación.
    fireEvent.click(await screen.findByRole('button', { name: /Re-sincronizar todo \(forzar\)/ }));
    expect(
      await screen.findByRole('dialog', { name: /Re-sincronizar todo el catálogo \(forzar\)/ }),
    ).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    // Confirmar dispara la mutación con force=true.
    fireEvent.click(screen.getByRole('button', { name: /Sí, re-sincronizar todo/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ force: true }));
    expect(await screen.findByText(/Re-sync forzado encolado: 42 sets/)).toBeInTheDocument();
  });

  it('cancelar la confirmación del re-sync forzado no llama al endpoint', async () => {
    const spy = vi.spyOn(api, 'syncAllCatalog');
    renderWithProviders(<M2View />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Re-sincronizar todo \(forzar\)/ }));
    const dialog = await screen.findByRole('dialog', { name: /Re-sincronizar todo el catálogo \(forzar\)/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancelar/ }));

    expect(spy).not.toHaveBeenCalled();
  });

  // ---- Editor de precio de buylist por rareza (v1.3.1) ----
  it('renderiza el editor de reglas por rareza con el fallback y las rarezas del catálogo', async () => {
    renderWithProviders(<M2View />, 'es');
    expect(await screen.findByRole('heading', { name: /Precio de buylist por rareza/ })).toBeInTheDocument();
    // Fallback editable y una rareza fija del seed (Common).
    expect(await screen.findByLabelText('Fallback (%)')).toBeInTheDocument();
    expect((await screen.findAllByText('Common')).length).toBeGreaterThan(0);
  });

  it('editar el valor de una regla fija (Common) y guardar envía updateBuylistRules en centavos', async () => {
    const spy = vi
      .spyOn(api, 'updateBuylistRules')
      .mockResolvedValue({ rules: {}, fallbackPct: 40 });
    renderWithProviders(<M2View />, 'es');
    const valueInput = await screen.findByLabelText('Valor para Common');
    // 1 peso → 100 centavos.
    fireEvent.change(valueInput, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackPct: 40,
        rules: expect.objectContaining({ Common: { mode: 'fixed', value: 100 } }),
      }),
    );
    expect(await screen.findByText('Reglas de buylist guardadas.')).toBeInTheDocument();
  });

  it('editar el fallback % y guardar envía el nuevo fallbackPct', async () => {
    const spy = vi
      .spyOn(api, 'updateBuylistRules')
      .mockResolvedValue({ rules: {}, fallbackPct: 55 });
    renderWithProviders(<M2View />, 'es');
    const fallback = await screen.findByLabelText('Fallback (%)');
    fireEvent.change(fallback, { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ fallbackPct: 55 }));
  });

  it('cambiar el modo de una rareza en fallback a fijo la promueve a regla explícita', async () => {
    const spy = vi
      .spyOn(api, 'updateBuylistRules')
      .mockResolvedValue({ rules: {}, fallbackPct: 40 });
    renderWithProviders(<M2View />, 'es');
    // Rare Holo no tiene regla explícita (fallback pct); cambiar su modo a fijo.
    const modeSelect = await screen.findByLabelText('Modo para Rare Holo');
    fireEvent.change(modeSelect, { target: { value: 'fixed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const arg = spy.mock.calls[0][0] as { rules: Record<string, { mode: string }> };
    expect(arg.rules['Rare Holo'].mode).toBe('fixed');
  });
});

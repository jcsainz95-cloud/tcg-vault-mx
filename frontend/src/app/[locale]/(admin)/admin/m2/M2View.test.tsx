import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M2View } from './M2View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';

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
    // El botón de importar sets nuevos (sync-all force:false) está disponible (contrato v1.3, condicional).
    expect(screen.getByRole('button', { name: /Importar sets nuevos/ })).toBeInTheDocument();
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

  it('el botón "Importar sets nuevos" dispara syncAllCatalog sin forzar (force:false = solo sets nuevos)', async () => {
    const spy = vi
      .spyOn(api, 'syncAllCatalog')
      .mockResolvedValue({ jobId: 'job-1', setsQueued: 3, remaining: 0 });
    renderWithProviders(<M2View />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    // Importar sets nuevos NO fuerza: llama sin argumentos (o con force ausente/false),
    // así el backend solo trae los sets recién salidos aún no importados.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const arg = spy.mock.calls[0][0] as { force?: boolean } | undefined;
    expect(arg?.force ?? false).toBe(false);
  });

  it('un error real (no 404/405) del sync total muestra Banner danger, no el aviso "no disponible"', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockRejectedValueOnce(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    expect(await screen.findByText('Error del servidor. Intenta de nuevo.')).toBeInTheDocument();
    expect(screen.queryByText(/no está disponible en el backend/)).not.toBeInTheDocument();
  });

  it('un 404/405 del sync total conserva el aviso "no disponible" (warning, no danger)', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockRejectedValueOnce(
      new ApiClientError(404, { code: 'NOT_FOUND', message: 'missing' }),
    );
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

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
    // El barrido corre en segundo plano: copy honesto "encolado", no "listo".
    expect(await screen.findByText(/Barrido encolado: 42 set\(s\)/)).toBeInTheDocument();
  });

  it('cancelar la confirmación del re-sync forzado no llama al endpoint', async () => {
    const spy = vi.spyOn(api, 'syncAllCatalog');
    renderWithProviders(<M2View />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Re-sincronizar todo \(forzar\)/ }));
    const dialog = await screen.findByRole('dialog', { name: /Re-sincronizar todo el catálogo \(forzar\)/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancelar/ }));

    expect(spy).not.toHaveBeenCalled();
  });

  it('pinta la barra de progreso del barrido cuando GET /sync-status reporta running', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      running: true,
      jobId: 'catalog-sync-all-1',
      total: 10,
      done: 4,
      startedAt: '2026-08-17T00:00:00.000Z',
      finishedAt: null,
    });
    renderWithProviders(<M2View />, 'es');
    // Progreso honesto done/total + porcentaje, con aviso de que corre en segundo plano.
    expect(await screen.findByText(/Importando catálogo… 4\/10 sets/)).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText(/Corre en segundo plano/)).toBeInTheDocument();
  });

  it('al terminar el barrido (running=false, total>0) muestra "completada", no la barra viva', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'catalog-sync-all-1',
      total: 10,
      done: 10,
      startedAt: '2026-08-17T00:00:00.000Z',
      finishedAt: '2026-08-17T00:05:00.000Z',
    });
    renderWithProviders(<M2View />, 'es');
    expect(await screen.findByText(/Sincronización completada: 10 set\(s\)/)).toBeInTheDocument();
  });

  // Devuelve un helper `within` acotado a la <section> cuyo encabezado matchea `name`.
  // Evita ambigüedad entre los editores de buylist (Sección 4) y de venta (Sección 5),
  // que comparten aria-labels ("Guardar", "Modo para {rarity}", "Valor para {rarity}").
  async function sectionFor(name: RegExp) {
    const heading = await screen.findByRole('heading', { name });
    const section = heading.closest('section');
    if (!section) throw new Error('section not found');
    return within(section);
  }

  // ---- Editor de precio de buylist por rareza (v1.3.1) ----
  it('renderiza el editor de reglas por rareza con el fallback y las rarezas del catálogo', async () => {
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Precio de buylist por rareza/);
    // Fallback editable y una rareza fija del seed (Common).
    expect(await s.findByLabelText('Fallback (%)')).toBeInTheDocument();
    expect((await s.findAllByText('Common')).length).toBeGreaterThan(0);
  });

  it('editar el valor de una regla fija (Common) y guardar envía updateBuylistRules en centavos', async () => {
    const spy = vi
      .spyOn(api, 'updateBuylistRules')
      .mockResolvedValue({ rules: {}, fallbackPct: 40 });
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Precio de buylist por rareza/);
    const valueInput = await s.findByLabelText('Valor para Common');
    // 1 peso → 100 centavos.
    fireEvent.change(valueInput, { target: { value: '1' } });
    fireEvent.click(s.getByRole('button', { name: 'Guardar' }));

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
    const s = await sectionFor(/Precio de buylist por rareza/);
    const fallback = await s.findByLabelText('Fallback (%)');
    fireEvent.change(fallback, { target: { value: '55' } });
    fireEvent.click(s.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ fallbackPct: 55 }));
  });

  it('cambiar el modo de una rareza en fallback a fijo la promueve a regla explícita', async () => {
    const spy = vi
      .spyOn(api, 'updateBuylistRules')
      .mockResolvedValue({ rules: {}, fallbackPct: 40 });
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Precio de buylist por rareza/);
    // Rare Holo no tiene regla explícita (fallback pct); cambiar su modo a fijo.
    const modeSelect = await s.findByLabelText('Modo para Rare Holo');
    fireEvent.change(modeSelect, { target: { value: 'fixed' } });
    fireEvent.click(s.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const arg = spy.mock.calls[0][0] as { rules: Record<string, { mode: string }> };
    expect(arg.rules['Rare Holo'].mode).toBe('fixed');
  });

  // ---- Editor de precio de VENTA por rareza (v1.13-sales-pricing) ----
  it('renderiza el editor de reglas de VENTA con el fallback (sobre mercado) y el hint de markup', async () => {
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    // El fallback de venta se rotula como markup "sobre mercado" (distinto del de buylist).
    expect(await s.findByLabelText('Fallback (% sobre mercado)')).toBeInTheDocument();
    // El hint deja claro que el pct es markup arriba de mercado (precio = mercado × (1 + %)).
    expect(s.getByText(/precio de venta = mercado × \(1 \+ %\)/)).toBeInTheDocument();
  });

  it('editar el valor de una regla fija de venta (Common) y guardar envía updateSalesRules en centavos', async () => {
    const spy = vi.spyOn(api, 'updateSalesRules').mockResolvedValue({ rules: {}, fallbackPct: 15 });
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    const valueInput = await s.findByLabelText('Valor para Common');
    // 20 pesos → 2000 centavos.
    fireEvent.change(valueInput, { target: { value: '20' } });
    fireEvent.click(s.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackPct: 15,
        rules: expect.objectContaining({ Common: { mode: 'fixed', value: 2000 } }),
      }),
    );
    expect(await screen.findByText('Reglas de venta guardadas.')).toBeInTheDocument();
  });

  it('editar el fallback de venta acepta pct > 100 (markup sin tope en 100) y lo envía', async () => {
    const spy = vi.spyOn(api, 'updateSalesRules').mockResolvedValue({ rules: {}, fallbackPct: 250 });
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    const fallback = await s.findByLabelText('Fallback (% sobre mercado)');
    // 250% de markup: válido en venta (el validador permite hasta 1000).
    fireEvent.change(fallback, { target: { value: '250' } });
    fireEvent.click(s.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ fallbackPct: 250 }));
  });

  // ---- Ejemplos en línea del % (G3: la semántica del % es OPUESTA entre compra y venta) ----
  it('la tabla de buylist muestra un ejemplo textual del % (pagas MX$40 por MX$100)', async () => {
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Precio de buylist por rareza/);
    expect(await s.findByText(/pagas MX\$40 por una carta de MX\$100/)).toBeInTheDocument();
  });

  it('la tabla de venta muestra un ejemplo textual del % (vendes en MX$115 una de MX$100)', async () => {
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    expect(await s.findByText(/vendes en MX\$115 una carta de MX\$100/)).toBeInTheDocument();
  });

  // ---- FX · guardar SOLO el colchón (#13, v1.14-price-ingest) ----
  it('guardar solo el colchón (buffer) llama a updateFx SIN rate y muestra el mensaje claro', async () => {
    const spy = vi.spyOn(api, 'updateFx').mockResolvedValue({
      rate: 18.42,
      bufferPct: 5,
      source: 'banxico',
      effectiveDate: '2026-08-17',
    });
    renderWithProviders(<M2View />, 'es');
    // La sección FX carga async; el input del colchón aparece cuando llega el mock.
    const bufferInput = await screen.findByLabelText('Nuevo colchón %');
    // Ambos vacíos → el botón está deshabilitado.
    expect(screen.getByRole('button', { name: 'Fijar override' })).toBeDisabled();

    fireEvent.change(bufferInput, { target: { value: '5' } });
    // Con la tasa vacía pero el colchón capturado, el botón se habilita (antes exigía ambos).
    const saveBtn = screen.getByRole('button', { name: 'Fijar override' });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // Manda SOLO el colchón: sin `rate` en el payload.
    expect(spy).toHaveBeenCalledWith({ bufferPct: 5 });
    expect(spy.mock.calls[0][0]).not.toHaveProperty('rate');

    expect(
      await screen.findByText('Colchón actualizado; se conservó la tasa vigente.'),
    ).toBeInTheDocument();
  });

  // ---- Proveedor de precios + ingesta masiva (v1.14-price-ingest) ----
  it('el selector de proveedor de precios guarda el dial (updatePriceProvider)', async () => {
    const spy = vi.spyOn(api, 'updatePriceProvider').mockResolvedValue(mockSettings);
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Ingesta masiva de precios/);
    const select = await s.findByLabelText('Proveedor de precios');
    fireEvent.change(select, { target: { value: 'pokemonpricetracker' } });
    fireEvent.click(s.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('pokemonpricetracker');
    expect(await screen.findByText('Proveedor de precios actualizado.')).toBeInTheDocument();
  });

  it('el botón "Actualizar precios ahora" dispara triggerPriceIngest y muestra el feedback de encolado', async () => {
    const spy = vi.spyOn(api, 'triggerPriceIngest').mockResolvedValue({
      job: 'price-ingest',
      enqueued: true,
      jobId: 'job-1',
    });
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Actualizar precios ahora/ }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Ingesta de precios encolada/)).toBeInTheDocument();
  });

  it('si el ingest ya está en curso (enqueued=false) el feedback lo dice (single-flight)', async () => {
    vi.spyOn(api, 'triggerPriceIngest').mockResolvedValue({
      job: 'price-ingest',
      enqueued: false,
    });
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Actualizar precios ahora/ }));

    expect(await screen.findByText(/Ya hay una ingesta de precios en curso/)).toBeInTheDocument();
  });
});

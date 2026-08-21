import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { M2View } from './M2View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';

// El `Link` de next-intl (`@/i18n/navigation`) no resuelve bajo vitest; se stubea a un <a>
// que preserva href/aria-label (enlace del bucket COMPRA al admin de buylist, M5).
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

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

  // ---- P-6: cola de precio pendiente en DOS BUCKETS (v1.26) ----
  it('P-6 VENTA (pestaña por defecto) pide context=inventory y renderiza sus pendientes', async () => {
    const spy = vi.spyOn(api, 'getPendingPrices');
    renderWithProviders(<M2View />, 'es');
    // Zapdos es context=inventory (fixture) → visible en VENTA (pestaña activa por defecto).
    expect((await screen.findAllByText('Zapdos')).length).toBeGreaterThan(0);
    // El bucket VENTA consulta SOLO context=inventory.
    await waitFor(() => expect(spy).toHaveBeenCalledWith('inventory'));
    // Machamp es context=buylist → NO aparece en el bucket VENTA.
    expect(screen.queryByText('Machamp')).toBeNull();
  });

  it('P-6 VENTA: "Fijar precio" llama a overridePrice y REFRESCA la cola (refetch context=inventory)', async () => {
    const override = vi.spyOn(api, 'overridePrice').mockResolvedValue({ ok: true });
    const listSpy = vi.spyOn(api, 'getPendingPrices');
    renderWithProviders(<M2View />, 'es');

    const buttons = await screen.findAllByRole('button', { name: 'Fijar precio' });
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog', { name: /Override manual de precio/ });
    fireEvent.change(within(dialog).getByLabelText('Precio de referencia (MXN)'), {
      target: { value: '350' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar precio' }));

    // La escritura money-touching llama al override existente…
    await waitFor(() => expect(override).toHaveBeenCalledTimes(1));
    // …y al cerrarse el pendiente, la cola VENTA se invalida y se vuelve a pedir (context=inventory).
    const inventoryCalls = () => listSpy.mock.calls.filter((c) => c[0] === 'inventory').length;
    await waitFor(() => expect(inventoryCalls()).toBeGreaterThanOrEqual(2));
  });

  // ---- S-L1 (SECURITY): el OVERRIDE (Fijar precio) no puede colar un MX$0 y publicar a $0 ----
  it('S-L1: teclear "1.2.3" en el override deja UN SOLO punto ("1.23") y NO publica a MX$0 (123 centavos)', async () => {
    const user = userEvent.setup();
    const override = vi.spyOn(api, 'overridePrice').mockResolvedValue({ ok: true });
    renderWithProviders(<M2View />, 'es');

    const buttons = await screen.findAllByRole('button', { name: 'Fijar precio' });
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog', { name: /Override manual de precio/ });
    const input = within(dialog).getByLabelText('Precio de referencia (MXN)') as HTMLInputElement;

    await user.type(input, '1.2.3');
    // El 2.º punto se descarta tecla-a-tecla: nunca se forma "1.2.3" (que casteaba a NaN→0).
    expect(input).toHaveValue('1.23');

    const save = within(dialog).getByRole('button', { name: 'Guardar precio' });
    expect(save).toBeEnabled();
    await user.click(save);

    // 1.23 pesos → 123 centavos; jamás 0 (ítem publicado gratis) por el multi-punto.
    await waitFor(() => expect(override).toHaveBeenCalledTimes(1));
    expect(override).toHaveBeenCalledWith(expect.objectContaining({ priceMxnCents: 123 }));
    const arg = override.mock.calls[0][0] as { priceMxnCents: number };
    expect(arg.priceMxnCents).not.toBe(0);
  });

  it('S-L1: un override mal formado (solo ".") DESHABILITA Fijar precio → no publica a MX$0', async () => {
    const user = userEvent.setup();
    const override = vi.spyOn(api, 'overridePrice').mockResolvedValue({ ok: true });
    renderWithProviders(<M2View />, 'es');

    const buttons = await screen.findAllByRole('button', { name: 'Fijar precio' });
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog', { name: /Override manual de precio/ });
    const input = within(dialog).getByLabelText('Precio de referencia (MXN)') as HTMLInputElement;

    await user.type(input, '.');
    // "." no parsea a número finito → no fijable (Number(".")=NaN, no se publica como 0).
    expect(input).toHaveValue('.');
    const save = within(dialog).getByRole('button', { name: 'Guardar precio' });
    expect(save).toBeDisabled();

    // Un clic no dispara el override: nunca se publica un ítem a MX$0.
    await user.click(save);
    expect(override).not.toHaveBeenCalled();
  });

  it('S-L1: un override VÁLIDO ("12.50") SÍ se fija como 1250 centavos (no se rompe el flujo legítimo)', async () => {
    const user = userEvent.setup();
    const override = vi.spyOn(api, 'overridePrice').mockResolvedValue({ ok: true });
    renderWithProviders(<M2View />, 'es');

    const buttons = await screen.findAllByRole('button', { name: 'Fijar precio' });
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog', { name: /Override manual de precio/ });
    const input = within(dialog).getByLabelText('Precio de referencia (MXN)') as HTMLInputElement;

    await user.type(input, '12.50');
    // El punto y el cero final SOBREVIVEN al saneo (solo se descartan puntos EXTRA).
    expect(input).toHaveValue('12.50');

    const save = within(dialog).getByRole('button', { name: 'Guardar precio' });
    expect(save).toBeEnabled();
    await user.click(save);

    // 12.50 pesos → 1250 centavos (no un 100× ni un 0).
    await waitFor(() => expect(override).toHaveBeenCalledTimes(1));
    expect(override).toHaveBeenCalledWith(expect.objectContaining({ priceMxnCents: 1250 }));
  });

  it('P-6 COMPRA pide context=buylist y es READ-ONLY (sin acción de fijar precio) + enlace a M5', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, 'getPendingPrices');
    renderWithProviders(<M2View />, 'es');

    await user.click(await screen.findByRole('tab', { name: /Compra/ }));
    // El bucket COMPRA consulta context=buylist.
    await waitFor(() => expect(spy).toHaveBeenCalledWith('buylist'));
    // Machamp (context=buylist) se muestra…
    expect((await screen.findAllByText('Machamp')).length).toBeGreaterThan(0);
    // …y es READ-ONLY: no hay botón de fijar precio en el panel de COMPRA.
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).queryByRole('button', { name: 'Fijar precio' })).toBeNull();
    // Nota + enlace al módulo de buylist (M5), donde SÍ se fija el precio de compra.
    expect(screen.getByRole('link', { name: /Abrir admin de buylist/ })).toBeInTheDocument();
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

  // ---- Barra de progreso del barrido MASIVO de PRECIOS (N-11) ----
  it('pinta la barra de progreso del barrido de precios cuando GET /pricing/sync-status reporta running', async () => {
    vi.spyOn(api, 'getPriceSyncStatus').mockResolvedValue({
      running: true,
      jobId: 'price-ingest-1',
      total: 12,
      done: 3,
      startedAt: '2026-08-19T00:00:00.000Z',
      finishedAt: null,
      lastError: null,
      dailyRemaining: null,
      dailyLimited: false,
      pending: 0,
      provider: 'pokemonpricetracker',
    });
    renderWithProviders(<M2View />, 'es');
    // Progreso honesto done/total + porcentaje (3/12 = 25%), con aviso de segundo plano.
    expect(await screen.findByText(/Actualizando precios… 3\/12 sets/)).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('al terminar el barrido de precios (running=false, total>0) muestra "completada"', async () => {
    vi.spyOn(api, 'getPriceSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'price-ingest-1',
      total: 12,
      done: 12,
      startedAt: '2026-08-19T00:00:00.000Z',
      finishedAt: '2026-08-19T00:10:00.000Z',
      lastError: null,
      dailyRemaining: null,
      dailyLimited: false,
      pending: 0,
      provider: 'pokemonpricetracker',
    });
    renderWithProviders(<M2View />, 'es');
    expect(
      await screen.findByText(/Actualización de precios completada: 12 set\(s\)/),
    ).toBeInTheDocument();
  });

  it('muestra el aviso de pausa por límite diario con los sets pendientes y el presupuesto restante', async () => {
    vi.spyOn(api, 'getPriceSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'price-ingest-1',
      total: 20,
      done: 8,
      startedAt: '2026-08-19T00:00:00.000Z',
      finishedAt: null,
      lastError: null,
      dailyRemaining: 0,
      dailyLimited: true,
      pending: 12,
      provider: 'pokemonpricetracker',
    });
    renderWithProviders(<M2View />, 'es');
    // Aviso claro (accesible via role="status") con el número de pendientes.
    expect(
      await screen.findByText(/Pausado por límite diario del proveedor/),
    ).toBeInTheDocument();
    expect(screen.getByText(/12 set\(s\) pendientes/)).toBeInTheDocument();
    // Presupuesto restante (0 → sigue mostrándose, no es null).
    expect(screen.getByText(/Presupuesto restante hoy: 0/)).toBeInTheDocument();
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

  it('INV-1: guardar buylist tras editar Common PRESERVA una regla SINTÉTICA no editada (Holo) que viene de getBuylistRules', async () => {
    // La tabla CRUDA del servidor tiene la clave sintética "Holo" (NO es Card.rarity → NO aparece
    // en /rarities). Antes se reconstruía `serverRules` desde la vista de rarezas y el PUT (reemplazo
    // total) borraba "Holo". Ahora el merge parte de la tabla cruda y la conserva.
    vi.spyOn(api, 'getBuylistRules').mockResolvedValue({
      rules: {
        Common: { mode: 'fixed', value: 50 },
        Holo: { mode: 'fixed', value: 1000 },
      },
      fallbackPct: 40,
    });
    const spy = vi.spyOn(api, 'updateBuylistRules').mockResolvedValue({ rules: {}, fallbackPct: 40 });
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Precio de buylist por rareza/);
    const valueInput = await s.findByLabelText('Valor para Common');
    fireEvent.change(valueInput, { target: { value: '1' } });
    fireEvent.click(s.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const arg = spy.mock.calls[0][0] as { rules: Record<string, { mode: string; value: number }> };
    // La clave sintética NO editada sobrevive al guardado…
    expect(arg.rules.Holo).toEqual({ mode: 'fixed', value: 1000 });
    // …y la rareza editada (Common) se aplica encima (1 peso → 100 centavos).
    expect(arg.rules.Common).toEqual({ mode: 'fixed', value: 100 });
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

  it('INV-1: guardar VENTA tras editar Common PRESERVA la regla SINTÉTICA "Holo" que viene de getSalesRules', async () => {
    // Seed real de venta: la clave "Holo" es sintética (§4.14b) y NO es Card.rarity → NO llega en
    // /sales-rarities. El bug: al reconstruir desde la vista de rarezas, el PUT (reemplazo total)
    // descartaba "Holo" y las cartas holo revertían a fallback / caían a pending. El merge cruda
    // la conserva.
    vi.spyOn(api, 'getSalesRules').mockResolvedValue({
      rules: {
        Common: { mode: 'fixed', value: 500 },
        Holo: { mode: 'fixed', value: 1000 },
      },
      fallbackPct: 15,
    });
    const spy = vi.spyOn(api, 'updateSalesRules').mockResolvedValue({ rules: {}, fallbackPct: 15 });
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    const valueInput = await s.findByLabelText('Valor para Common');
    // 20 pesos → 2000 centavos.
    fireEvent.change(valueInput, { target: { value: '20' } });
    fireEvent.click(s.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const arg = spy.mock.calls[0][0] as { rules: Record<string, { mode: string; value: number }> };
    // La clave sintética "Holo" sobrevive al guardado (no revierte a fallback → no cae a pending)…
    expect(arg.rules.Holo).toEqual({ mode: 'fixed', value: 1000 });
    // …y la rareza editada (Common) se aplica encima.
    expect(arg.rules.Common).toEqual({ mode: 'fixed', value: 2000 });
  });

  it('INV-1 robustez: si getSalesRules FALLA, Guardar queda DESHABILITADO (no no-op silencioso) y se explica por qué', async () => {
    // La tabla cruda es la base del merge money-safe; sin ella el guard hacía return silencioso con el
    // botón habilitado. Ahora el botón se gatea con `!salesRules.data` y se muestra un aviso con reintento.
    vi.spyOn(api, 'getSalesRules').mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    const spy = vi.spyOn(api, 'updateSalesRules');
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);

    // La vista de rarezas SÍ carga (editor visible), pero la tabla cruda falló → aviso claro.
    expect(await s.findByText(/No se pudo cargar la tabla de reglas/)).toBeInTheDocument();

    // Editar una rareza deja el borrador "sucio", pero Guardar sigue DESHABILITADO (no guardable).
    fireEvent.change(await s.findByLabelText('Valor para Common'), { target: { value: '20' } });
    const save = s.getByRole('button', { name: 'Guardar' });
    expect(save).toBeDisabled();

    // Un clic no dispara la mutación (nunca es un no-op silencioso: el botón ni siquiera responde).
    fireEvent.click(save);
    expect(spy).not.toHaveBeenCalled();
  });

  // ---- P-1: el input de valor por rareza (VENTA) debe aceptar decimales/tecleo/vaciado ----
  // Los tests de arriba usan un solo `fireEvent.change('20')` que NO reproduce el bug: el fallo
  // aparecía tecla-a-tecla (el punto decimal y el vaciado se destruían al re-derivar un número en
  // cada keystroke). Estos usan `userEvent.type` carácter a carácter.
  it('P-1: teclear un decimal ("12.50") en Valor para Common lo CONSERVA, habilita Guardar y envía 1250 centavos', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, 'updateSalesRules').mockResolvedValue({ rules: {}, fallbackPct: 15 });
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    const input = (await s.findByLabelText('Valor para Common')) as HTMLInputElement;
    // Seed: Common = { fixed, 500¢ } → el campo muestra "5" (pesos) al cargar (no un número crudo).
    expect(input).toHaveValue('5');

    await user.clear(input);
    await user.type(input, '12.50');
    // El punto decimal y el cero final SOBREVIVEN al tecleo (el bug los borraba en cada keystroke).
    expect(input).toHaveValue('12.50');

    const save = s.getByRole('button', { name: 'Guardar' });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // 12.50 pesos → 1250 centavos (no 1250 pesos ni un 100× de sobreprecio).
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: expect.objectContaining({ Common: { mode: 'fixed', value: 1250 } }),
      }),
    );
  });

  it('P-1: se puede VACIAR el campo de Valor para Common (no fuerza "0") y luego re-teclear', async () => {
    const user = userEvent.setup();
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    const input = (await s.findByLabelText('Valor para Common')) as HTMLInputElement;
    await user.clear(input);
    // El campo queda VACÍO (antes el vaciado se normalizaba a 0 y reaparecía "0").
    expect(input).toHaveValue('');
    await user.type(input, '7.25');
    expect(input).toHaveValue('7.25');
  });

  it('P-1 money-safe: cambiar el modo (fixed↔pct) NO arrastra el número entre semánticas', async () => {
    const user = userEvent.setup();
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    // Common arranca en fixed 500¢ → "5".
    expect((await s.findByLabelText('Valor para Common'))).toHaveValue('5');
    // Al pasar a % NO debe quedar "5" (500¢ no es 500%): el valor se limpia al voltear el modo.
    await user.selectOptions(s.getByLabelText('Modo para Common'), 'pct');
    expect(s.getByLabelText('Valor para Common')).toHaveValue('');
  });

  // ---- S-P1-1 (SECURITY): un valor con MÚLTIPLES PUNTOS o VACÍO no puede colar un MX$0 ----
  it('S-P1-1: teclear "1.2.3" en Valor para Common deja UN SOLO punto ("1.23") y Guardar NO envía 0', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, 'updateSalesRules').mockResolvedValue({ rules: {}, fallbackPct: 15 });
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    const input = (await s.findByLabelText('Valor para Common')) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '1.2.3');
    // El 2.º punto se descarta tecla-a-tecla: nunca se forma "1.2.3" (que casteaba a NaN→0).
    expect(input).toHaveValue('1.23');

    const save = s.getByRole('button', { name: 'Guardar' });
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // 1.23 pesos → 123 centavos; jamás 0 (giveaway) por el multi-punto.
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: expect.objectContaining({ Common: { mode: 'fixed', value: 123 } }),
      }),
    );
    const arg = spy.mock.calls[0][0] as { rules: Record<string, { value: number }> };
    expect(arg.rules.Common.value).not.toBe(0);
  });

  it('S-P1-1: VACIAR Valor para Common (regla tocada, vacía) DESHABILITA Guardar → no persiste {fixed,0}', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, 'updateSalesRules').mockResolvedValue({ rules: {}, fallbackPct: 15 });
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    const input = (await s.findByLabelText('Valor para Common')) as HTMLInputElement;
    await user.clear(input);
    expect(input).toHaveValue('');

    // La regla quedó "tocada" pero vacía → Guardar bloqueado y se explica por qué (money-safe).
    const save = s.getByRole('button', { name: 'Guardar' });
    expect(save).toBeDisabled();
    expect(s.getByText(/vac[íi]o o inv[áa]lido/i)).toBeInTheDocument();

    // Un clic no dispara la mutación: nunca se persiste {mode:'fixed', value:0}.
    await user.click(save);
    expect(spy).not.toHaveBeenCalled();
  });

  it('S-P1-1: un valor mal formado (solo ".") en una regla tocada DESHABILITA Guardar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<M2View />, 'es');
    const s = await sectionFor(/Reglas de precio de VENTA por rareza/);
    const input = (await s.findByLabelText('Valor para Common')) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '.');
    // "." no parsea a número finito → no guardable (Number(".")=NaN, no se persiste como 0).
    expect(input).toHaveValue('.');
    expect(s.getByRole('button', { name: 'Guardar' })).toBeDisabled();
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

  // ---- N-14: la barra de progreso aparece SIN recargar tras disparar el ingest ----
  it('N-14: tras "Actualizar precios ahora" la barra aparece sin recargar (refetch inmediato + poll proactivo)', async () => {
    vi.spyOn(api, 'triggerPriceIngest').mockResolvedValue({
      job: 'price-ingest',
      enqueued: true,
      jobId: 'pi-1',
    });
    // El backend tarda un instante en reportar `running`: la 1ª lectura (al montar) y la 2ª (el
    // refetch inmediato del onSuccess) AÚN reportan running:false — el job apenas se encoló. Solo
    // una lectura POSTERIOR ve running:true. Sin `justDispatched` el poll no arrancaría (el viejo
    // refetchInterval solo poll-ea si YA vio running) y la barra nunca saldría hasta recargar.
    let calls = 0;
    vi.spyOn(api, 'getPriceSyncStatus').mockImplementation(async () => {
      calls += 1;
      const running = calls >= 3;
      return {
        running,
        jobId: 'pi-1',
        total: running ? 10 : 0,
        done: running ? 2 : 0,
        startedAt: running ? '2026-08-19T00:00:00.000Z' : null,
        finishedAt: null,
        lastError: null,
        dailyRemaining: null,
        dailyLimited: false,
        pending: 0,
        provider: 'pokemonpricetracker',
      };
    });

    renderWithProviders(<M2View />, 'es');
    // Estado inicial: sin barrido (running:false, total:0) → NO hay barra todavía.
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    expect(screen.queryByText(/Actualizando precios…/)).toBeNull();

    // Dispara la actualización: el onSuccess refetch-ea de inmediato (call 2, aún running:false) y
    // marca justDispatched → el poll sigue vivo y la lectura siguiente (call 3) ve running:true.
    fireEvent.click(await screen.findByRole('button', { name: /Actualizar precios ahora/ }));

    // La barra aparece SIN recargar la página (la atrapa el poll proactivo, no una recarga).
    expect(
      await screen.findByText(/Actualizando precios… 2\/10 sets/, undefined, { timeout: 6000 }),
    ).toBeInTheDocument();
  });
});

/**
 * P-12 (v1.27): la acción por fila «Sync completo» encadena el flujo recomendado del contrato
 * (§M2 v1.27): (1) POST /admin/catalog/sync {setId, force:true} → cartas + variantes TCGCSV;
 * (2) POST /admin/jobs/price-ingest {setId} → precios del set completo. El feedback es HONESTO
 * por fase (nunca un "202 cosmético"): éxito solo si el ingest encoló; single-flight y fallos
 * de cada fase se dicen tal cual.
 */
describe('M2 · «Sync completo» por set (P-12, v1.27)', () => {
  it('encadena syncCatalog({setId, force:true}) → triggerPriceIngest({setId}) y reporta el éxito de AMBAS fases', async () => {
    const syncSpy = vi.spyOn(api, 'syncCatalog').mockResolvedValue({
      jobId: 'j-cat-1',
      setsQueued: 1,
      mode: 'single',
    });
    const ingestSpy = vi.spyOn(api, 'triggerPriceIngest').mockResolvedValue({
      job: 'price-ingest',
      enqueued: true,
      jobId: 'j-pi-1',
      scope: 'set',
      setId: 'sv08',
    });

    renderWithProviders(<M2View />, 'es');

    // Fila de Surging Sparks (sv08, primer set del mock de remote-sets). El DataTable pinta la
    // fila dos veces (tabla desktop + tarjeta móvil) → se toma el primer botón.
    const [btn] = await screen.findAllByRole('button', { name: /Sync completo de Surging Sparks/ });
    fireEvent.click(btn);

    // Fase 1: sync de catálogo POR SET con force (refresca variantes estructurales TCGCSV).
    await waitFor(() => expect(syncSpy).toHaveBeenCalledWith({ setId: 'sv08', force: true }));
    // Fase 2: ingest de precios de ESE set, DESPUÉS de la fase 1.
    await waitFor(() => expect(ingestSpy).toHaveBeenCalledWith({ setId: 'sv08' }));
    expect(syncSpy.mock.invocationCallOrder[0]).toBeLessThan(ingestSpy.mock.invocationCallOrder[0]);

    // Éxito HONESTO: solo se declara cuando el ingest sí encoló.
    expect(
      await screen.findByText(/Sync completo de Surging Sparks: cartas y variantes actualizadas; precios del set encolados/),
    ).toBeInTheDocument();
  });

  it('single-flight del ingest (enqueued:false) → aviso de que los precios NO se encolaron, no un éxito', async () => {
    vi.spyOn(api, 'syncCatalog').mockResolvedValue({ jobId: 'j-cat-2', setsQueued: 1, mode: 'single' });
    vi.spyOn(api, 'triggerPriceIngest').mockResolvedValue({ job: 'price-ingest', enqueued: false });

    renderWithProviders(<M2View />, 'es');
    fireEvent.click((await screen.findAllByRole('button', { name: /Sync completo de Surging Sparks/ }))[0]);

    // La fase de cartas SÍ corrió, pero el ingest no encoló (ya había un barrido): se dice tal cual.
    expect(await screen.findByText(/los precios de este set NO se encolaron/)).toBeInTheDocument();
    expect(screen.queryByText(/precios del set encolados/)).toBeNull();
  });

  it('si la fase de cartas FALLA, se reporta esa fase y NO se dispara el ingest de precios', async () => {
    vi.spyOn(api, 'syncCatalog').mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    const ingestSpy = vi.spyOn(api, 'triggerPriceIngest');

    renderWithProviders(<M2View />, 'es');
    fireEvent.click((await screen.findAllByRole('button', { name: /Sync completo de Surging Sparks/ }))[0]);

    expect(
      await screen.findByText(/Sync completo de Surging Sparks: falló la fase de cartas\/variantes; NO se encolaron precios\./),
    ).toBeInTheDocument();
    expect(ingestSpy).not.toHaveBeenCalled();
  });
});

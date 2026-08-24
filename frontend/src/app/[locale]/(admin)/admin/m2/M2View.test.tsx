import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { M2View } from './M2View';
import * as api from '@/lib/api';
import type { CurvePreviewLegDTO, CurvePreviewRowDTO } from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';

// El `Link` de next-intl (`@/i18n/navigation`) no resuelve bajo vitest; se stubea a un <a>
// que preserva href/aria-label (enlace del bucket COMPRA al admin de buylist, M5).
// M2 es un módulo `super_admin` (la página lo envuelve en SuperAdminOnly); el editor de la curva
// además NO se renderiza para vault_operator (§21.1: la curva es dinero de los dos lados). El rol
// es controlable por test.
const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: true,
  }),
}));

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
  it('muestra los TRES grupos de operaciones (§19), FX y la cola pendiente', async () => {
    renderWithProviders(<M2View />, 'es');
    expect(screen.getByRole('heading', { level: 1, name: /Catálogo y precios/ })).toBeInTheDocument();
    // §19.1: los tres grupos reemplazan las viejas secciones «Operaciones avanzadas» + «Sync de bóveda».
    expect(screen.getByRole('heading', { name: /Datos \(rápido · TCGCSV\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Catálogo \(cartas nuevas/ })).toBeInTheDocument();
    // «Avanzado» es un <summary> plegado por defecto.
    expect(screen.getByText(/Avanzado — operaciones pesadas/)).toBeInTheDocument();
    // FX carga async desde el mock.
    expect(await screen.findByText('18.4200')).toBeInTheDocument();
  });

  it('lista la cola de precio pendiente desde la API', async () => {
    renderWithProviders(<M2View />, 'es');
    expect((await screen.findAllByText('Zapdos')).length).toBeGreaterThan(0);
  });

  // §19.6: la sección legacy «Sync de precios (bóveda)» (B) se RETIRÓ del panel.
  it('§19.6: el panel ya NO muestra el sync de precios de bóveda (B) ni el mapa de rarezas', () => {
    renderWithProviders(<M2View />, 'es');
    expect(screen.queryByRole('button', { name: /Lanzar sync de precios/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Sync de precios \(bóveda\)/ })).toBeNull();
    // rarity-map muerto: su editor tampoco aparece.
    expect(screen.queryByText(/Rareza → categoría de buylist/)).toBeNull();
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
    await waitFor(() => expect(spy).toHaveBeenCalledWith('inventory', undefined));
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

  /**
   * §21.7c + contrato §M2 v2.1 — el conteo por motivo **viene servido** en el cuerpo. La propiedad
   * que importa: los `counts` IGNORAN `?reason=` (pero respetan `?context=`), así que el encabezado
   * describe LA COLA, no el subconjunto filtrado. Derivarlo de la página cargada era el defecto:
   * el número mentía justo cuando el dueño filtraba para triar.
   */
  it('el encabezado pinta los counts del SERVIDOR verbatim — no los deriva de la lista', async () => {
    vi.spyOn(api, 'getPendingPrices').mockResolvedValue({
      // La lista trae UNA fila (como si viniera filtrada o paginada)…
      data: [
        {
          id: 'ppe-x',
          cardId: 'c-zapdos',
          productType: 'raw',
          gradeKey: 'raw:NM',
          finish: 'holofoil',
          context: 'inventory',
          status: 'open',
          reason: 'premium_at_floor',
          createdAt: '2026-08-24T07:30:00Z',
          cardName: 'Zapdos',
        },
      ],
      // …y los counts describen la COLA COMPLETA. Se pintan tal cual: 12 ≠ 1.
      counts: { no_market: 12, premium_at_floor: 3, unknown: 0 },
    });
    renderWithProviders(<M2View />, 'es');

    const counts = await screen.findByTestId('pending-counts');
    expect(counts).toHaveTextContent('12 sin mercado');
    expect(counts).toHaveTextContent('3 premium en el piso');
    // Con `unknown: 0` la clave no añade ruido a una cola sana.
    expect(counts).not.toHaveTextContent('sin motivo');
  });

  it('filtrar por motivo NO cambia el encabezado (los counts ignoran ?reason=)', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, 'getPendingPrices').mockResolvedValue({
      data: [],
      counts: { no_market: 12, premium_at_floor: 3, unknown: 0 },
    });
    renderWithProviders(<M2View />, 'es');
    await screen.findByTestId('pending-counts');

    await user.click(screen.getByRole('button', { name: 'Premium en el piso' }));
    // El filtro SÍ viaja al servidor…
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('inventory', 'premium_at_floor'),
    );
    // …pero el encabezado sigue describiendo la cola entera: no dice «0 sin mercado».
    expect(await screen.findByTestId('pending-counts')).toHaveTextContent('12 sin mercado');
  });

  it('`unknown` (filas anteriores a M-41) se pinta: sostiene el invariante con la lista', async () => {
    vi.spyOn(api, 'getPendingPrices').mockResolvedValue({
      data: [],
      counts: { no_market: 1, premium_at_floor: 1, unknown: 2 },
    });
    renderWithProviders(<M2View />, 'es');
    // Sin la tercera clave, 1+1 no cuadraría con las 4 entradas de la cola y parecería un bug
    // del backend. La columna Motivo ya pinta «—» para esas filas.
    expect(await screen.findByTestId('pending-counts')).toHaveTextContent('2 sin motivo');
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

  // ---- P-33: el selector de «proveedor de respaldo» se RETIRÓ del panel ----
  it('P-33: ya NO aparece el selector de proveedor de respaldo (fallback) ni su bloque', async () => {
    renderWithProviders(<M2View />, 'es');
    // El botón de ingesta a mano sigue: garantiza que M2 montó por completo antes de aseverar ausencias.
    expect(await screen.findByRole('button', { name: /Actualizar precios ahora/ })).toBeInTheDocument();
    // El Select del proveedor de respaldo y su sección ya no existen en el DOM.
    expect(screen.queryByLabelText('Proveedor de respaldo (fallback)')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Ingesta masiva de precios/ })).toBeNull();
    expect(screen.queryByText(/Precedencia: TCGCSV \(primario\)/)).toBeNull();
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
  // §19.4: H («Sync completo») ya no es un botón del renglón; vive en el menú overflow «Más ▾» por-fila.
  // El helper abre ese menú (DataTable pinta la fila 2 veces → se toma el primero) y pica el menuitem.
  async function triggerFullSync() {
    const [more] = await screen.findAllByRole('button', { name: /Más acciones para Surging Sparks/ });
    fireEvent.click(more);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Sync completo de Surging Sparks/ }));
  }

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

    // Fila de Surging Sparks (sv08, primer set del mock de remote-sets): abre «Más» y pica «Sync completo».
    await triggerFullSync();

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
    await triggerFullSync();

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
    await triggerFullSync();

    expect(
      await screen.findByText(/Sync completo de Surging Sparks: falló la fase de cartas\/variantes; NO se encolaron precios\./),
    ).toBeInTheDocument();
    expect(ingestSpy).not.toHaveBeenCalled();
  });
});

/**
 * §19.5: «Unificar rarezas» — anclado al editor de reglas por rareza (NO en Datos). Confirmación
 * one-shot money-safe; dispara POST /admin/catalog/unify-rarities (backfill LOCAL de rarityCanonical);
 * muestra un resumen HONESTO (cuántas actualizó + rarezas `unmapped` accionables) y recompone el
 * editor invalidando sus queries de rarezas.
 */
describe('M2 · «Unificar rarezas» (§19.5)', () => {
  const okResponse = {
    ok: true as const,
    cardsProcessed: 12000,
    cardsUpdated: 3400,
    distinctCanonical: 21,
    unmapped: [{ raw: 'Galaxy Foil', canonical: 'Galaxy Foil', count: 40 }],
  };

  it('confirma y dispara unifyRarities, mostrando el resumen honesto + la lista de unmapped', async () => {
    const spy = vi.spyOn(api, 'unifyRarities').mockResolvedValue(okResponse);
    renderWithProviders(<M2View />, 'es');

    // El botón vive junto al editor de reglas por rareza (Sección 4), no en el grupo Datos.
    fireEvent.click(await screen.findByRole('button', { name: /Unificar rarezas/ }));
    // Picar NO llama de inmediato: abre la confirmación one-shot.
    const dialog = await screen.findByRole('dialog', { name: /Unificar rarezas del catálogo/ });
    expect(spy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: /Unificar rarezas/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // Endpoint sin parámetros (backfill local money-safe).
    expect(spy).toHaveBeenCalledWith();

    // Resumen honesto: éxito + cuántas actualizó + lista de rarezas sin mapear (accionable).
    expect(await screen.findByText(/Rarezas unificadas/)).toBeInTheDocument();
    expect(screen.getByText(/3400 de 12000 carta\(s\) actualizadas/)).toBeInTheDocument();
    expect(screen.getByText(/sin mapear/)).toBeInTheDocument();
    expect(screen.getByText('Galaxy Foil')).toBeInTheDocument();
  });

  it('cancelar la confirmación no llama al endpoint (money-safe)', async () => {
    const spy = vi.spyOn(api, 'unifyRarities');
    renderWithProviders(<M2View />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Unificar rarezas/ }));
    const dialog = await screen.findByRole('dialog', { name: /Unificar rarezas del catálogo/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancelar/ }));

    expect(spy).not.toHaveBeenCalled();
  });

});

/**
 * §19.4: la acción por-fila H («Sync completo») está ESCONDIDA en un menú overflow «Más ▾» accesible
 * (aria-haspopup="menu"), no en el renglón principal; I (Variantes + precios) y G (Importar/Re-sync)
 * siguen como botones directos con I primero.
 */
describe('M2 · jerarquía por-fila (§19.4)', () => {
  it('I y G son botones directos; H («Sync completo») solo aparece al abrir el menú «Más»', async () => {
    renderWithProviders(<M2View />, 'es');
    // I: acción primaria por-fila (aria-label estable). G: importar/re-sincronizar.
    expect(
      (await screen.findAllByRole('button', {
        name: /Refrescar variantes y precios de Surging Sparks usando solo TCGCSV/,
      })).length,
    ).toBeGreaterThan(0);
    // H NO está en el renglón: no hay un botón/menuitem «Sync completo» hasta abrir el menú.
    expect(screen.queryByRole('menuitem', { name: /Sync completo de Surging Sparks/ })).toBeNull();

    const [more] = await screen.findAllByRole('button', { name: /Más acciones para Surging Sparks/ });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(more);
    // Al abrir, H aparece como menuitem con su label completo.
    expect(
      await screen.findByRole('menuitem', { name: /Sync completo de Surging Sparks/ }),
    ).toBeInTheDocument();
  });
});

/**
 * P-13: la acción por fila «Variantes + precios (solo TCGCSV)» refresca variantes/acabados y
 * precios de un set YA importado usando SOLO TCGCSV (POST /admin/catalog/refresh-variants). NO
 * re-importa cartas ni depende de pokemontcg.io, de modo que una caída de pokemontcg.io no bloquee
 * arreglar el "fantasma" de un set. El feedback es un resumen HONESTO (money-safe) y los errores
 * del contrato (SET_NOT_IMPORTED, UPSTREAM_ERROR) se muestran legibles sin romper la pantalla.
 */
describe('M2 · «Refrescar variantes + precios (solo TCGCSV)» por set (P-13)', () => {
  it('dispara refreshVariants({setId}) y muestra el resumen (cartas / productos / precios)', async () => {
    const spy = vi.spyOn(api, 'refreshVariants').mockResolvedValue({
      ok: true,
      setId: 'sv08',
      cardsProcessed: 191,
      cardProductsUpserted: 260,
      pricesUpserted: 260,
      pending: 0,
      tcgcsvReachable: true,
    });
    renderWithProviders(<M2View />, 'es');
    const [btn] = await screen.findAllByRole('button', {
      name: /Refrescar variantes y precios de Surging Sparks usando solo TCGCSV/,
    });
    fireEvent.click(btn);

    // Solo TCGCSV: llama al endpoint con el setId, SIN encadenar syncCatalog ni pokemontcg.io.
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ setId: 'sv08' }));
    // Resumen honesto de lo procesado.
    expect(
      await screen.findByText(/191 carta\(s\) procesadas · 260 producto\(s\)\/variante\(s\) actualizados · 260 precio\(s\) actualizados\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/refrescados desde TCGCSV/)).toBeInTheDocument();
  });

  it('money-safe: si quedan productos sin precio (pending>0) lo refleja honesto (warning), no "todo listo"', async () => {
    vi.spyOn(api, 'refreshVariants').mockResolvedValue({
      ok: true,
      setId: 'sv08',
      cardsProcessed: 191,
      cardProductsUpserted: 260,
      pricesUpserted: 258,
      pending: 2,
      tcgcsvReachable: true,
    });
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(
      (await screen.findAllByRole('button', {
        name: /Refrescar variantes y precios de Surging Sparks usando solo TCGCSV/,
      }))[0],
    );

    // Resultado PARCIAL + conteo real de pendientes (no se inventa que todo quedó con precio).
    expect(await screen.findByText(/resultado parcial/)).toBeInTheDocument();
    expect(screen.getByText(/2 producto\(s\) quedaron sin precio/)).toBeInTheDocument();
  });

  it('money-safe: si TCGCSV no fue alcanzable del todo (tcgcsvReachable=false) avisa resultado parcial', async () => {
    vi.spyOn(api, 'refreshVariants').mockResolvedValue({
      ok: true,
      setId: 'sv08',
      cardsProcessed: 100,
      cardProductsUpserted: 120,
      pricesUpserted: 90,
      pending: 30,
      tcgcsvReachable: false,
    });
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(
      (await screen.findAllByRole('button', {
        name: /Refrescar variantes y precios de Surging Sparks usando solo TCGCSV/,
      }))[0],
    );

    expect(await screen.findByText(/TCGCSV no respondió por completo/)).toBeInTheDocument();
  });

  it('UPSTREAM_ERROR (502, TCGCSV caído) se muestra legible y NO rompe la pantalla', async () => {
    vi.spyOn(api, 'refreshVariants').mockRejectedValue(
      new ApiClientError(502, { code: 'UPSTREAM_ERROR', message: 'tcgcsv down' }),
    );
    renderWithProviders(<M2View />, 'es');
    fireEvent.click(
      (await screen.findAllByRole('button', {
        name: /Refrescar variantes y precios de Surging Sparks usando solo TCGCSV/,
      }))[0],
    );

    // Copy legible del contrato (error.UPSTREAM_ERROR) + banner de alerta; la vista sigue viva.
    expect(await screen.findByText(/TCGCSV no está disponible en este momento/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Catálogo y precios/ })).toBeInTheDocument();
  });

  it('SET_NOT_IMPORTED se muestra legible (set no está en BD)', async () => {
    vi.spyOn(api, 'refreshVariants').mockRejectedValue(
      new ApiClientError(409, { code: 'SET_NOT_IMPORTED', message: 'not imported' }),
    );
    renderWithProviders(<M2View />, 'es');
    // Surging Sparks está importado (botón habilitado); el backend igual puede responder SET_NOT_IMPORTED.
    fireEvent.click(
      (await screen.findAllByRole('button', {
        name: /Refrescar variantes y precios de Surging Sparks usando solo TCGCSV/,
      }))[0],
    );

    expect(
      await screen.findByText(/Ese set aún no está importado; impórtalo antes de refrescar sus variantes\./),
    ).toBeInTheDocument();
  });

  it('el botón está DESHABILITADO para un set no importado (evita el SET_NOT_IMPORTED obvio)', async () => {
    renderWithProviders(<M2View />, 'es');
    // Temporal Forces (sv05) NO está importado en el mock → la acción TCGCSV queda deshabilitada.
    const [btn] = await screen.findAllByRole('button', {
      name: /Refrescar variantes y precios de Temporal Forces usando solo TCGCSV/,
    });
    expect(btn).toBeDisabled();
  });
});

/**
 * RV-ALL: el botón GLOBAL «Refrescar variantes + precios de TODO (solo TCGCSV)» corre el batch sobre
 * TODO el catálogo YA importado. Es ASÍNCRONO: POST /admin/catalog/refresh-variants-all responde 202
 * `{ jobId, setsQueued, remaining }` (solo arranca) y el progreso/resumen se leen por su STATUS PROPIO
 * GET /admin/catalog/refresh-variants-status (NO el sync-status de sync-all). Pide confirmación (es
 * masivo); al terminar el status trae un RESUMEN AGREGADO honesto (sets ok/fallidos, productos,
 * precios, pendientes y la lista legible de `failures`).
 */
describe('M2 · «Refrescar variantes + precios de TODO (solo TCGCSV)» batch (RV-ALL)', () => {
  // Estado inicial del status (sin batch previo): nada que mostrar en el montaje.
  const idleStatus = {
    running: false,
    jobId: null,
    total: 0,
    done: 0,
    startedAt: null,
    finishedAt: null,
    summary: null,
  } as const;

  it('POST 202 solo arranca; confirmar dispara refreshVariantsAll y el STATUS PROPIO trae el resumen', async () => {
    const postSpy = vi
      .spyOn(api, 'refreshVariantsAll')
      .mockResolvedValue({ jobId: 'rv-1', setsQueued: 12, remaining: 0 });
    // 1ª lectura (montaje): sin summary. Tras disparar: status terminal con el resumen agregado.
    vi.spyOn(api, 'getRefreshVariantsStatus')
      .mockResolvedValueOnce({ ...idleStatus })
      .mockResolvedValue({
        running: false,
        jobId: 'rv-1',
        total: 12,
        done: 12,
        startedAt: '2026-08-22T00:00:00.000Z',
        finishedAt: '2026-08-22T00:05:00.000Z',
        summary: {
          setsTotal: 12,
          setsOk: 12,
          setsFailed: 0,
          cardProductsUpserted: 3200,
          pricesUpserted: 3200,
          pending: 0,
          failures: [],
        },
      });
    renderWithProviders(<M2View />, 'es');

    // Picar el botón NO llama de inmediato: abre el modal de confirmación (operación masiva).
    fireEvent.click(
      await screen.findByRole('button', { name: /Refrescar variantes \+ precios \(todo\)/ }),
    );
    expect(
      await screen.findByRole('dialog', {
        name: /Refrescar variantes \+ precios de TODO el catálogo \(solo TCGCSV\)/,
      }),
    ).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();

    // Confirmar dispara el POST del batch SIN forzar (body mínimo).
    fireEvent.click(screen.getByRole('button', { name: /Sí, refrescar todo el catálogo/ }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));

    // El resumen NO viene del POST: se lee del STATUS PROPIO tras terminar (sets ok/total + productos + precios).
    expect(
      await screen.findByText(
        /12\/12 set\(s\) refrescados · 3200 producto\(s\)\/variante\(s\) actualizados · 3200 precio\(s\) actualizados\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/refrescados desde TCGCSV/)).toBeInTheDocument();
  });

  it('pinta la barra de progreso done/total desde el STATUS PROPIO cuando reporta running', async () => {
    vi.spyOn(api, 'getRefreshVariantsStatus').mockResolvedValue({
      running: true,
      jobId: 'rv-2',
      total: 12,
      done: 4,
      startedAt: '2026-08-22T00:00:00.000Z',
      finishedAt: null,
      summary: null,
    });
    renderWithProviders(<M2View />, 'es');

    // Progreso honesto done/total (4/12 = 33%) desde el endpoint de status del batch (no sync-status).
    expect(await screen.findByText(/Refrescando catálogo desde TCGCSV… 4\/12 sets/)).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('cancelar la confirmación no llama al endpoint', async () => {
    const spy = vi.spyOn(api, 'refreshVariantsAll');
    vi.spyOn(api, 'getRefreshVariantsStatus').mockResolvedValue({ ...idleStatus });
    renderWithProviders(<M2View />, 'es');

    fireEvent.click(
      await screen.findByRole('button', { name: /Refrescar variantes \+ precios \(todo\)/ }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: /Refrescar variantes \+ precios de TODO el catálogo \(solo TCGCSV\)/,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancelar/ }));

    expect(spy).not.toHaveBeenCalled();
  });

  it('money-safe: sets fallidos y pendientes del summary se reflejan honestos (warning) con la lista de failures', async () => {
    vi.spyOn(api, 'refreshVariantsAll').mockResolvedValue({ jobId: 'rv-3', setsQueued: 12, remaining: 0 });
    vi.spyOn(api, 'getRefreshVariantsStatus')
      .mockResolvedValueOnce({ ...idleStatus })
      .mockResolvedValue({
        running: false,
        jobId: 'rv-3',
        total: 12,
        done: 12,
        startedAt: '2026-08-22T00:00:00.000Z',
        finishedAt: '2026-08-22T00:05:00.000Z',
        summary: {
          setsTotal: 12,
          setsOk: 11,
          setsFailed: 1,
          cardProductsUpserted: 2900,
          pricesUpserted: 2850,
          pending: 50,
          failures: [{ setId: 'sv08', code: 'UPSTREAM_ERROR', message: 'TCGCSV no respondió para este set' }],
        },
      });
    renderWithProviders(<M2View />, 'es');

    fireEvent.click(
      await screen.findByRole('button', { name: /Refrescar variantes \+ precios \(todo\)/ }),
    );
    fireEvent.click(await screen.findByRole('button', { name: /Sí, refrescar todo el catálogo/ }));

    // Resultado PARCIAL + conteo real de pendientes (no se inventa que todo quedó con precio).
    expect(await screen.findByText(/resultado parcial/)).toBeInTheDocument();
    expect(screen.getByText(/50 producto\(s\) quedaron sin precio/)).toBeInTheDocument();
    // Lista honesta de fallidos: título con el conteo + set (nombre resuelto) con su motivo legible.
    expect(screen.getByText(/1 set\(s\) fallaron y NO se refrescaron:/)).toBeInTheDocument();
    expect(screen.getByText(/TCGCSV no respondió para este set/)).toBeInTheDocument();
    // El setId se muestra para poder identificarlo aunque no resuelva a nombre.
    expect(screen.getByText(/\(sv08\)/)).toBeInTheDocument();
  });

  it('un error al ARRANCAR el batch (POST) se muestra legible (banner danger) y NO rompe la pantalla', async () => {
    vi.spyOn(api, 'refreshVariantsAll').mockRejectedValue(
      new ApiClientError(502, { code: 'UPSTREAM_ERROR', message: 'tcgcsv down' }),
    );
    vi.spyOn(api, 'getRefreshVariantsStatus').mockResolvedValue({ ...idleStatus });
    renderWithProviders(<M2View />, 'es');

    fireEvent.click(
      await screen.findByRole('button', { name: /Refrescar variantes \+ precios \(todo\)/ }),
    );
    fireEvent.click(await screen.findByRole('button', { name: /Sí, refrescar todo el catálogo/ }));

    expect(await screen.findByText(/No se pudo refrescar el catálogo completo desde TCGCSV\./)).toBeInTheDocument();
    // La vista sigue viva (el encabezado M2 sigue presente).
    expect(screen.getByRole('heading', { level: 1, name: /Catálogo y precios/ })).toBeInTheDocument();
  });
});


/**
 * v2.0 (P-48) · **Editor de la CURVA de precio por valor de mercado** (§21.1–§21.7). Sustituye a los
 * cuatro editores retirados. Se verifica: la anatomía de la pantalla, que la columna derivada y el
 * previsualizador salen del **dry-run del servidor** (nunca de una cuenta del cliente), el
 * reordenamiento por mercado al `blur`, el punto nuevo NEUTRO por construcción, el borrado con
 * deshacer, el guardado con diff y el `422` que no guarda nada.
 */
describe('M2 · Editor de la curva de precio (P-48, v2.0)', () => {
  const CURVE_RE = /Curva de precio/;

  async function curveSection() {
    const heading = await screen.findByRole('heading', { name: CURVE_RE, level: 2 });
    const section = heading.closest('section');
    if (!section) throw new Error('section not found');
    return within(section);
  }

  /**
   * Respuesta del dry-run construida a mano: es el SERVIDOR quien calcula (ARCH §4.36.8a), así que
   * el test fija las cifras y comprueba que la pantalla pinta EXACTAMENTE eso. No se replica aquí
   * la matemática de §4.36.1 — hacerlo sería la duplicación que el endpoint existe para matar.
   */
  function leg(over: Partial<CurvePreviewLegDTO> = {}): CurvePreviewLegDTO {
    return {
      priceCents: 7000,
      basis: 'market',
      appliedBp: 14409,
      rawCents: 6978,
      constantCents: 2500,
      constantWon: false,
      baseCents: 6978,
      roundingStepCents: 500,
      segment: { fromIndex: 0, toIndex: 1 },
      ...over,
    };
  }

  function previewRow(
    marketCents: number,
    over: Partial<CurvePreviewRowDTO> = {},
  ): CurvePreviewRowDTO {
    return {
      marketCents,
      draft: { sale: leg(), buy: leg({ priceCents: 1734, roundingStepCents: null }) },
      saved: { sale: leg(), buy: leg({ priceCents: 1734, roundingStepCents: null }) },
      deltaCents: { sale: 0, buy: 0 },
      ...over,
    };
  }

  /** Espía del dry-run: responde SIEMPRE las sondas que se le piden. */
  function mockPreview(rowFor: (m: number) => CurvePreviewRowDTO = previewRow) {
    return vi.spyOn(api, 'previewPricingCurve').mockImplementation(async (req) => ({
      rows: [...req.marketsCents].sort((a, b) => a - b).map(rowFor),
      violations: [],
    }));
  }

  it('§21.0: la pantalla vieja de tiers SE RETIRÓ, con su texto falso incluido', async () => {
    mockPreview();
    renderWithProviders(<M2View />, 'es');
    await screen.findByRole('heading', { name: CURVE_RE, level: 2 });

    // Los cuatro editores retirados no dejan residuo…
    expect(screen.queryByRole('heading', { name: /Precios por tier/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Asignación de rarezas a tiers/ })).toBeNull();
    expect(screen.queryByText(/Reglas de buylist/)).toBeNull();
    expect(screen.queryByText(/Reglas de venta por rareza/)).toBeNull();
    // …y con ellos se va la MENTIRA que causó P-48: el código nunca heredó la regla del tier.
    expect(screen.queryByText(/hereda la del tier de su rareza/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/Hereda tier/i)).toBeNull();
    // Tampoco quedan los modos excluyentes fijo/porcentaje.
    expect(screen.queryByText('Fijo (MX$)')).toBeNull();
  });

  it('§21.1/§21.3: anatomía — constantes con su ayuda de COMPORTAMIENTO, venta, redondeo y compra', async () => {
    mockPreview();
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();

    // Las dos ayudas son el antídoto de P-48: describen qué HACE el número, no su rol abstracto.
    expect(await s.findByText(/Ninguna carta se publica por debajo de este precio/)).toBeInTheDocument();
    expect(s.getByText(/Nunca pagamos menos que esto/)).toBeInTheDocument();
    // El guardarraíl se enuncia junto al dial que lo dispara.
    expect(s.getByText(/rareza premium que aterrice en el piso no se publica/i)).toBeInTheDocument();
    // Orden VENTA → REDONDEO → COMPRA (el redondeo anida en venta: la compra no se redondea).
    expect(s.getByRole('group', { name: 'Venta' })).toBeInTheDocument();
    expect(s.getByRole('group', { name: 'Compra' })).toBeInTheDocument();
    expect(s.getByText(/La compra no se redondea/)).toBeInTheDocument();
    // Semilla §N.2: dos puntos de venta y tres de compra.
    expect(s.getAllByTestId('curve-point-sale')).toHaveLength(2);
    expect(s.getAllByTestId('curve-point-buy')).toHaveLength(3);
    // Unidades de PANTALLA: pesos, × y % — nunca centavos ni puntos base.
    expect((s.getByLabelText('Multiplicador del punto 1') as HTMLInputElement).value).toBe('1.60');
    expect((s.getByLabelText('Pago del punto 1') as HTMLInputElement).value).toBe('30');
    expect(s.queryByDisplayValue('16000')).toBeNull();
  });

  it('§21.2/§21.5: la columna derivada y la tabla de referencia salen del DRY-RUN, no de una cuenta local', async () => {
    // El servidor dice 88.88; la pantalla tiene que decir 88.88 aunque no cuadre con ninguna
    // fórmula que el cliente pudiera inventar. Esa es exactamente la propiedad que se quiere.
    const spy = mockPreview((m) =>
      previewRow(m, {
        draft: { sale: leg({ priceCents: 8888 }), buy: leg({ priceCents: 1234 }) },
        saved: { sale: leg({ priceCents: 7000 }), buy: leg({ priceCents: 1100 }) },
        deltaCents: { sale: 1888, buy: 134 },
      }),
    );
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();

    await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 3000 });
    // El request lleva SOLO el borrador + sondas: la curva vigente la resuelve el servidor.
    const req = spy.mock.calls[0][0];
    expect(Object.keys(req).sort()).toEqual(['draft', 'marketsCents']);
    expect(req.marketsCents.length).toBeGreaterThan(0);
    expect(req.marketsCents.length).toBeLessThanOrEqual(50);
    // Los diez mercados de la prueba de mesa (§4.36.1) viajan como sondas.
    for (const m of [114, 1000, 2500, 5000, 8000, 8600, 8700, 10000, 30000, 50000]) {
      expect(req.marketsCents).toContain(m);
    }

    expect((await s.findAllByText('MX$88.88')).length).toBeGreaterThan(0);
    expect(s.getAllByTestId('curve-reference-row').length).toBeGreaterThanOrEqual(10);
  });

  it('§21.5a: la probeta pinta VIGENTE contra BORRADOR con la memoria de cálculo del servidor', async () => {
    mockPreview((m) =>
      previewRow(m, {
        draft: {
          sale: leg({ priceCents: 7500, appliedBp: 14409, rawCents: 6978, roundingStepCents: 500 }),
          buy: leg({ priceCents: 1734, appliedBp: 3467, rawCents: 1734, roundingStepCents: null }),
        },
        saved: { sale: leg({ priceCents: 7000 }), buy: leg({ priceCents: 1667 }) },
        deltaCents: { sale: 500, buy: 67 },
      }),
    );
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();

    expect(await s.findByText('Probar un mercado')).toBeInTheDocument();
    // Memoria de cálculo: multiplicador aplicado, producto ANTES de redondear y paso usado. Las
    // cifras son las que devolvió el servidor (`rawCents`), no una multiplicación del cliente.
    expect(
      await s.findByText(/50\.00 × 1\.44× = 69\.78 → ↑ MX\$75\.00 \(paso MX\$5\.00\)/),
    ).toBeInTheDocument();
    expect(s.getByText(/Compra: 50\.00 × 34\.67% = 17\.34/)).toBeInTheDocument();
  });

  it('§21.5: sin dry-run disponible el previsualizador NO inventa cifras: muestra su error', async () => {
    vi.spyOn(api, 'previewPricingCurve').mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();
    expect(await s.findByText(/No se puede previsualizar ahora/)).toBeInTheDocument();
    expect(
      s.getByText(/necesita el cálculo del servidor: no se muestran cifras estimadas/),
    ).toBeInTheDocument();
  });

  it('§21.2a: mover un punto = cambiar su mercado; la tabla reordena AL BLUR y lo anuncia', async () => {
    mockPreview();
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();

    const first = (await s.findByLabelText('Mercado del punto 1 de venta')) as HTMLInputElement;
    expect(first.value).toBe('25.00');
    // Mientras se teclea NO se reordena (una fila que salta de sitio a media escritura es el gesto
    // que produce un error que nadie recuerda haber hecho).
    fireEvent.change(first, { target: { value: '900' } });
    expect((s.getByLabelText('Mercado del punto 1 de venta') as HTMLInputElement).value).toBe('900');
    // Al salir del campo, sí: el orden se DERIVA del mercado.
    fireEvent.blur(first);
    await waitFor(() =>
      expect((s.getByLabelText('Mercado del punto 2 de venta') as HTMLInputElement).value).toBe('900'),
    );
    expect(screen.getByText(/quedó en la posición 2 de 2/)).toBeInTheDocument();
    // No hay asas de arrastre: el orden no es un dato que el dueño edite.
    expect(s.queryByRole('button', { name: /arrastr/i })).toBeNull();
  });

  it('§21.2b: el punto nuevo se prerrellena con la interpolación VIGENTE del servidor (neutro)', async () => {
    // El dry-run responde `appliedBp = 13000` en ese mercado ⇒ la fila nueva queda en 1.30×.
    mockPreview((m) =>
      previewRow(m, {
        draft: { sale: leg({ appliedBp: 13000 }), buy: leg({ appliedBp: 3500 }) },
        saved: { sale: leg(), buy: leg() },
        deltaCents: { sale: 0, buy: 0 },
      }),
    );
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();

    await s.findByLabelText('Mercado del punto 1 de venta');
    fireEvent.click(s.getAllByRole('button', { name: '+ Agregar punto' })[0]);
    // La fila nueva nace AL FINAL, en edición y con el foco en Mercado.
    const market = (await s.findByLabelText('Mercado del punto 3 de venta')) as HTMLInputElement;
    fireEvent.change(market, { target: { value: '60' } });
    fireEvent.blur(market);

    // Al confirmar el mercado, la fila se ordena en su sitio (60 entre 25 y 80) y su valor se
    // rellena con la interpolación que devolvió el SERVIDOR para la curva actual.
    await waitFor(
      () => expect((s.getByLabelText('Mercado del punto 2 de venta') as HTMLInputElement).value).toBe('60'),
      { timeout: 3000 },
    );
    await waitFor(
      () => expect((s.getByLabelText('Multiplicador del punto 2') as HTMLInputElement).value).toBe('1.30'),
      { timeout: 3000 },
    );
    expect(
      s.getByText('Se colocó sobre la curva actual: todavía no cambia ningún precio.'),
    ).toBeInTheDocument();
  });

  it('§21.2c: borrar es inmediato y REVERSIBLE dentro del borrador (nada toca dinero hasta guardar)', async () => {
    mockPreview();
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();

    expect((await s.findAllByTestId('curve-point-sale')).length).toBe(2);
    fireEvent.click(s.getByRole('button', { name: 'Quitar el punto de venta de MX$25.00' }));
    expect(s.getAllByTestId('curve-point-sale')).toHaveLength(1);
    expect(s.getByText(/Punto de MX\$25\.00 eliminado/)).toBeInTheDocument();
    // Con un solo punto, Quitar queda deshabilitado con el motivo anunciado (V1 hecho control).
    expect(s.getByRole('button', { name: /Quitar el punto de venta/ })).toBeDisabled();
    expect(s.getByRole('button', { name: /Quitar el punto de venta/ })).toHaveAttribute(
      'title',
      'Una curva necesita al menos un punto.',
    );

    fireEvent.click(s.getAllByRole('button', { name: 'Deshacer' })[0]);
    await waitFor(() => expect(s.getAllByTestId('curve-point-sale')).toHaveLength(2));
  });

  it('§21.4a: al TECLEAR no hay error; al BLUR sí, y solo lo que un control afirma de sí mismo', async () => {
    mockPreview();
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();

    const mult = (await s.findByLabelText('Multiplicador del punto 1')) as HTMLInputElement;
    fireEvent.change(mult, { target: { value: '0.9' } });
    // Mientras se teclea: nada. Sin rojo, sin sacudidas.
    expect(s.queryByText(/nunca puede bajar de 1\.00×/)).toBeNull();
    fireEvent.blur(mult);
    expect(await s.findByText(/nunca puede bajar de 1\.00×/)).toBeInTheDocument();
    expect(mult).toHaveAttribute('aria-invalid', 'true');
  });

  it('§21.6: guardar abre el diff y hace PUT con el objeto COMPLETO (pesos → centavos, × → bp)', async () => {
    mockPreview();
    const put = vi.spyOn(api, 'updatePricingCurve').mockImplementation(async (c) => c);
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();

    const mult = (await s.findByLabelText('Multiplicador del punto 2')) as HTMLInputElement;
    fireEvent.change(mult, { target: { value: '1.25' } });
    fireEvent.blur(mult);
    expect(await s.findByText('1 cambio sin guardar')).toBeInTheDocument();

    fireEvent.click(s.getByRole('button', { name: 'Guardar curva' }));
    // El diálogo se abre SIEMPRE: el PUT reemplaza toda la curva y repricia el catálogo entero.
    const dialog = await screen.findByRole('dialog', { name: /Guardar la curva de precio/ });
    expect(within(dialog).getByText(/Venta · punto MX\$80\.00 · 1\.15× → 1\.25×/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Solo súper-admin · queda en bitácora/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar curva' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const body = put.mock.calls[0][0];
    expect(body.sale.points).toEqual([
      { marketCents: 2500, multiplierBp: 16000 },
      { marketCents: 8000, multiplierBp: 12500 },
    ]);
    expect(body.sale.floorCents).toBe(2500);
    expect(body.buy.binCents).toBe(100);
    expect(await screen.findByText('Curva de precio guardada.')).toBeInTheDocument();
  });

  it('§21.4b: un 422 no guarda NADA — resumen anclado con foco, salto al punto y fila marcada', async () => {
    mockPreview();
    vi.spyOn(api, 'updatePricingCurve').mockRejectedValue(
      new ApiClientError(422, {
        code: 'SALE_CURVE_NOT_MONOTONIC',
        message: 'not monotonic',
        details: { axis: 'sale', index: 0, marketCents: 2500, toIndex: 1, toMarketCents: 8000 },
      }),
    );
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();

    const mult = (await s.findByLabelText('Multiplicador del punto 2')) as HTMLInputElement;
    fireEvent.change(mult, { target: { value: '1.05' } });
    fireEvent.blur(mult);
    fireEvent.click(s.getByRole('button', { name: 'Guardar curva' }));
    const dialog = await screen.findByRole('dialog', { name: /Guardar la curva de precio/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar curva' }));

    // Título FIJO, sin ambigüedad, y el resumen recibe el foco.
    const alert = await s.findByRole('alert');
    expect(within(alert).getByText('No se guardó nada.')).toBeInTheDocument();
    expect(
      within(alert).getByText(/Entre MX\$25\.00 y MX\$80\.00 el precio de venta baja/),
    ).toBeInTheDocument();
    // Botón de salto al punto culpable (los DOS extremos del tramo).
    expect(within(alert).getByRole('button', { name: 'Ir al punto de MX$25.00' })).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Ir al punto de MX$80.00' })).toBeInTheDocument();
    // La barra dice que no se guardó; la curva vigente sigue viva.
    expect(s.getByText('No se guardó')).toBeInTheDocument();
  });

  it('§21.4: el editor NO se adelanta al 422 — una curva cruzada sigue siendo GUARDABLE en cliente', async () => {
    mockPreview();
    const put = vi.spyOn(api, 'updatePricingCurve').mockImplementation(async (c) => c);
    renderWithProviders(<M2View />, 'es');
    const s = await curveSection();

    // Pago de compra por encima del multiplicador de venta: el invariante cruzado lo decide el
    // SERVIDOR. Si el cliente inventara el rechazo, el dueño dejaría de confiar en la pantalla.
    const pay = (await s.findByLabelText('Pago del punto 1')) as HTMLInputElement;
    fireEvent.change(pay, { target: { value: '99' } });
    fireEvent.blur(pay);
    fireEvent.click(s.getByRole('button', { name: 'Guardar curva' }));
    const dialog = await screen.findByRole('dialog', { name: /Guardar la curva de precio/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar curva' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  });
});

/**
 * §21.7b — «Salud del catálogo de rarezas»: solo lectura, respalda el guardarraíl y hospeda
 * «Unificar rarezas» (que dejó de colgar de un editor de precios).
 */
describe('M2 · Salud del catálogo de rarezas (P-48, §21.7b)', () => {
  it('lista rarezas con su marca premium y el conteo de cartas, sin columna de regla ni de tier', async () => {
    vi.spyOn(api, 'previewPricingCurve').mockResolvedValue({ rows: [], violations: [] });
    renderWithProviders(<M2View />, 'es');
    const heading = await screen.findByRole('heading', { name: /Salud del catálogo de rarezas/ });
    const s = within(heading.closest('section')!);

    expect(
      s.getByText(/Las rarezas ya no fijan precios/),
    ).toBeInTheDocument();
    expect((await s.findAllByText('Common')).length).toBeGreaterThan(0);
    expect(s.getByRole('columnheader', { name: 'Cartas' })).toBeInTheDocument();
    expect(s.queryByRole('columnheader', { name: 'Tier' })).toBeNull();
    expect(s.queryByRole('columnheader', { name: /Regla/ })).toBeNull();
  });

  it('«Unificar rarezas» conserva su acción y dice AHORA sus dos consecuencias', async () => {
    vi.spyOn(api, 'previewPricingCurve').mockResolvedValue({ rows: [], violations: [] });
    const spy = vi.spyOn(api, 'unifyRarities').mockResolvedValue({
      ok: true,
      cardsProcessed: 10,
      cardsUpdated: 3,
      distinctCanonical: 7,
      unmapped: [],
    });
    renderWithProviders(<M2View />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Unificar rarezas/ }));
    const dialog = await screen.findByRole('dialog', { name: /Unificar rarezas del catálogo/ });
    // El microcopy se corrige: «no cambia precios» ya no lo cuenta todo.
    expect(
      within(dialog).getByText(/puede cambiar qué cartas quedan retenidas por el guardarraíl/),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unificar rarezas' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { config } from '@/lib/config';
import { setToken } from '@/lib/api-client';
import type { GradedEstimateReviewItemDTO } from '@/types/contract';
import { GradedEstimateReviewSection } from './GradedEstimateReviewSection';

/**
 * LISTA DE REVISIÓN (contrato v1.50.3, **criterio 111(e)**). Lo que estos tests protegen no es el
 * render: son las **cuatro reglas del contrato que, si se relajan, convierten la lista en algo peor
 * que no tenerla**.
 *
 *  1. El **default** son los TRES motivos de coherencia; `SLAB_PUBLISHED` es **opt-in** (si entrara
 *     por defecto, ahogaría la señal). Se afirma sobre la **query real**, no sobre un espía.
 *  2. **`truncated` se pinta**: una lista incompleta presentada como completa produce la falsa
 *     confianza de «no hay nada que revisar».
 *  3. **Con la feature apagada la tabla SIGUE**: si solo funcionara encendida, habría que publicar
 *     las cifras malas para poder descubrirlas.
 *  4. **`409 GRADED_CONFIG_INVALID` NO se degrada a lista vacía**: contra un umbral corrupto no se
 *     evalúa, y el operador tiene que verlo.
 *  5. **`STALE` es opt-in** (v1.50.3-c) y **jamás** entra al default: es la categoría más numerosa y
 *     taparía la señal de coherencia. Pero tiene que poder pedirse, porque una cifra caducada
 *     desaparece de las tres superficies **en silencio** y sigue en la tabla.
 *  6. **El borrado (v1.50.3-d) exige confirmación, dice que se lleva TODAS las capturas, y sus dos
 *     desenlaces no-200 NO son fallos del sistema:** el `409` es la guarda INV-D funcionando (y el
 *     copy manda a repreciar con `intent:"market"`, no a insistir), y el `404` significa «no había
 *     nada». Si esto se relaja, el operador o borra lo que no debe, o cree que limpió algo que no.
 */

let requestedUrls: string[] = [];
let requestedCalls: { url: string; method: string }[] = [];
let response: (url: string, method: string) => { status: number; body: unknown };

function res(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

/** Última llamada al `DELETE` del contrato (o `undefined` si nadie lo llamó). */
function lastDelete(): { url: string; method: string } | undefined {
  return [...requestedCalls].reverse().find((c) => c.method === 'DELETE');
}

/** Cuántas veces se (re)consultó la LISTA. Sube cuando el borrado invalida la query. */
function reviewGets(): number {
  return requestedCalls.filter((c) => c.method === 'GET' && c.url.includes('/review')).length;
}

const row = (over: Partial<GradedEstimateReviewItemDTO> = {}): GradedEstimateReviewItemDTO => ({
  cardId: 'c-latias-sir',
  cardName: 'Latias ex',
  setName: 'Surging Sparks',
  number: '186',
  representativeInventoryItemId: 'inv-rev-1',
  finish: 'normal',
  salePriceCents: 128_000,
  psa10MxnCents: 6_000,
  psa9MxnCents: null,
  capturedDate: '2026-08-20',
  stale: false,
  gradingCostTier: null,
  gradingCostMxnCents: null,
  thresholdMxnCents: null,
  netUpsidePsa9MxnCents: null,
  maxAllowedPsa10MxnCents: 12_800_000,
  publishedSlabGrades: [],
  isManual: true,
  eligible: false,
  reason: 'NOT_ABOVE_RAW',
  ...over,
});

function body(over: Record<string, unknown> = {}) {
  return {
    data: [row()],
    page: 1,
    pageSize: 25,
    total: 1,
    enabled: true,
    scannedCards: 42,
    truncated: false,
    ...over,
  };
}

const originalUseMocks = config.useMocks;

beforeEach(() => {
  config.useMocks = false;
  setToken('access-token');
  requestedUrls = [];
  requestedCalls = [];
  response = () => ({ status: 200, body: body() });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      requestedUrls.push(url);
      requestedCalls.push({ url, method });
      const r = response(url, method);
      return res(r.status, r.body);
    }),
  );
});

afterEach(() => {
  config.useMocks = originalUseMocks;
  setToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GradedEstimateReviewSection · lista de revisión (§M2 v1.50.3 / criterio 111(e))', () => {
  /**
   * DESIGN_SYSTEM §22.13(e)/§22.12 nº13.e — el aviso de APAGADO del dial de M10 enseña la escalera
   * de remedios y enlaza aquí (`/admin/m2#gancho-revision`). Sin el ancla, ese enlace lleva a una
   * página y a ningún sitio dentro de ella: la escalera —lo único que evita que el dueño apague la
   * feature entera por una carta mal capturada— moriría **en silencio**, que es el peor modo de
   * fallo posible para un remedio. El `scroll-mt` va con ella: aterrizar debajo del header sticky
   * es no aterrizar (§4.5).
   */
  it('es el DESTINO del enlace del aviso de apagado: ancla `gancho-revision` con su scroll-mt', async () => {
    const { container } = renderWithProviders(<GradedEstimateReviewSection />, 'es');
    const anchor = container.querySelector('#gancho-revision') as HTMLElement;
    expect(anchor).toBeTruthy();
    expect(anchor.tagName).toBe('SECTION');
    expect(anchor.className).toContain('scroll-mt-[calc(var(--app-header-h,0px)+16px)]');
    // El encabezado de la sección cuelga del ancla: el aterrizaje enseña de qué va la lista.
    expect(anchor.querySelector('h2')).toBeTruthy();
  });

  it('pide por defecto SOLO los tres motivos de coherencia: SLAB_PUBLISHED es opt-in', async () => {
    renderWithProviders(<GradedEstimateReviewSection />, 'es');

    await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(0));
    const url = requestedUrls[0];
    expect(url).toContain('/admin/pricing/graded-estimates/review');
    expect(decodeURIComponent(url)).toContain(
      'reason=NOT_ABOVE_RAW,ABOVE_MAX_MULTIPLE,GRADE_ORDER_INVERTED',
    );
    expect(decodeURIComponent(url)).not.toContain('SLAB_PUBLISHED');
    expect(url).toContain('pageSize=25');
  });

  it('la casilla añade SLAB_PUBLISHED y vuelve a la página 1 (el filtro no puede dejar huérfana la paginación)', async () => {
    renderWithProviders(<GradedEstimateReviewSection />, 'es');
    await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByLabelText(/Incluir también las cartas con slab publicado/));

    await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(1));
    const url = decodeURIComponent(requestedUrls[requestedUrls.length - 1]);
    expect(url).toContain('SLAB_PUBLISHED');
    expect(url).toContain('page=1');
  });

  it('`truncated: true` se PINTA como alerta: prohibido truncar en silencio', async () => {
    response = () => ({ status: 200, body: body({ truncated: true, scannedCards: 5000 }) });
    renderWithProviders(<GradedEstimateReviewSection />, 'es');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Esta lista está incompleta/);
    expect(alert.textContent).toMatch(/5,?000/);
  });

  it('con la feature APAGADA la tabla sigue: se avisa, pero no se bloquea', async () => {
    response = () => ({ status: 200, body: body({ enabled: false }) });
    renderWithProviders(<GradedEstimateReviewSection />, 'es');

    expect(await screen.findByText(/El gancho está apagado/)).toBeInTheDocument();
    // La fila SIGUE listada: limpiar el dato ANTES de encender es el caso de uso, no un borde.
    expect(screen.getAllByText('Latias ex').length).toBeGreaterThan(0);
  });

  it('money-safe: un monto ausente se pinta «sin dato», nunca MX$0.00', async () => {
    renderWithProviders(<GradedEstimateReviewSection />, 'es');

    expect(await screen.findAllByText('sin dato')).not.toHaveLength(0);
    expect(screen.queryByText('MX$0.00')).toBeNull();
  });

  it('el motivo se explica en lenguaje de operador (qué error suele haber detrás), no solo el código', async () => {
    renderWithProviders(<GradedEstimateReviewSection />, 'es');

    expect(await screen.findAllByText('No supera el raw')).not.toHaveLength(0);
    expect(
      screen.getAllByText(/importe en dólares capturado como pesos/).length,
    ).toBeGreaterThan(0);
    // Y se declara fuera de alcance el «marcar como revisada», en vez de fingir que existe.
    expect(screen.getByText(/No hay «marcar como revisada»/)).toBeInTheDocument();
  });

  it('409 GRADED_CONFIG_INVALID: se muestra el error traducido y NO una tabla vacía', async () => {
    response = () => ({
      status: 409,
      body: { error: { code: 'GRADED_CONFIG_INVALID', message: 'maxRawMultiple is corrupt' } },
    });
    renderWithProviders(<GradedEstimateReviewSection />, 'es');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/umbral de la configuración del gancho está corrupto/);
    expect(screen.queryByText('Latias ex')).toBeNull();
  });
});

describe('GradedEstimateReviewSection · lo CADUCADO (§M2 v1.50.3-c)', () => {
  it('`STALE` es opt-in: no está en el default y la casilla lo añade sin tirar el otro opt-in', async () => {
    renderWithProviders(<GradedEstimateReviewSection />, 'es');
    await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(0));
    expect(decodeURIComponent(requestedUrls[0])).not.toContain('STALE');

    fireEvent.click(screen.getByLabelText(/Incluir también las cifras caducadas/));
    await waitFor(() =>
      expect(decodeURIComponent(requestedUrls[requestedUrls.length - 1])).toContain('STALE'),
    );

    // Los dos opt-in son independientes: pedir lo caducado no puede apagar el de slab publicado.
    fireEvent.click(screen.getByLabelText(/Incluir también las cartas con slab publicado/));
    await waitFor(() => {
      const url = decodeURIComponent(requestedUrls[requestedUrls.length - 1]);
      expect(url).toContain('STALE');
      expect(url).toContain('SLAB_PUBLISHED');
      expect(url).toContain('page=1');
    });
  });

  it('el ORIGEN de la cifra se pinta: manual y automática piden remedios opuestos', async () => {
    response = () => ({
      status: 200,
      body: body({
        data: [
          row({ reason: 'STALE', stale: true, isManual: true }),
          row({
            reason: 'STALE',
            stale: true,
            isManual: false,
            cardId: 'c-machamp',
            cardName: 'Machamp',
            representativeInventoryItemId: 'inv-rev-9',
          }),
        ],
        total: 2,
      }),
    });
    renderWithProviders(<GradedEstimateReviewSection />, 'es');

    expect(await screen.findAllByText(/manual \(la puso el dueño\)/)).not.toHaveLength(0);
    expect(screen.getAllByText(/automática \(ingest\)/)).not.toHaveLength(0);
  });
});

describe('GradedEstimateReviewSection · RETIRAR el estimado (§M2 v1.50.3-d)', () => {
  /** Abre el diálogo de confirmación del grado indicado sobre la primera fila. */
  async function openConfirm(grade = '10') {
    const triggers = await screen.findAllByRole('button', {
      name: new RegExp(`Retirar el estimado PSA ${grade} de`),
    });
    fireEvent.click(triggers[0]);
  }

  it('no borra al primer clic: abre confirmación y dice que se lleva TODAS las capturas, no «la última»', async () => {
    renderWithProviders(<GradedEstimateReviewSection />, 'es');
    await openConfirm();

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/TODAS las capturas de ese grado/);
    expect(dialog.textContent).toMatch(/no solo la vigente/);
    // Y por qué: si solo se quitara la vigente, afloraría una más vieja y la cifra volvería sola.
    expect(dialog.textContent).toMatch(/reaparecería sola/);
    // Nada se ha borrado todavía.
    expect(lastDelete()).toBeUndefined();
  });

  it('confirmar llama al DELETE del contrato, pinta cuántas filas se fueron y REFRESCA la lista', async () => {
    response = (url, method) =>
      method === 'DELETE'
        ? { status: 200, body: { cardId: 'c-latias-sir', gradeValue: '10', deletedCount: 3 } }
        : { status: 200, body: body() };
    renderWithProviders(<GradedEstimateReviewSection />, 'es');
    await openConfirm();
    const before = reviewGets();

    fireEvent.click(screen.getByRole('button', { name: 'Retirar PSA 10' }));

    await waitFor(() => expect(lastDelete()).toBeDefined());
    // Ruta del contrato: `:cardId/:gradeValue` (el gradeValue, no el gradeKey crudo).
    expect(lastDelete()!.url).toContain('/admin/pricing/graded-estimates/c-latias-sir/10');
    // `deletedCount` se pinta tal cual: puede ser > 1 y el operador tiene que enterarse.
    expect(await screen.findByText(/3 capturas borradas/)).toBeInTheDocument();
    // La fila desaparece refrescando la lista, no recargando la página.
    await waitFor(() => expect(reviewGets()).toBeGreaterThan(before));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('409 SLAB_PUBLISHED: no es un fallo del sistema — explica y manda a REPRECIAR, no a insistir', async () => {
    response = (url, method) =>
      method === 'DELETE'
        ? {
            status: 409,
            body: {
              error: {
                code: 'GRADED_ESTIMATE_SLAB_PUBLISHED',
                message: 'published slab',
                details: { gradeKey: 'graded:PSA:10', publishedSlabCount: 1 },
              },
            },
          }
        : { status: 200, body: body() };
    renderWithProviders(<GradedEstimateReviewSection />, 'es');
    await openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Retirar PSA 10' }));

    const alert = await screen.findByRole('alert');
    // El código ya traducido, con su detalle (cuántas piezas y de qué grado).
    expect(alert.textContent).toMatch(/una pieza PSA 10 publicada/);
    expect(alert.textContent).toMatch(/dinero real/);
    // Y el remedio CORRECTO, que es el contrario de insistir en borrar.
    expect(alert.textContent).toMatch(/market/);
    expect(alert.textContent).toMatch(/insistir en borrar no es el camino/);
    // El diálogo NO se cierra: el operador tiene que leer por qué no se hizo.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('404: significa «no había nada», se dice así (no como error) y la lista se refresca', async () => {
    response = (url, method) =>
      method === 'DELETE'
        ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not found' } } }
        : { status: 200, body: body() };
    renderWithProviders(<GradedEstimateReviewSection />, 'es');
    await openConfirm();
    const before = reviewGets();
    fireEvent.click(screen.getByRole('button', { name: 'Retirar PSA 10' }));

    expect(await screen.findByText('No había nada que borrar')).toBeInTheDocument();
    expect(screen.getByText(/No se borró nada porque no había nada/)).toBeInTheDocument();
    // No se pinta como fallo (nada de `role="alert"`) y el diálogo se cierra.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(reviewGets()).toBeGreaterThan(before));
  });

  it('pre-vuelo INV-D: el grado con slab publicado NO ofrece borrado, y se explica el remedio', async () => {
    response = () => ({
      status: 200,
      body: body({
        data: [row({ reason: 'SLAB_PUBLISHED', psa9MxnCents: 4_000, publishedSlabGrades: ['9'] })],
      }),
    });
    renderWithProviders(<GradedEstimateReviewSection />, 'es');

    const blocked = await screen.findAllByRole('button', {
      name: /Retirar el estimado PSA 9 de/,
    });
    expect(blocked[0]).toBeDisabled();
    // El grado libre SÍ se puede retirar: la guarda es POR GRADO, no por carta.
    expect(screen.getAllByRole('button', { name: /Retirar el estimado PSA 10 de/ })[0]).toBeEnabled();
    expect(
      screen.getByText(/es la referencia de mercado de una pieza física que se está vendiendo/),
    ).toBeInTheDocument();
  });

  it('un grado SIN cifra no ofrece botón: sería ofrecer un gesto que solo daría 404', async () => {
    renderWithProviders(<GradedEstimateReviewSection />, 'es');
    // La fila base trae PSA 10 y `psa9MxnCents: null`.
    expect(await screen.findAllByRole('button', { name: /Retirar el estimado PSA 10 de/ })).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Retirar el estimado PSA 9 de/ })).toBeNull();
  });
});

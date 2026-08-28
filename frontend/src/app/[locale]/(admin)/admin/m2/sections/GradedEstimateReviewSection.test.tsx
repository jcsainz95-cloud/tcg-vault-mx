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
 */

let requestedUrls: string[] = [];
let response: () => { status: number; body: unknown };

function res(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
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
  response = () => ({ status: 200, body: body() });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      const r = response();
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

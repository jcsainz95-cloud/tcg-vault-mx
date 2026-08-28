import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { config } from '@/lib/config';
import { setToken } from '@/lib/api-client';
import type {
  GradedEstimateConfigDTO,
  GradedEstimatePreviewResponse,
  PendingPriceEntryDTO,
  VariantPricingDTO,
} from '@/types/contract';

import { GradedTab } from '@/app/[locale]/(admin)/admin/m1/GradedTab';
import { VariantPriceConsole } from '@/components/master-set/VariantPriceConsole';
import { PendingQueueSection } from '@/app/[locale]/(admin)/admin/m2/sections/PendingQueueSection';
import { GradedEstimateCaptureSection } from '@/app/[locale]/(admin)/admin/m2/sections/GradedEstimateCaptureSection';

/**
 * ===== CANDADO DE CUERPO DE PETICIÓN: `POST /admin/pricing/override` (contrato v1.50.2) =====
 *
 * **El hueco estructural que este archivo cierra.** Todas las pruebas existentes de las pantallas
 * que fijan precio espían `api.overridePrice` y afirman *que se llamó*. Por eso el *breaking* de
 * `intent` —el backend empezó a exigirlo con `productType:"graded"` y a devolver
 * `422 GRADED_INTENT_REQUIRED`— pasó por la suite entera **en verde** mientras las tres superficies
 * vivas de dinero devolvían 422 contra el backend real: nadie miraba **qué se manda**.
 *
 * Aquí se afirma el **cuerpo HTTP literal**, con `config.useMocks = false` y `fetch` ruteado por
 * URL: los componentes reales, sus queries reales y el body real que sale por el cable. Si mañana
 * alguien quita `intent`, o le pone el valor equivocado a una superficie, **esto se pone rojo antes
 * que el operador**.
 *
 * Reparto de intenciones, que es lo que de verdad se está protegiendo:
 *  - `market` — fija el **precio de mercado real** de una pieza publicada. Lo mandan M1 › Gradeadas,
 *    la consola de precio de la variante y la cola de pendientes de M2.
 *  - `graded_estimate` — publica una **cifra ilustrativa** (§O). Lo manda **solo** la captura manual
 *    del gancho, y el backend la bloquea con `409` si hay slab publicado de ese grado (§O.8).
 */

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Arnés: `fetch` ruteado por URL. Cada test declara SOLO las respuestas que su
// pantalla necesita; el override se captura aparte para poder afirmar su body.
// ---------------------------------------------------------------------------
type Route = (url: string, init: RequestInit | undefined) => unknown | undefined;

let overrideBodies: Record<string, unknown>[] = [];
let routes: Route[] = [];
/** Respuesta del POST /admin/pricing/override (200 por defecto; los tests la sustituyen). */
let overrideResponse: () => { status: number; body: unknown } = () => ({
  status: 200,
  body: { data: { date: '2026-08-28', source: 'manual', priceMxnCents: 1 } },
});

function res(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

const originalUseMocks = config.useMocks;

beforeEach(() => {
  config.useMocks = false;
  setToken('access-token'); // evita el interceptor de refresh
  overrideBodies = [];
  routes = [];
  overrideResponse = () => ({
    status: 200,
    body: { data: { date: '2026-08-28', source: 'manual', priceMxnCents: 1 } },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/admin/pricing/override')) {
        overrideBodies.push(JSON.parse(String(init?.body ?? '{}')));
        const r = overrideResponse();
        return res(r.status, r.body);
      }
      for (const route of routes) {
        const body = route(url, init);
        if (body !== undefined) return res(200, body);
      }
      throw new Error(`fetch no ruteado en el test: ${url}`);
    }),
  );
});

afterEach(() => {
  config.useMocks = originalUseMocks;
  setToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** El body que salió por el cable en el i-ésimo override (falla claro si no hubo). */
async function firstOverrideBody(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(overrideBodies.length).toBeGreaterThan(0));
  return overrideBodies[0];
}

// ---------------------------------------------------------------------------
// Fixtures mínimos de las pantallas
// ---------------------------------------------------------------------------
const gradedGroup = {
  cardId: 'c-charizard',
  card: { name: 'Charizard', number: '4', setName: 'Base Set', imageSmallUrl: null },
  gradingCompany: 'PSA' as const,
  gradeValue: '10',
  count: 2,
  marketReferenceMxnCents: null,
  totalCostCents: null,
};

const basePricing: VariantPricingDTO = {
  buy: {
    suggestedCents: 100000,
    overrideCents: null,
    effectiveCents: 100000,
    source: 'market',
    premiumAtFloor: false,
  },
  sell: {
    suggestedCents: 150000,
    overrideCents: null,
    effectiveCents: 150000,
    source: 'market',
    premiumAtFloor: false,
  },
};

const estimateConfig: GradedEstimateConfigDTO = {
  enabled: true,
  ingestEnabled: false,
  grades: ['10', '9'],
  highlightGrades: ['10'],
  freshnessDays: 30,
  minUpsidePct: 30,
  gradingCostTiers: [{ minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 70000 }],
  manualFreshnessDays: null,
  maxRawMultiple: 100,
  minSampleCount: 5,
  sourceStat: 'median',
  ingestMaxCardsPerRun: 250,
};

/** Preview SIN slabs publicados ⇒ ningún grado bloqueado. */
const cleanPreview: GradedEstimatePreviewResponse = {
  cardId: 'c-charizard',
  enabled: true,
  config: estimateConfig,
  groups: [
    {
      representativeInventoryItemId: 'inv-1',
      finish: 'normal',
      salePriceCents: 150000,
      psa10MxnCents: null,
      psa9MxnCents: null,
      capturedDate: null,
      stale: false,
      gradingCostTier: null,
      gradingCostMxnCents: null,
      thresholdMxnCents: null,
      netUpsidePsa9MxnCents: null,
      maxAllowedPsa10MxnCents: 15000000,
      publishedSlabGrades: [],
      eligible: false,
      reason: 'NO_PSA10',
    },
  ],
};

const gradedPending: PendingPriceEntryDTO = {
  id: 'pp-1',
  cardId: 'c-charizard',
  productType: 'graded',
  gradeKey: 'graded:PSA:10',
  finish: 'normal',
  context: 'inventory',
  status: 'open',
  createdAt: '2026-08-28T00:00:00.000Z',
  card: { id: 'c-charizard', name: 'Charizard', number: '4', setName: 'Base Set' },
};

// ===========================================================================
describe('POST /admin/pricing/override · el `intent` que el contrato EXIGE viaja en el body', () => {
  it('M1 › Gradeadas «Fijar valor…» manda intent:"market" (es el precio real del slab)', async () => {
    routes.push((url) =>
      url.includes('/admin/inventory/graded')
        ? { data: [gradedGroup], page: 1, pageSize: 20, total: 1 }
        : undefined,
    );
    renderWithProviders(<GradedTab onOpenGroup={() => {}} onAddGraded={() => {}} />, 'es');

    // `DataTable` pinta la misma fila DOS veces (tabla en escritorio + tarjeta en móvil): se opera
    // sobre la primera aparición, que es la de la tabla.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Fijar valor…' }))[0]);
    fireEvent.change(screen.getAllByLabelText('Valor de mercado (MXN)')[0], {
      target: { value: '32600' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Guardar' })[0]);

    expect(await firstOverrideBody()).toEqual({
      cardId: 'c-charizard',
      productType: 'graded',
      gradeKey: 'graded:PSA:10',
      priceMxnCents: 3260000,
      intent: 'market',
    });
  });

  it('La consola de variante GRADED manda intent:"market" y NO manda `finish` (graded ⇒ normal)', async () => {
    renderWithProviders(
      <VariantPriceConsole
        cardId="c-charizard"
        finish="normal"
        productType="graded"
        gradeKey="graded:PSA:9"
        pricing={basePricing}
        marketRefCents={null}
      />,
      'es',
    );

    fireEvent.change(screen.getByLabelText('Fijar mercado (MXN)'), { target: { value: '1250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fijar' }));

    expect(await firstOverrideBody()).toEqual({
      cardId: 'c-charizard',
      productType: 'graded',
      gradeKey: 'graded:PSA:9',
      priceMxnCents: 125000,
      intent: 'market',
    });
  });

  it('La consola de variante RAW sigue mandando `finish` y NINGÚN intent (el contrato lo ignoraría)', async () => {
    renderWithProviders(
      <VariantPriceConsole
        cardId="c-charizard"
        finish="reverse_holo"
        pricing={basePricing}
        marketRefCents={null}
      />,
      'es',
    );

    fireEvent.change(screen.getByLabelText('Fijar mercado (MXN)'), { target: { value: '1250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fijar' }));

    const body = await firstOverrideBody();
    expect(body).toEqual({
      cardId: 'c-charizard',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'reverse_holo',
      priceMxnCents: 125000,
    });
    expect('intent' in body).toBe(false);
  });

  it('La cola de pendientes de M2 propaga un pendiente GRADED con intent:"market" y su `finish`', async () => {
    routes.push((url) =>
      url.includes('/admin/pricing/pending')
        ? {
            data: [gradedPending],
            page: 1,
            pageSize: 20,
            total: 1,
            counts: { total: 1, no_market: 1, premium_at_floor: 0, unknown: 0 },
          }
        : undefined,
    );
    renderWithProviders(<PendingQueueSection />, 'es');

    fireEvent.click((await screen.findAllByRole('button', { name: 'Fijar precio' }))[0]);
    fireEvent.change(screen.getByLabelText('Precio de referencia (MXN)'), {
      target: { value: '900' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio' }));

    expect(await firstOverrideBody()).toEqual({
      cardId: 'c-charizard',
      productType: 'graded',
      gradeKey: 'graded:PSA:10',
      finish: 'normal',
      priceMxnCents: 90000,
      intent: 'market',
    });
  });
});

// ===========================================================================
describe('M2 › captura manual de estimados · la ÚNICA vía de `graded_estimate`', () => {
  function mountCapture() {
    routes.push((url) => {
      if (url.includes('/admin/pricing/graded-estimates/preview')) return cleanPreview;
      if (url.includes('/admin/pricing/graded-estimates')) return estimateConfig;
      if (url.includes('/buylist/cards'))
        return {
          data: [
            {
              id: 'c-charizard',
              name: 'Charizard',
              number: '4',
              setId: 'base1',
              setName: 'Base Set',
              rarity: 'Rare Holo',
              availableFinishes: ['normal'],
            },
          ],
          page: 1,
          pageSize: 8,
          total: 1,
        };
      return undefined;
    });
    return renderWithProviders(<GradedEstimateCaptureSection />, 'es');
  }

  async function selectCharizard() {
    fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: 'chari' } });
    fireEvent.click(await screen.findByRole('button', { name: /Charizard/ }));
    // El pre-vuelo tiene que haber respondido antes de capturar (los grados se pintan con la config).
    await screen.findByLabelText('Estimado PSA 10 (MXN)');
  }

  it('manda intent:"graded_estimate" con el gradeKey canónico y en MXN·centavos', async () => {
    mountCapture();
    await selectCharizard();

    fireEvent.change(screen.getByLabelText('Estimado PSA 10 (MXN)'), { target: { value: '29000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar estimados' }));

    expect(await firstOverrideBody()).toEqual({
      cardId: 'c-charizard',
      productType: 'graded',
      gradeKey: 'graded:PSA:10',
      priceMxnCents: 2900000,
      intent: 'graded_estimate',
    });
    // `finish` se OMITE a propósito: el contrato defaultea `normal`, que es el único válido en graded.
    expect('finish' in overrideBodies[0]).toBe(false);
  });

  it('escribe UNA petición POR GRADO (un grado bloqueado no debe arrastrar al otro)', async () => {
    mountCapture();
    await selectCharizard();

    fireEvent.change(screen.getByLabelText('Estimado PSA 10 (MXN)'), { target: { value: '29000' } });
    fireEvent.change(screen.getByLabelText('Estimado PSA 9 (MXN)'), { target: { value: '14500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar estimados' }));

    await waitFor(() => expect(overrideBodies).toHaveLength(2));
    expect(overrideBodies.map((b) => b.gradeKey)).toEqual(['graded:PSA:10', 'graded:PSA:9']);
    expect(overrideBodies.every((b) => b.intent === 'graded_estimate')).toBe(true);
  });

  it('money-safe: un importe vacío o en 0 NO se manda (nada de publicar una cifra de MX$0)', async () => {
    mountCapture();
    await selectCharizard();

    // PSA 9 en 0 y PSA 10 vacío: no hay nada guardable ⇒ el botón queda bloqueado y no sale nada.
    fireEvent.change(screen.getByLabelText('Estimado PSA 9 (MXN)'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Publicar estimados' })).toBeDisabled();
    expect(overrideBodies).toHaveLength(0);
  });

  it('§O.8 · el pre-vuelo DESHABILITA el grado con slab publicado, antes de escribir', async () => {
    routes.push((url) => {
      if (url.includes('/admin/pricing/graded-estimates/preview'))
        return {
          ...cleanPreview,
          groups: [{ ...cleanPreview.groups[0], publishedSlabGrades: ['10'] }],
        } satisfies GradedEstimatePreviewResponse;
      if (url.includes('/admin/pricing/graded-estimates')) return estimateConfig;
      if (url.includes('/buylist/cards'))
        return {
          data: [
            {
              id: 'c-charizard',
              name: 'Charizard',
              number: '4',
              setId: 'base1',
              setName: 'Base Set',
              rarity: 'Rare Holo',
              availableFinishes: ['normal'],
            },
          ],
          page: 1,
          pageSize: 8,
          total: 1,
        };
      return undefined;
    });
    renderWithProviders(<GradedEstimateCaptureSection />, 'es');
    await selectCharizard();

    // El pre-vuelo es una query aparte: se espera a que aterrice antes de afirmar el bloqueo.
    await waitFor(() => expect(screen.getByLabelText('Estimado PSA 10 (MXN)')).toBeDisabled());
    expect(screen.getByLabelText('Estimado PSA 9 (MXN)')).not.toBeDisabled();
    // Y se dice POR QUÉ, en lenguaje de negocio (§O.8), no con un código.
    expect(screen.getByRole('alert').textContent).toMatch(/precio de mercado REAL de esas piezas/);
  });
});

// ===========================================================================
describe('Los códigos de error nuevos llegan TRADUCIDOS al operador', () => {
  it('409 GRADED_ESTIMATE_SLAB_PUBLISHED se pinta con los `details` (cuántas piezas y de qué grado)', async () => {
    overrideResponse = () => ({
      status: 409,
      body: {
        error: {
          code: 'GRADED_ESTIMATE_SLAB_PUBLISHED',
          message: 'raw backend message',
          details: {
            cardId: 'c-charizard',
            gradeKey: 'graded:PSA:10',
            publishedSlabCount: 3,
            inventoryItemIds: ['inv-1', 'inv-2', 'inv-3'],
          },
        },
      },
    });
    routes.push((url) => {
      if (url.includes('/admin/pricing/graded-estimates/preview')) return cleanPreview;
      if (url.includes('/admin/pricing/graded-estimates')) return estimateConfig;
      if (url.includes('/buylist/cards'))
        return {
          data: [
            {
              id: 'c-charizard',
              name: 'Charizard',
              number: '4',
              setId: 'base1',
              setName: 'Base Set',
              rarity: 'Rare Holo',
              availableFinishes: ['normal'],
            },
          ],
          page: 1,
          pageSize: 8,
          total: 1,
        };
      return undefined;
    });
    renderWithProviders(<GradedEstimateCaptureSection />, 'es');
    fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: 'chari' } });
    fireEvent.click(await screen.findByRole('button', { name: /Charizard/ }));
    fireEvent.change(await screen.findByLabelText('Estimado PSA 10 (MXN)'), {
      target: { value: '29000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar estimados' }));

    const alert = await screen.findByText(/3 piezas PSA 10 publicadas/);
    expect(alert).toBeInTheDocument();
    // NUNCA el mensaje crudo del backend cuando hay copy: el operador lee negocio, no un volcado.
    expect(screen.queryByText(/raw backend message/)).toBeNull();
  });

  it('422 GRADED_INTENT_REQUIRED tiene copy propio (no cae al genérico ni al texto del backend)', async () => {
    overrideResponse = () => ({
      status: 422,
      body: { error: { code: 'GRADED_INTENT_REQUIRED', message: 'raw backend message' } },
    });
    routes.push((url) =>
      url.includes('/admin/inventory/graded')
        ? { data: [gradedGroup], page: 1, pageSize: 20, total: 1 }
        : undefined,
    );
    renderWithProviders(<GradedTab onOpenGroup={() => {}} onAddGraded={() => {}} />, 'es');

    fireEvent.click((await screen.findAllByRole('button', { name: 'Fijar valor…' }))[0]);
    fireEvent.change(screen.getAllByLabelText('Valor de mercado (MXN)')[0], {
      target: { value: '32600' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Guardar' })[0]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/PRECIO DE MERCADO de un slab publicado/);
    expect(alert.textContent).not.toMatch(/raw backend message/);
  });
});

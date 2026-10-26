/**
 * Cliente del Panel de Marketing (`docs/API_CONTRACT.md §MKT.E` + `§MKT.G`, v1.101⟨mkt-panel⟩). Rutas de SESIÓN
 * (`Authorization: Bearer` del admin, vía `apiRequest`/`requestBlob`): ⛔ nunca el token `marketing-reader`, que solo
 * vale en `GET …/aggregates` y no lo usa la pantalla.
 *
 * ⛔ Las descargas van por `requestBlob` (fetch + blob + `Content-Disposition`): el JWT jamás viaja en una URL.
 * ⛔ El claro del token del analista (`issueMarketingToken`) se devuelve al llamador y NADA de aquí lo guarda.
 */
import { ApiClientError, apiRequest, requestBlob, type BlobResponse } from './api-client';
import { config } from './config';
import { ApiFixtureError } from './mock/fixtures';
import * as mock from './mock/marketing';
import type {
  MarketingAnnotationDTO,
  MarketingAnnotationInput,
  MarketingApiTokenIssued,
  MarketingApiTokenView,
  MarketingPeriodsResponse,
  MarketingScreen,
  MarketingScreenPayload,
  MetaTestEventResult,
} from '@/types/contract';

/** Periodo cerrado tal como lo acepta el servidor: `weekStart=` (lunes) o `month=` (§MKT.G.3). */
export type MarketingPeriodQuery = { weekStart: string; month?: undefined } | { month: string; weekStart?: undefined };

async function mocked<T>(fn: () => T): Promise<T> {
  await new Promise((r) => setTimeout(r, 60));
  try {
    return fn();
  } catch (e) {
    if (e instanceof ApiFixtureError) throw new ApiClientError(e.status, { code: e.code, message: e.message, details: e.details });
    throw e;
  }
}

function periodQuery(p: MarketingPeriodQuery): Record<string, string> {
  return p.month ? { month: p.month } : { weekStart: p.weekStart as string };
}

/** `GET /admin/marketing/periods` (§MKT.G.3). */
export function getMarketingPeriods(): Promise<MarketingPeriodsResponse> {
  if (!config.useMocks) return apiRequest<MarketingPeriodsResponse>('/admin/marketing/periods');
  return mocked(() => mock.mockMarketingPeriods());
}

/** `GET /admin/marketing/panel?pantalla=&weekStart|month=` (§MKT.G.2). */
export function getMarketingPanel(screen: MarketingScreen, period: MarketingPeriodQuery): Promise<MarketingScreenPayload> {
  if (!config.useMocks) {
    return apiRequest<MarketingScreenPayload>('/admin/marketing/panel', { query: { pantalla: screen, ...periodQuery(period) } });
  }
  return mocked(() => mock.mockMarketingPanel(screen, period));
}

/** `GET /admin/marketing/weekly-excel?weekStart|month=` (§MKT.E, botón principal). */
export function downloadMarketingWeeklyExcel(period: MarketingPeriodQuery): Promise<BlobResponse> {
  if (!config.useMocks) return requestBlob('/admin/marketing/weekly-excel', { query: periodQuery(period) });
  return mocked(() => toBlob(mock.mockMarketingDownload('semana', period)));
}

/** `GET /admin/marketing/export?pantalla=&format=` (§MKT.E, «Exportar esta pantalla»). */
export function exportMarketingScreen(
  screen: MarketingScreen,
  format: 'xlsx' | 'csv',
  period: MarketingPeriodQuery,
): Promise<BlobResponse> {
  if (!config.useMocks) {
    return requestBlob('/admin/marketing/export', { query: { pantalla: screen, format, ...periodQuery(period) } });
  }
  return mocked(() => {
    const { text, filename } = mock.mockMarketingDownload(screen, period);
    return toBlob({ text, filename: format === 'csv' ? filename.replace(/\.xlsx$/, '.csv') : filename });
  });
}

function toBlob({ text, filename }: { text: string; filename: string }): BlobResponse {
  return { blob: new Blob([text], { type: 'application/octet-stream' }), filename };
}

// ---------------------------------------------------------------- anotaciones (§MKT.E h1)

export function listMarketingAnnotations(range: { from?: string; to?: string } = {}): Promise<MarketingAnnotationDTO[]> {
  if (!config.useMocks) return apiRequest<MarketingAnnotationDTO[]>('/admin/marketing/annotations', { query: range });
  return mocked(() => mock.mockListAnnotations(range.from, range.to));
}
export function createMarketingAnnotation(input: MarketingAnnotationInput): Promise<MarketingAnnotationDTO> {
  if (!config.useMocks) return apiRequest<MarketingAnnotationDTO>('/admin/marketing/annotations', { method: 'POST', body: input });
  return mocked(() => mock.mockCreateAnnotation(input));
}
/** `PATCH` — al pasar a un tipo que no es promoción, `destino: ''` lo borra (DTO del servidor `Length(0,200)`). */
export function updateMarketingAnnotation(id: string, input: MarketingAnnotationInput): Promise<MarketingAnnotationDTO> {
  if (!config.useMocks) {
    return apiRequest<MarketingAnnotationDTO>(`/admin/marketing/annotations/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
  }
  return mocked(() => mock.mockUpdateAnnotation(id, input));
}
export function deleteMarketingAnnotation(id: string): Promise<void> {
  if (!config.useMocks) return apiRequest<void>(`/admin/marketing/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return mocked(() => mock.mockDeleteAnnotation(id));
}

// ---------------------------------------------------------------- acceso del analista (§MKT.G.6, solo super_admin)

export function listMarketingTokens(): Promise<{ items: MarketingApiTokenView[] }> {
  if (!config.useMocks) return apiRequest<{ items: MarketingApiTokenView[] }>('/admin/marketing/tokens');
  return mocked(() => mock.mockListTokens());
}
export function issueMarketingToken(label: string): Promise<MarketingApiTokenIssued> {
  if (!config.useMocks) return apiRequest<MarketingApiTokenIssued>('/admin/marketing/tokens', { method: 'POST', body: { label } });
  return mocked(() => mock.mockIssueToken(label));
}
export function revokeMarketingToken(id: string): Promise<MarketingApiTokenView> {
  if (!config.useMocks) {
    return apiRequest<MarketingApiTokenView>(`/admin/marketing/tokens/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
  }
  return mocked(() => mock.mockRevokeToken(id));
}

// ---------------------------------------------------------------- evento de prueba de Meta (§MKT.H.12, solo super_admin)

/**
 * `POST /admin/measurement/meta-test-event` (v1.112). 200 con el diagnóstico también si Meta rechaza; errores 409
 * `MEASUREMENT_META_NOT_CONFIGURED`, 422 `VALIDATION_ERROR`, 429 `RATE_LIMITED` (`details.retryAfterSeconds`).
 * ⛔ El código y el resultado se devuelven al llamador y NADA de aquí los guarda (ni URL: el código va en el cuerpo).
 */
export function sendMetaTestEvent(testEventCode: string): Promise<MetaTestEventResult> {
  if (!config.useMocks) {
    return apiRequest<MetaTestEventResult>('/admin/measurement/meta-test-event', { method: 'POST', body: { testEventCode } });
  }
  return mocked(() => mock.mockMetaTestEvent(testEventCode));
}

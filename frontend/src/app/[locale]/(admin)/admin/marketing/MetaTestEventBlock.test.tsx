/**
 * C-F10 (contrato §MKT.H.12, v1.112) · `DESIGN_SYSTEM §MKT-UX.10-b` — bloque «Enviar evento de prueba a Meta» dentro de
 * «Acceso del analista». Pinta los tres `status` (accepted, rejected con y sin mensaje, unreachable), 409 y 429; 422 y
 * error de red; valida con la regex del servidor; un solo envío por clic; ⛔ código y resultado fuera de URL, storage,
 * cachés del QueryClient y `data-*`. «Bloque ausente para otro rol»: `MarketingView.test.tsx` (UX-MKT-17 + C-F10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import { ApiClientError } from '@/lib/api-client';
import type { MetaTestEventResult } from '@/types/contract';
import { ForbiddenCtx } from './forbidden';

const api = vi.hoisted(() => ({
  listMarketingTokens: vi.fn(),
  issueMarketingToken: vi.fn(),
  revokeMarketingToken: vi.fn(),
  sendMetaTestEvent: vi.fn(),
}));
vi.mock('@/lib/marketing-api', () => api);

// eslint-disable-next-line import/first
import { AnalystAccessPanel } from './AnalystAccessPanel';
// eslint-disable-next-line import/first
import { retryMinutes } from './MetaTestEventBlock';

const CODE = 'TEST48213';
const EVENT_ID = 'test-6f1c2a9e-3b7d-4c11-9a2e-0d5b8e7f4a10';
const RESULT: MetaTestEventResult = {
  status: 'accepted',
  httpStatus: 200,
  metaVersion: 'v26.0',
  pixelId: '000000000000000',
  testEventCode: CODE,
  eventName: 'PageView',
  eventId: EVENT_ID,
  sentAt: '2026-10-26T18:04:00.000Z',
  eventsReceived: 1,
  fbtraceId: 'AzYxWvUtSrQpOnM',
  metaMessages: [],
  metaError: null,
};
const err = (status: number, code: string, details?: Record<string, unknown>) =>
  new ApiClientError(status, { code, message: 'x', details });

let client: QueryClient;
function renderPanel(opts: { locale?: 'es' | 'en'; forbidden?: (e: unknown) => boolean } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const locale = opts.locale ?? 'es';
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en} timeZone="America/Mexico_City">
        <ForbiddenCtx.Provider value={opts.forbidden ?? (() => false)}>
          <AnalystAccessPanel />
        </ForbiddenCtx.Provider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.listMarketingTokens.mockResolvedValue({ items: [] });
  api.sendMetaTestEvent.mockResolvedValue(RESULT);
});
afterEach(() => vi.clearAllMocks());

async function block() {
  return screen.findByTestId('mkt-metatest');
}
async function sendCode(u: ReturnType<typeof userEvent.setup>, code: string) {
  const b = await block();
  const field = within(b).getByLabelText('Código de prueba');
  await u.clear(field);
  await u.type(field, code);
  await u.click(within(b).getByTestId('mkt-metatest-submit'));
}
const result = () => screen.getByTestId('mkt-metatest-result');

/** Todo lo que podría retener el código o el resultado fuera del estado del componente. */
function leaks(needles: string[]): string[] {
  const places: Record<string, string> = {
    localStorage: JSON.stringify({ ...window.localStorage }),
    sessionStorage: JSON.stringify({ ...window.sessionStorage }),
    url: window.location.href,
    queryCache: JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data)),
    mutationCache: JSON.stringify(client.getMutationCache().getAll().map((m) => m.state.data)),
    dataAttrs: Array.from(document.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.attributes).filter((a) => a.name.startsWith('data-')).map((a) => a.value))
      .join('|'),
  };
  return Object.entries(places)
    .filter(([, v]) => needles.some((n) => v.includes(n)))
    .map(([k]) => k);
}

describe('C-F10 · estructura y validación', () => {
  it('el bloque sale aunque la lista de llaves falle, con título, 3 pasos, campo, botón y nota', async () => {
    api.listMarketingTokens.mockRejectedValue(err(500, 'INTERNAL'));
    renderPanel();
    const b = await block();
    expect(within(b).getByRole('heading', { level: 3 })).toHaveTextContent('Enviar evento de prueba a Meta');
    expect(within(b).getAllByRole('listitem')).toHaveLength(3);
    const field = within(b).getByLabelText('Código de prueba');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('spellcheck', 'false');
    expect(field).toHaveAttribute('maxlength', '20');
    expect(within(b).getByText(/Máximo 5 por hora/)).toBeInTheDocument();
    expect(within(b).getByTestId('mkt-metatest-submit')).toBeEnabled();
  });

  it.each([[''], ['TEST12'], ['TEST12345678901'], ['test12345'], ['TEST 12345'], ['TESTabc']])(
    'formato inválido «%s» ⇒ error en el campo y 0 envíos (botón nunca deshabilitado)',
    async (bad) => {
      const u = userEvent.setup();
      renderPanel();
      const b = await block();
      const field = within(b).getByLabelText('Código de prueba');
      if (bad) await u.type(field, bad);
      const submit = within(b).getByTestId('mkt-metatest-submit');
      expect(submit).toBeEnabled();
      await u.click(submit);
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(within(b).getByText(/El código debe empezar con TEST/)).toBeInTheDocument();
      expect(within(b).queryByText(/Ejemplo: TEST12345/)).toBeNull(); // el error sustituye la ayuda
      expect(api.sendMetaTestEvent).not.toHaveBeenCalled();
    },
  );

  it('recorta antes de validar y envía el valor recortado', async () => {
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, `  ${CODE} `);
    await waitFor(() => expect(api.sendMetaTestEvent).toHaveBeenCalledWith(CODE));
  });

  it('al salir del campo vacío no regaña; con un código mal formado, sí', async () => {
    const u = userEvent.setup();
    renderPanel();
    const b = await block();
    const field = within(b).getByLabelText('Código de prueba');
    fireEvent.blur(field);
    expect(field).not.toHaveAttribute('aria-invalid');
    await u.type(field, 'TEST1');
    fireEvent.blur(field);
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('C-F10 · los cinco resultados', () => {
  it('accepted ⇒ banner de éxito, ID del evento, versión, seguimiento y hora; foco al título; nada fuera del estado', async () => {
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, CODE);
    const title = await within(result()).findByText('Meta recibió el evento.');
    expect(result()).toHaveAttribute('aria-live', 'polite');
    expect(result()).toHaveTextContent(`busca un PageView con este ID de evento: ${EVENT_ID}`);
    expect(screen.getByTestId('mkt-metatest-eventid')).toHaveTextContent(EVENT_ID);
    expect(result()).toHaveTextContent('v26.0');
    expect(result()).toHaveTextContent('AzYxWvUtSrQpOnM');
    expect(result().querySelector('time')).toHaveAttribute('dateTime', RESULT.sentAt);
    await waitFor(() => expect(title).toHaveFocus());
    expect(leaks([CODE, EVENT_ID, 'AzYxWvUtSrQpOnM'])).toEqual([]);
  });

  it('rejected con mensaje ⇒ banner de peligro con el mensaje de Meta en `lang="en"`, como texto (⛔ HTML)', async () => {
    const msg = 'Invalid parameter <b>test_event_code</b>';
    api.sendMetaTestEvent.mockResolvedValueOnce({
      ...RESULT,
      status: 'rejected',
      httpStatus: 400,
      eventsReceived: null,
      metaError: { code: 100, subcode: null, type: 'OAuthException', message: msg },
    });
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, CODE);
    await within(result()).findByText('Meta rechazó el evento.');
    const span = within(result()).getByText(msg);
    expect(span).toHaveAttribute('lang', 'en');
    expect(result().querySelector('b')).toBeNull();
    expect(result()).toHaveTextContent(`Meta respondió: «${msg}». Revisa que copiaste el código completo.`);
  });

  it('rejected con mensaje de más de 300 caracteres ⇒ se trunca a 300', async () => {
    api.sendMetaTestEvent.mockResolvedValueOnce({
      ...RESULT,
      status: 'rejected',
      metaError: { code: 100, subcode: null, type: null, message: 'a'.repeat(320) },
    });
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, CODE);
    await within(result()).findByText('Meta rechazó el evento.');
    expect(within(result()).getByText('a'.repeat(300))).toBeInTheDocument();
  });

  it('rejected sin mensaje ⇒ «Meta no explicó el motivo.»', async () => {
    api.sendMetaTestEvent.mockResolvedValueOnce({
      ...RESULT,
      status: 'rejected',
      httpStatus: 400,
      metaError: { code: 100, subcode: null, type: null, message: null },
    });
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, CODE);
    await within(result()).findByText('Meta rechazó el evento.');
    expect(result()).toHaveTextContent('Meta no explicó el motivo. Pásale el ID de seguimiento al equipo técnico.');
    expect(result()).not.toHaveTextContent('Meta respondió');
  });

  it('unreachable ⇒ «No se pudo contactar con Meta.» y «Cada intento cuenta»', async () => {
    api.sendMetaTestEvent.mockResolvedValueOnce({
      ...RESULT,
      status: 'unreachable',
      httpStatus: null,
      eventsReceived: null,
      fbtraceId: null,
    });
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, CODE);
    await within(result()).findByText('No se pudo contactar con Meta.');
    expect(result()).toHaveTextContent('Cada intento cuenta para el límite por hora.');
    expect(result()).toHaveTextContent('—'); // sin ID de seguimiento
  });

  it('409 MEASUREMENT_META_NOT_CONFIGURED ⇒ aviso de configuración en Railway', async () => {
    api.sendMetaTestEvent.mockRejectedValueOnce(err(409, 'MEASUREMENT_META_NOT_CONFIGURED', { reason: 'missing_config' }));
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, CODE);
    const title = await within(result()).findByText('Meta no está configurado en el servidor.');
    expect(result()).toHaveTextContent('META_PIXEL_ID y META_CAPI_TOKEN');
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('429 con retryAfterSeconds 61 ⇒ «Podrás enviar otro en 2 min.»', async () => {
    api.sendMetaTestEvent.mockRejectedValueOnce(err(429, 'RATE_LIMITED', { retryAfterSeconds: 61 }));
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, CODE);
    await within(result()).findByText('Ya enviaste 5 eventos de prueba en la última hora.');
    expect(result()).toHaveTextContent('Podrás enviar otro en 2 min.');
  });

  it('minutos de espera: ceil(s/60), mínimo 1', () => {
    expect(retryMinutes(61)).toBe(2);
    expect(retryMinutes(60)).toBe(1);
    expect(retryMinutes(0)).toBe(1);
    expect(retryMinutes(undefined)).toBe(1);
    expect(retryMinutes(3540)).toBe(59);
  });

  it('422 del servidor ⇒ el mismo error de formato en el campo y sin banner', async () => {
    api.sendMetaTestEvent.mockRejectedValueOnce(err(422, 'VALIDATION_ERROR', { field: 'testEventCode' }));
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, CODE);
    const field = within(await block()).getByLabelText('Código de prueba');
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText(/El código debe empezar con TEST/)).toBeInTheDocument();
    expect(result()).toBeEmptyDOMElement();
  });

  it('500 / red ⇒ «No se pudo enviar la solicitud. Inténtalo de nuevo.»', async () => {
    api.sendMetaTestEvent.mockRejectedValueOnce(new TypeError('fetch failed'));
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, CODE);
    expect(await within(result()).findByText('No se pudo enviar la solicitud. Inténtalo de nuevo.')).toBeInTheDocument();
  });

  it('403 ⇒ lo reporta a la vista (estado «sin permiso») y no pinta banner propio', async () => {
    const forbidden = vi.fn(() => true);
    api.sendMetaTestEvent.mockRejectedValueOnce(err(403, 'FORBIDDEN'));
    const u = userEvent.setup();
    renderPanel({ forbidden });
    await sendCode(u, CODE);
    await waitFor(() => expect(forbidden).toHaveBeenCalled());
    expect(result()).toBeEmptyDOMElement();
  });

  it('un envío nuevo reemplaza el resultado anterior', async () => {
    const u = userEvent.setup();
    renderPanel();
    await sendCode(u, CODE);
    await within(result()).findByText('Meta recibió el evento.');
    api.sendMetaTestEvent.mockRejectedValueOnce(err(429, 'RATE_LIMITED', { retryAfterSeconds: 600 }));
    await u.click(screen.getByTestId('mkt-metatest-submit'));
    await within(result()).findByText('Ya enviaste 5 eventos de prueba en la última hora.');
    expect(result()).not.toHaveTextContent('Meta recibió el evento.');
  });

  it('EN: rejected pinta la frase inglesa con el mensaje en su sitio', async () => {
    api.sendMetaTestEvent.mockResolvedValueOnce({
      ...RESULT,
      status: 'rejected',
      metaError: { code: 1, subcode: null, type: null, message: 'Bad code' },
    });
    const u = userEvent.setup();
    renderPanel({ locale: 'en' });
    const b = await block();
    await u.type(within(b).getByLabelText('Test code'), CODE);
    await u.click(within(b).getByTestId('mkt-metatest-submit'));
    await within(result()).findByText('Meta rejected the event.');
    expect(result()).toHaveTextContent('Meta replied: "Bad code". Check that you copied the whole code.');
  });
});

describe('C-F10 · un solo envío por clic', () => {
  it('mientras envía: botón «Enviando…», campo de solo lectura y dos envíos en el mismo tick ⇒ 1 llamada', async () => {
    let resolve!: (v: MetaTestEventResult) => void;
    api.sendMetaTestEvent.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const u = userEvent.setup();
    renderPanel();
    const b = await block();
    await u.type(within(b).getByLabelText('Código de prueba'), CODE);
    const form = b.querySelector('form') as HTMLFormElement;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(api.sendMetaTestEvent).toHaveBeenCalledTimes(1);
    expect(within(b).getByTestId('mkt-metatest-submit')).toHaveTextContent('Enviando…');
    expect(within(b).getByLabelText('Código de prueba')).toHaveAttribute('readonly');
    await act(async () => resolve(RESULT));
    await within(result()).findByText('Meta recibió el evento.');
    expect(api.sendMetaTestEvent).toHaveBeenCalledTimes(1);
  });
});

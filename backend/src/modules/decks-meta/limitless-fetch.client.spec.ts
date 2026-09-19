import type { ConfigService } from '@nestjs/config';
import { LimitlessFetchClient } from './limitless-fetch.client';

/**
 * DECKS-META Fase 2 (§9) — el cliente HTTP de Limitless: la superficie de EGRESS a un tercero. El
 * candado que este spec sostiene es el ANTI-SSRF: `redirect:'manual'` + validación del `Location`
 * ANTES de seguirlo. Un 3xx fuera del allowlist se RECHAZA **sin traerlo** (jamás se hace `fetch` de
 * un `Location` no validado). Si alguien vuelve a `redirect:'follow'`, el `fetch` off-host ocurre y
 * este test lo pone en rojo (cuenta las llamadas a `fetch`).
 */
describe('LimitlessFetchClient (§9) — redirect manual + validación anti-SSRF', () => {
  const originalFetch = global.fetch;
  // Config vacío ⇒ defaults pineados (timeout 10s, 2 reintentos, cap 3MB, delay 1.5s).
  const config = { get: () => undefined } as unknown as ConfigService;
  const client = new LimitlessFetchClient(config);

  /** Response-like mínima (sin stream: `readCapped` cae a `text()`). */
  function fakeRes(
    over: { status?: number; headers?: Record<string, string>; text?: string; url?: string } = {},
  ): Response {
    const status = over.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      url: over.url ?? 'https://limitlesstcg.com/',
      headers: new Headers(over.headers ?? {}),
      body: null,
      text: jest.fn(async () => over.text ?? '<html>ok</html>'),
      arrayBuffer: jest.fn(async () => new ArrayBuffer(0)),
    } as unknown as Response;
  }

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('⛔ un redirect FUERA del allowlist se rechaza SIN traer el Location (fetch se llama 1 sola vez)', async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) =>
      fakeRes({ status: 302, headers: { location: 'https://evil.example.com/pwn' } }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.fetchHome()).rejects.toThrow(/allowlist/);
    // La clave del candado: el Location off-host NUNCA se pidió. Una sola llamada = la original.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://limitlesstcg.com/');
  });

  it('un redirect relativo que resuelve fuera del allowlist también se rechaza (no se sigue)', async () => {
    // Un `Location` que parezca relativo pero con `//host` salta de origen: debe rechazarse.
    const fetchMock = jest.fn(async () => fakeRes({ status: 301, headers: { location: '//evil.example.com/x' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.fetchHome()).rejects.toThrow(/allowlist/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un 3xx sin cabecera Location se rechaza (no hay a dónde seguir)', async () => {
    const fetchMock = jest.fn(async () => fakeRes({ status: 302, headers: {} }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.fetchHome()).rejects.toThrow(/sin Location/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un redirect ON-HOST sí se sigue (validado) y devuelve el cuerpo final', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fakeRes({ status: 302, headers: { location: 'https://limitlesstcg.com/otra' } }))
      .mockResolvedValueOnce(fakeRes({ status: 200, url: 'https://limitlesstcg.com/otra', text: '<html>final</html>' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const out = await client.fetchHome();
    expect(out).toBe('<html>final</html>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://limitlesstcg.com/otra');
  });

  it('cadena de redirects on-host que excede la cota de saltos se rechaza', async () => {
    // Siempre 302 a otra URL on-host ⇒ bucle acotado por MAX_REDIRECT_HOPS (3).
    const fetchMock = jest.fn(async () =>
      fakeRes({ status: 302, headers: { location: 'https://limitlesstcg.com/loop' } }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.fetchHome()).rejects.toThrow(/demasiados redirects/);
    // 1 original + 3 saltos permitidos = 4 llamadas; el 4º salto es el que corta.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('la ruta feliz (200) usa redirect:manual y devuelve el HTML', async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => fakeRes({ status: 200, text: '<html>home</html>' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const out = await client.fetchHome();
    expect(out).toBe('<html>home</html>');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // El modo de redirect pedido es 'manual' (no 'follow'): el 3xx no se sigue solo.
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe('manual');
  });
});

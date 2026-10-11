/**
 * D1c — URLs del proveedor y proxy de la etiqueta: PS-100 🔒, las partes de `shipping-provider` de PS-84 🔒 y PS-88,
 * y los candados estáticos `C-SDX-7` (1) y `C-SDX-1` (PS-86) (API_CONTRACT §19.18.5, §19.19.9, §19.16).
 *
 * Mutaciones que la ponen roja: adjuntar siempre el token (PS-100); `redirect:'follow'` o seguir una `Location` sin
 * `assertProviderUrl`; aceptar `text/html`; no abortar por tamaño (PS-84); un `fetch` nuevo en `shipping-provider/`
 * fuera del cliente y del proxy (C-SDX-7 (1)); una URL de Skydropx en el código (C-SDX-1).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { downloadLabelPdf, LabelApiAccess } from '../src/modules/shipping-provider/label-proxy';
import { assertProviderUrl, providerUrlsFrom, resolveUrlHosts } from '../src/modules/shipping-provider/provider-url';
import { ShippingProviderError } from '../src/modules/shipping-provider/shipping-provider.errors';
import { anclasEstructurales, codigoDeFichero, codigoDeTexto } from './helpers/codigo-de-fichero';

const API_HOST = 'pro.skydropx.com';
const HOSTS = [API_HOST, 'labels.example-bucket.com'];

describe('assertProviderUrl (PS-84 / PS-88, SEC-SDX-5)', () => {
  it.each([
    ['http://169.254.169.254/latest/', null],
    ['http://pro.skydropx.com/x.pdf', null],
    ['https://user:pw@pro.skydropx.com/x', null],
    ['https://pro.skydropx.com:8443/x', null],
    ['https://evil.example/x.pdf', null],
    ['javascript:alert(1)', null],
    ['http://evil.example/t', null],
    ['', null],
    [`https://pro.skydropx.com/${'a'.repeat(2048)}`, null],
    ['https://pro.skydropx.com/labels/1.pdf', 'https://pro.skydropx.com/labels/1.pdf'],
    ['https://labels.example-bucket.com/x.pdf?sig=abc', 'https://labels.example-bucket.com/x.pdf?sig=abc'],
  ])('%s ⇒ %p', (url, expected) => {
    expect(assertProviderUrl(url, HOSTS)).toBe(expected);
  });

  it('comodín *.dominio ⇒ UN nivel de subdominio, no el dominio pelón ni dos niveles', () => {
    const hosts = ['*.skydropx.com'];
    expect(assertProviderUrl('https://labels.skydropx.com/x.pdf', hosts)).not.toBeNull();
    expect(assertProviderUrl('https://skydropx.com/x.pdf', hosts)).toBeNull();
    expect(assertProviderUrl('https://a.b.skydropx.com/x.pdf', hosts)).toBeNull();
    expect(assertProviderUrl('https://skydropx.com.evil.example/x.pdf', hosts)).toBeNull();
  });

  it('no-cadena ⇒ null', () => {
    for (const v of [null, undefined, 42, {}]) expect(assertProviderUrl(v, HOSTS)).toBeNull();
  });

  it('SKYDROPX_URL_HOSTS ausente ⇒ SOLO el host de la API; con valor ⇒ la lista', () => {
    expect(resolveUrlHosts(undefined, 'pro.skydropx.com')).toEqual(['pro.skydropx.com']);
    expect(resolveUrlHosts('  ', 'pro.skydropx.com')).toEqual(['pro.skydropx.com']);
    expect(resolveUrlHosts('pro.skydropx.com, Labels.Example-Bucket.com', 'x')).toEqual(['pro.skydropx.com', 'labels.example-bucket.com']);
  });

  it('providerUrlsFrom: rechazada ⇒ null + {field, host} (sin la URL entera); válida ⇒ pasa', () => {
    const out = providerUrlsFrom(
      { rawLabelUrl: 'http://169.254.169.254/latest/?sig=SECRET', rawTrackingUrl: 'https://pro.skydropx.com/t/1' },
      HOSTS,
    );
    expect(out.labelUrl).toBeNull();
    expect(out.trackingUrl).toBe('https://pro.skydropx.com/t/1');
    expect(out.rejected).toEqual([{ field: 'labelUrl', host: '169.254.169.254' }]);
    expect(JSON.stringify(out.rejected)).not.toContain('SECRET');
    expect(providerUrlsFrom({ rawLabelUrl: null, rawTrackingUrl: undefined }, HOSTS)).toEqual({ labelUrl: null, trackingUrl: null, rejected: [] });
    expect(providerUrlsFrom({ rawTrackingUrl: 'javascript:alert(1)' }, HOSTS).rejected).toEqual([{ field: 'trackingUrl', host: null }]);
  });
});

describe('PS-100 🔒 — proxy de la etiqueta: Authorization SOLO al host de la API', () => {
  function api(): LabelApiAccess & { slots: number; tokens: number } {
    const a = {
      apiHost: API_HOST,
      slots: 0,
      tokens: 0,
      accessToken: async () => {
        a.tokens += 1;
        return 'tok-secret';
      },
      acquireSlot: async () => {
        a.slots += 1;
      },
    };
    return a;
  }

  type Seen = { url: string; headers: Record<string, string>; redirect?: string };
  function fakeFetch(responses: Record<string, () => Response>, seen: Seen[]) {
    return async (url: string, init: RequestInit) => {
      seen.push({ url, headers: { ...(init.headers as Record<string, string>) }, redirect: init.redirect as string });
      const r = responses[url];
      if (!r) throw new Error(`fetch inesperado a ${url}`);
      return r();
    };
  }
  const pdf = (bytes = 8, extra: Record<string, string> = {}) =>
    new Response(Buffer.alloc(bytes, 0x25), { status: 200, headers: { 'content-type': 'application/pdf', ...extra } });

  it('labelUrl en el host de la API ⇒ lleva Authorization (y User-Agent), pasa por la cubeta', async () => {
    const seen: Seen[] = [];
    const a = api();
    const buf = await downloadLabelPdf('https://pro.skydropx.com/labels/1.pdf', {
      api: a,
      allowedHosts: HOSTS,
      fetchImpl: fakeFetch({ 'https://pro.skydropx.com/labels/1.pdf': () => pdf() }, seen),
    });
    expect(buf.length).toBe(8);
    expect(seen[0].headers.Authorization).toBe('Bearer tok-secret');
    expect(seen[0].headers['User-Agent']).toMatch(/^tcg-hunt\//);
    expect(seen[0].redirect).toBe('manual');
    expect(a.slots).toBe(1);
  });

  it('labelUrl en labels.example-bucket.com (listado) ⇒ SIN Authorization, con User-Agent; ni se pide el token', async () => {
    const seen: Seen[] = [];
    const a = api();
    await downloadLabelPdf('https://labels.example-bucket.com/x.pdf?sig=1', {
      api: a,
      allowedHosts: HOSTS,
      fetchImpl: fakeFetch({ 'https://labels.example-bucket.com/x.pdf?sig=1': () => pdf() }, seen),
    });
    expect(seen[0].headers.Authorization).toBeUndefined();
    expect(seen[0].headers['User-Agent']).toMatch(/^tcg-hunt\//);
    expect(a.tokens).toBe(0);
  });

  it('redirección de la API a la cubeta ⇒ el segundo salto va SIN token', async () => {
    const seen: Seen[] = [];
    await downloadLabelPdf('https://pro.skydropx.com/labels/1.pdf', {
      api: api(),
      allowedHosts: HOSTS,
      fetchImpl: fakeFetch(
        {
          'https://pro.skydropx.com/labels/1.pdf': () =>
            new Response(null, { status: 302, headers: { location: 'https://labels.example-bucket.com/1.pdf' } }),
          'https://labels.example-bucket.com/1.pdf': () => pdf(),
        },
        seen,
      ),
    });
    expect(seen.map((s) => [s.url, s.headers.Authorization ?? null])).toEqual([
      ['https://pro.skydropx.com/labels/1.pdf', 'Bearer tok-secret'],
      ['https://labels.example-bucket.com/1.pdf', null],
    ]);
  });

  async function expect502(p: Promise<unknown>, reason?: string) {
    const err = (await p.catch((e) => e)) as ShippingProviderError;
    expect(err).toBeInstanceOf(ShippingProviderError);
    expect(err.httpStatus).toBe(502);
    expect(err.details).toMatchObject({ provider: 'skydropx', op: 'label_download', ...(reason ? { reason } : {}) });
  }

  it('PS-84: 302 a http://10.0.0.1/ ⇒ 502 sin seguirla', async () => {
    const seen: Seen[] = [];
    await expect502(
      downloadLabelPdf('https://pro.skydropx.com/l.pdf', {
        api: api(),
        allowedHosts: HOSTS,
        fetchImpl: fakeFetch(
          { 'https://pro.skydropx.com/l.pdf': () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/' } }) },
          seen,
        ),
      }),
      'redirect',
    );
    expect(seen).toHaveLength(1);
  });

  it('PS-84: más de 3 saltos ⇒ 502', async () => {
    const seen: Seen[] = [];
    const hop = (n: number) => () =>
      new Response(null, { status: 302, headers: { location: `https://labels.example-bucket.com/${n}` } });
    await expect502(
      downloadLabelPdf('https://labels.example-bucket.com/0', {
        api: api(),
        allowedHosts: HOSTS,
        fetchImpl: fakeFetch(
          {
            'https://labels.example-bucket.com/0': hop(1),
            'https://labels.example-bucket.com/1': hop(2),
            'https://labels.example-bucket.com/2': hop(3),
            'https://labels.example-bucket.com/3': hop(4),
          },
          seen,
        ),
      }),
      'redirect',
    );
    expect(seen).toHaveLength(4);
  });

  it('PS-84: Content-Type text/html ⇒ 502', async () => {
    await expect502(
      downloadLabelPdf('https://pro.skydropx.com/l.pdf', {
        api: api(),
        allowedHosts: HOSTS,
        fetchImpl: fakeFetch(
          { 'https://pro.skydropx.com/l.pdf': () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) },
          [],
        ),
      }),
      'content_type',
    );
  });

  it('PS-84: 6 MB ⇒ 502 abortado (sin Content-Length y con él)', async () => {
    const big = 6 * 1024 * 1024;
    await expect502(
      downloadLabelPdf('https://pro.skydropx.com/l.pdf', {
        api: api(),
        allowedHosts: HOSTS,
        fetchImpl: fakeFetch({ 'https://pro.skydropx.com/l.pdf': () => pdf(big) }, []),
      }),
      'too_large',
    );
    await expect502(
      downloadLabelPdf('https://pro.skydropx.com/l.pdf', {
        api: api(),
        allowedHosts: HOSTS,
        fetchImpl: fakeFetch({ 'https://pro.skydropx.com/l.pdf': () => pdf(10, { 'content-length': String(big) }) }, []),
      }),
      'too_large',
    );
  });

  it('PS-84: URL fuera de la lista ⇒ 502 y CERO fetch; 4xx/5xx de la descarga ⇒ 502', async () => {
    const seen: Seen[] = [];
    await expect502(
      downloadLabelPdf('http://169.254.169.254/latest/', { api: api(), allowedHosts: HOSTS, fetchImpl: fakeFetch({}, seen) }),
      'url_rejected',
    );
    expect(seen).toHaveLength(0);
    await expect502(
      downloadLabelPdf('https://pro.skydropx.com/l.pdf', {
        api: api(),
        allowedHosts: HOSTS,
        fetchImpl: fakeFetch({ 'https://pro.skydropx.com/l.pdf': () => new Response('x', { status: 404 }) }, []),
      }),
    );
  });
});

// ── Estáticos ───────────────────────────────────────────────────────────────────────────────────────────────────

const BACKEND = join(__dirname, '..');
const SRC = join(BACKEND, 'src');
const SP = join(SRC, 'modules/shipping-provider');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(BACKEND, p).split(sep).join('/');
function code(p: string): string {
  const raw = readFileSync(p, 'utf8');
  return codigoDeTexto(raw, rel(p), anclasEstructurales(raw, rel(p)));
}

describe('C-SDX-7 (1) — `fetch` en shipping-provider/ SOLO en el cliente y en el proxy (con assertProviderUrl en la misma función)', () => {
  it('lista exacta de ficheros que nombran fetch', () => {
    const users = walk(SP)
      .filter((f) => /\bfetch\b/.test(code(f)))
      .map(rel)
      .sort();
    expect(users).toEqual([
      'src/modules/shipping-provider/http/skydropx-client.ts',
      'src/modules/shipping-provider/label-proxy.ts',
    ]);
  });

  it('en label-proxy, la función que llama a fetch es la que llama a assertProviderUrl', () => {
    const c = codigoDeFichero(join(SP, 'label-proxy.ts'), ['export async function downloadLabelPdf(']);
    const start = c.indexOf('export async function downloadLabelPdf(');
    const next = c.indexOf('\nfunction ', start);
    const body = c.slice(start, next === -1 ? undefined : next);
    expect(body).toMatch(/\bfetch\(/);
    expect(body.match(/assertProviderUrl\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2); // la URL y cada Location
    expect(body).toContain("redirect: 'manual'");
    const outside = c.slice(0, start) + (next === -1 ? '' : c.slice(next));
    expect(outside).not.toMatch(/\bfetch\b/);
  });

  it('el fetch del cliente no sigue redirecciones', () => {
    expect(codigoDeFichero(join(SP, 'http/skydropx-client.ts'), ['export const fetchTransport'])).toMatch(
      /fetchTransport[\s\S]*?redirect: 'manual'/,
    );
  });
});

/**
 * ⭐ v1.80.12.1 (API_CONTRACT §M4-SHIP.19.21.2) — `C-SDX-7` (2), texto nuevo. Sobre el TEXTO del fichero (comentarios
 * incluidos), como el `rg` del contrato:
 *  (a) `rawLabelUrl|rawTrackingUrl` fuera de `shipping-provider/` ⇒ 0;
 *  (b) `label_url|tracking_url` fuera de `shipping-provider/` ⇒ 0.
 */
const RAW_URL_NAMES = /rawLabelUrl|rawTrackingUrl/;
const RAW_URL_KEYS = /label_url|tracking_url/;
function rawUrlLeaks(files: { path: string; text: string }[]): { a: string[]; b: string[] } {
  const outside = files.filter((f) => !f.path.startsWith('src/modules/shipping-provider/'));
  return {
    a: outside.filter((f) => RAW_URL_NAMES.test(f.text)).map((f) => f.path),
    b: outside.filter((f) => RAW_URL_KEYS.test(f.text)).map((f) => f.path),
  };
}

describe('C-SDX-7 (2) — la URL cruda del proveedor solo se lee dentro de shipping-provider/ (v1.80.12.1)', () => {
  const tree = () => walk(SRC).map((f) => ({ path: rel(f), text: readFileSync(f, 'utf8') }));

  it('(a) y (b): cero fuera de shipping-provider/', () => {
    expect(rawUrlLeaks(tree())).toEqual({ a: [], b: [] });
  });

  it('dentro: el puerto los declara, el adaptador y el doble los producen, y providerUrlsFrom es la única que los LEE', () => {
    const inside = tree().filter((f) => f.path.startsWith('src/modules/shipping-provider/') && RAW_URL_NAMES.test(code(join(BACKEND, f.path))));
    expect(inside.map((f) => f.path).sort()).toEqual([
      'src/modules/shipping-provider/fake-shipping-provider.ts',
      'src/modules/shipping-provider/provider-url.ts',
      'src/modules/shipping-provider/shipping-provider.port.ts',
      'src/modules/shipping-provider/skydropx.adapter.ts',
    ]);
    // lectura = `<algo>.rawLabelUrl` / `.rawTrackingUrl`: solo en provider-url.ts (el doble copia su propio estado).
    const readers = inside
      .filter((f) => f.path !== 'src/modules/shipping-provider/fake-shipping-provider.ts')
      .filter((f) => /\.\s*raw(Label|Tracking)Url\b/.test(code(join(BACKEND, f.path))))
      .map((f) => f.path);
    expect(readers).toEqual(['src/modules/shipping-provider/provider-url.ts']);
  });

  it('CANARIO: `labelUrl: result.rawLabelUrl` en un fichero de shipments/ ⇒ ROJO en (a); `pkg.label_url` ⇒ ROJO en (b)', () => {
    const planted = [
      ...tree(),
      { path: 'src/modules/shipments/canario-raw.ts', text: 'export const x = (result: any) => ({ labelUrl: result.rawLabelUrl });' },
      { path: 'src/modules/shipments/canario-key.ts', text: 'export const y = (pkg: any) => pkg.label_url;' },
    ];
    expect(rawUrlLeaks(planted)).toEqual({ a: ['src/modules/shipments/canario-raw.ts'], b: ['src/modules/shipments/canario-key.ts'] });
  });
});

describe('C-SDX-1 / PS-86 — secretos y URL base fuera del código', () => {
  it("ninguna cadena 'skydropx.com' en el CÓDIGO de backend/src (solo comentarios o env.validation.ts)", () => {
    const hits = walk(SRC)
      .filter((f) => !f.endsWith(join('config', 'env.validation.ts')))
      .filter((f) => readFileSync(f, 'utf8').toLowerCase().includes('skydropx.com'))
      .filter((f) => code(f).toLowerCase().includes('skydropx.com'))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it('SKYDROPX_CLIENT_SECRET se lee SOLO en shipping-provider.factory.ts', () => {
    const readers = walk(SRC)
      .filter((f) => readFileSync(f, 'utf8').includes('SKYDROPX_CLIENT_SECRET'))
      .filter((f) => code(f).includes('SKYDROPX_CLIENT_SECRET'))
      .map(rel);
    expect(readers).toEqual(['src/modules/shipping-provider/shipping-provider.factory.ts']);
  });
});

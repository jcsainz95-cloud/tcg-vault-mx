/**
 * La línea «marketing: lectura externa fallida (<fuente>)» dice la CLASE del error (lista cerrada) y nada sensible.
 * Origen: 15/15 líneas sin causa en producción (Search Console, 2026-11-03). Clasificador: marketing-source-error.ts.
 */
import { Logger } from '@nestjs/common';
import { gaxios } from 'google-auth-library';
import { MarketingExternalSources, type GoogleReadPort } from '../src/modules/marketing/marketing-external-sources';
import { classifySourceError } from '../src/modules/marketing/marketing-source-error';

const EMAIL = 'panel@tienda.iam.gserviceaccount.com';
const SITE = 'sc-domain:tcghunt.mx';
const SA = JSON.stringify({ client_email: EMAIL, private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n' });
const ENV: Record<string, string> = { MKT_GOOGLE_SA_JSON: SA, MKT_SEARCH_CONSOLE_SITE: SITE, MKT_GA4_PROPERTY_ID: '123456789' };
const config = { get: (k: string) => ENV[k] } as never;
const SENSITIVE = [EMAIL, 'tcghunt', 'https', 'SECRET', 'googleapis', 'PRIVATE', 'sufficient permission', 'Bad Request desc'];

/** Error con la forma de gaxios: `response.status` + `response.data`. */
function httpErr(status: number, data: unknown, message = `Request failed https://searchconsole.googleapis.com/x/${SITE}?key=SECRET`): Error {
  return Object.assign(new Error(message), { response: { status, data } });
}

async function logLineFor(err: unknown, source: 'sc' | 'ga4' = 'sc'): Promise<string> {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  try {
    const port: GoogleReadPort = { postJson: jest.fn().mockRejectedValue(err) };
    const svc = new MarketingExternalSources(config, port);
    const r =
      source === 'sc'
        ? await svc.searchConsoleQueries('2026-10-01', '2026-10-07')
        : await svc.ga4Report({ dimensions: ['pagePath'], metrics: ['sessions'] }, '2026-10-01', '2026-10-07');
    expect(r).toEqual({ ok: false });
    expect(warn).toHaveBeenCalledTimes(1);
    return String(warn.mock.calls[0][0]);
  } finally {
    warn.mockRestore();
  }
}

const noLeak = (line: string): void => {
  for (const s of SENSITIVE) expect(line).not.toContain(s);
};

describe('lectura externa fallida — clase del error en el registro (lista cerrada)', () => {
  it('403 de Google PERMISSION_DENIED ⇒ «(sc) http=403 reason=PERMISSION_DENIED», sin mensaje, sitio ni URL', async () => {
    const line = await logLineFor(
      httpErr(403, { error: { code: 403, message: `User does not have sufficient permission for site '${SITE}'`, status: 'PERMISSION_DENIED' } }),
    );
    expect(line).toBe('marketing: lectura externa fallida (sc) http=403 reason=PERMISSION_DENIED');
    noLeak(line);
  });

  it('formato v3 con errors[].reason ⇒ añade detalle en lista blanca', async () => {
    const line = await logLineFor(
      httpErr(403, { error: { code: 403, message: `no access ${SITE}`, errors: [{ message: 'x', domain: 'global', reason: 'forbidden' }], status: 'PERMISSION_DENIED' } }),
    );
    expect(line).toBe('marketing: lectura externa fallida (sc) http=403 reason=PERMISSION_DENIED detalle=forbidden');
  });

  it('reason fuera de lista (URL o texto libre) ⇒ «otro», nunca el texto', async () => {
    for (const bad of ['https://x.test/?key=SECRET', `${EMAIL}`, 'PERMISSION_DENIED tcghunt', 'permission_denied']) {
      const line = await logLineFor(httpErr(403, { error: { status: bad, errors: [{ reason: `${bad} SECRET` }] } }));
      expect(line).toBe('marketing: lectura externa fallida (sc) http=403 reason=otro detalle=otro');
      noLeak(line);
    }
  });

  it('error OAuth del endpoint de token ⇒ «token=invalid_grant», sin error_description', async () => {
    const line = await logLineFor(httpErr(400, { error: 'invalid_grant', error_description: `Bad Request desc ${EMAIL}` }, `invalid_grant: Bad Request desc ${EMAIL}`));
    expect(line).toBe('marketing: lectura externa fallida (sc) http=400 token=invalid_grant');
    noLeak(line);
    expect(classifySourceError(httpErr(400, { error: `${EMAIL} SECRET` }))).toBe('http=400 token=otro');
  });

  it('error de red de Node ⇒ «red=<código>»; timeout de node-fetch ⇒ red=TIMEOUT', async () => {
    const line = await logLineFor(Object.assign(new Error(`connect ETIMEDOUT https://x/${SITE}`), { code: 'ETIMEDOUT' }));
    expect(line).toBe('marketing: lectura externa fallida (sc) red=ETIMEDOUT');
    expect(classifySourceError({ name: 'GaxiosError', error: { type: 'request-timeout', message: 'network timeout at: https://x' } })).toBe('red=TIMEOUT');
    expect(classifySourceError(Object.assign(new Error('x'), { code: 'EWHATEVER_SECRET' }))).toBe('otro');
  });

  it('llave mal pegada al firmar ⇒ «cripto=<código OpenSSL>»', () => {
    expect(classifySourceError(Object.assign(new Error('error:1E08010C:DECODER routines::unsupported'), { code: 'ERR_OSSL_UNSUPPORTED' }))).toBe('cripto=ERR_OSSL_UNSUPPORTED');
    expect(classifySourceError(Object.assign(new Error('x'), { code: 'ERR_OSSL_SOMETHING_NEW' }))).toBe('cripto=otro');
  });

  it('texto arbitrario sin forma conocida ⇒ «otro» (con el tipo si está en lista)', async () => {
    const line = await logLineFor(new Error(`boom https://searchconsole.googleapis.com/${SITE}?key=SECRET ${EMAIL}`));
    expect(line).toBe('marketing: lectura externa fallida (sc) otro');
    noLeak(line);
    expect(classifySourceError(new TypeError('x'))).toBe('otro tipo=TypeError');
    expect(classifySourceError('cadena https://x SECRET')).toBe('otro');
    expect(classifySourceError(null)).toBe('otro');
    const hostile = { get response(): never { throw new Error('SECRET'); } };
    expect(classifySourceError(hostile)).toBe('otro');
  });

  it('GA4 usa la misma clase con su etiqueta: «(ga4) http=429 reason=RESOURCE_EXHAUSTED»', async () => {
    const line = await logLineFor(httpErr(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota properties/123456789' } }), 'ga4');
    expect(line).toBe('marketing: lectura externa fallida (ga4) http=429 reason=RESOURCE_EXHAUSTED');
    expect(line).not.toContain('123456789');
  });

  it('con un GaxiosError real (cuerpo como texto JSON) ⇒ misma clase', async () => {
    const body = JSON.stringify({ error: { code: 403, message: `site ${SITE}`, status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } });
    const err = new gaxios.GaxiosError(`Request failed ${SITE}`, { url: `https://searchconsole.googleapis.com/${SITE}` }, {
      status: 403, statusText: 'Forbidden', data: body, headers: {}, config: {}, request: { responseURL: 'https://x' },
    });
    const line = await logLineFor(err);
    expect(line).toBe('marketing: lectura externa fallida (sc) http=403 reason=PERMISSION_DENIED detalle=SERVICE_DISABLED');
    noLeak(line);
  });
});

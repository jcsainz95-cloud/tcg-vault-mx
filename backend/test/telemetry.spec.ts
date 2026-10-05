/**
 * LIVE-7 (API_CONTRACT §14.7, v1.84) — `POST /telemetry/csp` y `POST /telemetry/client-error`, a nivel unidad.
 * Las filas que necesitan el pipeline HTTP real (413 del parser, 429 del throttler, conteo de tablas) viven en
 * `test/integration/telemetry.e2e-spec.ts`.
 *
 *  - TLM-1: informe CSP con `documentURI …/reset-password?token=abc` ⇒ el log NO contiene `abc`
 *    (mutación: registrar la URI completa).
 *  - TLM-4: `client-error` con `message` de 301 ⇒ inválido (mutación: quitar el `MaxLength`).
 *  - Lo que el log NO lleva: `sample`/`script-sample`, IP, UA, ruta del recurso bloqueado.
 */
import 'reflect-metadata';
import { Logger, ValidationPipe, BadRequestException } from '@nestjs/common';
import { TelemetryController } from '../src/modules/health/telemetry.controller';
import { ClientErrorReportDto } from '../src/modules/health/dto/client-error-report.dto';
import { summarizeCspReports, pathWithoutQuery } from '../src/modules/health/telemetry-report';

const SECRET = 'abcSECRETtoken123';

const legacyReport = {
  'csp-report': {
    'document-uri': `https://tcghunt.mx/es/reset-password?token=${SECRET}#frag`,
    'blocked-uri': 'https://evil.example.com/x.js?k=leak',
    'effective-directive': 'script-src-elem',
    'violated-directive': 'script-src-elem',
    'original-policy': "default-src 'self'",
    disposition: 'report',
    'script-sample': 'alert(1)',
    referrer: 'https://tcghunt.mx/es/verify-email?token=zzz',
    'status-code': 200,
  },
};

const reportingApi = [
  {
    type: 'csp-violation',
    age: 10,
    url: `https://tcghunt.mx/es/verify-email?token=${SECRET}`,
    user_agent: 'Mozilla/5.0 UA-LEAK',
    body: {
      documentURL: `https://tcghunt.mx/es/verify-email?token=${SECRET}`,
      blockedURL: 'inline',
      effectiveDirective: 'style-src-attr',
      disposition: 'enforce',
      sample: 'color:red',
    },
  },
  { type: 'deprecation', body: { id: 'x' } },
];

function captureLogs() {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const all = () => [...warn.mock.calls, ...error.mock.calls].map((c) => c.map(String).join(' ')).join('\n');
  return { warn, error, all };
}

afterEach(() => jest.restoreAllMocks());

describe('LIVE-7 · TLM-1 — el log CSP no lleva query, fragmento, sample, IP ni UA', () => {
  it('application/csp-report (forma legada) como texto crudo', () => {
    const logs = captureLogs();
    new TelemetryController().csp(JSON.stringify(legacyReport));
    expect(logs.warn).toHaveBeenCalledTimes(1);
    const line = logs.all();
    expect(line).toMatch(/^CSP_VIOLATION /);
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('token');
    expect(line).not.toContain('frag');
    expect(line).not.toContain('alert(1)');
    expect(line).not.toContain('leak');
    expect(line).not.toContain('/x.js');
    expect(line).toContain('/es/reset-password');
    expect(line).toContain('https://evil.example.com');
    expect(line).toContain('script-src-elem');
    expect(line).toContain('report');
  });

  it('application/reports+json (lista): solo las entradas csp-violation; sin UA ni sample', () => {
    const logs = captureLogs();
    new TelemetryController().csp(JSON.stringify(reportingApi));
    expect(logs.warn).toHaveBeenCalledTimes(1);
    const line = logs.all();
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('UA-LEAK');
    expect(line).not.toContain('color:red');
    expect(line).toContain('/es/verify-email');
    expect(line).toContain('style-src-attr');
    expect(line).toContain('inline');
    expect(line).toContain('enforce');
  });

  it('cuerpo ya parseado como objeto (p. ej. llegó como application/json) se trata igual', () => {
    const logs = captureLogs();
    new TelemetryController().csp(legacyReport);
    expect(logs.all()).not.toContain(SECRET);
    expect(logs.warn).toHaveBeenCalledTimes(1);
  });

  it('cuerpo ininteligible ⇒ no lanza y no registra (siempre 204)', () => {
    const logs = captureLogs();
    const c = new TelemetryController();
    for (const body of ['', 'no-json{', '42', 'null', '{"x":1}', undefined, null, [1, 2]]) {
      expect(() => c.csp(body as unknown)).not.toThrow();
    }
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it('una lista enorme no produce más de 20 líneas', () => {
    const logs = captureLogs();
    new TelemetryController().csp(JSON.stringify(Array.from({ length: 200 }, () => reportingApi[0])));
    expect(logs.warn.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('valores de directiva/disposición fuera de forma se omiten (no se registran crudos)', () => {
    const [line] = summarizeCspReports({
      'csp-report': { 'effective-directive': 'script-src<inject>\nx', disposition: 'whatever', 'document-uri': 'not a url' },
    });
    expect(line ?? {}).toEqual({});
  });
});

describe('LIVE-7 · client-error', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false });
  const validate = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: ClientErrorReportDto, data: undefined });

  it('TLM-4: message de 301 ⇒ 400 (BadRequest ⇒ VALIDATION_ERROR en el filtro)', async () => {
    await expect(validate({ message: 'x'.repeat(301), path: '/es' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ message: 'x'.repeat(300), path: '/es' })).resolves.toBeDefined();
  });

  it('topes de digest (64), path (200), release (40) y obligatorios', async () => {
    await expect(validate({ message: 'm', path: '/es', digest: 'd'.repeat(65) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ message: 'm', path: 'p'.repeat(201) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ message: 'm', path: '/es', release: 'r'.repeat(41) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ path: '/es' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ message: 'm' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ message: 'm', path: 7 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate({ message: 'm', path: '/es', digest: 'd'.repeat(64), release: 'r'.repeat(40) }),
    ).resolves.toBeDefined();
  });

  it('una línea CLIENT_ERROR, path sin query ni fragmento, sin campos ajenos', async () => {
    const logs = captureLogs();
    const dto = (await validate({
      message: 'TypeError: boom\nat x',
      digest: '12345',
      path: `/es/reset-password?token=${SECRET}#h`,
      release: 'abc123',
      ip: '1.2.3.4',
      userAgent: 'UA-LEAK',
    })) as ClientErrorReportDto;
    new TelemetryController().clientError(dto);
    expect(logs.error).toHaveBeenCalledTimes(1);
    const line = logs.all();
    expect(line).toMatch(/^CLIENT_ERROR /);
    expect(line.split('\n')).toHaveLength(1);
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('1.2.3.4');
    expect(line).not.toContain('UA-LEAK');
    expect(line).toContain('/es/reset-password');
    expect(line).toContain('TypeError: boom');
    expect(line).toContain('12345');
    expect(line).toContain('abc123');
  });

  it('pathWithoutQuery: relativo, absoluto, sin nada', () => {
    expect(pathWithoutQuery('/es/a?b=1#c')).toBe('/es/a');
    expect(pathWithoutQuery('https://tcghunt.mx/es/a?b=1')).toBe('/es/a');
    expect(pathWithoutQuery('#x')).toBe('');
  });
});

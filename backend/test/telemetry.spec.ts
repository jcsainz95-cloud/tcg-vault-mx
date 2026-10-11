/**
 * LIVE-7 (API_CONTRACT §14.7, v1.84) — `POST /telemetry/csp` y `POST /telemetry/client-error`, a nivel unidad.
 * Las filas que necesitan el pipeline HTTP real (413 del parser, 429 del throttler, conteo de tablas) viven en
 * `test/integration/telemetry.e2e-spec.ts`.
 *
 *  - TLM-1: informe CSP con `documentURI …/reset-password?token=abc` ⇒ el log NO contiene `abc`
 *    (mutación: registrar la URI completa).
 *  - TLM-4: `client-error` con `message` de 301 ⇒ inválido (mutación: quitar el `MaxLength`).
 *  - Lo que el log NO lleva: `sample`/`script-sample`, IP, UA, ruta del recurso bloqueado.
 *  - v1.84.2 (§14.15 E2-3): `scrubClientText` limpia `message` antes del log.
 *    TLM-6: ruta RELATIVA con `?token=` ⇒ el valor no llega al log (mutación: quitar la limpieza del servidor).
 *    TLM-7: query/fragmento de URL absoluta, `token=` suelto y JWT ⇒ fuera; `error #418` intacto
 *           (mutación: limpiar solo URL absolutas, la regla del cliente).
 *    TLM-8: `message` con `\n` ⇒ una sola línea (mutación: escribir `message` sin escapar).
 */
import 'reflect-metadata';
import { Logger, ValidationPipe, BadRequestException } from '@nestjs/common';
import { TelemetryController } from '../src/modules/health/telemetry.controller';
import { ClientErrorReportDto } from '../src/modules/health/dto/client-error-report.dto';
import { summarizeCspReports, pathWithoutQuery, scrubClientText } from '../src/modules/health/telemetry-report';

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

/*
 * v1.84.2 · API_CONTRACT §14.15 E2-3 — limpieza de `message` en el servidor.
 * ⚠️ Valores de prueba OBVIAMENTE falsos (los del contrato: `abc123`, `s3cr3t`, `t0k3n`). El JWT se arma en tiempo de
 * ejecución (`alg:none`, sin firma real) para que ningún literal con forma de token quede escrito en el repo.
 */
const b64url = (v: string) => Buffer.from(v).toString('base64url');
const FAKE_JWT = [
  b64url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
  b64url(JSON.stringify({ sub: 'fake-test-only' })),
  b64url('not-a-signature'),
].join('.');

function clientErrorLine(message: string, path = '/es/x'): string {
  const logs = captureLogs();
  const dto = Object.assign(new ClientErrorReportDto(), { message, path });
  new TelemetryController().clientError(dto);
  expect(logs.error).toHaveBeenCalledTimes(1);
  return String(logs.error.mock.calls[0][0]);
}

describe('v1.84.2 · E2-3 — scrubClientText en client-error (TLM-6/7/8)', () => {
  it('TLM-6: ruta relativa con ?token= ⇒ el log no lleva el valor y sí la ruta', () => {
    const line = clientErrorLine('Fallo en /es/reset-password?token=abc123 al cargar');
    expect(line).toMatch(/^CLIENT_ERROR /);
    expect(line).not.toContain('abc123');
    expect(line).not.toContain('token');
    expect(line).toContain('/es/reset-password');
    expect(line).toContain('al cargar');
  });

  it('TLM-7: query+fragmento de URL absoluta, token= suelto y JWT fuera; «error #418» intacto', () => {
    const msg = `Falló https://x.test/a?b=1#access_token=s3cr3t y token=t0k3n con ${FAKE_JWT} · Minified React error #418`;
    expect(msg.length).toBeLessThanOrEqual(300);
    const line = clientErrorLine(msg);
    expect(line).not.toContain('s3cr3t');
    expect(line).not.toContain('t0k3n');
    expect(line).not.toContain(FAKE_JWT);
    for (const seg of FAKE_JWT.split('.')) expect(line).not.toContain(seg);
    expect(line).toContain('https://x.test/a');
    expect(line).toContain('[jwt]');
    expect(line).toContain('Minified React error #418');
  });

  it('TLM-7 (sola): «Minified React error #418» llega byte a byte', () => {
    const line = clientErrorLine('Minified React error #418; visit https://react.dev/errors/418?args[]=x');
    expect(JSON.parse(line.replace(/^CLIENT_ERROR /, '')).message).toBe(
      'Minified React error #418; visit https://react.dev/errors/418',
    );
  });

  it('TLM-8: message con \\n ⇒ exactamente una línea de log', () => {
    const line = clientErrorLine('TypeError: boom\nat /es/reset-password?token=abc123\r\nfin');
    expect(line.split(/\r?\n|\r/)).toHaveLength(1);
    expect(line).not.toContain('abc123');
    expect(JSON.parse(line.replace(/^CLIENT_ERROR /, '')).message).toBe('TypeError: boom\nat /es/reset-password\r\nfin');
  });

  it('path pierde query y fragmento (relativo y absoluto)', () => {
    const line = clientErrorLine('m', '/es/reset-password#access_token=s3cr3t');
    expect(line).not.toContain('s3cr3t');
    expect(JSON.parse(line.replace(/^CLIENT_ERROR /, '')).path).toBe('/es/reset-password');
    expect(pathWithoutQuery('https://x.test/a#access_token=s3cr3t')).toBe('/a');
  });
});

describe('v1.84.2 · E2-3 — scrubClientText, regla a regla', () => {
  it.each([
    // Regla 1: `?`/`#` pegados a algo ⇒ fuera hasta el espacio. `#` con espacio delante se respeta.
    ['/es/a?b=1 x', '/es/a x'],
    ['ver https://x.test/p#frag y', 'ver https://x.test/p y'],
    ['error #418', 'error #418'],
    ['¿qué? pasó', '¿qué pasó'],
    // Regla 2: nombre=valor de secreto (sin mayúsculas, también como sufijo) ⇒ [redacted].
    ['token=t0k3n fin', 'token=[redacted] fin'],
    ['access_token=x refresh_token=y id_token=z', 'access_token=[redacted] refresh_token=[redacted] id_token=[redacted]'],
    ['code=fake-code secret=fake password=fake key=fake signature=fake sig=fake',
      'code=[redacted] secret=[redacted] password=[redacted] key=[redacted] signature=[redacted] sig=[redacted]'],
    ['PaSsWoRd=fake ToKeN=fake', 'PaSsWoRd=[redacted] ToKeN=[redacted]'],
    ['X-Amz-Signature=fakesig client_secret=fake apikey=fake', 'X-Amz-Signature=[redacted] client_secret=[redacted] apikey=[redacted]'],
    ['author=bob tokens=3 token: abc', 'author=bob tokens=3 token: abc'],
    // Regla 3: JWT ⇒ [jwt].
    [`Bearer ${FAKE_JWT} fin`, 'Bearer [jwt] fin'],
    // Orden 1 → 2 → 3.
    [`/x?token=${FAKE_JWT} fin`, '/x fin'],
    [`token=${FAKE_JWT}`, 'token=[redacted]'],
    // Vacío ⇒ «Error».
    ['', 'Error'],
  ])('%j ⇒ %j', (input, expected) => {
    expect(scrubClientText(input)).toBe(expected);
  });

  it('el resultado nunca pasa de 300 (tope del DTO), aunque [redacted] sea más largo que el valor', () => {
    const adversarial = 'sig=a '.repeat(50);
    expect(adversarial.length).toBe(300);
    const out = scrubClientText(adversarial);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out).not.toMatch(/sig=a\b/);
  });

  it('no lanza con entradas raras', () => {
    for (const s of ['?', '#', '=', 'token=', '?token=x', 'eyJ', 'eyJ..', 'a'.repeat(300)]) {
      expect(() => scrubClientText(s)).not.toThrow();
    }
  });
});

/**
 * ⭐💰🔒 PS-99 — NINGUNA prueba ni ningún CI puede comprar una guía real (API_CONTRACT §M4-SHIP.19.19.17).
 *
 * Cuatro capas, cada una con su prueba y su canario (la mutación que la pone roja está escrita al lado):
 *  (a) el adaptador REAL no sale en pruebas — quitar `assertMutationAllowed` de `mutate()` ⇒ el grabador registra
 *      `POST /api/v2/shipments` ⇒ rojo;
 *  (b) `evaluateMutationGate` con su tabla completa — hacer que ignore `CI` ⇒ rojo en la fila `ci`;
 *  (c) la red a `*.skydropx.com` vetada en TODA suite — quitar el fichero de `setupFiles` ⇒ el `fetch` sale (o falla
 *      con OTRA clase de error) ⇒ rojo;
 *  (d) estático `C-SDX-8` — una llave en un workflow, una ruta mutante fuera del cliente o una segunda lectura de
 *      `SKYDROPX_ALLOW_SPEND` ⇒ rojo.
 * Por qué cuatro y no una (§19.19.17): (a) protege del código que olvida la puerta; (b) de una puerta mal escrita;
 * (c) de un `fetch` que nadie previó; (d) de que alguien le dé al CI las llaves.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import * as https from 'https';
import { join, relative, sep } from 'path';
import { SkydropxClient } from '../src/modules/shipping-provider/http/skydropx-client';
import { SkydropxAdapter } from '../src/modules/shipping-provider/skydropx.adapter';
import { SkydropxMutationForbiddenError } from '../src/modules/shipping-provider/shipping-provider.errors';
import { evaluateMutationGate, MutationGateInput } from '../src/modules/shipping-provider/spend-gate';
import { completedQuotationFixture, pendingQuotationFixture } from '../src/modules/shipping-provider/fixtures/skydropx-quotation.fixture';
import { anclasEstructurales, codigoDeFichero, codigoDeTexto } from './helpers/codigo-de-fichero';
import {
  CapturedLogger,
  FAKE_CLIENT_ID,
  FAKE_SECRET,
  FakeClock,
  jsonResponse,
  RECORDER_ORIGIN,
  RecorderTransport,
} from './helpers/skydropx-recorder';
// ⛔ De `forbidden-network` (sin efectos), NUNCA de `forbid-skydropx-network`: importar éste instalaría el veto
// desde la propia prueba y el canario no vería que alguien lo quitó de `setupFiles`.
import { ForbiddenTestNetworkError, isForbiddenHost } from './setup/forbidden-network';

const BACKEND = join(__dirname, '..');
const REPO = join(BACKEND, '..');
const SRC = join(BACKEND, 'src');

const MUTATING_ROUTE = /\/api\/v2\/shipments|\/cancellations\b|\/protect\b/;

function realAdapter() {
  const clock = new FakeClock();
  const rec = new RecorderTransport(clock);
  const logger = new CapturedLogger();
  rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, completedQuotationFixture()));
  rec.on('POST', /^\/api\/v2\/shipments/, () => jsonResponse(201, { data: { id: 'should-never-happen' } }));
  rec.on('POST', /\/cancellations$/, () => jsonResponse(200, {}));
  rec.on('POST', /\/protect$/, () => jsonResponse(200, {}));
  const client = new SkydropxClient({
    baseUrl: `${RECORDER_ORIGIN}/api/v1`,
    clientId: FAKE_CLIENT_ID,
    clientSecret: FAKE_SECRET,
    transport: rec.transport,
    clock,
    logger,
  });
  return { rec, adapter: new SkydropxAdapter({ client, clock, logger }) };
}

const PURCHASE_INPUT = {
  rateId: 'fixture-rate-05',
  printingFormat: 'standard' as const,
  from: { templateId: 'tpl', snapshot: null },
  to: { street1: 'Calle 1', name: 'Ana', company: 'Ana', phone: '5512345678', email: 'a@example.com' },
  package: { coverageCents: 250000, consignmentNote: '49101600', packageType: '5H4' },
  idempotencyKey: 'label:s1:r1',
};

describe('PS-99 (a) — el adaptador REAL no hace ninguna llamada mutante bajo jest', () => {
  it('JEST_WORKER_ID está puesto (premisa de la capa)', () => {
    expect(process.env.JEST_WORKER_ID).toBeTruthy();
  });

  it('purchase / cancel / protect lanzan SkydropxMutationForbiddenError(test_runtime) y el grabador registra CERO rutas mutantes', async () => {
    const { rec, adapter } = realAdapter();
    await expect(adapter.purchase(PURCHASE_INPUT)).rejects.toMatchObject({
      name: 'SkydropxMutationForbiddenError',
      reason: 'test_runtime',
      httpStatus: 409,
      details: { missing: ['allow_spend'] },
    });
    await expect(adapter.cancel('sh-1', 'reissue')).rejects.toBeInstanceOf(SkydropxMutationForbiddenError);
    await expect(adapter.protect('sh-1', 250000)).rejects.toBeInstanceOf(SkydropxMutationForbiddenError);
    expect(rec.calls.filter((c) => MUTATING_ROUTE.test(c.path))).toHaveLength(0);
    expect(rec.calls).toHaveLength(0);
  });

  it('SÍ admite POST /oauth/token y POST /quotations (no gastan: PROD §0)', async () => {
    const { rec, adapter } = realAdapter();
    rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, pendingQuotationFixture()));
    rec.on('GET', /^\/api\/v1\/quotations\//, () => jsonResponse(200, completedQuotationFixture()));
    const q = await adapter.quote({
      from: { templateId: 'tpl' },
      to: { countryCode: 'MX', postalCode: '06600', state: 'CDMX', city: 'Cuauhtémoc', neighborhood: 'Juárez' },
      parcel: { lengthCm: 25, widthCm: 18, heightCm: 3, weightKg: 1, coverageCents: 250000 },
    });
    expect(q.completed).toBe(true);
    expect(rec.callsTo('POST', '/api/v1/oauth/token')).toHaveLength(1);
    expect(rec.callsTo('POST', '/api/v1/quotations')).toHaveLength(1);
    expect(rec.calls.filter((c) => MUTATING_ROUTE.test(c.path))).toHaveLength(0);
  });
});

describe('PS-99 (b) — evaluateMutationGate: la tabla completa', () => {
  const OPEN: MutationGateInput = { nodeEnv: 'production', ci: '', jestWorkerId: '', allowSpend: 'true' };
  const rows: [string, Partial<MutationGateInput>, ReturnType<typeof evaluateMutationGate>][] = [
    ['la ÚNICA combinación abierta', {}, 'allowed'],
    ['CI=true (GitHub Actions lo pone en todo job)', { ci: 'true' }, { forbidden: 'ci' }],
    ['CI=1', { ci: '1' }, { forbidden: 'ci' }],
    ['CI=false también niega (falla cerrado)', { ci: 'false' }, { forbidden: 'ci' }],
    ['NODE_ENV=test', { nodeEnv: 'test' }, { forbidden: 'test_runtime' }],
    ['JEST_WORKER_ID puesto', { jestWorkerId: '3' }, { forbidden: 'test_runtime' }],
    ['allowSpend ausente', { allowSpend: undefined }, { forbidden: 'not_enabled' }],
    ['allowSpend = "TRUE" (no es "true")', { allowSpend: 'TRUE' }, { forbidden: 'not_enabled' }],
    ['allowSpend = "1"', { allowSpend: '1' }, { forbidden: 'not_enabled' }],
    ['NODE_ENV=development', { nodeEnv: 'development' }, { forbidden: 'not_enabled' }],
    ['NODE_ENV=staging', { nodeEnv: 'staging' }, { forbidden: 'not_enabled' }],
    ['NODE_ENV ausente', { nodeEnv: undefined }, { forbidden: 'not_enabled' }],
    ['CI + JEST ⇒ manda test_runtime', { ci: 'true', jestWorkerId: '1' }, { forbidden: 'test_runtime' }],
    ['producción con CI y llave girada (.env de prod pegado en CI)', { ci: 'true', allowSpend: 'true' }, { forbidden: 'ci' }],
  ];
  it.each(rows)('%s', (_label, patch, expected) => {
    expect(evaluateMutationGate({ ...OPEN, ...patch })).toEqual(expected);
  });
});

describe('PS-99 (c) — la red a *.skydropx.com está vetada en toda suite', () => {
  it('canario: fetch a la API de producción ⇒ ForbiddenTestNetworkError (antes de abrir conexión)', async () => {
    await expect(fetch('https://pro.skydropx.com/api/v1/finance/credits')).rejects.toBeInstanceOf(
      ForbiddenTestNetworkError,
    );
  });

  it('cualquier subdominio y con URL objeto', async () => {
    await expect(fetch(new URL('https://sb-pro.skydropx.com/oauth/token'))).rejects.toBeInstanceOf(
      ForbiddenTestNetworkError,
    );
    await expect(fetch('https://labels.SKYDROPX.com./x.pdf')).rejects.toBeInstanceOf(ForbiddenTestNetworkError);
  });

  it('https.request directo ⇒ ForbiddenTestNetworkError (un helper que nadie previó)', () => {
    expect(() => https.request('https://pro.skydropx.com/api/v1/shipments')).toThrow(ForbiddenTestNetworkError);
    expect(() => https.get({ hostname: 'pro.skydropx.com', path: '/' })).toThrow(ForbiddenTestNetworkError);
  });

  it('el despachador de undici (paquete) también', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const undici = require('undici') as { request: (url: string) => Promise<unknown> };
    await expect(undici.request('https://pro.skydropx.com/api/v1/finance/credits')).rejects.toBeInstanceOf(
      ForbiddenTestNetworkError,
    );
  });

  it('un host que NO es Skydropx no se toca (el veto no es un apagón de red ni una búsqueda de subcadena)', async () => {
    expect(isForbiddenHost('notskydropx.com')).toBe(false);
    expect(isForbiddenHost('skydropx.com.evil.example')).toBe(false);
    expect(isForbiddenHost('pro.skydropx.com')).toBe(true);
    await expect(fetch('http://127.0.0.1:1/')).rejects.not.toBeInstanceOf(ForbiddenTestNetworkError);
  });

  it('los DOS jest.config cargan el veto en setupFiles (código, no comentario)', () => {
    const entry = "setupFiles: ['<rootDir>/test/setup/forbid-skydropx-network.ts']";
    for (const cfg of [join(BACKEND, 'jest.config.js'), join(BACKEND, 'test/jest-integration.config.js')]) {
      expect(codigoDeFichero(cfg, ['module.exports'])).toContain(entry);
    }
  });
});

// ── (d) estático, C-SDX-8 ───────────────────────────────────────────────────────────────────────────────────────

function walk(dir: string, filter: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

const srcFiles = () => walk(SRC, (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'));
const rel = (p: string) => relative(BACKEND, p).split(sep).join('/');

/** Índices [inicio, fin) del cuerpo de la función/método cuyo encabezado es `header` en el código limpio. */
function functionSpan(code: string, header: RegExp): [number, number] {
  const m = header.exec(code);
  if (!m) throw new Error(`no encontré ${header}`);
  const open = code.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return [m.index, i + 1];
    }
  }
  throw new Error('llaves desbalanceadas');
}

describe('PS-99 (d) — estático C-SDX-8', () => {
  it('ningún workflow de .github/ nombra SKYDROPX_CLIENT_ID | CLIENT_SECRET | ALLOW_SPEND', () => {
    const files = walk(join(REPO, '.github'), () => true);
    expect(files.length).toBeGreaterThan(0); // no-vacuidad: el árbol trae .github (O-9: copia del árbol ENTERO)
    const hits = files.filter((f) => /SKYDROPX_(CLIENT_ID|CLIENT_SECRET|ALLOW_SPEND)/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('las rutas mutantes aparecen en backend/src SOLO en skydropx-client.ts, dentro de mutate() junto a assertMutationAllowed', () => {
    const clientPath = join(SRC, 'modules/shipping-provider/http/skydropx-client.ts');
    const offenders: string[] = [];
    for (const f of srcFiles()) {
      if (f === clientPath) continue;
      const raw = readFileSync(f, 'utf8');
      const code = codigoDeTexto(raw, rel(f), anclasEstructurales(raw, rel(f)));
      if (MUTATING_ROUTE.test(code)) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);

    const code = codigoDeFichero(clientPath, ['async mutate(', 'assertMutationAllowed(op)']);
    const [start, end] = functionSpan(code, /async mutate\(/);
    const body = code.slice(start, end);
    expect(body).toContain('assertMutationAllowed(');
    const re = new RegExp(MUTATING_ROUTE.source, 'g');
    const positions = [...code.matchAll(re)].map((m) => m.index ?? -1);
    expect(positions.length).toBeGreaterThanOrEqual(3);
    for (const pos of positions) {
      expect(pos >= start && pos < end).toBe(true);
    }
    // Cada POST del cliente es token, cotización o la función de la puerta (lista CERRADA, §19.19.3 (6)).
    const posts = [...code.matchAll(/method: 'POST'/g)].map((m) => m.index ?? -1);
    const allowedSpans = [
      functionSpan(code, /private async requestToken\(/),
      functionSpan(code, /async createQuotation\(/),
      [start, end] as [number, number],
    ];
    for (const pos of posts) {
      expect(allowedSpans.some(([a, b]) => pos >= a && pos < b)).toBe(true);
    }
  });

  it('SKYDROPX_ALLOW_SPEND se lee SOLO en spend-gate.ts', () => {
    const readers = srcFiles()
      .filter((f) => readFileSync(f, 'utf8').includes('SKYDROPX_ALLOW_SPEND'))
      .filter((f) => {
        const raw = readFileSync(f, 'utf8');
        return codigoDeTexto(raw, rel(f), anclasEstructurales(raw, rel(f))).includes('SKYDROPX_ALLOW_SPEND');
      })
      .map(rel);
    expect(readers).toEqual(['src/modules/shipping-provider/spend-gate.ts']);
  });

  // ⭐ v1.80.12.3 (§M4-SHIP.19.23.5) — sustituye la aserción transitoria «nunca con valor», que era VERDE con la línea
  // BORRADA (el `for` recorría cero líneas). (d4) y (d5) son funciones puras sobre el texto, con sus canarios
  // sintéticos aquí mismo (que la regla muerde) y la aserción sobre los ficheros reales del árbol.
  describe('(d4) .env.example: cada llave presente UNA vez y vacía', () => {
    const KEYS = ['SKYDROPX_ALLOW_SPEND', 'SKYDROPX_CLIENT_ID', 'SKYDROPX_CLIENT_SECRET'] as const;
    /** `null` ⇔ la llave aparece exactamente una vez, con valor `''` tras quitar comentario y espacios. */
    const envKeyProblem = (text: string, key: string): string | null => {
      const re = new RegExp(`^\\s*${key}\\s*=`);
      const lines = text.split('\n').filter((l) => re.test(l));
      if (lines.length !== 1) return `${key}: ${lines.length} líneas (se exige 1)`;
      const value = lines[0].replace(re, '').replace(/#.*$/, '').trim();
      return value === '' ? null : `${key}: con valor`;
    };

    it('canarios: borrada ⇒ problema; con valor ⇒ problema; dos líneas ⇒ problema; comentada no cuenta; vacía con comentario ⇒ bien', () => {
      const ok = 'A=1\nSKYDROPX_ALLOW_SPEND=   # solo prod\nB=\n';
      expect(envKeyProblem(ok, 'SKYDROPX_ALLOW_SPEND')).toBeNull();
      expect(envKeyProblem('A=1\nB=\n', 'SKYDROPX_ALLOW_SPEND')).toMatch(/0 líneas/);
      expect(envKeyProblem('# SKYDROPX_ALLOW_SPEND=\n', 'SKYDROPX_ALLOW_SPEND')).toMatch(/0 líneas/);
      expect(envKeyProblem('SKYDROPX_ALLOW_SPEND=true\n', 'SKYDROPX_ALLOW_SPEND')).toMatch(/con valor/);
      expect(envKeyProblem(' SKYDROPX_ALLOW_SPEND = x # c\n', 'SKYDROPX_ALLOW_SPEND')).toMatch(/con valor/);
      expect(envKeyProblem('SKYDROPX_ALLOW_SPEND=\nSKYDROPX_ALLOW_SPEND=\n', 'SKYDROPX_ALLOW_SPEND')).toMatch(/2 líneas/);
      expect(envKeyProblem('SKYDROPX_CLIENT_SECRET=abc123\n', 'SKYDROPX_CLIENT_SECRET')).toMatch(/con valor/);
      // `SKYDROPX_CLIENT_ID_X=` no es `SKYDROPX_CLIENT_ID=`
      expect(envKeyProblem('SKYDROPX_CLIENT_ID_X=\n', 'SKYDROPX_CLIENT_ID')).toMatch(/0 líneas/);
    });

    it('el .env.example del árbol: las tres llaves, una vez cada una y vacías', () => {
      const p = join(REPO, '.env.example');
      expect(existsSync(p)).toBe(true);
      const text = readFileSync(p, 'utf8');
      expect(KEYS.map((k) => envKeyProblem(text, k)).filter((x) => x !== null)).toEqual([]);
    });
  });

  describe('(d5) la sonda de producción y su prueba existen, y CI las corre', () => {
    const PROBE = join(REPO, 'scripts/skydropx/prod-probe.ts');
    const PROBE_TEST = join(REPO, 'scripts/skydropx/prod-probe.test.ts');
    const WORKFLOWS = join(REPO, '.github/workflows');
    /** Un workflow invoca `run-prod-probe.sh test` en una línea NO comentada (un paso comentado no corre). */
    const invokesProbeTest = (yaml: string): boolean =>
      yaml.split('\n').some((l) => !/^\s*#/.test(l) && /run-prod-probe\.sh\s+test\b/.test(l));

    it('canarios: paso presente ⇒ sí; quitado, comentado o con otro subcomando ⇒ no', () => {
      expect(invokesProbeTest('      - name: x\n        run: ../scripts/skydropx/run-prod-probe.sh test\n')).toBe(true);
      expect(invokesProbeTest('      - name: x\n        run: npm test\n')).toBe(false);
      expect(invokesProbeTest('      # run: ../scripts/skydropx/run-prod-probe.sh test\n')).toBe(false);
      expect(invokesProbeTest('        run: ../scripts/skydropx/run-prod-probe.sh probe\n')).toBe(false);
    });

    it('existen prod-probe.ts y prod-probe.test.ts, y algún workflow de .github/workflows invoca `run-prod-probe.sh test`', () => {
      expect({ probe: existsSync(PROBE), test: existsSync(PROBE_TEST) }).toEqual({ probe: true, test: true });
      const files = walk(WORKFLOWS, (f) => /\.ya?ml$/.test(f));
      expect(files.length).toBeGreaterThan(0); // no-vacuidad (O-9: copia del árbol ENTERO)
      const callers = files.filter((f) => invokesProbeTest(readFileSync(f, 'utf8'))).map((f) => relative(REPO, f).split(sep).join('/'));
      expect(callers.length).toBeGreaterThan(0);
    });
  });
});

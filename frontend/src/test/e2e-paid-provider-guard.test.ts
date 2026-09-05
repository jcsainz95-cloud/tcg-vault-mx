import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GRADING_HOOK_DIAL_KEY,
  PROVIDER_KEY_VAR,
  PROVIDER_PROBE_VAR,
  REMOTE_ATTESTATION_VAR,
  assessGradingWriteCapability,
  assertGradingWriteIncapacitated,
  incapacitationFailureMessage,
  collectBackendEnvSources,
  enableGradingHookGuarded,
  findRepoRoot,
  isLiveProviderKey,
  isLocalApiTarget,
  isProbeRequested,
  parseDotEnv,
  restoreDialValue,
  type EnvSource,
} from '../../e2e/utils/paid-provider-guard';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * EL ARNÉS E2E NO PUEDE GASTAR CRÉDITOS DE UN PROVEEDOR DE PAGA (ARCHITECTURE §4.38r.6.1)
 *
 * **Qué se está probando y por qué aquí.** Desde el colapso a un solo dial (M-46), el `PUT` que el
 * arnés hace en CADA corrida —`{ gradingHookEnabled: 'on' }`— dejó de encender solo la exhibición:
 * enciende también la **obtención** desde un proveedor de paga. La protección que existía hoy vivía
 * en el proveedor del backend (sale con `warn` si no hay llave) y dependía de que la llave estuviera
 * **ausente**; en CI lo está por accidente (`docker-compose.yml` la interpola desde el `.env` del
 * desarrollador, **sin default**), no por diseño.
 *
 * Estos tests verifican la incapacitación **explícita**: que el arnés compruebe la precondición y se
 * NIEGUE a encender el dial cuando el entorno puede escribir automático. El caso que manda es el
 * último de este bloque: *un desarrollador con llave real corre la suite y el `PUT` no ocurre*.
 *
 * Corren en vitest (y no solo en Playwright) a propósito: el gate unitario es el único que se ejecuta
 * en cada cambio, y un guardarraíl de dinero verificado solo por la suite que él mismo protege es un
 * guardarraíl que nadie mira.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

const LOCAL_API = 'http://localhost:3099/api/v1';
const REMOTE_API = 'https://staging.tcghunt.mx/api/v1';

function sources(values: Record<string, string | undefined>, origin = 'process.env'): EnvSource[] {
  return [{ origin, values }];
}

describe('e2e · incapacitación del entorno frente al proveedor DE PAGA (§4.38r.6.1)', () => {
  it('con una llave VIVA y la sonda apagada, el entorno NO está incapacitado', () => {
    const verdict = assessGradingWriteCapability({
      apiBaseUrl: LOCAL_API,
      sources: sources({ [PROVIDER_KEY_VAR]: 'ppt_live_abc123' }, '.env'),
    });
    expect(verdict.incapacitated).toBe(false);
    expect(verdict.mechanism).toBe('none');
    expect(verdict.liveKeySources).toEqual(['.env']);
  });

  it('SIN llave, el entorno está incapacitado por la vía preferida (cero peticiones)', () => {
    const verdict = assessGradingWriteCapability({
      apiBaseUrl: LOCAL_API,
      sources: sources({ [PROVIDER_KEY_VAR]: '' }),
    });
    expect(verdict.incapacitated).toBe(true);
    expect(verdict.mechanism).toBe('no-key');
  });

  it('con llave viva PERO la sonda encendida, está incapacitado (observa y no escribe)', () => {
    const verdict = assessGradingWriteCapability({
      apiBaseUrl: LOCAL_API,
      sources: sources({ [PROVIDER_KEY_VAR]: 'ppt_live_abc123', [PROVIDER_PROBE_VAR]: 'on' }),
    });
    expect(verdict.incapacitated).toBe(true);
    expect(verdict.mechanism).toBe('probe');
  });

  it('la llave de una fuente CUALQUIERA cuenta: basta con backend/.env aunque process.env esté limpio', () => {
    const verdict = assessGradingWriteCapability({
      apiBaseUrl: LOCAL_API,
      sources: [
        { origin: 'process.env', values: {} },
        { origin: 'backend/.env', values: { [PROVIDER_KEY_VAR]: 'ppt_live_abc123' } },
      ],
    });
    expect(verdict.incapacitated).toBe(false);
    expect(verdict.liveKeySources).toEqual(['backend/.env']);
  });

  it('un placeholder de .env.example NO es una llave (el guardarraíl que siempre grita se desactiva)', () => {
    expect(isLiveProviderKey('CHANGE_ME')).toBe(false);
    expect(isLiveProviderKey('   ')).toBe(false);
    expect(isLiveProviderKey(undefined)).toBe(false);
    expect(isLiveProviderKey('ppt_live_abc123')).toBe(true);
    const verdict = assessGradingWriteCapability({
      apiBaseUrl: LOCAL_API,
      sources: sources({ [PROVIDER_KEY_VAR]: 'CHANGE_ME' }),
    });
    expect(verdict.incapacitated).toBe(true);
    expect(verdict.mechanism).toBe('no-key');
  });

  /**
   * La lectura de la sonda se replica del backend (`gradedProbeRequested`). Si el arnés fuera más
   * LAXO que el backend daría por incapacitado un entorno que sí escribe, y la divergencia se
   * pagaría en créditos en vez de en un rojo.
   */
  it('la sonda se lee EXACTAMENTE como la lee el backend (on|true|1|yes)', () => {
    for (const yes of ['on', 'ON', ' true ', '1', 'yes', 'YES']) {
      expect(isProbeRequested(yes), yes).toBe(true);
    }
    for (const no of ['off', 'false', '0', 'no', '', undefined, 'sí', 'enabled']) {
      expect(isProbeRequested(no), String(no)).toBe(false);
    }
  });
});

describe('e2e · API remota: sin constancia de devops no se enciende (§4.38r.6.1, reparto)', () => {
  const original = process.env[REMOTE_ATTESTATION_VAR];
  afterEach(() => {
    if (original === undefined) delete process.env[REMOTE_ATTESTATION_VAR];
    else process.env[REMOTE_ATTESTATION_VAR] = original;
  });

  it('contra staging SIN constancia, el entorno no se considera incapacitado', () => {
    delete process.env[REMOTE_ATTESTATION_VAR];
    const verdict = assessGradingWriteCapability({ apiBaseUrl: REMOTE_API, sources: sources({}) });
    expect(verdict.incapacitated).toBe(false);
    expect(verdict.detail).toMatch(new RegExp(REMOTE_ATTESTATION_VAR));
  });

  it('contra staging CON constancia de devops, se autoriza (y se declara el mecanismo)', () => {
    process.env[REMOTE_ATTESTATION_VAR] = '1';
    const verdict = assessGradingWriteCapability({ apiBaseUrl: REMOTE_API, sources: sources({}) });
    expect(verdict.incapacitated).toBe(true);
    expect(verdict.mechanism).toBe('devops-attestation');
  });

  /**
   * ⚠️ La pieza que impide cambiar un olvido por una promesa: contra un backend LOCAL con llave
   * viva, la constancia **no desbloquea nada**. Donde se puede observar, manda la observación.
   */
  it('la constancia NO gana sobre la observación local: con llave viva sigue negándose', () => {
    process.env[REMOTE_ATTESTATION_VAR] = '1';
    const verdict = assessGradingWriteCapability({
      apiBaseUrl: LOCAL_API,
      sources: sources({ [PROVIDER_KEY_VAR]: 'ppt_live_abc123' }),
    });
    expect(verdict.incapacitated).toBe(false);
  });

  it('reconoce como local solo lo que corre en esta máquina', () => {
    expect(isLocalApiTarget('http://localhost:3099/api/v1')).toBe(true);
    expect(isLocalApiTarget('http://127.0.0.1:3011/api/v1')).toBe(true);
    expect(isLocalApiTarget(REMOTE_API)).toBe(false);
    // Una URL que no parsea NO se declara local: ante la duda, la vía estricta.
    expect(isLocalApiTarget('no-es-una-url')).toBe(false);
  });
});

describe('e2e · el encendido del dial pasa SIEMPRE por la precondición', () => {
  /**
   * **El caso del enunciado, y el que de verdad importa:** un desarrollador con la llave real en su
   * `.env` corre la suite E2E. La comprobación tiene que ocurrir **antes** del `PUT`, no después:
   * un `PUT` que ya salió es un `PUT` que ya autorizó al cron de las próximas ≤12 h.
   */
  it('con llave viva NO llega a hacerse el PUT que enciende el gancho', async () => {
    const put = vi.fn().mockResolvedValue({});
    const devWithRealKey = sources({ [PROVIDER_KEY_VAR]: 'ppt_live_abc123' }, '.env');

    const outcome = await enableGradingHookGuarded(LOCAL_API, put, devWithRealKey).catch(
      (e: unknown) => e,
    );

    // El aserto PRIMARIO no es «lanzó»: es que **el gasto no se autorizó**. Se afirma primero para
    // que, si el guardarraíl deja de detectar, el rojo diga literalmente qué se rompió — y no un
    // «esperaba un error» que se puede leer como un problema del test.
    expect(
      put,
      'REGRESIÓN DE DINERO: el arnés ejecutó el PUT que enciende el gancho con una llave del ' +
        'proveedor DE PAGA viva en el entorno. Cada corrida de E2E gastaría créditos.',
    ).not.toHaveBeenCalled();
    expect(outcome).toBeInstanceOf(Error);
    expect(String(outcome)).toMatch(/SE NIEGA a encender el gancho de grading/);
  });

  it('incapacitado, el PUT ocurre y es EXACTAMENTE el del contrato v1.51', async () => {
    const put = vi.fn().mockResolvedValue({});
    await enableGradingHookGuarded(LOCAL_API, put, sources({}));
    expect(put).toHaveBeenCalledWith({ [GRADING_HOOK_DIAL_KEY]: 'on' });
    expect(GRADING_HOOK_DIAL_KEY).toBe('gradingHookEnabled');
  });

  it('`assertGradingWriteIncapacitated` lanza; no devuelve un booleano que alguien pueda ignorar', () => {
    expect(() =>
      assertGradingWriteIncapacitated(LOCAL_API, sources({ [PROVIDER_KEY_VAR]: 'ppt_live_abc123' })),
    ).toThrow(/SE NIEGA/);
    expect(assertGradingWriteIncapacitated(LOCAL_API, sources({})).mechanism).toBe('no-key');
  });

  it('el mensaje del rechazo dice QUÉ hacer, no solo que no', () => {
    const verdict = assessGradingWriteCapability({
      apiBaseUrl: LOCAL_API,
      sources: sources({ [PROVIDER_KEY_VAR]: 'ppt_live_abc123' }, '.env'),
    });
    const message = incapacitationFailureMessage(verdict);
    expect(message).toMatch(PROVIDER_KEY_VAR);
    expect(message).toMatch(PROVIDER_PROBE_VAR);
    expect(message).toMatch(REMOTE_ATTESTATION_VAR);
    // Dice DÓNDE está la llave y que hay que volver a levantar el stack: sin eso el remedio no es
    // accionable (cambiar el env con el backend ya arriba no cambia nada).
    expect(message).toMatch(/\.env/);
    expect(message).toMatch(/LEVANTAR el stack/);
  });
});

describe('e2e · el teardown APAGA el dial, nunca lo deja encendido', () => {
  /**
   * `grading_hook_enabled` es una clave NUEVA: no existe en ninguna base, así que el «valor previo»
   * es `undefined` en todos los entornos. Y aunque alguien lo hubiera dejado en `on`, restaurarlo
   * sería un teardown automático **autorizando gasto** — decisión del dueño, no del arnés.
   */
  it('aterriza en `off` sea cual sea el valor previo observado', () => {
    expect(restoreDialValue(undefined)).toBe('off');
    expect(restoreDialValue('off')).toBe('off');
    expect(restoreDialValue('on')).toBe('off');
  });
});

describe('e2e · lectura de las fuentes de entorno del backend', () => {
  it('parsea un .env como lo haría dotenv (comentarios, comillas, export)', () => {
    const parsed = parseDotEnv(
      ['# comentario', 'POKEMONPRICETRACKER_API_KEY="ppt_live_abc"', 'export OTRA=1', 'MALA', ''].join('\n'),
    );
    expect(parsed[PROVIDER_KEY_VAR]).toBe('ppt_live_abc');
    expect(parsed.OTRA).toBe('1');
    expect(parsed.MALA).toBeUndefined();
  });

  /**
   * El vector real del enunciado: `docker-compose.yml` interpola `${POKEMONPRICETRACKER_API_KEY}`
   * **sin default** desde el `.env` de la RAÍZ. Si el guardarraíl solo mirara `process.env`, la
   * llave del desarrollador entraría al contenedor sin que nadie la viera.
   */
  it('lee la llave del `.env` de la RAÍZ del repo, no solo de process.env', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
    fs.mkdirSync(path.join(root, 'backend'));
    fs.mkdirSync(path.join(root, 'frontend'));
    fs.writeFileSync(path.join(root, '.env'), `${PROVIDER_KEY_VAR}=ppt_live_del_dev\n`);

    const found = collectBackendEnvSources(root);
    expect(found.map((s) => s.origin)).toContain('.env');
    const verdict = assessGradingWriteCapability({ apiBaseUrl: LOCAL_API, sources: found });
    expect(verdict.incapacitated).toBe(false);
    expect(verdict.liveKeySources).toContain('.env');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('encuentra la raíz del repo desde el cwd del frontend', () => {
    const root = findRepoRoot();
    expect(root).toBeTruthy();
    expect(fs.existsSync(path.join(root!, 'backend'))).toBe(true);
    expect(fs.existsSync(path.join(root!, 'frontend'))).toBe(true);
  });
});

describe('e2e · el arnés no puede encender el dial por su cuenta', () => {
  const harness = fs.readFileSync(
    path.join(findRepoRoot()!, 'frontend', 'e2e', 'utils', 'grading.ts'),
    'utf8',
  );

  /**
   * Segundo candado, estructural: el literal que enciende el dial vive **solo** en el guardarraíl.
   * Si alguien vuelve a escribir el `PUT` a mano en el arnés —que es exactamente cómo estaba antes
   * de M-46—, este test lo dice. Sin él, el candado de comportamiento se esquiva con una línea.
   */
  it('el arnés no contiene ningún PUT que ponga el dial en `on`', () => {
    expect(harness).not.toMatch(/gradingHookEnabled['"]?\s*:\s*['"]on['"]/);
    expect(harness).toContain('enableGradingHookGuarded');
    // Las dos claves retiradas en v1.51 no pueden reaparecer: hoy responden 422.
    expect(harness).not.toContain('gradedEstimatesEnabled');
    expect(harness).not.toContain('gradedEstimateIngestEnabled');
  });

  it('el arnés apaga el dial a través de `restoreDialValue`, no del valor previo', () => {
    expect(harness).toContain('restoreDialValue(previous)');
  });

  /** §4.38(r.6.1) exige además que el arnés DECLARE la huella; una huella no declarada no se audita. */
  it('el arnés declara la incapacitación en su cabecera de huella y en el log de la corrida', () => {
    expect(harness).toMatch(/HUELLA QUE DEJA EN EL ENTORNO/);
    expect(harness).toMatch(/POKEMONPRICETRACKER_API_KEY/);
    expect(harness).toMatch(/INCAPACITACIÓN=/);
  });
});

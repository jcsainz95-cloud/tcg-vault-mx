import fs from 'node:fs';
import path from 'node:path';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * INCAPACITACIÓN DEL ENTORNO E2E FRENTE AL PROVEEDOR DE PAGA
 * (ARCHITECTURE §4.38(r.6.1), NORMATIVO — dueños: **frontend** el arnés, **devops** el env)
 *
 * **El problema, en una frase.** Hasta v1.50 el arnés encendía un dial que solo publicaba. Desde
 * v1.51 (M-46) hay **un solo dial** (`gradingHookEnabled`) y ese mismo `PUT` autoriza también la
 * **obtención**: el barrido pide cifras a un proveedor **de paga** y escribe precios. Una suite E2E
 * que enciende el dial en cada corrida pasaría a ser, sin que nadie lo pidiera, un consumidor de la
 * cuota de un proveedor de paga.
 *
 * **Por qué esto existe aunque «en CI no hay llave».** Es verdad que hoy ningún workflow de
 * `.github/workflows/` define `POKEMONPRICETRACKER_API_KEY`… pero `docker-compose.yml` la pasa como
 * `${POKEMONPRICETRACKER_API_KEY}` **sin default**, es decir, toma la del `.env` de quien levante el
 * stack. En CI queda vacía **por accidente, no por diseño**; en la máquina de alguien con la llave
 * real, una corrida de E2E encendería el gasto. Y la única protección viva —el proveedor sale con
 * `warn` si no hay llave— vive **en el proveedor**, no en el arnés, y depende de que la llave esté
 * ausente. Depender de que alguien olvide poner una variable no es un diseño: es una casualidad con
 * buena suerte.
 *
 * **Qué hace este módulo.** Convierte esa casualidad en una **precondición verificada**: el arnés no
 * puede encender el dial sin que antes se compruebe que el entorno está incapacitado para escribir
 * automático. Las dos formas admitidas son las de §4.38(r.6.1), en este orden de preferencia:
 *
 *   1. **Sin `POKEMONPRICETRACKER_API_KEY`** (preferido: **cero peticiones** al proveedor).
 *   2. **Con `POKEMONPRICETRACKER_GRADED_PROBE=on`** (la sonda: pregunta y **no escribe**).
 *
 * **Cómo lo comprueba, y por qué así.** Cuando la API bajo prueba corre en **esta misma máquina**
 * (localhost), las fuentes de entorno del backend son observables desde aquí y **se observan**: el
 * `process.env` de la corrida y los `.env` que el backend lee de verdad (`ConfigModule.forRoot()` sin
 * `envFilePath` ⇒ `backend/.env`; `docker-compose.yml` interpola el `.env` de la raíz). No se
 * pregunta «¿me prometes que no hay llave?»: se mira dónde el backend la buscaría.
 *
 * Cuando la API es **remota** (staging, `E2E_BASE_URL`/`E2E_API_BASE_URL` a otro host) el entorno del
 * backend **no es observable desde aquí** y no hay endpoint del contrato que lo exponga —ni debe
 * haberlo: un dial escondido que gobierne el gasto es justo lo que §4.38(r.3.3) rechaza—. Ahí la
 * única palanca honesta es la **constancia explícita de devops**
 * (`E2E_GRADING_PROVIDER_INCAPACITATED=1`), que es suya por reparto. Sin esa constancia el arnés
 * **se niega a encender el dial**: antes de v1.51 se encendía a ciegas.
 *
 * ⚠️ **La constancia NO gana sobre la observación.** Contra un backend local con llave viva, declarar
 * la variable no desbloquea nada. Si bastara, habríamos sustituido un olvido por una promesa.
 *
 * **Lo que este módulo NO es.** No es un feature flag ni un segundo dial: no puede **dar** capacidad
 * de escribir, solo **negarse a autorizarla**. Y no toca el producto — el gate del ingest sigue
 * siendo del backend, que lee el dial (§4.38h.3).
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

/** Credencial del proveedor de paga (PokemonPriceTracker). Sin ella el ingest no emite ni una petición. */
export const PROVIDER_KEY_VAR = 'POKEMONPRICETRACKER_API_KEY';

/** Sonda de solo-lectura del ingest de fase 2 (§4.38h.1-quater): pregunta al proveedor y NO escribe. */
export const PROVIDER_PROBE_VAR = 'POKEMONPRICETRACKER_GRADED_PROBE';

/**
 * Constancia de **devops** de que un entorno REMOTO ya está incapacitado (§4.38r.6.1). Solo se
 * consulta cuando la API no es local: contra localhost manda la observación, siempre.
 */
export const REMOTE_ATTESTATION_VAR = 'E2E_GRADING_PROVIDER_INCAPACITATED';

/** Clave del dial único de M10 (contrato v1.51-one-dial, DTO). */
export const GRADING_HOOK_DIAL_KEY = 'gradingHookEnabled';

/**
 * Placeholders de `.env.example` y compañía: **no son una llave**. Tratarlos como llave viva
 * convertiría el guardarraíl en un falso positivo permanente para quien copie el ejemplo tal cual,
 * y un guardarraíl que siempre grita se acaba desactivando — que es cómo mueren los guardarraíles.
 */
const PLACEHOLDER_VALUES = new Set([
  'change_me',
  'changeme',
  'todo',
  'tu_llave',
  'your_key',
  'your-key',
  'xxx',
  'none',
  'null',
  'undefined',
]);

/** Una fuente de entorno del backend, con su origen legible para el mensaje de error. */
export interface EnvSource {
  /** De dónde salió (para que el error diga QUÉ archivo editar). */
  origin: string;
  values: Record<string, string | undefined>;
}

export interface CapabilityAssessment {
  /** `true` ⇒ el entorno NO puede escribir precios automáticos: el arnés puede encender el dial. */
  incapacitated: boolean;
  /** Mecanismo que lo garantiza; entra literal en la cabecera de huella del arnés. */
  mechanism: 'no-key' | 'probe' | 'devops-attestation' | 'none';
  /** Frase declarativa, apta para log y para el mensaje de error. */
  detail: string;
  /** Fuentes donde se encontró una llave VIVA (vacío si no hay ninguna). */
  liveKeySources: string[];
}

/** ¿El valor parece una credencial de verdad (no vacía, no placeholder)? */
export function isLiveProviderKey(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v === '') return false;
  return !PLACEHOLDER_VALUES.has(v.toLowerCase());
}

/**
 * ¿La sonda está pedida? **Se replica la lectura del backend, valor por valor**
 * (`pokemonpricetracker-bulk.provider.ts` → `gradedProbeRequested`). Si el arnés fuera más laxo que
 * el backend, aceptaría como «incapacitado» un entorno que sí escribe: la divergencia se pagaría en
 * créditos, no en un rojo.
 */
export function isProbeRequested(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

/** Parser mínimo de `.env` (`CLAVE=valor`, comillas opcionales). No ejecuta nada del archivo. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Raíz del repo: el ancestro que tiene `backend/` y `frontend/`. `null` si no se reconoce. */
export function findRepoRoot(from: string = process.cwd()): string | null {
  let dir = path.resolve(from);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'backend')) && fs.existsSync(path.join(dir, 'frontend'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Las fuentes de entorno **que el backend lee de verdad**, en el orden en que importan:
 *
 *  - `process.env` — lo que exportó quien levantó el stack (y lo que hereda el contenedor).
 *  - `<repo>/.env` — el que `docker-compose.yml` interpola (`${POKEMONPRICETRACKER_API_KEY}`, **sin
 *    default**: si está ahí, entra al contenedor).
 *  - `<repo>/backend/.env` — el que `ConfigModule.forRoot()` carga por defecto en el stack nativo.
 *
 * Se leen también los `.env.local` porque es donde la gente guarda la llave buena.
 */
export function collectBackendEnvSources(repoRoot: string | null = findRepoRoot()): EnvSource[] {
  const sources: EnvSource[] = [{ origin: 'process.env', values: { ...process.env } }];
  if (!repoRoot) return sources;
  const candidates = ['.env', '.env.local', path.join('backend', '.env'), path.join('backend', '.env.local')];
  for (const rel of candidates) {
    const file = path.join(repoRoot, rel);
    try {
      if (!fs.existsSync(file)) continue;
      sources.push({ origin: rel, values: parseDotEnv(fs.readFileSync(file, 'utf8')) });
    } catch {
      // Un `.env` ilegible no puede volverse un permiso: se ignora como fuente, y si la llave
      // estuviera SOLO ahí el resto del guardarraíl sigue aplicando (la sonda / la constancia).
    }
  }
  return sources;
}

/** ¿La API bajo prueba corre en esta misma máquina (⇒ su entorno es observable desde aquí)? */
export function isLocalApiTarget(apiBaseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(apiBaseUrl).hostname.toLowerCase();
  } catch {
    // Una URL que no parsea no se puede declarar local: se trata como remota (más estricto).
    return false;
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '0.0.0.0';
}

/**
 * El dictamen, **puro y testeable**: dadas las fuentes de entorno y la API objetivo, ¿puede este
 * entorno escribir precios automáticos si se enciende el dial?
 */
export function assessGradingWriteCapability(input: {
  apiBaseUrl: string;
  sources: EnvSource[];
}): CapabilityAssessment {
  const { apiBaseUrl, sources } = input;

  const liveKeySources = sources
    .filter((s) => isLiveProviderKey(s.values[PROVIDER_KEY_VAR]))
    .map((s) => s.origin);
  const probeSources = sources.filter((s) => isProbeRequested(s.values[PROVIDER_PROBE_VAR])).map((s) => s.origin);

  if (!isLocalApiTarget(apiBaseUrl)) {
    // API remota: su `.env` no está aquí. La observación local no dice nada del backend, así que la
    // única prueba honesta es la constancia de devops (§4.38r.6.1, reparto).
    const attested = isProbeRequested(process.env[REMOTE_ATTESTATION_VAR]);
    return attested
      ? {
          incapacitated: true,
          mechanism: 'devops-attestation',
          detail:
            `API remota (${apiBaseUrl}) declarada incapacitada por devops vía ` +
            `${REMOTE_ATTESTATION_VAR} (§4.38r.6.1)`,
          liveKeySources,
        }
      : {
          incapacitated: false,
          mechanism: 'none',
          detail: `API remota (${apiBaseUrl}) sin constancia de devops (${REMOTE_ATTESTATION_VAR})`,
          liveKeySources,
        };
  }

  if (liveKeySources.length === 0) {
    return {
      incapacitated: true,
      mechanism: 'no-key',
      detail: `sin ${PROVIDER_KEY_VAR} en ninguna fuente del backend (${sources.map((s) => s.origin).join(', ')}) ⇒ cero peticiones al proveedor`,
      liveKeySources,
    };
  }

  if (probeSources.length > 0) {
    return {
      incapacitated: true,
      mechanism: 'probe',
      detail: `${PROVIDER_PROBE_VAR} activa en ${probeSources.join(', ')} ⇒ el ingest observa y NO escribe`,
      liveKeySources,
    };
  }

  return {
    incapacitated: false,
    mechanism: 'none',
    detail: `hay una ${PROVIDER_KEY_VAR} viva en ${liveKeySources.join(', ')} y la sonda está apagada`,
    liveKeySources,
  };
}

/** Mensaje del rechazo. Se separa para poder afirmar sobre él sin montar medio entorno. */
export function incapacitationFailureMessage(assessment: CapabilityAssessment): string {
  return (
    `[e2e] SE NIEGA a encender el gancho de grading: el entorno PUEDE escribir precios automáticos ` +
    `y encender el dial único (${GRADING_HOOK_DIAL_KEY}) autorizaría a un proveedor DE PAGA a cobrar ` +
    `créditos en la primera corrida del barrido. Diagnóstico: ${assessment.detail}.\n` +
    `Incapacita el entorno y vuelve a LEVANTAR el stack (el backend lee su entorno al arrancar; ` +
    `cambiarlo con el stack ya arriba no sirve):\n` +
    `  · Preferido — sin llave, cero peticiones: deja ${PROVIDER_KEY_VAR} vacía en el .env que use tu ` +
    `stack (raíz para docker-compose, backend/.env para el stack nativo).\n` +
    `  · Alternativa — sonda de solo-lectura: ${PROVIDER_PROBE_VAR}=on (pregunta al proveedor y no ` +
    `escribe ninguna fila).\n` +
    `  · Contra staging/CI (API remota): es de devops declarar el entorno incapacitado con ` +
    `${REMOTE_ATTESTATION_VAR}=1.\n` +
    `Norma: ARCHITECTURE §4.38(r.6.1). Esto NO es un flag del producto: solo puede negar la ` +
    `autorización, nunca darla.`
  );
}

/**
 * Precondición del arnés: **lanza** si el entorno puede escribir automático. Devuelve el dictamen
 * cuando pasa, para que el arnés lo declare en su huella.
 */
export function assertGradingWriteIncapacitated(
  apiBaseUrl: string,
  sources: EnvSource[] = collectBackendEnvSources(),
): CapabilityAssessment {
  const assessment = assessGradingWriteCapability({ apiBaseUrl, sources });
  if (!assessment.incapacitated) throw new Error(incapacitationFailureMessage(assessment));
  return assessment;
}

/**
 * **El ÚNICO sitio del repo que enciende el dial**, y por eso lleva la precondición pegada: la
 * comprobación no se puede saltar moviendo una línea, porque no hay otra línea que encienda.
 *
 * Recibe el `PUT` como parámetro (no lo importa) para que el arnés siga siendo dueño de su
 * transporte y para que esto sea verificable sin red: un test puede afirmar que, con llave viva,
 * **el `PUT` no llega a ocurrir**.
 */
export async function enableGradingHookGuarded(
  apiBaseUrl: string,
  put: (body: Record<string, string>) => Promise<unknown>,
  sources: EnvSource[] = collectBackendEnvSources(),
): Promise<CapabilityAssessment> {
  const assessment = assertGradingWriteIncapacitated(apiBaseUrl, sources);
  await put({ [GRADING_HOOK_DIAL_KEY]: 'on' });
  return assessment;
}

/**
 * Valor al que el arnés devuelve el dial en el teardown: **siempre `off`**, sea cual sea el valor
 * previo observado.
 *
 * Dos razones, y ninguna es pereza. **(1)** `grading_hook_enabled` es una clave NUEVA (M-46): no
 * existe en ninguna base, así que «el valor previo» es `undefined` en todos los entornos y
 * «restaurar» solo puede significar `off`. **(2)** Encender el dial es un **acto de dinero** que,
 * por doctrina (§4.38r.3), hace **el dueño** desde el back-office con el aviso delante — nunca un
 * teardown automático. Un arnés que dejara el dial en `on` porque «así estaba» convertiría el
 * siguiente tick del cron en la factura de nadie.
 */
export function restoreDialValue(_observedPrevious: string | undefined): 'off' {
  return 'off';
}

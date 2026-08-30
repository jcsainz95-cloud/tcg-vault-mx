import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Candado del ARNÉS E2E (hallazgo de devops sobre IMPORTANTE-2).
 *
 * `E2E_REAL` es, en `playwright.config.ts`, la bandera de **SELECCIÓN DE SPECS** (`grep: /@real/`).
 * La pregunta que un spec necesita contestar es otra: **«¿contra qué habla la app?»**, y ésa la
 * resuelve `IS_REAL` en `e2e/utils/auth.ts` (`!FORCE_MOCK && (APP_IS_EXTERNAL || REAL_SUBSET_SELECTED)`).
 *
 * Qué pasó: `guest-checkout.spec.ts` ramificaba con `process.env.E2E_REAL` CRUDO. Sin la bandera
 * puesta tomaba la rama MOCK de sus asertos —clic en «Pagar» simulado y esperar el número de
 * pedido— **contra un modal de Stripe real**: un verde falso en uno de los tres flujos de dinero,
 * justo el que el gate de promoción acababa de empezar a correr. Además ataba `.github/` a fijar
 * `E2E_REAL` sólo para que ese archivo se comportara.
 *
 * La regla: **un solo módulo lee la variable de entorno; los specs le preguntan a él.**
 */
function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.spec.ts'))
    .map((e) => join(dir, e.name));
}

/**
 * Quita comentarios de bloque y de línea. **Todo candado de este archivo mide sobre esto**, nunca
 * sobre el fuente crudo: un candado que cuenta ocurrencias en la PROSA se sostiene sobre la
 * cabecera del archivo y se mueve al reescribirla — que es justo lo que le pasó al candado nº2
 * (8 ocurrencias de `@real`, **3 de ellas en comentarios**). Lo que hay que medir es el
 * comportamiento del arnés, y el comportamiento está en el código.
 * (El `[^:]` evita comerse el `//` de una URL `http://…`.)
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('arnés E2E · el modo se pregunta UNA vez', () => {
  const e2eDir = join(__dirname, '..', '..', 'e2e');

  it('ningún spec lee `process.env.E2E_REAL` — para eso está `IS_REAL`', () => {
    const offenders = specFiles(e2eDir)
      .filter((f) => {
        // Se ignoran los comentarios: la prohibición es sobre el CÓDIGO, y explicar por qué no se
        // usa la variable es exactamente lo que queremos que siga escrito.
        return /process\.env\.E2E_REAL/.test(stripComments(readFileSync(f, 'utf8')));
      })
      .map((f) => f.split('/').pop()!);
    expect(
      offenders,
      `specs que le preguntan al entorno en vez de a IS_REAL: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('los specs que ramifican por entorno importan `IS_REAL` del helper', () => {
    const branching = specFiles(e2eDir).filter((f) => /\bIS_REAL\b/.test(readFileSync(f, 'utf8')));
    // Hoy son checkout · guest-checkout · shipments · master-set · pricing-curve. No se fija la
    // lista (crecerá): se fija que quien ramifica lo hace con el import, no con el entorno.
    expect(branching.length).toBeGreaterThan(0);
    for (const f of branching) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} usa IS_REAL sin importarlo de utils/auth`).toMatch(
        /import\s*\{[^}]*\bIS_REAL\b[^}]*\}\s*from\s*'\.\/utils\/auth'/,
      );
    }
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Candado nº2 (bloqueante de QA, v1.50.3; **reescrito por D3 del techlead**): **una feature no
 * puede volver a quedar fuera del gate `@real`.**
 *
 * Qué pasó: los 9 specs de `grading-estimate.spec.ts` navegaban a ids de FIXTURE
 * (`c-blastoise`, `c-eevee`, `c-pikachu`, `c-milotic-fa`) y asertaban montos de fixture, sin
 * declararse `mockOnly`. Contra el stack vivo eran 9 rojos; y como ninguno llevaba `@real`,
 * **el subset `@real` —el único que corre contra la plataforma levantada— no probaba ni una
 * línea de la feature**. El «97/97» era cierto y no significaba nada sobre ella.
 *
 * **Qué medía mal la primera versión de este candado (D3), y cómo se corrige:**
 *  1. **Contaba la cadena `@real` sobre el fuente CRUDO**: de 8 ocurrencias, **3 vivían en
 *     comentarios**. El umbral se sostenía sobre prosa y una reescritura de la cabecera lo movía.
 *     Ahora se cuenta sobre el código sin comentarios (`stripComments`) — la técnica que el
 *     `describe` de arriba ya usaba y que aquí no se había aplicado.
 *  2. **Contaba ETIQUETAS, no TESTS.** Playwright hace `grep` sobre el TÍTULO COMPLETO
 *     (`describe` + `test`), así que una etiqueta en el `describe` cubre N tests y otra en un
 *     `test` cubre uno. Contar ocurrencias mezclaba las dos cosas. Ahora se resuelve la herencia
 *     y se cuenta **cuántos tests seleccionaría el gate**, que es la magnitud que importa.
 *  3. **Solo miraba `grading-estimate.spec.ts`**: protegía el archivo que regresionó, no la
 *     clase de defecto. Las reglas estructurales se aplican ahora a **toda** la carpeta `e2e/`.
 *  4. **`src.split(/\n\s*test\(/)` descartaba la cabecera**, así que una navegación a un id de
 *     fixture desde un `beforeEach` (o desde el módulo) **esquivaba el candado** y arrastraba a
 *     todos los tests del `describe`, incluidos los `@real`. Ahora el fuente se parte en
 *     segmentos que incluyen el módulo y el preámbulo de cada `describe`, y ahí un id de fixture
 *     es offender **siempre**: un hook no puede declararse `mockOnly` por sus tests.
 *  5. **Un test `@real` que llama `mockOnly()` en su cuerpo** es el mismo agujero con otra forma:
 *     el gate lo selecciona y lo salta siempre. Se prohíbe explícitamente.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

/** Un trozo del spec con dueño: el módulo, el preámbulo de un `describe` (sus hooks) o un test. */
interface SpecSegment {
  file: string;
  kind: 'module' | 'describe' | 'test';
  /** Título del `describe`/`test`; para el módulo, un marcador legible. */
  title: string;
  /** Título COMPLETO tal como lo ve el `grep` de Playwright (`describe` + `test`). */
  fullTitle: string;
  /** Código desde su declaración hasta la siguiente (el cuerpo, en la práctica). */
  body: string;
}

/**
 * Declaraciones de Playwright con su título literal. Cubre los modificadores (`test.skip`,
 * `test.describe.serial`…) porque un test aparcado sigue contando para estas reglas.
 */
const DECLARATION =
  /(test\.describe(?:\.\w+)*|(?:test|it)(?:\.(?:only|skip|fixme|fail|slow))*)\s*\(\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g;

/**
 * Parte un spec en segmentos. La herencia de título se resuelve con el `describe` inmediatamente
 * anterior: los specs de este repo tienen los `describe` a nivel superior y sin anidar. Si algún
 * día se anidan, el resultado sería el `describe` interior — un conteo a la BAJA, es decir un
 * candado más estricto, nunca uno más laxo.
 */
function parseSpec(file: string): SpecSegment[] {
  const code = stripComments(readFileSync(file, 'utf8'));
  const marks: { kind: 'describe' | 'test'; title: string; index: number }[] = [];
  DECLARATION.lastIndex = 0;
  for (let m = DECLARATION.exec(code); m !== null; m = DECLARATION.exec(code)) {
    marks.push({
      kind: m[1].startsWith('test.describe') ? 'describe' : 'test',
      title: m[3],
      index: m.index,
    });
  }

  const end = (i: number) => marks[i + 1]?.index ?? code.length;
  const segments: SpecSegment[] = [
    {
      file,
      kind: 'module',
      title: '(módulo)',
      fullTitle: '',
      body: code.slice(0, marks[0]?.index ?? code.length),
    },
  ];

  let describeTitle = '';
  marks.forEach((mark, i) => {
    if (mark.kind === 'describe') describeTitle = mark.title;
    segments.push({
      file,
      kind: mark.kind,
      title: mark.title,
      fullTitle: mark.kind === 'describe' ? mark.title : `${describeTitle} ${mark.title}`,
      body: code.slice(mark.index, end(i)),
    });
  });
  return segments;
}

/** Tests que el gate `@real` SELECCIONARÍA (`grep: /@real/` sobre el título completo). */
function realTests(segments: SpecSegment[]): SpecSegment[] {
  return segments.filter((s) => s.kind === 'test' && /@real/.test(s.fullTitle));
}

/**
 * Navegación a un id de FIXTURE (`/catalog/c-…`, `/sellado/inv-…`): datos que el backend real no
 * promete. Se ancla al `goto(` a propósito — es la navegación la que revienta contra el stack
 * vivo, no una mención del id en un selector.
 */
const FIXTURE_NAV = /goto\(\s*[`'"][^`'"]*\/(?:c|inv|o|u|s|b)-[a-z0-9]/;

describe('arnés E2E · el gate `@real` no puede vaciarse en silencio', () => {
  const e2eDir = join(__dirname, '..', '..', 'e2e');
  const files = specFiles(e2eDir);
  const byFile = new Map(files.map((f) => [f, parseSpec(f)]));
  const name = (f: string) => f.split('/').pop()!;

  it('el gancho de grading conserva su cobertura `@real` (tests, no menciones)', () => {
    const spec = files.find((f) => name(f) === 'grading-estimate.spec.ts')!;
    const real = realTests(byFile.get(spec)!);
    // Hoy son 12: ficha (4) + teja (3) + vitrina (2) + captura (1) + lista de revisión (1) +
    // retirar (1). Se exige un PISO, no el número exacto: añadir casos no debe romper el candado;
    // vaciarlo, sí. Y el piso se mide sobre tests seleccionables, así que ni un comentario ni un
    // `describe` que pierde su etiqueta pueden sostenerlo.
    expect(
      real.length,
      `grading-estimate.spec.ts se quedó con ${real.length} tests \`@real\`: el gate volvería a no probar el gancho`,
    ).toBeGreaterThanOrEqual(11);
  });

  it('la SUITE conserva su cobertura `@real` (la clase, no solo el archivo que regresionó)', () => {
    const withReal = files.filter((f) => realTests(byFile.get(f)!).length > 0);
    const total = files.reduce((n, f) => n + realTests(byFile.get(f)!).length, 0);
    // Hoy: 25 tests `@real` repartidos en 9 archivos (buylist, catálogo, checkout, grading,
    // guest-checkout, master-set, curva de precios, envíos, bóveda). Pisos, no listas: el hueco
    // que se cierra es «una feature entera deja de correr contra el stack levantado».
    expect(withReal.map(name).sort(), 'archivos con cobertura @real').toHaveLength(9);
    expect(total, 'tests que el gate @real seleccionaría en toda la suite').toBeGreaterThanOrEqual(
      24,
    );
  });

  it('los ids de FIXTURE solo aparecen en tests declarados `mockOnly` / `needsSeed`', () => {
    const offenders = [...byFile.values()]
      .flat()
      .filter((s) => FIXTURE_NAV.test(s.body))
      .filter((s) => !(s.kind === 'test' && /mockOnly\(|needsSeed\(/.test(s.body)))
      .map((s) => `${name(s.file)} › ${s.kind === 'test' ? '' : `[${s.kind}] `}${s.title.slice(0, 70)}`);
    expect(
      offenders,
      'navegan a ids de fixture sin declararse mock-only/needs-seed (y si es un `describe` o el ' +
        'módulo, es peor: el hook arrastra también a los tests `@real`): ' +
        offenders.join(' | '),
    ).toEqual([]);
  });

  it('ningún test `@real` se auto-salta con `mockOnly()` (el gate lo elegiría y lo saltaría siempre)', () => {
    const offenders = [...byFile.values()]
      .flatMap(realTests)
      .filter((s) => /mockOnly\(|needsSeed\(/.test(s.body))
      .map((s) => `${name(s.file)} › ${s.title.slice(0, 70)}`);
    expect(offenders, `tests @real que nunca corren en real: ${offenders.join(' | ')}`).toEqual([]);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * IMP-A (QA) — **el arnés no deja credenciales legibles en `/tmp`.**
 *
 * `e2e/utils/state.ts` cachea en disco el `TokenPair` COMPLETO (access **y refresh**) de cada rol
 * del seed, incluido `super_admin`, para no comerse el rate-limit de `POST /auth/login`. Se
 * escribía con el modo por defecto (`0644` en un `/tmp` compartido) y **nunca se borraba**: el
 * `globalTeardown` limpiaba `dial` y `scenario`, no la sesión. Con `E2E_BASE_URL` apuntando a
 * staging —caso documentado por devops— lo que quedaba world-readable era un refresh token de
 * `super_admin` de staging, es decir una sesión renovable, no un access token de 15 minutos.
 *
 * Estos tests fijan las dos mitades del arreglo: **permisos** y **purga**.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
describe('arnés E2E · el estado compartido no deja tokens legibles', () => {
  const dirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** Carga `e2e/utils/state.ts` apuntado a un directorio propio (lee `E2E_STATE_DIR` al importar). */
  async function loadState() {
    const dir = mkdtempSync(join(tmpdir(), 'tcg-state-test-'));
    dirs.push(dir);
    vi.stubEnv('E2E_STATE_DIR', dir);
    vi.resetModules();
    const mod = await import('../../e2e/utils/state');
    return { dir, mod };
  }

  const mode = (p: string) => statSync(p).mode & 0o777;

  it('el directorio queda 0700 y cada archivo 0600 — no world-readable', async () => {
    const { dir, mod } = await loadState();
    mod.writeState('session:http://x/api/v1:admin:admin@e2e.local', {
      accessToken: 'eyJ.a',
      refreshToken: 'eyJ.r',
    });

    expect(mode(dir), 'el directorio de estado no puede ser legible por otros usuarios').toBe(
      0o700,
    );
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(mode(join(dir, files[0])), 'el archivo con el TokenPair no puede ser 0644').toBe(0o600);
  });

  it('`clearStateByPrefix` purga las sesiones y respeta el resto del estado', async () => {
    const { dir, mod } = await loadState();
    mod.writeState('session:http://x/api/v1:admin:admin@e2e.local', { accessToken: 'eyJ.a' });
    mod.writeState('session:http://x/api/v1:customer:c@e2e.local', { accessToken: 'eyJ.b' });
    mod.writeState('grading:scenario:http://x/api/v1', { curated: 'x' });
    expect(readdirSync(dir)).toHaveLength(3);

    expect(mod.clearStateByPrefix('session:')).toBe(2);
    expect(readdirSync(dir)).toHaveLength(1);
    // El escenario sobrevive: la purga es de credenciales, no un `rm -rf` del estado.
    expect(mod.readState('grading:scenario:http://x/api/v1')).not.toBeNull();
    // Y una sesión purgada se lee como «no hay», no como un valor rancio.
    expect(mod.readState('session:http://x/api/v1:admin:admin@e2e.local')).toBeNull();
  });

  it('`clearTokenState` alcanza los archivos SIN clave en el sobre (los de corridas anteriores)', async () => {
    const { dir, mod } = await loadState();
    mod.writeState('grading:scenario:http://x/api/v1', { curated: 'x' });
    // Se fabrica a mano un archivo con el formato VIEJO —`{at, value}`, sin `name`—: es el que QA
    // encontró en `/tmp` con `0644`, y el que una purga por prefijo no puede identificar.
    writeFileSync(
      join(dir, 'legacy0000000000.json'),
      JSON.stringify({ at: Date.now(), value: { accessToken: 'eyJ.a', refreshToken: 'eyJ.r' } }),
    );
    expect(readdirSync(dir)).toHaveLength(2);

    expect(mod.clearStateByPrefix('session:'), 'por clave no se le puede ver').toBe(0);
    expect(mod.clearTokenState(), 'por contenido sí').toBe(1);
    expect(readdirSync(dir), 'solo se va el que llevaba tokens').toHaveLength(1);
    expect(mod.readState('grading:scenario:http://x/api/v1')).not.toBeNull();
  });

  it('el `globalTeardown` purga la sesión SIEMPRE, aunque falle la restauración del dial', () => {
    const src = stripComments(
      readFileSync(join(__dirname, '..', '..', 'e2e', 'global-teardown.ts'), 'utf8'),
    );
    expect(src, 'el teardown ya no borra los tokens de la corrida').toMatch(/clearSessions\(\)/);
    // Fuera del `if (IS_REAL)` y en un `finally`: si restaurar el dial revienta (stack caído a
    // mitad), los tokens se borran igual. Es el caso en que más molesta dejarlos.
    expect(src, 'la purga tiene que estar en un `finally`, no colgando del camino feliz').toMatch(
      /finally\s*\{[\s\S]*clearSessions\(\)/,
    );
  });
});

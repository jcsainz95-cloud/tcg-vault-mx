import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';
import { FX_SOURCES, FX_REFRESH_OUTCOMES, FX_REFRESH_REASONS } from '@/types/contract';
import { buildMockFxState, mockFxWorld } from './fixtures';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ **EL ESPEJO DE TIPOS NO PUEDE DERIVAR DEL CONTRATO** — y aquí está el candado
 *
 * ### El defecto que este archivo existe para que no vuelva
 * `src/types/contract.ts` decía `FxSource = 'banxico' | 'manual'` mientras el servidor **ya
 * emitía un tercer valor**, `"fallback"` (§M2-F.3): la tabla `FxRate` vacía con el modo en `auto`
 * ⇒ el sistema cotiza todo el catálogo con un **18 escrito en el código**. Con el espejo corto:
 *
 *   - la pantalla no tenía rama para ese valor y pintaba **la ruta de la clave i18n**;
 *   - el tono caía al `else` — badge **informativo** sobre una tasa que nadie tecleó;
 *   - y **ningún test podía existir**, porque el tipo afirmaba que ese estado era imposible.
 *
 * La deriva del espejo fue el vehículo del bloqueante. Un enum que viaja por la red **se ancla en
 * el contrato o no se ancla en nada**: `FX_SOURCES` se compara aquí contra la tabla de §M2-F.3, no
 * contra lo que alguien recuerde.
 *
 * ### Por qué el ancla es el CONTRATO y no `backend/`
 * `CLAUDE.md`: *«el contrato manda sobre el código»*. Anclarlo en el servicio del backend
 * bendeciría cualquier deriva que el backend introdujera. Anclado en §M2-F, el día que el
 * arquitecto añada un cuarto valor esto se pone rojo **por el sitio correcto**: falta la rama y
 * falta el copy.
 *
 * ⚠️ **Falla CERRADO y a propósito** (misma escritura y mismo trato que `admin-bounties-mock`):
 * reformatear las tablas del contrato puede ponerlo rojo sin que la norma cambie; el coste es leer
 * el diff del contrato y re-bendecir. El coste del modo de fallo contrario ya se pagó dos veces.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONTRACT_PATH = join(__dirname, '..', '..', '..', '..', 'docs', 'API_CONTRACT.md');

function section(openId: string, closeId: string): string {
  const doc = readFileSync(CONTRACT_PATH, 'utf8');
  const open = doc.indexOf(`<a id="${openId}"></a>`);
  expect(open, `no se encontró §${openId} en ${CONTRACT_PATH}`).toBeGreaterThan(-1);
  const close = doc.indexOf(`<a id="${closeId}"></a>`, open);
  expect(close, `no se encontró el final de §${openId} (§${closeId})`).toBeGreaterThan(open);
  return doc.slice(open, close);
}

/** Los valores de la primera columna de una tabla markdown, en orden y sin duplicar. */
function firstColumnValues(table: string): string[] {
  const out: string[] = [];
  for (const line of table.split('\n')) {
    const m = /^\|\s*\*{0,2}`([a-z_]+)`/.exec(line.trim());
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** El catálogo i18n de la tarjeta de FX, en los dos idiomas. */
const CATALOGS: [string, Record<string, unknown>][] = [
  ['es', es.admin.m2.fx as unknown as Record<string, unknown>],
  ['en', en.admin.m2.fx as unknown as Record<string, unknown>],
];

function copyAt(catalog: Record<string, unknown>, path: string): string | undefined {
  const value = path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], catalog);
  return typeof value === 'string' ? value : undefined;
}

describe('espejo de `FxSource` contra §M2-F.3', () => {
  const enumTable = (() => {
    const body = section('M2-F3', 'M2-F4');
    const open = body.indexOf('**`FxSource` — enum');
    expect(open, 'no se encontró la tabla del enum `FxSource` en §M2-F.3').toBeGreaterThan(-1);
    const close = body.indexOf('**`FxAutomaticStatus`', open);
    expect(close, 'no se encontró el final de la tabla de `FxSource`').toBeGreaterThan(open);
    return body.slice(open, close);
  })();

  it('⭐ el enum del cliente trae EXACTAMENTE los valores que el contrato publica', () => {
    // Rojo el día que el contrato gane (o pierda) un valor: es literalmente cómo entró B-1.
    expect([...FX_SOURCES].sort()).toEqual(firstColumnValues(enumTable).sort());
  });

  it('`fallback` está en el contrato y NO es una idea de esta pantalla', () => {
    expect(firstColumnValues(enumTable)).toContain('fallback');
  });

  // ⚠️ v1.63.3: el catálogo se reorganizó al construir la tarjeta de §30 (`sourceLabel.*` +
  // `sourceBody.*` → `source.*` + `source.*Body`, las claves que §30.15 nombra). El candado sigue
  // midiendo lo mismo: **cada valor del enum tiene rótulo propio y `fallback` no comparte ninguno**.
  it.each(CATALOGS)('[%s] cada valor del enum tiene rótulo propio, + el neutro para el desconocido', (_l, fx) => {
    for (const source of FX_SOURCES) {
      expect(copyAt(fx, `source.${source}`), `falta el rótulo de \`${source}\``).toBeTruthy();
    }
    expect(copyAt(fx, 'source.unknown'), 'falta el rótulo neutro (§30.5)').toBeTruthy();
  });

  it.each(CATALOGS)('[%s] ⛔ `fallback` NUNCA comparte rótulo con `manual` ni con `banxico`', (_l, fx) => {
    const fallback = copyAt(fx, 'source.fallback');
    expect(fallback).not.toBe(copyAt(fx, 'source.manual'));
    expect(fallback).not.toBe(copyAt(fx, 'source.banxico'));
    // Y lleva su párrafo: el estado se explica, no se etiqueta y ya (§30.5).
    expect(copyAt(fx, 'source.fallbackBody')?.length ?? 0).toBeGreaterThan(80);
  });
});

describe('espejo del `FxStateDTO` contra §M2-F.3', () => {
  it('⭐ el DTO del cliente trae TODAS las claves de primer nivel del contrato', () => {
    const body = section('M2-F3', 'M2-F4');
    const block = body.slice(body.indexOf('```jsonc') + 8, body.indexOf('```', body.indexOf('```jsonc') + 8));
    const keys = [...block.matchAll(/^ {2}"([a-zA-Z]+)":/gm)].map((m) => m[1]);
    expect(keys.length, 'no se pudieron leer las claves del `FxStateDTO`').toBeGreaterThan(4);
    // El mock materializa el tipo: si al tipo le falta una clave, al DTO también.
    expect(Object.keys(buildMockFxState(mockFxWorld)).sort()).toEqual([...new Set(keys)].sort());
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ⭐⭐ v1.63.4 — `fallbackRate`: LA REGLA 6 DE §M2-F.3, MEDIDA DONDE PUEDE MEDIRSE
 *
 * Este campo entró **porque esta pantalla lo pidió**: el diálogo del acuse (`DESIGN_SYSTEM §30.8`)
 * tiene que **nombrar el número al que se saltaría ANTES de que el humano toque nada**, y hasta
 * v1.63.3 ese número **sólo existía dentro del `422`** ⇒ la tarjeta mandaba un `PUT` sin acuse
 * sólo para leerlo (deuda `FX-F1`). Al concederlo, el arquitecto fijó **tres cosas que son
 * exactamente las que un cliente puede romper sin enterarse**, y por eso cada una tiene su rojo:
 *
 *  1. **Al NIVEL SUPERIOR, ⛔ NO dentro de `automatic`** — el respaldo es del **estado entero**
 *     (con `mode:"manual"` también se puede caer a él, 4.ª fila de §M2-F.1). Anidarlo invitaría al
 *     error que la **regla 5** prohíbe: presentar el 18 **como si fuera «la de Banxico»**.
 *  2. **SIEMPRE presente**, no «sólo cuando hace falta»: un campo que aparece y desaparece obliga
 *     a ramificar por presencia **y parece estado, que no lo es**.
 *  3. ⛔ **NO sustituye al `details` del `422`** — ese error es la carrera real y *tiene que poder
 *     explicarse solo*.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('⭐ espejo de `fallbackRate` (regla 6, v1.63.4) contra §M2-F.3', () => {
  const body = section('M2-F3', 'M2-F4');
  const dtoBlock = body.slice(body.indexOf('```jsonc') + 8, body.indexOf('```', body.indexOf('```jsonc') + 8));
  const flat = (markdown: string) => markdown.replace(/\n\s*>?\s*/g, ' ');

  it('⭐⭐ el contrato lo declara al NIVEL SUPERIOR, y ⛔ NO dentro de `automatic`', () => {
    // Nivel superior = dos espacios de sangría en el bloque del DTO; anidado = cuatro.
    expect(dtoBlock).toMatch(/^ {2}"fallbackRate":/m);
    expect(dtoBlock, '`fallbackRate` aparece ANIDADO: eso es la regla 5 rota').not.toMatch(/^ {4}"fallbackRate":/m);
    // Y la prohibición, dicha: si el contrato la retirara, este cliente tiene que enterarse.
    expect(flat(body)).toMatch(/al nivel superior y ⛔ NO dentro de `automatic`/);
  });

  it('el contrato lo declara OBLIGATORIO y en las CUATRO rutas (⛔ no «sólo cuando hace falta»)', () => {
    expect(flat(body)).toMatch(/obligatorio, al NIVEL SUPERIOR, en las CUATRO rutas y en TODAS las respuestas/);
  });

  it('⭐ invariante (i): con `source: "fallback"`, `rate === fallbackRate` — y el simulador lo cumple', () => {
    expect(flat(body)).toMatch(/`source === "fallback"` ⟹ \*\*`rate === fallbackRate`\*\*/);
    // El mundo sin ninguna de las dos ramas: ni tasa manual, ni fila de Banxico.
    const dto = buildMockFxState({
      ...mockFxWorld,
      mode: 'auto',
      manualRate: null,
      automaticRate: null,
      automaticEffectiveDate: null,
      automaticAgeDays: null,
      automaticStatus: 'missing',
    });
    expect(dto.source).toBe('fallback');
    expect(dto.rate).toBe(dto.fallbackRate);
  });

  it('⭐ y viaja IGUAL en los estados donde NO rige (rojo si aparece sólo cuando hace falta)', () => {
    // Los tres estados legales de §M2-F.1, con el MISMO número: `manual` con tasa, `auto` con fila
    // de Banxico, y `auto` sin ninguna. Un campo condicional pasaría el primer test y este no.
    const manual = buildMockFxState(mockFxWorld);
    const auto = buildMockFxState({
      ...mockFxWorld,
      mode: 'auto',
      automaticRate: 18.2431,
      automaticEffectiveDate: '2026-09-05',
      automaticAgeDays: 3,
      automaticStatus: 'fresh',
    });
    expect(manual.source).toBe('manual');
    expect(auto.source).toBe('banxico');
    expect(typeof manual.fallbackRate).toBe('number');
    expect(manual.fallbackRate).toBe(auto.fallbackRate);
  });

  it('⛔ el campo NO sustituye al `details` del `422`: el contrato lo dice, y en las dos mitades', () => {
    // Mitad (a): §M2-F.3 regla 6, invariante (ii).
    expect(flat(body)).toMatch(/El campo NO sustituye al `details`/);
    // Mitad (b) — la que se olvida: la ficha del error, en §M2-F.2, sigue exigiéndolo COMPLETO.
    const gate = flat(section('M2-F2', 'M2-F3'));
    expect(gate).toMatch(/`details` sigue siendo OBLIGATORIO y COMPLETO/);
    expect(gate).toMatch(/`details\.fallbackRate` es EL MISMO número que `FxStateDTO\.fallbackRate`/);
  });

  /**
   * ⭐ **RATIFICACIÓN, ⛔ no implementación.** El pase anterior pidió al arquitecto bendecir una
   * **variante base de `error.FX_NO_AUTOMATIC_RATE` sin `{fallbackRate}`** (§61.6, petición 2).
   * **Se denegó**, con argumento: *«la frase sin la cifra no es la misma frase menos un paréntesis,
   * es otro mensaje»*, y §30.8 existe justo para impedir eso. Aquí no se cambia ni una cadena: se
   * ancla la decisión, para que el día que alguien la reabra se ponga rojo **por el sitio
   * correcto** — el contrato dejó de permitirlo, o el copy canónico perdió su cifra.
   */
  it('⭐ el copy canónico del `422` NOMBRA la cifra, y el contrato prohíbe la variante sin ella', () => {
    const gate = flat(section('M2-F2', 'M2-F3'));
    expect(gate).toMatch(/\*\*⛔ NO se crea una variante de copy sin la cifra\*\*/);
    for (const [locale, catalog] of [
      ['es', es.error as unknown as Record<string, string>],
      ['en', en.error as unknown as Record<string, string>],
    ] as const) {
      const canonical = catalog.FX_NO_AUTOMATIC_RATE_WITH_DETAILS;
      expect(canonical, `[${locale}] falta el copy canónico de §30.15`).toBeTruthy();
      expect(canonical, `[${locale}] el copy canónico dejó de nombrar la cifra`).toContain('{fallbackRate}');
    }
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * v1.63.3 — LAS DOS COSAS QUE EL CONTRATO CAMBIÓ Y QUE EL CLIENTE TIENE QUE SEGUIR
 *
 * (1) `applied` **se deriva de `source`**, no del `mode` ⇒ `mode: "manual"` con `applied: false`
 *     es **alcanzable**. (2) Los invariantes son **SEIS** (`I-FX6`, la serialización de las dos
 *     puertas). Se anclan **en el contrato**: el día que alguien vuelva a la definición vieja,
 *     esto se pone rojo por el sitio correcto.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('espejo de la regla de `applied` (v1.63.3) contra §M2-F', () => {
  /** El contrato envuelve a ~110 columnas y cita dentro de blockquotes: se aplana antes de leer. */
  const flat = (markdown: string) => markdown.replace(/\n\s*>?\s*/g, ' ');

  it('⭐ el contrato define `applied` POR `source`, y declara alcanzable `manual` sin aplicar', () => {
    const body = flat(section('M2-F3', 'M2-F4'));
    expect(body).toMatch(/exactamente una de las dos `applied` es `true` ⟺ `source` la nombra/);
    expect(body).toMatch(/con `source: "fallback"` las DOS son `false`/);
    expect(body).toMatch(/`mode: "manual"` con `manual\.applied: false` pasa a ser \*\*alcanzable\*\*/);
    // Y la consecuencia, dicha para el cliente: se OBEDECE `applied`, ⛔ no se deriva del `mode`.
    expect(body).toMatch(/la pantalla OBEDECE `applied`, ⛔ no lo deriva de `mode`/);
  });

  it('el simulador obedece esa regla en el mundo por defecto (no sólo en los fixtures del test)', () => {
    const dto = buildMockFxState(mockFxWorld);
    expect(dto.manual.applied).toBe(dto.source === 'manual');
    expect(dto.automatic.applied).toBe(dto.source === 'banxico');
  });

  /**
   * ⚠️ **RE-BENDECIDO en v1.63.4, y el motivo es del propio contrato.** Esta aserción leía el
   * ordinal en prosa (*«Los SEIS invariantes»*) y v1.63.4 **le quitó el número al encabezado a
   * propósito**: *«mientras el predicado pueda crecer, un ordinal en prosa es una promesa que el
   * siguiente pase incumple sin enterarse»* — la cuenta había caducado ya dos veces (v1.63.1 y
   * v1.63.3). ⛔ **No se acomoda el candado bajando el listón**: se mide lo que el contrato dice
   * ahora que ES la cuenta —**la NUMERACIÓN de la lista**— y sigue exigiendo el sexto por su
   * nombre y por lo que hace. Rojo igual si alguien borra `I-FX6` o deja un hueco en la serie.
   */
  it('⭐ los invariantes de §M2-F.1 están NUMERADOS sin huecos, y el sexto es la puerta serializada', () => {
    const raw = section('M2-F1', 'M2-F2');
    const numbers = [...raw.matchAll(/^- \*\*I-FX(\d+)\b/gm)].map((m) => Number(m[1]));
    expect(numbers.length, 'no se encontró la lista de invariantes de §M2-F.1').toBeGreaterThanOrEqual(6);
    // «Su NUMERACIÓN es la cuenta»: 1..n sin saltos ni repetidos.
    expect(numbers).toEqual(numbers.map((_v, i) => i + 1));
    const sixth = raw.split('\n').find((l) => l.startsWith('- **I-FX6'));
    expect(sixth, 'I-FX6 ya no está en la lista').toBeTruthy();
    expect(sixth as string).toMatch(/SERIALIZADAS/);
  });

  it('el interruptor sigue siendo `PUT /admin/fx/mode`, con su acuse y sin aceptar `rate`', () => {
    const body = flat(section('M2-F2', 'M2-F3'));
    expect(body).toMatch(/PUT \/api\/v1\/admin\/fx\/mode/);
    expect(body).toMatch(/acknowledgeNoAutomaticRate/);
    expect(body).toMatch(/⛔ \*\*No acepta `rate`\*\*/);
  });
});

describe('espejo del bloque `refresh` contra §M2-F.5', () => {
  const body = section('M2-F5', 'M2-F6');

  it('⭐ los TRES desenlaces del cliente son los del contrato', () => {
    const line = body.split('\n').find((l) => l.includes('"outcome"'));
    expect(line, 'no se encontró la línea de `outcome` en §M2-F.5').toBeTruthy();
    const declared = [...(line as string).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((v) => v !== 'outcome');
    expect([...FX_REFRESH_OUTCOMES].sort()).toEqual([...new Set(declared)].sort());
  });

  it('los CUATRO motivos del cliente son los del contrato', () => {
    const line = body.split('\n').find((l) => l.includes('"reason"'));
    expect(line, 'no se encontró la línea de `reason` en §M2-F.5').toBeTruthy();
    // El comentario dice «sólo con "failed": …»; los motivos son lo que va DESPUÉS.
    const tail = (line as string).split('"failed":')[1];
    expect(tail, 'la línea de `reason` ya no declara los motivos tras `"failed":`').toBeTruthy();
    const declared = [...tail.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...FX_REFRESH_REASONS].sort()).toEqual([...new Set(declared)].sort());
  });

  it.each(CATALOGS)('[%s] cada motivo está traducido, + el neutro (⛔ que nunca cae al éxito)', (_l, fx) => {
    for (const reason of FX_REFRESH_REASONS) {
      expect(copyAt(fx, `refresh.reason.${reason}`), `falta el copy de \`${reason}\``).toBeTruthy();
    }
    expect(copyAt(fx, 'refresh.reason.unknown'), 'falta el motivo neutro (§30.7)').toBeTruthy();
  });

  it.each(CATALOGS)('[%s] los tres desenlaces tienen copy, y el de `failed` NO es un éxito', (_l, fx) => {
    expect(copyAt(fx, 'refresh.updated')).toBeTruthy();
    expect(copyAt(fx, 'refresh.unchanged')).toBeTruthy();
    expect(copyAt(fx, 'refresh.failedTitle')).toBeTruthy();
    expect(copyAt(fx, 'refresh.failedBody')).toBeTruthy();
    // El título del fallo no puede parecerse a ningún acuse de guardado (§30.7: «un `200` no es un
    // éxito»). ⚠️ La clave `saved` —«Tipo de cambio actualizado.», la frase que el dueño leyó
    // mientras el fetch fallaba— **ya no existe**: la sustituyen `manual.savedRuling` y
    // `manual.savedNotRuling`, que dicen si el número RIGE. Se comprueban las dos, y que la vieja
    // no haya vuelto.
    expect(copyAt(fx, 'saved')).toBeUndefined();
    expect(copyAt(fx, 'refresh.failedTitle')).not.toBe(copyAt(fx, 'manual.savedRuling'));
    expect(copyAt(fx, 'refresh.failedTitle')).not.toBe(copyAt(fx, 'manual.savedNotRuling'));
  });

  it('§M2-F.5 sigue obligando a la UI a distinguir `failed` — la razón de ser de todo esto', () => {
    expect(body).toMatch(/OBLIGADA a distinguir `failed`/);
  });
});

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

  it.each(CATALOGS)('[%s] cada valor del enum tiene rótulo propio, + el neutro para el desconocido', (_l, fx) => {
    for (const source of FX_SOURCES) {
      expect(copyAt(fx, `sourceLabel.${source}`), `falta el rótulo de \`${source}\``).toBeTruthy();
    }
    expect(copyAt(fx, 'sourceLabel.unknown'), 'falta el rótulo neutro (§30.5)').toBeTruthy();
  });

  it.each(CATALOGS)('[%s] ⛔ `fallback` NUNCA comparte rótulo con `manual` ni con `banxico`', (_l, fx) => {
    const fallback = copyAt(fx, 'sourceLabel.fallback');
    expect(fallback).not.toBe(copyAt(fx, 'sourceLabel.manual'));
    expect(fallback).not.toBe(copyAt(fx, 'sourceLabel.banxico'));
    // Y lleva su párrafo: el estado se explica, no se etiqueta y ya (§30.5).
    expect(copyAt(fx, 'sourceBody.fallback')?.length ?? 0).toBeGreaterThan(80);
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
    // El título del fallo no puede parecerse al acuse de guardado que leyó el dueño.
    expect(copyAt(fx, 'refresh.failedTitle')).not.toBe(copyAt(fx, 'saved'));
  });

  it('§M2-F.5 sigue obligando a la UI a distinguir `failed` — la razón de ser de todo esto', () => {
    expect(body).toMatch(/OBLIGADA a distinguir `failed`/);
  });
});

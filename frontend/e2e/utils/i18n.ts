import fs from 'node:fs';
import path from 'node:path';

/**
 * Helper i18n para los E2E: resuelve las MISMAS claves de `messages/{es,en}.json`
 * que usa la app (next-intl), para no hardcodear textos en los asserts
 * (DESIGN_SYSTEM §9). Los datos de catálogo (nombres de cartas/sets) NO viven en
 * estos diccionarios: permanecen en inglés por diseño y se asertan como literales.
 */
export type Locale = 'es' | 'en';
export const LOCALES: Locale[] = ['es', 'en'];

const cache: Partial<Record<Locale, Record<string, unknown>>> = {};

function load(locale: Locale): Record<string, unknown> {
  if (!cache[locale]) {
    const file = path.join(process.cwd(), 'messages', `${locale}.json`);
    cache[locale] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return cache[locale]!;
}

/** Interpola placeholders simples `{var}` (no cubre plural ICU; usar claves sin plural). */
function interpolate(raw: string, vars?: Record<string, string | number>): string {
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** Resuelve una clave anidada `a.b.c` del diccionario del locale dado. */
export function t(locale: Locale, keyPath: string, vars?: Record<string, string | number>): string {
  const raw = keyPath.split('.').reduce<unknown>((obj, key) => {
    if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
    return undefined;
  }, load(locale));
  if (typeof raw !== 'string') {
    throw new Error(`Clave i18n faltante o no-string: "${keyPath}" (${locale})`);
  }
  return interpolate(raw, vars);
}

/**
 * (§M10-IVA.3/.4) EL ROTULO DE CONVENCION DE IVA, CON LA TASA SIN HORNEAR.
 *
 * Las claves del rotulo llevan la tasa dentro (`«IVA {rate} % incluido»`, `«IVA {rate}%»`), y la
 * tasa es **DATO del servidor** (`ivaRatePct`, por fila). Un `{ rate: 16 }` literal en un assert es
 * una segunda fuente para un hecho del que el backend ya es dueno: el dia que el dial cambie, el
 * test se pone rojo hablando de la UI cuando el que cambio fue el entorno.
 *
 * Esto lee la plantilla del **diccionario** (DESIGN_SYSTEM 9: los asserts no copian textos) y
 * sustituye el hueco de la tasa por un numero. Se afirma la **copy exacta**; no se afirma el dial.
 *
 * @param key `'common.ivaIncluded'`, `'checkout.ivaIncluded'`, `'checkout.iva'`... - la clave manda
 *   **que convencion** se esta afirmando, y eso sigue siendo una decision del test.
 */
export function ivaLabelRe(locale: Locale, key: string): RegExp {
  const SLOT = '\u0001';
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    t(locale, key, { rate: SLOT })
      .split(SLOT)
      .map(esc)
      .join('\\d+(?:[.,]\\d+)?'),
  );
}

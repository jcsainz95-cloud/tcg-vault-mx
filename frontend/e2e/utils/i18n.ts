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

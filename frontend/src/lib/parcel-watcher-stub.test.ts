// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as realTypes from '@parcel/watcher';
import createNextIntlPlugin from 'next-intl/plugin';

// DEP-PICO: `@parcel/watcher` es un stub inerte (frontend/vendor/parcel-watcher-stub). next-intl lo importa
// de forma estática desde su plugin; si una versión futura pide otro export, esto falla en CI y no en producción.
// Tipado laxo: el stub no declara firmas.
const watcher = realTypes as unknown as Record<string, (...a: unknown[]) => Promise<any>>;

describe('stub de @parcel/watcher', () => {
  it('expone como named exports ESM toda la API real', () => {
    for (const name of ['subscribe', 'unsubscribe', 'getEventsSince', 'writeSnapshot']) {
      expect(typeof watcher[name], `falta el named export «${name}»`).toBe('function');
    }
  });

  it('next-intl/plugin carga con el stub', () => {
    expect(typeof createNextIntlPlugin).toBe('function');
  });

  it('el stub es inerte', async () => {
    const sub = await watcher.subscribe('.', () => {});
    await expect(sub.unsubscribe()).resolves.toBeUndefined();
    await expect(watcher.getEventsSince('.', 'x')).resolves.toEqual([]);
  });

  it('M3: experimental.extract sigue apagado en la config de next-intl', () => {
    const src = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    expect(
      /\bextract\s*:/.test(src),
      'experimental.extract activado: el extractor de next-intl necesita el watcher REAL y el stub no hace nada. ' +
        'Primero quita el stub (frontend/vendor/parcel-watcher-stub, dependencia file: y override en package.json) y ' +
        'revisa DEP-PICO en docs/STATUS.md.',
    ).toBe(false);
  });
});

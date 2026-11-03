/**
 * IDS-F3 (API_CONTRACT §IDS.9; D-IDS-4) — preselección en sus cuatro casos y agrupación de `versions[]` en filas en el
 * orden del servidor; forma 2×2 frente a 2×N (IDS-UX.8, D-IDS-5 = B); D-IDS-6 (dos filas del mismo tipo y acabado).
 */
import { describe, it, expect } from 'vitest';
import type { VersionOptionDTO } from '@/types/contract';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDefaultVersion, isExtendedForm, preselectVersionOption, versionRows } from './version';
import { tileHref } from '../../e2e/utils/catalog-tile';

function opt(
  optionKey: string,
  language: 'en' | 'es',
  fromPriceCents: number,
  stamp: { type: 'prize_pack' | 'league' | 'staff'; label: string | null; productId: number } | null = null,
  finish: VersionOptionDTO['finish'] = 'holofoil',
  finishLabel: VersionOptionDTO['finishLabel'] = 'holo',
): VersionOptionDTO {
  const key = stamp ? `${language}.${stamp.productId}` : language;
  return {
    optionKey,
    version: { key, language, stamp },
    finish,
    finishLabel,
    fromPriceCents,
    stockCount: 1,
    representativeInventoryItemId: `inv-${optionKey}`,
  };
}

const PP = { type: 'prize_pack' as const, label: null, productId: 565451 };
const COSMOS = { type: 'prize_pack' as const, label: 'Cosmos Holo', productId: 703819 };

// Orden del servidor (§IDS.5): en, es; luego filas de liga por precio; dentro de la fila en antes que es.
const FULL: VersionOptionDTO[] = [
  opt('en', 'en', 20000),
  opt('es', 'es', 15000),
  opt('en.565451.normal', 'en', 9000, PP, 'normal', 'non_holo'),
  opt('es.565451.normal', 'es', 6750, PP, 'normal', 'non_holo'),
  opt('en.703819.holofoil', 'en', 48000, COSMOS, 'holofoil', 'cosmos_holo'),
  opt('es.703819.holofoil', 'es', 36000, COSMOS, 'holofoil', 'cosmos_holo'),
];

describe('IDS-F3 · preselección D-IDS-4', () => {
  it('(1) ?version=<optionKey> presente ⇒ esa', () => {
    expect(preselectVersionOption(FULL, 'es.703819.holofoil')?.optionKey).toBe('es.703819.holofoil');
  });
  it('(2) ?version=<version.key> de liga sin acabado ⇒ la entrada más barata de esa versión', () => {
    const two = [
      ...FULL,
      opt('es.565451.holofoil', 'es', 5000, PP, 'holofoil', 'holo'),
    ];
    expect(preselectVersionOption(two, 'es.565451')?.optionKey).toBe('es.565451.holofoil');
    // empate de precio ⇒ la primera del orden del servidor
    const tie = [...FULL, opt('es.565451.holofoil', 'es', 6750, PP, 'holofoil', 'holo')];
    expect(preselectVersionOption(tie, 'es.565451')?.optionKey).toBe('es.565451.normal');
  });
  it('(3) sin parámetro, con `en` ⇒ `en` (aunque haya otra más barata)', () => {
    expect(preselectVersionOption(FULL, null)?.optionKey).toBe('en');
    expect(preselectVersionOption(FULL, undefined)?.optionKey).toBe('en');
  });
  it('(4) sin parámetro y sin `en` ⇒ la de menor fromPriceCents (empate: la primera)', () => {
    const noEn = FULL.filter((v) => v.optionKey !== 'en');
    expect(preselectVersionOption(noEn, null)?.optionKey).toBe('es.565451.normal');
    const tie = [opt('es', 'es', 100), opt('en.565451.normal', 'en', 100, PP, 'normal', 'non_holo')];
    expect(preselectVersionOption(tie, null)?.optionKey).toBe('es');
  });
  it('agotada o inexistente ⇒ cae a la regla 3, sin lanzar (⛔ sin 404)', () => {
    expect(preselectVersionOption(FULL, 'es.999.holofoil')?.optionKey).toBe('en');
    expect(preselectVersionOption(FULL, 'basura')?.optionKey).toBe('en');
    // `es` es clave SIN liga: casa exacta por optionKey (regla 1), no por la 2.
    expect(preselectVersionOption(FULL, 'es')?.optionKey).toBe('es');
  });
  it('versions[] vacía ⇒ null', () => {
    expect(preselectVersionOption([], 'en')).toBeNull();
  });
});

describe('IDS-F3 · filas en el orden del servidor y forma de la cuadrícula', () => {
  it('2×N: tres filas (sin liga, PP No holo, PP Cosmos) en el orden recibido', () => {
    const rows = versionRows(FULL);
    expect(rows.map((r) => r.id)).toEqual(['base', 'stamp:565451:normal', 'stamp:703819:holofoil']);
    expect(rows[1].cells.en?.optionKey).toBe('en.565451.normal');
    expect(rows[1].cells.es?.optionKey).toBe('es.565451.normal');
    expect(isExtendedForm(rows)).toBe(true);
  });
  it('2×2 estándar: base + UNA fila de liga con el mismo acabado', () => {
    const rows = versionRows([
      opt('en', 'en', 20000),
      opt('es', 'es', 15000),
      opt('en.565451.holofoil', 'en', 48000, PP),
      opt('es.565451.holofoil', 'es', 36000, PP),
    ]);
    expect(isExtendedForm(rows)).toBe(false);
  });
  it('2×N si la fila de liga tiene acabado distinto del de la base, o la base no tiene acabado único', () => {
    expect(isExtendedForm(versionRows([opt('en', 'en', 1), opt('en.565451.normal', 'en', 2, PP, 'normal', 'non_holo')]))).toBe(true);
    expect(isExtendedForm(versionRows([opt('en', 'en', 1, null, null, null), opt('en.565451.holofoil', 'en', 2, PP)]))).toBe(true);
  });
  it('ranura vacía: con tres versiones la fila conserva el hueco (no se reordena)', () => {
    const rows = versionRows([opt('en', 'en', 1), opt('es', 'es', 1), opt('es.565451.holofoil', 'es', 2, PP)]);
    expect(rows[1].cells.en).toBeUndefined();
    expect(rows[1].cells.es?.optionKey).toBe('es.565451.holofoil');
  });
  it('D-IDS-6: dos filas del mismo tipo y mismo finishLabel ⇒ needsStampLabel en ambas', () => {
    const left = { type: 'prize_pack' as const, label: 'Left Stamp', productId: 1 };
    const right = { type: 'prize_pack' as const, label: 'Right Stamp', productId: 2 };
    const rows = versionRows([
      opt('en', 'en', 1),
      opt('en.1.holofoil', 'en', 2, left),
      opt('en.2.holofoil', 'en', 3, right),
    ]);
    expect(rows.filter((r) => r.needsStampLabel).map((r) => r.stamp?.label)).toEqual(['Left Stamp', 'Right Stamp']);
    // Cosmos y PP No holo: mismo tipo, distinto acabado ⇒ no hace falta el label.
    expect(versionRows(FULL).some((r) => r.needsStampLabel)).toBe(false);
  });
});

/*
 * TL-IDS-5 (techlead sobre `f2cd0e31`): «inglés sin liga» tenía tres definiciones (`lib/version.ts`, la línea de
 * `VersionText.ts` y el enlace del arnés `e2e/utils/catalog-tile.ts`). Ahora hay una: `isDefaultVersion`. Este candado
 * prueba la conducta del arnés y que ninguno de los dos sitios vuelva a escribir la regla en línea.
 */
describe('TL-IDS-5 · una sola definición de «inglés sin liga»', () => {
  const PP = { type: 'prize_pack', label: null, productId: 1 };
  it('isDefaultVersion: en sin liga ⇒ sí; es, o en con liga ⇒ no; sin versión ⇒ sí', () => {
    expect(isDefaultVersion({ language: 'en', stamp: null })).toBe(true);
    expect(isDefaultVersion(null)).toBe(true);
    expect(isDefaultVersion({ language: 'es', stamp: null })).toBe(false);
    expect(isDefaultVersion({ language: 'en', stamp: PP })).toBe(false);
  });

  it('el enlace de teja del arnés E2E sigue a isDefaultVersion', () => {
    const g = (language: string, stamp: unknown) => ({ card: { id: 'c1' }, version: { language, stamp }, versionOptionKey: 'k.1' });
    expect(tileHref(g('en', null))).toBe('/es/catalog/c1');
    expect(tileHref(g('es', null))).toBe('/es/catalog/c1?version=k.1');
    expect(tileHref(g('en', PP), 'en')).toBe('/en/catalog/c1?version=k.1');
  });

  it.each(['src/components/domain/VersionText.ts', 'e2e/utils/catalog-tile.ts'])(
    '%s usa isDefaultVersion y no reescribe la regla',
    (rel) => {
      const src = readFileSync(join(__dirname, '..', '..', rel), 'utf8');
      expect(src).toMatch(/import \{[^}]*\bisDefaultVersion\b[^}]*\} from '(@\/lib\/version|\.\.\/\.\.\/src\/lib\/version)'/);
      expect(src).not.toMatch(/language === 'en' &&/);
    },
  );
});

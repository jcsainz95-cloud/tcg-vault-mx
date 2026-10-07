import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { codigoDe } from './strip-comments';

/**
 * Candados de texto y de fuente de §WSH (DESIGN_SYSTEM §WSH-UX.13 + API_CONTRACT §WSH.9, errata v1.87.1).
 *
 * - **WSH-F7 (candado de fuente)**: 0 apariciones de `* 1.05`, `* 1.1`, `* 1.16`, `/ 1.16`, `* 116`, `/ 116` (con o sin
 *   espacios) en `WishlistBlock`, `PctChoice`, `WishlistRow` y `BuyListTab`. Y, por la errata (Q-WSH-UX-3), `WishlistRow`
 *   no compara `fromDisplayCents` con nada: «cabe» es `availableNow.fits`.
 * - **WSH-UX-11**: ningún texto `wishlist.*` vende el máximo como precio.
 * - **WSH-UX-12**: paridad es/en (claves y placeholders) de todo lo nuevo de §WSH-UX.8, .9 y .12.
 * - **Errata v1.87.1**: se retiran las soluciones temporales del diseño (`wishlist.ivaIncluded`,
 *   `wishlist.block.noPesosYet`).
 * - **P66-3**: ningún código interno («WSH-n», «M-74», «P-WSH») en textos.
 */

const ROOT = join(process.cwd(), 'src', 'app', '[locale]');
const SOURCES = {
  WishlistBlock: join(ROOT, '(storefront)', 'catalog', '[cardId]', 'WishlistBlock.tsx'),
  PctChoice: join(ROOT, '(storefront)', 'catalog', '[cardId]', 'PctChoice.tsx'),
  WishlistRow: join(ROOT, '(storefront)', 'account', 'wishlist', 'WishlistRow.tsx'),
  BuyListTab: join(ROOT, '(admin)', 'admin', 'm9', 'BuyListTab.tsx'),
};

const FORBIDDEN_MATH: RegExp[] = [
  /\*\s*1\.05\b/,
  /\*\s*1\.1\b/,
  /\*\s*1\.16\b/,
  /\/\s*1\.16\b/,
  /\*\s*116\b/,
  /\/\s*116\b/,
];

describe('WSH-F7 · candado de fuente: ninguna cifra de dinero se calcula en el cliente', () => {
  for (const [name, file] of Object.entries(SOURCES)) {
    it(`${name} existe y no multiplica ni divide por el IVA ni por los %`, () => {
      expect(existsSync(file), `falta ${file}`).toBe(true);
      const code = codigoDe(file, name);
      for (const re of FORBIDDEN_MATH) expect(code, `${name} contiene ${re}`).not.toMatch(re);
    });
  }

  it('WishlistRow no compara `fromDisplayCents` (v1.87.1: «cabe» = `availableNow.fits`)', () => {
    const code = codigoDe(SOURCES.WishlistRow, 'WishlistRow');
    expect(code).not.toMatch(/fromDisplayCents\s*[<>]=?/);
    expect(code).not.toMatch(/[<>]=?\s*[\w.?]*fromDisplayCents/);
    expect(code).not.toMatch(/maxDisplayCents\s*[<>]=?/);
    expect(code).toMatch(/\.fits\b/);
  });

  it('BuyListTab pinta `pct` tal cual (puntos porcentuales): no multiplica por 100', () => {
    const code = codigoDe(SOURCES.BuyListTab, 'BuyListTab');
    expect(code).not.toMatch(/pct\s*\*\s*100/);
    expect(code).not.toMatch(/100\s*\*\s*[\w.?]*pct/);
  });
});

type Dict = Record<string, unknown>;
function leaves(o: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof o === 'string') out.set(prefix, o);
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Dict)) {
      for (const [kk, vv] of leaves(v, prefix ? `${prefix}.${k}` : k)) out.set(kk, vv);
    }
  }
  return out;
}
function pick(d: Dict, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Dict)[k] : undefined), d);
}
/**
 * Placeholders de PRIMER nivel (`{x}` y `{n, plural, …}` ⇒ `n`). Las ramas del plural (`one {Guardar 1 cambio}`) son
 * texto traducido, no placeholders: se salta todo lo que esté dentro de una llave abierta.
 */
function placeholders(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') {
      if (depth === 0) {
        const m = /^\{\s*(\w+)\s*[,}]/.exec(s.slice(i));
        if (m) out.push(m[1]);
      }
      depth++;
    } else if (s[i] === '}') depth = Math.max(0, depth - 1);
  }
  return out.sort();
}

const NAMESPACES = ['wishlist', 'admin.m9.buyList', 'admin.m10.wishlist', 'sealed.restock'];

describe('WSH-UX-12 · paridad es/en con los mismos placeholders', () => {
  for (const ns of NAMESPACES) {
    it(ns, () => {
      const a = leaves(pick(es as Dict, ns));
      const b = leaves(pick(en as Dict, ns));
      expect(a.size).toBeGreaterThan(0);
      expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
      for (const [k, v] of a) expect(placeholders(v), `${ns}.${k}`).toEqual(placeholders(b.get(k)!));
    });
  }

  it('sueltas: pestaña de M9 y el dial de M11', () => {
    expect(typeof es.admin.m9.tabs.buyList).toBe('string');
    expect(typeof en.admin.m9.tabs.buyList).toBe('string');
    for (const k of ['sealedRestockMaxPendingPerEmail', 'sealedRestockMaxPendingPerEmailHelp'] as const) {
      expect(typeof es.admin.m11.dialsPanel.settings[k]).toBe('string');
      expect(typeof en.admin.m11.dialsPanel.settings[k]).toBe('string');
    }
  });

  it('las claves de la tabla WSH-UX.12 del diseño están (muestra de las que llevan placeholder)', () => {
    const must = [
      'wishlist.block.add',
      'wishlist.block.count',
      'wishlist.block.inList',
      'wishlist.block.pctPesos',
      'wishlist.maxToday',
      'wishlist.full.title',
      'wishlist.account.summary',
      'wishlist.page.subtitle',
      'wishlist.page.searchCount',
      'wishlist.row.available',
      'wishlist.row.removeLabel',
      'admin.m9.buyList.dials',
      'admin.m9.buyList.filtered',
      'admin.m9.buyList.marginLoss',
      'admin.m9.buyList.wanted',
      'sealed.restock.signedInAs',
    ];
    for (const k of must) expect(typeof pick(es as Dict, k), k).toBe('string');
  });
});

describe('Errata v1.87.1 · se retiran las soluciones temporales del diseño', () => {
  it('sin `wishlist.ivaIncluded` (el rótulo sale de `IvaLabel` con `ivaRatePct`)', () => {
    expect(pick(es as Dict, 'wishlist.ivaIncluded')).toBeUndefined();
    expect(pick(en as Dict, 'wishlist.ivaIncluded')).toBeUndefined();
  });
  it('sin `wishlist.block.noPesosYet` (ahora hay pesos antes de guardar: `GET /wishlist/preview`)', () => {
    expect(pick(es as Dict, 'wishlist.block.noPesosYet')).toBeUndefined();
    expect(pick(en as Dict, 'wishlist.block.noPesosYet')).toBeUndefined();
  });
});

describe('WSH-UX-11 · el máximo nunca se lee como precio (WSH-1)', () => {
  const BAD = [/precio especial/i, /tu precio/i, /te la dejamos/i, /special price/i, /your price/i];
  for (const [lang, dict] of [
    ['es', es],
    ['en', en],
  ] as const) {
    it(lang, () => {
      for (const [k, v] of leaves(pick(dict as Dict, 'wishlist'))) {
        for (const re of BAD) expect(v, `wishlist.${k}`).not.toMatch(re);
      }
    });
  }
});

describe('P66-3 · sin códigos internos en los textos', () => {
  it('ningún «WSH», «M-74» ni «P-WSH»', () => {
    for (const dict of [es, en]) {
      for (const ns of NAMESPACES) {
        for (const [k, v] of leaves(pick(dict as Dict, ns))) {
          expect(v, `${ns}.${k}`).not.toMatch(/WSH|M-74|P-WSH/);
        }
      }
    }
  });
});

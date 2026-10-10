import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { codigoDe } from './strip-comments';

/**
 * Candados de fuente y de texto de §MIV (v1.90⟨miv⟩): `API_CONTRACT §MIV.7` (MIV-F7, MIV-F8) y
 * `DESIGN_SYSTEM §MIV.8` (MIV-UX-4, MIV-UX-5) + la tabla de textos `§MIV.6`.
 *
 * - **MIV-F7**: las dos fichas y la tendencia no leen el NETO (`referenceMxnCents`, `valueMxnCents`,
 *   `absMxnCents`) fuera de comentarios, no escriben `1.16` ni hacen cuentas con `ivaRatePct`; y
 *   `referenceDisplayCents` solo vive en esas dos fichas, `types/contract.ts` y `lib/mock/`.
 * - **MIV-F8 (texto)**: paridad es/en (claves y placeholders) de toda clave tocada por §MIV.
 * - **MIV-UX-4**: las cinco claves de la lista de deseos dicen «sin IVA» / «before VAT»; `pctPesos`,
 *   `maxToday` y `row.today` no cambian.
 * - **MIV-UX-5**: el aviso de estimados PSA de la ficha dice «sin IVA» / «before VAT»; el del badge no.
 */

const SRC = join(process.cwd(), 'src');
const STORE = join(SRC, 'app', '[locale]', '(storefront)');
const VIEWS = {
  CardDetailView: join(STORE, 'catalog', '[cardId]', 'CardDetailView.tsx'),
  SealedDetailView: join(STORE, 'sellado', '[inventoryItemId]', 'SealedDetailView.tsx'),
  SealedValueTrend: join(STORE, 'sellado', '[inventoryItemId]', 'SealedValueTrend.tsx'),
};

describe('MIV-F7 · las superficies de §MIV no leen el neto ni cuentan', () => {
  for (const [name, file] of Object.entries(VIEWS)) {
    it(`${name}: sin referenceMxnCents / valueMxnCents / absMxnCents, sin 1.16, sin cuentas con ivaRatePct`, () => {
      expect(existsSync(file), `falta ${file}`).toBe(true);
      const code = codigoDe(file, name);
      expect(code).not.toMatch(/\breferenceMxnCents\b/);
      expect(code).not.toMatch(/\bvalueMxnCents\b/);
      expect(code).not.toMatch(/\babsMxnCents\b/);
      expect(code).not.toMatch(/\b1\.16\b/);
      expect(code).not.toMatch(/\bivaRatePct\s*[*/+-]/);
      expect(code).not.toMatch(/[*/+-]\s*[\w.?]*\bivaRatePct\b/);
    });
  }

  it('las dos fichas SÍ leen `referenceDisplayCents` y la tendencia `displayValueMxnCents`/`displayAbsMxnCents`', () => {
    expect(codigoDe(VIEWS.CardDetailView)).toMatch(/\breferenceDisplayCents\b/);
    expect(codigoDe(VIEWS.SealedDetailView)).toMatch(/\breferenceDisplayCents\b/);
    const trend = codigoDe(VIEWS.SealedValueTrend);
    expect(trend).toMatch(/\bdisplayValueMxnCents\b/);
    expect(trend).toMatch(/\bdisplayAbsMxnCents\b/);
  });

  it('`referenceDisplayCents` solo aparece en las dos fichas, `types/contract.ts` y `lib/mock/` (código, sin pruebas)', () => {
    const allowed = new Set([
      relative(SRC, VIEWS.CardDetailView),
      relative(SRC, VIEWS.SealedDetailView),
      join('types', 'contract.ts'),
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        if (statSync(abs).isDirectory()) {
          walk(abs);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue;
        const rel = relative(SRC, abs);
        if (allowed.has(rel) || rel.startsWith(join('lib', 'mock') + sep) || rel.startsWith(`test${sep}`)) continue;
        if (/\breferenceDisplayCents\b/.test(codigoDe(abs, rel))) offenders.push(rel);
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

type Dict = Record<string, unknown>;
function pick(d: Dict, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Dict)[k] : undefined), d);
}
function placeholders(s: string): string[] {
  return [...s.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]).sort();
}

/** `DESIGN_SYSTEM §MIV.6` — claves modificadas, con el texto final es/en. */
const MIV6: Record<string, { es: string; en: string }> = {
  'card.referenceExplainerWithMarket': {
    es: 'El valor de mercado es la referencia del día y se muestra con IVA incluido, igual que nuestro precio de venta, para que los compares tal cual. El precio de venta se calcula a partir de esa referencia.',
    en: "Market value is the day's reference, shown with VAT included just like our sale price, so you can compare them directly. The sale price is derived from that reference.",
  },
  'sealed.trend.marketRefNote': {
    es: 'Con base en el valor de mercado de referencia (TCGCSV), actualizado a diario.',
    en: 'Based on the reference market value (TCGCSV), updated daily.',
  },
  'wishlist.block.pctLegend': {
    es: '¿Hasta cuánto más del precio de mercado sin IVA pagarías?',
    en: 'How much above the market price before VAT would you pay?',
  },
  'wishlist.block.inList': {
    es: 'Está en tu lista · {finish} · hasta {pct} % sobre mercado sin IVA',
    en: "It's on your wishlist · {finish} · up to {pct}% above market before VAT",
  },
  'wishlist.approxHelp': {
    es: 'Tu máximo sale del precio de mercado sin IVA más el porcentaje que elegiste, y ya incluye IVA. Lo recalculamos el día en que consigamos la carta, así que puede subir o bajar.',
    en: 'Your max comes from the market price before VAT plus the percentage you chose, and it already includes VAT. We recalculate it on the day we get the card, so it may go up or down.',
  },
  'wishlist.recalcNote': {
    es: 'Se recalcula con el precio de mercado sin IVA del día en que la consigamos.',
    en: "It's recalculated with the market price before VAT on the day we get it.",
  },
  'wishlist.row.maxPct': {
    es: 'Tu máximo: hasta {pct} % sobre mercado sin IVA',
    en: 'Your max: up to {pct}% above market before VAT',
  },
  'catalog.gradingEstimate.microNotice': {
    es: '<b>Cifra ilustrativa</b> de mercado, sin IVA (lo que se ha pagado por esa carta ya gradeada por terceros). <b>No evaluamos el estado de esta carta</b> ni garantizamos ningún grado; el gradeo y su costo corren por tu cuenta.',
    en: "<b>Illustrative</b> market figure before VAT (what that card has sold for once graded by third parties). <b>We have not assessed this card's condition</b> and guarantee no grade; grading and its cost are on you.",
  },
};

describe('§MIV.6 · textos finales es/en (criterio 868)', () => {
  for (const [key, want] of Object.entries(MIV6)) {
    it(key, () => {
      expect(pick(es as Dict, key)).toBe(want.es);
      expect(pick(en as Dict, key)).toBe(want.en);
    });
  }

  it('MIV-F8 · paridad de placeholders en cada clave tocada (y en `common.ivaIncluded` / `common.ivaIncludedBare`)', () => {
    for (const key of [...Object.keys(MIV6), 'common.ivaIncluded', 'common.ivaIncludedBare']) {
      const a = pick(es as Dict, key);
      const b = pick(en as Dict, key);
      expect(typeof a, key).toBe('string');
      expect(typeof b, key).toBe('string');
      expect(placeholders(a as string), key).toEqual(placeholders(b as string));
    }
  });

  /**
   * vMIV-2 (§MIV.10): el rótulo del MERCADO ya NO reutiliza `common.ivaIncluded`; nace UNA clave nueva
   * `common.ivaIncludedBare` = «incluye IVA» / «VAT included» (sin tasa). Este candado protege:
   *  - que la clave exista con el texto exacto del dueño, en los dos idiomas (sin placeholders: la variante
   *    sin tasa no lleva `{rate}`);
   *  - que NO reaparezcan las claves legadas prohibidas (un rótulo de mercado fuera del punto único);
   *  - que `common.ivaIncluded` (el rótulo del PRECIO) siga con su tasa.
   */
  it('vMIV-2 · `common.ivaIncludedBare` = «incluye IVA»/«VAT included» (sin tasa); el precio conserva `{rate}`', () => {
    expect(pick(es as Dict, 'common.ivaIncludedBare')).toBe('incluye IVA');
    expect(pick(en as Dict, 'common.ivaIncludedBare')).toBe('VAT included');
    // La variante sin tasa NO lleva placeholder.
    expect(placeholders(pick(es as Dict, 'common.ivaIncludedBare') as string)).toEqual([]);
    expect(placeholders(pick(en as Dict, 'common.ivaIncludedBare') as string)).toEqual([]);
    // El PRECIO sigue con su tasa.
    expect(placeholders(pick(es as Dict, 'common.ivaIncluded') as string)).toEqual(['rate']);
    // ⛔ ninguna clave de mercado fuera del punto único (`IvaLabel`).
    for (const d of [es, en] as Dict[]) {
      expect(JSON.stringify(d)).not.toMatch(/"marketIvaNote"|"ivaIncludedMarket"/);
    }
  });

  it('⛔ ningún texto tocado afirma algo jurídico ni vende el máximo como precio', () => {
    const BAD = [/traslad/i, /conforme a la ley/i, /\bSAT\b/, /by law/i, /tu precio/i, /your price/i, /precio especial/i, /special price/i];
    for (const [key, v] of Object.entries(MIV6)) for (const re of BAD) {
      expect(v.es, key).not.toMatch(re);
      expect(v.en, key).not.toMatch(re);
    }
  });
});

describe('MIV-UX-4 · lista de deseos: el % es sobre el mercado SIN IVA; los pesos no cambian de texto', () => {
  const FIVE = [
    'wishlist.block.pctLegend',
    'wishlist.block.inList',
    'wishlist.approxHelp',
    'wishlist.recalcNote',
    'wishlist.row.maxPct',
  ];
  it('las cinco dicen «sin IVA» (es) y «before VAT» (en)', () => {
    for (const k of FIVE) {
      expect(pick(es as Dict, k), k).toMatch(/sin IVA/);
      expect(pick(en as Dict, k), k).toMatch(/before VAT/);
    }
  });
  it('`pctPesos`, `maxToday` y `row.today` NO mencionan la base (llevan el rótulo de IVA al lado)', () => {
    for (const k of ['wishlist.block.pctPesos', 'wishlist.maxToday', 'wishlist.row.today']) {
      expect(typeof pick(es as Dict, k), k).toBe('string');
      expect(pick(es as Dict, k), k).not.toMatch(/IVA/);
      expect(pick(en as Dict, k), k).not.toMatch(/VAT/);
    }
  });
});

describe('MIV-UX-5 · estimados PSA: sin IVA en la ficha; el badge no cambia (tope §22.4c)', () => {
  it('ficha: «sin IVA» / «before VAT»', () => {
    expect(pick(es as Dict, 'catalog.gradingEstimate.microNotice')).toMatch(/sin IVA/);
    expect(pick(en as Dict, 'catalog.gradingEstimate.microNotice')).toMatch(/before VAT/);
  });
  it('badge: sin cambio', () => {
    expect(pick(es as Dict, 'catalog.gradingBadge.microNotice')).toBe('<b>Ilustrativo</b>; <b>no evaluamos esta carta</b>.');
    expect(pick(en as Dict, 'catalog.gradingBadge.microNotice')).toBe("<b>Illustrative</b>; <b>we haven't assessed this card</b>.");
  });
});

/**
 * C-F8 (API_CONTRACT §MKT.H.11, v1.106) — `measurementItemOf` rinde EXACTAMENTE las filas entre los
 * marcadores `MKT-ITEM-ID` de §MKT.H.4 (se leen del contrato, no se copian), y las fichas y el checkout
 * la usan (no arman `item_id` a mano).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { measurementItemOf, type MeasurementItemFacts } from './item';
import { itemsFromQuote } from './ecommerce';

const ROOT = resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const CONTRACT = read('docs/API_CONTRACT.md');

function contractRows(): Array<{ facts: MeasurementItemFacts; item_id: string; item_name: string; item_category: string }> {
  const m = CONTRACT.match(/<!-- MKT-ITEM-ID:start -->([\s\S]*?)<!-- MKT-ITEM-ID:end -->/);
  if (!m) throw new Error('marcadores MKT-ITEM-ID no encontrados en API_CONTRACT.md');
  return m[1]
    .split('\n')
    .filter((l) => l.startsWith('| `{'))
    .map((l) => {
      const cells = [...l.matchAll(/`([^`]*)`/g)].map((c) => c[1]);
      if (cells.length !== 4) throw new Error(`fila con ${cells.length} celdas: ${l}`);
      return { facts: JSON.parse(cells[0]), item_id: cells[1], item_name: cells[2], item_category: cells[3] };
    });
}

describe('C-F8 · measurementItemOf = la tabla de §MKT.H.4', () => {
  const rows = contractRows();

  it('la tabla tiene filas (si se vacía, la prueba no prueba nada)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  for (const r of rows) {
    it(`${JSON.stringify(r.facts)} ⇒ ${r.item_id}`, () => {
      expect(measurementItemOf(r.facts)).toEqual({ item_id: r.item_id, item_name: r.item_name, item_category: r.item_category });
    });
  }

  it('sin cardId la línea no viaja', () => {
    expect(measurementItemOf({ name: 'x', productType: 'raw' })).toBeNull();
    expect(measurementItemOf({ cardId: '', name: 'x', productType: 'sealed', sealedProductId: 'sp-1' })).toBeNull();
  });
});

describe('C-F8 · cotización/purchase (`itemsFromQuote`)', () => {
  const card = (over: Record<string, unknown>) =>
    ({ cardId: 'sv3-1', name: 'ETB Obsidian Flames', setName: 'Obsidian Flames', number: '1', productType: 'sealed', rawCondition: null, gradingCompany: null, gradeValue: null, imageSmallUrl: null, ...over }) as never;
  it('sellado ligado ⇒ s_, sin ligar ⇒ sc_, carta ⇒ c_ con set; sin cardId no viaja', () => {
    const items = itemsFromQuote([
      { inventoryItemId: 'inv-1', unitPriceCents: 12000, card: card({ sealedProductId: 'sp-9' }) },
      { inventoryItemId: 'inv-2', unitPriceCents: 9900, card: card({ sealedProductId: null }) },
      { inventoryItemId: 'inv-3', unitPriceCents: 500, card: card({ cardId: 'sv3-125', name: 'Charizard ex', productType: 'raw' }) },
      { inventoryItemId: 'inv-4', unitPriceCents: 500, card: card({ cardId: '' }) },
    ]);
    expect(items).toEqual([
      { item_id: 's_sp-9', item_name: 'ETB Obsidian Flames', item_category: 'sealed', price: 120 },
      { item_id: 'sc_sv3-1', item_name: 'ETB Obsidian Flames', item_category: 'sealed', price: 99 },
      { item_id: 'c_sv3-125', item_name: 'Charizard ex · Obsidian Flames', item_category: 'card', price: 5 },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/inv-/);
  });
});

describe('C-F8 · las superficies usan measurementItemOf (no arman item_id a mano)', () => {
  const FILES = [
    'frontend/src/lib/measurement/ecommerce.ts',
    'frontend/src/app/[locale]/(storefront)/sellado/[inventoryItemId]/SealedDetailView.tsx',
    'frontend/src/app/[locale]/(storefront)/catalog/[cardId]/CardDetailView.tsx',
  ];
  for (const f of FILES) {
    it(f, () => {
      const src = read(f);
      expect(src).toMatch(/measurementItemOf\(/);
      expect(src).not.toMatch(/item_id\s*:/);
      expect(src).not.toMatch(/representativeItemId\s*,\s*item_name/);
    });
  }
});

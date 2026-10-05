import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * **UX-SP-16** (`DESIGN_SYSTEM §70.7`, textos de `§70.5` v6.1): cada clave nueva o cambiada del precio del sellado está
 * en `es` **y** en `en`, y las retiradas en v6.1 no quedan en ninguno (huérfanas = un texto que alguien acabará
 * pintando). Canario: borrar una en `en.json`, o dejar `col.display`.
 */
type Tree = { [k: string]: string | Tree };

function get(catalog: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, k) => (node && typeof node === 'object' ? (node as Tree)[k] : undefined), catalog);
}

const SHEET = [
  'title', 'subtitle', 'filters.set', 'filters.allSets', 'filters.search', 'filters.scopeLegend', 'filters.onHand',
  'filters.all', 'col.product', 'col.pieces', 'col.cost', 'col.owner', 'col.automatic', 'col.effective', 'col.net',
  'col.netHelp', 'net.rate', 'col.market', 'col.margin', 'col.marginHelp', 'pieces.inStock', 'pieces.listed',
  'pieces.reserved', 'pieces.none', 'cost.range', 'cost.without', 'cost.none', 'owner.none', 'automatic.subtype',
  'automatic.global', 'automatic.none', 'origin.product', 'origin.automatic', 'origin.pending', 'market.asOf',
  'margin.loss', 'margin.noPrice', 'margin.noCost', 'inactive', 'legacy.shadowed', 'legacy.active', 'legacy.fix',
  'unlinked', 'empty', 'emptyCta', 'emptyFiltered', 'clearFilters', 'pageInfo', 'prev', 'next', 'footOwner',
].map((k) => `admin.m11.priceSheet.${k}`);

const EDITOR = [
  'blockTitle', 'blockTitleNoCount', 'withVat', 'staffNote', 'set', 'change', 'setProduct', 'changeProduct', 'setAria',
  'changeAria', 'label', 'hint', 'appliesTo', 'appliesToAll', 'marginPreview', 'save', 'confirm.title',
  'confirm.nowOwner', 'confirm.nowAuto', 'confirm.nowNone', 'confirm.new', 'confirm.effect', 'confirm.reserved',
  'confirm.legacy', 'confirm.note', 'confirm.save', 'done.saved', 'done.published', 'done.missingLocation',
  'done.notPublished', 'done.autoPublishFailed', 'done.seeQueue', 'errors.conflict', 'errors.conflictNone',
  'errors.forbidden', 'errors.notFound', 'errors.perProduct', 'errors.perProductLink', 'errors.ownerOnly', 'reload',
  'piece.product', 'piece.legacy', 'piece.legacyHelp', 'piece.automatic', 'piece.pending', 'piece.unlinkedStaff',
].map((k) => `admin.sealedProductPrice.${k}`);

const OTHER = [
  'admin.m11.inventory.subtitle',
  'admin.m11.subtitle',
  'admin.m1.publishQueue.reason.sealedNoPrice',
  'admin.m1.publishQueue.sealedPriceLink',
  'admin.m1.detail.sealedPriceByProduct',
  'admin.m1.detail.seeSheet',
  'admin.m1.publish.sealedPricePending',
  'admin.m1.publish.priceRequiredSealed',
  'admin.m1.publish.priceLabelSealed',
  'admin.sealedAdd.manualMarket.staffNoMarket',
  'admin.sealedAdd.manualMarket.pendingIfEmptyStaff',
  'admin.m10.ivaTransfer.delta.sealedOwnerPrice',
  'admin.sealedFinalPrice.storePrice',
];

const RETIRED = [
  'admin.m11.priceSheet.col.display',
  'admin.m11.priceSheet.col.displayHelp',
  'admin.sealedProductPrice.beforeVat',
  'admin.sealedProductPrice.confirm.publishToo',
  'admin.sealedProductPrice.done.stillBoxed',
];

describe('UX-SP-16 · paridad de los textos del precio del sellado (§70.5)', () => {
  it.each([...SHEET, ...EDITOR, ...OTHER])('%s existe en es y en', (path) => {
    expect(typeof get(es, path), `es ${path}`).toBe('string');
    expect(typeof get(en, path), `en ${path}`).toBe('string');
    expect((get(es, path) as string).trim()).not.toBe('');
    expect((get(en, path) as string).trim()).not.toBe('');
  });

  it.each(RETIRED)('%s retirada: en ninguno', (path) => {
    expect(get(es, path)).toBeUndefined();
    expect(get(en, path)).toBeUndefined();
  });

  it('regla dura 2: el rótulo del editor y las columnas de precio dicen «con IVA» / «VAT incl.»', () => {
    for (const p of ['admin.sealedProductPrice.label', 'admin.m11.priceSheet.col.owner', 'admin.m11.priceSheet.col.effective']) {
      expect(get(es, p) as string).toMatch(/con IVA/);
      expect(get(en, p) as string).toMatch(/VAT incl\./);
    }
  });

  it('A-4: el porqué del automático dice «antes de IVA» (no sugiere P = mercado + s %)', () => {
    for (const p of ['admin.m11.priceSheet.automatic.subtype', 'admin.m11.priceSheet.automatic.global']) {
      expect(get(es, p) as string).toMatch(/antes de IVA/);
      expect(get(en, p) as string).toMatch(/before VAT/);
    }
  });
});

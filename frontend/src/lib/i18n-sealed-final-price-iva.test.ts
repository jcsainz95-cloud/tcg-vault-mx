import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * **UX-SP-18 · D-SP-5** (`DESIGN_SYSTEM §70.5`, fila SP-F-8b). El editor `SealedFinalPrice` escribe `listPriceCents`
 * (`L`, ANTES de IVA) y la tienda cobra encima el IVA trasladado. Sus textos decían «Precio final» y «Se publica en la
 * tienda a {price}» con `{price}` = `L`: un precio que el cliente no paga. Este candado fija que:
 * - ningún valor de `admin.sealedFinalPrice.*` (es y en) dice «precio final» / «final price», en ninguna caja;
 * - `confirm.effectPublish` menciona el IVA (`IVA` / `VAT`);
 * - `label` dice «antes de IVA» / «before VAT».
 * Canario: restaurar «Precio final (MXN)» en `label`.
 */
type Tree = { [k: string]: string | Tree };

function leaves(node: Tree, prefix = ''): Array<[string, string]> {
  return Object.entries(node).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`),
  );
}

const block = (catalog: unknown): Tree => (catalog as { admin: { sealedFinalPrice: Tree } }).admin.sealedFinalPrice;

describe('UX-SP-18 · admin.sealedFinalPrice.* no llama «precio final» a un precio antes de IVA', () => {
  it.each([
    ['es', es],
    ['en', en],
  ])('%s: ningún texto dice «precio final» / «final price»', (_locale, catalog) => {
    const all = leaves(block(catalog));
    expect(all.length).toBeGreaterThan(20);
    const offenders = all.filter(([, v]) => /precio\s+final|final\s+price/i.test(v)).map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it('confirm.effectPublish menciona el IVA trasladado', () => {
    const esB = block(es) as { confirm: Tree };
    const enB = block(en) as { confirm: Tree };
    expect(esB.confirm.effectPublish).toMatch(/IVA/);
    expect(enB.confirm.effectPublish).toMatch(/VAT/);
  });

  it('label dice «antes de IVA» / «before VAT»', () => {
    expect(block(es).label).toMatch(/antes de IVA/);
    expect(block(en).label).toMatch(/before VAT/);
  });
});

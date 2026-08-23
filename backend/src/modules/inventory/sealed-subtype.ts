import { SealedSubtype } from '@prisma/client';

/**
 * v1.39-sealed-product-module (M-39, P-38, §4.34c) — heurística de nombre → `SealedSubtype`, con el
 * ORDEN NORMATIVO (el orden IMPORTA). Conservadora: solo empata patrones claros; ante duda devuelve
 * `null` para que el operador cure el subtipo (JAMÁS se adivina de más). Cambios sobre la de P-35:
 *  - **`upc` ANTES que ETB/collection** (contiene «collection») — pedido explícito del humano.
 *  - **`collection`** (Premium/Special Collection, cajas genéricas) que antes caía a `null` o `box`.
 * Reemplaza a la de `sealed-catalog-admin.service.ts` (que la re-exporta para no divergir).
 */
export function inferSealedSubtype(name: string): SealedSubtype | null {
  const n = name.toLowerCase();
  // 1. UPC (Ultra Premium Collection) — antes que ETB y collection (contiene «collection»).
  if (n.includes('ultra premium collection') || /\bupc\b/.test(n)) return 'upc';
  // 2. Elite Trainer Box.
  if (n.includes('elite trainer box') || /\betb\b/.test(n)) return 'etb';
  // 3. Booster Bundle — antes que box.
  if (n.includes('booster bundle') || /\bbundle\b/.test(n)) return 'bundle';
  // 4. Booster Box / Booster Case.
  if (n.includes('booster box') || n.includes('booster case')) return 'box';
  // 5. Tin.
  if (/\btin\b/.test(n)) return 'tin';
  // 6. Blíster / sleeved booster / checklane / 3-pack.
  if (
    n.includes('blister') ||
    n.includes('sleeved booster') ||
    n.includes('checklane') ||
    /\b3[- ]?pack\b/.test(n)
  ) {
    return 'blister';
  }
  // 7. Colecciones / cajas especiales genéricas (Premium/Special Collection, «... Box»).
  if (
    n.includes('premium collection') ||
    n.includes('special collection') ||
    /\bcollection\b/.test(n) ||
    /\bbox\b/.test(n)
  ) {
    return 'collection';
  }
  // 8. Sin match → null (el operador elige al curar).
  return null;
}

/** Metadatos por subtipo: `isPrincipal` (cabecera), `sortOrder` canónico y `label` legible (§4.34c). */
export interface SealedSubtypeMeta {
  isPrincipal: boolean;
  sortOrder: number;
  label: string;
}

/**
 * §4.34c — «Principales» (cabecera, se muestran primero en el alta) = `box, etb, upc, bundle`;
 * secundarias = `tin, blister, collection`. `sortOrder` canónico:
 * `upc=0, etb=1, box=2, bundle=3, tin=4, blister=5, collection=6`. El default derivado es CURABLE por
 * pieza (`SealedProduct.isPrincipal` es columna; el sync setea el default y el humano puede overridear).
 */
export const SEALED_SUBTYPE_META: Record<SealedSubtype, SealedSubtypeMeta> = {
  upc: { isPrincipal: true, sortOrder: 0, label: 'Ultra Premium Collection' },
  etb: { isPrincipal: true, sortOrder: 1, label: 'Elite Trainer Box' },
  box: { isPrincipal: true, sortOrder: 2, label: 'Booster Box' },
  bundle: { isPrincipal: true, sortOrder: 3, label: 'Booster Bundle' },
  tin: { isPrincipal: false, sortOrder: 4, label: 'Tin' },
  blister: { isPrincipal: false, sortOrder: 5, label: 'Blíster' },
  collection: { isPrincipal: false, sortOrder: 6, label: 'Colección' },
};

/** Fallback de `sortOrder` cuando el subtype no está en el mapa (defensivo; queda al final). */
export const SEALED_SORT_ORDER_FALLBACK = 99;

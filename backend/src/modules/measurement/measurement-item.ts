/**
 * measurement-item.ts — identidad canónica de ítem de la medición (API_CONTRACT v1.106 §MKT.H.4, R4). PURA.
 *
 * Es la ÚNICA del servidor: el drenador (`items` de GA4 MP y `content_ids` de CAPI) y el panel (d1/d2, que cruzan
 * `itemId` de GA4 con las ventas de BD) la importan. El navegador tiene su gemela en `frontend/src/lib/measurement/`;
 * las dos se prueban contra la MISMA tabla del contrato (marcadores `MKT-ITEM-ID`, C-B10 / C-F8).
 *
 *  - carta (raw/graded): `c_<cardId>`, nombre `name · setName` (sin set ⇒ `name`), categoría `card`.
 *  - sellado ligado: `s_<sealedProductId>`; sin ligar: `sc_<cardId ancla>`. Nombre = el resuelto (§4.34a), sin set.
 *  - accesorio: `a_<accessoryId>`, si no `m_<metaDeckId>`.
 *  - sin identidad (carta sin `cardId`, accesorio sin ninguno de los dos) ⇒ `null`: la línea no viaja.
 * ⛔ Nunca `orderNumber` ni un `inventoryItemId` (el representante cambia al vender).
 *
 * ⚠ SE EJECUTA SIN COMPILAR (TL-MKT2b-b): la prueba cruzada del frontend (`frontend/src/lib/measurement/item.cross.test.ts`)
 * lo importa en un `node` que solo quita los tipos. Por eso aquí: solo `import type` (ningún import de valor, tampoco
 * `import { type X }`) y solo sintaxis que se borra (sin `enum`, `namespace`, propiedades de parámetro, decoradores,
 * `import x = require`/`export =`). Lo cobra el jest del backend: `test/measurement.item-erasable.spec.ts`.
 */
import type { PersistedCardFacts } from '../orders/order-item-card';
import type { ItemCategory } from './measurement-bodies';

export interface MeasurementItemIdentity {
  item_id: string;
  item_name: string;
  item_category: ItemCategory;
}

/** Línea de accesorio (solo servidor). */
export interface AccessoryItemFacts {
  kind: 'accessory';
  accessoryId?: string | null;
  metaDeckId?: string | null;
  name?: string | null;
}

export type MeasurementItemFacts = PersistedCardFacts | AccessoryItemFacts;

/** Prefijo ⇒ tabla de origen (d1/d2 parten el `itemId` de GA4 por aquí). */
export const ITEM_ID_PREFIX = { card: 'c_', sealed: 's_', sealedAnchor: 'sc_', accessory: 'a_', metaDeck: 'm_' } as const;

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export function measurementItemOf(facts: MeasurementItemFacts): MeasurementItemIdentity | null {
  if ('kind' in facts && facts.kind === 'accessory') {
    const name = facts.name ?? '';
    if (nonEmpty(facts.accessoryId)) return { item_id: `${ITEM_ID_PREFIX.accessory}${facts.accessoryId}`, item_name: name, item_category: 'accessory' };
    if (nonEmpty(facts.metaDeckId)) return { item_id: `${ITEM_ID_PREFIX.metaDeck}${facts.metaDeckId}`, item_name: name, item_category: 'accessory' };
    return null;
  }
  const f = facts as PersistedCardFacts;
  const name = f.name ?? '';
  if (f.productType === 'sealed') {
    if (nonEmpty(f.sealedProductId)) return { item_id: `${ITEM_ID_PREFIX.sealed}${f.sealedProductId}`, item_name: name, item_category: 'sealed' };
    if (nonEmpty(f.cardId)) return { item_id: `${ITEM_ID_PREFIX.sealedAnchor}${f.cardId}`, item_name: name, item_category: 'sealed' };
    return null;
  }
  if (!nonEmpty(f.cardId)) return null;
  return { item_id: `${ITEM_ID_PREFIX.card}${f.cardId}`, item_name: f.setName ? `${name} · ${f.setName}` : name, item_category: 'card' };
}

/** `itemId` de GA4 ⇒ tabla e id (o `null` si no es canónico). */
export function parseMeasurementItemId(itemId: string): { table: 'card' | 'sealedProduct' | 'sealedAnchor'; id: string } | null {
  const tables = [
    [ITEM_ID_PREFIX.sealedAnchor, 'sealedAnchor'],
    [ITEM_ID_PREFIX.sealed, 'sealedProduct'],
    [ITEM_ID_PREFIX.card, 'card'],
  ] as const;
  for (const [prefix, table] of tables) {
    if (itemId.startsWith(prefix) && itemId.length > prefix.length) return { table, id: itemId.slice(prefix.length) };
  }
  return null;
}

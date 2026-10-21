/**
 * API_CONTRACT §MKT.H.4 (v1.106, R4) — identidad canónica de ítem: la MISMA en el navegador (todos los
 * eventos) y en el servidor (MP y `content_ids` de CAPI). Espejo de `measurementItemOf` del backend;
 * las dos se prueban con la tabla de casos del contrato (C-F8 aquí, C-B10 allá).
 *
 * Entradas (contrato): ficha de carta `{cardId: card.id, name, setName, productType:'raw'}`; ficha de
 * sellado `{cardId: group.card.id, name: group.productName, productType:'sealed', sealedProductId}`;
 * cotización/`purchase` `OrderItemPreview.card`.
 *
 * - carta (raw/graded): `c_<cardId>`, nombre `name · setName` (o `name` sin set);
 * - sellado ligado: `s_<sealedProductId>`; sin ligar: `sc_<cardId ancla>`; nombre = el resuelto, sin set;
 * - carta sin `cardId`, o sellado sin ligar y sin ancla ⇒ `null`: la línea no viaja. Accesorios (`a_`/`m_`) solo salen del servidor.
 * ⛔ Nunca un `inventoryItemId` (`representativeItemId` cambia al vender) ni `orderNumber`.
 */

export interface MeasurementItemFacts {
  cardId?: string | null;
  name?: string | null;
  setName?: string | null;
  productType?: string | null;
  sealedProductId?: string | null;
}

export interface MeasurementItem {
  item_id: string;
  item_name: string;
  item_category: 'card' | 'sealed';
}

export function measurementItemOf(facts: MeasurementItemFacts): MeasurementItem | null {
  const cardId = typeof facts.cardId === 'string' ? facts.cardId : '';
  const name = typeof facts.name === 'string' ? facts.name : '';
  if (facts.productType === 'sealed') {
    // Sellado ligado: su identidad es el SealedProduct (no necesita ancla). Sin ligar: el ancla, o no viaja.
    const sp = typeof facts.sealedProductId === 'string' && facts.sealedProductId ? facts.sealedProductId : null;
    if (sp) return { item_id: `s_${sp}`, item_name: name, item_category: 'sealed' };
    return cardId ? { item_id: `sc_${cardId}`, item_name: name, item_category: 'sealed' } : null;
  }
  if (!cardId) return null;
  const setName = typeof facts.setName === 'string' && facts.setName ? facts.setName : null;
  return { item_id: `c_${cardId}`, item_name: setName ? `${name} · ${setName}` : name, item_category: 'card' };
}

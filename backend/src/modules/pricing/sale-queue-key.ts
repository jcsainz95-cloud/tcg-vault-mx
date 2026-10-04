import { Finish, InventoryItem, ProductType } from '@prisma/client';
import { GradeKeyInput, LooseGradeKeyInput } from './pricing.types';

/**
 * sale-queue-key.ts — **LA CLAVE DE COLA DE VENTA DE UNA PIEZA, EN UN SOLO SITIO** (D-1 del techlead
 * sobre `8a10153e`; API_CONTRACT §M2 `M2-VQ`, ARCHITECTURE §4.36.5 c-bis).
 *
 * ### Por qué existe
 * La cola de VENTA se escribe por una clave de SEIS componentes `(cardId, productType, gradeKey,
 * finish, cardProductId, sealedProductId)` — la del dedupe de `escalatePending`. Hasta aquí esa clave
 * se DERIVABA de una pieza en dos sitios (`InventoryService.derivePublishSalePrice`, que escala/cierra
 * al publicar, y `PriceSyncJobService.queueKeyOfItem`, que el barrido VQ usa para decidir qué fila
 * «sin motivo» sigue siendo necesaria) y se SERIALIZABA de dos formas (`|`.join con `''` en
 * inventario, `JSON.stringify` en el barrido). Si las dos derivaciones divergen, el barrido cierra
 * filas que la publicación volverá a abrir —o deja abiertas filas que nadie necesita— sin que ningún
 * test de un módulo solo lo vea. Ahora hay **una derivación** (`saleQueueKeyOf`) y **una
 * serialización** (`serializeSaleQueueKey`); la paridad la fija `test/pricing.sale-queue-key.parity.spec.ts`.
 *
 * ### Pureza
 * Es pura dada `SaleQueueKeyResolvers`, que en producción es el propio `PricingService` (sus tres
 * métodos son delegaciones puras a `pricing.types.ts`). Se reciben como parámetro —y no se importan
 * las funciones de `pricing.types` directamente— para que los dobles de prueba que ya sustituyen
 * `tryGradeKeyFor` sigan gobernando la clave en los dos llamadores por igual.
 */

/** Los tres resolutores de clave de precio que la derivación necesita (los de `PricingService`). */
export interface SaleQueueKeyResolvers {
  tryGradeKeyFor(item: LooseGradeKeyInput): string | null;
  sealedMarketGradeKeyForItem(item: { tcgplayerProductId: number | null }): string | null;
  gradeKeyFor(item: GradeKeyInput): string;
}

/** Lo que la derivación lee de una pieza (un `InventoryItem` lo cumple). */
export type SaleQueueKeyItem = Pick<
  InventoryItem,
  'cardId' | 'productType' | 'finish' | 'cardProductId' | 'sealedProductId' | 'tcgplayerProductId'
> &
  LooseGradeKeyInput;

/**
 * Clave de la cola de VENTA. Los seis componentes del dedupe de `escalatePending`.
 * ⚠️ `cardProductId` es el `Int` de TCGplayer (`InventoryItem`/`PendingPriceEntry`), no el uuid de
 * `PriceReference.cardProductId`. `null` = set base / no sellado.
 */
export interface SaleQueueKey {
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  finish: Finish;
  cardProductId: number | null;
  sealedProductId: string | null;
}

/**
 * Clave de cola de una pieza SELLADA: `(cardId, 'sealed', sealedMarketGradeKeyForItem ?? 'sealed',
 * 'normal', null, sealedProductId)`. El sellado no mapeado cae al gradeKey estructural `'sealed'`
 * (la clave del override MANUAL, §4.19d; SK-2). Nunca `null`.
 */
export function sealedSaleQueueKeyOf(
  item: Pick<SaleQueueKeyItem, 'cardId' | 'sealedProductId' | 'tcgplayerProductId'>,
  r: SaleQueueKeyResolvers,
): SaleQueueKey {
  return {
    cardId: item.cardId,
    productType: 'sealed',
    gradeKey: r.sealedMarketGradeKeyForItem(item) ?? r.gradeKeyFor({ productType: 'sealed' }),
    finish: 'normal',
    cardProductId: null,
    sealedProductId: item.sealedProductId ?? null,
  };
}

/**
 * Clave de cola de VENTA de una pieza — la MISMA con la que la publicación escala/cierra y con la
 * que el barrido VQ decide si una fila «sin motivo» sigue siendo necesaria.
 *
 * - sellado ⇒ `sealedSaleQueueKeyOf`;
 * - raw/graded ⇒ `(cardId, productType, tryGradeKeyFor, finish, cardProductId, null)`;
 * - graded sin identidad de slab ⇒ `null` (no hay variante que encolar ni que casar, §4.40.4c).
 */
export function saleQueueKeyOf(item: SaleQueueKeyItem, r: SaleQueueKeyResolvers): SaleQueueKey | null {
  if (item.productType === 'sealed') return sealedSaleQueueKeyOf(item, r);
  const gradeKey = r.tryGradeKeyFor(item);
  if (gradeKey == null) return null;
  return {
    cardId: item.cardId,
    productType: item.productType,
    gradeKey,
    finish: item.finish,
    cardProductId: item.cardProductId ?? null,
    sealedProductId: null,
  };
}

/**
 * LA serialización de la clave (para `Map`/`Set`). `JSON.stringify` de la tupla de seis con `null`
 * explícito: sin separador que pueda colisionar con un componente, y `undefined` ≡ `null` (ausente =
 * set base / no sellado, igual que normaliza `settlePendingForVariant`).
 */
export function serializeSaleQueueKey(k: {
  cardId: string;
  productType: ProductType | string;
  gradeKey: string;
  finish: Finish | string;
  cardProductId?: number | null;
  sealedProductId?: string | null;
}): string {
  return JSON.stringify([
    k.cardId,
    k.productType,
    k.gradeKey,
    k.finish,
    k.cardProductId ?? null,
    k.sealedProductId ?? null,
  ]);
}

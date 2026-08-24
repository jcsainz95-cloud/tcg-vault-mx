import type { GroupedListingDTO, GroupedListingSummaryDTO } from '../../src/modules/catalog/catalog.service';
import type { SealedGroupDTO, SealedGroupSummaryDTO } from '../../src/modules/catalog/sealed-catalog.service';

/**
 * dto-keys.ts — **las claves de un DTO se declaran UNA vez, y el COMPILADOR las mantiene completas.**
 *
 * ### El problema que resuelve (D-e, techlead)
 * `GROUPED_LISTING_KEYS` vivía duplicado en dos specs, escrito a mano y **sin vínculo con la interfaz
 * declarada**. O sea: la lista podía quedarse corta (que es literalmente B-1 — un campo requerido que
 * falta y nadie lo ve) o quedarse larga, y ninguna de las dos cosas rompía nada. Un candado de forma
 * cuya forma de referencia se mantiene a mano es un candado con la llave puesta.
 *
 * ### Cómo se cierra
 * `Record<keyof T, true>` obliga al compilador a exigir **todas** las claves de la interfaz y a
 * rechazar cualquiera que no exista. Añadir un campo al DTO y no añadirlo aquí **no compila**;
 * escribir aquí uno que el DTO no tiene, tampoco. Las listas de abajo son entonces la interfaz
 * declarada, proyectada a runtime — no una copia.
 *
 * ### Opcionales
 * `keyof T` incluye los opcionales, así que la lista es el conjunto **máximo**. Un DTO concreto puede
 * traer menos claves en el cable (un opcional ausente DESAPARECE en JSON). Por eso los specs comparan
 * contra `keysOf(...)` recortado al escenario (p. ej. un raw sin `gradingCompany`/`gradeValue`), con
 * el recorte EXPLÍCITO y visible en el test — que es donde la excepción debe leerse.
 */

/** Proyecta a runtime las claves de una interfaz, con el compilador exigiendo que estén TODAS. */
function keysOf<T extends object>(shape: Record<keyof T, true>): string[] {
  return Object.keys(shape).sort();
}

/** `GroupedListingDTO` — el DTO de la **FICHA** de singles (`GroupedListingDetailResponse.listings[]`). */
export const GROUPED_LISTING_KEYS = keysOf<GroupedListingDTO>({
  representativeInventoryItemId: true,
  card: true,
  productType: true,
  finish: true,
  rawCondition: true,
  gradeKey: true,
  gradingCompany: true,
  gradeValue: true,
  stockCount: true,
  salePriceCents: true,
  priceBasis: true,
  referenceValue: true,
  currency: true,
});

/** `GroupedListingSummaryDTO` — el DTO de la **REJILLA** de singles (v2.1.9 D2: sin las dos señales). */
export const GROUPED_LISTING_SUMMARY_KEYS = keysOf<GroupedListingSummaryDTO>({
  representativeInventoryItemId: true,
  card: true,
  productType: true,
  finish: true,
  rawCondition: true,
  gradeKey: true,
  gradingCompany: true,
  gradeValue: true,
  stockCount: true,
  salePriceCents: true,
  currency: true,
});

/** `SealedGroupDTO` — el DTO de la **FICHA** de sellado (`SealedGroupDetailResponse.group`). */
export const SEALED_GROUP_KEYS = keysOf<SealedGroupDTO>({
  representativeItemId: true,
  card: true,
  productName: true,
  imageUrl: true,
  sealedSubtype: true,
  sealedCondition: true,
  availableCount: true,
  fromPriceCents: true,
  priceSource: true,
  priceBasis: true,
  referenceValue: true,
  currency: true,
});

/** `SealedGroupSummaryDTO` — el DTO de la **REJILLA** de sellado (v2.1.9 D2: sin las TRES señales). */
export const SEALED_GROUP_SUMMARY_KEYS = keysOf<SealedGroupSummaryDTO>({
  representativeItemId: true,
  card: true,
  productName: true,
  imageUrl: true,
  sealedSubtype: true,
  sealedCondition: true,
  availableCount: true,
  fromPriceCents: true,
  currency: true,
});

/**
 * La forma se assertea sobre el objeto **SERIALIZADO** (`JSON.parse(JSON.stringify(dto))`), que es lo
 * que de verdad cruza el cable: un opcional ausente viaja como `undefined` en memoria pero
 * **desaparece** en JSON, igual que un requerido que falta — y ésa es exactamente la diferencia que
 * B-1 explotó. Comparar el objeto en memoria mezclaría las dos cosas.
 */
export const onWire = (dto: unknown) => JSON.parse(JSON.stringify(dto)) as Record<string, unknown>;

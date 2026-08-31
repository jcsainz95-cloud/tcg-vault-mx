import type {
  GradedEstimateDTO,
  GroupedListingDetailResponse,
  GroupedListingSummaryDTO,
} from '@/types/contract';

/**
 * «Gancho de grading» — predicados de render (contrato v1.44-graded-estimate, PROJECT §O,
 * DESIGN_SYSTEM §22). Este módulo es la ÚNICA fuente de verdad de «¿hay cifra que pintar?»:
 * lo consumen tanto los componentes que pintan la cifra como las páginas que deciden
 * hospedar la nota al pie, y eso es lo que hace verificable el acoplamiento R3.(3)
 * («llamada y nota bajo la MISMA condición»).
 *
 * Reglas del contrato que se implementan aquí:
 *  - **PRESENCIA ⇔ ELEGIBILIDAD**: no hay flag ni arreglo vacío. Campo ausente ⇒ no se pinta NADA
 *    (§22 R4: ni contenedor, ni encabezado, ni «—», ni $0, ni «pendiente», ni skeleton).
 *  - **Se ITERA leyendo `gradeValue`**: PROHIBIDO `[0]`, PROHIBIDO asumir orden o cantidad. Es lo
 *    que permite que el servidor añada o quite un grado (dial `grades`/`highlightGrades`) sin tocar
 *    el cliente ni el contrato.
 *  - **Nada del cálculo viaja** (§22 R5): aquí no hay multiplicador, ganancia, costo de gradeo ni
 *    margen — y tampoco se derivan. El gate de ROI es server-side y su única huella es la presencia
 *    de `gradingHighlight`.
 */

/** Una cifra es pintable solo si el dinero existe de verdad (money-safe, §O.4). */
function isRenderable(e: GradedEstimateDTO): boolean {
  return (
    !!e &&
    typeof e.gradeValue === 'string' &&
    e.gradeValue.length > 0 &&
    e.estimate?.status === 'priced' &&
    typeof e.estimate.referenceMxnCents === 'number' &&
    Number.isFinite(e.estimate.referenceMxnCents) &&
    e.estimate.referenceMxnCents > 0
  );
}

/**
 * Normaliza un arreglo del contrato a «lo que se puede pintar», o `null` si no queda nada.
 * `null` (y no `[]`) a propósito: obliga a la llamada a decidir «pinto / no pinto» y hace
 * imposible renderizar un contenedor vacío por descuido.
 */
export function renderableEstimates(
  list: GradedEstimateDTO[] | undefined | null,
): GradedEstimateDTO[] | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const items = list.filter(isRenderable);
  return items.length > 0 ? items : null;
}

/**
 * FICHA (§22.3): `gradedEstimates` vive en la RAÍZ de la respuesta y **no está gateado** por el ROI.
 * Se pinta lo que haya (PROJECT §O.3(1) y §O.4: «se muestra lo que haya (PSA 10 y/o PSA 9)»).
 * Defensa extra alineada con §22.0 y el contrato: la feature es SOLO de raw publicado, así que sin
 * ningún grupo `raw` no se pinta aunque llegara el campo.
 */
export function blockEstimatesOf(
  detail: Pick<GroupedListingDetailResponse, 'listings' | 'gradedEstimates'> | undefined | null,
): GradedEstimateDTO[] | null {
  if (!detail) return null;
  if (!detail.listings?.some((l) => l.productType === 'raw')) return null;
  return renderableEstimates(detail.gradedEstimates);
}

/**
 * TEJA y VITRINA (§22.5/§22.6): `gradingHighlight` ya viene gateado por el servidor —presencia ⇔
 * el gate de ROI sobre PSA 9 **y** el de confianza se cumplieron—. El cliente NO reevalúa nada:
 * solo comprueba que haya dinero que pintar y que el grupo sea raw.
 *
 * **v1.50.2 — el campo vive en `GroupedListingSummaryDTO`** (el DTO de la REJILLA), no en
 * `GroupedListingDTO` (que tras D2 es el de la FICHA). Que el parámetro sea el Summary es lo que
 * hace que el compilador impida releerlo desde `listings[i]` de la ficha, camino DEROGADO por el
 * contrato: la ficha se sirve de `gradedEstimates` (más rico y sin gatear).
 */
export function badgeEstimatesOf(
  listing: GroupedListingSummaryDTO | undefined | null,
): GradedEstimateDTO[] | null {
  if (!listing || listing.productType !== 'raw') return null;
  return renderableEstimates(listing.gradingHighlight);
}

/**
 * ¿Esta PÁGINA de listado muestra al menos una cifra estimada? Es el predicado que decide si la
 * página hospeda su nota al pie (§22.4b: en Compra «la página actual muestra ≥ 1 badge; al paginar
 * se reevalúa»). Se deriva del MISMO helper que pinta el badge, no de una copia de la regla.
 */
export function pageHasGradingFigures(
  listings: readonly GroupedListingSummaryDTO[] | undefined | null,
): boolean {
  return (listings ?? []).some((l) => badgeEstimatesOf(l) !== null);
}

/*
 * `oldestCapturedDate()` VIVIÓ AQUÍ y se retiró (PROJECT.md decisión 62, criterio 119). Calculaba la
 * fecha de captura más antigua del bloque para el eyebrow «ESTIMADO · {date}» de la ficha. Ese
 * eyebrow ya no existe: la fecha de captura es cuándo BAJAMOS el dato, no cuándo ocurrió la venta,
 * y el rótulo no lo decía. La frescura se sigue evaluando **server-side** sobre `capturedDate`
 * (criterio 118), así que el campo sigue viajando en el DTO — retirarlo del contrato es decisión del
 * arquitecto, no de esta capa. Si algún día se persiste `evidenceDate`, la fecha real de la venta
 * vuelve a estar sobre la mesa y este helper se reescribe sobre ESE campo, no sobre la captura.
 */

import type {
  GradedEstimateDTO,
  GroupedListingDetailResponse,
  GroupedListingDTO,
} from '@/types/contract';

/**
 * «Gancho de grading» — predicados de render (contrato v1.44-graded-estimate, PROJECT §N,
 * DESIGN_SYSTEM §21). Este módulo es la ÚNICA fuente de verdad de «¿hay cifra que pintar?»:
 * lo consumen tanto los componentes que pintan la cifra como las páginas que deciden
 * hospedar la nota al pie, y eso es lo que hace verificable el acoplamiento R3.(3)
 * («llamada y nota bajo la MISMA condición»).
 *
 * Reglas del contrato que se implementan aquí:
 *  - **PRESENCIA ⇔ ELEGIBILIDAD**: no hay flag ni arreglo vacío. Campo ausente ⇒ no se pinta NADA
 *    (§21 R4: ni contenedor, ni encabezado, ni «—», ni $0, ni «pendiente», ni skeleton).
 *  - **Se ITERA leyendo `gradeValue`**: PROHIBIDO `[0]`, PROHIBIDO asumir orden o cantidad. Es lo
 *    que permite que el servidor añada o quite un grado (dial `grades`/`highlightGrades`) sin tocar
 *    el cliente ni el contrato.
 *  - **Nada del cálculo viaja** (§21 R5): aquí no hay multiplicador, ganancia, costo de gradeo ni
 *    margen — y tampoco se derivan. El gate de ROI es server-side y su única huella es la presencia
 *    de `gradingHighlight`.
 */

/** Una cifra es pintable solo si el dinero existe de verdad (money-safe, §N.4). */
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
 * FICHA (§21.3): `gradedEstimates` vive en la RAÍZ de la respuesta y **no está gateado** por el ROI.
 * Se pinta lo que haya (PROJECT §N.3(1) y §N.4: «se muestra lo que haya (PSA 10 y/o PSA 9)»).
 * Defensa extra alineada con §21.0 y el contrato: la feature es SOLO de raw publicado, así que sin
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
 * TEJA y VITRINA (§21.5/§21.6): `gradingHighlight` ya viene gateado por el servidor —presencia ⇔
 * el gate de ROI sobre PSA 9 se cumplió—. El cliente NO reevalúa nada: solo comprueba que haya
 * dinero que pintar y que el grupo sea raw.
 */
export function badgeEstimatesOf(
  listing: GroupedListingDTO | undefined | null,
): GradedEstimateDTO[] | null {
  if (!listing || listing.productType !== 'raw') return null;
  return renderableEstimates(listing.gradingHighlight);
}

/**
 * ¿Esta PÁGINA de listado muestra al menos una cifra estimada? Es el predicado que decide si la
 * página hospeda su nota al pie (§21.4b: en Compra «la página actual muestra ≥ 1 badge; al paginar
 * se reevalúa»). Se deriva del MISMO helper que pinta el badge, no de una copia de la regla.
 */
export function pageHasGradingFigures(
  listings: readonly GroupedListingDTO[] | undefined | null,
): boolean {
  return (listings ?? []).some((l) => badgeEstimatesOf(l) !== null);
}

/**
 * Fecha del refresco a mostrar en el eyebrow derecho del bloque (§21.3). Se itera el arreglo (nunca
 * `list[0].estimate.capturedDate`) y se toma **la MÁS ANTIGUA** de las cifras que efectivamente se
 * pintan. `undefined` ⇒ el eyebrow de fecha no se pinta (nunca un guion ni una fecha inventada).
 *
 * **Por qué la más antigua y no la más reciente (deuda D5 del techlead, corregida).** Una sola
 * fecha rotula **todas** las cifras del bloque. Con PSA 10 capturado hoy y PSA 9 hace 29 días, la
 * más reciente diría «hoy» y estaría **cubriendo un dato de casi un mes** — en una superficie con
 * exposición legal eso es afirmar de más. La más antigua es la lectura **conservadora** (ninguna
 * cifra es más vieja que lo que dice el rótulo) y además coincide con el criterio del backend, que
 * evalúa la frescura contra la captura más antigua.
 */
export function oldestCapturedDate(list: readonly GradedEstimateDTO[]): string | undefined {
  let oldest: string | undefined;
  for (const e of list) {
    const d = e.estimate?.capturedDate;
    if (!d) continue;
    if (oldest === undefined || d < oldest) oldest = d;
  }
  return oldest;
}

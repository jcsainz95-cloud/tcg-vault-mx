import type { HistoricalOrderItemCardDTO } from '@/types/contract';

/**
 * RENDER DEGRADADO POR CAMPO del acta de un pedido (`GET /orders/:orderId`).
 * Contrato §4 «Tolerancia del histórico» punto 4; ARCHITECTURE §5.2.9(b).
 *
 * Por qué existe: `OrderItem.cardSnapshot` es una columna `Json` que PostgreSQL no valida, y
 * el blob de un pedido antiguo lo escribió una versión anterior de nuestro propio código. La
 * forma de un snapshot histórico no es una garantía del sistema: es una observación sobre
 * datos que ya existen. Por eso el tipo es `Partial<FrozenCardFacts>` y por eso la vista NO
 * puede interpolar los campos a pelo (hacerlo pintaba la línea MUDA: `name` `undefined`
 * rinde cadena vacía en React, y el `alt` de la miniatura salía `null`).
 *
 * ⛔ Lo que este módulo NO hace, y no debe hacer nunca: pedir `GET /catalog/cards/:cardId`
 * (ni ninguna otra consulta) para rellenar un hueco. Los hechos congelados NO se
 * re-resuelven (§5.2.2): el catálogo dice cómo se llama esa carta HOY, no qué decía el
 * pedido cuando se pagó. Rellenar convierte «el acta no lo registró» en un dato inventado
 * presentado como probatorio, dentro de un registro dinero-adyacente. El hueco se ve; el
 * relleno no. Por eso todas las funciones de aquí son PURAS: reciben el DTO y devuelven
 * texto. No hay dónde colgar una petición aunque alguien quisiera.
 *
 * `null` ≠ ausente, y la diferencia importa al leer, no al pintar: `rawCondition`,
 * `gradingCompany` y `gradeValue` llegan con la CLAVE PRESENTE y valor `null` desde el
 * checkout vigente, pero un blob viejo puede no traerlas. Las tres condicionales de aquí
 * cubren los DOS casos (`== null`) y ninguna usa `in` como discriminante — el discriminante
 * es `productType`, que a su vez puede faltar.
 */

/** Un hecho «no consta» si falta, si es `null` o si es una cadena en blanco. */
function fact(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Nombre a pintar. `hasName: false` ⇒ el blob no lo registró y la vista debe usar la
 * etiqueta NEUTRA de i18n (`orders.item.unknownCard`), nunca cadena vacía ni `"undefined"`,
 * y nunca omitir la línea: la línea tiene importe, y el importe NO vive en el blob.
 *
 * También devuelve el `alt` de la miniatura, que es el mismo texto: un `<img alt={null}>` es
 * un incumplimiento de WCAG 1.1.1, y `alt=""` (imagen decorativa) sería mentir — la
 * miniatura de una línea de compra es contenido.
 */
export function historicalCardName(
  card: HistoricalOrderItemCardDTO,
  unknownLabel: string,
): { text: string; hasName: boolean } {
  const name = fact(card.name);
  return name ? { text: name, hasName: true } : { text: unknownLabel, hasName: false };
}

/**
 * Subtítulo mono de la línea: `Base Set · #4 · NM`. Se COMPONE con lo que el acta registró y
 * se OMITE lo demás — sin «#» suelto, sin «· » colgando y sin separador de apertura. Si no
 * queda ningún fragmento devuelve `''` y la vista no pinta el renglón (un renglón vacío
 * reserva espacio y se lee como un fallo de carga).
 *
 * `productType` ausente ⇒ NO se infiere: sin él no se pinta el adorno de condición/grado,
 * aunque `rawCondition` viniera en el blob. Inferir el tipo desde qué claves llegaron es
 * exactamente el `'rawCondition' in card` que el contrato prohíbe.
 */
export function historicalCardMeta(card: HistoricalOrderItemCardDTO): string {
  const parts: string[] = [];

  const setName = fact(card.setName);
  if (setName) parts.push(setName);

  const number = fact(card.number);
  if (number) parts.push(`#${number}`);

  if (card.productType === 'raw') {
    // "NM" es término de grading (no se traduce) y es el único valor del contrato.
    const condition = fact(card.rawCondition);
    if (condition) parts.push(condition);
  } else if (card.productType === 'graded') {
    // Empresa y grado se componen por separado: un blob puede traer una y no el otro, y
    // «PSA» solo o «10» solo siguen siendo información honesta.
    const grade = [fact(card.gradingCompany), fact(card.gradeValue)].filter(Boolean).join(' ');
    if (grade) parts.push(grade);
  }

  return parts.join(' · ');
}

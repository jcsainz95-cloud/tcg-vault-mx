import type { SellItemDTO, SellOfferPublicDTO } from '@/types/contract';

/** Una línea que SÍ compramos: siempre trae precio congelado y su condición. */
export interface BoughtOfferLine {
  line: SellItemDTO;
  /** La condición NM de ESTA línea, **renderizada por el servidor**. Nunca copy del front. */
  condition: string;
  /** Nunca `null` aquí: una línea `buy` sin precio no es una línea `buy` (ver `readOffer`). */
  offeredPriceCents: number;
}

/**
 * Una línea que NO compramos. ⚠️ **No tiene campo de monto, a propósito**: `MX$ 0.00` está
 * prohibido en estas líneas (cero es un precio y aquí no hay precio, §23.4.2 decisión 3) y la
 * forma del tipo es lo que impide pintarlo por descuido.
 */
export interface SkippedOfferLine {
  line: SellItemDTO;
  condition: string;
}

export type OfferReadiness =
  | {
      renderable: true;
      buy: BoughtOfferLine[];
      skip: SkippedOfferLine[];
      /** La condición corta, para la frase de confirmación (§23.5c). VERBATIM del servidor. */
      condition: string;
      consequence: string;
    }
  | { renderable: false; reason: 'missing_terms' | 'unclassified_lines' | 'no_lines' };

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * **¿Se puede pintar esta oferta —y por tanto ofrecer aceptarla— con lo que llegó?**
 *
 * Esta función es el sitio donde el consumo defensivo se vuelve una regla de negocio, así que
 * conviene leer POR QUÉ falla hacia donde falla. La oferta es **vinculante**, **todo-o-nada** y
 * **condicional**: el vendedor no acepta un número, acepta *«te compramos ESTAS cartas a ESTOS
 * precios, SIEMPRE QUE LLEGUEN EN NM, y ESTAS otras no las compramos»*. Cada una de esas cuatro
 * cosas es parte del trato (D1/D27/D30, criterios 118/161).
 *
 * De ahí las tres puertas, todas en la misma dirección — **si no se puede enseñar el trato
 * completo, no se ofrece aceptarlo**:
 *
 * 1. **`missing_terms`** — falta `terms.perLineConditionLabel` o `terms.consequence`. R2 de
 *    §23.0 es absoluta: *«toda superficie que muestre un monto ofertado muestra en el mismo
 *    bloque la condición NM. Sin excepción»*. Una oferta pintada sin su condición **se lee como
 *    incondicional**, que es un trato distinto y mejor para el vendedor del que de verdad le
 *    estamos ofreciendo. Aceptarla así nos deja sin nada que enseñar cuando dentro de dos
 *    semanas rechacemos una carta por no llegar NM.
 * 2. **`unclassified_lines`** — alguna línea no dice si la compramos (`offerDecision`), o dice
 *    `buy` sin precio. El criterio 118 exige que el desglose diga **qué NO compramos**; sin la
 *    decisión por línea, el paquete que el vendedor aceptaría tiene contenido desconocido.
 *    ⚠️ Una línea `buy` sin precio **no se rescata pintando `MX$ 0.00`**: cero es un precio.
 * 3. **`no_lines`** — una oferta sin líneas no es un desglose, es un total suelto.
 *
 * **Lo que esta función NO hace, a propósito:** no comprueba que la suma de las líneas `buy`
 * cuadre con `grossCents`. R4 (§23.0) dice que ninguna cifra del ciclo se calcula en el
 * cliente, y una validación aritmética escondida aquí **bloquearía una oferta real** por
 * cualquier diferencia legítima que el servidor conozca y el front no. Los tres montos se
 * pintan como llegan; quien los cuadra es el servidor, que es quien los congeló.
 *
 * **Qué hace la pantalla con un resultado negativo:** no pinta el desglose, **ni los tres
 * montos, ni el plazo, ni las acciones** — solo un aviso que dice que la oferta no se puede
 * mostrar completa y remite al correo y a soporte. Enseñar el neto suelto sería tentador
 * («al menos que vea la cifra») y es justo lo que R2 prohíbe: **un monto ofertado sin su
 * condición al lado es una promesa mejor de la que le estamos haciendo.**
 */
export function readOffer(offer: SellOfferPublicDTO): OfferReadiness {
  const fallbackCondition = nonEmpty(offer.terms?.perLineConditionLabel);
  const consequence = nonEmpty(offer.terms?.consequence);
  if (!fallbackCondition || !consequence) return { renderable: false, reason: 'missing_terms' };

  const lines = offer.lines ?? [];
  if (lines.length === 0) return { renderable: false, reason: 'no_lines' };

  const buy: BoughtOfferLine[] = [];
  const skip: SkippedOfferLine[] = [];
  for (const line of lines) {
    // La condición POR LÍNEA manda sobre la de la oferta (el contrato la manda ya renderizada
    // por línea); la de `terms` es el respaldo. En ningún caso hay copy del front.
    const condition = nonEmpty(line.condition) ?? fallbackCondition;
    if (line.offerDecision === 'skip') {
      skip.push({ line, condition });
      continue;
    }
    const price = line.offeredPriceCents;
    if (line.offerDecision === 'buy' && typeof price === 'number' && Number.isFinite(price)) {
      buy.push({ line, condition, offeredPriceCents: price });
      continue;
    }
    return { renderable: false, reason: 'unclassified_lines' };
  }

  return { renderable: true, buy, skip, condition: fallbackCondition, consequence };
}

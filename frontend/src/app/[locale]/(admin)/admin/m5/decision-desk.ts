import type { BuylistDecisionLineDTO, BuylistDecisionTotalsDTO } from '@/types/contract';

/** Lo que el operador tecleó en una línea. Vacío = sin override. */
export interface LineOverride {
  amountCents?: number;
  reason?: string;
}

/**
 * **El DEFAULT de la casilla, y por qué NO lo decide la sugerencia.**
 *
 * Toda línea **con precio resoluble** nace **marcada**; la línea **sin precio** nace **desmarcada**
 * —no se puede ofertar sin monto—. El punto de partida es *«la solicitud tal como llegó»* y el
 * cherry-pick es **quitar**, nunca poner.
 *
 * ⚠️ Si el default siguiera a `suggestion`, un `do_not_buy` se convertiría en **bloqueo blando**: la
 * inercia haría el trabajo que D6 le prohíbe hacer al sistema. La sugerencia informa; **no
 * preselecciona**. Esta función no mira `suggestion` ni una vez, y es a propósito.
 */
export function defaultSelection(lines: BuylistDecisionLineDTO[]): Set<string> {
  return new Set(lines.filter((l) => l.derivedPriceCents != null).map((l) => l.itemId));
}

/**
 * El monto con el que entra una línea: el override si lo hay, si no el derivado.
 * `null` ⇒ **no se puede ofertar**: ni con `MX$ 0.00` ni con una cifra de respaldo (§N.2).
 */
export function lineAmountCents(
  line: BuylistDecisionLineDTO,
  override?: LineOverride,
): number | null {
  if (override?.amountCents != null && Number.isFinite(override.amountCents)) {
    return override.amountCents;
  }
  return line.derivedPriceCents;
}

/**
 * **¿Este monto es un OVERRIDE?** ⚠️ Igualdad **entera exacta sobre centavos**: mandar
 * exactamente el derivado **NO es un override** —no pide motivo, no escribe `offerOverrideReason` y
 * no cambia el `priceBasis`— porque *lo auditable es la desviación, no la pulsación*
 * (contrato v1.51.12). **No existe ni existirá banda de tolerancia:** un centavo de delta ya es un
 * override. *«Casi igual» no es una categoría de este contrato.*
 */
export function isOverride(line: BuylistDecisionLineDTO, override?: LineOverride): boolean {
  const amount = override?.amountCents;
  if (amount == null || !Number.isFinite(amount)) return false;
  return amount !== line.derivedPriceCents;
}

export interface SelectionTotals {
  selectedCount: number;
  grossCents: number;
  netCents: number;
  /** Alguna línea marcada no tiene monto ⇒ el servidor respondería `OFFER_LINE_NOT_PRICEABLE`. */
  hasUnpriceableLine: boolean;
  /** Alguna línea marcada difiere del derivado y no trae motivo (3–500). */
  itemIdsMissingReason: string[];
  belowMinimum: boolean;
  /** Cuánto BRUTO falta para llegar al piso. `0` si no falta. */
  grossShortfallCents: number;
}

/** Un motivo válido de override: 3–500 caracteres, como exige el contrato. */
export function isValidOverrideReason(reason?: string): boolean {
  const trimmed = (reason ?? '').trim();
  return trimmed.length >= 3 && trimmed.length <= 500;
}

/**
 * **La suma de la previsualización.**
 *
 * ⚠️ **Qué se calcula aquí y qué NO, porque la frontera es la regla:** la UI **recalcula la suma**
 * al desmarcar —el servidor mandó la del default y no puede saber qué quitó el operador—, pero
 * **el UMBRAL y la TARIFA los manda el servidor** (`minimumOfferNetCents`, `shippingFeeCents`).
 * Esos son **diales editables sin redeploy**: una constante aquí quedaría desincronizada **en
 * silencio** la primera vez que alguien los mueva, y en una pantalla de dinero eso es un aviso que
 * aparece cuando no toca — o que **no aparece cuando sí**.
 *
 * ⚠️ **`requiresAuthorization` NO se recalcula, ni siquiera contra `operatorCapCents`.** Depende
 * del **rol del actor**, que esta pantalla no conoce: un súper-admin oferta sin tope. Derivarlo
 * aquí haría que a un súper-admin el botón le dijera *«enviar a autorización»* sobre una oferta que
 * **sí va a salir con su correo** — el botón mintiendo en la dirección peligrosa. Se usa el
 * booleano del servidor tal cual, y **el desenlace real lo dice la respuesta** (`offerState`).
 */
export function selectionTotals(
  lines: BuylistDecisionLineDTO[],
  selected: ReadonlySet<string>,
  overrides: Readonly<Record<string, LineOverride>>,
  totals: BuylistDecisionTotalsDTO,
): SelectionTotals {
  let grossCents = 0;
  let hasUnpriceableLine = false;
  const itemIdsMissingReason: string[] = [];

  for (const line of lines) {
    if (!selected.has(line.itemId)) continue;
    const override = overrides[line.itemId];
    const amount = lineAmountCents(line, override);
    if (amount == null) {
      hasUnpriceableLine = true;
      continue;
    }
    if (isOverride(line, override) && !isValidOverrideReason(override?.reason)) {
      itemIdsMissingReason.push(line.itemId);
    }
    grossCents += amount;
  }

  const netCents = Math.max(0, grossCents - totals.shippingFeeCents);
  // El borde es INCLUSIVO: un neto EXACTAMENTE igual al piso SÍ se emite (`<`, nunca `<=`).
  const belowMinimum = netCents < totals.minimumOfferNetCents;
  return {
    selectedCount: [...selected].filter((id) => lines.some((l) => l.itemId === id)).length,
    grossCents,
    netCents,
    hasUnpriceableLine,
    itemIdsMissingReason,
    belowMinimum,
    // El faltante se expresa en BRUTO a propósito: la palanca del operador es el bruto, y
    // «te faltan $330 de bruto» es accionable donde «el neto es bajo» no lo es.
    grossShortfallCents: Math.max(0, totals.requiredGrossCents - grossCents),
  };
}

/**
 * **Qué apaga el botón de emitir — y, sobre todo, qué NO.**
 *
 * `null` ⇒ se puede emitir. Un valor ⇒ la razón, para pintarla con `aria-describedby` (nunca un
 * botón apagado y mudo, §15.9).
 *
 * ⚠️ **`suggestion.verdict === 'do_not_buy'` NO aparece en esta lista, y su ausencia es la regla.**
 * El servidor **no** valida la oferta contra la sugerencia (D6): el admin compra una línea
 * desaconsejada **sin fricción, sin permiso extra y sin confirmación adicional**. Tampoco entra
 * `positionUnavailable`: se puede ofertar sin conteo — lo que falta es **el consejo**, no el
 * permiso.
 *
 * Solo apaga lo que el servidor **va a rechazar**: dejar el botón vivo ahí sería prometer una
 * acción que va a fallar.
 */
export type EmitBlocker =
  | 'pickupAddressMissing'
  | 'noLines'
  | 'unpriceableLine'
  | 'missingReason'
  | 'belowMinimum'
  | null;

export function emitBlocker(
  selection: SelectionTotals,
  pickupAddressMissing: boolean,
): EmitBlocker {
  if (pickupAddressMissing) return 'pickupAddressMissing';
  if (selection.selectedCount === 0) return 'noLines';
  if (selection.hasUnpriceableLine) return 'unpriceableLine';
  if (selection.itemIdsMissingReason.length > 0) return 'missingReason';
  if (selection.belowMinimum) return 'belowMinimum';
  return null;
}

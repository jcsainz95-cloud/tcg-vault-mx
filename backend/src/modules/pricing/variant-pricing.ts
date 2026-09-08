import { VariantPriceOverride } from '@prisma/client';
import { PriceBasis, computeSalePriceFromCurve, quoteAcquisitionFromCurve } from '../../common/money';
import { PricingCurve, isBountyEffective, premiumFloorGuard } from '../../common/pricing-curve';
import type { PriceSourceStr } from './pricing.types';
// `import type` a propósito: el composer sigue siendo PURO y sin dependencias de infra — la
// importación se borra al compilar y no crea arista de módulo con el servicio.
import type { PriceInfo } from './pricing.service';

/**
 * variant-pricing.ts — v1.28 (P-18/P-22) · v2.0 (P-48, ARCHITECTURE §4.36 / API_CONTRACT §DTOs).
 * COMPOSER PURO del `VariantPricingDTO`: la lectura de la consola de TRES precios por
 * (carta, variante). Sin dependencias de infra — el caller iza la CURVA/referencias/overrides en
 * LOTE (`loadPricingCurve` + `getReferencesBatch` + `getVariantOverridesBatch`) y compone por
 * variante con este único cuerpo. Lo usan:
 *  - `VariantControlsService` (respuesta resuelta del PUT variant-controls),
 *  - `MasterSetService.binder` (campo `pricing?` de la variante, SOLO scope `platform`), y
 *  - `AdminBountiesService` (consola de bounties, §M2-B.1).
 *
 * v2.0 (P-48): el sugerido ya NO es «lo que da la regla» sino **lo que da la CURVA** para el valor de
 * mercado de la variante, y `source` deja de ser `rule|fallback` para ser el `PriceBasis` normativo
 * (`market | floor | override | bounty | pending`). **Ni la rareza ni el acabado entran al monto**
 * (criterio 84): el acabado ya eligió DE QUÉ VARIANTE se lee el mercado, antes de llegar aquí.
 *
 * Money-safe: `suggested`/`effective` = `null` cuando no resolubles (JAMÁS un 0 inventado);
 * `source='pending'` cuando ningún peldaño resolvió. La matemática de precedencias vive en
 * `common/money.ts` (`quoteAcquisitionFromCurve` / `computeSalePriceFromCurve`) — aquí solo se
 * proyecta al DTO del contrato, sin duplicar cuerpos.
 */

/**
 * v1.62.2 — `MarketReferenceDTO`: **EL VALOR DE MERCADO DE LA VARIANTE**, la ENTRADA de la que salen
 * `buy.suggestedCents`, `sell.suggestedCents` y `bounty.curveQuoteCents`.
 *
 * ⛔ **No es una segunda resolución del mercado.** Es el ECO de lo que el caller ya resolvió con
 * `getReference`/`getReferencesBatch` y que hasta v1.62.1 se descartaba al proyectar. Forma y
 * semántica normativas: `API_CONTRACT §DTOs base`, bloque `<!-- CANON: mercado-de-la-variante -->`
 * (**se cita, no se transcribe** — §0-B.3 regla 8). Candados **B-14** / **B-15** de §M2-B.6.
 */
export interface MarketReferenceDTO {
  status: 'priced' | 'pending';
  referenceMxnCents: number | null;
  /** `YYYY-MM-DD` — el día en que se capturó ESA fila (NO la última venta observada; ver GU-9). */
  capturedDate: string | null;
  /** PROCEDENCIA — `vault_operator+`; `pricing` ya es admin-only (§4.26b). */
  source: PriceSourceStr | null;
}

/**
 * `pending` canónico: los CUATRO campos a la vez. Se construye una copia por llamada porque el DTO
 * viaja a JSON por variante y nadie debe poder mutar un singleton compartido.
 */
function marketPending(): MarketReferenceDTO {
  return { status: 'pending', referenceMxnCents: null, capturedDate: null, source: null };
}

/**
 * ⭐ **EL ÚNICO ESTRECHAMIENTO** de `PriceInfo` → mercado emitible. Antes de v1.62.2 vivía copiado a
 * mano en las TRES llamadas al composer (`master-set`, `variant-controls`, `admin-bounties`), que es
 * la misma lección de `GradedEstimateRef` (§4.38c): *tres estrechamientos que deben coincidir y que
 * nadie obliga a coincidir, divergen*.
 *
 * ⛔ **`0` NO es un valor emitible, y la regla es DEL EMISOR** (contrato, `<!-- CANON:
 * mercado-de-la-variante -->`): si la referencia resuelta no es `> 0` —fila corrupta, restore,
 * `priceMxnCents = 0`— se emite `pending` + `null`, **jamás** un `0` «fiel al dato». Es la misma H-1
 * que ya gobierna los overrides, y es lo que mantiene viva la equivalencia con la curva: la curva ya
 * trata `<= 0` como `pending` (`explainBuy/SaleFromCurve`), así que un `priced: 0` sería exactamente
 * la discrepancia que este DTO existe para no permitir.
 *
 * ⛔ **Jamás el precio de otro acabado:** aquí no hay a dónde caer — se recibe la `PriceInfo` de ESA
 * variante y sin ella el resultado es `pending`. La elección del acabado ocurrió antes, en la clave
 * `(cardId, productType, gradeKey, finish)` del batch.
 *
 * 🕐 `capturedDate` se **copia**, nunca se sella con `today()` (B-15). Un `priced` sin fecha/fuente en
 * la entrada NO descarta el precio: el importe es la CARGA y la fecha/procedencia son decoración —
 * inventar una fecha sería peor que no tenerla, y tirar un precio real por falta de adorno sería
 * apagar dinero vivo. En producción `getReference*` pobla siempre las dos desde la fila.
 */
export function resolveMarketReference(info: PriceInfo | null | undefined): MarketReferenceDTO {
  if (!info || info.status !== 'priced') return marketPending();
  const cents = info.referenceMxnCents;
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents <= 0) return marketPending();
  return {
    status: 'priced',
    referenceMxnCents: cents,
    capturedDate: info.capturedDate ?? null,
    source: info.source ?? null,
  };
}

/** API_CONTRACT §DTOs (v1.28, actualizado v2.0 P-48; `market` en v1.62.2). */
export interface VariantPricingDTO {
  /**
   * v1.62.2 — **SIEMPRE presente** cuando viaja `pricing` (nunca opcional: su ausencia se
   * confundiría con «no hay mercado», que es lo que `status` está para decir en voz alta).
   */
  market: MarketReferenceDTO;
  buy: {
    /** Lo que da la CURVA hoy sobre el mercado de la variante (bin incluido). `null` = no resuelve. */
    suggestedCents: number | null;
    overrideCents: number | null;
    effectiveCents: number | null;
    /** v2.0: `PriceBasis` — `market|floor` sustituyen a `rule|fallback`. */
    source: PriceBasis;
    /**
     * v2.0 (§4.36.5) — el GUARDARRAÍL disparó en este eje: rareza premium que aterrizó en el piso/bin
     * ⇒ NO se publica / NO se cotiza y hay entrada `premium_at_floor` en la cola. Es lo que hace
     * VISIBLE el guardarraíl desde el back-office y permite detectar PISOS MAL CALIBRADOS.
     */
    premiumAtFloor: boolean;
  };
  sell: {
    suggestedCents: number | null;
    overrideCents: number | null;
    effectiveCents: number | null;
    source: PriceBasis;
    premiumAtFloor: boolean;
  };
  bounty?: {
    enabled: boolean;
    priceCents: number | null;
    targetQty: number | null;
    acquiredQty: number;
    completedAt: string | null;
    /**
     * v2.0 (§4.36.6, criterios 90/91) — **LA ALERTA DEL BINDER**. `false` ⇔ el bounty quedó por
     * debajo (o IGUAL) de la tarifa vigente ⇒ NO aplica en la cotización, NO se publica en la vitrina
     * y `buy.source` NO será `bounty`. Decisión del humano: basta el binder, SIN aviso proactivo por
     * correo/push/dashboard.
     */
    effective: boolean;
    /** La cotización de curva que lo rebasó. `null` = la curva no resuelve ⇒ el bounty SIGUE siendo efectivo. */
    curveQuoteCents: number | null;
  } | null;
}

/**
 * Compone el `VariantPricingDTO` de UNA variante. `marketRef` = la `PriceInfo` de mercado del
 * ACABADO tal como la devuelve `getReference`/`getReferencesBatch` (FX ya recomputada; `null`/
 * ausente = sin referencia). `override` = la fila M-30 de la variante o `null` (sin fila ⇒ solo
 * sugeridos por curva).
 *
 * ⚠️ v1.62.2 — **el parámetro es la `PriceInfo`, no un número ya estrechado**, y es deliberado
 * (§4.42j(c)): el estrechamiento money-safe vive **una sola vez**, aquí dentro
 * (`resolveMarketReference`), y el compilador impide que un caller vuelva a hacerlo a mano. De esa
 * MISMA variable salen `market` y el número que entra a la curva ⇒ **no pueden discrepar**, que es
 * la mitad (c) del candado B-14.
 *
 * - `suggestedCents` = lo que da la CURVA hoy (sin override ni bounty) — el "sugerido" de la consola,
 *   y la cifra contra la que el dueño compara sus overrides heredados (§4.36.9c-5).
 * - `effectiveCents`/`source` = el precio RESUELTO con la precedencia normativa §4.36.6
 *   (COMPRA: bounty válido > override > curva > pending · VENTA: sellOverride > curva > pending; el
 *   `listPriceCents` POR PIEZA no viaja aquí — vive en el drill-down y gana para ESA pieza).
 * - `bounty` viene SOLO si existe fila M-30 (estado para la edición en consola, P-22).
 */
export function composeVariantPricing(
  marketRef: PriceInfo | null | undefined,
  curve: PricingCurve,
  override: VariantPriceOverride | null,
  /**
   * v2.0 (§4.36.5) — rareza CANÓNICA de la carta, SOLO para el veredicto del guardarraíl. No entra al
   * monto (criterio 84): `premiumFloorGuard` devuelve un booleano de publicación, jamás una cantidad.
   */
  rarityCanonical: string | null = null,
): VariantPricingDTO {
  // ⭐ UNA resolución, dos usos: lo que se EMITE (`market`) y lo que ENTRA a la curva son la misma
  // variable. Emitir un mercado que la curva no vio es imposible por construcción (B-14(c)).
  const market = resolveMarketReference(marketRef);
  const referenceMxnCents = market.referenceMxnCents;
  // COMPRA — un solo cuerpo: el resultado trae el efectivo Y lo que daría la curva sola.
  const buy = quoteAcquisitionFromCurve(referenceMxnCents, curve, override);
  // VENTA — efectivo A NIVEL VARIANTE (sellOverride > curva); el override por pieza no entra aquí.
  const sell = computeSalePriceFromCurve(referenceMxnCents, curve, override);

  const buyGuarded = premiumFloorGuard(rarityCanonical, buy.basis) === 'premium_at_floor';
  const sellGuarded = premiumFloorGuard(rarityCanonical, sell.basis) === 'premium_at_floor';

  return {
    // v1.62.2 — el valor de mercado de ESTA variante, tal cual entró al cálculo de arriba.
    market,
    buy: {
      suggestedCents: buy.curveQuoteCents, // lo que DARÍA la curva: el diagnóstico del piso mal calibrado
      overrideCents: override?.buyOverrideCents ?? null,
      // Con el guardarraíl disparado la variante NO se cotiza ⇒ efectivo nulo y `pending`, igual que
      // en runtime. El `suggestedCents` sigue visible para que el dueño vea POR QUÉ se bloqueó.
      effectiveCents: buyGuarded ? null : buy.priceCents,
      source: buyGuarded ? 'pending' : buy.basis,
      premiumAtFloor: buyGuarded,
    },
    sell: {
      suggestedCents: sell.curveQuoteCents,
      overrideCents: override?.sellOverrideCents ?? null,
      effectiveCents: sellGuarded ? null : sell.priceCents,
      source: sellGuarded ? 'pending' : sell.basis,
      premiumAtFloor: sellGuarded,
    },
    // Solo si existe fila M-30 (contrato §DTOs: "bounty viene (solo si existe fila)").
    ...(override
      ? {
          bounty: {
            enabled: override.bountyEnabled,
            priceCents: override.bountyPriceCents,
            targetQty: override.bountyTargetQty,
            acquiredQty: override.bountyAcquiredQty,
            completedAt: override.bountyCompletedAt ? override.bountyCompletedAt.toISOString() : null,
            // MISMO predicado que el runtime y que la vitrina (prohibido duplicarlo, §4.36.6).
            effective:
              override.bountyEnabled && isBountyEffective(override.bountyPriceCents, buy.curveQuoteCents),
            curveQuoteCents: buy.curveQuoteCents,
          },
        }
      : {}),
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * **A QUIÉN LE ESTAMOS HABLANDO.** (DESIGN_SYSTEM **§26** · contrato §M5-A.7, v1.58)
 *
 * ### Qué pasó
 * v1.58 hizo alcanzables desde `POST /admin/buylist/:id/offer` dos códigos que hasta entonces solo
 * veía el VENDEDOR: `INE_REQUIRED` y `BUYLIST_LIMIT_EXCEEDED`. El catálogo i18n los resolvía **por
 * código a secas**, así que al **operador** —que no es el sujeto de ninguna de las dos reglas— se
 * le decía *«Necesitas subir **tu** INE para continuar»* y *«**Superas** el tope permitido»*. No
 * solo era falso: mandaba a la persona equivocada a la palanca equivocada.
 *
 * El backend ya había hecho su mitad —razonó la distinción de audiencia y emite un discriminador
 * en `details` (§M5-A.7: *«el destinatario aquí es el OPERADOR, que no es el sujeto de la
 * regla»*)—. Lo que faltaba era que el cliente **llaveara por `code` + discriminador**, no por
 * `code`.
 *
 * ### La regla (DESIGN_SYSTEM §26.1, normativa)
 * - `error.<CODE>` es **del sujeto de la regla** (el vendedor) cuando el código tiene ruta de
 *   cliente; cuando el código **solo** existe en admin, la base ya es la del operador.
 * - `error.<CODE>_OPERATOR` es la del operador de back-office, y **solo existe** cuando el mismo
 *   código llega a los dos.
 * - **Primero el destinatario, después el detalle**: `error.<CODE>[_OPERATOR][_WITH_DETAILS]`.
 * - ⛔ **`apiError.message` (inglés del servidor) deja de ser alcanzable** para los códigos de §26:
 *   la base existe justamente para eso (§26.6, prohibición 7).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** El **lector** del mensaje, que no siempre es el sujeto de la regla. */
export type ErrorAudience = 'seller' | 'operator';

/**
 * `details.scope` → audiencia, para `BUYLIST_LIMIT_EXCEEDED`. **Es el vocabulario del contrato, no
 * uno nuestro**: cada valor es un momento en el que se mide **el mismo control** (§M5-A.7 — *«UN
 * código para UN control medido en varios momentos, y `scope` dice cuál»*).
 *
 * | scope | puerta | sujeto | quién LEE |
 * |---|---|---|---|
 * | `per_month` | intake (`POST /buylist/requests`) | el vendedor | **el vendedor** |
 * | `per_month_offer` | emisión (`POST /admin/buylist/:id/offer`) | el vendedor | **el operador** |
 * | `per_month_payout` | `pay-spei` | el vendedor | **el súper-admin** |
 *
 * ⚠️ **`per_request` y `per_request_offer` NO están aquí, y es deliberado.** El contrato los retiró
 * del vocabulario en v1.59/D47 (el tope por solicitud ya no rechaza, identifica) y §26.2 es
 * explícita: **no se les escribe copy**; si llegan, se pinta la base y **es un hallazgo para QA**.
 * *Un mapa que los tradujera los volvería un caso soportado y le quitaría a QA la señal.*
 */
export const ERROR_SCOPE_AUDIENCE: Readonly<Record<string, ErrorAudience>> = {
  per_month: 'seller',
  per_month_offer: 'operator',
  per_month_payout: 'operator',
};

/**
 * **El selector normativo de §26.2, uno por código.** Devuelve `undefined` cuando el
 * discriminador no viaja o no se reconoce — y entonces decide la superficie (ver
 * `resolveErrorAudience`).
 *
 * ⚠️ **`INE_REQUIRED` no lleva `scope`: se distingue por la FORMA de `details`**, y eso es un
 * contrato **implícito** que ux-ui ya escaló al arquitecto (§26.9, petición 1). Medido en el
 * backend (`buylist.service.ts:3560-3572`, HEAD `29f97e2`): la emisión manda
 * `{ sellRequestId, grossCents }` y **omite `thresholdCents` a propósito**; el intake manda
 * `{ thresholdCents }`. *El día que alguien añada `sellRequestId` a la puerta del intake «porque ya
 * había campo», el vendedor empieza a leer el mensaje del operador* — por eso el remedio pedido es
 * un `details.scope` propio, y por eso este mapa está en UN sitio y no repartido por las pantallas.
 */
const AUDIENCE_FROM_DETAILS: Readonly<
  Record<string, (details: Record<string, unknown>) => ErrorAudience | undefined>
> = {
  BUYLIST_LIMIT_EXCEEDED: (d) =>
    typeof d.scope === 'string' ? ERROR_SCOPE_AUDIENCE[d.scope] : undefined,
  INE_REQUIRED: (d) => {
    if (typeof d.thresholdCents === 'number') return 'seller';
    if (typeof d.sellRequestId === 'string' && typeof d.grossCents === 'number') return 'operator';
    return undefined;
  },
};

/**
 * Los códigos **que llegan a los dos destinatarios** y por tanto tienen variante `_OPERATOR`
 * (§26.2 y §26.4). El resto de la familia de `POST …/offer` es **solo admin**: su copy único ya le
 * habla al operador y una variante sería una segunda copia sin lector.
 *
 * ⚠️ Esta lista es lo que vuelve VERIFICABLE el arreglo: el candado de `error-audience.test.ts`
 * exige, para cada código de aquí, que la variante exista en los DOS catálogos y que **no le hable
 * al operador como si fuera el sujeto de la regla** (§26.6, prohibiciones 1 y 2).
 */
export const AUDIENCE_SENSITIVE_ERROR_CODES = [
  'INE_REQUIRED',
  'BUYLIST_LIMIT_EXCEEDED',
  // §26.4: el contrato lo declara TAMBIÉN en la ruta de cliente (`PATCH …/pickup-address`), así que
  // se desdobla. Su discriminador **no está en `details`**: es la superficie, y por eso la
  // audiencia de pantalla no es un parche opcional del mecanismo sino una de sus dos entradas.
  'PICKUP_ADDRESS_LOCKED',
] as const;

/**
 * Los **siete códigos de §26**: los que tienen copy normativo y para los que **está prohibido**
 * caer al mensaje crudo del servidor (§26.6, prohibición 7). El candado los recorre exigiendo
 * `error.<CODE>` en los dos catálogos; sin eso, la prohibición sería una frase en un documento.
 */
export const DESIGN_SYSTEM_26_ERROR_CODES = [
  'INE_REQUIRED',
  'BUYLIST_LIMIT_EXCEEDED',
  'APPROVED_PRICE_CAP_EXCEEDED',
  'REQUEST_NOT_RECEIVED',
  'PICKUP_ADDRESS_MISSING',
  'PICKUP_ADDRESS_LOCKED',
  'OFFER_PRICE_IMMUTABLE',
] as const;

/**
 * **§27, LOTE 1 — lo único de §27 que bloquea el release, y ya está cableado.**
 *
 * `422 ITEMS_NOT_DECIDED` (contrato v1.61, §M5-V) se pinta en la pantalla donde el súper-admin
 * autoriza dinero y hasta este pase salía **en inglés crudo del servidor** dentro de una UI en
 * español (MEN-2, reabierta por el código nuevo). ux-ui lo redactó en **§27.1.1** y aquí solo se
 * cablea: la cadena base **más** su variante con cifra, cuyo `{count}` sale de
 * `details.pendingDecisionItemIds.length` (§27.1.2, `QueryState`).
 *
 * ⚠️ Es **solo admin**, así que —por §26.1— **la base ya es la del operador** y no lleva
 * `_OPERATOR`.
 */
export const DESIGN_SYSTEM_27_LOT1_ERROR_CODES = ['ITEMS_NOT_DECIDED'] as const;

/**
 * **§27, LOTE 2 — copy NORMATIVO ya escrito, cableado PENDIENTE.** ux-ui lo declara *«no
 * bloqueante»* (§27.0) y lo dejó redactado en §27.2; mientras no se cablee, **el operador sigue
 * leyendo el inglés del servidor** en la mesa de emisión y en la verificación.
 *
 * ⚠️ Esta lista **no es documentación: es un trip-wire por los dos lados** (`error-audience.test`):
 *  - si un código de aquí **desaparece de §27** ⇒ rojo (la lista dejó de ser cierta);
 *  - si alguien **le mete copy al catálogo** sin moverlo a la lista de cableados ⇒ rojo (o el copy
 *    es improvisado, o el cableado quedó a medias y nadie actualizó el inventario).
 * *Un pendiente sin trip-wire es un pendiente que se olvida* — que es exactamente cómo estos doce
 * llevan meses sin traducción.
 */
export const DESIGN_SYSTEM_27_LOT2_PENDING_ERROR_CODES = [
  'OFFER_NOT_ALLOWED',
  'OFFER_ALREADY_SENT',
  'OFFER_LINES_MISMATCH',
  'OFFER_LINE_NOT_PRICEABLE',
  'OVERRIDE_REASON_REQUIRED',
  'OFFER_NET_BELOW_MINIMUM',
  'OFFER_PROJECTION_INCOMPLETE',
  'ITEM_NOT_OFFERED',
  'OFFERED_PRICE_MISSING',
  'DECLINE_NOT_ALLOWED',
  'NO_LIVE_ADJUSTMENT',
  'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',
] as const;

/** Sufijo de destinatario (§26.1). El vendedor usa la clave BASE. */
export const OPERATOR_KEY_SUFFIX = '_OPERATOR';

/**
 * `code` + discriminador → audiencia.
 *
 * **Orden: (1) lo que dice el SERVIDOR en `details`; (2) la audiencia que DECLARA la superficie.**
 *
 * ⚠️ **(2) no es un parche por si (1) falla: es la mitad que (1) no puede cubrir**, y §26 la
 * necesita en dos sitios — `PICKUP_ADDRESS_LOCKED` **no tiene discriminador en `details`** (su
 * desdoble es por ruta), e `INE_REQUIRED` de la emisión **no lleva `scope`**. *Qué pantalla soy es
 * una propiedad del cliente, no una conducta de API inventada.*
 *
 * ⚠️ **Desviación declarada de §26.2** (última fila de su tabla: *«discriminador ausente ⇒ la
 * base»*): aquí, con el discriminador ausente, **decide la superficie antes de caer a la base**.
 * La regla de ux-ui supone que no queda ninguna señal; en una pantalla de back-office **sí queda**,
 * y usar la base ahí es exactamente el defecto que §26 vino a cerrar. La base sigue siendo el
 * último recurso — cuando no hay ni `details` ni superficie declarada.
 */
export function resolveErrorAudience(
  code: string,
  details: Record<string, unknown> | undefined,
  surfaceAudience: ErrorAudience | undefined,
): ErrorAudience | undefined {
  const fromDetails = details ? AUDIENCE_FROM_DETAILS[code]?.(details) : undefined;
  return fromDetails ?? surfaceAudience;
}

/**
 * Claves i18n candidatas, **en orden de preferencia** (§26.5: primero **a quién le hablas**, luego
 * **con cuánto detalle** — el `_WITH_DETAILS` lo compone el llamador sobre cada candidata).
 *
 * Para el operador se intenta su variante y **después** la base: un código sin variante —la inmensa
 * mayoría— resuelve exactamente como antes. *Degradar a la base es peor que la variante, y mucho
 * mejor que el inglés crudo del servidor.*
 */
export function errorMessageKeys(code: string, audience: ErrorAudience | undefined): string[] {
  return audience === 'operator'
    ? [`error.${code}${OPERATOR_KEY_SUFFIX}`, `error.${code}`]
    : [`error.${code}`];
}

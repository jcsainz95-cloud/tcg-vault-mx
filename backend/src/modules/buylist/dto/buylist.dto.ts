import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Finish, ProductType, RawCondition } from '@prisma/client';
import { FINISH_VALUES, PRODUCT_TYPE_VALUES } from '../../../common/enum-values';
// v2.1.9 (D4, §4.37): `rawCondition` es CLASE R — se declara literal, NO se deriva. PROJECT §E:
// «Solo compramos cartas en Near Mint (NM); si al recibir/verificar no está en NM, no se compra.»
// El literal `['NM']` que estaba inline en los tres DTOs de abajo era CORRECTO; ahora es además
// ÚNICO y con su cita al lado (`common/business-rules.ts`).
import { ACCEPTED_RAW_CONDITIONS } from '../../../common/business-rules';

// v2.1.8: DERIVADO del schema (`common/enum-values.ts`) — un enum se declara UNA vez.
const FINISHES = FINISH_VALUES;

/**
 * v1.15 (ARCHITECTURE §4.16b) — cap de ítems por request del batch quote
 * (`POST /buylist/quote/batch`). Constante de servidor: cubre el `pageSize` 20 del grid del
 * cotizador con holgura sin ser vector de abuso. Vacío o sobre-cap → 400 VALIDATION_ERROR.
 */
export const BUYLIST_QUOTE_BATCH_MAX = 50;

/**
 * B-4 / S-B5 (pentest): cota dura de sanidad sobre `approvedPriceCents` en la decisión
 * carta-por-carta. Es la **primera línea** (rechazo 400 en el ValidationPipe) contra un
 * monto absurdo tipo el PoC `99999999` (MX$999,999). Fijada a **MX$10,000 = 1,000,000c**,
 * que coincide con el tope AML mensual por defecto (`buylist_cap_per_month_cents`): ningún
 * ítem individual puede aprobar más que el tope mensual completo. La cota fina y relativa
 * (≤ `quotedPriceCents` × factor, y ≤ tope por solicitud) se valida server-side en
 * `buylist.service.ts` (`itemDecision`).
 */
export const MAX_APPROVED_PRICE_CENTS = 1_000_000;

export class PublicQuoteDto {
  @IsString() cardId!: string;
  @IsIn(PRODUCT_TYPE_VALUES) productType!: ProductType;
  @IsOptional() @IsIn(ACCEPTED_RAW_CONDITIONS) rawCondition?: RawCondition;
  // v1.6-finish: acabado cotizado (default normal). Se valida server-side contra
  // card.availableFinishes (SEC-A1); fuera de la lista → 422 FINISH_NOT_AVAILABLE.
  @IsOptional() @IsIn(FINISHES) finish?: Finish;
  // v1.30 (§4.29): `productId` OPCIONAL/ADITIVO = TCGplayer productId (== CardProduct.tcgplayerProductId,
  // el MISMO que el front recibió en CardProductDTO.productId / separateProducts), NO el UUID interno.
  // Presente ⇒ la línea es ESE producto separado (acabado ∈ CardProduct.finishes; referencia por su
  // cardProductId). Ausente ⇒ set_base por (cardId, finish). productId inexistente → 422 PRODUCT_NOT_FOUND;
  // que no cuelga del cardId → 422 PRODUCT_CARD_MISMATCH (se resuelven server-side). Entero positivo.
  @IsOptional() @IsInt() @Min(1) productId?: number;
}

/**
 * v1.15 (BuylistQuoteItemDTO del contrato §6) — un ítem del batch quote. Espeja EXACTAMENTE los
 * campos del quote por-carta (`PublicQuoteDto`); SIN `qty` (el modelo es una línea por carta
 * física, ARCHITECTURE §4.16b). El `finish` se valida por-ítem server-side (SEC-A1).
 */
export class BuylistQuoteItemDto {
  @IsString() cardId!: string;
  @IsIn(PRODUCT_TYPE_VALUES) productType!: ProductType;
  @IsOptional() @IsIn(ACCEPTED_RAW_CONDITIONS) rawCondition?: RawCondition;
  @IsOptional() @IsIn(FINISHES) finish?: Finish;
  // v1.30 (§4.29): productId OPCIONAL por-ítem (misma semántica que el quote por-carta). Presente ⇒ la
  // línea es ESE CardProduct separado; errores por-ítem PRODUCT_NOT_FOUND / PRODUCT_CARD_MISMATCH (ok:false).
  @IsOptional() @IsInt() @Min(1) productId?: number;
}

/**
 * v1.15 (§4.16b) — `POST /buylist/quote/batch`. `items` no vacío (`@ArrayNotEmpty`) y con tope
 * `BUYLIST_QUOTE_BATCH_MAX` (`@ArrayMaxSize`). Vacío o sobre-cap → 400 VALIDATION_ERROR (nivel
 * request). Los errores de cada carta (NOT_FOUND / FINISH_NOT_AVAILABLE) son POR-ÍTEM (HTTP 200).
 */
export class BatchQuoteDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BUYLIST_QUOTE_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => BuylistQuoteItemDto)
  items!: BuylistQuoteItemDto[];
}

export class RequestItemDto {
  @IsString() cardId!: string;
  @IsIn(PRODUCT_TYPE_VALUES) productType!: ProductType;
  @IsOptional() @IsIn(ACCEPTED_RAW_CONDITIONS) rawCondition?: RawCondition;
  // v1.6-finish: acabado del item (default normal), validado contra card.availableFinishes.
  @IsOptional() @IsIn(FINISHES) finish?: Finish;
  // v1.30 (§4.29): productId OPCIONAL/ADITIVO. Presente ⇒ la línea es ESE CardProduct separado — se
  // snapshotea en SellRequestItem.cardProductId (== productId TCGplayer).
  // ⚠️ CORREGIDO en v1.51 (M-46, §4.39d): este comentario decía «y al convertir a inventario la pieza
  // queda ligada a ese producto», y era **FALSO desde v1.30** — `InventoryItem` NO tenía columna
  // `cardProductId` y `convertToInventory` no la propagaba ni podía. **M-46 crea la columna y la
  // propagación**, así que ahora sí: al convertir, la pieza queda ligada a **ESE** producto vía
  // `InventoryItem.cardProductId`. Deuda documental registrada en `docs/TECH_DEBT.md` (INV-D7).
  // Dos ítems con mismo (cardId, finish) y distinto productId son
  // líneas físicas DISTINTAS. productId inexistente → 422 PRODUCT_NOT_FOUND; que no cuelga → 422
  // PRODUCT_CARD_MISMATCH. Entero positivo.
  @IsOptional() @IsInt() @Min(1) productId?: number;
  // v1.3.1: `category` REMOVIDO. El backend deriva la regla server-side de Card.rarity (SEC-A1);
  // un `category` que envíe el cliente lo descarta el ValidationPipe (whitelist).
}

export class CreateRequestDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => RequestItemDto)
  items!: RequestItemDto[];
  // v1.15 (ARCHITECTURE §4.16a, PII): `clabe` OPCIONAL. Si se omite, el backend resuelve la CLABE
  // del PROPIO usuario en archivo (KycProfile.clabeEnc, desencriptada — misma fuente que
  // reveal-clabe); si tampoco hay en archivo → 422 CLABE_REQUIRED. Con `clabe` presente el flujo
  // no cambia (formato 18 dígitos → CLABE_INVALID; nombre propio por blind index → CLABE_NOT_OWN_NAME).
  @IsOptional() @IsString() clabe?: string;
  @IsOptional() @IsObject() ineUploadKeys?: { front: string; back: string };
}

export class RespondDto {
  @IsIn(['accept', 'decline']) decision!: 'accept' | 'decline';
}

/**
 * v1.51 (§M5, §4.39h) — UNA LÍNEA del cherry-pick al ofertar (D26, criterio 148).
 *
 * ⚠️ **SEC-A1: el monto DERIVADO no viaja aquí.** Lo calcula el servidor con `decideBuyLine` y la
 * curva vigente. Lo único que el cliente puede mandar es un **override explícito** — y **con motivo**,
 * que es lo que lo convierte en una decisión revisable en vez de una cifra huérfana.
 */
export class OfferLineDto {
  @IsString() @IsNotEmpty() itemId!: string;
  @IsIn(['buy', 'skip']) decision!: 'buy' | 'skip';
  // Cota dura de sanidad (la misma que `approvedPriceCents`); la cota FINA —el tope del operador
  // sobre el bruto resultante— la impone el servicio. `0` es un monto legal de override: nunca se
  // ofertaría, pero el DTO no es el sitio donde se decide eso (lo frena el piso de neto).
  @IsOptional() @IsInt() @Min(0) @Max(MAX_APPROVED_PRICE_CENTS) overridePriceCents?: number;
  // OBLIGATORIO ⇔ el override difiere del derivado — condición que **solo el servidor puede
  // evaluar** (necesita el derivado). Por eso aquí es opcional y el `422 OVERRIDE_REASON_REQUIRED`
  // sale del servicio, no del pipe. El pipe sí impone la LONGITUD cuando viene.
  @IsOptional() @IsString() @Length(3, 500) overrideReason?: string;
}

/**
 * v1.51 (§M5) — `POST /admin/buylist/:id/offer`. **Las líneas deben cubrir EXACTAMENTE los ítems de
 * la solicitud** (ni faltar ni sobrar); eso lo valida el servicio con `422 OFFER_LINES_MISMATCH`,
 * porque el pipe no conoce la solicitud.
 */
export class OfferDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => OfferLineDto)
  lines!: OfferLineDto[];
}

/** v1.51 (§M5) — `POST /admin/buylist/:id/offer/cancel`. Motivo INTERNO (no PII), va al AuditLog. */
export class OfferCancelDto {
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

/**
 * v1.51 (§6) — `POST /buylist/requests/:id/offer-response`. **`{ decision }` y NADA MÁS.**
 *
 * ⚠️ **SEC-A1 (criterio 120): la defensa es LA FORMA DEL DTO, no una validación.** No hay campo de
 * monto que manipular, así que una petición manipulada **no puede cambiar lo ofertado**; todo campo
 * extra lo descarta el `ValidationPipe` (whitelist). **Todo-o-nada** (D1): no existe vía para aceptar
 * solo algunas líneas ni para contraofertar.
 */
export class OfferResponseDto {
  @IsIn(['accept', 'reject']) decision!: 'accept' | 'reject';
}

/**
 * v1.51 (§M5, D19) — `POST /admin/buylist/:id/guide`.
 *
 * ⚠️ **NO HAY INTEGRACIÓN CON PAQUETERÍA, y es alcance CERRADO:** sin compra automática, sin
 * cotización de tarifas, sin rastreo en vivo y **sin validación del número contra el transportista**.
 * **El sistema solo guarda y muestra.** Por eso el DTO valida forma (longitud, trim) y nada más:
 * fingir una validación de guía sería prometer una verificación que no existe.
 */
export class GuideDto {
  @IsString() @Length(1, 100) carrier!: string;
  @IsString() @Length(1, 100) trackingNumber!: string;
}

/**
 * v1.51.1 (§M5) — `POST /admin/buylist/:id/confirm-shipment`. El costo REAL de la etiqueta es
 * **OPCIONAL** (fallback a la tarifa congelada).
 *
 * ⚠️ **FRONTERA MONEY-SAFE: este número NO ENTRA JAMÁS en `payoutNetCents`.** Al vendedor se le
 * descuenta **la tarifa congelada que aceptó**, cueste lo que cueste la etiqueta real (D25/criterio
 * 157). Es insumo **de reporte**, no de pago.
 */
export class ConfirmShipmentDto {
  @IsOptional() @IsInt() @Min(0) guideActualCostCents?: number;
}

/** v1.51.1 (§M5, D22) — `POST /admin/buylist/:id/guide/cancellation-done`. Misma frontera money-safe. */
export class GuideCancellationDoneDto {
  @IsOptional() @IsString() @Length(0, 500) note?: string;
  @IsOptional() @IsInt() @Min(0) guideActualCostCents?: number;
}

/**
 * v1.51.3 (§M5, D39) — `POST /admin/buylist/:id/decline`. Body vacío `{}` es válido.
 *
 * ⚠️ El `reason` es **motivo INTERNO, NO PII**: va al `AuditLog` y **NUNCA se le muestra al
 * vendedor ni entra al correo** — el correo 4 tiene **prohibido** explicar por qué no ofertamos.
 * **No lleva columna**: `declinedBy` + `closedAt` + la bitácora ya guardan el acto entero.
 */
export class DeclineDto {
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

/**
 * v1.51.4 (§M5, BL-13) — `PATCH /admin/buylist/:id/pickup-address`.
 *
 * ⚠️ **NI EL CLIENTE NI EL ADMIN ESCRIBEN UN DOMICILIO: los dos ELIGEN una fila** de la libreta del
 * vendedor. *La defensa es la forma del DTO: no hay campo de dirección que manipular.* Si el vendedor
 * no tiene la buena en su libreta, **la añade ÉL** y el operador la selecciona — para eso el operador
 * tiene su teléfono (D12). ⛔ Prohibido teclearla, copiarla de un pedido o derivarla del KYC.
 */
export class AdminPickupAddressDto {
  @IsString() @IsNotEmpty() addressId!: string;
}

export class ItemDecisionDto {
  @IsIn(['approve', 'adjust', 'reject']) decision!: 'approve' | 'adjust' | 'reject';
  // B-4: cota dura de sanidad (MX$10,000). La cota fina (≤ quoted × factor y ≤ tope por
  // solicitud) la impone `BuylistService.itemDecision` server-side.
  @IsOptional() @IsInt() @Min(0) @Max(MAX_APPROVED_PRICE_CENTS) approvedPriceCents?: number;
  // v1.18-buylist-rejects (§M5): motivo del rechazo — OBLIGATORIO con decision:"reject"
  // (3–500 chars; falta/vacío → 400 VALIDATION_ERROR vía ValidationPipe). Para approve/adjust se
  // IGNORA (no se valida ni se persiste). El servicio re-valida (defensa en profundidad, con trim).
  @ValidateIf((o: ItemDecisionDto) => o.decision === 'reject')
  @IsString()
  @Length(3, 500)
  reason?: string;
}

/**
 * v1.18-buylist-rejects (§M5): query de `GET /admin/buylist/rejected-items`. Paginación inválida
 * (no entera, <1, pageSize>100) → 400 VALIDATION_ERROR (norma del contrato, a diferencia del
 * clamp del listado legacy). `userId?` filtra por vendedor (simetría F1).
 */
export class RejectedItemsQueryDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class PaySpeiDto {
  @IsString() speiReference!: string;
}

/**
 * v1.24-buylist-request-reject (§M5): body de `POST /admin/buylist/:id/reject` (botón «Rechazar
 * solicitud»). `reason` OPCIONAL (0–500 chars) — motivo INTERNO del cierre a nivel solicitud, NO
 * PII, va al AuditLog (`after`); no se expone al cliente ni a correo (no hay correo en este flujo).
 * Body vacío `{}` es válido.
 */
export class RejectRequestDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/**
 * v1.51.18 (fase 8, §M5 · ARCHITECTURE §4.39m.3) — body de
 * `POST /admin/buylist/items/:itemId/convert-to-inventory`.
 *
 * ⚠️ **`locationId` es OPCIONAL y es el ÚNICO campo.** Se **ofrece** para no obligar a un segundo
 * viaje, pero **no se exige**: *bloquear la conversión por falta de ubicación atoraría el flujo de
 * pago, y el pago al vendedor no puede depender de que ya sepamos en qué caja va la carta* (criterio
 * 125). La pieza sin ubicación **sale SEÑALADA** en `pending-publish`, no bloqueada.
 *
 * ⛔ **NO existe `listPriceCents` aquí, y no es un olvido** (D10, criterio 126): *en todo el ciclo de
 * buylist **no existe** ningún campo para capturar el **precio de venta***, ni se «hereda» el precio
 * de compra como precio de venta. Lo fija la curva (§N.1) con su precedencia money-safe. **La defensa
 * es la FORMA DEL DTO**, no una validación: no hay campo que manipular (el `ValidationPipe` con
 * whitelist descarta cualquier extra).
 */
export class ConvertToInventoryDto {
  @IsOptional() @IsString() locationId?: string;
}

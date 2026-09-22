import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  Address,
  Card,
  CardSet,
  Finish,
  FulfillmentMode,
  InventoryItem,
  MovementReason,
  Prisma,
  SealedCondition,
  ShipmentItem,
  ShipmentRequest,
  ShipmentStatus,
  VaultLocation,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { ErrorCodeType } from '../../common/error-codes';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { StripeService } from '../payments/stripe.service';
import {
  PRICE_CONVENTION_OF_NEW_ROWS,
  computeShipmentBreakdown,
  shippingFeeDisplayCentsOf,
} from '../../common/money';
import { parseEnumFilter } from '../../common/enum-filter';
// ⭐ v1.78.2 (§M4-PREP): la gramática de «date-only» es UNA en el repo; ⛔ no se escribe una tercera.
import { DATE_ONLY_RE } from '../../common/admin-list-filters';
import { runSerializable } from '../../common/serializable-retry';
import { MAIL_PORT, MailMessage, MailPort } from '../mail/mail.port';
import {
  ShipmentNoticeParams,
  shipmentCancelledTemplate,
  shipmentGuideTemplate,
  shipmentShippedTemplate,
} from './mail/shipment-notice.templates';

/** `P-84` · clase **E** (§4.37): estados de envío filtrables, DERIVADOS del schema. */
const SHIPMENT_STATUS_FILTER_VALUES: readonly ShipmentStatus[] = Object.values(ShipmentStatus);

/**
 * `EQ-D1` — dominio de `?kind=` de `GET /admin/shipments` (§M4). Clase **R**: NO es un enum de
 * Prisma 1:1 sino un **subconjunto semántico** que parte los envíos por naturaleza
 * (`guest_direct_ship` = tiene orden; `vault_withdrawal` = retiro de bóveda, sin orden), fijado por
 * `API_CONTRACT §M4`. Antes: `if (kind === 'guest_direct_ship')…` ⇒ un valor desconocido se
 * **ignoraba en silencio** (§0-Q punto 1 lo prohíbe). Ahora fuera de dominio ⇒ `400`.
 */
export const SHIPMENT_KIND_VALUES = ['guest_direct_ship', 'vault_withdrawal'] as const;
export type ShipmentKind = (typeof SHIPMENT_KIND_VALUES)[number];

/**
 * §M4-PREP — dominio de `?destination=` de `GET /admin/shipments/picking-list`.
 *
 * ⛔ **NO es un enum de dominio.** `PreparationDestination` es un **tipo de DTO**: se DERIVA de
 * `Order.fulfillmentMode` y sus valores (`vault`/`ship`) **no coinciden** con los del enum de Prisma
 * (`vault`/`direct_ship`), así que ⛔ no se declara en el bloque «Enums (fuente de verdad)» ni entra
 * en la paridad de enums (`enum-values-parity.spec.ts`). El mapeo es explícito y vive en
 * `destinationOf`, abajo.
 *
 * El ORDEN de los tokens es normativo: el contrato fija `details.allowed = ['vault','ship']` para el
 * `400` de §0-Q, y ese array sale literalmente de aquí (`parseEnumFilter`).
 */
export const PREPARATION_DESTINATION_VALUES = ['vault', 'ship'] as const;
export type PreparationDestination = (typeof PREPARATION_DESTINATION_VALUES)[number];

/**
 * §M4-PREP / CA #11 — el código `"UNASSIGNED"` **deja de viajar por el cable**. El back manda el
 * ESTADO (`kind`) y, cuando lo hay, el DATO (`label`), para que el front no compare strings.
 */
/**
 * §M4-PREP / CA #11 — el código `"UNASSIGNED"` **deja de viajar por el cable**. El back manda el
 * ESTADO y, con él, su etiqueta.
 *
 * ### ⭐⭐ v1.78.2 — UNIÓN DISCRIMINADA, ⛔ ya NO `{ kind; label? }`
 * Con `label` **opcional**, el estado `{kind:'assigned'}` —asignada, pero sin etiqueta a la que
 * caminar— era **representable**, y cada consumidor tenía que re-derivar con su propio predicado si
 * era caminable o no. Aquí `assigned` ⇒ **hay etiqueta**, por el tipo: el estado ilegal deja de
 * existir en vez de estar prohibido por un comentario.
 *
 * ### ⛔ Y esto REVIERTE una decisión mía, que el arquitecto refutó con una medición mejor
 * Yo había servido `{kind:'assigned'}` sin `label` ante una etiqueta en blanco, argumentando que
 * «`kind` describe la FILA y `label` el TEXTO: son dos hechos». El argumento es cierto **en la tabla**
 * y **ocioso en esta hoja**: este DTO no espeja `VaultLocation`, es la hoja de trabajo del operador,
 * cuya única pregunta es *«¿hay sitio al que caminar?»*. Y sobre todo, **estaba defendiendo un
 * fantasma** — re-medido por mí, no aceptado de palabra:
 *
 * ```
 * grep -rn "vaultLocation\.(create|update|upsert|createMany|updateMany)" src/ prisma/
 * ```
 * ⇒ **un solo escritor de producción**, `inventory.service.ts` · `createLocation`, que **compone**
 * `` `${box}-${row}-${slot}` `` ⇒ **siempre trae los dos guiones**, aunque los tres componentes
 * vinieran vacíos (`"--"`); los otros tres son *seeds* con etiqueta literal; y **ninguno actualiza
 * `label`**. El único sitio del repositorio que escribe una etiqueta en blanco es **mi propio
 * fixture de prueba**. ⇒ el estado que yo defendía **no lo produce el sistema**, y el precio de
 * defenderlo era un estado ilegal **permanente** en un DTO que otros consumen. *El dato gana.*
 */
export type LocationView = { kind: 'assigned'; label: string } | { kind: 'unassigned' };

/** §M4-PREP — una CARTA dentro de un pedido a preparar. */
export interface PreparationItemDTO {
  shipmentItemId: string;
  inventoryItemId: string;
  folio: string;
  /** SIEMPRE 1: un `ShipmentItem` **es** una pieza física y no hay columna de cantidad. */
  quantity: number;
  card: {
    name: string;
    setName: string | null;
    finish: Finish;
    /** Compuesta EN EL BACK por precedencia (ver `conditionLabelOf`). */
    conditionLabel: string;
    imageSmallUrl: string | null;
  };
  currentLocation: LocationView;
}

/** §M4-PREP — un elemento = UN envío/pedido a preparar (⛔ NO una pieza). */
export interface PreparationOrderDTO {
  shipmentId: string;
  orderId: string | null;
  orderNumber: string | null;
  destination: PreparationDestination;
  requestedAt: string;
  /**
   * ⭐ **v1.78.1 — `fullName` es `string | null`, y ⛔ `''` queda PROHIBIDA como marca de ausencia.**
   * La fuente del INVITADO (`addressSnapshot.recipientName`) **puede faltar** en los snapshots de 8
   * campos anteriores a v1.67, igual que `shipTo.recipientName`, que el contrato ya declaraba
   * nullable. `null` es la **única** grafía de «no hay nombre» en todo este DTO (`lastName`,
   * `orderId`, `orderNumber`, `shipTo.recipientName`): `""` renderiza como un hueco invisible, no se
   * distingue de un nombre vacío legítimo y obliga a cada consumidor a escribir `if (!x)`.
   */
  customer: { lastName: string | null; fullName: string | null };
  shipTo?: {
    recipientName: string | null;
    line1: string;
    line2?: string | null;
    neighborhood?: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone: string;
  };
  items: PreparationItemDTO[];
}

/**
 * §M4-PREP — etiqueta del SELLADO. `Record<SealedCondition, string>` y no un `switch` con `default`:
 * un valor nuevo en el enum **rompe la compilación aquí**, en el punto exacto donde falta decidir
 * cómo se le habla al operador. (⛔ No es una lista literal de enum: las llaves son del `Record`
 * tipado, no un array a mano — §4.37.)
 */
const SEALED_CONDITION_LABELS: Record<SealedCondition, string> = {
  mint: 'Mint',
  minor_box_damage: 'Minor box damage',
};

/**
 * ⭐⭐ **§M4-PREP v1.78.1 — «un hecho, una grafía». La ausencia se escribe `null`, y SOLO `null`.**
 *
 * ### El defecto que lo trae (`B-1`, bloqueante de QA, medido por HTTP contra Postgres real)
 * v1.78.1 declaró `null` como única marca de ausencia y ⛔ prohibió `""`. Este módulo lo cerró **a
 * medias**: `?? null` cae ante `null`/`undefined` **pero no ante `""` ni `"   "`**, así que una
 * fuente que existe VACÍA pasaba intacta por el cable. En la cola viva salieron **las tres grafías
 * del mismo hecho una debajo de otra**: `""`, `"   "` y `null`. *Cerrar «la llave no existe» y dejar
 * abierta «la llave existe vacía» no es medio arreglo: es el mismo defecto con menos superficie.*
 *
 * Y es alcanzable, no teórico: `guest-checkout.dto.ts` valida `recipientName` con `@IsString()
 * @MaxLength(120)` **sin `@IsNotEmpty()`**, y `auth.dto.ts` valida `name` con `@MinLength(1)`
 * **sin `trim`** ⇒ `""` y `"   "` llegan a la base. (⚠️ Endurecer esas DOS validaciones de ENTRADA
 * es más ancho y toca el checkout: queda como **seguimiento**, no en este pase.)
 *
 * ### Por qué un helper y no un `if` en cada campo
 * Es la lección de `§M5-T` aplicada a un DTO: *«el defecto no fue que a dos métodos les faltara un
 * `where`; fue que la regla estaba escrita en un solo sitio, así que faltar era gratis»*. Con la
 * regla en **una** función, un campo nullable nuevo que no la use es una omisión **visible** —y el
 * censo de `shipments.picking-list.spec.ts` la pone roja.
 *
 * ⛔ **Devuelve el valor ORIGINAL, sin recortar, cuando NO está en blanco.** El `trim()` decide si
 * hay ausencia; ⛔ no «arregla» el dato. Misma doctrina que `parseEnumFilter` (§0-Q: *el `trim()`
 * decide si viene VACÍO, no normaliza el token*). Recortar aquí convertiría `"Ana "` en otro dato
 * del que el operador no pidió cambio.
 */
function nullIfBlank(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v.trim() === '' ? null : v;
}

/** El join a `Order` que §M4-PREP necesita: el folio legible y el discriminador de destino. */
type PreparationOrderJoin = { orderNumber: string | null; fulfillmentMode: FulfillmentMode } | null;

/** `ShipmentItem` con la pieza, su carta (+set) y su ubicación resueltas (§M4-PREP). */
type PreparationShipmentItem = ShipmentItem & {
  inventoryItem: InventoryItem & {
    card: Card & { set: CardSet | null };
    location: VaultLocation | null;
  };
};

/** La fila de `ShipmentRequest` tal como la trae el `include` de `pickingList`. */
type PreparationShipmentRow = ShipmentRequest & {
  items: PreparationShipmentItem[];
  order?: PreparationOrderJoin;
  user?: { name: string } | null;
};

/** ShipmentItem con la carta (y su set) resueltos, para el ClientShipmentItemDTO (v1.17). */
type EnrichedShipmentItem = ShipmentItem & {
  inventoryItem: InventoryItem & { card: Card & { set: CardSet | null } };
};

/**
 * v2.1.9 (S49-R4) — **lista blanca de `ShipmentRequest` para las respuestas de BACK-OFFICE.**
 *
 * `withAdminKind` esparcía la fila entera (`...row`) y `setTracking`/`updateStatus` devolvían la
 * entidad Prisma directa. Ninguna columna de hoy es un secreto **para M4** —`shippingCostCents` es
 * costo interno y este rol SÍ debe verlo (§M4)— pero la fila cruda es justo lo que hace que una
 * columna futura se publique sola. Esta lista fija la forma ACTUAL: no cambia nada visible, y a
 * partir de aquí exponer algo nuevo exige escribirlo aquí a propósito.
 *
 * ⚠ `shippingCostCents` es **admin-only por contrato** (§M4: «no se expone al cliente»). Su ausencia
 * en `toClientShipment` es deliberada — no la "completes" por simetría.
 */
function toAdminShipmentRow(s: ShipmentRequest) {
  return {
    id: s.id,
    userId: s.userId,
    orderId: s.orderId,
    addressSnapshot: s.addressSnapshot,
    status: s.status,
    shippingFeeCents: s.shippingFeeCents,
    // ⚠️ Los DOS, y en pareja: `shippingCostCents` es **BRUTO** (el total de la factura) y
    // `shippingCostIvaCents` su **IVA acreditable congelado**. Publicar solo el bruto dejaba al
    // operador sin poder comprobar la resta que el P&L hace con su captura. Admin-only (§M4).
    shippingCostCents: s.shippingCostCents,
    shippingCostIvaCents: s.shippingCostIvaCents,
    ivaCents: s.ivaCents,
    processingFeeCents: s.processingFeeCents,
    totalCents: s.totalCents,
    stripePaymentIntentId: s.stripePaymentIntentId,
    carrier: s.carrier,
    trackingNumber: s.trackingNumber,
    requestedAt: s.requestedAt,
    pickingAt: s.pickingAt,
    shippedAt: s.shippedAt,
    deliveredAt: s.deliveredAt,
  };
}

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly stripe: StripeService,
    // v1.74 (§R) — el correo de los avisos `AV-4`/`AV-5`/`AV-6`. `@Optional()` por el MISMO motivo
    // que en `buylist` y en `orders`: los tests unitarios legacy construyen el servicio a mano, y el
    // envío es **best-effort** (⛔ jamás puede hacer fallar el `PATCH`/`POST` que lo dispara).
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  /**
   * ⭐ El desglose del retiro de bóveda. La tarifa EXHIBIDA `E = round(F × (1 + t·r))` lleva su IVA
   * dentro (§4.44.f); `F` (el dial `shipping_fee_cents`) sigue siendo NETO y no cambia de valor.
   * **Money-neutral con el dial en 100 %:** `round(17500 × 1.16) = 20300 = 17500 + 2800`.
   */
  private async breakdown() {
    const dials = await this.settings.getIvaDials();
    const shippingFeeCents = shippingFeeDisplayCentsOf(
      await this.settings.getNumber(SettingKey.SHIPPING_FEE_CENTS),
      dials,
    );
    const fee = await this.settings.getStripeFee();
    return computeShipmentBreakdown(shippingFeeCents, dials.ivaRatePct, fee);
  }

  private async validateAddress(userId: string, addressId: string) {
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) throw BusinessException.notFound();
    if (address.country !== 'MX') {
      throw BusinessException.validation('ADDRESS_NOT_MX', 'Only MX addresses allowed');
    }
    return address;
  }

  /**
   * v1.67 (M-52, contrato §0 `RECIPIENT_NAME_REQUIRED` / §5; ARCHITECTURE §4.47.4) — sin destinatario
   * no hay etiqueta. Una dirección anterior a la migración tiene `recipientName IS NULL`: se rechaza
   * con `422 RECIPIENT_NAME_REQUIRED` en LECTURA (`quote`) y en ESCRITURA (`create`) — read y write
   * comparten regla, como `withdrawable` ↔ elegibilidad. En `create` corre ANTES de la transacción
   * serializable y ANTES del PaymentIntent: un retiro nunca nace sin destinatario.
   * ⛔ Prohibido el fallback a `User.name` (puede ser fabricado, `nameSource='derived'`; y aunque no
   * lo fuera, el nombre de cuenta y el de quien recibe el paquete son hechos distintos). Remedio del
   * cliente: `PATCH /users/me/addresses/:id { recipientName }` y reintentar — hermano exacto de
   * `PHONE_REQUIRED` / `PICKUP_ADDRESS_REQUIRED`.
   */
  private assertRecipientName(address: Address): string {
    const name = address.recipientName?.trim() ?? '';
    if (name.length === 0) {
      throw BusinessException.validation(
        'RECIPIENT_NAME_REQUIRED',
        'The selected address has no recipient name; add one and retry',
        { field: 'recipientName', addressId: address.id },
      );
    }
    return name;
  }

  /**
   * Clasifica items en elegibles (settled + EN CUSTODIA, del usuario) e inelegibles con razón.
   *
   * SEC-H1 (WS-H): la elegibilidad exige `status === 'in_custody'` como criterio POSITIVO —
   * cualquier otro `status` (incl. `withdrawn`) es INELEGIBLE. La transición terminal de un
   * envío entregado deja `status='withdrawn'` CONSERVANDO `ownershipStatus='settled'`; sin este
   * gate un item ya entregado (fuera de la bóveda) pasaría los checks y se le cobraría un nuevo
   * envío por Stripe (doble-retiro). Así el criterio de creación queda IDÉNTICO al flag de
   * lectura `withdrawable` del HoldingDTO (settled && status==='in_custody' && sin envío activo).
   */
  private async classifyItems(userId: string, ids: string[]) {
    const items = await this.prisma.inventoryItem.findMany({ where: { id: { in: ids } } });
    const eligibleItemIds: string[] = [];
    const ineligible: { inventoryItemId: string; reason: string }[] = [];
    for (const id of ids) {
      const item = items.find((i) => i.id === id);
      if (!item || item.ownerUserId !== userId) {
        ineligible.push({ inventoryItemId: id, reason: 'NOT_FOUND' });
        continue;
      }
      if (item.ownershipStatus !== 'settled') {
        ineligible.push({ inventoryItemId: id, reason: 'ITEM_NOT_SETTLED' });
        continue;
      }
      // SEC-H1: criterio positivo — solo un item EN CUSTODIA es retirable. Un `withdrawn`
      // (settled preservado) o cualquier otro estado no lo es.
      if (item.status !== 'in_custody') {
        ineligible.push({ inventoryItemId: id, reason: 'ITEM_NOT_IN_CUSTODY' });
        continue;
      }
      eligibleItemIds.push(id);
    }
    return { eligibleItemIds, ineligible };
  }

  async quote(userId: string, inventoryItemIds: string[], addressId: string) {
    const address = await this.validateAddress(userId, addressId);
    this.assertRecipientName(address); // v1.67: misma regla que `create` (lectura y escritura)
    const { eligibleItemIds, ineligible } = await this.classifyItems(userId, inventoryItemIds);
    const breakdown = await this.breakdown();
    return { breakdown, eligibleItemIds, ineligible };
  }

  /**
   * Crea la solicitud de retiro. Cobra envío+IVA+fee por Stripe ANTES (nace en
   * `solicitado` con el PaymentIntent). Solo items settled. ARCHITECTURE §10.6.
   */
  async create(
    userId: string,
    inventoryItemIds: string[],
    addressId: string,
    idempotencyKey?: string,
  ) {
    const address = await this.validateAddress(userId, addressId);
    // v1.67: rechazo ANTES de la tx serializable y ANTES del PaymentIntent (contrato §5).
    const recipientName = this.assertRecipientName(address);
    const { ineligible } = await this.classifyItems(userId, inventoryItemIds);
    if (ineligible.length > 0) {
      // Prioridad de reporte: settled → in_custody → not_found. Todos 422 (validación).
      // SEC-H1: `ITEM_NOT_IN_CUSTODY` cubre el intento de re-retirar un item ya `withdrawn`.
      const reasons = new Set(ineligible.map((i) => i.reason));
      const code: ErrorCodeType = reasons.has('ITEM_NOT_SETTLED')
        ? 'ITEM_NOT_SETTLED'
        : reasons.has('ITEM_NOT_IN_CUSTODY')
          ? 'ITEM_NOT_IN_CUSTODY'
          : 'NOT_FOUND';
      throw BusinessException.validation(code, 'Some items are not eligible', { ineligible });
    }

    const breakdown = await this.breakdown();

    // SEC-H2 (WS-H): el chequeo anti-doble-envío + la creación de la ShipmentRequest/items
    // van en UNA transacción SERIALIZABLE (mismo patrón atómico que la reserva de checkout,
    // orders.service, y el tope AML de buylist). Cierra la ventana TOCTOU: dos POST /shipments
    // concurrentes del mismo item ya no pueden pasar ambos el `findFirst` y crear dos envíos
    // (+ dos PaymentIntents) — el aislamiento serializable aborta a uno por conflicto de
    // lectura/escritura. La creación del PaymentIntent (Stripe) queda FUERA de la tx a
    // propósito (A2/BE-7: no bloquear una conexión de DB en una llamada de red; el rollback
    // compensatorio borra la ShipmentRequest si Stripe falla). Nota: el índice único parcial
    // sobre ShipmentItem.inventoryItemId (defensa en profundidad) queda como deuda BE-42.
    const shipment = await runSerializable(
      this.prisma,
      async (tx) => {
        // Un item no puede estar en dos envíos activos (re-verificado DENTRO de la tx).
        const active = await tx.shipmentItem.findFirst({
          where: {
            inventoryItemId: { in: inventoryItemIds },
            shipmentRequest: { status: { notIn: ['cancelado', 'entregado'] } },
          },
        });
        if (active) {
          throw BusinessException.conflict(
            'ITEM_IN_ANOTHER_SHIPMENT',
            'Item already in a shipment',
          );
        }
        // PROJECTION-EXEMPT: return DENTRO de la `$transaction`; el caller (`create`) proyecta a
        // `{ shipmentId, status, breakdown, stripe }` (contrato §5).
        return tx.shipmentRequest.create({
          data: {
            userId,
            // v1.67 (M-52, contrato §5): NUEVE campos, los MISMOS que `Order.shippingAddressSnapshot`
            // del invitado. `recipientName` se copia de `Address.recipientName` TAL CUAL (jamás de
            // `User.name`). Un snapshot no se reescribe (§5.2): los retiros anteriores conservan ocho.
            addressSnapshot: {
              recipientName,
              line1: address.line1,
              line2: address.line2,
              neighborhood: address.neighborhood,
              city: address.city,
              state: address.state,
              postalCode: address.postalCode,
              country: address.country,
              phone: address.phone,
            },
            status: 'solicitado',
            shippingFeeCents: breakdown.subtotalCents,
            ivaCents: breakdown.ivaCents,
            processingFeeCents: breakdown.processingFeeCents,
            totalCents: breakdown.totalCents,
            // ⭐⭐ D56 / criterio **214** — el envío entra en la convención igual que una carta
            // (§4.44.f, criterio 189): `shippingFeeCents` ES `E` y **lleva su IVA dentro**, así que
            // la fila nace `IVA_INCLUSIVE`. ⛔ Ya no se apila `round(envío × r)` detrás.
            priceConvention: PRICE_CONVENTION_OF_NEW_ROWS,
            items: { create: inventoryItemIds.map((id) => ({ inventoryItemId: id })) },
          },
        });
      },
      { label: 'createShipmentRequest', logger: this.logger },
    );

    // M3: idempotency-key derivada en servidor (`pi-shipment-<id>`); header del cliente = override.
    const idem = idempotencyKey ?? `pi-shipment-${shipment.id}`;

    // A2 (cierra BE-7): PaymentIntent transaccional con la "reserva" (la ShipmentRequest,
    // que bloquea los items vía ITEM_IN_ANOTHER_SHIPMENT). Si Stripe falla tras crearla,
    // compensamos borrando la solicitud (cascada a sus items) para no dejar los items
    // atrapados en un envío nunca cobrado, y devolvemos un error de reintento.
    let pi: { id: string; clientSecret: string };
    try {
      pi = await this.stripe.createPaymentIntent({
        amountCents: breakdown.totalCents,
        metadata: { shipmentId: shipment.id, userId, kind: 'shipment' },
        idempotencyKey: idem,
      });
    } catch (e) {
      await this.prisma.shipmentRequest
        .delete({ where: { id: shipment.id } })
        .catch(() => undefined);
      throw this.toRetryError(e);
    }

    await this.prisma.shipmentRequest.update({
      where: { id: shipment.id },
      data: { stripePaymentIntentId: pi.id },
    });

    return {
      shipmentId: shipment.id,
      status: 'solicitado' as const,
      breakdown,
      stripe: { paymentIntentId: pi.id, clientSecret: pi.clientSecret },
    };
  }

  /** A2: fallo del proveedor de pago → error de reintento (503); errores de negocio se propagan. */
  private toRetryError(e: unknown): unknown {
    if (e instanceof BusinessException) return e;
    return BusinessException.retriable(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Payment provider unavailable; the shipment request was rolled back. Please retry.',
    );
  }

  /**
   * SEC-C1: proyección de CLIENTE. Allowlist explícita de los campos que el contrato
   * declara para el comprador (API_CONTRACT §5). Excluye `shippingCostCents` (costo
   * interno del carrier / dato de margen, marcado "no se expone al cliente" en §M4) y
   * cualquier campo no declarado. Es allowlist (no denylist/omit) a propósito: si el
   * modelo gana un campo interno futuro, NO se filtra por accidente. Los endpoints
   * ADMIN (`adminGet`/`adminList`) siguen devolviendo la fila cruda con el costo.
   */
  private toClientShipment<
    T extends ShipmentRequest & { items: EnrichedShipmentItem[] },
  >(s: T) {
    return {
      id: s.id,
      status: s.status,
      addressSnapshot: s.addressSnapshot,
      shippingFeeCents: s.shippingFeeCents,
      ivaCents: s.ivaCents,
      processingFeeCents: s.processingFeeCents,
      totalCents: s.totalCents,
      carrier: s.carrier,
      trackingNumber: s.trackingNumber,
      // Timestamps por etapa que existen en el modelo (no hay guiaAt; la etapa `guia`
      // se refleja por status + carrier/trackingNumber). API_CONTRACT §5.
      requestedAt: s.requestedAt,
      pickingAt: s.pickingAt,
      shippedAt: s.shippedAt,
      deliveredAt: s.deliveredAt,
      // v1.17: items enriquecidos (folio + acabado + carta) para la vista de rastreo.
      items: s.items.map((si) => this.toClientShipmentItem(si)),
    };
  }

  /** v1.17 — ClientShipmentItemDTO (API_CONTRACT §5). Sin costos internos ni PII. */
  private toClientShipmentItem(si: EnrichedShipmentItem) {
    const card = si.inventoryItem.card;
    return {
      inventoryItemId: si.inventoryItemId,
      folio: si.inventoryItem.folio,
      finish: si.inventoryItem.finish,
      card: {
        id: card.id,
        name: card.name,
        setName: card.set?.name ?? null,
        number: card.number,
        imageSmallUrl: card.imageSmallUrl,
      },
    };
  }

  /**
   * SEC (riesgo #1 de M-25): filtro POSITIVO por `userId = :sessionUser`. Con
   * `ShipmentRequest.userId` nullable, un envío de invitado (`userId=null`) JAMÁS debe aparecer en
   * la lista de nadie; una consulta del tipo `{ userId: { not: X } }` sí lo expondría. La guardia
   * explícita evita además que un `userId` vacío degenere en "traer todo".
   */
  async listMine(userId: string) {
    if (!userId) throw BusinessException.notFound();
    const rows = await this.prisma.shipmentRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      include: {
        items: { include: { inventoryItem: { include: { card: { include: { set: true } } } } } },
      },
    });
    return { data: rows.map((r) => this.toClientShipment(r)) };
  }

  async getMine(userId: string, id: string) {
    const shipment = await this.prisma.shipmentRequest.findUnique({
      where: { id },
      include: {
        items: { include: { inventoryItem: { include: { card: { include: { set: true } } } } } },
      },
    });
    // Comparación de dueño POSITIVA: `null !== :sessionUser` siempre, así que un envío directo de
    // invitado no es legible por ningún cliente (riesgo #1 de M-25).
    if (!userId || !shipment || shipment.userId !== userId) throw BusinessException.notFound();
    return this.toClientShipment(shipment);
  }

  // ---------------- Admin M4 ----------------

  async adminList(
    status: string | undefined,
    page: number,
    pageSize: number,
    userId?: string,
    kind?: string,
  ) {
    const where: Prisma.ShipmentRequestWhereInput = {};
    // `P-84` — aquí había un `status as never`: valor crudo al `where`, Prisma revienta y el filtro
    // global lo convierte en **`500 INTERNAL`** (medido por HTTP: `?status=banana` ⇒ `500`).
    // Clase **E**: derivado de `ShipmentStatus`.
    const statusFilter = parseEnumFilter('status', status, SHIPMENT_STATUS_FILTER_VALUES);
    if (statusFilter) where.status = statusFilter;
    // v1.7-admin-users: filtro opcional por ShipmentRequest.userId (simetría con /admin/orders).
    // Nota v1.21: un envío directo de invitado tiene `userId=null`, así que este filtro
    // simplemente no lo devuelve (comportamiento correcto para la ficha 360° de un usuario).
    if (userId) where.userId = userId;
    // v1.21-guest-checkout (§M4): filtro opcional por naturaleza del envío.
    // `EQ-D1` · clase **R**: ausente/vacío ⇒ no filtra; token del dominio ⇒ filtra; fuera de dominio
    // ⇒ `400` (antes se ignoraba en silencio). El `switch` es exhaustivo sobre el dominio ya validado.
    const kindFilter = parseEnumFilter('kind', kind, SHIPMENT_KIND_VALUES);
    if (kindFilter === 'guest_direct_ship') where.orderId = { not: null };
    else if (kindFilter === 'vault_withdrawal') where.orderId = null;
    const [data, total] = await Promise.all([
      this.prisma.shipmentRequest.findMany({
        where,
        orderBy: { requestedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          items: true,
          order: { select: { orderNumber: true, guestEmail: true, fulfillmentMode: true } },
        },
      }),
      this.prisma.shipmentRequest.count({ where }),
    ]);
    return { data: data.map((s) => this.withAdminKind(s)), page, pageSize, total };
  }

  async adminGet(id: string) {
    const shipment = await this.prisma.shipmentRequest.findUnique({
      where: { id },
      include: {
        items: { include: { inventoryItem: { include: { card: true, location: true } } } },
        order: { select: { orderNumber: true, guestEmail: true, fulfillmentMode: true } },
      },
    });
    if (!shipment) throw BusinessException.notFound();
    return this.withAdminKind(shipment);
  }

  /**
   * v1.21-guest-checkout (§M4, ADITIVO): la cola de M4 pasa a tener DOS tipos de envío. `kind` se
   * DERIVA de `orderId == null` (discriminador único); `orderNumber`/`guestEmail`/`recipientName`
   * dan al operador el contexto del pedido de invitado. Back-office protegido por rol: el correo
   * es dato de contacto operativo (mismo criterio que `AdminSellerRef.email` de §M5).
   */
  private withAdminKind<
    T extends ShipmentRequest & {
      order?: {
        orderNumber: string | null;
        guestEmail: string | null;
        fulfillmentMode: FulfillmentMode;
      } | null;
    },
  >(s: T) {
    const snapshot = (s.addressSnapshot ?? {}) as { recipientName?: string };
    const { order } = s;
    return {
      ...toAdminShipmentRow(s),
      // v1.21.2 (D4): `orderId == null` ⇒ retiro de bóveda; con orden vinculada, el `kind` se
      // resuelve LEYENDO `Order.fulfillmentMode` (nunca asumiendo `direct_ship` por tener orderId).
      kind:
        s.orderId == null
          ? ('vault_withdrawal' as const)
          : this.kindForFulfillment(order?.fulfillmentMode, s.id),
      orderNumber: order?.orderNumber ?? undefined,
      guestEmail: order?.guestEmail ?? undefined,
      recipientName: snapshot.recipientName ?? undefined,
    };
  }

  /**
   * v1.21.2 (D4, ARCHITECTURE §4.21d) — ¿este envío fulfilla una orden de ENVÍO DIRECTO?
   *
   * `ShipmentRequest.orderId` responde solo "¿de dónde viene?" (null ⇒ retiro de bóveda). El
   * COMPORTAMIENTO lo decide `Order.fulfillmentMode`, el único discriminador canónico de ruta de
   * fulfillment. El `switch` es EXHAUSTIVO y RUIDOSO: un modo nuevo (p. ej. `pickup_in_store`)
   * **rompe visiblemente aquí**, en el punto exacto donde falta decidir su transición terminal, en
   * vez de comportarse como un envío directo en silencio — que es el peor tipo de fallo.
   *
   * `vault` con `orderId != null` es una combinación IMPOSIBLE por invariante (un pedido a bóveda
   * no genera envío de fulfillment; su retiro nace del cliente y va sin `orderId`): si aparece es
   * corrupción de datos y se trata como error, NO se "arregla" en silencio.
   */
  private async isDirectShipFulfillment(shipment: ShipmentRequest): Promise<boolean> {
    if (shipment.orderId == null) return false; // retiro de bóveda
    const order = await this.prisma.order.findUnique({
      where: { id: shipment.orderId },
      select: { fulfillmentMode: true },
    });
    return this.kindForFulfillment(order?.fulfillmentMode, shipment.id) === 'guest_direct_ship';
  }

  /** Traduce `fulfillmentMode` → `kind` de §M4. Lanza ante un modo no soportado (D4). */
  private kindForFulfillment(
    mode: FulfillmentMode | undefined,
    shipmentId: string,
  ): 'guest_direct_ship' {
    switch (mode) {
      case 'direct_ship':
        return 'guest_direct_ship';
      case 'vault':
      case undefined:
      default: {
        const seen = mode ?? 'ORDEN_INEXISTENTE';
        this.logger.error(
          `ShipmentRequest ${shipmentId} tiene orderId pero su orden es '${seen}': combinación ` +
            'imposible por invariante (un pedido a bóveda no genera envío de fulfillment). Es ' +
            'corrupción de datos o un modo de fulfillment nuevo sin terminal definida.',
        );
        throw BusinessException.conflict(
          'CONFLICT',
          `Unsupported fulfillmentMode for shipment ${shipmentId}: ${seen}`,
        );
      }
    }
  }

  /**
   * ⭐⭐ **«Pedidos a preparar» — la cola del operador (API_CONTRACT §M4-PREP, v1.78).**
   *
   * **Qué cambió y qué NO.** La ruta (`GET /admin/shipments/picking-list`) y su guard
   * (`@Roles(vault_operator, super_admin)`) son los de siempre; lo único que cambia es el **DTO
   * proyectado**: deja de ser una lista PLANA de piezas ordenada por ubicación
   * (`{shipmentId, inventoryItemId, folio, location}`) y pasa a ser una **hoja de trabajo AGRUPADA
   * por pedido** (`PreparationOrderDTO[]`, **un elemento = UN envío/pedido**). Es el cambio de menor
   * radio de estallido: no toca ruteo, ni permisos, ni la máquina de estados.
   *
   * ⛔ **CERO schema.** Todo lo que despliega esta cola es proyección de columnas que YA existen
   * (`Card`+`CardSet`, `InventoryItem`, `VaultLocation`, `Order.fulfillmentMode`/`orderNumber`,
   * `ShipmentRequest.addressSnapshot`, `User.name`). Ni una migración, ni una columna, ni una cola.
   *
   * **Fix QA #3, intacto:** SOLO envíos ya liquidados (`status='picking'`). Un envío `solicitado` no
   * está pagado (solo avanza a `picking` tras `payment_intent.succeeded`) y preparar un retiro no
   * cobrado es justo lo que ese filtro existe para impedir.
   *
   * **Orden (CA #9):** pedidos por `requestedAt` **asc** — lo más viejo primero, lo pone el motor.
   * Las cartas DENTRO del pedido van por ubicación (asignadas ordenadas, `unassigned` al final), que
   * conserva el beneficio de «caminar por ubicación» que daba la lista plana de hoy.
   *
   * ### ⚠️ La cubeta `?destination=vault` devuelve VACÍO hoy, y es correcto que lo haga
   * Medido (arquitecto, 2026-09-22, y re-medido aquí): **todo** `ShipmentRequest` es físicamente un
   * ENVÍO a domicilio — un retiro de bóveda (`orderId == null`) o un envío directo (`orderId != null`
   * con `fulfillmentMode='direct_ship'`) ⇒ **toda fila de esta cola es `destination='ship'`**. Las
   * órdenes `fulfillmentMode='vault'` **no generan `ShipmentRequest`**: al liquidar, sus piezas pasan
   * `reserved → in_custody, settled` (`payments.service.ts`) y se quedan sin cola de colocación. El
   * filtro queda **declarado y listo**; alimentarlo exige decidir qué órdenes vault están pendientes
   * de colocar y cómo se marcan como colocadas — y eso pide schema. ⛔ Aquí NO se propone: se reporta.
   *
   * @param date filtro de día sobre `requestedAt` (se conserva tal cual de la versión anterior).
   * @param destination §0-Q (misma doctrina que `?kind=`): ausente/vacío ⇒ ambas cubetas; token del
   *   dominio ⇒ filtra; cualquier otra cosa ⇒ `400 VALIDATION_ERROR` con
   *   `details:{field:'destination', allowed:['vault','ship']}` **antes de tocar Prisma**.
   */
  async pickingList(date?: string, destination?: string) {
    // §0-Q PRIMERO: un token fuera de dominio muere aquí, antes de cualquier consulta.
    const destinationFilter = parseEnumFilter(
      'destination',
      destination,
      PREPARATION_DESTINATION_VALUES,
    );
    const where: Prisma.ShipmentRequestWhereInput = { status: 'picking' };
    const dia = ShipmentsService.parseDayFilter(date);
    if (dia) where.requestedAt = dia;
    const shipments = await this.prisma.shipmentRequest.findMany({
      where,
      // CA #9 — lo más viejo primero. Lo ordena el motor, no el proceso.
      orderBy: { requestedAt: 'asc' },
      include: {
        items: {
          include: {
            inventoryItem: { include: { card: { include: { set: true } }, location: true } },
          },
        },
        order: { select: { orderNumber: true, fulfillmentMode: true } },
        user: { select: { name: true } },
      },
    });
    const rows = shipments.map((s) => this.toPreparationOrder(s));
    // ⚠️ El filtro se aplica DESPUÉS de derivar, no en el `where`: `destination` no es una columna,
    // es una lectura de `Order.fulfillmentMode`, y la derivación es también el sitio donde la
    // combinación imposible `vault` + `orderId` se detecta y se denuncia (invariante). Filtrar en
    // SQL por el modo escondería esa corrupción justo en la cubeta donde importa.
    const data = destinationFilter ? rows.filter((r) => r.destination === destinationFilter) : rows;
    return { data };
  }

  /**
   * ⭐ **`I-1` — `?date=` malformado devuelve `400`, ⛔ ya no `500`.**
   *
   * **El defecto, medido por QA por HTTP:** `?date=banana` y `?date=2026-13-45` daban **`500
   * INTERNAL`**. `new Date('banana')` es un `Invalid Date`, que llegaba **crudo al `where`** y hacía
   * reventar a Prisma; el filtro global no mapea ese error. Es **textualmente** lo que el comentario
   * de `P-84` describe 160 líneas más arriba para `?status=` —*un `500` disparable desde la barra de
   * direcciones por cualquiera con sesión admin*— vivo en el eje de al lado. Preexistente a esta
   * reproyección (`git log` sobre el fichero lo confirma), pero la doctrina ya existía y el endpoint
   * es éste.
   *
   * **Conducta, con el precedente de `P-84` / §0-Q punto 1:**
   * - ausente, cadena **vacía** o **solo espacios** ⇒ **no filtra** (`200`, la cola entera). ⛔ Nunca
   *   `400`: un `<input type=date>` que el operador tocó y dejó en blanco manda cadena vacía, y las
   *   dos mitades hacen falta —`if (x)` deja pasar `' '` porque **un espacio es truthy**, y
   *   `x === ''` no lo atrapa porque **un espacio no es la cadena vacía**—.
   * - fecha parseable ⇒ **misma ventana de día que antes, sin cambio alguno** (`[d, d+24h)`).
   * - cualquier otra cosa ⇒ **`400 VALIDATION_ERROR`** con `details.field`, **antes de tocar Prisma**.
   *
   * ⚠️ **`details` = `{ field: 'date' }` y NADA MÁS** (v1.78.2 lo RATIFICA). ⛔ Sin `allowed` —un día
   * del calendario no se enumera, así que la gramática la explica el `message`— y ⛔ sin eco del valor
   * del cliente (§0-Q punto 2). El hermano `common/admin-list-filters.ts` emite `{ [field]: raw }`:
   * ésa es **grafía LEGADA que se congela donde está**, y ⛔ no la hereda un eje que nace hoy.
   * Unificar las dos formas es cambio de §0-Q ⇒ arquitecto (regla 9).
   *
   * ### ⭐⭐ v1.78.2 — el dominio se ESTRECHA a **date-only**, y esto SÍ cambia conducta
   * `new Date(raw)` aceptaba un **datetime ISO completo**, y en un eje que recibe **un día** (el otro
   * extremo lo inventa el endpoint: `+24h`) eso produce una **ventana deslizante que cruza dos días
   * del calendario**: `2026-09-20T14:30Z` ⇒ hasta el **21** a las 14:30. El operador **no puede
   * nombrar lo que le contestaron** y la cola responde en silencio **una pregunta distinta de la que
   * se hizo** — misma familia que el *clamp* silencioso que §0-Q punto 6 prohíbe. En `from`/`to` el
   * datetime sí tiene semántica (el cliente da los DOS extremos); **en un eje de un solo valor, no.**
   * **Coste medido (arquitecto, 2026-09-22): CERO llamadores** — la pantalla no manda `date` y el
   * endpoint es `@Roles(vault_operator, super_admin)`.
   *
   * **Hacen falta LAS DOS comprobaciones, no una:**
   * 1. **gramática** — `DATE_ONLY_RE`, **importada** de `common/admin-list-filters.ts`: la noción de
   *    «date-only» es **UNA** en el repositorio y ⛔ aquí no se escribe una tercera;
   * 2. **calendario** — `2026-13-45` y `2026-02-30` **pasan el `RegExp`**. ⛔ Su rechazo es `400`,
   *    **jamás `200` con lista vacía**: una lista vacía afirma *«ese día no hay nada que preparar»*,
   *    que es responder con un hecho a una pregunta ilegible.
   *
   * ### ⚠️⚠️ `Number.isNaN` NO cierra la segunda — MEDIDO, y por eso aquí hay un IDA Y VUELTA
   * §M4-PREP v1.78.2 prescribe *«`Number.isNaN(d.getTime())` sobre el `Date` construido cierra la
   * segunda»* y **eso es falso para uno de los dos ejemplos que la propia cláusula da.** Medido con
   * `node` el 2026-09-22:
   *
   * | entrada | `new Date(\`${t}T00:00:00.000Z\`)` |
   * |---|---|
   * | `2026-13-45` | **Invalid Date** ✅ |
   * | `2026-02-30` | **`2026-03-02`** ⛔ — NO es inválida: **DESBORDA en silencio** |
   * | `2026-04-31` | **`2026-05-01`** ⛔ |
   * | `2026-02-29` (2026 no es bisiesto) | **`2026-03-01`** ⛔ |
   * | `2024-02-29` (sí bisiesto) | `2024-02-29` ✅ — un día real que **debe** aceptarse |
   *
   * Con solo `isNaN`, `?date=2026-02-30` devolvería **`200` con la cola del 2 de marzo**: la cola
   * contesta **por otro día** sin decirlo — que es **exactamente** el defecto de la ventana
   * deslizante que esta misma versión acaba de cerrar, entrando por la otra puerta.
   *
   * ⇒ La comprobación es **ida y vuelta**: se construye el `Date` y se exige que **vuelva a
   * serializar el mismo token**. Acepta los bisiestos reales y rechaza todo desbordamiento. **La
   * NORMA del contrato (fila 3: día inexistente ⇒ `400`) se cumple; lo que no se sigue es el
   * MECANISMO sugerido, porque medido no la cumple.**
   *
   * ⚠️ **El mismo desbordamiento vive en `common/admin-list-filters.ts` (`?from=`/`?to=` de
   * `/admin/buylist` y `/admin/orders`): `from=2026-02-30` filtra por el 2 de marzo con `200`.**
   * ⛔ NO se arregla aquí —son otros endpoints con gates aprobados y cambiaría su conducta—: queda
   * reportado para el arquitecto.
   *
   * **Anclaje UTC y ventana medio abierta `[d, d+24h)`** — la misma convención transversal que §0 fija
   * para `from`/`to` (v1.25.1). ⚠️ Consecuencia aceptada: para el operador en CDMX (UTC−6) ese «día»
   * corre de 18:00 a 18:00 locales. ⛔ **Prohibido que este eje estrene una zona horaria propia**:
   * sería la segunda semántica de «día» del back-office, y la peor clase de segunda — invisible.
   */
  private static parseDayFilter(raw?: string): { gte: Date; lt: Date } | undefined {
    if (raw === undefined || raw === null) return undefined;
    const token = raw.trim();
    // Vacío / solo espacios ≡ ausente. ⛔ Nunca `400`: es lo que manda un `<input type=date>` que el
    // operador tocó y dejó en blanco. Las dos mitades hacen falta — `if (x)` deja pasar `' '`.
    if (token === '') return undefined;
    const d = DATE_ONLY_RE.test(token) ? new Date(`${token}T00:00:00.000Z`) : new Date(NaN);
    // ⚠️ IDA Y VUELTA, no `isNaN` a secas: `2026-02-30` construye un `Date` VÁLIDO (2 de marzo).
    // Ver el docstring — el mecanismo que §M4-PREP sugiere no cierra su propia fila 3.
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== token) {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        'invalid date filter (expected a calendar day as YYYY-MM-DD)',
        { field: 'date' },
      );
    }
    return { gte: d, lt: new Date(d.getTime() + 24 * 3600 * 1000) };
  }

  /** §M4-PREP — proyecta UN `ShipmentRequest` en `picking` a su renglón de «Pedidos a preparar». */
  private toPreparationOrder(s: PreparationShipmentRow): PreparationOrderDTO {
    const destination = this.destinationOf(s);
    const snapshot = ShipmentsService.addressSnapshotOf(s.addressSnapshot);
    // Con cuenta ⇒ `User.name` (NOT NULL en schema); invitado ⇒ el nombre CONGELADO en el snapshot.
    // ⚠️ **v1.78.1 + `B-1`: la fuente se elige por QUIÉN es el envío y DESPUÉS se normaliza.**
    // Con cuenta ⇒ `User.name`; invitado ⇒ el `recipientName` congelado en el snapshot (que
    // `addressSnapshotOf` ya devolvió normalizado). `nullIfBlank` cierra el caso que `??` no veía:
    // la fuente **existe VACÍA** (`""` / `"   "`).
    //
    // ⛔ **NO hay respaldo de una fuente a la otra**, y es deliberado: `s.user ? … : …` y no
    // `nullIfBlank(s.user?.name) ?? snapshot.recipientName`. Un envío con cuenta cuyo `User.name`
    // esté en blanco **no** hereda el `recipientName` del snapshot — el destinatario **puede ser
    // otra persona** (un retiro se manda a quien el cliente diga), así que rellenar con él sería
    // **inventar una atribución** en la pantalla del operador. El contrato nombra UNA fuente por
    // caso y no autoriza ninguna cascada. Preferimos la ausencia declarada a un nombre plausible.
    const fullName = nullIfBlank(s.user ? s.user.name : snapshot.recipientName);
    const items = s.items.map((si) => ShipmentsService.toPreparationItem(si));
    items.sort(ShipmentsService.byLocation);
    return {
      shipmentId: s.id,
      orderId: s.orderId,
      // Un RETIRO DE BÓVEDA vive en esta cola y no tiene orden: `orderNumber` es `null`, y la
      // referencia SIEMPRE presente para trazar el renglón es `shipmentId`. `nullIfBlank` porque un
      // folio en blanco es la misma ausencia que ninguna orden, y ⛔ no se sirve con otra grafía.
      orderNumber: nullIfBlank(s.order?.orderNumber),
      destination,
      requestedAt: s.requestedAt.toISOString(),
      customer: { lastName: ShipmentsService.lastNameOf(fullName), fullName },
      // CA #6 — la dirección COMPLETA, CON la calle que la fila plana omitía. Solo para 'ship'.
      ...(destination === 'ship' ? { shipTo: snapshot } : {}),
      items,
    };
  }

  /**
   * §M4-PREP — `destination` **DERIVADO** del discriminador canónico `Order.fulfillmentMode`
   * (§4.21d); ⛔ no se inventa un campo. Que el modo sea del PEDIDO garantiza **por construcción**
   * que un pedido no mezcla destinos (DECISIÓN #1).
   *
   * - `orderId == null` ⇒ **retiro de bóveda**, que sale físicamente por la puerta ⇒ `'ship'`.
   * - `direct_ship` ⇒ `'ship'`.
   * - `vault` **con** `orderId` presente ⇒ combinación IMPOSIBLE por invariante. Se delega en
   *   `kindForFulfillment`, que es el precedente: **loguea y lanza**, exactamente igual que en la
   *   cola de `/admin/shipments`. ⛔ No se "arregla" en silencio ni se inventa un destino: es
   *   corrupción de datos (o un modo de fulfillment nuevo sin destino decidido) y tiene que verse.
   */
  private destinationOf(s: { id: string; orderId: string | null; order?: PreparationOrderJoin }) {
    if (s.orderId == null) return 'ship' as const;
    // Lanza ante `vault` / modo desconocido / orden inexistente. Su único retorno es directo.
    this.kindForFulfillment(s.order?.fulfillmentMode, s.id);
    return 'ship' as const;
  }

  /**
   * §M4-PREP — `shipTo` desde `ShipmentRequest.addressSnapshot` (`AddressSnapshotDTO`, 9 campos).
   *
   * ⚠️ **Los snapshots legados de 8 campos (anteriores a v1.67) NO tienen `recipientName`** —y un
   * snapshot ⛔ no se reescribe (§5.2)—, así que las tres claves que el contrato declara nullables
   * (`recipientName`, `line2`, `neighborhood`) caen a `null` sin reventar.
   *
   * ⭐ **`B-1`: `opt` normaliza el BLANCO a `null`, no solo la llave ausente.** Una clave presente
   * con `""` o `"   "` es la misma ausencia y ⛔ no puede servirse con otra grafía (v1.78.1).
   *
   * ⚠️ **Las seis restantes siguen cayendo a cadena vacía, y es a propósito:** el contrato las
   * declara `string` (no nullables), así que `null` ahí sería **salirse del tipo publicado**. Una
   * cola de trabajo que explota por un snapshot viejo es peor que una que muestra un hueco. Esas
   * seis son la ÚNICA lista blanca del censo de blancos (`shipments.picking-list.spec.ts`), y ahí
   * queda escrito que su cura es del **contrato**, no de este método.
   */
  private static addressSnapshotOf(
    raw: Prisma.JsonValue,
  ): NonNullable<PreparationOrderDTO['shipTo']> {
    const s =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const str = (k: string): string => (typeof s[k] === 'string' ? (s[k] as string) : '');
    const opt = (k: string): string | null =>
      nullIfBlank(typeof s[k] === 'string' ? (s[k] as string) : null);
    return {
      recipientName: opt('recipientName'),
      line1: str('line1'),
      line2: opt('line2'),
      neighborhood: opt('neighborhood'),
      city: str('city'),
      state: str('state'),
      postalCode: str('postalCode'),
      country: str('country'),
      phone: str('phone'),
    };
  }

  /**
   * §M4-PREP / §6.A — apellido **DERIVADO** (último token del nombre), para el archivero alfabético.
   *
   * ⚠️ **FRÁGIL A PROPÓSITO y NO BLOQUEA NADA.** No existe apellido estructurado en el modelo
   * (`User.name` y `addressSnapshot.recipientName` son **un solo string**), y derivarlo falla con
   * apellidos compuestos o con otro orden de nombre. Es la **etiqueta de ordenación visual**, no un
   * dato de negocio: ningún flujo depende de él. La alternativa —columna nueva + captura nueva— es
   * cambio de modelo, fuera del alcance de una rebanada de solo lectura.
   *
   * **v1.78.1 — `fullName === null ⇒ lastName === null` POR CONSTRUCCIÓN**, no por coincidencia: la
   * ausencia se propaga, no se traduce. También `null` si el nombre viene en blanco. Un nombre de UN
   * solo token SÍ devuelve ese token — un mononombre se archiva bajo su propia letra, y devolver
   * `null` tiraría información de archivo que sí tenemos.
   */
  private static lastNameOf(fullName: string | null): string | null {
    if (fullName === null) return null;
    const tokens = fullName
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    return tokens.length === 0 ? null : tokens[tokens.length - 1];
  }

  /** §M4-PREP — una carta del pedido, con su identidad de catálogo y su ubicación. */
  private static toPreparationItem(si: PreparationShipmentItem): PreparationItemDTO {
    const item = si.inventoryItem;
    return {
      shipmentItemId: si.id,
      inventoryItemId: si.inventoryItemId,
      folio: item.folio,
      // Constante 1: un `ShipmentItem` ES una pieza física. ⛔ No hay columna de cantidad y esta
      // rebanada no estrena ninguna.
      quantity: 1,
      card: {
        name: item.card.name,
        // El SET, prominente para ENVÍO: mapea a la carpeta por set del archivero.
        // ⭐ `nullIfBlank` — este campo es el que el orquestador cazó: mutar `?? null` a `?? ''`
        // **sobrevivía a las 5611 unitarias**. Es la misma clase que `B-1` sentada en el campo de al
        // lado, sin candado. Ahora la cierra el helper y la vigila el censo de blancos.
        setName: nullIfBlank(item.card.set?.name),
        finish: item.finish,
        conditionLabel: ShipmentsService.conditionLabelOf(item),
        // Una URL en blanco es una imagen que no existe, y se dice con la misma grafía que las
        // demás ausencias. (Antes pasaba directa: `null` desde el catálogo sí, `''` también.)
        imageSmallUrl: nullIfBlank(item.card.imageSmallUrl),
      },
      currentLocation: ShipmentsService.locationViewOf(item.location),
    };
  }

  /**
   * §M4-PREP — `conditionLabel` se compone **EN EL BACK** (⛔ no en el front) para no repetir la
   * lógica `graded/raw/sealed` en cada cliente. Precedencia, en este orden:
   *
   * 1. `gradingCompany` + `gradeValue` ⇒ `"PSA 9"` — hacen falta **los dos**: una gradeada a medio
   *    capturar no dice «PSA» a secas, cae al siguiente escalón.
   * 2. `rawCondition` ⇒ `"NM"`.
   * 3. `sealedCondition` ⇒ etiqueta legible (`SEALED_CONDITION_LABELS`).
   *
   * Cadena vacía si la pieza no tiene ninguna de las tres (fila incompleta): el contrato declara
   * `conditionLabel: string` y esta cola no es el sitio donde se descubre una captura a medias.
   */
  private static conditionLabelOf(item: {
    gradingCompany: InventoryItem['gradingCompany'];
    gradeValue: string | null;
    rawCondition: InventoryItem['rawCondition'];
    sealedCondition: SealedCondition | null;
  }): string {
    if (item.gradingCompany && item.gradeValue) return `${item.gradingCompany} ${item.gradeValue}`;
    if (item.rawCondition) return item.rawCondition;
    if (item.sealedCondition) return SEALED_CONDITION_LABELS[item.sealedCondition];
    return '';
  }

  /**
   * §M4-PREP / CA #11 — estado + su etiqueta. ⛔ `"UNASSIGNED"` ya no viaja por el cable.
   *
   * ⭐ **v1.78.2 — el blanco se enruta a `unassigned`, no a un `assigned` sin etiqueta.** La pregunta
   * que esta hoja contesta es *«¿hay sitio al que caminar?»*, y una etiqueta en blanco responde que
   * **no** exactamente igual que la ausencia de fila. Es lo que mi propio comentario ya admitía sin
   * darse cuenta cuando decía que esa carta ordena al final *«exactamente igual de no-caminable»*:
   * si se ordena igual y se lee igual, **es el mismo estado**, y tener dos nombres para él solo
   * obliga a cada consumidor a saberlo. ⛔ No se acuña un tercer `kind`.
   *
   * ⭐ `nullIfBlank` **sigue siendo necesario aquí** (no se tira con el cambio de destino): es lo que
   * distingue «etiqueta» de «hueco», y sin él `label: "  "` volvería al cable como cuarta grafía de
   * la ausencia — que es `B-1` otra vez. Lo que cambia es **a dónde enruta**, no que haga falta.
   */
  private static locationViewOf(location: VaultLocation | null): LocationView {
    const label = location ? nullIfBlank(location.label) : null;
    return label === null ? { kind: 'unassigned' } : { kind: 'assigned', label };
  }

  /**
   * §M4-PREP — orden de las cartas DENTRO del pedido: por etiqueta de ubicación, **asignadas primero
   * y ordenadas**, las `unassigned` al final. El operador camina el archivero en orden y las que no
   * tienen sitio quedan juntas al cierre, que es donde hay que decidir algo sobre ellas.
   *
   * ⭐ **v1.78.2 — el criterio es `kind`, ⛔ ya no «¿tiene `label`?».** Con `LocationView` como unión
   * discriminada, `a.currentLocation.label` **deja de compilar**: el compilador obliga a preguntar
   * por el estado en vez de inferirlo de la presencia de un campo. Es el mismo cambio dos veces —
   * *un estado ilegal que el tipo ya no puede representar es un `if` que nadie tiene que acordarse de
   * escribir*— y aquí se nota: antes había que saber que `label === undefined` significaba «no
   * caminable»; ahora lo dice la palabra.
   *
   * ### ⭐⭐ v1.78.3 (§M4P-ORDER) — la comparación es por UNIDADES DE CÓDIGO UTF-16
   * ⛔ **`localeCompare`** y ⛔ **`Intl.Collator`** quedan PROHIBIDOS aquí. No es estilo: la forma sin
   * argumentos está definida por ECMA-402 como *«la locale por defecto del host»*, y este orden lo
   * sirven **dos** implementaciones —este método y `sortPreparationItems` del cliente— que corren en
   * **hosts distintos** (Node del servidor · navegador del operador). Las dos habían elegido
   * `localeCompare` sin locale: **coincidían por coincidencia de elección, no por norma**.
   *
   * **Y fijar la locale no arregla el problema, solo lo mueve:** `localeCompare(x, 'es-MX')` quita la
   * variable *locale* pero ⛔ **no** la versión de **ICU/CLDR** que cada runtime empaqueta, y ese dato
   * no se puede fijar desde el contrato. `CLAUDE.md`: *«toda dependencia externa va fijada»* — una que
   * **no podemos** fijar no se mete en el camino de una regla que exige que dos runtimes coincidan.
   * La comparación por unidades de código es **la única que fija ECMA-262 en el lenguaje mismo**:
   * idéntica en Node y en todo navegador, sin ICU de por medio, y **aseverable literalmente**.
   *
   * **Consecuencias declaradas, ⛔ ninguna es un defecto que «arreglar»:** una `Ñ` ordena **tras** la
   * `Z`; una minúscula, **tras** todas las mayúsculas; `…S10` va **antes** que `…S9` (⛔ sin orden
   * numérico natural, ⛔ sin `{numeric:true}`); el `label` se compara **tal como viaja por el cable**
   * (⛔ sin `trim()`, ⛔ sin `toUpperCase()`, ⛔ sin `normalize()`); y el empate devuelve `0` para que
   * mande la **estabilidad** de `Array.prototype.sort` (ES2019) — ⛔ jamás se desempata por `folio`
   * ni por `id`. Los 7 casos de §M4P-ORDER los asevera `shipments.picking-list.spec.ts` **leyendo el
   * contrato**, ⛔ no transcribiéndolo.
   *
   * *Coste medido (2026-09-22): sobre las etiquetas que el sistema produce hoy —`CAJA-FILA-SLOT` en
   * mayúsculas con ceros a la izquierda— los dos comparadores dan el MISMO recorrido.*
   */
  private static byLocation(a: PreparationItemDTO, b: PreparationItemDTO): number {
    const A = a.currentLocation;
    const B = b.currentLocation;
    if (A.kind === 'unassigned') return B.kind === 'unassigned' ? 0 : 1;
    if (B.kind === 'unassigned') return -1;
    // §M4P-ORDER regla 2: unidades de código UTF-16. ⛔ NO `localeCompare`, ⛔ NO `Intl.Collator`.
    return A.label < B.label ? -1 : A.label > B.label ? 1 : 0;
  }

  private static TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
    solicitado: ['picking', 'cancelado'],
    picking: ['guia', 'cancelado'],
    guia: ['enviado', 'cancelado'],
    enviado: ['entregado'],
    entregado: [],
    cancelado: [],
  };

  /**
   * v1.17 — Máquina de estados M4. La ÚNICA escritura persistente del ciclo de retiro
   * sobre el `InventoryItem` es la transición terminal al pasar a `entregado`: cada item
   * de sus `ShipmentItem` pasa `in_custody → withdrawn` (+ InventoryMovement
   * reason='withdrawal'), CONSERVANDO ownerType/ownerUserId/ownershipStatus (histórico
   * intacto). Idempotente: un item ya `withdrawn` no duplica movimiento. Todo en UNA
   * transacción con la actualización del envío. API_CONTRACT §M4, ARCHITECTURE §3.3/§9.
   *
   * ### ⭐⭐ `REL-B` (pentester, ALTA, 2026-09-14) — LA TRANSICIÓN SE RECLAMA, NO SE ESCRIBE
   *
   * **El defecto, medido en vivo por el pentester y reproducido aquí:** este método validaba
   * `TRANSITIONS` sobre una lectura **previa** y después escribía con
   * `update({ where: { id } })` — **sin el estado en el `WHERE`**. Bajo `READ COMMITTED`, N
   * `PATCH {to:'enviado'}` simultáneos leen los N el mismo `guia`, los N pasan la validación, los
   * N escriben y **los N llaman a `notifyStatus`** ⇒ N correos «tu paquete va en camino» por **una
   * sola** transición. *La máquina de estados vivía en un `if` de JavaScript, y un `if` sobre un
   * dato caduco no es una máquina de estados: es una opinión sobre el pasado.*
   *
   * | medición | antes (`0e22415`) | después |
   * |---|---|---|
   * | `AV-5`, 25 tiradas de 10 `PATCH` simultáneos | **25/25 con duplicado** (hasta 10 correos) | **0/25** |
   * | `AV-6`, 25 tiradas de 10 `PATCH` simultáneos | **25/25 con duplicado** (10 correos) | **0/25** |
   * | entrelazado FORZADO (`avisos-sellos`, bloque B) | **ROJO 10/10** | **VERDE 10/10** |
   *
   * **El arreglo es el que ya vivía 130 líneas más abajo** (`setTracking`, `D-AVISO-2`): la
   * precondición **baja al motor**. `updateMany({ where: { id, status: <el que leí> } })` y
   * `count === 1` ⇔ *esta* petición fue la que hizo la transición. Bajo `READ COMMITTED` Postgres
   * re-evalúa el `WHERE` contra la versión ya actualizada de la fila (`EvalPlanQual`) cuando dos
   * `UPDATE` compiten por ella ⇒ **exactamente una** puede ganar.
   *
   * ⭐ **Y el perdedor NO recibe `409` si el envío quedó donde él pedía** (§R.4.c cláusula 4, §M4):
   * relee y, si `status === to`, devuelve **`200` idempotente sin correo**. *Dos operadores que
   * pulsan «Enviar» a la vez querían lo mismo y lo consiguieron;* convertir eso en un error de
   * pantalla castiga al operador por la latencia de la red. `409` solo si quedó en **otro** estado.
   *
   * ⛔ **`notifyStatus` queda DETRÁS de esa reclamación**, así que «quién avisa» dejó de ser una
   * carrera y pasó a ser un hecho del motor. Ver el docstring de `notifyStatus` para el porqué
   * de que `AV-5`/`AV-6` **no estrenen columna de sello**.
   */
  async updateStatus(id: string, to: ShipmentStatus) {
    const shipment = await this.prisma.shipmentRequest.findUnique({ where: { id } });
    if (!shipment) throw BusinessException.notFound();
    const allowed = ShipmentsService.TRANSITIONS[shipment.status] ?? [];
    if (!allowed.includes(to)) {
      throw BusinessException.conflict(
        'CONFLICT',
        `Invalid transition ${shipment.status} -> ${to}`,
      );
    }
    const data: Prisma.ShipmentRequestUpdateManyMutationInput = { status: to };
    if (to === 'picking') data.pickingAt = new Date();
    if (to === 'enviado') data.shippedAt = new Date();
    if (to === 'entregado') data.deliveredAt = new Date();

    // v1.21-guest-checkout (§M4) — RAMIFICACIÓN OBLIGATORIA por RUTA DE FULFILLMENT. La máquina de
    // estados, el picking list y la captura de guía son IDÉNTICOS para los dos tipos; lo único que
    // cambia es qué le pasa al `InventoryItem` en las transiciones terminales:
    //   · Retiro de bóveda: v1.17 SIN CAMBIO ALGUNO — solo `entregado` toca el item
    //     (`in_custody → withdrawn`, reason `withdrawal`).
    //   · Envío directo: DOS transiciones, ambas por `status` (el item es `ownerType='platform'`
    //     todo el tiempo): `enviado` ⇒ `picking → shipped`; `entregado` ⇒ `shipped → delivered`.
    //     NUNCA `withdrawn` (nunca estuvo en bóveda).
    //
    // v1.21.2 (D4): el discriminador es `Order.fulfillmentMode`, NO `orderId != null`. `orderId`
    // dice de DÓNDE VIENE el envío; el COMPORTAMIENTO lo decide el modo de fulfillment, que es el
    // único discriminador canónico del sistema (ARCHITECTURE §4.21d).
    const isDirectShip = await this.isDirectShipFulfillment(shipment);

    const result = await this.prisma.$transaction(async (tx) => {
      // ⭐⭐ `REL-B` — LA PRECONDICIÓN DE ESTADO VIVE EN EL `WHERE`, no en el `if` de arriba.
      // `count === 1` ⇔ esta petición fue la que movió el envío de `shipment.status` a `to`.
      // ⛔ Nunca `update({ where: { id } })`: eso escribe aunque otro ya haya hecho la transición,
      // y entonces el aviso de más abajo sale N veces por un hecho que ocurrió UNA.
      const claimed = await tx.shipmentRequest.updateMany({
        where: { id, status: shipment.status },
        data,
      });
      if (claimed.count !== 1) {
        // ⭐ §R.4.c cláusula 4 — **EL PERDEDOR NO RECIBE `409` SI EL ENVÍO QUEDÓ DONDE PEDÍA.**
        // Se RELEE (instantánea nueva: bajo `READ COMMITTED` cada sentencia ve lo ya commiteado):
        //   · `status === to`  ⇒ `200` idempotente con la fila actual, ⛔ SIN correo. Dos operadores
        //     que pulsan «Enviar» a la vez querían lo mismo y lo consiguieron; convertir eso en un
        //     error en pantalla castiga al operador por la latencia de la red.
        //   · cualquier otro estado ⇒ `409`, el mismo de una transición ilegal (§M4).
        const actual = await tx.shipmentRequest.findUniqueOrThrow({ where: { id } });
        if (actual.status === to) return { gane: false, row: toAdminShipmentRow(actual) };
        throw BusinessException.conflict('CONFLICT', `Invalid transition ${actual.status} -> ${to}`);
      }
      const updated = await tx.shipmentRequest.findUniqueOrThrow({ where: { id } });

      if (isDirectShip && (to === 'enviado' || to === 'entregado')) {
        const fromStatus = to === 'enviado' ? 'picking' : 'shipped';
        const toStatus = to === 'enviado' ? 'shipped' : 'delivered';
        const shipmentItems = await tx.shipmentItem.findMany({
          where: { shipmentRequestId: id },
          select: { inventoryItemId: true },
        });
        for (const si of shipmentItems) {
          // Guardia POSITIVA + idempotente: solo avanza la pieza que está en el estado previo
          // esperado (un reintento o una pieza ya movida por otro flujo no duplica movimiento).
          const moved = await tx.inventoryItem.updateMany({
            where: { id: si.inventoryItemId, status: fromStatus },
            data: { status: toStatus },
          });
          if (moved.count !== 1) continue;
          await tx.inventoryMovement.create({
            data: {
              itemId: si.inventoryItemId,
              fromStatus,
              toStatus,
              // `sale`: la pieza sale por una VENTA con envío directo, no por un retiro de bóveda
              // (`withdrawal` mentiría en los reportes de custodia).
              reason: MovementReason.sale,
              note: `guest shipment ${id} ${to}`,
            },
          });
        }
        return { gane: true, row: toAdminShipmentRow(updated) }; // S49-R4
      }

      if (!isDirectShip && to === 'entregado') {
        const shipmentItems = await tx.shipmentItem.findMany({
          where: { shipmentRequestId: id },
          select: { inventoryItemId: true },
        });
        for (const si of shipmentItems) {
          const item = await tx.inventoryItem.findUnique({
            where: { id: si.inventoryItemId },
          });
          if (!item) continue;
          // Idempotencia: si ya está retirado, no dupliques el movimiento.
          if (item.status === 'withdrawn') continue;
          await tx.inventoryItem.update({
            where: { id: si.inventoryItemId },
            // Solo cambia `status`; conserva ownerType/ownerUserId/ownershipStatus.
            data: { status: 'withdrawn' },
          });
          await tx.inventoryMovement.create({
            data: {
              itemId: si.inventoryItemId,
              fromStatus: item.status,
              toStatus: 'withdrawn',
              reason: MovementReason.withdrawal,
              note: `shipment ${id} delivered`,
            },
          });
        }
      }
      return { gane: true, row: toAdminShipmentRow(updated) }; // S49-R4
    });
    // v1.74 (§R) — `AV-5`/`AV-6`, POST-COMMIT y best-effort: el correo cuelga del hecho, y el hecho
    // no cuelga del correo. ⛔ Un fallo del proveedor no revierte la transición ni tumba el `PATCH`.
    // ⭐ §R.4.c cláusula 2 — **avisa el GANADOR del CAS y nadie más.** El perdedor idempotente sale
    // por aquí con `gane: false`: no omite un correo suyo, es que **no ocurrió ningún hecho suyo**.
    if (result.gane) await this.notifyStatus(shipment, to);
    return result.row;
  }

  /**
   * ⭐⭐ v1.74 — **`D-AV-1` CERRADA: la captura de guía ya NO REGRESA EL ESTADO** (`ARCHITECTURE §9`).
   *
   * ### El defecto, medido
   * Este método escribía `data: { carrier, trackingNumber, status: 'guia', … }`
   * **incondicionalmente**: no consultaba `TRANSITIONS`, no comparaba el estado actual y no tenía
   * guarda de motor — a diferencia de su hermano `updateStatus`, que sí la tiene. ⇒ capturar una
   * guía sobre un envío **`entregado`** o **`cancelado`** lo **devolvía a `guia`**.
   * **Y no era solo una omisión del código:** `API_CONTRACT §M4` afirma de este endpoint, desde
   * v1.4-finance, que es *«idempotente sobre carrier/tracking; **no regresa el estado si ya está en
   * `guia`/posterior**»*. Era una línea de contrato que el código no cumplía.
   * *Un envío entregado que reaparece en la cola de guías es una **cola falsa**, y el fallo se ve
   * mientras que la cola falsa no.*
   *
   * ### La regla, entera, y de dónde sale cada mitad
   * | estado actual | qué hace | de dónde sale |
   * |---|---|---|
   * | `solicitado`, `picking` | escribe etiqueta **y** `status:'guia'` | `TRANSITIONS` (avance legal) |
   * | `guia`, `enviado`, `entregado` | escribe etiqueta, ⛔ **NO toca `status`** | §M4, literal |
   * | `cancelado` | **`409 CONFLICT`**, cero escritura | `TRANSITIONS['cancelado'] = []` |
   *
   * ⚠️ **Las dos decisiones que NO son mías y se declaran** (`ARCHITECTURE §9` las enruta al
   * arquitecto, y este pase toma la lectura **más conservadora** de cada una):
   *  1. **`entregado` responde `200` y no `409`** porque el contrato dice *«no regresa el estado»*,
   *     no *«rechaza»*: corregir el número de una guía de un paquete ya entregado es legítimo (una
   *     devolución, una reclamación al transportista) y lo único prohibido era **el retroceso**.
   *  2. **`cancelado` sí responde `409`**, por paridad con `updateStatus` y porque de `cancelado` no
   *     sale ninguna transición: escribirle una etiqueta a un envío que no va a salir es la cola
   *     falsa otra vez. ⚠️ **Es el único rechazo NUEVO de este pase**, y ⛔ no cierra un camino que
   *     la pantalla ofrezca: medido, `M4View.tsx` **oculta el botón de captura** en `cancelado` y en
   *     `entregado`. Si el arquitecto prefiere otro código, es una línea.
   *
   * ### `AV-4` — el correo de la guía, y por qué cuelga de AQUÍ (§R.3.a)
   * Éste es el **único** camino que garantiza `carrier` **y** `trackingNumber`. El `PATCH /status
   * { to:'guia' }` es legal desde `picking` y los deja en `null` (`D-AV-2`, abierta) ⇒ colgar el
   * correo del **estado** mandaría una guía **sin número**.
   * **Una sola vez (`D-AVISO-2`):** el sello `trackingNoticeSentAt`, que se **limpia en esta misma
   * escritura** si y solo si el par `(carrier, trackingNumber)` queda **DISTINTO** (§R.4.b) ⇒
   * re-capturar el mismo número **no reenvía**; corregirlo **sí avisa**.
   *
   * ### ⭐⭐ `D-AVISO-2` bajo CONCURRENCIA — la decisión vive en el MOTOR, no en una lectura previa
   * **El defecto que esto cierra, medido (2026-09-14, `f8c7040`, BD propia, `N=25` tiradas de `8`
   * capturas simultáneas del MISMO número sobre un envío nuevo): **8/25 tiradas mandaban 2 correos**.
   * El mecanismo era un *comprobar-y-actuar* de manual:
   * ```ts
   * const shipment = await prisma.findUnique(...);              // lectura
   * const labelChanged = shipment.carrier !== carrier || …;     // decisión sobre un estado CADUCO
   * await prisma.update({ data: { …, trackingNoticeSentAt: null } });   // escritura
   * ```
   * Las N peticiones leen el valor **anterior**, las N concluyen «la etiqueta cambió» y las N
   * escriben `trackingNoticeSentAt: null` ⇒ una **borra el pestillo que otra acababa de echar** y
   * vuelve a haber derecho a avisar. *El sello de `claimAndNotify` funcionaba; lo que fallaba es que
   * se le podía quitar el cerrojo desde fuera.*
   *
   * **La forma correcta, y es la misma de `jobs/buylist-sweep.service.ts` y la del propio sello:** la
   * comparación se **baja al `WHERE`**, así que decidir y escribir son **UNA sola operación**:
   * ```sql
   * UPDATE "ShipmentRequest" SET carrier=…, "trackingNumber"=…, "trackingNoticeSentAt"=NULL
   *  WHERE id=… AND (carrier IS NULL OR carrier <> … OR "trackingNumber" IS NULL OR "trackingNumber" <> …)
   * ```
   * Bajo `READ COMMITTED`, Postgres **re-evalúa el `WHERE` sobre la versión ya actualizada** de la
   * fila (`EvalPlanQual`) cuando dos `UPDATE` compiten por ella ⇒ **exactamente UNA** de las N puede
   * devolver `count === 1`; para el resto la etiqueta **ya coincide** y no borran nada.
   * `labelChanged` deja de ser una opinión sobre el pasado y pasa a ser **lo que el motor hizo**.
   *
   * ⚠️ **`carrier IS NULL OR …` NO es defensivo, es obligatorio** (medido: Prisma 5 traduce
   * `{ not: v }` a `col <> $1` **a secas**). En SQL, `NULL <> 'DHL'` es `NULL`, o sea **falso** ⇒ sin
   * la rama explícita de `null` la **primera** captura de un envío recién creado (que es justo el
   * caso donde ambas columnas son `NULL`) no casaría con el `WHERE`, no limpiaría el sello y **no
   * avisaría nunca**. El defecto cambiado de signo: de dos correos a **cero**.
   *
   * ⛔ **El segundo `update` no puede fusionarse con el condicional.** Cuando la etiqueta **no**
   * cambia, el `WHERE` no casa —por diseño— y aun así hay que escribir `status`/costos (una
   * re-captura idempotente que trae el costo del transportista es legítima). Por eso son dos
   * escrituras y no una, y por eso el sello viaja **solo** en la condicional.
   */
  async setTracking(
    id: string,
    carrier: string,
    trackingNumber: string,
    shippingCostCents?: number,
    /**
     * ⭐ §M10-IVA.8 — el **IVA acreditable** de la factura del carrier. Opcional y editable, igual
     * que el bruto; omitirlo **no modifica** la columna (default `0` ⇒ `neto = bruto`, dirección
     * conservadora). ⛔ No se deriva del bruto: se **captura**.
     */
    shippingCostIvaCents?: number,
  ) {
    const shipment = await this.prisma.shipmentRequest.findUnique({ where: { id } });
    if (!shipment) throw BusinessException.notFound();
    const allowed = ShipmentsService.TRANSITIONS[shipment.status] ?? [];
    // `guia` alcanzable ⇒ la captura AVANZA. Ya en `guia`/posterior ⇒ se conserva el estado. De un
    // terminal del que no sale nada y que no es `guia`/posterior (`cancelado`) ⇒ 409.
    const advances = allowed.includes('guia');
    const alreadyAtOrPastGuia = ShipmentsService.GUIA_OR_LATER.includes(shipment.status);
    if (!advances && !alreadyAtOrPastGuia) {
      throw BusinessException.conflict(
        'CONFLICT',
        `Cannot capture a tracking label on a ${shipment.status} shipment`,
        { status: shipment.status },
      );
    }
    // Lo que se escribe SIEMPRE, cambie o no la etiqueta. ⛔ **`status` ya NO va aquí** (`REL-C`):
    // el avance de estado tiene su propia escritura, con su propia precondición en el motor. El
    // sello tampoco: va solo en la escritura condicional de abajo, la que reinicia el ciclo.
    const data = {
      carrier,
      trackingNumber,
      // v1.4-finance: opcional y editable; si se omite, no se modifica (default de columna 0).
      ...(shippingCostCents !== undefined ? { shippingCostCents } : {}),
      // ⭐ §M10-IVA.8 / `IVA-11(c)`: el crédito se CAPTURA junto al bruto y se congela con él.
      ...(shippingCostIvaCents !== undefined ? { shippingCostIvaCents } : {}),
    };
    // ⭐⭐ `REL-C` — **EL AVANCE DE ESTADO, Y SU PRECONDICIÓN ES UN CONJUNTO, NO UNA LECTURA.**
    // `advances` se calculó sobre `shipment.status`, leído ANTES y sin candado: si entre la lectura
    // y la escritura otro operador completó `guia → enviado`, escribir `status:'guia'` dentro de
    // `data` **REGRESABA EL ESTADO** y volvía a abrir el camino a `enviado` — o sea, un **segundo
    // `AV-5`**. *(El pentester lo marcó BAJA con `0/25` porque su arnés serializaba la cadena; con
    // el entrelazado forzado sale **ROJO 10/10**: un `0/25` no era una defensa, era un instrumento
    // que no llegaba.)*
    //
    // El `WHERE` no lleva «el estado que leí» sino **los estados desde los que este avance es
    // legal**, que es un predicado estable y lo evalúa el motor en el instante de escribir. ⇒ esta
    // escritura **no puede retroceder nada**: `guia`, `enviado`, `entregado` y `cancelado` no casan.
    // Y eso es justo lo que hace cierta la premisa de `notifyStatus`: el grafo de estados es
    // ACÍCLICO, así que `guia → enviado` ocurre **como mucho una vez** en la vida de la fila.
    if (advances) {
      await this.prisma.shipmentRequest.updateMany({
        where: { id, status: { in: [...ShipmentsService.PRE_GUIA] } },
        data: { status: 'guia' },
      });
    }
    // ⭐⭐ §R.4.b + `D-AVISO-2` bajo concurrencia — el ciclo del aviso se reinicia por VALOR, no por
    // evento, y **la comparación la hace el MOTOR en el mismo `UPDATE`** que escribe la etiqueta
    // (ver el docstring): `count === 1` ⇔ *esta* petición fue la que dejó la etiqueta distinta, y
    // por tanto la única con derecho a limpiar el pestillo. ⛔ Nunca un `if` sobre una lectura
    // previa: bajo N concurrentes las N leerían el valor viejo y las N se creerían «el cambio».
    // ⚠️ Las ramas `: null` son obligatorias — Prisma traduce `{ not: v }` a `col <> v`, que en SQL
    // NO casa con `NULL`, y el primer `setTracking` de un envío tiene las dos columnas en `NULL`.
    // ⚠️ `status: { not: 'cancelado' }` (`REL-C`): el 409 de arriba se decidió sobre la lectura
    // previa, así que una cancelación simultánea se le colaba. Sin esta rama, la etiqueta aterrizaba
    // sobre un envío que ya no sale — la **cola falsa** que este método dice impedir.
    const relabelled = await this.prisma.shipmentRequest.updateMany({
      where: {
        id,
        status: { not: 'cancelado' },
        OR: [
          { carrier: null },
          { carrier: { not: carrier } },
          { trackingNumber: null },
          { trackingNumber: { not: trackingNumber } },
        ],
      },
      data: { ...data, trackingNoticeSentAt: null },
    });
    if (relabelled.count !== 1) {
      // La etiqueta no cambió (o la cambió otra petición simultánea): se escriben los costos del
      // transportista igual —una re-captura idempotente que los trae es legítima— ⛔ SIN tocar el
      // sello y ⛔ sin tocar el estado.
      await this.prisma.shipmentRequest.updateMany({
        where: { id, status: { not: 'cancelado' } },
        data,
      });
    }
    // S49-R4: proyectado (antes devolvía la entidad `ShipmentRequest` cruda).
    const row = toAdminShipmentRow(
      await this.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } }),
    );
    // ⛔ POST-COMMIT y best-effort: el sello se reclama FUERA de la escritura de negocio. Meterlo
    // dentro haría que un fallo del correo pudiera revertir la captura de una etiqueta ya comprada.
    // ⚠️ Y **solo avisa quien escribió la etiqueta** (`relabelled.count === 1`). Antes se llamaba
    // siempre y el sello lo filtraba; ya no basta, porque con la guarda de `cancelado` una captura
    // puede no escribir NADA — y entonces el correo anunciaría una guía que no está en la fila.
    if (relabelled.count === 1) {
      await this.claimAndNotify(id, 'trackingNoticeSentAt', shipment, (l, p) =>
        shipmentGuideTemplate({ ...p, carrier, trackingNumber }, l),
      );
    }
    return row;
  }

  // ===============================================================================================
  // §R — LOS TRES AVISOS DE ENVÍO. **Best-effort, post-commit, y jamás propagan** (§R.4).
  // ===============================================================================================

  /** Estados en los que el envío **ya está en `guia` o más allá** (§M4: «no regresa el estado»). */
  private static readonly GUIA_OR_LATER: readonly ShipmentStatus[] = ['guia', 'enviado', 'entregado'];

  /**
   * ⭐ `REL-C` — Estados **anteriores** a `guia`: los únicos desde los que capturar una etiqueta
   * puede AVANZAR el envío. Es el `WHERE` del avance de `setTracking`, y por eso es un conjunto
   * derivado de `TRANSITIONS` y no una lista suelta: `s ∈ PRE_GUIA ⇔ 'guia' ∈ TRANSITIONS[s]`.
   * ⛔ Que sea un predicado sobre el estado REAL (y no sobre el que se leyó) es lo que hace
   * imposible que una captura retroceda un `enviado`.
   */
  private static readonly PRE_GUIA: readonly ShipmentStatus[] = (
    Object.keys(ShipmentsService.TRANSITIONS) as ShipmentStatus[]
  ).filter((s) => ShipmentsService.TRANSITIONS[s].includes('guia'));

  /**
   * ⭐ **§R.5 — RESOLUCIÓN DEL DESTINATARIO.** *Un correo mandado al inbox equivocado no es un aviso:
   * es una fuga.* El orden es exacto y no es negociable:
   * ```
   * 1. shipment.userId != null  →  User.email                             // retiro de BÓVEDA
   * 2. shipment.orderId != null →  order.guestEmail ?? order.user.email   // fulfillment de un pedido
   * 3. ninguno                  →  ⛔ NADA + log.warn                      // estado imposible
   * ```
   * - ⭐ **`guestEmail` GANA cuando existe, incluso si el pedido fue RECLAMADO** (`claimedAt != null`):
   *   es la dirección con la que compró y a la que ya le llegó la confirmación. Precedente idéntico y
   *   deliberado: el reenvío del enlace de seguimiento ya va *siempre* a `Order.guestEmail`.
   * - ⛔ **Jamás se toma la dirección del `addressSnapshot`, ni del body, ni de una sesión**: se
   *   resuelve **por id**.
   * - ⛔ **No se escribe a un `User` con `anonymizedAt != null`** (§R.5.a): una cuenta anonimizada ya
   *   no es de nadie, y escribirle es mandar datos de una persona a una dirección que el borrado
   *   debía cerrar.
   */
  private async resolveRecipient(
    shipment: Pick<ShipmentRequest, 'id' | 'userId' | 'orderId'>,
  ): Promise<{ email: string; locale: string | null; orderNumber: string | null } | null> {
    if (shipment.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: shipment.userId },
        select: { email: true, locale: true, anonymizedAt: true },
      });
      if (!user || user.anonymizedAt) return null;
      return { email: user.email, locale: user.locale, orderNumber: null };
    }
    if (shipment.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: shipment.orderId },
        select: {
          orderNumber: true,
          guestEmail: true,
          locale: true,
          user: { select: { email: true, locale: true, anonymizedAt: true } },
        },
      });
      if (!order) return null;
      if (order.guestEmail) {
        return {
          email: order.guestEmail,
          locale: order.locale ?? order.user?.locale ?? null,
          orderNumber: order.orderNumber,
        };
      }
      if (!order.user || order.user.anonymizedAt) return null;
      return {
        email: order.user.email,
        locale: order.locale ?? order.user.locale,
        orderNumber: order.orderNumber,
      };
    }
    return null;
  }

  /**
   * `D-AVISO-2` — **SE SELLA Y LUEGO SE ENVÍA.** La reclamación es una escritura condicional y solo
   * la ganadora manda el correo:
   * ```
   * UPDATE … SET <sello> = now() WHERE id = :id AND <sello> IS NULL  →  count === 1 ⇒ mandar
   *                                                                  →  count === 0 ⇒ ⛔ salir
   * ```
   * ⚠️ **El precio se dice entero:** si el envío falla **después** de sellar, ese correo **no vuelve
   * a salir**. Se acepta a propósito —es la misma decisión que el barrido ya tomó— y la red de
   * seguridad es **la pantalla**, que siempre tiene el dato.
   *
   * ### ⭐⭐ `sealField = null` — POR QUÉ `AV-5`/`AV-6` NO ESTRENAN COLUMNA (decisión `REL-B`)
   * Esta línea decía ya *«su una sola vez la da el MOTOR»* y **era falsa cuando se escribió**: el
   * motor no decidía nada, porque `updateStatus` escribía con `where: { id }` a secas. El pentester
   * lo midió: `13/13` tiradas con duplicado. ⇒ la frase no era una garantía, era una intención.
   *
   * **Ahora es cierta, y se sostiene en DOS hechos, no en uno** (los dos se cerraron en este pase):
   *  1. **La transición se RECLAMA** — `updateMany({ where: { id, status: <el leído> } })` +
   *     `count === 1`. De N peticiones simultáneas, **una** hace la transición; las demás reciben
   *     `409` **antes** de llegar al correo.
   *  2. **El grafo de `TRANSITIONS` es ACÍCLICO y nadie lo retrocede** — `enviado` solo se alcanza
   *     desde `guia`, de `enviado` solo se sale a `entregado`, y de `cancelado` no se sale. Así que
   *     `→ enviado` y `→ cancelado` ocurren **como mucho una vez en la vida de la fila**.
   *     ⚠️ Este segundo hecho es el frágil, y **era falso hasta este pase**: `setTracking` (`REL-C`)
   *     y `payments.settle` podían **regresar** el estado con una escritura sin precondición,
   *     reabriendo el camino a `enviado` ⇒ un segundo `AV-5` legítimo. Por eso el arreglo de
   *     `REL-B` **no está completo sin el de `REL-C`**: la premisa del sello es la monotonía.
   *
   * **⇒ CERO columnas nuevas** (§R.4.c cláusula 3, decisión del arquitecto v1.76), y el argumento
   * que decide **no es el ahorro**:
   *  - **`ShipmentRequest.shippedAt` YA ES el sello de `AV-5`.** La misma escritura atómica que gana
   *    la transición lo pone, pasa de `NULL` a fecha **exactamente una vez**, y nada lo devuelve a
   *    `NULL`. Una columna aparte sería **una segunda fila afirmando el mismo hecho con la misma
   *    vida** — y el día que discrepen, *una miente y no se sabe cuál*. Para `AV-6` no hace falta
   *    ninguna: `cancelado` es **terminal**.
   *  - ⭐ **La columna arreglaría el correo y dejaría vivo el defecto de fondo.** Sin el `WHERE`, las
   *    N peticiones **commitean todas** la transición (un *lost update* silencioso) y el perdedor
   *    devuelve `200` afirmando un éxito que no tuvo. Con sello, eso **seguiría igual**: *el `WHERE`
   *    arregla la máquina de estados; el sello solo tapa su síntoma más visible.*
   *  - **El mecanismo es HEREDADO, no estrenado:** el mismo de `setTracking` (§R.4.b) y el de
   *    `jobs/buylist-sweep.service.ts` desde v1.18.
   *
   * *Un sello se estrena cuando el ciclo puede REPETIRSE (`trackingNoticeSentAt`: recapturar una
   * etiqueta distinta es un hecho nuevo). `AV-5`/`AV-6` no repiten: son aristas de un grafo sin
   * ciclos.*
   *
   * ⛔ **Y la premisa se vigila**, no se confía: `shipments.state-monotonic.spec.ts` pone rojo si
   * alguien añade un ciclo a `TRANSITIONS` o escribe `status` de un `ShipmentRequest` sin llevar la
   * precondición al `WHERE`. Si esa premisa se cae, la decisión correcta pasa a ser la columna.
   */
  private async claimAndNotify(
    id: string,
    sealField: 'trackingNoticeSentAt' | null,
    shipment: Pick<ShipmentRequest, 'id' | 'userId' | 'orderId'>,
    build: (locale: string | null, params: ShipmentNoticeParams) => Omit<MailMessage, 'to'>,
  ): Promise<void> {
    try {
      if (!this.mail) {
        this.logger.warn(`shipment mail skipped for ${id}: MAIL_PORT unavailable`);
        return;
      }
      const to = await this.resolveRecipient(shipment);
      if (!to) {
        // §R.5.a — se loggea y se sale. ⛔ No se sustituye por un destinatario «parecido».
        this.logger.warn(`shipment mail skipped for ${id}: no recipient email`);
        return;
      }
      if (sealField) {
        const sealed = await this.prisma.shipmentRequest.updateMany({
          where: { id, [sealField]: null },
          data: { [sealField]: new Date() },
        });
        if (sealed.count !== 1) return; // ya se avisó de este hecho: ⛔ no se manda un segundo correo.
      }
      const msg = build(to.locale, {
        shipmentId: id,
        orderNumber: to.orderNumber,
      });
      await this.mail.send({ ...msg, to: to.email });
    } catch (e) {
      // ⛔ NUNCA propaga: un fallo de correo no revierte una transición ni tumba el endpoint.
      this.logger.error(
        `shipment mail failed for ${id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * ⭐⭐ **Criterio 210, y se verifica POR EXCESO Y POR DEFECTO: DOS correos de envío y NINGUNO al
   * entregar.** Este `switch` es la forma verificable de esa frase — `entregado` **no tiene rama**, y
   * su ausencia es la mitad que falla por exceso. *No se añade «porque parecía razonable»:
   * el dueño lo confirmó explícitamente (pregunta 74) con el contraargumento delante.*
   *
   * **Una sola vez, sin estrenar columna:** la da el MOTOR, y desde `REL-B` eso es verdad literal y
   * no una intención — se llega aquí **solo** si `updateStatus` ganó la reclamación de la transición
   * (`updateMany … count === 1`), y el grafo de `TRANSITIONS` es acíclico. El argumento entero, con
   * lo que costaría la alternativa, está en el docstring de `claimAndNotify`.
   */
  private async notifyStatus(
    shipment: Pick<ShipmentRequest, 'id' | 'userId' | 'orderId' | 'carrier' | 'trackingNumber'>,
    to: ShipmentStatus,
  ): Promise<void> {
    if (to === 'enviado') {
      await this.claimAndNotify(shipment.id, null, shipment, (l, p) =>
        shipmentShippedTemplate(
          { ...p, carrier: shipment.carrier, trackingNumber: shipment.trackingNumber },
          l,
        ),
      );
      return;
    }
    if (to === 'cancelado') {
      await this.claimAndNotify(shipment.id, null, shipment, (l, p) =>
        shipmentCancelledTemplate(p, l),
      );
    }
    // ⛔ `entregado`, `picking`, `guia`, `solicitado`: CERO correos (criterio 210 / §R.7).
  }
}

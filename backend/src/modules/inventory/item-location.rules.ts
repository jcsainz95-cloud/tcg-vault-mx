import { InventoryStatus, OwnerType, OwnershipStatus, VaultZone } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import type { CustomerDrawerRef } from '../vault/vault-placement.rules';

/**
 * item-location.rules.ts — las guardas de ESTADO, de DUEÑO y de ZONA de los verbos de pieza de M1:
 * `POST /admin/inventory/items/:id/move`, `POST /admin/inventory/items/:id/mark` y el cambio de
 * `status` y el `listPriceCents` de `PATCH /admin/inventory/items/:id`.
 *
 * *Por qué existen (medido por techlead y QA sobre `16a3170`):* ninguno de los dos verbos miraba el
 * estado de la pieza ni la zona del destino. El API aceptaba **mover la carta DE UN CLIENTE, en un
 * retiro cobrado, al estante de tienda** (`platform_stock`) y **marcar perdida una pieza en `picking`
 * de un pedido ya cobrado**. Las dos son escrituras sobre algo que no es del operador decidir desde M1.
 * 🔒 v1.80.3 (SEC-SHIP-A1, §M4-SHIP.17.1): seguridad leyó en production que el `PATCH` con
 * `status:'in_stock'` iba por un `update` plano ⇒ **sí existía** un `lost → in_stock` (borraba la
 * merma firmada), y que `mark` sobre una carta de cliente la ponía `lost` **sin caso** (la deuda
 * desaparecía de «Por reponer»). Los dos se cierran aquí.
 *
 * Reglas (un cuerpo por regla; el servicio solo las aplica):
 *  - **Destino:** existe (`not_found`), está activo (`inactive`), y su zona encaja con el dueño de la
 *    pieza. Mismo código y mismos `reason` que el `confirm` de colocación (§M4-VAULT.5):
 *    `422 LOCATION_NOT_AVAILABLE`.
 *  - **Pieza de plataforma** (`ownerType='platform'`) ⇒ solo `platform_stock`
 *    (`reason:'not_platform_stock'` — ⚠️ `reason` NUEVO dentro de un código existente; va al arquitecto).
 *    Estados movibles: `in_stock | listed | reserved | picking` (la pieza sigue en un estante; en
 *    `picking` de un pedido directo el operador la lleva a la mesa de empaque, que es estante).
 *  - **Pieza de cliente** (`ownerType='customer'`) ⇒ SOLO `move`, y solo si está en custodia
 *    liquidada (`in_custody` + `settled`), **no** en un retiro cobrado (`409 ITEM_IN_ANOTHER_SHIPMENT`),
 *    y solo a un cajón `customer_custody` **que ya es de ese cliente** según `customerDrawers`
 *    (`reason:'not_customer_drawer'`, con `customerDrawers` en `details`, como el `confirm`). El
 *    contrato (§M4-VAULT.4 regla 4) reserva este `move` para CONSOLIDAR cajones del mismo cliente;
 *    la PRIMERA colocación (cliente sin cajón) es del `confirm`, que toma la puerta del cliente.
 *  - **Terminales** (`shipped | delivered | lost | damaged | withdrawn`) ⇒ nada.
 *  - **`mark`** (perdida/dañada): **solo plataforma `in_stock | listed`** (lo mismo que el ajuste del
 *    binder y la UI). 🔒 v1.80.3 §M4-SHIP.17.1 (1) (D-SHIP-5): **ninguna pieza de cliente**, ni en
 *    custodia liquidada fuera de retiro. Marcar `lost` la carta de un cliente fuera de un caso es el
 *    vector (3) de SEC-SHIP-A1: la pieza deja de ser retirable y ningún lector de deuda
 *    (`ReplacementCase`) la ve. La incidencia de custodia se registra SOLO en el palomeo del retiro
 *    o de la colocación, que abre su caso (§M4-SHIP.15). El texto de §0 que nombraba «`mark` +
 *    reposición para custodia de clientes» quedó corregido en esa revisión. ⛔ Nunca
 *    `reserved`/`picking` (pedido vivo o cobrado) ni terminales.
 *  - **`status`** (el `status:'in_stock'` del `PATCH`): **solo plataforma `in_stock | listed`**
 *    (`listed → in_stock` despublica; `in_stock → in_stock` no escribe `status`). 🔒 v1.80.3
 *    §M4-SHIP.17.1 (2) (D-SHIP-6) e invariante INV-SP-7: una pieza `lost | damaged` no vuelve a
 *    `in_stock | listed` por ningún verbo del operador. El `status:'listed'` sigue por el pipeline de
 *    publicación de v1.51 (`claimListed`, ya guardado en su `WHERE`).
 *  - **`price`** (el `listPriceCents` del `PATCH`, v1.80.2.3 `#M1-patch-price-guard`, INV-SP-8): **el
 *    mismo allowlist** que `mark`/`status` — solo plataforma `in_stock | listed`. Cliente en cualquier
 *    estado, `reserved` (su línea ya congeló `unitPriceCents`), vendida o terminal ⇒ `422`. Un solo
 *    allowlist para los tres verbos: `MARKABLE_PLATFORM_STATUSES` se declara SOLO aquí
 *    (regla de fusión `#M1-merge-rule`; candado estático en `inventory.move-mark-guards.spec.ts`).
 *  - Estado no admitido ⇒ `422 ITEM_NOT_ADJUSTABLE` (`details: { status, ownerType }`): la pieza no
 *    se opera desde M1 porque su salida va por el flujo dueño (órdenes, retiros, casos).
 */

/** Estados en que una pieza de PLATAFORMA sigue físicamente en un estante y puede moverse. */
export const MOVABLE_PLATFORM_STATUSES: readonly InventoryStatus[] = [
  'in_stock',
  'listed',
  'reserved',
  'picking',
];

/**
 * Estados en que una pieza de PLATAFORMA se puede marcar perdida/dañada (= ajuste del binder) y,
 * desde v1.80.3, los únicos desde los que el `PATCH` puede escribir `status:'in_stock'` (D-SHIP-6).
 */
export const MARKABLE_PLATFORM_STATUSES: readonly InventoryStatus[] = ['in_stock', 'listed'];

/** Verbos de pieza de M1 que pasan por estas guardas. */
export type ItemVerb = 'move' | 'mark' | 'status' | 'price';

/** Lo que las guardas leen de la pieza. */
export interface GuardedItem {
  status: InventoryStatus;
  ownerType: OwnerType;
  ownerUserId: string | null;
  ownershipStatus: OwnershipStatus | null;
}

/** Lo que las guardas leen del destino. */
export interface GuardedLocation {
  id: string;
  zone: VaultZone;
  isActive: boolean;
}

/** Pieza de cliente en custodia liquidada: la única forma de pieza ajena que M1 opera (solo `move`). */
function isCustomerCustody(item: GuardedItem): boolean {
  return (
    item.ownerType === 'customer' &&
    item.ownerUserId != null &&
    item.ownershipStatus === 'settled' &&
    item.status === 'in_custody'
  );
}

const VERB_PAST: Record<ItemVerb, string> = {
  move: 'moved',
  mark: 'marked',
  status: 'status-changed',
  price: 're-priced',
};

function notAdjustable(item: GuardedItem, verb: ItemVerb): BusinessException {
  return BusinessException.validation(
    'ITEM_NOT_ADJUSTABLE',
    `Item in status ${item.status} (${item.ownerType}) cannot be ${VERB_PAST[verb]} from M1`,
    { status: item.status, ownerType: item.ownerType },
  );
}

/**
 * ¿Qué clase de pieza se opera? Lanza `ITEM_NOT_ADJUSTABLE` si su estado no admite el verbo.
 * - `move` ⇒ `'platform' | 'customer'`; `customer` ⇒ el llamador además DEBE comprobar el retiro
 *   activo y el cajón.
 * - `mark` / `status` / `price` ⇒ siempre `'platform'` (D-SHIP-5/6 y v1.80.2.3: **no hay rama de
 *   cliente**; toda pieza ajena cae en `ITEM_NOT_ADJUSTABLE` sin mirar retiros ni puertas).
 */
export function assertOperable(item: GuardedItem, verb: 'mark' | 'status' | 'price'): 'platform';
export function assertOperable(item: GuardedItem, verb: 'move'): 'platform' | 'customer';
export function assertOperable(item: GuardedItem, verb: ItemVerb): 'platform' | 'customer';
export function assertOperable(item: GuardedItem, verb: ItemVerb): 'platform' | 'customer' {
  if (item.ownerType === 'platform') {
    const allowed = verb === 'move' ? MOVABLE_PLATFORM_STATUSES : MARKABLE_PLATFORM_STATUSES;
    if (allowed.includes(item.status)) return 'platform';
    throw notAdjustable(item, verb);
  }
  // 🔒 D-SHIP-5/6: la rama de cliente existe SOLO para `move` (consolidar cajones, §M4-VAULT.4 r.4).
  if (verb === 'move' && isCustomerCustody(item)) return 'customer';
  throw notAdjustable(item, verb);
}

/** La pieza del cliente está en un retiro ya cobrado (`picking|guia|enviado`) ⇒ 409. */
export function inActiveWithdrawalError(): BusinessException {
  return BusinessException.conflict(
    'ITEM_IN_ANOTHER_SHIPMENT',
    'Item is in an active withdrawal; operate it from the shipment',
  );
}

function locationError(reason: string, extra: Record<string, unknown> = {}): BusinessException {
  return BusinessException.validation('LOCATION_NOT_AVAILABLE', `Location not available: ${reason}`, {
    reason,
    ...extra,
  });
}

/**
 * Valida el destino de un `move`. `customerDrawers` solo se usa para piezas de cliente: son los
 * cajones de `customerDrawersOf` para su dueño (la MISMA función que la cola y el `confirm`).
 */
export function assertMoveDestination(
  kind: 'platform' | 'customer',
  loc: GuardedLocation | null,
  customerDrawers: readonly CustomerDrawerRef[] = [],
): void {
  if (!loc) throw locationError('not_found');
  if (!loc.isActive) throw locationError('inactive');
  if (kind === 'platform') {
    if (loc.zone !== 'platform_stock') throw locationError('not_platform_stock');
    return;
  }
  if (loc.zone !== 'customer_custody') throw locationError('not_customer_custody');
  if (!customerDrawers.some((d) => d.id === loc.id)) {
    // Mismo `details` que el `confirm` (H-5): los cajones tal como `customerDrawersOf` los devolvió.
    throw locationError('not_customer_drawer', { customerDrawers: [...customerDrawers] });
  }
}

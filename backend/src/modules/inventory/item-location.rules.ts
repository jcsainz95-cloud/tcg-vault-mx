import { InventoryStatus, OwnerType, OwnershipStatus, VaultZone } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import type { CustomerDrawerRef } from '../vault/vault-placement.rules';

/**
 * item-location.rules.ts — las guardas de ESTADO y de ZONA de los dos verbos físicos de M1:
 * `POST /admin/inventory/items/:id/move` y `POST /admin/inventory/items/:id/mark`.
 *
 * *Por qué existen (medido por techlead y QA sobre `16a3170`):* ninguno de los dos verbos miraba el
 * estado de la pieza ni la zona del destino. El API aceptaba **mover la carta DE UN CLIENTE, en un
 * retiro cobrado, al estante de tienda** (`platform_stock`) y **marcar perdida una pieza en `picking`
 * de un pedido ya cobrado**. Las dos son escrituras sobre algo que no es del operador decidir desde M1.
 *
 * Reglas (un cuerpo por regla; el servicio solo las aplica):
 *  - **Destino:** existe (`not_found`), está activo (`inactive`), y su zona encaja con el dueño de la
 *    pieza. Mismo código y mismos `reason` que el `confirm` de colocación (§M4-VAULT.5):
 *    `422 LOCATION_NOT_AVAILABLE`.
 *  - **Pieza de plataforma** (`ownerType='platform'`) ⇒ solo `platform_stock`
 *    (`reason:'not_platform_stock'` — ⚠️ `reason` NUEVO dentro de un código existente; va al arquitecto).
 *    Estados movibles: `in_stock | listed | reserved | picking` (la pieza sigue en un estante; en
 *    `picking` de un pedido directo el operador la lleva a la mesa de empaque, que es estante).
 *  - **Pieza de cliente** (`ownerType='customer'`) ⇒ solo si está en custodia liquidada
 *    (`in_custody` + `settled`), **no** en un retiro cobrado (`409 ITEM_IN_ANOTHER_SHIPMENT`), y
 *    solo a un cajón `customer_custody` **que ya es de ese cliente** según `customerDrawers`
 *    (`reason:'not_customer_drawer'`, con `customerDrawers` en `details`, como el `confirm`). El
 *    contrato (§M4-VAULT.4 regla 4) reserva este `move` para CONSOLIDAR cajones del mismo cliente;
 *    la PRIMERA colocación (cliente sin cajón) es del `confirm`, que toma la puerta del cliente.
 *  - **Terminales** (`shipped | delivered | lost | damaged | withdrawn`) ⇒ nada.
 *  - **`mark`** (perdida/dañada): plataforma `in_stock | listed` (lo mismo que el ajuste del binder
 *    y la UI); cliente `in_custody` liquidada fuera de retiro — el contrato nombra `mark` como la vía
 *    de la incidencia de custodia (§0 `ITEM_NOT_ADJUSTABLE`: «`mark` + reposición para custodia de
 *    clientes»). ⛔ Nunca `reserved`/`picking` (pedido vivo o cobrado) ni terminales.
 *  - Estado no admitido ⇒ `422 ITEM_NOT_ADJUSTABLE` (`details: { status, ownerType }`): la pieza no
 *    se opera desde M1 porque su salida va por el flujo dueño (órdenes, retiros).
 */

/** Estados en que una pieza de PLATAFORMA sigue físicamente en un estante y puede moverse. */
export const MOVABLE_PLATFORM_STATUSES: readonly InventoryStatus[] = [
  'in_stock',
  'listed',
  'reserved',
  'picking',
];

/** Estados en que una pieza de PLATAFORMA se puede marcar perdida/dañada (= ajuste del binder). */
export const MARKABLE_PLATFORM_STATUSES: readonly InventoryStatus[] = ['in_stock', 'listed'];

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

/** Pieza de cliente en custodia liquidada: la única forma de pieza ajena que M1 opera. */
function isCustomerCustody(item: GuardedItem): boolean {
  return (
    item.ownerType === 'customer' &&
    item.ownerUserId != null &&
    item.ownershipStatus === 'settled' &&
    item.status === 'in_custody'
  );
}

function notAdjustable(item: GuardedItem, verb: 'move' | 'mark'): BusinessException {
  return BusinessException.validation(
    'ITEM_NOT_ADJUSTABLE',
    `Item in status ${item.status} (${item.ownerType}) cannot be ${verb === 'move' ? 'moved' : 'marked'} from M1`,
    { status: item.status, ownerType: item.ownerType },
  );
}

/**
 * ¿Qué clase de pieza se opera? Lanza `ITEM_NOT_ADJUSTABLE` si su estado no admite el verbo.
 * `customer` ⇒ el llamador además DEBE comprobar el retiro activo y (en `move`) el cajón.
 */
export function assertOperable(item: GuardedItem, verb: 'move' | 'mark'): 'platform' | 'customer' {
  if (item.ownerType === 'platform') {
    const allowed = verb === 'move' ? MOVABLE_PLATFORM_STATUSES : MARKABLE_PLATFORM_STATUSES;
    if (allowed.includes(item.status)) return 'platform';
    throw notAdjustable(item, verb);
  }
  if (isCustomerCustody(item)) return 'customer';
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

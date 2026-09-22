# BORRADOR — Contrato de datos «Pedidos a preparar» (rediseño de la cola de picking, M4)

> ✅ **ATERRIZADO PARCIALMENTE (2026-09-22, arquitecto, rama `claude/m4-pedidos-preparar`).** La **rebanada de SOLO
> LECTURA** de este borrador (§1 sin estado interactivo, §4 checklist, §7 fila «DTO cola» + «Endpoint cola», §6.A/§6.B)
> quedó en el CONTRATO VIVO: `API_CONTRACT.md` **§M4-PREP** (`PreparationOrderDTO`/`PreparationItemDTO`/`LocationView`/
> `PreparationDestination`, endpoint reproyectado con `?destination`) y `ARCHITECTURE.md` **§4.21p**.
> **Correcciones vs este borrador:** (1) `orderId`/`orderNumber` son **`| null`** (un retiro de bóveda no tiene orden);
> (2) **`quantity` es constante 1** (un `ShipmentItem` = una pieza; no hay columna cantidad); (3) `setName`/`imageSmallUrl`
> son **nullable**. **`PreparationItemStatus` y `PreparationState` NO se declararon** (son de la rebanada interactiva).
> **⚠️ HALLAZGO:** bajo el modelo actual la cola solo contiene `destination='ship'` — las órdenes `fulfillmentMode='vault'`
> **no generan `ShipmentRequest`**, así que la cubeta `vault` queda **vacía** hasta una versión posterior que la alimente
> (y esa versión **probablemente pide schema**; por eso se detuvo aquí, cero migración). Detalle en §M4-PREP.
> **PLANEADO — fuera de la versión aterrizada:** §2 (palomear/firmar + columnas `preparedAt`/`preparedByUserId`),
> §3 (sugerencia de bóveda), §5 (💰 reembolso parcial — requiere los 3 veredictos).


**Proyecto:** TCG HUNT · tcghunt.mx
**Stream:** M4 · rediseño de la cola de envíos/picking → «Pedidos a preparar»
**Rol que escribe:** arquitecto
**Fecha:** 2026-09-15
**Estado:** ⚠️ **BORRADOR PARA REVISIÓN del dueño / orquestador. NO es contrato vivo.** No toca
`docs/API_CONTRACT.md` ni código; propone la forma de datos que ese contrato necesitará crecer.
**Fuente de producto:** `PROJECT.md` §«Pedidos a preparar (rediseño de la cola de envíos/picking, M4)»
(aprobada por el dueño 2026-09-15, con las 6 decisiones incorporadas).
**Handoff aguas abajo:** una vez validado, se aterriza en `API_CONTRACT.md` §M4 y §A1 (refund), el
DTO de contrato del frontend (`frontend/src/types/contract.ts`) y el schema de Prisma.

> 💰 **Este borrador toca DINERO en un punto concreto** — el subflujo de *carta no encontrada ⇒
> reembolso parcial* (§5). Ese punto, y solo ese, requiere los **tres veredictos** (QA + techlead +
> seguridad) antes de implementarse. El resto es visibilidad y operación.

---

## 0. Qué existe hoy (medido sobre `origin/main`, 2026-09-15)

Para no diseñar a ciegas, esto es el estado real del que parte el rediseño:

| Pieza | Dónde | Qué trae hoy |
|---|---|---|
| DTO de la fila de la cola | `frontend/src/types/contract.ts` `PickingListEntryDTO` (~1211-1216) | **solo** `shipmentId`, `inventoryItemId`, `folio`, `location` (label plano `"C03-F02-S15"` \| `"UNASSIGNED"`) |
| Endpoint de la cola | `GET /admin/shipments/picking-list?date=` (`shipments.service.ts::pickingList`, `admin-shipments.controller.ts:38`) | `flatMap` de `ShipmentRequest{status:'picking'}` → items → `inventoryItem.location`, ordenado por `location`. **Solo envíos ya cobrados** (`status='picking'` ⇒ pagó) |
| Máquina de estados M4 | `shipments.service.ts::updateStatus` | `solicitado→picking→guia→enviado→entregado` (+`cancelado`). Precondición de estado en el `WHERE` (`REL-B`), aviso detrás de la reclamación |
| Captura de guía | `POST /admin/shipments/:id/tracking` (`setTracking`) | `carrier`+`trackingNumber` (+`shippingCostCents` interno). Sella `trackingNoticeSentAt` para no reenviar |
| Discriminador de destino | `Order.fulfillmentMode` ∈ `{vault, direct_ship}` (`schema.prisma:1145`); `ShipmentRequest.orderId` null=retiro de bóveda, poblado=envío directo | Canónico del sistema (`ARCHITECTURE §4.21d`). ⭐ **Ya es a nivel de PEDIDO** — encaja con DECISIÓN #1 |
| Importe por carta | `OrderItem.unitPriceCents` (`schema.prisma:1214`) | ⚠️ `ShipmentItem` **no** lleva precio: el monto por carta vive en la ORDEN, no en el envío |
| Refund admin | `POST /admin/orders/:id/refund` (`admin-orders.controller.ts:224`), `@MoneyOut()` → **super_admin** | Reembolsa el **total** (Stripe `refunds.create` **sin** `amount`), solo `status='settled'`, marca `refunded`, **no** re-agrega inventario. `RefundDto = { reason }` |
| Detección de parcial | `payments.service.ts::onChargeRefunded:551-564` | Ya *detecta* un reembolso parcial vía webhook y **loguea «sin cambio de estado»**. Hoy nada dispara un parcial desde la app |
| Nombre del cliente | `User.name` (**un solo string**, `nameSource`), `AddressDTO.recipientName` (**un solo string**) | ⚠️ **No hay `lastName` estructurado** — problema real para el «archivero alfabético por apellido» (§6.A) |
| Identidad de carta | `CardDTO{name, setName, imageSmallUrl…}`, `ListingDTO{finish, gradingCompany, gradeValue, rawCondition, sealedCondition}` | El acabado/condición/grado ya existen; hay que exponerlos en la cola |

**Lectura del gap:** el DTO de la cola es la pieza más pobre del flujo. Todo lo que el operador
necesita ver ya existe en el modelo (identidad de carta, destino por orden, cliente, importe por
línea); lo que falta es **proyectarlo** en la fila de la cola y **añadir dos escrituras nuevas**
(preparado+firma; carta faltante⇒parcial).

---

## 1. DTO propuesto de la cola — `PreparationOrderDTO` (agrupado por PEDIDO)

**Cambio de forma, no solo de campos.** Hoy la cola es una lista PLANA de piezas ordenada por
ubicación. El producto (§3, §5.7) pide palomear **por carta dentro de un pedido** y dar el pedido por
preparado como una unidad ⇒ la fila deja de ser la pieza y pasa a ser el **pedido**, con sus cartas
anidadas. Se propone **agrupar** y **renombrar** el DTO (el nombre «picking» sale de cara al operador,
DECISIÓN de renombrado; se puede conservar internamente el endpoint pero el DTO cambia).

```ts
// Reemplaza a PickingListEntryDTO. Un elemento = UN pedido a preparar.
export interface PreparationOrderDTO {
  // --- identidad y traza ---
  shipmentId: string;              // (hoy)
  orderId: string;                 // NUEVO — la orden que fulfilla (para importe/refund)
  orderNumber: string;             // NUEVO — folio legible "TCG-000123"
  // --- destino (a nivel de PEDIDO — DECISIÓN #1) ---
  destination: PreparationDestination;   // 'vault' | 'ship'  (deriva de Order.fulfillmentMode)
  // --- antigüedad (DECISIÓN #6: atender lo más viejo primero) ---
  requestedAt: string;             // ISO; el front ordena asc por defecto
  // --- cliente ---
  customer: {
    // ⚠️ ver §6.A: hoy solo hay User.name (un string). Propuesta: apellido derivado + advertencia.
    lastName: string | null;       // apellido (mapea al archivero alfabético) — puede ser null
    fullName: string;              // nombre completo tal cual (User.name | recipientName)
  };
  // --- solo destino ENVÍO: dirección COMPLETA con calle (CA #6) ---
  shipTo?: {
    recipientName: string | null;
    line1: string;                 // la CALLE que la tarjeta omite hoy
    line2?: string;
    neighborhood?: string;
    city: string; state: string; postalCode: string; country: string;
    phone: string;
  };
  // --- las cartas del pedido ---
  items: PreparationItemDTO[];
  // --- estado de preparación (NUEVO — §2) ---
  preparation: PreparationState;
}

export type PreparationDestination = 'vault' | 'ship';

export interface PreparationItemDTO {
  shipmentItemId: string;          // NUEVO — el nodo que se palomea (hoy ShipmentItem no tiene DTO)
  inventoryItemId: string;         // (hoy)
  orderItemId: string;             // NUEVO — enlace al importe (unitPriceCents) para el parcial
  folio: string;                   // (hoy)
  quantity: number;                // NUEVO (CA #10) — normalmente 1 por pieza física
  // --- identidad de la carta (DECISIÓN #6 / CA #3, #10) ---
  card: {
    name: string;                  // nombre de la tienda
    setName: string;               // SET — prominente para ENVÍO (mapea a carpeta por set)
    finish: Finish;                // acabado, nomenclatura de tienda
    // condición/grado JUNTOS al acabado (CA #10): p.ej. "NM" | "PSA 9" | "mint"
    conditionLabel: string;        // etiqueta legible ya compuesta por el back
    imageSmallUrl: string;         // miniatura (CA #10)
  };
  // --- de dónde sacarla ---
  currentLocation: LocationView;   // ver §6.B (resuelve "UNASSIGNED")
  // --- estado por carta (NUEVO — §2, §5) ---
  status: PreparationItemStatus;   // 'pending' | 'picked' | 'missing'
}

// CA #11: "UNASSIGNED" deja de viajar como código; el back manda estado + texto.
export interface LocationView {
  kind: 'assigned' | 'unassigned';
  label?: string;                  // "C03-F02-S15" cuando kind='assigned'
}

export type PreparationItemStatus = 'pending' | 'picked' | 'missing';
```

**Notas de diseño:**
- `destination` **deriva** de `Order.fulfillmentMode` (`vault`⇒`'vault'`, `direct_ship`⇒`'ship'`).
  No se inventa un campo nuevo: se proyecta el discriminador canónico. Esto **garantiza por
  construcción** que un pedido no mezcla destinos (DECISIÓN #1) porque el modo es del pedido.
- `conditionLabel` se compone en el **back** (no en el front) para no repetir la lógica de
  `raw/graded/sealed` — sale de `rawCondition` | (`gradingCompany`+`gradeValue`) | `sealedCondition`.
- `orderItemId` es la costura con el importe: el parcial (§5) necesita `unitPriceCents` **de la
  orden**, porque `ShipmentItem` no lo lleva.

---

## 2. Preparación + firma (estado NUEVO, NO toca dinero)

El producto pide (CA #4, #5, #7): palomear cada carta, dar el pedido por preparado solo cuando todas
estén `picked` **o** `missing`, registrar **quién preparó** (usuario con sesión, DECISIÓN #3) y
**cuándo**, y ofrecer el siguiente paso según destino.

### Estado agregado por pedido

```ts
export interface PreparationState {
  status: 'in_progress' | 'prepared';
  preparedByUserId?: string;   // tomado del usuario con sesión, NO capturado a mano (DECISIÓN #3)
  preparedByName?: string;     // para pintar sin resolver el id
  preparedAt?: string;         // ISO
  // conteo derivado para el gate de "todas palomeadas o faltantes"
  pickedCount: number; missingCount: number; totalCount: number;
}
```

### Endpoints propuestos (M4)

| Método · ruta | Rol | Cuerpo | Efecto | Toca dinero |
|---|---|---|---|---|
| `PATCH /admin/shipments/:id/prep-items/:shipmentItemId` | operador+ | `{ status: 'picked' \| 'pending' }` | palomea / des-palomea una carta | no |
| `POST /admin/shipments/:id/prepared` | operador+ | `{}` | marca el pedido **preparado**; **el back toma `preparedBy` del JWT** (nunca del body); exige que **toda** carta esté `picked` o `missing`, si no `409 CONFLICT` | no |

**Reglas:**
- `preparedByUserId` **jamás** llega del cliente — se lee de la sesión (misma doctrina que
  `refund` lee `@CurrentUser`). Se registra en la **bitácora/auditoría** (`AuditLog`, `action:
  'shipment.prepared'`) — CA #4 exige que sea consultable ahí.
- Gate de completitud en el **motor** (WHERE + count), no en un `if` de JS — es la lección de `REL-B`
  ya presente en `updateStatus`: la precondición baja a la transacción para que dos operadores
  concurrentes no den por preparado dos veces.
- **Siguiente paso según destino** (CA #5) — el front lo decide con `destination`, pero el back lo
  **hace cumplir**:
  - `destination='ship'` ⇒ el único avance ofrecido es la **guía** (`POST …/tracking`, ya existe).
  - `destination='vault'` ⇒ el único avance es **cambio de ubicación**; **no** hay guía. Ver §3.

> ⚖️ **Pregunta abierta para el dueño/orquestador (no-dinero):** ¿«preparado» es un **estado nuevo
> explícito** en `ShipmentRequest` (columna `preparedAt`/`preparedByUserId`, sin tocar el enum
> `ShipmentStatus`), o se pliega dentro de la transición `picking→guia`? Propuesta del arquitecto:
> **columnas nuevas** (`preparedAt`, `preparedByUserId`) **sin** nuevo valor de enum — «preparado» es
> un hito DENTRO de `picking`, no un estado de la máquina; así la máquina de estados vigente
> (`REL-B`, avisos) no se toca. La transición a `guia`/ubicación sigue siendo el avance.

---

## 3. Bóveda: el sistema PROPONE la ubicación (DECISIÓN #5, NO toca dinero)

Para `destination='vault'`, al llegar al cambio de ubicación el sistema **propone** la bóveda del
cliente (por apellido, archivero alfabético) y el operador **solo confirma** (no la teclea).

```ts
// GET /admin/shipments/:id/vault-location-suggestion  → operador+
export interface VaultLocationSuggestionDTO {
  suggested: LocationView;      // la bóveda propuesta del cliente
  source: 'existing_customer_vault' | 'alpha_by_lastname' | 'none';
  editable: true;               // el operador confirma o cambia
}
```

- **De dónde sale la propuesta** (el dueño pidió que el arquitecto lo defina): la ubicación **actual
  de otras piezas en bóveda del mismo cliente** (misma `ownerUserId`, `zone='vault'`) es la fuente
  más fiable (`source='existing_customer_vault'`). Si el cliente aún no tiene bóveda, se cae al
  criterio alfabético por apellido (`source='alpha_by_lastname'`), que **depende del apellido** — ver
  §6.A. La confirmación reusa el endpoint de asignación de ubicación de inventario ya existente
  (a verificar contra `API_CONTRACT §M6`; no se inventa uno nuevo si ya hay).

---

## 4. Datos que la cola despliega (checklist contra §4 del producto)

| Dato de producto (§4) | Campo del DTO | Fuente |
|---|---|---|
| Destino prominente «Para bóveda»/«Para enviar» | `destination` | `Order.fulfillmentMode` |
| Nombre + set + acabado | `items[].card.{name,setName,finish}` | `Card` + `InventoryItem.finish` |
| Condición/grado | `items[].card.conditionLabel` | `rawCondition`\|`grade*`\|`sealedCondition` |
| Miniatura | `items[].card.imageSmallUrl` | `Card.imageSmallUrl` |
| Cantidad | `items[].quantity` | `OrderItem`/pieza |
| Bóveda: apellido (+nombre completo) | `customer.lastName` (+`fullName`) | ⚠️ `User.name` — §6.A |
| Envío: SET prominente + dirección con calle | `items[].card.setName` + `shipTo.line1…` | `Card` + `addressSnapshot` |
| Ubicación actual (resuelve UNASSIGNED) | `items[].currentLocation` | `InventoryItem.location` — §6.B |
| Antigüedad | `requestedAt` | `ShipmentRequest.requestedAt` |
| Quién preparó + cuándo | `preparation.preparedBy*` | JWT + `AuditLog` |
| Carta faltante / monto a reembolsar | `items[].status='missing'` + §5 | `OrderItem.unitPriceCents` |
| Referencia del pedido | `orderNumber` / `shipmentId` | `Order`/`Shipment` |
| Cubetas «enviar»/«bóveda» (CA #8) | filtro `?destination=vault\|ship` | derivado de `fulfillmentMode` |

---

## 5. 💰 Subflujo «carta no encontrada» ⇒ REEMBOLSO PARCIAL (TOCA DINERO — 3 veredictos)

Este es el único punto que mueve dinero, y el que más diseño necesita porque el refund de hoy es
**todo-o-nada**. DECISIÓN #2: al no encontrar una carta, (a) se ajusta el total a pagar, (b) se avisa
al cliente, (c) el admin ve el monto exacto y se ejecuta el parcial conectado con
`POST /admin/orders/:id/refund`.

### 5.1 El hecho central: hoy el refund NO es parcial

- `POST /admin/orders/:id/refund` llama `stripe.refund(pi)` **sin `amount`** ⇒ Stripe reembolsa el
  **total** del PaymentIntent. Para un parcial hay que pasar `amount` (en centavos) a
  `refunds.create`.
- Guarda de estado hoy: `order.status !== 'settled'` ⇒ `400`. Un parcial **también** parte de una
  orden cobrada, pero la orden **no queda `refunded`** (queda cobrada por el resto).
- `onChargeRefunded` (webhook) ya distingue `fullyRefunded` y en parcial **loguea «sin cambio de
  estado»**. O sea: el sistema ya sabe *reconocer* un parcial que llega de Stripe; lo que falta es
  **originarlo** desde la app y **darle estado de orden**.

### 5.2 Forma propuesta

**Marcar faltante (paso previo, sin dinero todavía):**
```
PATCH /admin/shipments/:id/prep-items/:shipmentItemId  { status: 'missing' }   // operador+
```
Esto **no** mueve dinero por sí solo: marca la pieza, permite seguir preparando el resto (CA #13), y
**calcula** el monto a reembolsar de esa carta (`OrderItem.unitPriceCents × quantity`, con la
convención de IVA de la orden — el importe ya lo lleva dentro, §M10-IVA).

**Ver el monto exacto (CA #16) — money-safe, sin ejecutar nada:**
```ts
// GET /admin/orders/:id/refund-preview  → super_admin (misma puerta que el refund)
export interface RefundPreviewDTO {
  orderId: string;
  missingItems: { orderItemId: string; folio: string; cardName: string; amountCents: number }[];
  refundableCents: number;      // suma exacta — el monto que el admin verá y ejecutará
  alreadyRefundedCents: number; // lo ya reembolsado, para no reembolsar dos veces
  currency: 'MXN';
}
```

**Ejecutar el parcial (💰 — el único money-out nuevo):**
```
POST /admin/orders/:id/refund   { reason, amountCents?, refundItemIds?[] }   // super_admin, @MoneyOut, Idempotency-Key
```
Se propone **EXTENDER el endpoint existente** en vez de crear uno nuevo, para que toda salida de
dinero pase por la misma puerta ya auditada (`@MoneyOut`, super_admin, idempotencia, `AuditLog`):
- Sin `amountCents` ⇒ comportamiento de hoy (total, orden ⇒ `refunded`). **No regresa** nada.
- Con `amountCents` (o `refundItemIds`) ⇒ **parcial**: `stripe.refund(pi, { amount })`, la orden
  **NO** pasa a `refunded` (queda cobrada por el resto), y se marca en una columna nueva
  `partialRefundedCents` (acumulable) + `refundedAt` del parcial. El aviso al cliente (CA #15) sale
  del **centro de avisos (§R)**, no de un correo inline.

### 5.3 Puntos que los tres veredictos DEBEN cerrar (marcados 💰)

1. 💰 **Monto autoritativo:** ¿el `amountCents` lo calcula el **servidor** desde `OrderItem`, o lo
   manda el cliente? **Propuesta del arquitecto: SIEMPRE el servidor** (deriva de `refundItemIds` →
   `unitPriceCents`); el `amountCents` del body, si viaja, es solo para **cotejo** y un desajuste ⇒
   `409`. El cliente nunca dicta cuánto dinero sale. *(seguridad + money-safety)*
2. 💰 **Doble reembolso:** idempotencia por `(orderId, refundItemIds)` además del `Idempotency-Key`
   de Stripe; `alreadyRefundedCents` impide reembolsar dos veces la misma carta. *(QA)*
3. 💰 **Estado de la orden:** ¿nueva columna `partialRefundedCents` (propuesta) o un estado
   `partially_refunded` en `OrderStatus`? Propuesta: **columna acumulable, sin nuevo estado** — la
   orden sigue `settled` por el resto entregado; añadir un estado tocaría toda la máquina de órdenes.
   *(techlead)*
4. 💰 **Inventario de la carta faltante:** la pieza `missing` **no se re-agrega** al inventario (igual
   que el refund de hoy no re-agrega); su `InventoryItem` necesita un destino claro (¿`lost`?
   ¿investigación?). *(techlead + seguridad — fuera de la línea de dinero pero adyacente)*
5. 💰 **Convención de IVA:** el `amountCents` a reembolsar debe respetar la `priceConvention`/
   `ivaRatePct` **de esa orden** (histórica), NUNCA el dial vivo (doctrina `IVA-5`). *(money-safety)*
6. 💰 **Rol:** el parcial hereda `@MoneyOut` ⇒ **super_admin**. El operador **marca faltante**
   (no-dinero) pero **no ejecuta** el reembolso. Separación de poderes. *(seguridad)*

---

## 6. Dos huecos de datos que el arquitecto señala explícitamente

### 6.A ⚠️ No existe apellido estructurado — y el flujo de bóveda lo pide

El producto (CA #10, DECISIÓN #5) apoya el archivero alfabético **en el apellido**. Pero:
`User.name` es **un solo string** (con `nameSource` que puede ser `derived`/`google`), y
`AddressDTO.recipientName` también. **No hay `lastName`.**

Opciones para el dueño/orquestador:
1. **Derivar** el apellido del `name` (último token) — barato, **frágil** (nombres compuestos,
   apellidos compuestos, orden distinto). Se emite `customer.lastName` derivado + se acepta que a
   veces falle. Riesgo: la carta se archiva en la letra equivocada.
2. **Campo nuevo estructurado** (`lastName`) en `User`/`Address` — correcto, pero es **cambio de
   modelo y de captura** (formularios, KYC) ⇒ más caro y fuera del alcance «operación/visibilidad».
3. **Propuesta del arquitecto (intermedia):** emitir `lastName: string | null` **derivado** con una
   marca de confianza, y NO bloquear la propuesta de bóveda (§3) en él — la propuesta primaria sale
   de *la bóveda existente del cliente* (que no depende del apellido), y el apellido es solo la
   **etiqueta de ordenación visual**. Así el hueco de datos no bloquea el flujo.

### 6.B «UNASSIGNED» deja de ser un código (CA #11)

Hoy `location` viaja como `"UNASSIGNED"` literal. Propuesta: `LocationView{kind, label?}` — el front
pinta un texto entendible («sin ubicación asignada — asígnala al preparar») en vez del código. No es
solo cosmético: separa el estado (`kind`) del dato (`label`) para que el front no compare strings.

---

## 7. Resumen de cambios que este borrador propondría al contrato vivo

| Área | Cambio | Toca dinero |
|---|---|---|
| DTO cola | `PickingListEntryDTO` → `PreparationOrderDTO` (agrupado por pedido, con identidad, destino, cliente, dirección, estado) | no |
| Endpoint cola | `GET /admin/shipments/picking-list` reproyectado (o nuevo alias `…/preparation-queue`), con `?destination=` | no |
| Prep | `PATCH …/prep-items/:id`, `POST …/prepared`; columnas `preparedAt`/`preparedByUserId` | no |
| Bóveda | `GET …/vault-location-suggestion` | no |
| **Refund** | **extender `POST /admin/orders/:id/refund` a parcial** (`amountCents`/`refundItemIds`), `GET …/refund-preview`, columna `partialRefundedCents` | 💰 **sí** |
| Aviso | carta faltante ⇒ aviso al cliente vía **§R centro de avisos** | no (borde) |
| Modelo | `lastName` (§6.A) — decisión de alcance del dueño | no |

**Lo que NO cambia** (NO-alcance del producto §2): política de envíos, tarifa MX$175, impresión de
etiquetas (cero), M5/buylist, la máquina de estados de envío (`REL-B` intacta).

---

*Fin del borrador. Sujeto a las respuestas del dueño/orquestador y, en el punto 💰 (§5), a los tres
veredictos (QA + techlead + seguridad) antes de tocar código.*

# API_CONTRACT_FICHA_CLIENTE — ficha completa del cliente en M6 (§FICHA-CLIENTE en `docs/DECISIONES.md`; 2026-11-22)

Convenciones: dinero en centavos enteros MXN (`*Cents`); fechas ISO-8601 UTC; `overview` solo lectura sin schema; las notas (§1b) añaden una tabla. Decidido por el dueño: diseño A, con notas, y el operador ve totales (HECHOS 2026-11-22). Roles: guard de clase de `AdminUsersController` (`vault_operator` + `super_admin`) y `NotSupplierTargetGuard` (cuenta `supplier` ⇒ 404). Respuesta `Cache-Control: no-store`.

## 1. `GET /api/v1/admin/users/:id/overview`
Rol: `vault_operator` y `super_admin`, **mismo DTO para ambos** (incluidos los totales `lifetime`). Id inexistente o proveedor ⇒ 404. Implementación: `select`/`groupBy` en lista blanca (R-1), una transacción de solo lectura, sin N+1.

```ts
interface AdminUserOverviewDTO {
  userId: string;
  generatedAt: string;
  attention: {               // «Necesita atención»; cada uno = conteo de estados NO terminales
    ordersPending: number;               // Order.status = pending
    shipmentsOpen: number;               // ShipmentRequest.status ∈ solicitado|picking|guia|enviado, kind=outbound
    sellRequestsOpen: number;            // SellRequest.status ∉ terminales (pagada|rechazada|abandonada|expirada)
    sellRequestsNeedingStore: number;    // recibida|verificacion|aprobada (la pelota está de nuestro lado)
    disputesOpen: number;                // abierta|en_revision
    refundsOpen: number;                 // PaymentRefund requested|submitted + ManualRefund pending
  };
  summary: {
    customerSince: string;               // User.createdAt
    lastOrderAt: string | null;          // Order.settledAt máximo (status settled)
    lastSellRequestAt: string | null;
    lifetime: {                          // ambos roles; siempre presente
      purchasesCount: number;            // Order.status = settled
      purchasesCents: number;            // Σ totalCents de las settled
      refundedCents: number;             // Σ PaymentRefund.amountCents succeeded + ManualRefund.amountCents paid
      salesPaidCount: number;            // SellRequest.status = pagada
      salesPaidCents: number;            // Σ approvedTotalCents de las pagadas (lo que se le pagó)
      salesInProgressCents: number;      // Σ (approvedTotalCents ?? quotedTotalCents) de las abiertas
    };
  };
  vault: {
    piecesCount: number;                 // InventoryItem ownerUserId = :id, en custodia/listada (misma regla que `ownedItems`)
    valueCents: number | null;           // Σ referenceValue de las piezas con precio; null si NINGUNA tiene
    pricedCount: number;                 // cuántas piezas tienen precio (si < piecesCount, la UI avisa «N sin precio»)
    asOf: string | null;                 // fecha más antigua de los precios usados
  };
  shipments: { total: number; items: ShipmentRef[] };       // últimos 5 por requestedAt desc
  refunds:   { total: number; items: RefundRef[] };         // últimos 5 por createdAt desc (Payment + Manual mezclados)
  wishlist:  { itemCount: number; alertsPaused: boolean };  // User.wishlistAlertsPausedAt != null
  totals: { orders: number; sellRequests: number; disputes: number; ownedItems: number }; // para «Ver todos (N)»
}
interface ShipmentRef {
  id: string; status: 'solicitado'|'picking'|'guia'|'enviado'|'entregado'|'cancelado';
  mode: 'withdrawal' | 'direct_ship';    // sin orderId = retiro de bóveda; con orderId = envío directo
  orderId: string | null; orderNumber: string | null;
  itemsCount: number; totalCents: number;
  carrier: string | null; trackingNumber: string | null;
  trackingUrl: string | null;            // armado en servidor con la tabla de paqueterías existente; null si no hay guía
  requestedAt: string; shippedAt: string | null; deliveredAt: string | null;
}
interface RefundRef {
  id: string; channel: 'card' | 'spei';  // PaymentRefund = card; ManualRefund = spei
  status: 'requested'|'submitted'|'succeeded'|'failed'|'pending'|'paid'|'cancelled';
  amountCents: number; orderId: string | null; createdAt: string;
}
```
**Prohibido en la respuesta (candado R-1 + prueba):** dirección de envío, CLABE (ni enmascarada: ya viene en `GET /:id`), RFC, ids/llaves de Stripe, `idempotencyKey`, notas libres de reembolso, `ineFrontKey/ineBackKey`, `clabeSnapshotEnc`, cualquier ref de INE.

## 1b. Notas internas del cliente (`CustomerNote`)
**Modelo (aditivo, `schema.prisma`):** `CustomerNote { id uuid; userId → User (onDelete Cascade); authorId String? → User (SetNull); body VarChar(1000); pinned Boolean @default(false); clientRequestId String?; createdAt; updatedAt; deletedAt DateTime? }`; `@@index([userId, pinned, createdAt])`, `@@unique([authorId, clientRequestId])`. Solo relaciones Prisma en `User` (sin columnas nuevas). Borrado = lógico (`deletedAt`; la fila queda para auditoría y no sale en listas). Si la cuenta se anonimiza, un paso en ese flujo existente borra el `body` de sus notas (PII).
**Reglas:** `body` se recorta (trim), 1–1000 caracteres, texto plano (no se interpreta HTML/markdown); máx. 200 notas vivas por cliente (409 `NOTE_LIMIT`); límite 30 escrituras/min por actor. `clientRequestId` (uuid del cliente, opcional) hace idempotente el doble clic: repetido ⇒ devuelve la nota ya creada (200).
**Endpoints** (ambos roles; `no-store`; cuenta proveedor ⇒ 404; nota de otro cliente ⇒ 404):
| Método y ruta | Request | Response |
|---|---|---|
| `GET /admin/users/:id/notes` | `?cursor=&limit≤50` | `{items: NoteDTO[], nextCursor}`; orden: fijadas primero, luego `createdAt` desc |
| `POST /admin/users/:id/notes` | `{body, pinned?, clientRequestId?}` | 201 `NoteDTO` |
| `PATCH /admin/users/:id/notes/:noteId` | `{body?, pinned?}` | `NoteDTO`; cambiar `body` = solo el autor o `super_admin` (si no, 403); `pinned` lo cambia cualquiera de los dos roles |
| `DELETE /admin/users/:id/notes/:noteId` | — | 204; solo el autor o `super_admin` |
`NoteDTO { id, body, pinned, authorId|null, authorName|null, createdAt, updatedAt, edited: boolean, canEdit: boolean }` (`canEdit` lo calcula el servidor; el front no decide permisos).
**Auditoría** (misma transacción; `entityType:'User'`, `entityId:<cliente>`): `user.note.create|update|pin|delete` con `after:{noteId, pinned, bodyLength}`. **Nunca el texto** de la nota en `before/after` ni en logs. Leer notas no se audita (igual que la ficha).
**Seguridad:** las notas solo se exponen por estos 4 endpoints; **prohibidas** en `GET /:id`, `overview`, cualquier ruta de cliente (`/me`, pedidos, bóveda), correos, PDFs, exportaciones/CSV, panel de marketing, `dataLayer`/GA4/Pixel/CAPI y logs. Candado: prueba que recorre los DTO de cliente y falla si aparece `note`/`CustomerNote`; prueba de CI de no-fuga a medición como §4. El front las pinta como texto React (sin `dangerouslySetInnerHTML`) y conserva saltos de línea con CSS (`white-space: pre-wrap`). La búsqueda de M6 no indexa notas.
**Migración:** `CREATE TABLE "CustomerNote"` + índices + FKs, aditiva y sin tocar datos; reversa: `DROP TABLE "CustomerNote"` (pierde solo las notas) y retirar el bloque de la ficha. Módulo no financiero.
**AUTO:** (a) disparo: la nota es texto que escribe el equipo cuando quiere; nada que correr ni asignar. (b) Reintento: POST idempotente por `clientRequestId`; el front reintenta con el mismo id. (c) Dato dudoso: texto fuera de rango ⇒ 400, nunca se corta en silencio. (d) Crece sola: por cliente, sin catálogos.

## 2. Lo que la ficha reutiliza (NO se duplica)
| Dato de la ficha | Fuente existente |
|---|---|
| Cabecera, contacto, cómo entró, verificado, idioma, `phoneRequired`, bloqueo | `GET /admin/users/:id` (cabecera) |
| Celular completo, edición, WhatsApp | §CELULAR: `GET /:id` devuelve `phone`; `PATCH /admin/users/:id/phone` (super); la ficha monta el **mismo componente** que §CELULAR dibuja en M6 |
| Direcciones | `GET /:id` → `addresses` |
| Pedidos (últimos 20) | `GET /:id` → `orders` (`id, orderNumber, status, totalCents, createdAt, settledAt`) |
| Bóveda (lista de piezas y valor por pieza) | `GET /:id` → `ownedItems` (`referenceValue`) |
| Solicitudes de venta (últimas 20) | `GET /:id` → `sellRequests` (`id, status, quotedTotalCents, createdAt`) |
| Disputas (últimas 20) | `GET /:id` → `disputes` |
| KYC (estado, CLABE `****1234`, RFC enmascarado; motivo) | `GET /:id` → `kycProfile`; decisión `PATCH /:id/kyc` (super) |
| Facturación, destinatarios recientes | `GET /:id` (solo super) |
| Actividad | `GET /:id/audit?scope=target` |
| Ligas de INE | `GET /:id/kyc/ine-links` (super, auditado, tope por actor) — **la ficha solo enlaza a `m6/kyc/[userId]`, nunca embebe imagen** |
| Reveal de CLABE | `/admin/buylist/:id/reveal-clabe` y `/admin/manual-refunds/:id/reveal-clabe` (super, auditado) — sin cambio |

**Paginación:** `GET /:id` ya acota a 20 por lista (`admin.service.ts:581-602`); la ficha pinta 5 y «Ver todos (N)» despliega los 20 ya cargados; más allá de 20 (o `totals.X > 20`) el enlace abre el módulo dueño: pedidos/retiros ⇒ M4, solicitudes ⇒ M5, reembolsos ⇒ `/admin/refunds` y `/admin/manual-refunds`, disputas ⇒ módulo de disputas actual. **Medido 2026-11-22 (grep):** ya filtran por `?userId=`: pedidos `admin-orders.controller.ts:54,88` (M4), venta/buylist `admin-buylist.controller.ts:63,87` (M5), envíos `admin-shipments.controller.ts:53,70`, disputas `disputes.controller.ts:72`. **No filtran:** `GET /admin/refunds` (`admin-refunds.controller.ts:57-68`, solo `actorUserId` = quien lo pidió) y `GET /admin/manual-refunds` (`admin-manual-refunds.controller.ts:47`, solo `status|q`). Backend añade `?userId=<uuid>` (lectura, lista blanca, mismo rol, valida uuid; cliente = `Order.userId`/`ShipmentRequest.userId`/dueño de la solicitud de venta) a esas dos listas en F1. Frontend: que `M4View`/`M5View` lean `?userId=` de la URL al abrir (M5 ya usa `?user=` hacia M6; la lectura de `userId` en la URL de M4/M5 es NO MEDIDA en el front).

## 3. Errores
404 `NOT_FOUND` (id o proveedor); 401/403 estándar. Sin códigos nuevos. El front trata un fallo de `overview` como degradación del bloque (la ficha de `GET /:id` se pinta igual).

## 4. Privacidad y medición
Solo `/admin`. Nada del DTO ni de `GET /:id` va a `dataLayer`, GA4, Meta Pixel/CAPI, URL (salvo `?user=<uuid>`), `localStorage` ni logs (celular en logs `******1234`). Enlace WhatsApp `https://wa.me/52<10 dígitos>` armado en el cliente, sin texto precargado. Prueba de CI: ningún `dataLayer.push`/`fbq`/log recibe un objeto con `phone`, `email`, `addresses` o `*Cents` de la ficha. La apertura de la ficha **no se audita** (DECISIONES §FICHA-CLIENTE 4).

## 5. Pantalla (diseño **A** elegido; la variante B se descarta, no se construye; `docs/DESIGN_SYSTEM.md` manda sobre estilos)
Componentes: `CustomerHeader` (nombre, rol/estado, «cliente desde», celular + botón WhatsApp + copiar, correo, entrada Google/correo), `SummaryStrip` (Compras, Ventas, Bóveda, Atención; Compras/Ventas para ambos roles), `NotesPanel` (§1b: fijadas arriba, formulario con contador 0/1000, editar/borrar con confirmación, fijar/desfijar, estados vacío/carga/error con «Reintentar»), `AttentionList`, `ContactCard` (reutiliza el componente de celular de §CELULAR), `AddressList`, `OrdersList`, `ShipmentsList` (con rastreo y botón copiar/abrir `trackingUrl`), `VaultSummary`, `SellRequestsList`, `RefundsDisputesList`, `IdentityCard` (solo estado + CLABE enmascarada; enlace «Revisar identidad» ⇒ `m6/kyc/[userId]`, solo super), `ActivityList`.
- **A — una página:** `CustomerHeader` + `SummaryStrip` fijos arriba; secciones en el orden: Necesita atención · **Notas internas** (junto a «Necesita atención»: en escritorio dos columnas, atención a la izquierda y notas a la derecha; en móvil, notas justo debajo de atención; se muestran las fijadas y las 3 más recientes, «Ver todas (N)» despliega el resto; la nota fijada también aparece como insignia en la cabecera) · Contacto y cuenta · Direcciones · Pedidos · Retiros y envíos · Bóveda · Solicitudes de venta · Reembolsos y disputas · Identidad · Actividad. Índice de anclas en escritorio (barra lateral) y selector «Ir a…» en móvil. 5 filas por lista + «Ver todos (N)».
- Estados vacíos con texto («Sin pedidos todavía»), carga por bloque (esqueletos), error por bloque con «Reintentar». Textos en `es.json` y `en.json`. Acciones rápidas: abrir pedido (M4), abrir solicitud (M5), WhatsApp; en cuenta sin celular válido, el botón se sustituye por «Falta celular válido» (super: «Editar»).

## 6. Reparto
- **backend (una sola entrega):** (1) `GET …/overview` + DTO + proyectores en lista blanca + pruebas: operador y super reciben `lifetime` idéntico, 404 proveedor, sin campos prohibidos (candado de claves), sumas contra datos sembrados (compras, ventas, reembolsos, bóveda con piezas sin precio ⇒ `valueCents:null`/`pricedCount`), `no-store`, cuenta anonimizada, rendimiento (≤ 8 consultas, sin N+1). (2) `?userId=` en `GET /admin/refunds` y `GET /admin/manual-refunds` (§2). (3) `CustomerNote` §1b: migración + reversa, 4 endpoints, auditoría sin texto, límites, borrado del `body` al anonimizar cuenta, pruebas (roles, edición ajena ⇒ 403 para operador, IDOR de nota entre clientes ⇒ 404, idempotencia, 1000/1001 caracteres, nota ausente de `GET /:id`/`overview`/rutas de cliente, auditoría sin `body`). No toca `PATCH /phone` (es de §CELULAR).
- **frontend (una sola entrega):** tipos en `lib/api.ts`, mock/fixtures de `overview` y notas, ficha A (la B no se dibuja), `NotesPanel`, integración con el componente de celular de §CELULAR, enlaces a M4/M5/reembolsos con `?userId=`, pruebas de «el operador ve totales», de escape de texto (nota con `<script>`) y de «no se filtra a medición».
- **qa + seguridad-lead:** gates por PII en admin (IDOR entre roles y entre clientes, ausencia de campos prohibidos, notas fuera de superficies de cliente/medición, `no-store`, XSS en notas, decisión sobre auditar apertura).

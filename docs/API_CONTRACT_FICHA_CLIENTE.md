# API_CONTRACT_FICHA_CLIENTE — ficha completa del cliente en M6 (§FICHA-CLIENTE en `docs/DECISIONES.md`; 2026-11-22)

Convenciones: dinero en centavos enteros MXN (`*Cents`); fechas ISO-8601 UTC; sin schema ni migración en F1; solo lectura. Roles: guard de clase de `AdminUsersController` (`vault_operator` + `super_admin`) y `NotSupplierTargetGuard` (cuenta `supplier` ⇒ 404). Respuesta `Cache-Control: no-store`.

## 1. `GET /api/v1/admin/users/:id/overview`
Rol: `vault_operator` y `super_admin`. Id inexistente o proveedor ⇒ 404. Los campos marcados **S** solo los recibe `super_admin`; para el operador viajan como `null` (no se omiten: clave presente, valor `null`). Implementación: `select`/`groupBy` en lista blanca (R-1), una transacción de solo lectura, sin N+1.

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
    lifetime: null | {                   // **S**
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

**Paginación:** `GET /:id` ya acota a 20 por lista (`admin.service.ts:581-602`); la ficha pinta 5 y «Ver todos (N)» despliega los 20 ya cargados; más allá de 20 (o `totals.X > 20`) el enlace abre el módulo dueño: pedidos/retiros ⇒ M4, solicitudes ⇒ M5, reembolsos ⇒ `/admin/refunds` y `/admin/manual-refunds`, disputas ⇒ módulo de disputas actual. Si el módulo destino no filtra por cliente (NO MEDIDO para M5), backend añade `?userId=<uuid>` (lectura, lista blanca, mismo rol) en F1.

## 3. Errores
404 `NOT_FOUND` (id o proveedor); 401/403 estándar. Sin códigos nuevos. El front trata un fallo de `overview` como degradación del bloque (la ficha de `GET /:id` se pinta igual).

## 4. Privacidad y medición
Solo `/admin`. Nada del DTO ni de `GET /:id` va a `dataLayer`, GA4, Meta Pixel/CAPI, URL (salvo `?user=<uuid>`), `localStorage` ni logs (celular en logs `******1234`). Enlace WhatsApp `https://wa.me/52<10 dígitos>` armado en el cliente, sin texto precargado. Prueba de CI: ningún `dataLayer.push`/`fbq`/log recibe un objeto con `phone`, `email`, `addresses` o `*Cents` de la ficha. La apertura de la ficha **no se audita** (DECISIONES §FICHA-CLIENTE 4).

## 5. Pantallas (frontend dibuja A y B; `docs/DESIGN_SYSTEM.md` manda sobre estilos)
Componentes compartidos (una sola implementación, dos composiciones): `CustomerHeader` (nombre, rol/estado, «cliente desde», celular + botón WhatsApp + copiar, correo, entrada Google/correo), `SummaryStrip` (Compras, Ventas, Bóveda, Atención; Compras/Ventas solo si `summary.lifetime != null`), `AttentionList`, `ContactCard` (reutiliza el componente de celular de §CELULAR), `AddressList`, `OrdersList`, `ShipmentsList` (con rastreo y botón copiar/abrir `trackingUrl`), `VaultSummary`, `SellRequestsList`, `RefundsDisputesList`, `IdentityCard` (solo estado + CLABE enmascarada; enlace «Revisar identidad» ⇒ `m6/kyc/[userId]`, solo super), `ActivityList`.
- **A — una página:** `CustomerHeader` + `SummaryStrip` fijos arriba; secciones en el orden: Necesita atención · Contacto y cuenta · Direcciones · Pedidos · Retiros y envíos · Bóveda · Solicitudes de venta · Reembolsos y disputas · Identidad · Actividad. Índice de anclas en escritorio (barra lateral) y selector «Ir a…» en móvil. 5 filas por lista + «Ver todos (N)».
- **B — pestañas:** mismos `CustomerHeader`/`SummaryStrip`; pestañas Resumen · Pedidos · Bóveda · Retiros · Ventas · Dinero · Identidad y datos · Actividad. Pestaña activa en la URL (`?user=<id>&tab=<clave>`); contador en cada pestaña desde `totals`/`attention`.
- Estados vacíos con texto («Sin pedidos todavía»), carga por bloque (esqueletos), error por bloque con «Reintentar». Textos en `es.json` y `en.json`. Acciones rápidas: abrir pedido (M4), abrir solicitud (M5), WhatsApp; en cuenta sin celular válido, el botón se sustituye por «Falta celular válido» (super: «Editar»).

## 6. Reparto
- **backend (F1):** `GET …/overview` + DTO + proyectores en lista blanca + pruebas: roles (operador ⇒ `lifetime:null`), 404 proveedor, sin campos prohibidos (candado de claves), sumas contra datos sembrados (compras, ventas, reembolsos, bóveda con piezas sin precio ⇒ `valueCents:null`/`pricedCount`), `no-store`, cuenta anonimizada, rendimiento (≤ 8 consultas, sin N+1). Si M4/M5 no filtran por cliente: `?userId=`. No toca `PATCH /phone` (es de §CELULAR).
- **frontend (F1):** tipos en `lib/api.ts`, mock/fixtures de `overview`, componentes compartidos, variantes A y B (ambas renderizadas con datos de ejemplo para que el dueño elija; la elegida se cablea, la otra se descarta), integración con el componente de celular de §CELULAR, enlaces a M4/M5, pruebas de rol (operador no ve totales) y de «no se filtra a medición».
- **qa + seguridad-lead:** gates por PII en admin (IDOR entre roles, ausencia de campos prohibidos, `no-store`, fuga a medición, decisión sobre auditar apertura).
- **F2 (condicional a la pregunta 1 del dueño):** `UserNote` + `POST/GET /admin/users/:id/notes` (ambos roles; cuerpo ≤ 500; solo inserción; auditado; últimas 20; migración aditiva).

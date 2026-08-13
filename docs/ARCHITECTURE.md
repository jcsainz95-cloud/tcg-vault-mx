# ARCHITECTURE.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **arquitecto**. Fuente de verdad de decisiones técnicas y modelo de datos.
> Manda `PROJECT.md` sobre este documento, y este documento sobre el código.
> Estado: v1 (MVP). Fecha: 2026-08-13. Branch: `claude/tcg-cards-marketplace-oijthj`.

## 0. Alcance técnico (MVP vs Fase 2)

**Dentro del MVP:** storefront + ficha con precio de referencia, checkout Stripe (IVA 16% desglosado + fee de procesamiento trasladado), bóveda/portafolio con titularidad `pending→settled`, retiros/envíos nacionales manuales, buylist con cotizador público + pipeline manual, back-office M1–M10, i18n ES/EN, disputas de condición raw.

**Fuera del MVP (diseñar para no cerrarles la puerta):** C2C/consignación, wallet de saldo, order-book, guías/SPEI automáticos, grading propio, app nativa, cobro de custodia, internacional, PriceCharting, plan de pago de pricing.

Puntos donde el diseño deja la puerta abierta a fase 2:
- `InventoryItem.ownerType` (`platform|customer`) permite introducir `consignor` (C2C) sin migración estructural.
- `PricingProvider` es una interfaz; subir a plan de pago = una implementación nueva + un dial en M10.
- El dinero se maneja **por transacción**; NO existe entidad `Wallet`/`Balance`. Introducirla en fase 2 no rompe nada previo.

---

## 1. Stack elegido y justificación

| Capa | Elección | Justificación |
|---|---|---|
| Lenguaje | **TypeScript** (back y front) | Un solo lenguaje, tipos de DTO compartibles entre backend y frontend, reduce fricción del equipo pequeño. |
| Backend | **NestJS** (Node 20 LTS) | Modularidad y DI encajan con módulos M1–M10 y con la interfaz `PricingProvider`; guards nativos para autorización por rol/acción; ecosistema maduro para Stripe, colas y cron. |
| ORM / migraciones | **Prisma** | Esquema declarativo, migraciones versionadas, tipos generados. Ideal para un modelo relacional con muchas FKs. |
| Base de datos | **PostgreSQL 16** | Modelo fuertemente relacional (items, órdenes, precios, auditoría), constraints e índices, `JSONB` para snapshots (CFDI, direcciones) y `AuditLog`. Recomendado en PROJECT. |
| Cache / colas / rate-limit | **Redis + BullMQ** | Jobs diarios (sync de precios, FX), barridos de plazos de buylist/disputas, y **rate-limiting** para respetar el free tier de las APIs (100/día, 250/día). |
| Auth | **JWT** (access corto + refresh), hashing **argon2** | Sin dependencia de proveedor externo para el MVP; roles y KYC viven en `User`. Guards por rol y por acción. |
| Almacenamiento de fotos | **Object storage S3-compatible** (Cloudflare R2 o AWS S3 en prod; **MinIO** en local) vía **URLs prefirmadas** | Las fotos de bóveda/verificación/disputa se suben directo desde el navegador móvil con presigned PUT; la DB guarda solo la key/URL. |
| Frontend | **Next.js 14 (App Router) + React + TypeScript** | Storefront con SEO (server components para catálogo/ficha), y mismo framework para el panel admin responsive. Captura de fotos con `<input type="file" accept="image/*" capture>`. |
| Data fetching (front) | **TanStack Query** | Cache cliente, estados de carga/error consistentes con el contrato. |
| Estilos | **Tailwind CSS** + componentes del **DESIGN_SYSTEM** (propiedad de ux-ui) | La estructura visual/tokens los define ux-ui; el arquitecto no fija el sistema de diseño. |
| i18n | **next-intl** (frontend) | Toda la UI ES/EN, default ES. El backend NO traduce (ver §6). |
| Pagos | **Stripe** (Checkout/PaymentIntents + Webhooks) | Requisito de PROJECT. |
| Jobs/cron | **BullMQ repeatable jobs** (Redis) | Sync diario de precios (solo bóveda), refresco de FX, plazos de buylist/disputa. |

### Monorepo
Un solo repositorio con dos apps: `backend/` y `frontend/`. Sin herramienta de monorepo pesada en el MVP (nada de Nx/Turbo obligatorio); devops decide si añade `pnpm workspaces`. Los tipos del contrato se comparten copiando/generando DTOs en `frontend/src/types` desde `API_CONTRACT.md` (fuente de verdad).

---

## 2. Estructura de carpetas (alto nivel)

> Respeta la propiedad de archivos de `CLAUDE.md`: backend escribe en `backend/`, frontend en `frontend/`, devops en configs/CI. El arquitecto solo describe la estructura.

### backend/ (NestJS)
```
backend/
  src/
    main.ts
    app.module.ts
    common/            # guards (roles, money-out), decorators, filtros de error, interceptores, error-codes
    config/            # carga de env (typed); NO contiene los diales de negocio (esos viven en DB, ver settings)
    modules/
      auth/            # registro, login, refresh, JWT, guards de rol/acción
      users/           # perfil, direcciones (MX), billing/CFDI, KYC (CLABE/INE/límites)  -> M6
      catalog/         # Card/CardSet, ingesta desde pokemontcg.io (datos en inglés)
      pricing/         # PricingProvider (interfaz + impls), PricingService, FxService, cola precio-pendiente -> M2
      inventory/       # InventoryItem, folios, VaultLocation, InventoryMovement -> M1
      orders/          # checkout, breakdown (subtotal/fee/IVA), Order/OrderItem -> M3
      payments/        # cliente Stripe + manejo de webhooks (settled/refund/chargeback)
      vault/           # portafolio del cliente (holdings + valor)  -> C
      shipments/       # retiros/envíos nacionales, picking, guía manual -> M4
      buylist/         # AcquisitionPricer, cotizador público, SellRequest pipeline -> M5/E
      disputes/        # disputas de condición raw, comparador de fotos, recompra -> M8
      admin/           # dashboard (8 tarjetas), finanzas/P&L (M7), reportes (M9)
      settings/        # diales M10 (persistidos en DB, editables sin deploy)
      audit/           # AuditLog global (M10)
      uploads/         # presign de object storage para fotos
    jobs/              # BullMQ: price-sync diario, fx-refresh, buylist-sweep (7d/30d), dispute-deadline
    prisma/            # schema.prisma + migraciones
  test/
```

### frontend/ (Next.js App Router)
```
frontend/
  src/
    app/
      [locale]/                 # es | en (default es)
        (storefront)/           # catálogo, ficha, carrito, checkout, mi-bóveda, retiros, buylist
        (admin)/                # back-office M1–M10 + dashboard (responsive, captura de foto móvil)
        (auth)/                 # login/registro
    components/                 # implementa el DESIGN_SYSTEM (ux-ui define tokens/componentes)
    lib/                        # api client, stripe.js, query client
    i18n/                       # config next-intl + messages/es.json, messages/en.json (copys de UI)
    hooks/
    types/                      # DTOs espejo del API_CONTRACT (fuente de verdad = docs)
  public/
```

Documentos por rol (propiedad en `CLAUDE.md`): `docs/BACKEND_NOTES.md`, `docs/FRONTEND_NOTES.md`, `docs/DEVOPS_NOTES.md`, `docs/DESIGN_SYSTEM.md`, `docs/TECH_DEBT.md`.

---

## 3. Modelo de datos

Convención de dinero: **todos los montos son enteros en centavos (`*Cents`) de MXN**, salvo `PriceReference.priceUsdCents` (origen USD, informativo). No se usa float para dinero. **No existe entidad de saldo/wallet.** Timestamps en UTC.

### 3.1 Diagrama textual de relaciones (resumen)
```
User 1───* Address
User 1───1 KycProfile           (CLABE/INE/límites)
User 1───1 BillingProfile       (CFDI)
User 1───* Order 1───* OrderItem *───1 InventoryItem
User 1───* ShipmentRequest 1───* ShipmentItem *───1 InventoryItem
User 1───* SellRequest 1───* SellRequestItem 0/1─1 InventoryItem  (al convertir)
User 1───* Dispute *───1 InventoryItem

Card 1───* InventoryItem
Card 1───* PriceReference
Card *───1 CardSet

InventoryItem *───1 VaultLocation
InventoryItem 1───* InventoryMovement
InventoryItem ownerType: platform | customer  (ownerUserId cuando customer)

ConfigSetting (diales M10, key/value)     AuditLog (global)     FxRate (diario)
PendingPriceEntry (cola de precio pendiente)
```

### 3.2 Entidades

#### User (+ rol)
- `id` (uuid), `email` (único), `passwordHash`, `role` (`customer | vault_operator | super_admin`), `name`, `phone`, `locale` (`es|en`, default `es`), `status` (`active | blocked`), `createdAt`, `updatedAt`.
- El comprador es siempre `customer`. `vault_operator` y `super_admin` son cuentas de back-office.

#### KycProfile (M6)
- `id`, `userId` (único), `legalName`, `rfc?`, `clabe?` (18 dígitos, a nombre del propio usuario), `ineFrontKey?`, `ineBackKey?`, `kycStatus` (`none | pending | verified | rejected`), `capPerRequestCentsOverride?`, `capPerMonthCentsOverride?` (si null, usa diales de M10), `verifiedBy?`, `verifiedAt?`.
- Regla de negocio: pago SPEI solo a una `clabe` **a nombre del propio usuario**; INE requerido cuando la cotización/acumulado supera el tope configurado.

#### BillingProfile (CFDI)
- `id`, `userId` (único), `rfc`, `razonSocial`, `regimenFiscal`, `usoCfdi`, `postalCode`, `email`. Se toma **snapshot** dentro de `Order` al pagar.

#### Address
- `id`, `userId`, `line1`, `line2?`, `neighborhood?`, `city`, `state`, `postalCode`, `country` (**fijo `MX`; se rechaza cualquier otro**), `phone`, `isDefault`. Usado en retiros; snapshot en `ShipmentRequest`.

#### CardSet (catálogo, datos en inglés)
- `id`, `externalId` (pokemontcg.io), `name` (EN), `series?`, `releaseDate?`, `printedTotal?`, `ptcgoCode?`.

#### Card (catálogo, datos en inglés, no se traduce)
- `id`, `externalId` (pokemontcg.io id), `setId` (FK CardSet), `name` (EN), `number`, `rarity`, `supertype`, `subtypes` (JSONB), `imageSmallUrl`, `imageLargeUrl`, `tcgplayerId?`, `createdAt`.
- Índices: `(setId)`, `(name)`, `(rarity)`, `externalId` único.

#### VaultLocation (M1 — ubicación jerárquica CAJA/FILA/SLOT)
- `id`, `zone` (`platform_stock | customer_custody` — **separación física de custodia de clientes**), `box` (CAJA), `row` (FILA), `slot` (SLOT), `label` (derivado, ej. `C03-F02-S15`), `isActive`.
- Unicidad: `(zone, box, row, slot)`.

#### InventoryItem (instancia física — pieza única)
Núcleo del sistema. Una fila = una carta/producto físico.
- `id`, `folio` (**legible, único, `INV-000123`**, ver §5), `cardId` (FK), `productType` (`graded | sealed | raw`).
- Condición/grado (según tipo):
  - raw → `rawCondition` (`NM | LP | MP | HP | DMG`, estándar propio).
  - graded → `gradingCompany` (`PSA | CGC`), `gradeValue` (ej. `10`, `9.5`).
  - sealed → sin condición/grado.
- Fotos: `frontPhotoKey`, `backPhotoKey`, `extraPhotoKeys` (JSONB). Para raw, las fotos de **ingreso** son la evidencia canónica de disputas (§ disputas).
- Ubicación: `locationId` (FK VaultLocation).
- Propiedad y titularidad:
  - `ownerType` (`platform | customer`), `ownerUserId?` (cuando `customer`).
  - `ownershipStatus?` (`pending | settled`, solo cuando `ownerType=customer`; ver §3.3).
- Estado operativo: `status` (`in_stock | listed | reserved | in_custody | picking | shipped | delivered | lost | damaged | withdrawn`).
- Precio de venta: `listPriceCents?` (MXN sin IVA; si null y sin `PriceReference` → **"precio pendiente"**, no vendible).
- Costo y adquisición: `acquisitionType` (`aportacion_en_especie | buylist | compra`), `acquisitionCostCents`, `acquisitionPct?` (ej. 70 para aportación en especie), `sourceSellRequestItemId?`.
- `createdAt`, `updatedAt`.
- Índices: `folio` único, `(cardId)`, `(status)`, `(ownerUserId)`, `(locationId)`.

#### InventoryMovement (M1 — historial)
- `id`, `itemId`, `fromLocationId?`, `toLocationId?`, `fromStatus?`, `toStatus?`, `reason` (`alta | move | sale | settle | chargeback_return | withdrawal | lost | damaged | buylist_convert`), `actorUserId`, `note?`, `createdAt`.

#### PriceReference (M2 — precio por carta/tipo/fecha/fuente/FX)
- `id`, `cardId`, `productType`, `gradeKey` (string normalizada: `raw:NM`, `graded:PSA:10`, `sealed`), `source` (`pokemontcg_io | pokemonpricetracker | poketrace | manual`), `priceUsdCents?`, `fxRate?` (decimal), `fxBufferPct?`, `priceMxnCents`, `capturedDate` (date), `isManualOverride` (bool), `createdAt`.
- Unicidad: `(cardId, productType, gradeKey, capturedDate)`. **Cache diario** = una fila por día por combinación.
- **Precio pendiente** = no hay fila vigente con `priceMxnCents` y no hay override → genera `PendingPriceEntry`.

#### PendingPriceEntry (cola de precio pendiente — escalado al dueño)
- `id`, `cardId`, `productType`, `gradeKey`, `context` (`catalog | portfolio | buylist | inventory`), `refId?` (item/sellRequestItem que lo originó), `status` (`open | resolved`), `resolvedPriceRefId?`, `createdAt`, `resolvedAt?`.
- Regla transversal: una carta sin precio **nunca se descarta**; entra aquí y se escala al súper-admin.

#### FxRate (M2/M10 — USD→MXN con colchón)
- `id`, `base` (`USD`), `quote` (`MXN`), `rate` (decimal), `bufferPct` (dial M10), `effectiveDate` (date), `source` (`manual | banxico` — ver Preguntas), `createdAt`.
- El precio MXN mostrado = `priceUsd × rate × (1 + bufferPct/100)`.

#### Order (M3 — venta de cartas)
- `id`, `userId`, `status` (`pending | settled | failed | refunded | chargeback`).
- Desglose (todo en centavos MXN): `subtotalCents` (suma de líneas sin IVA), `processingFeeCents` (**fee de Stripe trasladado al comprador**, línea visible), `ivaCents` (**16% desglosado**), `totalCents` (= subtotal + fee + IVA).
- `ivaRatePct` (snapshot del dial, default 16), `stripePaymentIntentId?`, `stripeChargeId?`, `billingSnapshot` (JSONB, datos CFDI al momento), `cfdiStatus` (`registrado | emitido | no_aplica` — MVP registra, no timbra; ver Preguntas), `createdAt`, `settledAt?`, `refundedAt?`.
- Índices: `(userId)`, `(status)`, `stripePaymentIntentId` único.

#### OrderItem
- `id`, `orderId`, `inventoryItemId`, `cardSnapshot` (JSONB: nombre/set/número/tipo/condición-grado), `unitPriceCents` (sin IVA, congelado al checkout).

#### ShipmentRequest (M4 — retiro/envío nacional)
- `id`, `userId`, `addressSnapshot` (JSONB, MX), `status` (`solicitado | picking | guia | enviado | entregado | cancelado`).
- Cobro: `shippingFeeCents` (dial M10, default 17500), `stripePaymentIntentId?` (el envío se cobra al comprador **antes** de generar la solicitud).
- Logística manual: `carrier?`, `trackingNumber?`, `requestedAt`, `pickingAt?`, `shippedAt?`, `deliveredAt?`.
- Restricción: solo se incluyen items `settled` (ver validación en §3.3).

#### ShipmentItem
- `id`, `shipmentRequestId`, `inventoryItemId`.

#### SellRequest (M5/E — buylist)
- `id`, `userId`, `status` (`cotizada | recibida | verificacion | aprobada | pagada | rechazada | abandonada`).
- Totales: `quotedTotalCents`, `approvedTotalCents?`.
- KYC/pago: `clabeSnapshot`, `ineRequired` (bool), `ineProvided` (bool), `speiReference?`, `paidBy?` (**solo súper-admin**), `paidAt?`.
- Plazos: `createdAt`, `receivedAt?`, `verifiedAt?`, `approvedAt?`, `adjustmentSentAt?` (para plazo 7d de rechazo), `deadlineAt?` (30d → inventario).
- Regla: **pago SPEI tras recepción y verificación**, decidido carta por carta (cherry-pick).

#### SellRequestItem
- `id`, `sellRequestId`, `cardId`, `productType`, `rawCondition?`, `category` (`comun | reverse_holo | ex_plus`), `quotedPriceCents?` (null si precio pendiente), `approvedPriceCents?`, `itemStatus` (`cotizada | precio_pendiente | recibida | verificacion | aprobada | ajustada | rechazada | pagada | convertida_inventario`), `inventoryItemId?` (al convertir), `photoKeys?` (JSONB).

#### Dispute (M8 — condición raw)
- `id`, `userId`, `inventoryItemId` (o vía `orderItemId`), `type` (`condition_raw`), `status` (`abierta | en_revision | resuelta_recompra | rechazada`).
- Evidencia: `ingressPhotoKeys` (referencia a fotos de ingreso del item), `claimPhotoKeys` (JSONB del cliente), `description`.
- Remedio: `resolution?`, `repurchaseOrderId?` (recompra al precio pagado), `deadlineAt` (**7 días desde entrega**), `createdAt`, `resolvedAt?`, `resolvedBy?`.

#### ConfigSetting (M10 — diales editables sin deploy)
- `key` (PK, ej. `shipping_fee_cents`, `aportacion_pct`, `iva_pct`, `buylist_cap_per_request_cents`, `buylist_cap_per_month_cents`, `ine_threshold_cents`, `repo_cap_per_card_cents`, `fx_buffer_pct`, `pricing_provider_raw`, `pricing_provider_graded`, `pricing_provider_sealed`), `valueJson` (JSONB, tipado por key), `updatedBy`, `updatedAt`.
- Defaults iniciales: envío 17500, aportación 70, IVA 16, tope solicitud 300000, tope mes 1000000, INE = tope solicitud, colchón FX configurable, providers según tabla de PROJECT.

#### AuditLog (M10 — bitácora global)
- `id`, `actorUserId`, `actorRole`, `action` (string, ej. `order.refund`, `sellrequest.pay_spei`, `settings.update`, `inventory.mark_damaged`), `entityType`, `entityId`, `before?` (JSONB), `after?` (JSONB), `ip?`, `createdAt`.
- **Toda acción de back-office se registra**, en especial los intentos bloqueados de dinero saliente por operador (queda registrado y bloqueado).

### 3.3 Ciclo de titularidad `pending → settled` (regla transversal)

```
Compra Stripe (PaymentIntent creado)
  → OrderItem.inventoryItem: ownerType=customer, ownerUserId=comprador,
    ownershipStatus=pending, status=in_custody     (Order.status=pending)

webhook payment_intent.succeeded
  → ownershipStatus=settled                         (Order.status=settled, settledAt)

webhook charge.dispute.created (contracargo)
  → item revierte a inventario de plataforma:
    ownerType=platform, ownerUserId=null, ownershipStatus=null,
    status=listed (o in_stock)                       (Order.status=chargeback)
    movimiento reason=chargeback_return

Retiro
  → solo items con ownershipStatus=settled pueden entrar a ShipmentItem.
    Un item pending es rechazado por la validación de creación de ShipmentRequest.
```

Separación física: los items en `ownerType=customer` viven en `VaultLocation.zone=customer_custody`; el stock de la plataforma en `zone=platform_stock`. El movimiento entre zonas queda en `InventoryMovement`.

---

## 4. Módulos y límites

### 4.1 PricingProvider (intercambiable)
Interfaz (pseudocódigo, en `modules/pricing`):
```ts
interface PricingProvider {
  readonly source: PriceSource;               // pokemontcg_io | pokemonpricetracker | poketrace | manual
  supports(productType: ProductType): boolean;
  // Devuelve precio USD (o MXN si la fuente ya da MXN) o null si la fuente no tiene precio.
  fetchPrice(input: { card: Card; productType: ProductType; gradeKey: string }): Promise<PriceQuote | null>;
}
```
Implementaciones MVP:
- `PokemonTcgIoProvider` → raw/singles (TCGPlayer "Market Price" vía pokemontcg.io).
- `PokemonPriceTrackerProvider` / `PokeTraceProvider` → graded y sealed (free tier).
- `ManualOverrideProvider` → override del admin (siempre disponible como respaldo).

`PricingService` orquesta:
1. Elige provider según `productType` leyendo el dial de M10 (`pricing_provider_*`).
2. **Solo pricea cartas en bóveda** (no el catálogo completo) y con **cache diario** (revisa `PriceReference` del día antes de llamar la API).
3. Aplica **FX + colchón** (`FxService`) para obtener `priceMxnCents`.
4. Si el provider devuelve `null` y no hay override → crea `PendingPriceEntry` y expone el estado **"precio pendiente"** (no vendible; escalado al dueño).
5. Respeta rate-limit del free tier vía cola BullMQ.

### 4.2 AcquisitionPricer (buylist)
Función pura (pseudocódigo):
```ts
function quoteAcquisition(category: BuylistCategory, referenceMxnCents: number|null): {
  quotedPriceCents: number|null; status: 'cotizada'|'precio_pendiente';
} {
  switch (category) {
    case 'comun':        return { quotedPriceCents: 50,  status: 'cotizada' };     // MX$0.50
    case 'reverse_holo': return { quotedPriceCents: 150, status: 'cotizada' };     // MX$1.50
    case 'ex_plus':      return referenceMxnCents == null
                           ? { quotedPriceCents: null, status: 'precio_pendiente' }
                           : { quotedPriceCents: Math.round(referenceMxnCents * 0.40), status: 'cotizada' };
  }
}
```
La categoría (`comun|reverse_holo|ex_plus`) se deriva de la rareza vía la **tabla rareza→categoría** (dial M2/M10). EX+ sin precio de referencia → cola de precio pendiente.

### 4.3 Integración Stripe (payments)
- Checkout crea `PaymentIntent` (o Checkout Session) con líneas: subtotal, **fee de procesamiento trasladado**, **IVA 16%**. El total cobrado incluye ambas.
- Webhooks (endpoint único, firma verificada con `STRIPE_WEBHOOK_SECRET`):
  - `payment_intent.succeeded` → `Order.status=settled`, `ownershipStatus=settled`.
  - `charge.refunded` → `Order.status=refunded` (reembolso lo dispara súper-admin desde M3).
  - `charge.dispute.created` → `Order.status=chargeback` + reversión del item al inventario.
- Idempotencia por `event.id` (tabla/So set en Redis) para no reprocesar.
- El **fee trasladado** se calcula con gross-up para que la plataforma reciba neto ≈ subtotal+IVA (fórmula exacta: ver Preguntas para el humano).

### 4.4 Back-office M1–M10
Mapa módulo→endpoint en `API_CONTRACT.md §admin`. Autorización por rol/acción (§7).

### 4.5 i18n
Ver §6. El backend expone **enums y `errorCode`s**, no textos traducidos.

### 4.6 Generación de folios y ubicaciones
- Folio: secuencia Postgres `inventory_folio_seq` → formato `INV-` + zero-pad 6 (`INV-000123`). Se asigna al crear el `InventoryItem` en transacción para evitar colisiones.
- Ubicación: `VaultLocation` con `(zone, box, row, slot)` único; `label` derivado para picking legible.

---

## 5. Decisiones transversales

- **Dinero sin balance:** no hay wallet ni saldo; cada movimiento de dinero es una transacción Stripe (ventas/reembolsos) o un pago SPEI manual (buylist). Ninguna vista de usuario muestra saldo.
- **Montos:** enteros en centavos MXN; IVA siempre desglosado y persistido en `Order.ivaCents` para M7/CFDI.
- **Seguridad/roles:** 3 roles. Autorización por **acción**, no solo por ruta (§7). Guard `MoneyOutGuard` exige `super_admin` para pagos SPEI y reembolsos; todo intento (permitido o bloqueado) se audita.
- **Fotos:** subida directa a object storage con **presigned URLs**; la DB guarda solo keys. Captura móvil vía navegador (`capture`). Las fotos de ingreso raw son evidencia canónica de disputas.
- **Sync de precios/FX (jobs BullMQ):**
  - `price-sync` diario: recorre solo cartas **en bóveda**, respeta rate-limit del free tier, escribe `PriceReference` del día, genera `PendingPriceEntry` para faltantes.
  - `fx-refresh` diario: actualiza `FxRate` (fuente por confirmar; ver Preguntas) + aplica colchón.
  - `buylist-sweep`: 7 días sin respuesta a ajuste → `rechazada`; 30 días de abandono → `convertida a inventario`.
  - `dispute-deadline`: cierra ventana de recompra a 7 días desde entrega.
- **Validaciones duras:** dirección de envío/retiro **debe ser MX** (rechazo si no); retiro solo sobre `settled`; carta "precio pendiente" **no comprable**; topes de buylist (por solicitud/mes) e INE sobre tope.

---

## 6. i18n (convención)

- **UI 100% bilingüe ES/EN, default ES**, toggle a EN. Los copys viven en `frontend/src/i18n/messages/{es,en}.json` (propiedad de frontend/ux-ui).
- **El contrato de datos NO se traduce.** El backend responde con:
  - **enums** estables (ej. `status: "settled"`), que el frontend mapea a texto localizado.
  - **`errorCode`** por error (ej. `PRICE_PENDING`, `ITEM_NOT_SETTLED`, `ADDRESS_NOT_MX`, `BUYLIST_LIMIT_EXCEEDED`), que el frontend traduce.
  - **datos de catálogo en inglés** (nombres/sets de pokemontcg.io) — se muestran tal cual por diseño, en ambos idiomas de UI.
- `User.locale` guarda la preferencia; el frontend también respeta el toggle de sesión.

---

## 7. Seguridad, roles y autorización por acción

| Acción | customer | vault_operator | super_admin |
|---|---|---|---|
| Storefront/compra/bóveda/retiro/buylist (como cliente) | ✅ | — | — |
| M1 Inventario (alta, mover, fotos, pérdida/daño) | — | ✅ | ✅ |
| M2 Precios (sync, override, FX, tabla rareza) | — | — | ✅ |
| M3 Órdenes ver | — | ✅ (solo lectura) | ✅ |
| **M3 Reembolso (dinero saliente)** | — | ❌ (bloqueado + auditado) | ✅ |
| M4 Retiros/envíos (picking, guía, estados) | — | ✅ | ✅ |
| M5 Buylist hasta **verificación** (recibir, verificar, decidir/ajustar) | — | ✅ | ✅ |
| **M5 Pago SPEI (dinero saliente)** | — | ❌ (bloqueado + auditado) | ✅ |
| M6 Usuarios/KYC | — | ver limitado | ✅ |
| M7 Finanzas/P&L | — | ❌ | ✅ |
| M8 Disputas (revisión) | — | ✅ | ✅ |
| **M8 Recompra (dinero saliente)** | — | ❌ | ✅ |
| M9 Reportes | — | ❌ | ✅ |
| M10 Config/diales | — | ❌ | ✅ |
| M10 Bitácora (lectura) | — | ❌ | ✅ |

Regla de oro: **el dinero que sale solo lo toca el súper-admin**; todo queda en bitácora.

---

## 8. Riesgos técnicos y notas para devops

Variables de entorno necesarias (sin valores; devops las gestiona):
- `DATABASE_URL`, `REDIS_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `POKEMONTCG_IO_API_KEY`, `POKEMONPRICETRACKER_API_KEY`, `POKETRACE_API_KEY`
- Object storage: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`
- FX (si se automatiza): `FX_SOURCE`, `FX_API_KEY?` (o modo manual vía dial)
- `APP_BASE_URL`, `DEFAULT_LOCALE=es`

Riesgos técnicos:
- **Rate-limit free tier** (100/día, 250/día): mitigado priciando solo bóveda + cache diario + cola; si crece la bóveda, puede requerir plan de pago (dial permite el cambio).
- **Idempotencia de webhooks** Stripe: obligatoria para no duplicar `settled`/reversos.
- **Consistencia de titularidad**: transiciones `pending→settled` y reversión por contracargo deben ser transaccionales con `InventoryMovement`.
- **CFDI/PAC**: el MVP **registra** datos e IVA cobrado; el timbrado real (PAC) queda como integración posterior (bandera fiscal de PROJECT). Confirmar (Preguntas).
- **Concurrencia de venta**: un `InventoryItem` es pieza única; el checkout debe **reservar** (`status=reserved`) para evitar doble compra.

---

## 9. Desviaciones detectadas
Ninguna. Proyecto greenfield: aún no existe código en `backend/` ni `frontend/`. Esta sección se actualizará si el código futuro contradice esta arquitectura.

---

## 10. Preguntas para el humano / product-owner
Ambigüedades reales no resueltas por `PROJECT.md` (no se asumen; se documentan). Ninguna bloquea que backend/frontend arranquen las áreas no afectadas.

1. **Fórmula del fee de procesamiento trasladado.** PROJECT exige una línea visible de "costo de procesamiento trasladado al comprador", pero no fija la fórmula. ¿Gross-up para que la plataforma reciba neto exacto (subtotal+IVA), usando la tarifa Stripe MX (~3.6% + $3 MXN)? ¿Se redondea? Propuesta por defecto: gross-up sobre (subtotal+IVA) con la tarifa vigente de Stripe MX, redondeo al centavo.
2. **IVA sobre envío y sobre el fee.** ¿El IVA 16% aplica solo al subtotal de cartas, o también a la tarifa de envío (MX$175) y a la línea de fee? Propuesta por defecto: IVA aplica al subtotal de cartas y a la tarifa de envío (servicios gravados); el fee de procesamiento se traslada tal cual. Confirmar con contador.
3. **Precio de venta de la carta.** ¿El precio de venta al cliente es exactamente el precio de referencia MXN del día (sin margen adicional), siendo el margen el spread de compra 40/70%? Propuesta por defecto: `listPrice = referencia MXN del día`. Confirmar si habrá markup.
4. **CFDI en el MVP.** ¿Se integra un PAC para timbrar en el MVP, o solo se **registran** datos + IVA cobrado (timbrado manual/posterior)? Propuesta por defecto: solo registrar (sin PAC) en MVP.
5. **Fuente del tipo de cambio USD→MXN.** El colchón es un dial, pero no se define de dónde sale el `rate` base. ¿Dial manual del admin, o fetch automático (ej. Banxico/API)? Propuesta por defecto: dial manual en M10, con opción futura de automatizar.
6. **Cobro de la tarifa de envío.** Se asume que el envío se cobra por Stripe (mismo mecanismo que la compra) antes de generar la solicitud. Confirmar que no hay otra vía (no hay wallet).
```

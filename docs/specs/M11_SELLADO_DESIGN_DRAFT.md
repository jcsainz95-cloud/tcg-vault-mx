# M11 · Sellado — Diseño de arquitectura (BORRADOR para aprobación del dueño)

- **Rama:** `claude/arch-m11-sellado`, basada en `origin/production` (`187b1d40`).
- **Redactado por:** arquitecto, 2026-09-17.
- **Naturaleza:** BORRADOR de DISEÑO. No es código de producción. Define pantalla, rutas,
  permisos por sección, deltas de contrato y plan de migración. No toca `backend/` ni `frontend/`.
- **Base medida:** todo `fichero:línea` de este documento se **leyó sobre el árbol de
  `origin/production` (`187b1d40`)** el 2026-09-17 por el arquitecto, salvo donde diga
  **[insumo, no re-medido]** (medido por el agente investigador sobre el mismo árbol) o **NO MEDIDO**.
- **Insumos:** `docs/specs/M_SELLADO_SCOPE_DRAFT.md` (product-owner, rama `claude/po-m-sellado-draft`)
  y `docs/specs/SELLADO_M1_FINDINGS_DRAFT.md` (investigador, rama `claude/investiga-sellado-m1`).
  Este documento construye encima; donde re-medí y algo no cuadró, **gana lo que medí** y lo digo (§8).

---

## 0. Decisiones del dueño sobre las que diseño (dadas, no abiertas)

- **(D-1)** Ruta/número: **`M11` / `/admin/m11`** (primer número libre; `m1`–`m10` ocupados,
  medido en `frontend/src/components/layout/AdminSidebar.tsx:18-49`).
- **(D-2)** Los **6 diales de sellado se EDITAN en M11**, y M11 es la **ÚNICA** superficie de
  edición: se **retiran** los editores de M2 y M10 (confirmado por el dueño 2026-09-17). Ver §4.
- **(D-3)** El interruptor maestro **`sealed_price_source`** (hoy sin UI) gana su control en M11,
  con aviso/confirmación por ser acto de dinero global. Ver §1.iv y §3.
- **(D-4)** Permisos por sección: **`vault_operator+`** da de alta/publica (secciones i, ii, iii);
  **`super_admin`** edita los diales (sección iv). Ver §1 y §2.
- **(D-5)** M11 **convive** con la pestaña Sellado de M1 por ahora (no la sustituye).
- **(D-6)** Alcance **completo**.

---

## 1. Estructura de la pantalla — 4 secciones, qué reusa cada una

`/admin/m11` es una vista `(admin)` con un **layout de 4 secciones**. Regla de oro del diseño:
**M11 reubica y expone superficie ya existente; no reimplementa ninguna lógica de dinero.** Cada
sección declara **qué componente reusa** y **qué endpoint consume**, con `fichero:línea` medido.

### Sección (i) — Alta de sellado · `vault_operator+`
- **Qué:** dar de alta producto sellado (compra o aportación), con formato/subtipo y precio.
- **Reusa (componentes):** `SealedAddFlow` y `QuickAdd` **tal cual** (viven hoy en M1,
  `frontend/src/app/[locale]/(admin)/admin/m1/`). El CTA deshabilitado ya explica que falta el
  precio de compra (`QuickAdd.tsx:108,351`, arreglo del insumo; radio «Aportación» se bloquea sin
  mercado en `QuickAdd.tsx:100,319`, medido).
- **Reusa (endpoint):** `POST /api/v1/admin/inventory/items/batch` — `vault_operator+`
  (`backend/src/modules/inventory/inventory.controller.ts:274`, clase `@Roles(vault_operator,
  super_admin)` en `:84`; contrato §M1 `API_CONTRACT.md:10430`).
- **Nuevo:** sólo **ubicación/visibilidad** — «Agregar producto sellado» es el CTA primario de M11.
  Sin lógica nueva.

### Sección (ii) — Inventario de sellado / ventana de publicación · `vault_operator+`
- **Qué:** listado del sellado en stock; por pieza: editar precio, publicar, despublicar, ver
  formato/subtipo.
- **Reusa (componentes):** `SealedTab` (agrupa por `sealedSubtype`, `SealedTab.tsx:285,323`) y
  `VariantDrawer` con `productType:'sealed'` (`VariantDrawer.tsx:56,84,172` — ya ramifica por tipo
  de producto; publicar/despublicar/editar cableados según insumo `VariantDrawer.tsx:419-431,555-604`
  **[insumo, no re-medido línea por línea; sí confirmé el ramaje `productType` y la agrupación por
  subtipo]**).
- **Reusa (endpoint):** `PATCH /api/v1/admin/inventory/items/:id` — `vault_operator+`
  (`inventory.controller.ts:549`; contrato §M1 `API_CONTRACT.md:10286`). Acepta hoy
  `listPriceCents`, `status` (publicar/despublicar), `sealedSubtype`, ubicación.
- **Nuevo:** **rótulo/affordance** — que la acción se lea como «editar/publicar/despublicar», no
  como «Ver piezas» (hallazgo (B)/(E) del insumo). Sin lógica de dinero nueva.

### Sección (iii) — Cola «Listas para publicar», filtrada a sellado · `vault_operator+`
- **Qué:** cola de piezas de sellado listas para publicar, con su motivo (`missing:['price']`, etc.).
- **Reusa (componente):** `PendingPublishQueue` — ya ramifica y pinta sellado
  (`PendingPublishQueue.tsx:67,70` `row.productType === 'sealed'` → `sealedProductName` + «SELLADO»,
  medido).
- **Reusa (endpoint):** `GET /api/v1/admin/inventory/pending-publish` — `vault_operator+`
  (contrato §M1 `API_CONTRACT.md:10315`). Ya acepta filtro `?productType=` (`inventory.controller.ts`
  region `:507-513`, referida en `API_CONTRACT.md:10281`).
- **Nuevo:** filtro/vista de sellado dentro de M11. **Mostrar `sealedSubtype` en la fila requiere
  delta de contrato + proyección backend (regla 9)** — ver §2.C. Es el único punto de esta sección
  que toca contrato.

### Sección (iv) — Panel de diales de pricing del sellado · `super_admin` (dentro de la misma pantalla)
- **Qué:** los **6 diales** del censo del PO, **editables aquí y sólo aquí** (D-2).
- **Reusa (componentes):** el editor de spreads `SealedSpreadsSection`
  (`frontend/src/app/[locale]/(admin)/admin/m2/sections/SealedSpreadsSection.tsx`) se **mueve** a M11;
  el patrón de fila de dial de `M10View` (`M10View.tsx:83-104`, `DialSpec[]`) se reusa para los
  diales de settings. La guarda de rol es el componente existente
  `SuperAdminOnly` (`frontend/src/components/domain/SuperAdminOnly.tsx:14`, `useRole().isSuperAdmin`).
- **Reusa (endpoints), sin inventar ninguno:**
  - `PUT /api/v1/admin/settings` (body parcial de keys camelCase) para 4 diales:
    `sealedPriceSource`, `pricingProviderSealed`, `sealedValueTrend`, `sealedRestockAlerts`
    (`SettingsController` `@Roles(super_admin)` `settings.controller.ts:19`, `@Put('settings')` `:32`;
    contrato §M10 `API_CONTRACT.md:18987`). El maestro **ya está en el DTO map**
    (`settings.constants.ts:1084` `sealedPriceSource → SEALED_PRICE_SOURCE`) — sólo le falta UI.
  - `GET/PUT /api/v1/admin/pricing/sealed-spreads` (`super_admin`) para los 2 spreads
    (`pricing.controller.ts:775,797`, clase `@Roles(super_admin)` `:196`; contrato §M2
    `API_CONTRACT.md:13885-13892`).
- **Los 6 diales (censo re-medido en `settings.constants.ts`):**

  | Dial (clave BD / camelCase) | Endpoint de edición | Rol | Seed | Ubicación HOY (a retirar, §4) |
  |---|---|---|---|---|
  | `sealed_price_source` / `sealedPriceSource` | `PUT /admin/settings` | super_admin | `off` (`:349`, fail-closed) | **sin UI** (sólo `curl`) |
  | `pricing_provider_sealed` / `pricingProviderSealed` | `PUT /admin/settings` | super_admin | `pokemonpricetracker` (`:319`) | M10 (`M10View.tsx:96`) |
  | `sealed_value_trend` / `sealedValueTrend` | `PUT /admin/settings` | super_admin | `off` (`:386`) | sin UI (en DTO map `:1087`) |
  | `sealed_restock_alerts` / `sealedRestockAlerts` | `PUT /admin/settings` | super_admin | `off` (`:387`) | sin UI (en DTO map `:1088`) |
  | `sealed_spread_pct_by_subtype` | `PUT /admin/pricing/sealed-spreads` | super_admin | box18/etb22/bundle25/tin30/blister35/upc18/collection22 (`:374`) | M2 (`SealedSpreadsSection.tsx`) |
  | `sealed_spread_fallback_pct` | `PUT /admin/pricing/sealed-spreads` | super_admin | `25` (`:383`) | M2 (`SealedSpreadsSection.tsx`) |

- **Nuevo:** (a) dar UI al maestro `sealed_price_source` con **confirmación money-global** (§3);
  (b) reunir los 6 editores en un solo panel super-admin.

### Guarda de permisos de la pantalla (D-4) — patrón medido
`page.tsx` de M11 **NO** envuelve toda la vista en `SuperAdminOnly` (a diferencia de M10,
`m10/page.tsx` que sí lo hace, medido). En su lugar:
- La **ruta** es `vault_operator+` (como M1 `m1/page.tsx`, sin wrapper — el nav-item de M11 en
  `AdminSidebar` va **sin** `superAdminOnly`, contrario a M2/M10 que lo llevan en `:30,49`).
- La **sección (iv)** se envuelve **dentro** de `M11View` en `<SuperAdminOnly>` — el operador ve
  (i)/(ii)/(iii) y en su lugar (iv) muestra el `EmptyState` con candado. Defensa en profundidad:
  el backend **ya rechaza** por rol (403), así que el gate de UI es sólo navegación
  (docstring de `SuperAdminOnly.tsx:9-13`).

---

## 2. Deltas de contrato (`docs/API_CONTRACT.md`) y de `ARCHITECTURE.md` — borrador

> Estas son **propuestas de arquitecto**; backend las implementa tras aprobación. Toda edición del
> contrato es zona compartida (regla 9). El principio rector: **el alcance completo se puede lograr
> con UN solo delta de contrato aditivo** (el `sealedSubtype` de la cola); todo lo demás es
> **reubicación de frontend** que no toca ni endpoints ni DTOs.

### 2.A · Nueva sección `§M11` en `API_CONTRACT.md` (documental, no añade endpoints)
Añadir `### M11 — Sellado (pantalla consolidada)` que **documenta la composición**, no crea rutas de
API. Debe dejar escrito, normativo:
- **Ruta de UI:** `/admin/m11`, `vault_operator+` a nivel de ruta; sección de diales `super_admin`.
- **Reúso explícito de endpoints existentes** (cero endpoints nuevos): §M1 (`items/batch`,
  `items/:id`, `pending-publish`), §M10 (`PUT /admin/settings` con `sealedPriceSource`,
  `pricingProviderSealed`, `sealedValueTrend`, `sealedRestockAlerts`), §M2
  (`GET/PUT /admin/pricing/sealed-spreads`).
- **Traslado de superficie de edición** de los 6 diales a M11 (ver §4): nota cruzada en §M2 (spreads)
  y §M10 (diales de settings) diciendo que **el EDITOR se muda a §M11** y que M2/M10 dejan de
  dibujarlos. **Ningún cambio de endpoint, DTO, validador ni auditoría** acompaña este traslado.

### 2.B · Control del maestro `sealed_price_source` (sin delta de endpoint)
- **No hay delta de contrato**: el maestro **ya viaja** en `GET /admin/settings` y **ya se acepta**
  en `PUT /admin/settings` (DTO map `settings.constants.ts:1084`; enum `SealedPriceSource = tcgcsv |
  off`, `API_CONTRACT.md:5814`, validado contra el enum → `422 VALIDATION_ERROR`). El único trabajo
  es **frontend** (dibujar el control) + **copy** de confirmación (§3).
- **Delta a `ARCHITECTURE.md` (documental):** anotar en §4.19e/§4.23a que la **superficie de mando**
  del dial es M11 (antes: «sin UI, sólo runbook/curl»). No cambia el mecanismo.

### 2.C · `sealedSubtype` en `PendingPublishRowDTO` (ÚNICO delta de contrato real — regla 9)
- **Medido:** `PendingPublishRowDTO` (`frontend/src/types/contract.ts:2741-2766`) lleva hoy
  `productType`, `sealedProductName?`, `listPriceCents`, `resolvedSalePriceCents`, `priceBasis`,
  `missing`… **pero NO `sealedSubtype`** (confirmado; el hallazgo (C) del insumo es correcto).
- **Delta propuesto (ADITIVO):** añadir a `PendingPublishRowDTO`
  ```ts
  /** v1.xx (M11, §M1) — presentación del sellado, presente SOLO cuando productType==='sealed'
   *  (ausente en raw/graded). RESUELTA server-side desde InventoryItem.sealedSubtype.
   *  Mismo patrón opcional que sealedProductName. */
  sealedSubtype?: SealedSubtype;
  ```
- **Proyección backend:** el builder de `GET /admin/inventory/pending-publish` selecciona
  `sealedSubtype` de `InventoryItem` y lo proyecta en la fila **solo** para `productType==='sealed'`.
- **Contrato §M1:** documentar el campo bajo `pending-publish` (junto a `sealedProductName`,
  `API_CONTRACT.md` ~`:10315` y la tabla de proveniencia ~`:5161`).
- **Enum:** `SealedSubtype` ya existe (§Enums, `API_CONTRACT.md:5658` region; espejo de
  `schema.prisma`). No se añade enum nuevo.
- **Aditivo y retrocompatible:** campo opcional; consumidores viejos lo ignoran. No toca dinero
  (es display), pero **pasa por los tres veredictos** por ser `inventory` + cambio de contrato.

### 2.D · Lo que NO cambia (para que no crezca solo)
- **No** se añade `PATCH/PUT /admin/settings/:key` (el contrato ya lo prohíbe, `API_CONTRACT.md:5069`,
  `:18987`): la edición sigue siendo body parcial de `PUT /admin/settings`.
- **No** se mueve `sealed_price_source`/spreads a un endpoint nuevo: se reusan los existentes.
- **No** se toca `price_provider` (ingesta masiva) ni la curva/`premium_at_floor`: **no son diales
  del sellado** (censo del PO §2.C, re-medido: `settings.constants.ts:112` `price_provider`, seed
  `tcgcsv_singles` `:341`; el sellado y singles resuelven el grupo por caminos distintos).

---

## 3. Respetar el pricing — invariantes explícitas y dónde el diseño las preserva

El motor de precios NO se toca. M11 sólo **mueve palancas ya existentes por sus vías auditadas** y
**muestra** lo que el servidor ya calcula. Las invariantes (numeración del PO §4, re-medidas):

| # | Invariante | Fuente medida | Dónde M11 la preserva |
|---|---|---|---|
| **I-1** | **No copiar precio entre acabados/fuentes.** M11 muestra el mercado autoritativo `effectiveMarketCents` (ya gateado), nunca el informativo `marketRef` como número principal. | `SealedProductDTO` distingue `marketRef` (informativo) de `effectiveMarketCents` (autoritativo), `API_CONTRACT.md:6893-6904` | M11 no calcula; consume DTOs existentes. La ficha/grid ya usa `effectiveMarketCents` (`priceBasis` → `market`), sin ramas nuevas. |
| **I-2** | **No fabricar precio si el gate da null.** `gateSealedMarketCents(ref, sourceOn)` → `null` sin `ref`, con `ref<=0`, o con dial `off` (para fuente automática). | `pricing.service.ts:1763-1777` (medido) | M11 puede **mover el dial** (§1.iv) pero **no** produce precio; con `null` la pieza queda en la cola `missing:['price']`. Sin código de cálculo en la pantalla. |
| **I-3** | **Nunca $0; precio manual sólo `vault_operator+`; aportación sin referencia → `422 PRICE_PENDING`.** | `computeSealedSalePrice` trata override `<=0` como ausente (`money.ts:322-326`); gate trata `ref<=0` como sin mercado (`pricing.service.ts:1768`); alta money-safe §M1 | M11 reusa el alta y el `PATCH` **sin relajar** ninguna puerta. El operador captura override positivo; el 422 se mantiene. |
| **I-4** | **No saltar auditoría.** Override manual y todo cambio de dial quedan auditados; encender `sealed_price_source` es acto de dinero. | `PUT /admin/settings` → `AuditLog action:settings.update before/after` (`API_CONTRACT.md:18988`); spreads auditados (`API_CONTRACT.md:13890`) | M11 usa **los mismos endpoints** → misma escritura de `AuditLog`. Mover el editor de pantalla **no cambia** quién audita ni qué. |
| **I-5** | **No fusionar spread con la curva.** Son mecanismos independientes; el spread es markup ARRIBA de mercado por subtipo. | `settings.constants.ts:135` (sellado no usa curva); precedencia en `money.ts:313` | M11 edita spreads por `sealed-spreads`; no toca `pricing_curve`. Panel separado. |
| **I-6** | **Precedencia de venta intacta (CUATRO escalones).** `override>0` > `mercado × spread(subtipo)` > `mercado × spread(global)` > `PRICE_PENDING`. | `money.ts:313-345` (medido) — **corrijo al PO/insumo, que la resumían a 3 escalones**; hay dos niveles de spread (subtipo, luego fallback global) | M11 sólo edita los insumos (spreads, override); nunca la fórmula. `resolveSealedSalePrice` (`pricing.service.ts:1790`) sigue siendo el resolver único de los 4 consumidores. |
| **I-7** | **El maestro NO gatea el override manual de mercado.** «FIJAR PRECIO» (`source='manual'`) sobrevive con el dial `on` u `off`; el dial gatea **sólo la fuente automática** (tcgcsv). | `pricing.service.ts:1770-1776` (medido); `API_CONTRACT.md:18988` («off es fail-closed sólo para la fuente automática») | La confirmación del maestro (§abajo) **debe** decirlo: apagar `sealed_price_source` **no** apaga los precios manuales/overrides ya fijados — sólo la ingesta/mercado automático. Copy que afirme «apaga todo el mercado del sellado» sería **falso** y contradice el motor. |

### El aviso/confirmación del maestro `sealed_price_source` (D-3)
Encenderlo (`off → tcgcsv`) es **acto de dinero global**: autoriza a la ingesta a resolver mercado y
hace que el mercado automático **cuente como efectivo** en `gateSealedMarketCents` (I-2). Reusa el
patrón de doble aviso ya existente para el otro dial money-global de M10 (`gradingHookEnabled`,
`M10View.tsx:105-110` docstring «acto de dinero», DESIGN_SYSTEM §22.13). Copy propuesto (ux-ui afina):
- **ON (`off→tcgcsv`):** «Vas a **encender la fuente automática de mercado del sellado**. A partir de
  ahora los sellados con referencia resuelta contarán con precio automático (mercado × spread) y las
  aportaciones podrán valuarse contra ese mercado. Es una decisión de dinero, auditada a tu nombre.»
- **OFF (`tcgcsv→off`):** «Vas a **apagar la fuente automática de mercado del sellado**. Los sellados
  sin override manual quedarán *SIN PRECIO DE MERCADO* y no se autopreciarán. **Los precios manuales
  y los overrides ya fijados NO se apagan** (I-7). Auditado a tu nombre.»

---

## 4. Plan de migración de los diales fuera de M2/M10 (D-2) — sin perder validación ni auditoría

**Tesis del diseño (money-safe):** mover los diales a M11 es una **re-paternidad de editores en el
frontend**, NO un cambio de contrato ni de backend. Los **endpoints, validadores, auditoría y guardas
de rol permanecen idénticos**. Por eso la validación y la auditoría **no se pueden perder**: siguen
viviendo donde siempre vivieron (el backend), y M11 llama exactamente a las mismas puertas.

**Por qué NO se tocan las 4 estructuras de `settings.constants.ts`:** `SETTING_DTO_MAP` es **una sola
lista** que gobierna lectura **y** escritura de `PUT /admin/settings` (`API_CONTRACT.md:18988`, razón
del candado `IVA-8(f)`). Quitar `sealedPriceSource`/`sealedValueTrend`/`sealedRestockAlerts`/
`pricingProviderSealed` del map **rompería el `GET`** y el `PUT`. ⇒ **Se dejan en el map, los
validadores y los defaults intactos**; sólo cambia **qué pantalla dibuja el editor**. Esto es lo
contrario del retiro de `stripeFeeIvaPct`/`buylistCapPerRequestCents` (esos se **eliminaron** del DTO
porque el comportamiento moría; aquí el comportamiento **sigue vivo**, sólo cambia de pantalla).

### Qué se quita de dónde, y cómo
1. **De `M10View.tsx` (`frontend`):** retirar del arreglo `DIALS` la fila
   `{ key: 'pricingProviderSealed', kind: 'provider' }` (`M10View.tsx:96`, medido). Los diales
   `sealedValueTrend`/`sealedRestockAlerts` **no están dibujados hoy** en M10 (confirmado: ausentes de
   `DIALS`), así que no hay nada que quitar de la UI para ellos — sólo **añadir** su editor en M11.
   El maestro `sealedPriceSource` **tampoco** está en M10 hoy — se **crea** en M11 (no se mueve).
2. **De `M2View`/`SealedSpreadsSection.tsx`:** desmontar `SealedSpreadsSection` de la composición de
   M2 y montarlo en la sección (iv) de M11. El componente se **mueve** (mismo componente, mismo
   `GET/PUT /admin/pricing/sealed-spreads`); su test `SealedSpreadsSection.test.tsx` se mueve con él.
3. **Dejar rastro, no un mando muerto:** en el sitio de M2/M10 donde estaba el editor, **no** se deja
   un control inerte (doctrina «un mando muerto que sobrevive lo mueve alguien que cree que manda»,
   `API_CONTRACT.md:18988`). Se permite, opcionalmente, una **línea de sólo-texto con deep-link a
   M11** («Los controles de precio del sellado viven ahora en M11»), sin editor.
4. **Auditoría/validación:** intactas. `PUT /admin/settings` sigue validando contra el DTO map y
   escribiendo `AuditLog settings.update`; `PUT /admin/pricing/sealed-spreads` sigue con
   `validateSealedSpreads`/`validateSealedSpreadFallback` (`settings.constants.ts:1002-1003,584,610`,
   medido) y su auditoría. **M11 no introduce una segunda ruta de escritura** → no hay divergencia
   posible (es justo el riesgo `fxBufferPct`/D-2 que esta consolidación cierra: un solo editor).

### Orden de compuertas (para no dejar el dial vivo y sin superficie)
Como M11 y M2/M10 son **frontend**, el traslado es atómico en un solo pase de frontend (montar en M11
+ desmontar de M2/M10 en el mismo PR). No hay dependencia backend, así que no aplica el patrón
«backend retira la clave antes que frontend» de `catalogSyncFromDate` — aquí **la clave no se retira
nunca** (§4 tesis). QA verifica: tras el pase, editar cada dial desde M11 escribe `AuditLog`, y M2/M10
ya no exponen editor.

---

## 5. Criterios de aceptación + lista de pruebas que fallan si se implementa mal

### Criterios de aceptación
- **CA-1 (ciclo completo, O-4):** un `vault_operator` da de alta un sellado por compra con precio
  válido → aparece en (ii) `in_stock` y en (iii) la cola con `missing:['price']`; edita precio y
  publica desde (ii); despublica y vuelve a la cola. Todo sin salir de `/admin/m11`.
- **CA-2 (maestro money-global, D-3):** un `super_admin` enciende `sealed_price_source` desde (iv)
  tras confirmar; un sellado **con `PriceReference` de fuente resuelta** pasa de *SIN PRECIO DE
  MERCADO* a autopreciado (`priceBasis=market`), y una **aportación** de ese sellado deja de responder
  `422 PRICE_PENDING` y se valúa contra el mercado. Al apagarlo, vuelve a *SIN PRECIO DE MERCADO*
  **salvo** los que tengan override manual (I-7).
- **CA-3 (permisos por sección, D-4):** `vault_operator` ve (i)/(ii)/(iii) y edita/publica; la
  sección (iv) le muestra el candado (`SuperAdminOnly`). `super_admin` ve y edita las 4 secciones.
- **CA-4 (un solo editor, D-2):** los 6 diales se editan en M11; M2 y M10 **ya no** exponen editor de
  sellado; cada edición queda en `AuditLog`.
- **CA-5 (subtipo en la cola, §2.C):** la fila de la cola de sellado muestra el subtipo (Bundle/Box…).
- **CA-6 (pricing intacto):** el precio de venta de cualquier sellado es idéntico antes y después de
  M11 a igualdad de diales (M11 no cambia la fórmula).

### Lista de pruebas (rojas si se implementa mal)
1. **`M11-master-on`** (E2E/integración, DINERO): con `sealed_price_source=off` y un sellado con
   `PriceReference` resuelta, el alta de **aportación** → `422 PRICE_PENDING`; tras `PUT
   /admin/settings {sealedPriceSource:'tcgcsv'}`, la misma aportación se valúa y `gateSealedMarketCents`
   devuelve el mercado. **Falla si** el control no llama al endpoint o si el gate no reconoce el flip.
2. **`M11-master-preserves-override`** (unit sobre `gateSealedMarketCents`): con `source='manual'`,
   `sourceOn=false` devuelve `referenceMxnCents` (no `null`). **Falla si** el copy/código trata el
   maestro como interruptor total (I-7).
3. **`M11-role-operator-no-dials`** (componente): render de `M11View` con rol `vault_operator` →
   (i)/(ii)/(iii) presentes; el panel (iv) renderiza el `EmptyState` de `SuperAdminOnly`, y **no**
   hay inputs de dial en el DOM. **Falla si** un operador puede tocar diales.
4. **`M11-role-operator-backend-403`** (integración): `PUT /admin/settings` y `PUT
   /admin/pricing/sealed-spreads` con token `vault_operator` → `403`. (Ya cubierto por los `@Roles`;
   canario de defensa en profundidad.)
5. **`M11-single-editor`** (componente): tras la migración, `M10View` no renderiza fila
   `pricingProviderSealed` y `M2View` no monta `SealedSpreadsSection`. **Falla si** queda un segundo
   editor (riesgo de divergencia D-2).
6. **`M11-audit-on-dial-edit`** (integración): editar cada uno de los 6 diales desde la vía de M11
   escribe `AuditLog` (`settings.update` / spreads). **Falla si** algún editor nuevo saltó la vía
   auditada.
7. **`M11-pending-subtype`** (contrato + componente): `PendingPublishRowDTO` incluye `sealedSubtype`
   sólo para `productType==='sealed'`; la cola lo pinta. **Falla si** el DTO no lo lleva o lo pinta en
   raw/graded.
8. **`M11-price-parity`** (unit, DINERO): `resolveSealedSalePrice` da el mismo `salePriceCents` con
   los mismos insumos que en `production` (canario de I-6/CA-6). **Falla si** M11 introdujo cálculo.
9. **`M11-never-zero`** (unit): override `<=0` y `ref<=0` → nunca $0 publicado (I-3). Reusa
   `be27-clamp-cents.spec.ts` como base.

---

## 6. Riesgos

- **R-1 · Zona de dinero.** `inventory`+`pricing`+`settings`. Aunque M11 sólo reubique/expone,
  cualquier parte que edite un dial o cambie el DTO de la cola pasa por los **tres veredictos** (QA +
  techlead + seguridad); el `sealedSubtype` de la cola pasa además por arquitecto (regla 9, ya en este
  doc).
- **R-2 · Convivencia con la pestaña Sellado de M1 (D-5).** Mientras ambas existan, hay **dos
  entradas** al mismo ciclo de alta/publicación. No es divergencia de dinero (mismos endpoints), pero
  sí de navegación/estado. Aceptado por decisión del dueño; a re-evaluar si confunde.
- **R-3 · El maestro no cura el mapeo/ingesta.** Encender `sealed_price_source` **no** crea
  `PriceReference` por sí solo: si el sellado no tiene mercado resuelto (P-46/P-83, hallazgo (D) del
  insumo; egress a `tcgcsv.com` bloqueado en este entorno, O-17), seguirá *SIN PRECIO DE MERCADO*
  aunque el dial esté `on`. M11 **no** resuelve P-83; el copy no debe prometer que el flip «trae» los
  precios. **[medido: gate devuelve null sin `ref`, `pricing.service.ts:1768`]**
- **R-4 · Mover `SealedSpreadsSection` toca M2** (`super_admin`, dinero). El desmontaje debe conservar
  el test-canario; QA corre paridad de precio (prueba 8) antes de fusionar.

---

## 7. Lo que queda para el dueño (decisiones abiertas)

- **DO-1 · ¿Deep-link o nada en M2/M10?** Recomiendo dejar una **línea de texto con enlace a M11**
  donde estaba el editor (no un control), para que quien busque los spreads en M2 sepa a dónde ir.
  Alternativa: no dejar nada. (No bloquea el diseño.)
- **DO-2 · Copy exacto de la confirmación del maestro** (§3): lo afina ux-ui; el dueño valida que el
  texto de OFF diga que los overrides manuales **no** se apagan (I-7).
- **DO-3 · ¿`sealedValueTrend`/`sealedRestockAlerts` visibles ya, o ocultos hasta que exista su
  front?** Los endpoints que gobiernan están feature-flagged (`404 FEATURE_DISABLED` con `off`). Puedo
  mostrarlos como interruptores en (iv) desde ya (son diales del sellado, censo del PO), o esconderlos
  hasta que su pantalla exista. Recomiendo **mostrarlos** (el dueño pidió los 6 «a la mano»).
- **DO-4 · Retiro futuro de la pestaña Sellado de M1 (D-5).** Hoy conviven; el dueño decidirá cuándo
  (si) retirar la de M1. No es alcance de este diseño.

---

## 8. Dónde re-medí y algo NO cuadró con los insumos (gana lo medido)

- **Precedencia de venta: son CUATRO escalones, no tres.** El PO §4.6 y el insumo la resumen como
  `override > mercado×spread > PRICE_PENDING`. Medido en `money.ts:313-345`: hay **dos** niveles de
  spread — `mercado × spread(subtipo)` y, si el subtipo no tiene regla, `mercado × spread(global
  fallback)`. Lo corrijo en I-6. No cambia el diseño, pero la prueba de paridad (prueba 8) debe cubrir
  ambos niveles.
- **El maestro NO gatea el override manual (I-7).** Ni el PO ni el insumo lo destacan al plantear D-3
  (el PO §4.2 habla del gate en general). Medido en `pricing.service.ts:1770-1776` y ratificado en
  `API_CONTRACT.md:18988`: `source='manual'` sobrevive al dial. Es **crítico** para el copy de la
  confirmación money-global: un texto que diga «apaga todo el mercado del sellado» sería falso.
- **`pricingProviderSealed` SÍ está dibujado en M10 hoy** (`M10View.tsx:96`, medido) — coincide con el
  PO. Pero **`sealedValueTrend`/`sealedRestockAlerts` NO están en el arreglo `DIALS`** de M10
  (medido): el PO decía «editable por API, no dibujado», lo confirmo — en M11 hay que **crearlos**, no
  moverlos.
- **`PATCH /admin/inventory/items/:id` ya acepta `sealedSubtype`** (`API_CONTRACT.md:10286`, medido):
  editar el subtipo por pieza ya es posible; el hueco (C) es **sólo** que la fila de la **cola**
  (`PendingPublishRowDTO`) no lo lleva (§2.C). El delta de contrato se limita a la cola.
- **La migración de diales NO es un cambio de contrato** (§4): re-medido que `SETTING_DTO_MAP` es una
  sola lista lectura+escritura (`API_CONTRACT.md:18988`); por eso las claves **se quedan** y sólo
  cambia la pantalla que las dibuja. Esto hace la migración money-safe y reversible (revertir el PR de
  frontend).

---

# AMPLIACIÓN M11 · TRAER PRECIOS DE SELLADO (rama `claude/arch-m11-precios`)

- **Rama:** `claude/arch-m11-precios`, basada en `origin/claude/arch-m11-sellado` (`ea8fb20a`), que a
  su vez se basa en `origin/production` (`187b1d40`). **Amplía** este mismo documento (§§1-8 arriba,
  intactas); añade §§9-13.
- **Redactado por:** arquitecto, 2026-09-17. Aprobación del dueño: **construir M11 funcional y que
  TRAIGA precios de sellado** (2026-09-17).
- **Base medida:** todo `fichero:línea` de §§9-13 se **leyó sobre el árbol de trabajo, que es
  idéntico a `origin/production` (`187b1d40`)** — verificado `git diff --stat origin/production HEAD`
  = **sólo este `.md`** (cero código divergente). Salvo donde diga **NO MEDIDO**.
- **Restricción de entorno (O-17):** el egress a `tcgcsv.com` está **BLOQUEADO** aquí; el fetch real
  sólo corre en prod. Todo el diseño de §§9-13 se construye/prueba **con fixtures**; el jalón en vivo
  lo dispara el dueño. Por eso la vista de estado (§10) se diseña **sin depender de TCGCSV** (lee
  estado persistido), a diferencia del endpoint de candidatos que sí lo necesita.
- **Regla de oro (heredada):** M11 **reubica y expone** superficie existente; **no reimplementa
  lógica de dinero**. Las tres adiciones respetan I-1…I-7 (§3). El precio de sellado lo sigue
  trayendo el job `sealed-price-ingest`; M11 sólo **dispara**, **muestra por qué** y **corrige el
  mapeo** cuando el matcher automático falla.

## 9. Adición 1 — Botón «Traer precios de sellado ahora» (§iv, `super_admin`)

### Qué es
Un CTA en la sección (iv) de M11 (panel de diales, `super_admin`) que **dispara el job de ingesta de
la referencia de mercado del sellado**. No fija precio: sólo pide al backend que consulte TCGCSV y
upsertee `PriceReference` para los sellados mapeados. Complementa al cron diario con un disparo a
demanda tras encender el dial o tras corregir un mapeo (§11).

### Reuso citado (cero endpoint nuevo)
- **Endpoint:** `POST /api/v1/admin/jobs/sealed-price-ingest` — **ya existe**
  (`backend/src/jobs/admin-jobs.controller.ts:217`), clase `@Roles(Role.super_admin)`
  (`admin-jobs.controller.ts:42`), `@HttpCode(202)` (`:218`).
- **Body opcional:** `SealedPriceIngestDto` (`admin-jobs.controller.ts:27-32`) acepta `groupId?`
  (entero `≥1`, `@IsOptional @IsInt @Min(1)`) para acotar a UN grupo (verificación de esquema en
  staging). El botón «traer todo» **no envía body**; el disparo acotado (§11.iv) envía `{groupId}`.
- **Fail-closed por dial:** con `sealed_price_source=off` el disparo cortocircuita y devuelve
  `{ enqueued:false, reason:'SEALED_PRICE_SOURCE_OFF' }` (`backend/src/jobs/sealed-price-ingest.service.ts:55-60`;
  `isEnabled` lee el dial `SEALED_PRICE_SOURCE`, `backend/src/modules/pricing/sealed-price-ingest.service.ts:52-55`).
- **Single-flight:** flag en memoria; un segundo disparo concurrente devuelve `enqueued:false` sin
  `reason` (`sealed-price-ingest.service.ts:62-66`).
- **AWAITED:** el job hace `await this.ingest.run(fx, groupId)` **antes** de responder
  (`sealed-price-ingest.service.ts:68-74`) — el `202` llega **cuando la corrida ya terminó** (alcance
  minúsculo, decenas de requests). Distinto del `price-ingest` de singles, que es fire-and-forget con
  polling (`admin-jobs.controller.ts:196-197`).
- **Auditoría:** `jobs.sealed_price_ingest.run` con `{ job, groupId, enqueued, reason? }`
  (`admin-jobs.controller.ts:224-236`). El botón **no** añade auditoría nueva: usa la del endpoint.

### Delta de contrato
**Ninguno de endpoint.** El endpoint, su rol, su DTO y su `202` ya están en el contrato (§M10-ops).
Delta **documental** en `API_CONTRACT.md` §M11: anotar que la **superficie de disparo** del job es el
botón de M11 (antes: sólo `curl`/runbook), y en `ARCHITECTURE.md` §4.19d que M11 es su superficie de
ops. Ver §13 para el matiz del cuerpo de respuesta.

### Estados de UI (los tres que el usuario ve)
El shape de respuesta es `{ job, enqueued, jobId?, reason?, scope?, groupId? }`
(`sealed-price-ingest.service.ts:9-18`). El botón mapea:
1. **Dial `off` → `SEALED_PRICE_SOURCE_OFF`:** `enqueued:false, reason:'SEALED_PRICE_SOURCE_OFF'`. El
   botón muestra un aviso inline «La fuente automática de mercado del sellado está **apagada**.
   Enciéndela arriba (dial `sealed_price_source`) para traer precios» con deep-link al toggle de §3.
   **No es error**: es la puerta money-safe (I-2). El botón queda **deshabilitado** cuando el dial
   está `off` (leído de `sealedPriceSource` que ya viaja en las respuestas de sellado,
   `sealed-product.service.ts:225,252`), y el aviso explica por qué.
2. **Encolado/hecho:** `enqueued:true`. Como es AWAITED, al resolver la promesa la corrida terminó;
   el botón muestra «Ingesta completada» y **refresca la vista de estado (§10)** para que el usuario
   vea el resultado real (cuántos sets pasaron a «con precio»). Ver §13: el `202` **no** trae los
   conteos (`priced`/`unmatched`); ésos se leen de §10, que es justo lo que ata las adiciones 1 y 2.
3. **Ya en curso:** `enqueued:false` sin `reason` (single-flight). El botón muestra «Ya hay una
   ingesta en curso; espera a que termine» y no reintenta.

### Permiso
`super_admin` (heredado de la clase `@Roles(Role.super_admin)` del controller de jobs,
`admin-jobs.controller.ts:42`). El CTA vive **dentro** de la sección (iv), ya envuelta en
`SuperAdminOnly` (§1, guarda de pantalla). Defensa en profundidad: el backend rechaza 403 a
`vault_operator`.

### Invariantes money-safe
- **I-2 preservada:** el botón **no fabrica precio**. Con el dial `off` no ingiere nada; con `on`,
  sólo pide al backend consultar la fuente y upsertear `PriceReference` (informativo, §4.19a). Si un
  sellado no tiene mapeo o la fuente no trae precio, queda *SIN PRECIO DE MERCADO* — el botón no lo
  cambia.
- **I-4 preservada:** todo disparo queda en `AuditLog` a nombre del super-admin
  (`admin-jobs.controller.ts:224-236`).
- **R-3 (heredada):** encender el dial + darle al botón **no cura el mapeo**. Si el set no tiene grupo
  resuelto (P-46), seguirá sin precio aunque el dial esté `on` y el job corra. El copy del botón
  **no** debe prometer «esto trae todos los precios»; debe decir «dispara la ingesta de los sellados
  **ya mapeados**» y remitir a §10/§11 para los que no traen.

### Criterios de aceptación + pruebas canario
- **CA-7:** con dial `off`, el botón está deshabilitado y el disparo (si se fuerza vía API) devuelve
  `SEALED_PRICE_SOURCE_OFF`; **no** se escribe ninguna `PriceReference`.
- **CA-8:** con dial `on` y ≥1 sellado mapeado con precio en la fuente (fixture), el botón dispara,
  la corrida upsertea `PriceReference`, y al refrescar §10 el set pasa a «con precio».
- **CA-9:** un `vault_operator` no ve el botón (sección iv con candado) y el endpoint le da 403.
- **Prueba `M11-ingest-button-off`** (integración, DINERO): `POST /admin/jobs/sealed-price-ingest`
  con dial `off` → `{enqueued:false, reason:'SEALED_PRICE_SOURCE_OFF'}` y **cero** filas
  `PriceReference` nuevas. **Falla si** el botón/endpoint ingiere con el dial apagado.
- **Prueba `M11-ingest-button-role`** (integración): mismo `POST` con token `vault_operator` → `403`.
- **Prueba `M11-ingest-button-fixture`** (integración, DINERO, O-17 con fixture): con el provider
  TCGCSV **mockeado** (egress bloqueado aquí), dial `on`, un grupo mapeado → la corrida upsertea la
  `PriceReference` esperada y el `202` trae `enqueued:true`. **Falla si** el cableado del botón al job
  se rompe. *(El jalón en vivo lo hace el dueño en prod; aquí se prueba contra fixture.)*

## 10. Adición 2 — Vista de estado por set de sellado (§ii/§iii, `vault_operator+`)

### Qué es
Una vista que, **por set de sellado**, dice en cuál de **tres estados** está su precio:
**«con precio» · «emparejado sin precio» · «SIN emparejar»**. Es lo que deja ver **por qué** un set no
trae precio, para decidir si hace falta corregir el mapeo (§11) o sólo disparar la ingesta (§9).

### Medición: ¿existe ya un endpoint de lectura que dé este estado? — **NO** (medido)
Medí las tres lecturas de sellado en `origin/production`:
- **`GET /admin/inventory/sealed-sets`** (`inventory.controller.ts:123`, `vault_operator+` por la
  clase `:84`; svc `sealed-graded.service.ts:121`): da por set `pieceCount`, `listedCount`,
  `unmappedCount`, `marketValueMxnCents`. **Pero `unmappedCount` CONFLA los dos estados que nos
  importan**: cuenta junto lo «no mapeado» y lo «mapeado sin precio»
  (`sealed-graded.service.ts:196-198`, comentario y código: *«Sin mercado = no mapeada O mapeada sin
  ingest»*). Además **sólo lista sets con ≥1 pieza sellada de plataforma** (`sealedScope()`
  `:106-112`), así que un set del catálogo (`SealedProduct`) sin inventario **no aparece**, y no dice
  nada del mapeo a nivel de **grupo** del set.
- **`GET /admin/inventory/sealed-products?setId=`** (`inventory.controller.ts:188`, `vault_operator+`;
  svc `sealed-product.service.ts:158-253`): da, **por producto de UN set**, `marketRef`,
  `effectiveMarketCents`, `sealedPriceSource`, los `groups` (`SealedSetGroup` con `kind`/`label`) y
  `needsSync`. Es la lectura per-producto correcta, pero **requiere `setId`** y **no agrega** el
  estado por set ni lista todos los sets.
- **`GET /admin/inventory/sealed-products/sync/candidates?setId=`** (`inventory.controller.ts:241`,
  `super_admin`; svc `sealed-product.service.ts:582-601`): da candidatos por name-match, pero
  **DEPENDE de TCGCSV vivo** (`listGroupsOr502` → `502`; `sealed-product.service.ts:585,749-759`) — en
  este entorno el egress está bloqueado (O-17), así que **no** sirve como vista de estado offline.

**Conclusión (gana lo medido):** no hay un endpoint que dé los tres estados agregados **por set**
desde estado **persistido**. `sealed-sets` está cerca pero (a) funde «emparejado sin precio» con «SIN
emparejar», (b) ignora el catálogo sin inventario y (c) no expone el mapeo por grupo. ⇒ **Se
especifica un endpoint de lectura nuevo (regla 9).**

### Delta de contrato — endpoint de lectura NUEVO (regla 9)
`GET /api/v1/admin/inventory/sealed-price-status` — `vault_operator+` (misma clase que el resto de
lecturas de sellado). **Read-only, sin escritura, sin red externa** (lee sólo estado persistido →
O-17 safe; es exactamente el diseño que se puede construir y probar aquí con fixtures de BD).

- **Query:** `?q?=` (filtro por nombre de set), `?state?=` (`priced | mapped_unpriced | unmapped`,
  para filtrar a un estado), `?page?=`, `?pageSize?=`. `?state?` **se DERIVA** del enum de estados de
  abajo (clase E, no dos literales a mano — misma doctrina que `origin` en `sealed-products`,
  `inventory.controller.ts:198-204`).
- **Respuesta (borrador de DTO, ADITIVO):**
  ```ts
  /** v1.xx (M11) — estado de precio/mapeo del sellado POR SET, desde estado persistido (sin TCGCSV). */
  interface SealedPriceStatusRowDTO {
    set: SetRefDTO;                         // reusa SetRefDTO existente
    setMainGroupId: number | null;          // CardSet.tcgcsvGroupId (denormalizado del set_main)
    linkedGroupIds: number[];               // SealedSetGroup.tcgplayerGroupId del set
    productCount: number;                    // SealedProduct active del set
    /** Desglose de los tres estados a nivel de PRODUCTO sellado del set: */
    priced: number;                          // con PriceReference gateada != null (effectiveMarketCents)
    mappedUnpriced: number;                  // tcgplayerProductId != null pero sin PriceReference gateada
    unmapped: number;                        // sin grupo/productId resuelto
    /** Estado ROLLUP del set (el peor no-vacío): 'unmapped' | 'mapped_unpriced' | 'priced'. */
    state: SealedPriceState;
    /** Por qué NO trae precio, para el humano (sin abrir logs): 'no_group' | 'dial_off' | 'no_source_price'. */
    reason?: SealedPriceStatusReason;
  }
  interface SealedPriceStatusResponse {
    sealedPriceSource: 'tcgcsv' | 'off';    // el dial (para el copy: si off, todo es 'mapped_unpriced' por gate)
    data: SealedPriceStatusRowDTO[];
    page: number; pageSize: number; total: number;
  }
  ```
- **Enums nuevos (§Enums del contrato, sin columna en BD → clase L documentada, no derivada de
  schema):** `SealedPriceState = priced | mapped_unpriced | unmapped`;
  `SealedPriceStatusReason = no_group | dial_off | no_source_price`.
- **Proyección backend (sin red):** join en memoria de `SealedProduct` (active) + `SealedSetGroup` +
  `CardSet.tcgcsvGroupId` + el resolver gateado que ya usa `listSealedProducts`
  (`getReferencesBatch` + `gateSealedMarketCents`, `sealed-product.service.ts:224-241`) para clasificar
  cada producto. **Reusa el resolver H-1 existente** — no reimplementa el gate (I-2/I-6). Money-safe:
  clasifica, no fija precio. **Cero llamadas a `fetchSealedPricesForGroup`/`listGroups`** (a
  diferencia de `listSealedProducts` y `syncCandidates`), por lo que **no** toca `tcgcsv.com`.

### Dónde se muestra en M11
En la sección (ii)/(iii): una tabla o badges por set con los tres estados y el `reason`. «SIN
emparejar» abre el flujo de mapeo manual (§11); «emparejado sin precio» con dial `on` ofrece el botón
de §9 (disparar ingesta); «emparejado sin precio» con dial `off` explica que falta encender el dial.

### Invariantes money-safe
- **I-2/I-6 preservadas:** el estado `priced` se decide con **el mismo gate** que el alta
  (`gateSealedMarketCents`, `sealed-product.service.ts:239`), no con un cálculo nuevo. `effectiveMarketCents == null` ⟺
  el backend valuaría `PRICE_PENDING` — la vista **refleja** esa verdad, no la inventa.
- **Nunca $0:** los conteos son de estado, no de dinero; no se muestra ningún precio derivado aquí.

### Criterios de aceptación + pruebas canario
- **CA-10:** un set con `SealedProduct` mapeados y `PriceReference` gateada → `state:'priced'`; un set
  mapeado sin `PriceReference` (o con dial `off`) → `state:'mapped_unpriced'` con `reason:'dial_off'`
  o `'no_source_price'`; un set sin grupo resuelto → `state:'unmapped'` con `reason:'no_group'`.
- **CA-11 (O-17):** la vista se puebla **sin** llamar a TCGCSV (medible: el endpoint responde con el
  egress bloqueado; no hay `502`).
- **Prueba `M11-status-three-states`** (integración): tres sets fixture (mapeado+preciado,
  mapeado-sin-precio, sin-mapear) → el endpoint los clasifica en los tres estados y sus conteos
  cuadran. **Falla si** funde estados (el defecto de `unmappedCount` que este endpoint corrige).
- **Prueba `M11-status-no-egress`** (integración, O-17): con el provider TCGCSV que **lanza** al ser
  llamado, el endpoint responde `200` igual → prueba que **no** lo llama. **Falla si** el endpoint
  depende de la red.
- **Prueba `M11-status-gate-parity`** (unit, DINERO): un producto con `PriceReference` y dial `off`
  cuenta como `mapped_unpriced` (no `priced`), igual que el alta lo trataría `PRICE_PENDING`. **Falla
  si** la clasificación diverge del gate (I-2).

## 11. Adición 3 — Mapeo manual set→grupo TCGCSV (§iv, `super_admin`) — escape de P-46

### Qué es
Cuando el matcher automático **no** resuelve el grupo TCGCSV de un set (P-46: prefijo «SV08: Pitch
Black» vs «Pitch Black», o ambigüedad), el super-admin **fija a mano** el `tcgplayerGroupId` del set.
**Con esto M11 trae precios aunque el matcher automático no cuadre** — es lo que hace M11 funcional
sin esperar a que se cierre P-46 en backend (§12).

### Medición: ¿existe ya campo/endpoint para persistir el mapeo? — **PARCIAL** (medido)
- **Persistir un grupo ya se puede:** `POST /admin/inventory/sealed-sets/:setId/groups`
  (`inventory.controller.ts:254`, `super_admin`, `201`, auditado `inventory.sealed_set_group_link`
  `:263-270`; svc `linkGroup` `sealed-product.service.ts:608-655`). Enlaza un grupo con su `kind`; si
  `kind='set_main'` y `CardSet.tcgcsvGroupId` es **null**, lo puebla (`:642-647`).
- **El sync acepta grupos explícitos:** `POST /admin/inventory/sealed-products/sync {setId, groupIds}`
  (`inventory.controller.ts:218`); los `groupIds` se enlazan como `promo_collection`
  (`sealed-product.service.ts:380-382`).
- **El ingest acota con `{groupId}`** pero **eso NO persiste un mapeo** — sólo limita qué grupo barre
  esa corrida (`sealed-price-ingest.service.ts:51-53,86-87`).
- **Schema:** `CardSet.tcgcsvGroupId Int?` (`schema.prisma:604`); `SealedSetGroup` con
  `@@unique([setId, tcgplayerGroupId])`, `onDelete: Cascade`, **sin marca de override**;
  `SealedGroupKind = set_main | promo_collection`.

**GAP medido (gana lo medido):** hay cómo **añadir** un grupo, pero **no** cómo **corregir** uno
equivocado, que es justo el escape de P-46 que hace falta:
1. `linkGroup` puebla `CardSet.tcgcsvGroupId` **sólo si es null** (`:642`). Si el matcher ya escribió
   un `set_main` **equivocado**, no hay forma de reemplazarlo por API.
2. Re-enlazar el mismo `(setId, groupId)` da **409** (`:617,637-639`); no permite cambiar el `kind`.
3. **No existe `DELETE`/unlink** de un `SealedSetGroup` (medido: sólo `@Get`/`@Post` en el controller
   para `sealed-sets`, `inventory.controller.ts:123,136,254`).

### Delta de contrato — endpoints NUEVOS (regla 9), con auditoría
Dos endpoints nuevos, `super_admin`, auditados, para **corregir** el mapeo (el `linkGroup` existente
se conserva para el caso «añadir cuando está vacío»):

1. **`PUT /api/v1/admin/inventory/sealed-sets/:setId/set-main-group`** — fija/**reemplaza** el grupo
   `set_main` del set aunque ya haya uno.
   - **Body:** `{ tcgplayerGroupId: number (int ≥1), reason?: string }`.
   - **Semántica:** upsertea la fila `SealedSetGroup` de `kind='set_main'` del set al `groupId` dado
     (degradando el `set_main` anterior a `promo_collection` **o** desenlazándolo, ver DO-5) y
     **reescribe `CardSet.tcgcsvGroupId`** (a diferencia de `linkGroup`, que sólo escribe si es null).
   - **Auditoría (I-4):** `action:'inventory.sealed_set_main_group_set'`,
     `entityType:'CardSet'`, `entityId:setId`, `before:{ tcgcsvGroupId }`, `after:{ tcgcsvGroupId,
     reason }`. Deja `before/after` para que quede el grupo anterior (auditoría de un acto que mueve de
     dónde saldrá el precio del set).
   - **Respuesta:** el `SealedSetGroupDTO` del `set_main` resultante (reusa el DTO existente,
     `sealed-product.service.ts:51-57`).
   - **Errores:** `404` (set), `422 VALIDATION_ERROR` (`groupId` no entero positivo).
2. **`DELETE /api/v1/admin/inventory/sealed-sets/:setId/groups/:groupId`** — desenlaza un grupo mal
   asignado.
   - **Semántica:** borra la fila `SealedSetGroup`; si era el `set_main`, pone `CardSet.tcgcsvGroupId`
     a `null` (vuelve al estado «SIN emparejar» de §10, honesto).
   - **Auditoría (I-4):** `action:'inventory.sealed_set_group_unlink'`,
     `entityType:'SealedSetGroup'`, `before:{ setId, tcgplayerGroupId, kind }`.
   - **Errores:** `404` (set o enlace inexistente).
   - **Nota money-safe:** desenlazar **no borra `PriceReference`** ya escritas (quedan stale/inocuas,
     §4.19c); sólo cambia de dónde saldrá el precio en la próxima ingesta.

### El ciclo completo (O-4) — cómo M11 trae precio pese a P-46
1. §10 muestra el set en «SIN emparejar» (`reason:'no_group'`).
2. El super-admin abre candidatos (`GET .../sync/candidates`, **requiere prod/TCGCSV** — O-17: aquí
   con fixture; en prod real) **o** teclea el `groupId` a mano si lo conoce.
3. `PUT .../set-main-group {tcgplayerGroupId}` fija el mapeo (auditado).
4. `POST .../sealed-products/sync {setId}` puebla los `SealedProduct` del grupo (persiste
   `tcgplayerProductId`/`tcgplayerGroupId`, `sealed-product.service.ts:419-431`).
5. Botón §9 (`POST /admin/jobs/sealed-price-ingest`) trae `PriceReference`.
6. §10 muestra el set en «con precio». **Ciclo cerrado sin tocar el matcher automático.**

### Permiso
`super_admin`, en la sección (iv) (envuelta en `SuperAdminOnly`). Los dos endpoints nuevos llevan
`@Roles(Role.super_admin)` a nivel de método (como `sealed-products/sync`,
`inventory.controller.ts:220`), no sólo la clase.

### Invariantes money-safe
- **I-2/I-4:** fijar el mapeo **no fabrica precio** (sólo dice de qué grupo saldrá); el precio lo trae
  el job §9, gateado por el dial. Todo cambio de mapeo queda en `AuditLog` con `before/after`.
- **Anti-adivinación (heredada de `bestSetMainMatch`, `sealed-product.service.ts:812`):** el mapeo
  manual es **explícito** (un humano fija el `groupId`); no relaja el criterio automático. El matcher
  sigue devolviendo `null` ante ambigüedad; la corrección la pone una persona, auditada.

### Criterios de aceptación + pruebas canario
- **CA-12 (corrige un mapeo equivocado):** un set con `CardSet.tcgcsvGroupId` **ya poblado con el
  grupo equivocado** → `PUT .../set-main-group` lo reemplaza y `CardSet.tcgcsvGroupId` cambia (lo que
  `linkGroup` **no** puede, medido `:642`).
- **CA-13 (desenlaza):** `DELETE .../groups/:groupId` de un `set_main` → el set vuelve a «SIN
  emparejar» en §10 y `CardSet.tcgcsvGroupId` queda `null`.
- **CA-14 (permiso):** `vault_operator` → `403` en ambos endpoints.
- **CA-15 (funcional pese a P-46):** un set que el matcher automático deja `null` (fixture con nombre
  prefijado ambiguo) → tras `PUT .../set-main-group` + `sync` + botón §9, el set pasa a «con precio»
  en §10. **Es la prueba de que M11 trae precios aunque P-46 no se cierre.**
- **Prueba `M11-remap-overwrites`** (integración): `PUT` sobre un set con `set_main` existente
  reescribe `CardSet.tcgcsvGroupId` y degrada/borra el anterior; el `AuditLog` trae `before/after`.
  **Falla si** conserva el grupo viejo (el bug de `linkGroup`).
- **Prueba `M11-remap-audit`** (integración, I-4): cada `PUT`/`DELETE` escribe su `AuditLog` con
  actor super-admin. **Falla si** salta la auditoría.
- **Prueba `M11-remap-role`** (integración): `vault_operator` → `403` en `PUT` y `DELETE`.
- **Prueba `M11-remap-no-price-fabrication`** (unit, DINERO): fijar el mapeo **no** crea ni cambia
  ninguna `PriceReference` por sí solo. **Falla si** el remap toca dinero.

## 12. Nota para backend — P-46 (money, NO lo diseño a fondo: es su módulo)

**Trabajo backend money, con 3 gates (QA + techlead + seguridad).** Diagnóstico medido, no diseño de
solución:

- **La escalera anti-P-46 ya existe para SINGLES:** `matchTcgcsvGroupByName`
  (`backend/src/modules/pricing/providers/tcgcsv-group-match.ts:101`) tiene los peldaños `exact` /
  `exact_unprefixed` (P-46) / `exact_debased` (P-46-bis, sufijo «Base Set») / `contains`, con
  desambiguación money-safe (match único o `null`, nunca adivina). La consumen la ruta de **precio**
  de singles (`TcgcsvSinglesBulkPriceProvider`) y la de **estructura**
  (`CardProductResolverService`) — comentario `tcgcsv-group-match.ts:18-26`.
- **La ruta del SELLADO usa OTRO matcher, MENOS completo:** `SealedProductService.matchScore`
  (`sealed-product.service.ts:782-800`) + `bestSetMainMatch` (`:803-814`). `matchScore` **sí** tolera
  el prefijo (`setNameCandidates`, `:786-796`) — o sea, el P-46 «puro» está cubierto — **pero no tiene
  el peldaño `exact_debased`** (bases de era «SV01: … Base Set») ni la escalera de desambiguación de
  `tcgcsv-group-match.ts`. `bestSetMainMatch` exige `score≥0.9` y **único en el tope** (`:809-812`):
  los nombres cortos de era que son subcadena de varios grupos caen a `null`. **⇒ La clase
  P-46-bis NO está cerrada en la ruta del sellado** (medido).
- **El arreglo (para backend):** hacer que la resolución de `set_main` del sellado **reuse
  `matchTcgcsvGroupByName`** (la fuente única ya existente) en lugar de `matchScore`/`bestSetMainMatch`,
  o extienda `matchScore` con el peldaño `exact_debased`. Debe conservar la monotonía money-safe
  (`null → groupId`, nunca `groupId → OTRO`) y su prueba de propiedad
  (`test/tcgcsv-group-match.spec.ts`, citada `tcgcsv-group-match.ts:69`). ⚠️ El comentario de ese
  fichero **ya advierte** que copiar el match es cómo P-46 llegó a tres sitios y nunca al que movía
  dinero (`:26`): la tercera ruta (sellado) es exactamente esa advertencia.
- **Gates:** toca `pricing`/`inventory` (dinero) → los tres veredictos. El modelo fuerte escribe la
  prueba que **debe fallar** (un set de era ambiguo que hoy queda `null` y debería resolver) antes de
  arreglar.
- **Independencia (lo importante para el dueño):** **el mapeo manual (§11) hace M11 funcional aunque
  P-46 no se cierre.** El arreglo del matcher es «que emparejen solos»; §11 es «que emparejen aunque
  no». Se pueden entregar por separado; M11 no depende de P-46.
- **O-17:** medir el matcher en vivo necesita la lista real de grupos de `tcgcsv.com` (bloqueada
  aquí). Backend prueba con **fixtures** de nombres de grupo (como ya hace `tcgcsv-group-match.spec.ts`);
  el jalón real lo confirma el dueño en prod.

## 13. Riesgos y decisiones abiertas de la ampliación

- **R-5 · El `202` del botón no trae los conteos de la corrida.** Medido: el shape es
  `{job, enqueued, jobId?, reason?, scope?, groupId?}` (`sealed-price-ingest.service.ts:9-18`); los
  `priced`/`unmatched`/`groups` viven en `SealedIngestRunResult`
  (`modules/pricing/sealed-price-ingest.service.ts:9-21`) y **no** se exponen. Por eso el botón
  **refresca §10** para mostrar el resultado real, en vez de inventar un conteo. *(Opción para el
  dueño, DO-6: si se quiere el conteo en la respuesta del botón, es un delta ADITIVO al `202` — no lo
  incluyo por defecto para no ampliar el contrato sin pedirlo.)*
- **R-6 · Los candidatos (`sync/candidates`) necesitan TCGCSV vivo.** La vista de estado §10 **no**;
  el mapeo manual §11 **sí** para *sugerir* candidatos, pero **no** para *fijar* el `groupId` (se
  puede teclear a mano). Aquí (O-17) los candidatos se prueban con fixture; en prod el dueño ve la
  lista real.
- **DO-5 · ¿Qué pasa con el `set_main` viejo al reemplazarlo (§11.1)?** Recomiendo **degradarlo a
  `promo_collection`** (conserva el enlace por si tenía productos válidos) en vez de borrarlo; el
  super-admin lo borra aparte con el `DELETE` si estorba. El dueño decide.
- **DO-6 · ¿Conteos en la respuesta del botón?** Ver R-5. Recomiendo **no** por ahora (§10 lo cubre).
- **Zona de dinero:** las tres adiciones tocan `inventory`+`pricing`+`jobs` y los dos endpoints
  nuevos + los enums pasan por arquitecto (regla 9, ya en este doc) y por los tres veredictos.

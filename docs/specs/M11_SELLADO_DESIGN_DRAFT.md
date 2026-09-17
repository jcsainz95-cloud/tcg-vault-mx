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

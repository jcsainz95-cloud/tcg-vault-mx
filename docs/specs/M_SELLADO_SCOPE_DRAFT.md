# M-Sellado — Alcance de producto (BORRADOR para aprobación del dueño)

- **Rama:** `claude/po-m-sellado-draft`, basada en `origin/production` (`187b1d40`).
- **Redactado por:** product-owner, 2026-09-17.
- **Base medida:** todo `fichero:línea` de este documento se leyó sobre el árbol de `origin/production`
  (`187b1d40`). Donde no lo medí, digo **NO MEDIDO**.
- **Naturaleza:** esto es un **borrador de PRODUCTO** (qué pantalla, qué secciones, qué reusa, qué decisiones
  faltan). **No es diseño técnico** (no elige rutas de código, DTOs ni componentes concretos — eso es del
  arquitecto/ux-ui) y **no toca `backend/` ni `frontend/`**.
- **Insumo previo:** `docs/specs/SELLADO_M1_FINDINGS_DRAFT.md` (rama `claude/investiga-sellado-m1`) — el
  diagnóstico medido de lo que existe hoy en el sellado. Este documento **no re-mide** lo que aquél ya midió;
  lo cita y construye encima.

---

## 0. La decisión del dueño (textual, 2026-09-17)

> «Dale un apartado en ADMIN M algo y ahí mete todo lo necesario para controlar la **ventana de publicación**
> [del sellado]. Tienes que **respetar todo el tema de pricing**. En esa misma pantalla **mueve los dials de
> pricing de sellado** para tenerlos a la mano.»

Traducido a alcance: una **pantalla nueva de Admin dedicada al sellado** que reúne, en un solo sitio, (a) el
control de la **ventana de publicación** del sellado (dar de alta, editar, publicar, despublicar, ver la cola de
«listos para publicar») y (b) los **diales de pricing del sellado a la mano**, sin cambiar ninguna regla de
dinero.

---

## 1. Qué es hoy la «ventana de publicación» del sellado (ciclo medido)

Un producto sellado recorre estos estados (medido en `SELLADO_M1_FINDINGS_DRAFT.md` + código citado abajo):

1. **Alta.** Desde la pestaña Sellado de M1: botón «Agregar producto sellado» (`SealedAddFlow`) o «Alta rápida»
   (`QuickAdd`). Con precio de compra válido, la pieza nace en **`in_stock`**
   (`inventory.service.ts:614-631`), **no publicada**.
2. **Cola «Listas para publicar».** Como el sellado nace sin `listPriceCents`, cae en la cola con
   `missing:['price']` (`inventory.service.ts:772`, `PendingPublishQueue`).
3. **Editar precio / Publicar / Despublicar.** Por pieza, dentro del `VariantDrawer` (se abre hoy tras el botón
   «Ver piezas» de cada grupo): editar precio (`VariantDrawer.tsx:424-431`), publicar (`:593-604`) y
   **despublicar** (`unpublish` ⇒ `status:'in_stock'`, `:419-422`, visible sólo si la pieza está `listed`).
   Todo vía `PATCH /admin/inventory/items/:id`.

⇒ **La «ventana de publicación» = ese ciclo alta → cola → publicar/despublicar/editar precio.** Todo el
mecanismo **ya existe y es alcanzable** (medido en el hallazgo (B) del insumo); lo que falla hoy es
**discoverabilidad** («Ver piezas» no suena a «aquí edito/publico») y que el ciclo del sellado está **repartido
dentro de M1**, mezclado con singles/master set/gradeadas.

---

## 2. Censo de DIALES de pricing del sellado (para «tenerlos a la mano»)

Medido en `backend/src/modules/settings/settings.constants.ts` (`origin/production`). Cada dial dice **qué
hace**, su **seed**, **dónde se edita hoy** y **con qué permiso**.

### 2.A · Diales que HOY se editan por `PUT /admin/settings` (super_admin, auditado, sin redeploy)

| Dial (clave BD / camelCase) | Qué hace, en llano | Seed | Dónde se edita HOY |
|---|---|---|---|
| **`sealed_price_source`** / `sealedPriceSource` (`:118`, DTO map `:1084`, valores `tcgcsv\|off` `:511`) | **El interruptor maestro del mercado del sellado.** Enciende/apaga la ingesta de la referencia de mercado del sellado vía TCGCSV (`sealed-price-ingest`). Es el `sourceOn` de `gateSealedMarketCents` (`pricing.service.ts:1763`): apagado ⇒ el sellado sale **«SIN PRECIO DE MERCADO»** y sólo queda el precio manual money-safe. **Fail-closed** (seed `off`). | `off` (`:349`) | ⚠️ **No tiene control en pantalla hoy.** Está en el DTO map (editable por `PUT /admin/settings`) pero **no aparece en la lista de diales de M10** (`M10View.tsx:83-104`) ni ninguna llamada `updateSettings` lo envía (sólo el patch genérico de M10 y el `priceProvider`). Hoy sólo se puede mover por API/`curl`. **[MEDIDO: sin editor de UI en `origin/production`]** |
| **`pricing_provider_sealed`** / `pricingProviderSealed` (`:106`, DTO map `:1080`) | Proveedor de precio **por-carta** del sellado (familia `pricing_provider_*`). | `pokemonpricetracker` (`:319`) | **M10** (`M10View.tsx:96`, tipo `provider`). |
| **`sealed_value_trend`** / `sealedValueTrend` (`:144`, DTO map `:1087`) | Feature flag del endpoint de **tendencia de valor** del sellado (§2-S). Con `off`, el endpoint responde `404 FEATURE_DISABLED`. | `off` (`:386`) | Editable por `PUT /admin/settings`; **no dibujado** en la lista de diales de M10 hoy. |
| **`sealed_restock_alerts`** / `sealedRestockAlerts` (`:145`, DTO map `:1088`) | Feature flag de las **alertas de reabasto** del sellado. | `off` (`:387`) | Igual que el anterior: editable por API, **no dibujado** en M10 hoy. |

### 2.B · Diales que HOY se editan SÓLO por el recurso dedicado `GET/PUT /admin/pricing/sealed-spreads` (NO por `PUT /admin/settings`)

| Dial | Qué hace, en llano | Seed | Dónde se edita HOY |
|---|---|---|---|
| **`sealed_spread_pct_by_subtype`** (`:139`) | **Markup de VENTA del sellado por presentación** (por `SealedSubtype`): un % ARRIBA del mercado, no un % de la referencia. Alimenta `computeSealedSalePrice` (`money.ts:313`, precedencia override>0 > mercado×spread > `PRICE_PENDING`). | Sembrado en `:374` | **M2** → `SealedSpreadsSection.tsx`. |
| **`sealed_spread_fallback_pct`** (`:140`) | Markup de venta **global de respaldo** cuando una presentación no tiene su propio spread. | `25` (`:383`) | **M2** → `SealedSpreadsSection.tsx`. |

### 2.C · Lo que NO es un dial del sellado (para no meterlo por error)

- **`price_provider`** / `priceProvider` (`:112`, seed `tcgcsv_singles` `:341`): proveedor de la **ingesta
  masiva** de precios (barrido diario), sobre todo de **singles**. Sellado y singles resuelven el grupo TCGCSV
  por **caminos distintos** (refutación medida en P-72/P-46 del insumo), así que **no** es un dial del sellado.
  Se edita en M10 (`M10View.tsx:169-178`).
- **Piso / guardarraíl `premium_at_floor`** (`pricing-curve.ts:111` `floorCents:2500`, `:566`): pertenecen a la
  **curva de precios** (singles), y **el sellado NO usa la curva** — es un mecanismo independiente
  (`settings.constants.ts:135`). **No** es un dial del sellado.

> **Conclusión del censo:** los diales de pricing del sellado son **seis** (2.A: cuatro; 2.B: dos), repartidos
> hoy entre **M2** (spreads) y **M10** (proveedor per-carta), y **uno de ellos —el interruptor maestro
> `sealed_price_source`— no tiene control en pantalla en absoluto.** **NO propongo diales nuevos:** la pantalla
> reúne y expone los que ya existen.

---

## 3. Alcance propuesto de `M-Sellado`

**Número de M propuesto: `M11` (ruta `/admin/m11`).** Las M ocupadas hoy son `m1`–`m10`
(`frontend/src/app/[locale]/(admin)/admin/`), así que **`m11` es el primer número libre**. (Alternativa a
decidir por el dueño: ruta con nombre, `/admin/sellado`, como sugería la Opción 1 del insumo. Ver §5, decisión
D-1.)

La pantalla tiene **cuatro secciones**. Para cada una: qué reúsa de lo existente y qué es nuevo.

### Sección (i) — Alta de sellado
- **Qué:** dar de alta producto sellado (compra o aportación), con formato/subtipo y precio.
- **Reúsa:** `SealedAddFlow` y `QuickAdd` **tal cual** (ya existen en M1). Incluye ya el arreglo del insumo (el
  CTA deshabilitado explica que falta el precio de compra) y el subtipo en el encabezado del drawer.
- **Nuevo:** sólo **ubicación/visibilidad** — que «Agregar producto sellado» sea el CTA primario de esta
  pantalla, no un botón escondido.

### Sección (ii) — Inventario de sellado (la ventana de publicación)
- **Qué:** listado del sellado en stock con, por pieza: **editar precio**, **publicar**, **despublicar**,
  **formato/subtipo** y **precio**.
- **Reúsa:** `VariantDrawer` con `productType:'sealed'` (editar/publicar/despublicar ya cableados,
  `VariantDrawer.tsx:419-431,555-604`) y `SealedTab` (agrupa por subtipo).
- **Nuevo:** **rótulo/affordance** — que la acción de editar/publicar/despublicar **se lea como tal** (hoy vive
  tras «Ver piezas», que se lee como «sólo mirar»). Es el hallazgo (B)/(E) del insumo. **Sin lógica de dinero
  nueva.**

### Sección (iii) — Cola «Listas para publicar» (filtrada a sellado)
- **Qué:** la cola de piezas de sellado listas para publicar, con su motivo (`missing:['price']`, etc.).
- **Reúsa:** `PendingPublishQueue` (ya ramifica y pinta sellado, `PendingPublishQueue.tsx:65-89`).
- **Nuevo:** **filtro/vista de sellado** dentro de esta pantalla. *(Mostrar el `sealedSubtype` en la fila de la
  cola requeriría cambio de contrato + proyección backend — regla 9, arquitecto — y por eso queda **fuera del
  alcance mínimo**; ver §5, decisión D-5.)*

### Sección (iv) — Panel de diales de pricing del sellado (§2)
- **Qué:** los seis diales del §2 **a la mano**, en un panel dedicado del sellado.
- **Reúsa:** los editores/endpoints que **ya existen** — `SealedSpreadsSection` (spreads, 2.B) y el patrón de
  diales de M10 (2.A). La pantalla los **reúne**, no los reimplementa.
- **Nuevo (a decidir, D-2/D-3):** (a) si el panel **edita** los diales aquí o sólo los **muestra** con enlace a
  M2/M10; (b) muy en particular, dar por fin un **control en pantalla al interruptor maestro
  `sealed_price_source`**, que hoy no lo tiene (§2.A). Ese control, si se acepta, **reúsa la vía existente**
  (`PUT /admin/settings { sealedPriceSource }`, super_admin, auditado) — no inventa mecanismo.

---

## 4. «Respetar todo el tema de pricing»: qué M-Sellado NO debe hacer

La pantalla **expone y opera** lo que ya existe; **no cambia ninguna regla de precio**. Explícitamente, **NO
debe**:

1. **No copiar un precio de un acabado/fuente a otro.** Regla dura del proyecto; el paso 1 vs paso 2 del insumo
   (P-69) ya mordió por esto. El panel muestra el **mercado autoritativo** (`effectiveMarketCents`, ya gateado),
   nunca el informativo `marketRef` como número principal.
2. **No alterar el gate de fuente.** `gateSealedMarketCents(ref, sourceOn)` (`pricing.service.ts:1763`) manda:
   sin `ref` o con el dial apagado ⇒ `null` ⇒ **«SIN PRECIO DE MERCADO»**. La pantalla puede **mover el dial**
   (por la vía auditada), pero **no puede fabricar un precio** cuando el gate dice `null`.
3. **No permitir precio manual por debajo de `vault_operator+`,** y **jamás valuar en $0**: el alta de
   aportación sin referencia sigue respondiendo `422 PRICE_PENDING` (money-safe, `inventory.service.ts:729-761`).
   La pantalla no relaja esa puerta.
4. **No saltarse la auditoría.** El override manual y cualquier cambio de dial siguen **auditados**; encender
   `sealed_price_source` es un **acto de dinero** (arranca ingesta/escritura de precios), no un ajuste de
   vitrina, y conserva su aviso y su permiso super_admin.
5. **No fusionar el spread del sellado con la curva de precios.** Son mecanismos independientes
   (`settings.constants.ts:135`); el spread es markup ARRIBA de mercado por subtipo, no interpolación de curva.
6. **No cambiar la precedencia de venta** `override>0 > mercado×spread > PRICE_PENDING` (`money.ts:313`); la
   pantalla sólo edita los insumos (spreads, override manual auditado), nunca la fórmula.

---

## 5. Riesgos y decisiones que el dueño debe tomar

- **D-1 · Número/ruta.** Propongo **`M11` / `/admin/m11`** (primer número libre). ¿Lo dejamos así, o prefieres
  una ruta con nombre **`/admin/sellado`** (más legible, pero rompe la convención `mN` del resto del admin)?
- **D-2 · ¿Los diales se editan aquí o sólo se ven?** Editarlos aquí evita saltar a M2/M10, pero **duplica el
  editor de un dial de dinero** en dos pantallas (riesgo de divergencia, ya visto con `fxBufferPct`). Alternativa
  money-safe: **M-Sellado los MUESTRA** (valor + estado, a la mano) y el editar es **un enlace** a M2 (spreads) /
  M10 (diales de settings). **Recomendación PO:** mostrar todo aquí; editar sólo el interruptor maestro
  `sealed_price_source` (que hoy no tiene UI en ningún lado) y **enlazar** a M2/M10 para el resto, para no
  duplicar editores de dinero.
- **D-3 · El interruptor maestro `sealed_price_source` no tiene control en pantalla hoy** (§2.A, **MEDIDO**).
  ¿Le damos su control en M-Sellado (por la vía auditada `PUT /admin/settings`, super_admin)? Es la pieza que más
  «pone a la mano» la ventana de publicación, porque decide si el sellado tiene mercado automático o no.
- **D-4 · Permisos.** Los diales de sellado (M2 spreads, M10 settings) son **super_admin only** hoy
  (`AdminSidebar.tsx:30,49`), pero la **operación de publicación** del sellado (M1) es de **`vault_operator+`**.
  M-Sellado cruza esa frontera. Opciones: (a) pantalla **super_admin only** (simple, pero le quita a los
  operadores el alta/publicación que hoy sí pueden hacer); (b) pantalla con **secciones por rol** — operadores
  ven (i)/(ii)/(iii); super_admin ve además el panel de diales (iv). **Recomendación PO:** opción (b), secciones
  por rol.
- **D-5 · ¿Sustituye la pestaña Sellado de M1 o convive?** Convivir duplica navegación y estado (riesgo de
  divergencia, ya señalado en la Opción 1 del insumo). Sustituir es más limpio pero es **más trabajo** (mover el
  ciclo entero + E2E nuevos) y hay que decidir qué pasa con quien tenga enlazada la pestaña vieja.
  **Recomendación PO:** M-Sellado **sustituye** el rol de la pestaña Sellado (el sellado vive en un solo sitio),
  y la pestaña de M1 se retira o redirige — a confirmar por el dueño.
- **D-6 · Alcance mínimo vs completo.**
  - **Mínimo (bajo riesgo, sin tocar dinero ni contrato):** (i) alta visible, (ii) inventario con rótulo claro
    de editar/publicar/despublicar, (iii) cola filtrada a sellado, (iv) panel que **muestra** los seis diales +
    control del interruptor maestro. Reúsa ~90% de lo existente.
  - **Completo:** además, editar todos los diales en la propia pantalla (D-2), `sealedSubtype` en la fila de la
    cola (requiere arquitecto, regla 9), y sustitución completa de la pestaña M1 (D-5). Más valor, más superficie
    y algún cambio de contrato.
- **Riesgo transversal:** esto es **zona de dinero** (`inventory`/`pricing`). Aunque M-Sellado sólo reubique y
  exponga, cualquier parte que **edite** un dial pasa por los tres veredictos (QA + techlead + seguridad) y, si
  toca contrato/DTO (D-5 completo), por el **arquitecto** primero.

---

## 6. Supuestos tomados (para que el dueño confirme o corrija)

- **(SUPUESTO)** «Ventana de publicación» = el ciclo alta → cola «Listas para publicar» → publicar / despublicar
  / editar precio (§1). No hay evidencia de que el dueño se refiera a una ventana **temporal** (fechas de
  publicación programada); **no la medí y no la asumo como alcance** — si eso era lo que quería, es una
  funcionalidad nueva a aterrizar aparte.
- **(SUPUESTO)** «Todo lo necesario» = las cuatro secciones del §3; no incluye reportes/analytics de sellado
  (P-67) ni las features aún apagadas (`sealed_value_trend`, `sealed_restock_alerts`) más allá de exponer su
  interruptor.
- **(SUPUESTO)** `M11` es aceptable como nombre; si el dueño prefiere `/admin/sellado`, es D-1.

---

## 7. Resumen en lenguaje llano (para el dueño)

- **Qué es M-Sellado:** una sola pantalla del admin donde vive **todo el sellado** — subirlo, editarle el
  precio, publicarlo y quitarlo de publicado, ver la cola de lo que está listo para publicar, y **a un lado**,
  los controles de precio del sellado.
- **Casi todo ya existe.** Subir, editar, publicar y despublicar sellado **ya funciona hoy**; el problema es que
  está **repartido dentro de M1** y escondido tras el botón «Ver piezas». M-Sellado lo junta en un sitio y le
  pone rótulos claros. Poco riesgo, porque **no inventamos lógica de dinero**.
- **Los controles de precio del sellado son seis** y hoy están en dos pantallas distintas (M2 y M10). Los
  traemos «a la mano» a esta pantalla. **Y hay uno —el interruptor maestro que decide si el sellado tiene precio
  de mercado automático— que hoy no tiene botón en ninguna pantalla: sólo se puede mover por comando.** Esta
  pantalla es el sitio natural para darle por fin ese botón.
- **Respetamos el dinero:** la pantalla **no cambia ninguna regla de precio**; sólo enseña y opera lo que ya
  existe (el precio manual auditado, el interruptor de fuente, los márgenes de venta). Nunca copia un precio de
  un acabado a otro, nunca valúa en $0, y encender la fuente de precios sigue siendo un acto auditado de
  super-admin.
- **Lo que necesito que decidas:** el número/nombre (M11 vs /admin/sellado), si los diales se **editan** aquí o
  sólo se **ven**, si M-Sellado **sustituye** la pestaña vieja de M1, quién entra (sólo super-admin, o operadores
  para publicar y super-admin para los diales) y si vamos por el alcance **mínimo** o el **completo** (§5).

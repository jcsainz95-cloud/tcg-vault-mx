# M11 · Rediseño UX del Sellado — BORRADOR para aprobación del dueño

> Propiedad: **ux-ui**. Estado: **BORRADOR** (2026-09-17). Este documento **no** cambia el motor de
> precios ni el contrato: reordena y renombra la **presentación** de superficie que YA existe. Cuando
> el dueño apruebe el esquema, se pliega en `docs/DESIGN_SYSTEM.md` (§M11) y el frontend lo construye.
> No es código; no toca `backend/` ni `frontend/src`.

---

## 0. El problema, en una frase

M11 funciona pero **está ordenada por cómo se construyó, no por cómo se usa**. Hoy la pantalla mezcla,
al mismo nivel, el trabajo diario del operario (subir producto, editar precio) con la plomería de
súper-admin (interruptores, proveedores, spreads, mapeo de grupos TCGCSV). El resultado: el propio
dueño se pierde, y delegar es imposible.

**El norte de este rediseño:** que el 95% del tiempo el usuario vea **una sola cosa clara** —el
inventario y un botón— y que **toda la plomería viva plegada** en «Ajustes avanzados», visible solo
cuando de verdad hace falta tocarla.

---

## 1. El modelo mental correcto (las tres capas)

| Capa | Qué es | Quién la usa | Visibilidad por defecto |
|---|---|---|---|
| **1 · Inventario** | Subir/dar de alta producto sellado; en lo publicado, **editar precio** y **despublicar**. | Operario (día a día) | **Primario, arriba, siempre** |
| **2 · Un botón** | «**Actualizar precios de la colección**»: hace TODO lo necesario y responde en lenguaje llano. | Dueño / responsable | **Primario, un clic** |
| **3 · Ajustes avanzados** | Proveedores, tendencia, alertas, márgenes (spreads) y el arreglo de un set sin precio. | Súper-admin, rara vez | **Plegado**; se abre a propósito |

---

## 2. Wireframe de la pantalla nueva (en texto)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Sellado                                                               │  ← título llano (ya no "M11 · Sellado")
│  Sube producto, ponle precio y publícalo. Aquí también actualizas      │  ← subtítulo en llano
│  los precios de mercado de toda la colección.                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ▍ 1 · INVENTARIO DE SELLADO                          [ + Dar de alta ] │  ← PRIMARIO (SealedTab)
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  (buscador / agrupado por presentación — SealedTab tal cual)     │   │
│  │  Cada fila publicada → abre detalle: editar precio · despublicar │   │  ← VariantDrawer
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ▍ Listas para publicar (sellado)                                      │  ← PRIMARIO (PendingPublishQueue)
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  Piezas ya adquiridas que aún no están a la venta y qué les falta │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ▍ 2 · PRECIOS DE MERCADO DE LA COLECCIÓN                              │  ← PRIMARIO (nuevo envoltorio)
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  Última actualización: hace 2 h · 12 sets con precio, 1 sin      │   │  ← resumen en llano (estado §10)
│  │  precio                                                          │   │
│  │                                                                  │   │
│  │        [  ⟳  Actualizar precios de la colección  ]               │   │  ← EL BOTÓN ÚNICO
│  │                                                                  │   │
│  │  ─ tras pulsar ─                                                 │   │
│  │  ✓ Listo: 12 sets con precio · 1 set sin precio                  │   │  ← resultado en llano
│  │                                                                  │   │
│  │  ⚠ 1 set no trae precio:                                         │   │  ← CONDICIONAL (solo si hay sets sin precio)
│  │     • Paldea Evolved …………………… [ Arreglar este set ]           │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ▸ 3 · Ajustes avanzados (precios de mercado)          [súper-admin]   │  ← PLEGADO (collapsed por defecto)
│    · Fuente automática de mercado (encender/apagar)                    │
│    · Proveedor de referencia, tendencia de valor, alertas de reposición│
│    · Márgenes de venta por presentación (spreads)                      │
│    · Emparejar sets con TCGCSV a mano                                  │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

**Cambios de orden respecto a hoy (medido en `M11View.tsx`, HEAD `02ef90cd`):**

1. **Inventario + cola** suben juntos y quedan de PRIMEROS (hoy la cola está separada por la sección de
   estado en medio).
2. **«Estado de precio por set»** (hoy una sección independiente con tabla y buscador, §10) **deja de
   ser una sección aparte**: se funde dentro del bloque «Precios de mercado de la colección» como el
   **resumen + resultado del botón**. La tabla completa por-set pasa a ser un detalle **plegado**
   («Ver desglose por set») para quien quiera auditar; el usuario normal solo ve el resumen y la lista
   de sets a arreglar.
3. **Los tres bloques de diales** (fuente automática + traer precios · settings proveedor/tendencia/
   alertas · spreads) se **funden en un solo acordeón «Ajustes avanzados»**. Ahí se resuelven los
   **«dos apartados de diales que no sé qué hacen»**: cada subsección lleva un rótulo llano y una línea
   de «para qué sirve / cuándo lo tocas».
4. El botón **«Traer precios ahora»** deja de vivir enterrado junto al interruptor maestro y sube a ser
   **el botón único primario** del bloque 2.

---

## 3. El botón único: «Actualizar precios de la colección»

**Qué hace, en un clic (el usuario no ve los pasos):**

1. Si la **fuente automática de mercado** (`sealed_price_source`) está apagada, **la enciende** — con
   una confirmación llana la PRIMERA vez que hace falta (ver §3.1). Reúsa `PUT /admin/settings`
   (`{ sealedPriceSource: 'tcgcsv' }`).
2. **Trae los precios** (`POST /admin/jobs/sealed-price-ingest`). El job es *awaited*: cuando responde,
   la corrida ya terminó.
3. **Relee el estado** (`GET /admin/inventory/sealed-price-status`) y **muestra el resultado en
   lenguaje llano**.

**Estados del botón (todos con copy llano, cero jerga):**

| Estado | Qué ve el usuario |
|---|---|
| Reposo | `⟳ Actualizar precios de la colección` + «Última actualización: hace 2 h» |
| Trabajando | botón en *loading*: «Actualizando precios…» |
| Listo | banner éxito: «**Listo: 12 sets con precio · 1 set sin precio**» |
| Ya en curso | banner info: «Ya hay una actualización en marcha; espera a que termine.» (mapea `enqueued:false` sin `reason`) |
| Error de red | banner de error con reintentar (copy de operador, no traza técnica) |

**Lo que desaparece del frente:** el rótulo «interruptor maestro», la palabra `sealed_price_source`, y
el estado crudo «Encendida/Apagada». El encendido pasa a ser una consecuencia del botón, no una
decisión que el usuario tiene que entender primero.

### 3.1 La confirmación de dinero (se conserva, pero en llano)

Encender la fuente automática es un **acto de dinero auditado** (invariante I-7 del motor: encender/
apagar queda en bitácora; apagar NO borra precios manuales). No se puede eliminar la confirmación, pero
sí decirla en llano y **solo cuando el botón necesita encender la fuente**:

> **Vamos a activar los precios automáticos de mercado**
> A partir de ahora los sellados con referencia resuelta tomarán precio de mercado (× tu margen). Es una
> decisión de dinero y queda registrada a tu nombre.
> `[ Cancelar ]  [ Activar y actualizar ]`

Si la fuente **ya está encendida**, el botón **no pregunta nada**: solo trae precios. Así el día a día es
un clic; la confirmación aparece a lo sumo una vez.

### 3.2 El resultado en lenguaje llano — DECISIÓN ABIERTA (ver §6, D-1)

El dueño pidió textual: «*12 sets actualizados, 1 sin precio*». **Medido** (`contract.ts:2166-2181`): la
respuesta del job de ingesta **NO trae conteos** (`priced`/`unmatched`) por diseño; los conteos se leen
releyendo el estado por-set (`GET .../sealed-price-status`, que sí trae `priced`/`mappedUnpriced`/
`unmapped` por set).

Por tanto, sin tocar backend, el resultado honesto que podemos pintar es una **foto del estado actual**
tras la corrida, no un *delta* de «cuántos cambiaron ahora mismo»:

- **Opción A (sin cambio de backend, recomendada para v1):** «**12 sets con precio · 1 sin precio**»
  (foto del total tras actualizar). Es verdad, es llana, y no promete un delta que no medimos.
- **Opción B (requiere backend, vía arquitecto):** que la ingesta devuelva conteos de la corrida
  (`actualizados` / `sin precio`), para poder decir literal «12 sets actualizados». Es la frase exacta
  del dueño, pero abre una segunda fuente para un mismo hecho y un cambio de contrato.

Recomiendo **A** para no bloquear el rediseño; si el dueño quiere la palabra «actualizados», se enruta B
al arquitecto. En ambos casos el copy evita jerga.

---

## 4. El arreglo de un set sin precio (antes: «pop-up que no entiendo»)

**Hoy:** cualquier fila de «Estado de precio por set» ofrece «Emparejar grupo / Corregir grupo», y el
pop-up habla de «Mapeo manual del grupo TCGCSV (set_main)», «ID de grupo TCGCSV», «groupId de
TCGplayer». Es plomería expuesta como tarea diaria.

**Rediseño — el arreglo aparece SOLO cuando un set no trae precio, y se presenta como «arreglar», no
como plomería:**

1. **Dónde aparece:** en el bloque 2, bajo el resultado del botón, como una lista corta **solo de los
   sets que quedaron sin precio** (`state === 'unmapped'` o `mapped_unpriced`). Un set con precio no
   muestra ningún botón de plomería. Adiós a la tabla con acción en cada fila.
2. **Qué dice cada fila:** el nombre del set + un motivo en llano (ya existe `reason`, solo se
   re-redacta el copy) + un botón **«Arreglar este set»**.
   - `no_group` → «Este set aún no está conectado a la fuente de precios.»
   - `no_source_price` → «Conectado, pero la fuente no trajo precio esta vez.»
   - `dial_off` → (no debería verse tras el botón, porque el botón enciende la fuente; si aparece,
     «La fuente automática está apagada».)
3. **El pop-up re-redactado** (reúsa `SealedSetMappingModal`, `PUT .../set-main-group` y
   `DELETE .../groups/:groupId` tal cual; solo cambian los rótulos):

   > **Arreglar el precio de: Paldea Evolved**
   > Este set no está conectado con la fuente de precios (TCGplayer). Pega el **código del set en
   > TCGplayer** para conectarlo. *(¿Dónde encuentro el código? → nota de ayuda plegable.)*
   > `Código del set:  [__________]`   `Motivo (opcional):  [__________]`
   > `[ Cancelar ]  [ Conectar y actualizar ]`
   > ── *Si ya estaba conectado a un grupo equivocado:* `[ Desconectar ]`

   - «ID de grupo TCGCSV (set_main)» → «**Código del set en TCGplayer**».
   - «Fijar grupo principal» → «**Conectar y actualizar**» (y tras conectar, dispara la actualización
     de ese set — decisión abierta D-3, ver §6).
   - «Desenlazar grupo actual» → «**Desconectar**», solo visible si ya había uno.
   - Se conserva el campo «Motivo (queda en bitácora)» tal cual (es auditoría, no plomería).

Este arreglo sigue siendo **solo súper-admin** (el backend 403ea igualmente). El operario ve la lista de
sets sin precio como información, pero el botón «Arreglar este set» solo lo ve/usa el súper-admin.

---

## 5. «Ajustes avanzados»: qué va dentro y con qué rótulos

Un solo acordeón **plegado por defecto**, súper-admin, con tres subsecciones, cada una con una línea de
«para qué sirve». Reúsa `SealedDialsPanel` y `SealedSpreadsSection` **sin tocar su lógica**; solo se
reagrupan y re-rotulan.

### 5.1 Fuente automática de mercado
- **Para qué:** encender o apagar de dónde salen los precios de mercado. Normalmente no lo tocas: el
  botón «Actualizar precios» ya la enciende cuando hace falta.
- Contenido: el interruptor `sealed_price_source` (encender/apagar) con su confirmación money-global
  (§3.1). Aquí **sí** se puede APAGAR (fuera del botón; apagar no es una acción del día a día).
- Copy de apagar conserva I-7: «Los precios que fijaste a mano NO se borran; solo se detiene el mercado
  automático.»

### 5.2 Cómo se calculan los precios
- **Para qué:** de qué proveedor sale la referencia por carta, si se muestra la tendencia de valor y si
  se avisan reposiciones. Se cambia sin redeploy.
- Contenido: los tres selects de `SealedDialsPanel` (`pricingProviderSealed`, `sealedValueTrend`,
  `sealedRestockAlerts`) con su «Guardar N cambio(s)».

### 5.3 Márgenes de venta (spreads)
- **Para qué:** cuánto le sumas al precio de mercado para vender cada presentación. Un margen 0% vende
  sin ganancia (se avisa).
- Contenido: `SealedSpreadsSection` tal cual (conserva sus tres estados por llave y sus avisos money-safe;
  esa lógica es correcta y no se toca).

> **Esto resuelve «hay dos apartados de diales y no sé qué hace cada uno»:** hoy 5.2 y 5.3 son dos cajas
> con aspecto de diales sin explicar. Con un rótulo llano y una línea de propósito por subsección, cada
> una dice qué hace y cuándo la tocas — y las tres viven plegadas, no compitiendo con el trabajo diario.

---

## 6. Decisiones que el dueño debe confirmar

| # | Decisión | Recomendación ux-ui |
|---|---|---|
| **D-1** | Resultado del botón: **A** «12 sets con precio · 1 sin precio» (foto, sin backend) o **B** «12 actualizados» (delta, requiere backend). | **A** para v1; B solo si insistes en la palabra «actualizados» (lo enruto al arquitecto). |
| **D-2** | ¿El botón «Actualizar precios» lo puede usar el **operario** (vault_operator), o queda **solo súper-admin**? Hoy la ingesta y el interruptor son solo súper-admin (el backend 403ea). | Mantener **súper-admin** (es acto de dinero). El operario hace inventario; delegar precios se decide aparte. Si quieres que el operario lo dispare, es cambio de permiso vía arquitecto. |
| **D-3** | Tras «Conectar» un set en el arreglo, ¿disparo **de una vez** la actualización de ese set, o el usuario vuelve a pulsar el botón grande? | **Disparar de una vez** (menos pasos, es lo que el dueño espera). Verificar que el job acepta alcance por set (`scope`/`groupId` existen en el DTO; medir con backend). |
| **D-4** | Nombre del bloque 2: «**Precios de mercado de la colección**» vs. «Actualizar precios». | «Precios de mercado de la colección» como título; el botón lleva el verbo. |
| **D-5** | ¿Ocultar del todo la **tabla completa por-set** (dejarla solo como «Ver desglose» plegado), o mantenerla visible para quien audita a diario? | Plegar por defecto; el resumen + lista de sets a arreglar cubre el día a día. |
| **D-6** | Título de la pantalla: «**Sellado**» en llano vs. conservar «M11 · Sellado». | «Sellado». El código «M11» no le dice nada a quien delega. |

---

## 7. Superficie reutilizada (no se pide nada nuevo al backend salvo D-1/B y D-3)

**Componentes (se reagrupan/re-rotulan, no se reimplementan):**
- `frontend/src/app/[locale]/(admin)/admin/m11/M11View.tsx` — nuevo orden de secciones.
- `.../m11/sections/SealedPriceStatusSection.tsx` — se transforma en el resumen + resultado + lista de
  sets a arreglar del bloque 2 (la tabla completa pasa a «Ver desglose» plegable).
- `.../m11/sections/SealedDialsPanel.tsx` — su interruptor+ingesta alimentan el botón único (bloque 2);
  el resto (interruptor apagar, settings) baja a «Ajustes avanzados» 5.1/5.2.
- `.../m11/sections/SealedSpreadsSection.tsx` — a «Ajustes avanzados» 5.3, sin cambios de lógica.
- `.../m11/sections/SealedSetMappingModal.tsx` — el pop-up «Arreglar este set», solo re-rotulado.
- Reusados de M1: `SealedTab`, `VariantDrawer`, `PendingPublishQueue` (bloque 1).

**Endpoints (todos ya existen):**
- `GET /admin/inventory/sealed-price-status` (`vault_operator+`, read-only) — resumen y lista a arreglar.
- `POST /admin/jobs/sealed-price-ingest` (`super_admin`, 202, awaited) — el botón.
- `PUT /admin/inventory/sealed-sets/:setId/set-main-group` (`super_admin`) — «Conectar».
- `DELETE /admin/inventory/sealed-sets/:setId/groups/:groupId` (`super_admin`) — «Desconectar».
- `GET`/`PUT /admin/settings` (parcial) — fuente automática y diales de settings.
- `GET`/`PUT` de spreads del sellado — márgenes de venta.

**Peticiones al arquitecto (solo si el dueño elige la opción):**
- **D-1 opción B:** que `POST /admin/jobs/sealed-price-ingest` devuelva conteos de la corrida
  (`priced`/`unmatched`) para el copy «actualizados». (Contra: hoy es *awaited* sin conteos por diseño.)
- **D-3:** confirmar que la ingesta acepta alcance por set para disparar solo el set recién conectado.

---

## 8. Tabla de rótulos llanos (es / en) — para el frontend

| Hoy (clave i18n) | Nuevo · es | Nuevo · en |
|---|---|---|
| `admin.m11.title` "M11 · Sellado" | **Sellado** | **Sealed** |
| `admin.m11.subtitle` | Sube producto, ponle precio y publícalo. Aquí también actualizas los precios de mercado de toda la colección. | Add stock, price it and publish it. This is also where you refresh the whole collection's market prices. |
| `admin.m11.dials.title` "Diales de precio del sellado" | **Ajustes avanzados (precios de mercado)** | **Advanced settings (market prices)** |
| `dialsPanel.master.title` "Fuente automática de mercado…" | (bloque 2) **Precios de mercado de la colección** | **Collection market prices** |
| `dialsPanel.ingest.cta` "Traer precios ahora" | **Actualizar precios de la colección** | **Refresh collection prices** |
| `dialsPanel.master.title` (dentro de avanzados) | **Fuente automática de mercado** · *Normalmente no lo tocas.* | **Automatic market source** · *You rarely touch this.* |
| `dialsPanel.settings.title` "Diales de settings del sellado" | **Cómo se calculan los precios** | **How prices are calculated** |
| `admin.m2.sealedSpreads.title` | **Márgenes de venta** | **Sale margins** |
| `status.title` "Estado de precio por set" | (fundido) **Sets sin precio** *(solo la lista a arreglar)* / **Ver desglose por set** *(plegado)* | **Sets without a price** / **See per-set breakdown** |
| `status.state.unmapped` "SIN emparejar" | **Sin conectar a la fuente** | **Not connected to the source** |
| `status.mapCta` "Emparejar grupo" | **Arreglar este set** | **Fix this set** |
| `mapping.title` "Mapeo manual del grupo TCGCSV" | **Arreglar el precio de: {set}** | **Fix the price for: {set}** |
| `mapping.groupIdLabel` "ID de grupo TCGCSV (set_main)" | **Código del set en TCGplayer** | **Set's TCGplayer code** |
| `mapping.setMainCta` "Fijar grupo principal" | **Conectar y actualizar** | **Connect and refresh** |
| `mapping.unlinkCta` "Desenlazar grupo actual" | **Desconectar** | **Disconnect** |

> El copy final es responsabilidad del frontend con su control de paridad es/en; esta tabla fija la
> intención y el registro (llano, sin jerga TCGCSV/set_main/dial en el frente).

---

## 9. Qué NO cambia (para tranquilidad de todos los roles)

- **El motor de precios, los invariantes de dinero (I-2/I-6/I-7), la auditoría y los endpoints**: intactos.
  Esto es reordenar y re-rotular presentación.
- **Los permisos de backend**: intactos (ingesta/interruptor/mapeo siguen 403 para no-súper-admin). El
  gateo en el frente sigue con `SuperAdminOnly`.
- **La lógica de spreads (tres estados por llave, avisos money-safe)**: intacta; solo se reubica.
- **La ruta** `vault_operator+`: intacta; el operario sigue usando inventario/cola sin candado.

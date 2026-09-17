# SELLADO M1 — Diagnóstico medido (S3-SELLADO-M1)

- **Rama:** `claude/investiga-sellado-m1`, basada en `origin/production` (`187b1d40`).
- **Medido:** 2026-09-17, por el agente backend+frontend investigador, sobre el árbol de `origin/production`.
- **Método:** lectura de código con `fichero:línea` verificado a mano + pruebas de componente (vitest/RTL)
  ejecutadas en local. El stack nativo completo (Postgres+Redis+S3+Nest+Next) **NO** se levantó (egress a
  prod/tcgcsv/Railway bloqueado por política, y `node_modules` ausentes al inicio); dónde una afirmación
  dependía del backend vivo se marca **[no medido por HTTP]** y se sostiene con el código + los specs
  existentes.
- ⛔ **Zona de dinero** (`inventory`/`vault`): sólo se arregló display/cableado con su prueba; todo lo que
  toca lógica de precio/valuación queda como **PROPUESTA para los tres veredictos**.

> **Aviso O-5/O-1:** el contexto del encargo describía el ítem como si varias cosas estuvieran rotas. Varias
> **ya no lo están en `origin/production`** (el árbol evolucionó desde el diagnóstico de P-79 sobre `c8bee65`).
> Gana lo que se midió, y se dice abajo.

---

## (A) «Agregué un booster bundle y no sale» — CAUSA MEDIDA

**Causa raíz: el alta nunca se envió. El botón «Dar de alta al inventario» estaba deshabilitado en
silencio.**

El estado exacto del dueño (según el encargo): producto **«SIN PRECIO DE MERCADO»**, radio **«Comprar»**
seleccionado, **«PRECIO PAGADO (MXN)» vacío**. En ese estado, medido en `frontend/.../m1/QuickAdd.tsx`:

1. Sin mercado ⇒ `contribBlocked = marketRefCents == null` ⇒ **la radio «Aportación» se deshabilita**
   (`QuickAdd.tsx:100,319`). El único camino posible es «Comprar».
2. «Comprar» con precio vacío ⇒ `priceCents = null` ⇒ `priceInvalid = true` (`QuickAdd.tsx:107-108`).
3. El CTA se deshabilita: `disabled={submit.isPending || (path === 'compra' && priceInvalid)}`
   (`QuickAdd.tsx:351`).
4. **El motivo NO era visible:** el mensaje de precio obligatorio sólo se pintaba cuando el campo tenía
   texto — `price.trim() !== ''` (`QuickAdd.tsx:295`). Con el campo pristino/vacío no salía nada: botón gris,
   sin explicación. El dueño lo vive como «lo agregué y no sale».

**No hay 422 ni 200 en este caso: no se dispara ningún POST** (el `batchCreateItems` está detrás del CTA
deshabilitado). Verificado con prueba nueva (`QuickAdd.test.tsx`, caso *SELLADO-M1(A)*): con `marketRefCents=null`
+ compra + precio vacío, el CTA está `disabled` y `batchCreateItems` **no** se llama.

**El otro camino, para contraste — compra CON precio pagado válido:** el front sí hace
`POST /admin/inventory/items/batch`. El backend crea la pieza en estado **`in_stock`**
(`inventory.service.ts:614-631`, movimiento `alta` → `toStatus: 'in_stock'`), **sin** lanzar `PRICE_PENDING`
(el `PRICE_PENDING` sólo aplica a *aportación sin mercado*, `inventory.service.ts:749-767`). Como el sellado
nace sin `listPriceCents`, `sealedNeedsEscalate = true` (`inventory.service.ts:772`) ⇒ la pieza además cae en
la cola **«Listas para publicar»** con `missing: ['price']`. Es decir: **con precio de compra, el bundle SÍ
aparece** — en el detalle del set (conteo `in_stock`) y en la cola de publicación. `refreshAfterAdd`
invalida `['sealed-sets']` y `['sealed-set-detail']` tras el alta (`SealedTab.tsx:64-67`), así que la lista se
refresca sola. **[la respuesta HTTP 200/estado se infiere de código + specs, no de un HTTP vivo]**

> **Trampa de diseño (no bug, pero es lo que atrapa al dueño):** un sellado sin mercado **obliga** a usar
> «Comprar» con un precio pagado tecleado a mano; si lo deja vacío, se queda sin ningún camino y sin aviso.
> El precio de compra es dinero real y su exigencia es correcta — lo que estaba mal era el **silencio**.

**Arreglado (display-only, seguro):** el CTA deshabilitado ahora **dice por qué** — un aviso
«Captura un precio mayor a cero.» bajo el botón cuando `path==='compra' && priceInvalid`
(`QuickAdd.tsx`, tras el CTA). No cambia validación ni payload; reusa copy existente
(`admin.quickAdd.buy.priceRequired`, presente en es y en). Prueba: *SELLADO-M1(A)* (falla si se revierte).

---

## (B) «No hay dónde EDITAR / QUITAR DE PUBLICADO el sellado desde la pestaña Sellado»

**Medido: el mecanismo SÍ es alcanzable desde la pestaña Sellado, pero detrás de un botón rotulado
«Ver piezas».**

- Pestaña Sellado → set → cada grupo tiene «Alta rápida», **«Ver piezas»** y «Publicar»
  (`SealedTab.tsx:346-367`; label `viewPieces = "Ver piezas"`).
- «Ver piezas» ⇒ `onOpenGroup` ⇒ `openSealedGroup` abre el **`VariantDrawer`** con `productType: 'sealed'`
  (`M1View.tsx:210-221, 336, 349-360`).
- El `VariantDrawer` trae, por pieza: **editar precio** (`updateInventoryItem(id,{listPriceCents})`,
  `VariantDrawer.tsx:424-431`, botón `:555-570`), **publicar** (`:593-604`) y **DESPUBLICAR**
  (`unpublish` ⇒ `updateInventoryItem(id,{status:'in_stock'})`, `VariantDrawer.tsx:419-422`, botón `:582-591`,
  visible sólo si la pieza está `listed`), y merma.

Es decir, `PATCH /admin/inventory/items/:id` (editar/despublicar) **está cableado y se alcanza** desde la
vista de sellado. Lo que falla es la **discoverabilidad**: «Ver piezas» se lee como «sólo mirar», no como «aquí
edito/despublico». **No es un mecanismo faltante — es rótulo/afford​ance.** No lo toqué (es criterio de UX, no
un passthrough trivial); queda como nota para ux-ui/product-owner. *(Ver propuesta (E).)*

---

## (C) «Tras el alta se pierde el desglose de FORMATO/subtipo (Bundle/Booster Box…)»

**Medido: el subtipo NO se pierde en los datos ni en el detalle del set; se perdía en el encabezado del
drill-down y no viaja a la cola de publicación.**

- **Dónde SÍ se ve:** el detalle del set agrupa por subtipo y lo pinta
  (`SealedTab.tsx:284-285` groupKey incluye `sealedSubtype`; `:321-324` pinta el pill del subtipo). El alta lo
  captura y lo envía (`SealedAddFlow.tsx:405`, `QuickAdd.tsx:129`), y el backend lo persiste
  (`inventory.service.ts:782`).
- **Dónde NO se veía (arreglado):** el encabezado del `VariantDrawer` pintaba `'SELLADO'` a secas
  (`VariantDrawer.tsx:158-165`), aunque `props.sealedSubtype` ya llega al componente (`M1View.tsx:217`).
- **Dónde NO se ve (queda para gates):** la cola **«Listas para publicar»** — `PendingPublishRowDTO` **no
  lleva** `sealedSubtype` (`frontend/src/types/contract.ts:2741-2766`). Mostrar el subtipo ahí exige **cambio
  de contrato + proyección backend** (regla 9 → arquitecto). No es passthrough trivial. `PieceCell` ya
  ramifica sellado y pinta nombre + «SELLADO» pero sin subtipo (`PendingPublishQueue.tsx:65-89`).

> **Refutación medida a una premisa del contexto:** P-79(c) («la cola de M1 no sabe pintar sellado») **ya está
> arreglado en `origin/production`**: `PendingPublishQueue.tsx:65-89` ramifica por `productType==='sealed'` y
> pinta `sealedProductName` + «SELLADO», nunca la carta ancla. Ese defecto ya no vive aquí.

**Arreglado (display-only, seguro):** el encabezado del `VariantDrawer` ahora muestra el subtipo cuando llega
— `SELLADO · <SUBTIPO>` (`VariantDrawer.tsx`, `specParts`), usando `status.sealedSubtype` (existe en es y en).
Passthrough puro de un prop que el componente ya recibía. Prueba: *SELLADO-M1(C)* en `VariantDrawer.test.tsx`
(falla si se revierte).

---

## (D) «Sellado SIN PRECIO DE MERCADO» (Chaos Rising Booster Bundle) — MEDIDO

**No es porque el producto esté sin mapear.** `SealedProduct.tcgplayerProductId` es `Int @unique` —
**NOT NULL** en `backend/prisma/schema.prisma` (modelo `SealedProduct`) — así que todo `SealedProduct` tiene
mapeo. La causa es que **no hay una fila de precio (`PriceReference`) resuelta** bajo
`sealed:tcg:<productId>` para la carta ancla:

- `effectiveMarketCents = gateSealedMarketCents(ref, sourceOn)` (`sealed-product.service.ts:239`, expuesto en
  `:295`). Devuelve `null` cuando `ref` está ausente **o** el dial de fuente está apagado/seed
  (`pricing.service.ts:1763`).
- No hay `ref` porque el precio de ese sellado **no se ha ingerido/resuelto**: es el escalón **P-46** (Chaos
  Rising / Pitch Black devolvían «0 presentaciones» al sincronizar, set sin grupo TCGCSV resuelto) y **P-83**
  (la llave `'sealed'` vs `sealed:tcg:<id>` y la falta de identidad en `PriceReference`). En este entorno,
  además, el egress a `tcgcsv.com` está bloqueado ⇒ precios STALE money-safe (por diseño).
- Resultado: `effectiveMarketCents == null` ⇒ la UI pinta **«SIN PRECIO DE MERCADO»**
  (`SealedAddFlow.tsx:551-559`, `SealedTab.tsx:331-339`) y ofrece el **precio manual** money-safe
  (`SealedAddFlow.tsx:388-396`) sólo a `vault_operator+`.

**Es money-path (P-83/P-46) ⇒ NO se toca aquí. Decisión del arquitecto + tres veredictos.** (Ver P-83:
dar identidad a `PriceReference` con fallback simétrico en todos los lectores, **o** prohibir el alta de
sellado sin mapeo hasta curar en M2.)

- *Observación menor (no arreglada):* `sealed-product.service.ts:95` comenta «Sellados SIN MAPEO
  (tcgplayerProductId null)», que **contradice** el schema NOT NULL. Es un comentario obsoleto; lo señalo para
  backend (no es passthrough de UI).

---

## Qué arreglé (todo frontend, display-only, con prueba-canario)

| Símbolo | Cambio | Fichero | Prueba (falla si se revierte) |
|---|---|---|---|
| (A) | El CTA deshabilitado dice por qué (precio de compra obligatorio) — reusa copy existente | `QuickAdd.tsx` | `QuickAdd.test.tsx` · *SELLADO-M1(A)* |
| (C) | Encabezado del drawer muestra el subtipo del sellado (`SELLADO · BUNDLE`) | `VariantDrawer.tsx` | `VariantDrawer.test.tsx` · *SELLADO-M1(C)* |

- **Proporción de pruebas:** ambas nuevas se vieron **rojas 2/2** sobre el código sin arreglar y **verdes** con
  el arreglo; suite `m1` completa **103/103** verde; `tsc --noEmit` limpio. No se añadieron llaves i18n (cero
  riesgo de paridad). Ninguna prueba se debilitó.
- **NO son probabilísticas** (no dependen de carrera/timer), así que N=1 basta para el sentido de la prueba;
  la señal es el rojo→verde con y sin el arreglo.

## Qué queda para gates (money-path / contrato — no lo toqué)

1. **(D) mercado del sellado sin mapear/ingerir** — P-83/P-46. Arquitecto decide schema+contrato; luego
   backend; luego los tres veredictos.
2. **(C) subtipo en la cola «Listas para publicar»** — requiere `sealedSubtype` en `PendingPublishRowDTO`
   (contrato, regla 9 → arquitecto) + proyección backend.
3. **Cobertura backend faltante:** **no existe una sola prueba de alta de sellado por COMPRA exitosa**
   (`backend/test/inventory.sealed-product-alta.spec.ts:390` lo dice: los casos `'compra'` eran todos rechazos
   422). El «no sale» pasó inadvertido en parte por eso. Backend debería añadir el caso feliz (compra →
   `in_stock` → cola de publicación con `missing:['price']`).
4. **(B) discoverabilidad de editar/despublicar** — decisión de UX (ver (E)); el mecanismo ya existe.

---

## (E) Propuesta escueta — «apartado propio para subir y editar el sellado»

La idea del dueño: una sección dedicada al sellado, con su propio subir/editar. Dos opciones:

### Opción 1 — Sección dedicada de sellado (ruta propia, p.ej. `/admin/sellado`)
- **Pros:** modelo mental claro («aquí vive el sellado»); da lugar natural a subir/editar/despublicar y a la
  curación de mapeos/precios manuales sin competir con la rejilla de singles; escala si el sellado crece.
- **Contras:** duplica navegación y estado (búsqueda por folio, tarjetas de valor, exportar) que hoy es
  compartido en M1; más superficie que mantener y volver a probar; riesgo de divergencia con la pestaña actual.
- **Esfuerzo:** **alto** (nueva ruta + layout + mover/duplicar acciones + E2E nuevos). No hay lógica de dinero
  nueva si sólo reubica lo existente, pero es mucho cableado.

### Opción 2 — Cablear en la pestaña Sellado actual (recomendada como primer paso)
- **Qué:** (a) renombrar/duplicar «Ver piezas» a algo que diga que **ahí se edita/despublica** (o añadir un
  «Editar» explícito en la fila del grupo); (b) subir sellado ya existe (`SealedAddFlow`, botón «Agregar
  producto sellado»), sólo hay que hacerlo más visible.
- **Pros:** el 90% del mecanismo YA existe y es alcanzable (medido en (B)); es sobre todo **rótulo/affordance**;
  esfuerzo **bajo**; sin cambio de contrato ni de dinero; cierra la queja real («no hay dónde editar/quitar»)
  sin construir una ruta nueva.
- **Contras:** no da el «apartado propio» conceptual que el dueño imagina; sigue conviviendo con Master Set y
  Gradeadas en la misma pantalla.

### Qué decisión necesita el dueño
- **¿Basta con hacer visible/editable lo que ya existe en la pestaña Sellado (Opción 2), o quiere una sección
  propia con su URL (Opción 1)?** La Opción 2 resuelve (B) esta semana con esfuerzo bajo y sin tocar dinero; la
  Opción 1 es un proyecto de UX/arquitectura mayor. Recomendación: **Opción 2 ahora** (rótulo de «Ver piezas» +
  hacer visible «Agregar»), y **evaluar Opción 1** si el volumen de sellado lo justifica.

---

## Resumen en lenguaje llano (para el dueño)

- **Por qué «no salía» el booster bundle:** como el producto no tenía precio de mercado, la app te obligaba a
  usar «Comprar», y «Comprar» necesita que escribas el **precio que pagaste**. Lo dejaste en blanco, así que el
  botón «Dar de alta» estaba apagado — pero **no te decía por qué**. No se guardó nada. **Con un precio de
  compra escrito, el bundle sí se da de alta y aparece.** Ya hicimos que el botón apagado **explique** que
  falta el precio.
- **Editar / quitar de publicado el sellado:** **sí se puede hoy** — está dentro del botón **«Ver piezas»** de
  cada producto en la pestaña Sellado (ahí editas precio, publicas y despublicas cada caja). El problema es que
  «Ver piezas» no suena a «editar». Se arregla con un rótulo mejor (esfuerzo bajo).
- **El formato (Bundle/Booster Box):** no se perdía de verdad — se veía en el listado del set, pero **no** en
  la ficha de piezas. Ya lo mostramos ahí también.
- **«Sin precio de mercado»:** es porque a ese sellado todavía no le llegó el precio de la fuente (el caso de
  Chaos Rising). Eso toca dinero, así que **no lo cambiamos aquí**: va a revisión con los tres controles.
- **Tu idea de una sección propia de sellado:** se puede, pero es un proyecto grande. Lo más rápido y sin
  riesgo es dejar bien visible lo que ya tienes en la pestaña Sellado. Necesitamos que decidas cuál prefieres.

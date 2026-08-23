# FRONTEND_NOTES.md — Marketplace TCG con Bóveda

> Propiedad: **frontend**. Decisiones de implementación del cliente Next.js.
> Fecha: 2026-08-13. Branch: `claude/tcg-cards-marketplace-oijthj`.
> El contrato (`docs/API_CONTRACT.md`) y el sistema de diseño (`docs/DESIGN_SYSTEM.md`) mandan.

## «Valor estimado si se gradea» — gancho de grading (2026-08-23, v1.44-graded-estimate / §21)

> Rama `claude/psa-graded-card-value-gmhv5u`. Implementa PROJECT §N (v2.0), contrato
> **v1.44-graded-estimate** y **DESIGN_SYSTEM §21**. Cambio **aditivo**: sin `gradedEstimates` /
> `gradingHighlight` en la respuesta, todas las superficies se ven **exactamente como hoy**.

### Piezas nuevas
| Archivo | Qué es |
|---|---|
| `(storefront)/_shared/grading/estimates.ts` | Predicados de render (`renderableEstimates`, `blockEstimatesOf`, `badgeEstimatesOf`, `pageHasGradingFigures`, `latestCapturedDate`). **Única** fuente de verdad de «¿hay cifra que pintar?». |
| `(storefront)/_shared/grading/GradingFootnote.tsx` | `GradingFootnoteBoundary` (contexto + nota), `GradingNoteCall` (la llamada `*`) y la nota al pie. |
| `(storefront)/_shared/grading/GradingEstimateBlock.tsx` | Bloque de la ficha (§21.3). |
| `(storefront)/_shared/grading/GradingEstimateBadge.tsx` | Badge de la teja / vitrina (§21.5). |
| `(storefront)/_shared/grading/HypotheticalGradeChip.tsx` | Chip de grado hipotético, borde punteado (§21.2). |
| `(storefront)/_home/GradingGemsShelf.tsx` | Vitrina «Joyas para gradear» + `useGradingGems()` (§21.6). |
| `(storefront)/_shared/Fact.tsx` | La celda `Fact` de la ficha, **extraída tal cual** de `CardDetailView` para reusarla en el bloque. Único ensanchamiento: `label` pasa de `string` a `ReactNode` (la etiqueta del gancho lleva el chip). Cero cambio visual. |

Tocados: `types/contract.ts` (espejo del contrato), `lib/api.ts` (`gradingHighlight` + `sort=grading_showcase`), `lib/mock/fixtures.ts`, `catalog/CatalogTile.tsx`, `catalog/CatalogView.tsx`, `catalog/[cardId]/CardDetailView.tsx`, `(storefront)/page.tsx`, `messages/{es,en}.json`.

### Cómo se resolvió el acoplamiento llamada ↔ nota (§21 R3.3) — lo importante
El requisito es que **un refactor no pueda dejar cifras huérfanas**. En vez de repetir la condición
en cada sitio, hay **un solo booleano por página** que hace **dos cosas a la vez**:

```tsx
<GradingFootnoteContext.Provider value={active ? anchors : null}>
  {children}
  {active && <GradingEstimateNote />}
</GradingFootnoteContext.Provider>
```

- **Toda** cifra (`GradingEstimateBlock`, `GradingEstimateBadge`) y la propia `GradingNoteCall`
  **exigen el contexto**: sin boundary activa devuelven `null`. Mover un badge a una página que no
  hospeda la nota **no produce una cifra sin aviso: produce nada** (fail-closed, la dirección
  correcta del error en una superficie comercial).
- El `active` de cada página se deriva **siempre** de los helpers de `estimates.ts`, nunca de una
  regla copiada: ficha `blockEstimatesOf(detail) !== null`; Compra
  `pageHasGradingFigures(catalogQuery.data?.data)` (se reevalúa al filtrar/paginar, §21.4b); home
  `pageHasGradingFigures(gemsOf(gems.data))` — la **misma** query que alimenta la vitrina, deduplicada
  por `queryKey`, así que vitrina y nota no pueden divergir.
- El `Provider` se renderiza **siempre** (solo conmuta su valor): cambiar el tipo de nodo al paginar
  desmontaría la vista y perdería el estado de filtros.
- Enlace de regreso: la boundary recibe `returnToId` (ficha → la llamada, que ahí **sí** es enlace;
  Compra → `#catalogo-resultados`; home → `#joyas-para-gradear`). Todos con
  `scroll-mt-[calc(var(--app-header-h,0px)+16px)]`, nada de `top` hardcodeado.
- Tests que lo fijan: `gradingEstimates.test.tsx` («fuera de una boundary activa, ninguna cifra se
  pinta»), `CatalogView.test.tsx` (página con badges ⇒ nota; pestaña Gradeadas ⇒ ni cifra ni nota) y
  `CardDetailView.test.tsx` (ficha con bloque ⇒ nota completa sin interacción).

### Iteración por `gradeValue`, nunca por índice
`GradedEstimateDTO[]` se recorre leyendo `gradeValue`/`gradingCompany`; **no hay ningún `[0]`** ni
supuesto de longitud. Añadir o quitar un grado (diales `grades` / `highlightGrades`) **no toca el
cliente**: el bloque pinta una celda por elemento y el badge un renglón por elemento. La única
lectura posicional es **tipográfica** (la primera cifra es el premio mayor, §N.3/§21.1), que es
justo lo que el diseño pide y no rompe si cambia el conjunto de grados.

### Colores y tipografía — cero tokens nuevos
- **Ningún hex literal** y **ningún token nuevo**. Solo utilidades ya mapeadas a tokens semánticos:
  `text-text`, `text-muted`, `border-border`, `border-border-strong`, `border-text`, `text-accent`.
  Por eso la trampa de §2.3 (que aún lista el bermellón retirado `#B44B3A` en vez del rojo TCG HUNT
  vigente) es inocua: `text-accent` resuelve a `--color-accent` en runtime.
- El acento tiene **un solo empleo**: la llamada `*` y su marcador en la nota (R1). Ninguna cifra,
  etiqueta, fondo o borde del gancho lleva color. Sin verde de dinero, sin rojo de oferta, sin cajas.
- Voz (R2): el precio de venta sigue en sans 500 30px; los estimados son **mono tabular** 22/17px
  (20/16 móvil) en un contenedor aparte con su regla de tinta, y **el bloque no contiene ningún
  precio real**.

### Money-safe
`renderableEstimates` descarta cualquier elemento sin `referenceMxnCents > 0` o con
`status !== 'priced'`, y devuelve **`null`** (no `[]`) cuando no queda nada — así es imposible
renderizar un contenedor vacío por descuido. Nunca `$0`, ni `—`, ni «pendiente», ni **skeleton**: la
vitrina del home es la excepción ratificada a §8.1 (aparece resuelta o no aparece).

### i18n
Claves nuevas bajo `catalog.gradingEstimate`, `catalog.gradingBadge`, `catalog.gradingNote` y
`home.gradingGems`, en ES y EN (el test de paridad las cubre). El disclaimer se pinta **una clave por
párrafo con rich text** (`<b>` → `<strong>`), jamás concatenando. Dos desviaciones deliberadas del
esquema de §21.11, ambas para poder copiar el texto aprobado **sin reescribirlo**:
- **`p1…p6`** (no `p1…p5`): el texto de PROJECT §N.5 tiene **seis** párrafos y el humano lo quiso
  íntegro; el diagrama de §21.4b omite el primero.
- **Sin `psa10Label` / `psa9Label`**: serían claves por grado cableado, que contradicen la regla de
  iteración del contrato. La etiqueta de celda es `ifGradesLabel` («SI SALE») + el chip, que ya
  compone «SI SALE PSA 10» para cualquier grado que mande el servidor.
- `catalog.gradingBadge.approx` es nueva y existe por accesibilidad: el glifo `≈` va `aria-hidden` y
  su lectura («aproximadamente») viaja en `sr-only` dentro del mismo `t.rich` (§21.9).

### Textos MARCADOR DE POSICIÓN (pendientes de PO — §21.12 nº2)
`catalog.gradingEstimate.provenance` y `catalog.gradingNote.callSr` usan **los puntos de partida
propuestos por ux-ui**. Son texto legal-comercial: los fija PO (idealmente con la misma revisión
legal del disclaimer). Cambiarlos es editar `messages/{es,en}.json`, sin tocar código.

### Discrepancia REPORTADA (no resuelta por frontend)
`DESIGN_SYSTEM §21.7` dice que la ficha **no** se pinta si falta uno de los dos grados, y lo
justifica citando `PROJECT §N.4`. Pero `PROJECT §N.3(1)` («si solo existe uno de los dos grados, se
muestra el que exista») y el propio `§N.4` («Ficha → se muestra **lo que haya** (PSA 10 y/o PSA 9)»)
dicen lo contrario, igual que el contrato v1.44 («una carta con PSA 10 y sin PSA 9 emite un arreglo
de un elemento»). Por la **regla de conflicto** de `CLAUDE.md` (PROJECT manda sobre el contrato y
sobre el código) se implementó «se pinta lo que haya» — que además es exactamente la degradación que
§21.7 ya describe como contingencia («se pinta la celda que exista en la misma retícula»). Queda
**abierto para PO/ux-ui**; revertirlo son tres líneas en `blockEstimatesOf`.

### Mocks (`lib/mock/fixtures.ts`) — MOCK: pendiente de backend real
`mockGradedEstimatesByCardId` (ficha, sin gatear), `mockGradingShowcaseCardIds` (lista **ya curada y
ordenada** por el gate) y `mockGradingHighlightGrades` (dial del badge). El fixture **no calcula** el
gate ni la ganancia: reproduce el **resultado** que el servidor ya resolvió. Cobertura de estados:
Blastoise / Pikachu IR (bloque + badge + vitrina), Milotic FA (**bloque sí, badge no** — estado
normal de §21.7, no un bug), Eevee (un solo grado), Pikachu (sin estimados ⇒ nada).

### Verde (gate pre-publicación)
`tsc --noEmit` ✓ · `next lint` ✓ · `vitest run` **81 archivos / 653 tests** ✓ (33 nuevos) ·
`next build` ✓. Nota: `page.test.tsx` del home necesitó `useRouter`/`usePathname` en su mock de
`@/i18n/navigation` porque la vitrina reusa la teja de Compra.

## Footer legal — degradación con gracia sin razón social (2026-08-23, P-21)

> Rama `fix/variant-composition-regression`. El humano decidió publicar SIN razón social por ahora.
> El literal placeholder **«[Razón social pendiente]»** NO puede verse en producción.

- **Problema:** el footer del storefront (`(storefront)/layout.tsx`, `Footer()`) renderizaba
  `«TCG HUNT · tcghunt.mx · © {año} {footer.legalEntity}»` con `footer.legalEntity` =
  `[Razón social pendiente]` (es) / `[Legal entity pending]` (en), dejando el placeholder visible.
- **Fix data-driven:** nuevo helper puro `resolveLegalEntity(raw)` en
  `frontend/src/app/[locale]/(storefront)/footer.ts`. Devuelve `null` cuando el valor es
  vacío/en blanco o está envuelto en corchetes (convención de placeholder de los archivos de
  mensajes), y el string recortado en caso contrario. `Footer()` (`layout.tsx:58`) omite la razón
  social cuando el helper devuelve `null`: el footer queda «TCG HUNT · tcghunt.mx · © {año}»,
  coherente y sin texto colgando (la marca «TCG HUNT» ya abre la línea, no hay «©» huérfano).
- **Comportamiento futuro:** cuando el humano cargue una razón social real (sin corchetes) en
  `messages/*.json` → `common.footer.legalEntity`, aparece automáticamente, sin cambios de código.
- **Mensajes intactos:** `messages/es.json`/`en.json` conservan el placeholder entre corchetes como
  marcador de intención; el resolver lo neutraliza en runtime. No toqué el contrato ni el backend.
- **Cobertura:** `footerLegalEntity.test.ts` (3 casos: vacío/blanco/undefined/null → null;
  placeholders es/en → null; razón social real recortada). tsc `--noEmit`, `npm test`
  (622 passed) y `next build` verdes.

## Pase de deuda técnica frontend (2026-08-23) — cotizador H1/H3/H4 + H-P38-5

> Pago de deuda **segura y de display/UX** (money-safe intacto). Detalle en `docs/TECH_DEBT.md`
> (marcados RESUELTOS). Rediseño visual conservado.

- **Cotizador H3 — sombreado «En el carrito» en TODAS las tejas** (`components/master-set/MasterSetBinder.tsx`).
  La teja de **producto separado** (`SeparateProductTile`, deck_exclusive/promo) no recibía `inCart`, así que
  un producto separado ya agregado no se sombreaba (las variantes base sí). Ahora se le propaga `inCart` con
  la MISMA identidad que el carrito: `isInCart(cardId, finish, productId)` — con `productId` (una línea propia).
  Se reusa EXACTO el sombreado de `QuoterTile` (`bg-surface-2` + `shadow-[inset_0_0_0_1px_var(--color-border-strong)]`
  + `data-in-cart` + etiqueta textual `quoterInCart` en `text-success`). Solo aplica en quoter (fuera del quoter
  `inCart` es undefined). Sin cambio de contrato.
- **Cotizador H1 — flash de layout en desktop** (`buylist/BuylistView.tsx`). El carrito era JS-driven
  (`useMediaQuery('(min-width:1024px)')`), first-paint móvil que saltaba a 2 columnas al hidratar (layout shift
  visible de la columna `main`). Mitigación: la ESTRUCTURA de 2 columnas se declara por CSS
  (`lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start`, mismo umbral 1024px que `isDesktopCart`), NO por
  JS. El track de 360px queda RESERVADO desde el first-paint en desktop, así `main` nace con su ancho final y no
  refluye. **Trade-off aceptado:** el CONTENIDO del carrito (`<aside>` / FAB+drawer) sigue siendo un ÚNICO render
  JS-driven (`isDesktopCart`) para NO duplicar estado/foco ni el focus-trap; por eso en desktop el `<aside>` aparece
  al hidratar dentro de la columna ya reservada (rellena el hueco, sin reflujo de `main`), y el FAB móvil es `fixed`
  (fuera del flujo del grid), de modo que su breve aparición pre-hidratación tampoco desplaza el layout. El fix
  limpio del todo (SSR-aware del viewport, o extraer el carrito) implicaría reestructurar de más → mitigación mínima.
- **Cotizador H4 — doc drift** (`components/domain/RarityLabel.tsx` + este archivo). El comentario decía «gemelo de
  `FinishLabel`»; el hermano canónico del rediseño que vive junto a `RarityLabel` en `components/domain` es
  **`FinishMark`**. Corregido en ambos sitios.
- **H-P38-5 — no reusar `SealedProduct.id` como `cardId` de relleno** (`admin/m1/SealedAddFlow.tsx` +
  `QuickAdd.tsx`). El alta de sellado por identidad enviaba `cardId: selected.id` (un `SealedProduct.id`) como
  placeholder de tipo, confiando en que el batch lo ignora. Ahora **NO se envía cardId** (se omite): con
  `sealedProductId` el backend deriva la Card ancla. `QuickAddTarget.cardId` pasó a **opcional** (`cardId?: string`,
  ya opcional en `BatchInventoryItemInput` del contrato); el mutation ya omitía cardId bajo identidad sellada, así
  que el alta sigue funcionando idéntica. Sin cambio de contrato.

## §38 · P-38 — alta de sellado con entidad real `SealedProduct` (2026-08-23, contrato v1.39.1, DS §16.8a)

**Qué se hizo:** evolucionar el `SealedAddFlow` de P-35 para que el alta de producto sellado nazca con
**identidad real** (`SealedProduct` persistido, no un ancla a un single del set) y sea **money-safe** de
raíz. Se **retira el camino money-unsafe** «capturar sin catálogo» de P-35 (nacía SIN MAPEO). Todo en
`frontend/`; el alta vive en `(admin)/admin/m1/`. Aditivo al design system — **cero tokens nuevos**.

**Componentes (m1):**
- **`SealedProductPicker.tsx` (NUEVO)** — reemplaza el grid único `SealedProductGrid` (eliminado). Paso 1
  en **DOS SECCIONES `<section>` por `origin`**: «Del set» (`set_main`) primero y «Promos/colecciones»
  (`promo_collection`) después. Cada sección tiene `<h3>` + contador + su propio `role="listbox"`;
  selección única en todo el paso (un solo `sealedProductId` viaja al paso 2). Orden interno lo entrega el
  server (§4.34c: `isPrincipal desc`, `sortOrder`, `name`). Exporta la **teja evolucionada
  `SealedProductTile`**: imagen real + pozo/fallback, nombre (`cleanName`), pill de subtipo (incl. **UPC**
  y **collection**, con afijo tenue `·` + `title` si `subtypeInferred`), **badge «Principal»**, referencia
  money-safe (`marketRef` o pill `SIN PRECIO DE MERCADO`, **nunca 0**; seleccionable aun sin precio).
- **`SealedManualMarketField.tsx` (NUEVO)** — precio de mercado MANUAL en el paso 2. Input de dinero
  **abierto vacío** (jamás 0/sugerido), valida `>0`, aviso de **override auditado**. El flujo solo lo
  renderiza cuando `marketRef` es null **y** el usuario es **`vault_operator+`**; mapea a
  `manualMarketMxnCents`.
- **`SealedGroupLinker.tsx` (NUEVO, `super_admin`)** — curación de grupos promo/colección: lista
  `GET .../sync/candidates` con medidor de confianza (`matchScore` → alta/media/baja, nunca cifra cruda) y
  estado «Ya enlazado»; `POST .../sealed-sets/:setId/groups` (`kind:"promo_collection"`) → dispara re-sync.
- **`SealedAddFlow.tsx` (EVOLUCIONADO)** — orquesta: set → `listSealedProducts` → picker (con buscador `q`
  server-side + toggle «Solo principales» → `principalOnly`) → paso 2. Estado **«Sincronizar»**
  (`needsSync`): CTA `Sincronizar` **solo `super_admin`** (loading sin cerrar el modal, resumen honesto del
  `SealedSyncResultDTO` «12 presentaciones · 9 con precio · 3 pendientes», nunca «0»); para
  `vault_operator` copy sin botón muerto. Alta reusa `QuickAddSection` con `sealedProductId` (+
  `manualMarketMxnCents` cuando aplica).
- **`QuickAdd.tsx` (AJUSTADO)** — `QuickAddTarget` gana `sealedProductId?` y `manualMarketMxnCents?`. Con
  `sealedProductId` la línea del batch **omite `cardId`** (el backend deriva la Card ancla) y **no** manda
  los 4 campos M-37 sueltos (deprecados). Otras superficies que reusan `QuickAddSection` (raw, detalle de
  set) **no cambian** (siguen mandando `cardId`).

**Endpoints consumidos (nuevos en `lib/api.ts`):** `listSealedProducts`, `syncSealedProducts`,
`getSealedSyncCandidates`, `linkSealedSetGroup`. Alta = `batchCreateItems` (`POST .../items/batch`) con
`sealedProductId` + `batchKey` (+ `manualMarketMxnCents?`).

**`types/contract.ts`:** `SealedSubtype` += `upc`/`collection`; nuevos `SealedGroupKind`,
`SealedProductDTO`, `SealedSetGroupDTO`, `SealedProductListResponse`, `TcgcsvGroupCandidateDTO`,
`SealedSyncCandidatesResponse`, `SealedSyncRequest`, `SealedSyncResultDTO`, `SealedSetGroupLinkRequest`;
`BatchInventoryItemInput` gana `sealedProductId?`/`manualMarketMxnCents?` y `cardId` pasa a opcional.

**i18n (es/en):** `admin.sealedAdd.{section.*,sync.*,linker.*,manualMarket.*,principalOnly,principalBadge,
subtypeInferredHint,legitEmpty,legitEmptyHint,sectionEmpty}` · `status.sealedSubtype.{upc,collection}` ·
`error.{SEALED_PRODUCT_NOT_FOUND,MANUAL_MARKET_NOT_ALLOWED}`. Se retiraron las claves del camino de
respaldo P-35 (`fallbackLink/fallbackNotice/fallbackProductName/noProducts*`).

**Money-safe:** sin precio → pill/pendiente/manual, **jamás 0**; el override manual solo llena el hueco
`null` (con mercado vivo el campo no se ofrece; el backend responde `422 MANUAL_MARKET_NOT_ALLOWED`); sin
manual, la aportación queda `PRICE_PENDING` con helper que lo anticipa. Mocks (`lib/mock/fixtures.ts`)
actualizados para los 4 endpoints y para que `mockBatchCreate` derive por `sealedProductId` y aplique las
reglas de `manualMarketMxnCents`/`SEALED_PRODUCT_NOT_FOUND`.

**El alta nace con identidad real (no ancla-a-single):** la línea del batch viaja **sin `cardId`** y con
`sealedProductId` → el backend deriva Card ancla + mapeo + imagen/nombre/subtipo del `SealedProduct` y
congela el snapshot (la pieza nace «ETB Surging Sparks», no la Tropius). Verificado por test.

**Tests añadidos:** `SealedAddFlow.test.tsx` (reescrito, 7): 2 secciones por `origin` con orden fijo, teja
money-safe (precio/pill/badge, nunca 0), sync solo `super_admin` con resumen honesto + copy sin botón para
`vault_operator`, alta manda `sealedProductId` (sin `cardId`), precio manual `vault_operator` solo si
`marketRef` null (valida `>0` → `manualMarketMxnCents`) y NO aparece con mercado vivo. `SealedGroupLinker.
test.tsx` (nuevo, 1): candidatos con confianza + enlace → re-sync.

**Sin solicitudes al arquitecto:** el contrato v1.39.1 cubre todos los datos/pantallas. No se tocó
`backend/` ni `docs/API_CONTRACT.md`.

**Verde:** `vitest run` **78 archivos / 615 tests** ✓, `tsc --noEmit` ✓, `next build` ✓.

## §23 · P-30 (publicación única agrupada con stock) — storefront «Compra» al shape AGRUPADO (2026-08-22, contrato v1.38-grouped-listings)

**Qué se hizo:** casar el catálogo del rediseño (que consumía `ListingDTO` por-copia) con el shape
**AGRUPADO** de v1.38 (`GroupedListingDTO`). **Solo se cambió la fuente de datos y el cableado — el look del
rediseño queda intacto** (mismas tejas, retícula, tipografía, ficha 6b).

**Tipos (`src/types/contract.ts`):** añadidos `GroupedListingDTO`, `GroupedListingListResponse`,
`GroupedListingDetailResponse` alineados EXACTO a v1.38 (`representativeInventoryItemId`, `stockCount`,
`salePriceCents` único del grupo = mínimo/«desde», `gradeKey`, `referenceValue`; productType ∈ {raw, graded},
NUNCA sealed — H9). `ListingDTO` se conserva (lo usan `units[]` y el re-quote por-pieza). Sin `certNumber` a
nivel de grupo: es POR SLAB y vive en `units[]`.

**API (`src/lib/api.ts`):**
- `getCatalog` → `GroupedListingListResponse` (`GET /catalog/cards`). La rama mock **agrupa** las piezas por
  `(cardId, productType, gradeKey, finish)` y aplica precio/orden sobre el grupo. `total` = nº de grupos.
- `getCardDetail` → `GroupedListingDetailResponse` (`{ card, listings: GroupedListingDTO[], units: ListingDTO[] }`).
- `getListing` (`GET /catalog/listings/:inventoryItemId`, re-quote por pieza) **sin cambio** (contrato v1.38).

**Mocks (`src/lib/mock/fixtures.ts`):** helpers `gradeKeyOf`, `unitMatchesGroup`, `groupMockListings`,
`mockGroupedDetail`. Se añadieron 2 copias físicas más de **Blastoise raw NM normal** (`inv-1002b/-1002c`)
para que el grupo tenga `stockCount=3` y ejerza el badge «N en stock» y el add-to-cart por N `units` distintos.

**Componentes adaptados (visual preservado):**
- `catalog/CatalogView.tsx`: una teja por **grupo**; `key`/`inCart`/add-to-cart por
  `representativeInventoryItemId`.
- `catalog/CatalogTile.tsx`: renderiza un `GroupedListingDTO`; precio «desde» = `salePriceCents`; badge de
  stock REAL vía `StockBadge` + `stockVariantFromCount(stockCount)` (Último / N en stock / Agotado —
  reutiliza la variante existente, **no** se tocó `StockBadge` ni se añadió prop `size`, MK-D9 sigue como
  deuda registrada). Add-to-cart → `representativeInventoryItemId`.
- `catalog/[cardId]/CardDetailView.tsx`: la grilla de «Ejemplares disponibles» son los **grupos**
  (`listings`); el add-to-cart va por **`units[]` cheapest-first**: «Comprar» agrega la pieza más barata del
  grupo aún NO en el carrito, y clics sucesivos suben hasta `stockCount` (el CTA cambia a «En el carrito» solo
  cuando TODAS las piezas del grupo están en el carrito). El `certNumber` de graded se lee del **slab
  representativo** (`units`), no del grupo. Re-quote por pieza sin cambio.

**Consumidores colaterales de `getCatalog` (home) reconciliados al shape agrupado, visual intacto salvo lo
forzado por el contrato:**
- `_home/FeaturedCarousel.tsx`: tipos → `GroupedListingDTO`, keys/badge por grupo.
- `_home/GradedShelf.tsx`: keys/badge por grupo. **Cambio visual forzado:** se retiró la línea de
  `certNumber` de la teja porque el cert es POR SLAB (`units[]`) y **no** viaja en `GroupedListingDTO` — la
  vitrina agrupada no tiene esa pieza. El chip de grado (empresa + valor) se conserva. *(No es solicitud de
  contrato: es el diseño money-safe correcto — el cert se verifica en la ficha, sobre el slab concreto.)*

**Money-safe:** `salePriceCents` del grupo es el mínimo/«desde»; el cobro real se re-cotiza por
`inventoryItemId` en checkout (ya estaba así). Sin precio → «pendiente»/«—», nunca $0. Los grupos AGOTADOS no
llegan del backend (`stockCount≥1`); la variante «Agotado» del badge queda disponible por si el front la
necesita defensivamente.

**Tests:** `CatalogView.test.tsx` (grupo colapsa 3 copias en 1 teja + badge «3 en stock»),
`CardDetailView.test.tsx` (reescrito al shape `{card,listings,units}`: add-to-cart por `units` cheapest-first,
multi-stock hasta agotar, CTA por grupo, agotado defensivo), y `api.test.ts` (assertions al shape agrupado).
**Verde:** `vitest run` (585 tests), `tsc --noEmit`, `next build`. **Sin solicitudes al arquitecto** (el
contrato v1.38 cubre todo lo necesario).

## §22 · P-29 (baja rápida de inventario) + P-31 (exportar inventario a Excel) — M1 admin (2026-08-22, branch `fix/variant-composition-regression`)

### P-29 · Baja rápida en el drawer del Master Set (simétrica al alta rápida)

**Qué se agregó:** un control de baja por cantidad en el `VariantDrawer` (drill-down por variante de M1),
simétrico al `QuickAddSection` (P-19). Da de baja **N piezas de la misma variante** (carta + acabado, o
carta + sellado) de un golpe, con **confirmación simple** de dos pasos (sin modal).

**Componente:** `frontend/src/app/[locale]/(admin)/admin/m1/QuickRemove.tsx` (`QuickRemoveSection`).
- Stepper de cantidad + Select de motivo de merma **OBLIGATORIO** (reusa `masterSet.adjust.reason`:
  perdida/danada/error_captura, default `perdida`, elegido antes de confirmar) + CTA `destructive` con
  confirmación inline (dos pasos, sin modal).
- **Money-safe (doble barrera):** el stepper se **capa al conteo VISIBLE** de piezas ajustables
  (`removableCount`, prop) — «Sumar uno» se deshabilita en el tope y `qtyNum` clampa a `removableCount`; con
  `removableCount===0` se muestra el vacío y **no hay CTA**. El backend es la barrera dura.
- **Anti doble-submit:** la baja es **ATÓMICA** en el backend + el botón queda `loading`/`disabled` mientras
  corre. **No se manda `batchKey`** (no hay idempotencia por clave; no hace falta).

**Wiring (`VariantDrawer.tsx`):** botón secundario **«Baja rápida»** en la fila de CTA (solo raw/sellado, no
graded — `quickAddTarget` null en graded), que despliega la sección. `removableCount` se deriva de las filas
ya cargadas (`rows`, filtradas a `ownerType=platform` por el query): `status ∈ {in_stock, listed}`. Al éxito
refresca `pieces.refetch()` + `onChanged()` (agregados del binder).

**Endpoint consumido (backend YA implementado — shape reconciliado):**
`POST /admin/inventory/items/bulk-remove` con
`{ cardId, finish, quantity, reason, note?, productType?, rawCondition?, sealedCondition? }` (`reason`
**requerido** ∈ perdida|danada|error_captura) →
`{ removed, requested, reason, toStatus, inventoryItemIds[], folios[], adjustmentIds[] }`.
- **ATÓMICO:** o baja las `quantity` completas o ninguna. Errores manejados legibles:
  `422 INSUFFICIENT_STOCK { available, requested }` (carrera; muestra las disponibles) y
  `422 ITEM_NOT_ADJUSTABLE`.
- API `bulkRemoveInventory` (`api.ts`), mock `mockBulkRemove` (`fixtures.ts`: atómico — si faltan piezas
  lanza `INSUFFICIENT_STOCK` con `{ available, requested }` sin bajar nada). `ApiFixtureError` ganó un campo
  `details?` y `translateFixtureError` lo propaga, para que el mock reproduzca `INSUFFICIENT_STOCK` con datos.

### P-31 · «Exportar a Excel» en M1

**Qué se agregó:** botón **«Exportar a Excel»** en la toolbar de M1 (junto a «Publicar todo…» y «Alta por
lote»), en `M1View.tsx`. Descarga el `.xlsx` del inventario con el **filtro/set actual**: `setId` del binder
abierto (solo pestaña Master Set) + `productType` por pestaña (`sealed`/`graded`).

- **blob → descarga:** helper `triggerBlobDownload` (objectURL → `<a download>` → revoke). El nombre lo dicta
  el **backend por `Content-Disposition`** (`inventario-YYYY-MM-DD.xlsx`), que `requestBlob` parsea y devuelve
  como `filename`; si no viniera, cae al nombre propio `inventario-tcghunt-YYYYMMDD.xlsx` (`exportFilename`).
- **Estados:** botón con `loading` («Exportando…») + `disabled`; error → toast `danger` legible
  (`exportXlsx.error`); éxito → toast `success`.
- **Endpoint consumido (backend YA implementado):** `GET /admin/inventory/export.xlsx`
  (query `setId/status/productType/finish/q`) → binario xlsx. API `exportAdminInventoryXlsx` (`api.ts`)
  devuelve `{ blob, filename }` vía el helper `requestBlob` de `api-client.ts` (fetch binario autenticado, sin
  interceptor de refresh; errores → mismo `ApiClientError`; parsea `filename`/`filename*` del
  `Content-Disposition`). Mock genera un blob con MIME de xlsx (contenido demo) y `filename: null`.

### i18n
Nuevas claves en `messages/{es,en}.json`: `admin.quickRemove.*` (incl. `insufficientStock`),
`admin.drawer.removeQuick`, `admin.inventory.exportXlsx.*`. `error.ITEM_NOT_ADJUSTABLE` ya existía y se reusa.

### Reconciliación con el backend (2026-08-22)
Ambos endpoints los **implementó el backend**; el front se alineó a sus shapes EXACTOS (backend = fuente):
- **P-29:** se quitó `sealedSubtype`, `batchKey` y todo el manejo de `idempotentReplay` (la baja es atómica);
  `reason` pasó a **obligatorio**; el resumen se lee de `{ removed, requested, folios }`; se añadió el manejo
  legible de `INSUFFICIENT_STOCK`/`ITEM_NOT_ADJUSTABLE`. La rama «baja parcial» se eliminó (imposible con la
  atomicidad: en 200 siempre `removed === requested`).
- **P-31:** `requestBlob`/`exportAdminInventoryXlsx` devuelven `{ blob, filename }`; el front usa el
  `filename` del `Content-Disposition` del backend y sólo cae a su nombre propio si no viene.

### Gates
`tsc --noEmit` ✓ · `next lint` sin warnings/errores ✓ · `next build` ✓ · `vitest run` **584/584** verdes
(71 archivos), incluidos los nuevos: `QuickRemove.test.tsx` (7) y P-31 en `M1View.test.tsx` (3, total 25).

---

## §21 · P-28 (dos carritos en «Vender») + P-33 (retiro del selector de proveedor de respaldo) (2026-08-22, branch `fix/variant-composition-regression`)

### P-28 · Los dos carritos de «Vender» ya no compiten

**Diagnóstico (leído del código):** son **dos carritos DISTINTOS**, no un mismo carrito desincronizado.
- **Header «CARRITO N»** = carrito de **COMPRA/tienda** (`useCart` en `src/lib/cart.ts`, persistido en
  `localStorage` `tcg.cart` por `inventoryItemId`; el botón enlaza a `/checkout`). Pintado por
  `StorefrontHeader.tsx`, etiqueta `nav.cart` = «Carrito».
- **FAB flotante «M»** = carrito de **VENTA/cotización** (`useSellCart` en
  `(storefront)/buylist/useSellCart.ts`, render `SellCartFab` + `SellCartDrawer` desde `BuylistView.tsx`).
  Su `aria-label` ya decía «Carrito de venta».

Coexisten en `/buylist` con contadores independientes (compra=1, venta=5) → se lee como un mismo carrito
descuadrado. **No hay bug de estado**: cada uno es su propia fuente y ambos son correctos por separado.

**Arreglo (mínimo, sin tokens nuevos, money-safe — solo UI):** en el flujo de venta se deja **UN SOLO
carrito en pantalla**. `StorefrontHeader.tsx` deriva `onSellFlow = pathname.startsWith('/buylist')` (el
header ya usa `usePathname` de `@/i18n/navigation`, locale-stripped) y **oculta el botón de carrito de
compra** (desktop **y** menú móvil) en esa ruta. El carrito de compra no se pierde: vive en `localStorage`
y reaparece en el resto de la tienda. Así «CARRITO 1» ya no compite con el «5» del cotizador; el único
carrito visible en Vender es el FAB de venta. (Se evaluó relabelar globalmente el carrito de compra, pero
el nav ya tiene «Compra» y «Vender»; ocultar en la ruta de venta es lo más limpio y no cambia copy global
que es propiedad de ux-ui.)
- **Tests:** `StorefrontHeader.test.tsx` — mock de `usePathname` vuelto **mutable** (`mockPathname`); dos
  casos nuevos: fuera de venta (`/catalog`) el carrito de compra aparece con `href=/checkout`; en `/buylist`
  el link «Carrito» **no** está en el DOM.

### P-33 · Retiro del selector de «proveedor de respaldo» de Ingesta de precios (M2)

Decisión del humano: **quitar** el `Select` de «Proveedor de respaldo (fallback)» del panel M2. La ingesta
a mano («Actualizar precios ahora», `PriceIngestSection` / Sección 1) **se queda**. TCGCSV sigue primario y
PPT queda fijo como respaldo **en el backend**, sin control en UI. **NO se tocó la precedencia del backend**
(solo la UI).

- **Sección 3b eliminada entera:** el archivo `sections/PriceProviderSection.tsx` era 100% el control del
  dial (fila fija «Fuente primaria TCGCSV» + `Select` de respaldo + línea de precedencia). Se **borró** el
  archivo y su import/render en `M2View.tsx`.
- **Wrappers de API huérfanos retirados** de `src/lib/api.ts`: `getPriceProvider`/`updatePriceProvider` y el
  import del tipo `PriceProvider` (solo los usaba esa sección). El tipo `PriceProvider` y el campo
  `SettingsDTO.priceProvider` **se conservan** en `contract.ts` (el setting sigue existiendo en el backend,
  solo deja de exponerse en el front).
- **`PRICE_PROVIDERS`** (const del dial) retirado de `sections/shared.tsx` junto con su import de tipo.
- **i18n:** se quitaron las claves huérfanas del grupo `admin.m2.priceIngest` (`title`, `subtitle`,
  `primarySource*`, `fallbackLabel`, `providerOptions`, `fallbackHint`, `precedenceHint`, `providerSaved`)
  en `es.json` y `en.json`. Se conservan las claves de la ingesta a mano (`trigger`, `triggerHint`,
  `queued`, `alreadyRunning`, `sweep*`, `daily*`) que usa `PriceIngestSection`.
- **La línea informativa «FUENTE PRIMARIA TCGCSV → respaldo PPT» se retiró** (no se dejó como texto
  estático): la ingesta ya se explica en la Sección 1 y sin control asociado la línea sobraba.
- **Tests:** `M2View.test.tsx` — el test del selector se reemplazó por un **regression test P-33** que
  asevera que ni el `Select` «Proveedor de respaldo (fallback)» ni el encabezado/precedencia de la sección
  aparecen ya en el DOM (y que «Actualizar precios ahora» sigue). Import de `mockSettings` retirado (quedó
  huérfano).

> **Nota al arquitecto (no bloqueante):** el DESIGN_SYSTEM §19.7 aún describe el «reencuadre del selector de
> proveedor de respaldo» como parte del panel M2. Con P-33 ese control desaparece de la UI (el setting sigue
> en backend, fijo en PPT). Conviene que ux-ui actualice §19.7 para reflejar que la fuente/respaldo ya no
> tiene control en pantalla. No cambia el contrato (`SettingsDTO.priceProvider` intacto).

## §20 · Master Set combinado multi-parte (P-27, v1.33) (2026-08-22, branch `fix/variant-composition-regression`)

Implementa la parte FRONTEND de P-27 contra el contrato **v1.33-master-set-multipart** y ARCHITECTURE
§4.31. Un set multi-parte (Celebrations `cel25` + Classic Collection `cel25c` = 50) se presenta como **UN
master combinado**. **Todo aditivo/retrocompatible**: un set de una sola parte **no cambia**. Money-safe:
el mapa es solo presentación; el front nunca lo trata como fuente de verdad (lee `partSetId`/`parts` del
DTO, no re-llavea nada).

- **Tipos nuevos (`src/types/contract.ts`, aditivos):** `SetPartDTO`; `MasterSetCardCellDTO += { partSetId?,
  partLabel? }`; `MasterSetBinderResponse += { parts?, canonicalSetId? }`; `MasterSetSummaryDTO += {
  partSetIds? }`; `CardSetDTO += { partSetIds? }` (para el plegado de dropdowns). Todos opcionales.
- **Binder combinado (`MasterSetBinder.tsx`):** cuando la respuesta trae `parts`, las celdas se agrupan por
  `partSetId` en **secciones por bloque** (principal primero, luego cada subset en su `order`) con un
  **separador** `PartSeparator` (etiqueta mono en versalitas + la regla del sistema `--rule` + subtotal de
  cartas del bloque — sin cajas ni sombras, DESIGN_SYSTEM §2.2). El re-orden en cliente pasó de
  `compareCardNumber` a **`(partOrder, compareCardNumber)`** para que los bloques no se intercalen (la
  colisión de numeración entre partes —dos "#1"— queda separada por bloque, §4.31f). **Sin `parts`** ⇒ una
  sola sección **sin encabezado** ⇒ render idéntico a hoy.
- **Completitud (encabezado «cubiertas/esperadas · %»):** se sigue derivando de `cells` (suma de
  expected/coveredVariantCount). Como el fan-in ya trae las celdas de todas las partes, el encabezado
  refleja las **50** sin código extra. Money-safe visual intacto (sin precio → "—", nunca $0).
- **`canonicalSetId` (navegación):** si el binder se pidió por un **subset**, el backend normaliza al
  principal y devuelve `canonicalSetId`. El binder toma el **nombre del principal** (`data.set.name`) para
  el título y notifica `onCanonicalResolved`; `MasterSetPanel` **canoniza `selectedSet`** (id+nombre del
  master) para que la selección/estado —y cualquier URL derivada— apunte al set combinado (evita el binder
  roto de 25). En un state-driven panel no hay `router.replace`; el estado ES la fuente de la vista.
- **Índice / dropdowns (entrada combinada ÚNICA):** el mock de `mockMasterSetIndex` **pliega** el subset en
  la fila del principal (suma agregados → 50, recomputa %, añade `partSetIds`, excluye el subset como fila).
  `MasterSetIndex.tsx` pinta un badge **«Combinado»** cuando `partSetIds.length > 1`. Los dropdowns de
  **Compra** (`getSets`/`GET /catalog/sets`) y **cotizador** (`listBuylistSets`/`GET /buylist/sets`) usan
  `foldSetsForDropdown` (Celebrations una vez, con `partSetIds`); `searchBuylistCards`/`GET /buylist/cards`
  **expande** `setId` del principal a `IN partSetIds` (`expandSetIdFilter`) para listar las cartas de todas
  las partes. **CA-71:** si el principal no está importado, el subset **no** se pliega (queda como su set).
- **Mock (`src/lib/mock/fixtures.ts`):** mapa curado `MASTER_SET_GROUPS` (espeja
  `backend/src/config/master-set-groups.ts`) + helpers (`masterPartSetIds`, `normalizeMasterSetId`,
  `expandSetIdFilter`, `foldSetsForDropdown`). Sets `cel25`/`cel25c` + 25 cartas holofoil por parte
  (numeración colisiona a propósito). `mockMasterSetBinder` hace fan-in por partes con `partSetId`/`parts`/
  `canonicalSetId`; `SET_PRINTED_TOTAL` = 25 por parte → binder combinado reporta Σ = 50.
- **Gates:** `tsc --noEmit` limpio, `eslint` limpio, `next build` OK, `vitest run` **572 verdes** (568
  base + 4 nuevos en `MasterSet.test.tsx`: binder combinado 50 con separador; set de una sola parte sin
  cambio; plegado del índice/dropdown con entrada combinada única; navegación por `canonicalSetId`).
- **Desalineaciones con el contrato:** ninguna. Los DTOs consumidos (`parts`, `partSetId`/`partLabel`,
  `canonicalSetId`, `partSetIds`) coinciden con el shape v1.33 (§DTOs líneas 1388-1416). El backend implementa
  el mismo contrato en paralelo; los tipos/mocks del front están listos para conmutar a `useMocks=false`.

## §19 · Reorganización del panel M2 (catálogo/precios) + «Unificar rarezas» (2026-08-22, branch `fix/variant-composition-regression`)

Implementa `DESIGN_SYSTEM.md §19` (v1.9). Reordena las 9 acciones de import/precio de `M2View.tsx` en
**tres grupos con peso decreciente**, ancla el nuevo **«Unificar rarezas»** al editor de reglas por
rareza, retira lo muerto/legacy y reencuadra el selector de proveedor. **Cero cambios de contrato**
salvo el endpoint aditivo de unify (ya especificado por backend en `BACKEND_NOTES §0-ter`).

- **Tres grupos (`M2View.tsx`), debajo de los editores de precio:**
  - **G1 «Datos (rápido · TCGCSV)»** — `<section role="group" aria-labelledby>` destacado (eyebrow +
    h2 + subtítulo con la garantía «funcionan siempre»). Acción global **F** (`refreshVariantsAll`,
    `secondary`, confirmación) con etiqueta corta `catalog.refreshVariantsAllShort`; el «(solo TCGCSV)»
    se movió del botón al subtítulo del grupo. **La tabla de sets ÚNICA vive aquí** (anclada a Datos): su
    acción por-fila **primaria es I** (`refreshVariants`, `catalog.refreshVariantsShort`). El feedback
    de las acciones por-fila (I y H) se pinta junto a la tabla para que sea visible.
  - **G2 «Catálogo (cartas nuevas · usa fuente de catálogo)»** — `role="group"` con **Banner `info`
    persistente** (`groups.catalog.sourceWarning`, `role=status`) que avisa la dependencia de
    pokemontcg.io. Acciones globales **D** (`syncAll`) + **C** (`backfill`). Acción por-fila **G**
    (`catalogSync`, «Importar/Re-sincronizar»), secundaria. **Degradación reactiva (§19.3):** ante
    fuente no disponible (404/405) el warning ahora **reencamina a Datos** (`groups.catalog.sourceDownReroute`).
  - **G3 «Avanzado»** — `<details>` nativo **plegado por defecto** (`groups.advanced.summary`). Contiene
    la global **E** (`syncAllForce`, confirmación). La por-fila **H** (`fullSync`) se movió a un menú
    overflow **«Más ▾»** por-fila (`RowMoreMenu`, `aria-haspopup="menu"` + `aria-expanded`, `Esc`/click
    fuera cierran y devuelven foco; H es un `menuitem` con label completo). Su feedback se pinta en G1
    (junto a la tabla) para que no quede oculto tras el `<details>`.
  - **Orden por-fila:** I (1ª) → G (2ª) → H (overflow), reflejando la jerarquía de grupos.
- **«Unificar rarezas» (§19.5):** botón `secondary sm` (`Wand2`) **en el encabezado del editor de reglas
  de buylist** (Sección 4), no en Datos — el «por qué» solo se entiende viendo la lista fragmentada que
  limpia. Confirmación one-shot (modal). Consume `POST /admin/catalog/unify-rarities` (200, sin body) →
  `{ ok, cardsProcessed, cardsUpdated, distinctCanonical, unmapped: [{ raw, canonical, count }] }`
  (`UnifyRaritiesResponse` en `contract.ts`; wrapper `unifyRarities()` + mock en `api.ts`). Muestra un
  **resumen honesto** (cuántas actualizó + lista de `unmapped` para que el operador sepa qué añadir al
  catálogo canónico). Al éxito **invalida** `buylist-rarities`, `sales-rarities`, `buylist-rules`,
  `sales-rules` para recomponer el editor sin duplicados. Money-safe: local, one-shot, no toca precios.
- **Retirados (§19.6):** sección **B** «Sync de precios de bóveda» (`syncMutation`/`sync.launch`) — se
  eliminó el UI, el wrapper `syncPricing` y el tipo `PricingSyncResponse` (backend deja el endpoint
  `@deprecated`, no lo borra: su servicio es compartido con el cron `price-sync`). Restos de **`rarity-map`**
  (`RarityMapEntryDTO` en `contract.ts`, `mockRarityMap`/`setMockRarityMap` en fixtures, claves i18n
  `admin.m2.rarityMap.*` y `admin.m2.sync.*` + `advancedOps.*`). Verificado que nada más los consumía.
- **Selector de proveedor (§19.7):** fila fija no editable **«FUENTE PRIMARIA: TCGCSV»** + Select
  reetiquetado **«Proveedor de respaldo (fallback)»** + línea de **precedencia** «TCGCSV (primario) →
  respaldo: {selección} → override manual». Sin cambio de contrato (el dial `priceProvider` y sus
  valores no cambian). Claves nuevas `priceIngest.{primarySourceLabel,primarySourceValue,
  primarySourceHint,fallbackLabel,fallbackHint,precedenceHint}`; `providerLabel`/`providerHint` retiradas.
- **Estados/accesibilidad (§19.8/§19.9):** se conserva la serialización (`catalogBusy`/`batchBusy`/
  `otherPerSetPending`) y el keep-alive; confirmaciones para E, F y Unificar rarezas; `role="group"` por
  grupo, `<details>` para Avanzado, kebab con `aria-haspopup="menu"`; **motivos de deshabilitado en
  `aria-describedby`** (spans `sr-only` `m2-reason-needs-import` / `m2-reason-busy` + `title`).
- **i18n:** claves nuevas `admin.m2.groups.*`, `admin.m2.unifyRarities.*`, short labels de botón
  (`catalog.refreshVariantsShort/refreshVariantsAllShort/fullSyncMenuItem/rowMoreAria`), `catalog.setsEmpty`,
  `catalog.busyReason`. Paridad ES/EN verificada (`i18n-parity.test.ts` verde).
- **Gates:** `tsc --noEmit` ✅ · `next lint` ✅ (0 warnings) · `vitest run` ✅ **568/568** (M2 67/67, con
  tests nuevos/ajustados: grupos renderizados, «Unificar rarezas» dispara el endpoint + muestra `unmapped`
  + invalida rarezas, B/rarity-map ausentes, selector reencuadrado, H en menú «Más», F con etiqueta corta)
  · `next build` ✅.
- **Solicitud al arquitecto (no bloqueante):** el endpoint `POST /admin/catalog/unify-rarities` está
  implementado por backend pero **aún no formalizado en `docs/API_CONTRACT.md`** (backend lo dejó anotado
  en `BACKEND_NOTES §0-ter` como «pendiente de formalizar»). El front ya lo consume con el shape descrito;
  conviene que el arquitecto lo incorpore al contrato oficial. También queda pendiente (§19.11) la señal
  de salud de la fuente de catálogo (`source-health`) para volver el banner de G2 proactivo en vez de reactivo.

## P-13 · «Refrescar variantes + precios (solo TCGCSV)» por set en M2 (2026-08-22, branch `fix/variant-composition-regression`)

Tercera acción por-fila en el **Sync de catálogo** de M2 que refresca variantes/acabados y precios
de un set **ya importado** usando **SOLO TCGCSV**, sin pokemontcg.io. Motivación: hoy el «Sync
completo» encadena cartas (pokemontcg.io) + variantes/precios (TCGCSV), así que una caída de
pokemontcg.io **bloquea** arreglar el "fantasma" (variantes/precios faltantes) de un set ya en BD.
Esta acción desacopla ese arreglo del proveedor caído.

- **Contrato consumido (nuevo endpoint del backend):** `POST /admin/catalog/refresh-variants`, body
  `{ setId, force? }`. Respuesta **síncrona** `{ ok, setId, cardsProcessed, cardProductsUpserted,
  pricesUpserted, pending, tcgcsvReachable }` (NO es un job encolado: devuelve un resumen del trabajo).
  Errores del contrato: `SET_NOT_IMPORTED` (409, set no está en BD) y `UPSTREAM_ERROR` (502, TCGCSV
  no disponible). Tipado como `RefreshVariantsResponse` en `types/contract.ts`.
- **Wire (`lib/api.ts`):** `refreshVariants({ setId, force? })` → `apiRequest` POST; `force` solo se
  incluye en el body cuando es `true` (body mínimo por defecto). **Mock** con el shape del contrato:
  simula un refresh con `pending=1` (un producto sin precio) para ejercitar el reflejo money-safe
  honesto (no todo queda con precio).
- **UI (`M2View.tsx`):** botón `secondary` «Variantes + precios (solo TCGCSV)» (icono `RefreshCw`) en
  la columna de acciones por set, junto a «Importar/Re-sincronizar» y «Sync completo». Se **deshabilita
  para sets no importados** (evita el `SET_NOT_IMPORTED` obvio; explica el porqué en `title`) y se
  **serializa** con las otras dos operaciones por-set (una a la vez). El feedback es un **resumen
  honesto**: banner `success` si todo quedó con precio, `warning` («resultado parcial») si
  `tcgcsvReachable=false` o `pending>0`, con el conteo real de pendientes y el aviso de reintento. La
  mutación invalida `remote-sets` y `pending-prices`, y se suma a `catalogBusy` (keep-alive de sesión).
- **Texto claro:** el hint y el copy dejan explícito que **NO** re-importa cartas ni depende de
  pokemontcg.io (diferencia clave frente al «Sync completo»).
- **i18n:** nuevas claves en `messages/{es,en}.json` (`admin.m2.catalog.refreshVariants*`) y códigos de
  error legibles `error.SET_NOT_IMPORTED` / `error.UPSTREAM_ERROR`. Sin texto hardcodeado.
- **Tests (`M2View.test.tsx`, +6):** dispara `refreshVariants({setId})`; render del resumen; reflejo
  money-safe de `pending>0` y de `tcgcsvReachable=false`; render legible de `UPSTREAM_ERROR` (sin
  romper la pantalla) y de `SET_NOT_IMPORTED`; botón deshabilitado para set no importado.
- **Gates:** `tsc` limpio · `eslint` limpio · `next build` OK · suite **559 verde** (553 previos + 6).
- **Alineación con el contrato:** el shape se implementó exactamente como lo especificó el orquestador
  (backend en construcción). **Solicitud pendiente al arquitecto:** documentar formalmente
  `POST /admin/catalog/refresh-variants` + `RefreshVariantsResponse` y los códigos `SET_NOT_IMPORTED` /
  `UPSTREAM_ERROR` en `docs/API_CONTRACT.md`. Si backend ajusta el nombre del endpoint/campos o el
  status de los errores, realinear `refreshVariants` en `lib/api.ts` y los tipos.

## v1.30 (§4.29 / M-32) · Cotizar/vender un producto SEPARADO como línea propia por `productId` (2026-08-22, branch `fix/variant-composition-regression`)

Cierra el hueco que quedó tras v1.29 (§4.27): la **presentación** de productos separados
(`separateProducts: CardProductDTO[]`, `kind ∈ {deck_exclusive, promo}`) ya existía (`SeparateProductTile`),
pero la **línea de buylist** se identificaba solo por `(cardId, finish)` y no podía apuntar a un
`productId` → un Deck Exclusive/promo no era cotizable ni agregable como su propia línea. El
arquitecto cerró el contrato (v1.30, `productId?` aditivo) y aquí se cableó el FRONT.

- **Tipos (`types/contract.ts`, aditivos):** `productId?: number` en `BuylistQuoteItemDTO` (entrada
  del quote por-carta y del batch), en `BuylistQuoteResponse`/`BuylistQuotePayload` (eco) y en
  `SellItemDTO` (snapshot). `BuylistBatchQuoteResultDTO.error.code` gana `PRODUCT_NOT_FOUND` y
  `PRODUCT_CARD_MISMATCH`. `CreateSellRequestInput.items[]` y `BuylistRequestItem` ganan `productId?`.
  Todo opcional/retrocompatible: una línea sin `productId` = set_base, comportamiento v1.29 intacto.
- **Cotizador (`MasterSetBinder.tsx`, `mode="quoter"`):** `fetchQuoterBinder` ahora cotiza DOS clases
  de línea en el mismo `POST /buylist/quote/batch`: el set_base por `(carta, acabado)` y CADA producto
  separado por `(carta, productId, acabado)`. Como el `index` del batch no basta para correlacionar
  (base holofoil y producto holofoil de la misma carta comparten cardId+finish), se lleva un arreglo
  PARALELO de llaves con el `productId` incluido. Las cotizaciones de productos separados se guardan en
  un mapa client-only `separateProductQuotes` (por `${cardId}:${productId}:${finish}`) anexado a la
  respuesta del binder — misma doctrina que `variants[].quote` (no viaja del backend).
- **`SeparateProductTile`:** en modos de inventario/bóveda sigue siendo PRESENTACIÓN (precio de
  mercado propio, «—» sin precio). En `quoter` es COTIZABLE: pinta el ESTIMADO de buylist propio del
  producto (server-side por su `productId`) + botón «Agregar» que lo manda al carrito como su LÍNEA
  PROPIA. Money-safe: sin cotización OK el botón queda inhábil (nunca $0); una línea `precio_pendiente`
  SÍ es agregable (el backend fija su monto al recibir, como el set_base).
- **Carrito (`useSellCart.ts`):** la llave de dedup gana `productId` → `(cardId, productType, finish,
  productId ?? base)`. Dos líneas con el mismo `(cardId, finish)` y distinto `productId` son DISTINTAS
  (NO se fusionan); `requestItems` propaga el `productId` a `POST /buylist/requests`. El nombre de la
  línea de un producto separado es el del PRODUCTO (p. ej. «Charizard (Deck Exclusive)»).
- **Errores del contrato:** `PRODUCT_NOT_FOUND` / `PRODUCT_CARD_MISMATCH` se muestran como error de
  LÍNEA legible en la teja (i18n `masterSet.separateProductErrorCode.*` + catálogo `error.*`), sin
  romper el lote (en batch es error por-ítem; la carta base sigue cotizando).
- **i18n:** nuevas cadenas en `messages/{es,en}.json` (`masterSet.separateProductAddAria`,
  `separateProductError`, `separateProductErrorCode.*`; `error.PRODUCT_NOT_FOUND`,
  `error.PRODUCT_CARD_MISMATCH`). Sin texto hardcodeado.
- **Mocks (`lib/api.ts` + `lib/mock/fixtures.ts`):** `searchBuylistCards` ecoa `separateProducts` en
  `CardDTO`; `resolveSeparateProduct(cardId, productId)` distingue ok/mismatch/not_found; el batch y el
  quote por-carta cotizan el producto por su precio propio (pct sin referencia ⇒ `precio_pendiente`,
  nunca 0). Matiz preservado: el **batch** valida el acabado base ∈ `availableFinishes`; el **quote
  por-carta** no lo hacía (retrocompat de mock) — se conserva con un flag. La whitelist del PRODUCTO
  (`CardProduct.finishes`) SIEMPRE se valida (contrato §4.29).
- **Componentes COMPARTIDOS tocados** (`components/master-set/`, `lib/`, `hooks`-adyacentes): serializar
  el merge con cualquier otro stream que toque esas zonas.
- **Gates:** `tsc` limpio, `eslint .` limpio, `next build` ✓ compiled. Tests: **553 pasando** (548
  previos + 5 nuevos; se actualizó 1 test v1.29 de presentación a la semántica cotizable v1.30).
- **Sin bloqueos de contrato:** el shape v1.30 alcanzó para todo el flujo del front. El **carrito de
  storefront (compra)** NO necesita `productId` (se identifica por `inventoryItemId`, §4.29e) — fuera
  de alcance por diseño.

## Pulido precios/display (2026-08-19, branch `claude/pulido-precios-display`)

Tres tareas independientes de pulido de UI/UX.

### N-16 · Carta normal en el binder Master Set (quitar la agrupación por variante)
Antes (v1.22) cada carta se pintaba con UNA CASILLA DE IMAGEN POR VARIANTE (una imagen por
acabado), lo que visualmente "agrupaba" la carta en varias casillas. El PO pidió mostrar cada
carta como **carta normal**: UNA sola imagen. Como el binder Master Set es un **componente
COMPARTIDO** (`components/master-set/`) usado por las 4 vistas (§4.20f), el cambio se hizo en un
solo lugar y aplica a todas: cotizador (`mode="quoter"`), master set de inventario admin (M1),
Mi bóveda (`user_vault_self`) y bóvedas de cliente admin (`user_vault_admin`).
- **`MasterSetBinder.tsx`**: la cuadrícula pasa a un grid normal de tarjetas
  (`grid-cols-2 … xl:grid-cols-5`). `BinderCell` pinta UNA imagen (`CardTileImage`, antes
  `VariantImage`) + `#número` + completitud por variantes (`{covered}/{expected} casillas`) +
  badge secret rare + chips de drift; el desglose por acabado (conteos/huecos/compra/alta) vive en
  el drawer. `QuoterCell` pinta UNA imagen + botones de venta POR ACABADO en lista debajo (mismos
  `aria-label`/`onAddVariant` → carrito de venta intacto). Se eliminaron `slotCols`,
  `gridColsForSlots` y `slotGridStyle` (ya no hay retícula interna por casilla).
- **`CellDrawer.tsx`** (`VariantSlots`): el detalle deja de repetir la imagen por variante; ahora
  es UNA imagen de la carta + LISTA por acabado (etiqueta, conteo/hueco, CTA de compra en
  `user_vault_self`). Se conservan título "Casillas por acabado", CTA `buyable`/"No disponible" y
  todas las acciones de M1 (alta/publicación/ajuste) sin tocar.
- **Datos/contrato SIN cambios**: se sigue consumiendo `variants[]`/`availableFinishes` del
  contrato (completitud por variante) — solo cambia la PRESENTACIÓN a carta normal.
- Tests (`MasterSet.test.tsx`): se actualizaron las 2 aserciones de grid que exigían "una imagen
  por variante" a la nueva forma (1 imagen por celda; el desglose por acabado se verifica en el
  drawer). El resto (25 tests) verde.
- **Componente compartido tocado** (`components/master-set/`): serializar el merge con cualquier
  otro stream que toque esa carpeta.

### N-14 · Barra de progreso de precios (M2) que aparecía solo tras recargar
`M2View.tsx`: el `refetchInterval` de `price-sync-status` solo poll-eaba si YA había visto
`running:true`. Tras disparar el ingest, el job tarda un instante en marcar `running`, así que el
refetch inmediato veía `running:false`, el poll se apagaba y la barra no salía hasta recargar. Fix:
estado local `justDispatched` (se marca en `onSuccess` de `ingestMutation` junto con un `refetch()`
inmediato) que mantiene el poll vivo (`refetchInterval` considera `running || justDispatched`) hasta
que el barrido asome; al ver `running:true` se suelta la bandera (poll gobernado por `running`, se
detiene al terminar) y un `setTimeout` de 30 s la caduca como red anti-poll-infinito. Test de
regresión N-14 añadido (falla sin el fix).

### CTA del hero: alineación + relabel a "Tienda"
`(storefront)/page.tsx`: los dos CTA del hero ("Ir a la Tienda" botón negro y "Vender mis cartas"
link subrayado) no quedaban al mismo nivel — el link tenía `sm:pb-1.5` sin padding superior, así que
con `items-center` su texto quedaba ~3px arriba del centro del botón. Se cambió a `sm:py-1.5`
(padding vertical simétrico) → centros alineados (verificado con Playwright: delta 0.00px). Además,
como "Compra" ahora se llama **"Tienda"**, la clave i18n `home.ctaCatalog` se renombró a
`home.ctaShop` ("Ir a la Tienda" / "Go to Store") en `messages/es.json` y `en.json`.

## Fix M1 · alta de inventario (2026-08-18, branch `fix/m1-alta-inventario`)

Cuatro hallazgos del diagnóstico E2E (stack real, mocks OFF) sobre el ALTA de inventario admin.

### P-4 (BLOQUEANTE, bug de dinero) — el alta SIEMPRE da feedback visible
**Qué era en realidad:** con el tipo de adquisición **default "aportación en especie"** sobre una
carta SIN precio de referencia, `POST /admin/inventory/items` responde **422 `PRICE_PENDING`** (no
crea la pieza; el backend la deja en la cola de precios pendientes — comportamiento money-safe
intencional). El `Banner` de `create.isError` estaba renderizado al **final del cuerpo scrolleable**
del modal, fuera del viewport (y≈1242 con viewport 900) → el operador veía "que no pasa nada". El
caso "compra" (201) sí funcionaba.

**Resuelto (`M1View.tsx`):**
- **Error anclado ARRIBA (sticky):** el banner de error se movió al inicio del cuerpo del modal en
  un contenedor `sticky top-0 z-10` con `tabIndex=-1`; al fallar, un `useEffect` hace
  `scrollIntoView` + `focus()` al banner (a11y: `role="alert"`). Verificado en navegador: el alert
  queda en `y=114` con viewport 900 (dentro de vista, sin scroll).
- **Copy del OPERADOR, no de storefront:** el `error.PRICE_PENDING` global dice "…aún no se puede
  **comprar**" (lenguaje de tienda) y confunde en el alta. Se añadió un override de i18n SOLO-frontend
  `admin.m1.errorByCode.PRICE_PENDING` ("No se pudo dar de alta: esta carta aún no tiene precio de
  referencia; se envió a la cola de precios pendientes."). El helper `messageForCode()` prioriza
  `admin.m1.errorByCode.*` → `error.*` → mensaje real del backend. **No se tocó el `error.*` global**
  (lo usa el storefront/checkout).
- **Éxito con TOAST + refresco:** no había infra de toasts → se creó `components/ui/Toast.tsx`
  (`useToasts()` + `<Toaster>`), toast MÍNIMO reutilizable alineado a DESIGN_SYSTEM (bloque de tinta
  §7.2b, regla verde/bermellón por variante, mono versalitas, radio 0, portal a `<body>` en `z-[60]`
  para verse sobre el modal `z-50`, auto-cierre). El alta con éxito dispara un toast con el folio
  devuelto; se mantiene además el banner de éxito existente e `invalidateQueries(['admin-inventory'])`.
- No se tocó nada del backend money-safe.

### P-5 (mejora) — alta MASIVA (varias cartas en un envío)
Modo de **selección múltiple** opcional dentro del MISMO modal (checkbox "Seleccionar varias
cartas"): las filas del buscador pasan a checkbox, se arma un "carrito" de líneas y el botón primario
cambia a "Dar de alta N cartas". Reusa el endpoint de lote existente `batchCreateItems({ batchKey,
items })` (POST /admin/inventory/items/batch), con los mismos parámetros del formulario aplicados a
todas las cartas; el acabado se recorta **por-carta** (`finishForCard`) a la unión de acabados del
lote para no mandar un acabado inexistente. Resultado **tolerante por-ítem**: se pinta cada folio
creado (verde) y cada fallo con su motivo (reusa `messageForCode`), más un toast con el `summary`.
**Idempotencia** como MasterSetPanel: `batchKey` ESTABLE por sesión (ref), se renueva solo tras un
envío exitoso; el lote se **vacía siempre** al terminar (aun con fallos parciales) para no reenviar y
duplicar las líneas ya creadas. El alta de UNA sola carta sigue intacta.

### P-3 (pulido) — `PAGE_SIZE` del buscador del alta 20 → 50
Baja la fricción de "Cargar más" (un set de 120 cabe en 3 páginas, no 6; el backend topa en 100).
Verificado en navegador: sigue llegando a **120/120**.

### P-1 (pulido) — logout del back-office sin flash
`AdminTopbar.onLogout` ahora hace `router.replace('/login')` (antes `push('/')`): evita la carrera
con el guard del `AdminShell` que dejaba un flash "Verificando sesión…" y una URL `?next=`.

### Verificación en navegador (stack real, mocks OFF)
Script Playwright ad-hoc (scratchpad) contra `localhost:3000/es`, login `admin@e2e.local`, set de
prueba `Pitch Black TEST`:
- (a) aportación en especie → error CLARO anclado arriba (`y=114`, dentro de viewport 900).
- (b) compra → toast "ALTA REGISTRADA · folio INV-000002" + la pieza aparece en la tabla sin recargar
  (filas 8→9).
- (c) alta MASIVA (compra) → resultado por-ítem con 3 folios (INV-000003/004/005), lista refrescada,
  lote vaciado. Nota: con aportación el endpoint de LOTE **crea** las piezas (pendientes de precio) en
  vez de rechazarlas por-línea, así que no se reprodujo un fallo por-línea REAL en navegador; el
  render de fallos por-ítem queda cubierto por unit test (mock PRICE_PENDING).
- (d) P-3 → "120 de 120 cartas".

### Archivos
`app/[locale]/(admin)/admin/m1/M1View.tsx` (feedback sticky + toast + alta masiva + PAGE_SIZE 50),
`components/ui/Toast.tsx` (**nuevo**), `components/layout/AdminTopbar.tsx` (logout→/login),
`messages/{es,en}.json` (`admin.m1.errorByCode.*`, copy de toast/lote), `M1View.test.tsx` (+toast,
+2 alta masiva, PRICE_PENDING→copy admin, pageSize 50), `AdminTopbar.test.tsx` (replace→/login).

### Comportamiento alta simple vs. por lote (NO hay inconsistencia — aclaración)
Con adquisición `aportacion_en_especie` sobre carta **sin** precio de referencia, alta simple y por
lote **coinciden**: ambos **rechazan** la línea (no crean la pieza). Solo cambia la **forma de
reportarlo**, que es el patrón money-safe normal de cada endpoint:
- **`POST /admin/inventory/items`** (simple) → **422 `PRICE_PENDING`** de todo el request (no crea).
- **`POST /admin/inventory/items/batch`** (lote) → **HTTP 200** con esa línea en **`ok:false`
  `PRICE_PENDING`** (tolerancia por-ítem: no tumba las demás), y **NO** crea la pieza.

Verificado: backend `inventory.service.ts` → `batchCreate` llama `resolveCreation(line)` por línea, que
lanza `PRICE_PENDING` para aportación sin referencia; el `catch` del lote la marca `ok:false` (no crea).
QA lo confirmó contra el backend real (lote mixto de 4 líneas aportación, 2 con precio y 2 sin →
`summary: requested 4, createdItems 2, failedLines 2`; las 2 sin precio salieron `ok:false` PRICE_PENDING
sin crearse en BD). El front consume ambos tal cual. **No hay solicitud al arquitecto: no existe
divergencia que resolver.**

### Gates
`npm run typecheck` ✓ · `npm run lint` ✓ (0 warnings) · `npm run test` ✓ (50 archivos / 384 tests).

### Seguimiento (2026-08-18) — cierre de 2 hallazgos de dinero + 2 menores (post e2df8e0)

Cuatro FIX sobre el mismo alta M1 (solo `frontend/`), aprobado el commit previo por qa+techlead.

- **FIX 1 (dinero — integridad de inventario):** el alta MASIVA aplicaba `gradingCompany/gradeValue/
  certNumber` del formulario a TODAS las cartas del lote; para gradeadas el `certNumber` es **único por
  slab**, así que un lote de N gradeadas creaba N piezas con el **mismo certificado** (dato corrupto en
  inventario de alto valor). Solución mínima: la multi-selección se **deshabilita en `productType==='graded'`**
  (checkbox `disabled` + nota i18n `admin.m1.gradedNoBulk` es/en explicando el porqué) y al **cambiar a
  graded estando en modo masivo** se apaga `multiSelect` y se `clearBatch()` (no queda carrito de gradeadas
  armado). El alta simple de gradeada (con su cert único) sigue intacta. Verificado en navegador: en graded
  no hay botón "Dar de alta N cartas", solo "Crear item".
- **FIX 2 (dinero — base de costo/P&L):** abrir "Alta de item" reseteaba la mutación/lote pero **NO** los
  campos del formulario → la `acq` (que determina costo/origen, M7) se heredaba de la tanda anterior en
  silencio. Se añadió `resetAddForm()` (acq→`aportacion_en_especie`, productType→`raw`, finish→`normal`,
  sealedSubtype→`box`, gradingCompany→`PSA`, gradeValue→`10`, certNumber/listPrice→'', pct→`70`, y limpia
  set/búsqueda/carta/ubicación) invocado en el handler de apertura junto a los `reset()` existentes. **No se
  cambiaron los defaults iniciales.** Verificado: tras elegir "compra" y reabrir, el alta arranca en
  "Aportación en especie".
- **FIX 3 (cosmético):** el banner de error (P-4) repetía el prefijo — `title`="No se pudo dar de alta" y el
  cuerpo `errorByCode.PRICE_PENDING` **también** empezaba con "No se pudo dar de alta:". Se quitó el prefijo del
  cuerpo (es: "Esta carta aún no tiene precio de referencia; …"; en equivalente) → título corto + mensaje real,
  sin redundancia. Solo i18n. Verificado en navegador con 422 real.
- **FIX 4 (tests):** (a) el test rotulado "replay/idempotencia" solo enviaba UNA vez → **renombrado** a
  "vaciado tras éxito" y **añadidos dos tests separados**: uno prueba que tras un ÉXITO el `batchKey` se
  **renueva** (2ª tanda usa otra key), otro que un **reintento tras FALLO reusa** la misma key (idempotencia
  anti-doble-alta). (b) el test de éxito ahora **asserta la invalidación** de `['admin-inventory']`
  (spy sobre `QueryClient.prototype.invalidateQueries`). Suite M1: 21 tests verdes.

**Nota de contrato (sin cambios):** el FIX 1 es una restricción de UI de captura, no del contrato — el batch
endpoint sigue aceptando graded; simplemente el front deja de ofrecer ese camino peligroso. No hay solicitud al
arquitecto en este pase.

Gates de este pase: `typecheck` ✓ · `lint` ✓ (0 warnings) · `test` ✓ (**50 archivos / 387 tests**).
Evidencia navegador (stack real, mocks OFF, `admin@e2e.local`, set `Pitch Black TEST`): graded multi
deshabilitado, reset a "aportación en especie", banner sin repetir copy, y bulk raw con `compra` creando
folios reales (INV-000019/020) + refresco de la tabla.

## WS «Inventario y vault» — Master set en TODAS partes (2026-08-17, contrato v1.20-master-set-everywhere)

El binder Master Set deja de ser exclusivo de M1: los componentes se **promueven a
`frontend/src/components/master-set/`** (zona compartida, RESERVADA por este stream durante la
promoción, ARCHITECTURE §4.20f) y sirven las TRES vistas del contrato con el MISMO shape:
(i) M1 plataforma, (ii) admin viendo la bóveda de un cliente, (iii) el cliente viendo la suya.
Gates verdes: **lint 0**, **tsc 0**, **test 322/322** (43 files; +10 nuevos), **build OK**
(ruta `/[locale]/admin/vaults` registrada).

### Promoción de componentes (rutas viejas → nuevas)

`frontend/src/app/[locale]/(admin)/admin/m1/master-set/{MasterSetIndex,MasterSetBinder,MasterSetPanel,CellDrawer,PerLineErrors}.tsx`
y `capture.ts` → **`frontend/src/components/master-set/`** (mismos nombres) + nuevo `mode.ts`.
La carpeta vieja se eliminó; `M1View` importa `MasterSetPanel` desde `@/components/master-set/`.
`MasterSet.test.tsx` se movió junto a los componentes.

**Parametrización por scope/capacidades (props, §4.20f):** `MasterSetPanel` recibe
`mode: 'platform' | 'user_vault_admin' | 'user_vault_self'` (+ `userId?` en admin, + `onBuyMissing?`
en self). El componente NO decide permisos: renderiza lo que el DTO trae (el backend omite campos
por scope — `buyable` solo (iii), `owner.email` solo (ii)). Capacidades por modo:
- `platform` (M1, default): carrito de captura por lote, publicación masiva y **ajuste por
  levantamiento físico** (nuevo). Endpoints `/admin/inventory/master-sets[...]`.
- `user_vault_admin`: SOLO lectura (sin captura/publicación/ajuste/venta ni CTA de compra).
- `user_vault_self`: lectura + **CTA de compra en variantes faltantes** con `buyable`.

### Binder por VARIANTE (v1.20)

- Cada celda pinta **una casilla por acabado** (`variants[]`, universo = `availableFinishes`):
  cubierta → chip con conteo; faltante → chip **«HUECO»** por acabado (borde punteado, acento).
  El hueco TOTAL (0 variantes cubiertas) conserva la imagen de catálogo **atenuada** (grid visual).
- Los contadores «X/Y» cuentan **variantes**: índice usa `distinctVariantsOwned`/`catalogVariantCount`/
  `variantCompletionPct`; la celda usa `coveredVariantCount/expectedVariantCount`; el header del
  binder suma expected/covered de las celdas (no depende del summary del índice).
- **Drift de catálogo:** `countsByFinish` con acabado fuera del universo se pinta como chip
  atenuado con «⚠» (se VE la pieza pero no cuenta en covered/expected, regla del contrato).
- El filtro «Con huecos» ahora es por variante (≥1 casilla faltante); «Con piezas» = ≥1 cubierta.

### M1 · Ajuste por levantamiento físico (`POST /admin/inventory/adjustments`)

Sección nueva del `CellDrawer` (solo `platform`): **motivo OBLIGATORIO**
(`encontrada | perdida | danada | error_captura`, labels es/en en `masterSet.adjust.reason.*`).
- `encontrada` → alta mínima raw NM (acabado del universo + qty), `acquisitionType`
  `aportacion_en_especie` explícito (default del contrato). *Simplificación deliberada: el alta
  de una gradeada "encontrada" se hace por el alta normal de M1, no desde el ajuste.*
- `perdida | danada | error_captura` → select de pieza **elegible** (solo `in_stock|listed` de
  plataforma; `reserved` etc. ni se ofrecen) + **nota obligatoria** (el submit se deshabilita sin ella).
- Éxito → Banner con folios; error → Banner con `useErrorMessage` (nuevo copy
  `error.ITEM_NOT_ADJUSTABLE` es/en). **NO hay venta directa manual desde el binder** (contrato).

### Admin «Bóvedas de clientes» (`/[locale]/admin/vaults`)

Página nueva `(admin)/admin/vaults/{page,VaultsView}.tsx` + entrada en `AdminSidebar` (grupo
Operación, tras M1; clave `admin.modules.vaults`, `vault_operator+`, sin candado súper-admin):
- Lista `GET /admin/vaults` → `getAdminVaults({q,sort,page,pageSize})`: nombre, email, piezas,
  **valor estimado** (`formatMoneyCents`), conteo sin precio; orden `value_desc|pieces_desc|name_asc`
  (default `value_desc`) y paginación del contrato.
- Clic en cliente → `MasterSetPanel mode="user_vault_admin" userId=…` (binder de lectura,
  owner con email desde el DTO).

### Storefront «Mi bóveda» (vista (iii))

`VaultView` gana pestañas `Piezas ⇆ Master set` (mismo patrón tablist de M1). La pestaña Master
set monta `MasterSetPanel mode="user_vault_self"` con `onBuyMissing = useCart().add`: el CTA de
una variante faltante con `buyable` agrega la **pieza publicada** (`inventoryItemId`) al MISMO
carrito local/checkout del catálogo (`src/lib/cart.ts`, sin órdenes desde el binder);
`buyable=null` → «No disponible» (no clicable). Banner «Agregada al carrito de compra.» como
feedback. Sin acciones de venta/captura en vistas de cliente.

### Contrato consumido (nuevo en este stream)

- `GET /vault/master-sets[/:setId]` → `getVaultMasterSets` / `getVaultMasterSetBinder`.
- `GET /admin/vaults` → `getAdminVaults`; `GET /admin/vaults/:userId/master-sets[/:setId]` →
  `getAdminVaultMasterSets` / `getAdminVaultMasterSetBinder`.
- `POST /admin/inventory/adjustments` → `createInventoryAdjustment`.
- Tipos v1.20 en `contract.ts`: `MasterSetScope`, `VaultOwnerRefDTO`, `MasterSetVariantDTO`,
  extensiones de `MasterSetSummaryDTO`/`MasterSetCardCellDTO`/`MasterSet*Response`,
  `AdminVaultSummaryDTO/Sort/ListResponse`, `AdjustmentReason`,
  `InventoryAdjustmentRequest/Response`, `MovementReason += 'adjustment'`.
- Mocks (`fixtures.ts`, rama `config.useMocks`): `mockMasterSetIndex/Binder` ganan **scope**
  (`MockMasterSetScope`), `variants[]`+`buyable` (pieza `listed` más barata desde `mockListings`),
  `mockVaultHoldingsByUser` (u-777 = mockHoldings, u-778 chica), `mockAdminVaults`,
  `mockCreateAdjustment` (muta status + `pushMockMovement(reason:'adjustment')`), y
  `ApiFixtureError` genérico (status+code) traducido a `ApiClientError` en `api.ts`.

### i18n

El subtree `admin.m1.masterSet` se movió a **`masterSet.*` top-level** (los componentes ahora son
compartidos storefront+admin; el DESIGN_SYSTEM exige claves por superficie y `admin.*` ya no
aplicaba). Claves nuevas: `masterSet.{variantCount,finishGapAria,driftChipAria,driftNote,ownerVault,
variantsTitle,buyCta,buyAdded,notAvailable}`, `masterSet.adjust.*`, `vault.tabs.*`,
`admin.modules.vaults`, `admin.vaults.*`, `error.ITEM_NOT_ADJUSTABLE`. `completionValue` pasa de
«{owned}/{total} cartas» a «{owned}/{total} variantes». Paridad ES/EN verificada por
`i18n-parity.test.ts`. Los labels del formulario de captura (solo modo platform) siguen en
`admin.m1.*` (M1View los usa también).

### Tests (nuevos/ajustados)

`components/master-set/MasterSet.test.tsx` (12): contador por variantes (3/13 · 23.1%), casilla
HUECO por acabado + `2/3 casillas`, orden natural, captura por lote y bulk-publish (sin cambios de
comportamiento), ajuste (perdida con pieza+nota, encontrada con payload de alta, error
`ITEM_NOT_ADJUSTABLE` traducido), modo admin lectura (owner con email; sin captura/publicación/
ajuste/CTA), modo self (CTA comprable → `onBuyMissing('inv-1003')` vs «No disponible»; índice solo
sets con piezas propias). `VaultsView.test.tsx` (2): lista + drill-down lectura.
`VaultView.test.tsx` (+1): pestaña Master set. Comandos reales: `npm run lint` (0), `npx tsc
--noEmit` (0), `npm test` (43 files / 322 pass), `npm run build` (OK).

### Cierre v1.20.1-adjustments-clarify (2026-08-17, post-gates)

Adaptación al changelog **v1.20.1** del contrato (ajuste por levantamiento físico, §M1):

- **Response nuevo** (`contract.ts`): `InventoryAdjustmentResponse` pasa a `adjustmentIds: string[]`
  (SUSTITUYE al singular `adjustmentId`, alineado 1:1 con `inventoryItemIds`/`folios`; longitud 1 en
  motivos ≠ encontrada) + `idempotentReplay: boolean`. `InventoryAdjustmentRequest` gana `batchKey?`
  SOLO en la rama `encontrada`.
- **batchKey ESTABLE por intento** (`CellDrawer.tsx`, sección de ajuste): en `encontrada` el drawer
  SIEMPRE manda `batchKey` (obligación del front por contrato, cierra BE-47). La clave se genera con
  `localUid('adj')` al montar y **solo rota tras un submit exitoso** (fresco o replay): un doble
  submit / retry tras error reusa la MISMA clave → el backend hace replay idempotente y no duplica
  piezas ni filas de ajuste. Mismo mecanismo `localUid` que el alta por lote (`capture.ts`). Los
  motivos `perdida|danada|error_captura` NO llevan batchKey (400 si viaja; su replay cae en
  `422 ITEM_NOT_ADJUSTABLE`, idempotencia natural).
- **Replay sin efectos dobles:** con `idempotentReplay: true` el drawer muestra el MISMO éxito (un
  solo Banner con folios, sin aviso duplicado) y **NO** refresca agregados (`pieces.refetch()` /
  `onAdjusted` solo corren en procesamiento nuevo — nada cambió en el servidor).
- **Mock** (`fixtures.ts`): `mockCreateAdjustment` devuelve el shape v1.20.1 y replica la
  idempotencia con `mockAdjustmentStore` (batchKey → respuesta guardada; replay con
  `idempotentReplay:true` sin re-crear), espejo de `mockBatchStore` del alta por lote.
- **Tests** (`MasterSet.test.tsx`, 17 specs = +2): payload de `encontrada` CON `batchKey`
  (`expect.stringMatching(/^adj-/)`); batchKey estable en retry tras error y rotación tras éxito;
  replay → mismo éxito sin re-consultar piezas (`getAdminInventory` no vuelve a llamarse). Gates
  reales: `npx tsc --noEmit` 0 · `npm run lint` 0 · `npm test` **43 files / 324 pass** · `npm run
  build` OK.
- **Deuda del veredicto techlead** anotada en `docs/TECH_DEBT.md`: **FE-25** (props de
  `MasterSetPanel` permiten estados ilegales → unión discriminada sin default de `mode`) y **FE-26**
  (`PlatformPiecesSection` acumula publicación+ajuste; extraer `AdjustSection` y eliminar el estado
  derivado de `adjustFinish`). Abiertas, no bloqueantes.

### Notas para QA / arquitecto

- Sin desviaciones de contrato. El CTA de compra vive en el **drawer** de la celda (la celda del
  grid abre el drawer, patrón existente); el contrato solo exige que el clic agregue la pieza al
  flujo de compra normal, y así se hace (carrito local → checkout §4).
- Los E2E Playwright existentes (`e2e/*.spec.ts`) no referencian las claves movidas; pendiente de
  QA correr smoke E2E de los flujos tocados contra el stack levantado.

### Merge con main (2026-08-17): integración con «Catálogo y precios» / WS-H retiros

Al integrar este stream con `main` (que traía WS-H retiros v1.17 y el pulido de veredicto WS-E),
los cambios de main sobre la ruta VIEJA `(admin)/admin/m1/master-set/` se **portaron a los
componentes promovidos** `components/master-set/`:
- `MasterSetPanel`/`CellDrawer`: **batchKey estable por sesión** también en captura por lote
  (`batchKeyRef`/`ensureBatchKey`) y en bulk-publish (`publishKeyRef`) — el patrón que ya usábamos
  en el ajuste (`localUid('adj')`) queda ahora en las tres mutaciones idempotentes.
- `CellDrawer`: **piezas no-publicables deshabilitadas** (checkbox `disabled` + hint
  `masterSet.notPublishableHint`, `PUBLISHABLE_STATUSES = ['in_stock','listed']`).
- `MasterSetBinder`/`CellDrawer`: `FINISH_ORDER` desde el módulo único **`@/lib/finish`** (dedup
  de main) en lugar de las consts locales.
- `MasterSet.test.tsx`: se portó el test de checkbox deshabilitado (reemplaza al de
  ITEM_NOT_PUBLISHABLE por-línea vía UI, inalcanzable con la nueva UX) y el de batchKey estable de
  carrito. i18n: `notPublishableHint` se agregó al namespace top-level `masterSet.*` (el subtree
  `admin.m1.masterSet` de main se descartó: ya no existe ningún consumidor).
- Interacción real entre streams: el holding mock `inv-3001` (`mockVaultHoldingsByUser`, este
  stream) ganó los campos v1.17 requeridos (`shipmentState:null`, `activeShipmentId:null`,
  `withdrawable:true`).
- Renumeración post-merge: contrato v1.18→**v1.20** / v1.18.1→**v1.20.1**, ARCHITECTURE
  §4.18→**§4.20**, migración M-22 (inventory)→**M-24**, deuda FE-20/FE-21→**FE-25/FE-26**,
  BE-41→BE-47. Gates del árbol mergeado: **tsc 0 · test 341/341 (45 files) · lint 0 · build OK**.

## WS-H frontend · Retiro visible para el cliente (badge "EN RETIRO" + rastreo) (2026-08-17)

Implementa el ciclo de RETIRO visible en la bóveda según **contrato v1.17-withdrawal-lifecycle** (§3
HoldingDTO, §5 rastreo del cliente). Solo `frontend/` + este doc. **0 cambios de contrato/backend**; se
consume el contrato como interfaz (nada depende de detalles internos del backend). Patrón real+mock
(`config.useMocks`), tokens/`shadow-focus` respetados. Gates: **tsc 0**, **vitest 313** (42 files),
**e2e mock 45 passed** (1 flake de `auth.spec` que pasa al re-correr; no relacionado).

### 1) Tipos (contrato §3/§5) — `src/types/contract.ts`
- `HoldingDTO` gana `shipmentState: ShipmentActiveStage | null`, `activeShipmentId: string | null`,
  `withdrawable: boolean` (los tres **requeridos**, como el contrato). Nuevo alias
  `ShipmentActiveStage = 'solicitado'|'picking'|'guia'|'enviado'`.
- `ShipmentDTO` (== `ClientShipmentDTO` del contrato §5) se **enriquece** con `addressSnapshot`,
  montos (`shippingFeeCents/ivaCents/processingFeeCents/totalCents`), timestamps por etapa
  (`requestedAt/pickingAt/shippedAt`, `deliveredAt` ya existía) e `items[].finish`. Los campos nuevos
  son **opcionales** para tolerar productores/mocks parciales (p. ej. la respuesta de captura de guía M4).

### 2) "Mi Bóveda" (`vault/VaultView.tsx` + `components/domain/WithdrawalBadge.tsx`)
- **Badge "EN RETIRO":** nuevo `WithdrawalBadge` (reusa el primitivo `Badge`, texto mono en versalitas,
  `outline` acento) que se pinta cuando `shipmentState !== null`: chip `EN RETIRO` + el **label de etapa
  del contrato §5** (namespace i18n `shipmentStage.*`, distinto de `status.shipment.*` operativo). Con
  `activeShipmentId`, el badge es un **enlace** al detalle del retiro (`/shipments/:id`) = deep-link
  bóveda→rastreo. Se apila bajo el badge de titularidad en la columna de estado.
- **Gating de RETIRAR:** el botón/enlace usa **`withdrawable`** como fuente ÚNICA de verdad (antes se
  derivaba de `ownershipStatus==='settled'`). Si `!withdrawable` → botón deshabilitado con hint accesible
  (`title` + `aria-label`): "en retiro" si hay envío activo, "solo liquidadas" si aún es `pending`. Ya no
  se descubre el `409/422` al intentar.

### 3) Rastreo de retiros del cliente (contrato §5)
- **`api.ts`:** `getShipments()` (ya existía, envelope `{ data }`) + nuevo **`getShipment(id)`**
  (`GET /shipments/:id`) con rama real+mock.
- **Lista ("Mis retiros"):** la sección de `ShipmentsView` se enriquece — cada retiro muestra la **etapa
  legible** (`shipmentStage.*`), dirección (ciudad/estado del `addressSnapshot`), **total** del retiro,
  guía/tracking y sus **cartas** (folio, nombre, set). El id del retiro es un **deep-link** al detalle.
  La lista de cartas y las acciones de disputa (F6) se **unificaron** en un solo `<ul>` (antes duplicaban
  el nombre de cada carta en dos bloques). La lista **seleccionable** del alta de retiro ahora filtra por
  `withdrawable` (un item settled pero ya EN RETIRO cae en "no elegibles", con su badge + deep-link).
- **Detalle (`shipments/[id]/ShipmentDetailView.tsx`, ruta nueva `shipments/[id]/page.tsx`):** destino del
  deep-link. Muestra la etapa legible, la línea de tiempo (`useShipmentClientSteps` con la tabla §5),
  dirección (snapshot, lectura defensiva), total desglosado (`AmountBreakdown` reconstruido desde los
  montos del DTO; `ivaRatePct` no viaja en §5 → se deriva de iva/fee, default 16) y las cartas
  (folio, nombre, set, número, acabado). Estados carga/error/no-encontrado explícitos (`QueryState`).
- **Navegación:** "Mis retiros" añadido al `StorefrontHeader` (privado, junto a "Mis órdenes") → `/shipments`.

### 4) i18n (ES/EN, paridad verde)
- `nav.shipments`, `vault.inWithdrawal` / `inWithdrawalHint` / `trackWithdrawal`,
  `shipments.{backToList,detailTitle,itemsInWithdrawal,shippingAddress,addressUnavailable,withdrawalTotal}`,
  y el bloque top-level **`shipmentStage.*`** (tabla normativa etapa→texto cliente del contrato §5).

### 5) Mocks (real+mock siguen funcionando)
- `mockHoldings`: los 4 holdings ganan los campos v1.17; el **sellado (`inv-1008`) queda EN RETIRO**
  (`shipmentState='enviado'`, `activeShipmentId='shp-7001'`, `withdrawable=false`); el resto retirables/
  pending según su titularidad. `mockShipments` enriquecidos (address/montos/timestamps/finish); `shp-7001`
  (`enviado`) contiene `inv-1008` para que el deep-link sea consistente.

### 6) E2E (mock)
- `e2e/vault.spec.ts`: +2 tests — badge "EN RETIRO" + etapa + RETIRAR deshabilitado; deep-link del badge al
  detalle. `e2e/shipments.spec.ts`: +1 — la vista de rastreo lista un retiro con sus cartas y abre el
  detalle (dirección + cartas). Todos mock-only (dependen del fixture de retiros); el patrón `@real`
  existente se conserva.

### Solicitudes al arquitecto
- Ninguna. El contrato v1.17 (§3/§5) fue suficiente para implementar el flujo completo. Nota menor: el DTO
  de rastreo §5 no incluye `ivaRatePct` en los montos; el front lo deriva de `iva/shippingFee` (default 16)
  para el desglose. Si se prefiere exponerlo explícito, sería un aditivo sin migración (no bloquea).

## WS-E frontend · Pulido de veredicto (batchKey estable + UX bulk-publish + dedup) (2026-08-17)

Cierra hallazgos NO bloqueantes del veredicto sobre WS-E (Master Set). Solo `frontend/` + este doc +
`docs/TECH_DEBT.md`. **0 cambios de contrato/backend**; no toca lógica de dinero (SEC-A1 intacto: el
precio de venta lo deriva el backend). Patrón real+mock, tokens y `shadow-focus` respetados. Gates
verdes: **lint 0**, **tsc 0**, **test 313** (42 files; +1 neto: se reemplazó 1 test y se añadieron 2),
**build** OK.

### 1) [techlead #1] `batchKey` ESTABLE por sesión de carrito (anti-duplicado)
- **Problema:** `batchKey` se generaba con `localUid()` DENTRO del `mutationFn` en cada `.mutate()`
  (`MasterSetPanel` carrito y `CellDrawer` bulk-publish). Un request que expira por red pero SÍ se
  procesó, al reintentarse generaba una key NUEVA → el backend ya no lo veía como replay → **piezas
  duplicadas** (la `batchKey` es la guardia anti-duplicado server-side).
- **Fix (`MasterSetPanel.tsx`):** `batchKeyRef = useRef<string|null>(null)` + `ensureBatchKey()` que
  la genera UNA vez (al empezar a llenar el carrito, en `addToCart`, y como fallback en `mutationFn`).
  Se **regenera solo tras éxito confirmado** (`onSuccess`, tras limpiar el carrito → `batchKeyRef.current
  = null`) o al vaciar el carrito manualmente (`clearCart`). Un reintento por timeout reusa la MISMA key
  → replay idempotente → no duplica.
- **Fix (`CellDrawer.tsx`):** mismo patrón con `publishKeyRef`/`ensurePublishKey()` para el bulk-publish;
  se renueva tras un éxito confirmado (tras limpiar la selección).

### 2) [qa MENOR] Deshabilitar piezas no-publicables en el bulk-publish del `CellDrawer`
- La lista de piezas trae TODOS los status; solo `{in_stock, listed}` son publicables (contrato §M1
  v1.16.1). Ahora el checkbox de una pieza cuyo status NO está en ese conjunto se **deshabilita** (input
  `disabled` + fila `opacity-60`/`cursor-not-allowed`) con un **hint** (`notPublishableHint`) del porqué.
  Const `PUBLISHABLE_STATUSES: InventoryStatus[] = ['in_stock','listed']`. El guardarraíl server-side
  (`ITEM_NOT_PUBLISHABLE`) se queda; esto es solo UX para no ofrecer una acción que va a fallar.

### 3) [techlead #3] Dedup de `FINISH_ORDER`
- Estaba triplicada (M1View / MasterSetBinder / CellDrawer) y además en ShopFilters / BuylistView (5
  copias). Se movió a un módulo único **`@/lib/finish.ts`** (`export const FINISH_ORDER`) y se importa en
  los **5** consumidores. `Finish` (tipo) se quitó del import de `ShopFilters` por quedar sin uso.

### i18n (paridad ES/EN)
`admin.m1.masterSet.notPublishableHint` (ES/EN).

### Tests (`MasterSet.test.tsx`)
- **batchKey estable:** el reintento del mismo submit lógico reusa la MISMA key (mock que "expira" en la
  1ª llamada); un carrito nuevo tras éxito → key NUEVA.
- **bulk-publish UX:** el checkbox de la pieza `reserved` (INV-000203) está `disabled` + muestra el hint;
  la `in_stock` (INV-000201) queda habilitada y el lote solo incluye la publicable. (Reemplaza al test
  previo de ITEM_NOT_PUBLISHABLE por-línea vía UI, ya inalcanzable al no poder marcar la reservada; la
  tolerancia por-línea sigue cubierta por el test de PRICE_PENDING.)

### Sin solicitudes al arquitecto
0 cambios de contrato/backend. Deuda FE no bloqueante restante registrada en `docs/TECH_DEBT.md`.

## WS-E frontend — Master Set + captura/publicación por lote (2026-08-17, contrato §M1 v1.16.1)

Vista **Master Set** en M1 (índice de sets → binder por número) + **carrito de captura por lote** (#12)
y **publicación masiva** (bulk-publish), contra los 4 endpoints nuevos del §M1. Solo `frontend/` +
esta nota. Patrón real+mock, `shadow-focus`, tokens. Gates verdes: **lint 0**, **tsc 0**,
**test 312** (42 files; +8 nuevos en `MasterSet.test.tsx`), **build** OK.

### Contrato consumido (§M1 v1.16-master-set / v1.16.1)

- `GET /admin/inventory/master-sets` → `getMasterSets({q,page,pageSize,sort})` (`MasterSetIndexResponse`).
- `GET /admin/inventory/master-sets/:setId` → `getMasterSetBinder(setId)` (`MasterSetBinderResponse`).
- `POST /admin/inventory/items/batch` → `batchCreateItems(payload)` — manda `batchKey` en el body **y**
  como header **`Idempotency-Key`** (equivalentes). Respuesta tolerante por-línea.
- `POST /admin/inventory/items/bulk-publish` → `bulkPublishItems(payload)` — errores por-línea
  (`ITEM_NOT_PUBLISHABLE`, `PRICE_PENDING`) que no tumban el resto.

Tipos nuevos en `src/types/contract.ts` (v1.16.1): `MasterSetSummaryDTO`, `MasterSetSort`,
`MasterSetIndexResponse`, `MasterSetCardCellDTO` (con `countsByFinish`/`totalCount`/`gaps` implícitos por
`totalCount=0`/`isSecretRare`/`numberSort`), `MasterSetBinderResponse`, `BatchInventoryItemInput`,
`BatchCreateInventoryRequest`, `BatchInventoryLineResult`, `BatchCreateInventoryResponse`,
`BulkPublishLineInput/Request`, `BulkPublishLineResult`, `BulkPublishResponse`.

### UI (MVP)

- **Pestañas "Piezas" / "Master Set"** en `M1View.tsx` (§6.6, subrayado 2px en la activa). "Piezas" = la
  tabla plana actual intacta; los botones "Alta de item" / "Ubicaciones" solo se muestran en esa pestaña.
- **Índice** (`master-set/MasterSetIndex.tsx`): grid de sets con **completitud** (`distinctCardsOwned /
  catalogCardCount` + barra `progressbar`) y **conteo de piezas**. Búsqueda (`q`), orden (`release_desc`
  default / `completion_asc` / `pieces_desc`) y paginación reales. Click → binder.
- **Binder** (`MasterSetBinder.tsx`): cuadrícula por número. **Confía en el orden natural del backend —
  NO re-ordena números en cliente** (los filtros locales usan `Array.filter`, que preserva el orden).
  Por celda: número, nombre, imagen (`loading=lazy` + `content-visibility:auto`), **chips de cantidad por
  acabado (#11)** desde `countsByFinish`, **huecos** (`totalCount=0`, borde punteado + `HUECO`) y **badge
  `isSecretRare`** (solo display, scrim de tinta §7.2b). Filtros locales: acabado, con/sin piezas, secret
  rares.
- **Drawer por celda** (`CellDrawer.tsx`): (a) alta rápida → añade una `CaptureLine` al carrito; (b)
  **publicar piezas de esa carta** — lista las piezas (`GET /admin/inventory/items?cardId=`), selección
  múltiple → `bulkPublishItems` en 1 request, con **render tolerante por-línea**.
- **Carrito de captura** (`MasterSetPanel.tsx`): acumula líneas de varias celdas → `batchCreateItems` en 1
  request; `batchKey` nuevo por submit (idempotencia server-side). Resultado tolerante por-línea
  (`PerLineErrors.tsx`): las líneas ok muestran su folio, las inválidas su error (código traducido con
  fallback al mensaje del backend). Tras el alta se invalidan `master-sets`/`master-set-binder`/
  `cell-pieces` (los agregados cambian).

### Decisiones / notas

- **Sellado fuera del master-set:** el binder es una cuadrícula *por número*; los productos sellados (sin
  número) se siguen gestionando en la pestaña "Piezas". El alta rápida del drawer ofrece **raw/graded**.
- **Reuso:** el picker de catálogo del alta manual (pestaña Piezas) ya existía; el binder es un componente
  nuevo (el grid del picker de cotización no encajaba 1:1 con la celda agregada, se priorizó claridad).
- **Mock:** `mockMasterSetIndex/Binder/BatchCreate/BulkPublish` en `fixtures.ts` derivan TODO de
  `mockCards`+`mockInventory` (consistente y determinista). Se añadieron 3 piezas de Charizard (base1) para
  ejercitar chips multi-acabado (`normal:3`, `reverse_holo:1`) y una pieza `reserved`
  (→ `ITEM_NOT_PUBLISHABLE`); Zapdos in_stock sin referencia ejercita `PRICE_PENDING`. Se añadió
  `error.ITEM_NOT_PUBLISHABLE` a `messages/{es,en}.json`.

### Sin solicitudes al arquitecto

No hizo falta ningún endpoint/campo nuevo: el contrato §M1 v1.16.1 cubre índice, binder, batch y
bulk-publish. **No se tocó** `docs/API_CONTRACT.md` ni `backend/`.

## WS-G Pass 2 (G3) — Reducir la sobrecomplicación del admin (2026-08-17)

Cinco arreglos de UX del back-office señalados por la evaluación, **frontend-only** (0 cambios de
contrato/backend; NO se tocó lógica de dinero — solo presentación, labels, navegación y etapa de las
acciones). Patrón real+mock, `shadow-focus`, tokens y §9.2 respetados. Gates verdes: **lint 0**, **tsc 0**,
**test 304** (41 files; +9 nuevos), **build** OK.

### M5 (aprobar ventas) · de pila plana a cola por etapa — `admin/m5/M5View.tsx`
- **Pestañas por etapa** (`M5_TABS`): "Por recibir" (`cotizada`), "Verificando" (`recibida`+`verificacion`),
  "Por pagar" (`aprobada`), "Cerradas" (`pagada`/`rechazada`/`abandonada`). Cada pestaña muestra su conteo; la
  etapa activa por defecto es la **primera con solicitudes** (`firstNonEmpty`), respetando la elegida por el
  operador. Las solicitudes se agrupan por `status`.
- **Buscador** por folio/usuario reusando la clave i18n **`admin.searchGlobal`** (antes huérfana): filtra `all`
  por `id`/`userId` (case-insensitive); los conteos por pestaña reflejan el filtro.
- **Acciones por etapa, no las 7 siempre:** aprobar/ajustar/rechazar solo si `req.status ∈ {recibida,
  verificacion}` (`canDecide`) → una `cotizada`/`aprobada` ya no ofrece decidir carta; revelar CLABE / pagar
  SPEI solo en `verificacion`/`aprobada` (`showMoneyOut`); en `pagada` se muestra una nota "Pagada por SPEI".
  Convertir a inventario se conserva como estaba (visible, deshabilitado hasta `aprobada`).
- **Vendedor con enlace a M6:** la cola admin (`AdminBuylistDTO`) **no trae el nombre resuelto** ni hay endpoint
  para ello (ver "Solicitud al arquitecto"); se muestra el `userId` como **enlace** a la ficha 360° en
  `/admin/m6?user=<id>`. `M6View` lee `?user=` (via `useSearchParams`, null-safe) y abre el detalle directo
  reusando `GET /admin/users/:id` — **sin endpoint nuevo**.
- **Imagen de catálogo por ítem** (`CardImage`, `imageSmallUrl`) como referente visual para verificar la carta
  física.

### M2 (precios) · jerarquía + % desambiguado — `admin/m2/M2View.tsx`
- **UNA acción primaria "Actualizar precios"** al tope (sección nueva con el trigger de `triggerPriceIngest`,
  botón `lg`), y una sección **"Operaciones avanzadas de catálogo / sync"** que agrupa/de-enfatiza el resto:
  sync de precios de bóveda (botón bajado a `secondary` y movido aquí) + catálogo (backfill / importar sets /
  re-sync-all / por-set). La sub-navegación **no** se reescribió (fase-2, abajo). El selector de proveedor sigue
  en su sección "Ingesta masiva de precios" (config, no CTA); el trigger se movió al tope (no se duplicó, para
  no romper `findByRole` único).
- **Ejemplos en línea del %** en las dos tablas de reglas, porque el `%` significa lo OPUESTO en cada una:
  buylist `buylistRules.example` ("pagas MX$40 por una carta de MX$100 (40%)") y venta `salesRules.example`
  ("vendes en MX$115 una carta de MX$100 (+15%)").

### M1 (inventario) · enums traducidos + confirmación + alta manual sin buylist
- **Enums traducidos (§9.2, "nunca el enum crudo"):** `productType` → `admin.m1.productTypeLabel.{raw,graded,
  sealed}` ("Suelta (raw)"/"Gradeada"/"Sellado", igual que el cliente) y `acquisitionType` →
  `admin.m1.acquisitionLabel.*`, en los **selects** del alta y en la columna/detalle "Tipo" (`M1View.tsx` +
  `ItemDetailModal.tsx`).
- **Confirmación en "Marcar perdida/dañada" (§7.6):** el botón ya no dispara la mutación directo; abre un modal
  de confirmación (patrón M3/M8) con CTA `mark.confirmCta`.
- **Alta manual sin `buylist`:** `ACQ` pasó a `['aportacion_en_especie','compra']` (buylist es la conversión
  automática de M5, no alta manual). El **label** de `buylist` se conserva para traducir items ya convertidos en
  tabla/detalle.

### Dashboard admin · cola de trabajo accionable + rol legible
- Los conteos de "Cola de trabajo" (envíos/buylist/disputas/precios) y el de "Salud de datos" (precios
  pendientes) son **enlaces** a su módulo (M4/M5/M8/M2) (§7.8), con subrayado en hover y `shadow-focus`
  (`AdminDashboard.tsx`).
- **Rol legible** en el topbar: `admin.roles.{customer,vault_operator,super_admin}` en vez del enum crudo; el
  valor técnico queda en `aria-label`/`title` (`AdminTopbar.tsx`).

### i18n (paridad ES/EN)
`admin.roles.*`; `admin.m5.{tabs.*,searchLabel,emptyTab,emptySearch,seller,sellerLink,paidNote}`;
`admin.m1.{productTypeLabel.*,acquisitionLabel.*,mark.confirmTitle/confirmQuestion/confirmCta}`;
`admin.m2.{updatePrices.*,advancedOps.*,buylistRules.example,salesRules.example}`.

### Mock
`fixtures.ts`: +`sr-3003` (`AdminBuylistDTO` en etapa `aprobada`) para poblar la pestaña "Por pagar" y ejercer
el gating de acciones (pago/convert sí, aprobar/rechazar no). Marcado como fixture G3.

### Tests (+9)
`M5View.test.tsx` (+4: pestañas filtran por etapa, acciones solo de la etapa, buscador, enlace del vendedor a
M6 `?user=` — con stub de `@/i18n/navigation`); `M1View.test.tsx` (+3: tipo traducido en detalle, selects sin
`buylist` y con labels legibles, confirmación antes de marcar); `M2View.test.tsx` (+2: ejemplos del % por
tabla); `AdminDashboard.test.tsx` (nuevo: los conteos son enlaces a su módulo).

### Diferido → fase-2 (ux-ui + frontend, NO en este pase)
- **Rewrite completo de la sub-navegación de M2** (más allá de agrupar en "avanzadas"): reorganizar catálogo/sync
  en un flujo con su propia navegación/tabs. Cosmético/estructural, transversal.
- **Consistencia visual admin §3.2** (h1 serif en los 10 `M*View`): hoy conviven `text-h1 font-bold` (sans) y el
  patrón serif de `AdminDashboard`. Cosmético y transversal; conviene un pase único de ux-ui + frontend.

### Solicitud al arquitecto (no bloqueante, sin cambio en este pase)
- **Nombre del vendedor en la cola de M5:** `AdminBuylistDTO` (§M5) expone solo `userId`; para mostrar el nombre
  sin un fetch por-fila haría falta que el listado incluya `userName` (o un `user: { id, name }`), simétrico a lo
  que ya se hizo en otros DTOs admin. Mientras tanto se muestra el `userId` como enlace a la ficha 360° (M6).

## WS-G Pass 1 — Dedup de config de dinero (G1) + gates de acceso (G2) (2026-08-17)

Dos arreglos de admin, **frontend-only** (backend NO cambia; keys de settings intactas como rollback).
**G1 TOCA config de DINERO** → va a veredicto. Solo `frontend/` + este doc. Patrón real+mock, `shadow-focus`
y tokens del design system respetados; **0 cambios de contrato**. Gates verdes: **lint** (0), **tsc** (0),
**test 294** (40 files; +6 nuevos), **build** OK.

### G1 · Dedup de config de dinero M2 vs M10 (`M10View.tsx` + i18n)
- Del array `DIALS` se **quitaron** dos diales de dinero duplicados/muertos: `salesMarkupPct` (dial MUERTO —
  el precio de venta lo deriva `SALES_PRICE_RULES`+fallback de M2 §5; el contrato lo marca DEPRECADO; quitarlo
  del UI es inerte) y `fxBufferPct` (DUPLICADO real del mismo `fx_buffer_pct`; el editor canónico es **M2 §3
  FX**). Las keys **siguen** en el backend y en `SettingsDTO` (types = espejo del contrato) como rollback;
  solo dejan de editarse desde M10. `SettingsDTO` **no** se tocó.
- Los 3 diales de proveedor `pricingProviderRaw/Graded/Sealed` pasaron de **texto libre** (un typo rompía la
  resolución de precio) a **`Select` validado** con las 4 opciones válidas del contrato (`PriceSource`):
  `pokemontcg_io | pokemonpricetracker | poketrace | manual`. Nuevo `DialKind = 'provider'` + constante
  `PRICE_PROVIDER_OPTIONS`; `fromInputValue('provider')` devuelve el texto tal cual (igual que `text`). El
  render bifurca: `provider` → `<Select>` (design system, `shadow-focus` en el wrapper), el resto → `<Input>`.
- **Relabel** para distinguir del `priceProvider` del ingest BULK (M2 §3b): "Proveedor de referencia
  por-carta (raw/graded/sellado)" / "Per-card reference provider (…)". Son conceptos **distintos** y ambos
  viven. Los labels muertos `salesMarkupPct`/`fxBufferPct` se **eliminaron** de `messages/{es,en}.json`
  (paridad verificada por `i18n-parity`).

### G2 · Gate de rol admin + logout admin + guard de rutas privadas
- **Gate de rol (`AdminShell.tsx`):** antes solo exigía **sesión** (`requireAuth = !config.useMocks`) → un
  customer logueado veía todo el chrome del back-office. Ahora, en modo real, además de sesión exige **rol**
  ∈ `{vault_operator, super_admin}` (nueva const `ADMIN_ROLES`; el rol sale de `useSession().user.role`).
  `!isAuthenticated` → `replace('/login?next=…)`; autenticado pero **rol de cliente** → `replace('/')`. El
  render de bloqueo (loader) ahora también cubre `!hasAdminRole` (nunca se pinta el chrome a un customer).
  Modo mock/demo intacto (RoleProvider simula super_admin por defecto; `requireAuth` sigue apagado).
- **Logout admin (`AdminTopbar.tsx`, P-1):** el topbar no tenía logout. Se añadió un control que reusa
  `logout()` (`api.ts`, limpia access+refresh+user vía WS-B) + `useRouter().push('/')`, mismo patrón que
  `StorefrontHeader.onLogout`. Copy `nav.logout` ya existía (ES/EN).
- **Guard de rutas privadas storefront (`PrivateRouteGuard.tsx` NUEVO + `(storefront)/layout.tsx`):** antes
  `/vault`,`/orders` solo ocultaban el link; el acceso directo por URL renderizaba la vista y daba un banner
  401 críptico. El token vive en **localStorage** (no cookie) → guard de **cliente**, no middleware server.
  **Espeja AdminShell:** activo solo en modo real (`requireAuth = !config.useMocks`; inerte en mock/demo). En
  una ruta privada (prefijos `/vault`, `/orders`, `/shipments`, `/checkout`) con `ready && !isAuthenticated`
  → `replace('/login?next=<ruta>')` y muestra loader (nunca el flash de contenido privado). Rutas públicas y
  sesión válida pasan directo. Se montó envolviendo `{children}` dentro del `<main>` del layout storefront
  (un solo punto; no toca las páginas privadas individuales).

### Tests (+6; total 294 en 40 files)
- `M10View.test.tsx` (+2): ya NO aparecen los diales `Markup de venta`/`Colchón FX`; el proveedor por-carta
  es un `<select>` con exactamente las 4 opciones válidas del contrato (no texto libre).
- `AdminShell.test.tsx` (+1): un **customer logueado** NO ve el back-office → `replace('/')` (no `/login`,
  ya hay sesión) y nunca se pinta el chrome.
- `AdminTopbar.test.tsx` (NUEVO, 1): el control de logout llama `logout()` y rutea a `/`.
- `PrivateRouteGuard.test.tsx` (NUEVO, 4): ruta privada sin sesión → `/login?next=<ruta>` (con preservación
  del destino por prefijo); ruta pública sin sesión → sin redirect; ruta privada con sesión → renderiza.
- `PrivateRouteGuard.mock.test.tsx` (NUEVO, 1): en modo mock el guard es **inerte** (demo sin backend).

### Solicitudes al arquitecto
- **Ninguna.** 0 cambios de contrato/backend. Las keys deprecadas/duplicadas siguen vivas en el backend
  (rollback); el gate de rol y los guards son defensa de UI — el backend sigue siendo la autoridad (401/403).

## WS-F Pass 2 — Cablear 3 flujos usuario↔admin rotos/sin UI (F4/F5/F6) (2026-08-17)

Cablea tres flujos que existían en backend (+ tipos) pero no en UI o estaban rotos: **pipeline de
envío admin (F4)**, **responder ajuste de venta (F5)** y **disputas del cliente (F6)**. **SOLO
`frontend/`** + este doc; **0 cambios de contrato/backend** (todos los endpoints y guardas ya
existían). TOCA DINERO/estado → triple veredicto. Patrón real+mock de `api.ts` respetado (cada método
con rama `apiRequest` + rama mock gateadas por `config.useMocks`); `shadow-focus` y tokens intactos.
Gates verdes: **lint** (0), **tsc** (0), **test 285** (37 files; +18 nuevos), **build** OK.

### F4 · Pipeline de envío admin (`M4View.tsx` + `api.ts`)
- `api.ts`: `updateAdminShipmentStatus(id, to)` → `PATCH /admin/shipments/:id/status` body `{ to }`.
  Nuevo `SHIPMENT_TRANSITIONS` exportado = **espejo exacto** de `ShipmentsService.TRANSITIONS`
  (backend); la rama mock valida la legalidad con esa tabla (transición ilegal → `409 CONFLICT`) y
  espeja el estado en `mockAdminShipments` (+ `mockShipments` si el id coincide).
- `M4View`: botones por-estado que ofrecen **solo transiciones legales** vía `MANUAL_TRANSITIONS`
  (subconjunto): `guia→enviado`, `enviado→entregado` y `→cancelado` según etapa. Se **excluye**
  `solicitado→picking` (WEBHOOK) y `picking→guia` (lo hace la captura de guía ya existente).
  Transiciones hacia adelante = botón directo con banner de éxito; `cancelado` = **modal de
  confirmación** (destructivo). Al éxito invalida `['admin-shipments']` + `['admin-picking-list']`
  (mismo patrón que la mutación de guía). Error real vía `useErrorMessage`.

### F5 · Responder ajuste de venta (`BuylistView.tsx` + `api.ts`)
- `api.ts`: `respondSellRequest(id, decision)` → `POST /buylist/requests/:id/respond` body
  `{ decision }`. El backend devuelve la fila `SellRequest` (sin items); el front solo usa el éxito e
  invalida `['sell-requests']`. La rama mock espeja el efecto (`ajustada→aprobada` en accept, request
  `→aprobada`; `→rechazada` en decline) sobre `mockSellRequests` para que el refetch lo refleje.
- `BuylistView` (Mis solicitudes): `hasAdjustedItems = r.items.some(it => it.itemStatus === 'ajustada')`
  (detección **item-level**, no request-level). Con true, bloque de ajuste con el **precio ajustado**
  (`approvedPriceCents` por ítem, con el original tachado) + botones **Aceptar** / **Rechazar** →
  `respondMutation` → invalida `['sell-requests']`. El precio por-ítem `ajustada` muestra
  `approvedPriceCents` (vigente) en vez del `quotedPriceCents`.

### F6 · Disputas del cliente (`ShipmentsView.tsx` + `api.ts` + `contract.ts`)
- `contract.ts`: tipos **cliente** nuevos `CreateDisputeInput`, `CreateDisputeResponse`
  (`{ disputeId, status, type, deadlineAt, evidenceContact }`) y `ClientDisputeDTO` (fila de
  GET /disputes; `evidenceContact` opcional porque el listado crudo no lo trae, solo el 201). Distintos
  del `DisputeDTO` admin ya existente. `ShipmentDTO` gana `deliveredAt?` y el item gana `productType?`
  (ambos alimentan el UI-gate; el backend `toClientShipment` ya devuelve `deliveredAt`, `productType`
  es best-effort del mock — ver "Notas para arquitecto").
- `api.ts`: `createDispute({ inventoryItemId, description })` → `POST /disputes`; `getDisputes()` →
  `GET /disputes` (unwrap `{data}`); `getDispute(id)` → `GET /disputes/:id`. La rama mock espeja las
  guardas §7 (graded → `422 NOT_RAW`, fuera de 7d → `422 DISPUTE_WINDOW_CLOSED`), deriva el `type` del
  productType, y hace `unshift` en `mockClientDisputes`.
- `ShipmentsView`: en un envío **entregado**, cada ítem elegible ofrece **"Abrir disputa"**
  (`canOpenDispute`): status `entregado` + ítem no gradeado (si se conoce productType) + dentro de la
  ventana de 7 días (si hay `deliveredAt`) + sin disputa **activa** (cruce con `getDisputes`, estados
  `abierta`/`en_revision` → muestra "Disputa abierta" en su lugar). **Modal de creación** con textarea
  (min 10 chars) → `createDispute`; tras el 201 reutiliza **`DisputeEvidenceContact`** (M8) con el
  `evidenceContact` + plazo. Sección **"Mis disputas"** (`getDisputes`) con estado + plazo. UI-gate =
  best-effort para evitar 403/422 como primer feedback; el backend sigue siendo la autoridad.

### Tipos / mocks / i18n
- `fixtures.ts`: `mockShipments` gana un envío **entregado reciente** (`shp-7002`, `deliveredAt`
  dinámico a 2d) con un ítem raw elegible + uno graded no elegible; `mockClientDisputes` (lista
  cliente); `mockSellRequests` gana `sr-3002` con un ítem `ajustada` (+`approvedPriceCents`); export
  `DISPUTE_EVIDENCE_CONTACT`.
- i18n (paridad ES/EN): `shipments.dispute.*`, `buylist.adjust.*`, `admin.m4.statusActions.*`. Los
  códigos `DISPUTE_WINDOW_CLOSED`/`NOT_RAW` ya estaban en el catálogo `error.*` (se reutilizan).

### Tests (+18)
- `api.test.ts` (+8): rama mock — F4 transición legal/ilegal (409), F5 accept mueve `ajustada→aprobada`,
  F6 raw ok (type derivado) + graded `NOT_RAW`; rama REAL (fetch stubeado) — F4 `PATCH …/status {to}`,
  F5 `POST …/respond {decision}`, F6 `POST /disputes {…}` + propaga `DISPUTE_WINDOW_CLOSED`, `GET
  /disputes` (unwrap data).
- `M4View.test.tsx` (+3): "Marcar entregado" → PATCH enviado→entregado + banner; "Cancelar" pide
  confirmación → PATCH →cancelado; envío entregado (terminal) sin botones de transición.
- `BuylistView.test.tsx` (+3): el bloque de ajuste aparece **solo** con ítems `ajustada`; no aparece
  sin ellos; "Aceptar ajuste" llama `respondSellRequest(id,'accept')`.
- `ShipmentsView.test.tsx` (+3): "Abrir disputa" solo en el ítem raw elegible (no graded); fuera de la
  ventana de 7d no aparece; abrir modal → describir → enviar → `createDispute` + contacto de evidencia.

### Solicitudes al arquitecto
- **Ninguna bloqueante.** Todos los endpoints/guardas (F4/F5/F6) ya existen en el contrato §M4/§6/§7.
- **Nota (no bloquea):** `GET /shipments` (listMine) devuelve `ShipmentItem` crudos **sin
  `productType`** (ni `card`/`folio` garantizados) — solo `GET /shipments/:id` incluye `inventoryItem`.
  El UI-gate de F6 excluye graded **solo cuando conoce el productType**; si el listado no lo trae, la
  guarda server-side `NOT_RAW` es la autoridad (se mapea a mensaje amable). Si se quisiera un gate 100%
  cliente, habría que enriquecer la proyección de `GET /shipments` con `productType`/`deliveredAt` por
  ítem (solicitud al arquitecto; NO bloquea este WS).

## WS-F Pass 1 — Flujos de dinero del cliente contra el backend REAL (Stripe) (2026-08-17)

Cablea los flujos de dinero del cliente que eran stubs de demo: **checkout de compra (F1)**,
**gestor de direcciones (F2)** y **retiro/envío real (F3)**, todos con cobro **Stripe** vía un
componente compartido. **TOCA DINERO** → triple veredicto. Solo `frontend/` + este doc; NO se tocó
`backend/`, `api-client.ts`, `session.ts` ni el contrato. **0 cambios de contrato** (todos los DTOs
—`CheckoutSessionResponse`, `ShipmentCreateResponse`, `AddressDTO`, `KycInfoDTO.clabeOnFile`— ya
existían). Patrón real+mock respetado (cada método nuevo con rama `apiRequest` y rama mock gateadas
por `config.useMocks`). SEC-A1 intacto (montos/breakdown server-side; el cliente no fija precios).
Gates verdes: **lint** (0), **tsc** (0), **test 267** (37 files; +5 tests), **build** OK.

### Componente compartido — `StripePaymentModal` (`components/domain/StripePaymentModal.tsx`)
- Recibe `clientSecret`, monta `<Elements stripe={loadStripe(config.stripePublishableKey)}
  options={{clientSecret}}>` + `<PaymentElement>` y al confirmar llama
  `stripe.confirmPayment({ elements, confirmParams:{ return_url }, redirect:'if_required' })`.
  Maneja loading/error/ready.
- **Asentamiento por webhook:** tras un `confirmPayment` exitoso (`succeeded`/`processing`) el pago
  **NO** se trata como final — el modal solo dispara `onConfirmed()`; el padre limpia estado y rutea
  a "procesando". La titularidad pasa a `settled` cuando el backend recibe `payment_intent.succeeded`.
- `loadStripe` es **singleton a nivel de módulo** (se llama una vez).
- **Modo mock:** NO carga Stripe real; un botón simula el éxito para que la demo (sin llaves/backend)
  complete el flujo. Gateado por `config.useMocks`.
- Reusa `Modal`/`Button` del design system, tokens y `shadow-focus`.

### F1 · Checkout real (`CheckoutView.tsx` + `api.ts`)
- `api.ts` nuevo `createCheckoutSession(inventoryItemIds, billingProfileId?)` → `POST
  /checkout/session` con header **`Idempotency-Key`**; respuesta `CheckoutSessionResponse`
  (`{ orderId, breakdown, stripe:{ paymentIntentId, clientSecret } }`). Rama mock reusa
  `computeBreakdown` + clientSecret simulado y replica `422 PRICE_PENDING`.
- `pay()` dejó de ser `setTimeout`: crea la sesión → abre `StripePaymentModal` con el
  `clientSecret` → al confirmar `cart.clear()` + pantalla "pago en proceso" con CTA a
  `/orders` y `/vault`. `return_url` = `${origin}/${locale}/orders`.
- **403 `EMAIL_NOT_VERIFIED`:** se detecta por `ApiClientError.code` y se muestra el
  `EmailNotVerifiedNotice` (banner + reenvío) ya existente, no un error genérico.
- El aviso "simulado" (`checkout.stripeMock`) ahora se **condiciona a `config.useMocks`**.

### F2 · Gestor de direcciones (`components/domain/AddressManager.tsx` + `api.ts`)
- `api.ts`: `listAddresses` (`GET`, unwrap `{data}`), `createAddress` (`POST`), `updateAddress`
  (`PATCH`), `deleteAddress` (`DELETE` 204) sobre `/users/me/addresses`. Rama mock con libreta
  mutable en memoria (`fixtures.mockAddresses`), maneja `isDefault` y replica `422 ADDRESS_NOT_MX`.
- Componente reutilizable: **lista + alta (Modal con form) + marcar predeterminada + borrar**, con
  modo `selectable` (radio) para elegir destino del retiro. Usa `useMutation`+`invalidateQueries`.
  Auto-selecciona la dirección `isDefault` (o la primera). Validación de form: `line1/city/state`
  requeridos, `postalCode≥3`, `phone≥7`. **País fijo MX** (envío solo nacional; evita el
  `ADDRESS_NOT_MX` en el camino feliz — el guardarraíl server-side sigue vivo).

### F3 · Retiro real (`ShipmentsView.tsx` + `api.ts`)
- `api.ts` nuevo `createShipment(inventoryItemIds, addressId)` → `POST /shipments` con
  **`Idempotency-Key`**; respuesta `ShipmentCreateResponse`. Rama mock valida settled+MX, agrega el
  envío a "mis envíos" y devuelve clientSecret simulado; replica `422 ITEM_NOT_SETTLED`/`ADDRESS_NOT_MX`.
- Se reemplazó el **selector de país + `addr-mock`** por el `AddressManager` (picker real). El
  `address.id` seleccionado alimenta `getShipmentQuote` y `createShipment`; la regla **MX-only** sale
  de `address.country`. El botón "Solicitar retiro" ya tiene `onClick`: crea la solicitud → abre
  `StripePaymentModal` → al confirmar limpia selección y refresca `getShipments`/`getHoldings`.
- Botón **habilitado solo con `isMx && selected.length>0 && addressId`**. Maneja **403
  `EMAIL_NOT_VERIFIED`** (banner) y **422 `ITEM_NOT_SETTLED`** (mensaje traducido).
- `useSearchParams` lee `?item=` para preselección; la página envuelve la vista en `<Suspense>`.

### VaultView — "Retirar" por-fila con navegación
- El botón "Retirar" por-fila (habilitado solo si `settled`) ahora es un `Link` a
  `/shipments?item=<inventoryItemId>` (preselección); `pending` queda como botón deshabilitado.

### Tipos / mocks / i18n
- `contract.ts`: **sin cambios** (los DTOs ya existían). `api.ts` importa
  `CheckoutSessionResponse`, `ShipmentCreateResponse`, `AddressDTO`.
- `fixtures.ts`: `mockAddresses` (1 dirección MX default, mutable).
- i18n (paridad ES/EN): namespaces nuevos **`payment`** y **`addresses`**; `checkout` gana
  `preparing/payTitle/processingTitle/processingBody`; `shipments` gana `selectItem/payTitle`.

### Tests
- `api.test.ts`: +bloque mock (checkout/shipment/CRUD direcciones + `ADDRESS_NOT_MX`) y **+bloque
  REAL** (fetch stubeado, `config.useMocks=false`): verifica método/endpoint/`Idempotency-Key` y
  propagación de **403 `EMAIL_NOT_VERIFIED`** en checkout y shipment, y el `list/POST/PATCH/DELETE`
  de direcciones.
- `ShipmentsView.test.tsx` (nuevo): estado del botón (habilitado solo con dirección + ítem) y
  manejo del 403 (muestra el banner de verificación, no un error genérico).

### Sin solicitudes al arquitecto
El backend está completo para estos flujos; no se necesitó ningún endpoint/campo nuevo.

## WS-C — Cotizador de buylist contra el backend REAL (Fase 3b, contrato v1.15) (2026-08-17)

Enchufa el cotizador rediseñado de Fable al backend real: mata el fan-out FE-12 con `POST
/buylist/quote/batch`, y cierra los atajos de CLABE/INE que estaban gateados por `config.useMocks`.
**TOCA DINERO/PII** (buylist = SPEI + CLABE + INE) → triple veredicto. Solo `frontend/` + este doc; NO
se tocó `api-client.ts` ni `session.ts`. SEC-A1 intacto (monto server-side; el cliente nunca fija
precio ni CLABE de terceros). Gates verdes: **lint** (0), **tsc** (0), **test 257** (36 files; +9 nuevos).

### 1) Batch quote — mata el fan-out FE-12 (`api.ts` + `contract.ts` + `BuylistView.tsx`)
- `contract.ts`: `BuylistQuoteItemDTO`, `BuylistQuotePayload` (`rarity: string | null`),
  `BuylistBatchQuoteResultDTO` (unión `ok:true & payload` | `ok:false & error{ NOT_FOUND |
  FINISH_NOT_AVAILABLE }`) y `BuylistBatchQuoteResponse`, espejando el contrato §6 v1.15.
- `api.ts`: nuevo `batchQuote(items)` → `POST /buylist/quote/batch` (thin 1:1 con el endpoint). Cap
  `BUYLIST_QUOTE_BATCH_MAX=50` (exportado); vacío/sobre-cap → `400 VALIDATION_ERROR` (el mock también
  lo espeja). El mock resuelve cada ítem con `mockQuotePayload` (helper extraído de `getBuylistQuote`,
  para que por-carta y batch coincidan) y añade los guardas por-ítem `NOT_FOUND` (carta inexistente) y
  `FINISH_NOT_AVAILABLE` (finish ∉ `availableFinishes`, como el backend real). `getBuylistQuote`
  (por-carta) se **conserva** intacto (lo usa el panel de cotización de UNA carta, que no es fan-out).
- `BuylistView.tsx`:
  - **Grid navegable:** antes cada carta del grid montaba su propio `useQuery(getBuylistQuote)` (N
    cartas = N requests). Ahora UNA sola `useQuery(batchQuote)` por página; `ResultQuote` pasó de
    componente-con-query a **presentacional** que lee su resultado de un `Map<cardId, result>`. Render
    **tolerante por-ítem**: si ESE ítem salió `ok:false` pinta `gridQuoteError` en su fila sin afectar a
    las demás; `precio_pendiente` → `linePending`; ok → el estimado.
  - **Bulk "Agregar seleccionadas":** antes `Promise.all` de N `getBuylistQuote` (**all-or-nothing**:
    una inválida tumbaba TODO). Ahora UNA `batchQuote`; se agregan las `ok:true` y las `ok:false` se
    cuentan aparte. Nuevo estado de aviso `partial` (`bulkAddedPartial` = "{added} agregada(s); {failed}
    no disponible(s)."). `batchResultToQuote()` normaliza `rarity: string|null → string` para el carrito.
- **Decisión:** el panel de la carta seleccionada sigue en `getBuylistQuote` (1 request, no fan-out) y
  el contrato conserva `/buylist/quote`; solo el **grid** y el **bulk** (los dos fan-outs reales)
  migran a batch.

### 2) CLABE en un clic REAL — quita el guard de mock (#5) (`BuylistKycForm.tsx` + `api.ts` + `useSellRequirements.ts`)
- `contract.ts`: `KycInfoDTO` gana `clabeOnFile: boolean` (requerido, simétrico a `ineOnFile`).
- `useSellRequirements`: `clabeOnFile` ahora sale del **booleano REAL** `kyc.clabeOnFile` (antes
  `!!kyc.clabeMasked`). `clabeMasked` se conserva solo para el label.
- `BuylistKycForm`: el atajo "usar mi CLABE ****1234" se gatea por la nueva prop `clabeOnFile` (ya **no**
  por `config.useMocks` — se quitó el import de `config`). En modo atajo, `createSellRequest` se llama
  **OMITIENDO `clabe`** (el backend hace el fallback server-side a la CLABE en archivo del propio
  usuario). Se **eliminó** el flag de cliente `useClabeOnFile` de `CreateSellRequestInput` (ya no hace
  falta stripping antes del backend real; el contrato v1.15 soporta `clabe?` opcional directo).
- Manejo del nuevo `422 CLABE_REQUIRED`: fuerza salir del atajo y capturar la CLABE (`clabeRequired`).

### 3) No re-pedir INE si ya está (#5) (`BuylistKycForm.tsx`)
- Nueva prop `ineOnFile` (de `GET /users/me/kyc`, vía `useSellRequirements`). Si es true, la sección de
  INE **oculta los uploaders** y muestra `ineOnFileNote` ("Tu INE ya está en archivo…"); al enviar se
  **OMITE `ineUploadKeys`** (el backend usa el INE de archivo para el umbral AML — KYC parcial).

### i18n (ES/EN, paridad)
- `buylist.gridQuoteError`, `buylist.bulkAddedPartial`, `buylist.clabeRequired`, `buylist.ineOnFileNote`.

### Diseño
- `shadow-focus` y tokens del design system intactos (no se tocaron Input/Select/Button; el grid, el
  carrito y el modal reusan los mismos componentes/estilos). Sin estilos improvisados.

### Tests añadidos/ajustados
- `api.test.ts`: batch de N en 1 request (mismo monto que el por-carta), tolerancia por-ítem
  (`NOT_FOUND`), `FINISH_NOT_AVAILABLE` por-ítem, y cap vacío/>50 → `400`.
- `BuylistView.test.tsx`: el bulk cotiza en UNA sola `batchQuote` (no loop); batch parcial-tolerante
  (1 ok + 1 error → aviso parcial, la válida entra); CLABE en archivo → enviar omite `clabe`; INE en
  archivo → el modal no re-pide INE. `BASE_KYC` gana `clabeOnFile`.
- `BuylistKycForm.test.tsx`: atajo gateado por `clabeOnFile` (no mock); envío omite `clabe` y ya no
  existe `useClabeOnFile`; `clabeOnFile=false` pide la CLABE; `ineOnFile` oculta uploaders y omite keys.

### Solicitudes al arquitecto
- Ninguna: el contrato v1.15 (§0, §1, §6) ya cubre `POST /buylist/quote/batch`, `clabe?` opcional con
  fallback + `422 CLABE_REQUIRED`, y `clabeOnFile`/`ineOnFile` en `GET /users/me/kyc`. Cero cambios de
  contrato. (La deuda **FE-13** —extraer hooks de `BuylistView`— quedó como oportunista y no se forzó.)

## WS-A — Ingesta masiva de precios (frontend, v1.14-price-ingest) (2026-08-17)

Parte de frontend del epic WS-A (contrato `API_CONTRACT.md` v1.14-price-ingest). Solo `frontend/` +
este doc. NO se tocó `api-client.ts` ni `session.ts`. `api.ts` sí (WS-B ya cerró ahí).

### #13 — Guardar SOLO el colchón (buffer) del FX — `M2View.tsx` (sección FX) + `api.ts`
- `updateFx` (`api.ts`) ahora acepta `{ rate?, bufferPct? }` (**`rate` opcional**, contrato §M2). Si se
  omite `rate`, el mock conserva la tasa vigente y **no** marca `source=manual` (solo cambia el colchón);
  el backend real hace lo propio (no pinnea override de tasa). Al menos uno de los dos debe venir.
- `M2View` arma el payload con las keys realmente capturadas (`saveFx()`): tasa vacía ⇒ `{ bufferPct }`
  sin `rate`. El botón "Fijar override" se habilita si **AL MENOS uno** de los dos tiene valor
  (antes: `disabled` si cualquiera vacío). Mensaje de éxito diferenciado: `fx.savedBufferOnly` cuando solo
  se guardó el colchón (se decide por `fxUpdateMutation.variables.rate === undefined`), `fx.saved` si hubo
  tasa. Se separó el banner de éxito compartido con "Refrescar Banxico" para poder dar el copy correcto.
  Hint nuevo `fx.bufferOnlyHint` bajo los inputs.

### Selector `priceProvider` + disparo manual del ingest — `M2View.tsx` (nueva Sección 3b) + `api.ts` + `contract.ts`
- `contract.ts`: nuevo `type PriceProvider = 'pokemontcg_io' | 'pokemonpricetracker'`; `SettingsDTO` gana
  `priceProvider?: PriceProvider` (opcional: el backend lo puede omitir hasta el seed). Nuevo
  `PriceIngestResponse` (`{ job, enqueued, jobId?, scope?, setId? }`).
- `api.ts`: `getPriceProvider()`/`updatePriceProvider(p)` = wrappers finos sobre el endpoint de settings ya
  existente (`GET`/`PUT /admin/settings` parcial; SEC/auditoría del backend intactas). `triggerPriceIngest({ setId? })`
  → `POST /admin/jobs/price-ingest` (body vacío salvo `setId?`, ÚNICA excepción de la familia `admin/jobs/*`).
- `M2View` Sección 3b "Ingesta masiva de precios": `Select` del proveedor (patrón draft + botón Guardar,
  money-safe como los editores de reglas) con hint "cambia la fuente sin redeploy"; botón "Actualizar
  precios ahora" que llama `triggerPriceIngest()` con feedback encolado (`enqueued=true`) vs ya-en-curso
  (`enqueued=false`, single-flight). Query propia `['price-provider']` con `QueryState` (carga/error/retry);
  el disparo del ingest invalida `['pending-prices']`.
- Mock: `mockSettings.priceProvider = 'pokemontcg_io'` (seed recomendado por contrato) en `mock/fixtures.ts`.
- i18n: `admin.m2.priceIngest.*` + `admin.m2.fx.{bufferOnlyHint,savedBufferOnly}` en ES/EN (paridad). El copy
  del `triggerHint` evita la frase "Corre en segundo plano" para no colisionar con el `getByText` del test
  del barrido de catálogo (ambos textos coexisten en el DOM).
- Tests (`M2View.test.tsx`): guardar-solo-buffer llama `updateFx({ bufferPct })` sin `rate` (+ estado
  enabled/disabled del botón + copy); el selector guarda el dial (`updatePriceProvider('pokemonpricetracker')`);
  el botón dispara `triggerPriceIngest` (feedback encolado y single-flight).
- Preservado `shadow-focus` (Input/Select sin tocar). Gates verdes: lint, tsc, test (248), build.

## WS-D — Quick wins de UX (2026-08-17)
- **#9 P-13 nav por sesión** (`StorefrontHeader.tsx`): "Mi Bóveda"/"Mis Órdenes" se ocultan sin sesión
  (público solo Compra/Vender), vía spread condicional en el array `links` (aplica a nav desktop y móvil;
  `authed` depende de `ready` → sin mismatch de hidratación).
- **#6 márgenes**: `.gutter` 44→32px (`globals.css`, DS §4.1 "32px+"); canal del label vertical 56→40px
  (`BuylistView.tsx`, `page.tsx`); quitado `lg:px-10` redundante del aside; header/footer/`VerifyEmailBanner`
  alineados a `lg:px-8`. `max-w-7xl` intacto (DS §4.4).
- **#7 placeholder**: "Buscar carta" acortado a "Nombre o número" (`buylist`, `admin.m1`).

## WS-B — Auto-refresh del access token (sesión no se cae a los 15m) (2026-08-17)

**Problema:** el access token dura `JWT_ACCESS_TTL`=15m; el backend TIENE `POST /auth/refresh`
(devuelve un `TokenPair` nuevo) y el login/register/google ya devolvían `refreshToken`, pero el front lo
**descartaba** (`persistSession` solo guardaba el access token) y `apiRequest` **no manejaba 401**. Resultado:
a los 15m toda request daba 401 y el usuario quedaba deslogueado a media corrida (p. ej. un sync largo).
Solo `frontend/` + este doc. **No** se tocó backend ni contrato. Auth-sensible → lo revisa seguridad.

### 1) Persistir el refresh token — `lib/api-client.ts` + `lib/api.ts`
- Nueva clave `tcg.refreshToken` en localStorage (junto a `tcg.accessToken`), con `getRefreshToken`/
  `setRefreshToken` espejo de `getToken`/`setToken` (mismo almacenamiento, misma guarda SSR `typeof window`).
- `persistSession` (`api.ts`) ahora guarda **también** `res.refreshToken` (contrato §1 lo devuelve en
  login/register/google/refresh). `logout` limpia también el refresh token (no dejar una credencial de 30d
  huérfana). Nuevo `clearClientSession()` (api-client) que limpia access + refresh + user en un solo lugar.

### 2) Interceptor 401 → refresh → reintento (una vez) — `lib/api-client.ts` `apiRequest`
`apiRequest` delega en un `requestWithRefresh(path, opts, allowRefresh)`:
- Si la respuesta es **401**, hay refresh token, y **no** es una ruta `/auth/*`: llama `POST /auth/refresh`
  (`fetch` directo, no `apiRequest`, para no re-entrar), persiste el `TokenPair` nuevo y **reintenta la
  request original UNA vez** con el access token nuevo (`allowRefresh=false` en el reintento).
- **Single-flight:** si varias requests reciben 401 a la vez, comparten UNA sola llamada a `/auth/refresh`
  (`refreshInFlight`). El backend **rota** el refresh token en cada uso; llamadas paralelas se invalidarían
  entre sí. El resto reutiliza la misma promesa y luego reintenta con el token ya rotado.

### 3) Si el refresh falla → sesión limpiada, sin bucles
- Refresh devuelve `null` (sin refresh token / 401 / error de red) → `clearClientSession()` y se propaga el
  **401 original** al caller; el flujo normal (guards de UI / `useSession`) lleva a login. `setStoredUser(null)`
  emite el evento `tcg.session.changed`, así que header y otras pestañas quedan deslogueadas (sync).
- Reintento que **sigue** en 401 (token fresco igual rechazado ⇒ sesión no confiable) → también
  `clearClientSession()` y se propaga el 401. Nunca hay 2º refresh ni 2º reintento.

### Cómo se evitan los bucles (resumen)
1. El reintento se hace con `allowRefresh=false` ⇒ **un solo** reintento por request.
2. `isAuthPath('/auth/*')` **excluye** todo endpoint de auth del interceptor: el propio `/auth/refresh` nunca
   se dispara a sí mismo, y un 401 de `/auth/login` (credenciales inválidas) no intenta refrescar ni borra la
   sesión — es un error significativo por sí mismo.
3. El refresh usa `fetch` directo (no `apiRequest`) ⇒ no re-entra en el interceptor.
4. Single-flight ⇒ un stampede de 401 concurrentes = **una** llamada de refresh, no N.

### Modo mock (`config.useMocks`) intacto
El branching mock vive en `api.ts` (cada función corta con `delay(...)` sin llegar a `apiRequest`), así que el
interceptor **solo corre en modo real**. Los tests mock existentes no se tocan; `mockAuthResponse` ya traía
`refreshToken`, que ahora `persistSession` guarda sin efectos en las pruebas mock.

### Fuera de alcance (deliberado)
- `exportFinanceCsv` (`api.ts`) usa `fetch` directo (lee CSV, no JSON) y **no** pasa por `apiRequest`, así que
  no tiene refresh-and-retry. Es una **descarga manual** (clic del admin), no un sync en background: si el
  token venció, el siguiente `apiRequest` de esa vista ya habrá refrescado. No se refactorizó para acotar el WS.
- **No** se añadió refresco proactivo (pre-15m). El interceptor 401 reactivo ya cubre el requisito de forma
  transparente; se dejó fuera para minimizar la superficie de un cambio auth-sensible (lo revisa seguridad).
- `inactivity.tsx` / `keep-alive.ts` (auto-logout por **inactividad**, 5 min) cubren otra cosa y **no** se
  tocaron. Son ortogonales: keep-alive evita el logout por inactividad durante operaciones largas; WS-B evita
  la caída por **expiración del access token**.

### Pruebas — `lib/api-client.test.ts` (nuevo, 8 casos)
Ejercitan la rama real mockeando `fetch`: (a) 401 → refresh → reintento OK con el token nuevo + rotación de
tokens persistida; (b) refresh 401 → sesión limpiada (access+refresh+user) y 401 propagado, sin reintento;
(c) reintento sigue 401 → sin bucle (exactamente 3 fetch) + sesión limpiada; (d) sin refresh token → 401 tal
cual; (e) `/auth/login` 401 → sin refresh ni borrado de sesión; (f) 422 y (g) 200 no disparan refresh.

**Gates:** `npm run lint` (0 warnings/errors), `npx tsc --noEmit` (exit 0), `npm run test`
(**36 archivos, 244 tests** verdes — incluye los 8 nuevos del interceptor), `npm run build` (exit 0).

## WS-D — 3 quick wins de UX (nav por sesión, márgenes, placeholder) (2026-08-17)

Tres ajustes de bajo riesgo, solo `frontend/`. **No** se tocó `lib/api.ts`, `api-client.ts` ni `session.ts`
(trabajo paralelo de otro agente), ni backend ni contrato. Sin claves i18n nuevas; paridad ES/EN preservada.

### #9 — Nav por sesión (P-13) — `StorefrontHeader.tsx`
El array `links` pintaba las 4 pestañas siempre. Ahora "Mi Bóveda" (`/vault`) y "Mis Órdenes" (`/orders`) se
**gatean tras `authed`** (`ready && isAuthenticated`, ya calculado en `:51`); el público solo ve "Compra"
(`/catalog`) y "Vender" (`/buylist`). El gate vive en la construcción del array (spread condicional), así que
aplica **igual a nav desktop y menú móvil** (ambos hacen `links.map`). Como `authed` depende de `ready`, en
SSR/hidratación se pinta el nav público (idéntico al render de servidor, sin mismatch) y las pestañas privadas
aparecen al montar la sesión — mismo patrón ya usado para el botón login/logout.

### #6 — Márgenes laterales grandes (columna vertical 56px + gutter 44px)
- `globals.css` `.gutter` `@media (min-width:1024px)`: **44px → 32px** (DESIGN_SYSTEM §4.1 pide "32px+"; 32 es
  el mínimo válido). Afecta a todas las secciones storefront que usan `.gutter` (ese es el objetivo).
- Canal del label vertical **56px → 40px** en `BuylistView.tsx` (`grid lg:grid-cols-[40px_1fr]`) y
  `page.tsx` (`[40px_1fr_1fr]` hero y `[40px_1fr_auto]` banda buylist). La etiqueta vertical (`.vertical-label`,
  `writing-mode: vertical-rl`) se mantiene: en modo vertical su longitud crece en alto, no en ancho, así que
  "Bóveda"/"Buylist" caben de sobra centradas en 40px.
- Quitado `lg:px-10` redundante del `<aside>` del cotizador en `BuylistView.tsx` (ya lleva `.gutter`).
- Alineación del **chrome** con el gutter nuevo (32px): `StorefrontHeader.tsx` y el footer de
  `(storefront)/layout.tsx` bajaron `lg:px-11` → `lg:px-8`. **También** `VerifyEmailBanner.tsx` (banner que se
  monta entre header y `main` y comparte el patrón idéntico `mx-auto max-w-7xl px-5 sm:px-6 lg:px-11`): bajado a
  `lg:px-8` para no introducir una desalineación de 12px cuando el banner es visible. Los `lg:px-10` de asides
  de otras vistas (checkout, order-detail, shipments) y el chrome admin (`AdminTopbar`/`AdminShell`) quedaron
  **intactos** por estar fuera del alcance de este WS.
- `max-w-7xl` **no se tocó** (fijado por DESIGN_SYSTEM §4.4). Anillo de foco `shadow-focus` intacto.

### #7 — Placeholder "Buscar carta" que se truncaba
`"Nombre o número (ej. Charizard, 4)"` se cortaba en el ancho del input. Acortado a **"Nombre o número" /
"Name or number"** (describe los dos modos de búsqueda: nombre o número de carta). Cambiado en las 2 claves
que compartían el texto largo: `buylist.searchPlaceholder` (`BuylistView`) y `admin.m1.searchPlaceholder`
(picker de alta de inventario). `catalog.searchPlaceholder` ("Buscar carta…") ya era corto y no se tocó.

### Tests / gates
- `StorefrontHeader.test.tsx`: ningún test existente asumía las 4 pestañas sin sesión (solo verificaban links
  públicos y el estado login/logout), así que nada se rompió. Se **añadieron 2 casos** de #9: sin sesión el nav
  solo muestra Compra/Vender y **oculta** "Mi bóveda"/"Mis órdenes"; con sesión aparecen ligadas a `/vault` y
  `/orders`.
- Gates: `next lint` ✓ (0 warnings/errores) · `tsc --noEmit` ✓ · `vitest` **236/236** (35 archivos, incl.
  paridad i18n) · `next build` ✓ (Compiled successfully). Sin solicitudes al arquitecto.

## Epic precios · Fase 1 · Tarea 1.4 — "Importar sets nuevos" (claridad UX, sin endpoint nuevo) (2026-08-17)

Contrato/arquitectura v1.12. El humano pidió "mapear los sets nuevos que vayan saliendo"; el endpoint ya
existe (`POST /admin/catalog/sync-all` con `force:false` importa solo los NO importados = trae sets nuevos).
El trabajo fue **de claridad de UX**, no contrato nuevo. Solo `frontend/` + esta nota.

- **`M2View.tsx` §5 (sync de catálogo):** el botón antes rotulado "Sync de todo el catálogo" (`syncAllMutation`,
  `force:false`) ahora se llama **"Importar sets nuevos"**. Su acción **no cambió** (sigue `syncAllCatalog()`
  sin `force`). Se añadió un `<p class="text-xs text-muted">` con `catalog.syncAllHint` bajo la fila de botones
  que explica la diferencia ligera vs. pesada: "Importar sets nuevos" (force:false, solo sets recién salidos +
  el sistema lo hace 2×/día) vs. "Re-sincronizar todo (forzar)" (force:true, repuebla precios, pesado). No se
  tocó la lógica de progreso/polling/keep-alive.
- **i18n (`messages/{es,en}.json`, `admin.m2.catalog`):** cambiada `syncAll` ("Sync de todo el catálogo" →
  **"Importar sets nuevos"** / "Sync entire catalog" → **"Import new sets"**); nueva `syncAllHint` (ES/EN,
  paridad verificada por `i18n-parity`). El resto de claves del bloque intactas.
- **Tests (`M2View.test.tsx`):** las 3 aserciones que buscaban `/Sync de todo el catálogo/` ahora usan
  `/Importar sets nuevos/`; nuevo caso "el botón «Importar sets nuevos» dispara syncAllCatalog sin forzar"
  (verifica `force` ausente/false). El caso del error por set (`/^(Importar|Re-sincronizar)$/`, anclado) sigue
  sin capturar el nuevo botón. Gates: `lint` ✓ · `tsc --noEmit` ✓ · `vitest` **220/220** (35 archivos, incl.
  paridad i18n) · `next build` ✓. Sin solicitudes al arquitecto.

## Gating temprano del flujo de VENDER (buylist) — fix UX del 403 críptico (2026-08-17)

Branch `claude/git-repo-review-c67xyk`. Evidencia de prod: el usuario llenaba TODO el cotizador +
modal "Crear solicitud de venta" y solo al enviar recibía un **403** (correo no verificado). Los
guards del backend son correctos por AML (`JwtAuthGuard → RolesGuard → EmailVerifiedGuard` sobre
`POST /buylist/requests`, contrato §6 → `403 EMAIL_NOT_VERIFIED`); el problema era que el frontend
no comunicaba los requisitos hasta el final. **No se tocó backend ni se relajó nada**: el bloqueo
autoritativo sigue siendo server-side (SEC-A1); el cliente solo comunica ANTES y mapea DESPUÉS.

### Contrato confirmado (no se inventó nada)
- `POST /buylist/requests` — errores: `403 EMAIL_NOT_VERIFIED`, `422 FINISH_NOT_AVAILABLE`,
  `422 BUYLIST_LIMIT_EXCEEDED` (details `{ scope, capCents, wouldBeCents }`), `422 INE_REQUIRED`,
  `422 CLABE_NOT_OWN_NAME` (contrato §6; códigos en `backend/src/common/error-codes.ts`).
- `GET /users/me` → incluye `emailVerified` y `kycStatus`, **no** trae CLABE.
- `GET /users/me/kyc` (rol `customer`) → `{ kycStatus, clabeMasked?, ineOnFile, capPerRequestCents,
  capPerMonthCents, monthUsedCents }` → **sí** permite saber si hay CLABE registrada (`clabeMasked`)
  y anticipar el requisito de INE por topes. **No hace falta pedir nada al arquitecto.**
- `POST /auth/verify-email/resend` (autenticado, sin body, 3/h) para el CTA de reenvío.

### Implementación
- **`hooks/useSellRequirements.ts`** (nuevo): agrega sesión (`useSession`) + `GET /users/me/kyc`
  (solo si `role === 'customer'`, para no provocar 403 en staff) y deriva: `isAuthenticated`,
  `emailBlocked` (SOLO con `emailVerified === false` explícito, espejo de `VerifyEmailBanner`;
  sesiones viejas sin el campo dejan decidir al backend), `clabeOnFile`/`clabeMasked`, `ineOnFile`,
  `ineExpected` (estimado > tope por solicitud o remanente mensual, sin INE en archivo — heads-up,
  el backend re-decide) y `canSubmit`.
- **`components/domain/SellRequirementsPanel.tsx`** (nuevo): visible SIEMPRE en el aside del
  carrito (aun vacío). Sin sesión → Banner "Inicia sesión o crea cuenta para vender" con links
  login/registro; `emailVerified=false` → reusa `EmailNotVerifiedNotice` (CTA de reenvío);
  sesión ok → checklist 5a en mono (`✓ / — / !`): correo verificado, CLABE registrada
  (enmascarada) o pendiente, e INE esperado con el tope formateado.
- **`BuylistView`**: sin sesión el CTA "Enviar solicitud (N)" se SUSTITUYE por links
  login/registro; con correo sin verificar queda `disabled` + motivo visible enlazado por
  `aria-describedby` (`submitBlockedEmail`). Se eliminó el párrafo genérico `kycNotice`
  (reemplazado por el panel). El modal recibe `ineExpected` y `clabeMasked`.
- **`BuylistKycForm`**: segundo cinturón dentro del modal — con `emailVerified === false` el
  submit queda deshabilitado con el aviso de entrada (no espera al 403); `ineExpected` preactiva
  la petición de INE (no espera al `422 INE_REQUIRED`); `clabeMasked` cambia el hint de la CLABE.
  Mapeo de errores del submit: `BUYLIST_LIMIT_EXCEEDED` ahora usa `details.capCents` con monto
  real (`limitExceededCap`); códigos no mapeados caen a `useErrorMessage` (catálogo `error.*`,
  p. ej. `FINISH_NOT_AVAILABLE`) en vez del genérico `requestError`.

### i18n (paridad ES/EN verificada por `i18n-parity.test.ts`)
Claves nuevas en `buylist`: `requirementsTitle`, `loginToSellTitle`, `loginToSellBody`, `loginCta`,
`registerCta`, `reqChecking`, `reqEmailVerified`, `reqClabeOnFile`, `reqClabeMissing`,
`reqIneOnFile`, `reqIneExpected`, `submitBlockedEmail`, `clabeOnFileHint`, `limitExceededCap`.
Eliminada: `kycNotice` (sustituida por el panel). Los avisos de verificación reusan `verifyEmail.*`.

### Tests (BuylistView 21 · BuylistKycForm 10)
Gating: sin sesión (CTA login/registro, sin botón de enviar), correo no verificado (botón
deshabilitado + motivo + reenvío que llama al endpoint), sin CLABE (checklist pendiente + el modal
no llama al backend con CLABE vacía), CLABE registrada (checklist cumplido enmascarado), estimado
sobre tope (aviso de INE antes de enviar y modal con la petición preactivada), y flujo feliz con
sesión verificada (los tests de carrito existentes ahora corren logueados). Mapeos: 403
`EMAIL_NOT_VERIFIED` → aviso accionable; `BUYLIST_LIMIT_EXCEEDED` con `capCents`;
`FINISH_NOT_AVAILABLE` → catálogo `error.*`.

### Gates (frontend/)
`npm run lint` ✓ · `tsc --noEmit` ✓ · `npx vitest run` ✓ (**35 archivos / 215 tests**, incl.
paridad i18n) · `next build` ✓.

## Operabilidad del back-office: M1–M5, M8 cableados a endpoints reales (2026-08-17)

Branch `claude/git-repo-review-c67xyk`. Varias pantallas admin eran cascarones con botones sin
`onClick` aunque el backend YA exponía los endpoints. Esta ronda cablea la operación completa del
negocio. Solo `frontend/` + esta nota; look 5a intacto (paper/ink/vermilion, radios/sombras 0,
`shadow-focus`). Gates verdes: `lint` ✓ · `typecheck` ✓ · `vitest` **189/189** (35 archivos, incl.
paridad i18n) · `next build` ✓.

### Funciones nuevas en `lib/api.ts` (todas con rama mock que respeta el shape del contrato)
- **M5:** `receiveBuylistRequest(id)` → `POST /admin/buylist/:id/receive`; `verifyBuylistRequest(id)`
  → `POST .../verify`; `decideBuylistItem(itemId, { decision, approvedPriceCents? })` →
  `PATCH /admin/buylist/items/:itemId/decision`; `convertBuylistItemToInventory(itemId)` →
  `POST .../convert-to-inventory`; `revealBuylistClabe(id)` → `GET /admin/buylist/:id/reveal-clabe`;
  `paySpeiBuylist(id, speiReference)` → `POST .../pay-spei` con `Idempotency-Key: pay-spei-<id>`
  estable (reintento no duplica el asiento).
- **M3:** `refundOrder(orderId, reason)` → `POST /admin/orders/:id/refund` con
  `Idempotency-Key: refund-<orderId>`.
- **M8:** `resolveDispute(id, { resolution, note })` → `POST /admin/disputes/:id/resolve`.
- **M4:** `getAdminShipments({ status?, page?, pageSize? })` → `GET /admin/shipments` (cola de
  CLIENTES; antes la vista usaba `getShipments()` = envíos del propio admin) y
  `getAdminPickingList(date?)` → `GET /admin/shipments/picking-list`.
- **M2:** `overridePrice` gana `finish?` (la cola de pendientes es POR ACABADO, M-19: sin `finish`
  el backend defaultea `normal` y el pendiente real quedaba abierto).

### Tipos (`types/contract.ts`, espejo del contrato)
`PendingPriceEntryDTO` += `finish: Finish` + `card? { id, name, number, setName }`;
`PricingOverrideInput` += `finish?`. Nuevos: `AdminShipmentDTO` (fila cruda de la cola admin, con
`requestedAt`/`userId`; items sin carta/folio en el listado), `PickingListEntryDTO`,
`RefundOrderResponse`, `RevealClabeResponse`, `BuylistItemDecisionInput`,
`ConvertToInventoryResponse`, `ResolveDisputeInput`.

### Por pantalla
- **M5 (`M5View`)** — end-to-end: Recibir (visible en `cotizada`), Verificar (en `recibida`),
  Aprobar/Ajustar/Rechazar por ítem (Ajustar abre modal con `approvedPriceCents`; el 422
  `APPROVED_PRICE_CAP_EXCEEDED` u otro error se muestra DENTRO del modal con el mensaje real),
  Convertir a inventario (deshabilitado salvo `aprobada`; confirma con el folio devuelto), Revelar
  CLABE y Pagar SPEI (modal con referencia obligatoria). Cada acción: confirmación `Banner` success
  anclada a SU solicitud, error real, `invalidateQueries(['admin-buylist'])`. La CLABE revelada vive
  SOLO en estado local del componente vía **mutation** (nunca query-cache/estado global), se oculta
  con un botón y se descarta al registrar el pago; cada reveal queda auditado server-side.
  Los ítems muestran su **acabado** (`FinishBadge`) y el precio aprobado cuando existe.
- **M3 (`M3View`)** — refund cableado: modal con **motivo obligatorio** (contrato `{ reason }`),
  confirmación con monto, banner de éxito con el `orderId`, error real en el modal, refresh.
- **M8 (`M8View`)** — Recomprar/Rechazar cableados con modal de confirmación + **nota obligatoria**
  (contrato `{ resolution, note }`); selección por id (no por objeto) para que el estado se refresque
  tras invalidar; los botones desaparecen en disputas ya resueltas.
- **M4 (`M4View`)** — la cola ahora es `GET /admin/shipments` (clientes) con **filtro por estado**;
  la "lista de picking" dejó de derivarse del inventario local y consume el endpoint real
  `GET /admin/shipments/picking-list` (ubicación + folio + envío). Captura de guía igual, con banner
  de éxito e invalidación de ambas queries.
- **M1 (`M1View`)** — (a) **paginación real** del picker (`useInfiniteQuery` con `page/pageSize=20`
  + "Cargar más" + contador "X de Y") — raíz del "solo veo ~20 cartas"; (b) resultados y carta
  seleccionada con **miniatura + #número + rareza + badges de acabados**; (c) **P-4**: el alta usa el
  `folio` devuelto en un `Banner` success y el error muestra el mensaje real
  (`PRICE_PENDING`/`FINISH_NOT_AVAILABLE`…); (d) raw con un solo acabado lo muestra **fijo** en vez
  de ocultarlo.
- **M2 (`M2View`)** — el override envía `finish`; la cola de pendientes muestra **acabado**
  (`FinishBadge`) y nombre de carta + `#número` (proyección `card` del backend); el modal de override
  muestra el acabado que se va a resolver.

### Decisión transversal: mensajes de error reales
`useErrorMessage` (QueryState) ahora cae al **mensaje real del backend** (`ApiClientError.message`)
cuando el `code` no tiene copy i18n, en vez del genérico. Códigos nuevos con copy ES/EN:
`APPROVED_PRICE_CAP_EXCEEDED`, `ITEM_NOT_APPROVED`, `CLABE_UNAVAILABLE`.

### i18n (paridad ES/EN verificada por `i18n-parity.test.ts`)
Nuevas: `admin.m1.{resultCount,loadMore,finishFixedSingle,createSuccess}` ·
`admin.m2.pending.finish` · `admin.m3.{refundDone,refundReasonLabel,refundReasonHint}` ·
`admin.m4.{queueTitle,statusFilter,statusAll,queueEmpty,itemCount,pickingHint,pickingEmpty,picking.*,tracking.saved}` ·
`admin.m5.{approvedLabel,convertNeedsApproval,revealClabe,hideClabe,clabeLabel,clabeNotice,adjustTitle,adjustPriceLabel,adjustConfirm,adjustHint,paySpeiTitle,speiReferenceLabel,paySpeiConfirm,feedback.*}` ·
`admin.m8.{resolveConfirm,repurchaseQuestion,rejectQuestion,noteLabel,noteHint,resolvedRepurchase,resolvedReject}` ·
`error.{APPROVED_PRICE_CAP_EXCEEDED,ITEM_NOT_APPROVED,CLABE_UNAVAILABLE}`.

### Tests nuevos (26 en 5 archivos + 1 caso en M2)
`M5View.test.tsx` (9: decisión approve/adjust/reject con tope AML, reveal/ocultar CLABE, pago SPEI con
referencia + error real), `M3View.test.tsx` (3), `M8View.test.tsx` (4), `M4View.test.tsx` (4: cola
admin —y que NO llama `getShipments`—, filtro `?status=`, picking real, captura de guía),
`M1View.test.tsx` (5: metadatos del picker, paginación page=2, acabado único fijo, folio en éxito,
error real), `M2View.test.tsx` (+1: override reenvía `finish`).

### Notas para QA/arquitecto
- El fixture mock separa `mockAdminShipments` (cola admin) de `mockShipments` (envíos propios).
- `AdminShipmentDTO` refleja la fila cruda del backend (`requestedAt`, items sin carta/folio en el
  LISTADO). Si M4 necesitara carta/folio por ítem en la cola, habría que enriquecer la proyección de
  `GET /admin/shipments` (solicitud al arquitecto; NO bloquea).
- `pay-spei`/`refund` envían `Idempotency-Key` estable por entidad como pide el contrato (el backend
  hoy además tiene guardas de estado propias).

## v1.9-set-chart · Gráfica pública del valor del set destacado en el hero (2026-08-16)

Contrato: **API_CONTRACT v1.9-set-chart** (`GET /catalog/featured-set/value-history?range=`, DTOs
`SetValueHistoryResponse` / `SetValuePointDTO` / `SetRefDTO` / `SetValueRange`). Diseño: **DESIGN_SYSTEM
§7.18** (`FeaturedSetGlance`) reusando §7.17. Solo `frontend/` + esta nota. **No** se tocó backend, contrato,
`DESIGN_SYSTEM.md`, `.env.example` ni `TECH_DEBT.md`. Gates verdes: `lint` ✓ · `typecheck` ✓ · `vitest`
**163/163** (30 archivos) · `next build` ✓. Playwright **no** ejecutado aquí (requiere el stack corriendo;
lo corre QA) — el e2e de home solo verifica nav + toggle de idioma, no la rama anónima, así que no se rompe.

### Qué se implementó
- **Tipos (`types/contract.ts`):** `SetValuePointDTO`, `SetRefDTO`, `SetValueRange`, `SetValueHistoryResponse`
  — espejo literal del contrato (`set: SetRefDTO | null`, `points`, `change`).
- **API helper (`lib/api.ts`):** `getFeaturedSetValueHistory(range = '1m')` → `GET
  /catalog/featured-set/value-history?range=` cuando `!useMocks`; en mock delega a
  `fx.generateFeaturedSetValueHistory`. El front **no** envía ni hardcodea id de set (lo resuelve el backend).
- **Componente `FeaturedSetGlance` (en `PortfolioTrendChart.tsx`, junto a `PortfolioGlance`):** vive en el
  mismo archivo para **reusar** los subcomponentes privados `Delta` y `Sparkline` sin exportarlos. Query
  `['featured-set-history','1m']` (rango fijo 1m, es un "glance"). Renderiza sub-encabezado (nombre del set
  `lang="en"`, no traducido, + etiqueta `eyebrow` "Valor de mercado · Set destacado"), cifra grande tabular
  (mismo estilo `text-[32px]…lg:text-[41px]` que `PortfolioGlance`), `Delta` (signo+flecha+color, portador
  accesible del cambio) y `Sparkline` desnudo con `summary=""` → `aria-hidden` (la curva es decorativa).
- **Home `page.tsx` (rama ANÓNIMA):** `FeaturedSetGlance` **encabeza** el panel derecho; debajo se conservan
  **2** líneas de confianza (custodia + precio real; la de autenticación se poda por espacio, §7.18) y el
  enlace de acceso (`nav.login`) sigue anclado al pie con `mt-auto`. La rama **con sesión** (`PortfolioGlance`
  + valor por set) **no** cambia.

### Cómo se renderiza la gráfica y el estado vacío (regla dura "nada fabricado")
- **≥ 2 puntos:** cifra de hoy + `Delta` + `Sparkline` (polilínea 1.5px, sin ejes/retícula/relleno/dot).
- **1 punto:** cifra de hoy + microcopy `text-muted` **"Recopilando historial"** en la misma línea; **sin**
  curva (el `Sparkline` ya devuelve `null` con `< 2` puntos) y sin delta engañoso.
- **`points: []`** (serie recién sembrada): se degrada al sub-encabezado (nombre + etiqueta) + "Recopilando
  historial" + frase de apoyo; **sin** cifra, sin curva.
- **`set === null` / error / (loading fallido):** el componente **renderiza `null`** → el panel anónimo cae a
  su forma previa (2 líneas de confianza + acceso). El hero nunca queda roto por este endpoint secundario.
- **Cargando:** skeleton de cifra + skeleton de polilínea (~90px), sin spinner.
- Tendencia negativa = estado legítimo (bermellón + ▼ + signo −), sin banner de alarma. Anillo `shadow-focus`
  intacto; el componente **no** añade controles que atrapen foco ni altera el orden de tabulación.

### Mock añadido (`lib/mock/fixtures.ts`)
- **`generateFeaturedSetValueHistory(range)`:** serie determinista de "Surging Sparks" (id local `sv08`),
  valor agregado alto (~MX$1.32M = suma de ~184 cartas priceadas) con tendencia mensual **sobria** (~+2.7%) y
  ruido acotado (~0.4% via seno) — **sin** rally fabricado. `pricedCardCount` plausible (182–184).
- **`mockFeaturedSetHistoryEmpty`** (`set` presente, `points: []`) y **`mockFeaturedSetHistoryNull`**
  (`set: null`) para ejercer los estados honestos en tests sin backend.

### i18n nuevas (ES/EN, bajo `home.featuredSet`) — paridad verificada por `i18n-parity.test.ts`
- `label`: **"Valor de mercado · Set destacado"** / **"Market value · Featured set"**.
- `collectingTitle`: **"Recopilando historial"** / **"Collecting history"**.
- `collectingBody`: **"La tendencia de este set aparecerá cuando tengamos un par de días de historia."** /
  **"This set's trend will appear once we have a couple of days of history."**
- `marketRefNote` (nota anti-promesa): **"Referencia de mercado de las cartas con precio de este set."** /
  **"Market reference for the priced cards in this set."**
- El `Delta`/`Sparkline` reusan las claves existentes de `portfolio.trend` (noChange/up/down/flat).

### Tests
- **`PortfolioTrendChart.test.tsx`** (`FeaturedSetGlance §7.18`): pide `1m`; serie ≥2 puntos (nombre `lang=en`
  + etiqueta + cifra + `▲` + `2.70`, sin microcopy); 1 punto (cifra + "Recopilando historial", sin `svg`);
  `points: []` (sub-encabezado + "Recopilando historial", sin `svg`); `set: null` (render vacío).
- **`(storefront)/page.test.tsx`** (nuevo): con sesión anónima el panel muestra la gráfica del set destacado
  (etiqueta + nombre `lang=en`), conserva **2** líneas de confianza (no la de autenticación) y el enlace de
  acceso al pie.

### Solicitudes al arquitecto
- Ninguna. El contrato v1.9-set-chart cubre todo lo necesario (endpoint público + DTOs). El endpoint genérico
  por-id `GET /catalog/sets/:id/value-history` existe en el contrato pero **no** se consume aún (el hero usa
  el resuelto server-side); queda disponible para una futura gráfica de "otro set".

## Ronda C · BE-10 — Bóveda de la ficha 360° con acabado + valor (2026-08-16)

Contrato: **API_CONTRACT v1.8-ronda-c** (§M6 nota BE-10, §11 `AdminUserOwnedItemRef`). La proyección de la
pestaña **Bóveda** de la ficha 360° (`GET /admin/users/:id`) ahora trae, por item en custodia,
`productType`, `finish: Finish` y `referenceValue: PriceInfo` (mismo `PriceInfo` por-acabado que
`HoldingDTO`). Solo `frontend/` + esta nota. **No** se tocó backend, contrato ni `TECH_DEBT.md`. Gates
verdes: `lint` ✓ · `typecheck` ✓ · `vitest` **157/157** (29 archivos) · `next build` ✓ · Playwright **40/40**.

### Qué se implementó
- **Tipo (`types/contract.ts`):** `AdminUserOwnedItemRef` gana `productType: ProductType`, `finish: Finish`
  y `referenceValue: PriceInfo` (antes solo `inventoryItemId/folio/card/ownershipStatus`). Se retiró la nota
  de "solicitud al arquitecto" que pedía justo estos campos: el contrato Ronda C ya los entrega.
- **`VaultTab` (M6View.tsx):** pasó de tabla folio+carta+titularidad a folio · carta **+ acabado** ·
  titularidad · **valor**. El acabado se pinta con **`FinishBadge`** (mismo mapeo `finish.*` que Compra y la
  bóveda del cliente; no se inventó label nuevo — para graded/sealed `normal` se oculta, es ruido). El valor
  usa el mismo tratamiento honesto que `VaultView`: `priced` → `formatMoneyCents(referenceMxnCents)`;
  `pending` → **`StatusBadge domain="price" value="pending"`** ("PRECIO PENDIENTE", warning outline), **nunca
  `$0` ni `—`**.
- **Total de la bóveda (sí encajó limpio):** pie de tabla con **valor total** = suma de los `referenceValue`
  **priced**; los `pending` se **excluyen** del total y se indican aparte con un contador (paridad con el
  `pendingPriceCount` del portafolio del cliente, DESIGN_SYSTEM §7.3). Layout minimalista: eyebrow + cifra
  `tabular` a la derecha, separado por regla superior (sin radios/sombras nuevas; sin tocar `shadow-focus`).
- **Mock (`lib/mock/fixtures.ts`):** `mockAdminUserDetail('u-777').ownedItems` ahora trae dos items —
  Blastoise holofoil **priced** (`128000` cents) y Pikachu reverse_holo **pending** — para ejercer ambos
  renders en preview/tests sin backend real.
- **Test (`M6View.test.tsx`):** nuevo caso que abre la pestaña Bóveda y verifica acabado legible (Holofoil /
  Reverse Holo), valor priced formateado, estado pendiente honesto ("Precio pendiente"), total sin pendientes
  y el contador de pendientes.

### i18n nuevas (ES/EN, bajo `admin.m6`) — paridad verificada por `i18n-parity.test.ts`
- `vaultTotal`: **"Valor total (con precio)"** / **"Total value (priced)"**.
- `vaultPending` (ICU plural): **"{count} carta(s) con precio pendiente (excluidas del total)"** /
  **"{count} card(s) with price pending (excluded from total)"**.
- El acabado reusa `finish.*` (ya existían); el estado pendiente reusa `status.price.pending` ("Precio
  pendiente" / "Price pending") y `catalog.marketValue` ("Valor de mercado" / "Market value"). Sin strings
  nuevas para esos dos.

### Solicitudes al arquitecto
- Ninguna. BE-10 cubrió exactamente lo que faltaba (`finish` + `referenceValue` en la proyección de bóveda).

## Destacadas por precio (home) + cierre en lote de deuda 5a (2026-08-16)

Dos cosas, solo `frontend/` (+ esta nota + entradas 5a de `TECH_DEBT.md`). **No** se tocó backend, el
contrato ni las decisiones ratificadas del rediseño (minimalista, sin tema oscuro). Gates verdes al
final: `lint` ✓ · `typecheck` ✓ · `vitest` **156/156** (29 archivos) · `next build` ✓ · Playwright **40/40**.

### 1. DESTACADAS = las MÁS CARAS del inventario real (`(storefront)/page.tsx`)
La home pedía `getCatalog({})` y tomaba `.filter(sellable).slice(0,4)` **sin ordenar por precio**, así que
las "destacadas" eran las 4 primeras del orden por defecto del backend, no las de mayor valor.
- Ahora pide **`getCatalog({ sort: 'price_desc', pageSize: FEATURED })`** (`FEATURED=4`). El backend ordena
  por `salePriceCents` sobre el **set completo ANTES de paginar** y solo devuelve sellables con precio
  (excluye precio-pendiente), así que las 4 que llegan son las de mayor `salePriceCents`. `CatalogSort` y el
  filtro `sort`/`pageSize` ya existían en `lib/api.ts` (no se tocó el contrato).
- `queryKey` cambiado a **`['catalog', { home: true, sort: 'price_desc' }]`** para no colisionar con la caché
  del catálogo general (`CatalogView` usa su propia key con filtros).
- Se **conserva** `.filter(sellable).slice(0, FEATURED)` como red de seguridad. Con inventario vacío no pinta
  nada (correcto); al poblarse, las 4 serán las de mayor precio.

### 2. Deuda del rediseño 5a — cerrada/degradada en lote (IDs `5a-D1/D3/D4/D5/D6` + menores de la home)
- **5a-D3 (CERRADA):** anillo de foco unificado al token **`shadow-focus` (2px)**. Se quitaron los
  `shadow-[0_0_0_3px_var(--color-focus-ring)]` (3px inline) de `DisputeEvidenceContact.tsx` (link mailto +
  botón Copiar) y `PhotoUploader.tsx` (botón de captura). `Button.tsx` ya no tenía inline 3px (usa el
  `:focus-visible` global). Ya **no** hay ningún anillo de 3px en el código (grep `shadow-[0_0_0_3px` → 0);
  todo el foco es el `outline` global o `shadow-focus` 2px, consistente con Input/Select. Sin doble anillo
  (los controles mantienen `outline-none`).
- **5a-D4 (CERRADA):** `ListingSpec.tsx` variante `compact` graded ahora compone el **`aria-label` con
  empresa + grado + cert SIEMPRE** (§7.2b), aunque el texto **visible** siga abreviado (sin cert en la
  retícula). Se construye `gradedAriaLabel` cuando el cert se omite del visible; el `aria-label` final es el
  del tooltip NM (raw) o `gradedAriaLabel` (graded compacto).
- **5a-D5 (CERRADA):** se quitaron las vars muertas **`--radius-sm/md/lg/xl`** de `globals.css` (Tailwind
  hardcodea `borderRadius: 0px`; nadie consume `var(--radius-*)`). No existían vars `--shadow-*` en
  `globals.css` (el único boxShadow con var es `boxShadow.focus` en tailwind.config, que SÍ se usa). **No** se
  tocó `--color-focus-ring` ni `boxShadow.focus`.
- **5a-D6 (CERRADA):** en `PortfolioTrendChart.tsx`, el fallback `LIGHT.up` pasó de `#4E7A49` a **`#4a7345`**
  para alinearse al token vivo `--color-success` (ya ajustado al fix de contraste AA). Elimina el drift en el
  primer paint antes de que `useTrendColors` lea el token real.
- **5a-D1 (CERRADA — opción b, ELIMINADO):** `ConditionBadge` estaba **huérfano** (solo lo importaba su
  test). Se **eliminó** el componente **y su test**. Razón: el rediseño 5a sustituyó la fila de pastillas
  (condición + acabado + cert) por el renglón mono `ListingSpec`, y la **ficha de detalle** (`CardDetailView`)
  pinta la condición como **`Fact` de texto plano** coherente con la dirección minimalista ratificada, con
  `CertNumberField` para el cert gradeado. Adoptar `ConditionBadge` (un `Badge`/pastilla de color +
  `GradedCertChip`) dentro de esos Facts de texto plano sería **forzado** y reintroduciría pastillas que el
  rediseño quitó a propósito. `GradedCertChip` **sobrevive** intacto: lo usa el back-office M8 (`M8View`) de
  forma independiente. El E2E `catalog.spec.ts:56` ("la ficha de detalle pinta la condición con su etiqueta
  legible") sigue verde, confirmando que la lógica inline de la ficha cubre el caso.
- **Menores de la home (qa):**
  - Las queries de la home ya **no degradan en silencio** a grid vacío si fallan. `catalog` (destacadas) y
    `holdings` (valor por set) muestran un bloque **error + botón Reintentar** (`common.errorTitle` +
    `common.retry`, `Button` secundario que llama `refetch()`), con el estilo `rule-note` minimalista.
  - `PortfolioGlance` → el `Sparkline` con `summary=""` ahora es **`aria-hidden`** en vez de `role="img"` con
    `aria-label` vacío. `Sparkline` decide: con `summary` no vacío mantiene `role="img"`+`aria-label` (vista
    completa, con tabla accesible); con `summary` vacío (el vistazo de la home, donde el `Delta` ya narra el
    cambio) es decorativo. Sin lectores anunciando "imagen" sin contenido.


## Adopción del rediseño 5a "sin look de IA" + fix del anillo de foco (2026-08-16)

Rama `claude/rediseno-5a-pantallas`. Una sesión hermana implementó el rediseño 5a (paleta papel/tinta
`#f4f1ea`/`#1a1a18` + bermellón `#b44b3a`, fuentes self-hosted por `next/font`, radios y sombras a 0,
tema oscuro eliminado, carrito en header, `domain/ListingSpec.tsx`, primitivas refinadas). Como rol dueño
de `frontend/` se **adoptó** (revisión + verificación, sin rehacer el diseño). Se respetan las decisiones
ratificadas por el humano: StatusBadge sin iconos en críticos y NM abreviado (mono) en la retícula
—accesibles vía `aria-label`/`title`—, tema oscuro eliminado, y `Home.dc.html` diferida (no implementada).

### MUST-FIX 1 — anillo de foco de accesibilidad (RESTAURADO en Input/Select)
El grueso de la infraestructura de foco **sobrevivió** a "sombras 0" y se confirmó intacta:
- `globals.css` conserva `--color-focus-ring: #b44b3a` y el `:focus-visible` global
  (`outline: 2px solid var(--color-focus-ring); outline-offset: 2px`). Botones y links (sin `outline-none`)
  reciben ese anillo bermellón. `PhotoUploader` trae su propio sustituto `focus-visible:shadow-[0_0_0_3px…]`.
- `tailwind.config.ts` conserva `boxShadow.focus = '0 0 0 2px var(--color-focus-ring)'` (clase `shadow-focus`).

**Hallazgo real y corregido:** `components/ui/Input.tsx` y `Select.tsx` ponían `outline-none` en el control
interno (capa `utilities`), que **gana** sobre el `:focus-visible` global (capa `base`), y el wrapper solo
cambiaba el borde inferior (`border-strong` 32% → `border-text` 100%). Ese indicador de un solo borde es
débil y —clave— DESIGN_SYSTEM §6.2 exige que el foco de un campo sea **`borde --color-primary` + `--shadow-focus`**
(el anillo), reforzado por §8.2 ("foco visible SIEMPRE; el anillo sobrevive a sombras 0"). El rediseño había
soltado el anillo en campos/selects. Fix (solo estas dos primitivas): se añadió `focus-within:shadow-focus`
al wrapper de ambos (el `<input>`/`<select>` interno mantiene `outline-none`, así no hay doble anillo). Ahora
un campo enfocado muestra borde tinta + anillo bermellón 2px, alineado con §6.2/§8.2. Sin tocar
DESIGN_SYSTEM (es de ux-ui); solo se **implementó** lo que ya especificaba.

### Cierre de accesibilidad pre-merge 5a — 2 ajustes qa/techlead (2026-08-16)
Antes del merge del rediseño 5a se cerraron los **dos hallazgos de accesibilidad** que qa y techlead
dejaron como no-negociables (foco visible SIEMPRE + contraste AA, DESIGN_SYSTEM §8.2). Solo se tocó
`frontend/` (+ `docs/`). Las decisiones ratificadas por el humano se respetan sin cambios (StatusBadge
sin iconos, NM abreviado, sin tema oscuro, home diferida).

- **FIX 1 — foco visible en el `<select>` "Ver como" del back-office** (`components/layout/AdminTopbar.tsx`).
  El select del switch de rol tenía `outline-none` **sin sustituto**: `outline-none` (capa utilities) mata
  el `:focus-visible` global (capa base), así que el foco de teclado era **invisible**. Fix: se añadió
  `focus-visible:shadow-focus` **al propio control** (mismo token bermellón 2px que Input/Select). Se puso
  en el control y no en el `<label>` wrapper porque el label envuelve además el texto "Ver como" y el
  triángulo ▾ — un `focus-within` ahí anillaría de más; en el control el anillo cae solo sobre el select,
  sin doble anillo (el `outline-none` sigue matando el outline global).

- **FIX 2 — contraste AA de `--color-success` + consistencia de anillo en inputs crudos**
  (`app/globals.css`, `components/domain/ShopFilters.tsx`, `app/[locale]/(storefront)/catalog/CatalogView.tsx`).
  - `--color-success` pasó de `#4E7A49` (**4.43:1** sobre el papel `#F4F1EA`, por debajo de AA 4.5:1) a
    **`#4A7345`** = **4.86:1** (AA ✓). Se oscureció lo mínimo para cruzar el umbral sin alterar la
    identidad (verde de tinta, no relleno). Ratio verificado con la fórmula WCAG 2.x sobre el papel real.
  - Inputs crudos que usaban `outline-none` + solo `focus:border-text` (un indicador de un solo borde,
    débil): buscador de bloque de `ShopFilters` (`RuleSearch`), wrapper de precio min/max de `ShopFilters`
    (`PriceFilter`), y el buscador de catálogo de `CatalogView`. Se unificaron al **anillo bermellón**
    consistente con Input/Select: `focus-within:shadow-focus` en el `<span>` wrapper del precio, y
    `focus-visible:shadow-focus` en los `<input>` crudos de búsqueda (que no tienen wrapper propio),
    manteniendo `focus:border-text`. Sin doble anillo (los inputs conservan `outline-none`).

**Deuda no bloqueante registrada** (techlead) en `TECH_DEBT.md` sección Frontend, IDs `5a-D1/D3/D4/D5/D6`:
`ConditionBadge` huérfano + condición triplicada; grosor de anillo 3px vs token 2px; `certNumber` ausente
en el `aria-label` de `ListingSpec` graded compacto; vars `--radius-*`/`--shadow-*` muertas en globals.css;
y `PortfolioTrendChart` con hex de paleta hardcodeados. **No** se corrigen en este pase (solo registro).

**Gates:** `lint`, `typecheck`, `vitest`, `next build` y `npx playwright test` (40 E2E) — verdes tras los fixes.

### Verificaciones (todas OK, sin cambios extra)
- **Fuentes:** `app/[locale]/layout.tsx` carga Zen Old Mincho / Archivo / JetBrains Mono por `next/font/google`
  (self-host, `display:'swap'`, sin FOUT roto), exponiendo `--font-serif`/`--font-sans`/`--font-mono` que
  consumen `globals.css` y el `fontFamily` de tailwind. El viejo `--font-inter: 'Inter'` (que nunca se cargaba)
  ya no existe. `body` usa `font-sans`; H1–H4 y `.vertical-label` usan `--font-serif`; cifras/eyebrow, `--font-mono`.
- **Header carrito:** `StorefrontHeader` usa `useCart()` (`lib/cart.ts`), que arranca en `useState([])` y lee
  `localStorage` en `useEffect` → servidor y primer render de cliente pintan `count=0` idéntico (sin mismatch de
  hidratación); la sesión usa el patrón `ready` de `useSession`. Contador visible en desktop y en el menú móvil.
- **i18n paridad:** las 5 claves nuevas existen en ES y EN — `nav.cart` (Carrito/Cart),
  `checkout.removeItem` (Quitar/Remove), `vault.cardColumn` (Carta/Card), `vault.statusColumn` (Estado/Status),
  `admin.superAdminTag` (Súper/Super). El test `i18n-parity` pasa.

### Gates (desde `frontend/`, tras el fix)
`npm run lint` ✓ (0 warnings) · `npm run typecheck` ✓ · `npm run test` (vitest) **163/163** (30 archivos) ·
`npm run build` ✓ (rutas es/en prerenderizadas, `next/font` descarga las 3 familias vía el proxy) ·
Playwright `npx playwright test` **40/40** verdes (Chromium `/opt/pw-browsers/chromium`, server dev en modo
mocks). El fix del anillo es CSS aditivo (una clase `focus-within:shadow-focus` en dos wrappers): no altera
roles/textos/selectores, por eso los 40 E2E siguen verdes.

### Solicitudes al arquitecto
Ninguna. La adopción no consumió endpoints nuevos ni tocó el contrato; el único cambio es de accesibilidad/UI.

## A3 subida robusta de INE + D1 alta M1 por set + G1 bóveda por set (2026-08-16)

Tres cambios independientes, solo `frontend/` (+ esta nota). **No** se tocó el contrato ni backend.
Gates verdes: `lint` ✓ · `typecheck` ✓ · `test` **159** (incl. paridad i18n) · `build` ✓.

### A3 — Compresión/normalización de la foto de INE antes de subir (`components/ui/PhotoUploader.tsx`)

Problema: se subía la foto **cruda** del teléfono (a veces >10 MB → el backend la rechazaba con 422 y el
front lo rotulaba MAL como "no es imagen"); iOS envía **HEIC**, que el presign `image/jpeg` no espera.

Fix (solo cliente, sin tocar el flujo backend):
- **Compresión vía canvas** (`compressImage(file)`): carga la imagen (`img.decode()`), escala al **lado
  máximo ~2000px** manteniendo aspecto, y re-exporta con `canvas.toBlob(_, 'image/jpeg', 0.85)`. Esto baja el
  peso y **normaliza HEIC→JPEG**. Se envuelve el Blob en `new File([blob], 'ine.jpg', { type: 'image/jpeg' })`.
  Si el navegador no puede decodificar (p. ej. HEIC en un navegador sin soporte) o `toBlob` da `null`, hace
  **fallback al archivo original** para no bloquear (el backend valida al final).
- **`contentType`/`contentLength` recalculados del BLOB comprimido** (`upload.type` = `image/jpeg`,
  `upload.size`) y pasados a `presignUpload` → **coinciden con lo que se firma** (residuo S-B3). El PUT sube el
  mismo Blob (`uploadToPresignedUrl(presign, upload)`; usa `upload.type` como `Content-Type`).
- **Chequeo de tamaño movido ANTES de `presignUpload`**, sobre el Blob ya comprimido, contra `maxBytes`
  (prop/`DEFAULT_MAX_UPLOAD_BYTES`); el `presign.maxBytes` sigue como fuente de verdad afinada después.
- **Mapeo de error corregido:** `FILE_TOO_LARGE` (413) → `ine.errTooLarge` ("demasiado grande");
  `VALIDATION_ERROR` (no-imagen) → `ine.errNotImage`; resto → `ine.errUpload`. Ya no se rotula tamaño como
  "no es imagen" (además, al enviar siempre `image/jpeg`, el 422 de content-type deja de aparecer).
- **Estado `processing`** nuevo (spinner + label mientras comprime). i18n nueva: **`ine.processing`** (ES/EN).

### D1 — Alta de inventario M1 sobre el catálogo REAL (`app/[locale]/(admin)/admin/m1/M1View.tsx`)

Antes el dropdown "Carta" salía de `mockCards` (import estático, pocas cartas, sin filtro por set). Se
reemplazó por el patrón del cotizador (`BuylistView`):
- Se **eliminó** el import/uso de `mockCards` en el picker. Estado nuevo `setId`/`searchInput`/`searchQuery`/
  `selectedCard: CardDTO | null`. `<Select>` de set (`listBuylistSets`) + `<Input>` de búsqueda + lista de
  resultados `role="listbox"` (`searchBuylistCards`, `useQuery` gated por `hasSearch`), con `QueryState`
  (loading/error/empty). Ambos endpoints son `@Public()` y usables desde admin (contrato §6).
- `selectedCard`/`availableFinishes` se derivan del **`CardDTO` real** elegido (no de fixtures). El resto del
  formulario (acabado v1.6, tipo, graded/sealed, ubicación, tipo de adquisición, %) **no cambió**.
- **Botón "Crear" cableado** a `createInventoryItem` (nueva en `lib/api.ts`, con rama real
  `POST /admin/inventory/items` y rama **mock** marcada), pasando `cardId: selectedCard.id` + los campos del
  form. `useMutation` con `loading`, deshabilitado si `!selectedCard`/cert faltante, invalida
  `['admin-inventory']` al éxito y muestra `admin.m1.createError` en fallo.
- i18n nueva en `admin.m1` (ES/EN): `filterBySet`, `allSets`, `searchCards`, `searchPlaceholder`,
  `searchAction`, `searchResults`, `noResults`, `selectedCard`, `chooseCardFirst`, `createError`.

### G1 — Bóveda del cliente por set + valor por set (`app/[locale]/(storefront)/vault/VaultView.tsx`)

`HoldingDTO.card` expone **`setId` y `setName`**, así que se agrupa por **`setId`** sin ambigüedad (no hizo
falta agrupar por `setName` ni inventar campos). Todo client-side; el portafolio ya trae `referenceValue`.
- **Filtro por set** (`<Select>` poblado con los sets **distinct presentes en los holdings**, opción "Todos")
  que filtra la lista. Estado `setFilter`.
- **Valor por set**: panel de desglose que suma `referenceValue.referenceMxnCents` por set (los pendientes sin
  valor no aportan), con `formatMoneyCents`. **Total del subconjunto filtrado** mostrado junto al filtro.
- **Decisión de presentación:** se optó por **filtro + desglose de valor por set** manteniendo la **lista plana
  que respeta el orden del control "Ordenar por"** (el contrato/tarea permite "filtro **y/o** agrupada"). Se
  evitó forzar el agrupamiento visual del grid porque re-ordenaría las cartas por set y rompería la semántica
  del sort por valor (y los tests `VaultView.test.tsx` que verifican ese orden). Así se cumplen los tres datos
  pedidos (filtro por set, valor por set, total filtrado) sin colisionar con el ordenamiento existente.
- i18n nueva en `vault` (ES/EN): `setFilter.label`, `setFilter.all`, `valueBySet`, `filteredTotal`, `setCount`.

Sin solicitudes al arquitecto: los tres cambios caben en el contrato v1.6 actual (uploads `kyc_ine`,
`/buylist/sets` + `/buylist/cards`, `POST /admin/inventory/items`, `/vault/holdings`).

## C1 idioma por defecto ES + B2 re-sync forzado en M2 (2026-08-16)

Dos cambios independientes, solo `frontend/` (+ esta nota). **No** se tocó el contrato ni backend.
Gates verdes: `lint` ✓ · `typecheck` ✓ · `test` **159** (incl. paridad i18n + tests nuevos) · `build` ✓.

### C1 — Español como idioma por defecto SIEMPRE (aunque el navegador esté en inglés)

Diagnóstico: `defaultLocale` **ya** era `'es'` en `src/i18n/routing.ts`, pero next-intl v4 trae
`localeDetection: true` por defecto, así que el middleware detectaba el idioma por el header
`accept-language` **y** por la cookie `NEXT_LOCALE`. Un navegador en `en-US` que abría `/` era
redirigido a `/en`. Ese era el comportamiento no deseado.

Fix (un solo archivo de routing):
- **`src/i18n/routing.ts`** — se añadió **`localeDetection: false`** a `defineRouting`. Según los tipos de
  next-intl v4 (`RoutingConfig.localeDetection`), esto hace que el middleware **deje de usar** el header
  `accept-language` **y** la cookie para detectar el idioma. Con `localePrefix: 'always'` + `defaultLocale:
  'es'`, la ruta raíz `/` y cualquier ruta sin prefijo resuelven a **`/es`** de forma determinista,
  independientemente del idioma del navegador.
- **`src/middleware.ts`** — **sin cambios**: ya delega en `routing` vía `createMiddleware(routing)`, por lo
  que hereda `localeDetection: false`. No hizo falta pasar opciones extra al middleware.
- **`src/i18n/request.ts`** — **sin cambios**: ya cae a `routing.defaultLocale` ('es') cuando el locale
  entrante es inválido/ausente.
- **`src/lib/config.ts`** — **ya** alineado: `defaultLocale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'es'`.
  **Valor esperado del env:** `NEXT_PUBLIC_DEFAULT_LOCALE=es` (y su par server-side `DEFAULT_LOCALE=es`).
  Verificado que `.env.example`, `docker-compose*.yml`, `Dockerfile.frontend` y los workflows de CI ya lo
  fijan en `es` (esos archivos son de devops; aquí solo se documenta el valor esperado). **En Vercel/deploy
  la variable `NEXT_PUBLIC_DEFAULT_LOCALE` debe valer `es`.**
- **Selector de idioma (`src/components/ui/LocaleToggle.tsx`)** — **sin cambios**: ya es un segmented control
  ES|EN que refleja el locale activo (`useLocale`, `aria-pressed`) y alterna con
  `router.replace(pathname, { locale })`. Con `localePrefix:'always'`, picar EN navega a `/en` y picar ES
  vuelve a `/es`, preservando la ruta. El estado activo (ES por defecto) se ve reflejado al arrancar.

Cómo se verificó:
- **Test nuevo `src/i18n/routing.test.ts`** (4 casos): `defaultLocale==='es'`, `locales==['es','en']`,
  `localePrefix` modo `'always'`, y **`routing.localeDetection===false`** (documenta que la raíz resuelve a
  `/es` aunque el navegador esté en inglés).
- **`build`** prerenderiza cada ruta en `/es` y `/en`; el `Middleware` (45.9 kB) compila con el routing nuevo.
- Comportamiento efectivo: con detección desactivada, la única forma de llegar a EN es el **switch explícito**
  del usuario (o entrar directo a una URL `/en/...`), que es justo lo pedido.

### B2 — Botón "Re-sincronizar todo (forzar)" en el admin M2

Contrato §M2 (v1.6-finish): `POST /admin/catalog/sync-all` gana **`force?: boolean = false`**. `force=true`
**no filtra** los sets ya importados y reprocesa TODO el catálogo para repoblar `availableFinishes`/precios
por acabado tras M-18. Aditivo y retrocompatible.

- **`src/lib/api.ts` · `syncAllCatalog`** — extendida con `input: { force?: boolean } = {}`. En rama real, el
  body solo incluye `{ force: true }` cuando se pide forzar (omitirlo preserva el body vacío previo →
  retrocompatible). La rama mock, con `force=true`, encola **todos** los sets (no solo los no importados).
- **`src/app/[locale]/(admin)/admin/m2/M2View.tsx`** — nuevo botón **"Re-sincronizar todo (forzar)"** junto a
  los de sync existentes, con `RefreshCw`. Reusa el patrón de mutación/feedback ya presente: mutación
  dedicada `syncAllForceMutation`, banners `info` (corriendo) / `success` (encolado con `setsQueued`) /
  `danger` (error real con `getError`) / `warning` (404-405 = endpoint aún no en backend, vía
  `isEndpointMissing`). Por ser **operación pesada**, el botón **no dispara directo**: abre un **modal de
  confirmación** (reusa `<Modal>`) con Cancelar / "Sí, re-sincronizar todo"; solo al confirmar llama
  `syncAllForceMutation.mutate()`. Se mantiene el botón "Sync de todo el catálogo" normal (sin force) intacto.
- **i18n (`messages/{es,en}.json`, namespace `admin.m2.catalog`)** — llaves nuevas con **paridad ES/EN**:
  `syncAllForce`, `syncAllForceRunning`, `syncAllForceDone`, `syncAllForceConfirmTitle`,
  `syncAllForceConfirmBody`, `syncAllForceConfirmCta`. Pasa `i18n-parity`.
- **Tests (`M2View.test.tsx`, +2):** (1) picar el botón abre el modal y **no** llama al endpoint; al confirmar
  se llama `syncAllCatalog({ force: true })` y aparece el banner de éxito; (2) cancelar no llama al endpoint.
  Se ajustó un test previo del sync por set para usar nombre **exacto** `/^(Importar|Re-sincronizar)$/` (el
  nuevo botón "Re-sincronizar todo (forzar)" ya no lo captura por accidente).

### Solicitudes al arquitecto
Ninguna. El contrato v1.6-finish ya define `force` en `POST /admin/catalog/sync-all` (§M2); solo se consumió.


## Acabado / versión de carta (finish) en toda la cadena — v1.6-finish (2026-08-16)

Consumo del contrato **v1.6-finish** (enum `Finish = normal | reverse_holo | holofoil |
first_edition_holofoil`). El monto siempre lo deriva el backend server-side de `(rarity, finish)`
validado contra `Card.availableFinishes` (SEC-A1); el front solo **elige** el acabado y lo manda.

### Archivos tocados (todos dentro de `frontend/`)
- `src/types/contract.ts` — enum `Finish`; `CardDTO.availableFinishes: Finish[]`; `finish: Finish` en
  `ListingDTO`/`HoldingDTO`/`SellItemDTO`; `finish` (req+res) en `BuylistQuoteResponse`; `finishes:
  Finish[]` en `CatalogFacetsDTO`; `finish?` en `InventoryItemDTO` (M1).
- `src/lib/api.ts` — `CatalogFilters.finish` (query `finish` en `GET /catalog/cards`);
  `getBuylistQuote` recibe `finish?`; `CreateSellRequestInput.items[].finish?`. La rama MOCK replica
  el resolver **por acabado** (reverse_holo → "Reverse Holo"; holofoil/1st ed → rareza base si es holo,
  si no "Holo"; normal → rareza base) y una referencia por carta compartida entre acabados.
- `src/lib/mock/fixtures.ts` — `availableFinishes` por carta (`CARD_FINISHES`), `finish` en listings/
  holdings/inventory/sell-items, `finishes` en facetas, helpers `resolveBuylistRuleForFinish` /
  `mockReferenceForFinish`.
- `src/components/domain/FinishBadge.tsx` — **nuevo**: badge del acabado (i18n `finish`); se oculta para
  graded/sealed (siempre `normal`).
- `src/app/[locale]/(storefront)/buylist/BuylistView.tsx` — **selector de acabado** en el cotizador
  (§ abajo) + dedup de carrito por `(cardId, productType, finish)`.
- `src/components/domain/BuylistKycForm.tsx` — `BuylistRequestItem` gana `finish?`.
- `src/components/domain/ShopFilters.tsx` + `CatalogView.tsx` — filtro/faceta de acabado (chips) y chip
  removible activo.
- `src/components/domain/ListingCard.tsx`, `.../vault/VaultView.tsx`, `.../catalog/[cardId]/CardDetailView.tsx`
  — muestran el acabado de cada listing/holding/ejemplar.
- `src/app/[locale]/(admin)/admin/m1/M1View.tsx` — selector de acabado en el alta + columna de acabado.
- `messages/es.json` / `messages/en.json` — namespace `finish` (label + 4 acabados), `buylist.selectFinish`,
  `shop.finish.*`, `admin.m1.finish*` + columna, error `FINISH_NOT_AVAILABLE` (paridad ES/EN).

### Selector de acabado (cotizador)
Tras elegir una carta, un `<Select>` se puebla de `card.availableFinishes` (ordenado por
`FINISH_ORDER`, con etiquetas i18n Normal / Reverse Holo / Holofoil / 1st Edition). El valor viaja en
`getBuylistQuote({…, finish})` y se snapshotea en la línea del carrito y en los `items` de
`createSellRequest`. **Se muestra solo cuando** `productType==='raw'` **y** hay `>1` acabado
disponible; si la carta es `["normal"]` (o graded/sealed), queda fijo en `normal` y el selector se
oculta. La cotización muestra la **regla aplicada por acabado** (`appliedRule` que ecoa el quote) y un
`FinishBadge` con el acabado resuelto. El acabado **autoritativo** usado en el carrito es el que
**ecoa la respuesta del quote** (`quote.data.finish`), no el estado local.

### Dedup del carrito (hallazgo MENOR de QA #a)
La **identidad de línea** ahora es `(cardId + productType + finish)`. `addToCart` busca una línea
existente con esa clave: si existe, **incrementa la cantidad**; si no, crea una línea nueva. Así, la
misma carta en el mismo acabado suma cantidad (sin duplicar), y la misma carta en **acabado distinto**
es una **línea separada**. Cubierto por tests de dedup en `BuylistView.test.tsx`.

### a11y de botones (hallazgo MENOR de QA #b)
Las dos etiquetas "Enviar solicitud" se distinguen: el **CTA del carrito** es "Enviar solicitud
({count})" (abre el modal de KYC) y el **submit del modal KYC** pasó a "Confirmar y enviar"
(`buylist.submit`). Etiquetas visibles y accesibles distintas, sin ambigüedad para lector de pantalla.

### Solicitudes al arquitecto
- Ninguna. El contrato v1.6-finish cubre todo lo consumido. El mock del front asume que **una carta
  comparte la misma referencia de mercado entre acabados** (simplificación de demo); el backend real
  guarda una `PriceReference` **por acabado** — la UI no depende de esa distinción numérica.

### Gates (todos verdes)
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` (153) ✓ · `npm run build` ✓ (incluye paridad i18n ES/EN).

## Cotizador de buylist como CARRITO (varias cartas en una solicitud) — 2026-08-16

Feature **solo frontend** (sin cambio de contrato). El cotizador dejó de ser un flujo de
una-carta-a-la-vez y ahora es un **carrito**: se cotizan varias cartas y se envían en **una sola**
`POST /buylist/requests` (que ya recibía `items: RequestItemDto[]`). No se inventó ningún endpoint
batch: `POST /buylist/quote` sigue siendo **por carta** y sus resultados son **estimados** que se
snapshotean en cada línea; el monto autoritativo lo re-deriva el backend server-side (SEC-A1).

### Archivos tocados (todos dentro de `frontend/`)
- `src/app/[locale]/(storefront)/buylist/BuylistView.tsx` — reescrito: estado de carrito + panel de
  carrito + total estimado + envío único.
- `src/components/domain/BuylistKycForm.tsx` — props cambiadas de `{cardId, productType}` a
  `{items: BuylistRequestItem[]}`; el form ahora envía **todos** los items del carrito (ya
  expandidos). Nuevo tipo exportado `BuylistRequestItem = {cardId, productType, rawCondition?}`.
- `messages/es.json` / `messages/en.json` — llaves nuevas del carrito (paridad ES/EN).
- Tests: `BuylistView.test.tsx` (agrega casos de carrito), `BuylistKycForm.test.tsx` (props `items`),
  `e2e/buylist.spec.ts` (flujo cotizar → agregar al carrito → enviar).

### Flujo del carrito (pasos + UI)
1. **Buscar** por set y/o texto sobre TODO el catálogo (`GET /buylist/cards`, `GET /buylist/sets`).
2. **Elegir carta** de los resultados (`role=option`).
3. **Elegir tipo** (`raw|graded|sealed`; raw fija `NM`, sin selector) y **Cotizar**
   (`POST /buylist/quote`, por carta).
4. **Agregar al carrito** (botón `accent`): añade una **línea** con el snapshot del estimado
   (`BuylistQuoteResponse`) y `quantity=1`. Se puede agregar la misma carta varias veces (líneas
   independientes) y/o subir la **cantidad** por línea.
5. **Panel de carrito** (sección full-width bajo el cotizador): lista de líneas (nombre/set/rareza/
   tipo + estimado c/u + control −/N/+ de cantidad + quitar), **Total estimado** (suma
   `quotedPriceCents × cantidad`; las líneas `precio_pendiente` muestran "Precio pendiente" y aportan
   0), **nota de estimado** (SEC-A1) y **nota de KYC**. Carrito vacío → `EmptyState`, sin botón de
   enviar.
6. **Enviar solicitud ({count})** (habilitado con ≥1 línea) abre **una sola vez** el `BuylistKycForm`
   (CLABE + INE por presign `kyc_ine`) y llama `createSellRequest` con todos los items. Al crear:
   limpia el carrito, invalida `['sell-requests']` y muestra el banner de éxito. El requisito de
   INE/tope lo decide el **backend por el TOTAL** (no se reimplementa en el front).

### Expansión cantidad → items
Al enviar, `cart.flatMap(line => Array(line.quantity).fill({cardId, productType, rawCondition}))`
produce el array `items`: una línea con `quantity=3` genera **3 entradas** idénticas (el modelo es
1 item por carta física). El payload solo lleva `cardId/productType/rawCondition`; **no** se envían
precios ni categorías (el `ValidationPipe` descarta lo demás; SEC-A1).

### SEC-A1 / claridad
- El total del carrito se rotula explícitamente como **ESTIMADO** (`buylist.estimateNote`): "el monto
  final lo confirma la plataforma al recibir y verificar".
- No se envía monto/categoría/rareza en el payload; el backend re-deriva la regla de `Card.rarity`.

### Historial de "mis solicitudes"
Intacto: sigue consumiendo `GET /buylist/requests` y renderizando `PipelineStepper` + items con sus
`StatusBadge`. Solo se invalida su query tras crear una solicitud.

### Gates (frontend/)
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` ✓ (144/144, incluye paridad i18n y los
casos nuevos de carrito: agregar, quitar, cantidad, total, envío con múltiples items) ·
`npm run build` ✓.

### Solicitudes al arquitecto
Ninguna. El contrato ya soportaba múltiples ítems en `POST /buylist/requests`; no hizo falta ningún
campo/endpoint nuevo.

## v1.5-auth-email — Verificación de correo + recuperación self-service (2026-08-16)

Implementación del changelog `v1.5-auth-email` del contrato (§1). Verificar el correo **NO** bloquea
login/navegación; **sí** bloquea acciones sensibles (el backend responde `403 EMAIL_NOT_VERIFIED` al
comprar/vender/retirar). Recuperación por email self-service **además** del reset por admin (M6). El
reenvío de verificación es **autenticado**. Solo se tocó `frontend/`.

### Endpoints consumidos (shapes exactos del contrato §1)
- `POST /auth/verify-email` `{token}` → `{verified:true}` (422 `EMAIL_VERIFY_TOKEN_INVALID`) — `verifyEmail(token)`.
- `POST /auth/verify-email/resend` (autenticado, `{}`) → `{ok:true}` (429 `RATE_LIMITED`) — `resendVerificationEmail()`.
- `POST /auth/forgot-password` `{email}` → **siempre** `{ok:true}` — `forgotPassword(email)`.
- `POST /auth/reset-password` `{token, password}` → `{ok:true}` (422 `RESET_TOKEN_INVALID`, 400 `VALIDATION_ERROR`) — `resetPassword({token,password})`.
- `user` de login/register y `GET /users/me` ahora incluye `emailVerified` (ya estaba tipado opcional en `UserDTO`).

### Tipos (`types/contract.ts`)
Añadidos `VerifyEmailResponse`, `ResendVerificationResponse`, `ForgotPasswordResponse`,
`ResetPasswordSelfResponse` (este último NO se llama `ResetPasswordResponse` para no chocar con el ya
existente del reset por admin de M6). `UserDTO.emailVerified` ya existía.

### Pantallas y componentes (rutas nuevas, grupo `(auth)` → URL `/[locale]/…`)
- **`/[locale]/verify-email`** (`(auth)/verify-email/`): la `page` (server) lee `?token=` y lo pasa a
  `VerifyEmailView` (client). Al montar, si hay token, llama `verifyEmail`. Estados: *verificando* →
  *éxito* (banner success "Correo verificado" + link a la tienda) / *inválido* (banner danger, 422). En
  el estado inválido, si hay sesión ofrece **Reenviar** (autenticado); sin sesión invita a iniciar
  sesión. Un `useRef` evita la doble verificación de StrictMode. En éxito, `verifyEmail` hace
  `patchStoredUser({emailVerified:true})` para quitar el banner sin re-consultar `/users/me`.
- **`/[locale]/reset-password`** (`(auth)/reset-password/`): `page` lee `?token=`, `ResetPasswordView`
  es el formulario (nueva contraseña + confirmación). **Política de fuerza igual al registro**: MinLength
  8 (contrato) validado en cliente + confirmación que debe coincidir. Éxito → mensaje + link a login (el
  backend revoca sesiones; el usuario re-inicia sesión, por eso el endpoint no devuelve tokens). `422
  RESET_TOKEN_INVALID` → estado "enlace inválido/expirado" con CTA a **forgot-password**.
- **`/[locale]/forgot-password`** (`(auth)/forgot-password/`): input de email → `forgotPassword` →
  **siempre** el mismo mensaje genérico ("si el correo existe, te enviamos instrucciones"), respetando
  anti-enumeración. Único caso distinto: `429 RATE_LIMITED` (aviso de reintento); cualquier otro error se
  trata también como "enviado" para no filtrar señal. Enlazada desde el login ("¿Olvidaste tu
  contraseña?", solo en modo login de `AuthForm`).
- **Banner "verifica tu correo"** (`components/domain/VerifyEmailBanner.tsx`): montado en el shell de la
  tienda (`(storefront)/layout.tsx`) bajo el header. Persistente (no dismissible) mientras el usuario
  logueado tenga `emailVerified===false`; usa `useSession` (con `ready` para evitar mismatch de
  hidratación). Variante `warning` (no bloquea navegación). CTA "Reenviar correo de verificación" →
  `resendVerificationEmail`, con feedback ("correo enviado" / rate-limit / error).
- **Aviso de 403** (`components/domain/EmailNotVerifiedNotice.tsx`): banner `danger` reutilizable con CTA
  de reenvío para el caso `403 EMAIL_NOT_VERIFIED`.
- **Hook compartido** (`hooks/useResendVerification.ts`): centraliza el reenvío + estados
  (`idle|sending|sent|rateLimited|error`) que usan el banner y el aviso de 403.

### Manejo de `403 EMAIL_NOT_VERIFIED`
Centralizado en el componente `EmailNotVerifiedNotice` (mensaje claro + CTA de reenvío) en vez de un
error genérico. Cableado en el **paso real de venta** (`BuylistKycForm` → `POST /buylist/requests`): el
`catch` detecta `code === 'EMAIL_NOT_VERIFIED'` y muestra el aviso. La compra (`/checkout/session`) y el
retiro (`/shipments`) siguen **mockeados / pendientes de integración Stripe** (no hay `createCheckoutSession`
/ `createShipment` real todavía); cuando se cablee Stripe, el mismo `EmailNotVerifiedNotice` se reutiliza
en esos `catch` (mismo patrón). El `errorCode` también está traducido (`error.EMAIL_NOT_VERIFIED`) para
cualquier ruta que caiga al `QueryState`/`useErrorMessage` genérico.

### i18n (paridad ES/EN)
Secciones nuevas `verifyEmail`, `forgotPassword`, `resetPassword` + `auth.forgotPassword` +
`error.EMAIL_NOT_VERIFIED` / `error.EMAIL_VERIFY_TOKEN_INVALID` / `error.RESET_TOKEN_INVALID` en
`messages/es.json` y `en.json`. El test de paridad (`lib/i18n-parity.test.ts`) pasa.

### Mocks (modo `NEXT_PUBLIC_USE_MOCKS`)
`verifyEmail`/`resetPassword` simulan el `422` cuando el token está vacío o contiene
`invalid|expired|bad`; en otro caso, éxito. `resendVerificationEmail`/`forgotPassword` devuelven `{ok:true}`.
Marcados `// MOCK: pendiente de backend real`.

### Gates (todos verdes)
`npm run lint` (0 warnings), `npm run typecheck` (ok), `npm run test` (29 archivos, 138 tests, incl.
paridad i18n), `npm run build` (ok; rutas `verify-email`/`reset-password`/`forgot-password` generadas
para es/en). Tests nuevos: `VerifyEmailView.test`, `ResetPasswordView.test`, `ForgotPasswordView.test`
(cubre anti-enumeración), `VerifyEmailBanner.test`.

### Solicitudes al arquitecto
Ninguna: los cuatro endpoints y sus shapes están cerrados en el contrato §1. Nota de seguimiento (no
bloqueante): cuando se integre Stripe para `/checkout/session` y `/shipments`, cablear el mismo
`EmailNotVerifiedNotice` en sus `catch` (hoy esas dos acciones están mockeadas).

## v1.4-finance FIX — alinear el P&L de M7 al shape de 6 claves (2026-08-16)

Corrección de RECHAZO de qa/techlead: la ronda previa renombró el P&L solo en la captura (M4) pero
dejó ROTO el consumidor real, **`M7View`** (está montado en `m7/page.tsx` y consume el endpoint real
`GET /admin/finance/pnl`; NO es un stub — la nota previa que decía "ModuleTodo/stub" era incorrecta).
Contrato §M7 ya define el shape nuevo y el backend ya lo devuelve; esto solo espeja el front (sin tocar
el contrato).

Shape del contrato §M7 (6 claves):
`{ incomeCents, shippingRevenueCents, cogsCents, stripeFeesCents, shippingCostCents, profitCents }`
con `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`.

Cambios (solo `frontend/`):
- **`types/contract.ts` · `PnlDTO`**: `shippingCents`→`shippingRevenueCents` y **añade**
  `shippingCostCents: number`. Idéntico al contrato de 6 claves.
- **`m7/M7View.tsx`**: el desglose del P&L ahora pinta 5 líneas + total:
  - `+ Ingresos (ventas)` = `incomeCents`
  - `+ Ingreso por envío (cobrado)` = `shippingRevenueCents` (antes `shipping`/`shippingCents`)
  - `− Costo de lo vendido` = `cogsCents`
  - `− Comisiones Stripe` = `stripeFeesCents`
  - `− Costo de envío (paquetería)` = `shippingCostCents` (**NUEVA** línea, resta, mismo `PnlLine`/patrón)
  - `= Ganancia del periodo` = `profitCents` (el desglose cuadra con `profitCents`).
- **i18n `admin.m7.pnl`** (es/en, paridad): la llave `shipping` se renombró a `shippingRevenue`
  ("Ingreso por envío (cobrado)" / "Shipping revenue (collected)") y se añadió `shippingCost`
  ("Costo de envío (paquetería)" / "Shipping cost (carrier)"). También se ajustó `formula`.
- **`lib/mock/fixtures.ts`**: `mockPnl` y `mockCsv` al shape de 6 claves. `shippingCostCents = 31_800`
  ejemplo; profit mock = 1_250_000 + 52_500 − 640_000 − 48_300 − 31_800 = **582_400** cts (MX$5,824.00).
- **Tests**: `M7View.test.tsx` actualizado (nuevo profit + assert de las líneas de envío ingreso/costo);
  nuevo `m4/pesosToCents.test.ts` (vacío/0/decimal/miles/negativo/no-numérico). `pesosToCents` se
  **exportó** desde `M4View.tsx` para poder testearlo.

### M4 `openTracking` (5a) — NO precargable hoy: requiere campo nuevo en el DTO admin
Se intentó precargar el costo ya capturado al reabrir el modal de captura de guía. **`ShipmentDTO`
(`types/contract.ts`) NO expone `shippingCostCents`**, y el contrato de `GET /admin/shipments` /
`GET /admin/shipments/:id` (§M4, líneas 586-587) tampoco lo define en el response. Por la regla de no
inventar campos, `openTracking` se dejó como está (el input arranca en `''` al reabrir).
**Solicitud al arquitecto/backend:** exponer `shippingCostCents` (costo interno, entero ≥ 0) en el
`ShipmentDTO` **del listado/detalle admin** (`GET /admin/shipments` y `/:id`) — NO en el `GET
/shipments/:id` del comprador (§M4 línea 588 lo marca como interno, no expuesto al cliente). Con ese
campo, `openTracking` precargaría `s.shippingCostCents` para que el operador vea el valor vigente al editar.

Gates: lint ✓ · typecheck ✓ · test (123, incl. paridad i18n) ✓ · build ✓.

## v1.4-finance — costo real de paquetería en la captura de guía de M4 (2026-08-16)

Contrato: `POST /admin/shipments/:id/tracking` gana `shippingCostCents?` (opcional, entero ≥ 0,
centavos MXN = costo real que la plataforma paga a la paquetería). Ver API_CONTRACT §M4.

Cambios (solo `frontend/`):
- **`M4View.tsx`**: se añadió el **formulario de captura de guía** (antes M4 era solo lectura). Cada
  envío no `cancelado` muestra un botón "Capturar guía" que abre un `Modal` con tres campos: paquetería
  (`carrier`), número de guía (`trackingNumber`) y **"Costo de envío (paquetería)"** (`shippingCostCents`).
  El costo se captura **en pesos** (prefix `MX$`, `inputMode="decimal"`) y se convierte a centavos con
  `pesosToCents` (`Math.round(n*100)`), igual patrón que M2. Es **opcional**: vacío → no se envía la clave.
  Validación **≥ 0** (bloquea el submit y marca el input con error si es negativo o no numérico). Muestra
  el equivalente formateado en centavos y un `Banner` de error en fallo de la mutación.
- **`lib/api.ts`**: nueva `saveShipmentTracking(shipmentId, ShipmentTrackingRequest)` → `POST
  /admin/shipments/:id/tracking`. `shippingCostCents` solo se incluye en el body cuando el operador lo
  captura. Mock actualiza el envío en memoria y lo avanza a `guia`.
- **`types/contract.ts`**: nuevo `ShipmentTrackingRequest = { carrier, trackingNumber, shippingCostCents? }`.
- **i18n**: `admin.m4.tracking.*` (capture/title/carrierLabel/numberLabel/shippingCostLabel/
  shippingCostHint/shippingCostInvalid/save) en `es.json` y `en.json` con paridad.
- **M7 P&L**: NO se tocó (sigue `ModuleTodo`/stub sin consumidores; el nuevo shape de P&L
  —`shippingRevenueCents`/`shippingCostCents`— se consumirá cuando se construya M7).

Gates: lint ✓ · typecheck ✓ · test (116, incl. paridad i18n) ✓ · build ✓.

## Mejoras UX — presets de rango en M7/M9 + orden de la bóveda (2026-08-16)

Tres mejoras chicas e independientes. Solo `frontend/` (+ esta nota). **No** se tocó el contrato ni el
backend. Todo en cliente sobre datos que ya trae la API. i18n ES/EN espejado (pasa `i18n-parity`). Gates
desde `frontend/`: `lint` OK · `typecheck` OK · `test` **116/116** (24 archivos, +3 nuevos) · `build` OK.

### 1. Presets de rango en M7 (Finanzas) y M9 (Reportes)
- Nuevo helper puro `src/lib/dateRange.ts` → `presetRange(preset, now?)` devuelve `{ from, to }` como
  `YYYY-MM-DD` (hora **local**, sin corrimiento por TZ). Presets: `week` = lunes de la semana actual (ISO) →
  hoy; `month` = mismo día del mes anterior → hoy (ventana rodante ~1 mes); `quarter` = primer día del
  trimestre actual → hoy; `year` = 1-ene del año actual → hoy. `to` siempre = hoy.
- Nuevo componente `src/components/domain/DateRangePresets.tsx` (4 botones `ghost`, `role="group"`) que al
  hacer click llama `onSelect({from,to})`. Reutilizado por M7 y M9.
- **M7** (`m7/M7View.tsx`): se montó `DateRangePresets` en la sección de rango, **sobre** el selector manual
  (que se conserva). Al elegir preset se setean `from`/`to`, y las queries que ya dependen del `range`
  (`GET /admin/finance/pnl`, `GET /admin/finance/iva`) refetchean por su `queryKey`.
- **M9** (`m9/M9View.tsx`): **sí aplica** — M9 ya tenía rango `from`/`to` para `GET
  /admin/reports/launch-metrics` y el export CSV. Se añadieron los mismos presets, misma mecánica.

### 2. Bóveda — orden por set y por valor (`(storefront)/vault/VaultView.tsx`)
- Control `Select` "Ordenar por" con: **Predeterminado** (orden del backend), **Set (A–Z)** (`card.setName`,
  desempate por `card.name`), **Valor (mayor a menor)** y **Valor (menor a mayor)**.
- El valor por carta **sí está** en `HoldingDTO`: `referenceValue.referenceMxnCents` (el valor de referencia
  de mercado del holding, contrato §3). Se ordena en cliente sobre `query.data.data` con `useMemo`. Las
  cartas con **precio pendiente** (`referenceValue.status="pending"`, sin `referenceMxnCents`) quedan
  **siempre al final** en ambos sentidos (asc y desc), no rompen el orden.

### Archivos tocados
- Nuevos: `src/lib/dateRange.ts`, `src/lib/dateRange.test.ts`,
  `src/components/domain/DateRangePresets.tsx`,
  `src/app/[locale]/(storefront)/vault/VaultView.test.tsx`.
- Editados: `m7/M7View.tsx`, `m9/M9View.tsx`, `vault/VaultView.tsx`, `m7/M7View.test.tsx` (+test de presets),
  `messages/{es,en}.json`.
- i18n nuevas (ES/EN): `common.datePresets.{label,week,month,quarter,year}`,
  `vault.sort.{label,default,set,valueDesc,valueAsc}`.

### Tests añadidos
- `dateRange.test.ts` (5): los 4 presets con fecha fija (jueves 2026-08-13) + semana ISO desde domingo.
- `M7View.test.tsx`: click en "Este año"/"Último mes" setea `from`/`to` (comparado contra `presetRange`).
- `VaultView.test.tsx` (4): orden por defecto, valor desc/asc (pendiente al final) y por set (desempate por
  nombre de carta), verificando el orden de los nombres en el DOM.

### Solicitudes al arquitecto
- Ninguna. Todo se resolvió con campos ya presentes en el contrato (`HoldingDTO.referenceValue`,
  `CardDTO.setName`, `from`/`to` de M7/M9). No hubo que inventar endpoints ni campos.

## v1.3.1 — precio de buylist por rareza + cotizador nuevo shape + M6 reset/eliminar (2026-08-16)

Consumo de los bloques del contrato **v1.3.1 §E.1 (precios por rareza)** y **§M6 (reset/eliminar
usuario)**. Solo `frontend/` (+ esta nota). **No** se tocó el contrato. Toggle de mocks intacto (rama real
`apiRequest` + rama mock) e i18n ES/EN espejado. Gates desde `frontend/`: `lint` OK · `typecheck` OK ·
`test` **106/106** (22 archivos, +9 nuevos) · `build` OK.

### 1. Editor de precio de buylist por RAREZA en M2 (`/admin/m2`, super_admin)
- **Reemplaza** la sección "rareza→categoría" (deprecada por el contrato) por un editor **una fila por
  rareza** que consume `GET /admin/pricing/rarities` (rarezas distintas del catálogo unidas a las reglas,
  con `cardCount` + `source` rule/fallback) y guarda con `PUT /admin/pricing/buylist-rules`.
- Cada fila: **selector de modo `fixed|pct`** + **campo de valor** (si `fixed` → MX$ en pesos↔centavos con
  prefijo `MX$`; si `pct` → % con sufijo `%`) + badge de origen (Regla/Fallback). Encima, un **campo de
  fallback %** para rarezas sin regla explícita.
- **Guardado sin redeploy**: el `PUT` envía `{ rules, fallbackPct }` preservando las reglas explícitas del
  servidor y aplicando el borrador encima; una rareza dejada en fallback (no editada) **no** se incluye
  (sigue en fallback); editar una fila de fallback la **promueve** a regla explícita. Loading/error/success
  con `Banner` (patrón M2).
- Se retiró de la UI el uso de `getRarityMap/updateRarityMap` (siguen en `api.ts`/fixtures como legacy
  deprecado); el editor nuevo NO los consume.

### 2. Cotizador y detalle de buylist — nuevo shape `rarity` + `appliedRule`
- `BuylistQuoteResponse` y `SellItemDTO` (`types/contract.ts`) ahora exponen **`rarity`** + **`appliedRule`
  = { mode, value, source }** en vez de `category`. `POST /buylist/requests` ya **no** envía `category`
  (`CreateSellRequestInput.items` sin `category`; el backend deriva la regla server-side de `Card.rarity`).
- `BuylistView` muestra al usuario la **rareza oficial** y la **regla aplicada legible**: `"$1.50 fijo"`
  (`ruleFixed`) o `"40% de referencia"` (`rulePct`). `BuylistKycForm` dejó de recibir/enviar `category`.
- Mock del cotizador (`api.ts`) reescrito para resolver por **regla de rareza** vía
  `fx.resolveBuylistRule()`: `fixed` cotiza sin referencia; `pct` cotiza `% de la referencia` o cae a
  `precio_pendiente` si falta; rareza sin regla → **fallback 40%**. El seed preserva el negocio vigente
  (Common/Uncommon $0.50 fijo, Reverse Holo $1.50 fijo, resto 40%).

### 3. M6 — reset de contraseña y eliminar usuario (super_admin)
- **Reset:** botón en la ficha 360° → `POST /admin/users/:id/reset-password` → modal que muestra la
  **temp password EN CLARO UNA sola vez** (bloque `code` + botón **Copiar**), con aviso de "una sola vez",
  nota para compartirla por canal seguro y nota de `mustChangePassword`. Al cerrar el modal **no** se
  re-muestra (estado local `resetResult` se limpia; también se limpia al cambiar de usuario).
- **Eliminar:** botón `destructive` con **modal de confirmación clara** → `DELETE /admin/users/:id` →
  muestra el **resultado `mode`**: `hard` = "borrado total" / `soft` = "anonimizado, conserva historial".
  Maneja **`409 CANNOT_DELETE_SELF`** (banner de error específico) y **deshabilita** el botón cuando
  `useSession().user.id === selectedId` (no borrarse a uno mismo). Nuevo valor de estado `deleted` en el
  badge de usuario (`UserStatusBadge`); las acciones de cuenta se ocultan para cuentas ya `deleted`.
- **`mustChangePassword`:** `UserDTO.mustChangePassword?`. Tras un login que lo indique, `AuthForm` muestra
  un **aviso** (`Banner` warning) con botón "Continuar" que enruta al destino por rol (no hay página
  dedicada de cambio de contraseña en el MVP; ver solicitud al arquitecto).

### Archivos
- **Tipos** `src/types/contract.ts`: +`BuylistRuleMode`, `BuylistRule`, `BuylistRuleApplied`,
  `BuylistRulesDTO`, `BuylistRarityRowDTO`, `BuylistRaritiesResponse`, `AdminUserStatus`,
  `ResetPasswordResponse`, `DeleteUserResponse`; `BuylistQuoteResponse`/`SellItemDTO` re-shaped;
  `UserDTO.mustChangePassword?`; `AdminUserSummaryDTO.status` incluye `deleted`.
- **API** `src/lib/api.ts`: +`getBuylistRarities`, `getBuylistRules`, `updateBuylistRules`,
  `resetUserPassword`, `deleteUser`; `getBuylistQuote`/`createSellRequest` re-shaped (sin `category`).
- **Fixtures** `src/lib/mock/fixtures.ts`: +`mockBuylistRules`, `mockBuylistFallbackPct`,
  `setMockBuylistRules`, `resolveBuylistRule`, `mockBuylistRarities`; `mockSellRequests` re-shaped.
- **UI** `m2/M2View.tsx` (editor por rareza), `buylist/BuylistView.tsx`, `BuylistKycForm.tsx`,
  `m6/M6View.tsx` (reset/eliminar), `AuthForm.tsx` (mustChangePassword), `components/ui/Input.tsx`
  (soporte `suffix`).
- **i18n** `messages/{es,en}.json`: +`buylist.{rarityLabel,appliedRuleLabel,ruleFixed,rulePct}`,
  `admin.m2.buylistRules.*`, `admin.m6.{deleted,accountTitle,reset*,tempPassword,copy,copied,delete*}`,
  `auth.{mustChangePassword,mustChangeContinue}`.
- **Tests** (+9): `M2View.test.tsx` (editor rareza: render, fixed→centavos+guardar, fallback, promoción de
  modo), `M6View.test.tsx` (reset una-sola-vez, delete confirm+mode hard, 409 self), `api.test.ts`
  (fixed/pct/fallback), `BuylistView.test.tsx`/`BuylistKycForm.test.tsx` re-shaped, `e2e/buylist.spec.ts`
  actualizado a `appliedRule`.

### Endpoints consumidos
- M2: `GET /admin/pricing/rarities`, `GET/PUT /admin/pricing/buylist-rules` (rama real + mock).
- Buylist: `POST /buylist/quote` (nuevo shape), `POST /buylist/requests` (sin `category`).
- M6: `POST /admin/users/:id/reset-password`, `DELETE /admin/users/:id`.

### Supuestos / solicitudes al arquitecto
1. **`mustChangePassword`** — el contrato lo declara opcional (flag del backend) y no fija una página de
   cambio de contraseña. La UI muestra un **aviso** tras el login y enruta por rol. **Solicitud**: si se
   desea forzar el cambio, definir endpoint/página de cambio de contraseña (`POST /users/me/password`?);
   hoy no existe y no bloquea.
2. **`GET /admin/pricing/rarities`** — se consume `{ fallbackPct, rarities:[{ rarity, cardCount, rule,
   source }] }` tal cual el contrato §M2. El `PUT /buylist-rules` recibe la tabla completa `{ rules,
   fallbackPct }`; el front preserva las reglas explícitas y sólo promueve a explícitas las filas editadas.
3. **`DELETE /admin/users/:id`** — se asume 200 `{ userId, mode }` y `409 CANNOT_DELETE_SELF`; el front
   también deshabilita el botón para la cuenta propia (`useSession`). Sin cuerpo en el request.
4. El editor de rareza **reemplaza** la UI de `rarity-map` (deprecado v1.3.1). Las funciones/fixtures
   `getRarityMap/updateRarityMap/mockRarityMap` quedan como legacy sin uso en UI.

## Fix bug reportado — feedback visible en el sync de catálogo de M2 (2026-08-16)

Bug del humano: en `/admin/m2` (Sección 5, "Sync de catálogo") los botones **Backfill**,
**Import/Re-sincronizar** (por set) y **Sync de todo el catálogo** "no hacían nada" al hacer clic.
Causa raíz: las mutaciones solo tenían `onSuccess` (invalidaban `remote-sets`); **sin manejo de
error ni feedback**. Cuando el backend fallaba (rate limit de pokemontcg.io sin API key, timeout del
sync síncrono, 5xx) el botón salía de `loading` y no aparecía nada → parecía inerte. Solo `frontend/`
(+ esta nota). **No** se tocó el contrato ni el backend; es puro feedback de UI con el patrón de
Banners/`errorCodes` ya usado.

### Qué se hizo (`m2/M2View.tsx`)
- **Helper de error:** se importa `useErrorMessage` de `QueryState` (`getError`) — mapea el `code` del
  `ApiClientError` a copy localizado (`error.<CODE>`, fallback `common.errorGeneric`), mismo patrón que
  el resto de la app.
- **Sync por set (Importar/Re-sincronizar), `catalogSyncMutation`:** antes SIN feedback. Ahora:
  Banner `info` mientras `isPending` (aviso "sincronizando… puede tardar"), Banner `success` con el
  resultado del backend (`syncDone`: "Sync encolado: N set(s) (job …)"), y Banner `danger` (`role=alert`,
  con título + `getError`) al fallar. Esta era la causa principal del "no hace nada".
- **Backfill, `backfillMutation`:** tenía success, **le faltaba el error** → se añadió Banner `danger`
  con `getError`.
- **Sync total, `syncAllMutation`:** mantiene success. El error ahora **distingue**: un **404/405**
  (endpoint aún no existe en backend, contrato v1.3 condicional) conserva el aviso `warning` "no
  disponible"; **cualquier otro error real** (rate limit, timeout, 5xx) muestra Banner `danger` con el
  código/mensaje (antes CUALQUIER fallo se tragaba como "no disponible", ocultando errores reales).
  Helper local `isEndpointMissing()` (status 404/405 del `ApiClientError`).
- **Hint de sincronía:** texto bajo el subtítulo (`catalog.syncHint`) avisando que import/resync/backfill
  corren **síncronos**, pueden tardar y el resultado aparece al terminar.
- **Alineación del resto de mutaciones de M2** (tenían feedback parcial o nulo):
  - **Sync de precios** (`syncMutation`): ya tenía banners; su error genérico (`errorGeneric`) se cambió
    a `getError(error)` para mostrar el código real.
  - **FX** (`fxUpdateMutation`/`fxRefreshMutation`): sin feedback → Banner `success` (`fx.saved`) y
    `danger` (`getError`) por cada uno.
  - **Rareza→categoría** (`rarityMutation`): sin feedback → `success` (`rarityMap.saved`) y `danger`.
  - **Override manual** (`overrideMutation`, en el modal): sin feedback de error → Banner `danger` dentro
    del modal (el éxito cierra el modal, que ya es la señal). El `loading` del botón se mantiene.
- **`remote-sets`** (lista de sets) ya se renderiza dentro de `QueryState` (loading/error + Retry) — se
  verificó; el usuario ve el error de la query y puede reintentar.

### i18n (ES/EN espejado, pasa `i18n-parity`)
- `admin.m2.catalog`: `syncHint`, `syncRunning`, `syncDone`.
- `admin.m2.fx.saved`, `admin.m2.rarityMap.saved`.

### Tests (`m2/M2View.test.tsx`, +5; suite total **98** verde)
Con `vi.spyOn(api, …).mockRejectedValueOnce(new ApiClientError(...))`:
- sync por set → **429 RATE_LIMITED** muestra Banner de error con el copy del contrato + `role=alert`.
- backfill → **500 INTERNAL** muestra Banner de error.
- sync total → **500** muestra Banner `danger` y **no** el aviso "no disponible".
- sync total → **404** conserva el aviso `warning` "no disponible".

Gates (desde `frontend/`): `lint` OK · `typecheck` OK · `test` **98/98** (22 archivos) · `build` OK.

## Auth del back-office + auto-logout por inactividad + redirección por rol (2026-08-16)

Tres cambios de sesión/auth reportados por el humano probando en producción (backend real, mocks off).
Solo `frontend/` (+ esta nota). **No** se tocó el contrato. Gates en verde: `lint` OK, `typecheck` OK,
`test` **94** (22 archivos, +12 nuevos), `build` OK. i18n parity ES/EN intacta.

### 1. El back-office EXIGE sesión (antes: super_admin falso + 401)
- **`AdminShell.tsx`** (grupo `(admin)`) ahora consume `useSession()`. En **modo real** (`!config.useMocks`)
  `requireAuth = true`: mientras `!ready` o `!isAuthenticated` **no** renderiza el back-office — muestra un
  estado de carga (`admin.authLoading`, spinner). Cuando `ready && !isAuthenticated` redirige a
  `/login` con `router.replace({ pathname:'/login', query:{ next: pathname } })` (router de next-intl,
  preserva locale; `next` para volver tras login). En **modo mock/demo** `requireAuth=false`: se deja pasar
  (comportamiento de demostración sin backend).
- **`role.tsx` (`RoleProvider`)** dejó de hardcodear `'super_admin'`. Ahora:
  - Modo real: `role = useSession().user.role` (el backend deriva el rol del JWT y es la autoridad);
    `setRole` es **no-op** y expone `canSwitchRole=false`.
  - Modo mock/demo: sigue el dial local (localStorage `tcg.role`, default `super_admin`) para demostrar el
    enmascarado financiero; `canSwitchRole=true`.
- **`AdminTopbar.tsx`**: el selector "Ver como" (mock role switcher) se renderiza **solo si `canSwitchRole`**
  (modo mock). En modo real muestra el rol autenticado como texto (no editable). El backend sigue siendo la
  autoridad; esto es defensa de UI.

### 2. Auto-logout por 5 min de inactividad (app-wide, todos los roles)
- **`lib/inactivity.tsx` (nuevo)** — `InactivityProvider` montado dentro de `Providers` (raíz), cubre
  storefront + admin. Constante `INACTIVITY_LOGOUT_MS = 5*60*1000`. Solo actúa con sesión activa
  (`useSession().isAuthenticated`). Reinicia el timer con `mousemove/mousedown/keydown/scroll/touchstart`
  (listeners `passive`) y al volver la pestaña visible (`visibilitychange`). Al expirar: `logout()` (de
  `api.ts`, limpia token+user server/local) + `router.replace('/login?reason=inactivity')`. Como `logout()`
  emite el evento de sesión (`tcg.session.changed` + `storage`), **otras pestañas** también quedan
  deslogueadas (sync entre pestañas).
- **`login/page.tsx`** lee `searchParams` (server) y pasa `notice='inactivity'` + `next` a `AuthForm`.
- **`AuthForm.tsx`** muestra `Banner variant="warning"` con `auth.inactivityLogout` cuando
  `notice==='inactivity'` (sin `useSearchParams`, para no forzar Suspense en build).

### 3. Redirección post-login según rol (antes: todos iban a `/`)
- **`AuthForm.tsx`**: tras login/registro exitoso redirige con `destForRole(res.user.role)`:
  `super_admin`/`vault_operator` → **`/admin`**, resto → **`/`**. Si hay `?next` **interno** (empieza con
  `/`) se honra por encima del rol (evita open redirect validando el prefijo).
- **`GoogleSignInButton.tsx`**: `onSuccess` ahora recibe el `role` (`onSuccess(res.user.role)`); `AuthForm`
  lo enruta igual. Registro enruta por rol (normalmente `customer` → `/`).

### Archivos tocados
- `src/components/layout/AdminShell.tsx` (gate de sesión + loading), `src/components/layout/AdminTopbar.tsx`
  (switcher solo en mock), `src/lib/role.tsx` (rol desde sesión / dial en mock + `canSwitchRole`),
  `src/lib/inactivity.tsx` (nuevo), `src/components/Providers.tsx` (monta `InactivityProvider`),
  `src/components/domain/AuthForm.tsx` (redirect por rol + aviso inactividad + `next`),
  `src/components/domain/GoogleSignInButton.tsx` (`onSuccess(role)`),
  `src/app/[locale]/(auth)/login/page.tsx` (searchParams → notice/next),
  `messages/{es,en}.json` (`auth.inactivityLogout`, `admin.authLoading`).
- Tests nuevos: `AdminShell.test.tsx` (sin sesión → loading + `replace` a `/login?next=/admin`; con sesión
  renderiza y el rol viene de la sesión — super_admin/vault_operator; switcher off en real),
  `lib/inactivity.test.tsx` (fake timers: dispara `logout`+redirect tras el umbral; la actividad reinicia el
  timer; sin sesión nunca dispara), `AuthForm.test.tsx` ampliado (redirect super_admin/operator→`/admin`,
  customer→`/`, `next` interno gana; aviso de inactividad).

### Solicitudes al arquitecto
- Ninguna. El rol de sesión ya viene en `AuthResponse.user.role` y `GET /users/me`; `POST /auth/logout` ya
  existe (§1). El gate y el timer son puramente de cliente (defensa de UI); el backend sigue siendo la
  autoridad de autorización (rechaza 401 sin sesión).

## Fix bloqueante techlead — sincronización del form de KYC en M6 (2026-08-16)

Rechazo de techlead: el subformulario de KYC de la ficha 360° (`M6View.tsx`) no sincronizaba su
estado con el usuario cargado. `kycStatus` se inicializaba en `'none'` y nunca se sincronizaba al
llegar `detail.data`; `capRequest`/`capMonth` (`useState('')`) no se reiniciaban al cambiar de
usuario. Como la mutación `updateUserKyc` **siempre** envía `kycStatus`, abrir un usuario `verified`
para ajustar un tope y guardar degradaba silenciosamente el KYC a `'none'` (corrupción de datos que
gobierna topes/INE de dinero saliente); además un borrador tecleado para el usuario A sobrevivía al
abrir el usuario B.

**Fix (patrón "cae al servidor mientras no esté dirty", como M10):**
- Se reemplazaron los tres `useState` sueltos por un único **borrador** `kycDraft` que guarda solo
  las keys que el admin tocó explícitamente.
- Valores efectivos computados: `kycStatus = kycDraft.kycStatus ?? currentKyc?.kycStatus ?? 'none'`
  (cae al valor del servidor); `capRequest`/`capMonth` caen a `''` (vacío = no enviar, se mantiene
  el placeholder con el valor del servidor). Así "Guardar KYC" **nunca** envía un `kycStatus`
  distinto al cargado salvo que el admin lo cambie a propósito.
- `useEffect(() => setKycDraft({}), [selectedId])`: el borrador **no cruza** entre usuarios; se
  reinicia al cambiar de usuario seleccionado. `d`/`currentKyc` se derivan justo tras el query de
  detalle (se eliminó la computación duplicada de más abajo que llevaba el comentario "Sincroniza…"
  que no sincronizaba).
- Los shapes de la ficha 360° (`clabeMasked`/`rfcMasked`/`capPerRequestCents`) se dejaron intactos
  (correctos según contrato; backend se alinea en paralelo).

**Tests añadidos** (`M6View.test.tsx`): (1) al cambiar de usuario seleccionado el form refleja los
valores del nuevo usuario y no arrastra el borrador del anterior (Ana `verified` → Bruno `none`,
tope tecleado se limpia); (2) guardar tras ajustar solo un tope envía `kycStatus:'verified'` (el del
servidor), nunca `'none'` — se verifica el payload de `updateUserKyc` con `vi.spyOn`.

Gates en verde: lint, typecheck, test (82/82), build. Archivos: `frontend/.../m6/M6View.tsx`,
`frontend/.../m6/M6View.test.tsx`.

## Back-office M7/M9 + Cotizador Opción 1 (2026-08-16) — consumo de módulos ya-existentes + buscador real

Se reemplazaron los `ModuleTodo` de **M7 (Finanzas)** y **M9 (Reportes)** por vistas reales que consumen
endpoints **ya implementados** en backend (CONTRATO v1.3 §M7/§M9: "ya existen; falta consumo de frontend"), y
se reescribió el **cotizador de buylist** para buscar sobre TODO el catálogo (Opción 1, contrato §6 v1.3) en
vez de usar `mockCards` (esa era la causa de "no sale nada al cotizar" contra el backend real). Solo `frontend/`
(+ esta nota). **No** se tocó el contrato. Mismo patrón que M2/M6/M10 (TanStack Query + `QueryState`,
`SuperAdminOnly` para la guarda de rol, `StatCard`/`DataTable`/`Banner`/`Input`/`Button`). Gates en verde:
`lint` OK, `typecheck` OK, `test` **80** (20 archivos, +11 nuevos, i18n-parity verde), `build` OK
(m7/m9 prerenderizados es/en).

### Archivos creados/tocados
- **Tipos** `src/types/contract.ts`: +`PnlDTO`, `InventoryValueDTO`, `CustodyValueDTO`, `IvaByOrderEntryDTO` +
  `IvaReportDTO` (M7); `LaunchGoalsDTO` + `LaunchMetricsDTO` (M9).
- **API** `src/lib/api.ts`: +`getPnl`, `getInventoryValue`, `getCustodyValue`, `getIvaReport`,
  `exportFinanceCsv` (M7), `getLaunchMetrics` (M9), `listBuylistSets` + `searchBuylistCards` (cotizador). Cada
  una con rama real (`apiRequest`) y rama mock. `exportFinanceCsv` hace `fetch` con Bearer y lee **texto**
  (no JSON, por eso no usa `apiRequest`); comparte el `exportCsv` de M7/M9 vía `source: 'finance' | 'reports'`.
- **Util** `src/lib/download.ts` (nuevo): `downloadTextFile(filename, text, mime)` — materializa el CSV como
  descarga en el navegador (aislado para poder mockearlo en tests sin tocar el DOM).
- **Fixtures** `src/lib/mock/fixtures.ts`: +`mockPnl` (con la fórmula coherente), `mockInventoryValue`,
  `mockCustodyValue`, `mockIvaReport`, `mockLaunchMetrics` (con `goals` fijadas de ejemplo), `mockCsv(report)`.
- **M7** (`/admin/m7`, super_admin): `m7/M7View.tsx` + `m7/page.tsx` (envuelto en `SuperAdminOnly`) +
  `m7/M7View.test.tsx`. Selector de rango de fechas (aplica a P&L e IVA), **tarjeta de P&L con el desglose de la
  fórmula** (ingresos + envío − COGS − comisiones Stripe = ganancia, ganancia en verde/rojo según signo), valor
  de inventario (a referencia + a costo + pendientes), valor en custodia, IVA acumulado + desglose por orden
  (`DataTable`), y **botones de export CSV** (pnl/iva/inventory).
- **M9** (`/admin/m9`, super_admin): `m9/M9View.tsx` + `m9/page.tsx` + `m9/M9View.test.tsx`. Selector de rango,
  **métricas de lanzamiento** (users/salesSettled/buylistPaid/withdrawalsNoDispute como `StatCard`) con progreso
  vs metas N/X/Y/Z (si `goals` es null muestra solo conteos + banner), y export CSV.
- **Cotizador** `(storefront)/buylist/BuylistView.tsx`: eliminado el `import { mockCards }`; ahora **filtra por
  set** (`listBuylistSets`) y **busca por texto** (`searchBuylistCards` sobre TODA la tabla `Card`, no solo
  bóveda) → lista de resultados seleccionables (`role="listbox"/"option"`) → al elegir carta se cotiza con el
  `getBuylistQuote({ cardId })` existente. Botón "Cotizar" deshabilitado hasta elegir carta. En modo mock cae a
  `fx.mockCards` (fixtures); en real usa los endpoints nuevos. Nuevo test `BuylistView.test.tsx` (4 casos) y
  `e2e/buylist.spec.ts` actualizado al nuevo flujo (buscar → elegir → cotizar).

### Endpoints consumidos
- M7: `GET /admin/finance/pnl?from=&to=`, `GET /admin/finance/inventory-value`,
  `GET /admin/finance/custody-value`, `GET /admin/finance/iva?from=&to=`,
  `GET /admin/finance/export.csv?report=&from=&to=`.
- M9: `GET /admin/reports/launch-metrics?from=&to=`, `GET /admin/reports/export.csv?report=&from=&to=`.
- Cotizador: `GET /buylist/sets`, `GET /buylist/cards?setId=&q=&page=` (+ el ya existente `POST /buylist/quote`).

### Supuestos sobre el contrato (para el arquitecto)
1. **`GET /admin/finance/iva` › `byOrder`** — el contrato lo describe como `byOrder: [...]` sin fijar campos.
   Asumí `IvaByOrderEntryDTO = { orderId, ivaCents, settledAt? }`. **Solicitud**: confirmar/ajustar el shape.
2. **`GET /admin/reports/launch-metrics` › `goals`** — el contrato dice `goals: { N, X, Y, Z }` con "`goals` en
   `null` hasta que el humano fije las metas". Se tipó `goals: LaunchGoalsDTO | null` (goals completo nulo O
   cada valor nulo, ambos soportados en UI). Confirmar cuál es la forma real.
3. **`export.csv` (M7/M9)** — se asume auth por Bearer y respuesta **`text/csv`** descargable; el front hace
   `fetch` directo (no `apiRequest`, que espera JSON) y descarga el blob. `report` default `pnl`. Confirmar el
   `Content-Type` y si requiere algún header extra.
4. **`GET /buylist/cards`** — se reutiliza `CardDTO` y `Paginated` tal cual el contrato (`{ data, page,
   pageSize, total }`, sin `sellable`/precio). El filtro `rarity` está cableado en `searchBuylistCards` pero la
   UI del cotizador hoy solo expone set + texto (rareza es opcional en el contrato); ampliable sin cambio de API.

Con **mocks** (`NEXT_PUBLIC_USE_MOCKS != false`) todo corre contra fixtures que respetan estos shapes; con
`useMocks=false` se ejecutan las ramas `apiRequest`/`fetch` contra el backend real.

## Back-office M2 / M6 / M10 (2026-08-16) — consumo de UI de módulos ya-existentes en backend

Se reemplazaron los `ModuleTodo` de **M2 (Catálogo y precios)**, **M6 (Usuarios/KYC)** y **M10 (Config y
bitácora)** por vistas reales que consumen los endpoints **ya implementados** en backend (ARCHITECTURE/
CONTRACT v1.3: M2/M6/M10 "ya existen; falta consumo de frontend"). Solo `frontend/` (+ esta nota). **No** se
tocó el contrato. Se siguió el patrón de M1/M3/M4/M5/M8 (TanStack Query + `QueryState` loading/error, mismos
componentes UI, `StatusBadge`/`Badge`, `DataTable`, `Modal`, `Banner`). Gates en verde: `lint` OK, `typecheck`
OK, `test` **71** (17 archivos, +11 nuevos, i18n-parity verde), `build` OK (m2/m6/m10 prerenderizados).

### Archivos por módulo
- **Comunes**: `src/types/contract.ts` (+DTOs: `FxDTO`, `PendingPriceEntryDTO`, `RarityMapEntryDTO`,
  `RemoteSetDTO`, `PriceHistoryEntryDTO`, `PricingSyncResponse`, `CatalogSync*Response`, `AdminUserSummaryDTO`,
  `AdminUserDetailDTO`, `AdminKycProfileDTO`, `AdminBillingProfileDTO`, `SettingsDTO`, `AuditLogDTO`,
  `FxSource`). `src/lib/api.ts` (+funciones de los 3 módulos, cada una con rama real `apiRequest` y rama mock).
  `src/lib/mock/fixtures.ts` (+fixtures marcados MOCK). `src/components/domain/SuperAdminOnly.tsx` (nuevo:
  guarda de UI para M2/M6/M10; el backend ya rechaza por rol, esto es defensa de navegación directa por URL con
  el patrón `useRole`). `messages/{es,en}.json` (+claves `admin.m2/m6/m10.*` y `admin.superAdminGate*`).
- **M2** (`/admin/m2`): `m2/M2View.tsx` + `m2/page.tsx` (envuelto en `SuperAdminOnly`) + `m2/M2View.test.tsx`.
  Secciones: (1) **sync de precios de bóveda** (`POST /admin/pricing/sync`), (2) **cola de precio pendiente**
  (`GET /admin/pricing/pending`) con **override manual** en modal (`POST /admin/pricing/override`),
  (3) **FX** (`GET/PUT /admin/fx` + `POST /admin/fx/refresh`) con display de tasa/colchón/fuente/vigencia y
  edición de override + refresh Banxico, (4) **rareza→categoría** editable (`GET/PUT /admin/pricing/rarity-map`),
  (5) **sync de catálogo** (`GET /admin/catalog/remote-sets` con imported/cardCount, `POST /admin/catalog/sync`
  por set, `POST /admin/catalog/backfill`, y `POST /admin/catalog/sync-all` **condicional**: su fallo muestra
  aviso "no disponible" sin romper — cumple la nota del contrato v1.3). `GET /admin/pricing/card/:id`
  (historial) queda cableado en `api.ts` (`getPriceHistory`) pero **aún no montado** en UI (deuda menor).
- **M6** (`/admin/m6`, super_admin): `m6/M6View.tsx` + `m6/page.tsx` + `m6/M6View.test.tsx`. Tabla de usuarios
  con **búsqueda `q` + filtro `status` + paginación** (`GET /admin/users`) y **ficha 360°** en modal
  (`GET /admin/users/:id`): identidad, KYC con **CLABE/RFC enmascarados** (nunca en claro), conteos 360°
  (órdenes/buylist/disputas/bóveda), direcciones, **editar KYC** (`PATCH /admin/users/:id/kyc`) y
  **bloquear/reactivar** con confirmación (`PATCH /admin/users/:id/status`).
- **M10** (`/admin/m10`, super_admin): `m10/M10View.tsx` + `m10/page.tsx` + `m10/M10View.test.tsx`. **Editor de
  diales** (`GET /admin/settings`) que guarda **body PARCIAL** con solo las keys tocadas
  (`PUT /admin/settings`, NO per-key) — dials money en pesos↔centavos; y **bitácora** paginada con filtro por
  acción (`GET /admin/audit-log`).

### Endpoints consumidos
- M2: `POST /admin/pricing/sync`, `GET /admin/pricing/pending`, `POST /admin/pricing/override`,
  `GET /admin/pricing/card/:id` (cableado, sin UI aún), `GET/PUT /admin/fx`, `POST /admin/fx/refresh`,
  `GET/PUT /admin/pricing/rarity-map`, `GET /admin/catalog/remote-sets`, `POST /admin/catalog/sync`,
  `POST /admin/catalog/backfill`, `POST /admin/catalog/sync-all` (condicional).
- M6: `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/kyc`, `PATCH /admin/users/:id/status`.
- M10: `GET/PUT /admin/settings`, `GET /admin/audit-log`.

### Supuestos sobre el contrato (para el arquitecto)
1. **`GET /admin/pricing/card/:id`** — el contrato dice "historial de precios por fecha/fuente" sin fijar el
   shape. Asumí `PriceHistoryEntryDTO` = `{ capturedDate, source, gradeKey, productType, priceMxnCents,
   isManualOverride }`. **Solicitud**: confirmar/ajustar el shape del historial. Aún no se monta en UI.
2. **`GET /admin/pricing/rarity-map`** — asumí respuesta `{ entries: [{ rarity, category }] }` (espejo del PUT).
   Confirmar el envelope exacto (`entries` vs `data`).
3. **`GET /admin/audit-log`** — el contrato muestra respuesta `{ data: AuditLogDTO[] }`; se normaliza a
   `Paginated` en el front (page/pageSize/total con fallback). Si el backend ya devuelve `total`, se usa; si no,
   la paginación del front se apoya solo en `data.length`. **Solicitud**: confirmar si expone `total` para
   paginación fiel.
4. **`GET /admin/users/:id`** — la ficha 360° (kycProfile/billingProfile/addresses/orders/sellRequests/disputes/
   ownedItems) se tipó según la nota del contrato §M6; nombres de sub-campos asumidos (p.ej. `clabeMasked`,
   `rfcMasked`, `ineOnFile`). Ajustar si difieren.
5. **`POST /admin/catalog/sync-all`** — usado condicionalmente; si el backend responde 404/405 el error se
   muestra como "no disponible" y el operador usa sync por set / backfill (sin romper).

Con **mocks** (`NEXT_PUBLIC_USE_MOCKS != false`) todo funciona contra fixtures que respetan estos shapes; al
apuntar al backend real (`useMocks=false`) se ejecutan las ramas `apiRequest`.

---

## Fixes UI/sesión en vivo (2026-08-16) — header de sesión, nav "Sell" y banner de login

Tres arreglos reportados por el humano probando la app en producción (backend real, mocks off). Solo
`frontend/` (+ esta nota). **No** se tocó el contrato. Gates en verde: `lint` OK, `typecheck` OK,
`test` **60** (14 archivos, +6 nuevos), `build` OK.

### 1. Estado de sesión de cliente + header reactivo
- **`src/lib/session.ts` (nuevo)**: hook `useSession()` + helpers `getStoredUser`/`setStoredUser`.
  Mismo idiom que `useCart` (localStorage `tcg.user` + evento `tcg.session.changed` + `storage` para
  sincronía entre pestañas). Expone `{ user, isAuthenticated, ready }`. `ready` es `false` en SSR y en
  el primer render de cliente (patrón "mounted") para **evitar mismatch de hidratación** de Next: el
  header pinta el estado deslogueado hasta que el efecto de montaje lee localStorage.
- **`src/lib/api.ts`**: `persistSession` ahora persiste **también el `user`** de `AuthResponse`
  (`setStoredUser`) además del token — aplica a `login`, `register` y `loginWithGoogle`. Se añadió
  **`logout()`** (contrato `POST /auth/logout` → 204): invalida server-side y limpia token+user; en
  modo mock solo limpia local; aunque el backend falle, el cliente queda deslogueado (`finally`).
- **`src/components/layout/StorefrontHeader.tsx`**: si hay sesión muestra **perfil** (nombre, o email
  como fallback) + botón **"Cerrar sesión"**; si no, el enlace **"Iniciar sesión"** como antes. Se
  actualiza **reactivamente** vía `useSession` (login/logout sin recargar). Implementado en barra
  desktop y menú móvil. El logout llama `logout()` y hace `router.push('/')`.

### 2. Nav "Buylist" → "Sell/Vender" (solo etiqueta; ruta `/buylist` intacta)
- `messages/en.json` `nav.buylist` = **"Sell"**; `messages/es.json` = **"Vender"**.
- Alineado el título cara al cliente `buylist.title`: "Sell your cards" / "Vende tus cartas" (se quitó
  el paréntesis "(Buylist)"). "Buylist" queda solo como término interno/back-office (`admin.modules.m5`
  se mantiene "M5 · Buylist"). Parity ES/EN intacta (test `i18n-parity` verde).

### 3. Banner engañoso de login solo en modo mock
- `src/components/domain/AuthForm.tsx`: el `<Banner variant="info">{t('mockNotice')}</Banner>` ahora se
  condiciona a **`config.useMocks`** — en producción (backend real) no aparece.

### Tests añadidos
- `src/components/layout/StorefrontHeader.test.tsx`: header muestra perfil+logout con sesión y
  "Iniciar sesión" sin ella; fallback a email; logout reactivo (vuelve a deslogueado + `router.push`);
  label del nav = "Sell"/"Vender" apuntando a `/buylist`. Se mockea `@/i18n/navigation`.
- `src/components/domain/AuthForm.test.tsx`: banner visible con `useMocks=true` y ausente con `false`.
- `vitest.setup.ts`: polyfill de `window.matchMedia` (lo usa `ThemeToggle` dentro del header).

---

## Cierre residuo endurecimiento S-B3 (2026-08-15) — `contentLength` en presign + `maxBytes` del presign

Cierre del residuo señalado por qa/techlead/seguridad en el endurecimiento de `kyc_ine`. Solo `frontend/`
(+ esta nota). **No** se tocó el contrato (`contentLength` y `maxBytes` ya son opcionales/aditivos en §8).
Gates en verde: `lint` OK, `typecheck` OK, `test` **52** (12 archivos), `build` OK.

### Qué se hizo
- **`presignUpload` (`src/lib/api.ts`)** ahora acepta y envía **`contentLength`** en el body del presign
  (`{ purpose, contentType, contentLength }`). El backend, cuando llega, lo fija en la firma (`ContentLength`)
  para que R2/S3 **rechace cuerpos de otro tamaño** end-to-end (cierra S-B3). La rama mock devuelve además
  **`maxBytes`** (≈10 MB) para reflejar el tope del presign.
- **`UploadPresignResponse` (`src/types/contract.ts`)** declara **`maxBytes?: number`** (tope de tamaño que
  admite la firma). Es opcional por compat.
- **`PhotoUploader` (`src/components/ui/PhotoUploader.tsx`)**:
  - Pasa **`contentLength: file.size`** al presign.
  - Valida tamaño en cliente contra **`presign.maxBytes` como fuente única de verdad**; `DEFAULT_MAX_UPLOAD_BYTES`
    (constante local) queda **solo como fallback** si el presign no trae `maxBytes`. La validación de tamaño se
    hace **tras** el presign (ya conocemos el tope real); la de **tipo** (`image/*`) sigue antes de pedir presign.
  - **Nit de memoria:** el object URL del preview se **revoca** (`URL.revokeObjectURL`) al re-seleccionar y al
    desmontar (ref `previewUrlRef` + cleanup en `useEffect`).
- **Tests**: `PhotoUploader.test.tsx` cubre que **`contentLength=file.size`** viaja en el presign y que el
  rechazo por tamaño usa **`presign.maxBytes`** (spy con `maxBytes` chico → no sube ni expone `uploadKey`).
  `api.test.ts` fija que el presign mock devuelve `maxBytes`.

## Cableado del INE en buylist/KYC (2026-08-15) — presign `kyc_ine` + creación de solicitud

Se integró el uploader del INE (antes **huérfano**) en el flujo real de buylist/KYC. Solo `frontend/`
(+ esta nota). **No** se tocó el contrato. Gates en verde: `lint` OK, `typecheck` OK, `test` **50** (12
archivos), `build` OK. E2E (Playwright) de buylist ampliado (lo ejecuta QA).

> Nota de entorno: `node_modules` estaba incompleto (faltaba `recharts`); se corrió `npm install` para dejar
> los gates ejecutables. No se cambiaron versiones de `package.json`.

### Qué se hizo
- **`PhotoUploader` (`src/components/ui/PhotoUploader.tsx`)** dejó de ser un mock con `setTimeout`: ahora hace
  el flujo real **presign → PUT al storage → `uploadKey`**:
  1. **Validación de TIPO en cliente**: solo imágenes. El `<input>` es `accept="image/*"` y además se valida
     `file.type.startsWith('image/')` (rechaza p. ej. PDF con error claro, sin subir).
  2. **Validación de TAMAÑO en cliente**: `maxBytes` (default **10 MB**, `DEFAULT_MAX_UPLOAD_BYTES`); si excede,
     error `ine.errTooLarge` con el límite. Además mapea **413** del storage a ese mismo error (rechazo del
     backend por límite) y `VALIDATION_ERROR` a "no es imagen".
  3. **presign** `POST /uploads/presign` con `{ purpose: "kyc_ine", contentType: file.type }` →
     **PUT directo** a `uploadUrl` enviando el `Content-Type` de imagen y `headers` del presign (sin token de
     sesión; URL firmada). Al terminar expone `onUploaded(uploadKey)`.
  - Estados: vacío / subiendo (`aria-busy`, spinner + `sr-only`) / éxito (`Subida ✓`) / error (`role="alert"`,
    borde `danger`, `aria-describedby`). Botón "Retomar" tras éxito; permite re-seleccionar el mismo archivo.
    i18n vía namespace **`ine`** (labels, estados, errores). Objetivo táctil 48px.
- **`BuylistKycForm` (`src/components/domain/BuylistKycForm.tsx`)** — nuevo paso de pago/KYC del buylist:
  - **CLABE** (`Input`, `inputMode=numeric`, máx 18, filtra no-dígitos) con validación cliente `^\d{18}$`.
  - **Dos slots de INE** (anverso/reverso) con `PhotoUploader purpose="kyc_ine"` + **aviso de privacidad**
    obligatorio (`ine.privacy`, DESIGN §7.10).
  - Envía `POST /buylist/requests` (`createSellRequest`) con `{ items:[{cardId, productType, rawCondition:'NM'
    si raw, category}], clabe, ineUploadKeys? }` — las `ineUploadKeys` solo se adjuntan si **ambas** imágenes
    subieron. Mapea errores de negocio del contrato: **`INE_REQUIRED`** (revela/pide el INE), **`CLABE_NOT_OWN_NAME`**,
    **`CLABE_INVALID`**, **`BUYLIST_LIMIT_EXCEEDED`**, y genérico. loading/error/éxito manejados.
- **`BuylistView`**: el botón "Crear solicitud" (antes inerte) abre un **`Modal`** con `BuylistKycForm`; al crear
  se cierra, se invalida `['sell-requests']` (React Query) y se muestra banner de éxito (`buylist.created`).
- **`api.ts`**: nuevas funciones con rama real + rama mock — `presignUpload`, `uploadToPresignedUrl`
  (raw `fetch` con `Content-Type` imagen; 413→`FILE_TOO_LARGE`), `createSellRequest`, `getKyc`, `updateKyc`.
- **Tipos** (`contract.ts`): `UploadPurpose`, `UploadPresignResponse` (`uploadKey/uploadUrl/method/headers/expiresAt`),
  `IneUploadKeys`. `KycInfoDTO.clabe` → **`clabeMasked`** (alineado al contrato: la CLABE se devuelve enmascarada).
- **Fixtures**: `mockKyc` (`KycInfoDTO`); presign mock devuelve `uploadUrl` `mock://…` para cortar red en tests/dev.

### Consumo del presign (según contrato §8) — resumen
`POST /uploads/presign {purpose:"kyc_ine", contentType, contentLength} → {uploadKey, uploadUrl, method:"PUT", headers, expiresAt, maxBytes}`;
el cliente hace `PUT uploadUrl` con `Content-Type` de imagen y los `headers`; luego la `uploadKey` viaja como
`ineUploadKeys.front/back` en `POST /buylist/requests` (o como `ineFrontUploadKey/ineBackUploadKey` en
`PUT /users/me/kyc` vía `updateKyc`, disponible para el flujo de KYC de perfil).

### Coordinación con backend (endurecimiento de `kyc_ine`)
El uploader ya cumple lo pactado: **solo `image/*`** (accept + validación de `file.type`), envía el
**`Content-Type` de imagen** y **`contentLength`** en el presign, valida **tamaño contra `presign.maxBytes`**
(fuente única de verdad; fallback local ~10 MB) y además maneja el **rechazo del backend** (413 y
`VALIDATION_ERROR`) con mensajes claros. Si el backend fija un límite distinto, lo devuelve en `presign.maxBytes`
y el cliente lo respeta sin cambios (ver sección "Cierre residuo endurecimiento S-B3" arriba); no cambia el contrato.

### Tests
- **`PhotoUploader.test.tsx`** (nuevo): render + `accept="image/*"`; rechazo de **no-imagen** (PDF) sin subir;
  rechazo por **tamaño** (con `maxBytes` chico); imagen válida → presign + `onUploaded(kyc_ine/…)` + estado éxito.
- **`BuylistKycForm.test.tsx`** (nuevo): render de CLABE + dos INE + privacidad; validación CLABE 18 dígitos (no
  llama al backend); creación OK (item raw con `rawCondition:'NM'` y categoría); mapeo de `422 INE_REQUIRED`.
- **`e2e/buylist.spec.ts`**: dos casos nuevos — el paso de solicitud pide CLABE + INE (anverso/reverso, `accept=image/*`)
  con aviso de privacidad; creación con CLABE válida muestra la confirmación.

### Nuevas claves i18n (ES/EN espejadas; pasa `i18n-parity`)
- Namespace **`ine`**: `front/back/takePhoto/retake/uploading/uploaded/privacy/errNotImage/errTooLarge/errUpload`.
- **`buylist`**: `requestTitle, clabeLabel, clabeHint, clabeInvalid, clabeNotOwnName, ineSectionTitle,
  ineSectionNote, ineRequiredError, limitExceeded, submit, submitting, requestError, created`.

### Suposiciones sobre el contrato (a confirmar por el arquitecto)
- **Determinación de "INE requerido"**: el front NO conoce el umbral (dial `ineThresholdCents`), así que ofrece
  el INE como **opcional** y se apoya en el `422 INE_REQUIRED` del backend para exigirlo. Si el arquitecto
  prefiere señalizarlo proactivamente, convendría exponer el umbral (p. ej. en `POST /buylist/quote` o en
  `GET /users/me/kyc`, que ya trae `capPerRequestCents/capPerMonthCents/monthUsedCents`). No bloquea; no cambia
  el contrato hoy.
- **`Content-Type` del PUT**: se envía el MIME real de la imagen (`file.type`). Se asume que el presign del
  backend firma para ese `Content-Type` (el request de presign ya envía `contentType`). Confirmar que el storage
  no exige un header adicional fijo (los `headers` del presign se reenvían tal cual).
- **Códigos de error del presign/PUT**: se asume `413` (tamaño) del storage y `422 VALIDATION_ERROR` (tipo) del
  presign, además de los de negocio de `POST /buylist/requests` (`INE_REQUIRED`, `CLABE_NOT_OWN_NAME`,
  `CLABE_INVALID`, `BUYLIST_LIMIT_EXCEEDED`) — todos ya contemplados en el contrato §6/§8.

## Alcance v1.2.1 (2026-08-14) — sin fotos de producto / fix badge / gradeada por cert / disputa por correo

Simplificación aprobada (PROJECT/CONTRATO/ARCH/DESIGN v1.2.1). Solo `frontend/` (+ esta nota). No se tocó
el contrato. Todo mantiene el **toggle de mocks** (rama real `apiRequest` + rama mock en fixtures) e i18n
ES/EN espejado. `lint`/`typecheck`/`test` (42) y Playwright (36) en verde; `build` OK.

### 1. Sin fotos de producto — imagen de catálogo remota
- **Tipos** (`src/types/contract.ts`): eliminados `frontPhotoUrl`/`backPhotoUrl` de `ListingDTO`,
  `HoldingDTO` e `InventoryItemDTO`. La imagen mostrada es **siempre** `card.imageSmallUrl`/`imageLargeUrl`
  (pokemontcg.io).
- **UI**: `ListingCard`, `CardDetailView`, `VaultView`, M1 y M8 usan la imagen de catálogo remota. Se
  **eliminó la pestaña "Fotos"** de la ficha (tabs = Descripción/Condición) y toda la UI de subida/visualización
  de foto de producto en M1 (alta **sin cámara**; banner `admin.m1.noPhotoNotice`).
- **Fixtures**: `mockListings`/`mockHoldings`/`mockInventory` sin URLs de foto propia.
- Claves i18n retiradas (ambos locales): `card.tabPhotos`, `card.frontPhoto`, `card.backPhoto`,
  `admin.m1.photosFront`, `admin.m1.photosBack`.

### 2. Fix del empalme del badge (DESIGN_SYSTEM §7.2b) — regla exacta implementada
- **Ubicación por defecto = FUERA del arte**, en la **fila de info bajo la imagen**. `ListingCard` ya **no**
  monta el `ConditionBadge` con `absolute` sobre la imagen; lo renderiza en una fila propia debajo (raw NM y
  sellado **siempre** ahí).
- **Única excepción sobre el arte** = **chip de grado de gradeada con scrim sólido**: nuevo componente
  `GradedCertChip` variante `scrim` en `top-2 left-2`, fondo `bg-slate-900/90`, texto blanco `text-xs`
  peso 600, `rounded-[6px]` (radius-sm), `px-2 py-0.5`, sombra `shadow-xs`. Nunca se monta raw/sellado sobre
  el arte ni se usan fondos translúcidos. En el card el chip colapsa a `PSA 10` (compact) y el `certNumber`
  completo va en la fila de info + ficha.

### 3. Gradeadas = grado + certificado
- Nuevo **`GradedCertChip`** (`src/components/ui/GradedCertChip.tsx`): formato canónico **`PSA 10 · #12345678`**
  (empresa+grado peso 600, ` · #<certNumber>` `tabular-nums`), `aria-label` con empresa+grado+cert. Variantes
  `soft` (fila de info/ficha) y `scrim` (sobre arte).
- `ConditionBadge` (graded) delega en `GradedCertChip`; nueva prop `certNumber` propagada desde `ListingDTO`/
  `HoldingDTO` en `ListingCard`, `CardDetailView`, `VaultView`.
- **Ficha** (§7.2c): nuevo `CertNumberField` (`src/components/ui/CertNumberField.tsx`) muestra el cert con
  etiqueta "Certificado / Certificate" como **texto copiable + botón "Copiar"** (no se inventa URL de
  verificación de la graduadora; ver solicitud al arquitecto abajo).
- **Admin M1**: alta de gradeada captura **empresa + grado + `certNumber`**; `certNumber` es **requerido para
  publicar** (el botón "Crear item" se deshabilita y el input muestra error si falta). Tipo `ListingDTO.certNumber?`,
  `InventoryItemDTO.certNumber?`, `HoldingDTO.certNumber?`.

### 4. Disputa por correo (reemplaza `PhotoCompare`)
- Nuevo **`DisputeEvidenceContact`** (`src/components/domain/DisputeEvidenceContact.tsx`): muestra el correo
  de soporte desde **`DisputeDTO.evidenceContact`** (de la API; **NO hardcodeado** en la UI) como enlace
  `mailto:` (con asunto citando la referencia) + botón **"Copiar correo"**. Banner `info`.
- **Admin M8** reescrito: **eliminado el comparador de fotos** (`PhotoColumn`/ingreso vs. reclamo). Muestra
  imagen de catálogo del ítem, descripción, `DisputeEvidenceContact` y —para gradeadas— `GradedCertChip` +
  `CertNumberField` como base de resolución. Tipos: `DisputeDTO` sin `ingressPhotoUrls`/`claimPhotoUrls`; con
  `type` (`condition_raw|condition_sealed`), `evidenceContact?` e `item.{productType,gradingCompany,gradeValue,certNumber}`.
- Fixtures `mockDisputes`: 2 disputas (raw + sealed) con `evidenceContact` (placeholder del contrato
  `soporte@tcgvaultmx.com`); graded **no** genera disputa (coherente con `422 NOT_RAW`).
- `legal.disputeBody` (ES/EN) actualizado: la evidencia va **por correo a soporte** (no se sube foto en la app).

### 5. INE conserva su uploader
- `PhotoUploader` (`src/components/ui/PhotoUploader.tsx`) — el **único uploader** del sistema (INE del buylist,
  `purpose="kyc_ine"`) — **no se tocó**. Se retiró su uso en M1 (fotos de producto); queda listo para cablearse
  al flujo de KYC del buylist.

### Tests actualizados
- `ConditionBadge.test.tsx`: caso graded con `certNumber` (`PSA 10 · #cert` + `aria-label`).
- `e2e/admin.spec.ts`: M1 sin uploader (aviso de imagen de catálogo + `certNumber` requerido al elegir graded);
  M8 con panel de evidencia por correo y **sin** comparador de fotos.

### Nuevas claves i18n (ES/EN espejadas)
- `card.certLabel/certCopy/certCopied/gradedCertAria/gradedGuarantee`.
- `admin.m1.noPhotoNotice/certNumberRequired/certNumberError`.
- Namespace `dispute.evidenceTitle/evidenceBody/copyEmail/copied/mailSubject/mailSubjectGeneric`.

### Solicitud al arquitecto/PO (v1.2.1)
- **URL de verificación de la graduadora**: `CertNumberField` deja el `certNumber` como **texto copiable**
  (no enlace) porque no hay URL oficial confirmada. Si el humano confirma el patrón de verificación de PSA/CGC,
  se puede promover a enlace ("Verificar en PSA/CGC", `target=_blank rel=noopener`). No bloquea; no cambia el contrato.
- **`evidenceContact`**: la UI lo consume tal cual del contrato (`POST /disputes`, `GET /admin/disputes/:id`).
  El correo `soporte@tcgvaultmx.com` sigue marcado como *placeholder por confirmar por el humano* en PROJECT/CONTRATO.

## Alcance v1.1 (2026-08-14) — Compra/filtros/NM/sellado/tendencia/Google

Implementación de las 6 superficies nuevas del contrato+diseño v1.1. Solo `frontend/` (+ esta nota).
No se tocó el contrato. Todo con **toggle de mocks** (`config.useMocks`): cada llamada nueva tiene
rama real (`apiRequest`) y rama mock (fixtures) para funcionar en Vercel sin backend. i18n ES/EN espejado.

### Dependencia añadida
- **`recharts` `^2.15`** (`package.json` `dependencies`) para `PortfolioTrendChart`/`PortfolioSparkline`.
  Añadido polyfill de `ResizeObserver` en `vitest.setup.ts` (jsdom no lo trae; lo usa `ResponsiveContainer`).

### Variable de entorno nueva
- **`NEXT_PUBLIC_GOOGLE_CLIENT_ID`** (opcional) — client id de Google Identity Services para el login
  con Google. Leída en `src/lib/config.ts` (`config.googleClientId`). Sin ella (o con mocks activos) el
  botón simula el login. **Solicitud a devops**: añadirla al `.env.example` (comentario "opcional; login Google").

### 1. Rename "Catálogo" → "Compra"
- Rótulos i18n: `nav.shop`/`nav.catalog` = **"Compra"/"Shop"**, `catalog.title` = "Compra"/"Shop",
  `catalog.subtitle`, `card.backToCatalog`, `home.ctaCatalog`, `vault.emptyCta/emptyBody`. El `StorefrontHeader`
  usa `nav.shop`. La **ruta técnica sigue siendo `/catalog`** (y el contrato mantiene `/catalog/cards`);
  se añadió **alias `/compra`** (`(storefront)/compra/page.tsx` → `CatalogView`) para no romper enlaces.
- Semántica v1.1: la vitrina lista **solo inventario publicado con precio** (`getCatalog` mock ya solo
  contiene `sellable && salePriceCents != null`); **Compra nunca muestra "precio pendiente"** (E2E lo asegura).

### 2. Filtros de Compra (`ShopFilters`, §7.16) sobre `GET /catalog/facets`
- `src/components/domain/ShopFilters.tsx`: **rareza** = multi-select buscable/agrupable (taxonomía abierta;
  a la API se manda la rareza CRUDA como CSV). El mapa **rareza→grupo vive en el front**
  (`src/lib/rarity-groups.ts`, grupos standard/ultra/illustration/special, **fallback "other"/"Otras"**).
  **Set con año** ("Nombre (2024)", orden año desc del contrato). **Tipo** (Todo/Raw NM/Graded/Sellado) con
  **sub-filtro de subtipo** de sellado. **Precio** min/max en MX$→centavos. **Orden** (`sort`) sobre el grid.
- `CatalogView` reescrita: panel lateral sticky (lg+) + **bottom sheet** (Modal) en móvil, **chips removibles**
  de filtros activos, sincroniza `getCatalog(filters)`. Nuevos campos en `CatalogFilters`
  (`rarity: string[]`, `sealedSubtype`, `minPriceCents`, `maxPriceCents`, `sort`).

### 3. Condición NM legible (`ConditionBadge`, §7.2b)
- `RawCondition='NM'` (único valor) en `src/types/contract.ts`; **eliminados LP/MP/HP/DMG** de todos los
  selects/tipos (Compra, buylist, admin M1) y fixtures.
- `ConditionBadge` reescrito: raw → **"Casi nueva (NM)" / "Near Mint (NM)"**, tono **success suave**, la
  descripción del estándar en `title` (tooltip) **+ `aria-label`**, badge focuseable (`tabIndex=0`). Claves
  i18n `catalog.condition.nm.{label,desc}`. Prop `compact` colapsa a "NM" conservando el `aria-label` completo.
- **Buylist**: sin selector de condición (NM fijo; se envía `rawCondition='NM'`) + **banner NM-only**
  (`buylist.nmOnlyTitle/Body`). **Admin M1**: raw sin selector (nota NM fija).

### 4. Tarjeta de SELLADO (`ListingCard` variante, §7.1b)
- `ConditionBadge` sellado → badge **"Sellado"** (info + icono `package`) + **subtipo** (`status.sealedSubtype.*`),
  sin condición/rareza. `ListingCard` oculta `#número` para sellado; imagen `object-contain` (ya en `CardImage`).
  `sealedSubtype?` añadido a `ListingDTO/HoldingDTO/SellItemDTO/InventoryItemDTO`.
- **Admin M1** soporta alta de sellado: selector de **subtipo** + **campo de precio (MXN) obligatorio** para publicar.

### 5. Gráfica de tendencia del portafolio (`PortfolioTrendChart`, §7.17)
- `src/components/domain/PortfolioTrendChart.tsx`: **AreaChart** (recharts) estilo acciones, **toggle
  5d/15d/1m/3m/6m/1a/YTD/Máx**, delta con **signo (+/−) + flecha (▲/▼)** además del color (verde↑/rojo↓),
  **costo base** punteado, estados **cargando / vacío ("recopilando datos") / negativo (legítimo) / estimado /
  error**, **resumen textual `aria-live`** (`role="img"` + aria-label) y "Ver como tabla". Colores leídos de los
  tokens CSS (soporta modo oscuro). **`PortfolioSparkline`** opcional en el `StatCard` de valor total en `VaultView`.
- Consume `GET /vault/portfolio/history?range=...`; el mock (`generatePortfolioHistory`) genera una serie
  determinista que termina en el valor actual del portafolio.

### 6. Login con Google (`GoogleSignInButton`, §6.7)
- `src/components/domain/GoogleSignInButton.tsx`: botón neutro `secondary` full-width con logo "G" oficial.
  En modo real (client id + sin mocks) carga **Google Identity Services**, y al recibir el `credential` llama
  `POST /auth/google`; en modo mock simula el canje sin backend. Estados loading ("Conectando…", `aria-busy`)
  y error inline (`error.GOOGLE_TOKEN_INVALID`/`GOOGLE_EMAIL_UNVERIFIED`). Guarda tokens igual que el login normal.
- **D6 (fix v1.1, 2026-08-14):** en modo real, al descartar/omitir el prompt de GIS el `callback` del
  credential nunca corre, así que el botón se quedaba en spinner. Ahora `prompt()` recibe un
  **moment listener**: si `isDismissedMoment()`/`isSkippedMoment()`/`isNotDisplayed()` → `loading=false`.
  Además hay un **timeout de respaldo** (`PROMPT_TIMEOUT_MS`, 60s) que sale del spinner si GIS no notifica
  ni invoca el callback; se limpia en el callback/listener y al desmontar. En modo mock no aplica (login
  simulado). Cubierto en `GoogleSignInButton.test.tsx` (descarte del prompt y `isNotDisplayed`).
- `AuthForm` reescrito: **email/contraseña es la acción primaria** (ahora vía `login()`/`register()` reales con
  rama mock), divisor **"o/or"**, y el botón Google debajo. Login y registro.

### 7. Cliente API (`src/lib/api.ts`)
- Nuevas funciones con rama real+mock: **`getCatalogFacets()`**, **`getPortfolioHistory(range)`**,
  **`loginWithGoogle(idToken)`**, **`login()`/`register()`**. `getCatalog` ajustada a los nuevos campos
  (rareza multi como CSV, precio, sort, sealedSubtype). Buylist mock usa `mockReferenceByCardId`
  (Zapdos sin market price → "precio pendiente" de adquisición; rarezas modernas → `ex_plus` 40%).

### Tests
- **Unit (vitest): 39 verdes** (antes 10). Nuevos: `rarity-groups.test.ts`, `ConditionBadge.test.tsx`
  (NM legible + tooltip/aria-label + sellado), `ShopFilters.test.tsx` (rareza cruda multi, set con año,
  subtipo sellado, precio→centavos), `GoogleSignInButton.test.tsx` (mock deja sesión + onSuccess),
  `PortfolioTrendChart.test.tsx` (vacío, toggle 8 rangos, refetch por rango), `api.test.ts`
  (facets, history, catálogo sin pendientes, buylist ex_plus/pendiente, google). Helper `renderWithProviders`
  (NextIntl + TanStack Query) en `src/test/render.tsx`.
- **E2E (Playwright): 36 verdes** (antes 30). `catalog.spec.ts` reescrita ("Compra", filtro rareza multi-select,
  sellado, NM tooltip, Compra sin "precio pendiente"); nueva `portfolio.spec.ts` (gráfica + toggle de rangos);
  `auth.spec.ts` + login Google (mock). Corridas HOY contra dev server con `NEXT_PUBLIC_USE_MOCKS=true`.
- `lint`/`typecheck`/`build` en verde. `i18n-parity.test.ts` valida la paridad ES↔EN de todas las claves nuevas.

## Rebrand "TCG Vault MX" + política de ventas finales (2026-08-13)

Dos cambios de negocio pedidos por el humano. Solo tocan `frontend/` (+ esta nota). Sin cambios de contrato.

### 1. Rebrand a "TCG Vault MX"

- `common.appName` → **"TCG Vault MX"** en `messages/es.json` (era el placeholder "Bóveda TCG") y
  `messages/en.json` (era "TCG Vault"). Ambos idiomas comparten ahora el mismo nombre de marca.
- El `title`/metadata de `[locale]/layout.tsx` ya se compone con `t('appName')`, así que se
  actualiza solo (verificado en `next build`).
- **`StorefrontHeader.tsx`** tenía el texto **hardcodeado** `"TCG Vault"`; se cambió a
  `t('appName')` (namespace `common`) para que el rebrand sea de una sola fuente.
- Email/dominio placeholder `boveda-tcg.mx` → **`tcgvaultmx.com`**: `checkout.cfdiNotice` ahora usa
  `facturacion@tcgvaultmx.com` (ES y EN). El `tagline` se mantiene sin cambios.
- **Tests E2E de marca:** no existía ningún E2E que asertara el literal "Bóveda TCG" (grep vacío en
  `frontend/e2e/`), por lo que no hubo aserciones de marca que ajustar. El resto del suite no
  hardcodea el nombre de app (usa claves i18n vía `e2e/utils/i18n.ts`).

### 2. Política de reembolsos visible — VENTAS FINALES

Decisión del humano: **todas las ventas son finales, sin reembolso** una vez comprada la carta.
Única excepción: **carta dañada o equivocada** → disputa de condición (7 días, con fotos); si
procede, se compensa y el usuario **conserva la carta** (sin devolución). Todo bilingüe vía
next-intl (nada hardcodeado).

- **Aviso en checkout**: `CheckoutView.tsx` muestra un `Banner variant="warning"` con
  `checkout.finalSaleNotice` ("Todas las ventas son finales. Sin reembolsos salvo carta dañada o
  equivocada.") y una acción/enlace `checkout.viewTerms` → `/terminos`. Colocado junto al banner
  CFDI en el resumen del pago.
- **Página de términos/política** nueva: `src/app/[locale]/(storefront)/terminos/page.tsx`
  (ruta `/es/terminos` y `/en/terminos`, dentro del layout storefront). Server component con
  `generateMetadata` propio. Namespace i18n `legal.*` con: intro, **alcance por tipo de producto**
  (`scopeNote`: aplica a raw, sellado y gradeadas), **reembolsos/ventas finales**
  (`refundTitle`/`refundBody`), **excepción por error de la plataforma**
  (`platformErrorTitle`/`platformErrorBody`: cobro duplicado o compra sin inventario real → siempre
  se reembolsa, sin disputa) y **disputa de condición** (`disputeTitle`/`disputeBody`/
  `disputeWindowNote`/`disputeOutcome`: 7 días naturales **contados desde la entrega** del envío,
  fotos, compensa y conservas la carta). Usa tokens del DESIGN_SYSTEM (Banner warning + cards con
  borde; icono `BadgeCheck` success para el error de plataforma, `ShieldCheck` info para disputa).
  Coherente con el contrato: el reembolso por error de plataforma se materializa vía
  `charge.refunded` (§9) / `POST /admin/orders/:id/refund` (M3, super_admin); la ventana de disputa
  refleja `422 DISPUTE_WINDOW_CLOSED` ("fuera de 7 días desde entrega", §7). Solo texto, sin cambio
  de contrato.
- **Enlaces a términos**: desde el **checkout** (banner) y desde el **footer** del storefront
  (`(storefront)/layout.tsx`, `nav.terms` "Términos y política"/"Terms & policy").
- Claves i18n nuevas (paridad ES↔EN, cubierta por `i18n-parity.test.ts`): `nav.terms`,
  `checkout.finalSaleNotice`, `checkout.viewTerms`, y el namespace `legal.*` completo (incl.
  `scopeNote`, `platformErrorTitle`/`platformErrorBody`, `disputeWindowNote`).

### E2E añadidos/ajustados (en `e2e/checkout.spec.ts`)

- El aviso de ventas finales aparece en **checkout ES** (`finalSaleNotice` + enlace `viewTerms`) y
  en **checkout EN** (`finalSaleNotice`).
- El enlace de términos navega a `/es/terminos` y muestra la política (refund + disputa +
  excepción por error de plataforma + alcance por tipo de producto + ventana desde la entrega).
- La página de términos existe y muestra la política también en **inglés** (`/en/terminos`),
  incluidas las mismas aclaraciones (`platformErrorBody`, `disputeWindowNote`, `scopeNote`).

Suite E2E total: **30/30** en verde (antes 28). Unit **10/10**, `lint`/`typecheck`/`build` en verde.

## Seguridad — SEC-C2: bump de dependencias vulnerables en runtime (2026-08-13)

Remediación del hallazgo **SEC-C2** (`docs/SECURITY_NOTES.md`): dependencias vulnerables en
runtime del frontend. Objetivo: dejar `npm audit --omit=dev` **sin high/critical**.

### Versiones antes → después

| Paquete | Antes | Después | Motivo |
|---|---|---|---|
| `next` | `14.2.15` | `15.5.23` | Crítica/high: cadena de advisories (SSRF middleware/rewrites, cache poisoning, DoS de RSC/Image Optimizer, XSS con CSP nonces). El 14.2.x —incluso el último 14.2.35— NO limpia el audit: varios advisories solo se parchearon en la línea 15.x. `15.5.23` (tag `backport`, el más parcheado de 15) sí lo limpia y **mantiene React 18** (peer `^18.2.0`), evitando migrar a React 19. |
| `next-intl` | `^3.21.1` (v3) | `^4.13.6` (v4) | Prototype pollution (`experimental.messages.precompile` vía claves de catálogo) + open redirect. Corregidos en v4. |
| `postcss` (dev + empaquetado por next) | `8.4.x` / `8.4.31` | `8.5.26` | High: XSS `</style>`, path traversal/lectura arbitraria de `.map` vía `sourceMappingURL`. Se subió el dev-dep **y** se forzó vía `overrides` para deduplicar todas las copias (incluida la que next empaqueta). |
| `sharp` (dep de optimización de imágenes de next) | `0.34.5` | `0.35.3` (via `overrides`) | High: CVEs heredados de libvips (CVE-2026-33327/33328/35590/35591). next declara `^0.34.3`; el `override` lo fuerza a la línea parcheada `>=0.35.0`. |
| `eslint-config-next` | `14.2.15` | `15.5.23` (dev) | Alinear el config de lint con la major de next. |

`overrides` añadidos en `package.json`: `postcss ^8.5.26`, `sharp ^0.35.3`.

### Breaking changes resueltos

- **Next 15 — `params`/`searchParams` async:** el App Router ahora entrega `params` como
  `Promise`. Migrados a `async` + `await params`:
  - `src/app/[locale]/layout.tsx` (layout **y** `generateMetadata`).
  - `src/app/[locale]/(storefront)/catalog/[cardId]/page.tsx`.
  - `src/app/[locale]/(storefront)/orders/[orderId]/page.tsx`.
  (`npm run typecheck` no lo detecta porque las páginas auto-tipan sus props; **`next build`**
  sí aplica el constraint `PageProps` con `params: Promise<…>`, que es donde saltó.)
- **next-intl v3 → v4:** el código de i18n ya usaba la API moderna compatible con v4
  (`defineRouting`, `createNavigation`, `getRequestConfig({ requestLocale })`,
  `createMiddleware(routing)`, `NextIntlClientProvider` sin prop `locale` en el layout),
  así que **no requirió cambios de i18n**. Verificado que sigue funcionando: rutas `/es|/en`,
  catálogos de mensajes, y el `LocaleToggle` (E2E `i18n-locale.spec.ts` + `auth.spec.ts` en verde).

### Estado del audit tras el bump

- **`npm audit --omit=dev` (runtime): `found 0 vulnerabilities`.** SEC-C2 (parte frontend) cerrado.
- **`npm audit` (incluye dev): 5 restantes (1 critical, 1 high, 3 moderate) — TODAS dev-only y
  no explotables en producción.** Son la cadena del **test runner**:
  `vitest → @vitest/mocker/vite-node → vite → esbuild` (advisory `GHSA-67mh-4wv8-2f99`: el
  dev-server de esbuild acepta requests de cualquier web). **No se empaqueta en el bundle de
  producción** (`output: standalone` no incluye devDependencies) y solo aplica al servidor de
  desarrollo local. Subir a `vitest@4` es un major con cambios de config; se deja como deuda
  menor de tooling. El propio `SECURITY_NOTES.md §0` ya clasificó los críticos de `vitest` como
  dev-only. El gate `security-sast.yml` corre `npm audit` con `--omit=dev` (runtime), por lo que
  estos dev-only no lo bloquean.

### Advertencia benigna en build

`next build` emite un warning de webpack cache sobre `next-intl/dist/esm/production/extractor/
format/index.js` (`import(t)` dinámico del extractor de mensajes de v4). Es informativo (cache
de build), no error; la compilación termina en `✓ Compiled successfully`.

### Verde confirmado (post-bump)

`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` (10/10 unit) ✓ ·
`npm run build` ✓ (SSG) · `npm run test:e2e` (**30/30** Playwright, ES+EN) ✓.

---

## Stack implementado

- **Next.js 15.5 (App Router)** + React 18 + TypeScript.
- **Tailwind CSS** con tokens del DESIGN_SYSTEM §11 (CSS variables claro/oscuro en
  `src/app/globals.css`, mapeo en `tailwind.config.ts`). `darkMode: 'class'`.
- **next-intl v4** para i18n ES/EN (default ES), ruteo `[locale]` con `localePrefix: 'always'`.
  (Subido de v3 → v4 por SEC-C2; ver sección "Seguridad — SEC-C2" arriba.)
- **TanStack Query v5** para data fetching (estados carga/error/vacío consistentes).
- **lucide-react** para iconografía; **clsx + tailwind-merge** (`cn`).
- **Vitest + Testing Library** para tests unitarios.
- **Playwright** (`@playwright/test`) para E2E de flujos contra la app corriendo. Usa el
  **Chromium ya instalado** del entorno (`/opt/pw-browsers/chromium`), sin descargas.
- Output `standalone` (compatible con `Dockerfile.frontend` de devops).

## Cómo correr

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000 (redirige a /es)
npm run lint       # eslint (next/core-web-vitals)
npm run typecheck  # tsc --noEmit
npm run test       # vitest unit (10 tests)
npm run build      # next build (standalone)
npm run test:e2e   # Playwright E2E (30 tests) — ver sección "Tests E2E"
```

Variables (raíz `.env.example`, `NEXT_PUBLIC_*`):
- `NEXT_PUBLIC_API_BASE_URL` — base del API (default `http://localhost:3001/api/v1`).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — clave pública Stripe (aún no cableada, ver TODO).
- `NEXT_PUBLIC_DEFAULT_LOCALE` — `es`.
- **`NEXT_PUBLIC_USE_MOCKS`** (nuevo, opcional) — si NO es `"false"`, el cliente usa
  fixtures locales en vez de llamar al backend. **Default: mocks activos** para poder
  trabajar sin backend. Poner `NEXT_PUBLIC_USE_MOCKS=false` cuando el backend esté arriba.
  → **Solicitud a devops**: añadir esta var al `.env.example` (comentario "local ok").

## Arquitectura del cliente

- **Tipos espejo del contrato**: `src/types/contract.ts` (enums, DTOs base, DTOs por dominio).
- **Cliente API tipado**: `src/lib/api-client.ts` (fetch + `Authorization: Bearer`, mapeo de
  `error.code` a `ApiClientError`) y `src/lib/api.ts` (funciones por endpoint con **fallback a
  mocks**). El punto de integración real está listo: cada función llama a `apiRequest(...)`
  cuando `config.useMocks === false`, usando exactamente las rutas del contrato.
- **Mocks**: `src/lib/mock/fixtures.ts`, marcados `// MOCK: pendiente de backend`. Respetan los
  shapes del contrato; nombres de cartas/sets en inglés (datos de catálogo no se traducen).
- **Mapa de estados** (`src/lib/status-map.ts`): enum del contrato → `{tono de color, forma,
  clave i18n, icono}` según DESIGN_SYSTEM §2.4. Regla **estado = color + texto + icono**.
- **Formato**: `src/lib/format.ts` (`formatMoneyCents` centavos→`MX$`, `formatDate` localizada).
- **Rol de back-office** (`src/lib/role.tsx`): contexto que simula `super_admin`/`vault_operator`
  para demostrar enmascarado financiero y bloqueo de dinero saliente (el backend lo deriva del JWT).

## i18n (ES/EN)

- Catálogos: `messages/es.json` y `messages/en.json`. Cubren `common/nav/catalog/card/checkout/
  vault/shipments/buylist/orders/auth/admin.*` y, clave para el contrato:
  - `status.<domain>.<value>` para **todos los enums** (ownership, order, shipment, sellRequest,
    sellItem, price, dispute, kyc, inventory).
  - `error.<CODE>` para todos los códigos del contrato (`PRICE_PENDING`, `ITEM_NOT_SETTLED`,
    `ADDRESS_NOT_MX`, `BUYLIST_LIMIT_EXCEEDED`, `INE_REQUIRED`, `CLABE_NOT_OWN_NAME`,
    `MONEY_OUT_FORBIDDEN`, etc.).
- Toggle `LocaleToggle` (segmented ES|EN) cambia el locale por ruta. Persistencia con sesión
  (`PATCH /users/me`) queda marcada como TODO cuando exista auth real.
- Un test verifica **paridad de claves ES↔EN** (`i18n-parity.test.ts`) para evitar traducciones
  faltantes, y que cada enum del contrato resuelve a una clave existente en ambos idiomas.

## Pantallas — estado

**Storefront / comprador (completas contra el contrato, con mocks):**
- **Catálogo** (`/catalog`): grid responsivo 2→5, filtros set/rareza/condición/tipo, búsqueda,
  paginación de shape del contrato, PriceTag (venta vs referencia), estados carga/vacío/error.
- **Ficha de carta** (`/catalog/[cardId]`): imagen grande de catálogo (pokemontcg.io), tabs
  (descripción/condición; **sin pestaña "Fotos"** desde v1.2.1), badges condición/grado + certificado
  (`GradedCertChip`/`CertNumberField`), distinción **valor de mercado** vs **precio de venta**, ejemplares.
- **Checkout** (`/checkout`): `AmountBreakdown` (subtotal + fee gross-up **sin IVA** + IVA 16% +
  total), banner CFDI "enviar correo con datos fiscales", banner titularidad pendiente. Pago
  **simulado** (ver TODO Stripe).
- **Mi bóveda** (`/vault`): holdings con badge de titularidad `pending/settled` (color+texto+icono
  candado), **valor de portafolio** contra `referenceValue`, exclusión de precio pendiente, banner
  de custodia, botón retirar deshabilitado para `pending`.
- **Retiro/envío** (`/shipments`): selección de items `settled`, rechazo de no-MX (`ADDRESS_NOT_MX`),
  aviso "solo settled", `AmountBreakdown` de envío+IVA, tarifa fija, PipelineStepper de envío.
- **Buylist** (`/buylist`): cotizador público (categoría+monto o "precio pendiente"), banner
  persistente **PAY_AFTER_RECEIPT**, **guía de envío seguro** (sleeve/top loader) en modal, KYC/
  CLABE/INE avisados, mis solicitudes con PipelineStepper y estados por item.
- **Órdenes** (`/orders`, `/orders/[orderId]`): lista + detalle con desglose, CFDI y solicitar factura.
- **Auth** (`/login`, `/register`) + `LocaleToggle`. Sesión **simulada** (ver TODO).

**Back-office (responsive, captura foto móvil):**
- **Admin shell** (`/admin`): sidebar M1–M10 agrupado, topbar con switch de rol, LocaleToggle,
  ThemeToggle, drawer en móvil. Módulos no permitidos al operador aparecen con candado.
- **Dashboard**: 8 StatCards; enmascarado financiero (candado "Solo súper-admin") para `vault_operator`.
- **M1 Inventario**: alta **sin cámara/uploader de producto** (v1.2.1: se usa la imagen de catálogo remota;
  banner `admin.m1.noPhotoNotice`). Captura tipo/subtipo/condición, **empresa+grado+`certNumber`** (requerido
  para publicar gradeada), ubicación, tipo de adquisición, % aportación con hint de costo; tabla con
  folio/estado/referencia. (El único uploader del sistema es el del INE en el buylist/KYC.)
- **M3 Órdenes**: tabla + **reembolso** destructivo (solo super_admin; operador ve banner
  `MONEY_OUT_FORBIDDEN`).
- **M4 Retiros**: cola de envíos con PipelineStepper + **lista de picking ordenada por ubicación**.
- **M5 Buylist**: PipelineStepper, **cherry-pick por item** (aprobar/ajustar/rechazar/convertir),
  **pago SPEI** solo super_admin.
- **M8 Disputas**: **disputa por correo** (v1.2.1: `DisputeEvidenceContact` con el `evidenceContact` del
  contrato como `mailto:`; **sin comparador de fotos**), imagen de catálogo + descripción y —para gradeadas—
  `GradedCertChip`/`CertNumberField` como base de resolución; resolver recompra (super_admin)/rechazo.

**Pendientes (TODO, documentados en UI):** M2 (precios/FX/override), M6 (usuarios/KYC 360°),
M7 (finanzas/P&L/export CSV), M9 (reportes), M10 (config/diales/bitácora). Rutas creadas con
placeholder `ModuleTodo`; los endpoints del contrato están mapeados en los tipos.

## Componentes del DESIGN_SYSTEM implementados

`Button, Input, Select, Badge, StatusBadge, Banner, Modal, PriceTag, CardImage, ConditionBadge,
ListingCard (CardTile), AmountBreakdown, StatCard, PipelineStepper, PhotoUploader, LocaleToggle,
ThemeToggle, SafeShippingGuide, DataTable (responsive → cards en móvil), EmptyState, Skeleton,
QueryState`. Todos consumen solo tokens semánticos (sin hex crudo), tienen foco visible 3px,
objetivos táctiles ≥44px, y estados carga/vacío/error donde aplica.

## Tests unitarios (vitest, 10, todos verdes)

- `AmountBreakdown.test.tsx`: render de las 4 líneas + total formateado; variante envío; ES y EN.
- `StatusBadge.test.tsx`: enum→texto en ES y EN (cambio de idioma), badge de precio pendiente.
- `format.test.ts`: centavos→MXN, nunca centavos crudos, fecha localizada distinta por locale.
- `i18n-parity.test.ts`: paridad de claves ES↔EN + cobertura enum→clave i18n.

Comando: `npm run test` (vitest). Los unit viven en `src/**/*.test.{ts,tsx}` y están
**separados** de los E2E por script y por config (vitest `include: src/**` no toca `e2e/`).

## Tests E2E (Playwright, 30, todos verdes) — "teoría → realidad"

Verifican los **flujos de usuario contra la app corriendo** (no componentes aislados). Para
QA/devops: mismo espíritu que el humano pidió (que "funcione de verdad", no solo que compile).

### Cómo correr

```bash
cd frontend
npm run test:e2e            # script que invoca devops desde CI
npm run test:e2e:report     # abre el reporte HTML del último run
```

- **Navegador**: Chromium **ya instalado** en el entorno (`/opt/pw-browsers/chromium`).
  `playwright.config.ts` lo apunta con `launchOptions.executablePath` y respeta
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. **No** se corre `playwright install` (sin descargas).
  Sobreescribible con `PLAYWRIGHT_CHROMIUM_PATH`.
- **App bajo prueba**: parametrizada por **`E2E_BASE_URL`** (la app corriendo que levanta devops).
  - Si `E2E_BASE_URL` **está definida** → Playwright **no** levanta server, apunta ahí.
  - Si **no** está definida → Playwright levanta `npm run dev` con **`NEXT_PUBLIC_USE_MOCKS=true`**
    (webServer del config) y prueba en `http://localhost:3000`. Así QA corre los E2E **sin backend**.
- Los asserts usan las **claves i18n reales** de `messages/{es,en}.json` (helper `e2e/utils/i18n.ts`),
  no textos hardcodeados; se prueban **ES y EN** donde aplica. Los datos de catálogo (nombres de
  cartas/sets) se asertan como literales en inglés (por diseño no se traducen).

### Qué cubren (por spec, en `frontend/e2e/`)

- `i18n-locale.spec.ts` — **toggle ES/EN** (AC 32): la UI cambia de idioma, `<html lang>` y el
  prefijo de ruta `/es|/en` se actualizan.
- `auth.spec.ts` — **login/registro** (ES y EN) + toggle de idioma en el shell de auth.
- `catalog.spec.ts` — **catálogo + filtros** (filtra por rareza), **ficha** (valor de mercado vs
  precio de venta, "sin IVA"), carta **"precio pendiente"** no comprable (AC 1, 2, 3, 3b).
- `checkout.spec.ts` — **AmountBreakdown** (subtotal + procesamiento + **IVA 16%** + total),
  mensaje **CFDI por correo**, aviso de titularidad pendiente, pago (simulado) → éxito (AC 4, 30),
  **aviso de ventas finales** (ES y EN) + enlace y página `/terminos` con la política (ES y EN).
- `vault.spec.ts` — **Mi bóveda/portafolio**: titularidad `pending/settled`, valor total, retiro
  solo habilitado para `settled` (AC 5, 6, 8, 10).
- `shipments.spec.ts` — **retiro/envío**: desglose tarifa fija + IVA, rechazo de dirección
  no-MX (`ADDRESS_NOT_MX`), cartas no elegibles (AC 9, 10, 31).
- `buylist.spec.ts` — **cotizador**: EX+ = 40% de la referencia, banner **PAY_AFTER_RECEIPT**,
  **guía de envío seguro** (sleeve/top loader), cola de **precio pendiente** (AC 12, 13, 33, 34).
- `admin.spec.ts` — **panel admin**: dashboard **8 tarjetas**, **enmascarado financiero** para
  `vault_operator`, **M1** (alta sin uploader: aviso de imagen de catálogo + `certNumber` requerido en gradeada),
  **M5** (cherry-pick + nota dinero saliente), **M8** (panel de evidencia por correo, **sin** comparador de
  fotos) (AC 24, 25, 27).

### Qué corre aquí (mocks, sin backend) vs qué necesita backend real

- **Todo el suite corre HOY con `NEXT_PUBLIC_USE_MOCKS=true`** (Chromium local, sin stack). Es el
  modo pensado para que QA lo ejecute sin backend. Los asserts de datos específicos (cartas
  Charizard/Pikachu, totales MXN, portafolio) dependen de los **fixtures** del contrato.
- Contra un **`E2E_BASE_URL` con backend real** los mismos flujos de UI se validan igual, pero:
  - los **datos** deben estar **seeded** de forma equivalente para que los asserts de valores
    concretos coincidan (o se ajustan a datos del backend);
  - las acciones que hoy están **simuladas** en el front pasan a ser **reales**: `POST /auth/*`
    (sesión), **Stripe** en checkout/envío (`/checkout/session`, `/shipments`), **presign+PUT** de
    fotos (`/uploads/presign`) y las **mutaciones de admin** (M1 alta, M3 refund, M5 decisión/convert/
    pay-spei, M8 resolve). Ver "TODO para integración real" abajo.
- **No** hay E2E que dependan de un backend corriendo para poder ejecutarse: el suite es
  **self-contained** en modo mocks. Marcamos arriba qué se vuelve "real" al integrar.

## Supuestos tomados

- Precio de venta = `salePriceCents` del `ListingDTO`; valor de mercado = `referenceValue`
  (`PriceInfo`). PriceTag nunca muestra `$0`: si `status="pending"` y sin salePrice → "Precio
  pendiente" (regla de confianza).
- IVA/fee/gross-up: la UI solo **muestra** el `BreakdownDTO` del backend. Se añadió
  `computeBreakdown` (mock) replicando ARCHITECTURE §5.1 solo para los fixtures; en producción los
  valores vienen del contrato (incluido `ivaRatePct`).
- Fuente única de monto = centavos del contrato; formateo en la capa de presentación.

## M6 · Alta de usuarios (E3) + Historial 360° por pestañas (F3) — v1.7-admin-users

Contrato consumido: `docs/API_CONTRACT.md` §M6 (changelog v1.7-admin-users). Todo en
`frontend/src/app/[locale]/(admin)/admin/m6/M6View.tsx`, `frontend/src/lib/api.ts`,
`frontend/src/types/contract.ts`, `frontend/src/lib/mock/fixtures.ts` y `frontend/messages/{es,en}.json`.

### E3 — Crear usuario (`POST /admin/users`, super_admin)
- Botón **"Crear usuario"** en la barra de filtros, **visible solo para super_admin** vía
  `useRole().isSuperAdmin` (mismo patrón que M3/M5/M8). El backend sigue siendo la autoridad.
- **Modal-formulario**: email, nombre, `<Select>` de rol (`customer|vault_operator|super_admin`) y
  contraseña **opcional**. Contraseña vacía ⇒ el backend autogenera la temporal (patrón reset M-15).
  Aviso de escalada de privilegios al elegir `super_admin`.
- La **temp password** (cuando se autogenera) se muestra **UNA sola vez** reusando el **mismo panel**
  que el reset M-15: extraje el componente `TempPasswordPanel` (aviso "una sola vez" + copiar + nota
  de cambio obligatorio) y lo comparten el modal de reset y el resultado del alta.
- Al crear OK: se **invalida** `['admin-users']` (refresca la lista) y se muestra un modal de éxito
  (con la temp password si vino, o nota de que puede entrar con la password provista).
- Errores mapeados a copy claro: **409 EMAIL_TAKEN**, **422 VALIDATION_ERROR**, **403 FORBIDDEN**.
- API: `createAdminUser(input)` en `lib/api.ts` (rama mock marcada; simula 409 si el email ya existe y
  autogenera la temporal solo si no se envía password). Tipo `AdminCreatedUserDTO` en `types/contract.ts`.

### F3 — Ficha 360°: conteos → pestañas con detalle (servicio al cliente)
- El grid de `SummaryCount` (solo números) se reemplazó por **pestañas** con tablas **paginadas** y
  **lazy-load** (solo se monta la pestaña activa ⇒ la query se dispara al abrir la pestaña). Reusa
  `DataTable`, `QueryState`, `StatusBadge` y el patrón de paginación del proyecto.
- Pestañas y endpoints (todos filtrados por `userId`):
  - **Compras** → `GET /admin/orders?userId=` (`getAdminUserOrders`)
  - **Ventas** → `GET /admin/buylist?userId=` (`getAdminUserBuylist`)
  - **Envíos** → `GET /admin/shipments?userId=` (`getAdminUserShipments`, endpoint **NUEVO**)
  - **Disputas** → `GET /admin/disputes?userId=` (`getAdminUserDisputes`)
  - **Bóveda** → usa el resumen `ownedItems` que ya trae `GET /admin/users/:id` (no hay endpoint admin
    de holdings por usuario en el contrato). Ver solicitud al arquitecto abajo.
  - **Actividad** → `GET /admin/users/:id/audit?scope=target` (`getAdminUserAudit`, endpoint **NUEVO**):
    muestra `action` / `actorRole` / `fecha`; la columna **`ip` solo se pinta si el backend la envía**
    (proyección super_admin). Para `vault_operator` no viene y la columna se **omite** (respeto estricto
    de la proyección por rol; **nunca** se muestran `before`/`after`). Tipo `UserAuditEntryDTO` añadido.
- Se **mantienen intactos** el reset-password y el delete de M-15 (solo se extrajo el panel de temp
  password para reuso; la lógica y las llaves i18n no cambian).

### i18n
- Paridad ES/EN de todas las llaves nuevas bajo `admin.m6` (`create.*`, `tabs.*`, `disputeType.*`,
  `historyEmpty`, y ampliación de `table.*`). El test `src/lib/i18n-parity.test.ts` sigue verde.

### Tests añadidos (`M6View.test.tsx`)
- Crear usuario: super_admin ve el botón, autogenera y ve la temporal **una sola vez**; y **409
  EMAIL_TAKEN** con mensaje claro.
- Pestañas: **Compras** llama a `getAdminUserOrders` con el `userId` al abrir la ficha; **Envíos**
  (endpoint nuevo) llama a `getAdminUserShipments` con el `userId` al abrir la pestaña; **Actividad**
  pinta el `ip` cuando el backend lo envía. (Se mockea `useRole` a super_admin para el flujo de alta.)

### Gates (frontend/)
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` ✓ (163 tests, incl. paridad i18n) ·
`npm run build` ✓.

## Fricciones / solicitudes al arquitecto (no bloquean; NO edité el contrato)

0. **Bóveda en la ficha 360° (M6/F3) — falta `finish` + valor en la proyección**: la pestaña Bóveda
   debería mostrar "carta + acabado + valor", pero `AdminUserOwnedItemRef` (proyección de
   `GET /admin/users/:id.ownedItems`) solo trae `{ inventoryItemId, folio, card, ownershipStatus }`.
   Respetando "no mostrar campos que el backend no envía", hoy la pestaña muestra folio + carta +
   titularidad. **Solicito** enriquecer `ownedItems` con `finish` + `referenceValue` (o un
   `GET /admin/users/:id/holdings` paginado con el shape de `HoldingDTO`) para poder mostrar acabado y
   valor sin romper la proyección PII por rol.
1. **`NEXT_PUBLIC_USE_MOCKS`**: var nueva del frontend para alternar mocks/real. Solicito a devops
   añadirla al `.env.example`. No afecta al contrato.
2. **`capturedDate` en todos los `ListingDTO`**: el diseño muestra la fecha del precio en catálogo y
   bóveda. Confirmar que `PriceInfo.capturedDate` viene poblado en listados (no solo en detalle)
   —igual que anotó ux-ui en DESIGN_SYSTEM §13.1—. La UI lo maneja como opcional si falta.
2. **Fee de procesamiento (tooltip)**: se muestra copy genérico "cubre el procesamiento del pago"
   (DESIGN_SYSTEM §13.2). Sin cambio de contrato.
3. **Presign de fotos**: `PhotoUploader` está listo para `POST /uploads/presign` + `PUT` directo;
   hoy la subida es simulada. Cableado real cuando el backend exponga el bucket (S3/MinIO).

## TODO para integración real (cuando el backend corra)

- Poner `NEXT_PUBLIC_USE_MOCKS=false`; validar shapes 1:1 con el backend.
- **Auth real**: `POST /auth/login|register|refresh`, refresh token, `GET /users/me`, guardado de
  `locale` en `PATCH /users/me`. Hoy la sesión es un token mock en localStorage.
- **Stripe**: montar `@stripe/stripe-js` + Elements con el `clientSecret` de
  `POST /checkout/session` y `POST /shipments`. Hoy el botón de pago simula el flujo.
- **PhotoUploader**: presign PUT real (`/uploads/presign`).
- Cablear mutaciones de admin (M1 alta, M3 refund, M5 decisiones/convert/pay-spei, M8 resolve) a
  sus endpoints `/admin/*`.
- **Self-host de Inter** vía `next/font` (hoy fallback de sistema para evitar dependencia de red en
  build; los tokens tipográficos ya están listos).

---

## M1 · Gestión de inventario (Ola 2, 2026-08-17)

Ola 2 del back-office M1: el operador pasa de "solo alta" a **gestión completa** del inventario.
Todo contra endpoints **verificados** en `docs/API_CONTRACT.md §M1` **y** en
`backend/src/modules/inventory/inventory.controller.ts` (ningún path inventado).

### Endpoints cableados (todos existentes en backend)

| Acción UI | Endpoint | Función `lib/api.ts` |
|---|---|---|
| Tabla con filtros + paginación | `GET /admin/inventory/items?q=&status=&zone=&locationId=&page=&pageSize=` | `getAdminInventory(filters)` (antes iba SIN query → capada a 20 sin filtros) |
| Detalle + historial de movimientos | `GET /admin/inventory/items/:id` | `getAdminInventoryItem(id)` |
| Publicar / retirar de venta + precio manual | `PATCH /admin/inventory/items/:id` (`{ status: 'listed'\|'in_stock', listPriceCents? }`) | `updateInventoryItem(id, input)` |
| Mover de ubicación | `POST /admin/inventory/items/:id/move` (`{ toLocationId, note? }`) | `moveInventoryItem(id, input)` |
| Marcar perdida/dañada | `POST /admin/inventory/items/:id/mark` (`{ mark, note }` — nota OBLIGATORIA) | `markInventoryItem(id, input)` |
| Listar/crear ubicaciones | `GET/POST /admin/locations` (`{ zone, box, row, slot }`) | `getLocations()` / `createLocation(input)` |

> **Nota de path:** las ubicaciones viven en **`/admin/locations`** (contrato §M1 línea "Ubicaciones" +
> `@Controller('admin')` + `@Get('locations')`), NO en `/admin/inventory/locations`.

### Decisiones de implementación

- **Componentes nuevos** (en `frontend/src/app/[locale]/(admin)/admin/m1/`):
  - `ItemDetailModal.tsx` — detalle por pieza: folio + acabado (FinishBadge) + estado (StatusBadge) +
    ubicación + cert (graded) + referencia + precio de venta + **historial de movimientos** (motivo
    traducido `admin.m1.movementReason.*`, transición de ubicación/estado, nota, fecha). Acciones:
    **Publicar/Retirar** (solo `in_stock`/`listed`), **Mover** (excluye la ubicación actual) y
    **Marcar pérdida/daño** (nota obligatoria; botón destructive + Banner de advertencia). Cada acción:
    Banner de confirmación + error REAL del contrato (`useErrorMessage`) + invalidación de
    `['admin-inventory']` y `['admin-inventory-item', id]`.
  - `LocationsModal.tsx` — gestor mínimo de ubicaciones (lista + alta caja/fila/slot + zona). Sin esto,
    el dropdown de ubicación del alta quedaba vacío en una BD limpia. Crear invalida `['locations']`.
- **Precio de publicación:** el operador captura PESOS y se convierte con `Math.round(Number(x) * 100)`.
  Es **precio de venta MANUAL** (override del contrato PATCH §M1), NO una derivación en cliente —
  **SEC-A1 intacto** (la derivación referencia×markup la hace el backend cuando no hay override).
  El **sellado** exige precio manual para publicar (botón bloqueado sin `listPriceCents` previo ni
  capturado); raw/graded pueden publicar sin precio manual (el server deriva de la referencia). La
  invariante "gradeada publicada exige `certNumber`" la valida el backend en el PATCH (la rama mock la
  replica para la demo).
- **Filtros/paginación de la tabla:** estado (enum `InventoryStatus` completo, labels del catálogo global
  `status.inventory`), zona (`platform_stock`/`customer_custody`), ubicación y búsqueda por folio
  (`q` → `folio contains`, case-insensitive, como en el service). Cambiar un filtro reinicia a página 1.
  `queryKey: ['admin-inventory', filters]` — la invalidación por prefijo `['admin-inventory']` sigue
  cubriendo todas las páginas/filtros.
- **Tipos nuevos** (`types/contract.ts`): `MovementReason`, `InventoryMovementDTO`,
  `AdminInventoryItemDetailDTO extends InventoryItemDTO { movements }` (shape del `getItem` del backend:
  include card+location+movements desc).
- **Mocks:** `fixtures.ts` gana `mockInventoryMovements` + `pushMockMovement()`; las ramas mock de
  move/mark/patch mutan `mockInventory` en memoria (misma filosofía que M5).

### i18n (paridad ES/EN verificada por `i18n-parity.test.ts`)

Claves nuevas bajo `admin.m1`: `view`, `filtersFolio`, `filtersFolioPlaceholder`, `filtersZone`,
`pageInfo`, `prev`, `next`, `emptyTitle`, `emptyBody`, `zone.*` (2), `detail.*` (4), `publish.*` (10),
`move.*` (7), `mark.*` (9), `movementReason.*` (9), `locations.*` (11). Los estados de inventario
reusan el catálogo global `status.inventory.*` (sin duplicar).

### Deudas techlead Ola 1 (dueño frontend) — las 3 RESUELTAS

1. `paginate<T>` único en la cabecera de `api.ts`, reusado por `getAdminShipments` / `getAdminUsers` /
   `searchBuylistCards` / `getAuditLog` (y las nuevas ramas mock de M1). Bonus: `getAdminShipments`
   ahora sí pagina en mock (antes ignoraba `page/pageSize`).
2. `mockJobId()` / `mockTempPassword()` extraídos (5 sitios inline eliminados).
3. Interfaz vacía `AdminBuylistItemDTO` eliminada de `types/contract.ts` (cero consumidores).

Registradas como **TL-FE-1/2/3 (RESUELTAS)** en `docs/TECH_DEBT.md`.

### Tests añadidos

- `M1View.test.tsx` (12 tests): filtros reales (`status` + reinicio a página 1), paginación (`page=2`),
  detalle (folio + cert + movimientos), publicar (pesos→centavos `1234.56 → 123456` + PATCH
  `status=listed` + Banner de éxito), error real del PATCH (422), mark exige nota (botón deshabilitado),
  crear ubicación (payload `{ zone, box, row, slot }` + Banner con label).
- `api.test.ts` (+6): filtros/paginación mock de `getAdminInventory`, detalle con movimientos,
  publicar + invariante cert de gradeada, move/mark registran movimiento, `createLocation` deriva label.

### Gates (frontend/)

`npm run lint` ✓ · `tsc --noEmit` ✓ · `npx vitest run` ✓ (**35 archivos / 202 tests**, incl. paridad
i18n) · `npm run build` ✓.

## Buylist · Rediseño "menos clics" del flujo de venta/cotización (2026-08-17)

Rediseño del cotizador público + carrito de venta (`BuylistView.tsx`) y del paso de pago
(`BuylistKycForm.tsx`). **Solo frontend**: endpoints EXISTENTES del contrato §6, sin cambio de
backend ni de contrato. SEC-A1 intacto (el front solo MUESTRA estimados; el backend re-deriva
todos los montos).

### Qué cambió (recorrido del cliente)

| Antes | Después |
|---|---|
| Elegir carta → clic "Cotizar" → clic "Agregar" (3 clics/carta tras la búsqueda) | Elegir carta → **auto-cotiza** → clic "Agregar" (2 clics; cambiar acabado también re-cotiza solo) |
| Cotizar N cartas = 3N clics | **Bulk**: N checkboxes + 1 clic "Agregar seleccionadas (N)" |
| Cantidad solo con −/+ de 1 en 1 | **Input numérico** por línea (además de −/+) |
| Grid de resultados sin precio | Cada resultado muestra su **estimado de compra** (raw NM, acabado default) |
| Línea/total pendiente = "—" o MX$0.00 | **"Precio pendiente"** explícito + nota que explica el total (carrito, modal y "Mis solicitudes") |
| Modal final sin contexto | **Resumen de la venta** (cartas × cantidad × acabado + total + vigencia) antes de "Confirmar y enviar" |
| Tipos `raw/graded/sealed` crudos | Etiquetas traducidas: **"Suelta (raw)" / "Gradeada" / "Sellado"** |

### Decisiones técnicas

- **Auto-cotización con `useQuery` (no mutation)**: `POST /buylist/quote` es read-only en el
  contrato (v1.12), así que se modela como query con key `['buylist-quote', cardId, productType,
  finish]` y `staleTime` 5 min. La MISMA key la comparten la cotización principal, el precio del
  grid (`ResultQuote`) y el bulk (`fetchQuery`): cotizar en un sitio cachea para los demás.
- **Precio en el grid = 1 quote unitario por resultado visible** (página ≤ ~20), cacheado.
  UX elegida sobre "on-expand" porque convierte el buscador en buylist navegable (objetivo ALTO).
  Marcado `Fase 3b: reemplazar por batch quote` — cuando el arquitecto/backend expongan cotización
  en lote, `ResultQuote` y `addSelectedToCart` cambian a un solo POST.
- **Bulk** cotiza con productType `raw` + NM + primer acabado disponible (la buylist compra raw);
  el acabado/tipo se afina por carta re-cotizando en el panel. Dedup del carrito intacto
  (cardId + productType + finish).
- **Resultados del grid**: se quitó el patrón `listbox/option` (inválido con el checkbox de
  multi-selección dentro) → lista plana con botón `aria-pressed` + checkbox con
  `aria-label="Seleccionar {carta}"`. Anillo de foco `shadow-focus` respetado (DESIGN §8.2);
  el input numérico de cantidad usa `focus-visible:shadow-focus`.
- **"Usar mi CLABE ****1234" (BuylistKycForm)**: implementado como modo por defecto cuando
  `clabeMasked` existe, con "Usar otra CLABE" para capturar una distinta. **LIMITACIÓN DE
  CONTRATO**: `POST /buylist/requests` exige `clabe` en claro (18 dígitos) y la valida por
  blind-index contra la de KYC; el cliente NUNCA tiene la CLABE en claro (solo `clabeMasked`).
  Por eso el atajo está **acotado a modo mock** (`config.useMocks`) y marcado
  `// MOCK: pendiente de contrato`. **Solicitud al arquitecto** (registrada abajo): `clabe?`
  opcional en `POST /buylist/requests` con fallback server-side a la CLABE de KYC (mismo fallback
  que ya implementa `reveal-clabe`). Con ese cambio, quitar el gate `useMocks` habilita el atajo
  en producción sin tocar nada más.
- **Copy de confianza (EDITABLE)**: `buylist.trustShipping` (el vendedor paga el envío de ida y
  la devolución de rechazos no-NM — respaldado por PROJECT §H), `buylist.trustPayment`
  (**placeholder "2–3 días hábiles"** para verificación+pago SPEI — SIN dato oficial, editar
  cuando el negocio lo confirme) y `buylist.trustValidity` (vigencia del estimado; espeja SEC-A1:
  el monto final se confirma al verificar). `trustValidity` se reusa como aviso de vigencia en el
  resumen del modal.
- `onCreated` del modal ahora invalida también `['kyc']` (la solicitud puede registrar la CLABE
  → el checklist de requisitos se refresca).

### i18n (paridad ES/EN verificada por `i18n-parity.test.ts`)

Claves nuevas bajo `buylist`: `gridEstimateLegend`, `bulkSelect`, `bulkAddCta`, `bulkClear`,
`bulkAdded`, `bulkAddError`, `productType.{raw,graded,sealed}`, `quantityFor`, `totalPendingNote`,
`requestPendingNote`, `summaryTitle`, `trustShipping`, `trustPayment`, `trustValidity`,
`clabeSectionTitle`, `clabeStoredSelected`, `clabeUseStored`, `clabeUseAnother`.
Eliminadas (sin consumidores): `getQuote` (ya no hay botón), `quantity` (reemplazada por
`quantityFor`). Ajustada: `chooseCardFirst` (explica la auto-cotización).

### Preservado (no romper)

Cotizador público sin login; gating P-11 (`useSellRequirements` + `SellRequirementsPanel`, tests
intactos y verdes); transparencia de la regla ("40% de referencia" / "$X fijo"); dedup del
carrito; keep-alive de sesión; anillo de foco `shadow-focus`.

### Tests y gates

- `BuylistView.test.tsx`: 31 tests (antes 20) — auto-quote (sin botón "Cotizar"), estimado en el
  grid, bulk (multi-selección + loop del quote unitario + limpiar), input numérico de cantidad,
  pendiente honesto (carrito y "Mis solicitudes"), resumen del modal, tipos traducidos, y TODOS
  los de gating P-11 actualizados al flujo nuevo.
- `BuylistKycForm.test.tsx`: 11 tests — + modo "usar mi CLABE" (toggle y envío con
  `useClabeOnFile` sin reteclear, mock) y el resto intactos.
- `e2e/buylist.spec.ts` (Playwright, la corre QA): actualizado al flujo sin botón "Cotizar";
  + grid con estimado, + bulk, + resumen del modal; los tests de envío ahora SIEMBRAN sesión de
  cliente verificada (`tcg.user` en localStorage, modo mock) porque el gating P-11 sustituye el
  CTA de enviar por login/registro sin sesión (la spec anterior era pre-gating y ya no reflejaba
  la UI).
- Gates (frontend/): `npm run lint` ✓ · `npx tsc --noEmit` ✓ · `npx vitest run` ✓
  (**35 archivos / 231 tests**) · `npm run build` ✓.

### Solicitudes al arquitecto (pendientes de contrato)

1. **Batch quote (Fase 3b)**: endpoint de cotización en lote (p. ej.
   `POST /buylist/quote-batch { items: [{cardId, finish?}] }`) para el precio del grid y el bulk;
   hoy es loop del unitario (marcado en código).
2. **CLABE en archivo**: `clabe?` opcional en `POST /buylist/requests` cuando el usuario tiene
   CLABE en KYC (fallback server-side, mismo patrón que `reveal-clabe`), para habilitar "Usar mi
   CLABE ****1234" contra el backend real.

---

## M2 · Editor de precio de VENTA por rareza (Fase 2, v1.13-sales-pricing)

Sección nueva en `admin/m2/M2View.tsx` ("Sección 5"), clon análogo del editor de buylist por
rareza (Sección 4), pero para el precio de **VENTA**. Consume los endpoints nuevos del backend
(commit `fba6486`, contrato §M2 v1.13-sales-pricing):

- `GET /admin/pricing/sales-rarities` → `getSalesRarities()` (mismo shape que buylist-rarities).
- `GET /admin/pricing/sales-rules` → `getSalesRules()`.
- `PUT /admin/pricing/sales-rules` → `updateSalesRules({ rules, fallbackPct })`.

### Diferencia clave de copy vs. buylist (semántica de `pct`)

El `pct` de VENTA es **markup ARRIBA de mercado** (no "% de la referencia" como en buylist):
`salePrice = mercado × (1 + %)`. El editor lo rotula explícitamente: fallback = "Fallback (%
sobre mercado)", modo pct = "% sobre mercado", más un hint con la fórmula. El `fixed` se rotula
como **piso** en MX$ ("Piso (MX$)"). El validador de venta admite pct hasta 1000 (no topa en 100
como buylist); el front no fuerza tope, deja pasar el valor y el backend valida `[0,1000]`.

### Tipos / API / mocks

- `contract.ts`: `SalesRuleMode`, `SalesRule`, `SalesRuleApplied`, `SalesRulesDTO`,
  `SalesRarityRowDTO`, `SalesRaritiesResponse` (clones de los `Buylist*`).
- `api.ts`: `getSalesRarities`, `getSalesRules`, `updateSalesRules` con rama `config.useMocks`.
- `fixtures.ts`: `mockSalesRules` (seed: Common $5 fijo, Uncommon $10 fijo, Reverse Holo $10
  fijo), `mockSalesFallbackPct=15`, `setMockSalesRules`, `resolveSalesRule`, `mockSalesRarities`.

### i18n (paridad ES/EN)

Claves nuevas bajo `admin.m2.salesRules`: `title`, `subtitle`, `fallbackLabel`, `fallbackHint`,
`rarity`, `cardCount`, `mode`, `value`, `source`, `valueMxn`, `valuePct`, `modeFor`, `valueFor`,
`modeLabel.{fixed,pct}`, `sourceLabel.{rule,fallback}`, `pctHint`, `saved`.

### Tests

`M2View.test.tsx`: +3 tests de la sección de venta (render + hint de markup, editar fijo Common →
`updateSalesRules` en centavos, editar fallback pct>100 sin tope). Los tests de buylist y venta se
acotan a su `<section>` (helper `sectionFor`) porque ambos editores comparten aria-labels
("Guardar", "Modo/Valor para {rarity}"); refactor sin cambiar comportamiento. Suite: 234 tests.

### Preservado

Anillo de foco `shadow-focus`; secciones de sync de catálogo (barra de progreso/keep-alive),
buylist rules, FX y pending sin tocar.

### Nota para el arquitecto

`salesMarkupPct` (dial M10, `SettingsDTO`) queda **DEPRECADO** por el contrato (palanca de
rollback). El front no lo consume en M2; sigue en `SettingsDTO` por compatibilidad hasta su
retiro (decisión abierta v1.13-3). Sin solicitudes de contrato: los tres endpoints ya existen.

---

## WS-G · E2E smoke agnósticos de mocks (comprar / retirar / vender contra backend REAL)

**Problema.** Los smoke de flujos de dinero eran verdes SIEMPRE en modo mock: autenticaban
inyectando `tcg.user` en localStorage (sin token real), asertaban montos exactos de fixture
(`MX$19,400.00`, `MX$3,380.00`), esperaban un stub de pago viejo (`checkout.paidTitle`) y
hardcodeaban cartas (`Charizard`, `c-charizard`). Tras WS-F (comprar/retirar reales con Stripe)
esos 4 tests quedaron ROTOS incluso en mock, pero "QA verde" los ocultó. Ahora los smoke corren,
env-agnósticos, contra el backend real.

### Helper `frontend/e2e/utils/auth.ts`
- `loginAs(page, 'customer'|'admin'|'operator')` env-aware:
  - **Real** (`E2E_REAL=1`): `POST {API}/auth/login` con `page.request` y persiste el `TokenPair`
    + `user` en localStorage con el MISMO shape que `persistSession` (`src/lib/api.ts`):
    `tcg.accessToken`, `tcg.refreshToken`, `tcg.user` (y `tcg.role` para staff), vía `addInitScript`
    (aplica antes de la primera carga → llamar SIEMPRE antes de `page.goto`).
  - **Mock**: inyecta solo `tcg.user` (las ramas mock de `api.ts` ignoran el token).
- Credenciales del seed determinista viven SOLO aquí (sobreescribibles por env):
  `customer@e2e.local`/`Customer123!`, `admin@e2e.local`/`Admin123!`, `operator@e2e.local`/`Operator123!`.
- `IS_REAL` (`E2E_REAL==='1'`) y `MONEY_RE` (`/MX\$[\d,]+\.\d{2}/`, aserción por FORMATO) exportados.
- API real por defecto en `http://localhost:3011/api/v1` (puerto del backend en `docker-compose.staging.yml`);
  override con `E2E_API_BASE_URL`.

### Tag `@real` + `playwright.config.ts`
- Los smoke de dinero llevan `@real`. Cuando `E2E_REAL=1`, el config filtra `grep: /@real/`
  globalmente → en real corre SOLO el subset (comprar/retirar/vender/bóveda). En mock (sin
  `E2E_REAL`) NO se filtra: corre TODA la suite y los `@real` también pasan por su rama mock.
- 4 tests `@real`: `checkout.spec.ts` (comprar), `shipments.spec.ts` (retirar),
  `buylist.spec.ts` (vender), `vault.spec.ts` (portafolio/custodia).

### Env-agnosticismo de los specs
- **Descubre datos, no hardcodea**: catálogo → primera carta con "Agregar"; bóveda/retiro →
  primer checkbox settled; buylist → primer set del dropdown → primera carta del grid
  (`pickFirstSellableCard`).
- **Aserciones de estructura**: `getByTestId('amount-breakdown')`, total con `MONEY_RE`,
  `checkout.shipping`/`checkout.iva`. Cero montos de fixture.
- **Pago (comprar/retirar)**: tras "Pagar"/"Solicitar retiro" el modal SOLO abre si la sesión
  real (`POST /checkout/session` / `POST /shipments`) se creó. En real se asierta que el modal
  monta Stripe `<Elements>` (el cuerpo simulado `payment.mockBody` está ausente); NO se depende de
  una pantalla de "pagado" (el asentamiento es por webhook). En mock se conserva el camino simulado.
- **Vender**: crea la solicitud (`POST /buylist/requests`). Maneja ambos modos de CLABE
  (atajo "usar mi CLABE en archivo" si el seed la trae, o captura de CLABE válida si no) y espera
  `buylist.created`. Viewport alto (2000px) porque el `Modal` no scrollea internamente y el CTA
  quedaría fuera de pantalla (ver deuda menor abajo).

### Cómo correr contra local-staging (lo que el humano SÍ puede)
```
# 1) Levantar el stack real y sembrar (una vez):
docker compose -f docker-compose.staging.yml --profile apps up -d --build
docker compose -f docker-compose.staging.yml exec -T backend npm run seed:synthetic

# 2) Correr el subset @real contra el frontend real:
cd frontend
E2E_BASE_URL=http://localhost:3010 E2E_REAL=1 npm run test:e2e -- --grep @real
```
(El `--grep @real` es redundante con el grep del config cuando `E2E_REAL=1`, pero explícito como
pide el runbook. Usa el Chromium preinstalado `/opt/pw-browsers`; NO `playwright install`.)

### Verificado aquí (sin stack real)
- `npx tsc --noEmit` limpio.
- `npx playwright test --list` enumera los 4 `@real`; con `E2E_REAL=1` el grep deja SOLO esos 4.
- Modo mock verde: `checkout/vault/shipments/buylist` = **20/20**; resto de la suite sin regresión.

### Pendiente de validar contra el stack real (no ejecutable aquí)
- Que `loginAs` real reciba `{accessToken, refreshToken, user}` del seed y el Bearer pase los guards.
- Que exista ≥1 listing vendible en Compra (para comprar) — el seed debería traerlo.
- Que el modal de Stripe monte `<Elements>` con el `clientSecret` real (en CI la publishable key es
  dummy `pk_test_e2e_dummy`; por eso NO se asierta el iframe de Stripe, solo la ausencia del cuerpo
  mock, que ya confirma que la sesión real se creó).
- Que el cliente del seed traiga CLABE/INE en archivo para que "vender" no tope con
  `CLABE_NOT_OWN_NAME` (el spec cae al modo captura si no; según lo confirmado, el seed los trae).

### Solicitudes a otros roles (sin cambio de contrato)
- **devops**: `e2e-real.yml` hoy corre `npm run test:e2e -- checkout.spec.ts shipments.spec.ts
  buylist.spec.ts` **sin** `E2E_REAL=1`. Para que "verde de verdad" signifique real, añadir
  `E2E_REAL: '1'` al `env` del job (basta eso: el config auto-filtra `@real` dentro de esos files).
  Opcional: incluir `vault.spec.ts` en `SMOKE_SPECS`. Sin esto, el job seguiría corriendo la rama
  mock de los `@real` y los tests mock-only fallarían contra el stack real.

### Deuda técnica menor (frontend, no bloqueante)
- `components/ui/Modal.tsx` no tiene `max-height`+scroll interno: en formularios altos (KYC de
  buylist) el CTA "Confirmar y enviar" queda fuera del viewport. El spec lo sortea subiendo el
  viewport a 2000px, pero es una fricción real de usabilidad. Anotar en `TECH_DEBT.md` a petición
  de techlead.

---

## Rediseño del cotizador: grid protagonista (2026-08-17, stream «Catálogo y precios»)

Rediseño integral de `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx` en una sola
pasada. Cambios de UX y sus decisiones:

### Layout
- **El grid de resultados manda:** ocupa el ancho/alto disponible con **scroll natural de página**
  (se eliminó la caja `max-h-96 overflow-y-auto`). Retícula responsiva 2→3→4→5→6 columnas.
- **Barra de filtros** encima del grid: set + buscador + **tipo de producto** (el select de tipo se
  movió aquí desde el desaparecido "Paso 2" para no perder la capacidad de cotizar graded/sealed).
- **Carrito de venta como columna lateral colapsable** (`lg:sticky`, 360px): toggle
  "Ocultar/Mostrar carrito (N)" en la barra (`aria-expanded`). Colapsado, el grid usa todo el ancho.
- La política **NM-only** y el copy de confianza (envío/pago SPEI/vigencia) viven en una sección
  propia bajo el grid; **PAY_AFTER_RECEIPT** quedó en la cabecera, visible desde el load.

### Cotización directa (sin panel «COTIZACIÓN»)
- Se eliminó el panel de cotización, el botón "Agregar al carrito" intermedio y el **campo falso
  «Condición: Near Mint (NM) fija»** (el aviso NM-only existente cubre esa información).
- **Cada carta del grid lista sus acabados** (`availableFinishes`, orden `FINISH_ORDER`) como filas
  agregables: una fila = un acabado con **su propio estimado server-side**; el clic **agrega directo
  al carrito** (dedup por `cardId+productType+finish`, misma línea suma cantidad). En tipo
  graded/sealed hay una sola fila por carta (cotizan en `normal`, contrato §I).
- **Transparencia por línea:** cada línea del carrito tiene un **detalle expandible** (rareza,
  acabado, valor de referencia, regla aplicada y la nota de «precio pendiente» cuando aplica) — la
  misma información que daba el panel.

### Límites del batch (decisión no obvia)
- El grid cotiza **por acabado** en `POST /buylist/quote/batch` (cap **50 ítems/llamada**, throttle
  **12/min**). Una página (pageSize 20) × hasta 4 acabados puede llegar a 80 ítems → el queryFn
  **trocea en llamadas de ≤50** (`BUYLIST_QUOTE_BATCH_MAX` de `@/lib/api`): típico 1 llamada, peor
  caso 2 por búsqueda; react-query cachea 5 min por (búsqueda × tipo). Se eligió cotizar TODOS los
  acabados de la página (en vez de lazy al expandir) porque el peor caso cabe holgado en el throttle
  y da estimados visibles sin interacción extra.
- **El bulk ya no llama a la red:** «Agregar seleccionadas (N)» reusa las cotizaciones del batch del
  grid (acabado por defecto por carta), tolerante por-ítem (`ok:false` → aviso parcial). El CTA se
  deshabilita mientras el batch carga.
- SEC-A1 intacto: los montos vienen SIEMPRE del server (batch); la UI no calcula ni manda precios.

### «Mis solicitudes» sin sesión
- El query `getSellRequests` se **gatea por sesión** (`useSellRequirements.ready && isAuthenticated`):
  sin sesión no hay request y la sección muestra una **invitación neutra** a iniciar sesión
  (`buylist.requestsLoginInvite`) — nunca un estado de error.

### i18n (paridad ES/EN mantenida)
- Nuevas claves `buylist.*`: `searchHint`, `gridQuotesFailed`, `addFinishAria`, `addedLine`,
  `cartShow`, `cartHide`, `lineDetailShow`, `lineDetailHide`, `requestsLoginInvite`; rewording de
  `gridEstimateLegend` y `cartEmpty`.
- Claves retiradas (sin consumidores): `quoterTitle`, `selectCard`, `selectCondition`,
  `selectFinish`, `quoting`, `quoteResult`, `category`, `categoryLabel`, `quotedPrice`,
  `createRequest`, `conditionFixedNm`, `selectedCard`, `chooseCardFirst`, `addToCart`,
  `addedToCart`.

### Tests
- `BuylistView.test.tsx` reescrito al nuevo flujo (42 tests): grid por acabado, add directo,
  detalle expandible, colapso del carrito, bulk sin requests extra + parcial por-ítem, dedup por
  acabado, «Mis solicitudes» sin sesión (endpoint NO consultado, sin `role=alert`), gating P-11 y
  v1.15 CLABE/INE intactos.
- `e2e/buylist.spec.ts` actualizado (11 tests, `--list` verificado): helpers `searchFor`/`addCard`
  clican la fila de acabado por su `aria-label` (`buylist.addFinishAria`); el smoke `@real` agrega
  la primera carta descubierta (Playwright auto-espera a que la fila se habilite con el estimado).
- Flujos preservados: modal con `BuylistKycForm` (CLABE + INE, gating P-11), respuesta a ajuste F5.


## 2026-08-17 · Feedback del CTA «Comprar» en la ficha de carta (carrito local)

### Problema
El botón «Comprar» de la ficha (`catalog/[cardId]/CardDetailView.tsx`) agregaba al carrito local
(`useCart`, pieza única deduplicada en localStorage) sin ningún feedback: parecía un botón muerto.

### Decisión (dónde vive el CTA)
- **`InstanceCta` (componente local en `CardDetailView.tsx`):** CTA por ejemplar con tres estados —
  «Comprar» (primary) → «✓ En el carrito» (secondary + check lucide `aria-hidden`; el texto porta el
  estado, §7.4) → «No disponible» (disabled). El segundo clic **no re-agrega** (el carrito es pieza
  única): navega a `/checkout` (misma ruta que el badge del `StorefrontHeader`) vía
  `useRouter` de `@/i18n/navigation`. Vive en la vista y NO en `ListingCard` porque
  `frontend/src/components/` es zona compartida de otro stream y las props actuales de `ListingCard`
  (`{ listing, onAdd }`) no expresan el estado «en carrito».
- **`catalog/CartAddedToast.tsx` (local al módulo de catálogo):** toast efímero (5 s, esquina,
  DESIGN_SYSTEM §7.5) en bloque de tinta con texto mono en versalitas y enlace «Ver carrito» →
  `/checkout`. La región `role="status"`/`aria-live="polite"` está siempre montada para que el
  lector anuncie el cambio. No se construyó infra global de toasts (no existe y las zonas
  compartidas están vetadas a este stream); si otro módulo lo necesita, promoverlo a
  `src/components/` pasa por el stream dueño.
- **Hidratación SSR:** sin `mounted` extra — `useCart` ya inicia `ids=[]` y puebla desde
  localStorage en `useEffect` (post-hidratación), así que el estado «en el carrito» solo se pinta
  tras montar (sin mismatch).
- **`CatalogView` (vitrina):** mismo toast al agregar. El **botón** del card sigue diciendo
  «Agregar» porque vive en `ListingCard` (zona compartida): queda como solicitud (abajo).

### i18n (paridad ES/EN)
Claves nuevas `catalog.inCart` («En el carrito»/«In cart»), `catalog.addedToCart`
(«Agregado al carrito»/«Added to cart»), `catalog.viewCart` («Ver carrito»/«View cart»).

### Tests
- `CardDetailView.test.tsx` (4): agregar → CTA por pieza + toast + persistencia; segundo clic →
  `push('/checkout')` sin re-agregar; pieza ya en carrito al montar → estado inicial correcto (y
  toast vacío); ejemplar no vendible sigue deshabilitado.
- `CatalogView.test.tsx` (1): toast con enlace al carrito al agregar desde la vitrina.
- `e2e/catalog.spec.ts`: +2 tests en «Compra · ficha de carta» (feedback y estado tras recarga).

### Solicitud pendiente (otro stream / arquitecto de streams)
`ListingCard` necesitaría una prop tipo `inCart?: boolean` (+ label alterno del CTA) para que la
vitrina muestre también el estado «En el carrito» en el botón del card; hoy solo la ficha lo hace.


## 2026-08-17 · M5 admin: rechazos de buylist (contrato v1.18-buylist-rejects)

### Qué cambió (`(admin)/admin/m5/M5View.tsx`)
- **Pestaña «Rechazadas» (transversal):** consume `GET /admin/buylist/rejected-items` (query
  propia, `enabled` solo con la pestaña abierta; paginación simple server-side con
  `page/pageSize/total`). Muestra carta (nombre/set/acabado), vendedor legible, motivo,
  `rejectedAt` y los DOS plazos del server: devolución hasta `returnDeadlineAt` (7 días, a costo
  del vendedor) y abandono en `abandonDeadlineAt` (30 días). La **fase** (en plazo de devolución /
  en ventana de abandono / vencido) se deriva en el front de `now` vs esas fechas (helper local
  `rejectPhase`), como manda el contrato — las fechas mismas SIEMPRE vienen del server.
  **Sin acción «Convertir a inventario»** en esta pestaña (PROJECT criterio 16 / §M5: una
  rechazada no-NM jamás es convertible, ni vencidos los plazos); en el detalle de solicitud el
  botón también se oculta para ítems `rechazada` (antes salía deshabilitado).
- **Rechazo con motivo:** «Rechazar» abre un mini-diálogo con motivo obligatorio (3–500,
  validación en cliente que espeja el 400 del backend; el error real del server se muestra dentro
  del diálogo) y aviso de que el vendedor recibirá correo con motivo y plazos. Envía
  `{ decision: 'reject', reason }`.
- **Dinero (SEC-A1):** la cabecera muestra `quotedTotalCents` y, cuando llega,
  `approvedTotalCents` — ambos TAL CUAL del server (que ya excluye rechazadas); la UI no suma
  nada. En el detalle, el ítem rechazado sale con la cotización tachada + badge «Fuera del
  total · no se paga» + motivo/fecha/plazos.
- **Vendedor legible:** `seller.name · seller.email` como identidad primaria (v1.18); el UUID
  queda en `title` (tooltip) y se conserva el enlace a la ficha 360° M6 (`?user=<id>`). El
  buscador ahora también matchea nombre/correo del vendedor. Fallback al `userId` si el DTO no
  trae `seller`.
- **Orden y fecha:** el listado se muestra tal cual llega (el server ordena `createdAt` desc,
  NORMA v1.18 — sin re-ordenar en cliente) y cada solicitud muestra su fecha de creación con
  `formatDate` (mismo formato que el resto del admin).

### API client (zona compartida, cambio serializado autorizado — SOLO aditivo)
- `src/lib/api.ts`: `getAdminRejectedBuylistItems({page,pageSize,userId})` (real + rama mock que
  deriva de fixtures y espeja orden `rejectedAt` desc / plazos 7d/30d); `decideBuylistItem` acepta
  `reason` y en mock valida 3–500 (400 `VALIDATION_ERROR`) y fija `rejectedAt`/plazos/anula
  `approvedPriceCents`; sellers mock locales (`MOCK_SELLERS`) para enriquecer fixtures sin tocar
  `mock/fixtures.ts`.
- `src/types/contract.ts`: `AdminSellerRef`, `RejectedSellItemDTO`, campos de rechazo en
  `SellItemDTO`, `seller?` en `AdminBuylistDTO`, `reason?` en `BuylistItemDecisionInput` (§11).

### i18n / tests / e2e
- Claves nuevas `admin.m5.*` (`tabs.rechazadas`, `created`, `approvedTotal`, `reject*`,
  `rejectedOutOfTotal`, bloque `rejected.*` con fases y paginación) — paridad ES/EN verificada
  (`i18n-parity.test.ts` en verde).
- `M5View.test.tsx`: 17 tests (diálogo de motivo + validación + error 400 del server en el
  diálogo, pestaña Rechazadas con fases/plazos/sin convertir, vendedor con UUID en tooltip,
  fecha de creación, total aprobado del server). `api.test.ts`: reject sin motivo → 400 mock;
  reject con motivo → plazos +7d/+30d y aparición en `rejected-items`; rama REAL: URL/query de
  `rejected-items` y body `{decision,reason}` del PATCH.
- `e2e/admin.spec.ts`: +2 tests M5 (diálogo de motivo; pestaña Rechazadas sin convertir),
  verificado con `--list`.

### Gates
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` ✓ (44 archivos / 329 tests).

## 2026-08-18 · Guest checkout — comprar sin cuenta (stream «Órdenes y dinero», contrato v1.21-guest-checkout)

> Alcance implementado: **checkout de invitado** en `(storefront)/checkout` + **vista pública de
> seguimiento** `/[locale]/pedido`. PROJECT §J/§J.1 (criterios 45–56b), contrato **§4-G**,
> DESIGN_SYSTEM **§15**. NO se tocó `backend/` ni `docs/API_CONTRACT.md`.

### Pantallas y componentes nuevos (todos junto a su ruta, no en `components/` compartidos)
| Archivo | Qué es |
|---|---|
| `checkout/CheckoutView.tsx` (modificado) | Conmutador de las dos naturalezas del checkout **en la misma ruta**: con sesión = flujo de cuenta intacto; sin sesión = `GuestCheckoutView`. |
| `checkout/GuestCheckoutView.tsx` | Contenedor del flujo de invitado: cotización, gate, formulario, destino, pago, confirmación. |
| `checkout/CheckoutIdentityGate.tsx` | §15.2 — las tres vías (invitado / iniciar sesión / crear cuenta) inline, con "Cambiar". |
| `checkout/GuestCheckoutForm.tsx` | §15.3 — contacto (correo + lectura de vuelta), envío MX, destino, términos, resumen de errores. |
| `checkout/VaultUpsellPanel.tsx` | §15.4 — upsell inline de bóveda (nunca error), con salida en positivo. |
| `checkout/InlineAuthPanel.tsx` | Login/registro inline **sin navegar** (ver "Por qué no se reusó `AuthForm`"). |
| `checkout/GuestOrderConfirmation.tsx` | §15.5 — confirmación + reclamo post-compra (`AccountClaimOffer` incluido). |
| `checkout/guest-validation.ts` | Validación local (correo, erratas de dominio, `GuestAddressInput` del contrato). |
| `checkout/support-contact.ts` | Correo de soporte para pantallas sin DTO (ver solicitud 1 al arquitecto). |
| `pedido/page.tsx` + `pedido/layout.tsx` | Ruta pública con **chrome reducido** (logo + LocaleToggle) y `noindex, nofollow` + `referrer: no-referrer`. |
| `pedido/TrackingPageClient.tsx` | Token del query → **body** del POST + `history.replaceState`; estados loading/neutral/error. |
| `pedido/PublicOrderTracking.tsx` | §15.6 — vista de datos mínimos (superficie de seguridad). |
| `pedido/TrackingLinkNeutralState.tsx` | §15.7 — **una sola pantalla** para todos los fallos de token, con reenvío neutro. |
| `pedido/tracking-status.ts` | Mapa `GuestOrderPublicStatus` → versalita i18n + pasos del stepper (§4-G.5). |

### Endpoints consumidos (tal cual el contrato §4-G; ninguno inventado)
`POST /checkout/guest/quote` · `POST /checkout/guest/session` · `POST /orders/guest/track` ·
`POST /orders/guest/resend-link` · `POST /orders/claim` (tras el registro del reclamo).
`GET /orders/claimable` queda implementada en `lib/api.ts` pero **sin UI en este stream** (el banner
"tienes N pedidos por reclamar" vive en `/orders`, fuera del alcance acordado).

### Decisiones de implementación que conviene conocer
- **Criterio 46 por construcción:** el estado del formulario de invitado vive en `GuestCheckoutView`,
  **por encima** del gate; el carrito sigue en `localStorage`. Cambiar de vía no desmonta nada ni
  navega, así que ni el carrito ni los datos capturados se pierden (hay test unitario y E2E).
- **Criterio 48 (upsell, no error):** el radio de bóveda **nunca** está `disabled`/`aria-disabled`;
  al elegirlo se expande el panel y el botón de pago se bloquea con **texto explicativo**
  (`aria-describedby`), no mudo. Si el backend devolviera `422 VAULT_REQUIRES_ACCOUNT`, el `catch`
  **abre el upsell** en lugar de pintar error (doble red: proactiva + reactiva).
- **Criterios 51/52/53 (superficies de seguridad):** la vista pública pinta **solo** la lista cerrada
  de §15.6 — en particular **no** se pintan `emailMasked`, `recipientNameMasked` ni
  `postalCodeMasked` aunque el DTO los traiga. Cualquier rechazo del token (404 / 410 / **429** /
  cualquier `< 500`) y también "sin token en la URL" caen en la **misma** pantalla neutra, con el
  mismo texto; solo un 5xx/red muestra el error genérico con reintentar (sin eco de `errorCode`).
- **Confirmación no adivinable:** se pinta desde el estado de la transacción; el `orderId` solo se usa
  para `POST /orders/claim` y nunca se muestra ni entra en la URL. El `return_url` de Stripe (3DS con
  redirección) apunta a `/{locale}/pedido?token=…` con el `trackingToken` que devolvió el checkout
  (§4-G.2): es la única forma de que el invitado recupere su pedido si el navegador pierde estado.
  El token **no** se persiste en `localStorage` ni se loguea.
- **`guestPaid` en `CheckoutView`:** al limpiar el carrito tras pagar, y al crear cuenta desde el
  reclamo, la vista habría conmutado (carrito vacío / sesión nueva) y habría desmontado la
  confirmación. Por eso el "ya pagó como invitado" manda sobre ambas condiciones.
- **Por qué NO se reusó `components/domain/AuthForm`:** navega al terminar
  (`router.push(destForRole(...))`) y no expone `onSuccess`, así que dentro del checkout expulsaría
  al usuario de `/checkout` — justo lo que §15.2 prohíbe. `InlineAuthPanel` usa las **mismas**
  funciones (`login`/`register` de `lib/api`) y el **mismo** `GoogleSignInButton`; no duplica lógica
  de sesión. Alternativa futura (fuera de este stream, toca zona compartida): añadir `onSuccess?` y
  un modo compacto a `AuthForm` y hacer que `InlineAuthPanel` lo envuelva.
- **Barra sticky de pago en móvil (§15.3) NO implementada** a propósito: duplicaría el botón de pago
  y §15.9 exige que solo uno reciba foco. El `aside` ya queda al final del flujo en móvil. Si ux-ui
  la quiere, pido que defina el comportamiento de foco.

### Zonas compartidas tocadas (solo adiciones; nada existente cambia de comportamiento)
- `src/types/contract.ts`: bloque **aditivo** al final con los DTOs de §4-G + `shippingFeeCents?` en
  `BreakdownDTO` (campo opcional que el contrato v1.21 añade; los shapes previos no cambian).
- `src/lib/api.ts`: sección **aditiva** al final (6 funciones nuevas + mocks marcados). Solo se tocó
  la lista de imports de tipos.
- `src/components/ui/AmountBreakdown.tsx`: renglón de **envío** que se pinta **solo si**
  `breakdown.shippingFeeCents != null`. En bóveda y retiros el campo no viene ⇒ desglose idéntico al
  de v1.20 (el test existente del componente sigue verde sin cambios).
- `messages/{es,en}.json`: claves nuevas `checkout.identity/guest/destination/vaultUpsell/confirmation`,
  `track.*`, `track.neutral.*` (copy **normativo** de §15.7 literal), `status.tracking.*` y 4 códigos
  de error. Paridad ES/EN verificada por `i18n-parity.test.ts`.
- `e2e/checkout.spec.ts`: los casos del checkout **con cuenta** ahora hacen `loginAs` antes (sin
  sesión esa ruta es, por diseño, el checkout de invitado).

### `/checkout` deja de ser ruta privada (cambio en zona compartida, AUTORIZADO por el orquestador)
- **`src/components/layout/PrivateRouteGuard.tsx`: se quitó `'/checkout'` de `PRIVATE_PREFIXES`.**
  Con `/checkout` en la lista, en modo real (`NEXT_PUBLIC_USE_MOCKS=false`) un visitante **sin
  sesión** era redirigido a `/login?next=/checkout` y los **criterios 45/46 quedaban rotos**. En modo
  mock el guard es inerte, por eso la suite E2E daba verde igual (verde engañoso).
- **Por qué NO es una relajación de seguridad:** el criterio 45 exige que un visitante sin cuenta
  llegue al checkout y pague, y el contrato §4-G hace `@Public()` los endpoints `/checkout/guest/*`;
  es requisito de producto. El guard es una **conveniencia de cliente** —como dice su propio
  comentario, el **backend sigue siendo la autoridad**— y `/vault`, `/orders` y `/shipments` siguen
  guardados; cualquier llamada privilegiada sigue devolviendo `401`. El flujo con cuenta no cambia.
- **Anclaje de la regresión (modo REAL, no mock):**
  `app/[locale]/(storefront)/checkout/checkout-public-route.test.tsx` monta el guard con
  `config.useMocks = false` y verifica que `/checkout` y sus subrutas se montan **sin** redirección,
  que con sesión se comportan igual, y que `/vault`/`/orders`/`/shipments` **siguen** redirigiendo.
  Verificado a mano: reintroducir `'/checkout'` en el array pone ese test en rojo (2 casos).
- **Efecto colateral en un test preexistente:** `components/layout/PrivateRouteGuard.test.tsx` tenía
  el caso "preserva el destino en `next` … (/checkout)", que afirmaba justo el comportamiento
  derogado. Se cambió **solo ese caso** a `/shipments` (misma intención, prefijo que sigue siendo
  privado) con una nota que apunta al test ancla. No se tocó nada más de `components/`.

### Ambigüedades detectadas (reportadas, NO resueltas por mi cuenta)
1. **Contrato vs. diseño — reenvío de enlace: RESUELTO por arbitraje (v1.21.1 + §15.7 corregida).**
   Lo que reporté (el formulario de un solo campo de §15.7 chocaba con `{email, orderNumber}` de
   §4-G.4) lo arbitró el arquitecto a favor del contrato y ux-ui reescribió §15.7 con las **dos
   vías**. Mi implementación se realineó al texto normativo — ver "Realineación con §15.7" abajo.
2. **Contrato vs. diseño — teléfono.** §15.3 lo marca **opcional**; `GuestAddressInput` (§4-G.1) lo
   pide obligatorio (10 dígitos MX). Se implementó **obligatorio** (manda el contrato).
3. **`recipientName` y `acceptedTerms`** los exige el contrato y el diseño no los describe: se
   añadieron como campo obligatorio y casilla de aceptación explícita, con copy propio.
4. **`name` en el registro inline.** §15.4 dice "no se pide nada más" que correo + contraseña, pero
   `POST /auth/register` (§1) exige `name`. Se pide, **prellenado** con el nombre del destinatario.
5. **Reclamo inmediato vs. `emailVerified`.** §15.5 dibuja éxito inmediato tras crear la cuenta;
   §4-G.9 exige `emailVerified` (403). Implementado: se intenta el reclamo y, si responde
   `EMAIL_NOT_VERIFIED`, se muestra "verifica tu correo y vincúlalo desde tu historial"
   (`checkout.confirmation.claim.needsVerification`), nunca un error rojo.
6. **Estados públicos sin copy en §15.6.** El enum de §4-G.5 tiene 9 valores y la tabla de diseño
   solo 7: añadí `status.tracking.pendingPayment` y `status.tracking.inReview` (neutros, sin nombrar
   "contracargo").

### Solicitudes al arquitecto (no bloquean; NO edité el contrato)
1. **Correo de soporte antes de tener el DTO.** `support.evidenceContact` solo existe dentro de
   `GuestOrderTrackingDTO` (§4-G.3), pero la **confirmación** (§15.5) y el **estado neutro** (§15.7)
   lo necesitan sin token. Hoy vive centralizado en `checkout/support-contact.ts` con el valor
   normativo del contrato. Petición: exponerlo en un endpoint/campo público de configuración.
2. **URL de rastreo de paquetería.** El DTO trae `carrier` + `trackingNumber` pero no un patrón de URL
   confiable: la guía se pinta como **texto copiable**, no como enlace (misma política que
   `certNumber`). Si se confirma el patrón, se vuelve enlace.
3. **`GET /orders/claimable` sin superficie.** Queda lista en `lib/api.ts` para el banner de "pedidos
   por reclamar" en `/orders`; conviene decidir en qué stream se implementa.

### Mocks (claramente marcados, todos con el shape del contrato)
`lib/api.ts` — `computeGuestBreakdown` (réplica de `computeDirectShipBreakdown`), envío
`MOCK_SHIPPING_FEE_CENTS=17500` (el valor real viaja en el `BreakdownDTO`), y para
`trackGuestOrder`: token con `expired`/`revoked` → 410, token que empieza con `mock` → pedido demo,
cualquier otro → 404 `INVALID_TOKEN`. `createGuestCheckoutSession` replica
`422 VAULT_REQUIRES_ACCOUNT` y `422 ADDRESS_NOT_MX`. El backend sigue siendo la autoridad.

### Gates
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ · `npm run test` ✓ (49 archivos /
366 tests) · `npx playwright test` ✓ **60/60** en modo mock (incluye los 9 nuevos de
`e2e/guest-checkout.spec.ts`, que cubren §J.1: camino feliz, upsell, correo inválido, token
manipulado vs. expirado con texto idéntico, reenvío neutro con enfriamiento y ES/EN).


## 2026-08-18 (2ª ronda) · v1.21.1 — `checkoutToken` de 120 min + §15.7 corregida

### 1. Renombre CONTRACT-BREAKING: `trackingToken` → `checkoutToken` (+ `checkoutTokenExpiresAt`)
- `types/contract.ts` · `GuestCheckoutSessionResponse`: el campo pasa a **`checkoutToken`** y se
  añade **`checkoutTokenExpiresAt`** (ISO). Actualizado también el invariante §4-G.0-5 del comentario
  de cabecera.
- `lib/api.ts` · `createGuestCheckoutSession`: doc y **mock** al día
  (`checkoutToken: mock-<orderId>-checkout-token`, `checkoutTokenExpiresAt = ahora + 120 min`). No
  quedó **ninguna** referencia viva al nombre viejo (solo dos menciones históricas en comentarios,
  marcadas como "antes `trackingToken`").
- Consumidor: el `return_url` del 3DS en `GuestCheckoutView` usa `session.checkoutToken`.

### 2. La SEMÁNTICA nueva, reflejada en la UX (§4-G.7a)
- **El token del checkout vive 120 min y nunca viaja por correo.** El enlace de 90 días lo emite el
  webhook del settle y llega **solo** por correo. Verificado que la confirmación **no invita a
  guardar ni marcar como favorito** esa URL: su mensaje es `emailSentTo` ("te enviamos la confirmación
  y el enlace de seguimiento a {email}"), y no muestra ni ofrece la URL del checkout.
- **Aviso nuevo `track.temporaryLinkNotice`** en la vista de seguimiento: si `tokenExpiresAt` cae
  dentro de los 120 min + 10 de holgura (`isShortLivedCheckoutToken`, en `pedido/tracking-status.ts`),
  se avisa de que ese enlace es temporal y que el duradero llega por correo, con "Reenviar el enlace a
  mi correo" a la vista. El enlace de 90 días **no** dispara el aviso. Es solo copy: no cambia el
  acceso, y se apoya en el campo que §15.6 ya destina a eso. El texto dice "en unas horas" (agnóstico
  al valor exacto, coherente con los 120 min).
- **Camino de "volver pasadas las 2 h" verificado:** cae en `TrackingLinkNeutralState` y desde ahí el
  reenvío funciona (vía A con el propio token vencido). Cubierto con E2E dedicada.

### 3. Realineación con `DESIGN_SYSTEM §15.7` (corregida por ux-ui)
- **Copy normativo literal, ES y EN**, reemplazando el mío: el `body` y —lo importante— el `result`:
  *"Si **esos datos** corresponden a un pedido, enviamos un enlace nuevo a ese correo…"*. Mi versión
  anterior condicionaba sobre **el correo** ("si hay un pedido asociado a ese correo"), que enmarca la
  respuesta como una afirmación sobre esa dirección; la normativa condiciona sobre los datos en
  conjunto y no insinúa nada. **La vía A usa exactamente la misma frase** (hay test que compara el
  texto de ambas vías carácter a carácter).
- **Inventario de claves alineado con §15.11:** `track.neutral.*` = `title`, `body`, `emailLabel`,
  `submit`, `result`, `cooldown`, `claimAlternative`, `support`, **`noLinkCta`**, **`manualIntro`**,
  `orderNumberLabel`, `orderNumberHelp`, **`incompleteForm`** (+ `cooldownAnnounce`, exigido por el
  párrafo de accesibilidad de §15.7). Se retiraron mis nombres propios `noLinkToggle`,
  `orderNumberRequired` y `emailInvalid`: la validación local usa **una sola** nota normativa
  (`incompleteForm`), que cubre tanto "falta el dato" como "correo mal formado".
- **Vía B conforme:** tras *disclosure* (`aria-expanded`/`aria-controls`, cerrado por defecto cuando
  hay token); **ningún campo por separado habilita el envío** (el botón está `disabled` hasta tener
  correo válido **y** número de pedido); `<fieldset>` + `<legend>` (= `manualIntro`), labels visibles,
  `autocomplete="email"` en el correo y **`off`** en el número de pedido; `aria-invalid` +
  `aria-describedby` a la nota local en los campos que falten (conservando la ayuda del campo de
  pedido en el `describedby`); foco al primer campo al abrir el disclosure.
- **Validación 100% local, confirmado:** el número de pedido solo se comprueba "no vacío"; no hay
  llamada al servidor en `blur`, ni autocompletado, ni comprobación de existencia. La única petición
  es el `POST /orders/guest/resend-link` al enviar.
- **Frases prohibidas (lista ampliada) verificadas por test:** el render no contiene
  "no encontrado", "no existe", "no coinciden", "incorrecto", "no está registrado", "token",
  "expiró hace N", ni plazos en días.

### Gates de esta ronda
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ (`/[locale]/checkout` y `/[locale]/pedido`
presentes) · `npx vitest run` ✓ **50 archivos / 373 tests** · `npx playwright test` ✓ **62/62** en modo
mock (2 E2E nuevas: enlace de checkout vencido → pantalla neutra que sí reenvía, y enlace de 90 días
sin aviso de temporalidad).

## 2026-08-18 · Cotizador unificado con Master Set (mode="quoter") + fix foco M5

### Tarea 1 — `mode="quoter"` en el binder COMPARTIDO de Master Set

**Qué cambió.** `BuylistView.tsx` (raw) ya NO tiene su propio grid de búsqueda plano: monta
`<MasterSetPanel mode="quoter" onAddToSellCart={...} />` (mismo componente que M1/bóveda,
§4.20f). Cada carta muestra sus **casillas por acabado** derivadas de `card.availableFinishes`
(nunca un chip de texto, nunca una casilla para un acabado que la carta no tiene); clic en una
casilla agrega esa combinación (carta, acabado) al carrito de VENTA con el precio ya cotizado.
graded/sealed (sin variantes por acabado — cotizan siempre en `normal`) CONSERVAN el grid plano
anterior sin cambios, incluida "Filtrar por set"/"Buscar carta" y el bulk multi-selección.

**Sin cambio de contrato.** `mode="quoter"` NO agrega ningún endpoint: compone client-side con
los MISMOS tres endpoints públicos que ya usaba el cotizador — `GET /buylist/sets`,
`GET /buylist/cards` (troceado en TODAS sus páginas antes de resolver — ver bug P-4a abajo) y
`POST /buylist/quote/batch` (troceado en lotes de `BUYLIST_QUOTE_BATCH_MAX`). La lógica vive en
`fetchQuoterIndex` (`MasterSetIndex.tsx`) y `fetchQuoterBinder` (`MasterSetBinder.tsx`), paralelas
a `fetchIndex`/`fetchBinder` existentes. `MasterSetVariantDTO.quote` (`types/contract.ts`) es un
campo ADITIVO documentado como "solo frontend, NO viaja del backend" — no toca `API_CONTRACT.md`.

**Bug de paginación (P-4a, confirmado con Pitch Black · 120 cartas).** Antes el cotizador cortaba
en 20 cartas sin control. `fetchQuoterBinder` acumula TODAS las páginas de `GET /buylist/cards`
(pageSize 50) antes de resolver la promesa del binder, así que el set completo se ve de una vez
— **decisión de diseño, no el patrón "Cargar más" de M1View**: para un set >20 cartas
multi-acabado esto dispara varias llamadas a `batchQuote` al abrir el set (ej. 120 cartas ×
2 acabados ≈ 5 llamadas de 50). Es correcto y simple, pero si algún set crece mucho más
(cientos de cartas) valdría la pena revisar si conviene paginación explícita — anotado, no
bloqueante.

**Decisiones de producto tomadas sin volver a preguntar (AUTO, a revisar si no convencen):**
- El multi-selección (bulk) del grid plano **NO existe para raw**: cada casilla del binder ya es
  su propia acción de un clic: no hace falta un paso de selección previo. Sigue existiendo para
  graded/sealed (sin tocar).
- "Filtrar por set" / "Buscar carta" del enunciado se resuelven con los controles PROPIOS de
  Master Set: `MasterSetIndex` aporta "Buscar set" (elegir un set) y `MasterSetBinder` ahora
  tiene un "Buscar carta" nuevo (SOLO en `quoter`, nombre/número dentro del set elegido). La
  etiqueta exacta difiere ("Buscar set" vs "Filtrar por set" del enunciado) pero la función es
  equivalente; no se duplicaron labels para no fragmentar el sistema de i18n del binder
  compartido.

**Archivos.** `components/master-set/mode.ts` (+`'quoter'`), `MasterSetIndex.tsx` (fetch +
oculta completitud/piezas/orden en `quoter`), `MasterSetBinder.tsx` (fetch + `QuoterCell` nueva:
casillas-botón con precio, "Buscar carta" local, oculta filtros de huecos/secret rare en
`quoter`), `MasterSetPanel.tsx` (prop `onAddToSellCart`), `types/contract.ts`
(`MasterSetVariantDTO.quote?`), `(storefront)/buylist/BuylistView.tsx` (monta el panel en raw;
`CartLine.card` se angostó a `{id,name,number,imageSmallUrl}` — ya no requiere el `CardDTO`
completo del catálogo).

**Tests.** `MasterSet.test.tsx` +4 (dos acabados → dos casillas independientes; un acabado → sin
hueco vacío; 120 cartas → todas visibles sin "Cargar más"; clic agrega al carrito con el precio
correcto de esa combinación). `BuylistView.test.tsx` reescrito: el describe `raw` ahora navega
por el binder Master Set; graded/sealed quedó en su propio describe con el grid plano y el bulk
intactos; carrito/KYC/gating/F5/"Mis solicitudes" sin cambios de fondo (mismos textos i18n,
mismos precios de fixtures — solo cambió CÓMO se llega a tener algo en el carrito).

### Tarea 2 — bug real: el textbox de motivo de rechazo perdía el foco (M5)

**Causa raíz.** `components/ui/Modal.tsx` tenía un solo `useEffect` que hacía
`ref.current?.focus()` Y registraba el listener de Escape, con `[open, onClose]` como
dependencias. `onClose` (`closeReject` en `M5View.tsx`) es una función NUEVA en cada render del
padre (no memoizada) — cada tecleo cambia `rejectReason` → M5View re-renderiza → `onClose` cambia
de referencia → el efecto se re-dispara → `ref.current?.focus()` vuelve a enfocar el **wrapper**
del modal, robándole el foco al `<input>` a media escritura.

**Fix.** Se separó en dos efectos: el foco inicial depende SOLO de `open` (se enfoca una vez al
abrir, nunca en cada re-render); el listener de Escape sigue dependiendo de `[open, onClose]`
(re-suscribirse ahí es inofensivo, no roba foco). Cambio confinado a `Modal.tsx`; no se tocó
`M5View.tsx` — el mismo bug existía potencialmente en cualquier otro modal con un `footer` que
referencia una función inline del padre (p. ej. los otros modales de M5, M1, M6…), así que el fix
en el componente compartido los corrige a todos de una vez.

**Test.** `M5View.test.tsx` +1 (`userEvent.type` de varias letras seguidas sobre "Motivo del
rechazo"; falla sin el fix con solo el primer carácter registrado, pasa con el fix).

### Gates
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ · `npm run test` ✓
(45 archivos / 346 tests, incluye los 17 tests preexistentes de `M5View.test.tsx` + 1 nuevo).

## 2026-08-18 · T1/T2/T3 — casillas por variante real, copy de inventario admin, alta concluyente

Tercera ronda sobre el mismo bug (rama `fix/variantes-y-orden-master-set`). El PO pidió, textual:
«en el master set son dos cartas de cada una: la común a la izquierda y la holo a la derecha» — es
decir, una casilla de IMAGEN por variante real, no un chip de texto con etiqueta de acabado.

### T1 — Una casilla de imagen por variante (`MasterSetBinder.tsx`, `CellDrawer.tsx`)

**Qué cambió.** `BinderCell` y `QuoterCell` ya NO pintan una sola imagen + chips de texto por
acabado debajo: pintan **una casilla de imagen por entrada de `cell.variants`**, lado a lado, en
el orden de `FINISH_ORDER` (normal izquierda, reverse holo derecha, contrato v1.22 — el backend
garantiza ese orden y que `|casillas| = |availableFinishes| ≥ 1`, nunca relleno). Las N casillas
de una celda usan la MISMA `cell.imageSmallUrl` (pokemontcg.io no publica arte por acabado; el
contrato lo deja explícito: NO hay `imageByFinish`). Cada casilla lleva su etiqueta de acabado en
mono debajo de la imagen y su estado (conteo si `covered`, «HUECO» si no — atenuada + borde
punteado), así que nunca hay que adivinar cuál casilla es cuál. Una carta con una sola variante
pinta UNA sola casilla (sin hueco fantasma de relleno). Aplica también a `VariantSlots` en
`CellDrawer.tsx` ("Casillas por acabado").

**Rejilla responsive.** El binder calcula `slotCols = max(variants.length)` de las celdas
visibles y baja un escalón de columnas por cada casilla extra (`gridColsForSlots`): 1 casilla →
`grid-cols-2 sm:3 lg:4 xl:5` (como antes); 2 casillas → `grid-cols-1 sm:2 lg:3 xl:4`; así la
imagen de cada casilla no se encoge ilegible en móvil cuando el set tiene cartas multi-acabado.
Todas las celdas comparten el MISMO `slotCols` (vía `style={gridTemplateColumns}`) para que el
binder se lea como una retícula uniforme aunque cada celda tenga distinto nº de variantes.

**Orden — `@/lib/cardOrder.ts` (nuevo).** Contrato v1.22: `CardDTO`/`MasterSetCardCellDTO` ganan
`numberSort`/`numberPrefix` (columnas persistidas, M-26) y el `ORDER BY` correcto es
`(numberPrefix, numberSort, number, id)` — el front NUNCA re-ordena por número tras recibir la
página, pero SÍ debe reproducir ese orden al filtrar LOCALMENTE (el binder ya filtraba por
acabado/huecos/secret-rare/nombre en cliente). `compareCardNumber` implementa ese comparador;
`deriveNumberParts` lo deriva en cliente como red de seguridad si el backend todavía no manda las
columnas (marcadas `?` en el tipo a propósito — ver nota de tipos abajo). El cotizador
(`fetchQuoterBinder`, compuesto 100% client-side) también usa estas claves en vez del índice del
arreglo que usaba antes (`numberSort: idx` quedaba mal para sets con promos intercalados).

**Nota de tipos (decisión de frontend, no de contrato).** `numberSort`/`numberPrefix` se
declararon `?` opcionales en `types/contract.ts` en vez de requeridos: la norma v1.22 los hace
normativos, pero mientras el re-sync/backfill (M-26) no haya corrido en TODAS las filas — y para
no obligar a tocar decenas de fixtures/tests ajenos a este bug en todo el repo — el tipo tolera su
ausencia y `cardOrder.ts` cae a `deriveNumberParts`. Cuando el campo llega, manda él. No es un
relajamiento del contrato: es tolerancia de despliegue documentada in situ.

### T2 — Copy de admin: inventario, no carrito (`CellDrawer.tsx`, `MasterSetPanel.tsx`, i18n)

Regla del PO: el carrito NO aplica a admin. Se renombró TODO el copy de M1 que hablaba de
"carrito" a lenguaje de inventario/alta/lote, en `es.json` y `en.json` (namespace `masterSet`
únicamente — `catalog.addToCart`/`buylist.cartTitle` son carritos DE VERDAD y no se tocaron):

| Antes (`masterSet.*`) | Ahora |
|---|---|
| `quickAddTitle` "Alta rápida al carrito" | `quickIntakeTitle` "Alta rápida al inventario" |
| `addToCart` "Agregar al carrito" | `addToInventory` "Dar de alta al inventario" (alta INMEDIATA) + `addToBatch` "Agregar al lote" (encola, alta por lote) |
| `addedToCart` "Agregado al carrito de captura." | `addedToBatch` "Agregada al lote de alta." |
| `cartTitle`/`cartSummary`/`cartRemove`/`cartSubmit`/`cartClear` | `batchTitle`/`batchSummary`/`batchRemove`/`batchSubmit`/`batchClear` (mismo copy de fondo, "carrito"→"lote") |

`masterSet.buyCta`/`buyAdded` ("Agregar al carrito de compra") NO se tocaron a propósito: es el
CTA de `user_vault_self` para comprar una pieza faltante — un carrito de COMPRA de verdad, del
cliente, no de admin.

### T3 — El botón de alta ahora es concluyente y visible

**Diagnóstico (confirmado, no supuesto).** La mutación de alta SÍ funcionaba — el bug no era de
red ni de lógica de negocio. Era de FLUJO: (1) "Agregar al carrito" solo ENCOLABA la línea; el
botón que REALMENTE hacía POST (`batchCreateItems`, "Dar de alta N piezas") vivía en
`MasterSetPanel.tsx`, renderizado DEBAJO de toda la cuadrícula del binder; (2) el modal del
drawer (`CellDrawer.tsx`) se quedaba abierto tapando la pantalla con el overlay, así que ese
segundo paso quedaba invisible detrás del overlay y al final de la página — para el operador,
"presiono y no pasa nada".

**Solución — el lote vive DENTRO del modal, en su pie fijo.**
- `Modal.tsx`: el diálogo ganó un layout `flex flex-col` con altura acotada
  (`max-h-[100dvh] sm:max-h-[90vh]`); el `title`/header y el `footer` quedan `shrink-0` (fijos) y
  el `children` scrollea (`overflow-y-auto`). Antes un drawer largo (muchos campos + piezas +
  ajuste) desbordaba la ventana y el `footer` quedaba fuera de la vista sin scrollear — exactamente
  el síntoma que reportó el PO. Cambio en el componente COMPARTIDO: beneficia a todos los modales
  con `footer` largo (M1/M5/M6…), no solo a éste.
- `CellDrawer.tsx` gana `BatchFooter`: pinta, DENTRO del `footer` fijo del modal, el desenlace del
  lote — banner de éxito/error tolerante por-línea (`PerLineErrors`) Y, si hay líneas pendientes,
  el resumen + botón "Dar de alta N piezas" / "Vaciar lote". El operador ve el resultado SIN
  cerrar el modal y SIN hacer scroll.
- `QuickAddSection` ahora ofrece DOS acciones, ninguna ambigua: **"Dar de alta al inventario"**
  (primaria) — encola la línea Y envía el lote en el MISMO clic (`queueAndSubmit`), para el caso
  común de una sola carta; **"Agregar al lote"** (secundaria) — solo encola, para seguir
  capturando varias cartas antes de confirmar (alta por LOTE, P-5 de `PENDIENTES.md`, se
  conserva). `MasterSetPanel.tsx` expone ambas como `CaptureBatchState` (`capture.ts`), un objeto
  compartido entre el panel (dueño del `useMutation`/`batchKeyRef`) y el drawer (que solo lo lee y
  dispara).
- **Éxito falso corregido.** Antes `QuickAddSection` hacía `setAdded(true)` incluso si
  `onAddToCart` era `undefined` (nunca ocurría en la práctica porque el padre siempre lo pasaba,
  pero era una trampa: la UI mentía si algún día faltara el callback). Ahora sin `batch` cableado
  no hay botones de alta que fingir — la sección no tiene ninguna ruta de "éxito" sin una
  mutación real detrás.
- **Error visible corregido.** Antes `submit.isError` pintaba un banner en `MasterSetPanel.tsx`,
  AL FONDO de la página — con el modal abierto, tapado por el overlay. Ahora, si el drawer está
  abierto, el error (y el resultado) se pintan en `BatchFooter` (el banner del panel se omite
  mientras `openCell` esté seteado, para no duplicar el aviso); si el drawer está cerrado, el
  banner del panel sigue ahí como antes.
- **Idempotencia intacta.** `queueAndSubmit` reusa la MISMA `batchKeyRef` de la sesión
  (`ensureBatchKey`) — un reintento por timeout sigue siendo replay idempotente en el backend. El
  lote viaja como ARGUMENTO de `submit.mutate(lines)` (no se lee `cart` del closure dentro de
  `mutationFn`), porque React agrupa el `setState` del mismo tick: sin este cambio, la línea recién
  agregada en el mismo clic de "Dar de alta al inventario" se habría perdido de la primera llamada.
  `PlatformPiecesSection` (publicar/ajustar) no se tocó — su idempotencia por batchKey ya estaba
  bien y es independiente de este lote.

**Verificado en navegador (stack real, no mocks) — evidencia:**
- `UPDATE "Card" SET "availableFinishes"='{normal,reverse_holo}' WHERE name='E2E Reverse Bird'`
  (luego el backend la sembró así de forma permanente): en `/es/buylist` → «E2E Base Set» y en
  `/es/admin/m1` → Master Set → «E2E Base Set», «E2E Reverse Bird» (#17) es la ÚNICA carta con
  DOS casillas de imagen lado a lado (NORMAL izquierda, REVERSE HOLO derecha); las demás 5 cartas
  muestran UNA sola casilla.
- Clic en "Dar de alta al inventario" sobre «E2E Charizard» (con precio) → banner
  "1 piezas creadas · 0 líneas con error." + folio `INV-000001` visible DENTRO del modal, sin
  cerrarlo; confirmado además contra la API (`GET /admin/inventory/items?cardId=...`) que la
  pieza existe de verdad (no solo optimista en UI) y que el conteo de la celda subió en vivo.
  Clic sobre «E2E Reverse Bird» en `reverse_holo` (sin precio de referencia) → banner
  "0 piezas creadas · 1 líneas con error." + "Esta carta tiene precio pendiente…" — también
  DENTRO del modal, mismo comportamiento concluyente para el camino de error.

### Archivos
`components/master-set/MasterSetBinder.tsx` (casillas por variante, `slotCols`, orden local con
`cardOrder.ts`), `CellDrawer.tsx` (`VariantSlots` con imagen por variante, `BatchFooter`,
`QuickAddSection` con alta inmediata/por-lote), `MasterSetPanel.tsx` (`CaptureBatchState`,
`queueAndSubmit`/`submitBatch`/`clearBatch`, banner del panel oculto si el drawer está abierto),
`capture.ts` (+`CaptureBatchState`), `components/ui/Modal.tsx` (pie fijo + cuerpo scrolleable),
`lib/cardOrder.ts` (nuevo), `types/contract.ts` (`CardDTO`/`MasterSetCardCellDTO` +=
`numberSort?`/`numberPrefix?`), `messages/{es,en}.json` (copy de inventario, namespace
`masterSet`), `MasterSet.test.tsx` (+5: dos tests de T3 alta inmediata éxito/error dentro del
modal; un test de T1 conteo de imágenes 2 vs 1; tests existentes de "Agregar al carrito" migrados
a "Agregar al lote").

### Solicitud al arquitecto (pendiente, no bloqueante)
Ninguna nueva. Sigue vigente la de la ronda anterior: confirmar si al backend le conviene exponer
`numberSort`/`numberPrefix` como NO opcionales en el DTO ya con M-26 desplegado (el frontend ya
tolera su ausencia por diseño, así que esto es solo para que el contrato deje de decir "aditivo
opcional" si en la práctica ya siempre viajan).

### Gates
`npm run typecheck` ✓ · `npm run lint` ✓ · `npm run test` ✓ (50 archivos / 381 tests).

## Fix de producción — pieza muerta en carrito viejo NO bloquea el checkout (2026-08-18, contrato v1.21.3-quote-prune, rama `fix/carrito-pieza-muerta`)

Los dos quotes (§4 y §4-G.1) ahora resuelven POR ÍTEM y devuelven `200` con
`unavailableItems: UnavailableCartItemDTO[]` (siempre presente). El front cumple su "deber de
contrato": **poda del localStorage** los ids muertos antes de llamar a session (que sigue
estricta, anti double-sell) y muestra un aviso informativo. Además el carrito local gana
**expiración a 30 días** (nota de frontend del contrato, complementa la poda).

### Formato de storage del carrito (`lib/cart.ts`)

- **v2:** `tcg.cart = { ids: string[], updatedAt: number }` (epoch ms de la última modificación).
  `add`/`remove`/`prune`/`clear` refrescan `updatedAt`; **leer NO lo refresca** (si leer contara
  como "tocar", un carrito abierto a diario jamás expiraría distinto… pero tampoco expiraría el
  aviso de 30 días de un carrito que solo se mira; se decidió que solo MODIFICAR cuenta).
- **Expiración:** al leer, si `now - updatedAt > 30 días` (estrictamente MÁS de 30 días — a los
  30 exactos sigue vivo), el carrito se limpia y se persiste vacío.
- **Migración suave:** el formato v1 era un array JSON plano. Un array plano (o un objeto con
  `ids` pero sin `updatedAt` numérico) se trata como carrito VÁLIDO y se re-persiste en v2 con
  `updatedAt = now` en esa misma lectura. **Nunca** se descarta un carrito por cambio de formato;
  el costo es que un carrito legado "renace" con timestamp fresco una única vez.
- **`prune(ids: string[])`** nuevo en `useCart`: poda en lote con la misma semántica de storage
  que `remove` (mismo write + evento), pero **idempotente**: si ningún id sigue en el carrito no
  escribe ni emite — clave para poder llamarlo desde un efecto sin ciclar la re-cotización.

### Dónde vive el estado del aviso (`(storefront)/checkout/unavailable-notice.ts`)

Mini-store de módulo (`useSyncExternalStore`) y NO estado de componente, por dos razones:
1. el aviso debe **sobrevivir a la re-cotización** (la poda cambia `cart.ids` → la queryKey
   cambia → el siguiente fetch trae `unavailableItems: []`); 2. debe sobrevivir al **desmonte de
   la vista que lo produjo** — si TODO el carrito murió, `CheckoutView` desmonta
   `GuestCheckoutView` y pinta el EmptyState, y el aviso tiene que seguir junto al carrito vacío.
Se limpia al cerrarlo (X del banner) o al salir del checkout (cleanup de `CheckoutView`).
`pushUnavailableNotice` dedupea por `inventoryItemId` (idempotente ante re-fetches).

### Vistas (`CheckoutView.tsx` / `GuestCheckoutView.tsx`)

- Efecto idempotente tras cada quote: `pushUnavailableNotice(unavailableItems)` +
  `cart.prune(ids)`. Sin ciclo: el fetch posterior a la poda trae `[]` y el efecto es no-op.
- `UnavailableItemsNotice` (nuevo, carpeta checkout) usa `Banner variant="info"`
  (`role="status"`, regla fina neutra, tinta muted — informativo, NO bermellón ni `alert`).
  Copy i18n en `checkout.unavailable.*` (ES/EN): con nombre si `cardName` viene, genérico si es
  `null`, plural con lista de nombres si son varias. Se renderiza **FUERA de `QueryState`**
  (bajo el título) para que no desaparezca durante el loading de la re-cotización.
- **Carrito 100 % muerto:** la poda vacía el carrito → `CheckoutView` pinta el EmptyState
  existente MÁS el aviso; nunca la pantalla de error genérico ni "Reintentar" (los quotes ya no
  devuelven `404`/`409` globales). No hay mini-cart lateral en la app (el header solo muestra el
  contador `useCart().count`), así que no hubo nada más que podar.
- Mocks (`lib/api.ts`): los dos quotes mock devuelven `unavailableItems` (id ausente de los
  fixtures ⇒ `cardName: null`) y **breakdown en CEROS** si todo murió (guest incluye
  `shippingFeeCents: 0`). El caso "existe pero fuera de venta" (`cardName` poblado) no se modela
  en fixtures; lo cubren los tests de vista con el API mockeado y el backend real.

### F-2 (veredicto techlead, misma rama) — carrera "pieza vendida ENTRE el quote y el pago"

La session sigue estricta (anti double-sell): si la pieza muere DESPUÉS del quote y el usuario
paga, `createCheckoutSession`/`createGuestCheckoutSession` responde `409 ITEM_UNAVAILABLE` (o
`404 NOT_FOUND`) y antes eso era un callejón sin salida (solo el mensaje genérico junto al botón).
Ahora el catch de `pay()` en AMBAS vistas, para esos dos códigos, dispara **`query.refetch()`**:
el re-quote trae la pieza en `unavailableItems` y la maquinaria ya construida (efecto de poda +
`UnavailableItemsNotice`) poda el localStorage y avisa sola.

**Decisión de UX:** con el re-quote en marcha, el banner ES el aviso — NO se pinta además el
`payError` genérico junto al botón (evita el doble mensaje contradictorio "esta carta ya no está
disponible" + banner "se quitó de tu carrito"). **Respaldo si el refetch falla:** se setea
`payError` con el mensaje del error original y, además, el quote queda en estado de error, así que
`QueryState` pinta su aviso con "Reintentar" — nunca una pantalla muda. El manejo de los demás
códigos NO cambió (`EMAIL_NOT_VERIFIED` → banner de verificación; `VAULT_REQUIRES_ACCOUNT` →
upsell de bóveda).

### Tests

`lib/cart.test.ts` +8 (migración v1→v2 sin pérdida, expiración >30d, 30d exactos se conserva,
refresh de timestamp en add/remove/clear, prune en lote e idempotente, `{ids}` sin timestamp).
`checkout/CheckoutUnavailable.test.tsx` +5 (invitado: 1 muerta con nombre + 2 vivas ⇒ banner con
nombre, renglones vivos y storage podado; cierre del aviso; invitado todas muertas ⇒ EmptyState +
aviso plural sin error/reintentar; con cuenta: mismo par de casos, incl. `cardName: null` ⇒ copy
genérico). Tests preexistentes que asserteaban el array plano de `tcg.cart` se actualizaron al
formato v2 (`.ids`).
**F-2:** +3 en `CheckoutUnavailable.test.tsx` (con cuenta y de invitado: session rechaza
`ITEM_UNAVAILABLE` ⇒ se re-cotiza, banner con nombre, renglón y localStorage podados, sin
`role=alert` ni modal Stripe; y el caso "el refetch de respaldo también falla" ⇒ QueryState en
error con "Reintentar", nunca mudo).

### Gates
`npm run lint` ✓ · `npx tsc --noEmit` ✓ · `npm run build` ✓ · `npx vitest run` ✓
(52 archivos / 394 tests, +16 nuevos en la rama).

---

## WS «Sellado / Producto cerrado» (v1.23-sealed-sales) — rama `claude/sellado-producto-cerrado`

Implementa la superficie de front del **producto SELLADO** según contrato §2-S, §3 (`GET /vault/sealed`),
§M1 (`GET /admin/vaults/:userId/sealed`) y §M2 (`GET/PUT /admin/pricing/sealed-spreads`). **Solo venta**
(no hay buylist de sellado). Todo el consumo va por los DTOs del contrato; el precio del sellado lo
resuelve el backend (`override > mercado×spread > PRICE_PENDING`), el front nunca lo calcula.

### Pantallas / componentes creados
- **`(storefront)/sellado`** (`page.tsx` + `SealedShopView.tsx`): ventana de tienda. UNA cuadrícula
  filtrable por set / presentación (`sealedSubtype`) / condición (`SealedCondition`) + orden. Muestra
  SOLO stock (`GET /catalog/sealed`), agrupando piezas idénticas en una tarjeta con **«N disponibles»**,
  imagen TCGCSV (`imageUrl`, fallback a la de catálogo) y precio «desde» (`fromPriceCents`). Incluye el
  **call-out mailto anti-buylist** a `contacto@tcgvaultmx.com` (copy del front, no un endpoint). Estados:
  cargando (skeletons), vacío («aún no hay sellado en stock»), error (QueryState + reintentar).
- **`(storefront)/sellado/[inventoryItemId]`** (`SealedDetailView.tsx`): ficha. Condición visible al
  comprador (mint / «Detalle menor en caja»), valor de mercado informativo, **selector de cantidad**
  (carrito **por-pieza**: agrega las N piezas más baratas del grupo, `listings` ordenados asc) y CTA
  `accent`. El **destino recibir/bóveda se decide en el checkout existente** (§4/§4-G) — nota explícita,
  sin duplicar flujo. Reusa `CartAddedToast` y `useCart`.
- **`SealedValueTrend.tsx`** (feature-flag `sealed_value_trend`): tendencia de valor estilo acciones
  (`GET .../value-history`), gráfica recharts + delta. **Cableado apagado limpio:** se monta solo si
  `SealedGroupDetailResponse.trendEnabled`; si el endpoint responde 404 (`FEATURE_DISABLED`/`NOT_FOUND`)
  el componente se **oculta** (`retry:false`, `isError → null`), nunca error ni curva fabricada.
- **`SealedRestockForm.tsx`** (feature-flag `sealed_restock_alerts`): «avísame cuando vuelva»
  (`POST .../restock-subscriptions`). Se monta solo si `restockEnabled`; ante 404 `FEATURE_DISABLED`
  se oculta. Respuesta **neutra** (mismo mensaje de éxito siempre; no revela existencia del producto).
- **`components/domain/SealedVaultPanel.tsx`**: pestaña «Sellado» de bóveda, **compartida** entre cliente
  (`mode="self"` → `GET /vault/sealed`) y admin (`mode="admin"` + `userId` → `GET /admin/vaults/:id/sealed`).
  Lista con imagen, condición, cantidad y valor de mercado; total valuado a referencia + `pendingPriceCount`
  (piezas sin mercado marcadas «precio pendiente» y excluidas del total, misma base del portafolio §3).

### Integraciones en vistas existentes (reuso, sin duplicar)
- `StorefrontHeader`: nueva entrada de nav **«Sellado»** (pública) → `/sellado`.
- `(storefront)/vault/VaultView`: tercera pestaña **«Sellado»** junto a «Piezas»/«Master set»
  (`SealedVaultPanel mode="self"`).
- `(admin)/admin/vaults/VaultsView`: al abrir la bóveda de un cliente, dos pestañas **«Cartas»**
  (binder master-set existente) / **«Sellado»** (`SealedVaultPanel mode="admin"`).
- `(admin)/admin/m1/M1View`: captura de **`sealedCondition`** en el alta (individual y por lote), default
  `mint`; `listPriceCents` pasó a **opcional** (v1.23: el backend auto-precia por mercado×spread; el
  override manual sigue disponible y gana). Payloads `createInventoryItem` y `batchCreateItems` mandan
  `sealedCondition` solo para `productType='sealed'`.
- `(admin)/admin/m2/M2View`: **editor de spreads de venta del sellado** (§M2), clon del editor de venta
  por rareza pero keyeado por presentación (`SealedSubtype`) + fallback global. Advierte visualmente si
  un spread queda en **0%** (badge por-fila «Sin margen» + banner global money-safe). `GET/PUT
  /admin/pricing/sealed-spreads`.

### Contrato / tipos / API
- `types/contract.ts`: `SealedCondition`, `SealedSpreadSource`, `PriceSource += tcgcsv`, `ListingDTO +=
  sealedCondition?`, `BatchInventoryItemInput/CreateInventoryItemInput += sealedCondition?`, y DTOs
  `SealedGroupDTO`, `SealedGroupListResponse`, `SealedGroupDetailResponse`, `VaultSealedGroupDTO`,
  `VaultSealedResponse`, `SealedSpreadsDTO`.
- `lib/api.ts`: `getSealedGroups`, `getSealedGroupDetail`, `getSealedValueHistory`,
  `subscribeSealedRestock`, `getVaultSealed`, `getAdminVaultSealed`, `getSealedSpreads`,
  `updateSealedSpreads`. Con ramas mock y ramas reales (`apiRequest`).
- `messages/{es,en}.json`: namespace `sealed.*`, `status.sealedCondition.*`, `nav.sealed`,
  `vault.tabs.sealed`, `admin.vaults.detailTabs.*`, `admin.m1.sealed*`/`listPriceOptional*`,
  `admin.m2.sealedSpreads.*`.

### Endpoints consumidos
`GET /catalog/sealed`, `GET /catalog/sealed/:id`, `GET /catalog/sealed/:id/value-history` (flag),
`POST /catalog/sealed/restock-subscriptions` (flag), `GET /vault/sealed`,
`GET /admin/vaults/:userId/sealed`, `GET|PUT /admin/pricing/sealed-spreads`,
`POST /admin/inventory/items` + `.../batch` (con `sealedCondition`). El checkout se reusa tal cual
(`POST /checkout/quote|session`, §4/§4-G): el sellado se compra por `inventoryItemId` como cualquier pieza.

### Mocks (pendientes de backend real, en `lib/mock/fixtures.ts`)
`mockSealedGroups` (3 grupos: box mint, etb mint, box «detalle menor en caja» por override),
`mockSealedGroupDetail`, `mockVaultSealed` (incluye un grupo sin mercado → pendiente), `mockAdminVaultSealed`,
`mockSealedSpreads` (blister a 0% para ejercitar la advertencia), `generateSealedValueHistory`. En el mock
`trendEnabled=true` / `restockEnabled=false` para ejercitar ambos caminos de feature-flag; `subscribeSealedRestock`
simula 404 `FEATURE_DISABLED`.

### Supuestos y notas para el arquitecto
- **Filtro de set en `/sellado`:** las opciones del combo de set se derivan de los grupos ya cargados
  (no hay endpoint de facetas de sellado en el contrato). Con paginación es una aproximación del universo;
  el `setId` viaja igual al backend. Si se quiere un combo completo, haría falta un `GET /catalog/sealed/facets`
  (o reutilizar `/catalog/sets`). **No es bloqueo.**
- **Paginación:** las vistas leen `{page,pageSize,total}` del contrato pero hoy muestran la primera página
  (los volúmenes de sellado son pequeños); si crece, se añade el control prev/next (patrón existente).
- Sin bloqueos para el arquitecto: el contrato §2-S/§3/§M1/§M2 fue suficiente.

### Gates (reales, esta rama)
`npx tsc --noEmit` ✓ · `npx next lint` ✓ (sin warnings) · `npx next build` ✓ (rutas `/[locale]/sellado`
y `/[locale]/sellado/[inventoryItemId]` generadas) · `npx vitest run` ✓ (52 archivos / 403 tests, sin
regresiones). No se añadieron tests unitarios nuevos en esa pasada (los flujos de sellado quedan cubiertos
por typecheck/build; QA levantará E2E).

### Saneo — tests de componente de sellado (pasada `claude/sellado-producto-cerrado`, aprobada por PO)
Cierra la brecha de cobertura marcada por QA (los componentes de sellado no tenían vitest dedicado, a
diferencia de guest-checkout/master-set). **+5 archivos / +25 tests** (total repo: **57 archivos / 428 tests**).
Mismo patrón que el resto del repo: `renderWithProviders` (NextIntl + TanStack Query), `vi.spyOn(api, …)`
para forzar carga/vacío/error/feature-flags, fixtures de `lib/mock/fixtures.ts`, `@/i18n/navigation`
mockeado a `<a>` + `push` espía. No se tocó lógica de producción (ningún test destapó bug).

- `src/app/[locale]/(storefront)/sellado/SealedShopView.test.tsx` (8): grid agrupado + «N disponibles»,
  call-out mailto `contacto@tcgvaultmx.com`, estados carga/vacío/error (con reintentar), y los tres
  filtros (presentación/condición/set) verificando el re-fetch filtrado.
- `src/app/[locale]/(storefront)/sellado/[inventoryItemId]/SealedDetailView.test.tsx` (5): condición
  mint vs. «detalle menor» + su nota, selector de cantidad que agrega las N piezas más baratas al
  carrito (`tcg.cart`), CTA «Ir al carrito» → `/checkout`, nota de destino recibir/bóveda, y grupo
  agotado (controles deshabilitados, carrito intacto).
- `src/components/domain/SealedVaultPanel.test.tsx` (4): modo `self` (imagen/condición/cantidad/valor +
  total + «precio pendiente»), modo `admin` por `userId`, estado vacío y banner de error.
- `src/app/[locale]/(storefront)/sellado/[inventoryItemId]/SealedRestockForm.test.tsx` (4): flag ON
  (CTA gateado por correo válido + confirmación neutra) y OFF (404 `FEATURE_DISABLED` → se oculta limpio),
  más error genérico que mantiene el formulario.
- `src/app/[locale]/(storefront)/sellado/[inventoryItemId]/SealedValueTrend.test.tsx` (4): flag ON
  (tendencia + selector de rangos con `1M` activo), serie vacía («recopilando historial»), y OFF con
  404 `FEATURE_DISABLED` / `NOT_FOUND` → contenedor vacío (oculto limpio). El warning de recharts sobre
  ancho/alto 0 en jsdom es benigno (mismo que en los demás tests de gráfica).

Gates de esta pasada: `npx tsc --noEmit` ✓ · `npx next lint` ✓ (sin warnings) · `npx vitest run` ✓
(57 archivos / 428 tests, sin regresiones).

## N-12 · Resumen de pago reactivo al destino (v1.21.4-dual-breakdown, rama `claude/pulido-checkout`)
`POST /checkout/guest/quote` ahora devuelve DOS desgloses en el mismo `200`: `breakdown` (envío
directo, con `shippingFeeCents`) y `vaultBreakdown` (destino bóveda, SIN envío). El front conmuta
el resumen «recibir ⇄ bóveda» al instante, SIN refetch (ambos vienen precomputados).
- `GuestCheckoutView` calcula `activeBreakdown = destination === 'vault' ? vaultBreakdown : breakdown`
  y lo pasa a `<AmountBreakdown>`, al total del botón «Pagar» y al `amountLabel` del `StripePaymentModal`.
  `AmountBreakdown` NO se tocó: ya oculta la línea de envío cuando `shippingFeeCents == null`.
- `shippingFeeLabel` (hint del radio «envío {amount}» + upsell «te ahorras {amount}») SIGUE saliendo de
  `breakdown.shippingFeeCents` (tarifa REAL de envío), no del vault: es cuánto se ahorra al NO enviar.
- Zonas compartidas de `frontend/src/` tocadas (serializar merge): `types/contract.ts`
  (`GuestCheckoutQuoteResponse` gana `vaultBreakdown: BreakdownDTO`, aditivo) y `lib/api.ts` (mock de
  `getGuestCheckoutQuote` devuelve `vaultBreakdown` = `computeBreakdown(subtotal)`, réplica de
  `computeCartBreakdown`; ceros sin `shippingFeeCents` para el carrito 100 % podado). `lib/mock/fixtures.ts`
  NO cambió (el quote de invitado se compone inline en `api.ts`, no desde un objeto fijo).
- Tests: se desambiguaron 2 fallos preexistentes en `GuestCheckoutView.test.tsx` (había DOS selectores de
  destino tras N-9) con `within()` acotando al formulario (`region` «DESTINO») vs. el aside
  (`complementary`); nuevo archivo `GuestCheckoutDestinationBreakdown.test.tsx` (3) cubre la reactividad.

## P-4 · Botón «Rechazar solicitud» en M5 (v1.24-buylist-request-reject, rama `claude/buylist-ordenes`)
Cierre EXPLÍCITO a nivel solicitud (`POST /admin/buylist/:id/reject`, body `{ reason?: string }`
opcional): resuelve la solicitud atorada en «Verificando» cuyos ítems ya están todos `rechazada`
pero la solicitud nunca transicionó (bug reportado por el PO). Consumo del contrato tal cual; no
mueve dinero ni envía correos.
- `src/app/[locale]/(admin)/admin/m5/M5View.tsx`: botón `destructive` «Rechazar solicitud» en la fila
  de acciones a nivel solicitud + modal de confirmación destructiva (DESIGN_SYSTEM §7.6: «rechazar
  buylist») con motivo OPCIONAL (0–500, interno, sin PII). Regla de visibilidad: se muestra sólo cuando
  la solicitud NO es terminal (`REQUEST_TERMINAL` = `pagada`/`rechazada`/`abandonada`) **y** TODOS sus
  ítems ya son `rechazada` (precondición exacta del endpoint → nunca se ofrece un botón que daría 422).
  Patrón de mutación idéntico al resto (`useMutation` + `ok()/fail()` + `refresh()` que invalida
  `['admin-buylist']`); tras éxito la solicitud cae en la pestaña «Cerradas». El `422
  REQUEST_HAS_NON_REJECTED_ITEMS` se muestra DENTRO del modal vía `useErrorMessage`/`getError`.
- `src/lib/api.ts`: `rejectBuylistRequest(id, { reason? })` (misma firma/patrón que `verifyBuylistRequest`);
  rama mock espeja el guard (idempotente si ya `rechazada`; `409 CONFLICT` sobre `pagada`/`abandonada`;
  `422 REQUEST_HAS_NON_REJECTED_ITEMS` con `details.nonRejectedItemStatuses` si queda ítem vivo).
- i18n (`messages/{es,en}.json`): `admin.m5.rejectRequest` / `rejectRequestTitle` /
  `rejectRequestConsequence` / `rejectRequestReasonLabel` / `rejectRequestReasonHint` /
  `rejectRequestConfirm`, `admin.m5.feedback.requestRejected`, y `error.REQUEST_HAS_NON_REJECTED_ITEMS`
  («quedan ítems sin rechazar»).
- Tests: `M5View.test.tsx` (+3: aparece y dispara el cierre; se oculta con ítems mixtos; 422 dentro del
  modal). Gates para archivos tocados: `npx vitest run M5View` ✓ (21/21) · `npx tsc --noEmit` ✓ ·
  `npx next lint` ✓ (sin warnings).

## P-5 · Paginación server-side + filtros en M5 «Cerradas» y M3 (v1.25-buylist-orders-pagination, rama `claude/buylist-ordenes`)
Decisión del PO: **paginar + filtrar en el servidor** (NO archivar). Contrato ADITIVO consumido tal
cual: params opcionales `q`, `from`, `to`, `minCents`, `maxCents`, `page`, `pageSize` (25/página,
recientes primero) en `GET /admin/buylist` (§M5, `status` acepta CSV) y `GET /admin/orders` (§M3);
respuesta `{ data, page, pageSize, total }`. Omitir params = comportamiento de HOY.

**Capa API (`src/lib/api.ts`):**
- `getAdminBuylist(filters?: AdminBuylistFilters)` y `getAdminOrders(filters?: AdminOrdersFilters)`
  pasan a **aceptar un objeto de params opcional** y devuelven el envoltorio `Paginated<…>` completo
  (antes retornaban `AdminBuylistDTO[]`/`AdminOrderDTO[]`; ahora las vistas leen `.data`). Serializan a
  query string vía `apiRequest` (que ya **omite** `undefined`/`''`, así no se envían params ausentes).
  `AdminBuylistFilters.status` acepta CSV (`'pagada,rechazada,abandonada'`). Ramas mock espejan los
  filtros v1.25 en memoria (status CSV → `IN`, `q` sobre folio/vendedor·folio/comprador, `from`/`to`
  sobre `createdAt`, `minCents`/`maxCents` sobre `quotedTotalCents`·`totalCents`); el **orden**
  (`createdAt desc`) lo aplica el server, el mock respeta el orden de fixtures (no re-ordena) para no
  romper los tests que dependen de él.
- **Hallazgo MENOR QA de P-4 (tipo de `rejectBuylistRequest`):** verificado — el retorno ya es
  `AdminBuylistDTO`, que **es** el tipo del DETALLE de `GET /admin/buylist/:id` en este front (mismo
  shape con `id`/`userId`/`seller`/`items`, idéntico a lo que devuelven `receive`/`verify`/`paySpei` y
  cada fila de `getAdminBuylist`). El DTO de **cliente** `SellRequestDTO` (`sellRequestId`/`ineRequired`,
  sin `seller`) sería **incorrecto** para un endpoint de back-office. Se dejó el tipo como está y se
  documentó la alineación en el docstring de la función (no había regresión que corregir).

**M5 «Cerradas» (`M5View.tsx`):** migrada a server-side siguiendo el patrón de «Rechazadas». Query
dedicada `['admin-buylist-closed', page, q, from, to, min, max]` → `getAdminBuylist({ status:
'pagada,rechazada,abandonada', page, pageSize: 25, q, from, to, minCents, maxCents })`, `enabled` solo
al abrir la pestaña. «Cerradas» y «Rechazadas» pasan a ser **botones transversales** aparte de las
etapas operativas (`M5_OP_TABS` = por_recibir/verificando/por_pagar, que **mantienen** su filtrado
client-side sobre su fetch). El buscador global existente alimenta `q` server-side cuando la activa es
«Cerradas»; controles de filtro de fecha (`from`/`to`) y monto (`minCents`/`maxCents` vía `pesosToCents`
pesos↔centavos) + paginación (prev/next/pageInfo). Conteo de la pestaña = `closedQuery.data.total` (no
se deriva ya del fetch completo, como «Rechazadas»); las otras pestañas conservan su conteo client-side.
Lista read-only (etapa terminal, sin acciones): folio + StatusBadge + vendedor (enlace M6) + fecha +
cotizado/aprobado + resumen de ítems.

**M3 Órdenes (`M3View.tsx`):** UI server-side nueva (antes DataTable sobre TODO, sin buscador). Query
`['admin-orders', page, q, from, to, min, max]` → `getAdminOrders({ page, pageSize: 25, q, from, to,
minCents, maxCents })`. Buscador `q` (folio/orderNumber + comprador; `q` server-side cubre usuario/
comprador por contrato), filtros de fecha y monto (sobre `totalCents`), paginación (prev/next/pageInfo),
estados carga/error/**vacío** (`EmptyState`). Reusa `Input`/`DataTable`/`Button`. La acción de
**reembolso** se preserva intacta (invalida `['admin-orders']`, que sigue casando por prefijo).

**i18n (`messages/{es,en}.json`, sin duplicar):** `admin.m5.filters.{dateFrom,dateTo,minAmount,
maxAmount}` y `admin.m5.closed.{empty,prev,next,pageInfo}`; `admin.m3.{searchLabel,searchPlaceholder,
empty,prev,next,pageInfo}` y `admin.m3.filters.{dateFrom,dateTo,minAmount,maxAmount}`.

- Tests: `M5View.test.tsx` (+4: «Cerradas» dispara la query con `status` CSV + `pageSize` 25; el
  buscador global alimenta `q`; filtros fecha/monto en params; paginación cambia de página) y los 3
  tests de P-4 actualizados al nuevo shape `Paginated`. `M3View.test.tsx` (+3: buscador/fecha/monto en
  params; paginación; estado vacío). Resultado real: `npx vitest run M5View M3View` → **31/31 ✓** ·
  `npx tsc --noEmit` → **✓ (exit 0)** · `eslint` de archivos tocados → **✓ (exit 0)**.
- **Solicitud al arquitecto:** ninguna — el contrato v1.25 cubre todo lo consumido. (Nota menor: si en el
  futuro se quiere un tipo de detalle distinto del de lista para `GET /admin/buylist/:id` con `closedAt`/
  `clabeMasked`, hoy no se consumen en el front y `AdminBuylistDTO` basta.)

### P-5 · pulido no bloqueante del techlead (2026-08-20)

Dos hallazgos baratos aplicados sobre el delta P-5 (el resto queda como deuda FE-35/FE-36 en `TECH_DEBT.md`).

- **Debounce de los inputs de filtro (faltaba; era un fetch por pulsación).** Hook nuevo y tipado
  `frontend/src/hooks/useDebouncedValue.ts` (`useDebouncedValue<T>(value, delayMs = 300)`; `setTimeout` +
  cleanup). Patrón: el **estado del input se actualiza inmediato** (UX responsiva) y **sólo el valor
  DEBOUNCED entra al `queryKey`/params** de la query server-side. No existía `useDebounce`/`useDebouncedValue`
  previo (los `hooks/` sólo tenían `useResendVerification`/`useSellRequirements`), por eso se creó.
  - **M3 (`M3View.tsx`):** debounce sobre `search` (`q`) y los montos `minPesos`/`maxPesos`; las fechas
    (`type=date`) siguen inmediatas (cambian de golpe).
  - **M5 (`M5View.tsx`):** debounce sobre lo que dispara RED de «Cerradas» — el buscador global (`closedQ`)
    y los montos min/max. El **filtrado client-side de las pestañas operativas** (por_recibir/verificando/
    por_pagar) **conserva el `search` inmediato** (no toca red), como pedía el techlead.
- **Fidelidad del mock de `getAdminOrders` (`lib/api.ts`, rama `config.useMocks`).** El filtro `q` del mock
  hacía `o.id.includes(q) || o.userId.includes(q)`; el backend real busca sobre `orderNumber` +
  `guestEmail` + `userId` **(exacto)** + `user.name`/`user.email`. Se alineó el mock a esos campos (folio
  del fixture = `id` como análogo de `orderNumber`, parcial; `guestEmail`/`user.name`/`user.email`
  parciales y defensivos por si el fixture/join los aporta; `userId` **igualdad exacta**, ya no `includes`)
  para no dar falsos verdes en tests de UI. La **ruta real no se tocó** (serializa params y delega en el
  server). El mock de `getAdminBuylist` **ya** filtraba sobre `id` + `seller.name`/`seller.email`
  (= `user.name`/`user.email` del contrato) → ya fiel, sin cambios.
- **Semántica de fechas `from`/`to`:** sin cambios en el front — se sigue enviando el date-only tal cual del
  `<input type=date>`; el ajuste de "fin de día inclusivo" para `to` lo hace el BACKEND en su parseo.
- **Tests:** las suites usan `waitFor` tras cambiar inputs (polling hasta 1000ms por defecto), que tolera el
  debounce de ~300ms con timers reales; el único test que verifica sincronía (filtrado client-side operativo
  de M5, «el buscador filtra por folio/usuario») sigue sobre el valor inmediato, así que no requirió fake
  timers ni cambios.

### Stream A v1.27 · P-15 (mercado por variante) + P-12 (sync completo por set) — 2026-08-21

Implementación frontend de la spec **v1.27-stream-a** (`API_CONTRACT.md` Changelog v1.27, `ARCHITECTURE.md` §4.25b/§4.25c). Sin backend vivo: validado con types + fixtures + tests de componente.

- **P-15 — precio de mercado POR VARIANTE en el binder Master Set.**
  - `types/contract.ts`: `MasterSetVariantDTO += marketReferenceMxnCents?: number | null` y
    `capturedDate?: string | null` (decoración de frescura, presente solo con precio). El campo de
    CELDA `MasterSetCardCellDTO.marketReferenceMxnCents` queda comentado **DEPRECATED v1.27**
    (espejo de `variants[0]`, retiro en la siguiente rev).
  - `MasterSetBinder.tsx` (`BinderTile`): lee `variant.marketReferenceMxnCents`. Semántica del
    fallback: `undefined` (backend rezagado que aún no emite el campo) → cae al campo de celda
    deprecado (retrocompat SOLO durante la ventana de deploy); `null` explícito → "—" honesto
    (pending, NUNCA $0). Ese era el único lector del campo de celda en `src/` (verificado por grep).
  - Fixtures (`lib/mock/fixtures.ts`): helper nuevo `mockMarketReferenceForVariant(cardId, finish)`
    que deriva precios DISTINTOS por acabado (base ×1 / reverse ×1.25 / holo ×1.6 / 1ª ed ×2.5) para
    demostrar el fix; `variantsForCell` puebla variante + capturedDate; la celda emite el espejo
    deprecado `variants[0]` (igual que el backend). NOTA mock-only: `mockReferenceForFinish` (quote
    de buylist/valuación) sigue plano por carta para no tocar los tests del cotizador — divergencia
    solo de fixtures, sin efecto de contrato.
  - Tests (`MasterSet.test.tsx`): Normal ≠ Reverse ≠ Holofoil con montos distintos; null → "—"
    (money-safe); test explícito de retrocompat (variante sin campo → lee celda).
- **P-12 — «Sync completo» por set en M2.**
  - `lib/api.ts`: `syncCatalog` acepta y manda `force?: boolean` (body pass-through).
  - `M2View.tsx`: segundo botón por fila («Sync completo», aria-label con el nombre del set) que
    encadena `syncCatalog({setId, force:true})` → al éxito `triggerPriceIngest({setId})`. Feedback
    HONESTO por fase (banner fase 1/2 y 2/2, éxito solo si el ingest encoló, warning explícito si el
    single-flight NO encoló, error diferenciado por fase; el ingest NO se dispara si falla la fase de
    cartas). Reusa la mecánica N-14 (`justDispatched` + poll de `price-sync-status`) y entra en
    `catalogBusy` (keep-alive). Las dos acciones por-set se serializan entre sí.
  - Copy corregido (es/en): `catalog.syncAllHint` y `syncAllForceConfirmBody` ya NO dicen que el
    re-sync forzado «repuebla precios» (falso desde v1.14/§4.15g) — dicen metadata + cartas +
    variantes/acabados y apuntan a «Actualizar precios ahora» / «Sync completo». Llaves nuevas
    `admin.m2.catalog.fullSync*` en ambos locales.
  - Test nuevo `M2View.test.tsx`: encadenamiento con orden verificado, single-flight honesto y
    corte de cadena en fallo de fase 1.
- **Resultado de checks:** `tsc --noEmit` ✓ · `next lint` ✓ · `vitest run` **438/438 ✓** (suite completa).
- **Solicitud al arquitecto:** ninguna — el contrato v1.27 cubre todo lo consumido.

## Stream B «Inventario M1 operable» (v1.28 · P-17/P-18/P-19/P-20/P-22/P-24/P-25) — rama `claude/backend-e2e-payment-fixtures-77mo4t` (2026-08-21)

Frontend completo del Stream B según `ARCHITECTURE.md §4.26` (a–j), `API_CONTRACT.md` v1.28 y
`DESIGN_SYSTEM.md §16`. Implementado CONTRA EL CONTRATO con mocks (`src/lib/mock/fixtures.ts`,
sección v1.28) mientras el backend aterriza sus fases; en modo real (`NEXT_PUBLIC_USE_MOCKS=false`)
todas las llamadas golpean los endpoints v1.28 tal cual el contrato.

### P-17 · M1 reorganizado (`admin/m1/M1View.tsx`)
- Pestañas **Master Set (default) · Sellado · Gradeadas**; la pestaña «Piezas» desaparece y sus
  capacidades (folio, estado, precio manual por pieza, detalle/historial, publicar/despublicar,
  merma) viven ÍNTEGRAS en el **drill-down por variante** (`VariantDrawer.tsx`): sheet lateral
  480px con header (mini + `RAW · NM · <ACABADO>` + FinishMark), CTA fijo «Alta rápida», sección
  «Precios» colapsable (abierta para super_admin) y «Piezas (N)» con selección múltiple
  (`bulk-publish` con `repriceFresh`), copiar folio/cert, edición inline de `listPriceCents`
  (PATCH) y merma (`POST /admin/inventory/adjustments`, nota obligatoria, modal destructivo).
- **Pestaña activa en la URL** (`?tab=`) vía `history.replaceState` (sin `next/navigation`:
  evita re-montar la vista y simplifica los tests).
- **Buscador por folio persistente** en el header (las 3 pestañas): resuelve con
  `GET /admin/inventory/items?q=` y abre el drawer de la variante dueña con la fila resaltada;
  folio inexistente = mensaje inline (`admin.inventory.folioSearch.notFound`), no toast.
- El alta masiva P-5 se conserva SIN cambios como **«Alta por lote»** (extraída a
  `AddItemModal.tsx`, mismo namespace i18n `admin.m1.*`, misma batchKey idempotente y error
  anclado P-4). El botón «Ubicaciones» se conservó en la toolbar (§16.1 no lo menciona, pero
  «no se pierde ninguna acción» — gestor de ubicaciones sigue siendo necesario para mover piezas).
- `MasterSetPanel`/`MasterSetBinder` (zona compartida, lock Stream B) ganan `onOpenVariant` y
  `onSetOpened` OPCIONALES: sin ellos el comportamiento previo (CellDrawer por carta) queda
  intacto — cotizador, Mi bóveda y bóvedas admin no cambian.

### P-18 · Consola de tres precios (`components/master-set/VariantPriceConsole.tsx`)
- **Compacto en la teja** (`VariantPricingCompact`, solo si `variant.pricing` viene — es decir
  solo scope `platform`): MERCADO/COMPRA/VENTA mono con sufijos `·M` (override) y `·B` (bounty,
  bermellón), `—` para pendiente (nunca $0), `aria-label` por renglón. Sustituye al renglón único
  P-15 en M1; en bóvedas de cliente (sin `pricing`) el renglón P-15 sigue.
- **Consola completa en el drawer**: sugerido/override/efectivo + fuente en versalitas
  (REGLA/MANUAL/BOUNTY/PENDIENTE), UN submit para ambas caras
  (`PUT /admin/pricing/variant-controls/:cardId/:finish` — vacío = null explícito = limpiar),
  «Restablecer a regla» por cara (PUT solo con esa cara en null), validación `> 0`, error de
  servidor anclado (P-4), «Fijar mercado» inline cuando la referencia está pendiente (reusa
  `POST /admin/pricing/override`). Edición solo super_admin (front esconde; guard impone);
  vault_operator ve texto plano.
- **Bounty (P-22a)** en la misma consola (solo raw + super_admin): switch con estado textual,
  precio explícito (error espejo `BOUNTY_PRICE_REQUIRED`), premium vs regla, objetivo opcional
  con barra de progreso, `BOUNTY COMPLETADO · fecha`, copy de apagado con historial. El error
  `BOUNTY_BELOW_RULE` interpola el sugerido vigente.

### P-19 · Alta rápida (`admin/m1/QuickAdd.tsx`) + Publicar todo (`PublishAllDialog.tsx`)
- QuickAdd: SOLO stepper de cantidad + tarjetas-radio **Comprar** (input prellenado con
  `pricing.buy.effectiveCents`, editable, helper según fuente; vacío si no hay sugerido) /
  **Aportación** (valor de mercado mostrado, NO editable, `acquisitionPct: 100` explícito;
  referencia nula ⇒ tarjeta deshabilitada con pill `PRECIO PENDIENTE` — y el 422 `PRICE_PENDING`
  del server queda como respaldo anclado sticky `role=alert`, lección P-4). Sin acabado (viene de
  la casilla), sin ubicación. batchKey por intento (rota tras éxito; retry de red = replay).
- La MISMA `QuickAddSection` la usa la pestaña Sellado con `sealedMarketRef` como referencia.
- «Publicar todo…»: modal con alcance (todo / solo este set / solo sellado) + notas de dinero,
  `POST /admin/inventory/publish-all` con batchKey idempotente, y **resultado honesto de 4
  renglones** (publicadas / ya listadas / sin precio→link a `/admin/m2?context=inventory` /
  fallidas con detalle por folio, nota de capado a 200 y nota de replay). Sin dry-run (no existe
  en contrato §16.11.1).

### P-24 / P-25 / P-20
- `InventoryValueCards.tsx`: 4 StatCards del breakdown de `GET /admin/finance/inventory-value`;
  costo en segunda línea y «N piezas sin precio» como enlace a M2 (exclusión visible). SOLO
  super_admin: para vault_operator la fila se OMITE por completo. `breakdown` es opcional en el
  tipo espejo (resiliencia mientras el backend lo aterriza: sin él solo se pinta el total).
- `SealedTab.tsx`: índice `GET /admin/inventory/sealed-sets` (DataTable con piezas/listadas/
  valor/badge `N SIN MAPEO`) → detalle por set con grupos §4.23 (pills subtipo+condición, conteos,
  `sealedMarketRef` o `SIN PRECIO DE MERCADO`, costo super_admin) con Alta rápida / Ver piezas
  (drawer `productType=sealed`, SIN consola P-18) / Publicar (bulk de folios in_stock del grupo,
  identidad recortada en cliente). Enlace «Cola de no mapeados (N)» solo super_admin.
- `GradedTab.tsx`: `GET /admin/inventory/graded` agregado por carta×empresa×grado, chip de grado
  estilo GradedCertChip SIN cert, valor por grado manual con sufijo `·M` o `SIN VALOR` +
  «Fijar valor…» inline (`POST /admin/pricing/override` con `productType:"graded"` y
  `gradeKey:"graded:<company>:<grade>"`). `AddGradedModal.tsx`: empresa+grado+cert+precio de
  compra → `POST /admin/inventory/items` (qty 1); accesible desde la pestaña y desde el
  VariantDrawer («Agregar gradeada…»). Drill-down muestra `certNumber` completo copiable.

### §16.6 FinishMark + P-22 Top Bounties
- `components/domain/FinishMark.tsx` (compartido; el Stream C lo reusa tal cual): `FinishBand`
  (3px, aria-hidden; reverse = ÚNICO gradiente permitido `#9A6C57→#B44B3A`; holos = tinta;
  normal = sin banda) + etiqueta mono `NORMAL/REVERSE/HOLO/1ED HOLO` (claves
  `finish.{normal,reverse,holo,firstEdHolo}`, no localizadas; `aria-label` legible sí). La banda
  se aplica en las tejas del binder (todas las vistas del binder) y en `BountyCard`; la etiqueta
  del acabado que ya pintaba el tile cubre el canal de texto.
- `components/domain/TopBountiesShelf.tsx` + `BountyCard`: sección «SE BUSCA / Top Bounties»
  ARRIBA de `/buylist` (antes del selector de set), `GET /buylist/bounties`, primeras 12, scroll
  horizontal móvil / grid 4-col lg. Chip `☩ BOUNTY` sobre scrim de tinta, precio héroe en verde
  («Pagamos»), `QUEDAN N` solo con objetivo real; vacía o en error NO se renderiza. CTA
  **«Cotizar esta carta»**: cotiza esa (carta, acabado) server-side vía `POST /buylist/quote/batch`
  (SEC-A1 — nunca el monto del card) y la agrega al carrito de venta con el carrito abierto
  (= «cotizador precargado» de §16.11.2, resuelto sin estado por URL).
- Badge `BOUNTY` (mono bermellón + crosshair decorativo) en la teja del binder cuando
  `pricing.bounty.enabled`.

### Zona compartida (lock §4.26i) y tipos espejo
- `types/contract.ts`: `VariantPricingDTO`/`VariantControls*`, `PublishAll*`, `SealedSet*`,
  `GradedInventory*`, `InventoryValueBucketDTO`+`breakdown?`, `PublicBounty*`;
  `MasterSetVariantDTO.pricing?`; `BatchInventoryItemInput.acquisitionCostCents` (documentado por
  v1.28 §M1) e `InventoryItemDTO.sealedCondition` (espejo v1.23 que faltaba, lo usa la identidad
  de grupo sellado). `lib/api.ts`: `putVariantControls`, `publishAllInventory`,
  `getSealedInventorySets/Set`, `getGradedInventory`, `getPublicBounties`, filtros
  `finish`/`productType` en `getAdminInventory`, `acquisitionCostCents` en el alta. Las ramas
  mock replican validaciones del contrato (422 `BOUNTY_PRICE_REQUIRED`/`BOUNTY_BELOW_RULE`/
  `FINISH_NOT_AVAILABLE`, PRICE_PENDING por línea, idempotencia por batchKey).

### i18n y tests
- Claves §16.10 en `es`/`en` (paridad verificada por `i18n-parity.test.ts`):
  `admin.inventory.*`, `admin.pricing.console.*` (fuente `source.manual` para override, según
  spec), `admin.quickAdd.*`, `admin.publishAll.*`, `admin.drawer.*`, `admin.bounty.*`,
  `buylist.bounties.*`, `finish.{reverse,holo,firstEdHolo}`, `error.BOUNTY_*`,
  `masterSet.bountyBadge`.
- Vitest: 512 pruebas verdes (66 archivos). Nuevas: `FinishMark.test` (doble canal),
  `VariantPriceConsole.test` (compacto ·M/·B/—, guardar ambas caras, restablecer=null,
  validaciones, bounty, lectura operador), `QuickAdd.test` (prellenado, aportación pct 100,
  bloqueo PRECIO PENDIENTE, 422 anclado), `PublishAllDialog.test` (resultado honesto, replay,
  fallos por folio), `TopBountiesShelf.test` (oculta vacía/error, QUEDAN N honesto),
  `VariantDrawer.test` (piezas por variante, bulk-publish honesto, PATCH precio, certs).
  `M1View.test` REESCRITO al layout P-17 conservando la cobertura del alta P-5/P-4 (trigger
  «Alta por lote») y moviendo detalle/merma al drawer. `MasterSet.test` y `BuylistView.test`
  ajustados mínimamente (el «—» ahora aparece por cara; «Pikachu ex» también vive en la vitrina).
- Playwright: `e2e/inventory-stream-b.spec.ts` (folio→drill-down, pestañas Sellado/Gradeadas,
  Top Bounties) + `e2e/admin.spec.ts` actualizado a P-17 — verdes en modo mock. **Nota QA:**
  hay 13 fallos E2E PRE-EXISTENTES en la rama (verificado contra un worktree de HEAD sin mis
  cambios): `buylist.spec.ts` (8: describen el grid plano raw pre-v1.21 — el raw hoy es el binder
  quoter y no monta «Buscar carta»), `master-set.spec.ts:88` (asume 2 imágenes por celda,
  pre-N-16), `catalog.spec.ts:11`, `i18n-locale.spec.ts:10` y `guest-checkout.spec.ts:67/80`.
  No los toqué (drift previo, no es del stream); quedan para su dueño/QA.

### Desviaciones conscientes y solicitudes al arquitecto
1. **Kebab por fila → iconos directos** en el drawer (§16.4.4): no existe componente Menu en el
   DS; mismas 3 acciones (detalle/publicar·despublicar/merma) como icon-buttons con `aria-label`.
   «Agregar gradeada…» vive como acción secundaria DEL DRAWER (a un clic de la teja) en vez de
   kebab en la teja (la teja es un solo botón; anidar menús rompería la semántica).
2. **Cola de no-mapeados**: el enlace apunta a `/admin/m2` (la vista dedicada
   `GET /admin/pricing/sealed/unmapped` no existe aún en el frontend de M2 — es del stream de
   precios). *Solicitud:* confirmar dueño de esa vista.
3. **`SealedInventoryGroupDTO` sin imagen**: §16.8 pide «imagen ancla» pero el DTO no trae
   `imageSmallUrl`; se pinta placeholder (icono Package). *Solicitud al arquitecto:* campo
   `imageSmallUrl?` aditivo en el DTO del grupo si se quiere la imagen real.
4. **Dry-run de publish-all**: no existe en contrato; la confirmación describe alcance/reglas y
   la honestidad va en el resultado (ya registrado en §16.11.1).
5. **`summary.selected` de publish-all**: el contrato no fija si incluye las ya-listadas; el
   front solo pinta los 4 renglones del diseño (no usa `selected`), así que cualquier semántica
   backend es compatible.

## Ronda de corrección Stream B (gate techlead, 2026-08-21)

Rechazo acotado del techlead sobre M1/consola; los tres MAYORES y los menores quedan corregidos:

- **M-1 (consola stale tras guardar):** `VariantPriceConsole` ahora mantiene el pricing
  RESUELTO en estado local — sembrado por el prop y actualizado con
  `VariantControlsResponse.pricing` de cada write (efectivo/fuente/bounty nuevos sin reabrir;
  también re-siembra los inputs y el estado del bounty). El drawer ya no descarta la respuesta:
  pasa `onChanged` para refrescar agregados del binder. Tests en `VariantPriceConsole.test`
  («M-1: tras guardar…») y `VariantDrawer.test`.
- **M-2 («Publicar grupo» sellado truncaba a 100):** el mutation pagina server-side hasta
  agotar la carta (pageSize máx 100 del contrato) y trocea el bulk-publish al cap de 200 líneas
  con sufijo determinista por trozo (`<key>-0`, `<key>-1`, …) sobre una clave base en `useRef`
  REAL (el objeto literal por render que rompía la idempotencia quedó eliminado); la clave solo
  se limpia al éxito, así el reintento replayea idempotente. El toast reporta el agregado real.
  En el drawer, la lista de piezas declara el truncado con el conteo real
  (`admin.drawer.truncated`: «Mostrando {shown} de {total}…»). Tests nuevos en
  `SealedTab.test.tsx` (paginado+troceo, reuse de batchKey en reintento, grupo sin elegibles).
- **M-3 («Fijar mercado» fallaba en silencio y fabricaba respuesta):** `fixMarket` ahora
  comparte el banner de error ANCLADO del patrón P-4 (mismo `errorRef` que `save`), y su éxito
  dispara `onChanged()` (refetch real del dueño) en vez de fabricar un
  `VariantControlsResponse` falso para reusar `onSaved`. `onSaved(res)` queda reservado al
  payload íntegro del PUT variant-controls. Se endureció además el botón «Fijar» (exige monto
  > 0, no solo no-vacío). Tests del caso de error y del éxito (onChanged sí, onSaved no).
- **Menor `gradeKey`:** `VariantPriceConsoleProps` es ahora una unión discriminada —
  `productType='graded'` EXIGE `gradeKey` a nivel de tipo (fuera el default mágico
  `graded:PSA:10`); raw usa la clave canónica del contrato `raw:NM`. El drawer solo monta la
  consola graded cuando hay `gradeInfo`.
- **MENOR-1 QA:** `BuylistRuleApplied.source` ampliado a `"rule"|"fallback"|"bounty"|"override"`
  (contrato v1.28 §6; ningún consumidor hacía switch exhaustivo — cambio aditivo seguro).
- **MENOR-2 QA:** la nota de E2E preexistentes decía «12»; son 13 (corregido arriba).
- **SB-D8:** `FinishBand` deja los hex hardcodeados y usa tokens vivos con fallback
  (`var(--color-neutral-warm|--color-accent|--color-ink, <hex del DS §16.6>)`), mismo criterio
  que `PortfolioTrendChart`, antes de que el Stream C esparza el patrón.

Deuda pendiente de registrar en `docs/TECH_DEBT.md` cuando el backend suelte el archivo (esta
ronda no lo toca): (1) heading «Piezas (N)» del drawer cuenta las filas RECORTADAS en cliente,
no el total server-side cuando hay truncado (el indicador nuevo lo mitiga); (2) el troceo >200
del publish de grupo no es transaccional entre trozos (un fallo intermedio publica parcial; el
reintento con la misma clave lo repara por replay).

## P-21 · Rebrand TCG HUNT (DESIGN_SYSTEM §17 v1.7/v1.7.1) — rama `claude/backend-e2e-payment-fixtures-77mo4t` (2026-08-21)

La marca visible pasa de «TCG VAULT MX» a **TCG HUNT** (tcghunt.mx). Sin rediseño: la dirección
papel/tinta 5a queda intacta; cambia el acento y entra el logo de mira.

**Tokens (§17.2):** `--color-accent/warning/danger/focus-ring` cambian de VALOR (`#B44B3A` →
`#B31217`, bermellón retirado — mismo nombre de token, cero migración de consumidores). Nuevos
`--hunt-*` (red, wine, wine-up, red-hover, red-up, red-deep, tint) de uso restringido a marca.
`FinishBand` (banda reverse) y `PortfolioTrendChart` heredan por token — solo se alinearon sus
FALLBACKS hex al DS. Botones accent/destructive: hover pasa de `brightness-95` a
`--hunt-red-hover` (#8F0E12, 8.3:1).

**Fuente de marca (§17.1e):** Montserrat 700 vía `next/font/google` como `--font-brand` en
`[locale]/layout.tsx` (self-hosted, junto a serif/sans/mono); clase `font-brand` en tailwind con
fallback `var(--font-sans)` (Archivo). Exclusiva del wordmark: no entra en la escala de §3.

**`<LogoTcgHunt />`** (`components/domain/LogoTcgHunt.tsx`, geometría v1.7.1 — retícula con cruz
segmentada, anillos en 4 arcos con gaps cardinales, punto aislado, wordmark dominante):
variantes `lockup` / `lockup-dark` / `mark` / `mark-dark` / `micro` (+ export `HuntMarkMicro`).
Ids de gradiente por instancia con `useId` saneado (varios montajes sin ids duplicados).
`decorative` → `aria-hidden` (el enlace porta `brand.homeAria`). En el DOM el SVG usa
`var(--font-brand), Montserrat, Archivo…` (el nombre de familia de next/font va hasheado: la
variable es la única referencia fiable).

**Dónde quedó la marca:** topbar storefront (≥lg mira 28 + wordmark tinta; <lg solo mira 28,
táctil 44px), sidebar admin (mark-dark 28 + wordmark papel; «Back-office» sigue en el
AdminTopbar), login/auth (lockup-dark en el hero de tinta + mark-dark en cabecera), `/pedido`
(mark 28 + wordmark tinta), footer legal («TCG HUNT · tcghunt.mx · © 2026 [razón social]» con
`footer.legalEntity` placeholder), metadata (`TCG HUNT — {página}`, `og:site_name`), favicon
(`app/icon.svg` + `icon.png` 32 glifo micro; `apple-icon.png` 180 solo-mira sobre papel, margen
12%), badge BOUNTY del shelf y del binder (glifo micro oficial en vez del crosshair de lucide).
i18n: `common.appName` = «TCG HUNT», nuevas `brand.name/domain/homeAria` y `footer.legalEntity`;
`legal.intro` y `sellado.buylistCallout.title` renombrados (es/en).

**Pendientes / decisiones:**
- **OG image PNG 1200×630:** el layout está listo en `public/branding/og-tcg-hunt.svg`, pero el
  export a PNG exige la fuente RESUELTA (Montserrat no está instalada en este entorno; un SVG
  con `<text>` fuera del DOM no la garantiza, §17.1e). Hasta el export, `openGraph` va sin
  `images`. Ruta sugerida: exportar cuando llegue el arte original o generar el raster en CI.
- **Cotejo con el PNG original del humano** (§17.5.1): cuando lo suba a
  `frontend/public/branding/`, comparar métricas finas y sacar wordmark en paths (outline).
- **Correos `@tcgvaultmx.com` NO tocados** (soporte/facturación/contacto en i18n, fixtures y
  fallback del contrato): son buzones operativos reales; migrarlos a `@tcghunt.mx` requiere el
  dominio de correo (devops/humano) y el fallback `evidenceContact` viene del contrato
  (arquitecto). Igual los nombres de archivo CSV `tcgvault_*` de M7/M9 (artefacto técnico,
  §17.4: el nombre interno no cambia).
- Los E2E preexistentes que asertaban copy de marca vía `t()` siguen verdes (leen messages).

Verificación: `tsc --noEmit` limpio; lint limpio; vitest 526/526 (520 previos + 6 del logo);
Playwright `inventory-stream-b.spec.ts` + `admin.spec.ts` 13/13.

## Stream C · Cotizador v2 (P-14 + P-16, DESIGN_SYSTEM §18 v1.8) — 2026-08-21

El cotizador público (`/buylist`) se redistribuye según §18: el carrito lateral fijo de 360px
desaparece y se convierte en drawer flotante disparado por un FAB con contador; la grilla
recupera todo el ancho con la MISMA densidad del binder M1; el distintivo de variante (P-14)
llega al cotizador reutilizando `FinishMark`/`FinishBand` §16.6 TAL CUAL (cero forks). Sin
cambio de contrato (§18.11.1): todo el dato ya existía.

### Componentes NUEVOS
- **`components/domain/SellCartFab.tsx`** (§18.4a): botón `fixed` abajo-derecha (56×56, radio 0,
  sin sombra, tinta/papel, borde strong), icono `shopping-cart` 20px; badge contador cuadrado en
  accent (`#B31217` por token) mono `tabular-nums`, cap visual `99+`, **omitido con carrito
  vacío** (el FAB permanece: da acceso a los requisitos de venta). `aria-haspopup="dialog"` +
  `aria-expanded` + `aria-label` dinámico (`buylist.cartFab.ariaWithCount/ariaEmpty`); el badge
  es `aria-hidden` (la cifra viaja en el label). SIN animación al agregar (§17.3); el anuncio lo
  hace el `role="status"` existente (`addedLine`). z-40 (bajo el drawer z-50, sobre el sticky z-10).
- **`components/domain/SellCartDrawer.tsx`** (§18.4b): contenedor que ENVUELVE el contenido del
  antiguo `<aside>` (no lo reescribe; recibe `children`). `≥lg` sheet derecho 400px
  (min 360/max 440, `border-l border-border-strong`, alto completo); `<lg` bottom sheet ~92vh
  (patrón `VariantDrawer` §16.4). `role="dialog"` + `aria-modal` + **focus trap propio**
  (Tab/Shift+Tab ciclan; el `Modal` base no trae trap) + Esc cierra + clic en overlay cierra +
  botón cerrar 44px; al cerrar el foco **regresa al FAB** (`returnFocusRef`). Encabezado fijo
  (eyebrow CARRITO DE VENTA + conteo + cerrar primero en el orden de foco); contenido scrolleable.

### Modificados (sin cambiar API pública)
- **`BuylistView.tsx`**: layout de UNA columna (fuera el `lg:grid-cols-[1fr_360px]` y el toggle
  textual `cartHide/cartShow`); `<main>` con `pb-24` (el FAB no tapa la última fila); FAB al
  final del contenido (orden de foco §18.8, sin tabindex positivos); abrir el modal de solicitud
  CIERRA el drawer (un solo focus trap activo — criterio permitido por §18.4b); el CTA de
  `BountyCard` sigue siendo la ÚNICA vía que abre el drawer al agregar; grid plano de
  graded/sealed alineado a la escala del binder (`2→3(sm)→4(lg)→5(xl)`, retirado el `2xl:6`);
  skeletons §18.6 con la retícula final (`CardSkeleton` ×10) en la carga del grid plano; líneas
  del carrito y resumen del modal con `<FinishMark />` (banda 3px + etiqueta mono) en vez del
  texto plano del acabado.
- **`MasterSetBinder.tsx`**: `QuoterTile` gana la `FinishBand` §16.6 como primer elemento
  (idéntica a `BinderTile`; `normal` sin banda) y el precio estimado sube de 13px a
  **`text-[15px]` mono en TINTA** (el verde «Pagamos» queda exclusivo del `BountyCard` §16.7c);
  fila de filtros locales del binder **sticky en `≥lg` SOLO en modo quoter** (`top-0`, fondo
  papel, `border-b`, z-10); skeletons de carga con la retícula final (aplica a todos los modos
  del binder — misma retícula, cero costo).
- **i18n** (`messages/es,en.json`): nuevas `buylist.cartFab.{ariaWithCount,ariaEmpty}` y
  `buylist.cartDrawer.{ariaLabel,close}`; **eliminadas** `buylist.cartShow`/`cartHide` (el toggle
  ya no existe). Paridad ES/EN verde.

### Tests
- Nuevos: `SellCartFab.test.tsx` (4: vacío sin badge + aria, contador aria-hidden, cap 99+,
  expanded/click) y `SellCartDrawer.test.tsx` (5: cerrado=nada, dialog+aria+encabezado+foco
  inicial, Esc/overlay/cerrar (y no clic interno), focus trap Tab/Shift+Tab, retorno de foco al
  FAB al cerrar).
- `BuylistView.test.tsx` actualizado al drawer: helper `openCart()` (clic al FAB) antes de todo
  assert de contenido del carrito; test del toggle colapsable reescrito como FAB→drawer (drawer
  cerrado por defecto, vacío útil con requisitos, cierre regresa foco); nuevos asserts: agregar
  desde grilla NO abre el drawer, contador del FAB por PIEZAS, FinishMark en línea del carrito Y
  en resumen del modal. 41 tests del archivo en verde.
- Playwright `e2e/buylist.spec.ts`: helper `openCart(page)` inyectado en los flujos que tocaban
  el carrito lateral (selectores sin cambio: el contenido es el mismo, ahora dentro del dialog);
  smoke NUEVO §18.11.3 (teja → badge FAB sube sin abrir drawer → drawer con `finish-band`
  reverse + etiqueta → cerrar regresa foco al FAB) — verde en mock. Los **8 fallos preexistentes
  de este spec** (describen el grid plano raw pre-v1.21, fallan ANTES del carrito en
  `searchFor`) siguen igual: no se arreglaron ni se empeoraron (siguen siendo del triage
  pendiente pre-release, junto con `master-set.spec.ts:88` — verificado corriendo buylist: 8
  failed/4 passed; master-set+inventory-stream-b+admin: 1 failed (el :88 preexistente)/15 passed).

### Decisiones / desviaciones de §18 (menores, anotadas)
1. **Copy del aria del FAB:** §18.4a ejemplifica «Carrito de venta, 3 cartas»; se usó
   `{count} carta(s)` para mantener la convención SIN plural ICU del catálogo (el helper i18n de
   los E2E no resuelve ICU y `cartCount` ya usa ese estilo). Solo afecta al aria-label.
2. **Skeletons del binder en todos los modos:** §18.6 pide skeletons en el quoter; la retícula
   es compartida con M1/bóvedas, así que el `loading` del `QueryState` del binder aplica a todos
   los modos (mismo layout, sin spinner de página en ninguno).
3. **Al abrir el modal de solicitud se CIERRA el drawer** (§18.4b deja el criterio a frontend:
   «cierra o se apila… solo un focus trap activo»): cerrar es más simple y el resumen del modal
   repite las líneas con su FinishMark.
4. **`buylist.cartDrawer.ariaLabel` interpola `{count}`** («Carrito de venta (N)») tal como pide
   §18.4b; con carrito vacío queda «(0)» (el drawer vacío sigue siendo útil).
5. La idea `source:"bounty"` en el quote público (§18.11.2) NO se implementó (registrada para
   product-owner/arquitecto, no asumida).

Gates: `lint` ✓ · `typecheck` ✓ · `vitest` **536/536** (70 archivos; 526 previos + 9 nuevos de
FAB/drawer + 1 neto en BuylistView) · `next build` ✓.

## Stream C · Ronda de corrección del gate (TL-C1/C2/C3 + SC-D2) — 2026-08-21

QA aprobó; techlead rechazó con tres hallazgos mayores, cerrados en esta ronda (sin cambio de
contrato, todo en `frontend/`):

### TL-C1 · Sticky del binder tapado por el header del storefront
- **Bug:** la barra de filtros del quoter (`MasterSetBinder`, modo quoter) era `lg:sticky lg:top-0
  z-10`, pero `StorefrontHeader` es `sticky top-0 z-40` opaco (~72px) → la barra quedaba escondida
  detrás del header al scrollear.
- **Fix (indicación del techlead):** el offset sale de la **altura real** del header vía var CSS por
  layout. `StorefrontHeader` mide su propio alto (`ResizeObserver`, cubre `py-4 ↔ lg:py-[22px]`, wrap
  y menú móvil) y expone `--app-header-h` en su **padre inmediato** (el wrapper del layout del
  storefront; se limpia al desmontar). El binder usa `lg:top-[var(--app-header-h,0px)]` — fallback
  `0px` para shells que no la definan (en modos no-quoter el sticky no se activa; si el binder
  necesitara sticky bajo el AdminShell, ese shell expondría su propia var). **Nada de `top-[72px]`
  hardcodeado en el componente compartido.**
- **Tests (jsdom no pinta sticky → se asserta el mecanismo):** `StorefrontHeader.test.tsx` (la var
  queda en px en el contenedor y se limpia al desmontar) y `MasterSet.test.tsx` (la barra del quoter
  lleva `lg:top-[var(--app-header-h,0px)]` y NO `lg:top-0`).

### TL-C2 · El focus trap del drawer se desenganchaba al desmontarse el elemento enfocado
- **Bug:** el trap vivía solo en `onKeyDown` del panel; al pulsar «Quitar» en la última línea o
  «Vaciar carrito», React desmonta el botón enfocado, el foco cae a `<body>` (sin evento — la spec no
  dispara blur/focus al remover el nodo activo) y Tab se escapaba detrás del scrim con el diálogo
  abierto.
- **Fix (opción b del techlead, `SellCartDrawer.tsx`):** dos guards mientras `open`:
  (1) **`focusin` a nivel `document`** — si el foco aterriza fuera del panel (Tab escapado desde
  `<body>`, focus programático), se reenfoca el panel; (2) **re-verificación tras cada commit**
  (efecto sin deps) — cubre la caída silenciosa a `<body>` por desmonte, que no emite `focusin`. El
  trap de Tab interno queda igual. Ambos guards se desactivan con el drawer cerrado y son inocuos en
  el cierre (el ref del panel ya es null cuando el retorno de foco al FAB dispara `focusin`).
- **Tests de regresión (obligatorio del techlead):** `BuylistView.test.tsx` — enfocar «Quitar» de la
  única línea → click → el foco queda DENTRO del diálogo (ídem «Vaciar carrito»);
  `SellCartDrawer.test.tsx` — focusin fuera → reenfoque, y desmonte del hijo enfocado → foco al panel.

### TL-C3 · Extracción FE-13 de BuylistView (compromiso «sin tercer aplazamiento»)
- Extracción **mecánica, sin cambio de comportamiento**, por la costura trazada por el techlead, a la
  misma carpeta de la ruta (no a zonas compartidas):
  - **`useSellCart.ts`** (151 líneas): `CartLine`/`QuoterCardRef`/`mergeCartLine` + cantidades +
    `expandedLines` + totales derivados (`totalEstimatedCents`, `pendingCardCount`, `cartCount`,
    `requestItems`). Handlers estables (`useCallback` + setState funcional).
  - **`SellCartContents.tsx`** (274 líneas): el bloque entre `<SellCartDrawer>` y `</SellCartDrawer>`
    (requisitos → líneas → total → CTA → vaciar), con `QuoteRow` y `ruleText`. Recibe `cart`, `sellReq`
    y handlers; el submit lo delega al dueño (cerrar drawer + abrir modal, §18.4b).
  - **`MyRequestsSection.tsx`** (206 líneas): "Mis solicitudes" + respuesta al ajuste (F5). Dueña de su
    query `['sell-requests']` (la MISMA key que invalida BuylistView al crear solicitud) y de
    `respondSellRequest`.
  - `BuylistView.tsx`: 1253 → **787 líneas** (orquestador: filtros, grid graded/sealed, bulk, binder
    quoter, bounty, modal de solicitud). MasterSetBinder, flujo bulk y gating KYC **sin tocar** (solo
    movidos de sitio donde la costura lo exigía).
- **Red de seguridad:** los 41 tests conductuales de `BuylistView.test.tsx` pasan idénticos antes y
  después de la extracción (verificado en dos corridas: post-extracción 86/86 de las 4 suites tocadas;
  final 92/92 con los 6 tests nuevos de TL-C1/TL-C2).
- **Nits pagados al pasar:** `<div>` sin función alrededor de `SellRequirementsPanel` eliminado;
  indentación del bloque movido normalizada (consecuencia de la extracción); `expandedLines` se PODA al
  quitar una línea y se resetea al vaciar (antes acumulaba entradas huérfanas).
- **SC-D3 parcial:** `addFromMasterSet` ahora es `useCallback` sobre los handlers estables del hook
  (identidad estable hacia `MasterSetPanel`); el `memo` de tiles queda como deuda SC-D3 con disparador
  «lag al teclear cantidades en set grande».

### SC-D2 · E2E `buylist.spec.ts`: 8 tests muertos migrados (0 rojos de reposo)
- Los 8 casos que asumían el grid plano en raw (pre-v1.21) se migraron sin inventar cobertura falsa:
  grid plano/bulk → **graded** (helpers `selectGraded`/`searchFor`/`addGradedCard`); acabados
  raw/pendiente/KYC → **binder quoter** (`openBaseSet`/`addFromBinder`, fixtures Base Set). El smoke
  `@real vender` descubre por graded y clica la primera fila **habilitada** (fixtures holofoil-only no
  cotizan graded en mock → fila deshabilitada por-ítem, correcta). **Estado final en mock: 12 passed /
  0 failed** (antes 8 failed / 4 passed). `master-set.spec.ts` re-verificado: 2 passed (el fallo :88
  reportado en el gate ya no reproduce). Pendiente anotado en TECH_DEBT SC-D2: en real, el smoke de
  vender valida ahora la ruta graded.

### Deuda registrada (docs/TECH_DEBT.md)
- **FE-13 → RESUELTA** (esta ronda). Nuevas: **SC-D1** (cuarto shell de diálogo a mano + scrim en
  cuarta copia — NO se implementó el primitivo en este stream, por indicación del techlead), **SC-D2**
  (resuelta, con pendiente @real anotado), **SC-D3** (memo de tiles, parcialmente pagada), **SC-D4**
  (~10 ramas por modo en MasterSetBinder → objeto de capacidades cuando llegue la próxima rama).

Gates de la ronda: `lint` ✓ · `typecheck` ✓ · `vitest` **542/542** (70 archivos; 536 previos + 6
nuevos: 2 BuylistView TL-C2, 2 SellCartDrawer TL-C2, 1 StorefrontHeader TL-C1, 1 MasterSet TL-C1) ·
`next build` ✓ · Playwright `buylist.spec.ts` en mock **12/12** ✓.

## v1.29 — Productos por variante (TCGCSV) + reglas de precio de dos ejes (2026-08-22, branch `fix/variant-composition-regression`)

Implementación **frontend** del diseño v1.29 aprobado (contrato `docs/API_CONTRACT.md` v1.29;
ARCHITECTURE §4.27 «1 carta ↔ N productos» y §4.28 rareza canónica). Backend en paralelo; el
front trabaja contra el **shape del contrato** (mocks marcados). Sin cambios de contrato.

### 1. Binder Master Set + cotizador — productos SEPARADOS por variante (§4.27)
- **Tipos (`types/contract.ts`):** nuevos `CardProductDTO` (`{ productId, kind, name, finishes[],
  prices[] }`), `CardProductKind` (`set_base | deck_exclusive | promo | other`) y
  `CardProductPriceDTO` (`{ finish, marketReferenceMxnCents: number|null, capturedDate? }`). Se
  añade `separateProducts?: CardProductDTO[]` a **`MasterSetCardCellDTO`** y a **`CardDTO`** (el
  cotizador compone el binder client-side desde `GET /buylist/cards`, así que el CardDTO propaga
  los productos separados a la celda).
- **`MasterSetBinder.tsx`:** la rejilla plana ahora mezcla dos clases de teja con un tipo
  discriminado `BinderTileItem` (`variant` | `product`). Los productos `kind ∈ {deck_exclusive,
  promo}` se pintan como **su propio producto** (`SeparateProductTile`, nuevo) con su nombre, un
  distintivo de tipo de producto (badge + renglón mono) y su **propio precio por acabado** —
  **NO fusionado** en la carta base. El set base sigue mostrando sus acabados reales
  (`availableFinishes` = universo exacto TCGCSV: p. ej. energía especial → holofoil + reverse_holo,
  **2 casillas, no 3**). Money-safe: precio ausente (`marketReferenceMxnCents == null`) → **"—"`**,
  nunca `$0` inventado.
  - Los productos separados **no participan de la completitud** del set (`expected/coveredVariantCount`
    los ignoran, como el backend), coherente con «no fusionados». Tampoco entran al filtro con/sin
    huecos (no son variantes de inventario) — solo se listan con el filtro de piezas en «todos»; el
    filtro de acabado sí aplica.
  - `SeparateProductTile` es de **presentación** (no cotizable/agregable in-situ): ver salvedad al
    arquitecto abajo (el carrito/quote del cotizador está keyeado por `(cardId, finish)`, no por
    `productId`).
- **i18n:** `masterSet.productKind.{set_base,deck_exclusive,promo,other}` («Set», «Deck Exclusive»,
  «Promo», «Otro») y `masterSet.separateProductAria` en `es.json`/`en.json`. Sin texto hardcodeado.
- **`displayFinishes` DEPRECADO** por el contrato (= `availableFinishes`); el front lo sigue tolerando
  vía `@/lib/finish` (fallback), retiro en la próxima rev.

### 2. Editor de precios M2 — reglas de DOS EJES + retiro del parche INV-1 (§4.28d)
- **Contrato nuevo `PriceRuleSet { rarityRules, finishRules, fallbackPct }`** (y su análogo de venta
  `SalesPriceRuleSet`): las reglas dejan de ser un mapa plano que mezclaba rareza y acabado. Se
  separan en **eje RAREZA** (keyeado por rareza **canónica** de la carta) y **eje ACABADO** (keyeado
  por el enum `Finish`: `reverse_holo`, `holofoil`, `first_edition_holofoil`; `normal` no lleva
  finish-rule → usa la rareza).
- **`M2View.tsx`:** las secciones 4 (buylist) y 5 (venta) se reescriben en **dos subtablas** (una por
  eje). El **parche INV-1** (preservar a mano las keys sintéticas `Holo`/`Reverse Holo` de la tabla
  cruda, comentarios ~332-336/382-385/436-438) queda **RETIRADO**: el merge del guardado parte del
  `PriceRuleSet` del servidor (que ya trae ambos ejes) y aplica el borrador por eje encima —
  `updateBuylistRules({ rarityRules: {...srv, ...draft}, finishRules: {...srv, ...draft}, fallbackPct })`.
  Ningún eje pisa al otro; no hay keys sintéticas que rescatar. Se conservan: fallbacks pct visibles
  (buylist 40 / venta 15), los guards money-safe (S-P1-1: no persistir `MX$0`) y la UX de «guardar sin
  perder reglas» (gate `!data`).
- **Rarezas canónicas:** el eje de rareza itera `GET /admin/pricing/rarities` por **`row.canonical`**
  (no un groupBy crudo) y muestra el atributo **`premium`** (badge accent) y, si aplica, **`unmapped`**
  (badge warning). `BuylistRarityRowDTO`/`SalesRarityRowDTO` ganan `canonical`, `raw?`, `premium`,
  `mapped`; `rarity` queda como alias DEPRECADO de `canonical`.
- **Filas de acabado:** una fila por finish de `FINISH_RULE_KEYS`; sin regla propia el badge dice
  «Hereda rareza» (no se persiste 0). aria-labels del eje de acabado usan «Valor/Modo **del acabado**
  {finish}» para **no colisionar** con una rareza homónima (p. ej. Eevee rareza «Reverse Holo»).
- **`api.ts` / mocks:** `get/updateBuylistRules` y `get/updateSalesRules` pasan a `PriceRuleSet`.
  Fixtures: `mockBuylistRarityRules` + `mockBuylistFinishRules` (+ `getMock…RuleSet`/`setMock…RuleSet`);
  `resolveBuylistRuleForFinish` resuelve con precedencia **finish-rule > rarity-rule > fallback**
  (reproduce el negocio vigente: reverse_holo fijo $1.50; resto → fallback 40%). El seed migra las
  viejas keys sintéticas a `finishRules`.

### Tests
- `MasterSet.test.tsx`: energía especial (holofoil+reverse_holo → **2 casillas exactas, no 3**);
  Deck Exclusive como producto aparte con su propio precio (no fusionado); promo sin precio → «—»
  (nunca `$0`); binder M1 pinta el Deck Exclusive/promo de Charizard desde fixtures; carta sin
  productos separados no pinta ninguno.
- `M2View.test.tsx`: los tests INV-1 (preservar «Holo» sintético) se **reemplazan** por tests de
  dos ejes (editar el acabado va a `finishRules` sin tocar `rarityRules`; editar la rareza preserva
  la regla de acabado del servidor). Actualizado el shape de `updateBuylist/SalesRules` a
  `{ rarityRules, finishRules, fallbackPct }`.

### Salvedad / solicitud al arquitecto (no bloqueante)
- **Cotización/carrito de un producto separado:** el diseño pide que los Deck Exclusives/promo sean
  «su propio producto **cotizable**». Hoy `POST /buylist/quote/batch` y el carrito de venta están
  keyeados por **`(cardId, finish)`** (`BuylistQuoteItemDTO` no tiene `productId`), así que un producto
  separado **no puede cotizarse ni agregarse como línea distinta** con el contrato v1.29 sin fusionarse
  con la carta base. Por eso `SeparateProductTile` es **de presentación** (nombre + tipo + precio de
  mercado propio), sin botón «Agregar». **Petición:** si se requiere cotizar/vender productos separados
  como líneas propias, el contrato del quote/carrito necesita un identificador `productId` (opcional,
  aditivo). Mientras tanto el front muestra el producto con su precio propio, money-safe.

### Gates de la ronda
`typecheck` (tsc --noEmit) ✓ · `next lint` ✓ (0 warnings) · `vitest run` **548/548** (70 archivos;
+6 nuevos de esta ronda) ✓ · `next build` ✓.

## Botón BATCH «Refrescar variantes + precios de TODO (solo TCGCSV)» en M2 (2026-08-22, rama `fix/variant-composition-regression`)

Botón GLOBAL en la sección «Sync de catálogo» de M2 (`(admin)/admin/m2/M2View.tsx`), junto a
Backfill / Importar sets nuevos / Re-sincronizar todo (forzar). Corre el mismo trabajo que la
acción por-set «Variantes + precios (solo TCGCSV)» (P-13) pero sobre **TODO el catálogo ya
importado**: repuebla variantes/acabados + precios desde **TCGCSV**, **sin re-importar cartas** y
**sin pokemontcg.io**. Sirve para backfillear la composición/precios del catálogo cuando
pokemontcg.io está caído.

> **Actualización (reconciliación con backend): el batch es ASÍNCRONO.** El backend implementó
> `refresh-variants-all` fire-and-forget (POST 202) con un endpoint de STATUS PROPIO para
> progreso/resumen. La sección de abajo refleja ese contrato final.

### Contrato consumido (modelo ASÍNCRONO)
- `POST /api/v1/admin/catalog/refresh-variants-all`, body `{ force? }` (solo se manda `force` cuando
  es `true`; body mínimo por defecto). **Responde HTTP 202** con `{ jobId, setsQueued, remaining }` —
  **NO** trae el resumen; solo arranca el barrido. Tipo `RefreshVariantsAllResponse` (redefinido a ese
  shape).
- `GET /api/v1/admin/catalog/refresh-variants-status` → `{ running, jobId, total, done, startedAt,
  finishedAt, summary }`, donde `summary = { setsTotal, setsOk, setsFailed, cardProductsUpserted,
  pricesUpserted, pending, failures: [{ setId, code, message }] }` (o `null` mientras no haya
  terminado ningún batch). Es el STATUS PROPIO del batch, **distinto** del `sync-status` de sync-all.
  Tipos `RefreshVariantsStatusResponse`, `RefreshVariantsSummary`, `RefreshVariantsAllFailure` en
  `frontend/src/types/contract.ts`. Wire `refreshVariantsAll()` + `getRefreshVariantsStatus()` en
  `frontend/src/lib/api.ts`; **mock async** en `fixtures.ts` (`startMockRefreshVariantsAll` arranca el
  estado en memoria; `readMockRefreshVariantsStatus` avanza `done` en cada lectura y al completar
  apaga `running` y adjunta el `summary` con **un** set fallido + `pending>0` para el reflejo money-safe).
- **Progreso:** se POLLEA `getRefreshVariantsStatus` (**NO** `sync-status`) cada 3 s mientras `running`,
  más una **ventana de gracia** `refreshAllDispatched` tras el POST (hasta que asome `running`, patrón
  N-14 de precios; caduca sola a 30 s). La MISMA barra accesible `SyncProgress` pinta `done/total` con
  labels propios `catalog.refreshVariantsAllSweep*`. `remote-sets` refresca cada 5 s mientras corre.

### UX / comportamiento
- **Confirmación** (operación masiva) por `Modal` — calca el modal de «Re-sincronizar todo (forzar)».
- **Progreso** en vivo desde el status del batch; banner "corriendo" mientras `batchBusy`
  (`POST pending || refreshAllDispatched || running`).
- **Resumen honesto** al terminar (leído del `summary` del status, **no** del POST): si
  `setsFailed>0 || pending>0` → Banner `warning` («resultado parcial»), si no → `success`. Muestra
  `setsOk/setsTotal`, productos, precios, pendientes y la **lista legible de `failures`** (nombre del
  set resuelto vía `remote-sets` + `setId` + motivo). Un `useEffect` gatillado por `finishedAt`
  invalida `remote-sets` + `pending-prices` al terminar.
- **Serialización:** `batchBusy` deshabilita las demás operaciones de catálogo (per-set vía
  `otherPerSetPending`; globales Backfill/Importar/Re-sync vía `disabled`) y el propio botón se
  deshabilita si **otra** operación de catálogo está en curso (`catalogBusy && !batchBusy`).
  `useKeepSessionAlive(catalogBusy)` mantiene viva la sesión durante toda la corrida.
- **Ayuda:** el `hint` deja claro que **NO** re-importa cartas ni usa pokemontcg.io; que es para
  backfillear composición/precios del catálogo ya importado.
- i18n en `messages/{es,en}.json` bajo `admin.m2.catalog.refreshVariantsAll*` (sin hardcode).

### Desalineación con el contrato (solicitud al arquitecto)
- Los endpoints `refresh-variants-all` / `refresh-variants-status` **no están en
  `docs/API_CONTRACT.md`** todavía (implementados contra el contrato reconciliado con backend).
  **Petición al arquitecto:** formalizar ambos: `POST /admin/catalog/refresh-variants-all` (body
  `{ force? }` → 202 `RefreshVariantsAllResponse`) y `GET /admin/catalog/refresh-variants-status`
  (`RefreshVariantsStatusResponse` con el `summary` agregado). Si backend ajusta nombres de endpoint
  o de campos, se alinea en un solo punto: `api.ts` + `contract.ts` (+ mock en `fixtures.ts`).

### Gates de la ronda
`tsc --noEmit` ✓ · `eslint` (archivos tocados) ✓ · `vitest run` **564/564** (70 archivos; +5 tests
del flujo batch async: POST 202 solo arranca + resumen desde el STATUS PROPIO, barra de progreso
done/total desde status, cancelar no llama, `failures`/pendientes parcial money-safe, error de arranque
legible) ✓ · `next build` ✓.

## TD-1 · Refactor de `M2View.tsx` (monolito → secciones) — refactor PURO (2026-08-22, rama `fix/variant-composition-regression`)

Paga la deuda **TD-1** (y de paso **FE-14**): `M2View.tsx` era un monolito de **2.235 líneas** con ~20
hooks y editores inline clonados. Se partió en componentes por sección **sin cambiar comportamiento, UX,
i18n, accesibilidad ni disparos de endpoint** — es refactor de ESTRUCTURA, no de features. `M2View.tsx`
quedó como **orquestador de 56 líneas**.

### Qué se extrajo (`frontend/src/app/[locale]/(admin)/admin/m2/sections/`)
- **`shared.tsx`** — helpers money-safe (`pesosToCents`, `sanitizeDecimalInput`, `isSaveableRuleValue`,
  `isEndpointMissing`), constantes (`RULE_MODES`, `SALES_RULE_MODES`, `PRICE_PROVIDERS`, `SEALED_SUBTYPES`,
  `FINISH_RULE_KEYS`) y los componentes ya-extraídos `SyncProgress` / `RowMoreMenu` (movidos tal cual).
- **`PriceIngestSection.tsx`** — Sección 1 «Actualizar precios» (disparo del ingest + barra de progreso del
  barrido de PRECIOS). Presentacional; consume el hook compartido.
- **`PendingQueueSection.tsx`** — Sección 2 (cola pendiente en dos buckets venta/compra) **+ el modal de
  override manual**. Dueña de sus queries `['pending-prices', ...]` y su mutación de override.
- **`FxSection.tsx`** — Sección 3 (FX: tasa/colchón + override + refresco Banxico). Autocontenida.
- **`PriceProviderSection.tsx`** — Sección 3b (selector de proveedor de respaldo del ingest, §19.7).
- **`BuylistRulesSection.tsx`** — Sección 4 (reglas de compra, modelo NUMÉRICO) **+ «Unificar rarezas»
  anclado a este editor (§19.5) y su modal de confirmación**. Renderiza `<RuleAxisEditor>`.
- **`SalesRulesSection.tsx`** — Sección 5 (reglas de venta, modelo TEXTO-CRUDO + validación S-P1-1).
  Renderiza `<RuleAxisEditor>`.
- **`SealedSpreadsSection.tsx`** — Sección 5b (spreads de venta del sellado por presentación).
- **`CatalogSyncSection.tsx`** — los 3 grupos §19 (Datos/Catálogo/Avanzado) + tabla ÚNICA de sets (jerarquía
  por-fila I→G→H con `RowMoreMenu`) + los spans sr-only de motivos + los modales de re-sync forzado y
  refresh-variants-all. Presentacional; consume el hook compartido.

### Dedup clave: `<RuleAxisEditor>` (colapsa los clones buylist↔venta)
Los editores de compra y venta eran clones ~1:1 del patrón **dos ejes (rareza canónica + acabado) con
borrador/efectivo/fallback**. Se extrajo un `RuleAxisEditor` **presentacional** que contiene SOLO la
estructura visual común (input de fallback, cabeceras + listas de ambos ejes, Select modo + Input valor +
Badge origen por fila, save/cancel, banners de reglas-no-disponibles/guardado/error). Las diferencias de
comportamiento que NO se pueden unificar sin cambiar semántica se mantienen en cada sección vía
**view-models de fila** (`RuleAxisRarityRow` / `RuleAxisFinishRow`) y callbacks:
- **buylist** guarda el valor **numérico** (centavos si `fixed`, número si `pct`), usa `.replace(/[^0-9.]/g,'')`
  y **PRESERVA** el valor al cambiar de modo; sin `pctHint` ni validación de vacío.
- **venta** guarda el valor como **texto crudo**, usa `sanitizeDecimalInput`, **LIMPIA** el valor al cambiar
  de modo, muestra `pctHint` y bloquea Guardar si hay un vacío/NaN (S-P1-1, `showInvalidBanner`).
El botón «Unificar rarezas» se conservó **anclado al editor de rarezas de compra** (§19.5), dentro de
`BuylistRulesSection` (no se movió al `RuleAxisEditor`). El prop `t` se pasa con scope `admin.m2.buylistRules`
o `admin.m2.salesRules` (comparten las mismas keys); es válido porque el proyecto no usa el tipado estricto
de mensajes de next-intl (`t` acepta `string`).

### Estado acoplado precio↔catálogo: hook `useCatalogSync`
La Sección 1 (precios) y `CatalogSyncSection` comparten estado por diseño y **no** son separables en dos
árboles de estado sin cambiar comportamiento: el «Sync completo» por-fila del catálogo dispara el barrido de
PRECIOS (`justDispatched` + `priceSyncStatus.refetch`), y `catalogBusy` —que gobierna `useKeepSessionAlive`—
agrega el barrido de precios Y todas las operaciones de catálogo. Todo ese estado (queries de status con sus
`refetchInterval`, ventanas de gracia N-14, mutaciones, `catalogBusy`/`batchBusy`, keep-alive, invalidaciones)
se centralizó en el hook **`useCatalogSync`**, llamado UNA vez en `M2View` y pasado como prop a las dos
secciones. Así la serialización y las invalidaciones quedan **EXACTAS**. Las invalidaciones cross-sección
(override→`pending-prices`, ingest/refresh→`pending-prices`, unify→rarezas/reglas compra+venta) siguen
funcionando porque el `QueryClient` es compartido; cada sección es dueña de sus propias queries por clave.

### Orden DOM y modales
El orden de render se conservó idéntico (h1 → S1 → S2 → S3 → S3b → S4 → S5 → S5b → grupos catálogo). Los
modales (override, unify, force, refresh-all) se movieron DENTRO de la sección dueña de su estado; como el
componente `Modal` solo monta cuando `open` y los tests los localizan por rol/texto, no hay cambio observable.

### Cero-cambio-de-comportamiento (cómo se garantizó)
Se copió el JSX **verbatim** (classNames, textos, `{' '}`, `aria-*`, `role`, ids `m2-reason-*`), se
preservaron las claves de query y las invalidaciones exactas, y **no se modificó ningún test**. La red de
seguridad son los **67 tests conductuales** de `M2View.test.tsx` (que importan `{ M2View }` e interactúan por
rol/texto) + el resto de la suite.

### Gates
`tsc --noEmit` ✓ · `next lint` sin warnings/errores ✓ · `next build` ✓ · `vitest run` **568/568** verdes
(70 archivos; M2View.test.tsx **67/67**), **sin modificar los tests**. `M2View.tsx`: **2.235 → 56 líneas**.

---

## P-29 baja rápida — `note` obligatorio + idempotencia `batchKey` (v1.35-inventory-bulk-remove-idempotency)

QA rechazó la baja rápida por un bug BLOQUEANTE: `QuickRemove.tsx` no enviaba `note`, que el backend
exige (`@IsString() note!`) ⇒ toda llamada REAL caía en `400 VALIDATION_ERROR`; los tests pasaban solo
porque los mocks omitían `note` (lo enmascaraban). El contrato subió a v1.35 y se cerró así:

- **`note` OBLIGATORIO (texto libre):** nuevo campo `Input` de nota en el control (`admin.quickRemove.noteLabel`),
  validado no-vacío (`note.trim() !== ''`). El CTA «Dar de baja» se **deshabilita** con la nota vacía (barrera
  de UI; el backend es la barrera dura). Es ADICIONAL al `reason` enum (perdida/danada/error_captura), que ya
  existía — son dos campos distintos y **ambos** viajan en el request.
- **Idempotencia `batchKey`:** se replica el patrón EXACTO de `QuickAdd`/`adjustFound` — `batchKeyRef` +
  `ensureBatchKey()` con `localUid('qrem')`: la key se genera **una vez por intento**, se **reusa en el
  reintento del mismo submit** (backend lo trata idempotente = replay, no re-baja otras N piezas ⇒ cierra el
  «encogimiento fantasma»), y **rota tras un éxito**. `idempotentReplay` de la respuesta se consume sin romper
  el tipado (no se pinta).
- **`contract.ts`** (espejo del contrato): `BulkRemoveInventoryRequest.note` pasó de opcional a **requerido** y
  ganó `batchKey?: string`; `BulkRemoveInventoryResponse` ganó `batchKey?: string` e `idempotentReplay: boolean`.
- **Mock (`fixtures.ts`):** `mockBulkRemove` ahora **valida `note` no-vacía** (400 si falta — refleja la llamada
  real, ya no la enmascara), aplica idempotencia por `batchKey` (`mockBulkRemoveStore`, replay con
  `idempotentReplay:true`) y devuelve `batchKey`/`idempotentReplay`.
- **Tests:** los mocks/asserts ahora mandan y verifican `note` (no-vacía) y `batchKey` en el body; nuevo test de
  «CTA deshabilitado sin nota» y de «reintento del mismo submit reusa la batchKey». Suite **586/586** ✓,
  `tsc --noEmit` ✓, `next build` ✓.
- **Money-safe:** la baja solo transiciona `status`; no toca precios (garantía del backend, inalterada).

---

## Órdenes storefront — «Solicitar factura» cableado real + paginación en /orders (rama claude/frontend-redesign-320uai)

> **⚠️ REVERTIDO (2026-08-22, coordinación de streams):** el orquestador acotó la frontera del
> rediseño a la capa visual: la plomería de datos (`lib/api.ts`, `lib/mock/`, `types/contract.ts`)
> la está tocando en paralelo la sesión de features admin (P-34/P-35). Estos dos arreglos requerían
> tocarla, así que se revirtieron del árbol y quedaron **preservados como parche**
> (hallazgo QA: el parche no viaja en el repo para no cruzar la frontera de plomería; quedó enrutado al orquestador de Pendientes y el trabajo está descrito íntegro abajo para rehacerlo cuando P-34/P-35 liberen `lib/api.ts`) para reaplicar
> cuando esa sesión libere la plomería. Pendiente resultante: el botón «Solicitar factura» sigue
> siendo estado local (falso) y `/orders` sigue sin paginación — el endpoint
> `POST /orders/:orderId/request-invoice` existe en contrato y backend; solo falta el cliente.
> Lo de abajo documenta el trabajo del parche.

Dos arreglos quirúrgicos en `(storefront)/orders` (sin rediseño):

- **«Solicitar factura» dejó de ser un botón falso.** `OrderDetailView.tsx` ya no hace
  `setRequested(true)` local: llama `requestOrderInvoice(orderId)` (nueva función en `lib/api.ts`,
  contrato §4 · `POST /orders/:orderId/request-invoice`, req `{}`, res
  `{ orderId, invoiceRequested: true, instructions: "SEND_FISCAL_DATA_BY_EMAIL" }`).
  Estados reales: `loading` (spinner del Button), error visible (`Banner danger` +
  `orders.invoiceError`) y éxito **persistente**: `onSuccess` escribe `invoiceRequested: true` en la
  caché de la query `['order', orderId]`, así el render usa SIEMPRE `query.data.invoiceRequested`
  (misma fuente que reporta el backend en un refetch). Éxito muestra `orders.invoiceRequested` en
  mono + el aviso CFDI existente. Tipo espejo `RequestInvoiceResponse` en `types/contract.ts`.
  Rama mock: muta `fx.mockOrderDetail.invoiceRequested = true` (persistencia igual al backend real).
- **Paginación en `/orders`.** `getOrders(page = 1)` ahora manda `?page=` (el backend pagina a 20;
  `GET /orders → { data, page, pageSize, total }`) y la rama mock usa el helper `paginate`.
  `OrdersView.tsx`: estado `page` en query key + `placeholderData: keepPreviousData` (sin flash de
  vacío) y paginador sobrio papel/tinta: número de página en mono tabular (`orders.pageInfo`) y
  flechas cuadradas 36×36 con borde 1px sin radius (lucide ArrowLeft/Right), deshabilitadas en los
  extremos con el mismo tratamiento apagado del Button del sistema. Solo se pinta con `totalPages > 1`.
- **i18n:** solo namespace `orders.*` en `es.json`/`en.json` (`invoiceError`, `pagination`,
  `pageInfo`, `prevPage`, `nextPage`).
- Gates: `tsc --noEmit` ✓ · `next lint` ✓.

---

## Makeover 1a «Conservadora» · Vender (buylist) + Carrito y pago (checkout) + Mi bóveda (rama claude/frontend-redesign-320uai, 2026-08-22)

Restyling según el artboard «TCGHunt Comprar y Vender» (dirección papel/tinta/rojo #B31217). Solo piel y
copy; cero cambios de lógica de dinero (SEC-A1 intacto: `batchQuote` y `BreakdownDTO` server-side).

**Vender (`/buylist`):**
- Hero con el nuevo lenguaje: «Vender mis cartas» + subtítulo + rule-note de PAY_AFTER_RECEIPT
  («primero autenticamos, luego transferimos») + enlace «Guía de envío seguro» (keys `buylist.*`).
- `SafeShippingGuide` reescrita al lenguaje editorial: retícula 01–04 (numeral mono rojo, regla superior),
  sin iconos ni cajas; prop `columns` (2 = modal, 4 = inline). Ahora vive DOS veces: modal del hero y
  sección inline al pie de la página (artboard 630–657). Copy de pasos actualizado en `safeShipping.*`
  (funda blanda / top loader / sobre o caja rígida / guía con seguro).
- Carrito de venta (drawer, se conserva FAB+drawer de §18.4): título «Tu lista», total estimado como
  cifra héroe mono 26px con etiqueta en versalitas, nota del estimado como rule-note roja, CTA
  «Enviar solicitud» en **tinta (primary, 54px)** — el rojo queda reservado al pago del checkout —,
  «Vaciar la lista» como texto mono centrado y pie mono en versalitas `cartFooterNote` (SPEI 2–3 días
  hábiles: se conserva la política real, no el «24–48 h» placeholder del artboard).
- `SellRequirementsPanel`: título «Requisitos para cobrar» (checklist ✓/—/! sin cambios).
- «Mis solicitudes»: el bloque de respuesta al ajuste (F5) deja la caja `bg-accent/5` y pasa a
  rule-note (sin rellenos de color, DESIGN §2.1). Funcionalidad intacta.

**Carrito y pago (`/checkout`, con cuenta e invitado):**
- Título «Tu carrito» + subtítulo de bóveda (`checkout.subtitle`).
- Líneas con miniatura grande (92px desktop / 64px móvil), nombre serif 19px, meta mono
  (set · #número · NM en raw con cuenta), «Quitar» bajo la meta y precio tabular 19px a la derecha.
- Bloque «Guardar en mi bóveda» (flujo con cuenta) reusa los benefits del upsell
  (`checkout.vaultUpsell.benefit.*`) como lista con reglas; eyebrow nuevo `checkout.vaultKeepEyebrow`.
- Resumen: cabecera «Resumen» con regla fuerte; botón «Pagar {monto}» sigue **accent (rojo)** y crece
  a 54px. Sin tocar `AmountBreakdown` (componente compartido, fuera del alcance de este stream).
- Estados EMAIL_NOT_VERIFIED / ITEM_UNAVAILABLE (poda + aviso) y todo el flujo invitado/upsell/claim
  se conservan sin cambio de comportamiento.

**Mi bóveda (`/vault`):**
- «Mis piezas» pasa de renglones-tabla a **tejas** (retícula del binder 2→3→4→5): imagen 5:7, nombre
  serif, `ListingSpec` mono, folio, fila valor+estado sobre regla y CTA «Retirar» por teja (Link
  bordeado si `withdrawable`; Button disabled con hint accesible si no — misma lógica v1.17;
  `WithdrawalBadge` manda sobre el badge de titularidad cuando hay envío activo).
- Sin precio de referencia la teja dice «Pendiente» en mono rojo (nunca MX$0.00 ni «—»); key nueva
  `vault.valuePending`. Lenguaje «piezas» (setCount/pendingPrice/onlySettled actualizado a «piezas
  liquidadas y sin envío activo»). Encabezado de sección `vault.myPieces` + `vault.piecesLegend`.
- Pestañas Piezas/Master set/Sellado, portafolio (`PortfolioTrendChart`, ya tokenizado — sin cambios),
  «Valor por set» y filtros se conservan.

**No implementado / desviaciones conscientes:**
- «Queda 1 / N en stock» por línea del carrito (artboard): `OrderItemPreview` no trae disponibilidad —
  pedido al arquitecto (no se inventan datos).
- Copy de la vitrina Top Bounties («Buscamos estas cartas» / «Te pagamos» / «Top bounties») NO se
  cambió: `TopBountiesShelf.test.tsx` (fuera del alcance de archivos de este encargo) asserta el copy
  vigente; la vitrina ya cumple visualmente el artboard (banda, chip, precio verde, QUEDAN N, CTA).
- El carrito de venta sigue como FAB+drawer (spec §18.4 ratificada) en vez de la columna fija de 420px
  del artboard; el drawer adopta el lenguaje del artboard.
- Tests: `BuylistView.test.tsx` actualizado a los nuevos copys («Vaciar la lista», «Requisitos para
  cobrar»). Suite tocada 103/103 ✓ · `tsc --noEmit` ✓ · `next lint` ✓.

---

## Makeover home 1a «Conservadora» (rama claude/frontend-redesign-320uai)

**Alcance:** home del storefront (`(storefront)/page.tsx` + componentes nuevos en
`(storefront)/_home/`), `StorefrontHeader`, footer del storefront (`(storefront)/layout.tsx`) y
claves i18n `home.*` / `nav.*`.

**Estructura nueva del home (orden del artboard 1a):**
1. Banda de portafolio (solo sesión iniciada): `PortfolioGlance` conservado del home anterior,
   ahora como banda propia bajo el header con link «Ver mi bóveda». El diseño 1a no la dibuja;
   se conserva por valor para el usuario recurrente.
2. Hero 2 columnas (1fr/392px): kicker mono, H1 serif 50px, CTA negro «Ver el catálogo» + link
   rojo «Producto sellado» (→ /sellado), chips «Sets buscados» con sets REALES de
   `GET /catalog/facets` (si no hay sets, no se pintan).
3. Mini-cotizador (`_home/HomeQuoter.tsx`): búsqueda `searchBuylistCards` (debounce 300 ms) +
   cotización POR EL SERVER con `getBuylistQuote` (SEC-A1: jamás se calcula un monto en cliente;
   sin referencia ⇒ línea «Pendiente», nunca $0; el total solo suma centavos cotizados por el
   server). El estado se IZA a la página (`useHomeQuoter`) porque el panel se pinta dos veces:
   columna del hero (lg) y sección propia (móvil), compartiendo líneas.
4. «Piezas destacadas» (`_home/FeaturedCarousel.tsx`): `getCatalog({sort:'price_desc'})`, primera
   teja grande + resto numeradas en mono rojo, flechas cuadradas funcionales (scroll + estado
   disabled real por posición). Badge «Queda 1» literal: en el modelo actual 1 publicación = 1
   copia; NO se muestra stock agregado por carta (no existe en el contrato de /catalog/cards).
5. «Producto sellado» (`_home/SealedShelf.tsx`): `getSealedGroups()` — aquí el stock agregado SÍ
   es real (`availableCount`): «N en stock» / «Último».
6. «Cartas gradeadas» (`_home/GradedShelf.tsx`): `getCatalog({productType:'graded'})` con chip
   empresa+grado y `certNumber` reales.
7. «Lo que más buscamos hoy» (`_home/BountyBoard.tsx`): condicional — solo si
   `getPublicBounties()` trae elementos (error/vacío ⇒ la sección no existe, regla de
   TopBountiesShelf). Columna «Condición» pinta la constante honesta «NM» (la buylist solo
   compra NM; el DTO de bounty no trae condición por fila).
8. «Cómo funciona la bóveda»: 3 pasos estáticos i18n. 9. Banda de tinta con único botón rojo
   «Cotizar mi lista». 10. Footer mono una línea (padding 26px del artboard).

**Header:** nav del artboard «Comprar / Vender / Mi cuenta» (activo = border-bottom rojo, ya
existente). Anónimo: «Mi cuenta» → /login (sustituye el link suelto «Iniciar sesión»); con
sesión se conservan las pestañas privadas (Mi bóveda / Mis órdenes / Mis retiros) y el bloque
nombre + Cerrar sesión. P-28 (ocultar carrito de compra en /buylist) y `--app-header-h` intactos.

**Decisiones / desviaciones conscientes:**
- «Continuar mi cotización» SOLO navega a /buylist sin transferir las líneas: llevarlas al
  `useSellCart` de `BuylistView` exigiría tocar el módulo buylist (fuera de los archivos de este
  encargo). Opción menos invasiva elegida y documentada; si se quiere transferencia real, el
  dueño del módulo buylist puede aceptar un query param (p. ej. `?add=cardId:finish,…`).
- Los links «filtrados» (`/catalog?setId=…`, `/catalog?productType=graded`) llevan el query
  param y `CatalogView` YA los inicializa desde la URL (`parseUrlFilters`, cerrado en este mismo
  stream por el módulo catálogo): los deep-links del home aterrizan filtrados.
- Tejas destacadas usan `CardImage` (aspecto 5:7) también para la teja grande (el artboard
  sugiere 4:5): el arte de las cartas es 5:7 nativo y recortarlo mentiría.
- El eyebrow de gradeadas dice «PSA · CGC» (el artboard decía «PSA · BGS · CGC»; BGS no existe
  en `GradingCompany` del contrato).
- `FeaturedSetGlance` (§7.18, gráfica pública del set destacado en la rama anónima) SALE de la
  home: su lugar lo ocupa el cotizador. El componente y sus claves `home.featuredSet.*` se
  conservan (los usa su propio test); si UX lo da de baja, retirar ambos.
- El panel «Valor por set» del home anterior también sale (sigue viviendo en /vault).
- i18n: claves nuevas bajo `home.quoter/sealed/graded/bounties/how`, `home.heroKicker`,
  `home.setsWanted`, `home.trustPayout`, `home.lastOne`, `home.pricePending`,
  `home.carouselPrev/Next`, `home.vaultLink`, `home.featuredTitleShort`; `nav.buy`,
  `nav.myAccount`; valores actualizados: `home.ctaShop` («Ver el catálogo»), `home.sellCta`
  («Cotizar mi lista»). Paridad ES/EN verificada.
- Tests: `page.test.tsx` reescrito (hero + doble panel de cotizador + añadir carta cotiza contra
  el mock del server); `StorefrontHeader.test.tsx` actualizado a «Comprar / Mi cuenta».

---

## Makeover 1a «Conservadora» — Comprar / Ficha de carta / Sellado (rama claude/frontend-redesign-320uai)

Aplicación de los artboards aprobados «2a Comprar» y «Ficha de carta» (Claude Design, papel/tinta/rojo
`#B31217`) a la vitrina de compra, la ficha y la tienda de sellado. Cero tokens nuevos: todo se compone
con `--color-*`/`--hunt-*`, las tres familias (`--font-serif/sans/mono`) y las reglas 1px del sistema.

### Comprar (`catalog/CatalogView.tsx` + nuevos `CatalogTile.tsx` y `Paginator.tsx`)
- **Encabezado del artboard:** eyebrow `Catálogo · MXN sin IVA` + h1 mincho «Comprar» + conteo mono
  tabular «N piezas disponibles» (total real de la query filtrada) a la línea base.
- **Pestañas de la Tienda (StoreTabs):** ganan la tercera pestaña **Gradeadas**, que NO es ruta nueva:
  es `/catalog?type=graded`. `CatalogView` lee el parámetro con `useSearchParams` y lo sincroniza en
  ambos sentidos con `filters.productType` (cambiar el tipo desde el panel/chips hace `router.replace`
  para que la pestaña no mienta). Las páginas `/catalog`, `/compra` y `/sellado` ganan `<Suspense>`
  (requisito de `useSearchParams` en Next 15).
- **Filtros iniciales desde la URL (enlaces del Home):** `parseUrlFilters` inicializa el estado al
  montar desde la query — `?setId=<id>`, `?productType=raw|graded|sealed` (y el alias `?type=graded`
  de la pestaña), más los triviales `q`, `finish`, `sealedSubtype`, `rarity` (CSV) y `sort`; los enums
  se validan contra sus listas y un valor inválido se ignora. Un efecto keyed por
  `searchParams.toString()` MERGEA los filtros de la URL en navegaciones posteriores (pestañas,
  back/forward) sin borrar lo elegido en el panel. `StoreTabs` marca Gradeadas activa también con
  `?productType=graded`. Sin cambios de contrato ni de `lib/api.ts`.
- **Teja propia de la vista (`CatalogTile`)**: arte 5:7, nombre en mincho, `set · #número` mono muted,
  renglón `ListingSpec` (se conserva por §7.2b y por el e2e que verifica el tooltip NM), precio tabular
  en sans y **«Queda 1» rojo literal** (1 publicación = 1 copia física; no se inventa stock agregado).
  CTA «Añadir al carrito» (móvil «Añadir» vía spans responsivos + `aria-label` estable); en carrito →
  «En el carrito» y el segundo clic navega a `/checkout`. NO se tocó `ListingCard` (zona compartida);
  la teja vive en `catalog/` y es propiedad de esta vista. Sin precio jamás pinta `$0`: cae al
  `price.pendingLabel` (defensivo; Compra solo lista con precio).
- **Paginación (hueco real cerrado):** `Paginator` sobrio (flechas cuadradas 38px con borde + `p / N`
  mono tabular). `filters.page` viaja en `getCatalog` (el backend pagina a 20); **cualquier cambio de
  filtro/orden/búsqueda resetea la página** (`updateFilters`). Nota: la rama MOCK de `getCatalog`
  ignora `page` y devuelve todo (`lib/api.ts` es zona compartida; no se tocó) — con mocks el paginador
  casi siempre queda en `1 / 1`. Contra backend real funciona completo.
- Filtros: mismo panel (9 filtros + facetas), reordenado según artboard (Set primero) y con reglas de
  sección a 0.32 (`border-border-strong`); encabezado FILTROS + «Limpiar» rojo; en móvil el botón
  Filtros muestra el conteo activo en rojo.

### Ficha de carta (`catalog/[cardId]/CardDetailView.tsx`)
- Ya seguía la retícula del artboard; se ajustó: **chip de grado** (borde tinta, mono «PSA 9») en la
  celda Condición para gradeadas; **precio de venta ausente → «Precio pendiente»** rojo mono (antes
  decía «No disponible»); `card.backToCatalog` pasa a «Volver al catálogo».
- **`CertNumberField` restilizado** (el diseño lo exige): etiqueta eyebrow + renglón con borde 0.32,
  número mono tabular y «Copiar» rojo mono a la derecha. Afecta también a M8 (admin) — mismo lenguaje.

### Sellado (`sellado/SealedShopView.tsx`, `SealedDetailView.tsx`, nuevo `StockBadge.tsx`)
- La cuadrícula 5:7 se sustituye por la **banda sobre pozo (`bg-surface-2`) con tejas horizontales**
  del home 1a: miniatura cuadrada 88px (object-contain, sin recorte), nombre mincho, renglón mono
  set·presentación(+condición), precio «Desde · sin IVA» tabular y **`StockBadge` con cantidades
  reales del endpoint**: «N en stock» verde / «Último» rojo / «Agotado» muted. Toda la teja enlaza a
  la ficha. La ficha de sellado usa el mismo `StockBadge`; los bloques tras feature-flags
  (`trendEnabled`/`restockEnabled`, 404 `FEATURE_DISABLED`) ya degradaban limpio y no se tocaron.
- i18n nuevos (namespaces ya usados por estas vistas): `storeTabs.graded`, `catalog.eyebrow`,
  `catalog.piecesAvailable`, `catalog.lastOne`, `catalog.addToCartShort`, `catalog.pagination.*`,
  `sealed.inStock`, `sealed.lastOne`, `sealed.soldOut`; y cambios de valor: `catalog.title`
  («Comprar»), `catalog.addToCart` («Añadir al carrito»), `catalog.resultsCount` (resultados),
  `card.backToCatalog`. ES+EN.

### Desviaciones conscientes del artboard
- **Filtro «Grado» del sidebar (chips PSA 10/PSA 9/…):** el contrato de `/catalog/facets` no expone
  facetas de grado ni `getCatalog` filtra por grado — no se pintó (pintarlo sin backend sería mentir).
  Solicitud al arquitecto anotada abajo. La pestaña «Gradeadas» cubre el corte grueso.
- **«Solo con stock»:** no existe en el contrato y la vitrina ya lista solo inventario publicado con
  precio — el toggle sería un no-op; se omite.
- **«2/4/6 en stock» verdes del artboard 2a:** placeholders del diseño; en el modelo real cada
  listing de cartas es una copia única, así que TODAS las tejas vendibles pintan «Queda 1» (los
  agregados con stock real viven en /sellado, donde sí se pintan).
- **Orden como `Select` con etiqueta** (no el rectángulo «Precio ↓» del artboard): se reusa el Select
  del sistema por a11y/consistencia; mismo lugar (barra de resultados).
- CTA de teja a 44px de alto (artboard: 42px) por el objetivo táctil mínimo del DS (§6.1).

### Gates locales
`tsc --noEmit` ✓ · `next lint` ✓ · `vitest run` **587/587** ✓ · `next build` ✓. Tests propios
actualizados: `CatalogView.test` (nuevo nombre del CTA + mock `next/navigation`), `SealedShopView.test`
(«N en stock» + mock `next/navigation`).

### Solicitud al arquitecto (no bloqueante)
- Facetas/filtro de **grado** en Compra: `GET /catalog/facets` con `grades: [{ company, value }]` y
  `GET /catalog/cards?gradingCompany=&gradeValue=` (o similar) para poder pintar el bloque «Grado»
  del artboard 2a con datos reales.

---

## Pase de refactors del makeover 1a — R1–R5 del veredicto techlead (2026-08-22, rama `claude/frontend-redesign-320uai`)

Refactor PURO dentro de `(storefront)/` + `messages/` (única excepción autorizada: R4 en
`components/domain/StoreTabs.tsx`). Nuevos compartidos del stream en `(storefront)/_shared/`
(NO en `frontend/src/components/` — zona compartida de otro stream).

### R1 · `_shared/StockBadge.tsx` — distintivo de stock único (§20.6)
- API semántica `variant: 'unique' | 'count' | 'lastUnit' | 'soldOut'` + helper
  `stockVariantFromCount(count)` para los sitios con conteo agregado real (sellado).
- **Colores canónicos decididos POR LA TABLA del DS §20.6** (ante la duda, manda el DS):
  `unique` («Queda 1») = **accent**; `count` («N en stock») = **success**; `lastUnit` («Último») =
  **muted** (la implementación previa de `sellado/StockBadge` lo pintaba accent — corregido);
  `soldOut` («Agotado») = muted. Mono 10px (9px móvil), uppercase, tracking 0.12em.
- Sustituye las 4 implementaciones (sellado/StockBadge — **eliminado**, SealedShelf inline,
  FeaturedCarousel/GradedShelf `home.lastOne`, CatalogTile `catalog.lastOne`) y también se usa en
  `SealedDetailView`. Namespace i18n único **`stock.*`** (`lastOne`, `inStock`, `lastUnit`,
  `soldOut`, ES+EN — §20.16). Claves borradas tras grep de uso cero: `home.lastOne`,
  `home.sealed.inStock`, `home.sealed.last`, `catalog.lastOne`, `sealed.inStock`, `sealed.lastOne`,
  `sealed.soldOut`. La semántica ambigua de `lastOne` («Queda 1» vs «Último») quedó partida en dos
  claves distintas (`stock.lastOne` / `stock.lastUnit`).

### R2 · `_shared/PendingPriceLabel.tsx` — señal única de precio pendiente
- Color canónico **accent** (§16.4 «texto mono rojo PENDIENTE» + §20.13 «aviso mono rojo, nunca $0»);
  los dos sitios del home que lo pintaban muted quedaron alineados.
- Una sola clave: **`price.pendingLabel`** (ya era la fuente de catálogo/ficha); `home.pricePending`
  **borrada**. Prop `hint` añade `price.pendingHint` (fila de ejemplares de la ficha). Usado en los
  5 sitios: CatalogTile, CardDetailView (Fact + fila de ejemplar), FeaturedCarousel (TilePrice),
  GradedShelf. `components/ui/PriceTag.tsx` NO se tocó (zona compartida): consolidación final
  anotada en TECH_DEBT (MK-D7).

### R3 · Estantes del home sin duplicación
- **Errores:** los tres bloques de error a mano (FeaturedCarousel/SealedShelf/GradedShelf) ahora usan
  `components/ui/QueryState` (solo import, como CatalogView/SealedShopView). Detalle de composición:
  el wrapper `<div className={isError ? 'gutter pb-12' : undefined}>` aporta el gutter SOLO en la
  rama de error, para no alterar la pista de scroll del carrusel ni duplicar gutter en las grillas.
- **`_shared/Shelf.tsx`:** encabezado de estante único (H2 serif 22/29 + link muted + variantes
  `kicker`/`subtitle`/`actions`); consumido por FeaturedCarousel (flechas como `actions`),
  SealedShelf, GradedShelf y BountyBoard.
- **`_shared/EditorialLink.tsx`:** micropatrón §20.0 (variant `accent` = subrayado rojo + tinta,
  hover subrayado a tinta; `muted` = terciario sin subrayado). Renderiza `Link` con `href` o
  `<button>` con `onClick`. Usado en: `page.tsx` (link bóveda; CTA sellado del hero con overrides
  responsivos móviles vía `className`+twMerge), `HomeQuoter` («Continuar mi cotización»),
  `BuylistView` (guía de envío — la variante divergida `text-accent`/minúsculas se normalizó al
  canon) y dentro de `Shelf` (los «Ver todo…» muted).

### R4 · StoreTabs sin ARIA de tabs (excepción autorizada, solo ese cambio)
- `components/domain/StoreTabs.tsx`: fuera `role="tablist"/"tab"` y `aria-selected` (prometían un
  tab-panel controlado con navegación por flechas que no existe); ahora es
  `<nav aria-label={t('storeTabs.label')}>` + `aria-current="page"` en el link activo. Visual §20.1
  intacto. Nada más se tocó en ese archivo.

### R5 · Catálogo: debounce + `keepPreviousData`
- El input de búsqueda pasa a estado inmediato propio (`searchTerm`) y solo su valor **debounced**
  (`useDebouncedValue`, 300 ms — patrón P-5) entra a `filters.q`/queryKey: cero fetch por pulsación.
  Sincronización: chip «✕»/limpiar y `?q=` de URL escriben de vuelta al input; cambios de
  orden/facetas NO lo pisan (guard por comparación de `q`). El reset de página viaja con el término
  debounced (cambio real de `q` ⇒ `page: undefined`).
- `catalogQuery` con `placeholderData: keepPreviousData`: paginar/filtrar ya no desmonta la grilla
  (skeleton solo en el primer fetch).

### D-menores corregidos de paso (D3/D7)
- **D3:** `Paginator` movido a `_shared/Paginator.tsx` (era genérico) y **`SealedShopView` ahora
  pagina** (§20.12): `page` en filtros (los 4 selects resetean página), total de páginas del
  `total/pageSize` del contrato, ancla de scroll en la barra de resultados, oculto con una página.
- **D7:** © del footer con año dinámico (`layout.tsx`); numeración del carrusel `aria-hidden`
  (§20.3); `BountyBoard` con semántica de tabla (`role="table"/row/columnheader/cell"` — alternativa
  válida de §20.7 conservando la retícula responsiva); chips removibles con
  `aria-label` de acción (`catalog.removeFilter`, ES+EN); literal `BUYLIST` → `buylist.verticalLabel`
  (uppercase vía clase, §20.15). Lo NO corregido quedó en TECH_DEBT (MK-D7): `<img>` crudo de
  SealedShelf, HomeQuoter sin cancelación/combobox ARIA, header de /checkout sin simplificar.

### Gates locales
`tsc --noEmit` ✓ · `next lint` ✓ (sin warnings) · `vitest run` **589/589** ✓ (sin tocar tests: los
textos visibles no cambiaron salvo el color/semántica ya descritos) · `next build` ✓.
## P-35 — Alta dedicada de producto SELLADO (`SealedAddFlow`, contrato v1.36-sealed-alta, §16.8a)

**Problema corregido:** la pestaña «Sellado» caía en `AddItemModal` (buscador de CARTAS sobre singles),
etiquetando un single como «sellado» (money-unsafe, sin mapeo TCGCSV). Ahora el alta de sellado es un flujo
dedicado que elige un PRODUCTO sellado real.

**Componentes nuevos (todos en `frontend/src/app/[locale]/(admin)/admin/m1/`, sin tocar storefront ni la capa
visual compartida `frontend/src/components/`):**
- `SealedAddFlow.tsx` — asistente modal ancho de 2 pasos (stepper mono `PASO 1/2 DE 2`, `Esc` cierra, foco
  inicial). Modal ancho LOCAL a M1 (`max-w-3xl`); no se reescribió el `Modal` compartido (es `max-w-md`).
  Paso 0 selector de set (Combobox con año, `listBuylistSets`; se salta con `presetSet`) → Paso 1 grid →
  Paso 2 `QuickAddSection` (P-19) + subtipo/condición. Camino de respaldo honesto (fuente 502 o vacío
  legítimo): mini-form manual con banner `info` de excepción → nace SIN mapeo (`PRICE_PENDING` visible).
- `SealedProductGrid.tsx` (`SealedProductGrid` + `SealedProductTile` + `SealedProductGridSkeleton`) — grid
  `role="listbox"` con `option`s navegables (flechas + Home/End), foco visible, `aria-selected`, `aria-label`
  por teja. Imagen `aspect-[5/7] object-contain` sobre pozo con fallback textual mono (nunca un roto).
  Money-safe por teja: precio `MERCADO` o pill **`SIN PRECIO DE MERCADO`** (nunca `MX$ 0.00`).

**Contrato consumido:** `GET /admin/inventory/sealed-catalog?setId=&groupId?=&q=` → `SealedCatalogResponse`
(`getSealedCatalog` en `lib/api.ts`, con mock `mockSealedCatalog`). El alta reusa
`POST /admin/inventory/items/batch` con `batchKey` idempotente por operación; cada línea envía
`{ cardId:<anchorCardId>, productType:'sealed', sealedSubtype, sealedCondition, finish:'normal',
tcgplayerProductId, tcgplayerGroupId, sealedImageUrl, sealedProductName, qty, acquisition* }`. La pieza NACE
MAPEADA (productId+groupId JUNTOS) ⇒ la aportación valúa en el acto (`marketRef` null ⇒ tarjeta Aportación
deshabilitada, heredado de QuickAddSection §16.5a2).

**Cambios en `contract.ts`:** `BatchInventoryItemInput` gana `tcgplayerProductId/tcgplayerGroupId/
sealedImageUrl/sealedProductName` (v1.36); nuevos `SealedCatalogProductDTO` y `SealedCatalogResponse`.
`QuickAddTarget` gana los 4 campos aditivos de sellado (se reenvían al batch solo si productId+groupId están).

**Retirado:** `AddItemModal` ya NO ofrece `productType='sealed'` (`PRODUCT_TYPES = ['raw','graded']`); se
eliminó su rama de subtipo/condición/listPrice. La pestaña Sellado y su estado vacío ahora abren
`SealedAddFlow` (CTA `Agregar sellado`), no `AddItemModal`. `Agregar otra presentación` en el detalle de set
abre el flujo con el set precargado.

**i18n:** `admin.sealedAdd.*` (es/en) según §16.10; el paso 2 reusa `admin.quickAdd.*` y
`status.sealedSubtype.*`/`status.sealedCondition.*`.

**Tests:** `SealedAddFlow.test.tsx` (grid + money-safe pill; aportación deshabilitada sin mercado; envío del
alta con identidad TCGCSV + cardId ancla; 502 con banner/retry/respaldo; vacío legítimo + respaldo sin mapeo).
Suite **591/591** ✓, `tsc --noEmit` ✓, `next lint` ✓, `next build` ✓.

**Solicitud al arquitecto (no bloqueante):** el camino de respaldo en el caso **502 UPSTREAM_ERROR** no tiene
`anchorCardId` (el cuerpo de error no lo trae), así que la captura manual solo puede anclarse en respuestas
`200` (incluido `groupResolved:false`). Si se quiere permitir captura manual anclada aun con la fuente caída,
el contrato tendría que exponer el `anchorCardId` del set por otra vía (p. ej. incluirlo en el 502 o un
endpoint ligero de ancla por `setId`). Mientras tanto, el 502 ofrece **Reintentar** + el respaldo, y el
respaldo con ancla queda operativo en el vacío legítimo (`200`).

---

## P-34 · Editor de PRICING POR TIERS (M2, v1.37-pricing-tiers)

**Alcance tocado:** SOLO `frontend/src/app/[locale]/(admin)/admin/m2/` + `types/contract.ts` +
`lib/api.ts` + `lib/mock/fixtures.ts` + `messages/{es,en}.json` + este doc. **NO** se tocó `(storefront)/`
ni `frontend/src/components/` (capa visual compartida bajo rediseño por otra sesión). Los componentes
visuales que necesité son **locales a M2** (`RuleCell` en `TierRulesSection`, badges/banners de conflicto);
solo se **importan** (lectura) los primitivos ya existentes de `@/components/ui/*`.

**Qué reemplaza:** el editor de ~30 reglas por rareza (`BuylistRulesSection` + `SalesRulesSection` +
`RuleAxisEditor`) fue **eliminado** y sustituido por dos secciones nuevas. El contrato v1.37 retira los
`PUT /admin/pricing/buylist-rules` y `/sales-rules`; el eje rareza ya no se edita por rareza suelta.

**Componentes creados (locales a M2):**
- `sections/TierRulesSection.tsx` — Sección 4. **5 filas por tier** (T0 Bulk, T1 Uncommon/Reverse, T2
  Rare/Holo, T3 Premium/Chase, T4 Ultra/Grail), cada fila con su regla de **COMPRA** y de **VENTA**
  (fijo MX$ / %). Eje **acabado** (`reverse_holo`/`holofoil`/`first_edition_holofoil`, buy+sell) y
  **fallbacks** por eje. Invariante visible: en tiers premium (T3/T4) el modo `fijo` de COMPRA está
  **bloqueado** (solo `%`) porque un bin fijo regalaría cartas caras. Consume `GET/PUT
  /admin/pricing/tiers`.
- `sections/TierMapSection.tsx` — Sección 5. **Asignador rareza canónica → tier**: un dropdown de tier
  por rareza (patch parcial: solo las cambiadas). Consume `GET/PUT /admin/pricing/tier-map`. Hospeda
  «Unificar rarezas» (§19.5), reubicado desde la difunta `BuylistRulesSection` (mismas keys i18n
  `admin.m2.unifyRarities`).
- `sections/tier-shared.tsx` — helpers locales: `TIER_ORDER`, `ruleToRaw`, `premiumFixedOffenders`
  (extrae `details.offending` del 422).

**Money-safe (UI):** el valor de regla se edita como **texto crudo** y se castea SOLO al guardar
(`sanitizeDecimalInput` + `isSaveableRuleValue` + `pesosToCents`, reusados de `sections/shared.tsx`); un
vacío/NaN **nunca** se persiste como MX$0 (Guardar se deshabilita y se explica por qué). buy `pct`
topado en `[0,100]`, sell `pct` (markup) en `[0,1000]`. Una rareza **sin tier** se marca como
**«Fallback (pendiente)»** con el dropdown vacío (no inventa un tier ni un $0); copy explícito de que un
`pct` sin referencia de mercado deja el precio **pendiente**, nunca $0.

**Manejo de 422:**
- `PREMIUM_RARITY_FIXED_TIER` (emitido por AMBOS PUT): banner de error que **lista los pares
  infractores** `(rareza premium → tierId)` desde `details.offending`; en el asignador la fila
  infractora recibe además un badge «En conflicto».
- `UNKNOWN_RARITY` (PUT /tier-map): mensaje claro vía catálogo i18n (`error.UNKNOWN_RARITY`).

**Cambios en `contract.ts` (alineado a v1.37):** `TierId`, `TierRuleDTO`, **`TieredRuleSet`**,
`UpdateTiersRequest`, `TierMapTierDTO`, `TierMapRowDTO`, `TierMapResponse`, `UpdateTierMapRequest`,
`PremiumRarityFixedTierDetails`.

**Cambios en `lib/api.ts`:** `getPricingTiers`, `updatePricingTiers`, `getPricingTierMap`,
`updatePricingTierMap` (con ramas mock ↔ `apiRequest` reales). Mocks money-safe en `lib/mock/fixtures.ts`
(seed que reproduce los defaults v1.9 LOCKED y preserva el invariante premium→`pct`).

**i18n:** `admin.m2.tierRules.*` y `admin.m2.tierMap.*` (es/en) + `error.PREMIUM_RARITY_FIXED_TIER` /
`error.UNKNOWN_RARITY`.

**Tests añadidos** (`M2View.test.tsx`, describe «Editor de precios por TIER (P-34, v1.37)»): render de
las 5 filas, guardar COMPRA de T0 (centavos), invariante premium→% (T3 sin opción `fijo`), money-safe
(vaciar → Guardar off), 422 PREMIUM_RARITY_FIXED_TIER en `/tiers`, asignar Common→T2 en `/tier-map`, 422
PREMIUM_RARITY_FIXED_TIER y UNKNOWN_RARITY en `/tier-map`, y money-safe del fallback pendiente. Se
retiraron los tests de los editores por rareza eliminados.

**Verde:** `tsc --noEmit` ✓, `vitest run` **72 archivos / 580 tests** ✓, `next build` ✓.

**Solicitud al arquitecto:** ninguna — el contrato v1.37-pricing-tiers cubre los 4 endpoints, los shapes
(`TieredRuleSet`, `TierMapRowDTO`) y ambos 422 con `details.offending`. No se necesitaron mocks fuera de
contrato ni campos nuevos.

---

## FE-1 (P-30 storefront) · Badge de singles: restaurado «Queda 1» (2026-08-22)

Regresión visual del rediseño marcada por QA + techlead en la adaptación P-30. Las tejas de **singles**
consumían `stockVariantFromCount` (mapeador del **sellado**: `count===1 → 'lastUnit'` = «Último»), lo que
contradecía DS §20.6 y el docstring de `CatalogView` («Queda 1»). Con el modelo agrupado de P-30
`stockCount===1` = «1 disponible ahora mismo» → variante `unique` («Queda 1», accent).

**Decisión de diseño (por qué DOS mapeadores y no uno):** `count===1` diverge por familia en DS §20.6 —
en singles es `unique` («Queda 1»), en sellado es `lastUnit` («Último», última de varias). Por eso se
introdujo `stockVariantForSingle(count)` (`0→soldOut`, `1→unique`, `N≥2→count`) junto al ya existente
`stockVariantFromCount` (sellado, `1→lastUnit`), en `_shared/StockBadge.tsx`.

- **Consumen `stockVariantForSingle`:** `CatalogTile`, `_home/GradedShelf`, `_home/FeaturedCarousel`,
  `catalog/[cardId]/CardDetailView`.
- **Siguen en `stockVariantFromCount` (sellado):** `_home/SealedShelf`, `sellado/SealedShopView`,
  `sellado/[inventoryItemId]/SealedDetailView`.
- **`lastUnit` se CONSERVA** (no se retiró): DS §20.6 la reserva para sellado. Ambas claves i18n quedan
  usadas — `stock.lastOne` («Queda 1») des-huérfana por singles, `stock.lastUnit` («Último») por sellado.
  Sin huérfanos en ninguna dirección. (No existe clave `home.lastOne`; la referida en el hallazgo es
  `stock.lastOne`.)
- El docstring de `CatalogView` («Queda 1» literal) **ya era correcto**; tras el fix el código concuerda,
  no requirió cambio. Se corrigieron comentarios «Último / N en stock» → «Queda 1 / N en stock» en las
  tejas de singles.

Test nuevo `_shared/StockBadge.test.tsx` (8 casos): afirma `stockCount===1 → «Queda 1»` (unique) para
singles y el contraste `availableCount===1 → «Último»` (lastUnit) para sellado.

**Verde:** `vitest run` **73 archivos / 593 tests** ✓, `tsc --noEmit` ✓, `next build` ✓.

**FE-2 registrada** en `TECH_DEBT.md` (Baja, dueño frontend, bloqueada por backend **H1**/arquitecto):
alinear el trato «desde»/sin IVA en singles cuando el rename `salePriceCents→fromPriceCents` llegue por
contrato. **FE-1 marcada RESUELTO.**

---

## P-36 · Fix stepper «Baja rápida» (QuickRemove) — bug reportado en prod

**Síntoma:** en «Baja rápida» del inventario admin (M1), los botones +/− de «CANTIDAD A DAR DE BAJA»
no cambiaban el número (carta con «1 piezas disponibles»).

**Causa raíz = caso (b), NO bug funcional.** Con `removableCount=1` el stepper queda topado en `[1,1]`
(min=max=1): ambos botones **deben** ser no-op y ya llevaban el atributo `disabled`. El
incremento/decremento funciona correctamente para `removableCount≥2` (cubierto por tests), y
`removableCount` está **bien calculado**: sale de `VariantDrawer` como
`rows.filter(status ∈ {in_stock,listed}).length` sobre piezas `ownerType=platform`; cada
`InventoryItemDTO` es UNA pieza física (no hay campo `quantity` que sumar), y el filtro respeta el
contrato (§ «solo platform + in_stock|listed son ajustables»). Es decir: la carta de la captura
**realmente** tiene 1 pieza ajustable → 1 es correcto.

**El defecto real era de UI:** los botones deshabilitados conservaban `hover:bg-surface-2`, que en
Tailwind se dispara al pasar el cursor **aunque** el botón esté `disabled` → el botón se «encendía»
bajo el puntero y se leía como *clickeable-pero-muerto*. El humano lo interpretó como «no responden».

**Cambio (`QuickRemove.tsx`, ambos botones):**
- `hover:bg-surface-2` → `enabled:hover:bg-surface-2` (el hover solo aplica cuando NO está disabled).
- Estado disabled más evidente: `disabled:border-border disabled:bg-surface-2 disabled:text-muted`
  (además del `disabled:opacity-45 disabled:cursor-not-allowed` que ya existía) + `aria-disabled`.
- Lógica del stepper intacta (ya era correcta): + sube hasta `removableCount`, − baja hasta 1.

**Money-safe intacto:** el envío sigue exigiendo `note` no-vacía + `batchKey` idempotente; el stepper
sigue capado a `removableCount`. No se tocó `removableCount` (estaba bien).

**Nota de borde (no bug):** `getAdminInventory` pide `pageSize:100`; una variante con >100 piezas
subcontaría `removableCount` — dirección **money-safe** (nunca ofrece bajar de más). Sin acción.

**Tests añadidos** (`QuickRemove.test.tsx`): caso P-36 (1 pieza → ambos botones `disabled`, el número
no cambia, CTA «Dar de baja 1» operativo) y multi-pieza (3 → + sube 1→3 y se deshabilita en el tope;
− baja 3→1 y se deshabilita en el piso).

**Verde:** `vitest run` **73 archivos / 595 tests** ✓, `tsc --noEmit` ✓, `next build` ✓.

---

## P-39 · Imagen de alta resolución en superficies prominentes + P-40 · Acabado visible

Ambos ajustes son **aditivos** sobre el rediseño ya mergeado (no rediseño): conservan tokens,
tipografía y layout del makeover.

### P-39 · `imageLargeUrl` en las vistas prominentes (fallback a `imageSmallUrl`)
El contrato **ya** expone las dos URLs en `CardDTO` (`imageSmallUrl`, `imageLargeUrl`), y
`GroupedListingDTO.card` es un `CardDTO`, así que ambas ya viajaban al front. No hubo cambio de
contrato ni de tipos.

- **Featured del home (`_home/FeaturedCarousel.tsx`):** las DOS tejas (hero grande y las numeradas
  secundarias) pasan de `imageSmallUrl` a `imageLargeUrl ?? imageSmallUrl`. Son piezas de showcase
  prominentes, no un grid denso.
- **Ficha de la carta (`catalog/[cardId]/CardDetailView.tsx`):** ya usaba `imageLargeUrl`; se añadió
  el fallback `?? imageSmallUrl` por robustez (nunca imagen rota si el backend emite null).
- **Grid del catálogo (`catalog/CatalogTile.tsx`): se CONSERVA `imageSmallUrl`.**
  **Decisión small/large (documentada):** el grid del catálogo es **denso** (muchas tejas por
  viewport); mantener la imagen chica ahorra ancho de banda y acelera el primer render. La alta
  resolución se reserva para superficies prominentes (featured y ficha). Comentario in-code en la teja.
- **Fallback:** en featured y ficha se usa `imageLargeUrl ?? imageSmallUrl` (si `imageLargeUrl` es
  null cae a la chica). `eslint` (solo `next/core-web-vitals`) no marca el `??` sobre tipo no-nulo.

### P-40 · Etiqueta legible de acabado (Normal / Reverse Holo / Holofoil)
- Las claves i18n **ya existían** (`finish.normal`, `finish.reverse_holo`, `finish.holofoil`, etc. en
  `messages/{es,en}.json`); no se agregó nada a los mensajes.
- **Nuevo componente `_shared/FinishLabel.tsx`:** etiqueta discreta (renglón mono muted, NO pastilla
  con caja — respeta la dirección 5a del rediseño que sustituyó las pastillas por texto mono).
  Devuelve `null` para `productType === 'sealed'` (sellado no tiene acabado de carta); defensivo,
  porque `GroupedListingDTO.productType` es `raw|graded` por contrato.
- **Featured (`FeaturedCarousel.tsx`): era el único hueco real** — las tejas no mostraban acabado.
  Se añadió `<FinishLabel>` en ambas tejas.
- **Catálogo (`CatalogTile.tsx`) y ficha (`CardDetailView.tsx`): YA mostraban el acabado** y se
  dejaron como estaban para no duplicar/ensuciar:
  - `CatalogTile` lo pinta vía `ListingSpec` (`RAW · NM · HOLOFOIL`, último segmento i18n).
  - `CardDetailView` lo pinta vía el `Fact` «Acabado» (primario) y el `ListingSpec` de cada grupo.
  No se tocó `ListingSpec` (vive en `components/domain/`, zona compartida de otros streams).

### Tests añadidos
- `_home/FeaturedCarousel.test.tsx` (nuevo): hero pinta `imageLargeUrl`; fallback a `imageSmallUrl`
  cuando `imageLargeUrl` es null; etiqueta de acabado (Reverse Holo / Holofoil) presente.
- `catalog/CatalogTile.test.tsx` (nuevo): el grid conserva `imageSmallUrl`; el acabado (Holofoil /
  Reverse Holo) aparece en la ficha técnica de la teja.

**Money-safe:** cambios puramente de display; no se tocan precios ni lógica de carrito.

**Verde:** `vitest run` **75 archivos / 601 tests** ✓, `tsc --noEmit` ✓, `next build` ✓.

---

## P-41…P-44 · Ajustes de UX del storefront (cotizador/catálogo) — un solo pase

Cuatro cambios ADITIVOS/de comportamiento; se conserva el visual del rediseño ya mergeado.
Solo `frontend/`. Money-safe: todo display/UX — no se tocan precios ni la cotización (los montos
siguen viniendo del server; la UI solo los MUESTRA).

### P-41 · Cotizador del home surtía corto (fix rápido)
- `_home/HomeQuoter.tsx`: la búsqueda del mini-cotizador pasó de `pageSize: 5` → **`20`**. Con 5,
  un nombre con muchas variantes (p. ej. 6 Tropius, «Pitch Black») dejaba fuera cartas de forma
  arbitraria (el corte desempataba por uuid de set). Sin cambio de backend/contrato.
- Se añadió el affordance **«Ver más en el cotizador»** (link `/buylist`) al pie del desplegable de
  resultados, para nombres con aún más variantes.

### P-42 · Carrito de venta fijo (desktop) + sombreado de lo agregado
- **Layout (`buylist/BuylistView.tsx`):** en **desktop (≥1024px)** el carrito de venta es un
  **PANEL FIJO a la derecha, a la par del grid** (2 columnas persistentes, `sticky`), reusando
  EXACTAMENTE el mismo `SellCartContents` que el drawer. En **móvil** se conserva el sheet (FAB +
  `SellCartDrawer`). La decisión de layout es **JS-driven** (`useMediaQuery('(min-width:1024px)')`,
  hook nuevo en `hooks/useMediaQuery.ts`): así el carrito se renderiza **UNA sola vez** (sin DOM ni
  focus-trap duplicados por breakpoints CSS). En jsdom `matchMedia` devuelve `matches:false`, por lo
  que la suite existente sigue corriendo la variante MÓVIL (FAB+drawer) sin cambios.
- **Sombreado:** `useSellCart` expone un predicado estable **`isInCart(cardId, productType, finish,
  productId?)`** (misma identidad que el dedup del carrito, sin la cantidad). Tras AGREGAR:
  - **grid raw (binder Master Set, `QuoterTile`):** la teja de esa (carta, acabado) se destaca
    (pozo de papel + regla de tinta) con la marca textual **«En el carrito»** (doble canal;
    `data-in-cart="true"` para pruebas). Se propaga `isInCart` por `MasterSetPanel → MasterSetBinder
    → QuoterTile` (prop opcional, solo modo `quoter`).
  - **grid plano (graded/sealed, `BuylistView`):** la teja se sombrea si CUALQUIER acabado está en
    el carro; además la fila del acabado agregado marca `✓` en lugar de `+`.

### P-43 · Click en la carta → pop-up de detalle
- Componente nuevo **`components/domain/CardDetailModal.tsx`** (reusa el `Modal` §7.6 → cierra por
  **backdrop + Esc + botón**, con foco/aria-modal). Muestra **imagen grande** (`imageLargeUrl` con
  fallback a `imageSmallUrl`) + datos (nombre, set·#, acabado, rareza, precio estimado). AGREGAR
  sigue siendo su propia acción, aparte del click de detalle (el arte es su propio `<button>`).
- **Cableado:** grid raw (`QuoterTile`, modal por teja) y grid plano (`BuylistView`, estado
  `detailCard` único). `TileHeader` (binder compartido) ganó `onImageClick` opcional: SOLO el
  cotizador lo pasa; el binder admin/bóveda NO (allí la teja entera ya es `<button>` → evita botón
  anidado).
- **Nota de imagen grande en el binder:** `MasterSetCardCellDTO` no lleva `imageLargeUrl`, pero el
  binder del cotizador se compone client-side desde `GET /buylist/cards` (`CardDTO` SÍ la trae), así
  que se propaga por un mapa client-only `imageLargeByCardId` en `QuoterBinderResponse` (sin tocar el
  DTO del contrato). En modos no-quoter no aplica (usarían la imagen chica como fallback).

### P-44 · Rareza en las tejas
- Componente nuevo **`components/domain/RarityLabel.tsx`** (gemelo de `FinishMark`: mono muted, sin
  pastilla; vive en `components/domain` junto al `FinishMark` canónico del rediseño). El VALOR de rareza es taxonomía ABIERTA de pokemontcg.io → se pinta crudo con
  `lang="en"` (no se traduce); lo único i18n es el prefijo accesible (`catalog.rarityAria` →
  «Rareza: …»). Devuelve `null` para sellado o rareza vacía.
- **Cableado:** `CatalogTile` (catálogo), grid plano del cotizador (`BuylistView`) y `TileHeader`
  del binder — este último COMPARTIDO, así que la rareza aparece también en el **binder admin M1 y
  las bóvedas** (lo pedido por P-44). Se lee de `CardDTO.rarity` / `MasterSetCardCellDTO.rarity`
  (ambos ya presentes en el contrato — **ningún DTO tuvo que cambiar**).

### DTOs y contrato
- **Todos los DTOs necesarios ya traían `rarity`, `imageLargeUrl`/`imageSmallUrl`** — no hubo que
  editar `docs/API_CONTRACT.md` ni `types/contract.ts` para datos. **Sin solicitudes al arquitecto.**
- Único matiz reportable (no bloqueante): el binder Master Set (`MasterSetCardCellDTO`) no expone
  `imageLargeUrl`; en el cotizador se resolvió client-side (ver P-43). Si en el futuro se quiere la
  imagen grande en el detalle del binder de INVENTARIO (M1/bóveda), habría que sumarla al DTO —
  eso sí pasaría por el arquitecto.

### Tests añadidos/ajustados
- `_home/HomeQuoter.test.tsx` (nuevo): la búsqueda pide `pageSize: 20`; affordance «Ver más» → `/buylist`.
- `buylist/BuylistView.test.tsx`: P-42 carrito fijo en desktop (mock `matchMedia` → sin FAB/drawer,
  total y CTA visibles sin abrir nada) + sombreado «En el carrito»; P-43 modal abre por click en el
  arte y cierra por backdrop y por Esc; P-44 rareza visible en tejas. Se acotó un assert previo de
  «Rare Holo» al diálogo del carrito (ahora la rareza también vive en las tejas).
- `components/domain/RarityLabel.test.tsx` (nuevo): valor crudo + aria localizado; null en sellado y
  en rareza vacía.
- `catalog/CatalogTile.test.tsx`: rareza visible con aria «Rareza: Rare Holo».

**Verde:** `vitest run` **77 archivos / 612 tests** ✓, `tsc --noEmit` ✓, `next build` ✓.

---

## Pase v1.41/v1.42 — sellado con identidad real + regresión de composición de variantes (rama `fix/variant-composition-regression`)

Consume los campos nuevos del contrato v1.41 (IMP-1) y v1.42 (BLOQ-2a/2b/3, menores) y cierra los
hallazgos del gate E2E. Todo confinado a `frontend/`. Money-safe respetado: sin precio ⇒ «pendiente»/«—»,
NUNCA $0.

### Tipos (espejo del contrato) — `src/types/contract.ts`
- +`SealedPriceSource = 'tcgcsv' | 'off'` (dial §M10).
- `SealedProductDTO` +`effectiveMarketCents: number | null` (autoritativo, gateado por `sealedPriceSource`);
  `marketRef` reetiquetado como INFORMATIVO.
- `SealedProductListResponse` +`sealedPriceSource`.
- `HoldingDTO` +`sealedProductId?/sealedProductName?/sealedImageUrl?/sealedCondition?` (solo sealed; display
  ya RESUELTO server-side por la cascada §4.34a).
- `PendingPriceEntryDTO` +`sealedProductId?/sealedProductName?/sealedSubtype?` (solo sealed).

### IMP-1 (v1.41) — dead-end del alta de sellado eliminado
`src/app/[locale]/(admin)/admin/m1/SealedAddFlow.tsx`
- La visibilidad del campo manual y el copy «valor de mercado» ahora KEYEAN en
  `selected.effectiveMarketCents` (autoritativo, gateado), no en `marketRef`/caché (`liveMarketCents`
  eliminado):
  - `gatedMarketCents = selected?.effectiveMarketCents ?? null` (~L175).
  - `showManualField = selected != null && gatedMarketCents == null && canManualMarket` (~L188).
  - `resolvedMarketCents = gatedMarketCents ?? (manualValid ? manualCents : null)` → pasa a
    `QuickAddSection.marketRefCents` (~L186, L419).
  - `manualMarketMxnCents` viaja solo si `gatedMarketCents == null && manualValid` (~L414).
  - `SelectedSummary` recibe `gatedMarketCents` y pinta el chip de mercado desde ese valor (~L370, L512).
  - `marketRef` queda como sugerencia informativa opcional cuando no hay mercado gateado, vía nuevo prop
    `suggestionCents`/`locale` de `SealedManualMarketField.tsx` (+ i18n `admin.sealedAdd.manualMarket.suggestion`).
- Invariante logrado: lo que la UI ofrece == lo que el backend acepta (con dial `off`, `effectiveMarketCents`
  es null ⇒ muestra manual; nunca promete un mercado que daría 422). Regresión cubierta por test nuevo
  «IMP-1 (dead-end): dial off …» en `SealedAddFlow.test.tsx`.

### BLOQ-2a (v1.42) — «Mis piezas» del cliente con identidad real del sellado
`src/app/[locale]/(storefront)/vault/VaultView.tsx` (~L280): para `productType==='sealed'`,
`displayName = sealedProductName ?? card.name`, `displayImage = sealedImageUrl ?? card.imageSmallUrl`.
raw/graded intactos. Mock: holding sealed `inv-1008` ganó identidad (`sealedProductName`/`sealedImageUrl`/…).

### BLOQ-2b (v1.42) — cola M2 muestra el nombre del sellado
`src/app/[locale]/(admin)/admin/m2/sections/PendingQueueSection.tsx`: helper `pendingDisplayName(e)` usa
`sealedProductName` para sealed; se aplica en ambas columnas (venta/compra) y en el modal de override.
Mock: entradas `ppe-3`/`ppe-4` (ETB vs blíster del mismo set) como pendientes SEPARADOS por `sealedProductId`.

### BLOQ-3 (v1.42) — el binder no muestra sellado como single
Mock `piecesOfScope` (fixtures) ahora EXCLUYE `productType==='sealed'` de los conteos del binder (platform y
user_vault), alineado con el backend. La UI del binder es data-driven (variants/countsByFinish) y no cuelga
tejas de sellado; el sellado se ve solo en M1›«Sellado» y bóveda›«Sellado».

### IMP-2 — badge «N EN TOTAL» ya no queda stale tras la baja
`src/components/master-set/MasterSetBinder.tsx` (`TileHeader`): el total por carta se DERIVA de
`countsByFinish` (que por contrato suma a `totalCount`), la misma fuente de la respuesta con la que cada
teja decide su conteo/«HUECO». Al bajar la última pieza, la suma cae a 0 y el badge desaparece sin recargar;
antes leía el escalar `cell.totalCount`, que podía quedar rezagado respecto a los conteos por acabado.

### Menores (display)
- M1›Sellado›lista de sets: se quitó el UUID interno pegado al nombre (`SealedTab.tsx` ~L106; solo el nombre).
- Badge «N SIN MAPEO» → «N sin precio» y enlace «Cola de no mapeados» → «Cola de precios pendientes»
  (i18n `admin.inventory.sealedTab.unmappedBadge`/`unmappedQueue`, es+en) — el dato cuenta piezas SIN PRECIO,
  no sin mapeo.
- Hero de «Compra»: «N piezas disponibles» → «N publicaciones disponibles» (i18n `catalog.piecesAvailable`,
  es+en) — el total es de publicaciones agrupadas (GroupedListing), no de piezas físicas.
- Ruido 401 en navegación admin: `src/lib/api-client.ts` gana REFRESH PROACTIVO — decodifica el `exp` del
  access JWT (`isAccessTokenExpired`, sin validar firma) y, si venció y hay refresh token, renueva ANTES de
  disparar la request (single-flight), evitando el 401 garantizado y su ruido en consola en cada navegación.
  El fallback reactivo 401→refresh→retry queda intacto. Causa raíz acotada en el cliente de API.

### Verde
`tsc --noEmit` ✓ · `vitest run` **78 archivos / 616 tests** ✓ (incluye test nuevo de regresión IMP-1) ·
`next build` ✓.

## Gate E2E pre-publicación — fixes (rama `fix/variant-composition-regression`)

### IMP-A — el stepper del carrito de venta ya no revienta la página con cantidades absurdas
`src/app/[locale]/(storefront)/buylist/useSellCart.ts`: teclear un número gigante (p. ej.
`646180157000000004`) en «Cantidad de {carta}» llegaba crudo hasta `requestItems`
(`Array.from({ length: l.quantity }, …)`, L159) y lanzaba `RangeError: Invalid array length`
(los arrays JS topan en 2³²−1) → «Application error», pantalla blanca. Fix money-safe (el monto lo
re-deriva el backend; esto es robustez de UI):
- Nuevo `MAX_LINE_QUANTITY = 999` (tope defensivo — no hay límite de stock explícito en el cotizador)
  y helper `clampQuantity(n)` → entero en `[1, 999]`, `NaN`→1.
- `setQuantity` clampa (cubre input numérico y botones ±, todos pasan por ahí), `mergeCartLine`
  clampa el `+1`, y `requestItems` clampa el `length` como última barrera. El `<input>` de
  `SellCartContents.tsx` gana `max={MAX_LINE_QUANTITY}`.
- Test de regresión en `BuylistView.test.tsx` («una cantidad gigante … se clampa al tope (999)»):
  el change no lanza, la vista sigue montada y la cantidad queda en 999.

### IMP-B — pagar antes de convertir ya no atora la carta en «Cerradas»
`src/app/[locale]/(admin)/admin/m5/M5View.tsx`: la rama «Cerradas» (~L675) renderizaba los ítems
read-only «sin acciones», así que tras «PAGAR POR SPEI» (solicitud → `pagada`) desaparecía «Convertir
a inventario» aunque el ítem siguiera `aprobada` y el backend SÍ lo permita (el guard de
`POST /admin/buylist/items/:id/convert-to-inventory` mira el `itemStatus`, no el estado de la
solicitud; contrato §M5 líneas 4694/4699: solo `aprobada` convierte). Fix:
- En «Cerradas», cada ítem con `itemStatus === 'aprobada'` (pagada la solicitud pero NO convertido)
  ofrece el botón «Convertir a inventario», que dispara el `convertMutation` existente (sin endpoints
  nuevos). Los `convertida_inventario`/`rechazada` no lo muestran (badge de estado ya los distingue).
- `convertMutation.onSuccess` ahora invalida también `['admin-buylist-closed']` para repintar el ítem
  como convertido sin recargar.
- Tests de regresión en `M5View.test.tsx`: (a) solicitud `pagada` con ítem `aprobada` → aparece el
  botón y el clic llama `convertBuylistItemToInventory('sr-c9-i')`; (b) ítem `rechazada` en «Cerradas»
  → NO ofrece convertir.

### Menores (display)
- **Quick-add de sellado (aportación bloqueada):** `QuickAddSection` es compartido entre el quick-add de
  variante M1 (sin campo manual inline → «fíjalo en la sección Precios») y el add-flow de sellado (con
  campo manual INLINE). Se agregó prop `hasInlineManualField` a `QuickAddSection`
  (`m1/QuickAdd.tsx`); `SealedAddFlow.tsx` la pasa como `showManualField`. Nuevo copy
  `admin.quickAdd.contrib.pendingBlockedInline` (es+en): apunta al campo manual de arriba en vez de
  mandar a otra sección. El hint `admin.sealedAdd.manualMarket.pendingIfEmpty` se realineó: ya no dice
  «la aportación quedará pendiente de precio» (contradecía la radio deshabilitada) sino que la aportación
  queda DESHABILITADA hasta capturar el precio manual de arriba.
- **Cola pendiente M2 pintaba «… #4» en sellado:** `m2/sections/PendingQueueSection.tsx` (ambas columnas
  venta/compra): el `#número` era el de la CARTA ANCLA, no de la pieza de sellado. Ahora solo se pinta
  para `productType !== 'sealed'`.

### Verde (gate pre-publicación)
`tsc --noEmit` ✓ · `vitest run` **78 archivos / 619 tests** ✓ (incluye los 3 tests nuevos de regresión
IMP-A/IMP-B) · `next build` ✓.

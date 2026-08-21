# PENDIENTES — TCG Vault MX

Lista viva de cosas que el humano va observando en el producto. Se van moviendo a "En curso" /
"Hecho" cuando se aborden. Añade nuevos como `P-#`.

---

## Abiertos

### ~~P-1 · Botón de "Cerrar sesión" en admin~~ ✅ HECHO (rama `fix/m1-alta-inventario`)
- **Observado:** no hay forma de cerrar sesión desde el panel de admin.
- **Resuelto:** el botón "Cerrar sesión" del `AdminTopbar` ya existía y funciona (limpia
  access/refresh/user y bloquea la re-entrada a rutas admin) — verificado en navegador. Pulido:
  `onLogout` usa `router.replace('/login')`. Deuda menor FE-34 (el guard de `AdminShell` impone
  `/login?next=…`, cosmético). Doble veredicto qa+techlead APROBADO.

### ~~P-2 · Barra de avance al sincronizar catálogo~~ ✅ HECHO Y EN `main`
- **Observado:** al sincronizar no se sabía cuánto faltaba ni cuándo terminaba ("a ciegas") y el
  banner "encolado" se leía como "listo".
- **Resuelto:** `GET /admin/catalog/sync-status` expone `{running, total, done, startedAt, finishedAt}`
  (estado en memoria; no audita ni pega a pokemontcg.io; documentado en contrato §M2 v1.10). M2 lo
  pollea cada 3 s mientras corre, pinta una barra honesta `done/total` + "corre en segundo plano", y al
  terminar muestra "completada". La columna Cartas ahora muestra `cardCount / printedTotal` por set.
  Triple veredicto APROBADO (qa+techlead+seguridad) y promovido a `main`. Deuda: BE-11/BE-12, FE-9/FE-10.

### ~~P-3 · No aparecen todas las versiones/acabados de la misma carta al dar de alta~~ ✅ HECHO (rama `fix/m1-alta-inventario`)
- **Observado:** al **dar de alta** inventario, en el set **"Pitch Black"** salen **pocas opciones**,
  pero aparecen **120 sincronizadas**. Hay desajuste entre lo sincronizado y lo que ofrece el alta.
- **Diagnóstico:** el backend del selector de alta (`GET /buylist/cards` → `catalog.searchAllCards`,
  fuera de nuestro ámbito, es correcto) devuelve TODAS las cartas paginadas con sus `availableFinishes`;
  el frontend ya paginaba y pintaba los acabados. Verificado con un set de prueba de 120 cartas: el
  selector llega a **120/120** (badges + selector de acabado, `reverse_holo` incluido). El síntoma real
  ("pocas opciones") era el **dato stale de `availableFinishes`** (arreglado por la rama
  `fix/variantes-y-orden-master-set`, ya en `main`) — **requiere re-sync en prod**
  (`POST /admin/catalog/sync-all {"force":true}`, ver nota del master set). Pulido nuestro: `PAGE_SIZE`
  del buscador 20→50 (menos clics de "Cargar más"). Doble veredicto qa+techlead APROBADO.

### Nota 2026-08-18 · Variantes/orden del master set — HECHO Y EN `main` (rama `fix/variantes-y-orden-master-set`)
- **Qué se cerró (doble veredicto QA+techlead, verificado en navegador):** cada carta del binder
  (cotizador, M1, bóvedas) muestra **una casilla de imagen por variante real** (normal izquierda,
  reverse holo derecha; sin relleno); el orden es **por número** (M-26, persistido en BD, paginación
  determinista); en admin el alta dice y hace **«Dar de alta al inventario»** con resultado visible
  dentro del modal (antes el paso de confirmación quedaba tapado por el overlay: por eso «no pasaba nada»).
- **Causa de fondo de que solo se pintara una variante:** `availableFinishes` se derivaba de PRECIOS
  (y el price-ingest lo sobrescribía con solo lo que tenía precio). Ahora la única autoridad es el
  sync de catálogo. **⚠ ACCIÓN REQUERIDA EN PROD:** los sets ya importados siguen en `['normal']`
  hasta re-sincronizar: `POST /api/v1/admin/catalog/sync-all` con body `{"force": true}` como
  super_admin (detalle en `docs/BACKEND_NOTES.md §49.7`). Sin ese re-sync, Pitch Black seguirá
  mostrando una sola casilla por carta.
- **Relación con P-3/P-4:** ataca la parte de «acabados/versiones» de P-3 y el patrón de «no pasa
  nada» de P-4 en el flujo del master set; el alta clásica (formulario «Alta de item») y el resto de
  P-3/P-5 siguen abiertos como están anotados.

### ~~P-4 · Al crear inventario y dar "Crear" no pasa nada (sin confirmación)~~ ✅ HECHO (rama `fix/m1-alta-inventario`)
- **Observado:** das de alta un item, clic en **Crear**, y **no hay ningún mensaje** (ni éxito ni error);
  no se sabe si se creó.
- **Qué era en realidad:** el caso **(a) falla en silencio**. Con la adquisición **default "aportación
  en especie"** sobre una carta **sin precio de referencia** (la mayoría hoy, por P-6), el backend
  responde **422 `PRICE_PENDING`** y NO crea nada (money-safe, intencional); el banner de error SÍ se
  renderizaba pero **al fondo del modal scrolleable, fuera del viewport** → "no pasa nada". El camino
  "compra" (201) sí confirmaba. Confirmado en navegador contra el backend real.
- **Resuelto (solo frontend):** el error va **anclado arriba** del modal (sticky, `role="alert"`,
  scrollIntoView + foco) con copy de operador para `PRICE_PENDING`; el éxito muestra **toast con folio**
  + refresca la lista. NO se tocó el backend (su respuesta ya era correcta). Doble veredicto
  qa+techlead APROBADO, verificado en navegador.

### ~~P-5 · Alta masiva (varias cartas a la vez, no una por una)~~ ✅ HECHO (rama `fix/m1-alta-inventario`)
- **Observado:** hoy el alta es **de una en una**; debería poder darse de alta **varias al mismo tiempo**.
- **Resuelto (solo frontend, sin cambio de contrato):** multi-selección en el mismo modal que arma
  `items[]` y llama `batchCreateItems` (`POST /admin/inventory/items/batch`, endpoint que YA existía).
  Resultado **tolerante por-ítem** (folios de las creadas + fallos con motivo, p.ej. `PRICE_PENDING`),
  `batchKey` idempotente (se renueva tras éxito → un reintento por timeout es replay, no duplica).
  Guarda de dinero: el lote **no admite gradeadas** (cert único por slab). Verificado contra el backend
  real (lote mixto: unas creadas, otras rechazadas por-línea). Doble veredicto qa+techlead APROBADO.

> **Nota:** P-3, P-4 y P-5 son todos del **flujo de alta de inventario (M1)** y apuntan a que esa
> pantalla tiene un problema de fondo (no muestra todo, no confirma, no permite lote). Conviene
> atacarlas juntas en una ronda cuando se decida.

### P-6 · El proveedor de precios de PAGA no escribe ni un precio: el adapter llama mal a su API
- **Observado:** con la API de paga (PokemonPriceTracker) ya contratada, la key en Railway,
  `POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars` puesta y el dial `price_provider` ya flipeado desde M2,
  el cotizador **sigue mostrando "Precio pendiente"**. El PO verificó que el proveedor **sí tiene** los
  precios del set. Las cartas que sí muestran importe (MX$1.00 / MX$0.50) son pisos fijos por rareza y
  **enmascaran** el problema: no pasan por el mercado.
- **Diagnóstico (devops, `DEVOPS_NOTES §23.9`):** el adapter hace
  `POST /api/v1/cards/bulk-price` con `{ set, limit, page }`, pero ese endpoint del proveedor espera una
  **lista explícita** `{ cardIds: [...] }`. El barrido por set es otro endpoint:
  `GET /api/prices?setId=<ids>&limit=<n>` → `{ data, pagination }`. Con el cuerpo no reconocido el
  proveedor responde 4xx, el `catch` money-safe devuelve **0 filas sin borrar nada**, y el resultado es
  cero `PriceReference` → todo lo que cotiza por regla `pct` queda pendiente. Son exactamente los tres
  `SUPUESTO (verificar 1ª corrida)` que el propio adapter dejó anotados.
- **Qué implica:** cambio **acotado en backend** (`modules/pricing/providers/pokemonpricetracker-bulk.provider.ts`):
  cambiar el request a `GET /api/prices?setId=…` paginando por `pagination`, verificar que `cardNumber`
  del proveedor empate con `resolveCardId` (`"104"` vs `"104/159"`) y ajustar el tope real de `limit`.
  El mapeo probablemente NO se toca (ya lee `marketPrice` y `printing`). Ninguna palanca de devops
  (dial, env, cron) puede arreglarlo: el request sale mal formado desde el código.
- **Estado de la verificación (honesto):** causa **probable**, no confirmada en runtime — el egress del
  sandbox bloquea el dominio del proveedor, así que la fuente es su documentación pública, no una corrida.
  **Confirmación barata (1 línea):** filtrar `PokemonPriceTracker` en los Deploy Logs de Railway →
  `set <id> falló: HTTP 400/404 … Se devuelven 0 filas` confirma el diagnóstico; si en cambio aparece
  `ejemplo de entrada cruda`, el request sí pasó y el problema sería de **mapeo**, no de endpoint.
- **A decidir por el humano:** (a) lanzar ya al rol **backend** con esta especificación, (b) pedir primero
  esa línea de log para confirmar antes de gastar el turno, o (c) dejarlo en cola y seguir con los
  pendientes de M1 (P-3/P-4/P-5). **Bloquea** que el catálogo tenga precios de referencia: hoy el
  proveedor legacy (pokemontcg.io) responde 500/502 en masa, así que sin este fix **no hay ninguna fuente
  de precios viva**. Lo ya configurado (dial, `MARKET_FORMAT`, scheduler) sirve tal cual cuando se arregle.
- **NO tocar:** las reglas de buylist (`BUYLIST_PRICE_RULES` / fallback) están como el PO las quiere —
  el problema es la referencia de mercado que alimenta la regla, no la regla.

### P-12 · Sync de UN set específico (cartas + precios) desde el botón junto al set
- **Observado (2026-08-21):** los sets recientes ya cargan bien, pero los viejos solo traen algunas
  cartas; re-sincronizar TODO cada vez es poco práctico. Pregunta del humano: ¿el botón junto a cada
  set ya trae cartas **y** precios?
- **Diagnóstico:** el botón por set ("Importar"/"Re-sincronizar", `M2View.tsx:602-616`) llama
  `POST /admin/catalog/sync {setId}` y **solo** trae metadata + todas las cartas del set desde
  pokemontcg.io (`catalog-sync.service.ts:316-325`). **NO toca precios** (desde WS-A §4.15g el pricing
  vive solo en `price-ingest`) y **NO refresca variantes estructurales TCGCSV** (el
  `StructuralFinishResolver` solo corre en first-import o `sync-all {force:true}` — asimetría en
  `catalog-sync.service.ts:290-313`).
- **Lo bueno:** el backend YA tiene `POST /admin/jobs/price-ingest {setId}` (barrido completo del set,
  bypass del scope <2020, `admin-jobs.controller.ts:192-207`) y el cliente `triggerPriceIngest({setId})`
  ya existe en `api.ts:2574` — **nadie lo llama con setId desde la UI**.
- **Qué falta:** (backend) aceptar `force` en la ruta por set para refrescar variantes TCGCSV de un solo
  set; (frontend) botón/acción por fila que encadene sync de cartas + price-ingest del set. Además el
  copy de `es.json:1269` miente ("repuebla precios" ya no es cierto) — corregirlo.
- **Nota precios sets viejos:** por diseño (`ppt-sync-scope.ts`), sets <2020 solo ingieren precios de
  cartas con inventario o rareza premium (cuota del proveedor). El sync manual por set SÍ fuerza el
  set completo.

### P-13 · Variantes fantasma: ex con "Normal", secret rares duplicadas, hasta 3 versiones
- **Observado (2026-08-21):** las cartas ex aparecen con Normal + Holofoil (misma imagen) cuando solo
  existe UNA versión; en algunos casos 3 variantes; secret rares con 2 cuando solo hay 1. Pregunta:
  ¿levantamos bien o adivinamos?
- **Diagnóstico:** NO adivinamos por rareza — la capa estructural TCGCSV es fiel (una ex sale
  `['holofoil']`, test en `catalog-sync.structural.spec.ts:78-95`). El bug es que `availableFinishes`
  es la **UNIÓN** estructura ∪ precio (`card-order.ts:71-77`) y dos fuentes de precio meten variantes
  inexistentes:
  1. **Barrido `fetchPrintings` de PPT** (`pokemonpricetracker-bulk.provider.ts:46-50, 554-556`): el
     finish se atribuye por la **etiqueta del request** (`printing=Normal`), no por el dato de la carta
     → si PPT devuelve la ex en ese barrido, se le pega un `normal` CON precio. Causa principal.
  2. **Seed de pokemontcg.io en CREATE** (`catalog-sync.service.ts:436-441`): sub-llave `normal`
     presente (aunque `market:null`) o default `['normal']` si no hay dato.
  La mitigación N-15 (`computeDisplayFinishes`) no salva este caso: solo oculta acabados SIN precio, y
  el `normal` fantasma de PPT viene con precio. Además `card-order.ts:60-61` documenta una
  intersección que el código no implementa (hace unión).
- **Fix propuesto (backend + arquitecto):** (a) `pricedFinishesSnapshot` debe **intersectar** con
  `structuralFinishes`, no unir (alinear código con su propio comentario); (b) revisar/apagar la
  atribución de finish por etiqueta de request en `fetchPrintings`; (c) tras el fix, re-sync forzado
  para limpiar seeds heredados.

### P-14 · Diferenciador visual entre variantes (misma imagen en el cajón)
- **Observado (2026-08-21):** ahora que salen las dos variantes, la imagen es idéntica y no se
  distingue Normal de Reverse Holo de un vistazo. Propuesta del humano: un diferenciador en el cajón
  de la carta (color tenue distinto, etc.).
- **Confirmado:** hay UNA sola imagen por carta compartida por todas las variantes (sin campo de imagen
  por finish; `MasterSetBinder.tsx:337, 365`); hoy solo cambia la etiqueta de texto.
- **Qué falta:** (ux-ui define, frontend implementa) tratamiento visual por acabado en la teja del
  binder/cotizador/inventario — p.ej. borde/fondo tenue por finish, badge de color, o efecto foil
  sutil para reverse/holo. Aplica a cotizador, M1 y bóvedas.

### P-15 · Precio de mercado en inventario NO distingue variante (buylist sí)
- **Observado (2026-08-21):** en inventario el precio "Mercado" es idéntico para Normal y Reverse Holo;
  en compra/buylist sí difieren. Pregunta: ¿referenciamos dos listas?
- **Diagnóstico:** NO hay dos listas — ambos leen la misma `PriceReference` (que SÍ es por variante:
  `finish` en la clave única, `schema.prisma:620`). Es un **bug de lectura del binder Master Set**:
  `master-set.service.ts:437-445` pide UNA referencia por carta con el acabado BASE
  (`availableFinishes[0]`) y la expone a nivel **celda**, y la teja por variante pinta ese dato de
  celda (`MasterSetBinder.tsx:422`) → Normal y Reverse muestran lo mismo. El buylist sí pasa el finish
  real (`buylist.service.ts:184-187`). Es el ÚNICO consumidor de precios del backend que no propaga el
  finish.
- **Fix propuesto:** mover `marketReferenceMxnCents` de `MasterSetCardCellDTO` a `MasterSetVariantDTO`
  y expandir el batch por (carta × acabado) — **cambio de contrato ⇒ pasa por arquitecto (regla 9)**;
  luego backend + frontend.
- **Ojo (posible causa concurrente):** si `POKEMONPRICETRACKER_FETCH_PRINTINGS` no está en `true` en
  Railway, el proveedor emite UNA fila por carta (impresión primaria) y las reverse no tienen
  referencia propia → aun con el fix saldrían "—". Verificar el dial en prod.

### P-16 · Cotizador: cartas del mismo tamaño que en inventario
- **Observado (2026-08-21):** en inventario las cartas se ven grandes y cómodas; en el cotizador se
  ven más chicas. El humano quiere el mismo tamaño de imagen y redistribuir el layout del cotizador
  para desplegarlas más grandes.
- **Qué falta:** (ux-ui propone la redistribución de la página, frontend implementa) igualar el tamaño
  de teja del cotizador al del binder de inventario; revisar columnas/densidad de la grilla y el
  espacio del carrito lateral.

### P-17 · M1: quitar (o demotar) la vista "Piezas" y quedarse con Master Set
- **Observado (2026-08-21):** al humano le gustaría eliminar la vista de lista "Piezas" del inventario
  y quedarse solo con la visión Master Set.
- **Recomendación del orquestador (decisión del humano pendiente):** NO eliminarla por completo —
  la lista de Piezas es la única vista operativa por copia física (folio, ubicación C01-F01-S01,
  estado en stock/listada, precio manual, detalle por pieza), necesaria para localizar la copia
  exacta en ventas/envíos/auditorías/disputas. Propuesta alternativa:
  1. Master Set como pestaña **por defecto** al entrar a M1.
  2. Piezas deja de ser pestaña hermana y pasa a **drill-down**: clic en una carta/variante del
     Master Set → panel con sus copias físicas (folios, ubicación, estado, detalle).
  3. Conservar el buscador por folio como acceso rápido.
- **Si el humano confirma eliminación total:** primero reubicar folio/ubicación/estado dentro del
  Master Set; si no, se pierde la operación de piezas individuales.
- **Roles:** ux-ui (propuesta de layout) + frontend; sin cambio de contrato aparente (los endpoints
  de items ya existen).
- **Nota del humano (2026-08-21):** el sistema de bóveda **físico** (ubicaciones, etc.) lo va a
  definir él después — no preocuparse por eso al decidir esta vista.

### P-18 · Master Set como consola de precios: mercado + compra + venta, con sugerido y override
- **Pedido del humano (2026-08-21):** en el Master Set, cada carta (por variante) debe mostrar y
  permitir gestionar TRES precios:
  1. **Precio de mercado** — la referencia (ya cubierto por P-15: por variante).
  2. **Precio al que compramos** — con **valor sugerido** calculado por la regla que ya traemos
     (reglas de buylist por rareza/acabado sobre la referencia de mercado) y **override manual**.
  3. **Precio al que vendemos** — con **valor sugerido** por regla y **override manual**.
- **Base existente:** la regla de compra ya existe (`BUYLIST_PRICE_RULES` / cotización por
  rareza+acabado en `buylist.service.ts`); hay "precio manual" por pieza en inventario. Verificar al
  arrancar si existe regla de precio de VENTA o hay que definirla (product-owner/arquitecto).
- **A definir (arquitecto, cambia contrato):** dónde vive el override — ¿a nivel carta+variante
  (nuevo, en Master Set) o por pieza (el precio manual actual)? ¿El override de venta pisa el precio
  listado en storefront? ¿El de compra pisa la cotización del buylist público? Definir precedencia:
  override manual > regla sugerida > sin precio (money-safe, nunca inventar).
- **Roles:** arquitecto (contrato/semántica) → backend (persistencia de overrides + cálculo de
  sugeridos por variante) + frontend (edición inline en la teja del Master Set) en paralelo.
- **Depende de:** P-15 (precio de mercado por variante) y se beneficia de P-13 (sin variantes
  fantasma, para no sugerir precios de versiones inexistentes).

### P-19 · Simplificar el "Alta rápida al inventario" del Master Set
- **Pedido del humano (2026-08-21, viendo el modal de alta rápida):**
  1. **Fuera "Aportación en especie" y su %** — el concepto no se entiende; hacerlo más simple.
  2. **Fuera el dropdown de acabado/versión** — ya se picó la casilla de la variante (Normal o
     Reverse Holo); el acabado viene dado por la casilla, no se vuelve a preguntar.
  3. **Fuera el campo de ubicación** — no se necesita (la bóveda física la definirá él después,
     ver nota en P-17).
  4. El alcance del inventario es: **altas, bajas y precios de la carta** — nada más.
  5. **(añadido 2026-08-21) Publicar inventario: total o por piezas.** Además del "Publicar piezas
     de esta carta" que ya existe en el modal (selección por folio), falta poder **publicar TODO el
     inventario de golpe** (o todo lo de un set/filtro) sin ir carta por carta. Mantener la guarda
     existente: publicar sigue gateado a que la pieza tenga precio (refresca mercado → precia → lista);
     un "publicar todo" debe reportar por-pieza qué se publicó y qué quedó pendiente por falta de
     precio, sin reventar el lote completo (mismo patrón tolerante que el alta masiva P-5).
- **Forma objetivo del alta rápida:** picas la casilla de la variante → pides **cantidad** y
  **precio al que compramos** (prellenado con el sugerido de la regla, editable = el override de
  P-18) → alta. Un paso, sin conceptos financieros intermedios.
- **A definir (product-owner/arquitecto):** qué pasa con el tipo de adquisición en el modelo — ¿se
  elimina del flujo y queda un default interno ("compra") o desaparece del contrato? Ojo: el 422
  `PRICE_PENDING` de "aportación en especie" era el origen de P-4; al simplificar, revisar que el
  camino único no herede ese tropiezo. Las bajas (venta/merma) deben quedar igual de simples.
- **Roles:** product-owner (aterrizar el flujo simple) → arquitecto si cambia contrato → backend +
  frontend.

### P-20 · Inventario separado para cartas gradeadas (PSA) con sus valores de mercado
- **Pedido del humano (2026-08-21):** además de las sueltas, poder guardar si tenemos **PSA** de
  esas cartas, en un inventario **separado**, con **sus valores de mercado** (el precio de una
  PSA 10 no es el de la carta suelta).
- **Base existente:** el modelo ya distingue `productType` raw/graded y `gradeKey` (los slabs con
  cert único ya existen en el alta clásica); falta la vista/gestión separada y la referencia de
  mercado por grado.
- **Qué falta:** (a) vista de inventario PSA separada de sueltas (¿pestaña propia o filtro del
  Master Set con badge de grado?); (b) precio de mercado por carta+grado — verificar si el
  proveedor de precios da precios de gradeadas (PSA 10/9...) o si el valor será manual (override
  de P-18 aplicado a gradeadas); (c) alta rápida de una PSA desde el Master Set (grado + cert +
  precio de compra).
- **Roles:** product-owner (definir alcance con el humano) → arquitecto (contrato de referencias
  por grado) → backend + frontend.

---

## En curso / Hecho (referencia)
- **Gráfica pública de valor de set** — hecha y desplegada; falta encenderla con datos (runbook `DEVOPS_NOTES §17`).
- **Fix de seguridad (cifrado INE) + reparación de CI** — ✅ fusionado a `main`. Deuda de CI (poda de imagen
  Docker, self-host de fuente, E2E) aceptada y anotada.
- **P-11 · Gating temprano del flujo de venta** — ✅ triple veredicto APROBADO y en `main`. El cotizador
  comunica los requisitos (sesión, correo verificado, CLABE/INE) ANTES de enviar, en vez de reventar con
  un 403 críptico al final. Deuda menor anotada: FE-7, FE-8, FE-11.
- **Fix contrato `clabeMasked`** — ✅ en `main`. `GET /users/me/kyc` devolvía la CLABE enmascarada bajo la
  clave `clabe`; el contrato/front usan `clabeMasked`, así que el hint "CLABE ya registrada" nunca aparecía.
- **P-2 · Status del barrido de catálogo** — ✅ en `main` (ver arriba).

# ARCHITECTURE.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **arquitecto**. Fuente de verdad de decisiones técnicas y modelo de datos.
> Manda `PROJECT.md` sobre este documento, y este documento sobre el código.
> Rev v1.47-manual-override-perennial-candidate (2026-08-24, rama `fix/variant-composition-regression`, arquitecto —
> DISEÑO EN PAPEL; lo implementa BACKEND). **Re-gate seguridad + techlead sobre P47-2.** El re-gate halló que el
> **punto 4 de §4.27f-2 (v1.46) era INCOMPLETO**: afirmaba «el fix vive por completo en el comparador; ninguna
> migración, ninguna re-resolución», pero eso solo aplica a las rutas de lectura **sin cota** (`getReferencesBatch`,
> `getSeparateProductsByCard`). Las rutas **single-item** `getReference`/`getReferenceByCardProduct` acotan candidatas
> con `take SAME_DAY_REF_CANDIDATES (=32)` bajo `orderBy capturedDate desc`; como el override manual tiene
> `capturedDate` FIJO y `tcgcsv_singles` suma ~1 fila/día **sin purga**, tras ~32 días el manual **cae fuera de la
> ventana top-32** y el comparador nunca lo ve → el feed vuelve a pisar el precio humano **en silencio**. **Dictamen
> (§4.27f-3, NORMATIVO):** la durabilidad cross-day de (f-2) son **DOS capas** — (a) el comparador `isBetterRef` (tier
> manual absoluto, ya hecho) y (b) la **SELECCIÓN de candidatas**, que DEBE incluir SIEMPRE toda fila manual de la
> clave (**candidata perenne**, sin cota de fecha ni de recencia). Los TRES/cuatro caminos de lectura deben ser
> **consistentes**: los batch ya cumplen (sin `take`); los single-item deben alinearse. Se **deroga** el comentario de
> `SAME_DAY_REF_CANDIDATES` («solo pueden ganar las filas del día más reciente» — falso desde (f-2)). Sigue siendo
> **precedencia de LECTURA pura** (sin migración, sin re-resolución de filas escritas, sin cambio de schema/contrato):
> solo cambia **qué filas se seleccionan** en single-item. Dirección a backend: cumplir el **invariante de candidata
> perenne** (opciones aceptables: lectura dirigida del manual sin cota unida a las candidatas del día; pin del tier
> manual en la query; o quitar el cap para esta clave ya acotada por filas-por-clave) — el «cómo» lo elige backend.
> **Bloqueante del deploy junto con (f-2): (f-2) sin (f-3) deja §K rota con retardo de ~1 mes.** Eco en API_CONTRACT
> (Changelog v1.47-manual-override-perennial-candidate). **Base previa:** v1.46-manual-override-durable-cross-day.
> Rev v1.46-manual-override-durable-cross-day (2026-08-24, rama `fix/variant-composition-regression`, arquitecto —
> DISEÑO EN PAPEL; lo implementa BACKEND). **Escalada regla 9 (seguridad/blue team), hallazgo ALTA P47-2.** Dictamen
> sobre la precedencia de LECTURA §4.27f ANTES de flipear `PRICE_PROVIDER=tcgcsv_singles` en prod. **Problema:**
> `isBetterRef` (`pricing.service.ts`) ordena `capturedDate` ANTES que `sourceRank`, así que el **override manual**
> (`sourceRank=0`, §K máxima precedencia) solo ganaba el MISMO día; al volver `tcgcsv_singles` escritor DIARIO (P-47),
> el barrido lo pisaba cada día siguiente por fecha. **Dictamen (§4.27f-2, NORMATIVO):** el override manual es un tier
> SUPERIOR ABSOLUTO, DURABLE cross-day; `isBetterRef` iza el split manual/no-manual **por encima** de `capturedDate`;
> la frescura desempata **solo dentro del mismo tier** (entre no-manuales, o entre dos manuales). Solo revoca un
> override manual **otro override manual** posterior o la **limpieza explícita por `super_admin`** — **ninguna**
> escritura automática. Es **precedencia de LECTURA** (no reintroduce escritura PPT; `tcgcsv_singles` sigue único
> escritor del barrido). **Sin migración, sin re-resolución de precios persistidos** (el fix vive en el comparador
> puro; la siguiente lectura ya elige el override existente), **sin cambio de forma de contrato**. Money-safe
> FORTALECIDA (cierra la vía por la que un feed automático sobrescribía un precio humano). **Bloqueante del deploy:
> debe mergearse + triple veredicto ANTES del switch de provider.** Eco en API_CONTRACT (Changelog
> v1.46-manual-override-durable-cross-day). **Base previa:** v1.45-fallback-only-is-read-precedence.
> Rev v1.45-fallback-only-is-read-precedence (2026-08-23, rama `fix/variant-composition-regression`, arquitecto —
> DISEÑO EN PAPEL; ratifica implementación de BACKEND). **Escalada regla 9 (techlead), issue P-47/§4.35b.** El techlead
> pidió confirmar/registrar cómo backend implementó «PPT LIST fallback-only» en el barrido diario. **Dictamen:
> RATIFICADA la interpretación de LECTURA.** §4.35(b)/§4.27f mezclaban lenguaje de ESCRITURA («PPT solo escribe la
> `PriceReference` cuando no hay fila `tcgcsv_singles` fresca») con la precedencia de §4.27f, que es de **LECTURA**
> (resolución de la referencia de mercado por `(carta, variante)`). Backend implementó `PRICE_PROVIDER=tcgcsv_singles`
> de modo que **en el barrido corre UN solo provider (TCGCSV singles); PPT bulk NO corre**. Las filas PPT que «se ven
> donde TCGCSV no tiene fila» son **residuo congelado** de antes del switch, que aflora por **precedencia de LECTURA**
> (`sourceRank`/`isBetterRef` sobre `PriceReference`), **NO** por una doble-escritura de fallback en vivo. Es la lectura
> más simple y **money-safe**: un acabado que TCGCSV no cubre **congela** su último precio real (residuo PPT/pokemontcg.io)
> o queda «—»/`PRICE_PENDING` si nunca lo tuvo — **nunca $0, nunca copia entre acabados**; el hueco de un set nunca
> resuelto lo cierra el runbook `--force` por set (§4.27h). **Se rechaza** exigir una doble-escritura de PPT en el
> barrido (reintroduce a PPT como escritor vivo —el path que P-47 neutralizó— por un beneficio marginal ya cubierto por
> `--force`). Reescrito §4.35(b) + nuevo §4.35(f) (dictamen) + aclaración in-situ del bullet de escritura de §4.27f.
> **Sin migración, sin cambio de forma de contrato, sin cambio de código** (ratifica lo implementado). Eco en
> API_CONTRACT (Changelog v1.45-fallback-only-is-read-precedence). **Base previa:** v1.44-per-finish-price-source-daily-sweep.
> Rev v1.44-per-finish-price-source-daily-sweep (2026-08-23, rama `fix/variant-composition-regression`, arquitecto —
> DISEÑO EN PAPEL; lo implementan BACKEND + DEVOPS). **Escalada regla 9 (backend), issue P-47.** Dictamen sobre la
> **fuente de precio por-acabado en el barrido diario**, tras el fix money-safe del aplanamiento de PPT `fetchPrintings`
> (commit `35e948a`). **Decisión:** el barrido diario (`price-ingest`) pasa a **repreciar por-acabado desde TCGCSV
> `tcgcsv_singles`** (fuente PRIMARIA por-variante, §4.27f) **sin re-resolver estructura** (la composición sigue gateada
> a import/`--force`, §4.27d) — mismo patrón estructura↔precio del sellado (`sealed-price-ingest`, §4.19d). PPT baja a
> **LIST fallback-only** y se **APAGA el modo `fetchPrintings`** (dial `POKEMONPRICETRACKER_FETCH_PRINTINGS=false`: costaba
> ~3× por set para producir a lo sumo la impresión primaria que LIST da a 1×). **Corrige §4.25a-2** (premisa FALSA: PPT v2
> expone UN solo `market` invariante al `?printing=`; `fetchPrintings` nunca produjo la `PriceReference` propia de la
> reverse). **Sin migración** (M-31 ya trae `cardProductId`/`tcgcsv_singles`), **sin cambio de forma de contrato**;
> money-safe (acabado sin precio propio de fuente real ⇒ `PRICE_PENDING`/«—», JAMÁS el de otro acabado). Spec normativa:
> **§4.35**; corrección in-situ en §4.25a-2. Eco de contrato en API_CONTRACT (Changelog v1.44-per-finish-price-source).
> **Base previa:** v1.43-sealed-manual-override-survives-dial.
> Rev v1.43-sealed-manual-override-survives-dial (2026-08-23, rama `fix/variant-composition-regression`, arquitecto —
> DISEÑO EN PAPEL; lo implementa BACKEND). Escalada regla 9 del gate E2E, **issue IMP-C**. CLARIFICACIÓN de la precedencia
> §K/§4.23a del sellado — corrige QUÉ gatea el dial `sealedPriceSource`: gobierna **solo la fuente AUTOMÁTICA de mercado
> (ingest TCGCSV)**, NO un **override manual** (`isManualOverride`/`source='manual'`), que **sobrevive al dial `off`**.
> Fix en el **único** predicado `gateSealedMarketCents` (resolver H-1) ⇒ arregla los 4 consumidores; mata el bucle
> `PRICE_PENDING` tras «FIJAR PRECIO» con dial `off`. **Sin migración, sin cambio de shape, money-safe (nunca 0), no es
> decisión de producto.** Frontend sin cambio funcional. Detalle normativo: §4.23a/§4.23d, §10 (SUP-IMP-C), §11 (nota).
> Contrato en API_CONTRACT (Changelog v1.43-sealed-manual-override-survives-dial). **Base previa:** v1.42-sealed-identity-everywhere.
> Rev v1.42-sealed-identity-everywhere (2026-08-23, arquitecto — DISEÑO EN PAPEL; backend/frontend implementan.
> Escalada regla 9 del gate E2E pre-publicación; 3 incoherencias de identidad/conteo del sellado). Dictamen: los 3
> APROBADOS, ADITIVOS y money-safe. **BLOQ-3** — el master-set binder cuenta **SOLO singles**, EXCLUYE `productType='sealed'`
> (alinea con H9; deroga la nota «cualquier productType» de §4.20b y la cláusula «fuera de alcance §4.20b» de §4.23g/M1);
> **resuelve WS-IV-1/WS-IV-2 (§10) para sellado** por mandato explícito del humano (matar «Tropius» en todas las vistas +
> inventario limpio). **BLOQ-2a** — `HoldingDTO` gana la cascada de display de sellado (§4.34a) para no pintar la caja como
> la carta ancla. **BLOQ-2b** — `PendingPriceEntry` gana `sealedProductId` + display y la clave de la cola discrimina por
> `sealedProductId` (ETB y blíster no colapsan). Migración **M-40** (§11, aditiva nullable). Contrato en API_CONTRACT
> (Changelog v1.42-sealed-identity-everywhere). Detalle normativo: §4.20b, §4.20d, §4.23g, §4.34a, §10, §11. **Base previa:**
> v1.38-grouped-listings.
> Estado: v1.38-grouped-listings (MVP, plataforma en producción). Fecha: 2026-08-22. **DISEÑO EN PAPEL (backend/frontend
> implementan; el arquitecto no toca código). P-30 — publicación ÚNICA por carta/variante/condición con STOCK:** el
> catálogo de singles (`GET /catalog/cards*`) pasa de «un `ListingDTO` por copia física» a **`GroupedListingDTO`
> agrupado por `(cardId, productType, gradeKey, finish)` con `stockCount`** (nueva **§4.9a**), reutilizando el patrón del
> sellado (`SealedGroupDTO`). Vivo mientras `stockCount≥1`, agotado (no aparece) en 0. **Sin schema/migración** (grupo =
> agregación en lectura; publicar/despublicar sigue por pieza y el stock derivado se recomputa). Contrato en
> API_CONTRACT (Changelog v1.38-grouped-listings). Coordinación con el **rediseño visual del storefront** documentada en
> §4.9a. **Base previa:** v1.37-pricing-tiers. **DISEÑO EN PAPEL (backend/frontend
> implementan; el arquitecto no toca código). P-34, PROJECT §M v1.9 LOCKED.** El editor de precios de M2 pasa de «una
> regla por CADA rareza canónica» (~30 filas) a «una regla por `tier`» (**5 tiers T0–T4**) + un **mapa rareza canónica →
> tier** compartido por compra y venta. La **naturaleza de la regla no cambia** (`fixed` MX$ / `pct`), la **precedencia
> money-safe no cambia** y el **eje `finish` sigue aparte** (§I): los tiers solo re-expresan el **eje rareza** de
> `PriceRuleSet` (§4.28d), sustituyendo `rarityRules` por `tierRules[ mapa[rareza] ]`. **Único cambio intencional de
> comportamiento: T2 (Rare/Holo) → `pct` 25%.** Cierra tres rarezas `unmapped` money-losing (Mega Hyper Rare, MEGA_ATTACK_RARE,
> Black White Rare). Nuevo **§4.33**; **migración M-38** (DATA/seed, sin DDL); notas para `common/rarity-catalog.ts` y
> `common/pricing-tiers.ts` (nuevo). Contrato en API_CONTRACT (Changelog v1.37-pricing-tiers). **Base previa:**
> v1.31-eval-tcgcsv-fuente-unica. **EVALUACIÓN EN PAPEL
> (ADR, no implementación):** ¿conviene retirar pokemontcg.io y usar **TCGCSV como fuente ÚNICA del catálogo de cartas**
> (identidad + metadata + imágenes), no solo de estructura/precio? Veredicto en §4.30: **HÍBRIDO — no hacer el
> big-bang de re-llaveo**; conservar pokemontcg.io como columna de identidad/metadata/imagen y seguir moviendo la
> dependencia OPERATIVA a TCGCSV vía el «paso 1» ya en curso (P-12 §4.25c). Esta rev SOLO añade §4.30 (evaluación);
> NO cambia contrato, schema ni ningún §4.x normativo previo. **Base previa:** v1.30-buylist-quote-por-producto: la
> línea de cotización/venta del buylist gana `productId?` OPCIONAL para apuntar a un `CardProduct` separado (Deck
> Exclusive/promo) con su propio precio, sin fusionarse con la carta de set. ADITIVO/retrocompatible; reusa M-31 para
> leer precios; migración aditiva menor **M-32** (§11). Spec normativa en §4.29. **Base previa a esa:** v1.29 (rework
> de composición y precio de variantes de singles: **1 carta ↔ N productos TCGplayer** por `productId` EXACTO, TCGCSV
> fuente ÚNICA de estructura + precio por variante, PPT en fallback; §4.27; migración **M-31**, §11).
>
> **Changelog v1.29-tcgcsv-productos-por-variante (2026-08-22, arquitecto — DISEÑO EN PAPEL, backend implementa):**
> Corrige la causa raíz de las variantes fantasma que ha regresado 3 veces: hoy el modelo asume **1 carta = 1 producto
> TCGplayer** (`Card.tcgplayerId` escalar, `schema.prisma:401`) y `unionStructuralFinishesByCardNumber`
> (`tcgcsv-singles.provider.ts:131-162`) une los `subTypeName` de **productos distintos** que comparten número de
> colección → pega un `normal` FANTASMA a la carta de set (caso confirmado Pitch Black ME05 groupId 24688: producto de
> set 704841 `{Holofoil, Reverse Holofoil}` + producto «Deck Exclusives» 707029 `{Normal}` con precio propio). Se
> reconstruyó 3 veces con heurísticas (`composeAvailableFinishes` en `common/card-order.ts:97`, `isPremiumRarity` en
> `common/money.ts:206`) en vez de leer la composición de la fuente. **Decisión del PO (aprobada, NO se re-litiga):**
> (1) modelar **1 carta ↔ N productos** emparejando por **`productId` EXACTO** (nunca por número); la composición de
> acabados de cada producto se LEE de la fuente, sin reglas de rareza; (2) **TCGCSV = fuente ÚNICA** de estructura Y
> precio POR VARIANTE de singles (ya trae `marketPrice` por `subTypeName`; patrón de persistir dinero desde TCGCSV ya
> existe para sellado, `tcgcsv-sealed.provider.ts:159-176`, aquí se generaliza a POR VARIANTE); (3) los productos
> «Deck Exclusives»/promo son **productos vendibles/cotizables propios** con su propio precio — se modelan y muestran
> como producto separado, no se fusionan ni se descartan; (4) **FX USD→MXN reusa el módulo Banxico existente**
> (`FxService`, `pricing/fx.service.ts` + `usdToMxnCents`, `common/money.ts:613`) — no se inventa FX nuevo; (5) **PPT
> baja a fallback**: solo se usa cuando TCGCSV no tiene precio de esa variante. **Componentes que se RETIRAN por
> diseño** (los deroga esta rev; backend los borra en su implementación, el arquitecto no toca código):
> `unionStructuralFinishesByCardNumber`, `composeAvailableFinishes`, `computeDisplayFinishes`, el uso de
> `isPremiumRarity` en la COMPOSICIÓN (sigue vivo SOLO para el pricing del buylist), `StructuralFinishResolverService`
> (se reescribe como `CardProductResolverService`), y las columnas internas `structuralFinishes` / `catalogFinishes` /
> `pricedFinishesSnapshot` (quedan muertas; se dropean en migración posterior). **Migración M-31** (§11): tabla nueva
> `CardProduct` + enum `CardProductKind` + `PriceReference.cardProductId?` + `PriceReference.source = tcgcsv_singles`.
> **Invariantes money-safe intactas:** variante sin precio en NINGUNA fuente ⇒ celda `null`/«—» y `PRICE_PENDING`,
> jamás un 0 inventado (`master-set.service.ts:82-84`); la composición es la PRESENCIA del producto/`subTypeName`, no la
> existencia de precio. **Validación barata por-set ANTES del re-sync completo (~1.5h):** `POST /admin/catalog/sync
> {setId, force:true}` (P-12 §4.25c) corre el nuevo resolver en segundos sobre Pitch Black; criterio observable en el
> binder: energías especiales en **2 casillas (holofoil, reverse_holo), no 3**; «Deck Exclusives» visible como su
> propio producto; precios por variante REALES y «—» honesto donde no haya. Contrato en API_CONTRACT (Changelog
> v1.29). **Riesgo abierto R-1:** confirmar en implementación si el producto «Deck Exclusives» cae en el MISMO
> groupId TCGCSV del set (24688) — el diseño lo asume; si cae en otro grupo, el resolver debe ampliar el fetch (ver
> §4.27 «Riesgos»).
>
> **Además (misma rev, §4.28) — catálogo canónico de rarezas.** Requisito del PO: «que las rarezas de las cartas
> empaten con lo que tenemos registrado en precios admin». Causa raíz: `Card.rarity` se guarda CRUDO de pokemontcg.io
> sin normalizar (`catalog-sync.service.ts:464`) y las reglas del admin (`BUYLIST_PRICE_RULES`/`SALES_PRICE_RULES`,
> `settings.constants.ts:105-119`) se resuelven por match EXACTO case-sensitive (`money.ts:309`, sin `toLowerCase`/
> `trim`); el admin hereda las rarezas por `groupBy(['rarity'])` (`pricing.controller.ts:286-289`), así que una regla
> solo engancha si la key es byte-idéntica; si no, cae al fallback pct (40/15) en silencio. Diseño: (1) **catálogo
> canónico y autoritativo `CANONICAL_RARITIES`** (dato compartido en `common/`, key canónica = la key que edita el
> admin, con `aliases` y atributo `premium`); (2) normalizador puro **`normalizeRarity(raw)→canonical`** aplicado en el
> INGEST a un campo derivado nuevo **`Card.rarityCanonical`** (M-31), en el ADMIN (`groupBy(['rarityCanonical'])`) y en
> el LOOKUP (normaliza ambos lados) ⇒ empate 1:1; el deprecado `RARITY_MAP` (`settings.constants.ts:132-144`,
> desconectado :57-58) se retira; (3) **separar el eje RAREZA (carta) del eje ACABADO/finish (variante)** en las reglas
> — hoy el mapa plano mezcla keys de rareza con keys sintéticas `Holo`/`Reverse Holo` (`settings.constants.ts:108,117,
> 118`) parcheadas a mano en el front (`M2View.tsx:332-336`, INV-1); pasa a `PriceRuleSet { rarityRules, finishRules,
> fallbackPct }` (encaja con §4.27: finish del producto, rareza de la carta); (4) **UNA sola definición de premium**
> sobre la rareza canónica (atributo `premium` del catálogo), retirando las DOS divergentes que hoy dan verdictos
> OPUESTOS sobre el mismo string — `money.ts:206` (`PREMIUM_RARITY_PATTERNS`) vs `ppt-sync-scope.ts:98`
> (`PREMIUM_RARITY_TERMS`): discrepan en «Rare Holo» (ppt=premium, money=NO) y «Double Rare» (money=premium, ppt=NO),
> pese a que `card-order.ts:80,129` afirma «una sola definición». Money-safe: rareza sin regla → fallback pct predecible
> y auditable, nunca 0. **Decisión abierta R-4:** ¿un solo `premium` o dos predicados nombrados
> (`isChaseForPricing`/`isWorthPaidLookup`) sobre el mismo catálogo? Contrato en API_CONTRACT (Changelog v1.29).
>
> **Changelog v1.28.1 (2026-08-21, pase corto de precisión — hallazgos de los gates del Stream B; sin schema, sin
> endpoints nuevos):** (1) **B-1 resuelto:** §4.26e alineado con §4.26a y BL-1 — `bountyAcquiredQty` cuenta SOLO
> ítems `ruleSource='bounty'` con `itemStatus ≠ 'rechazada'` (los rechazados del cherry-pick no se compran y jamás
> avanzan el contador); eco corregido en API_CONTRACT §M2. (2) Ratificaciones aditivas en §4.26c/g: semántica de
> `summary.selected` de publish-all (snapshot de candidatas server-side); inferencia del `tcgplayerProductId` en la
> aportación de sellado (exactamente 1 productId entre hermanos mapeados del grupo o `PRICE_PENDING`; sin herencia
> de mapeo — decisión de fondo abierta como SB-D5 en TECH_DEBT); `SealedInventoryGroupDTO.imageSmallUrl?`
> (aditivo); la vista de la cola `sealed/unmapped` pertenece al frontend de M2 (pendiente menor post-stream).
>
> **Changelog v1.28-stream-b-inventario-master-set (2026-08-21, Stream B «Inventario Master Set») — spec completa
> en §4.26; contrato en API_CONTRACT (Changelog v1.28). CON migración de schema: M-30 (§11, tabla nueva
> `VariantPriceOverride`, aditiva pura). Toca DINERO en ambas direcciones (precio publicado de venta + oferta
> pública de compra) → gate de seguridad por release. Decisiones de producto YA tomadas por el humano en
> `PENDIENTES.md` (plan aprobado 2026-08-21).**
> - **P-18 — consola de TRES precios por carta+variante (§4.26a/b).** Mercado (P-15) + compra + venta, cada uno
>   con sugerido por regla y override manual persistido en `VariantPriceOverride` (M-30). **Los overrides PISAN lo
>   que ve el cliente.** Precedencias normativas: COMPRA `bounty > override > regla > sin precio`; VENTA
>   `listPriceCents (pieza) > sellOverride (variante) > regla > PRICE_PENDING`. Sellado intacto (H-1). Un solo
>   resolver por cara; consumidores enumerados en §4.26b.
> - **P-19 — alta rápida simple + publicar todo (§4.26c).** Solo cantidad + adquisición: «Compra» (precio
>   capturado, prellenado con el sugerido) o «Aportación» (un botón, sin %, valuada a mercado = `acquisitionPct
>   100`; sin referencia ⇒ `PRICE_PENDING` visible por línea — no repetir P-4). Sin dropdown de acabado, sin
>   ubicación (`locationId` opcional en contrato). NUEVO `POST /admin/inventory/publish-all` (tolerante por-ítem,
>   escala pendientes ④, idempotente por `batchKey`).
> - **P-17 — Piezas → drill-down (§4.26d).** M1 abre en Master Set; las copias físicas se ven por clic en
>   carta/variante. Contrato: `GET /admin/inventory/items` gana `finish?` y `productType?` (aditivos); folio con
>   `q=` se conserva.
> - **P-22 — Top Bounties (§4.26e).** Flag + precio premium (+ objetivo opcional con auto-apagado transaccional al
>   pagarse la N-ésima) en la misma tabla/consola de P-18; endpoint público `GET /buylist/bounties` para la
>   sección arriba de `/buylist`. `bounty ≥ sugerido` (`BOUNTY_BELOW_RULE`).
> - **P-24 — valor desglosado (§4.26f).** `GET /admin/finance/inventory-value` gana `breakdown { raw, sealed,
>   graded }` (aditivo; top-level intacto); tarjetas en M1 solo `super_admin`.
> - **P-25 — pestaña «Sellado» POR SET (§4.26g).** NUEVOS `GET /admin/inventory/sealed-sets[/:setId]`; alta
>   rápida con reglas P-19; **fix backend**: la aportación de sellado valúa por `sealedMarketRef` (H-1), no por el
>   gradeKey legacy `'sealed'`.
> - **P-20 — gradeadas separadas (§4.26h).** Pestaña «Gradeadas» + `GET /admin/inventory/graded`; el valor por
>   carta+grado es MANUAL vía el override de mercado existente (`gradeKey graded:PSA:10`) — sin proveedor de
>   precios por grado en este stream (no verificado; doctrina P-6).
>
> **Changelog v1.27.1-fix-variant-composition-regression (2026-08-22, rama `fix/variant-composition-regression`) —
> corrige la REGRESIÓN en prod que causó la fórmula «solo structural» de P-13 (§4.25a-1). Spec completa en §4.25e.
> SIN migración de schema; SIN cambio de forma de contrato (solo semántica de la composición).**
> - **Síntoma:** tras el re-sync forzado, los COMUNES perdieron su reverse holo (`[normal]` en vez de `[normal,
>   reverse_holo]` — Tropius/Grubbin/Fomantis) y las EX conservaron un `normal` fantasma (`[normal, holofoil]` en vez
>   de `[holofoil]` — Lurantis ex / Mega Delphox ex). Dos causas OPUESTAS: al común el reconciliador lo tocó y lo
>   degradó (el reverse legítimo solo vive en `pricedFinishesSnapshot`, no en `structuralFinishes` de sets nuevos); a
>   la ex no la tocó y no la limpió (su `normal` es stale de M-29 / envenenado por el barrido por-etiqueta de PPT).
> - **Fórmula VIGENTE (deroga la de §4.25a-1):** `availableFinishes := orderFinishes( (structuralFinishes ∪
>   pricedFinishesSnapshot) − { normal | isPremiumRarity(rarity) } ) || ['normal']`. La UNIÓN vuelve (recupera el
>   reverse del común) pero se **filtra `normal` en rareza premium** (mata el fantasma de la ex — filtro ESTRUCTURAL
>   por rareza, no por precio). Firma nueva: `composeAvailableFinishes(structuralFinishes, pricedFinishesSnapshot,
>   rarity)` en `card-order.ts` (reusa `isPremiumRarity` de `money.ts`). `FinishReconciler` sigue siendo el único
>   escritor y ahora selecciona/pasa la `rarity`.
>
> **Changelog v1.27-stream-a-catalogo-precios (2026-08-22, Stream A «Catálogo y precios») — tres arreglos del plan
> aprobado 2026-08-21: P-13 (variantes fantasma), P-15 (mercado por variante), P-12 (sync completo por set). Spec
> completa en §4.25; contrato en API_CONTRACT (Changelog v1.27). SIN migración de schema (M-27/M-29 ya existen);
> paso de despliegue = RE-SYNC forzado (§4.25a-4). Toca la lista blanca SEC-A1 → gate de seguridad por release.**
> - **P-13 — «el precio CONFIRMA, nunca AÑADE» (§4.25a; DEROGA la unión de §4.24a/§4.22g en la composición).**
>   La fórmula `structuralFinishes ∪ pricedFinishesSnapshot` era el vector de las variantes fantasma (ex con
>   `Normal`, secret rares duplicadas): el barrido por-impresión de PPT (`fetchPrintings`) atribuye el finish por la
>   **etiqueta del request**, no por dato de la carta, y la unión promovía ese `normal` CON precio a casilla — algo
>   que el propio comentario VAR-1 de `card-order.ts` ya prohibía. Fórmula ~~nueva~~ **(⛔ derogada 2026-08-22 por
>   regresión — ver changelog v1.27.1 arriba y §4.25e; la fórmula VIGENTE restaura la unión filtrando `normal` en
>   rareza premium)**: ~~`availableFinishes := structuralFinishes ≠ ∅ ? orderFinishes(structuralFinishes) : ['normal']`~~.
>   `pricedFinishesSnapshot` **sale de la composición** (queda como observabilidad/confirmación); `fetchPrintings`
>   sigue sirviendo para **PRECIOS por impresión** (P-15 lo necesita) pero jamás como evidencia estructural.
>   Fallback legacy (structural vacío) = `['normal']` — conservador, trade-off documentado en §4.25a-3; se repara
>   con el re-sync forzado post-deploy.
> - **P-15 — precio de mercado POR VARIANTE en el binder Master Set (§4.25b).** `MasterSetVariantDTO` gana
>   `marketReferenceMxnCents?: number|null` (+ `capturedDate?`) = la `PriceReference` de ESE acabado; el batch
>   `getReferencesBatch` se expande a (carta × acabado del universo) — sigue UNA query. El campo de CELDA v1.26
>   queda **DEPRECADO** (espejo del acabado base UNA versión; retiro en la siguiente rev).
> - **P-12 — sync completo de UN set (§4.25c).** `POST /admin/catalog/sync` gana `force?: boolean`: corre el
>   resolver estructural TCGCSV también en el sync por set (cierra la asimetría de `importSet`). Flujo admin
>   recomendado por set: `sync {setId, force:true}` + `POST /admin/jobs/price-ingest {setId}`. Textos stale de
>   «sync-all repuebla precios» corregidos en el contrato (§4.15g manda desde v1.14).
>
> **Changelog v1.26-precios-variantes-masterset (2026-08-20, rama `claude/precios-variantes-masterset`) — bundle
> aprobado por el PO. Cinco piezas, dos batches de commit. Toca dinero (③④⑤) → veredicto de seguridad posterior.**
> Diseño completo en **§4.24** (spec del bundle) + rework de §3.7 / §4.22a-5 / §4.22g (Señal D estructural) + §9 (VAR-1
> ratificada). Migración **M-29** (§11), aditiva y nullable. Contrato en API_CONTRACT §M1/§M2 (mismo changelog).
> - **① Composición de variantes DETECTADA desde TCGCSV (fuente ESTRUCTURAL autoritativa), no por rareza/era ni por
>   presencia de llave de precio (§4.24a).** Nueva columna `Card.structuralFinishes Finish[] @default([])` = «¿en qué
>   impresiones físicas se vende esta carta?», derivada de los `subTypeName` distintos de TCGCSV (`Normal`/`Holofoil`/
>   `Reverse Holofoil` → `normal`/`holofoil`/`reverse_holo`; `1st Edition Holofoil`→`first_edition_holofoil`) unidos
>   **por carta** (group-by número dentro del set, robusto a 1-productId-multi-fila y a N-productIds). La fórmula del
>   reconciliador pasa a `availableFinishes := orderFinishes(structuralFinishes ∪ pricedFinishesSnapshot) || ['normal']`
>   **(⛔ v1.27: esta unión quedó DEROGADA por P-13 — el precio confirma, nunca añade; fórmula vigente en §4.25a)**
>   (structuralFinishes **ancla/reemplaza** el proxy-de-precio `catalogFinishes`). Se puebla `Card.tcgplayerId` desde
>   `tcgplayer.url` en catalog-sync (hoy nadie lo escribe) para el join a TCGCSV. **VAR-1 intacto:** el precio jamás
>   sobrescribe/encoge la estructura; una impresión estructural sin precio es **«pendiente»**, nunca inventada ni
>   dropeada. Se computa **una vez por set** en `importSet` (first-import o `--force`), NO en cada price-ingest.
> - **② ④ PUBLICAR SIEMPRE CON PRECIO (§4.24b).** `bulkPublish` de una variante sin precio hoy lanza `PRICE_PENDING`
>   por-línea pero **NO escala** → la variante se cae en silencio. Ahora **ESCALA a la cola de pendientes**
>   (`escalatePending`, `context='inventory'`) y no publica; el admin fija precio (override M2 o `listPriceCents`) y el
>   re-publish procede. Campo aditivo `pendingPriceEntryId` en `BulkPublishLineResult` para deep-link de UI.
> - **③ P-6 cola manual de precios de DOS BUCKETS (§4.24c).** Reusa `PendingPriceEntry` + M2 `GET /admin/pricing/pending`,
>   que gana filtro opcional `context`. **VENTA** = `context='inventory'`; **COMPRA** = vista **read-only** sobre
>   `context='buylist'` (producir el precio de compra es un WRITE del buylist — FUERA DE ALCANCE). **Invariante
>   documentado (§4.24c):** `manualOverride` resuelve pendientes **CONTEXT-AGNÓSTICO** (un override de VENTA cierra
>   también el pendiente de COMPRA de la misma variante). Se **conserva (a) agnóstico** por ahora; añadir un `context`
>   scope (opción b) es cambio en NUESTRO archivo del que depende el stream buylist ⇒ **requiere serialización con el
>   stream buylist**, no unilateral.
> - **④ P-2 precio de mercado en la teja del Master Set (§4.24d).** `MasterSetCardCellDTO` gana campo aditivo opcional
>   `marketReferenceMxnCents?: number|null` = **referencia de mercado** (`PriceReference` cruda, FX-recompute a MXN vía
>   `getReferencesBatch`/`liveMxnCents`), NO precio de venta derivado. Semántica declarada: «precio de mercado» del PO
>   = la referencia ingerida.
> - **⑤ P-7 publicar + repreciar FRESCO desde el Master Set (§4.24e).** Nuevo método on-demand en `PricingService` +
>   método de proveedor que trae precio FRESCO de carta(s) puntuales y hace upsert de `PriceReference`; una acción
>   «publicar (+reprecio fresco)» refresca ANTES de resolver precio, funciona sobre inventario UNPUBLISHED y HEREDA el
>   gate ④ (sin precio → pendiente, no publica). Aditivo. Cuota/rate del proveedor (PPT) a vigilar. Dinero → gate de
>   seguridad posterior.
>
> **Changelog v1.25-buylist-orders-pagination (2026-08-20, branch `claude/buylist-ordenes`) — WS «Buylist y órdenes»
> (regla 9, P-5): paginación server-side + filtros para las colas admin M5 (`GET /admin/buylist`) y M3
> (`GET /admin/orders`).** Problema del PO: la pestaña «Cerradas» de M5 filtra client-side sobre un fetch completo — no
> escala. Decisión: paginar+filtrar en servidor (NO archivar aparte). **100% aditivo, sin migración de datos.** Diseño en
> **§4.18(h)** (buylist) y **§4.21(l)** (orders): params comunes `q`/`from`/`to`/`minCents`/`maxCents` (+ `status` CSV en
> buylist), monto sobre `quotedTotalCents` (M5) / `totalCents` (M3), `pageSize` default 20 sin cambios (front pide 25),
> orden `createdAt desc`. **Índices RECOMENDADOS** (no migración escrita aquí; `backend/prisma/` es zona compartida): en
> ambos modelos `@@index([status, createdAt])` + `@@index([createdAt])`; `q` (contains) sin índice B-tree (deuda futura
> `pg_trgm` si escala). Seguridad: filtros sólo REDUCEN el conjunto autorizado por rol; `q` no busca PII cifrada/pago.
> **No toca** pricing/catalog/M2/settings/master-set. Contrato en API_CONTRACT §M5/§M3 (v1.25).
>
> **Changelog v1.24-buylist-request-reject (2026-08-20, branch `claude/buylist-ordenes`) — WS «Buylist y órdenes»: cierre
> del hueco de ESTADO A NIVEL SOLICITUD al rechazar ítems (bug P-4).** v1.18 (§4.18) normó el ÍTEM rechazado pero dejó
> fuera la transición de `SellRequest.status`: `itemDecision(reject)` nunca re-evaluaba la solicitud, así que rechazar el
> único ítem la dejaba atorada en `verificacion`. Se documentan **dos mecanismos** (§4.18f/g): **(f) auto-transición** a
> `rechazada` + `closedAt` cuando TODO ítem queda `rechazada` (efecto de `reject` tras el recompute; `convertida_inventario`
> NO cuenta como rechazado; guard «no pisar terminal»); **(g) cierre explícito** `POST /admin/buylist/:id/reject` (botón
> M5, `vault_operator+`, auditado) para solicitudes ya atoradas, con guard `422 REQUEST_HAS_NON_REJECTED_ITEMS`, sin
> mover dinero ni correos. Preserva idempotencia de reject, BL-1 (§9) y SEC-D2 (`closedAt`). **Sin migración.** Contrato
> en API_CONTRACT §M5 (v1.24). **No toca** pricing/catalog/M2/settings/master-set.
>
> **Changelog v1.23-sealed-sales (2026-08-19, branch `claude/sellado-producto-cerrado`) — WS «Sellado / Producto cerrado»:
> el sellado pasa de precio manual a `mercado TCGCSV × spread` (override de respaldo), gana ventana de tienda propia,
> pestaña «Sellado» en la bóveda y tres diferenciadores cableados-pero-apagados. SOLO VENTA (sin buylist de sellado).**
> Spec completa en **§4.23**; deltas de schema **M-28** (§11); supuestos **SUP-1…8** (§10); contrato en API_CONTRACT §2-S/§3-S/§M2/§M10.
> - **Supersede §3.6 y §4.19a** (decisión cerrada del PO): el precio de venta del sellado ya no es manual-único sino
>   `override > mercado×spread(subtype) > mercado×spread(global) > PRICE_PENDING`; la referencia TCGCSV deja de ser
>   solo informativa y pasa a ser la base del precio + valor de mercado expuesto. **product-owner reconcilia `PROJECT.md`** (SUP-1).
> - **Reusa sin reinventar** todo §4.19 (adapter/ingest/curación TCGCSV, `sealedMarketRef`, dial `sealed_price_source`,
>   gradeKey `sealed:tcg:<productId>`), el checkout/fulfillment/guest-checkout (§4.21), la base de valuación del portafolio
>   (§3/§4.20c) y el patrón `SetValueService` (§4.12). **Migración M-28 aditiva y nullable** (enum `SealedCondition`, columna
>   + backfill a `mint`, índice, tabla `SealedRestockSubscription`); cuatro diales `ConfigSetting`.
>
> **Changelog v1.22-1-señal-ppt (2026-08-19, branch `fix/available-finishes-source`) — RESUELVE la pregunta abierta v1.22-1
> (§10) y NORMA la opción (c) money-safe: la señal de acabados también se toma de la fuente de PAGA (PokemonPriceTracker),
> como EVIDENCIA POSITIVA.** Detonante confirmado contra el código: pokemontcg.io devolvió **502** toda la tarde y «Pitch
> Black» (2026, 120 cartas) quedó **todo en `['normal']`** (§4.22f S1/S2 ciegas) mientras PPT —la fuente de precios ya
> migrada— SÍ responde con reverse holo. Spec completa en **§4.22g/§4.22h**; v1.22-1 marcada **RESUELTA** en §10; API_CONTRACT
> v1.22-1 (nota de semántica de `availableFinishes`, sin cambio de forma); **migración M-27** (§11).
> - **Diseño money-safe (§4.22g), en una línea:** `availableFinishes` deja de ser escrita directamente y pasa a ser
>   **DERIVADA y recomputable** = `orderFinishes(catalogFinishes ∪ pricedFinishesSnapshot) || ['normal']` **(⛔ fórmula
>   superada: v1.26 sustituyó la entrada estructural y v1.27 DEROGÓ la unión — §4.25a)** sobre **dos columnas
>   de entrada persistidas**; `catalog.FinishReconciler` es el **único escritor**; `price-ingest` solo escribe su snapshot
>   (Señal C, `market>0` vía **alias VERIFICADO**) y llama al reconciliador. **No monótona** (un `sync --force` o la siguiente
>   corrida PPT REPARAN), **no inventa** (desconocido/SUPUESTO ⇒ se omite, no ensancha SEC-A1), **default `['normal']`**.
> - **La regla 2 de §4.22a sigue vigente en su núcleo:** precio AUSENTE ≠ variante inexistente ⇒ jamás se REMUEVE por falta
>   de precio. Lo NUEVO es su CONVERSA: precio PRESENTE vía alias verificado ⇒ la variante EXISTE.
> - **Toca schema (M-27, dos columnas internas), NO la forma del contrato.** Backend lo implementa; verificación S-C1/S-C2 en
>   la 1ª corrida (devops/backend). Si S-C1 resulta falso (PPT tampoco separa el set nuevo), cae a (a) override manual del admin.
>
> **Changelog v1.22-variantes-orden (2026-08-18) — WS «Catálogo y precios» + «Inventario y vault»: (1) `Card.availableFinishes`
> deja de estar CONTAMINADO por precios y (2) el orden por número deja de ser lexicográfico en el cotizador. Tercera ronda del
> mismo bug del PO («en el master set son dos cartas de cada una: la común a la izquierda y la holo a la derecha»).**
> Ver **§4.22** (spec completa), §3.7 (reescrito), §3.2 (`Card`), §4.15e (**derogado**), §9 (VAR-1…4 / ORD-1 / SEED-1),
> §11 (**M-26**) y API_CONTRACT v1.22.
> - **El error de fondo es de AUTORIDAD, no de UI.** `availableFinishes` es **metadata de catálogo** («¿en qué impresiones
>   existe esta carta?») y hoy se escribe desde la ruta de **precios**: `price-ingest.service.ts:151-172` lo **sobrescribe**
>   con los acabados que obtuvieron `market > 0`. Una carta con reverse holo **sin precio de reverse holo** queda reducida a
>   `['normal']` ⇒ el binder pinta **una** casilla. Precio ausente **no** es prueba de que la variante no exista. Se **deroga
>   §4.15e** (v1.14 había elevado al proveedor de precios a autoridad de variantes).
> - **Norma nueva (§4.22a), en una línea:** el **sync de catálogo es el ÚNICO escritor** de `availableFinishes`;
>   **`price-ingest` NO lo escribe nunca** (ni ampliando: un alias mal mapeado inflaría para siempre una lista blanca
>   SEC-A1 que ninguna autoridad podría limpiar); la derivación combina **`tcgplayer.prices` (llaves presentes, con o sin
>   `market`) ∪ `cardmarket.prices.reverseHolo*` (valor numérico > 0)**; **sin señal remota → no se sobrescribe** lo
>   existente (y `['normal']` solo al CREAR). **Cero heurísticas por rareza**: nunca se inventa una variante ⇒ nunca una
>   casilla de relleno.
> - **Orden natural PERSISTIDO (§4.22b, M-26):** `searchAllCards` (`GET /buylist/cards`) ordena `[{name},{number}]` sobre un
>   `number` **String** (`"10" < "2"`) **y pagina** ⇒ ordenar en memoria tras el `skip/take` da un orden **globalmente
>   incorrecto**. Por eso se **descarta** ordenar en memoria y se añaden **dos columnas derivadas** —`Card.numberSort Int`
>   y `Card.numberPrefix String`— pobladas en el upsert del sync y por backfill SQL en la migración, con `orderBy` en
>   Prisma e índice `(setId, numberPrefix, numberSort)`. `deriveNumberParts` (ya existente) pasa de comparador en memoria a
>   **función de escritura canónica**.
> - **Contrato (aditivo, sin breaking):** `GET /buylist/cards` gana **garantía de orden NORMATIVA**; `CardDTO` gana
>   `numberSort` + `numberPrefix` (mata el `numberSort: idx` que el front inventa en `MasterSetBinder.tsx:104`);
>   `MasterSetCardCellDTO` gana `numberPrefix`. **`MasterSetVariantDTO` NO cambia**: pokemontcg.io publica **una** imagen
>   por carta, la misma para todas sus variantes ⇒ la casilla de variante usa `imageSmallUrl` de la CELDA. Confirmado.
> - **Invariante de render (§4.22c):** `|casillas| = |availableFinishes| ≥ 1`, en **orden canónico `FINISH_ORDER`**
>   (`normal → reverse_holo → holofoil → first_edition_holofoil`) ⇒ «normal a la izquierda, reverse holo a la derecha»
>   sale del **orden del dato**, no de un `sort` del front. **Prohibido** pintar una casilla que no esté en el array.
> - **Seeds (§4.22e):** los tres seeds (`seed.ts`, `seed-e2e.ts`, `e2e-fixtures.ts`) **no setean** `availableFinishes` ⇒ todo
>   cae al `@default([normal])` y el bug **se reproduce en local y staging**. Norma: seedear **explícitamente**, con ≥1 carta
>   `['normal','reverse_holo']`, ≥1 carta `['normal']` y números `"2" / "10" / "TG01"` para que el E2E pruebe ambas cosas.
> - **Supuesto declarado (§4.22f):** el proxy del sandbox **bloquea `api.pokemontcg.io` (403 en CONNECT)**, así que el
>   payload remoto **no se pudo verificar en vivo**. La derivación se diseñó contra el esquema documentado del API v2 y
>   queda **pendiente de verificación en la 1ª corrida** (devops/backend, gate de despliegue).
>
> **Changelog v1.21.3-quote-prune (2026-08-18, branch `fix/carrito-pieza-muerta`) — Nota corta (la spec vive en API_CONTRACT v1.21.3): los DOS quotes
> del checkout (`POST /checkout/quote` y `POST /checkout/guest/quote`) pasan a resolución POR ÍTEM con poda amable.**
> Bug de producción: el carrito `localStorage` (lista de `inventoryItemId`, piezas únicas) envejece; una pieza
> vendida/borrada reventaba TODO el quote (`loadItems` → `404` global en `orders.service.ts:63`, o `409` global si
> salió de `{listed, in_stock}`) y bloqueaba el checkout completo. Ahora el quote responde `200` con `items` +
> `breakdown` de los válidos y `unavailableItems` (siempre presente) con los muertos; **SESSION sigue estricta**
> (`404`/`409` intactos — es el gate duro anti double-sell). Único ajuste aquí: la aserción de quote del **caso v de
> §4.21h-1** (abajo). El carrito de front gana además expiración a 30 días (dueño: frontend). Sin migración, sin
> enums, sin cambios en pricing.
>
> **Changelog v1.21.2-chargeback-fulfillment (2026-08-18) — Cierre del hallazgo BLOQUEANTE del techlead (T1) + D6 y
> D4. El hueco era de la NORMA, no de la implementación: §4.21c describía el reverso del contracargo solo en
> términos del `InventoryItem` y no decía nada del `ShipmentRequest`.** Ver **§4.21c-bis** (nueva), §4.21d, §4.21h,
> §11 (**M-25b**) y API_CONTRACT §9/§M3/§M4.
> - **T1 — double-sell físico (bloqueante).** Un contracargo sobre un pedido `direct_ship` con el envío en
>   `picking`/`guia` re-listaba la pieza **mientras el envío seguía en la cola de picking** ⇒ la misma pieza única
>   podía venderse a un segundo comprador mientras el operador la metía en la caja. **Norma nueva: el contracargo
>   NUNCA re-lista automáticamente una pieza con envío vivo.** Envío no terminal ⇒ `ShipmentRequest → cancelado` en
>   la misma transacción (sale de `pickingList()`) + item **congelado** en `picking` (fuera de venta) +
>   `chargebackNeedsManual=true`; el desenlace lo confirma un humano
>   (`POST /admin/orders/:id/chargeback-inventory`: `recuperada | no_recuperada | reexpedir`). Se eleva a invariante:
>   **una pieza con `ShipmentItem` en un envío no terminal jamás puede estar en `{listed, in_stock}`**. Ganar la
>   disputa **no** re-expide solo. **Sin enums ni columnas nuevas** (reusa `ShipmentStatus.cancelado`).
> - **D6 — el `CHECK` que faltaba pasa a NORMATIVO (M-25b):**
>   `InventoryItem CHECK (ownerType <> 'customer' OR ownerUserId IS NOT NULL)`. Era el único de los cinco
>   invariantes sin implementar, y es justo el que §4-G.0-1 llama «lo que hace segura la nulabilidad de
>   `Order.userId`». Tabla de otro stream ⇒ el orquestador serializa.
> - **D4 — un solo discriminador canónico:** `ShipmentRequest.orderId` responde **solo** "¿de dónde viene el
>   envío?"; **todo comportamiento** (terminal del item, `kind` del DTO) se decide por **`Order.fulfillmentMode`**,
>   con `switch` **exhaustivo y ruidoso** (un modo no soportado **lanza**, nunca cae en `direct_ship`).
> - **§4.21h — el test «contracargo antes/después de enviar» ya estaba pedido y no se escribió**; ahora es condición
>   de aprobación, desglosado en **8 casos enumerados en la tabla de §4.21h-1** (numeración `i…viii` **canónica y
>   estable**: los tests de backend ya la citan y **no debe renumerarse**). *(Errata de forma corregida: estaban
>   redactados como viñeta de prosa dentro del reparto de trabajo — existían pero eran ilocalizables.)*
> - **Errata `422` → `409`:** §4.21c-bis decía que un `reexpedir` en estado inválido devuelve `422`, contradiciendo a
>   API_CONTRACT §M3 (`409`). **Manda el contrato y `409` es lo correcto**: el cuerpo es válido y bien formado, el
>   obstáculo es el **estado del recurso**. Backend ya implementó `409`. **Sin cambio de código.**
> - **Requisito pendiente registrado (hallazgo de QA):** el desenlace humano **no tiene interfaz humana**
>   (`chargebackNeedsManual` no se consume en el front). Se añade el filtro `GET /admin/orders?needsManual=true` y se
>   enruta la UI al WS **«Admin y auditoría»**; **sin ella el flujo de contracargo no es operable** a efectos del DoD
>   de release (no bloquea el veredicto por-stream de «Órdenes y dinero»).
>
> **Changelog v1.21.1-guest-checkout-fixes (2026-08-18) — Correcciones post-implementación (regla 9). SIN migración
> adicional; M-25 no cambia.** Ver **§4.21e-bis** (nueva), §4.21c y §3.2 (`OrderAccessToken`).
> - **Las dos vidas del token (lo importante).** La v1.21 pedía enviar por correo "el mismo" token del checkout:
>   **irrealizable** (solo hay hash en BD ⇒ el claro es irrecuperable — que es la propiedad T5 que queríamos).
>   Norma: **checkout = 120 min**, **correo = 90 días**; el **settle no rota** (rotar mataría la confirmación
>   post-3DS), **reenvío y soporte sí**. El solapamiento de dos puertas sin contraseña baja de **90 días a ≤2 h**.
>   Sin columna nueva: las dos emisiones se distinguen solo por `expiresAt`.
> - **`details.reason` de la revocación se deriva** (`CLAIMED` | `ROTATED`); se elimina `SUPPORT` — el forense vive
>   en `AuditLog`, no en el cuerpo de la respuesta.
> - **`InventoryMovement.reason` del ciclo de invitado:** `settle` (reserved→picking) y `sale` (→shipped,
>   →delivered); **`withdrawal` prohibido** (es de bóveda). Sin valores nuevos en el enum.
> - Conteo de códigos de error: **8**, no 7 (API_CONTRACT §0 manda).
>
> **Changelog v1.21-guest-checkout (2026-08-18) — WS «Órdenes y dinero»: COMPRAR SIN CUENTA (PROJECT §J, §J.1,
> criterios 45–56b).** Ver **§4.21** (spec completa: ruta de fulfillment, ciclo de vida de los items, modelo de
> amenazas del enlace), §3.3 (pointer), §7, §11 (**M-25**) y API_CONTRACT §4-G.
> - **El hallazgo que da forma al diseño:** hoy **no existe** la elección "envío vs bóveda". Comprar **siempre**
>   deposita en la bóveda (`createSession` pone `ownerType='customer'` + `ownerUserId`; el webhook lo pasa a
>   `in_custody/settled`) y el **envío es un flujo posterior COBRADO APARTE** (`ShipmentsService` exige
>   `ownerUserId === userId`, `settled`, `in_custody` y una `Address` **guardada del usuario**, y crea su **propio**
>   PaymentIntent). Por eso «envío directo para invitados» **no es aflojar el auth: es una ruta de fulfillment
>   NUEVA** — `Order.fulfillmentMode = vault | direct_ship`, dirección **capturada en línea** (snapshot en la orden,
>   el invitado no tiene `Address`) y **envío cobrado en el MISMO PaymentIntent** (el invitado no puede pagar un
>   segundo PI desde una bóveda que no tiene).
> - **Ciclo de vida del item sin bóveda:** en `direct_ship` el item **jamás** pasa a `ownerType='customer'`
>   (no hay `ownerUserId` que poner, y ponerlo `null` rompería la bóveda de todos). Conserva
>   `platform/null/null` y su ciclo lo lleva `status`: `reserved → picking → shipped → delivered`, estrenando los
>   tres valores de `InventoryStatus` que v1.17 dejó **sin uso por diseño**. **Sin enum nuevo.** Se eleva a
>   invariante escrito: **`ownerType='customer'` ⇒ `ownerUserId NOT NULL`**.
> - **`ShipmentRequest` con dos naturalezas:** `userId` nullable + `orderId?` como **discriminador**. El envío
>   directo lo **crea el servidor** al liquidar (nace en `picking`, sin PI propio, con montos en `0` para que el
>   P&L no cuente el envío dos veces: el ingreso vive en `Order.shippingFeeCents`). M4 lo opera igual salvo la
>   **transición terminal** (`delivered`, no `withdrawn`).
> - **Token de seguimiento = opaco + hash en BD, NO JWT** (`OrderAccessToken`): 32 bytes `base64url`, solo el
>   SHA-256 persistido, **multi-uso** (`revokedAt`, no `usedAt`), TTL 90d, rotación al reenviar, tope de edad 365d.
>   Es el patrón de `AuthToken` (§3.2) con la única diferencia semántica de "revocable pero no consumible".
> - **Anti-enumeración como propiedad del código, no del copy:** el camino de invitado **nunca** consulta `User`
>   por correo; el reenvío exige `(email + orderNumber)` y responde `202` siempre; el reclamo exige **correo
>   verificado** (prueba de titularidad) y es **explícito**, nunca silencioso. El modelo soporta las **tres**
>   políticas posibles del hueco abierto del PO **sin migración**.
> - **Migración M-25** (`Order.userId` nullable + 9 columnas, `ShipmentRequest` +2, enum `FulfillmentMode`, modelo
>   `OrderAccessToken`): **`backend/prisma/` es zona compartida**, el orquestador la serializa.
>
> **Changelog v1.20-master-set-everywhere (2026-08-17) — WS «Inventario y vault»: Master set en TODAS partes.**
> La vista Master Set (v1.16, §4.17, solo M1) se generaliza a un **read model único parametrizado por scope**
> (`platform` | `user_vault`) que sirve tres vistas con el **mismo shape**: (i) M1 interno (endpoints existentes,
> DTOs extendidos), (ii) admin viendo la bóveda de cualquier cliente (`GET /admin/vaults/:userId/master-sets[...]`,
> `vault_operator+`) y (iii) el cliente viendo su propia bóveda (`GET /vault/master-sets[...]`, `customer`).
> **Completitud por VARIANTE (carta+acabado)** con universo = `Card.availableFinishes` (campo ya existente, §4.15e).
> Nuevos además: `GET /admin/vaults` (lista de clientes con bóveda, valuación reusada del portafolio),
> **`buyable`** en el binder del cliente (variante faltante → pieza `listed` más barata), y
> **`POST /admin/inventory/adjustments`** (levantamiento físico con motivo obligatorio, `InventoryAdjustment` +
> `InventoryMovement(adjustment)` + `AuditLog`; **sin venta directa desde el binder**). Migración **M-24**.
> Decisión de frontend: **promover** los componentes de master set de `(admin)/admin/m1/master-set/` a
> `frontend/src/components/master-set/` (zona compartida, reservada por este stream). Nuevo **§4.20**.
>
> **Changelog v1.19-sealed-tcgcsv (2026-08-17) — WS «Catálogo y precios»: fuente de REFERENCIA de mercado para producto
> SELLADO vía TCGCSV (tcgcsv.com — espejo diario estático de precios de TCGplayer, JSON, sin API key, cubre ETB/booster
> box/bundle/tin/blister). Aditivo, no-breaking, TODO admin-only (la superficie pública NO cambia). ⚠️ **UNA migración
> (M-23, §11):** enum `PriceSource += tcgcsv` + 2 columnas nullable en `InventoryItem` (`tcgplayerProductId`,
> `tcgplayerGroupId`) + índice — **prisma = zona compartida**, el orquestador serializa. Ver **§4.19** (spec completa),
> §3.6 (actualizado) y API_CONTRACT v1.19 (§0 enums, §M1, §M2, §M10, §M10-ops).**
> - **PROJECT 3e MANDA — la precedencia no cambia:** el sellado se sigue vendiendo con **precio manual del admin en MXN**
>   (`listPriceCents`, obligatorio para publicar). El precio TCGCSV es **valor de referencia informativo** (sugerencia en
>   back-office M1/M2 al fijar el precio); NO auto-publica, NO fija `listPriceCents`, NO alimenta `PendingPriceEntry`,
>   NO cambia el costo de aportación del sellado y NO se expone en la ficha pública en esta versión (preguntas abiertas
>   v1.19-1/2).
> - **Adapter `TcgcsvSealedBulkProvider`** (nuevo, `modules/pricing/providers/`), SEPARADO del bulk de cartas: nueva
>   interfaz `SealedBulkPriceProvider` keyeada por `tcgplayerProductId` (no hay Card remota que resolver). Host FIJO
>   `https://tcgcsv.com` anti-SSRF, categoría Pokémon = 3 (constante), `groupId` entero validado, sin API key.
>   Money-safe: `subTypeName≠'Normal'` / market inválido → se OMITE; fallo parcial → NUNCA borra precios previos (stale).
> - **Mapeo curado (M-23):** el sellado no tiene entidad de catálogo propia (es `InventoryItem` anclado a una `Card`);
>   el mapeo vive en el item (`tcgplayerProductId`+`tcgplayerGroupId`, curación manual del admin en M2 con cola derivada
>   de NO-mapeados + explorador proxy de grupos/productos TCGCSV + `applyToSiblings`). Sin fuzzy-matching automático.
> - **Persistencia SIN migrar `PriceReference`:** upsert idempotente con `productType='sealed'`,
>   **`gradeKey='sealed:tcg:<productId>'`** (nuevo esquema; desambigua 2 productos sellados anclados a la misma Card),
>   `finish='normal'`, `source='tcgcsv'`, USD→MXN con `FxService` + colchón (FX 1 vez por corrida). `buildGradeKey`
>   (`'sealed'`) NO cambia (lo siguen usando override manual y costo de aportación).
> - **Job propio `sealed-price-ingest`** (1×/día tras la actualización TCGCSV ~20:00 UTC; secuencial AWAITED, sin fan-out
>   — volumen minúsculo; single-flight; disparo manual `POST /admin/jobs/sealed-price-ingest { groupId? }`).
> - **Dial fail-closed `sealed_price_source` (`tcgcsv | off`, seed `off`):** nada se ingiere hasta validar en staging y
>   flipear (patrón `PRICE_PROVIDER` §4.15h). Rollback = volver a `off`.
> - **Dev con red bloqueada → FIXTURES:** el adapter se desarrolla/testea contra JSON reales de muestra en
>   `backend/test/fixtures/tcgcsv/`; la validación real es la 1ª corrida manual en staging (runbook = devops).
>
> **Changelog v1.18-buylist-rejects (2026-08-17) — WS «Catálogo y precios»: M5 operable — identidad del vendedor,
> orden del listado, semántica completa del ítem RECHAZADO (plazos 7d/30d + correo al vendedor) y orden normativo de
> `GET /buylist/sets`. PROJECT §H / criterios 15–16.** Aditivo, no-breaking. ⚠️ **UNA migración (M-22, §11):** 2
> columnas nullable en `SellRequestItem` (`rejectedAt`, `rejectionReason`) — **prisma = zona compartida**, el
> orquestador serializa. Ver **§4.18** (spec completa), §9 (BL-1) y API_CONTRACT v1.18 (§6, §M5, §11).
> - **Rechazo de ítem:** `reason` obligatorio en `decision:"reject"`; `rejectedAt` = ancla ÚNICA de plazos;
>   `returnDeadlineAt` (+7d, devolución a costo del usuario) y `abandonDeadlineAt` (+30d) **DERIVADOS** al proyectar
>   (no columnas; mismas constantes que `buylist-sweep`). Invariante de dinero: ítem `rechazada` ⇒
>   `approvedPriceCents=null` y fuera de `approvedTotalCents` (cierra BL-1: approve→reject dejaba monto fantasma).
>   `rechazada` **NUNCA** convertible a inventario (guardia `ITEM_NOT_APPROVED` = norma; PROJECT criterio 16).
> - **Correo de rechazo (§4.18):** enviado desde `buylist` inyectando el puerto global **`MAIL_PORT`** con plantilla
>   LOCAL al módulo (ES/EN por `User.locale`, mismo layout/escape que `mail.templates.ts`). El módulo `mail` es de
>   OTRO stream y NO se toca (deuda aceptada: la plantilla vive fuera de `mail/` hasta que «Cuentas y acceso» la
>   absorba). **Best-effort** (fallo ⇒ log, nunca revierte la decisión); sin CLABE ni datos de otros ítems.
> - **M5:** `seller: { id, name, email }` en listado/detalle (correo = contacto operativo, NO CLABE ⇒ sin reveal);
>   listado por `createdAt` **desc**; nuevo `GET /admin/buylist/rejected-items` (pestaña «Rechazadas», transversal).
> - **`GET /buylist/sets`:** norma `releaseDate` desc (fecha completa) → desempate `name` asc → sin `releaseDate` al
>   final.
> - **Coordinación de streams:** `backend/src/jobs/` se asigna al stream que toca sus jobs (nota en §2).
>
> **Changelog v1.17.1-withdrawal-eligibility (2026-08-17) — Cierre de invariante read/write del RETIRO (triple verdicto
> WS-H: techlead + seguridad SEC-H1 + qa). SOLO documentación.** La transición terminal deja el item `status='withdrawn'`
> pero conserva `ownershipStatus='settled'` (histórico); el criterio de creación de retiro (`classifyItems`) exigía
> `settled` pero **no excluía** `withdrawn`, permitiendo re-enviar/re-cobrar un item ya entregado por llamada directa.
> Se **norma en §3.3** que `withdrawn` es **TERMINAL para retiros** (no re-elegible) y que la fuente de verdad de
> elegibilidad **excluye** `withdrawn` y exige `status='in_custody'`: `ownerType='customer' AND ownerUserId=usuario AND
> ownershipStatus='settled' AND status='in_custody' AND sin envío activo` — **mismo** criterio que el flag de lectura
> `HoldingDTO.withdrawable`. Error normado **`422 ITEM_NOT_IN_CUSTODY`**. Ver **§3.3** y API_CONTRACT v1.17.1 (§0, §3, §5).
>
> **Changelog v1.17-withdrawal-lifecycle (2026-08-17) — Cierre del ciclo de RETIRO en la bóveda (Opción 1 del humano).**
> Cierra el hueco WD-1 (§9): el `InventoryItem` nunca se movía durante el envío, así que la carta seguía en "Mi Bóveda"
> como liquidada con RETIRAR activo de por vida y sin rastreo para el cliente. Se norma: (1) al pagar, la carta se queda
> en la bóveda marcada **EN RETIRO** con RETIRAR deshabilitado; (2) retiro **rastreable** por etapa; (3) en `entregado`
> la carta **sale** de la bóveda (`in_custody → withdrawn`). **Fuente de verdad canónica = join
> `InventoryItem→ShipmentItem→ShipmentRequest`** (no espejo de estado en el item; única escritura persistente =
> transición terminal a `withdrawn`). **Aditivo, SIN migración** (reusa `InventoryStatus.withdrawn` y la máquina
> `ShipmentStatus`). SEC-A1 intacto. Ver **§3.3** (ciclo de vida del item en retiro), §3.2 (InventoryItem.status), §9
> (WD-1) y API_CONTRACT v1.17 (§3 HoldingDTO, §5 rastreo del cliente, §9 webhooks, §M4).
>
> **Changelog v1.15-buylist-batch-clabe (2026-08-17) — WS-C: cotizador de buylist (Fable) contra el backend REAL
> (Fase 3b).** El cotizador rediseñado del frontend usa hoy **mocks/atajos** que NO funcionan contra el backend real:
> (a) cotiza N cartas con **N requests** (fan-out FE-12) porque `POST /buylist/quote` es **por-carta**; (b) el atajo
> "usar mi CLABE ****1234" es **mock-only** porque `CreateRequestDto` **exige** `clabe` en claro y el cliente solo tiene
> `clabeMasked` (`buylist.dto.ts:51`, flag mock `useClabeOnFile` en `api.ts:542-550`); (c) el front no sabía de forma
> limpia si el INE ya está en archivo. Se cierra el hueco de contrato. **Aditivo, SIN migración de esquema** (reusa
> `KycProfile.clabeEnc`/`ineFrontKey`/`ineBackKey`, `SellRequest.clabeSnapshotEnc`, la función pura
> `quoteAcquisitionForFinish` y `PriceReference`). **TOCA DINERO/PII** (buylist = pago SPEI + CLABE + INE) → **triple
> veredicto**. SEC-A1 intacto (montos server-side por `(Card.rarity, finish)`; el cliente nunca fija precio ni CLABE de
> terceros). Nuevo **§4.16**.
> - **C.1 — `clabe` OPCIONAL + fallback server-side (backend, PII, §4.16a).** `POST /buylist/requests`: `clabe` pasa a
>   **opcional**. Si el request **no** trae `clabe`, `createRequest` **resuelve la CLABE del propio usuario** desde
>   `kyc.clabeEnc` (desencriptada con `PiiCryptoService`, **igual que el fallback de `revealClabe`**,
>   `buylist.service.ts:453-457`). **Autorización:** la CLABE de fallback es **siempre** la del `userId` autenticado
>   (`kyc = findUnique({ where:{ userId } })`), **jamás** la de otro usuario. Si **no** viene `clabe` **ni** hay una en
>   archivo → **`422 CLABE_REQUIRED`** (nuevo, claro y accionable). La CLABE resuelta (venga del request o del fallback)
>   se **snapshotea cifrada** en `SellRequest.clabeSnapshotEnc`, **nunca se loguea** y **nunca se devuelve** en la
>   respuesta; su único punto de exposición en claro sigue siendo `GET /admin/buylist/:id/reveal-clabe` (super_admin,
>   money-out, auditado). Cuando `clabe` **sí** viene, el comportamiento actual **no cambia** (valida formato →
>   `422 CLABE_INVALID`; match a nombre propio por blind-index → `422 CLABE_NOT_OWN_NAME`; persiste en KYC).
> - **C.2 — Batch quote `POST /buylist/quote/batch` (backend, §4.16b) — mata el fan-out FE-12.** Endpoint **NUEVO,
>   público, READ-ONLY** que cotiza **N cartas en 1 request**. **No** crea solicitud, **no** mueve dinero, **no**
>   persiste y **no** escala a `PendingPriceEntry` (misma doctrina read-only que `POST /buylist/quote` desde v1.12,
>   crítica por ser endpoint anónimo). Reusa **exactamente** la lógica del cotizador por-carta (`publicQuote` →
>   `quoteAcquisitionForFinish`, gate premium §4.2.1, `getReference` por acabado, FX ya bakeada en `PriceReference`),
>   cargando `buylistRules()` **una vez** por request. **Errores por-ítem**: una carta inválida (`NOT_FOUND` /
>   `FINISH_NOT_AVAILABLE`) **no tumba** las demás — cada ítem devuelve `ok:true` con su cotización u `ok:false` con su
>   `error`; el HTTP global es `200`. **Cap** de ítems por request (**`BUYLIST_QUOTE_BATCH_MAX = 50`**, constante de
>   servidor); vacío o sobre-cap → `400 VALIDATION_ERROR`. **Decisión de naming (endpoint NUEVO, no overload):** se
>   **conserva** `POST /buylist/quote` (por-carta) intacto y se añade `/batch` — **aditivo y no-breaking** (estilo del
>   contrato). Alternativa considerada y descartada: sobrecargar `POST /buylist/quote` con `items[]` (breaking para el
>   consumidor por-carta actual). Ver decisión abierta WS-C-1 en §10.
> - **C.3 — INE/CLABE en archivo expuestos al front (backend menor + frontend, §4.16c).** `GET /users/me/kyc` **ya**
>   devuelve **`ineOnFile: boolean`** (`users.service.ts:139`) — el front lo usa para **ocultar los uploaders de INE**
>   cuando ya está (y omitir `ineUploadKeys`; `createRequest` ya trata el INE en archivo como provisto,
>   `buylist.service.ts:209-211`). Se **añade `clabeOnFile: boolean`** (derivado de `Boolean(kyc.clabeEnc)`) para dar al
>   front un booleano **limpio y simétrico** a `ineOnFile` con el que habilitar el atajo "usar mi CLABE ****1234" (=
>   omitir `clabe` en `POST /buylist/requests`); `clabeMasked` se mantiene para el label. Sin PII nueva (la CLABE sigue
>   enmascarada).
> - **Contrato:** `API_CONTRACT.md` (Changelog v1.15-buylist-batch-clabe): `POST /buylist/quote/batch` (nuevo, §6);
>   `POST /buylist/requests` con `clabe?` opcional + fallback + `422 CLABE_REQUIRED` (§6); `GET /users/me/kyc` gana
>   `clabeOnFile` (§1); DTOs `BuylistQuoteItemDTO` / `BuylistBatchQuoteResultDTO` / `BuylistBatchQuoteResponse`. Sin
>   migración.
>
> **Changelog v1.16.1-master-set-reconcile (2026-08-17) — Reconciliación de docs §4.17 (Master Set) con el
> comportamiento YA implementado por backend y señalado por qa/seguridad. SOLO documentación; sin cambio de
> comportamiento, sin migración, sin endpoints nuevos.**
> - **§4.17b — `bulk-publish`: status de origen publicable + `ITEM_NOT_PUBLISHABLE`.** Se documenta el conjunto
>   permitido `{in_stock, listed}` (`in_stock`→publica; `listed`→no-op idempotente; **cualquier otro**→`422
>   ITEM_NOT_PUBLISHABLE`). Cierra un **double-sell** (una pieza `reserved`/vendida/en-custodia/enviada no puede volver
>   a `listed`) señalado por seguridad.
> - **§4.17a — `numberSort`: fórmula corregida.** La ilustrativa previa (`regexp_replace(number,'\D','','g')::int`)
>   ponía `TG12`→12 entre las numéricas, contradiciendo "promos (TG/GG/SV) al final". Se corrige a: numéricos puros por
>   entero primero, promos alfabéticos al final agrupados por prefijo (el backend ya lo hace así).
> - **§4.17a / §9 — `isSecretRare`: afinado a heurística de display.** La forma amplia `numberSort > printedTotal`
>   marcaba TODOS los promos como secret rare (deuda **BE-36**, §9). Se afina: secret rare **real** = numeración
>   principal (número puramente numérico) con entero > `printedTotal`; promos/subsets alfabéticos NO cuentan.
>   Decisión de producto (default propuesto, marcado). BE-36 enrutado a backend (no bloqueante, cosmético).
> - **Contrato:** `API_CONTRACT.md` Changelog v1.16.1 (§0 `422 ITEM_NOT_PUBLISHABLE`; DTO `MasterSetCardCellDTO`/
>   `BulkPublishLineInput`; §M1 binder + bulk-publish; §5 nota de enhancement opcional de `GET /shipments`).
>
> **Changelog v1.16-master-set (2026-08-17) — WS-E: Master Set + inventario a escala (M1, #4/#11/#12).**
> El inventario admin no escala (alta 1×1, tabla plana, sin agregado). Se añade una **vista Master Set** (binder por
> set: cada carta × cada acabado, cuadrícula por número, con cantidad on-hand por carta/acabado) + **escritura por
> lote** (carrito de captura + publicación masiva). **El modelo por-pieza NO cambia** (1 `InventoryItem` por pieza —
> la custodia por-pieza lo exige); todo lo nuevo es **agregación de lectura** + **lote de escritura**. **Aditivo.**
> Migración **M-21** (índice de agregación + `InventoryBatch`). NO toca dinero saliente; la publicación deriva el
> **precio de venta server-side** (reusa reglas de venta §4.14, SEC-A1). Nuevo **§4.17**.
> - **Lectura agregada (§4.17a):** `GET /admin/inventory/master-sets` (índice con completitud/piezas por set) y
>   `GET /admin/inventory/master-sets/:setId` (binder con `countsByFinish` por carta, **orden natural** de `Card.number`
>   String). **Query fija, sin N+1** (patrón `set-value.service.ts`: groupBy + raw aggregate por set/carta).
> - **Escritura por lote (§4.17b):** `POST /admin/inventory/items/batch` (alta N líneas, **errores por-línea**,
>   idempotencia `batchKey`, folios consecutivos `nextFolios(n)`) y `POST /admin/inventory/items/bulk-publish`
>   (publicar N piezas con precio derivado/manual, errores por-línea).
> - **Deuda pagada:** `PricingService.getReferencesBatch` (cierra RB-8/BE-4/D3) y pago **mínimo de BE-25** (izar
>   `SALES_PRICE_RULES`+fallback + batch de referencias en `fetchSellable`/bulk-publish). Índice `@@index([cardId,
>   finish, status])` (M-21). **Fase 2:** virtualización del binder, CSV, tabla `InventoryStockSummary` materializada.
>
> **Changelog v1.14-price-ingest (2026-08-17) — WS-A: ingesta MASIVA de precios vía proveedor de PAGA
> (PokemonPriceTracker), pluggable, que REEMPLAZA el barrido por-carta frágil.** Decisión del plan (WS-A): el pricing del
> catálogo deja de depender del re-sync completo de pokemontcg.io corrido **fire-and-forget en memoria**
> (`catalog-sync.service.ts` `syncAll`→`runSyncAll`, DEV-4) —que **muere al reiniciar el proceso** y tarda horas por
> rate-limits, dejando el catálogo con "precio pendiente" masivo, todo en acabado `normal` y la gráfica del hero vacía— y
> pasa a un **job de ingest masivo por SET, idempotente y reanudable** que consume un **endpoint bulk** del proveedor de
> paga. **Aditivo, SIN migración de esquema** (reusa `PriceReference` con `finish` en su clave desde M-18, el enum
> `PriceSource.pokemonpricetracker` **ya existente**, y `Card.availableFinishes`). Nuevo **§4.15**. **Toca dinero → triple
> veredicto.** Datos confirmados del proveedor: endpoint `POST /api/v1/cards/bulk-price` (varias cartas por request;
> acepta `set`, `limit`), auth `Authorization: Bearer <POKEMONPRICETRACKER_API_KEY>` (key **ya en Railway**, NUNCA en el
> repo), respuesta con `market` (+historial/eBay/PSA). El **esquema EXACTO (campo de acabado/variante, precio, moneda)
> se verifica en la 1ª corrida del backend en Railway** (desde dev el dominio está bloqueado por egress) → el ingest
> mapea **defensivamente** (valida y **omite** entradas mal formadas; money-safe).
> - **A.1 — Interfaz `BulkPriceProvider` pluggable (backend, §4.15b).** NUEVA interfaz de ingest masivo,
>   `fetchPricesForSet(set)` → filas normalizadas `{ externalId?, setExternalId?, number?, finish, marketCents,
>   currency }` por **carta+acabado**. Distinta del `PricingProvider` per-carta ya existente (§4.1), que se **conserva**
>   para el refresco per-carta de bóveda y los stubs graded/sealed. Implementaciones: `PokemonPriceTrackerBulkProvider`
>   (source `pokemonpricetracker`, PRIMARIO — bulk endpoint) y `PokemonTcgIoBulkProvider` (source `pokemontcg_io`,
>   LEGACY/alterno — envuelve el `getCardsBySet` existente y extrae `tcgplayer.prices` por acabado). El **adapter** hace
>   el mapeo defensivo del payload crudo; la interfaz solo expone filas ya validadas.
> - **A.2 — Job `price-ingest` (parent) + `price-ingest-set` (child por set) (backend + devops, §4.15c).** Reemplaza el
>   barrido frágil por un **fan-out BullMQ por set**: el parent lista `CardSet` locales y encola un child por set; cada
>   child descarga UN set (pocas requests), agrupa por carta y hace **upsert idempotente** de `PriceReference`
>   `(cardId, 'raw', 'raw:NM', finish, capturedDate=hoy)`. **Robusto:** un set que falla NO tumba el resto (job aparte,
>   retry/backoff de BullMQ), **reanudable** ante reinicio (cola persistida en Redis, no memoria del proceso).
>   **1–2×/día** (devops). Sin Redis (local/CI) el disparo manual corre secuencial **awaited** (nunca fire-and-forget).
> - **A.3 — Variantes #8 (backend, §4.15e).** `Card.availableFinishes` pasa a **derivarse del proveedor** (que trae las
>   variantes reales del mercado) durante el ingest, reemplazando la derivación frágil de `tcgplayer.prices`. Autoridad:
>   si el proveedor reporta ≥1 acabado con market válido para la carta → `availableFinishes = {esos acabados}`; si no
>   reporta nada → se **respeta** el valor existente (nunca se clobbea a `[normal]`). Sigue siendo la lista blanca SEC-A1.
> - **A.4 — FX + colchón #13 (backend + frontend, §4.15f).** El ingest carga `FxService.getCurrent()` **una vez por
>   corrida** y convierte USD→MXN con `usdToMxnCents(market, rate, bufferPct)` → el **colchón (#13) aplica en cada
>   ingest**. Precios en **MXN** se guardan sin conversión (sin colchón). Fix de UI (#13): M2 debe poder **guardar solo
>   el colchón** sin fijar `rate` (hoy `PUT /admin/fx` exige ambos y pinnea un override manual de tasa) → nota para
>   frontend + ajuste menor de contrato (`rate?` opcional).
> - **A.5 — Aligerar `catalog-sync` (backend, §4.15g).** `catalog-sync` vuelve a ser **solo metadata del catálogo**
>   (nombres/imágenes/sets/números/rareza + import de sets nuevos): se **quita** `persistMarketReferences` de
>   `upsertCards` (y las deps `PricingService`/`FxService` que v1.12 le añadió). El pricing lo hace **solo** `price-ingest`.
>   El job `catalog-price-sync` (v1.12, `force:true` = re-sync completo para refrescar precios) queda **DEPRECADO** en su
>   rol de pricing (lo cubre `price-ingest`, mucho más barato: bulk por set vs re-bajar todas las cartas).
> - **A.6 — Config/env/contrato (§4.15h).** Nuevo dial `PRICE_PROVIDER` (`price_provider`, ConfigSetting editable sin
>   redeploy en M2/M10, ~~valores `pokemonpricetracker | pokemontcg_io`~~ **enum vigente `tcgcsv_singles |
>   pokemonpricetracker | pokemontcg_io`; primario `tcgcsv_singles` desde P-47/§4.35 — ver `PRICE_PROVIDER_VALUES`**) —
>   palanca de selección/rollback del proveedor de ingest. `POKEMONPRICETRACKER_API_KEY` (env, ya en Railway) pasa a ser **requisito operativo en prod** cuando el dial
>   apunta al proveedor de paga. Disparo manual `POST /admin/jobs/price-ingest` (super_admin, auditado, single-flight;
>   `setId?` opcional para verificación de esquema en la 1ª corrida). Ver `API_CONTRACT.md` (Changelog v1.14-price-ingest).
>
> **Changelog v1.13-sales-pricing (2026-08-17) — FASE 2 del epic de precios: precio de VENTA por RAREZA, editable
> en admin (análogo al de COMPRA/buylist).** Decisión del humano (fija): el precio de VENTA se asigna **por rareza**,
> dinámico/bulk, con variables editables en admin como el de compra. Ejemplo del humano: **Common $5, Uncommon $10,
> holo/reverse $10 FIJOS; rarezas más altas = % ARRIBA de mercado.** Hoy la venta usa un **markup GLOBAL único**
> (`SALES_MARKUP_PCT`, default 15) aplicado en `pricing.service.computeSalePrice` y consumido por
> `catalog.service.toListingDTO` (listado) y `orders.service.salePriceOf` (checkout). Fase 2 lo reemplaza por una
> **tabla de regla por rareza** simétrica a la de buylist (v1.3.1). **Aditivo, SIN migración de esquema** (solo dos
> `ConfigSetting` nuevos + una función pura + swap de 2 call-sites + endpoints M2 + editor front). Nuevo **§4.14**.
> Toca dinero → triple veredicto.
> - **2.1 — Dos `SettingKey` nuevos (backend, §4.14a):** `SALES_PRICE_RULES` (`sales_price_rules`, mapa
>   `{ [rarity|ruleKey]: { mode:'fixed'|'pct', value } }`) y `SALES_PRICE_FALLBACK_PCT` (`sales_price_fallback_pct`).
>   **Seed** (reproduce el ejemplo del humano): `Common fixed 500¢`, `Uncommon fixed 1000¢`, `Holo fixed 1000¢`,
>   `Reverse Holo fixed 1000¢`; **fallback = 15** (% ARRIBA de mercado). Validadores nuevos `validateSalesRules` /
>   `validateSalesFallbackPct`: `fixed`→entero ≥ 0 (centavos); `pct`→número en **`[0, SALES_PCT_MAX]`** (propuesta
>   `SALES_PCT_MAX = 1000`, ver §4.14a y decisión abierta v1.13-2). **`SALES_MARKUP_PCT` queda DEPRECADO** (ya no lo
>   lee la ruta de venta; se conserva el dial como palanca de rollback, ver §4.14d y decisión abierta v1.13-3).
> - **2.2 — Función pura `computeSalePriceForRarity` (backend, `money.ts`, §4.14b):** misma mecánica que
>   `quoteAcquisitionForFinish` (reusa `ruleKeyCandidates`, **con el gate premium de Fase 0 intacto**): `fixed` →
>   centavos directos (piso, no depende de mercado → siempre precia); `pct` → **markup ARRIBA de mercado**
>   `round(referencia × (1 + value/100))`. **Semántica DISTINTA a la de compra:** en buylist `pct` = *% de la
>   referencia* (`ref × value/100`); en venta `pct` = *% ARRIBA de mercado* (`ref × (1 + value/100)`). Si `pct` y
>   falta referencia → `pending` (no vendible, "precio pendiente"), igual que hoy; las reglas `fixed` **siempre**
>   precian (mejora: una común/bulk sin market ahora tiene piso de venta).
> - **2.3 — Endpoints M2 nuevos (backend, §4.14c):** `GET/PUT /admin/pricing/sales-rules` y
>   `GET /admin/pricing/sales-rarities`, **clones exactos** del patrón buylist (`buylist-rules`/`rarities`),
>   auditados. Tipos front `SalesRule`, `SalesRuleApplied`, `SalesRulesDTO`, `SalesRaritiesResponse`.
> - **2.4 — Aplicación (backend, §4.14d):** `catalog.service.toListingDTO` (:107) y `orders.service.salePriceOf`
>   (:33) dejan de llamar `computeSalePrice(ref)` (markup global) y pasan a `computeSalePriceForRarity(card.rarity,
>   item.finish, ref, rules, fallbackPct)`. **SEC-A1:** rareza server-side de `Card.rarity` y finish de
>   `InventoryItem.finish` (BD), nunca del DTO del cliente. `listPriceCents` (override manual) **sigue ganando**; el
>   precio se congela en `OrderItem.unitPriceCents` al checkout (snapshot ⇒ **sin migración**).
> - **2.5 — Editor M2 (frontend, §4.14e):** nueva sección "Reglas de precio de VENTA por rareza" en **`M2View`**
>   (clon de la sección de reglas de buylist), NO en `BuylistView`. Consume `getSalesRarities`/`getSalesRules`/
>   `updateSalesRules` (nuevas en `api.ts`) + copys nuevos en `messages/*`.
> - **Contrato:** `API_CONTRACT.md` (Changelog v1.13-sales-pricing): §M2 gana `sales-rules`/`sales-rarities`; DTOs
>   `SalesRule*`. Sin migración.
>
> **Changelog v1.12-catalog-pricing (2026-08-17) — FASE 1 del epic de precios: preciar TODO el catálogo +
> refresco 2×/día + import de sets nuevos.** Decisión del humano (fija): (1) preciar SIEMPRE todo el catálogo
> (aunque la carta no esté en bóveda/inventario), (2) auto-actualización **2×/día** (job programado), (3) función
> para mapear/importar **sets nuevos**. **Aditivo, SIN migración de esquema** (reusa `PriceReference`, que ya lleva
> `finish` en su clave desde M-18). Nuevo **§4.13**. Toca dinero → triple veredicto.
> - **1.1 — Poblar `PriceReference` para todo el catálogo (backend, §4.13a).** El `catalog-sync` **ya descarga**
>   `tcgplayer.prices` por carta para derivar `availableFinishes` (`catalog-sync.service.ts` `upsertCards`); ese
>   MISMO dato ahora **puebla `PriceReference`** por `(card, finish)` **sin llamadas extra**. Por cada acabado con
>   `prices[llave].market > 0` se hace **upsert idempotente** de una fila `(cardId, 'raw', 'raw:NM', finish,
>   capturedDate=hoy)` con conversión USD→MXN (FX Banxico + colchón), `source=pokemontcg_io`. **Una fila por día por
>   acabado.** **No** clobbea overrides manuales (`isManualOverride=true` → skip). Cartas **sin market → NO se crea
>   referencia y NO se escala a `PendingPriceEntry`** (`escalate=false`, mismo criterio que `set-price-sync` §4.12a:
>   no inundar la cola con decenas de miles de cartas). Cambia la doctrina "solo se precia la bóveda" → **"se precia
>   todo el catálogo durante el sync"**; el `price-sync` de bóveda se conserva para frescura entre syncs.
> - **1.2 — `publicQuote` vuelve a READ-ONLY; cierra/supersede BE-16 (backend, §4.13b).** Con el catálogo ya
>   priceado (1.1), el cotizador público **lee** `getReference` y casi siempre encuentra precio. Se **elimina** la
>   llamada a `escalatePending` desde `publicQuote` (endpoint público/anónimo que escribía) → **no** puebla la cola
>   ni consume trabajo del dueño desde un endpoint anónimo. **No se pricea on-demand** desde el quote (superficie de
>   abuso + redundante con el job). La escalada a `PendingPriceEntry` queda **solo** en el flujo autenticado
>   `POST /buylist/requests` (`createRequest`, sin cambio). Cierra **BE-16** (y el punto abierto v1.3-1).
> - **1.3 — Job programado 2×/día (backend + devops, §4.13c).** Nuevo job `catalog-price-sync` que **importa sets
>   nuevos** y **refresca precios de todo el catálogo**. Como pokemontcg.io **no** tiene endpoint bulk de
>   solo-precios (el `market` viaja embebido en la carta), **refrescar precios = re-sync del catálogo**: reusa
>   `syncAll({force:true})` (reprocesa todos los sets remotos → repuebla cartas + `PriceReference` por acabado con el
>   FX del día). Secuencial, respeta el backoff 429 del cliente; single-flight (`syncAllStatus.running`). Horarios
>   **06:00 y 18:00 CDMX** (= 12:00 y 00:00 UTC), configurables; scheduling = **dueño devops**.
> - **1.4 — "Importar sets nuevos" en M2 (frontend, §4.13d).** **NO requiere endpoint nuevo:** reusa
>   `POST /admin/catalog/sync-all` (`force:false` → solo sets no importados) + `GET /admin/catalog/sync-status`
>   (progreso) + `GET /admin/catalog/remote-sets` (refresca la lista). Cambio **solo de frontend**.
> - **Contrato:** `API_CONTRACT.md` (Changelog v1.12-catalog-pricing): `POST /buylist/quote` pasa a **read-only**
>   (mismo shape; ya no escribe); 1.4 sin endpoint nuevo. Sin migración.
>
> **Changelog v1.11-premium-gate (2026-08-17) — Gate PREMIUM en el resolver de reglas rareza/acabado (fix de dinero,
> Fase 0 del epic de precios).** Documenta lo YA implementado por backend (`backend/src/common/money.ts`, commit
> `ebb4dee`). **Sin migración, sin cambio de esquema; solo semántica del resolver `ruleKeyCandidates` (§4.2.1).**
> SEC-A1 intacto (el monto se sigue derivando server-side de `(Card.rarity, finish)` validado).
> - **Bug de dinero cerrado:** las cartas chase modernas (ex, Full Art, Illustration/Ultra/Double Rare,
>   V/VMAX/VSTAR/GX…) **solo existen en holofoil** pero su string de rareza **no** contiene "holo". Antes, en
>   `holofoil`/`first_edition_holofoil` una rareza no-holo saltaba a `['Holo']`; con una regla `"Holo"` fija barata de
>   bulk, esas chase de miles de pesos cotizaban al bin fijo (**"$1.50 cotizada"**). Bug estructural.
> - **`isPremiumRarity(rarity)` (NUEVO, contrato de pricing):** clasificador case-insensitive por substrings/tokens
>   (Illustration/Ultra/Double Rare, Secret/Rainbow/Hyper/Gold, Full/Alt Art, Amazing/Radiant/Shiny/Trainer Gallery/
>   Character/Prism, y tokens sueltos `v/vmax/vstar/ex/gx`). Lista canónica de patrones en §4.2.1.
> - **`ruleKeyCandidates` (holofoil / 1st-ed holo):** si la rareza es **PREMIUM** → candidatos `[rarity]` **únicamente**
>   (su regla explícita o el fallback pct = % de mercado); **nunca** `"Holo"` ni bin fijo de bulk. Si **no** es premium
>   → se conserva la semántica previa (`isHoloRarity ? [rarity,'Holo'] : ['Holo']`). La rareza real va **siempre**
>   primera. `reverse_holo`/`normal` sin cambio.
> - **Punto abierto RESUELTO (Common/Uncommon en holofoil):** se **mantiene** el diseño actual ("% del market
>   holofoil" vía `['Holo']`), **sin cambio de código** — el caso es marginal (una común casi nunca tiene llave
>   `holofoil`; `422 FINISH_NOT_AVAILABLE` lo bloquea) y, cuando ocurre, el % de market es la valuación correcta.
>   **No implica tarea de backend.** Detalle y justificación en §4.2.1 ("Decisión 2026-08-17").
> - **Contrato:** `API_CONTRACT.md §6` (`POST /buylist/quote`) actualizado con el gate premium.
>
> **Changelog v1.9-set-chart (2026-08-16)** — **Gráfica PÚBLICA del valor de un set en el tiempo (hero de la
> home, datos REALES, captura diaria)**. Objetivo de producto: un visitante **anónimo** (sin sesión) ve en el
> hero una gráfica estilo acciones del **valor de mercado agregado de un set destacado**, para atraer tráfico.
> Hoy la home solo muestra el vistazo del portafolio PERSONAL (`PortfolioGlance`), visible **solo con sesión**;
> un anónimo no ve ninguna gráfica. **Todo aditivo**, una sola migración nueva **M-20** (modelo nuevo, sin
> backfill). **SEC-A1 intacto** (el valor se deriva SIEMPRE server-side de `PriceReference` real, nunca del
> cliente). El endpoint es PÚBLICO pero **no expone PII** — solo valor agregado de mercado.
> - **Realidad de datos:** pokemontcg.io (`tcgplayer.prices.<acabado>.market`, USD → MXN vía Banxico) solo da
>   el precio **de HOY**, sin historial. Por eso la serie del set **se siembra con el valor de hoy y crece con
>   captura diaria** (mismo patrón que `PortfolioSnapshot`) — **no** hay histórico que bajar ni se fabrican
>   puntos: si un día no hubo snapshot, el punto **no** existe.
> - **Modelo nuevo `SetValueSnapshot` (MIGRACIÓN M-20, aditiva, sin backfill):** serie diaria por set, análoga
>   a `PortfolioSnapshot` pero agregando por `setId` en vez de por `userId`. Escrita por un job diario. Ver §3.2.
> - **Regla de valor (server-side, SEC-A1):** `totalValueMxnCents` del set en una fecha = SUM sobre las cartas
>   del set de la `PriceReference` vigente más reciente por carta, tomando acabado **`normal`**, `productType`
>   **`raw`** (`gradeKey='raw:NM'`), campo `priceMxnCents`. Las cartas **sin** precio ese día se **excluyen** del
>   total pero se cuentan en `pricedCardCount` (vs `totalCardCount`). Es "valor de las cartas priceadas del
>   set", NO promesa de valor de set completo. Ver §4.12.
> - **Endpoints PÚBLICOS nuevos (`@Public()`):** `GET /catalog/featured-set/value-history` (el "set destacado"
>   de la home, para que el front NO hardcodee un id) y el genérico `GET /catalog/sets/:id/value-history`. DTO
>   nuevo `SetValuePointDTO` (misma línea que `PortfolioPointDTO`). Ver `API_CONTRACT.md §2`.
> - **Set destacado:** configurable por env **`HOME_FEATURED_SET_ID`** (id nativo pokemontcg.io de un set SV
>   reciente), con fallback determinista. Mecanismo en §4.12.
> - **Jobs nuevos (BullMQ diarios):** (a) `set-price-sync` — precia TODAS las cartas del set destacado desde
>   pokemontcg.io (brecha NUEVA: el `price-sync` actual solo precia bóveda; ver §4.12 y DEV-3 en §9); (b)
>   `set-value-snapshot` — agrega y hace upsert de `SetValueSnapshot` del día. Crons alineados con los
>   existentes (`fx-refresh 0 6`, `price-sync 15 6`, `portfolio-snapshot 0 7`). Ver §5.
>
> **Changelog v1.8-ronda-c (2026-08-16)** — **Tres deudas de Ronda C que requieren cambio de contrato**
> (BE-10, PendingPriceEntry+finish, SEC-D2). **Todo aditivo**, una sola migración nueva **M-19** (dos columnas +
> una proyección que NO migra). Ninguna toca dinero (SEC-A1 intacto).
> - **BE-10 — enriquecer `AdminUserOwnedItemRef` con `finish` + `referenceValue` (proyección, NO migra):** la
>   pestaña "Bóveda" de la ficha 360° (`GET /admin/users/:id`, M6) devolvía por ítem solo
>   `{ inventoryItemId, folio, card, ownershipStatus }` (sin acabado ni valor). Se añaden **`finish: Finish`** y
>   **`referenceValue: PriceInfo`** (mismo shape que `HoldingDTO` de la bóveda del cliente §3, para **reusar** la
>   valuación por-acabado existente `getReference(cardId, productType, gradeKey, finish)`). **Decisión: enriquecer
>   el ref** (no añadir `GET /admin/users/:id/holdings` paginado) — la bóveda por usuario es acotada y `getUser`
>   ya trae `ownedItems`; enriquecerlo reusa `PricingService.getReference` sin endpoint nuevo. El endpoint
>   paginado queda documentado como **evolución futura** si una bóveda por usuario creciera demasiado. Ver §4.7ter.
> - **PendingPriceEntry + `finish` (MIGRACIÓN M-19):** la cola de precio pendiente se llevaba por
>   `(cardId, productType, gradeKey)` **sin `finish`** → distintos acabados de una carta colapsaban en **UNA**
>   entrada y resolver el override de `normal` cerraba el pendiente aunque `holofoil` siguiera sin precio.
>   `PendingPriceEntry` gana **`finish Finish @default(normal)`**; `escalatePending`/`manualOverride` incorporan
>   `finish` a la llave de deduplicación/resolución (`getReference` ya era por-acabado, no se rompe). Ver §3.2,
>   §4.2. **Nota de dimensionamiento:** resultó **algo mayor de lo previsto** — `PendingPriceEntry` **SÍ es un
>   modelo Prisma real** (el picker previo no lo halló, pero existe: `schema.prisma` `model PendingPriceEntry`),
>   así que requiere columna en M-19 **y** corrige un bug de corrección real (`manualOverride` resolvía TODOS los
>   acabados; `syncCardPrice` no pasaba `finish` a `escalatePending`). Sigue contenido: 1 columna + 2 llaves de
>   query + 1 param propagado + DTO.
> - **SEC-D2 — `SellRequest.closedAt` (MIGRACIÓN M-19):** la retención de INE aproximaba la fecha de cierre por
>   `max(paidAt,approvedAt,verifiedAt,receivedAt,createdAt)` (para `rechazada`/`abandonada` caía en `createdAt`).
>   Se añade **`closedAt DateTime?`**, seteado a `now()` cuando la solicitud llega a estado **terminal**
>   (`pagada`/`rechazada`/`abandonada`). El job `ine-retention` usa `closedAt` para anclar la ventana al cierre
>   real (con **fallback** a la aproximación previa para filas legacy sin `closedAt`). Ver §3.2, §3.4(d).
>
> **Changelog v1.7-admin-users (2026-08-16)** — **Alta de usuarios por rol desde admin (E1) + historial 360° por
> usuario (F1)** (M6, back-office). Ambas **aditivas** y **sin migración** (reusan `User`, `AuditLog` y los listados
> admin ya paginados). Ver detalle en §4.7bis (c) / §4.7ter y `API_CONTRACT.md` (Changelog v1.7-admin-users, §M6).
> - **E1 — `POST /admin/users`** (`super_admin` only, auditado `user.create`, **NO** `MoneyOutGuard`): crea cuentas
>   de cualquier rol (`customer|vault_operator|super_admin`) sin KYC/CLABE/INE. `email` se lowercasea (patrón
>   register); `name` required; `password?` (si se omite, autogen temporal de alta entropía reusando la rutina del
>   reset M-15, devuelta **una vez** en `tempPassword`, argon2, `mustChangePassword=true`; si se provee,
>   `mustChangePassword=false`). `emailVerified=true` para **todo** rol creado por admin (staff como el seed; customer
>   porque el admin da fe) — **no** se envía correo. `P2002 → 409 EMAIL_TAKEN`. **Escalada de privilegios** (crear
>   super_admin) controlada por super_admin-only + auditoría; la contraseña **nunca** entra al `AuditLog`.
> - **F1 — Historial 360° por REUSO (no engorda `getUser`):**
>   - `?userId=` opcional añadido a `GET /admin/{buylist,shipments,disputes}` (simetría con `GET /admin/orders`),
>     filtrando por la FK `userId`; mismo guard y misma proyección PII por rol.
>   - `GET /admin/users/:id/audit` (paginado): `AuditLog` por `scope=target|actor|both` (default `target` =
>     `entityType='User' AND entityId=:id`). Expone `action/actorRole/actorUserId/entityType/entityId/createdAt` +
>     `ip` **solo** super_admin; **nunca** `before`/`after`. `vault_operator` → proyección reducida sin `ip`.
>
> **Changelog v1.6-finish (2026-08-16)** — **Acabado / versión de carta (finish) en TODA la cadena**
> (PROJECT.md §I / v1.4, criterios 37–44). Hoy el modelo NO distingue acabados: **1 fila `Card` con un solo
> `rarity`**, sin `finish`, y los precios por acabado de `tcgplayer.prices` (`normal`/`reverseHolofoil`/
> `holofoil`/`1stEditionHolofoil`) **se descartan** al importar. Se modela el **acabado (finish)** como
> dimensión de primera clase en catálogo, precio, cotización, inventario/bóveda y valuación de portafolio:
> - **Enum nuevo `Finish = normal | reverse_holo | holofoil | first_edition_holofoil`** (valores canónicos;
>   derivados de las llaves de `tcgplayer.prices`, ver mapeo en §3.7).
> - **Modelo (MIGRACIÓN M-18, aditiva, default seguro):**
>   - `Card.availableFinishes Finish[] @default([normal])` — acabados en que existe esa carta, derivados de las
>     llaves de `tcgplayer.prices` al importar. **Sigue siendo 1 fila por `externalId`** (el `@unique` NO se
>     toca; `availableFinishes` es un array en la MISMA fila). Filas históricas → `[normal]` hasta el re-sync.
>   - `PriceReference.finish Finish @default(normal)` **añadido a la clave** (`@@unique` gana `finish`), para que
>     `normal` y `reverse_holo` tengan **referencia de precio distinta**. El provider guarda el precio **POR
>     acabado** (ya no "el primer market disponible").
>   - `InventoryItem.finish Finish @default(normal)` — qué acabado es la copia física; afecta valuación de
>     portafolio y catálogo "Compra".
>   - `SellRequestItem.finish Finish @default(normal)` — snapshot del acabado aplicado en la cotización/solicitud.
> - **§4.2 (AcquisitionPricer) extendido:** la cotización es **por acabado**. El finish resuelve (a) **qué regla**
>   de `BUYLIST_PRICE_RULES` aplica (reverse holo → `"Reverse Holo"`; holofoil / 1st ed holo → regla de la
>   **rareza base si ya es holo**, si no `"Holo"`; normal → **rareza base**) y (b) **qué referencia** usa el `pct`
>   (el market del acabado). Ver el resolver determinista en §4.2.
> - **§4.1 (PricingProvider):** `fetchPrice`/`getReference`/`syncCardPrice` ganan `finish`; el provider mapea
>   `finish → llave de tcgplayer.prices` y lee **ese** `market` (deja de tomar el primero disponible).
> - **SEC-A1 INTACTO:** el monto se **deriva server-side** de `(Card.rarity, finish)` **validado contra
>   `Card.availableFinishes`** — nunca de un precio/categoría/monto del cliente. Un acabado **no disponible** para
>   la carta se **bloquea** (`422 FINISH_NOT_AVAILABLE`): el cliente no puede cotizar/vender un acabado inexistente
>   para pagar de más.
> - **Contrato:** `CardDTO` (+`availableFinishes`), `ListingDTO`/`HoldingDTO`/`SellItemDTO` (+`finish`),
>   `POST /buylist/quote` y `POST /buylist/requests` (+`finish`), facetas de Compra (+`finishes`) y filtro
>   `finish`. Ver `API_CONTRACT.md` (Changelog v1.6-finish).
> - **Nota de despliegue:** **requiere RE-SYNC del catálogo** tras migrar para poblar `availableFinishes` y las
>   `PriceReference` por acabado (los datos ya importados no traen finish hasta el re-sync; el default seguro
>   `normal`/`[normal]` mantiene todo operable mientras tanto). El re-sync es idempotente (v1.3.1).
> - **Fuera de alcance de este cambio (bundle v1.4 aparte):** el **origen del inventario**
>   (`owner_contribution` vs `client_purchase`) y el **alta de inventario por set** son otro ítem de PROJECT
>   §I/M1; NO se modelan en este contrato de finish (se enrutan por separado al arquitecto).
>
> **Changelog v1.5-auth-email (2026-08-16)** — **Verificación de correo + recuperación de contraseña
> self-service por email** (proveedor **Resend**). Decisiones de producto ya cerradas por el humano:
> - **La verificación NO bloquea el login** — bloquea **acciones sensibles**. Un usuario con `emailVerified=false`
>   **puede iniciar sesión y navegar**, pero un guard server-side (**autoridad**, no solo UI) rechaza
>   **comprar** (`POST /checkout/session`), **retirar/enviar** (`POST /shipments`) y **vender**
>   (`POST /buylist/requests`) con **`403 EMAIL_NOT_VERIFIED`**. Cuentas Google entran con `emailVerified=true`
>   (no afectadas). Nuevo `EmailVerifiedGuard` + decorador `@RequireEmailVerified()` (§4.11, §7).
> - **Recuperación: AMBOS flujos.** (a) **Self-service** nuevo: `POST /auth/forgot-password` (siempre `200`,
>   anti-enumeración) → email con link → `POST /auth/reset-password`. (b) Se **conserva** el reset por admin
>   existente (`POST /admin/users/:id/reset-password`, §4.7bis). Ambos **incrementan `User.tokenVersion`**
>   (revocan sesiones, patrón existente).
> - **Modelo de tokens (nuevo `AuthToken`, MIGRACIÓN M-17):** tabla de tokens de **un solo uso**, `type`
>   (`email_verification | password_reset`), `userId`, **hash** del token (SHA-256; **nunca** el token en claro
>   en BD — el claro viaja solo por correo), `expiresAt`, `usedAt`. Expiraciones: verificación **24h**, reset
>   **1h**. Ver §3.2 (AuthToken) y §4.11.
> - **Abstracción de correo (nuevo módulo `mail`):** puerto `MailPort` (token DI `MAIL_PORT`) + adaptador
>   `ResendMailAdapter` (prod) y `NoopMailAdapter` (local/CI/tests sin key: loguea el email y el link).
>   `MailService` construye las plantillas (verificación / recuperación), bilingües por `User.locale`.
> - **Endpoints nuevos (auth):** `POST /auth/verify-email/resend`, `POST /auth/verify-email`,
>   `POST /auth/forgot-password`, `POST /auth/reset-password`. El registro email/password **emite** el token de
>   verificación y envía el correo. El objeto `user` de `/auth/register|login|google` ahora incluye
>   `emailVerified` (ya expuesto en `/users/me`). Ver `API_CONTRACT §1`.
> - **Env nuevas:** `RESEND_API_KEY` (secreto, **requerida en no-local** — staging+prod), `MAIL_FROM`
>   (default `no-reply@tcgvaultmx.com`). En LOCAL_ENVS sin key → `NoopMailAdapter` (degrada con aviso). Ver §8.
> - **Migración M-17** (§11). Jobs: `auth-token-sweep` (limpia tokens expirados).
>
> **Changelog v1.4-finance (2026-08-16)** — **Costo real de paquetería en el P&L** (PROJECT.md requisito #3,
> §M7 / criterio 21). Hoy el P&L trata el envío **solo como ingreso** (`shippingFeeCents` = lo que el cliente
> nos paga) y **nunca** resta el **costo real que la plataforma paga a la paquetería**, sobreestimando la
> ganancia. Se corrige:
> - **Modelo:** `ShipmentRequest` gana **`shippingCostCents` `Int @default(0)`** = costo real MXN (centavos)
>   que la plataforma paga al carrier por ese envío. Aditivo, default 0 para filas históricas/no capturadas.
>   **Migración M-16** (§11). NO se toca `shippingFeeCents` (sigue siendo el **ingreso** cobrado al cliente).
> - **Captura (M4):** el operador captura `shippingCostCents` (opcional, editable) al **asignar carrier/guía**
>   en `POST /admin/shipments/:id/tracking` (el DTO gana el campo; entero ≥ 0). Ver `API_CONTRACT §M4`.
> - **P&L (M7):** la fórmula separa **ingreso** vs **costo** de envío:
>   `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`.
>   La clave `shippingCents` (ingreso) se **renombra** a `shippingRevenueCents` y se **añade** `shippingCostCents`
>   (decisión de naming: `shippingRevenueCents` elimina la ambigüedad de dos claves de envío; ver §12 y
>   `API_CONTRACT §M7`). Es un **breaking change**: M7 **sí** tiene consumidor de frontend real y montado
>   (`admin/m7/M7View.tsx`, que llama a `getPnl` y renderiza el desglose del P&L), por lo que el rename se aplicó
>   actualizando **productor y consumidor en la misma entrega** (sin periodo de compatibilidad porque el front
>   migró al shape de 6 claves al mismo tiempo). El costo se acota al periodo por **`pickingAt`** (mismo criterio
>   que el ingreso), para que costo e ingreso del mismo envío caigan en el mismo periodo. El CSV export espeja el
>   nuevo shape.
>
> **Changelog v1.3.1 (2026-08-16)** — **Precio de buylist por RAREZA OFICIAL** (PROJECT.md §E.1, criterios
> 12/12b/12c/18). Reemplaza el esquema de **3 categorías hardcodeadas** (`RARITY_MAP` + `BuylistCategory`
> `comun|reverse_holo|ex_plus`) por una **tabla de regla por rareza**, editable en **M2** sin redeploy:
> - **Nuevos `SettingKey`:** `BUYLIST_PRICE_RULES` (`buylist_price_rules`, mapa `{ [rarity]: { mode:
>   'fixed'|'pct', value } }`) y `BUYLIST_PRICE_FALLBACK_PCT` (`buylist_price_fallback_pct`, default **40**).
>   `RARITY_MAP` (`rarity_map`) queda **DEPRECADO** (ya no lo lee la cotización). Ver §3.2 (ConfigSetting) y §4.2.
> - **§4.2 reescrito:** `AcquisitionPricer` resuelve el monto por **regla de rareza** (fixed → monto fijo;
>   pct → % de la referencia; sin regla → `BUYLIST_PRICE_FALLBACK_PCT`). Se mantiene la derivación
>   **server-side** desde `Card.rarity` real (guardarraíl SEC-A1 intacto).
> - **Modelo:** `SellRequestItem` deja de depender de `category` (BuylistCategory) y snapshotea la **regla
>   aplicada** (`rarity`, `ruleMode`, `ruleValue`, `ruleSource`). Enum nuevo `BuylistRuleMode = fixed | pct`.
>   **Migración M-14** (backend). `BuylistCategory` y `category` quedan deprecados (retención legacy).
> - **Endpoints M2 nuevos (backend):** `GET/PUT /admin/pricing/buylist-rules` y `GET /admin/pricing/rarities`
>   (rarezas distintas del catálogo unidas a las reglas). `GET/PUT /admin/pricing/rarity-map` **deprecados**.
> - **Contrato buylist:** `POST /buylist/quote` y `SellItemDTO` exponen `rarity` + `appliedRule` en vez de
>   `category`; `POST /buylist/requests` ya **no** recibe `category` del cliente. Ver `API_CONTRACT.md §6, §M2`.
> - **Seed (preserva negocio):** Common **$0.50** fixed, Uncommon **$0.50** fixed, Reverse Holo **$1.50** fixed,
>   fallback **40%**; todo lo demás cae al fallback (40% de la referencia). Alcance: **solo buylist** (la
>   aportación en especie sigue en 70%, dial aparte).
>
> **Changelog v1.3 (2026-08-16)** — Cotizador **Opción 1** (buylist sobre todo el catálogo) y confirmación del
> estado del back-office:
> - **Nuevo §4.10:** cotizador que cotiza **cualquier** carta de la tabla `Card` — endpoints nuevos de backend
>   `GET /buylist/cards` + `GET /buylist/sets` (búsqueda pública sobre todo el catálogo) y
>   `POST /admin/catalog/sync-all` (importar todo el catálogo, truly-async). Ver `API_CONTRACT.md §6 y §M2`.
> - **§9 Desviaciones:** DEV-1 (el `POST /admin/catalog/sync` from-date importa **síncrono** en el request →
>   riesgo de timeout para catálogo completo; enrutado a backend) y DEV-2 (jobId cosmético).
> - **§10 Preguntas abiertas v1.3:** pricing on-demand del cotizador y rate-limit de la búsqueda pública.
> - **Confirmado (sin cambio de contrato):** M2/M6/M7/M9/M10 ya están implementados en backend. Sobre el consumo
>   de frontend: **M7 YA se consume en UI** (`admin/m7/M7View.tsx`, montado, llama a `getPnl` y renderiza el
>   P&L); M2/M6/M9/M10 siguen pendientes de consumir (`ModuleTodo` stubs de UI). La edición de diales M10 es
>   `PUT /admin/settings` (body parcial), no per-key.
>
> **Changelog v1.2 / v1.2.1 (2026-08-14)** — simplificación aprobada (`PROJECT.md` › "Simplificación v1.2" y
> "Corrección v1.2.1"):
> - **Sin fotos de producto/inventario:** el producto no lleva fotos propias; la imagen es la **de catálogo
>   remota** de pokemontcg.io. Se **relajan** los campos de foto de `InventoryItem`
>   (`frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys` → opcionales/eliminados) y se **elimina** la foto como
>   evidencia canónica de disputa. **Migración** M-13.
> - **Gradeadas por certificado:** `InventoryItem` captura **`certNumber`** (String, nº de certificado
>   PSA/CGC), **requerido para publicar** una gradeada; el slab (verificable en la graduadora) es la garantía.
>   Sin validación automática contra la graduadora. **Migración** M-12.
> - **Uploads/presign acotado a `kyc_ine`:** único propósito válido; `inventory_photo`/`dispute_claim`
>   eliminados. El módulo `uploads` sirve solo el INE.
> - **Disputa por correo:** la evidencia de disputa de condición se envía **por correo a soporte** (dato de
>   contacto); ya no hay upload de evidencia ni comparador de fotos. Se conserva `Dispute.type`
>   (`condition_raw | condition_sealed`) y VENTAS FINALES.
> - **INE (KYC) intacto:** almacenamiento del INE en R2 (cifrado + retención `INE_RETENTION_DAYS`), `S3_*`,
>   PII/cifrado/`reveal-clabe` **sin cambios** (v1.2.1 revierte solo la parte del INE respecto a la v1.2).
>
> **Changelog v1.1 (2026-08-14)** — incorpora las 8 decisiones del `PROJECT.md` › "Actualización 2026-08-14":
> raw solo NM (con **migración**), sección "Compra" = inventario publicado con precio + facetas dinámicas,
> sync de catálogo M2 (pokemontcg.io) con backfill, sellado como línea de venta con precio manual MXN,
> gráfica de tendencia del portafolio (`PortfolioSnapshot`, **migración**), login con Google (campos en
> `User`, **migración**) y AcquisitionPricer con rarezas modernas. Ver §11 "Migraciones requeridas (v1.1)".

## 0. Alcance técnico (MVP vs Fase 2)

**Dentro del MVP:** storefront + ficha con **imagen de catálogo remota** (sin fotos propias) y precio de referencia, checkout Stripe (IVA 16% desglosado + fee de procesamiento trasladado), bóveda/portafolio con titularidad `pending→settled`, retiros/envíos nacionales manuales, buylist con cotizador público + pipeline manual + **INE cifrado en R2 con retención** (`kyc_ine`, único uso de object storage), back-office M1–M10, i18n ES/EN, disputas de condición (raw/sellado) con **evidencia por correo a soporte**. Gradeadas identificadas por **empresa + grado + `certNumber`**.

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
| Object storage (SOLO INE de KYC) | **Object storage S3-compatible** (Cloudflare R2 o AWS S3 en prod; **MinIO** en local) vía **URLs prefirmadas**, **bucket privado + cifrado + retención** | **v1.2:** único uso = **imagen del INE del buylist** (`kyc_ine`). No hay fotos de producto/inventario (imagen de catálogo remota) ni de disputa (evidencia por correo). Presign PUT para subir, presign GET de vida corta para leer en back-office; retención por `INE_RETENTION_DAYS` (§3.4). |
| Frontend | **Next.js 14 (App Router) + React + TypeScript** | Storefront con SEO (server components para catálogo/ficha), y mismo framework para el panel admin responsive. **Sin captura de fotos de producto** (v1.2); la única subida es la imagen del INE en el flujo de KYC del buylist. |
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
      disputes/        # disputas de condición (raw/sellado), evidencia por correo a soporte, recompra -> M8
      admin/           # dashboard (8 tarjetas), finanzas/P&L (M7), reportes (M9)
      settings/        # diales M10 (persistidos en DB, editables sin deploy)
      audit/           # AuditLog global (M10)
      uploads/         # presign de object storage SOLO para el INE del buylist (kyc_ine); bucket privado
      mail/            # puerto MailPort + adaptadores (ResendMailAdapter / NoopMailAdapter) + MailService (plantillas) -> §4.11
    jobs/              # BullMQ: price-sync diario, fx-refresh, buylist-sweep (7d/30d), dispute-deadline, auth-token-sweep (tokens expirados)
    prisma/            # schema.prisma + migraciones
  test/
```

> **Coordinación de work streams — `backend/src/jobs/` (v1.18-buylist-rejects):** la carpeta `jobs/` NO es zona
> compartida fija: **queda asignada al stream que toca sus jobs correspondientes** (un job pertenece al dominio del
> módulo que sirve). En el ciclo actual, el stream **«Catálogo y precios»** toca `scheduler.service.ts` /
> `price-ingest*` (auditoría de precios en curso) y `buylist-sweep.service.ts` si el rechazo lo requiere. Si dos
> streams necesitan el MISMO archivo de `jobs/` (típicamente `scheduler.service.ts`), el orquestador **serializa** ese
> cambio como con cualquier zona compartida.

### frontend/ (Next.js App Router)
```
frontend/
  src/
    app/
      [locale]/                 # es | en (default es)
        (storefront)/           # catálogo, ficha, carrito, checkout, mi-bóveda, retiros, buylist
        (admin)/                # back-office M1–M10 + dashboard (responsive; sin captura de fotos de producto, v1.2)
        (auth)/                 # login/registro
    components/                 # implementa el DESIGN_SYSTEM (ux-ui define tokens/componentes)
      master-set/               # v1.20: binder/índice de master set PROMOVIDOS desde (admin)/admin/m1/master-set/
                                #   (compartidos por M1, admin-bóveda-cliente y "Mi bóveda"; ver §4.20f)
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
User 0/1─* Order 1───* OrderItem *───1 InventoryItem      (v1.21: userId NULLABLE = pedido de invitado)
User 0/1─* ShipmentRequest 1───* ShipmentItem *───1 InventoryItem   (v1.21: userId NULLABLE = envío directo)
Order 1───* OrderAccessToken        (v1.21: enlace de seguimiento del invitado; solo el SHA-256 en BD)
Order 0/1─* ShipmentRequest         (v1.21: orderId poblado = envío directo que fulfilla ese pedido)
User 1───* SellRequest 1───* SellRequestItem 0/1─1 InventoryItem  (al convertir)
User 1───* Dispute *───1 InventoryItem

Card 1───* InventoryItem
Card 1───* PriceReference
Card *───1 CardSet

InventoryItem *───1 VaultLocation
InventoryItem 1───* InventoryMovement
InventoryItem ownerType: platform | customer  (ownerUserId cuando customer)

User 1───* PortfolioSnapshot        (serie diaria de valor de portafolio; gráfica de tendencia)
User 1───* AuthToken               (verificación de correo / reset de contraseña; un solo uso, hash en BD)

ConfigSetting (diales M10, key/value)     AuditLog (global)     FxRate (diario)
PendingPriceEntry (cola de precio pendiente)
```

### 3.2 Entidades

#### User (+ rol)  — **MIGRACIÓN v1.1 (campos de auth Google)**, **v1.3.1 (M6: soft-delete + reset admin)**
- `id` (uuid), `email` (único), `passwordHash` (**nullable** — null para cuentas creadas solo con Google), `role` (`customer | vault_operator | super_admin`), `name`, `phone?`, `locale` (`es|en`, default `es`), `status` (`active | blocked | deleted`), `createdAt`, `updatedAt`.
- **Gestión de cuenta (v1.3.1, MIGRACIÓN M-15):** `deletedAt` (`DateTime?`), `anonymizedAt` (`DateTime?`),
  `mustChangePassword` (`Boolean @default(false)` — lo activa el reset admin; opcional de consumir por el front),
  y `tokenVersion` (`Int @default(0)` — se **incrementa** en reset/soft-delete para **revocar refresh tokens**
  vigentes; el JWT lleva el `tokenVersion` y el guard rechaza los que no coinciden). El valor `deleted` de
  `UserStatus` marca cuenta soft-deleted/anonimizada; `POST /auth/login` y `/auth/google` la rechazan con
  `403 USER_BLOCKED` (no revela el motivo).
- **Auth provider (nuevo):** `authProvider` (enum `local | google`, default `local`), `googleId` (`String? @unique` — `sub` del ID token de Google), `emailVerified` (`Boolean @default(false)`), `avatarUrl` (`String?`).
- **Verificación de correo como AUTORIDAD (v1.5-auth-email):** `emailVerified` **NO** bloquea el login pero
  **sí** las acciones sensibles (compra/retiro/venta) vía `EmailVerifiedGuard` (§4.11, §7). Se puebla en
  `req.user` desde el `JwtAuthGuard` (que ya consulta la BD por `status`/`tokenVersion`; añade `emailVerified` al
  `select`). Google → `emailVerified=true` (no afectado). Relación nueva `User 1───* AuthToken`.
- El comprador es siempre `customer`. `vault_operator` y `super_admin` son cuentas de back-office.
- **Reglas de auth Google (ver §4.7):**
  - `passwordHash` es null hasta que el usuario fije contraseña; `POST /auth/login` (email/contraseña) **rechaza** cuentas sin `passwordHash` con `401 INVALID_CREDENTIALS` (no revela que es cuenta Google).
  - **Account-linking por email verificado:** si un `POST /auth/google` trae un email que ya existe como cuenta `local`, se enlaza (`googleId` se setea, `authProvider` permanece o pasa a coexistir) **solo si el token trae `email_verified=true`**. Si el email no está verificado en el token → `403 GOOGLE_EMAIL_UNVERIFIED`, no se enlaza.
  - **El `role` se asigna SIEMPRE server-side** (default `customer`); NUNCA se lee del ID token. Ningún claim del token puede elevar privilegios.
  - Login Google **no exime KYC**: la buylist sigue exigiendo CLABE/INE a nombre del usuario (M6) independientemente del provider.

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
- **`availableFinishes Finish[] @default([normal])` (v1.6-finish, MIGRACIÓN M-18):** acabados en que existe esta carta. **Sigue siendo 1 fila por `externalId`** — el `@unique` de `externalId` NO cambia; `availableFinishes` es un array en la MISMA fila (no se crea una fila por acabado). Default seguro `[normal]` para filas históricas hasta el re-sync. Es la **lista blanca** contra la que el backend valida cualquier `finish` recibido (SEC-A1, §4.2) **y** el **universo de casillas** del binder (§4.20b).
  - **v1.22 — AUTORIDAD ÚNICA = el sync de CATÁLOGO.** Derivado de `tcgplayer.prices` ∪ `cardmarket.prices.reverseHolo*` (§3.7). **`price-ingest` NO escribe esta columna** (§4.22a deroga §4.15e). Almacenado **siempre en orden canónico `FINISH_ORDER`** y **nunca vacío**.
  - **v1.22-1 (M-27) — pasa a ser DERIVADA (⛔ fórmula superada; lo que persiste es el escritor único y la forma).** Deja de escribirse directamente por `upsertCards`: la recomputa el **único escritor** `catalog.FinishReconciler` (§4.22g). ~~Unión materializada `orderFinishes(catalogFinishes ∪ pricedFinishesSnapshot) || ['normal']`~~ **⛔ v1.27**: esa unión quedó derogada (ver abajo). Sigue siendo la lista blanca SEC-A1 y el universo de casillas del binder; su **forma no cambia** (todos los lectores la siguen consumiendo igual).
  - **v1.26 (M-29, §4.24a) — ⛔ v1.27:** la entrada del lado catálogo pasó a ser `structuralFinishes` (TCGCSV), pero su fórmula ~~`orderFinishes(structuralFinishes ∪ pricedFinishesSnapshot) || ['normal']`~~ quedó **derogada en v1.27** (la unión era el vector de las variantes fantasma). Lo que persiste de v1.26 es la columna `structuralFinishes` y el resolver TCGCSV.
  - **v1.27 (P-13, §4.25a) — FÓRMULA VIGENTE. La UNIÓN se DEROGA: el precio CONFIRMA, nunca AÑADE.** `availableFinishes := structuralFinishes ≠ ∅ ? orderFinishes(structuralFinishes) : ['normal']` — helper `composeAvailableFinishes(structuralFinishes)` en `backend/src/common/card-order.ts` (§4.25a-1), fallback `['normal']`. `pricedFinishesSnapshot` **NO compone** (queda como observabilidad/confirmación). Mismo escritor único (`FinishReconciler`), misma forma, mismas garantías (nunca vacío, orden canónico).
- **`catalogFinishes Finish[] @default([])` (v1.22-1, M-27):** INTERNA (no se expone en DTO). La «opinión del catálogo» = Señal A ∪ Señal B del último payload de pokemontcg.io (lo que devuelve `deriveAvailableFinishes(c)`), persistida en su propia columna para **sobrevivir a un 502** de la fuente. La escribe `upsertCards` con la semántica null de §4.22a-4 (null ⇒ conserva; CREATE ⇒ `derived ?? ['normal']`). Backfill M-27: `= availableFinishes`.
- **`pricedFinishesSnapshot Finish[] @default([])` (v1.22-1, M-27):** INTERNA. **Señal C** = acabados que **PPT** reportó con `market>0` para la carta, **filtrados a alias VERIFICADO** (§4.22g candado 2). La escribe `price-ingest` por **REEMPLAZO** por carta vista en una corrida exitosa (money-safe: no se toca ante fallo/0 filas). ~~Alimenta la unión~~ **v1.27 (P-13): YA NO alimenta la composición de `availableFinishes`** — es solo confirmación/observabilidad (§4.25a); además las filas del barrido por-impresión (`fetchPrintings`, finish atribuido por etiqueta de request) **NO** deben escribirla (§4.25a-2). **NO** es la lista blanca (esa es `availableFinishes`).
- **`numberSort Int @default(1000000)` / `numberPrefix String @default("")` (v1.22, MIGRACIÓN M-26):** **claves derivadas** de `number` (que es `String`) para el **orden natural en BD** — `number` puramente numérico → `numberSort` = su entero y `numberPrefix = ''`; con prefijo alfabético (`TG12`, `SV107`) → `numberPrefix` = las letras y `numberSort = 1_000_000 + parte numérica` (promos/subsets al final). Escritas por `upsertCards` con la MISMA función que las backfillea (`deriveNumberParts`, §4.22b). **Derivadas, no autoritativas:** la fuente de verdad sigue siendo `number`; si divergen, se recalculan desde `number`.
- Índices: `(setId)`, `(name)`, `(rarity)`, **`(setId, numberPrefix, numberSort)` (M-26)**, `externalId` único.

#### VaultLocation (M1 — ubicación jerárquica CAJA/FILA/SLOT)
- `id`, `zone` (`platform_stock | customer_custody` — **separación física de custodia de clientes**), `box` (CAJA), `row` (FILA), `slot` (SLOT), `label` (derivado, ej. `C03-F02-S15`), `isActive`.
- Unicidad: `(zone, box, row, slot)`.

#### InventoryItem (instancia física — pieza única)
Núcleo del sistema. Una fila = una carta/producto físico.
- `id`, `folio` (**legible, único, `INV-000123`**, ver §5), `cardId` (FK), `productType` (`graded | sealed | raw`).
- Condición/grado (según tipo):
  - raw → `rawCondition` (**enum `RawCondition = NM` — ÚNICO valor; MIGRACIÓN v1.1**, estándar propio, ver §3.5). Se **eliminan** `LP | MP | HP | DMG` del enum. Greenfield: no hay filas que hacer backfill; la migración solo redefine el enum/constraint.
  - graded → `gradingCompany` (`PSA | CGC`), `gradeValue` (ej. `10`, `9.5`), **`certNumber` (`String` — nº de certificado PSA/CGC; MIGRACIÓN v1.2 M-12). REQUERIDO para publicar una gradeada.** El slab (empresa+grado+cert, verificable en la web de la graduadora) es la garantía de condición; **sin validación automática** contra la graduadora (fuera de alcance). `certNumber` es null para raw/sealed.
  - sealed → **sin condición ni rareza ni grade ni cert** (ver §3.6). **Precio manual MXN obligatorio para publicar.**
  - `sealedSubtype?` (enum opcional `box | etb | bundle | tin | blister`, solo para `productType=sealed`; nullable en el resto).
- **Imagen (v1.2): sin fotos propias.** El item **no** almacena fotos propias; la imagen mostrada (ficha/Compra/bóveda/back-office) es la **imagen de catálogo remota** de la `Card` (`imageSmallUrl`/`imageLargeUrl` de pokemontcg.io). Los campos `frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys` quedan **eliminados/opcionales sin uso** (MIGRACIÓN v1.2 M-13); ya **no** son evidencia de disputa (la evidencia va por correo a soporte, ver §3.6 y §Dispute).
- Ubicación: `locationId` (FK VaultLocation).
- Propiedad y titularidad:
  - `ownerType` (`platform | customer`), `ownerUserId?` (cuando `customer`).
  - `ownershipStatus?` (`pending | settled`, solo cuando `ownerType=customer`; ver §3.3).
- Estado operativo: `status` (`in_stock | listed | reserved | in_custody | picking | shipped | delivered | lost | damaged | withdrawn`).
  - **v1.17 — uso en el flujo de retiro:** durante un envío activo el item **permanece `in_custody`** (la etapa se deriva del join a `ShipmentRequest`, ver §3.3); al llegar el envío a **`entregado`** el item pasa a **`withdrawn`** (terminal: sale de la bóveda, no se lista ni cuenta en el portafolio). Los valores **`picking | shipped | delivered` quedan sin uso por diseño** en el ciclo de envío (no se espejan en el item; la fuente de verdad de la etapa es la `ShipmentRequest`). `withdrawn` es la **única** escritura del ciclo de retiro.
- Precio de venta: `listPriceCents?` (MXN sin IVA; **= `round(referenciaMxn × (1 + salesMarkupPct/100))`** con `salesMarkupPct` dial M10, o override manual directo; si null y sin `PriceReference` → **"precio pendiente"**, no vendible). El **valor de referencia** (valor de mercado mostrado) es el de `PriceReference`, distinto del precio de venta.
- Costo y adquisición: `acquisitionType` (`aportacion_en_especie | buylist | compra`), `acquisitionCostCents`, `acquisitionPct?` (ej. 70 para aportación en especie), `sourceSellRequestItemId?`.
- **`finish Finish @default(normal)` (v1.6-finish, MIGRACIÓN M-18):** qué **acabado** es la copia física (Normal / Reverse Holo / Holofoil / 1st Edition Holo). Se captura al alta (M1) y debe pertenecer a `card.availableFinishes`. **Afecta la valuación** (se valúa contra la `PriceReference` de ESE acabado, §4.1) y el **catálogo "Compra"** (se lista/filtra por acabado, §4.9). Filas históricas → `normal`. Para `graded`/`sealed` el finish es siempre `normal` (el acabado solo aplica a raw/singles; ver §3.7).
- `createdAt`, `updatedAt`.
- Índices: `folio` único, `(cardId)`, `(status)`, `(ownerUserId)`, `(locationId)`.

#### InventoryMovement (M1 — historial)
- `id`, `itemId`, `fromLocationId?`, `toLocationId?`, `fromStatus?`, `toStatus?`, `reason` (`alta | move | sale | settle | chargeback_return | withdrawal | lost | damaged | buylist_convert`), `actorUserId`, `note?`, `createdAt`.

#### PriceReference (M2 — precio por carta/tipo/**acabado**/fecha/fuente/FX)
- `id`, `cardId`, `productType`, `gradeKey` (string normalizada: `raw:NM`, `graded:PSA:10`, `sealed`), **`finish Finish @default(normal)` (v1.6-finish, MIGRACIÓN M-18)**, `source` (`pokemontcg_io | pokemonpricetracker | poketrace | manual`), `priceUsdCents?`, `fxRate?` (decimal), `fxBufferPct?`, `priceMxnCents`, `capturedDate` (date), `isManualOverride` (bool), `createdAt`.
- **Unicidad (v1.6-finish):** `@@unique([cardId, productType, gradeKey, finish, capturedDate])` — **`finish` se añade a la clave**. Así `normal` y `reverse_holo` de la misma carta tienen **referencia de precio distinta** (una fila por día **por acabado**). El provider guarda el precio **POR acabado** (`tcgplayer.prices[finish].market`), no "el primer market disponible".
- **`gradeKey` NO cambia de semántica:** sigue describiendo condición/grado (`raw:NM`, `graded:PSA:10`, `sealed`); el `finish` es **ortogonal** y vive en su propia columna (más limpio y consulteable que codificarlo en el string). `buildGradeKey` se mantiene igual; el `finish` viaja como **parámetro explícito** por `getReference(cardId, productType, gradeKey, finish)` / `syncCardPrice(...)` (§4.1). Para `graded`/`sealed`, `finish=normal` siempre (sin cambio de comportamiento; el default lo cubre).
- **Cache diario** = una fila por día por `(carta, tipo, gradeKey, acabado)`.
- **Precio pendiente** = no hay fila vigente con `priceMxnCents` para ESE acabado y no hay override → genera `PendingPriceEntry`.

#### PendingPriceEntry (cola de precio pendiente — escalado al dueño)
- `id`, `cardId`, `productType`, `gradeKey`, **`finish Finish @default(normal)` (v1.8-ronda-c, MIGRACIÓN M-19)**, `context` (`catalog | portfolio | buylist | inventory`), `refId?` (item/sellRequestItem que lo originó), `status` (`open | resolved`), `resolvedPriceRefId?`, `createdAt`, `resolvedAt?`.
- **`finish` en la llave de la cola (v1.8-ronda-c):** la cola se dedupe/resuelve por `(cardId, productType, gradeKey, finish, status='open')`. Antes era **sin `finish`**, así que los acabados de una carta colapsaban en **UNA** entrada y resolver el override de `normal` cerraba la de `holofoil`. Ahora cada acabado tiene su **propia** entrada pendiente, alineado con `PriceReference` (que ya lleva `finish` en su clave) y con `getReference(...finish)` (§4.1, sin cambio). No hay índice único de BD sobre la cola (la deduplicación es por `findFirst` en `escalatePending`); M-19 solo **añade la columna** `finish`. Ver §4.2 (resolución de override por acabado).
- Regla transversal: una carta sin precio **nunca se descarta**; entra aquí y se escala al súper-admin.

#### FxRate (M2/M10 — USD→MXN con colchón)
- `id`, `base` (`USD`), `quote` (`MXN`), `rate` (decimal), `bufferPct` (dial M10), `effectiveDate` (date), `source` (**enum `FxSource = banxico | manual`**, dedicado y **separado de `PriceSource`**), `createdAt`.
- Automático: job diario `fx-refresh` obtiene el `rate` de **Banxico (SIE)**, aplica el colchón y escribe `source=banxico`. **Override manual** (dial M10) escribe `source=manual` y **tiene prioridad** sobre el automático del mismo día; también es el fallback si el fetch falla.
- El precio MXN mostrado = `priceUsd × rate × (1 + bufferPct/100)`.

#### Order (M3 — venta de cartas)
- `id`, `userId`, `status` (`pending | settled | failed | refunded | chargeback`).
- Desglose (todo en centavos MXN): `subtotalCents` (suma de líneas sin IVA), `processingFeeCents` (**fee de Stripe trasladado al comprador**, línea visible), `ivaCents` (**16% desglosado**), `totalCents` (= subtotal + fee + IVA).
- `ivaRatePct` (snapshot del dial, default 16), `stripePaymentIntentId?`, `stripeChargeId?`, `billingSnapshot` (JSONB, datos CFDI al momento), `cfdiStatus` (`registrado | no_aplica` en MVP — sin PAC; `emitido` reservado para fase 2), `invoiceRequested` (bool, default false — el cliente pide factura por correo), `createdAt`, `settledAt?`, `refundedAt?`.
- **Banderas operativas de disputa/contracargo** (escalares, NO cambian el enum `OrderStatus`): `chargebackNeedsManual` (bool, default false — el contracargo llegó cuando la carta **ya se había enviado/entregado**; requiere pelear la disputa con la guía, sin re-agregar inventario) y `disputeOutcome?` (`won | lost | null` — resultado del cierre de la disputa Stripe: `won→settled`, `lost→chargeback`). Se **exponen solo** en el detalle admin de orden del contrato (`GET /admin/orders/:id`), no en `OrderSummaryDTO` ni en el detalle del cliente.
- Índices: `(userId)`, `(status)`, `stripePaymentIntentId` único.
- **Guest checkout (v1.21, MIGRACIÓN M-25):** `userId` pasa a **nullable** (un pedido de invitado no tiene `User`) y
  se añaden: `guestEmail?` (normalizado, indexado; `!= null` ⇔ el pedido **nació** de invitado, inmutable),
  `fulfillmentMode` (`vault | direct_ship`, **default `vault`** = comportamiento actual), `shippingAddressSnapshot?`
  (JSONB — el invitado no tiene `Address`), `shippingFeeCents` (`@default(0)`, envío cobrado **dentro** de esta
  orden y **única** fuente de ese ingreso para el P&L), `orderNumber?` (`@unique`, `TCG-000123`, secuencia
  `order_number_seq`), `claimedAt?`, `locale?`, `paymentMethodBrand?`/`paymentMethodLast4?` (marca + 4 últimos del
  `charge`; **nunca** PAN/BIN/titular). Relaciones nuevas: `accessTokens OrderAccessToken[]`,
  `shipmentRequests ShipmentRequest[]`. Invariantes y `CHECK` recomendados en §11 (M-25); diseño en §4.21.

#### OrderItem
- `id`, `orderId`, `inventoryItemId`, `cardSnapshot` (JSONB: nombre/set/número/tipo/condición-grado), `unitPriceCents` (sin IVA, congelado al checkout).

#### ShipmentRequest (M4 — retiro/envío nacional)
- `id`, `userId`, `addressSnapshot` (JSONB, MX), `status` (`solicitado | picking | guia | enviado | entregado | cancelado`).
- **Ingreso** por envío: `shippingFeeCents` (dial M10, default 17500) = **lo que el cliente nos paga** por el envío (línea de cobro Stripe). `stripePaymentIntentId?` (el envío se cobra al comprador **antes** de generar la solicitud).
- **Costo** de envío (v1.4-finance, **MIGRACIÓN M-16**): `shippingCostCents` (`Int @default(0)`) = **lo que la plataforma paga a la paquetería** por ese envío (MXN centavos). **Distinto de `shippingFeeCents`** (ingreso ≠ costo). Se **captura en M4 al asignar carrier/guía** (`POST /admin/shipments/:id/tracking`), es **opcional** (default 0 mientras no se conoce) y **editable** después re-invocando el mismo endpoint; validación de aplicación **entero ≥ 0**. Alimenta el P&L de M7 (se resta), acotado por `pickingAt` (§ P&L M7). Filas históricas/sin captura ⇒ 0 (no rompen el P&L).
- Logística manual: `carrier?`, `trackingNumber?`, `requestedAt`, `pickingAt?`, `shippedAt?`, `deliveredAt?`.
- Restricción: solo se incluyen items `settled` (ver validación en §3.3).
- **Guest checkout (v1.21, MIGRACIÓN M-25):** `userId` pasa a **nullable** y se añade **`orderId?`** (FK a `Order`,
  indexado) como **discriminador de naturaleza**: `orderId == null` ⇒ **retiro de bóveda** (todo lo de arriba, sin
  cambios); `orderId != null` ⇒ **envío directo** que fulfilla un pedido de invitado, creado **por el servidor** al
  liquidar el pago, nacido en `picking`, con `stripePaymentIntentId = null` y **montos en `0`** (el envío ya se
  cobró en la orden — evita el doble conteo en el P&L). La restricción de "solo items `settled`" **no aplica** al
  envío directo: sus items nunca estuvieron en bóveda (§4.21c). Invariante de aplicación: **a lo más un envío
  activo por orden** (no se pone `@unique` para no cerrar la re-expedición por pérdida).

#### ShipmentItem
- `id`, `shipmentRequestId`, `inventoryItemId`.

#### OrderAccessToken (enlace de seguimiento del invitado) — **MIGRACIÓN M-25 (modelo nuevo, v1.21-guest-checkout)**
- `id`, `orderId` (+FK `onDelete: Cascade`), `tokenHash` (**SHA-256 hex `@unique`** del claro; el claro son 32 bytes
  aleatorios `base64url` que viajan **solo por correo** y en la respuesta del checkout a quien creó el pedido),
  `expiresAt`, `revokedAt?`, `lastUsedAt?`, `useCount` (`@default(0)`), `requestIp?`, `createdAt`.
  Índices: `(orderId)`, `(expiresAt)`.
- **Mismo patrón que `AuthToken`** (§3.2/§4.11) con **una** diferencia semántica: es **multi-uso** — `usedAt`
  (consumible) se sustituye por `revokedAt` (revocable). Por eso **no** se reusa `AuthToken`: su `userId` es
  obligatorio (un invitado no lo tiene) y su `consume()` marca uso único.
- Reglas (v1.21.1, §4.21e-bis): **dos vidas según origen** — token de **checkout** (respuesta de
  `POST /checkout/guest/session`) **120 min**, token de **seguimiento** (correo/reenvío/soporte) **90 días**; se
  distinguen **solo por `expiresAt`** (no hay columna `type`/`purpose`/`reason`). **Rotan** (revocando todos los
  vivos del pedido) el **reenvío** y el **reenvío de soporte**; el **settle NO rota** (dejaría sin acceso la
  confirmación post-3DS en curso). El **reclamo revoca todo**. No se emiten tokens para pedidos con más de
  **365 días**. El motivo de revocación que ve el cliente se **deriva** (`CLAIMED` si `Order.claimedAt != null`,
  si no `ROTATED`); el detalle de quién rotó vive en `AuditLog`.
- **No es una credencial de sesión**: no otorga rol, no se acepta en `Authorization` y solo habilita la lectura de
  **un** pedido con datos mínimos. Modelo de amenazas completo en §4.21e.

#### SellRequest (M5/E — buylist)
- `id`, `userId`, `status` (`cotizada | recibida | verificacion | aprobada | pagada | rechazada | abandonada`).
- Totales: `quotedTotalCents`, `approvedTotalCents?`.
- KYC/pago: `clabeSnapshot`, `ineRequired` (bool), `ineProvided` (bool), `speiReference?`, `paidBy?` (**solo súper-admin**), `paidAt?`.
- Plazos: `createdAt`, `receivedAt?`, `verifiedAt?`, `approvedAt?`, `adjustmentSentAt?` (para plazo 7d de rechazo), `deadlineAt?` (30d → inventario).
- **`closedAt DateTime?` (v1.8-ronda-c / SEC-D2, MIGRACIÓN M-19):** timestamp del **cierre real** de la solicitud. Se **setea a `now()` exactamente cuando la solicitud entra a un estado TERMINAL** (`pagada`, `rechazada` o `abandonada`) — es decir, en la misma transacción que fija ese `status`: `pay-spei` (`→pagada`), el rechazo/`decision reject` que deja la solicitud sin items vivos (`→rechazada`) y el barrido de plazos `buylist-sweep` (`→abandonada`, 30d). **Inmutable** una vez seteado (no se reabre). Ancla la ventana de retención de INE al cierre real en vez de la aproximación `max(paidAt,approvedAt,verifiedAt,receivedAt,createdAt)` (que para `rechazada`/`abandonada` caía en `createdAt`). Filas legacy cerradas antes de M-19 → `closedAt=null` y el job cae al cálculo aproximado (§3.4 d). Campo **interno de cumplimiento**; no se expone en DTOs de cliente.
- Regla: **pago SPEI tras recepción y verificación**, decidido carta por carta (cherry-pick).

#### SellRequestItem
- `id`, `sellRequestId`, `cardId`, `productType`, `rawCondition?`, `quotedPriceCents?` (null si precio pendiente), `approvedPriceCents?`, `itemStatus` (`cotizada | precio_pendiente | recibida | verificacion | aprobada | ajustada | rechazada | pagada | convertida_inventario`), `inventoryItemId?` (al convertir).
- **`finish Finish @default(normal)` (v1.6-finish, MIGRACIÓN M-18):** **snapshot del acabado** aplicado en la cotización/solicitud (validado contra `card.availableFinishes` al crear). Determina la regla y la referencia usadas (§4.2). Al **convertir a inventario** (M5), el `finish` se **propaga** al `InventoryItem.finish`.
- **Regla de precio aplicada (v1.3.1 — snapshot para auditoría, reemplaza `category`):**
  - `rarity?` (String — snapshot de `Card.rarity` al cotizar; taxonomía abierta pokemontcg.io).
  - `ruleMode?` (**enum `BuylistRuleMode = fixed | pct`** — modo de la regla aplicada).
  - `ruleValue?` (Int — centavos si `fixed`, porcentaje si `pct`).
  - `ruleSource?` (`rule | fallback` — si vino de una fila explícita de `BUYLIST_PRICE_RULES` o del fallback).
- **`category` (DEPRECADO, MIGRACIÓN M-14):** la columna `category` (BuylistCategory) queda **nullable/legacy**;
  la cotización v1.3.1 ya **no** la lee ni la escribe (se conserva solo por retención de filas históricas). El
  enum `BuylistCategory` permanece en el schema por compatibilidad, marcado deprecado; nada nuevo lo usa.
- **v1.2: sin `photoKeys`** — el buylist no sube fotos de la carta (no hay upload salvo `kyc_ine`); la verificación NM se hace contra la carta física recibida y la imagen de catálogo. El campo `photoKeys` queda eliminado/sin uso (M-13).

#### Dispute (M8 — condición raw/sellado)
- `id`, `userId`, `inventoryItemId` (o vía `orderItemId`), `type` (`condition_raw | condition_sealed`), `status` (`abierta | en_revision | resuelta_recompra | rechazada`).
- **Evidencia por correo (v1.2):** la evidencia se envía **por correo al buzón de soporte** (dato de contacto, no se sube a la app). El `Dispute` **ya no** guarda `ingressPhotoKeys`/`claimPhotoKeys` (eliminados, M-13); guarda solo `description`. Resolución: **gradeadas** por grado + `certNumber` (verificable en la graduadora); **raw NM** por el estándar/política de condición propio.
- Remedio: `resolution?`, `repurchaseOrderId?` (**recompra al precio pagado**), `deadlineAt` (**7 días desde entrega**), `createdAt`, `resolvedAt?`, `resolvedBy?`.
- **Política VENTAS FINALES:** la recompra es una **compensación**; el **cliente conserva la carta** y la carta **NO** regresa al inventario (sin `InventoryMovement`, sin re-listar). Solo se registra el pago de recompra (money-out, súper-admin, auditado).

#### ConfigSetting (M10 — diales editables sin deploy)
- `key` (PK, ej. `shipping_fee_cents`, `aportacion_pct`, `iva_pct`, `sales_markup_pct`, `stripe_fee_pct`, `stripe_fee_fixed_cents`, `stripe_fee_iva_pct`, `buylist_cap_per_request_cents`, `buylist_cap_per_month_cents`, `ine_threshold_cents`, `repo_cap_per_card_cents`, `fx_buffer_pct`, `fx_manual_override_rate`, `pricing_provider_raw`, `pricing_provider_graded`, `pricing_provider_sealed`, **`catalog_sync_from_date`** (default `"2024/01/01"`, frontera por defecto del sync de catálogo), **`buylist_price_rules`** y **`buylist_price_fallback_pct`** (v1.3.1, tabla de precio de buylist por rareza)), `valueJson` (JSONB, tipado por key), `updatedBy`, `updatedAt`.
- Defaults iniciales: envío 17500, aportación 70, IVA 16, **markup de venta configurable (`sales_markup_pct`)**, **tarifa Stripe MX para el gross-up: `stripe_fee_pct` y `stripe_fee_fixed_cents`** (el IVA sobre la comisión de Stripe **ya no es un dial propio**: v1.40/P-37 lo deriva de `iva_pct/100`; `stripe_fee_iva_pct` queda deprecado e inerte), tope solicitud 300000, tope mes 1000000, INE = tope solicitud, colchón FX configurable + override manual, providers según tabla de PROJECT.
- **Buylist por rareza (v1.3.1):**
  - `buylist_price_rules` (JSONB) = `{ [rarity]: { mode: 'fixed'|'pct', value } }`. Seed: `{ "Common": {fixed,50}, "Uncommon": {fixed,50}, "Reverse Holo": {fixed,150} }`. **Validador:** objeto (no array); cada entrada `{ mode, value }` con `mode ∈ {fixed,pct}`; si `fixed` → `value` **entero ≥ 0** (centavos); si `pct` → `value` **número en `[0,100]`**. Rechaza modos/valores fuera de rango (`422 VALIDATION_ERROR`).
  - `buylist_price_fallback_pct` (número) = **40** por defecto. **Validador:** número en `[0,100]`.
  - **NO** se exponen en el DTO de settings de M10 (`GET/PUT /admin/settings`); se editan por endpoints dedicados de M2 (`GET/PUT /admin/pricing/buylist-rules`, ver `API_CONTRACT §M2`). Toda edición se **audita** (`AuditLog action=pricing.buylist_rules.update`).
- **`rarity_map` (DEPRECADO v1.3.1):** el dial `rarity_map` (`RARITY_MAP`) y sus endpoints `GET/PUT /admin/pricing/rarity-map` quedan **deprecados**; la cotización ya no los lee. Se conservan como no-op/legacy hasta su retiro; no se siembran en despliegues nuevos.

#### AuditLog (M10 — bitácora global)
- `id`, `actorUserId`, `actorRole`, `action` (string, ej. `order.refund`, `sellrequest.pay_spei`, `settings.update`, `inventory.mark_damaged`, `catalog.sync`, `catalog.backfill`, `auth.google_link`, `pricing.buylist_rules.update`, `user.create`, `user.reset_password`, `user.delete`), `entityType`, `entityId`, `before?` (JSONB), `after?` (JSONB), `ip?`, `createdAt`.
- **PII/secretos NUNCA en `before`/`after`:** acciones sobre credenciales/PII (`user.create`, `user.reset_password`, `user.delete`) registran solo IDs/flags/`mode`/`role`, **nunca** la contraseña temporal ni la PII anonimizada.
- **Consulta por usuario (v1.7-admin-users):** `GET /admin/users/:id/audit` lee esta tabla por `entityType='User' AND entityId=:id` (`scope=target`) y/o `actorUserId=:id` (`scope=actor`); su proyección **omite `before`/`after`** y solo incluye `ip` para `super_admin` (§4.7ter).
- **Toda acción de back-office se registra**, en especial los intentos bloqueados de dinero saliente por operador (queda registrado y bloqueado) y las **operaciones de sync de catálogo** (`catalog.remote_sets`, `catalog.sync`, `catalog.backfill`; ver §4.8, auditadas).

#### PortfolioSnapshot (gráfica de tendencia del portafolio) — **MIGRACIÓN v1.1 (modelo nuevo)**
Serie temporal por usuario que alimenta la gráfica estilo acciones de "Mi bóveda" (rangos 5d/15d/1m/3m/6m/1a/YTD/Máx).
- `id`, `userId` (FK User), `asOfDate` (`@db.Date` — un punto por día natural), `totalValueMxnCents` (valor del portafolio a **referencia** ese día, misma lógica que `VaultService.holdings()`), `costBasisMxnCents?` (base de costo agregada del usuario, opcional/nullable), `pendingPriceCount` (cartas sin precio ese día, excluidas del total), `createdAt`.
- **Unicidad:** `@@unique([userId, asOfDate])` (idempotente: re-correr el job del día hace upsert, no duplica).
- **Índice:** `@@index([userId, asOfDate])` para consultas por rango.
- **Escritura:** job diario `portfolio-snapshot` (BullMQ, ver §5 y BE-5) tras el `price-sync`; reutiliza `VaultService.holdings()` para no divergir del valor mostrado en vivo. Solo snapshotea usuarios con holdings.
- **Backfill indicativo (opcional, marcado estimado):** si se desea sembrar histórico previo a la puesta en marcha del job, se puede generar una serie **estimada** aplicando los `PriceReference` disponibles por fecha a los holdings actuales del usuario. Estos puntos se marcan `estimated=true` en la respuesta (`PortfolioPointDTO.estimated?`) y **no** se persisten como verdad si contradicen un snapshot real; es indicativo, no autoritativo. Es una tarea opcional de BE, no bloquea el MVP.

#### SetValueSnapshot (gráfica PÚBLICA del valor de un set) — **MIGRACIÓN M-20 (modelo nuevo, v1.9-set-chart)**
Serie temporal **por set** que alimenta la gráfica PÚBLICA del hero de la home (visitantes anónimos, estilo
acciones, mismos rangos 5d/15d/1m/3m/6m/1a/YTD/Máx). Es el **análogo de `PortfolioSnapshot` pero agregando por
`setId`** en vez de por `userId`. Como pokemontcg.io solo da precio de HOY (sin historial), la serie **se
siembra con el valor de hoy y crece con captura diaria** (no hay histórico que bajar; no se fabrican puntos).
Forma EXACTA del modelo (backend lo traduce a Prisma en `schema.prisma`):
- `id` (uuid), `setId` (FK a `CardSet`, `onDelete: Cascade`), `asOfDate` (`@db.Date` — un punto por día natural).
- `totalValueMxnCents` (`Int`) — valor agregado MXN (centavos) del set ese día (regla de valor en §4.12).
- `pricedCardCount` (`Int`) — cuántas cartas del set **tenían precio** ese día (las que entran al total).
- `totalCardCount` (`Int`) — cuántas cartas tiene el set en total (`Card` con ese `setId`). Invariante
  `pricedCardCount <= totalCardCount`. La razón `pricedCardCount/totalCardCount` es la **cobertura** de datos y
  se expone en el punto para que el front pueda advertir "valor parcial del set".
- `createdAt`, `updatedAt` (`@updatedAt`).
- **Unicidad:** `@@unique([setId, asOfDate])` (idempotente: re-correr el job del día hace **upsert**, no duplica).
- **Índice:** `@@index([setId, asOfDate])` para consultas por rango.
- **Relación nueva en `CardSet`:** `snapshots SetValueSnapshot[]` (lado inverso de la FK).
- **Escritura:** job diario `set-value-snapshot` (BullMQ, §5) tras `set-price-sync`. Ver la regla de valor y el
  manejo de cartas sin precio en §4.12. **SEC-A1:** `totalValueMxnCents` se deriva SIEMPRE de `PriceReference`
  real; nunca de input del cliente.
- **Sin backfill:** M-20 solo crea la tabla; la serie arranca vacía y se puebla desde el primer día que corra el
  job (mismo criterio "no se inventan datos" que `PortfolioSnapshot`). Un backfill estimado NO aplica aquí
  porque no existen `PriceReference` de fechas previas para las cartas del set fuera de bóveda.

#### AuthToken (verificación de correo / reset de contraseña) — **MIGRACIÓN M-17 (modelo nuevo, v1.5-auth-email)**
Token de **un solo uso** para los flujos self-service por correo. **Nunca** guarda el token en claro: el claro
(alta entropía) viaja solo por email; en BD vive su **hash**.
- `id` (uuid), `userId` (FK User, `onDelete: Cascade`), `type` (enum `AuthTokenType = email_verification | password_reset`),
  `tokenHash` (`String @unique` — **SHA-256** del token en claro), `expiresAt` (`DateTime`), `usedAt` (`DateTime?` —
  se setea al consumir; `null` = vigente), `requestIp` (`String?`, auditoría), `createdAt`.
- **Índices:** `@@unique([tokenHash])` (lookup por hash del token presentado), `@@index([userId, type])`
  (invalidar/consultar los del usuario), `@@index([expiresAt])` (barrido `auth-token-sweep`).
- **Hashing:** el token en claro es **32 bytes aleatorios** (`crypto.randomBytes`, base64url ≈ 256 bits de
  entropía) → basta **SHA-256** (rápido): NO se usa argon2 porque no hay riesgo de fuerza bruta con esa entropía
  (a diferencia de una contraseña). *(Endurecimiento opcional: HMAC-SHA256 con una llave de servidor dedicada,
  patrón `clabeHmac`; se documenta como opción, no requerido para el MVP.)*
- **Expiraciones (dial/const):** `email_verification` **24h**, `password_reset` **1h**. Configurables como
  constantes de servicio (o dial futuro); no son `ConfigSetting` en el MVP.
- **Un solo uso + rotación:** consumir setea `usedAt`. Al **emitir** un token nuevo de un `type` para un usuario,
  se **invalidan** (marcan `usedAt`/borran) los tokens vigentes previos de ese `type` → solo el último link vale.
- **Validación al consumir (atómica):** `tokenHash` existe **y** `usedAt IS NULL` **y** `expiresAt > now()`;
  cualquier fallo → `422 *_TOKEN_INVALID` (no se distingue inexistente/expirado/usado, para no filtrar señal).
- **Escritura/lectura:** `AuthService` (verificación/forgot/reset). Barrido housekeeping: job `auth-token-sweep`
  (borra `expiresAt < now()`), no crítico.

### 3.3 Ciclo de titularidad `pending → settled` (regla transversal)

```
Compra Stripe (PaymentIntent creado)
  → OrderItem.inventoryItem: ownerType=customer, ownerUserId=comprador,
    ownershipStatus=pending, status=in_custody     (Order.status=pending)

webhook payment_intent.succeeded
  → ownershipStatus=settled                         (Order.status=settled, settledAt)

webhook charge.dispute.created (contracargo, CONSCIENTE DEL ESTADO FÍSICO)
  → Order.status=chargeback en ambos casos, y:
    (a) carta AÚN en bóveda (sin ShipmentItem enviado/entregado):
        revierte a inventario de plataforma:
        ownerType=platform, ownerUserId=null, ownershipStatus=null,
        status=listed (o in_stock), movimiento reason=chargeback_return
    (b) carta YA enviada/entregada:
        NO se re-agrega al inventario; Order.chargebackNeedsManual=true
        (pelear la disputa con la evidencia de la guía); sin movimiento

webhook charge.dispute.closed / charge.dispute.funds_reinstated (cierre)
  → ganamos: Order.status=settled, disputeOutcome=won
    (la carta revertida en (a) se QUEDA en inventario de plataforma)
  → perdemos: Order.status=chargeback (terminal), disputeOutcome=lost

webhook payment_intent.canceled
  → libera la reserva de compra (Order=failed, item reserved→listed)
    o cancela un envío en 'solicitado' (ShipmentRequest=cancelado, libera items)

Retiro  (criterio único de elegibilidad = classifyItems, v1.17.1)
  → un item entra a ShipmentItem SOLO si cumple TODAS:
    ownerType=customer AND ownerUserId=usuario AND ownershipStatus=settled
    AND status=in_custody AND sin envío activo.
    Rechazos: pending ⇒ 422 ITEM_NOT_SETTLED; con envío activo ⇒ 409 ITEM_IN_ANOTHER_SHIPMENT;
    withdrawn / no-in_custody ⇒ 422 ITEM_NOT_IN_CUSTODY.
    La elegibilidad EXCLUYE status=withdrawn (item ya entregado, terminal): NO basta ownershipStatus=settled.
```

#### Ciclo de vida del item durante el RETIRO/envío (v1.17 — Opción 1)

**Fuente de verdad canónica (UNA, declarada para evitar ambigüedad):** el **estado/etapa del retiro** de un
item se **deriva del join** `InventoryItem → ShipmentItem → ShipmentRequest.status`. Hay a lo más **un envío
activo por item** (lo garantiza `409 ITEM_IN_ANOTHER_SHIPMENT`: `shipmentItem.findFirst` sobre envíos
`status NOT IN (cancelado, entregado)` al crear la solicitud). El `InventoryItem.status` **NO se espeja por
etapa**: sigue `in_custody` durante `solicitado → picking → guia → enviado`. Los valores
`InventoryStatus.picking | shipped | delivered` **quedan sin uso por diseño** (no se escriben en el flujo de
envío). La **única** escritura persistente del ciclo es la **transición terminal** en `entregado`.

```
ShipmentRequest solicitado  (creado, PaymentIntent creado, pago pendiente)
  → item SIN cambio (in_custody). shipmentItem existe ⇒ item bloqueado (ITEM_IN_ANOTHER_SHIPMENT).
    HoldingDTO: shipmentState='solicitado', withdrawable=false, activeShipmentId set.

webhook payment_intent.succeeded  (envío pagado)
  → ShipmentRequest solicitado→picking (payments.service; SIN tocar el item).
    HoldingDTO: shipmentState='picking'.

PATCH /admin/shipments/:id/status  y  POST .../tracking   (máquina M4)
  → picking → guia → enviado : item SIN cambio (in_custody). shipmentState se deriva del join.

PATCH /admin/shipments/:id/status → entregado   (TRANSICIÓN TERMINAL)
  → por cada ShipmentItem: InventoryItem in_custody → withdrawn
    (+ InventoryMovement reason='withdrawal'). Conserva ownerType=customer,
    ownerUserId, ownershipStatus=settled (histórico); solo cambia status.
  → Efecto: el item SALE de la bóveda (GET /vault/holdings excluye status='withdrawn')
    y deja de contar en el portafolio / snapshot diario.

webhook payment_intent.canceled  (envío 'solicitado' nunca pagado)
  → ShipmentRequest → cancelado ⇒ el item deja de tener envío activo (shipmentState=null,
    withdrawable vuelve a true). El item nunca cambió de status.
```

Coherencia con el contracargo (§ webhook `charge.dispute.created`, abajo): ese handler ya usa el **mismo join**
(`ShipmentItem` con envío `enviado`/`entregado`) para decidir si la carta "salió físicamente". Con v1.17, tras
`entregado` el item además es `withdrawn`; el handler sigue siendo correcto (busca por `ShipmentItem`, no por
`item.status`) y **no** re-agrega al inventario una carta ya entregada.

**`withdrawn` es TERMINAL para retiros (v1.17.1 — invariante read/write).** Una vez que el item llega a
`status='withdrawn'` (transición terminal en `entregado`), **NO es re-elegible** para un nuevo `POST /shipments`,
aunque conserve `ownershipStatus='settled'` (histórico). La **fuente de verdad de elegibilidad** (`classifyItems`,
misma que el flag de lectura `HoldingDTO.withdrawable`) **excluye** `status='withdrawn'` y exige `status='in_custody'`:
`ownerType='customer' AND ownerUserId=usuario AND ownershipStatus='settled' AND status='in_custody' AND sin envío
activo`. Un intento de retirar un item `withdrawn` (o cualquier `status != 'in_custody'`) por llamada directa a la API
se rechaza con **`422 ITEM_NOT_IN_CUSTODY`** (API_CONTRACT §5). Esto cierra la divergencia detectada en el triple
verdicto de WS-H (SEC-H1): la escritura de creación de retiro y la lectura `withdrawable` comparten **exactamente** el
mismo criterio, evitando el re-envío/re-cobro de un item ya entregado.

Separación física: los items en `ownerType=customer` viven en `VaultLocation.zone=customer_custody`; el stock de la plataforma en `zone=platform_stock`. El movimiento entre zonas queda en `InventoryMovement`.

> **v1.21-guest-checkout — este ciclo describe la ruta `fulfillmentMode='vault'` (la de siempre) y NO cambia.** Un
> pedido de **invitado** (`fulfillmentMode='direct_ship'`) **no tiene titularidad**: el item conserva
> `ownerType='platform', ownerUserId=null, ownershipStatus=null` durante todo el ciclo y este lo lleva `status`
> (`reserved → picking → shipped → delivered`), estrenando los tres valores que el bloque de arriba declara "sin uso
> por diseño". **Invariante que se eleva a norma con esta versión: `ownerType='customer'` ⇒ `ownerUserId NOT NULL`**
> (es lo que hace segura la nulabilidad de `Order.userId`). Ciclo completo y reversos en **§4.21c**.

### 3.4 Protección de PII (cifrado en reposo, blind index, enmascarado, retención)

La PII sensible del proyecto es **CLABE, RFC e imágenes de INE**. Se protege en cuatro capas independientes y acumulativas. Ninguna capa reemplaza a otra: el cifrado protege el dato en la BD, el blind index permite buscar sin descifrar, el enmascarado protege el dato en las respuestas, y la retención limita cuánto tiempo existe la copia más sensible. Las llaves y diales (`PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`, `INE_RETENTION_DAYS`) se declaran en **§8** (ver allí; no se repiten valores aquí).

Columnas afectadas (nombres `*Enc` / `*Hmac`, coherentes con lo implementado por backend):

| Entidad | Campo lógico | Columna cifrada | Columna blind index |
|---|---|---|---|
| `KycProfile` | CLABE | `clabeEnc` | `clabeHmac` |
| `KycProfile` | RFC | `rfcEnc` | — |
| `SellRequest` | CLABE snapshot | `clabeSnapshotEnc` | — |
| `BillingProfile` | RFC | `rfcEnc` | — |

Estas columnas sustituyen a los campos en claro `clabe` / `rfc` / `clabeSnapshot` que aparecen descritos en §3.2 (§3.4 es la descripción normativa de su almacenamiento real: en la BD nunca hay CLABE/RFC en claro).

#### a) Cifrado en reposo — AES-256-GCM

- Algoritmo **AES-256-GCM** (cifrado autenticado: confidencialidad + integridad vía tag).
- **Formato de columna:** `v1:iv:tag:ciphertext`, donde `iv`, `tag` y `ciphertext` van en **base64** y `v1` es el prefijo de versión de esquema (permite rotar algoritmo/llave sin ambigüedad y migrar filas viejas). El **IV es aleatorio por operación de cifrado** (12 bytes recomendados para GCM); nunca se reutiliza.
- **Llave:** `PII_ENCRYPTION_KEY` (32 bytes en base64). En local puede venir de `.env`; en **prod proviene de KMS / secret manager** (nunca en repo ni en imagen). El prefijo `v1` habilita rotación de llave por versión.
- **Dónde:** cifrar/descifrar ocurre **en la capa de servicio** (p. ej. un `PiiCryptoService` inyectable usado por `users`/`buylist`), no en el controlador ni en el cliente Prisma directo. Prisma persiste el string `v1:...` tal cual; la BD no conoce la llave.
- Firmas de referencia (pseudocódigo, no implementación):
  ```ts
  interface PiiCryptoService {
    encrypt(plaintext: string): string;            // -> "v1:iv:tag:ciphertext" (base64)
    decrypt(payload: string): string;              // valida tag GCM; lanza si fue manipulado
  }
  ```

#### b) Blind index — HMAC-SHA256 (`KycProfile.clabeHmac`)

- Problema que resuelve: la regla **"CLABE a nombre propio"** (`CLABE_NOT_OWN_NAME`) y la detección de la misma CLABE reusada requieren **igualar CLABEs sin descifrarlas**. El GCM con IV aleatorio es **no determinista** (dos cifrados de la misma CLABE dan distinto ciphertext), así que no sirve para buscar/igualar.
- Solución: `clabeHmac` = **HMAC-SHA256(clabe_normalizada, PII_HMAC_KEY)**, determinista, guardado junto al `clabeEnc`. El match se hace comparando HMACs.
- **Llave separada** `PII_HMAC_KEY` (distinta de `PII_ENCRYPTION_KEY`): así, comprometer una no habilita descifrar ni recomputar el índice de la otra; además el HMAC con llave evita ataques de diccionario sobre el espacio pequeño de CLABEs (10^18 pero enumerable).
- **Comparación en tiempo constante** (`crypto.timingSafeEqual`) para no filtrar coincidencias por temporización.
- Normalización previa (quitar espacios, validar 18 dígitos) antes del HMAC, para que la comparación sea estable.
- Firma de referencia:
  ```ts
  clabeBlindIndex(clabe: string): string;          // HMAC-SHA256 hex/base64, determinista
  ```

#### c) Enmascarado por defecto en todas las respuestas

- **Por defecto, toda respuesta enmascara PII**, en cliente y back-office, **incluido `super_admin`**. Coherente con el contrato (§preámbulo y endpoints `me/kyc`, `me/billing-profile`, `admin/buylist/:id`, `admin/users/:id`).
- Formato: **CLABE → `****1234`** (solo últimos 4 dígitos, campo `clabeMasked`); **RFC → parcial** (ej. `XAX**********`, campo `rfcMasked`). El servicio expone helpers `maskClabe()` / `maskRfc()` y los DTO **nunca** contienen el campo en claro ni el blob `*Enc`/`*Hmac`.
- **Única excepción:** `GET /admin/buylist/:id/reveal-clabe` — devuelve la **CLABE de 18 dígitos en claro**. Requisitos acumulativos:
  - rol **`super_admin`**,
  - **`MoneyOutGuard`** (misma puerta que pagos SPEI / reembolsos / recompra),
  - **auditado** en `AuditLog` (`action: buylist.reveal_clabe`, quién/cuándo/qué `SellRequest`),
  - **fallback:** si `SellRequest.clabeSnapshotEnc` falta, descifra la CLABE desde `KycProfile.clabeEnc` del usuario dueño.
- Este endpoint es el **único** punto de todo el sistema que devuelve CLABE en claro; su propósito es que el súper-admin la copie a su banca al ejecutar el SPEI manual.

#### d) Retención de imágenes de INE

- Las imágenes de INE (`KycProfile.ineFrontKey`, `ineBackKey`) son la PII de mayor sensibilidad y **no se necesitan indefinidamente** tras verificar KYC. Se purgan por **retención con dial**.
- **Dial** `INE_RETENTION_DAYS` (declarado en §8): antigüedad máxima de las imágenes de INE en el bucket.
- **Primera capa — job invocable** (BullMQ, en la familia de `jobs/`): recorre los `KycProfile` cuyas imágenes superan `INE_RETENTION_DAYS` desde su carga/verificación, **borra los objetos** (`ineFrontKey`/`ineBackKey`) del object storage, **limpia las columnas de key** (a `null`) y **audita** la purga (`action: kyc.ine_purged`, `AuditLog`). Es **invocable** (bajo demanda por súper-admin además de programado), idempotente y seguro de re-ejecutar.
- **Anclaje al cierre real (v1.8-ronda-c / SEC-D2):** la ventana de retención se cuenta desde el **cierre de la última `SellRequest`** del usuario (una vez sin solicitudes abiertas). El job usa **`SellRequest.closedAt`** (seteado al llegar a `pagada`/`rechazada`/`abandonada`, §3.2) como fecha de cierre — más preciso que la aproximación previa `max(paidAt,approvedAt,verifiedAt,receivedAt,createdAt)`, que para `rechazada`/`abandonada` caía en `createdAt` y **acortaba** la ventana. **Fallback:** si `closedAt` es `null` (filas cerradas antes de M-19), el job cae a la aproximación anterior — sin backfill obligatorio. La lógica: `closureDate = req.closedAt ?? max(paidAt, approvedAt, verifiedAt, receivedAt, createdAt)`.
- **Segunda capa — lifecycle del bucket:** regla de expiración en el object storage sobre el prefijo de INE, como red de seguridad si el job no corriera (defensa en profundidad; devops la configura).
- **Qué se conserva:** los **metadatos de KYC** (`kycStatus`, `verifiedBy`, `verifiedAt`, límites) permanecen — no se borra el perfil ni el historial de verificación; **solo se purgan las imágenes**. Tras la purga, el contrato sigue exponiendo `ineOnFile: boolean` (que pasará a `false`).

Notas de coherencia:
- El contrato (`API_CONTRACT.md`) **nunca** expone `*Enc`/`*Hmac` ni CLABE/RFC en claro fuera de `reveal-clabe`; §3.4 es el respaldo de esa promesa.
- La proyección reducida de `vault_operator` (sin CLABE/RFC/INE) opera **antes** del enmascarado: a ese rol no le llega ni el campo enmascarado sensible cuando el contrato así lo indica.

### 3.5 Estándar de condición del raw = solo Near Mint (NM)

- El raw se opera **únicamente en NM** en TODO el marketplace (Compra, inventario, filtros, buylist). El enum `RawCondition` queda reducido a `NM` (ver §3.2 InventoryItem y §11 Migraciones).
- **Nomenclatura legible (i18n del front, NO en la API):** el código `NM` es el único valor que viaja por el contrato. Los **labels/descripciones legibles viven en `frontend/src/i18n/messages/{es,en}.json`** (propiedad de frontend/ux-ui), no en el backend. Texto canónico de referencia que el front debe reflejar:
  - **ES:** `NM` = **"Casi nueva (Near Mint)"** — *"Como nueva; a lo mucho imperfecciones mínimas. Bordes limpios y superficie sin rayones notorios."*
  - **EN:** `NM` = **"Near Mint"** (espeja el texto ES).
- **Política de compra NM-only (buylist):** "Solo compramos cartas en Near Mint (NM); si al recibir/verificar no está en NM, no se compra." Copy visible en cotizador, guía de envío y términos (front). Carta recibida no-NM → `rechazada` (no se paga) → devolución 7 días a costo del usuario, abandono a 30 días; **una carta abandonada no-NM NO entra al inventario vendible** (se segrega/descarta). No existe grado distinto de NM que registrar; el "no-NM" es un resultado de verificación que **rechaza** el item, no un valor de `rawCondition`.

### 3.6 Sellado como línea de venta (productType=sealed)

- El sellado es una **línea de venta de primera clase** en Compra, distinta de raw/graded.
- **Sin `rawCondition`, sin `gradingCompany`/`gradeValue`, sin rareza** (no aplica taxonomía de carta individual). Puede referenciar un `Card`/`CardSet` para nombre/imagen del producto, pero no lleva condición ni rareza.
- **Precio SIEMPRE manual del admin en MXN**: no hay fuente automática en el MVP (pokemontcg.io no cubre sellado; PriceCharting = fase 2). El `listPriceCents` se fija a mano (override manual) y es **obligatorio para publicar**: sin precio, el sellado queda como "precio pendiente" y **no aparece en Compra** (regla general — el comprador nunca ve precio pendiente).
- `sealedSubtype?` (`box | etb | bundle | tin | blister`) opcional; alimenta el filtro de tipo de producto en Compra (subfaceta informativa).
- **Referencia de mercado del sellado (v1.19-sealed-tcgcsv, §4.19):** existe una fuente automática de **valor de
  referencia** para sellado — **TCGCSV** (espejo diario de precios de TCGplayer) — pero es **estrictamente informativa**
  (sugerencia para el admin en M1/M2 al fijar `listPriceCents`). **NO altera esta sección:** el precio de VENTA del
  sellado sigue siendo manual en MXN y obligatorio para publicar; la ficha pública no muestra la referencia TCGCSV en
  esta versión. El mapeo item↔producto TCGplayer es curación manual (`InventoryItem.tcgplayerProductId`, M-23).
- **Disputa de sellado (v1.2):** aplica a caja **dañada/equivocada** (no hay "condición NM" que comparar). **La evidencia se envía por correo a soporte** (no hay foto de ingreso ni comparador; ver §Dispute). El flujo reutiliza `Dispute` con `type=condition_sealed`.

---

### 3.7 Acabado / versión de carta (`Finish`) — v1.6-finish

Una misma `Card` puede existir en varios **acabados** (versiones de impresión). El acabado es una **dimensión de
primera clase** del precio, la cotización, el inventario y la valuación. **NO** rompe "1 fila por `Card`": los
acabados disponibles viven en `Card.availableFinishes` (array en la misma fila), y cada `InventoryItem`/
`SellRequestItem`/`PriceReference` referencia **un** acabado concreto.

**Enum canónico:** `Finish = normal | reverse_holo | holofoil | first_edition_holofoil`.

**Mapeo `tcgplayer.prices` (llave remota) → `Finish` (decisión del humano, PROJECT §I):**

| Llave `tcgplayer.prices` | `Finish` | Nota |
|---|---|---|
| `normal` | `normal` | |
| `reverseHolofoil` | `reverse_holo` | |
| `holofoil` | `holofoil` | |
| `1stEditionHolofoil` | `first_edition_holofoil` | |
| `1stEditionNormal` | *(no mapeada en el MVP)* | Se ignora al derivar `availableFinishes`. Ver pregunta abierta v1.4-1. |
| `unlimitedHolofoil` / `unlimited` | *(no mapeada en el MVP)* | Idem. |

**Orden canónico (`FINISH_ORDER`, NORMATIVO desde v1.22):** `normal → reverse_holo → holofoil →
first_edition_holofoil`. Es el orden en que se **persiste** `Card.availableFinishes` y en que se **emite** en todo
DTO que lo exponga. De él sale, sin `sort` en el front, el requisito del PO: **la normal a la izquierda, la reverse
holo a la derecha**.

- **Derivación de `availableFinishes` (v1.22 — REESCRITA; la regla operativa completa está en §4.22a):** la deriva
  **solo** el sync de catálogo (`upsertCards`, §4.8) combinando **dos** señales del payload remoto:
  (1) las **llaves presentes** de `card.tcgplayer.prices` mapeadas con la tabla de arriba — **la llave presente ES la
  señal**, con `market` o sin él— y (2) `reverse_holo` si algún campo `card.cardmarket.prices.reverseHolo*` trae un
  **número > 0**. **Sin ninguna señal** → no se sobrescribe lo existente (y `[normal]` solo al **crear**).
  `price-ingest` **no escribe** este campo (§4.22a; deroga §4.15e). El `client` de pokemontcg.io **deja de descartar**
  `tcgplayer.prices` (§4.8) y **debe dejar de descartar `cardmarket.prices`** (§4.22a).
  - ❌ **Prohibido REDUCIR acabados por la AUSENCIA de un precio** (`PriceReference`, `market` faltante): precio ausente
    ≠ variante inexistente. Este fue el bug de tres rondas (VAR-1). **Este núcleo de la regla 2 sigue vigente.**
  - ⛔ **v1.22-1 (§4.22g) — la CONVERSA money-safe queda DEROGADA en v1.27 (§4.25a): el precio CONFIRMA, nunca
    AÑADE.** ~~El `market > 0` vía alias VERIFICADO (Señal C, `pricedFinishesSnapshot`) AÑADÍA el acabado a la unión
    derivada~~ — esa unión resultó ser el vector de las variantes fantasma (P-13). El snapshot se **conserva** como
    observabilidad/confirmación, pero **ya no compone** `availableFinishes`. Siguen vigentes de v1.22-1: el escritor
    único `catalog.FinishReconciler` y que los alias **SUPUESTO** jamás tocan la lista blanca (candados de §4.22g).
  - ❌ **Prohibida cualquier heurística por rareza** («toda Common tiene reverse holo»): inventaría casillas de relleno,
    que el PO prohíbe explícitamente.
  - ✅ **v1.26 (§4.24a) — la composición se DETECTA de la fuente ESTRUCTURAL autoritativa (TCGCSV), NO de rareza/era
    NI de la presencia de una llave de precio.** Regla reformulada: *detectar la composición desde la fuente
    autoritativa TCGCSV; jamás inferir por rareza/era; la ESTRUCTURA es separada del PRECIO; una impresión estructural
    sin precio es «pendiente» — nunca inventada y nunca dropeada.* La prohibición money→estructura de VAR-1 sigue
    intacta (el precio jamás añade ni quita una impresión). La estructura entra por `Card.structuralFinishes` (§4.24a),
    que **ancla/reemplaza** el proxy-de-precio `catalogFinishes` ~~en la unión del reconciliador~~ (⛔ v1.27: la unión
    quedó derogada; ver bullet siguiente).
  - ⛔ **v1.27 (P-13, §4.25a-1) — «SOLO STRUCTURAL» DEROGADA 2026-08-22 (regresión en prod).**
    ~~`availableFinishes := structuralFinishes ≠ ∅ ? orderFinishes(structuralFinishes) : ['normal']`~~ — quitar el
    snapshot degradó a los comunes (perdieron el reverse holo que solo trae el proveedor de precios) y no limpió a las
    ex (su `normal` stale de M-29 sobrevivió). Ver §4.25e.
  - ✅ **v1.27.1 (P-13-fix, §4.25e) — FÓRMULA VIGENTE: la unión vuelve, el fantasma no.**
    `availableFinishes := orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot) − { normal | isPremiumRarity(rarity) } ) || ['normal']`.
    La UNIÓN vuelve (recupera el reverse legítimo del común, que en sets nuevos solo vive en el snapshot) pero se
    **filtra `normal` en rareza premium** (mata el fantasma de la ex — filtro ESTRUCTURAL por rareza, no por precio).
    Helper `composeAvailableFinishes(structuralFinishes, pricedFinishesSnapshot, rarity)` en `card-order.ts` (reusa
    `isPremiumRarity` de `money.ts`), fallback `['normal']`. **VAR-1 intacto:** el precio confirma una impresión física
    real (el reverse del común lo es); la rareza premium solo GATE-oculta un `normal` que esa carta nunca tiene físico,
    jamás inventa un acabado. Escritor único `FinishReconciler`, ahora selecciona/pasa `rarity`.
- **Alcance por tipo de producto:** el acabado aplica a **raw/singles**. Para `graded`/`sealed` el `finish` es
  siempre `normal` (el slab/sellado no distingue acabado a efectos de precio); el default lo cubre y no cambia el
  comportamiento actual.
- **Validación (SEC-A1):** cualquier `finish` recibido del cliente (cotizador, alta de inventario) se **valida
  contra `card.availableFinishes`**; si no pertenece → `422 FINISH_NOT_AVAILABLE`. El monto/precio **nunca** se
  toma del cliente: se deriva server-side de `(Card.rarity, finish)` (§4.2).
- **`displayFinishes` vs `availableFinishes` (v1.22-2 / N-15, §4.22a-6):** `availableFinishes` es la **whitelist
  SEC-A1** (validación + derivación de dinero) y **no cambia**. `displayFinishes: Finish[]` es un campo **derivado
  de DISPLAY** (`⊆ availableFinishes`, mismo `FINISH_ORDER`) que **oculta el acabado espurio** de una carta
  **premium de una sola impresión** (`normal` que entró solo por llave de `tcgplayer.prices` sin `market>0`). Solo
  RESTA casillas; nunca AÑADE. **La prohibición de heurística por rareza SIGUE VIGENTE:** N-15 usa `isPremiumRarity`
  únicamente como *gate* para ocultar un acabado que **ya está** en la whitelist —**no** deriva ni **inventa**
  acabados por rareza; en particular **no inventa `reverse_holo`** (VAR-1 intacto, §9).
- **Filas históricas / default:** `Card.availableFinishes=[normal]`, `InventoryItem.finish=normal`,
  `SellRequestItem.finish=normal`, `PriceReference.finish=normal`. El **re-sync** repuebla los reales.

## 4. Módulos y límites

### 4.1 PricingProvider (intercambiable)
Interfaz (pseudocódigo, en `modules/pricing`):
```ts
interface PricingProvider {
  readonly source: PriceSource;               // pokemontcg_io | pokemonpricetracker | poketrace | manual
  supports(productType: ProductType): boolean;
  // v1.6-finish: `finish` añadido al input. Devuelve precio USD (o MXN) del acabado pedido, o null.
  fetchPrice(input: { card: Card; productType: ProductType; gradeKey: string; finish: Finish }): Promise<PriceQuote | null>;
}
```
Implementaciones MVP:
- `PokemonTcgIoProvider` → raw/singles (TCGPlayer "Market Price" vía pokemontcg.io).
- `PokemonPriceTrackerProvider` / `PokeTraceProvider` → graded y sealed (free tier).
- `ManualOverrideProvider` → override del admin (siempre disponible como respaldo).

**v1.6-finish — precio POR acabado:** `PokemonTcgIoProvider.fetchPrice` mapea `finish → llave de
`tcgplayer.prices` (inverso de la tabla §3.7: `normal→normal`, `reverse_holo→reverseHolofoil`,
`holofoil→holofoil`, `first_edition_holofoil→1stEditionHolofoil`) y lee **ese** `prices[llave].market`
(antes tomaba el **primer** market disponible, mezclando acabados). Si esa llave no existe → `null` →
"precio pendiente" para ese acabado. Los providers de `graded`/`sealed` ignoran `finish` (siempre `normal`).

`PricingService` orquesta:
1. Elige provider según `productType` leyendo el dial de M10 (`pricing_provider_*`).
2. **Solo pricea cartas en bóveda** (no el catálogo completo) y con **cache diario** (revisa `PriceReference` del día **para ese acabado** antes de llamar la API). **`getReference(cardId, productType, gradeKey, finish)`** y **`syncCardPrice(card, productType, gradeKey, finish, context, refId?)`** ganan `finish`; el upsert/lookup usa la clave compuesta con `finish` (§3.2 PriceReference). `buildGradeKey` NO cambia (el finish es parámetro aparte).
3. Aplica **FX + colchón** (`FxService`) para obtener `priceMxnCents`.
4. Si el provider devuelve `null` y no hay override → crea `PendingPriceEntry` **por acabado** y expone el estado **"precio pendiente"** (no vendible; escalado al dueño).
5. Respeta rate-limit del free tier vía cola BullMQ.

**v1.8-ronda-c — cola de precio pendiente POR ACABADO:** `PendingPriceEntry` gana `finish` (§3.2, M-19) y las dos rutinas de la cola lo incorporan a la llave:
- **`escalatePending(cardId, productType, gradeKey, finish, context, refId?)`** dedupe por `(cardId, productType, gradeKey, finish, status='open')`. **Corrección de implementación (BE):** hoy `syncCardPrice` invoca `escalatePending` **sin** pasar `finish` (bug: colapsa acabados) — con M-19 debe **propagar** el `finish` del `syncCardPrice`.
- **`manualOverride(cardId, productType, gradeKey, priceMxnCents, finish='normal')`** ya crea la `PriceReference` del acabado correcto (clave con `finish`), pero su `updateMany` que **resuelve** pendientes filtraba `{cardId, productType, gradeKey, status:'open'}` **sin `finish`** → cerraba TODOS los acabados. Con M-19 el `updateMany` **añade `finish`**, resolviendo **solo** el pendiente de ese acabado (el de `holofoil` sigue abierto hasta que se le fije precio). `getReference(...finish)` no cambia (ya era por-acabado); no se rompe SEC-A1 (los montos siguen derivándose server-side de `(Card.rarity, finish)`).

### 4.2 AcquisitionPricer (buylist) — tabla de precio por RAREZA OFICIAL (v1.3.1)

> **Reemplaza** el esquema de 3 categorías (`RARITY_MAP` + `BuylistCategory`). El monto a pagar por el buylist
> se resuelve con una **regla por rareza oficial de Pokémon** (la de `Card.rarity`, tal cual pokemontcg.io),
> editable desde **M2** sin redeploy. PROJECT.md §E.1, criterios 12/12b/12c/18.

**Modelo de config (diales M2, persistidos en `ConfigSetting`):**
- `BUYLIST_PRICE_RULES` (`buylist_price_rules`): mapa **`{ [rarity: string]: BuylistRule }`** donde
  `BuylistRule = { mode: 'fixed' | 'pct', value: number }`.
  - `mode='fixed'` → `value` = **monto MX$ en centavos** (entero ≥ 0). **No requiere** referencia de mercado → siempre cotiza.
  - `mode='pct'`  → `value` = **porcentaje** (número en `[0, 100]`) del **precio de referencia** del día.
- `BUYLIST_PRICE_FALLBACK_PCT` (`buylist_price_fallback_pct`): **porcentaje** (default **40**) que se aplica a
  cualquier rareza **sin regla explícita** (rareza nueva tras un sync, o no configurada). Es un `pct` implícito.

**Función pura (pseudocódigo — reemplaza a `quoteAcquisition(category, ref)`):**
```ts
type BuylistRuleMode = 'fixed' | 'pct';
interface BuylistRule { mode: BuylistRuleMode; value: number; }   // value = cents si fixed, % si pct

function quoteAcquisition(
  rarity: string | null,
  referenceMxnCents: number | null,
  rules: Record<string, BuylistRule>,       // BUYLIST_PRICE_RULES
  fallbackPct: number,                       // BUYLIST_PRICE_FALLBACK_PCT (default 40)
): { quotedPriceCents: number|null; status: 'cotizada'|'precio_pendiente';
     appliedRule: BuylistRule; ruleSource: 'rule'|'fallback'; } {
  // 1) Busca regla por la RAREZA OFICIAL real (exact match sobre Card.rarity).
  const explicit = rarity != null ? rules[rarity] : undefined;
  const rule: BuylistRule = explicit ?? { mode: 'pct', value: fallbackPct };  // sin regla → fallback %
  const ruleSource = explicit ? 'rule' : 'fallback';

  // 2) FIXED: monto fijo en centavos; nunca depende de la referencia → siempre 'cotizada'.
  if (rule.mode === 'fixed') {
    return { quotedPriceCents: rule.value, status: 'cotizada', appliedRule: rule, ruleSource };
  }
  // 3) PCT: % de la referencia; si falta referencia → 'precio_pendiente' (escala al dueño, nunca se descarta).
  if (referenceMxnCents == null) {
    return { quotedPriceCents: null, status: 'precio_pendiente', appliedRule: rule, ruleSource };
  }
  return { quotedPriceCents: Math.round(referenceMxnCents * rule.value / 100),
           status: 'cotizada', appliedRule: rule, ruleSource };
}
```

**SEC-A1 (guardarraíl intacto):** la `rarity` que determina el monto se **deriva server-side de la carta real**
(`Card.rarity` por `cardId`), **nunca** del DTO del cliente. Un DTO malicioso no puede elegir regla ni inflar el
monto; el cliente ya **no envía** `category` (removida del contrato). La **condición de compra es siempre NM**
(§3.5); no hay grados que discriminen la tarifa.

**Fallback = % default (decisión del humano, PROJECT §E.1 / pregunta abierta 2 resuelta):** una rareza sin regla
**no** deja la carta en "precio pendiente" por sí sola; se cotiza con `BUYLIST_PRICE_FALLBACK_PCT`. Solo cae en
**"precio pendiente"** si la regla efectiva es `pct` **y** falta la referencia de mercado (`referenceMxnCents ==
null`). Las reglas `fixed` **nunca** quedan pendientes (no dependen de la referencia). El "precio pendiente" es un
estado de adquisición/back-office (`SellItemStatus=precio_pendiente`, escala al dueño vía `PendingPriceEntry`) y
**nunca** se muestra al comprador (regla de Compra, §4.9).

**Seed inicial (preserva el negocio vigente; editable por el dueño en M2):**
```jsonc
// BUYLIST_PRICE_RULES
{
  "Common":       { "mode": "fixed", "value": 50  },   // MX$0.50
  "Uncommon":     { "mode": "fixed", "value": 50  },   // MX$0.50
  "Reverse Holo": { "mode": "fixed", "value": 150 }    // MX$1.50
}
// BUYLIST_PRICE_FALLBACK_PCT = 40
```
Todo lo demás (Rare Holo, EX/GX/V/VMAX/VSTAR, Ultra Rare, Illustration Rare, Special Illustration Rare, Full Art,
Alternate Art, Trainer Gallery, Character Rare, Radiant, Hyper/Secret/Rainbow, etc.) **cae al fallback = 40% de la
referencia**, reproduciendo el resultado del antiguo `ex_plus`. **Granularidad por rareza (pregunta abierta 3
resuelta):** cada fila tiene su propio `value`, así que el dueño puede fijar un % distinto por rareza (ej.
Illustration Rare 45%, Secret Rare 35%) sin tocar código; el default es 40% para todas las de porcentaje.

**NOTA para PO/humano (rareza `Rare` no-holo):** el `RARITY_MAP` legacy mapeaba `Rare` (no-holo) → `comun`
($0.50 fijo). El seed v1.3.1, siguiendo la instrucción "todo lo demás = 40%", **no** siembra `Rare` como fixed,
así que por defecto `Rare` cae al fallback 40%. Si el negocio quiere conservar $0.50 fijo para `Rare`, el dueño
añade una fila `"Rare": { mode: "fixed", value: 50 }` en M2 (cambio de dato, sin deploy). Cambio deliberado y
reversible desde el editor.

**Alcance = solo buylist (pregunta abierta 4 resuelta):** esta tabla afecta **únicamente** la cotización de
compra al usuario (buylist). El **costo de aportación en especie** del inventario propio sigue usando su dial
propio (`aportacion_pct`, default 70%); no se toca.

#### 4.2.1 Cotización POR ACABADO (v1.6-finish)

La cotización es **por acabado**. El `finish` seleccionado (validado contra `card.availableFinishes`, SEC-A1)
determina **dos cosas de forma determinista y server-side**: (a) **qué regla** de `BUYLIST_PRICE_RULES` aplica y
(b) **qué referencia de mercado** usa el `pct` (la `PriceReference` de ESE acabado, §4.1). El mapeo (decisión del
humano, PROJECT §I) se implementa como una **cadena de candidatos de `ruleKey`** — gana el **primero con regla
explícita**; si ninguno existe → `BUYLIST_PRICE_FALLBACK_PCT`:

```ts
type Finish = 'normal' | 'reverse_holo' | 'holofoil' | 'first_edition_holofoil';

// Una rareza "ya es holo" si su string (pokemontcg.io) contiene "holo" (case-insensitive):
// "Rare Holo", "Rare Holo EX/GX/V/VMAX/VSTAR"… (NO "Ultra Rare"/"Illustration Rare", que caen al fallback igual).
function isHoloRarity(rarity: string | null): boolean {
  return rarity != null && rarity.toLowerCase().includes('holo');
}

// Fase 0.1 (fix bug de dinero) — clasificador de rareza PREMIUM (chase / alto valor). Case-insensitive,
// por substrings/tokens representativos (la taxonomía de pokemontcg.io es abierta). Ver definición
// canónica y lista de patrones abajo ("Contrato de pricing: isPremiumRarity"). Una rareza premium NUNCA
// puede resolver a un bin fijo barato de bulk (la clave sintética "Holo" ni ninguna regla `fixed` de bulk):
// solo su PROPIA regla explícita o el fallback pct (% de mercado). Se prefiere sobre-incluir (una carta
// barata clasificada premium solo pasa a "% de mercado", inocuo) que sub-incluir (una chase tratada como
// bulk = pérdida de dinero).
function isPremiumRarity(rarity: string | null): boolean {
  if (rarity == null) return false;
  const s = rarity.toLowerCase();
  return PREMIUM_RARITY_PATTERNS.some((re) => re.test(s));  // patrones abajo
}

// Candidatos de ruleKey EN ORDEN DE PRIORIDAD (primero con regla explícita en BUYLIST_PRICE_RULES gana).
// Fase 0.1: la RAREZA REAL va SIEMPRE primero; para holofoil/1st-ed una rareza PREMIUM NO incluye "Holo".
function ruleKeyCandidates(rarity: string | null, finish: Finish): string[] {
  switch (finish) {
    case 'reverse_holo':            return ['Reverse Holo'];                                  // siempre la regla "Reverse Holo"
    case 'holofoil':
    case 'first_edition_holofoil':
      // GATE PREMIUM: una rareza chase (ex/full art/Illustration/Ultra/Double Rare, V/VMAX/VSTAR/GX…) NUNCA
      // cae al bin fijo barato de bulk. Solo su propia regla explícita o el fallback pct (% de mercado).
      if (isPremiumRarity(rarity)) return [rarity!];                                          // premium → SOLO su regla; NUNCA "Holo"
      return isHoloRarity(rarity) ? [rarity!, 'Holo'] : ['Holo'];                             // no-premium: holo de bulk → rareza real, luego "Holo"; Common/Uncommon → "Holo"
    case 'normal':                  return rarity != null ? [rarity] : [];                     // regla de la rareza base
    default:                        return [];
  }
}

// referenceMxnCentsForFinish = PriceReference.priceMxnCents del ACABADO cotizado (getReference(..., finish)).
function quoteAcquisitionForFinish(
  rarity: string | null, finish: Finish,
  referenceMxnCentsForFinish: number | null,
  rules: Record<string, BuylistRule>, fallbackPct: number,
) {
  const candidates = ruleKeyCandidates(rarity, finish);
  const hitKey = candidates.find((k) => rules[k] != null);
  const rule = hitKey ? rules[hitKey] : { mode: 'pct', value: fallbackPct };
  const ruleSource: 'rule' | 'fallback' = hitKey ? 'rule' : 'fallback';
  // De aquí en adelante idéntico a quoteAcquisition (§4.2): fixed → value (siempre 'cotizada');
  // pct → round(referenceMxnCentsForFinish × value/100), o 'precio_pendiente' si la referencia del acabado falta.
  return applyRule(rule, ruleSource, referenceMxnCentsForFinish);
}
```

**Contrato de pricing: `isPremiumRarity` (Fase 0.1, 2026-08-17) — parte de la fuente de verdad.** El gate premium
es **parte del contrato de pricing** (no un detalle de implementación): define qué rarezas jamás pueden cotizar al
bin fijo barato de bulk. Se evalúa case-insensitive sobre `Card.rarity` con esta **lista canónica de patrones**
(substrings/tokens; `\b` = límite de token):

| Patrón | Cubre |
|---|---|
| `illustration` | Illustration Rare, Special Illustration Rare |
| `ultra\s*rare` | Ultra Rare (full art) |
| `double\s*rare` | Double Rare (= ex, era Scarlet & Violet) |
| `secret` | Rare Secret / Secret Rare |
| `rainbow` | Rainbow Rare |
| `hyper` | Hyper Rare |
| `full\s*art` | Full Art |
| `alt(ernate)?\s*art` | Alternate Art / Alt Art |
| `special` | Special Illustration Rare, etc. |
| `amazing` | Amazing Rare |
| `radiant` | Radiant |
| `shiny` | Rare Shiny / Shiny Ultra Rare |
| `trainer\s*gallery` | Trainer Gallery |
| `character` | Character Rare / Super Rare |
| `gold` | Gold (secret) Rare |
| `prism` | Prism Star |
| `\b(v\|vmax\|vstar\|vunion\|v-union\|ex\|gx)\b` | V-series y EX/GX como tokens sueltos (p. ej. "Rare Holo VMAX") |

**NO premium (bulk legítimo, excluidas a propósito):** Common, Uncommon, Rare (no-holo), Rare Holo (plano),
Reverse Holo. Criterio de diseño: **sobre-incluir es inocuo** (una carta barata mal clasificada como premium solo
pasa a "% de mercado"), **sub-incluir cuesta dinero** (una chase tratada como bulk cotiza al bin fijo barato). Si un
sync trae una rareza chase nueva no cubierta, cae al **fallback pct** por ser rareza sin regla explícita — nunca al
bin fijo.

**Por qué el gate premium (fix del bug de dinero, Fase 0.1):** las cartas chase modernas (ex, Full Art, Illustration
Rare, V/VMAX/VSTAR…) **solo existen en holofoil**, pero su string de rareza **no** contiene "holo". Antes, el
candidato para holofoil de una rareza no-holo era `['Holo']`; con una regla `"Holo"` fija barata de bulk (la que el
admin puede sembrar), esas chase de miles de pesos cotizaban al bin fijo (**"$1.50 cotizada"**) — bug estructural de
dinero. El gate cierra esa vía: **una rareza premium en holofoil/1st-ed solo resuelve a su propia regla explícita o
al fallback pct (% de mercado)**, jamás a `"Holo"` ni a ningún `fixed` de bulk. La rareza real va **siempre primero**
en los candidatos.

**Por qué la guarda `isHoloRarity` (no-premium) en Holofoil:** para rarezas **no-premium**, sin la guarda un
**Common en Holofoil** resolvería a la regla `"Common"` (fixed $0.50 bulk) por ser el primer candidato —
**incorrecto**: una copia holofoil vale un % de su market. Con la guarda, para rarezas NO-holo y NO-premium
(Common/Uncommon/Rare no-holo) el Holofoil salta directo a `"Holo"` (no sembrada por defecto → **fallback 40%** del
market **holofoil**), y solo una rareza **ya holo** (p. ej. "Rare Holo" plano) con regla explícita usa su propia
regla. Para rarezas holo de bulk sin regla explícita, ambos candidatos caen al fallback 40% (mismo resultado).

**Resultado con el seed vigente (defaults):**

| `Card.rarity` | `finish` | ¿premium? | ruleKey resuelto | Regla | Monto |
|---|---|---|---|---|---|
| Common | `normal` | no | `Common` | fixed 50 | **$0.50** |
| Common | `reverse_holo` | no | `Reverse Holo` | fixed 150 | **$1.50** |
| Common | `holofoil` | no | `Holo` (no sembrada) → fallback | pct 40 | **40% del market holofoil** |
| Illustration Rare | `normal` | sí | `Illustration Rare` (no sembrada) → fallback | pct 40 | **40% del market normal** |
| Illustration Rare | `holofoil` | **sí** | `Illustration Rare` (no sembrada) → fallback — **nunca `"Holo"`** | pct 40 | **40% del market holofoil** |
| Rare Holo ex | `holofoil` | **sí** | `Rare Holo ex` (no sembrada) → fallback — **nunca `"Holo"`** | pct 40 | **40% del market holofoil** |
| Rare Holo | `holofoil` | no | `Rare Holo`→`Holo` (ninguna sembrada) → fallback | pct 40 | **40% del market holofoil** |
| cualquiera | `first_edition_holofoil` | igual que `holofoil` | — | — | **% del market `1stEditionHolofoil`** |

> **Blindaje del gate (antes vs. ahora):** si el admin sembrara `"Holo"` como `fixed` barato (bin de bulk), **antes**
> una `Illustration Rare`/`ex` en holofoil habría cotizado a ese fijo (bug); **ahora** el gate premium la mantiene en
> su propia regla o el fallback pct, así que **nunca** cae al bin de bulk aunque exista una regla `"Holo"` fija.

**Decisión (2026-08-17): Common/Uncommon en `holofoil` = SE MANTIENE "% del market holofoil" (opción a, sin cambio
de código).** Punto abierto que dejó backend en Fase 0: la regla verbal del humano fue *"solo Common/Uncommon son
precio FIJO de bulk"*, pero el diseño ACTUAL (esta §4.2.1, con tests) cotiza **Common/Uncommon en holofoil** como
**% del market holofoil** vía el candidato `['Holo']` (no como su `fixed` de bulk). Backend **preservó** el diseño
actual para no romper el contrato por su cuenta y escaló la decisión al arquitecto. **Se resuelve mantener el diseño
actual (a).** Justificación:
> - **El caso es marginal por construcción.** `Card.availableFinishes` se **deriva de las llaves de
>   `tcgplayer.prices`**; una Common/Uncommon casi nunca tiene la llave `holofoil` (imprimen en `normal` y
>   `reverseHolofoil`). El guardarraíl **SEC-A1 / `422 FINISH_NOT_AVAILABLE`** bloquea cotizar `holofoil` para una
>   carta que no lo tiene, así que en la práctica el par (Common, holofoil) casi no ocurre.
> - **Cuando SÍ ocurre, "% del market holofoil" es la valuación correcta, no un bug.** Una copia genuinamente
>   holofoil de una común tiene market propio (> $0.50) y vale un % de ese market; llevarla al `fixed` $0.50 de bulk
>   la **sub-cotizaría**. La regla verbal "$0.50 fijo" se pensó para la común **de bulk** (normal/reverse), no para
>   una impresión holofoil atípica. El precio se sigue derivando server-side del market real (SEC-A1 intacto).
> - **La alternativa (b)** — mover Common/Uncommon holofoil a `fixed` de bulk — implicaría **tarea de backend**
>   (nuevo candidato/lógica) y riesgo de sub-cotizar el caso raro, sin beneficio de negocio. **No se pide.**
>
> **Consecuencia:** no hay cambio de código ni de contrato por este punto; **Fase 0 queda cerrable** en lo que
> respecta al arquitecto. Si el humano insistiera en `fixed` de bulk también para el holofoil de comunes, sería un
> requisito nuevo de PROJECT.md que se enrutaría a backend vía el flujo normal (arquitecto → contrato → backend).

**Claves sintéticas vs rareza real:** `"Reverse Holo"` y `"Holo"` son **ruleKeys sintéticos** del acabado (no son
`Card.rarity`); conviven en `BUYLIST_PRICE_RULES` con las rarezas reales. `"Reverse Holo"` viene **sembrado**
(fixed $1.50); `"Holo"` **no** (→ fallback 40%), pero el dueño puede añadirlo en M2 sin deploy. Esto **cierra la
brecha** del v1.3.1, donde `"Reverse Holo"` solo aplicaba si `Card.rarity` era literalmente esa cadena (raro); ahora
aplica cuando el **acabado** es reverse holo, que es el caso típico ("esta común la traigo en reverse").

**"Precio pendiente" por acabado (criterio 43):** una carta con regla efectiva `pct` cuyo **acabado no tiene
referencia** (`getReference(..., finish)` = null) cae en `precio_pendiente` (escala al dueño), igual que hoy; las
reglas `fixed` siempre cotizan. `SellRequestItem` snapshotea `finish` + la regla aplicada.

**1st Edition (decisión):** `first_edition_holofoil` mapea a la **misma regla** que `holofoil` (acabado
equivalente), usando el **market de la llave `1stEditionHolofoil`**. Sin regla propia "1st Edition" en el MVP
(pregunta abierta v1.4-2, default asumido); si el dueño la quisiera, se añade un ruleKey dedicado en M2.

### 4.3 Integración Stripe (payments)
- Checkout crea `PaymentIntent` (o Checkout Session) con líneas: subtotal, **fee de procesamiento trasladado**, **IVA 16%**. El total cobrado incluye ambas.
- Webhooks (endpoint único, firma verificada con `STRIPE_WEBHOOK_SECRET`). Detalle de estados en §3.3 y en `API_CONTRACT.md §9`:
  - `payment_intent.succeeded` → `Order.status=settled`, `ownershipStatus=settled` (o liquida el envío).
  - `payment_intent.payment_failed` / `payment_intent.canceled` → libera la reserva de compra o cancela el envío en `solicitado`.
  - `charge.refunded` → **total** ⇒ `Order.status=refunded`; **parcial** ⇒ no cambia el estado (conciliación M7). En ningún caso re-agrega el item (VENTAS FINALES).
  - `charge.dispute.created` → `Order.status=chargeback`, **consciente del estado físico**: revierte el item **solo si sigue en bóveda**; si ya se envió/entregó marca `chargebackNeedsManual` sin re-agregar.
  - `charge.dispute.closed` / `charge.dispute.funds_reinstated` → cierre: ganamos ⇒ `settled` (`disputeOutcome=won`), perdemos ⇒ `chargeback` (`disputeOutcome=lost`).
- Idempotencia por `event.id` (tabla `ProcessedStripeEvent`) para no reprocesar; el evento se marca procesado **solo tras éxito** del handler (si falla, se re-lanza y Stripe reintenta).
- El **fee trasladado** se calcula con gross-up para que la plataforma reciba neto ≈ subtotal+IVA (fórmula exacta: ver Preguntas para el humano).

### 4.4 Back-office M1–M10
Mapa módulo→endpoint en `API_CONTRACT.md §admin`. Autorización por rol/acción (§7).

### 4.5 i18n
Ver §6. El backend expone **enums y `errorCode`s**, no textos traducidos.

### 4.6 Generación de folios y ubicaciones
- Folio: secuencia Postgres `inventory_folio_seq` → formato `INV-` + zero-pad 6 (`INV-000123`). Se asigna al crear el `InventoryItem` en transacción para evitar colisiones.
- Ubicación: `VaultLocation` con `(zone, box, row, slot)` único; `label` derivado para picking legible.

### 4.7 Login con Google (OAuth / ID token)
- Endpoint `POST /api/v1/auth/google` recibe `{ idToken }` (Google Identity Services, flujo del front con `NEXT_PUBLIC_GOOGLE_CLIENT_ID`).
- **Verificación server-side obligatoria** del ID token antes de emitir JWT propios (usar `google-auth-library` o verificación JWKS equivalente). Se validan:
  - **firma** contra las llaves públicas de Google (JWKS),
  - `aud` == `GOOGLE_CLIENT_ID` (env backend),
  - `iss` ∈ `{ accounts.google.com, https://accounts.google.com }`,
  - `exp` no expirado,
  - `email_verified == true` (si no, `403 GOOGLE_EMAIL_UNVERIFIED`).
- Del token verificado se toman `sub` (→ `googleId`), `email`, `name`, `picture` (→ `avatarUrl`). **Nunca** se toma `role` ni ningún privilegio del token.
- Flujo: buscar por `googleId`; si no, por `email` verificado (account-linking, §3.2); si no existe, **crear** `User` (`authProvider=google`, `role=customer`, `emailVerified=true`, `passwordHash=null`).
- Respuesta: **mismo shape que `/auth/login`** → `{ user, accessToken, refreshToken }`. A partir de ahí la sesión es idéntica a la de email/contraseña (mismos JWT, mismos guards).
- El linking se audita (`AuditLog action=auth.google_link`). Env: `GOOGLE_CLIENT_ID` (backend), `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (front) — ver §8.

### 4.7bis Gestión de usuarios por admin (M6, `super_admin`) — reset de contraseña sin correo + borrado híbrido (v1.3.1)

Dos capacidades de M6, ambas **solo `super_admin`** y **auditadas** (M10); ninguna es dinero saliente (no
requieren `MoneyOutGuard`), pero **sí** tocan credenciales/PII, así que su registro en `AuditLog` guarda **solo
IDs/flags, nunca el secreto ni la PII**.

**a) Reset de contraseña iniciado por admin (SIN email transaccional).** `POST /admin/users/:id/reset-password`.
El MVP no manda correos, así que el admin **genera** una contraseña temporal y **se la entrega al usuario por su
propio canal**. Implementación:
- Genera un secreto de **alta entropía** (p. ej. ≥ 16 chars aleatorios de un alfabeto seguro / `crypto`), lo
  **hashea con argon2** (misma rutina que `/auth/register`) y lo guarda en `passwordHash`.
- **Devuelve `tempPassword` en claro UNA sola vez** en la respuesta; **nunca** se persiste en claro, no se
  re-consulta, no se loguea, no entra al `AuditLog` (solo `action=user.reset_password`, actor y target).
- **Revoca sesiones vivas** incrementando `User.tokenVersion` (los refresh/access con versión previa dejan de ser
  válidos). Setea `mustChangePassword=true` (opcional de consumir por el front: tras el primer login, forzar
  "cambiar contraseña"). Si el repo aún **no** versiona tokens, backend implementa `tokenVersion` en este cambio
  (parte de M-15) o lo registra como deuda menor en `TECH_DEBT.md`.
- Habilita login local incluso en cuentas solo-Google (`passwordHash` pasa de null a hash).

**b) Borrado de usuario híbrido hard/soft.** `DELETE /admin/users/:id`. Decide el modo según **si el usuario tiene
historial económico**:
- **Predicado "tiene transacciones"** = existe ≥ 1 fila en `Order` **o** `SellRequest` **o** `ShipmentRequest`
  **o** `Dispute` **o** `InventoryItem(ownerUserId=:id)`. Las relaciones no económicas
  (`Address`/`BillingProfile`/`KycProfile`/`PortfolioSnapshot`) no cuentan (se borran/anonimizan en ambos modos).
- **HARD** (predicado falso): `DELETE` real del `User`; los dependientes con `onDelete: Cascade`
  (`KycProfile`/`BillingProfile`/`Address`/`PortfolioSnapshot`) caen por cascada. Se purga la **imagen de INE**
  del object storage (reusa la rutina de purga §3.4d) antes/junto al borrado.
- **SOFT** (predicado verdadero): conserva las filas económicas por integridad contable/legal y auditoría; marca
  `status=deleted`, `deletedAt`, `anonymizedAt`, revoca tokens (`tokenVersion++`), `passwordHash=null`. **Anonimiza
  PII**: `email`→placeholder único (`deleted+<uuid>@anon.invalid`), `name`→`"Usuario eliminado"`,
  `phone`/`avatarUrl`/`googleId`→null; en `KycProfile`/`BillingProfile` borra `clabeEnc`/`clabeHmac`/`rfcEnc`/
  `legalName` y purga INE; conserva solo metadatos no-PII. Los snapshots económicos históricos
  (`billingSnapshot`, `clabeSnapshotEnc`) no se reescriben salvo mandato legal (bandera para seguridad/legal).
- **Idempotente** (re-`DELETE` sobre soft-deleted = no-op `mode:"soft"`); `409 CANNOT_DELETE_SELF` si el actor es
  el propio usuario. Auditado (`action=user.delete`, con `mode`).

**Enum:** `UserStatus` gana el valor **`deleted`** (M-15). `PATCH /admin/users/:id/status` sigue aceptando solo
`active|blocked`; a `deleted` se llega **únicamente** por el `DELETE` (soft). El guard de auth y ambos endpoints de
login tratan `deleted` como no-autenticable (`403 USER_BLOCKED`).

**c) Alta de usuario por rol (v1.7-admin-users).** `POST /admin/users` — **solo `super_admin`**, **auditado**
(`action=user.create`), **NO money-out**. Cubre el hueco de que hoy no hay alta en back-office (customer se
auto-registra; staff por seed). Implementación (`AdminService.createUser`, patrón de `AdminUsersController`):
- **Validación DTO:** `email` (IsEmail, se **lowercasea** antes de crear/validar unicidad, como `auth.service.ts`
  register), `name` (**required**, `User.name` NOT NULL), `role` (`@IsIn(customer|vault_operator|super_admin)`),
  `password?` (`MinLength 8` si viene), `phone?`, `locale?` (`es|en`, default `es`). **Sin** KYC/CLABE/INE (datos
  self-service; no se crea `KycProfile`/`BillingProfile`).
- **Contraseña:** si el DTO trae `password`, se **hashea con argon2** (misma rutina que register) y
  `mustChangePassword=false`. Si **no** trae `password`, se **autogenera** una temporal de **alta entropía** reusando
  la rutina del reset M-15 (`randomBytes(18).toString('base64url')`), se hashea con argon2, `mustChangePassword=true`,
  y el claro se devuelve **una única vez** en `tempPassword` (**nunca** persistido en claro, **nunca** en `AuditLog`).
- **`emailVerified`:** nace **`true`** para **cualquier** rol creado por admin (staff como el seed; el customer creado
  por admin porque el admin da fe de la identidad). **No** se emite `AuthToken` de verificación ni se envía correo
  (paridad con el reset admin, que tampoco manda correo). `authProvider='local'`.
- **Colisión de email:** `P2002` (unique de `email`) → **`409 EMAIL_TAKEN`** (mismo mapeo que register).
- **Respuesta:** shape público (`publicUser` extendido con `status`/`authProvider`/`createdAt`) + `tempPassword?` +
  `mustChangePassword`. Sin `passwordHash`.
- **Escalada de privilegios:** crear un `super_admin` eleva privilegios; el **control autoritativo** es
  super_admin-only (el guard rechaza `vault_operator` con `403 FORBIDDEN`) **+ auditoría** (`user.create` con actor,
  `entityId`=nuevo usuario, y `role` creado en `after`; **sin** volcar la contraseña, coherente con §3.2 "PII/secretos
  nunca en before/after"). Se permite en el MVP porque ese doble control es suficiente (no se restringe el enum).

### 4.7ter Historial 360° por usuario (M6, v1.7-admin-users) — reuso de listados + auditoría

Enfoque **REUSO**: no se engorda `AdminService.getUser` (que sigue devolviendo las últimas 20 de
orders/sellRequests/disputes + bóveda como resumen). El historial **completo** se sirve por listados ya paginados
y una nueva traza de auditoría.

**c) Bóveda del usuario — `ownedItems` enriquecido (v1.8-ronda-c / BE-10).** La proyección `AdminUserOwnedItemRef`
que devuelve `getUser().ownedItems` gana **`finish: Finish`** y **`referenceValue: PriceInfo`** (mismo shape que el
`HoldingDTO` del cliente, §3). El backend puebla `referenceValue` **reusando** `PricingService.getReference(item.cardId,
item.productType, buildGradeKey(item), item.finish)` — la **misma valuación por-acabado** que ya alimenta la bóveda del
cliente; no se recalcula nada nuevo. Los items sin precio del día se devuelven con `referenceValue.status="pending"`
(no se excluyen: esta es una vista 360° de back-office, no un total de portafolio). **Decisión (enriquecer el ref, NO
endpoint nuevo):** se enriquece `ownedItems` en lugar de añadir `GET /admin/users/:id/holdings` paginado porque (1) la
bóveda por usuario es **acotada** (las cartas en custodia de UN usuario), (2) `getUser` **ya** incluye `ownedItems`, así
que solo se añaden dos campos por item reusando `getReference`, y (3) evita un endpoint y un consumidor de frontend
nuevos. **Coste:** N llamadas a `getReference` (una por item de la bóveda del usuario); para bóvedas grandes conviene
un `Promise.all` / lectura batch de `PriceReference` del día. **Evolución futura (no ahora):** si una bóveda por usuario
creciera lo suficiente para volver pesado el `getUser`, se migraría a `GET /admin/users/:id/holdings` paginado que
reuse `VaultService.holdings()`; queda documentado como puerta abierta, sin implementarse en Ronda C.

**a) `?userId=` en los listados admin.** `GET /admin/buylist`, `GET /admin/shipments` y `GET /admin/disputes`
ganan una query **opcional** `userId` (simetría con `GET /admin/orders`, que ya lo tiene desde M3). Cada uno filtra
por su FK directa (`SellRequest.userId` / `ShipmentRequest.userId` / `Dispute.userId`) añadiendo `where.userId` en
`adminList`. **No cambia** el guard (`vault_operator+`) ni la proyección PII por rol (p. ej. la CLABE del buylist
sigue enmascarada en el list; en claro solo por `reveal-clabe`). Paginado estándar `{ data, page, pageSize, total }`.

**b) `GET /admin/users/:id/audit` (nuevo).** Traza de `AuditLog` de/ sobre el usuario, paginada. Reusa el patrón de
consulta del M10 audit-log (`settings.controller`), acotado:
- **`scope`** (default `target`): `target` → `where { entityType:'User', entityId:id }` (acciones **sobre** el
  usuario); `actor` → `where { actorUserId:id }` (acciones **del** usuario); `both` → `where { OR: [...] }`.
- **Proyección expuesta:** `id, actorUserId, actorRole, action, entityType, entityId, createdAt` y **`ip` solo para
  `super_admin`** (el `select` añade `ip` condicionalmente por rol). **`before`/`after` NUNCA** se seleccionan (evita
  filtrar PII/estado, incluso de las acciones que sí los pueblan).
- **Roles:** clase `AdminUsersController` es `vault_operator+`, así que ambos acceden; **`vault_operator` recibe la
  proyección reducida sin `ip`** (dato investigativo reservado al súper-admin). `404 NOT_FOUND` si el usuario no
  existe. Sin migración (solo lectura de `AuditLog`).

### 4.8 Sync de catálogo desde pokemontcg.io (M2) — `super_admin`, auditado
Ingesta de **datos de catálogo** (Card/CardSet, en inglés, no se traduce). Alimenta las facetas de Compra (§4.9). Endpoints en `API_CONTRACT.md §M2`. Servicio `CatalogSyncService` en `modules/catalog`.
- **`GET /admin/catalog/remote-sets`**: consulta `/v2/sets` de pokemontcg.io; devuelve `[{ id, name, series, releaseDate, printedTotal, imported, cardCount }]` ordenado por `releaseDate` desc. `imported` = si ya existe el `CardSet` local (join por `externalId`); `cardCount` = cartas locales del set.
- **`POST /admin/catalog/sync`** body `{ setId?, fromReleaseDate? }`: importa/actualiza cartas.
  - `setId` presente → importa ese set puntual (query `q=set.id:<setId>`).
  - sin `setId` → importa todos los sets con `releaseDate >= fromReleaseDate`; **default `fromReleaseDate` = dial `catalog_sync_from_date` = `2024/01/01`** (formato pokemontcg.io `yyyy/MM/dd`).
- **`POST /admin/catalog/backfill`** body `{ batchSize?=10, untilYear? }`: importa el **siguiente lote de sets más antiguos aún no importados** (colecciones anteriores a la frontera actual), en orden `releaseDate` **asc** desde los más antiguos disponibles hacia la frontera, tomando `batchSize` sets. Se detiene si alcanza `untilYear`. Respuesta `{ imported: [{ id, name, releaseDate, cardCount }], newBoundary, remaining }` (`newBoundary` = releaseDate del set más antiguo ya importado tras el lote; `remaining` = sets aún sin importar). **Repetible** hasta `remaining=0`.
- **Guardarraíles de seguridad (anti-inyección / anti-SSRF):**
  - Validar `setId` contra `^[a-z0-9]+(-[a-z0-9]+)*$` **antes** de interpolarlo en `q=set.id:<setId>` (previene inyección en el query param de la API remota). Rechazo `422 VALIDATION_ERROR` si no cumple.
  - **Host fijo** (base URL de pokemontcg.io hardcodeada/env, sin parte controlable por el usuario) → sin SSRF; el cliente HTTP no acepta URLs arbitrarias.
  - `fromReleaseDate` validado como fecha `yyyy/MM/dd`.
  - Autenticación con `POKEMONTCG_IO_API_KEY`; rate-limit vía la misma cola BullMQ.
- **Rarezas:** `Card.rarity` permanece **`String` libre** (captura cualquier rareza tal cual la entrega pokemontcg.io — taxonomía **abierta**, NO enum cerrado). Esto garantiza capturar rarezas modernas presentes y futuras sin migración.
- **Acabados (v1.6-finish):** el `client` de pokemontcg.io **deja de descartar** `tcgplayer.prices` — su tipo gana `prices?: Record<string, { market?: number }>`. En `upsertCards`, se derivan las **llaves presentes** de `card.tcgplayer.prices`, se **mapean a `Finish`** (tabla §3.7, descartando las no mapeadas) y el conjunto único se persiste en **`Card.availableFinishes`**. Ausente/vacío → `[normal]`. El **sync de precios** (M2) crea `PriceReference` **por cada acabado** disponible (`prices[llave].market`), no solo el primero (§4.1). **Este cambio requiere RE-SYNC** para poblar acabados/precios de las cartas ya importadas (§11 M-18).
- **Año del set:** se persiste `CardSet.releaseDate`; el **año** para los filtros de Compra se **deriva** de `releaseDate` (no se guarda columna redundante; ver `year` en §4.9).
- Todas las operaciones de sync son de `super_admin` y quedan en `AuditLog`.

### 4.9 Sección "Compra" (storefront) = inventario publicado con precio + facetas dinámicas
**Decisión de ruta:** se **mantiene la ruta `GET /api/v1/catalog/cards`** (no se renombra a `/shop` ni `/compra`) para no romper el contrato ya acordado; **cambia el semántico** y se documenta que "catalog" en el path es un tecnicismo interno — la superficie de producto se llama **"Compra"** (rótulo de UI, i18n del front). Renombrar la ruta añadiría churn de contrato sin beneficio funcional; el rótulo visible ya lo controla el front. *(Si en el futuro se decide alinear la ruta, sería un cambio de contrato vía arquitecto.)*
- **Regla dura:** `GET /catalog/cards` devuelve **SOLO inventario publicado CON precio de venta fijado** (`status=listed`, `sellable=true`, `salePriceCents != null`). **Excluye** items `pending`/sin precio/"precio pendiente". El comprador **nunca** ve "precio pendiente". (Esto **ajusta** la nota v1 que permitía mostrar pendientes no comprables: en v1.1 **no se listan**.)
- **Facetas dinámicas** (`GET /catalog/facets`, ver contrato) calculadas **sobre el inventario publicado** (no sobre el catálogo entero):
  - **`rarities`**: `distinct` de `Card.rarity` sobre el inventario publicado, **espejando los valores de pokemontcg.io tal cual** (taxonomía abierta, lista NO cerrada; el front no asume un conjunto fijo).
  - **`sets`**: `{ id, name, releaseDate, year }` (con `year` derivado de `CardSet.releaseDate`), solo los sets con inventario publicado, ordenados por **año desc**.
  - **`productTypes`**: subconjunto de `raw | graded | sealed` presente en el inventario publicado.
  - **`finishes` (v1.6-finish)**: `distinct` de `InventoryItem.finish` sobre el inventario publicado (subconjunto de `Finish`), para el filtro de acabado.
  - **rangos de precio** (min/max de `salePriceCents`) para el slider de precio.
- **Filtros** del listado: `setId`, `rarity`, `productType` (raw NM | graded | sealed), **`finish` (v1.6-finish)**, rango de precio, y `condition` (para raw solo hay `NM`).
- **Valuación por acabado (v1.6-finish):** `referenceValue`/`salePriceCents` de cada `ListingDTO` se calculan contra la `PriceReference` del **`InventoryItem.finish`** (no un precio único por carta). Dos copias de la misma carta con acabado distinto se listan como **entradas separadas** con su propio precio.

### 4.9a Publicación ÚNICA por carta/variante/condición con STOCK (singles agrupados) — v1.38 (P-30)

**Problema.** Hasta v1.37 `GET /catalog/cards` y `GET /catalog/cards/:cardId` devolvían **un `ListingDTO` por cada
`InventoryItem`** (una fila por copia física). Tres Tropius raw NM en bóveda ⇒ tres publicaciones separadas en Compra
(«01/02/03 Tropius · Pitch Black #1 · MX$15»). El requisito del humano: **UNA sola publicación** por carta/variante/
condición, con **cantidad/stock**, viva mientras haya inventario y **agotada** cuando el stock llega a 0.

**Decisión — el sellado ya resolvió esto; se generaliza a singles.** El sellado (v1.23-sealed-sales, §4.23e/§4.23i)
ya expone un **catálogo AGREGADO** (`GET /catalog/sealed` → `SealedGroupDTO` con `availableCount`, agrupando piezas
idénticas). P-30 aplica el **mismo patrón** a los **singles** (raw/graded) en `GET /catalog/cards*`. Quedan **dos
catálogos agrupados paralelos** (singles y sellado), cada uno con su DTO; el guardarraíl **H9** (singles excluyen
`productType='sealed'`, `singlesPublishedWhere`) sigue separándolos.

**Clave de agrupación (exacta).** `K = (cardId, productType, gradeKey, finish)` donde `gradeKey = gradeKeyFor(item)`
(canónico: `raw:NM` | `graded:PSA:10` | …, que encapsula condición/grado). Es **exactamente** la clave con la que
`fetchSellable`/`toListingDTO` YA resuelven `salePriceCents` por pieza, y la de `PriceReference`/`VariantPriceOverride`
(menos `capturedDate`/`cardProductId`). Consecuencia clave: **todas las piezas de un grupo comparten un único precio de
venta y una única `referenceValue`** por construcción ⇒ «precio único de la variante» sin lógica extra. *(No se agrupa
por `cardProductId`: la identidad M-31 por producto vive en `PriceReference`/buylist, no en `InventoryItem` de singles;
el catálogo de singles resuelve precio por `(cardId, productType, gradeKey, finish)`, así que esa es la granularidad
correcta y suficiente del grupo.)*

**Derivación del stock (money-safe).** `stockCount` = nº de piezas del grupo que son **vendibles**: `ownerType=platform`
AND `status='listed'` AND `sellable=true` AND `salePriceCents != null` (Regla de Compra §4.9). Una pieza **sin precio no
cuenta ni publica** (nunca $0). El estado se **deriva del stock**, no se persiste:
- `stockCount ≥ 1` ⇒ publicación **VIVA** (aparece en Compra).
- `stockCount = 0` ⇒ **AGOTADA** ⇒ el grupo **no se emite** (desaparece de Compra). El invariante `stockCount≥1` en toda
  fila devuelta ES la representación de «vivo»; no hay columna ni campo `status` de publicación (el stock es la única
  fuente de verdad). *(Si en el futuro se quisiera pintar agotados como «temporalmente sin stock» en la ficha, sería un
  parámetro nuevo `?includeSoldOut=` — fuera de alcance de P-30, money-safe por defecto: no se muestra lo que no hay.)*

**Precio del grupo.** `salePriceCents` = **mínimo** de los `salePriceCents` de las piezas del grupo (= el del
`representativeInventoryItemId`, la pieza vendible más barata). En el caso normal **todas** las piezas de `K` comparten
precio (misma regla de venta por rareza/tier + mismo override de variante) y el mínimo = ese precio único. La **única**
divergencia posible es un `InventoryItem.listPriceCents` **manual por pieza** distinto (§4.26b): entonces el grupo
muestra el más barato primero (idéntico a `SealedGroupDTO.fromPriceCents`) y las piezas concretas siguen disponibles en
`units[]` de la ficha. `referenceValue` (valor de mercado) es único por `K` (misma `PriceReference`).

**Interacción con «publicar» (M1) — NO se crean N publicaciones.** No existe entidad «publicación»: el grupo es una
**vista derivada en lectura**. Publicar/despublicar sigue siendo **por pieza** (flip de `InventoryItem.status` a/desde
`listed`; alta/bulk-publish `InventoryBatch` kind `publish`/`publish_all`, sin cambio). El efecto en el catálogo:
- Publicar N piezas de la misma `K` ⇒ `stockCount` del grupo **sube +N** (una sola fila, no N filas).
- Despublicar / vender / retirar / mover una pieza fuera de `listed` ⇒ `stockCount` **baja −1** solo.
- Cuando la última pieza `listed` de `K` sale ⇒ `stockCount=0` ⇒ el grupo desaparece (agotado).
Todo esto es automático porque el stock se **recomputa en cada lectura**; **cero doble-escritura, cero drift, cero
contador que reconciliar** (mismo principio money-safe que el resto del catálogo).

**Schema — sin migración.** Se **prefiere agregación en query** sobre denormalizar. El grupo se computa con un **reduce
en memoria** sobre el conjunto `sellable` que `fetchSellable` ya carga (idéntico coste al listado por-pieza actual, que
también carga todo y pagina en memoria; el sellado agrupa igual). `gradeKey` es derivado en app (`gradeKeyFor`), no
columna, por lo que el GROUP BY final ocurre en app, no en SQL puro. **No se añade columna `stockCount` ni tabla nueva.**
El índice existente `@@index([cardId, finish, status])` (M-21) ya cubre la ficha (`GET /catalog/cards/:cardId`); para el
listado global la reducción en memoria es aceptable en el MVP. *(Nota para backend, NO bloqueante: si el volumen de
piezas `listed` crece, evaluar un índice de cobertura `(ownerType, status, cardId, productType, finish)` para acotar el
fetch del listado; hoy no hace falta y NO hay migración asociada a P-30.)*

**Contrato.** DTOs `GroupedListingDTO` / `GroupedListingListResponse` / `GroupedListingDetailResponse` (API_CONTRACT
§DTOs). `GET /catalog/cards` → `{ data: GroupedListingDTO[], … }` (`total` = nº de grupos). `GET /catalog/cards/:cardId`
→ `{ card, listings: GroupedListingDTO[], units: ListingDTO[] }`. `GET /catalog/listings/:inventoryItemId` y
`GET /catalog/facets` **no cambian**. **Cambio de shape breaking** de `/catalog/cards*` — se hace ahora porque coincide
con el **rediseño visual del storefront** (ver «Coordinación» abajo).

**Coordinación con el rediseño visual del storefront (otra sesión).** Esta capa de datos NO toca render. El rediseño
debe construir el catálogo de Compra contra el **shape agrupado final**, NO contra las N-copias actuales:
- **Grilla/tarjetas y ficha de Compra ⇒ se construyen contra `GroupedListingDTO`** (una tarjeta por publicación única,
  con badge «`stockCount` disponibles» y `salePriceCents` único). Fuentes: `GET /catalog/cards` (`data:
  GroupedListingDTO[]`) y `GET /catalog/cards/:cardId` (`listings: GroupedListingDTO[]`).
- **Add-to-cart sigue por `inventoryItemId`** (carrito por-pieza, §4-G, sin cambio): cantidad 1 ⇒
  `representativeInventoryItemId`; cantidad > 1 ⇒ tomar N `inventoryItemId` distintos de `units[]` (ficha), cheapest-first,
  hasta `stockCount`. El **re-quote del carrito** sigue usando `GET /catalog/listings/:inventoryItemId` (por-pieza).
- **`units[]` NO es la grilla de navegación**: es SOLO el detalle por-pieza para resolver el carrito y (en graded) mostrar
  el `certNumber` de cada slab. El rediseño NO debe pintar una tarjeta por `unit`.
- **Facetas/filtros/sort** no cambian de forma (§4.9); aplican sobre el grupo.

### 4.10 Cotizador buylist sobre TODO el catálogo (Opción 1) — v1.3

Decisión del humano (**Opción 1**): el cotizador público debe poder cotizar **cualquier** carta de la tabla
`Card` (todo el catálogo importado), no solo lo comprable en "Compra" (bóveda). Esto se resuelve en **dos
piezas**, ambas **backend nuevo** (ver `API_CONTRACT.md §6` y §M2):

1. **Búsqueda pública sobre toda la tabla `Card`** — `GET /buylist/cards` (+ `GET /buylist/sets` para el
   dropdown de set). Se ubican bajo `/buylist/*` **a propósito**, separadas de `/catalog/*` (que está acotado
   a inventario publicado con precio, §4.9). El servicio consulta `Card`/`CardSet` directamente (filtros
   `setId`, `q` sobre nombre/número, `rarity` libre), paginado, **sin** tocar `InventoryItem` ni precio. El
   resultado (`CardDTO`) da el `cardId` que consume `POST /buylist/quote`. Servicio sugerido: método nuevo en
   `CatalogService` (p. ej. `searchCatalog(...)`/`listCatalogSets()`) o un `BuylistCatalogService` en
   `modules/buylist`; el arquitecto no fija la ubicación exacta, sí la interfaz del contrato.
2. **Sync de TODO el catálogo** — `POST /admin/catalog/sync-all` (super_admin, auditado, **truly-async**).
   Para que el cotizador tenga cartas que buscar hay que poblar todo el catálogo (no solo 2024+). El
   `CatalogSyncService` actual **ya** puede importar todo (`sync` con `fromReleaseDate` antiguo, o `backfill`
   repetido hasta `remaining=0`); `sync-all` es un wrapper explícito que **encola** todos los sets remotos en
   la cola BullMQ y retorna de inmediato, evitando el timeout del `sync` from-date síncrono (ver DEV-1, §9).

**Pricing del cotizador para cartas fuera de bóveda:** el `PricingService` solo pricea cartas **en bóveda**
(§4.1). Una carta `ex_plus` recién buscada en el catálogo (que no tenemos) **no** tendrá `PriceReference`, por
lo que su cotización sale `precio_pendiente` y escala a la cola del dueño al crear la solicitud (PROJECT
criterio 13, `AcquisitionPricer` §4.2). Las tarifas planas (`comun`=50, `reverse_holo`=150) **no** dependen
de referencia y se cotizan siempre. Esto es **coherente** con las reglas ya cerradas; si el humano quiere que
el cotizador **pricee on-demand** una `ex_plus` del catálogo completo (fetch puntual al `PricingProvider` en
el momento de cotizar, respetando rate-limit), es una **decisión de alcance** — ver **Pregunta abierta v1.3-1**
(§10). No se asume: el MVP mantiene el comportamiento `precio_pendiente`.

### 4.11 Verificación de correo + recuperación de contraseña self-service (v1.5-auth-email)

Decisiones de producto **cerradas por el humano**: la verificación **bloquea acciones sensibles, no el login**;
recuperación con **ambos** flujos (self-service por email **+** reset por admin existente). Proveedor de envío:
**Resend** (`no-reply@tcgvaultmx.com`).

#### a) Abstracción de correo — módulo `mail`
Desacopla el dominio de Resend (mockeable en tests, intercambiable de proveedor):
```ts
// Puerto (token DI: MAIL_PORT). Bajo nivel: enviar un correo ya renderizado.
interface MailPort {
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<{ id?: string }>;
}
// Adaptadores:
//  - ResendMailAdapter   -> POST https://api.resend.com/emails con RESEND_API_KEY, from = MAIL_FROM.
//  - NoopMailAdapter     -> NO envía; loguea `to/subject` y (en no-prod) el LINK con el token en claro,
//                           para dev/CI/tests sin key. Se selecciona cuando falta RESEND_API_KEY en LOCAL_ENVS.
// Servicio de dominio (plantillas + i18n por User.locale):
class MailService {
  sendEmailVerification(user: User, link: string): Promise<void>;  // asunto+cuerpo con link
  sendPasswordReset(user: User, link: string): Promise<void>;
}
```
- **Selección del adaptador (provider factory en `MailModule`):** si hay `RESEND_API_KEY` → `ResendMailAdapter`;
  si no y el entorno es LOCAL_ENVS → `NoopMailAdapter` (degradación con aviso en log). En **no-local** la key es
  **requerida** (§8), así que ahí siempre es el adaptador real (nunca se cae silenciosamente a Noop en prod).
- **Plantillas** (bilingües ES/EN por `User.locale`, mismas convenciones i18n del §6 — el texto vive en el
  backend porque el correo se envía server-side, a diferencia de la UI):
  - **Verificación:** asunto "Verifica tu correo / Verify your email"; cuerpo con botón/enlace a
    `${APP_BASE_URL}/<locale>/verify-email?token=<claro>`; caduca en 24h.
  - **Recuperación:** asunto "Restablece tu contraseña / Reset your password"; cuerpo con enlace a
    `${APP_BASE_URL}/<locale>/reset-password?token=<claro>`; caduca en 1h; nota "si no lo solicitaste, ignóralo".
- **El link apunta al FRONTEND.** El backend construye la URL con `APP_BASE_URL` (ya existe en env, es la base del
  front usada por CORS) + prefijo de `locale`. El **nombre del query param es contrato: `token`**; la **ruta**
  exacta la posee el frontend (grupo `(auth)/`), pero se fija aquí el patrón `/<locale>/verify-email` y
  `/<locale>/reset-password` para alinear productor/consumidor. El front lee `token` y llama al endpoint POST.

#### b) Emisión y consumo de tokens (ver modelo `AuthToken`, §3.2)
- **Registro email/password** (`POST /auth/register`): tras crear el `User` (`emailVerified=false`), emite un
  `AuthToken(type=email_verification, 24h)` y envía el correo. La respuesta **no cambia de forma** salvo que el
  objeto `user` ahora incluye `emailVerified` (siempre `false` recién registrado). El fallo de envío de correo
  **no** debe abortar el registro (se registra el error; el usuario puede pedir reenvío).
- **Reenvío** (`POST /auth/verify-email/resend`): **autenticado** (`customer+`), usa el email de `req.user`
  (sin body) → **sin riesgo de enumeración** (hay que estar logueado, y el login está permitido sin verificar).
  Si ya está verificado → `200` no-op. Rota tokens previos. Rate-limit estricto (§d).
- **Verificar** (`POST /auth/verify-email`): **público** (el link se abre desde el correo, quizá sin sesión).
  Consume el token atómicamente → `User.emailVerified=true`, `usedAt=now()`. **No** toca `tokenVersion` (verificar
  no revoca sesiones). Idempotencia sugerida: si el `User` del token ya está verificado, responder `200` aunque el
  token ya esté usado (evita error por doble clic).
- **Olvidé contraseña** (`POST /auth/forgot-password`): **público**, `{ email }`. **SIEMPRE responde `200`**
  (anti-enumeración): si el email existe, emite `AuthToken(type=password_reset, 1h)` y envía el correo; si no
  existe, no hace nada pero responde igual. Rota tokens de reset previos. Para cuentas solo-Google (sin
  `passwordHash`) el reset **fija** una contraseña (habilita login local, igual que el reset admin, §4.7bis).
- **Restablecer** (`POST /auth/reset-password`): **público**, `{ token, password }`. Consume el token
  (`password_reset`, vigente, no usado); setea `passwordHash` (argon2, misma rutina que register), **incrementa
  `User.tokenVersion`** (revoca sesiones vivas — patrón existente), marca `usedAt`, limpia `mustChangePassword` si
  estaba. **Efecto:** clic exitoso en el link prueba control del inbox → también setea `emailVerified=true`
  *(decisión a confirmar, §10)*. No devuelve tokens: el usuario **re-inicia sesión** con la nueva contraseña.

#### c) Gating de acciones sensibles — `EmailVerifiedGuard` (AUTORIDAD server-side)
Nuevo guard + decorador `@RequireEmailVerified()` (en `common/`), análogo a `@MoneyOut()`/`@Roles()`. Corre
**después** de `JwtAuthGuard` (que puebla `req.user.emailVerified` desde BD). Si `emailVerified=false` → lanza
**`403 EMAIL_NOT_VERIFIED`** (el front muestra banner "verifica tu correo"). Google → `true`, no afectado.
- **Operaciones bloqueadas (mutaciones sensibles):**
  - **Comprar:** `POST /api/v1/checkout/session` (crear orden + PaymentIntent). *(El `POST /checkout/quote`
    read-only queda **abierto** para que la UI muestre precios con el banner.)*
  - **Retirar/enviar (money-out del usuario):** `POST /api/v1/shipments`. *(El `POST /shipments/quote` queda
    abierto.)*
  - **Vender (buylist):** `POST /api/v1/buylist/requests` (crear `SellRequest`). *(El `POST /buylist/quote`
    público queda abierto — es el cotizador anónimo.)*
- **No afecta** al money-out de back-office (`@MoneyOut()`, super_admin): esos son staff. Las cuentas de staff
  (`vault_operator`/`super_admin`) deben sembrarse `emailVerified=true` para no auto-bloquearse *(nota a devops)*.
- **Cómo lo sabe el front:** `GET /users/me` ya expone `emailVerified`; además el objeto `user` de
  `/auth/register|login|google` lo incluye ahora. El front decide banner/CTA a partir de ese flag; el bloqueo
  real lo hace **siempre** el guard (la UI es solo cosmética).

#### d) Anti-abuso / anti-enumeración
- **Rate-limit por endpoint** (`@Throttle`, patrón `AuthController` existente): `forgot-password` **3/hora/IP**
  (+ tope por email en servicio, p. ej. ≤ 3 tokens/hora/email); `verify-email/resend` **3/hora/usuario** (+ IP);
  `verify-email` y `reset-password` (consumo) **10/min/IP** (defensa aunque el token sea de alta entropía).
- **Respuestas genéricas:** `forgot-password` siempre `200`; el consumo de token no distingue
  inexistente/expirado/usado (un único `*_TOKEN_INVALID`).
- **Auditoría** (`AuditLog`, sin volcar el token): `auth.email_verification_sent`, `auth.email_verified`,
  `auth.password_reset_requested`, `auth.password_reset_completed`.

### 4.12 Gráfica PÚBLICA del valor de un set (hero de la home) — v1.9-set-chart

Superficie de producto: un visitante **anónimo** ve en el hero de la home una gráfica estilo acciones del
**valor de mercado agregado de un set destacado**, con datos REALES y captura diaria. Reusa el patrón de la
gráfica de portafolio (`PortfolioSnapshot` + `/vault/portfolio/history`), pero **por set** y **público**.
Servicio sugerido: `SetValueService` en `modules/catalog` (lee `SetValueSnapshot`; el fetch externo lo hace el
job vía el `PricingProvider` existente).

**(a) Regla de valor (server-side, SEC-A1 — la fuente de verdad del monto).**
`SetValueSnapshot.totalValueMxnCents` de un set en una fecha `d` se calcula así, **100% server-side desde
`PriceReference` real** (nunca de input del cliente):
```
para cada Card c con c.setId = set:
    ref = PriceReference vigente más reciente de (c.id, productType='raw', gradeKey='raw:NM', finish='normal')
          con capturedDate <= d           // "vigente" = el precio más fresco a esa fecha
    si ref existe            → suma ref.priceMxnCents  y  pricedCardCount += 1
    si ref no existe (o null)→ la carta se EXCLUYE del total (no se inventa precio)
totalValueMxnCents = SUM(ref.priceMxnCents de las cartas con precio)
pricedCardCount    = # cartas del set con ref
totalCardCount     = # cartas del set (Card con ese setId, priceadas o no)
```
- **Acabado/productType fijos y explícitos:** se toma **`finish='normal'`**, **`productType='raw'`**,
  **`gradeKey='raw:NM'`**, campo **`priceMxnCents`**. Se elige `normal` (no reverse/holo) porque es el acabado
  presente en (casi) toda carta y da la línea base más comparable del set; el resto de acabados de una misma
  carta **no** se suman (se contaría de más). El origen es TCGPlayer `market` vía pokemontcg.io convertido a MXN
  por el FX de Banxico del día (misma cadena que ya usa `PricingService`).
- **Cartas sin precio ese día:** se **excluyen** del total (no se fabrica un valor), pero se **cuentan** en la
  brecha `pricedCardCount` vs `totalCardCount`. Así el valor es honesto ("valor de las **cartas priceadas** del
  set", NO promesa de set completo) y el front puede mostrar la cobertura. Esto es coherente con la regla
  transversal de PROJECT (una carta sin precio nunca se descarta ni se inventa; aquí simplemente no aporta al
  agregado del día).
- **No genera `PendingPriceEntry`:** esta agregación es **de mercado/marketing**, no de bóveda ni de una carta
  que debamos vender; una carta del set sin precio no se escala al dueño por este flujo (se seguirá escalando por
  los flujos existentes de bóveda/buylist si aplica). Evita inundar la cola con todo el catálogo del set.

**(b) Selección del "set destacado".** Mecanismo determinista con override por env y fallback en cascada:
1. **`HOME_FEATURED_SET_ID`** (env; id **nativo de pokemontcg.io** de un set SV reciente, ej. formato `sv8`). Si
   está seteado y existe un `CardSet` local con ese `externalId` → **ese** es el set destacado. **El id concreto
   lo fija devops/backend en el entorno**; el arquitecto define solo el mecanismo. Default recomendado: un set
   Scarlet & Violet reciente y líquido.
2. **Fallback 1 — mayor valor:** si el env no está o no resuelve a un set local, se elige el set con mayor
   `totalValueMxnCents` en su **último `SetValueSnapshot`** (el set "más valioso" con datos ya capturados).
3. **Fallback 2 — más reciente:** si aún no hay ningún snapshot (arranque en frío, primer día), se elige el
   `CardSet` con `releaseDate` más reciente (desc), para tener siempre un set que mostrar.
4. Si no hay ningún `CardSet` en absoluto → el endpoint responde `set: null, points: []` (ver contrato); el hero
   degrada con elegancia, sin error.
La resolución del set destacado la centraliza `SetValueService.resolveFeaturedSet()` y la usan **tanto** el
endpoint público **como** el job `set-price-sync` (para preciar el mismo set que se grafica). El `set-price-sync`
debe preciar el set destacado resuelto por *este* mecanismo, de modo que env y gráfica no diverjan.

**(c) Jobs (BullMQ diarios; los implementa backend — aquí solo se describen).**
- **`set-price-sync`** — precia **TODAS** las cartas del set destacado desde pokemontcg.io (acabado `normal`,
  `raw`), escribiendo `PriceReference` del día por carta (reusa `PricingService.syncCardPrice` / el
  `PokemonTcgIoProvider`). **Brecha NUEVA a cubrir:** el `price-sync` actual solo recorre cartas **en bóveda**
  (`InventoryItem`); este job **no** filtra por inventario — recorre `Card WHERE setId = <featured>` sin tocar
  `InventoryItem`, acotado a ese `setId` (un set ~150–250 cartas, cabe en el rate-limit del free tier con la cola
  existente). Se documenta como **DEV-3** en §9. Respeta el mismo cache diario (no re-llama si ya hay
  `PriceReference` del día para esa carta/acabado).
- **`set-value-snapshot`** — tras `set-price-sync`, agrega según la regla (a) y hace **upsert** de
  `SetValueSnapshot` del día (`@@unique[setId, asOfDate]`). Idempotente. Solo escribe el set destacado en el MVP
  (el modelo soporta N sets; se puede extender sin cambio de schema).
- **Crons (alineados con los existentes `fx-refresh 0 6`, `price-sync 15 6`, `portfolio-snapshot 0 7`):**
  `set-price-sync` **después** de `fx-refresh` (necesita el FX del día) — sugerido **`30 6`**; `set-value-snapshot`
  **después** de `set-price-sync` — sugerido **`15 7`**. Los horarios finos los ajusta devops/backend; el orden
  (FX → precio del set → snapshot del set) es la restricción dura.

**(d) Seguridad/coherencia.**
- **Endpoint PÚBLICO sin PII:** solo expone valor agregado de mercado del set (nombre, serie, fecha de
  lanzamiento del set — datos de catálogo públicos de pokemontcg.io — y la serie de valores). **No** expone
  usuarios, bóveda, inventario, costos ni nada sensible. `@Public()` como el resto de `/catalog/*`.
- **Fetch externo a host FIJO:** el `set-price-sync` usa el mismo cliente de pokemontcg.io con **host fijo** y
  guardarraíl de `setId` (`^[a-z0-9]+(-[a-z0-9]+)*$`) ya existente (§4.8) → sin SSRF ni inyección en el query.
- **SEC-A1 intacto:** el valor es siempre derivado de `PriceReference`; el `range` del query solo filtra fechas,
  nunca influye en el monto.
- **Sin datos fabricados:** si un día no corrió el job, ese día **no** tiene punto (el front interpola
  visualmente si quiere, pero la API no inventa el punto). Si el set no tiene ninguna carta priceada aún,
  `points: []` y `change` en `flat`.
- **Rate-limit del endpoint público:** al ser anónimo y en el hero (alto tráfico), se cachea la respuesta
  (lectura de `SetValueSnapshot`, que cambia 1x/día) — se sugiere `Cache-Control` corto + rate-limit por IP
  (devops/backend afinan). No hay riesgo de dinero ni de PII, pero conviene proteger de scraping abusivo.

### 4.13 Fase 1 del epic de precios — preciar TODO el catálogo + refresco 2×/día + sets nuevos (v1.12-catalog-pricing)

Decisión del humano (fija): (1) **preciar SIEMPRE todo el catálogo** (aunque la carta no esté en bóveda/
inventario), (2) **auto-actualización 2×/día** (job programado), (3) **importar/mapear sets nuevos**. Toca dinero
→ triple veredicto. **Aditivo, sin migración de esquema** (reusa `PriceReference`, con `finish` ya en su clave
desde M-18). Los cuatro sub-ítems son independientes y paralelizables, salvo que 1.2 y 1.3 se apoyan en 1.1.

**(a) 1.1 — Poblar `PriceReference` durante el `catalog-sync` (reusando `tcgplayer.prices` ya descargado).**
- **Insight base:** `CatalogSyncService.upsertCards` (`backend/src/modules/catalog/catalog-sync.service.ts`) **YA**
  recibe `c.tcgplayer.prices` y deriva `availableFinishes` (`deriveAvailableFinishes`). **El precio de mercado por
  acabado (`prices[llave].market`) está en el MISMO payload** → poblar `PriceReference` **NO cuesta llamadas extra**.
- **Qué se escribe:** por cada `finish` derivado con `prices[FINISH_TO_TCG_KEY[finish]].market > 0`, un **upsert**
  de `PriceReference` con:
  - clave `(cardId, productType='raw', gradeKey='raw:NM', finish, capturedDate=hoy)` (la unicidad existente),
  - `priceUsdCents = round(market×100)`, `priceMxnCents = usdToMxnCents(priceUsdCents, fx.rate, fx.bufferPct)`,
    `source='pokemontcg_io'`, `isManualOverride=false`.
  El **FX se lee UNA vez por corrida** (`FxService.getCurrent()`) y se reusa para todas las cartas (no por-carta).
- **Idempotencia (una fila por día por acabado):** upsert sobre la clave única. Re-correr el mismo día **actualiza**
  `priceMxnCents` (último market), no duplica; la segunda corrida del día (18:00) refina el precio de hoy.
- **No pisar overrides del admin:** si la fila de hoy existe con `isManualOverride=true` → **skip** (el override
  manual manda; §4.1). Solo se upsertea cuando no hay override del día.
- **Cartas sin market → NO se crea referencia y NO se escala a `PendingPriceEntry`.** Se usa `escalate=false` (mismo
  criterio que `set-price-sync`, §4.12a): escalar decenas de miles de cartas del catálogo a la cola del dueño sería
  ruido inútil. Una carta sin market simplemente **no tiene referencia** hasta que (i) el admin la fija a mano, o
  (ii) entra a un contexto real (bóveda/buylist) donde los flujos existentes SÍ escalan (`escalate=true`). Así se
  respeta la regla transversal de PROJECT (nunca se descarta) **en los contextos donde importa**, sin inundar la cola
  con el catálogo entero.
- **productType/gradeKey = `raw`/`raw:NM`:** coincide EXACTAMENTE con lo que lee `publicQuote` (raw NM) y con
  `SET_VALUE_RULE` (§4.12). Se prician **todos los acabados** (normal, reverse_holo, holofoil, 1st-ed holo), no solo
  `normal` — esto habilita el cotizador por-acabado (§4.2.1) y la valuación de portafolio por-acabado (§4.1) sobre
  TODO el catálogo. (Graded/sealed **no** se prician aquí: pokemontcg.io no da esos datos; siguen manual/su propio
  provider.)
- **Cambio de doctrina documentado:** las notas históricas "solo se pricea la bóveda" (§4.1, §5) se **matizan**: el
  **catálogo completo** se precia **durante el `catalog-sync`** (reusando datos ya descargados); el `price-sync`
  diario de **bóveda** se conserva para refrescar los items en custodia entre syncs de catálogo.
- **Firma sugerida (backend decide ubicación exacta):** método nuevo en `PricingService`, p. ej.
  `persistMarketReference(cardId, finish, marketUsdCents, fx): Promise<void>` (upsert idempotente + guarda override),
  invocado desde `upsertCards` con el `fx` pre-cargado. `CatalogSyncService` gana la dependencia `PricingService`
  (hoy inyecta solo `prisma`/`client`/`settings`).
- **Efecto colateral positivo:** `computeSetValue`/`set-value-snapshot` (§4.12) ahora tienen `PriceReference`
  `normal` de **cualquier** set (no solo el destacado). `set-price-sync` queda **en gran medida subsumido** por 1.1;
  se conserva como está (inocuo, mantiene fresco el set del hero entre syncs). Ver DEV-3 (§9): 1.1 lo cubre.

**(b) 1.2 — Cotización on-demand de raras: `publicQuote` READ-ONLY (supersede BE-16).**
- **Problema (BE-16):** `publicQuote` (`buylist.service.ts` ~:81-83) llamaba `escalatePending` cuando el acabado
  cotizaba `precio_pendiente` — un endpoint **público/anónimo que ESCRIBE** en la cola de trabajo del dueño; un
  anónimo podía inflar la cola enumerando cartas.
- **Diseño seguro (elegido):** con 1.1 el catálogo ya está priceado, así que el `getReference` del quote casi
  siempre devuelve precio. Se **ELIMINA** la llamada a `escalatePending` de `publicQuote` → **vuelve a ser
  read-only** (como fue antes de la deuda de Fase 0.2). Si el acabado sigue `precio_pendiente` (carta sin market), el
  quote **lo reporta** sin escribir nada.
- **NO se pricea on-demand desde el quote.** Se descarta el fetch puntual al `PricingProvider` en el quote público
  porque: (i) es **anónimo** → superficie de abuso (enumerar cartas quema la cuota del free tier y puede spamear la
  cola), (ii) **redundante** con el job 2×/día + el catalog-sync (el catálogo ya está priceado), (iii) el cache
  diario ya existe. La frescura la da el **job** (1.3), no el request del visitante.
- **La escalada queda SOLO en el flujo autenticado:** `POST /buylist/requests` (`createRequest`) **sigue** llamando
  `escalatePending` (el vendedor se compromete a vender → es legítimo escalar al dueño). Sin cambio ahí.
- **Cierra BE-16** (y resuelve el punto abierto v1.3-1: default = **no** on-demand, ahora confirmado por el diseño
  de Fase 1). Es una edición mínima de backend (quitar ~3 líneas del quote).

**(c) 1.3 — Job programado 2×/día: refresco de precios + import de sets nuevos.**
- **Mecanismo de jobs actual:** BullMQ repeatable jobs cableados en `backend/src/jobs/scheduler.service.ts`
  (activados si hay `REDIS_URL`; si no, deshabilitados y disparables a mano). Crons en **UTC**. NO hay una cola
  BullMQ por-set para el catálogo (el `sync-all` corre secuencial en memoria del proceso — DEV-1).
- **Job nuevo `catalog-price-sync`** (en `backend/src/jobs/`), que en una corrida hace:
  1. **Refresco de precios de TODO el catálogo = re-sync completo.** pokemontcg.io **no** expone un endpoint bulk de
     solo-precios: el `market` viaja **embebido** en cada carta. Por tanto refrescar precios ⇒ **re-fetch de las
     cartas** (paginado por set). Se reusa `CatalogSyncService` con la semántica **`force:true`** (reprocesa TODOS
     los sets remotos → `upsertCards` repuebla cartas + `availableFinishes` + `PriceReference` por acabado con el FX
     del día, vía 1.1). **Importa sets nuevos de forma natural** (procesa todos los sets remotos, incluidos los que
     aún no existían localmente) → 1.3 cubre el import de sets nuevos **sin paso aparte**.
  - El job **espera a completar** (es un worker de fondo, sin timeout HTTP). Reusa `runSyncAll(allRemoteSets)`;
    **single-flight** por `syncAllStatus.running` (no se solapan dos barridos). El progreso ya es observable por
    `GET /admin/catalog/sync-status` (§M2).
- **Escala / rate-limit / pacing:**
  - Catálogo ≈ 160+ sets, ~15–25k cartas; paginado a 250/página ⇒ ~**algunos cientos** de requests a pokemontcg.io
    por corrida (1 `/sets` + Σ páginas por set). Con `POKEMONTCG_IO_API_KEY` la cuota es holgada (~20k req/día);
    **sin key** el free tier es mucho menor y **puede toparse** → **la API key es requisito operativo** (riesgo, ver
    §8/§10). 2×/día ⇒ ~cientos × 2, dentro del presupuesto con key.
  - El cliente (`PokemonTcgIoClient`) ya reintenta con **backoff exponencial** ante 429/5xx y respeta `Retry-After`.
    El barrido es **secuencial** (una página a la vez) → no revienta el rate-limit. Se puede añadir un **pacing**
    opcional (sleep corto entre requests) como dial devops.
  - **Idempotencia:** cartas por `upsert(externalId)`; `PriceReference` por `upsert(clave día/acabado)`. Re-correr
    (o el 2º pase del día) es seguro.
  - **In-process vs cola:** para el MVP el barrido corre **secuencial in-process** dentro del worker BullMQ
    (aceptable: background, idempotente, reanudable re-corriendo). Límite DEV-1: si el proceso reinicia a media
    corrida, la siguiente corrida (o `sync-all` manual) reanuda. **Objetivo futuro (más robusto):** encolar **un job
    BullMQ por set** (retry/persistencia de progreso por set). Backend decide; no bloquea Fase 1.
- **Horarios (dueño devops):** **06:00 y 18:00 CDMX**. CDMX = America/Mexico_City = **UTC−6** (sin DST) ⇒ crons UTC
  **`0 12 * * *`** y **`0 0 * * *`**. Configurables por env (p. ej. `CATALOG_PRICE_SYNC_CRON_AM/PM`). **Orden con
  FX:** la conversión USD→MXN necesita un FX fresco; `FxService.getCurrent()` **degrada al último `FxRate`
  disponible**, así que el orden es **suave**, pero se recomienda un `fx-refresh` poco antes de cada corrida (el
  `fx-refresh 0 6 UTC` existente cubre la corrida de las 06:00 CDMX/12:00 UTC; devops añade uno antes de la de las
  18:00 CDMX/00:00 UTC si quiere FX del mismo día).
- **Disparo manual:** el mismo refresco es invocable hoy con `POST /admin/catalog/sync-all` `{force:true}`
  (super_admin, auditado); no se requiere endpoint nuevo. (Opcional: un `POST /admin/jobs/catalog-price-sync` para
  simetría con otros jobs; backend/devops deciden.)

**(d) 1.4 — Botón "importar sets nuevos" en M2 (manual, además del job).**
- **NO requiere endpoint nuevo.** El flujo se arma con endpoints existentes:
  1. `POST /admin/catalog/sync-all` con **`force:false`** → importa **solo los sets NO importados** (sets nuevos que
     fueron saliendo), truly-async (202).
  2. `GET /admin/catalog/sync-status` → **polling** del progreso (`running/done/total/finishedAt`).
  3. `GET /admin/catalog/remote-sets` → **refresca** la lista remota + estado `imported/cardCount` al terminar.
- Es un cambio **solo de frontend** (M2). Como los sets nuevos entran por `upsertCards`, **también quedan priceados**
  (1.1) en la misma pasada. (Opcional, mismo M2: un botón "Refrescar precios del catálogo" que llame `sync-all`
  `{force:true}`, alias manual del job 1.3.)

---

### 4.14 Fase 2 del epic de precios — precio de VENTA por RAREZA, editable en admin (v1.13-sales-pricing)

> **Reemplaza** el **markup GLOBAL único** de venta (`SALES_MARKUP_PCT`, default 15) por una **tabla de regla por
> rareza** editable en **M2** sin redeploy, **simétrica** a la de buylist (§4.2 / §4.2.1). Decisión del humano (fija):
> el precio de venta se asigna **por rareza**, con reglas **`fixed` (piso en MX$)** o **`pct` (% ARRIBA de mercado)**.
> Ejemplo del humano: **Common $5, Uncommon $10, holo/reverse $10 fijos; rarezas más altas = % arriba de mercado.**
> **Aditivo, SIN migración de esquema** (el precio de venta ya se congela en `OrderItem.unitPriceCents` al checkout).
> Toca dinero → triple veredicto.

#### (a) 2.1 — Modelo de config (diales M2, `ConfigSetting`)

Dos `SettingKey` nuevos (`backend/src/modules/settings/settings.constants.ts`), **espejo** de
`BUYLIST_PRICE_RULES`/`BUYLIST_PRICE_FALLBACK_PCT`:

- `SALES_PRICE_RULES` (`sales_price_rules`): mapa **`{ [rarity|ruleKey: string]: SalesRule }`** con
  `SalesRule = { mode: 'fixed' | 'pct', value: number }` (misma **forma** que `BuylistRule`, semántica de `pct`
  **distinta**, ver (b)).
  - `mode='fixed'` → `value` = **piso de venta MX$ en centavos** (entero ≥ 0). **No depende del mercado** → siempre precia.
  - `mode='pct'` → `value` = **porcentaje de markup ARRIBA de mercado** (número en `[0, SALES_PCT_MAX]`).
- `SALES_PRICE_FALLBACK_PCT` (`sales_price_fallback_pct`): **markup %** (default **15**) que se aplica a cualquier
  rareza **sin regla explícita**. Es un `pct` implícito.

**Seed inicial (reproduce el ejemplo del humano; editable en M2):**
```jsonc
// SALES_PRICE_RULES  (value = centavos si fixed)
{
  "Common":       { "mode": "fixed", "value": 500  },   // MX$5
  "Uncommon":     { "mode": "fixed", "value": 1000 },   // MX$10
  "Holo":         { "mode": "fixed", "value": 1000 },   // MX$10  (clave sintética del finish holofoil, §4.2.1)
  "Reverse Holo": { "mode": "fixed", "value": 1000 }    // MX$10  (clave del finish reverse_holo)
}
// SALES_PRICE_FALLBACK_PCT = 15
```
Todo lo demás (Rare Holo, EX/GX/V/VMAX/VSTAR, Ultra/Illustration/Special Illustration/Double Rare, Full/Alt Art,
Secret/Rainbow/Hyper, Trainer Gallery, Character, Radiant…) **cae al fallback = market × (1 + 15/100)**.

**Justificación del default 15%:** iguala **exactamente** el `SALES_MARKUP_PCT` vigente (default 15), así que la
migración **preserva el precio de venta actual** para toda rareza que caiga al fallback (venta = market × 1.15,
idéntico a hoy). Solo cambia deliberadamente el **piso de bulk** (Common/Uncommon/Holo/Reverse pasan a piso fijo
$5/$10/$10/$10, que hoy no existe). El % exacto de venta para raras queda como **decisión abierta v1.13-1** (el 15%
es "preservar negocio"; el humano puede subirlo por rareza sin tocar código).

**Validadores nuevos** (`settings.constants.ts`, junto a `validateBuylistRules`):
```ts
const SALES_PCT_MAX = 1000;  // propuesta: 0..1000% de markup (hasta 11× market). Ver decisión abierta v1.13-2.
function isValidSalesRule(v): boolean {   // fixed → entero ≥ 0 (cents); pct → número en [0, SALES_PCT_MAX]
  if (v?.mode === 'fixed') return isInt(v.value) && v.value >= 0;
  if (v?.mode === 'pct')   return isNum(v.value) && v.value >= 0 && v.value <= SALES_PCT_MAX;
  return false;
}
function validateSalesRules(v): string | null;      // objeto-mapa, cada entrada isValidSalesRule
function validateSalesFallbackPct(v): string | null;// número en [0, SALES_PCT_MAX]
```
**Rango del validador (por qué difiere de buylist):** el `pct` de buylist topa en **`[0,100]`** porque comprar a
>100% de mercado no tiene sentido. En venta `pct` es *markup ARRIBA de mercado*, que **sí** puede superar 100% (una
chase se puede listar a 2×–3× market). Se propone tope **`SALES_PCT_MAX = 1000`** (evita typos catastróficos —p. ej.
`100000`— sin limitar el markup real). Es más restrictivo que el `SALES_MARKUP_PCT` legacy (que era `>= 0` sin tope);
si el humano quiere paridad exacta con lo legacy, dejar sin tope superior. Ver **decisión abierta v1.13-2**.

Registro en `SETTING_VALIDATORS` y `SETTING_DEFAULTS`. **NO** se exponen en `SETTING_DTO_MAP` (se editan por los
endpoints M2 dedicados, como las reglas de buylist, no por `PUT /admin/settings`).

#### (b) 2.2 — Función pura `computeSalePriceForRarity` (`backend/src/common/money.ts`)

Análoga a `quoteAcquisitionForFinish` (§4.2.1), **reusa `ruleKeyCandidates(rarity, finish)`** — por tanto hereda el
**gate premium de Fase 0** (una rareza chase en `holofoil`/`1st-ed holo` **nunca** cae al piso fijo `"Holo"` de bulk:
resuelve por su propia regla o el fallback pct = markup sobre market). Pseudocódigo:

```ts
export type SalesRuleMode = 'fixed' | 'pct';           // = BuylistRuleMode (misma forma)
export interface SalesRule { mode: SalesRuleMode; value: number; }  // value = cents si fixed, % markup si pct
export interface SalePriceResult {
  salePriceCents: number | null;
  status: 'priced' | 'pending';
  appliedRule: SalesRule;
  ruleSource: 'rule' | 'fallback';
}

export function computeSalePriceForRarity(
  rarity: string | null,
  finish: Finish,
  referenceMxnCents: number | null,        // PriceReference.priceMxnCents del ACABADO cotizado (getReference(...,finish))
  rules: Record<string, SalesRule>,        // SALES_PRICE_RULES
  fallbackPct: number,                     // SALES_PRICE_FALLBACK_PCT (default 15)
): SalePriceResult {
  const candidates = ruleKeyCandidates(rarity, finish);          // REUSA §4.2.1 (gate premium)
  const hitKey = candidates.find((k) => rules[k] != null);
  const rule: SalesRule = hitKey ? rules[hitKey] : { mode: 'pct', value: fallbackPct };
  const ruleSource = hitKey ? 'rule' : 'fallback';

  if (rule.mode === 'fixed') {
    // PISO fijo en centavos; NO depende de la referencia → siempre 'priced'.
    return { salePriceCents: rule.value, status: 'priced', appliedRule: rule, ruleSource };
  }
  // pct = MARKUP ARRIBA DE MERCADO: sale = round(market × (1 + value/100)).  ← DISTINTO de buylist.
  if (referenceMxnCents == null) {
    return { salePriceCents: null, status: 'pending', appliedRule: rule, ruleSource };
  }
  return { salePriceCents: Math.round(referenceMxnCents * (1 + rule.value / 100)),
           status: 'priced', appliedRule: rule, ruleSource };
}
```

**Contraste de semántica de `pct` (crítico, no confundir):**
| Contexto | `pct` significa | Fórmula |
|---|---|---|
| Buylist / compra (§4.2) | **% de** la referencia (lo que pagamos) | `round(ref × value/100)` |
| Venta (§4.14, esta sección) | **% ARRIBA de** mercado (markup de venta) | `round(ref × (1 + value/100))` |

Un mismo `value=40` da **40% del market** comprando y **140% del market** vendiendo. La forma del dato (`{mode,value}`)
es idéntica; **la matemática del `pct` es la única diferencia** entre `applyRule` (buylist) y este resolver.

#### (c) 2.3 — Endpoints M2 (backend) — clones del patrón buylist

En `pricing.controller.ts`, **clonar 1:1** los tres endpoints de buylist (§4.2, `pricing.controller.ts:128-207`):
- `GET /admin/pricing/sales-rules` → `{ rules: Record<string, SalesRule>, fallbackPct }` (lee crudo).
- `PUT /admin/pricing/sales-rules` → reemplaza tabla y/o fallback; valida con `validateSalesRules`/
  `validateSalesFallbackPct` → `422 VALIDATION_ERROR`; **auditado** (`action=pricing.sales_rules.update`, before/after);
  surte efecto sin redeploy.
- `GET /admin/pricing/sales-rarities` → `{ fallbackPct, rarities: [{ rarity, cardCount, rule, source }] }`
  (rarezas distintas del catálogo `groupBy Card.rarity` unidas a las reglas; las sin regla muestran el fallback).
  Ordenado por `cardCount` desc.

`super_admin` (mismo guard que `buylist-rules`; es pricing/dinero). Ver shapes en `API_CONTRACT.md §M2`.

#### (d) 2.4 — Aplicación: reemplazar el markup global

Nuevo método en `PricingService` (`pricing.service.ts`), reemplaza/complementa `computeSalePrice(ref)` (`:330-334`):
```ts
async computeSalePriceForItem(item: { rarity, finish } , referenceMxnCents): Promise<SalePriceResult> {
  const rules = await this.settings.getRaw(SALES_PRICE_RULES) ?? {};
  const fallbackPct = await this.settings.getNumber(SALES_PRICE_FALLBACK_PCT);
  return computeSalePriceForRarity(item.rarity, item.finish, referenceMxnCents, rules, fallbackPct);
}
```
Se cambian **exactamente 2 call-sites** (los únicos que llaman `computeSalePrice` en producción):
- `catalog.service.toListingDTO` (`:103-108`): si no hay `listPriceCents` manual, calcular `salePriceCents` con el
  resolver por rareza (rareza `item.card.rarity`, acabado `item.finish`). Con reglas `fixed` una carta bulk sin
  market ahora **sí** obtiene `salePriceCents` (piso) ⇒ puede ser `sellable` (mejora deliberada). Con `pct` sin market
  → `pending`, no vendible (igual que hoy).
- `orders.service.salePriceOf` (`:23-34`): idem; si `pct` y no hay referencia → `PRICE_PENDING` (se conserva); si
  `fixed`, devuelve el piso aunque no haya market.

**SEC-A1 (guardarraíl intacto):** la `rarity` sale de `Card.rarity` (BD) y el `finish` de `InventoryItem.finish` (BD),
**nunca** del DTO del cliente (el DTO de checkout solo envía IDs de item; ver `docs/SECURITY_NOTES.md` SEC-D2 y
`docs/PENTEST_NOTES.md`). El **override manual** `InventoryItem.listPriceCents` **sigue teniendo prioridad**
(precio directo sin regla). El precio se **congela** en `OrderItem.unitPriceCents` al checkout → **no hace falta
snapshot de regla nuevo ni migración** (a diferencia de buylist, cuyo payout diferido sí exige snapshot en
`SellRequestItem`).

**`SALES_MARKUP_PCT` (legacy):** **DEPRECADO** en la ruta de venta (ya no lo lee `computeSalePrice`). Se **conserva**
el dial (`settings.constants.ts`, `SETTING_DTO_MAP.salesMarkupPct`, M10 UI) como **palanca de rollback** durante un
release; su retiro definitivo (y el de la pura `computeSalePriceCents`) es follow-up. **Decisión abierta v1.13-3:**
retirar ya vs. conservar. Backend debe verificar que **no queden otros callers** de `computeSalePrice` (hoy solo
los 2 de arriba).

#### (e) 2.5 — Editor M2 (frontend) — clon de la sección de reglas de buylist

Nueva sección "**Reglas de precio de VENTA por rareza**" dentro de **`frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx`**
(el mismo archivo que ya aloja el editor de reglas de buylist), **no** en `BuylistView`. Fila por rareza
(`rarity → mode (fixed/pct) + value`) + campo de fallback, idéntico UX al editor de buylist. Requiere:
- `frontend/src/lib/api.ts`: `getSalesRarities()`, `getSalesRules()`, `updateSalesRules(input)` (clones de
  `getBuylistRarities`/`getBuylistRules`/`updateBuylistRules`, `api.ts:1382-1406`).
- `frontend/src/types/contract.ts`: `SalesRule`, `SalesRuleMode`, `SalesRuleApplied`, `SalesRulesDTO`,
  `SalesRaritiesResponse` (espejo de los `Buylist*`).
- `frontend/messages/{es,en}.json`: copys de la sección (etiquetas fixed/pct, ayuda "% ARRIBA de mercado").
- **Copy de UX (importante):** el editor debe dejar claro que en venta `pct` = **markup arriba de mercado** (no "% de
  la referencia" como en buylist), para no confundir al dueño. Redacción final → ux-ui/DESIGN_SYSTEM si aplica.

> **Coordinación con Fable (frontend):** Fable trabaja en `BuylistView`, `messages` y `api.ts` en paralelo. El editor
> de venta vive en **`M2View`** (archivo distinto de `BuylistView`) pero **también toca `api.ts` y `messages`**
> (adiciones, no ediciones de líneas existentes). El orquestador debe **secuenciar** el trabajo de esos dos archivos
> compartidos entre Fable y el frontend de Fase 2 para evitar conflictos de merge; no son colisiones de diseño, solo
> de archivo. `M2View`, `contract.ts` y los docs no chocan.

---

### 4.15 WS-A — Ingesta MASIVA de precios vía proveedor de PAGA (PokemonPriceTracker), pluggable (v1.14-price-ingest)

> **Reemplaza** el barrido por-carta frágil (re-sync completo de pokemontcg.io fire-and-forget en memoria, DEV-4) por un
> **job de ingest masivo por SET** que consume el **endpoint bulk** del proveedor de paga. Objetivo: catálogo con
> precios/variantes **completos y frescos**, sin "precio pendiente" masivo, con todos los acabados y la gráfica del hero
> con datos. **Toca dinero → triple veredicto.** **Aditivo, SIN migración de esquema.**

#### (a) Problema y doctrina

Hoy `PriceReference` se puebla durante el `catalog-sync` reusando `tcgplayer.prices` (v1.12, §4.13a); el refresco
2×/día (`catalog-price-sync`) lo hace vía **re-sync completo** (`syncAll({force:true})`). Ese barrido corre
**fire-and-forget en memoria del proceso** (`catalog-sync.service.ts` `syncAll` hace `void this.runSyncAll(batch)` y su
progreso vive en `syncAllStatus`, no persistido): **muere al reiniciar el proceso** (redeploys de Railway, crash, OOM),
**tarda horas** (~160 sets, ~15–25k cartas, cientos de requests secuenciales con backoff 429) y deja el catálogo con
**precios/variantes incompletos** → "precio pendiente" masivo, todo en acabado `normal` (los sets no alcanzados
conservan `availableFinishes=[normal]` y sin `PriceReference` de acabados no-`normal`) y la gráfica pública del hero vacía.

**Doctrina WS-A:** el **pricing del catálogo** lo hace un **proveedor de paga con descarga masiva** (bulk), enchufable
tras una interfaz, corrido por un job **por set, idempotente y reanudable** apoyado en BullMQ (cola persistida en Redis),
NO por un barrido per-carta detached de la memoria del proceso. La **metadata del catálogo** (nombres/imágenes/sets/
números/rareza + import de sets nuevos) sigue viniendo de pokemontcg.io (`catalog-sync`), que se **aligera** a solo eso.

> **Separación clave (independiente):** la **robustez del job** (fan-out BullMQ por set, awaited, reanudable) y la
> **elección de proveedor** (dial `PRICE_PROVIDER`) son ortogonales. Incluso con el proveedor `pokemontcg_io` (legacy)
> el nuevo job ya es robusto; el proveedor de paga aporta además **variantes completas** y **menos requests** (bulk por
> set). Esto permite un rollout money-safe: primero el job robusto, luego el flip del dial al proveedor de paga tras
> verificar el esquema en runtime.

#### (b) Interfaz `BulkPriceProvider` pluggable (backend, `modules/pricing`)

Interfaz **nueva** de ingest masivo, **distinta** del `PricingProvider` per-carta de §4.1 (que se **conserva** para el
refresco per-carta de bóveda `price-sync` y los stubs graded/sealed). Se nombra `BulkPriceProvider` (es la
«`PriceProvider`» pluggable del plan WS-A) para **no colisionar** con el `PricingProvider` ya existente.

```ts
// Fila NORMALIZADA por carta+acabado que devuelve el provider (el adapter ya la validó/omitió si venía mal formada).
interface BulkPriceRow {
  externalId?: string | null;     // id pokemontcg.io de la carta (mapeo PRIMARIO → Card.externalId, @unique)
  setExternalId?: string | null;  // mapeo FALLBACK: (set + number) → Card
  number?: string | null;
  finish: Finish;                 // YA mapeado a nuestro enum canónico (normal|reverse_holo|holofoil|first_edition_holofoil)
  marketCents: number;            // entero de centavos, > 0 (validado por el adapter)
  currency: 'USD' | 'MXN';        // moneda de ORIGEN del market (defensivo; se verifica en runtime, §h)
}
interface BulkPriceResult {
  rows: BulkPriceRow[];           // filas VÁLIDAS por (carta, acabado)
  fetchedRaw: number;             // entradas crudas recibidas del proveedor (observabilidad)
  skipped: number;                // entradas OMITIDAS por el mapeo defensivo (money-safe)
}
interface BulkPriceProvider {
  readonly source: PriceSource;   // 'pokemonpricetracker' | 'pokemontcg_io'
  /** Precios de un set completo en POCAS requests (bulk). El adapter valida y OMITE
   *  entradas mal formadas ANTES de devolver (nunca NaN/negativo/cero/acabado desconocido). */
  fetchPricesForSet(input: { set: CardSet }): Promise<BulkPriceResult>;
}
```

Implementaciones MVP:
- **`PokemonPriceTrackerBulkProvider`** (source `pokemonpricetracker`, **PRIMARIO**): llama `POST
  https://www.pokemonpricetracker.com/api/v1/cards/bulk-price` (host FIJO, anti-SSRF, patrón `PokemonTcgIoClient`) con
  `Authorization: Bearer ${POKEMONPRICETRACKER_API_KEY}` y body/params `{ set: <CardSet.externalId>, limit }`; pagina si
  el set excede `limit`. **El adapter** mapea el payload crudo → `BulkPriceRow[]` **defensivamente** (§d). Sin key o con
  key inválida → devuelve `{ rows: [], ... }` + log (no revienta; el ingest simplemente no escribe ese set — precios
  quedan **stale**, que es seguro, en vez de borrarse).
- **`PokemonTcgIoBulkProvider`** (source `pokemontcg_io`, **LEGACY/alterno**): envuelve el `PokemonTcgIoClient.getCardsBySet`
  existente (paginado) y extrae `prices[FINISH_TO_TCG_KEY[finish]].market` por acabado (misma lógica que hoy, pero
  detrás de la interfaz bulk). Permite `PRICE_PROVIDER=pokemontcg_io` como **rollback** sin la key de paga.

Selección: `PriceIngestService.providerFor()` lee el **dial `PRICE_PROVIDER`** (§h) y elige la implementación cuyo
`source` coincide. Nuevo plan de pago del proveedor = otra implementación + flip de dial, sin tocar el resto (§0).

#### (c) Job `price-ingest` (parent) + `price-ingest-set` (child por set) — robusto, idempotente, reanudable

Nuevo `PriceIngestService` (en `modules/pricing`) + jobs en `backend/src/jobs/`:

- **`price-ingest` (parent):** lista los `CardSet` **locales** (la metadata ya existe; NO se consulta `/sets` remoto para
  esto) y **encola un child `price-ingest-set` por set** en la cola BullMQ. Devuelve de inmediato (encola, no procesa).
- **`price-ingest-set` (child, `{ setId }`):** carga el `CardSet`, llama `provider.fetchPricesForSet({ set })`, **agrupa
  las filas por `cardId` resuelto** (§d) y por cada carta:
  1. **Precio (por acabado):** por cada `BulkPriceRow` de la carta, `priceMxnCents = row.currency==='MXN' ? row.marketCents
     : usdToMxnCents(row.marketCents, fx.rate, fx.bufferPct)`; **upsert idempotente** de `PriceReference`
     `(cardId, productType='raw', gradeKey='raw:NM', finish, capturedDate=hoy)` con `source='pokemonpricetracker'` (o
     `'pokemontcg_io'` en legacy), `priceUsdCents = currency==='USD' ? row.marketCents : null`. **Respeta
     `isManualOverride`** (si la fila de hoy es override del admin → **skip**, §4.1). Reusa/generaliza
     `PricingService.persistMarketReference` (hoy hardcodea `source='pokemontcg_io'` y asume USD; se extiende para aceptar
     `source` y moneda — ver A.5/§g).
  2. **Variantes:** refresca `Card.availableFinishes` desde el proveedor (§e).
- **Robustez (el corazón de WS-A):**
  - **Por set, no per-carta:** una descarga bulk por set (pocas requests) en vez de N fetches per-carta.
  - **Aislamiento de fallos:** cada set es su **propio** job BullMQ → un set que falla (429 persistente, payload roto)
    **no tumba** el resto; BullMQ reintenta ese job con backoff.
  - **Reanudable:** la cola vive en **Redis** (persistida), no en memoria del proceso. Un reinicio a media corrida deja
    los child jobs pendientes en la cola → se retoman solos (a diferencia del `syncAllStatus` en memoria de DEV-4).
  - **Idempotente:** upsert sobre la clave única `(cardId, productType, gradeKey, finish, capturedDate)` — re-correr el
    mismo día **actualiza** el precio (último market), no duplica; la 2ª corrida del día refina el precio de hoy.
  - **Single-flight del parent:** el disparo manual/cron no encola un 2º barrido si ya hay uno en curso (patrón
    `syncAllStatus.running`, o mejor: `jobId` determinista del día + `deduplication` de BullMQ). Backend decide el
    mecanismo exacto.
  - **FX una vez por corrida:** el `fx = FxService.getCurrent()` se carga una vez y se pasa a los child jobs (snapshot),
    no por-carta (paridad con `catalog-sync`, §4.13a).
- **Sin Redis (local/CI/manual):** si no hay `REDIS_URL`, el disparo manual (`POST /admin/jobs/price-ingest`) corre el
  ingest **secuencial y AWAITED** dentro del handler/worker (recorre sets uno a uno). **Nunca** fire-and-forget: aunque
  no haya fan-out por set, el trabajo se espera (a diferencia del `void runSyncAll` actual). Aceptable para dev/ops;
  en prod el scheduler con Redis da el fan-out robusto.
- **Pacing / rate-limit:** el bulk por set reduce ~100× el nº de requests frente al per-carta; aun así, secuencial entre
  sets + backoff del cliente HTTP. Cuota/coste del proveedor de paga = riesgo devops (§h, decisión abierta v1.14-2).

#### (d) Mapeo carta↔proveedor + mapeo DEFENSIVO (money-safe)

El **esquema exacto** del payload (campo de acabado/variante, de precio y de moneda) **se verifica en la 1ª corrida en
Railway** (desde dev el dominio está bloqueado por egress). Por eso **todo** el mapeo vive en el **adapter**, que:

- **Resuelve la carta local** (para no crear referencias huérfanas):
  1. **Primario:** `row.externalId` (id pokemontcg.io de la carta, ej. `sv8-123`) → `Card.externalId` (`@unique`, indexado).
  2. **Fallback:** `(row.setExternalId, row.number)` → `Card` (`where { set: { externalId }, number }`). *(Nota perf:
     no hay índice compuesto `(setId, number)`; el fallback es best-effort. Un índice sería una mejora **opcional** —
     migración aparte, no requerida por WS-A.)*
  3. Sin resolución → **omite** la fila + cuenta en `skipped` + log (no escribe nada).
- **Valida cada entrada (money-safe):** `market` numérico **> 0** (descarta `0`/negativo/`NaN`/ausente); acabado/variante
  mapeable a `Finish` por una tabla **conservadora** (mirror de `TCG_KEY_TO_FINISH` + los alias del proveedor que se
  confirmen en runtime); **variante desconocida → OMITE** (no se atribuye un precio holo a `normal` — eso sería un error
  de dinero). Moneda: si el payload la indica, se respeta; si es **ambigua/ausente**, se asume **USD** (el proveedor es
  de mercado US — TCGPlayer/eBay/PSA) y **se marca como supuesto a validar en la 1ª corrida** (decisión abierta v1.14-1;
  crítico: si en realidad fuera MXN, convertir USD→MXN inflaría ~18× → por eso el flip del dial al proveedor de paga
  **se gatea** con la verificación de esquema, §h).
- **Nunca** deriva el precio del cliente ni de un DTO — SEC-A1 intacto: la fuente es el proveedor server-side; `finish` se
  usa como **dimensión de la clave** de `PriceReference`, no como monto.

#### (e) Variantes (#8) — `Card.availableFinishes` derivado del PROVEEDOR — ⛔ **DEROGADO por §4.22a (v1.22)**

> ⛔ **DEROGADO (v1.22-variantes-orden).** Esta subsección elevó al **proveedor de PRECIOS** a autoridad de las
> **variantes de catálogo**, y ese es el error de diseño que produjo tres rondas del mismo bug del PO: `providerFinishes`
> solo contiene acabados con `market > 0`, así que una carta con reverse holo **sin precio de reverse holo** se reducía a
> `['normal']` y el binder pintaba una sola casilla. **Norma vigente: §4.22a** — el sync de catálogo es el **único**
> escritor de `Card.availableFinishes`; `price-ingest` **no lo escribe** (ni siquiera ampliando). El resto de §4.15
> (interfaz bulk, job, FX, dial) **sigue vigente sin cambios**: lo único derogado es la escritura de variantes.
> Se conserva el texto original abajo como registro de la decisión revertida.

Reemplaza la derivación frágil de `tcgplayer.prices` (que en el barrido roto dejaba casi todo en `[normal]`). En el
`price-ingest-set`, tras agrupar las filas por carta:
- `providerFinishes` = conjunto de `finish` **distintos** de la carta con `marketCents > 0`.
- Si `providerFinishes` **no vacío** → `Card.availableFinishes = providerFinishes` (**autoridad**: el proveedor trae las
  variantes reales del mercado; #8). **Reemplaza** el set previo.
- Si `providerFinishes` **vacío** (carta no está en el proveedor, o sin filas válidas) → **se respeta** el valor existente
  (bootstrap de `catalog-sync`, §g); **nunca** se clobbea a `[normal]` ni a vacío (el schema exige ≥1; default `[normal]`).
- `availableFinishes` sigue siendo la **lista blanca SEC-A1** contra la que el buylist valida el `finish` del cliente
  (`422 FINISH_NOT_AVAILABLE`, §4.2.1). Consecuencia money-safe: si el proveedor **omite** un acabado que sí existe, el
  vendedor no podrá cotizarlo (falla **conservadora**: bloquea, no sobre-paga). Documentado.
- La derivación de `availableFinishes` usa las **variantes reportadas** por el proveedor, con independencia de si ese día
  se escribió la `PriceReference` (p. ej. si había override manual el precio no se pisa, pero el acabado sí cuenta como
  disponible).

#### (f) FX + colchón (#13) — aplica en cada ingest; y fix de UI

- **Aplica en cada ingest:** el ingest carga `FxService.getCurrent()` **una vez por corrida** (snapshot `{ rate,
  bufferPct }`) y aplica `usdToMxnCents(market, rate, bufferPct)` a cada fila **USD** → el **colchón (#13) entra en cada
  corrida**, por diseño (paridad con §4.13a). Filas en **MXN** → sin conversión ni colchón (el colchón es un cushion del
  riesgo FX USD→MXN; si el proveedor ya da MXN no hay FX que amortiguar).
- **Fix de UI (#13) — guardar SOLO el colchón sin fijar la tasa:** hoy `PUT /admin/fx` exige `{ rate, bufferPct }` y
  `FxService.setManual` **pinnea** `fx_manual_override_rate` (congela la tasa auto de Banxico). El dueño que solo quiere
  subir el colchón (3%→5%) termina fijando una tasa manual sin querer. **Solución recomendada (mínima, money-safe):** el
  colchón es un **dial de primera clase** (`fx_buffer_pct`) y `PUT /admin/settings` ya admite **body parcial** → M2 guarda
  el colchón **solo** con `PUT /admin/settings { fxBufferPct }` (**sin** tocar `/admin/fx`, sin pinnear tasa). **Nota
  para frontend** (M2). **Ajuste de correctness (backend, menor):** hoy `FxService.getCurrent()` en la rama auto-Banxico
  devuelve el `bufferPct` de la **fila `FxRate`** (escrito por el último `fx-refresh`), no el del dial, así que un cambio
  de colchón solo surte efecto tras el siguiente `fx-refresh`. Para que aplique **de inmediato** en el próximo ingest,
  `getCurrent()` debería preferir el `bufferPct` del **dial** en todas las ramas. Enrutado a **backend** (correctness).
  **Alternativa** (si el equipo prefiere mantener el colchón bajo el editor FX): hacer `rate?` **opcional** en `PUT
  /admin/fx` → si se omite `rate`, actualiza solo el colchón y **no** pinnea `fx_manual_override_rate` (ver contrato
  §M2). Recomendación: la vía del dial `fxBufferPct` (sin cambio de contrato de FX).

#### (g) Scheduling + aligerar `catalog-sync`

- **Scheduling (devops):** `price-ingest` **1–2×/día** vía el `SchedulerService` BullMQ existente (crons UTC configurables
  por env, p. ej. `PRICE_INGEST_CRON_1`/`_2`). El slot 2×/día que hoy ocupa `catalog-price-sync` (v1.12) se **repunta** a
  `price-ingest` para el **pricing**; se **conserva** un sync de **metadata** de catálogo (import de sets nuevos) en
  cadencia propia (p. ej. `sync-all {force:false}` diario o semanal — solo sets no importados, barato). Orden con FX:
  como el ingest necesita FX fresco, `fx-refresh` debe correr **antes** de cada `price-ingest` (`FxService.getCurrent()`
  degrada al último `FxRate` si falta, así que el orden es **suave** pero recomendado). Horarios exactos = **devops**
  (decisión abierta v1.14-3).
- **Aligerar `catalog-sync` (backend, A.5):** `catalog-sync` vuelve a **solo metadata**:
  - Se **quita** la llamada `persistMarketReferences` de `upsertCards` (y las deps `PricingService`/`FxService` que v1.12
    inyectó a `CatalogSyncService`). `catalog-sync` deja de escribir `PriceReference`.
  - `deriveAvailableFinishes(tcgplayer.prices)` se **conserva** como **bootstrap** (default seguro para un set recién
    importado, antes de su primer `price-ingest`); `price-ingest` lo **sobre-escribe** con las variantes del proveedor
    (§e). *(Alternativa: quitarlo también y dejar `[normal]` hasta el primer ingest; se prefiere conservarlo para que un
    set nuevo sea usable de inmediato. Decisión menor, backend.)*
  - `persistMarketReference` (en `PricingService`) se **generaliza**: hoy hardcodea `source='pokemontcg_io'` y asume USD;
    pasa a aceptar `source: PriceSource` y `currency` (o un `priceMxnCents` ya convertido) para servir al ingest de paga.
  - **`catalog-price-sync` (v1.12) queda DEPRECADO en su rol de pricing** (su `force:true` re-bajaba todo el catálogo solo
    para refrescar precios; ahora lo hace `price-ingest`, mucho más barato). Su función de **import de sets nuevos** se
    mantiene con `force:false`. `set-price-sync` (v1.9) queda **más** subsumido aún (el ingest precia todo el catálogo,
    incluido el set del hero); se conserva inocuo, retiro opcional en fase 2.

#### (h) Config / env / contrato

- **Env (secreto):** `POKEMONPRICETRACKER_API_KEY` — **ya aprovisionada en Railway** (NUNCA en el repo; el código solo
  lee `process.env`). Pasa a ser **requisito operativo en prod** cuando `PRICE_PROVIDER=pokemonpricetracker`. Recomendación
  devops: añadirla a la lista *required* de `env.validation.ts` en no-local **solo** si el dial apunta al proveedor de
  paga (o dejarla opcional y que el ingest degrade a "no escribe / precios stale" con alerta en `dataHealth`). Money-safe:
  si el proveedor de paga está seleccionado pero la key falta/está inválida, **no** se borran precios (se dejan stale) y se
  loguea/alerta; **no** hay fallback silencioso a otra fuente (evita mezclar fuentes sin querer). Ver decisión abierta v1.14-2.
- **Dial `PRICE_PROVIDER` (`price_provider`, ConfigSetting):** selecciona el `BulkPriceProvider` de ingest. Valores
  **`tcgcsv_singles | pokemonpricetracker | pokemontcg_io`** (`PRICE_PROVIDER_VALUES =
  ['pokemontcg_io','pokemonpricetracker','tcgcsv_singles']`). Editable **sin redeploy** (M2/M10) → palanca de **rollback**
  money-safe. **Vigente desde P-47/§4.35: primario `tcgcsv_singles`** (precio por-acabado diario desde TCGCSV);
  `pokemontcg_io` = legacy/rollback money-safe; `pokemonpricetracker` (PPT bulk) = fallback. ~~**Seed recomendado
  (rollout money-safe): `pokemontcg_io`** … **devops flip a `pokemonpricetracker`** tras verificar el esquema en la 1ª
  corrida manual … Decisión abierta v1.14-4.~~ *(superado por P-47/§4.35: el flip previsto v1.14 quedó absorbido por el
  switch a `tcgcsv_singles`, hoy el provider primario del barrido).*
- **Disparo manual:** `POST /api/v1/admin/jobs/price-ingest` (super_admin, auditado, single-flight; familia §M10-ops).
  Acepta `setId?` **opcional** (excepción justificada al body-vacío de la familia): un solo set para **verificar el
  esquema** en la 1ª corrida sin barrer el catálogo entero. Ver `API_CONTRACT.md §M10-ops`.
- **Contrato:** `POST /admin/jobs/price-ingest` (nuevo, §M10-ops); dial `priceProvider` en el DTO de `/admin/settings`
  (§M10); ~~nota de que `CardDTO.availableFinishes` pasa a **derivarse del proveedor** (mismo shape)~~ **⛔ derogado por
  §4.22a: el ingest NO escribe `availableFinishes`**; `PUT /admin/fx` gana
  `rate?` opcional (#13, alternativa). Sin migración de esquema.
- **Sin migración:** WS-A reusa `PriceReference` (finish en la clave, M-18), `PriceSource.pokemonpricetracker` (ya en el
  enum) y `Card.availableFinishes`. El dial `PRICE_PROVIDER` es una fila de `ConfigSetting` (dato, no esquema).

---

### 4.16 WS-C — Cotizador de buylist (Fable) contra el backend real (v1.15-buylist-batch-clabe)

> **Objetivo:** que el cotizador rediseñado del frontend funcione contra el backend real sin los mocks/atajos
> actuales. Tres piezas: (a) **CLABE opcional** con fallback server-side (PII), (b) **batch quote** (mata el
> fan-out FE-12), (c) **flags de KYC en archivo** para que el front oculte lo que ya está. **Aditivo, SIN
> migración.** TOCA DINERO/PII → triple veredicto. SEC-A1 intacto.

#### 4.16a — CLABE opcional + fallback server-side (PII)

**Problema.** `CreateRequestDto.clabe` es **obligatoria** (`backend/src/modules/buylist/dto/buylist.dto.ts:51`,
`@IsString() clabe!: string`). El cliente solo posee `clabeMasked` (`GET /users/me/kyc` nunca devuelve la CLABE en
claro), así que el atajo "usar mi CLABE en archivo" del cotizador **no puede** rearmar los 18 dígitos y hoy es
**mock-only** (`frontend/src/lib/api.ts:542-550`, flag `useClabeOnFile` que **no** viaja al backend real).

**Decisión.** `clabe` pasa a **opcional** en `POST /buylist/requests`. El backend resuelve la CLABE efectiva así
(pseudocódigo — lo implementa **backend**):

```ts
// createRequest(userId, items, clabe?, ineUploadKeys?)
const kyc = await prisma.kycProfile.findUnique({ where: { userId } }); // SIEMPRE del userId autenticado
let effectiveClabe: string;
if (clabe) {
  if (!isValidClabe(clabe)) throw CLABE_INVALID;                       // formato 18 dígitos (sin cambio)
  // match a nombre propio contra la CLABE en archivo (blind index HMAC, sin descifrar) — sin cambio:
  if (kyc?.clabeHmac && !blindIndexEquals(kyc.clabeHmac, clabeBlindIndex(clabe))) throw CLABE_NOT_OWN_NAME;
  effectiveClabe = clabe;
} else {
  // FALLBACK server-side: la CLABE del PROPIO usuario, misma fuente que revealClabe (buylist.service.ts:453-457)
  effectiveClabe = pii.decryptOptional(kyc?.clabeEnc) ?? null;
  if (!effectiveClabe) throw CLABE_REQUIRED;                           // 422 nuevo: ni en request ni en archivo
}
const clabeEnc = pii.encrypt(effectiveClabe);                         // se SNAPSHOTEA cifrada en la solicitud
// ... resto del flujo (topes, INE, persistencia, clabeSnapshotEnc = clabeEnc) sin cambio
```

**Garantías (obligatorias, verifica seguridad):**
- **Autorización estricta.** El fallback lee `kyc` **por `userId` de la sesión**; es imposible resolver la CLABE de
  otro usuario. El endpoint es `customer`-scoped y el `EmailVerifiedGuard` ya aplica.
- **PII nunca en claro fuera del reveal.** `effectiveClabe` **no se loguea** (ni en `AuditLog`, ni en logs de app) y
  **no se devuelve** en la respuesta (`{ sellRequestId, status, quotedTotalCents, ineRequired, items }` no contiene
  CLABE). Se guarda **solo cifrada** (`clabeSnapshotEnc` + `KycProfile.clabeEnc`). El único punto de exposición en
  claro sigue siendo `GET /admin/buylist/:id/reveal-clabe` (super_admin, money-out, auditado, §3.4).
- **Snapshot en el momento de la solicitud.** Se snapshotea la CLABE **resuelta** en `clabeSnapshotEnc` para que el
  pago SPEI use la CLABE vigente al crear la solicitud aunque el usuario cambie luego su KYC. `revealClabe` ya prioriza
  el snapshot y cae a `kyc.clabeEnc` (sin cambio), por lo que **no requiere tocarse**.
- **Sin debilitar controles.** Cuando `clabe` **sí** viaja, el path actual (formato + nombre propio + persistencia) es
  idéntico. El fallback **no** puede inyectar una CLABE de tercero ni saltarse el match (es, por definición, la propia).

#### 4.16b — Batch quote (`POST /buylist/quote/batch`) — mata el fan-out FE-12

**Problema (FE-12, TECH_DEBT).** `POST /buylist/quote` es **por-carta**; el grid del cotizador monta un `useQuery`
**por resultado visible** → una búsqueda dispara ~`pageSize` (≤20) quotes en ráfaga, y el bulk "agregar al carrito" es
`Promise.all` **all-or-nothing** (un fallo aislado bloquea el lote). El disparador registrado para saldarlo es
"**cuando exista el endpoint batch quote (Fase 3b)**".

**Decisión.** Endpoint **NUEVO** `POST /buylist/quote/batch` (`public`, **READ-ONLY**), que cotiza **N cartas en 1
request** con **errores por-ítem**. Es un **`map` de `publicQuote` sobre `items[]`** compartiendo `buylistRules()`
(un solo read de config) — **misma matemática y mismos guardarraíles** que el cotizador por-carta:

- **Reuso de pricing.** Cada ítem: `assertFinishAvailable(card, finish)` → `getReference(cardId, productType,
  gradeKey, finish)` → `quoteAcquisitionForFinish(card.rarity, finish, ref, rules, fallbackPct)`. Idéntico a
  `buylist.service.ts:57-102`. Incluye el **gate premium** (§4.2.1), reglas por rareza (`BUYLIST_PRICE_RULES`),
  fallback pct, `precio_pendiente` cuando `pct` y falta referencia del acabado. La FX ya está bakeada en
  `PriceReference` (MXN), así que la coherencia con el resto del sistema es automática.
- **READ-ONLY estricto.** No crea `SellRequest`, no mueve dinero, no persiste y **no** llama `escalatePending`
  (endpoint anónimo; escalar desde aquí sería superficie de abuso — misma razón que llevó a `publicQuote` a read-only
  en v1.12). La escalada a `PendingPriceEntry` sigue **solo** en `POST /buylist/requests` (autenticado).
- **Errores por-ítem.** Una carta inválida **no** tumba el lote: cada resultado es `ok:true` (con la cotización) u
  `ok:false` (con `error.code` = `NOT_FOUND` | `FINISH_NOT_AVAILABLE`, los mismos que el endpoint por-carta
  devolvería como 404/422). **HTTP global = 200.** Correlación por **`index`** (posición 0-based en `items`) + eco de
  `cardId` (un mismo `cardId`+`finish` puede repetirse; el `index` es la llave robusta).
- **Cap.** `BUYLIST_QUOTE_BATCH_MAX = 50` ítems por request (constante de servidor; cubre `pageSize` 20 del grid con
  holgura sin ser vector de abuso). `items` vacío o por encima del cap → `400 VALIDATION_ERROR` (via
  `@ArrayNotEmpty` + `@ArrayMaxSize(50)`). Cuenta como **1** request contra el throttle público (colapsa el fan-out;
  **reduce** presión sobre el límite 300/min citado en FE-12).
- **SEC-A1.** Rareza y acabado se derivan **server-side** de `Card.rarity` y del `finish` validado contra
  `Card.availableFinishes`; el cliente nunca envía precio/monto/regla.

**Modelo de cotización = una línea por carta física (SIN `qty`).** El modelo actual (`PublicQuoteDto`,
`SellRequestItem`) es **one-line-per-card**; no existe multiplicador de cantidad. El batch **espeja** los campos del
cotizador por-carta (`cardId`, `productType`, `rawCondition?`, `finish?`) y **no** introduce `qty` (sería un cambio de
producto, no una traducción del modelo actual). Ver decisión abierta **WS-C-2** en §10.

#### 4.16c — INE/CLABE en archivo expuestos al front

- **`ineOnFile` ya existe** (`users.service.ts:139` = `Boolean(kyc.ineFrontKey && kyc.ineBackKey)`; contrato §1). El
  front lo consume para **ocultar los uploaders de INE** cuando ya está en archivo y **omitir** `ineUploadKeys` en
  `POST /buylist/requests`. El backend ya trata el INE en archivo como "provisto" para el umbral AML
  (`buylist.service.ts:209-211`), así que ocultar los uploaders es seguro: la solicitud sobre el tope no se rechaza por
  `INE_REQUIRED` si el INE ya está.
- **`clabeOnFile: boolean` (NUEVO, aditivo)** = `Boolean(kyc.clabeEnc)`, para dar al front un booleano **limpio y
  simétrico** a `ineOnFile`. Habilita el atajo "usar mi CLABE ****1234" (= **omitir** `clabe`, resuelto por 4.16a) sin
  que el front tenga que inferirlo de la presencia de `clabeMasked`. `clabeMasked` se conserva para pintar el label.
  Sin PII nueva.

#### Reparto de trabajo

- **Backend:** (1) `CreateRequestDto.clabe` → `@IsOptional() clabe?: string` y la resolución/fallback de 4.16a con el
  nuevo `422 CLABE_REQUIRED`; asegurar que la CLABE resuelta **no** se loguea y se snapshotea cifrada. (2) Nuevo
  controlador/servicio `POST /buylist/quote/batch` (public, read-only) que mapea `publicQuote` con `@ArrayNotEmpty` +
  `@ArrayMaxSize(50)` y agrega errores por-ítem. (3) `getKyc` añade `clabeOnFile`. Tests: fallback usa solo la CLABE
  propia; `CLABE_REQUIRED` cuando no hay ninguna; batch con 1 carta inválida devuelve 200 + error por-ítem; batch
  respeta el cap; equivalencia numérica batch vs por-carta.
- **Frontend:** (1) sustituir el fan-out por-resultado y el `Promise.all` all-or-nothing por **1** llamada a
  `/buylist/quote/batch` por página, con render **parcial-tolerante** (mostrar lo cotizado, marcar lo fallido por
  `error.code`). (2) Retirar el flag mock `useClabeOnFile`: si `clabeOnFile` → ofrecer "usar mi CLABE ****1234" y
  **omitir** `clabe` en `POST /buylist/requests`; si no → pedir CLABE. (3) Ocultar uploaders de INE cuando `ineOnFile`.
  (Extracción de hooks/subcomponentes de `BuylistView` = FE-13, oportunista.)
- **Devops/QA/seguridad:** triple veredicto (toca dinero/PII). E2E: cotizar un lote, crear solicitud con CLABE en
  archivo (sin reteclear) y con INE en archivo (sin resubir); pentest del fallback (no fugar/loguear CLABE; no resolver
  la de otro usuario).

### 4.17 WS-E — Master Set + inventario a escala (M1) (v1.16-master-set)

**Problema.** M1 no escala: el alta es 1×1 (`M1View` abre un modal, elige carta, crea una pieza) y la lectura es una
tabla plana paginada de piezas (`GET /admin/inventory/items`). Para inventariar una colección real (miles de cartas,
cada set con ~150–400 cartas × varios acabados) el dueño necesita (a) ver **de un vistazo** qué tiene y qué falta por
set y acabado, y (b) **dar de alta y publicar por lote**. **Invariante que NO cambia:** sigue habiendo **1
`InventoryItem` por pieza física** (la custodia por-pieza, folios, ubicación y movimientos lo exigen). WS-E es
**agregación de lectura** + **lote de escritura** encima del mismo modelo.

**#### 4.17a Lectura agregada (binder).**
- **Índice de sets** (`GET /admin/inventory/master-sets`): resumen por set. Consulta **fija, sin N+1** siguiendo el
  patrón de `set-value.service.ts:computeSetValue` (2–3 queries en lote, agregación en memoria):
  1. página de `CardSet` (con `q`/`sort`/paginación);
  2. `Card.groupBy({ by:[setId], _count })` → `catalogCardCount` por set;
  3. **una** agregación cruzada `InventoryItem ⋈ Card` para los `setId` de la página (raw SQL:
     `SELECT c."setId", COUNT(*) pieces, COUNT(DISTINCT ii."cardId") distinctCards FROM "InventoryItem" ii JOIN "Card"
     c ON c.id=ii."cardId" WHERE ii."ownerType"='platform' AND ii.status NOT IN (…) AND c."setId" = ANY($ids) GROUP BY
     c."setId"`). Es 1 query por página, no por set.
  `completionPct = distinctCardsOwned / catalogCardCount × 100` (denominador = **catálogo real**, no `printedTotal`,
  para no dar >100% con secret rares; se expone también `printedTotal` para que el front muestre "X / printedTotal" si
  quiere). Ver decisiones abiertas **WS-E-1/2**.
- **Binder del set** (`GET /admin/inventory/master-sets/:setId`): una `MasterSetCardCellDTO` por `Card` del set.
  Consulta fija: (1) `Card WHERE setId`; (2) **una** agregación `groupBy [cardId, finish]` (o raw) de piezas on-hand
  → `countsByFinish`. Sirve el índice **M-21** `@@index([cardId, finish, status])`.
- **Orden natural (obligatorio) — v1.16.1 CORREGIDO.** `Card.number` es **String**; el orden lexicográfico rompe
  ("10"<"2"; promos `TG12`). El requisito es: **numéricos puros por valor entero primero, promos/subsets alfabéticos
  (TG/GG/SV) al final agrupados por prefijo**. La fórmula ilustrativa previa
  (`NULLIF(regexp_replace(number,'\D','','g'),'')::int`) era **incorrecta**: convertía `TG12`→`12` e intercalaba el
  promo entre las numéricas (contradice "promos al final"). El backend implementó el correcto — el entero solo se
  parsea cuando `number ~ '^[0-9]+$'`:
  `ORDER BY (number ~ '^[0-9]+$') DESC, CASE WHEN number ~ '^[0-9]+$' THEN number::int END NULLS LAST,
  regexp_replace(number,'[0-9]','','g'), NULLIF(regexp_replace(number,'\D','','g'),'')::int, number`.
  `numberSort` (DTO) = el entero para numéricas; sentinela que empuja al final para promos.
- **`isSecretRare` — heurística SOLO de display (v1.16.1 afinado).** `true` **solo** para cartas de la numeración
  **principal** (número puramente numérico) cuyo entero **> `printedTotal`** (secret/hyper rare real); promos/subsets
  con prefijo alfabético (TG/GG/SV) → `false` (subset aparte); `printedTotal` nulo → `false`. **Decisión de producto
  (default propuesto):** el subset se distingue por prefijo alfabético, no cuenta como secret rare. La forma amplia
  previa (`numberSort > printedTotal` sin más) marcaba TODOS los promos → **deuda BE-36** (§9). El front hace
  **filtros locales** (rareza/acabado/faltantes/secret) sobre la respuesta completa (no paginada; un set es acotado —
  virtualización = fase 2).

**#### 4.17b Escritura por lote.**
- **Alta por lote** (`POST /admin/inventory/items/batch`): reusa la lógica de `inventory.service.ts:create` por línea,
  dentro de una iteración **tolerante a fallos** (una línea que lanza `BusinessException` se captura y se reporta como
  `ok:false` sin abortar el lote → commit parcial). **`qty`** expande a N filas (bulk raw/sellado; graded=1). Los
  folios del lote se reservan **consecutivos** con el nuevo `PrismaService.nextFolios(n)` (una llamada
  `SELECT nextval(...) FROM generate_series(1,n)` en vez de N round-trips). **Idempotencia + auditoría por lote:** el
  `batchKey` se persiste en el nuevo modelo `InventoryBatch` (M-21) junto con el resultado; un replay devuelve el
  resultado guardado (`idempotentReplay:true`) sin re-crear. `InventoryBatch` **es** el registro de auditoría del lote.
- **Publicación por lote** (`POST /admin/inventory/items/bulk-publish`): por pieza, `status→listed` + precio
  **derivado** de las reglas de venta por rareza+acabado (§4.14, `computeSalePriceForItem`, SEC-A1) o **manual**
  (`listPriceCents`). Una pieza cuyo precio no se resuelve (`pct` sin market) → `PRICE_PENDING`, **no** se publica
  (regla "solo se lista lo que tiene precio", §4.9). Errores por-línea; re-publicar = no-op idempotente.
  - **Status de origen publicable (v1.16.1, guardarraíl anti double-sell).** SOLO `{in_stock, listed}` son publicables:
    `in_stock` → publica (`→listed`); `listed` → **no-op idempotente**; **cualquier otro** status (`reserved |
    in_custody | picking | shipped | delivered | lost | damaged | withdrawn`) → **`422 ITEM_NOT_PUBLISHABLE`** por-línea,
    **no** se publica. Esto cierra el double-sell señalado por seguridad: una pieza **reservada/vendida/en-custodia/
    enviada** no puede regresar a `listed`. `ITEM_NOT_PUBLISHABLE` es **distinto** de `PRICE_PENDING` (precio no resuelto).

**#### 4.17c Deuda pagada (parte del alcance de WS-E).**
- **`PricingService.getReferencesBatch(items)`** (cierra **RB-8/BE-4/D3**): resuelve la "referencia vigente = más
  reciente por acabado" para N ítems en **1** query (`WHERE (cardId,productType,gradeKey,finish) IN …`, orden
  `capturedDate desc`, primera por clave). Lo usan `bulk-publish` y el binder, y queda disponible para `holdings`/
  `ownedItemRefs`/`inventoryValue` (misma dirección que la deuda diferida).
- **BE-25 (pago mínimo):** `fetchSellable` y `bulk-publish` **izan** `SALES_PRICE_RULES`+fallback **una vez por
  request** (en vez de 2 lecturas de settings sin cache por ítem) y usan `getReferencesBatch`. Cierra el N+1 de
  settings en la ruta de venta; el resto de BE-25 (memoización global de `SettingsService`) queda como deuda menor.

**#### 4.17d Reuso.** El binder (grid por número + acabados disponibles con `countsByFinish`) es la **misma superficie**
que ya usa el picker de catálogo del cotizador (`GET /buylist/cards`) y la de Compra: back-office la usa para
**inventariar**; el cotizador/Compra, para **elegir carta+acabado**. El front puede compartir el componente de
cuadrícula (celda = carta+acabados); solo cambia la acción (agregar-al-carrito vs cotizar vs comprar).

#### Reparto de trabajo
- **Backend (M1):** (1) `GET /admin/inventory/master-sets` + `/:setId` con las agregaciones fijas (raw SQL/groupBy,
  sin N+1) y el orden natural de `number`. (2) `POST /admin/inventory/items/batch` (iteración tolerante a fallos,
  `qty`, idempotencia `InventoryBatch`, auditoría). (3) `POST /admin/inventory/items/bulk-publish` (derivación de
  precio server-side, errores por-línea). (4) `PrismaService.nextFolios(n)`. (5) `PricingService.getReferencesBatch`
  + pago mínimo de BE-25. (6) Migración M-21 (índice + `InventoryBatch`). Tests: agregados coinciden con conteos
  reales; orden natural ("10">"2", `TG12` al final); batch con 1 línea inválida devuelve 200 + resto creado; replay de
  `batchKey` no duplica; bulk-publish con `pct` sin market → `PRICE_PENDING` sin publicar; sin N+1 (conteo de queries).
- **Frontend (M1):** (1) **índice Master Set** (grid de sets con completitud/piezas, ordenable). (2) **binder** del set
  (cuadrícula por número; celda con imagen, número, `countsByFinish`, badges de acabado; resaltar huecos y secret
  rares; **filtros locales** rareza/acabado/faltantes). (3) **carrito de captura** (#12): acumular líneas → 1 POST
  `/batch` → render **parcial-tolerante** (folios creados / errores por-línea). (4) **publicación masiva**: seleccionar
  N piezas → `/bulk-publish` con precio derivado/manual → resultados por-línea. Reusa el componente de cuadrícula del
  picker existente.
- **Devops/QA:** doble veredicto (no toca dinero saliente; la publicación deriva precio server-side). E2E: inventariar
  un set por el binder (alta por lote de varias cartas/acabados), ver el conteo agregado actualizarse, publicar en
  lote, y confirmar que el replay del carrito no duplica.

---

### 4.18 WS «Catálogo y precios» — M5 operable: rechazo de ítem con plazos + correo al vendedor (v1.18-buylist-rejects)

> Norma la parte del ciclo de buylist que faltaba tras la decisión `reject` (PROJECT §H / criterios 15–16): hoy el
> rechazo solo cambia `itemStatus` — sin motivo, sin fechas, sin notificación al vendedor y con un hueco de dinero
> (BL-1, §9). API_CONTRACT v1.18 (§M5) tiene los shapes; aquí van las decisiones de diseño.

**a) Ancla única de plazos = `rejectedAt` (persistido, M-22).** `SellRequestItem` no tiene NINGÚN timestamp propio
(ni `updatedAt`); `adjustmentSentAt` vive en la solicitud y solo aplica al flujo `adjust`; y `AuditLog` no es fuente
válida para lógica de plazos (cross-módulo, sin índice útil, semántica de bitácora). Por eso `rejectedAt` (y el
`rejectionReason` que exige el correo y la pestaña «Rechazadas») son columnas **imprescindibles** — las ÚNICAS de esta
versión. Los plazos **NO se persisten**: `returnDeadlineAt = rejectedAt + 7d` y `abandonDeadlineAt = rejectedAt + 30d`
se derivan al proyectar, con constantes de servidor de la **misma familia 7d/30d** que `buylist-sweep.service.ts`
(coherencia: el sweep ancla el 7d del AJUSTE en `adjustmentSentAt` y el 30d de abandono de solicitud en `createdAt`;
el ítem RECHAZADO ancla ambos en `rejectedAt` = momento en que se decide y se notifica). **Sin transición automática
del ítem al vencer**: las fechas son informativas para back-office y vendedor; el sweep a nivel solicitud no cambia, y
la retención física post-abandono se administra manualmente (la carta jamás se vuelve vendible — guardia
`ITEM_NOT_APPROVED`).

**b) Invariante de dinero (cierra BL-1).** `reject` ⇒ `approvedPriceCents = null` **antes** de
`recomputeApprovedTotal`. Defensa en profundidad recomendada a backend: que el aggregate del recompute además excluya
`itemStatus='rechazada'` (así el invariante sobrevive a escrituras futuras que olviden anular el monto). Observable
normado: `approvedTotalCents` NUNCA incluye ítems rechazados; `quotedTotalCents` no se recalcula.

**c) Correo de rechazo — mecanismo (decisión de diseño).** El módulo `mail` pertenece al stream «Cuentas y acceso» y
**NO se toca**. `buylist` inyecta el **puerto público `MAIL_PORT`** (interfaz genérica `send({to, subject, html,
text})`; el `MailModule` ya es `@Global` y exporta el token) y renderiza con **plantilla LOCAL al módulo buylist**
(p. ej. `backend/src/modules/buylist/buylist-mail.templates.ts`), bilingüe **ES/EN por `User.locale`** y con el
**mismo layout/branding y disciplina de escape HTML (S15-B1)** que `mail.templates.ts`. Firma sugerida:
`sellItemRejectedTemplate({ cardName, setName, cardNumber, finish, reason, returnDeadlineAt, abandonDeadlineAt },
name, locale) → MailMessage`. **Deuda aceptada:** la plantilla (y el helper de layout duplicado) vive fuera de `mail/`
hasta que el stream «Cuentas y acceso» la absorba en `MailService` — backend la registra en `docs/TECH_DEBT.md`.
- **Best-effort:** el envío corre **después** del commit de la decisión; su fallo se loggea (`logger.error`) y **no**
  revierte ni falla el request. Sin cola de reintentos en MVP (parte de la misma deuda).
- **Disparo:** SOLO en la transición a `rechazada` (re-`reject` idempotente ⇒ no re-envía).
- **Minimización de datos:** el correo lleva carta (nombre/set/número), acabado, `reason` y los dos plazos con el
  canal de coordinación (soporte@tcgvaultmx.com). **Prohibido:** CLABE (ni enmascarada), montos o estado de OTROS
  ítems de la solicitud, cualquier dato de terceros.

**d) Identidad del vendedor en M5 (PII).** `seller: { id, name, email }` en `GET /admin/buylist`,
`GET /admin/buylist/:id` y `rejected-items`. El correo del vendedor es **dato de contacto operativo** de un
back-office ya restringido por rol (`vault_operator`/`super_admin`) — **no** es secreto financiero como la CLABE, así
que **no** requiere enmascarado, reveal dedicado ni auditoría por lectura (explícito para que nadie lo "endurezca" por
analogía con `reveal-clabe`, ni lo relaje: la CLABE conserva su régimen íntegro).

**e) Pestaña «Rechazadas».** Endpoint dedicado `GET /admin/buylist/rejected-items` (ítem-céntrico, transversal a
solicitudes) en vez de forzar al front a paginar solicitudes y filtrar ítems. Orden `rejectedAt desc` (legacy `null`
al final); la fase (ventana de devolución / de abandono / abandonada) se deriva en el front comparando `now` con las
dos fechas. Índice recomendado `@@index([itemStatus])` (parte de M-22) para no barrer la tabla.

> **Ampliación v1.24-buylist-request-reject (2026-08-20, branch `claude/buylist-ordenes`) — ESTADO A NIVEL SOLICITUD al
> rechazar ítems (bug P-4).** v1.18 (§4.18a–e) normó el ÍTEM rechazado (motivo, plazos, correo, invariante de dinero)
> pero **dejó fuera la transición de `SellRequest.status`**: `itemDecision(reject)` actualizaba **sólo** el ítem y nunca
> re-evaluaba la solicitud. El único punto que movía una solicitud a `rechazada` era `respond('decline')` (flujo del
> CLIENTE ante un ajuste), no el back-office M5. Resultado (P-4): rechazado el único ítem, la solicitud se quedaba
> atorada en `verificacion`, huérfana. Se documentan **dos mecanismos complementarios** («y/o» del PO). Sin migración
> (ningún campo nuevo; `closedAt` ya existe por M-19/SEC-D2). Contrato en API_CONTRACT §M5 (v1.24).

**f) Auto-transición de la solicitud (mecanismo principal — efecto de `itemDecision(reject)`).** La re-evaluación del
estado de la solicitud es un **efecto del propio `reject`, ejecutado TRAS `recomputeApprovedTotal`** (mismo transaction
boundary que el cambio de ítem, para que un ítem rechazado y una solicitud atorada no puedan coexistir tras un commit
exitoso). **Regla exacta de agregación:** la solicitud pasa a `status="rechazada"` **sólo si TODO ítem** tiene
`itemStatus="rechazada"` (equivalentemente: **cero** ítems en estado no-rechazado). Al sellar el estado terminal se fija
**`closedAt = now()`** (patrón SEC-D2, §4.8/M-19 — la misma ancla que usa `ine-retention`).
- **Guard «no pisar terminal»:** si la solicitud ya está en un estado terminal (`pagada`/`rechazada`/`abandonada`) la
  auto-transición es **no-op**. Nunca reescribe una `pagada` (dinero ya salió) ni re-sella una `rechazada`. Combinado
  con la idempotencia del `reject` por-ítem (§4.18, un `reject` sobre ítem ya `rechazada` es no-op y no re-dispara),
  la transición es **idempotente end-to-end**.
- **`convertida_inventario` NO es «rechazado».** Un ítem convertido a inventario es un desenlace **positivo** (se volvió
  stock vendible), no un rechazo. Por eso la condición es «TODO ítem `rechazada`», **no** «ningún ítem `aprobada`»: si
  conviven ítems `convertida_inventario` y `rechazada`, la solicitud **no** se auto-rechaza (queda en su estado vivo,
  típicamente `aprobada`/`pagada` según su flujo de dinero). Esto evita cerrar como «rechazada» una solicitud que en
  realidad tuvo cartas aceptadas y convertidas. La solicitud «mixta» sigue su curso normal; su cierre lo determina el
  flujo de dinero (pago SPEI) o el sweep de abandono, no el rechazo de las cartas no-NM.

**g) Cierre explícito — botón «Rechazar solicitud» (`POST /admin/buylist/:id/reject`).** Para las solicitudes **ya
atoradas** (ítem rechazado **antes** de este fix, que la auto-transición no puede reparar retroactivamente porque nadie
vuelve a llamar `reject`) el M5 gana un cierre manual. Diseño deliberadamente **estrecho y money-safe**:
- **Guard de precondición idéntico a la regla (f):** cierra **sólo si TODOS** los ítems ya están `rechazada`. Si queda
  algún ítem no-rechazado → **`422 REQUEST_HAS_NON_REJECTED_ITEMS`** (`details.nonRejectedItemStatuses`). El botón **no**
  es un «rechazar todo en cascada»: rechazar cartas es cherry-pick por-ítem (`itemDecision`), con su motivo, plazos y
  correo. Este endpoint sólo **sella la solicitud** que ya quedó sin ítems vivos.
- **Efecto único = `status → rechazada` + `closedAt = now()`.** **No** mueve dinero (sin `MoneyOutGuard`; roles
  `vault_operator`/`super_admin` como el resto de M5 hasta verificación), **no** reevalúa montos por ítem (BL-1 ya
  garantiza que los ítems rechazados no suman en `approvedTotalCents`; `quotedTotalCents` es snapshot histórico), **no**
  manda correos (los correos por-ítem ya salieron al rechazar cada carta; añadir uno a nivel solicitud sería redundante
  y arriesgaría duplicar notificación).
- **Idempotencia y terminalidad:** solicitud ya `rechazada` → `200` con el estado actual (no re-sella, no re-audita como
  cambio). Otro estado terminal (`pagada`/`abandonada`) → `409 CONFLICT` (invariante «no pisar terminal»: una `pagada`
  jamás se reescribe a `rechazada`). Auditado `action: buylist.reject` (actor, solicitud, `reason?` interno sin PII).
- **Deuda operativa:** el back-log de solicitudes atoradas pre-fix se drena con este botón (uno a uno) o con un script
  de datos puntual que aplique la misma regla (f); ambos caminos convergen al mismo invariante. Registrar en
  `docs/TECH_DEBT.md` si se opta por barrido masivo.

**h) Paginación server-side + filtros de la cola M5 (v1.25-buylist-orders-pagination — cierra P-5).** La pestaña
«Cerradas» del front hoy trae la lista COMPLETA (`getAdminBuylist` sin params) y filtra/agrupa **en memoria** — no
escala. Decisión del PO: **paginar + filtrar en el servidor** (NO archivar aparte). Diseño en API_CONTRACT §M5 (params
`q`, `from`, `to`, `minCents`, `maxCents`, `status` CSV, `pageSize`). Decisiones de arquitectura:
- **`status` CSV → `WHERE status IN (...)`**: la pestaña «Cerradas» = `IN ('pagada','rechazada','abandonada')` en UNA
  query. Aditivo sobre el parámetro `status` existente (un valor = `IN` de uno; omitido = sin filtro). Se descartó una
  tabla/estado «archivada» aparte (el PO lo excluyó) y un alias `closed=true` (añade vocabulario sin ganar nada).
- **Monto sobre `quotedTotalCents`, NO `approvedTotalCents`.** `quotedTotalCents` es `Int @default(0)` (siempre
  presente, snapshot histórico, estable ante rechazo por-ítem — BL-1); `approvedTotalCents` es nullable y sólo existe
  tras aprobar/ajustar, así que filtrar por él **excluiría** las `rechazada`/`abandonada` que dominan «Cerradas».
- **`q` server-side** = `id ILIKE %q%` OR sobre el join `User` ya presente (`name`/`email`). Sustituye 1:1 el filtro
  client-side de `M5View`. `q` es contains (no prefijo) → sin índice B-tree útil; a escala MVP el barrido sobre el
  conjunto YA reducido por `status`/`userId`/rango es aceptable. Si crece: `pg_trgm` GIN sobre `User.name`/`email` (no
  en MVP; deuda anotable). **`q` NO toca CLABE/RFC/INE** (evita oráculo de enumeración sobre PII cifrada/enmascarada).
- **`pageSize` default 20 sin cambios** (subir el default = ruptura silenciosa de consumidores actuales); el front pide
  25. Validación de `page`/`pageSize`/fecha/monto/`status`-token → `400 VALIDATION_ERROR` (patrón de la cola
  `rejected-items`, que ya valida por DTO). Orden `createdAt desc` ya normado (v1.18).
- **Índices recomendados a backend (NO escribo migración — `backend/prisma/` es zona compartida serializada por el
  orquestador; esto es recomendación, la valida/aplica el stream backend):**
  | Modelo | Índice recomendado | Sirve |
  |---|---|---|
  | `SellRequest` | `@@index([status, createdAt])` (compuesto) | pestaña «Cerradas» = `status IN (...)` + `ORDER BY createdAt DESC` sin barrer la tabla. Cubre el caso dominante. |
  | `SellRequest` | `@@index([createdAt])` | rango `from`/`to` y orden cuando NO se filtra por `status`. |
  | `SellRequest` | `@@index([userId])`, `@@index([status])` | **YA EXISTEN** (no duplicar; el compuesto `[status, createdAt]` puede volver redundante al `[status]` suelto — backend decide si lo sustituye). |
  | `SellRequest.quotedTotalCents` | — (sin índice) | rango de monto es de baja selectividad y casi siempre acompañado de `status`/fecha ya indexados; se resuelve como filtro post-índice. Añadir sólo si el profiling lo pide. |

---

### 4.19 WS «Catálogo y precios» — Referencia de mercado del SELLADO vía TCGCSV (v1.19-sealed-tcgcsv)

> **Objetivo:** darle al admin un **valor de referencia de mercado** para el producto sellado (ETB, booster box,
> bundle, tin, blister) usando **TCGCSV** (tcgcsv.com): espejo **diario** (~20:00 UTC), **estático** (JSON servido como
> archivos), **gratuito y sin API key** de los precios de TCGplayer, que **sí cubre sellado** (pokemontcg.io no).
> **Toca precios (dinero informativo) → triple veredicto.** Aditivo; **UNA migración (M-23, §11)**.

#### (a) Doctrina y PRECEDENCIA (PROJECT decisión 3e manda — el modelo de venta del sellado NO cambia)

- El precio TCGCSV es **VALOR DE REFERENCIA informativo/sugerencia**, nunca precio de venta. Sigue intacto:
  el sellado se **vende** con `listPriceCents` **manual del admin en MXN, obligatorio para publicar** (PROJECT 3e,
  criterio 3e, §3.6, y la regla de M1/bulk-publish "sellado sin `listPriceCents` → `PRICE_PENDING`").
- **Lo que la referencia TCGCSV NO hace (norma explícita):**
  1. **NO auto-publica** ni fija/actualiza `listPriceCents` (ni siquiera como default del formulario — el admin
     teclea; el front puede MOSTRAR la sugerencia al lado).
  2. **NO encola `PendingPriceEntry`**: un sellado sin mapeo/sin precio TCGCSV simplemente no tiene referencia
     (`sealedMarketRef=null`); esa cola sigue reservada a los bloqueos reales de publicación/valuación.
  3. **NO cambia el costo de aportación en especie** del sellado: sigue el flujo actual (`getReference` con
     `gradeKey='sealed'` = override manual del admin, o escalación). Usar TCGCSV como base del costo = decisión del
     humano (pregunta abierta v1.19-2), porque mueve dinero (P&L).
  4. **NO se expone en la superficie pública** (ficha de Compra) en esta versión: criterio 2 de PROJECT define la
     fuente del sellado como "precio manual del admin"; mostrar un "valor de mercado" público del sellado tocaría
     PROJECT (pregunta abierta v1.19-1). Exposición v1.19 = **solo back-office** (M1 detalle/listado, M2 curación).
- **Dónde se ve:** M1 (`GET /admin/inventory/items[/:id]`) expone `sealedMarketRef: PriceInfo` (source `tcgcsv`) +
  el mapeo; M2 tiene la curación. Contrato en API_CONTRACT v1.19.

#### (b) Adapter `TcgcsvSealedBulkProvider` — nueva interfaz, SEPARADA del bulk de cartas

**Decisión de interfaz:** NO se reusa `BulkPriceProvider` (§4.15b). Aquella interfaz es por **carta+acabado** con
resolución `Card` (externalId / set+number) — nada de eso aplica al sellado, que se keyea por **`tcgplayerProductId`**
y no tiene carta remota que resolver. Forzarla obligaría a campos sin sentido (finish, externalId). Interfaz nueva en
`pricing.types.ts` (pseudocódigo normativo; nombres exactos los decide backend manteniendo la semántica):

```ts
interface SealedPriceRow {
  tcgplayerProductId: number;  // productId de TCGplayer/TCGCSV (clave del mapeo M-23)
  marketCents: number;         // entero > 0 (validado por el adapter); marketPrice, o midPrice si market falta (ver d)
  usedFallbackMid: boolean;    // observabilidad: true si el precio salió de midPrice
  currency: 'USD';             // TCGCSV publica SIEMPRE USD (precios TCGplayer)
}
interface SealedBulkPriceResult { rows: SealedPriceRow[]; fetchedRaw: number; skipped: number; }

interface SealedBulkPriceProvider {
  readonly source: PriceSource;  // 'tcgcsv' (M-23)
  listGroups(): Promise<TcgcsvGroupRef[]>;                          // curación M2: { groupId, name, abbreviation?, publishedOn? }
  listSealedProducts(groupId: number): Promise<TcgcsvProductRef[]>; // curación M2: { productId, name, cleanName?, imageUrl? }
  fetchSealedPricesForGroup(groupId: number): Promise<SealedBulkPriceResult>; // ingest
}
```

Implementación **`TcgcsvSealedBulkProvider`** en `backend/src/modules/pricing/providers/tcgcsv-sealed.provider.ts`:

- **Endpoints estáticos, host FIJO `https://tcgcsv.com`** (anti-SSRF, mismo patrón `PokemonTcgIoClient`):
  `/tcgplayer/3/groups`, `/tcgplayer/3/{groupId}/products`, `/tcgplayer/3/{groupId}/prices`. La **categoría Pokémon
  = 3 es CONSTANTE de servidor** (no configurable, no viene del cliente). Todo `{groupId}` interpolado en un path se
  **valida como entero positivo** server-side ANTES (nunca un string del cliente al path). **Sin API key** (no hay
  secreto nuevo). Timeout corto + sin seguir redirects fuera del host + `Accept: application/json`.
- **Filtro "sellado" en `/products` (heurística conservadora, a confirmar con fixtures/1ª corrida):** un product **sin**
  `extendedData` de carta individual (sin entradas `Number`/`Rarity`) se considera **sellado**; los que las traen son
  singles y se descartan del explorador de curación. Si la heurística falla para algún producto, la curación es manual
  de todos modos (el admin ve nombre y decide) — la heurística solo limpia la lista, no decide dinero.
- **Money-safe (misma doctrina que §4.15d):**
  - `subTypeName !== 'Normal'` → se **OMITE** la fila + cuenta en `skipped` (el sellado se pricia solo en su sub-tipo
    base; nunca se atribuye el precio de un sub-tipo raro al producto).
  - `marketPrice` (o su fallback `midPrice`) ausente / `NaN` / `<= 0` → se **OMITE**.
  - Fallo de red/parse a media corrida → devuelve lo acumulado + log; **NUNCA se borran precios previos** (quedan
    stale, que es seguro — paridad con el legacy `PokemonTcgIoBulkProvider`).
  - `lowPrice`/`highPrice` **no se persisten** (solo observabilidad/logs; un rango de mercado en DTO = fase 2).

#### (c) Mapeo producto sellado ↔ catálogo (curación manual del admin, M-23)

No existe entidad "producto sellado de catálogo": hoy el sellado es `InventoryItem(productType='sealed')` **anclado a
una `Card`** (para nombre/imagen, §3.6) + `sealedSubtype`. Se decide **NO introducir** una entidad nueva de catálogo
sellado en el MVP (sería una tercera taxonomía con sync propio); el mapeo vive **en el item**:

- **M-23 (§11):** `InventoryItem.tcgplayerProductId Int?` + `InventoryItem.tcgplayerGroupId Int?` (se fijan **juntos**;
  ambos `null` = no mapeado; solo aplican a `productType='sealed'` — regla de aplicación, no constraint de BD) +
  `@@index([tcgplayerProductId])`. El `groupId` se persiste porque el endpoint de precios de TCGCSV es **por grupo**.
- **Flujo de curación (M2, `super_admin`):**
  1. **Cola de pendientes de mapeo = consulta DERIVADA** (`productType='sealed' AND tcgplayerProductId IS NULL`),
     expuesta en `GET /admin/pricing/sealed/unmapped` — **no** requiere tabla/estado nuevo, no puede desincronizarse.
  2. El admin explora TCGCSV vía **proxy read-only server-side**: `GET /admin/pricing/sealed/tcgcsv/groups` y
     `GET /admin/pricing/sealed/tcgcsv/groups/:groupId/products` (filtrados a sellado, con `?q=` por nombre). El
     proxy existe porque el navegador no debe hablar con tcgcsv.com (CORS/consistencia/anti-SSRF centralizado).
  3. Asigna con `PUT /admin/pricing/sealed/items/:itemId/mapping` (`tcgplayerProductId`+`tcgplayerGroupId`;
     `tcgplayerProductId:null` desmapea). **`applyToSiblings?:boolean`** copia el mapeo a los demás sealed **sin
     mapeo** con el mismo `(cardId, sealedSubtype)` (las copias físicas del mismo producto). **Auditado.**
- **Sin matching automático por nombre en v1.19:** el fuzzy name-matching (nuestro `Card.name`/set vs `cleanName`
  TCGCSV) es error-prone y esto alimenta una referencia de dinero; la curación es humana. Un asistente de sugerencias
  (no auto-commit) = pregunta abierta v1.19-3.
- Los endpoints de curación funcionan **aunque el dial esté `off`** (curar no ingiere precios); solo el explorador
  llama a tcgcsv.com (read-only).

#### (d) Ingest → `PriceReference` (SIN migrar `PriceReference`) + conversión MXN

**Job propio `sealed-price-ingest`** (`backend/src/jobs/sealed-price-ingest.service.ts` + `SealedPriceIngestService`
en `modules/pricing`), **separado** de `price-ingest` (§4.15): otra interfaz (product-keyed), otro dial, otro dominio
de fallo — un TCGCSV caído no toca el pricing de singles y viceversa. `backend/src/jobs/` pertenece a este stream
mientras toque sus jobs (nota §2 / v1.18).

- **Cadencia:** **1×/día**, tras la actualización de TCGCSV (~20:00 UTC) y tras `fx-refresh` (orden **suave**, igual
  que §4.15g: `getCurrent()` degrada al último `FxRate`). Sugerido **21:30 UTC**; cron por env
  (`SEALED_PRICE_INGEST_CRON`), horario exacto = **devops**. **Single-flight** (patrón de la familia de jobs).
- **Forma de ejecución:** **secuencial y AWAITED dentro del job** — SIN fan-out BullMQ por grupo. Justificación: el
  alcance es minúsculo (solo los **grupos distintos de los items mapeados**, no todo TCGCSV; decenas de requests como
  mucho), así que el fan-out de §4.15c sería sobre-ingeniería. Si el volumen creciera, se promueve al patrón parent/child
  sin cambiar contrato.
- **Algoritmo normativo:**
  1. Lee el dial `SEALED_PRICE_SOURCE`; si `off` → **no-op logueado** (fail-closed, ver e).
  2. `SELECT DISTINCT tcgplayerGroupId` de los `InventoryItem` sealed mapeados.
  3. Carga **FX UNA vez por corrida** (`FxService.getCurrent()` → snapshot `{rate, bufferPct}`, paridad §4.15f).
  4. Por grupo: `fetchSealedPricesForGroup(groupId)` → filtra a los `tcgplayerProductId` mapeados de ese grupo.
  5. Por cada par **distinto** `(anchorCardId, tcgplayerProductId)` presente entre los items mapeados (el
     `anchorCardId` es el `cardId` del item): `priceMxnCents = usdToMxnCents(marketCents, rate, bufferPct)` (TCGCSV
     es **siempre USD** → el colchón #13 aplica en cada corrida) y **upsert idempotente** de `PriceReference` con
     clave `(cardId=anchorCardId, productType='sealed', gradeKey='sealed:tcg:<productId>', finish='normal',
     capturedDate=hoy)`, `source='tcgcsv'`, `priceUsdCents=marketCents`, `fxRate`, `fxBufferPct`.
     **Respeta `isManualOverride`** de la fila del día (paridad con `persistMarketReference`; backend reusa/parametriza
     ese método o crea uno hermano con la MISMA doctrina — no clobbear override, no escalar pendientes).
- **`gradeKey` del sellado de MERCADO = `sealed:tcg:<tcgplayerProductId>`** (helper nuevo `sealedMarketGradeKey()` en
  `pricing.types.ts`). Motivo: el legacy `buildGradeKey → 'sealed'` colisionaría en el unique cuando **dos productos
  sellados distintos** (ETB y booster box del mismo set) están anclados a la **misma** `Card`. `buildGradeKey` **NO
  cambia**: `'sealed'` sigue siendo el gradeKey del **override manual** y del costo de aportación (flujos intactos).
- **`finish` siempre `'normal'`** (las filas con `subTypeName≠'Normal'` ya se omitieron en el adapter).
- **Fallback `marketPrice → midPrice`** (con flag `usedFallbackMid`, contado/logueado): aceptable **solo aquí** porque
  esta referencia es informativa (no fija venta ni pago). Para raw/singles ese fallback **sigue prohibido**.
- **Lectura (`sealedMarketRef`):** para un item mapeado =
  `getReference(item.cardId, 'sealed', sealedMarketGradeKey(item.tcgplayerProductId), 'normal')` (misma regla "más
  reciente sin filtro de fecha" que el resto de valuaciones). Sin mapeo → `null`. En listados M1, batch vía
  `getReferencesBatch` (BE-25) para no reintroducir N+1.
- **Verificado: `PriceReference` soporta sellado SIN migración** — `productType='sealed'` ya existe en el enum,
  `gradeKey` es `String` libre, `finish` tiene default `normal` y el unique
  `(cardId, productType, gradeKey, finish, capturedDate)` aloja el nuevo esquema de gradeKey. Lo único de esquema es
  **M-23** (enum `PriceSource.tcgcsv` + 2 columnas + índice en `InventoryItem`), §11.

#### (e) Dial fail-closed `SEALED_PRICE_SOURCE` (`sealed_price_source`)

- `ConfigSetting` nueva: valores **`tcgcsv | off`**, **seed `off`** — al desplegar NO se ingiere nada (fail-closed)
  hasta que devops valide el esquema real en staging (1ª corrida manual, ver f) y **flipee el dial** (mismo patrón de
  rollout money-safe que `PRICE_PROVIDER`, §4.15h). Editable **sin redeploy** (M10); validada contra el enum
  (`422 VALIDATION_ERROR`). **Rollback = `off`**: los `PriceReference` ya escritos permanecen (informativos e inertes;
  no alimentan venta ni publicación).
- El job y el disparo manual **cortocircuitan** con `off` (`enqueued:false`/no-op logueado); la **curación de mapeos
  NO depende del dial** (mapear no mueve precios).
- **Coordinación de streams:** añadir la key a `settings.constants.ts` toca el módulo `settings` (stream «Cuentas y
  acceso») — cambio mínimo/mecánico (constante + default + validador), el **orquestador lo serializa** (precedente:
  `price_provider` en WS-A).

#### (f) Desarrollo contra FIXTURES (red de dev bloqueada) + validación en staging

- **Norma:** el adapter se desarrolla y testea **exclusivamente contra fixtures** — JSON **reales de muestra**
  (payloads verbatim de tcgcsv.com de un grupo moderno, p. ej. Surging Sparks) en **`backend/test/fixtures/tcgcsv/`**:
  `groups.json`, `products-<groupId>.json`, `prices-<groupId>.json`. Los unit tests del adapter (filtro sellado,
  omisiones money-safe, fallback mid, mapeo a `SealedPriceRow`) corren **solo** sobre fixtures; **ni dev ni CI llaman
  a tcgcsv.com** (el egress está bloqueado en dev y el test no debe depender de red).
- **Validación real = staging:** 1ª corrida manual `POST /admin/jobs/sealed-price-ingest { groupId }` con un grupo
  conocido → inspeccionar `PriceReference`/logs (¿coinciden los campos reales con las fixtures? ¿USD? ¿subTypeName?)
  → **entonces** flip del dial a `tcgcsv`. El **runbook** de esa validación es de **devops** (`DEVOPS_NOTES.md`);
  si el esquema real difiere de las fixtures, el hallazgo vuelve a backend (ajustar adapter + fixtures).

#### (g) Contrato (resumen — todo aditivo y admin-only; la superficie pública NO cambia)

Ver API_CONTRACT v1.19: enums (`PriceSource += tcgcsv`; `SealedPriceSource = tcgcsv | off`); §M1 (campos read-only
`tcgplayerProductId`/`tcgplayerGroupId`/`sealedMarketRef` en items sellados); §M2 (subsección TCGCSV:
`unmapped` / `tcgcsv/groups` / `tcgcsv/groups/:groupId/products` / `PUT .../items/:itemId/mapping`); §M10
(`sealedPriceSource`); §M10-ops (job `sealed-price-ingest` con `groupId?`). Ningún endpoint público ni DTO de
cliente cambia (ficha de Compra, holdings, buylist: intactos).

---

### 4.20 WS «Inventario y vault» — Master set en todas partes (v1.20-master-set-everywhere)

**Objetivo.** El binder Master Set (§4.17) demostró ser la superficie correcta para "ver un set de un vistazo".
v1.20 lo convierte en el **read model único de "contenido agrupado por set y por acabado"**, parametrizado por
**scope**, para tres consumidores: M1 (inventario de plataforma), soporte/operación (bóveda de un cliente vista por
admin) y el propio cliente ("Mi bóveda" como colección). Un solo servicio, un solo shape; cambia el **filtro de
agregación** y las **omisiones por permiso**. Contrato: `API_CONTRACT.md` Changelog v1.20 (§0/§DTOs/§3/§M1).

**#### 4.20a Read model por scope (backend: `MasterSetService`).**
- `MasterSetService.index()/binder()` ganan un parámetro de scope:
  `type MasterSetQueryScope = { kind: 'platform' } | { kind: 'user_vault', userId: string }`.
  El scope SOLO cambia el `WHERE` de la agregación de `InventoryItem`:
  - `platform` → `ownerType='platform' AND status NOT IN NOT_ON_HAND` (regla v1.16 intacta).
  - `user_vault` → `ownerType='customer' AND ownerUserId=:userId AND status NOT IN NOT_ON_HAND` (piezas del usuario
    **en bóveda**; ambas titularidades `pending|settled` — es su colección, la titularidad afecta retiro, no vista).
  Todo lo demás (queries fijas sin N+1, orden natural, `isSecretRare`, `numberSort`) se **reusa sin duplicar**.
- **Controllers:** `MasterSetController` (M1, existente) + nuevos `AdminVaultsController`
  (`/admin/vaults`, `vault_operator+`, módulo `vault`) y rutas `GET /vault/master-sets[...]` en `VaultController`
  (`customer`, siempre `userId = el autenticado` — **jamás** un userId del request en la vista (iii)).
- **Índice en scope `user_vault`:** solo sets con ≥1 pieza del usuario (el catálogo completo como índice es ruido
  para un cliente); el binder de **cualquier** set sigue accesible por `:setId` (los huecos son sus faltantes).
- **Omisiones por scope (regla dura de DTO):** el shape compartido nunca lleva ubicación física, costos, folios ni
  ownerUserId de terceros; `owner` solo en `user_vault` (con `email` solo en la vista admin); `buyable` solo en la
  vista (iii). Las acciones de escritura (batch/bulk-publish/adjustments) son **solo** rutas `/admin` de scope
  plataforma — el binder de cliente y el de la vista admin de bóveda son **lectura pura**.

**#### 4.20b Completitud por VARIANTE (carta+acabado).**
- **Casilla = variante = `(Card, finish)`** con `finish ∈ Card.availableFinishes`. Una carta en `normal` y
  `reverse_holo` son **2 casillas**; los contadores «X/Y» cuentan **variantes**, no cartas.
- **Universo esperado — regla explícita:** el catálogo **SÍ declara** los acabados esperados por carta:
  **`Card.availableFinishes`** (M-18). **No se inventa una regla derivada nueva**: es el mismo campo que ya funge de
  lista blanca SEC-A1 del `finish` en quote/alta.
  - **v1.22 (CORRECCIÓN):** la frase «hoy poblado por el price-ingest v1.14 (§4.15e)» queda **derogada**. El campo lo
    puebla **solo el sync de catálogo** (§3.7 / §4.22a); `price-ingest` **no lo escribe**. Consecuencia directa para
    este binder: el denominador de completitud ya **no** encoge cuando el proveedor de precios no trae precio de un
    acabado — deja de haber cartas de dos variantes que se muestran con una sola casilla.
- **Drift:** una pieza cuyo `finish` ya no esté en `availableFinishes` se muestra en `countsByFinish` (es una pieza
  real) pero **no** cuenta en expected/covered — evita `covered > expected` y deja visible la inconsistencia.
- **Nota (v1.42 — BLOQ-3, DEROGA el comportamiento v1.16 SOLO para sellado):** el binder es la colección de **singles**.
  La cobertura/conteo (`countsByFinish`/`totalCount` de la celda, `count`/`covered` de la variante y sus agregados X/Y, y
  `distinctCardsOwned`/`totalPieces`/`completionPct` del índice) cuentan **SOLO singles** (`productType ∈ {raw, graded}`) —
  **`productType='sealed'` se EXCLUYE** en los 4 scopes del binder (M1 plataforma, bóveda admin (ii), «Mi bóveda» (iii)).
  Un ETB anclado a Charizard ya **no** infla a Charizard como `finish=normal` ni marca su variante `covered`. Alinea con
  **H9** (el sellado ya se excluye del catálogo de singles): el sellado vive en sus superficies dedicadas (M1 › «Sellado»
  = `sealed-sets` §4.26g; bóveda › «Sellado» = `/vault/sealed`). **Esto RESUELVE la pregunta abierta WS-IV-1 (§10) para el
  sellado**, por mandato explícito del humano (matar «Tropius» en todas las vistas). `graded` **sigue contando** (un slab es
  una copia real del single de esa `cardId`; WS-IV-1 permanece abierta solo para graded). Es un filtro más en la MISMA
  agregación (`productType != 'sealed'`), sin cambio de shape ni de queries por request.
- **Costo de cómputo:** los campos nuevos salen de las MISMAS agregaciones v1.16 (`groupBy [cardId, finish]`) +
  `availableFinishes` ya presente en la query de cartas; el índice suma una agregación de `Σ|availableFinishes|`
  por set (raw SQL sobre `Card`). Sigue O(1) queries por request.

**#### 4.20c Lista de clientes con bóveda (`GET /admin/vaults`).**
Agregación por usuario (`ownerType='customer'`, status en bóveda) → `pieceCount` + valuación de la página con
**la misma base del portafolio** (§3, `PriceReference` vigente por acabado, vía `getReferencesBatch` — §4.17c):
piezas sin precio se excluyen del total y se cuentan en `pendingPriceCount`. Identificación mínima
(`name`/`email`, misma exposición que el listado M6 para `vault_operator`); **nunca** PII sensible. Orden
`value_desc | pieces_desc | name_asc`, paginado. Cada fila enlaza a la vista (ii) (`/admin/vaults/:userId/master-sets`).

**#### 4.20d Faltantes comprables (`buyable`, solo vista (iii)).**
Para las variantes `covered=false` del binder del cliente, **una** query adicional resuelve por `(cardId, finish)`
la pieza de plataforma `status='listed'` con **menor precio de venta** — **v1.42 (BLOQ-3b): SOLO un single**
(`productType ∈ {raw, graded}`; **sellado EXCLUIDO** — ya no se ofrece un ETB sellado para llenar la casilla de un single,
mata «Tropius» en el faltante; resuelve WS-IV-2 para sellado). Mismo criterio de precio de la ficha §4.9:
`listPriceCents` override o derivado por reglas de venta §4.14 — el binder expone el `salePriceCents` ya resuelto;
si el precio no resuelve, esa pieza no es buyable). El CTA del front lleva a la ficha
(`GET /catalog/listings/:inventoryItemId`) y al **checkout normal** — el binder **no** crea órdenes ni reservas.
`buyable` se **omite** en los scopes admin (allí el binder es operación, no compra).

**#### 4.20e Ajuste de inventario por levantamiento físico (M1).**
- **Flujo:** el operador abre la celda del binder M1, compara sistema vs físico y registra el ajuste
  (`POST /admin/inventory/adjustments`) con **motivo obligatorio** `AdjustmentReason =
  encontrada | perdida | danada | error_captura`:
  - `encontrada` → crea pieza(s) nuevas reusando la lógica de alta (`inventory.service.create` /
    `BatchInventoryItemInput`; `acquisitionType` default `aportacion_en_especie`, con su `PRICE_PENDING` normal).
  - `perdida | danada` → `status → lost | damaged` (conecta con reposición/merma M7 + tope M10, igual que `mark`).
  - `error_captura` → `status → withdrawn`: sale del on-hand **sin** semántica de pérdida (no dispara reposición ni
    infla mermas); el motivo real queda tipado en `InventoryAdjustment.reason`. **Decisión:** se reusa `withdrawn`
    en vez de añadir un `InventoryStatus` nuevo — el enum de status es zona compartida transversal (Compra, M4,
    bulk-publish, contracargo) y un valor nuevo obligaría a revisar todos esos switches; la distinción
    "error de captura vs retiro" vive en `InventoryAdjustment`/`AuditLog`, que es donde se reporta.
  - **Guardarraíles:** solo piezas `ownerType=platform` con status ∈ `{in_stock, listed}` son ajustables
    (`422 ITEM_NOT_ADJUSTABLE` en el resto — una pieza `reserved`/vendida/en custodia/enviada se resuelve por su
    flujo dueño: M3/M4/`mark` de custodia). **NO hay venta directa manual desde el binder**: el ajuste no puede
    reservar/vender; toda salida de venta va por órdenes (checkout Stripe/M3). No es money-out.
- **Registro triple (auditoría con usuario y timestamp):** (1) fila `InventoryAdjustment` (M-24: motivo tipado,
  from/to status, actor, note — consultable para reportes de merma/levantamiento M7/M9); (2) `InventoryMovement`
  con el nuevo `MovementReason.adjustment` (el historial de la pieza distingue ajuste de operador vs mark normal);
  (3) `AuditLog action=inventory.adjustment` (bitácora global M10). `mark` existente queda para el flujo no-binder
  (incl. custodia de clientes); el ajuste es el camino normado del levantamiento físico.
- **Schema (decisión, migración M-24 — ver §11):** enum `AdjustmentReason`, valor nuevo
  `MovementReason.adjustment`, y modelo `InventoryAdjustment` (tabla propia y NO solo `AuditLog`, porque el motivo
  debe ser **tipado y consultable** para reportes, mientras `AuditLog` es texto/JSON de bitácora). Aditiva, sin backfill.
- **Aclaración v1.20.1-adjustments-clarify (respuesta plural + idempotencia; contrato §M1):** dos ambigüedades
  enrutadas por techlead/QA tras los gates del stream (BACKEND_NOTES §45.4, deuda BE-47):
  - `InventoryAdjustmentResponse.adjustmentIds: string[]` **sustituye** al singular `adjustmentId`: con
    `encontrada` y `qty>1` M-24 crea **una fila por pieza** y el singular obligaba a devolver solo la primera.
    Ahora se devuelven todas, alineadas 1:1 con `inventoryItemIds`/`folios`. **Sustitución limpia, sin campo
    deprecated** (sin clientes externos; el frontend propio no navega por ese id).
  - `batchKey?` opcional **solo en el camino `encontrada`** con la **misma** semántica de idempotencia que el alta
    por lote: reusa el mecanismo `InventoryBatch` (M-21, **sin migración nueva**); replay → respuesta original con
    `idempotentReplay: true` (cierra BE-47: el doble submit ya no duplica piezas). Los otros motivos no lo
    necesitan: operan un id concreto y su replay cae en `422 ITEM_NOT_ADJUSTABLE` (idempotencia natural).

**#### 4.20f Frontend — promoción del binder a componentes compartidos.**
Los componentes de master set viven hoy en `frontend/src/app/[locale]/(admin)/admin/m1/master-set/`
(`MasterSetIndex.tsx`, `MasterSetBinder.tsx`, `MasterSetPanel.tsx`, `CellDrawer.tsx`, `PerLineErrors.tsx`,
`capture.ts`). Con tres consumidores (M1, admin-bóveda-cliente, Mi bóveda) **se promueven a
`frontend/src/components/master-set/`** (zona compartida — **reservada por este work stream** mientras dura la
promoción; ningún otro stream la toca en paralelo). Reglas:
- El componente se parametriza por **scope/capacidades vía props** (`scope`, `readOnly`, `showBuyable`,
  `onAddToCapture?`, `onAdjust?`): las acciones de captura/publicación/ajuste solo se montan en M1; el CTA de
  compra (`buyable`) solo en la vista del cliente. El componente **no** decide permisos: renderiza lo que el DTO
  trae (el backend ya omitió campos por scope — defensa en el dato, no en el if del front).
- Lo específico de M1 (carrito de captura, `capture.ts`, `PerLineErrors`) puede quedarse bajo `(admin)/admin/m1/`
  si solo M1 lo usa; lo que se comparte (índice, binder, celda, drawer de variantes) se mueve. Los imports de
  `M1View` se actualizan a la nueva ruta (trabajo de **frontend**, no del arquitecto).

#### Reparto de trabajo (v1.20)
- **Backend:** (1) parametrizar `MasterSetService` por scope + campos de variante; (2) `GET /vault/master-sets[...]`
  (customer) y `GET /admin/vaults[...]` (vault_operator+); (3) `buyable` (query de mínimos por `(cardId, finish)`);
  (4) `POST /admin/inventory/adjustments` + migración M-24; (5) tests: mismos shapes en 3 scopes, omisiones por
  scope (nunca ubicación/costo/folio; `buyable` solo (iii)), contadores de variantes vs cartas, drift de
  `availableFinishes`, `ITEM_NOT_ADJUSTABLE`, `error_captura` no dispara reposición, no-venta-desde-binder.
- **Frontend:** (1) promover componentes a `components/master-set/` (§4.20f); (2) "Mi bóveda" gana la pestaña/vista
  master set con X/Y por variantes y CTA de faltantes comprables; (3) vista admin `/admin/vaults` (lista + binder de
  cliente, read-only); (4) drawer de ajuste en la celda M1 (motivo obligatorio, nota).
- **QA/techlead:** doble veredicto por stream (no toca dinero saliente); E2E: cliente ve su set con variantes
  cubiertas/faltantes y compra un faltante vía checkout; admin lista bóvedas y abre el binder de un cliente;
  ajuste `perdida`/`encontrada`/`error_captura` deja `InventoryAdjustment` + movement + audit.

---

### 4.21 WS «Órdenes y dinero» — Guest checkout: comprar sin cuenta (v1.21-guest-checkout)

> **PROJECT §J / §J.1 / criterios 45–56b.** Contrato completo (endpoints, DTOs, diff de esquema campo por campo) en
> **API_CONTRACT §4-G**. Aquí vive el **por qué**: la ruta de fulfillment nueva, el ciclo de vida de los items y el
> modelo de amenazas del enlace tokenizado.

#### (a) El problema real: hoy no existe «envío vs bóveda»

Lo que parece "quitar el login del checkout" es en realidad **construir una segunda ruta de fulfillment**. Estado
verificado del código antes de esta versión:

| Pieza | Comportamiento actual | Por qué bloquea al invitado |
|---|---|---|
| `OrdersService.createSession` | Reserva cada `InventoryItem` con `status='reserved'`, **`ownerType='customer'`, `ownerUserId=userId`**, `ownershipStatus='pending'` | Necesita un `User`. Un invitado no lo tiene, y `ownerUserId=null` con `ownerType='customer'` rompería la definición de bóveda (holdings, portafolio, snapshots, master set por usuario). |
| `PaymentsService.onPaymentSucceeded` | Pasa el item a **`status='in_custody'`, `ownershipStatus='settled'`** | Deposita en bóveda. Para un invitado no hay bóveda donde depositar. |
| `ShipmentsService.create` | Exige `ownerUserId === userId`, `ownershipStatus='settled'`, `status='in_custody'`, una **`Address` guardada del usuario**, y crea **su propio PaymentIntent** con `shippingFeeCents` | Triple bloqueo: sin usuario, sin bóveda y sin dirección guardada. Y el invitado **no puede pagar un segundo PI**: no tiene desde dónde iniciarlo. |
| `Order.userId` / `ShipmentRequest.userId` | `String` **NOT NULL** con FK a `User` | El cambio de esquema es **inevitable**; este stream es su caso legítimo. |

De ahí las tres decisiones estructurales: **(1)** un modo de fulfillment explícito en la orden, **(2)** dirección
**capturada en línea** como *snapshot* (no una fila `Address`), **(3)** el envío se cobra **dentro del mismo
`PaymentIntent`** de la orden. No es una optimización: es la única forma de que el invitado pague una sola vez.

#### (b) Ruta de fulfillment `direct_ship` (nueva) vs `vault` (la de siempre)

```
                       ┌──────────────── fulfillmentMode ────────────────┐
                       │                                                 │
             vault (DEFAULT, requiere cuenta)              direct_ship (invitado, v1.5)
                       │                                                 │
 POST /checkout/session (customer)                 POST /checkout/guest/session (public)
   items → ownerType=customer, ownerUserId,          items → SIGUEN ownerType=platform,
           ownershipStatus=pending, reserved                 ownerUserId=null, reserved
   PI = cartas + IVA + fee                           PI = cartas + ENVÍO + IVA + fee   ← una sola vez
                       │                                                 │
 webhook succeeded                                  webhook succeeded
   items → in_custody / settled  (BÓVEDA)             items → picking (siguen de plataforma)
                       │                              + se CREA ShipmentRequest(orderId, userId=null,
                       │                                status='picking', montos 0)
                       │                              + correo con enlace tokenizado (best-effort)
                       │                                                 │
 POST /shipments (customer, SEGUNDO PI)             (no aplica: ya está pagado y encolado)
   ShipmentRequest(userId, addressId guardado)
                       │                                                 │
 M4: picking→guia→enviado→entregado                 M4: picking→guia→enviado→entregado (MISMA cola)
   entregado ⇒ item in_custody → withdrawn            enviado   ⇒ item picking → shipped
                                                      entregado ⇒ item shipped → delivered
```

**Por qué el envío del `ShipmentRequest` de invitado va en `0`:** el P&L de M7 suma `ShipmentRequest.shippingFeeCents`
de los envíos liquidados. Si el envío directo repitiera ahí la tarifa ya cobrada en la orden, **el ingreso se
contaría dos veces**. El ingreso vive en `Order.shippingFeeCents` (única fuente) y el envío de fulfillment queda en
`0`; el **costo** real del carrier (`shippingCostCents`) se sigue capturando en M4 igual para los dos tipos, así que
el lado del costo no cambia. La fórmula corregida de M7 está normada en API_CONTRACT §12.

#### (c) Ciclo de vida de los items en un pedido de invitado

**Decisión de fondo: la titularidad del invitado NO se modela.** Un invitado no tiene bóveda, no tiene portafolio y
no tiene retiros; modelarle una "titularidad" obligaría a `ownerType='customer'` con `ownerUserId=null`, y ese par
es exactamente lo que rompería todas las consultas de bóveda existentes (holdings, `PortfolioSnapshot`, master set
`scope=user_vault`, ficha 360°, `classifyItems`). Se elige lo contrario: **el item sigue siendo de la plataforma
hasta que sale por la puerta**, y todo el ciclo lo expresa `status`.

```
listed | in_stock
   │  POST /checkout/guest/session
   ▼
reserved        ownerType=platform · ownerUserId=null · ownershipStatus=null
   │  payment_intent.succeeded  (Order settled)
   ▼
picking         vendida y en preparación (aún físicamente en el almacén)
   │  M4: PATCH .../status → enviado
   ▼
shipped         salió físicamente
   │  M4: PATCH .../status → entregado   (deliveredAt ancla la ventana de disputa de 7 días)
   ▼
delivered       TERMINAL de una venta con envío directo   (NO `withdrawn`)

Reversos:
  payment_failed | canceled  → reserved → listed              (Order failed; nada que revertir de titularidad)
  chargeback                 → ver §4.21c-bis (NO basta mirar el item: hay que mirar el ENVÍO)
```

#### (c-bis) Contracargo de un pedido `direct_ship` — el envío manda (T1, corrección normativa v1.21.2)

**El hueco (real, verificado en código).** La v1.21 describió el reverso del contracargo **solo en términos del
`InventoryItem`** y no dijo nada del `ShipmentRequest`. Backend implementó lo que decía la norma, y el resultado es
un **double-sell físico**:

1. `settleDirectShipOrder` crea el envío en **`picking`**.
2. `onChargeDispute` decide "¿ya salió?" buscando un `ShipmentItem` cuyo envío esté en `enviado|entregado`. Un envío
   en **`picking`** o **`guia` NO coincide** ⇒ cae en la rama "sigue en bóveda".
3. Esa rama pone el item en `listed` / `platform` ⇒ **vuelve a ser comprable**.
4. El `ShipmentRequest` **no se toca** ⇒ sigue en `picking` ⇒ **`pickingList()` lo sigue mostrando al operador**.

Resultado: la **misma pieza única** puede venderse a un segundo comprador **mientras el operador la está metiendo en
la caja del contracargo**. `ITEM_IN_ANOTHER_SHIPMENT` (SEC-H2) no protege aquí: solo cubre `POST /shipments`, no el
checkout. En la ruta de bóveda esto era inocuo (una orden liquidada no tenía envío colgando); en `direct_ship`
**siempre lo tiene por construcción**, así que es un daño colateral directo de la ruta de fulfillment que introdujo
este stream.

**El invariante que se violaba (y que ahora es norma explícita):**
> **Una pieza con un `ShipmentItem` en un envío NO terminal jamás puede estar en `{listed, in_stock}`.**
> Ninguna automatización puede devolver a la venta una pieza cuya ubicación física está comprometida con una
> operación de fulfillment viva.

**Norma: el contracargo NUNCA re-lista automáticamente una pieza con envío vivo. La congela y la escala a un
humano.** Tabla normativa por estado del envío en el momento de `charge.dispute.created`:

| Envío del pedido | `ShipmentRequest` | `InventoryItem` | `chargebackNeedsManual` |
|---|---|---|---|
| **No existe** (orden `pending`, item `reserved`) o **`cancelado`** | — | `reserved → listed`, `ownerType=platform` (+ movimiento `chargeback_return`) | `false` — cerrado automáticamente, la pieza nunca salió del estante |
| **`solicitado` \| `picking` \| `guia`** (NO terminal) | **→ `cancelado`**, en la **MISMA transacción** (sale de `pickingList()` de inmediato: ese query filtra `status:'picking'`) | **CONGELADO**: se queda en `picking`. **NO** se re-lista, **NO** cambia `ownerType`. Fuera de venta por construcción (`picking ∉ {listed, in_stock}`) | **`true`** — lo resuelve un humano (abajo) |
| **`enviado` \| `entregado`** | sin cambio (histórico) | sin cambio (`shipped` / `delivered`) | **`true`** (comportamiento v1.21, sin regresión) |

**Por qué congelar en vez de auto-cancelar-y-re-listar** (que era la otra opción obvia para el caso `picking`):
- Re-listar es una **acción automática que vuelve a vender**. Dispararla a partir de un evento que significa
  "algo salió mal con el dinero", y encima mientras hay una caja abierta en la mesa del operador, es precisamente
  la clase de automatismo que produce pérdidas reales (vender dos veces, enviar al defraudador y tener que
  compensar al segundo comprador).
- **Un contracargo no es prueba de nada todavía**: podemos ganar la disputa (`funds_reinstated`), y entonces la
  venta era legítima y la carta tenía que salir. Liberarla al inventario al primer aviso presume el peor caso y
  destruye la posibilidad de completar el envío.
- **`guia` no es lo mismo que `picking`**, y esa diferencia es justo la que una regla automática no puede resolver:
  con etiqueta generada el paquete suele estar **armado y esperando al mensajero**. La única fuente de verdad sobre
  dónde está físicamente la carta es **el operador mirando el estante**. Por eso el desenlace es una **confirmación
  humana**, no una heurística de estados.
- Se prefiere **una sola regla** ("envío vivo ⇒ congelar") a una regla partida por estado: en dinero e inventario,
  la uniformidad vale más que ahorrarle un clic al operador en un evento tan raro como un contracargo.
- **Reusa `ShipmentStatus.cancelado`** (ya existe y ya significa "envío que no se va a ejecutar"): **cero valores
  de enum nuevos, cero migración**.

**Desenlace humano — `POST /api/v1/admin/orders/:id/chargeback-inventory`** (`vault_operator+`, auditado; contrato
en API_CONTRACT §M3). Es la pieza que faltaba: sin ella una pieza congelada se queda congelada para siempre.
Tres desenlaces, todos con `note` obligatoria y todos dejando `chargebackNeedsManual=false`:
- **`recuperada`** — el operador confirma que tiene la carta ⇒ `picking|shipped → listed` (o `in_stock` si su precio
  no resuelve), `ownerType=platform`, movimiento **`chargeback_return`**. Vuelve a la venta **con respaldo físico**.
- **`no_recuperada`** — la carta ya no está (salió, o se entregó al defraudador) ⇒ **sin** movimiento de inventario;
  el item se queda donde está (`shipped`/`delivered`, terminal de venta). La pérdida queda reflejada en la orden
  `chargeback` para M7. **No** se marca `lost`/`damaged`: no fue merma de almacén y ensuciaría los reportes de
  pérdida (mismo cuidado que llevó a usar `delivered` en vez de `withdrawn`).
- **`reexpedir`** — solo válido si **ganamos la disputa** (la orden volvió a `settled` por
  `charge.dispute.closed`/`funds_reinstated`) y la pieza sigue congelada ⇒ se crea un `ShipmentRequest` **nuevo**
  con la misma forma que el del settle (`orderId`, `userId=null`, `status='picking'`, montos en `0`,
  `addressSnapshot` de `Order.shippingAddressSnapshot`) y el item sigue en `picking`. Cierra el agujero silencioso
  de "ganamos la disputa pero el envío ya estaba cancelado". Cualquier otro estado ⇒ **`409 CONFLICT`**.

> **Errata corregida en v1.21.2:** este párrafo decía `422` y contradecía a API_CONTRACT §M3, que dice **`409`**.
> **Manda el contrato** (regla de conflicto) y además `409` es lo correcto: el cuerpo `{outcome:'reexpedir', note}`
> está **bien formado y es válido** —no hay nada que el cliente pueda corregir en la entrada—; el obstáculo es
> **100 % el estado del recurso**, que es la definición de `409`. Es además el mismo código que el endpoint ya usa
> para "orden ya resuelta" (idéntico tipo de obstáculo: partirlos obligaría al front a ramificar dos códigos para
> pintar un solo mensaje), y respeta la convención del proyecto: **`409` = conflicto de estado**
> (`ITEM_UNAVAILABLE`, `ITEM_IN_ANOTHER_SHIPMENT`, `ALREADY_AUTHENTICATED`) frente a **`422` = rechazo de la
> entrada** (`PRICE_PENDING`, `ADDRESS_NOT_MX`, `VAULT_REQUIRES_ACCOUNT`). Backend implementó `409` y reportó sin
> auto-resolver: correcto. **Ningún cambio de código.**

**Cierre de la disputa (`charge.dispute.closed` / `funds_reinstated`) — precisión v1.21.2:** ganar **NO** re-expide
automáticamente. La orden vuelve a `settled` (`disputeOutcome='won'`) y **`chargebackNeedsManual` se mantiene en
`true`** para que el caso siga visible en la cola de M3 hasta que un humano confirme si la carta sigue ahí y pulse
`reexpedir`. Automatizar la re-expedición volvería a presuponer una realidad física que nadie ha comprobado.

**REQUISITO PENDIENTE — el desenlace humano necesita una interfaz humana (v1.21.2, hallazgo de QA).** Esta norma
crea deliberadamente un estado que **solo una persona puede cerrar**, pero hoy `chargebackNeedsManual` **no se
consume en ningún lado del front** (`grep chargebackNeedsManual|chargeback-inventory frontend/src/` ⇒ **cero**; el
campo ni siquiera está en los tipos del contrato del front). Consecuencia operativa: el operador **no puede ver que
hay una pieza congelada** salvo llamando a la API a mano, así que en la práctica **la pieza se queda congelada** y
el inventario se degrada en silencio — exactamente el fallo que el congelamiento pretendía evitar, movido de sitio.
Se registra como **requisito normativo de la feature, no como defecto de este stream**:

- **Dueño: work stream «Admin y auditoría»** (M3 es suyo; el backend de §4.21c-bis ya está y es de este stream).
- **Alcance mínimo:** (1) `chargebackNeedsManual` y `disputeOutcome` en los tipos del contrato del front;
  (2) **cola visible** de "contracargos por resolver" en M3 —para eso se añade el filtro
  `GET /admin/orders?needsManual=true` (API_CONTRACT §M3)— con badge en el dashboard;
  (3) formulario del desenlace (`recuperada | no_recuperada | reexpedir`) con **`note` obligatoria** y confirmación
  explícita, mostrando qué piezas (folio + carta) están congeladas.
- **Criterio de cierre:** mientras no exista, **el flujo de contracargo de `direct_ship` NO puede declararse
  operable** en el DoD del proyecto, aunque el backend esté verde. QA debe reflejarlo así en su veredicto de
  release (no en el veredicto por-stream de «Órdenes y dinero», que sí puede cerrar).

**Motivos de `InventoryMovement` (v1.21.1, normativo — sin valores nuevos en `MovementReason`):** `settle` para
`reserved → picking` (mismo evento y misma causa que `reserved → in_custody` de la ruta de bóveda; lo que cambia es
el destino, no el motivo) y **`sale`** para `picking → shipped` y `shipped → delivered` (salida física y cierre de
la venta). **`withdrawal` queda prohibido** en esta ruta: significa "retiro de la bóveda de un cliente" y ensuciaría
los reportes de custodia, exactamente el mismo cuidado que llevó a usar `delivered` en vez de `withdrawn`. Las dos
filas `sale` se distinguen por `fromStatus`/`toStatus`, así que no hace falta un motivo "entregado". La liberación
de reserva por pago fallido **no** registra movimiento, igual que hoy en la ruta con cuenta (sin asimetría nueva).

Tres consecuencias que se declaran de forma explícita para que nadie las "arregle" después:
1. **No hace falta ningún valor nuevo en `InventoryStatus`.** `picking | shipped | delivered` estaban **sin uso por
   diseño** desde v1.17 (el retiro de bóveda no los escribe; §3.3) y sus nombres describen exactamente estos tres
   momentos. Reusarlos evita tocar un enum transversal — mismo criterio con el que v1.20 hizo que `error_captura`
   reusara `withdrawn`.
2. **`delivered` ≠ `withdrawn`.** `withdrawn` significa "salió de la bóveda de un cliente". Un pedido de invitado
   nunca estuvo en bóveda, así que usar `withdrawn` mentiría en los reportes de custodia. M4 **ramifica** por
   `ShipmentRequest.orderId != null`.
3. **Los guardarraíles anti double-sell ya cubren los tres estados nuevos** sin tocarlos: el checkout exige
   `{listed, in_stock}`, `bulk-publish` devuelve `ITEM_NOT_PUBLISHABLE` fuera de `{in_stock, listed}` y el ajuste
   de M1 devuelve `ITEM_NOT_ADJUSTABLE` fuera de `{in_stock, listed}`. **Cero cambios en módulos de otros streams.**

**Efecto conocido y aceptado en los conteos de M1:** una pieza `reserved`/`picking` de un pedido de invitado sigue
siendo `ownerType='platform'` y por tanto cuenta como *on-hand* en el master set de plataforma hasta pasar a
`shipped`. Es coherente con el criterio físico de ese contador (la carta está en el almacén) y con que `reserved`
ya contaba; **no** se cambia la regla *on-hand* de §4.17/§4.20 (es de otro work stream).

#### (d) `ShipmentRequest` con dos naturalezas — por qué no se creó un modelo nuevo

Se evaluó crear un `GuestShipment` separado. Se descarta: duplicaría la cola de M4, la lista de picking, la captura
de guía, la máquina de estados y los reportes, para representar **la misma operación física** (meter cartas en una
caja y darle una guía). La diferencia real es de **origen y de cobro**, no de operación. Por eso:
`ShipmentRequest.userId` nullable + `orderId?` como **vínculo** (`orderId == null` ⇔ retiro de bóveda), y M4 opera
una sola cola. La única bifurcación de comportamiento está en la transición terminal (§c).

**Discriminador canónico — corrección normativa v1.21.2 (D4).** La implementación quedó con **dos** discriminadores
para el mismo concepto: `payments` decide por `Order.fulfillmentMode === 'direct_ship'` y `shipments` por
`ShipmentRequest.orderId != null`. Hoy coinciden, pero **no preguntan lo mismo**, y con un tercer modo con envío
(p. ej. `pickup_in_store`) el segundo lo clasificaría como envío directo **en silencio** — el peor tipo de fallo.
Norma:

1. **`ShipmentRequest.orderId` responde SOLO a "¿de dónde viene este envío?"**: `null` ⇒ **retiro de bóveda**;
   poblado ⇒ **fulfillment de una orden**. Ese uso es exhaustivo y correcto para separar las dos colas.
2. **El COMPORTAMIENTO (transiciones terminales del item, `kind` del DTO, cualquier rama futura) se decide SIEMPRE
   por `Order.fulfillmentMode`**, resuelto con un join a la orden vinculada. `fulfillmentMode` es el **único
   discriminador canónico de ruta de fulfillment** de todo el sistema.
3. Ese `switch` debe ser **exhaustivo y ruidoso**: un `fulfillmentMode` no soportado por M4 **lanza y se loguea**
   (`500`/alerta), **nunca** cae por default en la rama `direct_ship`. Un modo nuevo debe **romper visiblemente** en
   el punto exacto donde falta decidir su terminal, no comportarse como otro modo.
4. `vault` con `orderId != null` es una **combinación imposible** por invariante (un pedido a bóveda no genera
   `ShipmentRequest` de fulfillment; su retiro nace del cliente y va sin `orderId`): si aparece, es corrupción de
   datos y debe tratarse como el caso (3), no "arreglarse" silenciosamente.

#### (e) Modelo de amenazas del enlace tokenizado

El enlace **sustituye a una contraseña**: quien lo tiene, ve el pedido. El diseño ataca cada vector por separado.

| # | Amenaza | Mitigación | Residual |
|---|---|---|---|
| T1 | **Adivinar/enumerar tokens** | 256 bits de entropía (`randomBytes(32)`), lookup por `SHA-256 @unique` (no hay comparación parcial ni prefijos), rate limit 20/min por IP | Nulo en la práctica (2^256). |
| T2 | **Enumerar pedidos por id o número** | El token es la **única** llave; la vista pública **no expone el uuid** del pedido y **no existe** endpoint público de búsqueda por número/correo (criterio 52). El `orderNumber` es secuencial pero **no da acceso** (solo sirve, junto al correo, para pedir un reenvío que va al correo del pedido) | Un tercero puede estimar el volumen de ventas a partir de un `orderNumber` que le muestren. Aceptado. |
| T3 | **Oráculo "¿este correo compró aquí?"** | El reenvío exige `(email + orderNumber)` juntos, responde **`202` siempre** y envía **solo** a `Order.guestEmail`. El checkout **nunca** consulta `User` por correo. `GET /orders/claimable` solo habla del correo **verificado** de quien pregunta | Ninguno conocido. |
| T4 | **Fuga del token por `Referer` / logs / historial** | Token en el **body de un POST**, no en la ruta; página `noindex` + `Referrer-Policy: no-referrer`; el front borra el token de la URL (`history.replaceState`); prohibido loguear bodies de `/orders/guest/*` | El token pasa por el correo y por la URL inicial. Inevitable en un enlace por correo (mismo modelo que un reset de contraseña). |
| T5 | **Fuga por dump/backup de BD** | En BD solo vive el **SHA-256**. Un dump **no** produce enlaces utilizables. *(Esta es la razón principal para NO usar un JWT: un JWT robado del correo es igual de malo, pero además la fuga del **secreto de firma** permitiría fabricar tokens para pedidos arbitrarios.)* | Ninguno. |
| T6 | **Reenvío del correo a un tercero / dispositivo compartido** | `GuestOrderTrackingDTO` de **datos mínimos** (§4-G.3): sin dirección completa, sin correo/teléfono, sin PAN, **sin ninguna acción**. El daño máximo es *ver* qué compró alguien | Aceptado explícitamente por PROJECT §J. |
| T7 | **Token vivo para siempre** | TTL 90 días, **rotación** al reenviar (solo el último vale), **revocación** al reclamar y por soporte, y tope de edad de la orden (365 días) para emitir nuevos | Ventana de 90 días. Revisable por el humano. |
| T7b | **Puertas duplicadas por pedido** (v1.21.1) | El claro del token es irrecuperable (solo hay hash), así que el correo del settle lleva **otro** token y durante un rato **coexisten dos**. Se acota haciendo el token de **checkout de vida corta (120 min)** frente al de **correo (90 días)**: pasadas 2 h queda **una sola** puerta duradera. El settle **no rota** (rotar mataría la confirmación post-3DS en curso); reenvío y soporte **sí** rotan y revocan **todos** los vivos | Solapamiento de ≤2 h. La alternativa descartada —dos tokens de 90 días— **duplicaba la exposición durante tres meses** sin beneficio. Ver §4.21e-bis. |
| T8 | **Escalada del token a acciones** | El token **no** es credencial: no se acepta en `Authorization`, no crea sesión, no otorga rol y solo lo leen los endpoints `/orders/guest/*`. Ninguna mutación acepta token | Ninguno. |
| T9 | **DoS de inventario con pedidos no pagados** | Rate limit 5/hora por IP, tope de 20 líneas por pedido, y **job de barrido** `guest-order-sweep` que libera reservas de órdenes `pending` con más de `GUEST_ORDER_RESERVATION_TTL_MIN` (60 min) y cancela su PI | Ventana de 60 min de inventario retenido por un atacante. El barrido **también** beneficia a los pedidos con cuenta (hoy dependen solo de que Stripe cancele el PI). |
| T10 | **Fraude con tarjeta sin historial de usuario** | Fuera del alcance técnico: se cubre con el flujo de contracargo existente (§9 API_CONTRACT). PROJECT deja abierto si el humano quiere un **tope de monto por pedido de invitado** (pregunta v1.5-5) | Exposición comercial conocida; hoy **no** hay tope. |

#### (e-bis) Las dos vidas del token — corrección normativa v1.21.1

La v1.21 pedía algo **irrealizable**: "el mismo token del checkout se envía por correo al liquidar". Con **solo el
SHA-256 en BD**, el claro **no se puede recuperar** en el webhook — y esa imposibilidad es justamente la propiedad
de seguridad que se buscaba (T5). Rotar en el settle tampoco era opción: mataría el token que el navegador está
usando en la confirmación tras el 3DS.

**Norma:** dos emisiones, misma tabla, **sin columna nueva** (se distinguen solo por `expiresAt`):
- **Token de checkout** — lo devuelve `POST /checkout/guest/session` al comprador, **TTL 120 min**
  (`GUEST_CHECKOUT_TOKEN_TTL_MIN`). Existe para una sola cosa: sobrevivir al redirect de Stripe y pintar la
  confirmación/seguimiento inmediato. **Nunca** se envía por correo.
- **Token de seguimiento** — lo emiten el settle, el reenvío y soporte; **TTL 90 días**; **solo** viaja por correo.

Reglas de rotación (asimétricas a propósito): **el settle NO rota** (excepción acotada, justificada por la UX
post-3DS y segura porque la puerta que no revoca se apaga sola en 2 h); **el reenvío y el reenvío de soporte SÍ
rotan**, revocando *todos* los tokens vivos del pedido; **el reclamo revoca todo**. Resultado: el estado estable de
un pedido es **una única puerta sin contraseña**, con una ventana de solapamiento de como mucho dos horas el día de
la compra. Si el correo falla, el comprador tiene 2 h de acceso y después el reenvío con `(email + orderNumber)`
—datos que la confirmación le mostró—, así que no queda sin salida.

**Motivo de revocación (`details.reason`) — se DERIVA, no se persiste.** `order.claimedAt != null` ⇒ `CLAIMED`; en
otro caso ⇒ `ROTATED`. Se **elimina** el valor `SUPPORT` de la v1.21: era inderivable sin una columna de motivo, y
no se añade una columna para cambiar un texto de UX. **La trazabilidad no se pierde**: el reenvío de soporte deja
`AuditLog` (`order.tracking_link.reissue`, con actor y timestamp) y el self-service no, así que el forense
distingue perfectamente quién rotó. Lo que no distingue es el **cuerpo de la respuesta**, que es copy, no auditoría.

**Por qué opaco y no JWT (decisión, no preferencia):** (i) **revocable** borrando/marcando una fila — un JWT solo
se revoca con lista negra, que es exactamente la tabla que el opaco ya es; (ii) **no filtra claims** (un JWT lleva
`orderId` y fechas legibles por cualquiera que lo intercepte); (iii) **no depende de la rotación de un secreto**
(rotar el secreto invalidaría *todos* los enlaces vivos); (iv) **precedente probado en casa** (`AuthToken`,
§3.2/§4.11) con el mismo `hashAuthToken`/`randomBytes(32)`. La **única** diferencia semántica que hay que codificar
es que este token es **multi-uso**: `usedAt` (consumo) se sustituye por `revokedAt` (revocación) y `useCount`/
`lastUsedAt` (telemetría). No se reusa el modelo `AuthToken` porque su `userId` es obligatorio y su semántica de
un-solo-uso está cableada en `consume()`.

#### (f) Reclamo: la prueba de titularidad, dicha en voz alta

**¿Basta con verificar el correo? Sí, y además es obligatorio.** Verificar el buzón es *exactamente* la misma
prueba con la que el invitado recibió su enlace de seguimiento: si alguien controla ese buzón, ya podía ver el
pedido. No se está bajando el listón, se está igualando. Consecuencias:
- El reclamo **exige `emailVerified=true`** (`403 EMAIL_NOT_VERIFIED`, guard existente). Sin ese requisito,
  registrarse con el correo de un tercero bastaría para quedarse su pedido — el agujero clásico de esta feature.
- El **token NO es prueba alternativa**: se descarta permitir "reclamar con el enlace desde una cuenta con otro
  correo", porque dejaría que quien intercepte el enlace se apropie del pedido y **bloquee** al comprador legítimo
  (el reclamo es de una sola vez). El token sirve para *leer*, nunca para *apropiarse*.
- **Vinculación explícita, nunca silenciosa** (decisión del orquestador sobre el hueco abierto del PO): nadie debe
  poder inyectar pedidos al historial de un tercero escribiendo su correo en un checkout.
- **El modelo aguanta las tres políticas sin migración**, que era el requisito: el pedido guarda `guestEmail` y la
  vinculación es un `UPDATE` posterior sobre `userId`+`claimedAt`. Cambiar a *auto-vínculo al pagar* = poblar esos
  dos campos en el settle; cambiar a *exigir login* = un check en el checkout. **El punto de decisión queda acotado
  a un solo lugar** y la política es **revisable por el humano**.
- **Efectos acotados (criterio 54):** el reclamo **solo** escribe `userId`, `claimedAt`, revoca los tokens y
  audita. No mueve items a la bóveda, no cambia `fulfillmentMode`, ni precios, ni políticas, ni el estado del
  pedido. Un pedido ya entregado se reclama igual y queda como pedido cerrado en el historial.
- **Una sola vez (criterio 55):** `UPDATE ... WHERE id=:id AND userId IS NULL AND guestEmail=:correoVerificado`
  con `count===1` como ganador. Es el mismo patrón de reserva atómica que ya usa `createSession`; no hace falta
  bloqueo ni transacción serializable.

**Disputa de un invitado (criterio 56b) — decisión de NO modelar:** se descarta volver `Dispute.userId` nullable en
esta versión. El invitado abre su disputa **por correo a soporte** citando su `orderNumber` (que es exactamente lo
que PROJECT §J describe), el súper-admin evalúa y, si procede, ejecuta **reembolso en M3** — endpoint que ya existe,
ya es money-out, ya es `super_admin` y ya queda auditado. Coste: en v1.5 una disputa de invitado **no deja fila
`Dispute`**, así que no aparece en la cola de M8 ni en las métricas de disputas. **Deuda propuesta (para que el
techlead decida si la registra y a quién la enruta): `Dispute.userId` nullable + `orderId` para dar trazabilidad a
las disputas de invitado en M8.** No es bloqueante del DoD de este stream.

#### (g) Correo: `orders` usa el puerto, no toca el módulo `mail`

`MailModule` es `@Global()` y **exporta `MAIL_PORT`** (`MailPort.send({to,subject,html,text})`), de modo que
`orders` puede renderizar su **plantilla local** (`backend/src/modules/orders/mail/guest-order.templates.ts`, ES/EN
por `Order.locale`) y enviarla **sin modificar `mail` por dentro** — exactamente el patrón que `buylist` estrenó en
v1.18 (§4.18) y que PROJECT declara fuera de alcance ("cambios internos al módulo `mail`"). `MailService` conserva
sus dos métodos actuales; **no se le añade nada**.

Envío **best-effort post-commit**: su fallo se loguea y **no** revierte el pago ni hace fallar el webhook (un 5xx
haría que Stripe reintentara un settle ya aplicado). La red de seguridad ante un fallo de correo es triple: el
`trackingToken` ya devuelto por `POST /checkout/guest/session`, el reenvío self-service y el reenvío de soporte.
Contenido **prohibido** en el correo: cualquier dato de otro pedido, la dirección completa, datos de pago más allá
de la terminación, y **nunca** un enlace a acciones (cancelar/reembolsar).

#### (h) Reparto de trabajo (v1.21) y **CASOS DE PRUEBA EXIGIDOS del contracargo (v1.21.2, normativos)**

> **Los 8 casos exigidos viven en la tabla de §4.21h-1, más abajo en esta misma sección** (`§4.21h caso i` …
> `§4.21h caso viii` es la forma canónica de citarlos; los tests de backend ya usan esa numeración y **no deben
> cambiarla**). Antes estaban redactados como viñeta de prosa dentro del reparto de trabajo: existían, pero eran
> ilocalizables — errata de forma corregida en v1.21.2, **sin cambiar la numeración ni la sustancia**.

- **Backend:** (1) migración **M-25** + secuencia `order_number_seq` y backfill; (2)
  `computeDirectShipBreakdown` en `common/money.ts` (aditivo) y **8** códigos en `common/error-codes.ts`;
  (3) `GuestCheckoutService` en `modules/orders` (quote/session, `@Public()`, throttle, sin consultar `User`);
  (4) `OrderAccessTokenService` (emitir/rotar/validar/revocar, espejo de `AuthTokenService` pero multi-uso);
  (5) rama `direct_ship` en `payments.service` (settle → `picking` + crear `ShipmentRequest` idempotente +
  `paymentMethodBrand/last4` + correo post-commit); (6) ramificación de la terminal en M4; (7) claim
  (`/orders/claimable`, `/orders/claim`) con guard de `emailVerified` y update condicional; (8) endpoint admin de
  reenvío + `AuditLog`; (9) job `guest-order-sweep`; (10) plantilla de correo local; (11) **tests**: DTO público sin
  ningún campo prohibido, token inválido/expirado/revocado/de otro pedido, reclamo doble, reclamo con correo no
  verificado, `GET /shipments` no devuelve envíos `userId=null`, contracargo antes/después de enviar, idempotencia
  del webhook, no doble conteo del envío, **y los 8 casos de §4.21h-1**.
- **Frontend:** checkout de invitado (3 vías sin perder carrito), doble captura de correo, upsell de bóveda a partir
  de `422 VAULT_REQUIRES_ACCOUNT`, página `/[locale]/pedido` (token del query → body, `replaceState`, `noindex`),
  pantalla de enlace expirado con reenvío, confirmación con oferta de cuenta, y banner "tienes N pedidos por
  reclamar" tras verificar el correo.
- **QA:** los flujos de PROJECT §J.1 tal cual, incluidos los negativos (correo inválido, dirección no-MX, token
  manipulado/expirado, token de un pedido que no abre otro, pedido ya reclamado).
- **Seguridad (fase de release):** el `GuestOrderTrackingDTO` y el oráculo del reenvío son los dos objetivos
  prioritarios del pentester.

##### §4.21h-1 — Casos de prueba EXIGIDOS del contracargo `direct_ship` (v1.21.2, NORMATIVO)

> **Por qué son condición de aprobación y no una recomendación:** el caso «contracargo antes/después de enviar» ya
> estaba pedido en el reparto de trabajo de v1.21 y **no se escribió**; sin él, **T1 (double-sell físico) pasó todos
> los gates**. La numeración `i … viii` es **canónica y estable** — los tests de backend ya la citan
> (`§4.21h caso v`, `caso vi`, `caso vii`) y **no debe renumerarse**. Cada caso i–iv corresponde 1:1 a una fila de
> la tabla normativa de **§4.21c-bis**.

| # | Caso | Qué debe verificar (aserciones mínimas) |
|---|---|---|
| **i** | Contracargo con envío en **`picking`** | `ShipmentRequest → cancelado`; el item **sigue en `picking`** — **assert explícito de que NO queda en `listed` ni `in_stock`**; `chargebackNeedsManual=true`; **sin** `InventoryMovement` de retorno. |
| **ii** | Contracargo con envío en **`guia`** | Idéntico a (i). Es su propio caso porque `guia` (etiqueta generada, paquete probablemente armado) fue el estado que más tentó a una regla automática distinta. |
| **iii** | Contracargo con envío **`enviado`** (o `entregado`) | **Nada** cambia en inventario ni en el envío; `chargebackNeedsManual=true`. |
| **iv** | Contracargo **sin envío** (orden `pending`, item `reserved`) | `reserved → listed`, `ownerType=platform`, `InventoryMovement reason='chargeback_return'`, `chargebackNeedsManual=false`. **Única fila que autoriza re-listar automáticamente, y solo desde `reserved`.** |
| **v** | **Regresión del double-sell** (el test que faltaba y que habría atrapado T1) | Partiendo del estado final de (i): `POST /checkout/session` sobre esa pieza devuelve **`409 ITEM_UNAVAILABLE`**, `POST /checkout/guest/session` también, y `GET /admin/shipments/picking-list` **no la incluye**. *(Ajuste v1.21.3-quote-prune, API_CONTRACT §4/§4-G.1: los QUOTES ya no devuelven `409` global — la aserción equivalente es `200` con la pieza en `unavailableItems` y FUERA de `items`/`breakdown`. La pieza sigue invendible: el gate duro anti double-sell es SESSION, que conserva el `409`.)* |
| **vi** | Desenlaces de `POST /admin/orders/:id/chargeback-inventory` | Los tres (`recuperada`, `no_recuperada`, `reexpedir`) con sus efectos de §4.21c-bis; **`reexpedir` rechazado con `409 CONFLICT`** mientras la orden siga en `chargeback`; repetir un `outcome` ya aplicado ⇒ **`409`** sin duplicar movimientos ni envíos. |
| **vii** | `charge.dispute.closed` con `won` | La orden vuelve a `settled` con `disputeOutcome='won'` y **`chargebackNeedsManual` SIGUE en `true`**: ganar **no** re-expide solo. |
| **viii** | Invariante **D4** (discriminador) | Un `ShipmentRequest` con `orderId` cuya orden tenga un `fulfillmentMode` no soportado **lanza y se loguea**; **no** cae por default en la rama `direct_ship`. |

**l) Paginación server-side + filtros de la cola M3 (v1.25-buylist-orders-pagination — cierra P-5, paridad con §4.18h).**
`GET /admin/orders` ya paginaba y filtraba por `status`/`userId`/`from`/`to`/`guest`/`needsManual` con `createdAt desc`;
le faltaban, para el mismo problema de escala del PO, **búsqueda de texto** y **rango de monto** (API_CONTRACT §M3).
Decisiones de arquitectura:
- **Monto sobre `Order.totalCents`** — el **total canónico** de la orden (`Int` no-nullable = `subtotal + processing +
  IVA + envío`), el mismo campo que ya pinta la columna «total» de `M3View`. No se inventa un total derivado.
- **`q` server-side** cubre los **dos tipos de comprador**: invitado (sin `User`) por `Order.orderNumber` /
  `Order.guestEmail`; con cuenta por `Order.userId` exacto y el join `Order.user` (`name`/`email`). Coherente con el `q`
  de buylist (contains, case-insensitive, OR). `orderNumber` es `@unique` (ya indexado); `guestEmail` ya tiene
  `@@index`. **`q` NO toca datos de pago** (`paymentMethodLast4`/brand quedan fuera).
- **`pageSize` default 20 sin cambios**, front pide 25 (misma decisión que §4.18h). Validación → `400 VALIDATION_ERROR`.
- **Índices recomendados a backend (recomendación, NO migración escrita aquí — zona compartida `backend/prisma/`):**
  | Modelo | Índice recomendado | Sirve |
  |---|---|---|
  | `Order` | `@@index([status, createdAt])` (compuesto) | filtro por `status` + `ORDER BY createdAt DESC` (caso dominante de la cola). |
  | `Order` | `@@index([createdAt])` | rango `from`/`to` y orden cuando no se filtra por `status`. |
  | `Order` | `@@index([userId])`, `@@index([status])`, `@@index([guestEmail])`, `orderNumber @unique` | **YA EXISTEN** (no duplicar; el compuesto puede sustituir al `[status]` suelto — backend decide). |
  | `Order.totalCents` | — (sin índice) | rango de monto de baja selectividad, casi siempre junto a `status`/fecha ya indexados; filtro post-índice. Añadir sólo si el profiling lo pide. |
- **`q` (contains) sin índice B-tree útil** — mismo criterio que buylist: a escala MVP barre el conjunto ya reducido por
  los demás filtros; `pg_trgm` GIN sobre `User.name`/`email` (y opcionalmente `guestEmail`) queda como deuda futura si
  el volumen lo exige, no en este stream.

---

### 4.22 WS «Catálogo y precios» + «Inventario y vault» — Variantes reales y orden natural del master set (v1.22-variantes-orden)

> **Requisito del PO, textual:** «Ve cómo en el master set son dos cartas de cada una: la común a la izquierda y la
> holo a la derecha.» Traducido a norma: **una casilla de imagen por VARIANTE REAL** de la carta —normal a la
> izquierda, reverse holo a la derecha— y **jamás una casilla de relleno** si la variante no existe. Es la **tercera
> ronda** del mismo bug: las dos anteriores atacaron el render; la causa está en **el dato** y en **quién lo escribe**.

#### (a) `availableFinishes`: una sola autoridad, y no es la de precios

**Diagnóstico (código verificado el 2026-08-18, hallazgos del orquestador ratificados).**

| # | Dónde | Qué hace hoy | Efecto |
|---|---|---|---|
| VAR-1 | `price-ingest.service.ts:151-172` | Tras ingerir precios **sobrescribe** `Card.availableFinishes` con `providerFinishes` = los acabados que obtuvieron **`market > 0`** | **Causa raíz.** Carta con reverse holo **sin precio** de reverse holo ⇒ clobbeada a `['normal']` ⇒ **una** casilla. Agravado por **P-6** (el adapter de paga devuelve 0 filas). |
| VAR-2 | `catalog-sync.service.ts:355` + `pricing.types.ts:32` | `deriveAvailableFinishes(c.tcgplayer?.prices)`; sin bloque `tcgplayer` en el payload → `['normal']` | Pierde el reverse holo de toda carta que TCGplayer no liste, aunque Cardmarket sí lo publique. |
| VAR-3 | `seed.ts`, `seed-e2e.ts`, `e2e-fixtures.ts` | **No setean** `availableFinishes` ⇒ `@default([normal])` | El bug **se reproduce en local y staging**, y ningún E2E lo puede atrapar. |
| VAR-4 | `syncAll` / `backfill` | Solo refrescan `availableFinishes` con `force:true` | Los sets importados antes de v1.6-finish siguen en `['normal']` indefinidamente. |

**El error conceptual, en una frase:** `availableFinishes` responde *«¿en qué impresiones existe esta carta?»* —
**metadata de catálogo**— y se está escribiendo desde la ruta que responde *«¿cuánto vale hoy?»*. **La ausencia de un
precio no es prueba de la inexistencia de una impresión.** Además, `availableFinishes` es la **lista blanca SEC-A1**
del `finish` (§3.7): que la escriba un feed de precios significa que un fallo del feed **restringe** lo que un
vendedor puede cotizar y **borra** casillas del binder.

**Norma v1.22 (6 reglas, normativas — la 6ª es v1.22-2/N-15):**

1. **Autoridad única = el sync de catálogo.** `CatalogSyncService.upsertCards` (§4.8) es el **ÚNICO** escritor de
   `Card.availableFinishes` en todo el sistema.
2. **`price-ingest` NO escribe `availableFinishes`. Cero escrituras.** Se elimina el bloque
   `price-ingest.service.ts:167-172` (§4.15e queda derogada).
   > **Sigue siendo cierto tras v1.22-1 (§4.22g):** `price-ingest` **jamás** escribe `availableFinishes`. Lo que v1.22-1
   > añade es que `price-ingest` escribe su **propia** columna de entrada `pricedFinishesSnapshot` (Señal C, evidencia
   > positiva de alias verificado) y **llama** al único escritor `catalog.FinishReconciler`. El argumento de abajo
   > (monotonía imparable) se resuelve **materializando una unión recomputable**, no acumulando: quitar la fuente quita
   > el acabado (⛔ v1.27: la unión quedó derogada — el snapshot ya NO compone `availableFinishes`, solo confirma;
   > §4.25a). La regla «un solo escritor de la lista blanca» se **mantiene literalmente**.
   > **Por qué "cero" y no "solo ampliar" (decisión explícita, se pidió argumentarla).** «Ampliar sin reducir»
   > parece la opción segura, y **no lo es**: la unión es **monótona creciente y nadie puede limpiarla**. Basta un
   > alias mal mapeado en `BULK_VARIANT_TO_FINISH` (`foil → holofoil`, `reverse → reverse_holo`, todos marcados
   > *SUPUESTO — verificar 1ª corrida* en `pricing.types.ts:127-141`) para grabar un acabado **inexistente** que
   > (i) el catálogo ya no podrá quitar —el ingest lo re-añadiría en la siguiente corrida—, (ii) el binder pintará
   > como **casilla de relleno** (justo lo que el PO prohíbe) y (iii) **ensancha una lista blanca de seguridad**
   > (SEC-A1) desde un feed de precios de terceros. Con **cero escrituras**, un `sync --force` **repara** cualquier
   > estado; con «solo ampliar», no. Un solo escritor también hace el sistema **determinista y diagnosticable**:
   > ante una discrepancia hay **un** lugar donde mirar.
   > **Contrapartida aceptada y documentada:** si el proveedor de paga conociera una variante que **ni** TCGplayer
   > **ni** Cardmarket publican, no se registrará. La falla es **conservadora** (falta una casilla, no sobra una
   > falsa) y su remedio es **override manual del admin**, no escritura automática (ver `dataHealth`, punto 5).
3. **Derivación = unión de dos señales del MISMO payload que ya se descarga (cero requests extra).** Firma nueva:

   ```ts
   // backend/src/modules/pricing/pricing.types.ts  (reemplaza deriveAvailableFinishes(prices))
   /** null  = el payload remoto NO trae NINGUNA señal de acabado (≠ "solo existe normal"). */
   export function deriveAvailableFinishes(remote: {
     tcgplayer?:  { prices?: Record<string, unknown> | null } | null;
     cardmarket?: { prices?: Record<string, unknown> | null } | null;
   }): Finish[] | null;
   ```
   - **Señal A — `tcgplayer.prices`:** por cada **llave presente** mapeable con la tabla de §3.7 se añade su
     `Finish`. **La presencia de la llave ES la señal**; `market` puede ser `null`/`0` y la variante **sigue
     contando**. *(Este es el cambio que arregla «tiene reverse holo pero no tiene precio de reverse holo».)*
   - **Señal B — `cardmarket.prices.reverseHolo*`:** se añade `reverse_holo` si **alguno** de
     `reverseHoloSell | reverseHoloLow | reverseHoloTrend | reverseHoloAvg1 | reverseHoloAvg7 | reverseHoloAvg30`
     es un **número finito > 0**. ⚠️ **Ojo, asimetría deliberada con la señal A:** Cardmarket emite esas llaves
     **siempre**, con `0`/`null` cuando la impresión no existe ⇒ aquí **la llave NO es señal, el valor sí**. Tratarla
     como la A inventaría un reverse holo en **todas** las cartas.
   - **Resultado:** `union(A, B)` ordenada por `FINISH_ORDER`, o **`null`** si A y B están ambas vacías.
   - Llaves no mapeadas (`1stEditionNormal`, `unlimitedHolofoil`) se siguen ignorando (§3.7). Consecuencia asumida:
     una carta que **solo** exista en `1stEditionNormal` cae a `['normal']` — **una** casilla, ninguna inventada.
4. **Comportamiento sin señal remota (regla anti-regresión).** `upsertCards`:
   - **CREATE** → `availableFinishes = derived ?? ['normal']` (conservador: **una** casilla; nunca relleno).
   - **UPDATE** → el campo se incluye en el `data` del upsert **solo si `derived !== null`**. Con `derived === null`
     **se omite la clave** y se **conserva** el valor previo. Un payload remoto parcial/degradado **no puede** volver
     a clobbear a `['normal']` una carta que ya sabíamos de dos variantes. Cuando **sí** hay señal, el catálogo es
     autoridad plena y **puede reducir** (es la corrección legítima de un dato erróneo).
5. **Observabilidad en vez de adivinanza.** Se **prohíbe** cualquier heurística de relleno; a cambio, la carencia se
   hace **visible**: contador `cardsWithoutFinishSignal` (cartas cuyo último sync devolvió `derived === null`) en el
   `dataHealth` de M2 (**recomendado, no bloqueante**, backend). El remedio de negocio ante una variante faltante es
   el **override manual del admin**, nunca una regla automática.
   > **v1.26 (§4.24a) — refuerzo, no derogación.** La prohibición de heurística por rareza SIGUE VIGENTE. Lo que cambia
   > es la FUENTE de la señal estructural positiva: se **detecta de TCGCSV** (fuente estructural autoritativa: el
   > `subTypeName` existe aunque `marketPrice` sea `null` ⇒ **estructura ≠ precio**), no de la presencia de una llave
   > de `tcgplayer.prices`/`cardmarket` (proxy de precio). *Detectar de TCGCSV; jamás inferir por rareza/era; una
   > impresión estructural sin precio es «pendiente», nunca inventada ni dropeada.* La regla 2 (money→estructura) y la
   > anti-invención (candado 3, §4.22g) quedan intactas.
   > **v1.27 (P-13, §4.25a) — cierre definitivo del vector money→estructura.** Con `structuralFinishes` poblado, la
   > composición es `availableFinishes = orderFinishes(structuralFinishes)` a secas: **ninguna señal de precio (ni
   > Señal C/snapshot PPT, ni llaves de `tcgplayer.prices`) añade jamás una casilla**. VAR-1 pasa de mitigado a
   > estructuralmente imposible en la población resuelta por TCGCSV. Fallback legacy (structural vacío) = `['normal']`
   > (ver §4.25a-3, trade-off y ruta de migración).

6. **§4.22a-6 (v1.22-2 / N-15) — `displayFinishes`: supresión de acabado ESPURIO en premium de una sola impresión
   (DISPLAY, NO whitelist).** *(El PO resolvió N-15 eligiendo la opción MÍNIMA: solo suprimir la casilla `normal`
   espuria; ver PROJECT §I. Numeración: se usa `§4.22a-6` y NO `§4.22a-4` porque ese ordinal ya está tomado por la
   regla anti-regresión `null ⇒ conserva`, referenciada además en comentarios de código.)*

   **Problema.** Por la regla 3 (Señal A) «la LLAVE presente ES la señal, con o sin `market`»: si `tcgplayer.prices`
   de una **carta premium** (`isPremiumRarity(rarity) === true`, `common/money.ts`) trae una sub-llave `normal`
   (o cualquier acabado que **no** es su impresión real) **solo como precio pendiente/espurio** (`market` ausente/`0`),
   ese acabado entra a `catalogFinishes` → `availableFinishes` y el binder pinta una casilla `Normal` para una carta
   que **en realidad solo existe** en Holofoil (ex/full-art). N-15 elimina esa casilla espuria **sin** tocar la
   whitelist ni el vector de dinero.

   > **v1.27 (P-13) — alcance de N-15 tras la regla «confirma, no añade» (§4.25a).** N-15 solo oculta acabados **SIN
   > precio**, así que NUNCA salvó el caso P-13 (el `normal` fantasma de `fetchPrintings` venía CON precio). Ese caso
   > lo cierra ahora la composición misma: con `structuralFinishes` poblado, el fantasma ni siquiera entra a
   > `availableFinishes`. N-15 **se conserva tal cual** como cinturón para la población **legacy/fallback**
   > (structural vacío → `['normal']`) y para cualquier residuo pre-re-sync; sigue siendo solo-display, solo-resta.

   **Mecanismo — campo DERIVADO de DISPLAY, separado de la whitelist (decisión del arquitecto).** Se expone un
   campo derivado nuevo `displayFinishes: Finish[]` (subconjunto de `availableFinishes`, mismo orden `FINISH_ORDER`)
   que el frontend usa para **pintar casillas/tarjetas**. `availableFinishes` **NO cambia**: sigue siendo la
   **lista blanca SEC-A1** contra la que el backend valida el `finish` del cotizador (`422 FINISH_NOT_AVAILABLE`) y
   la clave con la que se **deriva el monto** server-side. `displayFinishes` **jamás** valida dinero ni recorta la
   whitelist. La semántica de seguridad SEC-A1 es intacta.

   **Derivación (función pura, server-side, money-safe):**
   ```
   // hasPricedRef(card, f) := existe PriceReference vigente (raw, gradeKey='raw:NM', finish=f) con
   //                          priceMxnCents > 0 (el MISMO por-acabado que resuelve referenceValue/quote).
   pricedFinishes := { f ∈ availableFinishes : hasPricedRef(card, f) }

   displayFinishes(card) :=
     if isPremiumRarity(card.rarity) === true  AND  pricedFinishes ≠ ∅:
          orderFinishes(pricedFinishes)          // premium de 1 impresión: se conservan SOLO los acabados con
                                                 // market>0 (su impresión real); los sin precio se OCULTAN.
     else:
          availableFinishes                      // DEFAULT: sin supresión (comportamiento actual).
   ```
   Invariante **`displayFinishes ⊆ availableFinishes`, no vacío, orden `FINISH_ORDER`**. La supresión **solo RESTA**
   casillas; **jamás AÑADE** un acabado ⇒ es imposible que N-15 invente nada.

   - **`isPremiumRarity` reusa `common/money.ts`** (el mismo clasificador chase de la Fase 0.1 del buylist). Ninguna
     lógica de rareza vive en el front (SEC-A1 / una sola autoridad).
   - **Default rareza `null`/desconocida:** `isPremiumRarity(null) === false` ⇒ **sin supresión**,
     `displayFinishes = availableFinishes` (comportamiento actual, como pide el PO).
   - **Salvaguarda anti-cero-casillas:** si la carta premium **no** tiene ningún acabado priceado (toda pendiente),
     `pricedFinishes = ∅` ⇒ NO se suprime nada (`displayFinishes = availableFinishes`); una carta pendiente no se
     vende de todos modos, y nunca se deja una celda sin casillas.
   - **Autocuración:** la supresión es DERIVADA de los precios vigentes; cuando el acabado real recupera precio,
     reaparece en `displayFinishes` en el siguiente cómputo/refresh (recomputable, no persiste un veredicto).
   - **Tradeoff aceptado y documentado:** en una carta premium con dos impresiones reales donde una está
     momentáneamente sin precio, esa segunda casilla se **oculta** en display mientras no tenga `market>0`. Es
     money-safe (solo se oculta una casilla **sin precio que mostrar**; el acabado sigue en la whitelist, vendible;
     re-priceo la restaura). Se prefiere sobre pintar una casilla `Normal` espuria en una chase.

   **Prohibición de heurística por rareza — SIGUE VIGENTE (no confundir con N-15).** N-15 **no** deriva ni inventa
   acabados por rareza: usa la rareza **solo** como *gate* para decidir si OCULTAR un acabado que **ya está** en la
   whitelist. En particular **NO se inventa `reverse_holo` por rareza**: VAR-1 (§9) se respeta al 100% — el reverse
   holo de una normal aparece **únicamente** donde PPT/Cardmarket dan señal real (§4.22a-3 / §4.22g), y N-15 nunca lo
   añade (solo resta). La regla 5 (prohibida cualquier heurística de relleno **aditiva**) queda intacta.

**Consecuencias fuera de este WS (ninguna es breaking):** `PriceReference` **no cambia** — `price-ingest` sigue
persistiendo el precio de **cualquier** `finish` válido que reporte el proveedor, **incluso si no está** en
`availableFinishes` (dato inocuo: el quote valida el finish **antes** de leer precio). Esa divergencia se **loguea**
como `finishNotInCatalog` (evidencia de drift para el dueño), y el binder ya la tolera por §4.20b («drift»).

#### (b) Orden natural del número — columnas PERSISTIDAS (decisión (a); se descarta ordenar en memoria)

**Diagnóstico.** `catalog.service.ts:325` (`searchAllCards`, el que alimenta el binder del cotizador vía
`GET /buylist/cards`) ordena `orderBy: [{ name:'asc' }, { number:'asc' }]`. `Card.number` es **`String`** ⇒ `"10"`
antes que `"2"`. `master-set.service.ts:449` **sí** ordena bien, pero **en memoria** con `compareByNumber` +
`deriveNumberParts` (que ya maneja `TG01`/`SV107` con `PROMO_SORT_BASE`). El front tapa el hueco pisando
`numberSort: idx` en `MasterSetBinder.tsx:104` — un índice de arreglo, no una clave de orden.

**Decisión: (a) columnas persistidas.** El argumento decisivo es el que señaló el orquestador: **`searchAllCards`
pagina** (`skip`/`take`). Ordenar en memoria ocurre **después** del `LIMIT`, así que reordenaría **la página**, no el
conjunto: la página 1 traería las 50 cartas *lexicográficamente* menores y luego las barajaría — orden **global
incorrecto**, y encima cartas duplicadas/ausentes entre páginas. El orden **debe** estar en el `ORDER BY` de SQL, y
Prisma no sabe ordenar por expresión ⇒ o `$queryRaw` (pierde tipos, `where` y paginación de Prisma en la ruta pública
del cotizador) o **columnas derivadas**. Se eligen las columnas: son indexables, reutilizables por todas las vistas y
convierten el orden en una propiedad del **dato**, no de cada call-site.

- **Esquema (M-26, §11):** `Card.numberSort Int @default(1000000)`, `Card.numberPrefix String @default("")`,
  índice `@@index([setId, numberPrefix, numberSort])`.
- **Escritura:** `upsertCards` puebla ambas con `deriveNumberParts(number)` en **create y update**.
  `deriveNumberParts` (hoy en `master-set.service.ts:161`) se **promueve** a utilidad compartida y pasa de
  *comparador en memoria* a **función de escritura canónica**; debe **clampear** `num` a `999_999` para no desbordar
  `Int` con un `number` absurdamente largo (mismo clamp que el backfill SQL).
- **Lectura — `orderBy` NORMATIVO** (equivale exactamente a `compareByNumber`, porque `''` es el menor string ⇒ las
  puramente numéricas van primero, y luego se agrupa por prefijo):
  ```ts
  // con setId (caso del binder): orden natural puro
  orderBy: [{ numberPrefix: 'asc' }, { numberSort: 'asc' }, { number: 'asc' }, { id: 'asc' }]
  // sin setId (búsqueda de texto en varios sets): nombre primero, SET MÁS NUEVO, natural dentro (v1.40, Enmienda B)
  orderBy: [{ name: 'asc' }, { set: { releaseDate: { sort: 'desc', nulls: 'last' } } }, { numberPrefix: 'asc' }, { numberSort: 'asc' }, { id: 'asc' }]
  ```
  **v1.40 (Enmienda B, P-41) — desempate por SET MÁS NUEVO.** El segundo criterio pasó de `{ setId: 'asc' }` (uuid
  **aleatorio** ⇒ empate arbitrario entre variantes del mismo nombre; la impresión nueva podía caer fuera del top-N) a
  **`{ set: { releaseDate: { sort: 'desc', nulls: 'last' } } }`**: entre varias impresiones de la misma carta (mismo
  `name`), gana la del **set con `releaseDate` más reciente**. `CardSet.releaseDate` es `String?` en formato `yyyy/MM/dd`
  zero-padded (fuente pokemontcg.io), por lo que el orden **lexicográfico desc == cronológico desc**; `nulls: 'last'` evita
  que un set sin fecha salte al frente. Prisma resuelve el orden por campo de relación con un JOIN a `CardSet` (no requiere
  `include`). Cambio **normativo** que solo afecta el caso **sin `setId`** (catálogo/cotizador/búsqueda global); el orden
  natural **dentro de un set** (`CARD_ORDER_BY_IN_SET`) **no cambia**. *(Nota de rendimiento para backend/techlead: el orden
  por columna de la relación no aprovecha el índice `@@index([setId, numberPrefix, numberSort])` de `Card`; si el plan de la
  búsqueda global lo requiere, evaluar índice de apoyo — no bloqueante, registrar en `TECH_DEBT.md` si aplica.)*
  El `{ id: 'asc' }` final **no es cosmético**: sin desempate total, dos filas empatadas pueden intercambiarse entre
  dos consultas paginadas y producir **filas repetidas o saltadas** al cambiar de página.
- **`master-set.service`:** el binder pasa a ordenar en **BD** con el mismo `orderBy` y a **leer `numberSort` de la
  columna**; `compareByNumber` se conserva **solo** como oráculo de tests y para colecciones ya materializadas.
  Prohibido que la clave persistida y la función diverjan: **un** algoritmo, en `deriveNumberParts`.
- **Casos borde documentados (parity con el comparador actual; NO se cambia la semántica en este WS):** `"23a"` →
  `prefix="a"`, `numberSort=1_000_023` ⇒ cae en el bloque de promos en vez de junto a `"23"`; `number=""` →
  `prefix=""`, `numberSort=1_000_000` ⇒ al final del bloque numérico. Afinarlos es **deuda menor** (nueva entrada
  sugerida en `TECH_DEBT.md`, dueño backend), no parte de este arreglo.

#### (c) Invariante de render: una casilla por variante real

Normativo para **toda** vista de master set (cotizador, binder M1, bóveda admin, «Mi bóveda»):

1. **`|casillas| = |displayFinishes|`**, siempre **≥ 1**. *(v1.22-2/N-15: el universo de casillas RENDERIZADAS es
   `displayFinishes` (§4.22a-6), NO `availableFinishes` crudo. En la inmensa mayoría de cartas coinciden; solo una
   **premium de una sola impresión** con un acabado espurio los distingue —`displayFinishes ⊊ availableFinishes`—.
   `availableFinishes` sigue siendo la **whitelist SEC-A1** para validar `finish`; `displayFinishes` es lo que se
   PINTA.)*
2. El **orden de izquierda a derecha** es el del array, que se persiste y se emite en **`FINISH_ORDER`** (§3.7)
   ⇒ *normal a la izquierda, reverse holo a la derecha*. El front **no ordena** acabados: consume el orden del DTO.
   `displayFinishes` conserva ese mismo orden canónico.
3. **Prohibido pintar una casilla cuyo `finish` no esté en `displayFinishes`** (nada de placeholder, "hueco de
   relleno" ni acabado fijo por convención, **ni** el acabado espurio suprimido por N-15). Si la carta solo tiene
   `['normal']`, se pinta **una** casilla y la celda queda más angosta — eso es correcto, no un defecto visual a
   compensar.
4. **La imagen de la variante es la imagen de la CARTA.** Confirmado: pokemontcg.io v2 publica **un solo**
   `images.small` / `images.large` por objeto carta; **no existe** imagen por acabado (el reverse holo no tiene arte
   propia en la fuente). Por eso **`MasterSetVariantDTO` NO gana campo de imagen** y `CardDTO`/`MasterSetCardCellDTO`
   **no** ganan un mapa `imageByFinish`. La lectura del orquestador es **correcta**; se ratifica como norma para que
   ninguna ronda futura vuelva a proponerlo. *(Si algún día se quisiera diferenciar visualmente el reverse holo, es
   un efecto de **presentación** del front —marco/badge/overlay—, no un dato nuevo del contrato.)*
5. **v1.22-2/N-16 — REJILLA PLANA, una TARJETA por impresión.** La presentación deja de agrupar por carta con
   sub-casillas y pasa a **una tarjeta (carta+acabado) por cada `finish` de `displayFinishes`**, en flujo plano, en:
   cotizador, master-set de inventario (admin M1), «Mi bóveda» (cliente) y bóvedas de cliente (admin). El número de
   tarjetas por carta lo determina **exactamente `displayFinishes`** (tras la supresión N-15), **no** `availableFinishes`
   crudo: una common con reverse holo real en PPT → **2 tarjetas** (Normal, Reverse Holo); una ex/full-art →
   **1 tarjeta** (Holofoil), sin `Normal` espuria. Es **presentación del frontend**; el contrato solo expone
   `displayFinishes` + el precio por acabado que ya existía (§4.22a-6 y API_CONTRACT). El invariante «la imagen es la
   de la carta» (punto 4) no cambia: todas las tarjetas de una misma carta comparten `imageSmallUrl`/`imageLargeUrl`.

#### (d) Reparación del dato ya existente (prod y staging)

El código corregido **no repara solo** las filas ya escritas: hay cartas con `['normal']` grabado por VAR-1/VAR-2/VAR-4.
Secuencia de despliegue (**dueño: devops**, con backend):

1. Migración **M-26** (columnas de orden + backfill SQL + índice). No toca `availableFinishes`.
2. Deploy del backend con (a) `price-ingest` sin escritura de variantes y (b) la derivación de dos señales.
3. **Re-sync forzado del catálogo:** `POST /api/v1/admin/catalog/sync-all { force: true }` (super_admin) — es el
   único camino que reprocesa sets ya importados (VAR-4) y el que repuebla `availableFinishes` **y** las nuevas
   columnas de orden. Verificar con `GET /admin/catalog/sync-status`.
4. **Verificación (gate):** sobre un set moderno conocido, `SELECT count(*) FROM "Card" WHERE
   'reverse_holo' = ANY("availableFinishes") AND "setId" = :set` debe ser **> 0** (hoy da 0 en el set afectado); y en
   el binder, una común moderna debe mostrar **dos** casillas. Si sigue en `['normal']` masivo ⇒ el payload remoto no
   trae ninguna de las dos señales y se abre la pregunta v1.22-1 (§10) antes de tocar más código.

#### (e) Seeds (norma; la implementa el rol dueño de `backend/prisma/`)

Los seeds **deben setear `availableFinishes` explícitamente** en cada `Card` que crean —nunca depender del
`@default([normal])`— y el conjunto sembrado debe contener, como mínimo:

- **≥ 1 carta con `['normal','reverse_holo']`** (la que prueba las **dos** casillas del PO);
- **≥ 1 carta con `['normal']`** (la que prueba que **no** se pinta relleno);
- números **`"2"`, `"10"` y `"TG01"`** en el mismo set (la carta `"10"` debe salir **después** de `"2"` y `"TG01"`
  **al final**), y `numberSort`/`numberPrefix` coherentes (sembrados o derivados con `deriveNumberParts`).

Aplica a `backend/prisma/seed.ts`, `backend/prisma/seed-e2e.ts` y las `e2e-fixtures.ts`. Sin esto, **ningún E2E puede
fallar ante el bug del PO**, que es exactamente por lo que sobrevivió tres rondas.

#### (f) Supuesto abierto y su verificación

⚠️ **No se pudo verificar el payload remoto en vivo:** el proxy del entorno **bloquea `api.pokemontcg.io` (403 en
CONNECT)**. La derivación de §4.22a-3 está diseñada contra el **esquema documentado de pokemontcg.io v2** y contra el
código que ya lo consume, con estos supuestos explícitos:

| # | Supuesto | Cómo se verifica | Si resulta falso |
|---|---|---|---|
| S1 | `tcgplayer.prices` solo trae la sub-llave de una impresión **cuando esa impresión existe** (la llave es metadata, no un slot fijo) | 1ª corrida: contar cartas con llave `reverseHolofoil` y `market` nulo | Se cae a la señal B; si ninguna sirve, ver pregunta abierta v1.22-1 |
| S2 | `cardmarket.prices` expone `reverseHolo*` **siempre**, con `0`/`null` cuando no hay reverse holo | 1ª corrida: histograma de `reverseHoloTrend` por set | Si solo aparece cuando existe, la señal B se relaja a "llave presente" (más simple) |
| S3 | El objeto carta de `GET /v2/cards?q=set.id:*` **ya incluye** `cardmarket` (no hay `select=`) ⇒ **cero requests extra** | Inspeccionar una respuesta cruda en la 1ª corrida | Habría que añadir `select` o una 2ª llamada — **avisar al arquitecto antes** (cambia el coste del sync) |

**Dueño de la verificación: backend, en la primera corrida en Railway**, y **devops** la registra en
`docs/DEVOPS_NOTES.md`. `PokemonTcgIoClient.RemoteCard` debe **ampliar su interfaz** con
`cardmarket?: { prices?: Record<string, unknown> | null }` (solo tipos: el JSON ya se descarga completo).

#### Reparto de trabajo (v1.22)

- **Backend (WS «Catálogo y precios»):** (1) `deriveAvailableFinishes` con la firma nueva (2 señales, `null` sin
  señal) + tests de tabla de verdad; (2) `upsertCards` — omitir la clave en UPDATE cuando `derived === null`, poblar
  `numberSort`/`numberPrefix`; (3) **eliminar** la escritura de `availableFinishes` en `price-ingest.service.ts`
  (+ log `finishNotInCatalog`); (4) ampliar `RemoteCard` con `cardmarket`; (5) migración **M-26** con backfill;
  (6) `searchAllCards` con el `orderBy` normativo (§4.22b) y `CardDTO` con `numberSort`/`numberPrefix`;
  (7) `master-set.service` ordenando en BD y leyendo `numberSort` de la columna; (8) seeds (§4.22e);
  (9) opcional recomendado: `cardsWithoutFinishSignal` en `dataHealth`.
  **Tests obligatorios:** carta con llave `reverseHolofoil` y `market:null` ⇒ `['normal','reverse_holo']`; carta con
  solo `cardmarket.reverseHoloTrend > 0` ⇒ idem; carta sin ninguna señal en UPDATE ⇒ **conserva** el valor previo;
  `price-ingest` **no** modifica `Card` (assert sobre el spy de `card.update`); `["2","10","SV107","TG01"]` sale en
  ese orden **atravesando dos páginas** de `GET /buylist/cards`. *(Errata v1.22.1: esta línea ilustrativa decía
  `["2","10","TG01","SV107"]`, contradiciendo el `orderBy` normativo de §4.22b — `numberPrefix asc` ⇒ `SV` < `TG`.
  **Manda la norma**; backend implementó lo correcto y lo anotó en BACKEND_NOTES §49.8. No "arreglar" el orden en la
  dirección contraria.)*
- **Frontend:** (1) **eliminar** el `numberSort: idx` de `MasterSetBinder.tsx:104` y usar
  `(numberPrefix, numberSort, number)` del DTO al re-ordenar tras filtrar localmente; (2) el binder del cotizador
  pinta **una casilla por entrada de `availableFinishes`**, en el **orden del array** (sin `sort` propio, sin lista
  fija de acabados), con `imageSmallUrl` de la carta en todas; (3) ninguna casilla de relleno cuando el array trae un
  solo acabado. **No** requiere cambio de diseño (ux-ui no bloquea este WS).
- **Devops:** secuencia de §4.22d (migración → deploy → `sync-all {force:true}` → verificación), y registrar en
  `DEVOPS_NOTES.md` el resultado de S1/S2/S3.
- **QA:** doble veredicto por stream (**no toca dinero**: no se cambia ninguna regla de precio de buylist ni de venta).
  E2E mínimo: en el cotizador, una carta con reverse holo muestra **dos** casillas y una sin él **una**; el set se
  lista `2 → 10 → … → TG01`; el smoke corre contra los seeds de §4.22e.

#### (g) Señal C — evidencia positiva del proveedor de PAGA (PPT), money-safe (v1.22-1 RESUELTA)

**Contexto que cambió el tradeoff.** Cuando se escribió §4.22a-2 («`price-ingest` NO escribe `availableFinishes`,
cero escrituras»), **pokemontcg.io era la fuente confiable** y la única. Hoy no: pokemontcg.io ha estado devolviendo
**502** (y para un set 2026 nuevo puede responder sin publicar el reverse holo por separado), mientras la fuente de
PRECIOS ya migró a **PokemonPriceTracker (PPT)**, API de paga que SÍ responde. Resultado observado (set «Pitch Black»,
2026, 120 cartas): **las 120 muestran solo `normal`** pese a re-sincronizar — es exactamente el caso de §4.22f S1/S2
fallando (§4.22d-4). El humano decide (no se re-litiga): tomar la señal de acabados de PPT — **opción (c) de v1.22-1** —
manteniendo default seguro `['normal']` y **sin inventar** acabados.

**La tensión con la regla 2, resuelta explícitamente.** La regla 2 sigue **vigente en su núcleo money-safe**: precio
**AUSENTE ≠ variante inexistente** ⇒ jamás se REMUEVE un acabado por falta de precio. Lo que se admite ahora es la
**conversa, que la regla 2 no cubría**: precio **PRESENTE (`market > 0`) para un acabado, vía un alias VERIFICADO** ⇒
ese acabado **existe** (evidencia positiva). Se admite bajo cuatro candados que neutralizan los tres argumentos
originales de la regla 2:

1. **No es monótona-creciente (candado contra el argumento i).** No hay «unión que nadie limpia». `availableFinishes`
   pasa a ser una **columna DERIVADA que se RECOMPUTA de forma determinista** como unión de **dos entradas persistidas
   e independientemente recomputables**:

   ```
   availableFinishes  :=  orderFinishes( catalogFinishes ∪ pricedFinishesSnapshot )   ||  ['normal']
   ```

   > **⚠️ v1.26 (§4.24a) — la ENTRADA estructural de esta unión CAMBIA.** `catalogFinishes` era un **proxy de precio**
   > (llaves presentes de `tcgplayer.prices` ∪ `cardmarket.reverseHolo*`). v1.26 introduce `Card.structuralFinishes`
   > —derivada de la fuente ESTRUCTURAL autoritativa (TCGCSV, `subTypeName`)— que **ancla/reemplaza** a `catalogFinishes`
   > en la unión: `availableFinishes := orderFinishes(structuralFinishes ∪ pricedFinishesSnapshot) || ['normal']`. Los
   > cuatro candados de abajo (recomputable, alias verificado, anti-invención, un solo escritor `FinishReconciler`)
   > **se conservan sin cambio**; solo se sustituye la columna de entrada del lado catálogo. Detalle, seed y semántica
   > money-safe de la sustitución en **§4.24a**.

   > **v1.27.1 (P-13-fix, §4.25e) — la UNIÓN vuelve, pero filtrada.** La versión intermedia «solo structural» de la
   > primera P-13 quitó la unión entera y causó una regresión (los comunes perdieron su reverse holo). Fórmula VIGENTE:
   > `availableFinishes := orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot) − { normal | isPremiumRarity(rarity) } ) || ['normal']`
   > (`composeAvailableFinishes(structuralFinishes, pricedFinishesSnapshot, rarity)`, `card-order.ts`). El snapshot SÍ
   > compone otra vez (el precio confirma una impresión física real: el reverse del común lo es); lo único que se quita
   > es el `normal` en cartas premium (fantasma estructural). Los cuatro candados y el escritor único siguen vigentes.
   > Ver **§4.25e**.

   - `Card.catalogFinishes Finish[]` — la unión Señal A ∪ Señal B del **último payload de pokemontcg.io** (lo que hoy
     devuelve `deriveAvailableFinishes(c)`), con la MISMA semántica anti-regresión de §4.22a-4 (`null` ⇒ se omite y se
     **conserva** el valor previo; CREATE ⇒ `derived ?? ['normal']`). Es la «opinión del catálogo», ahora persistida en
     su propia columna para que **sobreviva a un 502 de pokemontcg.io**.
   - `Card.pricedFinishesSnapshot Finish[]` — **Señal C**: los acabados que **PPT reportó con `market > 0` para esa
     carta, filtrados a alias VERIFICADO** (ver candado 2). Es un **snapshot que se REEMPLAZA** por carta en cada
     corrida exitosa de `price-ingest` (no se acumula).

   Como `availableFinishes` es **función pura de esas dos columnas**, **quitar** un acabado de cualquiera de las dos y
   recomputar lo **elimina**. Un `sync --force` (recomputa `catalogFinishes` desde pokemontcg.io) o la siguiente corrida
   de PPT que ya no reporte el acabado **REPARAN** el dato. Esto es lo que la regla 2 exigía y «solo ampliar» no daba.

2. **Alias VERIFICADO, no SUPUESTO (candado contra el argumento ii, SEC-A1).** La ruta que alimenta la lista blanca
   **solo** acepta acabados provenientes de un **alias verificado** = el espejo exacto de `TCG_KEY_TO_FINISH`
   (`normal`, `reverseHolofoil→reverse_holo`, `holofoil`, `1stEditionHolofoil→first_edition_holofoil`). Los alias
   marcados **SUPUESTO** en `BULK_VARIANT_TO_FINISH` (`foil→holofoil`, `holo→holofoil`, `reverse→reverse_holo`,
   `reverseholo→…`, etc.) **NO** entran a `pricedFinishesSnapshot`: pueden seguir alimentando `PriceReference` (un
   alias de precio es dato inocuo, el quote valida el finish **antes** de leer precio), pero **jamás la lista blanca**
   hasta que la 1ª corrida los promueva a verificados (S-C2). Así un `foil` mal supuesto **no** graba un `holofoil`
   inexistente permanente en SEC-A1.

3. **Anti-invención (candado contra pintar relleno).** Si PPT reporta un `printing` desconocido o mal-aliaseado,
   `normalizeVerifiedFinishAlias` devuelve `null` ⇒ **se OMITE** (nunca se atribuye a `normal`, nunca se pinta una
   casilla de relleno). La unión está acotada al enum `Finish`. La falla es **conservadora**: falta una casilla, nunca
   sobra una falsa.

4. **Sigue habiendo UN solo escritor de `availableFinishes` (candado contra el argumento iii + diagnosticabilidad).**
   `price-ingest` **NO** escribe `availableFinishes` — sigue siendo cierto. Escribe **solo su propia** columna de
   entrada `pricedFinishesSnapshot` y luego **invoca al reconciliador del módulo `catalog`**. La ESCRITURA de
   `availableFinishes` ocurre en **exactamente un** método, propiedad de `catalog`
   (`FinishReconciler.reconcile(cardIds)`), que lee las dos columnas de entrada y recomputa la lista blanca. Ante una
   discrepancia hay **un** lugar donde mirar; el feed de precios nunca toca la lista blanca directamente.

**Flujo de escritura (normativo).**

```
pokemontcg.io (cuando responde)                     PPT (paga, responde hoy)
   catalog-sync.upsertCards                             price-ingest (por set, corrida exitosa)
     → escribe Card.catalogFinishes                       → escribe Card.pricedFinishesSnapshot (alias VERIFICADO,
        (null ⇒ conserva; §4.22a-4)                            REEMPLAZO por carta vista con ≥1 fila válida)
     → llama FinishReconciler.reconcile(cardIds)          → llama FinishReconciler.reconcile(cardIds)
                         \                                    /
                          → catalog.FinishReconciler.reconcile(cardIds)   ← ÚNICO escritor de availableFinishes
                              availableFinishes := orderFinishes(catalogFinishes ∪ pricedFinishesSnapshot) || ['normal']
```

> **v1.27.1 (P-13-fix, §4.25e):** la última línea del diagrama (la unión cruda) evolucionó — el reconciliador vigente
> computa `composeAvailableFinishes(structuralFinishes, pricedFinishesSnapshot, rarity)` = `orderFinishes( (structural
> ∪ snapshot) − { normal si premium } ) || ['normal']`. El snapshot SÍ vuelve a componer (recupera el reverse legítimo
> del común), pero el `normal` fantasma de las cartas premium se filtra por rareza. (⛔ La versión intermedia «solo
> structural» de la primera P-13 quedó derogada por regresión, ver §4.25e.) El resto del flujo (quién escribe qué
> columna, quién invoca al reconciliador) sigue vigente, con la excepción de que las filas `forced` de `fetchPrintings`
> NO escriben el snapshot (§4.25a-2).

- **Money-safe ante fallo transitorio de PPT.** `pricedFinishesSnapshot` se reemplaza **solo** para cartas que
  aparecieron con **≥ 1 fila válida** en una corrida **exitosa** (`requestOk && rows > 0`). Si PPT falla / devuelve 0
  filas, **no se toca ningún snapshot** (mismo criterio con que hoy no se borran precios: no destruir evidencia por un
  fallo transitorio). Una carta que PPT deje de devolver por completo mantiene su snapshot previo (stale conservador:
  falta-una-casilla, no sobra-una-falsa); su limpieza definitiva viene del `sync --force` (recomputa `catalogFinishes`)
  o del override manual del admin.
- **Default seguro (idéntico a hoy).** Sin ninguna señal (ni `catalogFinishes` ni `pricedFinishesSnapshot`) ⇒
  `['normal']`. La regla anti-regresión §4.22a-4 se **traslada** a la escritura de `catalogFinishes`: un payload
  degradado de pokemontcg.io **no puede** vaciar la base ni volver a clobbear a `['normal']` una carta que ya sabíamos
  de dos variantes.
- **Contrato sin cambio de forma.** `CardDTO.availableFinishes` mantiene **exactamente** su shape (`Finish[]`, no
  vacío, orden `FINISH_ORDER`). `catalogFinishes` y `pricedFinishesSnapshot` son **internas, NO se exponen** en ningún
  DTO. Todos los lectores existentes (quote, alta de inventario, binder) siguen leyendo `availableFinishes` y quedan
  correctos **sin tocar ningún call-site de validación** — por eso se **materializa** la unión en la columna en vez de
  unir en tiempo de lectura.

**Supuestos a verificar en la 1ª corrida (misma disciplina que S1/S2/S3).**

| # | Supuesto | Cómo se verifica | Si resulta falso |
|---|---|---|---|
| S-C1 | PPT emite `reverse_holo` como un `printing` DISTINTO con `market > 0` para cartas de un set 2026 nuevo (Pitch Black) | 1ª corrida: contar cartas del set con fila PPT `finish=reverse_holo` (`printing` reconocido) | Si PPT TAMBIÉN colapsa el set nuevo a un solo printing, la opción (c) **no rescata**; cae a **(a) override manual del admin** (remedio permanente, ver abajo). **Avisar al arquitecto.** |
| S-C2 | Los alias SUPUESTO de `BULK_VARIANT_TO_FINISH` que aparezcan en PPT corresponden de verdad al `Finish` mapeado | 1ª corrida: histograma de `printing` crudos vs. alias; log de `noFinish` con ejemplos | Se **promueven** a verificados los confirmados (se añaden a `VERIFIED_FINISH_ALIASES`) y se **descartan** los que no; hasta entonces NO alimentan la lista blanca (candado 2). |

**Remedio permanente para el residuo (opción (a), siempre disponible).** Si tras (c) una carta/set sigue sin la señal
(ambas fuentes ciegas — caso S-C1 falso), el remedio es el **override manual del admin** por carta/set (M2), nunca una
heurística por rareza (§4.22a-5). (a) queda como la salida documentada para el residuo; **NO** se elige (b)
`CardSet.hasReverseHolo` porque requiere decisión de producto y **arriesga inventar** reverse holo en cartas del set
que no lo tienen (viola anti-invención).

**Nota v1.22-2 / N-15 (relación con §4.22a-6).** La supresión de acabado espurio de N-15 opera **aguas abajo** de
toda la maquinaria de este §4.22g: se computa sobre `availableFinishes` **ya materializada** (unión money-safe de
`catalogFinishes ∪ pricedFinishesSnapshot`) y produce `displayFinishes ⊆ availableFinishes` **solo para pintar**.
**No** toca ninguna de las dos columnas de entrada, **no** toca la whitelist SEC-A1, **no** reintroduce la conversa
prohibida (precio ausente ⇒ quitar del universo de dinero) y —clave— **no** añade acabados: solo oculta. La
**prohibición de heurística por rareza (candado 3 / regla 5 / §4.22a-5) SIGUE VIGENTE**; N-15 usa la rareza
(`isPremiumRarity`) exclusivamente como *gate de display* para OCULTAR una casilla ya presente, **jamás** para
DERIVAR o INVENTAR una (en particular jamás un `reverse_holo`).

#### (h) Reparto de trabajo (v1.22-1 / opción c)

> **v1.27.1 (P-13-fix, §4.25e) — sección HISTÓRICA en lo que toca a la firma.** Este reparto se implementó en v1.22-1.
> La versión intermedia «solo structural» de la primera P-13 derogó la unión, pero el fix v1.27.1 la **restauró** con un
> filtro de `normal` por rareza premium: la fórmula vigente es `composeAvailableFinishes(structuralFinishes,
> pricedFinishesSnapshot, rarity)`. La expectativa de seed «carta A (común): snapshot con `reverse_holo` ⇒ casilla»
> **vuelve a ser CORRECTA** (la unión recompone); lo que NO produce casilla es un `normal` de snapshot/structural en
> una carta PREMIUM. Los seeds/fixtures se alinean a §4.25e (worked examples).

- **Schema — migración M-27 (backend, `backend/prisma/schema.prisma` + `backend/prisma/migrations/`):** añade
  `Card.catalogFinishes Finish[] @default([])` y `Card.pricedFinishesSnapshot Finish[] @default([])`. **Backfill:**
  `UPDATE "Card" SET "catalogFinishes" = "availableFinishes"` (siembra la base con el valor catálogo ya materializado;
  `pricedFinishesSnapshot` queda `[]`). No cambia la forma de `availableFinishes`. Es cambio de **zona compartida**
  (`backend/prisma/`) — un solo stream a la vez (regla de zonas compartidas).
- **`backend/src/modules/pricing/pricing.types.ts`:** (1) añadir `VERIFIED_FINISH_ALIASES` = espejo estricto de
  `TCG_KEY_TO_FINISH` (sin los SUPUESTO) y `normalizeVerifiedFinishAlias(raw): Finish | null`; (2) añadir
  `finishAliasVerified: boolean` a `BulkPriceRow`; (3) `deriveAvailableFinishes` **no cambia** (ahora alimenta
  `catalogFinishes`).
- **`backend/src/modules/pricing/providers/pokemonpricetracker-bulk.provider.ts`:** al construir cada `BulkPriceRow`,
  fijar `finishAliasVerified` con `normalizeVerifiedFinishAlias(rawPrinting) !== null`. El `finish` para PRICING sigue
  saliendo de `normalizeFinishAlias` (tolerante); el flag distingue si ese acabado es apto para la lista blanca.
- **`backend/src/modules/pricing/price-ingest.service.ts`:** tras agrupar `byCard` en una corrida **exitosa**, por cada
  carta vista con ≥1 fila válida, calcular `verifiedFinishes = { row.finish : row.finishAliasVerified && marketCents>0 }`,
  **escribir `Card.pricedFinishesSnapshot`** (REEMPLAZO por carta) y **llamar `FinishReconciler.reconcile(cardIds)`**.
  **Sigue sin escribir `availableFinishes` directamente** (assert en test). El log `finishNotInCatalog` se conserva.
- **`backend/src/modules/catalog/` — NUEVO `FinishReconciler` (único escritor de `availableFinishes`):**
  `reconcile(cardIds: string[])` lee `(catalogFinishes, pricedFinishesSnapshot)` de cada carta y escribe
  `availableFinishes = orderFinishes(catalogFinishes ∪ pricedFinishesSnapshot) || ['normal']`. La función pura de unión
  vive junto a `orderFinishes` (`backend/src/common/card-order.ts`) para reusarse desde seeds sin arrastrar DI.
- **`backend/src/modules/catalog/catalog-sync.service.ts` (`upsertCards`):** escribir `catalogFinishes` (en lugar de
  `availableFinishes`) con la MISMA semántica null de §4.22a-4 (CREATE `derived ?? ['normal']`; UPDATE omite la clave si
  `derived === null`), y **llamar `FinishReconciler.reconcile(cardIds)`** para las cartas del lote. Ya no escribe
  `availableFinishes` inline.
- **Seeds (§4.22e, `backend/prisma/seed*.ts` + `e2e-fixtures.ts`):** sembrar las tres columnas coherentemente para que
  el E2E cubra la ruta de la unión:
  - carta A: `catalogFinishes=['normal']`, `pricedFinishesSnapshot=['reverse_holo']`, `availableFinishes=['normal','reverse_holo']` — **prueba la ruta PPT-only** (el caso del PO con pokemontcg.io caído);
  - carta B: `catalogFinishes=['normal','reverse_holo']`, `pricedFinishesSnapshot=[]`, `availableFinishes=['normal','reverse_holo']` — prueba la ruta catálogo;
  - carta C: las tres vacías/`[]` ⇒ `availableFinishes=['normal']` — prueba que no se pinta relleno.
- **`dataHealth` (M2, recomendado):** además de `cardsWithoutFinishSignal`, distinguir «rescatadas por PPT»
  (`catalogFinishes` sin `reverse_holo` pero `availableFinishes` con él) para hacer visible cuánto sostiene la Señal C.
- **QA / verificación (money-safe, no cambia regla de precio):**
  - **Reconcile PPT-only:** stub de `BulkPriceProvider` que devuelve `reverse_holo` con `market>0` (alias verificado
    `reverseHolofoil`) para la carta X con `catalogFinishes=['normal']` ⇒ tras `price-ingest` + reconcile,
    `Card.availableFinishes = ['normal','reverse_holo']`; **E2E:** el binder pinta **dos** casillas.
  - **Anti-invención / SEC-A1:** `printing="foil"` (SUPUESTO) con precio ⇒ `PriceReference` se persiste como `holofoil`
    **pero** `pricedFinishesSnapshot` **NO** incluye `holofoil` y `availableFinishes` no cambia.
  - **Reparabilidad:** carta con `pricedFinishesSnapshot=['reverse_holo']`; una corrida PPT posterior que devuelve la
    carta **sin** `reverse_holo` ⇒ snapshot reemplazado ⇒ reconcile lo **quita** de `availableFinishes` (si
    `catalogFinishes` no lo tenía).
  - **Default seguro:** `catalogFinishes=[]` y `pricedFinishesSnapshot=[]` ⇒ `availableFinishes=['normal']`.
  - **Money-safe stale:** corrida PPT que falla (0 filas) ⇒ ningún snapshot se toca (spy), ningún clobber.
  - **Único escritor:** `price-ingest` nunca llama `card.update({ availableFinishes })` (spy); solo `FinishReconciler`.
- **Devops:** tras M-27, la secuencia de reparación es (1) deploy; (2) `price-ingest` de los sets afectados con PPT
  (puebla `pricedFinishesSnapshot` + reconcile) — **esto ya rescata «Pitch Black» sin esperar a pokemontcg.io**;
  (3) cuando pokemontcg.io recupere, `sync-all {force:true}` refresca `catalogFinishes`. Registrar S-C1/S-C2 en
  `DEVOPS_NOTES.md`.

---

### 4.23 WS «Sellado / Producto cerrado» — venta de producto cerrado (v1.23-sealed-sales)

> **Objetivo (spec CERRADO por el PO):** convertir el sellado (booster box, ETB, bundle, tin, blister) en una
> **línea de venta con precio derivado** — `precio de venta = referencia de mercado TCGCSV × spread por presentación`,
> con **override manual** por pieza — y darle **superficie propia**: una ventana de tienda filtrable por set (solo lo
> que hay en stock, agrupado con «N disponibles»), una **pestaña «Sellado»** en la bóveda del cliente y en la vista
> admin de bóveda, y tres diferenciadores **cableados pero apagados** (bóveda-inversión, tendencia de valor, «avísame
> cuando vuelva»). **Solo VENTA** (plataforma→cliente): NO hay buylist de sellado (call-out mailto en la ventana).
> **Toca precios (dinero) → triple veredicto.** Aditivo; **UNA migración (M-28, §11)** + cuatro diales `ConfigSetting`.
> Contrato completo (endpoints, DTOs, diff de esquema) en **API_CONTRACT §2-S / §3-S / §M2 / §M10**.

#### (a) Doctrina y PRECEDENCIA — el modelo de venta del sellado CAMBIA (supersede §3.6 y §4.19a)

Este WS **modifica deliberadamente** dos decisiones previas, por instrucción cerrada del PO. Debe reconciliarse en
`PROJECT.md` (dueño: product-owner; ver §10 «Supuestos v1.23» — **SUP-1**):

1. **§3.6 / criterio PROJECT «sellado = precio manual del admin en MXN, obligatorio para publicar»** → se **relaja**:
   el sellado se **auto-preciaba** con `mercado TCGCSV × spread`; el precio manual pasa de *único mecanismo* a
   *override de respaldo*. El invariante «Compra solo lista lo que tiene precio» **se conserva**: un sellado sin
   precio resuelto (ni override ni mercado×spread) **no se publica** (money-safe).
2. **§4.19a «la referencia TCGCSV es estrictamente informativa y NO se expone en la superficie pública»** → se
   **deroga en parte**: la referencia TCGCSV pasa a ser **la base del precio de venta** del sellado y su valor de
   mercado **sí se expone** (ficha pública, bóveda). El resto de §4.19 (adapter, ingest, curación, dial
   `sealed_price_source`, gradeKey `sealed:tcg:<productId>`) se **reusa sin cambios** — este WS es su *consumidor*.

**Precedencia del precio de venta del sellado (money-safe, SEC-A1 — todo server-side):**

```
override (InventoryItem.listPriceCents)                       ← gana SIEMPRE si está presente
  > mercado × (1 + spread_de_su_presentación / 100)           ← si hay sealedMarketRef y su SealedSubtype tiene spread
  > mercado × (1 + spread_global_de_respaldo / 100)           ← si hay sealedMarketRef pero sin spread de presentación
  > (sin precio) ⇒ PRICE_PENDING ⇒ NO se publica              ← money-safe: sin mercado y sin override, no se vende
```

- **`sealedMarketRef`** = la `PriceReference(cardId, 'sealed', 'sealed:tcg:<productId>', 'normal')` en **MXN centavos**
  (FX+colchón ya aplicado). Puede provenir de **dos fuentes**: (i) el ingest automático `sealed-price-ingest`
  (§4.19d, `source='tcgcsv'`) o (ii) un **override manual del admin/operador** («FIJAR PRECIO» / alta manual,
  `POST /admin/pricing/override` productType `sealed`, `source='manual'`/`isManualOverride=true`). El item debe estar
  **mapeado** (curación M2, §4.19c) para que la clave `sealed:tcg:<productId>` exista. Sin mercado de ninguna de las dos
  fuentes → `sealedMarketRef = null` → el sellado solo se vende con el **override de VENTA por pieza** (`listPriceCents`).
- **v1.43 (IMP-C) — QUÉ gatea el dial `sealedPriceSource`, con precisión (fix `gateSealedMarketCents`, resolver H-1 único):**
  el dial gobierna **SOLO la fuente (i), el ingest AUTOMÁTICO** (`source='tcgcsv'`). Un mercado de fuente automática con el
  dial `off` queda **inerte** (`gate → null`, fail-closed). Un **override manual** de fuente (ii)
  (`isManualOverride=true` / `source='manual'`) es una **decisión humana explícita** y **NO lo gatea el dial**: `gate`
  devuelve su `referenceMxnCents` **con `sourceOn` sea `true` o `false`**. Norma del predicado:
  ```
  gateSealedMarketCents(ref, sourceOn):
    if ref?.status !== 'priced' || ref.referenceMxnCents == null: return null
    if ref.isManualOverride === true || ref.source === 'manual': return ref.referenceMxnCents   // override manual: sobrevive al dial
    return sourceOn ? ref.referenceMxnCents : null                                              // mercado de fuente: gateado por el dial
  ```
  **Antes de v1.43** el gate anulaba TODO mercado con `sourceOn=false` (incluido el override manual) ⇒ un sellado con
  «FIJAR PRECIO» y dial `off` re-caía en `PRICE_PENDING` y **re-creaba el pendiente** en cada re-publicación (bucle IMP-C).
  El predicado es la **única** fuente de verdad (H-1) que consumen `catalog.toListingDTO`, `orders.salePriceOf`, el grid
  `loadPricedSealed` y `bulk-publish`; corregirlo aquí los arregla a los cuatro. `PriceInfo` debe exponer el discriminante
  del override manual (`source` basta — `manualOverride()` siempre escribe `source='manual'`; añadir `isManualOverride` es
  opcional). **Money-safe intacto:** sin `listPriceCents`, sin override manual de mercado y sin mercado automático
  aplicable ⇒ `PRICE_PENDING`, nunca 0. **No es cambio de producto** — §K/§4.23a ya definían el dial como gobernador del
  *ingest automático*; era un bug de gate. Ver API_CONTRACT changelog v1.43-sealed-manual-override-survives-dial.
- **SEC-A1:** override, subtype y mercado salen de **BD** (`InventoryItem` / `PriceReference`), los spreads de
  **`ConfigSetting`**; **nada** viene del DTO del cliente. El cliente solo envía `inventoryItemId`.
- **Congelado en `OrderItem.unitPriceCents`** al checkout → **sin snapshot de regla ni migración** de órdenes
  (paridad §4.14d; el spread no se snapshotea porque el precio ya se congela).

#### (b) Función pura `computeSealedSalePrice` (`backend/src/common/money.ts`)

Hermana de `computeSalePriceForRarity` (§4.14b), keyeada por **presentación** en vez de rareza+acabado:

```ts
export interface SealedSpreadResult {
  salePriceCents: number | null;
  status: 'priced' | 'pending';
  source: 'override' | 'subtype_spread' | 'global_spread';
  appliedSpreadPct: number | null;      // null cuando source='override'
}

export function computeSealedSalePrice(
  overrideCents: number | null,              // InventoryItem.listPriceCents (override manual por pieza)
  sealedSubtype: SealedSubtype | null,       // InventoryItem.sealedSubtype (de BD)
  marketMxnCents: number | null,             // sealedMarketRef.priceMxnCents (getReference sealed:tcg:<productId>)
  spreadPctBySubtype: Record<string, number>,// SEALED_SPREAD_PCT_BY_SUBTYPE
  fallbackPct: number,                       // SEALED_SPREAD_FALLBACK_PCT
): SealedSpreadResult {
  if (overrideCents != null) {
    return { salePriceCents: overrideCents, status: 'priced', source: 'override', appliedSpreadPct: null };
  }
  const hasSubtypeSpread = sealedSubtype != null && spreadPctBySubtype[sealedSubtype] != null;
  const spread = hasSubtypeSpread ? spreadPctBySubtype[sealedSubtype] : fallbackPct;
  const source = hasSubtypeSpread ? 'subtype_spread' : 'global_spread';
  if (marketMxnCents == null) {
    // Sin mercado y sin override → pendiente (no publicable). NUNCA se inventa un precio.
    return { salePriceCents: null, status: 'pending', source, appliedSpreadPct: spread };
  }
  return { salePriceCents: Math.round(marketMxnCents * (1 + spread / 100)),
           status: 'priced', source, appliedSpreadPct: spread };
}
```

- **La condición NO altera el precio derivado** (el spread es por presentación, no por condición). Para **descontar**
  una caja `minor_box_damage` el admin usa el **override** de esa pieza. (SUP-2, §10 — un multiplicador por condición
  se puede añadir después sin romper contrato.)
- **`pct` = markup ARRIBA de mercado** (misma semántica que el `pct` de venta de §4.14, **no** «% de la referencia»
  del buylist). `value` numérico en `[0, SEALED_SPREAD_PCT_MAX]` (propuesta `1000`, igual que ventas).

#### (c) Config de spreads (diales M2, `ConfigSetting` — estilo M10, editables sin redeploy)

Dos `SettingKey` nuevos (`settings.constants.ts`), **espejo** de `SALES_PRICE_RULES`/`SALES_PRICE_FALLBACK_PCT`
pero keyeados por `SealedSubtype`:

- `SEALED_SPREAD_PCT_BY_SUBTYPE` (`sealed_spread_pct_by_subtype`): mapa `{ [SealedSubtype]: number }` — markup % por
  presentación. Validador: cada clave ∈ `{box, etb, bundle, tin, blister}`, cada `value` número en `[0, 1000]`.
- `SEALED_SPREAD_FALLBACK_PCT` (`sealed_spread_fallback_pct`): markup % global de respaldo (número en `[0, 1000]`),
  usado cuando la pieza no tiene `sealedSubtype` o su subtype no está en el mapa.

**Seed inicial propuesto (editable en M2; PO confirma los números — SUP-6, §10):**
```jsonc
// SEALED_SPREAD_PCT_BY_SUBTYPE  (markup % arriba de mercado, por presentación)
{ "box": 18, "etb": 22, "bundle": 25, "tin": 30, "blister": 35 }   // ítems chicos → % mayor
// SEALED_SPREAD_FALLBACK_PCT = 25
```
Se editan por **endpoints M2 dedicados** (no por `PUT /admin/settings`, igual que las reglas de venta/buylist):
`GET/PUT /admin/pricing/sealed-spreads`, **auditados** (`action=pricing.sealed_spreads.update`, before/after).

> **Money-safe (SUP-8):** un spread de `0` vende a mercado sin margen; el validador **permite** `≥ 0` pero el editor
> M2 debe advertirlo. No se fuerza `> 0` para no bloquear una promo deliberada; PO decide si quiere piso.

#### (d) Aplicación — dónde se resuelve el precio del sellado (2 call-sites, mismo patrón §4.14d)

Nuevo método en `PricingService` (o `PricingService.computeSealedSalePriceForItem(item)`):
lee `SEALED_SPREAD_PCT_BY_SUBTYPE` + `SEALED_SPREAD_FALLBACK_PCT`, obtiene `sealedMarketRef` con
`getReference(item.cardId, 'sealed', sealedMarketGradeKey(item.tcgplayerProductId), 'normal')` (o `null` si no
mapeado) y llama la pura. Se **ramifica por `productType`** en los dos resolvedores de precio existentes:

- `catalog.service.toListingDTO`: `raw|graded` → `computeSalePriceForItem` (§4.14); **`sealed` → `computeSealedSalePrice`**.
  Un sellado con override o con mercado+spread ⇒ `salePriceCents` resuelto ⇒ `sellable=true`. Sin ninguno ⇒ `pending`
  ⇒ no vendible (regla «solo se lista lo que tiene precio»).
- `orders.service.salePriceOf`: idem — para `sealed`, deriva por override/mercado×spread; si `pending` → `422 PRICE_PENDING`.
- `bulk-publish` (§M1): la rama `sealed` deja de exigir `listPriceCents`; ahora **deriva** por override/mercado×spread.
  Sellado sin override **y** sin mercado → línea `PRICE_PENDING`, no se publica (money-safe, sin cambio de código de
  error). Reusa `getReferencesBatch` + iza los spreads **una vez** por request (BE-25). **v1.43 (IMP-C):** el `mercado`
  que consume incluye el **override manual** (`isManualOverride`) que NO gatea el dial — así una re-publicación tras
  «FIJAR PRECIO» con dial `off` **resuelve el precio y NO re-escala el pendiente** (el bucle vivía aquí porque el gate
  anulaba el override). Todos los call-sites comparten `gateSealedMarketCents` (H-1), así que el fix es un solo punto.

#### (e) Ventana de tienda del sellado — listado AGREGADO por producto (público)

Superficie propia (`(storefront)/sellado`, front) servida por **endpoints nuevos** (§2-S). El listado agrega las
**piezas idénticas** en una tarjeta con «N disponibles»; el modelo por-pieza **no cambia** (sigue 1 `InventoryItem`
por pieza física, unit-based).

- **Clave de agrupación (grupo = «un producto a la venta»):**
  `mapeado (tcgplayerProductId != null)` → `p:<tcgplayerProductId>:<sealedCondition>` ·
  `no mapeado` → `c:<cardId>:<sealedSubtype>:<sealedCondition>`. **La condición SEPARA grupos** (una tarjeta `mint` y
  otra `minor_box_damage` del mismo producto). *(SUP-5: si el mismo producto tiene piezas mapeadas y no mapeadas,
  aparecerían como dos tarjetas; se mitiga **curando el mapeo**. El front puede coalescer por `cardId+subtype` si se
  requiere; se recomienda mapear.)*
- **Alcance:** solo piezas `productType='sealed' AND status='listed' AND ownerType='platform'` con precio resuelto
  (`sellable=true`). Cada grupo expone: nombre e imagen (imagen **TCGCSV** si mapeado, si no la de catálogo de la
  `Card`), `sealedSubtype`, `sealedCondition`, `availableCount` (piezas disponibles), `fromPriceCents` (mínimo
  `salePriceCents` del grupo), `referenceValue: PriceInfo` (valor de mercado TCGCSV, informativo) y
  `representativeItemId` (la pieza más barata → add-to-cart / ficha).
- **Sin N+1:** una query de las piezas `sealed listed` de la página + `getReferencesBatch` de sus `sealedMarketRef`
  + `groupBy` en memoria de la página (patrón `set-value.service`). Filtro por `setId`, `sealedSubtype`, `condition`,
  `q`; paginado; `sort` `price_asc|price_desc|newest`.
- **Detalle (ficha):** `GET /catalog/sealed/:inventoryItemId` devuelve el grupo + `listings: ListingDTO[]` (todas las
  piezas disponibles del mismo grupo, más baratas primero) para que el comprador **elija cantidad** (el carrito es
  por-pieza: agrega hasta `availableCount` `inventoryItemId`s). Reusa `ListingDTO` (que para sellado ya lleva
  `referenceValue` = `sealedMarketRef` y `salePriceCents` = derivado/override).
- **Call-out anti-buylist (mailto, front):** la ventana muestra el texto fijo *«¿Quieres revender tu sellado a TCG
  Vault MX? Escríbenos a contacto@tcgvaultmx.com con fotos y lo cotizamos.»* — **no** es un endpoint; **no** hay
  buylist de sellado (fuera de alcance, PROJECT).

#### (f) Destino (envío / bóveda) — reuso TOTAL del checkout existente

**Cero trabajo nuevo de checkout/fulfillment.** Una pieza sellada es un `InventoryItem(productType='sealed')`
`listed`/`platform`, indistinguible para el carrito, `POST /checkout/quote|session` (customer) y `/checkout/guest/*`
(invitado). Aplican **igual**: `FulfillmentMode = vault | direct_ship`, `vault` requiere cuenta (invitado →
`direct_ship`, upsell §4-G), `direct_ship` cobra el envío en el mismo PaymentIntent (`shippingFeeCents`). Sellado a
bóveda entra con titularidad `pending → settled` como una carta; sellado a envío directo se prepara y despacha por
`ShipmentRequest`. La disputa de sellado (`condition_sealed`, caja dañada/equivocada) ya existe (§3.6/§7). Lo único
que el checkout necesita es que `salePriceOf(sealed)` resuelva por (d) — ya cubierto.

#### (g) Pestaña «Sellado» en la bóveda (cliente + admin), agrupada y valuada

La bóveda gana una **segunda pestaña** junto a «Cartas» (el binder master-set, §4.20). Endpoints nuevos que **agregan
las piezas selladas del usuario** por grupo (mismo criterio de (e)) con conteo y **valor de mercado actual**:

- **Cliente:** `GET /vault/sealed` (`customer`, siempre `userId = el autenticado`).
- **Admin:** `GET /admin/vaults/:userId/sealed` (`vault_operator+`, módulo `vault`, hermano de §4.20c).
- **Valuación = misma base del portafolio (§3):** `sealedMarketRef` por pieza vía `getReferencesBatch`; piezas sin
  mercado (unmapped / sin ingest) se **excluyen** del total y se cuentan en `pendingPriceCount`. Muestra imagen,
  `sealedCondition`, `count` (y desglose `pending|settled`), `marketValue` por pieza y `totalMarketValueMxnCents`.
- **Omisiones por scope (regla dura §4.20):** nunca ubicación/costo/folio; `email` del owner solo en la vista admin.
- **Nota de coexistencia (ACTUALIZADA v1.42):** las piezas selladas **siguen** apareciendo en `GET /vault/holdings`
  (por-pieza) **pero con su propia identidad** (`sealedProductName`/`sealedImageUrl`, cascada §4.34a; BLOQ-2a — ya NO se
  pintan como la carta ancla). En el binder master-set **quedan EXCLUIDAS** (no cuentan como `finish=normal`; BLOQ-3, §4.20b).
  La cláusula previa «pre-existente §4.20b — fuera de alcance cambiarlo» queda **DEROGADA** (era anterior al módulo
  `SealedProduct`/P-38, §4.34). La pestaña «Sellado» es la superficie **dedicada** y agrupada. *(SUP-4: con `sealedMarketRef` ahora poblado, el sellado
  entra a la valuación del portafolio general; se recomienda incluirlo en el snapshot de tendencia — es una holding
  más priceada. PO confirma.)*

#### (h) Diferenciadores CABLEADOS pero APAGADOS (feature-flagged; el contrato queda definido)

Dos diales `ConfigSetting` (seed **off**) gobiernan la superficie; el backend puede implementarlos ya, el front llega
después. Con el flag `off` el endpoint responde `404 FEATURE_DISABLED` (o el front no lo llama).

- **(a) Bóveda para sellado como inversión:** es la pestaña (g) + valuación; el framing «inversión» (rendimiento,
  costo-base) es **copy del front** sobre datos ya presentes. No requiere contrato extra más allá de (g)/(b).
- **(b) Tendencia de valor del sellado** (`sealed_value_trend`, off): reusa el **historial de `PriceReference`** que el
  job `sealed-price-ingest` **ya acumula** por día en `sealed:tcg:<productId>` — **cero fabricación de datos**.
  `GET /catalog/sealed/:inventoryItemId/value-history` devuelve una serie estilo `SetValueHistoryResponse` (reusa el
  patrón `SetValueService`, rangos `5d…all`). Fuente: `PriceReference` por `capturedDate` de ese gradeKey. Solo
  productos **mapeados** tienen serie (los no mapeados no tienen historial de mercado).
- **(c) «Avísame cuando vuelva»** (`sealed_restock_alerts`, off): alerta por correo para productos **agotados**.
  `POST /catalog/sealed/restock-subscriptions` (`public` — acepta correo de invitado o de usuario logueado) guarda una
  `SealedRestockSubscription` (modelo nuevo M-28) keyeada por identidad de producto (`tcgplayerProductId` si mapeado,
  o `cardId+sealedSubtype`) + `sealedCondition` + `email` (normalizado). Un job cableado (no agendado hasta el flip)
  detecta cuando un producto de esa identidad vuelve a `status='listed'` y envía correo (reusa el módulo `mail`,
  §PROJECT). Rate-limit + respuesta neutra (no revela si el producto existe), a la par del reenvío de enlace de
  invitado (§4-G). *(SUP-5: una página de producto agotado debe ser direccionable para que el front ofrezca la
  suscripción; con productos mapeados la identidad `tcgplayerProductId` es estable. Detalle de UI = cuando se encienda.)*

#### (i) Deltas de schema Prisma PROPUESTOS (migración M-28, §11) — «ya existe» vs «nuevo»

**Ya existe y se reusa (NO se toca):** `enum ProductType.sealed`, `enum SealedSubtype {box|etb|bundle|tin|blister}`,
`InventoryItem.productType/sealedSubtype/listPriceCents/tcgplayerProductId/tcgplayerGroupId`,
`enum PriceSource.tcgcsv`, `PriceReference` (gradeKey `sealed:tcg:<productId>`, `finish='normal'`), el dial
`sealed_price_source`, `Dispute.type='condition_sealed'`, todo el checkout/fulfillment.

**Nuevo (M-28, aditivo y nullable — `backend/prisma/` es ZONA COMPARTIDA, el orquestador serializa):**

| # | Modelo / campo | Cambio | Nota |
|---|---|---|---|
| M-28 | `enum SealedCondition { mint, minor_box_damage }` | Enum nuevo | Condición simple del sellado, **visible al comprador**. `mint` = «Como nueva» · `minor_box_damage` = «Detalle menor en caja». Labels legibles en i18n del front (no en API). |
| M-28 | `InventoryItem.sealedCondition SealedCondition?` | Columna nueva (nullable) | **App-requerido para `sealed`** (default `mint`); `null` para raw/graded (regla de aplicación, no constraint de BD). **Backfill:** `UPDATE ... SET sealedCondition='mint' WHERE productType='sealed' AND sealedCondition IS NULL`. |
| M-28 | `InventoryItem @@index([productType, status])` | Índice nuevo (recomendado) | Sirve el grid público del sellado (`productType='sealed' AND status='listed'`) sin barrer la tabla. Complementa los índices existentes. |
| M-28 | `model SealedRestockSubscription` | Tabla nueva (feature-flagged) | Ver (h)(c). Campos: `id`, `email` (normalizado), `userId String?` (FK opcional `onDelete: SetNull`), `cardId` (FK), `sealedSubtype SealedSubtype?`, `tcgplayerProductId Int?`, `sealedCondition SealedCondition`, `notifiedAt DateTime?`, `createdAt`. Índices: `@@index([tcgplayerProductId, sealedCondition, notifiedAt])`, `@@index([email])`. |

**Sin migración de `PriceReference` ni de `Order`/`OrderItem`** (el precio se congela en `unitPriceCents`, sin snapshot
de spread). **Config/diales (dato, no esquema):** `sealed_spread_pct_by_subtype`, `sealed_spread_fallback_pct`
(§c), `sealed_value_trend`, `sealed_restock_alerts` (§h), sembrados por el seed de settings.

#### (j) Reparto de trabajo (v1.23) y reuso

- **Backend:** (1) `computeSealedSalePrice` + `computeSealedSalePriceForItem`; ramificar los 2 call-sites + bulk-publish
  (§d); (2) diales de spread + `GET/PUT /admin/pricing/sealed-spreads` (§c, clones de sales-rules); (3) grid público
  agregado + ficha (§2-S); (4) `GET /vault/sealed` + `GET /admin/vaults/:userId/sealed` (§g); (5) migración M-28;
  (6) endpoints feature-flagged (§h: value-history del sellado, restock-subscriptions) + su dial; (7) tests: precedencia
  override>subtype>global>pending, money-safe (sin mercado ni override → no publicable), agrupación/«N disponibles»,
  condición separa grupos, checkout de sellado vault/direct_ship/guest, valuación de bóveda sellado con pendientes
  excluidos, SEC-A1 (precio nunca del DTO).
- **Frontend:** ventana `(storefront)/sellado` (grid filtrable por set + ficha + call-out mailto), pestaña «Sellado»
  en «Mi bóveda» y en la vista admin de bóveda, editor de spreads en M2 (clon del editor de reglas de venta), captura
  de `sealedCondition` en el alta M1. (Trabajo de frontend; no del arquitecto.)
- **Reuso (no se reinventa):** adapter/ingest/curación TCGCSV + `sealedMarketRef` (§4.19); pipeline FX; `PriceReference`
  (`sealed:tcg:<productId>` + su historial para la tendencia); patrón `ConfigSetting`/endpoints M2 (§4.2/§4.14);
  `getReferencesBatch` + base de valuación del portafolio (§3/§4.20c); patrón `SetValueService` (§4.12) para la
  tendencia; checkout/orders/payments/shipments/guest-checkout (§4.21) sin cambios; `Dispute condition_sealed` (§3.6/§7);
  módulo `mail` para restock.

---

### 4.24 WS «Precios, variantes y master set» — estructura autoritativa, publish-con-precio y master set operable (v1.26)

> **Bundle aprobado por el PO (5 piezas).** Extiende, sin re-litigar, la maquinaria de variantes de §4.22/§4.22g. Toca
> dinero en ④/⑤ (gate de seguridad posterior). Migración **M-29** (§11), aditiva y nullable. Contrato en API_CONTRACT
> §M1/§M2. **Reparto en dos batches de commit** (ver §4.24f) para que el orquestador los mergee por separado.

#### (a) ① Composición de variantes DETECTADA desde TCGCSV (fuente ESTRUCTURAL autoritativa)

**Problema que quedó abierto (§4.22g S1/S2 y §4.22d-4).** `catalogFinishes` deriva de la **presencia de una llave de
precio** (`tcgplayer.prices` ∪ `cardmarket.reverseHolo*`): es un **proxy de precio**, no una afirmación estructural.
Cuando pokemontcg.io colapsa un set nuevo a un solo `printing` (caso «Pitch Black», «Surging Sparks»), la señal se
pierde. La **fuente estructural autoritativa** es **TCGCSV** (espejo de TCGplayer): sus filas de precio traen
`subTypeName` (`Normal`/`Holofoil`/`Reverse Holofoil`) que **existe aunque `marketPrice` sea `null`** ⇒ **estructura ≠
precio**. Evidencia real en la fixture `backend/test/fixtures/tcgcsv/prices-23821.json` (Surging Sparks, sv8): filas
`subTypeName='Normal'` con `marketPrice: null` (estructura sin precio = «pendiente»); `Pikachu ex 057/191` (rareza DR)
= **solo `Holofoil`** (premium de una impresión, SIN `normal` fantasma).

**Columna nueva — `Card.structuralFinishes Finish[] @default([])` (M-29).** Es «¿en qué impresiones físicas se vende
esta carta?» — la afirmación **estructural autoritativa**. **Ancla/reemplaza** a `catalogFinishes` como entrada del
lado catálogo en la unión del reconciliador:

```
availableFinishes  :=  orderFinishes( structuralFinishes ∪ pricedFinishesSnapshot )   ||  ['normal']
```

> **v1.27.1 (P-13-fix, §4.25e) — la unión cruda de arriba queda AFINADA (no eliminada).** La unión cruda dejaba pasar
> el `normal` fantasma de las cartas premium (el `normal` CON precio que atribuye `fetchPrintings` por etiqueta de
> request, o el structural stale de M-29). La versión intermedia «solo structural» de la primera P-13 mató la unión
> entera y con ella el reverse holo legítimo de los comunes (regresión en prod). La fórmula VIGENTE es
> `availableFinishes := orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot) − { normal | isPremiumRarity(rarity) } ) || ['normal']`:
> la unión se conserva (el precio confirma impresiones físicas reales) y solo se filtra `normal` por rareza premium.
> Todo lo demás de esta sección (columna `structuralFinishes`, resolver TCGCSV, semántica de escritura, S-D1..3) sigue
> vigente. Ver §4.25e.

- `structuralFinishes` — derivada de TCGCSV (ver resolver abajo). La escribe **un solo sitio nuevo** en el módulo
  `catalog` (paso de `importSet`), **no** `price-ingest`.
- `pricedFinishesSnapshot` — **sin cambio** (Señal C money-safe de §4.22g: PPT `market>0` + alias VERIFICADO).
- `catalogFinishes` — **sale de la fórmula** (era el proxy de precio que el PO rechaza). **Se conserva la columna**
  para: (i) **seed** de `structuralFinishes` en el backfill y en CREATE, (ii) observabilidad (`dataHealth`: «opinión
  de pokemontcg.io»). Su escritor (`upsertCards`) **no cambia**.
- **`FinishReconciler` sigue siendo el ÚNICO escritor** de `availableFinishes` (candado 4, §4.22g). Solo se sustituye
  la columna de entrada del lado catálogo: `reconcile()` lee `(structuralFinishes, pricedFinishesSnapshot)`.

**VAR-1 intacto (money→estructura prohibido).** El precio jamás sobrescribe/encoge la estructura, y la **presencia de
una llave de precio jamás AÑADE estructura**. Una impresión de `structuralFinishes` **sin** `PriceReference` es
**«pendiente»** (whitelist la admite ⇒ vendible tras precio; el binder puede ocultarla vía `displayFinishes`/N-15),
**nunca inventada y nunca dropeada**. La anti-invención (candado 3) se conserva: un `subTypeName` desconocido/no
mapeable ⇒ se **OMITE** (jamás se atribuye a `normal`).

**Semántica money-safe de la escritura de `structuralFinishes` (espejo de la del snapshot PPT, §4.22g).**
- **CREATE (`upsertCards`)** → `structuralFinishes = derived ?? ['normal']` (**seed** desde la señal de pokemontcg.io;
  evita que una carta recién sincronizada quede en blanco antes de que corra el resolver TCGCSV).
- **UPDATE (`upsertCards`)** → **NO toca `structuralFinishes`** (pokemontcg.io no es autoridad estructural; solo
  refresca `catalogFinishes`). La autoridad de UPDATE es el **resolver TCGCSV**.
- **Resolver TCGCSV (`importSet`, first-import o `--force`)** → **REEMPLAZA** `structuralFinishes` por carta **solo**
  para las cartas que pudo **joinear** a ≥1 producto/fila TCGCSV. Una carta que no joinea (sin `tcgplayerId`, sin match
  por número) **conserva** su valor previo (stale conservador: falta-una-casilla, nunca sobra-una-falsa). El
  `sync-all {force:true}` reprocesa y **repara** (unión recomputable, no monótona).

**Poblar `Card.tcgplayerId` (requisito nuevo).** La columna existe (`schema.prisma:401`) pero **nadie la escribe hoy**.
`upsertCards` la puebla parseando el **`productId`** de `RemoteCard.tcgplayer.url` (formato `.../product/<id>`;
el cliente `pokemontcg-io.client.ts` ya trae `tcgplayer.url`). Es el ancla del join a TCGCSV (y la usa P-7, §4.24e).

**Resolver `resolveStructuralFinishesForSet(localSetId)` (algoritmo NORMATIVO).** Reusa el **patrón anti-SSRF de host
fijo** del proveedor sellado existente (`tcgcsv-sealed.provider.ts:77,79`: host `https://tcgcsv.com/tcgplayer`,
categoría Pokémon `=3` constante de servidor, `groupId` validado como entero positivo, `redirect:'error'`, timeout).
Se recomienda extraer un `TcgcsvCatalogClient` que comparta ese `getJson`/`assertValidGroupId` (o un provider hermano
`tcgcsv-singles.provider.ts`), **sin** reinventar la seguridad.

1. **Resolver el `groupId` TCGCSV del set.** Reusar `CardSet.pptSetId` cuando es el **GroupId numérico de TCGplayer**
   (ya cacheado por `PptSetMapper`, `schema.prisma:381`) — TCGplayer group = TCGCSV group. Si `pptSetId` es un slug/no
   numérico ⇒ resolver por match de nombre contra `listGroups()` (patrón existente) y **cachearlo**. *(Supuesto S-D3:
   `pptSetId` numérico == groupId TCGCSV. Verificar en vivo.)*
2. **Fetch por set (=grupo):** `/{3}/{groupId}/products` (con `extendedData` → `Number` por carta) y
   `/{3}/{groupId}/prices` (filas `{ productId, subTypeName, marketPrice }`).
3. **Agrupar por CARTA (candado del open-question).** TCGplayer puede representar las impresiones de una carta como
   **varias filas bajo UN `productId`** O como **`productId`s SEPARADOS**. El resolver **UNE los `subTypeName` de TODAS
   las filas que pertenecen a la MISMA CARTA**, agrupando por **número de carta dentro del set** (`extendedData.Number`,
   p. ej. `"057/191"`): robusto a ambas representaciones. Un `productId` sin fila de precio no aporta señal.
4. **Mapear `subTypeName → Finish`** (espejo estricto, alias VERIFICADO; desconocido ⇒ OMITE):
   `Normal→normal`, `Holofoil→holofoil`, `Reverse Holofoil→reverse_holo`, `1st Edition Holofoil→first_edition_holofoil`.
5. **Join número→`Card`** dentro del set local: por `Card.number` == `extendedData.Number` normalizado, con
   `Card.tcgplayerId` (== `productId`) como ancla/validación. Escribir `structuralFinishes = orderFinishes(unión)` por
   carta joineada (reemplazo money-safe del punto anterior) y **llamar `FinishReconciler.reconcile(cardIds)`**.

**⚠️ Verificación en vivo pendiente (el sandbox bloquea `tcgcsv.com` por allowlist de egress).** El adapter se calibra
contra las fixtures; su confirmación es una corrida **en Railway** (dueño: backend + devops registra en DEVOPS_NOTES):

| # | Supuesto | Cómo se verifica | Si resulta falso |
|---|---|---|---|
| S-D1 | TCGplayer/TCGCSV representa las impresiones de una carta como **filas por `subTypeName`** (mismo o distinto `productId`) | 1ª corrida: para un set moderno, histograma de `subTypeName` por número de carta; contar cartas con `Normal`+`Reverse Holofoil` | Si colapsa a un solo printing como pokemontcg.io, ① no rescata ese set; cae a Señal C (PPT) y al override admin (§4.22g remedio (a)). **Avisar al arquitecto.** |
| S-D2 | El `subTypeName` existe **aunque `marketPrice` sea `null`** (estructura ≠ precio) | 1ª corrida: contar filas `subTypeName≠null` con `marketPrice=null` (la fixture ya lo muestra) | Si `subTypeName` solo aparece con precio, ① degenera en proxy de precio; documentar y volver a §4.22g. |
| S-D3 | `CardSet.pptSetId` numérico == `groupId` de TCGCSV | 1ª corrida: fetch `/{3}/{pptSetId}/products` y comparar nombres | Resolver el groupId por nombre vía `listGroups()` y cachear (columna `CardSet.tcgplayerGroupId`, coordinar zona prisma). |

#### (b) ② ④ Publicar SIEMPRE con precio: ESCALAR el pendiente en vez de dropear en silencio

**Diagnóstico.** `bulkPublish` (`inventory.service.ts:404-576`) lanza `PRICE_PENDING` por-línea para una variante sin
precio (raw `:502-507`, sellado `:481-486`) pero **NO** escala a la cola: la variante se cae **en silencio** y nadie
en M2 sabe que hay que preciarla. Compárese con `createItem` (`:127`) que **sí** escala (`escalatePending`,
`context='inventory'`).

**Norma v1.26.** En cada rama que hoy lanza `PRICE_PENDING` en `bulkPublish`, **ANTES** de lanzar (o en el `catch` de
la línea), llamar `pricing.escalatePending(cardId, productType, gradeKey, 'inventory', undefined, finish)` — dedupe por
`(cardId, productType, gradeKey, finish, status='open')` ya lo hace idempotente (`pricing.service.ts:446-449`). La pieza
**NO se publica** (sigue en su status de origen `in_stock`); el admin fija precio (override M2 `POST
/admin/pricing/override`, o `listPriceCents` por-línea en un re-publish) y el re-publish **procede**. **No cambia el
código de error** (`PRICE_PENDING`), no es breaking.

- **Allowlist de status de origen publicable — DOCUMENTAR en contrato (hoy solo auto-nota `inventory.service.ts:75-76`).**
  `PUBLISHABLE_ORIGIN_STATUSES = {in_stock, listed}` (anti-double-sell, `:78`). Ya está en API_CONTRACT §M1 (v1.16.1);
  se **ratifica** junto a la regla nueva «priceless → encolar, no dropear».
- **DTO aditivo `pendingPriceEntryId?` en `BulkPublishLineResult`** (para deep-link de UI a la entrada de M2). Marcado
  **aditivo/opcional**: presente solo en la línea que escaló. `escalatePending` hoy devuelve `void` ⇒ para poblarlo hay
  que devolver el `id` (o releer la entrada open); **si se prefiere no tocar la firma, el campo queda como mejora
  opcional** y la línea reporta `ok:false, error.code='PRICE_PENDING'` sin el id (retro-compatible).

#### (c) ③ P-6 cola manual de precios de DOS BUCKETS (VENTA / COMPRA)

Reusa **`PendingPriceEntry`** (`schema.prisma:613-632`, enum `context = catalog | portfolio | buylist | inventory`) y
**M2 `GET /admin/pricing/pending`** (`pricing.controller.ts:114` → `pricing.service.pendingQueue()`:616). **Sin schema
nuevo, sin endpoint nuevo:** `pendingQueue()` gana un parámetro **opcional `context`** (y el endpoint un query param
`?context=`), para que M2 sirva dos buckets:

- **VENTA** = `context='inventory'` — inventario (incl. no publicado): ya se escala en `createItem` (`:127`) y **ahora
  también en `bulkPublish`** (§4.24b).
- **COMPRA** = vista **READ-ONLY** sobre `context='buylist'` — **solo display**. `context='buylist'` lo escala el
  stream buylist (`buylist.service.ts:306`).

**CRÍTICO — límite de stream (buylist es OTRO flujo).** Producir el **precio de compra** on-request es un **WRITE del
buylist** (`itemDecision`, `buylist.service.ts:712-813`, acoplado a un control INE/AML sobre `precio_pendiente`
`~352-353`) — **FUERA DE ALCANCE de este pass**. Nuestro COMPRA es **display read-only**; jamás escribe una decisión de
compra ni resuelve un pendiente de buylist desde M2-VENTA.

**Invariante del hazard de tabla compartida (DECIDIDO + documentado).** `manualOverride` (`pricing.service.ts:571-607`)
resuelve pendientes **CONTEXT-AGNÓSTICO**: su `updateMany` filtra `{cardId, productType, gradeKey, finish, status:'open'}`
**sin `context`** (`:602-605`) ⇒ un override de **VENTA** cierra **también** el pendiente de **COMPRA** de la misma
variante (y viceversa). Decisión:

- **(a) Se CONSERVA agnóstico por ahora (recomendado).** Es el comportamiento actual; ambos buckets comparten la misma
  `PriceReference` por `(cardId, productType, gradeKey, finish)`, así que un precio fijado **es** válido para las dos
  caras. No hay riesgo de dinero: fijar un precio no mueve dinero saliente; el buylist recomputa su monto por su propia
  ruta (rareza/regla) al leer la referencia. **Se DOCUMENTA el acoplamiento** para que nadie lo lea como bug.
- **(b) Alternativa (NO en este pass): añadir un `context` scope al `updateMany` de `manualOverride`.** Sería un cambio
  en **NUESTRO** archivo (`pricing.service.ts`) del que **depende el stream buylist** (comparte `PendingPriceEntry` y
  `escalatePending`/resolución). Por eso **REQUIERE serialización/coordinación con el stream buylist** — **no se cambia
  unilateralmente en este pass**. Solo se justificaría con una razón de money-safety concreta (no la hay hoy).

#### (d) ④ P-2 precio de mercado en la teja del Master Set (M1)

El DTO por celda (`MasterSetCardCellDTO`/`MasterSetVariantDTO`, `master-set.service.ts:70-137`) **no lleva precio** hoy.
Campo **aditivo opcional**: `MasterSetCardCellDTO.marketReferenceMxnCents?: number | null` (y/o por variante en
`MasterSetVariantDTO` si el front lo pide por acabado — ver contrato). **v1.27 (P-15, §4.25b): la pregunta quedó
resuelta — el precio de mercado vive POR VARIANTE (`MasterSetVariantDTO.marketReferenceMxnCents`); el campo de celda
queda DEPRECADO (espejo del acabado base, una versión).** Se puebla con la infraestructura **ya inyectada**
del binder (`master-set.service.ts:424` usa `getReferencesBatch`/`getPricedRawFinishesBatch`), FX-recomputado a MXN con
la misma lógica `liveMxnCents` (`pricing.service.ts:104`, USD→MXN vigente).

**SEMÁNTICA DECIDIDA Y DECLARADA:** «precio de mercado» = **REFERENCIA DE MERCADO** = la `PriceReference` cruda
ingerida (`referenceMxnCents`), **NO** el precio de venta derivado (`referencia × (1+markup)`). El PO dijo «precio de
mercado» ⇒ se sirve la **referencia**, no la venta. (El precio de venta ya vive en `buyable.salePriceCents` para la
vista cliente; la teja admin muestra el **mercado**.) Se **declara** en el DTO y en API_CONTRACT §M1. `null` cuando la
referencia está `pending` (no se inventa un 0). Es sólo lectura/visual; no toca SEC-A1.

#### (e) ⑤ P-7 publicar + repreciar FRESCO desde el Master Set (M1)

`bulkPublish` ya publica y precia desde la **`PriceReference` almacenada más reciente**. **Brecha:** no existe un fetch
**on-demand por carta puntual** (los proveedores solo hacen bulk por-set). Contrato v1.26 (aditivo, dinero → gate de
seguridad posterior):

1. **Proveedor — método de fetch FRESCO puntual.** En la interfaz de proveedor de precios raw (PPT bulk / pokemontcg.io),
   un método `fetchFreshForCards(cards)` que trae precio **fresco** de carta(s) específicas y **upsert** de
   `PriceReference` (reusa `persistMarketReference`, `pricing.service.ts:474`, con FX del día). Usa `Card.tcgplayerId`
   (poblado en ①) para el lookup puntual del proveedor. **Cuota/rate:** PPT tiene **cuota diaria** ⇒ el método es
   **por-carta acotado** (cap N por request, respeta el `dailyLimited` que ya expone `sync-status`), NUNCA un barrido.
2. **`PricingService.refreshCardPrices(cardIds, finishes?)` on-demand** que orquesta el proveedor + upsert, con el
   mismo cache diario/rate-limit del ingest.
3. **Acción «publicar (+reprecio fresco)» desde master-set.** Refresca la(s) `PriceReference` **ANTES** de resolver el
   precio, funciona sobre inventario **UNPUBLISHED** (`in_stock`), y **HEREDA el gate ④** (§4.24b): si tras el refresh
   sigue sin precio → **escala pendiente, NO publica**. Endpoint/flag aditivo (ver API_CONTRACT §M1: flag
   `repriceFresh?: boolean` en `bulk-publish`, o endpoint hermano `POST .../items/reprice`). Money-touching → gate de
   seguridad posterior (dinero: fija el precio con el que se lista/vende).

#### (f) Reparto de trabajo y BATCHES DE COMMIT (para el orquestador)

**Dos batches, mergeables por separado.**

- **BATCH «display» (P-2 ④ + P-7 ⑤) — sin migración, aditivo puro, no toca la maquinaria de variantes:**
  `master-set.service.ts` (campo `marketReferenceMxnCents` + populate), `pricing.service.ts` (`refreshCardPrices`) +
  método de proveedor, endpoint/flag P-7 en `inventory`/controller, DTOs aditivos en API_CONTRACT §M1. Frontend: teja con
  precio de mercado + botón «publicar (+reprecio)».
- **BATCH «variantes + P-6 + ④» (① + ② + ③) — incluye migración M-29 (ZONA COMPARTIDA `backend/prisma/`, el
  orquestador la serializa):** schema `Card.structuralFinishes` + backfill; `catalog-sync` (poblar `tcgplayerId` +
  `structuralFinishes` seed + resolver TCGCSV en `importSet`); `FinishReconciler.reconcile` lee `structuralFinishes`;
  `TcgcsvCatalogClient`/provider (reusa anti-SSRF); `bulkPublish` escalate-on-priceless (②); `pendingQueue(context)` +
  controller query param (③); seeds §4.22e extendidos con `structuralFinishes`.
- **Serialización explícita con el stream BUYLIST (§4.24c):** NO tocar `buylist/`; el `manualOverride` context-agnóstico
  se **deja como (a)**; cualquier opción (b) futura se coordina con buylist. La migración M-29 se serializa como toda
  zona `backend/prisma/`.
- **Devops:** tras M-29, secuencia de reparación estructural: (1) deploy; (2) `sync-all {force:true}` (puebla
  `tcgplayerId` + corre el resolver TCGCSV → `structuralFinishes` → reconcile); (3) registrar S-D1/S-D2/S-D3 en
  `DEVOPS_NOTES.md`. Verificación (gate): sobre un set moderno, `SELECT count(*) FROM "Card" WHERE 'reverse_holo' =
  ANY("structuralFinishes") AND "setId"=:set` > 0; el binder pinta dos casillas en una común moderna.

### 4.25 Stream A «Catálogo y precios» (v1.27) — variantes fantasma (P-13), mercado por variante (P-15), sync por set (P-12)

> Tres arreglos del plan aprobado 2026-08-21 (`PENDIENTES.md`). **SIN migración de schema** (M-27/M-29 ya existen);
> el paso de despliegue es un **re-sync forzado** (§4.25a-4). Contrato: API_CONTRACT Changelog v1.27. Backend y
> frontend implementan contra esta sección; los tres cambios caben en UN batch de commit (sin migración de schema:
> `schema.prisma`/migrations no se tocan; los seeds/fixtures de `prisma/` SÍ se ajustan — ver reparto en (d)).

#### (a) P-13 — composición de `availableFinishes`: el precio CONFIRMA, nunca AÑADE

**Diagnóstico (por qué la unión de §4.24a era el bug).** `unionAvailableFinishes` (`card-order.ts:71-77`) hace
`structuralFinishes ∪ pricedFinishesSnapshot`, pero el **comentario VAR-1 del propio archivo** (`:60-61`) declara que
el snapshot «NO añade estructura: solo confirma precio de una impresión ya estructural» — el código nunca implementó
su propia doctrina. Dos fuentes de precio metían variantes inexistentes: **(1)** el barrido por-impresión de PPT
(`fetchPrintings`, `pokemonpricetracker-bulk.provider.ts:46-50, 554-556`) atribuye el finish por la **etiqueta del
request** (`printing=Normal`), no por dato de la carta ⇒ si PPT devuelve una ex en el barrido `Normal`, se le pega un
`normal` CON precio (causa principal: N-15 no lo salva porque solo oculta acabados SIN precio); **(2)** el seed de
pokemontcg.io en CREATE (sub-llave `normal` presente con `market:null`, o default `['normal']`). Resultado observado:
ex con Normal+Holofoil (misma imagen), hasta 3 variantes, secret rares duplicadas.

**1. Regla nueva (NORMATIVA).** La composición deja de ser unión:

```
⛔ FÓRMULA DEROGADA 2026-08-22 (regresión en prod) — reemplazada por §4.25e. NO implementar:
availableFinishes :=
  structuralFinishes ≠ ∅ :  orderFinishes(structuralFinishes)   // TCGCSV es LA autoridad; el precio solo confirma
  structuralFinishes = ∅ :  ['normal']                          // fallback legacy (sin resolver TCGCSV) — ver (3)
```

> **⛔ ESTA FÓRMULA «SOLO STRUCTURAL» CAUSÓ UNA REGRESIÓN EN PRODUCCIÓN (set Pitch Black, 2026-08-22).** Quitar el
> snapshot de la composición degradó a los COMUNES: su reverse holo legítimo NO vive en `structuralFinishes` (para
> sets recién salidos TCGCSV solo trae la fila `Normal`), vive en `pricedFinishesSnapshot` (barrido por-impresión de
> PPT). Resultado: Tropius/Grubbin/Fomantis perdieron `reverse_holo`. Y NO limpió a las ex (que no joinean a TCGCSV):
> su `normal` fantasma STALE en `structuralFinishes` (sembrado por M-29 `structuralFinishes := availableFinishes`)
> sobrevivió. Diagnóstico y **fórmula vigente en §4.25e** (unión de vuelta + filtro estructural de `normal` por rareza
> premium). El resto de §4.25a-2/-3/-4 (exclusión de filas `forced` del snapshot, fallback `['normal']`, re-sync
> forzado) sigue vigente.

- `pricedFinishesSnapshot` **SALE de la composición**. Se **conserva la columna** con dos usos: (i) observabilidad
  (`dataHealth` / log `pricedNotStructural = snapshot ∖ structuralFinishes`, evidencia de drift proveedor↔estructura
  para el dueño de datos); (ii) confirmación «esta impresión estructural tiene precio» (decoración, jamás
  composición). `FinishReconciler` **sigue siendo el único escritor** de `availableFinishes` (candado 4, §4.22g);
  solo cambia su fórmula. Firma **actualizada en §4.25e** (2026-08-22): `composeAvailableFinishes(structuralFinishes,
  pricedFinishesSnapshot, rarity)` — la unión vuelve (recupera el reverse legítimo que solo trae el proveedor) pero se
  filtra `normal` en rareza premium (mata el fantasma estructural). ~~`composeAvailableFinishes(structuralFinishes:
  Finish[]): Finish[]`~~ (firma de la fórmula derogada arriba).
- Sigue **nunca vacía**, orden canónico `FINISH_ORDER`, recomputable y NO monótona (recomputar con una entrada menor
  ELIMINA — así se limpian los fantasmas ya materializados).
- Un `PriceReference` de un finish fuera de `availableFinishes` sigue siendo **inerte** (el quote valida el finish
  ANTES de leer precio) y se loguea como `finishNotInCatalog` — sin cambio.

**2. `fetchPrintings` — precios sí, estructura jamás (NORMATIVO).** El barrido por impresión **se conserva para
PRECIOS**: es exactamente lo que produce la `PriceReference` propia de la reverse (prerequisito de datos de P-15).

> **⛔ PREMISA CORREGIDA v1.44 (P-47, §4.35).** La frase anterior —«`fetchPrintings` produce la `PriceReference` propia
> de la reverse»— es **FALSA**. La **API v2 de PPT expone UN solo `market`** (impresión primaria), **invariante al
> `?printing=`**: `fetchPrintings` nunca produjo un precio por-acabado de reverse/holo; en el modo forzado replicaba el
> market primario a los 3 acabados (bug de dinero, corregido en `35e948a`). La `PriceReference` **propia por-acabado** la
> produce **TCGCSV `tcgcsv_singles`** (§4.27e/f), no PPT. En consecuencia **§4.35 apaga `fetchPrintings`** (costaba ~3×
> por set para, a lo sumo, la impresión primaria que el modo LISTA da a 1×) y el **barrido diario reprecia por-acabado
> desde TCGCSV**. El resto de este punto (las filas `forced` NO escriben el snapshot; defensa en profundidad) queda como
> registro histórico y **moot** al apagar el dial.
Pero el finish atribuido por **etiqueta de request NO es evidencia estructural**: las filas del modo forzado
(`forced`, `:554-556`) **NO deben escribirse en `pricedFinishesSnapshot`** ni marcarse como alias-VERIFICADO a efectos
de la Señal C (hoy `finishAliasVerified` se computa sobre la propia etiqueta ⇒ se auto-verifica). Es defensa en
profundidad: aunque el snapshot ya no compone, no debe quedar envenenado (se usa para observabilidad y podría
re-leerse en el futuro). El modo lista (`primaryPrinting` del dato de la carta) sí puede seguir alimentando el
snapshot como hasta ahora.

**3. Fallback `structuralFinishes = ∅` — DECISIÓN: `['normal']` (opción b).** Alternativas evaluadas:
- *(a) usar `pricedFinishesSnapshot` filtrado como fallback:* conservaría dos casillas en cartas legacy con reverse
  priceado, pero **re-abre el vector precio→estructura exactamente en la población no resuelta** (la misma donde
  nacen los fantasmas: sin estructura contra qué intersectar, el snapshot «filtrado» es el snapshot a secas, y el
  `normal` de etiqueta de `fetchPrintings` volvería a ser casilla). Rechazada.
- *(b) `['normal']` (ELEGIDA):* VAR-1-limpia y conservadora — mejor «falta una casilla» que «sobra una falsa»; y
  **fail-closed para dinero**: cotizar/dar de alta un reverse real de una carta legacy da `422 FINISH_NOT_AVAILABLE`
  hasta el re-sync (nunca un precio sobre una variante no declarada). Las piezas físicas ya capturadas con un finish
  fuera del universo **no se pierden**: quedan visibles como drift en `countsByFinish` (§4.20b), solo no cuentan en
  expected/covered.
- **Trade-off aceptado:** entre el deploy y el re-sync, una carta legacy re-reconciliada puede colapsar a una casilla
  (regresión transitoria, se anota abajo). El remedio permanente del residuo (carta que TCGCSV nunca resuelve) sigue
  siendo el **override manual del admin** (§4.22g remedio (a)) — jamás una heurística.

**4. Ruta de migración (paso de despliegue, dueño devops/humano).** (1) deploy del fix; (2) **re-sync forzado UNA
sola vez**: `POST /admin/catalog/sync-all {force:true}` (o por set con P-12: `sync {setId, force:true}`) — el
resolver TCGCSV puebla `structuralFinishes` y el reconcile recomputa con la fórmula nueva, eliminando los fantasmas
ya grabados; (3) verificación: una ex moderna queda con `['holofoil']` (una casilla), una común moderna con
`['normal','reverse_holo']` (dos). `PENDIENTES.md` ya instruye al humano esperar este fix para re-sincronizar prod
una sola vez. **Ordenar el re-sync ANTES de correr price-ingest masivo** minimiza la ventana de la regresión
transitoria del punto 3.

#### (e) P-13-fix — REGRESIÓN de composición de variantes: la unión vuelve, el fantasma no (2026-08-22)

> **Changelog v1.27.1-fix-variant-composition-regression (2026-08-22, rama `fix/variant-composition-regression`).**
> Corrige la regresión que introdujo §4.25a-1 (fórmula «solo structural» de P-13). SIN migración de schema; SIN cambio
> de forma de contrato (`CardDTO.availableFinishes` sigue `Finish[]`, solo cambia la SEMÁNTICA de la composición).
> Toca la lista blanca SEC-A1 → gate de seguridad por release. Paso de despliegue = re-sync forzado (§4.25a-4).

**Diagnóstico (dos síntomas, causas OPUESTAS).** Tras el re-sync forzado de prod con la fórmula «solo structural»:

| Síntoma en prod (set Pitch Black) | rareza | qué mostró | qué debía mostrar | causa |
|---|---|---|---|---|
| **Tropius** (y Grubbin/Fomantis) | Common | `[normal]` | `[normal, reverse_holo]` | el reverse holo del común **NO vive en `structuralFinishes`** (TCGCSV solo trae `Normal` en sets nuevos); vive en `pricedFinishesSnapshot` (barrido por-impresión PPT, Señal C). P-13 lo quitó de la composición ⇒ el común pierde su reverse. **El resolver SÍ tocó al común y lo degradó.** |
| **Lurantis ex / Mega Delphox ex** | premium (Double Rare) | `[normal, holofoil]` | `[holofoil]` | `normal` fantasma que sobrevive: (a) barrido por-etiqueta de PPT que atribuía `normal` por el label del request (ya mitigado a que no escriba snapshot, §4.25a-2), y (b) valores STALE en `structuralFinishes` sembrados por M-29 (`UPDATE Card SET structuralFinishes = availableFinishes`) en cartas que **no joinean** a TCGCSV, que el resolver money-safe no limpia. **El resolver NO tocó a la ex y no la limpió.** |

Las dos causas son opuestas: al común el reconciliador lo tocó y lo DEGRADÓ (le faltó el reverse del snapshot); a la ex
no la tocó y NO la LIMPIÓ (le sobró el `normal` stale/fantasma). Una sola fórmula debe arreglar ambos: **volver a incluir
el snapshot** (recupera el reverse legítimo del común) **pero filtrar `normal` cuando la rareza es premium** (mata el
fantasma de la ex, venga de donde venga: snapshot envenenado, structural stale de M-29, o seed de pokemontcg.io).

**1. Regla nueva VIGENTE (NORMATIVA, deroga §4.25a-1).**

```
availableFinishes := orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot) − { normal | isPremiumRarity(rarity) } )
                     || ['normal']          // fallback si la resta deja el conjunto vacío (energías básicas comunes)
```

Es decir, en tres pasos:
1. **UNIÓN** de `structuralFinishes ∪ pricedFinishesSnapshot` (vuelve la unión de §4.24a/§4.22g — recupera el reverse
   holo legítimo de los comunes, que en sets recién salidos SOLO trae el proveedor de precios).
2. **RESTA de `normal` si `isPremiumRarity(rarity) === true`** — las cartas premium (ex/Double Rare, Ultra Rare, Secret
   Rare, Illustration/Special Illustration Rare, Hyper Rare, Rainbow, Gold, V/VMAX/VSTAR/ex/GX, etc.) **nunca existen en
   `normal`**, así que un `normal` en su composición es SIEMPRE fantasma, venga del snapshot, del structural stale de
   M-29 o del seed. El filtro es **ESTRUCTURAL por rareza, en la composición misma** — no por precio.
3. `orderFinishes(...)` (dedup + orden canónico `FINISH_ORDER`) y **fallback `|| ['normal']`** si el conjunto quedó
   vacío (una energía básica común sin datos estructurales ni de precio no debe quedar sin casillas).

**Por qué la unión vuelve pero el fantasma NO.** La unión de §4.24a era el vector de las variantes fantasma porque el
`normal` de etiqueta de `fetchPrintings` (barrido por-impresión de PPT) entraba a la casilla de las ex CON precio (N-15
no lo salvaba: solo ocultaba acabados SIN precio, y ese `normal` fantasma SÍ tenía precio). P-13 mató la unión entera y
con ella el reverse LEGÍTIMO de los comunes. El fix es quirúrgico: la unión vuelve para todos, pero el ÚNICO acabado que
la unión colaba de más — el `normal` en cartas premium — se filtra por rareza en la composición. El común (no premium)
conserva su unión intacta (recupera el reverse); la ex (premium) pierde solo su `normal` (mata el fantasma). Nótese que
esto **NO es el viejo `computeDisplayFinishes`/N-15**: aquél ocultaba en DISPLAY los acabados SIN precio y fallaba porque
el `normal` fantasma SÍ tenía precio; aquí el filtro es estructural por rareza, sobre la lista blanca misma, no por precio.

**2. Firma (sustituye la de §4.25a-1).**

```ts
composeAvailableFinishes(
  structuralFinishes: Iterable<Finish>,
  pricedFinishesSnapshot: Iterable<Finish>,
  rarity: string | null,
): Finish[]
```

Vive en `backend/src/common/card-order.ts` (lock de ESTE stream) junto a `orderFinishes`. **Reusa `isPremiumRarity` de
`common/money.ts`** — es el MISMO clasificador chase del buylist (Fase 0.1) y del resolver de reglas por rareza: una sola
definición de «premium» en todo el sistema, sin duplicar patrones. `isPremiumRarity(null) === false` ⇒ **rareza null/
desconocida NO filtra `normal`** (fail-safe conservador: una carta de rareza desconocida conserva su `normal` de la unión;
mejor conservar una casilla dudosa que borrar una legítima por no clasificar la rareza). Determinista, recomputable y NO
monótona (recomputar con entrada menor ELIMINA — así se siguen limpiando los fantasmas ya materializados).

Pseudocódigo NORMATIVO:

```
function composeAvailableFinishes(structuralFinishes, pricedFinishesSnapshot, rarity):
    union := new Set(structuralFinishes)
    for f in pricedFinishesSnapshot: union.add(f)
    if isPremiumRarity(rarity): union.delete('normal')     // fantasma estructural por rareza
    ordered := orderFinishes(union)                         // dedup + FINISH_ORDER
    return ordered.length > 0 ? ordered : ['normal']        // fallback fail-closed
```

**3. Lista EXACTA de patrones premium que aplican el filtro** (de `PREMIUM_RARITY_PATTERNS` en `common/money.ts`,
case-insensitive, match por substring/token — se REUSAN tal cual, NO se redefinen aquí):

| Patrón (regex) | Cubre |
|---|---|
| `/illustration/` | Illustration Rare, Special Illustration Rare |
| `/ultra\s*rare/` | Ultra Rare (full art) |
| `/double\s*rare/` | Double Rare (= ex, era Scarlet & Violet) |
| `/secret/` | Rare Secret, Secret Rare |
| `/rainbow/` | Rainbow Rare |
| `/hyper/` | Hyper Rare |
| `/full\s*art/` | Full Art |
| `/alt(ernate)?\s*art/` | Alternate Art / Alt Art |
| `/special/` | Special Illustration Rare, etc. |
| `/amazing/` | Amazing Rare |
| `/radiant/` | Radiant |
| `/shiny/` | Rare Shiny / Shiny Ultra Rare |
| `/trainer\s*gallery/` | Trainer Gallery |
| `/character/` | Character Rare / Super Rare |
| `/gold/` | Gold (Secret) Rare |
| `/prism/` | Prism Star |
| `/\b(v\|vmax\|vstar\|vunion\|v-union\|ex\|gx)\b/` | V-series y EX/GX como tokens sueltos (p. ej. «Rare Holo VMAX», «… ex») |

**NO premium (NO filtran `normal`, conservan su unión):** Common, Uncommon, Rare (no-holo), Rare Holo (plano), Reverse
Holo, y rareza `null`/desconocida. Es exactamente el bulk legítimo — el común que DEBE poder tener `normal` + `reverse_holo`.

**4. Worked examples (criterios de test — el reconciler + `card-order.spec` DEBEN cubrir los 6).**

| # | Carta | rareza | structuralFinishes | pricedFinishesSnapshot | premium? | unión | tras filtro | **availableFinishes esperado** |
|---|---|---|---|---|---|---|---|---|
| 1 | Tropius | Common | `[normal]` | `[normal, reverse_holo]` | no | `{normal, reverse_holo}` | igual | **`[normal, reverse_holo]`** |
| 2 | Grubbin/Fomantis | Common | `[normal]` | `[normal, reverse_holo]` | no | `{normal, reverse_holo}` | igual | **`[normal, reverse_holo]`** |
| 3 | Lurantis ex | Double Rare | `[normal, holofoil]` (stale) | `[holofoil]` o `[normal, holofoil]` | **sí** | `{normal, holofoil}` | `{holofoil}` | **`[holofoil]`** |
| 4 | Mega Delphox ex | (premium) | `[normal, holofoil]` | `…` | **sí** | `{normal, holofoil}` | `{holofoil}` | **`[holofoil]`** |
| 5 | Energía básica común | Common | `[]` o `[normal]` | `[normal]` | no | `{normal}` | igual | **`[normal]`** |
| 6 | Secret rare (holo puro) | Secret Rare | `[holofoil]` | `…` (aun envenenado con `normal`) | **sí** | `{normal?, holofoil}` | `{holofoil}` | **`[holofoil]`** (nunca `normal`) |

Los 6 casos quedan cubiertos por la fórmula: el filtro de `normal` por rareza premium arregla 3/4/6 (mata el fantasma) sin
tocar 1/2/5 (comunes conservan la unión con su reverse); el fallback `|| ['normal']` cubre el 5 aunque structural venga vacío.

**5. `FinishReconciler` — único escritor, ahora recibe también la rareza.** El reconciliador sigue siendo el ÚNICO escritor
de `Card.availableFinishes` (candado 4, §4.22g). El único cambio en su cuerpo: además de `(structuralFinishes,
pricedFinishesSnapshot, availableFinishes)`, su `findMany` debe **seleccionar `rarity`** y pasarla a la fórmula:
`composeAvailableFinishes(structural, priced, c.rarity)`. El log de observabilidad `pricedNotStructural` (drift
proveedor↔estructura) **se conserva** — sigue siendo evidencia útil para el dueño de datos, aunque el snapshot ahora sí
componga: informa qué acabados priceados no tienen respaldo estructural TCGCSV (útil para pedir el override manual o el
re-sync). Nada más cambia: idempotencia, dedup de ids y NO-monotonía intactas.

**6. Reparto (para el orquestador).** **backend** (stream Catálogo y precios, lock de `common/`): (1) reescribir
`composeAvailableFinishes` en `backend/src/common/card-order.ts` con la firma de 3 args y la unión-menos-normal-premium;
(2) `FinishReconciler.reconcile` (`backend/src/modules/catalog/finish-reconciler.service.ts`) — seleccionar `rarity` y
pasarla; (3) tests: unitarios de `card-order` con los 6 worked examples + spec del reconciler (común recupera reverse del
snapshot; ex pierde `normal` stale; secret rare nunca `normal`; fallback vacío ⇒ `['normal']`). **devops/humano
(post-merge):** re-sync forzado único (§4.25a-4) para recomputar prod con la fórmula corregida. **frontend:** sin cambio
(la forma del DTO no cambia; solo mejora el contenido de `availableFinishes`).

#### (b) P-15 — precio de mercado POR VARIANTE en el Master Set

**Bug de lectura, no de datos:** `PriceReference` YA es por variante (`finish` en la clave única), pero el binder
(`master-set.service.ts:437-446`) pedía UNA referencia por carta con el acabado BASE (`availableFinishes[0]`) y la
exponía a nivel **celda**; la teja por variante pintaba ese dato de celda ⇒ Normal y Reverse mostraban lo mismo. Era
el único consumidor de precios que no propagaba el finish (buylist sí lo pasa).

- **DTO (contrato §M1/§DTOs v1.27):** `MasterSetVariantDTO += marketReferenceMxnCents?: number | null` y
  `capturedDate?: string | null` (fecha de captura de la `PriceReference`, decoración de frescura; presente solo con
  precio). Semántica idéntica a la v1.26 de celda pero por acabado: referencia CRUDA `(cardId,'raw','raw:NM',finish)`
  FX-recomputada a MXN (`liveMxnCents`); `null` = pending/ausente (jamás un 0 inventado). Aplica a los 3 scopes del
  binder. NO toca SEC-A1 (lectura pura).
- **Backend (sin N+1):** expandir el lote de `getReferencesBatch` de (1 clave por carta) a **(carta × acabado del
  universo `expectedFinishes(availableFinishes)`)** — el batch ya acepta lista; sigue UNA query. Poblar cada
  `MasterSetVariantDTO` con su clave `${cardId}|raw|raw:NM|${finish}`. Si `getReferencesBatch` no devuelve hoy
  `capturedDate`, extender su retorno (lee `PriceReference`, que la tiene).
- **Campo de CELDA `MasterSetCardCellDTO.marketReferenceMxnCents` — DECISIÓN: DEPRECADO una versión, no eliminado.**
  El backend lo sigue emitiendo como **espejo de la variante del acabado base** (`= variants[0].marketReferenceMxnCents`,
  costo cero: ya está en el batch) para no romper lectores rezagados (el shape del binder lo consumen 3 vistas +
  el modo quoter client-side). El **frontend migra TODOS sus lectores a la variante en este mismo stream**; el retiro
  del campo va en la siguiente rev de contrato.
- **Prerequisito de DATOS (no de código):** `POKEMONPRICETRACKER_FETCH_PRINTINGS=true` en Railway — sin él el
  proveedor emite una fila por carta (impresión primaria) y las reverse quedan «—» aunque el DTO sea correcto
  (pendiente del humano en `PENDIENTES.md`). No bloquea el merge: el contrato define `null` honesto para ese caso.

#### (c) P-12 — sync completo de UN set (cartas + variantes + precios)

**Asimetría cerrada:** el resolver estructural TCGCSV solo corría en first-import o `sync-all {force:true}`
(`catalog-sync.service.ts:290-313`) ⇒ el botón por set de M2 re-traía cartas pero jamás refrescaba variantes, y
tampoco tocaba precios (correcto desde §4.15g, pero la UI y el copy sugerían lo contrario).

- **Contrato (§M2 v1.27):** `POST /admin/catalog/sync` gana `force?: boolean = false`. Con `force:true`, `importSet`
  corre `resolveStructuralFinishesForSet` para **cada set procesado por la llamada** (single o from_date), misma
  semántica y mismo best-effort/money-safe que hoy (fallo TCGCSV ⇒ log, conserva previo, no aborta). Implementación:
  propagar `opts.force` desde el controller hasta `importSet` (el gate `firstImport || opts.force` ya existe).
- **Flujo recomendado del admin por set (documentado en contrato):** (1) `sync {setId, force:true}` → metadata +
  cartas + variantes; (2) `POST /admin/jobs/price-ingest {setId}` (ya existe; barrido del set COMPLETO, bypass del
  scope <2020 de `ppt-sync-scope`). El **frontend** añade la acción por fila en M2 que encadena ambos
  (`triggerPriceIngest({setId})` ya existe en `api.ts` y nadie lo llama) y **corrige el copy** de `es.json:1269`
  («repuebla precios» es falso desde v1.14).
- **Textos stale corregidos en el contrato** (§M2 sync-all «repuebla PriceReference», §M10-ops `price-ingest`
  «refresca availableFinishes», `catalog-price-sync`): marcados ⛔ con la referencia a §4.15g/§4.22a/§4.25a.

#### (d) Reparto de trabajo (para el orquestador)

- **backend** (`catalog` + `pricing` + `inventory/master-set` — módulos del stream): (a) fórmula nueva del
  `FinishReconciler` + `card-order.ts` (P-13.1) + exclusión de filas `forced` del snapshot (P-13.2) + tests
  (`catalog-sync.structural.spec` y unitarios del reconciler: ex ⇒ una casilla aunque haya `normal` CON precio;
  legacy vacío ⇒ `['normal']`); (b) expansión del batch por variante + DTO (P-15) + espejo deprecado en celda;
  (c) `force` en `sync` por set (P-12). **Zonas compartidas — precisión (corrige la redacción anterior, que causó
  fricción):**
  - **`backend/src/common/` — el lock lo tiene ESTE stream para P-13.1:** la fórmula nueva vive en
    `backend/src/common/card-order.ts` (sustituir `unionAvailableFinishes` por `composeAvailableFinishes`, junto a la
    doctrina VAR-1 ya escrita ahí). Es zona compartida y este stream SÍ la toca — el orquestador ya la serializó a
    favor del Stream A; ningún otro stream toca `common/` mientras dure.
  - **`backend/prisma/` — SIN migración de schema, pero los DATOS del stream sí se tocan:** el candado de CLAUDE.md
    aplica al **schema** (`schema.prisma` + `migrations/` — NO se tocan: M-27/M-29 ya existen). `prisma/seed*.ts` y
    `e2e-fixtures.ts` son **datos/fixtures del stream** y SÍ pueden (y deben) tocarse para alinear las expectativas a
    la fórmula v1.27 (las de §4.22h — carta A con casilla nacida del snapshot — quedaron superadas; ver banner ⛔ ahí).
- **frontend** (`(admin)` M1/M2 + componentes del binder): (a) teja de variante lee SU
  `marketReferenceMxnCents` (y deja de leer el de celda — migrar TODOS los lectores, incluido `contract.ts` espejo,
  zona compartida `frontend/src/types/` serializada dentro del stream); (b) acción por fila en M2 «sincronizar set
  completo» que encadena sync force + price-ingest y muestra resultado honesto; (c) copy de `es.json` corregido.
- **devops/humano (post-merge):** re-sync forzado único (§4.25a-4) + verificar
  `POKEMONPRICETRACKER_FETCH_PRINTINGS=true`.
- **qa (gate por stream):** unitarios + contrato + smoke E2E de: binder muestra mercado distinto por variante (o «—»
  honesto), ex sin casilla `Normal` tras re-sync local, sync por set con force refresca variantes, price-ingest por
  set puebla precios.

### 4.26 Stream B «Inventario Master Set» (v1.28) — alta simple + publicar todo (P-19), consola de tres precios (P-18), Piezas→drill-down (P-17), valor desglosado (P-24), pestaña Sellado (P-25), gradeadas PSA (P-20) y Top Bounties (P-22)

> Plan aprobado 2026-08-21 (`PENDIENTES.md`): **las decisiones de producto YA están tomadas por el humano** — esta
> sección las convierte en norma, no las re-abre. **CON migración de schema: M-30** (§11; UNA tabla nueva
> `VariantPriceOverride`, estrictamente aditiva — cero cambios a tablas existentes). Contrato: API_CONTRACT
> Changelog v1.28. **Toca DINERO en las dos direcciones** (el override de venta fija el precio publicado del
> storefront; el de compra y el bounty fijan la oferta del cotizador público de buylist) → gate de seguridad por
> release. Reparto de trabajo y locks en (i); orden interno en (j).

#### (a) M-30 — `VariantPriceOverride`: dónde persisten los controles por carta+variante

**Motivación.** P-18/P-20/P-22 necesitan persistir POR (carta, variante): (1) override de VENTA, (2) override de
COMPRA y (3) el bounty. Hoy no existe NADA a ese nivel: el «precio manual» existente es **por PIEZA**
(`InventoryItem.listPriceCents`) y el override de M2 (`POST /admin/pricing/override`) escribe una `PriceReference`
`isManualOverride` — es decir, pisa el **MERCADO** (la referencia), no la oferta de compra ni el precio de venta.
Son **tres perillas distintas y las tres se conservan** (precedencias en (b)); ninguna reusa a otra porque mezclan
semánticas de dinero diferentes (referencia informativa vs. precio operativo comprometido).

**Modelo (schema.prisma — backend implementa; migración M-30, aditiva pura):**

```prisma
model VariantPriceOverride {
  id                String      @id @default(uuid())
  cardId            String
  card              Card        @relation(fields: [cardId], references: [id])
  productType       ProductType @default(raw)      // raw | graded (P-20). sealed NO usa esta tabla (ver (g)).
  gradeKey          String      @default("raw:NM") // canónico de buildGradeKey: "raw:NM" | "graded:PSA:10" …
  finish            Finish      @default(normal)   // graded → normal (el acabado no aplica; paridad PriceReference)
  sellOverrideCents Int?        // precio de VENTA manual → PISA el storefront (b). null = sin override
  buyOverrideCents  Int?        // precio de COMPRA manual → PISA el cotizador público (b). null = sin override
  bountyEnabled     Boolean     @default(false)    // P-22
  bountyPriceCents  Int?        // requerido si bountyEnabled — SIEMPRE explícito, jamás calculado
  bountyTargetQty   Int?        // "necesito N"; null = sin objetivo (no se auto-apaga)
  bountyAcquiredQty Int         @default(0)        // piezas compradas vía buylist PAGADA bajo bounty (ver (e))
  bountyCompletedAt DateTime?
  updatedBy         String?     // actorUserId (patrón AuditLog, sin FK dura)
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  @@unique([cardId, productType, gradeKey, finish])
  @@index([bountyEnabled])
}
```

- **Nivel elegido: carta+variante (+grado vía `gradeKey`), NO por pieza.** Es la consola del Master Set: el
  operador piensa «esta carta en reverse vale X», no «el folio INV-000123 vale X». El por-pieza
  (`listPriceCents`) se conserva como intención MÁS específica y gana para ESA pieza (b). La clave única espeja la
  de `PriceReference` (menos `capturedDate`): una fila VIGENTE por variante, upsert, sin serie temporal (la
  auditoría del cambio va por `AuditLog`, no por filas históricas).
- **Validaciones (server-side; `422 VALIDATION_ERROR` salvo código propio):** centavos **enteros > 0**;
  `bountyEnabled=true` ⇒ `bountyPriceCents > 0` (**`BOUNTY_PRICE_REQUIRED`**); `bountyPriceCents ≥` **sugerido de
  compra por regla del momento** cuando el sugerido resuelve (**`BOUNTY_BELOW_RULE`** — si no es más que la regla,
  no es bounty); si el sugerido está `pending` se ACEPTA (el bounty es precio explícito — es exactamente el caso
  donde más se necesita); `bountyTargetQty ≥ 1`; **bounty SOLO en `productType=raw`** (la vitrina pública
  `GET /buylist/bounties` es de sueltas; un bounty graded invisible sería incoherente — los overrides sell/buy en
  graded SÍ aplican); `productType ∈ {raw, graded}` (**sealed → `422`**); para `raw`,
  `finish ∈ Card.availableFinishes` (SEC-A1); para `graded`, `finish=normal` y `gradeKey` con forma
  `graded:<company>:<grade>`.

#### (b) P-18 — la consola de TRES precios y las precedencias NORMATIVAS (money-safe)

El Master Set muestra, por (carta, variante): **mercado** (P-15, ya en el binder v1.27), **compra** y **venta**,
cada uno con **sugerido por regla** + **override manual**. Decisión del humano ratificada: **los overrides SÍ pisan
lo que ve el cliente.**

**COMPRA — lo que ofrece el cotizador público `/buylist` (y `createRequest`):**
```
effectiveBuyCents :=
  1. bountyEnabled && bountyPriceCents > 0   → bountyPriceCents                  (source = "bounty")
  2. buyOverrideCents != null                → buyOverrideCents                  (source = "override")
  3. BUYLIST_PRICE_RULES / fallback (hoy)    → fixed | pct × referencia(acabado) (source = "rule" | "fallback")
  4. pct sin referencia                      → precio_pendiente (null)           (money-safe: JAMÁS inventar)
```
- Bounty y override actúan como `fixed`: **no dependen de la referencia** ⇒ siempre `cotizada`.
- **Un solo núcleo** (prohibido duplicar cuerpo): `quoteCardForFinish`/`quoteAcquisitionForFinish` ganan el
  contexto de overrides; consumidores que DEBEN pasar por él: `publicQuote`, `batchQuote`, `createRequest`
  (snapshotea `ruleSource` con los valores nuevos `"bounty" | "override"` — habilita el conteo (e)) y el nuevo
  `GET /buylist/bounties`. Overrides leídos **EN LOTE** (una query por request, mapa por clave
  `cardId|productType|gradeKey|finish`) — sin N+1, patrón `getReferencesBatch`.
- Los topes de buylist (por solicitud/mes, INE) **no cambian** y aplican igual sobre montos bounty.

**VENTA — storefront, checkout (auth + guest), publish (raw|graded):**
```
salePriceCents :=
  1. item.listPriceCents (manual POR PIEZA)  → gana (intención más específica; comportamiento actual intacto)
  2. sellOverrideCents (carta+variante)      → fija el precio PUBLICADO en storefront
  3. SALES_PRICE_RULES / fallback (hoy)      → derivado por rareza+acabado
  4. no resoluble                            → PRICE_PENDING (no vendible / no publicable / escala ④)
```
- **Sellado NO cambia:** `listPriceCents > mercado×spread > PRICE_PENDING` (resolver H-1, §4.23). P-18 **no aplica
  a `sealed`** (su override de producto es fase futura; hoy el override por pieza cubre el caso).
- **Por qué surte efecto inmediato:** publicar NO persiste el precio derivado (`listPriceCents` solo se escribe
  con override explícito) — el precio del storefront se **resuelve en lectura**, así que el override de variante
  aplica al instante a toda pieza publicada sin manual, y quitarlo regresa a la regla. Nada que re-publicar.
- **Un solo resolver:** `PricingService` (envoltura de `computeSalePriceForItem` + batch
  `getVariantOverridesBatch`). Consumidores que DEBEN migrar: `catalog.fetchSellable`/`toListingDTO`,
  `orders.salePriceOf` (checkout auth + guest), `inventory.bulk-publish` y el nuevo `publish-all`, y los
  sugeridos/efectivos del binder. **BE-26 sigue:** efectivo `<= 0` ⇒ no vendible.

**Relación con el override de MERCADO (M2):** `POST /admin/pricing/override` sigue siendo el remedio de la
**referencia** (alimenta reglas `pct`, valuaciones P-24, aportaciones) — no fija venta/compra por sí mismo. Las
tres perillas conviven sin ambigüedad: mercado (referencia) / compra (oferta) / venta (precio publicado).

**Dónde se lee y dónde se escribe:** la consola vive en la teja del Master Set (M1), pero el WRITE es
**`super_admin`** (precios = M2, tabla §7): `PUT /admin/pricing/variant-controls/:cardId/:finish` (contrato §M2
v1.28). La lectura viaja en el binder: `MasterSetVariantDTO.pricing?: VariantPricingDTO` — **SOLO scope
`platform`** (jamás en bóvedas de cliente ni «Mi bóveda»: la estrategia de compra/bounty no se filtra al cliente;
el precio de venta efectivo ya les llega por `buyable`/storefront). `vault_operator` VE la consola (lectura);
solo `super_admin` edita (el front esconde la edición; el guard lo impone).

#### (c) P-19 — alta rápida, bajas simples y PUBLICAR TODO

**Alta rápida desde la casilla de variante (front reusa `POST /admin/inventory/items/batch` — sin endpoint
nuevo):** SOLO **cantidad** + **adquisición**, con DOS caminos:
- **«Compra»**: línea `{ cardId, finish: <el de la casilla>, qty, acquisitionType: "compra",
  acquisitionCostCents: <capturado> }` — el campo se **prellena** con `pricing.buy.effectiveCents` del binder
  (sugerido de regla u override/bounty vigente) y es **editable**. `acquisitionCostCents` ya existe en el DTO.
- **«Aportación»**: un botón, **sin %** — línea `{ ..., acquisitionType: "aportacion_en_especie",
  acquisitionPct: 100 }` ⇒ el server valúa **costo = referencia de mercado del momento × 100 %** (mecánica
  existente con pct=100). **Sin referencia ⇒ `422 PRICE_PENDING` POR LÍNEA** (lote tolerante P-5) y el front lo
  muestra **anclado y claro** (lección P-4: ni crear a ciegas ni fallar en silencio). El dial `aportacionPct`
  (70) **NO cambia**: sigue siendo el default del formulario clásico; el alta rápida manda `100` explícito.
- **Sin dropdown de acabado** (viene de la casilla picada; SEC-A1 lo valida igual) y **sin ubicación**:
  `locationId` pasa a **opcional en el contrato** (el DTO backend ya lo trataba opcional; la bóveda física la
  definirá el humano después — nota P-17). Aplica igual al sellado (g).
- **Bajas igual de simples:** merma vía `POST /admin/inventory/adjustments` (`perdida|danada|error_captura`, ya
  existe §4.20e) accesible desde el drill-down (d); la **VENTA solo sale por checkout/M3** (se ratifica: sin venta
  manual desde el binder).

**Publicar todo — endpoint NUEVO `POST /admin/inventory/publish-all` (contrato §M1 v1.28):**
- Req `{ batchKey?, setId?, productType? }` → selección **server-side** de piezas `ownerType=platform` +
  `status=in_stock` (± filtros). Pipeline por-pieza **IDÉNTICO** a `bulk-publish` (precio server-side SEC-A1 con
  la precedencia (b); `PRICE_PENDING` **escala** a la cola ④ §4.24b y NO publica; `listed` = no-op) — **tolerante
  por-ítem**, jamás revienta el lote.
- Res: resumen `{ selected, published, alreadyListed, pendingPrice, failed }` + detalle de fallos **capado a 200
  líneas** — `selected` (v1.28.1, ratificado tal como lo implementó backend) = **snapshot del total de piezas
  candidatas seleccionadas server-side** por el filtro al momento de la ejecución; los demás contadores
  (`published`/`alreadyListed`/`pendingPrice`/`failed`) reparten el destino por-pieza de ESA selección (el remanente se opera por la cola de pendientes M2 `?context=inventory`). Sin cap de selección
  (server-side por chunks — a diferencia de `bulk-publish`, que exige la lista y capa 200). Idempotencia por
  `batchKey` (`InventoryBatch kind='publish_all'`, replay devuelve el resultado guardado). Auditado
  (`inventory.publish_all`). El «publicar piezas de esta carta» existente no cambia.

#### (d) P-17 — Piezas deja de ser pestaña: drill-down del Master Set

- M1 **abre en Master Set por defecto**. Clic en carta/variante → **panel drill-down** con las copias físicas de
  ESA variante: folio, estado, precio manual por pieza, detalle/historial y acciones existentes (publicar piezas,
  mark, ajuste). El buscador por **folio** se conserva como acceso rápido (`q=` ya lo sirve).
- **Contrato (lo ÚNICO que faltaba, aditivo):** `GET /admin/inventory/items` gana los query params **`finish?`** y
  **`productType?`** — el drill-down es `?cardId=&finish=&productType=raw`. `cardId`, `status`, `q`, `page` ya
  existían; ningún endpoint nuevo. (El `productType` sirve también los drill-downs de (g) sellado y (h) gradeadas.)

#### (e) P-22 — Top Bounties

- **Edición:** mismos writes de (b) (`bounty` en `variant-controls`); el front muestra el **premium vs. regla**
  (`bountyPriceCents − suggested`). Validaciones en (a) (`BOUNTY_BELOW_RULE`, precio siempre explícito).
- **Conteo y auto-apagado (money-safe, transaccional):** cuando una `SellRequest` transiciona a **`pagada`** (pago
  SPEI M5, `super_admin`), por cada ítem cuyo snapshot es `ruleSource='bounty'` **Y cuyo `itemStatus` NO es
  `rechazada`** se incrementa `bountyAcquiredQty` **en la MISMA transacción del pago** (por la clave `(cardId,
  productType, gradeKey, finish)` del ítem). **Precisión v1.28.1 (alineada con (a) y con BL-1 §9):**
  `bountyAcquiredQty` cuenta piezas realmente COMPRADAS — un ítem `rechazada` del cherry-pick no se paga (BL-1 lo
  saca del dinero: `approvedPriceCents=null`, fuera de `approvedTotalCents`), así que JAMÁS avanza el contador ni
  puede auto-apagar un bounty. Si `bountyTargetQty != null` y `acquired ≥ target` ⇒ `bountyEnabled=false` +
  `bountyCompletedAt=now()` + `AuditLog action=bounty.completed` (el aviso de M1 sale de `completedAt`). Sin
  objetivo ⇒ solo contador, nunca auto-off. Apagar un bounty **no** re-precia solicitudes ya cotizadas (el monto
  quedó snapshoteado en el ítem, como toda cotización — doctrina vigente).
- **Público:** `GET /buylist/bounties` (contrato §6) — bounties **activos**, orden `bountyPriceCents desc`, cap
  50, **read-only** (no escribe pendientes — doctrina v1.12 de endpoints anónimos), throttle público. La sección
  «Top Bounties» va **arriba** de `/buylist`, antes de elegir set. Expone `remainingQty` (`target − acquired`,
  `null` sin objetivo) — dato motivacional, no compromiso contractual de compra.

#### (f) P-24 — valor del inventario, desglosado por tipo, visible en M1

- **Extensión ADITIVA de `GET /admin/finance/inventory-value` (M7)** — NO endpoint nuevo (decisión: el cálculo ya
  existe ahí y en el dashboard; duplicarlo crearía una tercera cifra que conciliar). Gana
  `breakdown: { raw, sealed, graded }`, cada bucket `{ atReferenceCents, atCostCents, pieceCount,
  pendingPriceCount }` con la MISMA base de valuación actual (referencia del acabado por pieza; sellado por
  `sealedMarketRef`; sin precio ⇒ excluido del total y contado en `pendingPriceCount`). Los campos top-level **no
  cambian** (= Σ del breakdown). El CSV `inventory` gana columnas espejo. El `inventoryValueCents` del dashboard
  queda como espejo del top-level (sin cambio).
- **En M1:** tarjetas de resumen arriba (total + raw + sellado + PSA, a mercado y a costo + conteo sin precio).
  **Guard:** el endpoint sigue `super_admin` (§7: finanzas) ⇒ las tarjetas solo se muestran a `super_admin`; para
  `vault_operator` el front las omite (coherente con el enmascaramiento del dashboard; sin fuga por API).

#### (g) P-25 — pestaña «Sellado» de M1, organizada POR SET

Dos endpoints nuevos (`vault_operator+`, contrato §M1 v1.28), análogos al par índice/binder del Master Set pero
agregando **PIEZAS selladas** (no catálogo: no existe catálogo de productos sellados por set; la identidad de grupo
es la de §4.23 — `(cardId ancla, sealedSubtype, tcgplayerProductId, sealedCondition)`):
- **`GET /admin/inventory/sealed-sets`** — índice: sets con ≥1 pieza sellada de plataforma; por set
  `{ pieceCount, listedCount, unmappedCount, marketValueMxnCents | null }` + `unmappedTotal` global (badge de la
  cola). Sin N+1 (una agregación + `getReferencesBatch`).
- **`GET /admin/inventory/sealed-sets/:setId`** — grupos del set: identidad, conteos por status
  (`in_stock`/`listed`/otros), `sealedMarketRef` (batch, clave `sealed:tcg:<productId>`; `null` si no mapeado o
  sin ingest), `mapped`, costo agregado. El drill-down a folios usa (d): `items?cardId=&productType=sealed`.
- **Alta rápida / bajas / publicar:** mismas reglas de (c) (producto + cantidad + compra/aportación; merma por
  ajuste; publicar por grupo = `bulk-publish` de los folios o `publish-all {setId, productType:"sealed"}`).
- **⚠ Corrección requerida (backend, dinero):** la valuación de la **APORTACIÓN de sellado** debe rutear por
  `sealedMarketRef` (resolver H-1; requiere mapeo + dial `sealedPriceSource=tcgcsv`) — hoy `createItem` valuaría
  contra el gradeKey legacy `'sealed'`, que jamás tiene filas ⇒ todo caía a `PRICE_PENDING` aunque el mercado
  exista. Sin mercado (no mapeado / dial off) ⇒ `422 PRICE_PENDING` por línea, como siempre.
  - **Resolución del `tcgplayerProductId` en el alta (NORMATIVO v1.28.1, ratifica lo implementado):** el alta
    rápida NO captura productId; el server lo **infiere de los hermanos YA MAPEADOS del grupo
    `(cardId, sealedSubtype)`**. Si los hermanos mapeados resuelven a **exactamente UN** productId, se usa ese
    para valuar; **cero o más de uno** ⇒ `422 PRICE_PENDING` por línea (ambigüedad = sin precio honesto, jamás
    adivinar). La pieza nueva **NO hereda el mapeo** (nace sin `tcgplayerProductId`): la curación del mapeo sigue
    siendo exclusiva de M2 (`sealed/unmapped`). La decisión de fondo —capturar el productId en el DTO del alta
    vs. modelar una entidad de producto sellado— queda **abierta como SB-D5 en `docs/TECH_DEBT.md`** (la anota
    backend a petición del techlead).
- **Cola de no-mapeados:** acceso directo desde la pestaña a la vista servida por
  `GET /admin/pricing/sealed/unmapped` (M2). Ese endpoint y la curación del mapeo **siguen `super_admin`** — el
  acceso se muestra solo a ese rol; para `vault_operator` el grupo aparece como «sin precio de mercado».
  **Dueño de la vista (decisión v1.28.1):** la pantalla que consume esa cola **pertenece al frontend de M2**
  (módulo de precios), NO a la pestaña Sellado de M1 — la pestaña solo ENLAZA. Queda como **pendiente menor
  post-stream** del frontend (no bloquea el cierre del Stream B).
- **`SealedInventoryGroupDTO` (aditivo v1.28.1):** gana `imageSmallUrl?: string | null` — imagen de la carta
  ancla del grupo, para la teja de DESIGN §16.8 (`null` honesto si el ancla no tiene imagen). Shape en API_CONTRACT
  §M1; backend lo implementa en ronda futura o al cierre del stream.

#### (h) P-20 — gradeadas (PSA) separadas, con valor por carta+grado

- **Referencia por grado — DECISIÓN: manual en este stream.** No está verificado que el proveedor de paga exponga
  precios por grado (no se especula — doctrina P-6: no construir sobre esquemas no confirmados). El valor de
  mercado por carta+grado se fija con el **override de MERCADO existente** (`POST /admin/pricing/override` con
  `productType:"graded"`, `gradeKey:"graded:PSA:10"`, `finish` omitido) ⇒ `PriceReference isManualOverride`, que
  alimenta la valuación (f) y cualquier regla `pct`. Los overrides de venta/compra P-18 aplican con
  `productType=graded` (misma tabla (a)). Si mañana un proveedor da precios por grado, entra por `price-ingest`
  **sin cambiar contrato**.
- **Vista — DECISIÓN: pestaña propia «Gradeadas» en M1** (coherente con (g); NO filtro del Master Set: el binder
  es completitud por variante **raw** y meter grados rompería el universo X/Y de §4.20). Endpoint nuevo
  **`GET /admin/inventory/graded`** (`vault_operator+`): lista agregada por `(cardId, gradingCompany,
  gradeValue)` con conteo, valor de mercado por grado (`PriceReference` graded — típicamente manual; `null`
  honesto si no hay) y costo agregado; drill-down a certs/folios vía (d) `items?cardId=&productType=graded`.
- **Alta de una PSA:** formulario corto (grado + cert + precio de compra) — reusa `POST /admin/inventory/items`
  (graded fuerza qty 1, `certNumber` requerido para publicar, reglas vigentes v1.2); lanzable desde la pestaña o
  como acción secundaria de la teja del Master Set («Agregar gradeada»).

#### (i) Reparto de trabajo y LOCKS de zonas compartidas (lección de la fricción D8: explícito, no implícito)

| Zona compartida | ¿La toca este stream? | Lock |
|---|---|---|
| `backend/prisma/schema.prisma` + `migrations/` | **SÍ — M-30** (tabla nueva + relación en `Card`) | **Stream B** (backend implementa; el orquestador serializa frente a cualquier otro stream que toque schema) |
| `backend/src/common/money.ts` | **SÍ** — `quoteAcquisitionForFinish`/`computeSalePriceForRarity` ganan parámetro opcional de override (aditivo, default = comportamiento actual) | **Stream B** |
| `backend/src/modules/catalog/catalog.service.ts` y `backend/src/modules/orders/orders.service.ts` | **SÍ, quirúrgicamente** — SOLO el punto de resolución de precio de venta (pasar el contexto de overrides al resolver (b)); nada más de esos módulos | **Prestados a Stream B** durante el stream (son módulos de otros streams; nadie más los toca a la vez) |
| `docs/API_CONTRACT.md` | SÍ (v1.28) | arquitecto (ya hecho) |
| `frontend/src/types/contract.ts` + `frontend/src/lib/api.ts` | SÍ (espejos de DTO/cliente) | **Stream B** (Stream C no arranca su frontend sobre estos archivos hasta el merge de B) |
| `frontend/src/components/` (teja compartida) | NO se rediseña aquí — P-14/P-16 son del Stream C; B solo AÑADE la consola/bounty dentro de la teja admin actual | C conserva el rediseño; ux-ui define el lenguaje una vez para no duplicar |

- **backend** (módulos del stream: `inventory`, `pricing`, `buylist`, `admin` + los dos préstamos de arriba):
  (0) migración M-30; (1) resolvers de precedencia (venta+compra) + `getVariantOverridesBatch` + endpoints
  `variant-controls` + validaciones bounty; (2) `publish-all` + filtros `finish`/`productType` en items +
  `locationId` opcional + fix valuación aportación sellado (g); (3) `sealed-sets` + `graded`; (4) breakdown de
  `inventory-value`; (5) conteo/auto-off de bounty en el pago M5 + `GET /buylist/bounties`; (6) `pricing?` en el
  binder (batch de sugeridos con reglas izadas una vez). Tests: precedencias (bounty>override>regla;
  listPrice>sellOverride>regla; sealed intacto), aportación 100 % (con y sin referencia), publish-all tolerante +
  idempotente, auto-off transaccional del bounty, `pricing` ausente en scopes de cliente.
- **frontend** (`(admin)/admin/m1` + `(storefront)` buylist): pestañas M1 (Master Set default | Sellado |
  Gradeadas), alta rápida simplificada (dos botones), drill-down de piezas, tarjetas de valor (solo super_admin),
  consola de 3 precios en la teja (edición solo super_admin), sección Top Bounties en `/buylist` + badge bounty,
  publicar-todo con resultado honesto por-pieza.
- **ux-ui:** layout de M1 (pestañas + drill-down + tarjetas + consola en la teja) y la sección/teja Top Bounties.
  El distintivo visual por variante (P-14) es del Stream C — B no lo espera, pero ux-ui define el lenguaje del
  badge bounty compatible con esa teja futura.
- **qa (gate por stream, smoke E2E):** alta rápida compra y aportación (esta última con y sin referencia — aviso
  claro, no silencio); override de venta pisa el precio del storefront y quitarlo regresa a la regla; override de
  compra y bounty pisan el cotizador público (precedencia bounty>override); Top Bounties visible en `/buylist`;
  publish-all publica lo preciable y reporta lo pendiente; drill-down por variante; tarjetas de valor cuadran con
  M7; sellado por set con alta/publicación; PSA con valor manual visible.

#### (j) Orden interno sugerido (dependencias reales, no ceremonia)

1. **M-30** primero (bloquea P-18/P-22; zona compartida serializada).
2. **P-18 (núcleo de resolvers + consola)** y **P-19/P-17** en paralelo (P-19/P-17 solo dependen de M-30 para el
   prellenado del sugerido — pueden arrancar con la regla sola y conectar el efectivo al aterrizar P-18).
3. **P-22** tras P-18 (misma tabla, mismo resolver de compra, misma consola).
4. **P-24, P-25, P-20** en paralelo entre sí (lecturas + endpoints propios; P-25 reusa las reglas de alta de P-19).
5. Integración frontend completa + gates (qa + techlead) del stream.

---

### 4.27 Composición y precio de variantes desde TCGCSV por `productId` — «1 carta ↔ N productos» (v1.29, NORMATIVO)

> **Propósito.** Reemplazar la derivación HEURÍSTICA de la composición de acabados (y su precio) por una **lectura
> directa de la fuente**: cada carta del catálogo se compone de **N productos TCGplayer** (uno por `productId`), y de
> cada producto se leen sus `subTypeName` (acabados) y su `marketPrice` POR sub-tipo. El objetivo del PO, literal:
> «que con cada release aprendamos su composición leyéndola de la fuente, no adivinándola embonándola a nuestro
> framework». Esta sección **deroga** §4.24a (unión por número), §4.25a/§4.25e (fórmula `composeAvailableFinishes`
> con filtro `isPremiumRarity`) y §4.22a-6/N-15 (`computeDisplayFinishes`) en lo que toca a la composición de singles.
> Todo lo demás (buylist por rareza, sellado, gradeadas, overrides M-30) queda intacto.

#### (a) La causa raíz (diagnóstico, con evidencia)

Hoy `Card.tcgplayerId String?` (`schema.prisma:401`) modela **1 carta = 1 producto**. La realidad TCGplayer es **1
número de colección ↔ N productos** dentro del mismo set. Caso confirmado — Pitch Black (ME05, groupId TCGCSV 24688),
«Voltaic Lightning Energy 084/084»:

- producto **704841** = producto de set, `subTypes {Holofoil, Reverse Holofoil}`.
- producto **707029** = «Deck Exclusives non-holo», `subType {Normal}`, con **precio propio distinto**.

`unionStructuralFinishesByCardNumber` (`tcgcsv-singles.provider.ts:131-162`) agrupa por **NÚMERO** de colección across
productos y **une** los `subTypeName` de AMBOS → le atribuye un `normal` FANTASMA a la carta de set. En el binder Master
Set eso pinta una casilla `normal` inexistente (la energía especial se ve **3 veces** en vez de 2), y PPT en modo
`fetchPrintings` le replica un precio a esa casilla. La regresión ha vuelto 3 veces porque se reconstruye con
heurísticas (`composeAvailableFinishes`, `isPremiumRarity`) en vez de leer la composición de la fuente.

#### (b) Modelo de datos nuevo (schema Prisma — backend implementa; migración **M-31**, §11)

**Principio:** el `productId` de TCGplayer es la CLAVE de emparejamiento (nunca el número de colección). Una carta del
catálogo (`Card`, identidad = `externalId` de pokemontcg.io) agrupa **N** filas `CardProduct`, una por `productId`.

```prisma
// Enum nuevo — naturaleza del producto TCGplayer bajo una misma carta de colección.
enum CardProductKind {
  set_base        // producto de set «normal» (el que hoy ancla Card.tcgplayerId)
  deck_exclusive  // «Deck Exclusives», precon, gift set… VENDIBLE/COTIZABLE aparte, precio propio
  promo           // promo/staff/league con su propio productId
  other           // no clasificable por nombre (fail-safe; se trata como set_base para el binder salvo señal)
}

// Tabla nueva — UN producto TCGplayer (== un productId) bajo una carta de colección.
model CardProduct {
  id                 String          @id @default(uuid())
  cardId             String
  card               Card            @relation(fields: [cardId], references: [id])
  tcgplayerProductId Int             @unique   // productId EXACTO de TCGplayer/TCGCSV — ancla del join
  kind               CardProductKind @default(set_base)
  name               String          // nombre TCGCSV del producto (para clasificar kind y mostrar el producto separado)
  // Acabados de ESTE producto, leídos de SUS subTypeName (mapeados con deriveStructuralFinishes;
  // subTypeName desconocido ⇒ OMITIDO, anti-invención). NUNCA se unen con los de otro productId.
  finishes           Finish[]        @default([])
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt

  priceReferences    PriceReference[]

  @@index([cardId])
  @@index([cardId, kind])
}
```

Cambios en tablas existentes (aditivos):

- **`Card.tcgplayerId`** → **DEPRECADO** (se conserva por compatibilidad y como respaldo del backfill; deja de ser la
  fuente de verdad del producto — la reemplaza `CardProduct.tcgplayerProductId`). No se dropea en M-31 (reversibilidad).
- **`Card.cardProducts CardProduct[]`** — relación inversa nueva (solo navegación Prisma).
- **`PriceReference.cardProductId String?`** (+ `cardProduct CardProduct?`): FK nullable. Se **puebla para singles**
  (precio POR producto+acabado) y queda **`null`** para graded/sealed (que no usan `CardProduct`). La `@@unique` pasa
  a **`[cardId, productType, gradeKey, finish, capturedDate, cardProductId]`** (añade `cardProductId` al final).
  Racional: dos productos de la MISMA carta podrían, en teoría, exponer el MISMO `Finish` (p. ej. set_base con
  `holofoil` y una promo `holofoil` de la misma carta) con precios distintos; el `cardProductId` en la clave evita la
  colisión y hace del `productId` el ancla exacta. Para graded/sealed (`cardProductId = null`) la clave se comporta
  como hoy.
- **`enum PriceSource`** gana **`tcgcsv_singles`** (primario de singles; distinto de `tcgcsv`, que sigue siendo el del
  sellado). PPT (`pokemonpricetracker`) y pokemontcg.io (`pokemontcg_io`) quedan como valores de FALLBACK.

**Columnas que quedan MUERTAS** (no se dropean en M-31 — se retiran en migración posterior, ver «Riesgos»):
`Card.structuralFinishes`, `Card.catalogFinishes`, `Card.pricedFinishesSnapshot`. Su función la absorbe
`CardProduct.finishes` (leído exacto de la fuente).

#### (c) `Card.availableFinishes`: sigue siendo la lista blanca SEC-A1, pero DERIVADA de `CardProduct` (sin heurística)

`availableFinishes` continúa siendo la **whitelist** contra la que el backend valida cualquier `finish` (SEC-A1) y el
universo de casillas del binder. Cambia SU DERIVACIÓN: deja de calcularse con `composeAvailableFinishes(structural ∪
snapshot − {normal|premium})` y pasa a leerse de los productos de la carta:

```
availableFinishes(card) := orderFinishes( ⋃ { p.finishes : p ∈ CardProduct(card), p.kind ∈ {set_base, other} } )
                           ||  ['normal']     // fallback fail-closed si el set base no resolvió (legacy)
```

- **NO** se resta `normal` por `isPremiumRarity`: si el producto de set no trae `Normal` en sus `subTypeName`, `normal`
  simplemente **no aparece** (no hay fantasma que limpiar). El filtro heurístico deja de existir.
- Los productos **`deck_exclusive`/`promo`** NO entran en `availableFinishes` de la carta de set: se exponen como
  **producto vendible separado** (ver (e)). Así la casilla del binder de la carta de set queda EXACTA (energía especial
  = holofoil + reverse_holo = 2 casillas), y el Deck Exclusive vive como su propio producto con su propio precio.
- **`displayFinishes` se retira**: como ya no hay casillas espurias que ocultar, `displayFinishes := availableFinishes`
  siempre. El DTO conserva el campo por compatibilidad de contrato (= `availableFinishes`), marcado **DEPRECADO** en
  API_CONTRACT (retiro en la siguiente rev de front). El front deja de necesitar la supresión N-15.

**El ÚNICO escritor** de `availableFinishes` sigue siendo un reconciliador de catálogo (el `FinishReconciler`
simplificado: recomputa desde `CardProduct.finishes`, sin unión con snapshot). `price-ingest` nunca lo escribe.

#### (d) Nuevo flujo de derivación de composición + precio (reemplaza el resolver estructural)

Se **retira** `StructuralFinishResolverService` y `unionStructuralFinishesByCardNumber`. Los sustituye:

1. **Función pura `deriveCardProductsFromTcgcsv(products, prices)`** (reemplaza a `unionStructuralFinishesByCardNumber`).
   Agrupa **por `productId`** (NUNCA por número): para cada `productId` produce
   `{ productId, name, number, finishes, pricesBySubType }` donde `finishes = deriveStructuralFinishes(subTypeNames de
   ESE producto)` y `pricesBySubType[subType] = marketPrice` de ESE producto. **Nunca** cruza `subTypeName` entre
   `productId`s distintos → el fantasma es imposible por construcción. `kind` se infiere del `name`: contiene «Deck
   Exclusive(s)» ⇒ `deck_exclusive`; «Promo»/«Staff»/«League» ⇒ `promo`; si no ⇒ `set_base`. (Regla de clasificación
   por nombre, no por rareza; documentada y testeable con fixtures.)
2. **`CardProductResolverService`** (reemplaza al resolver estructural; se invoca como PASO de
   `catalog-sync.importSet`, GATEADO a first-import o `--force`, igual que hoy §4.25c — NUNCA en price-ingest):
   - Resuelve el `groupId` TCGCSV del set (misma lógica S-D3: `CardSet.pptSetId` entero == groupId; si no, match
     ÚNICO por nombre vía `listGroups()`), **sin cambios**.
   - Fetch de productos (`getProducts`) y precios (`getPrices`) del grupo — API existente de `TcgcsvCatalogClient`,
     **sin cambios**.
   - `deriveCardProductsFromTcgcsv(...)` → registros por `productId`.
   - **Join por `productId` EXACTO a la carta local:** ancla preferente = un `Card` cuyo `tcgplayerId == productId`
     (set_base ya poblado por M-29). Para `productId`s SIN ancla directa (típico: Deck Exclusives, o set_base aún no
     poblado), se **empareja por número de colección normalizado** (`normalizeCardNumber`) SOLO para localizar el
     `Card` DUEÑO — pero el `CardProduct` se crea con SU `productId` y SU `kind`; el número solo enruta a qué carta
     colgar el producto, **no** funde acabados. Ambigüedad (varias cartas al mismo número) ⇒ se OMITE ese producto
     (money-safe, log de observabilidad).
   - **Upsert de `CardProduct`** por `tcgplayerProductId` (REEMPLAZO de `finishes`, money-safe: un producto no
     resuelto conserva su valor previo). **Persistir precio POR VARIANTE** (ver (e)) y **recomputar
     `availableFinishes`** de las cartas tocadas vía el `FinishReconciler` simplificado.

**Componentes retirados vs. que entran:**

| Se RETIRA (deroga esta rev; backend borra el código) | Entra / sustituye |
|---|---|
| `unionStructuralFinishesByCardNumber` (unión por número — el bug) | `deriveCardProductsFromTcgcsv` (agrupa por `productId`) |
| `StructuralFinishResolverService` | `CardProductResolverService` |
| `composeAvailableFinishes` (`card-order.ts:97`) + `isPremiumRarity` en composición | derivación directa `⋃ CardProduct.finishes (set_base)` |
| `computeDisplayFinishes` (`card-order.ts:137`) / N-15 | `displayFinishes := availableFinishes` (sin supresión) |
| Columnas `structuralFinishes` / `catalogFinishes` / `pricedFinishesSnapshot` | `CardProduct.finishes` (leído exacto de la fuente) |
| PPT como fuente PRIMARIA de precio de singles | TCGCSV primario; PPT solo fallback (ver (f)) |

> `isPremiumRarity` (`money.ts:206`) NO se borra: sigue vivo para el **pricing del buylist** (`ruleKeyCandidates`,
> `money.ts:228`) — ahí es una regla de negocio legítima. Solo se retira su uso en la COMPOSICIÓN de acabados.

#### (e) Precio POR VARIANTE desde TCGCSV + FX Banxico (reuso, no se inventa FX)

El patrón «leer `marketPrice` de TCGCSV y persistirlo como dinero» ya existe para sellado
(`tcgcsv-sealed.provider.ts:159-176`, solo sub-tipo `Normal`). Aquí se **generaliza a POR VARIANTE**: para cada
`(CardProduct, subType→Finish)` con `marketPrice` numérico > 0:

- **Conversión USD→MXN reusando el módulo Banxico existente** — `FxService` (`pricing/fx.service.ts`): una llamada
  `fx.getCurrent()` por corrida (snapshot `{rate, bufferPct}`, patrón §4.15f) y `usdToMxnCents(marketUsdCents, rate,
  bufferPct)` (`common/money.ts:613`). Banxico SIE (serie SF63528, job `fx-refresh`) + colchón `fx_buffer_pct` +
  override manual `fx_manual_override_rate` — TODO reutilizado tal cual (§3.2 FxRate). **No** se crea FX nuevo.
- Se **upsert** una fila `PriceReference` por `(cardId, productType='raw', gradeKey='raw:NM', finish, capturedDate=hoy,
  cardProductId)` con `source='tcgcsv_singles'`, `priceUsdCents`, `fxRate`, `fxBufferPct`, `priceMxnCents`. Es el mismo
  contenedor de precio de mercado que hoy alimenta el binder (`marketReferenceMxnCents`) y la valuación de bóveda
  (`liveMxnCents`), ahora poblado por variante desde la fuente única.
- **`marketPrice` ausente/`null`/≤0 ⇒ NO se escribe fila** (estructura ≠ precio): el `CardProduct.finishes` ya declaró
  la variante como EXISTENTE; su celda queda «—» (null) y entra a `PRICE_PENDING` por (carta, finish) — la invariante
  H1/H2/H3 money-safe intacta (`master-set.service.ts:82-84`). **Prohibido el fallback `marketPrice→midPrice` para
  singles** (sigue vigente §4.19d: ese fallback es SOLO informativo del sellado).

#### (f) PPT como fallback (orden de precedencia de precio de singles)

Precedencia de la **referencia de mercado** por `(carta, variante)` (de mayor a menor), money-safe:

```
override manual de MERCADO (PriceReference.isManualOverride / M2)
  > TCGCSV marketPrice de ESA variante (source=tcgcsv_singles)         ← PRIMARIO
  > PPT market de esa (carta, finish) (source=pokemonpricetracker)     ← FALLBACK solo si TCGCSV no tiene precio
  > (pokemontcg.io, si aplica, como último recurso informativo)
  > sin precio en ninguna fuente ⇒ celda «—» (null) + PRICE_PENDING     ← NUNCA 0 inventado
```

> **Esta precedencia es ABSOLUTA, no intra-día (P47-2, ver (f-2) + (f-3), v1.47).** El override manual (peldaño 1)
> gana la lectura **independientemente de `capturedDate`** —incluso frente a una `tcgcsv_singles` barrida hoy—. La
> frescura (`capturedDate` más reciente) desempata **solo dentro de un mismo tier** (entre fuentes no-manuales,
> o entre dos overrides manuales). El comparador `isBetterRef` iza el split manual/no-manual **por encima** de
> `capturedDate`; el orden normativo exacto está pinneado en (f-2). **La durabilidad cross-day requiere DOS capas
> (v1.47, (f-3)):** además del comparador, la **SELECCIÓN de candidatas** de las rutas single-item (`getReference`,
> `getReferenceByCardProduct`) DEBE incluir SIEMPRE el override manual —candidata perenne, sin cota de fecha—; el
> cap de recencia `SAME_DAY_REF_CANDIDATES` no puede excluirlo (si no, tras ~32 días el feed vuelve a pisarlo).

- **PPT baja a redundancia/fallback (versión gratis) — por PRECEDENCIA DE LECTURA (aclarado v1.45, ver §4.35(f)):** esta
  precedencia es de **RESOLUCIÓN/LECTURA** de la referencia de mercado, no un orden de escrituras del barrido. En el
  barrido diario corre **UN solo provider (`tcgcsv_singles`)**; **PPT bulk NO corre**. «PPT solo aporta donde no hay fila
  `tcgcsv_singles` fresca» se cumple al **resolver** (`sourceRank`/`isBetterRef`): gana la mejor `PriceReference`
  existente, que puede ser un **residuo** PPT previo al switch. PPT deja de ser el escritor primario y **no** se
  reintroduce como escritor secundario en vivo. *(La redacción original «el barrido de PPT SOLO escribe…» describía el
  comportamiento del barrido **cuando PPT era el provider**; con `PRICE_PROVIDER=tcgcsv_singles` PPT ya no escribe en el
  barrido — el fallback es de lectura. Ver el dictamen §4.35(f).)*
- El precio de **VENTA** (referencia × (1+markup)) y los **overrides de compra/venta** (`VariantPriceOverride`, M-30,
  §4.26b) se resuelven IGUAL que hoy, sobre la referencia ya elegida por esta precedencia. Sin cambios.
- **Sellado y gradeadas NO cambian:** el sellado sigue en `tcgcsv` sub-tipo `Normal` (§4.19); las gradeadas en PPT/
  PokeTrace (§4.20). Esta sección es SOLO singles (`productType='raw'`).

#### (f-2) Dictamen P47-2 (v1.46, NORMATIVO; punto 4 ENMENDADO en v1.47 — ver (f-3)) — el override manual es tier ABSOLUTO y DURABLE cross-day; el orden de `isBetterRef` se pin­ea

> **Escalada (seguridad/blue team, hallazgo ALTA P47-2).** El comparador `isBetterRef`
> (`pricing.service.ts`, ~L121-133) ordena `capturedDate` **ANTES** que `sourceRank`. Consecuencia: un
> **override manual** (`source='manual'` / `isManualOverride=true`, `sourceRank=0`) solo gana a otra fuente el
> **mismo día** en que se capturó. Hasta P-47 era un matiz tolerable porque `tcgcsv_singles` **no** era
> escritor diario. **P-47 lo convierte en escritor DIARIO** (§4.35): la fila `tcgcsv_singles` recién barrida
> gana al override manual por `capturedDate` más nueva —aunque su `sourceRank` sea peor (1 vs 0)—, así que el
> override humano queda **pisado cada día siguiente** por un feed automático. Contradice frontalmente la
> precedencia de (f) y PROJECT.md §K (override manual = **máxima precedencia**, precio humano explícito).

**Dictamen: se RATIFICA la precedencia de (f) y se PIN­EA la semántica del comparador. El override manual es un
tier SUPERIOR ABSOLUTO, INDEPENDIENTE de la fecha; `capturedDate` desempata SOLO DENTRO del mismo tier (entre
fuentes no-manuales, o entre dos manuales).** El bug es que la implementación aplicaba la precedencia de fuente
(f) únicamente como desempate intra-día; la precedencia de (f) es **absoluta**, no intra-día.

**1) Orden de comparación normativo de `isBetterRef(a, b)`** (`a` es MEJOR ⇒ `true`; el primer criterio que
distingue decide). El ÚNICO cambio vs. el código actual es **izar el split manual/no-manual POR ENCIMA de
`capturedDate`**; el resto del desempate determinista de M-31 MAYOR-3 (fecha → fuente → `cardProductId` NULLS
LAST → cuid) se conserva intacto **dentro** del tier:

```
isBetterRef(a, b):
  am := a.isManualOverride || a.source === 'manual'      // ¿a es override manual?
  bm := b.isManualOverride || b.source === 'manual'
  1. if am !== bm:            return am                    // ← MANUAL gana SIEMPRE, sin mirar capturedDate (P47-2)
  2. if a.capturedDate !== b.capturedDate:                //   dentro del MISMO tier (ambos manual | ambos no-manual):
                             return a.capturedDate > b.capturedDate   //   gana la MÁS FRESCA
  3. ar := sourceRank(a); br := sourceRank(b)             //   mismo día: precedencia de FUENTE (determinismo M-31)
     if ar !== br:            return ar < br               //   tcgcsv_singles > PPT > pokemontcg.io
  4. if (a.cardProductId == null) !== (b.cardProductId == null):
                             return a.cardProductId != null // NULLS LAST: la variante resuelta gana
  5. if ambos cardProductId no-null y distintos:
                             return a.cardProductId < b.cardProductId  // cuid lexicográfico (estable/reproducible)
  6. return false
```

Propiedad clave: el paso **1** hace que el override manual (rank 0) gane a **cualquier** fuente automática con
**cualquier** `capturedDate` —incluida una `tcgcsv_singles` barrida hoy—. La invariante «entre fuentes
automáticas gana la más fresca» se preserva en el paso **2** (para el tier no-manual). **NO** se ordena
`sourceRank` estrictamente antes que `capturedDate` para las fuentes automáticas: eso haría que una
`tcgcsv_singles` **stale** (p. ej. de hace un año) le ganara a un residuo PPT **fresco** de ayer —
money-losing. El split se aplica **solo** al escalón manual; entre automáticas manda la frescura y `sourceRank`
es el desempate intra-día (idéntico a hoy, conserva §4.35(f)).

**2) Durabilidad cross-day y revocación.** Un override manual persistido (`PriceReference` con
`isManualOverride=true`/`source='manual'`) es **durable indefinidamente**: gana la lectura **todos los días**,
no solo el de su captura. **Solo lo revoca**: (a) **otro override manual** más reciente sobre la misma clave
(paso 2 dentro del tier manual: el humano posterior supersede al anterior), o (b) la **limpieza/borrado
explícito** de la fila de override por `super_admin` (permiso money — §4.26/§10), tras lo cual las fuentes
automáticas vuelven a aflorar por (f). **Ninguna** escritura automática (`tcgcsv_singles`, PPT, pokemontcg.io),
por más fresca que sea, revoca ni pisa un override manual — es exactamente la garantía de §K/§E.1.

**3) Es un cambio de precedencia de LECTURA (no reintroduce escritura).** `isBetterRef` es una función **pura**
de resolución; corre al RESOLVER la referencia (`getReference`, `getReferenceByCardProduct`,
`getReferencesBatch`, `getSeparateProductsByCard`, vía `pickBestRef`). No cambia **qué** se escribe ni **quién**
escribe: `tcgcsv_singles` sigue siendo el único escritor del barrido diario (§4.35(f)), PPT **no** se
reintroduce como escritor, y `persistMarketReference` sigue haciendo **skip** cuando la fila del día es
`isManualOverride` (nunca clobbea el override). Solo cambia el **orden de lectura** con que se elige la mejor
fila entre las ya persistidas. Coherente con la doctrina «fallback-only = precedencia de LECTURA» de §4.35(f).

**4) Efecto sobre precios ya persistidos: NINGUNA re-resolución, NINGUNA migración — PERO la durabilidad
cross-day depende de DOS capas, no solo del comparador (CORREGIDO v1.47, ver (f-3)).** El fix **no** toca filas
de `PriceReference` (sin backfill, sin re-emisión, sin recómputo de snapshots — el `portfolio-snapshot` del día
siguiente ya lee con la precedencia corregida). Reversible por código. **Sin cambio de schema, sin cambio de
forma de contrato.** *(Redacción original v1.46, INCOMPLETA: «el fix vive por completo en el comparador; ninguna
migración, ninguna re-resolución».)* La afirmación «vive por completo en el comparador» es cierta **solo** para
las rutas de lectura **sin cota de recencia** (`getReferencesBatch`, `getSeparateProductsByCard`, que hacen
`findMany` **sin `take`** → cargan TODAS las filas de la clave, así que el override manual **siempre** está entre
las candidatas y el comparador lo ve). **NO** es cierta para las rutas **single-item** `getReference` /
`getReferenceByCardProduct`, que traen candidatas con `orderBy capturedDate desc … take SAME_DAY_REF_CANDIDATES
(=32)`: como el override manual se persiste con `capturedDate` **FIJO** (el día que el humano lo capturó) y el
barrido `tcgcsv_singles` añade ~1 fila automática por día **sin purga**, tras ~32 días la fila manual **cae fuera
de la ventana top-32** por recencia y **el comparador nunca la ve** → el feed diario vuelve a pisar el precio
humano **en silencio** (exactamente el hallazgo P47-2 que (f-2) pretendía cerrar, re-materializado con retardo de
un mes). **Conclusión normativa: cumplir la durabilidad cross-day de (f-2) SÍ requiere tocar la SELECCIÓN de
candidatas de las rutas single-item** —no basta el comparador—. El invariante completo está normado en **(f-3)**,
que es parte integral y vinculante de (f-2).

**Invariante money-safe reafirmada:** nunca $0 inventado, nunca precio copiado entre acabados, override manual
`>0` explícito con **máxima precedencia absoluta**. Este dictamen **fortalece** la invariante (cierra una vía por
la que un feed automático infravaluaba/sobrescribía una decisión humana), no la debilita. **Requisito de gate:**
por tocar dinero, el cambio va con **triple veredicto + gate de seguridad por release** y **DEBE estar mergeado
y verificado ANTES** de que devops flipee `PRICE_PROVIDER=tcgcsv_singles` en producción (es la condición que
neutraliza P47-2; sin el fix, el switch a escritor diario materializa el hallazgo ALTA).

#### (f-3) Dictamen P47-2 (v1.47, NORMATIVO) — la durabilidad manual son DOS capas: comparador + SELECCIÓN de candidatas; el override manual es candidata PERENNE

> **Escalada (re-gate seguridad + techlead sobre P47-2).** El re-gate encontró que el punto 4 de (f-2, v1.46)
> es **incompleto**: afirmaba que «el fix vive por completo en el comparador; ninguna migración, ninguna
> re-resolución». Eso solo es cierto para las rutas de lectura **sin cota** (`getReferencesBatch`,
> `getSeparateProductsByCard`). Las rutas **single-item** `getReference` / `getReferenceByCardProduct` acotan las
> candidatas con `take SAME_DAY_REF_CANDIDATES (=32)` bajo `orderBy capturedDate desc`. Con el override manual
> persistido a `capturedDate` FIJO y el barrido `tcgcsv_singles` sumando ~1 fila/día **sin purga**, tras ~32 días
> la fila manual sale de la ventana top-32 y **nunca llega al comparador** → el precio humano vuelve a ser pisado
> en silencio. Ver el punto 4 de (f-2), ya corregido con reenvío aquí.

**Dictamen: la garantía §K/§E.1 «el override manual gana la lectura TODOS los días» se sostiene sobre DOS capas
independientes; ambas son obligatorias y ninguna basta por sí sola:**

**(a) Capa de comparación — `isBetterRef` (tier manual absoluto). YA HECHO en (f-2).** Dado un conjunto de
candidatas que **incluya** el override manual, el comparador lo iza por encima de `capturedDate` (paso 1 de
(f-2)). Sin cambios respecto a (f-2).

**(b) Capa de SELECCIÓN de candidatas — la lectura DEBE garantizar que el manual sea candidata. NUEVO (v1.47).**
La capa (a) solo puede elegir lo que la query trae. Por tanto se norma el siguiente **invariante de selección**,
vinculante para las cuatro funciones de resolución:

> **INVARIANTE DE CANDIDATA PERENNE (v1.47):** para cualquier clave de resolución
> `(cardId | cardProductId, productType, gradeKey, finish)`, el conjunto de filas `PriceReference` que se pasa a
> `pickBestRef`/`isBetterRef` DEBE contener **TODA** fila de esa clave con `isManualOverride = true` /
> `source = 'manual'`, **independientemente de su `capturedDate`** y **independientemente de cualquier cap de
> recencia** (`take`). El override manual es una **candidata perenne**: jamás puede quedar excluido de la
> selección por antigüedad, por volumen de filas automáticas acumuladas, ni por ningún límite de página.

**Consistencia de los TRES (cuatro) caminos de lectura — todos honran el tier manual por igual.** Es un requisito
de **consistencia**, no de implementación idéntica:

| Camino de resolución | Estado hoy | Acción v1.47 |
|---|---|---|
| `getReferencesBatch` | `findMany` **sin `take`** → trae toda la clave; el manual siempre es candidata. **Ya cumple.** | Ninguna (documentar que cumple). |
| `getSeparateProductsByCard` | `findMany` **sin `take`** → idem. **Ya cumple.** | Ninguna. |
| `getReference` | `take: SAME_DAY_REF_CANDIDATES (=32)` → el manual cae fuera tras ~32 días. **NO cumple.** | **Alinear al invariante de candidata perenne.** |
| `getReferenceByCardProduct` | `take: SAME_DAY_REF_CANDIDATES (=32)` → idem. **NO cumple.** | **Alinear al invariante de candidata perenne.** |

Los batch **ya** honran el tier manual precisamente **porque no tienen cap**; los single-item deben quedar
**consistentes** con ellos. No se exige quitar el cap en general (la cota de recencia sigue siendo legítima para
acotar el histórico automático); se exige que el cap **nunca** excluya al manual.

**Derogación del comentario de `SAME_DAY_REF_CANDIDATES`.** El comentario actual de la constante
(`pricing.service.ts`) afirma: «TODAS las filas del día más reciente (**las únicas que pueden ganar**) caen en el
bloque inicial». Esa premisa —«solo pueden ganar las filas del día más reciente»— fue **DEROGADA por (f-2)**: el
override manual gana **independientemente de su fecha**, luego una fila que **no** es del día más reciente **sí**
puede ganar. **Backend debe reescribir ese comentario** para reflejar (f-2)/(f-3): (i) el ganador ya **no** es
necesariamente del día más reciente —un override manual antiguo supera a un feed automático fresco—; (ii) por eso
la selección single-item **no** puede depender solo de una ventana de recencia; (iii) el override manual es
candidata perenne y DEBE incluirse siempre. *(Es documentación/decisión del arquitecto; la reescritura del
comentario en código la hace backend, dueño de `backend/`.)*

**Sigue siendo precedencia de LECTURA pura.** Este dictamen **no** reintroduce escritura, **no** migra datos y
**no** re-resuelve filas ya escritas: solo cambia **qué filas se SELECCIONAN** para pasarlas al comparador en las
dos rutas single-item. `tcgcsv_singles` sigue siendo el único escritor del barrido (§4.35(f)); `persistMarketReference`
sigue haciendo skip sobre la fila `isManualOverride` del día; el schema y la forma de contrato **no cambian**. La
única diferencia observable: en las rutas single-item, un override manual de hace >32 días vuelve a ganar la
lectura (que es la garantía §K que estaba silenciosamente rota tras ~1 mes).

**Dirección exacta para BACKEND (invariante, no implementación).** El invariante a cumplir es el de **candidata
perenne** de arriba, para `getReference` y `getReferenceByCardProduct`. **Backend elige el «cómo»**; cualquiera de
estas opciones (u otra equivalente que cumpla el invariante) es **aceptable**:

1. **Lectura dirigida adicional del manual, sin cota de fecha, unida a las candidatas del día.** Además del
   `findMany` acotado por recencia, emitir una segunda lectura filtrada por `isManualOverride: true` /
   `source: 'manual'` de la misma clave **sin `take`** (a lo sumo `take: 1` con `orderBy capturedDate desc` para
   el manual más reciente, que es el que gana el tier por el paso 2 de (f-2)), y **unir** ese resultado al set de
   candidatas antes de `pickBestRef`. Preferida si se quiere conservar el cap de recencia para el histórico
   automático.
2. **Pin del tier manual en la propia query** (p. ej. `orderBy` que ponga `isManualOverride desc` ANTES de
   `capturedDate desc`, de modo que las filas manuales encabecen y el `take: 32` nunca las descarte). Debe
   garantizar que **todas** las filas manuales de la clave queden dentro de la ventana, no solo una — si por diseño
   solo puede ganar el manual más reciente (paso 2), basta con que ese quede dentro.
3. **Quitar el cap para esta clave**, dado que las filas por
   `(cardId | cardProductId, productType, gradeKey, finish)` ya están naturalmente acotadas en cardinalidad (el
   histórico por-clave-por-día es un puñado); alinea las rutas single-item con los batch, que ya operan sin `take`.
   Aceptable si el análisis de volumen por-clave lo respalda.

**Requisito de gate:** por tocar dinero, este cambio va con el **mismo gate que (f-2)** —triple veredicto + gate de
seguridad por release— y **DEBE estar mergeado y verificado ANTES** del switch `PRICE_PROVIDER=tcgcsv_singles` en
prod. (f-2) **sin** (f-3) deja la garantía §K rota con retardo de ~1 mes en las rutas single-item; por eso (f-3)
es **condición de cierre de P47-2**, no un follow-up opcional.

#### (g) Migración M-31 y qué pasa con M-29 / los `*Finishes` existentes

Ver §11 (tabla M-31). Resumen de la transición:

- **Backfill de `CardProduct`:** por cada `Card` con `tcgplayerId` numérico, crear un `CardProduct(kind=set_base,
  tcgplayerProductId=Int(tcgplayerId), name=Card.name, finishes = Card.structuralFinishes ?? Card.availableFinishes)`.
  Esto preserva la composición ya materializada por **M-29** como semilla del set_base; el `--force` por set la
  REEMPLAZA con la lectura exacta de la fuente (donde el fantasma desaparece y aparecen los Deck Exclusives como
  productos propios).
- **`availableFinishes`** queda igual en forma (Finish[], no vacía, `FINISH_ORDER`); cambia su ORIGEN al recomputarse
  desde `CardProduct`. Tras el re-sync por set, los `normal` fantasma de las premium desaparecen SIN el filtro
  `isPremiumRarity` (porque el producto de set nunca trajo `Normal`).
- **`structuralFinishes` / `catalogFinishes` / `pricedFinishesSnapshot`** quedan MUERTAS (dejan de leerse). No se
  dropean en M-31 (reversibilidad: si hay que revertir el deploy, el resolver viejo aún las encuentra). Se dropean en
  una migración posterior una vez validado en prod.
- **`PriceReference` existentes** (source PPT/pokemontcg.io) siguen válidas: quedan con `cardProductId = null` hasta que
  el re-sync por set las re-emita como `tcgcsv_singles` con su `cardProductId`. La precedencia (f) hace que la fila
  TCGCSV, cuando exista, gane; la PPT queda como fallback. **Ninguna fila se borra** (money-safe: no se pierde precio).

#### (h) Plan de verificación barato (por-set, ANTES del re-sync completo ~1.5h)

El resolver corre como paso de `importSet` gateado a `--force`, así que **la validación por-set ya está soportada**
por `POST /admin/catalog/sync {setId, force:true}` (P-12, §4.25c) — segundos, no la corrida completa. Secuencia
exigida por el PO:

1. Deploy de M-31 + código nuevo (sin dropear columnas muertas).
2. `POST /admin/catalog/sync {setId: <Pitch Black>, force:true}` — corre `CardProductResolverService` sobre el grupo
   24688 en segundos.
3. **Criterios de aceptación observables en el binder Master Set de Pitch Black:**
   - Las energías especiales (p. ej. «Voltaic Lightning Energy 084/084») muestran **2 casillas** (`holofoil`,
     `reverse_holo`), **no 3** — el `normal` fantasma desapareció.
   - El producto **«Deck Exclusives»** (707029) aparece como **su propio producto vendible/cotizable** con su
     precio propio, separado de la carta de set.
   - Los precios se muestran **por variante, reales** (TCGCSV marketPrice → MXN Banxico), y **«—» honesto** donde la
     fuente no trae precio (nunca 0).
4. Solo tras validar Pitch Black se autoriza el **re-sync completo** (`sync-all {force:true}`) para propagar a todos
   los sets.

#### (i) Impacto en el contrato de API

Ver API_CONTRACT (Changelog v1.29). En una línea: `MasterSetCardCellDTO` y el cotizador ganan un arreglo
`separateProducts: CardProductDTO[]` (los `deck_exclusive`/`promo` de la carta, cada uno con su `productId`, `kind`,
`name`, `finishes` y precio por variante en MXN o `null`); `availableFinishes`/`variants[].marketReferenceMxnCents` no
cambian de forma pero ahora son EXACTOS; `displayFinishes` queda DEPRECADO (= `availableFinishes`). Todo aditivo y
money-safe (PRICE_PENDING, «—» = null preservados).

#### (j) Riesgos y deuda (abiertos, para confirmar en implementación)

- **R-1 (a confirmar en implementación):** ¿el producto «Deck Exclusives» 707029 cae en el MISMO `groupId` TCGCSV del
  set (24688)? El diseño lo ASUME (el resolver solo fetchea el grupo del set). Si TCGplayer lo coloca en OTRO grupo
  (p. ej. un grupo «Deck Exclusives» aparte), el resolver debe ampliar el fetch a grupos hermanos — se decide con la
  evidencia del `--force` de Pitch Black. **Reversible.**
- **R-2:** clasificación de `kind` por NOMBRE (substring) es heurística de STRING (no de rareza); un nombre atípico
  puede caer en `other` y colgarse al binder como set_base. Fail-safe conservador (mejor una casilla de más visible que
  un producto perdido); revisable con fixtures reales por set. **Reversible.**
- **R-3:** el join por número normalizado para productos SIN ancla `tcgplayerId` hereda la ambigüedad de números
  repetidos; se OMITE ante ambigüedad (money-safe) — puede dejar un Deck Exclusive sin colgar hasta poblar su ancla.
  Observabilidad por log. **Reversible.**
- **Deuda:** dropear las columnas muertas (`structuralFinishes`/`catalogFinishes`/`pricedFinishesSnapshot`) en
  migración posterior tras validar prod; retirar el campo `displayFinishes` del contrato en la siguiente rev de front.
  Anotar en `TECH_DEBT.md` (a petición del techlead; lo escribe el rol dueño del código).

---

### 4.28 Catálogo canónico de rarezas — que la rareza del ingest empate 1:1 con las reglas de precio del admin (v1.29, NORMATIVO)

> **Propósito.** Requisito del dueño: «que las rarezas de las cartas empaten con lo que tenemos registrado en precios
> admin». Hoy no empatan de forma fiable: `Card.rarity` guarda el **string CRUDO de pokemontcg.io SIN normalizar** y las
> reglas de precio del admin se resuelven por **match EXACTO case-sensitive** contra ese string. Cualquier discrepancia
> (mayúsculas, espacios, alias) cae al **fallback pct silenciosamente**. Esta sección define un **catálogo canónico y
> autoritativo de rarezas**, compartido por catálogo, ingest y reglas de precio, para que toda rareza que produce el
> ingest tenga forma canónica que empate 1:1 con las keys que el admin edita. Encaja con §4.27: el **finish sale del
> producto (`CardProduct`), la rareza sale de la carta (`Card`)** — dos ejes limpios.

#### (a) La causa raíz (diagnóstico, con evidencia)

- `Card.rarity` se escribe **crudo** desde pokemontcg.io, sin normalizar: `catalog-sync.service.ts:464`
  (`rarity: c.rarity ?? null`); taxonomía «String libre / abierta» (`schema.prisma:396`). **No existe capa de
  normalización.**
- Las reglas del admin (`BUYLIST_PRICE_RULES` / `SALES_PRICE_RULES` en `ConfigSetting`,
  `settings.constants.ts:105-119`) se resuelven por **match EXACTO case-sensitive** de key de objeto contra ese string
  crudo: `money.ts:309` — `candidates.find((k) => rules[k] != null)`, **sin `toLowerCase`/`trim`**.
- El admin **NO captura rarezas a mano**: las hereda del catálogo vía `prisma.card.groupBy(['rarity'])`
  (`pricing.controller.ts:286-289` y el eco de ventas). Así, una regla solo «engancha» si la key es **byte-idéntica**
  al string de pokemontcg.io; si no, cae al fallback (`BUYLIST_PRICE_FALLBACK_PCT=40`, `SALES_PRICE_FALLBACK_PCT=15`,
  `settings.constants.ts:110,122`) **sin aviso**.
- El candidato existente **`RARITY_MAP`** (`settings.constants.ts:132-144`, endpoint `rarity-map`
  `pricing.controller.ts:202-222`) está **DEPRECADO y desconectado** de la cotización (`settings.constants.ts:57-58`);
  mapea a 3 categorías internas (`comun`/`reverse_holo`/`ex_plus`), no al eje de reglas por rareza vigente.

#### (b) Catálogo canónico de rarezas (fuente única, compartida)

Se define **`CANONICAL_RARITIES`** — un catálogo **cerrado y versionado** en `backend/src/common/` (zona compartida),
la ÚNICA lista autoritativa de rarezas del sistema. Cada entrada es DATO (no regex dispersa):

```ts
// backend/src/common/rarity-catalog.ts (backend implementa; el arquitecto define la forma y la semántica)
interface CanonicalRarity {
  key: string;        // etiqueta canónica EXACTA = la key que el admin edita en las reglas (p. ej. "Rare Holo")
  premium: boolean;   // ← ÚNICA definición de «premium/chase» del sistema (ver (e))
  aliases: string[];  // formas NORMALIZADAS de pokemontcg.io que colapsan a esta canónica
}
```

- La `key` canónica es **la misma cadena** con la que el admin edita `BUYLIST_PRICE_RULES`/`SALES_PRICE_RULES` ⇒ empate
  1:1 por construcción.
- `premium` vive en el CATÁLOGO (dato auditable), no en una regex — de él sale la unificación de (e).
- El seed inicial cubre las rarezas modernas y clásicas que ya usa el negocio (Common, Uncommon, Rare, Rare Holo,
  Reverse Holo, Double Rare, Ultra Rare, Illustration Rare, Special Illustration Rare, Hyper Rare, Secret Rare, etc.),
  reproduciendo el comportamiento de negocio vigente (los defaults de §E.1: Common/Uncommon fijo, el resto → fallback
  pct). **Money-safe:** una rareza sin regla explícita sigue cayendo al fallback pct de forma **predecible y
  auditable** — nunca un 0 inventado.

#### (c) Normalizador `rawRarity → canonicalRarity` y DÓNDE se aplica

Función pura **`normalizeRarity(raw: string | null): string | null`** (reemplaza el rol que RARITY_MAP nunca cumplió
para la cotización):

1. Forma normalizada: `lowercase` + `trim` + colapsar espacios + quitar no-alfanuméricos → clave de búsqueda.
2. Busca esa clave en los `aliases` del catálogo ⇒ devuelve la `key` canónica.
3. **Rareza no mapeada** (alias desconocido): devuelve una canónica **pass-through** (Title-case de la forma
   normalizada) y la MARCA como `unmapped` (observabilidad) para que el admin la vea y le asigne regla; entretanto cae
   al fallback pct predecible. **Nunca** se descarta ni se inventa precio.

**Puntos de aplicación (los tres, defensa en profundidad):**

- **INGEST (autoritativo):** en `upsertCards` (`catalog-sync.service.ts:464`) se sigue guardando `Card.rarity` CRUDO
  (procedencia), y se escribe **un campo derivado nuevo `Card.rarityCanonical String?` = `normalizeRarity(c.rarity)`**
  (migración **M-31**, §11). Es el campo que consumen precios y admin.
- **ADMIN (la lista que el dueño edita):** `GET /admin/pricing/rarities` (y su eco de ventas) agrupan por
  **`rarityCanonical`** (no por `rarity` crudo) — `pricing.controller.ts:286` cambia `by: ['rarity']` → `by:
  ['rarityCanonical']`. Así la lista editable es EXACTAMENTE el conjunto canónico que produce el ingest ⇒ empate 1:1.
- **LOOKUP (cinturón y tirantes):** el resolver de reglas usa `rarityCanonical` como entrada; además el `find` de
  `money.ts:309` normaliza AMBOS lados (key de regla y rareza) antes de comparar, para que una regla legacy con key
  cruda siga enganchando durante la transición. Cuando ambos lados son canónicos el match es directo.

#### (d) Separar el eje RAREZA (carta) del eje ACABADO/finish (variante) en las reglas de precio

Hoy las reglas son un `Record<string, Rule>` **plano** que MEZCLA keys de rareza (`Common`, `Uncommon`) con keys
**sintéticas por-acabado** (`Holo`, `Reverse Holo`) que fabrica `ruleKeyCandidates` (`money.ts:228-251`). Esas keys
sintéticas **no son valores de `Card.rarity`** (`settings.constants.ts:108,117,118`) y están **parcheadas a mano en el
front** para no perderlas (`M2View.tsx:332-336,382-385,436-438`, INV-1). Con §4.27 (el finish sale del `CardProduct`,
la rareza de la `Card`) esto se separa limpio en **dos ejes explícitos**:

```ts
interface PriceRuleSet {
  rarityRules: Record<string /* CanonicalRarity.key */, Rule>;  // eje RAREZA (de la carta)
  finishRules: Partial<Record<Finish, Rule>>;                    // eje ACABADO (de la variante/producto)
  fallbackPct: number;
}
```

- `rarityRules` keyeadas por **canónica** (Common, Uncommon, Rare Holo…). `finishRules` keyeadas por el **enum
  `Finish`** (`reverse_holo`, `holofoil`…) — ya no por las cadenas sintéticas «Holo»/«Reverse Holo».
- **Precedencia del resolver (misma semántica de negocio que hoy, sin colisión de strings):** para
  `(canonicalRarity, finish)` — si `finish ∈ {reverse_holo, holofoil, first_edition_holofoil}` y existe `finishRules[finish]`,
  aplica esa (salvo que la rareza sea `premium`, que cotiza por su `rarityRule`/fallback pct sobre el market de ese
  acabado — la regla de `money.ts:238` se conserva); si no, aplica `rarityRules[canonicalRarity]`; si no, `fallbackPct`.
  `ruleKeyCandidates` deja de fabricar keys sintéticas: pasa a devolver «¿regla de finish o de rareza?» sobre los dos
  mapas.
- **Retira el parche del front** (INV-1, `M2View.tsx`): con el eje de acabado explícito, el M2 edita `finishRules` como
  su propia sección, sin inyectar keys sintéticas manualmente.
- **Migración de datos (seed):** el `PriceRuleSet` inicial se obtiene partiendo el mapa plano actual — las keys `Holo`/
  `Reverse Holo` migran a `finishRules[holofoil]`/`finishRules[reverse_holo]`; el resto migra a `rarityRules` con su key
  canonicalizada. Reproduce EXACTAMENTE el resultado de negocio vigente (§E.1). Money-safe: rareza sin regla → fallback.

#### (e) Una sola definición de «premium» (retira las DOS divergentes)

Hoy hay **dos `isPremiumRarity` que dan verdictos OPUESTOS** sobre el mismo string:

| String | `money.ts:206` (`PREMIUM_RARITY_PATTERNS`) | `ppt-sync-scope.ts:98` (`PREMIUM_RARITY_TERMS`) |
|---|---|---|
| `Rare Holo` | **NO** premium (no hay patrón `holo`) | **SÍ** premium (`'holo' ∈ TERMS`) |
| `Double Rare` | **SÍ** premium (`/double\s*rare/`) | **NO** premium (no está en TERMS) |

`card-order.ts:80,129` AFIRMA «una sola definición de premium en todo el sistema», pero está **roto**. Diseño:

- **La verdad de «premium» es el atributo `premium` del catálogo canónico (b)** — DATO, no regex. Una sola función
  **`isPremiumCanonicalRarity(canonicalKey): boolean`** lee ese atributo. Se define sobre la **rareza normalizada**, así
  que un mismo string produce SIEMPRE el mismo verdicto en todo el sistema.
- **Se RETIRAN** `PREMIUM_RARITY_PATTERNS` (`money.ts:182-200`) y `PREMIUM_RARITY_TERMS` (`ppt-sync-scope.ts:67-86`).
  Ambos call-sites pasan a leer el catálogo.
- **Los dos verdictos en conflicto** (`Rare Holo`, `Double Rare`) los resuelve el catálogo con UN valor por rareza
  (decisión de negocio del PO, a fijar en el seed). **Salvedad honesta:** los dos usos ORIGINALES perseguían preguntas
  distintas — `money.ts` = «¿cotiza por % en vez del bin fijo barato de bulk?» (gate de pricing del buylist);
  `ppt-sync-scope.ts` = «¿vale gastar un crédito de API de paga para preciar esta carta en un set viejo?» (gate de
  presupuesto de sync). Si el negocio confirma que necesitan UMBRALES distintos, NO se recrean dos regex secretas: se
  definen como **predicados NOMBRADOS y documentados** sobre el catálogo canónico (p. ej. `isChaseForPricing` vs
  `isWorthPaidLookup`), cada uno como una **lista explícita de canónicas** sobre la misma fuente — nunca dos
  `isPremiumRarity` divergentes. **Decisión abierta R-4** (ver (g)): confirmar si es UN premium o dos umbrales
  nombrados.

#### (f) Migración M-31 (parte rareza) y money-safe

Ver §11 (M-31). En resumen: `Card.rarityCanonical String?` nueva (nullable), backfill `UPDATE "Card" SET
"rarityCanonical" = normalizeRarity("rarity")` (el backend corre el normalizador en el data-migration); `Card.rarity`
CRUDO se conserva (procedencia). El seed de reglas migra a `PriceRuleSet` (rarity/finish). **Invariante money-safe
intacta:** rareza sin regla explícita → fallback pct **predecible y auditable** (no un 0); la composición y el precio de
variante de §4.27 no dependen de la rareza (el finish sale del producto), así que la normalización de rareza NO puede
crear ni borrar casillas — solo afecta a QUÉ regla de precio engancha.

#### (g) Riesgos y deuda (abiertos)

- **R-4:** ¿«premium» es un solo atributo del catálogo, o dos predicados nombrados (`isChaseForPricing` vs
  `isWorthPaidLookup`)? Decisión de negocio del PO; el diseño soporta ambas sin recrear regex. **Reversible.**
- **R-5:** el seed del catálogo canónico debe cubrir las rarezas realmente presentes; una rareza nueva de un release
  futuro entra como `unmapped` (fallback pct) hasta que se añada al catálogo — comportamiento predecible, visible al
  admin. Anotar en `TECH_DEBT.md` el proceso de «añadir rareza nueva al catálogo».
- **Deuda:** retirar definitivamente `RARITY_MAP` y el endpoint `rarity-map` (ya deprecados) una vez el catálogo
  canónico esté en producción; retirar el parche INV-1 del front. A petición del techlead, lo anota el rol dueño.

---

### 4.29 Línea de buylist por `productId` — cotizar/vender un `CardProduct` separado (v1.30, NORMATIVO)

> **Propósito.** Cerrar el hueco que el front detectó tras v1.29 (§4.27): la presentación ya expone los **productos
> separados** (`separateProducts: CardProductDTO[]`, `kind ∈ {deck_exclusive, promo}`), pero la **línea de
> cotización/venta** del buylist se identificaba SOLO por `(cardId, finish)` — `BuylistQuoteItemDTO` no tenía cómo
> apuntar a un `productId`. Por eso un producto separado (Deck Exclusive «Voltaic Lightning Energy 084/084», productId
> **707029**, distinto del set_base **704841** que comparte el número 084/084) **no podía cotizarse ni ir al carrito
> como línea propia** sin fusionarse con la carta de set. El PO confirmó que SÍ quiere operarlos como su propio
> producto, con su propio precio. Cambio **ADITIVO y RETROCOMPATIBLE**; reusa el modelo M-31 (§4.27b), no toca §4.27/
> §4.28 en su sustancia (esta sección solo AÑADE una llave a la línea de buylist).

#### (a) Qué se añade (contrato)

`productId?: number` OPCIONAL en la **línea** de buylist — es el **mismo** `productId` de TCGplayer que el front ya
recibe en `CardProductDTO.productId` (`separateProducts`), es decir `CardProduct.tcgplayerProductId`, **no** el UUID
interno `CardProduct.id`. Se añade en (ver API_CONTRACT §DTOs y §M5):

- `BuylistQuoteItemDTO` (batch `POST /buylist/quote/batch`) y `Req` de `POST /buylist/quote` (por-carta) — **entrada**.
- `BuylistQuotePayload` (respuesta por-carta y por-ítem del batch) — **eco**.
- `items[]` de `POST /buylist/requests` y `SellItemDTO` — **entrada + snapshot**.

#### (b) Regla de resolución (server-side, SEC-A1 intacto)

| `productId` | Identidad de la línea | Whitelist de acabado | Referencia de mercado | Regla de precio |
|---|---|---|---|---|
| **ausente** (default) | producto de **set_base** por `(cardId, finish)` — **comportamiento v1.29 idéntico** | `Card.availableFinishes` | `PriceReference` de `(cardId, raw, raw:NM, finish)` como hoy | `rarityCanonical(carta) × finish` (§4.28d) |
| **presente** | ESE `CardProduct` (resuelto por `tcgplayerProductId == productId`) | **`CardProduct.finishes`** | `PriceReference` filtrada por **ese `cardProductId`** (precio propio del producto, §4.27b/e) | `rarityCanonical(carta) × finish del producto` |

- **Resolución del acabado con `productId`:** el `finish` se valida contra `CardProduct.finishes`. Si se **omite** y el
  producto tiene **un solo** acabado ⇒ se default-ea a ese; con **>1** acabado ⇒ `finish` es **obligatorio** (falta o
  no pertenece ⇒ `FINISH_NOT_AVAILABLE`). El producto ya define su(s) acabado(s); el cliente no puede inventar uno.
- **La rareza NO cambia de fuente:** sale de la carta (`rarityCanonical`), no del producto — encaja con `PriceRuleSet`
  (§4.28d): rareza-de-la-carta selecciona `rarityRules`, acabado-del-producto selecciona `finishRules`. El gate premium
  (`isPremiumRarity`) y toda la derivación server-side del monto siguen idénticos (el cliente jamás manda el monto).
- **Ancla exacta:** el `productId` → `CardProduct` → `PriceReference.cardProductId` es el MISMO eje que M-31 metió en
  la `@@unique [cardId, productType, gradeKey, finish, capturedDate, cardProductId]` (§4.27b). Por eso dos productos de
  la misma carta con el mismo `Finish` (p. ej. set_base `holofoil` y promo `holofoil`) resuelven a precios DISTINTOS
  sin colisión.

#### (c) Money-safe y validación (guards H1/H2/H3 + MoneyOutGuard intactos)

- **Producto sin precio en ninguna fuente** ⇒ `quote.status="precio_pendiente"` / `quotedPriceCents=null` / celda «—»
  — **jamás 0** (misma invariante H1/H2/H3 de §4.27e). Una regla `fixed` siempre cotiza; una `pct` sin referencia del
  producto cae en `precio_pendiente`, exactamente como el set_base.
- **`productId` inexistente** ⇒ `PRODUCT_NOT_FOUND` (batch: `ok:false` por-ítem; por-carta/`requests`: `422`).
- **`productId` que NO cuelga del `cardId`** ⇒ `PRODUCT_CARD_MISMATCH` — **rechazo validado, NUNCA fusión silenciosa**
  con la carta de set (un `productId` de otra carta no se «reinterpreta» como el set_base del `cardId` enviado).
- **El pago no se debilita:** `POST /buylist/quote[/batch]` sigue siendo READ-ONLY y anónimo (no persiste, no escala);
  la creación de solicitud escala una línea sin precio a `PendingPriceEntry` (con su `cardProductId`, ver (d)); el pago
  SPEI sigue tras **`MoneyOutGuard`** (`super_admin`) y no puede liquidar una línea en `precio_pendiente`.

#### (d) Unicidad de línea y persistencia (migración ADITIVA M-32)

- **Llave lógica de la línea:** gana `productId` → **`(cardId, finish, productId ?? base)`**. Dos líneas que comparten
  `(cardId, finish)` pero difieren en `productId` son **DISTINTAS**: no se fusionan ni deduplican (el modelo de buylist
  ya es **una línea por carta física**, §4.16b, sin `qty`). `productId` ausente = línea `base` (set_base). En el batch,
  la llave de **correlación** sigue siendo el `index` 0-based (ya robusta a repeticiones).
- **Persistencia (M-32, aditiva, nullable — análoga a como v1.6-finish añadió `SellRequestItem.finish` en M-19):**
  - `SellRequestItem.cardProductId Int?` — snapshot del `tcgplayerProductId` cotizado; se propaga al `InventoryItem`
    al convertir en M5 (la pieza queda ligada a ESE producto, no al set_base). `null` = línea de set_base.
  - `PendingPriceEntry.cardProductId Int?` — entra a la clave lógica de la cola: una entrada de producto separado NO se
    resuelve al fijar el precio del set_base (money-safe; misma doctrina que `finish` en v1.8-ronda-c). `null` = base.
  - **No** se dropea nada; filas viejas quedan con `cardProductId = null` = set_base (retrocompatible).
- La **lectura de precios** no necesita migración: reusa `PriceReference.cardProductId` de M-31. La resolución de
  `CardProduct` por `tcgplayerProductId` reusa el `@unique` ya existente (§4.27b).

#### (e) Alcance y no-alcance

- **En alcance:** la **línea de buylist** (cotizador público + solicitud autenticada + su proyección `SellItemDTO`).
- **Fuera de alcance (y por qué):** el **carrito de storefront** (compra cliente→plataforma) NO necesita este campo —
  se identifica por `inventoryItemId` (pieza física), que YA es un producto concreto; su precio de venta se resuelve
  por el `PriceReference.cardProductId` de la pieza (M-31), sin tocar el contrato de checkout. `MasterSetVariantDTO`,
  `separateProducts` y la valuación de bóveda tampoco cambian de forma (v1.29 ya los cubre).

---

### 4.30 EVALUACIÓN (ADR en papel) — ¿TCGCSV como fuente ÚNICA del catálogo (identidad + metadata + imágenes)? (v1.31)

> **Propósito.** El dueño quiere evaluar **cortar pokemontcg.io** y depender de UNA sola fuente ajena (TCGCSV, espejo
> diario de TCGplayer) para TODO el catálogo: qué cartas existen, su nombre/número/rareza, su metadata y sus imágenes —
> no solo estructura de variantes y precio (que ya se toman de TCGCSV desde M-31, §4.27). Motivación legítima: las
> caídas de pokemontcg.io nos preocupan y tener menos fuentes ajenas simplifica. Esto es una **evaluación de
> viabilidad**, no un cambio implementable: no toca contrato, schema ni código. **Enmarque de dos pasos:**
> - **Paso 1 (táctico, YA en curso — NO es esta evaluación):** refrescar variantes+precios de un set existente SOLO
>   desde TCGCSV, sin pokemontcg.io. Ya está cableado: `POST /admin/catalog/sync {setId, force:true}` corre
>   `CardProductResolverService.resolveCardProductsForSet` (`catalog-sync.service.ts:117-143,384-394`;
>   `card-product-resolver.service.ts:45-142`). Reduce la dependencia **operativa** de pokemontcg.io sin migrar el
>   catálogo. **Se recomienda continuarlo.**
> - **Paso 2 (grande — ESTA evaluación):** hacer de TCGCSV la fuente de **identidad + metadata + imágenes** del
>   catálogo y **cortar pokemontcg.io del todo**. Es un proyecto, no un switch. Veredicto abajo: **NO recomendado como
>   big-bang; sí un híbrido acotado.**

#### (a) Qué provee CADA fuente, campo por campo (con evidencia)

Hoy pokemontcg.io es el CATÁLOGO (identidad + metadata + imagen) y TCGCSV es ESTRUCTURA+PRECIO. El shape remoto de
pokemontcg.io está en `RemoteCard` (`pokemontcg-io.client.ts:23-41`); lo que de ahí se persiste en `Card` está en
`upsertCards` (`catalog-sync.service.ts:470-551`, escribe `name, number, numberSort/Prefix, rarity, rarityCanonical,
supertype, subtypes, imageSmallUrl, imageLargeUrl, tcgplayerId`). El payload de producto de TCGCSV está en las
fixtures `backend/test/fixtures/tcgcsv/products-23821.json` (campos `productId, name, cleanName, imageUrl, groupId,
url, modifiedOn, presaleInfo.releasedOn, extendedData[]`) y su endpoint de precios en `prices-structural-sv8.json`
(`{productId, subTypeName, marketPrice}`). `extendedData` observado por carta: `Rarity` (valor **abreviado**, p. ej.
`"DR"`), `Number` (`"057/191"`), `Card Type` (`"Pokemon"`), `HP`.

| Campo de `Card` / ficha | Hoy (pokemontcg.io) | Con TCGCSV como única fuente | Veredicto |
|---|---|---|---|
| **Identidad (`externalId`)** | `id` de pokemontcg.io (`@unique`), 1 fila = 1 carta impresa | `productId` de TCGplayer, pero **1 productId ≠ 1 carta** (ver (b)/(c)) | **Se PIERDE la identidad limpia** |
| **name** | `c.name` («Pikachu ex») | `product.name` («Pikachu ex - 057/191») o `cleanName` («Pikachu ex 057191») | **Se DEGRADA** (hay que limpiar el sufijo de número; `cleanName` pierde el `/`) |
| **number** | `c.number` («057/191» ó «57») | `extendedData.Number` («057/191»); `normalizeCardNumber` ya lo tolera | **Se CONSERVA** |
| **rarity (taxonomía)** | Rareza **oficial de Pokémon** en texto pleno («Double Rare», «Special Illustration Rare») | **Convención TCGplayer, a menudo ABREVIADA** («DR») y a veces **AUSENTE** (`Alolan Exeggutor ex` en la fixture no trae `Rarity`) | **Se DEGRADA FUERTE** — rompe el empate 1:1 con M-31 (ver (d)) |
| **supertype** | `c.supertype` («Pokémon/Trainer/Energy») | `extendedData."Card Type"` («Pokemon») — aproxima, no idéntico | **Se DEGRADA parcial** |
| **subtypes** | `c.subtypes[]` («Stage 2», «ex», «Tera») | **No lo provee TCGCSV** | **Se PIERDE** (hoy sí se guarda) |
| **imagen** | `images.small/large` = **scan oficial de la carta**, alta resolución | `imageUrl` = `tcgplayer-cdn.tcgplayer.com/product/<id>_200w.jpg` = **foto de producto de TCGplayer, 200px**, hotlink | **Se DEGRADA FUERTE** (resolución + licencia/hotlink, ver (e)) |
| **HP / ataques / tipo(energía) / debilidad / retiro / artista / flavor / #Pokédex / evolución** | pokemontcg.io los expone (`RemoteCard` solo tipa un subconjunto) | `HP` sí (en `extendedData`); el **resto NO** existe en TCGCSV | **Neutro HOY** (ver nota) — **se PIERDE a futuro** |
| **finishes/variantes por carta** | derivadas de `tcgplayer.prices` (señal débil, histórica) | `subTypeName` por `productId` (autoritativo) | **Ya se toma de TCGCSV (M-31); MEJORA** |
| **precio por variante** | `tcgplayer.prices[llave].market` (se descartaba pre-M-31) | `marketPrice` por `subTypeName` | **Ya se toma de TCGCSV (M-31)** |
| **release date / año de set** | `set.releaseDate` (alimenta filtro de año, `yearFromReleaseDate`) | `groups.publishedOn` + `product.presaleInfo.releasedOn` | **Se CONSERVA** |

> **Nota de honestidad sobre «lo que se pierde».** La ficha de la tienda HOY solo usa **name, number, rarity, set,
> imagen y finish** (PROJECT.md §A; `Card` no persiste ataques/artista/flavor/tipo). Por eso, cortar pokemontcg.io **no
> degrada la ficha ACTUAL** salvo en **imagen** y en **taxonomía de rareza**. Lo demás (HP, ataques, artista, flavor…)
> «se pierde» solo en el sentido de que **nunca se podría añadir** después sin re-conectar una fuente de metadata rica.
> Si el producto quisiera enriquecer la ficha en fase 2 (tipo, ataques, artista), TCGCSV **no** puede alimentarla.

#### (b) Re-llaveo de identidad: impacto y riesgo

Hoy `Card.externalId = id` de pokemontcg.io (`schema.prisma:407`, `@unique`) y es la **clave de upsert** del sync
(`catalog-sync.service.ts:511`). Dato clave para el riesgo: **todas las referencias a una carta apuntan a `Card.id`
(UUID interno), NO a `externalId`** — `InventoryItem.cardId` (`schema.prisma:528`), `PriceReference`,
`SellRequestItem`, `PendingPriceEntry`, `VariantPriceOverride`, `CardProduct.cardId`. Por eso:

- **Lo barato:** cambiar la *clave de upsert* del sync de `externalId` (pokemontcg.io) a un identificador derivado de
  TCGCSV **no obliga** a reescribir todas las FK: siguen colgando del `Card.id` UUID, que no cambia.
- **Lo caro y RIESGOSO — «¿cuál producto es la carta?»:** TCGCSV **no tiene el concepto de "carta"**, tiene
  **productos** (`productId`). El modelo actual (M-31, §4.27b) resuelve esto **apoyándose en pokemontcg.io como espina
  de identidad**: la `Card` = carta de pokemontcg.io, y los N `CardProduct` (por `productId`) cuelgan de ella. **Cortar
  pokemontcg.io quita esa espina** y obliga a **derivar la carta canónica desde los productos** — que es justo el
  problema del `normal` fantasma que M-31 combatió (§4.27, changelog v1.29): el par `(groupId, número)` **NO es único
  por carta** (caso confirmado 084/084: `set_base` 704841 **+** `deck_exclusive` 707029 comparten número). Agrupar por
  `(grupo, número)` volvería a **fundir** el Deck Exclusive con la carta de set. No hay en TCGCSV una llave limpia que
  diga «estos 2 productos son la MISMA carta y estos otros 2 son cartas distintas» sin heurística de nombre/kind — la
  misma clase de heurística que el PO ordenó **retirar** en v1.29.
- **Migración de datos:** re-llavear el catálogo entero es una migración **sobre datos vivos que tocan dinero**
  (`PriceReference`, valuación de bóveda, snapshots de portafolio, líneas de buylist con `cardProductId`). Si el
  agrupamiento canónico cambia, hay que **re-mapear inventario/órdenes/vault** a las nuevas filas `Card`, y decidir qué
  pasa con cartas que pokemontcg.io tenía y TCGCSV no lista igual (promos sueltas, numeraciones alternas). **Tamaño:
  grande; riesgo: alto (money-touching, zona compartida `prisma/` + contrato).** No es reversible con un flag.

#### (c) Construir «cartas» desde «productos»: casos ambiguos

Derivar la lista canónica de cartas desde los productos comerciales de TCGCSV reusaría el binder de M-31, pero al ser
la ÚNICA fuente aparecen ambigüedades que hoy pokemontcg.io resuelve:

- **Sellado** (`booster box`, `ETB`, `bundle`, `sleeved pack`…): productos SIN `extendedData.Number` — hay que
  excluirlos de «cartas» (ya se detecta por ausencia de `Number` y por `classifyCardProductKind`, `tcgcsv-singles.provider.ts:139-145`). Manejable.
- **Deck Exclusives / promos con el MISMO número que una carta de set:** ¿son «la misma carta en otra impresión» o
  «una carta distinta»? M-31 los trata como `CardProduct` **separados bajo una carta ancla de pokemontcg.io**. Sin esa
  ancla, el agrupamiento es una decisión de negocio ambigua, product-por-producto.
- **Rareza abreviada/ausente:** un producto sin `Rarity` en `extendedData` no tiene rareza → sin pokemontcg.io no hay
  de dónde tomarla → cae a `precio_pendiente`/fallback en el buylist (ver (d)).
- **Jumbo / Staff / League / Prerelease:** hoy `classifyCardProductKind`→`promo`; como fuente única habría que decidir
  si son «cartas del catálogo» o ruido.

#### (d) Rareza: choque con el catálogo canónico de M-31

M-31 (§4.28) construyó `CANONICAL_RARITIES` (`common/rarity-catalog.ts`) con **aliases derivados de las formas
NORMALIZADAS de pokemontcg.io**; `normalizeRarity(raw)` alimenta `Card.rarityCanonical`, que es lo que el admin edita
y lo que el buylist usa para elegir la regla de precio (§4.28d). TCGCSV entrega la rareza en **convención TCGplayer,
frecuentemente abreviada** (`"DR"`, `"SIR"`, `"ACE"`…) y a veces **vacía**. Cortar pokemontcg.io **rompe el empate
1:1**: habría que construir y mantener un **nuevo mapa de alias TCGplayer-código → canónico** (p. ej. `"DR"`→«Double
Rare»), y las cartas sin `Rarity` quedarían sin regla → caen al **fallback pct** en silencio (misma clase de bug que
§4.28 combatió). Esto es trabajo nuevo, frágil (los códigos de TCGplayer cambian por set) y **money-touching** (rareza
mal mapeada = pago de buylist equivocado).

#### (e) Cobertura, frescura e imágenes

- **Frescura de sets nuevos:** TCGCSV/TCGplayer suele **listar productos en preventa**, a veces **antes** que
  pokemontcg.io publique la data oficial de las cartas — a favor de TCGCSV para estructura+precio. **Pero** en preventa
  el `extendedData` puede venir **incompleto** (sin `Number`, sin `Rarity`, con `presaleInfo.isPresale=true`): bueno
  para «hay producto y precio», malo para «identidad de carta estable».
- **Imágenes (licencia/calidad):** `imageUrl` es `tcgplayer-cdn.tcgplayer.com/product/<id>_200w.jpg` — **200px, foto
  de producto** (no scan de carta), **hotlinkeada** a la CDN de TCGplayer. Riesgos: (1) **calidad** muy inferior a la
  ficha actual (scan oficial hi-res); (2) **licencia/ToS** — hotlinkear imágenes de producto de TCGplayer en un
  marketplace comercial propio es una zona gris legal; (3) **disponibilidad** — protección anti-hotlink o cambio de
  ruta de CDN nos rompe TODAS las imágenes. pokemontcg.io también es tercero, pero sus imágenes son scans pensados para
  catálogo. Migrar a imágenes de TCGplayer probablemente exigiría **proxy/caché propio** (contradice PROJECT.md v1.2
  «sin object storage salvo INE»).
- **Taxonomía de rareza:** ya cubierto en (d) — TCGplayer ≠ taxonomía oficial; no empata con M-31 sin capa de traducción nueva.

#### (f) ¿Se puede cortar pokemontcg.io sin degradar la ficha? Dónde vive HOY la dependencia

Punto central para el veredicto: **pokemontcg.io es una dependencia de TIEMPO DE IMPORTACIÓN, no de runtime.** El
storefront, el checkout, la valuación de portafolio y el pricing **corren contra la BD local + TCGCSV**, no llaman a
pokemontcg.io. pokemontcg.io se toca SOLO en el sync de catálogo/metadata (M2, §4.8), que es idempotente, corre pocas
veces y **ya degrada con gracia**: `remoteSets()` cae a sets locales si la fuente falla (`catalog-sync.service.ts:67-89`)
y `withUpstreamGuard` remapea un 5xx crudo a un `502 UPSTREAM_ERROR` accionable en vez de tumbar el sync
(`catalog-sync.service.ts:371-382`). **Es decir: una caída de pokemontcg.io NO bloquea la tienda ni el dinero HOY** —
bloquea, a lo sumo, **importar un set nuevo** hasta que la fuente vuelva. El dolor real es acotado.

#### (g) Estrategia recomendada — HÍBRIDO, no big-bang

1. **Conservar pokemontcg.io como columna de identidad + metadata + imagen del catálogo.** Es barato (import-time,
   raro, ya degradado con gracia) y aporta lo que TCGCSV no puede: identidad limpia 1-carta-1-fila, rareza en taxonomía
   oficial (que M-31 ya alinea) e imágenes de catálogo.
2. **Seguir moviendo la dependencia OPERATIVA a TCGCSV (paso 1, ya en curso).** Estructura+precio de variantes por set
   desde TCGCSV es lo correcto y ya está (M-31 + P-12 §4.25c). Ahí es donde vive el valor de negocio (dinero) y ya no
   depende de pokemontcg.io.
3. **(Opcional, aditivo, bajo riesgo) TCGCSV como FALLBACK de enriquecimiento** cuando pokemontcg.io no tenga un set o
   esté caído: usar `product.name/cleanName` + `imageUrl` + `extendedData.Rarity` para NO dejar la carta en blanco,
   marcándola como «metadata degradada». Esto captura ~90% del beneficio de «menos dependencia de fuentes ajenas» a ~5%
   del costo, sin re-llavear ni migrar. **Requiere** la capa de traducción de rareza de (d) y una decisión de imagen de (e).
4. **NO re-llavear identidad a `productId`** salvo evento existencial (que pokemontcg.io CIERRE). Si eso ocurre, el plan
   de migración queda esbozado aquí: derivar carta canónica por `(groupId, número, kind=set_base)`, tratar
   deck_exclusive/promo como cartas propias, construir alias de rareza TCGplayer→canónico, resolver imagen vía
   proxy/caché, y correr una migración money-safe con QA E2E + fase de seguridad (toca `prisma/` y contrato).

#### (h) Veredicto

**Recomendación: HÍBRIDO — NO hacer el big-bang de cortar pokemontcg.io.** Razones, en orden de peso:

- **El beneficio buscado (resiliencia a caídas) ya está casi resuelto:** pokemontcg.io es import-time y degrada con
  gracia; no bloquea tienda ni dinero. El costo de eliminarlo compra poco.
- **TCGCSV no da identidad de carta limpia:** producto ≠ carta; derivar la carta canónica **reintroduce el fantasma**
  que M-31 acaba de erradicar, con heurística que el PO ya mandó retirar.
- **Degrada rareza (rompe el empate 1:1 de M-31, money-touching) e imagen (200px + hotlink + licencia).**
- **La migración es grande y de alto riesgo:** re-llaveo sobre datos vivos que tocan dinero (PriceReference, bóveda,
  buylist), zona compartida (`prisma/` + contrato), no reversible con flag. Multi-semana, multi-rol (backend + QA E2E +
  seguridad). **No es un switch.**
- **Qué se conserva al cortar:** number, release/año, y (ya hoy) estructura+precio. **Qué se pierde:** identidad limpia,
  taxonomía de rareza oficial, imagen de catálogo hi-res, subtypes, y la puerta a enriquecer la ficha en fase 2.

**Acción concreta recomendada:** continuar el **paso 1** (TCGCSV única fuente de estructura+precio por set, ya en
curso); **no** abrir el paso 2 como big-bang; si se quiere reducir aún más la dependencia, hacer el **híbrido aditivo
(g.3)** como stream pequeño de «Catálogo y precios» (fallback de metadata/imagen), que **sí** pasaría por arquitecto
antes por tocar zona compartida. Reservar el re-llaveo total solo para el escenario en que pokemontcg.io deje de existir.

---

### 4.31 Sets multi-parte / Master Set combinado — presentación no destructiva, money-safe (v1.33-master-set-multipart, P-27, NORMATIVO)

> **Requisito:** PROJECT §L, criterios **65–72**, decisiones **D1–D5**. Un set multi-parte que pokemontcg.io publica
> como **≥2 set-ids** (principal + subset(s) con id propio) se presenta como **UN master set combinado** (Celebrations
> `cel25` + Classic Collection `cel25c` = **50**), con separador/etiqueta por subset. **Alcance: SOLO presentación.**

#### 4.31a Dónde vive el mapa — RECOMENDACIÓN: constante curada, NO columna de schema

**Decisión: el mapa padre→subset vive en una constante curada de código** en la zona compartida
`backend/src/config/master-set-groups.ts` (owner del cambio: quien tenga reservada la zona compartida `backend/src/config/`).
**No** se añade columna a `CardSet` ni tabla `SetGroup`.

```ts
// backend/src/config/master-set-groups.ts (ILUSTRATIVO — el shape/campos los fija backend)
// Claves = pokemontcg.io externalId (estables y humanos: "cel25"), NO el UUID local del CardSet
// (que varía por entorno). El servicio resuelve externalId → CardSet.id local por join.
export interface MasterSetGroup {
  primary: string;                 // externalId del set principal (nombre del master = su name)
  subsets: { externalId: string; label: string; order: number }[]; // N subsets, en orden de bloque
}
export const MASTER_SET_GROUPS: MasterSetGroup[] = [
  // CONFIRMADO (caso testigo, criterios 65–67):
  { primary: 'cel25', subsets: [{ externalId: 'cel25c', label: 'Classic Collection', order: 1 }] },
  // CANDIDATOS — SUJETOS A VALIDACIÓN por backend contra el catálogo REAL antes de activar (no shippear a ciegas):
  // Shiny Vault con id propio. Verificar el externalId exacto del principal y del subset en pokemontcg.io/local.
  // { primary: 'swsh45', subsets: [{ externalId: 'swsh45sv', label: 'Shiny Vault', order: 1 }] }, // Shining Fates — VALIDAR
  // { primary: 'sm115',  subsets: [{ externalId: 'sma',      label: 'Shiny Vault', order: 1 }] }, // Hidden Fates — VALIDAR
];
```

**Por qué constante y no schema (evaluación):**

| Opción | Cumple CA-69 (añadir par sin tocar código de presentación) | Migración de datos | Riesgo money-safe | Veredicto |
|---|---|---|---|---|
| **Constante curada `config/` (elegida)** | Sí — se añade una línea al array; ninguna vista cambia | **Ninguna** | Nulo por construcción: es solo lectura de presentación, jamás toca precio/inventario/bóveda | **RECOMENDADA** |
| Columna `CardSet.parentSetId` (aditiva/opcional) | Sí | Requiere migración en zona compartida `prisma/` + backfill del par | Bajo pero **re-llavea metadata de identidad** del set (contradice D2: no re-mapear) | Rechazada para MVP |
| Tabla `SetGroup` | Sí | Migración + modelo + seed | Añade superficie mutable adyacente a datos de catálogo | Rechazada para MVP (over-engineering) |

**Alternativa futura documentada (no MVP):** si se quisiera editar el mapa **sin deploy**, migrar a un `ConfigSetting`
(M10, editable/auditado) **conservando la misma regla dura**: sigue siendo presentación, nunca fuente de verdad. No se
hace ahora porque el mapa es curado y debe validarse contra el catálogo real (los `externalId` deben existir); una
constante validada al boot es lo más simple que cumple. **Auto-detección de pares queda FUERA de alcance** (PROJECT
§Fuera de alcance): el mapa es explícito.

**Validación al boot (backend):** al arrancar (o en un test), resolver cada `externalId` del mapa contra `CardSet`
local; si un `primary`/`subset` mapeado no está importado, **log de warning** (no crash) — es el caso borde CA-71.
Helpers en el config: `groupForPrimaryExternalId(id)`, `parentExternalIdOf(subsetExternalId)`, `partExternalIds(primary)`.

#### 4.31b Cómo el master-set combina padre+subset (fan-in en el read model compartido)

El binder actual está llaveado por **un** `setId` local (`master-set.service.ts:420-431`, `where: { setId }`) y las
cartas se consultan `Card WHERE setId` (`:430`). El **fan-in** se aplica **solo en `MasterSetService`** (el read model
único de §4.20, que ya sirve M1, admin-bóveda-cliente y «Mi bóveda» — todos heredan el combinado sin código extra):

1. **Resolver partes.** En `binder(setId, …)`: cargar el `CardSet` (`:425`), tomar su `externalId`, buscar grupo en
   el mapa. Si `setId` es el **principal** de un grupo → `partSetIds = [principalLocalId, …subsetLocalIds presentes]`
   (resueltos por join `CardSet.externalId IN (…)`, solo los importados). Si no está en ningún grupo → comportamiento
   actual (una sola parte), 100% retrocompatible.
2. **Cartas de todas las partes.** Cambiar `where: { setId }` por `where: { setId: { in: partSetIds } }` (`:431`). Cada
   `Card` sigue llaveada a su `setId` real (`cel25` o `cel25c`); **no se re-llavea nada**. La agregación de piezas
   (`groupBy [cardId, finish]`, `:451-455`) y `scopeWhere` **no cambian**: filtran por `cardId`, que pertenece a su set
   real → money-safe intacto (los guards H1/H2/H3 y `master-set.service.ts:82-84` no se tocan).
3. **Orden (D4):** bloque del **principal primero**, luego cada subset en el `order` del mapa; **dentro** de cada bloque
   el orden natural existente (`numberPrefix, numberSort`, §4.22). Se ordena por `(partOrder, CARD_ORDER_BY_IN_SET)`.
4. **Etiqueta/separador (D4, CA-66):** cada celda gana `partSetId` (su set real) y `partLabel`; el binder gana `parts[]`
   (una entrada por parte, con `name`/`label`/`isPrimary`/`order`/`catalogCardCount`). El front agrupa las celdas por
   `partSetId` y pinta el encabezado con `label` ("Classic Collection"). El master conserva el **nombre del principal**
   (`set` = SetRefDTO del principal). Ver contrato §DTOs.
5. **Conteos = suma de partes (D5, CA-67):** en el binder, `catalogCardCount`/`printedTotal` = **Σ de las partes**; en
   el índice, `catalogCardCount`/`catalogVariantCount`/`distinctCardsOwned`/`distinctVariantsOwned`/`totalPieces` se
   suman sobre todas las partes y `completionPct`/`variantCompletionPct` se recomputan sobre esos totales → Celebrations
   = 50 esperadas.
6. **Pedir por el id del principal; normalizar el subset.** El endpoint recibe `:setId` = id local. Si `:setId` es un
   **subset** de un grupo → se normaliza a su principal y se devuelve el master combinado (`set` = principal +
   `canonicalSetId` = id local del principal, para que el front actualice la URL). Así un enlace a `cel25c` **no** muestra
   un binder roto de 25. Esto solo afecta a la **presentación**; toda operación por set-id real en otros endpoints es intacta.

#### 4.31c Índice de master sets — plegado del subset (`GET /admin/inventory/master-sets` y vault)

En el índice, los set-ids **subset** de un grupo **no** aparecen como filas propias: se **pliegan** en la fila del
principal, cuyos agregados se computan sobre `partSetIds`. La consulta fija sin N+1 (§4.17a) se conserva: las
agregaciones (`Card.groupBy`, la agregación raw de `InventoryItem⋈Card`, la de `Σ|availableFinishes|`) ya operan por
`setId ∈ ANY($ids)`; basta **agrupar sus resultados por el `setId` canónico** (principal) usando el mapa antes de armar
las filas, y **excluir** los subset como filas top-level. `MasterSetSummaryDTO` gana `partSetIds?` (los subset plegados;
presente solo en masters combinados) para que el front muestre el conteo de 50 y una marca de "combinado".

#### 4.31d Alcance transversal (qué vistas consumen el combinado)

- **M1 — Inventario / Master Set** (`GET /admin/inventory/master-sets[/:setId]`, `vault_operator+`): binder e índice
  con fan-in. Drill-down a piezas (P-17) **no cambia**: cada pieza sigue ligada a su `Card`/set real.
- **Bóveda del cliente** (`GET /vault/master-sets[/:setId]`, `customer`) y **admin viendo bóveda de un cliente**
  (`GET /admin/vaults/:userId/master-sets[/:setId]`, `vault_operator+`): **heredan** el fan-in por usar el mismo
  `MasterSetService` (scope `user_vault`). `buyable` sigue resolviéndose por `(cardId, finish)` — no depende del grupo.
  **La valuación del portafolio no cambia** (cada carta se valúa con la `PriceReference` de su acabado/su set-id real).
- **Storefront (Compra)**:
  - `GET /catalog/sets` (dropdown de set) **pliega** el subset en el principal → Celebrations aparece **una** vez; la
    entrada gana `partSetIds?`.
  - `GET /catalog/cards?setId=<principal>` **expande** a `setId IN partSetIds` cuando el id es el principal de un grupo
    (aditivo; solo afecta a sets mapeados) para que el filtro por el set combinado liste inventario de todas las partes.
    Se respeta la **Regla de Compra**: solo se lista inventario **con precio**; agrupar no publica cartas sin precio.
  - Gráfica pública de valor de set (`GET /catalog/sets/:id/value-history`, `/catalog/featured-set/value-history`):
    para un master combinado **suma** las partes (agrega los `SetValueSnapshot` de `partSetIds`). **Aditivo/derivado**;
    si una parte aún no tiene snapshots, se suma lo presente sin romper.
- **Sync de catálogo (M2)** *(§4.8)*: **no cambia** — sigue importando `cel25` y `cel25c` como entidades reales. La
  agrupación es capa de presentación sobre el mapa; añadir un par **no** re-llavea ni re-importa.
- **Rutas de escritura y dinero — NO consultan el mapa:** alta/lote (`/items/batch`), publicación
  (`/bulk-publish`), ajustes (`/adjustments`), órdenes/checkout (M3), pricing/sync, buylist. Operan por set-id/`cardId`
  reales. El mapa es **solo lectura de presentación** (CA-72).

#### 4.31e Money-safe (regla dura, verificable — CA-68/CA-72)

El mapa **nunca es fuente de verdad**. Toca exclusivamente los read models de presentación (índice/binder/facet/`cards`).
Cada celda/variante/pieza sigue llaveada a su `cardId`→`setId` real; `scopeWhere` y las agregaciones filtran por `cardId`.
**Verificación (CA-68):** el precio de referencia, el `folio`, la ubicación y la titularidad de una carta de `cel25c` son
**idénticos** antes y después de activar el grupo (comparación directa contra `GET /admin/inventory/items`). Activar,
desactivar o extender el mapa **no ejecuta ninguna escritura** de datos.

#### 4.31f Casos borde (CA-70/71)

- **N subsets (CA-70):** `subsets[]` admite varios; el fan-in y la suma cubren todas las partes mapeadas. Orden de
  bloques por `order`.
- **Subset sin su principal (CA-71):** si el `primary` del grupo **no** está importado, el subset **no** se pliega —
  se muestra como su propio set (comportamiento actual) hasta que exista el principal. Si el principal está importado
  pero **falta** algún subset, el master muestra solo las partes presentes y suma sobre ellas (no revienta; la
  validación al boot de §4.31a ya dejó el warning). En ningún caso hay 500.
- **Colisión de numeración entre partes:** no hay colisión de identidad (cada carta conserva su `cardId`/set real). El
  separador por `partSetId` desambigua dos "#20" (uno por parte); el orden por bloque los mantiene separados.

#### Reparto de trabajo (v1.33, P-27)
- **Backend** (stream «Inventario y vault» + tocar zona compartida `backend/src/config/`): (1) crear
  `config/master-set-groups.ts` (mapa + helpers + validación al boot); (2) fan-in en `MasterSetService.binder()`/`index()`
  (partes, orden por bloque, suma de conteos, normalización de subset→principal); (3) storefront: plegado en
  `GET /catalog/sets` + expansión de `setId` en `GET /catalog/cards` (coordinar con stream «Catálogo y precios» si toca
  su módulo — es zona compartida, pasa por arquitecto ya hecho aquí); (4) (opcional/derivado) suma de partes en la
  gráfica de valor de set. Tests: Celebrations = 50 esperadas (índice y binder); celdas de `cel25c` con `partSetId`/
  `partLabel`; pedir `/master-sets/cel25c` normaliza a `cel25` con `canonicalSetId`; CA-68 (precio/folio/titularidad de
  una `cel25c` idénticos con y sin grupo); CA-71 (subset sin principal no revienta); N subsets suma todas.
- **Frontend**: (1) binder de master set agrupa celdas por `partSetId` y pinta separador con `partLabel`; nombre del
  master = `set.name`; conteo "cubiertas/esperadas · %" sobre los agregados de variante (ya = 50); (2) si el DTO trae
  `canonicalSetId`, actualizar la URL; (3) dropdown de set de Compra muestra la entrada combinada una vez. Reusa los
  componentes compartidos `components/master-set/` (§4.20f) — solo añade el render de separador por parte.
- **QA/techlead**: doble veredicto por stream (no toca dinero saliente; el mapa es solo lectura). E2E: abrir Celebrations
  en M1 y en «Mi bóveda» y ver 50 cartas en un binder con el bloque "Classic Collection" etiquetado; confirmar (money-safe)
  que una carta de `cel25c` conserva precio/folio/titularidad.

---

### 4.32 Alta dedicada de producto SELLADO con imagen de API (v1.36-sealed-alta, P-35, NORMATIVO)

> **Problema:** en M1 → pestaña **Sellado**, el modal de alta reutiliza el **buscador de CARTAS** (singles). Al elegir
> set + Tipo=Sellado, los resultados siguen siendo **singles**, no **productos sellados** (ETB, booster box, blíster),
> y el operador termina anclando una caja a un single arbitrario. **Causa raíz:** no existe un listado de productos
> sellados de un set; el sellado no es entidad de catálogo (§4.19c: es `InventoryItem(sealed)` **anclado a una `Card`**
> + `tcgplayerProductId`). **Fuente de sellado ya disponible:** el proxy TCGCSV curado en M-23 (`groups/:groupId/products`,
> con `imageUrl`); pokemontcg.io **no** tiene sellado. Este cambio añade un flujo dedicado que **reusa** ese proxy y el
> alta por lote existente; **sin** entidad nueva. **Alcance acotado: alta + listado; NO** re-llaveo de identidad del
> sellado (ver §4.32d, diferido).

#### 4.32a Endpoint de listado — `GET /admin/inventory/sealed-catalog?setId=` (`vault_operator+`)

Lista los productos **sellados** de un set desde TCGCSV, cada uno con `tcgplayerProductId`, `name`, `sealedSubtype`
inferido, **`imageUrl` de la API** y `marketRef` (informativo, money-safe). Contrato en API_CONTRACT §M1 +
`SealedCatalogProductDTO`/`SealedCatalogResponse`. Reglas:

- **Reusa el `TcgcsvClient` server-side** (proxy read-only, host fijo `tcgcsv.com`, categoría Pokémon=3, anti-SSRF)
  que ya sirve `/admin/pricing/sealed/tcgcsv/groups/:groupId/products` (§4.19b). El navegador nunca habla con
  tcgcsv.com. **Diferencia de autorización:** ese explorador es `super_admin` (curación M2); ESTE es `vault_operator+`
  (alta M1). Se acepta porque el listado es solo lectura de catálogo (no mueve dinero); ver §4.32c.
- **`marketRef` (money-safe):** por producto, `marketPrice` del grupo TCGCSV → `usdToMxnCents(market, rate, bufferPct)`
  (FX+colchón, `FxService.getCurrent()` una vez por request). **Sin precio en la fuente ⇒ `null` (pendiente/«—»),
  NUNCA `0`.** Es una SUGERENCIA junto al alta; NO es una `PriceReference` comprometida (la referencia real la escribe
  el job `sealed-price-ingest`, §4.19d, tras el alta mapeada). **Sin N+1:** una llamada de productos + una de precios
  por grupo, join en memoria.
- El listado NO depende del dial `sealed_price_source` (curar/explorar funciona con el dial `off`, §4.19c); `marketRef`
  es informativo, no comprometido.

#### 4.32b Resolución set → grupo TCGCSV, y ancla representativa

- **Grupo (precedencia):** `groupId` explícito de la query (bootstrap manual) > **`CardSet.tcgcsvGroupId`** (delta
  M-37, curado) > `SELECT DISTINCT tcgplayerGroupId` de los `InventoryItem` `sealed` **ya mapeados** del set (dato
  M-23). Exactamente uno ⇒ se usa; cero ⇒ `groupResolved:false` + `data:[]`; varios ⇒ `CardSet.tcgcsvGroupId` si
  existe, si no `groupResolved:false` (ambigüedad = no se adivina, money-safe/dato-safe). El fallback por hermanos
  evita el huevo-y-gallina cuando `tcgcsvGroupId` aún es `null` pero el set ya tuvo un sellado curado.
- **Ancla (`anchorCardId`):** Card **representativa** del set = la de menor `(numberPrefix, numberSort)` (primera del
  set en orden natural; determinista). El sellado se ancla a ella **solo** para satisfacer `InventoryItem.cardId`
  (NOT NULL) y como fallback de nombre/imagen. El **display real** del sellado sale de `sealedImageUrl`/
  `sealedProductName` (deltas M-37). La identidad de grupo del sellado sigue siendo §4.23:
  `(cardId ancla, sealedSubtype, tcgplayerProductId, sealedCondition)` — dos productos del mismo set anclados a la
  misma Card **no** colisionan (los distingue el `tcgplayerProductId`). El operador **nunca** elige un single como
  ancla (raíz del defecto P-35 eliminada).

#### 4.32c Alta — reusa `items/batch`, nace MAPEADA (dinero server-side)

El alta reusa `POST /admin/inventory/items/batch` (§M1); el `BatchInventoryItemInput` gana 4 campos aditivos (solo
`sealed`): `tcgplayerProductId?`/`tcgplayerGroupId?` (mapeo, se fijan juntos), `sealedImageUrl?`/`sealedProductName?`
(display). Reglas normativas:

- **Nace mapeada:** al crear la pieza se pueblan las columnas M-23 (ya existentes). Efecto: `sealedMarketRef` resuelve
  de inmediato por `sealed:tcg:<productId>` (§4.23) y la **aportación de sellado** valúa por ese mercado (H-1), **no**
  por el gradeKey legacy `'sealed'` (que jamás tiene filas). Sin mercado/override ⇒ `422 PRICE_PENDING` por línea
  (lote tolerante), como hoy. Esto **cierra la fricción P-35**: no hay que ir a M2 a curar el mapeo antes de valuar.
- **Money-safe (SEC-A1):** costo de aportación = `mercado × pct` server-side; venta se deriva en `bulk-publish`
  (override > mercado×spread > PRICE_PENDING). El cliente **no** manda montos; solo `productId`/`groupId` (de la lista
  que el server sirvió) + `qty` + tipo de adquisición.
- **`sealedImageUrl`/`sealedProductName` VALIDADOS server-side** contra el host allowlist de imágenes TCGplayer/TCGCSV
  (p. ej. `*.tcgplayer.com` / `tcgcsv.com`) antes de persistir (anti stored-XSS / URL arbitraria inyectada). Inválidos/
  omitidos ⇒ `null` (fallback a la `Card` ancla). El backend PUEDE, alternativamente, re-derivarlos del `productId` vía
  `TcgcsvClient` al alta (evita confiar en el input) — decisión de implementación; el contrato exige solo que el valor
  persistido sea de host confiable.
- **Autorización — nota para pentester/seguridad:** un `vault_operator` fija el mapeo TCGCSV al alta (hoy la curación
  es `super_admin`). Ampliación deliberada y acotada: `productId` proviene del listado servido, valuación server-side,
  alta **auditada** (`AuditLog action=inventory.batch_create` con el mapeo + `batchKey`). No es dinero saliente
  (`MoneyOutGuard` no aplica). Revisar en la fase de seguridad por si conviene exigir `super_admin` para poblar el
  mapeo o dejar la curación fina en M2.
- **Display en las superficies de sellado:** `SealedGroupDTO`/`VaultSealedGroupDTO`/`SealedInventoryGroupDTO` resuelven
  `imageUrl`/`productName` desde `sealedImageUrl`/`sealedProductName` cuando existen (⇒ muestran la **caja**), con
  fallback a la `Card` ancla cuando son `null` (piezas legacy). Ninguna forma de DTO cambia.

#### 4.32d Diferido — entidad `SealedProduct` de catálogo (SB-D5, NO en este cambio)

La cura de raíz sería una entidad `SealedProduct` (llaveada por `tcgplayerProductId`: `name`/`imageUrl`/`sealedSubtype`/
`setId` propios) con `InventoryItem.sealedProductId` en vez de anclar a una `Card`. Elimina el ancla-a-single y da un
catálogo de sellado navegable. **Fuera de alcance de P-35** (es una tercera taxonomía con sync/curación propios que
toca M-23/M-25/M-26/M-28 y el pricing). Se registra como **SB-D5** en `docs/TECH_DEBT.md` (backend, no bloqueante).
Los deltas M-37 son el **puente mínimo** money-safe hasta entonces.

> **➡ CURADO en P-38 / §4.34 (v1.39-sealed-product-module).** La entidad `SealedProduct` diferida aquí se materializa
> en **§4.34**: identidad propia por set, sync desde TCGCSV que **puebla los groupIds del set** (rompe el círculo
> vicioso del hueco 1), enum `SealedSubtype` con **`upc`**, y `InventoryItem.sealedProductId` como referencia de
> identidad (en vez del ancla-a-single). Las columnas M-37 (`sealedImageUrl`/`sealedProductName`/mapeo M-23) se
> conservan como **snapshot** por-pieza (display/valuación estables aunque el catálogo cambie); el guardarraíl H9
> (`productType != 'sealed'` en la vista de singles) sigue vigente hasta el re-llaveo completo. SB-D5 se **cierra** al
> mergear P-38 (ver TECH_DEBT).

#### Reparto de trabajo (v1.36, P-35)
- **Backend** (stream «Inventario y vault»): (1) migración M-37 (3 columnas nullable, zona compartida `prisma/`
  serializada); (2) `GET /admin/inventory/sealed-catalog` (resolución de grupo §4.32b + reuso del `TcgcsvClient` +
  enriquecido `marketRef` con FX, sin N+1); (3) extender el alta (`items/batch` y singular) para poblar mapeo +
  `sealedImageUrl`/`sealedProductName` validados por host; (4) valuación de aportación de sellado por `sealedMarketRef`
  (fix H-1 si no estaba ya); (5) que los DTOs de display del sellado prefieran los campos nuevos. Tests: listado
  devuelve sellado (no singles) con `imageUrl` y `marketRef` (pending⇒null, nunca 0); alta nace mapeada y valúa;
  `groupResolved:false` cuando no hay grupo; host allowlist rechaza URL fuera de TCGplayer/TCGCSV; idempotencia por
  `batchKey`.
- **Frontend** (`(admin)` inventario / captura): reemplazar en el modal de alta de la pestaña Sellado el buscador de
  CARTAS por el **listado de productos sellados** (`sealed-catalog`), tejas con **imagen de API** + subtipo + `marketRef`
  («—» cuando null); el operador elige producto + cantidad + compra/aportación (reglas P-19) y envía `items/batch` con
  el `anchorCardId`/`productId`/`groupId`/`imageUrl`/`name` que el listado ya trae + `batchKey`. Si `groupResolved:false`,
  ofrecer fijar el grupo (link a M2 o input de `groupId`).
- **ux-ui**: especificar la teja del producto sellado en el modal de alta (imagen de API, subtipo, `marketRef`/«—»),
  el estado «grupo no resuelto» y el selector cantidad + compra/aportación. Reusa el sistema de tejas §16.8.
- **QA/techlead**: doble veredicto por stream. No es dinero saliente, pero **toca valuación** (aportación) → la fase de
  seguridad revisa la ampliación de autorización del mapeo (§4.32c) y el host allowlist de imágenes.

---

### 4.34 Módulo de PRODUCTO SELLADO robusto — entidad `SealedProduct` (v1.39, P-38, cura de raíz de SB-D5, NORMATIVO)

> **Problema (confirmado por diagnóstico).** Al dar de alta un ETB salió como «Tropius #1 · sealed» y «SIN MAPEO».
> El puente P-35 (§4.32) **ancla cada sellado a un single representativo** del set (para satisfacer `InventoryItem.cardId`
> NOT NULL) y **no le da identidad propia**. Tres huecos concretos: (1) `CardSet.tcgcsvGroupId` **no lo escribe nadie**
> (columna M-37 sin seed/ingest) → círculo vicioso: para resolver el grupo del set hace falta un sellado ya mapeado,
> pero no puedes meter el primero → cae a captura manual anclada a un single → «SIN MAPEO»; (2) **UPC (Ultra Premium
> Collection) no existe** en ninguna capa (enum, contrato, `inferSealedSubtype`); (3) no hay concepto de «productos
> principales» — el listado vuelca el grupo entero o nada.
>
> **Cura de raíz.** Se materializa la entidad de catálogo **`SealedProduct`** (diferida en §4.32d/SB-D5): cada
> presentación sellada de un set (ETB, UPC, Booster Bundle, booster box, tin, blíster…) es una **fila real** con
> identidad propia, descargada de TCGCSV por un **sync**, no anclada a un single. El alta pasa a ser **seleccionar** un
> `SealedProduct`; el `InventoryItem` lo referencia por FK (`sealedProductId`). El sync **puebla los groupIds del set**
> como parte de su trabajo (rompe el hueco 1: el grupo se resuelve por name-match/curación, sin requerir un item previo).

#### 4.34a Entidad `SealedProduct` y su relación con el inventario

`SealedProduct` = **catálogo de presentaciones selladas por set**, fuente de verdad de la identidad del sellado
(reemplaza la inferencia-por-hermanos y el ancla-a-single). Campos (schema en §11 / M-39):

- `id` (uuid), `setId` (FK → `CardSet`), `tcgplayerProductId Int @unique` (**clave de identidad**, == productId de
  TCGplayer/TCGCSV; también la clave de precio `sealed:tcg:<productId>` §4.19d), `tcgplayerGroupId Int` (grupo del que
  provino; uno de los **N** grupos del set, §4.34b), `name`, `cleanName?`, `subtype: SealedSubtype` (incl. **`upc`**,
  inferido al sync y **curable**), `subtypeInferred: Boolean` (true = heurística, false = curado por humano),
  `isPrincipal: Boolean` (presentación «principal», §4.34c), `origin: SealedGroupKind` (`set_main` | `promo_collection`,
  §4.34b), `imageUrl?` (imagen de la API), `marketUsdCents Int?` + `marketUpdatedAt DateTime?` (**último** precio de
  mercado conocido en USD centavos, cacheado por el sync/ingest; **money-safe: `null` cuando TCGCSV no trae precio,
  JAMÁS 0**), `active: Boolean @default(true)` (soft-delete si desaparece de TCGCSV; nunca se borra en duro para no
  romper FKs de inventario/órdenes), `createdAt`/`updatedAt`.

- **Relación con inventario:** `InventoryItem.sealedProductId String?` (FK → `SealedProduct`, nullable; **regla de
  aplicación**: poblada solo para `productType='sealed'`). Es la **identidad** del sellado. Las columnas M-23/M-37
  (`tcgplayerProductId`/`tcgplayerGroupId`/`sealedImageUrl`/`sealedProductName`/`sealedSubtype`/`sealedCondition`) se
  **conservan como SNAPSHOT por-pieza**, congelado al alta: el display y la valuación de una pieza ya dada de alta **no
  cambian** aunque el `SealedProduct` se re-sincronice, se renombre o se desactive (estabilidad money-safe). El display
  de las superficies de sellado resuelve en cascada: **`SealedProduct` (vivo, si `sealedProductId`)** → snapshot
  `sealedImageUrl`/`sealedProductName` → `Card` ancla (legacy). La `cardId` ancla se **mantiene** (NOT NULL sigue): deja
  de ser identidad y pasa a ser solo pertenencia al set + fallback de imagen; el guardarraíl H9 sigue excluyendo el
  sellado de la vista de singles.
  - **v1.42 (BLOQ-2a/2b) — la cascada aplica en TODAS las superficies de sellado, cerrando «Tropius»:** además de
    `/vault/sealed`, grid público (`SealedGroupDTO`) y `sealed-sets` (`SealedInventoryGroupDTO`), la cascada §4.34a se
    aplica ahora en **`HoldingDTO`** (`GET /vault/holdings` gana `sealedProductId`/`sealedProductName`/`sealedImageUrl`/
    `sealedSubtype`/`sealedCondition`, resueltos server-side, presentes solo en sellado) y en **`PendingPriceEntry`** (cola
    M2 gana `sealedProductId`+display; la clave de la cola discrimina por `sealedProductId` para que ETB y blíster no
    colapsen). Ambos aditivos/retrocompatibles y money-safe (display/identidad, no dinero). Contrato: API_CONTRACT
    Changelog v1.42. Migración de la cola: **M-40** (§11).

- **Valuación money-safe (SIN cambio de doctrina):** la referencia de mercado autoritativa del sellado sigue siendo la
  cadena H-1 `PriceReference` clave `sealed:tcg:<productId>` (§4.19d); `SealedProduct.marketUsdCents` es una **caché de
  display/sugerencia**, no autoridad de dinero. La aportación valúa `mercado × pct` server-side; sin mercado ⇒
  `422 PRICE_PENDING` (o override manual auditado, §4.34d). El job `sealed-price-ingest` (§4.19d) gana una fuente extra
  de grupos/productos a barrer: **los `SealedProduct` activos** (además de los items mapeados), de modo que un producto
  del catálogo tenga precio aunque aún no haya inventario — sin fabricar dato (null si TCGCSV no trae precio).

#### 4.34b Un set → **N grupos** TCGCSV (crítico: promos / colecciones, incl. Mega Evolution)

Las presentaciones selladas de un set **no viven todas en un solo grupo** TCGCSV: el grupo **principal** del set
(booster box, ETB, bundle…) + **grupos aparte** de «collections»/promos (donde suelen caer blísters, colecciones y tins
promo — p. ej. los de **Mega Evolution**, o «Black Star Promos»). Un modelo `1 set → 1 tcgcsvGroupId` los dejaría fuera
(el defecto de hoy). Por eso:

- **Nueva tabla de enlace `SealedSetGroup`** `{ setId, tcgplayerGroupId, kind: SealedGroupKind, label? }` con
  `@@unique([setId, tcgplayerGroupId])`. `kind = set_main` (grupo principal del set) | `promo_collection` (grupo de
  promo/colección asociado). Un set puede tener **1 `set_main` + N `promo_collection`**.
- **`CardSet.tcgcsvGroupId` se conserva** como puntero denormalizado al grupo `set_main` (retrocompat + resolución
  rápida); su **fuente de verdad** pasa a ser `SealedSetGroup(kind=set_main)`. El sync los mantiene consistentes (escribe
  ambos). Resuelve el **hueco 1**: el sync **puebla** `tcgcsvGroupId` + las filas `SealedSetGroup` a partir del
  **name-match** de grupos TCGCSV contra el set (mismo patrón que `PptSetMapper`), **sin** requerir un item sellado
  previo.
- **PROMO-SINGLE ≠ PROMO-SELLADO (frontera del módulo).** Las cartas **promo sueltas** (un single promo SVP-XXX) **NO**
  son `SealedProduct`: van al catálogo de **singles** (`Card`, rareza «Promo» ya mapeada en P-34) y en TCGCSV viven en
  un grupo aparte tipo «Black Star Promos». El sync de `SealedProduct` **descarta singles** (heurística `extendedData`
  `Number`/`Rarity`, §4.19b `looksLikeSingleCard`) **también** en los grupos `promo_collection`: de un grupo promo el
  módulo absorbe **solo** lo sellado (blíster/colección/tin promo), nunca el single promo. La `origin` del producto
  registra de qué tipo de grupo provino, para que la UI pueda agrupar/separar «del set» vs «promo/colección».

#### 4.34c Subtipos robustos — enum con `upc`, catálogo y «principales»

- **Enum `SealedSubtype` (Prisma + contrato) gana `upc` y `collection`:** `{ box, etb, upc, bundle, tin, blister,
  collection }`. `upc` = Ultra Premium Collection (pedido explícito). `collection` = colecciones/cajas especiales
  (Premium/Special Collection, V/ex Box, colecciones promo) que hoy caían a `null` o se colaban como `box`; es además el
  **bucket genérico de fallback** para el sellado sin match (paso 8 abajo). `ALTER TYPE ADD VALUE` es aditivo y seguro
  (§11/M-39); ningún valor existente cambia.
- **`inferSealedSubtype(name)` — orden normativo (el orden IMPORTA):**
  1. `ultra premium collection` | `\bupc\b` → **`upc`** (antes que ETB y collection, porque contiene «collection»).
  2. `elite trainer box` | `\betb\b` → **`etb`**.
  3. `booster bundle` | `\bbundle\b` → **`bundle`** (antes que box).
  4. `booster box` | `booster case` → **`box`**.
  5. `\btin\b` → **`tin`**.
  6. `blister` | `sleeved booster` | `checklane` | `\b3[- ]?pack\b` → **`blister`**.
  7. `premium collection` | `special collection` | `\bcollection\b` | `\bbox\b` (genérico) → **`collection`**.
  8. **sin match → `collection` (inferido)** — fallback **money-safe y NOT-NULL-safe**: como `SealedProduct.subtype` es
     NOT NULL (schema M-39), un sellado sin coincidencia se cataloga en el bucket genérico `collection` con
     `subtypeInferred=true` (heurística, no curado). Queda como presentación **secundaria** (`isPrincipal=false`,
     `sortOrder=6`, al **final** del orden §4.34c), nunca se «asciende» un desconocido a principal. El operador puede
     recatalogarlo al curar (pasa a `subtypeInferred=false`). Conservadora: sin match ⇒ el subtipo menos comprometido,
     no se adivina un principal. *(Resuelve H-P38-3: la prosa decía «sin match → null», imposible bajo el schema NOT
     NULL; se ratifica `collection` inferido como lo canónico — el código ya lo hacía. Sin cambio de schema ni de shape.)*
- **Principales (`isPrincipal`)** = presentaciones «cabecera» que el alta muestra primero: **`box, etb, upc, bundle`**.
  Secundarias: `tin, blister, collection`. Default derivado del subtype por una constante `SEALED_SUBTYPE_META`
  (`{ isPrincipal, sortOrder, label }`), **curable** por pieza (`SealedProduct.isPrincipal` es columna, el sync setea el
  default y el humano puede overridear). **Orden de exposición del contrato:** por `(isPrincipal desc, sortOrder asc,
  name asc)` — sortOrder canónico `upc=0, etb=1, box=2, bundle=3, tin=4, blister=5, collection=6`.

#### 4.34d Contrato de alta — seleccionar `SealedProduct` + precio en vivo + fallback manual

- **Listar presentaciones del set** — `GET /admin/inventory/sealed-products?setId=&q?&origin?&principalOnly?`
  (`vault_operator+`): lee los `SealedProduct` **persistidos** (active=true) del set, ordenados §4.34c, cada uno con
  `marketRef: PriceInfo | null` (**live**: fetch TCGCSV del grupo al vuelo → fallback a `marketUsdCents` cacheado →
  `null` money-safe; USD→MXN con FX+colchón). **Presentación SEPARADA por `origin` (decisión del humano, v1.39.1):** el
  front pinta dos secciones — «Del set» (`set_main`) vs «Promos/colecciones» (`promo_collection`) — usando el campo
  `origin` que ya trae cada producto (sin cambio de shape; el orden §4.34c aplica dentro de cada sección). Sustituye a
  `GET /admin/inventory/sealed-catalog` (§4.32a), que se marca
  **DEPRECADO** (transición: puede mantenerse como alias que lee la misma tabla). Grupo/catálogo aún vacío ⇒
  `data:[]` + `needsSync:true` (el front ofrece «Sincronizar»).
- **Alta = seleccionar** — reusa `POST /admin/inventory/items/batch`. `BatchInventoryItemInput` gana **`sealedProductId?`**
  (solo `sealed`). Presente ⇒ el backend **deriva server-side** `cardId` (ancla del set), `tcgplayerProductId`/`GroupId`,
  `sealedImageUrl`/`sealedProductName`, `sealedSubtype` **desde el `SealedProduct`** (el cliente NO manda identidad ni
  montos) y **congela el snapshot**. La pieza **nace con identidad correcta** («ETB Pitch Black», NO la carta Tropius).
  Los campos sueltos M-37 (`tcgplayerProductId`/`sealedImageUrl`/…) quedan **aceptados pero deprecados** (transición);
  si viene `sealedProductId` mandan los derivados. `qty`+`batchKey` = misma idempotencia (M-21).
- **Precio EN VIVO al alta:** al crear la pieza el backend resuelve mercado en ESE momento — `sealed-price` on-demand del
  `productId` (una llamada TCGCSV) → fallback a la última `PriceReference sealed:tcg:<productId>` / `marketUsdCents` →
  `null`. **Gateado por el dial `sealedPriceSource` (§4.23, H-1):** con el dial `off` (seed, fail-closed) el mercado
  de **fuente automática** (live/caché TCGCSV) queda `null`. **v1.43 (IMP-C):** el gate NO anula un **override manual**
  ya persistido (`isManualOverride=true`); si una pieza previa fijó precio con «FIJAR PRECIO», ese `sealedMarketRef`
  manual **sobrevive al dial `off`**, así que `effectiveMarketCents` sale **no-null** y el alta de otra pieza del mismo
  producto valúa con él (y rechaza un `manualMarketMxnCents` redundante) — coherente con la invariante de abajo. La
  aportación valúa por ese mercado gateado (`mercado × pct`, server-side, SEC-A1).
- **Preview coherente con el alta (v1.41, IMP-1) — un solo mercado autoritativo:** el gate E2E encontró un dead-end
  porque el preview del alta (`SealedAddFlow`) y la valuación del alta usaban **dos** nociones distintas de mercado del
  sellado. `SealedProductDTO.marketRef` es una referencia **INFORMATIVA ungated** (live→caché) y NO debe decidir la UI;
  el frontend la usaba para ocultar el campo manual mientras el backend valuaba con la referencia **gateada** por el
  dial → `PRICE_PENDING` sin salida. **Norma:** `GET /admin/inventory/sealed-products` expone además
  **`effectiveMarketCents`** = el mercado del sellado resuelto con la **MISMA** función H-1 gateada por `sealedPriceSource`
  que decide la valuación del alta. Invariante money-safe: `effectiveMarketCents == null` ⟺ el alta queda en
  `PRICE_PENDING` y ACEPTA `manualMarketMxnCents`; `!= null` ⟺ el alta valúa con él y RECHAZA el manual
  (`MANUAL_MARKET_NOT_ALLOWED`). El backend calcula `effectiveMarketCents` reutilizando el resolver del alta (no una
  segunda ruta) para que ambos NO puedan divergir; el frontend keyea la visibilidad del campo manual en él, jamás en
  `marketRef`. Ver API_CONTRACT §M1 (`GET /admin/inventory/sealed-products`) y changelog v1.41-sealed-effective-market.
- **Fallback MANUAL money-safe:** si live+caché son `null`, la línea NO se inventa 0: dos salidas honestas — (a) sin
  override ⇒ `422 PRICE_PENDING` por línea (queda pendiente, curable); (b) **override manual explícito** `manualMarketMxnCents?`
  en la línea (solo cuando el mercado resuelto es null) ⇒ se usa como referencia, **auditado**
  (`AuditLog inventory.sealed_manual_market`) y persistido como `PriceReference isManualOverride=true`. **Nunca** default
  0; `manualMarketMxnCents ≤ 0` ⇒ `422 VALIDATION_ERROR`. **Autorización (decisión del humano, v1.39.1):** lo permite
  **`vault_operator+`** (el operador de bóveda opera el alta; NO se restringe a super_admin). `422 MANUAL_MARKET_NOT_ALLOWED`
  **ya no** se dispara por rol — solo si se intenta sobrescribir un mercado **ya resuelto** (el override manual llena el
  hueco de precio, jamás pisa un mercado vivo). **⚠ Este input de dinero por `vault_operator` queda MARCADO para revisión
  de la fase de seguridad (pentester + seguridad) por release.**
- **Sync (poblar catálogo + groupIds)** — `POST /admin/inventory/sealed-products/sync` (`super_admin`)
  `{ setId?, groupIds?, all? }`: para el set (o todos), resuelve sus grupos (`SealedSetGroup` ∪ `groupIds` pasados ∪
  name-match del `set_main` si falta), y por grupo: `listSealedProducts` (descarta singles) → `inferSealedSubtype` →
  **upsert `SealedProduct`** por `tcgplayerProductId` (crea/actualiza name/image/subtype-si-no-curado/marketUsdCents) +
  asegura la fila `SealedSetGroup` + **puebla `CardSet.tcgcsvGroupId`** si era null (del `set_main`). Productos que ya no
  aparecen ⇒ `active=false` (soft). **Money-safe:** nunca fabrica precio (marketUsdCents null si TCGCSV no trae); nunca
  toca inventario ni valuación existente. Cadencia: **on-demand** (botón «Sincronizar» al abrir el set / al no haber
  catálogo) **+ batch** opcional `sealed-catalog-sync` (todos los sets, 1×/día, reusa la ventana TCGCSV ~20:00 UTC,
  single-flight, secuencial-awaited como `sealed-price-ingest`).
- **Descubrir/curar grupos** — `GET /admin/inventory/sealed-products/sync/candidates?setId=` (`super_admin`): lista
  grupos TCGCSV candidatos por name-match (para bootstrap del `set_main` y para localizar grupos `promo_collection`);
  y `POST /admin/inventory/sealed-sets/:setId/groups` `{ tcgplayerGroupId, kind }` enlaza un grupo extra (promo/colección)
  al set. Solo lectura de catálogo / curación; jamás fija precio.

#### 4.34e Migración M-39 y backfill (numerado, money-safe) — para backend

Ver tabla §11 (M-39). Pasos:
1. `ALTER TYPE SealedSubtype ADD VALUE 'upc'` y `'collection'` (aditivo, sin re-mapear valores).
2. `CREATE TYPE SealedGroupKind AS ENUM ('set_main','promo_collection')`.
3. `CREATE TABLE SealedSetGroup` (+ unique `(setId, tcgplayerGroupId)`, index `setId`).
4. `CREATE TABLE SealedProduct` (+ unique `tcgplayerProductId`, index `setId`, index `tcgplayerGroupId`).
5. `ALTER TABLE InventoryItem ADD COLUMN sealedProductId` (FK nullable, `onDelete: SetNull`; index).
6. **Backfill grupos:** por cada `CardSet` con `tcgcsvGroupId != null` → `INSERT SealedSetGroup(kind=set_main)`.
7. **Backfill catálogo desde inventario mapeado (cura del ETB→Tropius):** por cada `(tcgplayerProductId,
   tcgplayerGroupId)` **distinto** de `InventoryItem` sealed **mapeados**, `upsert SealedProduct` con `name` =
   `sealedProductName` (o re-fetch por productId), `imageUrl` = `sealedImageUrl`, `subtype` = `sealedSubtype` (o inferido),
   `origin=set_main`, `marketUsdCents` = último de `sealed:tcg:<productId>` **o null** (jamás fabricado). Luego
   `UPDATE InventoryItem SET sealedProductId = <ese SealedProduct>` para esas piezas. El ETB actual queda ligado a su
   `SealedProduct` real («ETB …»), no a Tropius.
8. **Sellados SIN mapeo** (los «SIN MAPEO», `tcgplayerProductId = null`): **no** se pueden backfillar sin adivinar →
   `sealedProductId` queda `null` y se listan en un **reporte de reconciliación** (no un endpoint nuevo obligatorio; una
   query admin) para re-curarlos con el nuevo flujo (sync del set → seleccionar el `SealedProduct` correcto → re-mapear
   la pieza). Money-safe: cero adivinación.
9. `CardSet.tcgcsvGroupId` **se conserva** (no se dropea): denormalización del `set_main`, mantenida por el sync.

**Aditiva y reversible:** tablas nuevas + una columna FK nullable + dos valores de enum; sin `DROP`, sin backfill
destructivo. Con la app corriendo. `backend/prisma/` es **zona compartida** → el orquestador **serializa M-39**.

#### Reparto de trabajo (v1.39, P-38)
- **Backend** (stream «Inventario y vault»): migración M-39 + backfill (pasos 1-8); modelos `SealedProduct`/`SealedSetGroup`;
  servicio de sync (name-match + upsert + poblar groupIds, reuso de `TcgcsvSealedBulkProvider`, sin N+1); `GET
  /admin/inventory/sealed-products` (live marketRef money-safe); alta por `sealedProductId` (derivación server-side +
  snapshot + precio en vivo + fallback manual auditado); enriquecer `sealed-price-ingest` para barrer `SealedProduct`
  activos; que los DTOs de display prefieran `SealedProduct`→snapshot→ancla. Tests: sync puebla `tcgcsvGroupId`+catálogo
  sin item previo; UPC se infiere; un set con grupo promo trae sus sellados y descarta el single promo; alta nace con
  identidad correcta (no Tropius); precio en vivo; sin precio ⇒ PRICE_PENDING (nunca 0); manual solo super_admin y >0;
  backfill liga el ETB a su SealedProduct.
- **Frontend** (`(admin)` inventario / captura): el modal de alta de la pestaña Sellado consume `GET
  /admin/inventory/sealed-products` (tejas con imagen de API, subtipo incl. UPC, `marketRef`/«—», principales primero);
  seleccionar producto + cantidad + compra/aportación; enviar `items/batch` con `sealedProductId` + `batchKey`. **Dos
  secciones SEPARADAS por `origin`** («Del set» / «Promos/colecciones», decisión del humano v1.39.1). Estado «catálogo
  vacío» ⇒ botón «Sincronizar» (`super_admin`); campo de precio manual (**`vault_operator+`**, v1.39.1) cuando `marketRef`
  es null.
- **ux-ui**: teja del `SealedProduct` (imagen, subtipo/UPC, badge principal, `marketRef`/«—»), **dos secciones SEPARADAS
  «Del set» vs «Promos/colecciones» por `origin`** (decisión del humano v1.39.1), estado «sincronizar» y el input de
  precio manual money-safe (disponible para `vault_operator`).
- **QA/techlead/seguridad**: doble veredicto por stream + fase de seguridad (toca valuación por el precio en vivo y el
  override manual). **Foco de seguridad por release (v1.39.1):** el **precio manual lo puede fijar `vault_operator`**
  (decisión del humano) — input de dinero por rol operador: revisar que sea money-safe (solo llena hueco null, `>0`,
  auditado, no pisa mercado vivo), la autorización del sync (`super_admin`), y el host allowlist de imágenes.

---

### 4.33 Pricing por TIERS — una regla por peldaño + mapa rareza→tier (v1.37, P-34, PROJECT §M LOCKED, NORMATIVO)

> **Propósito (PROJECT §M).** El editor de M2 muestra hoy **una fila por CADA rareza canónica** (~30 tras el sync,
> §4.28). El dueño quiere pricear pensando en **5 familias de valor**, no en 30 nombres. Se introduce una **taxonomía de
> 5 tiers (T0–T4)** y un **mapa rareza canónica → tier**; cada rareza **hereda** la regla de su tier. **Lo que NO
> cambia** (crítico, money-safe): la naturaleza de una regla sigue siendo `fixed` (MX$ centavos) o `pct` (buylist: % de
> la referencia; venta: markup arriba de mercado); la **precedencia** de compra (bounty > override > regla > fallback,
> §4.26b) y de venta (listPrice por pieza > override variante > regla > fallback, §4.26b); y el **eje `finish`**
> (`finishRules`, §4.28d) sigue siendo un eje aparte (LOCKED #5). **Único cambio intencional de comportamiento: T2
> (Rare/Holo) pasa a `pct` bajo (default 25%).** Esta sección NO reabre §4.2/§4.14/§4.28 salvo por el punto de
> indirección que se documenta abajo.

#### (a) Los tiers son TAXONOMÍA (código, LOCKED), no dato editable — `common/pricing-tiers.ts`

Como `rarity-catalog.ts` (§4.28), el **conjunto de tiers** (los 5 peldaños, su nombre y su **banda `premium`**) es una
constante **cerrada y versionada** en la zona compartida `backend/src/common/pricing-tiers.ts` (importable desde
seeds/tests, sin infra). El dueño **NO** crea/borra tiers; edita (1) los **valores** de la regla de cada tier y (2) el
**mapa** rareza→tier. Forma (backend implementa; el arquitecto fija la forma y el seed):

```ts
// backend/src/common/pricing-tiers.ts  (NUEVO — zona compartida common/)
export type TierId = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';
export interface PricingTier {
  id: TierId;
  name: string;      // etiqueta de display (LOCKED, no editable por el dueño)
  premium: boolean;  // banda del tier: T0/T1/T2 = false ; T3/T4 = true (ver invariante (d))
}
export const PRICING_TIERS: PricingTier[] = [
  { id: 'T0', name: 'Bulk',               premium: false },
  { id: 'T1', name: 'Uncommon / Reverse', premium: false },
  { id: 'T2', name: 'Rare / Holo',        premium: false },
  { id: 'T3', name: 'Premium / Chase',    premium: true  },
  { id: 'T4', name: 'Ultra / Grail',      premium: true  },
];
```

> La banda `premium` del **tier** (T3/T4 = true) es distinta del `premium` de la **rareza** (`rarity-catalog.ts`,
> §4.28e). El invariante (d) las liga: una rareza `premium:true` solo puede caer en un tier cuya regla de COMPRA sea
> `pct` (nunca en un bin fijo). Con el seed, eso equivale a «premium ⇒ T3/T4», pero el invariante se valida sobre el
> **modo de la regla de compra vigente**, no sobre la etiqueta, para que siga siendo money-safe aunque el dueño edite.

#### (b) Persistencia — reshape de los `ConfigSetting` existentes + un mapa nuevo (NO hay tabla nueva)

Los tiers, el mapa y las reglas son **DATO de configuración** (JSON en `ConfigSetting`), como `BUYLIST_PRICE_RULES` lo
fue desde §4.2. **No requiere DDL de Prisma** (ver M-38, §11: es una migración de datos/seed). Tres claves:

- **`BUYLIST_PRICE_RULES`** (`buylist_price_rules`, RESHAPE): pasa de `PriceRuleSet { rarityRules, finishRules,
  fallbackPct }` (§4.28d) a **`TieredRuleSet { tierRules, finishRules, fallbackPct }`**, donde `tierRules:
  Record<TierId, BuylistRule>` (5 entradas) **reemplaza** `rarityRules`. `finishRules` (`Partial<Record<Finish,
  BuylistRule>>`) y `fallbackPct` **no cambian** (el eje acabado sigue igual, §4.28d).
- **`SALES_PRICE_RULES`** (`sales_price_rules`, RESHAPE): análogo con `SalesRule` (`pct` = markup arriba de mercado,
  §4.14b). Mismo `TieredRuleSet` con `tierRules: Record<TierId, SalesRule>`.
- **`PRICING_TIER_MAP`** (`pricing_tier_map`, NUEVO `SettingKey`): el mapa **COMPARTIDO** `Record<CanonicalRarity.key,
  TierId>`. **Un** mapa, dos juegos de valores (vive fuera de las dos claves de reglas justamente porque es compartido
  por compra y venta). Rareza **ausente** del mapa ⇒ tier por defecto ⇒ `fallbackPct` (money-safe, ver (e)).

```ts
interface TieredRuleSet<R extends BuylistRule | SalesRule> {
  tierRules: Record<TierId, R>;                 // eje RAREZA re-expresado por tier (5 entradas)
  finishRules: Partial<Record<Finish, R>>;      // eje ACABADO — IDÉNTICO a §4.28d (no se tieriza)
  fallbackPct: number;                          // tier por defecto de una rareza sin mapear
}
```

#### (c) Resolución — indirección mínima; el resolver money-safe de §4.28d NO se toca

La única función pura nueva **deriva** el `PriceRuleSet` efectivo de siempre a partir de (tiers × mapa), y se lo pasa al
resolver EXISTENTE (`resolveTwoAxisRule`, §4.28d) **sin cambiarlo**. Así la precedencia, el **gate premium** (§4.2.1) y
el manejo money-safe quedan **verbatim**:

```ts
// backend/src/common/money.ts  (aditivo; NO altera resolveTwoAxisRule/quoteAcquisitionForFinish/computeSalePriceForRarity)
function buildEffectiveRuleSet<R extends BuylistRule | SalesRule>(
  tiered: TieredRuleSet<R>,
  tierMap: Record<string, TierId>,        // PRICING_TIER_MAP
): PriceRuleSet<R> {
  const rarityRules: Record<string, R> = {};
  for (const [canonical, tierId] of Object.entries(tierMap)) {
    const rule = tiered.tierRules[tierId];
    if (rule != null) rarityRules[canonical] = rule;   // rareza mapeada → regla de su tier
  }
  return { rarityRules, finishRules: tiered.finishRules, fallbackPct: tiered.fallbackPct };
}
```

- El servicio (buylist/pricing) iza `PRICING_TIER_MAP` + la clave de reglas una vez por request (patrón BE-25) y llama
  `buildEffectiveRuleSet` → obtiene el `PriceRuleSet` de siempre → sigue con `quoteAcquisitionForFinish` /
  `computeSalePriceForRarity` **sin ningún otro cambio**. Una rareza `premium` mapeada a un tier `pct` produce un
  `rarityRules[canonical]` `pct` ⇒ el gate premium la resuelve por su regla, jamás por el bin de acabado (§4.2.1),
  exactamente como hoy.
- **Compat on-read:** si `BUYLIST_PRICE_RULES`/`SALES_PRICE_RULES` aún trae el shape `{ rarityRules, ... }` (pre-M-38),
  `buildEffectiveRuleSet` no aplica y se usa `rarityRules` tal cual (o `toPriceRuleSet`, §4.28d). El reshape M-38 es la
  transición; ambos shapes conviven durante el deploy (money-safe, sin ventana ciega).

#### (d) Invariante money-safe (refinamiento estricto de `premium`) — validado server-side en CADA write

> Preserva el fix de Fase 0.1 (§4.2.1): una rareza chase **jamás** cotiza al bin fijo barato de bulk, **aunque el dueño
> edite el mapa** (Opción B, PROJECT §M.5).

**Invariante (normativo).** Para toda `canonical` con `isPremiumCanonicalRarity(canonical) === true` asignada a `tierId`
en `PRICING_TIER_MAP`, la regla de **COMPRA** de ese tier debe ser `pct`: `BUYLIST_PRICE_RULES.tierRules[tierId].mode
=== 'pct'`. Equivalente con el seed: una rareza premium solo puede caer en **T2/T3/T4** (nunca T0/T1, los únicos bin
fijo). Se valida contra el **producto (tiers × mapa)** completo, no sobre un delta aislado, y por eso se re-valida en
**ambos** writes:

- `PUT /pricing/tier-map` (reasignar una rareza) — rechaza si mandaría una rareza premium a un tier de compra `fixed`.
- `PUT /pricing/tiers` (cambiar la regla de un tier a `fixed`) — rechaza si ese tier tiene alguna rareza premium mapeada.

Rechazo: `422 PREMIUM_RARITY_FIXED_TIER` con el detalle de los pares `(rareza, tier)` infractores. **El eje de venta NO
entra al invariante:** un `fixed` de venta es un **piso** money-safe (nunca infravalúa como un bin de compra); la
matemática de venta (§4.14b) ya lo maneja.

Otros guardarraíles money-safe (heredados, sin cambio):
- **Rareza sin tier explícito → `fallbackPct`** (default compra 40%, nunca $0 ni bin fijo). Criterio 77.
- **`pct` sin referencia de mercado del acabado → «precio pendiente»** (escala al dueño, §4.2/§4.14b). Aplica también a
  **T2** ahora que es `pct`: una Rare/Rare Holo sin market queda pendiente, nunca $0.
- **Derivación server-side (SEC-A1):** el tier se resuelve desde `Card.rarityCanonical` real + acabado validado, jamás
  del DTO del cliente. Compra y venta por igual.

#### (e) Seed (reproduce el negocio vigente salvo T2 — LOCKED) y las tres rarezas `unmapped`

`common/rarity-catalog.ts` gana **una alias y dos canónicas** (nota para backend, §4.28b — es zona compartida `common/`;
el arquitecto define el delta, backend lo implementa):

| Cambio en `rarity-catalog.ts` | Detalle | `premium` | Efecto |
|---|---|---|---|
| **alias** en `Hyper Rare` | añadir `'megahyperrare'` a `aliases` | (ya true) | `normalizeRarity('Mega Hyper Rare') → "Hyper Rare"` → T4 |
| **canónica nueva** `Mega Rare` | `{ key:'Mega Rare', premium:true, aliases:['megaattackrare','megarare'] }` | true | `MEGA_ATTACK_RARE` (snake_case; `normKey` ya lo colapsa) → "Mega Rare" → T3. Deja de cotizar al bin de bulk. |
| **canónica nueva** `Black White Rare` | `{ key:'Black White Rare', premium:true, aliases:['blackwhiterare'] }` | true | → "Black White Rare" → T3. Deja de cotizar al bin de bulk. |

`PRICING_TIER_MAP` seed (mapa M.2 LOCKED, más las dos canónicas nuevas):

```jsonc
// PRICING_TIER_MAP  (una entrada por canónica; ausencia ⇒ fallback)
{ "Common":"T0",
  "Uncommon":"T1", "Reverse Holo":"T1", "Promo":"T1",
  "Rare":"T2", "Rare Holo":"T2",
  "Double Rare":"T3","Ultra Rare":"T3","Illustration Rare":"T3","Rare Holo EX":"T3","Rare Holo GX":"T3",
  "Rare Holo V":"T3","Rare Holo VMAX":"T3","Rare Holo VSTAR":"T3","Rare Holo LV.X":"T3","Rare Prime":"T3",
  "Rare BREAK":"T3","LEGEND":"T3","Amazing Rare":"T3","Radiant Rare":"T3","Shiny Rare":"T3",
  "Trainer Gallery Rare Holo":"T3","Rare ACE":"T3","Mega Rare":"T3","Black White Rare":"T3",
  "Special Illustration Rare":"T4","Hyper Rare":"T4","Secret Rare":"T4","Gold Rare":"T4" }

// BUYLIST_PRICE_RULES.tierRules  (buy)                 // SALES_PRICE_RULES.tierRules (sell — reproduce markup vigente)
{ "T0":{"mode":"fixed","value":50},                     // T0: sell fixed piso vigente de Common
  "T1":{"mode":"fixed","value":150},                    // T1: sell fixed piso vigente de Uncommon
  "T2":{"mode":"pct","value":25},   // ← CAMBIO LOCKED   // T2: sell pct = fallback de venta vigente (15)
  "T3":{"mode":"pct","value":40},                        // T3: sell pct = fallback de venta vigente (15)
  "T4":{"mode":"pct","value":40} }                       // T4: sell pct = fallback de venta vigente (15)
// BUYLIST_PRICE_RULES.fallbackPct = 40 ; SALES_PRICE_RULES.fallbackPct = 15 (sin cambio)
// finishRules (buy y sell) = las de hoy, SIN cambio (reverse_holo fixed 150, holofoil …). Eje acabado intacto.
```

> **Valores de venta por tier:** PROJECT §M deja al arquitecto/backend fijarlos «reproduciendo el markup vigente». Los
> seed de arriba (T0/T1 = pisos fijos vigentes de Common/Uncommon; T2/T3/T4 = `pct` 15 = `SALES_PRICE_FALLBACK_PCT`
> vigente) **reproducen la venta de hoy** para las rarezas que hoy caen al fallback de venta. Backend **confirma los
> pisos exactos** de T0/T1 contra el `SALES_PRICE_RULES` productivo al implementar (sub-decisión de dato, sin producto).

#### (f) Deltas de cotización vs. hoy (transparencia — para PO/QA)

Con el seed, la cotización de **COMPRA** (finish `normal`) cambia SOLO en:

| Rareza | Compra hoy (normal) | Tier | Compra nueva | Nota |
|---|---|---|---|---|
| Common | fixed $0.50 | T0 | fixed $0.50 | idéntico ✓ |
| **Uncommon** | **fixed $0.50** (seed vigente) | **T1** | **fixed $1.50** | **CAMBIO — bandera para PO.** El mapa LOCKED agrupa Uncommon en «Uncommon/Reverse» ($1.50). Criterio 78 asumía T1 «idéntico»; de hecho Uncommon sube $0.50→$1.50. Es cambio de negocio (no money-safety), **reversible sin código** (bajar T1 o reasignar Uncommon→T0). Ver (g) DEV-tiers-1. |
| Rare, Rare Holo | fallback 40% | T2 | **pct 25%** | **CAMBIO LOCKED intencional** (T2). Sin market ⇒ pendiente, nunca $0. |
| premium (Double/Ultra/Illustration/ex/V/GX/…) | fallback 40% | T3 | pct 40% | idéntico ✓ |
| Special Illustration/Hyper/Secret/Gold | fallback 40% | T4 | pct 40% | idéntico ✓ |
| `MEGA_ATTACK_RARE`, Black White Rare | bin de acabado holo (money-losing en finish holofoil) | T3 | pct 40% | **FIX de dinero:** deja de cotizar al bin barato de bulk. |
| Mega Hyper Rare | fallback 40% (unmapped, premium por patrón) | T4 | pct 40% | equivalente; ahora explícito/auditable. |

> **Aclaración sobre la narrativa «bin fijo → pct» de T2:** en el seed vigente Rare/Rare Holo NO tienen regla explícita
> y hoy caen al **fallback 40%** (no a un bin fijo). El cambio LOCKED las lleva a **pct 25%** (una BAJA deliberada de la
> banda intermedia). El resultado normativo es el mismo que pide §M (T2 = `pct` 25%, money-safe); solo se documenta el
> punto de partida real para que QA verifique el delta correcto (40%→25%, no «bin fijo→25%»).

#### (g) Riesgos / deuda (abiertos, no bloqueantes)

- **DEV-tiers-1 (bandera para PO):** el mapa LOCKED sube **Uncommon** de $0.50 a $1.50 en compra, en tensión con la prosa
  del criterio 78 («T0/T1 idéntico»). Se implementa el **mapa tabulado** (más específico y explícito que la prosa); se
  reporta a PO/humano para que confirme o reasigne Uncommon→T0. Reversible sin deploy.
- **Barrido de `unmapped` (implementación, §M.3):** además de los tres casos cerrados, backend recorre TODAS las rarezas
  distintas del catálogo real tras el sync y cierra las `unmapped` restantes con la MISMA política (premium por patrón
  ⇒ canónica+tier premium; jamás T0/T1). Tarea de implementación con política fijada, no hueco de producto.

---

### 4.35 Fuente de precio por-acabado en el barrido diario — TCGCSV `tcgcsv_singles` primario, PPT LIST fallback (v1.44, P-47, NORMATIVO)

> **Escalada regla 9 (backend).** El fix money-safe de **P-47** (commit `35e948a`) corrigió el aplanamiento de PPT
> `fetchPrintings`: la **API v2 de PPT expone UN solo `market`** (impresión primaria), **invariante al `?printing=`**, y el
> modo forzado replicaba ese único market a los 3 acabados (normal/reverse_holo/holofoil). Ahora PPT solo escribe la
> impresión primaria real; los demás acabados quedan `PRICE_PENDING`, **nunca** con el precio de otro. Money-safe y
> cerrado. **Consecuencia abierta que este § resuelve:** el barrido diario (`PriceIngestService.ingestAll` / job
> `price-ingest`) quedó **sin fuente que pueble el precio por-acabado** (reverse_holo/holofoil): PPT solo produce la
> impresión primaria, y la fuente por-acabado correcta —**TCGCSV `tcgcsv_singles`** (`CardProductResolverService`, §4.27e/f,
> con precedencia sobre PPT)— HOY solo corre en import/`--force`/refresh-variants, **NO en el barrido**. Sin decidir esto,
> reverse/holo quedan en «—»/`PRICE_PENDING` hasta un sync manual por set. Base normativa previa: §4.27 (1 carta ↔ N
> productos, TCGCSV fuente por-variante) y §4.15 (arnés del barrido). **Sin migración** (M-31 ya existe); **sin cambio de
> forma de contrato**.

#### (a) Dictamen — Opción (a) REFINADA: separar ESTRUCTURA de PRECIO; el barrido diario reprecia por-acabado desde TCGCSV

**Elegida: Opción (a)**, con la separación estructura↔precio que ya distingue al sellado. El barrido diario pasa a
refrescar el **precio por-acabado** leyéndolo de **TCGCSV `tcgcsv_singles`** (la fuente PRIMARIA por-variante que §4.27f
ya declaró), **sin re-resolver la estructura**:

- **ESTRUCTURA** (composición de variantes: `CardProduct.finishes`, `Card.availableFinishes`) **sigue GATEADA a
  import/`--force`** vía `CardProductResolverService` (§4.27d) — **NO** corre a diario. La composición es estable; correr
  el resolver estructural completo cada día sería caro y churn-earía la lista blanca SEC-A1 sin necesidad.
- **PRECIO** (marketPrice por `(CardProduct, subType→Finish)`) **se refresca A DIARIO** en el barrido: upsert de
  `PriceReference (cardId, 'raw', 'raw:NM', finish, capturedDate=hoy, cardProductId)` con `source='tcgcsv_singles'`, FX
  Banxico aplicado (§4.27e), respetando `isManualOverride`. **NO** escribe `CardProduct.finishes` ni `availableFinishes`.

Es EXACTAMENTE la separación que ya opera para el sellado: la estructura/mapeo del sellado es curada y el job
`sealed-price-ingest` (§4.19d) solo **reprecia** a diario desde TCGCSV. §4.35 lleva el mismo patrón a los singles.

**Por qué (a) y no (b).** La opción (b) —depender del refresh TCGCSV por set (manual/programado) para reverse/holo—
deja esos acabados en «—» entre syncs y traslada trabajo money-relevante a una acción manual; en la práctica incumple
PROJECT §A/§I (la valuación por-acabado de portafolio/venta/buylist usa el precio del **acabado específico** con
**refresco diario**). (a) converge por diseño: cuando TCGCSV tiene el precio de la reverse, el barrido del día siguiente
ya lo muestra con SU precio real. **Rechazada** también la lectura ingenua de (a) «correr el resolver estructural
completo a diario»: mezcla estructura y precio, es cara y re-abre churn de la lista blanca; la estructura no cambia día
a día.

#### (b) Cableado recomendado — reusar la infra `price-ingest` con un provider TCGCSV singles primario

El job `price-ingest` (parent + `price-ingest-set` child por set; BullMQ, idempotente, reanudable, FX-una-vez, §4.15c)
ya es el arnés robusto del barrido. Se reusa tal cual; **solo cambia el PROVIDER primario**:

- **Nuevo `TcgcsvSinglesBulkPriceProvider`** (implementa `BulkPriceProvider`, `source='tcgcsv_singles'`):
  `fetchPricesForSet({set})` resuelve el `groupId` TCGCSV del set (misma lógica S-D3/§4.27d), hace `getProducts` +
  `getPrices` del grupo y emite un `BulkPriceRow` por `(cardProductId, subType→Finish, marketCents>0)` — **keyed por
  `cardProductId`** (join EXACTO a la carta vía `CardProduct.tcgplayerProductId`). Money-safe: `subType` desconocido o
  `marketPrice ≤0/null` ⇒ **OMITE** la fila (nunca atribuye un precio a otro acabado); **no** escribe estructura.
- **`PriceIngestService.providerFor()`** (dial `PRICE_PROVIDER`, §4.15b) gana el valor **`tcgcsv_singles`** como
  **primario del barrido de singles**. El upsert de `PriceReference` incluye `cardProductId` y `source='tcgcsv_singles'`
  (clave `@@unique … cardProductId`, M-31/§4.27b).
- **PPT (modo LISTA) queda como FALLBACK-only por PRECEDENCIA DE LECTURA** (no primario, y **no** un segundo escritor
  vivo del barrido) — **ratificado en §4.35(f), v1.45**. En el barrido corre **UN solo provider: `tcgcsv_singles`** (lo
  selecciona el dial `PRICE_PROVIDER`, §4.15b). **PPT bulk NO corre en el barrido diario** y `fetchPrintings` queda
  apagado (c). «Fallback-only» significa que, **al RESOLVER** la referencia de mercado de una `(carta, finish)` (§4.27f,
  precedencia de LECTURA por `sourceRank`/`isBetterRef`), si **no** hay fila `tcgcsv_singles` fresca gana la mejor fila
  existente — que puede ser un **residuo** PPT/pokemontcg.io escrito **antes** del switch de provider. Reverse/holo
  obtienen su precio real de TCGCSV cuando este lo trae; donde TCGCSV aún no tiene precio, la celda **conserva** (congela)
  su último precio real de residuo, o queda «—»/`PRICE_PENDING` si nunca existió. **Nunca $0, nunca el precio de otro
  acabado.** El hueco de un set **nunca resuelto** (sin `CardProduct`, sin residuo) lo cierra el `--force` del runbook
  (§4.27h), **no** una escritura de PPT en vivo.

**Dependencia explícita (no es hueco, es la separación de (a)):** el reprecio diario TCGCSV solo cotiza variantes cuya
`CardProduct` **ya existe** (estructura resuelta en import/`--force`, §4.27d). Un set **nunca resuelto** bajo M-31 se
queda en PPT-primario/`PRICE_PENDING` hasta correr `POST /admin/catalog/sync {setId, force:true}` **una** vez. Correr el
`--force` de un set nuevo **antes** del primer barrido que lo cubra es el runbook (devops; §4.27h).

> **Alternativa de mecanismo (equivalente; decide backend):** en vez del swap de provider en `price-ingest`, un job
> hermano `tcgcsv-singles-price-ingest` calcado de `sealed-price-ingest` (§4.19d). **Recomendación del arquitecto:** el
> swap de provider en `price-ingest` (reusa fan-out/reanudabilidad sin duplicar arnés). Backend elige; ambos cumplen (a).

#### (c) `fetchPrintings` de PPT — APAGAR el dial (recomendación)

**Recomendado: apagar `POKEMONPRICETRACKER_FETCH_PRINTINGS` (→ `false`).** Tras el fix P-47, el modo por-impresión cuesta
**~3× requests por set** para producir, a lo sumo, la **misma fila de impresión primaria** que el modo LISTA da a **1×**
(la API v2 de PPT no expone `market` por impresión). Con TCGCSV `tcgcsv_singles` como fuente por-acabado (b),
`fetchPrintings` ya **no aporta nada** que otra fuente no dé más barato y mejor. PPT corre en modo LISTA (1×) como
fallback de impresión primaria. **Acción de DEVOPS** (config/env; ver reparto (e)); reversible por dial.

Money-safe: apagar el dial **no puede infravaluar** — el fix ya garantiza que un acabado sin precio propio real queda
`PRICE_PENDING`/«—», jamás el precio de otro (§4.27e, invariante H1/H2/H3). El único efecto es dejar de gastar 3× en PPT.

#### (d) Corrección de §4.25a-2 (premisa FALSA)

§4.25a-2 afirmaba que el barrido por-impresión de PPT «es exactamente lo que produce la `PriceReference` propia de la
reverse». **FALSO** (evidencia P-47): la API v2 de PPT expone **UN solo `market`** (impresión primaria), **invariante al
`?printing=`**; `fetchPrintings` nunca produjo un precio por-acabado de reverse/holo — replicaba el market primario a los
3 acabados (bug de dinero corregido en `35e948a`). La `PriceReference` **propia por-acabado** la produce **TCGCSV
`tcgcsv_singles`** (§4.27e/f), no PPT. La corrección queda anotada in-situ en §4.25a-2 (callout ⛔ v1.44); el resto de esa
subsección (filas `forced` no escriben el snapshot) queda como registro histórico y **moot** al apagar el dial (c).

#### (e) Reparto (para el orquestador)

- **backend** (WS «Catálogo y precios» — `modules/pricing` + `modules/catalog` + `jobs/`): (1) implementa
  `TcgcsvSinglesBulkPriceProvider` (o el job hermano) que reprecia **por-acabado** desde TCGCSV, **keyed por
  `cardProductId`**, `source='tcgcsv_singles'`, FX aplicado, respeta `isManualOverride`, **no** escribe estructura; (2)
  registra `tcgcsv_singles` en `providerFor()`/`PRICE_PROVIDER`; (3) cablea PPT LIST como **fallback-only** en el barrido
  (precedencia de escritura §4.27f); (4) tests money-safe: reverse/holo con precio TCGCSV ⇒ celda con SU precio; sin
  precio en ninguna fuente ⇒ `PRICE_PENDING`/«—», nunca el de otro acabado. **Toca dinero → triple veredicto + gate de
  seguridad por release.** Zona compartida (`common/`, registro de providers; `prisma` NO cambia — M-31 ya existe):
  serializar en **un** solo stream.
- **devops** (dials/env/scheduler): (1) `PRICE_PROVIDER=tcgcsv_singles` (primario del barrido de singles) en
  staging→prod; (2) **`POKEMONPRICETRACKER_FETCH_PRINTINGS=false`** (apagar el modo 3×); (3) verificar orden del
  scheduler: `fx-refresh` → barrido singles TCGCSV (tras la ventana de actualización TCGCSV, como `sealed-price-ingest`,
  ~20:00 UTC) → `portfolio-snapshot`; (4) runbook: `--force` por set nuevo **antes** del primer barrido que lo cubra
  (§4.27h). Documenta en `DEVOPS_NOTES.md`.
- **arquitecto** (este §): dictamen + corrección §4.25a-2 + eco de contrato. Sin migración, sin cambio de forma de
  contrato (solo notas/precedencia).

#### (f) Dictamen regla 9 (techlead): «fallback-only» se cumple por PRECEDENCIA DE LECTURA — RATIFICADO (v1.45, NORMATIVO)

> **Escalada (techlead).** El techlead pidió confirmar o registrar cómo backend implementó §4.35(b). **Ambigüedad
> detectada:** §4.35(b) y el bullet de PPT de §4.27f describían el fallback con lenguaje de **ESCRITURA** («PPT solo
> **escribe** la `PriceReference` cuando NO existe fila `tcgcsv_singles` fresca»), y lo remitían a «(precedencia de
> ESCRITURA §4.27f)» — pero **§4.27f es una precedencia de LECTURA** (su bloque de código resuelve la *referencia de
> mercado* por `(carta, variante)`, no ordena escrituras). El lenguaje mezclado sugería —incorrectamente— una
> **doble-escritura de PPT en vivo** dentro del barrido.

**Dictamen: se RATIFICA la interpretación de LECTURA (la que implementó backend).** No se exige doble-escritura de PPT.

**Qué corre en el barrido diario (inequívoco).** El barrido `price-ingest` ejecuta **exactamente UN provider primario:
`TcgcsvSinglesBulkPriceProvider`** (`source='tcgcsv_singles'`), seleccionado por el dial `PRICE_PROVIDER=tcgcsv_singles`
(§4.15b). **PPT bulk NO corre en el barrido diario**; `POKEMONPRICETRACKER_FETCH_PRINTINGS` queda en `false` (c). No hay
un segundo pase de PPT que escriba filas donde TCGCSV no las tenga.

**Cómo se cumple «fallback-only» (por LECTURA, no por escritura).** «Fallback-only» = PPT es fallback **en el momento de
RESOLVER** la referencia de una `(carta, finish)`, no un escritor secundario del barrido. La resolución aplica la
precedencia de LECTURA de §4.27f (`isManualOverride` > `tcgcsv_singles` > PPT > pokemontcg.io > «—»/`PRICE_PENDING`),
eligiendo la **mejor `PriceReference` existente** por `sourceRank`/`isBetterRef`. Donde no hay fila `tcgcsv_singles`
fresca, gana la mejor fila previa — que puede ser un **residuo congelado** (una `PriceReference` PPT/pokemontcg.io
escrita **antes** del switch de provider, con `cardProductId = null`, §4.27g). Ese residuo no lo reescribe el barrido:
lo aflora la lectura.

**Qué pasa con los acabados que TCGCSV no cubre (money-safe, inequívoco).** Un set **ya resuelto** al que TCGCSV le
falte una carta/acabado en la ventana del día:
- si esa `(carta, finish)` **tiene residuo** (precio real previo PPT/pokemontcg.io) → la celda **congela** ese precio
  hasta que TCGCSV lo traiga o el admin lo overridee o corra un `--force`;
- si **nunca** tuvo precio → queda «—»/`PRICE_PENDING`.

En ningún caso se inventa **$0** ni se **copia el precio de otro acabado** (invariante H1/H2/H3, §4.27e). Un residuo
congelado es un precio **real pasado**, no una fabricación: es estrictamente más money-safe que reintroducir una
escritura PPT que —por la invariante de la API v2 (UN solo `market`, §4.35 preámbulo/(d))— aplanaba.

**Por qué se rechaza exigir la doble-escritura de PPT en el barrido.** (1) Reintroduce a PPT como **escritor vivo** —el
mismo path de escritura que P-47 (`35e948a`) neutralizó por money-losing—, reabriendo su superficie de riesgo de
aplanamiento por un beneficio marginal. (2) Gasta presupuesto del free tier de PPT en cada barrido para, a lo sumo,
refrescar la impresión primaria de un set que TCGCSV aún no resuelve. (3) Ese único hueco real —un set **nunca resuelto**
bajo M-31, sin `CardProduct` y sin residuo— ya está cubierto por el runbook **`--force` por set** (`POST
/admin/catalog/sync {setId, force:true}`, §4.27h/§4.35(b)), que resuelve estructura **y** emite los `tcgcsv_singles` del
set. La interpretación de lectura es la **más simple** (un provider, sin segundo path de escritura que mantener) y
**money-safe** (congela real, nunca $0, nunca cross-finish), y el `--force` cubre el hueco.

**Consecuencia normativa.** «Fallback-only» de §4.35(b)/§4.27f se entiende **siempre** como fallback de **LECTURA/
resolución**, nunca como mandato de una escritura PPT en el barrido. Cualquier redacción previa con verbo «escribe»
referida a PPT en el barrido se lee como «**aflora por precedencia de lectura**». Sin cambio de código (ratifica lo
implementado), sin migración, sin cambio de forma de contrato.

---

### 4.36 Fusión pricing v2 — DOS CAPAS ORTOGONALES: REFERENCIA (`tcgcsv_singles`, P-47) × REGLA (curva v2) (v1.49, DICTAMEN DE FUSIÓN, NORMATIVO)

> **Escalada regla 9 (backend) — dictamen de fusión de la rama v2 `origin/claude/card-pricing-rules-2e537m`.** La rama v2
> reescribe la **capa REGLA** de pricing: sustituye la indirección tiers×mapa (§4.33) por un **motor de CURVA**
> (`computeSalePriceFromCurve` / `quoteAcquisitionFromCurve` en `common/money.ts`), añade el editor de curvas/spreads/UPC
> en M2 y un `priceBasis` a los DTO de precio. En el mismo pase **elimina** el provider `TcgcsvSinglesBulkPriceProvider`
> (P-47, §4.35) del barrido: borra su import, el parámetro del constructor, su registro en `providerFor()` (deja
> `[pptBulk, tcgIoBulk]`) y **borra el fichero** `providers/tcgcsv-singles-bulk.provider.ts`. **Ese borrado es la única
> pieza que este dictamen RECHAZA.** El resto de la capa REGLA v2 se ADOPTA. Sin migración de schema por este dictamen
> (M-41 de la rama es aditiva y limpia tras M-40; no toca `PriceReference` ni `finish`/`cardProductId`).

#### (a) El dictamen — CONSERVAR referencia (P-47) + ADOPTAR regla (curva v2). Son capas ORTOGONALES.

El pricing de singles tiene **dos capas independientes que no se pisan**:

| Capa | Qué hace | Quién la produce | Clave |
|---|---|---|---|
| **REFERENCIA** (§4.35, P-47) | Puebla el **precio de mercado por-acabado** (`marketMxnCents` escalar por `(carta, finish, cardProductId)`) | `TcgcsvSinglesBulkPriceProvider` → upsert `PriceReference` `source='tcgcsv_singles'` | La FUENTE per-acabado |
| **REGLA** (§4.33 → curva v2) | Deriva **compra/venta** a partir de ese escalar de mercado | curva v2 (`computeSalePriceFromCurve`/`quoteAcquisitionFromCurve`) leyendo `getReference(...finish)` / `getReferencesBatch` per-acabado | La MATEMÁTICA sobre la referencia |

**Ortogonalidad demostrada en el propio código v2:** la curva recibe un `marketMxnCents` **escalar** y el servicio lo lee
**POR ACABADO** (`getReference(...finish)` / `getReferencesBatch` keyeado por `variantKey`; `catalog.service.ts
fetchSellable` itera pieza a pieza con su `finish`). `finish` **no** es parámetro de la curva —es criterio de forma— pero
**cada acabado tiene su propia evaluación** sobre su propia referencia. Es decir: el precio por-acabado (P-47) **sobrevive
estructuralmente** a la curva. Lo que la curva NO puede inventar es una referencia per-acabado **distinta** si la fuente
que la escribe (tcgcsv_singles) desaparece.

#### (b) Por qué `tcgcsv_singles` NO se retira — la regresión que P-47 cerró y que el humano reactivó en prod

Retirar `tcgcsv_singles` **no** colapsa el mecanismo per-acabado (la curva sigue leyendo por acabado), pero **SÍ elimina la
FUENTE DE DATOS que produce precios por-acabado DISTINTOS**. Motivo (evidencia P-47, §4.35 preámbulo/(d)): **PPT (API v2)
devuelve UN solo `market` a nivel carta, invariante al printing**; pokemontcg.io idem. Por eso P-47/v1.44 introdujo
`tcgcsv_singles` como escritor DIARIO per-acabado (por `cardProductId`), precisamente para **no aplanar**. Si la fusión v2
quita `tcgcsv_singles` y la referencia vuelve a salir de PPT/pokemontcg.io, el precio por-acabado se **re-aplana** (mismo
precio normal/reverse/holo): es la **regresión exacta que P-47 cerró** y que el humano reportó y acaba de reactivar en
prod. **Conclusión normativa: `tcgcsv_singles` permanece como provider PRIMARIO per-acabado del barrido. La curva v2 se
adopta ENCIMA de esa referencia, no en su lugar.**

#### (c) Resolución por-hunk de `price-ingest.service.ts` (instrucción para BACKEND)

En el merge de la rama v2, `price-ingest.service.ts` es el **único conflicto de código**. Regla por hunk:

- **CONSERVAR (lado main / P-47), rechazar el borrado de v2:**
  - el `import` de `TcgcsvSinglesBulkPriceProvider`;
  - el **parámetro del constructor** que lo inyecta;
  - su **registro en `providerFor()`** — las candidatas incluyen `tcgcsvSinglesBulk` y `providerFor('tcgcsv_singles')`
    debe seguir devolviéndolo como **primario** (NO dejar `[pptBulk, tcgIoBulk]`);
  - el fichero `providers/tcgcsv-singles-bulk.provider.ts` (**no** se borra);
  - el camino dedicado `ingestSinglesForSet` (el path per-acabado que evita el `FinishReconciler`, §4.35);
  - el dial `PRICE_PROVIDER=tcgcsv_singles` como opción válida y **primaria** (§4.15b, §M10).
- **ADOPTAR (lado v2):**
  - la reescritura del bloque de **reprice/pendientes por-curva** (`loadPricingCurve`, `getReferencesBatch` per-acabado,
    cola con `pendingReason`);
  - toda la **capa REGLA**: la curva en `common/money.ts` (`computeSalePriceFromCurve`/`quoteAcquisitionFromCurve`), el
    editor M2 de curvas/spreads/UPC, los DTO con `priceBasis`, y la migración **M-41** (aditiva).
- **Punto de fricción (reprice v2 ↔ `ingestSinglesForSet` P-47) — CÓMO COEXISTEN:** las dos piezas operan en **fases
  distintas del mismo barrido y NO se excluyen**, porque una **ESCRIBE** referencia y la otra la **LEE**:
  1. **Fase ESCRITURA (P-47, capa REFERENCIA):** `ingestSinglesForSet` / `TcgcsvSinglesBulkPriceProvider` upsertea
     `PriceReference (cardId, finish, cardProductId, source='tcgcsv_singles', capturedDate=hoy)` con FX, respetando
     `isManualOverride`, **sin** tocar estructura. Es el barrido primario de singles.
  2. **Fase REGLA (v2, capa REGLA):** el bloque de reprice v2 hace `loadPricingCurve` + `getReferencesBatch` per-acabado y
     **lee** esas mismas filas para derivar compra/venta y encolar pendientes (`pendingReason`).
  El orden es **escribir-luego-leer**: `ingestSinglesForSet` deja la referencia fresca del día y el reprice v2 la consume.
  **No deben excluirse mutuamente en el merge** (el error a evitar es que el hunk v2 sustituya la escritura de referencia
  por su propia lectura y deje el barrido sin quien pueble la referencia per-acabado).
- **Si un hunk toca literalmente las mismas líneas** (el bloque v2 de reprice y el path P-47 de `ingestSinglesForSet`
  comparten región): mínima adaptación = mantener **ambas fases** en secuencia dentro de `ingestSinglesForSet` —primero el
  upsert de referencia per-acabado (P-47), después el reprice por-curva (v2) sobre lo recién escrito—. **No** hay
  incompatibilidad real: la curva **requiere** un `marketMxnCents` de entrada, y ese escalar es justo lo que la fase de
  referencia produce. Retirar la referencia dejaría a la curva leyendo el market aplanado de PPT (regresión (b)).

#### (d) Banderas — puntos donde la rama v2 pudo asumir que `tcgcsv_singles` ya no existe (para BACKEND/QA)

La coexistencia es limpia en `price-ingest.service.ts`, pero el borrado v2 pudo dejar **referencias colgantes** al provider
retirado. Backend/QA deben barrer y RESTABLECER en el merge:

1. **Enum de provider / validador** `PRICE_PROVIDER_VALUES` (settings): debe seguir siendo
   `['pokemontcg_io','pokemonpricetracker','tcgcsv_singles']`. Si v2 lo redujo a dos valores, **restaurar** `tcgcsv_singles`.
2. **`enum PriceSource`** (Prisma / `common/`): debe conservar el valor `tcgcsv_singles` (M-31). Si v2 lo eliminó del enum
   o de su union TS, **restaurar** (borrarlo rompería la lectura de `PriceReference` históricas y §4.27f).
3. **Seed / `ConfigSetting`**: el seed de `PRICE_PROVIDER` debe dejar `tcgcsv_singles` como primario (§4.35/§M10). Si el
   seed v2 lo cambió a `pokemontcg_io`/`pokemonpricetracker`, **restaurar**.
4. **Registro de providers** (módulo NestJS / factory de `providerFor`): el proveedor debe estar en el array de providers
   inyectables; si v2 lo quitó del módulo, **re-registrarlo**.
5. **Tests**: cualquier test v2 que asserte `providerFor()` == `[pptBulk, tcgIoBulk]` o que `tcgcsv_singles` ya no existe
   debe **corregirse** para reflejar el primario conservado (P-47). Añadir/mantener el test money-safe de §4.35(e)(4):
   reverse/holo con precio TCGCSV ⇒ celda con SU precio; sin precio en ninguna fuente ⇒ `PRICE_PENDING`/«—», nunca el de
   otro acabado.
6. **Devops (dials/env)**: `PRICE_PROVIDER=tcgcsv_singles` y `POKEMONPRICETRACKER_FETCH_PRINTINGS=false` siguen vigentes
   (§4.35(e)); verificar que el merge v2 no los revirtió en `.env.example`/config de staging.

Si en el barrido resultara alguna incompatibilidad NO listada aquí (p. ej. la curva v2 asume un shape de entrada que la
referencia P-47 no provee), **es una escalada regla 9 al arquitecto antes de merge** — no se resuelve en backend por su
cuenta (toca zona compartida `common/money.ts` + contrato).

#### (e) Numeración y reparto

- **Re-anclaje de versión:** la línea de contrato de PRODUCCIÓN es **v1.x**. Los changelogs internos **v2.x** de la rama
  (hasta `v2.1.9`) se re-anclan como **notas internas del pase de curva**, NO como línea de contrato; el contrato bumpéa a
  **v1.49-pricing-two-layers-merge** (§ changelog del contrato). No hay línea «v2» del contrato.
- **backend** (WS «Catálogo y precios»): ejecuta la resolución (c) en el merge, restablece las banderas (d), adopta la
  curva v2 y M-41. **Toca dinero + zona compartida (`common/money.ts`, registro de providers) → triple veredicto + gate de
  seguridad por release; serializar en UN solo stream.**
- **arquitecto** (este §): dictamen + resolución por-hunk + contrato v1.49. Sin migración por este dictamen (M-41 la trae
  la rama). El **merge lo coordina el orquestador**.

---

## 5. Decisiones transversales

- **Dinero sin balance:** no hay wallet ni saldo; cada movimiento de dinero es una transacción Stripe (ventas/reembolsos) o un pago SPEI manual (buylist). Ninguna vista de usuario muestra saldo.
- **Montos:** enteros en centavos MXN; IVA siempre desglosado y persistido en `Order.ivaCents` para M7/CFDI.
- **P&L (M7) — ingreso y costo de envío son cosas distintas (v1.4-finance):** el envío aporta al P&L por **dos** lados: un **ingreso** (`ShipmentRequest.shippingFeeCents`, lo que el cliente paga) y un **costo** (`ShipmentRequest.shippingCostCents`, lo que la plataforma paga a la paquetería, M-16). El P&L los suma/resta por separado: `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`. Ambos importes de un mismo envío se acotan al periodo por **`pickingAt`** (envíos liquidados: `status ∈ {picking, guia, enviado, entregado}`), garantizando que ingreso y costo del envío caigan en el mismo periodo. Antes de v1.4-finance el P&L solo contaba el ingreso, sobreestimando la ganancia. Response/CSV en `API_CONTRACT §M7` (`shippingCents`→`shippingRevenueCents` + nuevo `shippingCostCents`).

### 5.1 Cálculo del checkout (precio de venta, IVA y fee gross-up)
Orden de compra de cartas:
```
salePriceCents(item) = item.listPriceCents  // = round(referenciaMxn × (1 + salesMarkupPct/100)), o override manual
subtotalCents        = Σ salePriceCents(item)
ivaCents             = round(subtotalCents × ivaPct/100)                 // ivaPct default 16
baseCents            = subtotalCents + ivaCents                          // lo que la plataforma debe recibir íntegro
// Gross-up de la comisión Stripe MX (pct + fija), INCLUYENDO el IVA que Stripe cobra SOBRE su comisión:
totalCents           = ceil( (baseCents + (1 + stripeFeeIvaPct)·stripeFixedCents) / (1 − (1 + stripeFeeIvaPct)·stripePct) )
processingFeeCents   = totalCents − baseCents                            // línea visible, SIN IVA de PRODUCTO adicional
```
Retiro/envío (mismo gross-up, IVA de producto sobre el envío):
```
baseCents          = shippingFeeCents + round(shippingFeeCents × ivaPct/100)
totalCents         = ceil( (baseCents + (1 + stripeFeeIvaPct)·stripeFixedCents) / (1 − (1 + stripeFeeIvaPct)·stripePct) )
processingFeeCents = totalCents − baseCents
```
`stripePct` y `stripeFixedCents` son diales de M10 (tarifa MX vigente de Stripe). **`stripeFeeIvaPct` NO es un dial propio (v1.40, Enmienda A/P-37): se DERIVA de `ivaPct` ⇒ `stripeFeeIvaPct := ivaPct / 100`.** Es el **mismo** IVA mexicano, así que tener un segundo dial (`stripe_fee_iva_pct`, fracción) era redundante y money-unsafe (drift entre `IVA_PCT`=16 y `STRIPE_FEE_IVA_PCT`=0.16 en formatos distintos). `IVA_PCT` es la **fuente única**; `getStripeFee()` computa `stripeFeeIvaPct = ivaPct/100` (16 ⇒ 0.16 ⇒ neteo idéntico). La clave de BD `stripe_fee_iva_pct` queda **deprecada e inerte** (no se lee; el gross-up NUNCA cae a la fila vieja ni a 0). La comisión efectiva de Stripe es `(1+stripeFeeIvaPct)·(pct·total + fija)` porque Stripe MX **grava su propia comisión con IVA**; el gross-up despeja `total` para que, tras esa comisión con IVA, la plataforma reciba `baseCents` íntegro. El `processingFeeCents` es lo que la plataforma cede a Stripe (comisión + su IVA), trasladado al comprador. **Aclaración:** "el fee no lleva IVA" se refiere al **IVA de PRODUCTO** — el fee no agrega una línea de IVA de venta; el IVA de la *comisión de Stripe* sí está contemplado dentro del gross-up (cierre del hallazgo C1 de la revisión de Stripe).
- **Seguridad/roles:** 3 roles. Autorización por **acción**, no solo por ruta (§7). Guard `MoneyOutGuard` exige `super_admin` para pagos SPEI y reembolsos; todo intento (permitido o bloqueado) se audita.
- **Imágenes (v1.2):** el producto **no lleva fotos propias**; se muestra la **imagen de catálogo remota** de pokemontcg.io (`Card.imageSmallUrl`/`imageLargeUrl`). La **única** subida del sistema es la **imagen del INE** del buylist (`kyc_ine`), a object storage **privado** con presigned PUT/GET y **retención** (§3.4). No hay fotos de producto/inventario ni de evidencia de disputa (la evidencia de disputa llega por correo a soporte).
- **Sync de precios/FX (jobs BullMQ):**
  - `price-sync` diario: recorre solo cartas **en bóveda**, respeta rate-limit del free tier, escribe `PriceReference` del día, genera `PendingPriceEntry` para faltantes. **v1.12-catalog-pricing:** el catálogo **completo** ya se precia aparte durante el `catalog-sync` (§4.13a, `escalate=false`); este job de bóveda se conserva para refrescar los items en custodia **entre** syncs de catálogo (y sí escala pendientes, porque son cartas que sí necesitamos preciar).
  - `fx-refresh` diario: obtiene USD→MXN de **Banxico (SIE)**, aplica el colchón (`fx_buffer_pct`) y escribe `FxRate` (`source=banxico`); si falla o hay override manual (M10), usa `source=manual` como fallback/prioridad.
  - `buylist-sweep`: 7 días sin respuesta a ajuste → `rechazada`; 30 días de abandono → `convertida a inventario`.
  - `dispute-deadline`: cierra ventana de recompra a 7 días desde entrega.
  - `portfolio-snapshot` diario (tras `price-sync`): por cada usuario con holdings, calcula el valor del portafolio con `VaultService.holdings()` (a **referencia**, excluyendo pendientes) y **upsert** de `PortfolioSnapshot` del día (`@@unique[userId,asOfDate]`). Alimenta la gráfica de tendencia (§3 PortfolioSnapshot, `GET /vault/portfolio/history`). **Depende de cablear el scheduler (BE-5).**
  - `set-price-sync` diario (v1.9-set-chart, tras `fx-refresh`; cron sugerido `30 6`): precia **TODAS** las cartas del **set destacado** (§4.12b) desde pokemontcg.io (acabado `normal`, `raw`), escribiendo `PriceReference` del día por carta. **No filtra por bóveda** (brecha nueva DEV-3, §9): recorre `Card WHERE setId=<featured>` sin tocar `InventoryItem`. Respeta cache diario y rate-limit del free tier.
  - `set-value-snapshot` diario (v1.9-set-chart, tras `set-price-sync`; cron sugerido `15 7`): agrega el valor del set destacado según la regla §4.12a y hace **upsert** de `SetValueSnapshot` del día (`@@unique[setId,asOfDate]`). Alimenta la gráfica pública del hero (§3 SetValueSnapshot, `GET /catalog/featured-set/value-history`). Orden duro: FX → precio del set → snapshot del set.
  - `catalog-price-sync` **2×/día** (v1.12-catalog-pricing, §4.13c; crons sugeridos `0 12` y `0 0` UTC = **06:00 y 18:00 CDMX**, dueño devops): **importa sets nuevos** y **refresca precios de TODO el catálogo**. Como pokemontcg.io no tiene bulk de solo-precios, refrescar precios ⇒ **re-sync completo** (`syncAll({force:true})`): `upsertCards` repuebla cartas + `PriceReference` por acabado (1.1) con el FX del día. Secuencial (respeta backoff 429 del cliente), single-flight (`syncAllStatus.running`), idempotente (upsert). Requiere `POKEMONTCG_IO_API_KEY` para la cuota (§8). **Nuevo respecto al `price-sync` de bóveda:** este SÍ precia el catálogo completo (no filtra por `InventoryItem`).
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
| **Acciones sensibles con `emailVerified=false`** (comprar / retirar / vender) | ❌ **403 `EMAIL_NOT_VERIFIED`** (`EmailVerifiedGuard`, §4.11) | n/a | n/a |
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

**Invitado (sin cuenta) — v1.21-guest-checkout.** No es un `Role` (no hay fila `User`, no hay JWT, no hay rol que
escalar): es la **ausencia** de sesión, y su superficie es una lista cerrada de endpoints `@Public()`
(`POST /checkout/guest/quote|session`, `POST /orders/guest/track|resend-link`). Autorización por acción:

| Acción | Invitado |
|---|---|
| Navegar Compra / ver ficha y precios | ✅ (ya era público) |
| **Comprar con envío directo a domicilio MX** | ✅ (`direct_ship`, envío en el mismo PaymentIntent) |
| **Guardar en bóveda** | ❌ `422 VAULT_REQUIRES_ACCOUNT` → **upsell de registro**, nunca un error |
| Ver **su** pedido por enlace tokenizado | ✅ solo lectura, datos mínimos, **un** pedido |
| Listar/buscar pedidos, ver otro pedido | ❌ no existe endpoint (criterio 52) |
| Cualquier mutación sobre el pedido (cancelar, cambiar dirección, reembolso, factura) | ❌ ninguna acción disponible con token |
| Vender (buylist), portafolio, direcciones guardadas, back-office | ❌ exigen cuenta |
| Abrir disputa por API | ❌ — se atiende **por correo a soporte** citando el `orderNumber` (§4.21f) |
| Reclamar su pedido | ✅ solo tras **crear cuenta y verificar el correo** (`403 EMAIL_NOT_VERIFIED` si no) |

Dos reglas que cierran el cruce entre mundos: un endpoint `/checkout/guest/*` con **sesión válida** responde
`409 ALREADY_AUTHENTICATED`, y el `OrderAccessToken` **nunca** se acepta como credencial de sesión (no otorga rol,
no lo lee ningún guard, no abre ningún endpoint `customer`).

---

## 8. Riesgos técnicos y notas para devops

Variables de entorno necesarias (sin valores; devops las gestiona):
- `DATABASE_URL`, `REDIS_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `POKEMONTCG_IO_API_KEY`, `POKEMONPRICETRACKER_API_KEY`, `POKETRACE_API_KEY`
- Object storage (**SOLO INE de KYC**, v1.2): `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`. **El set `S3_*` se conserva**, ahora justificado únicamente por `kyc_ine` (bucket **privado** + cifrado + retención `INE_RETENTION_DAYS`). No se usa para fotos de producto/inventario ni de disputa. (`S3_PUBLIC_BASE_URL` no aplica al INE, que es privado; se lee vía presign GET.)
- **PII / INE (KYC):** `PII_ENCRYPTION_KEY` (32 bytes base64, AES-256-GCM), `PII_HMAC_KEY` (blind index de CLABE, llave **separada**), `INE_RETENTION_DAYS` (antigüedad máxima de las imágenes de INE en el bucket, default **180**; ver §3.4). En prod las llaves provienen de KMS/secret manager, nunca del repo. Estas variables **se conservan intactas** (v1.2.1: INE almacenado con cifrado + retención).
- FX (automático desde Banxico SIE): `BANXICO_SIE_TOKEN` (token de la API SIE); modo override manual vía dial M10 sin token
- **Set destacado del hero (v1.9-set-chart):** `HOME_FEATURED_SET_ID` (**opcional**; id **nativo de pokemontcg.io** del `CardSet` a graficar en la home, ej. `sv8`). Si no se define o no resuelve a un `CardSet` local, aplica el fallback en cascada de §4.12b (mayor valor en el último snapshot → set más reciente por `releaseDate`). **El valor concreto lo fija devops/backend** por entorno; el arquitecto define solo el mecanismo. No es secreto. Reusa `POKEMONTCG_IO_API_KEY` para el `set-price-sync`.
- **Auth Google:** `GOOGLE_CLIENT_ID` (backend, para validar `aud` del ID token) y `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend, Google Identity Services). Sin `client_secret` en el MVP (flujo de ID token, no code-exchange).
- **Correo (v1.5-auth-email, Resend):** `RESEND_API_KEY` (secreto) y `MAIL_FROM` (default `no-reply@tcgvaultmx.com`).
  - **Política (sigue el patrón `env.validation.ts` local/no-local):** `RESEND_API_KEY` se añade a la lista
    `required` → **obligatoria en NO-local (staging + prod)**; en LOCAL_ENVS (`development`/`test`/`local` o sin
    `NODE_ENV`) puede faltar y el sistema **degrada** a `NoopMailAdapter` (loguea el correo/link, no envía) para
    no romper dev/CI/tests sin key. `MAIL_FROM` es opcional con default en código (no bloquea el arranque).
  - **Justificación:** la verificación **gatea dinero** (comprar/vender/retirar); si el correo degradara en prod,
    los usuarios locales nunca podrían verificar → quedarían bloqueados. Por eso en no-local (incl. **staging**,
    que debe probar el flujo real E2E) la key es dura. *(Decisión a confirmar por el humano: exigir key también en
    staging; ver §10.)*
  - **Dominio remitente:** `tcgvaultmx.com` requiere SPF/DKIM/DMARC verificados en Resend (nota devops). El correo
    de soporte de disputas es `soporte@tcgvaultmx.com` — **mismo dominio canónico** que el remitente; ver §10 v1.5-2
    (**CERRADA** 2026-08-16: dominio unificado, ya no hay inconsistencia).
- `APP_BASE_URL`, `DEFAULT_LOCALE=es` (`APP_BASE_URL` = base del frontend; también se usa para construir los
  links de verificación/reset del correo, §4.11).

Riesgos técnicos:
- **Rate-limit free tier** (100/día, 250/día): mitigado priciando solo bóveda + cache diario + cola; si crece la bóveda, puede requerir plan de pago (dial permite el cambio).
- **Idempotencia de webhooks** Stripe: obligatoria para no duplicar `settled`/reversos.
- **Consistencia de titularidad**: transiciones `pending→settled` y reversión por contracargo deben ser transaccionales con `InventoryMovement`.
- **CFDI/PAC**: el MVP **registra** datos e IVA cobrado y ofrece **solicitud de factura por correo** (sin PAC); el timbrado real (PAC) es **fase 2** (bandera fiscal de PROJECT).
- **Concurrencia de venta**: un `InventoryItem` es pieza única; el checkout debe **reservar** (`status=reserved`) para evitar doble compra.

---

## 9. Desviaciones detectadas

> El arquitecto **no corrige código** (CLAUDE.md): documenta la desviación y la enruta al **rol dueño**
> (backend). Estado del código revisado el **2026-08-16** (plataforma ya en producción; back-office M1–M10 con
> backend en su mayoría implementado; **M7 ya tiene UI consumidora real** —`admin/m7/M7View.tsx`—, el resto de
> módulos sigue con UI en `ModuleTodo` pendiente de consumir).

- **MERGE-P47xCURVA (backend, v1.49, rama v2 `origin/claude/card-pricing-rules-2e537m`) — el pase de curva v2 BORRA el
  provider `TcgcsvSinglesBulkPriceProvider` (P-47), re-aplanando el precio por-acabado.** Estado detectado (diff de la
  rama sobre `price-ingest.service.ts` + `providers/`): v2 elimina el import, el parámetro del constructor, el registro en
  `providerFor()` (deja `[pptBulk, tcgIoBulk]`) y **borra** `providers/tcgcsv-singles-bulk.provider.ts`. Efecto money-safe:
  la referencia per-acabado vuelve a salir de PPT/pokemontcg.io, que exponen **un solo `market` a nivel carta**
  (§4.35(d)) ⇒ normal/reverse/holo cotizan al **mismo** precio — la regresión que P-47 cerró y el humano reactivó en prod.
  **Norma: §4.36** (conservar `tcgcsv_singles` = capa REFERENCIA; adoptar la curva = capa REGLA; son ortogonales).
  **Acción (backend, en el merge):** aplicar la resolución por-hunk §4.36(c) —CONSERVAR el provider/registro/fichero/path
  `ingestSinglesForSet`, ADOPTAR el reprice por-curva— y barrer las banderas §4.36(d) (enum `PriceSource`,
  `PRICE_PROVIDER_VALUES`, seed, registro de módulo, tests). Cubrir con el test money-safe §4.35(e)(4).
- **IMP-C (backend, v1.43, rama `fix/variant-composition-regression`) — `gateSealedMarketCents` anula el override manual
  de MERCADO del sellado con el dial `off`.** Estado detectado (`pricing.service.ts` `gateSealedMarketCents`): el gate
  devuelve `null` para **cualquier** `sealedMarketRef` cuando `sourceOn=false`, sin distinguir la fuente automática
  (`source='tcgcsv'`) de un **override manual** (`isManualOverride=true`/`source='manual'`). Efecto: con el dial off,
  «FIJAR PRECIO» (`POST /admin/pricing/override` sellado) vacía la cola de pendientes, pero re-publicar vuelve a
  `PRICE_PENDING` y **re-crea la entrada** (bucle observado por el gate E2E). Contradice §K/§4.23a (el dial gobierna el
  *ingest automático*, no un override manual explícito; override = máxima precedencia). **Norma: §4.23a v1.43** (el gate
  respeta el override manual, gatea solo el mercado de fuente). **Acción (backend, este stream):** ajustar el único
  predicado `gateSealedMarketCents` para no gatear `isManualOverride/source='manual'`; cubrir con (i) test unitario del
  predicado con las cuatro combinaciones (`{manual, tcgcsv} × {sourceOn true/false}`) y (ii) smoke E2E: dial `off` →
  publicar sellado → `PRICE_PENDING` → «FIJAR PRECIO» → re-publicar **sin** re-crear pendiente y con `sellable=true`.
  `PriceInfo` debe exponer el discriminante (`source` basta). Money-safe: sin override ni mercado ⇒ `PRICE_PENDING`, nunca 0.
- **VAR-1 (backend, v1.22) — `price-ingest` CLOBBEA `Card.availableFinishes` con los acabados que tuvieron precio.**
  Estado detectado (`price-ingest.service.ts:151-172`): tras persistir precios, `Card.update({ availableFinishes:
  providerFinishes })` donde `providerFinishes` solo contiene acabados con `marketCents > 0`. Una carta con reverse
  holo **sin precio de reverse holo** queda reducida a `['normal']` ⇒ el binder pinta **una** casilla y el vendedor no
  puede cotizar ese acabado (`422 FINISH_NOT_AVAILABLE`). Combinado con **P-6** (adapter de paga devolviendo 0 filas),
  explica el bug en producción. **Es la causa raíz de las tres rondas.** **Norma: §4.22a** (autoridad única = catálogo;
  `price-ingest` **cero escrituras**; §4.15e derogada). **Acción (backend, este stream):** eliminar el bloque y cubrir
  con un test que asserte que el ingest **no** llama `card.update`.
  > **v1.26 (§4.24a) — VAR-1 RATIFICADA, no derogada.** El bundle v1.26 introduce `Card.structuralFinishes` (estructura
  > autoritativa desde TCGCSV) y movió la fórmula del reconciliador a ~~`orderFinishes(structuralFinishes ∪
  > pricedFinishesSnapshot) || ['normal']`~~ (⛔ v1.27: unión derogada, ver abajo), conservando el núcleo money-safe
  > de VAR-1: el precio jamás sobrescribe/encoge la estructura. `FinishReconciler` sigue siendo el único escritor de
  > `availableFinishes`.
  > **⛔ v1.27 (§4.25a-1) — «el precio CONFIRMA, nunca AÑADE» (solo structural) DEROGADA 2026-08-22.** Fue demasiado
  > lejos: sacar el snapshot de la composición no solo mató el `normal` fantasma, también mató el **reverse holo
  > LEGÍTIMO de los comunes**, que en sets recién salidos SOLO trae el proveedor de precios (no `structuralFinishes`).
  > Regresión en prod (set Pitch Black). Ver §4.25e.
  > **✅ v1.27.1 (§4.25e) — VAR-1 VIGENTE: «la unión vuelve, el fantasma no».** El invariante money↔estructura sigue en
  > pie por otra vía: la unión `structuralFinishes ∪ pricedFinishesSnapshot` recompone (el precio CONFIRMA una impresión
  > física real — el reverse del común lo es), y el ÚNICO acabado que la unión colaba de más — el `normal` en cartas
  > premium, que NUNCA existen en físico normal — se filtra por rareza (`isPremiumRarity`) en la composición. Fórmula:
  > `availableFinishes := orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot) − { normal | isPremiumRarity(rarity) } ) || ['normal']`
  > (`composeAvailableFinishes(structuralFinishes, pricedFinishesSnapshot, rarity)`). El precio jamás inventa un acabado
  > estructuralmente imposible (VAR-1 intacto): el filtro premium es un GATE por rareza, no una invención.
- **VAR-2 (backend, v1.22) — la derivación de catálogo ignora Cardmarket.** `catalog-sync.service.ts:355` →
  `deriveAvailableFinishes(c.tcgplayer?.prices)` (`pricing.types.ts:32`): sin bloque `tcgplayer` en el payload →
  `['normal']`, y las llaves con `market` nulo no se distinguen de las ausentes. Se pierde el reverse holo de toda
  carta que TCGplayer no liste aunque `cardmarket.prices.reverseHolo*` lo publique. **Norma: §4.22a-3** (unión de dos
  señales, `null` cuando no hay ninguna) **y §4.22a-4** (sin señal ⇒ **no** se sobrescribe en UPDATE).
  **Acción (backend):** nueva firma + ampliar `RemoteCard` con `cardmarket`.
- **VAR-4 / SEED-1 (backend, v1.22) — el dato ya grabado no se repara solo, y los seeds lo reproducen.**
  `syncAll`/`backfill` solo refrescan `availableFinishes` con `force:true` ⇒ los sets importados antes de v1.6-finish
  siguen en `['normal']`; y `seed.ts` / `seed-e2e.ts` / `e2e-fixtures.ts` **no setean** el campo, así que **local y
  staging nacen con el bug** y **ningún E2E puede fallar ante él**. **Norma: §4.22d** (secuencia de reparación con
  `sync-all {force:true}`, dueño devops) y **§4.22e** (seeds con ≥1 carta `['normal','reverse_holo']`, ≥1 `['normal']`
  y números `"2"/"10"/"TG01"`). **Acción:** backend (seeds), devops (re-sync + verificación).
- **ORD-1 (backend, v1.22) — orden LEXICOGRÁFICO por número en el cotizador.** `catalog.service.ts:325`
  (`searchAllCards`, que alimenta `GET /buylist/cards`) ordena `[{name:'asc'},{number:'asc'}]` sobre un `number`
  **String** ⇒ `"10"` antes que `"2"`. `master-set.service.ts:449` sí ordena bien pero **en memoria**, y
  `searchAllCards` **pagina**, así que copiar ese enfoque daría un orden **globalmente incorrecto** (se ordenaría la
  página, no el conjunto). Síntoma colateral: el front pisa `numberSort: idx` en `MasterSetBinder.tsx:104`.
  **Norma: §4.22b** (columnas persistidas `numberSort`/`numberPrefix`, migración **M-26**, `orderBy` normativo con
  desempate por `id`). **Acción:** backend (migración + `orderBy` + promoción de `deriveNumberParts`), frontend
  (quitar el `idx` y re-ordenar por `(numberPrefix, numberSort, number)`).
- **BL-1 (backend, v1.18-buylist-rejects) — monto FANTASMA en `approvedTotalCents` tras approve→reject.** Estado
  detectado (`buylist.service.ts`, `itemDecision` L651 / `recomputeApprovedTotal` L707): la rama `reject` solo fija
  `itemStatus='rechazada'` sin anular `approvedPriceCents`, y el recompute suma TODO `approvedPriceCents != null`
  **sin filtrar por status**. Un ítem aprobado (o ajustado) y luego rechazado deja su monto dentro de
  `SellRequest.approvedTotalCents` — infla el total que lee el pago SPEI/P&L (dinero saliente; contradice la
  intención RB-6/SEC-D3). En el primer `reject` (sin monto previo) no se manifiesta. **Norma v1.18 (API_CONTRACT
  §M5):** `reject` ⇒ `approvedPriceCents=null` + recompute; recomendado además excluir `itemStatus='rechazada'` en el
  aggregate (defensa en profundidad, §4.18b). **Acción (backend, este stream):** aplicar ambas y cubrir con test la
  secuencia approve→reject. Adicional menor detectado: `adminList` ordena `createdAt asc` — el contrato v1.18 norma
  **desc** (mismo dueño, mismo stream).
- **P-4 (backend, v1.24-buylist-request-reject) — la SOLICITUD nunca transiciona a `rechazada` al rechazar sus ítems
  (queda huérfana en `verificacion`).** Estado detectado (`buylist.service.ts`, `itemDecision('reject')`): actualiza
  **sólo** el ítem (`itemStatus='rechazada'` + `rejectedAt` + `approvedPriceCents=null` + `recomputeApprovedTotal` +
  correo best-effort) y **nunca re-evalúa `SellRequest.status`**. El único punto que mueve la solicitud a `rechazada`
  es `respond('decline')` (flujo del CLIENTE ante un ajuste), **no** el back-office M5. Reproducción: el PO rechazó el
  único ítem de una solicitud → ítem `rechazada` pero solicitud atorada en `verificacion`, sin auto-transición ni botón.
  **Norma v1.24 (API_CONTRACT §M5; este doc §4.18f/g):** (1) `itemDecision('reject')` gana, **tras el recompute**, la
  re-evaluación de la solicitud → si TODO ítem es `rechazada`, `SellRequest.status='rechazada'` + `closedAt=now()`, con
  guard «no pisar terminal» y `convertida_inventario` **NO** contando como rechazado; (2) endpoint nuevo `POST
  /admin/buylist/:id/reject` (`vault_operator+`, auditado `buylist.reject`) para cerrar solicitudes ya atoradas, con
  guard `422 REQUEST_HAS_NON_REJECTED_ITEMS`, sin mover dinero ni correos. **Acción (backend, este stream):** implementar
  ambos dentro del mismo transaction boundary del `reject`, cubrir con test (rechazo del último ítem ⇒ solicitud
  `rechazada`+`closedAt`; solicitud mixta convertido+rechazado ⇒ NO se auto-rechaza; botón sobre solicitud con ítem
  vivo ⇒ `422`) y drenar el back-log de solicitudes atoradas pre-fix vía el botón o script puntual con la misma regla.
- **WD-1 (backend, v1.17) — el `InventoryItem` NUNCA se movía en el ciclo de RETIRO (bóveda "fantasma").** Estado
  detectado: al pagar un retiro, `payments.service` solo avanzaba `ShipmentRequest solicitado→picking` y el
  `InventoryItem` quedaba `ownerType=customer, ownershipStatus=settled, status=in_custody` **para siempre** —incluso
  tras `entregado`—; `vault.service.holdings` filtraba solo por `ownerType/ownerUserId` sin excluir ni marcar items en
  retiro, así que la carta seguía en "Mi Bóveda" como LIQUIDADA con **RETIRAR activo** de por vida, y el cliente no
  tenía rastreo por carta. El enum `InventoryStatus` ya incluía `picking|shipped|delivered|withdrawn` pero **ningún
  código los escribía**. **Decisión de producto (humano) = Opción 1**, normada en API_CONTRACT v1.17 y §3.3 de este
  doc. **Acción (backend):** (1) `vault.service.holdings` — excluir `status='withdrawn'` y **derivar** `shipmentState`
  / `activeShipmentId` / `withdrawable` del join `ShipmentItem→ShipmentRequest` (sin espejar el estado en el item); (2)
  `shipments.service.updateStatus` — al pasar a `entregado`, transicionar los `InventoryItem` `in_custody→withdrawn` +
  `InventoryMovement reason='withdrawal'` (en transacción); (3) `shipments.service.listMine/getMine` — enriquecer
  `items[]` con `folio` + `card` + `finish`; (4) `portfolio-snapshot` — aplicar la misma exclusión de `withdrawn`. **Sin
  migración** (reusa enums existentes). SEC-A1 intacto (no toca montos). **Fuente de verdad = join** (no espejo en el
  item), declarada en §3.3.
- **DEV-1 (backend) — `POST /admin/catalog/sync` importa de forma SÍNCRONA en el request.** El contrato
  declara `202 { jobId, setsQueued, mode }` (semántica async/encolada), pero `CatalogSyncService.sync()`
  recorre e importa **todos** los sets `>= fromReleaseDate` **dentro del handler HTTP** (await inline por set y
  por página de cartas). Para un sync acotado a 2024+ es tolerable, pero para un **sync de todo el catálogo**
  (Opción 1, cientos de sets / decenas de miles de cartas) **provoca timeout** del request y no respeta la
  cola/rate-limit prometidos. **Acción (backend):** implementar el nuevo `POST /admin/catalog/sync-all`
  encolando en BullMQ (truly-async) y, deseablemente, alinear `sync` from-date al mismo patrón encolado. El
  `backfill` repetible **sí** es seguro (importa por lotes) y es el camino recomendado mientras `sync-all` no
  encole de verdad. Registrar en `docs/TECH_DEBT.md` si se difiere.
- **DEV-2 (informativo, no bloqueante) — `jobId` cosmético en sync/backfill.** Los métodos devuelven
  `jobId: \`catalog-sync-${Date.now()}\`` sin un job real detrás (la importación ya ocurrió síncrona). Es
  coherente con DEV-1: al encolar de verdad, el `jobId` debe ser el de la cola. Sin impacto de contrato para
  el front (trata el `jobId` como opaco).
- **DEV-3 (backend, v1.9-set-chart) — el `price-sync` actual solo precia BÓVEDA; falta preciar el set destacado
  completo.** La gráfica pública del set (§4.12) requiere `PriceReference` de **todas** las cartas del set
  destacado, pero el `price-sync` existente recorre únicamente cartas con `InventoryItem` en bóveda (para que el
  free tier alcance). **Brecha nueva:** se necesita el job `set-price-sync` que recorra `Card WHERE
  setId=<featured>` **sin** filtro de `InventoryItem`, acotado a ese único set (~150–250 cartas, tolerable con la
  cola/rate-limit existentes). **Acción (backend):** implementar `set-price-sync` + `set-value-snapshot` (§4.12c)
  reusando `PricingService`/`PokemonTcgIoProvider` y el cache diario. No cambia el `price-sync` de bóveda (queda
  intacto); es un job **adicional** acotado. Registrar en `docs/TECH_DEBT.md` si se difiere el cableado del
  scheduler (mismo estado que BE-5 para `portfolio-snapshot`).

- **DEV-3 — SUBSUMIDO por Fase 1 (v1.12-catalog-pricing).** La brecha "el `price-sync` solo precia bóveda" queda
  cubierta por 1.1 (§4.13a): el `catalog-sync` precia TODO el catálogo (acabado `normal` incluido) → `computeSetValue`
  ya tiene datos de cualquier set, no solo del destacado. `set-price-sync` se conserva (inocuo) pero es en gran medida
  redundante; su retiro es opcional (fase 2), no bloquea nada.
- **BE-16 — RESUELTO por Fase 1 (v1.12-catalog-pricing, §4.13b).** El cotizador público `publicQuote` deja de
  escribir en la cola (`escalatePending` eliminado del endpoint anónimo) y vuelve a ser read-only; el priming del
  catálogo (1.1) hace que el read casi siempre encuentre precio. **Acción (backend):** quitar la llamada a
  `escalatePending` de `buylist.service.ts` `publicQuote` (~:81-83); dejar la escalada solo en `createRequest`.
- **DEV-4 (backend/devops, v1.12-catalog-pricing) — el barrido `catalog-price-sync` corre in-process (memoria).**
  El refresco 2×/día reusa `runSyncAll` secuencial in-process (misma limitación DEV-1): si el proceso reinicia a
  media corrida, la siguiente corrida (o `sync-all` manual) reanuda. Aceptable interino (idempotente/reanudable);
  el objetivo robusto es encolar **un job BullMQ por set** (retry/persistencia de progreso). Registrar en
  `docs/TECH_DEBT.md` si se difiere. **Nota de escala:** `PriceReference` crece ~1 fila/día por (carta, acabado) del
  catálogo (~30–40k filas/día); considerar retención/particionado de la serie temporal en fase 2 (no bloquea el MVP).
  - **DIRIGIDO por WS-A (v1.14-price-ingest, §4.15).** El "objetivo robusto (un job BullMQ por set)" es exactamente el
    diseño del nuevo `price-ingest`/`price-ingest-set` (§4.15c): fan-out por set con cola persistida en Redis,
    aislamiento de fallos, reintentos y reanudabilidad. Al desplegar WS-A, el `catalog-price-sync` `force:true`
    (barrido fire-and-forget que motivó DEV-4) queda **deprecado en su rol de pricing** y se conserva solo para import de
    metadata de sets nuevos (`force:false`). **Acción (backend):** implementar `price-ingest` (§4.15c) y aligerar
    `catalog-sync` a metadata (§4.15g); (devops) repuntar el slot 2×/día al `price-ingest`.
- **DEV-5 (backend, v1.14-price-ingest) — `catalog-sync` escribe PRECIOS (rol que WS-A le retira).** `upsertCards`
  (`catalog-sync.service.ts`) llama `persistMarketReferences` y deriva `availableFinishes` de `tcgplayer.prices`
  (v1.12). WS-A mueve el **pricing y las variantes** al `price-ingest` (proveedor de paga, §4.15e/g): `catalog-sync`
  debe **quitar** `persistMarketReferences` (y las deps `PricingService`/`FxService`) y quedar en **solo metadata**;
  `deriveAvailableFinishes` se conserva como **bootstrap** (default seguro para sets recién importados) que el ingest
  sobre-escribe. `PricingService.persistMarketReference` se **generaliza** (aceptar `source`/moneda, hoy hardcodea
  `pokemontcg_io`+USD). No es un bug en producción hoy (funciona), pero **contradice la doctrina WS-A** de "catalog-sync
  = solo metadata" → se documenta y enruta a **backend**.

- **BE-25 — DIRIGIDO (parcial) por WS-E (v1.16-master-set, §4.17c).** El N+1 de settings en `fetchSellable`
  (`SALES_PRICE_RULES`+fallback leídos sin cache por ítem) se paga **mínimamente** dentro de WS-E: izar esas dos
  lecturas **una vez por request** + usar el nuevo `getReferencesBatch` en `fetchSellable`/`bulk-publish`. El resto de
  BE-25 (memoización global de `SettingsService`, familia BE-4/D3) sigue como deuda menor en `docs/TECH_DEBT.md`.
  **RB-8** (regla de valuación duplicada) se **cierra** al extraer `PricingService.getReferencesBatch` (§4.17c).
  **Acción (backend):** aplicar dentro de la entrega de WS-E; anotar el remanente en `docs/TECH_DEBT.md`.

- **BE-36 (backend, v1.16.1) — `isSecretRare` del binder marca TODOS los promos como secret rare.** La forma amplia
  `isSecretRare = numberSort > printedTotal` (§4.17a original) marca como secret rare **cualquier** carta empujada al
  final del orden, incluidos los promos/subsets con prefijo alfabético (TG/GG/SV), que **no** son secret rares sino un
  subset aparte. El contrato (v1.16.1) **afina** la definición como **heurística de display**: `true` **solo** para
  numeración principal (número puramente numérico) con entero `> printedTotal`; promos/subsets alfabéticos → `false`;
  `printedTotal` nulo → `false`. **Es solo un flag de presentación** (no afecta dinero, custodia ni completitud —
  `completionPct` usa `catalogCardCount`, WS-E-1). **Acción (backend):** alinear el cómputo de `isSecretRare` a la
  definición afinada (gate `number ~ '^[0-9]+$'` + `printedTotal` no nulo); registrar en `docs/TECH_DEBT.md` si se
  difiere (no bloqueante — es cosmético). Decisión de producto (default propuesto): subset por prefijo alfabético no
  cuenta como secret rare.

Fuera de estos puntos, el código revisado (M2, M6, M7, M9, M10, buylist, catalog, pricing) **concuerda** con
este documento y con `API_CONTRACT.md`.

---

## 10. Decisiones resueltas (antes "Preguntas para el humano")

### Supuestos abiertos (v1.23-sealed-sales — venta de producto cerrado) — confirmar con PO

- **SUP-1 (reconciliar `PROJECT.md` — el más importante):** este WS **supersede** dos decisiones vigentes: «sellado =
  precio manual del admin» (ahora `mercado TCGCSV × spread`, override de respaldo) y «la referencia TCGCSV es
  estrictamente informativa / no pública» (ahora base del precio y valor de mercado expuesto). Diseñado según el **spec
  cerrado del PO**; **product-owner** debe actualizar `PROJECT.md` para que mande sobre el contrato (regla de conflicto).
- **SUP-2 (condición no altera precio):** el spread es **por presentación**, no por condición; una caja
  `minor_box_damage` deriva el **mismo** precio que `mint` salvo **override** manual. ¿Se quiere un multiplicador por
  condición (p. ej. `minor_box_damage = −15%`)? Se puede añadir sin romper contrato. **Decisión propuesta: no** (usar
  override).
- **SUP-3 (naturaleza del spread):** el spread es `pct` (markup arriba de mercado) únicamente; no hay `fixed` de spread
  (el precio fijo se logra con override). Propuesta aceptada salvo objeción del PO.
- **SUP-4 (sellado en el portafolio general):** con `sealedMarketRef` ahora poblado, el sellado entra a la valuación y
  a la tendencia del portafolio general. **Propuesta: incluirlo** (es una holding priceada más); el snapshot ya suma
  `referenceValue` de holdings.
- **SUP-5 (identidad de grupo / producto agotado):** el grid agrupa por `tcgplayerProductId` (mapeado) o
  `cardId+subtype` (no mapeado) + condición; piezas mapeadas y no mapeadas del mismo producto podrían mostrarse como
  dos tarjetas → **mitigación: curar el mapeo**. El restock (agotados) usa `tcgplayerProductId` como identidad estable;
  una página de producto agotado debe ser direccionable (front, cuando se encienda el flag).
- **SUP-6 (defaults de spread):** propuesta `{box:18, etb:22, bundle:25, tin:30, blister:35}` y fallback `25` — el PO
  confirma los porcentajes de negocio.
- **SUP-7 (rollout money-safe):** para vender sellado por auto-spread hacen falta (1) items **mapeados** (§4.19c) y
  (2) `sealed_price_source = tcgcsv` **encendido** (§4.19e). Hasta entonces, el **override** manual es la única vía —
  retro-compatible con hoy, sin bloquear el arranque.
- **SUP-8 (spread cero):** el validador permite spread `≥ 0` (una promo a mercado es legítima); el editor M2 lo
  advierte. ¿El PO quiere forzar un piso `> 0`? Propuesta: no forzar.
- **SUP-IMP-C (RESUELTA por el arquitecto, v1.43 — NO requiere al humano) — el override manual sobrevive al dial `off`.**
  Aclara operativamente SUP-7: cuando el dial `sealed_price_source=off`, «el override manual es la única vía» incluye
  **dos** overrides manuales, y **ambos** funcionan con el dial off: el override de VENTA por pieza (`listPriceCents`,
  precedencia §K #1, precio verbatim) y el **override manual de MERCADO** (`PriceReference isManualOverride`, «FIJAR
  PRECIO», que alimenta `mercado × spread`, §K #2/#3). El dial gobierna **solo el ingest automático TCGCSV**; no gatea un
  override manual. Es **decisión técnica** (coherencia con §K, no de producto): §K ya declara el dial como perilla de la
  *fuente automática* y el override como máxima precedencia. **Refinamiento OPCIONAL para el humano/UX (no bloqueante):**
  hoy «FIJAR PRECIO» del operador fija un override de **mercado** (sujeto a spread), idéntico a lo que pasa con el dial
  `on`; si se quisiera que fijara el **precio de venta EXACTO** (sin spread) se enrutaría a `listPriceCents`. Propuesta:
  conservar el mecanismo vigente (coherente con dial `on`); abrir el refinamiento solo si el PO lo pide.

### Preguntas abiertas (v1.22-variantes-orden — variantes reales y orden natural)

- **v1.22-1 — ¿Y si el payload remoto no basta? — ✅ RESUELTA (2026-08-19, rama `fix/available-finishes-source`).**
  El caso se materializó: pokemontcg.io devolvió **502** toda la tarde y el set 2026 «Pitch Black» (120 cartas) quedó
  con **todas** en `['normal']` (§4.22d-4 con S1/S2 ciegas). **Decisión del humano, diseñada money-safe en §4.22g:
  opción (c) — tomar la señal de acabados de la fuente de PAGA (PPT)**, como **Señal C** de **evidencia positiva**
  (`market > 0` vía alias VERIFICADO ⇒ el acabado existe). **(⛔ v1.27, §4.25a: la Señal C ya NO compone
  `availableFinishes` — la unión quedó derogada, el precio confirma, nunca añade; esta resolución queda como registro
  histórico de v1.22-1.)** Es money-safe pese a §4.22a-regla 2 porque: (i)
  `availableFinishes` pasa a ser **derivada y RECOMPUTABLE** = `orderFinishes(catalogFinishes ∪ pricedFinishesSnapshot)
  || ['normal']` sobre dos columnas de entrada persistidas ⇒ **no monótona, reparable** con `sync --force` / siguiente
  corrida PPT; (ii) solo **alias VERIFICADO** alimenta la lista blanca (los SUPUESTO quedan fuera hasta S-C2); (iii)
  **anti-invención** (desconocido ⇒ se omite, nunca relleno); (iv) **un solo escritor** (`catalog.FinishReconciler`);
  `price-ingest` solo escribe su snapshot y llama al reconciliador. La regla 2 **sigue vigente en su núcleo** (precio
  AUSENTE ≠ variante inexistente ⇒ nunca se REMUEVE por falta de precio); lo que se admite es su **conversa** (precio
  PRESENTE ⇒ existe). **Requiere schema (migración M-27, dos columnas internas) — el contrato NO cambia de forma.**
  Opción **(a)** override manual del admin queda como **remedio permanente del residuo** (caso S-C1 falso, ver §4.22g);
  **(b)** `CardSet.hasReverseHolo` se **descarta** (decisión de producto + riesgo de inventar). Sigue prohibida toda
  **heurística por rareza**. **Punto que aún puede necesitar al HUMANO:** solo si la 1ª corrida revela **S-C1 falso**
  (PPT tampoco separa el reverse holo del set nuevo) — entonces no hay señal automática viable y la decisión de
  producto es cuánto invertir en el override manual (a) vs. esperar a la fuente. Backend debe **avisar al arquitecto**
  con el resultado de S-C1/S-C2 antes de dar por cerrado el rescate.
- **v1.22-2 — Casos borde del orden (`"23a"`, `number` vacío).** §4.22b los deja con la semántica **actual** de
  `compareByNumber` (bloque de promos / final del bloque numérico). ¿Se afinan? Propuesta del arquitecto: **no en este
  WS** (es cosmético y arriesga regresiones en el binder M1 ya aprobado); queda como deuda menor con dueño backend.
- **v1.22-3 — `PriceReference` de un finish fuera de `availableFinishes`.** Se decide **conservarlo** (dato inocuo,
  evidencia de drift) y solo loguearlo. Alternativa descartada por ahora: no persistirlo. Si el volumen de
  `finishNotInCatalog` resulta alto en la 1ª corrida, se revisa (dueño: arquitecto, a petición de backend).

### Preguntas abiertas (v1.21-guest-checkout — WS «Órdenes y dinero»)

> Ninguna bloquea el desarrollo: **todas tienen un supuesto implementado** y el modelo está diseñado para que
> cambiar la respuesta sea un ajuste acotado, **sin migración**.

- **v1.21-1 — Correo del invitado que YA tiene cuenta (la que PROJECT deja abierta, v1.5-1).** Implementado:
  **no se revela**, la compra procede como invitado y el pedido queda **sin vincular** hasta el **reclamo explícito**
  del titular con correo **verificado**. Es la única de las tres opciones que **no** reintroduce enumeración de
  usuarios ni permite ensuciar el historial de un tercero. **Punto de decisión acotado (§4.21f):** el modelo guarda
  `guestEmail` en el pedido y la vinculación es un `UPDATE` posterior de `userId`+`claimedAt`, así que pasar a
  *auto-vínculo al pagar* = poblar esos dos campos en el settle, y a *exigir login* = un check en el checkout.
  **Decisión del orquestador; revisable por el humano.**
- **v1.21-2 — Vigencia del enlace (PROJECT v1.5-2).** Implementado: **90 días** desde cada emisión, con **tope de
  edad de la orden de 365 días** para emitir nuevos (si no, el reenvío mantendría la puerta abierta para siempre).
  Cambiar a 30 días o a "X días tras entregado" es cambiar una constante.
- **v1.21-3 — Reenvío self-service (PROJECT v1.5-3).** Implementado: **sí**, con respuesta `202` neutra siempre,
  3/hora por IP, 5/día por pedido, y exigiendo `(email + orderNumber)` juntos cuando no se presenta un token.
  Existe además el reenvío **de soporte** (endpoint admin auditado). Si el humano prefiere "solo soporte", se
  desactiva el endpoint público sin tocar nada más.
- **v1.21-4 — `orderNumber` secuencial y legible.** Se elige `TCG-000123` con secuencia Postgres (patrón `folio`)
  porque los criterios 45/49/53/56b lo exigen para correos, soporte y disputas. **Filtra el volumen de ventas** a
  quien vea un número. La alternativa (número aleatorio no correlativo) es igual de barata si al humano le importa
  esa señal. **No da acceso a nada por sí solo.**
- **v1.21-5 — Tope comercial por pedido de invitado (PROJECT v1.5-5).** Hoy **no hay tope de monto** (solo el
  técnico de **20 líneas** por pedido, anti-abuso). Si el humano quiere limitar exposición a contracargos, entra
  como constante/dial sin cambio de contrato.
- **v1.21-6 — Disputa de invitado sin fila `Dispute` (§4.21f).** Implementado: correo a soporte + **reembolso en
  M3**. Coste: no aparece en la cola de M8 ni en métricas de disputas. **Deuda propuesta** (que el techlead enrute
  si la considera): `Dispute.userId` nullable + `orderId`.
- **v1.21-7 — Retención de datos del invitado no reclamado (PROJECT v1.5-7, sin supuesto).** El pedido guarda
  correo, teléfono y dirección de una persona **sin cuenta**, en claro (mismo régimen que `User.email`; el cifrado
  en reposo de §3.4 está reservado a CLABE/RFC/INE). **Depende de la postura legal**, no de la técnica: cuando el
  humano fije el plazo, la implementación natural es un job que **anonimiza el snapshot y el `guestEmail`** de
  pedidos entregados hace más de N días, **conservando** los montos e IVA para M7. Se deja anotado porque afecta
  también a "solicitud de borrado" (bandera de privacidad de PROJECT).
- **v1.21-8 — Idioma del correo (PROJECT v1.5-8).** Implementado: `Order.locale` capturado en el checkout, default
  `es`.

### Preguntas abiertas (v1.20-master-set-everywhere — WS «Inventario y vault»)
> No bloquean el diseño (defaults propuestos y **normados en el contrato**); se listan para veto/ajuste del humano.
- **WS-IV-1 — ¿Qué `productType` cubre una casilla? — RESUELTA PARCIALMENTE (v1.42, BLOQ-3):** `productType='sealed'`
  **NO** cubre ni cuenta en el binder (se EXCLUYE en los 4 scopes; alinea con H9; mandato explícito del humano de matar
  «Tropius»). `graded` **sigue contando** (un slab es una copia real del single de esa `cardId`). El sub-caso «¿graded
  llena la casilla de la raw?» **permanece abierto** (default histórico: sí cuenta). Ver §4.20b.
- **WS-IV-2 — `buyable` — RESUELTA PARCIALMENTE (v1.42, BLOQ-3b):** `buyable` resuelve **solo singles**
  (`productType ∈ {raw, graded}`); **sellado EXCLUIDO** (ya no ofrece un ETB para llenar la casilla de un single). Entre
  singles se deja **abierto** (el cliente ve la opción más barata: raw o graded). Ver §4.20d.
- **WS-IV-3 — `encontrada` con costo por aportación (default `aportacion_en_especie`, 70%).** ¿Correcto que una
  pieza hallada en el levantamiento se cargue como aportación en especie del dueño (afecta P&L/base de costo), o
  debe pedirse `acquisitionType` explícito siempre? Default: `aportacion_en_especie` si se omite.
- **WS-IV-4 — Índice de cliente solo con sets con ≥1 pieza.** ¿Se desea un toggle "ver todos los sets del
  catálogo" en el índice (iii)? Hoy el binder de cualquier set ya es accesible por `:setId`; el índice filtrado
  evita listar cientos de sets vacíos. Default: solo con piezas.

### Preguntas abiertas (v1.19-sealed-tcgcsv — referencia de mercado del sellado vía TCGCSV)
> No bloquean el diseño (defaults conservadores que preservan PROJECT 3e tal cual). Las dos primeras tocan PROJECT.md
> (fuente de precio del sellado / dinero), así que el arquitecto **no** las asume (CLAUDE.md — regla de conflicto).
- **v1.19-1 — ¿Mostrar la referencia TCGCSV en la ficha PÚBLICA del sellado?** PROJECT (criterio 2/3e) define la fuente
  del sellado como "precio manual del admin"; hoy la ficha pública del sellado no muestra "valor de mercado" aparte.
  Default v1.19: **NO** (la referencia es solo back-office). Si el humano quiere mostrarla como "valor de mercado" del
  sellado (paridad con singles), es un cambio de PROJECT + contrato público (versión futura).
- **v1.19-2 — ¿Costo de aportación en especie del sellado contra la referencia TCGCSV?** Hoy el costo del sellado
  aportado usa la referencia manual (`gradeKey='sealed'`) o escala. Usar TCGCSV automatizaría "referencia del día × %"
  (PROJECT §G) también para sellado, pero **mueve dinero (P&L)** → default v1.19: **NO cambia**; decisión del humano.
- **v1.19-3 — ¿Sugerencias asistidas de mapeo?** La curación v1.19 es 100% manual (explorador + asignación). Un
  asistente de sugerencia por similitud de nombre/set (sin auto-commit; el admin siempre confirma) es un nice-to-have
  de fase 2. Default: manual puro.
- **v1.19-4 — ¿Quién cura el mapeo?** Default: **`super_admin`** (es configuración de pricing, dominio M2). Alternativa:
  permitir a `vault_operator` mapear durante el alta M1 (no toca dinero directamente; la referencia es informativa).
  Confirmar si se relaja.

### Preguntas abiertas (v1.16-master-set — WS-E: Master Set + inventario a escala)
> No bloquean el diseño (defaults propuestos por el arquitecto). **Dos tocan una ambigüedad de PROJECT.md** (WS-E-1/2):
> PROJECT §F/M1 pide "vista Master Set… cantidad por carta/acabado / completitud" pero **no define** contra qué se mide
> la completitud ni qué inventario cuenta. El arquitecto **no asume** la regla de negocio (CLAUDE.md); propone default y
> lo señala al humano.
- **WS-E-1 — Denominador de la completitud.** `completionPct` = cartas distintas que tenemos / **total del set**. Pero
  "total del set" es ambiguo: `printedTotal` (nominal, sin secret/hyper rares) **o** `catalogCardCount` (todas las
  cartas del catálogo del set, incluidas las > printedTotal). Default propuesto: **`catalogCardCount`** (nunca da >100%;
  el `printedTotal` se expone aparte para el label "X / printedTotal"). ¿Confirma, o la completitud debe medirse contra
  `printedTotal` (y las secret rares cuentan como "extra")?
- **WS-E-2 — Qué inventario cuenta como "on-hand".** Default propuesto: `ownerType='platform'` **y** `status NOT IN
  (withdrawn, shipped, delivered, lost, damaged)` (lo que físicamente tenemos en bóveda de plataforma). ¿Se incluye
  también la custodia de clientes (`customer_custody`) en el Master Set, o el binder es **solo** stock de plataforma
  (recomendado, es back-office de inventario propio)? ¿`reserved`/`in_custody` cuentan como on-hand? Confirmar.
- **WS-E-3 — `qty` en el alta por lote.** Propuesta: `qty` (default 1) expande a N piezas para **bulk raw/sellado**;
  `graded` fuerza 1 (cada slab es único por `certNumber`). Es un atajo de captura, **no** cambia el modelo por-pieza (se
  crean N `InventoryItem` reales). ¿Se desea `qty`, o el carrito manda siempre 1 línea = 1 pieza (más explícito)?
- **WS-E-4 — Cap del lote (200) e idempotencia.** Cap propuesto **200** líneas/lote (constante de servidor) e
  idempotencia con `InventoryBatch` (nuevo modelo, M-21) que además **es** la auditoría del lote. Alternativa: cap como
  dial M10; idempotencia solo por header sin persistir (más frágil). Default: constante + `InventoryBatch`. Confirmar.
- **WS-E-5 — `numberSort` para números no-numéricos.** `Card.number` incluye promos/subsets (`TG12`, `GG01`, `SV107`).
  Propuesta: ordenar por parte numérica ascendente, con los no-numéricos-puros **al final** agrupados por prefijo. Es un
  orden de presentación (no de negocio); si el dueño quiere otro criterio (p. ej. subsets `TG` intercalados), se ajusta.

### Preguntas abiertas (v1.15-buylist-batch-clabe — WS-C: cotizador de Fable contra el backend real)
> No bloquean el diseño (defaults propuestos por el arquitecto); se listan para que el orquestador/humano vete o ajuste.
- **WS-C-1 — Naming del batch quote.** Propuesta: endpoint **NUEVO** `POST /buylist/quote/batch` conservando el
  por-carta `POST /buylist/quote` (aditivo, no-breaking). El pedido original nombraba `POST /buylist/quote` con
  `items[]` (overload). El arquitecto **elige el endpoint nuevo** para no romper el consumidor por-carta y por claridad
  de errores por-ítem. Si se prefiere el overload exacto (breaking, con el frontend migrado en la misma entrega), el
  orquestador lo indica.
- **WS-C-2 — ¿`qty` en el cotizador?** El modelo actual es **una línea por carta física** (sin `qty`). El batch espeja
  ese modelo (sin `qty`). Si el humano quiere cotizar/vender **N copias idénticas en una sola línea**, es un cambio de
  producto (afecta `SellRequestItem`, conversión a inventario 1-a-1 y topes AML) — **no se asume**. ¿Se desea `qty`?
- **WS-C-3 — Cap del batch (`BUYLIST_QUOTE_BATCH_MAX = 50`).** Constante de servidor propuesta (cubre el `pageSize` 20
  del grid con holgura). ¿Debe ser un dial M10 configurable en vez de constante? Default: constante (menos superficie).
- **WS-C-4 — Código `422 CLABE_REQUIRED`.** Nuevo código para "ni en request ni en archivo". Alternativa: reusar
  `422 CLABE_INVALID`. Propuesta: **código propio** (`CLABE_REQUIRED`) para que el front distinga "falta CLABE" de
  "CLABE malformada" y enrute a capturar/registrar CLABE. Confirmar el código.

### Preguntas abiertas (v1.14-price-ingest — WS-A: ingesta masiva vía proveedor de paga)
> No bloquean el arranque del **diseño**: backend puede construir la interfaz `BulkPriceProvider`, el job
> `price-ingest`/`price-ingest-set` y aligerar `catalog-sync` con los defaults propuestos. **Varias requieren
> verificación en RUNTIME (1ª corrida en Railway)** — el arquitecto **no asume** el esquema del proveedor (CLAUDE.md).
> **Toca dinero → validar antes de confiar el pricing al proveedor de paga.**
- **v1.14-1 (RUNTIME, crítica) — esquema exacto de `POST /cards/bulk-price`.** Campo de **acabado/variante**, de
  **precio** (`market`) y de **moneda** (¿USD o MXN?; ¿nombre del campo?). Default de diseño: `market` en **USD**,
  variante mapeada por tabla conservadora; **variante desconocida → OMITE**; moneda ausente → **asume USD** (proveedor de
  mercado US). **Se confirma en la 1ª corrida** (`POST /admin/jobs/price-ingest` con `setId?` conocido → inspeccionar
  `PriceReference`). Riesgo money: si en realidad fuera MXN, la conversión USD→MXN inflaría ~18× → **gate** antes del flip.
- **v1.14-2 (devops/negocio) — cuota/coste del plan del proveedor de paga.** ¿Límite de requests/día o de cartas del
  plan contratado? El bulk por set reduce ~100× las requests vs per-carta, pero un refresco 1–2×/día del catálogo
  completo (~160 sets) son ~cientos de requests/día. Confirmar plan/cuota y si `POKEMONPRICETRACKER_API_KEY` debe ser
  *required* en prod (recomendado cuando `PRICE_PROVIDER=pokemonpricetracker`).
- **v1.14-3 (devops) — cadencia y horarios del `price-ingest` (1–2×/día).** Default propuesto: **2×/día** alineado con
  el `fx-refresh` (FX fresco antes de convertir). ¿Confirmar horas? ¿1×/día basta para el negocio? Scheduling = **devops**.
- **v1.14-4 (rollout, money-safe) — seed del dial `PRICE_PROVIDER`.** Default recomendado: **`pokemontcg_io`** al
  desplegar (sin cambio de fuente; el job ya es robusto) y **flip a `pokemonpricetracker`** tras verificar v1.14-1.
  Alternativa: sembrar `pokemonpricetracker` desde el arranque (la key ya está en Railway). Confirmar la secuencia.
- **v1.14-5 (alcance) — ¿el proveedor de paga precia también GRADEADAS (PSA) en WS-A?** La respuesta bulk trae eBay/**PSA**.
  WS-A se acota a **raw market + variantes** (`raw:NM`, el barrido que hoy se cae). Preciar gradeadas (`graded:PSA:<grade>`)
  con el mismo proveedor es una **extensión natural** (misma respuesta bulk) pero **fuera del core de WS-A**; queda como
  puerta abierta (§0). Confirmar si se quiere en esta entrega o después.
- **v1.14-6 (correctness FX, #13) — vía del colchón-solo.** Default recomendado: guardar el colchón por `PUT
  /admin/settings { fxBufferPct }` (parcial, ya soportado) + hacer que `FxService.getCurrent()` prefiera el `bufferPct`
  del **dial** en todas las ramas (para que aplique de inmediato). Alternativa: `rate?` opcional en `PUT /admin/fx`.
  Confirmar cuál adopta el equipo (ambas son money-safe; la primera no cambia el contrato de FX).

### Preguntas abiertas (v1.13-sales-pricing — Fase 2 del epic de precios)
> No bloquean el arranque: backend puede implementar 2.1–2.4 y frontend 2.5 con los defaults propuestos (que
> **preservan el precio de venta actual** para las rarezas de fallback). El arquitecto **no asume** reglas de negocio
> (CLAUDE.md). **Requieren confirmación del humano:**
- **v1.13-1 — % exacto de venta para raras (fallback y por rareza).** Default propuesto: **`SALES_PRICE_FALLBACK_PCT =
  15`** (= `SALES_MARKUP_PCT` legacy ⇒ venta = market × 1.15, preserva el negocio actual). El humano puede querer un %
  distinto (más agresivo para chase) y/o **valores por rareza** (ej. Illustration Rare 25%, Secret Rare 40%). ¿Confirma
  15% de fallback? ¿Quiere sembrar %s por rareza desde el arranque, o los ajusta luego en M2 sin deploy?
- **v1.13-2 — Rango del validador de `pct` de venta.** El `pct` de venta es **markup arriba de mercado** (puede >100%,
  a diferencia de buylist que topa en 100%). Default propuesto: **`SALES_PCT_MAX = 1000`** (0..1000% = hasta 11×
  market; ancla un tope anti-typo). Alternativas: **sin tope superior** (paridad con el `SALES_MARKUP_PCT` legacy que
  era `>= 0`) o un tope más bajo (p. ej. 300%). Confirmar el tope.
- **v1.13-3 — ¿Retirar `SALES_MARKUP_PCT` ya, o conservarlo deprecado?** Default propuesto: **conservar el dial
  deprecado** un release (palanca de rollback; la ruta de venta ya no lo lee) y retirarlo (junto con la pura
  `computeSalePriceCents` y el campo M10 `salesMarkupPct`) en un follow-up. Alternativa: **retirarlo en esta entrega**
  (quitar del `SETTING_DTO_MAP`/M10View). Confirmar. *(Si se retira, el frontend de M10 pierde el campo — coordinar.)*
- **v1.13-4 — Piso `fixed` sin market habilita venta de bulk.** Con reglas `fixed`, una carta bulk **sin** referencia
  de mercado ahora obtiene `salePriceCents` (piso $5/$10) y puede volverse `sellable`. Es coherente con el ejemplo del
  humano (pisos de bulk), pero **cambia** qué inventario es publicable respecto a hoy (hoy sin market = no vendible).
  Default propuesto: **permitirlo** (es el objetivo del piso). Confirmar que el dueño lo quiere así (o si prefiere que
  el piso solo aplique cuando el item está `listed` explícitamente por el admin).

### Preguntas abiertas (v1.12-catalog-pricing — Fase 1 del epic de precios)
> No bloquean el arranque: backend puede implementar 1.1/1.2 y el job 1.3 con los defaults propuestos; frontend
> puede hacer 1.4 ya. El arquitecto **no asume** reglas de negocio (CLAUDE.md). **Requieren confirmación del humano:**
- **v1.12-1 — Horarios exactos del refresco 2×/día.** Default propuesto: **06:00 y 18:00 CDMX** (= crons UTC
  `0 12 * * *` y `0 0 * * *`; CDMX = UTC−6 sin DST). ¿Confirmar esas horas, o prefiere otras (p. ej. madrugada para
  menor carga)? Scheduling = dueño **devops**.
- **v1.12-2 — ¿El refresco 2×/día re-fetchea TODO el catálogo, o algo incremental?** Default propuesto: **re-sync
  completo** (`sync-all force:true`) — es simple, el precio viaja embebido en la carta y con API key la cuota alcanza
  (~cientos de req × 2/día). Alternativa (más ligera, más compleja): refrescar solo sets recientes / escalonar sets
  entre corridas / refrescar por prioridad (bóveda + sets destacados primero). Confirmar si basta el full o se quiere
  incremental.
- **v1.12-3 — On-demand en el cotizador público: ¿sí o no?** Default propuesto (y recomendado): **NO** — `publicQuote`
  read-only, la frescura la da el job + catalog-sync (1.1/1.2). Esto **cierra BE-16** y el punto v1.3-1. Confirmar
  (si el humano quiere on-demand para un set recién salido aún no sincronizado, se acotaría al flujo **autenticado**
  `createRequest`, nunca al quote anónimo).
- **v1.12-4 (operativo, devops) — API key / plan de pokemontcg.io.** El refresco 2×/día del catálogo completo
  **requiere `POKEMONTCG_IO_API_KEY`** para la cuota (~20k req/día); sin key el free tier puede toparse. Confirmar que
  la key está aprovisionada en staging/prod. El plan de pago **no** es necesario para Fase 1 (el `PricingProvider`
  intercambiable permite subir después sin tocar el resto).

### Preguntas abiertas (v1.3 — Cotizador Opción 1)
> No bloquean el arranque del trabajo (backend puede implementar `GET /buylist/cards`, `GET /buylist/sets` y
> `POST /admin/catalog/sync-all` ya). El arquitecto **no asume** reglas de negocio (CLAUDE.md).
- **v1.3-1 — ¿pricing on-demand del cotizador para `ex_plus` fuera de bóveda?** Hoy una carta `ex_plus` del
  catálogo completo sin `PriceReference` sale `precio_pendiente` (coherente con PROJECT criterio 13). ¿El
  humano quiere que el cotizador dispare un **fetch puntual** al `PricingProvider` en el momento de cotizar
  (mejor UX, pero consume cuota del free tier fuera de la bóveda y puede tentar abuso del endpoint público)?
  **Default propuesto (MVP):** **no** priciar on-demand; mantener `precio_pendiente` + escalado al dueño.
  **RESUELTO por Fase 1 (v1.12-catalog-pricing, §4.13a/b):** el catálogo completo se precia durante el `catalog-sync`
  (1.1), así que el quote ya encuentra precio sin fetch on-demand; además `publicQuote` pasa a read-only (1.2). Se
  confirma el default "no on-demand". Ver pregunta v1.12-3.
- **v1.3-2 — Búsqueda pública sobre todo el catálogo: ¿rate-limit / anti-scraping?** `GET /buylist/cards` es
  público y consulta la tabla `Card` completa. Recomendación técnica (no de negocio): aplicar rate-limit por
  IP y `pageSize` acotado (≤100). Confirmar si se quiere además exigir sesión (`customer`) para reducir
  scraping del catálogo. **Default propuesto:** público con rate-limit; sin sesión obligatoria.

### Preguntas abiertas (v1.5-auth-email — verificación de correo + recuperación)
> No bloquean el arranque: backend puede implementar el módulo `mail`, el modelo `AuthToken` (M-17), los
> endpoints y el `EmailVerifiedGuard` con los defaults propuestos. El arquitecto **no asume** reglas de negocio.
- **v1.5-1 — ¿Exigir `RESEND_API_KEY` en staging (además de prod)?** Default propuesto: **sí** (staging es
  no-local → key dura, para probar el flujo real E2E; degradación Noop solo en LOCAL_ENVS). Confirmar.
- **v1.5-2 — Dominio remitente vs soporte. (CERRADA 2026-08-16)** El humano confirmó el dominio canónico único
  `tcgvaultmx.com`: `MAIL_FROM` = `no-reply@**tcgvaultmx.com**` y soporte de disputas = `soporte@**tcgvaultmx.com**`
  (**mismo dominio**, ya no hay inconsistencia). Pendiente operativo (no de arquitectura): verificar SPF/DKIM/DMARC
  en Resend para `tcgvaultmx.com` (nota devops).
- **v1.5-3 — ¿El reset exitoso marca `emailVerified=true`?** Default propuesto: **sí** (clic en el link de reset
  prueba control del inbox). Si el humano prefiere separar ambos conceptos, se deja `emailVerified` intacto en el
  reset. Confirmar.
- **v1.5-4 — Reenvío de verificación: ¿autenticado (recomendado) o público por email?** Default propuesto:
  **autenticado** (`customer+`, usa `req.user`) → cero enumeración. Alternativa (público `{ email }` + siempre
  `200`) añade superficie de abuso; no se adopta salvo que el humano lo pida.
- **v1.5-5 — ¿Gating adicional?** Hoy se bloquean solo las **mutaciones** de comprar/retirar/vender. ¿El humano
  quiere bloquear también algo más (p. ej. guardar CLABE/INE en KYC, o `request-invoice`)? Default: **no** — solo
  las tres acciones listadas; el resto queda navegable con banner. Confirmar si se amplía.
- **v1.5-6 — Cuentas de staff.** `vault_operator`/`super_admin` deben sembrarse `emailVerified=true` (no reciben
  correo de verificación al no registrarse por el flujo público). Nota para devops/seed; confirmar que el seed lo hace.

### Decisiones ya resueltas
Las 6 ambigüedades quedaron resueltas por el humano (2026-08-13) y se integran como decisiones firmes en este documento y en el contrato. Se conservan aquí como registro.

1. **Precio de venta = referencia del día + MARKUP configurable (dial M10).** El **valor de mercado** que se muestra es la **referencia** (`priceMxnCents` de `PriceReference`). El **precio de venta** es `round(referenciaMxn × (1 + salesMarkupPct/100))`. `salesMarkupPct` es un dial de M10 (`sales_markup_pct`). Se persiste como `InventoryItem.listPriceCents` al listar (o se calcula al vuelo si null) y se congela en `OrderItem.unitPriceCents` al checkout. En los DTOs se distingue `referenceValue` (valor de mercado) de `salePrice` (precio de venta). El override manual de precio puede fijar directamente el `listPriceCents` sin aplicar markup. **Actualización v1.13-sales-pricing (Fase 2, §4.14):** el **markup GLOBAL único** (`salesMarkupPct`) se **reemplaza** por una **tabla de regla por rareza** (`SALES_PRICE_RULES` + `SALES_PRICE_FALLBACK_PCT`): venta = piso `fixed` (MX$) o `market × (1 + pct/100)` (pct = markup ARRIBA de mercado). El markup global queda **deprecado** (palanca de rollback). El resto de esta decisión (referencia vs venta, congelar en `OrderItem.unitPriceCents`, override manual) **no cambia**.
2. **Fee de procesamiento Stripe = GROSS-UP.** El fee trasladado se calcula para que, tras la comisión de Stripe (tarifa MX **más el IVA que Stripe cobra sobre su comisión**), la plataforma reciba **íntegro** `subtotal + IVA`. Fórmula vigente (ver §5.1, refinada por el hallazgo C1): `total = (base + (1+stripeFeeIvaPct)·fija) / (1 − (1+stripeFeeIvaPct)·pct)`, `fee = total − base`, donde `base = subtotal + IVA`. Se persiste en `Order.processingFeeCents` y es una línea visible del `BreakdownDTO`. El fee **no** lleva IVA de **producto** adicional.
3. **IVA 16% sobre `subtotal + envío`.** El IVA grava el subtotal de cartas **y** la tarifa de envío (servicio gravado). El **fee de procesamiento va tal cual (sin IVA)**. Default a validar con contador. En compras de carrito el `ivaCents = round((subtotal) × ivaPct/100)`; en retiros `ivaCents = round(shippingFee × ivaPct/100)`.
4. **CFDI sin PAC en el MVP.** No se integra PAC ni se timbra en el MVP. El flujo de factura es **manual por correo**: la UI muestra la instrucción de que, para pedir factura, el cliente envíe un correo con sus datos fiscales. El sistema guarda el **IVA cobrado por orden** (M7) y un flag `invoiceRequested` (opcional) por orden. **Timbrado real = fase 2.** `CfdiStatus` se reduce a `registrado | no_aplica` en MVP (`emitido` queda reservado para fase 2).
5. **FX USD→MXN automático (Banxico) + colchón + override manual.** Job diario `fx-refresh` obtiene el tipo de cambio de una fuente tipo **Banxico** (SIE), aplica el **colchón** (`fx_buffer_pct`, dial M10) y escribe `FxRate` (`source=banxico`). Si el fetch falla o el admin fija un override, se usa `FxRate` con `source=manual` (dial M10) como fallback; el override tiene prioridad sobre el valor automático del mismo día.
6. **Cobro del envío por Stripe ANTES de generar la solicitud de retiro.** El retiro cobra la tarifa fija (+ IVA) vía `PaymentIntent` de Stripe; la `ShipmentRequest` se crea en `solicitado` con el `PaymentIntent` asociado y solo se procesa (picking) una vez liquidado (webhook `payment_intent.succeeded`). No hay wallet.

---

## 11. Migraciones requeridas (v1.1 + v1.2/v1.2.1 + v1.3.1 — 2026-08-16)

Cambios de esquema Prisma que backend debe migrar. Proyecto **greenfield sin backfill de datos** (aún no hay filas productivas); las migraciones solo redefinen esquema.

> **v1.43-sealed-manual-override-survives-dial (IMP-C) — SIN migración.** El fix es lógica pura en `gateSealedMarketCents`
> (resolver H-1); no toca schema, ni `ConfigSetting`, ni forma de contrato. El discriminante del override manual ya vive
> en `PriceReference` (`isManualOverride` / `source='manual'`). No hay DDL ni seed. Ver §4.23a y §9 (IMP-C).

### v1.37-pricing-tiers (nueva — M-38: pricing por tiers — DATA/seed, SIN DDL, P-34)

⚠️ **`backend/prisma/` y `backend/src/common/` son ZONA COMPARTIDA:** el orquestador serializa **M-38** frente a
cualquier otro stream que toque schema/común. **No hay DDL de Prisma** (ni tablas, ni columnas, ni enums, ni `DROP`):
tiers/mapa/reglas son **DATO en `ConfigSetting`** (§4.33b). M-38 es una **migración de datos/seed + un delta de código
en `common/`** (constantes y catálogo canónico), que backend implementa como script de seed/data-migration idempotente.
Segura con la app corriendo (los dos shapes de reglas conviven on-read, §4.33c). Spec en §4.33.

| # | Artefacto | Cambio | Tipo | Nota |
|---|---|---|---|---|
| M-38 | `common/pricing-tiers.ts` (NUEVO) | Constante `PRICING_TIERS` (5 tiers T0–T4 + `TierId`) | Código (común) | Taxonomía LOCKED, no editable por el dueño (§4.33a). Sin infra, importable desde seeds/tests. |
| M-38 | `common/rarity-catalog.ts` | +1 alias (`Hyper Rare` ← `megahyperrare`) y +2 canónicas premium (`Mega Rare`, `Black White Rare`) | Código (común) | Cierra las 3 `unmapped` de §M.3 (§4.33e). Corrige el money-losing de `MEGA_ATTACK_RARE`/`Black White Rare`. |
| M-38 | `ConfigSetting['pricing_tier_map']` (NUEVO `SettingKey`) | Seed del mapa `Record<canonical, TierId>` (M.2 + 2 canónicas nuevas) | Data/seed | Mapa COMPARTIDO compra+venta (§4.33b). Rareza ausente ⇒ fallback (money-safe). |
| M-38 | `ConfigSetting['buylist_price_rules']` | RESHAPE `{ rarityRules, finishRules, fallbackPct }` → `{ tierRules, finishRules, fallbackPct }` | Data-migration | `tierRules` (5 entradas) reemplaza `rarityRules`; `finishRules`/`fallbackPct` intactos. Seed buy: T0 f50, T1 f150, **T2 pct25 (cambio LOCKED)**, T3 pct40, T4 pct40. |
| M-38 | `ConfigSetting['sales_price_rules']` | RESHAPE análogo con `SalesRule` | Data-migration | Seed sell: T0/T1 = pisos fijos vigentes de Common/Uncommon; T2/T3/T4 = pct 15 (fallback de venta vigente). Backend confirma pisos exactos contra el setting productivo. |
| M-38 | `Card.rarityCanonical` (columna ya existe, M-31) | **Backfill** de filas con raw `MEGA_ATTACK_RARE` / `Black White Rare` / `Mega Hyper Rare` | Data-backfill | `= normalizeRarity(raw)` con el catálogo ya extendido ⇒ pasan de pass-through `unmapped` a su canónica premium ⇒ resuelven por T3/T4. Sin cambio de columna. |

> **Compat / reversibilidad:** `buildEffectiveRuleSet` (§4.33c) solo aplica cuando la clave trae `tierRules`; si un
> deploy revierte, el shape `rarityRules` sigue siendo válido para el resolver de §4.28d. No hay ventana ciega ni riesgo
> de $0 (rareza sin regla → fallback pct en ambos shapes). El **barrido completo de otras `unmapped`** (§4.33g) es
> tarea de implementación posterior con la política fijada.

### v1.36-sealed-alta (nueva — M-37: alta dedicada de sellado con imagen de API, P-35)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa **M-37** frente a cualquier otro stream que toque
el schema. Es **aditiva pura** (tres columnas nuevas nullable; sin tablas, sin enums, sin `DROP`, sin backfill):
filas viejas quedan con las tres en `null` (retrocompatible; el display cae a la `Card` ancla y la resolución de grupo
cae al fallback por hermanos mapeados). Segura con la app corriendo. Las columnas de **mapeo** que el alta puebla
(`InventoryItem.tcgplayerProductId`/`tcgplayerGroupId`) **ya existen** (M-23). Spec en §4.32.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-37 | `CardSet.tcgcsvGroupId Int?` | Columna nueva nullable | Add column | Grupo TCGCSV curado por set. Resuelve `GET /admin/inventory/sealed-catalog` (set → productos sellados de la API). `null` ⇒ fallback: `DISTINCT tcgplayerGroupId` de items sellados ya mapeados del set (§4.32b). Solo lectura de catálogo; jamás fija precio. |
| M-37 | `InventoryItem.sealedImageUrl String?` | Columna nueva nullable | Add column | URL de imagen del producto sellado **desde la API** (TCGCSV/TCGplayer), capturada al alta. Solo `productType='sealed'` (regla de aplicación). Display-only, money-safe. `null` ⇒ fallback a la imagen de catálogo de la `Card` ancla. Arregla que el sellado muestre la **caja** y no el single ancla en Compra/bóveda/M1. |
| M-37 | `InventoryItem.sealedProductName String?` | Columna nueva nullable | Add column | Nombre del producto sellado desde la API (TCGCSV `name`/`cleanName`). Solo `productType='sealed'`. Display-only. `null` ⇒ fallback a `Card.name` (ancla). |

> **Sin cambios** en enums ni en las columnas de mapeo (M-23 ya las deja listas): el alta P-35 solo las **puebla**.
> El refactor mayor —una **entidad `SealedProduct` de catálogo** llaveada por `tcgplayerProductId` (nombre/imagen/
> subtipo/setId propios, con `InventoryItem.sealedProductId`)— queda **DIFERIDO** y se documenta como **SB-D5** en
> `docs/TECH_DEBT.md` (§4.32d): resolvería de raíz el ancla-a-single, pero es una tercera taxonomía con sync propio
> que toca M-23/M-25/M-26/M-28; **fuera de alcance** de este cambio. **➡ Ejecutado en M-39 (v1.39, P-38).**

### v1.39-sealed-product-module (nueva — M-39: entidad `SealedProduct`, cura de raíz de SB-D5, P-38)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador **serializa M-39**. Es **aditiva y reversible** (dos tablas
nuevas + una columna FK nullable + dos valores de enum; sin `DROP`, sin backfill destructivo). Segura con la app
corriendo. Backfill money-safe (pasos §4.34e): siembra `SealedSetGroup` desde `CardSet.tcgcsvGroupId`, deriva
`SealedProduct` de los items sellados **mapeados** y liga `InventoryItem.sealedProductId` (cura el ETB→Tropius); los
sellados **sin** mapeo quedan `sealedProductId=null` para re-curar (cero adivinación). Spec en §4.34.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-39 | `enum SealedSubtype += upc, collection` | Add enum values | `ALTER TYPE ADD VALUE` | `upc` = Ultra Premium Collection (hueco 2). `collection` = colecciones/cajas especiales. Aditivo; ningún valor existente cambia. |
| M-39 | `enum SealedGroupKind { set_main, promo_collection }` | Enum nuevo | Create type | Tipo de grupo TCGCSV asociado a un set: principal vs promo/colección (§4.34b). Reusado por `SealedSetGroup.kind` y `SealedProduct.origin`. |
| M-39 | `SealedSetGroup` | Tabla nueva | Create table | Enlace **1 set → N grupos** TCGCSV. `{ id, setId FK, tcgplayerGroupId, kind, label? }`, `@@unique([setId, tcgplayerGroupId])`, index `setId`. Fuente de verdad de los groupIds del set (Mega Evolution/promos incl.). |
| M-39 | `SealedProduct` | Tabla nueva | Create table | Catálogo de presentaciones selladas por set (identidad propia). `{ id, setId FK, tcgplayerProductId @unique, tcgplayerGroupId, name, cleanName?, subtype, subtypeInferred, isPrincipal, origin, imageUrl?, marketUsdCents?, marketUpdatedAt?, active }`. Money-safe: `marketUsdCents` null cuando TCGCSV no trae precio, jamás 0. |
| M-39 | `InventoryItem.sealedProductId String?` | Columna nueva nullable (FK) | Add column | FK → `SealedProduct` (`onDelete: SetNull`), index. **Identidad** del sellado (reemplaza el ancla-a-single). Solo `productType='sealed'` (regla de aplicación). Las columnas M-23/M-37 se conservan como **snapshot** por-pieza. |
| M-39 | `CardSet.tcgcsvGroupId` | **Se conserva** (no drop) | — | Denormalización del grupo `set_main`; fuente de verdad pasa a `SealedSetGroup(kind=set_main)`, el sync mantiene ambos. |

> **Backfill (data, no DDL):** (6) `SealedSetGroup(set_main)` desde cada `CardSet.tcgcsvGroupId != null`; (7) `SealedProduct`
> por cada `(tcgplayerProductId, tcgplayerGroupId)` distinto de items sellados **mapeados** + `UPDATE InventoryItem.sealedProductId`
> (cura ETB→Tropius); (8) sellados **sin** mapeo → `sealedProductId=null` + reporte de reconciliación. Ver §4.34e.

### v1.42-sealed-identity-everywhere (nueva — M-40: identidad de sellado en la cola de precio pendiente, BLOQ-2b)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador **serializa M-40**. Es **aditiva y reversible** (una columna
FK nullable; sin `DROP`, sin backfill). Segura con la app corriendo. Las columnas de conteo del binder (BLOQ-3) y los
campos de display de `HoldingDTO` (BLOQ-2a) **NO requieren migración** (son filtros de agregación y proyección en lectura,
reusando `InventoryItem.sealedProductId`/snapshot M-37 ya existentes). Solo la cola persistida `PendingPriceEntry` migra.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-40 | `PendingPriceEntry.sealedProductId String?` | Columna nueva nullable (FK) | Add column | FK → `SealedProduct` (`onDelete: SetNull`), index. **Identidad de sellado** que ENTRA a la clave lógica de dedup/escalada de la cola: dos pendientes con igual `(cardId, gradeKey, finish)` y distinto `sealedProductId` son SEPARADAS (ETB ≠ blíster; antes colapsaban bajo `gradeKey='sealed'`). Solo `productType='sealed'` (regla de aplicación). `null` para singles y para sellado legacy sin ligar. Money-safe: sin precio ⇒ pendiente, JAMÁS 0. `sealedProductName`/`sealedSubtype` del DTO se DERIVAN (join cascada §4.34a), no se persisten aquí. |

> **Sin backfill obligatorio:** las entradas `open` existentes de sellado quedan con `sealedProductId=null` (comportamiento
> actual); las nuevas y las re-escaladas se pueblan desde el `InventoryItem.sealedProductId` de la pieza que las origina.
> Residual pre-P-38 (sellado sin ligar) se cura en M2 — sigue pendiente, nunca 0.

### v1.30-buylist-quote-por-producto (nueva — M-32: línea de buylist por `productId`)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa **M-32** frente a cualquier otro stream que toque
el schema. Es **aditiva pura** (dos columnas nuevas nullable; sin tablas, sin enums, sin backfill, sin `DROP`): filas
viejas quedan con `cardProductId = null` = línea de set_base (retrocompatible). Segura con la app corriendo. La
**resolución de precios NO necesita migración**: reusa `CardProduct` + `PriceReference.cardProductId` de M-31 (§4.27b).
Spec en §4.29.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-32 | `SellRequestItem.cardProductId Int?` | Columna nueva nullable | Add column | Snapshot del `tcgplayerProductId` cotizado cuando la línea es un producto separado (deck_exclusive/promo, §4.29). Se propaga al `InventoryItem` al convertir (M5). `null` = línea de set_base. Análoga a `SellRequestItem.finish` (M-19). |
| M-32 | `PendingPriceEntry.cardProductId Int?` | Columna nueva nullable | Add column | Entra a la clave lógica de la cola de precio pendiente: resolver el set_base NO cierra la del Deck Exclusive (money-safe, §4.29d). `null` = base. |

> **Sin cambios** en `CardProduct`/`PriceReference` (M-31 ya los deja listos), ni en `InventoryItem` (la pieza
> convertida hereda el `cardProductId` del `SellRequestItem` vía el flujo M5; si el backend decide materializarlo como
> columna propia de `InventoryItem`, sería una sub-decisión aditiva a anotar en `TECH_DEBT.md`, no la exige el
> contrato). El **carrito de storefront no cambia** (se identifica por `inventoryItemId`, §4.29e).

### v1.29-tcgcsv-productos-por-variante (nueva — M-31: 1 carta ↔ N productos + rareza canónica)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa **M-31** frente a cualquier otro stream que toque
el schema. Es **aditiva** (tabla nueva `CardProduct` + enum `CardProductKind` + columnas nuevas nullable + un valor de
enum + backfills `UPDATE`); **no** dropea columnas (las muertas de §4.27 se retiran en migración POSTERIOR, por
reversibilidad). Segura con la app corriendo: hasta que el código nuevo despliegue nadie lee las columnas nuevas; el
resolver por-set (`--force`) las puebla de forma determinista y money-safe. Spec en §4.27 (productos/variante) y §4.28
(rareza canónica).

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-31 | `enum CardProductKind { set_base, deck_exclusive, promo, other }` | Enum nuevo | Create type | Naturaleza del producto TCGplayer bajo una carta de colección (§4.27b). |
| M-31 | `model CardProduct` | Tabla nueva | Create table | `id`, `cardId` (FK), `tcgplayerProductId Int @unique` (ancla del join por productId EXACTO), `kind CardProductKind @default(set_base)`, `name String`, `finishes Finish[] @default([])` (subTypes de ESTE producto; nunca unidos con otro productId), `createdAt`, `updatedAt`. `@@index([cardId])`, `@@index([cardId, kind])`. **Backfill:** por cada `Card` con `tcgplayerId` numérico → 1 fila `set_base` con `finishes = structuralFinishes ?? availableFinishes` (semilla; el `--force` por set la REEMPLAZA con la lectura exacta de TCGCSV). |
| M-31 | `Card.cardProducts CardProduct[]` | Relación inversa | (misma migración) | Solo navegación Prisma. |
| M-31 | `Card.tcgplayerId` (ya existe) | **DEPRECADO** (no se dropea) | (n/a) | Reemplazado por `CardProduct.tcgplayerProductId`; se conserva como respaldo del backfill y reversibilidad. |
| M-31 | `PriceReference.cardProductId String?` (+ relación) | Columna nueva nullable + FK | Add column | Se puebla para singles (precio por producto+acabado); `null` para graded/sealed. La `@@unique` pasa a `[cardId, productType, gradeKey, finish, capturedDate, cardProductId]` (§4.27b). |
| M-31 | `enum PriceSource` += `tcgcsv_singles` | Valor de enum nuevo | Alter type add value | Primario de singles (distinto de `tcgcsv`, que es sellado). PPT/pokemontcg.io = fallback (§4.27f). |
| M-31 | `Card.rarityCanonical String?` | Columna nueva nullable | Add column + backfill | `= normalizeRarity(Card.rarity)` (§4.28c). `Card.rarity` CRUDO se conserva (procedencia). **Backfill:** el backend corre el normalizador sobre las filas existentes. La consumen precios y el `groupBy` del admin. |

> **Columnas que quedan MUERTAS (no se dropean en M-31, §4.27g):** `Card.structuralFinishes`, `Card.catalogFinishes`,
> `Card.pricedFinishesSnapshot`. Se retiran en migración posterior tras validar en prod. **Sin cambios** en
> `VariantPriceOverride` (M-30), `InventoryItem`, `Order`. El `PriceRuleSet { rarityRules, finishRules }` (§4.28d) es
> reforma de la FORMA del valor JSON en `ConfigSetting` (dato, no schema) — migración de datos del seed, no de tabla.

### v1.28-stream-b-inventario-master-set (nueva — M-30: overrides y bounty por carta+variante)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa **M-30** frente a cualquier otro stream que
toque el schema. Es **aditiva pura**: UNA tabla nueva (`VariantPriceOverride`) + la relación inversa en `Card`
(`variantPriceOverrides VariantPriceOverride[]`); **cero cambios a tablas/enums existentes, sin backfill** (la
tabla nace vacía; sin filas = comportamiento actual intacto). Segura con la app corriendo. Spec en §4.26a.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-30 | `model VariantPriceOverride` | Tabla nueva | Create table | Campos: `id`, `cardId` (FK), `productType ProductType @default(raw)` (solo `raw|graded` — regla de aplicación), `gradeKey String @default("raw:NM")` (canónico `buildGradeKey`), `finish Finish @default(normal)`, `sellOverrideCents Int?`, `buyOverrideCents Int?`, `bountyEnabled Boolean @default(false)`, `bountyPriceCents Int?`, `bountyTargetQty Int?`, `bountyAcquiredQty Int @default(0)`, `bountyCompletedAt DateTime?`, `updatedBy String?` (sin FK dura, patrón AuditLog), `createdAt`, `updatedAt`. **`@@unique([cardId, productType, gradeKey, finish])`** (una fila VIGENTE por variante; upsert, sin serie temporal), `@@index([bountyEnabled])` (sirve `GET /buylist/bounties`). |
| M-30 | `Card.variantPriceOverrides` | Relación inversa nueva | (misma migración) | Solo navegación Prisma; sin columna física adicional en `Card`. |

> **Sin cambios en `InventoryItem`** (`listPriceCents` por pieza se conserva y GANA sobre el override de variante,
> §4.26b), **ni en `PriceReference`** (el override de MERCADO de M2 sigue siendo `isManualOverride`, perilla
> distinta), **ni en `SellRequestItem`** (`ruleSource` ya es String: gana los valores `"bounty" | "override"` sin
> migración — cambio de dato, no de esquema). El conteo `bountyAcquiredQty` se incrementa en la transacción del
> pago M5 (§4.26e).

### v1.26-precios-variantes-masterset (nueva — estructura autoritativa desde TCGCSV)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa **M-29** frente a cualquier otro stream que toque
el schema. Es **estrictamente aditiva** (una columna array `NOT NULL` con `DEFAULT` vacío + un backfill `UPDATE`);
**no** hay `DROP`, ni enums, ni cambios de nulabilidad, y **no cambia la forma de `availableFinishes`** (sigue igual
para todos los lectores). Segura con la app corriendo: hasta que el nuevo código despliegue nadie lee la columna, y su
único consumidor (`FinishReconciler`) recomputa determinista. `Card.tcgplayerId` **YA existe** (`schema.prisma:401`);
v1.26 solo **empieza a poblarla** (no es cambio de schema). Ver §4.24a.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-29 | `Card.structuralFinishes Finish[] @default([])` | Columna nueva (array `NOT NULL`, default `[]`) | Add column + backfill | Afirmación ESTRUCTURAL autoritativa (TCGCSV). **Ancla/reemplaza** a `catalogFinishes` como entrada del reconciliador. ~~`availableFinishes := orderFinishes(structuralFinishes ∪ pricedFinishesSnapshot) || ['normal']`~~ **(⛔ v1.27: unión derogada; fórmula vigente `composeAvailableFinishes(structuralFinishes)` con fallback `['normal']`, §4.25a — el snapshot no compone)**. **Backfill:** `UPDATE "Card" SET "structuralFinishes" = "availableFinishes"` (siembra con lo ya materializado; el resolver TCGCSV lo REEMPLAZA por carta joineada en el `sync-all {force:true}`). INTERNA: NO se expone en DTO. |
| M-29 | `Card.tcgplayerId` (ya existe) | **Sin cambio de schema** — se empieza a POBLAR desde `tcgplayer.url` (`.../product/<id>`) en `upsertCards` | (n/a) | Ancla del join Card↔producto TCGCSV (§4.24a) y del fetch fresco puntual P-7 (§4.24e). |

> **Sin cambios en `PendingPriceEntry`** (P-6 reusa el enum `context` existente, §4.24c) ni en `PriceReference`/`Order`
> (P-2/P-7 son aditivos de DTO/lógica, §4.24d/e). El `context` de `pendingQueue` y el `pendingPriceEntryId`/
> `marketReferenceMxnCents`/`repriceFresh` de contrato son **cambios de código y DTO, no de esquema**.

### v1.23-sealed-sales (nueva — WS «Sellado / Producto cerrado»: venta de producto cerrado)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa **M-28** frente a cualquier otro stream que
toque el schema. Es **aditiva y nullable** (el único backfill es un `UPDATE` de `sealedCondition` a `mint` para el
sellado existente). **`PriceReference` NO se toca** (el sellado ya se aloja en `sealed:tcg:<productId>`, §4.19d);
**`Order`/`OrderItem` NO se tocan** (el precio se congela en `unitPriceCents`, sin snapshot de spread). Ver §4.23i.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-28 | `enum SealedCondition { mint, minor_box_damage }` | Enum nuevo | Create type | Condición simple del sellado, **visible al comprador** (§4.23i). Labels legibles en i18n del front. |
| M-28 | `InventoryItem.sealedCondition SealedCondition?` | Columna nueva (nullable) | Add column + backfill | App-requerido para `productType='sealed'` (default `mint`); `null` para raw/graded. Backfill: `UPDATE "InventoryItem" SET "sealedCondition"='mint' WHERE "productType"='sealed' AND "sealedCondition" IS NULL`. |
| M-28 | `InventoryItem @@index([productType, status])` | Índice nuevo (recomendado) | Create index | Sirve el grid público del sellado (`sealed AND listed`) y la agregación de la pestaña «Sellado». |
| M-28 | `model SealedRestockSubscription` | Tabla nueva (feature-flagged) | Create table | `id`, `email`, `userId String?` (`onDelete: SetNull`), `cardId` (FK), `sealedSubtype SealedSubtype?`, `tcgplayerProductId Int?`, `sealedCondition SealedCondition`, `notifiedAt DateTime?`, `createdAt`. `@@index([tcgplayerProductId, sealedCondition, notifiedAt])`, `@@index([email])`. Solo se puebla con el dial `sealed_restock_alerts` encendido. |

> **Enums de contrato adicionales:** `SealedSpreadSource = override | subtype_spread | global_spread` (fuente del
> precio resuelto; NO es enum de BD). **Config/diales (dato, no esquema):** `sealed_spread_pct_by_subtype`,
> `sealed_spread_fallback_pct` (spreads, §4.23c), `sealed_value_trend`, `sealed_restock_alerts` (feature flags, seed
> **off**, §4.23h). **Sin backfill** de mapeos/precios: el sellado se preciaba tras curar el mapeo (§4.19c) y encender
> `sealed_price_source` (§4.19e), o con override manual desde el día 1.

### v1.22-variantes-orden (nueva — orden natural del número persistido)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa **M-26**. Es **estrictamente aditiva** (dos
columnas `NOT NULL` con `DEFAULT`, un backfill `UPDATE` y un índice); **no** hay `DROP`, ni enums, ni cambios de
nulabilidad, y **no toca `availableFinishes`** (el arreglo de variantes es **solo código** + re-sync, §4.22a/§4.22d).
Segura para ejecutar con la app corriendo: hasta que el nuevo código despliegue, nadie lee las columnas.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-26 | `Card.numberSort Int @default(1000000)` | **Columna nueva** (`NOT NULL` con default) | Add column + backfill | Clave numérica del orden natural. `1_000_000` = `PROMO_SORT_BASE`: el default deja cualquier fila no backfilleada **al final**, nunca intercalada en falso. |
| M-26 | `Card.numberPrefix String @default("")` | **Columna nueva** (`NOT NULL` con default) | Add column + backfill | Prefijo alfabético (`""` para números puros ⇒ ordenan **primero**, porque `''` es el menor string). |
| M-26 | `@@index([setId, numberPrefix, numberSort])` | **Índice nuevo** | Create index | Sirve el `ORDER BY` del binder y de `GET /buylist/cards` **con `setId`** (el caso real de las tres vistas). Sin `setId` (búsqueda de texto global) el orden lo lidera `name`, ya indexado. |
| M-27 | `Card.catalogFinishes Finish[] @default([])` | **Columna nueva** | Add column + backfill | v1.22-1 (§4.22g). «Opinión del catálogo» (Señal A ∪ B de pokemontcg.io), persistida para sobrevivir a un 502. **Backfill:** `UPDATE "Card" SET "catalogFinishes" = "availableFinishes"`. La escribe `upsertCards`. |
| M-27 | `Card.pricedFinishesSnapshot Finish[] @default([])` | **Columna nueva** | Add column | v1.22-1 (§4.22g). Señal C: acabados con `market>0` en PPT (alias VERIFICADO). Default `[]`; la puebla `price-ingest` en la 1ª corrida. |
| M-27 | `Card.availableFinishes` **pasa a DERIVADA** | Semántica (no cambia forma ni tipo) | (sin SQL: recompute en runtime) | Deja de escribirse directamente; la recomputa `catalog.FinishReconciler` = ~~`orderFinishes(catalogFinishes ∪ pricedFinishesSnapshot) || ['normal']`~~ **(⛔ fórmula superada varias veces; VIGENTE 2026-08-22: `composeAvailableFinishes(structuralFinishes, pricedFinishesSnapshot, rarity)` = `orderFinishes((structuralFinishes ∪ pricedFinishesSnapshot) − {normal si premium}) || ['normal']`, §4.25e)**. La columna y su índice/uso NO cambian. |

**SQL de M-27** (solo `ADD COLUMN` + un `UPDATE` de backfill; sin índices nuevos):

```sql
ALTER TABLE "Card" ADD COLUMN "catalogFinishes"        "Finish"[] NOT NULL DEFAULT '{}';
ALTER TABLE "Card" ADD COLUMN "pricedFinishesSnapshot" "Finish"[] NOT NULL DEFAULT '{}';

-- Siembra la base con el valor catálogo ya materializado; pricedFinishesSnapshot queda vacío.
UPDATE "Card" SET "catalogFinishes" = "availableFinishes";
```

**SQL exacto de la migración** (Prisma no expresa el backfill; va en el mismo `migration.sql`, **después** de los
`ADD COLUMN` y **antes** del `CREATE INDEX`). La fórmula es el espejo 1:1 de `deriveNumberParts` (§4.22b), incluido el
**clamp a `999_999`** vía `numeric` para no desbordar `Int` con un `number` de muchos dígitos:

```sql
ALTER TABLE "Card" ADD COLUMN "numberSort"   INTEGER NOT NULL DEFAULT 1000000;
ALTER TABLE "Card" ADD COLUMN "numberPrefix" TEXT    NOT NULL DEFAULT '';

UPDATE "Card" SET
  "numberSort" = CASE
    WHEN "number" ~ '^[0-9]+$'
      THEN LEAST(("number")::numeric, 999999)::int
      ELSE 1000000 + LEAST(
             COALESCE(NULLIF(regexp_replace("number", '\D', '', 'g'), '')::numeric, 0),
             999999)::int
  END,
  "numberPrefix" = CASE
    WHEN "number" ~ '^[0-9]+$' THEN ''
    ELSE regexp_replace("number", '[0-9]', '', 'g')
  END;

CREATE INDEX "Card_setId_numberPrefix_numberSort_idx"
  ON "Card" ("setId", "numberPrefix", "numberSort");
```

> **Verificación post-migración (devops):** `SELECT number, "numberPrefix", "numberSort" FROM "Card" WHERE "setId"=:s
> ORDER BY "numberPrefix","numberSort" LIMIT 20` debe arrancar en `1,2,3,…` (no `1,10,100`) y terminar con los
> `TG*`/`SV*`. **El backfill no sustituye al re-sync** de §4.22d: este solo arregla el **orden**; las **variantes**
> requieren `sync-all {force:true}`.

### v1.21-guest-checkout (nueva — WS «Órdenes y dinero»: comprar sin cuenta)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa **M-25** frente a cualquier otro stream. Es la
migración **menos aditiva** de las recientes: incluye **dos `DROP NOT NULL`** (`Order.userId`,
`ShipmentRequest.userId`). Aun así es **compatible hacia atrás**: ninguna fila existente cambia de valor, los
defaults (`vault`, `0`) reproducen el comportamiento actual bit a bit, y los índices `@@index([userId])` **se
conservan** (un B-tree de Postgres indexa `NULL` y las consultas `where userId = X` lo siguen usando igual). Diff
campo por campo, con nota de compatibilidad por columna, en **API_CONTRACT §4-G.10**.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-25 | `enum FulfillmentMode` | **Enum nuevo** (`vault \| direct_ship`) | Create enum | Destino del pedido. `vault` = comportamiento actual. |
| M-25 | `Order.userId` | `String` → **`String?`** (relación a opcional) | **Alter column (DROP NOT NULL)** | Un pedido de invitado no tiene `User`. **No relaja ninguna autorización**: la puerta sigue siendo `order.userId !== :sessionUser`, y `null` nunca iguala a un uuid. El **compilador** de TypeScript señalará cada punto que asumía no-nulo: backend debe resolverlos con decisión explícita, no con `!`. |
| M-25 | `Order.guestEmail String?` | **Columna nueva** (nullable) + `@@index([guestEmail])` | Add column + index | Correo del invitado, normalizado (trim+lowercase) por la aplicación. `guestEmail != null` ⇔ el pedido **nació** de invitado (inmutable, sobrevive al reclamo). |
| M-25 | `Order.fulfillmentMode` | **Columna nueva** `FulfillmentMode` **`@default(vault)`** | Add column | El default preserva el comportamiento existente sin backfill. |
| M-25 | `Order.shippingAddressSnapshot Json?` | **Columna nueva** (nullable) | Add column | Dirección capturada en línea (el invitado no tiene `Address`). Mismo criterio de *snapshot* que `ShipmentRequest.addressSnapshot`. |
| M-25 | `Order.shippingFeeCents Int @default(0)` | **Columna nueva** | Add column | Envío cobrado **dentro** de la orden. `0` en pedidos a bóveda ⇒ el P&L histórico no cambia. **Única** fuente del ingreso de envío de un pedido de invitado (§4.21b). |
| M-25 | `Order.orderNumber String? @unique` | **Columna nueva** + **secuencia** `order_number_seq` + **backfill** | Add column + create sequence + data | Número legible `TCG-000123` (criterios 45/49/53/56b). Mismo patrón que `inventory_folio_seq`/`PrismaService.nextFolio`. Nullable solo para permitir el backfill; la aplicación lo escribe siempre. Greenfield ⇒ backfill trivial por `createdAt`. |
| M-25 | `Order.claimedAt DateTime?` | **Columna nueva** (nullable) | Add column | Momento del reclamo. Con `guestEmail != null`: `null` ⇒ reclamable. |
| M-25 | `Order.locale Locale?` | **Columna nueva** (nullable) | Add column | Idioma del correo del invitado (no hay `User.locale`). Resolución `order.locale ?? user.locale ?? 'es'`. |
| M-25 | `Order.paymentMethodBrand String?`, `Order.paymentMethodLast4 String?` | **2 columnas nuevas** (nullable) | Add column | Capturadas del `charge` al liquidar. **Solo** marca + 4 últimos dígitos (permitido por PCI-DSS); jamás PAN/BIN/titular. Alimentan la vista pública. |
| M-25 | `ShipmentRequest.userId` | `String` → **`String?`** | **Alter column (DROP NOT NULL)** | `null` **solo** en el envío directo creado por el servidor. Riesgo #1 de la migración: `GET /shipments[...]` debe filtrar por `userId = :sessionUser` de forma **positiva** (caso negativo obligatorio de QA). |
| M-25 | `ShipmentRequest.orderId String?` + FK a `Order` + `@@index([orderId])` | **Columna + índice nuevos** | Add column + FK + index | **Discriminador**: `null` ⇒ retiro de bóveda (todo lo existente); poblado ⇒ envío directo que fulfilla ese pedido. **No `@unique`** (deja abierta la re-expedición sin migrar); invariante de aplicación: a lo más un envío **activo** por orden. |
| M-25 | `OrderAccessToken` | **Modelo nuevo** (`id` uuid `@id`, `orderId` + FK `onDelete: Cascade`, `tokenHash String @unique`, `expiresAt DateTime`, `revokedAt DateTime?`, `lastUsedAt DateTime?`, `useCount Int @default(0)`, `requestIp String?`, `createdAt`; `@@index([orderId])`, `@@index([expiresAt])`) | Create table | Enlace de seguimiento. **Solo** el SHA-256 del claro. **Multi-uso**: `revokedAt` (revocable) en vez de `usedAt` (consumible) — es la única diferencia semántica con `AuthToken`, y la razón de no reusar ese modelo (su `userId` es obligatorio y su `consume()` es de un solo uso). |

> **`CHECK` en SQL crudo dentro de la migración** (Prisma no los expresa; son baratos y atrapan bugs de
> aplicación): `userId IS NOT NULL OR guestEmail IS NOT NULL`; `guestEmail IS NOT NULL ⇒ fulfillmentMode='direct_ship'`;
> `fulfillmentMode='direct_ship' ⇒ shippingAddressSnapshot IS NOT NULL`; `claimedAt IS NOT NULL ⇒ userId IS NOT NULL`.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| **M-25b** | `InventoryItem` — `CHECK (ownerType <> 'customer' OR ownerUserId IS NOT NULL)` | **Constraint nuevo** (SQL crudo) | Add check constraint | **v1.21.2 (D6) — pasa de "recomendado" a NORMATIVO.** Es el invariante que §4-G.0-1 declara literalmente «lo que hace segura la nulabilidad de `Order.userId`», y era el **único** de los cinco que no se implementó. Sin él, un bug futuro que escriba `ownerType='customer'` con `ownerUserId=null` produce una pieza en el limbo: no sale en la bóveda de nadie (todas las consultas filtran por `ownerUserId`), no es vendible (`ownerType≠platform`) y no es ajustable en M1 — una carta desaparecida en silencio. Es una **tabla de otro work stream**: el orquestador serializa. **Precondición de despliegue:** `SELECT count(*) FROM "InventoryItem" WHERE "ownerType"='customer' AND "ownerUserId" IS NULL` debe dar **0** (debe darlo: hoy nada escribe esa combinación); si no, se corrige el dato **antes** de añadir el constraint. |
> **Enums:** ninguno más — `InventoryStatus` **NO** crece (`picking|shipped|delivered` ya existen sin uso, §4.21c) y
> `ShipmentStatus` tampoco. **Config/diales:** **ninguno** — los cinco parámetros del guest checkout son
> **constantes de servidor** (`GUEST_TRACKING_TTL_DAYS=90`, `GUEST_TRACKING_MAX_AGE_DAYS=365`,
> `GUEST_RESEND_MAX_PER_DAY=5`, `GUEST_MAX_ITEMS=20`, `GUEST_ORDER_RESERVATION_TTL_MIN=60`), mismo precedente que
> las ventanas 7d/30d del buylist (v1.18); promoverlas a M10 después es no-breaking. La tarifa de envío reusa el
> dial existente `SHIPPING_FEE_CENTS`. **Sin variables de entorno nuevas** (el enlace se arma con `APP_BASE_URL`).

### v1.20-master-set-everywhere (nueva — WS «Inventario y vault»: master set en todas partes)

**Aditiva, una sola migración `M-24`** (ajustes de inventario). Las tres vistas por scope, los campos de variante y
`GET /admin/vaults` son **solo código** (reusan `InventoryItem`, `Card.availableFinishes`, `PriceReference`,
el índice M-21 y `getReferencesBatch`) — **sin** cambio de esquema. **Sin backfill.**

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-24 | `enum AdjustmentReason` | **Enum nuevo** (`encontrada \| perdida \| danada \| error_captura`) | Create enum | Motivo OBLIGATORIO del ajuste por levantamiento físico (§4.20e). |
| M-24 | `enum MovementReason` | **Valor nuevo** `adjustment` | Alter enum (aditivo) | El historial de la pieza distingue un ajuste de operador (`adjustment`) de un `mark` normal (`lost`/`damaged`) o un retiro (`withdrawal`). Aditivo; nada existente cambia. |
| M-24 | `InventoryAdjustment` | **Modelo nuevo** (`id` uuid `@id`, `inventoryItemId String` + FK a `InventoryItem`, `reason AdjustmentReason`, `fromStatus InventoryStatus?`, `toStatus InventoryStatus`, `actorUserId String?` sin FK dura (patrón `AuditLog`), `note String?`, `createdAt`; `@@index([inventoryItemId])`, `@@index([reason])`, `@@index([createdAt])`) | Create table | Registro **tipado y consultable** del levantamiento (reportes de merma M7/M9); complementa —no reemplaza— `InventoryMovement` y `AuditLog` (§4.20e). Para `encontrada` con `qty>1` se crea **una fila por pieza creada**. |

> **NO se añade** valor nuevo a `InventoryStatus`: `error_captura` reusa `withdrawn` (decisión §4.20e — el enum de
> status es zona transversal; la distinción vive en `InventoryAdjustment.reason`). **Config/diales:** ninguno.

### v1.19-sealed-tcgcsv (nueva — WS «Catálogo y precios»: referencia de mercado del sellado vía TCGCSV)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa esta migración frente a cualquier otro stream que
toque el schema. Es **aditiva y nullable** (sin backfill: los items sellados existentes quedan sin mapeo hasta que el
admin los cure). **`PriceReference` NO se toca** (soporta sellado tal cual: `productType='sealed'` ya en el enum,
`gradeKey` String libre — nuevo esquema `sealed:tcg:<productId>` —, `finish` default `normal`, unique existente). Ver
§4.19c/d.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-23 | `enum PriceSource` **+= `tcgcsv`** | Valor de enum nuevo | Alter enum (add value) | Fuente de la referencia de sellado en `PriceReference.source` (y en `PriceInfo.source` del contrato). En Postgres, `ALTER TYPE ... ADD VALUE` — aditivo, sin reescritura de filas. |
| M-23 | `InventoryItem.tcgplayerProductId Int?` | **Columna nueva** (nullable) | Add column | Mapeo curado item sellado ↔ `productId` de TCGplayer/TCGCSV. Solo aplica a `productType='sealed'` (regla de aplicación, no constraint de BD). `null` = no mapeado (cola derivada de curación, §4.19c). |
| M-23 | `InventoryItem.tcgplayerGroupId Int?` | **Columna nueva** (nullable) | Add column | Grupo TCGCSV del producto (el endpoint de precios es **por grupo**). Se fija **junto** con `tcgplayerProductId`; ambos `null` o ambos poblados (invariante de aplicación). |
| M-23 | `InventoryItem` `@@index([tcgplayerProductId])` | **Índice nuevo** | Create index | Sirve la cola de no-mapeados (`sealed AND productId IS NULL`) y el `DISTINCT tcgplayerGroupId` del ingest sin barrer la tabla. |

> **Enum de contrato adicional:** `SealedPriceSource = tcgcsv | off` (valores del dial; NO es enum de BD — el dial es
> una `ConfigSetting` string validada). **Config/diales:** `sealed_price_source` (seed **`off`**, fail-closed §4.19e),
> sembrada por el seed de settings (dato, no esquema). **Sin backfill** de mapeos: la curación es manual post-deploy.

### v1.18-buylist-rejects (nueva — WS «Catálogo y precios»: rechazo de ítem de buylist)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa esta migración frente a cualquier otro stream
que toque el schema. Es **aditiva y nullable** (sin backfill: los ítems rechazados pre-M-22 quedan con `rejectedAt`/
`rejectionReason` `null` y las proyecciones exponen los campos de rechazo en `null` — normado en API_CONTRACT §11).
Los plazos (`returnDeadlineAt`/`abandonDeadlineAt`) **NO son columnas** (derivados de `rejectedAt` + constantes
7d/30d, §4.18a).

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-22 | `SellRequestItem.rejectedAt DateTime?` | **Columna nueva** (nullable) | Add column | Timestamp de la decisión `reject` (= notificación al vendedor). **Ancla ÚNICA** de los plazos 7d (devolución a costo del usuario) y 30d (abandono). Imprescindible: el modelo no tiene ningún timestamp propio y `AuditLog` no es fuente válida de plazos (§4.18a). |
| M-22 | `SellRequestItem.rejectionReason String?` | **Columna nueva** (nullable) | Add column | Motivo del rechazo (obligatorio en el request con `decision:"reject"`, 3–500 chars). Alimenta el correo al vendedor, la pestaña «Rechazadas» y el detalle del propio cliente. |
| M-22 | `SellRequestItem` `@@index([itemStatus])` | **Índice nuevo** (recomendado) | Create index | Sirve `GET /admin/buylist/rejected-items` (filtro transversal por `itemStatus='rechazada'`) sin barrer la tabla. No bloqueante a volumen MVP, pero entra con la misma migración. |

> **Enum:** ninguno nuevo (`SellItemStatus.rechazada` ya existe; sin estados nuevos de ítem). **Config/diales:**
> ninguno; las ventanas 7/30 días son **constantes de servidor** compartidas con la familia `buylist-sweep`.

### v1.16-master-set (nueva — WS-E: Master Set + inventario a escala)

**Aditiva, una sola migración `M-21`.** Un índice compuesto (acelera las agregaciones del binder) + un modelo nuevo
(`InventoryBatch`) de idempotencia/auditoría del alta por lote. **Sin backfill.** No crea enums ni diales. **NO cambia
el modelo por-pieza** (`InventoryItem` sigue 1 fila por pieza). El resto de WS-E (§4.17) es **código**: agregaciones
raw/`groupBy`, orden natural de `number`, `PrismaService.nextFolios(n)`, `PricingService.getReferencesBatch`, pago
mínimo de BE-25, y los 4 endpoints M1.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-21 | `InventoryItem` `@@index([cardId, finish, status])` | **Nuevo** índice compuesto | Create index | Sirve la agregación `countsByFinish` del binder (`GROUP BY cardId, finish` filtrando `status` on-hand) y el conteo por set. Complementa los `@@index([cardId])`/`@@index([status])` existentes (no los reemplaza). |
| M-21 | `InventoryBatch` | **Modelo nuevo** (`id`=`batchKey` `@id`, `actorUserId String?`, `kind String` (`create`\|`publish`), `requested Int`, `createdItems Int`, `failedLines Int`, `resultJson Json`, `createdAt`) | Create table | Idempotencia + auditoría del alta por lote: un replay del mismo `batchKey` devuelve `resultJson` sin re-crear. Es el registro de auditoría del lote (complementa `AuditLog`). Sin FK dura a `User` (auditoría, patrón `AuditLog`). |

> **Enum:** ninguno nuevo. **Config/diales:** ninguno en DB; el cap del lote (200) y `BUYLIST_QUOTE_BATCH_MAX`-style son
> **constantes de servidor** (decisión abierta WS-E-4 sobre si alguno debe ser dial M10).

### v1.14-price-ingest (nueva — WS-A: ingesta masiva vía proveedor de paga) — **SIN migración de esquema**

**No hay migración.** WS-A (§4.15) es 100% aditiva sobre modelos existentes: reusa `PriceReference` (con `finish` en su
clave desde M-18), el enum `PriceSource.pokemonpricetracker` (**ya presente**) y `Card.availableFinishes` (M-18). Los
cambios son de **código** (nueva interfaz `BulkPriceProvider` + adapters, `PriceIngestService`, jobs `price-ingest`/
`price-ingest-set`, generalizar `PricingService.persistMarketReference`, aligerar `catalog-sync` a metadata) y de **jobs/
scheduler** (devops repunta el slot 2×/día). El único dato nuevo es el dial `PRICE_PROVIDER` (`price_provider`), una fila
de `ConfigSetting` sembrada por el seed de settings (no de esquema). **Nota de escala (heredada de DEV-4):** el ingest
sigue creciendo `PriceReference` ~1 fila/día por (carta, acabado); la retención/particionado de la serie queda para
fase 2. **Nota de rollout money-safe:** primero desplegar el job robusto con `PRICE_PROVIDER=pokemontcg_io`, verificar el
esquema del proveedor de paga en la 1ª corrida (v1.14-1) y luego flip del dial (v1.14-4).

### v1.13-sales-pricing (nueva — Fase 2 del epic de precios) — **SIN migración de esquema**

**No hay migración.** Fase 2 (§4.14) es 100% aditiva: dos `ConfigSetting` nuevos (`sales_price_rules`,
`sales_price_fallback_pct`, sembrados por el seed de settings), una función pura en `money.ts`, endpoints M2 y editor
front. El precio de venta ya se **congela** en `OrderItem.unitPriceCents` al checkout, así que **no** se requiere
columna de snapshot (a diferencia de buylist M-14). `SALES_MARKUP_PCT` queda deprecado sin borrar (decisión abierta
v1.13-3). Backend siembra los dos nuevos settings vía el seed/migración de datos de `ConfigSetting` (no de esquema).

### v1.12-catalog-pricing (nueva — Fase 1 del epic de precios) — **SIN migración de esquema**

**No hay migración.** Fase 1 (§4.13) es 100% aditiva sobre modelos existentes: reusa `PriceReference` (que ya lleva
`finish` en su clave desde M-18) y `CardSet`/`Card`. Los cambios son de **lógica** (nueva escritura de
`PriceReference` en `upsertCards`, quitar `escalatePending` de `publicQuote`) y de **jobs/scheduler** (nuevo
`catalog-price-sync`, cableado por devops). No crea enums, tablas ni diales. **Nota de escala (no bloqueante):**
`PriceReference` pasa a crecer ~1 fila/día por (carta, acabado) del catálogo (~30–40k filas/día); considerar
retención/particionado de la serie en fase 2 (DEV-4, §9).

### v1.9-set-chart (nueva — gráfica pública del valor de un set)

**Aditiva, una sola migración `M-20`.** Un modelo nuevo (`SetValueSnapshot`) + una relación inversa en `CardSet`.
**Sin backfill:** la tabla arranca vacía y se puebla desde el primer día que corran los jobs (§4.12c). No toca
dinero (SEC-A1 intacto: el valor se deriva de `PriceReference`). No crea enums ni diales.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-20 | `SetValueSnapshot` | **Modelo nuevo** (`id`, `setId` FK→`CardSet` `onDelete:Cascade`, `asOfDate @db.Date`, `totalValueMxnCents Int`, `pricedCardCount Int`, `totalCardCount Int`, `createdAt`, `updatedAt`, `@@unique([setId, asOfDate])`, `@@index([setId, asOfDate])`) | Create table | Serie diaria del valor de mercado agregado por set (gráfica pública del hero). Escrito por jobs `set-price-sync` + `set-value-snapshot`. Idempotente por día (upsert). Ver §3.2, §4.12. |
| M-20 | `CardSet.snapshots` | **Nuevo** lado inverso `SetValueSnapshot[]` | Relación (sin columna en `CardSet`) | Solo relación Prisma; no añade columna física a `CardSet`. |

> **Enum:** ninguno nuevo (no usa `Finish`; toma siempre `normal` como filtro en la query de valor). **Config/diales:** ninguno en DB; el set destacado se controla por **env `HOME_FEATURED_SET_ID`** (§4.12b, §8), no por `ConfigSetting`.

### v1.8-ronda-c (nueva — BE-10 + PendingPriceEntry.finish + SEC-D2)

**Aditiva, una sola migración `M-19`.** Dos columnas nuevas con default/nullable seguro; **BE-10 NO migra** (es
una proyección de respuesta, no una tabla). Sin backfill obligatorio (los defaults/fallbacks cubren filas legacy).

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-19 | `PendingPriceEntry.finish` | **Nuevo** `Finish @default(normal)` | Add column (default) | La cola de precio pendiente se dedupe/resuelve por acabado. Antes `(cardId, productType, gradeKey)` colapsaba acabados en una entrada; resolver `normal` cerraba `holofoil`. No hay índice único de BD en la cola (dedupe por `findFirst`), así que **solo** se añade la columna; `escalatePending`/`manualOverride` incorporan `finish` a sus `where`. Reusa el enum `Finish` de M-18. Filas legacy → `normal`. Ver §3.2, §4.2. |
| M-19 | `SellRequest.closedAt` | **Nuevo** `DateTime?` (nullable) | Add column (nullable) | SEC-D2: fecha de cierre real, seteada al entrar a estado terminal (`pagada`/`rechazada`/`abandonada`). El job `ine-retention` la usa para anclar la ventana de retención de INE (fallback a `max(...)` para filas legacy con `closedAt=null`). Campo interno de cumplimiento; no se expone en DTOs de cliente. Ver §3.2, §3.4(d). |
| M-19 | `AdminUserOwnedItemRef` (BE-10) | **NO migra** — proyección de `GET /admin/users/:id` | — | Se enriquece la **respuesta** (`+finish`, `+referenceValue: PriceInfo`) reusando `getReference` por-acabado. Sin cambio de esquema. Ver §4.7ter(c) y `API_CONTRACT §M6/§11`. |

> **Enum:** M-19 **reutiliza** `Finish` (creado en M-18); no crea enums ni tablas nuevas. **Config/diales:** ninguno.

### v1.6-finish (nueva — acabado / versión de carta)

**Aditiva.** Toda columna nueva trae **default seguro** (`normal` / `[normal]`), así que las filas ya
existentes quedan operables sin backfill manual. **Requiere RE-SYNC del catálogo tras desplegar** para poblar
`availableFinishes` y las `PriceReference` por acabado reales (los datos ya importados no traen finish hasta el
re-sync; hasta entonces todo se comporta como `normal`). El re-sync es idempotente (v1.3.1).

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-18 | Enum **`Finish = normal \| reverse_holo \| holofoil \| first_edition_holofoil`** | **Add enum** | Valores canónicos (§3.7). Cerrado a estos 4 por decisión del humano (mapeo de llaves de `tcgplayer.prices`); `1stEditionNormal`/`unlimited*` no se mapean en el MVP (pregunta abierta v1.4-1). |
| M-18 | `Card.availableFinishes` | **Nuevo** `Finish[] @default([normal])` | Add column (default) | Acabados en que existe la carta, derivados de `tcgplayer.prices` al importar. **NO** toca el `@unique` de `externalId` (sigue 1 fila por carta). Filas históricas → `[normal]`; re-sync repuebla. |
| M-18 | `PriceReference.finish` + `@@unique` | **Nuevo** `Finish @default(normal)`; unicidad pasa de `(cardId, productType, gradeKey, capturedDate)` a **`(cardId, productType, gradeKey, finish, capturedDate)`** | Add column (default) + alter unique | `finish` entra a la clave para que cada acabado tenga referencia propia. Filas existentes → `finish=normal` (siguen únicas bajo la nueva clave). `gradeKey` sin cambio de semántica. |
| M-18 | `InventoryItem.finish` | **Nuevo** `Finish @default(normal)` | Add column (default) | Acabado de la copia física; afecta valuación y "Compra". Se captura en M1; `graded`/`sealed` = `normal`. |
| M-18 | `SellRequestItem.finish` | **Nuevo** `Finish @default(normal)` | Add column (default) | Snapshot del acabado cotizado/solicitado; se propaga a `InventoryItem.finish` al convertir. |

> **Diales/config:** M-18 **no** requiere columnas de `ConfigSetting`. Reutiliza `BUYLIST_PRICE_RULES` /
> `BUYLIST_PRICE_FALLBACK_PCT` (v1.3.1); las claves sintéticas `"Reverse Holo"` (ya sembrada) y `"Holo"`
> (opcional, la añade el dueño en M2) son entradas de esa misma tabla. Ver §4.2.1.

### v1.5-auth-email (nueva — verificación de correo + recuperación self-service)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-17 | **`AuthToken`** (modelo nuevo) + enum **`AuthTokenType = email_verification | password_reset`** | **Create table** + **add enum** | Create table / add enum | `AuthToken`: `id` (uuid), `userId` (FK `User`, `onDelete: Cascade`), `type` (`AuthTokenType`), `tokenHash` (`String @unique`, SHA-256 del token en claro — **nunca** el claro), `expiresAt` (`DateTime`), `usedAt` (`DateTime?`), `requestIp` (`String?`), `createdAt`. Índices `@@unique([tokenHash])`, `@@index([userId, type])`, `@@index([expiresAt])`. Un solo uso; expira 24h (verificación) / 1h (reset). Ver §3.2, §4.11. `User` gana la relación `authTokens AuthToken[]`. Greenfield: sin backfill. **No** cambia `User.emailVerified` (ya existe, M-6) ni `tokenVersion` (ya existe, M-15). |

### v1.4-finance (nueva — costo real de paquetería en el P&L)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-16 | `ShipmentRequest.shippingCostCents` | **Nuevo** `Int @default(0)` (costo real MXN que la plataforma paga al carrier) | Add column (con default 0) | Aditivo; **NO** toca `shippingFeeCents` (ingreso). Se captura en M4 al asignar carrier/guía (`POST /admin/shipments/:id/tracking`), opcional y editable, validación de app **entero ≥ 0**. El `@default(0)` cubre filas históricas/sin captura para no romper el P&L (§M7). Greenfield: sin backfill. |

### v1.3.1 (nuevas — precio de buylist por rareza)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-14 | `SellRequestItem`: `rarity` `String?`, `ruleMode` `BuylistRuleMode?`, `ruleValue` `Int?`, `ruleSource` `String?`; enum nuevo **`BuylistRuleMode = fixed | pct`** | **Añadir** columnas + enum; **deprecar** `SellRequestItem.category` (pasa a **nullable**, ya no se escribe) | Add column / add enum / alter column nullable | Snapshot de la regla aplicada por rareza (§3.2, §4.2). `BuylistCategory` se conserva en el schema por retención legacy pero queda deprecado; nada nuevo lo usa. Greenfield: sin backfill. Los diales `buylist_price_rules` / `buylist_price_fallback_pct` son `ConfigSetting` (no requieren columna dedicada). |
| M-15 | `User`: `deletedAt` `DateTime?`, `anonymizedAt` `DateTime?`, `mustChangePassword` `Boolean @default(false)`, `tokenVersion` `Int @default(0)`; enum **`UserStatus`** gana valor **`deleted`** | **Añadir** columnas + valor de enum | Add column / alter enum | Gestión de usuarios M6 (§4.7bis): reset de contraseña por admin (revoca tokens vía `tokenVersion`, opcional `mustChangePassword`) y borrado híbrido hard/soft (soft ⇒ `status=deleted` + anonimización PII). El JWT debe incluir `tokenVersion` y el guard rechazar versiones desactualizadas. Greenfield: sin backfill. |

### v1.2 / v1.2.1 (nuevas)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-12 | `InventoryItem.certNumber` | **Nuevo** `String?` (nº de certificado PSA/CGC) | Add column | Solo para `productType=graded`; **requerido a nivel de aplicación para publicar** una gradeada (validación de servicio, no NOT NULL en BD porque raw/sealed lo dejan null). Sin validación automática contra la graduadora. |
| M-13 | `InventoryItem.frontPhotoKey` / `backPhotoKey` / `extraPhotoKeys`; `SellRequestItem.photoKeys`; `Dispute.ingressPhotoKeys` / `claimPhotoKeys` | **Eliminar** (producto sin fotos propias; disputa por correo) | Drop column | Greenfield: sin datos que migrar. La imagen del producto pasa a ser siempre la de catálogo remota. Si backend prefiere conservarlas nullable-sin-uso en v1, se documenta como deuda menor en `TECH_DEBT.md`; la decisión de arquitectura es **eliminarlas**. |
| M-10 (rev) | `Dispute.type` | Se **conserva** `condition_raw | condition_sealed` (v1.1 M-10). Sin cambio adicional en v1.2. | — | La distinción raw/sellado sigue; lo que cambia es que la evidencia va **por correo**, no por foto. |

> **INE (KYC) — SIN migración (v1.2.1):** `KycProfile.ineFrontKey`/`ineBackKey`, cifrado PII (`*Enc`/`*Hmac`),
> retención `INE_RETENTION_DAYS` y `reveal-clabe` **permanecen intactos** (§3.4). La v1.2.1 no toca el esquema
> de INE/CLABE respecto a v1.1.

### v1.1 (previas)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-1 | `RawCondition` (enum) | `NM \| LP \| MP \| HP \| DMG` → **`NM`** (único valor) | Redefinir enum Postgres | Greenfield: sin filas que backfillear. Si en el futuro hubiera filas ≠ NM, requeriría estrategia de mapeo; hoy no aplica. |
| M-2 | `InventoryItem.sealedSubtype` | **Nuevo** enum opcional `box\|etb\|bundle\|tin\|blister`, nullable | Add column | Solo para `productType=sealed`. |
| M-3 | `User.passwordHash` | pasa a **nullable** | Alter column | Null para cuentas solo-Google. |
| M-4 | `User.authProvider` | **Nuevo** enum `local\|google` default `local` | Add column + enum | |
| M-5 | `User.googleId` | **Nuevo** `String? @unique` | Add column + unique index | |
| M-6 | `User.emailVerified` | **Nuevo** `Boolean @default(false)` | Add column | |
| M-7 | `User.avatarUrl` | **Nuevo** `String?` | Add column | |
| M-8 | `PortfolioSnapshot` | **Modelo nuevo** (`userId, asOfDate @db.Date, totalValueMxnCents, costBasisMxnCents?, pendingPriceCount`, `@@unique([userId, asOfDate])`, `@@index([userId, asOfDate])`) | Create table | Escrito por job `portfolio-snapshot` (BE-5). |
| M-9 | `ConfigSetting` seed | **Nuevo dial** `catalog_sync_from_date` = `"2024/01/01"` | Seed/insert | Default de `POST /admin/catalog/sync`. |
| M-10 | `Dispute.type` | Generalizar más allá de `condition_raw` para admitir **disputa de sellado** (caja dañada/equivocada) | Alter enum (add value, p. ej. `condition_sealed`) | La evidencia canónica del sellado es la foto de la caja al ingreso. |
| M-11 | `Card.rarity` | **Sin cambio** — permanece `String` libre (taxonomía abierta pokemontcg.io) | — | Se documenta explícitamente para que no se convierta en enum. |

Ninguna otra tabla cambia. Los índices existentes se conservan.

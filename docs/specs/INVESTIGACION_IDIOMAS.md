# Investigación: cartas en japonés y en español (catálogo y precios automáticos)

**Medido el 2026-10-06**, sobre `HEAD` 3609125, por un agente investigador de solo lectura. Todas las peticiones
fueron GET públicos, sin login ni cuentas, y pocas por fuente. Donde algo no se pudo medir, dice **NO MEDIDO**
y qué lo cerraría.

Hoy (repo): el catálogo viene de pokemontcg.io (`backend/src/modules/catalog/pokemontcg-io.client.ts:8`), y los
precios de TCGCSV con la categoría Pokémon fija en `3` (`backend/src/modules/pricing/providers/tcgcsv-http.client.ts:28`)
y de PPT `/api/v2/cards` como respaldo (`pokemonpricetracker-bulk.provider.ts:413`).

---

## Resumen en una frase

**Japonés: sí se puede automatizar ya**, con la misma fuente que usamos hoy (TCGCSV, categoría **85**), con el
mismo formato y gratis. **Español: no hay fuente automática de precio propio del español**; todas las fuentes
abiertas dan **un precio para la carta sin distinguir idioma** (que en la práctica es el inglés). Para el
español lo realista es «mismo catálogo que inglés + regla de porcentaje», y el porcentaje **no lo pude medir**.

---

## 1. TCGCSV / TCGplayer — japonés

| Qué | Resultado | Cómo lo medí |
|---|---|---|
| ¿Existe categoría japonesa? | **Sí: `categoryId = 85`, «Pokemon Japan»** (la inglesa es la `3`). Actualizada el 2026-10-05. | `GET https://tcgcsv.com/tcgplayer/categories` → 94 categorías |
| ¿Cuántos grupos (sets)? | **460 grupos** en japonés (frente a 220 en inglés). Incluye sets principales, starter decks, promos, máquinas expendedoras, etc. | `GET https://tcgcsv.com/tcgplayer/85/groups` |
| ¿Trae precios? | **Sí, mismo formato que el inglés**: `lowPrice`, `midPrice`, `highPrice`, `marketPrice`, `directLowPrice` por producto **y por acabado** (`subTypeName`). En USD. | `GET .../85/{groupId}/prices` |
| Cobertura de `marketPrice` | **100 %** en los 3 sets medidos: M2 Inferno X 118/118, SV11B Black Bolt 331/331, M6 Storm Emeralda 118/118 filas con `marketPrice`. | conteo sobre los JSON de precios |
| Acabados | En japonés solo aparecen **`Normal` y `Holofoil`**; **no hay `Reverse Holofoil`** en los 3 sets medidos (en inglés, ME02 sí: 84 filas Reverse). Es cómo se imprimen las cartas japonesas modernas. | `Counter(subTypeName)` |
| Nombres e imágenes | Los productos japoneses vienen **con nombre en inglés** («Mega Charizard X ex - 110/080»), con número y rareza en `extendedData` y con `imageUrl` del CDN de TCGplayer. En SV11B solo 178/331 productos tienen `imageCount>0` (el resto probablemente imagen genérica, **NO MEDIDO** visualmente). | `GET .../85/{groupId}/products` |

**Cartas de ejemplo (precio de mercado en USD, TCGCSV, 2026-10-06):**

| Set japonés (groupId) | Carta | Rareza | Acabado | low / mid / market |
|---|---|---|---|---|
| M2: Inferno X (24459) | Mega Charizard X ex 110/080 | Special Art Rare | Holofoil | 589.99 / 675.00 / **711.63** |
| M2: Inferno X (24459) | Mega Charizard X ex 116/080 | Mega Ultra Rare | Holofoil | 599.99 / 693.10 / **711.20** |
| SV11B: Black Bolt (24349) | Zekrom ex 174/086 | Black White Rare | Holofoil | 299.99 / 302.74 / **302.74** |
| M6: Storm Emeralda (24791) | Mega Rayquaza ex 110/076 | Special Art Rare | Holofoil | 280.00 / 345.05 / **307.32** |
| M6: Storm Emeralda (24791) | Raikou ex 108/076 | Special Art Rare | Holofoil | 48.51 / 53.79 / **50.99** |

Comparación con su gemela inglesa: Mega Charizard X ex SIR en **ME02 Phantasmal Flames** (grupo 3/24448),
125/094 → market **659.53**. Japonés 711.63 vs inglés 659.53 (+8 % en esta carta; **una sola carta, no es regla**).

**¿Los sets japoneses corresponden 1:1 con los ingleses? No.** Japón saca sets más chicos y luego el inglés
junta varios. Numeración distinta (110/080 en JP vs 125/094 en EN para la misma ilustración).

| Japonés (TCGCSV 85) | Inglés (TCGCSV 3) | Relación |
|---|---|---|
| m1L Mega Brave + m1S Mega Symphonia | ME01 Mega Evolution | 2 → 1 |
| M2 Inferno X | ME02 Phantasmal Flames | ~1 → 1, numeración distinta |
| SV11B Black Bolt / SV11W White Flare | SV: Black Bolt / SV: White Flare | 1 → 1 |
| SV10 Glory of Team Rocket (+ partes de SV9a) | SV10 Destined Rivals | N → 1 |
| SV8a Terastal Fest ex | SV: Prismatic Evolutions | parcial |
| Start Deck 100 Battle Collection, MC, Vending Machine Series 1–3, CoroCoro, World Hobby Fair, Premium Trainer Boxes japonesas | — | **exclusivos de Japón** |

Estas equivalencias son por nombre y contenido conocido; **el mapeo carta a carta JP↔EN NO MEDIDO** (solo
verifiqué Mega Charizard X ex). Consecuencia: el japonés **debe ser catálogo propio**, no una «variante» de la
carta inglesa.

## 2. PPT (PokemonPriceTracker)

| Qué | Resultado | Fuente |
|---|---|---|
| ¿Japonés? | **Sí, documentado**: `GET /api/v2/sets?language=japanese` y `GET /api/v2/cards?language=japanese`; «Japanese cards include pricing, images, and metadata». | https://www.pokemonpricetracker.com/api-reference (redirigida desde `/api-docs`) |
| Plan | En la página de precios, «Japanese card data» aparece en el plan **API $9.99/mes** (no en el gratis de 100 créditos/día). | https://www.pokemonpricetracker.com/pokemon-card-price-api |
| Otros idiomas (español) | **No se menciona ninguno** además de inglés y japonés. Ofrece «Cardmarket EUR prices (Beta)» solo en plan **Business $99/mes**. | mismas páginas |
| Uso comercial | La página lista «**Commercial use licensing**» solo en **Business $99/mes**. Qué plan tiene hoy la tienda: **NO MEDIDO** (no está en `HECHOS.md`). | pokemon-card-price-api |
| ¿Funciona sin llave? | No: `GET /api/v2/cards?language=japanese&limit=1` → **HTTP 401**. No probé con la llave (no se usan secretos). | curl |

## 3. Español

| Fuente | ¿Precio por idioma español? | Acceso | Medición |
|---|---|---|---|
| **Cardmarket API** | Tendría (filtro por idioma en artículos) | **Cerrada**: «Currently, we are not accepting applications for access to the Cardmarket API.» | https://help.cardmarket.com/en/cardmarket-api ; `api.cardmarket.com/ws/documentation` → HTTP 410 |
| **Cardmarket «Price Guide» público (JSON)** | **No.** Un precio por producto, **sin idioma**. Las cartas inglesas y españolas son **el mismo producto** (ej.: Tropius me05 ES → `idProduct` 895789, mismo que el inglés). Las japonesas **sí** son productos aparte (Inferno X JP = expansión 6291, 116 cartas). | **Abierto, sin login**: `downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json` (79,690 filas, creado 2026-10-06) y `.../productList/products_singles_6.json` (74,620 productos). Licencia para uso comercial: **NO MEDIDO**. | curl |
| **Páginas de Cardmarket con filtro de idioma** | Sí, a mano | **Bloqueadas** a peticiones automáticas: HTTP **403** (curl y WebFetch). | por eso **no pude medir** la proporción ES/EN |
| **TCGdex** (`/v2/es/...`) | **No.** Da precio, pero es el del producto inglés: misma ficha Cardmarket 895789 y TCGplayer 704758 que la carta inglesa. | Abierto, MIT | `GET https://api.tcgdex.net/v2/es/cards/me05-001` |
| **CardTrader API** | **Sí**: `GET /marketplace/products?blueprint_id=…&language=es` devuelve los 25 anuncios más baratos con `price.cents`. | Requiere **cuenta y token** (desde el perfil). Términos de uso comercial **NO MEDIDO**. No probado (exige cuenta). | https://www.cardtrader.com/docs/api/full/reference |
| TCGplayer / TCGCSV | No hay categoría en español (solo 3 = inglés y 85 = japonés de Pokémon). | — | lista de categorías |

**Proporción «ES = X % de EN»: NO MEDIDO.** Cardmarket bloquea con 403 cualquier lectura automática de sus
páginas, y ninguna fuente abierta separa el idioma español. Lo que la cerraría: (a) el dueño abre 10 cartas en
Cardmarket con el filtro «Español» e «Inglés» y anota el «Desde» de cada uno (10 minutos, sin cuentas nuevas), o
(b) una cuenta de CardTrader y su token para medirlo por API. Dato de contexto **no medido por mí**: foros
señalan que los sobres en español traen menos cartas y que muchas promos no salen en español.

## 4. Catálogo e imágenes en japonés (y español)

| Fuente | Japonés | Español | Imágenes | Licencia | Medición |
|---|---|---|---|---|---|
| **pokemontcg.io** | **No** (solo inglés; búsqueda `name:*japan*` → 0 sets; 176 sets en total) | No | Sí (inglés) | — | `GET https://api.pokemontcg.io/v2/sets` |
| **TCGdex** | **Sí, 184 sets** (nombres en japonés, ej. «インフェルノX»). Trae la referencia a TCGplayer: Mega Charizard X ex `M2-110` → `tcgplayer: 655886`, **el mismo productId que TCGCSV cat. 85** ⇒ se pueden enlazar. | **Sí, 156 sets** (`es`) + **11 sets `es-mx`** (nombres de México, ej. «Tinieblas Umbrías» vs «Oscuridad Absoluta» en `es`). | **Español: completas** (me05 120/120, sv03.5 207/207). **Japonés: huecos en lo reciente** — M2 0/116, M6 0/113, M1L 0/92, SV11B 0/174; SV10 98/132; SV8 106/138; SV2a 210/210. | **MIT** (base de datos y código). Las imágenes son arte de The Pokémon Company: derechos **NO MEDIDO** (igual que hoy con pokemontcg.io). | `GET https://api.tcgdex.net/v2/{ja,es,es-mx}/sets[/id]`; LICENSE y README en github.com/tcgdex/cards-database |
| **TCGCSV cat. 85** | Sí (460 grupos), nombres en inglés | No | `imageUrl` en todos los productos (CDN TCGplayer) | Espejo de terceros (la tienda ya depende de él) | ver §1 |

## 5. Cartas «Trainer» (no sabemos a cuáles se refiere el dueño)

| Variante | pokemontcg.io | TCGCSV (inglés, cat. 3) | Medición |
|---|---|---|---|
| **Trainer Gallery (TG)** — subsets de Brilliant Stars, Astral Radiance, Lost Origin, Silver Tempest (+ Galarian Gallery de Crown Zenith) | **Sets aparte**: `swsh9tg`, `swsh10tg`, `swsh11tg`, `swsh12tg`, `swsh12pt5gg`. Ej. `swsh9tg` = 30 cartas, número `TG01`, rareza «Trainer Gallery Rare Holo», con precio `holofoil`. Ojo: casi todas son de supertipo **Pokémon**, no Trainer. | **Grupos aparte**: 3020, 3068, 3172, 17674, 17689. Ej. 3020 = 30 productos con precio, número `TG13/TG30`, rareza «Ultra Rare». | `GET /v2/cards?q=set.id:swsh9tg`; `GET tcgcsv .../3/3020/prices` |
| **Trainer Kits** (EX, DP, HGSS, BW, XY, SM) | Solo los EX: `tk1a`, `tk1b`, `tk2a`, `tk2b` | 11 grupos (ej. 2208 «SM Trainer Kit: Alolan Sandslash & Alolan Ninetales», 62 productos / 60 con precio: el kit sellado y sus cartas) | listados de sets/grupos |
| **Trainer's Toolkit** (producto sellado) | No existe como set | No hay grupo con ese nombre; **dónde vive NO MEDIDO** (probablemente en el grupo del set o en «Miscellaneous Cards & Products», 2374) | búsqueda por nombre en grupos |
| **Supertipo Trainer** (Supporter, Item, Stadium, Tool) | `supertype:Trainer` → **2,812 cartas** | Mezcladas en cada set, sin marca de supertipo | `GET /v2/cards?q=supertype:Trainer` |
| **Promos de entrenador / liga** | Promos Black Star por era (`svp`, `swshp`…) | «Player Placement Trainer Promos» (24529: 4 productos «No. 1/2/3 Trainer», **sin precio**), «League & Championship Cards» (1539), «Professor Program Promos» (2332) | groups + products |
| **Japonés** | — | «Trainer Prize Cards» (24521), «Player Placement Trainer Promos» (24494), Premium Trainer Boxes (23806, 23837, …) en la cat. 85 | groups 85 |

Para saber a cuáles se refiere el dueño hay que preguntarle; lo más probable por precio y volumen es **Trainer
Gallery** (es lo único de la lista que la tienda vendería como cartas sueltas con frecuencia).

---

## Recomendación

| | Fuente recomendada | Costo | Riesgo |
|---|---|---|---|
| **Japonés — precio** | **TCGCSV categoría 85.** Mismo cliente y mismo formato que hoy; el cambio es que la categoría deja de ser una constante única. | **$0** | Bajo-medio: es la misma dependencia de terceros que ya tenemos. Sin `Reverse Holofoil`. Precio en USD (mercado de EE. UU. del japonés), igual que el inglés. |
| **Japonés — catálogo** | **TCGCSV 85 como fuente del catálogo** (nombre en inglés + número + rareza + imagen), con **TCGdex `ja`** opcional para el nombre japonés (se enlazan por `tcgplayer productId`, verificado en 1 carta). | **$0** | Medio: TCGdex no tiene imágenes de los sets japoneses recientes (M1–M6, SV11). Los sets JP **no** son los ingleses: el catálogo JP es aparte, con su propio mapeo de sets. |
| **Japonés — respaldo** | PPT `language=japanese` | $9.99/mes (plan API); uso comercial declarado solo en $99/mes | Revisar con el dueño qué plan tiene antes de depender de él. |
| **Español — catálogo e imágenes** | **TCGdex `es`/`es-mx`** (MIT, imágenes completas en lo medido) — o simplemente la misma carta inglesa marcada «idioma: español». | **$0** | Bajo. |
| **Español — precio** | **No hay fuente automática con precio propio del español.** Propuesta: **precio ES = precio EN (TCGCSV) × X %**, regla automática con el % configurable. | $0 | **Alto en el número X**: no está medido. Siguiente paso barato: el dueño mide 10 cartas a mano en Cardmarket (filtro idioma), o se evalúa CardTrader API (cuenta + token, términos por revisar). Hasta tener X, cualquier valor es inventado. |

Nada de esto toca código todavía; es material para el product-owner y el arquitecto (catálogo multi-idioma toca
`backend/prisma/` y `docs/API_CONTRACT.md`, zonas compartidas).

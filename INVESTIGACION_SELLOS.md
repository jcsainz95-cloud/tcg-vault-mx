# Investigación: cartas con sello Play! Pokémon (y otros sellos)

> **Medido el 2026-10-06** contra `main` en `3609125`. Solo lectura: GETs públicos a TCGCSV
> (`https://tcgcsv.com/tcgplayer/3/...`, ~60 peticiones), a pokemontcg.io (`/v2/sets`) y a su repositorio
> público de datos (`raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data`). No se tocó código.
> Los scripts y descargas viven en el scratchpad de la sesión; nada de eso está en el repo.

## Lo corto

- En TCGplayer/TCGCSV la carta con sello **es otro producto, con su propio `productId` y su propio
  precio**. Nunca es una variante (`subTypeName`) dentro del producto del set.
- Las de **Prize Pack** viven todas en **un solo grupo: `22880` «Prize Pack Series Cards»** (891
  productos). El nombre del producto **no dice de qué set es** ni dice «Prize Pack»: es
  `Nombre - número/total`, igual que la carta normal.
- Aun así **se pueden empatar solas** con la carta base: nombre + número (con total) da un set
  **único en 818 de 849** productos con número (96 %). Los 31 que no, tienen causa conocida.
- **pokemontcg.io no las tiene** (ni Prize Pack, ni liga, ni campeonatos, ni Staff/prerelease como
  carta aparte). Nuestro catálogo, que sale de ahí, nunca las va a traer solo.
- **Recomendación:** modelarlas como **un `CardProduct` más de la carta base** (nuevo `kind`, p. ej.
  `play_stamp`), igual que hoy se modelan los Deck Exclusives y las promos. **No** como acabado. El
  precio sale de TCGCSV grupo `22880`, por `productId`, con el mismo barrido diario.

---

## 1. Cómo vienen las Prize Pack en TCGCSV / TCGplayer

**Fuente:** `GET https://tcgcsv.com/tcgplayer/3/groups`, `.../3/22880/products`, `.../3/22880/prices`.

| Pregunta | Lo medido |
|---|---|
| ¿Grupo propio o variante dentro del producto del set? | **Grupo propio.** Un solo grupo para todas las series: `groupId 22880`, «Prize Pack Series Cards» (publicado 2022-11-30, última modificación de producto 2026-09-14). No hay un grupo por serie (One/Two/…). |
| ¿Cuántos productos? | 891. De ellos 849 traen `Number` (`006/163`), 42 no (energías básicas, los sobres sellados «Play! Pokemon Prize Pack Series One/Two…», «Code Card»). |
| ¿El nombre dice el set de origen? | **No.** Ejemplo: `Pikachu ex - 057/191`. Solo el **total** (`/191`) insinúa el set, y el total **choca** entre sets (p. ej. `/189` = Darkness Ablaze y Astral Radiance; `/086` = Black Bolt y White Flare). |
| ¿El nombre dice «Prize Pack» o «Play! Pokemon Stamp»? | **Casi nunca.** Solo 31 de 891 llevan sufijo: `(Prize Pack Series 1..7)` (energías y 4 cartas reeditadas en dos series), `(Left Stamp)` / `(Right Stamp)` (3, misma carta con el sello en otro lado). Lo que identifica que es Prize Pack es **el grupo**, no el texto. |
| ¿Una carta repetida en varias series tiene varios productos? | En general **no**: un solo producto aunque salió en varias series. Excepción medida: `Terapagos ex - 128/142` y `Teal Mask Ogerpon ex - 025/167` tienen producto separado por serie 6 y 7. |
| ¿Acabados? | `subTypeName` en los precios: Holofoil 532, Normal 436, Reverse Holofoil 4. Además hay 181 productos `… (Cosmos Holo)`: **otro `productId`** para la versión holo cósmica de la misma carta con sello. 101 cartas base tienen par «normal con sello» + «Cosmos Holo con sello». |

**Tres ejemplos, precio de mercado TCGplayer (USD, `marketPrice` en `/prices`, medido 2026-10-06):**

| Carta | Con sello (grupo 22880) | Sin sello (grupo del set) | Relación |
|---|---|---|---|
| Pikachu ex 057/191 (Surging Sparks) | `648703` Holofoil **$26.39** | `590025` (grupo `23651`) Holofoil **$4.69** | ×5.6 |
| Dragapult ex 130/167 (Twilight Masquerade) | `619078` Holofoil **$24.96** | `550174` (grupo `23473`) Holofoil **$4.02** | ×6.2 |
| Buddy-Buddy Poffin 144/162 (Temporal Forces) | `565451` Normal **$0.22** · `703819` Cosmos Holo **$1.35** | `542659` (grupo `23381`) Normal **$0.28** · Reverse **$0.87** | ×0.8 / — |

En 5 sets (Silver Tempest, Paldea Evolved, Temporal Forces, Twilight Masquerade, Surging Sparks), con
**N = 102** pares (mismo acabado, ambos con precio): mediana **×2.15**, percentil 10 **×0.81**,
percentil 90 **×11.1**; **17 %** valen *menos* que la normal. Es decir: **no sirve un multiplicador**
sobre la carta base; hace falta el precio propio del producto con sello.

## 2. Otras cartas con sello

**Fuente:** productos y precios de los grupos `1539`, `22872`, `24451` y de 50 grupos de sets SWSH/SV/ME
(publicados desde 2020). Se buscaron en los nombres: stamp, staff, prerelease, league, championship,
worlds, regional, play! pokemon, prize, winner.

| Tipo de sello | Dónde está en TCGCSV | Cómo se ve el nombre | Ejemplo con precio (USD) |
|---|---|---|---|
| Liga (Pokémon League, League Promo, League Challenge/Cup) | Grupo `1539` «League & Championship Cards» (mezcla de todas las épocas) | `Volcanion - 25/114 (Pokemon League)`, `… (League Promo)`, `… (League Challenge) [1st Place]` | — |
| Campeonatos (Regional, Nacional, Internacional, Worlds) | Grupo `1539` y, en SV/ME, los grupos de promos `22872` / `24451` | `Buddy-Buddy Poffin - 144/162 (North America International Championship)` · `Paradise Resort - 045 (World Championships 2023)` | Poffin NAIC `638138` Reverse **$15.25**; con `[Staff]` `638139` **$26.58** (normal del set: $0.28) |
| Prerelease y Staff (SV en adelante) | Grupo de promos de la era: `22872` «SV: Scarlet & Violet Promo Cards», `24451` «ME: Mega Evolution Promo» | `Quaquaval - 005 (Prerelease)` · `Quaquaval - 005 (Prerelease) [Staff]` · `Gouging Fire - 151 (Staff)` | Quaquaval `487751` **$1.43** vs Staff `522650` **$40.01**; Gouging Fire `594382` **$4.93** vs Staff `607013` **$34.96** |
| Sello de set / de lanzamiento | Grupo de promos de la era | `Slowbro - 083 (Pitch Black Stamped)` · `Sprigatito - 191 (Pokemon Horizons Stamped)` | Slowbro `706129` **$19.35**, `[Staff]` `707701` **$68.64** |
| Premios (Winner, Player Placement) | `24451` y grupo `24529` «Player Placement Trainer Promos» | `Pikachu - 093 (Winner)` | `716740` **$137.05** vs `712963` sin sello **$9.85** |
| Dentro de los grupos de **set** (SV/SWSH/ME) | **Ninguno encontrado.** 0 productos con esas palabras en los 50 grupos de set. | — | — |

Dos cosas importantes para empatarlas:
- Las de **liga/campeonato** (grupo `1539`) llevan el **número del set** (`144/162`) → se pueden colgar de la
  carta base como las Prize Pack. Ojo: no siempre llevan etiqueta — `Buddy-Buddy Poffin - 144/162`
  (`554531`, $1.67) está en `1539` sin paréntesis; lo que la marca como sellada es el grupo.
- Las de **prerelease / Staff / sello de set** de SV y ME llevan el **número de la promo** (`005`, `151`,
  `083`), no el del set: su carta base es la **promo SVP/MEP**, no una carta de set. El sello es
  `(…)` y el «Staff» va entre corchetes `[Staff]`.

**¿Y pokemontcg.io?** Ver punto 3: ninguna de estas existe allí como carta aparte.

## 3. pokemontcg.io

**Fuente:** `GET https://api.pokemontcg.io/v2/sets?pageSize=250` (200, 176 sets, el más reciente
2026-09-16). Los endpoints de cartas (`/v2/cards?q=…` y `/v2/cards/{id}`) respondieron **500 / 502** el
2026-10-06, así que las cartas se midieron en su repositorio de datos público
(`PokemonTCG/pokemon-tcg-data`, `cards/en/svp.json` y `sets/en.json`).

| Pregunta | Lo medido |
|---|---|
| ¿Tiene un set Prize Pack? | **No.** Ningún set con «prize», «league», «championship» o «play» en el nombre (176 sets). |
| ¿Tiene las de liga / campeonato? | **No** hay set para ellas. Solo existen los sets de Black Star Promos (`svp`, `swshp`, `smp`, …) y McDonald's. |
| ¿Distingue Staff / Prerelease / sellos dentro de las promos? | **No.** `svp-5` Quaquaval y `svp-151` Gouging Fire existen **una sola vez**; en `svp.json` (165 cartas) no aparece «stamp», «prerelease» ni «staff». La versión con sello y la normal son la misma carta para pokemontcg.io. |
| ¿Trae precio de la versión con sello? | **NO MEDIDO** directamente (API de cartas caída). Por lo anterior, no puede tenerlo: no tiene la carta. |

Conclusión: **pokemontcg.io no sirve para estas cartas.** Toda la identidad y el precio tienen que salir de
TCGCSV.

## 4. Cómo empatarlas automáticamente con nuestra carta base

**Método medido:** para cada producto Prize Pack con `Number`, quitar del nombre lo que va entre `()` y
`[]`, y buscar en los 50 grupos de set (SWSH/SV/ME desde 2020) un producto con **el mismo nombre y el
mismo `Number` completo** (`057/191`).

| Resultado | Productos | Por qué |
|---|---|---|
| **Set único** (empate limpio) | **818 / 849 (96 %)** | — |
| Ambiguo (2 sets) | 19 | 3 por reediciones en «ME: 30th Celebration Classic Collection» (grupo suplementario: se excluye y queda único); 16 energías básicas `009–016` que existen igual en SVE y MEE. |
| Sin pareja | 12 | Cartas de grupos que no bajé: promos SWSH (`SWSH149`…), Champion's Path (`/073`), Shining Fates (`/072`). Esperable que empaten al incluir esos grupos. **NO MEDIDO** con esos grupos. |
| Sin número | 42 | Energías `(Prize Pack Series N)`, sobres sellados y Code Cards: no son cartas a colgar. |

| ¿Qué tan confiable es cada señal? | Veredicto |
|---|---|
| Texto «(Prize Pack)» / «Play! Pokemon Stamp» en el nombre | **No sirve:** solo 31 de 891 lo traen. La señal es el **grupo `22880`**. |
| Solo el total (`/191`) para saber el set | **No sirve sola:** choca entre sets (`/189`, `/086`, `/198`…). |
| Nombre + número completo | **Sirve:** 96 % único con los grupos bajados; los ambiguos tienen regla clara (excluir suplementarios). |
| Nombre + número + set ya resuelto en nuestro catálogo | **La mejor:** nosotros ya sabemos el `groupId` de cada set (`tcgcsv-group-match.ts`) y el `tcgplayerProductId` de cada carta base. Basta con: «producto de `22880` cuyo nombre y `Number` coinciden con un producto **set_base** que ya tenemos» → se cuelga de **esa** carta. Así se usa el join que ya existe en vez de adivinar el set. |

Regla money-safe recomendada (misma filosofía que el resto del catálogo): si el empate no es **único**, no
se cuelga y queda en un reporte para el operador. Nunca se adivina.

## Recomendación: cómo modelarlas

**Producto aparte colgado de la carta base. No acabado.**

Cómo funciona hoy (medido en código):
- Cada carta (`Card`) agrupa N `CardProduct`, uno por `productId` de TCGplayer, con su `kind`
  (`set_base`, `deck_exclusive`, `promo`, `other`) y sus acabados — `backend/prisma/schema.prisma:958` y
  `:373`.
- Los `deck_exclusive`/`promo` ya son «la misma carta, pero otro producto con otro precio»: no se mezclan
  con los acabados de la carta del set (`backend/src/common/card-order.ts:54-77`) y se muestran aparte
  (`docs/API_CONTRACT.md:9052-9058`).
- La pieza física ya guarda **qué producto es** (`InventoryItem.cardProductId`, el `productId` de
  TCGplayer; `schema.prisma:1047`), justo para no contar «8 iguales» cuando son 5 normales y 3 promo.
- El resolutor **solo baja el grupo del set** (`card-product-resolver.service.ts:80-83`), por eso hoy las
  Prize Pack (grupo `22880`) y las de liga (`1539`) **nunca entran**. Y el clasificador por nombre
  (`tcgcsv-singles.provider.ts:139-145`) no las reconocería: `Pikachu ex - 057/191` no dice «promo».

Por qué **no** como acabado:
1. En la fuente **son otro producto**, con su propio precio; nunca son un `subTypeName` del producto del set.
2. Una carta con sello **tiene sus propios acabados** (normal con sello y Cosmos Holo con sello son dos
   productos distintos). Sello × acabado no cabe en un solo campo `finish`.
3. El precio **no es proporcional** a la carta base (de ×0.8 a ×11, N = 102): no se puede derivar.

Propuesta (para que la aterrice el **arquitecto**, porque toca el schema y el contrato — regla 9):
- Nuevo `CardProductKind`, p. ej. **`play_stamp`** (o reutilizar `promo`; ver abajo). Se trata igual que
  `promo`: **no** compone `availableFinishes` de la carta base y se ofrece como producto aparte.
- Un **paso nuevo del resolutor** que baje el grupo `22880` (una vez, no por set) y cuelgue cada producto
  de la carta base por la regla del punto 4 (nombre + `Number` igual al de un `set_base` ya conocido;
  único o nada). Lo mismo, después, para el grupo `1539` (liga/campeonatos con número de set).
- **Precio automático:** TCGCSV `22880/prices`, `marketPrice` por `subTypeName`, por `productId` — el
  mismo camino (`tcgcsv_singles`, USD→MXN Banxico) que ya usan las promos y Deck Exclusives. Sin precio ⇒
  pendiente, jamás 0.
- **¿`play_stamp` o `promo`?** Un `kind` propio deja decir en la tienda «Sello Play! Pokémon» en vez de
  «Promo» y separar reportes; reutilizar `promo` no toca el enum. Es decisión de producto/arquitecto,
  **no medida aquí**.
- Las **Staff / Prerelease / «Stamped»** de SV y ME cuelgan de la **promo** (SVP/MEP), no de una carta de
  set; requieren que esas promos estén en nuestro catálogo. **NO MEDIDO** si hoy lo están.

## Lo que quedó sin medir

- Empate de los 12 Prize Pack sin pareja contra grupos SWSH Promos, Champion's Path y Shining Fates.
- Tasa de empate de las de liga/campeonato (`1539`) contra nuestra carta base.
- Si nuestro catálogo (`Card` de pokemontcg.io) tiene cargadas todas las cartas base y promos
  necesarias (requiere la base de datos, que no consulté).
- Precios de pokemontcg.io para estas cartas (API de cartas caída el 2026-10-06; de todos modos no las
  tiene como carta aparte).

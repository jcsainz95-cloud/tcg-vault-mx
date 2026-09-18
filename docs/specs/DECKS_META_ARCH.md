# DECKS META — Diseño de arquitectura y contrato

> **Qué es.** El **diseño del arquitecto** para el feature *Decks Meta para jugar*, a partir del borrador
> del product-owner (`docs/specs/DECKS_META_DRAFT.md`) y de la entrada cruda del dueño
> (`docs/specs/DECKS_META_V1.md`). **Es DISEÑO y CONTRATO: nada se construye aquí.** El orquestador enruta
> esto a backend y frontend. Lo canónico del contrato vive en `docs/API_CONTRACT.md §13`; lo canónico del
> schema/módulos en `docs/ARCHITECTURE.md §12`. Este documento es la narrativa completa (razones, fases,
> desglose) para que ambos roles trabajen sin re-preguntar.
>
> **Autor:** arquitecto · **Fecha:** 2026-09-18 · **Base:** `origin/production` `cd0bf02c` · **Rama:**
> `claude/arch-decks-meta` · **Estado:** DISEÑO para aprobación/enrutado. **No implementar hasta enrutar.**

---

## 0. Resumen ejecutivo (en llano)

El feature muestra el **top-10 del meta de Pokémon (formato Standard)**, y por cada deck cruza su lista con
nuestro inventario para decir **qué tenemos, a qué precio, y agregar de jalón lo disponible al carrito**.
Mismo motor sirve el **"pegar lista"** (H3). Regla dura del dueño: **solo se ofrece como jugable lo que es
legal en Standard hoy**; lo rotado/faltante se marca y se **sugiere un sustituto legal**.

**Lo que hay que construir, en orden:**

1. **Prerequisito (zona compartida, lo serializo yo):** el catálogo **no guarda legalidad hoy** (medido). Se
   añaden **dos campos a `Card`** (`regulationMark`, `legalStandardRaw`), se mapean del proveedor (coste de
   red **cero**: el doc ya se descarga entero), y "legal en Standard hoy" se **deriva en lectura** contra una
   **ventana de regulation marks configurable** (`ConfigSetting`) — así **la rotación es un cambio de config,
   no un re-sync de cada carta**.
2. **Módulo `decks-meta` (backend) + vistas (frontend), en paralelo:** el **matcher** (set + número ↔ nuestra
   `Card`), el motor "pegar lista", la disponibilidad (reusando precios/catálogo existentes) y el "agregar de
   jalón" al carrito cliente existente. Arranca con **top-10 curado a mano** (no depende de red).
3. **Job semanal (backend):** traído automático de Limitless, **fijado + canario + fallback manual**.
   Verificable **solo en producción** (egress bloqueado en dev, medido).
4. **Sustitución legal + "avísame":** encontrar otra impresión **legal** de la misma carta; "avísame" reusa
   el **Centro de Avisos ya normado en el contrato (§R)**.

**Números:** cambio de schema = **2 columnas + 1 índice + seed de config** (migración aditiva, rollback
limpio). Matcher = **1 motor** para top-10, pegar-lista y curaduría. Endpoints nuevos = **3 públicos
(+1 opcional) y 3 admin**. **Limitless API vs scraping = NO MEDIDO** (egress bloqueado); se diseña contra
fixture con adaptador fijado+canario.

---

## 1. Realidades medidas (por el arquitecto, 2026-09-18, sobre `origin/production` `cd0bf02c`)

| # | Hecho | Cómo se midió |
|---|---|---|
| M1 | `Card` **no** tiene campo de legalidad ni regulation mark | `git show …:backend/prisma/schema.prisma` líneas 684–770: campos = `externalId,setId,name,number,rarity,supertype,subtypes,image*,tcgplayerId,availableFinishes,catalogFinishes,pricedFinishesSnapshot,structuralFinishes,rarityCanonical,numberSort,numberPrefix`. Ninguno de legalidad. |
| M2 | El cliente del proveedor **no** mapea `regulationMark`/`legalities` | `git grep -i "regulationmark\|legalit"` sobre `backend/src` = **0 ocurrencias**. `RemoteCard` (`pokemontcg-io.client.ts:33`) no declara esos campos. |
| M3 | El doc del proveedor **ya se descarga entero** (no hay `select=`) | `pokemontcg-io.client.ts:44–49`: el bloque `cardmarket` se tipó "porque `GET /v2/cards?q=set.id:*` NO usa `select=`, así que YA venía en el JSON y se estaba descartando ⇒ CERO requests extra". El mismo mecanismo aplica a `regulationMark`/`legalities`. |
| M4 | El código corto de set (`ptcgoCode`) **se guarda** y `number` también, pero no se exponen (P-71) | `CardSet.ptcgoCode` (schema:591), `Card.number` (schema:690). Es el identificador del matcher. |
| M5 | El carrito es **de cliente**, un array de `inventoryItemId` (pieza única) | `frontend/src/lib/cart.ts`: `useCart()` sobre `localStorage` `tcg.cart`, `add/remove/prune/clear`. Sin backend de carrito. |
| M6 | La unidad de compra es la **pieza física** (`InventoryItem`), y el checkout toma `inventoryItemIds[]` | `orders/dto/guest-checkout.dto.ts`: `GuestQuoteDto.inventoryItemIds[]`, `GuestSessionDto.inventoryItemIds[]`. |
| M7 | El catálogo vendible se lee con un `where` estable y hay motor de precios en lote | `catalog/catalog.service.ts` `fetchSellable` (`ownerType='platform' AND status='listed' AND productType<>'sealed'`); `pricing.service.ts:877` `getReferencesBatch(items)→Map`. La ficha `GET /catalog/cards/:cardId` ya expone `units: ListingDTO[]` cheapest-first **para add-to-cart por `inventoryItemId`**. |
| M8 | Solo se acepta/publica **Near Mint** | `common/business-rules.ts`: condición de carta suelta = solo NM. |
| M9 | Egress a Limitless **y a pokemontcg.io** bloqueado en dev | `curl -m8` 2026-09-18: `play.limitlesstcg.com:443` y `api.pokemontcg.io:443` → **403 `connect_rejected`** (política de organización, O-17). |
| M10 | El **Centro de Avisos** ya está normado en el contrato | `API_CONTRACT.md §R` (v1.74, criterios 198–212). El "avísame cuando llegue" reusa §R; **no** se construye un avisador propio (corrige la referencia del borrador PO a "futuro P-96"). |
| M11 | Hay patrón de jobs BullMQ con cron override por env | `jobs/scheduler.service.ts`: p. ej. `catalog-metadata-sync` (`CATALOG_METADATA_SYNC_CRON` default `0 1 * * *`), `price-ingest-1/2`. |
| M12 | Existe la convención §0-Q para ejes de query de dominio cerrado, con censo ejecutable `C-EQ-1` | `API_CONTRACT.md §0` "Filtro de ENUM en query"; suite `enum-filter.spec.ts`. Todo `@Query` nuevo se registra o la suite lo marca huérfano. |

---

## 2. PREREQUISITO — Legalidad en el catálogo

**Sin esto, ningún criterio del dueño se cumple** (no podemos afirmar "legal en Standard"). Es **zona
compartida** (`schema` + `catalog` + `API_CONTRACT`): lo serializa el arquitecto/orquestador **antes** de
abrir el módulo `decks-meta`.

### 2.1 Cambio de schema (exacto)

Dos columnas nullable en `model Card`, más un índice:

```prisma
model Card {
  // … campos existentes …

  // DECKS-META §2 — LEGALIDAD. Crudo del proveedor, PROCEDENCIA. Nullable: promos/sets viejos sin
  // marca, o carta aún no re-sincronizada. La escribe SOLO catalog-sync.upsertCards con NO-DEGRADACIÓN
  // (ausente ⇒ la clave no viaja ⇒ columna intacta), igual que imageLargeUrl/logoUrl.
  regulationMark   String?   // pokemontcg.io RemoteCard.regulationMark ("F","G","H","I"…). scrydex: equivalente (NO MEDIDO, §8).
  legalStandardRaw String?   // pokemontcg.io RemoteCard.legalities.standard ("Legal"|"Banned"); ausente ⇒ null. scrydex: legalities[standard]. Banda de seguridad para bans explícitos.

  // … relaciones e índices existentes …
  @@index([regulationMark])   // sirve la sustitución legal y la evaluación por lote
}
```

**Por qué DOS campos y no un booleano `isLegalStandard`:** un booleano persistido habría que **recalcular y
reescribir en cada carta** cuando rota el formato. En cambio guardamos los **hechos crudos** (marca + string
del proveedor) y **derivamos** la legalidad en lectura contra una **config de ventana vigente** (§2.3). Así la
rotación es **una edición de config**, no un backfill masivo. Es la doctrina del proyecto: guardar procedencia,
derivar lo computable (paralelo exacto a `rarity` crudo → `rarityCanonical`, §4.28c).

**Por qué escalar y no `Json legalities`:** el dueño acotó a **un formato (Standard)**. Un escalar es typeable
e indexable; si más adelante entra Expanded se añade `legalExpandedRaw String?` con el mismo patrón (P4 abierta).

### 2.2 Mapeo desde el proveedor

- **`pokemontcg-io.client.ts` — `RemoteCard`:** añadir
  ```ts
  regulationMark?: string;
  legalities?: { standard?: string; expanded?: string; unlimited?: string } | null;
  ```
  ⭐ **Coste de red = CERO** (M3): el endpoint `GET /v2/cards?q=set.id:*` **no** usa `select=`, así que estos
  campos **ya vienen en el payload** y hoy se descartan — exactamente como pasaba con `cardmarket`. **NO MEDIDO
  (egress, M9):** que el payload en vivo traiga hoy esos campos poblados. Se sabe que la API los publica; se
  **confirma en producción** o contra la fixture de formato.
- **`catalog-sync.service.ts` — `upsertCards`:** mapear a las dos columnas con **NO-DEGRADACIÓN** (patrón ya
  vivo para `logoUrl`/imágenes, sync líneas 1267/1305): si la clave no viene con valor bueno, **no viaja** en el
  `update` ⇒ Prisma deja la columna intacta. En `CREATE`, `regulationMark ?? null`. Nunca sobrescribe con `null`.
- **scrydex (equivalente):** scrydex publica legalidades por formato y una marca de regulación/expansión; el
  **nombre exacto del campo es NO MEDIDO** (egress bloqueado, M9). El adaptador scrydex mapea a **las mismas dos
  columnas** detrás de la interfaz `RemoteCard`, de modo que el resto del sistema no distingue proveedor.

### 2.3 "Legal en Standard hoy" — evaluación derivada

Helper puro compartido, `backend/src/common/standard-legality.ts` (money-safe, sin I/O):

```ts
// activeMarks y banlist salen de ConfigSetting (una lectura cacheada por request).
export function isLegalStandardNow(
  card: { regulationMark: string | null; legalStandardRaw: string | null; externalId: string },
  cfg: { activeMarks: string[]; banlistCardIds: string[] },
): boolean {
  if (!card.regulationMark) return false;                 // no se puede probar ⇒ NO legal (conservador)
  if (!cfg.activeMarks.includes(card.regulationMark)) return false; // rotó fuera de la ventana
  if (card.legalStandardRaw === 'Banned') return false;   // ban del proveedor (banda)
  if (cfg.banlistCardIds.includes(card.externalId)) return false;   // override de operación (tirantes)
  return true;
}
```

**Config (reusa `ConfigSetting {key, valueJson}`, ya existe — schema:1593):**

| key | valueJson (ejemplo) | quién edita |
|---|---|---|
| `standard.active_regulation_marks` | `["G","H","I"]` | operación, cuando el anuncio oficial declara la rotación |
| `standard.banlist_card_ids` | `[]` | operación (raro; bans puntuales sobre lo que el proveedor no marcó) |

**Rotación = editar `active_regulation_marks`.** No hay job de legalidad ni backfill: la próxima lectura ya
evalúa contra la ventana nueva. Esto realiza literalmente el requisito del dueño *"la rotación la define un
regulation mark mínimo vigente"* (aquí, el **conjunto** vigente; "mínimo" se expresa como el conjunto de marcas
≥ la mínima, que operación fija en un lugar).

**Regla money-safe:** `regulationMark == null` ⇒ **no legal**. Nunca ofrecemos como jugable algo cuya
legalidad no podemos probar. Una carta sin re-sincronizar aún cae aquí hasta que el sync la puebla.

### 2.4 Migración + rollback (en llano)

**Migración (aditiva, sin reescritura de tabla — `ADD COLUMN` nullable es instantáneo en Postgres):**

```sql
ALTER TABLE "Card" ADD COLUMN "regulationMark" TEXT;
ALTER TABLE "Card" ADD COLUMN "legalStandardRaw" TEXT;
CREATE INDEX "Card_regulationMark_idx" ON "Card" ("regulationMark");
-- seed de config (idempotente): la ventana de arranque la fija operación antes del deploy
INSERT INTO "ConfigSetting" ("key","valueJson","updatedAt")
VALUES ('standard.active_regulation_marks','["G","H","I"]', now()),
       ('standard.banlist_card_ids','[]', now())
ON CONFLICT ("key") DO NOTHING;
```

**Qué le pasa a la base:** dos columnas nuevas vacías (todas las filas quedan en `null` hasta el backfill) y
dos filas de config. **No toca ninguna columna existente**, no reescribe, no bloquea. Las lecturas de
decks-meta van **detrás de un feature-flag** hasta que el backfill haya corrido lo suficiente.

**Rollback (limpio, sin pérdida):**

```sql
DROP INDEX "Card_regulationMark_idx";
ALTER TABLE "Card" DROP COLUMN "regulationMark";
ALTER TABLE "Card" DROP COLUMN "legalStandardRaw";
DELETE FROM "ConfigSetting" WHERE "key" IN ('standard.active_regulation_marks','standard.banlist_card_ids');
```

Como la legalidad es **derivada** (no hay booleano persistido) y **ni el precio ni las órdenes ni el binder
dependen de estas columnas**, dropearlas + apagar el flag revierte el feature sin efecto colateral. Lo único
irrecuperable de cualquier migración —la foto anterior— aquí no aplica: no borramos ni transformamos nada.

### 2.5 Backfill

Reusar el job **`catalog-metadata-sync`** (M11): con el mapeo de §2.2 ya escribiendo, cada corrida puebla las
dos columnas de forma **progresiva e idempotente** (por `externalId`, NO-DEGRADACIÓN). No hace falta un backfill
de un solo golpe; puede forzarse un barrido completo (`importSet --force` por set) para acelerar. Hasta que una
carta se puebla, `isLegalStandardNow` la trata como no-legal (conservador, §2.3). **Verificación del payload en
vivo: producción** (egress bloqueado en dev, M9). En dev/CI se prueba contra **fixture** de `RemoteCard` con
`regulationMark`/`legalities`.

---

## 3. Módulo `decks-meta` (backend)

Nuevo módulo `backend/src/modules/decks-meta/` (disjunto del mapa de streams existente; lee `catalog`,
`pricing`, `inventory`; escribe solo lo suyo). Frontend: `frontend/src/app/[locale]/(storefront)/decks-meta/`.

### 3.1 Modelo de datos (Prisma)

Se simplifica la propuesta de `DECKS_META_V1.md §7` a lo que las 3 historias necesitan. Separación clave:
**deck** (arquetipo persistente) vs **lista** (inmutable, con fecha y fuente).

```prisma
enum MetaDeckSource   { limitless  manual }
enum MetaCardGroup    { pokemon  trainer  energy }
enum MetaMatchStatus  { matched  ambiguous  unmatched_set  unmatched_number  unmatched_basic_energy }

model MetaDeck {
  id              String        @id @default(uuid())
  slug            String        @unique          // /decks-meta/{slug}
  name            String
  source          MetaDeckSource @default(manual) // manual = curado (fallback); limitless = auto
  sourceRef       String?                          // id/url del arquetipo en Limitless
  rank            Int?                             // posición en el meta (1..10)
  sharePct        Float?                           // % del meta, si la fuente lo da
  trend           Int?                             // share_actual − share_anterior (▲▼=)
  published       Boolean       @default(false)
  pausedByOperator Boolean      @default(false)    // el operador congela publicación sin borrar
  currentListId   String?       @unique
  currentList     MetaDeckList? @relation("CurrentList", fields: [currentListId], references: [id])
  imageCardId     String?                          // Card cuyo arte representa el deck en la teja
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  lists           MetaDeckList[] @relation("DeckLists")
  @@index([published, rank])
}

model MetaDeckList {                               // INMUTABLE: una lista concreta con su fecha y fuente
  id              String     @id @default(uuid())
  deckId          String
  deck            MetaDeck   @relation("DeckLists", fields: [deckId], references: [id])
  formatLabel     String                           // "Standard 2026-27"
  activeMarksSnapshot Json                          // ventana vigente al capturar (procedencia)
  sourceUrl       String?
  sourceTournament String?
  fetchedAt       DateTime   @default(now())
  supersededById  String?                          // apunta a la lista que la reemplazó
  cards           MetaDeckCard[]
  currentOf       MetaDeck?  @relation("CurrentList")
  @@index([deckId, fetchedAt])
}

model MetaDeckCard {                               // una línea de la lista
  id            String         @id @default(uuid())
  listId        String
  list          MetaDeckList   @relation(fields: [listId], references: [id])
  rawName       String
  rawSetCode    String                             // "TWM"
  rawNumber     String                             // "130"
  quantity      Int
  group         MetaCardGroup
  matchStatus   MetaMatchStatus @default(unmatched_set)
  matchedCardId String?                            // FK lógica a Card; null si no casó (NO se inventa)
  matchedCard   Card?          @relation(fields: [matchedCardId], references: [id])
  createdAt     DateTime       @default(now())
  @@index([listId])
  @@index([matchStatus])       // sirve el reporte de curaduría (no-mapeadas)
}

model MetaFetchRun {                               // provenance + canario del job semanal
  id          String   @id @default(uuid())
  runAt       DateTime @default(now())
  source      MetaDeckSource
  formatVersion String                             // versión FIJADA del formato Limitless (candado)
  deckCount   Int
  applied     Boolean                              // false = no pasó validación; se conservó lo último bueno
  note        String?
}
```

Notas:
- **No hay tabla de precios** (se calcula al render, §3.4). **No hay tabla de alertas** (reusa §R). **No hay
  tabla de compras** ("qué cambió" es extra opcional, §10). Se recorta lo de `V1` que el dueño **no** dio por
  obligatorio.
- `matchedCardId` referencia `Card`: requiere añadir la relación inversa `metaDeckCards MetaDeckCard[]` en
  `Card` (aditivo). Es lectura; una carta que sale del catálogo no borra la línea (la línea guarda el crudo).

### 3.2 El matcher — el corazón (R3 del borrador)

Un **solo motor** parsea+empareja, y sirve las tres bocas: pegar-lista (H3), traído semanal (H2) y carga
manual del operador. Ubicación: `decks-meta/deck-list.parser.ts` + `deck-matcher.service.ts`.

**Parser (formato exportación Limitless / TCG Live):**
- Línea de carta: `^\s*(\d+)\s+(.+?)\s+([A-Za-z]{2,4})\s+([A-Za-z]*\d+[A-Za-z]*)\s*$` → `{qty, name, setCode, number}`.
- Ignora encabezados de sección (`Pokémon: 12`, `Trainer: N`, `Energy: N`), líneas en blanco y el pie
  `Total Cards: 60`. Deriva `group` de la sección activa.
- **Energía básica sin set/número** (p. ej. `8 Basic Fire Energy`): `group=energy`,
  `matchStatus=unmatched_basic_energy`. Las básicas **siempre son legales**; decisión: **marcar, no inventar**
  una pieza (no las vendemos como línea de deck salvo que casen a una `Card` real de energía básica por set+nº).

**Emparejado (identificador fiable = set + número, NO el nombre — R3):**
1. `setCode` → `CardSet` por `ptcgoCode` (case-insensitive, `trim`). Desconocido ⇒ `unmatched_set`.
2. `CardSet.id` + `number` (igualdad exacta de string) → `Card`. Sin fila ⇒ reintento normalizado (quita ceros
   a la izquierda; respeta prefijos `TG/GG/SV` que `Card.numberPrefix` ya modela, §4.22b). Sin fila ⇒
   `unmatched_number`.
3. Varias candidatas (colisión de `ptcgoCode`) ⇒ `ambiguous`.
4. Éxito ⇒ `matched`, guarda `matchedCardId`.

**Qué pasa con lo que no casa:** se **persiste el crudo** en `MetaDeckCard` con su `matchStatus`, se **muestra
como "no identificada"** en la vista (nunca se inventa carta ni precio — regla dura del dueño) y alimenta el
**reporte de curaduría** admin (`GET /admin/decks-meta/unmatched`). Es la misma clase de cruce que P-72/P-46
(precios de terceros): se **registra para curar**, no se adivina.

### 3.3 Traído semanal de Limitless (Fase 2 — solo prod)

Job BullMQ repetible `decks-meta-refresh` (patrón M11), cron **semanal** override por env
`DECKS_META_REFRESH_CRON` (default `0 12 * * 1` = lunes 12:00 UTC ≈ 06:00 CDMX). Flujo por corrida:

1. **Fetch** vía adaptador Limitless (API o scraping — NO MEDIDO, §8), detrás de un **formato FIJADO+versionado**.
2. **Parse** con el mismo parser (§3.2) → arquetipos + listas.
3. **Validación / canario:** si el parseo rinde **< 8 arquetipos válidos** o el formato no encaja con la versión
   fijada ⇒ **no se aplica nada**, se **conserva lo último bueno**, se registra `MetaFetchRun{applied:false}` y
   se **avisa a operación** (email `[TCG HUNT Marketing]`). Esto materializa el criterio del dueño de "no queda
   roto ni muestra datos falsos".
4. **Aplica:** por arquetipo, si la lista difiere de la actual, crea `MetaDeckList` **nueva** (inmutable), fija
   `currentListId`, corre el matcher. Arquetipo fuera del top-10 varias corridas ⇒ `published=false`
   (conserva datos). `pausedByOperator=true` impide publicar aunque venga.
5. **La legalidad NO se recalcula aquí** — es derivada (§2.3). Una rotación es una edición de config, no una
   corrida del job.

**Verificación:** el jalón real (fetch + formato) **solo se prueba en producción** (egress bloqueado, M9). En
dev/CI el job se prueba contra **fixture** del formato Limitless; el candado de versión tiene su **canario** que
enrojece cuando el upstream deriva (doctrina CLAUDE.md: toda dependencia externa fijada+vigilada).

**Respaldo de curaduría manual (resiliencia, va desde la Fase 1):** el operador puede **pegar/subir** un top-10
curado desde admin (mismo formato, mismo motor). `MetaDeck.source=manual`. Así el feature **entrega valor sin
depender de que Limitless esté arriba**, y si el job falla, la última lista buena (auto o manual) sigue viva.

### 3.4 Disponibilidad + precio (reusar, NO reinventar)

Por cada línea `matched`:
- **Disponibilidad:** contar piezas vendibles NM de esa `Card` reusando el `where` de `fetchSellable` (M7):
  `ownerType='platform' AND status='listed' AND productType<>'sealed'`, condición **NM** (M8), por `cardId`.
  `availableQty = min(quantity, stockNM)`. Contador del deck = `Σ availableQty` de las líneas **legales**.
- **Precio:** el mismo `salePriceCents` que la ficha/rejilla ya publica, con referencias vía
  `getReferencesBatch` (M7). **No se reinventa el precio** ni se guarda en tablas de decks (se calcula al
  render, como cualquier carta).
- **Piezas concretas para el carrito:** reusar `units: ListingDTO[]` (cheapest-first) de
  `GET /catalog/cards/:cardId` (M7) y tomar los primeros `availableQty` `inventoryItemId`.
- **Compuerta de legalidad:** una línea solo se ofrece como jugable si `isLegalStandardNow(matchedCard)` (§2.3).
  Rotada/ilegal ⇒ no se ofrece; se intenta sustituto (§5).

---

## 4. Motor "pegar lista" (H3)

Es **el mismo** motor (§3.2 + §3.4), invocado sin persistir: `POST /decks-meta/paste` recibe el texto,
parsea+empareja+valora **en memoria** y devuelve la **misma vista de disponibilidad** que el detalle de un deck
del top-10 (por eso construir H3 hace casi todo H2). Líneas que no casan ⇒ `matchStatus` no-mapeado, "no
identificada", sin inventar. Rate-limited (`429`). Texto vacío / sin líneas válidas ⇒ `422
DECK_LIST_UNPARSEABLE`.

---

## 5. Sustitución legal (Fase 3)

Dada una línea **faltante** (sin stock) o **rotada/ilegal**, buscar **otra impresión de la MISMA carta** que
sea **Standard-legal hoy** y **esté en inventario**:

```
Card donde  normalizeName(name) == normalizeName(línea.card.name)
        AND supertype == línea.card.supertype
        AND isLegalStandardNow(card)                 -- §2.3
        AND existe stock NM listed platform de esa Card
ORDER BY salePriceCents ASC
LIMIT 1   → suggestedSubstitute (con su availableQty, precio y unitInventoryItemIds)
```

- **Identidad "misma carta"** en Pokémon = **nombre normalizado + supertype** (las reimpresiones comparten
  nombre; entrenadores/energías igual). No es "cualquier impresión": es **"cualquier impresión legal"** (regla
  del dueño). Homónimos/ambigüedad ⇒ **no se auto-sustituye**: se registra para curar.
- El sustituto **se marca claramente** en la respuesta y pasa por la **misma compuerta de legalidad**. **Nunca**
  se sugiere una impresión rotada. Es lo que hace comprable más del deck sin ofrecer nada ilegal.

---

## 6. Agregar al carrito "de jalón"

El carrito es **de cliente** (M5) y la unidad es `inventoryItemId` (M6). "Agregar de jalón" =
1. El servidor resuelve, por el deck (o la lista pegada), la **unión de `inventoryItemId`** de las líneas
   **disponibles y legales** (hasta `availableQty` por línea, cheapest-first), más los de los sustitutos que el
   usuario acepte.
2. El front hace `useCart().add(id)` por cada uno (batch) y muestra `CartAddedToast`.
3. **El checkout/quote existente no se toca:** el re-quote del carrito (v1.21.3) ya revalida disponibilidad y
   **poda** piezas que dejaron de estar (`prune`), así que no hace falta reserva nueva aquí.

Los `unitInventoryItemIds` **ya vienen** en `GET /decks-meta/:slug` y en `POST /decks-meta/paste` por línea, así
que el "jalón" no necesita endpoint extra. **Opcional** (conveniencia): `POST /decks-meta/:slug/cart-selection`
que devuelve solo `{ inventoryItemIds }` (la unión ya computada en servidor) si el front lo prefiere.

**Descuento de bundle (V1 §8.2):** el dueño **no lo dio por obligatorio** en el borrador. Diseñarlo bien exige
un cambio **server-side de quote/checkout** (el carrito cliente no puede sostener una línea de descuento
money-safe) y **re-medir el estado de `pricing-iva`** (O-5). **No se diseña aquí**; queda como stream aparte que
yo serializo si el dueño lo pide (§10).

---

## 7. Contrato de API (resumen — canónico en `API_CONTRACT.md §13`)

**Públicos (3 + 1 opcional):**
- `GET /api/v1/decks-meta` — top-10 publicado, ordenado por `rank`, con `updatedAt` + cita de fuente.
- `GET /api/v1/decks-meta/:slug` — deck + líneas con disponibilidad, precio, `legal`, `unitInventoryItemIds`,
  `substitute?`, `legalityVerifiedAt`, fuente.
- `POST /api/v1/decks-meta/paste` — el motor: texto → misma vista de líneas. Rate-limited.
- *(opcional)* `POST /api/v1/decks-meta/:slug/cart-selection` — `{ inventoryItemIds }` de lo disponible+legal.

**Admin (3):**
- `GET /api/v1/admin/decks-meta` (+ `POST`/`PUT :id`) — curaduría: pegar top-10 manual (fallback), fijar
  `rank`, `published`/`pausedByOperator`.
- `GET /api/v1/admin/decks-meta/unmatched` — reporte de líneas no mapeadas/ambiguas para curar.
- `PUT /api/v1/admin/config/standard-legality` — editar ventana (`active_regulation_marks`) y banlist (rotación).

**Errores nuevos** (a `common/error-codes.ts`, zona compartida): `422 DECK_LIST_UNPARSEABLE`, `404
DECK_NOT_FOUND`. Reusa `400 VALIDATION_ERROR`, `429 RATE_LIMITED`, `503 BUSY_TRY_AGAIN`, `502 UPSTREAM_ERROR`
(fetch Limitless en prod).

**§0-Q:** los endpoints de lectura se diseñan **sin ejes de query de dominio cerrado** para minimizar la
superficie §0-Q. Si se añade `?sort=` (p. ej. `rank|share`), es **CLASE L** y se declara con la forma de §0-Q
punto 6 (default explícito; token fuera de dominio ⇒ `400` con `field`+`allowed`, sin clamp). Todo `@Query`
nuevo se **registra en el censo `C-EQ-1`** (M12) o la suite lo marca huérfano. El `text` de paste es **cuerpo**,
no query.

---

## 8. Limitless: ¿API oficial o scraping? — **NO MEDIDO**

**No se puede confirmar desde dev:** `curl` a `play.limitlesstcg.com:443` = **403 `connect_rejected`**
(2026-09-18, M9). Qué lo cerraría: alcanzar `limitlesstcg.com`/`play.limitlesstcg.com` **desde producción** o la
red del dueño y ver si hay **API documentada con términos de uso** o **HTML que parsear**.

**El diseño no depende de la respuesta:** un **adaptador** (`decks-meta/limitless.adapter.ts`) detrás de un
**formato de datos FIJADO y versionado** (schema parseado + fixture commiteada + **canario** que enrojece al
derivar el upstream). Si en prod resulta API → el adaptador mapea el JSON; si es scraping → parsea HTML con
selectores **fijados por versión**, y el canario avisa del cambio. En ambos casos: **dependencia fijada +
vigilada** (doctrina CLAUDE.md) y **fallback de curaduría manual** (§3.3) como red de seguridad. Los tests van
contra **fixture/formato**, nunca contra la red (§Realidades M9).

---

## 9. Desglose de trabajo — fases y módulos (para paralelizar)

**Zona compartida que SERIALIZO yo (arquitecto/orquestador) — un stream a la vez:**
`backend/prisma/schema.prisma` (columnas de legalidad + modelos decks-meta + relación inversa en `Card`),
`backend/src/common/` (`standard-legality.ts`, `error-codes.ts`), `backend/src/modules/catalog`
(`RemoteCard` + `upsertCards`), `docs/API_CONTRACT.md`.

| Fase | Qué | Backend (módulo) | Frontend | Depende de |
|---|---|---|---|---|
| **0 · Prerequisito (compartida, serializada)** | Legalidad: schema + mapeo + `isLegalStandardNow` + seed config + backfill vía `catalog-metadata-sync`. Exponer `ptcgoCode`/`number` de lectura si falta (P-71). | `prisma`, `common`, `catalog` | — | — |
| **1 · Motor + disponibilidad + carrito + top-10 curado** | Modelos decks-meta, parser+matcher, `paste`, detalle con disponibilidad, curaduría manual (fallback), jalón al carrito. | `modules/decks-meta` (nuevo, disjunto) | `(storefront)/decks-meta/*`, botón "agregar disponibles", reusa `useCart`/`CartAddedToast` | Fase 0 + catálogo/precios/carrito existentes |
| **2 · Traído automático Limitless** | Job `decks-meta-refresh` semanal, adaptador fijado+canario, validación ≥8 + fallback, `MetaFetchRun`. Solo prod. | `jobs` + `modules/decks-meta` | (nada, o badge de "actualizado") | Fase 1 |
| **3 · Sustitución legal + "avísame"** | `suggestedSubstitute` (misma carta legal en stock); "avísame" reusa Centro de Avisos §R. | `modules/decks-meta` (+ enganche §R) | UI de sustituto y de "avísame" | Fase 1 + §R |

**Backend y frontend de la Fase 1 arrancan en paralelo** (módulos disjuntos), ambos **después** de que cerre la
Fase 0. La Fase 2 es backend-solo. La Fase 3 vuelve a paralelizar.

---

## 10. Preguntas del dueño — resueltas y abiertas

**Resueltas por el arquitecto (bloqueantes del borrador PO):**
- *Q2 (fuente Limitless):* adaptador fijado+canario+fallback manual; API vs scraping **NO MEDIDO**, se cierra en
  prod (§8).
- *Q1 / V1-Q1 (descuento de bundle como línea negativa):* **fuera de este diseño**. El carrito es cliente; un
  descuento money-safe vive en quote/checkout ⇒ stream aparte + re-medir `pricing-iva` (O-5). Sin decisión del
  dueño no se construye (§6).
- *P3/P5 (faltante/rotada):* el dueño ya decidió **marcar + sugerir sustituto legal**; diseñado (§5).

**Abiertas para el dueño (no bloquean el diseño, sí la construcción):**
1. **Quién y cuándo** edita `standard.active_regulation_marks` (rotación). Propuesta: operación, al anuncio
   oficial, desde `PUT /admin/config/standard-legality`.
2. **Proveedor de legalidad de referencia:** pokemontcg.io vs scrydex (ambos bloqueados en dev; el scrydex es
   NO MEDIDO en nombre de campo, §2.2). Propuesta: pokemontcg.io (ya integrado), scrydex como respaldo.
3. **P4:** ¿queda cerrado a Standard, o dejamos la puerta a Expanded? (afecta si añadir `legalExpandedRaw`).
4. **Extras opcionales** (precio total del deck / "% del deck que tenemos" / descuento de bundle / "qué cambió"
   / reporte de faltantes / fotos reales por umbral): cuáles entran y en qué fase.
5. **Números:** rate-limit y tamaño máx del texto de `paste`; cron exacto del refresh; ¿se quiere el endpoint
   `cart-selection` opcional?

---

## 11. Riesgos (heredados del borrador PO, con el diseño alrededor)

- **R1 egress bloqueado en dev (MEDIDO):** el jalón real (Limitless + payload de legalidad) se verifica en
  **prod**; en dev se diseña/prueba contra **fixtures**. El diseño no descansa en egress de dev.
- **R2 dependencia de Limitless:** fijada+versionada+canario+fallback manual (§8).
- **R3 el emparejado es el corazón:** identificador `ptcgoCode` + `number` (§3.2); lo que no casa se **registra
  para curar**, nunca se inventa.
- **R4 legalidad ausente hoy (MEDIDO):** prerequisito Fase 0 (§2), migración aditiva + rollback limpio.
- **R5 dependencias:** "avísame" reusa §R (no se construye avisador); precios/carrito se reusan; el descuento de
  bundle re-mide `pricing-iva` si el dueño lo pide.

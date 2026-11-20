# API_CONTRACT_DEMANDA.md — anexo de API_CONTRACT.md (§DEMANDA: «Demanda sin stock», F1 + F2)

Alcance decidido por el dueño (HECHOS 2026-11-20: «Haría 1 y 2 no lo conectaría a lo de tienda aliada déjalo fuera esa parte»).
**DENTRO:** F1 y F2. **FUERA (no se construye, no se reserva en el contrato):** botón «Pedirla a una tienda aliada», `supplyRequestOpen`,
`reason:'demand'` en `supply-suggest`, y toda señal Google (F3). `signals.kind` es solo `'wishlist'|'search'`; añadir `'google'` en F3 será un cambio aditivo del contrato.
Diseño y razones: `docs/DECISIONES.md` §DEMANDA. Módulo no financiero (no mueve dinero ni inventario); gate: seguridad-lead (público + hash de personas), qa.

## 1. `GET /admin/reports/demand-gaps` · `super_admin`
Query: `sort=score|wishlist|search|market` (def. `score`), `dir=asc|desc` (def. `desc`), `limit` 1..200 (def. 100). Otro valor ⇒ `400` (también `limit` no entero o fuera de rango). Sin cursor. **C-EQ-1:** `sort` y `dir` = clase `ORDEN` (§0-Q punto 6); `limit` = `ORDEN` con cota numérica 1..200 (no se crea clase nueva); mismas 3 filas en `/export.csv`, que ignora `limit`.
Respuesta `200`:
`{ generatedAt, windowDays:30, totalRows, sources:{ wishlist:'ok'|'error', search:'ok'|'off'|'error', matchedAt:ISO|null }, rows:[Row] }`
- `search:'off'` = interruptor `marketing_search_log` apagado; `error` = esa fuente falló y se omite (la respuesta sigue `200` con la otra). `500` solo si fallan ambas.
- `matchedAt` = última corrida buena de `demand-match` (el front muestra «dato de hace N días» si > 2 días).

**Row (lista blanca; ningún otro campo, sin PII, sin userId/correo/IP):**
`{ key:string, kind:'card'|'term', cardId:string|null, term:string|null, cardName:string, setName:string|null, finish:Finish|null, imageSmallUrl:string|null, signals:[{kind:'wishlist'|'search', count:int, unit:'clientes'|'personas', windowDays:int|null, days?:int}], score:number, marketCents:int|null, buylistTodayCents:int|null }`
- `key` = `cardId` o `term:<termNormalized>` (clave estable para React/CSV). `kind:'term'` ⇒ `cardId=null`, `cardName=term`, `setName/finish/imageSmallUrl/marketCents/buylistTodayCents=null`.
- Una fila por carta (`cardId`); wishlist y búsqueda se suman en la misma fila. `finish` = el acabado con más clientes de wishlist, `null` si no hay señal wishlist. Wishlist `count` = cuentas DISTINTAS (suma de `wantedCount` del reporte `wishlist-demand` sin doble conteo entre acabados) de las piezas SIN pieza vendible (mismo predicado que `wishlist-demand.service.ts`); `windowDays:null`.
- Search `count` = personas (suma `people`, ventana 30 d; filas de `SearchDemandDaily` por `cardId` + filas de `SearchNoResultDaily` cuyo término `DemandTermMatch` asocia a ese `cardId`), `days` = días con ≥2 personas. Solo entra si pasa umbral (≥5 personas en total y ≥2 días con ≥2) calculado con la MISMA función pura de `marketing-search-miss.service.ts` (generalizarla, no copiarla).
- Una fila de carta se OMITE si la carta tiene hoy ≥1 pieza vendible (ya no es hueco). Wishlist entra con ≥1 cuenta (es lista propia del dueño, sin umbral).
- Precios: `marketCents` y `buylistTodayCents` reutilizan el seam de `wishlist-demand` (`wishlist-market.service.ts`, `buylist.batchQuote` raw NM); sin dato ⇒ `null`, nunca `0`. Centavos enteros MXN.
- **Score** = `round(w_wl × clientes + w_se × personas, 2)`; diales en `ConfigSetting` (super_admin ya edita ajustes): `demand_w_wishlist` (def. 3), `demand_w_search` (def. 1), `demand_search_window_days` (def. 30, 7..90). Empate: `marketCents` ↓ (null al final), luego `key`. Sin Google no hay término de impresiones.
- Filas `kind:'term'` = cuarentena automática: visibles, solo lectura, sin acción; nunca una lista de pendientes.

## 2. `GET /admin/reports/demand-gaps/export.csv` · `super_admin`
Mismos query y orden; todas las filas (tope 1000). Cabecera y formato de dinero/BOM/escape iguales a `wishlist-demand/export.csv`. Columnas:
`tipo,card_id,termino,carta,set,acabado,clientes_wishlist,personas_busqueda,dias_busqueda,score,mercado,buylist_hoy`
(`tipo` = `carta`|`termino`; dinero en pesos con 2 decimales, vacío si `null`). **Inyección CSV:** toda celda de texto que empiece con `= + - @ TAB CR` se antepone con `'` (el término sale de texto de usuarios). Nombre `demanda-sin-stock-YYYY-MM-DD.csv` con la fecha en America/Mexico_City. Errores como §1; `Content-Disposition` sin datos del usuario.

## 3. `POST /marketing/search-miss` (público) — cambio aditivo F2
Cuerpo: `{ term ≤80, kind:'card'|'sealed', cardId?: string }` (`cardId` uuid, ≤36). Respuesta SIEMPRE `204`, sin eco (igual que hoy); `413` >1 KB; `429` throttle 30/min (sin cambio).
Hoy el DTO es `whitelist+forbidNonWhitelisted` (`marketing-search-miss.controller.ts:18`): sin añadir `cardId?` al DTO el cuerpo nuevo se descartaría en silencio; es parte del encargo de backend.
Reglas de `cardId` (nunca se confía en el cliente; verifica el SERVIDOR):
1. Ausente, no-uuid o inexistente en `Card` ⇒ se ignora y sigue el camino de texto actual (idéntico a hoy; sin 4xx).
2. Existe pero tiene ≥1 pieza vendible (mismo predicado que `GET /catalog/cards`) ⇒ `204` sin contar nada (no es hueco; frena relleno).
2b. **Bots (servidor):** UA vacío o que case `bot|crawl|spider|slurp|headless|preview|curl|wget|python|httpclient` (insensible) ⇒ `204` sin contar (el servidor es la autoridad). El front además solo envía la señal de ficha «Agotada» tras interacción humana (≥1 pointer/tecla/scroll con la pestaña visible) y una vez por carta y sesión.
3. Existe y 0 stock ⇒ cuenta UNA persona (hash HMAC del día, misma sal, **solo de IP; el user-agent NO entra al hash**) en `SearchDemandSeen(cardId, day, h)`; el `term` NO se guarda (evita doble conteo y texto libre). Respeta `marketing_search_log` apagado ⇒ no cuenta.
4. Anti-relleno: tope ≤200 hashes por (cardId, día) y ≤10 `cardId` distintos por persona-hash y día (cuenta de filas de `SearchDemandSeen` por `h`; DM-1) y ≤1000 `cardId` distintos por día, **exentos del tope global** los `cardId` con wishlist activa o con fila en `SearchDemandDaily` de los últimos 30 d (así un relleno no desplaza a las cartas reales; DM-2) (contadores propios, mismo candado `pg_advisory_xact_lock` con otro namespace); cache en memoria de la verificación (60 s, ≤5000 entradas, evicción O(1) del más antiguo vía orden de inserción del `Map`, sin barrer) para que un barrido de uuids no cueste una consulta por petición. Datos: solo `cardId` público; ⛔ sin IP/cookie/usuario guardados.

## 4. Esquema (`schema.prisma`; migración ADITIVA, solo `CREATE TABLE`; reversa = `DROP TABLE` de las tres y retirar la sección)
- `SearchDemandDaily { id uuid, cardId String, day Date, people Int @default(0); @@unique([cardId, day]); @@index([cardId]) }` (sin FK, como `BuylistQuoteDailyCount`).
- `SearchDemandSeen { cardId, day Date, h String; @@id([cardId, day, h]) }` (hashes del día; se vuelcan y borran en el cierre).
- `DemandTermMatch { termNormalized String @id, cardId String?, status String ('matched'|'ambiguous'|'none'), matchedAt DateTime }`.
`SearchDemandSeen` suma `@@index([day, h])` (tope por persona). Sin cambios a tablas existentes. Registrar en ARCHITECTURE al construir.
**Limpieza PDB G-8** (`20261006_pdblimpieza_2_limpieza.sql`, mismo patrón condicional `to_regclass` + `LOCK … SHARE ROW EXCLUSIVE`): `SearchDemandSeen` ⇒ BORRAR (hashes transitorios; precedente `SearchNoResultSeen`); `DemandTermMatch` ⇒ BORRAR (derivado de texto de usuarios; `demand-match` lo regenera solo); `SearchDemandDaily` ⇒ CONSERVAR (agregado cardId×día sin PII; precedente `SearchNoResultDaily`).

## 5. Jobs (AUTO)
- **Cierre:** el job existente `marketing-search-close` (00:10 CDMX, y cierre perezoso) también vuelca `SearchDemandSeen → SearchDemandDaily` y borra los hashes, en la misma transacción por día (idempotente: `ON CONFLICT … DO UPDATE people = people + EXCLUDED.people`, sin hashes no hay nada).
- **Retención:** `marketing-search-miss-retention` (08:50 UTC) borra `SearchDemandDaily` > 90 d y bajo umbral > 30 d (misma regla que `SearchNoResultDaily`) y `DemandTermMatch` cuyo término ya no existe en `SearchNoResultDaily`.
- **`demand-match`** (nuevo, diario 04:30 UTC, BullMQ, `attempts:3`, backoff exponencial 60 s): para cada término que pasa umbral, `catalog.searchAllCards` (≤5 resultados). `matched` si hay UN resultado, o un único resultado cuyo nombre normalizado (`foldSearchText`) iguala el término; si no, `ambiguous` (varios) o `none`. Upsert por término ⇒ idempotente. Sets nuevos entran solos (el catálogo es la fuente). Un término ya `matched` se re-evalúa a los 30 d. Si el job falla del todo, el endpoint usa los matches previos y `matchedAt` envejece (el front lo dice); términos sin match ⇒ filas `term`.
- Disparo por cliente = evento; sección = lectura en vivo. Botón «recalcular»: no hay (no hace falta).

## 6. Estados vacíos y errores (front)
Sin filas: «Aún no hay demanda sin stock: cuando clientes guarden cartas que no tienes o las busquen varias veces, aparecen aquí.» `sources.search='off'` ⇒ aviso «Búsquedas desactivadas». Una fuente en `error` ⇒ banner suave + la otra se muestra. `403` ⇒ sección oculta (solo `super_admin`). Carga: skeleton; pide `limit=200` y, si `totalRows > rows.length`, aviso «Mostrando N de M; descarga el CSV para ver todo» (sin paginar). Plurales ICU (`{count, plural, one {# cliente} other {# clientes}}`, igual personas).

## 7. i18n (es/en; claves nuevas bajo `admin.m9.demand.*`)
`title`, `subtitle`, `colCard`, `colSet`, `colFinish`, `colWishlist`, `colSearch`, `colScore`, `colMarket`, `colBuylist`, `termBadge` («Término sin carta»), `termHint`, `empty`, `searchOff`, `sourceError`, `staleData` (`{days}`), `exportCsv`, `unitClients`, `unitPeople`, `daysFmt`. Sin textos fijos en el componente.

## 8. Reparto
**Backend:** módulo `demand` (controller+service, `RolesGuard` super_admin), lectura de `wishlist-demand`/`SearchNoResultDaily`/`SearchDemandDaily`/`DemandTermMatch`; CSV; DTO `cardId?` + verificación + `SearchDemandSeen` en `search-miss`; extensión de cierre y retención; job `demand-match` y su alta en `scheduler.service.ts`; migración + tablas; diales con default; función de umbral generalizada.
**Frontend:** sección «Demanda sin stock» en `BuylistTab`/`BuyListTab.tsx` (M9), tabla, orden, chips de señal, fila «término» sin acciones, vacíos/errores/«dato de hace N días», botón CSV, i18n es/en; `lib/search-miss.ts` envía `cardId` solo cuando el front conoce una carta única con 0 stock. **Pre-requisito frontend (NO MEDIDO):** el catálogo lista solo stock ≥1, así que antes de codificar `frontend` mide dónde el cliente ve una carta única agotada (ficha `GET /catalog/cards/:cardId` o buscador) y avisa al arquitecto; si no existe ese punto, F2-front se difiere y F1 + `demand-match` siguen (el texto ya se resuelve a carta en el servidor).

## 9. Pruebas mínimas
- B: umbral 4/5 personas y 1/2 días ⇒ no sale; 5/2 ⇒ sale. Carta con stock ⇒ omitida. Score y orden con diales; empate estable. Wishlist+búsqueda en una sola fila. `null` ≠ 0 en precios. 403 a `admin` normal y a cliente; 400 en `sort` inválido.
- B: `search-miss` con cardId inexistente ⇒ 204 + camino de texto; con stock ⇒ 204 sin escritura; 0 stock ⇒ 1 hash; 201.ª persona y 301.ª carta no escriben; mismo hash dos veces = 1 persona; cuerpo con campo extra ⇒ 204 sin escritura; interruptor apagado ⇒ nada. Cierre idempotente (2 corridas = mismas `people`); hashes borrados tras cerrar.
- B: `demand-match` único ⇒ `matched`; varios ⇒ `ambiguous`; 2 corridas ⇒ mismas filas; fallo del job ⇒ endpoint sigue `200`.
- Seguridad: lista blanca de Row por snapshot (ningún campo extra); CSV con `=cmd|…` sale con `'`; ningún log ni tabla contiene IP/UA/userId; `DemandTermMatch` solo términos ya filtrados por PII.
- F: render de fila carta y fila término; vacío; error parcial; `search:'off'`; es/en sin claves faltantes; `search-miss.test.ts` con y sin `cardId`.

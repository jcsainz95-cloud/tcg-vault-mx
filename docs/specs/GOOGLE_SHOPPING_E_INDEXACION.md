# GSHOP — Revisión semanal de indexación + feed de Google Merchant Center

Origen: HECHOS.md:276 (dueño 2026-11-10: «mandale info de todo y ayudame a conectar la oferta»). Regla AUTO (HECHOS 2026-11-09): ningún paso recurrente es del dueño; las únicas acciones suyas están en §C. Estado: DISEÑO. El feed se construye **después** de publicar D9 (`docs/specs/D9_COMISION.md`): el precio es `displayPriceCents` (con comisión) y por eso no hay que cambiar nada en él cuando D9 entre.
Cadena: arquitecto (esto) → backend + frontend + devops → qa + seguridad-lead (gate ligero: endpoint público nuevo + llamada a API de Google; no mueve dinero).

## A. Revisión semanal de indexación (Search Console URL Inspection)

**Qué es.** Un job revisa, URL por URL, el veredicto de Google sobre las páginas que SÍ deben indexarse, lo guarda, y el correo del lunes (§MKT-V2 §3) trae un aviso **AV7** si hay un problema nuevo.

**Universo (derivado, sin lista a mano).** `GET /catalog/sitemap` (~1,018 URLs el 2026-11-10, dato del dueño; **NO MEDIDO** por el arquitecto) + «páginas clave» = las rutas estáticas que ya emite `frontend/src/app/sitemap.ts` (home, catálogo, sellado, legales). Rutas privadas, `/&`, `/$` y todo lo bloqueado a propósito **nunca entran** porque no están en el sitemap: el ruido conocido se evita por construcción, no con una lista de excepciones. Al arrancar cada corrida se re-lee el sitemap: URL que ya no está ⇒ su fila se borra (una carta vendida no genera «404»).

**API.** `POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect` con `{inspectionUrl, siteUrl}`; `siteUrl` = el mismo valor de propiedad que ya usa `marketing-external-sources.ts:117`; credencial = la cuenta de servicio `panel-lectura@…` existente (no hay secreto nuevo). Campos usados de `inspectionResult.indexStatusResult`: `verdict`, `coverageState`, `pageFetchState`, `robotsTxtState`, `indexingState`, `googleCanonical`, `userCanonical`, `lastCrawlTime`. Refleja el índice de Google, no una prueba en vivo.
- **Cuota.** Doc oficial «Search Console API – Usage limits»: **2,000 consultas/día y 600/min por sitio** para URL Inspection (MEDIDO en esa doc, 2026-11-11). Diseño robusto a un tope 10× menor: presupuesto propio `GSC_INSPECT_DAILY_BUDGET` = **250/día** (constante con nombre) ≈ 12 % del tope, ritmo ≤ 2 req/s con concurrencia 2. 250/día cubre ~1,030 URLs en ≤ 5 días (cada URL se revisa al menos 1 vez por semana; las páginas clave, a diario). Backend confirma el tope real en la primera corrida (un 429 con `RESOURCE_EXHAUSTED` baja el presupuesto del día a lo ya hecho).
- **Permiso.** Basta el alcance `webmasters.readonly` que ya usa la cuenta (MEDIDO en la doc de `urlInspection.index.inspect`). Si responde 403 ⇒ el job se detiene sin reintentos ese día, `r2` dice «No se evaluó la indexación: sin permiso de Search Console» (patrón de «fuente sin medir», MKT_PANEL_V2 §2) y no hay aviso falso.

**Job (A: cuándo).** `gsc-index-inspect`, patrón `0 3-8 * * *` America/Mexico_City (6 ticks/día). Cada tick: lee el sitemap, calcula `hechas hoy`, toma las filas con `lastCheckedAt` más viejo (NULL primero; páginas clave si no se revisaron hoy) hasta completar el presupuesto, lotes de 40, y sale. **Reintento (B):** un tick que muera deja las filas sin tocar y el siguiente tick retoma (selección por antigüedad = idempotente, sin estado de «corrida»); 429/5xx de Google ⇒ backoff exponencial 2-4-8 s ×3 por URL, luego se corta el tick; la URL sigue vieja y se retoma. Flag `ConfigSetting` `gsc_index_inspect` (default `on`).

**Tabla (aditiva, migración `m101`; D9 usa m100).**
```
model IndexInspection {            // sin datos personales
  url String @id                   // absoluta, canónica
  kind String                      // card | sealed | key
  firstSeenAt DateTime             // primera vez en el sitemap
  lastCheckedAt DateTime?
  verdict String?                  // PASS | NEUTRAL | FAIL | PARTIAL | VERDICT_UNSPECIFIED
  coverageState String?
  pageFetchState String?
  robotsTxtState String?
  indexingState String?
  googleCanonical String?
  userCanonical String?
  lastCrawlTime DateTime?
  flag String?                     // NOT_FOUND | DUP_NO_CANON | CRAWLED_NOT_INDEXED | BLOCKED | FETCH_ERROR | null
  flagSince DateTime?              // inicio de la racha con ese flag
  flagStreak Int @default(0)       // revisiones consecutivas con el mismo flag
  notifiedAt DateTime?             // último correo que lo incluyó
  @@index([lastCheckedAt])
}
```
Reversa: `DROP TABLE` y el flag; nada más depende. Filas ≈ 1,030.

**Clasificación (función pura `classifyInspection`, testeable).** Sobre las cadenas de la API, comparación sin mayúsculas:
| Flag | Condición | Se avisa |
|---|---|---|
| NOT_FOUND | `pageFetchState` = `NOT_FOUND` o `SOFT_404` | a la 1.ª vez |
| BLOCKED | `robotsTxtState`=`DISALLOWED`, `indexingState` empieza por `BLOCKED_`, o `pageFetchState` ∈ `BLOCKED_ROBOTS_TXT`,`ACCESS_DENIED`,`ACCESS_FORBIDDEN` | a la 1.ª vez |
| FETCH_ERROR | `pageFetchState` ∈ `SERVER_ERROR`,`REDIRECT_ERROR`,`INTERNAL_CRAWL_ERROR`,`INVALID_URL` | racha ≥ 2 |
| DUP_NO_CANON | `coverageState` contiene «Duplicate» o `googleCanonical` ≠ `userCanonical` (ambos presentes) | racha ≥ 2 |
| CRAWLED_NOT_INDEXED | `coverageState` empieza por «Crawled - currently not indexed» o «Discovered - currently not indexed» | racha ≥ 2 **y** `firstSeenAt` ≥ 21 días |
`verdict=PASS` o «Submitted and indexed» ⇒ flag NULL (racha a 0). Cadena desconocida con `verdict=FAIL` ⇒ `FETCH_ERROR` (nunca se descarta en silencio). Esto reproduce los dos casos de HECHOS:276 (Centiskorch «duplicada» = DUP_NO_CANON; se limpia solo cuando Google lo rastrea de nuevo).

**Supresión de ruido (C: datos dudosos sin humano).** (1) Rachas: «racha ≥ 2» exige dos revisiones separadas ≥ 5 días (no dos ticks seguidos). (2) Al armar el aviso se vuelve a leer el sitemap y se descartan URLs que ya salieron. (3) Una URL no se repite en correos mientras `notifiedAt` < 28 días y su flag no cambie. (4) Máx. 3 URLs por categoría + «y N más» (mismo formato que AV1–AV6). (5) Tras un deploy grande, un 5xx transitorio queda cubierto por la racha. Lo dudoso se **suprime y se mide**, no entra en lista de pendientes.

**Aviso AV7 (se suma a MKT_PANEL_V2 §2; `marketing-alerts.ts` puro).** Prioridad media (BLOCKED y NOT_FOUND: alta). Texto: «Google tiene problemas con N fichas: 2 no existen (404), 1 duplicada sin canónica, 3 rastreadas sin indexar. Ejemplos: …». Evidencia = conteos y URLs. Entra en `r2`, por tanto también en el correo del lunes, sin cambiar el contrato de `pantalla=r`. Sin problemas ⇒ no aparece (regla «sin elementos ⇒ sin aviso»). Sin dato (job apagado, 403, <50 % del universo revisado en 7 días) ⇒ «No se evaluó…».

**Crecimiento (D).** Cada set o carta nueva entra al sitemap y por tanto a la rotación; el tiempo de ciclo sube 1 día por cada ~250 URLs nuevas, y el presupuesto es una constante (si el universo pasa de ~1,750, subirla; el techo de diseño es ~1,700 de 2,000/día, ver NO MEDIDO).

## B. Feed para Google Merchant Center

**Diagnóstico (medido).** `grep` de `merchant|g:price|product_feed` en `backend/src` y `frontend/src/app` = sin feed (`D9_COMISION.md` §1). Ya existen como JSON-LD en cada ficha: `Offer.price`, `itemCondition` (carta = `UsedCondition`, sellado = `NewCondition`), `brand` Pokémon, `shippingDetails` (regla viva de `/checkout/shipping-rule`) y `hasMerchantReturnPolicy` = no se aceptan devoluciones (`frontend/src/lib/seo.ts:283,288,307,327`). Search Console cuenta 30 elegibles de ~1,000 porque Google solo descubre por rastreo lo que alcanza a leer.

**Comparación y recomendación.**
| | Feed XML programado (recomendado) | «Productos automáticos desde el sitio» | Merchant API / Content API |
|---|---|---|---|
| Construcción | 1 endpoint + 1 ruta (~medio día de back y front) | 0 | Credencial nueva + cliente + cola; Content API for Shopping ya está en sunset (agosto 2026) ⇒ solo Merchant API |
| Cobertura | todo lo vendible, hoy, determinista | la que Google rastree (hoy 30/~1,000, **medido por el dueño en el correo**) | igual al feed |
| Control (título, categoría, GTIN, envío) | total | ninguno | total |
| Retraso | ≤ 24 h (Merchant baja el archivo cada día) | semanas, no garantizado | casi inmediato |
| Pasos del dueño | los mismos (§C) | los mismos menos la URL del feed | + dar permiso a una cuenta de servicio |
**Decisión: feed XML por «archivo programado».** Razón: es lo único con cobertura completa y sin credencial ni cola nueva (nada que expire ni reintentar: Merchant reintenta solo y conserva los datos anteriores si un día falla). Merchant API queda como **fase 2 opcional** solo si se quiere leer los rechazos de Google en el correo del lunes (requiere añadir la cuenta de servicio como usuario de Merchant Center: 1 paso extra del dueño; no se construye ahora). Formato XML (RSS 2.0, espacio `g:`) y no TSV: las descripciones llevan saltos y comillas.

**URL.** `https://tcghunt.mx/feeds/google-merchant.xml` (dominio canónico sin www: `www` responde 308 → sin www; `SITE_URL` en `frontend/src/lib/seo.ts:24`). Ruta de Next con `force-dynamic` + caché de datos de 3600 s (desviación aceptada: no `revalidate=3600`, para que un 503 nunca quede cacheado), `Cache-Control: s-maxage=3600, stale-while-revalidate=86400`. `X-Feed-Skipped` del front cuenta solo lo omitido por el front. **No** va en el sitemap ni se bloquea en `robots.txt`. Se regenera sola porque se calcula del catálogo vivo: no hay job, ni archivo guardado, ni nada que «recordar».

**Fuente de datos.** Endpoint nuevo `GET /catalog/merchant-feed` · público · `{ items: MerchantFeedItem[], generatedAt }`; reutiliza la misma consulta y la misma regla de «vendible» del sitemap (`catalog.service.ts:1690`, `sealed-catalog.service.ts:497`: `status: listed`, `ownerType: platform`, cantidad > 0). Nada de inventario de clientes, bóveda ni buylist. El frontend arma el XML (links y envío con las mismas funciones que `sitemap.ts` y `seo.ts`).
`MerchantFeedItem` = `{ id, kind:'card'|'sealed', path, title, description, imageUrl, priceCents, condition:'new'|'used', brand:'Pokémon', gtin:string|null, groupId? }`.
Regla central: **una fila por ficha (URL), con el MISMO precio y condición que el JSON-LD de esa ficha** (si la ficha publica `AggregateOffer`/oferta destacada, el feed toma esa oferta). Merchant suspende por «precio no coincide»; por eso hay candado de prueba: para N fichas, `priceCents` del feed = `Offer.price` de la ficha (k/N). Cómo elige la ficha su oferta destacada: **NO MEDIDO**, lo lee backend.

**Campos del XML (por ítem).**
| Atributo | Valor |
|---|---|
| `g:id` | `card:<cardId>` / `sealed:<groupKey>` (estable) |
| `g:title` | ≤ 150: nombre + número + set + «Carta Pokémon» (carta incluye NM/condición de la ficha) |
| `g:description` | texto plano ≤ 5,000 (sin HTML, sin controles XML); el de la ficha |
| `g:link` | URL canónica absoluta, **igual** a la del sitemap |
| `g:image_link` | imagen absoluta https (la de `og:image` de la ficha); sin imagen ⇒ el ítem se omite |
| `g:price` | `priceCents/100` con 2 decimales + ` MXN`, **IVA incluido** (como el precio exhibido; con D9 incluye la comisión) |
| `g:availability` | `in_stock`; agotado = no aparece |
| `g:condition` | `used` para carta suelta/gradeada, `new` para sellado (`jsonLdItemCondition`, vigente) |
| `g:brand` | `Pokémon` |
| `g:gtin` / `g:identifier_exists` | UPC del sellado **solo si existe en BD**; si no, `identifier_exists=no`. En `schema.prisma` no hay campo de UPC/GTIN (el `upc` del grep es el subtipo «Ultra Premium Collection», no un código de barras): **NO MEDIDO** que haya origen; sin dato ⇒ `no`. Nunca se inventa un GTIN. |
| `g:google_product_category` | texto completo del taxonomía de Google: «Arts & Entertainment > Hobbies & Creative Arts > Collectibles > Collectible Trading Cards» (cartas y sellado); el id numérico no lo verifiqué, el texto sí lo acepta Merchant. |
| `g:item_group_id` | solo si varias filas comparten carta |
| `g:shipping` | `MX` / servicio «Estándar» / precio = regla viva `/checkout/shipping-rule` (hoy MX$100; `0.00` si `priceCents ≥ freeFromCents`, hoy MX$4,000); nunca importes a mano |
| Devoluciones | la política «no se aceptan devoluciones» (`seo.ts:327`) se declara en el asistente de Merchant (§C paso 3); el feed no la repite |
**Exclusiones automáticas (datos dudosos).** Se omite y se cuenta: precio ≤ 0, sin título, sin imagen, ficha no vendible. El conteo sale en cabecera `X-Feed-Items`/`X-Feed-Skipped` y en log; nadie lo revisa a mano. Backend caído o 0 ítems ⇒ la ruta responde **503** (nunca un 200 vacío: Merchant conservaría lo anterior en vez de borrar el catálogo).
**Cuarentena de precio.** Lo que el catálogo ya oculta por cotas duras (`ARCHITECTURE §5.17 D`) no es «vendible» y por tanto no sale.

**Crecimiento (D).** Todo set/carta que se vuelve vendible aparece solo; no hay tabla de productos de Google.

## C. Pasos ÚNICOS del dueño (≈15 min, una vez; excepción AUTO: cuenta y términos de Google)
1. Entrar a merchants.google.com **con la misma cuenta de Google que ya administra Search Console**, crear la cuenta (país México, nombre TCG HUNT, sitio `https://tcghunt.mx`, ya creado por el dueño) y **aceptar los términos**.
2. Cuando pida verificar y reclamar el sitio, elegir **Search Console** (con la misma cuenta es automático, un clic).
3. En el asistente de envíos y devoluciones: devolución = «No se aceptan devoluciones» (así lo dice la política de la tienda); el envío ya viene en el feed.
4. Productos → Fuentes de datos → Añadir → **Archivo programado**: país México, idioma español, URL `https://tcghunt.mx/feeds/google-merchant.xml`, frecuencia diaria. Activar «Fichas gratuitas» para México.
Después no hace nada: Merchant tarda días en revisar la primera vez. Plan de medición (orquestador, a +7 y +28 días): conteo de «elegibles» en el correo de Search Console o en Diagnóstico, contra `X-Feed-Items`.

## D. Reparto
- **Backend:** `GET /catalog/merchant-feed` (+ DTO, prueba de paridad con JSON-LD); `classifyInspection` + `IndexInspectionService` + job `gsc-index-inspect` en `scheduler.service.ts`; migración `m101`; AV7 en `marketing-alerts.ts` (+ texto) y lectura de la tabla para `r2`; presupuesto y flag como constantes/`ConfigSetting`.
- **Frontend:** `app/feeds/google-merchant.xml/route.ts` (escape XML, sin caracteres de control, 503 si vacío); reutiliza `shippingDetailsJsonLd`/`jsonLdItemCondition`/`brandJsonLd` y el generador de URLs del sitemap; `messages` solo si AV7 muestra algo nuevo en UI (el texto va en `marketing-alerts.text.ts`, sin claves nuevas esperadas).
- **DevOps:** que `/feeds/` no esté bloqueado por `robots.txt`, WAF ni cabeceras de bot en Vercel; la ruta responde 200 a un `curl` sin cookies; ninguna variable de entorno nueva (reutiliza la cuenta de servicio).
- **Contrato:** 1 endpoint público nuevo (índice en `docs/API_CONTRACT.md`, línea de `/catalog/sitemap`). AV7 es parte de `r2`, sin endpoint.
- **qa:** (1) feed vs JSON-LD en N fichas (k/N de precio, condición, disponibilidad); (2) XML válido, links = sitemap, 0 agotados, 0 clientes/bóveda; (3) `classifyInspection` con una tabla de entradas (404, bloqueo, duplicada, rastreada sin indexar, PASS, cadena desconocida); (4) 2 ticks el mismo día no pasan de 250 consultas; (5) 429 corta el tick y el siguiente retoma; (6) rachas: un 404 aislado de una URL ya fuera del sitemap no avisa.
- **seguridad-lead:** endpoint sin datos personales; el feed no filtra costos, SKUs internos ni inventario de clientes; la cuenta de servicio sigue de solo lectura.

## E. NO MEDIDO (resumen)
Tamaño exacto del sitemap (~1,018 dato del dueño); cómo elige la ficha su oferta destacada y si hay origen de UPC/GTIN; id numérico de la categoría de Google; cuántos de los ~1,000 aprobará Merchant; que «No se aceptan devoluciones» exista como opción en Merchant México (si no, el asistente pedirá una política y el dueño elige la más cercana; el JSON-LD ya declara lo cierto).

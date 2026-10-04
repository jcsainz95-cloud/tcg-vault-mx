# Tiempos de la portada en producción — sesión 5

**Medido:** 2026-10-04, 07:01–07:04 UTC, sobre `production` @ `da3e8ae`.
**Autorización:** el dueño (2026-10-04), solo peticiones públicas de lectura, sin sesión.
**Volumen:** 51 peticiones en total, en serie y con 1 s de pausa entre una y otra. Sin carrito, sin login, sin escaneo.
**Desde dónde:** contenedor en la nube → proxy de salida → Railway/Vercel. El borde que atendió fue `iad1`
(Virginia, EE. UU.) en todas las respuestas. **No es la red del dueño**: lo que mide `dns`/`connect` es el
salto al proxy (≈0 ms), no a Railway. El TLS (`appconnect`) sí incluye el viaje completo hasta el origen.

## 1. Qué pide la portada (leído en el código)

| Qué | Dónde se ve | URL |
|---|---|---|
| Frontend | `.env.example:100` (`APP_BASE_URL`) | `https://www.tcghunt.mx` (también `tcghunt.mx` → 307 y `tcg-vault-mx.vercel.app`) |
| API | `.env.example:977`, `docs/DEVOPS_NOTES.md:2681` | `https://tcg-vault-mx-production.up.railway.app/api/v1` |

La portada (`frontend/src/app/[locale]/(storefront)/page.tsx:1`) es `'use client'`: **todas** las vitrinas se
piden desde el navegador con `useQuery`, después de cargar el JavaScript.

| Endpoint | Componente | Query exacta |
|---|---|---|
| lento · «gemas» | `_home/GradingGemsShelf.tsx:31` | `/catalog/cards?sort=grading_showcase&pageSize=8&gradingHighlight=true` |
| lento · facetas | `page.tsx:55` → `lib/api.ts:457` | `/catalog/facets` |
| lento · destacados | `_home/FeaturedCarousel.tsx:123` | `/catalog/cards?sort=price_desc&pageSize=8` |
| rápido · sellado (control) | `_home/SealedShelf.tsx:26` | `/catalog/sealed?pageSize=3` |
| rápido | `_home/BountyBoard.tsx:35` | `/buylist/bounties` (no medido) |
| rápido | `_home/GradedShelf.tsx:34` | `/catalog/cards?productType=graded&sort=price_desc&pageSize=4` (no medido) |

**Cabeceras que manda el navegador** (`frontend/src/lib/api-client.ts:328-334`): un GET de la portada no lleva
`Content-Type`; solo lleva `Authorization: Bearer …` **si hay sesión iniciada**. Consecuencia:

- visitante anónimo → petición «simple» → **no hay preflight**;
- usuario con sesión (el dueño al revisar) → `Authorization` → **preflight OPTIONS antes de cada GET**.

El preflight de ~160 ms que ve el dueño encaja con que estaba con sesión iniciada (**NO MEDIDO** en su navegador;
lo cerraría mirar en DevTools si la petición lleva `Authorization`).

## 2. Tiempos de la API (N=10 por endpoint, en serie)

`servidor` = `ttfb − tls`: lo que tarda Railway en contestar una vez abierta la conexión (incluye un viaje de ida
y vuelta). Cada fila: **mediana / máximo**, en ms.

| Endpoint | TLS | TTFB | servidor | total | tamaño |
|---|---|---|---|---|---|
| `cards?sort=grading_showcase…` | 104 / 127 | 699 / 738 | **600 / 620** | 699 / 738 | 2.9 KB |
| `facets` | 96 / 206 | 624 / 721 | **519 / 605** | 625 / 721 | 1.5 KB |
| `cards?sort=price_desc&pageSize=8` | 101 / 182 | 714 / 796 | **616 / 664** | 715 / 796 | 6.7 KB |
| `sealed?pageSize=3` (control) | 94 / 122 | 241 / 267 | **147 / 171** | 242 / 267 | 2.5 KB |

10/10 respuestas `200` en los cuatro. Crudo: `curl -w` con `time_namelookup/connect/appconnect/starttransfer/total`.

**Lectura:** las respuestas pesan muy poco (1.5–6.7 KB) y la descarga es instantánea (`total − ttfb` ≈ 0–1 ms).
Los tres lentos pasan **~450–470 ms más que el control dentro del servidor**, antes de mandar el primer byte. La
red y el TLS son iguales para los cuatro. **El tiempo se va en el backend (consulta/cálculo), no en la red ni en el
tamaño.**

**Lo que NO cuadra todavía:** nosotros medimos ~0.7 s en serie; el dueño ve ~1.75 s. Diferencia ~1 s que **no he
medido**. Hipótesis, sin medir:
1. En la portada el navegador lanza ~7 peticiones **a la vez** contra un backend de 1 réplica
   (`railway.json`, `numReplicas: 1`): las tres pesadas compiten entre sí por la BD / el hilo de Node.
2. Su red desde México añade algo de RTT (pero el control le tarda 177–190 ms, así que no explica 1 s).
3. Con sesión iniciada, el preflight (~160 ms) va **en serie** antes de cada GET.

La medición que cerraría la 1: una ráfaga de las 6–7 peticiones de la portada en paralelo, una sola vez, y comparar
con estos tiempos en serie. **No la hice** porque el encargo limita a 1 petición/s; queda para que la autorice el
dueño o para medirla en local/staging con los mismos datos.

## 3. Cabeceras de respuesta de la API

Iguales en los cuatro endpoints (muestra `gems`, petición 1):

| Cabecera | Valor |
|---|---|
| `Cache-Control` | **ausente** |
| `ETag` | presente, débil (`W/"b65-…"`, la que pone Express por defecto) |
| `Age` | ausente |
| `cf-cache-status` / `x-vercel-cache` | ausentes (no hay CDN delante del API) |
| `server-timing` | **ausente** |
| `server` | `railway-hikari` |
| región | `x-railway-edge: iad1`, `x-hikari-trace: iad1.…` |
| `Access-Control-Allow-Origin` | `https://www.tcghunt.mx` (+ `Allow-Credentials: true`, `Vary: Origin`) |
| rate limit | `x-ratelimit-limit: 300` por 60 s |

Es decir: **nada cachea estas respuestas** (ni CDN ni navegador), y no hay `server-timing` para ver desde fuera
qué parte del backend tarda.

## 4. Preflight CORS (N=3)

`OPTIONS /catalog/facets` con `Origin: https://www.tcghunt.mx`, `Access-Control-Request-Method: GET`,
`Access-Control-Request-Headers: authorization` (lo que manda el navegador con sesión).

| | TLS | TTFB | total |
|---|---|---|---|
| mediana / máx | 100 / 282 | 225 / 417 | 225 / 417 |

Respuesta `204`, `Access-Control-Allow-Headers: authorization`, métodos `GET,HEAD,PUT,PATCH,POST,DELETE`.
**`Access-Control-Max-Age`: ausente.** Sin esa cabecera Chrome guarda el preflight solo **5 s**, así que casi
cada visita con sesión vuelve a pagarlo, una vez por cada URL distinta.

## 5. HTML de la portada

`https://www.tcghunt.mx/` **no se pudo medir desde este contenedor**: el proxy de salida contestó `502` al
`CONNECT` (3/3; fallo del proxy, la petición no llegó a Vercel). Medido en su lugar:

| URL | código | TLS | TTFB | total | tamaño |
|---|---|---|---|---|---|
| `https://tcghunt.mx/` | 307 → `/es` | 435 | 1258 | 1258 | 15 B |
| `https://tcg-vault-mx.vercel.app/` | 307 → `/es` | 114 | 202 | 202 | 15 B |
| `https://tcg-vault-mx.vercel.app/es` (1ª) | 200 | 135 | 543 | 597 | 293 KB |
| `https://tcg-vault-mx.vercel.app/es` (2ª) | 200 | 127 | 290 | 329 | 293 KB |

Que `tcg-vault-mx.vercel.app` sirve el mismo despliegue que `www.tcghunt.mx` lo da `.env.example:100`; **no lo
medí byte a byte**.

Cabeceras del HTML: `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`,
`x-vercel-cache: MISS` (2/2), `age: 0`, región `iad1`. **Se genera en cada visita y no se cachea.**

**¿Viene con datos?** **No.** El HTML trae el armazón y 11 esqueletos (`animate-pulse`); ninguno de los nombres que
devuelve el API en ese momento (p. ej. «Mega Dragonite ex», «Pikachu ex», «Ascended Heroes», «30th Celebration»)
aparece en el HTML. Los datos llegan después, cuando el navegador ejecuta el JS y pide las vitrinas.

## 6. Dónde se va el tiempo (resumen)

Cadena que sufre un visitante, en orden:

1. HTML (~0.3–0.6 s, sin caché, sin datos) → descarga y ejecuta el JS.
2. Solo entonces empiezan las peticiones al API. Si hay sesión: preflight (~0.15–0.2 s) antes de cada una, sin
   `Max-Age`.
3. Las tres vitrinas pesadas tardan **~0.5–0.6 s de servidor cada una aun en serie**, ~4× el control. Con la
   portada pidiendo todo a la vez, el dueño ve ~1.75 s (la diferencia **no está medida**, ver §2).
4. Nada de esto se cachea en ningún punto (`Cache-Control` ausente en el API, `no-store` en el HTML).

Lo lento es **el cálculo en el backend** de `grading_showcase`, `facets` y `price_desc`; la red y el tamaño no
explican la diferencia. Próximas mediciones que cerrarían lo abierto: (a) ráfaga en paralelo como la del
navegador; (b) `EXPLAIN ANALYZE` / tiempos por fase de esas tres consultas en local o staging con datos como los de
prod; (c) `server-timing` en el API para verlo desde fuera.

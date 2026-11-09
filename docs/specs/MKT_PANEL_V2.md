# MKT_PANEL_V2 — Rediseño del panel de Marketing (§MKT-V2)

Fuente: `HECHOS.md` (2026-11-09, «Dale diseñalo y lo pasamos al equipo de desarrollo»; sin ventas en línea 26 oct–1 nov = dato real; tráfico `diag` 17/55 usuarios del 1–8 nov). Regla AUTO: nada depende del dueño. Contrato vigente del panel: `docs/archive/API_CONTRACT.md` §MKT.G/§MKT.H (grep). Dinero en centavos MXN. Todo lo de abajo que no se midió en producción va marcado **NO MEDIDO**.

## 0. Decisiones (con porqué)
| # | Decisión | Porqué |
|---|---|---|
| D1 | Pantalla nueva `r` «Resumen», primera pestaña y por defecto; el dominio de `pantalla` pasa a `r\|a…h`. Mismo `screen()` con `privacy` obligatorio; mismas rutas `panel`/`aggregates`/`export`. | Una sola puerta de cálculo = paridad por construcción (§MKT.G.2); el selector ya devuelve `400 {field, allowed}`. |
| D2 | Gráfica diaria = tabla `r3`, que **solo existe con `privacy='exact'`** (sesión del dueño en `panel`). Con `small_cells` (tokens, exports, weekly-excel, correo) `r3` no se emite. | La prohibición de detalle por día (`marketing-period.ts:6`) existe para que dos rangos solapados no despejen una celda oculta. En régimen `exact` no hay celdas ocultas (D-MKT-PANEL-2: el dueño ya ve exactos); el periodo sigue siendo una semana cerrada (no hay rango libre, `marketing-period.ts` no cambia) y ninguna salida con supresión lleva el diario. |
| D3 | Avisos = reglas fijas y umbrales en un archivo puro (`marketing-alerts.ts`); sin IA. Todo umbral de conteo ≥ 5. | Reproducible y auditable; con umbral ≥ 5 ninguna cifra citada es una celda pequeña, así que el mismo aviso sale en el correo. |
| D4 | Correo semanal = job BullMQ + fila `MarketingWeeklyDigest` única por semana. | Idempotencia por restricción de BD; patrón de `spend-digest` y `ownerRecipients`. |
| D5 | Tráfico propio: lista por patrón (no por valor), bandera en el navegador y filtro en GA4 y en BD. | Crece sin trabajo: cualquier herramienta nuestra se nombra `diag-*`/`qa-*`/`e2e-*`/… o añade `?tcg_int=1`. |
| D6 | Búsqueda interna = registro propio c6 (solo «sin resultado»); el término **nunca** va a GA4. | `search` solo lleva `results_count` (EVENT_PARAMS, track.ts:42, §MKT.H.4). |
| D7 | Consent Mode con modelado: **no se activa**. | Ver §6.9. |

## 1. Pantalla `r` (Resumen)
Periodo: semana cerrada (misma resolución que `a`; por defecto `lastClosedWeek`). Mes: solo `r1`/`r2` (el diario no aplica).
- **Catálogo construido** (fuente: test de registro): `r1` (12 filas = 8 cifras + sublíneas «· Nuevos», «· Recurrentes», «· Ventas (MX$)», «· Google: impresiones»; la fila se identifica por su etiqueta), `r2`, `r3`, `c9` estados, `e2` páginas de Google. Delta: neutro (≈) ⇒ `delta_abs` y `delta_pct` null; nuevo (`prev=0`) ⇒ `delta_abs` con `delta_pct` null.
- **Desviaciones aceptadas (arquitecto 2026-11-09):** (1) sin familia `r` en `marketing-populations.ts`: supresión local en r1 aceptada SI aplica la misma regla N<5 y, cuando Nuevos o Recurrentes sale «< 5», oculta también su complemento (el total es visible); seguridad-lead lo mide. (2) AV4 por filas de SC por página (sin `(query,page)`): aceptada y mejor, la regla solo necesita impresiones/clics/posición por página y nunca toca consultas.
- **r1 «Cifras de la semana»** (8 cifras; 12 filas con sublíneas, columnas `cifra, actual, anterior, delta_abs, delta_pct`; totales sin dimensión ⇒ exactos como a1/a2/a5):
  1 Visitantes reales (GA4 `totalUsers`, sin tráfico propio; «que aceptaron cookies») con sublíneas Nuevos / Recurrentes (`newVsReturning`; 2 filas por `safeRows`, familia nueva `r` en `marketing-populations.ts`, complemento si una sale «< 5»);
  2 Sesiones desde Instagram (a4: «Instagram orgánico» + «Instagram pagado»);
  3 Fichas vistas (`view_item` eventCount);
  4 Agregados al carrito (`add_to_cart`);
  5 Inicios de pago (`begin_checkout`);
  6 Pedidos pagados y MX$ (a1; BD, no depende de consentimiento);
  7 Google: clics e impresiones (Search Console, sin dimensión; datos con ~2–3 días de retraso ⇒ nota «el fin de semana puede estar incompleto»);
  8 Aceptación de cookies (f1, % de respuestas «aceptar»; es el factor de lectura de las filas GA4).
  Delta: `prev=0` ⇒ `delta_pct=null` («nuevo»); si actual y anterior < 5 ⇒ neutro («≈», ruido). Sin GA4 ⇒ las filas GA4 llevan el motivo `NO MEDIDO` literal.
- **r2 «Qué hacer esta semana»** (avisos, §2): columnas `regla, gravedad, titulo, evidencia, accion` (texto).
- **r3 «Día por día»** (solo `exact`, 7 filas CDMX): `dia, nuevos, recurrentes, ses_instagram_organico, ses_instagram_pagado, ses_google, ses_ia, ses_directo_otros`. GA4 `date` + `newVsReturning` / + origen (agrupado con `a4Group`). Se valida `metadata.timeZone` de la respuesta de GA4 = `America/Mexico_City`; si no, r3 sale `NO MEDIDO — la zona horaria de GA4 no es CDMX`. Nota fija en r3: «solo visible para ti».

## 2. Avisos (reglas deterministas)
Orden fijo; ≤ 3 elementos por regla (orden: cifra desc, clave asc); regla sin elementos ⇒ sin aviso; ningún aviso ⇒ fila «Sin avisos esta semana». Cada aviso cita sus números en `evidencia`. Plantillas en español en `marketing-alerts.text.ts`.
| Id | Regla (semana cerrada) | Acción (plantilla) | Fuente |
|---|---|---|---|
| AV1 alta | `begin_checkout` ≥ 5 y pedidos pagados = 0 | «Iniciaron N pagos y nadie pagó: prueba el pago tú mismo.» | a5 + BD |
| AV2 alta | grupo a4 con sesiones previas ≥ 10 y actual ≤ 50 % de la previa | «Instagram orgánico bajó de 11 a 1 (−91 %): revisa que la historia lleve el enlace.» | a4 ×2 semanas |
| AV3 media | ficha con vistas ≥ 10, 0 vendidas y carritos ≤ 1 | «X: N vistas, 0 ventas: revisa precio, foto y descripción.» | `items` + BD (`soldIdsOf`) |
| AV4 media | página de Google con impresiones ≥ 20 y clics = 0 | «X salió N veces en Google sin clics (posición p): mejora título y descripción de esa ficha.» | SC página |
| AV5 media | carta con ≥ 5 cotizaciones de buylist en la semana y 0 unidades `listed` de plataforma | «Te la cotizan N veces y no tienes a la venta: súbela de oferta o consíguela.» | `BuylistQuoteDailyCount` + inventario |
| AV6 info | término con ≥ 5 búsquedas sin resultado en ≥ 2 días | «Buscan "X" N veces y no hay resultado: ¿falta en el catálogo?» | c6 |
Umbrales calibrados a ~55 usuarios/semana (HECHOS 2026-11-09); backend los agrupa en constantes con nombre y backend/qa los revisan a las 4 semanas (no se pregunta al dueño). Regla con fuente sin medir ⇒ se omite y `r2` lo dice («No se evaluó: GA4 sin conectar»).

## 3. Correo del lunes
- Job `marketing-weekly-digest`, patrón `30 8-20 * * 1` zona `America/Mexico_City` (tras `spend-digest` 08:00; reintenta cada hora hasta las 20:00). Flag `ConfigSetting` `marketing_weekly_digest` (default `on`, sin acción del dueño).
- Idempotencia: `INSERT MarketingWeeklyDigest(weekStart) ON CONFLICT DO NOTHING`; solo quien reclama (`status='pending'` y `claimedAt` nulo o > 15 min) envía; al enviar ⇒ `status='sent', sentAt`. Fallo ⇒ `attempts+1`, sigue `pending`, reintenta el siguiente tick. `sent` ⇒ no-op.
- Destinatarios: `ownerRecipients(prisma)` (spend-mail.service.ts:53). Envío: `MAIL_PORT.send`.
- Contenido: `screen('r', semanaCerrada, now, 'small_cells')` ⇒ `r1` + `r2` (sin `r3`), asunto «Tu semana en TCG HUNT: 2–8 nov», botón al panel. **Sin datos personales:** solo agregados, nombres de carta, términos de c6 ya filtrados (PII + N≥5 en ≥2 días), páginas de Google (nunca consultas de Google), sin correos/nombres/pedidos individuales. Texto plano + HTML.
- Si no hay `ownerRecipients` ⇒ `status='skipped'` y registro en log (sin reintento infinito).

## 4. Tráfico propio (`diag` y similares)
- **Patrón** (fuente única `backend/src/modules/marketing/internal-traffic.ts`, copia en `frontend/src/lib/measurement/internal.ts`, prueba de paridad): `utm_source` o `utm_medium` que cumple `^(diag|qa|e2e|smoke|test|probe|internal)([-_.].*)?$` (insensible a mayúsculas), o `?tcg_int=1`. **Crece solo:** nuestras herramientas se nombran con ese prefijo (`diag-lighthouse`, `qa-playwright`…); no se edita lista alguna. Marketing/devops reciben la convención (README de `scripts/`).
- **En el navegador (corta en origen):** si la URL cumple, se guarda `localStorage.tcg_int='1'` (90 días; solo señal local, nada sale al servidor; `?tcg_int=0` lo quita). Con la bandera: `track()` no hace nada, `loadMeasurement` no se llama, no hay banner, no hay contador de banner, no se escribe cookie de primer UTM. El dueño puede marcar su propio teléfono abriendo `tcghunt.mx/?tcg_int=1` una vez (opcional, no bloquea nada).
- **En GA4 (historial y lo que se cuele):** `ga4Report` añade a TODA consulta `dimensionFilter` = `notExpression` de (`sessionSource` OR `sessionMedium` con `PARTIAL_REGEXP` `(?i)^(diag|qa|e2e|smoke|test|probe|internal)([-_.].*)?$`), combinado con `andGroup` si la consulta ya trae `inList`. Corrige semanas pasadas (1–8 nov ⇒ 17 de 55 salen). El filtro entra en la llave de caché. **NO VERIFICADO:** compatibilidad de `sessionSource` con las métricas por ítem (`itemsViewed`): backend corre `checkCompatibility` con credenciales reales; si falla en `items`, esa consulta usa la bandera del navegador y su nota dice «incluye tráfico propio anterior al 2026-11-xx». No hace falta filtro de datos de la consola de GA4 (el de «tráfico interno» es por IP y el escritor de la API requiere permiso de edición que la cuenta de servicio de solo lectura no tiene); es innecesario porque el navegador ya no envía nada.
- **En BD:** las tablas que agrupan por `firstUtm*` (b1–b3, b6, g1) excluyen las claves que cumplen el patrón **antes** de calcular totales de familia (misma función `isInternalUtm`), para que la supresión coherente siga cuadrando.
- Search Console no recibe tráfico propio (no hay UTM): sin cambio.

## 5. Datos de GA4 / Search Console: qué entra
Consumo HOY (medido en código): 7 consultas por semana cerrada (`marketing-ga4.ts:18-40`: sources, funnelEvents, funnelSessions, pages, devices, items, aiReferrals) + 1 de Search Console (`marketing-external-sources.ts:117`); caché en memoria 6 h por (consulta, rango) (`:21,:145`); un mes = 1 + semanas que lo tocan por cada consulta con dimensión (hasta ~28 en frío). Cuota real de GA4 **NO MEDIDA**.
| Dato | Decisión | Dónde / porqué |
|---|---|---|
| Nuevos vs recurrentes (`newVsReturning`) | **Entra** | r1, r3. Dice si Instagram trae gente nueva. |
| Estado (`region`) | **Entra** | tabla `c9` «Estados de quienes visitan» (usuarios; celdas pequeñas). Orienta envíos/eventos. |
| Ciudad | **No** | celdas de 1–2 personas con 55 usuarios: reidentifica; el estado basta. |
| Búsqueda interna (`search_term` de GA4) | **No** | el término nunca va a GA4 (§MKT.H.4). Se cubre con c6 propio + evento `search` (`results_count`) para el conteo. |
| Scroll | **No** | la medición mejorada está apagada por diseño (§MKT.H.10); con ~55 usuarios no cambia una decisión; `buy_button_visible` (c4) es mejor señal. |
| Search Console por página | **Entra** | totales para r1; AV4 usa filas por página (sin consulta); tabla `e2` «Páginas en Google» (página, clics, impresiones, CTR, posición; celdas pequeñas sobre clics). |
| `engagedSessions` por aterrizaje | **Entra** | c3 y c8. |
Consultas nuevas por semana: `nvr`, `dailyNvr`, `dailySrc`, `landing`, `region` (GA4) y 2 de SC (`page`, `query+page`); `funnelEvents` pasa a `events` (misma consulta con más eventos en su lista: `buy_button_visible`, `search`; a5 sigue leyendo `FUNNEL_EVENTS`), `funnelSessions` suma `totalUsers`. Resumen en frío ≈ 12 consultas GA4 + 4 de la semana previa + 3 SC ≈ 19; el correo reutiliza caché. Mes ≈ +5 consultas por semana tocada. Backend: pide `returnPropertyQuota: true` y avisa en el log (sin datos) si `tokensPerHour.remaining` < 20 %; los `ga4Report` concurrentes de una pantalla se limitan a 4 a la vez. Presupuesto objetivo: ≤ 30 consultas por vista fría.

## 6. Los 10 arreglos
1. **c2 «Dónde pasan más tiempo»**: `pageTypeOf(path)` puro en `marketing-ga4.ts` (home, catálogo-lista, ficha-carta, sellado-lista, ficha-sellado, carrito/checkout, buylist, cuenta/bóveda, card-show, otras; ignora query/hash; idioma `es|en` indistinto). `pages.limit` 50 → 250 para clasificar (c1 sigue mostrando top 50). c2 = tiempo medio de interacción por tipo.
2. **c3 «Dónde abandonan»** (definición): por tipo de página de aterrizaje, `1 − engagedSessions/sessions` (spec `landing`). **c8** = misma spec filtrada a `sessionSource` de Instagram (`INSTAGRAM_SOURCES`), sesiones por tipo.
3. **c4 «% de fichas con COMPRAR visible»**: `buy_button_visible` ya existe en `EVENT_PARAMS` pero ningún componente lo emite. Frontend: `IntersectionObserver` sobre el botón en `CardDetailView` y `SealedDetailView`, una vez por vista, con `seconds_to_visible`. c4 = `buy_button_visible / view_item` (spec `events`).
4. **c6**: ver §7 (`SearchNoResultDaily`). El filtro PII ya existe (`marketing-pii-filter.ts`, mismo que h1). **Gate:** `seguridad-lead` aprueba el filtro y el endpoint antes de publicar (estaba pendiente PM-M2). Encendido por flag `marketing_search_log` (default `on` tras el veredicto; sin acción del dueño).
5. **N-1 `view_item`/`ViewContent` perdidos al aceptar el banner en la ficha**: causa (`track.ts:228-231,278-290`): con la cookie ya leída y **sin elección**, `runtimeConsent === null`, así que `view_item` no se encola (solo se encola cuando es `undefined`) y se descarta; además `setRuntimeConsent(null)` vacía la cola. Arreglo: en `trackUnguarded`, `runtimeConsent === null` en ruta medida ⇒ encolar (mismo tope 20 y misma ruta); `setRuntimeConsent(null)` NO vacía; solo vacía un rechazo explícito `{analytics:false, ads:false}`; al aceptar, `flushPendingEvents()` (ya corre en `MeasurementProvider.tsx:148`) envía lo de la misma ruta. Privacidad: cola solo en RAM, sin escribir nada, se pierde al recargar/navegar; nada sale antes de aceptar. Prueba: abrir ficha → aceptar → 1 `view_item` GA4 y 1 `ViewContent` (si aceptó anuncios).
6. **Aviso viejo de Search Console**: `MarketingView.tsx:435` pinta siempre `screen.e.pending` en la pantalla `e` (también `messages/es.json:7264` y su par en `en.json`). Se borra la línea y las dos claves; el motivo real ya viene de cada tabla (`notMeasured`).
7. **d1 «más vistas vs más vendidas» vacía**: no es el cruce `itemId` (front `item.ts:41` y back `measurement-item.ts:58` usan ambos `c_<cardId>`); causa: `d1Cards` solo pinta filas de cartas **vendidas** (`d1Sold`, `marketing-analytics.service.ts:722,740`) y la semana tuvo 0 ventas. Arreglo: filas = unión de las 10 cartas con más vistas de GA4 (`itemViews`, ids `c_*`) y las vendidas; vendidas = 0 exacto en las que solo se vieron; nombre desde `Card`. La fila «Otros» de ventas no cambia.
8. **`/es/checkout` con 0 vistas y 8 usuarios**: no es un fallo: `NO_PAGE_VIEW = ['/checkout']` (`routes.ts:45`, §MKT.H.4 «no en checkout») y `screenPageViews` cuenta solo `page_view`; los 8 usuarios vienen de otros eventos de esa ruta. Arreglo: enviar `page_view` en checkout con `page_location` = origen + ruta, **sin query ni hash**, y `page_referrer` solo ruta (se reutiliza `sanitizeMeasurementUrl`). Cambio de contrato §MKT.H.4 (lo hace el arquitecto aquí); `seguridad-lead` revisa que checkout no filtre parámetros.
9. **Consent Mode v2 con modelado**: hoy `loader.ts:47-53` declara los cuatro permisos en `denied` y solo sube `analytics_storage` al aceptar, y `loadGoogle` solo se llama con consentimiento (`:103`): Google no recibe nada de quien rechaza o no responde. El «modelado» exige cargar la etiqueta ANTES de elegir (modo avanzado, pings sin cookies con IP y navegador), lo que contradice el aviso aprobado (nada antes de la elección, HECHOS 2026-10-23/26), y GA4 pide un volumen mínimo de eventos/usuarios por día (umbral de la documentación de Google, **NO VERIFICADO hoy**) que ~55 usuarios/semana no alcanzan. Decisión: **no aplica**; los permisos v2 ya están en `denied`. Cobertura honesta: r1 rotula las filas GA4 «que aceptaron cookies» y muestra la tasa de aceptación; BD (pedidos) y contadores de servidor cubren a todos.
10. **Selector de periodo (26 oct–1 nov el lunes 9 nov)**: el servidor ya devuelve 2–8 nov como primera opción desde las 00:00 CDMX del lunes (`marketing-period.ts:166-170` ⇒ `lastClosedWeekStart(9 nov)`=2 nov; `to=8 nov < hoy`, `:158`). **NO MEDIDO en producción.** Causas probables en el cliente: (a) `?week=2026-W44` guardado en la URL/favorito (`url-state.ts:35`, `MarketingView.tsx:48` la respeta si está en la lista); (b) pestaña abierta desde antes con `periods` en caché (`staleTime` 60 s, sin refetch al volver). Arreglo: `r` abre SIEMPRE en `lastClosedWeek` (ignora `week` de la URL salvo elección explícita en la sesión); `periods` se revalida al volver a la pestaña y cada 30 min; si lo elegido no es la primera opción, aviso «Hay una semana más reciente: 2–8 nov» con un clic. Prueba con reloj falso: lunes 9 nov 00:00 CDMX (06:00 UTC) ⇒ `closedWeeks[0].weekStart==='2026-11-02'`; domingo 8 nov 23:59 CDMX ⇒ `'2026-10-26'`. QA mide el valor real en producción con `GET /admin/marketing/periods`.

## 7. Esquema (migración aditiva `m99`; sin tocar tablas existentes)
```
model SearchNoResultDaily {      // c6: sin usuario, sin IP, sin cookie
  id String @id @default(uuid())
  termNormalized String          // [a-z0-9ñ ._-], ≤ 40, ya filtrado de PII
  day DateTime @db.Date          // día CDMX
  count Int @default(0)
  @@unique([termNormalized, day])
  @@index([termNormalized])
}
model MarketingWeeklyDigest {    // idempotencia del correo
  weekStart DateTime @id @db.Date   // lunes CDMX de la semana reportada
  status String                      // pending | sent | skipped
  attempts Int @default(0)
  claimedAt DateTime?
  sentAt DateTime?
}
```
`ConfigSetting`: `marketing_search_log`, `marketing_weekly_digest` (sin migración de esquema; alta idempotente por seed/migración de datos). Retención c6: bajo el umbral 30 días, visibles 90 (job de limpieza como `marketing-access-log-retention`). Reversa: borrar tablas y flags; nada más depende de ellas.
**Endpoint nuevo `POST /api/v1/marketing/search-miss`** · público · `{ term: string ≤ 80, kind: 'card'|'sealed' }` · `204` siempre (también si el filtro descarta el término; sin eco). Throttle por IP en memoria (la IP no se guarda). El navegador lo manda una vez por término y pestaña (dedup en `sessionStorage`) solo cuando la búsqueda terminó con 0 resultados, sin importar el consentimiento (no hay identificador). Incrementa con `INSERT … ON CONFLICT (termNormalized, day) DO UPDATE count=count+1`. Lectura: `SUM(count) ≥ 5` en ≥ 2 días distintos.

## 8. Reparto y criterios
**Backend:** `marketing-alerts.ts` (+`.text.ts`), `internal-traffic.ts`, specs/`ga4Report` (filtro, `returnPropertyQuota`), `screenR`, `c2/c3/c4/c6/c8/c9/e2`, `d1`, `pageTypeOf`, ruta `search-miss`, digest + job en `scheduler.service.ts`, migración `m99`, contador de cuota. **Frontend:** pestaña Resumen (8 tarjetas con flecha, avisos, gráfica diaria con los componentes de gráfica existentes, nota «solo visible para ti»), selector (§6.10), bandera de tráfico propio, cola de eventos (§6.5), `buy_button_visible`, evento `search` + POST de `search-miss`, `page_view` de checkout, borrar el aviso de SC; es/en con paridad. **DevOps:** README de `scripts/` con la convención `diag-*`/`?tcg_int=1`; si el cron no corre en Railway (1 réplica), verificar `REDIS`/cola; nada de secretos nuevos. **Arquitecto:** este documento, PROJECT §MKT-V2, contrato.
Criterios (qa mide con N): (1) `GET panel?pantalla=r` abre en la última semana cerrada y trae r1 (8 filas), r2 y, solo en `exact`, r3; con `small_cells` (token, export, weekly-excel) 0 filas de r3 (k/N en las 3 salidas). (2) Con el fixture de la semana 1–8 nov, el tráfico `diag` no cuenta (17 de 55 fuera). (3) Cada aviso con datos de entrada conocidos produce exactamente el texto esperado; con todos bajo umbral, «Sin avisos». (4) Correo: 2 ejecuciones del job la misma semana ⇒ 1 envío; fallo de correo ⇒ reintento sin duplicar; el cuerpo no contiene correos, nombres de clientes ni consultas de Google. (5) Ver ficha → aceptar ⇒ `view_item` llega (§6.5). (6) c6: términos con CURP/RFC/correo/≥7 dígitos no se guardan. (7) Un mes cerrado no trae r3. **Gates:** `qa` + `seguridad-lead` antes de publicar (PII de c6, `page_view` de checkout, bandera local, r3 solo `exact`, correo).

## 9. Riesgos de privacidad
R1 r3 (diario exacto) solo en `exact`: un export futuro que llame `screen` con `exact` lo filtraría ⇒ candado `marketing-panel-privacy.spec.ts` (único productor de `'exact'`) + prueba de que `export`/`weekly-excel`/correo piden `small_cells`. R2 c6 guarda texto escrito por personas: filtro PII + umbral + retención + sin identificador; apagable con el flag. R3 correo sale a un proveedor externo: solo agregados con umbral ≥ 5. R4 `localStorage.tcg_int` es señal local sin dato personal; solo se escribe si la URL trae la etiqueta. R5 `page_view` de checkout: sin query ni hash. R6 `region` con celdas pequeñas y sin ciudad.

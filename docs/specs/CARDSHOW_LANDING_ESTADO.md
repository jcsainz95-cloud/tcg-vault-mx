# Card Show — landing: estado (actualizado 2026-10-18, orquestador — PUBLICADO + REDISEÑO DINÁMICO)

## CIERRE 2026-10-18 — LANZADO EN PRODUCCIÓN (sesión orquestación). Medido en vivo por el orquestador.

**La landing del Card Show está VIVA y CAPTANDO registros en `tcghunt.mx/card-show`.** Lo que entró hoy:

- **Rediseño dinámico de la landing (PR #97, `production` `806440f`).** Frontend sobre tinta (línea §CS-UX): hero
  con **explosión de una sola vez por sesión** (cartas que se disparan y **se desvanecen** dejando el hero limpio —
  WCAG 2.2.2, sin bucle perpetuo), **rifa como gancho arriba** (barra roja + mención en el hero), **mapa de Google
  embebido** en «Cómo llegar», **agenda** como línea de tiempo, **torneos** en tira horizontal, y **lockup real**
  «TCG HUNT × Jakomi» (mascota `jakomi-mascota.webp` + «Jakomi» en texto de marca; enlace a inicio). Librería
  `motion@14.3.0` bundleada (sin CDN, por la CSP). Respeta `prefers-reduced-motion` y SSR sin-JS, CLS 0.
  Gates: **qa ✅ · techlead ✅ · seguridad ✅ · tester-e2e ✅ · ux-review ✅** sobre sha `2dff91f` (+ O-9 del orquestador).
- **Cambio de CSP del mapa (dentro de #97):** `frame-src += https://www.google.com` (único delta; `frame-ancestors`
  intacto). Autorizado por JC 2026-10-18; **seguridad APROBÓ** (veredicto en `docs/SECURITY_NOTES.md`, sha `5049a34`).
- **Backend del Card Show desplegado (PR #98 + secretos en Railway).** El deploy del backend llevaba días fallando
  porque exige fail-closed dos secretos nuevos (`CARD_SHOW_FORM_SECRET`, `CARD_SHOW_LINK_SECRET`) que no estaban
  cableados. #98 (`b40b244`) los cabló en el pipeline + catálogo del contenedor; **JC puso los valores en Railway
  (production)** y el backend arrancó. **Verificado en vivo por el orquestador:** `GET /api/v1/card-show/form-token`
  → 200 (antes 404); `POST /api/v1/card-show/leads` (visitante) → **202 `{ok:true}`** (lead de prueba
  `prueba-api-cardshow-1792345934@example.com`, pendiente, borrable del admin).
- **Issue #96** (huella del fallo del DAST) **cerrado** apuntando a #98.

> Los valores de los 2 secretos viven **solo en Railway** (NUNCA en el repo/chat). Son requisito de arranque del
> backend: sin ellos el contenedor hace crash-loop (candado a propósito). `staging` de Railway no aplica (no se usa;
> el stack del DAST los resuelve efímeros en CI).

### Pendientes post-lanzamiento (no bloquean; abiertos al cierre del 2026-10-18)
1. **OG de WhatsApp/IG = placeholder.** `frontend/public/card-show/og.png` sigue siendo el marcador («PLACEHOLDER…»,
   «San Jose» sin acento). **Marketing produce la final 1200×630; JC elige A/B**; frontend la commitea en la misma
   ruta. Dueño: marketing + JC + frontend.
2. **Privacidad vs terceros (Google Maps + fuentes de Google).** El mapa embebido y `fonts.googleapis.com/gstatic`
   cargan al abrir (cookies/peticiones a Google), pero el aviso de privacidad dice «no usamos cookies de analítica».
   Salidas: cargar el mapa **al tocar** (imagen estática antes) o **declarar Google en el aviso**. Lo marcaron
   seguridad y marketing. Dueño: product-owner/arquitecto (texto) + frontend (click-to-load).
3. **Pulido de marketing (fast-follow):** JSON-LD de tipo Event; metadatos fuera del `<body>`; ~18 toques <44px en
   móvil; axe (`label-content-name-mismatch`, `scrollable-region-focusable` en `.cs-rail`); WhatsApp/mailto sin
   texto prellenado; 37 reportes CSP en vivo + `POST /telemetry/csp` por CORS (medir si es solo fuentes no
   declaradas). Dueño: frontend/devops.
4. **Decisión de copy pendiente de JC:** marketing pide **«Torneo oficial Play! Pokémon»** (JC lo decidió el 13-oct);
   confirmar si va en la landing.
5. **Deuda de pipeline/CI (no bloquea el evento):** `backend-e2e` flaky en CI (choque de Postgres compartido entre
   runs concurrentes ⇒ se cuelga y lo cancelan ⇒ `e2e-ok` rojo); P-WH-1 (repo público ⇒ `stripe-webhook-failclosed`
   rojo estructural). Ninguno es defecto de la tienda. Dueño: devops.
6. **Higiene:** `PENDIENTES.md` rebasó su tope; `frontend/src/content/card-show.ts` conserva el comentario stale
   «único secreto = patrocinadores» + `card-show.secrets.test.ts` no-op. Compactar/limpiar en un pase propio.

### Changelog
- **2026-10-18:** PUBLICADO. #97 (rediseño dinámico) + #98 (secretos backend) en `production`; forms captando (202
  verificado); #96 cerrado. Rediseño nació de: «no me gusta, que sea dinámico con movimiento» → preview aprobado
  («mézclalos tú» + «atrevido») → 5 rondas de frontend + 2 de cada gate de navegador hasta verde.

## DECISIONES JC 2026-10-17 (R5 — tras ux-review RECHAZADO + marketing RONDA 2). Verbatim del chat.
Estas cuatro las respondió JC hoy; mandan sobre lo de abajo donde choquen. Pendientes de integrar en el brief de marketing (product-owner) y en el aviso de privacidad.
1. **Rifa — JC ACEPTA EL RIESGO LEGAL (verbatim: «Acepto ese riesgo»).** Cierra la condición de marketing «JC no ha aceptado por escrito el riesgo de permiso de Gobernación». La rifa se queda. Igual hay que **arreglar el consentimiento** (casilla de rifa propia y DESMARCADA, con enlace a las bases; la casilla de privacidad NO debe forzar aceptar bases; aclarar quién participa).
2. **Precio de torneo = MX$200 para los MAINS de Pokémon** (verbatim: «es 200 para los mains de pokemon»). Landing y correo deben coincidir: el main de Pokémon dice **$200**; los demás juegos/eventos siguen «por anunciar» hasta que JC confirme. (No estaba en HECHOS; esta línea es la fuente.)
3. **Datos a Jakomi = SOLO tipo y conteo** (sin datos personales). El aviso interno NO debe copiar a `cardshow@jakomi.mx` el nombre/teléfono/correo del vendedor; eso solo va a TCG HUNT (`jsainz@tcghunt.mx`). Revierte parte de IMP-3 de R4 respecto a la copia a Jakomi. Cierra L2-SEG-01.
4. **Correo a patrocinador = SIN cifras**: quitar $25,000/$8,500 y el copy heredado («presented by», «prize partner», «deck»); decir «pide la propuesta de patrocinio».

### DATOS DEL EVENTO (JC, 2026-10-17 chat — verbatim; fuente única para la landing, va a `frontend/src/content/card-show.ts`)
- **Nombre:** Card Show CDMX · TCG HUNT × Jakomi TCG Café.
- **Dirección:** José del Castillo 3, esq. Av. Revolución, Col. San José Insurgentes, Benito Juárez, 03900 CDMX.
  - Piso 2: vendedores. Piso 3: torneos, juego libre y comida.
- **Horarios (entrada libre):** Sábado 5 dic 11:00–19:00; Domingo 6 dic 11:00–18:00.
- **Torneo de Pokémon (PRELIMINAR; horarios finales en los próximos días):** Sáb 12:00–18:00; Dom 12:00–17:00.
- **Montaje de vendedores:** viernes 4 dic (horario se confirma al apartar la mesa).
- **Cómo llegar:** Metro Mixcoac (Líneas 7 y 12) + ~5 min caminando por Av. Revolución; Metrobús Línea 1 estación Río Churubusco.
- **Maps:** https://www.google.com/maps/search/?api=1&query=Jos%C3%A9+del+Castillo+3%2C+San+Jos%C3%A9+Insurgentes%2C+Benito+Ju%C3%A1rez%2C+CDMX (enlace externo; la CSP no admite iframe de mapa — va como enlace).
- *Nota:* el torneo de Pokémon es el main de MX$200 (decisión 2 arriba). Los horarios del torneo son PRELIMINARES ⇒ el copy debe decirlo.


## ESTADO VIGENTE 2026-10-17 — decisiones del dueño (JC, chat). Supersede lo de abajo.
La landing deja de ser «anuncio con datos» y pasa a ser **página de CAPTURA DE LEADS** que **NO expone el
modelo de negocio**. Decisiones medidas del chat de hoy:
- **Fuera del público:** precios de mesa, plano de 23 mesas, montos de patrocinio. → quitar
  `mesaInteres`/mesa/plano del modelo y de la página.
- **Captura — Asistente/consumidor:** nombre, email, juego de interés (opcional), participar en rifa
  (sí/no, **DESMARCADA** — ⭐M-89 R5, casilla propia separada de privacidad + enlace a bases), consentimiento.
- **Captura — Vendedor/Patrocinador:** tipo, **nombre o marca**, email, **teléfono**, «¿qué vendes/qué
  marca?» (opcional), consentimiento.
- **Preinscripción a torneo:** **Pokémon = FORMAL con Player ID**; **demás juegos (Riftbound, Lorcana,
  4.º) = LIGERA** (solo interés, sin Player ID). *(JC 2026-10-17: «para pokemon lo pedimos para las demas ligero».)*
- **Torneos por juego:** Pokémon (principal), Riftbound, Lorcana, **4.º por confirmar**; horarios/costos
  «por anunciar».
- **Rifa:** dinámica INFORMAL sin costo entre asistentes y registrados; **hay que estar presente para
  ganar, se elige en vivo**; premio = **Pokémon TCG 30th Celebration Poster Collection**. Casilla de
  participación **DESMARCADA** (⭐M-89 R5) con enlace a bases, separada de la casilla de privacidad. NO es sorteo formal. JC aceptó el riesgo legal (R5).
- **Jakomi:** colaborador visible (logo + nombre «Jakomi», «organiza los torneos»), **SIN enlaces a sus
  redes**; co-branding arriba (TCG HUNT × Jakomi).
- **Marca:** look & feel real de TCG HUNT (papel/tinta, rojo #b31217, Montserrat wordmark/títulos, Archivo
  cuerpo, JetBrains mono) — medido en `frontend/src/app/globals.css` y `tailwind.config.ts:55-57`.
- **Acceso del dueño a los registrados:** **pantalla «Card Show» en el panel super_admin** (lista
  filtrable Leads + Torneo) + **Descargar CSV**, **Y ADEMÁS un correo-resumen periódico** con conteo y CSV
  (JC 2026-10-17: «dame el correo también»). El API/CSV ya existe
  (`/admin/card-show/leads|players[/export.csv]`, §CARDSHOW.15); falta la **pantalla**, las **columnas
  nuevas** y el **correo-resumen** (job programado → devops/backend).
- **Contador:** se queda.
- **Reuso (ya hecho, no se rehace):** doble opt-in, anti-abuso (honeypot, topes por buzón, presupuesto),
  clicks, mailbox caps.
- **Preview de aprobación:** https://claude.ai/artifact/4cq1rzYiQmDP3WkuXztTfc (V8). Vive en scratchpad
  `cardshow-preview-brand.html` — es mock, NO repo.
- **Plan de build:** arquitecto (contrato §CARDSHOW: +nombre/teléfono/juego/rifa/qué-vendes, −mesa/plano;
  torneo por juego con Player ID solo Pokémon; enum `CardShowGame`) → backend (migración + DTO + servicio +
  columnas CSV) → frontend (reescribe `card-show.ts` sin precios + arma la página + pantalla admin) → gates
  qa+techlead + tester-e2e/ux-review.

---

# Card Show — landing: estado ANTERIOR (medido 2026-10-14, actualizado 2026-10-16 orquestador sesión 10)

> **DECISIÓN DEL DUEÑO 2026-10-16 (JC, verbatim en chat): «sí con todo hoy», «te los puedo pasar todos
> esos datos son públicos».** Esto CAMBIA el estado anterior: el anuncio se ADELANTA a HOY (ya no el 27-oct),
> la página sale CON LOS DATOS REALES (no teaser), y esos datos son PÚBLICOS por decisión del dueño ⇒ van
> directo en el código (ya no hay secreto que proteger). Consecuencias enrutadas: (1) se retira el guard de
> secreto (CARDSHOW_SECRET_TERMS + aserciones TBD del test), porque su premisa —secreto hasta 27-oct— ya no
> aplica; (2) card-show.ts lleva los valores reales que JC pegue. Resend: NO bloquea, medido —
> `card-show-mail.service.ts:84-87` cae al `MAIL_FROM` general = `no-reply@tcghunt.mx`, dominio ya verificado.
>
> _(Estado anterior 2026-10-14, superado: «se retoma el viernes, SECRETO hasta el 27-oct, solo marcadores TBD».)_

## Qué hay construido (rama `feat/event-landing`, medido contra `production`)
- `794e7f6` — backend Fase 1: captura de registro, doble opt-in por correo, anti-abuso (M-78, contrato v1.93⟨cardshow⟩).
- `cb78f51` — frontend Fase 1: la página (ruta fuera de i18n), 2 formularios, el plano, aviso de privacidad.
- `9947f91` — contrato + arquitectura del evento (M-78).
- **La rama está 3 commits adelante y 10 commits ATRÁS de `production`** (quedó atrás desde el merge del sellado #93). Sin fusionar, sin publicar.

## Lo que falta para sacarla (orden del viernes)
1. **Reconciliar:** traer `production` a la rama (merge, nunca rebase), regenerar lo generado, correr suite.
2. **Gates ligeros** (landing SIN dinero): qa + techlead. Doble veredicto por-stream.
3. **Publicar:** fusionar a `main` y abrir solicitud `main`→`production` con cuerpo en llano (el dueño fusiona; el orquestador NO publica).

## Decisiones del dueño (medidas 2026-10-14)
- **Identidad legal: VA SIN ELLA.** El aviso de privacidad sale con "TCG HUNT" como responsable + correo de contacto; la razón social/RFC se agrega después. (Consecuencia aceptada por el dueño.)
- **Resend (correos de confirmación del doble opt-in): PENDIENTE DE MEDIR CON EL DUEÑO** — ¿subdominio verificado en Resend (ej. `send.tcghunt.mx` + DNS) sí/no? Si sí → sale completo. Si no → (a) capturar ya y correos en cola hasta verificar, o (b) sin doble opt-in (captura directa). NO se resolvió el 14-oct.
- **Contenido público el día de salida: PENDIENTE** — ¿teaser + registro ("regístrate para enterarte", sin fecha/sede/precio), o ya con algún dato? El dueño dijo que los datos reales se cargan cerca del 27. NO se resolvió el 14-oct.

## Constraints que NO se rodean
- ÚNICO secreto vivo (desde 2026-10-16): los NOMBRES DE PATROCINADOR. Los términos los guarda el secreto de CI `CARDSHOW_SECRET_TERMS` (nunca en el repo, ni como ejemplo). Fecha/sede/precios YA SON PÚBLICOS por decisión del dueño; `showSponsors:false` hasta que salgan los horarios de torneo.
- Secretos nunca por chat/repo/logs. El orquestador no publica ni amplía sus permisos.

### Confirmación JC 2026-10-17 (R5, cierre) — Jakomi y datos del torneo
JC confirma: **Jakomi SÍ recibe los datos de preinscripción al TORNEO** (los organiza) ⇒ el aviso de privacidad INTEGRAL §5 (`frontend/src/content/legal/privacidad.es.ts`) que lo declara queda CORRECTO, NO se cambia. La decisión JC-3 (Jakomi solo tipo+conteo) aplica SOLO al correo interno de vendedor/patrocinador (ahí Jakomi ya no ve PII, R5b). Dos flujos distintos. JC urge salir live.

### Confirmación JC 2026-10-17 (cierre) — patrocinadores
- **NO se muestran patrocinadores en la landing** (ya era así: `showSponsors:false`, sin logos/nombres/niveles). Se mantiene el formulario de reclutamiento «Vendedor/Patrocinador» (captación, no exhibición) — JC no pidió quitarlo.
- **NO hay nombre de patrocinador confidencial** (JC). ⇒ Se RETIRÓ todo el aparato del secreto `CARDSHOW_SECRET_TERMS`: job de CI `cardshow-secret-terms` + 2 scripts (revert de 1af7467). Ya NO hay que crear ese secreto (C-SEC-2 anulada) ni cablearlo (C-SEC-1 anulada). SEC-CS-C (nombre en commits viejos) deja de ser hallazgo: los nombres no son secretos.
- Fast-follow (no bloquea): limpiar el comentario «único secreto = nombres de patrocinador» en `frontend/src/content/card-show.ts` y el guard `card-show.secrets.test.ts` (hoy no-op sin la env; no falla).

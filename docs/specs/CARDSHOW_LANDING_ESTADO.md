# Card Show — landing: estado (actualizado 2026-10-17, orquestador — PIVOTE A CAPTURA)

## DECISIONES JC 2026-10-17 (R5 — tras ux-review RECHAZADO + marketing RONDA 2). Verbatim del chat.
Estas cuatro las respondió JC hoy; mandan sobre lo de abajo donde choquen. Pendientes de integrar en el brief de marketing (product-owner) y en el aviso de privacidad.
1. **Rifa — JC ACEPTA EL RIESGO LEGAL (verbatim: «Acepto ese riesgo»).** Cierra la condición de marketing «JC no ha aceptado por escrito el riesgo de permiso de Gobernación». La rifa se queda. Igual hay que **arreglar el consentimiento** (casilla de rifa propia y DESMARCADA, con enlace a las bases; la casilla de privacidad NO debe forzar aceptar bases; aclarar quién participa).
2. **Precio de torneo = MX$200 para los MAINS de Pokémon** (verbatim: «es 200 para los mains de pokemon»). Landing y correo deben coincidir: el main de Pokémon dice **$200**; los demás juegos/eventos siguen «por anunciar» hasta que JC confirme. (No estaba en HECHOS; esta línea es la fuente.)
3. **Datos a Jakomi = SOLO tipo y conteo** (sin datos personales). El aviso interno NO debe copiar a `cardshow@jakomi.mx` el nombre/teléfono/correo del vendedor; eso solo va a TCG HUNT (`jsainz@tcghunt.mx`). Revierte parte de IMP-3 de R4 respecto a la copia a Jakomi. Cierra L2-SEG-01.
4. **Correo a patrocinador = SIN cifras**: quitar $25,000/$8,500 y el copy heredado («presented by», «prize partner», «deck»); decir «pide la propuesta de patrocinio».


## ESTADO VIGENTE 2026-10-17 — decisiones del dueño (JC, chat). Supersede lo de abajo.
La landing deja de ser «anuncio con datos» y pasa a ser **página de CAPTURA DE LEADS** que **NO expone el
modelo de negocio**. Decisiones medidas del chat de hoy:
- **Fuera del público:** precios de mesa, plano de 23 mesas, montos de patrocinio. → quitar
  `mesaInteres`/mesa/plano del modelo y de la página.
- **Captura — Asistente/consumidor:** nombre, email, juego de interés (opcional), participar en rifa
  (sí/no, premarcada), consentimiento (privacidad + bases).
- **Captura — Vendedor/Patrocinador:** tipo, **nombre o marca**, email, **teléfono**, «¿qué vendes/qué
  marca?» (opcional), consentimiento.
- **Preinscripción a torneo:** **Pokémon = FORMAL con Player ID**; **demás juegos (Riftbound, Lorcana,
  4.º) = LIGERA** (solo interés, sin Player ID). *(JC 2026-10-17: «para pokemon lo pedimos para las demas ligero».)*
- **Torneos por juego:** Pokémon (principal), Riftbound, Lorcana, **4.º por confirmar**; horarios/costos
  «por anunciar».
- **Rifa:** dinámica INFORMAL sin costo entre asistentes y registrados; **hay que estar presente para
  ganar, se elige en vivo**; premio = **Pokémon TCG 30th Celebration Poster Collection**. Casilla de
  participación + aceptar bases. NO es sorteo formal.
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

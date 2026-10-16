# Card Show — landing: estado (medido 2026-10-14, actualizado 2026-10-16 orquestador sesión 10)

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
- SECRETO hasta 27-oct: términos prohibidos en grep de CI (alianza/patrocinador/fecha/sede/precio reales). Solo marcadores TBD en el repo público.
- Secretos nunca por chat/repo/logs (repo público). El orquestador no publica ni amplía sus permisos.

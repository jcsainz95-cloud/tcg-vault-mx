# Card Show — landing: estado aparcado (medido 2026-10-14, orquestador sesión 9)

> Decisión del dueño 2026-10-14: **se retoma el VIERNES, con calma.** Este fichero es el punto de arranque
> para esa sesión — se **re-mide** antes de enrutar (O-5/O-18). SECRETO hasta el 27-oct: en el repo público
> solo marcadores (fecha/sede/precio/patrocinador en TBD), nunca datos reales del evento.

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

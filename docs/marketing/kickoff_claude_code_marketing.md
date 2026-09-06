# Prompt de arranque — sesión 1 en Claude Code (marketing-agent)

Antes de pegar: guarda en el repo `docs/marketing/brief_instagram_tcghunt.md`, `docs/marketing/prelanzamiento_tcghunt.md` y `docs/marketing/semana_1_tcghunt.md`. Ten las credenciales de Meta en tu gestor de secretos o en un `.env` local que no se commitea. Nunca pegues el token en el chat de Claude Code.

---

Vamos a construir un nuevo módulo: un agente de marketing que lleva el Instagram @tcghunt.mx de forma casi autónoma. Lee entero `docs/marketing/brief_instagram_tcghunt.md` antes de hacer nada; después `prelanzamiento_tcghunt.md` y `semana_1_tcghunt.md`.

## Estado actual (hechos, no supuestos)

- La plataforma NO está live. Lanzamiento estimado en 2–3 semanas. Estamos en fase de pre-lanzamiento: contenido manual, objetivo seguidores + lista de espera.
- La cuenta @tcghunt.mx es profesional (Business), vinculada a la página de Facebook "TCG HUNT".
- Existe una app en Meta for Developers llamada TCG HUNT, en **modo desarrollo**, con dos casos de uso: "Manage everything on your Page" y "Manage messaging & content on Instagram".
- Se configuró la ruta **Instagram API con Instagram Login**. La cuenta @tcghunt.mx está agregada como Instagram Tester y tiene token generado.
- Permisos activos: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_insights` (verificar en consola), `instagram_business_manage_messages` (no usar en fase 1). Del lado de página: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, webhooks agregado.
- Webhooks NO están activos: requieren app publicada. En fase de desarrollo, los comentarios se leen por polling.
- Variables de entorno disponibles (el valor lo lees del `.env`, no lo pidas): `IG_APP_ID`, `IG_APP_SECRET`, `IG_USER_ID`, `IG_ACCESS_TOKEN` (larga duración, 60 días; el servicio debe refrescarlo automáticamente antes de expirar).
- App review de Meta: pendiente. Se enviará cuando el pipeline funcione y podamos grabar el video del caso de uso. Hasta entonces, todo opera en modo desarrollo sobre la propia cuenta, lo cual es suficiente para construir y para fase 1.

## Cola de aprobación, reportes y conexión con la dirección de marketing

No usamos Slack. Todo vive en la plataforma:
- **Cola de aprobación:** página de admin `/admin/marketing` en `apps/web` (reutiliza auth y layout de admin existentes): borradores con vista previa, aprobar / editar / descartar; escalaciones de comentarios con la respuesta propuesta.
- **Notificaciones a JC:** correo transaccional (Resend, SES o similar) desde `marketing@tcghunt.mx` al correo de JC: "N borradores esperan aprobación", escalaciones urgentes, reporte semanal. Link a la cola en cada correo. Asuntos con prefijo fijo `[TCG HUNT Marketing]` y etiqueta por tipo (`Aprobación`, `Escalación`, `Reporte`) para que sean buscables. WhatsApp Business en fase 2.
- **Reporte semanal:** generado los domingos, con formato fijo (mismas secciones y orden cada semana): resumen en 5 líneas; métricas por serie; cotizaciones y cuentas atribuidas por UTM; top 3 y bottom 3 con hipótesis; mix propuesto para la semana siguiente; incidentes de invariantes. Se guarda en la base de datos, se envía por correo y se escribe en Google Drive.
- **Google Drive:** carpeta `TCG HUNT/Marketing/` con subcarpetas `Reportes/`, `Calendario/`, `Piezas/` (renders para revisión), `Brief/` (copia viva). Credencial de Google con permiso limitado a esa carpeta (cuenta de servicio o OAuth de JC con alcance restringido; `security` decide). Nombres de archivo con fecha ISO al inicio (`2026-09-14_reporte_semanal.md`).
- La dirección de marketing (Claude en claude.ai) lee correo y Drive por conector cuando JC lo pide; por eso formatos, asuntos y nombres de archivo deben ser estables.
- **Servidor MCP (sprint 3):** la plataforma expone un servidor MCP autenticado (OAuth) con herramientas de lectura (`get_weekly_report`, `list_drafts`, `list_escalations`, `get_series_metrics`) y de acción (`approve_draft`, `reject_draft`, `update_brief_section`). Se registra en claude.ai como conector personalizado para que la dirección de marketing (Claude en claude.ai) lea y actúe directamente sobre el backend. `security` define alcance de tokens y auditoría de cada acción.

## Decisiones ya tomadas (no reabrir)

- Vive en este repo, en `apps/marketing-agent/`, como servicio independiente con su propio `CLAUDE.md`.
- Solo tiene **acceso de lectura** al backend: precios, stock, fotos y metadata de intake. Nunca escribe en la base de datos de la plataforma.
- El runtime es un servicio programado (cron) que invoca a Claude por API en cada ciclo. Claude Code construye el servicio; no lo opera.
- Publica en Instagram únicamente vía API oficial. Nada de automatización de likes, follows o DMs.
- Sin rostro. Voz en off por TTS con una voz fija en español de México (proveedor por decidir; diseñar la interfaz para poder cambiarlo).
- Los invariantes MKT-1 a MKT-8 del brief tienen el mismo estatus que SEC-A1: pruebas automáticas que bloquean la publicación si fallan. MKT-8 (nunca "pagamos más", nunca mezclar valor de mercado con oferta de buylist) es el más importante para el negocio.
- La autonomía se controla por configuración (`autonomy.yaml` por serie), no por código. Fase 1: todo requiere aprobación.
- Cola de aprobación en la plataforma (`/admin/marketing`), notificaciones por Gmail, conexión con la dirección de marketing vía servidor MCP propio.

## Alcance real: el área de marketing completa, no solo Instagram

Instagram es el primer canal, no el único. El servicio se llama `marketing-agent` porque es el área de marketing entera y JC quiere delegarla por completo. Diseña el núcleo como **agnóstico de canal**: planner, writer, render, approval, invariants e insights son comunes; `publisher/` es un adaptador por canal. Canales previstos, en orden: Instagram (ahora), TikTok (cross-post, fase 2), correo/WhatsApp a la lista de espera y a clientes (fase 2), Facebook page (espejo), y más adelante pauta. La lista de espera y los correos de lanzamiento son parte de este módulo, no de otro.

## Arquitectura de referencia

```
apps/marketing-agent/
  CLAUDE.md            # reglas del módulo: solo lectura del backend, invariantes MKT
  autonomy.yaml        # nivel de autonomía por serie
  brief/               # copia viva del brief, plantillas de prompts por serie
  sources/             # un fetcher por fuente de lista blanca; devuelve dato + URL + fecha
  backend/             # cliente de solo lectura: precios, stock, intake
  planner/             # qué producir hoy según calendario, mix, historial e insights
  writer/              # copy, hashtags, guion de VO
  render/              # plantillas HTML -> PNG; video con ffmpeg
  tts/                 # voz fija, con caché, proveedor intercambiable
  publisher/           # adaptadores por canal: instagram/ (ahora), tiktok/, email/, facebook/ (después)
  comments/            # lectura por polling (webhooks cuando la app esté publicada), clasificación por matriz, respuesta o escalación
  insights/            # métricas por post y serie; atribución UTM desde backend
  approval/            # cola en DB + página admin; estados borrador -> aprobado -> publicado -> medido
  mcp/                 # servidor MCP autenticado para la dirección de marketing (claude.ai)
  invariants/          # tests MKT-1..MKT-8
  jobs/                # produce (3x/día), engage (cada 2h), measure (diario + semanal)
```

## Prioridad inmediata, fuera del agente: landing de lista de espera

Antes de cualquier módulo del agente, necesitamos en la plataforma una landing `/es/espera` (y `/en/waitlist`): un campo (correo o WhatsApp), un botón, un mensaje de confirmación, almacenamiento en la base de datos y UTM capturado. Copy en `prelanzamiento_tcghunt.md`. Es medio día de trabajo y es lo único que convierte tres semanas de contenido en primer día de ventas. Va primero en el plan de sprints, aunque toque `apps/web` y no `apps/marketing-agent`.

## Lo que quiero de esta sesión (sin escribir código del agente todavía)

1. **product-owner:** convierte el brief en un spec técnico con historias de usuario y criterios de aceptación. Cada invariante MKT es un criterio verificable. Incluye los casos de la matriz de respuesta a comentarios como casos de prueba. Incluye el spec corto de la landing de lista de espera.
2. **architect:** una ADR que confirme o corrija la arquitectura de referencia, defina los contratos de lectura contra el backend (qué endpoints se exponen, con qué permisos), el modelo de datos del agente (posts, series, métricas, cola, tokens) y cómo se despliega junto al backend actual. Debe decidir cómo se gestiona y refresca `IG_ACCESS_TOKEN`.
3. **security:** revisión de la ADR: alcance del token de Instagram, almacenamiento de secretos, aislamiento del acceso al backend, qué pasa si el agente es comprometido, y cómo se prueba MKT-8.
4. **techlead:** plan de sprints ordenado así: sprint 0 = landing de lista de espera (esta semana); sprint 1 = publisher mínimo + refresco de token + un post de prueba real en @tcghunt.mx desde código; sprint 2 = planner → writer → render → approval; sprint 3 = comments + insights + reporte semanal + servidor MCP. Cada sprint termina con invariantes en verde.
5. Crea la definición de un nuevo subagente `marketing` con el brief como contexto y las restricciones de este módulo.

Entrégame los cinco documentos en `docs/marketing/` y una lista de preguntas abiertas que necesiten decisión de JC. No supongas respuestas: si algo no está en el brief, pregúntalo.

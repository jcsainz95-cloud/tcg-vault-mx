# SPEC — Módulo `marketing-agent`

Spec técnico-funcional del área de marketing de TCG HUNT (agente que lleva @tcghunt.mx).

| Campo | Valor |
|---|---|
| Autor | product-owner |
| Fecha | 2026-09-06 |
| Estado | **Borrador para aprobación de JC** (contiene supuestos marcados) |
| Fuentes de verdad | `docs/marketing/brief_instagram_tcghunt.md` (contenido), `docs/marketing/kickoff_claude_code_marketing.md` (encargo y decisiones cerradas), `docs/marketing/prelanzamiento_tcghunt.md`, `docs/marketing/semana_1_tcghunt.md` |
| Alcance de este documento | Qué debe hacer el módulo y cómo se verifica. **No** define stack, esquema de datos ni despliegue: eso es del arquitecto (ADR). |

**Excepción de propiedad de archivos:** por instrucción explícita del humano, en esta sesión el product-owner escribe en `docs/marketing/` y **no** toca `PROJECT.md`.

**Convenciones del documento**
- `CA-x.y` = criterio de aceptación verificable. QA los usa como checklist.
- `TC-…` = caso de prueba.
- `(SUPUESTO: …)` = decisión que tomé por falta de información; JC debe confirmar o corregir. Todos están consolidados en §16.
- `(RESTRICCIÓN DADA)` = decisión ya tomada en el kickoff o el brief; no se reabre aquí.

---

## 1. Resumen y objetivo de negocio

### 1.1 En una frase

Un módulo de marketing que produce, verifica, publica y mide el contenido de TCG HUNT en sus canales —empezando por Instagram @tcghunt.mx— con aprobación humana en lote, reglas duras que bloquean la publicación cuando el mensaje contradice el modelo de negocio, y atribución hasta cotizaciones y cuentas.

### 1.2 Problema que resuelve

Hoy el marketing de TCG HUNT no existe como sistema: es tiempo de JC. El costo no es publicar, es (a) producir 7–8 piezas por semana con guion, render y voz, (b) no equivocarse en el mensaje —un solo "pagamos más" rompe el posicionamiento de los dos lados del marketplace—, y (c) saber si el contenido produce dinero o solo alcance.

### 1.3 Métricas (brief §1) — **la métrica real no es el alcance**

| Tipo | Métrica | Fuente |
|---|---|---|
| Indicador adelantado | Seguidores nuevos/semana, alcance de reels, guardados, compartidos | Instagram Insights |
| **Métrica real** | **Cotizaciones iniciadas desde IG, listas de buylist enviadas, cuentas creadas, primera compra** | Backend TCG HUNT (atribución UTM `utm_source=instagram` + landing dedicada) |
| Salud | Tasa de escalaciones, comentarios negativos, quejas | Módulo (cola + reporte) |

**Regla de negocio que gobierna el módulo (brief §1):** *si los seguidores suben y las cotizaciones no, el mix está mal; se ajusta el mix, no se celebra el alcance.* El reporte semanal debe hacer esta comparación explícita (§10, E10).

**CA-1.1** — El reporte semanal presenta, en el mismo bloque y una al lado de otra, la variación semana-contra-semana de (a) seguidores + alcance y (b) cotizaciones + cuentas atribuidas. Si (a) sube ≥10 % y (b) no sube, el reporte incluye la línea de alerta explícita **"Mix mal calibrado: alcance arriba, conversión plana"** y una propuesta de mix corregido.
**CA-1.2** — Ninguna métrica de alcance aparece en el reporte sin su métrica real correspondiente en la misma vista.

---

## 2. Alcance del módulo

### 2.1 Es el área de marketing completa, no solo Instagram (RESTRICCIÓN DADA, kickoff §Alcance real)

El núcleo es **agnóstico de canal**: `planner`, `writer`, `render`, `tts`, `approval`, `invariants`, `insights`, `sources`, `mcp` son comunes. `publisher/` es un **adaptador por canal**.

| Orden | Canal | Fase | En este spec |
|---|---|---|---|
| 1 | Instagram (feed: reel, carrusel, imagen) | 1 | Épicas E1–E13, completas |
| 2 | TikTok (cross-post del mismo material) | 2 | Solo requisito de arquitectura: `publisher/` debe admitirlo sin tocar el núcleo (CA-2.1) |
| 3 | Correo y WhatsApp a lista de espera y clientes | 2 (correo: parcialmente en fase 1 para lanzamiento) | Lista de espera y correos de lanzamiento **sí** (E0, E14) |
| 4 | Facebook page (espejo) | 2 | Solo requisito de arquitectura |
| 5 | Pauta (anuncios pagados) | Posterior | **Fuera de alcance** |

**La lista de espera y los correos de lanzamiento pertenecen a este módulo** (RESTRICCIÓN DADA, kickoff §Alcance real), aunque la landing se implemente en `frontend/` + `backend/`.

**CA-2.1** — Añadir un canal nuevo (TikTok o Facebook) consiste en añadir un adaptador bajo `publisher/` e implementar su interfaz; no requiere modificar `planner/`, `writer/`, `render/`, `invariants/` ni `approval/`. Verificable: existe un adaptador de prueba (canal ficticio `dummy`) que publica una pieza de extremo a extremo sin cambios en esos directorios.
**CA-2.2** — Toda pieza generada declara su canal destino; una pieza puede tener más de un destino (p. ej. IG + TikTok) sin duplicar borrador ni doble aprobación (SUPUESTO: una sola aprobación cubre todos los destinos de la misma pieza).

### 2.2 Otros límites del alcance

- El módulo tiene **acceso de solo lectura** al backend de la plataforma: precios, stock, fotos y metadata de intake. **Nunca escribe** en la base de datos de la plataforma (RESTRICCIÓN DADA, kickoff §Decisiones). Sus propios datos (borradores, métricas, cola, tokens) viven en su propio almacenamiento; el arquitecto decide dónde.
- El runtime es un **servicio programado (cron)** que invoca a Claude por API en cada ciclo; Claude Code lo construye, no lo opera (RESTRICCIÓN DADA).
- Publica en Instagram **únicamente vía API oficial** (RESTRICCIÓN DADA).

---

## 3. Fuera de alcance — fase 1 (explícito)

| Fuera de alcance | Motivo | Consecuencia verificable |
|---|---|---|
| **Mensajes directos (DM)** | `instagram_business_manage_messages` está concedido pero **no se usa en fase 1** (RESTRICCIÓN DADA, kickoff §Estado actual) | **CA-3.1** — El código no invoca ningún endpoint de mensajería de Instagram. Verificable por prueba automática que falla si aparece una llamada a rutas de `messages`/`conversations`, y por revisión de `security`. |
| **Historias (Stories)** | La API no permite publicarlas (brief §4) | **CA-3.2** — El agente no publica historias. Solo **sugiere 2 por día** listas para que JC las suba a mano (E12). |
| **Likes, follows, comentarios masivos y cualquier automatización de engagement** | MKT-6 (brief §6) y RESTRICCIÓN DADA del kickoff | **CA-3.3** — El agente solo publica y responde **en el perfil propio**. Ninguna acción sale hacia perfiles de terceros. Prueba: §9, MKT-6. |
| **Pauta / anuncios pagados** | No está en fase 1 (kickoff §Alcance real) | **CA-3.4** — No existen credenciales ni código de Marketing API de anuncios en el módulo. |
| **Webhooks de Instagram** | Requieren app publicada; en modo desarrollo se lee por **polling** (RESTRICCIÓN DADA, kickoff §Estado actual) | **CA-3.5** — El ciclo de comentarios funciona íntegramente por polling; el diseño deja el punto de entrada para webhooks pero no depende de ellos. |
| **Publicación en TikTok, Facebook y WhatsApp** | Fase 2 | Solo se exige la extensibilidad de CA-2.1. |
| **Slack** | El kickoff **corrige** el brief §8: no se usa Slack (ver §11) | **CA-3.6** — No hay integración con Slack en el módulo. |

---

## 4. Usuarios y roles

| Actor | Quién es | Qué hace en el módulo |
|---|---|---|
| **JC (dirección)** | Dueño del negocio. Rol en la plataforma: `super_admin` | Aprueba/edita/descarta borradores, resuelve escalaciones, aprueba colaboraciones y UGC, selecciona la voz una vez, recibe el reporte semanal |
| **Operador de bóveda** | Rol `vault_operator` | (SUPUESTO) Acceso **solo lectura** a `/admin/marketing`: ve la cola y el calendario, no aprueba ni descarta |
| **Cliente / seguidor** | Público en Instagram; visitante de la landing | Comenta, se apunta a la lista de espera, hace clic en los links con UTM |
| **Agente** | El servicio programado | Genera, verifica contra invariantes, publica lo aprobado, responde comentarios de bajo riesgo, escala, mide, reporta |
| **Dirección de marketing (Claude en claude.ai)** | Sesión externa vía conector MCP | Lee reporte, borradores, escalaciones y métricas; aprueba/rechaza borradores y actualiza secciones del brief (E13) |

**CA-4.1** — Solo un usuario con rol `super_admin` puede aprobar, editar o descartar un borrador y resolver una escalación. Un `vault_operator` autenticado recibe 403 en esas acciones y 200 en las de lectura. Un `customer` recibe 403 en toda la superficie de `/admin/marketing`.
**CA-4.2** — Toda acción que cambia el estado de una pieza o de una escalación queda registrada con actor, rol, acción, antes/después y marca de tiempo (patrón de auditoría ya existente en la plataforma).

---

## 5. Restricciones y preferencias técnicas (dadas, no decididas aquí)

Registradas como **dato de entrada** para el arquitecto:

1. Vive en este repo como servicio independiente con su propio `CLAUDE.md`. El kickoff dice `apps/marketing-agent/`; **este repo no tiene layout `apps/`** (tiene `backend/` y `frontend/`). La ubicación final la decide el arquitecto. *(Ver pregunta abierta P-1.)*
2. Cuenta @tcghunt.mx Business, ligada a la página de Facebook "TCG HUNT". App de Meta "TCG HUNT" en **modo desarrollo**, ruta *Instagram API con Instagram Login*, cuenta agregada como Instagram Tester.
3. Permisos: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_insights`. `instagram_business_manage_messages` concedido pero **no se usa**. Página: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`.
4. Variables de entorno: `IG_APP_ID`, `IG_APP_SECRET`, `IG_USER_ID`, `IG_ACCESS_TOKEN` (larga duración, 60 días, con refresco automático antes de expirar). **Verificado: aún no existen en `.env.example`**; devops debe añadirlas.
5. App review de Meta: pendiente; se envía cuando el pipeline funcione. Hasta entonces todo opera en modo desarrollo sobre la cuenta propia, suficiente para fase 1.
6. Programación: `produce` 3×/día (mañana, mediodía, noche); `engage` (comentarios) cada 2 h según brief §11 — **ver §12, esta cadencia entra en conflicto con la ventana de respuesta**; `measure` diario + semanal.
7. Búsqueda web restringida a la lista blanca del brief §5.
8. Render: plantillas HTML → PNG (Playwright/Puppeteer); video con ffmpeg (fotos + zoom + texto + VO).
9. TTS: proveedor por decidir, **voz fija en español de México**, interfaz diseñada para poder cambiar de proveedor.
10. Cola de aprobación en la plataforma: `/admin/marketing`. En este repo eso significa una ruta nueva bajo `frontend/src/app/[locale]/(admin)/admin/`, reutilizando auth y layout de admin existentes.
11. Notificaciones por correo transaccional desde `marketing@tcghunt.mx` al correo de JC. **Existe ya** el módulo `backend/src/modules/mail/` con puerto, adaptador Resend y adaptador noop (`RESEND_API_KEY`, `MAIL_FROM` documentadas). El remitente actual es `no-reply@tcghunt.mx`; se necesita una segunda identidad de remitente en el mismo dominio verificado.
12. Google Drive: carpeta `TCG HUNT/Marketing/` con `Reportes/`, `Calendario/`, `Piezas/`, `Brief/`; credencial con permiso limitado a esa carpeta; nombres con fecha ISO al inicio.
13. Servidor MCP autenticado (OAuth) expuesto por la plataforma, registrado en claude.ai como conector personalizado.
14. Los invariantes MKT-1..MKT-8 tienen el mismo estatus que SEC-A1: **pruebas automáticas que bloquean la publicación**.
15. La autonomía se controla por configuración (`autonomy.yaml` por serie), **no por código**.
16. Locales de la plataforma: `es` y `en` (`frontend/messages/es.json`, `en.json`).
17. BullMQ ya está en las dependencias del backend (dato para el arquitecto sobre jobs programados).
18. Precedente de la plataforma reutilizable para la landing: `POST /catalog/sealed/restock-subscriptions` (público, `@Throttle 5/min`, respuesta neutra 202, validación de correo, feature flag por `ConfigSetting`).

---

## 6. Modelo conceptual

### 6.1 Serie

Unidad de contenido recurrente del brief §4. Cada serie tiene: `key` estable, pilar del ciclo, formato, frecuencia objetivo, CTA, nivel de autonomía (`autonomy.yaml`) y plantilla de prompt.

**Claves canónicas de serie** (se usan tal cual como `utm_campaign`):

| `key` | Serie | Pilar | Formato | Frecuencia | CTA |
|---|---|---|---|---|---|
| `cayo_en_la_boveda` | Cayó en la bóveda | Cazar | Reel | 2/sem | Catálogo |
| `grado_o_no_grado` | Grado o no grado | Cazar | Reel | 1 c/2 sem | Gradeadas |
| `sellado_que_guardar` | Sellado: qué guardar | Cazar | Carrusel/reel | 1 c/2 sem | Sellado |
| `te_falta_esta` | Te falta esta | Completar | Carrusel | 1/sem | Catálogo filtrado por set |
| `proximos_releases` | Próximos releases | Completar | Tarjeta | Según calendario | Sellado/preventa |
| `boveda_abierta` | Bóveda abierta | Guardar | Reel | 1 c/2 sem | Crear cuenta |
| `precio_real_mexico` | Precio real en México | Guardar | Carrusel | 1/sem | Catálogo |
| `cuanto_vale_tu_carpeta` | ¿Cuánto vale tu carpeta? | Vender | Reel + comentarios | 1–2/sem | Cotizador |
| `repetidas_a_dinero` | Repetidas → dinero | Vender | Reel/carrusel | 1 c/2 sem | Cotizador |
| `mercado_60s` | Mercado en 60 s | Transversal | Reel | 1/sem (lunes) | Seguir |
| `dato_de_caza` | Dato de caza | Transversal | Tarjeta | 1/sem | Seguir |
| `meme_de_marca` | Meme de marca | Transversal | Imagen | 1/sem | Compartir |
| `coleccion_comunidad` | Colección de la comunidad (UGC) | Transversal | Repost | Cuando haya | Cotizador/catálogo |

**CA-6.1** — Las 13 claves anteriores existen en la configuración del módulo. Una pieza no puede crearse sin una `key` de esta lista; añadir una serie nueva es un cambio de configuración, no de código.

### 6.2 Pieza (unidad de contenido)

Una pieza tiene, como mínimo: `key` de serie, canal(es) destino, formato, **superficies de texto**, activos renderizados, fuentes citadas, UTM, estado y fecha/hora programada.

**Superficies de texto** (todas sujetas a los invariantes §9): `copy` (caption), `hashtags`, `guion_vo`, `texto_en_pantalla` (overlays del render, incluidos los textos por slide de un carrusel), `alt_text`, y —en el flujo de comentarios— `respuesta_propuesta`.

**CA-6.2** — El motor de invariantes se aplica a **todas** las superficies de texto de la pieza, no solo al `copy`. Prueba: una violación introducida únicamente en `texto_en_pantalla` de la slide 4 de un carrusel bloquea la pieza igual que si estuviera en el `copy` (TC-MKT8-03).

---

## 7. Épicas e historias de usuario

Las épicas están ordenadas por dependencia, no por prioridad de sprint. El orden de sprints lo fija el techlead (kickoff §5.4): sprint 0 = landing; sprint 1 = publisher + token; sprint 2 = planner→writer→render→approval; sprint 3 = comments + insights + reporte + MCP.

---

### E0 · Lista de espera (sprint 0 — prioridad inmediata)

Spec detallado en **§13**. Aquí solo la historia raíz.

> **H-0.1** Como coleccionista que ve el Instagram antes del lanzamiento, quiero dejar mi correo o WhatsApp en un solo campo para que me avisen primero cuando abra la plataforma.

---

### E1 · Publicación en Instagram (`publisher/instagram`)

> **H-1.1** Como agente, quiero publicar una pieza aprobada en @tcghunt.mx vía API oficial para que el contenido salga sin intervención manual.

**CA-1.1.1** — Solo se publican piezas en estado `aprobado`. Un intento de publicar una pieza en cualquier otro estado falla y queda registrado (no se publica).
**CA-1.1.2** — Antes de cada publicación se ejecuta la batería completa de invariantes MKT-1..MKT-8 sobre el estado **final** de la pieza. Si alguno falla, no se publica y la pieza pasa a `escalado` (§9).
**CA-1.1.3** — Soporta los tres formatos de fase 1: **reel** (video), **carrusel** (2–10 imágenes) e **imagen única**.
**CA-1.1.4** — Todo link publicado lleva UTM `utm_source=instagram&utm_medium=organic&utm_campaign=<key de serie>` (brief §11). Una pieza con un link sin UTM válido no se publica.
**CA-1.1.5** — Publicación **idempotente**: reintentar el mismo ciclo tras un fallo de red no crea una segunda publicación. Prueba: simular timeout después de que Instagram acepta la publicación; el reintento detecta el ID ya publicado y no duplica.
**CA-1.1.6** — Tras publicar, la pieza pasa a `publicado` y guarda el ID del post de Instagram y la URL permanente.
**CA-1.1.7** — La pieza se publica en la ventana programada; si no se publica dentro de los 120 min siguientes a su hora programada (SUPUESTO del margen), pasa a `escalado` y se notifica a JC.

> **H-1.2** Como operador, quiero que el token de Instagram se refresque solo para que el pipeline no se caiga a los 60 días.

**CA-1.2.1** — El servicio refresca `IG_ACCESS_TOKEN` automáticamente antes de expirar. (SUPUESTO: umbral de refresco = quedan ≤7 días de vigencia; el mecanismo y el almacenamiento los define el arquitecto/`security`.)
**CA-1.2.2** — Si el refresco falla o la API devuelve token inválido/expirado, se genera una **escalación tipo `Escalación`** con notificación por correo en ≤15 min (brief §8.6) y se suspende la publicación hasta resolverla.
**CA-1.2.3** — El token nunca aparece en logs, en el reporte, en el correo, en la interfaz de admin ni en respuestas del servidor MCP. Prueba automática: grep de la cadena del token en toda salida capturada del ciclo → 0 coincidencias.
**CA-1.2.4** — El estado del token (vigente / por expirar / expirado, con fecha) es visible en `/admin/marketing`.

---

### E2 · Fuentes de lista blanca (`sources/`) — cimiento de MKT-1 y MKT-2

> **H-2.1** Como agente, quiero obtener cada dato de una fuente de lista blanca con su URL y fecha para poder publicarlo sin escalar.

**CA-2.1.1** — Existe un fetcher por fuente de la lista blanca del brief §5, agrupadas en: oficiales (pokemon.com, pokemon.com/es, Pokémon Center, canales oficiales de TPCi), noticias TCG (PokeBeach, Pokéguardian, PokémonCard.io, Bulbapedia), mercado (TCGplayer *sold*, eBay *sold listings*, PriceCharting, PWCC, Goldin, Heritage), grading (PSA pop report y verificación de certificado, CGC), y **México: solo el backend de TCG HUNT**.
**CA-2.1.2** — Cada fetcher devuelve, por dato: `valor`, `url`, `fecha_de_obtención`, `fuente_id`. Un dato sin los cuatro campos es inválido.
**CA-2.1.3** — Una consulta a un dominio fuera de la lista blanca es rechazada por el propio módulo (no depende de que el modelo "se acuerde"). Prueba: solicitar un dato de un dominio no listado → error y pieza escalada, nunca publicada.
**CA-2.1.4** — Rumores, filtraciones e "insiders" nunca se publican como hecho, aunque provengan de un dominio de lista blanca: una pieza cuya fuente esté marcada como rumor/filtración se escala (brief §5).
**CA-2.1.5** — Las cifras marcadas `[verificar]` en las plantillas de contenido (`semana_1_tcghunt.md`) solo pueden resolverse desde una fuente de lista blanca en el mismo ciclo de producción; si no se resuelven, la pieza no sale (regla explícita de `semana_1_tcghunt.md`).

> **H-2.2** Como agente, quiero leer precio y stock del backend de TCG HUNT en el momento para no afirmar de memoria.

**CA-2.2.1** — Precio y disponibilidad **solo** provienen de una lectura al backend hecha dentro del mismo ciclo de publicación o respuesta. Una cifra de precio/stock con antigüedad mayor a la ventana del ciclo se considera caducada y bloquea (SUPUESTO: ventana = 60 min).
**CA-2.2.2** — El acceso al backend es de **solo lectura** y con credencial propia del módulo. Prueba: la credencial del módulo recibe error de permisos en cualquier operación de escritura (verificado por `security`).

---

### E3 · Planner: calendario y mix semanal

> **H-3.1** Como JC, quiero que el agente decida qué producir cada día respetando el mix del brief para que ninguna semana se cargue a un solo lado del negocio.

**CA-3.1.1** — El planner produce un plan semanal de **7–8 piezas**: 3–4 reels, 2 carruseles, 1–2 tarjetas/imágenes (brief §4).
**CA-3.1.2** — Cada semana toca **los cuatro pilares** (Cazar, Completar, Guardar, Vender). Un plan que deje un pilar en cero es rechazado por el propio planner y se escala.
**CA-3.1.3** — El planner respeta la frecuencia declarada de cada serie (tabla §6.1), incluidas las quincenales (`1 c/2 sem`): verificable comparando el plan contra el historial de las 2 semanas previas.
**CA-3.1.4** — `mercado_60s` se programa en **lunes** (brief §4).
**CA-3.1.5** — Si dos semanas consecutivas el reparto de piezas por pilar es ≥50 % en un solo pilar, el planner emite la alerta **"mix cargado a un lado"** en el reporte semanal y propone corrección (brief §4).
**CA-3.1.6** — El plan considera insights: una serie que quede en el **bottom 3 dos semanas seguidas se pausa** y se sustituye; una serie ganadora **se duplica antes de inventar una nueva** (brief §9). Verificable con historial simulado de 2 semanas.
**CA-3.1.7** — El plan de la semana siguiente se propone en el reporte del domingo; **JC aprueba en un clic o lo ignora y se aplica en 24 h** (brief §9).
**CA-3.1.8** — El plan es visible y editable en `/admin/marketing` (vista de calendario) antes de que se produzcan las piezas.

---

### E4 · Writer: copy, hashtags y guion de voz en off

> **H-4.1** Como agente, quiero redactar copy, hashtags y guion de VO con el tono del brief para que la marca suene igual siempre.

**CA-4.1.1** — El **guion de VO tiene ≤90 palabras** (brief §3). 91 palabras bloquean la pieza. Casos borde de conteo: números y cifras cuentan como una palabra; `$1,250 MXN` = 2 palabras. (SUPUESTO de la regla de conteo.)
**CA-4.1.2** — La **primera frase del guion es el gancho, sin saludo** (brief §3). Un guion que empiece por "Hola", "Qué tal", "Bienvenidos" o equivalente es rechazado.
**CA-4.1.3** — Prohibiciones de tono (brief §3) verificables automáticamente: (a) máximo 2 emojis por pieza y nunca 2 seguidos (SUPUESTO del límite); (b) ninguna palabra en MAYÚSCULAS completas de más de 3 letras salvo siglas de lista blanca (`PSA`, `CGC`, `MXN`, `USD`, `ETB`, `TCG`, `IVA`, `CP`, `SAT`, `UGC`); (c) ningún signo de exclamación repetido (`!!`).
**CA-4.1.4** — La bóveda **no** se menciona en todas las piezas: como máximo el 50 % de las piezas de una semana menciona explícitamente la bóveda en el copy o el guion (brief §3, "se muestra, no se predica"). (SUPUESTO del umbral 50 %.)
**CA-4.1.5** — No hay promesas de tiempos de envío, precios futuros ni disponibilidad futura (MKT-3, §9).
**CA-4.1.6** — Hashtags: máximo 8, en minúsculas, sin hashtags de competidores ni de tiendas, sin hashtags genéricos de tráfico (`#fyp`, `#viral`, `#followforfollow`), sin hashtags que impliquen precio/oferta (`#barato`, `#oferta`, `#remate`). (SUPUESTO: la lista negra y el máximo requieren confirmación de JC — P-6.)
**CA-4.1.7** — Toda pieza lleva `alt_text` no vacío y descriptivo (SUPUESTO: requisito de accesibilidad que añado; ≤125 caracteres).
**CA-4.1.8** — El copy en español de México; ninguna pieza mezcla idiomas salvo nombres propios de carta/set. (SUPUESTO.)
**CA-4.1.9** — Todo CTA apunta a un destino de la lista de CTAs de la serie (tabla §6.1) con su UTM correcto.

---

### E5 · Render: HTML→PNG y video con ffmpeg

> **H-5.1** Como agente, quiero renderizar la pieza con las plantillas de marca para que todo salga con la misma identidad visual.

**CA-5.1.1** — Existen las 5 plantillas del brief §3: tarjeta de dato, gráfica de precio, carrusel educativo, calendario de releases, badge "En bóveda".
**CA-5.1.2** — Tipografía, paleta y color de acento se toman de tcghunt.mx (fondos oscuros, tipografía grande, **un solo** color de acento para cifras). El sistema de diseño lo define `ux-ui`; el render lo consume.
**CA-5.1.3** — Los renders cumplen las especificaciones de formato de Instagram: reel vertical 1080×1920, carrusel/imagen 1080×1350 o 1080×1080. Una pieza con dimensiones fuera de spec no se publica. (SUPUESTO: relación de aspecto preferida para carrusel = 4:5.)
**CA-5.1.4** — **Nunca se reproduce arte oficial de Pokémon ni se generan imágenes de cartas o personajes** (MKT-5, §9). Cuando el sujeto es una carta o producto, se usa **foto real** procedente del intake del backend.
**CA-5.1.5** — El video se compone con ffmpeg: fotos + zoom + texto + pista de VO; la duración del reel es coherente con el guion (SUPUESTO: 20–60 s).
**CA-5.1.6** — El render es determinista: mismo insumo → mismo archivo (permite revisión y re-aprobación fiables).
**CA-5.1.7** — El render de cada pieza se sube a Google Drive `TCG HUNT/Marketing/Piezas/` para revisión (E11); un fallo de Drive **no** bloquea la publicación (Drive es espejo, no fuente de verdad).

---

### E6 · TTS: voz fija, proveedor intercambiable

> **H-6.1** Como JC, quiero elegir una voz una sola vez y que nunca cambie sola para que la marca tenga una firma sonora estable.

**CA-6.1.1** — Existe **una sola** voz activa, en español de México, registro neutro-grave, ritmo pausado (brief §3).
**CA-6.1.2** — El identificador de voz es configuración, no código. Cambiarlo requiere aprobación explícita de JC registrada en la cola (SUPUESTO: se registra como una escalación de tipo `Aprobación`).
**CA-6.1.3** — El agente **nunca** cambia de voz por su cuenta. Prueba: si el proveedor devuelve una voz distinta o la voz configurada no existe, el ciclo **falla y escala**; no cae a otra voz por defecto (no hay default inseguro, brief §6).
**CA-6.1.4** — El proveedor de TTS es intercambiable: cambiar de proveedor consiste en implementar la interfaz de `tts/` sin tocar `writer/` ni `render/`. Prueba: existe un adaptador de prueba que devuelve audio silente y el pipeline completa.
**CA-6.1.5** — El audio se cachea por hash del guion + voz: regenerar el mismo guion no vuelve a facturar al proveedor.
**CA-6.1.6** — Toda pieza con VO sintética lleva el etiquetado de MKT-7 (§9).

---

### E7 · Cola de aprobación en `/admin/marketing`

> **H-7.1** Como JC, quiero aprobar el lote del día en ~5 minutos desde la plataforma para no depender de otra herramienta.

**CA-7.1.1** — Existe la ruta `/es/admin/marketing` y `/en/admin/marketing` bajo el grupo `(admin)` de `frontend/src/app/[locale]/`, reutilizando auth y layout de admin existentes.
**CA-7.1.2** — La cola muestra, por borrador: vista previa renderizada (imagen/video reproducible), copy, hashtags, guion de VO con audio reproducible, fuentes con enlace y fecha, serie, canal, hora programada y resultado de invariantes.
**CA-7.1.3** — Tres acciones por borrador: **Aprobar**, **Editar**, **Descartar**. Descartar exige motivo (campo obligatorio, ≥1 opción de una lista + texto libre opcional).
**CA-7.1.4** — Aprobación en lote: seleccionar N borradores y aprobar de una vez. **Aprobar en lote no salta invariantes**: se reevalúan al publicar (CA-1.1.2).
**CA-7.1.5** — Editar una pieza la devuelve a `borrador` como **versión nueva**, conserva la versión anterior y **vuelve a exigir aprobación**. Prueba: editar una pieza aprobada la desaprueba.
**CA-7.1.6** — La cola incluye una pestaña de **escalaciones** con la respuesta propuesta, el comentario original, el motivo de escalación y las acciones Aprobar respuesta / Editar y responder / No responder / Ocultar.
**CA-7.1.7** — Un borrador con invariante en rojo se muestra con el invariante concreto que falló (`MKT-8`) y el fragmento de texto señalado, y **no se puede aprobar** hasta corregirlo (el botón Aprobar está deshabilitado y el backend devuelve 409 si se fuerza).
**CA-7.1.8** — La cola es usable en móvil (JC aprueba desde el teléfono). (SUPUESTO: requisito que añado; confirmar prioridad — P-9.)
**CA-7.1.9** — Ambos locales (`es`, `en`) tienen todas las cadenas traducidas; la paridad de claves `es.json`/`en.json` se verifica con la prueba de paridad ya existente en el frontend.

---

### E8 · Notificaciones por correo a JC

> **H-8.1** Como JC, quiero recibir por correo lo que necesita mi decisión para no tener que entrar a mirar.

**CA-8.1.1** — Tres tipos de correo, todos con asunto que empieza por el prefijo fijo `[TCG HUNT Marketing]` seguido de la etiqueta: `Aprobación`, `Escalación`, `Reporte` (kickoff).
  Formato exacto: `[TCG HUNT Marketing] Aprobación · N borradores esperan aprobación · 2026-09-14`.
**CA-8.1.2** — Remitente `marketing@tcghunt.mx`. Requiere que el dominio siga verificado en Resend; si no, el envío falla (dependencia de devops).
**CA-8.1.3** — Todo correo incluye un enlace directo a la cola en `/admin/marketing` (y al elemento concreto cuando aplica).
**CA-8.1.4** — Correo de **Aprobación**: uno por lote, no uno por borrador. (SUPUESTO: se envía tras el ciclo `produce` de la mañana y agrupa todos los borradores pendientes.)
**CA-8.1.5** — Correo de **Escalación**: se envía dentro de **15 minutos** desde que el agente clasifica el evento como escalación (§12).
**CA-8.1.6** — Correo de **Reporte**: domingo, con el formato fijo de E10.
**CA-8.1.7** — Ningún correo contiene tokens, credenciales ni datos personales de clientes de la plataforma. Los correos de la lista de espera nunca se incluyen en el cuerpo de un reporte (solo agregados).
**CA-8.1.8** — Los correos se envían por el módulo `mail` existente (puerto + adaptador). En entorno local, con el adaptador noop, el pipeline completa y registra el envío simulado.

---

### E9 · Comentarios: lectura, clasificación, respuesta y ocultación

> **H-9.1** Como agente, quiero leer los comentarios por polling y clasificarlos según la matriz del brief §7 para responder lo de bajo riesgo y escalar lo demás.

**CA-9.1.1** — Los comentarios se leen por **polling** (no webhooks) sobre las publicaciones propias.
**CA-9.1.2** — Cada comentario recibe exactamente una clasificación de la matriz (§10) más un nivel de confianza. **Confianza baja ⇒ se trata como ambiguo ⇒ escala** (MKT-4). (SUPUESTO: umbral de confianza y su calibración los define el arquitecto; el comportamiento observable es el de MKT-4.)
**CA-9.1.3** — Un comentario que combine dos tipos se resuelve por **el de mayor riesgo** (regla de precedencia: escalar > ocultar > responder > like).
**CA-9.1.4** — El agente responde **solo en el perfil propio**, solo a comentarios en publicaciones propias, y nunca hace like/follow ni comenta en perfiles ajenos (MKT-6).
**CA-9.1.5** — En **fase 1** ninguna respuesta se publica sin aprobación de JC en la cola; en fases posteriores, solo los tipos habilitados en `autonomy.yaml` se publican solos, y **cualquier fallo de invariante fuerza escalación sea cual sea el nivel de autonomía**.
**CA-9.1.6** — Cada comentario procesado queda registrado con: texto original, clasificación, confianza, acción tomada, respuesta publicada (si la hubo), quién la aprobó y marcas de tiempo (recepción, clasificación, respuesta).
**CA-9.1.7** — Un mismo comentario no se responde dos veces aunque aparezca en varios ciclos de polling (idempotencia por ID de comentario).
**CA-9.1.8** — El agente no responde a comentarios de la propia cuenta.
**CA-9.1.9** — Ocultar spam es reversible desde `/admin/marketing` y queda auditado.

Casos de prueba de la matriz completa: **§10**.

---

### E10 · Insights, atribución UTM y reporte semanal

> **H-10.1** Como JC, quiero saber cada semana qué contenido produjo cotizaciones y cuentas, no solo alcance.

**CA-10.1.1** — Diariamente el agente lee insights de las últimas 48 h y marca ganadores y perdedores por serie (brief §9).
**CA-10.1.2** — Se capturan, por publicación: alcance, impresiones, guardados, compartidos, comentarios, likes y seguidores nuevos atribuibles al día. (SUPUESTO: la lista exacta depende de las métricas disponibles en la API de Insights para cuentas Business; el arquitecto confirma.)
**CA-10.1.3** — **Atribución:** el módulo cruza los UTM de sus links con los eventos de negocio del backend (cotización iniciada, lista de buylist enviada, cuenta creada, primera compra) por `utm_campaign` = `key` de serie.
**CA-10.1.4** — **Dependencia bloqueante:** hoy la plataforma **no** persiste atribución UTM (verificado: no hay ninguna referencia a `utm_source`/`utm_campaign` en `backend/` ni `frontend/`). Para que CA-10.1.3 sea posible, la plataforma debe capturar y persistir el **primer toque** (`utm_source`, `utm_medium`, `utm_campaign`) y asociarlo al alta de cuenta, a la solicitud de venta (buylist) y al primer pedido. Ese trabajo es de `backend`/`frontend`, **no** del agente (el agente es de solo lectura). *(Ver P-4.)*
**CA-10.1.5** — El reporte semanal se genera los **domingos**, con **formato fijo, mismas secciones y mismo orden cada semana** (kickoff):
  1. Resumen en 5 líneas
  2. Métricas por serie
  3. Cotizaciones y cuentas atribuidas por UTM
  4. Top 3 y bottom 3 con hipótesis
  5. Mix propuesto para la semana siguiente
  6. Incidentes de invariantes
**CA-10.1.6** — El reporte se **guarda en la base de datos del módulo**, se **envía por correo** y se **escribe en Google Drive** (los tres, kickoff). Si uno de los tres destinos falla, el reporte no se pierde: se reintenta y se registra el fallo; el fallo de Drive o de correo no impide guardar en BD.
**CA-10.1.7** — Escalación automática si el engagement cae **>40 % semana contra semana**, con hipótesis incluida (brief §8.5).
**CA-10.1.8** — Cada afirmación numérica del reporte es trazable a su origen (Insights, backend o registro propio); el reporte no contiene cifras estimadas sin marcarlas como tales.

---

### E11 · Google Drive

> **H-11.1** Como dirección de marketing (Claude en claude.ai), quiero leer reportes, calendario, piezas y brief en Drive con nombres estables para poder trabajar por conector.

**CA-11.1.1** — Estructura exacta: `TCG HUNT/Marketing/` con `Reportes/`, `Calendario/`, `Piezas/`, `Brief/`.
**CA-11.1.2** — Nombres de archivo con **fecha ISO al inicio**: `2026-09-14_reporte_semanal.md`. (SUPUESTO de convención para los demás: `2026-09-14_calendario_semanal.md`, `2026-09-14_<key_serie>_<n>.png|mp4`, `brief_instagram_tcghunt.md` en `Brief/` sin fecha por ser copia viva.)
**CA-11.1.3** — La credencial de Google tiene permiso limitado **exclusivamente** a esa carpeta. Prueba de `security`: la credencial recibe error al listar o escribir fuera de `TCG HUNT/Marketing/`.
**CA-11.1.4** — La escritura es idempotente: reejecutar el mismo día no crea duplicados con nombre alterado.
**CA-11.1.5** — Drive es **espejo, no fuente de verdad**: su indisponibilidad no bloquea producción, aprobación ni publicación.

---

### E12 · Sugerencias de historias (2 por día)

> **H-12.1** Como JC, quiero recibir 2 historias listas para subir cada día, porque la API no me deja automatizarlas.

**CA-12.1.1** — Cada día se generan exactamente **2 sugerencias de historia** (brief §4), disponibles en `/admin/marketing` y enlazadas desde el correo de aprobación.
**CA-12.1.2** — Cada sugerencia incluye el activo descargable listo para subir (SUPUESTO: 1080×1920, PNG o MP4) y el texto sugerido.
**CA-12.1.3** — Las sugerencias de historia pasan por los mismos invariantes que cualquier pieza.
**CA-12.1.4** — El agente **no** publica historias por ningún medio.

---

### E13 · Servidor MCP (sprint 3)

> **H-13.1** Como dirección de marketing en claude.ai, quiero leer y actuar sobre la cola desde un conector autenticado.

**CA-13.1.1** — La plataforma expone un servidor MCP autenticado por **OAuth** con las herramientas del kickoff: lectura `get_weekly_report`, `list_drafts`, `list_escalations`, `get_series_metrics`; acción `approve_draft`, `reject_draft`, `update_brief_section`.
**CA-13.1.2** — Las herramientas de acción exigen un alcance de token distinto al de lectura; un token de solo lectura recibe error al invocarlas.
**CA-13.1.3** — **Cada invocación de herramienta de acción se audita** (actor, herramienta, argumentos, antes/después, marca de tiempo). `security` define alcance de tokens y auditoría (RESTRICCIÓN DADA).
**CA-13.1.4** — `approve_draft` vía MCP está sujeto exactamente a las mismas reglas que la aprobación en la interfaz: no puede aprobar un borrador con invariante en rojo (409).
**CA-13.1.5** — Ninguna herramienta de lectura expone datos personales de clientes de la plataforma ni correos/teléfonos de la lista de espera; devuelven agregados.
**CA-13.1.6** — Los tokens del conector se pueden revocar y la revocación surte efecto inmediato.
**CA-13.1.7** — `update_brief_section` no puede modificar los invariantes MKT ni la lista blanca de fuentes. Prueba: intentar reescribir la sección de invariantes → rechazado. *(SUPUESTO: propongo esta restricción; sin ella, la dirección de marketing podría desactivar por texto las reglas que protegen el negocio — ver P-8.)*

---

### E14 · Correos de lanzamiento a la lista de espera

> **H-14.1** Como JC, quiero avisar a la lista de espera el día 1 antes que a nadie, porque es lo que convierte tres semanas de contenido en ventas del primer día.

**CA-14.1.1** — Existe una campaña de lanzamiento programable a la lista de espera, con envío a las **09:00 del día 1, antes del primer post** (`prelanzamiento_tcghunt.md`).
**CA-14.1.2** — Los links del correo llevan `utm_source=waitlist&utm_medium=email&utm_campaign=launch` (SUPUESTO de nomenclatura).
**CA-14.1.3** — El envío es idempotente por destinatario: reejecutar la campaña no reenvía a quien ya recibió.
**CA-14.1.4** — Solo se envía a altas con consentimiento vigente y sin baja registrada.
**CA-14.1.5** — Todo correo de campaña lleva enlace de baja de un clic que funciona sin sesión.
**CA-14.1.6** — El contenido del correo respeta los invariantes MKT (en particular MKT-3 y MKT-8): nada de "precios de lanzamiento" ni comparaciones de oferta contra mercado (`prelanzamiento_tcghunt.md`: *"Nunca 'precios de lanzamiento' en cartas: rompe el posicionamiento desde el día 1"*).
**CA-14.1.7** — El incentivo de lanzamiento es **decisión pendiente de JC** (`prelanzamiento_tcghunt.md`); el sistema debe permitir configurarlo sin cambio de código. *(Ver P-3.)*
**CA-14.1.8** — El envío por **WhatsApp** es fase 2; si no está disponible el día 1, las altas con WhatsApp se exportan para envío manual y quedan marcadas como "no notificadas por sistema". *(Ver P-2.)*

---

### E15 · Autonomía por configuración (`autonomy.yaml`)

Detalle en §14.

---

## 8. Estados del contenido

```
                      ┌──────────── editar (JC) ────────────┐
                      ▼                                     │
   [ generado ] → borrador ──aprobar (JC)──→ aprobado ──publicar (agente)──→ publicado ──insights──→ medido
                     │  ▲                        │
        descartar (JC)│  │resolver (JC)          │ invariante en rojo / ventana vencida
                     ▼  │                        ▼
                descartado ◄──descartar (JC)── escalado
```

| Estado | Significado | Quién puede llevarlo a este estado | Notas |
|---|---|---|---|
| `borrador` | Pieza generada, pendiente de decisión | Agente (crear); JC (al editar una pieza aprobada, crea versión nueva) | Editable |
| `escalado` | Bloqueada: falló un invariante, falta fuente, o venció su ventana de publicación | Agente (automático) | **No publicable** bajo ninguna circunstancia hasta que JC la resuelva |
| `aprobado` | Autorizada para publicarse en su ventana | JC (`super_admin`) manualmente; el agente **solo** si la serie tiene autonomía habilitada en `autonomy.yaml` **y** todos los invariantes están en verde | Editarla la devuelve a `borrador` |
| `publicado` | Publicada en el canal, con ID y URL permanente | Agente exclusivamente | JC no publica desde el módulo |
| `medido` | Tiene al menos un snapshot de insights | Agente exclusivamente | (SUPUESTO: se alcanza con el primer snapshot ≥24 h después de publicar) |
| `descartado` | Terminal, no se publica | JC (`super_admin`), con **motivo obligatorio** | Se conserva; alimenta el loop de aprendizaje |

**CA-8.1** — Las transiciones no listadas son imposibles: intentar `borrador → publicado` o `escalado → publicado` devuelve error y queda auditado.
**CA-8.2** — **Rechazo (descartar):** exige motivo; el motivo se agrega al reporte semanal (sección de incidentes/aprendizaje) y el planner lo usa para no repetir el mismo error de serie la semana siguiente.
**CA-8.3** — **Rechazo (editar):** conserva la versión anterior, crea versión nueva en `borrador` y **reejecuta los invariantes** sobre la versión editada. Una edición humana no salta los invariantes. Prueba: JC edita el copy e introduce "pagamos más" → la pieza no puede aprobarse (TC-MKT8-05).
**CA-8.4** — Una pieza `escalado` solo sale de ese estado por acción de JC (corregir → `borrador`, o `descartado`). El agente nunca desescala solo.
**CA-8.5** — Cada transición registra actor, rol, marca de tiempo y motivo cuando aplique.

---

## 9. Invariantes MKT-1..MKT-8 como criterios verificables

**Estatus (RESTRICCIÓN DADA):** los invariantes tienen el mismo rango que SEC-A1. Son **pruebas automáticas que bloquean la publicación**. No hay defaults inseguros: ante duda, se bloquea y se escala.

**Reglas transversales**
- **CA-9.0.1** — Los invariantes se evalúan sobre **todas** las superficies de texto (§6.2) y sobre las respuestas a comentarios.
- **CA-9.0.2** — Se evalúan **dos veces**: al generar (para escalar temprano) y **justo antes de publicar** sobre el estado final (CA-1.1.2).
- **CA-9.0.3** — El nivel de autonomía de `autonomy.yaml` **no puede** saltarse un invariante. En fase 3, un invariante en rojo sigue bloqueando y escalando.
- **CA-9.0.4** — Cada bloqueo registra: invariante, superficie, fragmento exacto señalado y pieza; y aparece en la sección "Incidentes de invariantes" del reporte semanal.
- **CA-9.0.5** — La suite de invariantes corre en CI y **cada sprint termina con los invariantes en verde** (kickoff §5.4).

---

### MKT-1 · Fuente o nada

**(a) Enunciado.** Ningún dato (fecha, precio, cifra, atribución de autoría) sale sin fuente de lista blanca verificada **en el mismo ciclo**. Sin fuente → borrador escalado, no publicado.

**(b) Criterio de aceptación.** Toda afirmación factual de una pieza está asociada a al menos una fuente con `url`, `fuente_id` de lista blanca y `fecha_de_obtención` dentro del ciclo actual. Si falta cualquiera de los tres, la publicación se bloquea y la pieza pasa a `escalado`.

**(c) Casos de prueba.**

| ID | Entrada | Esperado |
|---|---|---|
| **TC-MKT1-01 (pasa)** | Tarjeta `dato_de_caza`: *"El Charizard de Base Set lo ilustró Mitsuhiro Arita."* con fuente Bulbapedia + URL + fecha de hoy | Invariante verde; la pieza puede aprobarse y publicarse |
| **TC-MKT1-02 (bloquea)** | Reel `mercado_60s` cuyo guion contiene *"[Carta 2] bajó 18 % después del reprint"* sin fuente resuelta (marcador `[verificar]` sin llenar) | **Bloqueada.** Estado `escalado`, motivo `MKT-1: cifra sin fuente`, fragmento señalado `bajó 18 %`. Correo de escalación en ≤15 min |
| **TC-MKT1-03 (bloquea)** | Misma pieza que TC-MKT1-01 pero con fuente cuya `fecha_de_obtención` es de hace 9 días para un dato de mercado | **Bloqueada** por fuente caducada (SUPUESTO: los datos de mercado exigen obtención dentro del ciclo; los datos históricos/enciclopédicos no caducan — P-7) |

---

### MKT-2 · Precio y stock solo del backend

**(a) Enunciado.** El agente nunca afirma precio o disponibilidad propios de memoria; los lee del sistema en el momento o remite al link.

**(b) Criterio de aceptación.** Cualquier cifra en MXN presentada como precio de TCG HUNT, o cualquier afirmación de disponibilidad ("tenemos", "quedan N", "está en el catálogo"), debe provenir de una lectura al backend registrada en el mismo ciclo (≤60 min, SUPUESTO). Si no, se bloquea.

**(c) Casos de prueba.**

| ID | Entrada | Esperado |
|---|---|---|
| **TC-MKT2-01 (pasa)** | Slide 6 de `precio_real_mexico`: *"En tcghunt.mx: $2,450 MXN, verificada, en tu bóveda"*, con lectura al backend hecha hace 4 min que devuelve ese precio | Verde; publicable |
| **TC-MKT2-02 (bloquea)** | La misma slide con la cifra `$2,450 MXN` sin lectura registrada (el modelo la recordó de la semana pasada) | **Bloqueada.** `MKT-2: precio propio sin lectura de backend` |
| **TC-MKT2-03 (bloquea)** | Respuesta a comentario: *"Sí, todavía nos quedan 3 de esas."* sin lectura de stock en el ciclo | **Bloqueada**; la respuesta no se publica y se escala |
| **TC-MKT2-04 (pasa)** | Respuesta a comentario: *"Está en el catálogo con su condición verificada, aquí: [link con UTM]"*, sin cifra | Verde: remitir al link es la alternativa permitida |

---

### MKT-3 · Nunca promete

**(a) Enunciado.** Ni tiempos de envío, ni resolución de reclamos, ni condición de una carta no verificada, ni oferta de compra fija en comentarios ("rango según ventas recientes", nunca "te la compramos en X").

**(b) Criterio de aceptación.** Se bloquea cualquier texto que (i) prometa un plazo de entrega o de resolución, (ii) afirme la condición de una carta que no tiene registro de verificación en el backend, o (iii) exprese una oferta de compra concreta. Un rango de mercado con fuente **sí** está permitido; una oferta propia **no**.

**(c) Casos de prueba.**

| ID | Entrada | Esperado |
|---|---|---|
| **TC-MKT3-01 (pasa)** | Respuesta a "¿cuánto cuesta el envío?": *"Los costos se calculan en checkout según tu CP. Aquí el detalle: [link términos]"* (respuesta canónica del brief §7) | Verde; publicable |
| **TC-MKT3-02 (bloquea)** | Copy: *"Te llega en 3 días hábiles a todo México."* | **Bloqueada.** `MKT-3: promesa de tiempo de envío` |
| **TC-MKT3-03 (bloquea)** | Respuesta a comentario: *"Te la compramos en $1,800."* | **Bloqueada.** `MKT-3: oferta de compra fija en comentarios` (y también MKT-8) |
| **TC-MKT3-04 (bloquea)** | Copy sobre una carta sin registro de intake: *"Está en Near Mint, garantizado."* | **Bloqueada.** `MKT-3: condición afirmada sin verificación` |
| **TC-MKT3-05 (pasa)** | *"Según ventas recientes en TCGplayer, entre $900 y $1,400 MXN según condición. Cotízala exacta aquí: [link]"* | Verde: rango de mercado con fuente, sin oferta propia |

---

### MKT-4 · Silencio ante duda

**(a) Enunciado.** Comentario ambiguo, hostil, legal o de queja → **no responde, escala**.

**(b) Criterio de aceptación.** Un comentario clasificado como ambiguo, hostil, legal/fiscal/aduanal, de queja o de comparación con competidor produce **cero** respuestas publicadas y **una** escalación notificada en ≤15 min. Además, confianza de clasificación por debajo del umbral ⇒ tratado como ambiguo.

**(c) Casos de prueba.**

| ID | Entrada | Esperado |
|---|---|---|
| **TC-MKT4-01 (pasa)** | *"¿Y la bóveda cómo funciona? ¿La carta se queda con ustedes?"* — clasificación clara, bajo riesgo | Responde con explicación corta + link; sin escalación |
| **TC-MKT4-02 (bloquea)** | *"Esto huele a estafa, ya vi otro igual que se robó las cartas."* | **No responde.** Escalación tipo hostil/acusación; correo en ≤15 min |
| **TC-MKT4-03 (bloquea)** | *"¿y eso?"* (comentario ambiguo, sin referente) | **No responde.** Escalación tipo ambiguo |
| **TC-MKT4-04 (bloquea)** | *"¿Tengo que declarar esto al SAT si vendo 30 mil pesos de cartas?"* | **No responde.** Escalación tipo legal/fiscal |

---

### MKT-5 · Sin arte ajeno

**(a) Enunciado.** Nunca arte oficial de Pokémon, ni imágenes generadas de cartas o personajes, ni fotos de terceros sin permiso.

**(b) Criterio de aceptación.** Cada activo visual de una pieza declara su procedencia de una de tres categorías permitidas: (1) **foto/video real de intake** del backend de TCG HUNT, (2) **render de plantilla propia** (tipografía, gráfica, fondo de marca), (3) **UGC con permiso registrado** (con evidencia de permiso y aprobación de JC). Un activo sin procedencia declarada, o con procedencia "generada por IA con contenido de carta/personaje", bloquea.

**(c) Casos de prueba.**

| ID | Entrada | Esperado |
|---|---|---|
| **TC-MKT5-01 (pasa)** | Reel `cayo_en_la_boveda` compuesto por video de intake real + overlays de plantilla propia | Verde; publicable |
| **TC-MKT5-02 (bloquea)** | Tarjeta `dato_de_caza` con una ilustración generada de Charizard como fondo | **Bloqueada.** `MKT-5: imagen generada de personaje/carta` |
| **TC-MKT5-03 (bloquea)** | Repost de `coleccion_comunidad` con foto de un seguidor **sin** registro de permiso ni aprobación de JC | **Bloqueada** y escalada (además brief §8.4: UGC siempre requiere aprobación) |
| **TC-MKT5-04 (bloquea)** | Activo sin campo de procedencia | **Bloqueada** (no hay default: ausencia ⇒ bloqueo) |

---

### MKT-6 · Sin automatización de engagement

**(a) Enunciado.** Nunca likes, follows, DMs ni comentarios masivos. Solo publicar y responder en el perfil propio.

**(b) Criterio de aceptación.** El módulo solo emite llamadas de publicación en la cuenta propia, lectura/respuesta/ocultación de comentarios en publicaciones propias, y lectura de insights propios. Cualquier otra llamada saliente hacia la API de Instagram está prohibida y falla en pruebas. Además, tope de respuestas por ciclo para evitar respuesta masiva.

**(c) Casos de prueba.**

| ID | Entrada | Esperado |
|---|---|---|
| **TC-MKT6-01 (pasa)** | Ciclo `engage` que responde 4 comentarios en publicaciones propias | Verde; ejecuta |
| **TC-MKT6-02 (bloquea)** | Intento de dar like a un comentario de un seguidor en la publicación de **otro** perfil | **Bloqueado**: llamada prohibida; el ciclo falla la prueba y no se ejecuta |
| **TC-MKT6-03 (bloquea)** | Intento de enviar un DM (endpoint de mensajería) | **Bloqueado** por CA-3.1: no existe ruta de mensajería en el módulo |
| **TC-MKT6-04 (bloquea)** | Ciclo que intentaría responder 60 comentarios de una vez | **Bloqueado** al superar el tope por ciclo y escalado (SUPUESTO: tope 20 respuestas/ciclo — P-6) |

---

### MKT-7 · Etiquetado honesto

**(a) Enunciado.** El contenido con voz o gráficos sintéticos se etiqueta según la política de Meta.

**(b) Criterio de aceptación.** Toda pieza que contenga VO por TTS o elementos gráficos sintéticos lleva (i) la marca de contenido con IA que ofrezca la API cuando esté disponible, y (ii) mientras no esté disponible, una línea de divulgación fija al final del copy. Una pieza con TTS y sin ninguno de los dos se bloquea. *(SUPUESTO: la API de Content Publishing de Instagram no expone hoy un campo de etiquetado de IA; por eso la divulgación en copy. Texto propuesto: **"Voz en off generada con IA."** — requiere confirmación de JC, P-5.)*

**(c) Casos de prueba.**

| ID | Entrada | Esperado |
|---|---|---|
| **TC-MKT7-01 (pasa)** | Reel con VO por TTS y el copy terminado en *"Voz en off generada con IA."* | Verde; publicable |
| **TC-MKT7-02 (bloquea)** | El mismo reel sin la línea de divulgación y sin campo de etiquetado | **Bloqueado.** `MKT-7: contenido sintético sin etiquetar` |
| **TC-MKT7-03 (pasa)** | Tarjeta tipográfica sin VO ni elementos sintéticos (solo texto y fondo de marca) | Verde sin divulgación: no hay contenido sintético que etiquetar |

---

### MKT-8 · Dos lados, dos promesas — **el más importante para el negocio**

**(a) Enunciado (brief §6 y §2).**
Al **vendedor** se le promete **liquidez y certeza** (cotización clara, pago por transferencia, sin regateo, sin plantones, sin estafas). Al **comprador**, **confianza y conveniencia** (condición verificada, bóveda, un solo envío).
El agente **nunca** dice *"pagamos más"*, *"mejor precio"* ni *"más barato"*, y **nunca compara nuestra oferta de compra contra el precio de mercado**.
**Valor de mercado y oferta de buylist nunca aparecen como equivalentes en una misma pieza.**

**(b) Criterio de aceptación.** Se bloquea si se cumple cualquiera de estas cuatro condiciones:

- **MKT-8.a — Frase prohibida.** Aparece cualquier expresión de la lista negra en cualquier superficie de texto, incluidas variantes con flexión y con palabras intercaladas. Lista base (SUPUESTO en su extensión exacta, P-6): *pagamos más*, *pagamos mejor*, *te pagamos más*, *mejor precio*, *el mejor precio*, *precios más altos*, *más barato*, *lo más barato*, *más económico*, *nadie te paga más*, *te damos más que*, *pagamos por encima*, *precio más alto del mercado*.
- **MKT-8.b — Comparación de nuestra oferta contra el mercado.** Cualquier construcción que ponga la oferta de compra de TCG HUNT en relación de magnitud con un precio de mercado o con la competencia (*"pagamos el X % del mercado"*, *"te damos más que en el grupo"*, *"nuestra oferta contra eBay"*), aunque no use una frase de la lista negra.
- **MKT-8.c — Coexistencia de cifras.** En una misma pieza (incluido el conjunto de slides de un carrusel y el guion de VO) aparecen a la vez **una cifra de valor de mercado** y **una cifra de oferta de buylist**. Está permitido mostrar valor de mercado **solo como referencia** siempre que la oferta de compra no aparezca en la pieza y se remita al cotizador.
- **MKT-8.d — Promesa cruzada.** Se ofrece al vendedor un beneficio del lado comprador o viceversa de forma que sugiera equivalencia entre ambos (p. ej. *"te compramos al precio de mercado"*, *"vende al mismo precio que cuesta comprarla"*).

Consecuencia en los tres casos: **bloqueo**, estado `escalado`, correo de escalación, y registro del fragmento señalado.

**(c) Casos de prueba (mínimo 5 — aquí 9).**

| ID | Superficie | Entrada | Esperado |
|---|---|---|---|
| **TC-MKT8-01 (pasa)** — *el reel del martes de `semana_1_tcghunt.md`* | Guion VO | *"Carpeta de Monterrey, 340 cartas. La mayoría se vende por menos de 50 pesos. Pero aquí hay tres que importan: Umbreon VMAX Alt Art, que en el mercado se mueve entre $9,800 y $12,400 MXN. […] Si quisiera venderlas hoy, sin regatear con nadie y cobrando por transferencia, el cotizador le dice exactamente cuánto. Dos minutos, link en la bio."* — hay **valor de mercado con fuente**, **ninguna oferta de buylist**, y se remite al cotizador | **Verde.** Es exactamente el patrón permitido por la nota MKT-8 de `semana_1_tcghunt.md`: *"el reel muestra valor de mercado como referencia; la oferta de compra solo la da el cotizador"* |
| **TC-MKT8-02 (bloquea)** — *variante prohibida del mismo reel* | Guion VO | Mismo guion, pero añadiendo *"…y nosotros se la pagamos en $8,200, hoy mismo."* | **Bloqueada** por **MKT-8.c** (valor de mercado + oferta de buylist en la misma pieza) y por **MKT-8.b**. Fragmento señalado: `se la pagamos en $8,200`. No se publica |
| **TC-MKT8-03 (bloquea)** — *violación solo en el render* | `texto_en_pantalla`, slide 4 de un carrusel | Copy y guion limpios; la slide 4 dice **"MERCADO $12,400 · TE PAGAMOS $8,200"** | **Bloqueada** por MKT-8.c. Demuestra CA-6.2: el invariante corre sobre las superficies del render, no solo el copy |
| **TC-MKT8-04 (bloquea)** — *frase prohibida en copy* | `copy` | *"Trae tus repetidas. Pagamos más que cualquier grupo de Facebook."* | **Bloqueada** por MKT-8.a (`pagamos más`) y MKT-8.b (comparación con competencia). Fragmento señalado: `Pagamos más que cualquier grupo` |
| **TC-MKT8-05 (bloquea)** — *frase prohibida introducida por edición humana* | `copy` editado por JC | JC edita un borrador aprobado y escribe *"el mejor precio de México"* | **Bloqueada.** La edición devuelve la pieza a `borrador`, reejecuta invariantes y el botón Aprobar queda deshabilitado (CA-8.3, CA-7.1.7). Demuestra que una edición humana no salta el gate |
| **TC-MKT8-06 (bloquea)** — *frase prohibida en guion de VO* | `guion_vo` | *"Aquí las cartas te salen más baratas que importando."* | **Bloqueada** por MKT-8.a (`más barat-`). Nota: el argumento correcto de `precio_real_mexico` es **costo real e riesgo de importar**, no "más barato" |
| **TC-MKT8-07 (bloquea)** — *frase prohibida en respuesta a comentario* | `respuesta_propuesta` | Comentario: *"¿Y por qué te vendería a ti y no en el grupo?"* → respuesta propuesta: *"Porque pagamos mejor y sin regateo."* | **Bloqueada.** La respuesta no se publica. Además el comentario es de **comparación con competidor ⇒ escala** por matriz (§10, C-09) |
| **TC-MKT8-08 (pasa)** — *el argumento correcto al vendedor* | `copy` | *"Cotizas, envías, verificamos, te transferimos. Sin regateo y sin plantones."* | **Verde.** Promete liquidez y certeza, que es lo permitido del lado vendedor |
| **TC-MKT8-09 (pasa)** — *el argumento correcto al comprador* | `copy` | *"Cada carta del catálogo pasó por verificación de condición. Un solo envío desde la bóveda."* | **Verde.** Promete confianza y conveniencia, sin mencionar precio |

**CA-9.8.1** — MKT-8 tiene cobertura de prueba en las **cuatro** superficies: `copy`, `guion_vo`, `texto_en_pantalla` y `respuesta_propuesta`.
**CA-9.8.2** — MKT-8 no puede desactivarse por configuración: `autonomy.yaml` no tiene ninguna clave capaz de saltarlo, y `update_brief_section` del MCP no puede reescribirlo (CA-13.1.7).
**CA-9.8.3** — Todo incidente de MKT-8 aparece nominalmente en el reporte semanal, aunque haya sido corregido antes de publicar.

---

## 10. Matriz de respuesta a comentarios (brief §7) como casos de prueba

**Acciones posibles:** `responder`, `escalar`, `ocultar`, `like`. Precedencia cuando concurren (CA-9.1.3): **escalar > ocultar > responder > like**.

| ID | Tipo (brief §7) | Entrada de ejemplo (español mexicano realista) | Clasificación esperada | Acción esperada | Aserción |
|---|---|---|---|---|---|
| **C-01** | Nombre/foto de carta + "¿cuánto vale?" | *"Oigan, tengo un Charizard Base Set español, medio gastadito de esquinas. ¿Como en cuánto anda?"* | `valuacion_carta` | **Responder** con rango + fuente + link cotizador | La respuesta contiene un rango en MXN, el nombre de la fuente (p. ej. TCGplayer/eBay sold) y un link con `utm_campaign=cuanto_vale_tu_carpeta`. **No** contiene oferta de compra (MKT-8.c). Publicada ≤2 h |
| **C-02** | Cómo funciona bóveda/buylist | *"No entendí lo de la bóveda. ¿Ustedes se quedan mis cartas o cómo?"* | `explicacion_producto` | **Responder** breve + link | Respuesta ≤2 frases + link a la página correspondiente con UTM. Sin cifras. Publicada ≤2 h |
| **C-03** | Elogio, emoji, tag a amigo | *"Está chido el formato 🔥 @carlos mira esto"* | `elogio` | **Responder breve o like** (no siempre) | Si responde, ≤1 frase, sin link, sin CTA. Nunca escala. **No** se etiqueta ni se menciona al tercero taggeado |
| **C-04** | Precio de carta del catálogo | *"¿En cuánto tienen el Umbreon VMAX que salió en el reel?"* | `precio_catalogo` | **Responder** con precio actual leído del backend + link | La respuesta cita una cifra que coincide con la lectura al backend del mismo ciclo (MKT-2) y adjunta link con UTM. Si la lectura falla o el ítem no está listado → **escala**, no improvisa |
| **C-05** | Envío / tiempos / costos | *"¿Cuánto sale el envío a Tijuana y en cuántos días llega?"* | `envio_terminos` | **Responder** remitiendo a términos, **sin cifras ni plazos** | La respuesta es la canónica del brief: *"Los costos se calculan en checkout según tu CP. Aquí el detalle: [link]"*. Aserción negativa: la respuesta no contiene ningún número de días ni de pesos (MKT-3) |
| **C-06** | Queja / reclamo | *"Mandé mi lista hace 5 días y nadie me ha contestado, ¿qué onda?"* | `queja` | **Escalar** | Cero respuestas publicadas por el agente. Escalación creada y correo `[TCG HUNT Marketing] Escalación` en ≤15 min. La respuesta canónica del brief (*"Te escribimos por DM ahora mismo."*) queda **propuesta en la cola** para que JC la apruebe y **JC envía el DM a mano** — el agente no tiene DM en fase 1 (§3). *(Ver P-10.)* |
| **C-07** | Acusación de fraude / hostil | *"Puro fraude, seguro se quedan con las cartas de la gente."* | `hostil` | **Escalar**, no responde | Cero respuestas. Escalación + correo ≤15 min. La publicación no se oculta ni se borra sin decisión de JC |
| **C-08** | Spam / bots / links | *"💰💰 GANA DINERO RÁPIDO 💰💰 entra a bit.ly/xxxx"* | `spam` | **Ocultar** | El comentario queda oculto vía API; queda registrado y es reversible desde `/admin/marketing`. Sin respuesta. Sin escalación |
| **C-09** | Competidor / comparación | *"¿Y por qué contigo y no con [tienda X] que ya conozco?"* | `comparacion_competidor` | **Escalar** | Cero respuestas. Escalación + correo ≤15 min. Ninguna respuesta borrador puede contener comparación (MKT-8.b) |
| **C-10** | Legal / fiscal / aduanal | *"Si compro de EE.UU. y lo declaro, ¿cuánto me cobra la aduana?"* | `legal_fiscal` | **Escalar** | Cero respuestas. Escalación + correo ≤15 min |

### 10.1 Casos límite (obligatorios)

| ID | Caso límite | Entrada de ejemplo | Clasificación esperada | Acción esperada | Aserción |
|---|---|---|---|---|---|
| **C-11** | **Ambiguo** | *"¿Y la de arriba?"* | `ambiguo` (o confianza < umbral) | **Escalar** (MKT-4) | Cero respuestas. La escalación indica el motivo `ambiguo` y adjunta el comentario y la publicación. El agente **no pide aclaración**, no responde nada |
| **C-12** | **Mezclado: elogio + queja** | *"Muy buen contenido la verdad, pero llevo una semana esperando respuesta de mi cotización y nada."* | `queja` (gana por precedencia sobre `elogio`) | **Escalar** | Cero respuestas, ni siquiera un agradecimiento por el elogio. Aserción explícita: la precedencia escalar > responder se aplica y queda registrada la clasificación secundaria `elogio` |
| **C-13** | **En inglés** | *"Do you ship to the US? How much for the Umbreon?"* | Doble: `envio_terminos` + `precio_catalogo` | **Escalar** (SUPUESTO) | En fase 1 el agente **no responde en inglés**: escala con la respuesta propuesta en inglés para revisión de JC. Motivo: la cuenta es de mercado mexicano y el envío internacional no está definido. *(Ver P-11.)* |
| **C-14** | **Referencia a foto** | *"Ya les mandé la foto de mi carpeta, ¿la vieron?"* | `ambiguo` / `referencia_externa` | **Escalar** | Cero respuestas. **Nota de producto:** los comentarios de Instagram **no admiten adjuntar imágenes**. El copy del reel del martes en `semana_1_tcghunt.md` dice *"Manda foto de tu carpeta en comentarios"*, lo cual no es posible en la plataforma. El copy debe corregirse a *"Descríbenos qué tienes en comentarios"* o dirigir a otro canal. *(Ver P-12.)* |
| **C-15** | **Spam con link disfrazado de pregunta** | *"buenas, ¿compran cartas? nosotros vendemos al mayoreo, escríbenos a cartaspokemex .shop"* | `spam` (gana por precedencia sobre `explicacion_producto`) | **Ocultar** | Ocultado, sin respuesta. Aserción: la presencia de un dominio/URL externo no perteneciente a la lista blanca ni a tcghunt.mx activa `spam` aunque el texto parezca una pregunta legítima |
| **C-16** | **Solicitud de colaboración / giveaway** | *"Hola, soy creador de contenido, ¿hacemos un giveaway juntos?"* | `colaboracion` | **Escalar** (brief §8.4) | Cero respuestas. Escalación tipo `Aprobación` a JC |

**CA-10.1** — Los 16 casos anteriores están implementados como pruebas automáticas y forman parte del gate de QA del sprint de comentarios.
**CA-10.2** — Toda respuesta publicada pasa antes por la batería completa de invariantes MKT (CA-9.0.1).
**CA-10.3** — Para cada caso, la aserción incluye tanto lo que el sistema **hace** como lo que **no hace** (aserción negativa): p. ej. C-05 no contiene cifras, C-12 no publica el agradecimiento.

---

## 11. Escalaciones a JC (brief §8) — con la corrección del canal

> **Corrección registrada.** El brief §8 dice *"Canal: Slack (canal dedicado) con el borrador completo y botón de aprobar/editar/descartar"*. El kickoff **corrige** esta decisión: *"No usamos Slack. Todo vive en la plataforma"* — cola de aprobación en `/admin/marketing` + notificación por correo transaccional. **Prevalece el kickoff.** Cuando el brief y el kickoff difieran, manda el kickoff por ser posterior y explícito (CA-3.6).

> **H-11.1** Como JC, quiero que el agente se detenga y me avise en los seis casos del brief §8 para que ningún error salga a mi nombre.

| # | Disparador (brief §8) | Tipo de correo | Criterio de aceptación |
|---|---|---|---|
| 1 | Dato sin fuente de lista blanca | `Escalación` | **CA-11.1** — Pieza a `escalado`, no publicada, correo ≤15 min, entrada en la cola con el fragmento sin fuente señalado (= MKT-1, TC-MKT1-02) |
| 2 | Noticia de fuente fuera de lista | `Escalación` | **CA-11.2** — La fuente fuera de lista se nombra en la escalación; la pieza no se publica ni siquiera con el dato marcado como "por confirmar" |
| 3 | Comentario marcado **Escala** en la matriz | `Escalación` | **CA-11.3** — Cero respuestas publicadas; escalación con comentario original + respuesta propuesta (si la hay) + tipo; correo ≤15 min (casos C-06, C-07, C-09, C-10, C-11, C-12, C-13, C-14, C-16) |
| 4 | Colaboración, giveaway o repost de UGC | `Aprobación` | **CA-11.4** — Siempre requiere aprobación explícita de JC, **en cualquier fase de autonomía**, incluida la fase 3. Sin aprobación registrada no se publica (relacionado con MKT-5, TC-MKT5-03) |
| 5 | Caída de engagement >40 % semana contra semana | `Reporte` | **CA-11.5** — Se detecta en el ciclo semanal, incluye **hipótesis** explícita y propuesta de ajuste de mix. Se calcula sobre la métrica de engagement definida por el arquitecto e igual cada semana |
| 6 | Error de API o token expirado | `Escalación` | **CA-11.6** — Correo ≤15 min, la publicación queda suspendida y el estado del token/API es visible en `/admin/marketing` (CA-1.2.2, CA-1.2.4) |

**CA-11.7** — Cada escalación tiene un estado (`abierta` / `resuelta` / `descartada`), un responsable (JC) y una marca de tiempo de resolución. Las escalaciones abiertas se listan en el reporte semanal.
**CA-11.8** — Escalaciones repetidas del mismo disparador dentro de la misma hora se agrupan en un solo correo para no saturar la bandeja (SUPUESTO), pero **cada una** queda como entrada individual en la cola.

---

## 12. Ventanas de servicio (brief §7) como criterios medibles

**Definiciones de reloj** (necesarias para que las ventanas sean verificables):
- `t_comentario` = marca de tiempo de creación del comentario según la API de Instagram.
- `t_deteccion` = momento en que el ciclo de polling lo ingiere.
- `t_clasificacion` = momento en que queda clasificado.
- `t_respuesta` = momento en que la respuesta queda publicada.
- `t_notificacion` = momento en que sale el correo de escalación.

| Ventana | Criterio medible |
|---|---|
| **Respuesta a comentario de bajo riesgo < 2 h** | **CA-12.1** — `t_respuesta − t_comentario < 120 min` en el **p95** de los comentarios de bajo riesgo de una semana, y `< 240 min` en el máximo. Se mide sobre los tipos C-01..C-05 (los que se responden). Se excluyen del cálculo los comentarios recibidos en la ventana nocturna si JC decide que no hay servicio nocturno *(SUPUESTO: hay servicio 24/7; ver P-13)* |
| **Escalación notificada < 15 min** | **CA-12.2** — `t_notificacion − t_clasificacion ≤ 15 min` en el **100 %** de las escalaciones. Sin excepciones ni p95: es un máximo duro |
| **Latencia de detección** | **CA-12.3** — `t_deteccion − t_comentario` se registra siempre y aparece en el reporte semanal (p50 y p95). Es la métrica que dice si la cadencia de polling es suficiente |

> **Conflicto detectado que requiere decisión.** El brief §11 fija el ciclo de comentarios **cada 2 h** y el brief §7 fija respuesta de bajo riesgo **< 2 h**. Con polling cada 2 h, un comentario que llega justo después de un ciclo se detecta a los ~120 min y se responde después, **incumpliendo la ventana por construcción**. Además, en fase 1 toda respuesta requiere aprobación de JC, lo que añade el tiempo de reacción humana.
> **Consecuencia:** la cadencia de polling debe ser ≤30 min para que CA-12.1 sea alcanzable *(SUPUESTO: 20 min)*, **o** la ventana debe redefinirse como `t_respuesta − t_deteccion`. *(Ver P-14.)*
> Lo mismo aplica a CA-12.2: con polling cada 2 h no se puede notificar una escalación en 15 min **desde que el usuario comentó**; por eso el criterio se define desde `t_clasificacion` y la latencia de detección se mide aparte (CA-12.3).

**CA-12.4** — Las tres métricas de esta sección aparecen en el reporte semanal, en la sección de salud.

---

## 13. Landing de lista de espera (sprint 0)

**Contexto:** es la prioridad inmediata (kickoff §Prioridad inmediata). Toca `frontend/` y `backend/`, **no** el agente. **Verificado: no existe ninguna funcionalidad de lista de espera en el código actual.** Es "lo único que convierte tres semanas de contenido en primer día de ventas" (`prelanzamiento_tcghunt.md`).

### 13.1 Alcance

Una landing pública, dos rutas localizadas, un solo campo, un botón, un mensaje de confirmación, almacenamiento en BD y captura de UTM.

- **Rutas:** `/es/espera` y `/en/waitlist`. En este repo eso significa una ruta nueva bajo `frontend/src/app/[locale]/(storefront)/` (SUPUESTO: grupo de ruta `(storefront)`; lo confirma el arquitecto).
- **Un solo campo** de texto que acepta **correo o número de WhatsApp**; el tipo se detecta automáticamente por el contenido.
- **Copy (fuente: `prelanzamiento_tcghunt.md`):** el mensaje obligatorio es
  > **"Te avisamos primero y te mostramos lo que entró a bóveda antes que a nadie."**
  (SUPUESTO del resto del copy, pendiente de aprobación de JC — P-15):
  - Titular: **"Aún no abrimos."**
  - Subtítulo: la frase obligatoria de arriba.
  - Placeholder del campo: **"Tu correo o tu WhatsApp"**
  - Botón: **"Avísenme"**
  - Confirmación: **"Listo. Eres de los primeros. Te escribimos el día que abrimos."**
  - Texto de consentimiento bajo el botón: **"Al enviar aceptas que te contactemos sobre el lanzamiento. Puedes darte de baja cuando quieras. [Aviso de privacidad]"**
  - Traducción `en` equivalente, con paridad de claves `es.json`/`en.json`.

### 13.2 Criterios de aceptación — funcionamiento

**CA-13.1** — `/es/espera` y `/en/waitlist` responden 200 sin sesión, en menos de 1 s de TTFB en staging (SUPUESTO del umbral).
**CA-13.2** — La página muestra exactamente **un** campo de entrada y **un** botón de envío.
**CA-13.3** — Un envío válido muestra el mensaje de confirmación **sin recargar la página** y sin exponer si el contacto ya estaba registrado.
**CA-13.4** — El alta queda persistida en la base de datos con: contacto normalizado, tipo (`email` | `whatsapp`), `locale`, UTM capturados, evidencia de consentimiento y marca de tiempo.
**CA-13.5** — La landing funciona con JavaScript y sin depender de sesión, cookies de terceros ni analítica externa.
**CA-13.6** — La landing es responsive y accesible: el campo tiene `label` asociado, el error se anuncia a lectores de pantalla, contraste conforme al sistema de diseño.

### 13.3 Criterios de aceptación — validación

**CA-13.7** — **Correo:** se acepta si cumple la misma validación ya usada en la plataforma (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), tras `trim()` y `toLowerCase()`.
**CA-13.8** — **WhatsApp:** se acepta un número mexicano en cualquiera de estas formas: 10 dígitos (`8112345678`), con lada país (`+528112345678`, `528112345678`), y con espacios, guiones o paréntesis. Se **normaliza a E.164** (`+528112345678`) antes de guardar. Se rechaza cualquier otra longitud o país (SUPUESTO: solo México en fase 1 — P-2).
**CA-13.9** — Una entrada que no es ni correo válido ni teléfono válido muestra un error en línea, no envía nada y **no** limpia el campo. Mensaje: *"Escribe un correo o un número de WhatsApp de 10 dígitos."*
**CA-13.10** — La entrada se recorta a un máximo de 254 caracteres antes de validar; entradas más largas se rechazan.
**CA-13.11** — El backend **repite** toda la validación del cliente. Nunca confía en el navegador.
**CA-13.12** — Casos de prueba obligatorios: `  JC@Tcghunt.MX ` → guardado como `jc@tcghunt.mx`; `81 1234 5678` → `+528112345678`; `+1 415 555 0100` → rechazado; `hola` → rechazado; cadena vacía → rechazado; `a@b` → rechazado.

### 13.4 Criterios de aceptación — anti-abuso

**CA-13.13** — **Rate limit** por IP: 5 envíos por minuto, siguiendo el precedente exacto de la plataforma (`@Throttle({ default: { ttl: 60_000, limit: 5 } })`, como `POST /catalog/sealed/restock-subscriptions`). El sexto envío en la ventana recibe 429.
**CA-13.14** — **Respuesta neutra:** el endpoint devuelve siempre la misma respuesta (SUPUESTO: 202) tanto si el contacto es nuevo como si ya existía. **No se puede usar la landing para averiguar si un correo está registrado** (anti-enumeración, patrón ya usado en la plataforma).
**CA-13.15** — **Doble alta idempotente:** enviar el mismo contacto N veces produce **un solo** registro. El segundo envío actualiza la marca de "último intento" pero no duplica ni reinicia el consentimiento.
**CA-13.16** — **Honeypot:** existe un campo oculto que un humano nunca llena; si llega relleno, el backend responde 202 (neutro) y **descarta** el alta silenciosamente (SUPUESTO: añado esta defensa; confirmar).
**CA-13.17** — El endpoint no envía correo de confirmación automático en fase de pre-lanzamiento (SUPUESTO: evita coste y riesgo de spam; el primer contacto es el correo de lanzamiento — P-16). Si JC prefiere doble opt-in, cambia CA-13.15 y CA-14.1.4.
**CA-13.18** — El endpoint está detrás de un **feature flag** siguiendo el patrón `ConfigSetting` ya existente (p. ej. `waitlist_enabled`), para poder apagarlo el día del lanzamiento sin desplegar.
**CA-13.19** — Prueba de carga mínima: 100 altas legítimas concurrentes no producen duplicados ni pérdidas.

### 13.5 Criterios de aceptación — UTM y atribución

**CA-13.20** — La landing lee de la URL `utm_source`, `utm_medium` y `utm_campaign` y los envía junto con el alta. Ausentes ⇒ se guardan nulos, el alta **no** falla.
**CA-13.21** — Los valores de UTM se saneen: máximo 64 caracteres cada uno, solo `[a-z0-9_-]` en minúsculas; cualquier otra cosa se descarta (no se guarda basura ni se refleja en la página → sin XSS reflejado).
**CA-13.22** — Prueba: visitar `/es/espera?utm_source=instagram&utm_medium=organic&utm_campaign=cuanto_vale_tu_carpeta` y darse de alta guarda esos tres valores exactos asociados al alta.
**CA-13.23** — Si el visitante navega dentro del sitio antes de darse de alta, se conserva el **primer toque** de UTM (SUPUESTO: almacenamiento en el cliente durante 30 días; el mecanismo lo define el arquitecto).
**CA-13.24** — El conteo de altas por `utm_campaign` es consultable y aparece en el reporte semanal (E10) como métrica agregada.

### 13.6 Criterios de aceptación — consentimiento y privacidad

**CA-13.25** — Se guarda evidencia de consentimiento: marca de tiempo, versión del texto de consentimiento mostrado y `locale`. El texto de consentimiento es versionado; cambiarlo incrementa la versión.
**CA-13.26** — El texto de consentimiento es visible **antes** de enviar y enlaza al aviso de privacidad del sitio. *(Dependencia: la plataforma menciona el aviso de privacidad en el registro; hay que confirmar que exista una página publicada a la que enlazar — P-17.)*
**CA-13.27** — El propósito declarado es acotado: avisar del lanzamiento y del contenido de bóveda. **No** se usa para otra finalidad sin nuevo consentimiento.
**CA-13.28** — **Baja (opt-out):** existe un mecanismo de baja de un clic, sin sesión, con token no adivinable; tras la baja, el contacto queda marcado y **queda excluido de todo envío**. Prueba: dar de baja y ejecutar la campaña ⇒ 0 envíos a ese contacto.
**CA-13.29** — **Derechos ARCO / borrado:** existe una vía para eliminar un contacto de la lista a petición; ejecutarla elimina el dato de contacto y conserva solo el agregado anónimo (conteo por UTM).
**CA-13.30** — La lista de espera **no es pública**: solo `super_admin` puede verla o exportarla, y la exportación queda auditada. Las herramientas MCP no la exponen (CA-13.1.5).
**CA-13.31** — `security` decide qué metadatos de red (IP, user agent) se conservan y por cuánto tiempo; el spec exige que la decisión quede documentada y que la retención sea finita.

### 13.7 Qué se hace con la lista el día del lanzamiento

**CA-13.32** — A las **09:00 del día 1, antes del primer post**, sale el aviso a la lista de espera (E14, `prelanzamiento_tcghunt.md`).
**CA-13.33** — Los contactos tipo `email` reciben el correo por el módulo `mail` existente. Los tipo `whatsapp` se atienden según P-2: si WhatsApp Business no está listo, se exportan para envío manual y se marcan como no notificados por sistema.
**CA-13.34** — El aviso incluye el incentivo de lanzamiento configurado por JC (P-3) y **nunca** un descuento en cartas (`prelanzamiento_tcghunt.md`).
**CA-13.35** — Los links del aviso llevan UTM propio (CA-14.1.2), de modo que el reporte del día 1 pueda separar **tráfico de lista de espera** de **tráfico de Instagram**.
**CA-13.36** — Tras el lanzamiento, la lista de espera queda disponible como audiencia de correo para el canal de fase 2, sujeta al consentimiento original (CA-13.27): si el propósito cambia, se pide consentimiento nuevo.
**CA-13.37** — El reporte del día 1 incluye: altas totales, tasa de apertura/clic del aviso, y cuántas de esas altas terminaron en cuenta creada, cotización iniciada o primera compra.

---

## 14. Fases y autonomía

### 14.1 Fases (brief §12)

| Fase | Duración | Autonomía | Situación |
|---|---|---|---|
| **-1 · Pre-lanzamiento** | 2–3 sem | **Manual**, sin agente ni API | **Es donde estamos.** Objetivo: seguidores + **lista de espera** + inventario visible antes del día 1 |
| **0 · Setup** | 2–4 sem | — | App review de Meta, selección de voz, plantillas, landing |
| **1 · Supervisada** | 4 sem | El agente genera **todo**; **JC aprueba en lote** | Objetivo de este spec |
| **2 · Semiautónoma** | 4–8 sem | Auto-publica series de bajo riesgo (`mercado_60s`, `dato_de_caza`, `cayo_en_la_boveda`, `proximos_releases` con fuente); comentarios de bajo riesgo automáticos | |
| **3 · Autónoma** | En adelante | Solo escalaciones del brief §8; revisión mensual | |

**CA-14.1** — **Criterio de cambio de fase (brief §12):** se avanza de fase cuando se cumplen **ambas** condiciones durante **dos semanas consecutivas**: (a) **cero correcciones de tono** de JC —medibles como cero ediciones de `copy`/`guion_vo` motivadas por tono, registradas al editar—, y (b) **cero incidentes de invariantes** (cero bloqueos MKT-1..MKT-8 y cero escalaciones por esos motivos).
**CA-14.2** — El cumplimiento de CA-14.1 se calcula automáticamente y aparece en el reporte semanal como *"Elegibilidad de cambio de fase: sí/no"*, con las dos cifras que lo sustentan.
**CA-14.3** — El cambio de fase **no es automático**: lo ejecuta JC modificando `autonomy.yaml`. El sistema solo informa que es elegible.

### 14.2 `autonomy.yaml`

**CA-14.4** — La autonomía se controla por **configuración por serie** en `autonomy.yaml`, **no por código** (RESTRICCIÓN DADA). Cambiar la autonomía de una serie no requiere modificar ni desplegar lógica.
**CA-14.5** — **Fase 1: todo requiere aprobación.** El archivo inicial tiene aprobación obligatoria para las 13 series y para todos los tipos de comentario. Prueba: con el `autonomy.yaml` inicial, **ninguna** pieza y **ninguna** respuesta se publica sin registro de aprobación de un `super_admin`.
**CA-14.6** — Granularidad mínima: por `key` de serie (publicación) y por tipo de comentario (respuesta). (SUPUESTO: además, por canal — P-6.)
**CA-14.7** — Una serie sin entrada en `autonomy.yaml` se trata como **aprobación obligatoria** (default seguro, brief §6: "no hay defaults inseguros"). Prueba: añadir una serie nueva sin tocar `autonomy.yaml` ⇒ requiere aprobación.
**CA-14.8** — `autonomy.yaml` **no puede** desactivar invariantes, ni la lista blanca de fuentes, ni la regla de que UGC/colaboraciones siempre requieren aprobación (CA-9.0.3, CA-9.8.2, CA-11.4). Prueba: añadir una clave que pretenda saltar MKT-8 ⇒ la configuración es rechazada al cargar.
**CA-14.9** — Todo cambio de `autonomy.yaml` queda registrado (quién, cuándo, qué cambió) y se refleja en el siguiente reporte semanal.
**CA-14.10** — El nivel de autonomía vigente por serie es visible en `/admin/marketing`.

---

## 15. Criterios de aceptación del módulo completo (checklist de QA)

QA marca este checklist para emitir veredicto. Está ordenado por sprint del kickoff §5.4.

### Sprint 0 — Lista de espera
- [ ] **Q-01** `/es/espera` y `/en/waitlist` publicadas, con el copy obligatorio de `prelanzamiento_tcghunt.md` y paridad `es.json`/`en.json` (CA-13.1..13.6)
- [ ] **Q-02** Validación de correo y de WhatsApp MX con los 6 casos de CA-13.12 pasando
- [ ] **Q-03** Anti-abuso: rate limit 5/min, respuesta neutra, doble alta idempotente, honeypot (CA-13.13..13.19)
- [ ] **Q-04** UTM capturados, saneados y consultables; prueba de CA-13.22 verde
- [ ] **Q-05** Consentimiento versionado, baja de un clic funcional, lista no pública ni expuesta por MCP (CA-13.25..13.31)

### Sprint 1 — Publisher + token
- [ ] **Q-06** Un post real publicado en @tcghunt.mx desde código, en los tres formatos (reel, carrusel, imagen) (CA-1.1.3)
- [ ] **Q-07** Publicación idempotente ante fallo de red (CA-1.1.5)
- [ ] **Q-08** Refresco automático del token verificado y escalación en ≤15 min si falla (CA-1.2.1, CA-1.2.2)
- [ ] **Q-09** El token no aparece en ningún log, correo, interfaz ni respuesta MCP (CA-1.2.3)
- [ ] **Q-10** Todo link publicado lleva UTM válido con `utm_campaign` = `key` de serie (CA-1.1.4)

### Sprint 2 — Planner → writer → render → approval
- [ ] **Q-11** Plan semanal de 7–8 piezas con el mix correcto y los 4 pilares cubiertos (CA-3.1.1, CA-3.1.2)
- [ ] **Q-12** Guion de VO ≤90 palabras, gancho sin saludo, reglas de tono (CA-4.1.1..4.1.3)
- [ ] **Q-13** Las 5 plantillas de render existen y producen activos en las dimensiones de Instagram (CA-5.1.1, CA-5.1.3)
- [ ] **Q-14** Voz única fija; el pipeline **falla y escala** si la voz configurada no está disponible (CA-6.1.3)
- [ ] **Q-15** Cola en `/admin/marketing` con vista previa, aprobar/editar/descartar, lote, y motivo obligatorio al descartar (CA-7.1.1..7.1.5)
- [ ] **Q-16** Un borrador con invariante en rojo no se puede aprobar ni desde la interfaz ni forzando el backend (CA-7.1.7)
- [ ] **Q-17** Editar una pieza aprobada la desaprueba y reejecuta invariantes (CA-8.3, TC-MKT8-05)
- [ ] **Q-18** Correos con prefijo `[TCG HUNT Marketing]` y etiqueta correcta, desde `marketing@tcghunt.mx`, con enlace a la cola (CA-8.1.1..8.1.3)

### Sprint 3 — Comentarios + insights + reporte + MCP
- [ ] **Q-19** Los 16 casos de la matriz de comentarios (§10) pasan como pruebas automáticas (CA-10.1)
- [ ] **Q-20** Ventanas de servicio medidas y cumplidas: p95 <2 h de respuesta, 100 % de escalaciones notificadas ≤15 min (CA-12.1, CA-12.2)
- [ ] **Q-21** Insights diarios de 48 h con ganadores/perdedores por serie (CA-10.1.1)
- [ ] **Q-22** Atribución UTM cruzada con eventos de negocio del backend (CA-10.1.3) — **bloqueada por P-4 si la plataforma no persiste atribución**
- [ ] **Q-23** Reporte semanal del domingo con las 6 secciones en orden fijo, guardado en BD + correo + Drive (CA-10.1.5, CA-10.1.6)
- [ ] **Q-24** Escalación automática por caída de engagement >40 % con hipótesis (CA-10.1.7)
- [ ] **Q-25** Drive con la estructura y convención de nombres exactas; credencial acotada a la carpeta (CA-11.1.1..11.1.3)
- [ ] **Q-26** MCP con OAuth, alcances separados lectura/acción, auditoría por invocación, sin PII, `update_brief_section` incapaz de tocar invariantes (CA-13.1.1..13.1.7)
- [ ] **Q-27** 2 sugerencias de historia diarias, con activo descargable; el agente no publica historias (CA-12.1.1..12.1.4)

### Transversales (aplican a todos los sprints)
- [ ] **Q-28** **Los 8 invariantes MKT en verde**, con los 30 casos de prueba de §9 pasando, incluidos los 9 de MKT-8 (CA-9.0.5)
- [ ] **Q-29** Invariantes evaluados en las 4 superficies de texto y **dos veces** (al generar y antes de publicar) (CA-6.2, CA-9.0.2)
- [ ] **Q-30** Ninguna llamada a mensajería de Instagram; ninguna acción sobre perfiles de terceros; sin Slack (CA-3.1, CA-3.3, CA-3.6)
- [ ] **Q-31** Máquina de estados: transiciones ilegales rechazadas y auditadas (CA-8.1, CA-8.5)
- [ ] **Q-32** Control de acceso por rol verificado: `super_admin` aprueba, `vault_operator` solo lee, `customer` 403 (CA-4.1)
- [ ] **Q-33** `autonomy.yaml` inicial con aprobación obligatoria para las 13 series; default seguro para series sin entrada; imposible desactivar invariantes (CA-14.5, CA-14.7, CA-14.8)
- [ ] **Q-34** El acceso del módulo al backend es de solo lectura, comprobado por intento de escritura fallido (CA-2.2.2)
- [ ] **Q-35** El reporte compara alcance contra conversión y emite la alerta de mix mal calibrado cuando aplica (CA-1.1, CA-1.2)
- [ ] **Q-36** Elegibilidad de cambio de fase calculada automáticamente y publicada en el reporte (CA-14.2)

---

## 16. Supuestos consolidados (JC confirma o corrige)

| # | Supuesto | Dónde |
|---|---|---|
| S-01 | Una sola aprobación cubre todos los canales destino de la misma pieza | CA-2.2 |
| S-02 | `vault_operator` tiene acceso de **solo lectura** a `/admin/marketing` | §4, CA-4.1 |
| S-03 | Margen de 120 min tras la hora programada antes de escalar una pieza no publicada | CA-1.1.7 |
| S-04 | El token se refresca cuando quedan ≤7 días de vigencia | CA-1.2.1 |
| S-05 | Ventana de frescura de precio/stock del backend = 60 min | CA-2.2.1, MKT-2 |
| S-06 | Conteo de palabras del guion: cifras cuentan como una palabra; `$1,250 MXN` = 2 | CA-4.1.1 |
| S-07 | Máximo 2 emojis por pieza, nunca consecutivos | CA-4.1.3 |
| S-08 | Máximo 50 % de las piezas de la semana mencionan explícitamente la bóveda | CA-4.1.4 |
| S-09 | Hashtags: máximo 8, minúsculas, con lista negra propuesta | CA-4.1.6 |
| S-10 | `alt_text` obligatorio, ≤125 caracteres (requisito de accesibilidad que añado) | CA-4.1.7 |
| S-11 | Copy solo en español de México; sin mezcla de idiomas salvo nombres propios | CA-4.1.8 |
| S-12 | Carrusel en 4:5 (1080×1350); reel 1080×1920; duración de reel 20–60 s | CA-5.1.3, CA-5.1.5 |
| S-13 | Cambiar la voz se registra como escalación de tipo `Aprobación` | CA-6.1.2 |
| S-14 | La cola de aprobación debe ser usable en móvil | CA-7.1.8 |
| S-15 | El correo de aprobación se envía tras el ciclo de la mañana y agrupa el lote | CA-8.1.4 |
| S-16 | Umbral de confianza de clasificación: por debajo ⇒ ambiguo ⇒ escala | CA-9.1.2 |
| S-17 | Tope de 20 respuestas a comentarios por ciclo | TC-MKT6-04 |
| S-18 | Una pieza pasa a `medido` con el primer snapshot de insights ≥24 h tras publicar | §8 |
| S-19 | Los datos de mercado caducan dentro del ciclo; los enciclopédicos/históricos no | TC-MKT1-03 |
| S-20 | Texto de divulgación de IA: **"Voz en off generada con IA."** (la API de IG no expone hoy campo de etiquetado) | MKT-7 |
| S-21 | La lista negra de frases de MKT-8 es la de §9; puede ampliarse | MKT-8.a |
| S-22 | En fase 1 el agente **no responde en inglés**: escala con respuesta propuesta | C-13 |
| S-23 | Escalaciones repetidas del mismo disparador en 1 h se agrupan en un correo, pero no en la cola | CA-11.8 |
| S-24 | Hay servicio 24/7 para la ventana de respuesta (no se excluye la noche) | CA-12.1 |
| S-25 | Cadencia de polling de comentarios = 20 min (para que la ventana de 2 h sea alcanzable) | §12 |
| S-26 | La landing vive bajo el grupo de ruta `(storefront)` | §13.1 |
| S-27 | Copy completo de la landing (titular, botón, confirmación, consentimiento) propuesto por mí | §13.1 |
| S-28 | WhatsApp solo México (+52) en fase 1 | CA-13.8 |
| S-29 | Respuesta neutra 202, honeypot oculto, sin correo de confirmación automático (no doble opt-in) | CA-13.14, 13.16, 13.17 |
| S-30 | Primer toque de UTM conservado 30 días en el cliente | CA-13.23 |
| S-31 | UTM de la campaña de lanzamiento: `utm_source=waitlist&utm_medium=email&utm_campaign=launch` | CA-14.1.2 |
| S-32 | Convención de nombres de Drive para calendario y piezas | CA-11.1.2 |
| S-33 | `update_brief_section` del MCP no puede modificar invariantes ni lista blanca | CA-13.1.7 |
| S-34 | Granularidad de `autonomy.yaml`: por serie, por tipo de comentario y por canal | CA-14.6 |
| S-35 | Formato de las sugerencias de historia: 1080×1920, PNG o MP4 | CA-12.1.2 |
| S-36 | TTFB de la landing < 1 s en staging | CA-13.1 |

---

## 17. Preguntas abiertas para JC (bloquean o cambian el diseño)

| # | Pregunta | Por qué importa |
|---|---|---|
| **P-1** | El kickoff dice `apps/marketing-agent/`, pero **este repo no tiene layout `apps/`** (tiene `backend/` y `frontend/`). ¿Se crea un tercer directorio de primer nivel (`marketing-agent/`), se reestructura el repo a `apps/`, o vive como módulo dentro de `backend/`? | Afecta la ADR, el despliegue y las reglas de propiedad de archivos del equipo. Lo resuelve el arquitecto, pero necesita tu criterio sobre "servicio independiente" |
| **P-2** | **WhatsApp el día 1.** `prelanzamiento_tcghunt.md` dice "Correo/WhatsApp a la lista de espera a las 09:00", pero el kickoff pone WhatsApp en **fase 2**. Si el día 1 solo hay correo, ¿seguimos capturando números de WhatsApp sabiendo que no podremos escribirles por sistema (envío manual), o la landing pide solo correo? | Cambia el spec de la landing (un campo o dos, validación) y la promesa hecha al usuario |
| **P-3** | **Incentivo de lanzamiento.** `prelanzamiento_tcghunt.md` lo deja como decisión tuya: ¿envío consolidado gratis en el primer pedido de bóveda para la lista de espera, o prioridad en cotización de buylist la primera semana? | Sin decisión, el correo del día 1 no tiene contenido y CA-14.1.7 queda vacío |
| **P-4** | **Atribución UTM en la plataforma.** Verifiqué que hoy **no existe** ninguna captura ni persistencia de `utm_source`/`utm_campaign` en `backend/` ni `frontend/`. La "métrica real" del brief §1 es imposible sin ella, y el agente es de **solo lectura**, así que no puede implementarla. ¿Se añade la captura de primer toque (cuenta creada, cotización, primer pedido) como trabajo de plataforma en el sprint 0, junto a la landing? | Bloquea Q-22, CA-10.1.3 y la mitad del valor del reporte semanal |
| **P-5** | **Etiquetado de IA (MKT-7).** La API de publicación de Instagram no expone hoy un campo de "contenido generado con IA". ¿Apruebas la línea fija en el copy **"Voz en off generada con IA."**, o prefieres otra redacción / otra ubicación? | Es un invariante duro: sin texto aprobado, toda pieza con VO queda bloqueada |
| **P-6** | **Listas y umbrales que propuse yo:** lista negra de frases MKT-8, lista negra de hashtags y máximo de 8, tope de 20 respuestas por ciclo, máximo de 2 emojis, 50 % de menciones a bóveda. ¿Los apruebas tal cual o los ajustas? | Son los que determinan cuántos falsos positivos bloquearán piezas legítimas |
| **P-7** | **Caducidad de fuentes.** Propuse que los datos de **mercado** caduquen dentro del ciclo y los **enciclopédicos** (artista, año, set) no caduquen. ¿Es correcto? ¿Cuánto dura un pop report de PSA antes de considerarse viejo? | Determina cuántas piezas se escalan por MKT-1 sin necesidad real |
| **P-8** | **Poder de la dirección de marketing vía MCP.** Propuse que `update_brief_section` **no pueda** modificar los invariantes ni la lista blanca de fuentes. ¿Confirmas? Si Claude en claude.ai puede reescribir esas secciones, los invariantes dejan de ser una barrera dura | Es la diferencia entre "regla del negocio" y "sugerencia" |
| **P-9** | ¿Necesitas aprobar desde el teléfono? Si sí, la cola de `/admin/marketing` es un requisito móvil de primera clase y no un extra | Afecta el alcance de `ux-ui` y `frontend` |
| **P-10** | **Respuesta a quejas y DM.** El brief §7 manda responder *"Te escribimos por DM ahora mismo"* a las quejas, pero los DM están **fuera de alcance en fase 1**. Propuse que el agente **escale** y deje esa frase propuesta en la cola, y que tú envíes el DM a mano. ¿Correcto? ¿O prefieres que el agente publique esa frase automáticamente asumiendo que tú harás el DM después? | Publicar "te escribimos por DM" sin que salga el DM es peor que no responder |
| **P-11** | **Comentarios en inglés.** Propuse escalar en fase 1 (no responder en inglés) porque no hay política de envío internacional. ¿Correcto, o quieres respuesta automática en inglés remitiendo a `/en/`? | Define el caso C-13 y si necesitamos copy en inglés en el flujo de comentarios |
| **P-12** | **"Manda foto de tu carpeta en comentarios"** (copy del martes, `semana_1_tcghunt.md`) **no es posible**: los comentarios de Instagram no admiten imágenes. ¿Cambiamos el CTA a "descríbenos qué tienes en comentarios", a "etiquétanos en tu historia", o a otro canal? | Afecta el copy de la serie `cuanto_vale_tu_carpeta` y todo el flujo C-01/C-14 |
| **P-13** | ¿Hay servicio 24/7 para la ventana de respuesta de 2 h, o excluimos una franja nocturna? | Cambia cómo se calcula CA-12.1 y si el sistema "incumple" cada madrugada |
| **P-14** | **Conflicto de cadencia.** El brief fija ciclo de comentarios **cada 2 h** y respuesta de bajo riesgo **<2 h**: es incumplible por construcción. ¿Bajamos el polling a ≤30 min (propuse 20), o redefinimos la ventana como "desde que el agente detecta el comentario"? | Es el único conflicto interno del brief que afecta un compromiso de servicio |
| **P-15** | **Copy de la landing.** Solo tengo aprobada la frase *"Te avisamos primero y te mostramos lo que entró a bóveda antes que a nadie."* Propuse titular ("Aún no abrimos."), botón ("Avísenme") y confirmación. ¿Los apruebas o los escribes tú? | Es la pieza de conversión del pre-lanzamiento; el copy es tuyo, no mío |
| **P-16** | **¿Doble opt-in?** Propuse **no** enviar correo de confirmación al darse de alta (el primer contacto sería el aviso del día 1). ¿Prefieres doble opt-in, que reduce altas pero mejora la entregabilidad del correo del lanzamiento? | Cambia CA-13.15, CA-13.17 y la calidad de la lista |
| **P-17** | ¿Existe una página de **aviso de privacidad** publicada a la que enlazar desde la landing? Encontré la mención en el registro de la plataforma, pero no una página dedicada | CA-13.26 no se puede cumplir sin ella, y es requisito de LFPDPPP para recolectar datos personales |
| **P-18** | **Fecha de lanzamiento.** Todo el calendario (semana 3, día 1, campaña a la lista) cuelga de una fecha confirmada que `prelanzamiento_tcghunt.md` pide "al inicio de la semana 3". ¿Ya la tienes? | Determina si el sprint 0 es esta semana o puede esperar |

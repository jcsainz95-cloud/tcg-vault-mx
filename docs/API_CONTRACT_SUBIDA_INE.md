# API_CONTRACT_SUBIDA_INE — Subida de INE por nuestra API (2026-11-28)

Origen: HECHOS 2026-11-28 (el dueño pidió arreglo real, para todos, cualquier navegador y webviews de WhatsApp/Instagram/Facebook, no parche). Decisión: `DECISIONES.md` §SUBIDA-INE. Módulo `uploads`/KYC con PII ⇒ gates `qa` + `seguridad-lead`. Regla de conflicto: PROJECT.md > este contrato > código. Dinero: no aplica.

## 0. Causa (2 diagnósticos coinciden; CORS vivo NO MEDIDO)
`d65796c6` hizo `Cache-Control: no-store` cabecera firmada del PUT (`uploads.service.ts:221-241`); el navegador la manda a R2 (`api.ts:3814-3818`); el CORS documentado del bucket solo permite `content-type` (`docs/archive/DEVOPS_NOTES.md:2381-2385`) ⇒ preflight falla, `fetch` lanza, el cliente ve el genérico `errUpload` (`PhotoUploader.tsx:164-174`). Remedio de raíz: **el navegador ya no habla con R2**; sube a nuestra API y el servidor escribe en R2.

## 1. Endpoint
`POST /api/v1/uploads/kyc-ine` · rol: cuenta (cualquier autenticado) · `multipart/form-data`, un solo campo `file` (otros campos/archivos extra ⇒ ignorados; 2.º archivo ⇒ `PHOTO_INVALID{reason:'multiple_files'}`).
- Respuesta `201 { uploadKey: string }` (forma `kyc_ine/<AAAA-MM-DD>/<uuid>.jpg`; el regex C15 existente ya la acepta, la extensión es SIEMPRE `jpg`). Misma `uploadKey` que hoy consumen `PUT /users/me/kyc` y checkout; **no cambia ningún otro contrato**.
- Guards: JWT + `ActorThrottlerGuard` `@Throttle 20/min por actor` + eje **por IP** (60/min, tercer eje del mismo guard; proxy de confianza ya configurado) + **tope global de concurrencia = 3** (semáforo en proceso; la 4.ª espera máx. 5 s en cola y luego `429 RATE_LIMITED{reason:'busy'}` con `Retry-After: 5`). Por qué 3: sharp en 48 MP usa cientos de MB; el tope protege la RAM del contenedor.
- Límites de entrada (multer, memoria, `fileSize` = **12 MiB**; precedente `accessory-photo.ts` usa 10 MiB, pero una foto directa de iPhone/Android 48 MP en JPEG llega a 8–12 MiB). `files:1`, `fields:0`. Exceder ⇒ `413 FILE_TOO_LARGE` (se mapea el `LIMIT_FILE_SIZE` de multer; el cuerpo se corta sin leer el resto).

## 2. Procesamiento en servidor (orden fijo; falla en cualquier paso ⇒ no se escribe nada)
1. **Sniff por firma** (ignora `Content-Type`, nombre y extensión; pueden venir vacíos o mentir): JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; WebP `RIFF….WEBP`; HEIC/HEIF caja `ftyp` en bytes 4-11 con marca `heic|heix|heim|heis|hevc|hevx|mif1|msf1`. Reutilizar/extender `sniffImageType` de `accessory-photo.ts` (compartido, no copiado). Otro ⇒ `PHOTO_INVALID{reason:'not_image'}`.
2. **sharp**: `sharp(buf,{limitInputPixels: 64_000_000, failOn:'error'})` (**no** 40 M como accesorios: un 48 MP = 48 M px debe pasar; es el caso real de iPhone Pro/Samsung). Leer `metadata()`; `w*h` > límite ⇒ `PHOTO_INVALID{reason:'too_many_pixels'}`; no decodifica ⇒ `not_image`; imagen < 600 px en su lado largo ⇒ `PHOTO_INVALID{reason:'too_small'}` (ilegible para KYC).
3. `.rotate()` (aplica EXIF Orientation), `.resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true})`, `.jpeg({quality:85, mozjpeg:true})`. **No** `withMetadata()`: sharp quita EXIF/GPS/ICC por defecto; se verifica con test (§7). Salida típica 200–600 KB.
4. **HEIC/HEIF**: depende de que el `libvips` de sharp en la imagen Railway traiga libheif **con HEVC**. Los binarios prebuilt de sharp NO decodifican HEVC por licencia; HEIC de iPhone suele ser HEVC. **Medición obligatoria (devops, antes de construir):** en la imagen de producción, `sharp.format.heif` (¿`input` y compresión `hevc`?) y decodificar un HEIC real de iPhone. Resultados: (A) decodifica ⇒ se procesa igual que el resto; (B) no ⇒ `422 PHOTO_INVALID{reason:'heic_unsupported'}` con mensaje claro (§3). Nunca se deja pasar un archivo no decodificable ni se guarda HEIC crudo. Nota: en iOS, `<input type=file accept="image/*">` normalmente **ya convierte a JPEG** al elegir (compatibilidad máxima); el HEIC llega sobre todo desde «Archivos» o Android. La rama (B) es degradación aceptada; (A) por build propia de libvips es **decisión del dueño** solo si la medición da B y las pruebas muestran uso real (O-6).
5. **Escritura**: `PutObject` desde el servidor con `ContentType:'image/jpeg'`, `CacheControl:'no-store'` (C14), SSE como hoy; luego crear `KycUploadGrant{userId, objectKey, contentType:'image/jpeg'}` (C15: el grant se crea DESPUÉS de que el objeto existe; si el grant falla, `DeleteObject` best-effort y `STORAGE_UNAVAILABLE`). Mismos controles C14/C15 que `presign` (key emitida por el servidor, `@unique`, `HeadObject` en el consumo, GET con `ResponseCacheControl:'no-store'`). Sin cambio de esquema.
6. Fallo de R2 ⇒ `503 STORAGE_UNAVAILABLE` (R2 con 1 reintento interno del SDK; el reintento fino es del cliente).

Idempotencia: cada llamada exitosa crea una key nueva (uuid); un reintento tras timeout puede dejar un objeto huérfano con grant sin consumir. Limpieza automática: el job existente de huérfanos KYC (grants sin consumo > 24 h ⇒ borra objeto y grant); si no existe, **backend lo crea** (cron diario) — AUTO, sin intervención del dueño.

## 3. Códigos de error (forma estándar `{ error:{ code, message, reason? } }`)
| HTTP | code | reason | es (cliente) | en (cliente) |
|---|---|---|---|---|
| 422 | `PHOTO_INVALID` | `not_image` | «Ese archivo no es una foto. Toma una foto de tu INE o elige una imagen JPG, PNG, WebP o HEIC.» | «That file isn't a photo. Take a photo of your ID or pick a JPG, PNG, WebP or HEIC image.» |
| 422 | `PHOTO_INVALID` | `too_many_pixels` | «La foto es demasiado grande en resolución. Baja la calidad de la cámara o elige otra.» | «The photo's resolution is too large. Lower your camera quality or pick another one.» |
| 422 | `PHOTO_INVALID` | `too_small` | «La foto es muy pequeña y no se leería. Acércate y vuelve a tomarla.» | «The photo is too small to read. Move closer and retake it.» |
| 422 | `PHOTO_INVALID` | `heic_unsupported` | «No pudimos leer este formato (HEIC). Elige la foto de la galería como JPG o toma una nueva con «Tomar foto».» | «We couldn't read this format (HEIC). Pick the photo as a JPG or take a new one with “Take photo”.» |
| 422 | `PHOTO_INVALID` | `multiple_files` | (usa `errNotImage`) | (usa `errNotImage`) |
| 413 | `FILE_TOO_LARGE` | — | «La foto pesa más de {max}. Toma otra con menor calidad.» | «The photo is larger than {max}. Take another at lower quality.» |
| 429 | `RATE_LIMITED` | `actor`/`ip`/`busy` | «Demasiados intentos. Espera un minuto e inténtalo de nuevo.» | «Too many attempts. Wait a minute and try again.» |
| 503 | `STORAGE_UNAVAILABLE` | — | «No pudimos guardar tu foto por un problema nuestro. Reintenta en un momento.» | «We couldn't save your photo because of a problem on our side. Try again shortly.» |
Sin sesión ⇒ `401` estándar (el cliente refresca token y reintenta una vez, §5). Todo lo demás inesperado ⇒ `500` ⇒ mensaje `errUpload` genérico. `message` del backend en inglés técnico; el cliente muestra SIEMPRE su i18n por `code`/`reason`, nunca el texto del servidor.

## 4. Seguridad y registro
- **Los bytes del INE nunca van** a logs, Sentry (`beforeSend` ya sin cuerpo; verificar que `multipart` no entre en breadcrumbs), disco (multer `memoryStorage`, sin `tmp`) ni a errores (los `Error` no llevan el buffer). Sin volcar `req.body`.
- 1 línea estructurada por intento: `{ evt:'kyc_ine_upload', userId, bytes, sniffed:'jpeg|png|webp|heic|none', outcome:'ok|PHOTO_INVALID:<reason>|FILE_TOO_LARGE|RATE_LIMITED|STORAGE_UNAVAILABLE|error', ms, inApp:boolean }`. `inApp` se deduce del User-Agent (FBAN/FBAV, Instagram, WhatsApp, `; wv)`, Line, MicroMessenger); **no** se guarda el UA completo, ni nombre de archivo, ni IP.
- Sin cambio en CORS de la API: la subida es del mismo origen/CORS que el resto de llamadas autenticadas (el front ya llama a la API con `credentials`/Bearer). Prohibido pasar el archivo por funciones de Vercel (límite de cuerpo 4.5 MB y datos de INE por un tercero más).
- Cabeceras de respuesta: `Cache-Control: no-store`. Anti-zip-bomb: el límite de píxeles se aplica ANTES de decodificar a pleno; `failOn:'error'`.

## 5. Frontend (`PhotoUploader.tsx`, `api.ts`)
- `uploadKycIne(file, {signal, onProgress?})` en `api.ts`: `FormData{file}` por la ruta normal de API (mismo `apiFetch`: base URL, CORS, **refresco de token en 401 y 1 reintento**). Sin `Content-Type` manual (el navegador pone el boundary). **No** se llama a R2 desde el navegador.
- Compresión del cliente = **mejor esfuerzo**: si canvas/`createImageBitmap` falla (webviews, HEIC), se envía el original tal cual (≤ 12 MiB); jamás bloquea ni muestra error por fallar la compresión. Se elimina el rechazo por `file.type`: **se acepta `file.type === ''`**; el único filtro cliente es tamaño (> 12 MiB ⇒ `errTooLarge` sin subir).
- Dos botones: **«Tomar foto»** (`<input type=file accept="image/*" capture="environment">`) y **«Elegir de galería»** (`<input type=file accept="image/*">` sin `capture`). Los dos inputs ocultos, con `label`/botón accesible (≥ 44 px, `aria-label`).
- Reintentos: hasta 3 intentos en total (2 reintentos) con espera 1 s y 3 s (+ jitter) **solo** ante error de red/`fetch` lanzado, timeout o 5xx (excepto 503 con `Retry-After` > 10 s). Nunca reintentar 4xx (salvo 401 por refresco). **Timeout 60 s por intento** (`AbortController`). Progreso: «Subiendo…» con el intento visible solo a lectores de pantalla.
- Mensaje distinto por código/razón (tabla §3); error de red agotado ⇒ `errNetwork`; resto ⇒ `errUpload`.
- **Telemetría de fallo (cada fallo final)**: `POST /telemetry/client-error` (contrato existente: `message ≤300`, `path ≤200`, `release ≤40`; **sin cambio de DTO**). `message` = `kyc-ine|stage=<select|compress|upload>|code=<CODE|network|timeout|http_5xx>|reason=<reason|->|ua=<chrome|safari|firefox|edge|samsung|other>|inapp=<0|1>|ios=<0|1>|attempt=<n>`; `path` = ruta de la página. **Sin PII**: nada de userId, correo, nombre de archivo, tamaño exacto ni UA completo. Si la propia telemetría falla, se ignora (fire-and-forget).
- i18n, namespace existente `ine` (no está en `SHELL_NAMESPACES`/`HOME_NAMESPACES`; **no agregarlo**: `layout.messages.test.tsx` lo exige). Claves nuevas (es / en):
  - `ine.pickGallery` «Elegir de galería» / «Choose from gallery»
  - `ine.takePhoto` (existe) «Tomar foto» / «Take photo»
  - `ine.errNetwork` «Sin conexión estable. Revisa tu internet y reintenta.» / «No stable connection. Check your internet and try again.»
  - `ine.errTimeout` «La subida tardó demasiado. Reintenta con mejor señal.» / «The upload took too long. Try again with a better signal.»
  - `ine.errPhotoNotImage`, `ine.errPhotoTooManyPixels`, `ine.errPhotoTooSmall`, `ine.errHeicUnsupported`, `ine.errRateLimited`, `ine.errStorage` = textos de §3 (`errTooLarge` existente con `{max}`=12 MB; `errNotImage` se reescribe a «Selecciona una imagen (JPG, PNG, WebP o HEIC).»)
  - `ine.retrying` «Reintentando… ({n}/3)» / «Retrying… ({n}/3)» (solo `aria-live`).
  - `ine.inAppHint` (solo si `inapp=1`) «Estás en el navegador de otra app. Si falla, abre tcghunt.mx en Safari o Chrome.» / «You're in another app's browser. If it fails, open tcghunt.mx in Safari or Chrome.» (sugerencia no bloqueante).
- Se borran `errNotImage` por `file.type`, el helper de presign y el `PUT` a R2 de `api.ts`.

## 6. Retiro del camino viejo (después del despliegue verde)
1. backend: borrar `POST /uploads/presign` (único propósito era `kyc_ine`), `presign()` y sus DTO; conservar `presignGet`, `headObject` y la compuerta C15. Quitar de `API_CONTRACT.md` la línea presign (ya sustituida).
2. devops: quitar la regla **PUT** del CORS del bucket (dejar vacío o solo lo que otro uso exija) tras comprobar con Cloudflare que ninguna otra función sube desde el navegador.
3. frontend/devops: quitar el origen R2 de `connect-src` (`csp.test.ts:86-92`, `.env.example:808`, `next.config.mjs`) **solo si** nada más lo usa. Verificación obligatoria: el **GET presignado del admin** (`/admin/users/:id/kyc/ine-links`) se abre como enlace/`<img>`: `img-src`/navegación, no `connect-src`; si el admin lo trae con `fetch`, el origen se queda. Frontend mide con grep y lo anota.
4. devops: la política CORS temporal del §9 se borra aquí.

## 7. Pruebas
- **Backend (jest, fixtures reales en `backend/test/fixtures/ine/`)**: JPEG, PNG, WebP, HEIC (iPhone), imagen 48 MP (genera en test con sharp `create`, ≥ 48 M px ⇒ pasa; 70 M px ⇒ `too_many_pixels`), archivo `.jpg` que es PDF/texto (`not_image`), `.png` que es JPEG (pasa; manda la firma), `Content-Type` vacío (pasa), 12 MiB + 1 (413), `sharp` sobre EXIF con GPS: **el objeto guardado no contiene EXIF/GPS** (leer con `sharp().metadata()` y buscar `exif`/segmento APP1 ausente), orientación EXIF 6 ⇒ salida rotada, 4.ª petición concurrente ⇒ `busy`, 21.ª/min ⇒ 429, R2 caído ⇒ 503 sin grant, grant fallido ⇒ objeto borrado, log sin bytes (espía de logger: ninguna cadena contiene el buffer).
- **E2E Playwright real (mocks APAGADOS, stack nativo: API + Postgres + MinIO/s3-local)**: subir fotos reales (JPEG y HEIC/PNG de fixtures) y comprobar `uploadKey`, el objeto en el bucket con `no-store` y la ficha KYC enviada. Proyectos: `chromium` Desktop, `webkit`, `devices['iPhone 14']`, `devices['Pixel 7']` y uno con **UA in-app** (Instagram/FBAN en iOS y `; wv` en Android). Casos por proyecto: «Tomar foto» y «Elegir de galería» (con `setInputFiles`, `type` vacío incluido), fallo de red simulado ⇒ reintento ⇒ éxito, 413 y `PHOTO_INVALID` ⇒ mensaje propio, y que se emita `client-error` con el formato de §5 en fallo. Este E2E es la **única** prueba que habría cazado el bug (los mocks no ejecutan CORS).
- **Humo post-despliegue en producción (devops, `scripts/`, en el job de despliegue)**: con cuenta de pruebas dedicada, `POST /uploads/kyc-ine` con un JPEG mínimo (50 KB, sin PII) ⇒ 201 y `uploadKey`; limpia el objeto/grant; falla el despliegue (alerta) si no. Verifica además `OPTIONS` desde el origen apex.
- Cobertura mínima de `qa` en navegador real móvil (BrowserStack o dispositivo) antes de publicar: NO MEDIDO hoy.

## 8. Infraestructura (devops mide; sin medir no se afirma)
- Railway: límite de cuerpo del proxy y timeout de petición ≥ 12 MiB y ≥ 60 s; medir con subida real de 12 MiB desde red móvil lenta (subida 1 Mbps ≈ 100 s ⇒ el timeout de 60 s del cliente cubre el caso normal ≤ 3 MiB; comprimir en cliente ayuda pero no es requisito). Si Railway corta antes, sube `requestTimeout` de Node (`server.requestTimeout`) y se anota la cifra medida en `STATUS.md`.
- RAM del contenedor con 3 sharp concurrentes de 48 MP: medir pico RSS; si pasa del 60 % del límite, bajar el tope a 2.
- **Dominio canónico = apex `tcghunt.mx`** (`www` responde 308 al apex). Corregir los documentos/config que asumen www como origen: `.env.example` líneas 100, 126, 132 y 165 (`APP_BASE_URL` y «Hoy eso es https://www.tcghunt.mx»), el CORS del bucket y los textos de runbook; `APP_BASE_URL` lista apex primero. (`docs/archive/*` no se toca.) Ni `PROJECT.md` ni `ARCHITECTURE.md` nombran www (grep 2026-11-28).

## 9. Parche temporal (aparte; devops + dueño en Cloudflare; **TEMPORAL, se borra en §6.4**)
Objetivo: que subir funcione HOY, hasta que el arreglo salga. Cloudflare → R2 → bucket de INE → Settings → CORS policy → reemplazar por:
```json
[
  {
    "AllowedOrigins": ["https://tcghunt.mx", "https://www.tcghunt.mx"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "cache-control"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```
Costo para el dueño: ~2 min de clic en Cloudflare (o devops con token si ya lo tiene; sin token de API es excepción manual, regla AUTO). No cubre el problema de webviews que bloquean PUT cross-origin (por eso es parche). Verificar con `OPTIONS` + `curl` del preflight antes y después (devops anota la política viva medida: hoy NO MEDIDA). Si el nombre real del bucket/origen difiere, devops lo toma del `.env` de producción.

## 10. Reparto y criterios de aceptación
| Rol | Entrega |
|---|---|
| `arquitecto` | este contrato, DECISIONES §SUBIDA-INE, línea en `API_CONTRACT.md` (hecho) |
| `devops` | medir libheif/HEVC, body/timeout/RAM en Railway (§2.4, §8); humo post-despliegue; CORS temporal (§9); fix www; retiro de CORS PUT y CSP (§6.2-3) |
| `backend` | endpoint, guards, semáforo, pipeline sharp, grant, log, job de huérfanos, retiro de presign (§1-4, 6.1), tests §7 |
| `frontend` | `uploadKycIne`, `PhotoUploader` (2 botones, reintentos, mensajes, telemetría), i18n es/en, E2E Playwright (§5, 7), CSP si aplica |
| `qa` | E2E en navegador real + matriz móvil/in-app; verifica EXIF ausente y que no hay bytes en logs |
| `seguridad-lead` | revisa PII (§4), límites de DoS (pixel/concurrencia), regresión C14/C15, CSP/CORS final |

Aceptación (todas medibles):
1. Con mocks apagados, subir JPEG/PNG/WebP y `type` vacío ⇒ `uploadKey` y KYC enviado en chromium, webkit, iPhone 14, Pixel 7 y UA in-app (k/N en `STATUS.md`).
2. Foto 48 MP pasa; 70 MP rechaza; EXIF/GPS ausente en el objeto guardado; objeto con `no-store`.
3. HEIC: o se procesa (medición A) o da `heic_unsupported` con su mensaje; nunca error genérico ni archivo crudo.
4. Cada código de §3 muestra su mensaje es/en distinto; los fallos producen `client-error` con el formato de §5 y sin PII.
5. Sin tráfico del navegador hacia R2 (E2E verifica que no hay peticiones a `*.r2.cloudflarestorage.com`).
6. Humo de producción verde tras el despliegue; CORS temporal y PUT retirados; `presign` borrado.
7. Ningún diff toca `schema.prisma` (sin migración) salvo que backend demuestre lo contrario al arquitecto.

## 11. Problema vecino conocido (FUERA de este arreglo; seguimiento)
Los webviews no comparten `localStorage`/cookies con Safari/Chrome: el cliente que abre el enlace desde WhatsApp/Instagram/Facebook llega **sin sesión**, y el acceso con Google puede estar bloqueado (`disallowed_useragent`) en webviews. Esto no impide la subida (con sesión en el webview), pero sí llegar a ella. **No se expande el alcance:** va como seguimiento `KYC-WEBVIEW` (ya cubierto en parte por `ine.inAppHint` del §5, que es solo texto). Opciones para una ronda posterior (decisión del dueño): (a) enlace mágico/código por correo o SMS dentro del webview; (b) «abrir en navegador» con `intent://` / aviso; (c) medir primero cuántos clientes llegan in-app con `inapp=1` de la telemetría y decidir con datos (**medir antes de construir**, O-6).

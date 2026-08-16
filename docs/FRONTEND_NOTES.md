# FRONTEND_NOTES.md — Marketplace TCG con Bóveda

> Propiedad: **frontend**. Decisiones de implementación del cliente Next.js.
> Fecha: 2026-08-13. Branch: `claude/tcg-cards-marketplace-oijthj`.
> El contrato (`docs/API_CONTRACT.md`) y el sistema de diseño (`docs/DESIGN_SYSTEM.md`) mandan.

## A3 subida robusta de INE + D1 alta M1 por set + G1 bóveda por set (2026-08-16)

Tres cambios independientes, solo `frontend/` (+ esta nota). **No** se tocó el contrato ni backend.
Gates verdes: `lint` ✓ · `typecheck` ✓ · `test` **159** (incl. paridad i18n) · `build` ✓.

### A3 — Compresión/normalización de la foto de INE antes de subir (`components/ui/PhotoUploader.tsx`)

Problema: se subía la foto **cruda** del teléfono (a veces >10 MB → el backend la rechazaba con 422 y el
front lo rotulaba MAL como "no es imagen"); iOS envía **HEIC**, que el presign `image/jpeg` no espera.

Fix (solo cliente, sin tocar el flujo backend):
- **Compresión vía canvas** (`compressImage(file)`): carga la imagen (`img.decode()`), escala al **lado
  máximo ~2000px** manteniendo aspecto, y re-exporta con `canvas.toBlob(_, 'image/jpeg', 0.85)`. Esto baja el
  peso y **normaliza HEIC→JPEG**. Se envuelve el Blob en `new File([blob], 'ine.jpg', { type: 'image/jpeg' })`.
  Si el navegador no puede decodificar (p. ej. HEIC en un navegador sin soporte) o `toBlob` da `null`, hace
  **fallback al archivo original** para no bloquear (el backend valida al final).
- **`contentType`/`contentLength` recalculados del BLOB comprimido** (`upload.type` = `image/jpeg`,
  `upload.size`) y pasados a `presignUpload` → **coinciden con lo que se firma** (residuo S-B3). El PUT sube el
  mismo Blob (`uploadToPresignedUrl(presign, upload)`; usa `upload.type` como `Content-Type`).
- **Chequeo de tamaño movido ANTES de `presignUpload`**, sobre el Blob ya comprimido, contra `maxBytes`
  (prop/`DEFAULT_MAX_UPLOAD_BYTES`); el `presign.maxBytes` sigue como fuente de verdad afinada después.
- **Mapeo de error corregido:** `FILE_TOO_LARGE` (413) → `ine.errTooLarge` ("demasiado grande");
  `VALIDATION_ERROR` (no-imagen) → `ine.errNotImage`; resto → `ine.errUpload`. Ya no se rotula tamaño como
  "no es imagen" (además, al enviar siempre `image/jpeg`, el 422 de content-type deja de aparecer).
- **Estado `processing`** nuevo (spinner + label mientras comprime). i18n nueva: **`ine.processing`** (ES/EN).

### D1 — Alta de inventario M1 sobre el catálogo REAL (`app/[locale]/(admin)/admin/m1/M1View.tsx`)

Antes el dropdown "Carta" salía de `mockCards` (import estático, pocas cartas, sin filtro por set). Se
reemplazó por el patrón del cotizador (`BuylistView`):
- Se **eliminó** el import/uso de `mockCards` en el picker. Estado nuevo `setId`/`searchInput`/`searchQuery`/
  `selectedCard: CardDTO | null`. `<Select>` de set (`listBuylistSets`) + `<Input>` de búsqueda + lista de
  resultados `role="listbox"` (`searchBuylistCards`, `useQuery` gated por `hasSearch`), con `QueryState`
  (loading/error/empty). Ambos endpoints son `@Public()` y usables desde admin (contrato §6).
- `selectedCard`/`availableFinishes` se derivan del **`CardDTO` real** elegido (no de fixtures). El resto del
  formulario (acabado v1.6, tipo, graded/sealed, ubicación, tipo de adquisición, %) **no cambió**.
- **Botón "Crear" cableado** a `createInventoryItem` (nueva en `lib/api.ts`, con rama real
  `POST /admin/inventory/items` y rama **mock** marcada), pasando `cardId: selectedCard.id` + los campos del
  form. `useMutation` con `loading`, deshabilitado si `!selectedCard`/cert faltante, invalida
  `['admin-inventory']` al éxito y muestra `admin.m1.createError` en fallo.
- i18n nueva en `admin.m1` (ES/EN): `filterBySet`, `allSets`, `searchCards`, `searchPlaceholder`,
  `searchAction`, `searchResults`, `noResults`, `selectedCard`, `chooseCardFirst`, `createError`.

### G1 — Bóveda del cliente por set + valor por set (`app/[locale]/(storefront)/vault/VaultView.tsx`)

`HoldingDTO.card` expone **`setId` y `setName`**, así que se agrupa por **`setId`** sin ambigüedad (no hizo
falta agrupar por `setName` ni inventar campos). Todo client-side; el portafolio ya trae `referenceValue`.
- **Filtro por set** (`<Select>` poblado con los sets **distinct presentes en los holdings**, opción "Todos")
  que filtra la lista. Estado `setFilter`.
- **Valor por set**: panel de desglose que suma `referenceValue.referenceMxnCents` por set (los pendientes sin
  valor no aportan), con `formatMoneyCents`. **Total del subconjunto filtrado** mostrado junto al filtro.
- **Decisión de presentación:** se optó por **filtro + desglose de valor por set** manteniendo la **lista plana
  que respeta el orden del control "Ordenar por"** (el contrato/tarea permite "filtro **y/o** agrupada"). Se
  evitó forzar el agrupamiento visual del grid porque re-ordenaría las cartas por set y rompería la semántica
  del sort por valor (y los tests `VaultView.test.tsx` que verifican ese orden). Así se cumplen los tres datos
  pedidos (filtro por set, valor por set, total filtrado) sin colisionar con el ordenamiento existente.
- i18n nueva en `vault` (ES/EN): `setFilter.label`, `setFilter.all`, `valueBySet`, `filteredTotal`, `setCount`.

Sin solicitudes al arquitecto: los tres cambios caben en el contrato v1.6 actual (uploads `kyc_ine`,
`/buylist/sets` + `/buylist/cards`, `POST /admin/inventory/items`, `/vault/holdings`).

## C1 idioma por defecto ES + B2 re-sync forzado en M2 (2026-08-16)

Dos cambios independientes, solo `frontend/` (+ esta nota). **No** se tocó el contrato ni backend.
Gates verdes: `lint` ✓ · `typecheck` ✓ · `test` **159** (incl. paridad i18n + tests nuevos) · `build` ✓.

### C1 — Español como idioma por defecto SIEMPRE (aunque el navegador esté en inglés)

Diagnóstico: `defaultLocale` **ya** era `'es'` en `src/i18n/routing.ts`, pero next-intl v4 trae
`localeDetection: true` por defecto, así que el middleware detectaba el idioma por el header
`accept-language` **y** por la cookie `NEXT_LOCALE`. Un navegador en `en-US` que abría `/` era
redirigido a `/en`. Ese era el comportamiento no deseado.

Fix (un solo archivo de routing):
- **`src/i18n/routing.ts`** — se añadió **`localeDetection: false`** a `defineRouting`. Según los tipos de
  next-intl v4 (`RoutingConfig.localeDetection`), esto hace que el middleware **deje de usar** el header
  `accept-language` **y** la cookie para detectar el idioma. Con `localePrefix: 'always'` + `defaultLocale:
  'es'`, la ruta raíz `/` y cualquier ruta sin prefijo resuelven a **`/es`** de forma determinista,
  independientemente del idioma del navegador.
- **`src/middleware.ts`** — **sin cambios**: ya delega en `routing` vía `createMiddleware(routing)`, por lo
  que hereda `localeDetection: false`. No hizo falta pasar opciones extra al middleware.
- **`src/i18n/request.ts`** — **sin cambios**: ya cae a `routing.defaultLocale` ('es') cuando el locale
  entrante es inválido/ausente.
- **`src/lib/config.ts`** — **ya** alineado: `defaultLocale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'es'`.
  **Valor esperado del env:** `NEXT_PUBLIC_DEFAULT_LOCALE=es` (y su par server-side `DEFAULT_LOCALE=es`).
  Verificado que `.env.example`, `docker-compose*.yml`, `Dockerfile.frontend` y los workflows de CI ya lo
  fijan en `es` (esos archivos son de devops; aquí solo se documenta el valor esperado). **En Vercel/deploy
  la variable `NEXT_PUBLIC_DEFAULT_LOCALE` debe valer `es`.**
- **Selector de idioma (`src/components/ui/LocaleToggle.tsx`)** — **sin cambios**: ya es un segmented control
  ES|EN que refleja el locale activo (`useLocale`, `aria-pressed`) y alterna con
  `router.replace(pathname, { locale })`. Con `localePrefix:'always'`, picar EN navega a `/en` y picar ES
  vuelve a `/es`, preservando la ruta. El estado activo (ES por defecto) se ve reflejado al arrancar.

Cómo se verificó:
- **Test nuevo `src/i18n/routing.test.ts`** (4 casos): `defaultLocale==='es'`, `locales==['es','en']`,
  `localePrefix` modo `'always'`, y **`routing.localeDetection===false`** (documenta que la raíz resuelve a
  `/es` aunque el navegador esté en inglés).
- **`build`** prerenderiza cada ruta en `/es` y `/en`; el `Middleware` (45.9 kB) compila con el routing nuevo.
- Comportamiento efectivo: con detección desactivada, la única forma de llegar a EN es el **switch explícito**
  del usuario (o entrar directo a una URL `/en/...`), que es justo lo pedido.

### B2 — Botón "Re-sincronizar todo (forzar)" en el admin M2

Contrato §M2 (v1.6-finish): `POST /admin/catalog/sync-all` gana **`force?: boolean = false`**. `force=true`
**no filtra** los sets ya importados y reprocesa TODO el catálogo para repoblar `availableFinishes`/precios
por acabado tras M-18. Aditivo y retrocompatible.

- **`src/lib/api.ts` · `syncAllCatalog`** — extendida con `input: { force?: boolean } = {}`. En rama real, el
  body solo incluye `{ force: true }` cuando se pide forzar (omitirlo preserva el body vacío previo →
  retrocompatible). La rama mock, con `force=true`, encola **todos** los sets (no solo los no importados).
- **`src/app/[locale]/(admin)/admin/m2/M2View.tsx`** — nuevo botón **"Re-sincronizar todo (forzar)"** junto a
  los de sync existentes, con `RefreshCw`. Reusa el patrón de mutación/feedback ya presente: mutación
  dedicada `syncAllForceMutation`, banners `info` (corriendo) / `success` (encolado con `setsQueued`) /
  `danger` (error real con `getError`) / `warning` (404-405 = endpoint aún no en backend, vía
  `isEndpointMissing`). Por ser **operación pesada**, el botón **no dispara directo**: abre un **modal de
  confirmación** (reusa `<Modal>`) con Cancelar / "Sí, re-sincronizar todo"; solo al confirmar llama
  `syncAllForceMutation.mutate()`. Se mantiene el botón "Sync de todo el catálogo" normal (sin force) intacto.
- **i18n (`messages/{es,en}.json`, namespace `admin.m2.catalog`)** — llaves nuevas con **paridad ES/EN**:
  `syncAllForce`, `syncAllForceRunning`, `syncAllForceDone`, `syncAllForceConfirmTitle`,
  `syncAllForceConfirmBody`, `syncAllForceConfirmCta`. Pasa `i18n-parity`.
- **Tests (`M2View.test.tsx`, +2):** (1) picar el botón abre el modal y **no** llama al endpoint; al confirmar
  se llama `syncAllCatalog({ force: true })` y aparece el banner de éxito; (2) cancelar no llama al endpoint.
  Se ajustó un test previo del sync por set para usar nombre **exacto** `/^(Importar|Re-sincronizar)$/` (el
  nuevo botón "Re-sincronizar todo (forzar)" ya no lo captura por accidente).

### Solicitudes al arquitecto
Ninguna. El contrato v1.6-finish ya define `force` en `POST /admin/catalog/sync-all` (§M2); solo se consumió.


## Acabado / versión de carta (finish) en toda la cadena — v1.6-finish (2026-08-16)

Consumo del contrato **v1.6-finish** (enum `Finish = normal | reverse_holo | holofoil |
first_edition_holofoil`). El monto siempre lo deriva el backend server-side de `(rarity, finish)`
validado contra `Card.availableFinishes` (SEC-A1); el front solo **elige** el acabado y lo manda.

### Archivos tocados (todos dentro de `frontend/`)
- `src/types/contract.ts` — enum `Finish`; `CardDTO.availableFinishes: Finish[]`; `finish: Finish` en
  `ListingDTO`/`HoldingDTO`/`SellItemDTO`; `finish` (req+res) en `BuylistQuoteResponse`; `finishes:
  Finish[]` en `CatalogFacetsDTO`; `finish?` en `InventoryItemDTO` (M1).
- `src/lib/api.ts` — `CatalogFilters.finish` (query `finish` en `GET /catalog/cards`);
  `getBuylistQuote` recibe `finish?`; `CreateSellRequestInput.items[].finish?`. La rama MOCK replica
  el resolver **por acabado** (reverse_holo → "Reverse Holo"; holofoil/1st ed → rareza base si es holo,
  si no "Holo"; normal → rareza base) y una referencia por carta compartida entre acabados.
- `src/lib/mock/fixtures.ts` — `availableFinishes` por carta (`CARD_FINISHES`), `finish` en listings/
  holdings/inventory/sell-items, `finishes` en facetas, helpers `resolveBuylistRuleForFinish` /
  `mockReferenceForFinish`.
- `src/components/domain/FinishBadge.tsx` — **nuevo**: badge del acabado (i18n `finish`); se oculta para
  graded/sealed (siempre `normal`).
- `src/app/[locale]/(storefront)/buylist/BuylistView.tsx` — **selector de acabado** en el cotizador
  (§ abajo) + dedup de carrito por `(cardId, productType, finish)`.
- `src/components/domain/BuylistKycForm.tsx` — `BuylistRequestItem` gana `finish?`.
- `src/components/domain/ShopFilters.tsx` + `CatalogView.tsx` — filtro/faceta de acabado (chips) y chip
  removible activo.
- `src/components/domain/ListingCard.tsx`, `.../vault/VaultView.tsx`, `.../catalog/[cardId]/CardDetailView.tsx`
  — muestran el acabado de cada listing/holding/ejemplar.
- `src/app/[locale]/(admin)/admin/m1/M1View.tsx` — selector de acabado en el alta + columna de acabado.
- `messages/es.json` / `messages/en.json` — namespace `finish` (label + 4 acabados), `buylist.selectFinish`,
  `shop.finish.*`, `admin.m1.finish*` + columna, error `FINISH_NOT_AVAILABLE` (paridad ES/EN).

### Selector de acabado (cotizador)
Tras elegir una carta, un `<Select>` se puebla de `card.availableFinishes` (ordenado por
`FINISH_ORDER`, con etiquetas i18n Normal / Reverse Holo / Holofoil / 1st Edition). El valor viaja en
`getBuylistQuote({…, finish})` y se snapshotea en la línea del carrito y en los `items` de
`createSellRequest`. **Se muestra solo cuando** `productType==='raw'` **y** hay `>1` acabado
disponible; si la carta es `["normal"]` (o graded/sealed), queda fijo en `normal` y el selector se
oculta. La cotización muestra la **regla aplicada por acabado** (`appliedRule` que ecoa el quote) y un
`FinishBadge` con el acabado resuelto. El acabado **autoritativo** usado en el carrito es el que
**ecoa la respuesta del quote** (`quote.data.finish`), no el estado local.

### Dedup del carrito (hallazgo MENOR de QA #a)
La **identidad de línea** ahora es `(cardId + productType + finish)`. `addToCart` busca una línea
existente con esa clave: si existe, **incrementa la cantidad**; si no, crea una línea nueva. Así, la
misma carta en el mismo acabado suma cantidad (sin duplicar), y la misma carta en **acabado distinto**
es una **línea separada**. Cubierto por tests de dedup en `BuylistView.test.tsx`.

### a11y de botones (hallazgo MENOR de QA #b)
Las dos etiquetas "Enviar solicitud" se distinguen: el **CTA del carrito** es "Enviar solicitud
({count})" (abre el modal de KYC) y el **submit del modal KYC** pasó a "Confirmar y enviar"
(`buylist.submit`). Etiquetas visibles y accesibles distintas, sin ambigüedad para lector de pantalla.

### Solicitudes al arquitecto
- Ninguna. El contrato v1.6-finish cubre todo lo consumido. El mock del front asume que **una carta
  comparte la misma referencia de mercado entre acabados** (simplificación de demo); el backend real
  guarda una `PriceReference` **por acabado** — la UI no depende de esa distinción numérica.

### Gates (todos verdes)
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` (153) ✓ · `npm run build` ✓ (incluye paridad i18n ES/EN).

## Cotizador de buylist como CARRITO (varias cartas en una solicitud) — 2026-08-16

Feature **solo frontend** (sin cambio de contrato). El cotizador dejó de ser un flujo de
una-carta-a-la-vez y ahora es un **carrito**: se cotizan varias cartas y se envían en **una sola**
`POST /buylist/requests` (que ya recibía `items: RequestItemDto[]`). No se inventó ningún endpoint
batch: `POST /buylist/quote` sigue siendo **por carta** y sus resultados son **estimados** que se
snapshotean en cada línea; el monto autoritativo lo re-deriva el backend server-side (SEC-A1).

### Archivos tocados (todos dentro de `frontend/`)
- `src/app/[locale]/(storefront)/buylist/BuylistView.tsx` — reescrito: estado de carrito + panel de
  carrito + total estimado + envío único.
- `src/components/domain/BuylistKycForm.tsx` — props cambiadas de `{cardId, productType}` a
  `{items: BuylistRequestItem[]}`; el form ahora envía **todos** los items del carrito (ya
  expandidos). Nuevo tipo exportado `BuylistRequestItem = {cardId, productType, rawCondition?}`.
- `messages/es.json` / `messages/en.json` — llaves nuevas del carrito (paridad ES/EN).
- Tests: `BuylistView.test.tsx` (agrega casos de carrito), `BuylistKycForm.test.tsx` (props `items`),
  `e2e/buylist.spec.ts` (flujo cotizar → agregar al carrito → enviar).

### Flujo del carrito (pasos + UI)
1. **Buscar** por set y/o texto sobre TODO el catálogo (`GET /buylist/cards`, `GET /buylist/sets`).
2. **Elegir carta** de los resultados (`role=option`).
3. **Elegir tipo** (`raw|graded|sealed`; raw fija `NM`, sin selector) y **Cotizar**
   (`POST /buylist/quote`, por carta).
4. **Agregar al carrito** (botón `accent`): añade una **línea** con el snapshot del estimado
   (`BuylistQuoteResponse`) y `quantity=1`. Se puede agregar la misma carta varias veces (líneas
   independientes) y/o subir la **cantidad** por línea.
5. **Panel de carrito** (sección full-width bajo el cotizador): lista de líneas (nombre/set/rareza/
   tipo + estimado c/u + control −/N/+ de cantidad + quitar), **Total estimado** (suma
   `quotedPriceCents × cantidad`; las líneas `precio_pendiente` muestran "Precio pendiente" y aportan
   0), **nota de estimado** (SEC-A1) y **nota de KYC**. Carrito vacío → `EmptyState`, sin botón de
   enviar.
6. **Enviar solicitud ({count})** (habilitado con ≥1 línea) abre **una sola vez** el `BuylistKycForm`
   (CLABE + INE por presign `kyc_ine`) y llama `createSellRequest` con todos los items. Al crear:
   limpia el carrito, invalida `['sell-requests']` y muestra el banner de éxito. El requisito de
   INE/tope lo decide el **backend por el TOTAL** (no se reimplementa en el front).

### Expansión cantidad → items
Al enviar, `cart.flatMap(line => Array(line.quantity).fill({cardId, productType, rawCondition}))`
produce el array `items`: una línea con `quantity=3` genera **3 entradas** idénticas (el modelo es
1 item por carta física). El payload solo lleva `cardId/productType/rawCondition`; **no** se envían
precios ni categorías (el `ValidationPipe` descarta lo demás; SEC-A1).

### SEC-A1 / claridad
- El total del carrito se rotula explícitamente como **ESTIMADO** (`buylist.estimateNote`): "el monto
  final lo confirma la plataforma al recibir y verificar".
- No se envía monto/categoría/rareza en el payload; el backend re-deriva la regla de `Card.rarity`.

### Historial de "mis solicitudes"
Intacto: sigue consumiendo `GET /buylist/requests` y renderizando `PipelineStepper` + items con sus
`StatusBadge`. Solo se invalida su query tras crear una solicitud.

### Gates (frontend/)
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` ✓ (144/144, incluye paridad i18n y los
casos nuevos de carrito: agregar, quitar, cantidad, total, envío con múltiples items) ·
`npm run build` ✓.

### Solicitudes al arquitecto
Ninguna. El contrato ya soportaba múltiples ítems en `POST /buylist/requests`; no hizo falta ningún
campo/endpoint nuevo.

## v1.5-auth-email — Verificación de correo + recuperación self-service (2026-08-16)

Implementación del changelog `v1.5-auth-email` del contrato (§1). Verificar el correo **NO** bloquea
login/navegación; **sí** bloquea acciones sensibles (el backend responde `403 EMAIL_NOT_VERIFIED` al
comprar/vender/retirar). Recuperación por email self-service **además** del reset por admin (M6). El
reenvío de verificación es **autenticado**. Solo se tocó `frontend/`.

### Endpoints consumidos (shapes exactos del contrato §1)
- `POST /auth/verify-email` `{token}` → `{verified:true}` (422 `EMAIL_VERIFY_TOKEN_INVALID`) — `verifyEmail(token)`.
- `POST /auth/verify-email/resend` (autenticado, `{}`) → `{ok:true}` (429 `RATE_LIMITED`) — `resendVerificationEmail()`.
- `POST /auth/forgot-password` `{email}` → **siempre** `{ok:true}` — `forgotPassword(email)`.
- `POST /auth/reset-password` `{token, password}` → `{ok:true}` (422 `RESET_TOKEN_INVALID`, 400 `VALIDATION_ERROR`) — `resetPassword({token,password})`.
- `user` de login/register y `GET /users/me` ahora incluye `emailVerified` (ya estaba tipado opcional en `UserDTO`).

### Tipos (`types/contract.ts`)
Añadidos `VerifyEmailResponse`, `ResendVerificationResponse`, `ForgotPasswordResponse`,
`ResetPasswordSelfResponse` (este último NO se llama `ResetPasswordResponse` para no chocar con el ya
existente del reset por admin de M6). `UserDTO.emailVerified` ya existía.

### Pantallas y componentes (rutas nuevas, grupo `(auth)` → URL `/[locale]/…`)
- **`/[locale]/verify-email`** (`(auth)/verify-email/`): la `page` (server) lee `?token=` y lo pasa a
  `VerifyEmailView` (client). Al montar, si hay token, llama `verifyEmail`. Estados: *verificando* →
  *éxito* (banner success "Correo verificado" + link a la tienda) / *inválido* (banner danger, 422). En
  el estado inválido, si hay sesión ofrece **Reenviar** (autenticado); sin sesión invita a iniciar
  sesión. Un `useRef` evita la doble verificación de StrictMode. En éxito, `verifyEmail` hace
  `patchStoredUser({emailVerified:true})` para quitar el banner sin re-consultar `/users/me`.
- **`/[locale]/reset-password`** (`(auth)/reset-password/`): `page` lee `?token=`, `ResetPasswordView`
  es el formulario (nueva contraseña + confirmación). **Política de fuerza igual al registro**: MinLength
  8 (contrato) validado en cliente + confirmación que debe coincidir. Éxito → mensaje + link a login (el
  backend revoca sesiones; el usuario re-inicia sesión, por eso el endpoint no devuelve tokens). `422
  RESET_TOKEN_INVALID` → estado "enlace inválido/expirado" con CTA a **forgot-password**.
- **`/[locale]/forgot-password`** (`(auth)/forgot-password/`): input de email → `forgotPassword` →
  **siempre** el mismo mensaje genérico ("si el correo existe, te enviamos instrucciones"), respetando
  anti-enumeración. Único caso distinto: `429 RATE_LIMITED` (aviso de reintento); cualquier otro error se
  trata también como "enviado" para no filtrar señal. Enlazada desde el login ("¿Olvidaste tu
  contraseña?", solo en modo login de `AuthForm`).
- **Banner "verifica tu correo"** (`components/domain/VerifyEmailBanner.tsx`): montado en el shell de la
  tienda (`(storefront)/layout.tsx`) bajo el header. Persistente (no dismissible) mientras el usuario
  logueado tenga `emailVerified===false`; usa `useSession` (con `ready` para evitar mismatch de
  hidratación). Variante `warning` (no bloquea navegación). CTA "Reenviar correo de verificación" →
  `resendVerificationEmail`, con feedback ("correo enviado" / rate-limit / error).
- **Aviso de 403** (`components/domain/EmailNotVerifiedNotice.tsx`): banner `danger` reutilizable con CTA
  de reenvío para el caso `403 EMAIL_NOT_VERIFIED`.
- **Hook compartido** (`hooks/useResendVerification.ts`): centraliza el reenvío + estados
  (`idle|sending|sent|rateLimited|error`) que usan el banner y el aviso de 403.

### Manejo de `403 EMAIL_NOT_VERIFIED`
Centralizado en el componente `EmailNotVerifiedNotice` (mensaje claro + CTA de reenvío) en vez de un
error genérico. Cableado en el **paso real de venta** (`BuylistKycForm` → `POST /buylist/requests`): el
`catch` detecta `code === 'EMAIL_NOT_VERIFIED'` y muestra el aviso. La compra (`/checkout/session`) y el
retiro (`/shipments`) siguen **mockeados / pendientes de integración Stripe** (no hay `createCheckoutSession`
/ `createShipment` real todavía); cuando se cablee Stripe, el mismo `EmailNotVerifiedNotice` se reutiliza
en esos `catch` (mismo patrón). El `errorCode` también está traducido (`error.EMAIL_NOT_VERIFIED`) para
cualquier ruta que caiga al `QueryState`/`useErrorMessage` genérico.

### i18n (paridad ES/EN)
Secciones nuevas `verifyEmail`, `forgotPassword`, `resetPassword` + `auth.forgotPassword` +
`error.EMAIL_NOT_VERIFIED` / `error.EMAIL_VERIFY_TOKEN_INVALID` / `error.RESET_TOKEN_INVALID` en
`messages/es.json` y `en.json`. El test de paridad (`lib/i18n-parity.test.ts`) pasa.

### Mocks (modo `NEXT_PUBLIC_USE_MOCKS`)
`verifyEmail`/`resetPassword` simulan el `422` cuando el token está vacío o contiene
`invalid|expired|bad`; en otro caso, éxito. `resendVerificationEmail`/`forgotPassword` devuelven `{ok:true}`.
Marcados `// MOCK: pendiente de backend real`.

### Gates (todos verdes)
`npm run lint` (0 warnings), `npm run typecheck` (ok), `npm run test` (29 archivos, 138 tests, incl.
paridad i18n), `npm run build` (ok; rutas `verify-email`/`reset-password`/`forgot-password` generadas
para es/en). Tests nuevos: `VerifyEmailView.test`, `ResetPasswordView.test`, `ForgotPasswordView.test`
(cubre anti-enumeración), `VerifyEmailBanner.test`.

### Solicitudes al arquitecto
Ninguna: los cuatro endpoints y sus shapes están cerrados en el contrato §1. Nota de seguimiento (no
bloqueante): cuando se integre Stripe para `/checkout/session` y `/shipments`, cablear el mismo
`EmailNotVerifiedNotice` en sus `catch` (hoy esas dos acciones están mockeadas).

## v1.4-finance FIX — alinear el P&L de M7 al shape de 6 claves (2026-08-16)

Corrección de RECHAZO de qa/techlead: la ronda previa renombró el P&L solo en la captura (M4) pero
dejó ROTO el consumidor real, **`M7View`** (está montado en `m7/page.tsx` y consume el endpoint real
`GET /admin/finance/pnl`; NO es un stub — la nota previa que decía "ModuleTodo/stub" era incorrecta).
Contrato §M7 ya define el shape nuevo y el backend ya lo devuelve; esto solo espeja el front (sin tocar
el contrato).

Shape del contrato §M7 (6 claves):
`{ incomeCents, shippingRevenueCents, cogsCents, stripeFeesCents, shippingCostCents, profitCents }`
con `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`.

Cambios (solo `frontend/`):
- **`types/contract.ts` · `PnlDTO`**: `shippingCents`→`shippingRevenueCents` y **añade**
  `shippingCostCents: number`. Idéntico al contrato de 6 claves.
- **`m7/M7View.tsx`**: el desglose del P&L ahora pinta 5 líneas + total:
  - `+ Ingresos (ventas)` = `incomeCents`
  - `+ Ingreso por envío (cobrado)` = `shippingRevenueCents` (antes `shipping`/`shippingCents`)
  - `− Costo de lo vendido` = `cogsCents`
  - `− Comisiones Stripe` = `stripeFeesCents`
  - `− Costo de envío (paquetería)` = `shippingCostCents` (**NUEVA** línea, resta, mismo `PnlLine`/patrón)
  - `= Ganancia del periodo` = `profitCents` (el desglose cuadra con `profitCents`).
- **i18n `admin.m7.pnl`** (es/en, paridad): la llave `shipping` se renombró a `shippingRevenue`
  ("Ingreso por envío (cobrado)" / "Shipping revenue (collected)") y se añadió `shippingCost`
  ("Costo de envío (paquetería)" / "Shipping cost (carrier)"). También se ajustó `formula`.
- **`lib/mock/fixtures.ts`**: `mockPnl` y `mockCsv` al shape de 6 claves. `shippingCostCents = 31_800`
  ejemplo; profit mock = 1_250_000 + 52_500 − 640_000 − 48_300 − 31_800 = **582_400** cts (MX$5,824.00).
- **Tests**: `M7View.test.tsx` actualizado (nuevo profit + assert de las líneas de envío ingreso/costo);
  nuevo `m4/pesosToCents.test.ts` (vacío/0/decimal/miles/negativo/no-numérico). `pesosToCents` se
  **exportó** desde `M4View.tsx` para poder testearlo.

### M4 `openTracking` (5a) — NO precargable hoy: requiere campo nuevo en el DTO admin
Se intentó precargar el costo ya capturado al reabrir el modal de captura de guía. **`ShipmentDTO`
(`types/contract.ts`) NO expone `shippingCostCents`**, y el contrato de `GET /admin/shipments` /
`GET /admin/shipments/:id` (§M4, líneas 586-587) tampoco lo define en el response. Por la regla de no
inventar campos, `openTracking` se dejó como está (el input arranca en `''` al reabrir).
**Solicitud al arquitecto/backend:** exponer `shippingCostCents` (costo interno, entero ≥ 0) en el
`ShipmentDTO` **del listado/detalle admin** (`GET /admin/shipments` y `/:id`) — NO en el `GET
/shipments/:id` del comprador (§M4 línea 588 lo marca como interno, no expuesto al cliente). Con ese
campo, `openTracking` precargaría `s.shippingCostCents` para que el operador vea el valor vigente al editar.

Gates: lint ✓ · typecheck ✓ · test (123, incl. paridad i18n) ✓ · build ✓.

## v1.4-finance — costo real de paquetería en la captura de guía de M4 (2026-08-16)

Contrato: `POST /admin/shipments/:id/tracking` gana `shippingCostCents?` (opcional, entero ≥ 0,
centavos MXN = costo real que la plataforma paga a la paquetería). Ver API_CONTRACT §M4.

Cambios (solo `frontend/`):
- **`M4View.tsx`**: se añadió el **formulario de captura de guía** (antes M4 era solo lectura). Cada
  envío no `cancelado` muestra un botón "Capturar guía" que abre un `Modal` con tres campos: paquetería
  (`carrier`), número de guía (`trackingNumber`) y **"Costo de envío (paquetería)"** (`shippingCostCents`).
  El costo se captura **en pesos** (prefix `MX$`, `inputMode="decimal"`) y se convierte a centavos con
  `pesosToCents` (`Math.round(n*100)`), igual patrón que M2. Es **opcional**: vacío → no se envía la clave.
  Validación **≥ 0** (bloquea el submit y marca el input con error si es negativo o no numérico). Muestra
  el equivalente formateado en centavos y un `Banner` de error en fallo de la mutación.
- **`lib/api.ts`**: nueva `saveShipmentTracking(shipmentId, ShipmentTrackingRequest)` → `POST
  /admin/shipments/:id/tracking`. `shippingCostCents` solo se incluye en el body cuando el operador lo
  captura. Mock actualiza el envío en memoria y lo avanza a `guia`.
- **`types/contract.ts`**: nuevo `ShipmentTrackingRequest = { carrier, trackingNumber, shippingCostCents? }`.
- **i18n**: `admin.m4.tracking.*` (capture/title/carrierLabel/numberLabel/shippingCostLabel/
  shippingCostHint/shippingCostInvalid/save) en `es.json` y `en.json` con paridad.
- **M7 P&L**: NO se tocó (sigue `ModuleTodo`/stub sin consumidores; el nuevo shape de P&L
  —`shippingRevenueCents`/`shippingCostCents`— se consumirá cuando se construya M7).

Gates: lint ✓ · typecheck ✓ · test (116, incl. paridad i18n) ✓ · build ✓.

## Mejoras UX — presets de rango en M7/M9 + orden de la bóveda (2026-08-16)

Tres mejoras chicas e independientes. Solo `frontend/` (+ esta nota). **No** se tocó el contrato ni el
backend. Todo en cliente sobre datos que ya trae la API. i18n ES/EN espejado (pasa `i18n-parity`). Gates
desde `frontend/`: `lint` OK · `typecheck` OK · `test` **116/116** (24 archivos, +3 nuevos) · `build` OK.

### 1. Presets de rango en M7 (Finanzas) y M9 (Reportes)
- Nuevo helper puro `src/lib/dateRange.ts` → `presetRange(preset, now?)` devuelve `{ from, to }` como
  `YYYY-MM-DD` (hora **local**, sin corrimiento por TZ). Presets: `week` = lunes de la semana actual (ISO) →
  hoy; `month` = mismo día del mes anterior → hoy (ventana rodante ~1 mes); `quarter` = primer día del
  trimestre actual → hoy; `year` = 1-ene del año actual → hoy. `to` siempre = hoy.
- Nuevo componente `src/components/domain/DateRangePresets.tsx` (4 botones `ghost`, `role="group"`) que al
  hacer click llama `onSelect({from,to})`. Reutilizado por M7 y M9.
- **M7** (`m7/M7View.tsx`): se montó `DateRangePresets` en la sección de rango, **sobre** el selector manual
  (que se conserva). Al elegir preset se setean `from`/`to`, y las queries que ya dependen del `range`
  (`GET /admin/finance/pnl`, `GET /admin/finance/iva`) refetchean por su `queryKey`.
- **M9** (`m9/M9View.tsx`): **sí aplica** — M9 ya tenía rango `from`/`to` para `GET
  /admin/reports/launch-metrics` y el export CSV. Se añadieron los mismos presets, misma mecánica.

### 2. Bóveda — orden por set y por valor (`(storefront)/vault/VaultView.tsx`)
- Control `Select` "Ordenar por" con: **Predeterminado** (orden del backend), **Set (A–Z)** (`card.setName`,
  desempate por `card.name`), **Valor (mayor a menor)** y **Valor (menor a mayor)**.
- El valor por carta **sí está** en `HoldingDTO`: `referenceValue.referenceMxnCents` (el valor de referencia
  de mercado del holding, contrato §3). Se ordena en cliente sobre `query.data.data` con `useMemo`. Las
  cartas con **precio pendiente** (`referenceValue.status="pending"`, sin `referenceMxnCents`) quedan
  **siempre al final** en ambos sentidos (asc y desc), no rompen el orden.

### Archivos tocados
- Nuevos: `src/lib/dateRange.ts`, `src/lib/dateRange.test.ts`,
  `src/components/domain/DateRangePresets.tsx`,
  `src/app/[locale]/(storefront)/vault/VaultView.test.tsx`.
- Editados: `m7/M7View.tsx`, `m9/M9View.tsx`, `vault/VaultView.tsx`, `m7/M7View.test.tsx` (+test de presets),
  `messages/{es,en}.json`.
- i18n nuevas (ES/EN): `common.datePresets.{label,week,month,quarter,year}`,
  `vault.sort.{label,default,set,valueDesc,valueAsc}`.

### Tests añadidos
- `dateRange.test.ts` (5): los 4 presets con fecha fija (jueves 2026-08-13) + semana ISO desde domingo.
- `M7View.test.tsx`: click en "Este año"/"Último mes" setea `from`/`to` (comparado contra `presetRange`).
- `VaultView.test.tsx` (4): orden por defecto, valor desc/asc (pendiente al final) y por set (desempate por
  nombre de carta), verificando el orden de los nombres en el DOM.

### Solicitudes al arquitecto
- Ninguna. Todo se resolvió con campos ya presentes en el contrato (`HoldingDTO.referenceValue`,
  `CardDTO.setName`, `from`/`to` de M7/M9). No hubo que inventar endpoints ni campos.

## v1.3.1 — precio de buylist por rareza + cotizador nuevo shape + M6 reset/eliminar (2026-08-16)

Consumo de los bloques del contrato **v1.3.1 §E.1 (precios por rareza)** y **§M6 (reset/eliminar
usuario)**. Solo `frontend/` (+ esta nota). **No** se tocó el contrato. Toggle de mocks intacto (rama real
`apiRequest` + rama mock) e i18n ES/EN espejado. Gates desde `frontend/`: `lint` OK · `typecheck` OK ·
`test` **106/106** (22 archivos, +9 nuevos) · `build` OK.

### 1. Editor de precio de buylist por RAREZA en M2 (`/admin/m2`, super_admin)
- **Reemplaza** la sección "rareza→categoría" (deprecada por el contrato) por un editor **una fila por
  rareza** que consume `GET /admin/pricing/rarities` (rarezas distintas del catálogo unidas a las reglas,
  con `cardCount` + `source` rule/fallback) y guarda con `PUT /admin/pricing/buylist-rules`.
- Cada fila: **selector de modo `fixed|pct`** + **campo de valor** (si `fixed` → MX$ en pesos↔centavos con
  prefijo `MX$`; si `pct` → % con sufijo `%`) + badge de origen (Regla/Fallback). Encima, un **campo de
  fallback %** para rarezas sin regla explícita.
- **Guardado sin redeploy**: el `PUT` envía `{ rules, fallbackPct }` preservando las reglas explícitas del
  servidor y aplicando el borrador encima; una rareza dejada en fallback (no editada) **no** se incluye
  (sigue en fallback); editar una fila de fallback la **promueve** a regla explícita. Loading/error/success
  con `Banner` (patrón M2).
- Se retiró de la UI el uso de `getRarityMap/updateRarityMap` (siguen en `api.ts`/fixtures como legacy
  deprecado); el editor nuevo NO los consume.

### 2. Cotizador y detalle de buylist — nuevo shape `rarity` + `appliedRule`
- `BuylistQuoteResponse` y `SellItemDTO` (`types/contract.ts`) ahora exponen **`rarity`** + **`appliedRule`
  = { mode, value, source }** en vez de `category`. `POST /buylist/requests` ya **no** envía `category`
  (`CreateSellRequestInput.items` sin `category`; el backend deriva la regla server-side de `Card.rarity`).
- `BuylistView` muestra al usuario la **rareza oficial** y la **regla aplicada legible**: `"$1.50 fijo"`
  (`ruleFixed`) o `"40% de referencia"` (`rulePct`). `BuylistKycForm` dejó de recibir/enviar `category`.
- Mock del cotizador (`api.ts`) reescrito para resolver por **regla de rareza** vía
  `fx.resolveBuylistRule()`: `fixed` cotiza sin referencia; `pct` cotiza `% de la referencia` o cae a
  `precio_pendiente` si falta; rareza sin regla → **fallback 40%**. El seed preserva el negocio vigente
  (Common/Uncommon $0.50 fijo, Reverse Holo $1.50 fijo, resto 40%).

### 3. M6 — reset de contraseña y eliminar usuario (super_admin)
- **Reset:** botón en la ficha 360° → `POST /admin/users/:id/reset-password` → modal que muestra la
  **temp password EN CLARO UNA sola vez** (bloque `code` + botón **Copiar**), con aviso de "una sola vez",
  nota para compartirla por canal seguro y nota de `mustChangePassword`. Al cerrar el modal **no** se
  re-muestra (estado local `resetResult` se limpia; también se limpia al cambiar de usuario).
- **Eliminar:** botón `destructive` con **modal de confirmación clara** → `DELETE /admin/users/:id` →
  muestra el **resultado `mode`**: `hard` = "borrado total" / `soft` = "anonimizado, conserva historial".
  Maneja **`409 CANNOT_DELETE_SELF`** (banner de error específico) y **deshabilita** el botón cuando
  `useSession().user.id === selectedId` (no borrarse a uno mismo). Nuevo valor de estado `deleted` en el
  badge de usuario (`UserStatusBadge`); las acciones de cuenta se ocultan para cuentas ya `deleted`.
- **`mustChangePassword`:** `UserDTO.mustChangePassword?`. Tras un login que lo indique, `AuthForm` muestra
  un **aviso** (`Banner` warning) con botón "Continuar" que enruta al destino por rol (no hay página
  dedicada de cambio de contraseña en el MVP; ver solicitud al arquitecto).

### Archivos
- **Tipos** `src/types/contract.ts`: +`BuylistRuleMode`, `BuylistRule`, `BuylistRuleApplied`,
  `BuylistRulesDTO`, `BuylistRarityRowDTO`, `BuylistRaritiesResponse`, `AdminUserStatus`,
  `ResetPasswordResponse`, `DeleteUserResponse`; `BuylistQuoteResponse`/`SellItemDTO` re-shaped;
  `UserDTO.mustChangePassword?`; `AdminUserSummaryDTO.status` incluye `deleted`.
- **API** `src/lib/api.ts`: +`getBuylistRarities`, `getBuylistRules`, `updateBuylistRules`,
  `resetUserPassword`, `deleteUser`; `getBuylistQuote`/`createSellRequest` re-shaped (sin `category`).
- **Fixtures** `src/lib/mock/fixtures.ts`: +`mockBuylistRules`, `mockBuylistFallbackPct`,
  `setMockBuylistRules`, `resolveBuylistRule`, `mockBuylistRarities`; `mockSellRequests` re-shaped.
- **UI** `m2/M2View.tsx` (editor por rareza), `buylist/BuylistView.tsx`, `BuylistKycForm.tsx`,
  `m6/M6View.tsx` (reset/eliminar), `AuthForm.tsx` (mustChangePassword), `components/ui/Input.tsx`
  (soporte `suffix`).
- **i18n** `messages/{es,en}.json`: +`buylist.{rarityLabel,appliedRuleLabel,ruleFixed,rulePct}`,
  `admin.m2.buylistRules.*`, `admin.m6.{deleted,accountTitle,reset*,tempPassword,copy,copied,delete*}`,
  `auth.{mustChangePassword,mustChangeContinue}`.
- **Tests** (+9): `M2View.test.tsx` (editor rareza: render, fixed→centavos+guardar, fallback, promoción de
  modo), `M6View.test.tsx` (reset una-sola-vez, delete confirm+mode hard, 409 self), `api.test.ts`
  (fixed/pct/fallback), `BuylistView.test.tsx`/`BuylistKycForm.test.tsx` re-shaped, `e2e/buylist.spec.ts`
  actualizado a `appliedRule`.

### Endpoints consumidos
- M2: `GET /admin/pricing/rarities`, `GET/PUT /admin/pricing/buylist-rules` (rama real + mock).
- Buylist: `POST /buylist/quote` (nuevo shape), `POST /buylist/requests` (sin `category`).
- M6: `POST /admin/users/:id/reset-password`, `DELETE /admin/users/:id`.

### Supuestos / solicitudes al arquitecto
1. **`mustChangePassword`** — el contrato lo declara opcional (flag del backend) y no fija una página de
   cambio de contraseña. La UI muestra un **aviso** tras el login y enruta por rol. **Solicitud**: si se
   desea forzar el cambio, definir endpoint/página de cambio de contraseña (`POST /users/me/password`?);
   hoy no existe y no bloquea.
2. **`GET /admin/pricing/rarities`** — se consume `{ fallbackPct, rarities:[{ rarity, cardCount, rule,
   source }] }` tal cual el contrato §M2. El `PUT /buylist-rules` recibe la tabla completa `{ rules,
   fallbackPct }`; el front preserva las reglas explícitas y sólo promueve a explícitas las filas editadas.
3. **`DELETE /admin/users/:id`** — se asume 200 `{ userId, mode }` y `409 CANNOT_DELETE_SELF`; el front
   también deshabilita el botón para la cuenta propia (`useSession`). Sin cuerpo en el request.
4. El editor de rareza **reemplaza** la UI de `rarity-map` (deprecado v1.3.1). Las funciones/fixtures
   `getRarityMap/updateRarityMap/mockRarityMap` quedan como legacy sin uso en UI.

## Fix bug reportado — feedback visible en el sync de catálogo de M2 (2026-08-16)

Bug del humano: en `/admin/m2` (Sección 5, "Sync de catálogo") los botones **Backfill**,
**Import/Re-sincronizar** (por set) y **Sync de todo el catálogo** "no hacían nada" al hacer clic.
Causa raíz: las mutaciones solo tenían `onSuccess` (invalidaban `remote-sets`); **sin manejo de
error ni feedback**. Cuando el backend fallaba (rate limit de pokemontcg.io sin API key, timeout del
sync síncrono, 5xx) el botón salía de `loading` y no aparecía nada → parecía inerte. Solo `frontend/`
(+ esta nota). **No** se tocó el contrato ni el backend; es puro feedback de UI con el patrón de
Banners/`errorCodes` ya usado.

### Qué se hizo (`m2/M2View.tsx`)
- **Helper de error:** se importa `useErrorMessage` de `QueryState` (`getError`) — mapea el `code` del
  `ApiClientError` a copy localizado (`error.<CODE>`, fallback `common.errorGeneric`), mismo patrón que
  el resto de la app.
- **Sync por set (Importar/Re-sincronizar), `catalogSyncMutation`:** antes SIN feedback. Ahora:
  Banner `info` mientras `isPending` (aviso "sincronizando… puede tardar"), Banner `success` con el
  resultado del backend (`syncDone`: "Sync encolado: N set(s) (job …)"), y Banner `danger` (`role=alert`,
  con título + `getError`) al fallar. Esta era la causa principal del "no hace nada".
- **Backfill, `backfillMutation`:** tenía success, **le faltaba el error** → se añadió Banner `danger`
  con `getError`.
- **Sync total, `syncAllMutation`:** mantiene success. El error ahora **distingue**: un **404/405**
  (endpoint aún no existe en backend, contrato v1.3 condicional) conserva el aviso `warning` "no
  disponible"; **cualquier otro error real** (rate limit, timeout, 5xx) muestra Banner `danger` con el
  código/mensaje (antes CUALQUIER fallo se tragaba como "no disponible", ocultando errores reales).
  Helper local `isEndpointMissing()` (status 404/405 del `ApiClientError`).
- **Hint de sincronía:** texto bajo el subtítulo (`catalog.syncHint`) avisando que import/resync/backfill
  corren **síncronos**, pueden tardar y el resultado aparece al terminar.
- **Alineación del resto de mutaciones de M2** (tenían feedback parcial o nulo):
  - **Sync de precios** (`syncMutation`): ya tenía banners; su error genérico (`errorGeneric`) se cambió
    a `getError(error)` para mostrar el código real.
  - **FX** (`fxUpdateMutation`/`fxRefreshMutation`): sin feedback → Banner `success` (`fx.saved`) y
    `danger` (`getError`) por cada uno.
  - **Rareza→categoría** (`rarityMutation`): sin feedback → `success` (`rarityMap.saved`) y `danger`.
  - **Override manual** (`overrideMutation`, en el modal): sin feedback de error → Banner `danger` dentro
    del modal (el éxito cierra el modal, que ya es la señal). El `loading` del botón se mantiene.
- **`remote-sets`** (lista de sets) ya se renderiza dentro de `QueryState` (loading/error + Retry) — se
  verificó; el usuario ve el error de la query y puede reintentar.

### i18n (ES/EN espejado, pasa `i18n-parity`)
- `admin.m2.catalog`: `syncHint`, `syncRunning`, `syncDone`.
- `admin.m2.fx.saved`, `admin.m2.rarityMap.saved`.

### Tests (`m2/M2View.test.tsx`, +5; suite total **98** verde)
Con `vi.spyOn(api, …).mockRejectedValueOnce(new ApiClientError(...))`:
- sync por set → **429 RATE_LIMITED** muestra Banner de error con el copy del contrato + `role=alert`.
- backfill → **500 INTERNAL** muestra Banner de error.
- sync total → **500** muestra Banner `danger` y **no** el aviso "no disponible".
- sync total → **404** conserva el aviso `warning` "no disponible".

Gates (desde `frontend/`): `lint` OK · `typecheck` OK · `test` **98/98** (22 archivos) · `build` OK.

## Auth del back-office + auto-logout por inactividad + redirección por rol (2026-08-16)

Tres cambios de sesión/auth reportados por el humano probando en producción (backend real, mocks off).
Solo `frontend/` (+ esta nota). **No** se tocó el contrato. Gates en verde: `lint` OK, `typecheck` OK,
`test` **94** (22 archivos, +12 nuevos), `build` OK. i18n parity ES/EN intacta.

### 1. El back-office EXIGE sesión (antes: super_admin falso + 401)
- **`AdminShell.tsx`** (grupo `(admin)`) ahora consume `useSession()`. En **modo real** (`!config.useMocks`)
  `requireAuth = true`: mientras `!ready` o `!isAuthenticated` **no** renderiza el back-office — muestra un
  estado de carga (`admin.authLoading`, spinner). Cuando `ready && !isAuthenticated` redirige a
  `/login` con `router.replace({ pathname:'/login', query:{ next: pathname } })` (router de next-intl,
  preserva locale; `next` para volver tras login). En **modo mock/demo** `requireAuth=false`: se deja pasar
  (comportamiento de demostración sin backend).
- **`role.tsx` (`RoleProvider`)** dejó de hardcodear `'super_admin'`. Ahora:
  - Modo real: `role = useSession().user.role` (el backend deriva el rol del JWT y es la autoridad);
    `setRole` es **no-op** y expone `canSwitchRole=false`.
  - Modo mock/demo: sigue el dial local (localStorage `tcg.role`, default `super_admin`) para demostrar el
    enmascarado financiero; `canSwitchRole=true`.
- **`AdminTopbar.tsx`**: el selector "Ver como" (mock role switcher) se renderiza **solo si `canSwitchRole`**
  (modo mock). En modo real muestra el rol autenticado como texto (no editable). El backend sigue siendo la
  autoridad; esto es defensa de UI.

### 2. Auto-logout por 5 min de inactividad (app-wide, todos los roles)
- **`lib/inactivity.tsx` (nuevo)** — `InactivityProvider` montado dentro de `Providers` (raíz), cubre
  storefront + admin. Constante `INACTIVITY_LOGOUT_MS = 5*60*1000`. Solo actúa con sesión activa
  (`useSession().isAuthenticated`). Reinicia el timer con `mousemove/mousedown/keydown/scroll/touchstart`
  (listeners `passive`) y al volver la pestaña visible (`visibilitychange`). Al expirar: `logout()` (de
  `api.ts`, limpia token+user server/local) + `router.replace('/login?reason=inactivity')`. Como `logout()`
  emite el evento de sesión (`tcg.session.changed` + `storage`), **otras pestañas** también quedan
  deslogueadas (sync entre pestañas).
- **`login/page.tsx`** lee `searchParams` (server) y pasa `notice='inactivity'` + `next` a `AuthForm`.
- **`AuthForm.tsx`** muestra `Banner variant="warning"` con `auth.inactivityLogout` cuando
  `notice==='inactivity'` (sin `useSearchParams`, para no forzar Suspense en build).

### 3. Redirección post-login según rol (antes: todos iban a `/`)
- **`AuthForm.tsx`**: tras login/registro exitoso redirige con `destForRole(res.user.role)`:
  `super_admin`/`vault_operator` → **`/admin`**, resto → **`/`**. Si hay `?next` **interno** (empieza con
  `/`) se honra por encima del rol (evita open redirect validando el prefijo).
- **`GoogleSignInButton.tsx`**: `onSuccess` ahora recibe el `role` (`onSuccess(res.user.role)`); `AuthForm`
  lo enruta igual. Registro enruta por rol (normalmente `customer` → `/`).

### Archivos tocados
- `src/components/layout/AdminShell.tsx` (gate de sesión + loading), `src/components/layout/AdminTopbar.tsx`
  (switcher solo en mock), `src/lib/role.tsx` (rol desde sesión / dial en mock + `canSwitchRole`),
  `src/lib/inactivity.tsx` (nuevo), `src/components/Providers.tsx` (monta `InactivityProvider`),
  `src/components/domain/AuthForm.tsx` (redirect por rol + aviso inactividad + `next`),
  `src/components/domain/GoogleSignInButton.tsx` (`onSuccess(role)`),
  `src/app/[locale]/(auth)/login/page.tsx` (searchParams → notice/next),
  `messages/{es,en}.json` (`auth.inactivityLogout`, `admin.authLoading`).
- Tests nuevos: `AdminShell.test.tsx` (sin sesión → loading + `replace` a `/login?next=/admin`; con sesión
  renderiza y el rol viene de la sesión — super_admin/vault_operator; switcher off en real),
  `lib/inactivity.test.tsx` (fake timers: dispara `logout`+redirect tras el umbral; la actividad reinicia el
  timer; sin sesión nunca dispara), `AuthForm.test.tsx` ampliado (redirect super_admin/operator→`/admin`,
  customer→`/`, `next` interno gana; aviso de inactividad).

### Solicitudes al arquitecto
- Ninguna. El rol de sesión ya viene en `AuthResponse.user.role` y `GET /users/me`; `POST /auth/logout` ya
  existe (§1). El gate y el timer son puramente de cliente (defensa de UI); el backend sigue siendo la
  autoridad de autorización (rechaza 401 sin sesión).

## Fix bloqueante techlead — sincronización del form de KYC en M6 (2026-08-16)

Rechazo de techlead: el subformulario de KYC de la ficha 360° (`M6View.tsx`) no sincronizaba su
estado con el usuario cargado. `kycStatus` se inicializaba en `'none'` y nunca se sincronizaba al
llegar `detail.data`; `capRequest`/`capMonth` (`useState('')`) no se reiniciaban al cambiar de
usuario. Como la mutación `updateUserKyc` **siempre** envía `kycStatus`, abrir un usuario `verified`
para ajustar un tope y guardar degradaba silenciosamente el KYC a `'none'` (corrupción de datos que
gobierna topes/INE de dinero saliente); además un borrador tecleado para el usuario A sobrevivía al
abrir el usuario B.

**Fix (patrón "cae al servidor mientras no esté dirty", como M10):**
- Se reemplazaron los tres `useState` sueltos por un único **borrador** `kycDraft` que guarda solo
  las keys que el admin tocó explícitamente.
- Valores efectivos computados: `kycStatus = kycDraft.kycStatus ?? currentKyc?.kycStatus ?? 'none'`
  (cae al valor del servidor); `capRequest`/`capMonth` caen a `''` (vacío = no enviar, se mantiene
  el placeholder con el valor del servidor). Así "Guardar KYC" **nunca** envía un `kycStatus`
  distinto al cargado salvo que el admin lo cambie a propósito.
- `useEffect(() => setKycDraft({}), [selectedId])`: el borrador **no cruza** entre usuarios; se
  reinicia al cambiar de usuario seleccionado. `d`/`currentKyc` se derivan justo tras el query de
  detalle (se eliminó la computación duplicada de más abajo que llevaba el comentario "Sincroniza…"
  que no sincronizaba).
- Los shapes de la ficha 360° (`clabeMasked`/`rfcMasked`/`capPerRequestCents`) se dejaron intactos
  (correctos según contrato; backend se alinea en paralelo).

**Tests añadidos** (`M6View.test.tsx`): (1) al cambiar de usuario seleccionado el form refleja los
valores del nuevo usuario y no arrastra el borrador del anterior (Ana `verified` → Bruno `none`,
tope tecleado se limpia); (2) guardar tras ajustar solo un tope envía `kycStatus:'verified'` (el del
servidor), nunca `'none'` — se verifica el payload de `updateUserKyc` con `vi.spyOn`.

Gates en verde: lint, typecheck, test (82/82), build. Archivos: `frontend/.../m6/M6View.tsx`,
`frontend/.../m6/M6View.test.tsx`.

## Back-office M7/M9 + Cotizador Opción 1 (2026-08-16) — consumo de módulos ya-existentes + buscador real

Se reemplazaron los `ModuleTodo` de **M7 (Finanzas)** y **M9 (Reportes)** por vistas reales que consumen
endpoints **ya implementados** en backend (CONTRATO v1.3 §M7/§M9: "ya existen; falta consumo de frontend"), y
se reescribió el **cotizador de buylist** para buscar sobre TODO el catálogo (Opción 1, contrato §6 v1.3) en
vez de usar `mockCards` (esa era la causa de "no sale nada al cotizar" contra el backend real). Solo `frontend/`
(+ esta nota). **No** se tocó el contrato. Mismo patrón que M2/M6/M10 (TanStack Query + `QueryState`,
`SuperAdminOnly` para la guarda de rol, `StatCard`/`DataTable`/`Banner`/`Input`/`Button`). Gates en verde:
`lint` OK, `typecheck` OK, `test` **80** (20 archivos, +11 nuevos, i18n-parity verde), `build` OK
(m7/m9 prerenderizados es/en).

### Archivos creados/tocados
- **Tipos** `src/types/contract.ts`: +`PnlDTO`, `InventoryValueDTO`, `CustodyValueDTO`, `IvaByOrderEntryDTO` +
  `IvaReportDTO` (M7); `LaunchGoalsDTO` + `LaunchMetricsDTO` (M9).
- **API** `src/lib/api.ts`: +`getPnl`, `getInventoryValue`, `getCustodyValue`, `getIvaReport`,
  `exportFinanceCsv` (M7), `getLaunchMetrics` (M9), `listBuylistSets` + `searchBuylistCards` (cotizador). Cada
  una con rama real (`apiRequest`) y rama mock. `exportFinanceCsv` hace `fetch` con Bearer y lee **texto**
  (no JSON, por eso no usa `apiRequest`); comparte el `exportCsv` de M7/M9 vía `source: 'finance' | 'reports'`.
- **Util** `src/lib/download.ts` (nuevo): `downloadTextFile(filename, text, mime)` — materializa el CSV como
  descarga en el navegador (aislado para poder mockearlo en tests sin tocar el DOM).
- **Fixtures** `src/lib/mock/fixtures.ts`: +`mockPnl` (con la fórmula coherente), `mockInventoryValue`,
  `mockCustodyValue`, `mockIvaReport`, `mockLaunchMetrics` (con `goals` fijadas de ejemplo), `mockCsv(report)`.
- **M7** (`/admin/m7`, super_admin): `m7/M7View.tsx` + `m7/page.tsx` (envuelto en `SuperAdminOnly`) +
  `m7/M7View.test.tsx`. Selector de rango de fechas (aplica a P&L e IVA), **tarjeta de P&L con el desglose de la
  fórmula** (ingresos + envío − COGS − comisiones Stripe = ganancia, ganancia en verde/rojo según signo), valor
  de inventario (a referencia + a costo + pendientes), valor en custodia, IVA acumulado + desglose por orden
  (`DataTable`), y **botones de export CSV** (pnl/iva/inventory).
- **M9** (`/admin/m9`, super_admin): `m9/M9View.tsx` + `m9/page.tsx` + `m9/M9View.test.tsx`. Selector de rango,
  **métricas de lanzamiento** (users/salesSettled/buylistPaid/withdrawalsNoDispute como `StatCard`) con progreso
  vs metas N/X/Y/Z (si `goals` es null muestra solo conteos + banner), y export CSV.
- **Cotizador** `(storefront)/buylist/BuylistView.tsx`: eliminado el `import { mockCards }`; ahora **filtra por
  set** (`listBuylistSets`) y **busca por texto** (`searchBuylistCards` sobre TODA la tabla `Card`, no solo
  bóveda) → lista de resultados seleccionables (`role="listbox"/"option"`) → al elegir carta se cotiza con el
  `getBuylistQuote({ cardId })` existente. Botón "Cotizar" deshabilitado hasta elegir carta. En modo mock cae a
  `fx.mockCards` (fixtures); en real usa los endpoints nuevos. Nuevo test `BuylistView.test.tsx` (4 casos) y
  `e2e/buylist.spec.ts` actualizado al nuevo flujo (buscar → elegir → cotizar).

### Endpoints consumidos
- M7: `GET /admin/finance/pnl?from=&to=`, `GET /admin/finance/inventory-value`,
  `GET /admin/finance/custody-value`, `GET /admin/finance/iva?from=&to=`,
  `GET /admin/finance/export.csv?report=&from=&to=`.
- M9: `GET /admin/reports/launch-metrics?from=&to=`, `GET /admin/reports/export.csv?report=&from=&to=`.
- Cotizador: `GET /buylist/sets`, `GET /buylist/cards?setId=&q=&page=` (+ el ya existente `POST /buylist/quote`).

### Supuestos sobre el contrato (para el arquitecto)
1. **`GET /admin/finance/iva` › `byOrder`** — el contrato lo describe como `byOrder: [...]` sin fijar campos.
   Asumí `IvaByOrderEntryDTO = { orderId, ivaCents, settledAt? }`. **Solicitud**: confirmar/ajustar el shape.
2. **`GET /admin/reports/launch-metrics` › `goals`** — el contrato dice `goals: { N, X, Y, Z }` con "`goals` en
   `null` hasta que el humano fije las metas". Se tipó `goals: LaunchGoalsDTO | null` (goals completo nulo O
   cada valor nulo, ambos soportados en UI). Confirmar cuál es la forma real.
3. **`export.csv` (M7/M9)** — se asume auth por Bearer y respuesta **`text/csv`** descargable; el front hace
   `fetch` directo (no `apiRequest`, que espera JSON) y descarga el blob. `report` default `pnl`. Confirmar el
   `Content-Type` y si requiere algún header extra.
4. **`GET /buylist/cards`** — se reutiliza `CardDTO` y `Paginated` tal cual el contrato (`{ data, page,
   pageSize, total }`, sin `sellable`/precio). El filtro `rarity` está cableado en `searchBuylistCards` pero la
   UI del cotizador hoy solo expone set + texto (rareza es opcional en el contrato); ampliable sin cambio de API.

Con **mocks** (`NEXT_PUBLIC_USE_MOCKS != false`) todo corre contra fixtures que respetan estos shapes; con
`useMocks=false` se ejecutan las ramas `apiRequest`/`fetch` contra el backend real.

## Back-office M2 / M6 / M10 (2026-08-16) — consumo de UI de módulos ya-existentes en backend

Se reemplazaron los `ModuleTodo` de **M2 (Catálogo y precios)**, **M6 (Usuarios/KYC)** y **M10 (Config y
bitácora)** por vistas reales que consumen los endpoints **ya implementados** en backend (ARCHITECTURE/
CONTRACT v1.3: M2/M6/M10 "ya existen; falta consumo de frontend"). Solo `frontend/` (+ esta nota). **No** se
tocó el contrato. Se siguió el patrón de M1/M3/M4/M5/M8 (TanStack Query + `QueryState` loading/error, mismos
componentes UI, `StatusBadge`/`Badge`, `DataTable`, `Modal`, `Banner`). Gates en verde: `lint` OK, `typecheck`
OK, `test` **71** (17 archivos, +11 nuevos, i18n-parity verde), `build` OK (m2/m6/m10 prerenderizados).

### Archivos por módulo
- **Comunes**: `src/types/contract.ts` (+DTOs: `FxDTO`, `PendingPriceEntryDTO`, `RarityMapEntryDTO`,
  `RemoteSetDTO`, `PriceHistoryEntryDTO`, `PricingSyncResponse`, `CatalogSync*Response`, `AdminUserSummaryDTO`,
  `AdminUserDetailDTO`, `AdminKycProfileDTO`, `AdminBillingProfileDTO`, `SettingsDTO`, `AuditLogDTO`,
  `FxSource`). `src/lib/api.ts` (+funciones de los 3 módulos, cada una con rama real `apiRequest` y rama mock).
  `src/lib/mock/fixtures.ts` (+fixtures marcados MOCK). `src/components/domain/SuperAdminOnly.tsx` (nuevo:
  guarda de UI para M2/M6/M10; el backend ya rechaza por rol, esto es defensa de navegación directa por URL con
  el patrón `useRole`). `messages/{es,en}.json` (+claves `admin.m2/m6/m10.*` y `admin.superAdminGate*`).
- **M2** (`/admin/m2`): `m2/M2View.tsx` + `m2/page.tsx` (envuelto en `SuperAdminOnly`) + `m2/M2View.test.tsx`.
  Secciones: (1) **sync de precios de bóveda** (`POST /admin/pricing/sync`), (2) **cola de precio pendiente**
  (`GET /admin/pricing/pending`) con **override manual** en modal (`POST /admin/pricing/override`),
  (3) **FX** (`GET/PUT /admin/fx` + `POST /admin/fx/refresh`) con display de tasa/colchón/fuente/vigencia y
  edición de override + refresh Banxico, (4) **rareza→categoría** editable (`GET/PUT /admin/pricing/rarity-map`),
  (5) **sync de catálogo** (`GET /admin/catalog/remote-sets` con imported/cardCount, `POST /admin/catalog/sync`
  por set, `POST /admin/catalog/backfill`, y `POST /admin/catalog/sync-all` **condicional**: su fallo muestra
  aviso "no disponible" sin romper — cumple la nota del contrato v1.3). `GET /admin/pricing/card/:id`
  (historial) queda cableado en `api.ts` (`getPriceHistory`) pero **aún no montado** en UI (deuda menor).
- **M6** (`/admin/m6`, super_admin): `m6/M6View.tsx` + `m6/page.tsx` + `m6/M6View.test.tsx`. Tabla de usuarios
  con **búsqueda `q` + filtro `status` + paginación** (`GET /admin/users`) y **ficha 360°** en modal
  (`GET /admin/users/:id`): identidad, KYC con **CLABE/RFC enmascarados** (nunca en claro), conteos 360°
  (órdenes/buylist/disputas/bóveda), direcciones, **editar KYC** (`PATCH /admin/users/:id/kyc`) y
  **bloquear/reactivar** con confirmación (`PATCH /admin/users/:id/status`).
- **M10** (`/admin/m10`, super_admin): `m10/M10View.tsx` + `m10/page.tsx` + `m10/M10View.test.tsx`. **Editor de
  diales** (`GET /admin/settings`) que guarda **body PARCIAL** con solo las keys tocadas
  (`PUT /admin/settings`, NO per-key) — dials money en pesos↔centavos; y **bitácora** paginada con filtro por
  acción (`GET /admin/audit-log`).

### Endpoints consumidos
- M2: `POST /admin/pricing/sync`, `GET /admin/pricing/pending`, `POST /admin/pricing/override`,
  `GET /admin/pricing/card/:id` (cableado, sin UI aún), `GET/PUT /admin/fx`, `POST /admin/fx/refresh`,
  `GET/PUT /admin/pricing/rarity-map`, `GET /admin/catalog/remote-sets`, `POST /admin/catalog/sync`,
  `POST /admin/catalog/backfill`, `POST /admin/catalog/sync-all` (condicional).
- M6: `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/kyc`, `PATCH /admin/users/:id/status`.
- M10: `GET/PUT /admin/settings`, `GET /admin/audit-log`.

### Supuestos sobre el contrato (para el arquitecto)
1. **`GET /admin/pricing/card/:id`** — el contrato dice "historial de precios por fecha/fuente" sin fijar el
   shape. Asumí `PriceHistoryEntryDTO` = `{ capturedDate, source, gradeKey, productType, priceMxnCents,
   isManualOverride }`. **Solicitud**: confirmar/ajustar el shape del historial. Aún no se monta en UI.
2. **`GET /admin/pricing/rarity-map`** — asumí respuesta `{ entries: [{ rarity, category }] }` (espejo del PUT).
   Confirmar el envelope exacto (`entries` vs `data`).
3. **`GET /admin/audit-log`** — el contrato muestra respuesta `{ data: AuditLogDTO[] }`; se normaliza a
   `Paginated` en el front (page/pageSize/total con fallback). Si el backend ya devuelve `total`, se usa; si no,
   la paginación del front se apoya solo en `data.length`. **Solicitud**: confirmar si expone `total` para
   paginación fiel.
4. **`GET /admin/users/:id`** — la ficha 360° (kycProfile/billingProfile/addresses/orders/sellRequests/disputes/
   ownedItems) se tipó según la nota del contrato §M6; nombres de sub-campos asumidos (p.ej. `clabeMasked`,
   `rfcMasked`, `ineOnFile`). Ajustar si difieren.
5. **`POST /admin/catalog/sync-all`** — usado condicionalmente; si el backend responde 404/405 el error se
   muestra como "no disponible" y el operador usa sync por set / backfill (sin romper).

Con **mocks** (`NEXT_PUBLIC_USE_MOCKS != false`) todo funciona contra fixtures que respetan estos shapes; al
apuntar al backend real (`useMocks=false`) se ejecutan las ramas `apiRequest`.

---

## Fixes UI/sesión en vivo (2026-08-16) — header de sesión, nav "Sell" y banner de login

Tres arreglos reportados por el humano probando la app en producción (backend real, mocks off). Solo
`frontend/` (+ esta nota). **No** se tocó el contrato. Gates en verde: `lint` OK, `typecheck` OK,
`test` **60** (14 archivos, +6 nuevos), `build` OK.

### 1. Estado de sesión de cliente + header reactivo
- **`src/lib/session.ts` (nuevo)**: hook `useSession()` + helpers `getStoredUser`/`setStoredUser`.
  Mismo idiom que `useCart` (localStorage `tcg.user` + evento `tcg.session.changed` + `storage` para
  sincronía entre pestañas). Expone `{ user, isAuthenticated, ready }`. `ready` es `false` en SSR y en
  el primer render de cliente (patrón "mounted") para **evitar mismatch de hidratación** de Next: el
  header pinta el estado deslogueado hasta que el efecto de montaje lee localStorage.
- **`src/lib/api.ts`**: `persistSession` ahora persiste **también el `user`** de `AuthResponse`
  (`setStoredUser`) además del token — aplica a `login`, `register` y `loginWithGoogle`. Se añadió
  **`logout()`** (contrato `POST /auth/logout` → 204): invalida server-side y limpia token+user; en
  modo mock solo limpia local; aunque el backend falle, el cliente queda deslogueado (`finally`).
- **`src/components/layout/StorefrontHeader.tsx`**: si hay sesión muestra **perfil** (nombre, o email
  como fallback) + botón **"Cerrar sesión"**; si no, el enlace **"Iniciar sesión"** como antes. Se
  actualiza **reactivamente** vía `useSession` (login/logout sin recargar). Implementado en barra
  desktop y menú móvil. El logout llama `logout()` y hace `router.push('/')`.

### 2. Nav "Buylist" → "Sell/Vender" (solo etiqueta; ruta `/buylist` intacta)
- `messages/en.json` `nav.buylist` = **"Sell"**; `messages/es.json` = **"Vender"**.
- Alineado el título cara al cliente `buylist.title`: "Sell your cards" / "Vende tus cartas" (se quitó
  el paréntesis "(Buylist)"). "Buylist" queda solo como término interno/back-office (`admin.modules.m5`
  se mantiene "M5 · Buylist"). Parity ES/EN intacta (test `i18n-parity` verde).

### 3. Banner engañoso de login solo en modo mock
- `src/components/domain/AuthForm.tsx`: el `<Banner variant="info">{t('mockNotice')}</Banner>` ahora se
  condiciona a **`config.useMocks`** — en producción (backend real) no aparece.

### Tests añadidos
- `src/components/layout/StorefrontHeader.test.tsx`: header muestra perfil+logout con sesión y
  "Iniciar sesión" sin ella; fallback a email; logout reactivo (vuelve a deslogueado + `router.push`);
  label del nav = "Sell"/"Vender" apuntando a `/buylist`. Se mockea `@/i18n/navigation`.
- `src/components/domain/AuthForm.test.tsx`: banner visible con `useMocks=true` y ausente con `false`.
- `vitest.setup.ts`: polyfill de `window.matchMedia` (lo usa `ThemeToggle` dentro del header).

---

## Cierre residuo endurecimiento S-B3 (2026-08-15) — `contentLength` en presign + `maxBytes` del presign

Cierre del residuo señalado por qa/techlead/seguridad en el endurecimiento de `kyc_ine`. Solo `frontend/`
(+ esta nota). **No** se tocó el contrato (`contentLength` y `maxBytes` ya son opcionales/aditivos en §8).
Gates en verde: `lint` OK, `typecheck` OK, `test` **52** (12 archivos), `build` OK.

### Qué se hizo
- **`presignUpload` (`src/lib/api.ts`)** ahora acepta y envía **`contentLength`** en el body del presign
  (`{ purpose, contentType, contentLength }`). El backend, cuando llega, lo fija en la firma (`ContentLength`)
  para que R2/S3 **rechace cuerpos de otro tamaño** end-to-end (cierra S-B3). La rama mock devuelve además
  **`maxBytes`** (≈10 MB) para reflejar el tope del presign.
- **`UploadPresignResponse` (`src/types/contract.ts`)** declara **`maxBytes?: number`** (tope de tamaño que
  admite la firma). Es opcional por compat.
- **`PhotoUploader` (`src/components/ui/PhotoUploader.tsx`)**:
  - Pasa **`contentLength: file.size`** al presign.
  - Valida tamaño en cliente contra **`presign.maxBytes` como fuente única de verdad**; `DEFAULT_MAX_UPLOAD_BYTES`
    (constante local) queda **solo como fallback** si el presign no trae `maxBytes`. La validación de tamaño se
    hace **tras** el presign (ya conocemos el tope real); la de **tipo** (`image/*`) sigue antes de pedir presign.
  - **Nit de memoria:** el object URL del preview se **revoca** (`URL.revokeObjectURL`) al re-seleccionar y al
    desmontar (ref `previewUrlRef` + cleanup en `useEffect`).
- **Tests**: `PhotoUploader.test.tsx` cubre que **`contentLength=file.size`** viaja en el presign y que el
  rechazo por tamaño usa **`presign.maxBytes`** (spy con `maxBytes` chico → no sube ni expone `uploadKey`).
  `api.test.ts` fija que el presign mock devuelve `maxBytes`.

## Cableado del INE en buylist/KYC (2026-08-15) — presign `kyc_ine` + creación de solicitud

Se integró el uploader del INE (antes **huérfano**) en el flujo real de buylist/KYC. Solo `frontend/`
(+ esta nota). **No** se tocó el contrato. Gates en verde: `lint` OK, `typecheck` OK, `test` **50** (12
archivos), `build` OK. E2E (Playwright) de buylist ampliado (lo ejecuta QA).

> Nota de entorno: `node_modules` estaba incompleto (faltaba `recharts`); se corrió `npm install` para dejar
> los gates ejecutables. No se cambiaron versiones de `package.json`.

### Qué se hizo
- **`PhotoUploader` (`src/components/ui/PhotoUploader.tsx`)** dejó de ser un mock con `setTimeout`: ahora hace
  el flujo real **presign → PUT al storage → `uploadKey`**:
  1. **Validación de TIPO en cliente**: solo imágenes. El `<input>` es `accept="image/*"` y además se valida
     `file.type.startsWith('image/')` (rechaza p. ej. PDF con error claro, sin subir).
  2. **Validación de TAMAÑO en cliente**: `maxBytes` (default **10 MB**, `DEFAULT_MAX_UPLOAD_BYTES`); si excede,
     error `ine.errTooLarge` con el límite. Además mapea **413** del storage a ese mismo error (rechazo del
     backend por límite) y `VALIDATION_ERROR` a "no es imagen".
  3. **presign** `POST /uploads/presign` con `{ purpose: "kyc_ine", contentType: file.type }` →
     **PUT directo** a `uploadUrl` enviando el `Content-Type` de imagen y `headers` del presign (sin token de
     sesión; URL firmada). Al terminar expone `onUploaded(uploadKey)`.
  - Estados: vacío / subiendo (`aria-busy`, spinner + `sr-only`) / éxito (`Subida ✓`) / error (`role="alert"`,
    borde `danger`, `aria-describedby`). Botón "Retomar" tras éxito; permite re-seleccionar el mismo archivo.
    i18n vía namespace **`ine`** (labels, estados, errores). Objetivo táctil 48px.
- **`BuylistKycForm` (`src/components/domain/BuylistKycForm.tsx`)** — nuevo paso de pago/KYC del buylist:
  - **CLABE** (`Input`, `inputMode=numeric`, máx 18, filtra no-dígitos) con validación cliente `^\d{18}$`.
  - **Dos slots de INE** (anverso/reverso) con `PhotoUploader purpose="kyc_ine"` + **aviso de privacidad**
    obligatorio (`ine.privacy`, DESIGN §7.10).
  - Envía `POST /buylist/requests` (`createSellRequest`) con `{ items:[{cardId, productType, rawCondition:'NM'
    si raw, category}], clabe, ineUploadKeys? }` — las `ineUploadKeys` solo se adjuntan si **ambas** imágenes
    subieron. Mapea errores de negocio del contrato: **`INE_REQUIRED`** (revela/pide el INE), **`CLABE_NOT_OWN_NAME`**,
    **`CLABE_INVALID`**, **`BUYLIST_LIMIT_EXCEEDED`**, y genérico. loading/error/éxito manejados.
- **`BuylistView`**: el botón "Crear solicitud" (antes inerte) abre un **`Modal`** con `BuylistKycForm`; al crear
  se cierra, se invalida `['sell-requests']` (React Query) y se muestra banner de éxito (`buylist.created`).
- **`api.ts`**: nuevas funciones con rama real + rama mock — `presignUpload`, `uploadToPresignedUrl`
  (raw `fetch` con `Content-Type` imagen; 413→`FILE_TOO_LARGE`), `createSellRequest`, `getKyc`, `updateKyc`.
- **Tipos** (`contract.ts`): `UploadPurpose`, `UploadPresignResponse` (`uploadKey/uploadUrl/method/headers/expiresAt`),
  `IneUploadKeys`. `KycInfoDTO.clabe` → **`clabeMasked`** (alineado al contrato: la CLABE se devuelve enmascarada).
- **Fixtures**: `mockKyc` (`KycInfoDTO`); presign mock devuelve `uploadUrl` `mock://…` para cortar red en tests/dev.

### Consumo del presign (según contrato §8) — resumen
`POST /uploads/presign {purpose:"kyc_ine", contentType, contentLength} → {uploadKey, uploadUrl, method:"PUT", headers, expiresAt, maxBytes}`;
el cliente hace `PUT uploadUrl` con `Content-Type` de imagen y los `headers`; luego la `uploadKey` viaja como
`ineUploadKeys.front/back` en `POST /buylist/requests` (o como `ineFrontUploadKey/ineBackUploadKey` en
`PUT /users/me/kyc` vía `updateKyc`, disponible para el flujo de KYC de perfil).

### Coordinación con backend (endurecimiento de `kyc_ine`)
El uploader ya cumple lo pactado: **solo `image/*`** (accept + validación de `file.type`), envía el
**`Content-Type` de imagen** y **`contentLength`** en el presign, valida **tamaño contra `presign.maxBytes`**
(fuente única de verdad; fallback local ~10 MB) y además maneja el **rechazo del backend** (413 y
`VALIDATION_ERROR`) con mensajes claros. Si el backend fija un límite distinto, lo devuelve en `presign.maxBytes`
y el cliente lo respeta sin cambios (ver sección "Cierre residuo endurecimiento S-B3" arriba); no cambia el contrato.

### Tests
- **`PhotoUploader.test.tsx`** (nuevo): render + `accept="image/*"`; rechazo de **no-imagen** (PDF) sin subir;
  rechazo por **tamaño** (con `maxBytes` chico); imagen válida → presign + `onUploaded(kyc_ine/…)` + estado éxito.
- **`BuylistKycForm.test.tsx`** (nuevo): render de CLABE + dos INE + privacidad; validación CLABE 18 dígitos (no
  llama al backend); creación OK (item raw con `rawCondition:'NM'` y categoría); mapeo de `422 INE_REQUIRED`.
- **`e2e/buylist.spec.ts`**: dos casos nuevos — el paso de solicitud pide CLABE + INE (anverso/reverso, `accept=image/*`)
  con aviso de privacidad; creación con CLABE válida muestra la confirmación.

### Nuevas claves i18n (ES/EN espejadas; pasa `i18n-parity`)
- Namespace **`ine`**: `front/back/takePhoto/retake/uploading/uploaded/privacy/errNotImage/errTooLarge/errUpload`.
- **`buylist`**: `requestTitle, clabeLabel, clabeHint, clabeInvalid, clabeNotOwnName, ineSectionTitle,
  ineSectionNote, ineRequiredError, limitExceeded, submit, submitting, requestError, created`.

### Suposiciones sobre el contrato (a confirmar por el arquitecto)
- **Determinación de "INE requerido"**: el front NO conoce el umbral (dial `ineThresholdCents`), así que ofrece
  el INE como **opcional** y se apoya en el `422 INE_REQUIRED` del backend para exigirlo. Si el arquitecto
  prefiere señalizarlo proactivamente, convendría exponer el umbral (p. ej. en `POST /buylist/quote` o en
  `GET /users/me/kyc`, que ya trae `capPerRequestCents/capPerMonthCents/monthUsedCents`). No bloquea; no cambia
  el contrato hoy.
- **`Content-Type` del PUT**: se envía el MIME real de la imagen (`file.type`). Se asume que el presign del
  backend firma para ese `Content-Type` (el request de presign ya envía `contentType`). Confirmar que el storage
  no exige un header adicional fijo (los `headers` del presign se reenvían tal cual).
- **Códigos de error del presign/PUT**: se asume `413` (tamaño) del storage y `422 VALIDATION_ERROR` (tipo) del
  presign, además de los de negocio de `POST /buylist/requests` (`INE_REQUIRED`, `CLABE_NOT_OWN_NAME`,
  `CLABE_INVALID`, `BUYLIST_LIMIT_EXCEEDED`) — todos ya contemplados en el contrato §6/§8.

## Alcance v1.2.1 (2026-08-14) — sin fotos de producto / fix badge / gradeada por cert / disputa por correo

Simplificación aprobada (PROJECT/CONTRATO/ARCH/DESIGN v1.2.1). Solo `frontend/` (+ esta nota). No se tocó
el contrato. Todo mantiene el **toggle de mocks** (rama real `apiRequest` + rama mock en fixtures) e i18n
ES/EN espejado. `lint`/`typecheck`/`test` (42) y Playwright (36) en verde; `build` OK.

### 1. Sin fotos de producto — imagen de catálogo remota
- **Tipos** (`src/types/contract.ts`): eliminados `frontPhotoUrl`/`backPhotoUrl` de `ListingDTO`,
  `HoldingDTO` e `InventoryItemDTO`. La imagen mostrada es **siempre** `card.imageSmallUrl`/`imageLargeUrl`
  (pokemontcg.io).
- **UI**: `ListingCard`, `CardDetailView`, `VaultView`, M1 y M8 usan la imagen de catálogo remota. Se
  **eliminó la pestaña "Fotos"** de la ficha (tabs = Descripción/Condición) y toda la UI de subida/visualización
  de foto de producto en M1 (alta **sin cámara**; banner `admin.m1.noPhotoNotice`).
- **Fixtures**: `mockListings`/`mockHoldings`/`mockInventory` sin URLs de foto propia.
- Claves i18n retiradas (ambos locales): `card.tabPhotos`, `card.frontPhoto`, `card.backPhoto`,
  `admin.m1.photosFront`, `admin.m1.photosBack`.

### 2. Fix del empalme del badge (DESIGN_SYSTEM §7.2b) — regla exacta implementada
- **Ubicación por defecto = FUERA del arte**, en la **fila de info bajo la imagen**. `ListingCard` ya **no**
  monta el `ConditionBadge` con `absolute` sobre la imagen; lo renderiza en una fila propia debajo (raw NM y
  sellado **siempre** ahí).
- **Única excepción sobre el arte** = **chip de grado de gradeada con scrim sólido**: nuevo componente
  `GradedCertChip` variante `scrim` en `top-2 left-2`, fondo `bg-slate-900/90`, texto blanco `text-xs`
  peso 600, `rounded-[6px]` (radius-sm), `px-2 py-0.5`, sombra `shadow-xs`. Nunca se monta raw/sellado sobre
  el arte ni se usan fondos translúcidos. En el card el chip colapsa a `PSA 10` (compact) y el `certNumber`
  completo va en la fila de info + ficha.

### 3. Gradeadas = grado + certificado
- Nuevo **`GradedCertChip`** (`src/components/ui/GradedCertChip.tsx`): formato canónico **`PSA 10 · #12345678`**
  (empresa+grado peso 600, ` · #<certNumber>` `tabular-nums`), `aria-label` con empresa+grado+cert. Variantes
  `soft` (fila de info/ficha) y `scrim` (sobre arte).
- `ConditionBadge` (graded) delega en `GradedCertChip`; nueva prop `certNumber` propagada desde `ListingDTO`/
  `HoldingDTO` en `ListingCard`, `CardDetailView`, `VaultView`.
- **Ficha** (§7.2c): nuevo `CertNumberField` (`src/components/ui/CertNumberField.tsx`) muestra el cert con
  etiqueta "Certificado / Certificate" como **texto copiable + botón "Copiar"** (no se inventa URL de
  verificación de la graduadora; ver solicitud al arquitecto abajo).
- **Admin M1**: alta de gradeada captura **empresa + grado + `certNumber`**; `certNumber` es **requerido para
  publicar** (el botón "Crear item" se deshabilita y el input muestra error si falta). Tipo `ListingDTO.certNumber?`,
  `InventoryItemDTO.certNumber?`, `HoldingDTO.certNumber?`.

### 4. Disputa por correo (reemplaza `PhotoCompare`)
- Nuevo **`DisputeEvidenceContact`** (`src/components/domain/DisputeEvidenceContact.tsx`): muestra el correo
  de soporte desde **`DisputeDTO.evidenceContact`** (de la API; **NO hardcodeado** en la UI) como enlace
  `mailto:` (con asunto citando la referencia) + botón **"Copiar correo"**. Banner `info`.
- **Admin M8** reescrito: **eliminado el comparador de fotos** (`PhotoColumn`/ingreso vs. reclamo). Muestra
  imagen de catálogo del ítem, descripción, `DisputeEvidenceContact` y —para gradeadas— `GradedCertChip` +
  `CertNumberField` como base de resolución. Tipos: `DisputeDTO` sin `ingressPhotoUrls`/`claimPhotoUrls`; con
  `type` (`condition_raw|condition_sealed`), `evidenceContact?` e `item.{productType,gradingCompany,gradeValue,certNumber}`.
- Fixtures `mockDisputes`: 2 disputas (raw + sealed) con `evidenceContact` (placeholder del contrato
  `soporte@tcgvaultmx.com`); graded **no** genera disputa (coherente con `422 NOT_RAW`).
- `legal.disputeBody` (ES/EN) actualizado: la evidencia va **por correo a soporte** (no se sube foto en la app).

### 5. INE conserva su uploader
- `PhotoUploader` (`src/components/ui/PhotoUploader.tsx`) — el **único uploader** del sistema (INE del buylist,
  `purpose="kyc_ine"`) — **no se tocó**. Se retiró su uso en M1 (fotos de producto); queda listo para cablearse
  al flujo de KYC del buylist.

### Tests actualizados
- `ConditionBadge.test.tsx`: caso graded con `certNumber` (`PSA 10 · #cert` + `aria-label`).
- `e2e/admin.spec.ts`: M1 sin uploader (aviso de imagen de catálogo + `certNumber` requerido al elegir graded);
  M8 con panel de evidencia por correo y **sin** comparador de fotos.

### Nuevas claves i18n (ES/EN espejadas)
- `card.certLabel/certCopy/certCopied/gradedCertAria/gradedGuarantee`.
- `admin.m1.noPhotoNotice/certNumberRequired/certNumberError`.
- Namespace `dispute.evidenceTitle/evidenceBody/copyEmail/copied/mailSubject/mailSubjectGeneric`.

### Solicitud al arquitecto/PO (v1.2.1)
- **URL de verificación de la graduadora**: `CertNumberField` deja el `certNumber` como **texto copiable**
  (no enlace) porque no hay URL oficial confirmada. Si el humano confirma el patrón de verificación de PSA/CGC,
  se puede promover a enlace ("Verificar en PSA/CGC", `target=_blank rel=noopener`). No bloquea; no cambia el contrato.
- **`evidenceContact`**: la UI lo consume tal cual del contrato (`POST /disputes`, `GET /admin/disputes/:id`).
  El correo `soporte@tcgvaultmx.com` sigue marcado como *placeholder por confirmar por el humano* en PROJECT/CONTRATO.

## Alcance v1.1 (2026-08-14) — Compra/filtros/NM/sellado/tendencia/Google

Implementación de las 6 superficies nuevas del contrato+diseño v1.1. Solo `frontend/` (+ esta nota).
No se tocó el contrato. Todo con **toggle de mocks** (`config.useMocks`): cada llamada nueva tiene
rama real (`apiRequest`) y rama mock (fixtures) para funcionar en Vercel sin backend. i18n ES/EN espejado.

### Dependencia añadida
- **`recharts` `^2.15`** (`package.json` `dependencies`) para `PortfolioTrendChart`/`PortfolioSparkline`.
  Añadido polyfill de `ResizeObserver` en `vitest.setup.ts` (jsdom no lo trae; lo usa `ResponsiveContainer`).

### Variable de entorno nueva
- **`NEXT_PUBLIC_GOOGLE_CLIENT_ID`** (opcional) — client id de Google Identity Services para el login
  con Google. Leída en `src/lib/config.ts` (`config.googleClientId`). Sin ella (o con mocks activos) el
  botón simula el login. **Solicitud a devops**: añadirla al `.env.example` (comentario "opcional; login Google").

### 1. Rename "Catálogo" → "Compra"
- Rótulos i18n: `nav.shop`/`nav.catalog` = **"Compra"/"Shop"**, `catalog.title` = "Compra"/"Shop",
  `catalog.subtitle`, `card.backToCatalog`, `home.ctaCatalog`, `vault.emptyCta/emptyBody`. El `StorefrontHeader`
  usa `nav.shop`. La **ruta técnica sigue siendo `/catalog`** (y el contrato mantiene `/catalog/cards`);
  se añadió **alias `/compra`** (`(storefront)/compra/page.tsx` → `CatalogView`) para no romper enlaces.
- Semántica v1.1: la vitrina lista **solo inventario publicado con precio** (`getCatalog` mock ya solo
  contiene `sellable && salePriceCents != null`); **Compra nunca muestra "precio pendiente"** (E2E lo asegura).

### 2. Filtros de Compra (`ShopFilters`, §7.16) sobre `GET /catalog/facets`
- `src/components/domain/ShopFilters.tsx`: **rareza** = multi-select buscable/agrupable (taxonomía abierta;
  a la API se manda la rareza CRUDA como CSV). El mapa **rareza→grupo vive en el front**
  (`src/lib/rarity-groups.ts`, grupos standard/ultra/illustration/special, **fallback "other"/"Otras"**).
  **Set con año** ("Nombre (2024)", orden año desc del contrato). **Tipo** (Todo/Raw NM/Graded/Sellado) con
  **sub-filtro de subtipo** de sellado. **Precio** min/max en MX$→centavos. **Orden** (`sort`) sobre el grid.
- `CatalogView` reescrita: panel lateral sticky (lg+) + **bottom sheet** (Modal) en móvil, **chips removibles**
  de filtros activos, sincroniza `getCatalog(filters)`. Nuevos campos en `CatalogFilters`
  (`rarity: string[]`, `sealedSubtype`, `minPriceCents`, `maxPriceCents`, `sort`).

### 3. Condición NM legible (`ConditionBadge`, §7.2b)
- `RawCondition='NM'` (único valor) en `src/types/contract.ts`; **eliminados LP/MP/HP/DMG** de todos los
  selects/tipos (Compra, buylist, admin M1) y fixtures.
- `ConditionBadge` reescrito: raw → **"Casi nueva (NM)" / "Near Mint (NM)"**, tono **success suave**, la
  descripción del estándar en `title` (tooltip) **+ `aria-label`**, badge focuseable (`tabIndex=0`). Claves
  i18n `catalog.condition.nm.{label,desc}`. Prop `compact` colapsa a "NM" conservando el `aria-label` completo.
- **Buylist**: sin selector de condición (NM fijo; se envía `rawCondition='NM'`) + **banner NM-only**
  (`buylist.nmOnlyTitle/Body`). **Admin M1**: raw sin selector (nota NM fija).

### 4. Tarjeta de SELLADO (`ListingCard` variante, §7.1b)
- `ConditionBadge` sellado → badge **"Sellado"** (info + icono `package`) + **subtipo** (`status.sealedSubtype.*`),
  sin condición/rareza. `ListingCard` oculta `#número` para sellado; imagen `object-contain` (ya en `CardImage`).
  `sealedSubtype?` añadido a `ListingDTO/HoldingDTO/SellItemDTO/InventoryItemDTO`.
- **Admin M1** soporta alta de sellado: selector de **subtipo** + **campo de precio (MXN) obligatorio** para publicar.

### 5. Gráfica de tendencia del portafolio (`PortfolioTrendChart`, §7.17)
- `src/components/domain/PortfolioTrendChart.tsx`: **AreaChart** (recharts) estilo acciones, **toggle
  5d/15d/1m/3m/6m/1a/YTD/Máx**, delta con **signo (+/−) + flecha (▲/▼)** además del color (verde↑/rojo↓),
  **costo base** punteado, estados **cargando / vacío ("recopilando datos") / negativo (legítimo) / estimado /
  error**, **resumen textual `aria-live`** (`role="img"` + aria-label) y "Ver como tabla". Colores leídos de los
  tokens CSS (soporta modo oscuro). **`PortfolioSparkline`** opcional en el `StatCard` de valor total en `VaultView`.
- Consume `GET /vault/portfolio/history?range=...`; el mock (`generatePortfolioHistory`) genera una serie
  determinista que termina en el valor actual del portafolio.

### 6. Login con Google (`GoogleSignInButton`, §6.7)
- `src/components/domain/GoogleSignInButton.tsx`: botón neutro `secondary` full-width con logo "G" oficial.
  En modo real (client id + sin mocks) carga **Google Identity Services**, y al recibir el `credential` llama
  `POST /auth/google`; en modo mock simula el canje sin backend. Estados loading ("Conectando…", `aria-busy`)
  y error inline (`error.GOOGLE_TOKEN_INVALID`/`GOOGLE_EMAIL_UNVERIFIED`). Guarda tokens igual que el login normal.
- **D6 (fix v1.1, 2026-08-14):** en modo real, al descartar/omitir el prompt de GIS el `callback` del
  credential nunca corre, así que el botón se quedaba en spinner. Ahora `prompt()` recibe un
  **moment listener**: si `isDismissedMoment()`/`isSkippedMoment()`/`isNotDisplayed()` → `loading=false`.
  Además hay un **timeout de respaldo** (`PROMPT_TIMEOUT_MS`, 60s) que sale del spinner si GIS no notifica
  ni invoca el callback; se limpia en el callback/listener y al desmontar. En modo mock no aplica (login
  simulado). Cubierto en `GoogleSignInButton.test.tsx` (descarte del prompt y `isNotDisplayed`).
- `AuthForm` reescrito: **email/contraseña es la acción primaria** (ahora vía `login()`/`register()` reales con
  rama mock), divisor **"o/or"**, y el botón Google debajo. Login y registro.

### 7. Cliente API (`src/lib/api.ts`)
- Nuevas funciones con rama real+mock: **`getCatalogFacets()`**, **`getPortfolioHistory(range)`**,
  **`loginWithGoogle(idToken)`**, **`login()`/`register()`**. `getCatalog` ajustada a los nuevos campos
  (rareza multi como CSV, precio, sort, sealedSubtype). Buylist mock usa `mockReferenceByCardId`
  (Zapdos sin market price → "precio pendiente" de adquisición; rarezas modernas → `ex_plus` 40%).

### Tests
- **Unit (vitest): 39 verdes** (antes 10). Nuevos: `rarity-groups.test.ts`, `ConditionBadge.test.tsx`
  (NM legible + tooltip/aria-label + sellado), `ShopFilters.test.tsx` (rareza cruda multi, set con año,
  subtipo sellado, precio→centavos), `GoogleSignInButton.test.tsx` (mock deja sesión + onSuccess),
  `PortfolioTrendChart.test.tsx` (vacío, toggle 8 rangos, refetch por rango), `api.test.ts`
  (facets, history, catálogo sin pendientes, buylist ex_plus/pendiente, google). Helper `renderWithProviders`
  (NextIntl + TanStack Query) en `src/test/render.tsx`.
- **E2E (Playwright): 36 verdes** (antes 30). `catalog.spec.ts` reescrita ("Compra", filtro rareza multi-select,
  sellado, NM tooltip, Compra sin "precio pendiente"); nueva `portfolio.spec.ts` (gráfica + toggle de rangos);
  `auth.spec.ts` + login Google (mock). Corridas HOY contra dev server con `NEXT_PUBLIC_USE_MOCKS=true`.
- `lint`/`typecheck`/`build` en verde. `i18n-parity.test.ts` valida la paridad ES↔EN de todas las claves nuevas.

## Rebrand "TCG Vault MX" + política de ventas finales (2026-08-13)

Dos cambios de negocio pedidos por el humano. Solo tocan `frontend/` (+ esta nota). Sin cambios de contrato.

### 1. Rebrand a "TCG Vault MX"

- `common.appName` → **"TCG Vault MX"** en `messages/es.json` (era el placeholder "Bóveda TCG") y
  `messages/en.json` (era "TCG Vault"). Ambos idiomas comparten ahora el mismo nombre de marca.
- El `title`/metadata de `[locale]/layout.tsx` ya se compone con `t('appName')`, así que se
  actualiza solo (verificado en `next build`).
- **`StorefrontHeader.tsx`** tenía el texto **hardcodeado** `"TCG Vault"`; se cambió a
  `t('appName')` (namespace `common`) para que el rebrand sea de una sola fuente.
- Email/dominio placeholder `boveda-tcg.mx` → **`tcgvaultmx.com`**: `checkout.cfdiNotice` ahora usa
  `facturacion@tcgvaultmx.com` (ES y EN). El `tagline` se mantiene sin cambios.
- **Tests E2E de marca:** no existía ningún E2E que asertara el literal "Bóveda TCG" (grep vacío en
  `frontend/e2e/`), por lo que no hubo aserciones de marca que ajustar. El resto del suite no
  hardcodea el nombre de app (usa claves i18n vía `e2e/utils/i18n.ts`).

### 2. Política de reembolsos visible — VENTAS FINALES

Decisión del humano: **todas las ventas son finales, sin reembolso** una vez comprada la carta.
Única excepción: **carta dañada o equivocada** → disputa de condición (7 días, con fotos); si
procede, se compensa y el usuario **conserva la carta** (sin devolución). Todo bilingüe vía
next-intl (nada hardcodeado).

- **Aviso en checkout**: `CheckoutView.tsx` muestra un `Banner variant="warning"` con
  `checkout.finalSaleNotice` ("Todas las ventas son finales. Sin reembolsos salvo carta dañada o
  equivocada.") y una acción/enlace `checkout.viewTerms` → `/terminos`. Colocado junto al banner
  CFDI en el resumen del pago.
- **Página de términos/política** nueva: `src/app/[locale]/(storefront)/terminos/page.tsx`
  (ruta `/es/terminos` y `/en/terminos`, dentro del layout storefront). Server component con
  `generateMetadata` propio. Namespace i18n `legal.*` con: intro, **alcance por tipo de producto**
  (`scopeNote`: aplica a raw, sellado y gradeadas), **reembolsos/ventas finales**
  (`refundTitle`/`refundBody`), **excepción por error de la plataforma**
  (`platformErrorTitle`/`platformErrorBody`: cobro duplicado o compra sin inventario real → siempre
  se reembolsa, sin disputa) y **disputa de condición** (`disputeTitle`/`disputeBody`/
  `disputeWindowNote`/`disputeOutcome`: 7 días naturales **contados desde la entrega** del envío,
  fotos, compensa y conservas la carta). Usa tokens del DESIGN_SYSTEM (Banner warning + cards con
  borde; icono `BadgeCheck` success para el error de plataforma, `ShieldCheck` info para disputa).
  Coherente con el contrato: el reembolso por error de plataforma se materializa vía
  `charge.refunded` (§9) / `POST /admin/orders/:id/refund` (M3, super_admin); la ventana de disputa
  refleja `422 DISPUTE_WINDOW_CLOSED` ("fuera de 7 días desde entrega", §7). Solo texto, sin cambio
  de contrato.
- **Enlaces a términos**: desde el **checkout** (banner) y desde el **footer** del storefront
  (`(storefront)/layout.tsx`, `nav.terms` "Términos y política"/"Terms & policy").
- Claves i18n nuevas (paridad ES↔EN, cubierta por `i18n-parity.test.ts`): `nav.terms`,
  `checkout.finalSaleNotice`, `checkout.viewTerms`, y el namespace `legal.*` completo (incl.
  `scopeNote`, `platformErrorTitle`/`platformErrorBody`, `disputeWindowNote`).

### E2E añadidos/ajustados (en `e2e/checkout.spec.ts`)

- El aviso de ventas finales aparece en **checkout ES** (`finalSaleNotice` + enlace `viewTerms`) y
  en **checkout EN** (`finalSaleNotice`).
- El enlace de términos navega a `/es/terminos` y muestra la política (refund + disputa +
  excepción por error de plataforma + alcance por tipo de producto + ventana desde la entrega).
- La página de términos existe y muestra la política también en **inglés** (`/en/terminos`),
  incluidas las mismas aclaraciones (`platformErrorBody`, `disputeWindowNote`, `scopeNote`).

Suite E2E total: **30/30** en verde (antes 28). Unit **10/10**, `lint`/`typecheck`/`build` en verde.

## Seguridad — SEC-C2: bump de dependencias vulnerables en runtime (2026-08-13)

Remediación del hallazgo **SEC-C2** (`docs/SECURITY_NOTES.md`): dependencias vulnerables en
runtime del frontend. Objetivo: dejar `npm audit --omit=dev` **sin high/critical**.

### Versiones antes → después

| Paquete | Antes | Después | Motivo |
|---|---|---|---|
| `next` | `14.2.15` | `15.5.23` | Crítica/high: cadena de advisories (SSRF middleware/rewrites, cache poisoning, DoS de RSC/Image Optimizer, XSS con CSP nonces). El 14.2.x —incluso el último 14.2.35— NO limpia el audit: varios advisories solo se parchearon en la línea 15.x. `15.5.23` (tag `backport`, el más parcheado de 15) sí lo limpia y **mantiene React 18** (peer `^18.2.0`), evitando migrar a React 19. |
| `next-intl` | `^3.21.1` (v3) | `^4.13.6` (v4) | Prototype pollution (`experimental.messages.precompile` vía claves de catálogo) + open redirect. Corregidos en v4. |
| `postcss` (dev + empaquetado por next) | `8.4.x` / `8.4.31` | `8.5.26` | High: XSS `</style>`, path traversal/lectura arbitraria de `.map` vía `sourceMappingURL`. Se subió el dev-dep **y** se forzó vía `overrides` para deduplicar todas las copias (incluida la que next empaqueta). |
| `sharp` (dep de optimización de imágenes de next) | `0.34.5` | `0.35.3` (via `overrides`) | High: CVEs heredados de libvips (CVE-2026-33327/33328/35590/35591). next declara `^0.34.3`; el `override` lo fuerza a la línea parcheada `>=0.35.0`. |
| `eslint-config-next` | `14.2.15` | `15.5.23` (dev) | Alinear el config de lint con la major de next. |

`overrides` añadidos en `package.json`: `postcss ^8.5.26`, `sharp ^0.35.3`.

### Breaking changes resueltos

- **Next 15 — `params`/`searchParams` async:** el App Router ahora entrega `params` como
  `Promise`. Migrados a `async` + `await params`:
  - `src/app/[locale]/layout.tsx` (layout **y** `generateMetadata`).
  - `src/app/[locale]/(storefront)/catalog/[cardId]/page.tsx`.
  - `src/app/[locale]/(storefront)/orders/[orderId]/page.tsx`.
  (`npm run typecheck` no lo detecta porque las páginas auto-tipan sus props; **`next build`**
  sí aplica el constraint `PageProps` con `params: Promise<…>`, que es donde saltó.)
- **next-intl v3 → v4:** el código de i18n ya usaba la API moderna compatible con v4
  (`defineRouting`, `createNavigation`, `getRequestConfig({ requestLocale })`,
  `createMiddleware(routing)`, `NextIntlClientProvider` sin prop `locale` en el layout),
  así que **no requirió cambios de i18n**. Verificado que sigue funcionando: rutas `/es|/en`,
  catálogos de mensajes, y el `LocaleToggle` (E2E `i18n-locale.spec.ts` + `auth.spec.ts` en verde).

### Estado del audit tras el bump

- **`npm audit --omit=dev` (runtime): `found 0 vulnerabilities`.** SEC-C2 (parte frontend) cerrado.
- **`npm audit` (incluye dev): 5 restantes (1 critical, 1 high, 3 moderate) — TODAS dev-only y
  no explotables en producción.** Son la cadena del **test runner**:
  `vitest → @vitest/mocker/vite-node → vite → esbuild` (advisory `GHSA-67mh-4wv8-2f99`: el
  dev-server de esbuild acepta requests de cualquier web). **No se empaqueta en el bundle de
  producción** (`output: standalone` no incluye devDependencies) y solo aplica al servidor de
  desarrollo local. Subir a `vitest@4` es un major con cambios de config; se deja como deuda
  menor de tooling. El propio `SECURITY_NOTES.md §0` ya clasificó los críticos de `vitest` como
  dev-only. El gate `security-sast.yml` corre `npm audit` con `--omit=dev` (runtime), por lo que
  estos dev-only no lo bloquean.

### Advertencia benigna en build

`next build` emite un warning de webpack cache sobre `next-intl/dist/esm/production/extractor/
format/index.js` (`import(t)` dinámico del extractor de mensajes de v4). Es informativo (cache
de build), no error; la compilación termina en `✓ Compiled successfully`.

### Verde confirmado (post-bump)

`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` (10/10 unit) ✓ ·
`npm run build` ✓ (SSG) · `npm run test:e2e` (**30/30** Playwright, ES+EN) ✓.

---

## Stack implementado

- **Next.js 15.5 (App Router)** + React 18 + TypeScript.
- **Tailwind CSS** con tokens del DESIGN_SYSTEM §11 (CSS variables claro/oscuro en
  `src/app/globals.css`, mapeo en `tailwind.config.ts`). `darkMode: 'class'`.
- **next-intl v4** para i18n ES/EN (default ES), ruteo `[locale]` con `localePrefix: 'always'`.
  (Subido de v3 → v4 por SEC-C2; ver sección "Seguridad — SEC-C2" arriba.)
- **TanStack Query v5** para data fetching (estados carga/error/vacío consistentes).
- **lucide-react** para iconografía; **clsx + tailwind-merge** (`cn`).
- **Vitest + Testing Library** para tests unitarios.
- **Playwright** (`@playwright/test`) para E2E de flujos contra la app corriendo. Usa el
  **Chromium ya instalado** del entorno (`/opt/pw-browsers/chromium`), sin descargas.
- Output `standalone` (compatible con `Dockerfile.frontend` de devops).

## Cómo correr

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000 (redirige a /es)
npm run lint       # eslint (next/core-web-vitals)
npm run typecheck  # tsc --noEmit
npm run test       # vitest unit (10 tests)
npm run build      # next build (standalone)
npm run test:e2e   # Playwright E2E (30 tests) — ver sección "Tests E2E"
```

Variables (raíz `.env.example`, `NEXT_PUBLIC_*`):
- `NEXT_PUBLIC_API_BASE_URL` — base del API (default `http://localhost:3001/api/v1`).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — clave pública Stripe (aún no cableada, ver TODO).
- `NEXT_PUBLIC_DEFAULT_LOCALE` — `es`.
- **`NEXT_PUBLIC_USE_MOCKS`** (nuevo, opcional) — si NO es `"false"`, el cliente usa
  fixtures locales en vez de llamar al backend. **Default: mocks activos** para poder
  trabajar sin backend. Poner `NEXT_PUBLIC_USE_MOCKS=false` cuando el backend esté arriba.
  → **Solicitud a devops**: añadir esta var al `.env.example` (comentario "local ok").

## Arquitectura del cliente

- **Tipos espejo del contrato**: `src/types/contract.ts` (enums, DTOs base, DTOs por dominio).
- **Cliente API tipado**: `src/lib/api-client.ts` (fetch + `Authorization: Bearer`, mapeo de
  `error.code` a `ApiClientError`) y `src/lib/api.ts` (funciones por endpoint con **fallback a
  mocks**). El punto de integración real está listo: cada función llama a `apiRequest(...)`
  cuando `config.useMocks === false`, usando exactamente las rutas del contrato.
- **Mocks**: `src/lib/mock/fixtures.ts`, marcados `// MOCK: pendiente de backend`. Respetan los
  shapes del contrato; nombres de cartas/sets en inglés (datos de catálogo no se traducen).
- **Mapa de estados** (`src/lib/status-map.ts`): enum del contrato → `{tono de color, forma,
  clave i18n, icono}` según DESIGN_SYSTEM §2.4. Regla **estado = color + texto + icono**.
- **Formato**: `src/lib/format.ts` (`formatMoneyCents` centavos→`MX$`, `formatDate` localizada).
- **Rol de back-office** (`src/lib/role.tsx`): contexto que simula `super_admin`/`vault_operator`
  para demostrar enmascarado financiero y bloqueo de dinero saliente (el backend lo deriva del JWT).

## i18n (ES/EN)

- Catálogos: `messages/es.json` y `messages/en.json`. Cubren `common/nav/catalog/card/checkout/
  vault/shipments/buylist/orders/auth/admin.*` y, clave para el contrato:
  - `status.<domain>.<value>` para **todos los enums** (ownership, order, shipment, sellRequest,
    sellItem, price, dispute, kyc, inventory).
  - `error.<CODE>` para todos los códigos del contrato (`PRICE_PENDING`, `ITEM_NOT_SETTLED`,
    `ADDRESS_NOT_MX`, `BUYLIST_LIMIT_EXCEEDED`, `INE_REQUIRED`, `CLABE_NOT_OWN_NAME`,
    `MONEY_OUT_FORBIDDEN`, etc.).
- Toggle `LocaleToggle` (segmented ES|EN) cambia el locale por ruta. Persistencia con sesión
  (`PATCH /users/me`) queda marcada como TODO cuando exista auth real.
- Un test verifica **paridad de claves ES↔EN** (`i18n-parity.test.ts`) para evitar traducciones
  faltantes, y que cada enum del contrato resuelve a una clave existente en ambos idiomas.

## Pantallas — estado

**Storefront / comprador (completas contra el contrato, con mocks):**
- **Catálogo** (`/catalog`): grid responsivo 2→5, filtros set/rareza/condición/tipo, búsqueda,
  paginación de shape del contrato, PriceTag (venta vs referencia), estados carga/vacío/error.
- **Ficha de carta** (`/catalog/[cardId]`): imagen grande de catálogo (pokemontcg.io), tabs
  (descripción/condición; **sin pestaña "Fotos"** desde v1.2.1), badges condición/grado + certificado
  (`GradedCertChip`/`CertNumberField`), distinción **valor de mercado** vs **precio de venta**, ejemplares.
- **Checkout** (`/checkout`): `AmountBreakdown` (subtotal + fee gross-up **sin IVA** + IVA 16% +
  total), banner CFDI "enviar correo con datos fiscales", banner titularidad pendiente. Pago
  **simulado** (ver TODO Stripe).
- **Mi bóveda** (`/vault`): holdings con badge de titularidad `pending/settled` (color+texto+icono
  candado), **valor de portafolio** contra `referenceValue`, exclusión de precio pendiente, banner
  de custodia, botón retirar deshabilitado para `pending`.
- **Retiro/envío** (`/shipments`): selección de items `settled`, rechazo de no-MX (`ADDRESS_NOT_MX`),
  aviso "solo settled", `AmountBreakdown` de envío+IVA, tarifa fija, PipelineStepper de envío.
- **Buylist** (`/buylist`): cotizador público (categoría+monto o "precio pendiente"), banner
  persistente **PAY_AFTER_RECEIPT**, **guía de envío seguro** (sleeve/top loader) en modal, KYC/
  CLABE/INE avisados, mis solicitudes con PipelineStepper y estados por item.
- **Órdenes** (`/orders`, `/orders/[orderId]`): lista + detalle con desglose, CFDI y solicitar factura.
- **Auth** (`/login`, `/register`) + `LocaleToggle`. Sesión **simulada** (ver TODO).

**Back-office (responsive, captura foto móvil):**
- **Admin shell** (`/admin`): sidebar M1–M10 agrupado, topbar con switch de rol, LocaleToggle,
  ThemeToggle, drawer en móvil. Módulos no permitidos al operador aparecen con candado.
- **Dashboard**: 8 StatCards; enmascarado financiero (candado "Solo súper-admin") para `vault_operator`.
- **M1 Inventario**: alta **sin cámara/uploader de producto** (v1.2.1: se usa la imagen de catálogo remota;
  banner `admin.m1.noPhotoNotice`). Captura tipo/subtipo/condición, **empresa+grado+`certNumber`** (requerido
  para publicar gradeada), ubicación, tipo de adquisición, % aportación con hint de costo; tabla con
  folio/estado/referencia. (El único uploader del sistema es el del INE en el buylist/KYC.)
- **M3 Órdenes**: tabla + **reembolso** destructivo (solo super_admin; operador ve banner
  `MONEY_OUT_FORBIDDEN`).
- **M4 Retiros**: cola de envíos con PipelineStepper + **lista de picking ordenada por ubicación**.
- **M5 Buylist**: PipelineStepper, **cherry-pick por item** (aprobar/ajustar/rechazar/convertir),
  **pago SPEI** solo super_admin.
- **M8 Disputas**: **disputa por correo** (v1.2.1: `DisputeEvidenceContact` con el `evidenceContact` del
  contrato como `mailto:`; **sin comparador de fotos**), imagen de catálogo + descripción y —para gradeadas—
  `GradedCertChip`/`CertNumberField` como base de resolución; resolver recompra (super_admin)/rechazo.

**Pendientes (TODO, documentados en UI):** M2 (precios/FX/override), M6 (usuarios/KYC 360°),
M7 (finanzas/P&L/export CSV), M9 (reportes), M10 (config/diales/bitácora). Rutas creadas con
placeholder `ModuleTodo`; los endpoints del contrato están mapeados en los tipos.

## Componentes del DESIGN_SYSTEM implementados

`Button, Input, Select, Badge, StatusBadge, Banner, Modal, PriceTag, CardImage, ConditionBadge,
ListingCard (CardTile), AmountBreakdown, StatCard, PipelineStepper, PhotoUploader, LocaleToggle,
ThemeToggle, SafeShippingGuide, DataTable (responsive → cards en móvil), EmptyState, Skeleton,
QueryState`. Todos consumen solo tokens semánticos (sin hex crudo), tienen foco visible 3px,
objetivos táctiles ≥44px, y estados carga/vacío/error donde aplica.

## Tests unitarios (vitest, 10, todos verdes)

- `AmountBreakdown.test.tsx`: render de las 4 líneas + total formateado; variante envío; ES y EN.
- `StatusBadge.test.tsx`: enum→texto en ES y EN (cambio de idioma), badge de precio pendiente.
- `format.test.ts`: centavos→MXN, nunca centavos crudos, fecha localizada distinta por locale.
- `i18n-parity.test.ts`: paridad de claves ES↔EN + cobertura enum→clave i18n.

Comando: `npm run test` (vitest). Los unit viven en `src/**/*.test.{ts,tsx}` y están
**separados** de los E2E por script y por config (vitest `include: src/**` no toca `e2e/`).

## Tests E2E (Playwright, 30, todos verdes) — "teoría → realidad"

Verifican los **flujos de usuario contra la app corriendo** (no componentes aislados). Para
QA/devops: mismo espíritu que el humano pidió (que "funcione de verdad", no solo que compile).

### Cómo correr

```bash
cd frontend
npm run test:e2e            # script que invoca devops desde CI
npm run test:e2e:report     # abre el reporte HTML del último run
```

- **Navegador**: Chromium **ya instalado** en el entorno (`/opt/pw-browsers/chromium`).
  `playwright.config.ts` lo apunta con `launchOptions.executablePath` y respeta
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. **No** se corre `playwright install` (sin descargas).
  Sobreescribible con `PLAYWRIGHT_CHROMIUM_PATH`.
- **App bajo prueba**: parametrizada por **`E2E_BASE_URL`** (la app corriendo que levanta devops).
  - Si `E2E_BASE_URL` **está definida** → Playwright **no** levanta server, apunta ahí.
  - Si **no** está definida → Playwright levanta `npm run dev` con **`NEXT_PUBLIC_USE_MOCKS=true`**
    (webServer del config) y prueba en `http://localhost:3000`. Así QA corre los E2E **sin backend**.
- Los asserts usan las **claves i18n reales** de `messages/{es,en}.json` (helper `e2e/utils/i18n.ts`),
  no textos hardcodeados; se prueban **ES y EN** donde aplica. Los datos de catálogo (nombres de
  cartas/sets) se asertan como literales en inglés (por diseño no se traducen).

### Qué cubren (por spec, en `frontend/e2e/`)

- `i18n-locale.spec.ts` — **toggle ES/EN** (AC 32): la UI cambia de idioma, `<html lang>` y el
  prefijo de ruta `/es|/en` se actualizan.
- `auth.spec.ts` — **login/registro** (ES y EN) + toggle de idioma en el shell de auth.
- `catalog.spec.ts` — **catálogo + filtros** (filtra por rareza), **ficha** (valor de mercado vs
  precio de venta, "sin IVA"), carta **"precio pendiente"** no comprable (AC 1, 2, 3, 3b).
- `checkout.spec.ts` — **AmountBreakdown** (subtotal + procesamiento + **IVA 16%** + total),
  mensaje **CFDI por correo**, aviso de titularidad pendiente, pago (simulado) → éxito (AC 4, 30),
  **aviso de ventas finales** (ES y EN) + enlace y página `/terminos` con la política (ES y EN).
- `vault.spec.ts` — **Mi bóveda/portafolio**: titularidad `pending/settled`, valor total, retiro
  solo habilitado para `settled` (AC 5, 6, 8, 10).
- `shipments.spec.ts` — **retiro/envío**: desglose tarifa fija + IVA, rechazo de dirección
  no-MX (`ADDRESS_NOT_MX`), cartas no elegibles (AC 9, 10, 31).
- `buylist.spec.ts` — **cotizador**: EX+ = 40% de la referencia, banner **PAY_AFTER_RECEIPT**,
  **guía de envío seguro** (sleeve/top loader), cola de **precio pendiente** (AC 12, 13, 33, 34).
- `admin.spec.ts` — **panel admin**: dashboard **8 tarjetas**, **enmascarado financiero** para
  `vault_operator`, **M1** (alta sin uploader: aviso de imagen de catálogo + `certNumber` requerido en gradeada),
  **M5** (cherry-pick + nota dinero saliente), **M8** (panel de evidencia por correo, **sin** comparador de
  fotos) (AC 24, 25, 27).

### Qué corre aquí (mocks, sin backend) vs qué necesita backend real

- **Todo el suite corre HOY con `NEXT_PUBLIC_USE_MOCKS=true`** (Chromium local, sin stack). Es el
  modo pensado para que QA lo ejecute sin backend. Los asserts de datos específicos (cartas
  Charizard/Pikachu, totales MXN, portafolio) dependen de los **fixtures** del contrato.
- Contra un **`E2E_BASE_URL` con backend real** los mismos flujos de UI se validan igual, pero:
  - los **datos** deben estar **seeded** de forma equivalente para que los asserts de valores
    concretos coincidan (o se ajustan a datos del backend);
  - las acciones que hoy están **simuladas** en el front pasan a ser **reales**: `POST /auth/*`
    (sesión), **Stripe** en checkout/envío (`/checkout/session`, `/shipments`), **presign+PUT** de
    fotos (`/uploads/presign`) y las **mutaciones de admin** (M1 alta, M3 refund, M5 decisión/convert/
    pay-spei, M8 resolve). Ver "TODO para integración real" abajo.
- **No** hay E2E que dependan de un backend corriendo para poder ejecutarse: el suite es
  **self-contained** en modo mocks. Marcamos arriba qué se vuelve "real" al integrar.

## Supuestos tomados

- Precio de venta = `salePriceCents` del `ListingDTO`; valor de mercado = `referenceValue`
  (`PriceInfo`). PriceTag nunca muestra `$0`: si `status="pending"` y sin salePrice → "Precio
  pendiente" (regla de confianza).
- IVA/fee/gross-up: la UI solo **muestra** el `BreakdownDTO` del backend. Se añadió
  `computeBreakdown` (mock) replicando ARCHITECTURE §5.1 solo para los fixtures; en producción los
  valores vienen del contrato (incluido `ivaRatePct`).
- Fuente única de monto = centavos del contrato; formateo en la capa de presentación.

## Fricciones / solicitudes al arquitecto (no bloquean; NO edité el contrato)

1. **`NEXT_PUBLIC_USE_MOCKS`**: var nueva del frontend para alternar mocks/real. Solicito a devops
   añadirla al `.env.example`. No afecta al contrato.
2. **`capturedDate` en todos los `ListingDTO`**: el diseño muestra la fecha del precio en catálogo y
   bóveda. Confirmar que `PriceInfo.capturedDate` viene poblado en listados (no solo en detalle)
   —igual que anotó ux-ui en DESIGN_SYSTEM §13.1—. La UI lo maneja como opcional si falta.
2. **Fee de procesamiento (tooltip)**: se muestra copy genérico "cubre el procesamiento del pago"
   (DESIGN_SYSTEM §13.2). Sin cambio de contrato.
3. **Presign de fotos**: `PhotoUploader` está listo para `POST /uploads/presign` + `PUT` directo;
   hoy la subida es simulada. Cableado real cuando el backend exponga el bucket (S3/MinIO).

## TODO para integración real (cuando el backend corra)

- Poner `NEXT_PUBLIC_USE_MOCKS=false`; validar shapes 1:1 con el backend.
- **Auth real**: `POST /auth/login|register|refresh`, refresh token, `GET /users/me`, guardado de
  `locale` en `PATCH /users/me`. Hoy la sesión es un token mock en localStorage.
- **Stripe**: montar `@stripe/stripe-js` + Elements con el `clientSecret` de
  `POST /checkout/session` y `POST /shipments`. Hoy el botón de pago simula el flujo.
- **PhotoUploader**: presign PUT real (`/uploads/presign`).
- Cablear mutaciones de admin (M1 alta, M3 refund, M5 decisiones/convert/pay-spei, M8 resolve) a
  sus endpoints `/admin/*`.
- **Self-host de Inter** vía `next/font` (hoy fallback de sistema para evitar dependencia de red en
  build; los tokens tipográficos ya están listos).

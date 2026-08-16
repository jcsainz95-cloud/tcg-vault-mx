# FRONTEND_NOTES.md — Marketplace TCG con Bóveda

> Propiedad: **frontend**. Decisiones de implementación del cliente Next.js.
> Fecha: 2026-08-13. Branch: `claude/tcg-cards-marketplace-oijthj`.
> El contrato (`docs/API_CONTRACT.md`) y el sistema de diseño (`docs/DESIGN_SYSTEM.md`) mandan.

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
  `soporte@tcgvault.mx`); graded **no** genera disputa (coherente con `422 NOT_RAW`).
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
  El correo `soporte@tcgvault.mx` sigue marcado como *placeholder por confirmar por el humano* en PROJECT/CONTRATO.

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
- Email/dominio placeholder `boveda-tcg.mx` → **`tcgvault.mx`**: `checkout.cfdiNotice` ahora usa
  `facturacion@tcgvault.mx` (ES y EN). El `tagline` se mantiene sin cambios.
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

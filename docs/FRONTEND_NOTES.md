# FRONTEND_NOTES.md — Marketplace TCG con Bóveda

> Propiedad: **frontend**. Decisiones de implementación del cliente Next.js.
> Fecha: 2026-08-13. Branch: `claude/tcg-cards-marketplace-oijthj`.
> El contrato (`docs/API_CONTRACT.md`) y el sistema de diseño (`docs/DESIGN_SYSTEM.md`) mandan.

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
  `generateMetadata` propio. Namespace i18n `legal.*` con: intro, **reembolsos/ventas finales**
  (`refundTitle`/`refundBody`) y **disputa de condición** (`disputeTitle`/`disputeBody`/
  `disputeOutcome`: 7 días, fotos, compensa y conservas la carta). Usa tokens del DESIGN_SYSTEM
  (Banner warning + card con borde).
- **Enlaces a términos**: desde el **checkout** (banner) y desde el **footer** del storefront
  (`(storefront)/layout.tsx`, `nav.terms` "Términos y política"/"Terms & policy").
- Claves i18n nuevas (paridad ES↔EN, cubierta por `i18n-parity.test.ts`): `nav.terms`,
  `checkout.finalSaleNotice`, `checkout.viewTerms`, y el namespace `legal.*` completo.

### E2E añadidos/ajustados (en `e2e/checkout.spec.ts`)

- El aviso de ventas finales aparece en **checkout ES** (`finalSaleNotice` + enlace `viewTerms`) y
  en **checkout EN** (`finalSaleNotice`).
- El enlace de términos navega a `/es/terminos` y muestra la política (refund + disputa).
- La página de términos existe y muestra la política también en **inglés** (`/en/terminos`).

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
- **Ficha de carta** (`/catalog/[cardId]`): imagen grande, tabs (descripción/condición/fotos),
  badges condición/grado, distinción **valor de mercado** vs **precio de venta**, ejemplares.
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
- **M1 Inventario**: alta con `PhotoUploader` anverso/reverso (captura móvil), ubicación, tipo de
  adquisición, % aportación con hint de costo; tabla con folio/estado/referencia.
- **M3 Órdenes**: tabla + **reembolso** destructivo (solo super_admin; operador ve banner
  `MONEY_OUT_FORBIDDEN`).
- **M4 Retiros**: cola de envíos con PipelineStepper + **lista de picking ordenada por ubicación**.
- **M5 Buylist**: PipelineStepper, **cherry-pick por item** (aprobar/ajustar/rechazar/convertir),
  **pago SPEI** solo super_admin.
- **M8 Disputas**: **comparador de fotos** ingreso vs reclamo, resolver recompra (super_admin)/rechazo.

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
  `vault_operator`, **M1** (PhotoUploader anverso/reverso), **M5** (cherry-pick + nota dinero
  saliente), **M8** (comparador de fotos) (AC 24, 25, 27).

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

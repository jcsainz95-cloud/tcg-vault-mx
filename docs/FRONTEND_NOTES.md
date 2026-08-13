# FRONTEND_NOTES.md — Marketplace TCG con Bóveda

> Propiedad: **frontend**. Decisiones de implementación del cliente Next.js.
> Fecha: 2026-08-13. Branch: `claude/tcg-cards-marketplace-oijthj`.
> El contrato (`docs/API_CONTRACT.md`) y el sistema de diseño (`docs/DESIGN_SYSTEM.md`) mandan.

## Stack implementado

- **Next.js 14.2 (App Router)** + React 18 + TypeScript.
- **Tailwind CSS** con tokens del DESIGN_SYSTEM §11 (CSS variables claro/oscuro en
  `src/app/globals.css`, mapeo en `tailwind.config.ts`). `darkMode: 'class'`.
- **next-intl v3** para i18n ES/EN (default ES), ruteo `[locale]` con `localePrefix: 'always'`.
- **TanStack Query v5** para data fetching (estados carga/error/vacío consistentes).
- **lucide-react** para iconografía; **clsx + tailwind-merge** (`cn`).
- **Vitest + Testing Library** para tests.
- Output `standalone` (compatible con `Dockerfile.frontend` de devops).

## Cómo correr

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000 (redirige a /es)
npm run lint       # eslint (next/core-web-vitals)
npm run typecheck  # tsc --noEmit
npm run test       # vitest (10 tests)
npm run build      # next build (standalone)
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

## Tests (10, todos verdes)

- `AmountBreakdown.test.tsx`: render de las 4 líneas + total formateado; variante envío; ES y EN.
- `StatusBadge.test.tsx`: enum→texto en ES y EN (cambio de idioma), badge de precio pendiente.
- `format.test.ts`: centavos→MXN, nunca centavos crudos, fecha localizada distinta por locale.
- `i18n-parity.test.ts`: paridad de claves ES↔EN + cobertura enum→clave i18n.

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

# TECH_DEBT.md — Marketplace TCG con Bóveda

> Registro de **deuda técnica aceptada, no bloqueante**, acordada con el techlead. Cada ítem indica
> **dueño**, **impacto** y **disparador** (cuándo hay que abordarlo). La deuda bloqueante NO va aquí:
> se corrige antes de cerrar. Propiedad de este archivo: **el rol dueño del código anotado** (a petición
> del techlead). Cada rol mantiene su propia sección.

---

## Backend (dueño: backend)

> Los 3 hallazgos de correctness de dinero marcados como gate de go-live (reserva de checkout atómica,
> validación de diales M10, y acotado por periodo de reportes) **ya están corregidos** con tests; no
> figuran como deuda.

### BE-1 · La recompra de disputa no ejecuta reembolso Stripe real — RESUELTA/OBSOLETA
- **Dónde:** `src/modules/disputes/disputes.service.ts` → `resolve(resolution='repurchase')`.
- **Estado actual (2026-08-13):** **resuelta.** Con la política de **VENTAS FINALES**, la recompra por
  disputa **ya NO revierte el item al inventario** — el cliente **conserva la carta**. El remedio ahora
  **compensa dinero al cliente** (money-out) por el precio de recompra y queda **auditado**, con
  idempotencia; ya no se mueve a mano ni queda solo como texto en `resolution`.
- **Nota:** entrada conservada como registro histórico. El supuesto original ("revierte el item al
  inventario" + "solo registra el remedio, sin mover dinero") es **obsoleto**: la política correcta ya
  está implementada. Ya no aplica como deuda técnica.

### BE-2 · TOCTOU en operaciones que aún no son atómicas
- **Dónde:** `buylist.service.ts` → `convertToInventory` (check `inventoryItemId` + create), asignación de
  item a envío (`shipments.service.ts` → chequeo "en otro envío" + create), y el **tope mensual** de
  buylist (`createRequest`: lee `monthUsedCents` y luego crea, sin candado).
- **Estado actual:** son check-then-act no transaccionales; dos peticiones concurrentes podrían
  doble-convertir un `SellRequestItem`, meter un item en dos envíos, o exceder ligeramente el tope mensual.
- **Impacto:** medio. Requiere concurrencia real del mismo recurso (poco probable con un admin operando en
  serie en el MVP), pero puede producir un item duplicado en inventario o un rebase del tope.
- **Disparador:** cuando haya más de un operador concurrente, o antes de automatizar buylist. Solución:
  `unique constraint` (p. ej. `SellRequestItem.inventoryItemId` único; `ShipmentItem.inventoryItemId`
  único sobre envíos activos) y/o transacción con `updateMany`+count como ya se hizo en checkout (#1).

### BE-3 · `buylist-sweep` a 30 días marca `abandonada` pero no convierte a inventario
- **Dónde:** `src/jobs/buylist-sweep.service.ts`.
- **Estado actual:** a los 30 días de abandono la solicitud pasa a `abandonada`; **no** ejecuta la
  conversión automática a inventario. Cumple PROJECT criterio 16 solo parcialmente (el 7d→rechazo sí).
- **Impacto:** bajo. Las cartas abandonadas quedan visibles en la cola para que el admin las convierta con
  un clic (`convert-to-inventory`), pero no entran a inventario solas.
- **Disparador:** cuando el volumen de abandonos justifique automatizarlo, o al cablear el scheduler
  (ver BE-5). Solución: en el sweep, tras `abandonada`, invocar la conversión de sus items aprobados.

### BE-4 · N+1 de `getReference` en valuaciones
- **Dónde:** `vault.service.ts` → `holdings`; `admin.service.ts` → `inventoryValue` / `custodyValue`;
  `orders.service.ts` → `salePriceOf` (en bucle de checkout).
- **Estado actual:** por cada item se hace una consulta `PriceReference.findFirst`. Con bóvedas grandes se
  vuelven decenas/cientos de queries por request.
- **Impacto:** rendimiento (latencia del portafolio y de las tarjetas financieras) al crecer el inventario.
  Correctness OK.
- **Disparador:** cuando el portafolio/inventario supere ~unos cientos de items o la latencia de esos
  endpoints moleste. Solución: batch/`IN` de referencias por `(cardId, productType, gradeKey, capturedDate)`
  y map en memoria, o una vista materializada de "última referencia por combinación".

### BE-5 · Scheduling BullMQ de los 4 jobs pendiente (lógica lista)
- **Dónde:** `src/jobs/*` (`price-sync`, `fx-refresh`, `buylist-sweep`, `dispute-deadline`).
- **Estado actual:** la **lógica** de los jobs está implementada y es invocable; falta el wrapper de
  `@nestjs/bullmq` con **repeatable jobs** (Redis) para correrlos en cron. `price-sync` y `fx-refresh` se
  pueden disparar por endpoint admin; `buylist-sweep` y `dispute-deadline` no tienen endpoint aún.
- **Impacto:** sin scheduler, las tareas diarias (sync de precios, FX, plazos 7d/30d, ventana de disputa)
  **no corren solas**; hay que dispararlas manualmente. Bloquea la operación "desatendida" pero no la
  correctness puntual.
- **Disparador:** antes de la beta cerrada (los plazos de buylist y el refresco diario deben ser
  automáticos). Solución: registrar los 4 servicios como workers BullMQ con `repeat` y conexión a `REDIS_URL`.

### BE-6 · Providers de precio graded/sealed son stubs
- **Dónde:** `src/modules/pricing/providers/graded-sealed.providers.ts`.
- **Estado actual:** `PokemonPriceTracker`/`PokeTrace` devuelven `null` (sin endpoint/clave confirmados) ⇒
  las cartas gradeadas/selladas caen a **"precio pendiente"** y dependen del **override manual** del admin
  (que sí funciona). El provider de raw (pokemontcg.io) sí hace fetch real.
- **Impacto:** medio para el catálogo de gradeadas/sellado: sin override manual, esas cartas no son
  vendibles automáticamente. No rompe nada (la regla "nunca se descarta" aplica).
- **Disparador:** cuando se contraten/confirmen las credenciales y el contrato de esos proveedores, o al
  subir a plan de pago. Solución: implementar `fetchPrice` real respetando el rate-limit del free tier.

### BE-7 · Orden `pending` huérfana si Stripe falla tras confirmar la reserva
- **Dónde:** `src/modules/orders/orders.service.ts` → `createSession` (crea Order+reserva en tx, luego
  llama a Stripe fuera de la tx).
- **Estado actual:** si `createPaymentIntent` falla **después** de commitear la reserva, la Order queda
  `pending` y los items `reserved` sin `PaymentIntent` asociado, sin compensación automática.
- **Impacto:** bajo pero real: items "atascados" en `reserved` que no se liberan solos (no hay
  `payment_failed` porque nunca hubo PI). Requiere intervención manual o un barrido.
- **Disparador:** al endurecer el flujo de pago para producción. Solución: `try/catch` alrededor de Stripe
  que revierta la reserva (items→`listed`, Order→`failed`) si falla la creación del PI, y/o un job de
  expiración de reservas `pending` sin PI tras N minutos.

### BE-8 · CORS `origin: true` en `main.ts`
- **Dónde:** `src/main.ts` → `app.enableCors({ origin: true, credentials: true })`.
- **Estado actual:** refleja cualquier origen (cómodo en dev). En producción es demasiado permisivo.
- **Impacto:** seguridad (CSRF/abuso de credenciales) si se despliega tal cual con `credentials: true`.
- **Disparador:** antes del primer despliegue público. Solución: restringir `origin` a `APP_BASE_URL`
  (y dominios del frontend) leídos de env; coordinar con devops.

### Deuda del pase v1.1 (hallazgos QA/techlead sobre alcance v1.1)

> Del lote de fixes v1.1: **D4 y D5 quedaron RESUELTAS** en este mismo pase (ver más abajo). **D1, D2 y
> D3** se registran aquí como deuda aceptada no bloqueante.

### D1 · Sync de catálogo M2 es síncrono con `jobId` ficticio (falta cola BullMQ)
- **Dónde:** `src/modules/catalog/catalog-sync.service.ts` (`POST /admin/catalog/sync`,
  `POST /admin/catalog/backfill`) y su controlador admin.
- **Estado actual:** la ingesta desde pokemontcg.io se ejecuta **en el propio request** y devuelve un
  `jobId` **fabricado** (no hay worker/cola real detrás). El contrato §M2 modela `sync` como `202 { jobId }`
  (asíncrono), pero hoy la operación es efectivamente síncrona.
- **Impacto:** medio. Un set grande o un backfill amplio puede exceder el timeout HTTP y no respeta el
  rate-limit del free tier vía cola (ARCHITECTURE §4.8 pide BullMQ). El `jobId` no es consultable.
- **Disparador:** antes de poblar el catálogo a escala (backfill de colecciones antiguas) o al cablear el
  scheduler (BE-5). Solución: encolar la ingesta en BullMQ (misma cola con rate-limit), persistir el estado
  del job y devolver un `jobId` real consultable.

### D2 · `PokemonTcgIoClient.getSets()` sin paginación (trunca > 250 sets)
- **Dónde:** `src/modules/catalog/pokemontcg-io.client.ts` → `getSets()` (usado por `remote-sets`,
  `sync` sin `setId` y `backfill`).
- **Estado actual:** hace una sola llamada a `/v2/sets` con el `pageSize` por defecto de la API (250). Al
  superar los 250 sets existentes en pokemontcg.io, **la lista queda truncada** y los sets más allá de la
  primera página no se ven/importan/backfillean.
- **Impacto:** medio a futuro. Hoy pokemontcg.io ronda ese umbral; en cuanto lo cruce, `remote-sets` y el
  cálculo de `remaining`/`newBoundary` del backfill se vuelven incompletos silenciosamente.
- **Disparador:** cuando el total de sets remotos supere 250 (o al implementar D1). Solución: iterar
  `page`/`pageSize` hasta agotar `totalCount`, acumulando todas las páginas.

### D3 · N+1 de snapshot/holdings en `PricingService.getReference` (portafolio)
- **Dónde:** `src/modules/vault/vault.service.ts` → `holdings()` y el job `portfolio-snapshot`, que llaman
  `PricingService.getReference` por cada holding.
- **Estado actual:** una consulta de `PriceReference` por item; con bóvedas grandes son decenas/cientos de
  queries por request/snapshot. (Es la misma familia que BE-4, acotada aquí al camino de portafolio/gráfica
  de tendencia v1.1.)
- **Impacto:** rendimiento de "Mi bóveda" y del snapshot diario al crecer el inventario del usuario.
  Correctness OK.
- **Disparador:** cuando un usuario supere ~cientos de holdings o el snapshot diario se vuelva lento.
  Solución: batch de referencias por `(cardId, productType, gradeKey, capturedDate)` con un `IN` y map en
  memoria, reutilizado por `holdings()` y el job.

### D4 · Exponer `stripeFeeIvaPct` en el DTO de settings — RESUELTA (pase v1.1)
- **Dónde:** `src/modules/settings/settings.constants.ts` → `SETTING_DTO_MAP`.
- **Estado:** **resuelta.** El contrato §M10 ya listaba `stripeFeeIvaPct` en el DTO de `GET/PUT
  /admin/settings`, pero faltaba en `SETTING_DTO_MAP`. Se añadió con su validador de rango (fracción
  `[0,1)`) y se cubrió con tests (`test/settings.validation.spec.ts`: lectura vía `getAllDto` +
  actualización). Ya no es deuda.

### D5 · Enumeración por temporización en login — RESUELTA (pase v1.1)
- **Dónde:** `src/modules/auth/auth.service.ts` → `login`.
- **Estado:** **resuelta.** Antes retornaba temprano (401) si el usuario no existía o si `passwordHash`
  era null, dejando un canal de temporización (el comentario prometía una mitigación ausente). Ahora se
  ejecuta **siempre** `argon2.verify` — contra un **hash dummy fijo precomputado** cuando no hay
  usuario/`passwordHash` null — para igualar la latencia; se mantiene `401 INVALID_CREDENTIALS` y el caso
  Google intacto. Cubierto con tests (`test/auth.login-timing.spec.ts`). Ya no es deuda.

---

## Frontend (dueño: frontend)

> Deuda aceptada, no bloqueante para el MVP. El cliente compila y pasa lint/typecheck/test/build; todas
> las pantallas priorizadas funcionan contra los shapes del contrato. Lo de abajo es lo que queda para la
> fase de integración con el backend real y post-MVP. Detalle operativo en `docs/FRONTEND_NOTES.md`.

### FE-1 · Mocks activos por default + `computeBreakdown` duplica la fórmula de dinero
- **Dónde:** `frontend/src/lib/config.ts` (`useMocks` default `true`), `frontend/src/lib/api.ts`
  (`computeBreakdown`, réplica local de ARCHITECTURE §5.1) y `frontend/src/lib/mock/fixtures.ts`.
- **Estado actual:** con `NEXT_PUBLIC_USE_MOCKS` distinto de `"false"` el cliente sirve fixtures locales.
  El desglose de dinero de esos fixtures se calcula con `computeBreakdown` (subtotal + IVA 16% + fee
  gross-up), que **duplica** la fórmula del backend solo para tener números coherentes en los mocks.
- **Impacto:** riesgo de **divergencia** si el backend cambia IVA/markup/tarifa Stripe o la fórmula de
  gross-up: los mocks mostrarían cifras que ya no coinciden. En producción no aplica (la UI solo pinta el
  `BreakdownDTO` que llega del backend), pero mantener la fórmula duplicada puede confundir.
- **Disparador:** al integrar con backend real (`NEXT_PUBLIC_USE_MOCKS=false`). Acción: **eliminar**
  `computeBreakdown` del camino real y consumir el `BreakdownDTO` del backend (incluido `ivaRatePct`) como
  **única fuente**; dejar la fórmula solo en fixtures o retirarla del bundle de producción.

### FE-2 · Integraciones reales pendientes (auth, Stripe, presign de fotos, mutaciones admin)
- **Dónde:** `frontend/src/components/domain/AuthForm.tsx` (token local simulado en `localStorage`),
  `frontend/src/app/[locale]/(storefront)/checkout/CheckoutView.tsx` y `.../shipments/ShipmentsView.tsx`
  (pago simulado, sin Stripe Elements), `frontend/src/components/ui/PhotoUploader.tsx` (subida simulada,
  sin presign PUT), y las vistas admin M1/M3/M5/M8 (acciones sin `mutation` cableada a `/admin/*`).
- **Estado actual:** el cliente API tipado (`frontend/src/lib/api.ts`) ya llama a las rutas reales del
  contrato cuando `useMocks=false`; faltan las piezas que dependen de credenciales/SDK externos y las
  mutaciones de escritura del panel.
- **Impacto:** hasta cablearlas, no hay auth real, no se cobra por Stripe, no se suben fotos a S3/MinIO y
  las decisiones de admin no persisten. No afecta la navegación ni la lectura del MVP con mocks.
- **Disparador:** fase de integración con backend. Acción: montar `@stripe/stripe-js` + Elements con el
  `clientSecret` de `POST /checkout/session` y `POST /shipments`; auth con `POST /auth/login|register|refresh`,
  `GET /users/me` y `PATCH /users/me { locale }`; `POST /uploads/presign` + `PUT` directo en `PhotoUploader`;
  y `useMutation` para M1 alta, M3 refund, M5 decisiones/convert/pay-spei, M8 resolve.

### FE-3 · UI de módulos admin M2/M6/M7/M9/M10 en placeholder
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/{m2,m6,m7,m9,m10}/page.tsx` +
  `frontend/src/components/domain/ModuleTodo.tsx`.
- **Estado actual:** M1, M3, M4, M5 y M8 (más dashboard) tienen UI funcional; M2 (precios/FX/override),
  M6 (usuarios/KYC 360°), M7 (finanzas/P&L/export CSV), M9 (reportes) y M10 (config/diales/bitácora)
  muestran un placeholder `ModuleTodo`. Los tipos y rutas del contrato ya están mapeados.
- **Impacto:** faltan superficies del back-office; no bloquea las verticales priorizadas del MVP.
- **Disparador:** post-MVP / fase 2, o cuando el negocio necesite operar esos módulos desde la UI. Acción:
  construir las vistas consumiendo `/admin/pricing/*`, `/admin/fx`, `/admin/users/*`, `/admin/finance/*`,
  `/admin/reports/*`, `/admin/settings` y `/admin/audit-log`, reutilizando `DataTable`, `StatCard`,
  `Modal` y el enmascarado por rol ya existentes.

### FE-4 · Sesión/enmascarado por rol simulados en cliente
- **Dónde:** `frontend/src/lib/role.tsx` (contexto que alterna `super_admin`/`vault_operator` vía
  `localStorage`) y `frontend/src/lib/api-client.ts` (token en `localStorage`).
- **Estado actual:** el rol de back-office se elige con un switch en el topbar para **demostrar** el
  enmascarado financiero y el bloqueo de dinero saliente; el backend deriva el rol del JWT. No hay guardas
  de ruta reales ni expiración/refresh de token en el cliente.
- **Impacto:** el enmascarado del cliente es **presentacional**; la autorización real la impone el backend
  (contrato §7). Sin auth real, cualquiera puede cambiar el switch de rol. No es una brecha de producción
  porque el servidor manda, pero la UX de sesión está incompleta.
- **Disparador:** junto con FE-2 (auth real). Acción: derivar el rol de `GET /users/me`, proteger las rutas
  `(admin)/*` según rol, y manejar refresh/expiración y `403 MONEY_OUT_FORBIDDEN` desde el backend.

### FE-5 · Fuente Inter no self-hosted (fallback de sistema)
- **Dónde:** `frontend/src/app/globals.css` (`--font-inter: 'Inter'` con fallback `system-ui`) y
  `frontend/tailwind.config.ts` (`fontFamily.sans`).
- **Estado actual:** para evitar dependencia de red en el build (descarga de Google Fonts), no se usa
  `next/font`; los tokens tipográficos del DESIGN_SYSTEM ya están listos, pero si el sistema no tiene Inter
  se cae a la fuente del sistema.
- **Impacto:** cosmético/consistencia de marca entre entornos; sin efecto en accesibilidad ni layout
  (los tamaños/pesos y `tabular-nums` se respetan igual).
- **Disparador:** al pulir el look final o cuando devops confirme acceso a fuentes en build. Acción:
  self-host de Inter (variable) vía `next/font/local` o `next/font/google` con subconjunto `latin`+`latin-ext`.

### FE-6 · Persistencia de `locale` con sesión pendiente
- **Dónde:** `frontend/src/components/ui/LocaleToggle.tsx`.
- **Estado actual:** el toggle ES/EN cambia el idioma por ruta (`[locale]`), pero no persiste la preferencia
  en `User.locale` (`PATCH /users/me`) porque aún no hay auth real; sin sesión, depende del prefijo de ruta.
- **Impacto:** bajo. El idioma funciona y es consistente por navegación; solo falta recordar la preferencia
  del usuario logueado entre dispositivos.
- **Disparador:** junto con FE-2 (auth real). Acción: al cambiar locale con sesión activa, llamar
  `PATCH /users/me { locale }` además de actualizar la ruta.

### Deuda del pase v1.1 (hallazgos techlead sobre alcance v1.1)

> De este pase v1.1: **D6 quedó RESUELTA** (el botón de Google ya no se atasca en "connecting" al
> descartar el prompt de GIS: se maneja `PromptMomentNotification` + timeout de respaldo, con test).
> **D7** se registra aquí como deuda aceptada no bloqueante (sin cambiar el comportamiento del mock).

### D7 · La lógica de negocio del mock re-implementa reglas del backend y puede derivar
- **Dónde:** `frontend/src/lib/api.ts` → `computeBreakdown` (desglose de dinero de checkout/envíos) y
  `getBuylistQuote` (cotizador de buylist), ambos solo en la rama `config.useMocks`.
- **Estado actual:** duplicación de **reglas de negocio** del backend, con dos derivas concretas:
  - `computeBreakdown` calcula el gross-up del fee Stripe **omitiendo `(1 + stripeFeeIvaPct)`**: hace
    `total = ceil((base + fixed) / (1 − stripePct))` sin cubrir el IVA que Stripe MX cobra sobre su
    comisión (dial `stripe_fee_iva_pct`, default 0.16; ver ARCHITECTURE §5.1 y contrato §4). El
    `processingFeeCents` del mock queda **por debajo** del que devolverá el backend.
  - `getBuylistQuote` **reimplementa** `categoryForRarity`/`quoteAcquisition` con una **regex propia**
    (`/holo|rare|ex|illustration|full|art|radiant|ultra/`) en lugar de la tabla `pricing/rarity-map`
    (dial M2/M10) y de la regla EX+ = `round(referencia × 0.40)` que vive en el backend/contrato §6.
- **Impacto:** bajo pero real: es duplicación que **envejece** — si el backend cambia la fórmula de
  gross-up, el IVA/markup o el mapeo rareza→categoría, los fixtures mostrarían cifras/categorías que ya
  no coinciden. **Aceptable** porque está **aislado tras `config.useMocks`** (solo demo sin backend); en
  producción (`useMocks=false`) la UI pinta el `BreakdownDTO`/quote que llega del backend, única fuente.
  (Es la misma familia que FE-1, aquí acotada a las dos derivas puntuales señaladas por techlead.)
- **Disparador:** si el mock **crece** o empieza a usarse como referencia numérica. Acción: mover los
  fixtures a consumir los **mismos helpers puros del contrato** (gross-up con `(1+stripeFeeIvaPct)` y
  `categoryForRarity`/`quoteAcquisition` compartidos), o retirar la lógica del bundle real. **No** se
  cambia el comportamiento del mock ahora (evita romper fixtures/E2E que asumen los números actuales).

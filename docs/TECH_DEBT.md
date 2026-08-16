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

### CI-1 · CI en rojo por tests env-sensibles (REDIS_URL) — RESUELTO (2026-08-16)
- **Dueño:** backend. **Estado:** **RESUELTO** (solo cambio de tests; producción intacta).
- **Síntoma:** el job `backend` del workflow **CI** estaba en rojo en **toda la historia** del repo
  (no es regresión de Ronda C): **2 tests fallaban / 348 pasaban**. Verde en local/qa.
- **Causa raíz:** CI levanta un contenedor Redis y **exporta `REDIS_URL`**. Dos suites afirmaban
  comportamiento "sin Redis" leyendo la variable con `ConfigService.get('REDIS_URL')`, que **cae a
  `process.env`** → fuga de entorno. Afectadas: `test/health-redis.provider.spec.ts` («sin REDIS_URL:
  resuelve a null») y `test/scheduler.spec.ts` («sin REDIS_URL: onModuleInit es no-op», gating BE-5/v15-D1).
- **Fix:** aislar `process.env.REDIS_URL` (guardar/borrar en `beforeEach`, restaurar en `afterEach`) en el
  bloque que ejerce el caso "sin REDIS_URL". Sin tocar `health-redis.provider.ts` ni `scheduler.service.ts`
  (el bug estaba en el test, no en el gating). Verificado con y sin `REDIS_URL`: **56 suites / 350 tests
  verdes** en ambos; `lint`/`typecheck`/`build` verdes. Detalle en `BACKEND_NOTES.md §28`.
- **Nota de alcance:** los workflows **Security SAST**, **E2E** y **deploy.yml** siguen fallando por causas
  de **infra/secrets separadas** (dueño **devops/humano**) — fuera del alcance de este fix de backend.

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

### BE-5 · Scheduling BullMQ de los jobs — RESUELTA (pase P0 jobs de barrido)
- **Dónde:** `src/jobs/scheduler.service.ts` + `src/jobs/admin-jobs.controller.ts`.
- **Estado:** **resuelta.** El scheduler ahora programa **los 7 jobs diarios** repetibles BullMQ
  (`fx-refresh`, `price-sync`, `portfolio-snapshot`, `ine-retention`, `buylist-sweep`, `dispute-deadline`,
  `auth-token-sweep`) con `repeat`+`jobId` single-flight y conexión a `REDIS_URL` (sin Redis queda
  deshabilitado, jobs disparables a mano). Los 4 barridos también son **disparables manualmente** por
  `POST /admin/jobs/*` (super_admin, auditado). Cubierto con tests (`test/scheduler.spec.ts` mockea
  bullmq/ioredis; `test/admin-jobs.controller.spec.ts`). Detalle: `docs/BACKEND_NOTES.md §18.1/§18.2`.
- **Nota:** BE-3 (conversión a inventario del abandono a 30 días en `buylist-sweep`) **sigue diferida** como
  deuda propia; este pase cableó el `run()` **actual** (7d/30d) sin cambiar su comportamiento.

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

### BE-8 · CORS `origin: true` en `main.ts` — RESUELTA/OBSOLETA
- **Dónde:** `src/main.ts` → `enableCors`.
- **Estado:** **resuelta.** Ya **no** usa `origin: true`. `resolveCorsOrigins()` construye una **allow-list**
  desde `APP_BASE_URL` (lista separada por comas) con `credentials: true`; fallback seguro a orígenes de dev
  local (`http://localhost:3000`, `:5173`) — **nunca** un comodín ni reflejo de origen arbitrario. En
  staging/prod `APP_BASE_URL` DEBE fijarse (coordinado con devops). Entrada conservada como registro
  histórico; ya no aplica como deuda.

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

### Deuda del pase correo v1.5 (hallazgos seguridad — Baja, aceptada)

> Del pase de **feature de correo v1.5** (verificación + reset por email). Los hallazgos **S15-B1**
> (escape de HTML en plantillas) y **S15-B4** (revalidar `status` en reset) se **cerraron** en este
> mismo pase y **no** figuran como deuda. Lo de abajo es la deuda **Baja aceptada** que seguridad
> autorizó a diferir. IDs prefijados `v15-` para no colisionar con la D1–D3 del pase v1.1 (arriba).

### v15-D1 · `auth-token-sweep` sin disparador automático — RESUELTA (pase P0 jobs de barrido)
- **Dónde:** `src/jobs/auth-token-sweep.service.ts` + `src/jobs/scheduler.service.ts`.
- **Estado:** **resuelta.** `auth-token-sweep` (junto con `buylist-sweep`, `dispute-deadline`,
  `ine-retention`) ya está cableado como job repetible BullMQ en el scheduler (`repeat` + `case` en el worker,
  cron diario `15 8 * * *`) y también es disparable a mano por `POST /admin/jobs/auth-token-sweep`
  (super_admin, auditado). La tabla `AuthToken` ya se poda sola cuando hay `REDIS_URL`. Ver BE-5 arriba y
  `docs/BACKEND_NOTES.md §18`. Nota v15-D2 (claim-luego-lectura no transaccional en `consume`) sigue como
  deuda propia: al activarse el sweep conviene envolver claim+lectura en tx (ver v15-D2).

### v15-D2 · `AuthTokenService.consume`/`ownerOf`: claim-luego-lectura no transaccional
- **Dónde:** `src/modules/auth/auth-token.service.ts:53-65` (`consume`) y `:68-75` (`ownerOf`).
- **Estado actual:** `consume` hace `updateMany` (claim atómico de `usedAt`) y **después** un `findUnique`
  para leer el `userId`; los dos pasos no van en una transacción. Si un **sweep** (v15-D1) borrara la fila
  justo entre ambos pasos, el `findUnique` devolvería `null` y el flujo daría un **422 espurio** (token
  "inválido") pese al claim exitoso. Ventana **teórica**: hoy no hay sweep corriendo (v15-D1) y las filas
  no se borran, así que no se materializa.
- **Impacto:** bajo. A lo sumo un 422 espurio ocasional que el usuario resuelve reintentando; nunca fija
  contraseña ni verifica de más (el claim ya ocurrió; el peor caso es no-progreso, no un bypass).
- **Disparador:** al activar el sweep (v15-D1) o si aparece el 422 espurio en producción. Solución: envolver
  claim+lectura en `$transaction`, o **retornar el `userId` en el mismo `updateMany`** (p. ej. `UPDATE ...
  RETURNING userId` vía `$queryRaw`) para eliminar la segunda lectura.

### v15-D3 · Rate-limit de correos por conteo en BD (`countIssuedLastHour`) es TOCTOU
- **Dónde:** `src/modules/auth/auth-token.service.ts:78-82` (`countIssuedLastHour`), usado por
  `resendVerification` y `forgotPassword` (tope 3/h/usuario).
- **Estado actual:** el tope se evalúa leyendo un `count` y luego emitiendo; una **ráfaga concurrente**
  podría leer el mismo valor y superar el límite de 3 (p. ej. emitir 4-5). **Acotado** por el `@Throttle`
  por IP del controller (`auth.controller.ts`: 3/h en forgot, 10/h en resend) que limita la tasa de entrada.
- **Impacto:** bajo. En el peor caso, unos pocos correos extra por hora a la **propia** dirección del
  usuario; no es amplificación hacia terceros (el correo va al dueño de la cuenta).
- **Disparador:** fase 2 / storage compartido del throttler. Solución: mover el conteo a **Redis** con
  `INCR`+`EXPIRE` atómico (o `updateMany` con guardia), en línea con la migración del throttler a Redis (§5 NOTES).

### v15-S15-B2 · Enumeración por timing en forgot-password (await del envío solo si el email existe)
- **Dónde:** `src/modules/auth/auth.service.ts` → `forgotPassword` (el `await mail.sendPasswordReset`
  ocurre **solo** dentro de la rama `user && status===active`).
- **Estado actual:** la respuesta es genérica `200 { ok:true }` siempre (no revela existencia por el
  cuerpo), pero el **tiempo de respuesta** difiere: cuando el email existe se hace trabajo extra
  (emitir token + enviar correo) que un atacante podría medir para inferir cuentas registradas.
  **Mitigado** por el rate-limit (3/h + `@Throttle` IP) que hace inviable un barrido masivo por timing.
- **Impacto:** bajo. Canal lateral de enumeración de baja señal, muy ruidoso por el jitter del envío SMTP.
- **Disparador:** si se endurece el modelo anti-enumeración. Solución: enviar el correo **fuera del ciclo
  de respuesta** (encolar y responder de inmediato) o **igualar el trabajo** en ambas ramas (trabajo dummy
  equivalente cuando el email no existe), como ya se hizo con el hash dummy del login (D5).

### v15-S15-B3 · Token de reset/verificación viaja en la URL (Referer/historial del navegador)
- **Dónde:** `src/modules/auth/auth.service.ts` → `buildFrontendLink` (`?token=<claro>` en el link del correo).
- **Estado actual:** el token va como query param del enlace, por lo que puede quedar en el **historial**
  del navegador y filtrarse por cabecera `Referer` a recursos de terceros cargados en la página de destino.
  **Mitigado** por **single-use** (`consume` marca `usedAt`) + **TTL corto** (24h verificación / 1h reset):
  un token filtrado ya usado o caducado no sirve.
- **Impacto:** bajo. Requiere que un tercero capture el Referer/historial antes de que el token se use o
  expire; el diseño single-use lo neutraliza en la práctica.
- **Disparador:** si se refuerza el manejo del token en el frontend. Solución: que la página de destino
  intercambie el token por POST y lo **retire de la URL** (`history.replaceState`) al montar, y/o
  `Referrer-Policy: no-referrer` en esas rutas (coordinar con frontend/devops).

### Deuda del pase v1.7-admin-users (hallazgos techlead — no bloqueante, aceptada)

> Del pase de **alta de usuario por rol desde admin (M6)**. El bloqueante (proyección `ownedItems`
> de `getUser` que no conformaba el contrato `AdminUserOwnedItemRef` y crasheaba la pestaña Bóveda)
> **ya se corrigió** en este mismo pase (`admin.service.ts` → `getUser` mapea `{ inventoryItemId,
> folio, card: CardDTO, ownershipStatus }` con `toCardDTO`, cubierto en `test/admin.pii.spec.ts`) y
> **no** figura como deuda. Lo de abajo es la deuda no bloqueante que el techlead autorizó a diferir.

### BE-9 · `createUser` reimplementa a mano la validación de email/password — CERRADA (v1.8-ronda-c)
- **Dónde:** `src/modules/admin/admin.service.ts` → `createUser` vs. `src/modules/auth` (`RegisterDto` /
  `ResetPasswordDto`).
- **Estado (2026-08-16):** **cerrada.** Se centralizaron las reglas en `src/common/validation/credentials.ts`
  (`MIN_PASSWORD_LENGTH`, `EMAIL_REGEX`, `normalizeEmail`, `isValidEmailFormat`, `isStrongPassword`).
  `createUser` consume el helper; las DTOs de `auth` usan la constante compartida `MIN_PASSWORD_LENGTH` en
  sus `@MinLength`. Fuente única → sin riesgo de divergencia. Entrada conservada como registro histórico.

### BE-10 · `AdminUserOwnedItemRef` sin `finish` ni `referenceValue` — CERRADA (v1.8-ronda-c)
- **Dónde:** contrato `docs/API_CONTRACT.md §M6` (`AdminUserOwnedItemRef`); backend `admin.service.ts` →
  `getUser().ownedItems` / `ownedItemRefs`.
- **Estado (2026-08-16):** **cerrada.** El arquitecto eligió la opción (a) — enriquecer el ref — en el
  contrato v1.8-ronda-c. El backend implementó: cada `AdminUserOwnedItemRef` trae `finish` + `productType`
  + `referenceValue: PriceInfo`, reusando la valuación por-acabado del `HoldingDTO`. Anti N+1 con lectura
  batch de `PriceReference` por `cardId IN (...)`. Items sin precio → `referenceValue.status="pending"`
  (no se excluyen: vista 360°). Cubierto en `test/admin.pii.spec.ts`. Entrada conservada como histórico.

### B-4 / S-B5 · `approvedPriceCents` sin tope (dinero saliente arbitrario) — RESUELTA (pase P0 jobs de barrido)
- **Dónde:** `src/modules/buylist/dto/buylist.dto.ts` (`ItemDecisionDto`) + `buylist.service.ts` (`itemDecision`).
- **Estado:** **resuelta.** Hallazgo B-4 del pentest: `approvedPriceCents` tenía `@IsInt @Min(0)` **sin cota
  superior** → un `vault_operator` podía aprobar un monto SPEI arbitrario (PoC `99999999`). Defensa en dos
  capas: (1) DTO `@Max(1_000_000)` (MX$10,000, cota dura de sanidad → 400); (2) server-side
  `assertApprovedPriceWithinCap`: monto efectivo ≤ **min(`quotedPriceCents` × 2, tope por solicitud
  `buylist_cap_per_request_cents`)**; excede → `APPROVED_PRICE_CAP_EXCEEDED` (422). No rompe SEC-A1 ni el
  flujo de aprobación normal (aprobar el cotizado o ajuste ≤ 2× pasa). Cubierto con
  `test/buylist.approved-price-cap.spec.ts`. Ver `docs/BACKEND_NOTES.md §18.3`.

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

### FE-3 · UI de módulos admin M2/M7/M9/M10 en placeholder
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/{m2,m7,m9,m10}/page.tsx` +
  `frontend/src/components/domain/ModuleTodo.tsx`.
- **Estado actual:** M1, M3, M4, M5, M6 y M8 (más dashboard) tienen UI funcional; M2 (precios/FX/override),
  M7 (finanzas/P&L/export CSV), M9 (reportes) y M10 (config/diales/bitácora) muestran un placeholder
  `ModuleTodo`. Los tipos y rutas del contrato ya están mapeados.
  - **ACTUALIZACIÓN 2026-08-16 (housekeeping ronda-c):** **M6 salió de esta lista** — ya **no** es placeholder.
    `m6/page.tsx` monta el `M6View` completo (ficha 360°, KYC, alta/reset/borrado, historial por pestañas,
    VaultTab enriquecido). Corrección factual: la entrada listaba M6 por inercia tras v1.7/ronda-c.
- **Impacto:** faltan superficies del back-office; no bloquea las verticales priorizadas del MVP.
- **Disparador:** post-MVP / fase 2, o cuando el negocio necesite operar esos módulos desde la UI. Acción:
  construir las vistas consumiendo `/admin/pricing/*`, `/admin/fx`, `/admin/finance/*`,
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

### Deuda del pase rediseño 5a (hallazgos qa/techlead — no bloqueante, aceptada)

> Del pase de **rediseño 5a**. Los **dos MUST-FIX de accesibilidad** (foco visible en el `<select>` de
> switch de rol del AdminTopbar; contraste AA del token `--color-success` + consistencia del anillo de
> foco en los inputs crudos de `ShopFilters`/`CatalogView`) **ya se corrigieron** en su pase y **no**
> figuran como deuda (ver `FRONTEND_NOTES.md`). IDs prefijados `5a-` para no colisionar con FE-1..6/D7.
>
> **ACTUALIZACIÓN 2026-08-16 (pase "destacadas por precio + cierre 5a en lote"):** las **cinco** entradas
> `5a-D1/D3/D4/D5/D6` quedaron **CERRADAS** (ver detalle en cada una y en `FRONTEND_NOTES.md`). Ya **no**
> hay deuda 5a abierta. Se conservan como registro histórico.

### 5a-D1 · `ConditionBadge` huérfano + lógica de condición triplicada — CERRADA (eliminado)
- **Dónde:** `frontend/src/components/ui/ConditionBadge.tsx` (+ su test) — **eliminados**.
- **Estado (2026-08-16):** **CERRADA por opción (b): eliminación.** `ConditionBadge` estaba huérfano (solo
  lo importaba su propio test). Se decidió **eliminarlo** en vez de adoptarlo porque el rediseño 5a sustituyó
  la fila de pastillas (condición + acabado + cert) por el renglón mono `ListingSpec`, y la ficha de detalle
  (`CardDetailView`) pinta la condición como `Fact` de **texto plano** coherente con la dirección minimalista
  ratificada (con `CertNumberField` para el cert gradeado). Adoptar `ConditionBadge` (Badge/pastilla de color)
  en esos Facts de texto plano sería forzado y reintroduciría pastillas que el rediseño quitó a propósito. Ya
  no hay triplicación: quedan dos presentaciones intencionalmente distintas (renglón mono `ListingSpec` en
  retículas; texto plano en la ficha). `GradedCertChip` sobrevive intacto (lo usa el back-office M8). Cubierto
  por el E2E `catalog.spec.ts:56` (la ficha pinta la condición legible). Entrada conservada como histórico.

### 5a-D3 · Grosor de anillo de foco inconsistente (3px hardcodeado vs token 2px) — CERRADA
- **Dónde:** `DisputeEvidenceContact.tsx` y `PhotoUploader.tsx` (los que quedaban con 3px inline).
- **Estado (2026-08-16):** **CERRADA.** Se unificaron a **`shadow-focus` (2px)** los `shadow-[0_0_0_3px_...]`
  de `DisputeEvidenceContact` (link mailto + botón Copiar) y `PhotoUploader` (botón de captura). `Button.tsx`
  ya no tenía inline (usa el `:focus-visible` global). Verificado: grep `shadow-[0_0_0_3px` → **0 matches**.
  Todo el foco es el `outline` global o `shadow-focus` 2px, consistente con Input/Select. Sin doble anillo.

### 5a-D4 · `ListingSpec` compacto (graded) omite `certNumber` en el `aria-label` — CERRADA
- **Dónde:** `frontend/src/components/domain/ListingSpec.tsx` (variante `compact` para producto `graded`).
- **Estado (2026-08-16):** **CERRADA.** La variante compacta de graded ahora compone el `aria-label` con
  **empresa + grado + cert SIEMPRE** (§7.2b), aunque el texto **visible** siga abreviado (sin cert en la
  retícula). Se construye `gradedAriaLabel` cuando el cert se omite del visible; el `aria-label` final es el
  tooltip NM (raw) o `gradedAriaLabel` (graded compacto). Solo se enriqueció el aria-label; el visible no cambió.

### 5a-D5 · Vars `--radius-*` / `--shadow-*` muertas en `globals.css` (Tailwind hardcodea 0) — CERRADA
- **Dónde:** `frontend/src/app/globals.css`.
- **Estado (2026-08-16):** **CERRADA.** Se **quitaron** las vars muertas `--radius-sm/md/lg/xl` (Tailwind
  hardcodea `borderRadius: 0px`; nadie consume `var(--radius-*)` — verificado por grep). **No** existían vars
  `--shadow-*` en `globals.css` (el único boxShadow con var es `boxShadow.focus` en tailwind.config, que SÍ se
  usa). **No** se tocó `--color-focus-ring` ni `boxShadow.focus`.

### 5a-D6 · (nota) `PortfolioTrendChart` hardcodea hex de la paleta como fallback de recharts — DEGRADADA
- **Dónde:** `frontend/src/components/domain/PortfolioTrendChart.tsx`.
- **Estado (2026-08-16):** **DEGRADADA a resuelta en la práctica.** El fallback que estaba **desalineado**
  (`LIGHT.up = #4E7A49`, viejo verde pre-AA) se corrigió a **`#4a7345`** = el token vivo `--color-success`
  (ya ajustado al fix de contraste AA). Ya no hay drift en el primer paint: los hex de fallback coinciden con
  los tokens actuales de `globals.css`, y `useTrendColors` sigue leyendo los tokens reales tras montar. La
  mejora estructural (leer TODOS los colores vía `getComputedStyle` en vez de literales) queda como
  refinamiento opcional sin impacto observable; ya **no** hay divergencia numérica que registrar.

### Ronda B — deuda surgida en verdictos (2026-08-16, no bloqueante)

- **RB-1 (backend) — CERRADA (v1.8-ronda-c):** taxonomía de auditoría de jobs unificada a `jobs.<name>.run`
  (`portfolio_snapshot` era el único sin `.run`; ahora `jobs.portfolio_snapshot.run`). `admin-jobs.controller.ts`.
- **RB-2 (backend) — CERRADA (v1.8-ronda-c):** `entityType: 'Job'` + `entityId: '<job>'` presentes en TODA la
  auditoría de `/admin/jobs/*` (paridad con los disparos M2). `admin-jobs.controller.ts`.
- **RB-3 (backend) — CERRADA (v1.8-ronda-c):** `assertApprovedPriceWithinCap` recibe el cap AML ya resuelto por
  `itemDecision`, que honra `kyc.capPerRequestCentsOverride` con fallback al dial global (misma fuente que
  `createRequest`). Cubierto en `test/buylist.ronda-c.spec.ts`.
- **RB-4 (backend) — DIFERIDA:** factor de uplift `2×` (`APPROVED_PRICE_UPLIFT_FACTOR`) sigue como constante de
  código; subir a dial `ConfigSetting`/M10 cuando el negocio quiera ajustarlo sin redeploy. No bloqueante.
- **RB-5 (backend) — CERRADA (v1.8-ronda-c):** JSDoc corregido en `buylist-sweep.service.ts` (era "30d →
  convertida_inventario"; el código setea `abandonada`) e `ine-retention.service.ts` (era "scheduling BullMQ es
  deuda BE-5"; ya cableado).
- **RB-6 (backend) — CERRADA (v1.8-ronda-c):** `SellRequest.approvedTotalCents` se escribe server-side (helper
  `recomputeApprovedTotal` = suma de `approvedPriceCents` por ítem, invocado en `itemDecision`; `null` si no hay
  aprobados). El P&L / tarjeta "buylist del periodo" (`admin.dashboard`) ya lo lee. Cubierto en
  `test/buylist.ronda-c.spec.ts`.
- **SEC-D1 (devops) — DIFERIDA:** lifecycle/retención a nivel de bucket R2 para cubrir INE huérfano si falla la
  purga por API. Fuera del alcance de backend (devops/humano).
- **SEC-D2 (backend/arquitecto) — CERRADA (v1.8-ronda-c):** `SellRequest.closedAt` (M-19) sellado en las
  transiciones terminales (`pagada`/`rechazada`/`abandonada`); `ine-retention` lo usa como fuente del cierre con
  fallback al cálculo por timestamps para filas legacy. Cubierto en `test/buylist.ronda-c.spec.ts`,
  `test/buylist-sweep.closedat.spec.ts`, `test/ine-retention.spec.ts`.
- **SEC-D3 (backend, pentest) — CERRADA (v1.8-ronda-c):** hallazgo Info del pentest, **par de RB-6**
  (`docs/SECURITY_NOTES.md` RC.0 / BACKEND_NOTES §27.5): `SellRequest.approvedTotalCents` se LEÍA en
  P&L/dashboard pero nunca se escribía → la tarjeta "buylist del periodo" sumaba 0/null. Resuelto por el
  mismo fix de RB-6 (`recomputeApprovedTotal` server-side). Blue team lo dio por cerrado.

### Ronda C — deuda surgida en verdictos (2026-08-16, no bloqueante)

> Hallazgos NUEVOS de los verdictos de Ronda C (qa/techlead/seguridad), todos **no bloqueantes**. RB-7 es
> **PENDIENTE-DECISIÓN** (cambio de máquina de estados: no se implementa sin negocio + arquitecto). El resto
> son fixes pequeños diferidos a un próximo round; los que tocan PII/retención requieren re-verificación
> qa+seguridad al abordarse.

- **RB-7 (techlead #1) — PENDIENTE-DECISIÓN — `closedAt` no se sella cuando TODOS los items se rechazan
  vía `itemDecision('reject')`.** El `SellRequest` queda en estado no-terminal (`verificacion`), `closedAt`
  sigue `null` e `ine-retention` **nunca purga** esa INE (sobre-retención — dirección conservadora, no fuga,
  pero contradice el diseño SEC-D2 de minimización de PII). Owner: **backend**, pero es un **cambio de
  comportamiento / máquina de estados** → requiere PRIMERO **decisión de negocio del humano + arquitecto**:
  ¿una solicitud con todos los items rechazados debe transicionar sola a `rechazada`? **NO implementar** hasta
  esa decisión. Prioridad: **media** (cumplimiento PII/LFPDPPP).
- **SEC-E1 (seguridad, pre-existente) — `ine-retention` elige `lastClosed` por `orderBy createdAt desc`
  en vez de `max(closedAt)`.** En escenarios multi-solicitud podría anclar la retención a un cierre anterior
  y purgar unos días antes de lo debido. Recomendación: anclar a **`max(closedAt)`**. Owner: **backend**.
  Prioridad: **baja** (edge, pre-existente — no introducido por Ronda C). Candidato a próximo round: fix
  pequeño y localizado, pero **requiere re-verificación qa+seguridad** por tocar el camino de PII.
- **RB-8 (techlead #2) — regla de valuación "referencia vigente = más reciente por acabado" duplicada.**
  Vive por partida doble en `PricingService.getReference` y en el batch inline de `admin.service.ts` →
  `ownedItemRefs`. Dirección: extraer `PricingService.getReferencesBatch(items)` y compartirlo con
  `holdings`, `ownedItemRefs`, `inventoryValue`, `custodyValue` (de paso cierra el N+1 de la familia
  BE-4/D3). Owner: **backend**. Prioridad: **baja** (diferido por escala; misma familia BE-4/D3).
- **BE-9b (techlead #3) — dedup de validación incompleto para email.** `MIN_PASSWORD_LENGTH` sí es fuente
  única (cerrado en BE-9), pero el **formato de email diverge**: `RegisterDto` usa `@IsEmail` (class-validator)
  y el camino admin usa `EMAIL_REGEX` (más laxo, en `common/validation/credentials.ts`). Owner: **backend**.
  Prioridad: **baja**. Nota: unificar `RegisterDto` al helper **cambia el set de emails aceptados** (validación
  de auth) → si se hace, va **con re-verificación**.

### v1.9-set-chart — cierre post-veredicto (2026-08-16, no bloqueante)

> Feature ya aprobada por **qa + techlead + seguridad**. En este cierre se aplicaron **DOS fixes baratos**
> recomendados por los revisores (**SEC-F1** y **TD-2**, marcados RESUELTOS abajo) y se registran las deudas
> **no bloqueantes** restantes. Todas Owner **backend**, prioridad **baja/informativa**. Gates verdes tras el
> cierre: lint/typecheck/build OK, **57 suites / 371 tests**. Detalle en `docs/BACKEND_NOTES.md §29`.

- **SEC-F1 (seguridad) — RESUELTO (2026-08-16).** Los 2 endpoints públicos de la gráfica
  (`GET /catalog/featured-set/value-history` y `GET /catalog/sets/:id/value-history`) NO tenían `@Throttle`
  propio: colgaban solo del límite global (300/min). Se les añadió `@Throttle({ default: { ttl: 60_000,
  limit: 60 } })` (**60/min por IP**) en `catalog.controller.ts`, en **PARIDAD** con los otros públicos
  anti-scraping (`BuylistCatalogController`, mismo patrón/import). Sin config nueva.
- **TD-2 (techlead) — RESUELTO (2026-08-16).** `SetValueSnapshot` (M-20) tenía `@@unique([setId, asOfDate])`
  **y** `@@index([setId, asOfDate])` (mismas columnas, mismo orden) → el `@@index` era **redundante** (el
  índice del `@@unique` ya sirve las consultas por rango, con menor coste de escritura). Se eliminó del
  `schema.prisma` **y** del `migration.sql` de M-20 (edición **en sitio**: la migración M-20 NO se ha aplicado
  en ningún entorno — egress bloquea prod, tests con mocks — así que no requiere migración nueva). Verificado
  con `prisma validate` (schema válido); schema y migración quedan coherentes (índice quitado en ambos).
- **TD-1 / RB-8-family — regla de valuación del set (extracción PARCIAL aplicada).** La regla
  raw/`raw:NM`/`normal` + "referencia vigente = más reciente por capturedDate" estaba duplicada entre
  `set-value.service.ts:computeSetValue` (lectura/agregación) y `set-price-sync.service.ts` (escritura), y es
  además la MISMA semántica de `PricingService.getReference`. Deliberada (evita N+1) pero con riesgo de
  divergencia. **En este cierre** se extrajo la constante `SET_VALUE_RULE` (las 3 llaves de tipo/grado/acabado)
  a `set-value.service.ts`, reusada por `computeSetValue` **y** el job `set-price-sync` (escritura y lectura ya
  no divergen en los literales). **Queda como deuda** unificar la *lógica* de "más reciente por capturedDate"
  con `getReference` vía un `getReferencesBatch` compartido (misma dirección que **RB-8/BE-4/D3**, diferido por
  escala). Owner: **backend**. Prioridad: **baja**.
- **TD-3 — cargas en memoria en `resolveFeaturedSet` (fallback-2) y `computeSetValue`.** Ambas leen tablas
  completas a memoria (`SetValueSnapshot` para elegir el set más valioso; `Card` + sus `PriceReference` del set
  para agregar) y resuelven el "más reciente por X" en JS. Crecen con el histórico. **Inocuo hoy**: el request
  público (`featuredSetHistory`/`setHistoryById`) **NO** invoca `computeSetValue` — solo lee `SetValueSnapshot`
  ya materializado; `computeSetValue` corre en el job diario. Dirección: `DISTINCT ON`/`groupBy` al escalar.
  Owner: **backend**. Prioridad: **baja**.
- **SEC-F2 — `:id` de `GET /catalog/sets/:id/value-history` sin validación de formato.** No hay `ParseUUIDPipe`
  ni chequeo de forma; **sin impacto**: Prisma parametriza la query (sin inyección) y un id inexistente/mal
  formado cae en `findUnique` → **404 NOT_FOUND**. Dirección: validar formato si se quiere devolver 400 antes de
  tocar BD. Owner: **backend**. Prioridad: **baja**.
- **QA-min (informativo) — fallback-3 de `resolveFeaturedSet` ordena `releaseDate` como String.** El orden
  lexicográfico es **correcto** para el formato `yyyy/MM/dd` de pokemontcg.io (mismo orden que cronológico).
  Solo habría que endurecerlo (parseo a fecha) si entraran `releaseDate` con **otros formatos**. Owner:
  **backend**. **Informativo** (sin acción hoy).

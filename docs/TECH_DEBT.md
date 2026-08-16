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

### Deuda del pase correo v1.5 (hallazgos seguridad — Baja, aceptada)

> Del pase de **feature de correo v1.5** (verificación + reset por email). Los hallazgos **S15-B1**
> (escape de HTML en plantillas) y **S15-B4** (revalidar `status` en reset) se **cerraron** en este
> mismo pase y **no** figuran como deuda. Lo de abajo es la deuda **Baja aceptada** que seguridad
> autorizó a diferir. IDs prefijados `v15-` para no colisionar con la D1–D3 del pase v1.1 (arriba).

### v15-D1 · `auth-token-sweep` sin disparador automático (no cableado al scheduler)
- **Dónde:** `src/jobs/auth-token-sweep.service.ts` (lógica lista); `src/jobs/scheduler.service.ts:47-51`
  solo registra `fx-refresh`/`price-sync`/`portfolio-snapshot` — **no** incluye `auth-token-sweep`
  (ni `buylist-sweep`, `dispute-deadline`, `ine-retention`, misma familia que BE-5/BE-3).
- **Estado actual:** la tabla `AuthToken` **no se poda**: los tokens de verificación/reset caducados o
  usados se acumulan sin borrarse. **Mitigado** porque `AuthTokenService.consume` (`auth-token.service.ts:53`)
  ya rechaza expirados/usados (`usedAt: null, expiresAt: { gt: now }`), así que un token viejo nunca
  vuelve a ser válido; es solo crecimiento de tabla, no un agujero de autenticación.
- **Impacto:** bajo. Crecimiento monótono de `AuthToken` con el tiempo (housekeeping), sin efecto en
  correctness ni seguridad.
- **Disparador:** al cablear el scheduler de jobs de barrido (junto con BE-5/BE-3). Solución: registrar
  `auth-token-sweep` como job repetible BullMQ (`repeat`) en `scheduler.service.ts`, con su `case` en el worker.

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

### BE-9 · `createUser` reimplementa a mano la validación de email/password de `/auth/register`
- **Dónde:** `src/modules/admin/admin.service.ts` → `createUser` (validación de formato de email y de
  fortaleza de password inline) vs. `src/modules/auth/auth.service.ts` → `register` (validación original).
- **Estado actual:** las mismas reglas (formato de email, longitud/fortaleza mínima de password) están
  **duplicadas** en dos sitios con lógica escrita a mano; no comparten un validador común. Funcionan hoy,
  pero pueden **divergir** si una de las dos se endurece sin tocar la otra.
- **Impacto:** bajo. Mantenibilidad/consistencia: riesgo de que el alta admin acepte credenciales que el
  auto-registro rechazaría (o viceversa) tras un cambio futuro.
- **Disparador:** al tocar cualquiera de las dos validaciones, o antes de añadir un tercer punto de alta.
  Solución: **centralizar** las reglas en un helper compartido (p. ej. `common/validation/credentials`
  o un DTO/validator reusable) e invocarlo desde `register` y `createUser`.

### BE-10 · `AdminUserOwnedItemRef` sin `finish` ni `referenceValue` — petición al arquitecto (PENDIENTE)
- **Dónde:** contrato `docs/API_CONTRACT.md §M6` (`AdminUserOwnedItemRef`) y su consumo en la pestaña
  Bóveda del frontend (`M6View.tsx` → `VaultTab`); backend `admin.service.ts` → `getUser().ownedItems`.
- **Estado actual:** la proyección conforma el contrato vigente `{ inventoryItemId, folio, card,
  ownershipStatus }`, así que la pestaña Bóveda de M6 muestra **solo carta + folio + titularidad**. NO
  puede mostrar el **acabado** (`finish`) ni el **valor de referencia** (`referenceValue`) porque el
  contrato no los incluye en este ref (a diferencia del `HoldingDTO` de la bóveda del usuario en §M1,
  que sí trae `finish` + `referenceValue`).
- **Impacto:** bajo. Funcional: la ficha 360° admin da menos contexto de valuación del que ya existe en
  el `HoldingDTO`. No hay bug; es una limitación de alcance del contrato.
- **Disparador / acción requerida:** **decisión del arquitecto** (el backend NO cambia el contrato por su
  cuenta — regla de oro). Opciones a evaluar: (a) enriquecer `AdminUserOwnedItemRef` con `finish` +
  `referenceValue`; o (b) añadir un endpoint dedicado `GET /admin/users/:id/holdings` que reuse la
  valuación de `vault.service.holdings`. Una vez el arquitecto actualice el contrato, backend implementa.

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

### Deuda del pase rediseño 5a (hallazgos qa/techlead — no bloqueante, aceptada)

> Del pase de **rediseño 5a**. Los **dos MUST-FIX de accesibilidad** (foco visible en el `<select>` de
> switch de rol del AdminTopbar; contraste AA del token `--color-success` + consistencia del anillo de
> foco en los inputs crudos de `ShopFilters`/`CatalogView`) **ya se corrigieron** en este mismo pase y
> **no** figuran como deuda (ver `FRONTEND_NOTES.md`). Lo de abajo es lo que el techlead marcó **no
> bloqueante** y autorizó a diferir. IDs prefijados `5a-` para no colisionar con FE-1..6/D7.

### 5a-D1 · `ConditionBadge` huérfano + lógica de condición triplicada
- **Dónde:** `frontend/src/components/domain/ListingSpec.tsx`, `frontend/src/components/domain/ConditionBadge.tsx`
  y `frontend/src/app/[locale]/(storefront)/catalog/CardDetailView.tsx` (mapeo de condición inline).
- **Estado actual:** la lógica que traduce/abrevia la condición (NM, etc.) y la deriva a etiqueta está
  **triplicada**: `ListingSpec` la resuelve por su cuenta, `ConditionBadge` la reimplementa y además está
  **huérfano** (no lo consume la ficha), y `CardDetailView` la vuelve a hacer **inline**. Tres fuentes de
  verdad para la misma regla de presentación.
- **Impacto:** bajo. Mantenibilidad/consistencia: un cambio en la taxonomía o en la abreviatura de condición
  obliga a tocar tres sitios y arriesga divergencia (que la ficha muestre algo distinto a la retícula).
- **Disparador:** al tocar la lógica de condición o al retomar la ficha 360°. Solución: **consolidar** en un
  helper puro único (o adoptar `ConditionBadge` en la ficha y hacer que `ListingSpec`/`CardDetailView` lo
  reutilicen), eliminando el componente huérfano si no se adopta.

### 5a-D3 · Grosor de anillo de foco inconsistente (3px hardcodeado vs token 2px)
- **Dónde:** `frontend/src/components/ui/Button.tsx`, `frontend/src/components/domain/DisputeEvidenceContact.tsx`
  y `frontend/src/components/ui/PhotoUploader.tsx` usan `shadow-[0_0_0_3px_...]` (3px), frente al token
  `shadow-focus` (`0 0 0 2px var(--color-focus-ring)`) que usan Input/Select y ahora los inputs crudos.
- **Estado actual:** dos grosores de anillo bermellón conviven (3px inline vs 2px token). Todos son visibles
  y cumplen foco/contraste; solo difieren en px. No es un bug de accesibilidad, es inconsistencia visual.
- **Impacto:** bajo. Cosmético/consistencia del sistema de foco; sin efecto en AA ni en operabilidad por teclado.
- **Disparador:** al pulir el sistema de foco o al centralizar tokens. Solución: **unificar** los tres a
  `shadow-focus` (2px) y retirar los `shadow-[0_0_0_3px_...]` inline.

### 5a-D4 · `ListingSpec` compacto (graded) omite `certNumber` en el `aria-label`
- **Dónde:** `frontend/src/components/domain/ListingSpec.tsx` (variante `compact` para producto `graded`).
- **Estado actual:** la variante compacta de graded compone un `aria-label` sin incluir el `certNumber`,
  que la variante completa sí anuncia. El lector de pantalla oye grado/grader pero no el número de
  certificación en la retícula compacta.
- **Impacto:** bajo. Accesibilidad menor: falta un dato de identificación en el `aria-label` compacto; el
  número sigue disponible en la ficha completa. No rompe navegación ni operabilidad.
- **Disparador:** al retocar `ListingSpec` o en el próximo repaso de accesibilidad. Solución: componer el
  `aria-label` de la variante graded compacta incluyendo también el `certNumber`.

### 5a-D5 · Vars `--radius-*` / `--shadow-*` muertas en `globals.css` (Tailwind hardcodea 0)
- **Dónde:** `frontend/src/app/globals.css` (`--radius-sm/md/lg/xl: 0px`, y equivalentes de sombra) vs.
  `frontend/tailwind.config.ts` (radios y `boxShadow` hardcodeados a `none`/0, salvo `focus`).
- **Estado actual:** las variables de radio/sombra en `:root` **no las consume nadie**: Tailwind ya fija 0
  directamente en la config, así que son tokens muertos. Coexisten dos fuentes (var CSS sin usar + valor
  hardcodeado) para el mismo "cero".
- **Impacto:** bajo. Ruido/mantenibilidad: da la falsa impresión de que ajustando la var se cambia el radio,
  cuando el valor real vive en la config de Tailwind.
- **Disparador:** al limpiar tokens o si alguien quiere reintroducir radios. Solución: **alinear** (que
  Tailwind lea `var(--radius-*)`/`var(--shadow-*)`) **o quitar** las variables muertas de `globals.css`.

### 5a-D6 · (nota) `PortfolioTrendChart` hardcodea hex de la paleta como fallback de recharts
- **Dónde:** `frontend/src/components/domain/PortfolioTrendChart.tsx`.
- **Estado actual:** para pasar colores a recharts (que no lee variables CSS directamente en todos los
  props) se **hardcodean hex** de la paleta 5a como fallback en vez de leer los tokens `--color-*`.
- **Impacto:** bajo. Riesgo de **drift**: si la paleta cambia en `globals.css`, la gráfica seguiría pintando
  los hex viejos hasta que alguien recuerde actualizarlos a mano.
- **Disparador:** si la paleta cambia o al endurecer el tema. Solución: leer los tokens vía
  `getComputedStyle(document.documentElement)` (o un puente de CSS vars a JS) y pasarlos a recharts, en
  lugar de hex literales.

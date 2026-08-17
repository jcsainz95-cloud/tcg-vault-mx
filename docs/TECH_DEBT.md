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

### E2E-1 · Seed E2E no idempotente (doble siembra + estado no reseteado) — RESUELTO (2026-08-16)
- **Dueño:** backend. **Estado:** **RESUELTO** (solo `backend/prisma/seed-e2e.ts` + `backend/package.json`;
  producción intacta, ningún endpoint tocado).
- **Síntoma:** el gate **backend-e2e** (`npm run test:integration`) fallaba. Postgres del runner registraba
  `duplicate key ... "ProcessedStripeEvent_pkey" (id)=(evt_e2e_succeeded_fixed)` y
  `... "User_email_key" (email)=(customer@e2e.local)` **durante** el `jest`.
- **Causa raíz — dos capas:**
  1. **Doble siembra:** `test:integration` corría `npm run seed:synthetic` **standalone** ANTES de `jest`, y
     además **cada** uno de los 5 `*.e2e-spec.ts` vuelve a llamar `seedE2E()` en su `beforeAll` → 6 siembras
     por corrida (redundancia). Los dos `ERROR` de Postgres citados son, en una corrida única, **P2002
     capturados por diseño**: `auth.service.ts:111` (test "rechaza email duplicado" → 409 `EMAIL_TAKEN`) y
     `payments.service.ts:44` (guard de idempotencia del webhook, test "es IDEMPOTENTE reenvía event.id") —
     benignos, no son el fallo.
  2. **Idempotencia CROSS-RUN rota (fallo real):** `seed-e2e.ts` reseteaba estado transaccional **por
     userId** (orders/shipments/sellRequests/disputes/kyc) pero **NO** el estado E2E que no cuelga de userId:
     `ProcessedStripeEvent` (id `evt_e2e_succeeded_fixed`) ni `InventoryMovement` de piezas de **plataforma**.
     En una **2ª corrida** sobre la misma DB, `evt_e2e_succeeded_fixed` ya existía → el webhook hacía no-op →
     la orden **no** liquidaba (test "el webhook FIRMADO liquida la orden" fallaba); y los movimientos `settle`
     previos hacían que el assert `settleMovements === 1` contara 2+.
- **Fix:**
  1. Se quitó la siembra **standalone** redundante de `test:integration` (ahora `prisma migrate deploy && jest
     ...`); la siembra queda como **única fuente** en el `beforeAll` de cada spec (`seedE2E`). El script
     `seed:synthetic` (usado por `scripts/seed-synthetic.sh`/CI staging) **se conserva**.
  2. `seedE2E` ahora es **idempotente cross-run**: además del reset por-usuario, borra en el paso 3b los
     `InventoryMovement` de los ítems E2E (por `folio IN E2E_FOLIOS`) y los `ProcessedStripeEvent`
     (`evt_e2e_succeeded_fixed` + prefijo `evt_e2e`). Todos los fixtures con clave única ya usaban `upsert`
     (revisado el seed completo: ConfigSetting, User, VaultLocation, CardSet, Card, PriceReference,
     InventoryItem; Address ya iba con guard `findFirst`). Correr `test:integration` DOS veces seguidas sobre
     la misma DB ya no rompe.
- **Verificación (gates sin infra):** `lint` OK, `typecheck` OK, `build` OK, `npm test` **57 suites / 372
  tests** verdes. El **verde de E2E lo confirma el runner** (egress local bloquea el pull de imágenes Docker
  de los services). Detalle en `docs/BACKEND_NOTES.md`.

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

### Delta rama `claude/git-repo-review-c67xyk` — review techlead (2026-08-17, no bloqueante)

> Aprobado por **techlead** CON DEUDA ANOTADA. Dos ítems del código de catálogo (`catalog-sync.service.ts`),
> dueño **backend**. No bloqueantes; registrados a petición del techlead sin tocar código de producción.

### BE-11 · Estado de `sync-status` en memoria; restart silencioso
- **Dónde:** `src/modules/catalog/catalog-sync.service.ts` → `syncAllStatus` (`{running,total,done,startedAt,finishedAt}`).
  Dependencia: **devops/BullMQ (DEV-1)**.
- **Estado actual:** el estado observable del barrido `sync-all` vive **en memoria del proceso**. Si el proceso
  se reinicia a mitad del barrido, el estado vuelve a `{running:false,total:0}`, la barra de progreso de M2
  desaparece y `finishedAt` **nunca** se setea → el operador puede creer que "terminó" cuando quedan sets
  pendientes; el progreso `done/total` se pierde y no se reanuda solo (hay que **re-llamar** `sync-all`).
- **Impacto:** medio. Aceptable como MVP (documentado en el propio código y en ARCHITECTURE DEV-1). No hay
  fuga de datos ni doble importación (el upsert por `externalId` es idempotente y el barrido es resumible).
- **Disparador:** al **cablear BullMQ** para catálogo (misma familia que D1/DEV-1). Solución: progreso
  **persistido** en la cola + reintentos con backoff → cierra este ítem y el D1.

### BE-12 · `.finally` muta `this.syncAllStatus` por referencia (seguro solo por el single-flight)
- **Dónde:** `src/modules/catalog/catalog-sync.service.ts` → `syncAll`/`runSyncAll` (el `.finally` del
  fire-and-forget que pone `running=false`/`finishedAt` sobre `this.syncAllStatus`).
- **Estado actual:** el `.finally` cierra el estado sobre `this.syncAllStatus`. Hoy es seguro **SOLO** porque
  el single-flight (`if (this.syncAllStatus.running) return`) impide barridos solapados. Si algún día se
  **relaja** ese guard, el `finally` de un barrido viejo pisaría el estado de uno nuevo (race de cierre).
- **Impacto:** bajo hoy (latente): el guard actual lo neutraliza; el riesgo aparece solo si se permite
  concurrencia de barridos.
- **Disparador:** si se relaja el single-flight o al mover el estado a la cola (BE-11/D1). Mitigación sugerida
  (no urgente): **capturar el `jobId` en el closure** y verificar `this.syncAllStatus.jobId === jobId` antes de
  mutar en el `finally`.

### Fase 0 del epic de precios — deuda del delta (commit ebb4dee, 2026-08-17, no bloqueante)

> De la **Fase 0** del epic de precios (gate premium `isPremiumRarity`/`ruleKeyCandidates`, encolado honesto
> de `publicQuote`, INE con línea pendiente). Triple veredicto **APROBADO** (qa + techlead APROBADO-con-deuda +
> seguridad APROBADO). Todos los ítems de abajo son **no bloqueantes**, dueño **backend** salvo donde se
> anota coordinación con **arquitecto**. Registrados a petición del techlead/seguridad sin tocar código de
> producción. Continúan la numeración `BE-*` (tras BE-1..12). Detalle de implementación en
> `docs/BACKEND_NOTES.md` (contrato §4.2.1 / §6).

### BE-13 · Contabilidad AML mensual no re-cuenta ítems que fueron `precio_pendiente` (Media, seguridad)
- **Dónde:** `src/modules/buylist/buylist.service.ts` → `monthUsedCentsTx` (~:294-307).
- **Estado actual:** el acumulado mensual agrega `quotedTotalCents` (no `approvedTotalCents`). Un ítem que
  entra como **`precio_pendiente`** (cotizado en 0) no suma al mensual al crearse; cuando el admin lo resuelve
  su monto entra a `approvedTotalCents` de la solicitud pero **nunca se re-contabiliza** contra el tope
  mensual AML del usuario. Un usuario podría, en teoría, superar el tope mensual acumulando aprobaciones de
  ítems que nacieron pendientes.
- **Impacto:** medio (AML/cumplimiento). **Compensado hoy** por tres capas: (1) la **INE siempre exigida** con
  cualquier línea pendiente en la solicitud; (2) el **cap por-solicitud** en `assertApprovedPriceWithinCap`
  (min(quoted×2, `buylist_cap_per_request_cents`)); (3) money-out **solo `super_admin`** y **auditado**. No hay
  fuga automática de dinero: cada pago SPEI pasa por el super_admin.
- **Disparador:** **abrir ticket ANTES de operar con dinero real / volumen AML relevante.** Solución: basar el
  mensual en `max(quotedTotalCents, approvedTotalCents)`, o re-evaluar el cap mensual en
  `itemDecision`/`recomputeApprovedTotal` al fijar `approvedPriceCents`.

### BE-14 · `isPremiumRarity` es allowlist finita de patrones (Baja, seguridad)
- **Dónde:** `src/common/money.ts` → `PREMIUM_RARITY_PATTERNS` / `isPremiumRarity` (~:125-153).
- **Estado actual:** el gate premium empareja por substrings/tokens de una lista finita. Rarezas **chase
  antiguas** que no matchean ningún patrón se escapan del gate (`Rare Shining`, `Rare Prime`, `Rare LEGEND`,
  `Rare BREAK`, `Rare ACE`); en finish holofoil, una premium cuyo string no lleva "holo" y no está en la
  allowlist cae al bin `['Holo']`.
- **Impacto:** bajo y **acotado a la baja**: el fallo posible es **subcotización** (pagar de menos por una
  chase antigua tratada como bulk), **nunca money-out excesivo**. No hay riesgo de sobrepago automático.
- **Disparador:** si se empiezan a cotizar **eras antiguas** (pre-Scarlet&Violet chase). Solución: ampliar
  `PREMIUM_RARITY_PATTERNS` con esos tokens. Dueño **backend**; la definición de taxonomía es del **arquitecto**.

### BE-15 · `escalatePending` dedup no atómico (falta `@@unique`) (Baja, seguridad)
- **Dónde:** `src/modules/pricing/pricing.service.ts` → `escalatePending` (~:189-195); modelo
  `PendingPriceEntry` (`prisma/schema.prisma`).
- **Estado actual:** el dedup es `findFirst` (`status='open'`) **+** `create`, sin unicidad en la tabla.
  `PendingPriceEntry` **no** tiene `@@unique` sobre `(cardId, productType, gradeKey, finish)` → bajo
  **concurrencia** (dos quotes/escaladas simultáneas de la misma combinación) pueden crearse **filas
  duplicadas** en la cola de precio pendiente.
- **Impacto:** bajo. A lo sumo entradas duplicadas en la cola de trabajo del admin (ruido operativo); no afecta
  dinero ni correctness de cotización (la resolución del precio resuelve todas las abiertas de la combinación).
- **Disparador:** al endurecer la cola de pendientes o si aparecen duplicados en operación. Solución: índice
  único parcial `(cardId, productType, gradeKey, finish) WHERE status='open'` + `upsert`/captura de **P2002**.
  **Toca `schema.prisma` → coordinar con arquitecto.**

### BE-16 · `publicQuote` escala pendientes desde endpoint público/anónimo (hallazgo QA, aceptado por seguridad)
- **Dónde:** `src/modules/buylist/buylist.service.ts` → `publicQuote` (~:81-83) +
  `src/modules/buylist/buylist.controller.ts` (~:14-19).
- **Estado actual:** el cotizador público (anónimo) llama `escalatePending` cuando el acabado cotiza
  `precio_pendiente` — para cumplir la promesa del copy ("entrará a la cola de precio pendiente"). Un usuario
  **anónimo** puede, en consecuencia, **poblar la cola** de precio-pendiente enumerando cartas. **Acotado**
  por: solo cartas **existentes** en catálogo, throttle global (300/min), y dedup best-effort (BE-15).
- **Impacto:** bajo. Ruido en la cola de trabajo del admin; sin fuga de datos ni de dinero (SEC-A1 intacto:
  rareza/montos server-side).
- **Disparador:** **la Fase 1 (precio on-demand) lo supersede** — el quote traerá precio real en vez de
  encolar, y el punto desaparece. Si molesta la cola antes de eso: marcar el **origen** del pendiente
  (público vs autenticado) o escalar **solo autenticado**. Aceptado como interino por seguridad.

### BE-17 · Falta test unitario directo de `isPremiumRarity` / `ruleKeyCandidates` (D1 techlead)
- **Dónde:** `test/money.spec.ts` (no las cubre directamente); hoy solo se ejercen vía integración en
  `test/buylist.modern-rarity.spec.ts`.
- **Estado actual:** el gate premium (`isPremiumRarity`) y la selección de candidatos (`ruleKeyCandidates`)
  se prueban **indirectamente** por integración, no con una tabla de casos unitaria dedicada.
- **Impacto:** bajo (calidad/mantenibilidad). Sin cobertura directa, un cambio en los patrones podría
  regresar sin fallar un test unitario; el token `\b(v|ex|gx…)\b` es especialmente **propenso a falsos
  positivos** (p. ej. "ex" dentro de otras palabras) y merece casos explícitos.
- **Disparador:** próximo pase de hardening de tests. Solución: agregar a `test/money.spec.ts` una **tabla de
  casos** (premium vs bulk, holofoil/reverse/normal, y el token de V-series/EX/GX).

### BE-18 · Asimetría del gate: `reverse_holo` no pasa por `isPremiumRarity` (techlead punto 3)
- **Dónde:** `src/common/money.ts` → `ruleKeyCandidates`, rama `case 'reverse_holo'` (~:173-174).
- **Estado actual:** `reverse_holo` retorna **siempre** `['Reverse Holo']` **sin** pasar por el gate premium
  (a diferencia de holofoil/1st-ed, que sí lo aplican). Probablemente inocuo: una rareza premium **rara vez**
  existe en acabado reverse, y `assertFinishAvailable` filtra acabados no disponibles; pero la asimetría no
  tiene test ni doc que la justifique.
- **Impacto:** bajo/latente. Igual que BE-14, el fallo posible sería **subcotización**, no money-out excesivo.
- **Disparador:** si aparece una rareza premium con `reverse_holo` real en catálogo. Solución: aplicar el
  mismo gate premium a la rama `reverse_holo` (o documentar/testear la exclusión intencional).

### BE-19 · Comentario "inocuo" de la sobre-inclusión en `money.ts` debería decir "costo acotado" (cosmético, D2 techlead)
- **Dónde:** `src/common/money.ts` (~:120-121 y ~:166).
- **Estado actual:** los comentarios describen la sobre-inclusión del gate premium (una carta barata
  clasificada premium "solo pasa a % de mercado, **inocuo**"). En **buylist** ese "% de mercado" **es dinero
  que sale** (aunque pequeño), así que la redacción correcta es "**costo acotado**", no "inocuo".
- **Impacto:** nulo funcional; solo precisión del comentario (evita subestimar el efecto en dinero saliente).
- **Disparador:** próximo toque de `money.ts`. Solución: reemplazar "inocuo" por "costo acotado" en esos dos
  comentarios.

### Fase 1 del epic de precios — deuda del delta (commit a6a79df, 2026-08-17, no bloqueante)

> De la **Fase 1** del epic de precios (precio on-demand: `persistMarketReference`, disparo manual del job
> de catálogo/precio). Triple veredicto **APROBADO** (seguridad + qa + techlead APROBADO-con-deuda). Todos
> los ítems de abajo son **no bloqueantes**, dueño **backend** salvo dependencia con **devops** donde se
> anota. Registrados a petición del techlead/seguridad sin tocar código de producción. Continúan la
> numeración `BE-*` (tras BE-1..19).

### BE-20 · `PriceReference` crece sin poda (prioridad alta de disparo)
- **Dónde:** `src/modules/pricing/pricing.service.ts` → `persistMarketReference` (~:210-256).
- **Estado actual:** el upsert va por `capturedDate=hoy` (idempotente **dentro** del día), pero entre días
  acumula **una fila por `(card, finish, día)`** → ~30-40k filas/día, ~11-15M/año, **sin job de barrido**
  (`priceReference.deleteMany` no existe). Es la contrapartida directa de "preciar todo el catálogo 2×/día".
- **Impacto:** medio a alto a futuro: crecimiento monotónico de la tabla que degrada consultas y storage al
  operar a escala. Correctness OK (el upsert diario no corrompe).
- **Disparador:** **ANTES de operar a escala.** Solución: job de retención/particionado por `capturedDate`
  (mantener N días de histórico raw + agregados para la gráfica de set §4.12). Dependencia **devops**
  (particionado) / DEV-1.

### BE-21 · single-flight solo en memoria del proceso; el disparo manual evade la cola
- **Dónde:** `src/modules/catalog/catalog-sync.service.ts` → `syncAllStatus.running` (~:234) +
  `src/modules/catalog/admin-jobs.controller.ts:150` (`POST /admin/jobs/catalog-price-sync`).
- **Estado actual:** `syncAllStatus.running` es estado **en memoria**; el disparo manual corre `syncAll()`
  **in-process en el web dyno**, saltándose el worker BullMQ. En multi-instancia, un disparo manual puede
  solaparse con el programado → **dos re-syncs concurrentes** → doble carga y agotamiento del rate-limit
  (429). Idempotente: no corrompe datos.
- **Impacto:** medio bajo condiciones multi-instancia: doble carga sobre pokemontcg.io y 429. Aceptable en
  instancia única (el single-flight en memoria basta).
- **Disparador:** **multi-instancia o al cablear BullMQ para catálogo.** Mitigación: encolar también el
  disparo manual, o lock en Redis (`SET NX`). Familia DEV-1/BE-11/BE-12.

### BE-22 · `persistMarketReference` guard `isManualOverride` es TOCTOU (Baja)
- **Dónde:** `src/modules/pricing/pricing.service.ts:228-254`.
- **Estado actual:** `findUnique` → early-return si `isManualOverride`; si no, `upsert` cuyo `update` fija
  `isManualOverride:false`. Entre lectura y escritura un admin podría setear override y el `update` lo
  **pisaría** (`manual` → `pokemontcg_io`). Ventana **minúscula**; consistente con el TOCTOU de
  `syncCardPrice` y BE-15. Es **dinero** (precio de referencia).
- **Impacto:** bajo. Requiere que un override manual caiga exactamente en la ventana lectura→escritura de un
  sync concurrente; el peor caso es un override pisado por el precio automático (recuperable re-aplicando).
- **Disparador:** **al endurecer overrides o si aparece pisado en operación.** Solución:
  `updateMany ... WHERE isManualOverride=false` en una sola sentencia, o `$transaction`.

### BE-23 · Disparo manual del job sin `@Throttle` propio (Baja/Info, seguridad)
- **Dónde:** `src/modules/catalog/admin-jobs.controller.ts:145-160`.
- **Estado actual:** el single-flight impide barridos solapados, pero cada disparo en loop ejecuta
  `client.getSets()` contra pokemontcg.io. **Solo `super_admin`**, impacto bajo.
- **Impacto:** bajo. A lo sumo carga extra sobre el proveedor si un super_admin abusa del endpoint en loop.
- **Disparador:** si se abusa. Mitigación: `@Throttle` nominal en el endpoint de jobs.

### Fase 2 del epic de precios — deuda del delta (commits fba6486 + fee3c19, 2026-08-17, no bloqueante)

> De la **Fase 2** del epic de precios (precio de VENTA por RAREZA editable en admin:
> `computeSalePriceForRarity`, endpoints `sales-rules`/`sales-rarities`, swap de call-sites de venta, piso
> `fixed` que vuelve vendible el bulk). Triple veredicto **APROBADO** (qa + techlead APROBADO-con-deuda +
> seguridad APROBADO). Todos los ítems de abajo son **no bloqueantes**, dueño **backend**. Registrados a
> petición del techlead/seguridad sin tocar código de producción. Continúan la numeración `BE-*` (tras
> BE-1..23). Detalle de implementación en `docs/BACKEND_NOTES.md §35` (contrato/arquitectura §4.14).

### BE-24 · Trap de tipado estructural `BuylistRule` vs `SalesRule` (techlead)
- **Dónde:** `backend/src/common/money.ts` (tipos `BuylistRule`/`SalesRule` + `quoteAcquisitionForFinish` /
  `computeSalePriceForRarity`).
- **Estado actual:** los dos tipos son **estructuralmente idénticos** (`{mode,value}`) y las dos funciones
  tienen **firma posicional idéntica** → TypeScript **NO atrapa** si se pasa `BUYLIST_PRICE_RULES` a la
  función de venta (o viceversa); se aplicaría matemática incorrecta **en silencio**. Hoy es seguro porque
  cada servicio lee su propia key (`SALES_PRICE_RULES` vs `BUYLIST_PRICE_RULES`), pero el tipo **no es
  guardarraíl**.
- **Impacto:** bajo/latente. Correctness OK hoy; el riesgo aparece si un refactor cruza las reglas de
  compra y venta sin que el compilador lo señale (venta a precio de compra o al revés).
- **Disparador:** **al tocar el resolver de precios.** Mitigación: branding nominal
  (`& {readonly __brand:'sales'}` / `'buylist'`) para que TS distinga los tipos, o un test que **fije la
  fórmula de cada rama** (venta = markup sobre mercado; compra = % de la referencia).

### BE-25 · N+1 de lecturas de settings en `fetchSellable` agravado por el gate relajado (techlead + qa)
- **Dónde:** `src/modules/catalog/catalog.service.ts:69-82` (`fetchSellable`) + `toListingDTO` →
  `computeSalePriceForItem`; lecturas en `src/modules/settings/settings.service.ts:22-26`
  (`configSetting.findUnique` **sin memoización**).
- **Estado actual:** al quitar el filtro de precio del gate coarse (para que el piso `fixed` vuelva vendible
  el bulk), se itera **TODO** `platform+listed` y cada `toListingDTO`→`computeSalePriceForItem` hace **2
  lecturas de settings sin cache** (`SALES_PRICE_RULES` + fallback). El número de queries crece con el
  inventario listado (afecta `facets`/`listSets`/`search`). Es **perf, no correctness**.
- **Impacto:** rendimiento del storefront (Compra/facets) al crecer el catálogo publicado.
- **Disparador:** **al crecer el catálogo listado.** Mitigación: izar la lectura de `SALES_PRICE_RULES` +
  fallback **una vez por request**, o memoizar `SettingsService` (misma familia que BE-4/D3, acotada a la
  ruta de venta).

### BE-26 · Orden a $0 por regla `fixed:0` (seguridad B-6, Baja, ruta de dinero)
- **Dónde:** `src/modules/catalog/catalog.service.ts:118` (gate exige `salePriceCents>0`) vs.
  `src/modules/orders/orders.service.ts:38-41` (`salePriceOf` solo rechaza `== null`).
- **Estado actual:** el catálogo exige `salePriceCents>0` para exponer, pero `salePriceOf` **no** rechaza
  `<=0` y `createSession` **no re-verifica** `sellable`/`price>0`. Si un `super_admin` fijara por error un
  piso `fixed:0` (el validador permite `value>=0`), un checkout con un `inventoryItemId` **conocido** crearía
  una orden a `unitPriceCents:0`. Requiere **misconfig de un actor confiable** + un cuid **no adivinable** → **Baja**.
- **Impacto:** bajo. Ruta de dinero: una orden a precio cero saltándose el gate `>0` del catálogo; acotado a
  actor confiable equivocado.
- **Disparador:** **endurecer ANTES de operar con dinero real.** Mitigación: que `salePriceOf` rechace `<=0`
  (alinear con el gate `>0` del catálogo) y/o que el validador de `fixed` exija `value>=1`.

### BE-27 · `fixed` sin cota superior → overflow Int32 (seguridad B-7, Baja)
- **Dónde:** `src/common/money.ts` → `isValidSalesRule` (valida `fixed` solo `>=0`, sin cota superior; `pct`
  puede dar `market×11`).
- **Estado actual:** ni `fixed` ni el resultado de `pct` tienen cota superior; ambos alimentan columnas
  `*Cents` **Int 32-bit** → un `fixed` > 2.147e9 (o un market alto ×11) **desborda** la escritura en Postgres.
  Misma familia que **B-3** (`PENTEST_NOTES`, ya aceptada), aquí **extendida a venta**. Input **confiable**,
  no explotable por externo.
- **Impacto:** bajo. A lo sumo un error de escritura por un dial mal configurado por actor confiable; no es
  vector externo.
- **Disparador:** al abordar B-3. Mitigación: **cota superior en `fixed`** dentro de la decisión BigInt de
  B-3 (acotar también el `pct×market`).

### WS-A (v1.14-price-ingest) — deuda aceptada del triple veredicto (2026-08-17, no bloqueante)

### BE-28 · `FxDto.rate` `@IsInt @Min(1)` — override manual de FX solo admite pesos enteros (MENOR-1)
- **Dónde:** `src/modules/pricing/pricing.controller.ts` (`FxDto.rate` `@IsInt`), pre-existente (commit `eb29654`,
  NO introducido por WS-A).
- **Estado actual:** el override manual de la tasa USD→MXN se valida como **entero** (18, 19…), no decimal.
  Un tipo real como 18.75 se rechaza; el admin fijaría 18 o 19 → **~2.7% de error** en el precio de referencia
  cuando se usa el override manual. El colchón (`fx_buffer_pct`) sí es decimal. La ruta automática (Banxico) sí
  guarda el rate decimal real; esto solo afecta al **override manual** explícito.
- **Impacto:** bajo. Solo cuando el admin fija tasa manual (respaldo); el flujo normal (Banxico) no se afecta.
- **Disparador:** al pulir la UX de FX de M2. Mitigación: `@IsNumber()` + `@Min(0.000001)` en `rate` (permitir
  decimales) — **cambio menor de validación, sin efecto en el resto**. Fuera de alcance de WS-A (no lo tocó).

### BE-29 · `resolveCardId` fallback `(set, number)` puede mal-resolver si dos cartas comparten `number` (MENOR-3)
- **Dónde:** `src/modules/pricing/price-ingest.service.ts` → `resolveCardId` (`card.findFirst({ setId, number })`).
- **Estado actual:** la resolución **primaria** es `Card.externalId` (`@unique`, exacta). El **fallback** por
  `(setId, number)` usa `findFirst`; si un set tuviera **dos cartas con el mismo `number`** (p. ej. variantes/
  promos con numeración repetida), podría resolver a la "otra" y escribir el `PriceReference` en la carta
  equivocada. No hay índice/constraint `(setId, number)` único. En la práctica el proveedor de paga trae
  `externalId`, así que el fallback rara vez actúa.
- **Impacto:** bajo. Ruta de dinero (precio de referencia) pero acotado al caso raro de `number` duplicado en un
  set Y sin `externalId` en la fila del proveedor. SEC-A1 intacto (no viene del cliente).
- **Disparador:** si el proveedor de paga entregara filas SIN `externalId`. Mitigación: preferir siempre
  `externalId`; si se necesita robustez del fallback, desambiguar (p. ej. por `finish`/`rarity`) o rechazar el
  `number` ambiguo en vez de adivinar.

### BE-30 · El seed depende del default de código para `price_provider` (auditoría) (MENOR-4)
- **Dónde:** `prisma/seed.ts` (siembra `SETTING_DEFAULTS`) + `SettingsService.get` (cae al default de código si
  no hay fila).
- **Estado actual:** `PRICE_PROVIDER` **sí** está en `SETTING_DEFAULTS` (`pokemontcg_io`) → un **seed fresco**
  escribe la fila. Pero una BD **pre-existente** que no re-corra el seed **no** tendrá la fila `price_provider`
  hasta el primer `PUT /admin/settings`; mientras tanto `providerFor()` resuelve por el **default de código**
  (`pokemontcg_io`) — funciona y es money-safe, pero **no deja rastro en `ConfigSetting`** para auditoría.
- **Impacto:** muy bajo. Solo cosmético/auditoría; el comportamiento efectivo es correcto (legacy).
- **Disparador:** opcional. Mitigación: sembrar/backfillear explícitamente la fila `price_provider` en la BD de
  staging/prod (o un `PUT /admin/settings { priceProvider: "pokemontcg_io" }` una vez) para que el dial sea visible.

### BE-31 · Single-flight del parent solo explícito en la rama secuencial (techlead-3)
- **Dónde:** `src/jobs/price-ingest.service.ts` → `run()` (flag `running` para la rama SIN Redis) vs
  `enqueueAllSets()` (rama CON cola).
- **Estado actual:** la rama **secuencial** (sin Redis) tiene single-flight explícito (`running`). La rama **con
  cola** se apoya en el **jobId determinista por día por set** (`price-ingest-set-<setId>-<día>`): BullMQ
  deduplica y el upsert es idempotente → no hay doble escritura, pero NO hay un guard "ya hay una corrida
  activa" simétrico. Se añadió un **comentario** explicando el mecanismo; el guard explícito queda pendiente.
- **Impacto:** ninguno de dinero (dedup + upsert idempotente lo cubren). A lo sumo, dos disparos casi simultáneos
  re-encolan los mismos jobIds (no-op para los pendientes).
- **Disparador:** si se quisiera un `enqueued:false` fiable en la rama con cola. Mitigación: guard simétrico
  (p. ej. contar jobs activos/deduplicados del día antes de re-encolar).

### BE-32 · Si el bulk del proveedor ignora `page` → hasta `maxPages` requests idénticas + N queries/set (techlead-4)
- **Dónde:** `src/modules/pricing/providers/pokemonpricetracker-bulk.provider.ts` (loop de páginas) y
  `price-ingest.service.ts` → `resolveCardId` (una query por fila).
- **Estado actual:** (a) si el endpoint del proveedor **ignora** `page` y devuelve siempre la misma página llena,
  el loop iteraría hasta `maxPages` (40) requests **idénticas** (gasta cuota; **sin** error de dinero — el upsert
  idempotente y el jobId por día lo neutralizan). (b) `resolveCardId` hace **N queries** por set (una por fila);
  se podría **batchear** (un `findMany` por `externalId[]`/`number[]` y resolver en memoria).
- **Impacto:** bajo. Coste de cuota/latencia, no de dinero. Solo relevante al flipar al proveedor de paga.
- **Disparador:** verificar la paginación real en la 1ª corrida (§36.2). Mitigación: cortar el loop si una página
  repite el contenido de la anterior; batchear `resolveCardId` con un `findMany` por set.

### BE-33 · Moneda/unidad del proveedor de paga — MITIGADA por fail-closed `MARKET_FORMAT` (seguridad Media)
- **Dónde:** `src/modules/pricing/providers/pokemonpricetracker-bulk.provider.ts` (`POKEMONPRICETRACKER_MARKET_FORMAT`).
- **Estado actual:** el riesgo original (asumir USD-dólares y persistir precios inflados ~18×/100× si el payload
  fuera MXN o centavos) queda **mitigado por construcción**: el proveedor de paga **NO persiste** bajo una
  moneda/unidad asumida — el operador debe fijar `POKEMONPRICETRACKER_MARKET_FORMAT` (sin default); sin él corre
  en **sample-only** (loguea la muestra, persiste nada). **PO confirmó `usd_dollars`** (2026-08-17). El dial
  `price_provider` sigue sembrado en `pokemontcg_io` (legacy) hasta el flip consciente.
- **Impacto:** residual muy bajo (el candado exige acción explícita). Queda como recordatorio operativo.
- **Disparador (aceptado):** **abordar/confirmar ANTES de flipar a `pokemonpricetracker`** — fijar
  `POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars` tras inspeccionar el log de la 1ª corrida (runbook en
  `BACKEND_NOTES §36`). Sin esa env, el flip del dial NO escribe precios (seguro).

### BE-35 · `getReferencesBatch` arma una consulta cartesiana (inocua con cap 50) (Baja)
- **Dónde:** `src/modules/pricing/pricing.service.ts` (`getReferencesBatch`), usada por `bulkPublish` y
  `CatalogService.fetchSellable`.
- **Estado actual:** el batch de referencias construye un `WHERE` con el producto de las dimensiones
  `(cardId, productType, gradeKey, finish)` de los ítems del lote → en el peor caso la condición crece de
  forma cuasi-cartesiana. **Inocuo hoy**: los lotes están capados (bulk-publish/batch ≤ 200 líneas; el
  cotizador batch ≤ 50) y el índice de `PriceReference` sirve la búsqueda; el volumen real es pequeño.
- **Impacto:** ninguno observable a la escala del MVP; potencial de consulta grande si se subieran mucho los
  caps de lote sin revisar la forma del query.
- **Disparador (aceptado):** si se aumenta el cap de lote (>200) o aparece latencia en `bulk-publish`/
  `fetchSellable`, reescribir a un `IN` sobre claves compuestas o a tuplas `(cardId, finish)` acotadas.

### BE-36 · `isSecretRare = numberSort > printedTotal` marca TODOS los promos TG/GG/SV (cosmético)
- **Dónde:** `src/modules/inventory/master-set.service.ts` (`MasterSetCardCellDTO.isSecretRare`).
- **Estado actual:** como los promos/subsets (`TG`/`GG`/`SV`) reciben `numberSort = 1_000_000 + parte`
  (clave "al final", ver `BACKEND_NOTES §38.4`), su `numberSort` **siempre** supera `printedTotal` → el flag
  `isSecretRare` sale `true` para **todas** esas cartas, no solo las secret rare reales. Es un **artefacto
  cosmético del binder** (un badge en la cuadrícula), no afecta dinero, inventario ni valuación.
- **Impacto:** puramente visual en el Master Set (badge de secret rare sobre-inclusivo en promos).
- **Disparador (aceptado):** **coordinar la definición de "secret rare" con el arquitecto** (¿derivar de la
  rareza real del catálogo? ¿solo numéricas con `number > printedTotal`?) antes de darle peso al badge en la
  UI. Ligado a la reconciliación de la fórmula `numberSort` del contrato §M1 (ver nota al arquitecto en
  `BACKEND_NOTES §38.4`/§39.1).

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

### Gate SAST — endurecimiento cripto GCM en PII (2026-08-16, no bloqueante)

- **SAST-1 (backend) — RESUELTA (2026-08-16) — `createDecipheriv` GCM sin `authTagLength` (tag truncado
  aceptado).** Regla semgrep `javascript.node-crypto.security.gcm-no-tag-length` (registry `p/*`) marcó
  `src/common/crypto/pii-crypto.service.ts` → `decrypt()`: `createDecipheriv('aes-256-gcm', key, iv)` seguido
  de `setAuthTag(tag)` **sin** fijar `authTagLength`. Node acepta authTags GCM más cortos de 16 bytes, así que
  un atacante capaz de manipular el ciphertext almacenado (`v1:iv:tag:ct` en BD) podría presentar un **tag
  truncado** y debilitar la autenticidad GCM (riesgo de forja). Defensa en profundidad sobre PII (CLABE/RFC/INE).
  **Fix (endurecimiento interno, retrocompatible — NO cambia el formato serializado ni las claves):**
  (1) `decrypt()` valida `tag.length === 16` **antes** de `setAuthTag` y, si no, lanza el mensaje genérico
  `'Malformed PII ciphertext'` (mismo que un payload mal formado → **sin oráculo** que distinga el motivo);
  (2) ambos `createCipheriv`/`createDecipheriv` fijan explícitamente `{ authTagLength: 16 }`. Los authTags que
  produce `encrypt()` (`cipher.getAuthTag()`) siempre son de 16 bytes, así que los datos ya cifrados descifran
  igual. Tests en `test/pii-crypto.spec.ts`: round-trip OK + rechazo de tag truncado (12B), vacío y
  sobredimensionado (20B). Gates verdes: lint/typecheck/build OK, **57 suites / 372 tests**. Detalle en
  `docs/BACKEND_NOTES.md`. Owner: **backend**. Queda pendiente el **veredicto de seguridad + qa** (toca PII/cripto).

- **SAST-2 (backend) — RESUELTA (2026-08-16) — supply-chain HIGH/CRITICAL en node-tar / tmp (gate
  `trivy-image`).** El SAST de imagen del backend reportó CVEs reales en deps transitivas:
  - **`tmp`** (CVE-2026-44705, path traversal por prefix/postfix; fixed **>= 0.2.6**): devDependency
    transitiva `@nestjs/cli@10.4.9 → inquirer@8.2.6 → external-editor@3.1.0 → tmp@0.0.33`. Viajaba a la
    imagen porque `Dockerfile.backend` hace `npm ci --include=dev` sin poda (devops, DEVOPS_NOTES §6).
  - **`tar` (node-tar)** (CVE-2026-26960/-29786/-31802/-59874, hardlink path traversal + DoS; fixed
    **>= 7.5.18**): **no presente** en el árbol del backend (`npm ls tar` → vacío; ningún `node_modules/**/tar`;
    Prisma descarga sus engines sin node-tar). Sin fix necesario en el árbol actual.
  - **Fix:** `overrides` en `backend/package.json`: `"tar": ">=7.5.18"` (pin defensivo por si reaparece) y
    `"tmp": ">=0.2.6"`. Lockfile regenerado (`npm install` + `npm ci --include=dev`): **`tmp` → 0.2.7
    `overridden`** (cascadea sin romper el peer `^0.0.33`; elimina la sub-dep `os-tmpdir`); `tar` sigue ausente.
  - **Gates:** lint/typecheck/build OK; `npm test` **57 suites / 372 tests** (sin cambio de conteo; solo deps).
    Detalle en `docs/BACKEND_NOTES.md §30`. Owner: **backend**. El **verde final del gate lo confirma el runner
    de CI** (trivy-image necesita docker build + DB de trivy; egress bloqueado en local).

### Ola 2 — deudas techlead de Ola 1 (frontend, 2026-08-17)

> Las 3 deudas menores de mantenibilidad anotadas por **techlead** en la Ola 1 (dueño: **frontend**).
> Las tres eran triviales y limpias, así que se **RESOLVIERON** en la misma Ola 2 (junto con la gestión
> de inventario M1). Gates verdes tras el cierre: lint/typecheck/build OK, **35 archivos / 202 tests**.
> Detalle en `docs/FRONTEND_NOTES.md` (sección Ola 2).

- **TL-FE-1 — RESUELTA (2026-08-17) — paginación duplicada en ramas mock.** `getAdminShipments`,
  `getAdminUsers`, `searchBuylistCards` y `getAuditLog` repetían inline el slice de paginación
  (`pageSize/page/start`) en vez de usar el helper `paginate<T>` que ya existía para el historial 360°.
  **Fix:** `paginate<T>(rows, { page?, pageSize? })` se movió a la cabecera de `frontend/src/lib/api.ts`
  (junto a `delay`) y las 4 funciones lo reusan. De paso `getAdminShipments` ganó slicing real (antes
  devolvía TODAS las filas ignorando `page/pageSize` en mock).
- **TL-FE-2 — RESUELTA (2026-08-17) — generadores mock inline duplicados.** Los literales
  `` `job-${Math.floor(Math.random()*9000+1000)}` `` (3 sitios: `syncPricing`, `syncCatalog`,
  `syncAllCatalog`) y `` `Tmp-${...}-${...}` `` (2 sitios: `resetUserPassword`, `createAdminUser`) se
  extrajeron a los helpers privados `mockJobId()` / `mockTempPassword()` en `frontend/src/lib/api.ts`.
- **TL-FE-3 — RESUELTA (2026-08-17) — interfaz vacía `AdminBuylistItemDTO`.** `frontend/src/types/contract.ts`
  declaraba `export interface AdminBuylistItemDTO extends SellItemDTO {}` sin ningún consumidor (verificado
  por grep: solo la declaración). Se **eliminó**; `AdminBuylistDTO.items` ya tipaba `SellItemDTO[]` directo.

### Delta rama `claude/git-repo-review-c67xyk` — review techlead (2026-08-17, no bloqueante)

> Aprobado por **techlead** CON DEUDA ANOTADA. Cinco ítems de mantenibilidad/a11y/UX del delta, dueño
> **frontend**. No bloqueantes; registrados a petición del techlead sin tocar código de producción.
> Continúan la numeración `FE-*` (tras FE-1..6). FE-10 y FE-11 provienen de hallazgos QA (relacionados
> con BE-11 / gating de KYC).

### FE-7 · Doble fuente de verdad para "email bloqueado" en el gating de buylist
- **Dónde:** `frontend/src/hooks/useSellRequirements.ts:57` vs.
  `frontend/src/components/domain/BuylistKycForm.tsx:78`.
- **Estado actual:** `BuylistKycForm` **recomputa su propio** `emailBlocked` en lugar de recibir
  `sellReq.emailBlocked` por prop del hook. Lo necesita para el caso **403 en respuesta**, pero el gating
  **proactivo** podría venir del hook. Quedan dos lugares que calculan lo mismo y evolucionan por separado.
- **Impacto:** bajo. Deuda menor de mantenibilidad; riesgo de divergencia si la regla de "email bloqueado"
  cambia en un solo sitio.
- **Disparador:** al tocar el gating de buylist otra vez. Acción: **unificar en una sola fuente** (prop
  `emailBlocked` proveniente del hook), dejando el manejo del 403 como reacción a la respuesta.

### FE-8 · CTAs de login/register duplicados en la vista de buylist
- **Dónde:** `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx` — `SellRequirementsPanel`
  (cuando no hay sesión) **y** un bloque inline (~líneas 544-560).
- **Estado actual:** hay dos puntos que pintan el mismo llamado a iniciar sesión / registrarse cuando el
  usuario no tiene sesión: el panel de requisitos y un bloque inline aparte. Redundancia visual y lógica.
- **Impacto:** bajo. No bloqueante; posible inconsistencia si uno de los dos cambia y el otro no.
- **Disparador:** al pulir la vista de buylist. Acción: **consolidar en un solo punto de CTA sin sesión**.

### FE-9 · `SyncProgress` usa `role="status"` en vez de `role="progressbar"`
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx` (componente `SyncProgress`).
- **Estado actual:** la barra de progreso del barrido M2 se anuncia con `role="status"` y una alternativa
  textual (`done/total` en el label) → **aceptable** en a11y. Un `role="progressbar"` **semántico** con
  `aria-valuenow`/`aria-valuemax`/`aria-valuemin` sería más correcto; además el `aria-live="polite"` anuncia
  cada ~3s (algo verboso).
- **Impacto:** bajo. Nota menor de accesibilidad; hay alternativa textual válida, sin bloqueo funcional.
- **Disparador:** pulido de a11y. Acción: migrar a `progressbar` con los `aria-value*` y moderar la
  frecuencia/nivel del `aria-live`.

### FE-10 · Barra "completada" persiste tras terminar el barrido (hallazgo QA, par de BE-11)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx` — condición de render `running || total>0`.
- **Estado actual:** con el estado del `sync-status` en memoria del proceso (ver **BE-11**), al reentrar a M2
  se pinta la barra verde "Sincronización completada: N sets" del **último** barrido de forma indefinida
  (hasta que el proceso se reinicie o se dispare un nuevo barrido). Quirk de UX; no bloquea.
- **Impacto:** bajo. Cosmético/UX: puede confundir sobre si hay un barrido "reciente", pero no altera datos
  ni acciones.
- **Disparador:** cuando **BE-11** pase a progreso **persistido** (BullMQ). Acción: decidir cuándo
  ocultar/expirar el estado "completada" (p. ej. TTL o descarte al montar tras `finishedAt`).

### FE-11 · Staff no consulta KYC en el gating de venta (hallazgo QA, intencional/inocuo)
- **Dónde:** `frontend/src/hooks/useSellRequirements.ts:48`.
- **Estado actual:** para roles `vault_operator`/`super_admin` **no** se llama `GET /users/me/kyc` (evita el
  403), por lo que `SellRequirementsPanel` les muestra "CLABE no registrada" aunque técnicamente puedan
  enviar. **Intencional** (staff casi no vende); anotado por completitud.
- **Impacto:** muy bajo. Solo afecta la señal visual de requisitos para cuentas staff, que no es el flujo de
  venta objetivo; no hay error funcional ni fuga.
- **Disparador:** si el staff empieza a vender de verdad. Acción: resolver el gating de KYC para roles staff
  (consulta condicional o endpoint que no devuelva 403 para staff, coordinando con backend/arquitecto).

### Rediseño del cotizador — Fase 3a (commit 10d5205, 2026-08-17, no bloqueante)

> Del **rediseño del cotizador (Fase 3a)**. Ítems pedidos por **techlead** y **qa** sobre el delta del
> buylist. No bloqueantes, dueño **frontend**. Registrados a petición del techlead/qa sin tocar código de
> producción. Continúan la numeración `FE-*` (tras FE-1..11).

### FE-12 · Fan-out del auto-quote + bulk all-or-nothing (techlead + qa)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx` — `ResultQuote` (~:95-114) y
  `addSelectedToCart` (~:254-293).
- **Estado actual:** `ResultQuote` monta un `useQuery` **por resultado visible** → una búsqueda dispara
  ~`pageSize` (≤20) `POST /buylist/quote` en ráfaga (**mitigado** por queryKey compartido + `staleTime` 5min,
  que deduplica y cachea). El bulk `addSelectedToCart` usa `Promise.all` **all-or-nothing**: si una carta
  falla al cotizar, no se agrega **ninguna** al carrito de venta.
- **Impacto:** medio-bajo. Riesgo de topar el **throttle público 300/min** con paginación intensa (muchas
  búsquedas seguidas); y UX all-or-nothing en el bulk (un fallo aislado bloquea todo el lote). Correctness OK.
- **Disparador:** cuando exista el endpoint **batch quote (Fase 3b)** — colapsa el fan-out a **1 request** y
  permite resultado parcial; o si las búsquedas empiezan a devolver **listas grandes**. Acción: consumir el
  batch quote (una llamada por página) y cambiar el bulk a **parcial-tolerante** (agregar lo que sí cotizó,
  reportar lo que falló).

### FE-13 · `BuylistView.tsx` creció (~960 líneas) — pide extracción de hooks/subcomponentes (techlead)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx`.
- **Estado actual:** el archivo concentra carrito de venta, selección bulk, cotización por resultado, "Mis
  solicitudes" y el panel de resultados en ~960 líneas. La lógica **ya está encapsulada** en funciones
  pequeñas → la extracción sería **mecánica y de bajo riesgo**: hooks (`useCart`, `useBulkSelection`) y
  subcomponentes (`ResultsGrid`, `QuoteResultPanel`, `SellCart`, `MyRequestsSection`).
- **Impacto:** bajo. Mantenibilidad/legibilidad; no afecta comportamiento ni correctness.
- **Disparador:** **próximo toque funcional del buylist** (p. ej. al cablear el batch quote de FE-12). Acción:
  extraer los hooks y subcomponentes citados sin cambiar comportamiento.

### Editor de venta en M2 — Fase 2 (commit fee3c19, 2026-08-17, no bloqueante)

> Del pase **Fase 2** (editor de reglas de venta por rareza en M2). Ítem pedido por **techlead**, dueño
> **frontend**. Registrado a petición del techlead sin tocar código de producción. Continúa la numeración
> `FE-*` (tras FE-12/13).

### FE-14 · Duplicación del editor buylist/venta en `M2View.tsx` (techlead)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx` — secciones 4 (reglas de compra) y 5
  (reglas de venta).
- **Estado actual:** las dos secciones son **clones ~1:1** (estado `ruleDraft`/`salesRuleDraft`,
  `effectiveRule`, `saveRules`, flags `*Dirty`, ~75 líneas JSX cada una). Diferencias mínimas: fallback
  default (40 vs 15), copy `pctHint` de venta, y tope pct (100 vs 1000, hoy solo en el validador backend).
- **Impacto:** bajo. **Aceptable con 2 instancias**; el costo aparece al abrir una 3ª variante o al editar
  ambos a la vez (cambio en dos sitios, riesgo de divergencia).
- **Disparador:** **al agregar otra tabla-por-rareza o al tocar ambos editores.** Acción: extraer un
  componente parametrizado `RarityRulesEditor` (por query/mutation/namespace i18n/fallback). Pagar **antes**
  de una 3ª variante.

### Limpieza WS-B (auto-refresh de token) — deuda del delta (2026-08-17, no bloqueante)

> Del pase de **limpieza sobre WS-B** (auto-refresh de token, ya en main). En este pase el frontend corrigió
> un **comentario factualmente incorrecto** del single-flight en `api-client.ts` (afirmaba que el backend
> **ROTA** el refresh token en cada uso y que refresh paralelos "se invalidarían entre sí" — **FALSO**:
> `auth.service.ts` `refresh()` firma con el `tokenVersion` VIGENTE y NO incrementa ni persiste nada (JWT
> stateless) → el refresh viejo sigue válido tras refrescar y dos refresh en paralelo NO se invalidan entre
> sí) y **dedupó** `logout` para que delegue en `clearClientSession` (una sola fuente de limpieza de sesión).
> Los ítems de abajo son la deuda **no bloqueante** que el **techlead** señaló y quedó diferida. Dueño
> **frontend**. Continúan la numeración `FE-*` (tras FE-14).

### FE-15 · Auto-refresh NO universal: `exportFinanceCsv` usa fetch directo (fuera del interceptor)
- **Dónde:** `frontend/src/lib/api.ts` → `exportFinanceCsv` (~:1936-1960).
- **Estado actual:** el interceptor `401 → refresh → reintento` vive en `apiRequest`/`requestWithRefresh`
  (`api-client.ts`). `exportFinanceCsv` hace `fetch` directo con `Authorization: Bearer` manual (necesita leer
  **texto** CSV, no JSON) y por eso **NO** pasa por el interceptor: si el access token (15m) venció, el export
  CSV falla con **401 sin auto-refrescar**. (Nota: `uploadToPresignedUrl` **NO** es deuda — usa URL firmada
  sin bearer y **debe** evitar el interceptor a propósito.)
- **Impacto:** bajo. Admin-only (finanzas/`super_admin`) y **benigno**: en cuanto **cualquier** llamada que sí
  pase por `apiRequest` refresque el token (navegar/recargar la vista), un reintento del export funciona; un
  reintento **aislado** del export seguiría fallando porque no refresca por sí mismo. Sin fuga ni pérdida de datos.
- **Disparador:** al unificar el cliente HTTP o si el 401 en export molesta en operación. Acción: extraer un
  helper de `fetch` con refresh (o una variante de `apiRequest` que devuelva **texto**) y enrutar
  `exportFinanceCsv` por él, reusando `refreshTokensShared`.

### FE-16 · Huecos de tests del auto-refresh (single-flight concurrente, red, cuerpo 200 malformado)
- **Dónde:** `frontend/src/lib/api-client.ts` (`refreshTokens`, `refreshTokensShared`, `requestWithRefresh`) y
  su suite `frontend/src/lib/api-client.test.ts`.
- **Estado actual:** la suite cubre el 401→refresh→reintento, el no-bucle, `/auth/*`, sin-refresh-token y
  no-401; **faltan** tres casos: (1) **single-flight concurrente** — dos `apiRequest` que reciben 401 a la vez
  comparten **UNA** sola llamada a `/auth/refresh` (`refreshInFlight`); (2) la rama **`catch` de error de red**
  en `refreshTokens` (fetch que lanza → devuelve `null`, no bloquea); y (3) el **cuerpo 200 malformado** (200
  sin `accessToken`/`refreshToken` → se trata como fallo y devuelve `null`).
- **Impacto:** bajo. Calidad/mantenibilidad: la lógica funciona hoy, pero un refactor podría regresar el
  single-flight o el manejo de fallos sin que un test lo señale.
- **Disparador:** próximo pase de hardening de tests o al tocar el interceptor de refresh. Acción: agregar esos
  tres casos (dos 401 concurrentes con assert de **una** llamada a refresh; `fetchMock.mockRejectedValueOnce`;
  y un 200 con body incompleto).

### FE-17 · `pay()` / `requestWithdrawal()` usan try/catch + `useState` en vez de `useMutation` (patrón inconsistente)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/checkout/CheckoutView.tsx` (`pay()` ~:93) y
  `frontend/src/app/[locale]/(storefront)/shipments/ShipmentsView.tsx` (`requestWithdrawal()` ~:159).
- **Estado actual:** el resto del proyecto dispara mutaciones de red con **`useMutation`** de TanStack Query
  (estados `isPending`/`isError`/`isSuccess`, `reset`, invalidación de cache). Estas dos acciones que **tocan
  dinero/custodia** (crear sesión de checkout; solicitar retiro) siguen el patrón viejo: `async function` con
  `try/catch/finally` + banderas manuales en `useState` (`creating`/`payError`/`emailNotVerified`, etc.). El
  comportamiento es correcto (bloquea doble envío, muestra el error real), pero el patrón diverge del estándar.
- **Impacto:** bajo. Mantenibilidad/consistencia: dos formas de hacer lo mismo; el estado manual es más fácil de
  desincronizar en un refactor (p. ej. olvidar `setCreating(false)` en una nueva rama) y no reusa la invalidación
  declarativa de cache. Sin fuga ni bug funcional hoy.
- **Disparador:** al tocar cualquiera de las dos vistas o en un pase de unificación de acceso a datos. Acción:
  migrar ambas a `useMutation` (mapear `EMAIL_NOT_VERIFIED`/errores en `onError`, `isPending`→loading del botón),
  como ya hacen M1/M2/M5/M6.

### FE-18 · `PrivateRouteGuard` acopla la lista de rutas privadas por prefijo (frágil)
- **Dónde:** `frontend/src/components/layout/PrivateRouteGuard.tsx` (`PRIVATE_PREFIXES`, `isPrivatePath`).
- **Estado actual:** el guard de cliente decide qué rutas exigen sesión con una **lista hardcodeada de prefijos**
  (`['/vault', '/orders', '/shipments', '/checkout']`) comparada contra el `pathname`. Cada ruta privada nueva
  hay que **acordarse** de añadirla a ese array; si se olvida, la vista se renderiza sin sesión y solo revienta
  al pegarle al backend (401 críptico) — justo lo que el guard evita.
- **Impacto:** bajo-medio. Mantenibilidad/seguridad-de-UI: es defensa de UI (el backend sigue siendo la
  autoridad), pero la lista puede quedar desincronizada del árbol de rutas real. Acoplamiento por convención de
  strings, no por estructura.
- **Disparador:** al añadir una nueva sección privada del storefront, o al reorganizar rutas. Acción: mover las
  rutas privadas a un **route group `(protected)`** de Next (App Router) cuyo `layout` monte el guard, de modo que
  la privacidad la determine la **ubicación en el árbol**, no una lista paralela de prefijos.

### FE-19 · Lógica de auth-redirect duplicada entre `AdminShell` y `PrivateRouteGuard` (extraer `useAuthGate`)
- **Dónde:** `frontend/src/components/layout/AdminShell.tsx` y `frontend/src/components/layout/PrivateRouteGuard.tsx`.
- **Estado actual:** ambos componentes implementan **el mismo patrón** casi idéntico: `requireAuth = !config.useMocks`,
  `useEffect` que en modo real hace `router.replace({ pathname: '/login', query: { next: pathname } })` cuando
  `ready && !isAuthenticated`, y un estado de carga (`aria-busy`) mientras se resuelve la sesión — para no mostrar
  contenido que dará 401. AdminShell añade encima el chequeo de **rol** de back-office; el resto es copia.
- **Impacto:** bajo. Mantenibilidad: dos copias del mismo criterio de redirección (`next`, modo mock, orden de
  `ready`/`isAuthenticated`); un cambio de política de auth-redirect hay que hacerlo en dos sitios y es fácil que
  se separen.
- **Disparador:** al tocar la política de redirección o al añadir un tercer consumidor. Acción: extraer un hook
  `useAuthGate({ requireRole? })` que devuelva `{ blocked, redirecting }` y centralice el `useEffect` + el criterio;
  AdminShell lo consume con `requireRole` de back-office y PrivateRouteGuard sin rol.

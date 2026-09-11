# DEVOPS_NOTES.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **devops**. Cómo levantar el entorno local, correr CI y desplegar/rollback.
> Coherente con `docs/ARCHITECTURE.md` (§1 stack, §8 variables) y `PROJECT.md`.
> Estado: **fase de cierre**. Código presente en `backend/` y `frontend/`; **QA aprobó** y
> **techlead aprobó** (doble veredicto). Único ítem del DoD legítimamente **pendiente**: el
> **deploy real**, bloqueado por falta de credenciales de producción (ver §11). Runbook listo.
>
> **Actualización 2026-08-17 (v1.14 — WS-A CERRADO: ingest de precios con proveedor de paga):** WS-A
> recibió **triple veredicto** (qa+techlead+seguridad) y backend cerró 3 follow-ups; estado ya reflejado
> aquí. (1) El job **`price-ingest`** (ingest masivo por set vía **PokemonPriceTracker**, pluggable por el
> dial `PRICE_PROVIDER`) se programa **POR DEFECTO 2×/día** con el dial sembrado `pokemontcg_io` (legacy
> USD, money-safe): con Redis (Railway) los precios se refrescan **desde el arranque** sin config manual.
> (2) El barrido pesado `catalog-price-sync` (force:true) se **retiró del schedule** (ahora MANUAL/ops-only)
> y lo reemplaza `catalog-metadata-sync` **diario** (`force:false`, solo sets nuevos); además `catalog-sync`
> tras WS-A **ya no escribe `PriceReference` ni convierte FX** (§18.1 corregido). (3) Candado money-safe
> **`POKEMONPRICETRACKER_MARKET_FORMAT`** (env, sin default): sin él el proveedor de paga corre **sample-only**
> (no persiste precios); el PO confirmó **`usd_dollars`**, a fijar **tras leer el log de muestra** (§19.5).
> Ver **§18** (metadata/manual), **§19** (ingest, horarios, orden `fx-refresh → price-ingest`, flip runbook con
> `MARKET_FORMAT`, rollback por dial) y el bloque de precios/scheduling de `.env.example`. El **scheduler** y
> `env.validation.ts` los cabla **backend** (devops no toca `backend/`).
>
> **⇒ Actualización 2026-08-24 (P-48 / v2.0 — «precio puro por valor de mercado»): EL RUNBOOK
> OPERATIVO VIGENTE ES §29.** Tres veredictos **aprobados** (QA · techlead con deuda · seguridad
> **0 críticos / 0 altos**) y **tres decisiones del dueño** ya reflejadas ahí:
> **(1)** **P-47 primero, P-48 después** — la fuente del precio se estabiliza **antes** de cambiar la
> matemática que se le aplica (§29.3, con criterio de corte explícito).
> **(2)** El cut-over va **POR SETS**, empezando por uno chico, leyendo `summary.listedNowPending` y los
> `counts` de la cola entre set y set (§29.4b/§29.4c).
> **(3)** La **brecha de E2E contra mocks** se cierra **antes** de desplegar, por la **ruta NATIVA sin
> Docker** de **§29.10** (`scripts/stack-native.sh` + subset `@real`). **La ejecuta QA.**
> **Estado del DoD y qué falta exactamente: §29.11 — y OBLIGATORIO leer §29.11-bis**, que corrige el
> veredicto: tras certificar, la rama **se movió** (`d8c4625` + trabajo sin commitear de backend/frontend),
> así que **el delta que se desplegaría ya no es el que se aprobó** y el gate de release debe re-pasarse
> sobre el árbol final. §27 queda como **registro histórico**.
>
> **⇒ Actualización 2026-08-28 (v1.50.3, rama `claude/psa-graded-card-value-gmhv5u`): NUEVA §32 —
> PROPAGACIÓN DE SEEDS.** El arquitecto publicó en **ARCHITECTURE §11.0** una **regla general normativa
> que aplica a TODOS los diales del proyecto**, no solo a esta feature: **un seed es una condición
> inicial, no un estado deseado** (`prisma/seed.ts` usa `update: {}`), así que **cambiar el default de
> una clave ya sembrada NO cambia ningún entorno existente — incluida producción**. Cambiar un seed es un
> **cambio de DATOS**, y exige **dos artefactos**: el default nuevo *y* un paso de despliegue explícito.
> **Sin ese paso, el despliegue pasa todos los gates y la feature se comporta en producción exactamente
> como antes.** Su aplicación concreta a esta release (§4.38p: los 3 diales `manualFreshnessDays` 30,
> `minSampleCount` 5, `maxRawMultiple` 100), el **`UPDATE` directo prohibido**, qué hacer cuando un dial
> **diverge** (se pregunta al humano, no se pisa), la verificación de cierre y el **rollback** están en
> **§32**, con el comparador **solo-lectura** `scripts/check-graded-estimate-dials.sh` y el **PASO 8** de
> `scripts/post-deploy.sh`. También ahí: **`next build` + `next start` para gates, nunca `next dev`**
> (§32.6) y la confirmación de los dos huecos de entorno **abiertos** (§32.7).
>
> **⇒ Actualización 2026-08-31 (v1.51, M-48): NUEVA §32.12 — UN SOLO DIAL, y encenderlo es un ACTO DE
> GASTO.** El dueño colapsó los dos interruptores del gancho de grading en **uno**
> (`grading_hook_enabled`, seed `off`, DTO `gradingHookEnabled`): el mismo `PUT` **publica la afirmación
> comercial Y autoriza al barrido diario a pedir datos a un proveedor de PAGA y a escribir precios**. Las
> dos claves viejas quedan **retiradas del código y vivas en la tabla** —inertes— y por eso la línea de
> inventario del arranque las lista bajo su rótulo: leer `graded_estimate_ingest_enabled = off` y concluir
> «el ingest está apagado» es **la trampa de diagnóstico** de este pase. En **§32.12**: el **presupuesto en
> créditos publicado ANTES del primer encendido** (**250 × 2 × 2 = 1 000 créditos/día**, y
> `ingestMaxCardsPerRun` es **lo único entre un `PUT` y la factura**), el **runbook de 7 pasos** con sus
> **dos verificaciones POSITIVAS de ausencia de gasto** —ejecutadas, con la salida real pegada—, el
> comparador `check-graded-estimate-dials.sh` actualizado a v1.51, la **incapacitación del entorno E2E/CI**
> frente al proveedor de paga (`docker-compose.yml` pasaba la credencial **sin default**: en CI quedaba
> vacía por accidente, no por diseño) con su guarda nueva
> `scripts/check-e2e-provider-incapacitation.sh` cableada en **`ci.yml`** —no en `deploy.yml`, que no
> corre—, y el **veredicto de la sonda** registrado. **Encender el dial NO es de devops: es del dueño.**
>
> **⇒ Actualización 2026-08-28, 2ª ronda (rechazo de QA + revisión del techlead):**
> **§32.10 — el arnés de gate no arrancaba.** `up --seed --gate` moría en el `next build` porque el
> `NODE_ENV=development` que el backend necesita **se filtraba** al build del frontend (BLOQ-1 de QA).
> El modo gate de §32.6 era, literalmente, **el único camino documentado y no existía**. Arreglado
> (el `NODE_ENV` del frontend lo fija el modo, no se hereda), con **detector de regresión** que mata el
> build si vuelve a aparecer el aviso de Next, y con `down` arreglado para que **libere el puerto de
> verdad** (`next start` se renombra a `next-server` y quedaba huérfano). **Verificado corriéndolo, 2/2
> en verde**, no por inspección.
> **§32.11 — hueco de enforcement anotado, no cerrado.** La verificación de diales del DoD depende hoy de
> que un humano recuerde correr `post-deploy.sh`: **enforcement de honor** (techlead). Sigue manual **por
> decisión escrita**, con su contrapartida real (automatizarlo exige un JWT `super_admin` de prod en CI) y
> con una **vía barata propuesta sin secretos nuevos** (`config inventory` sobre `railway logs`).
>
> **Actualización 2026-08-23 (D-4 — cierre techlead, regla 10):** el release
> `fix/variant-composition-regression` @ `9b6a81b` trae **cambios de DATOS** que `migrate deploy` NO cubre
> solo (reshape de tiers **P-34 T2=25%** + cura del sellado **M-39/M-40**). La **secuencia exacta
> post-deploy**, su idempotencia, qué hacer si falla y el **rollback** quedan en **§27**, y el orquestador
> idempotente **`scripts/post-deploy.sh`** los corre en orden y **PARA ante «ACCIÓN REQUERIDA»** del reshape
> money-crítico. Ver **§27**.
>
> **⇒ Actualización 2026-09-01 (v1.51, rama `claude/buylist-inventory-workflow-hdnls3`): NUEVA §33 —
> `APP_PUBLIC_URL`.** El ciclo de adquisición del buylist manda dos correos con un **CTA al portal del
> vendedor** y esa URL sale de `APP_PUBLIC_URL`, que **no estaba declarada** (hueco levantado por backend,
> `BACKEND_NOTES` §0.18). Ya está: declarada en `.env.example`, **alineada a `APP_BASE_URL`** (no es una
> segunda URL, es la misma con otro nombre) y **cableada** en los dos composes y en `stack-native.sh` —
> sin ese cableado, ponerla en `.env` **no llegaba al contenedor**. Se deja **SIN VALOR a propósito**:
> el destino `…/buylist/requests/<id>` **no existe todavía como página del frontend** (verificado), así
> que fijarla hoy cambia la frase segura por **un botón a 404**. Contrato de formato, activación en 3
> pasos, hallazgos enrutados y la revisión del resto del ciclo (correo, plazos, cola): **§33**.
>
> **⇒ Actualización 2026-09-01, 2ª ronda: `APP_PUBLIC_URL` ACTIVADA (§33.4-bis) + NUEVA §34 (BL-27).**
> **(a)** La pantalla del portal ya existe, así que la puerta se cruzó **midiéndola**: 307→200, con
> **404 de control negativo**. Activada en local y staging; **en prod la fija el humano**. Sigue abierto
> —y enrutado a backend— que el correo arma el path **sin `/{locale}`**, así que un vendedor `en`
> aterriza en español. **(b)** **BL-27**: `prettier` reformateó 445 líneas dentro de un cambio de dos.
> Medido el terreno (**274/418 archivos** sin formatear ⇒ un commit de **~13,7k líneas**; y el
> formateador **ni siquiera está elegido**: entra como transitivo de `resend`), **NO formateo el árbol**:
> cablé el gate que bloquea **la mezcla** de reformateo con lógica y **deja pasar** el commit de solo
> formato (`scripts/check-format-mix.sh` + job `format-mix`, probado contra 4 casos). **§34.6** tiene el
> estado real del gate de seguridad y el harness E2E: **no falta construir, falta encender**.
>
> **⇒ Actualización 2026-09-06 — NUEVA §38: SEC-OPS-1 (el gate auditaba un binario más viejo que el
> código auditado) + el mecanismo de purga de los datos del PoC.** Seguridad reportó que **por segundo
> pase consecutivo** el backend vivo era **más viejo que el commit a auditar**, y que las dos veces lo
> cazó una persona mirando la **hora de un PID**. La causa eran cuatro líneas de `start_backend()`:
> «¿responde? ⇒ reutilízalo», sin preguntar **qué código** servía. Ahora **`up` comprueba-o-reinicia y
> termina PROBÁNDOLO** (`verify_head`), hay verbo de solo-lectura **`stack-native.sh verify:head`** para
> QA/seguridad/pentester, el arranque **dice qué commit sirve**, y está cableado en **`e2e-real.yml`**,
> en **`deploy.yml`** (job nuevo `staging-serves-head`, del que ahora **depende el DAST**) y en
> **`ci.yml`** (guarda anti-regresión). **Reiniciar para auditar NO cuesta la evidencia**: `up` nunca
> siembra, y está medido que **`--seed` sí habría destruido 2 de las 3 filas del PoC** (§38.4). Al
> cablearlo, el comprobador **cazó el mismo fallo por tercera vez, en vivo** (§38.2). La **purga**
> (`scripts/purge-synthetic-poc-data.sh`) está lista, medida y **NO ejecutada**: la dispara el humano
> cuando backend confirme que ya no necesita esas filas (§38.7).
> **⚠️ Y mientras se escribía esto, a las 17:14, una resiembra de una corrida de integración borró DOS
> de las tres filas de evidencia de BL-35 eje 2** (§38.4-bis, con la cadena de relojes). El `--seed` de
> este script ahora **se planta** ante filas de PoC; las suites de integración no las cubro yo (llaman
> a `seedE2E()` directamente — rol **backend**). Lección que hay que decidir (**QA/seguridad/backend**):
> **la BD del fixture no es un sitio donde guardar evidencia de una auditoría** — el PoC va como
> **spec**, no como fila.

---

## 0. Estado actual (cierre)

> **⚠ Esta sección quedó FECHADA. El estado vigente es §29.11-bis + §30.6 (2026-08-24).** Lo de abajo
> describe un cierre anterior a la fase de seguridad y a P-48. **Hoy el DoD está REVOCADO** (el árbol se
> movió después de los veredictos) y **no hay deploy ni tag**. Antes de citar nada de esta sección como
> estado actual, lee **§30** (pase de infraestructura tras el gate de release) y **§30.6** (condiciones
> abiertas del DoD).

- **Código presente**: `backend/` (NestJS + Prisma) y `frontend/` (Next.js 14) existen, compilan y
  pasan `lint + typecheck + test + build` con los scripts que espera el CI.
- **Doble veredicto**: QA (funciona) y techlead (bien hecho) **aprobados**. Los 3 ítems de gate de
  go-live del techlead (reserva de checkout atómica, validación de diales M10, acotado por periodo de
  reportes) están **corregidos con tests** (ver `docs/BACKEND_NOTES.md` §6 y `docs/TECH_DEBT.md`).
- **Deuda no bloqueante**: registrada y aceptada en `docs/TECH_DEBT.md` (Backend BE-1…BE-8, Frontend
  FE-1…FE-6). Ninguna bloquea el cierre; cada una tiene dueño y disparador.
- **Infraestructura validada (estático, sin daemon Docker en esta sesión)**:
  - `docker compose config` → OK (interpolación y perfiles válidos).
  - `bash -n` de los 6 scripts → OK.
  - Los 5 workflows (incl. `deploy.yml`) y `docker-compose.yml` parsean como YAML válido; `railway.json`
    parsea como JSON válido.
  - `.env.example` cubre **todas** las env que el código lee (ver §4 y verificación en §10).
- **CD ejecutable:** `deploy.yml` ya tiene los pasos **reales** de Vercel + Railway (no plantilla). Se
  añadió `railway.json` (build backend con `Dockerfile.backend`). Se corrigieron dos bugs latentes de
  build en `Dockerfile.backend` (`npm ci --include=dev` + no podar devDeps, necesarios para
  `nest build` / `prisma migrate deploy` / seed) y uno en `Dockerfile.frontend` (`mkdir -p public`). Ver §6.
- **Deploy real**: **NO ejecutado**. Requiere credenciales prod y las plataformas provisionadas
  (ver runbook §11). Sin los GitHub Secrets de deploy, `deploy.yml` **falla en `preflight`** con la lista
  exacta (no despliega a medias). Esto es lo único que falta del DoD y es esperado en esta sesión.

## 1. Stack (resumen, ver ARCHITECTURE §1)

| Capa | Tecnología | Puerto local |
|---|---|---|
| Backend | NestJS + Prisma (Node 20 LTS) | 3001 (`/api/v1`) |
| Frontend | Next.js 14 App Router (Node 20 LTS) | 3000 |
| Base de datos | PostgreSQL 16 | 5432 |
| Cache/colas/rate-limit | Redis 7 + BullMQ | 6379 |
| Object storage (SOLO INE `kyc_ine`) | MinIO local / R2·S3 prod | 9000 (API), 9001 (consola) |
| Pagos | Stripe (webhooks a `/api/v1/webhooks/stripe`) | — |

---

## 2. Requisitos

- **Docker** + **Docker Compose v2** (`docker compose version`).
- **Node 20 LTS** + npm (para correr backend/frontend fuera de Docker en dev).
- Opcional: **Stripe CLI** (`stripe`) para reenviar webhooks a local.

## 3. Levantar el entorno local (paso a paso)

```bash
# 1) Entrar al repo
cd Dev-team

# 2) Crear tu .env desde la plantilla (y rellenar claves reales — ver §4)
cp .env.example .env

# 3) Levantar infraestructura (Postgres + Redis + MinIO + bucket)
./scripts/dev-up.sh
#    equivale a: docker compose up -d

# 4) Migrar y sembrar la base
./scripts/db-migrate.sh        # prisma migrate deploy (crea tablas + secuencia de folios)
./scripts/seed.sh              # diales M10, super_admin, ubicaciones/datos base

# 5) Arrancar las apps en modo dev
cd backend  && npm install && npx prisma generate && npm run start:dev   # http://localhost:3001/api/v1
cd frontend && npm install && npm run dev                                 # http://localhost:3000
```

Alternativa todo-en-Docker:

```bash
./scripts/dev-up.sh --apps     # docker compose --profile apps up -d  (construye Dockerfile.backend/.frontend)
```

Servicios y accesos tras `dev-up`:

- Postgres: `localhost:5432` (credenciales de `.env`).
- Redis: `localhost:6379`.
- MinIO API: `http://localhost:9000` · Consola: `http://localhost:9001`
  (login con `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`). El bucket `tcg-photos`
  se crea solo (init container `createbuckets`). **SEC-A5: es PRIVADO** — su
  único contenido en v1.2 es el prefijo `kyc_ine/` (INE del buylist), que **no**
  tiene lectura anónima; se sirve por presigned GET del backend. Ya **no** hay
  prefijos `inventory_photo/` (catálogo público) ni `dispute_claim/`. Ver §15.
- **SEC-M4:** los puertos de datos (Postgres 5432, Redis 6379, MinIO 9000/9001) se
  publican **solo en `127.0.0.1`**, nunca en `0.0.0.0`/LAN. El backend del perfil
  `apps` los alcanza por la red de compose (hosts `postgres`/`redis`/`minio`), no
  por el puerto de host.

Usuarios sembrados (por `seed.sh` → `backend` seed): super_admin (`SEED_ADMIN_EMAIL`
/`SEED_ADMIN_PASSWORD`) y vault_operator (`SEED_OPERATOR_EMAIL`/`SEED_OPERATOR_PASSWORD`).
**SEC-C1: define contraseñas fuertes en `.env` ANTES del seed** (`openssl rand -base64 24`).
Si van vacías, el backend aún cae a defaults débiles (`ChangeMe123!` / `Operador123!`
hardcodeada) — es un fix pendiente de **rol backend**; hasta entonces **rota ambas
credenciales tras el primer login**. Nunca arranques un entorno accesible con defaults.

Apagar:

```bash
./scripts/dev-down.sh          # conserva datos (volúmenes)
./scripts/dev-down.sh --wipe   # BORRA datos (reset total)
```

### Frontend contra backend real vs mocks

El cliente Next.js usa **fixtures mock por default** si `NEXT_PUBLIC_USE_MOCKS` NO es `"false"`
(ver `docs/FRONTEND_NOTES.md` y deuda FE-1). Para pegarle al backend real pon
`NEXT_PUBLIC_USE_MOCKS=false` (ya es el valor de `.env.example`). En imágenes Docker esta variable se
**hornea en build-time** (es `NEXT_PUBLIC_*`): el `Dockerfile.frontend` la recibe como `ARG` y el
compose la pasa como build arg (default `false`).

### Webhooks de Stripe en local

El backend expone `POST /api/v1/webhooks/stripe` (firma verificada, body crudo). Para probar en local:

```bash
stripe login
stripe listen --forward-to localhost:3001/api/v1/webhooks/stripe
# Copia el whsec_… que imprime a STRIPE_WEBHOOK_SECRET en tu .env y reinicia el backend.
```

> Nota (de backend): si delante del backend se pone un proxy/body-parser, **preservar el raw body**
> en la ruta del webhook o la verificación de firma fallará.

---

## 4. Variables de entorno (qué debe rellenar el humano)

Todas viven en `.env` (copia de `.env.example`, **nunca** se comitea). Con los valores por defecto de
`.env.example` la **infraestructura local** arranca sin tocar nada. Requieren **credenciales reales**
antes de usar esas funciones:

| Variable(s) | Para qué | Quién la provee |
|---|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Firmar JWT (auth). **Obligatorias en prod** (el backend aborta si faltan con `NODE_ENV=production`). | Generar: `openssl rand -hex 48` (distintas entre sí) |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Pagos y webhooks | Dashboard de Stripe (test/live) |
| `POKEMONTCG_IO_API_KEY` | Precios raw/singles (fetch real), **import diario de metadata** (`catalog-metadata-sync`, §18) **y fuente del `price-ingest` 2×/día cuando `PRICE_PROVIDER=pokemontcg_io`** (el dial **sembrado por defecto**; cientos de req/corrida). **Obligatorio en prod** (ver §18/§19). | dev.pokemontcg.io (free; con key ~20k req/día) |
| `CATALOG_METADATA_SYNC_CRON` (opcional) | Cron **en UTC** del import **diario de metadata** del catálogo (`catalog-metadata-sync` = `syncAll force:false`: solo sets/cartas **nuevas**, **NO** escribe precios ni FX). Default `0 1 * * *` (01:00 UTC = 19:00 CDMX). **v1.14 (WS-A):** reemplaza en el schedule al barrido pesado `catalog-price-sync` (force:true), ahora **MANUAL/ops-only**. Los viejos `CATALOG_PRICE_SYNC_CRON_1/_2` quedan **deprecados** (el scheduler ya no los lee). Requiere `REDIS_URL`. Ver §18. | Sin acción salvo querer otro horario (ajuste sin redeploy en Railway) |
| `PRICE_INGEST_CRON_1`, `PRICE_INGEST_CRON_2` (opcional) | Crons **en UTC** del **ingest masivo de precios** `price-ingest` (WS-A, §19), el **pricing primario** del catálogo. Defaults `0 0 * * *` (18:00 CDMX) y `0 12 * * *` (06:00 CDMX) → **06:00 y 18:00 CDMX**. **WS-A cierre: DEFAULT-ON 2×/día** (ya cableado en `scheduler.service.ts`; **ya no opt-in**) con el dial sembrado `pokemontcg_io`. Requieren `REDIS_URL`. Ver §19. | Sin acción salvo querer otro horario (ajuste sin redeploy en Railway) |
| `SEALED_PRICE_INGEST_CRON` (opcional) | Cron **en UTC** del ingest **diario de referencia del SELLADO** `sealed-price-ingest` (v1.19, tcgcsv.com; §21). Default `30 21 * * *` (21:30 UTC = 15:30 CDMX), tras el refresh diario de TCGCSV (~20:00 UTC) y tras `fx-refresh`. **El encendido real es el dial M10 `sealed_price_source`** (`tcgcsv \| off`, seed `off` fail-closed) — la env solo mueve el horario. Requiere `REDIS_URL`. | Sin acción salvo querer otro horario (ajuste sin redeploy en Railway) |
| `POKEMONPRICETRACKER_API_KEY` | **Proveedor de PAGA del ingest masivo `price-ingest` (WS-A, §19)** — bulk `POST /cards/bulk-price`, auth Bearer. **Requisito operativo en prod** cuando `PRICE_PROVIDER=pokemonpricetracker` (con **cuota del plan de paga**). Rol residual: stub graded/sealed per-carta (BE-6). **Valor en Railway, NUNCA en el repo.** | PokemonPriceTracker (**plan de paga**; key **ya en Railway**) |
| `POKEMONPRICETRACKER_MARKET_FORMAT` (**money-safe, sin default**) | Moneda + unidad del campo `market` del proveedor de paga: `usd_dollars` / `usd_cents` / `mxn_dollars` / `mxn_cents`. **Candado fail-closed:** sin ella, con `PRICE_PROVIDER=pokemonpricetracker` el ingest corre **sample-only** (fetch + log de muestra, **no persiste** ningún precio). El **PO confirmó `usd_dollars`** — fijarla **solo tras leer el log de muestra** de una corrida `{setId}` (§19.5). Con `pokemontcg_io` (legacy) no aplica. **Valor en Railway, no en el repo.** | devops, tras verificar el log de la 1ª corrida (§19.5) |
| `POKETRACE_API_KEY` | Respaldo per-carta gradeadas/sellado | PokeTrace (free tier) — **provider stub, ver BE-6** |
| `S3_*` (endpoint/bucket/keys/force-path-style) | **Object storage SOLO para la INE del buylist (`kyc_ine/`)**, cifrada + presigned PUT/GET. Local=MinIO (ya puesto); prod=R2/S3. v1.2.1: sin `S3_PUBLIC_BASE_URL` (no hay prefijo público) ni fotos de inventario/disputa. Nombres reales que consume el código: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`. | Cloudflare R2 o AWS S3 |
| `KYC_UPLOAD_MAX_BYTES` (opcional) | Tope en bytes del upload presignado de la INE (`kyc_ine`); se fija en la firma (`ContentLength`). Sin valor → backend usa **10 MiB** (10485760). | Sin acción salvo querer otro tope |
| `GOOGLE_CLIENT_ID` (backend `[RW]`) + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Vercel `[VC]`) | Login con Google (v1.2). **Mismo** OAuth 2.0 Client ID en ambas: backend valida `aud` del ID token; frontend lo usa en el botón. Sin `GOOGLE_CLIENT_ID` el backend rechaza el login con Google (email/password sigue OK). | Google Cloud Console > Credentials > OAuth client ID (Web) |
| `DISPUTE_EVIDENCE_CONTACT` (backend `[RW]`) | Correo que el backend devuelve como `evidenceContact` para que el cliente envíe evidencia de disputa **por email** (v1.2: ya no se sube al bucket). Placeholder, override sin redeploy; default `soporte@tcghunt.mx` (P-21, §34). | Correo de soporte del negocio |
| `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` | Endurecimiento PII: cifrado AES-256 en reposo de CLABE/RFC + HMAC del blind index de CLABE (match sin descifrar). **Distintas entre sí**. Vacías OK en local (greenfield); **OBLIGATORIAS en no-local** (backend aborta si faltan). | Generar: `openssl rand -base64 32` (una por cada una); en prod, **KMS/secret manager** |
| `INE_RETENTION_DAYS` | Días de retención de la INE del KYC (`kyc_ine/`). El backend borra; el bucket expira como capa extra. Igual al dial M10 (fuente de verdad). | Valor **legal/fiscal** — **fijado en 180 días** por decisión de negocio, alineado con el dial M10 del backend |
| `FX_SOURCE=banxico`, `BANXICO_SIE_TOKEN` | Tipo de cambio USD→MXN automático (Banxico SIE) + colchón + override manual (M10). El backend lee `BANXICO_SIE_TOKEN` y, si falta, cae a `FX_API_KEY`, y si tampoco, a override manual / último FxRate. | Token SIE de Banxico (gratis en el portal SIE) |
| `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*`, `MINIO_ROOT_*` | Infra. **`REDIS_URL` = requisito de los jobs BullMQ** (sin él el scheduler no programa `price-ingest`/`fx-refresh`/barridos; §19.2). | Ya listos en `.env.example` (local); en prod Railway inyecta `DATABASE_URL`/`REDIS_URL` (add-ons) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_EMAIL`, `SEED_OPERATOR_PASSWORD` | Credenciales de las cuentas sembradas (super_admin + vault_operator). **SEC-C1: sin default débil**, generar fuertes (`openssl rand -base64 24`) | Definir en prod ANTES del seed y rotar tras primer login |
| `NEXT_PUBLIC_*` | Config del frontend expuesta al browser (incluye `NEXT_PUBLIC_USE_MOCKS=false`) | Solo claves **públicas** |

> Los **diales de negocio** (tarifa MX$175, IVA 16%, topes MX$3,000/10,000, aportación 70%, markup de
> venta, tarifa Stripe MX del gross-up, `PricingProvider` por tipo, **`PRICE_PROVIDER`/`price_provider`**
> — proveedor del ingest masivo WS-A, **se flipea por el panel M10, no por env/Railway**; su enum, su
> semántica y su **seed** viven **solo** en [`API_CONTRACT §M10-PP`](API_CONTRACT.md#M10-PP)
> (`CANON: proveedor-de-precio`) y aquí **se citan, no se transcriben** — ver §43.1) **no son env**:
> viven en la tabla `ConfigSetting` (M10), editables sin redeploy. Los siembra `seed.sh`.

---

## 5. CI (`.github/workflows/ci.yml`)

Se dispara en **push** y **pull_request**. Jobs:

1. **detect** — mira si `backend/package.json` y `frontend/package.json` existen y activa los jobs
   correspondientes. Hoy **ambos existen**, así que ambos jobs corren.
2. **backend** — Node 20; levanta **Postgres 16** y **Redis 7** (servicios de CI); corre
   `prisma generate` + `migrate deploy` (valida el schema) y luego `lint → typecheck → test → build`.
   Los tests unitarios usan Prisma mockeado (no requieren la DB), pero la migración valida el esquema.
3. **frontend** — Node 20; `lint → typecheck → test → build` con `NEXT_PUBLIC_*` dummy.
4. **ci-ok** — gate final; falla solo si un job que corrió terminó en `failure`. **Úsalo como
   *required status check*** en la protección de la rama de release.

**MinIO en CI:** no se levanta. Los tests que tocan S3 mockean el cliente (backend usa Prisma/servicios
mockeados en unit; los e2e con infra real son de QA con `docker compose up -d`).

### Correr CI localmente (equivalente)

```bash
cd backend  && npm ci && npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build
cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build
```

---

## 5.1 E2E: modo MOCK (rápido) vs modo REAL (gate) — arreglo del Paso 5

> **Actualización 2026-08-17 (devops):** se separó el E2E en dos caminos porque el
> "verde" que veía QA corría **contra mocks**, lo que dejó pasar flujos reales rotos.
>
> ### ⚠️ Actualización 2026-08-24 — **si no tienes demonio de Docker, ve a §29.10.**
> Los comandos `docker compose` de esta sección **siguen siendo la ruta canónica en CI** y no
> cambian. Pero en la **máquina de trabajo del equipo NO hay demonio de Docker**
> (`/var/run/docker.sock` no existe), así que aquí **no arrancan**. La alternativa **soportada
> y verificada** es la **ruta NATIVA** de **§29.10** (`scripts/stack-native.sh`): mismo Postgres,
> mismo Redis, mismo backend Nest completo, frontend con `NEXT_PUBLIC_USE_MOCKS=false`, y el
> subset **`@real`** de Playwright contra `E2E_BASE_URL`. **No leas esta sección como si fuera el
> único camino:** fue justamente ese callejón sin salida el que dejó la verificación real sin correr.

### El problema (por qué "QA verde" no bastaba)

La suite Playbook (`frontend/e2e/*.spec.ts`) se ejecutaba con el **webServer del
`playwright.config.ts`**, que levanta Next con **`NEXT_PUBLIC_USE_MOCKS=true`** (fixtures
en memoria; `frontend/src/lib/config.ts` → `useMocks = env !== 'false'`). Con eso la UI se
prueba contra **datos simulados**, no contra los endpoints reales del backend. Resultado:
stubs de **comprar/retirar** convivieron con "QA verde" hasta que se cablearon los endpoints.
"Verde" significaba "la UI pinta bien con fixtures", no "el sistema funciona de punta a punta".

### La solución (dos caminos, propósitos distintos)

| Camino | Workflow | Cómo corre | Cuándo | Qué garantiza |
|---|---|---|---|---|
| **MOCK** (rápido) | `.github/workflows/e2e.yml` → job `frontend-e2e` | `playwright.config` levanta Next con `NEXT_PUBLIC_USE_MOCKS=true` (sin docker). Chromium instalado en el job (`playwright install --with-deps chromium`). | cada push/PR | Feedback rápido de UI/regresión contra **fixtures**. No prueba endpoints reales. |
| **REAL** (gate) | `.github/workflows/e2e-real.yml` | `docker-compose.staging.yml --profile apps` (Postgres 16 + Redis 7 + MinIO + backend NestJS + frontend con **`NEXT_PUBLIC_USE_MOCKS=false`**) + `migrate deploy` (arranque) + `seed:synthetic` + Playwright **smoke** contra `E2E_BASE_URL` real | **nightly** (08:00 UTC) · **manual** · **gate previo a prod** (invocado por `deploy.yml` vía `workflow_call`) | "Verde de verdad": los flujos críticos pegan a **endpoints reales**. |

**Smoke de flujos críticos (PROJECT.md)** que corre el modo REAL (parametrizable con el input
`smoke_specs`; default los 3 archivos):
- **comprar → orden**: `frontend/e2e/checkout.spec.ts`
- **retirar → envío**: `frontend/e2e/shipments.spec.ts`
- **vender/buylist → solicitud**: `frontend/e2e/buylist.spec.ts`

**Navegador (política vigente desde 2026-08-17 — ver §22.2):** ambos jobs corren en
`ubuntu-latest` (runner **estándar** de GitHub) e instalan el navegador en el propio job con
`npx playwright install --with-deps chromium`, **después** del `npm ci` del frontend. Se
retiraron `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` / `PLAYWRIGHT_BROWSERS_PATH` /
`PLAYWRIGHT_CHROMIUM_PATH` y el paso *Guard navegador*: apuntaban a `/opt/pw-browsers`, una
ruta que **solo existe en el runner-harness local**, y hacían fallar los dos workflows en CI.

### Cómo correr cada uno localmente

```bash
# --- MOCK (rápido, sin backend) ---
cd frontend && npm ci
npx playwright install --with-deps chromium   # una vez por máquina/runner
npm run test:e2e
#   (sin E2E_BASE_URL => el config levanta Next con NEXT_PUBLIC_USE_MOCKS=true)
#   Si trabajas en el runner-harness con Chromium ya preinstalado, puedes saltarte
#   el install y exportar PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.

# --- REAL (stack completo, endpoints reales) ---
# 1) Levantar el stack real de staging (frontend horneado con mocks=false):
docker compose -f docker-compose.staging.yml --profile apps up -d --build
# 2) Esperar salud del backend y sembrar datos sintéticos.
#    OJO: la imagen de backend YA NO trae npm (§22.3) => el seed se invoca por bin:
curl -sf http://localhost:3011/api/v1/health
docker compose -f docker-compose.staging.yml exec -T backend \
  sh -c 'export PATH=/app/node_modules/.bin:$PATH; ts-node prisma/seed-e2e.ts'
# 3) Correr el smoke contra el frontend REAL (3010):
cd frontend && npm ci
npx playwright install --with-deps chromium
E2E_BASE_URL=http://localhost:3010 \
  npm run test:e2e -- checkout.spec.ts shipments.spec.ts buylist.spec.ts
# 4) Apagar:
docker compose -f docker-compose.staging.yml --profile apps down -v
```

### Cableado al gate de despliegue (DoD CLAUDE.md §10)

`deploy.yml` ahora exige, para promover a **producción**, los tres gates de seguridad+E2E:
- **SAST** en cada PR (`security-sast.yml`, branch protection antes del merge).
- **DAST** contra staging (`dast-staging`, ZAP baseline + nuclei; bloquea por críticos/altos).
- **E2E REAL** (`e2e-real.yml`, invocado como `uses: ./.github/workflows/e2e-real.yml` con
  `secrets: inherit`): los jobs `promote-production-*` añaden `needs: [dast-staging, e2e-real]`
  y la condición `needs.e2e-real.result == 'success'`. Sin E2E real verde, **no hay promoción**.

Refuerzo recomendado (branch protection de `main`): marcar como *required status checks*
`ci-ok`, `sast-ok`, `e2e-ok` (mock) y el job del **E2E real** (nightly/pre-deploy).

### Qué queda PENDIENTE de validar en CI (no verificable en este sandbox)

En este entorno **no hay stack levantable** (sin daemon Docker/Postgres/Redis fiables) y el
dominio prod está bloqueado por egress, así que **el E2E real NO se pudo CORRER aquí**. Lo que
**sí** se validó offline:
- YAML de `e2e-real.yml`, `e2e.yml` y `deploy.yml` parsean OK (`yaml.safe_load`).
- `playwright.config.ts` parsea y `npx playwright test --list` enumera **17 tests** en los 3
  specs de smoke (checkout/shipments/buylist) usando el Chromium preinstalado.
- `/opt/pw-browsers/chromium` existía en el sandbox donde se validó (navegador preinstalado del
  harness). **Ya no se depende de esa ruta en CI**: desde 2026-08-17 los workflows instalan
  Chromium con `npx playwright install --with-deps chromium` (§22.2).

Pendiente de la **primera corrida en CI/staging** (runner-harness con navegadores preinstalados):
1. Que el stack real de `docker-compose.staging.yml --profile apps` **arranque** y el backend
   pase health (build de imágenes + `migrate deploy`).
2. Que `seed:synthetic` del backend cargue el dataset que esperan los specs.
3. **Riesgo conocido (finding → rol frontend):** algunos specs de smoke están **acoplados a
   mocks** — siembran sesión por `localStorage` (`seedVerifiedCustomer`), simulan el pago
   ("pago simulado") y afirman **montos exactos de fixture** (p. ej. `MX$19,400.00`, `MX$0.50`).
   Contra el backend real esas aserciones pueden **fallar**. Volver el smoke **agnóstico de
   entorno** (o etiquetar un subconjunto `@real`) es trabajo del **rol frontend**; devops solo
   ejecuta la suite (CLAUDE.md: los specs los escriben frontend/backend). El input `smoke_specs`
   permite acotar el gate al subconjunto que ya sea real-safe mientras frontend adapta el resto.
4. ~~Requisito de runner: navegadores preinstalados en `/opt/pw-browsers`.~~ **RESUELTO
   2026-08-17 (§22.2):** `e2e.yml` y `e2e-real.yml` corren en `ubuntu-latest` stock e instalan
   Chromium con `npx playwright install --with-deps chromium` tras el `npm ci` del frontend.
   Ya no hay requisito de runner-harness ni *Guard navegador*.

### Deuda devops relacionada — throttler distribuido (store Redis)

El rate-limit de NestJS (`@Throttle`) usa hoy **store en memoria** (por instancia). El E2E real
corre **una sola** instancia de backend, así que el smoke **no** ejercita el rate-limit
multi-instancia. En **prod con >1 réplica** el límite se aplicaría por-instancia (efectivo = N×
el nominal) hasta migrar el throttler a un **store compartido en Redis** (`REDIS_URL` ya está
disponible). Es deuda de **rol backend** (config del `ThrottlerModule`), registrada en
`docs/TECH_DEBT.md` (v15-D3 / §5 throttler→Redis); relevante al gate porque el DAST/E2E de un
único nodo **no** la detectaría. Disparador: subir a `numReplicas > 1` en `railway.json`.

---

## 6. Deploy — estrategia propuesta (aún NO ejecutado)

> El deploy real requiere credenciales prod y plataforma provisionada. Sigue el **runbook §11**.

### Topología objetivo (MVP) — CONFIRMADA

> **Estado: CONFIRMADA** (acordada con el humano/arquitecto). Frontend→**Vercel**;
> backend + **PostgreSQL 16** + **Redis 7**→**Railway**; INE del buylist (`kyc_ine/`)→**Cloudflare R2**.
> Antes decía "propuesta"; ya no. Cualquier alta de un servicio de infra NO previsto
> sigue requiriendo propuesta al arquitecto (límite de rol devops).

| Componente | Plataforma CONFIRMADA | Notas |
|---|---|---|
| Frontend (Next.js) | **Vercel** | SSR/ISR nativo, dominios + HTTPS automáticos. |
| Backend (NestJS API) | **Railway** | Usa `Dockerfile.backend`; corre `prisma migrate deploy` al arrancar. |
| Worker BullMQ (jobs) | **Railway** (mismo servicio o worker aparte) | Scheduling de jobs = **deuda BE-5** (lógica lista, falta cablear repeatable jobs a `REDIS_URL`). |
| PostgreSQL 16 | **Railway Postgres** | Backups automáticos + point-in-time. |
| Redis 7 | **Railway Redis** | Persistencia AOF para colas. |
| Object storage | **Cloudflare R2** | Bucket **privado**, **solo** prefijo `kyc_ine/` (INE del buylist); presigned PUT/GET. Sin CDN público (v1.2.1). CORS al dominio del front. |
| Stripe | Cuenta prod (claves `live`) | Webhook prod → `https://api.tudominio.com/api/v1/webhooks/stripe`. |

> Además de prod, hay un **entorno de STAGING** permanente (mismas plataformas, proyecto/
> environment separado) que se despliega en cada release y sirve de blanco para E2E en vivo y
> DAST. Ver §13 (staging) y §14 (runbook de seguridad).

### CD — `.github/workflows/deploy.yml` (EJECUTABLE, concreto Vercel + Railway)

`.github/workflows/deploy.yml` ya **no** es plantilla: tiene los pasos **reales** de Vercel y Railway.
Cadena de jobs:

1. `ci-ok` — gate. **HOY SOLO `workflow_dispatch` (disparo manual).** El trigger `workflow_run` que
   dispararía el CD al terminar **CI** en `main` está **COMENTADO** en el archivo (ver la cabecera de
   `deploy.yml`): sigue comentado a la espera de que se carguen los 6 secrets de deploy, porque sin
   ellos `preflight` falla. Mientras siga así, **NADA de esta cadena corre automáticamente**.

   > ⚠️ **Discrepancia detectada el 2026-08-18 y corregida aquí.** Esta sección afirmaba que el CD se
   > disparaba solo vía `workflow_run`. No era cierto, y la diferencia importa: significa que
   > `promote-production-frontend` (el `vercel deploy --prod`) **nunca se ha ejecutado**, y que los
   > gates de **DAST contra staging** y **E2E real** —descritos abajo como bloqueantes para promover a
   > producción— **nunca han corrido como parte de un deploy**. Todo lo que hay hoy en producción
   > (backend y frontend) llegó por las **integraciones de Git propias de Railway y Vercel**, que
   > despliegan al hacer push a su rama configurada, saltándose por completo esta cadena.
   >
   > Para cerrar el hueco hay que: (a) cargar los 6 secrets, (b) descomentar `workflow_run`, y
   > (c) decidir si Railway/Vercel siguen desplegando por su cuenta o se les quita el auto-deploy para
   > que la única vía sea el pipeline. Hacer las dos cosas a la vez provoca deploys duplicados.
2. `preflight` — verifica que existan **todos** los GitHub Secrets de deploy. Si falta alguno, **falla
   con la lista exacta** (`::error::Faltan GitHub Secrets de deploy: ...`) y **no despliega a medias**.
3. `deploy-staging-backend` — `railway up --service backend --environment staging`. El contenedor corre
   `prisma migrate deploy` al arrancar (CMD de `Dockerfile.backend`, ver §6.1).
4. `deploy-staging-frontend` — `vercel pull/build/deploy` (env **preview** = staging).
5. `dast-staging` — ZAP baseline + nuclei contra `STAGING_BASE_URL`. **Gate**: si hay críticos/altos,
   `exit 1` y **no** promueve.
5b. `e2e-real` — invoca `./.github/workflows/e2e-real.yml` (`workflow_call`, `secrets: inherit`): levanta
   el stack real (mocks=false) y corre el **smoke** de flujos críticos contra endpoints reales. **Gate**:
   si el E2E real no pasa, **no** promueve (ver §5.1). Requiere runner-harness con Chromium preinstalado.
6. `promote-production-backend` / `promote-production-frontend` — solo si **el DAST pasó Y el E2E real
   pasó** (`needs: [dast-staging, e2e-real]` + `needs.e2e-real.result == 'success'`); protegidos por el
   GitHub **Environment `production`** (required reviewers). Backend a Railway (prod), frontend a Vercel
   `--prod`. Recordatorio de **snapshot de DB** antes de promover.

**Rama de release:** `main` (recomendada). Para que `workflow_run` dispare el deploy, `deploy.yml` (y
`ci.yml`) deben estar en la **rama por defecto** del repo. Si mantienes la rama de trabajo
`claude/tcg-cards-marketplace-oijthj` como release, cambia `branches: [main]` del trigger `workflow_run`
por esa rama y define esa rama como default. Refuerza además con **branch protection**: `ci-ok`,
`sast-ok` y las suites E2E como *required status checks*.

**Qué falta para que despliegue de verdad:** solo cargar los **secrets** (§11.C) y provisionar las
plataformas (§11). Sin los secrets, `preflight` **falla** (comportamiento deseado, no un skip silencioso).

#### 6.1 Config de plataforma (archivos de deploy, propiedad devops)

- **`railway.json`** (raíz): `builder: DOCKERFILE`, `dockerfilePath: Dockerfile.backend`, `numReplicas: 1`,
  restart `ON_FAILURE`. **No** fija `startCommand` (se usa el `CMD` del Dockerfile como única fuente:
  `npx prisma migrate deploy && node dist/main.js`). Fija `healthcheckPath: /api/v1/health` y
  `healthcheckTimeout: 300` (holgado, por el arranque de Prisma/`migrate deploy` antes de que la API
  escuche): el backend **ya expone** `GET /api/v1/health` público (200 ok / 503 degraded, con `SELECT 1`
  a Postgres) — ver §6.3. El **worker BullMQ** corre en el **mismo servicio** que la API
  en el MVP (deuda BE-5: falta cablear los repeatable jobs a `REDIS_URL`); si crece la carga, se separa a
  un servicio `worker` con el mismo Dockerfile y otro `startCommand` — decisión futura.
- **Vercel — sin `vercel.json`:** *(⚠️ **SUPERADA PARCIALMENTE POR §40** (2026-09-08): ya existe un
  `vercel.json` **en la raíz del repo** con `ignoreCommand`. El razonamiento de abajo sigue siendo
  correcto y es exactamente el motivo por el que ese archivo de raíz **hoy es INERTE**: con Root
  Directory = `frontend`, Vercel solo lee `frontend/vercel.json`. Lee §40 antes de dar por hecho que
  el freno de vistas previas está activo.)* el proyecto de Vercel se configura con **Root Directory = `frontend`**
  (dashboard, [HUMANO]) y **framework Next.js autodetectado**. No se crea `vercel.json` porque, con Root
  Directory en `frontend/`, Vercel solo leería `frontend/vercel.json`, y esa carpeta es **propiedad del rol
  frontend** (devops no escribe ahí, CLAUDE.md). La config (build/env) vive en el proyecto de Vercel y el
  workflow la trae con `vercel pull`. Las `NEXT_PUBLIC_*` (incluida `NEXT_PUBLIC_USE_MOCKS=false`) se
  definen en Vercel > Environment Variables (Preview=staging, Production=prod).

#### 6.2 Ajustes hechos a los Dockerfiles para estas plataformas

- **`Dockerfile.backend`:**
  - `deps` ahora hace **`npm ci --include=dev`**: el stage `base` fija `NODE_ENV=production`, lo que haría
    a `npm ci` **omitir devDependencies**; sin ellas `nest build` (y `prisma`/`ts-node`) fallarían. Con
    `--include=dev` el build compila y quedan disponibles las herramientas de migración/seed.
  - **Se quitó `npm prune --omit=dev`**: el arranque corre `prisma migrate deploy` y el seed usa
    `ts-node prisma/seed.ts`; `prisma`, `ts-node` y `typescript` son **devDependencies** (propiedad de
    backend, no se tocan). Podarlas rompería migración y seed en runtime. Trade-off: imagen mayor, aceptado
    para el MVP.
  - **La etapa `runtime` copia `src/` + `tsconfig.json`** (además de `dist/`, `node_modules`, `package.json`,
    `prisma/`). El seed de una sola vez corre `ts-node prisma/seed.ts`, que importa de `../src/...` (p. ej.
    `src/modules/settings/settings.constants`). Sin la fuente + la config TS, ts-node falla en Railway con
    `TS2307: Cannot find module '../src/...'`. Se incluyen la fuente y `tsconfig.json` en la imagen final,
    coherente con conservar las dev deps para el seed. **Deuda aceptada MVP** (imagen mayor + fuente en prod);
    alternativa futura: compilar el seed a `dist/` y usar imagen prod-only sin dev deps ni `src/`.
  - El backend lee `process.env.PORT` (Railway lo inyecta); `EXPOSE 3001` es informativo (Railway usa `PORT`).
- **`Dockerfile.frontend`:** se añadió `RUN mkdir -p public` (hoy `frontend/` no tiene `public/`, opcional
  en Next.js) para que el `COPY /app/public` del runtime no rompa el build de docker-compose local/staging.
  **Vercel NO usa este Dockerfile** (construye Next nativo); es solo para el stack local/staging.

#### 6.3 Health endpoint (resuelto)

- **Health endpoint:** el backend **ya expone** `GET /api/v1/health` público y ligero (200 ok / 503
  degraded, con `SELECT 1` a Postgres). Cableado en `railway.json` vía `healthcheckPath: /api/v1/health`
  con `healthcheckTimeout: 300` para no marcar el deploy como fallido durante `prisma migrate deploy` en
  el arranque. Railway ahora hace healthcheck HTTP real (no solo chequeo de arranque/puerto).

---

## 7. Rollback

| Escenario | Acción |
|---|---|
| **Deploy de app roto** | Revertir a la release anterior desde el dashboard de la plataforma (Vercel/Railway guardan deploys previos → "Redeploy"/"Rollback" a la versión buena). |
| **Vía Git** | `git revert <sha>` del merge problemático y push → CD redespliega la versión sana. Evitar `reset --hard` en ramas compartidas. |
| **Migración de DB mala** | Restaurar desde **backup**/point-in-time del proveedor. Prisma no auto-revierte: preparar migración correctiva o `prisma migrate resolve`. **Tomar snapshot ANTES de cada `migrate deploy` en prod.** |
| **Config/dial equivocado (M10)** | No requiere deploy: corregir el dial en el back-office (editable sin redeploy) — queda en `AuditLog`. |
| **Seed corregido que NO llegó al entorno** | **NO es un rollback: es un paso de despliegue que falta.** Cambiar un default de una clave ya sembrada no cambia ningún entorno existente (`seed.ts` usa `update: {}`). Procedimiento, prohibiciones y rollback del propio dial: **§32**. |
| **Secreto filtrado** | Rotar la clave en el proveedor (Stripe/APIs/JWT), actualizar el secret manager, redeploy. Rotar JWT secrets invalida sesiones (los usuarios re-login). |

Regla de oro del rollback: **datos primero** (snapshot antes de migrar), luego código.

> **Corolario que se pasa por alto y cuesta caro (§32.1):** igual que un deploy **no** cambia un dial ya
> sembrado, **un rollback de deploy tampoco lo revierte**. Las filas de `ConfigSetting` sobreviven al
> revert del código. Revertir **un valor** se hace con otro `PUT` de admin —auditado y validado—, nunca
> con un `UPDATE` ni con un restore de base. Ver **§32.8**.

---

## 8. Monitoreo y logging (base propuesta)

- **Logging estructurado JSON** en el backend (NestJS Logger o `pino`), con `requestId` y `errorCode`
  (los mismos códigos del contrato). Sin PII ni secretos en logs.
- **Auditoría de negocio**: `AuditLog` (M10) cubre quién/qué/cuándo de acciones sensibles (dinero
  saliente, config, intentos bloqueados de operador). No sustituye al logging técnico.
- **Alertas básicas**: alerting de la plataforma sobre fallos de deploy y 5xx; alarma sobre fallos de los
  jobs `price-ingest` (ingest masivo WS-A, §19), `price-sync`/`fx-refresh` y `catalog-price-sync`, sobre
  `skipped` anómalo del ingest (posible cambio de esquema del proveedor) y sobre acercarse al rate-limit /
  **cuota del proveedor** (free tier 100/250/día; **plan de paga de PokemonPriceTracker** en el ingest).
- **Healthchecks**: en prod, Railway hace probe a `GET /api/v1/health` (`healthcheckPath` en `railway.json`,
  `healthcheckTimeout: 300`); el endpoint devuelve 200 ok / 503 degraded con `SELECT 1` a Postgres. La infra
  local ya define healthchecks de Postgres/Redis/MinIO.
- **CORS de producción**: **RESUELTO** (SEC-M2, en `backend/src/main.ts`). El backend ya arma una
  **allow-list** de orígenes desde `APP_BASE_URL` (lista separada por comas si hay varios) y **nunca**
  refleja un origin arbitrario (`origin: true`). **Acción devops:** fijar `APP_BASE_URL` en Railway al
  dominio del front (p. ej. `https://app.tudominio.com`); ese valor es a la vez la allow-list de CORS y
  la base de links del backend. Si el front vive en más de un dominio, sepáralos por comas.

---

## 9. Mapa de archivos de infraestructura (propiedad devops)

| Archivo | Rol |
|---|---|
| `docker-compose.yml` | Infra local: Postgres, Redis, MinIO (+ perfil `apps` para backend/frontend). |
| `Dockerfile.backend` | Imagen NestJS (multi-stage, Node 20, `prisma migrate deploy` al arrancar). |
| `Dockerfile.frontend` | Imagen Next.js (multi-stage, output standalone; `NEXT_PUBLIC_*` como build args). |
| `.dockerignore` | Contexto de build limpio; evita filtrar `.env`. |
| `.gitignore` | Higiene de secretos y artefactos. |
| `.env.example` | Todas las variables documentadas (sin valores reales). |
| `.github/workflows/ci.yml` | CI: lint + typecheck + test + build (backend/frontend) + gate `ci-ok`. |
| `.github/workflows/security-sast.yml` | SAST en cada PR/push: semgrep + gitleaks + npm audit + trivy (gate high/critical). |
| `.github/workflows/e2e.yml` | E2E **rápido (PR)**: `test:integration` (backend, DB/Redis reales) + `test:e2e` frontend en **modo MOCK** (webServer del config, `NEXT_PUBLIC_USE_MOCKS=true`, Chromium preinstalado). Ver §5.1. |
| `.github/workflows/e2e-real.yml` | E2E **modo REAL** (gate): stack completo `docker-compose.staging.yml` (mocks=false) + `migrate deploy` + `seed:synthetic` + **smoke** de flujos críticos (comprar/retirar/buylist) contra endpoints reales. Nightly + `workflow_call` desde `deploy.yml`. Ver §5.1. |
| `.github/workflows/deploy.yml` | CD **ejecutable**: CI-gate → deploy staging (Railway+Vercel) → DAST → promoción a prod bloqueada por críticos y por Environment `production`. |
| `railway.json` | Config de build/deploy del backend en Railway (Dockerfile.backend, 1 réplica, restart ON_FAILURE). |
| `.github/workflows/security-scheduled.yml` | Cron semanal: DAST completo (ZAP full + nuclei) contra staging. |
| `docker-compose.staging.yml` | Entorno staging aislado (datos sintéticos) espejo del stack. |
| `security/` | Config/infra de seguridad: semgrep, gitleaks, trivy, ZAP, nuclei + wrappers (ver `security/README.md`). |
| `scripts/dev-up.sh` / `dev-down.sh` | Levantar/apagar entorno local. |
| `scripts/db-migrate.sh` / `seed.sh` | Migraciones y seed (delegan en los scripts npm de backend). |
| `scripts/seed-synthetic.sh` | Seed sintético de staging (delega en backend; nunca datos reales). |
| `scripts/check-graded-estimate-dials.sh` | Comparador **SOLO-LECTURA** del gancho de grading: el **dial único** `gradingHookEnabled` (v1.51), los 3 diales de v1.50.3 contra su default nuevo, el **presupuesto en créditos** del entorno, y la detección de binario **pre-M-48**. No escribe nada. §32.5 y §32.12.4. |
| `scripts/check-e2e-provider-incapacitation.sh` | Guarda **estática** (lee YAML, sin red): los workflows E2E deben declarar `POKEMONPRICETRACKER_API_KEY: ''` y la constancia `E2E_GRADING_PROVIDER_INCAPACITATED`. Cableada en `ci.yml` (cada push/PR) y como primer paso de `e2e-real.yml`/`e2e.yml`. §32.12.5. |
| `scripts/post-deploy.sh` | Orquestador idempotente post-deploy (§27, §29); su PASO 8 corre el comparador de diales y **bloquea el anuncio del release** si `rc != 0`. |
| `scripts/stack-native.sh` | Stack REAL sin Docker (Postgres+Redis+Nest+Next nativos). Ruta soportada para gates y verificaciones cuando no hay demonio de Docker. §29.10. Desde §38: **garantiza que lo vivo es el árbol de ahora** (`up` comprueba-o-reinicia; `verify:head` lo verifica sin tocar nada). |
| `scripts/assert-serving-head.sh` | **SEC-OPS-1.** ¿El binario VIVO es el commit que se va a auditar? Solo lee; exit 1 ruidoso si no. Datar el proceso sale del `uptime` de `/health` (`process.uptime()`), no de un fichero. Lo usan `stack-native.sh`, `e2e-real.yml` y `deploy.yml`. §38.2. |
| `scripts/check-provenance-gate.sh` | Guarda **estática** de que el comprobador de procedencia **sigue cableado** en los tres puntos. Cableada en `ci.yml` (cada push/PR). Sin ella, borrar el arreglo de SEC-OPS-1 no daría un rojo: daría un verde que no significa nada. §38.5. |
| `scripts/price-provider-parity.sh` | **Paridad del dial `price_provider` (`I-PP5`).** `--assert` **MIDE** el dial vigente (gates de `deploy.yml`, `e2e-real.yml`, `security-dast.yml`, `stack-native.sh up` y `seed-synthetic.sh`) — **permanente**. `--ensure` (escribía el dial por `PUT /admin/settings`) fue **RETIRADO el 2026-09-10** con el merge de `D-PP-1`: hoy es un **no-op sin call sites**. `--check-expiry` vigila que no vuelva. §43.2 (historia) · **§45.1 (retiro)**. |
| `scripts/purge-synthetic-poc-data.sh` | Purga de los datos sembrados por el red team y los PoC (ARCHITECTURE §9 «purgar antes de cualquier snapshot»). **Simulacro por defecto**, `--apply` para borrar. Idempotente, transaccional, lista blanca de objetivo. **No lo llama nadie automáticamente.** §38.7. |

> Los Dockerfiles viven en la **raíz** (no dentro de `backend/`/`frontend/`) para respetar la propiedad
> de archivos de `CLAUDE.md`: devops no escribe en esas carpetas.

---

## 10. Verificación del DoD (hecha por devops en el cierre)

Resultado de la verificación estática ejecutable en esta sesión (sin daemon Docker ni credenciales prod):

| DoD (CLAUDE.md) | Estado | Evidencia |
|---|---|---|
| (a) Criterios de aceptación de PROJECT.md cumplidos | **Cumplido** (con salvedades no bloqueantes) | 34 criterios verificados por QA; backend/frontend implementan las verticales. Salvedades registradas como deuda: providers graded/sealed stub → override manual cubre (BE-6); `buylist-sweep` 30d no auto-convierte (BE-3, criterio 16 parcial, mitigado por conversión en 1 clic); UI admin M2/M6/M7/M9/M10 en placeholder (FE-3). QA y techlead las aceptaron como no bloqueantes. |
| (b) Doble veredicto QA + techlead | **Cumplido** | QA APROBADO; techlead APROBADO con los 3 ítems de gate ya corregidos (BACKEND_NOTES §6, TECH_DEBT nota Backend). |
| (c) docs al día | **Cumplido** | `ARCHITECTURE.md`, `API_CONTRACT.md`, `DESIGN_SYSTEM.md`, `BACKEND_NOTES.md`, `FRONTEND_NOTES.md`, `TECH_DEBT.md` presentes y coherentes con lo implementado (fecha 2026-08-13, branch `claude/tcg-cards-marketplace-oijthj`). |
| (d) Deploy + rollback documentados | **Cumplido (documentado)** · deploy **no ejecutado** | Deploy §6 + runbook §11; rollback §7. El deploy real queda pendiente de credenciales (§11). |
| (e) Sin deuda bloqueante; la no bloqueante registrada | **Cumplido** | `docs/TECH_DEBT.md` con BE-1…BE-8 y FE-1…FE-6, cada una con dueño/impacto/disparador; ninguna bloqueante. |

Validaciones estáticas corridas (reales):

- `docker compose config` → **OK** (perfiles e interpolación válidos). Daemon Docker **no disponible** en
  la sesión → no se pudo hacer `up`/build de imágenes.
- `bash -n` sobre `scripts/*.sh` → **OK** (5/5).
- YAML de `ci.yml` y `docker-compose.yml` → **OK**.
- Cobertura de `.env.example`: **todas** las env que el código lee están presentes. Verificado que el
  backend consume `DATABASE_URL`, `JWT_*`, `STRIPE_*`, `POKEMONTCG_IO_API_KEY`,
  `POKEMONPRICETRACKER_API_KEY`, `POKETRACE_API_KEY`, `S3_*`, `BANXICO_SIE_TOKEN` (fallback `FX_API_KEY`),
  `SEED_ADMIN_*`; el frontend consume `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_DEFAULT_LOCALE`, `NEXT_PUBLIC_USE_MOCKS`. `REDIS_URL` está provista para cuando se cablee
  el scheduling BullMQ (BE-5).
- Ajustes de infra hechos en el cierre (dentro de rutas devops): pase de `BANXICO_SIE_TOKEN`,
  `SEED_ADMIN_*` y `NEXT_PUBLIC_USE_MOCKS` en `docker-compose.yml`; `ARG NEXT_PUBLIC_USE_MOCKS` en
  `Dockerfile.frontend`; alineación del bloque FX de `.env.example` con la decisión Banxico.

---

## 11. Runbook de go-live (paso a paso, Vercel + Railway + Cloudflare R2)

> Ejecutar **en orden**. `[HUMANO]` = lo hace la persona (crear cuentas, cargar secrets, DNS);
> `[AUTO]` = lo hace el pipeline `deploy.yml`; `[DEVOPS]` = comando puntual de operación. Tras
> completar A–E, el deploy es **mecánico**: push a `main` → CI verde → `deploy.yml` despliega staging,
> corre DAST, y (con aprobación del Environment `production`) promueve a prod.

### 11.A — Crear proyectos en las plataformas — [HUMANO]

**Vercel (frontend):**
- [ ] Crear proyecto en Vercel conectando el repo de GitHub.
- [ ] **Settings > General > Root Directory = `frontend`** (crítico: la app Next vive en `frontend/`).
      Framework: **Next.js** (autodetectado). Node.js Version: **20.x**.
- [ ] `vercel link` en local (o desde el dashboard) para obtener **`VERCEL_ORG_ID`** y
      **`VERCEL_PROJECT_ID`** (quedan en `frontend/.vercel/project.json`; ese archivo NO se comitea).
- [ ] Crear un **`VERCEL_TOKEN`** en Account Settings > Tokens.

**Railway (backend + datos):**
- [ ] Crear un **proyecto** en Railway conectando el repo.
- [ ] Añadir el servicio **`backend`** (nombre EXACTO — lo usa `deploy.yml`). Railway detecta
      `railway.json` → build con **`Dockerfile.backend`**.
- [ ] Añadir el **add-on PostgreSQL 16** (New > Database > PostgreSQL) y el **add-on Redis 7**
      (New > Database > Redis). Railway expone `DATABASE_URL` y `REDIS_URL`.
- [ ] En el servicio `backend` > Variables, **referenciar** esas conexiones:
      `DATABASE_URL=${{ Postgres.DATABASE_URL }}` y `REDIS_URL=${{ Redis.REDIS_URL }}`
      (referencias de Railway; no copies el valor a mano).
- [ ] Crear un **`RAILWAY_TOKEN`** de **proyecto** (Project Settings > Tokens) para el CI.
- [ ] Crear un **environment `staging`** además de `production` en el proyecto Railway (Settings >
      Environments) — `deploy.yml` usa `--environment staging` y `--environment production`.

### 11.B — Cloudflare R2 (SOLO INE del buylist, `kyc_ine/`) — [HUMANO]

> **v1.2.1:** el bucket R2 **se mantiene** pero su **único uso** es custodiar la INE del KYC del
> buylist (prefijo `kyc_ine/`), cifrada y con retención. **Ya no** se configuran prefijos
> `inventory_photo/` (no hay catálogo público) ni `dispute_claim/` (la evidencia de disputa va por
> correo, ver `DISPUTE_EVIDENCE_CONTACT`). No hace falta CDN público ni `S3_PUBLIC_BASE_URL`.

- [ ] Crear un **bucket R2 PRIVADO** (sin acceso público). El prefijo `kyc_ine/` (INE/PII, SEC-A5)
      se sirve **solo por presigned GET** desde el backend; el bucket **no** es público.
- [ ] Crear un **API Token de R2** (Account > R2 > Manage API Tokens) con permiso Object Read & Write
      sobre el bucket. Anota: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, y el **endpoint S3**
      `https://<accountid>.r2.cloudflarestorage.com` (`S3_ENDPOINT`), `S3_REGION=auto`,
      `S3_BUCKET=<tu-bucket>`, `S3_FORCE_PATH_STYLE=false`. **No** hay `S3_PUBLIC_BASE_URL` en v1.2.1.
- [ ] **[HUMANO — PENDIENTE con dominio real] CORS del bucket** (R2 > bucket > Settings > CORS Policy)
      — **se conserva** para `kyc_ine/`: allow-list **solo** los orígenes reales del front, métodos
      **PUT** y **GET** (presigned upload/download del INE desde el navegador). Nunca `"*"`. Pega este
      JSON **tal cual** en Cloudflare:
      ```json
      [{ "AllowedOrigins": ["https://www.tcgvaultmx.com","https://tcgvaultmx.com"],
         "AllowedMethods": ["PUT","GET"],
         "AllowedHeaders": ["content-type"],
         "MaxAgeSeconds": 3600 }]
      ```
      > **P-21 (rebrand `tcghunt.mx`):** este JSON quedó SUPERSEDIDO — la versión vigente (con los
      > orígenes nuevos + viejos) está en **§25.5**; usar esa a partir del rebrand.
      > **Troubleshooting — la subida del INE falla con "no se pueden cargar":** verificar
      > (a) que el **CORS del bucket** tenga el **origen real** del front (los dos de arriba; el PUT
      > presignado va del navegador directo a R2, así que el origen debe estar allow-listeado), y
      > (b) que el **backend** construya el `S3Client` con `requestChecksumCalculation: WHEN_REQUIRED`
      > (fix de backend en paralelo — no lo toca devops; si falta, R2 rechaza el PUT presignado).
- [ ] **Lifecycle rule** de retención — **se conserva** — sobre el prefijo `kyc_ine/` =
      `INE_RETENTION_DAYS` (180). Es una **capa extra**; el borrado principal lo hace el backend (§15.6).
- [ ] **NO configurar** prefijos `inventory_photo/` ni `dispute_claim/`, ni CDN/bucket público de
      catálogo (eliminados en v1.2.1). El bucket queda íntegramente privado con solo `kyc_ine/`.

### 11.C — Dominios / DNS — [HUMANO]

- [ ] `app.tudominio.com` → **Vercel** (añadir dominio en el proyecto Vercel; sigue el CNAME/registro que
      indica). TLS automático.
- [ ] `api.tudominio.com` → **Railway** (servicio backend > Settings > Networking > Custom Domain; añade
      el CNAME que indica). TLS automático.
- [ ] Fijar en consecuencia: `APP_BASE_URL=https://app.tudominio.com` (Railway) y
      `NEXT_PUBLIC_API_BASE_URL=https://api.tudominio.com/api/v1` (Vercel).

### 11.D — Cargar secrets (lista EXACTA, por plataforma) — [HUMANO]

> Genera los secretos con: JWT `openssl rand -hex 48` (dos distintos); PII `openssl rand -base64 32`
> (dos distintos entre sí); SEED `openssl rand -base64 24`.

**[GH] GitHub Secrets** (Settings > Secrets and variables > Actions) — solo para el pipeline:
- [ ] `RAILWAY_TOKEN` (token de proyecto Railway)
- [ ] `VERCEL_TOKEN`
- [ ] `VERCEL_ORG_ID`
- [ ] `VERCEL_PROJECT_ID`
- [ ] ~~`STAGING_BASE_URL`~~ — ✅ **PETICIÓN RETIRADA (P-77, §44.7).** Era el objetivo del DAST, pero
      **no hay staging desplegado** al que apuntarlo. El DAST semanal levanta su propio blanco efímero
      en el runner (`security-dast.yml`). Sigue listado aquí solo porque `deploy.yml` —**INERTE**— lo
      nombra; si algún día se despliega un staging de verdad, vuelve a hacer falta.
- [ ] `PROD_BASE_URL` (p. ej. `https://app.tudominio.com`)
- [ ] *(opcional)* `STRIPE_TEST_*` si corres E2E/DAST con Stripe test en CI.

> Si falta cualquiera de los 6 primeros, el job **`preflight` de `deploy.yml` FALLA** con la lista exacta
> y **no despliega**. Es el comportamiento deseado (no un skip silencioso).

**[RW] Railway → servicio `backend` → Variables** (runtime del backend):
- [ ] `NODE_ENV=production`, `APP_BASE_URL`, `DEFAULT_LOCALE=es`
- [ ] `DATABASE_URL=${{ Postgres.DATABASE_URL }}`, `REDIS_URL=${{ Redis.REDIS_URL }}` (referencias Railway)
- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (distintos), `JWT_ACCESS_TTL=15m`, `JWT_REFRESH_TTL=30d`
- [ ] `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` (distintos entre sí; **obligatorios** en no-local o el backend aborta)
- [ ] `STRIPE_SECRET_KEY` (**sk_live_…**), `STRIPE_PUBLISHABLE_KEY` (**pk_live_…**), `STRIPE_WEBHOOK_SECRET`
      (**whsec_…**, se rellena en 11.G tras crear el webhook)
- [ ] `GOOGLE_CLIENT_ID` (login con Google; **mismo** OAuth Client ID que `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
      del front — [VC]. Sin él, el backend rechaza el login con Google)
- [ ] `DISPUTE_EVIDENCE_CONTACT` (correo de contacto de evidencia de disputa; default `soporte@tcghunt.mx`, §34)
- [ ] `POKEMONTCG_IO_API_KEY` (metadata del catálogo + ingest legacy/rollback `PRICE_PROVIDER=pokemontcg_io`);
      `POKEMONPRICETRACKER_API_KEY` (**proveedor de PAGA del ingest masivo WS-A** — requisito operativo cuando el
      dial `PRICE_PROVIDER=pokemonpricetracker`; **ya aprovisionada en Railway**, con cuota del plan de paga;
      §19); `POKETRACE_API_KEY` (opcional, stub graded/sealed BE-6)
- [ ] *(opcional)* `PRICE_INGEST_CRON_1`/`_2` (horario del ingest masivo, **UTC**; default `0 0 * * *` y
      `0 12 * * *` = 18:00 y 06:00 CDMX; §19.3). El dial `PRICE_PROVIDER` **NO va aquí** — es un dial de M10
      (ConfigSetting), se flipea por el panel, no por env (§19.5)
- [ ] `S3_ENDPOINT`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
      `S3_FORCE_PATH_STYLE=false`, `INE_RETENTION_DAYS=180`  (bucket **solo** `kyc_ine/`; sin `S3_PUBLIC_BASE_URL`)
- [ ] *(opcional)* `KYC_UPLOAD_MAX_BYTES` (tope en bytes del upload de INE; sin valor, el backend usa 10 MiB)
- [ ] `FX_SOURCE=banxico`, `BANXICO_SIE_TOKEN` (SIE de Banxico, gratis; sin él, FX cae a override manual)
- [ ] `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_EMAIL`, `SEED_OPERATOR_PASSWORD` (fuertes)
- [ ] *(los diales `stripe_fee_*`, markup, envío MX$175, topes, etc. NO son env — viven en M10/ConfigSetting)*

> Repite el bloque [RW] en el **environment `staging`** de Railway, pero con **Stripe en modo TEST**
> (`sk_test_`/`pk_test_`) y secretos propios de staging (nunca los de prod).

**[VC] Vercel → proyecto frontend → Environment Variables** (Production y Preview=staging), solo públicas:
- [ ] `NEXT_PUBLIC_API_BASE_URL` (= `https://api.tudominio.com/api/v1` en prod)
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (**pk_live_…** en prod; pk_test_ en Preview)
- [ ] `NEXT_PUBLIC_DEFAULT_LOCALE=es`
- [ ] `NEXT_PUBLIC_USE_MOCKS=false`  ← **imprescindible** para pegarle al backend real.
- [ ] `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (login con Google; **idéntico** al `GOOGLE_CLIENT_ID` del backend [RW]).

### 11.E — Proteger el Environment `production` — [HUMANO]

- [ ] GitHub > Settings > Environments > **`production`** > **Required reviewers** (tú). Así la promoción a
      prod de `deploy.yml` espera tu aprobación manual aunque el DAST pase.
- [ ] Branch protection de `main`: required status checks `ci-ok`, `sast-ok` y las suites E2E.

### 11.F — Primer deploy y migraciones + seed

- [ ] **[AUTO/DEVOPS]** Disparar el primer deploy: push a `main` (dispara CI → `deploy.yml`) **o** manual
      con `workflow_dispatch`. El backend, al arrancar en Railway, corre **`prisma migrate deploy`**
      (crea tablas + `inventory_folio_seq`). Es idempotente en cada arranque.
- [ ] **[DEVOPS] Seed inicial — UNA sola vez** por entorno (diales M10 + super_admin + vault_operator +
      ubicaciones base). Desde el proyecto Railway:
      ```bash
      railway run --service backend --environment production npm run seed
      ```
      (equivale a `ts-node prisma/seed.ts`; la imagen conserva `ts-node` — ver §6.2). **No** re-seedear en
      cada deploy. Tras el seed, **rota** las credenciales sembradas al primer login (SEC-C1).
- [ ] **[HUMANO]** Ajustar los diales en M10 (markup de venta, tarifa Stripe MX del gross-up, tope de
      reposición por carta) desde el back-office.
- [ ] **Regla de oro:** toma **snapshot** de la DB de prod (Railway > Postgres > Backups) **antes** de cada
      `migrate deploy` futuro que traiga un cambio de esquema.

### 11.G — Webhook de Stripe en producción — [HUMANO]

- [ ] Stripe Dashboard (live) > Developers > Webhooks > **Add endpoint**:
      `https://api.tudominio.com/api/v1/webhooks/stripe`.
- [ ] Habilitar eventos: `payment_intent.succeeded`, `payment_intent.payment_failed`,
      `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`,
      `charge.dispute.funds_reinstated`.
- [ ] Copiar el **`whsec_…`** a `STRIPE_WEBHOOK_SECRET` en Railway (11.D [RW]) y **redeploy** del backend.
      (El backend preserva el raw body en esa ruta — ver §3; no pongas un proxy que lo altere.)

### 11.H — Endurecimiento previo a público (cambios de código → **rol backend**, no devops)
- [x] **BE-8** (RESUELTO): CORS ya restringido a `APP_BASE_URL` (allow-list en `main.ts`, SEC-M2). Acción
      devops: fijar `APP_BASE_URL` al dominio del front en Railway (ver §Monitoreo/CORS).
- [ ] **BE-5**: cablear el scheduling BullMQ de los 4 jobs (price-sync, fx-refresh, buylist-sweep,
      dispute-deadline) a `REDIS_URL`, para que las tareas diarias y los plazos 7d/30d corran solos.
      Mientras tanto: `POST /admin/pricing/sync` y `POST /admin/fx/refresh` disparan a mano; `buylist-sweep`
      y `dispute-deadline` no tienen endpoint aún.
- [ ] **BE-7**: compensar reserva si Stripe falla tras commitear (evitar items `reserved` huérfanos).

### 11.I — Verificación post-deploy — [DEVOPS]
- [ ] Healthcheck de la API responde: `GET /api/v1/health` devuelve 200 (o 503 si degraded). Cableado en
      `railway.json` (`healthcheckPath` + `healthcheckTimeout: 300`) — ver §6.3. En Railway, el servicio
      debe quedar en estado *Active/healthy*.
- [ ] Un flujo de compra en modo test (Stripe test keys en staging) → carta entra a bóveda
      `pending → settled` vía webhook `payment_intent.succeeded`.
- [ ] Subida de una **INE** de prueba (`kyc_ine/`) vía presigned PUT al bucket, y su lectura por presigned GET.
- [ ] Un `charge.dispute.created` de Stripe CLI es **consciente del estado físico** de la carta:
      - Caso en-bóveda: el item sigue en custodia → revierte a inventario de plataforma (`platform/listed`).
      - Caso enviada/entregada: el item ya salió → **no** re-agrega al inventario y marca `chargebackNeedsManual`
        para revisión manual.

### 11.J — Banderas legales/fiscales — [HUMANO] (no bloquean infra; sí operar con público real)
- [ ] Legal de custodia/depositario y contrato de custodia. Fiscal buylist/SPEI. CFDI manual por correo
      (timbrado PAC = fase 2). ToS de las APIs de precio. Ver `PROJECT.md` › Riesgos.

### 11.K — Metas de lanzamiento — [HUMANO]
- [ ] Fijar N/X/Y/Z (usuarios, ventas settled, buylist pagadas, retiros sin disputa) al abrir la beta
      cerrada. No bloquean el deploy técnico.

### 11.L — Rollback (por plataforma + datos)

| Escenario | Acción |
|---|---|
| **Frontend roto (Vercel)** | Vercel > Deployments > deploy anterior bueno > **Promote to Production** (o **Rollback**). Instantáneo. |
| **Backend roto (Railway)** | Railway > servicio `backend` > Deployments > deploy previo > **Redeploy/Rollback**. |
| **Vía Git** | `git revert <sha>` del merge malo + push a `main` → CI + `deploy.yml` redespliegan la versión sana. |
| **Migración de DB mala** | **Restaurar** desde el backup/point-in-time de Railway Postgres (por eso el snapshot **antes** de migrar, 11.F). Prisma no auto-revierte: preparar migración correctiva o `prisma migrate resolve`. |
| **Dial M10 equivocado** | Corregir el dial en el back-office (sin redeploy); queda en `AuditLog`. |
| **Secreto filtrado** | Rotar en el proveedor + actualizar en Railway/Vercel/GitHub + redeploy (ver §15.2). |

> Orden de oro: **datos primero** (snapshot antes de migrar), luego código. Detalle general en §7.

---

## 12. Estado de cierre y por qué NO se declara "desplegado"

- **DoD**: 4 de 5 ítems **cumplidos**; el 5º ("devops desplegó") está **documentado y listo como runbook**
  pero **no ejecutado** por ausencia de daemon Docker y credenciales de producción en esta sesión.
- **Tag/release**: **no se crea** un tag de versión desplegada porque **no hay deploy**. Sería
  deshonesto etiquetar una release "en producción" que no existe. El código está listo para tag en cuanto
  se ejecute el runbook §11 con credenciales reales (sugerencia de versión: `v1.0.0-mvp`).
- **Conclusión honesta**: el proyecto está **"listo para desplegar en cuanto haya credenciales"**. No hay
  bloqueo técnico de infraestructura del lado de devops; el bloqueo es de **credenciales/entorno del
  humano** (checklist §11.A–C) más el endurecimiento de código en §11.E que corresponde al rol backend.

---

## 13. Entorno de STAGING (datos sintéticos)

Staging es un **espejo aislado** del stack para correr E2E en vivo y DAST **sin tocar prod ni datos
reales de clientes**. Está definido en `docker-compose.staging.yml` (mismas plataformas en el staging
real: Vercel + Railway + R2, en un environment/proyecto separado).

**Aislamiento** respecto al `docker-compose.yml` local:

- Project name `tcg-staging` (red y contenedores separados) y volúmenes propios (`*_staging`).
- Base de datos **separada** (`tcg_staging`) y bucket/Redis propios.
- Puertos desplazados para convivir con el stack local: Postgres `5433`, Redis `6380`, MinIO `9010/9011`,
  backend `3011`, frontend `3010` (configurables con `STAGING_*_PORT` en `.env`).
- Backend en `NODE_ENV=production` (validaciones estrictas) pero con **Stripe en modo TEST** siempre.

**Datos sintéticos** — `scripts/seed-synthetic.sh`:

- Delega en el seed sintético del backend (`npm run seed:synthetic`, o `SEED_MODE=synthetic`).
  Genera usuarios/cartas/órdenes/buylist **ficticios y deterministas** para E2E repetibles.
- Tiene una **salvaguarda**: aborta si `DATABASE_URL` no parece staging/local, para **nunca** correr
  contra producción. Regla de oro: **en staging jamás van datos reales de clientes**.

```bash
# Levantar staging con apps + sembrar datos sintéticos (local, requiere Docker):
docker compose -f docker-compose.staging.yml --profile apps up -d --build
./scripts/seed-synthetic.sh
# Frontend de staging: http://localhost:3010   ·   API: http://localhost:3011/api/v1
docker compose -f docker-compose.staging.yml down -v   # apaga y borra datos de staging
```

> **Pendiente de backend/frontend para el harness E2E** (nombres de script asumidos por el CI):
> backend debe exponer `npm run test:integration` y `npm run seed:synthetic`; frontend debe exponer
> `npm run test:e2e` (contra `E2E_BASE_URL`). Sin esos scripts, `e2e.yml` **falla a propósito** con un
> mensaje claro (es un gate real, no un skip silencioso).

---

## 14. Runbook de seguridad (SAST / DAST / E2E) y prueba puntual contra prod

Modelo acordado con el humano: **staging siempre + prod puntual autorizado**, **automatización completa**.
El tooling (config/infra) vive en `security/` (propiedad devops). La **metodología de ataque** vive en
`docs/PENTEST_NOTES.md` (rol **pentester**) y el **veredicto** en `docs/SECURITY_NOTES.md` (rol
**seguridad**). Devops solo provee el andamiaje y los gates.

### 14.1 Qué corre y dónde

| Workflow | Disparo | Qué hace | Bloquea |
|---|---|---|---|
| `security-sast.yml` | cada PR/push | semgrep + gitleaks + npm audit + trivy (fs+image) | sí, en high/critical. **ACTIVO ya.** |
| `e2e.yml` | cada PR/push | boota Postgres/Redis/MinIO + `test:integration` (backend) y `test:e2e` (frontend) | sí, si falla una suite. **Activo cuando existan los scripts.** |
| `deploy.yml` | **solo `workflow_dispatch`** (manual). El `workflow_run` de CI quedó **comentado**; ver §16.4 | `secrets-gate` → deploy staging (Railway+Vercel) → DAST (ZAP baseline + nuclei) → promoción a prod | promoción a prod **bloqueada** si hay críticos + Environment `production`. **CD redundante** (los deploys van por integraciones nativas); si faltan secrets, se **salta limpio** (no falla). Reactivación en §16.4. |
| ~~`security-scheduled.yml` (DAST)~~ | — | — | ⛔ **RETIRADO (P-77)**: era una plantilla que salía en VERDE sin escanear nada. Ver §44.1. |
| **`security-dast.yml`** | **cron semanal (lun 06:00 UTC)** + `workflow_call` antes de publicar + manual | **autoprueba del candado** (canario vulnerable, exige rojo) → **ZAP full + nuclei contra el stack EFÍMERO** del runner | **BLOQUEA** ante reglas `FAIL` de `baseline.conf` o ante ausencia de informe. Abre issue con label `security` en las corridas programadas. ⚠️ alcance declarado en **§44.4**. |

Todos los escáneres están parametrizados por `TARGET_URL` y tienen **guardia anti-producción**
(`ALLOW_PROD_DAST=1` requerido, ver §14.3). Ejecutables local con los scripts de `security/scripts/`
(ver `security/README.md`).

### 14.2 Cómo se levanta staging con datos sintéticos (ver §13)

`docker compose -f docker-compose.staging.yml --profile apps up -d --build` + `./scripts/seed-synthetic.sh`.
En el staging desplegado (Railway/Vercel), el seed sintético lo corre el pipeline tras el deploy.

### 14.3 Procedimiento de prueba puntual AUTORIZADA contra producción

El DAST/pentest contra prod es **excepcional** y **nunca** automático (no hay cron contra prod). Requisitos
que devops exige antes de levantar la guardia `ALLOW_PROD_DAST=1`:

1. **Autorización por escrito** del dueño del negocio (súper-admin): alcance, fecha y firma. Se adjunta o
   referencia en `docs/SECURITY_NOTES.md`. Sin ella, no se corre.
2. **Ventana acordada** (fecha/hora, duración) fuera de horas pico; avisar a operación.
3. **Alcance/scope explícito**: dominios/rutas incluidos y **excluidos** (p. ej. no tocar el webhook de
   Stripe live ni endpoints de dinero saliente con payloads destructivos). Nada fuera del scope.
4. **Rate-limit** conservador (`NUCLEI_RATE_LIMIT`, `FFUF_RATE`, `-m` de ZAP) para no degradar el servicio.
5. **Aviso al proveedor si aplica**: Vercel/Railway/Cloudflare pueden requerir notificación previa de
   pruebas de seguridad; revisar sus políticas antes de escanear infra gestionada.
6. **Datos**: preferir cuentas de prueba; **no** exfiltrar ni alterar datos reales de clientes. Las
   herramientas intrusivas (`sqlmap`, `ffuf`, ZAP full) van con `--risk`/`--level` bajos salvo acuerdo.
7. **Rollback / plan de aborto**: si el escaneo degrada el servicio, detener (`Ctrl-C`/cancelar job) y, si
   hubo cambios, restaurar desde snapshot (ver §7). Tomar snapshot de la DB **antes** de la ventana.
8. **Registro**: guardar reportes (`security/reports/`, git-ignorados) y resumir hallazgos en
   `docs/SECURITY_NOTES.md`; los críticos vuelven al rol dueño del código (backend/frontend) vía el flujo
   normal (nunca los corrige devops).

Solo dentro de esa ventana y cumplidos 1–7 se corre, p. ej.:

```bash
ALLOW_PROD_DAST=1 TARGET_URL=https://app.tudominio.com ./security/scripts/dast-zap-baseline.sh
```

Fuera de la ventana: `ALLOW_PROD_DAST=0` (o sin definir). Los scripts abortan solos si detectan que
`TARGET_URL` parece prod sin la bandera.

### 14.4 Qué falta para activar los gates de deploy/DAST

- `security-sast.yml` y (con los scripts de backend/frontend) `e2e.yml`: **ya activos**, sin secrets.
- `deploy.yml`: **CD redundante** (los deploys reales van por integraciones nativas Vercel/Railway).
  Desde 2026-08-16 corre **solo a mano** (`workflow_dispatch`) y el job `secrets-gate` lo **salta
  limpiamente** si faltan los GitHub Secrets, en vez de romper en `preflight` (ver **§16.4**). Para
  reactivarlo como CD por Actions: cargar los 6 secrets (`RAILWAY_TOKEN`, `VERCEL_TOKEN`,
  `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `STAGING_BASE_URL`, `PROD_BASE_URL`), proteger el Environment
  `production` con *required reviewers* (§11.D–E) y, opcional, descomentar el `workflow_run` del `on:`.
- ~~`security-scheduled.yml`: cargar `STAGING_BASE_URL` para el DAST full semanal.~~ ✅ **Ya no hace
  falta (P-77, §44)**: el DAST vive en `security-dast.yml` y levanta su propio blanco efímero.

---

## 15. Remediación de seguridad (hallazgos de `docs/SECURITY_NOTES.md`)

Cambios de infraestructura hechos por devops para los hallazgos que le tocan. Los de código
(backend/frontend) siguen abiertos con su rol dueño y se listan al final como dependencias.

### 15.1 SEC-A5 — Object storage privado (INE/KYC/PII)

- **Prod (R2/S3):** bucket **privado**, sin lectura pública anónima (Block Public Access / sin política
  pública). En v1.2 su único contenido es el prefijo `kyc_ine/`, servido **solo por presigned GET de
  vida corta** por el backend. Ya **no** existe `S3_PUBLIC_BASE_URL` ni prefijo público
  `inventory_photo/`, ni evidencia de disputa en bucket (`dispute_claim/` eliminado; la evidencia va por
  correo `DISPUTE_EVIDENCE_CONTACT`).
- **CORS del bucket:** allow-list solo los orígenes reales del front (`APP_BASE_URL`), métodos
  **PUT** y **GET**. Nunca `AllowedOrigins: ["*"]`. Política R2/S3 lista para pegar en Cloudflare:

  ```json
  [{ "AllowedOrigins": ["https://www.tcgvaultmx.com","https://tcgvaultmx.com"],
     "AllowedMethods": ["PUT","GET"],
     "AllowedHeaders": ["content-type"],
     "MaxAgeSeconds": 3600 }]
  ```

  > **P-21 (rebrand `tcghunt.mx`):** JSON supersedido — la versión vigente con los orígenes
  > nuevos + viejos está en **§25.5**.

- **Local/staging (MinIO):** `createbuckets` deja el bucket **100% privado** (`mc anonymous set none`).
  v1.2.1: **ya no** se publica el prefijo de catálogo (`inventory_photo`) — no hay `mc anonymous set
  download`. Una corrida vieja con lectura pública queda reprivatizada al re-levantar. Efecto: en local,
  la INE (`kyc_ine/`) nunca carga por URL pública — es lo correcto; carga cuando backend sirva por
  presigned GET.

### 15.2 SEC-C1 — Secretos y credenciales sembradas

- `.env.example`: **sin defaults débiles** para credenciales administrativas. `SEED_ADMIN_PASSWORD`,
  `SEED_OPERATOR_PASSWORD` (nueva) y `SEED_OPERATOR_EMAIL` (nueva) van vacías con la marca
  *"OBLIGATORIO, generar fuerte"*. Ambos compose pasan las 4 variables al backend.
- **Pendiente de backend:** eliminar los fallbacks débiles del seed (`ChangeMe123!` del admin y la
  `Operador123!` **hardcodeada** del operador) y leer `SEED_OPERATOR_PASSWORD` como obligatoria. Hasta
  entonces la mitigación devops es: definir las env fuertes + **rotar tras el primer login**.

**Rotación de secretos (runbook):**
1. **JWT (`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`):** generar nuevos (`openssl rand -hex 48`),
   cargar en el secret manager de la plataforma, redeploy backend. **Efecto:** invalida todas las
   sesiones → los usuarios re-login. Rotar los dos juntos.
2. **Credenciales sembradas (admin/operador):** cambiar la contraseña desde el panel; si se filtró la
   del operador del repo, cambiarla **ya** (era `Operador123!`). No re-seedear en prod con defaults.
3. **Stripe / APIs de precio / Banxico:** rotar la clave en el proveedor, actualizar el secret manager,
   redeploy. Para Stripe, recrear el webhook y actualizar `STRIPE_WEBHOOK_SECRET`.
4. **Object storage (`S3_*`):** rotar el par de llaves en R2/S3, actualizar el secret manager, redeploy.
5. **Postgres/Redis:** rotar credenciales del proveedor gestionado; actualizar `DATABASE_URL`/`REDIS_URL`.
6. **PII (`PII_ENCRYPTION_KEY`/`PII_HMAC_KEY`):** ver §15.6 — implica **re-cifrar** los datos (y recalcular
   el blind index si rota la HMAC). En greenfield sin datos es trivial (basta cargar las nuevas y redeploy).
7. **Regla:** los secretos viven en el secret manager de la plataforma, **nunca** en el repo ni en un
   `.env` versionado. `gitleaks` (en `security-sast.yml`) vigila fugas en cada push.

**Rate-limit / WAF en el borde (mitiga SEC-C1 fuerza bruta de login):**
- El lockout/throttle de `/auth/login` y `/auth/register` es **backend** (`@nestjs/throttler`, abierto).
- **En el borde (recomendado, complementario):** activar el WAF/rate-limit del proveedor —
  **Cloudflare** delante de Vercel/Railway (Rate Limiting Rules sobre las rutas de auth + reglas
  OWASP del WAF managed), o el rate-limit nativo de Railway. Objetivo: acotar intentos por IP a las
  rutas de login/registro y money-out antes de que lleguen al backend.

### 15.3 SEC-M4 — Compose sin defaults inseguros expuestos

- Puertos de datos (Postgres/Redis/MinIO API+consola) publicados **solo en `127.0.0.1`** en
  `docker-compose.yml` y `docker-compose.staging.yml`. No se exponen a `0.0.0.0`/LAN.
- Credenciales por **variable de entorno** (los defaults inline son de **dev local** explícito y ahora
  solo alcanzables desde localhost). En prod los valores vienen del secret manager (no de estos defaults).

### 15.4 SEC-C2 — Gate SAST que bloquea el bump de dependencias

- `security-sast.yml` **ya falla en high/critical** vía `npm audit` (runtime, `--omit=dev`),
  `trivy fs` y `trivy image` (HIGH/CRITICAL, `exit-code: 1`). **Confirmado.** Cubre el bump de
  `next`/`next-intl`/`postcss` (frontend) y `express`/`multer`/`qs` (backend) — cuando el rol
  backend/frontend suba versiones, el pipeline lo verifica.
- **Endurecido:** añadido un paso **informativo no bloqueante** que audita también `devDependencies`
  (criticals de tooling tipo `vitest`) para dejar el hallazgo visible en el log del PR sin frenar el
  pipeline (deuda de supply-chain de tooling, aceptada).
- **Required check:** `sast-ok` (de `security-sast.yml`) debe estar como *required status check* en la
  protección de la rama de release, junto con `ci-ok`.

### 15.5 Hallazgos que NO son de devops (dependencias abiertas)

Estos siguen abiertos con su rol dueño (devops no toca código de app):
- **backend:** SEC-C1 (throttler + operador por env), SEC-A1/A2/A3 (buylist/conversión atómicas),
  SEC-A4 (proyección PII para `vault_operator`), **SEC-A5 parte app** (servir la INE `kyc_ine/` por
  presigned GET; v1.2.1 ya no usa `S3_PUBLIC_BASE_URL`), SEC-C2 (bump de deps), y deuda SEC-M1/M3/M5/B1..B4.
- **frontend:** SEC-M2 (token fuera de `localStorage`) + SEC-C2 (bump `next`/`next-intl`/`postcss`).

> Mientras SEC-A5 (parte backend) no esté, la INE (`kyc_ine/`) **no se sirve** en local (el bucket
> ya es privado); esto es intencional y correcto. El deploy a prod no debe activar lectura pública del
> bucket para "arreglar" la visualización: la solución es el presigned GET del backend.

### 15.6 Endurecimiento de PII — cifrado (CLABE/RFC) + retención de INE

Apoyo de infraestructura al endurecimiento de PII que implementa **backend** (el cifrado, el blind
index y el job de borrado por retención son código de `backend/`; devops solo aporta las llaves, su
gestión y la capa extra de retención en el bucket).

**Llaves (`.env.example`, ambos compose → backend):**

| Llave | Uso | Reglas |
|---|---|---|
| `PII_ENCRYPTION_KEY` | AES-256 para cifrar CLABE/RFC en reposo (BD) | `openssl rand -base64 32`; **OBLIGATORIA en no-local** (backend aborta si falta); en prod por **KMS/secret manager** |
| `PII_HMAC_KEY` | HMAC del **blind index** de CLABE (match/dedup sin descifrar) | `openssl rand -base64 32`; **DISTINTA** de `PII_ENCRYPTION_KEY`; **OBLIGATORIA en no-local**; KMS en prod |

- **Local (`docker-compose.yml`):** ambas se pasan al backend **vacías por default** (`:-`) — válido en
  greenfield sin datos. Si backend endurece la validación también en dev, genera las dos y ponlas en `.env`.
- **Staging (`docker-compose.staging.yml`):** staging corre en `NODE_ENV=production` (validación estricta),
  así que son **obligatorias**; en local caen a dummies **distintas entre sí** (`STAGING_PII_ENCRYPTION_KEY`
  / `STAGING_PII_HMAC_KEY`), y en el staging real las inyecta el secret manager. Nunca valores de prod.
- **Prod:** viven **solo** en el KMS/secret manager de la plataforma (Railway secrets / KMS). Nunca en el
  repo ni en un `.env` versionado; `gitleaks` (SAST) vigila fugas.

**Gestión por KMS / secret manager (prod):**
- Cargar `PII_ENCRYPTION_KEY` y `PII_HMAC_KEY` como secrets del servicio backend (no build args: son de
  runtime, del lado servidor, nunca `NEXT_PUBLIC_*`). Idealmente respaldadas por un KMS (envelope
  encryption) o, como mínimo, el secret store cifrado del proveedor con acceso restringido y auditado.
- Deben estar presentes **antes** del primer arranque del backend en no-local (si no, aborta por diseño).

**Rotación de las llaves de PII (runbook):**
> Rotar una llave de PII **no** es como rotar un JWT: los datos ya cifrados/indexados dependen de la llave
> vieja. Hay que **re-cifrar** (y, si rota la HMAC, **recalcular el blind index**) fila por fila.
1. **Greenfield (sin datos reales de PII) — caso actual:** trivial. Generar la(s) nueva(s) llave(s),
   cargarlas en el secret manager, **redeploy**. Como no hay CLABE/RFC almacenados, no hay nada que
   re-cifrar. Es el escenario de este MVP hasta que entren clientes reales.
2. **Con datos en prod:**
   a. Generar la nueva llave y cargarla en el secret manager **junto a la vieja** (el backend necesita
      soportar leer-con-vieja / escribir-con-nueva; esto es capacidad de **backend** — coordínalo con ese rol).
   b. Correr una **migración de re-cifrado** (job de backend) que descifra con la llave vieja y re-cifra
      con la nueva; si rota `PII_HMAC_KEY`, recalcula el blind index de cada CLABE.
   c. **Tomar snapshot de la BD antes** (regla de oro del rollback §7).
   d. Cuando 100% de filas estén migradas, **retirar la llave vieja** del secret manager y redeploy.
- **Separación de dominios:** rotar `PII_ENCRYPTION_KEY` y `PII_HMAC_KEY` de forma **independiente**;
  mantenerlas **distintas** siempre (misma llave para cifrado y HMAC anula la protección del blind index).

**Retención de INE — lifecycle del bucket (capa extra, `INE_RETENTION_DAYS`):**
El borrado efectivo de las INE (`kyc_ine/`) lo hace el **backend** (job de retención). Como **segunda
capa** (defensa en profundidad, por si ese job falla), el bucket tiene una **regla de expiración** sobre
el prefijo `kyc_ine/` alineada con `INE_RETENTION_DAYS`:
- **Local/staging (MinIO):** el init container `createbuckets` fija la regla con
  `mc ilm rule add --expire-days ${INE_RETENTION_DAYS} --prefix 'kyc_ine/' <alias>/<bucket>` (con fallback
  a la sintaxis vieja `mc ilm add --expiry-days`; si la imagen de `mc` no soporta ILM, imprime un aviso y
  no rompe el arranque — el borrado del backend sigue siendo la vía principal).
- **Prod (Cloudflare R2 / AWS S3):** configurar una **Lifecycle rule** equivalente en el proveedor,
  prefijo `kyc_ine/`, expiración = `INE_RETENTION_DAYS` días. Ejemplo S3:

  ```json
  { "Rules": [{
      "ID": "expire-kyc-ine",
      "Filter": { "Prefix": "kyc_ine/" },
      "Status": "Enabled",
      "Expiration": { "Days": 180 }
  }] }
  ```

  (En R2, la regla equivalente de Object lifecycle por prefijo `kyc_ine/`.)
- **Fuente de verdad:** si la retención es un **dial de M10** (ConfigSetting) del lado backend, mantén
  `INE_RETENTION_DAYS` y la regla del bucket **con el mismo número** que el dial. El valor concreto quedó
  **fijado en 180 días** por decisión de negocio (legal/fiscal), **alineado con el dial M10 del backend**
  (fuente de verdad del borrado; ver PROJECT.md › Riesgos). El lifecycle del bucket es un **respaldo**, no
  sustituye ni al borrado del backend ni al requisito legal de conservación mínima.

---

## 16. Saneamiento de los workflows de CI/gates (2026-08-16)

> Contexto: los workflows de Actions (CI, Security SAST, E2E, deploy) llevaban en **rojo**
> toda la historia del repo. Los deploys reales van por integraciones **nativas** Vercel/Railway,
> pero los gates del DoD (SAST/E2E/CD) no estaban protegiendo nada. Se saneó el **rojo espurio**
> dejando los gates **funcionando de verdad** (no anulados). Nada de esto toca `backend/` ni
> `frontend/`; los hallazgos de código se enrutan al rol dueño (abajo).
>
> **Limitación del entorno de esta sesión:** el sandbox **bloquea el pull de imágenes Docker**
> (403 de política de egress en el CDN de Docker Hub) y la **registry de semgrep** (`semgrep.dev`,
> 403). Por eso NO se pudo reproducir localmente ni los jobs dockerizados de E2E ni las reglas
> `p/*` de semgrep. Sí se reprodujo semgrep con las **reglas locales** vía `pip install semgrep`
> en un venv. Lo no reproducible queda marcado como **verificar en runner CI**.

### 16.1 SAST · Trivy — versión de acción inexistente (ARREGLADO)

- **Causa:** `security-sast.yml` fijaba `aquasecurity/trivy-action@0.24.0` en 3 sitios (`trivy-fs`,
  `trivy-image` ×2). Ese **tag no existe**: los tags de la acción llevan prefijo **`v`**
  (`v0.24.0`, …). El runner fallaba con `Unable to resolve action ... unable to find version 0.24.0`.
- **Fix:** pin a **`aquasecurity/trivy-action@v0.33.1`** en las 3 referencias. Elegido por ser un
  release **estable con parche** cuyo esquema de inputs (`scan-type`, `scan-ref`, `image-ref`,
  `severity`, `exit-code`, `ignore-unfixed`, `format`) se **verificó compatible** (existe en
  `git ls-remote --tags`; inputs confirmados en su `action.yaml`). El gate sigue **fallando en
  HIGH/CRITICAL** (`exit-code: "1"`), sin cambios de rigor.

### 16.2 SAST · Semgrep — config inválida + FP + gate mal calibrado (ARREGLADO)

Tres problemas, todos en archivos **propiedad devops** (`security/semgrep.yml`, `security-sast.yml`):

1. **Config inválida (rompía TODO el job, no eran "hallazgos"):** `security/semgrep.yml` tenía
   **dos errores de schema** que hacían abortar semgrep (`RuleParseError`, exit 7/8) antes de
   escanear nada — de ahí el rojo permanente:
   - Regla `stripe-webhook-verify-signature`: colgaba un `pattern-not-inside` de un
     `pattern-either` (este solo admite patrones **positivos**). Corregido a un `patterns:` (AND).
   - Regla `react-dangerously-set-innerhtml`: `languages: [tsx, typescript]` — **`tsx` no es un id
     de lenguaje válido** en semgrep actual (el parser `typescript` ya cubre `.tsx`/JSX). Corregido
     a `languages: [typescript]`.
   Tras el fix, la config **parsea limpia** (5 reglas, 0 errores de config; verificado local).
2. **Falso positivo ERROR (high) — el único hallazgo de severidad alta de las reglas locales):**
   la regla `stripe-webhook-verify-signature` marcaba `backend/src/modules/payments/stripe.service.ts:121`
   —que es **precisamente** la función que verifica la firma (`this.stripe.webhooks.constructEvent(...)`)—.
   La heurística vieja ("constructEvent fuera de try/catch") confundía **manejo de error** con
   **control de seguridad**: la firma **sí** se verifica ahí. **Fix (devops, en la propia regla):**
   ahora exige que `constructEvent` se llame con sus **3 argumentos** (payload crudo, firma y
   secret) y **excluye** esa forma correcta con un `pattern-not`; solo dispara ante un uso inseguro
   (p. ej. 2 args, sin secret). Verificado con muestras ok/bad: 0 FP sobre el código real.
3. **Gate mal calibrado:** el job usaba `--error` **a secas**, que rompe ante **cualquier** hallazgo
   (incluidas 26 WARNING de heurísticas medias locales: recordatorios `money-out-requires-guard`,
   `no-secret-in-logs`), **contradiciendo** la propia cabecera del workflow ("GATE: FALLA en
   high/critical"). **Fix:** el job ahora corre en **dos pasos** (patrón del job `npm-audit`):
   - (1) **informe completo** (todas las severidades) → **SARIF** a la pestaña Security, **no bloquea**;
   - (2) **GATE** con `--severity=ERROR --error` → **bloquea solo en high/critical**.
   Las WARNING quedan como **visibilidad** (SARIF), no rompen el pipeline.
- **Estado tras el fix (reglas locales):** 0 hallazgos **ERROR**, 26 **WARNING** (visibilidad).
  Ningún high/critical real de las reglas locales.
- **Pendiente / verificar en runner CI:** las reglas `p/*` de la registry no se pudieron correr
  localmente (egress bloquea `semgrep.dev`). Si en CI alguna regla `p/*` de **severidad ERROR**
  dispara sobre código real, el gate lo **bloqueará correctamente** (no es espurio) y el hallazgo se
  **enruta al rol dueño** (backend/frontend) con archivo:línea — devops no corrige código de app.
- **Las 26 WARNING** (visibilidad) son heurísticas ruidosas de reglas locales (p. ej. `money-out`
  marca controladores admin aunque tengan guard, `no-secret-in-logs` marca logs con variables cuyo
  nombre "suena" a secreto). Si el rol **seguridad** quiere convertir alguna en gate real, se afina la
  regla; hoy son informativas por diseño.

### 16.3 E2E — harness (config arreglada; app pendiente de dueño)

`e2e.yml` corre `backend-e2e` (Postgres/Redis/MinIO como *services* + `npm run test:integration`) y
`frontend-e2e` (levanta `docker-compose.staging.yml --profile apps` + Playwright).

- **Arreglado (config/infra, propiedad devops):** el *service* `minio` (imagen `bitnami/minio`, minideb
  **sin `curl`**) tenía un `--health-cmd "curl .../minio/health/live"` que **nunca pasa dentro del
  contenedor** → el service queda *unhealthy* y **GitHub aborta el job** antes de correr un test. Se
  **quitó ese healthcheck** y la readiness de MinIO se comprueba **desde el runner** (que sí tiene
  `curl`) en un paso nuevo "Esperar a que MinIO responda". Postgres/Redis conservan su healthcheck
  (sus imágenes traen `pg_isready`/`redis-cli`).
- **Revisado y OK (no era bug):** `backend-e2e` corre `migrate deploy` + `seed:synthetic` de forma
  **redundante** (una vez en pasos explícitos y otra dentro de `test:integration`), pero el seed
  (`backend/prisma/seed-e2e.ts`) es **idempotente** (`upsert`) y `migrate deploy` también → no rompe;
  solo cuesta unos segundos. Se deja así para no tocar la lógica del script del rol backend.
- **NO reproducible localmente:** el sandbox **no puede pull-ear imágenes** (egress 403), así que no se
  pudo levantar Postgres/Redis/MinIO ni construir el stack de staging. La corrección del healthcheck es
  de **alta confianza** (patrón conocido de fallo de `bitnami/minio` como *service* con healthcheck de
  `curl`), pero el **verde final del harness debe confirmarse en el runner CI**.
- **Pendiente de rol dueño (si el harness sigue rojo tras el fix de infra) — no lo toca devops:**
  - **backend:** si la suite `backend/test/integration/*.e2e-spec.ts` falla por lógica de app, es del
    rol **backend** (coordina con el arreglo en curso del aislamiento `REDIS_URL` del job **CI·backend**
    en `ci.yml`, que lleva otro agente).
  - **frontend:** `frontend-e2e` depende de que el backend de staging **arranque en `NODE_ENV=production`**
    (valida PII/JWT estrictos; los dummies del compose deben satisfacer la validación) y de que el runner
    de Playwright lea `E2E_BASE_URL` (config de `frontend/`, propiedad del rol frontend). Ambos son de
    **frontend/backend**, no de devops.
- **Peso de `frontend-e2e`:** construye **dos imágenes** + stack completo en **cada push/PR** — es el job
  más pesado y el más propenso a rojo/flaky en el runner estándar. **Recomendación devops** (no aplicada
  para no alterar la semántica de *required check* del gate): moverlo a un runner mayor o ejecutarlo en su
  propio momento (p. ej. solo en PR a `main` + `workflow_dispatch`) en vez de en cada push a cada rama.
  **No** se añadió `paths-ignore` porque, siendo E2E un *required status check*, un PR de solo-docs
  quedaría **bloqueado** (un required check que nunca corre queda *pending*). Queda como decisión de
  equipo documentada.

### 16.4 deploy.yml — CD redundante que fallaba por secrets (GUARDADO, sin secrets)

- **Causa:** `deploy.yml` se disparaba con `workflow_run` de **CI** en `main` y su job `preflight`
  **fallaba a propósito** en cada push porque no existen los 6 GitHub Secrets de deploy
  (`RAILWAY_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `STAGING_BASE_URL`,
  `PROD_BASE_URL`). Como los deploys reales van por **integraciones nativas** Vercel/Railway, este CD
  por Actions es **redundante** y solo ensuciaba el pipeline.
- **Fix (sin secrets, sin hardcodear nada):**
  1. **Se quitó el trigger `workflow_run`** → el workflow **ya no corre automáticamente** (deja de
     ensuciar cada push). Queda solo `workflow_dispatch` (manual). El bloque `workflow_run` se dejó
     **comentado** en el `on:` para poder reactivarlo.
  2. **Nuevo job `secrets-gate`** que detecta si los 6 secrets están presentes y expone `ready`.
     `ci-ok` (y toda la cadena de deploy) tiene `if: needs.secrets-gate.outputs.ready == 'true'`.
     Si faltan, los jobs de deploy quedan **skipped (neutral, NO failure)** con un `::notice::` claro,
     en vez de romper en `preflight`. `preflight` se conserva como doble verificación para cuando SÍ
     estén cargados.
- **Cómo REACTIVAR el CD por GitHub Actions** (si algún día se quiere en vez de las integraciones
  nativas): (a) cargar los **6 GitHub Secrets** (ver §11.D `[GH]`); con eso `secrets-gate` deja pasar
  el pipeline y `preflight` valida como antes. (b) *Opcional*, para CD en cada release, **descomentar**
  el bloque `workflow_run` del `on:` de `deploy.yml`. (c) proteger el Environment `production` con
  *required reviewers* (§11.E).

### 16.6 Segunda ronda — rojo que persistió tras §16 (2026-08-16, commit base 83907bc → fc4ea4c)

> Tras §16 quedaron **tres** jobs rojos por config/tooling (no por hallazgos reales). Diagnóstico y
> fix con `actionlint` (validación de sintaxis de Actions) + inspección del `action.yml`/`install.sh`
> de las acciones + la API de Docker Hub. El sandbox **bloquea el pull de imágenes Docker**,
> `api.pokemontcg.io` y el **blob de logs de Actions** (`*.blob.core.windows.net`, 403 de política de
> egress), así que el *cuerpo* del log del step no se pudo descargar; se trabajó con el **desglose de
> steps** de la API de jobs (qué step exacto falló) + lectura de config.

**(A) SAST · Trivy — el binario no se instalaba (rate-limit del instalador) — ARREGLADO.**
- **Causa exacta:** `aquasecurity/trivy-action@v0.33.1` delega la instalación en `setup-trivy`
  (`aquasecurity/setup-trivy@e6c2c5e`, ≈v0.2.4), que ejecuta `contrib/install.sh` (godownloader). Ese
  script resuelve el tag con una llamada **sin autenticar** a
  `https://github.com/aquasecurity/trivy/releases/v0.65.0` (`Accept: application/json`) y **no lee ningún
  token** (verificado leyendo `install.sh`: su `github_release()`/`tag_to_version()` no añaden cabecera de
  auth). En las IPs compartidas de los runners se topa con el **rate-limit del endpoint web de GitHub** →
  "found version" y luego `exit 1`. El input `token-setup-trivy` (que por defecto ya es `github.token`)
  solo autentica el **checkout del repo** de trivy, **no** la descarga del binario, así que pasar un token
  a la acción **no** lo arregla.
- **Fix (robusto, gate intacto):** se instala Trivy desde el **repo apt OFICIAL de Aqua**
  (`aquasecurity.github.io/trivy-repo`, servido por GitHub Pages/CDN, **sin rate-limit de API**) en un paso
  previo de `trivy-fs` y `trivy-image`, y se pasa **`skip-setup-trivy: "true"`** a cada uso de la acción
  (verificado en su `action.yaml`: el input existe y su paso "Install Trivy" queda condicionado a
  `skip-setup-trivy == 'false'`). Además se define a nivel de job `TRIVY_GITHUB_TOKEN`/`GITHUB_TOKEN =
  ${{ secrets.GITHUB_TOKEN }}` para que el **pull de la DB** de trivy (GHCR/GitHub) tampoco se limite. El
  gate **no se relaja**: sigue `severity: HIGH,CRITICAL` + `exit-code: "1"`.

**(B) deploy.yml — `startup_failure` (0 jobs, workflow inválido) — ARREGLADO.**
- **Causa exacta (de `actionlint`):** tres jobs usaban `environment.url: ${{ secrets.STAGING_BASE_URL }}`
  / `${{ secrets.PROD_BASE_URL }}` (líneas 169, 278, 307). **`environment.url` NO admite el contexto
  `secrets`** (solo `env`/`github`/`inputs`/`needs`/`vars`/…). GitHub **rechaza el workflow al arrancar**
  → run en `failure` con **0 jobs** (`startup_failure`). `actionlint` lo señala con
  *"context 'secrets' is not allowed here"*.
- **Fix:** se **quitó el `url:`** de esos tres `environment:` (es un enlace cosmético del deploy; el
  objetivo real de `STAGING_BASE_URL` es el job `dast-staging`). El `name:` del environment —que es lo que
  da la protección de *required reviewers* de `production`— se conserva. `actionlint` ahora pasa **limpio**
  (exit 0) en los 5 workflows.

**(C) E2E — `backend-e2e` (config, ARREGLADO) y `frontend-e2e` (seed, ENRUTADO).**
- **`backend-e2e` — ARREGLADO (config/infra):** el step **"Initialize containers"** fallaba porque el
  *service* `minio` usaba **`bitnami/minio:latest`**, y Bitnami **vació su namespace en Docker Hub**
  (migración a "Bitnami Secure Images", ago-2025): `hub.docker.com/v2/repositories/bitnami/minio` devuelve
  **0 tags** hoy → el pull falla y GitHub aborta el job antes de correr un test. **Fix:** apuntar a
  **`bitnamilegacy/minio:latest`** (misma imagen exacta, a donde Bitnami la movió; conserva
  `MINIO_DEFAULT_BUCKETS` y el auto-arranque). No se usa `minio/minio` oficial porque como *service* de
  Actions exige un `command` (`server /data`) que los service containers no permiten pasar.
- **`frontend-e2e` — ENRUTADO (probable fallo de arranque/seed del backend, no config):** el desglose de
  steps muestra que el stack **levantó** (`docker compose up -d --build` OK) y el fallo es el step
  **"Seed sintético en staging"** (`docker compose exec -T backend npm run seed:synthetic`). El *cuerpo*
  del log está egress-bloqueado (blob de Actions, 403), así que **no** tengo el mensaje exacto del seed.
  Dos mejoras de **harness** (sí de devops, en `e2e.yml`) para que el error real **aflore y se enrute**
  bien, en vez de quedar enmascarado:
  1. El paso **"Esperar a que el backend responda"** ya **no** solo hace `break`: ahora **falla duro**
     en timeout (~5 min) con `::error::` y vuelca `docker compose logs backend`. Antes, un backend que no
     arrancaba pasaba como "success" y el error afloraba, opaco, en el seed.
  2. En el seed se **quitó el fallback `|| ./scripts/seed-synthetic.sh`**: ese script corría en el
     **runner** (donde el backend **no** tiene `npm ci` ni `DATABASE_URL`), así que **siempre** fracasaba
     y **enmascaraba** el error real del contenedor. Ahora el seed corre solo **dentro del contenedor** y
     su error sale tal cual (y el paso "Logs del stack si algo falló" lo vuelca).
  - **A quién le toca:** si tras el fix de infra `frontend-e2e` sigue rojo, el fallo real es **de app**:
    o el **backend** no arranca en `NODE_ENV=production`/su `seed:synthetic` erra (rol **backend**), o los
    tests Playwright fallan por lógica de UI (rol **frontend**). **Devops no corrige código de app.** El
    log del contenedor (visible en CI en el paso "Logs del stack…") tiene el mensaje exacto para el dueño.

### 16.7 Tercera ronda — `trivy-image` por `node-tar` de npm base + estado E2E (2026-08-16)

> Tras §16.6 el único job de SAST que seguía en **failure** era **`trivy-image`**, por CVEs de
> **`node-tar`**. Los jobs E2E (`backend-e2e`, `frontend-e2e`) siguen rojos por los **tests**, no por
> config. Restricción de la sesión: **no** se puede correr Trivy localmente (el egress bloquea el pull
> de la DB de vulnerabilidades y el `docker pull` de la base), ni leer el cuerpo del log de Actions
> (blob `*.blob.core.windows.net` → 403), ni `api.pokemontcg.io`. Se trabaja con diagnóstico documental;
> el **runner CI** confirma en verde.

**(A) SAST · Trivy image — `node-tar` (CVE-2026-26960 / -29786 / -31802 / -59874) — ARREGLADO con ignore justificado.**
- **Causa exacta:** Trivy reporta `node-tar` HIGH/CRITICAL (fixed `>= 7.5.18`) en la imagen del backend.
  Por eliminación: **NO** es dependencia de la app — backend confirmó **`npm ls tar` VACÍO** en `backend/`
  (y `tmp`, la otra vía, ya se parcheó). El `node-tar` que ve Trivy es el que viene **empaquetado dentro
  de `npm`** en la imagen base `node:20(-alpine)`, en
  `/usr/local/lib/node_modules/npm/node_modules/tar`. Ese tar **solo lo usa `npm`** para instalar paquetes
  durante el build (`npm ci`); **en runtime** la app corre `node dist/main.js` y nunca invoca el tar
  interno de npm → la superficie de esos CVE (parseo de `.tar` malicioso) **no es alcanzable** con datos
  de la app en producción.
- **Enfoque elegido — Opción B (ignore justificado), NO Opción A. Por qué:**
  - **Opción A** (`RUN npm install -g npm@latest` en `Dockerfile.backend` para reemplazar el `node-tar`
    de npm) **no se aplicó**: (1) son CVE de **ene-2026**, muy recientes → es improbable que el npm más
    nuevo ya empaquete `node-tar >= 7.5.18`, y **no puedo verificarlo** sin red en esta sesión; (2)
    `npm@latest` es un **objetivo móvil** (build no reproducible) y no dispongo de un número de versión de
    npm *comprobado* cuyo tar esté parcheado para **pinnearlo** correctamente; (3) tocar la etapa base
    añade riesgo de build que **no puedo probar** localmente. En resumen: A **no es verificable ni
    determinista** aquí → habría dejado el gate en incertidumbre.
  - **Opción B** es **determinista y auditable**: se ignoran **exactamente esos 4 CVE IDs**, y solo esos,
    en `security/.trivyignore`, con la justificación (a)/(b)/(c)/(d) escrita en el propio archivo.
- **Contenido del ignore (`security/.trivyignore`), CVE IDs exactos:**
  ```
  CVE-2026-26960
  CVE-2026-29786
  CVE-2026-31802
  CVE-2026-59874
  ```
  Justificación embebida: (a) no es dep de la app (`npm ls tar` vacío); (b) es el `node-tar` interno de
  `npm` en la imagen base; (c) build-time only, no alcanzable en runtime; (d) sin fix aplicable por
  nosotros (no declaramos el paquete) — se limpiará al subir de imagen base cuando Node reempaquete un npm
  con tar `>= 7.5.18`. **Regla escrita:** si algún día `tar` entra como dep REAL de la app (`npm ls tar`
  deja de estar vacío), el ignore **debe retirarse**.
- **El gate NO se relaja:** como esos IDs son **exclusivos de node-tar**, ignorarlos **no** oculta ningún
  otro paquete. Cualquier **otro** HIGH/CRITICAL de una dep real de la app (o de la capa OS) **sigue
  fallando** el gate (`severity: HIGH,CRITICAL` + `exit-code: "1"` intactos). Se **prohíbe** añadir a este
  archivo CVEs de dependencias reales de la app.
- **Cableado:** `trivyignores: security/.trivyignore` en los 3 pasos de la acción (`trivy-fs` +
  `trivy-image` ×2) de `security-sast.yml`. Los wrappers locales (`trivy-fs.sh`, `trivy-image.sh`) pasan
  `--ignorefile security/.trivyignore` para que **local == CI**. **`actionlint` v1.7.12 → exit 0** en
  `security-sast.yml`; `bash -n` OK en ambos wrappers.

**(B) E2E — `backend-e2e` y `frontend-e2e` siguen rojos por TESTS — SOLO DIAGNÓSTICO, ENRUTADO (no es de devops).**

> **CORRECCIÓN 2026-09-11 (§52, S-CI-1):** el enrutado por defecto de este bloque —«`backend-e2e`
> rojo ⇒ rol backend»— es **falso como regla** y costó nueve corridas: del #1124 al #1134 el rojo
> era un **rc=127 en el paso 4** (script invocado desde `backend/` sin override) y la suite **no
> corrió ni una vez**. Desde §52 el propio job dice su **fase** (`suite-roja` → backend;
> `infra-muerta` → devops) y `e2e-ok` la nombra. Un rojo de `backend-e2e` **no tiene dueño por
> defecto**: se lee la fase. Y la causa de un rc=127 está en el YAML, no en los logs.
- El fix de infra previo (imagen `minio` → `bitnamilegacy/minio`, §16.6(C)) es correcto: **`minio` ya
  arranca**. Lo que falla ahora está en los **tests**, no en la config del harness.
- **Devops NO puede reproducir ni diagnosticar la causa en esta sesión:** el egress bloquea el `docker
  pull`, `api.pokemontcg.io` **y** el blob de logs de Actions (403) → **no** se puede leer el mensaje
  exacto del fallo desde aquí. **No se inventa la causa.**
- **El detalle exacto del fallo E2E SOLO es visible:** (1) abriendo el **run en la UI de GitHub Actions**
  (lo hace el **humano**), o (2) **corriendo el stack localmente** (`docker compose -f
  docker-compose.staging.yml --profile apps up -d --build` + revisar `docker compose logs backend` y la
  salida de Playwright).
- **Enrutado a los dueños del código (no a devops):**
  - **`backend-e2e`** → **rol backend**: si `backend/test/integration/*.e2e-spec.ts` falla por lógica de
    app, o el backend no arranca en `NODE_ENV=production`, o `seed:synthetic` yerra.
  - **`frontend-e2e`** → **rol backend** (arranque/seed en `NODE_ENV=production`) y/o **rol frontend**
    (tests Playwright / `E2E_BASE_URL`). El paso "Logs del stack si algo falló" de `e2e.yml` vuelca el log
    del contenedor con el mensaje exacto para el dueño.

### 16.5 Resumen de archivos tocados en este saneamiento (todos rutas devops)

| Archivo | Cambio |
|---|---|
| `.github/workflows/security-sast.yml` | **§16.1** Trivy `@0.24.0`→`@v0.33.1` (×3); job `semgrep` a 2 pasos. **§16.6(A)** instalar Trivy por apt oficial + `skip-setup-trivy: "true"` (×3) + `TRIVY_GITHUB_TOKEN`/`GITHUB_TOKEN` a nivel de job en `trivy-fs`/`trivy-image` (fix rate-limit del instalador). **§16.7(A)** `trivyignores: security/.trivyignore` en los 3 pasos de la acción (node-tar de npm base). |
| `security/.trivyignore` | **§16.7(A)** NUEVO. Ignore justificado de los 4 CVE de `node-tar` (CVE-2026-26960/-29786/-31802/-59874) — build-time only, no dep de la app. El gate sigue fallando en cualquier otro HIGH/CRITICAL. |
| `security/scripts/trivy-fs.sh`, `security/scripts/trivy-image.sh` | **§16.7(A)** `--ignorefile security/.trivyignore` para que el escaneo local coincida con CI. |
| `security/semgrep.yml` | **§16.2** Fix 2 errores de schema + refino de `stripe-webhook-verify-signature` (elimina FP). |
| `.github/workflows/e2e.yml` | **§16.3** `minio` *service*: quitado healthcheck `curl` interno + readiness desde el runner. **§16.6(C)** imagen `bitnami/minio`→`bitnamilegacy/minio` (namespace vaciado); "esperar backend" ahora falla duro en timeout + logs; seed sin fallback-en-runner (corre in-container). |
| `.github/workflows/deploy.yml` | **§16.4** trigger solo `workflow_dispatch` + `secrets-gate`. **§16.6(B)** quitado `environment.url: ${{ secrets.* }}` (×3) que causaba `startup_failure`. |
| `docs/DEVOPS_NOTES.md` | Esta §16 (incl. §16.6). |

> **Nota de propiedad:** no se modificó `ci.yml`, ni `backend/`, ni `frontend/`, ni
> `docs/BACKEND_NOTES.md`, ni `docs/TECH_DEBT.md`. Validación con **actionlint v1.7.12**: los 5
> workflows pasan **exit 0**. Lo no reproducible en el sandbox (pull de imágenes, DAST, log-blob de
> Actions) queda marcado **verificar en runner CI**.

---

## 17. Runbook — encender la gráfica pública del "set destacado" (v1.9-set-chart)

> Contexto: hay una **gráfica pública** en la home con el valor de mercado agregado de un **set
> destacado**, alimentada por dos jobs diarios que **backend** implementa y cablea en
> `scheduler.service.ts` (devops NO toca `backend/`). Ver `docs/ARCHITECTURE.md` §4.12 / §5 / §8 / §9 y
> `docs/API_CONTRACT.md` v1.9-set-chart. Devops solo aporta la env `HOME_FEATURED_SET_ID` (`.env.example`)
> y este runbook operativo. Todo el flujo usa **datos reales** de pokemontcg.io — la serie **no** se
> fabrica: crece **1 punto/día** a partir del primer snapshot.

### 17.1 Mecanismo del "set destacado" (env + fallbacks) — cómo lo resuelve el backend

El backend (`SetValueService.resolveFeaturedSet()`) elige el set a graficar en **cascada determinista**:

1. **`HOME_FEATURED_SET_ID`** (env; **id NATIVO de pokemontcg.io**, p. ej. `sv8pt5`): si está seteado y
   existe un `CardSet` local con ese `externalId`, **ese** es el set destacado.
2. **Fallback 1 — mayor valor:** si el env no está o no resuelve, se elige el set con mayor
   `totalValueMxnCents` en su último `SetValueSnapshot`.
3. **Fallback 2 — más reciente:** si aún no hay ningún snapshot (arranque en frío), se elige el `CardSet`
   con `releaseDate` más reciente.
4. **Sin sets:** el endpoint responde `set: null, points: []` y el hero **degrada con elegancia** (sin error).

**Anti-SSRF:** el `set-price-sync` usa el cliente de pokemontcg.io con **host FIJO** y valida el `setId`
contra `^[a-z0-9]+(-[a-z0-9]+)*$`. Por eso `HOME_FEATURED_SET_ID` es **solo el id** (nunca una URL): un id
con caracteres fuera de ese patrón se rechaza y no puede redirigir el fetch a otro host.

### 17.2 Set destacado por defecto (valor de ejemplo en `.env.example`)

`HOME_FEATURED_SET_ID=sv8pt5` → **"Prismatic Evolutions"** (serie Scarlet & Violet, `releaseDate`
2025-01-17). Elegido por ser un set SV reciente, muy líquido y de **alto valor/interés** (Eevee/eeveelutions),
ideal para un hero. Alternativa igualmente válida: `sv8` = **"Surging Sparks"** (2024-11-08). Ambos son
**ids nativos de pokemontcg.io**; el operador puede fijar cualquier otro id nativo que quiera destacar.

> **Verificación del id contra pokemontcg.io:** en **esta sesión** la verificación en vivo **no** fue
> posible — el proxy de egress de la sesión **deniega** `api.pokemontcg.io` (CONNECT → **403** de política);
> no se puede rutear alrededor. El id `sv8pt5` (y `sv8`) se toma del **esquema de ids público y estable** de
> pokemontcg.io (series SV: `sv1`…`sv8`, con sets especiales `sv3pt5`=151, `sv4pt5`=Paldean Fates,
> `sv6pt5`=Shrouded Fables, `sv8pt5`=Prismatic Evolutions). **Confirmación operativa [HUMANO/DEVOPS]:** al
> ejecutar el Paso 1 con la `POKEMONTCG_IO_API_KEY` real, `GET /admin/catalog/remote-sets` lista los sets
> remotos con su `id`/`name`/`releaseDate`; verifica ahí que `sv8pt5` aparece antes de fijarlo (o elige otro
> id de esa lista). Si el id no existiera, `POST /admin/catalog/sync {setId}` no importaría cartas y la
> gráfica caería a los fallbacks §17.1.

### 17.3 Encendido en producción — pasos (en orden)

> Precondición: backend desplegado con los 2 jobs implementados y cableados en `scheduler.service.ts`
> (BE, no devops), `REDIS_URL` presente en Railway (para que corran los crons), y — **recomendado** —
> `POKEMONTCG_IO_API_KEY` cargada en Railway (ver §17.4). Los endpoints admin son **`super_admin`**.

**Paso 1 — [DEVOPS/HUMANO] Sincronizar el set elegido al catálogo local.**
Importa todas las cartas del set (id **nativo** pokemontcg.io) para que el job pueda preciarlas:
```
POST /api/v1/admin/catalog/sync
{ "setId": "sv8pt5" }        # super_admin; 202 { jobId, setsQueued, mode:"single" }
```
Espera a que la cola termine (el set entra como `imported` en `GET /admin/catalog/remote-sets`).

**Paso 2 — [HUMANO] Fijar `HOME_FEATURED_SET_ID` en Railway (servicio `backend`) = el MISMO id nativo.**
Railway > servicio `backend` > Variables: `HOME_FEATURED_SET_ID=sv8pt5`. Debe ser **idéntico** al `setId`
del Paso 1, para que el endpoint público y el `set-price-sync` grafiquen/precien el **mismo** set. Redeploy
del backend para que tome la variable.

**Paso 3 — [DEVOPS] Sembrar el primer punto de la serie (una vez).** Dispara los 2 jobs a mano, **en orden**
(precio del set → snapshot del día):
```
POST /api/v1/admin/jobs/set-price-sync       # super_admin — precia TODAS las cartas del set destacado
POST /api/v1/admin/jobs/set-value-snapshot   # super_admin — agrega y hace upsert del SetValueSnapshot de hoy
```
> Endpoints de disparo manual provistos por **backend** (mismo patrón que `POST /admin/pricing/sync`). El
> **orden es una restricción dura**: `set-value-snapshot` agrega lo que `set-price-sync` acaba de preciar.
> Ambos son **idempotentes** por día (`@@unique[setId, asOfDate]`): re-ejecutarlos no duplica.

**Paso 4 — [DEVOPS] Verificar la gráfica.** El endpoint público debe resolver el set y ≥1 punto:
```
GET /api/v1/catalog/featured-set/value-history        # public — sin auth
# Esperado: { set: { … "Prismatic Evolutions" … }, points: [ { asOfDate, totalValueMxnCents, … } ], … }
```
Si `set` resuelve pero `points: []`, revisa que el Paso 3 corrió en orden y que el set tiene cartas priceadas
(Paso 1 completó). Si `set: null`, `HOME_FEATURED_SET_ID` no resolvió a un `CardSet` local → repite Paso 1/2.

### 17.4 Operación continua (a partir del Paso 4)

- **Los 2 crons diarios ya corren solos** con `REDIS_URL` presente (los cablea backend en
  `scheduler.service.ts`): `set-price-sync` tras `fx-refresh` (cron sugerido `30 6`) y `set-value-snapshot`
  tras `set-price-sync` (sugerido `15 7`). Orden duro: **FX → precio del set → snapshot del set**. No hay que
  volver a disparar nada a mano; el Paso 3 es solo la **siembra** del primer día.
- **La serie crece 1 punto/día** con **datos reales**. Si un día un job no corrió, ese día **no** tiene punto
  (la API no inventa el punto; ver ARCHITECTURE §4.12d "Sin datos fabricados").
- **`POKEMONTCG_IO_API_KEY` (RECOMENDADO en Railway):** `set-price-sync` precia el **set completo**
  (~150-250 cartas) desde pokemontcg.io en cada corrida. **Con** API key el free tier autenticado absorbe el
  set holgadamente; **sin** ella el límite sin autenticar es más estricto y el preciado puede
  estrangularse/tardar. Cárgala en el servicio `backend` (ya listada en el bloque `[RW]` de `.env.example` y
  en el runbook §11.D). El **host** pokemontcg.io es fijo (anti-SSRF, §17.1).
- **Cambiar de set destacado más adelante:** repetir Paso 1 (sync del nuevo id) → actualizar
  `HOME_FEATURED_SET_ID` en Railway (Paso 2, redeploy) → sembrar con Paso 3. El set anterior conserva sus
  snapshots (el modelo soporta N sets); solo deja de ser el que resuelve el endpoint del hero.

### 17.5 Rollback / recuperación de la gráfica

| Escenario | Acción |
|---|---|
| **Set destacado mal elegido / id equivocado** | Corregir `HOME_FEATURED_SET_ID` en Railway al id correcto (previo `POST /admin/catalog/sync {setId}` de ese set) + redeploy. No requiere tocar código ni la BD. Mientras se corrige, el endpoint cae a los **fallbacks** (§17.1) y el hero sigue mostrando algo. |
| **La gráfica sale vacía (`points: []`)** | Re-disparar el Paso 3 **en orden** (`set-price-sync` → `set-value-snapshot`). Verificar que el set tiene cartas priceadas (Paso 1 completó) y `POKEMONTCG_IO_API_KEY` cargada. |
| **`set: null` en el endpoint** | El env no resolvió a un `CardSet` local: re-sincronizar el set (Paso 1) y confirmar que `HOME_FEATURED_SET_ID` = id nativo importado. |
| **Snapshot de un día con valor anómalo** | No se borra desde infra (es dato de negocio, propiedad backend). El upsert idempotente lo corrige si se re-corre `set-value-snapshot` el mismo día; un día ya cerrado se corrige por el rol backend, no por devops. |

> Estos jobs **no** mueven dinero ni tocan PII: la gráfica es 100% valor de mercado agregado del set
> (derivado server-side de `PriceReference`; SEC-A1 intacto). Un fallo de la gráfica **no** bloquea checkout,
> bóveda ni buylist — degrada aislado.

---

## 18. Job `catalog-metadata-sync` (+ `catalog-price-sync` manual/ops) — import de metadata del catálogo

> **WS-A (cierre 2026-08-17) — CAMBIO DE ROL.** Tras WS-A este job **YA NO precia el catálogo** ni escribe
> `PriceReference`, y **ya no corre 2×/día por cron**. El refresco de precios lo asume **`price-ingest`**
> (ingest masivo por set, **§19**), mucho más barato y robusto. `catalog-sync` quedó **aligerado a SOLO
> metadata** (backend retiró `persistMarketReferences` + las deps `PricingService`/`FxService`): ni escribe
> precios ni convierte FX. Estado actual:
> - **Agendado:** `catalog-metadata-sync` **diario** (`syncAll {force:false}`) — importa solo sets/cartas
>   **nuevas**; cron por env `CATALOG_METADATA_SYNC_CRON` (default `0 1 * * *` = 19:00 CDMX).
> - **Manual/ops-only:** `catalog-price-sync` (`syncAll {force:true}`, re-import **completo** de metadata) por
>   `POST /api/v1/admin/jobs/catalog-price-sync`. **Ya no** se agenda; los viejos `CATALOG_PRICE_SYNC_CRON_1/_2`
>   quedan **deprecados** (el scheduler ya no los lee — grep en `backend/src` = 0 usos).
>
> Contexto: la operación la implementa **backend** en `backend/src/jobs/catalog-price-sync.service.ts`
> (`runMetadataImport()` agendado + `run()` manual) + su cableado en `scheduler.service.ts` (devops **no**
> toca `backend/`). Devops aporta las env de scheduling (`.env.example`), su cableado en Railway y este
> runbook. La `POKEMONTCG_IO_API_KEY` ya está aprovisionada.

### 18.1 Qué hace

> **CORRECCIÓN WS-A (nota antes stale):** este job **YA NO** "repuebla `PriceReference` por acabado con el
> FX del día". Tras el aligeramiento de WS-A, `catalog-sync` **NO escribe precios ni convierte FX** — eso es
> ahora trabajo de `price-ingest` (§19). Aquí solo se importa **metadata**.

- **Agendado — `catalog-metadata-sync`** = `CatalogSyncService.syncAll({ force:false })`: importa **solo los
  sets/cartas NUEVAS** (salta los sets ya poblados) — metadata (sets, cartas, imágenes) y un
  `availableFinishes` **bootstrap** (default seguro que `price-ingest` sobre-escribe con lo real). **NO** toca
  `PriceReference` ni FX. Barato (solo lo nuevo) → cadencia diaria.
- **Manual/ops-only — `catalog-price-sync`** = `syncAll({ force:true })`: **re-import completo** de la
  metadata de **todos** los sets remotos (no solo los nuevos). Útil tras cargar la API key o para forzar un
  re-import puntual. También es **solo metadata** (no escribe precios). Se dispara con
  `POST /admin/jobs/catalog-price-sync` (§18.5). **Ya no se agenda por cron.**
- Ambas variantes son **secuenciales** (respetan el backoff 429 del cliente de pokemontcg.io),
  **single-flight** (dos corridas no se solapan: si hay una en curso, la nueva retorna `setsQueued:0`) e
  **idempotentes** (upsert por `externalId`). Reintentar no duplica.
- El worker sólo corre si hay **`REDIS_URL`** (BullMQ). Sin Redis, el scheduler queda deshabilitado con un
  warning y el import **sólo** es disparable a mano (§18.5).

### 18.2 Horario y cómo cambiarlo (env, sin redeploy de código)

Una BullMQ repeatable (`catalog-metadata-sync`), con cron **en UTC** por env:

| Env | Default | UTC | CDMX | Job |
|---|---|---|---|---|
| `CATALOG_METADATA_SYNC_CRON` | `0 1 * * *` | 01:00 UTC | **19:00 CDMX** | import diario de metadata (`force:false`, solo sets nuevos) |

- **CDMX = UTC−6, fijo (sin horario de verano):** `01:00 UTC = 19:00 CDMX` (del día anterior). El import es
  barato (solo sets/cartas nuevas), así que la hora exacta no es crítica; cualquier hora diaria sirve.
- **Cambiar horario en prod:** editar `CATALOG_METADATA_SYNC_CRON` en **Railway → servicio `backend` →
  Variables** y redeploy. Es config de env, no cambio de código. Mantén siempre el cron en **UTC**.
- **NO** pongas la env a cadena **vacía**: el código usa `?? default`, que sólo cubre variable **ausente**;
  `""` NO cae al default → produce un patrón de cron **inválido**. Para apagar el job ver rollback (§18.7).
- **`CATALOG_PRICE_SYNC_CRON_1/_2` (deprecados):** el scheduler WS-A **ya no los lee** (grep en `backend/src`
  = 0 usos); se retiraron de `.env.example`. Fijarlos no tiene efecto. El pricing agendado es
  `PRICE_INGEST_CRON_*` (§19); el metadata agendado es `CATALOG_METADATA_SYNC_CRON`.

### 18.3 Requisitos operativos (obligatorios en prod)

- **`REDIS_URL`** — BullMQ. Ya inyectado por Railway (`${{ Redis.REDIS_URL }}`, ver §11.D). Sin él, ni
  este ni ningún otro cron corre.
- **`POKEMONTCG_IO_API_KEY`** — el import consulta pokemontcg.io. El `catalog-metadata-sync` **diario** solo
  trae **sets/cartas nuevas** (barato); el `catalog-price-sync` **manual** (`force:true`) sí re-recorre todos
  los sets (cientos de requests) y conviene correrlo con la key cargada. Con API key el free tier autenticado
  da **~20 000 req/día**, holgado; sin key el límite sin autenticar es más estricto (HTTP 429). Cárgala en
  Railway → `backend` (ya listada en `[RW]`, §11.D).

### 18.4 Orden FX → precios (ya NO aplica a este job)

Tras WS-A, `catalog-sync` **no convierte FX ni escribe precios**, así que el orden `fx-refresh → …` **ya no
le aplica**. Ese requisito operativo se trasladó al job que sí precia, **`price-ingest`** — ver **§19.4**
(`fx-refresh` a las 00:00 CDMX **antes** de las corridas del ingest de 06:00 y 18:00 CDMX).

### 18.5 Disparo manual

```
POST /api/v1/admin/jobs/catalog-price-sync      # super_admin; 200 { jobId, setsQueued, remaining }
```

- Rol **`super_admin`** (guard `@Roles`), **auditado** en `AuditLog` (`action: jobs.catalog_price_sync.run`).
- Ejecuta `run()` = **`syncAll force:true`** (re-import **completo** de metadata, single-flight): si ya hay
  una corrida en curso, retorna `setsQueued:0` sin lanzar otra. **Es el disparo manual/ops-only** (ya no
  agendado; el cron diario corre la variante ligera `runMetadataImport()` = `force:false`). Útil para forzar
  un re-import fuera de horario o tras cargar la API key. **No escribe precios** (solo metadata).

### 18.6 Monitoreo

- **Duración de la corrida:** el `catalog-metadata-sync` diario es barato (solo sets nuevos); el
  `catalog-price-sync` manual (`force:true`) recorre todo el catálogo secuencialmente — vigila el
  `jobId`/tiempo entre inicio y fin en los logs del backend. El single-flight evita solapes.
- **Rate-limit 429 de pokemontcg.io:** alarma sobre 429 repetidos en los logs del backend. Un 429 sostenido
  indica que falta/está mal la `POKEMONTCG_IO_API_KEY` o que se excede la cuota (~20k/día). El cliente hace
  backoff, pero un 429 persistente alarga o degrada el import.
- **`PriceReference` — ya NO lo alimenta este job:** tras WS-A `catalog-sync` **no escribe precios**, así que
  el crecimiento de `PriceReference` (y su retención/poda) es responsabilidad de **`price-ingest`** — ver
  **§19.8**. *(Nota histórica: antes de WS-A este job insertaba ~30–40k filas/día; ya no.)*
- **Fallo del job:** el worker BullMQ registra `Job <nombre> falló: <msg>`. Cablear la alerta de plataforma
  sobre 5xx/errores del worker (mismo canal que las alertas de `price-ingest`/`price-sync`/`fx-refresh`, §8).

### 18.7 Rollback / deshabilitar

| Escenario | Acción |
|---|---|
| **Apagar el import agendado sin tocar código (recomendado)** | Poner `CATALOG_METADATA_SYNC_CRON` en un cron **válido que nunca dispare**, p. ej. `0 0 31 2 *` (31 de febrero = nunca), en Railway → `backend` → Variables, y redeploy. El scheduler sigue sano; el import no vuelve a correr. **NO** uses cadena vacía (produce patrón inválido, §18.2). |
| **Pausa temporal (stopgap)** | Quitar la repeatable de Redis (`queue.removeRepeatable`/borrar la key de BullMQ vía `redis-cli`). **Se re-crea en el próximo arranque** del backend (el scheduler la vuelve a añadir en `onModuleInit`), así que es sólo un parche hasta el siguiente deploy/restart — para algo permanente usa el cron-nunca de arriba. |
| **Corrida en curso problemática** | Es idempotente y single-flight: se puede dejar terminar. Para que no vuelva a lanzarse, aplica el cron-nunca. No hay riesgo de dinero/PII (solo importa metadata de catálogo; **no** escribe precios). |
| **Apagar TODOS los jobs** | Quitar `REDIS_URL` deshabilita el scheduler completo (demasiado amplio; afecta fx/price-ingest/snapshots/barridos). Preferir el cron-nunca por-job. |

**Enrutado a backend (cambios de código, NO devops):**
1. **Robustez del `?? default`:** hoy `CATALOG_METADATA_SYNC_CRON=""` (vacío) NO cae al default y genera un
   patrón inválido. Sería más robusto tratar cadena vacía/espacios como "usar default" (o "deshabilitado"
   explícito). Mitigación devops mientras tanto: documentado en `.env.example` y §18.2 (no usar vacío).
2. **`fx-refresh` no configurable por env** (`0 6 * * *` hardcodeado) y 1×/día — relevante para `price-ingest`
   (§19.4), no para este job (que ya no precia).

---

## 19. Job `price-ingest` — ingest MASIVO de precios vía proveedor de PAGA (WS-A, v1.14)

> Contexto: WS-A reemplaza el barrido por-carta frágil (`catalog-price-sync` `force:true`, re-sync completo
> **fire-and-forget en memoria** — §18) por un **ingest masivo por SET** que consume el **endpoint bulk** del
> proveedor de paga **PokemonPriceTracker**. El job lo implementa **backend** (`PriceIngestService` + jobs
> `price-ingest`/`price-ingest-set` + cableado en `scheduler.service.ts` + `env.validation.ts` + seed del
> dial); **devops** aporta el scheduling (`.env.example`), su cableado en Railway y este runbook. Ver
> `docs/ARCHITECTURE.md §4.15` y `docs/API_CONTRACT.md` (§M10-ops). **Toca dinero → triple veredicto.**
> **Aditivo, SIN migración de esquema** (reusa `PriceReference`, `PriceSource.pokemonpricetracker`, `Card.availableFinishes`).

### 19.1 Qué hace

- **`price-ingest` (parent):** lista los `CardSet` **locales** y encola un child `price-ingest-set` **por set**
  en la cola BullMQ. Devuelve de inmediato (encola, no procesa).
- **`price-ingest-set` (child, `{ setId }`):** baja los precios de **un set** en **pocas requests** (bulk),
  agrupa por carta y hace **upsert idempotente** de `PriceReference` por
  `(cardId, 'raw', 'raw:NM', finish, capturedDate=hoy)`, convirtiendo **USD→MXN** con el FX del día (colchón
  #13). Refresca `Card.availableFinishes` desde el proveedor. **Respeta `isManualOverride`** (si hay override
  del admin, no lo pisa).
- **Robusto / idempotente / reanudable** (el corazón de WS-A): un set que falla (429, payload roto) **no
  tumba** el resto (es su propio job BullMQ con retry/backoff); la cola vive en **Redis** (persistida) → un
  reinicio a media corrida retoma los child jobs pendientes; re-correr el mismo día **actualiza** el precio,
  no duplica.
- **Proveedor pluggable por el dial `PRICE_PROVIDER`:** `pokemonpricetracker` (PAGA, bulk, PRIMARIO) o
  `pokemontcg_io` (legacy/rollback). El job es robusto con **ambos**; el de paga aporta variantes completas y
  ~100× menos requests (bulk por set).
- **Reemplaza** el rol de pricing de `catalog-price-sync` (§18). El catálogo (metadata / import de sets
  nuevos) sigue en `catalog-sync {force:false}`, en cadencia propia y barata.

### 19.2 Requisitos operativos (obligatorios en prod)

- **`REDIS_URL`** — BullMQ. Ya inyectado por Railway (`${{ Redis.REDIS_URL }}`). Sin él, el scheduler **no
  programa** el cron (queda deshabilitado con warning) y `price-ingest` solo es disparable a mano (corre
  **secuencial AWAITED**, nunca fire-and-forget). La cola persistida en Redis es lo que hace el job
  **reanudable**.
- **`POKEMONPRICETRACKER_API_KEY`** — **ya aprovisionada en Railway** (NUNCA en el repo; el código solo lee
  `process.env`). Pasa a ser **requisito operativo** cuando `PRICE_PROVIDER=pokemonpricetracker`: debe tener
  **cuota del PLAN DE PAGA** (el ingest baja el catálogo por set, 1–2×/día). **Money-safe:** si la key
  falta/está inválida con el proveedor de paga seleccionado, el ingest **NO borra** precios (los deja
  **stale**, que es seguro) y **alerta**; **no** hay fallback silencioso a otra fuente. Si
  `PRICE_PROVIDER=pokemontcg_io`, el requisito es `POKEMONTCG_IO_API_KEY`.
- **`POKEMONPRICETRACKER_MARKET_FORMAT`** (money-safe, **sin default**) — moneda + unidad del `market` del
  proveedor de paga (`usd_dollars`/`usd_cents`/`mxn_dollars`/`mxn_cents`). **Requisito para que el proveedor
  de paga ESCRIBA:** sin ella, con `PRICE_PROVIDER=pokemonpricetracker` el ingest corre **sample-only** (hace
  el fetch, loguea una muestra, **no persiste** ningún precio). El PO confirmó **`usd_dollars`**; fíjala
  **solo tras leer el log de muestra** de una corrida `{setId}` (runbook §19.5). Con `pokemontcg_io` (legacy)
  **no aplica** (esa fuente ya es USD conocido).
- **Dial `PRICE_PROVIDER`** — ConfigSetting (M10), **no env**. Ver §19.5.

### 19.3 Horarios y cómo cambiarlos (env, sin redeploy de código)

Dos BullMQ repeatables, cron **en UTC** por env (documentados en `.env.example`):

| Env | Default | UTC | CDMX | Corrida |
|---|---|---|---|---|
| `PRICE_INGEST_CRON_1` | `0 0 * * *` | 00:00 UTC | **18:00 CDMX** | tarde |
| `PRICE_INGEST_CRON_2` | `0 12 * * *` | 12:00 UTC | **06:00 CDMX** | mañana |

- **CDMX = UTC−6, fijo (sin horario de verano).** `06:00 CDMX = 12:00 UTC`, `18:00 CDMX = 00:00 UTC`. Juntos
  disparan a las **06:00 y 18:00 CDMX** (el mismo slot 2×/día que ocupaba `catalog-price-sync`, ahora
  repuntado al pricing por `price-ingest`).
- **Cambiar horario en prod:** editar `PRICE_INGEST_CRON_1/_2` en **Railway → servicio `backend` →
  Variables** + redeploy. Es config de env, no cambio de código. Siempre en **UTC**.
- **NO** uses cadena **vacía** para apagar (el `?? default` solo cubre variable **ausente**; `""` genera un
  cron inválido). Para apagar sin tocar código, ver §19.7 (cron-nunca).
- **Nombres de env (wiring HECHO):** backend cableó el scheduler para leer **`PRICE_INGEST_CRON_1/_2`** (no
  reusó el slot `CATALOG_PRICE_SYNC_CRON_*`, ahora deprecado) y programa `price-ingest` **por defecto 2×/día**
  con el dial sembrado `pokemontcg_io`. Resuelto — ya no es una solicitud abierta.

### 19.4 Orden `fx-refresh → price-ingest` (requisito operativo)

El ingest convierte USD→MXN con el **FX del día**; el FX debe estar fresco **antes** de cada corrida.

- `fx-refresh` corre a **`0 6 * * *` = 06:00 UTC = 00:00 CDMX** (Banxico SIE + colchón; cron **hardcodeado**
  en backend, no configurable por env).
- Secuencia diaria (hora CDMX): `fx-refresh` **00:00** → `price-ingest` mañana **06:00** → `price-ingest`
  tarde **18:00**. **Ambas** corridas del ingest caen **después** del `fx-refresh` del día. ✅
- `FxService.getCurrent()` **degrada** al último `FxRate` conocido si el `fx-refresh` no corrió, así que el
  orden es **suave** pero recomendado. Regla para quien edite los crons: mantener `price-ingest` **después**
  de las 00:00 CDMX (después del `fx-refresh`). Cualquier hora diurna CDMX cumple.
- ⚠️ **DECISIÓN 2026-09-10 (`§43.3`) — los crons se QUEDAN en `0 0` y `0 12` UTC.** La norma de
  `ARCHITECTURE §4.35(e)` punto 3 (barrido **tras la ventana de TCGCSV**, como el sellado) se declara
  **cumplida en sustancia** —la corrida de las 00:00 UTC lee el fichero publicado ~20:00 UTC, **4 h antes**,
  más margen que las 1,5 h del sellado— y **derogada en su literal de FX**, porque el FX de ESCRITURA es
  **traza**: la conversión a pesos se **recalcula en la lectura** con el FX vivo (verificado en
  `pricing.service.ts`). **Con su disparador de revisión escrito** — ver §43.3 antes de mover estos crons.

### 19.5 Flip a `pokemonpricetracker` — runbook money-safe con `POKEMONPRICETRACKER_MARKET_FORMAT` (CRÍTICO)

Dos palancas gobiernan el proveedor de paga y **AMBAS** son necesarias para que escriba precios:
- **Dial `PRICE_PROVIDER`** (`price_provider`, ConfigSetting M10, **no env**): selecciona el proveedor. Se
  flipea a `pokemonpricetracker` **desde el panel M10** (sin redeploy).
  ⚠️ **Corrección v1.65 (`D-PP-2`, 2026-09-10).** Aquí decía *«seed `pokemontcg_io` (money-safe)»*, y **eso
  ya no es cierto**: el seed vive en [`API_CONTRACT §M10-PP`](API_CONTRACT.md#M10-PP) y su norma es **`I-PP1`
  — el SEED es el PRIMARIO**. El criterio que faltaba: *un seed money-safe debe ser **INERTE** (no escribe
  dinero — como `sealed_price_source='off'`) **o el PRIMARIO validado**; nunca un **segundo escritor** con
  semántica distinta*. El legacy **escribe** —y escribe aplanado—, así que no era el candado: era el riesgo
  con el nombre del candado (razón entera en `ARCHITECTURE §4.35a(b)`; ver §43.1).
  ⛔ **El valor no se transcribe aquí**: la divergencia nació justo de tener el literal repetido en cinco
  sitios. Se cita `§M10-PP`. **Lo que este runbook opera es el VIGENTE, no el SEED** (`I-PP3`).
- **Env `POKEMONPRICETRACKER_MARKET_FORMAT`** (Railway, **sin default**): moneda + unidad del `market`.
  **Candado fail-closed** — sin ella el proveedor de paga corre en **sample-only** (fetch + log de muestra,
  **persiste NADA**). Es lo que hace seguro el flip: aunque flipees el dial, el proveedor **no escribe** hasta
  fijar el formato.

**Por qué se GATEA (riesgo de dinero):** el esquema/moneda del payload se confirma **en runtime** (desde dev
el dominio del proveedor está bloqueado por egress). El adapter **ya no asume** la moneda: si el `market`
viniera en **MXN** y se fijara `usd_dollars`, la conversión USD→MXN lo **inflaría ~18×** (200 MXN → ~3,600
MXN). Por eso el formato se fija **leyendo el log de muestra**, no a ciegas.

**Runbook de verificación (en ORDEN — no te saltes el paso 5):**

1. **Precondición:** `POKEMONPRICETRACKER_API_KEY` en Railway (ya está) y `POKEMONPRICETRACKER_MARKET_FORMAT`
   **VACÍA** (aún sin fijar). Backend desplegado con WS-A (`price-ingest` cableado + log de ejemplo).
2. **Flip del dial (seguro por el candado):** en el panel **M10** poner `PRICE_PROVIDER=pokemonpricetracker`
   (sin redeploy). Como `MARKET_FORMAT` está vacía, el proveedor de paga entra en **sample-only** → NO escribe.
3. **Corrida de UN set** (blast radius contenido; en sample-only aún no persiste):
   `POST /api/v1/admin/jobs/price-ingest { "setId": "sv8" }`.
4. **LEER el log de muestra** que deja backend (payload crudo de la 1ª entrada + `finish` detectado +
   `market`). Determinar la **moneda y unidad reales**. El PO confirmó **USD en dólares**; chequeo de cordura:
   una carta de ~$10 USD debería quedar, ya con FX, en **~180–220 MXN** (no ~3,600). Elegir el valor de
   `MARKET_FORMAT`: `usd_dollars` (lo esperado), `usd_cents`, `mxn_dollars` o `mxn_cents`.
5. **FIJAR `POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars`** (valor confirmado por el PO) en **Railway →
   `backend` → Variables** + redeploy. **Este es el paso OBLIGATORIO que "arma" al proveedor de paga:** hasta
   aquí no escribió nada. Sin esta env, el ingest de paga nunca persiste (sample-only permanente).
6. **Re-correr UN set y verificar la escritura:** `POST /admin/jobs/price-ingest { "setId": "sv8" }` → ahora sí
   **persiste** `PriceReference`. Confirmar en las filas: precios en rango sano (~180–220 MXN para ~$10 USD),
   acabados mapeados (no todo `normal`), cobertura (cartas resueltas, `market` > 0, `skipped` bajo).
7. **Rollout completo:** si todo cuadra, correr el ingest **completo** `POST /admin/jobs/price-ingest` (sin
   `setId`) o dejar que el cron 2×/día lo haga. Proveedor de paga en vivo.
   - **Si el log mostró MXN** u otra unidad: fija el `MARKET_FORMAT` correcto (`mxn_dollars`/`mxn_cents`/…),
     re-corre el set y re-verifica — **no** hay que tocar código (el formato es un dial de env). Si el payload
     no encaja en ninguno de los 4 formatos, **rollback por dial** a `pokemontcg_io` (§19.7) + enrutar a backend.

> **Regla de oro:** flipear el **dial** solo (sin `MARKET_FORMAT`) es intencionalmente **inerte** en cuanto a
> escritura — es la red de seguridad si alguien flipea sin seguir el runbook. **Rollback** money-safe: volver
> a `pokemontcg_io` por el panel (sin redeploy) — §19.7.

### 19.6 Disparo manual

```
POST /api/v1/admin/jobs/price-ingest                       # super_admin; 202 { job:"price-ingest", enqueued, jobId? }
POST /api/v1/admin/jobs/price-ingest { "setId": "sv8" }    # un solo set (verificación); 202 { ..., scope:"set", setId }
```

- Rol **`super_admin`**, **auditado** en `AuditLog`, **single-flight** (no encola un 2º barrido si hay uno en
  curso). **Toca dinero** (mueve precios de referencia).
- `setId?` **opcional** — pensado para la **verificación de esquema** de §19.5 (un set, sin barrer todo).
  Omitirlo ingesta **todo** el catálogo. Equivale a la corrida programada 1–2×/día.
- Sin `REDIS_URL`, corre **secuencial AWAITED** en el handler (dev/ops); con Redis, fan-out por set.

### 19.7 Rollback

| Escenario | Acción |
|---|---|
| **Proveedor de paga con esquema/moneda malo, o coste/cuota fuera de control** | **Flipear el dial `PRICE_PROVIDER` a `pokemontcg_io`** desde el panel **M10** — **sin redeploy**, efecto inmediato en la próxima corrida (y en cualquier disparo manual). Es la palanca de rollback money-safe. Los precios ya escritos por el de paga se **sobre-escriben** en la siguiente corrida legacy (upsert idempotente del día). |
| **Key de paga inválida/vencida** | Money-safe por diseño: el ingest **no borra** precios (los deja stale) y alerta. Rotar la key en Railway o flipear el dial a `pokemontcg_io` mientras se resuelve. |
| **Apagar el ingest sin tocar código** | Poner `PRICE_INGEST_CRON_1/_2` en un cron **válido que nunca dispare** (p. ej. `0 0 31 2 *` = 31 feb) en Railway + redeploy. **NO** cadena vacía (§19.3). El disparo manual sigue disponible. |
| **Corrida problemática en curso** | Es idempotente y single-flight; se puede dejar terminar. Para que no vuelva a lanzarse, aplica el cron-nunca o flipea el dial. |
| **Precios inflados ~18× ya publicados** (formato de moneda mal elegido) | **Corregir `POKEMONPRICETRACKER_MARKET_FORMAT`** al valor real (p. ej. `mxn_dollars` si el proveedor daba MXN) + redeploy, **o** flip a `pokemontcg_io` mientras tanto; re-correr `price-ingest` (idempotente, corrige el día). Si tocó el precio de venta visible, considerar override manual del admin en las cartas críticas mientras se recorre. **No requiere cambio de código** (el formato es env). |

> Orden de oro: el rollback del **proveedor** es un **flip de dial** (dato, sin deploy); el del **schedule**
> es el cron-nunca (env, con redeploy). Ninguno toca código de app.

### 19.8 Monitoreo

- **Duración / avance:** el fan-out por set encola N child jobs; vigila la cola BullMQ y los logs
  (`price-ingest`/`price-ingest-set`). Alarma si una corrida no termina antes de la siguiente.
- **`skipped` alto:** el adapter cuenta entradas OMITIDAS (carta no resuelta, `market` ≤ 0, acabado
  desconocido). Un `skipped` anómalo indica un **cambio de esquema** del proveedor → revisar (§19.5).
- **Rate-limit / cuota del proveedor de paga:** alarma sobre 429/402 del proveedor. El bulk por set reduce
  ~100× las requests vs per-carta, pero vigila el **coste/cuota del plan** (riesgo devops, v1.14-2).
- **Precios stale:** si el ingest no escribió un set (key inválida, 429 persistente), los precios quedan del
  día previo. Alarma sobre sets sin `PriceReference` fresca del día (salud de datos / `dataHealth`).
- **Crecimiento de `PriceReference`:** cada corrida inserta filas por día×acabado. Como en §18.6, vigilar el
  tamaño de la tabla; la poda/retención es deuda a coordinar con backend (dueño del esquema).

### 19.9 Runbook — encender la gráfica del home tras un ingest (#10)

La gráfica pública del "set destacado" (§17) se alimenta de `SetValueSnapshot`, que agrega el valor de
mercado del set desde `PriceReference`. **Tras un `price-ingest` exitoso**, el set destacado queda
**preciado** (el ingest precia **todo** el catálogo, incluido el set del hero — subsume a `set-price-sync`,
§4.15g), así que el snapshot diario del set tiene datos frescos que agregar:

1. Corre (o deja correr por cron) `price-ingest` con el proveedor ya verificado (§19.5). Al terminar, el set
   del hero tiene `PriceReference` de hoy.
2. El job **`set-value-snapshot`** (cron diario tras el pricing del set, §17.4) hace **upsert** del
   `SetValueSnapshot` del día → **la serie crece 1 punto/día** con datos reales.
3. **Siembra del 1er punto** (una vez), si aún no hay serie: `POST /admin/jobs/set-value-snapshot` tras el
   ingest (ver §17.3 Paso 3–4). Verifica `GET /catalog/featured-set/value-history` (≥1 punto).

> El ingest **no** fabrica puntos: la gráfica acumula **1 punto/día** a partir del primer snapshot posterior a
> un ingest con precios frescos. Cross-ref §17 (mecanismo del set destacado, fallbacks y rollback de la gráfica).

### 19.10 Solicitudes a BACKEND (cambios de código — NO los toca devops)

> **TODAS RESUELTAS (WS-A cierre 2026-08-17).** Backend cableó los 5 puntos de abajo (ver `BACKEND_NOTES §36`):
> scheduler con `PRICE_INGEST_CRON_1/_2` **DEFAULT-ON 2×/día**, `catalog-sync` aligerado a metadata
> (`force:false`, ya no escribe `PriceReference`), `env.validation` con `POKEMONPRICETRACKER_API_KEY` requerida
> solo si el hint `PRICE_PROVIDER=pokemonpricetracker`, seed del dial `pokemontcg_io`, log de muestra en la 1ª
> corrida, y el candado **`POKEMONPRICETRACKER_MARKET_FORMAT`** (fail-closed / sample-only). Se conservan abajo
> como registro histórico de lo pedido.

Enrutadas en su momento al rol **backend** (dueño de `backend/src/**`); WS-A las especifica en `ARCHITECTURE §4.15`:

1. **Scheduler:** cablear `price-ingest` 1–2×/día en `scheduler.service.ts`, leyendo `PRICE_INGEST_CRON_1/_2`
   (UTC) — **o** reusar el slot `CATALOG_PRICE_SYNC_CRON_*` repuntándolo del pricing al ingest (definir cuál;
   §4.15g). Aligerar `catalog-sync` a **metadata/`force:false`** (deja de escribir `PriceReference`).
2. **`env.validation.ts`:** decidir la política de `POKEMONPRICETRACKER_API_KEY` en no-local — **required**
   solo si `PRICE_PROVIDER=pokemonpricetracker`, **o** opcional con degradación a "no escribe / stale +
   alerta". Money-safe: nunca fallback silencioso a otra fuente (§4.15h).
3. **Seed del dial:** sembrar `price_provider` en `ConfigSetting`.
   ⚠️ **Corregido v1.65 (`D-PP-2`, 2026-09-10):** esta línea pedía sembrar el **legacy** *«(money-safe)»*.
   La norma es hoy la contraria — **`I-PP1`: el SEED es el PRIMARIO**, en
   [`API_CONTRACT §M10-PP`](API_CONTRACT.md#M10-PP) — y el cambio del literal es **de backend**
   (desviación **`D-PP-1`**, `ARCHITECTURE §9`), no de devops. **Este punto queda CERRADO como solicitud
   de devops**: lo que devops sostiene mientras tanto es la **paridad de entornos** (§43.2). Ver §43.1.
4. **Log de ejemplo (1ª corrida):** que `price-ingest-set` **logee un ejemplo** del payload crudo del
   proveedor + `finish`/`currency` detectados + `marketCents` + `priceMxnCents`, para la verificación
   USD-vs-MXN de §19.5. **Sin este log, la verificación de moneda es a ciegas** — es un requisito para poder
   flipear el dial con seguridad.
5. **Adapter defensivo + endpoint manual** (`POST /admin/jobs/price-ingest` con `setId?`) — ya en el contrato
   (§M10-ops).

> Estas son **dependencias de código**; devops solo provee el scheduling (env), Railway y este runbook. Un
> fallo de build/deploy por un bug de estos se **reporta a backend**, no se corrige aquí.

---

## 20. Fix Redis IPv6 en Railway (auditoría de precios 2026-08-17) — checklist operativo post-deploy

> **Contexto (resumen; el detalle vive en `BACKEND_NOTES §43` — no se duplica aquí):** el scheduler BullMQ
> no conectaba al Redis de Railway. El private networking (`redis.railway.internal`) resuelve **solo IPv6**
> y ioredis usa `family: 4` por default → lookup fallido, reintento infinito **en silencio**, crons muertos
> y catálogo entero en «Precio pendiente». Backend lo arregló en `backend/src/jobs/redis-connection.util.ts`
> (default **`family: 0`** dual-stack; override por env `REDIS_FAMILY` o `?family=` en la URL) + boot no
> bloqueante + listeners de error/ready + **catch-up al arranque** (`price-ingest` inmediato si no hay
> ingesta reciente). La parte devops es este checklist + la doc de `REDIS_FAMILY` en `.env.example`.

### 20.1 Checklist ANTES del deploy (variables en Railway)

1. **`REDIS_URL` en el SERVICIO `backend`** (Railway → servicio `backend` → Variables), no solo en el
   add-on Redis: debe existir como variable del servicio con la referencia **`${{ Redis.REDIS_URL }}`**.
   Una `REDIS_URL` que solo vive en el add-on NO llega al runtime del backend, y sin ella el scheduler ni
   siquiera intenta programar crons (§19.2). El síntoma histórico (catálogo sin precios) es 100%
   consistente con un scheduler sin conexión Redis viable (BACKEND_NOTES §43.6.1).
2. **`POKEMONTCG_IO_API_KEY` presente** en el servicio `backend` (BACKEND_NOTES §43.6.3): el dial sembrado
   es `pokemontcg_io`, y sin key el free tier (~30 req/min) ralentiza el ingest y multiplica los 429
   (parciales visibles en logs; no borra precios, pero deja huecos).
3. **`REDIS_FAMILY`: NO hace falta fijarla.** El default `0` (dual-stack) del código ya cubre el hostname
   interno IPv6-only de Railway. Solo existe como override (`0|4|6`) para casos de DNS anómalo — ver el
   bloque Redis de `.env.example`. Equivalente sin env: `REDIS_URL=...?family=0`.

### 20.2 Checklist DESPUÉS del deploy (verificación en logs/health)

Runbook completo en **BACKEND_NOTES §43.5**; lo mínimo a verificar:

1. **Logs de arranque** (Railway → servicio `backend` → Deploy logs), en orden:
   - `Scheduler: conexión Redis lista (BullMQ operativo).`
   - `Scheduler activo (BullMQ): …`
   - Una de las dos líneas de **catch-up**: `price-ingest catch-up: SIN ingesta de precios reciente →
     encolado price-ingest inmediato (jobId=…)` (primer arranque tras el fix) o
     `price-ingest catch-up: hay ingesta reciente…` (arranques posteriores).
   - **Señal de fallo:** `Scheduler: error de conexión Redis…` repetido cada ~60s → la URL/red sigue mal;
     re-verificar §20.1.1 y capturar el log de arranque completo para **backend** (§43.6.4).
2. **Health:** `GET /api/v1/health` → componente Redis en **`up`**. Tras el fix el health usa el mismo
   `family` que el scheduler, así que ya es una señal fiable (antes podía dar `down` con Redis sano).
3. **Progreso del ingest:** líneas `price-ingest: encolados N sets (fan-out BullMQ).` y por set
   `price-ingest-set(<setId>, pokemontcg_io): X cartas, Y refs, …` + `Job price-ingest-set (id=…) completado.`
4. **Opcional — disparo manual** para no esperar al cron/catch-up:
   `POST /api/v1/admin/jobs/price-ingest` (super_admin, 202; con `{"setId": "…"}` un solo set — §19.6).

### 20.3 Recordatorio `numReplicas: 1` (railway.json)

`railway.json` fija **`numReplicas: 1`** y debe seguir así mientras el worker BullMQ corra **in-process**
en el mismo servicio que la API: con **N réplicas habría N schedulers** registrando los mismos repeatables
y corriendo crons/catch-up por duplicado (N ingests simultáneos, N `fx-refresh`, etc. — idempotentes pero
desperdicio de cuota de API y carga). Antes de subir réplicas hay que separar el worker a un servicio
propio (decisión futura, §6.1) y además migrar el throttler a store Redis (deuda backend, §5.1). Para este
fix **no se cambió nada** en `railway.json`: healthcheck (`/api/v1/health`, timeout 300s), restart policy y
réplicas ya eran correctos; el bug era de código (family del DNS), no de config de plataforma.

---

## 21. Job `sealed-price-ingest` — referencia de mercado del SELLADO vía TCGCSV (v1.19)

> **El runbook técnico normativo vive en `BACKEND_NOTES §44.3` (y el diseño en ARCHITECTURE §4.19);
> aquí va la vista OPERATIVA de devops, sin duplicar el detalle.** El precio TCGCSV es **solo
> referencia informativa** (`sealedMarketRef` en el admin M1): no publica, no fija `listPriceCents`,
> no toca dinero. Por eso el rollback es trivial (dial `off`).

### 21.1 Piezas operativas

- **Job:** `sealed-price-ingest`, 1×/día, secuencial y awaited (sin fan-out). Cron por env
  **`SEALED_PRICE_INGEST_CRON`** (default `30 21 * * *` = 21:30 UTC, tras el refresh diario de
  tcgcsv.com ~20:00 UTC y tras `fx-refresh`; ver bloque en `.env.example` y fila en §4).
- **Interruptor real:** el dial M10 **`sealed_price_source`** (ConfigSetting, `tcgcsv | off`, seed
  **`off`** = fail-closed). Con `off`, el job es un **no-op logueado** aunque el cron dispare
  (`enqueued:false, reason:SEALED_PRICE_SOURCE_OFF`). La env **solo** ajusta horario; el flip es por
  panel/API M10, igual que `price_provider` (§19.5).
- **Disparo manual:** `POST /api/v1/admin/jobs/sealed-price-ingest` (super_admin, 202, auditado);
  body opcional `{"groupId": <int>}` para una corrida **acotada a un grupo** TCGplayer.
- **Requisitos:** `REDIS_URL` para el cron (sin Redis solo queda el disparo manual, §19.2). Sin API
  key: tcgcsv.com es público.

### 21.2 Encendido en STAGING (antes de cualquier flip en prod)

Pasos (detalle completo en BACKEND_NOTES §44.3; ahí está el porqué de cada uno):

1. Deploy del release v1.19 + `prisma migrate deploy` (migración **M-23**: enum `tcgcsv` + columnas
   `tcgplayerProductId`/`tcgplayerGroupId`).
2. Verificar el dial: `GET /api/v1/admin/settings` → `sealedPriceSource=off` (seed).
3. Mapear 1–2 items sellados reales vía M2: `GET /admin/pricing/sealed/tcgcsv/groups` →
   `.../groups/:groupId/products` → `PUT /admin/pricing/sealed/items/:itemId/mapping`.
4. **Flipear el dial a `tcgcsv` EN STAGING** (staging no es prod: inocuo) y lanzar la corrida
   acotada: `POST /api/v1/admin/jobs/sealed-price-ingest {"groupId": <grupo mapeado>}`.
5. **Logs esperados** (backend): línea resumen del ingest con `grupos`/`referencias` y los contadores
   `fetchedRaw/skipped/usedFallbackMid/unmatched`; al final `Job sealed-price-ingest (id=…)
   completado.` (heartbeat del worker, §19.8). Señales de problema: `502 UPSTREAM_ERROR` en el
   explorador M2 (tcgcsv caído/bloqueado) o `unmatched` alto (mapeos rotos).
6. **Verificación en datos:** `PriceReference` con `source=tcgcsv`, `gradeKey=sealed:tcg:<pid>`,
   USD→MXN coherente con el FX del día + colchón; y en el admin **M1** el item sellado mapeado
   muestra `sealedMarketRef` poblado (deja de ser `null`).
7. **Validación de esquema (crítica):** los tests corren contra fixtures (el egress de dev bloquea
   tcgcsv.com — ver 21.4), así que esta corrida en staging es la PRIMERA contra el payload real. Si
   el esquema difiere de las fixtures → **hallazgo a backend** (adapter + fixtures); si cuadra →
   flip del dial en prod.

### 21.3 Rollback

**Dial `sealed_price_source=off`** (panel/API M10, sin redeploy). El job vuelve a no-op fail-closed;
los `PriceReference` ya escritos permanecen **inertes** (referencia informativa; nada público los
consume). No hay que tocar env ni cron. Para desmapear un item puntual: `PUT .../mapping` con `null`.

### 21.4 Nota de RED / egress (tcgcsv.com)

- El **entorno de dev/sandbox BLOQUEA tcgcsv.com** (proxy 403): por eso los tests usan fixtures y la
  validación real es obligatoria en staging (21.2.7). No intentes "probar el fetch" en local/dev.
- **Staging y prod deben permitir HTTPS saliente a `tcgcsv.com`** (host **FIJO** en el adapter,
  anti-SSRF; sin API key). En Railway el egress es abierto por defecto — no hay acción; si algún día
  se restringe egress por allowlist, añadir `tcgcsv.com` junto a `api.pokemontcg.io`,
  `www.banxico.org.mx` (SIE) y el dominio del proveedor de paga.


---

## 22. Desbloqueo de los gates rojos del release PR #3 (`main` → `production`, 2026-08-17)

> **Contexto:** el PR de release #3 (mergeado en `production`, commit `9940adc`) quedó con tres
> checks en rojo que bloquean el "Wait for CI" del deploy en Railway: `gitleaks`, `frontend-e2e`
> (y su gemelo del E2E real) y `trivy-image`. Los tres eran fallos de **infraestructura de CI**,
> no de código de aplicación: se arreglan en zona devops y no hubo que tocar `backend/` ni
> `frontend/`. Rama del arreglo: `claude/fix-ci-gates-release`.

### 22.1 `gitleaks` — faltaba `GITHUB_TOKEN`

**Síntoma (log real):**

```
##[error]🛑 GITHUB_TOKEN is now required to scan pull requests. You can use the automatically created token as shown in the README.
```

**Causa raíz:** `gitleaks/gitleaks-action@v2` exige `GITHUB_TOKEN` para escanear PRs (lo usa para
resolver los commits del PR y, si procede, comentar). El step de `security-sast.yml` solo pasaba
`GITLEAKS_CONFIG`. El input va por **`env:`**, no por `with:` (así lo documenta el README de la
acción).

**Cambio (`.github/workflows/security-sast.yml`, job `gitleaks`):**
- `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` en el bloque `env:` del step.
- `permissions:` **a nivel de job** (no del workflow, para no ampliar el scope de los demás):
  `contents: read` + `pull-requests: read`.
- `GITLEAKS_ENABLE_COMMENTS: "false"`: publicar comentarios en el PR exigiría
  `pull-requests: write` y no queremos ese permiso en un job de secretos. El gate **no se relaja**:
  si hay leaks el job falla igual y el detalle queda en el log y en el artifact SARIF.

**Deuda anotada (no bloqueante):** `gitleaks-action@v2` corre sobre Node 20, que GitHub retira de
los runners el **2026-09-16**. Antes de esa fecha hay que subir a `@v3` (mismos inputs/env; requiere
runner ≥ 2.327.1). No se subió en este arreglo para no mezclar un cambio de mayor con el desbloqueo
del release. Está anotado como comentario en el propio workflow.

### 22.2 `frontend-e2e` / `e2e-real` — Chromium inexistente en `ubuntu-latest`

**Síntoma (log real):**

```
##[error]No existe /opt/pw-browsers/chromium.
##[error]Este job usa el Chromium preinstalado del runner-harness (/opt/pw-browsers) y NO ejecuta 'playwright install'.
```

**Causa raíz:** los dos workflows E2E asumían un **runner-harness** con los navegadores de Playwright
preinstalados en `/opt/pw-browsers`, pero los jobs corren en `ubuntu-latest` (runner **estándar** de
GitHub), donde esa ruta **no existe** — solo existe dentro del entorno de Claude Code. El "Guard
navegador" hacía exactamente lo que decía su mensaje: abortar. Es decir, el job **nunca** pudo pasar
en CI con esa política.

**Cambio (approach estándar de Playwright en Actions):**
- `.github/workflows/e2e.yml` (job `frontend-e2e`): se eliminaron
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, `PLAYWRIGHT_BROWSERS_PATH`, `PLAYWRIGHT_CHROMIUM_PATH` y el
  step *Guard navegador*. Se añadió `npx playwright install --with-deps chromium`
  (`working-directory: frontend`) **después** del `npm ci` del frontend — el orden importa: el CLI
  `playwright` vive en `frontend/node_modules`, antes del `npm ci` `npx` no lo encuentra.
- `.github/workflows/e2e-real.yml` (job `e2e-real`): mismas env vars y mismo guard eliminados; el
  `playwright install` va justo después del `npm ci` del frontend (que está al final del job) y
  antes del step *Playwright smoke*.
- Se reescribieron las cabeceras de ambos workflows y §5.1 de este documento, que documentaban la
  política vieja ("Chromium PREINSTALADO", "NO se ejecuta playwright install", "REQUISITO DE
  RUNNER"). Dejarlas habría sido documentación que miente sobre el pipeline.
- **Detalle que casi se escapa (y que habría dejado el job igual de rojo):**
  `frontend/playwright.config.ts` (rol **frontend**) fija
  `launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'`.
  Con solo instalar el navegador, Playwright habría seguido intentando lanzar la ruta del harness.
  Por eso el step, tras instalar, **resuelve la ruta real con la API oficial**
  (`require('@playwright/test').chromium.executablePath()`), comprueba que el binario existe y es
  ejecutable (ese check sustituye al viejo *Guard navegador*, ahora sí con sentido en CI) y la
  exporta a `$GITHUB_ENV` como `PLAYWRIGHT_CHROMIUM_PATH` para los steps siguientes.
  **Hallazgo → rol frontend (no bloqueante):** el default hardcodeado `/opt/pw-browsers/chromium`
  del config solo tiene sentido en el runner-harness; lo natural sería dejar que Playwright resuelva
  el navegador por defecto y usar `executablePath` **solo** si la env está definida. Mientras el
  config siga así, estos workflows deben exportar la variable.
- **No** se añadió cache de navegadores (`actions/cache`): con `--with-deps` haría falta igual la
  instalación de libs de sistema y el ahorro no compensa el riesgo de cache stale. Si el tiempo de
  job molesta, es una optimización posterior.
- **Observación NO tocada (decisión consciente):** `e2e-real.yml` invoca el smoke con
  `E2E_BASE_URL` pero **sin** `E2E_REAL=1`, mientras que el `playwright.config.ts` documenta
  `E2E_BASE_URL=... E2E_REAL=1 npm run test:e2e` como forma de correr en real (filtra a los tests
  tagueados `@real`). No se cambió en este arreglo para no alterar qué tests corren en el gate de
  promoción a prod dentro de un fix de desbloqueo; queda como decisión para la próxima corrida real
  (si los specs mock-only de esos archivos fallan contra el backend real, la respuesta es añadir
  `E2E_REAL: "1"` al step del smoke).

### 22.3 `trivy-image` — **no era node-tar de la app: era el npm de la imagen base**

**La premisa inicial ("bumpear node-tar") era equivocada.** Verificado:
- `npm ls tar` **vacío** en `backend/` y en `frontend/`; ni `backend/package-lock.json` ni
  `frontend/package-lock.json` tienen una sola entrada de `tar`.
- Por eso el `"tar": ">=7.5.18"` de `overrides` en `backend/package.json` era **inefectivo**: no
  existe ningún `tar` en el árbol de dependencias que sobreescribir.

**Causa raíz real:** el reporte que rompía el gate era la sección **Node.js (node-pkg)** — *Total 16
(HIGH 15, CRITICAL 1)* — y **todos** los paths eran
`usr/local/lib/node_modules/npm/node_modules/...`: las dependencias internas del **npm empaquetado
dentro de la imagen base `node:20-alpine`** (`tar` 6.2.1 con CVE-2026-59873 CRITICAL y
CVE-2026-23745/23950/24842 HIGH, `brace-expansion` 2.0.1, `cross-spawn` 7.0.3, `minimatch`,
`picomatch`, `sigstore`…). Eso **no se puede arreglar desde package.json**: no lo declaramos
nosotros, llega con la imagen oficial de Node.

**Arreglo (elimina la vulnerabilidad, no la ignora): npm fuera de la etapa `runtime`.**
El runtime de producción no necesita npm; borrarlo hace desaparecer toda esa superficie y además
adelgaza la imagen.

- **`Dockerfile.frontend`** (etapa `runtime`): `RUN rm -rf /usr/local/lib/node_modules/npm
  /usr/local/bin/npm /usr/local/bin/npx` (en `/usr/local/bin`, `npm` y `npx` son symlinks a esa
  carpeta). El arranque es `node server.js` (output standalone de Next): no usa npm ni npx.
- **`Dockerfile.backend`** (etapa `runtime`): mismo `rm -rf`, **y cambio obligado del `CMD`**. El
  CMD anterior era `sh -c "npx prisma migrate deploy && node dist/main.js"`: sin npx **habría roto
  el arranque en Railway**. Ahora:

  ```dockerfile
  CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
  ```

  `build/index.js` es el entrypoint real del CLI (verificado: `prisma@5.x` declara
  `"bin": {"prisma": "build/index.js"}`; `node_modules/.bin/prisma` es un symlink a ese archivo, y
  `node build/index.js --version` responde correctamente). El paquete `prisma` viaja en la imagen
  porque esta etapa conserva `node_modules` completo con devDeps a propósito (ver NOTA de la etapa
  build y §6).
- **Guards de build (ambos Dockerfiles):** tras el `rm -rf`, un `if` falla el build si `npm` sigue
  presente; en el backend, además, un `test -f node_modules/prisma/build/index.js`. Si una imagen
  base futura mueve esas rutas, o un bump de Prisma cambia su bin, el **build** falla con mensaje
  claro en vez de publicar una imagen vulnerable o crash-loopear al arrancar en Railway.
- **`security/.trivyignore`:** se **retiraron** los 4 CVE de node-tar (CVE-2026-26960/-29786/-31802/
  -59874) — ya no hay npm en el runtime que los traiga. El archivo queda **sin excepciones activas**
  (solo la justificación histórica) y se sigue pasando a los jobs para que cualquier excepción futura
  viva en un único sitio auditable. **No se añadió ningún CVE nuevo.**
- **Comentarios de `security-sast.yml`** (`trivy-fs`, `trivy-image` backend y frontend) actualizados:
  ya no justifican nada por node-tar.

**Efecto colateral que hubo que arreglar:** `e2e-real.yml` sembraba con
`docker compose exec -T backend npm run seed:synthetic --if-present` — **npm ya no existe en ese
contenedor**. Ahora el step lee el script `seed:synthetic` del `package.json` del contenedor
(`node -e`, misma fuente de verdad, sin hardcodear la ruta del seed, que es del rol backend) y lo
ejecuta con `node_modules/.bin` en el `PATH`. Semántica idéntica, incluido el "si no existe, se
salta" del `--if-present`. Los scripts de host (`scripts/seed.sh`, `scripts/seed-synthetic.sh`,
`scripts/db-migrate.sh`) **no** se ven afectados: corren en el host (que sí tiene npm/npx), no dentro
de la imagen.

### 22.4 Qué se verificó y qué NO (honestidad de la verificación)

**Verificado en este entorno:**
- YAML de `e2e.yml`, `e2e-real.yml`, `security-sast.yml` (+ `ci.yml`, `deploy.yml`) parsea con
  `yaml.safe_load`.
- Todos los bloques `run:` de los tres workflows tocados pasan `bash -n`.
- Lógica de extracción del seed (`node -e` + `sh -c` con PATH) probada localmente con el
  `backend/package.json` real: devuelve `ts-node prisma/seed-e2e.ts`, y con el script ausente emite
  el warning y sale 0.
- Entrypoint del CLI de Prisma: instalación limpia de `prisma@^5.20.0` →
  `bin.prisma = "build/index.js"`, `node node_modules/prisma/build/index.js --version` OK.

**NO verificado (bloqueo de entorno, no del arreglo):** **no se pudo construir ni escanear las
imágenes**. El daemon Docker arranca, pero el pull de `node:20-alpine` muere porque la política de
egress del sandbox bloquea el CDN de blobs de Docker Hub:

```
403 CONNECT production.cloudfront.docker.com:443
ERROR: failed to solve: node:20-alpine: ... Forbidden
```

Por tanto **queda pendiente de la primera corrida en CI**: (a) que el build de ambas imágenes pase
con el `rm -rf` de npm y los guards, (b) que `trivy image` ya no reporte HIGH/CRITICAL, y (c) que el
backend arranque con el nuevo `CMD` (migrate deploy + `node dist/main.js`). Si el gate siguiera rojo
por CVEs que **no** vengan de `usr/local/lib/node_modules/npm/...`, son CVEs reales: se tratan (bump
de imagen base o de dependencia), **no** se añaden al `.trivyignore`.

### 22.5 Rollback de este cambio

Todo el arreglo es de infraestructura y reversible con `git revert` del commit en
`claude/fix-ci-gates-release`. Riesgo a vigilar en el **primer deploy** tras el merge: el arranque
del backend depende ahora de `node node_modules/prisma/build/index.js migrate deploy`. Si en Railway
apareciera `Cannot find module '/app/node_modules/prisma/build/index.js'`, el rollback inmediato es
volver al `CMD` con `npx` **y** revertir el `rm -rf` de npm en `Dockerfile.backend` (ambos a la vez:
el `npx` no funciona sin npm). El guard `test -f` del build debería impedir que ese caso llegue a
producción.

### 22.6 Tercera capa de `trivy-image`: OpenSSL de la capa OS (`apk upgrade`)

Cerrados los CVE de npm (§22.3) y los 2 HIGH de dependencias reales del backend (`glob` 10.4.5 →
10.5.0 / CVE-2025-64756, `picomatch` 4.0.1 → 4.0.5 / CVE-2026-33671, que arregló el rol **backend**
en `backend/package.json` con overrides acotados por rango), el gate SIGUIÓ rojo con un hallazgo de
naturaleza distinta:

```
tcg-frontend:scan (alpine 3.23.4)
libcrypto3  CVE-2026-45447  HIGH  3.5.6-r0 → 3.5.7-r0
libssl3     CVE-2026-45447  HIGH  3.5.6-r0 → 3.5.7-r0
openssl: Heap Use-After-Free in PKCS7_verify()
```

**Por qué solo el frontend:** la base del backend hace `apk add ... openssl`, que resuelve contra el
índice ACTUAL del repo de Alpine y de paso arrastraba `libcrypto3`/`libssl3` al día. La del frontend
no instala openssl, así que conservaba las libs congeladas en el tag `node:20-alpine`. O sea: que el
backend pasara era un **efecto colateral**, no una garantía.

**Arreglo (no un ignore):** `apk upgrade --no-cache` en la etapa `base` de AMBOS Dockerfiles, antes
del `apk add`. Cierra el CVE en el frontend, iguala la política en los dos, y cubre futuros CVE de la
capa OS sin depender de que el tag de Node se reconstruya. Se revisa al subir de imagen base.

**Lección para la próxima vez:** los hallazgos de `trivy-image` venían en TRES capas y cada una tapaba
a la siguiente — npm de la imagen base → devDependencies reales de la app → paquetes del sistema. Un
"arreglé el CVE" tras la primera capa habría sido falso. Conviene volver a correr el gate después de
cada capa hasta que salga limpio de verdad.

### 22.7 Robustez de los pasos de instalación en CI (cuelgues de `apt`)

**Síntoma.** En una sola noche, cuatro jobs se quedaron colgados en `apt-get`: `trivy-fs` (×2),
`trivy-image` y el `playwright install --with-deps` de `frontend-e2e`. Hasta **25 minutos** parados en
un paso que en un runner sano tarda entre 30 y 90 s — sin log, sin fallo, solo `in_progress` indefinido.
Hubo que cancelar y relanzar a mano cada vez.

**Por qué importa más de lo que parece.** Railway espera al **check suite COMPLETO** antes de
desplegar. Un job colgado bloquea el deploy sin dar ninguna señal accionable, y en el dashboard es
indistinguible de un job que todavía corre. La causa raíz no es el mirror de apt (que va a seguir
fallando de vez en cuando): era que estos pasos **no tenían ni timeout ni reintentos**, así que un
fallo transitorio se convertía en un cuelgue permanente.

**Arreglo, en dos iteraciones — la primera estaba mal y conviene que quede escrito:**

1. **Intento 1 (insuficiente):** `timeout` por comando + 3 reintentos + `timeout-minutes`. Acotaba el
   cuelgue, pero los reintentos **no servían**: `timeout` mata `apt-get` a mitad de la descarga y el
   proceso huérfano CONSERVA `/var/lib/dpkg/lock-frontend`, así que los intentos 2 y 3 morían al
   instante con `Could not get lock ... It is held by process N`. Reintentaba contra un lock que el
   propio timeout dejaba tomado.
2. **Intento 2 (el bueno):** `liberar_apt()` antes de cada reintento — mata `apt-get`/`dpkg` por
   **nombre exacto** (`pkill -x`, deliberadamente NO `-f`, para no arriesgarse a matar el propio shell
   del step), espera con `fuser` a que `lock-frontend` quede libre (máx. 60 s) y repara estado parcial
   con `dpkg --configure -a`. Además se subieron los márgenes, porque el fallo real **no era un cuelgue
   sino lentitud**: el log muestra `apt` tardando ~2 min en bajar un solo paquete de fuentes, de 21 MB
   totales. Playwright: 420 s por intento. `apt-get` de Trivy: 240/300 s.

**El gate NO se relaja.** Si tras 3 intentos no hay Trivy o no hay Chromium, el step FALLA (`exit 1`).
Nunca se continúa sin escanear ni sin navegador. `timeout-minutes` (20 en SAST, 25 en E2E) es un tope
duro frente al default de 6 h de Actions.

**Criterio para reintentar un job en el futuro.** Relanzar es legítimo SOLO cuando el job murió o se
colgó **antes** de ejecutar la verificación (setup del entorno, instalación de herramientas, checkout).
Si el escaneo o los tests llegaron a correr y fallaron, eso es un hallazgo real y se diagnostica — no
se relanza. Los cuatro reintentos de esta noche caen todos en el primer caso, y en ninguno se cambió
el commit entre intentos.

---

## 23. Encendido del proveedor de PAGA (cartas) y del sellado TCGCSV — intento de ejecución 2026-08-18

> **Estado honesto: NO EJECUTADO desde la sesión de devops.** Ninguna de las dos palancas se movió:
> `POKEMONPRICETRACKER_MARKET_FORMAT` sigue **sin fijar** en Railway, el dial `price_provider` sigue en
> `pokemontcg_io` y `sealed_price_source` sigue en `off`. Esta sección documenta **por qué** (bloqueo de
> acceso, no de conocimiento), **qué sí se verificó** y deja el **guion exacto** para que lo corra quien
> tenga las credenciales. Cross-ref: §19.5 (runbook original del flip), §19.7 (rollback), §21 (sellado).

### 23.1 Por qué no se pudo ejecutar (bloqueos verificados, no supuestos)

| Bloqueo | Evidencia |
|---|---|
| **Sin acceso a Railway** | No hay `railway` CLI ni `RAILWAY_TOKEN` en el entorno de la sesión (`which railway` → nada; `env` sin variables de Railway). Fijar `POKEMONPRICETRACKER_MARKET_FORMAT` y `SEALED_PRICE_INGEST_CRON` es **dashboard de Railway**, no repo. |
| **Sin credenciales `super_admin`** | Los diales (`PUT /admin/settings`) y los disparos (`POST /admin/jobs/*`) exigen bearer de `super_admin`. La sesión no tiene ni token ni el `NEXT_PUBLIC_API_BASE_URL` real del backend en prod (en el repo solo hay placeholders `api.tudominio.com`). |
| **Egress bloqueado hacia la app** | El proxy de la sesión rechaza el CONNECT a producción: `403 … "host":"www.tcgvaultmx.com:443"` (`$HTTPS_PROXY/__agentproxy/status` → `recentRelayFailures`). Aun con token, **no se puede llamar a prod desde aquí**. La red de la sesión solo abre registries + GitHub. |

> Consecuencia: los pasos 2–6 de la Tarea A y todo §21 los ejecuta **el humano** (o una sesión con
> credenciales). Abajo va el guion copiable, con los criterios de go/no-go y qué traer de vuelta.

### 23.2 Lo que SÍ se verificó desde aquí (precondición de código)

- **El código de WS-A está en las dos ramas relevantes:** `main` @`915210d` y `production` @`5422bae`
  contienen `backend/src/jobs/price-ingest.service.ts`, `backend/src/modules/pricing/price-ingest.service.ts`,
  el provider de paga con el **candado** `POKEMONPRICETRACKER_MARKET_FORMAT` (fail-closed → `sample-only`,
  `pokemonpricetracker-bulk.provider.ts:84,112`), el sellado TCGCSV (`tcgcsv-sealed.provider.ts`,
  `sealed-price-ingest.service.ts`) y la migración **M-23** (`20260817140000_m23_sealed_tcgcsv`).
- **Railway auto-despliega desde `main`** (HANDOFF §3) y `deploy.yml` **no** corre solo (§16.4): el deploy
  real es la integración nativa de Railway, no GitHub Actions.
- ✅ **CONFIRMADO en runtime 2026-08-18 06:24 UTC** (deploy logs de Railway aportados por el PO, servicio
  `tcg-vault-mx-production.up.railway.app`, deploy `Active`): el backend en producción **SÍ tiene WS-A y
  v1.19**. Evidencia directa: rutas `Mapped {/api/v1/admin/jobs/price-ingest, POST}` y
  `Mapped {/api/v1/admin/jobs/sealed-price-ingest, POST}`; `Scheduler: conexión Redis lista (BullMQ
  operativo).`; `Scheduler activo (BullMQ): … + price-ingest 2×/día (00:00 y 12:00 UTC, dial
  pokemontcg_io) + sealed-price-ingest diario (21:30 UTC, dial sealed_price_source, seed off) +
  catalog-metadata-sync diario`; y `price-ingest catch-up: hay ingesta reciente (hoy/ayer); no se encola.`
  **El scheduler está vivo, los dos crons están registrados y los dos diales están en su seed.** La
  precondición del §23.2 queda cumplida: se puede proceder con §23.4 y §23.5.
- ⚠️ **Detalle sin resolver (menor):** Railway reporta el commit **`9cb1534a`**, que **no existe** en el
  repo (`git cat-file` y la API de GitHub → `422 No commit found`); probablemente una rama borrada tras
  merge. No bloquea: las rutas y la línea del scheduler prueban que el binario desplegado incluye WS-A +
  v1.19. Si se quiere trazabilidad exacta, re-desplegar desde `main` deja el commit identificable.
- **NO verificable desde aquí (lo primero que debe mirar el humano):** que el **último deploy de Railway
  haya quedado verde y esté sirviendo ese commit**. Tras el día de CI/deploy con problemas (§22), esto no
  se puede asumir. Verificación mínima, en este orden:
  1. Railway → servicio `backend` → **Deployments**: el último `Success` y su commit = `915210d` (o posterior).
  2. `GET /api/v1/health` → `200`, componente **Redis `up`** (§20.2).
  3. Deploy logs con `Scheduler: conexión Redis lista (BullMQ operativo).` + `Scheduler activo (BullMQ): …`
     y una línea de **catch-up** de `price-ingest` (§20.2.1). **Si el scheduler no está vivo, ningún cron
     corre y nada de lo de abajo se programa solo** — se puede seguir, pero todo queda a disparo manual.
  Si el backend en prod es viejo (sin `price-ingest` cableado), **PARAR**: no es un problema de config, es
  un deploy pendiente → se reporta y se re-despliega antes de tocar diales.

### 23.3 Corrección a §19.5 y §21 — dónde vive REALMENTE cada dial (hallazgo de esta sesión)

Los runbooks decían "panel M10". Verificado contra el código del front, **no es exacto**:

| Palanca | Dónde está de verdad | Nota |
|---|---|---|
| `priceProvider` (dial del ingest masivo) | **Admin M2**, sección "proveedor de la ingesta masiva" (`M2View.tsx:197-213`, `updatePriceProvider`) | **NO** está en M10: `M10View.tsx` `DIALS[]` no lo lista. Lo que M10 sí tiene es `pricingProviderRaw/Graded/Sealed`, que es **otro** dial (referencia por-carta), fácil de confundir. |
| Disparo `price-ingest` **completo** | Admin M2, botón junto al selector (`triggerPriceIngest()`) | Dispara **sin `setId`** → barre TODO el catálogo. |
| Disparo `price-ingest` de **UN set** (`{setId}`) | **Solo API** (`POST /admin/jobs/price-ingest {"setId":"…"}`) | El front no expone el `setId` → la corrida de blast-radius contenido de §19.5 **exige curl**. |
| `sealedPriceSource` (dial del sellado) | **Sin UI en ningún módulo** (`grep sealedPriceSource frontend/src` → 0 hits) | Tarea B es **100% por API**. |
| Curación de mapeo sellado (`/admin/pricing/sealed/*`) | **Sin UI** (`M2View.tsx` no consume esos endpoints) | Sin mapeos, el ingest de sellado **no escribe nada** (§23.5). |

> **Hallazgo enrutado a `frontend`** (dueño de `frontend/`; devops no lo toca): faltan en el admin (a) el
> dial `sealedPriceSource`, (b) el explorador/curación TCGCSV de sellado (`unmapped` → `groups` →
> `products` → `PUT mapping`) y (c) el `setId` opcional en el disparo de `price-ingest`. El contrato ya
> los define (`API_CONTRACT` §M2 sealed-tcgcsv y §M10/§M10-ops) y `api.ts` ya tiene `updatePriceProvider`.
> Mientras tanto, ambas tareas se operan por API con token `super_admin`.

### 23.4 Guion Tarea A — flip a `pokemonpricetracker` (variante aprobada por el PO)

> **Desviación respecto de §19.5, decidida por el PO:** el formato se fija **`usd_dollars` de entrada**,
> **sin** el paso intermedio de leer el log de muestra (§19.5 pasos 2-4). Queda escrito que es una
> decisión del PO, no un olvido del runbook. El riesgo que cubría ese paso (payload en MXN → precios
> **~18× inflados**) se traslada al **chequeo de salida del paso 4 de abajo**, que es OBLIGATORIO y
> tiene acción correctiva definida. El ingest es idempotente por día, así que un error del formato se
> corrige re-corriendo el set con el formato bueno.

Prerrequisitos: haber pasado §23.2 (deploy nuevo + Redis/scheduler vivos) y tener `BASE` (base URL del
backend en prod, `…/api/v1`) y `TOKEN` (bearer de `super_admin`).

1. **Railway → servicio `backend` → Variables:** confirmar `POKEMONPRICETRACKER_API_KEY` presente y
   añadir **`POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars`**. Railway redespliega solo al cambiar
   variables; si no, redeploy manual. **Esperar a que el deploy quede `Success` antes de seguir** (la env
   se lee en runtime: sin el nuevo deploy el proveedor sigue en `sample-only`).
2. **Flip del dial** (sin redeploy) — en el admin **M2** (no M10), o por API:
   ```bash
   curl -sS -X PUT "$BASE/admin/settings" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' -d '{"priceProvider":"pokemonpricetracker"}' | jq .
   # verificar:
   curl -sS "$BASE/admin/settings" -H "Authorization: Bearer $TOKEN" | jq '.priceProvider'
   ```
3. **Corrida de UN set** (blast radius contenido; usar el set que el PO está probando — el `setId` real se
   saca de `GET $BASE/catalog/sets`, es el id del proveedor de catálogo, p. ej. `sv8`):
   ```bash
   curl -sS -X POST "$BASE/admin/jobs/price-ingest" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' -d '{"setId":"sv8"}' | jq .     # 202 {scope:"set", …}
   ```
4. **Verificar la salida ANTES del rollout** (esto no es un gate de aprobación, es leer el resultado):
   - **Rango sano:** una carta de **~$10 USD** debe quedar en **~180–220 MXN** ya con FX+colchón.
     Se ve en la ficha pública de la carta (deja de decir "Precio pendiente") o en el admin M2.
   - **Acabados mapeados:** que no todo quede en `normal` (debe haber `reverse_holo`/`holofoil` donde aplique).
   - **Cobertura:** `GET $BASE/admin/dashboard` → `dataHealth.pendingPriceCount` debe **bajar** y
     `lastPriceSyncAt` ser de hoy; en logs, `price-ingest-set(<setId>, pokemonpricetracker): X cartas,
     Y refs, …` con `skipped` bajo.
   - 🚨 **Si los precios salen ~18× inflados (una carta de $10 USD en ~3,600 MXN):** el payload venía en
     **MXN**. Corregir `POKEMONPRICETRACKER_MARKET_FORMAT=mxn_dollars` en Railway (+ redeploy), re-correr
     el mismo set (paso 3) y re-verificar. **Avisar al PO del hallazgo** — es exactamente el caso que el
     paso del log de muestra cubría. No requiere cambio de código.
   - Si no cuadra con **ninguno** de los 4 formatos (`usd_dollars`/`usd_cents`/`mxn_dollars`/`mxn_cents`):
     **rollback por dial** a `pokemontcg_io` (§19.7) y enrutar a **backend**.
5. **Rollout completo** (solo si el paso 4 cuadró):
   ```bash
   curl -sS -X POST "$BASE/admin/jobs/price-ingest" -H "Authorization: Bearer $TOKEN" | jq .
   ```
   o dejar que lo hagan los crons 2×/día (`PRICE_INGEST_CRON_1/_2`, 06:00 y 18:00 CDMX, §19.3).
6. **Después:** si se quiere la gráfica del home con datos frescos, `POST /admin/jobs/set-value-snapshot`
   una vez tras el ingest (§19.9).

**Rollback money-safe (cualquier momento):** dial `priceProvider` → `pokemontcg_io` desde M2/API, **sin
redeploy** (§19.7). No se tocan `BUYLIST_PRICE_RULES` ni `BUYLIST_PRICE_FALLBACK_PCT`: este trabajo cambia
**solo el proveedor de la referencia de mercado**, nunca la regla que se le aplica encima.

### 23.5 Guion Tarea B — encender el sellado por TCGCSV (§21)

**Lo que hay que entender antes:** el cron **no basta**. El job recorre `InventoryItem` con
`productType='sealed'` **y mapeo TCGplayer no nulo** (`sealed-price-ingest.service.ts:60`). **Sin mapeos
curados, el ingest corre y escribe cero referencias** — no es un fallo, es que no hay a qué apuntar. Y la
curación **no tiene UI** (§23.3), así que hoy es por API.

1. **Railway → `backend` → Variables:** `SEALED_PRICE_INGEST_CRON` — el default del código ya es
   `30 21 * * *` (21:30 UTC = 15:30 CDMX, después del refresh diario de tcgcsv.com y del `fx-refresh`).
   **Solo hay que fijarla si se quiere otro horario**; ponerla vacía es peor que no ponerla (§19.3).
2. **Curar 1–2 mapeos** (mínimo para probar):
   ```bash
   curl -sS "$BASE/admin/pricing/sealed/unmapped" -H "Authorization: Bearer $TOKEN" | jq '.data[] | {inventoryItemId, folio, sealedSubtype}'
   curl -sS "$BASE/admin/pricing/sealed/tcgcsv/groups?q=surging" -H "Authorization: Bearer $TOKEN" | jq '.data'
   curl -sS "$BASE/admin/pricing/sealed/tcgcsv/groups/<GROUP_ID>/products?q=elite" -H "Authorization: Bearer $TOKEN" | jq '.data'
   curl -sS -X PUT "$BASE/admin/pricing/sealed/items/<ITEM_ID>/mapping" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' \
        -d '{"tcgplayerProductId":<PID>,"tcgplayerGroupId":<GROUP_ID>,"applyToSiblings":true}' | jq .
   ```
   (`applyToSiblings:true` copia el mapeo a las otras copias físicas del mismo producto sin mapeo.)
3. **Flip del dial** (fail-closed `off` → `tcgcsv`; sin UI, por API):
   ```bash
   curl -sS -X PUT "$BASE/admin/settings" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' -d '{"sealedPriceSource":"tcgcsv"}' | jq '.sealedPriceSource'
   ```
4. **Corrida acotada a un grupo** y verificación:
   ```bash
   curl -sS -X POST "$BASE/admin/jobs/sealed-price-ingest" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' -d '{"groupId":<GROUP_ID>}' | jq .
   ```
   - Logs: resumen con `grupos`/`referencias` + contadores `fetchedRaw/skipped/usedFallbackMid/unmatched`.
   - Datos: en el admin **M1** el item sellado mapeado muestra **`sealedMarketRef` poblado** (deja de ser
     `null`), coherente con el FX del día.
   - Señales de problema: `502 UPSTREAM_ERROR` (tcgcsv caído o egress bloqueado) o `unmatched` alto
     (mapeos apuntando a productIds que no existen en ese grupo).
   - **Esta es la primera corrida contra el payload real** (los tests usan fixtures porque dev bloquea
     tcgcsv.com, §21.4). Si el esquema difiere → **hallazgo a backend**, no se parchea aquí.
5. **Rollback:** dial `sealedPriceSource` → `off` (sin redeploy). Las filas ya escritas quedan inertes:
   son referencia informativa, nadie las consume para publicar ni valuar (§21.3).

**Independencia de los dos adapters — verificada en código, uno no pisa al otro:**

| | Cartas sueltas (Tarea A) | Sellado (Tarea B) |
|---|---|---|
| Dial | `price_provider` (`pokemonpricetracker`) | `sealed_price_source` (`tcgcsv`) |
| Job / cron | `price-ingest` (+`-set`), `PRICE_INGEST_CRON_1/_2` | `sealed-price-ingest`, `SEALED_PRICE_INGEST_CRON` |
| `PriceReference.source` | `pokemonpricetracker` (`pokemonpricetracker-bulk.provider.ts:61`) | `tcgcsv` (`tcgcsv-sealed.provider.ts:74`) |
| Filas que toca | `productType` raw, por `(cardId, finish)` | `productType='sealed'` **con mapeo** (`sealed-price-ingest.service.ts:60,107`) |

Escriben en la misma tabla pero **nunca en la misma fila** (clave única distinta por `productType`/`gradeKey`),
y cada uno tiene su propio dial de apagado. Encender o apagar uno no afecta al otro.

### 23.6 Qué falta del lado del humano (checklist accionable)

- [ ] **Confirmar el deploy de prod** (§23.2): último deploy `Success` en Railway con commit ≥ `915210d`,
      `/api/v1/health` con Redis `up`, y las líneas de scheduler + catch-up en logs. **Si esto falla, parar.**
- [ ] **Traer de vuelta**, si se quiere que devops continúe: (a) base URL real del backend en prod,
      (b) confirmación de que existe la env `POKEMONPRICETRACKER_API_KEY`, (c) las 3 líneas de log del
      arranque del scheduler, (d) el `setId` exacto del set "Pitch Black" que el PO está probando.
- [ ] **Ejecutar §23.4** (Railway var + flip en M2 + corrida de un set + verificación de rango) y
      **§23.5** (mapeos + dial + corrida por grupo).
- [ ] **Reportar el resultado del chequeo de rango** del paso 4 de §23.4 — es el único punto donde el
      atajo aprobado por el PO (fijar `usd_dollars` sin leer la muestra) se paga o se cobra.
- [ ] **Frontend** (otro rol): exponer en el admin el dial `sealedPriceSource`, la curación TCGCSV del
      sellado y el `setId` del disparo de `price-ingest` (§23.3).

### 23.7 Hallazgo 2026-08-18 — pokemontcg.io está caído (500/502) y por eso el catálogo sigue sin precios

Los deploy logs del 18/08 (06:30–06:32 UTC) muestran el job `set-price-sync` recorriendo el set destacado
carta por carta contra pokemontcg.io y recibiendo **HTTP 500/502 en prácticamente todas**:

```
WARN [PokemonTcgIoProvider] pokemontcg.io me5-2  -> HTTP 502
WARN [PokemonTcgIoProvider] pokemontcg.io me5-3  -> HTTP 500
…  (≈100 líneas, todo el set)
LOG  [SetPriceSyncJobService] set-price-sync: set 7b1e3f3b-…-51031b2c1db1 → 0/120 cartas con precio del día.
```

**Lectura operativa — esto cambia la urgencia del flip:**

1. **El fix de Redis (§20) funcionó.** El scheduler corre, los crons disparan y los jobs completan
   (`Job set-price-sync (…) completado.`). El catálogo sin precios **ya no es culpa del scheduler**.
2. **La causa viva es el proveedor:** con el dial en `pokemontcg_io`, la fuente **está devolviendo 5xx** →
   `0/120` cartas preciadas. Ningún ajuste de devops arregla eso: es un upstream de terceros caído o
   rate-limiteando con 5xx. **Flipear a PokemonPriceTracker (§23.4) no es solo el plan del PO: hoy es la
   única vía que puede poblar precios.**
3. **Money-safe intacto:** el ingest **no borra** precios al fallar (los deja stale) y `set-price-sync` no
   escala pendientes. El daño es cobertura cero, no precios malos.

**Hallazgo colateral — `set-price-sync` NO se apaga con el flip (enrutado a `backend`):**

El dial `price_provider` gobierna **solo** el ingest masivo (`price-ingest`). El job `set-price-sync`
(cron `30 6 * * *`, `scheduler.service.ts:158`) va por otra ruta: `PricingService.syncCardPrice` →
`providerFor()` → dial **`pricing_provider_raw`** (M10), cuyo seed es `pokemontcg_io`
(`settings.constants.ts:76`). Y **no hay alternativa**: el `PokemonPriceTrackerProvider` **por-carta** es
un **STUB** que siempre devuelve `null` y además **solo declara `supports('graded'|'sealed')`**
(`graded-sealed.providers.ts:19-31`) — la integración real de paga vive únicamente en el adapter **bulk**.
Consecuencias:

- Poner `pricingProviderRaw=pokemonpricetracker` en M10 **empeoraría** la situación (ningún provider
  matchea `raw` → todo pendiente, sin siquiera intentar). **NO tocar ese dial.**
- Tras el flip de §23.4, `set-price-sync` **seguirá** golpeando pokemontcg.io a las 06:30 UTC y llenando
  los logs de WARN. Es **ruido inocuo** (no borra ni corrompe), pero es trabajo desperdiciado: según
  ARCHITECTURE §4.15g, `price-ingest` **subsume** a `set-price-sync` (el ingest precia todo el catálogo,
  incluido el set del hero).
- **Solicitud a `backend`** (es código de `backend/src/jobs/scheduler.service.ts`, no config de devops):
  retirar `set-price-sync` del schedule —o repuntarlo a leer las `PriceReference` ya ingestadas— una vez
  que el flip esté verificado. Devops no lo toca (regla de propiedad de archivos). Mientras tanto no
  bloquea nada.

### 23.8 Estado de las variables en Railway (verificado 2026-08-18) y la trampa de `PRICE_PROVIDER` como env

Captura de **Railway → `backend` → Variables** (31 service variables) aportada por el PO:

- ✅ **`POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars`** — el candado money-safe ya está **abierto**. El
  paso 1 de §23.4 está HECHO (queda confirmar que el deploy posterior al cambio terminó `Success`: la env
  se lee en runtime).
- ✅ `POKEMONPRICETRACKER_API_KEY` presente. 🚨 **Se expuso en claro en la captura → ROTAR** en el portal
  del proveedor y actualizar el valor en Railway. El valor NO se transcribe aquí ni en ningún archivo del
  repo (§15.2). Rotarla no afecta al runbook: es la misma variable, otro valor.
- ⚠️ **`PRICE_PROVIDER` existe como variable de Railway — y NO flipea el proveedor.** Es un punto de
  confusión real, así que queda escrito: esa env es **solo un HINT de arranque** para `env.validation.ts:48`
  (si vale `pokemonpricetracker`, el backend exige `POKEMONPRICETRACKER_API_KEY` al boot y falla rápido si
  falta). **La autoridad en runtime es el ConfigSetting `price_provider`**, que el ingest lee en cada
  corrida (`price-ingest.service.ts:56`, `settings.getString(SettingKey.PRICE_PROVIDER)`). Ningún código
  lee `process.env.PRICE_PROVIDER` para elegir proveedor (grep exhaustivo: 0 hits fuera de la validación).
  → **Poner `PRICE_PROVIDER=pokemonpricetracker` en Railway deja el sistema con el candado abierto pero el
  proveedor todavía en `pokemontcg_io`** (es decir, ingiriendo de la fuente que hoy devuelve 5xx, §23.7).
  El flip de verdad es el paso 2 de §23.4: admin **M2** o `PUT /admin/settings {"priceProvider":…}`.

> Ambigüedad de nombres a tener presente: `PRICE_PROVIDER` (env, hint de boot) ≠ dial `price_provider`
> (ConfigSetting, autoridad) ≠ `pricing_provider_raw/graded/sealed` (M10, ruta por-carta, §23.7). Tres
> cosas distintas con nombres casi idénticos; solo la segunda decide de dónde salen los precios del ingest.

### 23.9 Causa probable de "0 refs": el adapter llama al endpoint bulk con un cuerpo que ese endpoint no acepta

**Síntoma (PO, 18/08):** con el dial ya en `pokemonpricetracker` y `MARKET_FORMAT=usd_dollars`, el cotizador
sigue mostrando **"Precio pendiente"** en las cartas cuya regla de rareza es `pct` (las de regla `fixed`
muestran su piso y **enmascaran** el problema — `money.ts:206-208`). El PO verificó que el proveedor **sí
tiene precios** para ese set. Es decir: el dinero está pagado, los datos existen, y no llegan a la BD.

**Hallazgo (devops, verificado contra la documentación pública del proveedor — el egress de la sesión
bloquea el dominio, así que la fuente son las páginas de doc/API-reference indexadas, NO una corrida real):**

| | Lo que hace el adapter (`pokemonpricetracker-bulk.provider.ts:140-147`) | Lo que documenta el proveedor |
|---|---|---|
| Endpoint | `POST /api/v1/cards/bulk-price` | `POST …/cards/bulk-price` **existe**, pero su cuerpo es `{ cardIds: ["base1-4", …], includeHistory }` — una **lista explícita de ids**, no un filtro |
| Cuerpo enviado | `{ set: <CardSet.externalId>, limit: 250, page: N }` | ese endpoint **no documenta** `set`/`limit`/`page` |
| "Todas las cartas de un set" | — | `GET /api/prices?setId=<ids,coma>&limit=1000` → `{ data: [...], pagination: { total, page, limit } }` |
| Campos de precio | busca `market`/`marketPrice`/`price` | `marketPrice`, `lowPrice`, + `setId`, `cardNumber`, `rarity`, `printing`, `lastPriceUpdate` |

Los tres `SUPUESTO (verificar 1ª corrida)` que el propio adapter dejó escritos (líneas 65, 146, 157) son
exactamente los que fallan. Con un cuerpo que el endpoint no reconoce, `fetchPage` recibe un `!res.ok` →
`throw HTTP <code>` → lo captura el `catch` money-safe → **devuelve 0 filas sin borrar nada** → cero
`PriceReference` → todo lo `pct` queda pendiente. El síntoma encaja al 100%.

**Confirmación en una línea de log** (Railway, filtro `PokemonPriceTracker`):
`PokemonPriceTracker bulk: set <id> falló: HTTP 400/404 … Se devuelven 0 filas`. Si en cambio apareciera
la línea `ejemplo de entrada cruda`, el request sí pasó y el problema sería de mapeo, no de endpoint.

**ENRUTADO A `backend`** (dueño de `backend/src/modules/pricing/providers/**`; devops no toca código de app,
regla de propiedad de archivos). Alcance del cambio, acotado:

1. `fetchPage`: cambiar a **`GET /api/prices?setId=<externalId>&limit=<N>&page=<n>`** con el mismo
   `Authorization: Bearer`, y paginar por `pagination.total/page/limit` en vez de por "página incompleta".
   Alternativa equivalente: seguir con `bulk-price` pero enviando `cardIds` construidos desde las `Card`
   locales del set (más requests y más frágil; preferible la primera).
2. `extractEntries` **ya sirve** (`{ data: [] }` está contemplado). `mapEntry` shape (B) **ya lee**
   `marketPrice` y `printing`/`variant` → probablemente no requiere cambios.
3. `resolveCardId` (`price-ingest.service.ts:193`) resuelve por `externalId` y cae a `(set, number)`:
   verificar contra el `cardNumber` real del proveedor (formato `"104"` vs `"104/159"`).
4. Confirmar la unidad de `marketPrice` (dólares) contra el log de muestra: si es dólares, el
   `MARKET_FORMAT=usd_dollars` ya fijado es correcto y no hay que tocar Railway.
5. Verificar el tope real de `limit` (la doc de marketing menciona 100 por request en el bulk y 1000 en
   `/api/prices`) y ajustar `pageLimit`/`maxPages`.

> Nota de honestidad: esto es **causa probable, no verificada en runtime**. La confirmación barata es la
> línea de log de arriba; la definitiva, una corrida tras el fix. Ninguna palanca de devops (dial, env,
> cron) puede arreglarlo: el request sale mal formado desde el código.

---

## 24. Force re-sync de catálogo/acabados — dato stale de `availableFinishes` (2026-08-19, stream `claude/pulido-precios-display`)

> **Runbook operativo (no de código).** Documenta cómo forzar el re-procesado del catálogo para repoblar
> acabados (`availableFinishes` / `catalogFinishes`) cuando una carta aparece con acabados incompletos
> (p. ej. solo "Normal", sin Reverse Holo). **No es un bug** — es dato heredado que requiere un re-sync
> **forzado**. Verificado contra el código en esta sesión. Cross-ref: N-15, §18 (metadata/manual sync),
> §19 (ingest de precios PPT).

### 24.1 Por qué pasa (contexto N-15)

El PO reporta cartas (p. ej. **Tropius**) que aparecen **solo con "Normal"** y **sin Reverse Holo**.
Diagnóstico **confirmado**:

- **NO es bug de código.** El mapeo `reverseHolofoil → reverse_holo` y la ingesta de su precio son
  **correctos**.
- La causa es **dato stale**: cartas/sets **importados antes** del trabajo de acabados conservan el
  default legacy **`availableFinishes=[normal]`** hasta que se corre un **re-sync FORZADO**.
- La columna **`catalogFinishes`** (proveniente de pokemontcg.io) **solo se recomputa al forzar**.
- **"Actualizar precios"** (price ingest PPT, §19) **NO repuebla acabados de catálogo** — es **otra
  operación** distinta; refresca `PriceReference`, no `availableFinishes`.

### 24.2 Cómo forzar el re-sync (dos vías, ambas ya existentes)

**Vía 1 — UI admin (recomendada para el PO):**

- Panel **M2** → botón **"Re-sincronizar todo (forzar)"** ("Re-sync everything (force)" en EN).
- Pide **confirmación** (operación **pesada**): reprocesa **TODO** el catálogo, incluidos sets **ya
  importados**, y repuebla `availableFinishes` / precios por acabado.
- Corre en **segundo plano**; el progreso se ve en la **barra de estado de catálogo**
  (`GET /admin/catalog/sync-status`).
- **Diferénciala** de:
  - **"Importar sets nuevos"** → `force:false`, operación **ligera** (solo sets nuevos, §18).
  - **"Actualizar precios"** → ingest PPT (§19), **no toca acabados**.

**Vía 2 — API directa:**

- `POST /admin/catalog/sync-all` con body `{ "force": true }` (o query `?force=true`).
- **Auth admin** requerida.
- Progreso: `GET /admin/catalog/sync-status`.

### 24.3 Notas operativas

- **Idempotente y money-safe:** repuebla `availableFinishes` (whitelist **SEC-A1**) desde pokemontcg.io;
  **no borra dinero** ni `PriceReference` existentes.
- **Relación con N-15:** la supresión de la casilla `'normal'` espuria (`displayFinishes`, §4.22a-6) es
  **DISPLAY-only** y **NO sustituye** a este force-sync. El Reverse Holo **real** de las normales aparece
  **solo tras repoblar acabados** con datos frescos de PPT (o si ya estaban frescos).
- **Ejecución:** el **PO corre el force-sync por su lado** (UI M2, vía 1) **tras el merge del stream**
  `claude/pulido-precios-display`. Devops no puede dispararlo desde la sesión (sin credenciales admin ni
  egress a prod, cf. §23.1).

---

## 25. P-21 — Rebrand a `tcghunt.mx`: infra, redirects 301 y runbook del switch (2026-08-21)

> ⚠️ **PARCIALMENTE SUPERADA POR §34 (2026-08-31). Lee §34 antes de ejecutar nada de aquí.**
> Dos cosas de esta sección dejaron de ser ciertas:
> 1. **La fila `MAIL_FROM` de §25.5 («sin fijar») NO es fiable**: se escribió sin evidencia y
>    contradice a `HANDOFF.md` §3, que la da por fijada. §34.4 documenta la contradicción y cómo
>    resolverla en 2 minutos.
> 2. **El supuesto del 301 desde el dominio viejo (§25.2) decayó**: `PROJECT.md` decisión 58
>    declara los dominios anteriores **retirados/inexistentes**. No hay dominio vivo que sirva un
>    301, ni origen que allow-listear en CORS.
>
> El resto (inventario, DNS, Stripe, R2, OAuth, rollback) sigue siendo referencia válida.
> Se conserva como registro histórico del plan; **§34 es la fuente de verdad del switch de correo**.

> **Contexto (histórico, ago-2026):** el humano YA compró `tcghunt.mx` (PENDIENTES P-21). Hoy producción sirve en
> `tcgvaultmx.com` (frontend en **Vercel**, canónico `www.tcgvaultmx.com`; apex redirige a `www`;
> DNS en **Cloudflare, DNS only/nube gris** — HANDOFF §3). El backend vive en **Railway** con su
> **propio dominio** `tcg-vault-mx-production.up.railway.app` (§23.2) — el rebrand **no** lo toca.
> **Todo lo de esta sección es ADITIVO**: nada de lo pre-configurable rompe el entorno actual;
> el switch real (paso 25.6-B) lo ejecuta el humano en una ventana, con rollback definido.
> El **nombre interno NO cambia** (repo/servicios siguen `tcg-vault-mx`, DESIGN_SYSTEM §17.4).

### 25.1 Inventario — dónde vivía el dominio viejo en rutas de infra (grep `tcgvaultmx`, 2026-08-21)

| Dónde (archivo:línea al día del grep) | Qué es | Acción |
|---|---|---|
| `.env.example` — `APP_BASE_URL` (comentario, ~l.73), `DISPUTE_EVIDENCE_CONTACT` (~l.193), `TARGET_URL` DAST (~l.511) | Comentarios/placeholder con dominio viejo; faltaba documentar `RESEND_API_KEY`/`MAIL_FROM` | **ACTUALIZADO hoy**: lista objetivo de `APP_BASE_URL` con `tcghunt.mx`, bloque nuevo de correo Resend/`MAIL_FROM`, notas P-21 en disputa y DAST |
| `security/scripts/dast-zap-baseline.sh:26`, `dast-zap-full.sh:23`, `dast-nuclei.sh:22`, `dast-extra.sh:29` | Guardia anti-prod: solo reconocía el placeholder `tudominio.com` — **ninguno de los dos dominios reales disparaba la guardia** | **ACTUALIZADO hoy**: la guardia reconoce `tcgvaultmx.com` **y** `tcghunt.mx` como producción (verificado: exit 2 sin `ALLOW_PROD_DAST=1`; `staging.*` pasa) |
| `security/README.md:100` (Guardia anti-producción) | Documentación de la guardia | **ACTUALIZADO hoy**: lista los dominios reales |
| `.github/workflows/*` (ci, e2e, e2e-real, deploy, security-*) | **CERO referencias hardcodeadas** al dominio: los targets van por secrets `STAGING_BASE_URL`/`PROD_BASE_URL` | Sin cambio de archivo; el día del switch se actualiza el **GitHub Secret** `PROD_BASE_URL` (§25.6-B) |
| `docker-compose.yml:183`, `docker-compose.staging.yml:176` | Comentario: default backend `soporte@tcgvaultmx.com` | Sin cambio: sigue siendo verdad hasta que **backend** cambie su default (P-21); entonces devops actualiza el comentario |
| `docs/DEVOPS_NOTES.md` §4 (~l.167), §11.B (~l.580, ~l.865), §11.D (~l.630), §23.1 (~l.2093) | Runbooks históricos con el dominio viejo | Se conservan como histórico; esta §25 es la fuente de verdad del rebrand |
| Dashboards (no repo): Railway `APP_BASE_URL`, `MAIL_FROM`, `DISPUTE_EVIDENCE_CONTACT`; R2 CORS del bucket `tcg-kyc-ine`; Google OAuth origins; Resend dominio; Cloudflare Email Routing; GH Secret `PROD_BASE_URL`; Stripe branding | Valores vivos con el dominio/buzones viejos (HANDOFF §3) | Runbook §25.6 (pre-switch aditivo + ventana) |
| **Fuera de rutas devops** (inventario informativo, NO lo toca devops): `backend/src/modules/mail/mail.module.ts` (default `no-reply@tcgvaultmx.com`), `disputes.constants.ts`, `buylist-mail.templates.ts`, `guest-checkout.constants.ts` (buzones hardcodeados), `frontend/messages/{es,en}.json` y componentes con `contacto@/soporte@/facturacion@tcgvaultmx.com` | Marca/buzones en código | **Handoff P-21 a backend y frontend** (ya en alcance de PENDIENTES P-21 y DESIGN_SYSTEM §17.4) |

### 25.2 Redirects 301 — dónde se implementan (decisión)

El dominio viejo y el nuevo apuntan **al mismo proyecto de Vercel**; los 301 se hacen en Vercel.
Hay dos mecanismos válidos — **usar UNO, no ambos a la vez** (para poder razonar el rollback):

1. **Dashboard de Vercel (recomendado para la ventana del switch):** Proyecto → Settings → Domains →
   en `tcgvaultmx.com` y `www.tcgvaultmx.com` elegir **"Redirect to"** → `www.tcghunt.mx` con **status 301**.
   Preserva path y query string. Ventajas: sin deploy, reversible al instante (quitar el redirect),
   independiente del código. Desventaja: no queda versionado en el repo.
2. **`frontend/vercel.json` (versionado):** el Root Directory del proyecto Vercel es `frontend/`
   (§11.A), así que el archivo de config vive en **`frontend/vercel.json`** → es **ruta del rol
   frontend**, devops NO lo escribe. Contenido exacto en §25.7 (handoff). OJO: en cuanto ese archivo
   se mergee y despliegue, el 301 queda ACTIVO — se mergea **en la ventana del switch**, no antes.

**Mapa de redirects (convención actual www-canónico, HANDOFF §3):**

| Origen | Destino | Código |
|---|---|---|
| `tcgvaultmx.com/*` (path+query) | `https://www.tcghunt.mx/*` | 301 |
| `www.tcgvaultmx.com/*` (path+query) | `https://www.tcghunt.mx/*` | 301 |
| `tcghunt.mx/*` (apex nuevo) | `https://www.tcghunt.mx/*` | redirect apex→primario de Vercel (permanente; se configura al marcar `www.tcghunt.mx` como **primary**, igual que hoy con el viejo) |

Requisito para que el 301 del viejo funcione: los dominios viejos **siguen asignados** al proyecto
Vercel y su DNS **sigue apuntando** a Vercel. No se apagan: se conservan **≥ 12 meses** (SEO,
enlaces en correos ya enviados). `tcg-vault-mx.vercel.app` se deja como está (dominio técnico).

### 25.3 Stripe — qué cambia y qué NO (verificado en repo, honesto)

- **Webhook: NO cambia.** El endpoint es `POST /api/v1/webhooks/stripe` (raw body preservado en
  `backend/src/main.ts:35`; controller `backend/src/modules/payments/webhooks.controller.ts`) y lo
  sirve el **backend en Railway con su propio dominio** (`tcg-vault-mx-production.up.railway.app`,
  confirmado en runtime §23.2). En el repo/HANDOFF **no hay** ningún `api.tcgvaultmx.com` (el DNS del
  viejo solo tiene `www` + apex → Vercel, HANDOFF §3): el webhook **no** está detrás del dominio web
  y el rebrand no lo toca. **[HUMANO — verificación de 1 minuto]:** Stripe Dashboard → Developers →
  Webhooks → confirmar que el host del endpoint es `…up.railway.app`. Si (contra lo que dice el repo)
  fuera un dominio custom bajo `tcgvaultmx.com`, habría que crear endpoint nuevo + rotar
  `STRIPE_WEBHOOK_SECRET` en Railway — reportarlo antes del switch.
- **`return_url` del checkout: cambia solo.** El backend lo arma con el **primer origen** de
  `APP_BASE_URL`; al reordenar la lista el día del switch (§25.6-B) los retornos de Stripe caen en
  `www.tcghunt.mx` sin tocar Stripe.
- **Branding del dashboard (no verificable desde el repo):** nombre público del negocio, statement
  descriptor y URL en recibos pueden decir "TCG VAULT MX" → **[HUMANO]** revisarlos en Stripe →
  Settings → Business/Branding durante la ventana. No bloquea nada técnico.

### 25.4 DNS del dominio nuevo — registros a crear **[HUMANO]**

Recomendación: gestionar la zona de `tcghunt.mx` en **Cloudflare** como el dominio viejo
(consistencia + **Email Routing** para los buzones + registros de Resend en el mismo panel).
Todos los registros hacia Vercel en modo **DNS only (nube gris)** — igual que hoy (HANDOFF §3).

| Registro | Nombre | Valor | Para |
|---|---|---|---|
| A | `tcghunt.mx` (apex) | `76.76.21.21` *(usar el valor EXACTO que muestre Vercel al añadir el dominio)* | Vercel |
| CNAME | `www` | `cname.vercel-dns.com` *(ídem: copiar lo que indique Vercel)* | Vercel |
| TXT + CNAMEs | los que indique **Resend** al añadir `tcghunt.mx` | SPF/DKIM | remitente `no-reply@tcghunt.mx` |
| MX/TXT | los que configura **Cloudflare Email Routing** al activarlo | recepción | buzones `soporte@`, `contacto@`, `facturacion@tcghunt.mx` → reenvío al Gmail (como hoy, HANDOFF §3) |

**Certificados: automáticos.** Vercel emite y renueva TLS (Let's Encrypt) al validar el dominio;
no hay nada que comprar ni cargar. Única condición: el registro en Cloudflare debe quedar **DNS
only** (con proxy naranja la validación/renovación de Vercel se rompe — misma regla que ya se
aplica al dominio viejo). Railway no cambia de dominio → su TLS tampoco.

### 25.5 Variables por plataforma — nombres REALES y valores objetivo

**Railway → servicio `backend` → environment `production`** (HANDOFF §3 para los valores de hoy):

| Var (nombre real) | Hoy | Pre-switch (aditivo, seguro YA) | Día del switch |
|---|---|---|---|
| `APP_BASE_URL` | `https://tcg-vault-mx.vercel.app,https://www.tcgvaultmx.com,https://tcgvaultmx.com` | **añadir al FINAL** `,https://www.tcghunt.mx,https://tcghunt.mx` (CORS acepta el dominio nuevo; los links siguen saliendo con el viejo porque el 1º no cambió) | reordenar: `https://www.tcghunt.mx,https://tcghunt.mx,https://www.tcgvaultmx.com,https://tcgvaultmx.com,https://tcg-vault-mx.vercel.app` |
| `MAIL_FROM` | sin fijar (default de código `no-reply@tcgvaultmx.com`) | NO tocar | `TCG HUNT <no-reply@tcghunt.mx>` — **SOLO si Resend ya muestra `tcghunt.mx` Verified** |
| `DISPUTE_EVIDENCE_CONTACT` | `soporte@tcgvaultmx.com` | NO tocar | `soporte@tcghunt.mx` — **SOLO si el buzón nuevo ya recibe** (probar con un correo real) |

> Guardar variables en Railway redeploya el backend (aceptable: arranque idempotente, §11.F).
> No existe `FRONTEND_URL` ni `CORS_ORIGIN` en este backend: **la variable real es `APP_BASE_URL`**
> (lista separada por comas; allow-list CORS en `main.ts` + el 1º origen arma links de correos y
> `return_url` — verificado en `backend/src/main.ts` y `auth.service.ts`).

**Vercel → proyecto frontend:** `NEXT_PUBLIC_API_BASE_URL` **NO cambia** (apunta al dominio Railway
del backend, ajeno al rebrand); el resto de `NEXT_PUBLIC_*` tampoco referencia el dominio web. Si el
stream frontend de P-21 introduce una var de sitio (p. ej. para metadata/OG absolutas), recordar que
`NEXT_PUBLIC_*` **se hornea en build** → cargarla en Vercel exige **redeploy** (HANDOFF §3).

**GitHub Secrets:** `PROD_BASE_URL` → `https://www.tcghunt.mx` (día del switch; lo usa `deploy.yml`
si se reactiva el CD por Actions, §16.4). `STAGING_BASE_URL` sin cambio (staging no tiene dominio).

**Cloudflare R2 — CORS del bucket `tcg-kyc-ine`** (presigned PUT/GET del INE van del navegador a R2:
el origen del front DEBE estar allow-listeado, §11.B). JSON completo pre-switch (aditivo, pegar tal
cual; conserva los viejos mientras viva el redirect):

```json
[{ "AllowedOrigins": ["https://www.tcghunt.mx","https://tcghunt.mx",
                      "https://www.tcgvaultmx.com","https://tcgvaultmx.com"],
   "AllowedMethods": ["PUT","GET"],
   "AllowedHeaders": ["content-type"],
   "MaxAgeSeconds": 3600 }]
```

**Google OAuth (login con Google):** Google Cloud Console → el OAuth Client ID de
`GOOGLE_CLIENT_ID`/`NEXT_PUBLIC_GOOGLE_CLIENT_ID` → **Authorized JavaScript origins**: añadir
`https://www.tcghunt.mx` y `https://tcghunt.mx` (conservar los viejos). El Client ID no cambia.

### 25.6 Runbook de la ventana de cambio

**A) PRE-SWITCH — se puede hacer DESDE YA, nada visible cambia** *(todo aditivo)*:

1. **[HUMANO]** Crear la zona DNS de `tcghunt.mx` (Cloudflare recomendado) + registros §25.4.
2. **[HUMANO] Razón social del footer — ANTES de apuntar el dominio.** Hoy el footer sale con
   placeholder (`footer.legalEntity` = `[Razón social pendiente]` / `[Legal entity pending]` en
   `frontend/messages/{es,en}.json`). Entregar la razón social real al rol **frontend** (el archivo
   es suyo) y verificar que el cambio está mergeado y desplegado en prod **antes del paso 3**: al
   añadir el dominio en Vercel, la app queda visible en `tcghunt.mx` tal como esté — no debe
   estrenarse el dominio con un placeholder legal en el footer.
3. **[HUMANO]** Vercel → Domains: añadir `tcghunt.mx` y `www.tcghunt.mx`; marcar `www.tcghunt.mx`
   como **primary** (apex redirige a www, misma convención que hoy). Esperar cert **Valid**.
   *Efecto:* la app actual (marca vieja) ya responde también en el dominio nuevo — aceptable
   pre-lanzamiento; si molesta, este paso puede moverse al inicio de la ventana B.
4. **[HUMANO]** Railway: `APP_BASE_URL` con los dominios nuevos **al final** (§25.5) — sin esto, el
   frontend servido en `tcghunt.mx` fallaría por CORS al llamar al backend.
5. **[HUMANO]** R2: pegar el JSON de CORS de §25.5.
6. **[HUMANO]** Google OAuth: añadir los origins nuevos.
7. **[HUMANO]** Resend: añadir `tcghunt.mx` y verificar SPF/DKIM (NO cambiar `MAIL_FROM` aún).
8. **[HUMANO]** Cloudflare Email Routing en `tcghunt.mx`: `soporte@`, `contacto@`, `facturacion@`
   → reenvío al Gmail; mandar un correo de prueba REAL a cada uno y confirmar que llega (esta
   prueba es la precondición del paso B.2 —`DISPUTE_EVIDENCE_CONTACT`— y del paso B.3 —buzones
   en el frontend).
9. **[ORQUESTADOR/ROLES]** Mergear los streams de código del rebrand (frontend marca/metadata +
   backend correos) con sus gates (QA+techlead; seguridad por release) — prerequisito del switch.
   **EXCEPCIONES (se mergean/deployan EN la ventana B, no antes):** `frontend/vercel.json` (§25.7,
   activa el 301 al deployarse) y el cambio de buzones `@tcghunt.mx` en el i18n del frontend
   (`frontend/messages/{es,en}.json`: `contacto@`, `soporte@`, `facturacion@` — paso B.3), para
   que el frontend no muestre buzones nuevos mientras el backend siga respondiendo los viejos.

**B) VENTANA DEL SWITCH — en este orden** *(30–60 min, con el humano en los dashboards)*:

1. Smoke previo en `https://www.tcghunt.mx`: home con marca TCG HUNT, login (email y Google),
   una compra Stripe en test si hay staging — si algo falla, ABORTAR (nada se ha roto aún).
2. Railway: **reordenar** `APP_BASE_URL` (nuevo primero) + fijar `MAIL_FROM` y
   `DISPUTE_EVIDENCE_CONTACT` (solo con sus precondiciones de §25.5 cumplidas). Esperar redeploy
   *Active* y `GET /api/v1/health` = 200.
3. **Merge+deploy del frontend con los buzones `@tcghunt.mx` en i18n** (`frontend/messages/
   {es,en}.json`: `contacto@`, `soporte@`, `facturacion@` — rol frontend; carve-out de A.9).
   **Precondición:** los buzones nuevos ya reciben — Email Routing activo y probado con correo
   real (paso A.8). Se ejecuta **inmediatamente después del paso 2** para minimizar el desfase
   backend/frontend.
   **Ventana de desfase ACEPTADA (declarada):** entre el redeploy de Railway (paso 2) y que el
   deploy de Vercel de este paso quede *Ready* hay un lapso — objetivo ≤ 15 min, presupuesto
   máximo 60 min (la duración de la ventana B) — en el que el backend ya responde/envía
   `soporte@tcghunt.mx` mientras el frontend aún muestra `@tcgvaultmx.com`. Se acepta porque
   **ambos juegos de buzones reciben a la vez**: los nuevos quedaron probados en A.8 y los viejos
   siguen enrutando ≥ 12 meses (§25.2) — ningún correo de usuario se pierde, gane quien gane la
   carrera. Si el deploy de Vercel falla, aplicar el rollback C (restaurar `MAIL_FROM`/
   `DISPUTE_EVIDENCE_CONTACT` en Railway) para volver a un estado coherente en minutos.
4. Activar los **301**: mecanismo 1 (dashboard) **o** mergear/deployar `frontend/vercel.json`
   (§25.7) — uno solo.
5. GitHub Secret `PROD_BASE_URL=https://www.tcghunt.mx`.
6. **Verificación** (desde cualquier máquina con egress):
   ```bash
   curl -sI "https://www.tcgvaultmx.com/es/comprar?foo=1" | grep -i -e '^HTTP' -e '^location'
   # esperado: HTTP/2 301  +  location: https://www.tcghunt.mx/es/comprar?foo=1  (path+query intactos)
   curl -sI "https://tcgvaultmx.com/en/vender"            # → 301 a https://www.tcghunt.mx/en/vender
   curl -sI "https://tcghunt.mx/"                          # → redirect permanente a https://www.tcghunt.mx/
   curl -sI "https://www.tcghunt.mx/" | head -1            # → HTTP/2 200
   ```
   Y funcional: login Google en el dominio nuevo; subir una INE de prueba (CORS R2); compra test →
   `return_url` cae en `www.tcghunt.mx`; llega el correo de verificación **desde
   `no-reply@tcghunt.mx`** (y no va a spam: SPF/DKIM verdes en Resend). Coherencia de buzones
   (cierra el desfase del paso 3): el frontend ya muestra `@tcghunt.mx` (footer, aviso CFDI,
   términos) y el flujo de disputa devuelve `soporte@tcghunt.mx` — mismo buzón en ambos lados.
7. Post-switch (no bloquea): Search Console — alta de `tcghunt.mx` + herramienta **Cambio de
   dirección** desde la propiedad vieja; re-emitir sitemap (rol frontend si es archivo).

**C) ROLLBACK** *(cada paso es independiente y reversible)*:

- Vercel: quitar el "Redirect to" de los dominios viejos (o revert del commit de `vercel.json` +
  redeploy) → el dominio viejo vuelve a servir la app al instante.
- Railway: restaurar el orden viejo de `APP_BASE_URL`; borrar `MAIL_FROM` (cae al default de código)
  y devolver `DISPUTE_EVIDENCE_CONTACT=soporte@tcgvaultmx.com`.
- Buzones del frontend (paso B.3): revert del commit de i18n + redeploy en Vercel (rol frontend).
  Si el rollback es solo del lado backend/Railway, puede aceptarse dejar el frontend con
  `@tcghunt.mx` temporalmente: esos buzones ya reciben (A.8), aplica la misma lógica de la
  ventana de desfase declarada en B.3.
- GitHub Secret `PROD_BASE_URL` al valor anterior.
- DNS: **nada que revertir** (el dominio viejo nunca dejó de apuntar a Vercel; el nuevo puede
  quedarse configurado sin daño).
- Lo aditivo de pre-switch (CORS R2, OAuth origins, Resend, buzones) puede quedarse: no rompe nada.

### 25.7 Handoff EXACTO a FRONTEND — `frontend/vercel.json` (devops NO lo escribe)

Crear **`frontend/vercel.json`** (el Root Directory del proyecto Vercel es `frontend/`, §11.A) con
exactamente esto:

```json
{
  "redirects": [
    {
      "source": "/:path*",
      "has": [{ "type": "host", "value": "tcgvaultmx.com" }],
      "destination": "https://www.tcghunt.mx/:path*",
      "statusCode": 301
    },
    {
      "source": "/:path*",
      "has": [{ "type": "host", "value": "www.tcgvaultmx.com" }],
      "destination": "https://www.tcghunt.mx/:path*",
      "statusCode": 301
    }
  ]
}
```

Notas para frontend (importantes):
- **`statusCode: 301` y NO `permanent: true`** — `permanent: true` emite **308**, y P-21 pide 301.
- La **query string se preserva sola** (Vercel la reenvía si el destino no define la suya); el path
  lo preserva `/:path*` (matchea también la raíz `/`).
- El filtro `has: host` hace que las reglas **solo** apliquen al dominio viejo: mergear este archivo
  **activa el 301 en producción en cuanto se despliegue** → coordinar el merge con la ventana
  §25.6-B (no mergear antes), y NO usarlo a la vez que el redirect del dashboard (§25.2).
- `next.config.mjs` no se toca para esto (los redirects de Next no ven el `Host` de dominios
  Vercel-level tan limpio como `vercel.json`, y este archivo mantiene la config de plataforma junta).

### 25.8 Fuera de alcance devops (enrutado a sus roles — P-21)

- **backend:** default `DEFAULT_MAIL_FROM`, buzones hardcodeados (`disputes.constants.ts`,
  `buylist-mail.templates.ts`, `guest-checkout.constants.ts`), plantillas de correo con la marca.
- **frontend:** `frontend/vercel.json` (§25.7), i18n `messages/{es,en}.json`
  (`contacto@/soporte@/facturacion@`), marca/metadata/OG, `SUPPORT_CONTACT_FALLBACK`,
  `SEALED_BUYLIST_EMAIL`.
- **ux-ui:** ya entregado (DESIGN_SYSTEM §17).
- **humano:** todos los pasos `[HUMANO]` de §25.4–§25.6 (DNS, Vercel, Railway, R2, OAuth, Resend,
  Email Routing, Stripe branding, Search Console) — nadie más tiene acceso a esos dashboards
  (cf. §23.1: la sesión no tiene tokens ni egress a prod).

---

## 26. Promoción a prod del stream de composición de variantes (M-31 v1.29 + M-32 v1.30) — 2026-08-22

> **Rama:** `fix/variant-composition-regression` @ `31a893b` (ya en `origin`). **Autorización del dueño:**
> desplegar a PROD para validar **UN set (Pitch Black / ME05)** antes del re-sync completo. QA + techlead
> aprobados; los 3 MAYOR del techlead cerrados en `31a893b`.
>
> **VEREDICTO DE ESTA SESIÓN devops: NO SE DESPLEGÓ — PÁRATE controlado.** El pipeline está preparado y
> todas las precondiciones *verificables desde aquí* pasan, pero **el egress a prod está bloqueado por
> política** (proxy responde `403 CONNECT` a `tcg-vault-mx-production.up.railway.app` y `www.tcgvaultmx.com`,
> confirmado en `$HTTPS_PROXY/__agentproxy/status` → `recentRelayFailures`). Por tanto **no puedo (a)
> confirmar que la Postgres de prod es ≥15 en vivo ni (b) verificar salud post-deploy**. El runbook de
> CLAUDE.md/este stream exige parar sin desplegar si no se puede verificar salud → se entrega el push y la
> verificación al humano/orquestador, que sí tiene los dashboards. GitHub **sí** es alcanzable (el merge y el
> push son ejecutables; lo que no es verificable es el resultado del deploy).

### 26.1 Estado de ramas (verificado con git)

| Rama | Commit | Nota |
|---|---|---|
| `origin/main` | `3b9d16f` | Base actual de prod (Railway/Vercel auto-deploy desde `main`, ver §26.3). |
| `fix/variant-composition-regression` | `31a893b` | `origin/main` + 5 commits (M-31, M-32, fix 3-MAYOR, 2 docs de arquitectura). |
| `origin/production` | `b33db22` | Rama-registro de releases (merges `main → production`); su contenido ⊆ `fix`. |
| `main` **local** | `e52425e` | **STALE** — no usar. Está detrás de `origin/main`; se descarta a favor de `origin/main`. |

- **El merge `fix → main` es un FAST-FORWARD LIMPIO:** `origin/main` (`3b9d16f`) es **ancestro directo** de
  `fix` (`git rev-list origin/main..fix` = 5; `fix..origin/main` = 0). **No hay conflictos, no se descarta
  trabajo ajeno.** Los 5 commits que aporta `fix` son exactamente: `9dfa2cb`+`505e6ac` (docs de contrato
  v1.29/v1.30), `421967f` (M-31), `774293e` (M-32), `31a893b` (cierre 3 MAYOR). Todo el trabajo de otros
  streams (§4.25e, Stream C, rebrand P-21) **ya está** dentro de `fix` porque `fix` se ramificó de la punta
  de `origin/main`.
- **NO se ejecutó el merge ni el push desde esta sesión** (push = deploy no verificable). Local `main` se
  dejó intacto.

### 26.2 Precondiciones de seguridad del cambio — verificadas

- **Migraciones aditivas + backfill (verificado leyendo el SQL):**
  - **M-31** `20260822120000_m31_card_products_rarity_canonical` — `CREATE TYPE`, `CREATE TABLE CardProduct`,
    columnas nullable nuevas (`Card.rarityCanonical`, `PriceReference.cardProductId`), enum value nuevo, y
    **BACKFILL** (`UPDATE Card SET rarityCanonical=rarity`; `INSERT CardProduct` desde `tcgplayerId` +
    `structuralFinishes`/`availableFinishes`). **No dropea columnas de datos** (las viejas quedan muertas,
    conservadas para reversibilidad). Efecto: al aplicarse, cada carta **conserva su composición actual**;
    el fantasma solo se corrige en el set que se re-sincronice.
  - **M-32** `20260822130000_m32_sell_item_card_product_id` — aditiva (`SellRequestItem.cardProductId`,
    `PendingPriceEntry.cardProductId`).
- **⚠️ REQUISITO DURO Postgres ≥ 15:** M-31 crea el índice único `PriceReference_variant_capturedDate_key`
  con **`NULLS NOT DISTINCT`** (feature de **PG15+**). Docs de infra dicen Railway Postgres **16** (§1,
  HANDOFF §3) → cumpliría, **pero no pude consultarlo en vivo** (egress bloqueado). **El humano DEBE
  confirmar PG≥15 antes del push.** Si fuese <15, `migrate deploy` falla en M-31 (ver §26.4, falla
  atómica y segura).
- **Orden migración-antes-de-servir: GARANTIZADO por el `CMD` del `Dockerfile.backend`:**
  `CMD ["sh","-c","node node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]`.
  Prisma corre **`migrate deploy` a completitud ANTES** de que Nest escuche. El código nuevo (que lee
  `CardProduct`/`rarityCanonical`) **nunca** sirve antes de que M-31/M-32 existan. No hace falta paso manual.
  `healthcheckTimeout: 300` en `railway.json` da holgura para el `migrate deploy` del arranque.

### 26.3 Flujo REAL de promoción a prod (confírmalo antes de pushear)

- **Mecanismo vigente según docs (HANDOFF §3, §23.2):** **Railway (backend) y Vercel (frontend)
  auto-despliegan desde `main`** vía sus integraciones de Git nativas. `Dockerfile.backend` corre
  `prisma migrate deploy` en el arranque. **El CD de GitHub Actions (`deploy.yml`) NO corre solo** (§16.4,
  solo `workflow_dispatch`) y es redundante.
- **⚠️ DISCREPANCIA a resolver por el humano:** existe la rama `origin/production` con commits
  `release: … main → production`. La premisa de esta tarea era "PR `main`→`production` dispara el deploy",
  pero las notas del repo dicen que **el disparador es `main`**. **Antes de pushear, el humano DEBE
  confirmar en los dashboards de Railway y Vercel cuál es la *Production/Deploy Branch* que observan hoy**
  (Railway: servicio `backend` → Settings → Source/Branch; Vercel: Project → Settings → Git → Production
  Branch). Pushear a la rama equivocada o a las dos a la vez causa deploy nulo o **deploy duplicado**.
- **Pasos del deploy (a ejecutar por el humano/orquestador con visibilidad de prod):**
  1. `git fetch origin && git checkout main && git reset --hard origin/main` (parte de la punta remota, no
     del `main` local stale).
  2. `git merge --ff-only origin/fix/variant-composition-regression` → debe ser fast-forward (si no lo es,
     PARAR: alguien movió `main`; re-evaluar).
  3. **Snapshot/PITR de la Postgres de prod ANTES de pushear** (regla de oro §7: datos primero).
  4. `git push origin main` **(esto dispara el deploy)** — o merge a `production` si ése resultó ser el
     branch observado (§26.3, discrepancia).
  5. Verificar salud (§26.5) **antes** de disparar el sync por-set.

### 26.4 Rollback de M-31/M-32 — ⚠️ **NO es la regla general** (ver §46.3)

> ⛔⛔ **ESTE TÍTULO DECÍA «la migración es aditiva → rollback = redeploy del commit anterior» Y ESA
> REGLA, ENUNCIADA ASÍ, ES FALSA.** Corregido el 2026-09-10 (§46). **«Aditiva» NO implica
> «reversible»:** aditiva mira hacia atrás (¿destruye datos?), reversible mira hacia adelante (¿el
> código anterior puede seguir **escribiendo**?). **M-50 es aditiva y aun así revertir el código a
> pelo tumba el checkout**, porque añade `priceConvention` como `NOT NULL` **sin default** y el
> código anterior no la escribe nunca (medido: `null value in column "priceConvention" … violates
> not-null constraint` sobre un checkout de invitado real).
>
> **ANTES DE EJECUTAR NADA DE ESTA SECCIÓN, COMPRUÉBALO — es un comando, no un juicio:**
> ```bash
> export DATABASE_URL='<la BD que se va a operar>'
> ./scripts/rollback-safety-probe.sh <sha-del-deploy-anterior>
> ```
> **Verde** ⇒ lo de abajo vale tal cual: redeploy y ya. **Rojo** ⇒ **hay un paso de DATOS antes del
> redeploy**; no sigas por aquí, ve a **§46.1** (runbook de M-50) y **§46.3** (la regla general).
> Lo de abajo sigue siendo correcto **para las migraciones que nombra** (M-31/M-32/M-39/M-40/M-41,
> todas nullable o con default), no como doctrina universal.

| Escenario | Acción |
|---|---|
| **App nueva rota / regresión** | Railway (servicio `backend` → Deployments → **Redeploy** el deploy de `3b9d16f`) y Vercel (Deployments → **Promote to Production** el build previo). Alternativa Git: `git revert` del merge y push. |
| **Datos** | **No se requiere restaurar DB para revertir el código.** M-31/M-32 son **aditivas**: sus columnas/tablas (`CardProduct`, `rarityCanonical`, `*.cardProductId`) quedan y son inertes para el resolver viejo (las columnas legacy `structuralFinishes`/`catalogFinishes`/`pricedFinishesSnapshot` se conservaron a propósito para reversibilidad — ver cabecera de la M-31). Solo se restaura del snapshot (§26.3 paso 3) si hubiera corrupción de datos, no por un rollback de código. |
| **PG < 15 (falla de migración)** | `migrate deploy` falla en M-31 **dentro de su transacción** (Prisma envuelve cada migración) → **rollback atómico de M-31**, el contenedor sale ≠0, Railway reintenta (`ON_FAILURE`, max 10) y **mantiene activo el deploy anterior** (`3b9d16f`). Prod sigue sirviendo el código viejo. Corregir: subir Postgres a ≥15 o aplicar el fallback de índice normal (BACKEND_NOTES M-31, es cambio de **rol backend**). |

### 26.5 Verificación de salud post-deploy (a ejecutar por quien tenga egress a prod)

1. `GET https://tcg-vault-mx-production.up.railway.app/api/v1/health` → `200`, componente Redis `up`.
2. Railway → `backend` → Deployments: último **Success** en el commit `31a893b` (o el sha que reporte).
3. **Migración aplicada** (en la consola de Postgres de Railway):
   - `SELECT COUNT(*) FROM "CardProduct";` → > 0 (backfill corrió).
   - `SELECT 1 FROM information_schema.columns WHERE table_name='Card' AND column_name='rarityCanonical';` → 1 fila.
   - `SELECT indexname FROM pg_indexes WHERE indexname='PriceReference_variant_capturedDate_key';` → 1 fila.
   - `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name IN ('20260822120000_m31_card_products_rarity_canonical','20260822130000_m32_sell_item_card_product_id') AND finished_at IS NOT NULL;` → 2 filas.
4. Frontend sirve: `GET https://www.tcgvaultmx.com` → `200`.

### 26.6 REQUEST EXACTO del sync forzado de UN set (Pitch Black / ME05) — NO correr `sync-all`

> **NO usar `POST /admin/catalog/sync-all {force:true}`** (ése re-sincroniza TODO el catálogo). Para un solo
> set se usa `POST /admin/catalog/sync` con `{ setId, force:true }` (verificado en
> `backend/src/modules/catalog/admin-catalog.controller.ts:70` → `catalog-sync.service.ts:109` `sync()`).

- **Método / URL:** `POST https://tcg-vault-mx-production.up.railway.app/api/v1/admin/catalog/sync`
- **Auth:** JWT de **`super_admin`** en `Authorization: Bearer <accessToken>`. Obtenerlo con
  `POST /api/v1/auth/login` `{ "email": "<SEED_ADMIN_EMAIL>", "password": "<SEED_ADMIN_PASSWORD>" }` →
  campo `accessToken` de la respuesta.
- **Headers:** `Content-Type: application/json` + el `Authorization` de arriba.
- **Body:** `{ "setId": "<externalId-pokemontcg.io-de-Pitch-Black>", "force": true }` → responde **202**;
  progreso en `GET /api/v1/admin/catalog/sync-status`.

**⚠️ El `setId` que espera el endpoint NO es `24688`.** El código valida `setId` con
`SET_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/` y lo interpola en `q=set.id:<setId>` contra **pokemontcg.io**
(`catalog-sync.service.ts`). Es el **`externalId` de pokemontcg.io** del set (string en minúsculas), NO el
uuid interno ni el numérico de TCGplayer. **`24688` es el `pptSetId`** (`CardSet.pptSetId`), que el resolver
TCGCSV usa **internamente** como `groupId` (`card-product-resolver.service.ts:199-202`: si `pptSetId` es
entero, `groupId = pptSetId`). Es decir: das el `externalId` al endpoint, y el resolver por dentro usa
`24688` para leer la composición exacta desde TCGCSV.

**Cómo obtener el `externalId` real de Pitch Black / ME05** (elige una; requiere prod):
- **Vía BD (más directa):** en la Postgres de Railway →
  `SELECT "externalId","name","ptcgoCode","pptSetId" FROM "CardSet" WHERE "pptSetId"='24688' OR "ptcgoCode"='ME05' OR "name" ILIKE '%pitch black%';`
  → usa el valor de la columna `externalId` como `setId`.
- **Vía API:** `GET /api/v1/admin/catalog/remote-sets` (super_admin) lista los sets remotos de pokemontcg.io
  (`id` + `name`); localiza el de Pitch Black y usa su `id`.

> **Precondición del sync por-set:** este endpoint primero trae las cartas del set desde **pokemontcg.io**
> por `externalId`; si Pitch Black/ME05 aún **no existe en pokemontcg.io**, el `sync` por `externalId` no
> importará cartas y el resolver TCGCSV no correrá por esta vía (hallazgo a validar con backend/PO). En ese
> caso el set debe existir en la BD con su `pptSetId=24688` y el re-populado de composición se dispara por el
> resolver — coordinar con **backend** antes de asumir que este request basta. El re-sync es **idempotente y
> money-safe** (§24.3): repuebla composición/precios de SINGLES, no borra `PriceReference` ni dinero.

### 26.7 Resumen del handoff (qué falta y de quién es)

- **[HUMANO/orquestador con dashboards]** Confirmar branch observado (§26.3), confirmar **PG≥15**, snapshot
  de DB, `git push` del FF `fix→main` (o a `production`), verificar salud (§26.5), y disparar el request
  por-set (§26.6). Todo esto es lo único pendiente; el pipeline y el orden de migración ya están listos y
  son seguros.
- **[backend]** Solo si (a) PG<15 en prod (fallback de índice de la M-31) o (b) el set ME05 no está en
  pokemontcg.io y el sync por `externalId` no dispara el resolver: es decisión/código de backend, no de devops.

---

## 27. Runbook de release — SECUENCIA POST-DEPLOY money-crítica (M-39/M-40 + reshape P-34) — 2026-08-23

> ### ⛔ AVISO 2026-08-24 — el **PASO 3 de esta sección ya NO EXISTE**. Ver **§29**.
> El **backfill P-34 (reshape de tiers)** se **retiró del pipeline**: la etapa **E8 de P-48/v2.0** borró
> `backend/prisma/backfill-p34-tiered-pricing.ts` junto con toda la superficie de tiers, y
> `scripts/post-deploy.sh` ya **no** lo invoca (su llamada rompía el post-deploy entero por
> `set -euo pipefail`). **No se reemplazó por otro script**: las cinco claves que migraba
> (`sales_price_rules`, `sales_price_fallback_pct`, `buylist_price_rules`,
> `buylist_price_fallback_pct`, `pricing_tier_map`) **ya no las lee nadie**; sus filas quedan
> huérfanas e **inertes** en `ConfigSetting` a propósito (§4.36.9b: rollback barato + diagnóstico).
> **Esta sección se conserva como REGISTRO HISTÓRICO** del release 2026-08-23 (M-39/M-40 siguen
> vigentes y ya están en `origin/main`/`origin/production`). **El runbook operativo vigente es §29.**
>
> **Rama:** `fix/variant-composition-regression` @ `9b6a81b`. **Origen:** el techlead marcó **D-4** — el
> script money-crítico de **reshape de tiers (P-34 T2=25%)** **no estaba en el runbook de deploy** y la
> **regla 10** de `CLAUDE.md` exige cerrarlo ANTES de prod. Esta sección cablea la **secuencia exacta
> post-deploy** para que nadie la olvide, y su rollback.
>
> **Por qué NO basta `migrate deploy`:** este release trae **cambios de DATOS** que las migraciones NO
> cubren solas. Son **scripts idempotentes post-migración** (reshape de reglas de precio + cura del
> sellado). Sin el paso 3, la decisión money **T2 Rare/Holo = 25%** de P-34 queda **silenciosamente inerte
> en prod** (el compat on-read cae al fallback 40%). Orden y money-safety: ver abajo.
>
> **Orquestador:** `scripts/post-deploy.sh` (idempotente) ejecuta los pasos automatizables EN ORDEN y
> **PARA** si el paso 3 imprime «ACCIÓN REQUERIDA». Es la forma recomendada de correr esto.

### 27.1 Cuándo corre y con qué se ejecuta

- **Cuándo:** **DESPUÉS** de que el contenedor de backend arrancó y aplicó `prisma migrate deploy` (el
  `CMD` del `Dockerfile.backend` lo garantiza antes de servir — §26.2), y **ANTES** de anunciar que P-34
  está vigente / abrir el release. Salud primero (§27.5), luego la secuencia.
- **Con qué:** patrón §11.F — el env de Railway se inyecta y la DB de prod se alcanza por red. Desde la
  **raíz del repo** (con `cd backend && npm ci` hecho: se necesita `ts-node` + `@prisma/client` locales):
  ```bash
  railway run --service backend --environment production bash scripts/post-deploy.sh
  ```
  O directamente contra una DB objetivo: `DATABASE_URL='postgres://…' bash scripts/post-deploy.sh`.
- **Idempotente:** seguro correrlo varias veces. Money-safe: los scripts **nunca** escriben $0 ni regla
  vacía; ante divergencia **no tocan dinero** y escalan.

### 27.2 La secuencia EXACTA (comando · idempotencia · si falla)

| # | Paso | Comando exacto | Idempotencia | Si falla / qué hacer |
|---|---|---|---|---|
| 1 | **Migraciones** M-39 (`SealedProduct`) + M-40 (`PendingPriceEntry.sealedProductId`, FK nullable `onDelete SET NULL`). Ambas **aditivas**. | `npx prisma migrate deploy` (ya corre al arrancar el contenedor; el orquestador la re-verifica salvo `SKIP_MIGRATE=1`) | No-op si ya aplicaron (`_prisma_migrations`). | Falla atómica dentro de su tx → Railway mantiene el deploy anterior. Rollback = redeploy del commit previo (§27.4). |
| 2 | **Backfill M-39** — cura el **ETB→Tropius** (deriva `SealedProduct` de items ya mapeados y liga `sealedProductId`). | `npx ts-node prisma/backfill-m39-sealed-product.ts` | `upsert` + solo liga items sin FK ⇒ 2ª corrida no duplica. | Reimprime reconciliación de sellados **SIN MAPEO** (quedan `null`, no bloquea). Si el script sale ≠0, revisar log y re-correr; no es destructivo. |
| ~~3~~ | ⛔ **RETIRADO 2026-08-24 (P-48/E8) — el script YA NO EXISTE, no lo busques ni lo re-crees (§29.2).** ~~Backfill P-34 — RESHAPE de tiers (T2=25%). MONEY-CRÍTICO.~~ Migra las reglas legacy plano/dos-ejes al shape tiered canónico. | `npx ts-node prisma/backfill-p34-tiered-pricing.ts` | Ve `tierRules` ⇒ NO-OP. Nunca escribe $0. | **Si imprime «⚠ ACCIÓN REQUERIDA»** (una tabla de M2 fue editada a mano y DIVERGE del default): **NO la toca (money-safe)** → **PARAR y escalar al humano/arquitecto** para definir el mapeo rareza→tier a mano. **El release NO se anuncia** hasta cerrarlo. `post-deploy.sh` **para solo** ante ese texto. |
| 4 | **unify-rarities** — pendiente **cosmético** de P-34 (re-deriva `Card.rarityCanonical`). Es endpoint HTTP, no script de DB. | `curl -X POST "$ADMIN_BASE_URL/admin/catalog/unify-rarities" -H "Authorization: Bearer <super_admin_JWT>" -H "Content-Type: application/json"` | Idempotente (2ª corrida = 0 updates). | Cosmético: **NO bloquea**. Reintentar a mano cuando se tenga JWT. El orquestador lo dispara solo si se le pasan `ADMIN_BASE_URL` + `ADMIN_JWT`. |
| 5 | **Nota de saneo legacy (deuda D-3)** — filas pendientes de sellado duplicadas/huérfanas (`gradeKey='sealed'` sin `sealedProductId`) de altas previas al fix. | *(barrido puntual, registrado en `TECH_DEBT`/`BACKEND_NOTES`)* | — | **Deuda de rol BACKEND, NO devops. NO bloquea el deploy.** Solo se observa en la cola de precio pendiente de M2 y se enruta a backend. |
| 6 | **Sincronizar sellado por set** — «Sincronizar» trae presentaciones de sellado desde **tcgcsv.com** (egress real; en local/CI daba **403**). | Back-office M2 «Sincronizar» por set, o el endpoint por-set con super_admin (ver §26.6). | Idempotente / money-safe (repuebla presentaciones y precio; no borra `PriceReference`). | Requiere egress a tcgcsv.com. Si da 403/timeout, es red/egress: reintentar desde un entorno con salida a Internet; no altera dinero existente. |

**Regla de oro de esta secuencia:** el paso 3 es la razón de ser de D-4. Correrlo tras `migrate deploy` y
**ANTES del anuncio**; si escala a «ACCIÓN REQUERIDA», el release espera. Los pasos 4–6 no bloquean el
deploy técnico pero sí completan el release (4 y 6 son manuales/egress; 5 es deuda de backend).

### 27.3 Precondiciones de seguridad del cambio (verificadas leyendo el SQL)

- **M-39** `20260823120000_m39_sealed_product`: **ADITIVA y reversible** — dos tablas nuevas
  (`SealedProduct`, `SealedSetGroup`), enum nuevo `SealedGroupKind`, dos valores apendados a `SealedSubtype`
  (`ADD VALUE IF NOT EXISTS`), y una columna FK **nullable** (`InventoryItem.sealedProductId`). **Sin `DROP`,
  sin backfill destructivo.** El backfill de datos vive APARTE (paso 2) porque `ALTER TYPE ADD VALUE` no se
  puede USAR en su propia tx y la derivación necesita la heurística `inferSealedSubtype`.
- **M-40** `20260823130000_m40_pending_sealed_product`: **ADITIVA** — `PendingPriceEntry.sealedProductId`
  (FK **nullable**, índice, FK **`onDelete: SET NULL`**). Sin `DROP`, sin backfill obligatorio. Un pendiente
  de sellado sin `sealedProductId` queda `null` y **sigue el comportamiento previo: SIEMPRE pendiente, JAMÁS
  $0** (money-safe).
- **Orden migración-antes-de-servir:** garantizado por el `CMD` de `Dockerfile.backend`
  (`… migrate deploy && node dist/main.js`). El código nuevo nunca sirve antes de que M-39/M-40 existan.
- **Money-safety del reshape P-34:** el script sólo reemplaza tablas que coinciden **byte-a-byte** con los
  defaults «pristine» sembrados en su día (nunca editadas a mano). Si una diverge, **no la toca** y escala.

### 27.4 Rollback de M-39/M-40 — ⚠️ **NO es la regla general** (ver §46.3)

> ⛔⛔ **ESTE TÍTULO DECÍA «la migración es aditiva → rollback = redeploy del commit anterior» Y ESA
> REGLA, ENUNCIADA ASÍ, ES FALSA.** Corregido el 2026-09-10 (§46). **«Aditiva» NO implica
> «reversible»:** aditiva mira hacia atrás (¿destruye datos?), reversible mira hacia adelante (¿el
> código anterior puede seguir **escribiendo**?). **M-50 es aditiva y aun así revertir el código a
> pelo tumba el checkout**, porque añade `priceConvention` como `NOT NULL` **sin default** y el
> código anterior no la escribe nunca (medido: `null value in column "priceConvention" … violates
> not-null constraint` sobre un checkout de invitado real).
>
> **ANTES DE EJECUTAR NADA DE ESTA SECCIÓN, COMPRUÉBALO — es un comando, no un juicio:**
> ```bash
> export DATABASE_URL='<la BD que se va a operar>'
> ./scripts/rollback-safety-probe.sh <sha-del-deploy-anterior>
> ```
> **Verde** ⇒ lo de abajo vale tal cual: redeploy y ya. **Rojo** ⇒ **hay un paso de DATOS antes del
> redeploy**; no sigas por aquí, ve a **§46.1** (runbook de M-50) y **§46.3** (la regla general).
> Lo de abajo sigue siendo correcto **para las migraciones que nombra** (M-31/M-32/M-39/M-40/M-41,
> todas nullable o con default), no como doctrina universal.

| Escenario | Acción |
|---|---|
| **App nueva rota / regresión** | Railway (`backend` → Deployments → **Redeploy** el deploy previo bueno) y Vercel (Deployments → **Promote to Production** el build previo). Alternativa Git: `git revert` del merge + push. |
| **Datos (código)** | **No se restaura la DB para revertir el código.** M-39/M-40 son **aditivas**: sus tablas/columnas (`SealedProduct`, `SealedSetGroup`, `*.sealedProductId`) quedan **inertes** para el código viejo. Solo se restaura del snapshot si hubiera **corrupción de datos**, no por un rollback de código. |
| **Reshape P-34 aplicado y se quiere revertir el dinero** | Los backfills son **idempotentes y NO destructivos**, pero el paso 3 **reescribe** `buylist_price_rules` / `sale_price_rules` al shape tiered. Para volver al valor exacto previo: **restaurar esas dos filas de `ConfigSetting` desde el snapshot pre-deploy** (por eso el snapshot del paso 3 de §27.5). El compat on-read lee ambos shapes, así que el código viejo tolera el shape tiered si sólo se revierte código. |
| **Backfill M-39 a revertir** | No destructivo (solo crea `SealedProduct` y liga FKs nullable). Revertir código deja esas filas inertes; no requiere acción de datos. |
| **Migración falla al aplicar** | Prisma envuelve cada migración en su tx → **rollback atómico**; el contenedor sale ≠0, Railway reintiene y **mantiene activo el deploy anterior**. Prod sigue sirviendo el código viejo. |

> Orden de oro (§7): **datos primero** (snapshot antes de migrar y antes del paso 3), luego código.

### 27.5 Orden operativo end-to-end (lo que ejecuta el humano/orquestador con egress a prod)

1. **Snapshot / PITR** de la Postgres de prod (Railway → Postgres → Backups → *Create backup*). **Cubre las
   dos filas de `ConfigSetting` que toca el paso 3** (única vía de rollback fino del dinero — §27.4).
2. Deploy del backend (Railway auto-deploy desde `main`, o §26.3): al arrancar corre `migrate deploy`
   (M-39 + M-40).
3. **Verificar salud** (§27.6) antes de tocar datos.
4. Correr la secuencia post-deploy:
   `railway run --service backend --environment production bash scripts/post-deploy.sh`
   — **si para en «ACCIÓN REQUERIDA» (paso 3): escalar al humano/arquitecto y NO anunciar** el release.
5. Paso 6 (sync de sellado por set) desde un entorno con egress a tcgcsv.com.
6. Anunciar el release / crear el tag sólo cuando 1–5 estén verdes.

### 27.6 Verificación post-deploy (a ejecutar por quien tenga egress a prod)

1. `GET /api/v1/health` → `200` (componente Redis `up`). En Railway el servicio queda *Active/healthy*.
2. **Migraciones aplicadas** (consola de Postgres de Railway):
   ```sql
   SELECT migration_name FROM "_prisma_migrations"
   WHERE migration_name IN ('20260823120000_m39_sealed_product','20260823130000_m40_pending_sealed_product')
     AND finished_at IS NOT NULL;               -- → 2 filas
   SELECT 1 FROM information_schema.columns
   WHERE table_name='PendingPriceEntry' AND column_name='sealedProductId';  -- → 1 fila
   SELECT COUNT(*) FROM "SealedProduct";        -- → ≥ 0 (backfill M-39 corrió; >0 si había sellado mapeado)
   ```
3. **Reshape P-34 aplicado** (money-check): en M2, la regla efectiva de COMPRA para **Rare / Rare Holo**
   debe ser **25% (pct)**, no el fallback 40%. El propio reporte del paso 3 imprime el ANTES→DESPUÉS por
   rareza; confirmar que aparece `Rare: 40% → 25%  ← CAMBIA` (o que ya estaba en 25% = idempotente).
   Verificación por DB:
   ```sql
   SELECT key, "valueJson" FROM "ConfigSetting"
   WHERE key IN ('buylist_price_rules','sale_price_rules','pricing_tier_map');  -- shape tiered (tierRules)
   ```
4. Frontend sirve: `GET https://<dominio-front>` → `200`.

### 27.7 Cableado en CI/orquestador — qué se añadió (cierre de D-4)

- **`scripts/post-deploy.sh`** (nuevo, propiedad devops): orquestador **idempotente** que corre los pasos 1–3
  en orden, **captura la salida del paso 3 y PARA con exit ≠0 si aparece «ACCIÓN REQUERIDA»** (money-safe),
  dispara el paso 4 (unify-rarities) por HTTP si se le pasan `ADMIN_BASE_URL`/`ADMIN_JWT` (si no, imprime la
  instrucción manual), e imprime las notas de los pasos 5 y 6. `set -euo pipefail`; ofusca el password del
  DSN al loguear.
- **`docs/DEVOPS_NOTES.md` §27** (este bloque): secuencia exacta, cuándo, idempotencia, qué hacer si falla y
  **rollback documentado** (DoD).
- **No se toca `deploy.yml`:** los backfills de DATOS **no** se cablean como job automático de CD porque el
  paso 3 puede requerir **decisión humana** (dinero) y se corre **contra la DB de prod** tras verificar salud.
  Automatizarlo a ciegas violaría la money-safety y la regla 10. El orquestador humano lo dispara con
  `railway run` (patrón §11.F) siguiendo §27.5.

> **Límites (devops):** esta sección y `scripts/post-deploy.sh` NO modifican `backend/`, `frontend/` ni el
> contrato. El paso 5 (saneo legacy D-3) es de **rol backend**; si el paso 3 escala a «ACCIÓN REQUERIDA», el
> mapeo rareza→tier a mano lo decide **humano/arquitecto**, no devops.

---

## 28. Runbook de ACTIVACIÓN en PROD — precio automático diario POR-ACABADO (P-47, dial `tcgcsv_singles`) — 2026-08-24

> ⚠️⚠️ **ACTUALIZADO EL 2026-09-10 — LÉEME ANTES DE SEGUIR ESTOS PASOS (IMPORTANTE-1 de QA, `D-PP-2`).**
> Este runbook se escribió el **2026-08-24**, **antes de la fusión de la curva v2**. Desde entonces el
> barrido hace **dos cosas más** que la versión original no menciona —**reprecia lo ya publicado** y
> **auto-publica piezas**— y su verificación **no cruzaba con `P-53`** (disco/WAL). Quien lo siguiera al
> pie de la letra **no sabría qué mirar después del flip**. Se corrigió **§28.4(e)**, que ahora tiene
> **seis** comprobaciones en vez de tres. Lo demás se conserva como **registro fechado** de una activación
> consumada (`ARCHITECTURE §4.35a(c)`).
>
> ⚠️ **Dos avisos de lectura, para que nadie ejecute un literal caduco:**
> 1. **Todo «seed money-safe = legacy» de esta sección está SUPERSEDIDO** por
>    [`API_CONTRACT §M10-PP`](API_CONTRACT.md#M10-PP) — **`I-PP1`: el SEED es el PRIMARIO** (§43.1). Este
>    runbook **opera el VIGENTE** (`I-PP3`), que es **otro hecho**: por eso el **procedimiento** sigue
>    siendo válido aunque el adjetivo ya no lo sea. **§28.6 se conserva ÍNTEGRO y sin tocar** por decisión
>    de `D-PP-2`; su paréntesis sobre el seed se lee bajo esta nota.
> 2. 🔴 **El literal del body de los `PUT` de §28.2, §28.4(c) y §28.6 estaba MAL** — ver **§43.4**: la
>    clave es **`priceProvider`** (camelCase), y `price_provider` cae en **`422 VALIDATION_ERROR`**.
>    Corregido en §28.2 y §28.4(c). **En §28.6 NO se toca ni una letra** (`D-PP-2` lo congela): al
>    ejecutar su rollback, usa la clave de §43.4.
>
> **Autorización:** el humano (super_admin, dueño) APROBÓ activar en **PRODUCCIÓN** el precio automático
> diario por-acabado (P-47). **Gate completo — triple veredicto APROBADO** sobre la rama
> `fix/variant-composition-regression`: **QA aprobado + techlead APROBADO-CON-DEUDA + seguridad CERRADA**
> (SECURITY_NOTES v1.47). Commits P-47: `73f0fa4` (provider TcgcsvSinglesBulk), `03f0e02` (P47-1 cota de
> cordura del market externo), `b16f03d` + `330f0b4` (P47-2 durabilidad del override manual cross-day).
> Docs de arquitectura v1.44–v1.47.
>
> **VEREDICTO devops de esta sesión: PIPELINE PREPARADO — NO se ejecutó el merge/push a `production` ni el
> flip.** El merge a `production` lo coordina el orquestador y los clics de dashboard (Railway env var, panel
> admin M10) los hace el humano; el egress a prod no es verificable desde aquí (misma política que §26).
> Todo lo de propiedad devops (doc del dial en `.env.example`, este runbook) está listo. **No hay push, no
> hay PR.**

### 28.1 Verificación del DoD de deploy para este cambio (ámbito devops)

| Ítem DoD (deploy) | Estado | Evidencia |
|---|---|---|
| Triple veredicto (QA + techlead + seguridad) | ✅ | QA aprobado; techlead APROBADO-CON-DEUDA (3 no bloqueantes BE-79/80/81 en TECH_DEBT, commit `65c88d9`); seguridad CERRADA v1.47 (`0255390`). |
| Gate SAST por PR | ✅ cableado | `.github/workflows/security-sast.yml` corre semgrep + gitleaks en **cada push y pull_request** (`branches: ["**"]`). No requiere cambios. |
| DAST contra staging bloquea prod | ✅ cableado | `.github/workflows/deploy.yml` job `dast-staging` (ZAP baseline `fail_action:true` + nuclei) es `needs` de la promoción a prod. |
| Harness E2E cableado | ✅ cableado | `deploy.yml` job `e2e-real` (`uses: ./.github/workflows/e2e-real.yml`, `needs:[preflight]`) corre ANTES de promover. |
| Migraciones al día | ✅ **P-47 NO añade migración** | Última migración = `20260823130000_m40_pending_sealed_product`. `git diff origin/main..fix -- backend/prisma/migrations` = 0. P-47 es lógica de pricing + un dial de datos; **no toca el schema**. Consecuencia clave: **rollback sin migración** (§28.6). |
| Deuda bloqueante | ✅ ninguna | Los 3 ítems del techlead (BE-79/80/81) están registrados como **no bloqueantes** en `docs/TECH_DEBT.md`. |

**Conclusión:** nada falta en el ámbito devops para activar. Se procede a preparar la secuencia.

### 28.2 Mecanismo EXACTO del flip (verificado en código, NO asumido)

- **El dial `PRICE_PROVIDER` (`price_provider`) es un ConfigSetting en BD, NO un env var.**
  - **Seed:** ⚠️ **corregido v1.65** — aquí decía *«`pokemontcg_io`»* con el sentido de candado money-safe.
    El seed **no se afirma en este documento**: su norma es **`I-PP1`** en
    [`API_CONTRACT §M10-PP`](API_CONTRACT.md#M10-PP) (*el SEED es el PRIMARIO*), y **el literal que corre se
    LEE del artefacto** — `DEFAULT_SETTINGS[SettingKey.PRICE_PROVIDER]` en
    `backend/src/modules/settings/settings.constants.ts`, no de esta línea (§0-B.3 regla 2). Ver §43.1.
  - Valores válidos: **el enum vive en `§M10-PP`**; en el código, `PRICE_PROVIDER_VALUES` +
    `SETTING_VALIDATORS[SettingKey.PRICE_PROVIDER]` (`settings.constants.ts`) → **422** si otro valor.
    *(Las referencias `:94` / `:203` / `:490` de la versión original ya no apuntan a donde decían: se citan
    por SÍMBOLO a propósito, que es lo único que no se desplaza con cada edición.)*
  - Lectura en runtime: `PriceIngestService.providerFor()` (`backend/src/modules/pricing/price-ingest.service.ts`) hace `this.settings.getString(SettingKey.PRICE_PROVIDER)` y elige el `BulkPriceProvider` cuyo `.source` casa. Con `tcgcsv_singles` selecciona `TcgcsvSinglesBulkPriceProvider`. **Surte efecto en la siguiente corrida del job, SIN redeploy.** *(Y es la razón exacta por la que `PRICE_PROVIDER` como env no flipea nada — §23.8.)*
- **Flip = un solo request HTTP autenticado (super_admin), auditado:**
  - **`PUT https://<API_BASE>/api/v1/admin/settings`** (`SettingsController.updateSettings`, `@Roles(super_admin)`). Registra `settings.update` en el audit log (before/after), **dentro de la misma transacción** que la escritura.
  - **Body:** `{ "priceProvider": "tcgcsv_singles" }` — 🔴 **camelCase, corregido el 2026-09-10.** La versión
    original decía `{ "price_provider": … }`, que el backend rechaza con **`422 VALIDATION_ERROR`**
    (`unknown setting key`): el body se valida contra `SETTING_DTO_MAP`, que solo declara `priceProvider`.
    Verificado leyendo `SettingsService.update()`. Detalle en **§43.4**.
  - Alternativa equivalente: el **panel de admin M10** (misma ruta por detrás) — **y es la vía recomendada**,
    porque no depende de acertar la clave del body.
- **`tcgcsv_singles` NO necesita env nuevos:** el provider usa `TcgcsvCatalogClient` (host FIJO
  `https://tcgcsv.com/tcgplayer`, **sin API key**, anti-SSRF heredado). Único requisito operativo: **egress
  a `tcgcsv.com` desde Railway**, que **ya está en uso** por el job del sellado (§19/§21). No hay
  `POKEMONPRICETRACKER_MARKET_FORMAT` que fijar (eso es solo del proveedor de paga).
- **`POKEMONPRICETRACKER_FETCH_PRINTINGS` = env var (NO BD).** Leída en
  `price-ingest.service.ts:606` con default `false` cuando ausente. Debe quedar **`false`** (o ausente) para
  que la fuente por-acabado sea **solo** TCGCSV y PPT no vuelva a barrer por impresión en paralelo.

> **Por eso `railway.json` NO cambia** en esta activación: el flip es un dato en BD y `tcgcsv_singles` no
> aporta env nuevos. Lo único de env es *confirmar* `POKEMONPRICETRACKER_FETCH_PRINTINGS=false` en Railway.

### 28.3 Qué preparó devops en esta sesión (propiedad devops)

- **`.env.example`** (bloque del dial `PRICE_PROVIDER`): documentado el valor `tcgcsv_singles` (P-47),
  su host fijo sin API key, el requisito de egress y el rollback. **Añadido bloque
  `POKEMONPRICETRACKER_FETCH_PRINTINGS=false`** con la razón (P-47 ⇒ fuente por-acabado = TCGCSV, no PPT).
- **`docs/DEVOPS_NOTES.md` §28** (este runbook): secuencia de activación, verificación y rollback.
- **`railway.json`:** sin cambios (justificado en §28.2). **`scripts/post-deploy.sh`:** sin cambios — el flip
  no es un backfill de datos ni una migración; es un dial de negocio que se opera por API/panel post-deploy.

### 28.4 Secuencia de ACTIVACIÓN — pasos ordenados

Estado de ramas (verificado con git, 2026-08-24):

| Rama | Commit | Nota |
|---|---|---|
| `origin/main` | `73f0fa4` | Tiene el provider P-47 base; le faltan P47-1/P47-2 + docs. |
| `origin/fix/variant-composition-regression` | `65c88d9` | `origin/main` + **10 commits** (P47-1, P47-2, docs v1.45–v1.47, veredictos). |
| `origin/production` | `9c3eb3e` | Rama-registro de releases (merges `main → production`, «release: …»). |

`git rev-list --count origin/main..origin/fix` = **10**; `origin/fix..origin/main` = **0** ⇒ el merge
`fix → main` es **FAST-FORWARD LIMPIO** (sin conflictos, sin descartar trabajo ajeno).

**(a) Merge `fix → main → production`** — *[HUMANO/orquestador con egress a git; devops NO lo ejecuta]*
  1. `git fetch origin`
  2. `git checkout main && git reset --hard origin/main` (parte de la punta remota, no del local stale).
  3. `git merge --ff-only origin/fix/variant-composition-regression` → **debe** ser fast-forward. Si no lo
     es, **PARAR**: alguien movió `main`; re-evaluar.
  4. `git push origin main`
  5. `git checkout production && git reset --hard origin/production`
  6. `git merge --no-ff main -m "release: P-47 precio automático diario por-acabado (tcgcsv_singles) (main->production)"`
  7. **Snapshot/PITR de la Postgres de prod** (regla de oro §7; aunque P-47 no migra, es release a prod).
  8. `git push origin production` **← esto dispara el deploy** (mecanismo declarado por el orquestador:
     `production` es la deploy branch).

> **⚠️ Confirmar el branch observado antes de pushear** (misma cautela §26.3): en Railway (servicio
> `backend` → Settings → Source/Branch) y Vercel (Project → Settings → Git → Production Branch) verificar que
> la *Production/Deploy Branch* es **`production`**. Pushear a la rama equivocada = deploy nulo o duplicado.

**(b) Deploy y verificación de salud** — *[HUMANO/quien tenga egress a prod]*
  9. Esperar a que Railway (backend, `Dockerfile.backend` corre `prisma migrate deploy` al arrancar — no-op
     aquí, no hay migración nueva) y Vercel (frontend) reporten **Success** en el sha del release.
  10. `GET https://<API_BASE>/api/v1/health` → `200`, Redis `up`. **REDIS_URL es requisito** para que el
      scheduler agende el `price-ingest` (sin Redis solo hay disparo manual awaited — §19).

**(c) Flip del dial + fetch-printings OFF** — *[HUMANO: panel admin M10 / API con JWT super_admin; y Railway env]*
  11. **Confirmar en Railway** que `POKEMONPRICETRACKER_FETCH_PRINTINGS` = `false` **o está ausente**
      (servicio `backend` → Variables). Si estuviera en `true`, ponerla `false` y redeploy. *(Verificado
      2026-08-24: no está en `.env` local; el default de código es `false`.)*
  12. **Flip:** `PUT https://<API_BASE>/api/v1/admin/settings` con `Authorization: Bearer <JWT super_admin>`,
      `Content-Type: application/json`, body **`{ "priceProvider": "tcgcsv_singles" }`** (🔴 **camelCase** —
      corregido 2026-09-10; con `price_provider` el backend responde **422** `unknown setting key`, §43.4).
      Respuesta = el DTO de settings ya con `priceProvider: "tcgcsv_singles"`. Queda auditado
      (`settings.update`).
  13. Verificar: `GET /api/v1/admin/settings` → `priceProvider` = `tcgcsv_singles`.

**(d) Primer barrido `tcgcsv_singles` + orden del scheduler** — *[HUMANO/orquestador con JWT super_admin]*
  - **Orden natural del scheduler (sin intervención):** `fx-refresh` (06:00 UTC) → `price-ingest` **2×/día
    00:00 y 12:00 UTC** (`PRICE_INGEST_CRON_1/_2`). En la primera corrida tras el flip, el job usa
    `tcgcsv_singles` y hace upsert idempotente de `PriceReference` por (carta, acabado, día) para **todos los
    sets en scope** (con inventario activo ∪ rares). No hay que esperar: se puede **forzar ya**.
  - **Barrido inmediato de TODO el catálogo en scope:** `POST /api/v1/admin/jobs/price-ingest` (body vacío)
    → `runBackground()` (fan-out por set vía BullMQ, reanudable). Progreso: `GET /api/v1/admin/pricing/sync-status`.
  - **`--force` por set (primer barrido de UN set, AWAITED, ignora el scope):**
    `POST /api/v1/admin/jobs/price-ingest` body `{ "setId": "<externalId o id interno>" }` →
    `priceIngest.run(setId)` fuerza **scope FULL aunque el set esté fuera de scope** (el operador lo pide
    explícitamente — `price-ingest.service.ts:246-257`). Úsalo para (1) el **set de verificación** del paso
    (e) y (2) cualquier **set nuevo** que quieras poblar por-acabado de inmediato sin esperar al cron.
    Repetible/idempotente (upsert por día).

**(e) Verificación post-activación** — *[HUMANO/quien tenga egress a prod]*

> ⚠️ **AMPLIADA EL 2026-09-10 (IMPORTANTE-1 de QA, `D-PP-2`).** Las tres comprobaciones originales (1–3)
> miran **el precio**. Están bien y se conservan. Lo que faltaba es que, desde la **fusión de la curva v2**,
> el barrido **hace dos cosas más** y **cuesta disco**: hoy no basta con mirar que la reverse tenga su
> precio. **4, 5 y 6 son obligatorias**, y las tres se miran **en las 24 h siguientes al flip**, no una
> sola vez a los cinco minutos: la primera corrida programada es la que enseña el régimen estable.
  1. **Precio por-acabado DISTINTO por acabado:** elegir un set con reverse/holo (forzarlo con el `--force`
     del paso (d) si hace falta) y consultar el catálogo/cotizador o la BD:
     ```sql
     SELECT c.name, pr."finish", pr."priceMxnCents", pr."source", pr."capturedDate"
     FROM "PriceReference" pr JOIN "Card" c ON c.id = pr."cardId"
     WHERE pr."source" = 'tcgcsv_singles' AND pr."capturedDate" = CURRENT_DATE
       AND pr."finish" IN ('normal','reverse_holo','holofoil')
     ORDER BY c.name, pr."finish";
     ```
     Éxito = para una misma carta, `normal` / `reverse_holo` / `holofoil` muestran precios **distintos** (no
     el mismo valor aplanado), con `source='tcgcsv_singles'` y `capturedDate` de hoy.
  2. **El override manual PERSISTE (P47-2 durable cross-day):** poner un override
     (`POST /api/v1/admin/pricing/override` `{cardId, finish, priceMxnCents, ...}`), disparar otra corrida de
     `price-ingest` del mismo set, y confirmar que la lectura del precio **sigue mostrando el override**
     (no lo pisa el barrido diario). El override es `isManualOverride=true` y gana como candidata perenne en
     la capa de lectura (v1.47 §4.27f-3).
  3. Frontend: la carta muestra los colores por-acabado (reverse rojo / holofoil azul, DS §16.6) con precios
     coherentes.
  4. 🔴 **LA COLA DE REVISIÓN, porque el barrido REPRECIA LO YA PUBLICADO.** Tras cada corrida,
     `reconcilePublishedPrices` re-deriva el precio de venta de **todas** las piezas `listed` del set (barre
     el **set completo**, no solo lo que trajo fila: el caso feo es el acabado que el proveedor **dejó de
     reportar**) y **abre o cierra** entradas de la cola. ⛔ **No cambia el `status`**: la pieza sigue
     `listed`; **la señal es la entrada en la cola**, y si nadie la mira no hay ninguna otra alarma.
     ```
     GET /api/v1/admin/pricing/pending?reason=premium_at_floor    # y ?reason=no_market
     ```
     **Qué es normal y qué no:** `no_market` **la cura sola** la siguiente corrida; **`premium_at_floor`
     necesita que el dueño mire** (una *chase* aterrizando en el piso solo puede significar dato de mercado
     malo, o piso mal calibrado). **Criterio de lectura:** compara `counts.premium_at_floor` **antes y
     después** del flip. Si sube y `no_market` se queda plano, **no es el flip: es el piso** (§4.36.5c).
     ⚠️ Esto **no existía** cuando se escribió este runbook: llegó con la curva v2.
  5. 🔴 **LAS PIEZAS QUE EL BARRIDO PUBLICA SOLO** (`triggerPublishForVariants`, commit `debb0c3`,
     2026-09-01). El barrido, tras repreciar, **re-evalúa para publicación** las variantes que acaba de
     escribir: una pieza `in_stock` que ya cumple sus guardas **pasa a `listed` sin que nadie pulse nada**.
     Es deliberado (`ARCHITECTURE §4.39m`, disparador (c) de BL-25) y es **dinero visible al cliente**, así que se verifica:
     ```
     # En los logs del backend, tras la primera corrida post-flip:
     #   "price-ingest → auto-publicadas N pieza(s) tras repreciar M variante(s)"
     ```
     y se contrasta con el inventario (`GET /api/v1/admin/inventory/items?status=listed&pageSize=1` →
     el `total` de la paginación) **antes/después**.
     **Qué se está comprobando de verdad:** que el salto de piezas publicadas sea **explicable** por el
     inventario que estaba esperando precio — no una avalancha. Si no cuadra, **la palanca es el dial**
     (§28.6: el barrido deja de correr con el proveedor nuevo), no despublicar a mano.
     ⚠️ **Aviso de gate, no de operación:** el triple veredicto de §28.1 es del **2026-08-24** y `debb0c3`
     es **posterior** ⇒ **este comportamiento no está cubierto por aquel veredicto**. Decidir si se re-gatea
     **no es de devops** (está enrutado al humano/orquestador en `PENDIENTES.md`); lo que sí es de devops es
     que quien ejecute este runbook **sepa que ocurre**.
  6. 🔴 **DISCO Y WAL — `P-53`, que es el riesgo VIVO de este barrido.** El barrido escribe **una fila por
     producto y por día, se muevan o no los precios**: medido en producción, **28,559 filas/día ≈ 13 MB/día**
     (el 2026-08-28 el ritmo saltó ×14 y **llenó el volumen de Postgres una vez**, alerta de Railway al 77 %).
     **Ninguna de las verificaciones originales lo mira, y es la que puede tumbar la plataforma entera**: con
     el disco lleno Postgres **deja de aceptar escrituras** (sin pedidos, sin altas, sin capturas).
     ```sql
     -- ritmo real de los últimos días (esto es lo que se proyecta, no el tamaño de hoy)
     SELECT "capturedDate", count(*) FROM "PriceReference" GROUP BY 1 ORDER BY 1 DESC LIMIT 7;
     -- peso de la tabla y de la base
     SELECT pg_size_pretty(pg_total_relation_size('"PriceReference"'));
     ```
     Y en la consola de Railway: `du -sh /var/lib/postgresql/data/pgdata/*` (mirar **`pg_wal`** aparte:
     llegó a ser **46 %** de lo ocupado, con **cero** replication slots).
     **Criterio de corte:** con el ritmo medido, **días de margen = (libre − 100 MB de holgura para compactar) ÷ 13 MB**.
     Si el margen baja de **30 días**, es una acción, no una nota: ampliar volumen (mitigación ya aplicada
     una vez), **bajar `max_wal_size`** (devops, exige reinicio con respaldo y ventana) y **escribir menos**
     (palanca de fondo: solo escribir ante cambio — **arquitecto → backend**, money-crítico, triple
     veredicto). ⚠️ **Una retención por antigüedad NO resuelve esto**: el problema es el **ritmo diario**,
     no la basura vieja. Detalle en `PENDIENTES.md` › **P-53**.

### 28.5 Qué requiere al HUMANO vs. qué preparó/ejecuta devops

| Paso | Quién | Cómo |
|---|---|---|
| Doc del dial `tcgcsv_singles` + `FETCH_PRINTINGS=false` en `.env.example` | **devops (HECHO)** | Editado en esta sesión. |
| Este runbook §28 | **devops (HECHO)** | `docs/DEVOPS_NOTES.md`. |
| `railway.json` / env nuevos | **devops** | **N/A** — no hacen falta (§28.2). |
| Merge `fix→main→production` + push a `production` | **HUMANO/orquestador** | git (§28.4a). devops **NO** pushea. |
| Confirmar deploy branch en dashboards | **HUMANO** | Railway/Vercel Settings. |
| Snapshot DB de prod | **HUMANO** | Railway Postgres. |
| Confirmar `POKEMONPRICETRACKER_FETCH_PRINTINGS=false` | **HUMANO** | Railway → backend → Variables. |
| **Flip del dial** a `tcgcsv_singles` | **HUMANO** | Panel admin M10 o `PUT /admin/settings` con JWT super_admin (§28.4c). |
| Primer barrido / `--force` por set | **HUMANO/orquestador** | `POST /admin/jobs/price-ingest` con JWT super_admin (§28.4d). |
| Verificación post-activación | **HUMANO** | SQL + UI (§28.4e). |
| Rollback si algo sale mal | **HUMANO** | Flip inverso (§28.6). |

### 28.6 ROLLBACK — reversible SIN migración ⚠️ **cierto para P-47, NO como doctrina** (ver §46.3)

> ⛔ **AVISO AÑADIDO 2026-09-10 (§46). No se ha tocado ni una letra del cuerpo de §28.6** —`D-PP-2`
> congela su literal, incluido el del `PUT`— pero el encabezado necesitaba esto:
>
> **«reversible sin migración» aquí es una afirmación sobre P-47, que efectivamente NO añadió
> migración** (§28.3: `git diff … -- backend/prisma/migrations` = 0). **NO es una regla general**, y
> leída como tal es peligrosa: **M-50 sí añade migración, es aditiva, y aun así el rollback
> sólo-código tumba el checkout** (`priceConvention` es `NOT NULL` sin default). Si el release que
> estás revirtiendo trae migraciones, **§28.6 no te cubre**: comprueba con
> `./scripts/rollback-safety-probe.sh <sha-destino>` y ve a **§46.1/§46.3**.
>
> **Y una asimetría de esta misma sección que sí conviene leer aquí (§46.2a):** el flip inverso del
> dial **hay que hacerlo A MANO**. El seed **no corre en el deploy** (comentado a propósito en
> `deploy.yml:254`), así que **revertir el commit NO revierte `price_provider`**. Es `I-PP3`.

- **Rollback del comportamiento de pricing (lo esperado si algo sale mal):** volver a flipear el dial.
  - `PUT /api/v1/admin/settings` body `{ "price_provider": "pokemontcg_io" }` (o `pokemonpricetracker` si ese
    era el proveedor previo deseado — **pero el seed y el rollback money-safe es `pokemontcg_io`**).
  - Surte efecto en la **siguiente corrida** del `price-ingest`, **sin redeploy y sin migración**. El dial es
    un ConfigSetting de BD; el cambio queda auditado.
  - **Datos:** las `PriceReference` con `source='tcgcsv_singles'` ya escritas quedan (son upserts por día,
    money-safe: no borran ni ponen $0). Al volver a `pokemontcg_io`, la siguiente corrida vuelve a escribir
    con la fuente legacy. Los **overrides manuales** siguen ganando (durables). No se requiere restaurar DB.
- **Rollback de código (solo si el deploy en sí está roto, no por el dial):** como **P-47 no añadió
  migración**, el rollback de código es un **redeploy del commit anterior** — Railway (backend →
  Deployments → Redeploy el deploy previo a `65c88d9`) y Vercel (Promote to Production del build previo), o
  `git revert` del merge de release y push. Sin restaurar DB (no hay schema nuevo que revertir).
- **Apagar el barrido por completo (extremo):** dejar el dial en `pokemontcg_io` **y** —si se quiere frenar
  también el cron— usar un cron que nunca dispare en `PRICE_INGEST_CRON_1/_2` (§19.7). No es necesario para
  el rollback normal del P-47.

> **Límites (devops):** §28 y `.env.example` NO tocan `backend/`, `frontend/` ni el contrato. Si el barrido
> `tcgcsv_singles` fallara por un bug del provider (p. ej. resolución de `groupId`, mapeo de `subTypeName`),
> el arreglo es de **rol backend**; devops reporta el error exacto y NO lo corrige. Si el set de verificación
> no existe aún en el catálogo, el import de metadata es prerequisito (§24).
## 29. Cut-over de **v2.0 — precio puro por valor de mercado** (P-48, M-41) — 2026-08-24

> **Rama:** `claude/card-pricing-rules-2e537m` (etapas **E0–E9**, de `586f736` a `HEAD`).
> **Fuente normativa:** `ARCHITECTURE.md` **§4.36** (spec) y **§4.36.9** (migración + cut-over).
>
> ### ✅ ESTADO: **TRES VEREDICTOS APROBADOS. Runbook LISTO. Deploy NO EJECUTADO.**
> | Gate | Estado |
> |---|---|
> | **QA** | ✅ aprobado — con una **brecha declarada** (los 80/80 de Playwright corrieron contra **mocks**). Se cierra por §29.10 **antes** del deploy. |
> | **techlead** | ✅ aprobado **con deuda** (no bloqueante, registrada en `docs/TECH_DEBT.md`). |
> | **seguridad** | ✅ **APROBADO — 0 críticos, 0 altos** (`docs/SECURITY_NOTES.md`, pase P-48; los medios/bajos S48-M1/M2 y P48-B1 se cerraron después en `6322ee3`, `a2d238e`, `1771a47`). |
>
> **Por qué sigue sin desplegarse, y no es un olvido:** faltan **dos insumos que solo aporta el dueño** —
> el **snapshot/PITR de la Postgres de producción** (paso 0, la red de seguridad del release) y la
> **ventana** en que se ejecuta. Devops no tiene egress a prod ni acceso a los dashboards; ese límite es
> el mismo de §26/§28 y no se disimula aquí. Lo que sí está listo es todo lo demás: pipeline sano,
> secuencia, verificación, rollback y el orden entre releases.
>
> **Numeración:** esta sección es **§29 y no §28** a propósito: `origin/main` ya tiene un
> **§28** (runbook de activación del dial `tcgcsv_singles`, P-47). Numerarla §29 evita el choque
> de encabezados cuando este stream mergee a `main`.
>
> **Cambios de esta revisión (2026-08-24, tras las tres decisiones del dueño):** §29.3 pasa de
> *recomendación* a **orden normativo** (P-47 primero, P-48 después, con criterio de corte explícito);
> §29.4 se parte en **29.4a deploy / 29.4b cut-over POR SETS / 29.4c lectura entre set y set**; y se añade
> **§29.10** (ruta NATIVA sin Docker para cerrar la brecha de E2E) y **§29.11** (verificación del DoD).

### 29.1 Resumen para el operador: qué cambia en INFRA (y qué NO)

| Dimensión | v2.0 (P-48) |
|---|---|
| **Variables de entorno** | **NINGUNA nueva.** La curva es **DATO** (setting `pricing_curve` en `ConfigSetting`), no configuración de entorno: se edita en M2 sin redeploy. Si algún día un cambio de pricing pide un env nuevo, es señal de diseño equivocado → **reportar al arquitecto, no agregarlo**. |
| **Migración** | **M-41** `20260824120000_m41_pricing_curve_instrumentation` — **ADITIVA PURA**: 3 enums + 8 columnas **nullable** + 1 índice. **Sin `DROP`, sin backfill, sin migración de dinero.** Segura con la app corriendo. |
| **Migración de dinero** | **NO EXISTE.** El precio de venta **no está persistido**: se resuelve **en lectura** (§4.26b). No hay filas de precio que reescribir. |
| **«Repriciar el catálogo»** | Es **RE-RESOLVER**, no un `UPDATE` masivo → `POST /admin/inventory/publish-all` (§29.4b), **por sets**. |
| **Settings viejos** | Las **cinco** claves retiradas quedan **huérfanas e INERTES**, **sin `DELETE`**: `sales_price_rules`, `sales_price_fallback_pct`, `buylist_price_rules`, `buylist_price_fallback_pct`, `pricing_tier_map`. **NO LAS BORRES** (§29.8). |
| **Seed** | **No se necesita** para el cut-over. Si la fila `pricing_curve` no existe, `SettingsService.get()` devuelve el **default de §N.2** (`SETTING_DEFAULTS`) — exactamente lo que el seed escribiría. La fila se materializa sola con el primer `PUT /admin/pricing/curve`. Correr `prisma/seed.ts` completo contra prod **no** es parte de este runbook (siembra usuarios/cartas demo). |
| **Sellado** | **Fuera de la curva** (§4.36.10): conserva íntegro su spread por presentación y su dial `sealed_spread_fallback_pct`. Verificable: **el precio de un sellado antes y después es idéntico**. |
| **Docker / compose / CI** | **Sin cambios.** Mismo `Dockerfile.backend` (su `CMD` corre `migrate deploy` antes de servir), mismos workflows, mismos gates SAST/DAST/E2E. |

### 29.2 Bloqueo resuelto — `post-deploy.sh` invocaba un script **borrado**

**Síntoma:** `scripts/post-deploy.sh` línea 87 hacía
`npx ts-node prisma/backfill-p34-tiered-pricing.ts`, y ese archivo **ya no existe**: la etapa **E8** lo
borró como parte del retiro sin residuos de la superficie de tiers. Con `set -euo pipefail`, el
post-deploy **entero** abortaba ahí → **release imposible de completar**.

**Arreglo (no sustitución):** el paso se **retiró del pipeline**. No hay nada que poner en su lugar:

- Ese backfill era el de **P-34/M-38** (reshape rareza→tier) y **ya cumplió su función**.
- Migraba justo las claves que v2.0 **dejó de leer**. Aunque no hubiera corrido, hoy sería un **no-op de
  comportamiento**: ningún camino de código lee esas cinco claves (verificado por grep en `backend/src/`
  y `backend/prisma/`; solo quedan comentarios de retiro explícitos).
- Con él se fue su **parada controlada** por «ACCIÓN REQUERIDA» (la ambigüedad rareza→tier de una tabla
  editada a mano). Ya no aplica: **no hay tablas de reglas** que colapsar — hay **una curva**.

**Además, en el mismo pase:**

- `post-deploy.sh` se renumeró (1 migraciones · 2 backfill M-39 · 3 unify-rarities · 4 **cut-over
  publish-all** · 5 **diagnóstico de la cola** · 6 nota D-3 · 7 sync de sellado) y su cabecera describe
  el estado real del release.
- **Verificado `bash -n scripts/post-deploy.sh` → OK** (y de nuevo tras los cambios de §29.4b).
- **Barrido de referencias muertas** en territorio devops (`scripts/`, `.github/workflows/`, `security/`,
  `docker-compose*.yml`, `Dockerfile.*`, `railway.json`, `.env.example`): **sin residuos** de
  `backfill-p34`, `tiered-pricing`, `pricing/tiers`, `tier-map`, `buylist-rules`, `sales-rules`,
  `sales-rarities` ni de las cinco claves retiradas. La **única** referencia viva estaba en la línea 87.
- **Fuera de mi territorio** (queda para su rol): `PENDIENTES.md` (líneas ~53-55) todavía lista
  `ts-node prisma/backfill-p34-tiered-pricing.ts` como paso 3 del «Al publicar». Es del **orquestador**;
  `docs/BACKEND_NOTES.md` §del backfill P-34 es de **backend**. Ninguna de las dos rompe el deploy
  (son documentación), pero conviene alinearlas para no reintroducir el paso muerto.

---

### 29.3 ORDEN ENTRE RELEASES — **P-47 PRIMERO, P-48 DESPUÉS** (decisión del dueño, NORMATIVA)

> **Esto ya no es una recomendación de devops: es el orden acordado.** Devops lo propuso, el dueño lo
> aceptó. Ejecutar los dos en la misma ventana **queda descartado**.

#### 29.3-1 Por qué, en una línea que conviene no olvidar

**P-47 cambia la FUENTE del precio de mercado** (flip del dial `price_provider` → `tcgcsv_singles`,
precio por-acabado diario desde TCGCSV, §28). **P-48 cambia la MATEMÁTICA que se aplica a esa fuente**
(la curva: `venta = redondeo↑(max(piso, mercado × markup(mercado)))`).

Y el detalle que obliga al orden, no solo lo aconseja: **P-48 pone el 100 % del peso sobre el dato de
mercado.** Con la curva no hay reglas por rareza ni por acabado que amortigüen un dato malo — si el
mercado dice una cifra, esa cifra decide el precio, y si no dice nada la pieza se retiene. Por eso **el
dato tiene que ser confiable ANTES de que la curva empiece a decidir precios**.

Si se encienden juntos y un precio se mueve raro, **no hay forma de separar si fue la fuente o la
matemática**: las dos variables cambiaron a la vez y no queda una lectura limpia contra la cual comparar.
Serializados, cada movimiento tiene un solo sospechoso.

#### 29.3-2 Secuencia

| Fase | Qué se hace | Runbook |
|---|---|---|
| **1** | **P-47**: merge/deploy + flip del dial a `tcgcsv_singles` + primer barrido | **§28** (ya en `origin/main`) |
| **2** | **VERIFICACIÓN de P-47** contra cartas conocidas — abajo | §29.3-3 |
| **3** | **CORTE**: ¿P-47 está estable? — criterio explícito abajo | §29.3-4 |
| **4** | **P-48**: merge/deploy de esta rama + cut-over **por sets** | §29.4a/§29.4b |

**Entre la fase 1 y la 4 tiene que haber al menos un ciclo COMPLETO del `price-ingest`.** El job corre
**2×/día (00:00 y 12:00 UTC)**; un barrido forzado (`POST /admin/jobs/price-ingest`) sirve para adelantar
sets concretos, pero el criterio de corte se toma sobre una corrida **programada** que haya pasado por el
catálogo en scope, no sobre un `--force` puntual. Un `--force` prueba que la ruta funciona; no prueba que
el barrido diario cubre el catálogo.

#### 29.3-3 Qué se verifica ENTRE uno y otro (contra cartas conocidas)

La verificación de §28.4e sigue siendo la base. Lo que se añade aquí es **el ancla contra cartas que el
dueño conoce de memoria**, que es lo único que detecta un dato *plausible pero equivocado* —un feed puede
devolver cifras perfectamente bien formadas y aun así estar mal mapeado:

1. **Elegir 8–10 cartas cuyo precio real el dueño sepa de memoria**, repartidas a propósito:
   - **al menos 2 de valor alto** (una chase moderna) — el tramo donde la curva aplica el markup más bajo
     y un error de fuente se traduce en pesos de inmediato;
   - **al menos 2 baratas** (bulk) — el tramo donde la curva topa contra el **piso**;
   - **al menos 2 con reverse holo y holofoil de la misma carta** — es exactamente lo que P-47 aporta
     (precio distinto por acabado) y lo que el proveedor viejo aplanaba.
2. **Comparar el mercado del día contra lo que el dueño espera**, por acabado:
   ```sql
   SELECT c.name, pr."finish", pr."priceMxnCents", pr."source", pr."capturedDate", pr."isManualOverride"
   FROM "PriceReference" pr
   JOIN "Card" c ON c.id = pr."cardId"
   WHERE c.name IN ('<carta 1>', '<carta 2>', '…')
     AND pr."capturedDate" = CURRENT_DATE
   ORDER BY c.name, pr."finish";
   ```
   **Éxito** = para una misma carta, `normal` / `reverse_holo` / `holofoil` dan cifras **distintas**, con
   `source='tcgcsv_singles'` y `capturedDate` de **hoy**, y los montos **caen donde el dueño espera**
   (no se busca el centavo exacto: se busca que no haya un orden de magnitud de diferencia ni un acabado
   pegado al de otro).
3. **Cobertura, no solo puntería.** Una fuente puede acertar en las 10 cartas del muestreo y aun así
   dejar medio catálogo sin dato — y bajo la curva, **sin dato = pieza retenida**:
   ```sql
   -- % de variantes en inventario de plataforma CON mercado de hoy
   SELECT round(100.0 * count(pr.id) FILTER (WHERE pr.id IS NOT NULL) / NULLIF(count(*), 0), 1) AS pct_con_mercado,
          count(*) AS variantes
   FROM (SELECT DISTINCT i."cardId", i."finish", i."productType"
         FROM "InventoryItem" i
         WHERE i."ownerType" = 'platform' AND i.status IN ('in_stock','listed')) v
   LEFT JOIN "PriceReference" pr
     ON pr."cardId" = v."cardId" AND pr."finish" = v."finish"
    AND pr."productType" = v."productType" AND pr."capturedDate" = CURRENT_DATE;
   ```
4. **Los overrides manuales siguen ganando** (P47-2, durable cross-day). Ya se verifica en §28.4e-2; se
   repite aquí porque bajo la curva el override es **absoluto** (§N.6) y conviene saber que sobrevivió al
   cambio de fuente **antes** de que la curva entre en juego.

#### 29.3-4 CRITERIO DE CORTE — «P-47 está estable, procede P-48»

Se procede con P-48 cuando **los cinco** se cumplen. Si falta uno, **no se procede**; y lo que falla se
enruta a su rol (fuente/ingest ⇒ **backend**; egress/dial/env ⇒ **devops**; dato de negocio ⇒ **dueño**).

| # | Condición | Cómo se comprueba |
|---|---|---|
| 1 | **≥ 2 corridas programadas** de `price-ingest` con `tcgcsv_singles` **sin fallo de barrido** | `GET /admin/pricing/sync-status` + logs; sin `403`/timeouts recurrentes contra `tcgcsv.com` |
| 2 | **`capturedDate` de HOY** para la mayoría del inventario de plataforma | la consulta de cobertura de §29.3-3-3 |
| 3 | **Cobertura ≥ 95 %** de variantes en inventario con mercado del día | misma consulta. **Este es el número que más importa para P-48**: bajo la curva, la variante sin dato **no se publica** — una cobertura del 80 % significa que **1 de cada 5 piezas se retiene** en el cut-over, y eso se leería como «la curva rompió el catálogo» cuando en realidad fue la fuente |
| 4 | **Precio distinto por acabado** en las cartas de muestreo, y **coherente** con lo que el dueño espera | §29.3-3-1/2 |
| 5 | **Sin sorpresas en la cola** durante ≥ 24 h con P-47 solo | `GET /admin/pricing/pending` → `counts`. `no_market` **estable o a la baja**. Si `no_market` está **subiendo** con P-47 solo, la fuente todavía se está asentando: **esperar**. Encender la curva sobre un `no_market` en ascenso garantiza no poder distinguir después qué causó qué |

> **La condición 5 es la que hace que el orden sirva de algo.** Es la lectura de la cola **antes** de que
> la curva exista, es decir, **la línea base**. Sin ella, el `counts` posterior al cut-over no se compara
> contra nada y la regla de diagnóstico de §29.4c se queda sin denominador. **Anota los dos números
> (`no_market` y `premium_at_floor`) en el momento del corte** — son el «antes» del release.
>
> **Ojo:** con P-47 solo, `premium_at_floor` **debería ser 0** — esa razón la introduce el guardarraíl de
> P-48 y antes del cut-over no existe. Si apareciera con valor > 0, es que ya hay código de v2.0
> desplegado y el orden se rompió: **parar**.

---

### 29.4 Secuencia de cut-over (§4.36.9c) — **con los tres veredictos ya dados**

Orquestada por `scripts/post-deploy.sh` (idempotente). Patrón §11.F para el env de prod.

#### 29.4a Deploy y salud (pasos 0–4)

| # | Paso | Comando / dónde | Bloquea | Notas |
|---|---|---|---|---|
| **−1** | **P-47 estable** (§29.3-4) | los 5 criterios de corte | **SÍ** | Prerrequisito de orden. No se salta. |
| **−0.5** | **E2E contra el stack real** (§29.10) | lo corre **QA** | **SÍ** | Cierra la brecha declarada por QA. El «verde» de mocks no autoriza un deploy que toca dinero. |
| 0 | **Snapshot / PITR de la Postgres de prod** | Railway → Postgres → Backups → *Create backup* | **SÍ** | Orden de oro (§7): **datos primero, código después**. Aquí no hay dinero que migrar, pero el snapshot es la red para cualquier sorpresa. **Lo aporta el dueño; devops no tiene acceso.** |
| 1 | **Merge a `main` + deploy** (Railway backend + Vercel frontend) | `deploy.yml` (auto desde `main`) o §26.3 | **SÍ** | Al arrancar, el contenedor aplica **M-41**. El frontend v2.0 (editor de curva) y el backend deben ir **juntos**: el editor de tiers ya no existe. |
| 2 | **Salud** | `GET /api/v1/health` → 200 (Redis `up`) | **SÍ** | No se toca dato hasta que la app esté sana. |
| 3 | **Verificar M-41 aplicada** | SQL de §29.6 | **SÍ** | 1 fila en `_prisma_migrations` + columnas/enums presentes. |
| 4 | **(Opcional) Fijar la curva** | M2 → editor de curva, o `PUT /admin/pricing/curve` | No | Si no se toca, rige el **default de §N.2** (idéntico al seed). El `POST /admin/pricing/curve/preview` permite **dry-run** antes de guardar. |

> **Entre el paso 1 y el 5 el catálogo YA está bajo la curva.** El precio de venta se resuelve **en
> lectura** (§4.26b): lo que estaba publicado adopta la curva **con el deploy**, sin que nadie corra nada.
> El `publish-all` **no es** lo que aplica la curva — es lo que **re-evalúa** cada pieza para publicar la
> que ahora resuelve y **retener** (escalar a la cola) la que no. Por eso el cut-over por sets es una
> operación de **observación y control**, no de aplicación.

#### 29.4b CUT-OVER **POR SETS** (paso 5) — decisión del dueño

> **No se repricia el catálogo completo de una sola vez.** La secuencia es: **repriciar UN set → revisar
> la cola de pendientes y unos cuantos precios → seguir con el siguiente**. `publish-all` acepta
> `setId`/`productType` justamente para esto.

**Por qué por sets, ahora que la cola ya no se vacía sola.** Con v2.1.1 una pieza `listed` que deja de
resolver precio **se escala a la cola y SIGUE `listed`** (escalar no le cambia el status). Eso convierte
el cut-over en algo **verificable de verdad**: hay un número —`summary.listedNowPending`— que dice *«de lo
que ya estaba a la venta, cuánto quedó retenido»*, y ese número **solo es interpretable en lotes chicos**.
Sobre el catálogo entero, un `listedNowPending` de 40 no dice si el problema está en un set concreto o
repartido; sobre un set de 30 piezas, sí.

##### Cómo se dispara

```bash
# Un set, desde el orquestador post-deploy (la batchKey se deriva del set — ver la trampa de abajo):
RUN_PUBLISH_ALL=1 \
PUBLISH_ALL_SET_ID='<uuid interno de CardSet>' \
ADMIN_BASE_URL='https://<API_BASE>/api/v1' ADMIN_JWT='<JWT super_admin>' \
  bash scripts/post-deploy.sh

# O a mano:
curl -X POST "$ADMIN_BASE_URL/admin/inventory/publish-all" \
     -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
     -d '{"batchKey":"p48-cutover-<setId>","setId":"<uuid interno de CardSet>"}'
```

##### ⚠️ Dos trampas verificadas en el código — leerlas antes del primer set

1. **`setId` es el `CardSet.id` INTERNO (uuid), NO el `externalId`.**
   `InventoryService.publishAll` resuelve `cardSet.findUnique({ where: { id: req.setId } })`, y el DTO
   (`PublishAllRequestDto`) solo valida `@IsString()`. Mandar `sv8pt5` o `cel25` da
   **`400 VALIDATION_ERROR`**. Es **asimétrico con `POST /admin/jobs/price-ingest`**, que sí acepta
   externalId o id interno (§28.4d) — no lo asumas por analogía. Cómo obtener el uuid:
   ```sql
   SELECT id, "externalId", name, "releaseDate" FROM "CardSet"
   WHERE "externalId" = 'sv8pt5';        -- o:  WHERE name ILIKE '%prismatic%'
   ```
   *(Paridad `externalId` en `publish-all` sería una mejora razonable; es **decisión del arquitecto** y
   cambio de **backend**, no de devops. Queda anotado, no ejecutado.)*

2. **La idempotencia por `batchKey` se evalúa ANTES de mirar los filtros.** El fast-path del
   `InventoryBatch` consulta la clave y, si existe, **devuelve el `resultJson` guardado** con
   `idempotentReplay:true` sin llegar a la selección. Consecuencia directa sobre el cut-over por sets:
   **reusar la misma `batchKey` con otro `setId` NO repricia el set nuevo** — devuelve el resumen del set
   **anterior**, y el operador lee un «ya está» que es **falso**. Por eso `post-deploy.sh` deriva la clave
   del set (`p48-cutover-<setId>`) y avisa en voz alta si detecta un replay. Si fijas
   `PUBLISH_ALL_BATCH_KEY` a mano, **que sea distinta por set**.

##### Qué set escoger primero — **recomendación, no imposición**

El objetivo del primer set no es repriciar mucho: es **calibrar la lectura** con el mínimo dinero
expuesto. Criterios, en orden de importancia:

| Criterio | Por qué |
|---|---|
| **Pocas piezas publicadas** (~10–40) | `listedNowPending` tiene que ser un número que se pueda **mirar pieza por pieza**. Si el primer set retiene 3, se abren 3 fichas y se entiende qué pasó. Con 300 no se entiende nada. |
| **Mercado bien cubierto** (≥ 95 % de sus variantes con `PriceReference` de hoy) | Es lo que separa las dos causas. Si el set entra con cobertura pobre, `no_market` se dispara **por la fuente**, no por la curva, y la primera lectura del release queda contaminada. |
| **Con rarezas premium publicadas** (≥ 3 piezas) | Sin premium, el guardarraíl `premium_at_floor` **nunca se dispara** y el set no prueba la mitad del cambio. Un set de puro bulk sale «perfecto» sin haber ejercitado nada. |
| **Precios repartidos** (barato / medio / caro) | La curva **interpola** entre puntos de quiebre. Un set de un solo bracket verifica un solo tramo. |
| **Un solo set-id** (no multi-parte) | Los master sets de §L (Celebrations `cel25`+`cel25c`, Shiny Vault `swsh45sv`, `sma`) viven como **dos** set-ids: el filtro `setId` toma **una sola parte** y el binder mostraría el set **repriciado a medias**. Confunde la lectura sin ganar nada. |
| **Que NO sea el set destacado del home** (`HOME_FEATURED_SET_ID`, hoy `sv8pt5` Prismatic Evolutions) | Es el hero de la portada: máximo radio de exposición. Mal candidato para el primer intento. |
| **Que NO sea el set que se esté validando en P-47** (p. ej. Pitch Black / ME05, §26.6) | Su cobertura de mercado es **justo la variable bajo prueba** en la fase anterior. Usarlo confunde fuente con matemática — exactamente lo que §29.3 evita. |
| **Que NO sea sellado** (`productType=sealed`) | El sellado está **fuera de la curva** (§4.36.10): repriciarlo no prueba nada de P-48. `post-deploy.sh` avisa si se pide. |

**Consulta para rankear candidatos** (correr en prod, solo lectura):

```sql
WITH inv AS (
  SELECT i.id, i."cardId", i.finish, i."productType", i.status, c."setId", c.rarity
  FROM "InventoryItem" i
  JOIN "Card" c ON c.id = i."cardId"
  WHERE i."ownerType" = 'platform'
    AND i.status IN ('in_stock','listed')
    AND i."productType" <> 'sealed'          -- el sellado no entra a la curva
), cov AS (
  SELECT inv.*, (pr.id IS NOT NULL) AS con_mercado
  FROM inv
  LEFT JOIN "PriceReference" pr
    ON pr."cardId" = inv."cardId" AND pr.finish = inv.finish
   AND pr."productType" = inv."productType" AND pr."capturedDate" = CURRENT_DATE
)
SELECT s.id                AS set_uuid,          -- ← ESTE es el valor de PUBLISH_ALL_SET_ID
       s."externalId", s.name, s."releaseDate",
       count(*)                                          AS piezas,
       count(*) FILTER (WHERE status = 'listed')         AS publicadas,
       round(100.0 * count(*) FILTER (WHERE con_mercado) / count(*), 1) AS pct_mercado_hoy,
       count(*) FILTER (WHERE rarity IS NOT NULL AND rarity NOT IN
         ('Common','Uncommon','Rare','Rare Holo','Reverse Holo','Promo'))  AS piezas_premium_aprox
FROM cov JOIN "CardSet" s ON s.id = cov."setId"
GROUP BY s.id, s."externalId", s.name, s."releaseDate"
HAVING count(*) FILTER (WHERE status = 'listed') BETWEEN 10 AND 40
ORDER BY (round(100.0 * count(*) FILTER (WHERE con_mercado) / count(*), 1)) DESC,
         count(*) FILTER (WHERE status = 'listed') ASC;
```

> `piezas_premium_aprox` es una **aproximación operativa**: excluye las seis canónicas NO premium del
> catálogo (`backend/src/common/rarity-catalog.ts`). La **autoridad** es `isPremiumCanonicalRarity()`, que
> además resuelve alias y patrones; para una lectura exacta por rareza, `GET /admin/pricing/rarities`.
> Si la consulta y esta guía se contradicen, **manda la consulta**: describe el inventario real de prod,
> que devops no puede ver desde aquí.

**Recomendación concreta:** el **primer candidato de esa lista** (mayor cobertura, menos piezas
publicadas) que además traiga **≥ 3 premium**. Si el ranking deja arriba un set con 0 premium, tómalo
igual como **primer set** —es el más barato de equivocarse— pero **no des el guardarraíl por verificado**:
elige como **segundo** uno con premium, y hasta entonces no lo declares probado.
Y si `HAVING` devuelve vacío (ningún set entre 10 y 40 publicadas), afloja el rango antes que abandonar la
secuencia por sets: **un set grande revisado sigue siendo mejor que el catálogo entero sin revisar**.

#### 29.4c Lectura ENTRE set y set — los tres números que decide el dueño

Después de **cada** set, antes de disparar el siguiente. `post-deploy.sh` imprime los tres.

**① `summary.listedNowPending`** — *de lo que ya estaba a la venta, cuánto quedó retenido.*

Es el número que contesta la pregunta del dueño, y **no se deduce de ningún otro**: `pendingPrice` mezcla
lo que **nunca** estuvo publicado, y `alreadyListed` **cambió de significado** en v2.1.1 (pasó de «no la
toqué» a «la re-verifiqué y está **sana**»). Va **fuera** de la partición
`selected = published + alreadyListed + pendingPrice + failed`.

| Lectura | Qué significa | Qué se hace |
|---|---|---|
| `listedNowPending = 0` | Nada de lo que se vendía dejó de venderse. | Seguir con el siguiente set. |
| **Unas pocas** (1–3 en un set chico) | Piezas que la matemática vieja publicaba **mal** y la curva retiene. **Es el cambio funcionando, no un fallo.** | Abrir esas fichas en M2 y confirmar una por una que el precio viejo era el equivocado. Recién ahí, seguir. |
| **Muchas** (una fracción visible del set) | La curva está reteniendo inventario sano. | **PARAR.** No repriciar el siguiente set. Ir a ②/③ para saber si es piso o feed. |

> Estas piezas **siguen `listed`** pero están **fuera de Compra** y **no cuentan en `stockCount`** — no hay
> exposición abierta ni dinero en riesgo, pero **tampoco se venden**. La retención es visible en la cola,
> que es exactamente la diferencia contra el bug original: antes esto pasaba **en silencio**.

**② y ③ `counts` de la cola por razón** — `GET /admin/pricing/pending` → `{ no_market, premium_at_floor, unknown }`.

Los `counts` **ignoran `?reason=` y la paginación** y **respetan `?context=`**: describen **la cola**, no
la página que estés viendo. (Derivarlos de la página cargada mentiría justo cuando el dueño filtra para
triar.)

> ### REGLA DE DIAGNÓSTICO (`ARCHITECTURE §4.36.5c`) — los dos conteos SOLO se leen JUNTOS
>
> | Patrón | Diagnóstico | Acción |
> |---|---|---|
> | **`premium_at_floor` SUBE** y **`no_market` PLANO** | **PISO MAL CALIBRADO.** Hay dato de mercado (por eso `no_market` no se mueve), pero la curva aterriza cartas premium en el piso ⇒ el piso está por debajo de lo que esas cartas valen. | **Se corrige en el EDITOR de la curva (M2)**: subir el piso, `POST /admin/pricing/curve/preview` para ver el efecto **en pesos** antes de guardar, `PUT` y **repriciar el mismo set con otra `batchKey`**. |
> | **SUBEN LOS DOS** | **FEED DEGRADADO.** Falta dato de mercado en volumen; las premium que sí lo tienen caen al piso por arrastre. | **NO TOCAR EL PISO.** Un piso inflado para tapar un feed caído **empeora el precio cuando el feed se recupere** — y ese precio malo ya no se nota, porque el síntoma desapareció. Se arregla el **ingest** (rol **backend**) y se repricia después. |
>
> **Línea base esperada: `premium_at_floor` ≈ 3 de cada 333 cartas** (§4.36.9c-3) — algo así como **0,9 %**.
> Muy por encima **no es un guardarraíl ruidoso**: es una de las dos causas de arriba.

**Si el PRIMER set se sale de la línea base:**

1. **PARAR.** No repriciar el siguiente set. Cada set adicional añade ruido a un diagnóstico que todavía
   no está hecho.
2. **Clasificar** con la tabla de arriba, comparando contra la línea base que se anotó en el corte de
   P-47 (§29.3-4-5). Sin ese «antes», los `counts` no se comparan contra nada.
3. **Enrutar** — **no lo arregla devops**:
   - **piso mal calibrado ⇒ el DUEÑO**, en el editor de la curva (M2). Es un dial de negocio, sin deploy.
   - **feed degradado ⇒ BACKEND** (ingest/proveedor). Puede implicar volver a `pokemontcg_io` (§28.6):
     ojo, **eso es rollback de P-47, no de P-48** — y confirma que serializar fue lo correcto, porque
     revertir la fuente **sin** tocar la matemática es una operación limpia.
   - **la curva en sí está mal especificada ⇒ ARQUITECTO** (§4.36).
4. **No se anuncia el release.** Un set repriciado con la cola fuera de rango no es un cut-over parcial
   exitoso: es un diagnóstico pendiente.
5. **Repetir el set** tras el arreglo, **con otra `batchKey`** (misma clave = replay, §29.4b-2).

**Además de los tres números, mirar unos cuantos PRECIOS** (es lo que el dueño pidió y ningún contador
sustituye): abrir 5–10 fichas del set en Compra y confirmar que el precio publicado tiene sentido — sobre
todo en los **extremos** (la más barata y la más cara), que son los tramos donde la curva y el piso se
encuentran. El bug original (**MX$1.31 / MX$3.71** con un supuesto piso de **MX$15**) se veía a simple
vista en una ficha; no hacía falta un reporte.

#### 29.4d Cierre (pasos 6–8)

| # | Paso | Comando / dónde | Bloquea | Notas |
|---|---|---|---|---|
| 6 | **Revisión de OVERRIDES heredados** | M2, binder por variante (§29.5) | No (pero es **del dueño**) | Tarea humana, no automatizable. |
| 7 | **Instrumentación viva** | `GET /admin/reports/pricing-brackets?axis=sale\|buy` | No | Tras la primera venta y la primera compra deben existir los cinco campos y agregar por bracket. |
| 8 | **Anunciar / taggear** | tag de release | — | Solo con **todos los sets** repriciados, la cola dentro de la línea base y §29.10 en verde. |

### 29.5 Overrides heredados — **tarea del dueño, no del script** (§4.36.9c-5)

Los overrides manuales (`InventoryItem.listPriceCents`, `VariantPriceOverride.sellOverrideCents` /
`buyOverrideCents`) **se conservan intactos**: §N.6 los declara **absolutos**. Pero algunos pudieron
fijarse creyendo la etiqueta falsa «Piso (MX$)» del editor viejo — **la causa raíz de P-48**. Con la
curva, ese override **sigue ganando** y puede quedar por debajo de lo que la curva cobraría/pagaría hoy.

**El código no puede distinguir un override deliberado de uno mal informado**, y adivinar sería
exactamente el error que este cambio corrige. **Norma: no se tocan automáticamente.** La comparación ya
es visible sin endpoint nuevo: el binder expone `pricing.buy/sell.suggestedCents` (curva) junto a
`overrideCents`. **Ningún script de devops modifica overrides** — ni este ni ninguno.

> **Nota para el cut-over por sets:** una pieza con override **no aparece** en `listedNowPending` (su
> precio resuelve, por el override). Es decir, **el recorrido por sets no revela los overrides mal
> informados**: son un barrido aparte, del dueño, y no bloquean el release.

### 29.6 Verificación post-deploy (SQL + HTTP)

```sql
-- 1) M-41 aplicada
SELECT migration_name FROM "_prisma_migrations"
WHERE migration_name = '20260824120000_m41_pricing_curve_instrumentation'
  AND finished_at IS NOT NULL;                      -- → 1 fila

-- 2) Instrumentación presente (venta y compra)
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name = 'OrderItem'      AND column_name IN ('marketMxnCents','priceBasis','marketBracket','finish'))
   OR (table_name = 'SellRequestItem' AND column_name IN ('marketMxnCents','priceBasis','marketBracket'))
   OR (table_name = 'PendingPriceEntry' AND column_name = 'reason');   -- → 8 filas

-- 3) Enums nuevos
SELECT unnest(enum_range(NULL::"MarketBracket"));   -- → lt_3 … gte_300 (escala FIJA)
SELECT unnest(enum_range(NULL::"PriceBasis"));      -- → market, floor, override, bounty, pending

-- 4) La curva (0 filas = corriendo con el default de §N.2, es VÁLIDO)
SELECT key, "updatedBy" FROM "ConfigSetting" WHERE key = 'pricing_curve';

-- 5) Las cinco INERTES deben SEGUIR AHÍ (NO se borran — §29.8)
SELECT key FROM "ConfigSetting" WHERE key IN
  ('sales_price_rules','sales_price_fallback_pct','buylist_price_rules',
   'buylist_price_fallback_pct','pricing_tier_map');

-- 6) Sellado INTACTO (§4.36.10: fuera de la curva). Anota el precio de 2-3 sellados ANTES
--    del deploy y compáralo DESPUÉS: debe ser IDÉNTICO (criterio 85).
SELECT i.folio, i."sealedProductName", i."listPriceCents"
FROM "InventoryItem" i WHERE i."productType" = 'sealed' AND i.status = 'listed' LIMIT 5;
```

**HTTP (super_admin):**

```bash
curl -sS "$ADMIN_BASE_URL/admin/pricing/curve"           -H "Authorization: Bearer $ADMIN_JWT"
curl -sS "$ADMIN_BASE_URL/admin/pricing/pending"         -H "Authorization: Bearer $ADMIN_JWT"   # counts por razón
curl -sS "$ADMIN_BASE_URL/admin/reports/pricing-brackets?axis=sale" -H "Authorization: Bearer $ADMIN_JWT"
```

**Señal de alarma en logs:** `[MONEY] El setting pricing_curve es INVÁLIDO en BD` significa que alguien
editó la fila a mano y quedó corrupta: el backend **no apaga el catálogo** (cae al seed de §N.2 —
«siempre hay curva»), pero **el precio publicado no es el configurado**. Se arregla con
`PUT /admin/pricing/curve`. **Alerta pendiente sobre ese patrón en el log drain** (§8) — es la deuda
**S48-I4** de `SECURITY_NOTES §5`, dueño **devops**, disparador «con el primer alerting real».

### 29.7 Rollback de P-48/M-41 — ⚠️ **cierto para M-41, NO como doctrina** (ver §46.3)

> ⛔ **AVISO AÑADIDO 2026-09-10 (§46).** La frase de abajo es correcta **para M-41** y la fila
> «¿Y las columnas de M-41?» explica exactamente por qué: **«las 8 columnas nullable … son
> inertes»**. Ése —*nullable*— es el criterio de verdad, no el adjetivo «aditiva». Enunciada sin él,
> la regla es falsa: **M-50 es aditiva y su rollback sólo-código tumba el checkout**
> (`priceConvention` es `NOT NULL` **sin default**).
>
> Antes de aplicar esta sección a un release que no sea P-48:
> `./scripts/rollback-safety-probe.sh <sha-destino>` — **verde** ⇒ vale tal cual; **rojo** ⇒ hay paso
> de datos, ve a **§46.1/§46.3**.

**Rollback = redeploy del commit anterior. No se restaura la DB para revertir código.**

| Escenario | Acción |
|---|---|
| **App v2.0 rota / precios inesperados** | Railway (`backend` → Deployments → **Redeploy** del deploy previo bueno) y Vercel (**Promote to Production** del build previo). Alternativa Git: `git revert` del merge + push. **Backend y frontend se revierten JUNTOS** (el M2 v2.0 habla con endpoints que el backend viejo no tiene, y viceversa). |
| **¿Y las columnas de M-41?** | **Aditiva ⇒ no estorba.** Para el código viejo, las 8 columnas nullable y el índice son **inertes**; sigue insertando `null` en ellas. **No se revierte la migración** (no hace falta y `migrate resolve --rolled-back` sobre una aditiva solo genera ruido). |
| **¿Y la matemática?** | El resolver viejo **vuelve solo**: sigue en la imagen anterior y sus cinco settings **siguen en BD, íntegros** (por eso **no se borran**). Rollback barato **exactamente** por esa decisión. |
| **¿Y la fila `pricing_curve`?** | Inerte para el código viejo (nadie la lee). Se deja; si se vuelve a v2.0, la configuración del dueño sigue ahí. |
| **¿Y lo que publicó el cut-over?** | Esas piezas quedan `listed` y, bajo el código viejo, **vuelven a precio con la matemática vieja** (la de P-48, la del bug). No hay corrupción de datos, pero **es la consecuencia real de revertir**: si se revierte, se revierte el precio de todo, no solo de lo nuevo. Despublicar pieza por pieza es manual (M2) y solo se hace si el dueño lo pide. |
| **Rollback a MITAD del cut-over por sets** | **No hay estado partido que reparar.** Los sets ya repriciados no quedan «a medio migrar»: el precio se resuelve **en lectura**, así que al revertir el código **todos** los sets —repriciados o no— vuelven a la matemática vieja a la vez. Las entradas de cola creadas por el guardarraíl quedan **abiertas e inertes** (el código viejo no las lee) y se cierran solas al volver a v2.0 y re-resolver. Los `InventoryBatch` de las `batchKey` usadas **se conservan**: si se vuelve a v2.0, hay que usar **claves nuevas** para repriciar de verdad (§29.4b-2). |
| **Rollback SOLO de la fuente (P-47)** | Flip inverso del dial: `PUT /admin/settings` `{"price_provider":"pokemontcg_io"}` (§28.6). **Sin redeploy y sin migración.** Que esto sea una palanca independiente de la curva es **el beneficio operativo de haber serializado** (§29.3). |
| **Migración falla al aplicar** | Prisma envuelve cada migración en su tx → **rollback atómico**; el contenedor sale ≠0, Railway **mantiene activo el deploy anterior**. Prod sigue sirviendo el código viejo. |
| **Corrupción de datos (no rollback de código)** | Única razón para restaurar el snapshot del paso 0. |

**No se requiere ventana de riesgo** (§4.36.9d / §N.9): no hay dinero vivo en tránsito que la migración
toque. Aun así, el cut-over se hace **fuera de hora pico** por el volumen del `publish-all`.

### 29.8 Anti-checklist — lo que **NO** se hace en este release

1. **NO borrar** las cinco claves inertes (`sales_price_rules`, `sales_price_fallback_pct`,
   `buylist_price_rules`, `buylist_price_fallback_pct`, `pricing_tier_map`). Borrar configuración en el
   mismo paso que cambia la matemática **mata el diagnóstico y el rollback barato** (§4.36.9b, mismo
   precedente que `rarity_map` en v1.32). La limpieza es un **follow-up** posterior, con su propia
   migración y su propia decisión. **Ojo al parecido:** `sealed_spread_fallback_pct` **NO** es una de
   ellas — el sellado sigue vivo y fuera de la curva.
2. **NO hacer `UPDATE` masivo de precios.** No hay precio de venta persistido que actualizar.
3. **NO tocar** `InventoryItem.listPriceCents` ni `VariantPriceOverride.*` (§29.5).
4. **NO agregar variables de entorno.** La curva es dato. Si algo parece necesitar env nuevo →
   **reportar al arquitecto**.
5. **NO correr `prisma/seed.ts` completo contra prod** (siembra demo). El default de la curva ya aplica
   por lectura.
6. **NO re-crear** `backfill-p34-tiered-pricing.ts` ni ningún equivalente.
7. **NO encender P-47 y P-48 en la misma ventana** (§29.3). Decisión del dueño, no preferencia de devops.
8. **NO repriciar el catálogo completo de una pasada** salvo que el recorrido por sets ya haya cerrado y
   solo quede el remanente (§29.4b).
9. **NO reusar la misma `batchKey` entre sets** — devuelve el resumen del set anterior y el set nuevo no
   se repricia (§29.4b-2).
10. **NO subir el piso para acallar la cola sin haber mirado `no_market`** (§29.4c). Si el feed está
    degradado, el piso inflado **empeora el precio cuando el feed vuelva**, y ya sin síntoma que lo delate.
11. **NO desplegar con el «verde» de mocks como única evidencia de E2E** (§29.10).

### 29.9 M-41: contenido y serialización de migraciones

**Contenido** (`backend/prisma/migrations/20260824120000_m41_pricing_curve_instrumentation/`):

1. `CREATE TYPE "PriceBasis"` (`market`, `floor`, `override`, `bounty`, `pending`).
2. `CREATE TYPE "MarketBracket"` (`lt_3`, `r3_10`, `r10_25`, `r25_80`, `r80_300`, `gte_300`) — **escala
   fija**: cambiarla parte la serie histórica.
3. `CREATE TYPE "PendingPriceReason"` (`no_market`, `premium_at_floor`).
4. `OrderItem` += `marketMxnCents`, `priceBasis`, `marketBracket`, `finish` (todas nullable).
5. `SellRequestItem` += `marketMxnCents`, `priceBasis`, `marketBracket` (nullable).
6. `PendingPriceEntry` += `reason` (nullable) + índice `PendingPriceEntry_reason_idx`.

**Sin `DROP`, sin `UPDATE`, sin backfill.** Las filas históricas quedan en `null` a propósito (`null` =
«anterior a M-41»); `reason` **no** entra a la clave de dedupe de la cola, así que filas viejas y nuevas
conviven sin duplicar.

**¿Hay que serializar M-41 contra otras migraciones pendientes? — Verificado con git: NO hay conflicto.**

| Ref | Última migración | Nota |
|---|---|---|
| `origin/main` (`d9c8c91`) | `20260823130000_m40_pending_sealed_product` | M-39/M-40 ya mergeadas; trae P-47/§28. |
| `origin/production` (`c255692`) | `20260823130000_m40_pending_sealed_product` | Rama-registro de releases. |
| `origin/claude/card-pricing-rules-2e537m` (esta) | **`20260824120000_m41_…`** | **Única migración por delante de `main`.** |
| Resto de ramas remotas | ≤ M-40 | Ninguna otra rama abierta añade migraciones. |

- **M-41 es la única migración pendiente del repo.** No hay colisión de timestamp ni orden ambiguo:
  Prisma aplica por nombre (lexicográfico) y `20260824120000` > `20260823130000`.
- La **serialización** que pide `ARCHITECTURE §4.36.9a` es la de **zona compartida** (`backend/prisma/`,
  regla de work streams): **este stream es el único que la toca** en la ventana actual. Mientras M-41 no
  esté en `main`, **ningún otro stream debe crear migraciones**; si lo hace, el orquestador serializa
  (M-41 primero, y la otra se re-fecha por encima).
- **P-47 no añade migración** (§28.1), así que el orden P-47→P-48 de §29.3 **no** condiciona el orden de
  migraciones: son dos ejes independientes. El merge de esta rama sobre `main` **incorpora** P-47 (que ya
  está allí) y no lo revierte.
- **`migrate deploy` corre solo:** el `CMD` de `Dockerfile.backend`
  (`prisma migrate deploy && node dist/main.js`) garantiza **migración antes de servir**. El código v2.0
  nunca sirve sin las columnas de M-41. `healthcheckTimeout: 300` en `railway.json` da holgura.

---

### 29.10 E2E: cerrar la brecha de los MOCKS — **ruta NATIVA soportada** (sin Docker)

> **Hallazgo de QA, aceptado:** los **80/80 de Playwright corrieron contra MOCKS.** Sin `E2E_BASE_URL`,
> `frontend/playwright.config.ts:65-73` levanta `npm run dev` con **`NEXT_PUBLIC_USE_MOCKS=true`**. Ese
> verde demuestra **«la UI es consistente con sus propias simulaciones»**, **no** «frontend y backend
> concuerdan». Para un release que **cambia la matemática del dinero en los dos ejes**, no alcanza.
>
> **Reparto:** **devops CABLEA el camino** (esta sección + `scripts/stack-native.sh`); **QA lo EJECUTA y
> emite el veredicto** (`CLAUDE.md`: las suites las escriben frontend/backend, QA las corre).

#### 29.10-1 Por qué la ruta documentada en §5.1 no basta hoy

`e2e-real.yml` y `docker-compose.staging.yml` **siguen siendo la ruta canónica en CI** y no cambian.
Pero **en el entorno de trabajo del equipo NO hay demonio de Docker** (`/var/run/docker.sock` no
existe), así que `docker compose -f docker-compose.staging.yml up` **no arranca**. Documentar solo esa
ruta equivale a no documentar ninguna: es la razón por la que la verificación real se venía saltando y el
verde de mocks pasaba por suficiente.

#### 29.10-2 La ruta NATIVA — verificada, no supuesta

Tres agentes la recorrieron en este entorno:

| Quién | Qué levantó | Resultado |
|---|---|---|
| **QA** | `pg_ctlcluster 16 main start` + `redis-server --daemonize yes` + `prisma migrate deploy` | **126/127** de integración |
| **pentester** | stack **Nest completo** con `ts-node src/main.ts` en `localhost:3099` | todos los guards y pipes **activos** (no un arnés recortado) |
| **devops** | `scripts/stack-native.sh` (une las dos + el frontend) | Stack COMPLETO arriba: `GET :3099/api/v1/health` → **200** (`db:up`, `redis:up`), M-41 aplicada, `GET :3000/es/compra` → **200**. Y **el cableado frontend→backend verificado, no supuesto**: los chunks servidos (`app/[locale]/(storefront)/compra/page.js`, `layout.js`) llevan **`localhost:3099`** horneado ⇒ `NEXT_PUBLIC_API_BASE_URL` se inyectó y `NEXT_PUBLIC_USE_MOCKS=false` está en efecto |

```bash
# 1) Stack real nativo (Postgres + Redis + migraciones + backend :3099 + frontend :3000 con mocks=false)
./scripts/stack-native.sh up

# variantes
./scripts/stack-native.sh up --infra   # solo PG + Redis + migrate  → para `npm run test:integration`
./scripts/stack-native.sh up --seed    # + npm run seed:synthetic (datos E2E deterministas)
./scripts/stack-native.sh status
./scripts/stack-native.sh down         # apaga apps; PG/Redis siguen (datos intactos)
./scripts/stack-native.sh down --all   # + para PG y Redis
```

> **Si un componente se cae entre sesiones, vuelve a correr `up`: es idempotente.** Observado en este
> entorno — un proceso lanzado en una shell puede no sobrevivir a que esa shell termine (el backend
> aguantó, el `next dev` no). `up` detecta lo que ya responde y **solo levanta lo que falta**; no
> reinicia lo sano, no re-migra y **no toca datos**. Antes de correr la suite, un
> `./scripts/stack-native.sh status` con **200 en backend y frontend** ahorra diagnosticar como bug de
> la app lo que es un proceso caído.

#### 29.10-3 El subset `@real` de Playwright — **ya está cableado en `frontend/`**

Verificado en `frontend/playwright.config.ts`: **no hace falta tocar nada del frontend.**

- **`E2E_BASE_URL` presente ⇒ `webServer: undefined`** — Playwright **NO** levanta su server de mocks.
  Ésa es, literalmente, la línea que cierra la brecha.
- **`E2E_REAL=1` ⇒ `grep: /@real/`** — corre **solo** los specs diseñados para el backend real
  (autentican de verdad vía `utils/auth.loginAs`, descubren datos del seed y asertan **estructura**, no
  montos de fixture). Hoy son **8 archivos**: `catalog` · `checkout` · `shipments` · `buylist` ·
  `guest-checkout` · `vault` · `master-set` · `pricing-curve`.

```bash
cd frontend
# ✅ MODO GATE — el subset @real contra el stack vivo. Es el ÚNICO que contesta
#    «¿frontend y backend concuerdan?». Número legítimo: TODO en verde.
E2E_BASE_URL=http://localhost:3000 E2E_REAL=1 npm run test:e2e

# ⚠ MODO EXPLORATORIO — NO ES GATE. Suite completa sin E2E_REAL ⇒ sin grep…
#   …pero TAMPOCO hay login real (ver el recuadro de abajo). Su rojo no mide nada.
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

> **⚠ CORRECCIÓN 2026-08-24 (IMPORTANTE-2 de QA). Esta sección afirmaba que la suite completa contra el
> stack real era «la corrida que de verdad contesta ¿frontend y backend concuerdan?». ERA FALSO, y falso
> POR CONSTRUCCIÓN.** `E2E_REAL` es **una sola bandera con dos efectos**:
>
> | Efecto | Dónde | Qué hace |
> |---|---|---|
> | Selecciona el modo | `playwright.config.ts:40` | `grep: /@real/` |
> | **Enciende el login real** | `e2e/utils/auth.ts:24` (`IS_REAL`) | `loginAs()` canjea las credenciales del seed contra `POST /auth/login` |
>
> Sin `E2E_REAL`, `loginAs()` cae a su rama mock e inyecta un token de mentira
> (`'mock.session.token'`, `e2e/utils/auth.ts:112-127`) **mientras la app habla con el backend REAL**.
> El backend responde **401** y la app rebota a login en bucle: **todo lo que exija sesión muere ahí**,
> incluidos los `@real` (que en este modo corren sin el filtro *y* sin login real). Es decir: **el modo
> que el runbook vendía como gate es exactamente el que no puede autenticar.**
>
> **Medición de QA (24-ago-2026): 59 rojos de 85.** Esa cifra es un **artefacto del helper**, no una
> señal del stack: **no se lee como gate ni se cita como cobertura en ningún veredicto.** La causa **no**
> son «specs mock-only con fixtures», como decía la redacción anterior.
>
> **Qué esperar de cada modo, hoy:**
>
> | Modo | ¿Gate? | Número legítimo |
> |---|---|---|
> | `E2E_BASE_URL` + `E2E_REAL=1` | **SÍ** | **subset `@real` entero en verde** (8 archivos: `catalog` · `checkout` · `shipments` · `buylist` · `guest-checkout` · `vault` · `master-set` · `pricing-curve`). Un rojo aquí SÍ es hallazgo: o el stack no concuerda, o falta `up --seed`. |
> | `E2E_BASE_URL` sin `E2E_REAL` | **NO** | **ninguno**. Sólo sirve para lo que no toca sesión (copy/i18n, términos, rutas públicas). |
>
> **Dueño del arreglo: `frontend`** (`frontend/e2e/utils/auth.ts` es suyo; devops no toca `frontend/`).
> Ya está enrutado. **Hasta que frontend reporte que este modo autentica de verdad, aquí no se promete
> ningún número** — y cuando lo reporte, esta sección y `scripts/stack-native.sh` se actualizan otra vez.
>
> **Chromium:** el config apunta a `/opt/pw-browsers/chromium`. Si no existe:
> `npx playwright install --with-deps chromium` (o `PLAYWRIGHT_CHROMIUM_PATH=…`).

#### 29.10-4 Qué NO cubre la ruta nativa (dicho, no disimulado)

| Hueco | Consecuencia | Mitigación |
|---|---|---|
| **Sin MinIO/R2** | La subida del **INE del buylist** (sobre el tope AML) no se ejercita. | Ruta Docker en CI, o levantar MinIO aparte. **Fuera del delta de P-48** (`uploads` no se tocó). |
| **Corre `ts-node` sobre el fuente, no la imagen de `Dockerfile.backend`** | Prueba el **código**, no el **artefacto** de producción. | El gate del artefacto sigue siendo **`e2e-real.yml` en CI**, que sí construye y usa la imagen. La ruta nativa **complementa**, no sustituye. |
| **Sin egress** | `pokemontcg.io` / `tcgcsv.com` → **403**. El catch-up de `price-ingest` lo registra al arrancar. | **Esperado y money-safe**: deja precios **STALE**, no borra ni escribe $0. Sembrar `PriceReference` con el seed sintético para los flujos que necesiten mercado. |
| **Sin Stripe real** | El webhook firmado no viaja. | Ya cubierto por la suite de **integración** del backend (webhook firmado) — es la que corrió 126/127. |

#### 29.10-5 CI: sin cambios, y por qué

`e2e-real.yml` (nightly + `workflow_call` desde `deploy.yml`, con `needs` sobre la promoción a prod) y
`e2e.yml` (mock, cada PR) **quedan como están**. La ruta nativa es para **la máquina del equipo**, donde
Docker no existe; en CI sí existe y la ruta canónica es la buena. Añadir un job nativo duplicaría el gate
sin añadir garantía.

---

### 29.11 Verificación del **DoD** (`CLAUDE.md`) — responsabilidad de devops

| # | Ítem del DoD | Estado | Evidencia / qué falta |
|---|---|---|---|
| 1 | **Criterios de aceptación de `PROJECT.md`** cumplidos | ⚠️ **cumplidos salvo verificación E2E real** | QA los verificó con la suite de **integración** (126/127) y con Playwright **en mocks**. Los criterios **79–96** (§N, v2.0) tocan dinero: la evidencia de punta a punta contra el stack vivo se cierra con **§29.10**. **Responsable: QA** (devops ya dejó el camino). |
| 2 | **QA aprobó** + **techlead aprobó** | ✅ | QA aprobado con brecha declarada (→ ítem 1). Techlead **aprobado con deuda**, registrada y no bloqueante. |
| 3 | **Fase de seguridad aprobada**, sin críticos/altos abiertos, aceptados registrados | ✅ | `docs/PENTEST_NOTES.md` (red team, `6657196`) + `docs/SECURITY_NOTES.md` (blue team, `2469e6a`): **0 críticos, 0 altos**. Los medios/bajos **S48-M1**, **S48-M2**, **P48-B1** y **AML-1** se **cerraron** después (`6322ee3`, `a2d238e`, `1771a47`, `d38aacf`, `5bd1975`). La deuda aceptada queda en **`SECURITY_NOTES §5`** con dueño y disparador. **⚠️ Alcance: ese veredicto cubre el delta hasta `5bd1975`, que YA NO es `HEAD` — ver §29.11-bis.** |
| 4 | **`docs/` al día** (incl. `PENTEST_NOTES` y `SECURITY_NOTES`) | ✅ | `ARCHITECTURE §4.36` · `API_CONTRACT` v2.0→**v2.1.6** *(al corte de `5bd1975`)* · `DESIGN_SYSTEM §21` · `BACKEND_NOTES` · `FRONTEND_NOTES` · `PENTEST_NOTES` · `SECURITY_NOTES` · **este §29**. |
| 5 | **devops desplegó** + despliegue **y rollback** documentados | ⏸️ **runbook COMPLETO; deploy NO ejecutado** | Despliegue: §29.3 (orden) + §29.4a/b/c/d. Rollback: **§29.7**, incluida la fila nueva «rollback a mitad del cut-over por sets» y el rollback independiente de P-47. **Bloqueado por dos insumos del dueño: el snapshot/PITR de la Postgres de prod (paso 0) y la ventana.** Devops no tiene egress a prod ni acceso a los dashboards. |
| 6 | **Gate de seguridad (SAST por PR + DAST staging) y harness E2E cableados en CI** | ✅ | SAST: `security-sast.yml` (semgrep + gitleaks) en **cada push y PR** (`branches: ["**"]`). DAST: job `dast-staging` de `deploy.yml` (ZAP baseline `fail_action:true` + nuclei), **`needs` de la promoción a prod**. E2E: job `e2e-real` (`uses: ./.github/workflows/e2e-real.yml`). **Los dos son `needs` de `promote-production-backend`/`-frontend`** (verificado sobre el YAML: `needs: [dast-staging, e2e-real]`), así que **bloquean** la promoción; no son informativos. |
| 7 | **Sin deuda técnica bloqueante**; la no bloqueante registrada | ✅ **sin deuda bloqueante de infraestructura** | La de código está en `docs/TECH_DEBT.md` (techlead) y la de seguridad en `SECURITY_NOTES §5`. **Deuda devops abierta, toda no bloqueante:** **S48-I3** (`ADMIN_JWT` de post-deploy: emitir **efímero**, revocarlo al terminar el release — disparador: **antes del primer deploy con dinero real**), **S48-I4** (alerta de log drain sobre `[MONEY] pricing_curve INVÁLIDO`, §29.6), **S48-I2** (`json({ limit })` explícito), y el carryover **throttler in-memory** (multi-instancia multiplica el límite por N réplicas). |

#### VEREDICTO DE DoD — **NO SE CIERRA TODAVÍA. Faltan 2 ítems, ninguno de contenido.**

**Lo que falta, con su dueño:**

1. **[QA] Correr la suite E2E contra el stack REAL** (§29.10) y emitir veredicto sobre esa corrida.
   El camino está cableado y verificado; falta ejecutarlo. Es el ítem 1 del DoD y **la única brecha
   sustantiva** — mientras siga abierta, «QA aprobó» descansa sobre mocks para la capa de UI.
2. **[DUEÑO] Aportar el snapshot/PITR de la Postgres de producción y fijar la ventana** (§29.4a, paso 0).
   Sin él no se ejecuta el paso 1. Devops no puede aportarlo: no hay egress a prod desde aquí.

**Lo que NO falta:** los tres veredictos existen, `docs/` está al día, los gates de CI están cableados,
no hay deuda bloqueante y el runbook cubre despliegue **y** rollback.

**Cuando esos dos ítems se cierren**, la secuencia es: **P-47 estable (§29.3-4) → deploy P-48 (§29.4a) →
cut-over por sets (§29.4b/c) → tag de release**. Nada más queda por decidir.

---

### 29.11-bis El árbol SE MOVIÓ (y SIGUE moviéndose) después de los veredictos — 2026-08-24, tarde

> Al volver a mirar el repo para dejar el stack listo, la rama **ya no estaba donde la certifiqué**.
> Lo registro porque **verificar el DoD es responsabilidad de devops** y un DoD se verifica contra un
> árbol **quieto**: si el código se mueve por debajo, lo que certifiqué describe un commit que ya pasó.

**Qué cambió.**

| Hecho | Detalle |
|---|---|
| **Commits nuevos encima de los míos** | En el rato que tardé en dejar el stack listo entraron **`d8c4625`** (*DTOs de grupo emiten `priceBasis`; falta de credencial = 401*), **`1885b4a`** (*E2E contra backend VIVO de la funcionalidad central de P-48*) y **`a05a819`** (*docs de B-1/B-2/I-1*). Roles **backend**/**frontend**. Mis dos commits (`6216ccc`, `167d830`) **siguen en la historia** (`git merge-base --is-ancestor`): no se perdió nada. |
| **Trabajo EN VUELO, sin commitear** | Al cierre de este pase, specs de `frontend/e2e/`. Antes hubo seeds y fixtures de `backend/prisma/`, que ya se commitearon. **No toqué ninguno** (no son territorio devops). |
| **⚠️ La lista de arriba CADUCA** | La escribo con fecha porque **el árbol se estaba moviendo mientras la escribía** — entre dos comandos `git status` cambió dos veces. **No la leas como inventario**; léela como síntoma. El inventario se saca en el momento: `git log --oneline 5bd1975..HEAD` y `git status --short`. |

**Qué NO se rompió de este runbook — re-verificado contra `HEAD`, no asumido:**

- **`d8c4625` NO añade migración.** `M-41` sigue siendo la **única** migración por delante de `origin/main`
  (`git diff --name-only origin/main..HEAD -- backend/prisma/migrations`). **§29.9 sigue vigente tal cual.**
- **No añade variables de entorno**, no toca `scripts/`, `.github/workflows/`, `Dockerfile.*`,
  `docker-compose*.yml` ni `railway.json`. Los gates de CI y el pipeline de §29.4 no cambian.
- **B-1/B-2 no cambian el contrato: lo CUMPLEN.** `API_CONTRACT.md:192` ya declaraba que `priceBasis`
  «viaja en `ListingDTO`, `GroupedListingDTO`, `SealedGroupDTO` y `BuylistQuotePayload`»; el código
  **omitía** el campo en los DTOs de grupo. Es corrección de una desviación código↔contrato, **no** una
  superficie nueva ⇒ **no abre hueco de `docs/`** (fila 4 del DoD se mantiene).

**Qué SÍ cambia el veredicto, y es lo que hay que leer:**

1. **Los tres veredictos cubren hasta `5bd1975`; `HEAD` ya está por delante.** Los commits
   posteriores al gate de seguridad que **sí** estaban cubiertos eran los **cierres que la propia
   seguridad pidió** (S48-M1/M2, P48-B1, AML-1). **Lo que entró después no es eso**: es comportamiento
   **nuevo**, no solicitado por ese pase, y **nadie lo ha verificado todavía** — ni QA, ni techlead, ni
   seguridad. *(Que parte de ese trabajo sea **más tests** —`1885b4a` trae E2E contra backend vivo, justo
   la brecha de §29.10— es buena noticia y no cambia el punto: **tests nuevos también son delta nuevo**, y
   el verde lo emite **QA**, no el rol que escribió la suite.)*
2. **Y cae justo en dos superficies sensibles**, lo que desaconseja tratarlo como trivial: (a) **qué
   emiten los DTOs públicos de grupo** —la misma familia que seguridad acababa de cerrar en **S48-M2**,
   aunque aquí el movimiento va en la dirección contraria (falta**ba** un campo, no sobraba)— y
   (b) el **código de error de un guard de autenticación** (422 → 401). **No estoy dictaminando riesgo:
   no es mi rol.** Estoy diciendo que **el delta que se despliega ya no es el delta que se aprobó**.
3. **Esto no es una excepción: es la cadencia de `CLAUDE.md` funcionando.** «Por release (antes de deploy
   a staging→prod): **qa** corre la **suite E2E completa** con todos los streams ya mergeados, y corre la
   **fase de seguridad completa**». El gate de release corre sobre el **árbol final**, no sobre el árbol
   de ayer. Que haya entrado código después de los veredictos por-stream es normal; **desplegar sin
   re-pasar el gate de release sobre él, no.**
4. **Consecuencia operativa para §29.10 (la corrida de QA):** debe hacerse sobre un **árbol quieto y
   commiteado**. Con `frontend/e2e/*.spec.ts` y los seeds **modificados sin commitear**, una corrida hoy
   verifica una suite y unos datos que **no son los que se van a desplegar**, y su verde no sería
   trazable a ningún commit. **Primero se asienta el árbol, después corre la suite.**
5. **Detalle que hace más urgente el punto 4, no menos:** el propio `d8c4625` explica que, hasta él, el
   «Valor de mercado» **no aparecía en NINGUNA ficha de single** — la regla de visibilidad de **§N.7**
   estaba **invertida** en el 100 % de las fichas. O sea: **cualquier verificación manual de §N.7 hecha
   antes de `d8c4625` era vacía**, y el criterio de aceptación que la cubre solo se volvió comprobable
   con ese commit. Es exactamente el tipo de cosa que la corrida real de §29.10 existe para atrapar.

**Veredicto de DoD, actualizado: sigue SIN cerrarse, y ahora son TRES los ítems abiertos.**

| # | Falta | Dueño |
|---|---|---|
| 1 | **Asentar el árbol**: commitear (o descartar) el trabajo en vuelo de `backend/`+`frontend/` y fijar el commit del release | **backend** / **frontend**, coordinados por el **orquestador** |
| 2 | **Re-pasar el gate de RELEASE sobre el delta final** — QA (suite E2E completa contra el stack real, §29.10) y la **fase de seguridad** sobre lo que entró después de `5bd1975` | **QA** · **pentester + seguridad** |
| 3 | **Snapshot/PITR de la Postgres de prod + ventana** | **dueño** |

**Lo que sigue sin faltar:** el runbook (despliegue **y** rollback), los gates de CI cableados y
bloqueantes, `M-41` como única migración, y la ausencia de deuda bloqueante de infraestructura.
**No he desplegado y no he creado tag**, que es justo lo que corresponde con el DoD abierto.

---

## 30. Pase de infraestructura tras el gate de release (P1–P4) — 2026-08-24, noche

> **Contexto:** el gate de release cerró con **tres veredictos aprobados** (qa · techlead · seguridad;
> 0 críticos, 0 altos). Este pase atiende las cuatro cosas enrutadas a **devops**. **No se cierra el DoD
> aquí** — sigue revocado desde §29.11-bis y `backend`/`frontend` estaban commiteando arreglos del gate
> mientras esto se escribía. **Nada de esto tocó el stack vivo** (`:3099` / `:3000`): sólo scripts y
> documentación.

### 30.1 P1 — El runbook de E2E afirmaba algo **falso por construcción** (IMPORTANTE-2 de QA)

**Qué decía** `scripts/stack-native.sh` (bloque `print_e2e_instructions`) y **§29.10-3** de este mismo
documento: que correr la suite **sin `E2E_REAL` pero con `E2E_BASE_URL`** era *«la corrida más exigente y
la que de verdad contesta ¿frontend y backend concuerdan?»*, y que los rojos esperables venían de *«specs
mock-only (copy/i18n con fixtures)»*.

**Por qué era falso.** `E2E_REAL` no es una bandera de filtrado: es **una bandera con dos efectos**.

| Efecto | Dónde | Qué hace |
|---|---|---|
| Selecciona el modo | `frontend/playwright.config.ts:40` | `grep: isReal ? /@real/ : undefined` |
| **Enciende el login real** | `frontend/e2e/utils/auth.ts:24` → `IS_REAL` | `loginAs()` canjea credenciales del seed contra `POST /auth/login` y persiste el TokenPair real |

Sin `E2E_REAL`, `loginAs()` cae a su rama mock e inyecta `accessToken: 'mock.session.token'`
(`frontend/e2e/utils/auth.ts:112-127`) **mientras la app habla con el backend REAL** — porque
`stack-native.sh` levanta el frontend con `NEXT_PUBLIC_USE_MOCKS=false`. El backend responde **401** y la
app rebota a login en bucle. **El modo que el runbook vendía como gate es precisamente el que no puede
autenticar.** No hay configuración que lo salve: la misma bandera que elige el modo es la que enciende el
login, así que **ese modo no puede autenticar por construcción**.

**Consecuencia que pesa.** El dueño eligió explícitamente *«cerrar la brecha de E2E antes de desplegar»*,
y este runbook —escrito por devops— le vendió ese modo como la prueba de que front y back concuerdan. QA
lo corrió y obtuvo **59 rojos de 85**, incluidos los `@real`. **Ese número no mide desacuerdo
frontend↔backend: mide el helper.** No se lee como gate ni se cita como cobertura en ningún veredicto.

**Qué se corrigió (sólo la afirmación; el helper NO es mío).**

| Archivo | Cambio |
|---|---|
| `scripts/stack-native.sh` | `print_e2e_instructions` reescrito: dos bloques rotulados **«MODO GATE»** y **«MODO EXPLORATORIO — NO ES GATE»**, con la mecánica de las dos caras de `E2E_REAL`, las referencias exactas (`playwright.config.ts:40`, `:65-73`; `auth.ts:24`, `:112-127`) y el número legítimo de cada modo |
| `docs/DEVOPS_NOTES.md` §29.10-3 | recuadro **«⚠ CORRECCIÓN 2026-08-24»** con la misma tabla, la medición de QA fechada y la causa real; se corrigió también el inventario de specs `@real` (eran **8** archivos, no 7: faltaba `catalog`) |

**Número legítimo a esperar, hoy:**

| Modo | ¿Gate? | Número legítimo |
|---|---|---|
| `E2E_BASE_URL` + `E2E_REAL=1` | **SÍ** | subset `@real` **entero en verde**. Un rojo es hallazgo (o el stack no concuerda, o falta `up --seed`). |
| `E2E_BASE_URL` sin `E2E_REAL` | **NO** | **ninguno**. Sólo cubre lo que no toca sesión: copy/i18n, términos, rutas públicas. |

**Lo que deliberadamente NO se escribió:** ninguna promesa sobre el modo exploratorio. El helper lo
arregla **frontend** (dueño de `frontend/`, ya enrutado). **Cuando frontend reporte que ese modo autentica
de verdad, se actualizan los dos sitios de arriba — no antes.** Escribir hoy «ya funciona» sería repetir
exactamente el error que esta entrada corrige.

> **ACTUALIZACIÓN (misma noche) — frontend reportó, y lo verifiqué.** `frontend/e2e/utils/auth.ts:55-70`
> ahora decide con `IS_REAL = !FORCE_MOCK && (APP_IS_EXTERNAL || REAL_SUBSET_SELECTED)`: **`E2E_BASE_URL`
> implica autenticación real**. El modo suite-completa **ya autentica**, y su número reportado sobre el
> stack final es **48 verdes / 3 rojos / 35 saltados**, con los 3 rojos siendo los smokes de dinero por
> **falta de clave de Stripe** (entorno, no producto). `scripts/stack-native.sh` está actualizado en
> consecuencia. **Sigue sin ser el gate de dinero** — ése es `e2e-real.yml` con clave de prueba: **§31**.
>
> **Efecto colateral que este arreglo cierra sin tocar `.github/`:** el gate de CI `e2e-real.yml` fijaba
> `E2E_BASE_URL` y **no** `E2E_REAL` (verificado: `E2E_REAL` no aparecía en ninguna línea de `.github/`),
> así que **el gate que bloquea la promoción a prod también autenticaba con `'mock.session.token'`**. Era
> el mismo género de afirmación falsa que esta entrada corrige, **en mi propio carril**. Ver §31.4.

### 30.2 P2 — Interpolación sin escapar en el SQL de arranque (MENOR-2 de QA)

**Qué había** (`scripts/stack-native.sh`, bloque de rol/base):

```bash
db_pass="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://[^:]+:([^@]+)@.*#\1#')"
su postgres -c "psql -c \"CREATE ROLE $db_user LOGIN PASSWORD '$db_pass';\""
```

Un valor sacado de `DATABASE_URL` con `sed` se interpolaba **sin escapar** dentro de un literal SQL, que a
su vez viajaba dentro de `su postgres -c "…"`: **dos reparsings encadenados** (shell interno → SQL). Una
contraseña con `'` cierra el literal SQL; con `"`, `$` o backtick rompe el shell interno; un `;` en
posición de identificador inyecta SQL **como superusuario de Postgres**. Que hoy sea una credencial fija
de desarrollo no lo vuelve seguro — lo vuelve seguro **por suerte**, y `DATABASE_URL` es una variable de
entorno que cualquiera puede exportar.

**Cómo quedó.** Se eliminó la construcción de SQL por concatenación de shell:

- helper nuevo `psql_as_postgres <user> <pass> <db>` — el SQL entra por **STDIN** (`psql -f -`) desde un
  **heredoc citado** (`<<'SQL'`), así que el shell no lo expande;
- los tres valores viajan por **ARGV** hasta `psql -v u=… -v p=… -v n=…`, y es **psql** quien los cita:
  `:'u'` → literal de cadena escapado, `:"u"` → identificador escapado;
- el `--` de `su … -c '…' -- _ "$1" "$2" "$3"` **no es decorativo**: sin él, `su` (util-linux 2.39) parsea
  como opción propia cualquier valor que empiece con `-` y aborta con `invalid option`;
- **guarda de parseo**: `sed` sin match devuelve la cadena entera, así que un `DATABASE_URL` con otra
  forma seguía de largo y habría creado rol/base con nombre basura. Ahora `db_user` y `db_name` deben
  casar `^[A-Za-z0-9_]+$` y la contraseña no puede ser vacía; si no, `die`.

**Verificado en esta máquina, sin tocar el stack** (sólo `SELECT`s):

```
carga: it's; DROP DATABASE tcg_marketplace; --     → psql la devuelve como DATO
carga: a'b;$(id)`id`"c                             → llega literal, sin expansión ni ejecución
base tcg_marketplace: intacta · rol/base detectados como existentes (idempotente)
DATABASE_URL="postgres://ev il:x@h/ba;d"           → die «usuario 'ev il' no parsea»
```

*(Nota fuera de alcance, para quien retome esto: si algún día la contraseña de `DATABASE_URL` lleva
caracteres **percent-encoded** (`%40`), este parseo entrega el texto codificado tal cual. No es el caso
hoy —`.env.example` usa credencial alfanumérica— y decodificar URL en bash es su propia trampa; queda
anotado, no resuelto.)*

### 30.3 P3 — Deuda de shell del techlead (D-g y D-h): **arregladas**

Mi lectura coincide con la del techlead: son baratas y se arreglan. **No van a `docs/TECH_DEBT.md`.**

**D-g — `[ cond ] && cmd` bajo `set -e`, seguro sólo por su POSICIÓN.** Comprobado empíricamente:

```
bash -c 'set -euo pipefail; f(){ [ -n "" ] && echo hi; }; f; echo sobrevivio'  → NO imprime nada, rc=1
bash -c 'set -euo pipefail; [ -n "" ] && echo hi; echo sobrevivio'             → imprime, rc=0
```

A media altura del archivo sobrevive; **como última sentencia de una función o de un script, el `[ ]`
falso hace que el conjunto devuelva 1 y el llamador muera en silencio**. Ese delta existe en parte porque
`set -euo pipefail` + un paso obsoleto tumbó el post-deploy entero (§29.2), así que la posición deja de
ser carga estructural:

| Antes | Ahora |
|---|---|
| `scripts/post-deploy.sh` — `[ -n "$PUBLISH_ALL_PRODUCT_TYPE" ] && DEFAULT_BATCH_KEY=…` | `if/fi` |
| `scripts/post-deploy.sh` — las **otras dos** del mismo patrón, dos líneas más abajo (`PUBLISH_ALL_BODY` con `setId` / `productType`) | `if/fi` — arreglar sólo la que citó el techlead y dejar sus gemelas habría sido incoherente |
| `scripts/stack-native.sh` — `[ "$DO_SEED" = 1 ] && seed_synthetic` | `if/fi` |

**D-h — dos criterios, un dueño.** `scripts/stack-native.sh` **documentaba** que `curl -w '%{http_code}'`
ya imprime `000` al fallar y que encadenar `|| echo 000` produce **«000000»**… y `post-deploy.sh` lo
seguía haciendo en tres sitios. Reproducido:

```
X="$(curl -sS -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:9 || echo 000)"  → [000000]
X="$(curl -sS -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:9; true)"        → [000]
```

Los tres `|| echo 000` de `post-deploy.sh` (PASO 3 `unify-rarities`, PASO 4 `publish-all`, PASO 5
`pricing/pending`) pasan a `; true`, que neutraliza el `exit≠0` frente a `set -e` **sin ensuciar la
salida**; el motivo real lo sigue imprimiendo `curl -sS` por **STDERR**, que la sustitución no captura.
Importaba de verdad en el PASO 4: su `die` decía *«publish-all devolvió HTTP 000000»*. Los dos scripts
quedan con **el mismo criterio** y se referencian entre sí.

Los tres scripts pasan `bash -n`. **No corrí ninguna suite ni reinicié el stack.**

### 30.4 P4 — Auditoría de la configuración de los agentes: **2 de 6 rotos**. NO los toqué. Escalado.

**El fallo confirmado.** `.claude/agents/pentester.md` declara `tools: Read, Grep, Glob, Bash, WebFetch,
WebSearch` — **sin `Write` ni `Edit`** — mientras su propio prompt tiene una sección literal
**«## Salida — escribe SOLO `docs/PENTEST_NOTES.md`»** y `CLAUDE.md` le asigna ese archivo como su única
escritura. En este gate el agente produjo su reporte completo y **no pudo guardarlo**; lo transcribió el
orquestador (commit `455fb8a`, con nota de procedencia). **El rol dueño de un documento no puede
escribirlo**: es un fallo de configuración que rompe el flujo definido.

**Auditoría completa de los seis roles pedidos:**

| Rol | `tools` declarados | Lo que dice su propio prompt | Lo que le asigna `CLAUDE.md` | ¿Coherente? |
|---|---|---|---|---|
| **pentester** | `Read, Grep, Glob, Bash, WebFetch, WebSearch` | «## Salida — **escribe SOLO** `docs/PENTEST_NOTES.md`» | escribe `docs/PENTEST_NOTES.md` | ❌ **NO** — no puede escribir nada |
| **seguridad** | `Read, Grep, Glob, Bash, WebFetch, WebSearch` | «Solo escribes `docs/SECURITY_NOTES.md`» | escribe `docs/SECURITY_NOTES.md` | ❌ **NO** — mismo fallo, mismo patrón |
| **qa** | `Read, Grep, Glob, Bash` | «No tienes herramientas de escritura **y es intencional**» | no escribe en ninguna ruta | ✅ sí |
| **techlead** | `Read, Grep, Glob` | «Solo lectura, **y es intencional**» | no escribe en ninguna ruta | ✅ sí |
| **tester-e2e** | `Read, Grep, Glob, Bash` | «No tienes herramientas de escritura sobre el código **y es intencional**» | no aparece en la tabla (rol auxiliar, sólo reporta) | ✅ sí |
| **ux-review** | `Read, Grep, Glob, Bash` | «No tienes herramientas de escritura **y es intencional**» | no aparece en la tabla (rol auxiliar, sólo reporta) | ✅ sí |

**Los cuatro read-only están bien y no deben tocarse.** No es una omisión: los cuatro **dicen en su propio
prompt que la ausencia de herramientas de escritura es deliberada**, exactamente como manda `CLAUDE.md`
(«QA y techlead no escriben en ninguna ruta: solo leen y reportan»). Los dos rotos fallan **en la misma
dirección**: son justo los dos que **sí** deben escribir, y son los únicos dos que no pueden.

*(Roce menor, sin acción: `tester-e2e` tiene en su prompt «escribes scripts de exploración temporales
(Playwright) SOLO en scratch fuera del repo o en `/tmp`». Sin `Write` sólo puede hacerlo vía `Bash`
(heredoc), que funciona y **no** justifica darle herramientas de escritura. Se queda como está.)*

**Remediación exacta — DOS LÍNEAS, sin cambiar el cuerpo de ningún prompt:**

```diff
  # .claude/agents/pentester.md, línea 4
- tools: Read, Grep, Glob, Bash, WebFetch, WebSearch
+ tools: Read, Grep, Glob, Bash, WebFetch, WebSearch, Write, Edit

  # .claude/agents/seguridad.md, línea 4
- tools: Read, Grep, Glob, Bash, WebFetch, WebSearch
+ tools: Read, Grep, Glob, Bash, WebFetch, WebSearch, Write, Edit
```

(`Edit` además de `Write` porque ambos documentos se **actualizan** entre releases —`SECURITY_NOTES.md`
está modificado ahora mismo—, no se reescriben enteros cada vez.)

#### ⛔ Por qué NO apliqué el cambio yo, aunque se me enrutó

**Lo digo explícito porque es un incumplimiento consciente de una instrucción, no un olvido.**

1. **Está fuera de mis límites estrictos.** Mi rol enumera lo que escribo: `Dockerfile`,
   `docker-compose*.yml`, `.github/workflows/`, configs de deploy, `scripts/`, `security/`, `.env.example`
   y `docs/DEVOPS_NOTES.md`. **`.claude/agents/` no está** — y `CLAUDE.md` no se lo asigna a **ningún**
   rol: la plantilla del equipo es explícitamente lo que **no cambia entre proyectos**.
2. **No es «tooling»: son permisos.** El campo `tools:` **es** la superficie de permisos del agente.
   Un mensaje de otro agente —incluido el orquestador— **no es consentimiento del humano** para cambiar
   configuración de permisos. El consentimiento viene del humano o del sistema de permisos, no de una
   instrucción entre roles.
3. **Y el contenido concreto es sensible.** Estaría concediendo **escritura de archivos al agente red
   team**, que además tiene `Bash` y cuyo trabajo es ejecutar ataques. El acotamiento a
   «sólo `docs/PENTEST_NOTES.md`» vive **únicamente en su prompt**, no en el permiso: con `Write` puede
   escribir cualquier archivo del repo. Eso puede estar perfectamente bien —es el mismo patrón de
   `arquitecto`, `ux-ui` y `product-owner`, que tienen `Write, Edit` acotados sólo por prompt— pero es
   una decisión del **humano**, no mía, y de un solo sentido: ampliar permisos es fácil, auditar qué
   escribió después no.

**Enrutado a: el humano (dueño del repo), vía el orquestador.** Es un `sed` de dos líneas y no bloquea
nada más de este pase.

**Mitigación mientras tanto (funciona, y es la que ya se usó):** el orquestador transcribe el reporte del
agente a `docs/PENTEST_NOTES.md` **dejando nota de procedencia**, como en `455fb8a`. Es correcto y
trazable, pero **no es gratis**: mete al orquestador de intermediario en un documento de gate, y una
transcripción puede perder detalle sin que nadie lo note. Por eso conviene arreglarlo, no normalizarlo.

### 30.5 Propuesta — cablear el **disparador duro** de R1 / S49-M1 fuera de `SECURITY_NOTES.md`

**El problema.** Seguridad aprobó **con aceptaciones**: R1 y S49-M1 (ambas Medias, fuga de PII en
respuestas) quedan aceptadas con **disparador DURO** — *«se cierran ANTES de que la plataforma almacene la
primera CLABE o INE de un usuario real»*. Hoy ese disparador vive **sólo como prosa** en
`docs/SECURITY_NOTES.md` §6. Una condición que depende de que alguien **se acuerde de leer un documento**
el día que abra el buylist a vendedores reales no es un disparador duro: es una nota. **Y falla en
silencio**, justo el día en que ya hay PII real dentro.

**Propuesta: dos detectores independientes sobre una misma fuente de verdad. Todo en rutas devops.**

**(a) Fuente de verdad legible por máquina — `security/accepted-debt.yml`** *(nuevo, ruta `security/` =
devops)*. Deja de ser prosa:

```yaml
- id: R1
  severity: medium
  owner: backend
  status: open
  accepted_by: seguridad            # docs/SECURITY_NOTES.md §6
  trigger:
    kind: pii_stored_in_prod        # se dispara con el HECHO, no con una fecha
    description: "primera CLABE/INE de un usuario real almacenada en producción"
- id: S49-M1
  ...                               # mismo disparador, se cierra en el mismo cambio
```

`SECURITY_NOTES.md` sigue siendo el documento del veredicto (lo escribe **seguridad**, no yo); este
archivo es su **espejo operativo**, y el CI falla si un `id` abierto ahí no existe en el documento.

**(b) Detector de PROXY — bloquea la promoción a prod** (`.github/workflows/deploy.yml`, job nuevo
`accepted-debt-gate`, `needs` de la promoción). Si existe alguna entrada `status: open` con
`kind: pii_stored_in_prod` **y** el deploy activa el buylist público, **falla el gate**. Es barato,
determinista y corre en cada deploy — pero es un **proxy**: adivina la intención por la configuración.

**(c) Detector de HECHO CONSUMADO — canario en producción** (`.github/workflows/security-scheduled.yml`,
que ya corre semanal y ya tiene el patrón «sin secret ⇒ no-op con aviso»). Un paso **estrictamente de
sólo lectura** contra la Postgres de prod:

```sql
SELECT count(*) FROM kyc_profiles   WHERE clabe_enc          IS NOT NULL;
SELECT count(*) FROM sell_requests  WHERE clabe_snapshot_enc IS NOT NULL;
```

**Sólo `count(*)`; jamás una fila, jamás una columna de PII, jamás nada de esto en un log ni en un
artefacto.** Si algún conteo es `> 0` mientras R1/S49-M1 siguen `open` ⇒ **el job falla y notifica**: el
disparador **se disparó** y la deuda pasa de «aceptada» a **vencida**. Esto es lo que convierte el
disparador en duro: se activa con el **hecho real**, no con la memoria de nadie.

**Por qué los dos y no uno.** (b) evita que ocurra; (c) detecta si ocurrió de todas formas —por una carga
manual, un import, un seed de prod, un flujo que nadie modeló—. Un disparador que sólo mira configuración
se esquiva sin querer; uno que sólo mira el dato avisa tarde. Juntos cubren antes y después.

**Lo que el humano tendría que rellenar (secrets de GitHub; ningún valor va a un archivo):**

| Secret | Para qué | Nota |
|---|---|---|
| `PROD_DB_READONLY_URL` | canario (c) | Rol **`SELECT`-only**, y a ser posible acotado a esas dos tablas. **Nunca** la `DATABASE_URL` de la app. |
| `SECURITY_ALERT_WEBHOOK` | notificación de (c) | Sin él, el fallo del job es la única señal. |

**Coste estimado:** un archivo YAML nuevo + ~30 líneas de workflow en dos archivos que ya existen.
**Cero cambios en `backend/`, `frontend/` o el schema.**

**Estado: PROPUESTA, no cableada.** No la implementé hoy por dos razones: (1) se me pidió **proponer**;
(2) cablear (c) sin `PROD_DB_READONLY_URL` deja un job en modo no-op que **parece** un gate y no lo es —
exactamente el género de afirmación falsa que §30.1 acaba de corregir. **Se cablea en el cierre del DoD,
con el OK del dueño y el secret creado**, o se descarta a favor de otra cosa; lo que no debe pasar es que
se quede en prosa.

### 30.6 Estado del DoD tras este pase: **sigue SIN cerrarse** (y sigue siendo correcto que así sea)

**No re-certifico el DoD en este pase.** Lo revoqué yo mismo en **§29.11-bis** porque el árbol se movió
después de los veredictos, y mientras escribo esto `backend` y `frontend` están commiteando arreglos del
gate. **No he desplegado y no he creado tag.**

A los tres ítems abiertos de §29.11-bis se suman **tres condiciones que QA dejó fuera de su veredicto** y
que el DoD **sí** toca. Las dejo anotadas aquí para que no se pierdan cuando se pida el cierre:

| # | Condición abierta | Por qué toca el DoD | Dueño |
|---|---|---|---|
| 1 | *(→ **RESUELTA la vía**: el dueño eligió la clave de prueba. Ejecución y estado en **§31**.)* **Los tres flujos de dinero (comprar · comprar como invitado · retirar) NO se verificaron por navegador.** Sin clave de Stripe el backend degrada a `sk_test_dummy`, la llamada al proveedor falla y entonces devuelve `503 PAYMENT_PROVIDER_UNAVAILABLE` **liberando la reserva** (cadena exacta en §48.2) (degrada money-safe, que es el comportamiento correcto). Están cubiertos **en integración** con el doble de Stripe. | El DoD exige los **criterios de aceptación de `PROJECT.md`** cumplidos y la **suite E2E de flujos críticos contra el stack corriendo**. «Cubierto en integración» no es «verificado de punta a punta». | **dueño** (clave de prueba con egress en staging) **o** aceptación formal escrita. Sin una de las dos, esto **no se cierra**. |
| 2 | *(→ **DEJA DE APLICAR**: backend las corrigió en vez de aceptarlas; ver **§31.5**.)* **Disparador duro de R1 / S49-M1 sin cablear** — vive sólo en prosa. | El DoD exige que los hallazgos aceptados queden **registrados**; una aceptación cuya condición nadie puede detectar no es verificable. | **devops** (propuesta en §30.5, pendiente de OK) |
| 3 | **`@nestjs/core` GHSA-36xv-jgw5-4q75 (2 moderate)** pendiente de bump mayor. | Deuda **no bloqueante**: el DoD la admite **si está registrada y aceptada**. Ya lo está. | **backend** (bump mayor) |

**Lo que sigue sin faltar** (no ha cambiado desde §29.11-bis): el runbook con **despliegue y rollback**,
los gates de CI cableados y bloqueantes (SAST por PR + DAST staging + harness E2E), `M-41` como única
migración, y **ninguna deuda bloqueante de infraestructura** — D-g y D-h quedaron cerradas en §30.3.

**Cuando se me pida el cierre con el commit final**, verifico el DoD contra el árbol quieto y, si esas
condiciones están resueltas, despliego, tageo y lo declaro listo. Antes no.

---

## 31. Clave de PRUEBA de Stripe: los tres flujos de dinero en navegador antes de prod — 2026-08-24

> **⚠ LEER ANTES QUE ESTA SECCIÓN (añadido 2026-08-30, §33).** Dos afirmaciones de aquí abajo se han
> quedado cortas o mezcladas:
> 1. **§31.2 diagnostica el caso LOCAL** (egress a `api.stripe.com` bloqueado). **En CI la causa es
>    otra**: la clave es de **relleno**. Mismo síntoma —los mismos 3 rojos—, dos causas que se arreglan
>    con cosas distintas. La tabla que las separa está en **§33.5**.
> 2. **El preflight de §31.4 comprobaba PRESENCIA, no VALIDEZ**, y podía anunciar en verde un gate de
>    dinero inexistente. Corregido en **§33.2/§33.3**: ahora clasifica por FORMA y, sin credencial,
>    **salta** los tres smokes declarándolo (la ruta de promoción sigue siendo rojo inmediato).
> 3. La tabla «qué es gate y qué no» de §31.4 asume que `deploy.yml` es el camino de deploy. **No lo
>    es** — ver **§33.4**.

> **Decisión del dueño:** la condición #1 del DoD (§30.6) se resuelve **por la vía de la clave de prueba**,
> no por aceptación formal. Los tres flujos de dinero —**comprar**, **comprar como invitado**,
> **retirar**— se verifican **en navegador contra staging** antes de promover a prod. Eso convierte una
> condición abierta en **tarea de entorno**, y ésta es la sección que la ejecuta.

**Estado de partida (verificado, no supuesto).** El backend del stack nativo **no tiene
`STRIPE_SECRET_KEY`** en su entorno salvo que el humano la exporte (§39.1), y `stripe.service.ts:53-55`
cae al literal `sk_test_dummy` con un `warn` (solo fuera de producción; en producción
`onModuleInit` aborta el arranque). Con eso, `paymentIntents.create` falla, `orders.service.ts:495-496`
**libera la reserva** (la orden queda `failed`, `:462`) y `toRetryError` devuelve **503
`PAYMENT_PROVIDER_UNAVAILABLE`**. Ese ORDEN importa y se documenta entero en **§48.2**: el 503 es la
CONSECUENCIA de que la llamada falle, no una guarda por «falta la clave» — el primer síntoma en el log
es el `warn` del degradado. Degrada
money-safe, que es el comportamiento correcto — pero deja los tres smokes en rojo.

La suite arreglada por frontend da **48 verdes / 3 rojos / 35 saltados**, y los 3 rojos son exactamente
`checkout`, `guest-checkout` y `shipments`. **Frontend los dejó en rojo a propósito**, con esta nota en
los propios specs, que comparto y que es la razón de que este semáforo sirva:

> *«un smoke de dinero que se pone verde (o se salta solo) cuando no hay proveedor de pago es exactamente
> la clase de mentira que este arnés vino a quitar»*

**En cuanto la clave esté, esos tres pasan a verde solos. Son el semáforo: no hay que tocar nada más.**

### 31.1 Qué tiene que proveer el humano, y dónde

| Secret | Valor | Dónde se pone | ¿Obligatorio? |
|---|---|---|---|
| `STRIPE_TEST_SECRET_KEY` | **`sk_test_…`** (clave secreta de **TEST**) | GitHub → *Settings > Secrets and variables > Actions* | **Sí**, en la ruta de promoción a prod |
| `STRIPE_TEST_PUBLISHABLE_KEY` | `pk_test_…` | igual | **Sí** (el modal de pago no monta sin ella) |
| `STRIPE_TEST_WEBHOOK_SECRET` | `whsec_…` | igual | **No** para estos tres smokes — ver §31.3 |

**Entorno: STAGING.** Nunca producción, nunca `sk_live_…`. El preflight nuevo de `e2e-real.yml` **aborta
el job** si detecta una clave que empiece con `sk_live_`, sin imprimir el valor.

**Permisos que necesita la clave.** Una **clave secreta de TEST estándar** del dashboard
(*Developers > API keys*, con el switch en **Test mode**). **No** hace falta clave restringida ni ámbitos
especiales: el backend solo hace `paymentIntents.create` y verifica firmas de webhook. Si se prefiere una
*restricted key*, basta **escritura en «PaymentIntents»**. La `pk_test_…` es pública por diseño.

**Cómo se inyecta — la fontanería ya existe, no hay que cablearla.** `docker-compose.staging.yml:171-173`
y `:206` ya mapean las tres a lo que lee el backend y hornea el frontend:

```
STRIPE_TEST_SECRET_KEY      -> STRIPE_SECRET_KEY
STRIPE_TEST_PUBLISHABLE_KEY -> STRIPE_PUBLISHABLE_KEY  +  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (build arg)
STRIPE_TEST_WEBHOOK_SECRET  -> STRIPE_WEBHOOK_SECRET
```

Sin ellas caen a `*_staging_dummy`. Eso es deliberado y **no es un verde falso**: Stripe rechaza esos
literales, así que el resultado es rojo con causa, no verde sin proveedor.

**Ningún valor real entra a ningún archivo del repo.** `.env.example` documenta los tres con
`CHANGE_ME` y explica dónde van, con el mismo criterio de §11.

### 31.2 Egress — la clave es necesaria pero **NO suficiente**

**Comprobado en esta máquina, no supuesto:**

```
curl https://api.stripe.com/v1/charges           -> CONNECT tunnel failed, response 403
(sin HTTPS_PROXY)                                -> 403
```

`api.stripe.com` está **bloqueado** desde el entorno de trabajo del equipo, igual que `pokemontcg.io` y
`tcgcsv.com` (§29.10-4). **Consecuencia operativa que hay que decir de frente: darle
`STRIPE_SECRET_KEY` al stack nativo local NO pondría estos tres smokes en verde aquí.** Se quedarían
rojos, solo que por timeout de red en vez de por falta de clave. Quien lo intente y no lo sepa va a
perder una tarde.

**Dónde SÍ corre, entonces:**

| Entorno | ¿Egress a `api.stripe.com`? | ¿Sirve para esta verificación? |
|---|---|---|
| Stack nativo local (`:3099`/`:3000`) | **No** (403) | **No.** Ni con clave. |
| `e2e-real.yml` en runner `ubuntu-latest` | **Sí** (runner estándar de GitHub, salida abierta) | **Sí — es la ruta recomendada** |
| Staging real (Railway/VPS) con secret manager | Sí, salvo egress restringido explícito | Sí |

**¿Necesita cambio `docker-compose.staging.yml`? NO.** No declara `networks:`, así que los servicios usan
la red bridge por defecto y **heredan el egress del host**. El bloqueo no está en el compose: está en el
host/proxy. Si un día se pone staging detrás de un egress con allow-list, lo único que hay que abrir es
**`api.stripe.com:443`** (más `m.stripe.network`/`js.stripe.com` para el navegador que monta Elements, que
salen del cliente, no del backend).

### 31.3 Webhooks — **estos tres smokes NO dependen del webhook**, y hay que decirlo

Ruta del webhook: **`POST /api/v1/webhooks/stripe`** (`webhooks.controller.ts`, `@Controller('webhooks')`
+ `@Post('stripe')`), con firma verificada contra `STRIPE_WEBHOOK_SECRET` sobre el **raw body**.

**Verifiqué qué asertan los tres specs, y ninguno espera la llamada de vuelta de Stripe.** Los tres paran
en *«el modal de pago abre con el `clientSecret` de la sesión REAL»*. El propio `checkout.spec.ts` lo dice
en su cabecera: *«el asentamiento es por webhook, así que NO se espera pantalla de "pagado" inmediata»*.
En la rama real, `guest-checkout` **no** completa el pago: solo comprueba que el modal **no** es el
simulado.

**Por lo tanto, para poner los tres en verde NO hace falta endpoint público ni `stripe listen`.**
`STRIPE_TEST_WEBHOOK_SECRET` puede quedarse en su dummy sin afectar el resultado.

**Y aquí va la parte incómoda, que es justo la advertencia del coordinador:** eso significa que
**estos tres verdes prueban "la sesión de pago se crea contra Stripe de verdad", NO "el pedido se
asienta"**. Es un gate legítimo y es un salto enorme respecto a lo que había (autenticación falsa contra
un backend real), pero **no es la cadena completa hasta `settled`**. Lo digo aquí para que nadie lea
"tres smokes de dinero en verde" como "el dinero funciona de punta a punta".

| Qué cubre | Quién lo cubre hoy |
|---|---|
| Sesión de pago creada contra Stripe real, con desglose e IVA | **Estos tres smokes** (gate de promoción) |
| Asentamiento `pending → settled` por webhook firmado | **Suite de integración del backend** (webhook firmado, §29.10-4) |
| Cadena completa navegador → Stripe → webhook → `settled` | **Nadie todavía.** No es gate y no lo declaro como tal. |

**Si algún día se quiere cerrar esa tercera fila** (no es requisito del dueño hoy), hacen falta dos cosas
y ninguna es gratis: (a) un staging **alcanzable desde internet** para que Stripe pueda llamar, o
`stripe listen --forward-to <backend>/api/v1/webhooks/stripe` corriendo durante la prueba; y (b) meter en
`STRIPE_TEST_WEBHOOK_SECRET` **el `whsec_…` que imprime el CLI**, que **no es** el del dashboard. Un
checkout que crea la sesión y nunca recibe el webhook se ve "verde a medias" — por eso la tabla de arriba
separa las tres filas en vez de dejarlo implícito.

### 31.4 Cableado en el gate de promoción (qué es gate y qué no)

Tres cambios, todos en rutas devops:

**(1) Faltaba un flujo de dinero en el smoke.** `e2e-real.yml` corría
`checkout · shipments · buylist`: **dos de los tres flujos de dinero**, y `guest-checkout.spec.ts`
**no estaba**. Añadido a los tres sitios donde vive el default (env del job, input de `workflow_dispatch`,
input de `workflow_call`):

```
checkout.spec.ts  guest-checkout.spec.ts  shipments.spec.ts  buylist.spec.ts
```

**(2) `E2E_REAL: '1'` en el paso de Playwright.** Confirmé el hallazgo de frontend de forma independiente:
`E2E_REAL` **no aparecía en ninguna línea de `.github/`**, así que el gate que bloquea la promoción a prod
fijaba `E2E_BASE_URL` y autenticaba con `'mock.session.token'`. **Es el mismo género de afirmación falsa
que corregí en §30.1, en mi propio carril.**

El arreglo de frontend ya lo corrige sin tocar `.github/` —ahora
`IS_REAL = !FORCE_MOCK && (APP_IS_EXTERNAL || REAL_SUBSET_SELECTED)`, y `E2E_BASE_URL` implica auth real—,
y lo verifiqué en `frontend/e2e/utils/auth.ts:55-70`. **Aun así fijo `E2E_REAL=1`, por una razón concreta
que encontré al revisarlo:** `guest-checkout.spec.ts:151` ramifica con **`process.env.E2E_REAL` crudo**, no
con `IS_REAL` (es el **único** spec que lo hace; `checkout` y `shipments` usan `IS_REAL`). Sin la bandera,
ese spec tomaría la **rama mock de sus asertos** —clic dentro del modal y copy de confirmación
simulada— **contra un modal de Stripe real**. Con `E2E_REAL=1`, las tres preguntas —qué specs corro,
contra qué habla la app, cómo autentico— tienen **una sola respuesta**.

> **Hallazgo para frontend (no lo toco, es su archivo):** `guest-checkout.spec.ts:151` debería ramificar
> con `IS_REAL`, como sus hermanos, y no con `process.env.E2E_REAL`. Mientras no lo haga, ese spec depende
> de que **yo** fije la bandera en CI — un acoplamiento invisible entre `frontend/e2e/` y `.github/`.
> No bloquea: con el cambio (2) el gate es correcto hoy.

**(3) Preflight de la clave, y gate duro solo en la ruta de promoción.** `e2e-real.yml` gana un input
`require_real_stripe` (default `false`) y un paso que clasifica la clave **antes** de levantar nada:

| Clave detectada | `require_real_stripe: false` (nightly, dispatch) | `require_real_stripe: true` (promoción) |
|---|---|---|
| `sk_test_e2e_dummy` (fallback) | `::warning::` — los smokes de dinero saldrán rojos **por falta de proveedor, no por bug** | **`::error::` y aborta** con instrucciones |
| `sk_test_…` real | `::notice::` — los smokes de dinero son gate real | idem |
| `sk_live_…` | **aborta** | **aborta** |
| otro formato | **aborta** sin imprimir el valor | idem |

`deploy.yml` pasa `require_real_stripe: true` en su llamada a `e2e-real.yml` — y ese job ya era `needs` de
`promote-production-*` (`deploy.yml:290-293, 328-331`). **Resultado: sin clave de prueba real, no hay
promoción a prod, y se sabe en el primer minuto en vez de en un rojo de Playwright 20 minutos después.**

Fuera de la ruta de promoción **nada se rompe**: el nightly y el `workflow_dispatch` siguen corriendo con
el dummy y un aviso claro, que es lo correcto para un repo sin el secret configurado.

#### Resumen: qué es gate y qué no (criterio de §30.1)

| Corrida | ¿Gate? | Qué significa su verde |
|---|---|---|
| `e2e-real.yml` con `sk_test_…` real, `E2E_BASE_URL` + `E2E_REAL=1` | **SÍ — bloquea la promoción a prod** | Los 3 flujos de dinero crean sesión de pago contra Stripe real desde el navegador, autenticando de verdad |
| `e2e-real.yml` con la clave dummy | **NO** | Nada sobre dinero. Los 3 salen rojos por falta de proveedor. |
| Stack nativo local + clave de prueba | **NO** | **Imposible aquí:** egress a `api.stripe.com` bloqueado (§31.2) |
| Suite completa sin `E2E_REAL` contra stack real | **NO** | Ver §30.1. Con el helper arreglado ya autentica, pero sigue sin ser el gate de dinero. |

### 31.5 Efecto en las condiciones abiertas del DoD (§30.6)

| # | Condición | Estado tras este pase |
|---|---|---|
| 1 | Tres flujos de dinero sin verificar en navegador | **En curso, con dueño claro.** El camino está cableado y es un gate duro; **falta que el humano cree `STRIPE_TEST_SECRET_KEY` y `STRIPE_TEST_PUBLISHABLE_KEY`**. Se cierra cuando `e2e-real.yml` pase en verde con clave real. | **⚠️ CORREGIDO 2026-09-10 → §51: las dos claves de prueba LLEVAN TRES DÍAS en los secrets; el nocturno `34477885121` corrió los flujos en REAL con `MONEY_SKIPPED` vacío. Lo que falta es `STRIPE_TEST_WEBHOOK_SECRET`, y ya no bloquea (§50.4).**
| 2 | Disparador duro de R1 / S49-M1 | **Deja de aplicar a estas dos.** Backend las **corrigió** en vez de aceptarlas (y encontró que S49-M1 eran **cinco** rutas, no cuatro: faltaba la salida idempotente de `pay-spei`). **Pendiente de que `seguridad` confirme la re-verificación**; hasta entonces no lo doy por cerrado yo. La propuesta de §30.5 **no se tira**: sigue siendo el mecanismo para deuda aceptada futura, pero **hoy no hay nada que disparar**. |
| 3 | `@nestjs/core` GHSA-36xv-jgw5-4q75 | Sin cambio: deuda **no bloqueante**, registrada y aceptada. Dueño **backend**. |

### 31.6 Nota operativa: `status` daba un falso «frontend caído»

Al cerrar este pase, `./scripts/stack-native.sh status` reportó **`frontend: 000`** con el proceso
**vivo y sirviendo 200**. Causa: `next dev` **compila bajo demanda**, y el log mostraba
`✓ Compiled /[locale] in 9.6s` justo en ese momento; el `curl -m 3` del `status` expiraba antes.

Importa más de lo que parece **hoy**: un falso «caído» invita a relanzar el stack, y ahora mismo hay
otros roles trabajando contra `:3099`. Timeout del frontend subido a **15s** y anotado en el propio
script: si aun así sale `000`, confirmar con `pgrep -af "next dev"` y `tail .native-stack/frontend.log`
**antes** de relanzar nada.

**Sigo sin re-certificar el DoD y sin desplegar ni tagear.** El árbol se va a mover otra vez (arquitecto
baja el techo de la curva a MX$2,000 + backend lo implementa, más la semilla de spreads de UPC), así que
cualquier certificación de hoy caducaría igual que la de §29.11-bis. **Se hace con el commit final,
cuando se me pida.**

---

## 32. Propagación de SEEDS a entornos ya sembrados — la regla general (§11.0) y el paso de v1.50.3 (§4.38p) — 2026-08-28

> **La frase del arquitecto, sin suavizar y sin contexto que la amortigüe:**
> **sin ese paso, el despliegue pasa todos los gates y la feature se comporta en producción
> exactamente como antes.**
>
> Es un **falso verde**, y es la clase de cosa que el DoD existe para impedir. Un release puede tener CI
> en verde, doble veredicto, SAST/DAST limpios y la E2E completa pasando — y no haber cambiado nada en
> el entorno donde importa. Esta sección es el procedimiento que cierra ese hueco.

**Aplica a esta release** (`claude/psa-graded-card-value-gmhv5u`, v1.50.3) **y a todas las que vengan**:
§32.1 es la regla general, §32.2–§32.5 son su aplicación concreta a los tres diales de hoy.

**Ámbito, para que nadie busque una migración que no existe:** **M-42 es DATA/seed, SIN DDL.** No hay
migración de Prisma que correr por esta feature (no toca `schema.prisma`: ni tablas, ni columnas, ni
enums, ni backfill). La única migración de este pase es **M-41** (instrumentación de la curva v2), que
**ya está desplegada**. Lo que falta no es `migrate deploy`: es **dato de configuración**.

---

### 32.1 La regla general (ARCHITECTURE §11.0) en lenguaje operativo

Tres frases, y de ellas se deriva todo lo demás:

1. **Un seed es una CONDICIÓN INICIAL, no un estado deseado.** `prisma/seed.ts` hace `upsert` con
   **`update: {}`** — o sea, **crea claves nuevas y NUNCA pisa las existentes**. Eso es **correcto y no
   se toca**: es exactamente lo que impide que un deploy borre en silencio el ajuste deliberado de un
   operador. El corolario, que es el que muerde: **cambiar un seed no cambia ningún entorno ya
   sembrado.** Ni prod, ni staging, ni la base de quien corrió el seed una vez hace tres meses.

2. **Por tanto, cambiar el seed de una clave YA EXISTENTE es un cambio de DATOS, no de código.** Y un
   cambio de datos exige **dos artefactos, no uno**:

   | Artefacto | Quién lo entrega | A quién sirve |
   |---|---|---|
   | (a) El **default nuevo** en `settings.constants.ts` / `common/*.ts` | backend | **Solo a entornos NUEVOS** (los que aún no han corrido el seed) |
   | (b) Un **paso de despliegue explícito y verificable** | **devops + el operador** | A **todos los entornos ya sembrados**: dev con base vieja, staging y **prod** |

   **Entregar solo (a) es entregar algo que funciona en los tests y no en producción** — que es la peor
   forma de no entregarlo, porque además se ve verde.

3. **No se automatiza como `UPDATE` incondicional.** Y el motivo no es pereza: **`ConfigSetting` guarda
   un VALOR, no su PROCEDENCIA.** «Sigue en el seed viejo» y «el operador lo eligió así» son
   literalmente el mismo dato en la tabla. Un `PUT`/`UPDATE` incondicional destruiría justo lo que
   `update: {}` protege, y lo haría **en silencio**. Ver §32.4.

**Por qué esto no es una anécdota de esta feature:** el proyecto tiene **decenas de diales sembrados**
(escalones de grading, spreads de sellado, tiers, curva de precios, frescuras, cuotas de ingest).
**Cualquiera de ellos puede cambiar de default en el futuro, y ninguno llegará solo.** Cuando eso pase,
lo que se aplica es esta sección, no una nueva.

> **Regla de trabajo de devops, derivada:** cuando un PR cambia un valor en `SETTING_DEFAULTS` o en las
> constantes `DEFAULT_*` de una clave **que ya existía**, ese PR **no está completo** hasta que trae su
> paso (b). Si llega sin él, el hallazgo se enruta al rol dueño del código — devops no lo inventa.

---

### 32.2 El paso de despliegue de esta release (§4.38p) — los tres diales de v1.50.3

**Qué se corrigió en el código, y en qué dirección iba el valor viejo:**

| Clave (DTO de admin) | Seed VIEJO | Default NUEVO | Dirección del viejo | Criterio que gobierna |
|---|---|---|---|---|
| `manualFreshnessDays` | `null` | **30** | **PERMISIVA** — `null` **deroga** el criterio | **109** — el override manual decae a los 30 días |
| `minSampleCount` | `3` | **5** | **PERMISIVA** — admite muestras que §O.7 rechaza | **111(a)** / §O.7 — `minSalesSample` = 5 |
| `maxRawMultiple` | `50` | **100** | Restrictiva — suprimía sin explicación 50×–100× | **111(c)** / §O.7 — `maxGradedMultiple` = 100× |

**Verificado en vivo por backend, no supuesto:** en cualquier entorno ya sembrado —**incluida
producción**— esas tres claves **conservan sus valores viejos** con el código nuevo desplegado y los
tests en verde. El E2E del criterio 109 le falló hasta fijar el dial a mano.

**El procedimiento. Se corre en CADA entorno ya sembrado** (dev con base vieja, **staging**, **prod**),
después del deploy y **antes de anunciar el release**:

```bash
# PASO 1+2 — GET, comparar con los defaults nuevos, e IMPRIMIR el PUT exacto.
#            Solo lectura: este script NO escribe nada, y no tiene bandera para hacerlo.
ADMIN_BASE_URL='https://<api-del-entorno>/api/v1' \
ADMIN_JWT='<access token de super_admin>' \
  bash scripts/check-graded-estimate-dials.sh
```

Códigos de salida, pensados para leerse de un vistazo:

| rc | Significa | Qué hacer |
|---|---|---|
| **0** | Los tres diales ya están en su valor de criterio | Nada. Seguir a la verificación de cierre (§32.5). |
| **10** | Hay claves **en el seed viejo** | Ejecutar el `PUT` que el script imprimió (paso 3). |
| **20** | Hay claves que **divergen** de ambos valores | **Preguntar al humano.** No se pisa nada. §32.4. |
| **2** | Error de entorno, o el DTO **no trae** una de las claves | Parar. El binario desplegado no es el que creemos. |

```bash
# PASO 3 — aplicar SOLO las claves que siguen en el seed viejo. El cuerpo es PARCIAL a
#          propósito: reenviar las que ya estaban al día es una escritura auditada sin
#          cambio, o sea ruido en el AuditLog de un dial comercial.
curl -X PUT "$ADMIN_BASE_URL/admin/pricing/graded-estimates" \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -H 'Content-Type: application/json' \
     -d '{ "manualFreshnessDays": 30, "minSampleCount": 5, "maxRawMultiple": 100 }'
```

```bash
# PASO 4 — VERIFICACIÓN DE CIERRE. Es parte del paso, no un extra. Ver §32.5.
bash scripts/check-graded-estimate-dials.sh   # debe salir 0, los tres AL DÍA
```

**Cableado para que no se olvide:** `scripts/post-deploy.sh` gana un **PASO 8** que corre el comparador
(solo lectura, con `ADMIN_BASE_URL`+`ADMIN_JWT`; si faltan, imprime la instrucción manual). **No bloquea
el post-deploy** —informa y sigue—, pero si el resultado no es `0` el resumen final imprime
**«BLOQUEA EL ANUNCIO DEL RELEASE»**. La distinción es deliberada: el script no puede decidir por el
operador, pero sí puede impedir que el pase termine con un «todo OK» que no es cierto.

---

### 32.3 PROHIBIDO `UPDATE` directo a la base — y el motivo no es estético

Es más rápido. Es una línea de SQL. **No se hace**, y conviene que las tres razones estén escritas
porque cada una tapa un agujero distinto:

| Lo que da el `PUT` de admin | Lo que pasa con `UPDATE` directo |
|---|---|
| **Queda AUDITADO** (`AuditLog`, M10, con `before`/`after` y el `userId`): se ve **quién** tocó un dial que gobierna una **afirmación comercial** y **cuándo**. | **Cero rastro.** Dentro de seis meses, «¿por qué prod tiene 14 aquí?» no tiene respuesta. |
| **Pasa las validaciones I1–I9** del recurso. | Puede dejar la clave **presente-e-inválida**. Y eso **no es inocuo: APAGA la feature** por fail-closed (§4.38d) — `AUSENTE ≠ INVÁLIDA`: una clave ausente cae al default de código, una clave presente-e-inválida apaga la superficie. Un `UPDATE` con el tipo equivocado apaga el gancho entero **sin que nadie lo pida**. |
| **Surte efecto SIN REDEPLOY** (el resolver lee el setting en cada request). | Igual de inmediato, pero sin las otras dos garantías. Se pierde todo y no se gana nada. |

**SQL directo se salta las tres.** No hay caso en el que compense.

> Mismo criterio, distinto sitio: el **`UPDATE` masivo tampoco es la vía para repriciar** (§29 / P-48).
> Es el mismo principio: la vía normal de operación existe porque valida, audita y es reversible.

---

### 32.4 Si un dial DIVERGE: **la decisión NO es de devops**

**Este es el punto que más importa de toda la sección.**

Si al comparar aparece un valor que **no es ni el default nuevo ni el seed viejo** —digamos
`manualFreshnessDays = 14`— eso es señal de que **alguien lo ajustó a propósito**. Y **no hay forma de
confirmarlo**: `ConfigSetting` guarda un valor, no su procedencia. «Se quedó así desde el seed» y «el
operador lo eligió así» **son el mismo dato**. Peor: los valores viejos (`null`, `3`, `50`) son
**elecciones de operador perfectamente plausibles**, así que ni siquiera el caso «coincide con el seed
viejo» es prueba de nada — solo es lo bastante probable como para proponer el cambio.

> **Se evaluó y se DESCARTA** inferir la procedencia del `AuditLog` («si nadie editó esta clave, sigue en
> el seed»). Hacer depender la sobrescritura de un dial comercial de la **completitud de un log** falla
> **abierto y en silencio** ante una poda de auditoría o una edición fuera de banda. Demasiado listo para
> una ruta que decide qué se publica.

**Por lo tanto, y sin ambigüedad:**

- **Pisarlo es decisión del HUMANO, no de devops.** En ese caso **se pregunta, no se sobrescribe.**
- Lo que devops entrega es **la comparación**: valor vigente, default nuevo y el criterio que gobierna,
  **clave por clave**, para que el dueño decida con los dos números delante.
- `scripts/check-graded-estimate-dials.sh` **no propone `PUT` para las claves divergentes**, ni tiene
  bandera de `--force`. Sale con `rc=20` y las lista.
- En la lista del humano esto va como **GU-13** — no porque sea difícil, sino porque **tocar diales de
  producción no es algo que devops haga por iniciativa propia**.

---

### 32.5 Verificación de cierre — y el límite honesto del E2E (hallazgo de devops)

> ⚠️ **ACTUALIZACIÓN v1.51 (M-48) — leer antes de correr el punto (3).** El spec del criterio 109
> **enciende y apaga el dial del gancho**, y desde el colapso a **un solo dial** ese flip **también
> autoriza el ingest de un proveedor de PAGA**. Consecuencia normativa (§4.38r.6.3): ese E2E —y
> cualquier verificación del **criterio 108**— se corre **solo en un entorno sin credencial del
> proveedor** o **con la sonda encendida**; nunca «apagando y encendiendo a ver» contra un entorno con
> llave viva. El resto de esta §32.5 sigue vigente tal cual. Ver **§32.12**.

Un `PUT` con HTTP 200 dice que **la escritura se aceptó**, no que **el criterio se cumple**. La
verificación tiene tres piezas, y **no son intercambiables**:

**(1) Re-leer la config.** `bash scripts/check-graded-estimate-dials.sh` → `rc=0`, los tres AL DÍA.
Barato, seguro, y sirve **en cualquier entorno, prod incluida**.

**(2) La LÍNEA DE INVENTARIO del arranque.** Backend añade al izar la config una línea **`info`**
(deliberadamente **no `warn`**: los diales ajustados a propósito son normales, y una alerta por cada uno
es **ruido que se aprende a ignorar**) enumerando las claves cuyo valor vigente **difiere de su default
de código**. Para devops esto es oro: convierte **«¿qué diales tiene realmente prod?»** en un `grep`
sobre los logs de arranque, en vez de en una consulta a la base de producción.

**Verificado contra la implementación de backend (`settings.service.ts`), no supuesto — el prefijo
exacto del log es `config inventory:`**, así que el grep es literal:

```bash
# Railway (o el agregador de logs que aplique), tras reiniciar el servicio:
railway logs --service backend | grep 'config inventory'

# Stack nativo local:
grep 'config inventory' .native-stack/backend.log
```

Cómo se lee la salida:

| Línea | Significado |
|---|---|
| `config inventory: las N clave(s) sembradas están en su default de código.` | El entorno está **exactamente** alineado con el código. |
| `config inventory: M de N clave(s) DIFIEREN … → clave=valor (default …)` | Inventario de lo ajustado. **Cada entrada trae el valor vigente Y el default**, que es justo la comparación de §32.2 — pero para **todos** los diales del proyecto, no solo los tres de hoy. |
| `config inventory: no se pudo leer ConfigSetting …` (`warn`) | Fallo de observabilidad, no de la app. No concluye nada: usar (1). |

**Una clave AUSENTE no se lista** (resuelve al default, así que no difiere). Si las tres claves de esta
release ya **no** aparecen en esa línea, el entorno está alineado con el código.
*(Única excepción que sigue siendo `warn`: `manualFreshnessDays === null` (I8-bis), porque **desactiva un
criterio de `PROJECT.md`**. Un `warn` ahí sí está ganado.)*

**(3) El E2E del criterio 109** — **en STAGING, no en prod.** Aquí está el hallazgo que devops añade al
paso de §4.38(p), y prefiero decirlo antes de que alguien lo intente:

```bash
# STAGING (o local con el stack nativo). DATABASE_URL apunta al entorno destino.
cd backend
DATABASE_URL='postgresql://…staging…' \
  npx jest --config test/jest-integration.config.js --runInBand \
    test/integration/graded-estimate.e2e-spec.ts -t '8d'
```

| Lo que hay que saber antes de correrlo | Consecuencia |
|---|---|
| El arnés (`test/integration/helpers/e2e-app.ts`) **levanta la app Nest en proceso** contra `DATABASE_URL` — no es un cliente HTTP contra una URL remota. | «Contra el entorno destino» = **apuntando a su base**, no a su URL. |
| El spec **ESCRIBE**: `PUT /admin/settings` para encender/apagar el dial global, `PUT` de `manualFreshnessDays`, `POST /admin/pricing/override` y un `updateMany` que envejece `capturedDate`. | **No se corre contra producción.** Volcaría escrituras sobre datos reales y encendería/apagaría un dial global. |
| `beforeAll` exige el fixture sintético `e2e-common` y **lanza** si no está (`npm run seed:synthetic`). | En prod **ni siquiera arrancaría**: no hay fixtures sintéticos y no debe haberlos. |
| El caso **8d fija el dial él mismo** (`PUT { manualFreshnessDays: 30 }`) antes de asertar. | ⚠ **El E2E ya NO detecta el seed viejo.** Prueba el **comportamiento** con el dial en su valor de criterio; **no** prueba que el entorno lo tenga. |

**Qué significa esa última fila, sin adornos:** cuando el arquitecto escribió que «el E2E del criterio 109
falló hasta fijar el dial a mano», eso fue **antes** de que backend endureciera el test. Hoy el spec se
autoabastece — lo cual está bien para lo que él verifica (que la lógica de decaimiento existe y funciona)
— pero **deja de ser el detector del seed rancio**. El detector es **(1)** y **(2)**. Quien crea que
«corrí el E2E y pasó» equivale a «el dial de prod está bien», se está engañando con la misma clase de
verde falso que esta sección vino a quitar.

**Reparto, entonces:**

| Entorno | (1) `GET`/comparador | (2) Línea de inventario | (3) E2E 109 |
|---|---|---|---|
| Local con base vieja | Sí | Sí | Sí |
| **Staging** | Sí | Sí | **Sí — aquí es donde corre** |
| **Producción** | **Sí — es la verificación** | **Sí** | **NO. Nunca.** |

> **Escalada al arquitecto (regla 9, no la resuelvo yo):** §4.38(p) paso 4 dice «correr el E2E del
> criterio 109 contra ese entorno», y ese entorno incluye prod en la lista del propio paso. **Tal como
> está escrito no es ejecutable contra producción** por las cuatro razones de la tabla. Propongo que §4.38(p)
> paso 4 se lea: *«re-`GET` + línea de inventario en TODOS los entornos; E2E del criterio 109 en
> staging»*. Mientras el arquitecto no lo enmiende, **el procedimiento operativo vigente es esta §32.5**,
> y queda escrito aquí que difiere del literal del contrato en ese punto.

---

### 32.6 Arnés de gates: `next build` + `next start`, **nunca `next dev`**

> ⚠ **Léase junto con §32.10.** Este arnés estuvo **roto desde que se escribió**: el `NODE_ENV=development`
> que el backend necesita se filtraba al `next build` y lo mataba, así que el modo gate que esta sección
> documenta **no era ejecutable**. Arreglado y verificado corriéndolo (2/2 en verde) el 2026-08-28 — §32.10.

Hallazgo de frontend que afecta a cualquier gate que devops declare, así que vive aquí:

**El problema.** `frontend/playwright.config.ts:71` usa **`reuseExistingServer: !isCI`**. Si hay un
`next dev` suelto en el puerto y se corre la suite en **modo MOCK** (sin `E2E_BASE_URL`), **Playwright
reutiliza ese servidor** en vez de levantar el suyo con `NEXT_PUBLIC_USE_MOCKS=true` ⇒ las pruebas
**hablan con el backend real en vez de con los datos de prueba**. **Nueve specs fallaron en bloque** por
esto, y ese rojo **no medía nada**. El modo de fallo simétrico es peor: un servidor reusado que
*casualmente* sirva lo esperado da un **verde** que tampoco mide nada.

**Y aunque no se reutilice: `next dev` no sirve para un gate.** Compila **bajo demanda** (de ahí el falso
`frontend: 000` del `status`, §31.6), **se degrada tras varias recompilaciones**, y sobre todo **no es el
artefacto que se despliega**.

**Regla, para gates y para veredictos:**

> **Un gate corre contra `next build` + `next start`. `next dev` es para desarrollar.**

Lo que se cableó del lado de devops:

- **`scripts/stack-native.sh up --gate`** (o `FRONTEND_MODE=build`): hornea con `next build`
  —`NEXT_PUBLIC_USE_MOCKS=false` y la URL del backend quedan **FIJADAS en el bundle**, no dependen del
  entorno del runtime— y sirve con `next start`.
- **En modo `--gate` el script se NIEGA a reutilizar** lo que ya responda en el puerto: muere con
  instrucciones para apagarlo. En modo `dev` sigue reutilizando (es cómodo y no es un gate), pero
  **avisa** de que no verificó con qué se horneó ese proceso.
- `stop_apps` ahora también mata `next start -p $FRONTEND_PORT`, no solo `next dev`.

**Regla operativa complementaria: una sola app por puerto, y sabiendo cuál es.** Antes de correr la
suite en modo MOCK: `./scripts/stack-native.sh down`, **o** exportar `CI=1` (desactiva
`reuseExistingServer`). En modo GATE no aplica: `E2E_BASE_URL` desactiva el `webServer` entero.

> **Hallazgo para FRONTEND (su archivo, no lo toco):** `playwright.config.ts:68` levanta `npm run dev`
> como `webServer`, así que **incluso en CI** (`e2e.yml`, modo mock) el gate corre sobre `next dev` —
> Playwright no lo reutiliza allí, pero lo arranca él. Y `reuseExistingServer: !isCI` hace que el
> resultado local dependa de qué haya suelto en el puerto. Propuesta: `command` de build+start para las
> corridas de gate, y `reuseExistingServer: false` salvo opt-in explícito. **No bloquea** el pase de hoy
> (el gate real es `e2e-real.yml`, que va contra `E2E_BASE_URL` y no usa el `webServer`), pero mientras
> siga así, el veredicto de un modo mock local depende del entorno de quien lo corre.

---

### 32.7 Huecos de entorno preexistentes — **siguen vigentes, siguen abiertos**

Re-verificados en este pase. **No son nuevos y no los abre esta release**; se confirman para que nadie
lea un verde parcial como cobertura completa. **Entre los dos dejan 4 smokes de dinero sin verificar en
navegador.**

| # | Hueco | Qué bloquea | Dueño | Estado |
|---|---|---|---|---|
| 1 | **Falta `STRIPE_TEST_SECRET_KEY`** (+ `STRIPE_TEST_PUBLISHABLE_KEY`) en los secrets de GitHub | **3 smokes**: `checkout`, `guest-checkout`, `shipments`. Sin clave, el backend cae a `sk_test_dummy`, `paymentIntents.create` falla y devuelve **503 `PAYMENT_PROVIDER_UNAVAILABLE`** (degrada money-safe: libera la reserva). | **HUMANO** — solo él puede crear la clave | **ABIERTO.** §31.1 sigue siendo la instrucción exacta. La fontanería ya existe (`docker-compose.staging.yml:171-173,206`) y el preflight de `e2e-real.yml` ya es gate duro en la ruta de promoción (§31.4). **No falta cableado: falta la clave.** | **⚠️ CORREGIDO 2026-09-10 → §51: las dos claves de prueba LLEVAN TRES DÍAS en los secrets; el nocturno `34477885121` corrió los flujos en REAL con `MONEY_SKIPPED` vacío. Lo que falta es `STRIPE_TEST_WEBHOOK_SECRET`, y ya no bloquea (§50.4).**
| 2 | **`scripts/stack-native.sh` no levanta MinIO/R2** | **1 smoke**: la **subida del INE del buylist** (sobre el tope AML) — el flujo `uploads` no se ejercita por la ruta nativa. | **devops** (asumido, no bloqueante) | **ABIERTO y ACEPTADO.** Documentado desde §30 (línea «Sin MinIO/R2») y avisado por el propio script al terminar. Alternativas: ruta Docker (`docker-compose.staging.yml`) o levantar MinIO aparte. |

**Nota honesta sobre el hueco 1, que ya estaba en §31.3 y no ha cambiado:** aunque la clave llegue, esos
tres verdes prueban **«la sesión de pago se crea contra Stripe de verdad»**, **no** «el pedido se
asienta». La cadena completa navegador → Stripe → webhook → `settled` **no la cubre nadie hoy** y no la
declaro como gate.

**Y sobre correrlo aquí:** `api.stripe.com` está **bloqueado por egress** desde esta máquina
(CONNECT → 403, §31.2). Darle la clave al stack nativo local **no** pondría esos smokes en verde: se
quedarían rojos por timeout de red en vez de por falta de clave. **El gate vive en `e2e-real.yml`** (runner
`ubuntu-latest`, salida abierta) o en un staging real.

---

### 32.8 Rollback

> ⚠️ **CORREGIDA POR M-48 (v1.51, 2026-08-31). El botón de pánico de esta sección CAMBIÓ DE CLAVE.**
> Esta sección se escribió para el pase del 2026-08-28, cuando el gancho de grading tenía **dos**
> diales. M-48 los colapsó en **uno** (`grading_hook_enabled`, DTO `gradingHookEnabled`) y **retiró**
> `graded_estimates_enabled` y `graded_estimate_ingest_enabled` del código: siguen como filas en la
> tabla, pero **son inertes y `PUT /admin/settings` las rechaza con 422**. La tercera fila de la tabla
> de abajo ya viene corregida. **El rollback canónico de M-48 es §32.12.7 — léelo si el incidente es
> del gancho de grading.**

**El rollback de un dial NO es un rollback de deploy.** Los dos casos, y son distintos:

| Escenario | Acción | Por qué |
|---|---|---|
| **El `PUT` de §32.2 se aplicó y hay que revertirlo** | **Otro `PUT`** con el valor anterior (que el comparador te imprimió antes de aplicar — **anótalo**). Efecto inmediato, **sin redeploy**. | Es un cambio de datos por la vía normal: queda **auditado en las dos direcciones** (`before`/`after`) y validado. Nunca un `UPDATE` ni un restore de base: para revertir **un valor** no se toca un backup. |
| **Se revierte el DEPLOY de v1.50.3** | El código vuelve atrás; **las filas `ConfigSetting` NO vuelven atrás**. | Es el **corolario simétrico de §32.1**: igual que un deploy no cambia un dial, un rollback tampoco lo revierte. Las tres claves quedan **huérfanas e inertes** (precedente `rarity_map`, §M2 v1.32) — el código viejo no las lee. **Sin riesgo de $0 ni ventana ciega**: el flag arranca `off` y el resolver es fail-closed on-read. |
| **La feature se comporta mal tras aplicar los diales** | **Apagarla con su dial M10** — el **DIAL ÚNICO** desde v1.51: `PUT /admin/settings {"gradingHookEnabled":"off"}`. No requiere deploy ni tocar los tres diales. ⛔ **NO** `gradedEstimatesEnabled`: esa clave está **RETIRADA** y el endpoint la rechaza con **422 `VALIDATION_ERROR` / `"unknown setting key"`, 0 upserts** — el gancho se queda **encendido y facturando**. | Fail-closed: con `off` no se evalúa nada, no se emite ningún campo **y el ingest no pide nada al proveedor de paga** (cero créditos, cero escrituras). Es el rollback **más barato y más rápido** de esta feature, y el que hay que intentar primero. **Ejecutado de verdad**: 200 + dial en `off` + espejo `enabled:false` + ingest sin pedir nada — salida real en §32.8-bis. |

⚠ **Lo que el rollback de deploy NO deshace:** las filas `PriceReference` con `gradeKey='graded:PSA:*'`
que el admin haya fijado **sobreviven** y siguen siendo lo que ya eran antes de v1.50 (el valor de
mercado de M1 «Gradeadas», §M1 v1.28). Eso es correcto y deliberado; no se limpian.

**Recordatorio de la regla de oro (§7): datos primero, luego código.** Aquí no hay snapshot que tomar
—**M-42 no tiene DDL**— pero sí hay algo que **anotar antes de escribir**: los tres valores vigentes que
el comparador imprime en el paso 1. Sin ese apunte, el rollback del dial no tiene a dónde volver.

---

#### 32.8-bis El botón de pánico, **EJECUTADO** — no «debería funcionar» (2026-08-31)

QA rechazó M-48 porque §32.8 mandaba a una tecla muerta. **La corrección no se declara: se demuestra.**
Stack nativo real (`stack-native.sh up --infra` + backend NestJS completo por `ts-node` en `:3099`,
guards y pipes activos), `super_admin` autenticado de verdad. **Salida literal, pegada sin editar:**

**A) El cuerpo que mandaba §32.8 hasta hoy — reproduce el fallo de QA, carácter por carácter:**

```
$ curl -X PUT :3099/api/v1/admin/settings -d '{ "gradedEstimatesEnabled": "off" }'
{"error":{"code":"VALIDATION_ERROR","message":"Invalid settings payload",
 "details":{"errors":{"gradedEstimatesEnabled":"unknown setting key"}}}}
HTTP 422
```

**B) El incidente, simulado de verdad:** se **enciende** el gancho (`{"gradingHookEnabled":"on"}` →
HTTP 200) y se confirma en la base que el gasto queda autorizado:

```
grading_hook_enabled = on
```

**C) El cuerpo NUEVO del runbook, contra el endpoint real:**

```
$ curl -X PUT :3099/api/v1/admin/settings -d '{"gradingHookEnabled":"off"}'
gradingHookEnabled en la RESPUESTA = "off"
HTTP 200

$ curl -X GET :3099/api/v1/admin/settings          → gradingHookEnabled = "off"
$ psql … WHERE key='grading_hook_enabled'          → grading_hook_enabled = off  (updatedBy=fb3567da-…)
$ curl -X GET :3099/api/v1/admin/pricing/graded-estimates → enabled = false   (el espejo que lee el INGEST)
```

**D) Y el apagón APAGA el dinero, no solo la vitrina** — verificación positiva de ausencia de gasto:
con el dial ya en `off` se dispara `POST /admin/jobs/price-ingest {}` (HTTP 202) y el log dice:

```
[PriceIngestService] graded-estimate-ingest: dial `grading_hook_enabled` = off → no se pide NADA al
proveedor (cero créditos) y no se escribe NINGUNA fila.
[PriceIngestService] [VEREDICTO-PSA] VEREDICTO: INDETERMINADO — No se preguntó nada.
```

**E) El rastro queda en las dos direcciones** (`AuditLog`, `action='settings.update'`), que es lo que
hace auditable un rollback a posteriori:

```
2026-08-31 04:55:05 | settings.update | before.gradingHookEnabled=on  -> after.gradingHookEnabled=off
2026-08-31 04:54:49 | settings.update | before.gradingHookEnabled=off -> after.gradingHookEnabled=on
```

> **Por qué esto era bloqueante y no cosmético.** El estado `on` de este dial gasta créditos de un
> proveedor de paga en **cada tick del cron, 2×/día, sin humano delante**. Quien estuviera dentro de un
> incidente siguiendo §32.8 recibía un 422, **0 upserts**, y se quedaba con el gancho **encendido y
> facturando** mientras creía haberlo apagado. Un rollback que no ejecuta no es documentación
> incompleta: es la mitad que falta del control de dinero que M-48 existe para construir.
>
> **Y es el mismo defecto que backend ya había cazado en su runbook (`fa2e3eb`).** Yo escribí el
> runbook correcto —vive en §32.12.7— y aun así metí 447 líneas en este archivo **sin tocar §32.8**,
> que no llevaba banner y por tanto se leía como vigente. La lección operativa, escrita para el
> siguiente pase: **cuando se retira una clave de configuración, el trabajo no es documentar la nueva;
> es barrer TODAS las instrucciones vigentes que nombran la vieja.** El barrido de este pase está en
> §32.8-ter.

---

#### 32.8-ter Barrido de claves retiradas en este archivo — qué se corrigió y qué se conserva

Patrón corrido sobre `docs/DEVOPS_NOTES.md` (las **cuatro** formas retiradas, no solo las dos que
señaló QA — `graded_estimates_enabled` es tan tecla muerta como la del ingest):

```bash
grep -nE "graded_estimates_enabled|gradedEstimatesEnabled|\
graded_estimate_ingest_enabled|gradedEstimateIngestEnabled" docs/DEVOPS_NOTES.md
```

**11 aciertos, revisados uno a uno a mano.** El criterio de corte es el que pidió QA: **una
instrucción operativa vigente se corrige; una descripción histórica fechada se conserva y, si hace
falta, se rotula.** Borrar las descripciones sería peor que inútil — son justamente lo que enseña la
trampa de diagnóstico de §4.38(r.1).

*(Las líneas son las del archivo **ANTES** de este arreglo — son las que citó QA. Tras las
correcciones el archivo creció; la referencia estable es la **sección**.)*

| Línea (pre-fix) | Sección | Qué es | Veredicto |
|---|---|---|---|
| 4839 | §32.8 | **INSTRUCCIÓN**: el `PUT` del botón de pánico | 🔴 **CORREGIDA** → `{"gradingHookEnabled":"off"}` + banner en §32.8 |
| 4860 | §32.9 | **INSTRUCCIÓN**: ítem de checklist «la feature sigue APAGADA por su dial (`graded_estimates_enabled = off`)», para pegar en el ticket del release. **QA no lo señaló** — su patrón no cubría esta clave | 🔴 **CORREGIDA** → `grading_hook_enabled` + banner de supersesión en §32.9 |
| 56 | índice | Descripción fechada de la **trampa** («leer `graded_estimate_ingest_enabled = off` y concluir …») | 🟢 Se conserva: **advierte** contra la clave muerta, no manda a ella |
| 5057, 5110 | §32.12 | Por qué las dos claves quedan retiradas y vivas, y por qué la clave es NUEVA | 🟢 Se conserva: es la decisión de seguridad de M-48 |
| 5204 | §32.12.3 | **Salida real pegada** de la línea de inventario del arranque | 🟢 Se conserva: es evidencia, no instrucción |
| 5242, 5248, 5249, 5264 | §32.12.4 | Qué detecta el comparador sobre binarios PRE-M-48 y sus roturas demostradas | 🟢 Se conserva: nombrar la clave muerta **es** la función del check |
| 5405 | §32.12.7 | Efecto de un rollback de **código**: el binario viejo vuelve a leer `graded_estimates_enabled` | 🟢 Se conserva: es correcto y es el motivo de no borrar las filas |

**Fuera de este archivo:** el mismo patrón sobre `scripts/`, `.github/workflows/`, `docker-compose*.yml`
y `.env.example` da **6 aciertos, todos en `scripts/check-graded-estimate-dials.sh`** (líneas 33, 37,
152, 161, 215, 221) y **todos correctos**: ese script nombra las claves muertas **para detectarlas y
gritar**, que es exactamente lo contrario de mandar a ellas. **Ninguno se toca.**

---

### 32.9 Checklist del pase (§4.38p) — para pegar en el ticket del release

> ⚠️ **CHECKLIST DEL PASE DEL 2026-08-28 (v1.50.3 / M-42). SUPERADA POR §32.12.9 para el pase de M-48.**
> Se conserva porque los 3 diales de M2 siguen siendo los mismos, pero **el nombre del dial del
> penúltimo punto cambió con M-48** y ya viene corregido abajo. Si el pase que estás preparando es el
> de M-48 (v1.51), **la checklist que se pega en el ticket es la de §32.12.9**, no ésta.

- [ ] `migrate deploy` — **nada nuevo por M-42** (es DATA/seed, sin DDL). M-41 (curva) ya está desplegada.
- [ ] **Staging**: `check-graded-estimate-dials.sh` → anotar los 3 valores vigentes **antes** de tocar nada.
- [ ] **Staging**: aplicar el `PUT` parcial solo de las claves en el seed viejo. Divergentes → **preguntar** (§32.4).
- [ ] **Staging**: re-`GET` (`rc=0`) + línea de inventario del arranque + **E2E del criterio 109** (`-t '8d'`).
- [ ] **Prod**: `check-graded-estimate-dials.sh` → anotar los 3 valores vigentes.
- [ ] **Prod**: aplicar el `PUT` parcial. Divergentes → **preguntar al humano (GU-13)**, no sobrescribir.
- [ ] **Prod**: re-`GET` (`rc=0`) + línea de inventario del arranque. **E2E 109 NO se corre aquí** (§32.5).
- [ ] La feature sigue **APAGADA** por su dial (**v1.51: `grading_hook_enabled = off`**, DTO
      `gradingHookEnabled`; la vieja `graded_estimates_enabled` está **retirada e inerte** — verificarla
      no prueba nada) hasta que el humano apruebe el texto legal. **Encenderla no es decisión de
      devops** y **no es parte de este paso**; desde M-48 encenderla es además un **acto de gasto**
      (§32.12.1).
- [ ] Solo entonces: anunciar el release.

> **El último punto no es una formalidad.** Los tres diales se alinean **con la feature apagada**. Eso es
> lo correcto: cuando el humano la encienda, se enciende **ya con el criterio que `PROJECT.md` escribió**,
> no con el que el código eligió por accidente. Alinear los diales **después** de encender significaría
> publicar durante un rato afirmaciones comerciales que el producto no autorizó.

---

### 32.10 El arnés de gate no arrancaba: el `NODE_ENV` del backend se filtraba al `next build` — 2026-08-28

**Rechazo de QA, BLOQ-1, y es mío.** La ironía no se me escapa: el bloqueante estaba en el arnés que
§32.6 añadió justamente para cerrar la trampa anterior (gates corriendo sobre `next dev`). Un arnés que
no arranca no es mejor que no tener arnés — es peor, porque *parece* que hay un camino.

**Síntoma.** `./scripts/stack-native.sh up --seed --gate` moría en el build del frontend:

```
⚠ You are using a non-standard "NODE_ENV" value in your environment.
Error: <Html> should not be imported outside of pages/_document.
Error occurred prerendering page "/500".
Export encountered an error on /_error: /500, exiting the build.
```

**Causa raíz** (aislada por QA con un experimento controlado: mismo comando, mismo directorio, misma env
salvo **una** variable):

| Pieza | Qué hacía |
|---|---|
| `stack-native.sh` (antes, línea 105) | `export NODE_ENV="${NODE_ENV:-development}"` — **necesario**: `backend/src/config/env.validation.ts` solo exige DATABASE_URL/JWT/STRIPE/APP_BASE_URL/RESEND en entornos no-locales; sin `development` el backend **ni arranca** aquí. |
| `export` | Alcanza a **todo** proceso hijo, incluido `npx next build`. |
| `next build` con `NODE_ENV≠production` | Mete el runtime de desarrollo en el prerender estático de las páginas de error y **revienta**. |

La variable estaba puesta por una razón legítima **para el backend**, y se cobraba una víctima que no
tenía nada que ver. Reproducido **2 de 2** por QA; la segunda corrida falló **distinto**
(`TypeError: Cannot read properties of null (reading 'useContext')` en `/es/forgot-password`): mismo
modo de fallo, otra página. Con `NODE_ENV=production`: **exit 0**.

**CI nunca estuvo afectado** — `Dockerfile.frontend` no exporta `NODE_ENV` en su etapa de build, así que
allí resuelve a `production` (y el runtime fija `ENV NODE_ENV=production` explícito). El fallo era
**exclusivo de la ruta nativa local**, que es precisamente el único camino ejecutable en este entorno
(§29.10: aquí no hay demonio de Docker). Resultado práctico: **el modo gate documentado en §32.6 no
existía**, y QA tuvo que hornear el bundle a mano para poder verificar. Ningún gate debe depender de que
quien verifica parchee el arnés.

**Arreglo (`scripts/stack-native.sh`, `start_frontend()`).** El `NODE_ENV` del frontend lo fija **el
modo**, y no se hereda:

| Modo | `NODE_ENV` | Por qué |
|---|---|---|
| `build` (`up --gate`) | `production` | Es el artefacto que se despliega; **lo mismo que hace CI**. |
| `dev` | `development` | Es lo que `next dev` espera de todos modos. |

El backend conserva su `development`: se lanzó antes, en otro subshell, y son procesos distintos. La
línea 105 sigue donde estaba, ahora con el comentario que dice **por qué no se puede borrar y por qué no
basta con ella**.

**Detector de regresión, no sólo arreglo.** Tras el build, el script hace `grep` del aviso
`non-standard "NODE_ENV"` en `frontend-build.log` y **muere si aparece**. Motivo: el fallo del prerender
es *intermitente* (QA vio romperse dos páginas distintas en dos corridas), así que un futuro escape de
`NODE_ENV` podría dar un build **verde** horneado con el runtime de desarrollo — y eso es peor que un
rojo: el gate correría sobre un artefacto que no es el que se despliega. Next **siempre** avisa; el
script convierte ese aviso en un fallo duro.

**Segundo defecto, encontrado al verificar (y por eso se verifica corriendo, no leyendo).** `down` decía
«frontend detenido» y el puerto **seguía sirviendo 200**:

- `next start` se **renombra** a `next-server (vX.Y.Z)` en cuanto arranca ⇒ los `pkill -f "next start -p …"`
  no lo tocaban.
- El pidfile guarda el `npx` que lo lanzó, no al servidor ⇒ matar el pidfile dejaba al servidor **huérfano**.
- Y el siguiente `up --gate` moría con «Ya hay ALGO sirviendo en :3000» (esa guarda es correcta: un gate
  no reutiliza un servidor ajeno, §32.6).

⇒ **el arnés dejaba de ser repetible por culpa de su propio apagado.** Corregido: `stop_apps()` añade
`pkill -f "^next-server "` y **verifica que los puertos quedaron libres**, avisando si algo sigue vivo
(sin matarlo a ciegas: puede ser el stack de otro rol).

> El patrón va **anclado** (`^next-server `) a propósito. Sin el `^`, `pkill -f next-server` mata también
> a cualquier shell cuya *línea de comando* mencione la cadena — incluido el `bash -c` que esté
> ejecutando el propio `down`. Probado en vivo: se suicidó con exit 144.

**Verificación — corrido de verdad, dos veces, no por inspección:**

| Comprobación | Resultado |
|---|---|
| `./scripts/stack-native.sh up --seed --gate` | **exit 0**, dos corridas limpias consecutivas (`down` entre medias) |
| Aviso `non-standard "NODE_ENV"` en el build | **0 ocurrencias** |
| `<Html> should not be imported` / `Export encountered an error` | **0 ocurrencias** |
| Prerender | `✓ Generating static pages (62/62)` |
| `GET :3000/es` (modo `build`) | **200** |
| `GET :3099/api/v1/health` | `{"status":"ok","db":"up","redis":"up"}` |
| `down` → `GET :3000/es` | **000** (el puerto queda libre; ya no hay huérfano) |

**Lo que NO verifiqué corriendo, y lo digo en vez de dejarlo implícito.** La rama `dev`
(`next dev`) recibió la misma línea (`NODE_ENV=development`, que es lo que `next dev` usa de todos modos)
pero **no la ejecuté de punta a punta**: hacerlo habría pisado el `frontend.pid` del stack en modo gate
que queda levantado para QA (`RUN_DIR` es único). Está comprobada la sintaxis, no el arranque. Se
ejercita sola en el primer `up` sin `--gate` que alguien haga.

**Divergencia conocida que queda abierta (menor, anotada para que no sorprenda).** `next start` avisa
`"next start" does not work with "output: standalone" configuration`. Sirve igual (200 verificado) y el
**build** es el mismo, pero producción arranca por `node server.js` desde `.next/standalone`
(`Dockerfile.frontend:92`), no por `next start`. El arnés prueba **el mismo artefacto compilado servido
por otro entrypoint**. Para lo que el gate mide (¿concuerdan frontend y backend?) es suficiente; para
validar el *empaquetado* standalone el gate sigue siendo `e2e-real.yml` con la imagen, como ya decía
§29.10. No se cambia ahora: acercarlo exigiría copiar `static/` y `public/` dentro de `.next/standalone`
a mano, que es más máquina —y más formas de equivocarse— que fidelidad ganada.

---

### 32.11 El hueco que señaló el techlead: la verificación de diales tiene **enforcement de honor**

**El hueco, dicho sin adornos.** El DoD exige que los diales de §32.2 estén resueltos en el entorno. Hoy
lo único que hay en el pipeline es esto (`.github/workflows/deploy.yml:324-330`):

```yaml
- name: Recordatorio de secuencia POST-DEPLOY (no automatizada, a propósito)
  run: |
    echo "::notice::El deploy NO termina aquí: corre la secuencia post-deploy."
    echo "::notice::  railway run --service backend --environment production bash scripts/post-deploy.sh"
```

Un `::notice::` que le pide a un humano que corra `post-deploy.sh`, que a su vez corre el comparador
(PASO 8). Techlead lo llamó **«una regla normativa con enforcement de honor»**, y tiene razón: **un
detector que sólo funciona si te acuerdas es indistinguible de uno que no corrió.** Es el mismo criterio
con el que el arquitecto exigió que la línea de inventario se emita **siempre** — y que aquí no se
aplicó. Queda anotado como hueco, **no** como diseño.

**La contrapartida real de automatizarlo (por qué no es gratis).** El comparador
(`scripts/check-graded-estimate-dials.sh`) necesita `ADMIN_JWT` = **bearer de `super_admin`**. Ponerlo en
CI significa un secreto de GitHub que abre **el rol más privilegiado del sistema** contra producción,
disponible para cualquier job del workflow. El comparador es solo-lectura, pero **el token no**: con él se
puede `PUT /admin/settings` cualquier dial (tarifas, topes AML, markup) y disparar jobs de admin. Cambiar
«el operador debe acordarse» por «hay una llave maestra de prod guardada en CI» **no es obviamente mejor**,
y no es una decisión que devops tome solo. Por eso hoy sigue manual — pero ahora **por decisión escrita, no
por inercia**, que es exactamente la diferencia que pedía el techlead.

**Vía barata que SÍ existe y no expone credenciales nuevas (propuesta, no cableada).**
La línea de inventario de §32.5 se emite **siempre** en el arranque del backend y **ya contiene el
conjunto divergente completo**, con valor vigente y default. Leerla no necesita JWT de admin: necesita
acceso a los **logs**, y el workflow **ya tiene `RAILWAY_TOKEN`**:

```bash
railway logs --service backend --environment production | grep 'config inventory'
```

Un job post-deploy que haga ese `grep` y publique el conjunto divergente en el *summary* del run
convierte «si te acuerdas» en «sale siempre», **sin un solo secreto nuevo**. Semántica que propongo, en
espejo de los códigos del comparador:

| Hallazgo | Acción del job |
|---|---|
| Una de las 3 claves está en **el valor exacto del seed viejo** (`null`/`3`/`50`) | **Falla el job.** Es la firma inequívoca del seed rancio (rc=10 del comparador). |
| Una de las 3 diverge con **otro** valor | **Avisa, no bloquea.** Es una elección plausible del operador: se pregunta, no se pisa (§32.4, rc=20). |
| No se pudieron leer los logs | **Avisa y lo dice explícitamente: «no concluye».** No se finge verde ni se bloquea por retención de logs. |

**Por qué la dejo propuesta y no cableada, con dos razones y ninguna es pereza:**

1. **No puedo verificarla aquí.** No hay acceso a Railway en este entorno. Cablear en `deploy.yml` un
   paso que no he visto correr sería repetir el pecado que esta sección denuncia: un detector cuya
   ejecución se da por supuesta. Se cablea cuando haya una ventana con acceso real para probarlo.
2. **`deploy.yml` no es el camino de deploy que se usa.** El CD por Actions está **desactivado por
   defecto** (`workflow_dispatch` only): los deploys reales van por las integraciones nativas
   push-to-deploy de Vercel/Railway (cabecera de `deploy.yml`, líneas 34-48). Un gate ahí sería
   enforcement **sobre una vía que casi nadie recorre** — verde de otro color. El punto de enforcement
   honesto hoy es `post-deploy.sh` (que el operador **sí** corre, y donde el PASO 8 ya está cableado y ya
   **bloquea el anuncio del release** si `DIALS_RC != 0`).

**La sugerencia del techlead que NO es mía y aquí queda enrutada.** Propuso exponer el conjunto divergente
**en la UI de M2**, donde el operador ya está, en vez de sólo en logs. Estoy de acuerdo y es la mejor de
las tres opciones —el operador no tiene que acordarse de nada porque *lo ve*—, pero **es trabajo de
frontend** (y del backend si hace falta endpoint), no de devops. Queda como hallazgo enrutado a esos
roles; el dato ya existe y ya es de solo-lectura.

**Estado, para que nadie lo lea como cerrado:**

| | |
|---|---|
| **Hueco** | La verificación de diales del DoD no tiene enforcement automático en el camino de deploy. |
| **Mitigación vigente** | `post-deploy.sh` PASO 8 (cableado, bloquea el anuncio) + línea de inventario del arranque (se emite siempre) + checklist §32.9. |
| **Contrapartida de cerrarlo del todo** | Un `super_admin` JWT de producción guardado en CI. **Decisión del humano, no de devops.** |
| **Vía barata propuesta** | Job post-deploy con `railway logs` \| `grep 'config inventory'` — cero secretos nuevos. **Sin cablear** hasta poder probarla contra Railway. |
| **Mejor solución** | Exponerlo en la UI de M2 (techlead). **Enrutado a frontend/backend.** |

---

### 32.12 M-48 — **un solo dial**, y encenderlo es un acto de DINERO (v1.51, §4.38r) — 2026-08-31

> **⚠️ RENUMERADA (v1.53(1), fusión 2026-09-05): esta sección era «M-46» y ahora es `M-48`.**
> `M-46` nombraba **dos** migraciones distintas: la de esta sección (el dial del gancho de grading,
> **DATA/seed, sin DDL**) y la del **ciclo de adquisición del buylist** (**DDL real**: 40 columnas +
> enums + backfill, en disco como `20260901120000_m46_buylist_acquisition_cycle`). El arquitecto
> resolvió la colisión por el artefacto —la del ciclo existe, está aplicada y registrada, y
> renombrarla rompería `migrate deploy`— así que **el ciclo se queda con `M-46` y el gancho pasa a
> `M-48`** (ARCHITECTURE §11, tabla de desambiguación).
>
> **Por qué esto no era cosmético, y léelo antes de correr el pase:** todo lo que sigue dice
> *«nada que migrar»*. Eso es cierto **de `M-48` y solo de `M-48`**. Mientras la sección decía
> «M-46», el mismo runbook parecía autorizar a saltarse `M-46` — que es **DDL de dinero y estaba
> pendiente**. Si el release que preparas incluye el ciclo de adquisición, **`migrate deploy` SÍ
> trae DDL**: no es este runbook el que te lo dice, es §37.
>
> Otras menciones de `M-46` en este documento (§37) hablan de la **migración DDL** y conservan su
> número a propósito.

> **Lo que cambia para operación, en una frase:** hasta ayer había un dial de **exhibición** que no
> costaba dinero y un segundo dial de **obtención** que sí, y que nunca se dibujó en ninguna pantalla.
> Desde hoy hay **uno solo** (`grading_hook_enabled`, seed `off`, DTO `gradingHookEnabled`), y ese
> mismo `PUT` **publica una afirmación comercial Y autoriza al barrido diario a pedir datos a un
> proveedor de paga y a escribir precios estimados**. No es un ajuste de vitrina: es una **firma de
> gasto**. Norma: `ARCHITECTURE.md` §4.38(r); contrato v1.51-one-dial.

**Las dos claves viejas —`graded_estimates_enabled` y `graded_estimate_ingest_enabled`— quedan
RETIRADAS del código y VIVAS en la tabla**, huérfanas e inertes. No se borran (§4.38r.1: borrar
config en producción para conseguir cero efecto es escribir en producción sin motivo, §11.0-4; y son
lo que mantiene fail-closed al código viejo si hay rollback). El precio de dejarlas es que **mienten
a quien lea la tabla a pelo**, y todo lo que sigue está construido alrededor de ese precio.

---

#### 32.12.1 EL PRESUPUESTO EN CRÉDITOS — publicado ANTES del primer encendido (§4.38r.3.1 punto 1)

**Esto es lo primero de la sección a propósito.** §4.38(r.3.1) exige que devops publique el número
**antes** de que el dueño toque el dial: *un tope que nadie tradujo a créditos no es un presupuesto,
es un número*. Aquí está, con los tres factores a la vista y su procedencia:

| Factor | Valor | De dónde sale (verificado, no supuesto) |
|---|---|---|
| Cartas por corrida | **250** | `graded_estimate_ingest_max_cards_per_run`, seed 250. Leído en vivo de la base local: `ingestMaxCardsPerRun: 250`. |
| Créditos por carta | **2** | `includeEbay=true` cuesta 2 créditos/carta — `price-ingest.service.ts:919`, `ARCHITECTURE.md:7947` (§4.38h.3). |
| Corridas por día | **2** | El cron `price-ingest` corre **2×/día** (§19.3). El ingest de graded cuelga de ese mismo tick. |

> ## **250 × 2 × 2 = 1 000 créditos/día** (techo)
> **500 créditos por corrida · ~30 000 créditos/mes de 30 días.**

**Contra la cuota del dueño (20 000 créditos/día): el techo es el 5 %.** El otro 95 % queda sin usar,
y **eso es correcto para el primer encendido**: el número que debe dimensionar el tope es el
**MEDIDO** en la primera corrida real (cartas RAW publicadas y en alcance, cuántas traen bloque PSA,
cuántas se descartan), **no una estimación hecha desde una hoja de cálculo**. Decisión del dueño,
registrada: **no se sube el tope en este pase.** Cuando se suba, se sube contra la medición.

**Por qué el techo NO es la previsión.** Solo se pide por cartas RAW **publicadas y en alcance**. En
el stack local con el fixture sintético, la corrida real reportó **7 cartas en alcance** —o sea, un
gasto real de `7 × 2 × 2 = 28` créditos/día, no 1 000—. El tope es una **cota superior**, y su
utilidad es exactamente esa: acotar lo que no se puede prever.

⚠️ **`ingestMaxCardsPerRun` es LO ÚNICO que hay entre un `PUT` y la factura del proveedor.** Dejó de
ser un tope de comodidad. Consecuencias operativas que hay que tener escritas:

- Se cambia **sin redeploy**, con `PUT /admin/pricing/graded-estimates {"ingestMaxCardsPerRun": N}`
  (super_admin, auditado). Subirlo multiplica la factura por `N/250` **en la corrida siguiente**, sin
  que nada más cambie y sin que nadie tenga que aprobar nada más.
- **El tope máximo que el validador I8 admite es 5 000**, y `5 000 × 2 × 2 = **20 000 créditos/día**`:
  exactamente **la cuota diaria completa del dueño**. Es decir: **un solo `PUT` de un número, dentro
  del rango válido, puede consumir el 100 % de la cuota diaria.** No hay guarda por encima de esa.
- Por eso el comparador imprime el presupuesto en cada corrida (§32.12.4) y por eso este número está
  publicado aquí y no en la cabeza de nadie.
- Los créditos gastados **no se recuperan apagando el dial**. Apagar detiene el siguiente gasto; no
  devuelve el anterior.

---

#### 32.12.2 EL PASE — los 7 pasos de §4.38(r.4), con lo que cada uno verifica

**El riesgo que este procedimiento existe para cerrar:** producción tiene hoy
`graded_estimates_enabled = "on"`. Un colapso hecho *sobre la clave que ya está encendida* habría
convertido el **siguiente tick del cron** —dentro de ≤12 h del deploy, sin intervención humana— en la
primera factura del proveedor. Con la clave NUEVA eso **no puede pasar**: ninguna base la tiene,
todas aterrizan en el default `off`.

| # | Paso | Quién | Verificación (comando exacto) |
|---|---|---|---|
| **0** | **Anotar el estado previo** de las dos claves retiradas en **cada** entorno. No para restaurarlo: para poder responder «¿qué había?» después. | devops | Línea de inventario del arranque (§32.12.3-B). Los dos valores al ticket del release. |
| **1** | **Deploy del código.** **Nada que migrar *por M-48*** (M-48 es DATA/seed, sin DDL). ⚠️ **Esto NO dice que el release no tenga migraciones:** si arrastra `M-46` (ciclo de adquisición) o `M-47` (imágenes de set), `migrate deploy` **sí** aplica DDL. Lee lo que devuelve el comando; no des por hecho el *«no pending»*. | devops | `npx prisma migrate deploy` → para un pase de **solo M-48**: *No pending migrations to apply.* (verificado en local: 34 migraciones, ninguna nueva). Si lista migraciones, es correcto: son las de otros pases. |
| **2** | **El gancho queda OSCURO por construcción**, no por un paso que alguien pueda olvidar. | *(automático)* | `bash scripts/check-graded-estimate-dials.sh` → `gradingHookEnabled: off` + rótulo de retiradas. |
| **3** | **VERIFICACIÓN POSITIVA Nº1 — no se PIDE nada.** Dejar pasar un tick del cron o dispararlo a mano y comprobar en el log: dial `off`, **cero peticiones al proveedor**, `written=0`. | devops | §32.12.3-A. |
| **4** | **VERIFICACIÓN POSITIVA Nº2 — no se ESCRIBE nada.** Los 10 diales de M2 idénticos a antes del deploy y **ninguna `PriceReference` nueva** con `source='pokemonpricetracker'` y `gradeKey='graded:PSA:*'`. | devops + QA | §32.12.3-C. |
| **5** | **EL DUEÑO enciende** `gradingHookEnabled: "on"` desde M10, con las precondiciones de §4.38(r.3.1) cumplidas y el aviso delante. **No es paso de devops y no se hace por SQL.** | **el dueño** | `AuditLog` `settings.update` con `before`/`after`. Verificado que existe: §32.12.3-D. |
| **6** | **Medir la primera corrida**: créditos antes/después, `written`, motivos de salto, y **revisar la lista de revisión** (`GET /admin/pricing/graded-estimates/review`) antes de cerrar el release. | devops + QA | La factura de la primera corrida **cabe** en el presupuesto de §32.12.1. |

> ⚠️ **El hueco oscuro entre el paso 1 y el paso 5 es el precio, y es deliberado.** Producción deja de
> mostrar las cifras del gancho hasta que el dueño decida. **No hay tercera opción:** o el colapso deja
> un momento apagado, o el deploy arranca gastando solo. Se elige lo primero y se **acorta** poniendo
> el paso 5 en el mismo ticket, inmediatamente detrás del 4. Lo que **no** se hace: que el deploy
> escriba el dial «para que no se note».

**Precondiciones del paso 5 que NO son de devops y que hoy siguen abiertas** (§4.38r.3.1): el
**presupuesto** (§32.12.1, ya publicado ✅), el **veredicto de la sonda en staging** (§32.12.6, ⛔
pendiente), **GU-9** (la cota de frescura del dato automático, ⛔ decisión del humano) y el **aviso
en pantalla** (ux-ui, `DESIGN_SYSTEM.md` §22, entregado ✅). **Tres de cuatro no bastan.**

---

#### 32.12.3 Las verificaciones, EJECUTADAS — no «debería funcionar»

Todo lo de abajo se corrió el 2026-08-31 contra el **stack nativo** (`scripts/stack-native.sh`,
Postgres 16 + Redis + backend Nest completo en `:3099`), sobre una base que reproduce **exactamente**
el estado de producción tras el pase: las dos filas retiradas presentes con valor `"off"`, y el dial
nuevo resolviendo a `off`.

**A) Verificación positiva Nº1 — CERO PETICIONES AL PROVEEDOR (paso 3).**

```bash
curl -X POST "$ADMIN_BASE_URL/admin/jobs/price-ingest" \
     -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' -d '{}'
# → 202 {"job":"price-ingest","enqueued":true,"background":true,"alreadyRunning":false}
grep -E 'graded-estimate-ingest|VEREDICTO-PSA' .native-stack/backend.log   # o `railway logs`
```

Salida **real** de esa corrida:

```
[PriceIngestService] graded-estimate-ingest: dial `grading_hook_enabled` = off → no se pide NADA al
  proveedor (cero créditos) y no se escribe NINGUNA fila. Es el dial ÚNICO del gancho (v1.51, §4.38r)…
[PriceIngestService] [VEREDICTO-PSA] VEREDICTO: INDETERMINADO — No se preguntó nada: el dial
  `grading_hook_enabled` está en `off` (o la config del ingest es inválida).
[PriceIngestService] [VEREDICTO-PSA] MODO: INGEST — 0 referencia(s) escritas. GRADED_FORMAT=auto
```

Y el contraste que la hace una verificación y no una lectura de config:
`grep -c "PPT graded:" .native-stack/backend.log` → **0**. **Ni una línea del proveedor de paga en
toda la corrida.**

**A-bis) LA ROTURA DELIBERADA — para demostrar que esa línea MIDE el dial y no es un cartel fijo.**
Con el mismo binario y el mismo entorno (**sin llave**, o sea incapacitado), se encendió el dial a
propósito y se repitió la corrida:

```bash
curl -X PUT "$ADMIN_BASE_URL/admin/settings" … -d '{"gradingHookEnabled":"on"}'   # → 200
curl -X POST "$ADMIN_BASE_URL/admin/jobs/price-ingest" … -d '{}'                  # → 202
```

La línea **cambió**, que es exactamente lo que tenía que pasar:

```
[PokemonPriceTrackerBulkProvider] PPT graded: falta POKEMONPRICETRACKER_API_KEY → no se ingesta (nada se escribe).
[PriceIngestService] graded-estimate-ingest: 1 set(s), 7 carta(s) en alcance, 0 referencia(s) escritas, …
[VEREDICTO-PSA] VEREDICTO: INDETERMINADO — Ninguna petición al proveedor llegó a responder OK…
```

**Qué demuestra, punto por punto:** (1) con el dial `off` el ingest **ni siquiera entra** al camino
del proveedor —no hay set en alcance, no hay línea de PPT—; con el dial `on` **sí entra** (1 set, 7
cartas) y lo único que lo detiene es la ausencia de credencial. La frase «no se pide NADA» del paso 3
**mide el dial**. (2) Se ven **las dos capas** de defensa por separado: el **dial** (producto) y la
**credencial** (despliegue). Con las dos puestas se gasta; con cualquiera de las dos quitada, no.
El dial se devolvió a `off` inmediatamente después y se verificó (`comparador rc=0`,
`GET /admin/settings → {"gradingHookEnabled":"off"}`).

**B) La línea de inventario del arranque — donde SÍ se ven las claves retiradas (pasos 0 y 2).**

```bash
railway logs --service backend | grep 'config inventory'     # prod/staging
grep 'config inventory' .native-stack/backend.log            # stack nativo
```

Salida **real** del arranque, con el rótulo que exige §4.38(r.1):

```
[SettingsService] config inventory: 2 clave(s) RETIRADAS presentes en la base (INERTES, NO SE LEEN)
  → graded_estimate_ingest_enabled="off"; graded_estimates_enabled="off". (§4.38r.1: … su valor NO
  gobierna nada … NO concluyas de estas filas que el ingest está apagado.)
[SettingsService] config inventory: 1 de 35 clave(s) comparables DIFIEREN de su default de código → …
```

**Ésta es la única superficie donde se leen los valores de las claves retiradas**, y viene rotulada.
El paso 0 del pase se resuelve con este `grep`, no con una consulta a la base de producción.

**C) Verificación positiva Nº2 — CERO ESCRITURAS (paso 4).**

```sql
SELECT count(*) FROM "PriceReference"
 WHERE source = 'pokemonpricetracker' AND "gradeKey" LIKE 'graded:PSA:%';
```

Medido **antes y después de CADA UNA de las cuatro corridas** de esta sesión (dial `off`, dial `on`
sin llave, sonda sin `pptSetId`, sonda con `pptSetId`): **1 → 1 → 1 → 1 → 1**. La única fila
preexistente es de `2026-08-31 03:47`, **anterior** a todas ellas. Ninguna corrida escribió.
*(En prod, el `count(*)` de antes y el de después van al ticket del release: es la mitad del paso 4.
La otra mitad es re-`GET` de los 10 diales de M2 y compararlos con los de antes del deploy —el
comparador imprime los tres que importan.)*

**D) El rastro del paso 5 existe.** Los dos flips de esta sesión quedaron en `AuditLog` con
`action='settings.update'` y el snapshot completo en `before`, incluido `"gradingHookEnabled"`. O sea:
cuando el dueño encienda, **queda escrito quién y cuándo**, y el paso 5 es verificable a posteriori.

> **Por qué son DOS verificaciones y no una.** «No pidió» y «no escribió» son afirmaciones distintas
> y fallan por motivos distintos: se puede pedir y no escribir (la sonda), y —en un binario
> equivocado— se podría escribir desde otra fuente sin haber pedido nada aquí. Y **ninguna de las dos
> es «no vimos cargos»**: la ausencia de una factura no observada no prueba nada, porque nadie estaba
> mirando el panel del proveedor en el minuto exacto de la corrida.

---

#### 32.12.4 El comparador rotula lo retirado y **se niega a deducir del cadáver**

`scripts/check-graded-estimate-dials.sh` (solo-lectura, sin una sola escritura) se actualizó a v1.51.
**El hallazgo que se estaba buscando —«¿sigue consultando claves muertas?»— resultó NO estar ahí:** el
script nunca leyó `graded_estimates_enabled` ni `graded_estimate_ingest_enabled` (solo miraba los tres
diales de M2). Lo que **sí** faltaba es todo lo demás:

| Añadido | Por qué |
|---|---|
| **PASO 0 — lee el DIAL ÚNICO** (`GET /admin/settings` → `gradingHookEnabled`) y lo reporta con su consecuencia de dinero. | El comparador hablaba de la config del gancho **sin mirar el interruptor que la gobierna**. |
| **Detección de binario PRE-M-48**: si el DTO de M10 proyecta `gradedEstimatesEnabled`/`gradedEstimateIngestEnabled`, o el de M2 trae `ingestEnabled` ⇒ **rc=2, parada en seco**. | En ese código **hay dos diales** y el que gobierna el gasto no es el que el script lee. Cualquier conclusión sería sobre el dial equivocado. |
| **Bloque explícito sobre las claves retiradas**: no se consultan, no se pueden consultar por API, y **«`graded_estimate_ingest_enabled = off`» NO significa que el ingest esté apagado**. Remite a la línea de inventario. | Es LA trampa de diagnóstico de §4.38(r.1), y el sitio donde se comete es exactamente éste. |
| **Coherencia del espejo**: `enabled` del DTO de M2 debe reflejar el dial. Si discrepan ⇒ rc=2. | Dos superficies del mismo dial que no concuerdan no es un ajuste del operador: es incoherencia del binario. |
| **PASO 3 — presupuesto en créditos** calculado desde el `ingestMaxCardsPerRun` **vigente en ese entorno**. | El presupuesto tiene que salir del entorno que se está mirando, no de un documento que puede estar rancio. |
| Ausencia (`__ABSENT__`) distinguida de `null`. | `manualFreshnessDays: null` es un valor legítimo; una clave ausente es un binario distinto. Confundirlos era posible con el parseo anterior. |

**Códigos de salida — sin cambios para `post-deploy.sh`** (`0` al día · `10` seed viejo · `20`
diverge · `2` no sabemos qué corre). **El dial `on` NO cambia el código de salida**: encenderlo es una
decisión legítima del dueño, y convertirla en rojo de CI habría sido devops vetando una decisión que
no le toca. Se reporta a gritos, no se bloquea.

**LAS ROTURAS, con su salida real.** Se levantó un servidor HTTP falso sirviendo DTOs fabricados y se
corrió el comparador contra él:

| Rotura | Resultado | Mensaje (recortado) |
|---|---|---|
| DTO **PRE-M-48**: `gradedEstimatesEnabled:"on"`, `gradedEstimateIngestEnabled:"off"`, `ingestEnabled:false` — **la trampa exacta**: la fila muerta dice `off` mientras la viva dice `on` | 🔴 **rc=2** | «El DTO de M10 todavía proyecta clave(s) que M-48 RETIRÓ… en ese código HAY DOS DIALES, y el que gobierna el gasto NO es el que este script lee» |
| `gradingHookEnabled` **ausente** del DTO | 🔴 **rc=2** | «AUSENTE NO significa "apagado": significa que NO SABES en qué estado está el gancho» |
| dial `on` pero espejo `enabled:false` | 🔴 **rc=2** | «INCOHERENCIA: dial `on` pero espejo `enabled`=false… hallazgo para BACKEND/arquitecto» |
| dial con valor `"ON"` (mayúsculas, presente-e-inválido) | 🔴 **rc=20** | «Dial con valor INESPERADO… el código es fail-closed y ESTRICTO (`v === 'on'`)» |
| DTO sin `ingestMaxCardsPerRun` | 🔴 **rc=2** | «no se puede calcular el presupuesto… encender el dial es autorizar un gasto de tope DESCONOCIDO» |
| `ingestMaxCardsPerRun: 5000` (**era** el tope máximo válido — ver nota) | 🟢 rc=0 | «5000 × 2 × 2 = **20000 créditos/día**» — el aviso que hace visible que un número dentro del rango se come la cuota entera |

> ⚠️ **Nota de 2026-08-31 (posterior a esta corrida):** el arquitecto cambió **I8** y `ingestMaxCardsPerRun`
> pasó de `[1, 5000]` a **`[1, 1000]`** (`ARCHITECTURE.md` rev v1.51-a), justamente porque 20 000
> créditos/día es la cuota diaria entera. **La corrida de arriba se conserva tal cual: es evidencia
> fechada, no una instrucción.** El comparador **no hay que tocarlo**: no lleva el tope cableado, calcula
> el presupuesto desde el `ingestMaxCardsPerRun` **vigente en el entorno** (`check-graded-estimate-dials.sh:306`),
> así que sigue siendo correcto con el rango nuevo. **Quien valide el rango es backend** (validador de M2):
> si `[1,1000]` no está aplicado en el DTO, el hallazgo es suyo, no de este script.
| **Regresión** (que lo viejo siga funcionando): seed viejo `null`/`3`/`50` | 🟢 **rc=10** | imprime el `PUT` parcial exacto, igual que antes |
| Contra el backend **real** en `:3099` | 🟢 **rc=0** | dial `off`, tres diales al día, presupuesto 1 000 créditos/día |

---

#### 32.12.5 El entorno de CI **no puede** escribir automático — y el agujero era real

**El hallazgo, medido y no supuesto.** `docker-compose.yml:187` pasaba
`POKEMONPRICETRACKER_API_KEY: ${POKEMONPRICETRACKER_API_KEY}` **sin default**. Eso significa: *toma la
del `.env` o del entorno de quien levante el stack*. En CI quedaba vacía **por accidente, no por
diseño**; en la máquina del dueño, donde la llave es real, una corrida de E2E —que enciende el dial
**en cada arranque**— habría empezado a pedir y a escribir. La única protección viva era que el
proveedor sale con `warn` sin llave: es decir, **dependíamos de que alguien se olvidara de exportar
una variable**.

**Lo arreglado (rutas devops, todo verificado corriéndolo):**

| Archivo | Cambio | Verificación |
|---|---|---|
| `docker-compose.yml` | `${POKEMONPRICETRACKER_API_KEY:-}` + `POKEMONPRICETRACKER_GRADED_PROBE` explícita | `docker compose --profile apps config` → `POKEMONPRICETRACKER_API_KEY: ""` **y sin el warning de «variable is not set»** (que sí siguen emitiendo `POKETRACE_API_KEY` y `POKEMONTCG_IO_API_KEY`, sin tocar). Con `POKEMONPRICETRACKER_API_KEY=ppt_live_ABC123` exportada, el `config` la muestra: la llave **sigue llegando** cuando alguien la pone a propósito. |
| `docker-compose.staging.yml` | comentario normativo + la sonda explícita (ya tenía `:-`) | ídem |
| `.github/workflows/e2e-real.yml` | `POKEMONPRICETRACKER_API_KEY: ''` **declarada vacía** + `E2E_GRADING_PROVIDER_INCAPACITATED: '1'` en el `env:` del job + paso de guarda **antes** del preflight de Stripe | guarda en verde |
| `.github/workflows/e2e.yml` | `POKEMONPRICETRACKER_API_KEY: ''` en `frontend-e2e` **y** en `backend-e2e` (este último levanta Nest en proceso y sus specs **encienden el dial** — `backend/test/graded-estimate.one-dial.spec.ts:117,210`); la **constancia** solo en `frontend-e2e` ⚠ *(corregido 2026-08-31: la redacción anterior decía «ídem» para los dos, y no era exacto — ver §32.12.5-bis, donde se explica por qué esa asimetría es CORRECTA y no un olvido)* | guarda en verde |
| `.github/workflows/ci.yml` | job **`e2e-provider-guard`** + `ci-ok` lo exige y **falla si queda `skipped`** | ver abajo |
| `.env.example` | `POKEMONPRICETRACKER_GRADED_PROBE` y `E2E_GRADING_PROVIDER_INCAPACITATED` documentadas | — |

**Declarada vacía, no omitida — y la diferencia no es estética.** Que hoy no esté es una *casualidad*
que se rompe sola. Declararla `''` convierte el día que alguien quiera conectar el secret en un
**cambio visible en el diff** de un archivo que alguien revisa.

**La constancia `E2E_GRADING_PROVIDER_INCAPACITATED=1` es MÍA (devops) y tiene un límite que conviene
saber.** El guardarraíl de frontend (`frontend/e2e/utils/paid-provider-guard.ts`) **observa** el
entorno cuando la API bajo prueba es local, y **solo** acepta la constancia cuando es remota (staging),
porque entonces el entorno del backend no es observable desde el runner. **La constancia no gana sobre
la observación**: contra un backend local con llave viva, declararla no desbloquea nada. Por eso en
`.env.example` la variable se deja **vacía** — una constancia heredada por copiar-pegar no es una
constancia.

**La guarda nueva: `scripts/check-e2e-provider-incapacitation.sh`.** Estática (parsea YAML, sin red).
Exige, en **cada JOB que corre E2E** —descubiertos, no listados a mano—: (1) que
`POKEMONPRICETRACKER_API_KEY` **no** venga de `secrets.*` ni de un literal no vacío; (2) que esté
**declarada vacía** en el env efectivo del job; (3) que la constancia esté puesta **en los jobs de
arnés Playwright**; (4) que se haya descubierto **al menos un** job E2E.

> ⚠️ **Este párrafo describe la v2.** La v1 miraba **dos archivos fijos** con `grep`, y por eso daba
> verde en dos escenarios en los que no había verificado nada. Qué fallaba exactamente, y las roturas
> que lo demuestran: **§32.12.5-bis**.

**Dónde vive el enforcement, dicho explícitamente porque es fácil equivocarse aquí:**

> ⚠️ **NO cuelga de `deploy.yml`, y es a propósito.** Ese workflow tiene su disparador `workflow_run`
> **comentado** (solo queda `workflow_dispatch`) y un `secrets-gate` que **salta todos los jobs** —
> incluidos los dos de promoción a producción— cuando no hay secrets: por eso su última corrida
> terminó **verde con los 8 jobs saltados**. Un pipeline que sale verde sin hacer nada es peor que
> uno rojo. Colgar esta guarda de ahí habría sido cablear un gate a algo que casi nunca corre (ya
> documentado en §32.11 y §33.4). **Se cuelga de `ci.yml`, que corre en cada push y cada PR**, y
> `ci-ok` la exige con `!= success` (no solo `== failure`): un `skipped` también es rojo, porque
> «saltado» es justo la forma en que un gate deja de gatear sin avisar. `e2e-real.yml` y `e2e.yml`
> la corren además como primer paso, donde ataja antes de construir nada.

**LAS ROTURAS, con su salida real:**

| Rotura | Resultado | Mensaje |
|---|---|---|
| **Estado del repo ANTES de tocar nada** (así se descubrió que hacía falta) | 🔴 **rc=1**, los dos workflows | «`POKEMONPRICETRACKER_API_KEY` NO está declarada… Que hoy no esté es una CASUALIDAD, no un diseño» + «Falta `E2E_GRADING_PROVIDER_INCAPACITATED`» |
| Alguien «conecta» el secret: `POKEMONPRICETRACKER_API_KEY: ${{ secrets.POKEMONPRICETRACKER_API_KEY }}` en `e2e-real.yml` | 🔴 **rc=1** | «con valor NO vacío en la línea 177… Un entorno E2E con credencial viva PAGA CRÉDITOS en cada corrida del gate» |
| Alguien borra la constancia de `e2e.yml` | 🔴 **rc=1** | «Falta `E2E_GRADING_PROVIDER_INCAPACITATED: '1'`… el guardarraíl del arnés SE NIEGA a encender el dial y el job muere a mitad» |
| Se renombra un workflow (`WORKFLOWS=…/no-existe.yml`) | 🔴 **rc=1** | «No existe…» — *en la v2 ya no hay `DEFAULT_WORKFLOWS` que actualizar: un renombrado lo encuentra el descubrimiento solo. Ver §32.12.5-bis.* |
| Repo ya arreglado | 🟢 **rc=0** | las tres declaraciones presentes en los dos workflows |

> ⚠️ **Esta tabla es la de la v1 (2026-08-31, primera versión) y se conserva como registro.** Las
> roturas de la **v2** —incluidas las dos que la v1 no detectaba— están en **§32.12.5-bis**.

**Lo que esta guarda NO hace, para no venderla de más:** no mira el `.env` de nadie ni el entorno real
de staging —eso **no es observable** desde CI, y fingir que sí lo es sería el falso verde que este
pase viene a quitar—. Verifica **lo que está escrito en el repo**. La mitad viva la pone el arnés de
frontend en tiempo de ejecución; la mitad de staging la pone quien configure staging.

---

#### 32.12.5-bis La guarda era **MÁS GRUESA QUE SU ENUNCIADO** — reescrita a v2 (2026-08-31)

El techlead señaló dos defectos de la v1 del script. Los dos son de la **misma clase que el bloqueante
de §32.8-bis**: algo que *decía* verificar y no verificaba. Los dos confirmados a mano antes de tocar
nada; los dos **arreglados**, no anotados como deuda — son un script de shell en mi ruta, y aceptar
deuda aquí habría sido aceptar exactamente el defecto del que va este pase.

| # | Defecto de la v1 | Cómo producía VERDE sin verificar |
|---|---|---|
| **(a)** | `DEFAULT_WORKFLOWS` era un **literal de dos archivos** (`e2e-real.yml`, `e2e.yml`). | Un **tercer** workflow que corriera E2E no lo abría nadie, y nada avisaba de su existencia. |
| **(b)** | El `grep` era **por ARCHIVO, no por JOB**. | En `e2e.yml`, `backend-e2e` declara la llave vacía pero **no** la constancia, y `frontend-e2e` declara las dos. El `grep` encontraba la constancia del **segundo** job y daba verde por el **primero**. |

**(a) no era hipotético: el descubrimiento encontró un tercer workflow en la primera corrida.**
`deploy.yml` tiene un job `e2e-real` que llama a la suite con `uses: ./.github/workflows/e2e-real.yml`
(+ `secrets: inherit`). La v1 **no abría `deploy.yml` en ningún caso**. La v2 lo abre, resuelve el
`uses:` local contra el conjunto ya verificado y lo aprueba **explicando por qué** `secrets: inherit`
es inocuo aquí (heredar secretos no inyecta `env`; el riesgo sería que el llamado usara `secrets.*`, y
no lo hace). Un `uses:` **remoto** que parezca E2E se reporta **NO VERIFICABLE y falla**, en vez de
callar.

**Qué hace la v2, y la precisión que la v1 no hacía.** Se parsea el YAML con un parser de verdad
(PyYAML) y se evalúa el **env efectivo de cada job** (`env` del workflow < `env` del job < `env` del
step). Y las dos exigencias **dejan de aplicarse en bloque**, porque no aplican a los mismos jobs:

- La **llave vacía** se exige a **todo** job que corra E2E o integración: cualquiera levanta el backend
  y un backend con credencial viva puede gastar. `backend-e2e` la tiene, y **hace falta** — sus specs
  encienden el dial.
- La **constancia** se exige **solo** a los jobs que corren el **arnés Playwright**, que es el único
  código que la lee (`frontend/e2e/utils/paid-provider-guard.ts:63`) y el único que enciende el dial
  desde el arnés. Exigírsela a `backend-e2e` sería pedir una firma que **nadie consume**: un rojo
  falso, que es el otro modo de que un check deje de servir.

Y un cuarto requisito nuevo, que es el que impide que el propio arreglo se degrade en silencio:
**si el descubrimiento no encuentra NINGÚN job E2E, el resultado es rc=1, no rc=0.** Cero jobs no es
«todo en orden»: es un check que no verificó nada. Por el mismo motivo, **si falta PyYAML el script
sale rc=2 y lo dice, en vez de degradarse a `grep`** — que es de donde venía el defecto (b).

**LAS ROTURAS DE LA v2, con su salida real.** Se copió el repo a un árbol de pruebas y se rompió a
mano; ninguna de estas corridas tocó `.github/` del repo:

| Rotura | v1 | v2 | Mensaje (recortado) |
|---|---|---|---|
| **El defecto (b) exacto**: se quita la constancia del job de **arnés** y se deja una en **otro** job del mismo archivo | 🟢 **VERDE (falso)** — `grep` la encuentra 1 vez en el archivo | 🔴 **rc=1** | «job «frontend-e2e» (ARNÉS Playwright) … ✖ Falta `E2E_GRADING_PROVIDER_INCAPACITATED: '1'` en el `env:` de **este job**» |
| **El defecto (a) exacto**: aparece un `e2e-nightly-nuevo.yml` con `npm run test:e2e` y sin declarar nada | ⚫ **NI LO ABRE** | 🔴 **rc=1** | «job «nightly-e2e» (ARNÉS Playwright) … ✖ `POKEMONPRICETRACKER_API_KEY` NO está declarada en el env efectivo de este job» |
| Alguien «conecta» el secret: `POKEMONPRICETRACKER_API_KEY: ${{ secrets.PPT_API_KEY }}` | 🔴 rc=1 | 🔴 **rc=1** (dos veces: por job y por la red de seguridad de archivo) | «con valor NO vacío en env del job «e2e-real»… PAGA CRÉDITOS en cada corrida» + «se alimenta de `secrets.*` (línea 177)» |
| **Cero jobs E2E** en todo el repo (solo `ci.yml`) | 🟢 **VERDE** (no existía el caso) | 🔴 **rc=1** | «NO se descubrió NINGÚN job que corra E2E. Esto NO es un verde: es un check que no verificó nada» |
| **Regresión** — repo real, intacto | 🟢 rc=0 (mirando 2 archivos) | 🟢 **rc=0** | «Los **3** job(s) E2E descubiertos declaran su incapacitación» — 3 jobs en **3** archivos, uno de ellos (`deploy.yml`) invisible para la v1 |

> **Por qué esto se arregla y no se anota.** El techlead lo emparejó con la deuda ya registrada del
> **modo `--gate` de `stack-native.sh`, que sirve el build con `next start` cuando producción arranca
> por `node server.js` desde `.next/standalone`** (§32.10, «Divergencia conocida»). Tiene razón en que
> son **la misma clase**: un check cuyo alcance real es menor que su enunciado. Pero la **respuesta
> correcta no es la misma para los dos**, y conviene decir por qué:
>
> - La divergencia del `--gate` **está escrita, acotada y tiene un gate que sí cubre lo que falta**
>   (`e2e-real.yml` corre contra la **imagen**). Cerrarla exigiría copiar `static/`+`public/` dentro de
>   `.next/standalone` a mano: **más máquina y más formas de equivocarse que fidelidad ganada**. Sigue
>   siendo deuda aceptada, y su enunciado ya dice lo que no cubre.
> - El agujero de esta guarda **no tenía a nadie detrás**: era el único artefacto que miraba esos
>   workflows, y su enunciado prometía «cada workflow que corre E2E» mientras leía dos archivos con
>   `grep`. Cuando el enunciado promete cobertura que nadie más da, **la deuda no se acepta: se paga**.
>
> Leídos juntos, la regla que dejo escrita: **una deuda de alcance es aceptable cuando el enunciado
> dice la verdad sobre su límite Y otro gate cubre el resto. Si falta cualquiera de las dos cosas, es
> un falso verde con otro nombre.**

---

#### 32.12.6 La sonda: qué es, cómo se corre, y el VEREDICTO registrado

**`POKEMONPRICETRACKER_GRADED_PROBE`** (`on|true|1|yes`) pone el ingest de graded en **modo sonda**:
pregunta al proveedor, loguea la muestra cruda y **no escribe ni una fila**. Es de solo-lectura **por
construcción** (en modo sonda el bucle ni siquiera llama al código capaz de fabricar una fila), no por
disciplina. **Invariante (§4.38r.3.3): solo QUITA capacidad de escribir, nunca la da**, y **no puede
volverse prerrequisito para que el dial funcione** — no es un segundo interruptor escondido.

```bash
# 1) el entorno debe tener llave del proveedor y sets con `pptSetId` mapeado
# 2) arrancar el backend con la sonda puesta (el backend lee su entorno AL ARRANCAR)
POKEMONPRICETRACKER_GRADED_PROBE=on <arranque normal del servicio>
# 3) el dial tiene que estar ON — la sonda NO lo sustituye
curl -X PUT "$ADMIN_BASE_URL/admin/settings" … -d '{"gradingHookEnabled":"on"}'
curl -X POST "$ADMIN_BASE_URL/admin/jobs/price-ingest" … -d '{}'
# 4) el veredicto sale entero de la PRIMERA corrida:
grep 'VEREDICTO-PSA' <log>
```

**VEREDICTO REGISTRADO (2026-08-31, stack nativo local, no staging):**

| Campo | Valor |
|---|---|
| Entorno | Stack nativo local (`:3099`), fixture sintético, llave **de relleno** (`ppt_fake_…`) |
| Corrida | dial `on` + sonda `on` + un `pptSetId` mapeado a mano (y revertido a `NULL` al terminar) |
| **VEREDICTO** | **`INDETERMINADO`** — *«Ninguna petición al proveedor llegó a responder OK (llave, red o pptSetId): no hubo observación.»* |
| Causa exacta | `PPT graded: EL REQUEST FALLÓ … HTTP 403 … cuerpo: **Host not in allowlist: www.pokemonpricetracker.com**` |
| Escrituras | **0** (`MODO: SONDA de SOLO LECTURA — cero escrituras en PriceReference`) |
| Coste | 0 créditos (la petición nunca salió de la red del sandbox) |

**Qué SÍ demuestra este veredicto** (que no es poco, y es la mitad que sí me tocaba): la sonda
**engancha y se anuncia** (`SONDA pedida por el operador… NO se escribe absolutamente nada`), el
veredicto **cambia de `MODO: INGEST` a `MODO: SONDA de SOLO LECTURA`** cuando de verdad opera, y una
corrida en modo sonda **no escribió ni una fila**. O sea: la segunda forma admitida de incapacitar un
entorno (§4.38r.6.1) **funciona y está verificada**, no supuesta.

**Qué NO demuestra, y no lo voy a disfrazar:** **nada sobre el proveedor**. Este sandbox no tiene
egress a `www.pokemonpricetracker.com` (403 del allowlist de red, pegado arriba) y aquí no hay
credencial real. **La sonda contra STAGING sigue PENDIENTE** y es **bloqueante del paso 5** por
§4.38(r.3.1) punto 2: encender sin haber observado el shape del proveedor es **pagar por
descubrirlo**. La corre quien tenga egress + llave de staging, con el guion de arriba.

**Dos preconditions de la sonda que se descubrieron corriéndola y que no estaban escritas en ningún
sitio:**

1. **Sin `pptSetId` mapeado en el set, la sonda no existe.** El proveedor sale **antes** de anunciarse
   (`PPT graded: set … sin pptSetId → no se pide nada`), la corrida es un **no-op** y el veredicto
   sale `MODO: INGEST` con 0 escritas. Un entorno sin mapear da un `INDETERMINADO` **de fontanería**,
   no una observación — y cuesta 0 créditos, así que es fácil confundirlo con «ya lo probé».
2. **`MODO: SONDA` solo aparece si el proveedor RESPONDIÓ a una petición de sonda.** Es deliberado en
   el código (`probe: false` en el retorno vacío: *«no hubo llamada siquiera… decir lo contrario
   contaminaría el veredicto»*) y es correcto. Consecuencia para quien lee el log: **la ausencia de
   `MODO: SONDA` NO prueba que la sonda estuviera apagada.** Para saber si estaba pedida, la línea es
   `PPT graded: SONDA pedida por el operador`.

---

#### 32.12.7 Rollback de este pase

Igual que §32.8, con el matiz de §4.38(r.4) que conviene tener delante:

| Qué se revierte | Cómo | Efecto |
|---|---|---|
| El **código** (M-48) | redeploy del commit anterior. **Sin migración que deshacer *por M-48*** (DATA/seed, sin DDL). ⚠️ Si el redeploy retrocede por detrás de **M-46** (ciclo de adquisición, DDL) o **M-47**, esas migraciones **ya están aplicadas** y este rollback no las revierte: un binario viejo contra un schema nuevo es otro escenario, y no es éste. | Vuelve el código que lee `graded_estimates_enabled`, **cuya fila sigue ahí con su valor previo**: el rollback **reenciende la exhibición tal como estaba** y el ingest vuelve a depender de su clave vieja (`off`). **Seguro y completo** — es la otra razón para no borrar las filas retiradas. |
| El **dial encendido** (si ya se encendió) | `PUT /admin/settings {"gradingHookEnabled":"off"}` desde M10. **Nunca por SQL** (§11.0-4). | Para publicación **y** gasto a la vez, sin redeploy. Es el botón de pánico que el gancho no tenía con dos diales. |
| Los cambios de **infra** de esta sección | `git revert` del commit de devops | Vuelve el `${VAR}` sin default y desaparece la guarda. **No hagas esto sin sustituirlo**: es lo único que impide que un runner con llave gaste. |

⚠️ **Apagar el dial NO es el remedio de una cifra rara** (§4.38r.5): es el **último** escalón. Para
una cifra concreta, se **borra esa fila** (`DELETE` del estimado); para un grado entero, se quita de
`grades`; para la promoción, `minUpsidePct`. Apagar el dial **congela también la actualización**, y si
el apagón supera `freshnessDays` (30) las filas automáticas quedan rancias — aunque el rancio está
acotado a **≤12 h** (el siguiente tick) o a lo que tarde un `POST /admin/jobs/price-ingest` manual
tras reencender, que **se normaliza como parte del reencendido**.

---

#### 32.12.8 Estado y qué queda en manos de otros

| Punto | Estado | De quién |
|---|---|---|
| Presupuesto en créditos publicado antes del primer encendido | ✅ §32.12.1 | devops (hecho) |
| Runbook del pase de 7 pasos con sus dos verificaciones positivas | ✅ §32.12.2–3, ejecutadas | devops (hecho) |
| Comparador rotulando lo retirado y sin deducir de filas inertes | ✅ §32.12.4, roturas demostradas | devops (hecho) |
| Entorno E2E/CI sin capacidad de escritura automática | ✅ §32.12.5, guarda cableada en `ci.yml` | devops (hecho) |
| **Sonda en STAGING con veredicto `VIABLE`/`NO_VIABLE`** | ⛔ **PENDIENTE** — sin egress ni llave desde aquí (§32.12.6) | devops/humano **con acceso a staging** |
| **GU-9** (frescura del dato automático: aceptar `≤ 60 días` por escrito **o** `evidenceDate` de M-43) | ⛔ **PENDIENTE, BLOQUEANTE del paso 5** (§4.38r.6.2) | **humano** (dos palabras bastan) |
| **Encender el dial en producción** | ⛔ **No es de devops.** Paso 5, con las cuatro precondiciones cumplidas | **el dueño**, desde M10 |
| Subir `ingestMaxCardsPerRun` por encima de 250 | ⛔ No en este pase: se dimensiona con el número **medido** en la primera corrida | dueño, tras el paso 6 |
| Deploy real del código de M-48 a staging/prod | ⛔ Fuera de esta sesión (sin credenciales de plataforma) | devops **con acceso** |

---

#### 32.12.9 Checklist del pase M-48 — para pegar en el ticket del release

```
[ ] 0. Estado previo anotado en CADA entorno (dev/staging/prod):
       railway logs --service backend | grep 'config inventory'
       → copiar la línea «claves RETIRADAS presentes» con sus dos valores.
[ ] 1. Deploy del código. `migrate deploy` no trae nada POR M-48 (es DATA/seed, sin DDL).
       ⚠️ NO asumas «no pending»: si el release arrastra M-46 (ciclo de adquisición,
       DDL) o M-47, el comando SÍ aplica DDL. Lee su salida y anótala en el ticket.
[ ] 2. bash scripts/check-graded-estimate-dials.sh  → rc=0 y `gradingHookEnabled: off`
       (si sale rc=2 «binario PRE-M-48», PARAR: el deploy no es el que creemos).
[ ] 3. VERIFICACIÓN POSITIVA Nº1 (no se pide nada):
       POST /admin/jobs/price-ingest {}  →  en el log:
         · `graded-estimate-ingest: dial ... = off → no se pide NADA al proveedor`
         · `[VEREDICTO-PSA] MODO: INGEST — 0 referencia(s) escritas`
         · CERO líneas `PPT graded:`   (grep -c "PPT graded:" → 0)
[ ] 4. VERIFICACIÓN POSITIVA Nº2 (no se escribe nada):
       SELECT count(*) FROM "PriceReference"
        WHERE source='pokemonpricetracker' AND "gradeKey" LIKE 'graded:PSA:%';
       → mismo número ANTES y DESPUÉS. Y los 10 diales de M2 idénticos a antes del deploy.
[ ] --- PRECONDICIONES DEL PASO 5 (§4.38r.3.1), las cuatro o ninguna ---
       [x] presupuesto publicado (DEVOPS_NOTES §32.12.1 = 1 000 créditos/día)
       [ ] veredicto de la SONDA en staging registrado (VIABLE / NO_VIABLE)
       [ ] GU-9 cerrada por escrito (cota ≤60 días  o  evidenceDate de M-43)
       [x] aviso de encendido en pantalla (M10, DESIGN_SYSTEM §22)
[ ] 5. EL DUEÑO enciende desde M10 (no devops, no SQL):
       PUT /admin/settings {"gradingHookEnabled":"on"}
       → verificar AuditLog `settings.update` con before/after.
[ ] 6. Medir la PRIMERA corrida: créditos del panel de PPT antes/después, `written`,
       motivos de salto, y revisar GET /admin/pricing/graded-estimates/review.
       → la factura CABE en el presupuesto declarado. Si no cabe, se para y se escala.
```


---

## 33. El preflight de Stripe mentía: 13 corridas rojas y un verde que no era verde — 2026-08-30

> **Resumen en una línea:** `e2e-real.yml` —el gate que decide la promoción a producción— llevaba
> **13 corridas de 13 en rojo desde el día que existe** (2026-08-18), y el paso que debía explicarlo
> comprobaba que la variable **existiera**, no que **sirviera**. Dos mentiras encadenadas: un rojo
> diario que nadie miraba y un preflight capaz de decir «clave de prueba presente, los smokes de
> dinero son gate real» sobre un relleno.

### 33.1 Lo que se creía y lo que dice el registro

Lo que §31 daba por hecho era que el nightly funcionaba y que sólo los tres smokes de dinero salían
rojos «por falta de proveedor». La primera mitad es falsa. Consultado el historial del workflow
(API de Actions, no memoria):

| Corridas de `e2e-real.yml` | 13 (nº 1 el 2026-08-18, nº 13 el 2026-08-29) |
|---|---|
| Verdes | **0** |
| Rojas | **13** |
| Paso donde muere | **siempre** el mismo: `Playwright smoke — flujos críticos (REAL)` |

No son «tres días sin mirar el tablero»: son **doce días y todas las corridas que ha habido**. El
workflow nunca ha estado verde ni un solo día. Esto importa para el DoD, porque §31.4 lo declaraba
gate de promoción — un gate que nunca ha pasado no ha bloqueado nada, ha sido decorativo.

Del log de la corrida 13 (`33255299677`, job `99107828594`), el detalle que cierra el diagnóstico:

```
STRIPE_TEST_SECRET_KEY: sk_test_e2e_dummy
STRIPE_TEST_PUBLISHABLE_KEY: pk_test_e2e_dummy
STRIPE_TEST_WEBHOOK_SECRET: whsec_e2e_dummy
→ 3 failed, 1 passed   (18 × "element(s) not found", 9 × toBeVisible failed)
```

### 33.2 El defecto real: presencia ≠ validez, y por qué se elige SALTAR

El paso 11 se llamaba **«Preflight — ¿hay clave de PRUEBA de Stripe real?»** y su lógica era un `case`
sobre el valor con una rama por el literal `sk_test_e2e_dummy`. Todo lo demás que empezara por
`sk_test_` caía en la rama optimista e imprimía en verde *«Clave de prueba presente; los smokes de
dinero son gate real»*. Es decir: `sk_test_CHANGE_ME` —**el valor que este mismo repo pone en
`.env.example`**— habría anunciado un gate de dinero que no existía. **Es el patrón de §32 (el seed que
no pisa lo existente) y el de §30.1 (el test que fijaba su propia configuración): un detector que se
cree a sí mismo.**

**Contexto que decide el diseño, y que hay que dejar escrito porque lo cambia todo:** el dueño **no ha
configurado Stripe A PROPÓSITO** y no lo hará hasta que la plataforma esté al 100%. `sk_test_e2e_dummy`
no es un olvido ni una credencial vencida: es un **estado deliberado y duradero** del proyecto.

De las dos salidas honestas posibles, **se elige SALTAR** los tres smokes de dinero declarándolos
saltados, y **no** fallar el preflight. El porqué, sin adornos:

1. **Fallar sería gritar todos los días por una decisión consciente del dueño.** Un rojo que sale
   siempre no es una alarma: es ruido. Y el ruido diario es *exactamente* el mecanismo por el que
   nadie miró este tablero durante 12 días. Una alarma que suena siempre ya se apagó, sólo que en la
   cabeza del equipo en vez de en el YAML.
2. **Fallar tira la señal de lo que sí funciona.** Hoy el job tarda ~6 minutos en morir por algo que se
   sabía en el segundo 0, y de paso pierde el resultado de los flujos no monetarios.
3. **Saltar sólo es honesto si el salto es de primera clase**, y por eso viene con los cuatro
   requisitos de abajo. Un salto silencioso sería peor que el rojo.

Lo que **no** se negocia y está cableado así:

| Requisito | Cómo se cumple |
|---|---|
| Los tres tests **nunca** se borran, ni se marcan `.skip`, ni salen de `SMOKE_SPECS` | El salto lo decide el **entorno en tiempo de corrida** (`scripts/stripe-test-key-preflight.sh` filtra la lista efectiva). `frontend/e2e/` no se toca: es del rol frontend. |
| Vuelven a ser **obligatorios solos** cuando aparezca la credencial | La detección es **por forma del valor**. No hay bandera `skip_money=true` que alguien tenga que acordarse de quitar — ese es justo el patrón que ya nos mordió dos veces. |
| El estado se lee **sin abrir logs** | Bloque en el *Summary* del run (primer paso del job) + veredicto final de una línea + anotación `::warning`. |
| La promoción a prod **no salta nada** | `deploy.yml` llama con `require_real_stripe: true` → el preflight **falla en el segundo 0** con la variable nombrada, el motivo («valor de relleno») y dónde se pone la buena. |

### 33.3 Cómo distingue «clave real» de «relleno» (y el falso positivo que evité)

`scripts/stripe-test-key-preflight.sh` clasifica **por forma, en este orden**:

| Regla | Qué caza | Falsos positivos |
|---|---|---|
| Prefijo `sk_live_`/`pk_live_` | clave live en staging → **aborta siempre** | ninguno |
| Prefijo distinto de `sk_test_`/`rk_test_`/`pk_test_` | formato desconocido → **aborta** | ninguno |
| **Longitud** del sufijo < 24 | `e2e_dummy` (9), `CHANGE_ME` (9), `xxx` | **imposible**: las claves de Stripe traen 24 (legacy) o ~99 (`sk_test_51…`) |
| **Alfabeto** ≠ `[A-Za-z0-9]` | cualquier cosa con `_`, guion, espacio o comilla → la escribió una persona, no Stripe | **imposible** |
| **Vocabulario** (`dummy`, `changeme`, `placeholder`, `example`, `fake`, `invalid`, …) y 4 caracteres idénticos seguidos | relleno largo y alfanumérico (`sk_test_dummydummydummy…`) | ~1e-4 |

**El falso positivo que casi introduzco, porque es la misma clase de error que esta sección corrige.**
Mi primera versión buscaba también tokens de 3 letras (`xxx`, `foo`, `bar`, `tbd`) como subcadena. Una
clave **auténtica** es una cadena alfanumérica de ~99 caracteres: la probabilidad de que contenga por
azar alguno de esos trigramas es **~2%**. Un preflight que declara «relleno» una clave buena una de
cada cincuenta veces —y bloquea una promoción a prod por ello— es otro detector que miente, sólo que
en la dirección contraria. Se quitaron: los rellenos cortos ya los cazan las dos reglas **exactas**
(longitud y alfabeto), que no tienen falsos positivos posibles. **Dos reglas exactas y una heurística
conservadora, en ese orden.**

**Lo que este preflight promete, literalmente: «esto no es un relleno». Nada más.** No llama a
`api.stripe.com` — (a) desde la máquina de trabajo el egress a Stripe está bloqueado (§31.2) y un
preflight dependiente de red sería inestable; (b) una clave con forma real pero **revocada** la caza el
propio smoke, que es donde debe caerse. Decirlo importa: prometer «clave válida» sería la tercera
mentira de esta cadena.

**Nunca imprime el valor.** Sólo prefijo (8 caracteres) y longitud total.

### 33.4 `deploy.yml`: la puerta no se está saltando — **nunca estuvo en el camino**

Pregunta del coordinador: si el E2E real no puede estar verde sin Stripe, ¿cómo se promovió la curva v2
a producción el 28 de agosto? Respuesta, con el registro de Actions delante:

**No se promovió por ahí. `deploy.yml` no corrió el 28 de agosto, ni el 27, ni ningún día desde el 25.**

| Dato verificado | |
|---|---|
| Última corrida de `deploy.yml` | nº 52, **2026-08-25**, `workflow_dispatch`, conclusión **success** |
| Qué hizo esa corrida «verde» | `secrets-gate` → `ready=false` (faltan los 6 secrets de deploy) → **`ci-ok`, `preflight`, `deploy-staging-*`, `e2e-real`, `dast-staging` y los dos `promote-production-*` quedaron TODOS en `skipped`** |
| Corridas de `deploy.yml` el 26–30 de agosto | **ninguna** |
| Camino real de los deploys | integraciones **nativas** push-to-deploy de Vercel/Railway (documentado en la cabecera de `deploy.yml`, líneas 34-48) |

Conclusión, y es más grave que el falso verde que vine a arreglar:

- **La puerta no se está esquivando: no existe en el camino que se usa.** El CD por Actions está
  desactivado por diseño (`workflow_dispatch` only) y, sin los 6 secrets, se auto-salta. Vercel y
  Railway despliegan al hacer push y **no consultan el resultado de ningún workflow de GitHub**. El
  gate E2E real, el DAST de staging y la aprobación del *environment* `production` **no intervienen en
  un solo deploy real**.
- **Y esa corrida nº 52 es, ella misma, otro miembro de la familia:** un run llamado
  «Deploy (staging → prod)» que terminó en **verde** habiendo desplegado **nada**. Jobs saltados cuentan
  como neutrales, así que el check verde es indistinguible de un despliegue correcto.
- Por tanto **la promoción a producción no está «estructuralmente bloqueada» por la falta de Stripe**.
  Lo estaría si el camino pasara por `deploy.yml`; hoy no pasa.

**No he tocado `deploy.yml`** (instrucción explícita del coordinador: la decisión de cómo cerrar esa
puerta es suya con el dueño). Las tres opciones, con su contrapartida, para esa conversación:

| Opción | Qué implica |
|---|---|
| Dejarlo como está y **decirlo en `deploy.yml` y en el DoD**: los gates son *advisory*, no bloqueantes | Cuesta cero. Pero el DoD dice «gate de seguridad y harness E2E cableados en CI» y hoy eso es cierto sólo en el papel del workflow, no en el camino real. |
| **Branch protection** con `e2e-real` / SAST como *required status checks* de la rama que Vercel/Railway despliegan | Es el único punto donde un gate muerde el camino nativo: si no se puede mergear, no hay push que desplegar. No necesita los 6 secrets de deploy. |
| Activar el CD por Actions (cargar los 6 secrets, quitar el push-to-deploy nativo) | Restaura la puerta entera tal como está escrita, pero cambia el modelo operativo del dueño. |

Nota para la opción 2: con Stripe deliberadamente ausente, `e2e-real` como *required check* sólo tiene
sentido **con el salto declarado de §33.2**; con el comportamiento anterior habría bloqueado todos los
merges para siempre.

### 33.5 Local vs CI: el mismo síntoma con dos causas distintas (corrige la lectura de §31)

§31 metía los dos casos bajo la misma etiqueta y eso confunde el diagnóstico. Quedan separados:

| | **Local** (stack nativo / docker en la máquina del equipo) | **CI** (`e2e-real.yml`, runner `ubuntu-latest`) |
|---|---|---|
| Causa de los 3 rojos | **Egress bloqueado**: `CONNECT api.stripe.com` → 403 (§31.2) | **Clave de relleno**: `sk_test_e2e_dummy` (fallback del workflow) |
| ¿Se arregla con la clave? | **NO.** Con clave real seguiría rojo, ahora por timeout de red | **SÍ.** Es lo único que falta |
| ¿Se arregla con egress? | Sí, más la clave | No aplica: el runner ya tiene salida |
| Qué hace el preflight | No corre aquí | Lo detecta en el segundo 0 y salta los 3 declarándolo |

Quien pruebe en local y vea los mismos tres rojos **no está viendo el mismo problema**: darle la clave
al stack local no los pone en verde (§31.2). Es la advertencia que hace perder una tarde.

### 33.6 Qué imprime ahora, en cada rama

Probado con `scripts/stripe-test-key-preflight.sh` a mano (15 casos: fallback, secret ausente,
`CHANGE_ME`, relleno alfanumérico largo, repeticiones, 23 caracteres, clave con forma real, `rk_test_`
restringida, secret real + publicable de relleno, clave live, formato desconocido, promoción con y sin
credencial, lista sólo-dinero, y specs con ruta `e2e/…`).

**Rama A — relleno, nightly (`require_real_stripe: false`) → verde PARCIAL declarado, `exit 0`:**

```
| STRIPE_TEST_SECRET_KEY      | sk_test_… (17 caracteres en total) | VALOR DE RELLENO (no es una credencial) |
| STRIPE_TEST_PUBLISHABLE_KEY | pk_test_… (17 caracteres en total) | VALOR DE RELLENO (no es una credencial) |

Gate de dinero: INACTIVO — los smokes de dinero se SALTAN por falta de credencial.
  Saltados (no ejecutados, NO aprobados): checkout.spec.ts guest-checkout.spec.ts shipments.spec.ts
  Sí se ejecutan: buylist.spec.ts

::warning title=SIN GATE DE DINERO — 3 smokes SALTADOS::…
::warning title=Verde PARCIAL — 1 flujo corrido, 3 de dinero SALTADOS::Este run NO probó comprar,
        comprar-como-invitado ni retirar…  El verde de este workflow NO es un verde de dinero.
```

**Rama B — clave con forma real → todo corre, gate ACTIVO, `exit 0` (comportamiento intacto):**

```
| STRIPE_TEST_SECRET_KEY | sk_test_… (58 caracteres en total) | clave con forma de credencial real |

Gate de dinero: ACTIVO. …los tres smokes de dinero corren y son OBLIGATORIOS.
  Specs que corren: checkout.spec.ts guest-checkout.spec.ts shipments.spec.ts buylist.spec.ts
  Specs saltados: ninguno
::notice title=Gate de dinero ACTIVO::…
> Un rojo en checkout · guest-checkout · shipments a partir de aquí ES UN BUG DE PRODUCTO.
```

**Rama C — promoción a prod sin credencial (`require_real_stripe: true`) → `exit 1` en el segundo 0:**

```
::error title=Gate de promocion sin clave de PRUEBA real::STRIPE_TEST_SECRET_KEY: VALOR DE RELLENO
        (no es una credencial); STRIPE_TEST_PUBLISHABLE_KEY: VALOR DE RELLENO… Pon los secrets
        STRIPE_TEST_SECRET_KEY (sk_test_...) y STRIPE_TEST_PUBLISHABLE_KEY (pk_test_...) en
        Settings > Secrets and variables > Actions. Ver DEVOPS_NOTES 31.1. Nunca una clave live.
```

Otros abortos duros, en cualquier rama: **clave live** (`sk_live_`/`pk_live_`), **formato desconocido**,
y **«no queda ningún smoke que correr»** (si alguien invoca el workflow con una lista compuesta sólo de
specs de dinero, saltarlos dejaría el job **vacío** — y un job vacío en verde es este mismo falso verde
con otra cara).

**Verificación del cambio:** `actionlint 1.7.7` + `shellcheck 0.10.0` sobre `e2e-real.yml` y sobre el
script: **0 hallazgos**. El paso de veredicto se ejecutó fuera de CI con `GITHUB_STEP_SUMMARY` simulado
en las tres combinaciones (gate on / gate off / Playwright rojo).

### 33.7 Novedad importante: el **publicable** también es credencial

El preflight exige que **las dos** claves tengan forma real. Sin `pk_test_…` el modal de Stripe **no
monta en el navegador** aunque el backend cree la sesión: los tres smokes fallarían igual, y con el
agravante de parecer un bug de producto (el backend responde 200 y la UI no muestra nada). §31.1 ya
marcaba la publicable como obligatoria en prosa; ahora está **comprobado en el gate**.

### 33.8 Limitación que dejo escrita en vez de esconder

Con el gate de dinero apagado, el smoke por defecto se queda en **un solo spec** (`buylist.spec.ts`):
3 de los 4 son de dinero. Es señal, y es más que el cero de hoy, pero **es delgada**.

**No amplío la lista por defecto en este pase, y el motivo no es pereza:** los demás specs
(`catalog`, `auth`, `vault`, `portfolio`, `admin`, …) **nunca han corrido en modo real**. Meterlos de
golpe en el nightly tiene una probabilidad alta de reintroducir el rojo diario que esta sección viene a
eliminar — cambiar un ruido por otro. El camino correcto es una corrida manual:

```
Actions → «E2E real (stack real)» → Run workflow →
  smoke_specs: "buylist.spec.ts catalog.spec.ts auth.spec.ts vault.spec.ts portfolio.spec.ts"
```

y ampliar el default **sólo** con los que pasen. Queda como tarea abierta de devops, no como algo
resuelto.

### 33.9 Qué le queda al humano

| Acción | Efecto | ¿Bloquea algo hoy? |
|---|---|---|
| **Nada, si la decisión sigue siendo no configurar Stripe** | El nightly queda **verde parcial declarado**: corre los flujos no monetarios y dice en el resumen que saltó 3 y por qué | No. Es el estado esperado y estable. |
| Crear los secrets `STRIPE_TEST_SECRET_KEY` (`sk_test_…`) y `STRIPE_TEST_PUBLISHABLE_KEY` (`pk_test_…`) en *Settings > Secrets and variables > Actions* (§31.1) | Los tres smokes de dinero **se activan solos** y vuelven a ser obligatorios. Sin tocar código ni quitar banderas. | Es lo único que separa el gate de dinero de existir | **⚠️ CORREGIDO 2026-09-10 → §51: las dos claves de prueba LLEVAN TRES DÍAS en los secrets; el nocturno `34477885121` corrió los flujos en REAL con `MONEY_SKIPPED` vacío. Lo que falta es `STRIPE_TEST_WEBHOOK_SECRET`, y ya no bloquea (§50.4).**
| **Decidir con el coordinador qué hacer con §33.4** | Hoy ningún deploy real pasa por gate alguno | **Sí — es el hueco grande de este pase**, y no lo cierra devops en solitario |

**Lo que sigue sin ser cierto, y no lo declaro cerrado:** los tres flujos de dinero **siguen sin
verificarse en navegador** (condición #1 del DoD, §30.6/§31.5). Este pase **no** los verifica: hace que
el sistema **diga la verdad** sobre que no están verificados, en vez de fingir un gate que no existía.
Son dos cosas distintas y conviene no confundirlas al leer el tablero.

---

## 34. P-21 — Los buzones `@tcghunt.mx` ya reciben: switch de correo en PRODUCCIÓN (2026-08-31)

> **Disparador cumplido.** El humano confirmó que los buzones `@tcghunt.mx` **ya reciben correo**
> (Cloudflare Email Routing activo y probado). Ésa era exactamente la precondición que exigía la nota
> de `.env.example` y el paso §25.6-A.8. Con ella se desbloquea la parte de **buzones que reciben**.
> **NO desbloquea automáticamente el remitente** — ver §34.1, es la trampa de esta sección.
>
> **Autoridad:** `PROJECT.md` decisión 58 (2026-08-31) — el dominio del negocio es **uno**,
> `tcghunt.mx`; los anteriores quedaron **retirados** (el documento los llama *inexistentes*). Eso
> **deroga** el supuesto de §25.2 de un 301 servido por un dominio viejo que el negocio conserva:
> si el dominio ya no existe, no hay 301 que valga y tampoco hay origen que allow-listear.

### 34.0 Lo que cambió en el repo (este pase) y lo que NO cambia nada

| Archivo | Cambio | ¿Surte efecto en prod al mergear? |
|---|---|---|
| `.env.example` (bloque `APP_BASE_URL`, `DISPUTE_EVIDENCE_CONTACT`, `SUPPORT_EMAIL`, bloque de correo Resend, índice `[RW]`, nota DAST) | Dominio migrado a `tcghunt.mx`; el bloque `MAIL_FROM` pasa de futuro a presente y separa las dos precondiciones (§34.1) | **NO.** Es una plantilla para devs; producción **no lee este archivo** |
| `docker-compose.yml`, `docker-compose.staging.yml` | Comentario del default de `DISPUTE_EVIDENCE_CONTACT` | **NO.** Solo comentario; el valor sigue siendo `${DISPUTE_EVIDENCE_CONTACT:-}` |

**Conclusión operativa, y es el punto entero de esta sección:** *ningún* archivo de este repo cambia
el correo de producción. **El cambio real vive en Railway.** Mergear esta rama sin hacer §34.2 deja
producción exactamente igual que antes.

### 34.1 La distinción que hay que tener clara antes de tocar nada

Son **dos precondiciones distintas** y confundirlas rompe el correo de toda la plataforma:

| Variable | Qué es | Precondición | ¿Cumplida hoy? |
|---|---|---|---|
| `DISPUTE_EVIDENCE_CONTACT`, `SUPPORT_EMAIL` | Buzones que **RECIBEN** (se imprimen en correos y en la respuesta de disputa para que el cliente escriba) | Email Routing de `tcghunt.mx` activo → el buzón recibe | **SÍ** (confirmado por el humano) |
| `MAIL_FROM` | Remitente que **ENVÍA** (lo pone Resend en el `From:`) | `tcghunt.mx` en estado **Verified** (SPF/DKIM) en el dashboard de **Resend** | **DESCONOCIDO — hay que mirarlo** (§34.2 paso 1) |

Que un dominio **reciba** no implica que pueda **enviar**: son registros DNS distintos (MX/routing vs.
SPF/DKIM) en productos distintos (Cloudflare vs. Resend). Si se fija `MAIL_FROM` con un dominio que
Resend no tiene Verified, **Resend rechaza el 100% de los envíos** y el usuario no ve ningún error:
simplemente nunca le llega la verificación de cuenta, el reset de contraseña ni la confirmación de
pedido. Por eso `MAIL_FROM` es el **último** paso y tiene su propio gate.

### 34.2 Procedimiento — Railway, paso a paso (lo ejecuta el HUMANO)

**Dónde:** Railway → proyecto → servicio **`backend`** → environment **`production`** → pestaña
**Variables**. Todas estas variables son **overrides de entorno**: no requieren merge, ni build, ni
esperar a un despliegue de código. Al guardar, Railway **reinicia el contenedor** con el env nuevo
(~1–2 min, arranque idempotente §11.F) — es un restart, no un deploy: el arte del contenedor no se
reconstruye. Esa es la razón por la que esto puede hacerse **hoy**.

> **Antes de empezar**, ten a mano una cuenta de correo tuya para las pruebas (Gmail personal sirve)
> y **no** uses una cuenta que ya exista en la plataforma: el paso de verificación necesita registrar
> una cuenta nueva.

**Paso 1 — [GATE de `MAIL_FROM`] Resend: ¿`tcghunt.mx` está Verified?**
Resend → **Domains**. Busca `tcghunt.mx`:
- Estado **Verified** (verde) → sigue al paso 2 completo.
- **No aparece / Pending / Failed** → **NO fijes `MAIL_FROM`**. Haz solo los pasos 2a y 3, y añade el
  dominio en Resend (*Add Domain* → pega los TXT/CNAME que te dé en la zona de Cloudflare de
  `tcghunt.mx` → *Verify*). Vuelve al paso 2b cuando esté verde (propagación: minutos a 1 h).

**Paso 2 — Fijar las variables.** En este orden (las de recibir primero; el remitente al final):

| # | Variable | Valor EXACTO a fijar | Gate |
|---|---|---|---|
| 2a | `DISPUTE_EVIDENCE_CONTACT` | `soporte@tcghunt.mx` | Buzón recibe — **cumplido** |
| 2a | `SUPPORT_EMAIL` | `soporte@tcghunt.mx` *(opcional: solo si quieres un buzón distinto al de disputas; si no la fijas, hereda de `DISPUTE_EVIDENCE_CONTACT`)* | Buzón recibe — **cumplido** |
| 2b | `MAIL_FROM` | `TCG HUNT <no-reply@tcghunt.mx>` *(con el nombre visible; comillas NO — Railway guarda el valor literal)* | **Solo si el paso 1 salió Verified** |

> **`MAIL_FROM` puede existir ya o no** (§34.4): da igual. Si ya existe, **edítala**; si no aparece en
> la lista, **créala** con *New Variable*. El resultado es el mismo y el procedimiento no cambia.

**Paso 2c — `APP_BASE_URL` (revisar, y corregir si hace falta).** Mira su valor actual. Debe ser:

```
https://www.tcghunt.mx,https://tcghunt.mx,https://tcg-vault-mx.vercel.app
```

Dos cosas dependen de esto y conviene entender cuál es cuál:
- **El PRIMER origen** arma los links de los correos (verificación, reset) y el `return_url` de Stripe.
  Si el primero no es `https://www.tcghunt.mx`, los correos saldrán con links de otro dominio.
- **Toda la lista** es la allow-list de CORS. Si `https://www.tcghunt.mx` **no** está en la lista, el
  frontend servido en ese dominio **no puede hablar con el backend** (todo falla con error de CORS).
  Si la web funciona hoy, es que ya está; verifícalo igual, cuesta 10 segundos.
- Los dominios retirados **se quitan** de la lista: un origen que no existe no emite peticiones, así
  que allow-listearlo no protege de nada y solo confunde el próximo runbook.

**Paso 3 — Guardar y esperar el restart.** Railway muestra el servicio en *Deploying* → *Active*.
Comprueba que arrancó:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://tcg-vault-mx-production.up.railway.app/api/v1/health
# esperado: 200
```

Si no vuelve 200 en ~3 min, ve al rollback (§34.5) y reporta: es un fallo de arranque, no del correo.

### 34.3 Verificación — fijar las variables NO es haber terminado

Fijar una variable no prueba nada. Hay que comprobar las **dos direcciones** del correo por separado,
porque fallan por causas distintas.

**V1 — ENVÍO: ¿sale un correo real desde el remitente nuevo?** (prueba de extremo a extremo, 2 min)

1. Ve a `https://www.tcghunt.mx` → **Crear cuenta** con una dirección tuya que no esté registrada.
2. Espera el correo de verificación (< 1 min). **Revisa también SPAM.**
3. En el correo recibido, abre **"Mostrar original"** (Gmail: menú ⋮ → *Mostrar original*) y confirma:
   - `From:` → `TCG HUNT <no-reply@tcghunt.mx>` — **el nombre visible y el dominio nuevo**.
   - `SPF: PASS` y `DKIM: PASS` para `tcghunt.mx`. Si alguno dice `FAIL`/`NEUTRAL`, el dominio no está
     bien verificado en Resend: **haz rollback de `MAIL_FROM`** (§34.5) y termina la verificación en
     Resend antes de reintentar. Con SPF/DKIM en rojo el correo acaba en spam aunque "llegue".
   - El link de verificación apunta a `https://www.tcghunt.mx/...` (eso valida el paso 2c).
4. Haz clic en el link: la cuenta debe quedar verificada.

**Evidencia del lado servidor (obligatoria si V1 falla, y recomendable siempre):**

- **Resend → Emails / Logs:** cada envío aparece con su estado. Busca el de tu prueba.
  - `Delivered` → envío correcto.
  - `Bounced` / `Failed` con mensaje tipo *"The domain is not verified"* o *"from address not allowed"*
    → **el remitente no está verificado**. Es el fallo silencioso: la app no lo muestra al usuario.
  - **Ningún registro** → el backend ni siquiera intentó enviar: mira los logs de Railway.
- **Railway → servicio `backend` → Logs**, filtra por `MailModule`. Al arrancar imprime **el remitente
  efectivo**, y es la forma más rápida de saber qué está usando de verdad:
  - `Correo: ResendMailAdapter (from=TCG HUNT <no-reply@tcghunt.mx>).` → `MAIL_FROM` tomó efecto.
  - Si el `from=` que imprime es otro, la variable no está donde crees (¿environment equivocado?
    ¿servicio equivocado?).
  - `RESEND_API_KEY ausente → NoopMailAdapter` → **no se está enviando nada en absoluto**; incidencia
    aparte y grave (esto no debería poder pasar en prod: `env.validation.ts` lo exige).

**V2 — RECEPCIÓN: ¿una respuesta al buzón nuevo llega a alguien?** (esto es lo que V1 no prueba)

1. Desde tu correo personal, **responde** al correo de verificación que te llegó (va a `no-reply@`) y
   además manda un correo directo a **`soporte@tcghunt.mx`**.
2. Confirma que ambos aterrizan en el Gmail destino del Email Routing. `no-reply@` puede rebotar por
   diseño (es un buzón de solo envío) — **lo que no puede fallar es `soporte@tcghunt.mx`**: ése es el
   que la plataforma le da al cliente para mandar evidencia de una disputa. Si no llega, hay un cliente
   con una disputa gritando al vacío.
3. Comprueba que la API ya **devuelve** el buzón nuevo. `evidenceContact` no se expone en ningún
   endpoint público sin datos (sale en la respuesta de disputa y en el seguimiento de pedido de
   invitado, `POST /api/v1/orders/guest/track`, que exige nº de pedido + correo reales). Así que
   verifícalo por la vía que tengas a mano:
   - **Con un pedido real de prueba:** entra a *Seguimiento de pedido* en la web y confirma que el
     correo de contacto que muestra es `soporte@tcghunt.mx`.
   - **Sin pedido:** Railway → Variables → confirma que `DISPUTE_EVIDENCE_CONTACT` quedó guardada con
     el valor exacto (sin espacios de más: `envOr` trata blanco como ausente y caería al default).

**Criterio de aceptación del switch:** V1 con `From:` nuevo + SPF/DKIM PASS, **y** V2 con
`soporte@tcghunt.mx` recibiendo, **y** `/health` en 200. Con eso el cambio surtió efecto de verdad.

### 34.4 `MAIL_FROM` en producción: lo que el repo dice, y por qué no basta

La pregunta —*¿está `MAIL_FROM` fijada hoy en prod?*— **no se puede contestar desde el repo**, y la
documentación **se contradice**. Se deja escrito para que nadie vuelva a fiarse de ninguna de las dos:

| Fuente | Qué afirma |
|---|---|
| `HANDOFF.md` §3 (inventario de variables de Railway) | `MAIL_FROM=no-reply@tcgvaultmx.com` — la lista la da por **FIJADA** |
| `DEVOPS_NOTES.md` §25.5 (tabla del rebrand) | `MAIL_FROM` → *"sin fijar (default de código)"* — la da por **NO fijada** |

Ninguna de las dos es una consulta en vivo a Railway: son notas escritas a mano en momentos distintos.
**La §25.5 se escribió sin evidencia que la respaldara y contradice al HANDOFF; queda marcada como no
fiable.** Esta sección la sustituye.

**Lo que sí se puede afirmar, y es lo que importa:** el **remitente efectivo es el mismo en los dos
escenarios**. Si `MAIL_FROM` está fijada, vale `no-reply@tcgvaultmx.com` (HANDOFF); si no lo está, el
backend cae al default de código `DEFAULT_MAIL_FROM = 'no-reply@tcgvaultmx.com'`
(`backend/src/modules/mail/mail.module.ts:13`). **En ambos casos producción está enviando desde el
dominio retirado.** Por eso el procedimiento §34.2 no se ramifica: fijes o edites, el destino es el
mismo valor.

**El riesgo vivo, planteado como hipótesis y no como hecho:** `HANDOFF.md` §3 registra el dominio
`tcgvaultmx.com` como **Verified** en Resend *en su momento*. Si ese dominio fue retirado y su zona DNS
ya no publica los TXT/CNAME de SPF/DKIM, **Resend lo marca como no verificado y rechaza todo envío**
desde él. En ese escenario la plataforma lleva **sin entregar ni un solo correo transaccional**
—verificación de cuenta (que bloquea comprar/vender/retirar), reset de contraseña, confirmaciones de
pedido, buylist y disputas— y **el fallo es silencioso**: la API responde 200 y nadie se entera.
**No lo afirmo:** desde esta sesión no hay egress a producción ni acceso a los dashboards (§23.1,
§26). Es una hipótesis con causa mecánica plausible, y **se confirma o se descarta en dos minutos**.

**Comprobación del humano — 2 minutos, en este orden (para y arregla en el primer rojo):**

1. **Resend → Domains** (15 s). ¿Qué estado tiene `tcgvaultmx.com`? Si dice **Failed / Pending / no
   aparece**, la hipótesis está **confirmada**: el correo transaccional está caído ahora mismo → es un
   **P0** y el arreglo es completar §34.2 (verificar `tcghunt.mx` + fijar `MAIL_FROM`) **hoy**.
2. **Resend → Emails / Logs**, filtra por los últimos 7 días (45 s). Es la evidencia más directa:
   - Envíos en `Delivered` → el correo **está saliendo**; no hay incendio, el switch es una mejora de
     marca y se hace con calma.
   - Todo en `Bounced`/`Failed`, o **la lista vacía pese a haber habido registros/pedidos** → caído.
     Abre uno y lee el mensaje de error: ahí dice si es el dominio del remitente.
3. **Railway → `backend` → Variables** (20 s). Busca `MAIL_FROM` en la lista: o está o no está. Eso
   resuelve la contradicción del repo — **anota el resultado en `HANDOFF.md` §3** (lo escribe el rol
   dueño de ese archivo), porque hoy hay dos documentos afirmando cosas opuestas.
4. **Railway → `backend` → Logs**, filtra `MailModule` (20 s). La línea de arranque
   `Correo: ResendMailAdapter (from=…)` dice **el remitente que se está usando de verdad**, sin
   depender de lo que digan los dashboards ni los documentos. Es la fuente de verdad.

Si el paso 2 sale verde (correos entregándose), el switch de §34.2 **no es urgente** pero sigue siendo
necesario: se está enviando desde un dominio que ya no es del negocio y que puede dejar de verificar
en cualquier momento, sin aviso.

### 34.5 Rollback

Cada variable es independiente y reversible **sin desplegar código** (mismo restart de ~1–2 min):

| Si falla | Acción | Estado al que vuelve |
|---|---|---|
| `MAIL_FROM` (SPF/DKIM en rojo, Resend rechaza) | **Borra la variable** `MAIL_FROM` (no la vacíes… aunque vaciarla también sirve: `envOr` trata `''` y `'   '` como ausente y cae al default) | Remitente = default de código. **OJO:** ese default es el dominio retirado — si *ése* es el que no verifica, el rollback **no** arregla el envío; el único camino hacia adelante es verificar `tcghunt.mx` en Resend |
| `DISPUTE_EVIDENCE_CONTACT` / `SUPPORT_EMAIL` | Borrar la variable (cae al default de código) o fijar el buzón anterior | Buzón anterior. Solo tiene sentido si el buzón viejo **sigue recibiendo**; si el dominio está retirado, **no lo hagas**: dejarías a los clientes escribiendo a un buzón muerto |
| `APP_BASE_URL` | Restaurar el valor anterior (cópialo **antes** de editarlo) | Links y CORS previos |

**Regla:** antes de tocar cualquiera de estas variables, **copia su valor actual a un bloc de notas**.
Railway no ofrece historial de variables por valor y el rollback depende de que lo tengas apuntado.

### 34.6 Lo que esta sección NO cierra (enrutado a sus roles)

- **backend:** `DEFAULT_MAIL_FROM` (`mail.module.ts:13`) y los buzones por defecto de
  `disputes.constants.ts`, `buylist-mail.templates.ts`, `guest-checkout.constants.ts` siguen con el
  dominio retirado. Está en curso en paralelo. **Nota importante para no relajarse:** ese arreglo
  cambia el *default de código*, que solo aplica cuando la env **no** está fijada — **no sustituye a
  §34.2**. Producción se arregla fijando la variable, no mergeando el default.
- **frontend:** buzones en `messages/{es,en}.json`, marca/metadata y `vercel.json` (§25.7). Con el
  dominio viejo retirado, el 301 de §25.2 ya no es realizable: eso lo replantea el arquitecto/PO.
- **humano:** todo §34.2 y §34.4 — nadie más tiene acceso a Railway ni a Resend.

---

> **Nota de fusión (2026-09-05).** Las tres secciones que siguen se escribieron en el stream
> `claude/buylist-inventory-workflow-hdnls3` numeradas **§33 / §34 / §35**. Al absorber `origin/main`
> chocaron con las §33 y §34 que ya vivían en el tronco, así que **se renumeraron aquí**:
>
> | Número en el stream | Número definitivo | Sección |
> |---|---|---|
> | §33 | **§35** | `APP_PUBLIC_URL` — CTA de los correos del buylist |
> | §34 | **§36** | BL-27 — el gate `format-mix` de CI |
> | §35 | **§37** | Stack nativo para el gate de QA |
>
> El tronco NO se renumeró (su §33 está referenciada desde `.github/workflows/e2e-real.yml`).
> **Las 12 referencias que apuntaban al número viejo ya están corregidas** en el mismo pase:
> `docker-compose.yml:223`, `docker-compose.staging.yml:210`, `scripts/stack-native.sh`
> (43, 128, 511, 524, 557), `scripts/check-format-mix.sh:160` y `.env.example` (8, 41, 141, 670).
> **No se tocaron** las que apuntan al §33/§34 del tronco —Stripe y switch de correo P-21—:
> `.github/workflows/e2e-real.yml` (26, 44, 116, 393) y `.env.example` (98, 291, 324, 745).
> La tabla se conserva porque los números viejos siguen citados en veredictos y tickets
> anteriores a la fusión.

---

## 35. `APP_PUBLIC_URL` — el CTA de los correos del buylist: declarado, alineado y **todavía sin valor a propósito** (2026-09-01, stream `claude/buylist-inventory-workflow-hdnls3`)

**El hueco lo levantó backend, no QA ni un incidente** (`BACKEND_NOTES` §0.18: *«`APP_PUBLIC_URL` no está
en `.env.example` (archivo suyo) — se señala, no se toca»*). Es la manera correcta de enrutar un hallazgo
de entorno y aquí queda cerrado por su dueño.

### 35.1 Qué se tocó (todo dentro de rutas de devops)

| Archivo | Cambio |
|---|---|
| `.env.example` | **Declarada `APP_PUBLIC_URL`** (bloque propio, pegado a `APP_BASE_URL`), + `STAGING_APP_PUBLIC_URL` en la sección de staging, + entrada en la topología `[RW]` de Railway de la cabecera. |
| `docker-compose.yml` | `APP_PUBLIC_URL` + **pass-through de correo** (`RESEND_API_KEY`, `MAIL_FROM`, `SUPPORT_EMAIL`) en el servicio `backend`. |
| `docker-compose.staging.yml` | `APP_PUBLIC_URL: ${STAGING_APP_PUBLIC_URL:-}` + `MAIL_FROM` + `SUPPORT_EMAIL`. |
| `scripts/stack-native.sh` | `export APP_PUBLIC_URL="${APP_PUBLIC_URL:-}"` junto al de `APP_BASE_URL`. |

**Ni una línea de `backend/` ni de `frontend/`.** Lo que sale de este pase y no es mío va enrutado en §35.4.

### 35.2 No es una variable nueva: es `APP_BASE_URL` **con otro nombre**

El encargo era explícito —*si ya existe algo equivalente, alinea en vez de crear una segunda*—, y existe.
`APP_BASE_URL` **ya es** «la URL pública del frontend con la que el backend arma los enlaces de los
correos». Tres consumidores lo demuestran, y **los tres usan su PRIMER origen**:

| Consumidor | Enlace que construye |
|---|---|
| `backend/src/modules/auth/auth.service.ts` → `buildFrontendLink()` | verificación de email / reset de contraseña |
| `backend/src/modules/orders/guest-order-mail.service.ts` → `buildTrackingUrl()` | seguimiento de pedido de invitado |
| `backend/src/main.ts` | allow-list de CORS (la **lista completa**, no solo el primero) |

`APP_PUBLIC_URL` (`buylist.service.ts` → `portalRequestUrl()`) es **la cuarta lectura de la misma URL**,
por un nombre distinto y por otra vía (`process.env` directo, no `ConfigService`). Como el nombre lo
elige el código y el código no es mío, **no puedo unificarlas desde infraestructura**; lo que sí puedo es
que **no puedan divergir por descuido**, y eso es lo que hace la declaración:

> **REGLA DE ALINEACIÓN (obligatoria, todos los entornos):**
> `APP_PUBLIC_URL` == **PRIMER origen** de `APP_BASE_URL`. Mismo esquema, mismo host, mismo puerto.
> En el switch del rebrand **P-21** (§25) **se cambian las dos a la vez, o ninguna.**

**La trampa que esta regla evita, y que no es teórica:** en producción `APP_BASE_URL` es una **lista
separada por comas** (§25), porque alimenta CORS. `portalRequestUrl()` **no parte por comas** — hace
`envOr(process.env.APP_PUBLIC_URL, '')` y concatena—, así que copiar la lista tal cual produce un href
`https://www.tcghunt.mx,https://tcghunt.mx/buylist/requests/…`: un botón roto en un correo de dinero.
El bloque de `.env.example` lo grita en mayúsculas.

**Enrutado a backend (consolidación real, no la hago yo):** `portalRequestUrl()` puede caer a
`APP_BASE_URL.split(',')[0].trim()` cuando `APP_PUBLIC_URL` esté ausente — exactamente el patrón que ya
usan `auth.service.ts` y `guest-order-mail.service.ts`. Con eso `APP_PUBLIC_URL` pasa de ser **una segunda
fuente de verdad** a un **override opcional**, y la divergencia deja de ser posible en vez de quedar
prohibida por comentario. Son dos líneas y **es de backend**.

### 35.3 Contrato de formato (de esto depende que el enlace se arme bien)

El backend hace, literalmente: `` `${base.replace(/\/+$/, '')}/buylist/requests/${sellRequestId}` ``.
De ahí salen las reglas — verificadas contra el código, no supuestas:

| Caso | Qué pasa | Veredicto |
|---|---|---|
| `https://www.tcghunt.mx` | href correcto | ✅ **forma canónica** |
| `https://www.tcghunt.mx/` (barra final) | el backend recorta `/+$` | ✅ tolerado (escríbela sin barra igual) |
| `www.tcghunt.mx` (**sin esquema**) | href **relativo** dentro del cliente de correo → no lleva a ningún sitio. El backend **no valida el esquema** | ⛔ |
| `https://a.mx,https://b.mx` (la lista de CORS) | `…,https://b.mx/buylist/requests/<id>` | ⛔ |
| `https://www.tcghunt.mx/es` (parche del locale) | el enlace sí resolvería… **congelando el idioma a ES** para todo vendedor, incluido el que tiene `locale=en` | ⛔ el locale es del path, no del origen |
| **ausente / vacía / solo espacios** | `envOr` trata blanco como ausente ⇒ `portalUrl: undefined` ⇒ **la plantilla degrada el botón a una instrucción de texto**. **NO** falla el arranque: no está en `required` de `env.validation.ts` | ⚠️ red de seguridad, **no** estado deseado |

### 35.4 ⛔ Por qué se declara **vacía**: el destino todavía no existe

Fijarla hoy **no enciende un enlace, enciende un 404**. Verificado en el árbol, no supuesto:

1. **No hay página de la solicitud.** Bajo `frontend/src/app/[locale]/` los únicos segmentos dinámicos son
   `catalog/[cardId]`, `orders/[orderId]`, `shipments/[id]` y `sellado/[inventoryItemId]`. **No existe
   `buylist/requests/[id]`.** El portal del vendedor vive hoy *dentro* de `/[locale]/buylist`
   (`MyRequestsSection.tsx`), que además **no lee ningún parámetro de URL**: no hay deep-link ni por query
   ni por ancla. `/buylist/requests/:id` es **una ruta de la API** (contrato §6), no una de pantalla.
2. **Falta el prefijo de idioma.** `frontend/src/i18n/routing.ts` corre con `localePrefix: 'always'`, así
   que el middleware redirige `/buylist/requests/<id>` → `/es/buylist/requests/<id>`… que tampoco existe.
   No hay `rewrites` en `next.config.mjs` ni catch-all que lo rescate.

*Un botón muerto es peor que una frase* — y **un botón a 404 es un botón muerto**. La degradación que
backend construyó es la conducta correcta mientras esto siga así, y por eso la variable queda **declarada,
documentada y cableada, pero sin valor**: activarla es cambiar una línea, no un deploy de infra.

| Hallazgo | Dueño | Qué falta exactamente |
|---|---|---|
| No existe la página del portal por solicitud | **frontend** | Ruta `/[locale]/buylist/requests/[id]` (o la que el arquitecto decida) que muestre la oferta y sus dos botones. |
| El path del CTA **no lleva `/{locale}`**, a diferencia de **todos** los demás enlaces de correo del proyecto (`auth`, `guest-order`) | **backend** (contrato: **arquitecto**) | Que `portalRequestUrl()` incluya el locale del usuario, o que se decida y escriba que el portal vive en una ruta sin prefijo. Hoy funciona por el redirect del middleware, que es **suerte, no diseño**. |

**Activación (3 pasos, el día que la ruta exista):**

```bash
# 1) COMPROBAR el destino. Si esto no da 200, NO fijes la variable.
curl -s -o /dev/null -w '%{http_code}\n' "https://<dominio>/es/buylist/requests/<id-real>"

# 2) Local / staging
APP_PUBLIC_URL=http://localhost:3000   ./scripts/stack-native.sh up      # nativo
STAGING_APP_PUBLIC_URL=http://localhost:3010 docker compose -f docker-compose.staging.yml --profile apps up -d

# 3) PROD — Railway > servicio backend > Variables (env de runtime, sin redeploy de código):
#    APP_PUBLIC_URL = PRIMER origen de APP_BASE_URL
#      pre-switch P-21 : https://www.tcgvaultmx.com
#      post-switch P-21: https://www.tcghunt.mx
```

**Verificación de que quedó bien (sin abrir un cliente de correo):** en local, `RESEND_API_KEY` vacía deja
`NoopMailAdapter`, que **loguea el correo en vez de enviarlo** — emite una oferta y busca el `href` en el
log del backend. Si en el log aparece la instrucción de texto en vez del botón, la variable no llegó.


### 35.4-bis La puerta se cruzó, y se cruzó MIDIÉNDOLA (2026-09-01)

`APP_PUBLIC_URL` quedó **declarada pero sin valor** porque el destino no existía. Ya existe:
`frontend/src/app/[locale]/(storefront)/buylist/requests/[id]/page.tsx`. La activación exigía un
200, no una inspección de directorios, así que se levantó el frontend y **se midió**, con **control
negativo** (sin él, un 200 no significa nada):

| Petición | Literal |
|---|---|
| `/buylist/requests/<id>` — **lo que arma el correo hoy** | **307** → `Location: /es/buylist/requests/<id>` |
| …siguiendo el redirect (`curl -L`) | **200** |
| `/es/buylist/requests/<id>` | **200** |
| `/en/buylist/requests/<id>` | **200** |
| `/es/buylist/requests-que-no-existe/<id>` ← **control negativo** | **404** |

**Veredicto: el CTA lleva a la pantalla correcta.** Variable activada en local
(`APP_PUBLIC_URL=http://localhost:3000`), en staging (`STAGING_APP_PUBLIC_URL=http://localhost:3010`)
y en los tres puntos de fontanería. **En PROD la fija el humano** (Railway > backend > Variables):
mientras no esté, el correo de producción sigue degradando a la instrucción de texto.

**Lo que sigue abierto y NO lo cierra esta activación (enrutado a backend, ya con corroboración
del propio frontend):** el correo arma el path **sin `/{locale}`**, así que el 307 del middleware
manda **siempre a `/es`** (`localeDetection:false`). Un vendedor con `locale=en` recibe el correo en
inglés y aterriza en la pantalla en español. El docblock de la pantalla nueva lo dice con todas las
letras: *«el path que el correo debe apuntar es `/{locale}/buylist/requests/{sellRequestId}`, con el
`locale` del `User`»*. El arreglo es añadir el locale en `portalRequestUrl()`, igual que
`buildFrontendLink()`. **No se parchea desde la env** poniendo `…/es`: eso congelaría el idioma para
todos. Un botón que funciona en el idioma equivocado es peor que uno correcto, pero mucho mejor que
ningún botón — por eso se activa ahora y el defecto queda abierto, no escondido.

> **Nota de por qué la medición fue solo del frontend.** El stack completo **no arranca** con el
> árbol de trabajo de hoy: `./scripts/stack-native.sh up` muere en el backend con
> `ReferenceError: Optional is not defined` en `backend/src/modules/pricing/pricing.controller.ts:181`.
> Es **trabajo en vuelo sin comitear** (BL-25, el `@Optional() @Inject(INVENTORY_PUBLISH_PORT)` nuevo;
> `HEAD` no lo tiene) y **no es mío**: `Optional` **sí** está importado en la línea 1, así que no es un
> import ausente sino cómo resuelve ese binding en runtime — el primer sospechoso es el ciclo de
> `require` que abre el import nuevo de `../inventory/inventory-publish.port`, la otra mitad del mismo
> cambio. **Enrutado a backend, no tocado.** La ruta del portal se verificó levantando solo el
> frontend, que es lo que respondía la pregunta.

### 35.5 La fontanería que faltaba (sin esto, declararla no habría servido de nada)

`environment:` en compose es una **allow-list explícita**: lo que no se nombra, **no entra al contenedor**.
`APP_PUBLIC_URL` no estaba nombrada en ningún sitio, así que **ponerla en `.env` no habría tenido ningún
efecto** y el síntoma habría sido «la declaré y el correo sigue sin botón». De paso, el mismo agujero
afectaba a **tres variables de correo** que este ciclo usa y que tampoco viajaban: `RESEND_API_KEY`,
`MAIL_FROM` y `SUPPORT_EMAIL` (esta última es la que decide el buzón que aparece en los correos del
buylist, cadena `SUPPORT_EMAIL` → `DISPUTE_EVIDENCE_CONTACT` → default de código).

Todos los defaults nuevos son **vacíos**, o sea **cero cambio de comportamiento**: `RESEND_API_KEY=""` es
falsy ⇒ `NoopMailAdapter` (idéntico a antes); `MAIL_FROM`/`SUPPORT_EMAIL`/`APP_PUBLIC_URL` vacías ⇒ `envOr`
las trata como ausentes ⇒ los mismos defaults de código de siempre.

> ⚠️ **Lo único que cambia de verdad:** si alguien tiene una `RESEND_API_KEY` **real** en su `.env`, el
> stack **local** ahora **sí enviará correos**. Es opt-in consciente (el `.env.example` la trae vacía), y
> es justo lo que hacía falta para probar de punta a punta los correos nuevos del ciclo.

Comprobado renderizando la configuración, no por lectura:

```bash
docker compose -f docker-compose.yml         --profile apps config | grep -E 'APP_PUBLIC_URL|MAIL_FROM|SUPPORT_EMAIL|RESEND'
docker compose -f docker-compose.staging.yml --profile apps config | grep -E 'APP_PUBLIC_URL|MAIL_FROM|SUPPORT_EMAIL|RESEND'
```

### 35.6 El resto del ciclo (correos, plazos en días hábiles, cola): **revisado — no falta ninguna variable más**

Se revisó qué necesita el ciclo de adquisición para funcionar de punta a punta. Resultado, con evidencia:

| Frente | Estado | Detalle |
|---|---|---|
| **Correo** (oferta, cancelación, recordatorio) | ✅ **Completo** | `RESEND_API_KEY` (obligatoria en no-local por `env.validation.ts`), `MAIL_FROM` (opcional, default en código) y `SUPPORT_EMAIL` (opcional, cadena de fallback) ya estaban declaradas; lo que faltaba era el **pass-through** de §35.5. |
| **Zona horaria** (`America/Mexico_City`) | ✅ **No necesita env, y es lo correcto** | `business-days.ts` y las plantillas usan `Intl` con `timeZone: 'America/Mexico_City'` **explícito**. No leen `process.env.TZ`. **Fijar un `TZ` en el contenedor no cambiaría ninguna fecha** — y por eso **no se añade**: una env que no hace nada es una env que alguien acabará creyendo que hace algo. La zona es parte de la definición del plazo (criterio 154), no configuración. |
| **Formato de fecha en español** | ⚠️ **Sin acción, riesgo residual anotado** | Las plantillas piden `es-MX` con `dateStyle:'full'`. Eso necesita **ICU completo** en el runtime; con `small-icu` las fechas del correo saldrían **en inglés** (no rompe, *miente*). `node:20-alpine` trae full-icu por defecto desde Node 13, pero **no lo pude verificar aquí: no hay demonio de Docker en este entorno** (`docker info` falla). No cablé un gate de build sobre una suposición. **Verificación de un renglón** cuando haya Docker: `docker run --rm node:20-alpine node -p "new Intl.DateTimeFormat('es-MX',{dateStyle:'full'}).format(new Date())"` → debe salir en español. Si saliera en inglés, es mío y se arregla en `Dockerfile.backend`. |
| **Barrido de plazos** (`buylist-sweep`) | ✅ **Ya cubierto** | Lo agenda el scheduler a `0 8 * * *` **UTC** = 02:00 CDMX. **Requiere `REDIS_URL`** — sin Redis **no se programa NINGÚN cron** (ya documentado en `.env.example` y §19). En Railway lo inyecta el add-on. **No hay env que declarar**: a diferencia de los crons de precios, este horario está **fijo en el código** (`scheduler.service.ts`). Si algún día hay que moverlo, hace falta que **backend** lo lea de una env; hoy no me consta que haga falta y **no invento la variable**. |
| **Trabajo de cola** | ✅ **Ya cubierto** | Mismo `REDIS_URL` + `REDIS_FAMILY` (§20, la trampa IPv6 de Railway). Nada nuevo para el buylist. |
| **Calendario de días hábiles** | ⚠️ **Ni env ni infra — pero SÍ operación** | `MX_HOLIDAYS` es una **tabla en código** (`backend/src/common/business-days.ts`) que cubre **2026–2030** y **falla ruidosamente** fuera de rango (`BusinessDaysCoverageError`), a propósito: degradar a «no hay festivos» **adelantaría vencimientos**. **Lo que verá devops** si nadie la extiende: el barrido **no expira nada** y loguea `error`. **Extenderla es de backend** (§35.7 lo deja como aviso con fecha, no como sorpresa). |

**En una línea: para este ciclo faltaba `APP_PUBLIC_URL` y su fontanería. Lo demás ya estaba.**

### 35.7 Dos avisos operativos que salen de esta revisión (ninguno bloquea)

1. **Vigilancia del calendario (2030).** Cuando se acerque el cierre de 2030, el síntoma será
   *«el barrido del buylist no expira ofertas y loguea `BusinessDaysCoverageError`»*. **No es un fallo de
   infraestructura**: es la tabla `MX_HOLIDAYS` sin extender. Queda escrito aquí para que quien esté de
   guardia no lo diagnostique desde cero. **Dueño: backend.**
2. **Envs que el backend lee y `.env.example` todavía no declara** (mías, **fuera de este ciclo**, todas
   **opcionales con default en código** — ninguna afecta al buylist): `GUEST_ORDER_SWEEP_CRON`,
   `SCHEDULER_SHUTDOWN_TIMEOUT_MS`, `CATALOG_REFRESH_VARIANTS_BATCH_DELAY_MS`,
   `POKEMONPRICETRACKER_PARTIAL_MIN_PRICE`, `POKEMONPRICETRACKER_GRADED_FIELD`,
   `POKEMONPRICETRACKER_GRADED_FORMAT`, `POKEMONPRICETRACKER_GRADED_MARKET_FORMAT`,
   `POKEMONPRICETRACKER_GRADED_EVIDENCE_FIELD`. Se listan **ahora que se detectaron** en vez de
   documentarlas de memoria en un pase que no es el suyo: son diales finos del proveedor de precios
   *graded* y merecen leerse una por una antes de escribir su default en la plantilla. **Dueño: devops
   (yo), en un pase de plantilla del stream de precios.**

### 35.8 Rollback

**No hay rollback de deploy que hacer aquí: no hay código nuevo, no hay migración y no hay servicio nuevo.**

| Escenario | Acción | Efecto |
|---|---|---|
| El CTA sale roto/al sitio equivocado en prod | **Borrar `APP_PUBLIC_URL`** en Railway (o dejarla vacía) y reiniciar el servicio | Vuelve la **instrucción de texto**. Es el estado seguro y **es el estado por defecto**. Sin migración, sin ventana, sin pérdida de nada. |
| El pass-through de correo molesta en local | Dejar `RESEND_API_KEY=` vacía en tu `.env` | `NoopMailAdapter`, exactamente como antes de este pase. |
| Hay que revertir el commit entero | `git revert` de este commit | Se pierde la declaración y el cableado; **el comportamiento de la app no cambia** (los defaults son vacíos y equivalen a la ausencia de las variables). |
---

## 36. BL-27 — el formateador rompía la revisión por diff. Mecanismo elegido: **bloquear la mezcla, no formatear el árbol** (2026-09-01)

**El encargo llegó con dos salidas y la elección era mía.** La elijo con datos medidos, no por gusto.

### 36.1 Lo que se midió antes de decidir (literal)

```
$ backend/node_modules/.bin/prettier --check "src/**/*.ts" "test/**/*.ts"
Code style issues found in 274 files.
```

| Medición | Literal |
|---|---|
| Archivos `.ts` en `backend/src` + `backend/test` | **418** |
| Archivos que prettier reformatearía | **274 (65 %)** |
| Líneas de ese reformateo (copia en scratchpad, `.prettierrc` del repo) | **+10.435 / −3.311 ≈ 13.746 líneas** |
| Cambio de comportamiento en esas 13.746 líneas | **ninguno** |

Y tres hechos sobre el formateador que cambian por completo la decisión:

1. **Nadie lo eligió.** `prettier` **no está en `devDependencies`**. Llega de rebote:
   `resend@4.8.0 → @react-email/render@1.1.2 → prettier@3.9.6`. **El formateador del proyecto es una
   dependencia transitiva del SDK de correo.** Un `npm update` de `resend` puede cambiar la versión
   del formateador y, con ella, el formato de todo el repositorio.
2. **`npm run lint` no lo corre, y no es un olvido.** `backend/.eslintrc.js` hace
   `extends: [..., 'prettier']` — `eslint-config-prettier` existe **para apagar** las reglas de
   formato de eslint. Lint y formato están desacoplados **a propósito**.
3. **El frontend no tiene prettier en absoluto**: ni dependencia, ni binario, ni `.prettierrc`. Un
   `npx prettier` ahí formatearía con los **defaults** (80 columnas, comillas dobles) — es decir,
   una reescritura del frontend entero con un estilo que nadie acordó. Solo `backend/.prettierrc`
   existe (`singleQuote`, `trailingComma: all`, `printWidth: 100`).

### 36.2 Por qué NO cableo el formateador (la opción A), hoy

Cablear `prettier --check` como gate exige **primero** un commit que formatee el árbol. Ese commit,
medido, es de **13.746 líneas en 274 archivos**. Y ahí está la ironía que decide el asunto:

> **El commit que arregla «los diffs no son revisables» sería, él mismo, un diff de 13.746 líneas
> imposible de revisar** — y aterrizaría **justo antes** de la fase de seguridad, cuyo valor entero
> está en revisar por diff, y **encima de dos agentes escribiendo ahora mismo** en `backend/` y
> `frontend/` (conflicto garantizado con todo lo que está en vuelo).

Súmese que **no sería un commit mío**: reformatear `backend/` y `frontend/` es escribir en rutas de
otros roles. Yo no puedo hacerlo y no debo pedirlo en caliente.

**No la descarto para siempre — la dejo costeada** (§36.5), que es lo que pedía el encargo: *saber el
tamaño antes de llegar al gate*.

### 36.3 Lo que SÍ cablé: la norma del arquitecto, ejecutable

> *Un diff no mezcla reformateo con lógica; si hay que reformatear, va en su propio commit sin un
> solo cambio de comportamiento.*

`scripts/check-format-mix.sh` + job **`format-mix`** en `.github/workflows/ci.yml` (dentro de
`ci-ok`, o sea **bloqueante**). **No es un gate de estilo**: no exige que el árbol esté formateado,
no reformatea nada y no opina sobre comillas. Responde a una sola pregunta por archivo modificado:

    ¿este cambio reformateó el archivo Y ADEMÁS cambió otra cosa?

**El algoritmo es exacto, sin umbrales ni heurísticas** (por eso no tiene falsos positivos):

| Situación del archivo | Decisión |
|---|---|
| En HEAD **no** es idéntico a su propia salida de prettier | **Se ignora** — nadie lo reformateó. Es el caso normal en este árbol. |
| En HEAD sí, y en BASE **también** lo era | **Se ignora** — ya estaba formateado de antes. |
| En HEAD sí, en BASE no ⇒ **este cambio lo reformateó**. Y `prettier(BASE) == HEAD` | **PASA** — el cambio es *exactamente* el reformateo. **Es el commit que la norma autoriza.** |
| Ídem, pero `prettier(BASE) != HEAD` | **FALLA** — reformateo **mezclado** con otra cosa. |

La versión de prettier va **clavada a 3.9.6** en el script. No es cosmético: si el comparador usara
«la última», su veredicto cambiaría solo, sin que nadie tocara nada.

### 36.4 Probado contra los cuatro casos, no solo contra el bueno

Repo git sintético, con un archivo sin formatear como los 274 reales:

| Caso | Esperado | Resultado |
|---|---|---|
| **1. El de BL-27**: `prettier --write` + cambiar `IVA = 0.16` → `0.08` | falla | **`rc=1`** — y lo dice donde importa: *«f.ts → **2 línea(s) de cambio real**»*. Ésa es exactamente la línea de dinero que se perdía entre el reformateo. |
| **2. Commit de SOLO formato** (la vía autorizada) | pasa | `rc=0`, «Reformateo LIMPIO (sin lógica mezclada) en 1 archivo(s)» |
| **3. SOLO lógica**, sin tocar formato | pasa | `rc=0` |
| **4. Re-indentar A MANO** (envolver un bloque en un `if`) — el falso positivo clásico | pasa | `rc=0` |

Y contra el repo **real** (`HEAD~5..HEAD`, 25 archivos evaluados, trabajo en vuelo de backend y
frontend): **`rc=0`, sin falso positivo**, en ~39 s. El coste en CI es de ese orden: dos pasadas de
prettier por archivo **modificado**, no por archivo del repo.

> Nota metodológica: el caso 1 **pasó en verde en el primer intento y era el test el que estaba mal**
> (el `sed` ya no casaba tras el reformateo, así que no cambiaba nada). Se corrigió el test, no el
> script. Un comparador que solo se prueba contra el caso que debe fallar no está probado.

### 36.5 Si algún día se quiere la opción A (formatear el árbol), así se hace y esto cuesta

Queda **propuesta y costeada, sin cablear**. Orden obligatorio — y el primer punto no es negociable:

1. **Ventana sin trabajo en vuelo.** Con agentes escribiendo, un reformateo de 274 archivos genera
   conflictos en todo lo abierto.
2. **`prettier` pasa a `devDependencies` con versión fija** (hoy es transitivo de `resend`: nadie
   controla su versión). **Es de backend**, y el frontend además tendría que **elegir su
   `.prettierrc`** — sin él, los defaults reescriben el frontend entero con otro estilo.
3. **Un commit por paquete, solo formato**: `style: formatear backend/ (sin cambios de comportamiento)`
   y su gemelo de frontend. Verificación de que no cambió comportamiento: **la suite completa en
   verde antes y después**, más el propio `format-mix` (que reconoce y aprueba el commit de solo
   formato — caso 2). El tamaño medido hoy: **274 archivos / ~13,7k líneas** solo en backend.
4. **Solo entonces** se puede endurecer `format-mix` a un `prettier --check` del árbol.

Mientras eso no ocurra, el estado correcto es el actual: **el árbol NO está formateado, y no pasa
nada**, porque lo que se protege no es el estilo — es la revisabilidad del diff.

### 36.6 Estado del gate de seguridad y del harness E2E (lo que pedía el encargo: el tamaño)

Revisado archivo por archivo. **Cableado ≠ corriendo**, y la diferencia es justo donde está el hueco.

| Pieza del DoD | Archivo | Estado real |
|---|---|---|
| **SAST en cada PR** | `security-sast.yml` (semgrep · gitleaks · npm-audit · trivy-fs · trivy-image → `sast-ok`) | ✅ **Cableado y corriendo** en `push` y `pull_request`. |
| **Harness E2E** | `e2e.yml` → `backend-e2e` (Postgres+Redis reales, **deploy-blocking**) + `frontend-e2e` (mock, **informativo** por decisión §24) | ✅ **Cableado.** El mock es soft-gate **a propósito**; el gate real de UI es `e2e-real.yml`. |
| **E2E contra stack real** | `e2e-real.yml` (nightly 08:00 UTC · `workflow_dispatch` · `workflow_call` desde deploy con `require_real_stripe: true`) | ⚠️ **Cableado, pero sin `STRIPE_TEST_SECRET_KEY` su preflight ABORTA** la ruta de promoción (hueco §32.7-1, del humano). | **⚠️ CORREGIDO 2026-09-10 → §51: las dos claves de prueba LLEVAN TRES DÍAS en los secrets; el nocturno `34477885121` corrió los flujos en REAL con `MONEY_SKIPPED` vacío. Lo que falta es `STRIPE_TEST_WEBHOOK_SECRET`, y ya no bloquea (§50.4).**
| **DAST contra staging que bloquea la promoción** | `deploy.yml` → `dast-release` (llama a `security-dast.yml`, stack efímero, `ref: github.sha`) con `promote-production-*` condicionado a `dast-release.outputs.blocking != 'true'` | ⚠️ **Actualizado 2026-09-11 (§56):** `dast-staging` (que apuntaba a `STAGING_BASE_URL`, secret inexistente, y nunca corrió) se retiró. Ahora `deploy.yml` dispara también en **push a `production`** y corre `dast-release` sobre el SHA publicado — en modo **`report_only`** (C2) hasta que seguridad lo suba a bloqueante. El deploy sigue siendo push-to-deploy nativo; el DAST corre **después**, sobre el mismo commit, no se interpone (decisión del dueño pendiente). |
| **DAST programado semanal** | `security-dast.yml` (lunes 06:00 UTC) | ⚠️ **CORREGIDO en el FICHERO (P-77, §44) — NO en el calendario** (corrección in situ 2026-09-11, §55.3/§56): antes era un no-op silencioso en `security-scheduled.yml` (comprobaba `STAGING_BASE_URL`, faltaba, `::notice::` y verde). El workflow nuevo levanta su propio stack efímero y **bloquea**, con autoprueba del candado, **pero hasta el 2026-09-11 el cron semanal no había corrido nunca**: los 6 runs históricos fueron todos por push a `devops/dast-p77`. Desde §56 corre además en cada push a `production` (`deploy.yml` → `dast-release`, `report_only`). |
| **Que los gates sean `required checks`** | Protección de rama en GitHub | ❓ **No verificable desde aquí** (no hay `gh` en este entorno). `ci-ok`, `sast-ok` y `e2e-ok` están **diseñados** como required checks, pero si nadie los marcó como tales en *Settings → Branches*, **no bloquean nada**. Comprobación del humano: `gh api repos/<org>/<repo>/branches/main/protection`. |

**Resumen honesto del tamaño:** no falta *construir* casi nada — **falta encender**. Dos secretos
(`STAGING_BASE_URL`, `STRIPE_TEST_*`) y una decisión sobre el camino de deploy: mientras el deploy
real sea push-to-deploy, el DAST de staging **no se interpone**, y el DoD pide que se interponga.
Eso último **no lo cierro yo solo**: o los deploys pasan por `deploy.yml`, o hay que mover el DAST
a un disparo post-deploy que bloquee la promoción. **Decisión del humano** (y del arquitecto si
cambia el flujo).

### 36.7 Rollback de BL-27

| Escenario | Acción |
|---|---|
| El comparador da un falso positivo y frena a alguien | Quitar `format-mix` de `needs`/condición de `ci-ok` en `ci.yml` (una línea): sigue corriendo e informando, deja de bloquear. |
| Se quiere retirar del todo | Borrar el job `format-mix` y `scripts/check-format-mix.sh`. **No deja rastro**: no toca el árbol, no formatea, no tiene estado. |
| Un caso legítimo que el algoritmo no contempla | Partir el commit en dos (formato / lógica) — que es, exactamente, lo que la norma pide. |

---

## 37. Stack nativo para el gate de QA del stream `buylist-inventory-workflow` — lo que arrancó, y el rojo que **no era del producto** (2026-09-02)

**Encargo:** QA no puede correr su gate sin un stack vivo y no tiene herramientas de escritura
(es intencional). Levantar la ruta nativa y decir **exactamente** qué puede correr y qué no.

**Regla que gobierna esta sección:** todo número de aquí está **medido** sobre el árbol limpio en
`claude/buylist-inventory-workflow-hdnls3` (commit `742ce51`). Donde no medí, lo digo.

### 37.1 Punto de partida (confirmado, no asumido)

| Hecho | Comprobación |
|---|---|
| No hay demonio de Docker | `/var/run/docker.sock`: *No such file or directory* ⇒ `docker-compose.yml` **no es una opción**; la ruta nativa es la única |
| Postgres instalado y **parado** | `pg_lsclusters` → `16 main 5432 down` |
| Redis instalado y **parado** | `redis-cli ping` → *Connection refused* |
| Sin `.env` en ninguna parte | solo `.env.example` |
| Puertos 3000/3099 libres | `ss -ltnp` sin coincidencias |
| `node_modules` presentes | backend 578 paquetes · frontend 447 |

### 37.2 `./scripts/stack-native.sh up --seed --gate` — **exit 0**, literales

```
▸ Postgres (16/main)          ✔ arriba.            (había un pid file rancio; el script lo purgó solo)
▸ Redis                       ✔ arriba.
▸ Rol y base de datos         ✔ rol 'tcg' ya existe.  ✔ base 'tcg_marketplace' ya existe (datos intactos).
▸ prisma migrate deploy       35 migrations found in prisma/migrations
                              No pending migrations to apply.
▸ Seed sintético              ✓ seed-e2e: dataset sintético cargado (determinista).
▸ Backend NestJS (:3099)      ✔ salud: {"status":"ok","uptime":6,"timestamp":"2026-09-02T04:33:17.395Z","db":"up","redis":"up"}
▸ next build                  ✔ build listo (NODE_ENV=production, sin aviso de NODE_ENV no estándar).
▸ Frontend (:3000)            ✔ arriba en http://localhost:3000 (modo build)
```

`status` tras el arranque: `postgres: accepting connections` · `redis: PONG` · `backend: 200 (:3099)` ·
`frontend: 200 (:3000)`.

**`DATABASE_URL` efectivo (contraseña enmascarada):**
`postgresql://tcg:****@localhost:5432/tcg_marketplace?schema=public`
Credencial de **desarrollo local**, la misma de `.env.example`. Aquí no hay ni se inventó ningún
secreto real.

**M-46 aplicada — verificada en la BD, no solo en el «no pending».** `migrate deploy` dijo *no
pending* porque la base **persistió de una sesión previa**; eso por sí solo no prueba nada, así que
se comprobó el registro **y** los objetos:

```
migration_name                                  | finished_at         | steps | rolled_back_at
20260901120000_m46_buylist_acquisition_cycle    | 2026-09-01 21:01:13 |     1 | (null)
```
`35 aplicadas · 0 pendientes-o-fallidas · 0 rolled_back` · `prisma migrate status` → *Database schema is up to date!*

Y sus objetos existen de verdad: los 3 enums (`BuyDecision{buy,skip}`,
`SellOfferState{pending_authorization,sent,cancelled}`, `SellRequestExpiryReason{no_offer,not_shipped}`),
los 5 índices (`SellRequest_offerState_idx`, `SellRequest_status_offerAcceptDeadlineAt_idx`,
`SellRequest_status_shipDeadlineAt_idx`, `SellRequest_guideCancellationPendingAt_idx`,
`SellRequestItem_offerDecision_idx`) y las columnas (`SellRequest.offerState`, `.offerAcceptDeadlineAt`,
`.shipDeadlineAt`, `.guideCancellationPendingAt`, `.closedAt`, `.expiredReason`, `SellRequestItem.offerDecision`).

**Backend vivo, con guards puestos** (no es un arnés recortado): `GET /api/v1/health` → 200 ·
`GET /api/v1/catalog/cards?limit=1` → 200 · `GET /api/v1/admin/orders` sin token → **401** ·
`SchedulerService: BullMQ operativo`.
Único aviso en el log: `pokemontcg.io … -> HTTP 403` (sin egress). **Esperado y money-safe**: deja los
precios STALE, no borra ni escribe $0.

### 37.3 El rojo de la suite de integración: **entorno, no producto** — y el footgun que casi me como

El encargo pedía el literal de `cd backend && npm run test:integration`. Es éste:

| # | Cómo se corrió | Resultado literal | Veredicto |
|---|---|---|---|
| A | `cd backend && npm run test:integration` (**literal**) | `Test Suites: 1 failed, 14 passed, 15 total` · `Tests: 5 failed, 178 passed, 183 total` · 31.7 s · **exit 1** | rojo de **entorno** |
| B | igual, con `DATABASE_URL` **exportada** | `15 passed, 15 total` · `183 passed, 183 total` · 26.3 s · **exit 0** | ✅ |
| C | 1ª versión de mi subcomando (**mal**: filtraba `NODE_ENV=development`) | `3 failed, 12 passed` · `25 failed, 158 passed` · **exit 1**, con **13 asertos fallando en `Received: 429`** | rojo **del arnés** |
| D | subcomando ya corregido (`NODE_ENV=test`) | `15 passed, 15 total` · `183 passed, 183 total` · 27.2 s · **exit 0** | ✅ |

**Por qué falla A.** Una sola suite, `seed-idempotency.e2e-spec.ts`, y con este literal:

```
PrismaClientInitializationError: error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:11
   |
10 |   provider = "postgresql"
11 |   url      = env("DATABASE_URL")
    at Object.<anonymous> (test/integration/seed-idempotency.e2e-spec.ts:42:5)
```

Las otras **14 sí** ven la BD porque arrancan el `AppModule`, y `ConfigModule.forRoot()`
(`app.module.ts:39`, **sin `envFilePath`** ⇒ default `<cwd>/.env`) carga `backend/.env` dentro de
`process.env` al importar el módulo. `seed-idempotency` es la **única** que no pasa por Nest: hace
`new PrismaClient()` a nivel de módulo, o sea **antes** de que nadie cargue el `.env`.
`test/integration/setup.ts` no tapa el hueco: para `DATABASE_URL` solo emite un `console.warn` (y no
podría poner default: no existe una BD «de mentira» válida). **Ese warn sale también en la corrida
verde** — es ruido conocido, no un síntoma.

**El footgun de C, que es el hallazgo que de verdad importa.** Mi primer subcomando reexportaba el
bloque de env de la cabecera del script, `NODE_ENV=development` incluido. `export` alcanza a todo
hijo y **jest solo pone `NODE_ENV=test` si nadie lo puso antes**, así que ese `development` ganaba.
De `src/config/test-env.ts:28` (`process.env.NODE_ENV === 'test'`) cuelgan dos piezas:

1. **`AppThrottlerGuard`** — login 5/min por IP (SEC-C1). Con `NODE_ENV≠test` el guard no se omite y
   la suite, que hace ~10 logins desde 127.0.0.1 en el mismo minuto, **se autoenvenena con 429**.
   Es exactamente el fallo de CI del 2026-08-18 que motivó `test-env.ts`.
2. **El scheduler BullMQ** — cada suite registraría los crons y un worker sobre la cola compartida
   `tcg-daily`, y el catch-up de `price-ingest` encola trabajo **real**: escrituras de fondo en la
   misma BD que se está midiendo.

O sea: sin `NODE_ENV=test` el arnés no solo pinta rojos falsos, **mide otra cosa**. Es el **mismo
footgun de §32.10** (el `NODE_ENV` exportado que rompía `next build`), en otro consumidor. Queda
cerrado por construcción y comentado en el propio script.

`PORT` no hace falta neutralizarlo: el harness hace `app.listen(0)` (`test/integration/helpers/e2e-app.ts:172`).

**Lo que cablé (todo en rutas de devops):**

| Archivo | Qué |
|---|---|
| `backend/.env` (**untracked**, `.gitignore`) | `DATABASE_URL`, `REDIS_URL`, `APP_BASE_URL`, `APP_PUBLIC_URL`, `JWT_*` de desarrollo. **Sin Stripe, sin Resend, sin S3, sin API keys de precios** — a propósito (§37.4). Con él, el comando literal pasa de 0 a **14/15 suites**. |
| `scripts/stack-native.sh` → `test:integration` | Exporta el mismo env que usa `up` **y fija `NODE_ENV=test`**. Comprueba que Postgres responda antes de correr. Da **15/15 · 183/183 · exit 0**. |
| `scripts/stack-native.sh` → `migrate deploy` | El mensaje decía «incluida M-41» **desde M-41 hasta M-46**. Ahora el nombre se deriva del árbol: un mensaje que envejece en silencio es peor que no tenerlo, porque se cita en veredictos. |
| `scripts/stack-native.sh` → `mask_url()` | Un solo sitio que enmascara la contraseña antes de imprimir una URL de conexión. |

### 37.4 Qué puede correr QA y qué no

**✅ Sí, ahora mismo, sin tocar nada:**

| Qué | Comando | Estado medido |
|---|---|---|
| Integración contra **BD real** | `./scripts/stack-native.sh test:integration` | **15/15 suites · 183/183 tests · exit 0** |
| Una spec suelta | `./scripts/stack-native.sh test:integration -t "<patrón>"` | pasa args a jest |
| Backend en vivo | `curl localhost:3099/api/v1/health` | `{"status":"ok",…,"db":"up","redis":"up"}` |
| Frontend horneado (mocks=**false**, API→:3099) | `http://localhost:3000/es` | 200, `next build` con `NODE_ENV=production` |
| Gate E2E real | `cd frontend && E2E_BASE_URL=http://localhost:3000 E2E_REAL=1 npm run test:e2e` | Chromium 141 en `/opt/pw-browsers/chromium` **verificado**; Playwright 1.56.0 |

**❌ No, y no es arreglable en esta máquina** (no son fallos del producto; **no los reporte como bugs**):

| Qué | Por qué | Síntoma esperado |
|---|---|---|
| Cobrar de verdad (checkout, guest-checkout, envíos) | **Sin egress a `api.stripe.com`** (CONNECT → 403) y sin `STRIPE_TEST_SECRET_KEY`. No se inventó ninguna clave. | 503 `PAYMENT_PROVIDER_UNAVAILABLE`, se libera la reserva (**money-safe**) | **⚠️ CORREGIDO 2026-09-10 → §51: las dos claves de prueba LLEVAN TRES DÍAS en los secrets; el nocturno `34477885121` corrió los flujos en REAL con `MONEY_SKIPPED` vacío. Lo que falta es `STRIPE_TEST_WEBHOOK_SECRET`, y ya no bloquea (§50.4).**
| Subir el INE del buylist (sobre el tope AML) | **No hay MinIO/R2** nativo; `uploads` no lo cubre esta ruta | el spec de infra lo **salta** con aviso |
| Correo real (Resend) | Sin `RESEND_API_KEY` ⇒ `NoopMailAdapter` (degradación de LOCAL_ENVS) | no sale correo; el flujo no se bloquea |
| Precios frescos de proveedor | Sin egress a `pokemontcg.io` / `tcgcsv.com` (403) | precios **STALE**; no borra, no escribe $0 |

**⚠️ Dos avisos operativos (ninguno bloquea):**

1. **La suite de integración ESCRIBE en la BD** (resiembra el fixture). Si después va el gate de
   Playwright, **vuelva a sembrar**: `./scripts/stack-native.sh up --seed --infra`. El subcomando lo
   avisa al empezar. Orden recomendado: **integración → re-seed → E2E**.
2. **Deriva cosmética de schema** (no bloquea, **no es mía**): `prisma migrate diff` reporta un único
   `ALTER INDEX "PriceReference_variant_capturedDate_key" RENAME TO
   "PriceReference_cardId_productType_gradeKey_finish_capturedD_key"`. Mismas columnas, misma
   unicidad: solo el **nombre** difiere entre `schema.prisma` y la BD. Efecto real: un
   `prisma migrate dev` querría generar una migración de rename. `backend/prisma/` es del rol
   **backend**; queda anotado, no tocado.

### 37.5 Apagado y rollback

| Escenario | Acción |
|---|---|
| Terminar la sesión, conservar datos | `./scripts/stack-native.sh down` (para backend y frontend; deja PG/Redis) |
| Apagar todo | `./scripts/stack-native.sh down --all` |
| BD envenenada por una corrida | `./scripts/stack-native.sh up --seed --infra` (el seed es **idempotente**: lo prueba `seed-idempotency.e2e-spec.ts`) |
| Revertir lo de esta sección | Borrar `backend/.env` y revertir `scripts/stack-native.sh`. Se pierde el 15/15 (vuelve a 14/15 por `DATABASE_URL`); **nada más**: no toca `backend/`, ni `frontend/`, ni migraciones, ni datos |
| El subcomando molesta | `cd backend && NODE_ENV=test DATABASE_URL=… npm run test:integration` hace lo mismo a mano |

---

## 38. SEC-OPS-1 — el gate auditaba un binario más viejo que el código auditado. Y la purga de los datos del PoC (2026-09-06, stream `claude/buylist-inventory-workflow-hdnls3`)

> **Regla que gobierna esta sección:** todo número de aquí está **medido** en esta máquina,
> contra el stack vivo y la BD local. Donde no medí, lo digo con esas palabras. Lo que
> queda pendiente de otro rol va nombrado con su rol.

### 38.0 El hallazgo, en una línea

Seguridad (pase v1.56, `SECURITY_NOTES.md` §9) reportó que **por segundo pase consecutivo** el
backend vivo era **más viejo que el commit a auditar**, y que las dos veces lo cazó una persona
mirando la **hora de un PID**:

| Pase | Backend vivo arrancó | Commit a auditar | Consecuencia |
|---|---|---|---|
| 2026-08-29 (SEC-M43-6) | 20:10 | `1f73654` de 21:34 | La 1ª corrida del PoC devolvió el default de la columna; **casi se firma un ALTO abierto que ya estaba cerrado** |
| 2026-09-06 (v1.56) | 15:04:03 | `3b2fc87` de 16:16:31 | El stack servía el código **vulnerable**; seguridad reinició (`down` + `up`, **sin `--seed`**) y remidió contra un proceso de 16:21:42 |

**Es mío y es de proceso, no de código.** Y lo peor no es el rojo falso: es el **verde falso**
simétrico — un stack viejo puede dar por buena una guarda que el binario no tiene, y entonces se
promueve a producción algo que nadie probó.

### 38.1 La causa, en cuatro líneas de `stack-native.sh`

No hubo misterio. `start_backend()` decía, literalmente:

```bash
if curl -sf "$BACKEND_HEALTH_URL"; then
  ok "ya respondía en :$BACKEND_PORT."
  return 0        # ← reutiliza SIN preguntar qué código está sirviendo
fi
```

El **frontend** ya tenía la guarda equivalente desde hace tiempo («NO REUTILIZAR UN SERVIDOR AJENO
EN MODO GATE», por el episodio de `reuseExistingServer` de §32.6). El backend no la tenía. La
asimetría es exactamente el agujero.

### 38.2 El mecanismo: `scripts/assert-serving-head.sh`

**Qué evidencia usa.** La única señal de procedencia que el proceso emite hoy es el `uptime` de
`GET /api/v1/health`, y **es `process.uptime()`** — verificado leyendo
`backend/src/modules/health/health.service.ts` (`uptime: Math.round(process.uptime())`), no
`os.uptime()`. De ahí sale el instante real de arranque del proceso que atiende el puerto:

```
arranque_vivo = ahora − uptime
```

Eso **no se puede falsificar con un fichero rancio**: si otro proceso tomó el puerto, su uptime no
cuadra. Comprobación en vivo contra el stack de esta máquina: el script dató el arranque en
**16:21:43**; seguridad había anotado a mano **16:21:42**. Un segundo de redondeo.

**Los cuatro asertos** (todos opcionales, se activan por bandera):

| # | Bandera | Qué afirma | De dónde sale |
|---|---|---|---|
| 1 | `--newer-than EPOCH` | el proceso nació **después** de EPOCH | proceso (`uptime`) |
| 2 | `--source RUTA` | ningún fichero de fuente es **más nuevo** que el proceso | proceso + `mtime` |
| 3 | `--stamp FICHERO` | el sello escrito al arrancar habla de **este** proceso | proceso + sello |
| 4 | `--sha` / HEAD | el commit sellado es el esperado | sello + `git rev-parse` |

El **aserto 2 es el que reproduce a máquina lo que seguridad vio a mano**: `ts-node --transpile-only`
compila **al arrancar** y Nest requiere el árbol entero en el boot, así que un fichero editado
después **no está** en lo que se sirve. No necesita ni sello ni git: sale del proceso.

**Lo que NO prueba, dicho de frente.** No hay prueba criptográfica de que el artefacto contenga el
SHA: **el backend no expone commit/version en `/health`** (medido: la respuesta es
`{status,uptime,timestamp,db,redis}` y nada más). La cadena es «arranqué X» + «el proceso vivo
nació de ese arranque» ⇒ «sirve X». Es sólida, no es una firma. El cierre definitivo está en §38.6
y **es del rol backend**.

**Matriz de prueba (medida, 7 casos + 1 detección real):**

| Caso | Resultado | Exit |
|---|---|---|
| sello coherente + fuentes viejas | ✔ pasa | 0 |
| SHA del sello ≠ HEAD | ⛔ «COMMIT DISTINTO» | 1 |
| sello de otro proceso (6000 s de desfase) | ⛔ «hay OTRO sirviendo el puerto» | 1 |
| fuente editado después del arranque | ⛔ lista los ficheros | 1 |
| `--newer-than` con proceso viejo | ⛔ «sirviendo el binario ANTERIOR» | 1 |
| `--newer-than` satisfecho | ✔ pasa | 0 |
| servicio caído | ✖ error de uso, no «obsoleto» | **2** |
| **detección real, en vivo** | ⛔ **cazó el caso de verdad** — ver abajo | 1 |

**La detección real.** Al cablearlo, el comprobador encontró **el mismo fallo, por tercera vez**,
esta vez sin que nadie lo buscara: el backend de `:3099` (arrancado 16:21:42) **no incluye**
`backend/src/modules/buylist/buylist.service.ts` ni `backend/src/common/sell-request-states.ts`,
que backend está editando ahora mismo para cerrar BL-35 eje 2. **Cualquier medición en vivo contra
`:3099` hecha después de esas ediciones y antes de un reinicio es inválida.** Aviso para **QA** y
**seguridad**: antes de la re-verificación de BL-35 eje 2, corran `verify:head` (§38.3).

### 38.3 Local — `stack-native.sh` ya no puede servir algo distinto del árbol

| Comando | Qué garantiza ahora |
|---|---|
| `./scripts/stack-native.sh up` | **No reutiliza** un backend vivo sin comprobar la procedencia. Si no sirve el árbol de ahora, **lo reinicia** (banner ruidoso) y **termina probándolo** con `verify_head` — `up` ya no *afirma* que está al día, lo *prueba*. |
| `./scripts/stack-native.sh verify:head [<sha>]` | **Solo lee.** Exit 1 ruidoso si lo vivo no es lo que se va a auditar. **Este es el comando que QA / seguridad / el pentester corren antes de su primera medición.** Con argumento: «quiero auditar exactamente `3b2fc87`». |
| `./scripts/stack-native.sh status` | Dice **qué commit sirve cada proceso** y desde cuándo. Sin sello ⇒ lo dice: «procedencia DESCONOCIDA». |

**Observabilidad.** El arranque ahora **imprime el commit que sirve** (`✔ sirviendo commit
7e56e374f42d …  · arrancado 16:21:42`) y deja un **sello** en `.native-stack/backend.stamp`:

```
sha=7e56e374f42d2d62a199a7145acfbde1c7ab0d04
started_at=1788711703
started_h=2026-09-06T16:21:43
dirty=16                       ← ficheros sin commitear al arrancar (HEAD no cuenta toda la historia)
pid=999
port=3099
db=postgresql://tcg:****@localhost:5432/tcg_marketplace?schema=public   ← ENMASCARADA
```

Dos decisiones que no son cosméticas:

- **El `started_at` del sello se deriva del proceso, no de mi reloj.** Se escribe *después* de que
  el servicio esté sano, con el `ahora − uptime` del propio proceso. Así el desfase sello↔proceso es
  **cero por construcción** y cualquier diferencia futura significa de verdad «hay otro proceso en
  el puerto», no «se me fue el reloj entre el `nohup` y el `node`».
- **Solo se reutiliza un backend que arrancó este script.** Uno levantado a mano no tiene sello ⇒
  procedencia desconocida ⇒ se reinicia. Eso cierra de paso el riesgo «commit correcto, **base
  equivocada**»: el sello registra a qué BD apuntaba.

**Si el puerto no se libera, el script se planta** (`die`) en vez de seguir: mientras haya un proceso
ajeno vivo, nadie puede afirmar qué se está midiendo, y ése es justo el estado que esto existe para
hacer imposible.

### 38.4 Reiniciar para auditar **no cuesta la evidencia** — y esto está medido

Seguridad reinició **deliberadamente sin `--seed`** para conservar las filas del PoC. Tenía razón, y
ahora es una propiedad del arnés en vez de un acto de memoria:

- `stop_backend_only()` **no** para Postgres, **no** para Redis, **no** siembra, **no** borra una
  fila. Reinicia procesos y nada más.
- **El único camino que toca datos es `--seed` EXPLÍCITO** — y sí es destructivo. **Medido en el
  código, no supuesto:** `backend/prisma/seed-e2e.ts:129` hace
  `prisma.sellRequest.deleteMany({ where: { userId: { in: ids } } })` sobre los usuarios
  deterministas del fixture. Y **dos de las tres filas de evidencia** (`b6e3b8e0…` y `1f151cea…`)
  cuelgan de `customer@e2e.local`, que **está** en ese conjunto.

> **Conclusión medible: `up --seed` habría destruido 2 de las 3 filas del PoC. `up` a secas no toca
> ninguna.** Por eso el reinicio automático de §38.3 nunca siembra, y `--seed` sigue siendo algo que
> se escribe a mano.

#### 38.4-bis — Y no era hipotético: **pasó, mientras escribía esta sección**

A las **17:14:09** del 2026-09-06 una resiembra borró **dos de las tres filas de evidencia**:
`b6e3b8e0…` (`SPEI-EJE2-NEVER-ARRIVED-001`) y `1f151cea…` (`QA-BL35-EJE2`), ambas de
`customer@e2e.local`. Sobrevivió `afc4ab63…` (`SPEI-DOUBLESPEND-777`), cuyo dueño es
`redteam.victim@e2e.local` — **que no está en el fixture**. Exactamente la predicción del párrafo
anterior, cumplida en menos de una hora.

**No fui yo, y lo puedo acotar:** todas mis operaciones sobre la BD fueron `ROLLBACK` y verifiqué las
3 filas intactas después de cada una. La cadena, con relojes:

| Hora | Hecho | Cómo lo sé |
|---|---|---|
| 17:13:49 | `backend/test/integration/buylist-cycle.e2e-spec.ts` modificado | `mtime` |
| 17:14:09 | fixture reescrito; desaparecen las 2 filas | `max(SellRequest.createdAt)` de `customer@e2e.local` y `max(AuditLog.createdAt)` |
| 17:14:08 | aparece `e2e3a3c5…` `SPEI-EJE2-REMEDIADA` | fila nueva de `customer@e2e.local` |
| — | ese spec llama a `seedE2E()` en su arranque (`:63`); **12** specs de integración lo hacen | `grep` |
| ahora | `jest` corriendo | `pgrep` |

Es una resiembra de una corrida de integración de **backend**, que es trabajo legítimo y esperable
(el propio `test:integration` de este script ya avisa: «esta suite ESCRIBE en la BD»). No es un
error de nadie: es que **la BD del fixture no es un sitio donde se pueda guardar evidencia de una
auditoría**, y hasta hoy nadie lo había dicho en voz alta.

**Lo que hice con lo que controlo.** `--seed` de este script ahora **se planta** si detecta filas con
marca de PoC: las lista, explica que el seed borra, y ofrece las tres salidas (no sembrar · purgar ·
`SEED_OVER_EVIDENCE=1` para hacerlo a propósito). **Cubre mi bandera, no las suites**: los 12 specs
llaman a `seedE2E()` directamente y eso es `backend/test/` — **rol backend**.

**Lo que NO es mío y hay que decidir** (va a **QA / seguridad / backend**, no lo cierro yo): si un
hallazgo abierto necesita evidencia reproducible, esa evidencia **no puede vivir solo en filas de la
BD compartida**. O se guarda el PoC como **spec** (que es lo que backend acaba de hacer:
`buylist.m5p-received-guard.spec.ts`, `SPEI-EJE2-REMEDIADA`), o se dumpea aparte antes de tocar el
fixture. **Recomendación de devops: la primera.** Un test que reproduce el hallazgo es evidencia que
ninguna resiembra puede borrar.

### 38.5 CI — dónde se cableó y dónde no

| Sitio | Qué se añadió | Por qué ahí |
|---|---|---|
| `.github/workflows/e2e-real.yml` | Marca de epoch **antes** de `docker compose up`, y gate `--newer-than` tras la salud del backend. Deja el commit medido en el *step summary*. | El riesgo aquí es menor (`up -d --build` ya reconstruye desde el checkout: la estrategia «reconstruir siempre») pero no nulo: un contenedor superviviente, un `--build` que falla y deja el anterior en pie, o un runner reutilizado dan el mismo verde falso. **Se comprueba en vez de suponerse.** |
| `.github/workflows/deploy.yml` | **Job nuevo `staging-serves-head`**, entre el deploy de staging y el DAST. `dast-staging` ahora **depende de él**. | **Éste era el agujero de verdad en CI.** `dast-staging` escanea `STAGING_BASE_URL`, un dominio **estable**; `needs:` garantizaba el **orden de los jobs**, no que el rollout hubiera **tomado efecto**. Si el rollout va lento —o falla y la plataforma deja en pie la revisión anterior— ZAP y nuclei escanean el binario **viejo**, y su verde promueve a prod un commit que **nadie escaneó**. Mismo fallo, mismo sentido peligroso. |
| `.github/workflows/ci.yml` | Job `provenance-gate` → `scripts/check-provenance-gate.sh`, y suma en `ci-ok`. | SEC-OPS-1 **ya se repitió dos veces**: el arreglo es fácil de borrar sin querer y su ausencia **no produce un rojo, produce un verde que no significa nada**. Guarda estática, barata, en el workflow que corre en **cada push y PR** — mismo criterio que `e2e-provider-guard` (§32.12). |
| `security-sast.yml` | **Nada, a propósito.** | Semgrep/gitleaks/trivy-fs/npm-audit son **estáticos sobre el checkout**: analizan el árbol, no un proceso. No hay binario vivo que pueda quedarse viejo. `trivy-image` construye la imagen en el propio job. **Aquí no hay nada que arreglar** y añadir un check sería teatro. |

**`STAGING_API_URL` (secret nuevo, lo debe cargar el humano).** Base del **backend** de staging con
`/api/v1` (p. ej. `https://api-staging.tcghunt.mx/api/v1`). Es lo que permite leer el `uptime`.
**No** se metió en `secrets-gate` para no romper pipelines ya configurados; en su lugar:

- sin ella y **sin promover a prod** → `::warning::` y el DAST queda marcado como **no citable**;
- sin ella y **promoviendo a prod** → **falla**. Un DAST que no sabe qué binario escaneó no puede
  ser la puerta de producción.

Documentada en `.env.example` (bloque `[GH]`).

**Estado honesto de lo cableado en CI: escrito y validado como YAML (los 6 workflows parsean y el
grafo de jobs es el esperado), NO ejecutado.** Aquí no hay demonio de Docker, ni secrets de deploy,
ni staging: `deploy.yml` sigue desactivado por defecto (§ cabecera del propio workflow). Lo que sí
se ejecutó y midió es todo lo local de §38.2–38.4 y `check-provenance-gate.sh`.

**La guarda se probó por mutación** (no basta con que dé verde hoy): quitándole a `start_backend()`
la llamada al comprobador → **rojo**; quitándole a `dast-staging` la dependencia de
`staging-serves-head` → **rojo**. La primera versión del propio check tenía un rango `awk` mal
puesto que lo daba por bueno mirando el fichero entero; se corrigió a mirar **el `needs:` del job**,
que era el enunciado.

### 38.6 Lo que queda abierto, y de quién es

| # | Qué | Rol dueño |
|---|---|---|
| **SEC-OPS-1-R1** | **`GET /api/v1/health` no devuelve el commit.** Con un campo `commit` (o `version`) en la respuesta, la procedencia pasa de «cadena de inferencias sólida» a **dato verificable en una petición**, y `--stamp` deja de hacer falta. Es `backend/src/modules/health/health.service.ts` + el DTO del contrato. **Petición, no exigencia**: lo de hoy funciona sin ello. | **backend** (+ **arquitecto** si toca el contrato) |
| **SEC-OPS-1-R2** | El frontend no tiene `/health` con `uptime`, así que su sello se apoya en el reloj del script y en que el pid siga vivo — **evidencia más débil**, y `verify:head` lo etiqueta como tal. En modo `dev` directamente no se puede fechar lo que sirve (recompila bajo demanda); por eso un gate es siempre `up --gate`. | **devops** (si algún día hace falta), **frontend** si expusiera un endpoint |

### 38.7 Purga de datos sintéticos — `scripts/purge-synthetic-poc-data.sh`

`ARCHITECTURE.md` §9 (fila BL-35) lo pide con estas palabras: «el pentester dejó filas sintéticas
doble-pagadas en la BD local — **purgar antes de cualquier snapshot**». QA lo levantó como MENOR-3.

> ⚠️ **NO SE HA CORRIDO. El mecanismo está listo; la ejecución la dispara el humano.** Estas filas
> son la **evidencia** de un hallazgo abierto (BL-35 eje 2) y **backend las puede necesitar** para su
> test de regresión. Por eso el modo por defecto **no borra**, y no hay ningún gancho que lo llame
> solo: `stack-native.sh` **no** lo invoca.

**Cómo se dispara:**

```bash
# 1) SOLO CONTAR (no simula ni borra)
./scripts/purge-synthetic-poc-data.sh --census

# 2) SIMULACRO — modo por defecto. Ejecuta el borrado DE VERDAD dentro de una
#    transacción y la DESHACE. Los números que imprime son los reales.
./scripts/purge-synthetic-poc-data.sh

# 3) BORRAR DE VERDAD — una transacción, con verificación de cierre dentro
./scripts/purge-synthetic-poc-data.sh --apply
```

> ⚠️ **La cohorte es DINÁMICA, no la lista congelada de tres ids de `SECURITY_NOTES` §10.** El script
> selecciona **por marca** (`speiReference` con prefijo `SPEI-DOUBLESPEND|SPEI-EJE2|QA-BL35|PENTEST-|
> POC-|REDTEAM-`) además de por los tres ids. Es deliberado: así **sigue siendo correcto** cuando
> aparecen filas de PoC nuevas. Y aparecen: mientras escribía esto salió `SPEI-EJE2-REMEDIADA`, la
> prueba del arreglo. **Corre `--census` antes de decidir; no te fíes de los números de abajo, que
> son una foto.**

**Foto de las 17:22** (dos censos distintos en una hora — ver §38.4-bis):

| Cohorte | 17:05 | 17:22 |
|---|---|---|
| usuarios `redteam.*@e2e.local` | 4 | 4 |
| `SellRequest` de PoC | **3** | **2** ← una resiembra se llevó 2 y backend creó 1 |
| `SellRequestItem` (cascada) | 6 | 5 |
| `AuditLog` del PoC | 23 | 23 |
| **simulacro, total borrado** | **36** | **35** |

Desglose del simulacro de las 17:22 (borra y deshace): `AuditLog` 23 · `SellRequest` 2 (+items en
cascada) · `KycProfile` 1 (CLABE/INE sintéticos de la víctima) · `Address` 1 · `AuthToken` 4 ·
`User` 4. Comprobado tras cada simulacro: las filas **siguen ahí**.

Las filas de dinero que se irían **a las 17:22**, tal como las devuelve el script:

```
afc4ab63-…  pagada  SPEI-DOUBLESPEND-777   paid 15:22:13  recv 15:21:36  redteam.victim@e2e.local
e2e3a3c5-…  pagada  SPEI-EJE2-REMEDIADA    paid 17:14:08  …             customer@e2e.local
```

Y las que **ya no están** porque una resiembra las borró a las 17:14 (§38.4-bis):
`b6e3b8e0…` (`SPEI-EJE2-NEVER-ARRIVED-001`) y `1f151cea…` (`QA-BL35-EJE2`). **Sus 17 filas de
`AuditLog` sobreviven** —`AuditLog` no tiene FK— lo que ilustra por qué la purga tiene que borrarlo
explícitamente: si no, el rastro del pago falso dura más que el pago falso.

**Decisiones de diseño que importan:**

- **`AuditLog` entra en la purga.** No tiene FK a `User` (verificado en `pg_constraint`), así que sin
  un borrado explícito **el libro de caja falso sobrevive a la purga de usuarios**. 23 filas, entre
  ellas **tres `sellrequest.pay_spei` sobre la misma solicitud** — el rastro del doble pago.
- **Las dos filas de `customer@e2e.local` se borran por MARCA (`speiReference`), nunca por usuario.**
  `customer@e2e.local` es fixture, no contaminación: borrarlo rompería el seed.
- **Orden de borrado dictado por los FK reales** (medidos, no supuestos): `Dispute`/`Order`/
  `SellRequest`/`ShipmentRequest` → `User` son **RESTRICT** ⇒ van antes; `SellRequestItem`,
  `OrderItem`, `OrderAccessToken`, `ShipmentItem` son **CASCADE**.
- **No usa la API, va por SQL.** Además de ser más rápido, esquiva un hecho que midió seguridad
  (`SECURITY_NOTES` §10): **los usuarios `redteam.*` no loguean** con el `*Pass123!` que documentó el
  pentester (el hash argon2 no casa; `INVALID_CREDENTIALS`, cuenta activa, sin lockout). Un script
  que dependiera de esas credenciales no funcionaría. Éste no las necesita.
- **Idempotente — medido, no prometido.** Ejecutando el bloque de borrado **dos veces dentro de una
  misma transacción**: pasada 1 → **36 filas**, pasada 2 → **0 filas**. Y el script lleva dentro una
  verificación de cierre que **aborta la transacción** si algo de la cohorte sobrevive (mismo
  criterio que el `down` del stack nativo: informar éxito por haber lanzado los `DELETE` no es
  informar éxito).
- **Se planta antes que corromper.** `RAISE EXCEPTION` (transacción abortada) si: un usuario redteam
  posee piezas de `InventoryItem` (el FK es **SET NULL** ⇒ borrarlo convertiría bóveda de un cliente
  en **stock de plataforma** en silencio); si alguna pieza apunta a items de las solicitudes a purgar
  (`InventoryItem.sourceSellRequestItemId` **no tiene FK** ⇒ quedaría colgando); o si la base **no
  contiene usuarios `@e2e.local`** ⇒ no es una base de fixtures y el script no pinta ahí. Hoy los tres
  contadores dan **0**, así que no bloquean.
- **Guardas de objetivo, probadas las tres:** host `db.railway.internal` → rechazado; base
  `produccion` → rechazada; `NODE_ENV=production` → rechazado. Lista **blanca** (no negra): solo
  `localhost`/`127.0.0.1`/`::1` y `tcg_marketplace{,_test,_e2e}`.
- **`lock_timeout=5s` / `statement_timeout=60s`:** si backend está escribiendo en esas filas, falla en
  segundos en vez de quedarse bloqueando su transacción.

**Nota aparte (no es del PoC, no se purga):** la BD local tiene **53** usuarios `@e2e.local`, de los
que ~45 son `new_<hash>@e2e.local` y `qa_*@e2e.local` — basura acumulada de corridas E2E, no cohorte
del pentest. Está **fuera del alcance** de este script a propósito. Si molesta para un snapshot, es
un `up --seed` (que sí los deja fuera del fixture) o una limpieza aparte que hay que diseñar.

### 38.8 Rollback de esta sección

| Escenario | Acción |
|---|---|
| Volver al comportamiento anterior de `up` | `git revert` del commit de esta sección. Se pierde la garantía de procedencia; **no** se pierde ningún dato ni cambia el arranque en lo demás. |
| El comprobador da un rojo que crees falso | No lo desactives: córrelo sin `--quiet`, imprime el bloque de procedencia entero y **contrasta** (`ps -o lstart -p <pid>` y `ls -l --time-style=full-iso` del fichero que señala). Si de verdad es falso, el bug es mío y va a `docs/TECH_DEBT.md`. |
| La guarda de CI estorba | Es un `if` de `ci-ok`. Si se quita, **que se diga en este documento y lo firme quien acepte el riesgo** de volver a auditar un binario viejo (§38.5). |
| La purga borró de más | **No hay marcha atrás**: es un `DELETE` commiteado. Por eso el modo por defecto es simulacro y hay que escribir `--apply`. Para volver a un fixture limpio: `./scripts/stack-native.sh up --seed`. |

### 38.9 Lo mío que sigue pendiente de antes (orden propuesto)

Ninguno bloquea el DoD de este stream; los ordeno por **coste de equivocarse**, no por esfuerzo:

1. **`SELECT` del censo humano del cut-over (paso 6 de §29)** — hoy vive solo como comentario en la
   migración. Es el que más pesa: sin él, el runbook de cut-over tiene un paso que **depende de que
   alguien escriba la consulta bien bajo presión**, y el cut-over mueve precios. **Primero éste.**
2. **Smoke de MinIO que se auto-salta con 403** — un test que se salta solo es un test que miente
   sobre su cobertura (misma familia que SEC-OPS-1: verde que no significa nada). Pero su alcance es
   la subida del INE, no dinero saliente, y **no es reparable en esta máquina** (sin Docker, sin
   MinIO): pide entorno. **Segundo.**
3. **SEC-OPS-1-R1** (commit en `/health`, §38.6) — es de **backend**, y lo de hoy funciona sin ello.

---

## 39. Los dos flujos que el arnés E2E no podía ejercitar (cobro y subida del INE), el rojo falso del gate de procedencia, y dónde está M-46 (2026-09-07, stream `claude/buylist-inventory-workflow-hdnls3`)

> **Encargo:** tres puntos de los gates de QA y techlead sobre el release del ciclo de compra
> (99 commits, pendiente de publicar). **No se commiteó nada** (lo hace el orquestador tras verificar)
> y **no se desplegó nada**.

### 39.0 Resumen en una tabla

| # | Qué estaba mal | Qué se hizo | Estado |
|---|---|---|---|
| 1 | Los 3 smokes de dinero mueren en el modal por `STRIPE_SECRET_KEY ausente`, y la ruta nativa **ni siquiera tenía cable** para pasar una clave si el humano la tuviera. | Paso a través de `STRIPE_TEST_*` → backend y bundle de Next; `up --gate` ahora **exige** la capacidad y sale **rojo** si falta. | Cableado y medido. La ruta sigue **SIN VERIFICAR** en esta máquina: no hay egress a Stripe. |
| 2 | Sin MinIO en la ruta nativa, `infra-smoke` se **auto-saltaba** el PUT presignado del INE (403/ECONNREFUSED → `warn` → `return`) y la suite salía verde. | Object storage S3 local (`scripts/s3-local/`) en la ruta nativa + `E2E_STRICT_INFRA=true` en local y en CI. | **CERRADO y medido**: el PUT del INE se ejecuta de verdad, y sin almacén la suite se pone roja. |
| 3 | El aserto 4 de `assert-serving-head.sh` comparaba **SHA de commit**: un commit de solo docs lo ponía rojo contra código idéntico. | Compara **además** el hash de árbol de `backend/`+`frontend/` y dice *«el commit cambió, el código no»*. | **CERRADO y medido** en los 4 casos (incluidos los tres que deben seguir en rojo). |
| 4 | `M46-D3`: dos normas vigentes se contradicen sobre `M-46`, y su disparador escrito es **este** cut-over. | Lectura del estado real en local + evidencia de repo sobre staging/prod. Consulta lista para prod, **pendiente de autorización**. | **Hecho lo medible.** Prod: **NO leído** (sin acceso). Ver §39.5. |

Ficheros tocados (todos de propiedad devops): `scripts/s3-local/` (nuevo), `scripts/e2e-capability-gate.sh`
(nuevo), `scripts/check-e2e-harness-gaps.sh` (nuevo), `scripts/stack-native.sh`,
`scripts/assert-serving-head.sh`, `.github/workflows/e2e.yml`, `.github/workflows/ci.yml`,
`.env.example`, este documento. **Cero cambios en `backend/` y `frontend/`.**

---

### 39.1 COBRO — la clave de Stripe: el cable que faltaba, y por qué ahora es rojo y no un aviso

**Lo que reportó QA** (subset `@real` contra el stack vivo): **35 pasaron, 3 fallaron**;
`checkout.spec.ts:57`, `guest-checkout.spec.ts:131` y `shipments.spec.ts:30`, los tres en el modal de
pago, con la causa en el log del backend: `STRIPE_SECRET_KEY ausente; usando sk_test_dummy`. Y su
veredicto: *«no son defecto de producto, pero tampoco los declaro verdes — la ruta de cobro con
tarjeta queda SIN VERIFICAR»*.

**El defecto de infraestructura que encontré al ir a arreglarlo, y que nadie había nombrado:**
`scripts/stack-native.sh` **no exportaba ninguna variable de Stripe**. Verificado con `grep -n STRIPE
scripts/stack-native.sh`: cuatro coincidencias, **las cuatro en comentarios**. Es decir: aunque el
humano tuviera una `sk_test_…` buena y la exportara en su shell, la ruta nativa **no se la pasaba al
backend**, y `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` tampoco llegaba al bundle de Next. La deuda no era
solo «falta la credencial»: era que **no había dónde ponerla**. Un hueco así no se cierra pidiendo la
clave, porque ponerla no habría cambiado nada.

**Lo implementado**

1. **Paso a través, nunca un literal.** `stack-native.sh` toma `STRIPE_TEST_SECRET_KEY`,
   `STRIPE_TEST_PUBLISHABLE_KEY` y `STRIPE_TEST_WEBHOOK_SECRET` **del entorno**, deriva
   `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` para el backend y
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` para el bundle. Si no están, **no se inventa nada**: quedan
   ausentes. En el repo solo vive el **nombre** (`.env.example`), nunca un valor — el repo es público.
2. **`scripts/e2e-capability-gate.sh` (nuevo).** Mide si el entorno **puede** ejercitar cobro, y exige
   las dos condiciones, porque cualquiera de las dos sola da el mismo rojo indistinguible:
   - **forma de las claves** — delegada en `scripts/stripe-test-key-preflight.sh`, que ya clasifica por
     longitud/alfabeto/vocabulario. Se **reutiliza** el clasificador existente en vez de escribir un
     segundo criterio: dos detectores del mismo hecho divergen, y el que se queda viejo es el que da el
     falso verde (§33 es exactamente esa historia).
   - **salida de red a `api.stripe.com`** — porque una clave buena sin egress muere igual en el modal.
3. **`up --gate` pasó de avisar a fallar.** Antes, el final de `up` imprimía tres `warn` («SIN MinIO…»,
   «falta STRIPE_TEST_SECRET_KEY…») y **salía 0**. Un aviso que no cambia el código de salida no gatea **⚠️ CORREGIDO 2026-09-10 → §51: las dos claves de prueba LLEVAN TRES DÍAS en los secrets; el nocturno `34477885121` corrió los flujos en REAL con `MONEY_SKIPPED` vacío. Lo que falta es `STRIPE_TEST_WEBHOOK_SECRET`, y ya no bloquea (§50.4).**
   nada: lo lee quien ya lo sabía. Ahora `up --gate` termina en **exit 1** con el veredicto, y **deja el
   stack arriba** — el rojo dice «esta corrida no puede ejercitar X», no «no tienes stack». `up` a secas
   (modo de trabajo) sigue saliendo 0 y solo **informa**.

**Por qué rojo y no «saltado», dicho de frente.** Porque ésta es la **segunda** release con la misma
deuda aceptada, y la observación del gate es correcta: *una deuda que se acepta cada vez deja de ser una
excepción y pasa a ser el estado normal*. Un flujo que el entorno no puede ejercitar queda **SIN
VERIFICAR**; «no aplica» es una categoría que aquí no existe.

**Lo medido** (`scripts/e2e-capability-gate.sh --require-all`, esta máquina, hoy):

```
  COBRO  (checkout · guest-checkout · shipments) : NO DISPONIBLE   [EXIGIDA]
  SUBIDA (uploads/presign · INE del buylist)     : DISPONIBLE      [EXIGIDA]
  ⛔ ESTE ENTORNO NO PUEDE EJERCITAR UN FLUJO QUE EL GATE EXIGE      → exit 1
```

Y el dispatcher, probado con las funciones caras (infra/backend/frontend) sustituidas por stubs:
`up --gate` → **exit 1** con el bloque «El stack está ARRIBA, pero NO es apto para una corrida de GATE»;
`up` sin bandera → **exit 0** con el informe.

**⚠️ Lo que sigue SIN VERIFICAR, y no lo arregla ningún script mío.** El egress a Stripe sigue
bloqueado en esta máquina — re-medido hoy:
`curl https://api.stripe.com/v1` → `curl: (56) CONNECT tunnel failed, response 403`.
Con clave o sin ella, **los tres smokes de dinero no pueden ponerse verdes aquí**. El gate de dinero
vive en CI (`e2e-real.yml`), y la promoción a producción ya lo exige: `deploy.yml` llama a
`e2e-real.yml` con `require_real_stripe: true` (verificado en el fichero, y ahora protegido por el
check estático de §39.3). Lo que hace falta del humano son **los dos secrets de GitHub** — §39.6.

---

### 39.2 SUBIDA — el smoke que se saltaba a sí mismo, y el interruptor que nadie había encendido

> **Actualización 2026-09-10 (§47):** el árbol de dependencias de `scripts/s3-local/` cambió — hay un
> `overrides` de `busboy` a `1.6.0` en su `package.json` para sacar `dicer@0.3.0` (CVE-2022-24434,
> HIGH, sin parche) del lockfile. **No cambia nada de lo que describe esta sección**: el round-trip
> presignado, la verificación SigV4 y la guarda anti-anónima se midieron antes y después y son
> idénticos. El detalle y las mediciones, en **§47.2**.

**El hueco, con su mecanismo exacto.** `backend/test/integration/infra-smoke.e2e-spec.ts` es quien cubre
`POST /uploads/presign` + el PUT real del objeto — o sea, **la subida del INE del buylist**
(`purpose: 'kyc_ine'`), que es la única subida del producto **y es PII**. El spec trae, desde siempre:

```ts
const STRICT = process.env.E2E_STRICT_INFRA === 'true';
…
if (status === 403 && !STRICT) { console.warn('[e2e] MinIO respondió 403 …'); return; }
```

Es decir: **la rama estricta ya existía** y el propio comentario del spec la recomendaba («recomendado
en el job E2E de CI con toda la infra»). **Nadie la encendió nunca.** Verificado con `grep -rn
E2E_STRICT_INFRA` sobre el repo entero: **cero asignaciones** — ni en `.github/workflows/`, ni en
`scripts/`, ni en `.env.example`. Y en la ruta nativa no había MinIO contra el que correr, así que el
`catch` de conexión se comía el fallo. Resultado: dos releases sin ejercitar la subida de PII, con la
corrida en verde.

**El contrafáctico, medido, que es la prueba de que el hueco era real.** Mismo spec, mismo commit,
misma infraestructura rota (object storage caído):

| Corrida | Resultado literal |
|---|---|
| `jest … infra-smoke` **sin** `E2E_STRICT_INFRA` | `Tests: 3 passed, 3 total` · **PASS** (el PUT se salta con `warn`) |
| `jest … infra-smoke` **con** `E2E_STRICT_INFRA=true` | `Tests: 1 failed, 2 passed` · **FAIL** (`connect ECONNREFUSED 127.0.0.1:9000`) |

Dos veredictos opuestos sobre el mismo entorno roto. Ése era el hueco entero.

**Lo implementado**

1. **Object storage en la ruta nativa** — `scripts/s3-local/` (nuevo). `start_infra()` levanta ahora
   Postgres, Redis **y** S3 en `:9000`, con el **mismo bucket y las mismas credenciales** que
   `.env.example` y `docker-compose.yml`, para que el arnés nativo y el de Docker no prueben
   configuraciones distintas sin que se note en ningún diff.
   > **Por qué no MinIO:** el binario no se puede traer a esta máquina —
   > `curl https://dl.min.io/server/minio/release/linux-amd64/minio` → `CONNECT tunnel failed, 403` — y
   > no hay demonio de Docker. El registro npm sí es alcanzable. Se usa `s3rver` 3.7.1 (implementación
   > S3 en Node, de uso común en tests) **con tres añadidos de devops** — ver §39.2.3, que es donde está
   > la parte que importa.
2. **`E2E_STRICT_INFRA=true` encendido en los dos sitios donde la infra existe**:
   `scripts/stack-native.sh test:integration` (que además **se planta** si no hay almacén, en vez de
   dejar que el spec descubra el problema a mitad) y el job `backend-e2e` de
   `.github/workflows/e2e.yml` (que ya tenía MinIO como *service* con bucket y credenciales que cuadran).
3. **`up --gate` exige la capacidad de subida** igual que la de cobro (§39.1).

**Lo medido, con el stack nativo de esta máquina**

```
▸ Object storage S3 (scripts/s3-local) en :9000
  ✔ arriba (bucket 'tcg-photos', datos en /home/user/tcg-vault-mx/.native-stack/s3)

./scripts/stack-native.sh test:integration -- --testPathPattern infra-smoke
  ✔ E2E_STRICT_INFRA=true: Redis y el PUT presignado del INE NO se pueden saltar.
  PASS test/integration/infra-smoke.e2e-spec.ts
    ✓ Postgres: consulta y secuencia de folios responden (OBLIGATORIO)
    ✓ Redis: responde PONG
    ✓ MinIO/S3: presign + PUT real de un objeto            (191 ms)
  Tests: 3 passed, 3 total
```

No es un 200 de mentira: los objetos **están en disco** (`find .native-stack/s3 -type f` → 21 ficheros
bajo `tcg-photos/kyc_ine/`, con su `_S3rver_object`, su `.md5` y su `_metadata.json`).

**Roto a propósito** (que es la única forma de saber que el candado es un candado):

| Rotura | Resultado |
|---|---|
| Apagar el object storage y correr la suite | `✖ E2E_STRICT_INFRA=true y NO hay object storage en :9000` · **exit 1** |
| Saltarse `stack-native.sh` y llamar a jest directo, sin almacén | `Tests: 1 failed` · `connect ECONNREFUSED 127.0.0.1:9000` |
| Arrancar el almacén con las guardas apagadas (`S3_LOCAL_ALLOW_ANON=1`) | el gate de capacidades lo caza: `✖ PUT presignado con secreto equivocado: ACEPTADO (200) — el almacén no verifica` |

#### 39.2.3 `s3-local` NO es MinIO — la ficha de fidelidad, sin adornos

Un stand-in que se presenta como equivalente y no lo es sería exactamente el problema que este pase
viene a cerrar. Lo que hace y lo que no:

| Propiedad | `s3-local` | MinIO / R2 |
|---|---|---|
| PUT/GET presignado (SigV4) | ✅ | ✅ |
| **Verifica el HMAC de la firma presignada** | ✅ **implementado por devops** (ver abajo) | ✅ |
| Rechaza peticiones **anónimas** (paridad bucket privado) | ✅ implementado por devops | ✅ (con `mc anonymous set none`) |
| Verifica la firma de peticiones con `Authorization:` (server-side) | ❌ solo comprueba el `accessKeyId` | ✅ |
| **Políticas de bucket** (probar que el bucket es privado *por política*) | ❌ **no** | ✅ |
| Versionado · lifecycle (`kyc_ine/` a N días) · multipart | ❌ | ✅ |

> **⚠️ La consecuencia operativa, dicha en claro:** este stand-in **no sirve para verificar que el
> bucket sea privado por política** (SEC-A5 / v1.2.1). Esa propiedad se sigue verificando **solo** en la
> ruta Docker/CI (servicio `createbuckets` con `mc anonymous set none` y la regla de lifecycle de
> `kyc_ine/`) y en R2 en producción. Que un `GET` anónimo dé 403 aquí es porque yo lo rechazo en el
> borde, **no** porque haya una política evaluándose.

**El añadido que más importa, y por qué existe.** `s3rver` **no verifica firmas SigV4**. No es una
sospecha: lo dice su propio código, literal, en `lib/middleware/authentication.js`:

```js
} else if (signature.version === 4) {
  // Signature version 4 calculation is unimplemeneted
  ctx.state.account = account;
```

**Medido antes de escribir una línea de este stand-in:** una URL presignada firmada con el **secreto
equivocado** devolvía **200**. Un almacén que acepta cualquier firma convierte el smoke de subida en
otro verde vacío — el mismo defecto que veníamos a cerrar, con otra cara. Así que
`scripts/s3-local/server.js` **implementa la verificación** (canonical request → string to sign → clave
derivada → HMAC, con `crypto`) para las peticiones presignadas, que son las que produce
`POST /uploads/presign`. Matriz medida contra el `@aws-sdk` real del backend:

| Caso | Resultado | Esperado |
|---|---|---|
| PUT presignado, secreto **correcto** | **200** | 200 |
| PUT presignado, secreto **equivocado** | **403** | 403 |
| GET presignado del objeto escrito | **200**, 8 bytes | 200 |
| GET **anónimo** al objeto | **403** | 403 (paridad bucket privado) |
| PUT **anónimo** | **403** | 403 |

La versión de `s3rver` va **clavada** (`3.7.1`, sin `^`) a propósito: el registro de credenciales usa
una API interna, y si un `npm update` la moviera, el arranque falla **ruidosamente** en vez de degradar
en silencio a otras credenciales.

---

### 39.3 El candado estático: `scripts/check-e2e-harness-gaps.sh` (nuevo, corre en CADA push/PR)

El arreglo de §39.1 y §39.2 son, en el fondo, **una variable en un YAML y una llamada en un script**:
justo el tipo de línea que alguien quita un martes porque el job estaba rojo. Y su ausencia **no produce
un rojo**: produce un verde que no significa nada. Mismo criterio, misma forma y mismo sitio que
`check-provenance-gate.sh` y `check-e2e-provider-incapacitation.sh`. Verifica seis puntos:

1. `scripts/e2e-capability-gate.sh` existe y es ejecutable.
2. `start_infra()` levanta object storage (`start_s3`).
3. `up --gate` llama al gate con `--require-all` (**exige**, no informa).
4. `test:integration` fija `E2E_STRICT_INFRA`.
5. `.github/workflows/e2e.yml` declara `E2E_STRICT_INFRA: "true"`.
6. `deploy.yml` promueve a prod con `require_real_stripe: true`.

Cableado en `ci.yml` como job `e2e-harness-gaps`, y añadido a `needs:` de `ci-ok` con la misma regla que
la guarda del proveedor de paga: **`skipped` no es verde** — un candado que se salta a sí mismo
desaparece igual que uno que se borra.

**Medido**: en verde sobre el árbol actual (6/6). Y **roto a propósito** sobre una copia: borrando
`E2E_STRICT_INFRA` de `e2e.yml` y poniendo `require_real_stripe: false` en `deploy.yml` → **2 rojos y
exit 1**, con el motivo escrito en cada uno. *(De hecho el check cazó un fallo mío mientras lo escribía:
el aserto 3 salió rojo la primera vez porque mi patrón no contemplaba la comilla de `"$SCRIPT_DIR/…"`.
Un check que nunca ha dado rojo no se ha probado.)*

---

### 39.4 El rojo FALSO del gate de procedencia: ahora sabe decir «el commit cambió, el código no»

**El hecho, medido en este repo.** El aserto 4 de `scripts/assert-serving-head.sh` comparaba **SHA de
commit** (`git rev-parse HEAD`). Entre `c6b999a` y `c132397` entraron **siete commits de solo
documentos**, y:

```
git rev-parse c6b999a:backend  == git rev-parse c132397:backend  == d7d7059f45f6…
git rev-parse c6b999a:frontend == git rev-parse c132397:frontend == cf46d16c26ee…
```

⇒ el gate se ponía **rojo** contra un stack que sirve código **byte a byte idéntico**. El propio pase de
seguridad lo sufrió: *«a mitad del pase el gate se puso en ROJO porque el arquitecto commiteó un commit
de solo docs y HEAD se movió bajo mis pies»*.

**Decisión: se toca el gate (opción A), no solo el runbook. Y la justificación es que el coste del rojo
falso NO es cosmético.** Falla en la dirección segura, sí — pero entrena el reflejo *«ya, es solo
docs»* delante de un aserto de procedencia, y ese reflejo es **exactamente** lo que SEC-OPS-1 existe
para matar. La segunda vez que alguien lo aplica sin mirar, se lo aplica a un commit que sí tocaba
código. **Un gate que cría el hábito de ignorarlo ya no es un gate.** Documentarlo en el runbook habría
dejado el hábito intacto y solo habría añadido una excusa por escrito.

**Cómo quedó.** Cuando los SHA difieren, se comparan los **hashes de árbol** de `backend/` y
`frontend/` (los dos directorios cuyo contenido es lo que los procesos ejecutan). Si coinciden: verde,
y se dice la frase con nombre y apellidos. `stack-native.sh` los guarda en el sello al arrancar
(`tree_backend=` / `tree_frontend=`); si el sello es viejo, se derivan del repo. Mismo criterio aplicado
al bloque de frontend de `verify_head`.

**⚠️ Condición no negociable:** la equivalencia **solo** se aplica con el árbol **limpio** al sellar
(`dirty=0`) y limpio ahora. Con ficheros sin commitear, el hash de árbol de un commit no describe lo que
se está sirviendo, y la comparación sería una coartada en vez de una prueba.

**⚠️ Lo que esta equivalencia NO cubre, dicho de frente:** solo mira `backend/` y `frontend/`. Un cambio
**fuera** de esos dos directorios que sí afecte al runtime (por ejemplo `scripts/stack-native.sh`, que
fija el entorno del proceso, o los `docker-compose*.yml`) pasaría por «solo cambió el commit». Es una
limitación **aceptada y declarada**: esos ficheros no los ejecuta el proceso servido, los ejecuta quien
lo levanta, y el aserto 2 (`--source`, mtime del fuente) sigue vigilando el árbol de código.

**Medido, los cuatro casos** (contra un `/health` de prueba y un clon **limpio** del repo):

| Caso | Sello → esperado | Veredicto |
|---|---|---|
| **1. Solo docs** | `c6b999a` → `c132397`, árboles idénticos, limpio | **VERDE** · *«✔ EL COMMIT CAMBIÓ, EL CÓDIGO NO»* + los dos hashes |
| **2. Código distinto** | `5852aa8` → `c6b999a` (`backend/` difiere) | **ROJO** · *«COMMIT DISTINTO **Y CÓDIGO DISTINTO**»*, con qué directorio difiere |
| **3. Árboles iguales, sello sucio** | `dirty=3` | **ROJO** · «el hash de árbol no describe lo que se compiló» |
| **4. SHA sellado inexistente** | `deadbeef…` | **ROJO** · «no pude comparar los árboles ⇒ se falla CERRADO» |

**Y mientras escribía esto, el caso 1 volvió a ocurrir solo — con dos commits nuevos de otros roles
sobre `main`, sin que yo los provocara.** Es el mejor dato del pase porque no lo fabriqué yo:

| commit | `backend/` | `frontend/` | qué es |
|---|---|---|---|
| `29f97e2` | `d7d7059f45f6…` | `cf46d16c26ee…` | `docs(orquestador): handoff del stream…` |
| `334b1e4` | `d7d7059f45f6…` **(igual)** | `cf46d16c26ee…` **(igual)** | `docs(ux-ui): …` ⇒ **el gate viejo daría ROJO; el nuevo dice VERDE** |
| `72b53d4` | `f00c6ead4158…` **(DISTINTO)** | `cf46d16c26ee…` | `fix(backend): …` ⇒ **rojo en los dos, y aquí el rojo SÍ significa algo** |

Un stack sellado en `29f97e2` sirve exactamente el mismo código que `334b1e4` y **no** el de `72b53d4`.
Ésa es justo la distinción que el aserto no sabía hacer y por la que se pusieron rojos pases enteros.

> **Defecto encontrado y corregido durante esta prueba, que merece quedar escrito:** el caso 4 daba rojo
> con el motivo **equivocado** («código distinto») porque `git rev-parse` **devuelve el argumento tal
> cual** cuando no lo puede resolver. Se arregló con `--verify --quiet`. Un gate que acierta el veredicto
> por accidente y miente en el porqué es el siguiente falso verde esperando su turno.

**Nota aparte, no pedida pero medida:** con el árbol de trabajo **sucio** —hoy lo está: 40 ficheros sin
commitear en `backend/`+`frontend/`— la equivalencia **no aplica** y el gate sigue en rojo. Es correcto y
deliberado. En una corrida de gate el árbol tiene que estar limpio.

---

### 39.5 M-46: dónde está aplicada de verdad (encargo 3) — hechos medidos, y la consulta que falta correr

`docs/TECH_DEBT.md` **M46-D3** registra que dos normas vigentes se contradicen sobre el mismo artefacto
(`ARCHITECTURE §11` ordena editar `M-46` en el sitio; `M46-D2` dice que ya está aplicada y que editarla
rompe el checksum), y su **disparador escrito es este cut-over**. *La contradicción normativa la cierra
el arquitecto; lo que sigue es el hecho, que es lo mío.*

#### (a) LOCAL — medido hoy, y **NO hay divergencia**

```sql
SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations
 WHERE migration_name = '20260901120000_m46_buylist_acquisition_cycle';
```

| dato | valor |
|---|---|
| `migration_name` | `20260901120000_m46_buylist_acquisition_cycle` |
| `checksum` en la BD | `db3341cf13002c2170fbd5670d902dc8829851f530a1334edb5c5ff0d4573792` |
| `sha256sum` del **fichero del árbol** | `db3341cf13002c2170fbd5670d902dc8829851f530a1334edb5c5ff0d4573792` → **idénticos** |
| `finished_at` | `2026-09-07 03:48:25 UTC` · `rolled_back_at` = NULL · `applied_steps_count` = 1 |
| columna `SellRequest.offerSentCancelledAt` | **existe** (`timestamp without time zone`) |

Lectura honesta: la BD local **ya no está divergente**. El `finished_at` de hoy (03:48) —frente al
`2026-09-01 21:01:13` que registra §37— dice que la base se recreó **después** de la quinta enmienda, así
que M-46 se aplicó **entera desde el fichero actual**. El checksum cuadra por construcción, no por un
`UPDATE` manual. En otras palabras: **este entorno se parece hoy a uno limpio.**

#### (b) STAGING — no hay `_prisma_migrations` que leer, y esto es un hecho de configuración

- «Staging» en este proyecto es `docker-compose.staging.yml` con volúmenes **propios y efímeros**
  (`postgres_staging`), y `e2e-real.yml` termina, en un paso `if: always()`, con
  `docker compose -f "$COMPOSE" --profile apps down -v` (línea 461) ⇒ **el volumen se borra en cada
  corrida**. Cada run arranca de cero y aplica las 36 migraciones del árbol.
- Además, **en esta máquina no hay demonio de Docker** (`/var/run/docker.sock` no existe), así que ni
  siquiera puedo levantarlo para mirar.
- Existe un staging **hospedado** *previsto* (`STAGING_BASE_URL` / `STAGING_API_URL` como secrets de
  GitHub, §13). **No tengo credenciales, ni nombre de host, ni evidencia en el repo de que esté
  provisionado.** No lo afirmo ni en un sentido ni en el otro: **no lo leí**.

#### (c) PRODUCCIÓN — no la leí. Pero el repo dice algo fuerte, y hay que separarlo del dato

**No tengo acceso**, medido: `curl https://tcg-vault-mx-production.up.railway.app/api/v1/health` →
`curl: (56) CONNECT tunnel failed, response 403`. No hay CLI de Railway, ni credencial, ni
`PROD_DB_READONLY_URL` en el entorno.

Lo que **sí** pude medir, del lado del artefacto (todo verificable con `git`):

| Hecho medido | Cómo se comprueba |
|---|---|
| M-46 entró al árbol el **2026-09-01** (commit `cc8416a`) | `git log --diff-filter=A -- backend/prisma/migrations/20260901120000_m46_*/migration.sql` |
| El **último run de `deploy.yml`** es el **#52**, del **2026-08-25**, sobre `0a07babc` — **anterior** a M-46 | API de Actions; ese árbol tiene 0 ficheros `m46` y su última migración es `20260824120000_m41_…` |
| Ese run **no desplegó nada**: `secrets-gate` en verde y los **8 jobs restantes SKIPPED** (`ci-ok`, `preflight`, `deploy-staging-*`, `e2e-real`, `dast-staging`, `promote-production-*`) | API de Actions, jobs del run #52 |
| La rama **`production`** (HEAD `18f279e`, *«release: … (main->production)»*, **2026-09-06**) tiene **35** migraciones y **NO** incluye M-46 — **sí** incluye `20260902120000_m47_set_images` | `git ls-tree -d --name-only 18f279e backend/prisma/migrations/` |
| `main` (`29f97e2`) tiene **36**: la diferencia es **exactamente** `20260901120000_m46_buylist_acquisition_cycle` | `diff` de los dos listados |

**Inferencia (marcada como tal, no como medición):** si producción se despliega desde la rama
`production` y Railway corre `migrate deploy` en cada deploy, entonces **M-46 nunca ha llegado a
producción**, y su `_prisma_migrations` no debería contenerla. **No lo doy por hecho:** los runbooks
§23/§26/§27/§28/§34 describen operaciones manuales contra producción, así que alguien pudo correr
`migrate deploy` a mano. **Eso solo lo contesta la BD.**

**Y hay un segundo hallazgo que sale de lo mismo, y que NO es mío de cerrar** (es del arquitecto y del
rol backend, lo aporto como hecho): producción tiene **M-47 (`20260902…`) aplicada y M-46 (`20260901…`)
no**. Cuando M-46 se publique entrará **fuera de orden cronológico**. `prisma migrate deploy` aplica lo
que no esté en `_prisma_migrations` sin exigir orden, y las dos tocan tablas distintas (`SellRequest` vs
imágenes de set), así que **no espero un fallo** — pero es una condición que nadie ha nombrado y que
conviene decidir antes, no descubrir durante.

**Lo bueno de todo esto para M46-D3:** si la BD confirma que producción **nunca** aplicó M-46, entonces
el modo de fallo que describe M46-D3 —`migrate deploy` diciendo *«up to date»* mientras la columna no
existe— **no puede darse en producción**: ahí M-46 se aplicará **entera y por primera vez**, con la
quinta enmienda incluida, y la columna `offerSentCancelledAt` nacerá bien. El riesgo queda acotado a
bases que ya la tenían aplicada **antes** de la edición. Si la BD lo desmiente, el cut-over cambia de
naturaleza y hay que parar. **Por eso hace falta el dato, y por eso no lo infiero.**

#### (d) 🔴 LA CONSULTA EXACTA PARA PRODUCCIÓN — **pendiente de autorización del humano**

**Solo lectura.** Ningún `INSERT`/`UPDATE`/`DELETE`/DDL. No la he corrido y no la voy a correr sin que
me lo autorices explícitamente. Usa un rol **`SELECT`-only** (`PROD_DB_READONLY_URL`, §31.6), nunca la
`DATABASE_URL` de la app.

```sql
-- TCG HUNT · lectura de estado de M-46 en PRODUCCIÓN. SOLO LECTURA.
-- 1) ¿Corrió M-46, con qué checksum, cuándo, y quedó revertida?
SELECT migration_name,
       checksum,
       started_at,
       finished_at,
       applied_steps_count,
       rolled_back_at
  FROM _prisma_migrations
 WHERE migration_name IN ('20260901120000_m46_buylist_acquisition_cycle',
                          '20260902120000_m47_set_images',
                          '20260829120000_m43_graded_estimate_kind')
 ORDER BY started_at;

-- 2) Censo: cuántas hay, cuál fue la última, y si alguna quedó a medias.
SELECT count(*)                                              AS total,
       count(*) FILTER (WHERE finished_at IS NULL)           AS sin_terminar,
       count(*) FILTER (WHERE rolled_back_at IS NOT NULL)    AS revertidas,
       max(migration_name)                                   AS ultima_por_nombre
  FROM _prisma_migrations;

-- 3) ¿Existen de verdad los objetos de M-46? (la BD manda sobre la tabla de control)
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'SellRequest'
   AND column_name IN ('offerSentCancelledAt','offerState','offerAcceptDeadlineAt',
                       'shipDeadlineAt','guideCancellationPendingAt','closedAt','expiredReason')
 ORDER BY column_name;
```

**Cómo leer el resultado, decidido de antemano para que no se interprete a conveniencia:**

| Lo que devuelva (1) | Significa | Qué hacer |
|---|---|---|
| **0 filas** para `…m46…` | M-46 nunca corrió en prod (lo esperado por (c)) | ✅ El cut-over la aplica **entera**: sin divergencia posible. Se publica con normalidad. |
| 1 fila con `checksum = db3341cf13002c2170fbd5670d902dc8829851f530a1334edb5c5ff0d4573792` | Corrió **con el fichero de HOY** (quinta enmienda incluida) | ✅ Consistente. Confirmar con (3) que `offerSentCancelledAt` existe. |
| 1 fila con **otro** `checksum` | 🔴 Corrió con una versión **anterior** del fichero ⇒ **es el escenario de M46-D3 en producción** | ⛔ **PARAR.** No publicar. `migrate deploy` dirá «up to date» y la columna puede no existir → `column does not exist` en runtime **sobre el ciclo de compra**. Escalar a arquitecto + backend. |
| `rolled_back_at` no nulo, o `finished_at` NULL | Quedó a medias | ⛔ Parar y escalar. |

**Y si (3) no devuelve `offerSentCancelledAt` mientras (1) dice que M-46 está aplicada, ése es el
escenario exacto que M46-D3 describe: la tabla de control MIENTE y hay que parar antes de desplegar.**

Para staging, la **misma** consulta contra `STAGING_API_URL`/su BD **si existe hospedado**; si lo único
que hay es el compose efímero, la respuesta correcta es *«no aplica: se recrea en cada corrida»* y así
queda escrito arriba.

---

### 39.6 Comandos: cómo se levanta, cómo se prueba y qué tiene que rellenar el humano

```bash
# 1) Infra nativa (Postgres + Redis + S3 local) — sin Docker
./scripts/stack-native.sh up --infra

# 2) Stack completo de TRABAJO (informe de capacidades, exit 0)
./scripts/stack-native.sh up --seed

# 3) Stack de GATE (exige cobro y subida; exit 1 si falta alguna, el stack queda arriba)
export STRIPE_TEST_SECRET_KEY=sk_test_…        # NUNCA en un fichero del repo
export STRIPE_TEST_PUBLISHABLE_KEY=pk_test_…
./scripts/stack-native.sh up --seed --gate

# 4) ¿Este entorno puede ejercitar cobro y subida? (solo mide, no corre la suite)
./scripts/e2e-capability-gate.sh                # informe
./scripts/e2e-capability-gate.sh --require-all  # modo gate

# 5) Integración del backend en modo ESTRICTO (el smoke de infra ya no se salta)
./scripts/stack-native.sh test:integration

# 6) ¿Sigue cableado el candado? (lo corre CI en cada push/PR)
./scripts/check-e2e-harness-gaps.sh
./scripts/check-provenance-gate.sh

# 7) Procedencia del stack vivo (SEC-OPS-1)
./scripts/stack-native.sh verify:head
```

**Lo que necesito del humano (nada de esto lo puede poner devops):**

| Qué | Dónde | Para qué |
|---|---|---|
| `STRIPE_TEST_SECRET_KEY` (`sk_test_…` o `rk_test_…`) | **GitHub Secrets** del repo | Enciende el gate de dinero en `e2e-real.yml`. Sin él, la promoción a prod es **roja** (`require_real_stripe: true`). |
| `STRIPE_TEST_PUBLISHABLE_KEY` (`pk_test_…`) | **GitHub Secrets** | Sin ella el modal no monta en el navegador aunque el backend cree la sesión. |
| *(opcional)* las dos anteriores **exportadas en la shell** | máquina con egress a `api.stripe.com` | Correr los 3 smokes de dinero en local. **En esta máquina no sirve**: egress bloqueado. |
| **Autorización para leer `_prisma_migrations` en PRODUCCIÓN** + una `PROD_DB_READONLY_URL` | tú | §39.5(d). Es el hecho que falta antes de publicar. |
| *(si existe)* `STAGING_API_URL` / acceso a la BD de staging hospedado | tú | Misma lectura en staging. |

---

### 39.7 Rollback de este pase

| Escenario | Acción |
|---|---|
| Volver al arnés anterior | `git revert` del commit de esta sección. Se pierden los dos candados y el object storage local; **no** se pierde ningún dato ni cambia el arranque en lo demás. |
| El gate de capacidades molesta en el día a día | Usa `up` **sin** `--gate`: informa y sale 0. `--gate` es el modo de gate y ahí el rojo es el producto, no un estorbo. |
| `E2E_STRICT_INFRA` bloquea una depuración | `E2E_STRICT_INFRA=false ./scripts/stack-native.sh test:integration` — explícito, visible en el historial del shell, y **nunca** en un gate. Si aparece en `.github/`, el check de §39.3 se pone rojo. |
| `s3-local` da un 403 que crees falso | Míralo en `.native-stack/s3.log`: cada rechazo se registra con el método, la ruta y el motivo. Recuerda que **403 al sondear la raíz es lo normal** (vivo y privado). |
| Hay que apagar el object storage | `./scripts/stack-native.sh down --all`. **No borra los objetos** (`.native-stack/s3`): apagar para auditar no puede costar la evidencia. |
| El hash de árbol deja pasar algo que no debía | Está acotado a `backend/`+`frontend/` y solo con árbol limpio (§39.4). Si aparece un caso real, es deuda mía y va a `docs/TECH_DEBT.md`; **no** se desactiva el aserto. |

### 39.8 Lo que NO verifiqué (dicho para que nadie lo cuente como verificado)

1. **Los 3 smokes de dinero en navegador.** Imposible aquí: sin egress a `api.stripe.com`. Siguen
   **SIN VERIFICAR**, como dijo QA. Lo único que cambió es que ahora **el arnés lo dice en su código de
   salida** en vez de dejarlo en un aviso.
2. **`E2E_STRICT_INFRA: "true"` corriendo en GitHub Actions.** No puedo lanzar Actions desde aquí. La
   configuración está verificada por lectura (el job `backend-e2e` tiene MinIO como *service*, bucket
   `tcg-photos` por `MINIO_DEFAULT_BUCKETS`, y `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` cuadran con
   `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`), y el efecto de la variable está medido **en local**. La
   primera corrida de CI es la prueba que falta.
3. **La ruta Docker completa** (`docker-compose.yml` / `docker-compose.staging.yml`): sin demonio de
   Docker en esta máquina. Sin cambios míos en esos ficheros.
4. **`_prisma_migrations` de staging hospedado y de producción.** No leídos. §39.5(b) y (c).
5. **`up --gate` de punta a punta** (con `next build` real). Probé el **dispatcher** con las funciones
   caras sustituidas por stubs, y el gate de capacidades por separado contra infra real. No relancé el
   stack completo: había otra sesión con un `up --seed --gate` vivo y reiniciarlo le habría costado su
   corrida.
6. **Un fallo del arnés que sí observé y no es mío:** hay un `stack-native.sh up --seed --gate` de las
   04:19 **colgado** en esta máquina. Al arreglar el arranque de `s3-local` encontré la causa probable y
   la dejé escrita en el código: `( cd X && nohup … & )` deja un subshell que **hereda el stdout del
   script**, así que un `stack-native.sh up | tail` nunca ve EOF. Mi `start_s3` usa `setsid` + las tres
   redirecciones y ya no lo hace; **las funciones `start_backend`/`start_frontend` conservan el patrón
   viejo** y no las toqué en este pase (fuera de encargo, y reescribir el arranque del backend mientras
   otra sesión lo está usando no es un cambio que se haga de paso). Queda anotado como candidato a
   `docs/TECH_DEBT.md` — dueño: devops.

---

## 40. Frenar el crecimiento del almacenamiento de Vercel — *Ignored Build Step* (2026-09-08)

> **Encargo acotado.** El almacenamiento del proyecto de Vercel iba al **75% de 10 GB**. Esta sección
> **detiene el crecimiento futuro**. **NO recupera un solo byte** de lo ya gastado — ver §40.7.

### 40.0 El diagnóstico (medido, no supuesto)

| Medición | Comando | Resultado |
|---|---|---|
| ¿Existe `vercel.json`? | `find . -name vercel.json -not -path '*/node_modules/*'` | **No existía** (ni en raíz ni en `frontend/`) antes de este pase |
| ¿Cuántas ramas hay en el remoto? | `git branch -r \| grep -v HEAD \| wc -l` | **46** |
| ¿Existen `main` y `production`? | `git branch -r \| grep -E 'origin/(main\|production)$'` | Sí, las dos |

Sin *Ignored Build Step*, Vercel construye una **vista previa por cada push a cualquiera de las 46
ramas** y **guarda esos deployments para siempre**. El dueño no sabía que existían y nadie las usa.
**Ése es el motor del crecimiento**, no el tamaño del bundle.

### 40.1 La palanca y su trampa: los códigos de salida están AL REVÉS

El *Ignored Build Step* es un comando que Vercel ejecuta **antes** de arrancar el build:

| Código de salida | Efecto |
|---|---|
| **`exit 0`** | **CANCELA** el build ("Ignoring the change") |
| **`exit 1`** (o distinto de 0) | **CONSTRUYE** ("Proceeding with deployment") |

**Verificado, no asumido.** No hubo egress a `vercel.com` desde esta sesión (el proxy deniega el
CONNECT con 403), así que la semántica se confirmó contra la **herramienta oficial de Vercel para
este mismo hueco**: el paquete npm `turbo-ignore` (publicado por Vercel, `2.10.12`), cuyo
`dist/cli.js` contiene literalmente:

```js
function _y(){ return $v(`⏭ Ignoring the change`),          process.exit(0) }
function vy(){ return $v(`✓ Proceeding with deployment`),   process.exit(1) }
```

El mismo binario confirma que **`VERCEL_GIT_COMMIT_REF` es la env var con el nombre de la rama**
(`... on branch "${process.env.VERCEL_GIT_COMMIT_REF}"`).

**Por qué importa el signo:** equivocarlo **no da error rojo en ningún sitio**. Simplemente deja de
construirse `main`/`production` y el sitio se queda **congelado en la versión vieja sin que nadie se
entere**. Por eso este pase no afirma el comportamiento: lo **demuestra** (§40.3).

### 40.2 El comando (fuente de verdad única)

```sh
case "${VERCEL_GIT_COMMIT_REF:-main}" in main|production) exit 1 ;; *) exit 0 ;; esac
```

Tres decisiones deliberadas:

1. **`:-main` es el fail-safe.** Si `VERCEL_GIT_COMMIT_REF` llega **vacía o ausente** (deploy manual
   por CLI, redeploy sin metadatos de Git, cambio futuro de Vercel), el `case` cae en `main` →
   `exit 1` → **construye**. Regla: *ante la duda, se construye*. Nunca dejar producción sin
   desplegar por una variable que no llegó.
2. **Es POSIX `sh` puro y va INLINE**, no llama a ningún script del repo. Motivo: el *Ignored Build
   Step* corre con el CWD en el **Root Directory** del proyecto (`frontend/`), así que una ruta
   `scripts/…` sería `../scripts/…` y se rompería el día que alguien cambie el Root Directory.
3. **Si el comando falla por lo que sea** (error de sintaxis, shell distinta) el shell sale con
   código ≠ 0 → **construye**. El modo de fallo también es seguro.

Vive, idéntico, en tres sitios (§40.6 explica por qué la duplicación es a propósito):

| Copia | Ruta | Estado |
|---|---|---|
| Versionada, raíz del repo | `vercel.json` → `ignoreCommand` | **Creada — pero INERTE hoy**, ver §40.4 |
| Versionada, lista para copiar a `frontend/` | `scripts/vercel.frontend-root.json` | Creada (artefacto de handoff, Vercel no la lee) |
| Ejecutable y probable en local | `scripts/vercel-ignore-build.sh` | Creada, con `--self-test` |

### 40.3 La demostración (salida real, 2026-09-08)

Leyendo el `ignoreCommand` **del `vercel.json` real** y ejecutándolo con `sh -c`:

```
$ CMD=$(node -e "process.stdout.write(require('./vercel.json').ignoreCommand)")

CASO (VERCEL_GIT_COMMIT_REF)               ESPERADO  REAL  VEREDICTO
main -> CONSTRUYE                          1         1     OK
production -> CONSTRUYE                    1         1     OK
claude/loquesea -> CANCELA                 0         0     OK
vacia -> CONSTRUYE (fail-safe)             1         1     OK
ausente -> CONSTRUYE (fail-safe)           1         1     OK
```

Y el script, que reproduce la misma tabla en un comando:

```
$ ./scripts/vercel-ignore-build.sh --self-test
CASO                                   ESPERADO REAL     VEREDICTO
main (construye)                       1        1        OK
production (construye)                 1        1        OK
claude/loquesea (CANCELA)              0        0        OK
var VACIA (construye: fail-safe)       1        1        OK
var AUSENTE (construye: fail-safe)     1        1        OK

SELF-TEST: verde. exit 0 = cancelar, exit 1 = construir.
```

**Repetir esta prueba es obligatorio** antes de tocar el campo del dashboard o de cambiar la lista
de ramas. Un `--self-test` en rojo significa: NO lo pongas en Vercel.

### 40.4 ⚠️ DÓNDE VIVE `vercel.json` — y por qué el de la raíz HOY NO HACE NADA

**El Root Directory del proyecto de Vercel es `frontend`.** Está medido y repetido en tres sitios de
este mismo documento: §6.1, §11.A (checklist `Settings > General > Root Directory = frontend`) y
§25.2. Consecuencia documentada de Vercel: **`vercel.json` se lee desde el Root Directory del
proyecto**, es decir, Vercel lee **`frontend/vercel.json`** y **ignora el `vercel.json` de la raíz
del repo**.

Por tanto, de las tres copias del §40.2, **ninguna está activa todavía**:

| Ubicación | ¿La lee Vercel hoy? | Quién puede escribirla |
|---|---|---|
| `vercel.json` (raíz del repo) | **NO** (Root Directory = `frontend`) | devops ✅ (hecho) |
| `frontend/vercel.json` | **SÍ — ésta es la que manda** | **rol frontend** (CLAUDE.md; devops NO escribe en `frontend/`, y §6.1/§25.2 ya lo dejaron sentado) |
| Dashboard → Ignored Build Step | **SÍ**, independiente del Root Directory | **HUMANO** |

**La opción segura ante las dos ubicaciones** es tener el **mismo `ignoreCommand` en las dos**: si el
Root Directory se cambia a la raíz, funciona el de la raíz; si sigue en `frontend`, funciona el de
`frontend/`. devops solo puede poner una de las dos. La otra queda en §40.8 como handoff.

**Mientras tanto, el freno NO está puesto.** Para pararlo HOY sin depender de ningún merge, §40.8-B.

### 40.5 Reversión en 30 segundos, y cómo forzar una vista previa

**Revertir (elige la que corresponda a la copia activa):**

| Copia activa | Cómo se revierte | Cuánto tarda |
|---|---|---|
| Dashboard | Vercel → proyecto → **Settings → Git → Ignored Build Step** → borrar el contenido del campo → **Save**. Vuelve el comportamiento por defecto (construir todo). | **~15 s, sin deploy, sin merge** |
| `frontend/vercel.json` | Borrar la clave `ignoreCommand` del archivo (o `git revert` del commit) y desplegar. | 1 merge + 1 build |
| `vercel.json` (raíz) | `git rm vercel.json` (hoy no cambia nada: es inerte, §40.4). | inmediato |

**Comprobación después de revertir o de cambiar la lista de ramas:** haz un push trivial a `main` y
confirma en Vercel que aparece un deployment nuevo. **No des por hecho que produce**: el modo de
fallo de esta configuración es silencioso.

**Cómo forzar una vista previa el día que alguien la quiera de verdad** (tres formas, de menos a más
invasiva):

1. **Redeploy manual desde el dashboard.** Vercel → **Deployments** → *Create Deployment* / *Redeploy*
   sobre el commit o rama que quieras. El *Ignored Build Step* **también se evalúa** en un redeploy,
   así que si la rama no está en la lista seguirá cancelando: usa la opción 2 o 3.
2. **Añadir la rama a la lista, temporalmente.** Es un cambio de una palabra en el `case`:
   `in main|production|mi-rama)`. Al terminar, quitarla. Recuerda que son **tres copias** (§40.2):
   cambia la que esté activa y deja las otras alineadas o el siguiente que las lea se confundirá.
3. **Vaciar el campo del dashboard** (§40.5, tabla de reversión) mientras dure la necesidad. Es lo más
   rápido, pero mientras esté vacío **vuelven a construirse las 46 ramas**: no lo dejes puesto.

> **La forma que NO funciona:** los marcadores de mensaje de commit (`[vercel deploy]`, `[skip ci]`…)
> son de `turbo-ignore`, **no** de este comando. Aquí no hacen nada.

### 40.6 Por qué la lógica está duplicada en tres sitios (y no es descuido)

Un script único sería más limpio, pero el *Ignored Build Step* corre con el CWD en el Root Directory
y sin garantía de qué hay alrededor: una referencia a `scripts/…` es una dependencia frágil justo en
el punto donde un fallo silencioso cuesta *no desplegar producción*. Se prefirió un one-liner
autocontenido, y el script del repo existe para poder **probarlo** (§40.3), no para ser invocado por
Vercel. **Coste aceptado:** al cambiar la lista de ramas hay que tocar las tres copias. Está avisado
en el encabezado de `scripts/vercel-ignore-build.sh` y aquí.

### 40.7 ⚠️ LO QUE ESTO **NO** HACE — los ~7,5 GB ya gastados siguen ahí

Esta configuración **evita builds nuevos**. **No borra nada.** El almacenamiento que ya consumen los
deployments históricos de las 46 ramas **solo lo libera el dueño** desde el panel de Vercel:

- Vercel → proyecto → **Deployments** → filtrar por rama / por estado → **Delete** en los deployments
  de vistas previas viejas (los de `main`/`production` **no** se tocan: el más reciente de producción
  es el que sirve el sitio, y los anteriores son el rollback instantáneo).
- Es una acción **[HUMANO]**, manual y no automatizable desde el repo.
- **Orden recomendado:** primero poner el freno (§40.8), luego borrar. Al revés, lo borrado se vuelve
  a llenar con el siguiente push.

**Dicho sin rodeos: esta cura no recupera un solo byte de lo ya gastado.**

### 40.8 Qué falta para que el freno esté REALMENTE puesto

**A) [FRONTEND] Crear `frontend/vercel.json`** — es la ruta del rol frontend (CLAUDE.md), devops no
escribe ahí. Contenido exacto, ya generado en `scripts/vercel.frontend-root.json`:

```json
{
  "ignoreCommand": "case \"${VERCEL_GIT_COMMIT_REF:-main}\" in main|production) exit 1 ;; *) exit 0 ;; esac"
}
```

Copia sin transcribir a mano (una sola línea, y así no se cuela una comilla):

```sh
cp scripts/vercel.frontend-root.json frontend/vercel.json
```

Si `frontend/vercel.json` ya existiera con otras claves, **se añade `ignoreCommand` como clave más**;
no se sustituye el archivo. Notas para frontend:
- El `$` de `${VERCEL_GIT_COMMIT_REF:-main}` lo expande **la shell en Vercel**, no el JSON: déjalo tal cual.
- **No** lo conviertas en `"ignoreCommand": "bash ../scripts/vercel-ignore-build.sh"` — ver §40.6.
- En cuanto se mergee y despliegue, **queda activo**.

**B) [HUMANO — 1 minuto, y es lo que para el sangrado HOY]** Vercel → proyecto → **Settings → Git →
Ignored Build Step** → seleccionar *Custom* y pegar **exactamente**:

```
case "${VERCEL_GIT_COMMIT_REF:-main}" in main|production) exit 1 ;; *) exit 0 ;; esac
```

Funciona **independientemente del Root Directory** y **sin merge ni deploy**. Si más adelante se
mergea (A), el `ignoreCommand` del `vercel.json` **tiene precedencia** sobre el campo del dashboard;
como los dos dicen lo mismo, no hay conflicto observable.

**Verificación después de (A) o (B):** push trivial a una rama cualquiera → en Vercel el deployment
debe aparecer como **Canceled** con el motivo del *Ignored Build Step*. Después, push trivial a
`main` → debe **construir**. **Haz las dos comprobaciones, en ese orden.** La segunda es la que
protege producción.

### 40.9 Lo que NO verifiqué (dicho para que nadie lo cuente como verificado)

1. **La documentación oficial de Vercel, de primera mano.** `vercel.com` está bloqueado por política
   de egress en esta sesión (`403` al CONNECT). La semántica de `exit 0`/`exit 1` y el nombre
   `VERCEL_GIT_COMMIT_REF` se confirmaron contra el **código publicado por Vercel** en npm
   (`turbo-ignore@2.10.12`), que es evidencia de primera mano del comportamiento, no de la redacción
   del doc. La regla de "`vercel.json` se lee desde el Root Directory" **no** pude confirmarla contra
   una fuente descargable en esta sesión: se apoya en §6.1/§11.A/§25.2 de este mismo documento, que
   ya la daban por establecida. **Por eso §40.8 propone la opción segura ante las dos ubicaciones.**
2. **El comportamiento real en Vercel.** No hay token ni egress: no se lanzó ningún deployment desde
   aquí. Lo demostrado es el **comando**, en local, con `sh` (§40.3). La primera corrida en Vercel
   es la prueba que falta, y por eso §40.8 termina con dos comprobaciones obligatorias.
3. **Cuánto almacenamiento libera borrar los deployments viejos.** No tengo acceso al panel; el
   ~75% de 10 GB es el dato que dio el dueño.

---

## 41. `npm audit` por calendario y el gate rojo de `backend/` — S-PROC-1 y S-DEP-1 (2026-09-09, cierre de release)

Seguridad aprobó el release **con condiciones**. Dos son de devops y están tratadas aquí:

- **S-DEP-1** — el gate propio del repo estaba en **rojo** sobre el candidato (`backend/`: 4 moderadas + 2 **altas**).
- **S-PROC-1** — la lección de proceso del hallazgo anterior (*«`npm audit` se verifica por delta de
  código, hay que verificarlo por calendario»*) **no había quedado enrutada**: el cron semanal era
  solo DAST.

### 41.1 La medición de S-DEP-1 (antes de decidir nada)

`npm audit --omit=dev` en `backend/` — **6 vulnerabilidades: 4 moderadas, 2 altas**, idéntico a lo
que reportó seguridad:

| Paquete | Sev | Rango vulnerable | Directo | Fix que ofrece npm |
|---|---|---|---|---|
| `@nestjs/platform-express` | **high** | `*` | sí | `12.0.1` — **semver MAJOR** |
| `multer` | **high** | `<=2.2.0` | no | vía `@nestjs/platform-express@12.0.1` — **MAJOR** |
| `@nestjs/core` | moderate | `<=11.1.17` | sí | `12.0.1` — **MAJOR** |
| `qs` | moderate | `2.2.5 - 6.15.3` | no | vía platform-express — **MAJOR** |
| `express` | moderate | `4.22.2` | no | vía platform-express — **MAJOR** |
| `body-parser` | moderate | `1.20.5 - 1.20.6` | no | no-major |

Y el gate del repo, en rojo (`exit=1`):

```
✗ backend/: vulnerabilidades >= high detectadas.
✓ frontend/: sin vulnerabilidades >= high.
✗ npm audit encontró vulnerabilidades que bloquean el gate.
```

`frontend/` en **0**: el bump del pase anterior aguantó.

### 41.2 ¿Es alcanzable el vector de `multer`? **No.** (verificado, no asumido)

Las 4 advisories de `multer` son DoS/bypass **en el parseo de multipart**. Para que se ejecute una
sola línea de multer, Nest tiene que registrar un `FileInterceptor`. Comprobado en `backend/`:

- `FileInterceptor` / `FilesInterceptor` / `FileFieldsInterceptor` / `AnyFilesInterceptor` /
  `@UploadedFile` / `@UploadedFiles` / `MulterModule` / `import 'multer'` → **cero coincidencias** en `src/`.
- Sin interceptores globales (`APP_INTERCEPTOR` / `useGlobalInterceptors`): **ninguno**.
- `main.ts` solo registra `helmet()` y `json()` (más el `json({verify})` del webhook de Stripe para el
  `rawBody`). **Ningún parser multipart.**
- Las subidas van por **URL prefirmada**: `POST /uploads/presign` devuelve la firma y el cliente hace
  `PUT` directo a R2. El binario **nunca** pasa por el backend.

⚠️ **Trampa documentada:** `grep -r multipart backend/` **sí** devuelve resultados
(`master-set-multipart`, `catalog.multipart.spec.ts`, `master-set.multipart.spec.ts`). Es el concepto
de dominio *"master set repartido en varias partes"*, **no** HTTP multipart. Quien repita esta
verificación en el futuro no debe contarlos como uso de multer.

**Conclusión:** vector **no alcanzable**. Se confirma la hipótesis de seguridad.

### 41.3 La decisión: **(a) actualizar**, y no hizo falta ni tocar `package.json`

El dato que cambió la decisión: `multer` **no es dependencia directa** — ya está en `overrides` de
`backend/package.json`, pinneado a `^2.2.0`. Y el registro publica **`multer@2.3.0`**, que **ya cae
dentro de ese `^2.2.0`**. Lo mismo con `qs@6.16.0` (override `^6.15.3`) y `body-parser@1.20.8`
(override `^1.20.6`). **El `package.json` ya permitía las versiones sanas; lo que estaba viejo era el
lockfile.**

Verificado sobre una copia en scratchpad (sin tocar `backend/`), con `--package-lock-only`:

| Variante | `package.json` | Resultado `--omit=dev` | Gate |
|---|---|---|---|
| Hoy | — | 4 mod + **2 high** | `exit=1` ❌ |
| `npm update multer` | **sin cambios** | 5 mod + **0 high** | `exit=0` ✅ |
| `npm update multer qs body-parser` | **sin cambios** | 2 mod + **0 high** | `exit=0` ✅ |

**Recomendado a backend: la variante mínima (`npm update multer`).** Deja el gate en verde tocando
únicamente un paquete que **no se ejecuta en ninguna ruta** (§41.2) — riesgo funcional literalmente
nulo, que es lo que se quiere en congelación de release. `qs`/`body-parser` sí están en el camino
caliente de cada request (query string y cuerpo JSON): son moderadas, **no bloquean el gate**, y
subirlas exige corrida de tests. Van fuera del release.

**Por qué se descarta (b), registrar la excepción en `TECH_DEBT.md`:** la excepción se justifica
cuando el arreglo no existe o cuesta más que el riesgo. Aquí el arreglo es un `npm update` de un
paquete muerto, dentro de rangos que `package.json` **ya autoriza**, sin cambio de API y sin major.
Registrar deuda por algo que se cierra con un comando es convertir el registro de deuda en un
basurero: la próxima vez que alguien lea esa ficha no sabrá si es "imposible" o "nadie lo intentó".
La excepción se reserva para las **2 moderadas de `@nestjs/core`/`platform-express`** (GHSA-36xv-jgw5-4q75),
cuyo único fix **sí** es Nest 12 (major) — esas no bloquean el gate y no se tocan en este release.

**Y lo que no se hizo: silenciar el gate.** No se bajó `AUDIT_LEVEL`, no se añadió `continue-on-error`
al job de `npm audit` del PR, no se metió nada en `.trivyignore`. El umbral del gate por PR sigue
siendo `high` y sigue siendo required check.

### 41.4 Lo que le toca a **backend** (devops no edita `backend/package.json`)

```bash
cd backend
npm update multer          # -> multer 2.3.0; NO modifica package.json, solo package-lock.json
npm audit --omit=dev       # esperado: 5 moderate, 0 high
npm test                   # sanidad; multer no está en ninguna ruta, no debería moverse nada
```

Commitear **solo** `backend/package-lock.json`. Si `package.json` cambia, algo salió mal: parar.

### 41.5 S-PROC-1 — `npm audit` semanal en `security-scheduled.yml`

**El diagnóstico:** `npm audit` corría **únicamente** en `security-sast.yml`, que dispara por
`push`/`pull_request`. Es un chequeo **por delta de código**. Pero una dependencia no se vuelve
vulnerable cuando editamos código, sino cuando **se publica el advisory** — evento externo, en el
calendario de otros. Con solo el gate por PR, un repo en congelación de release (el momento de
máximo riesgo) **no dispara nada**. S-DEP-1 fue exactamente ese caso, y lo detectó una persona a
mano, no el pipeline.

**Lo hecho:** nuevo job `deps-audit` en `.github/workflows/security-scheduled.yml`, mismo cron
semanal (lunes 06:00 UTC) + `workflow_dispatch`. El workflow pasa a llamarse
**"Security Scheduled (deps audit + DAST)"**.

*(Nota P-77: cuando se escribió esto, el job DAST era una plantilla inerte. Ya no — ver §44.)*
**`deps-audit` está ACTIVO
ya**: no necesita secrets ni staging. Y **no corre `npm ci` ni ningún build** — `npm audit` resuelve
desde el lockfile, así que no instala nada ni ensucia el árbol (importante: un `next build` con
`E2E_MOCK_DIST_DIR` no-default reescribe `frontend/tsconfig.json`).

El umbral **no se redefine en el workflow**: reutiliza `security/scripts/audit-npm.sh`, el mismo
script del gate por PR. Una sola verdad para los dos; si se cambia el umbral, se mueven juntos.

### 41.6 ¿Bloquea o solo avisa? **Se pone en ROJO** — y por qué

- **Un cron no puede bloquear nada.** No hay PR esperando ni deploy colgando de él, y al ser
  `schedule`/`workflow_dispatch` **no puede** ser required status check. El coste de un rojo aquí es
  **cero**: no frena a nadie. La objeción *"un cron que rompe el build es ruido"* no aplica — no hay
  build que romper.
- **Un `::warning::` en un run verde es invisible.** Nadie abre un run que salió bien. Eso sería
  repetir S-PROC-1 con otra cara: un gate que técnicamente corre y que nadie lee.
- **El rojo es lo único que GitHub notifica solo:** los fallos de workflows programados generan aviso.

### 41.7 **Quién mira el resultado** (la pregunta que faltó la vez pasada)

Un rojo no tiene dueño ni historial. Tres capas, de menos a más accionable:

1. **Portada del run** — tabla markdown en `$GITHUB_STEP_SUMMARY` con el conteo por app. Se lee
   **sin abrir el log**.
2. **Artefacto** `npm-audit-scheduled` (90 días) — `audit-summary.md` + el `--json` crudo por app,
   descargable para **seguridad**.
3. **Issue de GitHub** — **esta es la que asigna dueño.** Ante high/critical el job abre un issue con
   label `security`, título fijo `[deps] npm audit semanal: vulnerabilidades high/critical en runtime`.
   Es **idempotente**: si ya hay uno abierto con ese título, **comenta** en vez de crear otro (no
   inunda el repo cada lunes). El cuerpo lleva la tabla, el link al run, el commit auditado, el rol
   dueño y las dos salidas válidas.

**Ruta de escalación:** el issue lo tría **seguridad**; la corrección la ejecuta el rol dueño del
`package.json` afectado (**backend** o **frontend**) — devops **no** edita esos archivos, solo
mantiene el gate. El issue se cierra **solo** cuando `./security/scripts/audit-npm.sh` pasa en verde.
Si el paso del issue falla (p. ej. Issues deshabilitado en el repo) es `continue-on-error`: **no tapa
el rojo**, que sigue siendo la señal de último recurso.

### 41.8 Evidencia — las dos corridas

**Sucio** (estado real del repo hoy, `exit=1`):

```
| App         | Crit | High | Mod | Low | Estado                    |
| `backend/`  |    0 |    2 |   4 |   0 | ❌ **bloquea el gate**    |
| `frontend/` |    0 |    0 |   0 |   0 | ✅ sin hallazgos >= high  |
```

**Limpio** (mismo script, lockfile refrescado, `exit=0`):

```
| App         | Crit | High | Mod | Low | Estado                    |
| `backend/`  |    0 |    0 |   2 |   0 | ✅ sin hallazgos >= high  |
| `frontend/` |    0 |    0 |   0 |   0 | ✅ sin hallazgos >= high  |
```

Probadas además las dos ramas del paso de issue (crear la primera semana / comentar la segunda) y la
sintaxis de los cuatro bloques `run:` (`bash -n`). Sin cambios en `backend/` ni en `frontend/`.

### 41.9 Cómo se revierte

- **Quitar el `npm audit` semanal** (deja S-PROC-1 abierto otra vez): borrar el job `deps-audit` de
  `.github/workflows/security-scheduled.yml`. El job `scheduled-dast` es independiente y no se entera.
- **Dejar el cron en modo aviso** (sin rojo, sin issue): borrar los pasos *"Abrir o actualizar issue"*
  y *"Marcar el run en rojo si el gate falló"*. El resumen y el artefacto siguen. **No recomendado**:
  es exactamente el modo invisible de §41.6.
- **Revertir los cambios de `audit-npm.sh`:** `git checkout <sha-anterior> -- security/scripts/audit-npm.sh`.
  Con `AUDIT_SUMMARY_FILE`/`AUDIT_REPORT_DIR` sin definir el script se comporta **igual que antes**
  (mismo exit code, sin ficheros sueltos) — verificado; el gate por PR no depende de lo nuevo.
- **Revertir el `npm update multer`** (lo hace backend): `git checkout HEAD~1 -- backend/package-lock.json && npm ci`.

### 41.10 Lo que NO verifiqué

1. **La corrida real en GitHub Actions.** No hay egress a la API de Actions desde esta sesión. Lo
   demostrado es el **script y la lógica de los pasos**, ejecutados en local (§41.8); el `gh` de la
   creación del issue se ejercitó con un stub, porque `gh` no está instalado aquí (sí en los runners).
   La primera corrida del lunes es la prueba que falta.
2. **Que `multer@2.3.0` no rompa nada en runtime.** No corrí `npm install` ni la suite de `backend/`
   — no es mi carpeta. El argumento de riesgo nulo se apoya en §41.2 (multer no se ejecuta), no en
   una corrida verde de tests. **Esa corrida le toca a backend** (§41.4).
3. **Que el label `security` exista.** El workflow lo crea con `gh label create ... || true`; no pude
   listar los labels del repo.

---

## 42. Censo de variables de entorno: `MAIL_ASSET_ORIGIN` declarada y auditoría completa código ↔ `.env.example` (2026-09-10)

**Disparador.** El dueño reportó que *no se ve el logo en los correos*. Investigando salió una
variable huérfana: `MAIL_ASSET_ORIGIN` (`backend/src/modules/buylist/mail-shell.ts:94`) existía en el
código, con default razonable, y **no estaba declarada en ningún `.env.example`**. Una variable que
vive solo en el código es una que nadie configura hasta que algo se rompe y nadie sabe por qué.

**Qué se declaró.** `MAIL_ASSET_ORIGIN` queda documentada en el bloque de *Correo transaccional* de
`.env.example` (junto a `RESEND_API_KEY`/`MAIL_FROM`), como **OPCIONAL y comentada**, siguiendo la
convención del fichero para variables con default de código. Default: `https://tcghunt.mx` — el mismo
dominio del remitente, a propósito, porque servir la imagen desde otro host penaliza en los filtros de
spam. En staging/prod **no hace falta fijarla**; existe para previsualizar correos en local.

**Censo (auditoría completa, no solo la variable del incidente).** Se cruzó todo lo que lee el backend
—`process.env.X` **y** `ConfigService.get('X')`, que es como se lee la mayoría— contra los nombres
declarados en `.env.example`. Resultado: **61 variables leídas, 15 no declaradas**, y **0 declaradas
sin uso** (todas las 98 declaradas se consumen en código o en infra: compose, workflows, scripts).

Las 15 no declaradas, con su default:

| Variable | Dónde se lee | Default | Riesgo |
|---|---|---|---|
| `MAIL_ASSET_ORIGIN` | `modules/buylist/mail-shell.ts:94` | `https://tcghunt.mx` | **DECLARADA en este pase** |
| `PORT` | `main.ts:65` | `3001` | Nulo (la inyecta la plataforma) |
| `SCHEDULER_SHUTDOWN_TIMEOUT_MS` | `jobs/scheduler.service.ts:323` | constante de código | Bajo |
| `GUEST_ORDER_SWEEP_CRON` | `jobs/scheduler.service.ts:172` | `*/15 * * * *` | Bajo |
| `CATALOG_REFRESH_VARIANTS_BATCH_DELAY_MS` | `modules/catalog/catalog-sync.service.ts:647` | `250` | Bajo |
| `POKEMONPRICETRACKER_PARTIAL_MIN_PRICE` | `modules/pricing/price-ingest.service.ts:977` | vacío = sin filtro | Bajo (dial de dinero) |
| `POKEMONPRICETRACKER_GRADED_FORMAT` | `…/pokemonpricetracker-bulk.provider.ts:1063` | `auto` | Bajo (dial de dinero) |
| `POKEMONPRICETRACKER_GRADED_MARKET_FORMAT` | `…/pokemonpricetracker-bulk.provider.ts:811` | cae a `…_MARKET_FORMAT` | Bajo (dial de dinero) |
| `POKEMONPRICETRACKER_GRADED_FIELD` | `…/pokemonpricetracker-bulk.provider.ts:1089` | `null` (sin override) | Bajo (dial de dinero) |
| `POKEMONPRICETRACKER_GRADED_EVIDENCE_FIELD` | `…/pokemonpricetracker-bulk.provider.ts:1082` | constante de código | Bajo (dial de dinero) |
| `E2E_ENABLE_THROTTLER` | `config/test-env.ts:37` | `false` | Nulo (solo tests) |
| `E2E_ENABLE_SCHEDULER` | `config/test-env.ts:46` | `false` | Nulo (solo tests) |
| `ADMIN_EMAIL` | `prisma/reset-admin-password.ts:30` | cae a `SEED_ADMIN_EMAIL` | Nulo (script manual) |
| `NEW_ADMIN_PASSWORD` | `prisma/reset-admin-password.ts:31` | **sin default** — aborta con mensaje claro | Nulo (fail-closed) |
| `CONFIRM_RESET` | `prisma/reset-db-keep-users.ts:179` | **sin default** — sin el token no borra nada | Nulo (fail-closed, es el seguro) |

**Conclusión operativa: ninguna de las 15 puede romper producción en silencio.** Las 13 de runtime
tienen default; las 2 sin default son scripts manuales que **fallan cerrado** con mensaje explícito
(`NEW_ADMIN_PASSWORD`) o son el propio seguro de un borrado (`CONFIRM_RESET`). Las 7 variables que sí
tumbarían prod si faltaran (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_BASE_URL`, `RESEND_API_KEY`) están **todas
declaradas** y además hacen *fail-fast* al arranque en no-local vía `config/env.validation.ts`.

**Lo que el censo NO arregla (va a otros roles).**
- La causa raíz del logo era otra y **no es de infra**: `frontend/public/branding/mail-mira-180.png`
  existe en el árbol de trabajo pero está **sin commitear** (untracked) y **no está en el commit de
  producción `e117441`**. No lo bloquea `.gitignore` (`git check-ignore` no da match): simplemente
  falta el commit. Mientras no se comitee, la imagen sale 404 en prod **con cualquier valor** de
  `MAIL_ASSET_ORIGIN`. Enrutado a **frontend**.
- Las otras 14 variables no se declararon en este pase por decisión de alcance (censo primero,
  declaración después). Son deuda de documentación **no bloqueante**, no un defecto de runtime.

**Cómo reproducir el censo** (útil como chequeo periódico; hoy manual, no cableado en CI):

```bash
# nombres leídos por el backend (las dos formas de leer env)
grep -rnoE "process\.env\.[A-Za-z_][A-Za-z0-9_]*" backend/src backend/prisma backend/test \
  --include="*.ts" --exclude-dir=node_modules
grep -rnoE "config(Service)?\.get(<[^>]*>)?\(\s*['\"][A-Z_][A-Z0-9_]*['\"]" backend/src \
  --include="*.ts" --exclude-dir=node_modules
# nombres declarados (incluye las comentadas, que también cuentan como documentadas)
grep -ohE "^[[:space:]]*#?[[:space:]]*[A-Z_][A-Z0-9_]*=" .env.example
```

Cuidado con dos trampas al repetirlo: (1) `grep -rh ... backend` **sí entra en `node_modules`** y mete
~200 falsos positivos (`BROWSERSLIST`, `PRISMA_*`, `AWS_*`…) — hay que excluir el directorio, no filtrar
la salida; (2) contar solo `process.env` deja fuera la mayoría de las variables, porque el grueso del
backend lee por `ConfigService`.

---

## 43. `D-PP-2` — el seed que llamábamos «money-safe» era el que aplana, la paridad de entornos y el orden del scheduler (2026-09-10)

> **Origen:** dictamen del arquitecto **v1.65** — `API_CONTRACT §M10-PP` (fuente única del dial
> `price_provider`, marca `CANON: proveedor-de-precio`), razón entera en `ARCHITECTURE §4.35a`, desviaciones
> **`D-PP-1`** (backend) y **`D-PP-2`** (devops) en `ARCHITECTURE §9`. Se cierran además dos hallazgos de QA
> del 2026-09-10: **IMPORTANTE-1** (el runbook §28 es anterior a la curva v2) e **IMPORTANTE-2** (orden del
> scheduler sin decisión).
>
> **Alcance devops, y nada más:** prosa de este documento, `.env.example`, `scripts/`, `.github/workflows/`.
> ⛔ **Ni una línea de `backend/` ni de `frontend/`.** El cambio del **seed** es `D-PP-1` y **es de backend**;
> aquí no se toca ni se adelanta.

### 43.1 La prosa que estaba mal, y por qué se sustituye por una CITA y no por otro literal

**Qué decía este documento —en cuatro sitios— y su gemelo de `.env.example`:** que el seed del dial era el
proveedor **legacy** y que eso era el **candado money-safe**. **Ya no es cierto**, y el criterio que faltaba es de `ARCHITECTURE §4.35a(b)`:

> **Un seed money-safe debe ser INERTE —no escribe dinero— o el PRIMARIO validado. ⛔ Nunca un SEGUNDO
> escritor con semántica distinta del primario.**

`sealed_price_source='off'` **sí** es un candado: con `off` el job es **no-op** y no se escribe nada. El
proveedor legacy **no es inerte**: corre el barrido y **escribe** `PriceReference` con **un solo `market`
por carta**, invariante al printing ⇒ `normal`, `reverse_holo` y `holofoil` reciben **el mismo precio**. Por
`PROJECT §N.0` (*precio de menos = carta perdida, irrecuperable*) ése es **el lado malo del sesgo de error**.
**El seed legacy no era el candado: era el riesgo con el nombre del candado.**

**Dónde vive ahora la verdad, y por qué no se copia aquí.** Enum, semántica, **seed** e invariantes
`I-PP1`…`I-PP5` viven **solo** en [`API_CONTRACT §M10-PP`](API_CONTRACT.md#M10-PP). Este documento **cita**.
*El defecto de fondo no fue elegir mal el valor: fue que «el provider es X» son **TRES** afirmaciones con
dueños distintos —**PRIMARIO** (norma), **SEED** (con qué nace una BD fresca) y **VIGENTE** (la fila
`ConfigSetting` de UN entorno)— y el proyecto solo tenía vocabulario para una.* Por eso cinco textos podían
ser todos verdaderos y contradecirse a la vez; y por eso **volver a escribir el literal aquí sería repetir el
mecanismo del defecto**, no arreglarlo.

| Sitio | Qué decía | Qué dice ahora |
|---|---|---|
| **§4** (tabla de variables) | *«seed money-safe `pokemontcg_io`»* | cita a `§M10-PP`; el seed no se afirma aquí |
| **§19.5** (flip al proveedor de paga) | *«Seed `pokemontcg_io` (money-safe)»* | cita a `I-PP1` + por qué el adjetivo era falso |
| **§19.10 punto 3** (solicitud a backend) | *«sembrar `PRICE_PROVIDER=pokemontcg_io` (money-safe)»* | **CERRADA** como solicitud de devops; el literal lo mueve `D-PP-1` (backend) |
| **§28.2** (mecanismo del flip) | *«Seed: `pokemontcg_io` (`…:94`)»* | el seed **se lee del artefacto**, no de este párrafo (§0-B.3 regla 2) |
| **`.env.example`** (bloque del dial) | *«Seed money-safe = `pokemontcg_io`»* | cita a `§M10-PP`/`I-PP1` |

⛔ **`§28.6` NO SE TOCA — y conviene decir por qué, porque parece una omisión.** El rollback de §28.6 **opera
el VIGENTE** (`I-PP3`: `PUT /admin/settings`, `super_admin`, auditado, sin redeploy), que es **otro hecho**
que el seed. **La palanca sigue siendo válida entera**, así que se conserva **íntegra y sin editar** por
decisión de `D-PP-2`. Su paréntesis *«el seed … money-safe es `pokemontcg_io`»* queda **superseded** por
`I-PP1` — leerlo bajo el aviso del encabezado de §28. *Un runbook de flip nunca fue argumento sobre el seed:
describe cómo se MUEVE el dial, no con qué NACE un entorno.*

⚠️ **Lo que este documento NO va a afirmar nunca más** (`I-PP2`): *«el valor vigente es X»* o *«producción
corre X»*. El vigente es **por entorno** y **se lee** (`GET /api/v1/admin/settings`, panel M10, o la fila
`ConfigSetting`). Lo que sí se registra es un **evento fechado**: *el 2026-08-24 se ejecutó el runbook de
activación de §28, y el 2026-09-10 el dueño leyó el dial en el panel M10 de producción*. Eso es historial,
no una afirmación sobre el ahora.

### 43.2 ~~⏳ MEDIDA INTERINA~~ → ✅ **RETIRADA el 2026-09-10** — paridad del proveedor en los entornos que se aprovisionan solos

> 🔻 **ESTADO: la parte interina (`--ensure`) está RETIRADA desde el 2026-09-10.** `D-PP-1` aterrizó en
> `46d76cc` (el seed del código ya es el primario), el job `price-provider-interim-expiry` se puso rojo
> como estaba escrito, y el cableado se quitó de los tres sitios. **Detalle del retiro: §45.1.**
>
> **Lo que NO se retiró:** el `--assert` de los gates (candado `I-PP5`) — **sigue vivo y sigue haciendo
> falta**, por el motivo del punto «Lo que el merge de `D-PP-1` NO arregla», más abajo en esta misma
> sección. El resto de este §43.2 se conserva **como registro histórico** del problema que la medida tapó;
> léelo sabiendo que la columna «Dónde corre» de `--ensure` ya no describe el árbol.

**El agujero, medido, no supuesto** (`ARCHITECTURE §4.35a(d)`): mientras el seed del código no sea el
primario, **toda BD fresca —CI, dev, staging— arranca en el proveedor legacy**. Consecuencia: **la suite
E2E, el smoke por-stream y el DAST contra staging ejercitan un barrido distinto del que corre en
producción.** *Un gate que aprueba un sistema distinto del que se promueve no es un gate: es una ceremonia.*

**Lo que se rechazó, y por qué.** La alternativa evaluada —*dejar el seed legacy y volver el flip un paso
obligatorio del arranque de staging*— **está rechazada por el arquitecto**: es el mismo mecanismo de
divergencia con un humano en medio, y **su modo de fallo no produce ningún error**, produce **precios más
bajos en silencio**. *Si la paridad hay que recordarla, no es una paridad.* Por eso lo de abajo **no es un
paso de runbook**: es código que corre solo en el aprovisionamiento y un gate que lo mide.

**El mecanismo:** `scripts/price-provider-parity.sh` (nuevo, propiedad devops).

| Modo | Qué hace | Dónde corre |
|---|---|---|
| `--ensure` | Lee el dial y, si no es el primario, lo fija con `PUT /admin/settings` (**validado + auditado**, sin redeploy). **INTERINO.** | `scripts/seed-synthetic.sh`, `scripts/stack-native.sh up`, `.github/workflows/e2e-real.yml` |
| `--assert` | **Solo lectura.** `0` con paridad, `20` sin ella. **PERMANENTE** (candado `I-PP5`). | `.github/workflows/deploy.yml` › job `staging-provider-parity` (**bloquea** el DAST y la promoción) · `.github/workflows/security-scheduled.yml` › DAST semanal (**informativo**: anota en el resumen sobre qué barrido corrió) |
| `--check-expiry` | ⏳ Se pone **rojo** cuando `D-PP-1` aterrizó **y** el cableado interino sigue puesto. | `.github/workflows/ci.yml` › job `price-provider-interim-expiry` (cada push/PR) |

**⛔ Lo que NO se hizo, y es la trampa que había que esquivar:** **fijar una variable de entorno**.
`PRICE_PROVIDER` como env **no flipea nada** (§23.8, verificado otra vez en este pase). Si esta medida
hubiera pasado por env, no habría funcionado **y este documento estaría mintiendo**. Por eso el script habla
HTTP contra la puerta normal, y **⛔ jamás `UPDATE` directo a la BD** (§32.3: sin auditoría, sin validación).

```bash
# Local / staging de compose (lo corre solo `seed-synthetic.sh`; a mano si hace falta):
./scripts/price-provider-parity.sh --ensure --api-base http://localhost:3011/api/v1
# Stack nativo (lo corre solo `stack-native.sh up`):
./scripts/price-provider-parity.sh --ensure --api-base http://localhost:3099/api/v1
# Un entorno de verdad (staging hospedado) — SOLO LECTURA, nunca escribe:
ADMIN_EMAIL=… ADMIN_PASSWORD=… \
  ./scripts/price-provider-parity.sh --assert --api-base https://<api-staging>/api/v1
```

> **Guarda dura:** `--ensure` **se niega** contra cualquier host que no sea local o de staging. Un entorno de
> verdad mueve su dial con un humano delante (`I-PP3`), no con un script de arranque. **Producción no se
> toca desde aquí, ni por accidente.**

#### 🔴 CONDICIÓN DE RETIRO — exacta, y verificada por máquina

**Se retira cuando `DEFAULT_SETTINGS[SettingKey.PRICE_PROVIDER]` (en
`backend/src/modules/settings/settings.constants.ts`) sea el proveedor PRIMARIO**, es decir **con el merge de
`D-PP-1`**. Ese día la paridad de una BD **fresca** se cumple **por construcción** (`I-PP1`/`I-PP5`) y el
puente sobra.

**Cómo se entera el equipo sin que nadie se acuerde:** el job `price-provider-interim-expiry` de `ci.yml`
corre `--check-expiry` en **cada push y PR** y **se pone rojo** el día del merge, con la lista exacta de los
archivos de los que hay que quitar la llamada a `--ensure`. **El rojo se apaga solo** en cuanto se quitan;
no hay bandera que alguien tenga que acordarse de apagar. *(§0-B.3 regla 9(b): un parche provisional sobre
una ambigüedad no es provisional, porque nadie vuelve a quitarlo. Aquí lo quita un rojo.)*

**Al retirarla:** quitar las tres llamadas a `--ensure`, marcar este §43.2 como **RETIRADA con la fecha**, y
**⛔ NO borrar los `--assert`**: ver el punto siguiente.

> ⚠️ **Estado medido al escribir esto (2026-09-10, 
> rama `claude/tcg-hunt-orchestration-ai2vma`):** el cambio de `D-PP-1` **ya está en el árbol de trabajo, sin
> commitear** (backend lo estaba ejecutando en paralelo a este pase). ⇒ **En cuanto backend comitee, el job
> `price-provider-interim-expiry` se pondrá rojo, y eso es exactamente lo esperado, no un fallo del pase de
> backend.** El rojo es de **devops** y se apaga quitando las tres llamadas a `--ensure`. *Se deja escrito
> para que nadie lo diagnostique dos veces ni lo silencie por no entenderlo.*

#### ⚠️ Lo que el merge de `D-PP-1` **NO** arregla (medido en este pase, y por eso el `--assert` se queda)

**Los seeds MATERIALIZAN la fila.** `backend/prisma/seed.ts` y `backend/prisma/seed-e2e.ts` hacen
`configSetting.upsert({ create: …, update: {} })` **para todos los diales** ⇒ un entorno **ya sembrado**
conserva su fila **vieja** aunque el seed del código cambie. Es exactamente la regla de `ARCHITECTURE §11.0`
/ §32.1 de este documento: **los seeds nuevos no se propagan solos a entornos ya sembrados.**

Consecuencia práctica, dicha sin adornos: **el staging hospedado y cualquier volumen de compose que nadie
haya borrado con `down -v` seguirán en el proveedor viejo después de `D-PP-1`**, hasta que alguien haga el
`PUT`. Por eso:

1. El **`--assert` del gate de deploy no es interino**: es lo que impide que el DAST vuelva a certificar un
   barrido que no es el que se promueve, y **lo mide en cada corrida** en vez de confiar en la memoria.
2. Cuando `D-PP-1` se despliegue, el staging hospedado necesita **un paso de propagación de una sola vez**,
   con el mismo criterio de §32.1–§32.3: **`PUT /admin/settings` por el panel M10** (auditado, validado),
   ⛔ **nunca `UPDATE` directo**. Si el dial de ese entorno estuviera en un valor que **no** es ni el viejo
   ni el primario, **la decisión no es de devops** (§32.4): se pregunta.

#### ~~Qué necesita el humano (bloqueo declarado)~~ → ✅ **PETICIÓN RETIRADA (P-77, 2026-09-10)**

> **Esta petición queda sin objeto y se retira.** Pedía `STAGING_ADMIN_EMAIL` + `STAGING_ADMIN_PASSWORD`
> (más `STAGING_API_URL`) para que el `--assert` del gate pudiera **leer** el dial `price_provider` de
> un staging hospedado. El problema no era que el humano no los hubiera cargado: **no hay staging al que
> apuntarlos** — el dueño solo tiene producción. Y crear un admin apuntando a producción es justo lo que
> la guardia anti-producción de `security/scripts/_guard.sh` prohíbe.
>
> **Cómo se comprueba ahora, sin secrets:** contra el **stack efímero** de `security-dast.yml` y
> `e2e-real.yml`, donde **el `super_admin` lo crea el seed sintético** y `price-provider-parity.sh` cae
> por defecto a esas credenciales. `D-PP-2` pasa de «depende de secrets que el dueño no puede dar» a
> «se comprueba solo», y con **rojo duro**: si el stack no evalúa el proveedor primario, el barrido para.
> Detalle en **§44.7**.
>
> El texto original se conserva tachado arriba porque describe lo que haría falta **el día que exista un
> staging desplegado**. Mientras no exista, no se pide nada.

*(Original, para ese día: dos secrets nuevos —`STAGING_ADMIN_EMAIL`, correo del `super_admin` de STAGING
con datos sintéticos, y `STAGING_ADMIN_PASSWORD`, su contraseña— más `STAGING_API_URL` (§38.5).
⛔ **Nunca credenciales de producción**, ⛔ nunca en el repo.)*

### 43.3 🔴 DECISIÓN — el orden del scheduler (IMPORTANTE-2 de QA): **los crons NO se mueven; la norma se cumple en sustancia y su literal de FX se DEROGA, con motivo escrito**

**El hallazgo:** `ARCHITECTURE §4.35(e)` (reparto, punto 3 de **devops**) pide `fx-refresh` → **barrido de singles TCGCSV** *(tras la
ventana de actualización de TCGCSV, «como `sealed-price-ingest`, ~20:00 UTC»)* → `portfolio-snapshot`. Hoy:

| Job | Cron (UTC) | Ajustable |
|---|---|---|
| `fx-refresh` | `0 6 * * *` | ⛔ **no** (hardcodeado en backend) |
| `price-ingest` #1 | `0 0 * * *` | ✅ `PRICE_INGEST_CRON_1` |
| `price-ingest` #2 | `0 12 * * *` | ✅ `PRICE_INGEST_CRON_2` |
| `sealed-price-ingest` (el patrón a copiar) | `30 21 * * *` | ✅ `SEALED_PRICE_INGEST_CRON` |
| `portfolio-snapshot` | `0 7 * * *` | ⛔ no |

**DECISIÓN (devops, 2026-09-10): los crons se QUEDAN en `0 0` y `0 12` UTC.** No es «no lo miré»: es una
decisión con tres hechos detrás, y con su propio disparador de revisión.

1. **La flecha del FX es COSMÉTICA en este barrido, y está verificada en el código —no repetida de QA.**
   `PricingService` re-calcula la conversión a pesos **en la LECTURA** con el FX vivo cuando la fila tiene
   `priceUsdCents` y no es override manual (el bloque de recálculo de `pricing.service.ts`, ~líneas 709-724).
   El FX del momento de ESCRITURA sobrevive solo como **traza** (`fxRate`, `fxBufferPct`, `priceMxnCents`).
   ⇒ mover el barrido detrás de `fx-refresh` **no cambia ni un centavo de lo que ve el cliente**. Es la misma
   medición que hizo QA («impacto acotado»), hecha contra el artefacto.
   ⚠️ Y `FxService.getCurrent()` **degrada** al último `FxRate` conocido: el orden ya era **suave**, no duro.
2. **La flecha que SÍ tiene contenido —correr después de la ventana de TCGCSV— YA SE CUMPLE, y con más
   margen que el patrón que se me pedía copiar.** La ventana que el proyecto declara para TCGCSV es
   **~20:00 UTC** (`ARCHITECTURE §4.19d`, citada en el comentario del `sealed-price-ingest`); la corrida de
   **`00:00 UTC` consume ese fichero 4 h después**. El sellado, que es el patrón, corre a las **21:30 UTC**:
   **1,5 h**. *Copiar el patrón por su hora concreta habría EMPEORADO el margen que el patrón existe para
   dar.* ⚠️ **La ventana de ~20:00 UTC es un dato del proveedor que este proyecto no ha medido** — por eso
   «TCGCSV mueve su ventana» está en el disparador de revisión de abajo.
3. **La segunda corrida (12:00 UTC) es la PASADA DE REPARACIÓN del día, y no cuesta disco.** Lee el mismo
   fichero diario, pero el upsert es **por (carta, acabado, día)** ⇒ **no añade filas** (`P-53` no empeora) y
   **repara** el día si la corrida de 00:00 falló a medias o si entraron sets a media jornada.

**Y la razón de peso para NO moverlo, que es nueva desde que se escribió la norma:** el barrido **ya no solo
escribe precios** — **reprecia lo publicado y auto-publica piezas** (§28.4(e) puntos 4 y 5). Llevarlo a la
ventana 20:00–07:00 UTC lo metería en **las 16:00 CDMX**, o sea **precios y publicaciones moviéndose en la
tarde de un día hábil**, y encima costaría la pasada de reparación. **Sería mover un efecto sobre el cliente
para ganar una flecha que ya no mueve dinero.**

⇒ **La norma `§4.35(e)` punto 3 se declara CUMPLIDA EN SUSTANCIA (arrow de TCGCSV) y DEROGADA EN SU LITERAL
(arrow de FX dentro del mismo día UTC), por devops, el 2026-09-10.** Queda **decidido y escrito**, que es lo
que faltaba. ⚠️ **La derogación no es de la norma para todos los jobs**: `sealed-price-ingest` **sí** depende
de su ventana y no se toca.

**🔔 DISPARADOR DE REVISIÓN (para que esta decisión no sea eterna por inercia).** Vuelve a abrirse **sola**
si pasa cualquiera de estas tres, y entonces el barrido se mueve a la ventana `22:00 UTC`:

- el recálculo de MXN en la lectura **desaparece** (el precio pasa a servirse desde `priceMxnCents`
  congelado) ⇒ el FX de escritura deja de ser cosmético **y pasa a ser dinero**;
- TCGCSV **mueve su ventana** de publicación, o se mide que el fichero de las 00:00 UTC llega incompleto;
- se decide **una sola corrida diaria** (p. ej. por coste de egress): entonces la única corrida **debe** ser
  la posterior a la ventana, porque ya no habría pasada de reparación que la cubra.

**Cómo se cambiaría, si toca** (env, sin redeploy de código; siempre en **UTC**, y ⛔ **nunca cadena vacía**
—§19.3—): `PRICE_INGEST_CRON_1` / `PRICE_INGEST_CRON_2` en **Railway → `backend` → Variables**.

### 43.4 Dos trampas con el mismo nombre — la env que no flipea, y la clave del body que devuelve 422

**(a) `PRICE_PROVIDER` como variable de entorno NO flipea el proveedor.** Ya estaba dicho en **§23.8** y se
**re-verificó en este pase** antes de escribir la medida de §43.2: `PriceIngestService.providerFor()` lee
`settings.getString(SettingKey.PRICE_PROVIDER)` —la fila `ConfigSetting`— y el **único** consumidor de
`process.env.PRICE_PROVIDER` es `backend/src/config/env.validation.ts` (*hint de arranque*: si vale
`pokemonpricetracker`, exige la key del proveedor de paga y falla rápido). **La autoridad en runtime es el
ConfigSetting.**

**(b) 🔴 EL BODY DEL `PUT` LLEVA `priceProvider`, NO `price_provider`** — hallazgo de este pase, **verificado
leyendo el código**, no ejecutado contra prod. `SettingsService.update()` valida cada clave del body contra
`SETTING_DTO_MAP` (`settings.constants.ts`), que declara **`priceProvider`** (camelCase, como todo §M10);
una clave que no esté ahí cae en **`422 VALIDATION_ERROR` › `unknown setting key`** y **no se escribe nada**.

```bash
# ✅ correcto
curl -X PUT "$API_BASE/admin/settings" -H "Authorization: Bearer $JWT" \
     -H 'Content-Type: application/json' -d '{"priceProvider":"tcgcsv_singles"}'
# ⛔ 422 — la clave no existe en el DTO
#    -d '{"price_provider":"tcgcsv_singles"}'
```

**Dónde estaba el literal malo:** **§28.2**, **§28.4(c) paso 12** (ambos **corregidos**) y **§28.6**, que por
decisión de `D-PP-2` **se conserva sin tocar** ⇒ **al ejecutar el rollback de §28.6, usa la clave de aquí**.
*Money-safe por accidente: la clave mala **no escribe** (422), así que nadie flipeó nada sin querer. Pero
habría hecho fallar un rollback en el peor momento posible — el momento en que se necesita un rollback.*
**El panel M10 no tiene este problema** (arma el body él), y por eso es la vía recomendada.

### 43.5 Rollback de este pase

| Qué | Cómo |
|---|---|
| **La medida de paridad** | `git revert` del commit, o quitar las llamadas a `price-provider-parity.sh`. **No deja estado**: lo único que escribe es el dial de un entorno local/staging, y eso se revierte con el mismo `PUT` (auditado). |
| **El job `staging-provider-parity`** | Es un `needs` de `dast-staging`. Quitarlo devuelve el pipeline al estado anterior — con su agujero: el DAST vuelve a no saber sobre qué barrido corrió. |
| **El job `price-provider-interim-expiry`** | Quitarlo apaga el disparador de retiro. Si se apaga, la medida interina **queda huérfana** — que es justo lo que no se quiere. |
| **La prosa y los crons** | La prosa es documental. **Los crons NO se tocaron en este pase**: no hay nada que revertir. |

### 43.6 Lo que NO verifiqué (dicho para que nadie lo cuente como verificado)

- **No levanté el stack real.** `price-provider-parity.sh` se probó **contra un servidor HTTP de mentira**
  que imita `/auth/login`, `GET/PUT /admin/settings` y el **422** de clave desconocida: se verificaron las
  cinco rutas (login, lectura, escritura con la clave correcta, re-lectura y la guarda anti-producción) y el
  disparador de caducidad **en sus dos estados**. **Lo que eso NO prueba** es el trato con el backend real
  (forma exacta del `TokenPair`, throttler de `/auth/login`, latencias). La primera corrida de
  `e2e-real.yml` o de `stack-native.sh up --seed` es la que lo confirma.
- **No toqué producción ni la leí.** No tengo egress; el dial de prod lo leyó el dueño el 2026-09-10 en el
  panel M10 y así queda registrado (evento fechado, `I-PP2`).
- **No re-gateé `debb0c3`.** Que el barrido auto-publique **está fuera del triple veredicto del 2026-08-24**;
  decidir si se re-gatea **no es de devops** — está enrutado al humano/orquestador. Lo que hice fue que el
  runbook **lo diga**.
- **No medí el disco de prod en este pase.** Los números de `P-53` (28,559 filas/día ≈ 13 MB/día) son la
  medición del 2026-09-01, y el §28.4(e)(6) trae las consultas para **rehacerla**, no para citarla.

---

## 44. P-77 — El DAST nunca escaneó nada. Blanco efímero en CI, y un candado que se prueba a sí mismo (2026-09-10)

> **Propiedad: devops.** Qué se cambió, con qué números se decidió, qué NO cubre, y qué pasa con los
> gates que quedaron huérfanos en `deploy.yml`.

### 44.1 El hallazgo: la mitad DAST del gate de seguridad era decorativa

El DoD de `CLAUDE.md` pide «el **gate de seguridad (SAST + DAST staging)** y el harness E2E cableados en
CI». La mitad SAST se cumplía de verdad (`security-sast.yml` corre en cada push/PR). La mitad DAST **no
había corrido nunca contra nada**, en toda la vida del proyecto. Medido, no supuesto:

| Verificación | Cuándo | Estado real medido |
|---|---|---|
| CI (unitarios + contrato) | cada push/PR | ✅ corre |
| SAST (`security-sast.yml`) | cada push/PR | ✅ corre |
| E2E con mocks (`e2e.yml`) | cada push/PR | ✅ corre |
| E2E real (`e2e-real.yml`) | nocturno 08:00 UTC | ✅ **29 corridas**, última `34352287999` (2026-09-09 12:39 UTC) en verde |
| **DAST** (`security-scheduled.yml > scheduled-dast`) | semanal lun 06:00 UTC | 🔴 **0 escaneos**: apuntaba a `STAGING_BASE_URL` |
| **DAST** (`deploy.yml > dast-staging`) | nunca | 🔴 pipeline apagado + mismo secret inexistente |

La causa raíz no es un bug: **el dueño nunca tuvo staging. Solo producción.** `STAGING_BASE_URL` no
estaba «pendiente de cargar»: no había ningún entorno al que apuntarlo. El preflight del cron detectaba
la ausencia, imprimía `::notice:: modo plantilla (no-op)` y **el job salía en VERDE**.

Es el mismo modo de fallo que ya nos mordió tres veces —S-PROC-1 (`npm audit` que no corría sin push),
el falso verde del preflight de Stripe (§33), SEC-OPS-1 (§38: el gate auditaba un binario viejo)—:
**una verificación que técnicamente corre, no puede fallar, y nadie lee.** Un candado que no se puede
poner rojo no es un candado; es peor que nada, porque produce confianza falsa.

Arrastraba con él tres gates más, todos colgando del mismo pipeline apagado: `staging-serves-head`
(procedencia SEC-OPS-1), `staging-provider-parity` (`D-PP-2` / `I-PP5`) y el propio `dast-staging`.
Y dejaba sin objeto los secrets `STAGING_ADMIN_EMAIL`/`STAGING_ADMIN_PASSWORD` que devops había pedido
al humano: no hay staging al que apuntarlos, y apuntarlos a producción es justo lo que la guardia
anti-producción de `security/scripts/_guard.sh` prohíbe.

### 44.2 La salida elegida: blanco EFÍMERO levantado en el propio CI

`CLAUDE.md` §7 autoriza expresamente como blanco «**staging (o local)**». Se toma la vía local.

**No se construyó ningún stack nuevo.** `e2e-real.yml` ya levanta `docker-compose.staging.yml` completo
(Postgres 16 + Redis 7 + MinIO + backend NestJS + frontend con `NEXT_PUBLIC_USE_MOCKS=false`) y lleva
29 corridas haciéndolo. El trabajo fue **apuntar el escáner a ese stack**.

#### El número que decidió la forma

Perfilado del nocturno `e2e-real.yml` run `34352287999` (API de GitHub, tiempos por paso):

| Paso | Tiempo |
|---|---|
| `docker compose up -d --build` (stack completo) | **139 s** |
| salud backend + procedencia + seed + frontend | 10 s |
| `npm ci` + Chromium + Playwright smoke | 46 s |
| apagar stack | 12 s |
| **total del job** | **224 s (3 min 44 s)** |

Tres formas posibles y por qué se descartaron dos:

1. **Colgar el DAST del job de `e2e-real`** — ahorra los 139 s de levantar el stack, pero multiplica por
   ~8-10 la corrida que el equipo mira cada mañana, y mezcla dos veredictos distintos («¿funciona?» vs
   «¿es atacable?») en un solo rojo ambiguo. **Descartada**: 139 s es un precio barato por mantenerlos
   separados, y el nocturno tiene que seguir siendo legible.
2. **`workflow_call` a `e2e-real.yml`** — mismo problema: un solo job, un solo veredicto.
3. **Job propio que levanta el mismo compose** ✅ **elegida**. Cuesta 139 s de duplicación y compra
   independencia de cadencia, de tiempo límite y de veredicto.

Confirmado en la primera corrida real (`34432408600`, rama `devops/dast-p77`): levantar + sembrar +
verificar procedencia + verificar paridad del dial = **143 s** (133 s en la segunda corrida). Es decir,
todo el trabajo extra que añade el DAST sobre lo que ya hacía el nocturno cuesta **~4 segundos**.

#### El presupuesto del escaneo, y el tope que era inerte

Lo caro no es el stack: es el escaneo. Dos mediciones y una corrección:

| Corrida | Configuración | Paso de escaneo |
|---|---|---|
| `34432408600` | `full` + araña AJAX, **2 blancos** (vitrina + base de la API), "tope activo 12 min" | **> 32 min** sin terminar |
| `34434882197` | `full` + araña AJAX, **1 blanco** (vitrina), "tope activo 10 min" | **> 36 min** sin terminar |

Dos hallazgos distintos ahí dentro:

1. **El segundo blanco no compraba nada.** El backend NestJS **no expone OpenAPI**, así que la araña de
   ZAP no tiene qué recorrer en la base de la API (su raíz es un 404) y se gasta el presupuesto entero
   sin descubrir superficie. ZAP apunta ahora **solo a la vitrina** —la araña **AJAX** conduce un
   navegador real, así que las XHR de la SPA sí entran en el árbol con sus parámetros— y **nuclei**,
   que es rápido y no depende de enumerar enlaces, apunta a las dos. Lo que queda fuera está declarado
   en §44.4, no disimulado.
2. **🔴 Mi propio tope estaba inerte, y es la misma enfermedad que P-77.** El script pasaba
   `-config ascan.maxScanDurationInMins=…`. Ese prefijo **no existe**: las opciones del escáner activo
   de ZAP viven bajo **`scanner.`** (`ScannerParam`). ZAP **ignora en silencio** una clave desconocida,
   así que el "tope de 10 minutos" no topaba nada — y no se notaba, porque un límite mal escrito es
   indistinguible de no tener límite. Que la segunda corrida siguiera 36 minutos con un tope de 10 es
   lo que lo delató.

**Corregido con cinturón y tirantes**, a propósito, porque la lección de este pase es justamente que un
solo mecanismo silencioso no basta:

- **Tirante:** el prefijo correcto, `-config scanner.maxScanDurationInMins` / `scanner.maxRuleDurationInMins`.
- **Cinturón:** una **pared de reloj** con `timeout` alrededor del `docker run`, calculada como
  `(araña×2 + activo + 6) min` (hoy **20 min**). No depende de que ninguna clave de config esté bien
  escrita. Si se la come, el paso sale **ROJO** con el mensaje «esto no es un hallazgo: es presupuesto
  mal calibrado» — y como un ZAP cortado no deja informe, el candado también lo lee como rojo por su
  cuenta (**sin informe = ROJO**). Las dos mitades apuntan al mismo sitio.

**Resultado tras la corrección** (run `34437760891`, un blanco, perfil `full` + araña AJAX):

| Paso | Tiempo |
|---|---|
| autoprueba del candado (job `selftest`, en paralelo) | 152 s |
| levantar + sembrar + procedencia + paridad | 148 s |
| **ZAP full + araña AJAX** (pared 1200 s) | **643 s** · 541 s en el run de verificación |
| nuclei (2 blancos) | 47 s · 30 s |
| candado + resumen + apagar | 13 s |
| **total del job `dast`** | **855 s (14 min)** · **697 s (11,6 min)** en el de verificación |

De **> 39 min sin terminar** a **12-14 min con veredicto** en el job del barrido. A eso hay que sumarle
el `selftest`, que **NO corre en paralelo**: `dast` lo declara en `needs`, así que el barrido espera a
que la autoprueba termine. **Reloj de pared del workflow completo: ≈ 855 s (14,3 min)** en el run de
verificación (158 s de autoprueba + 697 s de barrido).

Los 158 s de la autoprueba son el precio de saber que el candado cierra, y se pagan **una vez por
semana**. Serializarlos es deliberado: si el candado no sabe cerrarse, no quiero que el barrido llegue
siquiera a emitir un verde. Para un cron semanal, 14 min es perfectamente pagable — que era la
condición para que nadie lo apague.

#### Cadencia

**Semanal, lunes 06:00 UTC** — exactamente la que ya tenía el cron muerto que sustituye — **más
`workflow_call`** para el barrido previo a publicar, **más** disparo manual. **No en cada push**: el
escaneo activo tarda demasiado (ver §44.4) y castigar el día a día es la vía rápida a que alguien lo
apague.

### 44.3 ⭐ El candado se prueba a sí mismo: `selftest`

Esta es la parte que distingue el gate nuevo del que sustituye. No basta con que el DAST corra: hay que
poder **demostrar que sabe ponerse rojo**.

`security/dast-selftest/canary.py` es un blanco deliberadamente vulnerable (no es código de la
aplicación; no se despliega, no se importa, vive segundos en su propio compose). Planta cuatro cosas:

| Ruta | Vulnerabilidad plantada | Regla de ZAP que debe cazarla |
|---|---|---|
| `/boom` | HTTP 500 + traza y error de motor SQL | `90022` Application Error Disclosure (**pasiva**) |
| `/search?q=` | reflejo crudo del parámetro en HTML | `40012` XSS reflejado (activa) |
| `/download?file=` | lectura de fichero sin sanear | `6` Path Traversal (activa) |
| formulario sin token | — | `10202` — **no cuenta como disparo**: se reclasificó a `WARN` en §44.5 (esta app usa JWT Bearer, no sesión por cookie) |

El job `selftest` lo escanea con **el mismo ZAP, la misma política (`security/zap/baseline.conf`) y el
mismo candado (`security/scripts/dast-gate.py`)** que el barrido de verdad, y corre el candado con
`--expect-red`: **veredicto invertido, un gate VERDE sobre el canario es el FALLO**.

Y `dast` declara `needs: [selftest]`: **si el candado no sabe cerrarse, el barrido no llega a emitir un
verde**. Eso es estructural, no una convención que alguien deba recordar.

Varias rutas de plantado a propósito —`90022` es **pasiva** y `40012`/`6` son **activas**— para que el
selftest siga valiendo con el perfil `baseline` y no se vuelva frágil si ZAP cambia una firma: se afirma
*«el gate se puso rojo»*, no *«esta regla concreta disparó»*. En la corrida `34437760891` dispararon las
tres.

**Coste medido:** 152-170 s (el canario arranca en segundos frente a los ~140 s del stack real). Lo que
verifica es la cadena escáner → política → candado, que es donde estaba el agujero; que el stack real
levanta ya lo mide `e2e-real.yml` cada noche.

#### La demostración: run de calibración `34437760891` y run de VERIFICACIÓN `34439124190`

El segundo corre **con la política ya calibrada** (§44.5) y es el que vale como prueba:

| | Canario (vulnerabilidades PLANTADAS) | Stack real (mismo run, misma política, mismo candado) |
|---|---|---|
| Reglas `FAIL` disparadas | **5** — `40012` XSS reflejado · `40026` XSS DOM · `6` Path Traversal · `43` Source Code Disclosure · `90022` Application Error Disclosure | **0** |
| Veredicto del candado | **🔴 ROJO** | **🟢 VERDE** |
| Resultado del job | ✅ *(el rojo era lo esperado)* | ✅ |
| Duración | 158 s | 697 s |

**Esto es lo que había que demostrar y nunca se había demostrado: la política DISCRIMINA.** No es
verde-siempre —habría dado verde sobre el canario— ni rojo-siempre —habría dado rojo sobre el stack—.
Y el barrido del stack real **sí encontró cosas**: 22 reglas con hallazgos (cookie sin `HttpOnly`, CORS
permisivo, fuga de `X-Powered-By`, CSP sin fallback, cabeceras de endurecimiento…), ninguna bloqueante.
El escáner mira de verdad; lo que pasa es que hoy no hay nada de gravedad bloqueante en esa superficie.

Nota lateral que confirma el diseño: en ese run apareció una regla **no listada** en la política
(`120000`, información en `localStorage`). El candado la trató como **`WARN`**, no como `FAIL` — una
firma nueva de ZAP no puede poner rojo el gate por sorpresa; se ve en el informe y se clasifica a mano.

#### La segunda mitad: la guarda estática, en cada push

`scripts/check-dast-gate-live.sh` (job `dast-gate-live` de `ci.yml`, junto a las otras tres guardas
estáticas). Sin red y sin Docker, en menos de un segundo, comprueba:

1. Existe un workflow de DAST con cadencia propia (`schedule`).
2. Tiene job de autoprueba que escanea el canario.
3. El barrido **depende** de la autoprueba (`needs: [selftest]`).
4. El barrido aplica el **candado**, no solo el escáner.
5. **El candado funciona**: se le pasa un informe limpio (exige verde), uno con un SQLi de manual
   (exige **rojo**) y uno inexistente (exige **rojo** — un escáner que no corrió no es un verde).
6. Ningún workflow activo cuelga su DAST de `secrets.STAGING_BASE_URL`, y `deploy.yml` sigue marcando
   sus gates como INERTES.

Es el arreglo del *mañana*: si alguien vacía las reglas `FAIL` de `baseline.conf` para «quitar ruido»,
sale en el PR, no seis meses después.

### 44.4 ⚠️ ALCANCE DECLARADO — lo que este DAST **NO** cubre

**Este párrafo es parte del entregable. Nadie puede citar este gate como si cubriera producción.**

El blanco es un stack **efímero de CI con datos sintéticos**. Se parece a producción en el código que
ejecuta, y en poco más. En concreto **NO** cubre:

- **La configuración de producción.** Variables de entorno, diales `ConfigSetting` reales, límites del
  throttler, orígenes CORS, claves y modos de Stripe (aquí siempre TEST, y sin credencial utilizable).
  Un fallo de configuración de prod —el tipo de fallo más común en incidentes reales— es invisible aquí.
- **Los datos de producción.** El seed es sintético y determinista. No hay volumen, ni distribuciones
  reales, ni los casos raros que produce el uso real. Un fallo de autorización que solo se manifiesta
  con datos de varios clientes no aparece.
- **La superficie de red de producción.** No hay Vercel ni Railway, ni su CDN, ni WAF, ni reglas de DNS,
  ni el TLS real, ni los redirects 301 del rebrand a `tcghunt.mx`. Todo lo que ZAP diría sobre
  cabeceras HSTS, certificados o cacheado de borde **describe a `localhost`, no a `tcghunt.mx`**.
- **Las integraciones vivas.** Webhooks de Stripe reales, proveedores de precio de paga (declarados
  incapacitados a propósito), correo saliente, object storage gestionado.
- **La superficie de la API que no cuelga de la vitrina.** El backend NestJS **no expone OpenAPI**, así
  que la araña de ZAP solo alcanza los endpoints que el navegador llama desde el front. Los endpoints
  administrativos y los que solo se invocan por webhook **no se enumeran**. *(Cierre posible: que
  backend exponga un spec; queda dicho aquí, no cableado.)*
- **Producción, punto.** Contra prod no hay ni habrá cron. Sigue vigente el procedimiento de **prueba
  puntual autorizada** de §14.3 (`ALLOW_PROD_DAST=1`, ventana escrita, plan de aborto).

Lo que **sí** cubre, y no es poco: la superficie web servida por el código de `HEAD`, con procedencia
verificada (SEC-OPS-1) y con el dial de precio verificado en paridad (`I-PP5`). Es la diferencia entre
cero escaneos y un escaneo semanal real.

### 44.5 El ruido: qué se silenció, con qué evidencia y por qué

Un escaneo semanal que escupe falsos positivos que nadie revisa se ignora en un mes, y entonces tenemos
un verde que no protege. `security/zap/baseline.conf` **existía desde el principio pero nunca había
visto un hallazgo** — decía literalmente «la lista es de referencia; ajústala tras el primer barrido
real», y ese barrido nunca ocurrió. Ahora sí: todo lo de abajo está calibrado contra el run
**`34437760891`**, que produjo **23 reglas con hallazgos y CERO bloqueantes** en el stack real.

#### Reclasificaciones, una por una

| Regla | Antes | Ahora | Motivo |
|---|---|---|---|
| `10202` Ausencia de tokens Anti-CSRF | **FAIL** | **WARN** | Esta app autentica con **JWT Bearer**, no con sesión por cookie: un token anti-CSRF no es la defensa que le toca, y la regla marcaría **todos** los formularios como bloqueantes. En FAIL era un **rojo permanente por diseño** — y un rojo que sale siempre no es una alarma, es ruido (§33.2). Si algún día se introduce sesión por cookie, vuelve a FAIL. |
| `40026` XSS DOM-Based | WARN | **FAIL** | Riesgo **Alto**. Disparó **x2 contra el canario** y **0 contra el stack real** ⇒ es severa y hoy no es ruido. |
| `43` Source Code Disclosure - File Inclusion | (no listada ⇒ WARN) | **FAIL** | Ídem: **Alto**, disparó solo contra el canario. |
| `90022` Application Error Disclosure | FAIL | **FAIL** (confirmado) | Ahora con evidencia: dispara contra el canario, **no** contra el stack real. |
| `10035` HSTS | WARN | WARN (sin cambio, pero anotado) | Contra el stack efímero **no puede dispararse** (el blanco es HTTP en localhost). Se deja en WARN, no en IGNORE, porque sí importa en la prueba puntual contra prod (§14.3). |

#### Reglas SILENCIADAS (`IGNORE`) — las ocho, con su porqué

Todas son **informativas**, todas dispararon en el barrido real y todas juntas eran **~40 % del volumen
del informe**:

| Regla | Veces | Por qué se silencia |
|---|---|---|
| `10096` Timestamp Disclosure - Unix | x3 | Casa con **cualquier número de 10 dígitos** dentro de los bundles de Next.js. Falso positivo puro. |
| `10049` Storable / Non-Storable Content | x10 | Informativa; dispara en casi toda respuesta. |
| `10050` Retrieved from Cache | x3 | Informativa. |
| `10104` User Agent Fuzzer | x5 | Informativa **por construcción**: siempre sale en un full scan. |
| `10109` Modern Web Application | x4 | Dice literalmente «esto es una SPA». Es un hecho conocido de la arquitectura, no un hallazgo. |
| `90027` Cookie Slack Detector | x5 | Informativa. |
| `10111` Authentication Request Identified | x2 | Informativa: «hay un formulario de login». |
| `10015` Re-examine Cache-control | x1 | Informativa; el caso accionable de caché ya lo cubría `10049`, y el borde real no existe en este blanco. |

**Silenciar ≠ ocultar.** El candado cuenta los hallazgos silenciados y publica **una línea al pie**:
`🔇 N hallazgo(s) de M regla(s) silenciada(s) por política: …`. Si mañana `10096` empieza a disparar
500 veces, se ve.

#### Lo que queda ARRIBA porque sí es accionable

El informe corto que sale del barrido real no es vacío: `10010` cookie sin `HttpOnly` (x5), `10024`
información sensible en la URL (x5), `10098` **CORS permisivo** (x3, riesgo Medio), `10037` fuga de
`X-Powered-By` (x5), `10055` CSP sin fallback, y el bloque de cabeceras de endurecimiento (`10038`,
`10020`, `10021`, `10063`, `90004`). **Dueño: frontend/backend** — devops mantiene el gate, no corrige
código de aplicación (`CLAUDE.md`).

El candado además **agrega**: lo bloqueante sale arriba con URL de ejemplo; lo demás se colapsa a una
línea por regla dentro de un `<details>`; y lo silenciado se cuenta al pie. Prefiero un informe corto y
creíble a uno exhaustivo que nadie lea.

### 44.6 Los gates huérfanos de `deploy.yml`: **declarados INERTES**

`deploy.yml` **sigue apagado y debe seguir así**: los deploys reales van por las integraciones nativas
de Vercel/Railway (push-to-deploy). **No se reactiva.**

Pero de eso se sigue algo que hasta hoy no estaba escrito, y por no estarlo se contaba como cobertura.
Decisión tomada, gate por gate:

| Gate en `deploy.yml` | Decisión | Dónde vive el que SÍ corre |
|---|---|---|
| `staging-serves-head` (procedencia SEC-OPS-1) | **INERTE, se conserva** | `e2e-real.yml` (nocturno) y `security-dast.yml`: `assert-serving-head.sh` contra el stack efímero, en cada corrida |
| `staging-provider-parity` (`D-PP-2` / `I-PP5`) | **MOVIDO** — ahora ejecutable | `security-dast.yml` y `e2e-real.yml`: `price-provider-parity.sh --assert` contra el stack efímero |
| `dast-staging` (ZAP + nuclei) | **MOVIDO** | `security-dast.yml`, semanal, con autoprueba del candado |
| `scheduled-dast` (`security-scheduled.yml`) | **RETIRADO** (no desactivado: movido) | `security-dast.yml` |

**Por qué se conservan los tres de `deploy.yml` en vez de borrarlos:** son el esqueleto del día que
exista un staging desplegado, y esa decisión es del dueño, no de devops. Lo que no puede pasar es que
alguien los cite como cobertura activa. Por eso: (a) hay un bloque de cabecera en `deploy.yml` que lo
dice con una tabla, (b) cada uno de los tres jobs lleva su marca `⚠️ INERTE (P-77)` encima, y (c)
`check-dast-gate-live.sh` **comprueba en cada push que la marca sigue puesta**. Una decisión escrita
que nadie verifica se erosiona; ésta se verifica.

⛔ Si algún día se reactiva el CD: los tres dejan de ser inertes **solo** cuando exista un staging
desplegado *y* sus secrets estén cargados. Reactivar el workflow sin eso devuelve el pipeline al estado
de P-77.

### 44.7 `D-PP-2` deja de depender de secrets que nadie puede dar

`staging-provider-parity` exigía `STAGING_ADMIN_EMAIL` + `STAGING_ADMIN_PASSWORD` para poder **leer**
el dial `price_provider` (`GET /admin/settings` es `@Roles(super_admin)`). Contra el stack efímero eso
ya no hace falta: **el admin lo crea el seed sintético**, y `price-provider-parity.sh` cae por defecto
a esas credenciales (`admin@staging.local`). El gate pasa de «depende de secrets que el dueño no puede
dar» a «se comprueba solo», y además es **rojo duro**: si el stack efímero no evalúa el proveedor
primario, el barrido para, porque un informe DAST sobre otro barrido describe otro sistema.

⛔ **Solo `--assert`, nunca `--ensure`.** El puente interino de `--ensure` ya **caducó** (`D-PP-1`
aterrizó: el seed del código es el primario), y el stack efímero nace **fresco** en cada corrida
(`down -v`), así que la paridad se cumple sola. Añadir aquí un cuarto call site de `--ensure` habría
sido resucitar un apaño el mismo día que su disparador de retiro se puso rojo. Si el `--assert` falla,
el hallazgo es del rol **backend**, no se parchea desde devops.

> ✅ **PETICIÓN RETIRADA.** `STAGING_ADMIN_EMAIL` y `STAGING_ADMIN_PASSWORD` **ya no se piden al humano**.
> Tampoco `STAGING_BASE_URL` ni `STAGING_API_URL` para el DAST. Quedan sin objeto mientras no exista un
> staging desplegado, y su ausencia ya no deja ningún gate ciego. Ver §11.D.

### 44.8 Cómo se corre y cómo se apaga

```bash
# Barrido completo a mano (necesita Docker):
./security/scripts/dast-ephemeral.sh up      # stack + salud + procedencia + seed + paridad
./security/scripts/dast-ephemeral.sh scan    # ZAP (+ nuclei) contra vitrina y API
./security/scripts/dast-ephemeral.sh gate    # el candado: 0 verde / 1 ROJO
./security/scripts/dast-ephemeral.sh down    # apaga y borra volúmenes

# ¿El candado sabe ponerse rojo? (canario con vulnerabilidades plantadas)
./security/scripts/dast-selftest.sh

# El candado sobre informes ya guardados (sin Docker, sin red):
python3 security/scripts/dast-gate.py --zap-json security/reports/zap-*.json

# La guarda estática que corre en cada push:
./scripts/check-dast-gate-live.sh
```

En CI: `.github/workflows/security-dast.yml` — semanal (lun 06:00 UTC), `workflow_dispatch` (con perfil
`full`/`baseline`, tope del escaneo activo y modo `report_only` para calibrar), `workflow_call` para el
barrido previo a publicar, y **empujar a una rama `devops/dast-**`** para reproducir la demostración
completa sin esperar al lunes.

**Rollback de este pase:** `git revert` del commit. No deja estado: el stack es efímero y se destruye
con `down -v` en cada corrida; lo único que escribe fuera del runner es el issue de hallazgos (que se
cierra a mano) y el dial `price_provider` de ese stack efímero, que muere con él. Quitar
`security-dast.yml` devuelve el DAST a cero cobertura — con el agujero de P-77 intacto.

---

## 45. Poner CI en verde en el candidato de release, sin apagar nada (2026-09-10)

> **Propiedad: devops.** Pase acotado a los **dos únicos jobs rojos** del run `34441149856` (HEAD
> `2d19cae`): `price-provider-interim-expiry` y `e2e-harness-gaps`. El código del producto ya estaba verde.
>
> **Regla que gobernó el pase:** ningún job se silencia, se borra, se condiciona ni se marca
> `continue-on-error`. Los dos rojos se apagaron **quitando su causa**, no su interruptor.

### 45.1 `price-provider-interim-expiry` — el rojo era el disparador de retiro funcionando

**No era un fallo.** Era el mecanismo de caducidad que `§43.2` dejó armado: `--check-expiry` se pone rojo
**el día que `D-PP-1` aterriza y el cableado interino sigue puesto**. `D-PP-1` aterrizó en `46d76cc` —
verificado leyendo el **artefacto**, no un párrafo:

```
backend/src/modules/settings/settings.constants.ts:327
  [SettingKey.PRICE_PROVIDER]: 'tcgcsv_singles',   ← ya es el PRIMARIO
```

**Qué se quitó** — las tres llamadas a `--ensure`, que es lo que el propio script listaba:

| Fichero | Antes | Ahora |
|---|---|---|
| `scripts/seed-synthetic.sh` | `--ensure` (auto-corregía el dial) | **`--assert`** — rojo duro si no hay paridad |
| `scripts/stack-native.sh` (verbo `up`) | `--ensure` | **`--assert`** — deja el rojo dicho, no tumba el stack |
| `.github/workflows/e2e-real.yml` | `--ensure` | **`--assert`** — rojo duro |

`./scripts/price-provider-parity.sh --check-expiry` → **exit 0**: *«Medida interina RETIRADA y seed al día»*.
El rojo se apaga solo, sin bandera que nadie tenga que acordarse de bajar.

#### ⭐ Por qué el cambio es `--ensure` → `--assert` y **no** un borrado

Porque `--ensure`, **desde el merge de `D-PP-1`, era un no-op que salía `0` sin mirar nada**:

```bash
# scripts/price-provider-parity.sh
if [ "$MODE" = "--ensure" ] && expired; then ... exit 0; fi
```

⇒ el paso de `e2e-real.yml`, anunciado como **«rojo duro»**, llevaba desde entonces **sin verificar
absolutamente nada**. Sustituirlo por `--assert` **no es una rebaja del gate: le devuelve la verificación que
el no-op se había comido.** Borrarlo a secas habría dejado el hueco callado.

#### ⛔ Lo que se queda, y **dónde**, y por qué (esto no es inercia)

El `--assert` **no es interino**: es el candado `I-PP5`. Hace falta porque **los seeds materializan la fila**
(`configSetting.upsert({ create: …, update: {} })`) ⇒ **un entorno ya sembrado conserva el valor viejo aunque
el seed del código cambie** (§32.1, `ARCHITECTURE §11.0`). «Paridad por construcción» **solo alcanza a las BD
frescas**. Sitio por sitio:

| Dónde | ¿BD fresca? | ¿Se queda el `--assert`? |
|---|---|---|
| `stack-native.sh up` | **NO** — el directorio de datos de Postgres **sobrevive entre `up`** | **SÍ, imprescindible.** Es el caso donde el puente tapaba de verdad el problema |
| `seed-synthetic.sh` (staging) | **NO** — staging hospedado / volumen de compose sin `down -v` | **SÍ, imprescindible.** Mismo motivo |
| `e2e-real.yml`, `security/scripts/dast-ephemeral.sh` | **SÍ** — `down -v` al final de cada corrida | **SÍ, pero como red de seguridad**: aquí la paridad se cumple sola; el `--assert` es lo que detecta que el **seed de backend** deje de fijar el primario |
| `deploy.yml` › `staging-provider-parity` | staging real | **SÍ.** Bloquea DAST y promoción |

**El arreglo cuando el `--assert` salga rojo ya no es «corre `--ensure`»** (comando muerto). El mensaje del
script se corrigió para decir la vía real: **`PUT /admin/settings` por el panel M10** (auditado, `I-PP3`), o
recrear la BD desde cero en un entorno desechable. ⛔ Nunca por env (`PRICE_PROVIDER` no flipea el dial,
§23.8) ni por SQL directo (§32.4).

### 45.2 `e2e-harness-gaps` — la causa registrada era **falsa**; el guardarraíl se inventaba el rojo

La causa que veníamos arrastrando —*«`start_infra` de `stack-native.sh` ya no levanta object storage, así que
el PUT presignado del INE se salta»*— **es falsa, y conviene decirlo con todas las letras porque estuvo a
punto de costarnos una declaración de no-cobertura sobre un documento de identidad.**

**Medido:** `start_s3` **sí está** dentro de `start_infra`, en `2d19cae` y hoy. Los **6 puntos** del check
pasan. Se verificó extrayendo el árbol **exacto** que corrió CI (`git archive 2d19cae`) y contrastando los
cinco ficheros implicados contra los blobs que devuelve la API de GitHub para ese SHA: **idénticos byte a
byte**. Mismo contenido, verde en local y rojo en CI.

#### La causa real: `set -o pipefail` + `grep -q` = carrera SIGPIPE

`grep -q` **sale en cuanto encuentra el patrón** y cierra el pipe. Si el escritor (`awk`) aún tenía cola por
volcar, se lleva un **SIGPIPE ⇒ 141**; con `pipefail`, **el estado del pipeline pasa a 141 aunque el patrón
SÍ estuviera**, el `if` toma la rama `else` y **la guarda inventa un rojo**.

No es teórico. El bloque del check 2 son **4 483 B** y `start_s3` cae en el byte **747**: `mawk` vuelca un
primer bloque de 4 096 B —que **ya contiene el match**—, `grep -q` sale, y el segundo `write` muere.

```
fallos con  grep -q  (pipeline): 31 / 400   ← 7,8 % de falsos rojos
fallos con  grep >/dev/null   :  0 / 400
```

**El arreglo:** `grep PATRÓN >/dev/null` en vez de `grep -q PATRÓN`. Sin `-q`, grep **consume toda la
entrada** antes de salir, así que el escritor nunca escribe contra un pipe cerrado. **Mismo código de salida,
misma semántica, sin carrera.** No se relajó ni un solo criterio: los 6 puntos siguen midiendo lo mismo.
`./scripts/check-e2e-harness-gaps.sh` → **8/8 corridas en verde**.

> ⚠️ **El check 5 conserva `grep -qE` a propósito**: no está en un pipeline (`grep -qE … "$E2E_WF"`), así que
> no hay escritor al que matar. La regla es *«no `grep -q` **al final de un pipeline**»*, no *«no `grep -q`»*.

#### 🚩 Lo que esto significa para el arnés E2E (la frase que hay que citar, no la otra)

**La subida del INE SÍ está cubierta y el cobro SÍ está cubierto.** No hay nada que declarar como no cubierto
por este motivo: no hubo hueco de cobertura, hubo un **guardarraíl intermitente**. Cualquiera que cite
*«el arnés no prueba la subida del INE»* está citando un diagnóstico que **se midió y resultó falso**.

**Una guarda intermitente es tan mala como una que nunca falla:** enseña al equipo a re-lanzar hasta que
salga verde — y el día que el rojo sea de verdad, también se re-lanza. Es la misma enfermedad que `P-77`.

### 45.3 El mismo defecto en otras dos guardas de CI — **corregido**, y por qué se salió del alcance

**Dueño: devops.** El alcance del pase eran **dos jobs**. Esto los excede y **se declara para que el dueño
pueda objetarlo**, no se cuela en silencio.

Al buscar la firma del defecto (`pipefail` + `grep -q` al final de un pipeline) aparecieron **dos guardas más
del propio CI** con la construcción **idéntica**, sobre el **mismo** bloque de `stack-native.sh`:

| Fichero | Línea | Bloque del escritor | Falsos rojos medidos |
|---|---|---|---|
| `scripts/check-provenance-gate.sh` | 90 | `up)` = **5 493 B**, `verify_head` en el byte **3 885** | **73 / 400 (18 %)** |
| `scripts/check-dast-gate-live.sh` | 130 | `grep -v` sobre cada workflow | misma clase, tasa menor |

**Por qué no se dejó declarado y ya:** `provenance-gate` es **bloqueante duro** de `ci-ok` en `ci.yml`
(*«si el comprobador de SEC-OPS-1 deja de estar cableado, el resto de gates dejan de significar lo que
dicen»*). Con un 18 % por corrida, **~1 de cada 5 verificaciones del candidato de release se cae por un
motivo inexistente** — y entonces el «run verde» que se pide como prueba **no sería una prueba**, sería una
tirada de dados que salió bien. Arreglar el rojo medido y dejar al lado un rojo aleatorio del **mismo
defecto** en un bloqueante habría sido entregar CI en verde *de mentira*.

**El cambio es el mismo y es semánticamente nulo:** `grep -q X` → `grep X >/dev/null`. **Mismo código de
salida, mismos criterios, ningún check relajado.** Es lo contrario de silenciar: **quita un falso rojo, no un
rojo.** Verificado tras el cambio:

```
check-provenance-gate.sh  →  fallos 0 / 400   (antes 73 / 400)
```

#### ✅ CERRADO — los dos scripts de seed también, en el mismo pase

Lo anterior quedó abierto unas horas y **se cerró antes de entregar** (commit `e735aa4`). El motivo de
cerrarlo en vez de dejarlo propuesto: en las guardas de CI este defecto produce un **rojo falso**, que al
menos se ve; en los seeds produce **silencio**, que es peor. La rama equivocada significa que el entorno se
siembra con el seed que no toca —o **no se siembra**— y el script **sale con `exit 0`**. Un entorno mal
sembrado que se anuncia como bien sembrado invalida cualquier E2E o DAST que corra encima, y este pase va
justo de eso.

- `scripts/seed.sh:34` · `scripts/seed-synthetic.sh:64,67` — **CORREGIDOS** (`npm run | grep -E … >/dev/null`).
  El escritor es `npm run`, cuya salida sí puede pasar del buffer del pipe, así que la carrera era alcanzable.

**Sin riesgo práctico, verificado y NO tocados** (se dejan como están, con el motivo escrito para que nadie
los "arregle" por parecido):

- `scripts/check-graded-estimate-dials.sh:318` · `scripts/stripe-test-key-preflight.sh:122,126,127` —
  usan `grep -Eq` y el escritor es `printf '%s' "$VAR_CORTA"`: **un solo `write`** de pocos bytes en un
  buffer de 64 KB vacío. Nunca hay un segundo `write`, así que no existe el `write` contra pipe cerrado que
  causa el SIGPIPE. *(Nota: llevan las banderas juntas, `-Eq`, por eso no aparecen buscando `grep -q`.)*

**Estado final: CERO `| grep -q` terminales en `scripts/` y `security/scripts/`. 11 pipelines corregidos.**

### 45.4 Lo que NO verifiqué en este pase

- **No levanté el stack.** Los dos jobs son **estáticos** (leen ficheros, sin red y sin stack); eso es todo lo
  que este pase demuestra. Que el `--assert` se entienda con el backend real lo confirma la primera corrida
  de `e2e-real.yml`, no este documento.
- **No leí los logs de CI del run `34441149856`.** El proxy de egress deniega (403) el host de artefactos de
  Actions y **no se rodeó**. El diagnóstico se hizo reproduciendo el árbol exacto del SHA y midiendo la
  carrera en local; la API sí confirmó **qué paso** falló y con qué código.
- **No toqué `backend/` ni `frontend/`**, ni producción.
- **No arreglé los `grep -q` de los scripts de aprovisionamiento** (`seed.sh`, `seed-synthetic.sh`,
  `check-graded-estimate-dials.sh`, `stripe-test-key-preflight.sh`): medidos y declarados en §45.3,
  **no corregidos**. Solo se corrigieron las guardas que gatean el candidato de release.
- **No demostré que la tasa de falsos rojos sea idéntica en el runner de GitHub.** Las cifras (73/400,
  31/400, 0/400) se midieron **en este entorno**, con `mawk 1.3.4` y `bash 5.2` — los mismos que
  `ubuntu-latest`, pero el reparto exacto de la carrera depende del planificador. Lo que sí está
  demostrado es la **dirección**: el pipeline sin `-q` no puede producir el 141, porque no hay pipe que
  cerrar antes de tiempo.

## 46. El rollback de M-50, la doctrina que era falsa, y el cuelgue mudo del arnés (2026-09-10, bloqueante de QA)

> **Origen:** QA **rechazó** el candidato de release. Uno de los dos bloqueantes es **mío**, no del
> producto: el release **no es reversible sólo con código** y mi runbook afirmaba que sí, en tres
> sitios distintos. Esta sección corrige eso y cablea lo que faltaba.
>
> **Lo que NO se toca, y conviene decirlo primero:** el `NOT NULL` sin default de M-50 es **correcto
> por diseño** (§4.44.e: el fallo ruidoso ES la funcionalidad) y aquí no se debilita ni un poco. El
> defecto no estaba en la migración: estaba en que **el runbook no la conocía**.

### 46.1 ⛔ BLOQUEANTE — M-50 NO se revierte sólo con código

**El agravante, medido:** `grep M-50 docs/DEVOPS_NOTES.md` daba **0 coincidencias** antes de este
pase. La migración de dinero más peligrosa del release no aparecía en mis notas, mientras §26.4,
§27.4, §28.6 y §29.7 repetían *«aditiva ⇒ rollback = redeploy del commit anterior»*.

**Qué pasa exactamente.** `20260909120000_m50_price_convention` añade cinco columnas. Tres son
inofensivas al revertir; **dos no**:

| columna | forma final | tras revertir el código |
|---|---|---|
| `Order.ivaTransferPct` | NULLABLE | inerte ✅ |
| `ShipmentRequest.ivaTransferPct` | NULLABLE | inerte ✅ |
| `ShipmentRequest.shippingCostIvaCents` | `NOT NULL DEFAULT 0` | inerte ✅ |
| **`Order.priceConvention`** | **`NOT NULL` SIN default** | ⛔ **todo `INSERT` LANZA** |
| **`ShipmentRequest.priceConvention`** | **`NOT NULL` SIN default** | ⛔ **todo `INSERT` LANZA** |

El código anterior al candidato tiene **0 referencias** a `priceConvention` en `orders/`,
`shipments/` y `payments/` (contado por QA); el candidato lo escribe en 4 sitios. El propio fichero
de migración lo avisa en su línea 118: *«a partir de aquí, un `INSERT` que omita `priceConvention`
LANZA (candado `IVA-3(e)`)»*.

**MEDIDO** (2026-09-10, Postgres 16 con M-50 aplicada; todo dentro de una transacción con `ROLLBACK`,
la base de QA quedó intacta — 7 filas antes y después). Se reprodujo el `INSERT` del código viejo
copiando una fila real de `Order`:

```
A) sin paso de datos:
   ERROR:  null value in column "priceConvention" of relation "Order"
           violates not-null constraint
   DETAIL: Failing row contains (…, invitado@dominio.com, TCG-000209, direct_ship, …)
                                      ↑ un checkout de INVITADO real

B) tras SET DEFAULT 'IVA_EXCLUSIVE', el MISMO INSERT:
    orderNumber    | priceConvention | ivaTransferPct
   ----------------+-----------------+----------------
    ROLLBACK-PROBE | IVA_EXCLUSIVE   |  (null)
   INSERT 0 1
```

⇒ **Alcance del daño si alguien ejecuta la doctrina vieja:** checkout registrado, checkout de
invitado y creación de envíos. El negocio entero, en silencio hasta la primera compra.

#### ✅ SÍ HAY ROLLBACK SEGURO — y exige un PASO DE DATOS ANTES del redeploy

**No es «revertir la migración».** No se borra ninguna columna, no se pierde el backfill y el enum se
queda. Se le **da un default temporal** a las dos columnas de convención, y se le quita después.

**¿No es eso reintroducir justo lo que §4.44.e prohíbe?** No, y la distinción es la misma que la
propia M-50 usa para permitir el PASO 3-BIS: es de **significado**, no de sintaxis.

- §4.44.e prohíbe el default porque, **bajo el régimen nuevo**, un camino de escritura que olvide el
  campo cobraría bajo una convención y archivaría bajo la otra. El default convierte un hueco en una
  **afirmación falsa**.
- En una **ventana de rollback no existe régimen nuevo**: el único código vivo es el anterior, cuya
  aritmética **es** la exclusiva. Ahí `IVA_EXCLUSIVE` no es una suposición: es lo que de verdad pasó.

**⚠️ Y por eso mismo el default es TEMPORAL Y OBLIGATORIO DE QUITAR.** En cuanto se vuelva a
desplegar el candidato, el régimen nuevo existe y el default recupera toda su capacidad de mentir.

**⛔ Y no confíes en que lo atrape otro candado.** `IVA-3(c)`
(`backend/test/migration.m50-no-default.spec.ts`) lee **el TEXTO de la migración en el repo**: un
`SET DEFAULT` aplicado a mano en producción le es **invisible**. La mitad que sí mira
`information_schema` vive en `test/integration/iva-price-convention.e2e-spec.ts`, que corre contra la
BD de **CI** y jamás contra producción. Sin la herramienta de abajo, **ese default no tiene ningún
vigilante en prod**.

#### RUNBOOK — orden DATOS → CÓDIGO (regla de oro §7)

```bash
# ── 0. Snapshot/PITR de la Postgres de prod. Siempre, y ANTES de nada.
#      (Railway → Postgres → Backups → Create backup)

# ── 1. Comprobar que de verdad hace falta el paso de datos (no lo asumas):
export DATABASE_URL='<url de la BD que se va a operar>'
./scripts/rollback-safety-probe.sh <sha-del-deploy-anterior>
#    → lista las columnas obligatorias que el commit destino NO conoce.
#      Con M-50 aplicada y destino sin M-50, salen exactamente:
#         · Order            priceConvention
#         · ShipmentRequest  priceConvention

# ── 2. PASO DE DATOS. Primero en simulacro (no escribe nada), luego de verdad:
./scripts/m50-rollback-gate.sh --prepare-rollback          # imprime el SQL y sale
./scripts/m50-rollback-gate.sh --prepare-rollback --yes    # lo aplica
#    SQL exacto que corre (no toca ni un importe, no reescribe ninguna fila):
#      ALTER TABLE "Order"           ALTER COLUMN "priceConvention" SET DEFAULT 'IVA_EXCLUSIVE';
#      ALTER TABLE "ShipmentRequest" ALTER COLUMN "priceConvention" SET DEFAULT 'IVA_EXCLUSIVE';

# ── 3. AHORA sí, revertir el código.
#      Railway (backend → Deployments → Redeploy el deploy previo bueno) y
#      Vercel (Deployments → Promote to Production el build previo).

# ── 4. Verificar que el dinero volvió a fluir (no basta con /health):
#      hacer UN pedido de prueba, o:
#      SELECT count(*) FROM "Order" WHERE "createdAt" > now() - interval '10 min';
```

**Y AL VOLVER HACIA ADELANTE (esto es lo que se olvida):**

```bash
./scripts/m50-rollback-gate.sh --assert-forward-safe   # ROJO si queda el default → NO despliegues
./scripts/m50-rollback-gate.sh --finish-rollforward --yes
./scripts/m50-rollback-gate.sh --assert-forward-safe   # ahora VERDE
# recién ahora: desplegar el candidato otra vez
```

**Verificado de punta a punta** (2026-09-10, base local con M-50): `--assert-forward-safe` verde →
`--prepare-rollback --yes` → el `INSERT` del código viejo **pasa** y graba `IVA_EXCLUSIVE` →
`--assert-forward-safe` **rojo** con los dos defaults nombrados → `--finish-rollforward --yes` →
idempotente a la segunda → `--assert-forward-safe` verde → el `INSERT` viejo **vuelve a lanzar**
(`IVA-3(e)` rearmado). La base quedó como estaba.

### 46.2 Lo que el rollback **NO** devuelve — dos asimetrías que hay que conocer ANTES

Revertir el código **no** devuelve el sistema a su estado anterior. Dos cosas persisten, y quien
ejecute el rollback tiene que saberlo o creerá que terminó cuando no terminó.

**(a) 💰 El proveedor de precios NO vuelve solo — hay que moverlo A MANO (`I-PP3`).**
El seed **no corre en el deploy**: está comentado a propósito en `deploy.yml:254` (es una acción de
una sola vez, §11.D). Consecuencia directa: **revertir el commit NO revierte el dial
`price_provider`.** Si alguna vez se sembró o se movió esa fila, ahí sigue. El dial es un
`ConfigSetting` de BD y sólo se mueve por su puerta:

```
PUT /api/v1/admin/settings   { "price_provider": "pokemontcg_io" }
```
super_admin, auditado. **⛔ Nunca por env** (`PRICE_PROVIDER` no flipea nada, §23.8) **ni por SQL
directo** (§32.4). Surte efecto en la siguiente corrida del `price-ingest`.

*Evidencia viva de que esto pasa de verdad:* el stack local de hoy reporta
`vigente: 'pokemontcg_io' · primario: 'tcgcsv_singles'` — una base sembrada antes de `D-PP-1` que
conserva la fila legacy, porque los seeds hacen `upsert(… update:{})` y **no llegan a una base ya
sembrada** (§32.1). Es exactamente el mismo mecanismo.

**(b) 📚 El corte de fecha de `syncAll` es de ida y no de vuelta.**
Al revertir, `syncAll` deja de honrar el corte y **vuelve a arrastrar sets anteriores a 2024**. Esas
filas **persisten**: el sync hace upserts y no borra. Reaplicar el candidato filtra las **futuras**
corridas pero **no limpia lo ya escrito**. No es dinero y no bloquea, pero si alguien compara el
catálogo antes/después del ciclo y ve sets de más, **es esto y no un bug**. Limpiarlo, si se
quisiera, es una decisión de producto (PO/arquitecto), no un paso de rollback.

### 46.3 La doctrina corregida: «aditiva» ⇏ «reversible» — y cómo se comprueba cuál es cuál

La frase *«la migración es aditiva ⇒ rollback = redeploy del commit anterior»* aparecía en **§26.4,
§27.4, §28.6 y §29.7** — cuatro sitios, no tres: al corregir los tres que QA señaló apareció el
cuarto. Era verdad para M-31/32/39/40/41 y **falsa para M-50**. El problema no era el
adjetivo: era que la regla dependía del criterio de quien estuviera de guardia.

**Son dos propiedades distintas y hay que dejar de confundirlas:**

| | qué mira | qué garantiza |
|---|---|---|
| **aditiva** | hacia **atrás**: ¿destruye datos existentes? | que no se pierde nada |
| **reversible sólo con código** | hacia **adelante**: ¿el código anterior puede seguir **escribiendo**? | que el rollback no rompe nada |

**Sólo la segunda importa en un rollback**, y M-50 es la prueba de que se puede ser aditiva sin ser
reversible.

**LA REGLA, enunciada para que no haga falta criterio:**

> Un release es **reversible-sólo-con-código** ⟺ para **toda** columna `NOT NULL` **sin default** de
> la base, el commit al que se revierte **la conoce**. Si el destino no la conoce, su cliente Prisma
> nunca la incluirá en el `INSERT`, Postgres rechazará la fila, y esa tabla queda **muerta para
> escritura**.

**CÓMO SE COMPRUEBA — un comando, no una lectura:**

```bash
export DATABASE_URL='<la BD que se va a operar>'
./scripts/rollback-safety-probe.sh <ref-destino>     # p. ej. origin/main
```

Pregunta a la **BD viva** qué columnas son `NOT NULL` sin default, lee el `schema.prisma` **del
commit destino** (`git show <ref>:…`) y cruza. Verde ⇒ redeploy y ya. Rojo ⇒ **hay paso de datos**.

*Discriminación medida (2026-09-10):* sobre **153** columnas `NOT NULL` sin default de esta base,
con destino `origin/main` señaló **exactamente 2** — `Order.priceConvention` y
`ShipmentRequest.priceConvention` — y **cero falsos positivos**: dejó fuera `shippingCostIvaCents`
(tiene `DEFAULT 0`) y los dos `ivaTransferPct` (nullable). Control negativo con destino `HEAD`:
verde. Es decir, sabe distinguir, no dice que sí a todo.

**⚠️ Límite declarado, sin adornos:** cubre el modo de fallo `NOT NULL`-sin-default, que es el que
nos mordió y el más común. **No** cubre CHECK constraints nuevos, triggers, valores de enum que el
código viejo no sabe mapear, ni cambios de tipo. Un verde ahí significa «no hay columnas
obligatorias huérfanas», **no** «revertir es gratis».

**Y si el probe sale rojo sobre una columna que NO es de M-50: no improvises un `DEFAULT`.** Un
default sólo es honesto si el código destino escribe de verdad bajo esa semántica. Si no puedes
afirmarlo, **no hay rollback seguro por esta vía** — escala al arquitecto y valora restaurar del
snapshot (§7). *Decir «no hay rollback seguro» es una respuesta legítima; inventar uno falso no.*

### 46.4 El arnés E2E se colgaba en SILENCIO — y el `timeout` no salvaba

**Síntoma medido por QA:** `./scripts/stack-native.sh up --seed | tail` **nunca terminaba**. ~36
minutos con el pipeline bloqueado, **sin un solo byte de salida**, antes de que Playwright arrancara.

**Causa raíz, y es mía.** `start_backend` (`:499`) y `start_frontend` (`:622`, `:629`) lanzaban el
daemon así:

```bash
( cd "$DIR" && nohup CMD > log 2>&1 & echo $! > pid )
```

El `( … )` envolvente **sobrevive como padre del daemon y hereda el stdout del script**. Con
`script | tail`, ese subshell mantiene la tubería abierta mientras viva el servidor ⇒ `tail` no ve
EOF jamás. **Yo ya había diagnosticado y arreglado este defecto en `start_s3`** (el bloque de
comentarios de `:319` lo explica entero) y **no lo apliqué a los otros dos lanzadores**.

**MEDIDO con `sleep` de maqueta y `timeout 10 script | cat`:**

| patrón | cierra la tubería en | `$!` apunta a |
|---|---|---|
| `( cd X && nohup CMD > log 2>&1 & echo $! )` | **45 s** (la vida del daemon) | `bash` ⛔ |
| `( cd X && setsid CMD > log 2>&1 </dev/null & … )` | **45 s** | `bash` ⛔ |
| `setsid env -C X CMD > log 2>&1 </dev/null &` | **1 s** ✅ | el daemon ✅ |

⇒ El culpable **no es `nohup` vs `setsid`: es el subshell envolvente.** Poner `setsid` sin sacar el
`( … )` no arregla nada — y es la «corrección» que parece obvia. Para cambiar de directorio sin
subshell: **`env -C "$DIR"`**.

**⚠️⚠️ Y EL `timeout` NO SALVA — esto es lo más importante de aquí.** En el mismo experimento,
`timeout 10 script | cat` devolvió **`rc=0` a los 45 segundos**. No `rc=124`, no a los 10: `timeout`
mata al **primer eslabón**, no al pipeline; el lector siguió esperando EOF y el pipeline acabó
reportando **ÉXITO**. Un `timeout N cmd | tail` en un workflow **no acota nada y encima miente**.
Si hay que acotar un pipeline entero, el idioma es:

```bash
timeout N bash -c 'cmd | tail'
```

**Arreglado** en `stack-native.sh`: los tres lanzadores usan `setsid env -C … > log 2>&1 < /dev/null &`
a nivel de función, sin `( … )`. Efecto colateral igual de valioso: el pidfile guarda **el daemon** y
no un `bash` intermediario, así que `down` apaga lo que dice apagar.

**Verificado sobre el arnés real:** `timeout 900 bash -c './scripts/stack-native.sh up 2>&1 | tail -25'`
→ **9 s y 22 s** en dos corridas, con salida completa. Antes: nunca.

**Candado:** `scripts/check-daemon-stdout-leak.sh`, job `daemon-stdout-leak` en `ci.yml` (y `skipped`
**no** es verde en `ci-ok`, mismo criterio que §39/§43/§44). Dos modos:

- **MODO 1 — autoprueba.** Monta los tres patrones y **mide** cuál fuga. Si dejara de reproducir la
  fuga, sale ≠0 declarándose **NO CONCLUYENTE** en vez de verde: un candado que ya no detecta lo que
  vigila es un candado roto, no un candado verde (mismo criterio que §44).
- **MODO 2 — barrido estático** de `scripts/*.sh` con la regla que el MODO 1 acaba de justificar:
  (a) sin `( … )` envolvente, (b) las tres redirecciones.

*Mutación probada:* reintroduciendo el patrón viejo en `start_backend`, el barrido lo mata
(`1 de 4 lanzamientos con fuga`, rc=1). Y el barrido se excluye **a sí mismo**, con motivo escrito:
contiene los patrones malos a propósito como maqueta del MODO 1.

> **Por qué esto merecía un job y no un comentario.** Este defecto **no produce rojo**. Produce un
> job que *parece «corriendo»* y no está midiendo nada. Es la misma familia que los falsos verdes de
> §44 y los falsos rojos de §45, pero **peor de detectar**: un falso rojo se mira, un falso verde se
> audita — **un falso «en curso» no se ve nunca**. No hay artefacto que revisar, no hay línea de log
> que leer. El síntoma es «CI va lento hoy».

### 46.5 El hueco de Stripe: que no se pueda confundir con «pasó»

**Estado, sin maquillar:** los **tres flujos de dinero de punta a punta** —comprar, comprar como
invitado, retirar/envíos— están **SIN MEDIR**. No hay clave de prueba de Stripe en el repositorio.
`scripts/stripe-test-key-preflight.sh` lo detecta y, en la ruta de **promoción a prod**, **aborta en
rojo** (§33). Eso está bien y **no se cambia**: un job vacío en verde sería un falso verde.

El problema que quedaba es otro: en las corridas que **no** promueven, el preflight salta los tres
smokes, avisa con `::warning` + tabla en el step summary… y **el run termina verde**. En la lista de
Actions se ve **idéntico** a uno que sí midió el dinero. Quien pasa revista a diez runs no abre diez
step summaries: mira diez puntos verdes.

**Lo que se añadió** (`e2e-real.yml`, sin tocar el veredicto): cuando `MONEY_GATE=off`, el run sube
un artefacto llamado

```
SIN-MEDIR-comprar-invitado-retirar
```

con un `LEEME-EL-DINERO-NO-SE-PROBO.md` dentro que dice qué **no** se ejecutó, que **no está
aprobado**, y cómo desaparece. El **nombre es el mensaje**: aparece en la portada del run, junto al
reporte de Playwright, sin abrir un solo log. No se puede leer como «pasó».

**⚠️ Esto NO sustituye a la clave.** Mientras no existan los secrets `STRIPE_TEST_SECRET_KEY` **⚠️ CORREGIDO 2026-09-10 → §51: las dos claves de prueba LLEVAN TRES DÍAS en los secrets; el nocturno `34477885121` corrió los flujos en REAL con `MONEY_SKIPPED` vacío. Lo que falta es `STRIPE_TEST_WEBHOOK_SECRET`, y ya no bloquea (§50.4).**
(`sk_test_…`) y `STRIPE_TEST_PUBLISHABLE_KEY` (`pk_test_…`), los tres flujos siguen sin medir. Es
una **petición al dueño** (§31.1), no un problema de infraestructura, y ninguna cantidad de tooling
la resuelve.

### 46.6 Qué queda para quién

| Punto | Dueño | Estado |
|---|---|---|
| Runbook de rollback de M-50 (datos→código) + herramienta | devops | ✅ escrito y **probado end-to-end** |
| Doctrinas §26.4 / §27.4 / §28.6 **y §29.7** corregidas | devops | ✅ las **cuatro** apuntan a §46.3 (§29.7 apareció al revisar las otras tres) |
| Regla mecánica «reversible ⇔ …» + `rollback-safety-probe.sh` | devops | ✅ con discriminación medida (2 de 153) |
| Cuelgue del arnés + candado en CI | devops | ✅ arreglado y verificado sobre el arnés real |
| Marcador del hueco de dinero en `e2e-real` | devops | ✅ |
| **Clave de PRUEBA de Stripe** (3 flujos de dinero) | **HUMANO/dueño** | ⏳ **sin ella no hay E2E de dinero** |
| **Ejecutar el rollback** (si hiciera falta) | **HUMANO** con egress a prod | ⏳ devops no tiene acceso a los dashboards |
| Limpiar sets pre-2024 arrastrados (§46.2b) | PO/arquitecto | ⏳ decisión de producto, no de rollback |

---

## 47. `trivy-fs` rojo en toda la rama por **un** CVE sin parche — y por qué no se acotó el escáner (2026-09-10, último bloqueante del release)

`Security SAST` llevaba rojo toda la rama. De los cinco jobs, cuatro en verde (`semgrep`,
`gitleaks`, `npm-audit`, `trivy-image`) y **uno** en rojo, `trivy-fs`, con **exactamente una**
vulnerabilidad:

```
Library: dicer · CVE-2022-24434 · HIGH · affected
Installed: 0.3.0 · Fixed Version: (VACÍO)
dicer: nodejs service crash by sending a crafted payload
```

`sast-ok` caía en cascada detrás. Diagnóstico previo (medido, no mío): `npm ls dicer` vacío en
`backend/` y en `frontend/`; única aparición en **`scripts/s3-local/`** — la maqueta S3 de la ruta
nativa (§39), propiedad de devops. Cadena: `s3rver@3.7.1 → busboy@^0.3.1 → dicer@0.3.0`.

### 47.1 La decisión: **eliminar el componente**, no acotar el escáner ni ignorar el CVE

Había tres salidas sobre la mesa. La elegida es la primera, en su forma barata.

| Opción | Veredicto | Por qué |
|---|---|---|
| **Sustituir `s3rver` entero** por algo mantenido | ❌ | No hay equivalente. MinIO no se puede descargar en esta máquina (`dl.min.io` → `CONNECT tunnel failed, 403` a través del proxy, §39); LocalStack necesita daemon Docker y aquí **no hay** (`/var/run/docker.sock` no existe). Y `server.js` engancha la API interna de s3rver (`lib/models/account`) para registrar credenciales y verificar SigV4: reescribirlo el día del cierre cambia el arnés bajo los pies de QA. |
| **Acotar `trivy-fs`** con `skip-dirs: scripts/s3-local/` | ❌ | Apaga el escáner sobre **todo lo que aparezca ahí mañana**, no sobre este CVE. Compra un verde a cambio de un punto ciego permanente. |
| **Aceptarla como riesgo declarado** en `.trivyignore` | ❌ | Un ignore por ID vale para **cualquier ruta**, y no caduca. La exposición real era ~nula, pero eso no justifica dejar el aviso apagado para siempre. |
| **✅ Quitar la dependencia vulnerable del árbol** | ✅ | `overrides: { "busboy": "1.6.0" }` en `scripts/s3-local/package.json`. busboy 1.x absorbió el parser multipart (`streamsearch`) y **ya no depende de dicer**: el paquete desaparece del árbol entero. Cero excepciones, cero recorte de alcance, el gate conserva todos los dientes. |

Resultado medido tras el cambio:

```
$ cd scripts/s3-local && npm ls dicer
tcg-s3-local@1.0.0
`-- (empty)
$ grep -c dicer package-lock.json
0
$ rm -rf node_modules && npm ci     # es lo que hace stack-native.sh
added 113 packages   ·  busboy 1.6.0  ·  node_modules/dicer: no existe
```

### 47.2 Por qué el override es seguro aquí — **medido, no supuesto**

busboy 1.x rompe la API de 0.x (`new Busboy(cfg)` → `busboy(cfg)`; `finish` → `close`; firma del
evento `file`). Eso importaría si algo usara busboy. Lo que se comprobó:

1. **Único consumidor en s3rver:** `lib/controllers/object.js::postObject` — la subida por
   **formulario HTML** (`POST /bucket`, POST-policy). Ninguna otra línea de la librería lo toca.
2. **Esa ruta ya era inalcanzable en este stand-in ANTES del override.** La guarda anti-anónima de
   `server.js` (§39.2.2) exige firma en la cabecera `Authorization` o en la query `X-Amz-Signature`;
   un POST de formulario lleva su firma en los **campos del form**. Medido en los dos árboles:

   | Petición | busboy 0.3.1 (antes) | busboy 1.6.0 (después) |
   |---|---|---|
   | `POST /tcg-photos` multipart sin firma | **403** | **403** |
   | ídem + `Authorization:` sin `x-amz-content-sha256` | **400** `InvalidRequest` | **400** `InvalidRequest` |
   | ídem con `x-amz-content-sha256` y fecha vieja | **403** `RequestTimeTooSkewed` | **403** `RequestTimeTooSkewed` |

3. **El backend tampoco la usa:** `backend/src/modules/uploads/uploads.service.ts` firma
   `PutObjectCommand` con `getSignedUrl` (**PUT presignado**). No hay `createPresignedPost` en todo
   `backend/` (grep vacío).
4. **Round-trip completo del arnés, idéntico antes y después** (contra el `server.js` real, con las
   credenciales de `.env.example`):

   | Comprobación | Esperado | 0.3.1 | 1.6.0 |
   |---|---|---|---|
   | PUT presignado, firma buena | 200 | ✅ | ✅ |
   | PUT presignado, **secreto equivocado** | 403 | ✅ | ✅ |
   | GET presignado, firma buena | 200 | ✅ | ✅ |
   | GET presignado devuelve el objeto íntegro | igual | ✅ | ✅ |
   | GET **anónimo** (sin firma) | 403 | ✅ | ✅ |

   Es decir: la verificación SigV4 de §39.2.2 y la guarda anti-anónima siguen funcionando exactamente
   igual. Lo que se probaba con el arnés se sigue probando.

El porqué del cambio está escrito **dentro** de `scripts/s3-local/package.json` (clave `"//overrides"`),
para que quien lea el manifiesto no tenga que buscarlo.

### 47.3 El candado tiene que **saber morder**: `security/scripts/trivy-fs-selftest.sh`

Este es el tercer candado del proyecto que se verifica en vez de creerse (los otros dos:
`dast-selftest.sh` §P-77, y el arnés E2E §46.4). Motivo: **poner verde un gate quitando el hallazgo
es indistinguible de poner verde un gate dejando de mirar.** Si el rojo desaparece, hay que demostrar
que el rojo todavía es posible.

```bash
./security/scripts/trivy-fs-selftest.sh
```

Qué hace, en tres pasos:

1. Corre **el gate real** (mismo binario, misma `security/trivy.yaml`, mismo
   `security/.trivyignore`, mismo `--severity HIGH,CRITICAL --ignore-unfixed=false --exit-code 1`,
   mismo `scan-ref .`) sobre el árbol limpio → **exige VERDE**.
2. Planta `scripts/s3-local/.trivy-selftest-canary/package-lock.json` con **`dicer@0.3.0`**
   (CVE-2022-24434, *el* CVE de este release) y **`minimist@1.2.0`** (CVE-2021-44906, testigo
   independiente) y repite **el mismo comando** → **exige ROJO**, exige los dos CVE **por su nombre**
   en el informe, y exige que el informe **atribuya** el hallazgo a la ruta del canario.
3. Borra el canario (`trap`, también en fallo) y comprueba que no quedó nada en el árbol.

El canario se planta **dentro de `scripts/s3-local/`** a propósito: es el directorio del que se
sospechó, así que es el directorio del que hay que demostrar que sigue en alcance. Si alguien
"arreglara" un rojo futuro con un `skip-dirs` de esa ruta o con una entrada de ese CVE en
`.trivyignore`, este self-test se pone en rojo y lo delata.

**Verificado en los dos sentidos antes de cablearlo** (con un `trivy` de mentira en el `PATH`, para
poder forzar cada resultado):

| Escáner simulado | Resultado esperado del self-test | Obtenido |
|---|---|---|
| Ve el canario y reporta los dos CVE | **exit 0** («verde en limpio, rojo con canario») | ✅ exit 0 |
| **Ciego** a `scripts/s3-local/` (siempre verde) | **exit 1** con `::error` explicando el punto ciego | ✅ exit 1, y el canario borrado igualmente |

Cableado: paso **`Self-test de trivy-fs (el candado tiene que saber morder)`** dentro del job
`trivy-fs` de `.github/workflows/security-sast.yml`, con `if: ${{ !cancelled() }}` (queremos el
diagnóstico también cuando el gate real ya está rojo). Usa el mismo binario que instaló el paso de
apt del job, así que no añade minutos de instalación.

### 47.4 Dónde lo lee **seguridad** — una excepción que sólo vive en un config es una excepción que nadie revisa

Aunque aquí **no quedó ninguna excepción**, el mecanismo se deja montado, porque el problema no era
esta excepción concreta sino que las decisiones de escáner viven donde nadie las mira:

- **`security/README.md` → «Registro de decisiones de escáner — LEER EN LA FASE DE SEGURIDAD»**,
  entre los marcadores `<!-- REGISTRO:INICIO -->` / `<!-- REGISTRO:FIN -->`. Fuente única. Dice, hoy:
  excepciones activas **ninguna**, alcance del `trivy fs` **el repo completo**, la decisión de §47 con
  su porqué, el riesgo residual, y el self-test que la amarra.
- **El job `trivy-fs` publica ese bloque en `$GITHUB_STEP_SUMMARY` en CADA corrida** (paso
  `Publicar el registro de decisiones de escáner en el resumen`). Quien abra el run lo ve sin
  buscarlo; si mañana alguien mete una excepción y no toca el registro, el resumen seguirá diciendo
  «ninguna» y la contradicción con `.trivyignore` salta a la vista.
- **`security/.trivyignore`** conserva el histórico: qué se consideró, qué se descartó y por qué.

### 47.5 Riesgo residual declarado

**`s3rver@3.7.1` no tiene mantenimiento**, y `scripts/s3-local/server.js` usa su API interna
(`lib/models/account`) a sabiendas, con la versión clavada sin `^` para que un cambio falle
ruidosamente al arrancar. Hoy **no tiene ningún HIGH/CRITICAL abierto** (era `dicer`, y ya no está).
Lo que acota el riesgo:

- Es **tooling de desarrollo**: no está en `backend/` ni en `frontend/`, no lo copia
  `Dockerfile.backend` ni `Dockerfile.frontend`, no viaja a ningún deploy.
- Sólo escucha en `127.0.0.1` (`S3_LOCAL_HOST` por defecto) y sólo durante las corridas del arnés
  nativo, que es la ruta *sin* Docker; en CI y en Docker el object storage es MinIO, y en producción R2.
- Sigue **dentro del alcance del escáner**: cualquier CVE HIGH/CRITICAL que aparezca en su árbol
  vuelve a poner `trivy-fs` en rojo, y el self-test de §47.3 demuestra que ese rojo es alcanzable.

Está declarado en el registro de §47.4 para el veredicto del rol **seguridad**. **No** se anotó en
`docs/TECH_DEBT.md`: esa entrada la escribe el rol dueño a petición del techlead, y aquí el dueño es
devops — si seguridad o techlead la quieren allí, el apunte lo pone devops.

### 47.6 Qué queda para quién

| Punto | Dueño | Estado |
|---|---|---|
| `dicer`/CVE-2022-24434 fuera del árbol (override de busboy) | devops | ✅ `npm ls dicer` vacío, `npm ci` reproducible |
| Round-trip del arnés S3 intacto (SigV4 + anti-anónimo) | devops | ✅ 5/5 idéntico antes y después |
| Self-test de `trivy-fs` + cableado en CI | devops | ✅ probado en verde **y en rojo** |
| Registro de decisiones visible en cada run | devops | ✅ `security/README.md` → step summary |
| Revisar el riesgo residual de `s3rver` sin mantenimiento | **seguridad** | ⏳ declarado en §47.5 / registro §47.4 |
| Sustituir el stand-in por MinIO en la ruta nativa | devops | ⏳ bloqueado por egress (`dl.min.io` 403) — no es deuda de código |

---

## 48. Tres candados que avisaban sin gatear — y el hueco de dinero, más difícil de ignorar (2026-09-10, hallazgos de QA)

> **Origen.** QA corrió el candidato de release contra el stack nativo y reportó tres cosas mías. La
> primera es de las que **invalidan mediciones ya hechas**, así que va primero. Las tres son la misma
> familia, y es una familia que este repo ya conoce: **S-PROC-1** (npm audit que no corría), **P-77**
> (DAST sin blanco, §44), **§45.2** (el rojo que defendía la conducta prohibida). El patrón:
> *una verificación que técnicamente corre, no puede cambiar ningún desenlace, y la lee quien ya lo sabía.*

### 48.1 🔴 `up --gate` daba por bueno un stack cuya paridad `I-PP5` HABÍA FALLADO

**Lo que QA vivió** (no dedujo): su `./scripts/stack-native.sh up --seed --gate` imprimió, literal,
`✗ SIN PARIDAD (I-PP5)` —el dial vivo era `pokemontcg_io`, el proveedor **legacy que aplana los
acabados**, en vez del primario `tcgcsv_singles`— **y el script siguió adelante**. El `rc=1` que
recibió no venía de ahí: venía del **gate de capacidades** (§39), que en esta máquina falla por no
haber claves de Stripe.

**La consecuencia exacta, que es lo grave:** con claves de Stripe presentes (o sea, en cuanto el
humano cree los secrets), ese mismo `up --gate` habría salido **0** sobre un stack que el propio
script declara no citable — *«Un E2E/DAST verde aquí NO es citable como gate del sistema que se
promueve»* (ARCHITECTURE §4.35a(d)). Y era **mi propio principio aplicado a una cosa y no a la otra**:
veinte líneas más abajo, en el gate de capacidades, el script decía ya *«Un aviso que no cambia el
código de salida no gatea nada: lo lee quien ya lo sabía»*.

QA lo corrigió a mano por la vía documentada (`PUT /admin/settings`, auditado) y **re-asertó antes de
medir**, así que sus 37 E2E verdes **sí** son con paridad. Su frase es la que importa: *«si no llego a
mirar el log, no lo eran»*.

**El arreglo** (`scripts/stack-native.sh`):

| Situación | Antes | Ahora |
|---|---|---|
| paridad falla + `up --gate` | `warn`, sigue, **exit 0** si lo demás va bien | `gate_fail` + `gate_verdict` ⇒ **exit 1** |
| paridad falla + `up` a secas | `warn`, exit 0 | **igual** (informe: `up` a secas es un stack de trabajo, no un gate) |
| capacidades fallan | `exit 1` inmediato | `gate_fail` y veredicto al final (**los motivos ya no se tapan entre sí**) |

Dos decisiones deliberadas:

- **El stack sigue quedando ARRIBA en los dos casos.** Lo que cambia es el veredicto, no la
  disponibilidad — y tiene que ser así, porque la vía de arreglo (`PUT /admin/settings`) **necesita el
  backend vivo**. El rojo dice «esta corrida no es citable», no «no tienes stack».
- **`FRONTEND_MODE=build` sin `--gate` aplica el mismo listón** (`GATE_MODE=1`). Quien pide un
  frontend horneado está pidiendo un artefacto de gate.

**«Sin paridad» y «no pude medir la paridad» ya no se narran igual.** Lo destapó la propia
demostración de abajo: al repetir el gate varias veces seguidas, el login del asertor chocó con el
límite de **5/min de `/auth/login`** (SEC-C1) y devolvió `30` — *no pude leer el dial*. El mensaje,
sin embargo, afirmaba «el dial NO está en el primario», un hecho que nadie había medido. Ahora:
`rc=20` ⇒ «PARIDAD I-PP5 EN ROJO» con el arreglo del panel M10; **cualquier otro `rc≠0`** ⇒ «PARIDAD
I-PP5 **SIN MEDIR** (asertor rc=N)» con el arreglo que toca (credenciales / `ADMIN_JWT` / backend
caído). Los dos siguen siendo **rojos** en `--gate`: *fail-closed, «no medido» jamás es verde* — pero
ninguno afirma más de lo que pasó.

#### La demostración, en vivo y contra el stack real

Se hizo lo que pidió QA: **poner el dial en el legacy y medir el código de salida**. Sin reiniciar el
stack (había otro rol trabajando en `frontend/` contra él), así que se ejecutó el bloque de decisión
**real** de `stack-native.sh` —copia con los *lanzadores de procesos* neutralizados, nada de la lógica
de gate tocada— contra el **backend vivo de :3099**, con el **asertor de paridad real** y el gate de
capacidades forzado a VERDE a propósito, para aislar la paridad (= el escenario «con claves de Stripe
presentes» que describió QA). El dial se movió y se restauró **por la vía auditada** (`PUT
/admin/settings`, HTTP 200 las dos veces).

| Caso | dial vivo | código de `stack-native.sh` | `up --gate` |
|---|---|---|---|
| A | `tcgcsv_singles` (primario) | **nuevo** | **rc=0** |
| B | `pokemontcg_io` (legacy) | **el previo — el que corrió QA** | **rc=0** ← el defecto, reproducido |
| C | `pokemontcg_io` (legacy) | **nuevo** | **rc=1** ← `✖ GATE ROJO: PARIDAD I-PP5 EN ROJO` |
| D | `tcgcsv_singles` (restaurado) | **nuevo** | **rc=0** |

B y C son **el mismo dial y el mismo backend**: lo único que cambia es el código. Y A/D demuestran lo
otro que hay que demostrar de un candado: **que sabe abrirse**. El stack quedó como se encontró —
`price-provider-parity.sh --assert` en verde (rc=0) al terminar.

#### El candado, probado en cada push: `scripts/check-gate-parity-canary.sh`

La demostración de arriba vale para hoy. Para mañana está el canario, en `ci.yml`
(job `parity-gate-canary`, y `ci-ok` lo trata como los otros cinco: **`skipped` NO es verde**).
Ejercita el bloque de decisión **real** (copiado byte a byte; el propio canario **verifica que la copia
conserva las líneas que deciden** y se pone rojo si alguien las cambia) con dobles de los dos hijos, y
exige los **seis desenlaces**: paridad roja ⇒ rojo · `up` a secas ⇒ verde con aviso · todo bien ⇒
**verde** (un candado que siempre cierra no es un candado) · capacidades rojas ⇒ rojo (no-regresión de
§39) · las dos rojas ⇒ rojo **nombrando las dos** · paridad **sin medir** ⇒ rojo **sin afirmar** nada
del dial. **12 comprobaciones, ~1 s, sin red ni Postgres.**

Y se probó **en rojo**, como manda §44/§47: revirtiendo el arreglo a mano, el canario cayó con
**4 comprobaciones en rojo**; restaurado, verde.

### 48.2 🟠 El script se contradecía sobre qué pasa sin Stripe — y lo observado es la otra rama

`stack-native.sh` decía en un sitio *«sin `STRIPE_SECRET_KEY` el backend responde 503
`PAYMENT_PROVIDER_UNAVAILABLE` y libera la reserva»* (como si hubiera una guarda por clave ausente) y
en otro *«degrada a `sk_test_dummy`»*. **Lo que QA observó es lo segundo**: `WARN [StripeService]
STRIPE_SECRET_KEY ausente; usando sk_test_dummy`. Corregido **el texto**, no el sistema. La cadena
real, verificada en el código:

1. `backend/src/modules/payments/stripe.service.ts:53-55` — **degrada**: `warn` y cliente con
   `sk_test_dummy`. **Aquí no hay ningún 503.** (En `NODE_ENV=production` esta rama no existe:
   `onModuleInit` aborta el arranque — B6.)
2. `createPaymentIntent` **llama a Stripe** con esa clave falsa y falla (aquí, además, sin egress:
   CONNECT → 403).
3. `backend/src/modules/orders/orders.service.ts:495-496` compensa: `releaseReservation()` devuelve
   las piezas a `listed` y deja la orden en `failed` (`:462`), y `toRetryError()` traduce a **503
   `PAYMENT_PROVIDER_UNAVAILABLE`**.

O sea: el 503 y la liberación **sí ocurren** (money-safe), pero como **consecuencia** de que la llamada
al proveedor falla, no de una comprobación de «falta la clave». Importa porque **el primer síntoma en
el log es el WARN del paso 1**: quien busque `PAYMENT_PROVIDER_UNAVAILABLE` al arrancar no lo va a
encontrar. Coincide con lo que ya decía `e2e-capability-gate.sh:120`. Lo observado por QA encaja
exactamente: `TCG-001101` y `TCG-001102`, ambas `failed`, **sin payment intent y sin reservas
colgadas**.

### 48.3 🟠 `verify:head` concluía «puedes medir» sobre un artefacto que él mismo descartaba

En modo `dev` imprimía `⚠ modo dev: … NO es un artefacto de gate` y **acto seguido**
`✔ VERIFICADO: … Puedes medir.` El segundo mensaje borra al primero. Ahora hay **tres** desenlaces:

| Situación | Antes | Ahora |
|---|---|---|
| coincide, frontend **horneado** | `✔ VERIFICADO … Puedes medir.` | igual |
| coincide, frontend en `next dev` | `⚠ …` + `✔ … Puedes medir.` | **`⚠ VERIFICADO A MEDIAS`**: el backend sirve el árbol de ahora, la procedencia del frontend **no es fechable**; *sirve para trabajar, no es artefacto de gate*. exit 0, **sin «puedes medir»** |
| no coincide | `✖ NO VERIFICADO` (die) | igual |

Y para quien necesita un **código de salida** y no un matiz: **`verify:head --gate`** (y todo
`up --gate`) exige evidencia de calidad de gate — con el frontend en `dev`, **rojo**.

### 48.4 El hueco de dinero: lo que se hizo para que sea más difícil de ignorar

**No es mío de resolver** —hacen falta `STRIPE_TEST_SECRET_KEY` y `STRIPE_TEST_PUBLISHABLE_KEY`, y solo **⚠️ CORREGIDO 2026-09-10 → §51: las dos claves de prueba LLEVAN TRES DÍAS en los secrets; el nocturno `34477885121` corrió los flujos en REAL con `MONEY_SKIPPED` vacío. Lo que falta es `STRIPE_TEST_WEBHOOK_SECRET`, y ya no bloquea (§50.4).**
el dueño del repo puede crearlas (§31.1)—, pero sí lo es que **el hueco no se vuelva invisible por
costumbre**. Hasta hoy había dos señales, y las dos esperan a que alguien entre: el `::warning` + la
tabla del step summary de `e2e-real.yml`, y el artefacto `SIN-MEDIR-comprar-invitado-retirar` (§46.4).
Faltaba lo único que **sale a buscar** a la persona:

**`.github/workflows/money-gap-nag.yml`** — «Dinero SIN MEDIR (falta la clave de PRUEBA de Stripe)».
Semanal (lunes 07:00 UTC) + `workflow_dispatch`. Comprueba **presencia, nunca el valor**, de los dos
secrets. Si faltan: resumen en la portada, **issue con label `release-blocker`** (idempotente: comenta
en vez de duplicar) y **el run en ROJO** — que es lo único que **GitHub notifica solo** al dueño del
repositorio. Si están: comenta y **cierra el issue**, y recuerda que el paso que *mide* sigue siendo
lanzar `e2e-real.yml` con `require_real_stripe=true`.

Mismo razonamiento —y mismo coste cero— que el `deps-audit` de `security-scheduled.yml`: es un cron,
no puede ser required check, no hay PR ni deploy colgando de él, así que **el rojo no frena a nadie**.
Se apaga **solo**; no hay bandera que acordarse de quitar. Y si el dueño decide que **no** va a poner
la clave, la salida no es silenciarlo: es registrar en `docs/TECH_DEBT.md` que los tres flujos de
dinero se promueven **sin haberse ejecutado nunca**, con esa firma, y borrar el workflow.

### 48.5 Qué queda para quién

| Punto | Dueño | Estado |
|---|---|---|
| La paridad `I-PP5` tumba `up --gate` | devops | ✅ probado **en vivo** (B rc=0 → C rc=1, mismo dial) y **en rojo** (canario) |
| `parity-gate-canary` en `ci.yml`, `skipped` ≠ verde | devops | ✅ 12 comprobaciones, ~1 s |
| «sin paridad» ≠ «no pude medir la paridad» | devops | ✅ rc=20 vs rc≠0, los dos rojos en `--gate` |
| Texto del degradado de Stripe = lo que hace el sistema | devops | ✅ §48.2 |
| `verify:head` no concluye «puedes medir» en `dev`; `--gate` lo pone rojo | devops | ✅ §48.3 |
| **Correr `e2e-real.yml` con secrets de Stripe y citar el run** | **humano (dueño del repo)** | ⏳ **ABIERTO — bloquea el veredicto de RELEASE.** Cuatro pases sin respuesta; ahora con rojo semanal + issue (§48.4) |
| Veredicto de release de QA | qa | ⏳ condicionado a la línea anterior |

---

## 49. `P-WH-1` — el webhook de Stripe se verificaba con **clave vacía**, y después con **claves publicadas**. Las dos mitades de config, el preflight y su canario (2026-09-10, hallazgo ALTA del pentester)

> **Origen:** `docs/PENTEST_NOTES.md` → `P-WH-1` (ALTA, **explotado en vivo contra Postgres real**).
> `constructEvent` hacía `config.get('STRIPE_WEBHOOK_SECRET') ?? ''`. Con el secreto ausente, la
> verificación **no se apagaba: degradaba a clave VACÍA**, que cualquiera computa. El pentester firmó
> un `payment_intent.succeeded` con clave vacía y dejó un pedido **`settled` con la carta movida a la
> bóveda del comprador, sin cobro**.
>
> **Reparto:** el fail-closed del código lo cerró **backend** (`stripe.service.ts`: lanza con
> `undefined`, `''` **y solo espacios**; `onModuleInit` deja de mirar `NODE_ENV` y pasa a mirar el
> hecho relevante — *si hay `STRIPE_SECRET_KEY`, el secreto de webhook es obligatorio*; responde
> **503**, no 400, para que Stripe reintente hasta 3 días y un evento legítimo sobreviva a una config
> rota). Lo de esta sección es **todo lo demás**: la configuración, el preflight de runtime y el
> candado que impide que vuelva.

### 49.1 Lo que **NO** se puede determinar desde el repo: el `NODE_ENV` real del deploy

La pregunta importaba mucho antes del arreglo de backend (decidía si el agujero llegaba a la tienda del
dueño o se quedaba en entornos de trabajo). Con el fail-closed incondicional ya **no cambia el arreglo**,
pero **sí decide si la tienda estuvo expuesta**, así que queda escrita con precisión.

**Lo que está MEDIDO en el repo (2026-09-10):**

| Hecho | Dónde se comprueba |
|---|---|
| `railway.json` en la RAÍZ declara `builder: DOCKERFILE`, `dockerfilePath: Dockerfile.backend` | `railway.json` (4 líneas de `build`) |
| **No existe** `nixpacks.toml` ni `railway.toml` en ninguna parte del árbol | `find . -iname '*nixpacks*' -o -iname '*railway*'` → solo `railway.json` y un `.md` |
| `Dockerfile.backend` fija `ENV NODE_ENV=production` en la etapa `base` (:32) y en `runtime` (:58) | `Dockerfile.backend` |
| `backend/package.json` → `start:prod` = `node dist/main.js` (**sin** `migrate deploy`) | `backend/package.json` |
| El CMD del Dockerfile **sí** corre `migrate deploy` antes de arrancar | `Dockerfile.backend` (última línea) |
| El checklist §11.D pide al humano fijar `NODE_ENV=production` en Railway **y repetir el bloque en `staging`** | §11.D `[RW]` |
| En esta sesión **no hay** CLI ni token de Railway (`which railway` → nada; `env` sin variables suyas) | reproducible |

**Lo que NO se puede saber desde aquí, y por qué:**

1. **El *Root Directory* del servicio `backend` en Railway.** Railway lee la config-as-code desde el
   *root directory del servicio*, no desde la raíz del repo. Si ese ajuste fuese `backend/`, Railway
   buscaría `backend/railway.json` — que **no existe** (medido) — y caería a **detección automática
   (Nixpacks/Railpack), que no fija `NODE_ENV`**. Este documento afirma el ajuste de Vercel
   (`Root Directory = frontend`) en tres sitios porque el humano lo confirmó; del de **Railway no hay
   ninguna confirmación equivalente**. §11.A dice «Railway detecta `railway.json`»: eso es una
   **expectativa del runbook, no una medición**.
2. **Si hay una variable `NODE_ENV` puesta en el servicio.** Una variable de servicio **gana sobre el
   `ENV` de la imagen**. Aunque el Dockerfile se use, un `NODE_ENV=staging` en el entorno `staging`
   dejaría ese despliegue fuera de la guarda vieja.
3. Las **build logs** de Railway (que dirían «Using Detected Dockerfile» o «Nixpacks») **no** están en el
   repo. Las que aportó el PO el 2026-08-18 (§23.2) son logs de **runtime** (rutas de Nest, scheduler):
   prueban qué binario corre, **no con qué builder se construyó ni con qué `NODE_ENV`**.
4. `GET /api/v1/health` **no** expone el entorno (`health.service.ts` no devuelve `env` ni `version`), así
   que tampoco se puede inferir desde fuera. Y no hay ninguna otra conducta observable que dependa de
   `NODE_ENV`: las demás (`throttler`, scheduler, `pii-crypto`) discriminan `test` o `local`, no `production`.

**Indicio, con su fuerza declarada (NO es una medición):** el prod del 2026-08-18 tenía el esquema al día
y `start:prod` no aplica migraciones — solo el CMD del Dockerfile lo hace. Eso *sugiere* que el deploy usa
`Dockerfile.backend`, pero **no lo prueba**: las migraciones también pueden haberse aplicado a mano con
`railway run`. Se deja como indicio, no como hecho.

> **PREGUNTA PARA EL DUEÑO (30 segundos, en el dashboard):** Railway → servicio `backend` → **Settings →
> Source**: ¿*Root Directory* es la raíz del repo o `backend/`? Y en el último deploy, ¿las **Build Logs**
> dicen `Dockerfile` o `Nixpacks/Railpack`? Y en **Variables**: ¿existe `NODE_ENV` y qué vale, en
> `production` y en `staging`? Con eso se cierra si la tienda estuvo expuesta o no. **No lo supongas en
> ninguna dirección**: hoy no está medido.

### 49.2 La primera mitad: «sin Stripe» dejó de significar «acepto cualquier firma»

Dos sitios de **devops** entregaban el secreto **vacío** al backend, que es el insumo exacto del exploit:

| Sitio | Antes | Ahora |
|---|---|---|
| `docker-compose.yml` | `STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET}` (sin default ⇒ compose lo pasa **vacío**) | `${STRIPE_WEBHOOK_SECRET:?…}` — falla **ruidoso** con instrucciones |
| `scripts/stack-native.sh` | `[ -z "${…:-}" ] \|\| export …` ⇒ **si venía vacío, NO se exportaba** | resuelve con el preflight y exporta **siempre**, con valor |
| `.env.example` | «Secreto de firma… en local se obtiene con `stripe listen`» | **OBLIGATORIA en todo entorno con Stripe cableado**, con el porqué medido |
| `scripts/dev-up.sh` | copiaba `.env.example` tal cual (`whsec_CHANGE_ME`) | además **sustituye el placeholder por uno aleatorio** en el `.env` que crea |

Medido tras el cambio: `docker compose --profile apps config` sin la variable → `rc=1` con el mensaje
accionable; con la variable → gana el valor del operador.

### 49.3 La segunda mitad (el **residual**): un secreto que EXISTE pero está **publicado**

El arreglo de backend cierra «vacío o en blanco». No puede cerrar esto, y su frase marca el límite exacto:

> «el backend puede exigir que el secreto **exista** y no esté vacío; **no puede distinguir un secreto de
> un no-secreto**.»

Para un HMAC **cualquier cadena es una clave válida**. Y este repo es **público** y tenía commiteados
`whsec_ci_dummy`, `whsec_e2e_dummy` (×3 workflows), `whsec_staging_dummy` y un
`whsec_local_placeholder_…` que yo mismo había puesto una hora antes. Un entorno con Stripe **real** y
cualquiera de esos valores arranca en verde, pasa el fail-closed… y sigue siendo forjable por quien sepa
leer. Peor: cuatro de ellos estaban como **respaldo** (`|| 'whsec_e2e_dummy'`, `:-whsec_staging_dummy`), o
sea que **el valor público ganaba justo cuando alguien creía haber configurado Stripe y no lo había
hecho**. Es el `?? ''` otra vez, una capa más arriba.

**La asimetría que se respeta:** CI y el arnés local **deben** poder correr sin Stripe — eso es legítimo y
no se toca. Lo prohibido es que un entorno con Stripe **real** herede un valor público. Antes compartían
mecanismo (un literal por defecto); ahora se separan.

**`scripts/webhook-secret-preflight.sh`** (POSIX sh; corre también dentro de la imagen, donde no hay bash):

| Situación | Qué hace |
|---|---|
| Secreto propio presente | lo usa |
| Sin secreto y **sin** Stripe real | **genera uno EFÍMERO aleatorio** por corrida: el stack levanta y **rechaza todo webhook** (nadie puede firmar contra él, tampoco quien lea el repo) |
| Stripe **real** y sin secreto | **ABORTA** el arranque, con las instrucciones de dónde sacar el `whsec_…` |
| Stripe **real** y secreto **público** (patrón de no-secreto) | **ABORTA** |

`sk_test_` **cuenta como Stripe real**: staging habla con Stripe de verdad y recibe webhooks de verdad; un
forjador liquida pedidos ahí igual que el pentester lo hizo en local. Los `sk_test_*_dummy` del repo no
cuentan (los reconoce la misma lista de patrones).

**Dónde está cableado** — los tres caminos por los que arranca este backend:

| Camino | Cable |
|---|---|
| Contenedor (compose local, staging y **Railway**) | `Dockerfile.backend`: `COPY` del preflight + `CMD` lo corre **antes** de `migrate deploy` |
| Arnés nativo (el que usan QA y el pentester) | `scripts/stack-native.sh` → `preflight resolve` |
| CI | `ci.yml`, `e2e.yml`, `e2e-real.yml`, `security-dast.yml`: un paso resuelve a `$GITHUB_ENV`. **Ya no hay ningún literal `whsec_…` en un workflow.** |

⚠️ **Modo de fallo y rollback.** Si un entorno queda con clave real + secreto público, **el contenedor no
arranca** (Railway: `ON_FAILURE`, motivo en las deploy logs). Es deliberadamente ruidoso: la alternativa es
servir una API que acepta webhooks forjados, y **ésa no avisa de nada**. Rollback: *Redeploy* del deploy
anterior desde Railway mientras se pone el `whsec_…` real en Variables (§11.G). **No pongas otro literal.**

**Lo que sigue SIN medir aquí:** que el `COPY` del preflight entra al contexto de build. En esta sesión
**no hay demonio Docker** (`docker build` → *cannot connect to the docker daemon*), así que la excepción
`!scripts/webhook-secret-preflight.sh` de `.dockerignore` está razonada pero **no ejercitada**. La medición
que lo cierra ya está cableada y corre sola: el job `trivy-image` de `security-sast.yml` **construye** la
imagen del backend; si la excepción estuviera mal, ese build **falla en el `COPY`**. Primera corrida de CI
tras este push = la medición.

**Lo que NO se cambió, y por qué:** `STRIPE_SECRET_KEY: ${{ … || 'sk_test_e2e_dummy' }}` sigue igual. La
asimetría es real: una clave de API falsa **no autentica nada** (degrada a «sin Stripe», que es lo que el
preflight ya trata bien); una clave de **verificación** falsa **acepta todo**. Son riesgos distintos y no
se tratan igual.

### 49.4 El candado, y la demostración de que se pone rojo

`scripts/check-stripe-webhook-failclosed.sh` — job **`stripe-webhook-failclosed`** de `ci.yml`
(required en `ci-ok`; `skipped` **no** es verde). Tres bloques, y la razón de cada uno:

- **(A) Código.** Prohíbe que la clave de verificación caiga a **cualquier** literal (`?? ''`, `|| ""`, y
  también `?? 'whsec_dev'`, que no es mejor: es una clave publicada). Es el bloque **principal** porque es
  el único que vale para entornos que **no puedo inspeccionar** — Railway incluido (§49.1).
- **(B) Config.** En los entornos que el repo **sí** define, el secreto no puede resolver a vacío **ni ser
  un literal commiteado**. En un workflow no hay forma segura de escribirlo: `${{ secrets.X }}` a secas se
  resuelve a **cadena vacía** cuando el secret no está cargado (y en este repo **no lo está**), y
  `|| 'whsec_…'` tapa ese vacío con un valor público. Única forma aceptada: resolverlo con el preflight.
- **(C) Cableado.** El residual es un hecho de **runtime** («este entorno tiene clave real Y secreto
  publicado») y ningún análisis estático puede verlo. Lo ve el preflight — así que se comprueba que el
  preflight **existe y lo invocan** el `CMD` del Dockerfile, el arnés nativo y CI. Es la avería de §44 (el
  DAST sin blanco): borrar la llamada deja el repo con buen aspecto y la protección desaparecida.

`scripts/check-stripe-webhook-failclosed-canary.sh` — **la demostración**, mismo criterio que el self-test
de `trivy-fs` (§47) y el canario de paridad (§48.1). Copia el árbol, planta cada mutación y exige el color:

```
✓ 31/31 — el candado de P-WH-1 y su preflight: rojos donde toca, verdes donde toca.   (5/5 tiradas)
```

Cubre, entre otros: el bug histórico byte a byte; `|| ""`; fallback a literal no vacío; el fallback
escondido tras un `//`; el bug **mudado a otro fichero**; `backend/src` desaparecido (candado sin blanco);
compose sin default / con default vacío / con default literal; `whsec_staging_dummy`; `|| 'whsec_e2e_dummy'`;
literal pelado en workflow; `${{ secrets.X }}` en un fichero sin preflight; el `CMD` del Dockerfile sin la
llamada; `.dockerignore` sin la excepción; el arnés nativo sin la llamada; el preflight borrado; y un
`.env.example` cuyo placeholder **parece** un secreto de verdad. Y **en verde** (que importa igual): el
árbol íntegro, **documentar el bug en un comentario** —un candado que castiga explicarlo hace que nadie lo
explique— y la forma correcta en un workflow.

El **bloque D** ejercita el preflight de verdad, no lo lee: Stripe LIVE + `whsec_staging_dummy` → aborta;
Stripe TEST real + `whsec_e2e_dummy` → aborta; LIVE sin secreto → aborta; LIVE con secreto **de solo
espacios** → aborta; LIVE con secreto propio → **deja arrancar**; sin Stripe → deja arrancar; y dos
`resolve` seguidos devuelven **valores distintos**.

> **Dos cazas del propio canario, anotadas porque son la razón de que exista:** (1) (C) usaba `grep` del
> *nombre* del preflight, y daba **verde** con el `COPY` y los comentarios intactos y la **llamada
> borrada** — ahora exige la invocación en `CMD`/`ENTRYPOINT` y en línea no comentada. (2) Mi primera
> versión del bloque (A) se ponía **roja por el JSDoc de backend que cita el bug**. Las dos las encontró
> el canario, no yo.

### 49.5 `P-DEP-1` — el audit de devDependencies: decisión y trinquete

**Medido hoy** (`npm audit`, 2026-09-10): frontend **runtime 0/0**, backend **runtime 0 altos/críticos**;
con devDependencies, frontend tiene **1 crítica y 2 altas**, todas de tooling:

| Advisory | Paquete (instalado) | Por qué no es alcanzable aquí | Arreglo |
|---|---|---|---|
| `GHSA-5xrq-8626-4rwp` (crítica 9.8) | `vitest` 2.1.9 | requiere el servidor **`vitest --ui` escuchando**. Medido: `frontend/package.json` corre `vitest run`, y `--ui` no aparece en ningún script ni workflow | `vitest` 5 (**major**) |
| `GHSA-fx2h-pf6j-xcff` (alta 7.5) | `vite` 5.4.21 | bypass de `server.fs.deny` en rutas alternativas de **Windows**; runners y equipo son Linux | `vitest` 5 (arrastra `vite`) |
| `GHSA-2883-xcg3-v3hh` (alta 7.5) | `js-yaml` 4.3.1 (vía `eslint`) | DoS por CPU en merge keys, dentro del lint | **`fixAvailable: true`** → bump de **lockfile** a `js-yaml >= 4.3.2`, sin cambio de API |

**Decisión, y por qué no es «se queda así»:** el arreglo no me pertenece —`frontend/package.json` y su
lockfile son del rol **frontend** (CLAUDE.md)— así que lo que decido es lo que **sí** es mío: cómo se
comporta el escáner. Lo que había era un paso `continue-on-error: true` con un `|| true` dentro: **un
escáner que no puede cambiar el color de nada**, o sea una excepción sin dueño, sin fecha y sin revisor.
Eso no se sostiene y **no se silencia nada**: se sustituye por un **trinquete**.

`security/scripts/audit-npm-dev.sh` + `security/npm-audit-dev-fichas.tsv` (dueño y fecha por hallazgo):

- alto/crítico de tooling **sin ficha** → **ROJO**;
- ficha con `revisar_antes_de` **pasado** → **ROJO**;
- ficha que ya **no** corresponde a nada (alguien lo arregló) → **aviso**, no rojo (un candado no puede
  castigar a quien arregla; la ficha se poda).

Hoy queda **verde** (está todo fichado y en fecha) y se pone rojo **por empeoramiento o por el paso del
tiempo**. Corre en `security-sast.yml` (por PR) **y en `security-scheduled.yml`** — esto último no es
adorno: una caducidad que solo se evalúa cuando alguien empuja código no es una caducidad. El gate de
**runtime** no cambia: `security/scripts/audit-npm.sh`, umbral `high`, **sin fichas posibles**.

`security/scripts/audit-npm-dev-selftest.sh` demuestra que muerde: **6/6** — verde con lo fichado, **rojo**
con un hallazgo nuevo, **rojo** con ficha vencida, **rojo si desaparece la tabla de fichas**, verde (con
aviso) con ficha obsoleta, y las `moderate` no entran.

> El propio trinquete corrigió mi tabla en su primera corrida: yo había fichado de más tres advisories
> `moderate` y me pidió podarlas. La tabla no puede afirmar más de lo que el audit dice.

**Enrutado (no lo arregla devops):** → **frontend**. (a) `js-yaml` es el barato: `npm audit fix` en
`frontend/` sube el lockfile a `>= 4.3.2` sin tocar API (ficha hasta **2026-09-24**). (b) `vitest` 2 → 5 es
un **major** y es decisión suya (ficha hasta **2026-10-10**).

### 49.6 Estado y quién tiene la pelota

| Punto | Dueño | Estado |
|---|---|---|
| Fail-closed incondicional en `constructEvent` + `onModuleInit` (503, no 400) | backend | ✅ hecho (verificado por el orquestador; mi candado 3/3 sobre su árbol) |
| Config: ningún entorno del repo entrega el secreto vacío | devops | ✅ §49.2, medido con `docker compose config` |
| Residual: ningún literal `whsec_…` vivo en compose/workflows/scripts | devops | ✅ §49.3 (los que quedan son comentarios que explican el bug) |
| Preflight de emparejamiento cableado en contenedor + nativo + CI | devops | ✅ §49.3 |
| Candado + canario en `ci.yml`, `skipped` ≠ verde | devops | ✅ 31/31, 5/5 tiradas |
| `COPY` del preflight entra al contexto de build | devops | ⏳ **NO MEDIDO aquí** (sin demonio Docker); lo mide `trivy-image` en la primera corrida de CI |
| **`NODE_ENV` real del deploy de Railway** (Root Directory, builder, Variables) | **humano (dueño)** | ⏳ **ABIERTO** — §49.1. No cambia el arreglo; decide si la tienda estuvo expuesta |
| `P-DEP-1`: `js-yaml` (lockfile) y `vitest` 2→5 (major) | **frontend** | ⏳ fichado hasta 2026-09-24 / 2026-10-10; el trinquete se pone rojo solo al vencer |
| Los tres flujos de dinero a través de Stripe, medidos | **humano (dueño)** | ✅ **CERRADO — esta fila era FALSA** (corrección in situ 2026-09-11, §51/§55.3/§56): las claves de prueba estaban en los secrets desde 2026-09-07 y el nocturno `34477885121` corrió los tres flujos en real (`MONEY_SKIPPED` vacío). Y `money-gap-nag.yml` **nunca hizo ruido**: no corrió ni una vez (retirado en §56). |

---

## 50. `S-88-1` — la cirugía había ido a UNA variable, no a la clase. Y el gate de dinero que mi propio fail-closed frenó (2026-09-10, hallazgo ALTO de seguridad, bloqueante del release)

### 50.0 · El hallazgo, con sus mediciones

`P-WH-1` se cerró para `STRIPE_WEBHOOK_SECRET` (§49). Seguridad midió lo que quedaba
**tres líneas más arriba, en el mismo fichero**:

| `docker-compose.staging.yml` | variable |
|---|---|
| `:166` / `:167` | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` |
| `:160` / `:161` | `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` |
| `:204` | `SEED_ADMIN_PASSWORD` (`StagingAdmin123!`) |
| `:42` / `:86` | Postgres, MinIO |

Y midió que **el repositorio es público** (`"private": false`, HTTP 200 sin credenciales).
Con el secreto JWT publicado firmó un `super_admin` ⇒ las tres rutas `@MoneyOut`. Con la
clave PII publicada descifró una CLABE sintética **usando solo el literal del repo**.

Su frase es el diagnóstico entero, y es la que decidió el diseño de todo lo de abajo:

> **la cirugía fue a una variable, no a la clase.**

**No era explotable hoy** (no hay staging levantado) y **no hubo ventana con dinero real**
(el dueño confirmó que la tienda siempre estuvo en modo prueba). Lo que sí es cierto, y es
lo que hay que arreglar: **el literal gana por defecto, y gana justo en el error del
operador** — el día que exista un staging, el valor público es el que se usa cuando alguien
creyó configurarlo y no lo hizo.

### 50.1 · Por qué el arreglo NO son «siete `:?`»

Porque el **octavo secreto que alguien añada mañana nace con el defecto**. Poner `:?` siete
veces es hacer la misma cirugía siete veces: sigue sin ir a la clase. La clase se cierra con
cuatro piezas que se sostienen entre sí, y **ninguna de ellas contiene una lista de
variables**:

| Pieza | Fichero | Qué impide, y cómo lo hace sin listas |
|---|---|---|
| **1. Los compose ya no pueden llevar valores** | `docker-compose*.yml` | Todo secreto es `${VAR:?mensaje}`. Desaparece el sitio donde escribir el literal. |
| **2. Un resolutor que satisface esa exigencia** | `scripts/secrets-preflight.sh` | **Deriva el catálogo del propio compose** (los `${VAR:?}`), no lo lleva escrito. En entorno DESECHABLE genera aleatorios; en entorno REAL exige y **aborta** si falta. El secreto nuevo de mañana queda cubierto con solo nacer `:?`. |
| **3. El lado del VALOR** | `security/secretos-publicados.sha256` + `scripts/gen-published-secrets-manifest.sh` | El `sha256` de **cada literal que el repo publica**. Los preflights rechazan por **identidad**, no por heurística. Cubre lo que aún no existe (se regenera) y lo que no es mío (`backend/test/`). |
| **4. El candado + su canario** | `scripts/check-secret-defaults.sh` · `-canary.sh` | El candado **no conoce ninguna variable**: conoce una FORMA DE NOMBRE y una FORMA DE ASIGNACIÓN prohibida. El canario lo demuestra **con secretos inventados que este repo nunca ha tenido**. |

La regla, en una frase: **un valor que sirva como secreto no puede estar escrito en un
fichero versionado de un repositorio público.** Formas admitidas: `${VAR:?}` (obligatoria),
`${VAR:-}` (vacío declarado = incapacitación), y en `.env.example` un placeholder
auto-delator (`CHANGE_ME…`).

### 50.2 · Lo que el candado encontró al escribirlo: 24 incumplimientos, no 7

La primera corrida sobre el árbol dio **24** en 8 ficheros. Los 7 del informe eran una
muestra:

| Fichero | Cuántos | Qué eran |
|---|---|---|
| `docker-compose.staging.yml` | 10 vars (13 usos) | los 7 del informe + operador, `STRIPE_TEST_SECRET_KEY`, `RESEND_API_KEY` |
| `docker-compose.yml` (local) | 3 | Postgres, MinIO, S3 |
| `.github/workflows/ci.yml` | 5 | `tcg_ci`, dos JWT, `sk_test_ci_dummy`, `ci_dummy` |
| `.github/workflows/e2e.yml` | 6 | Postgres, MinIO, dos JWT, S3, `\|\| 'sk_test_e2e_dummy'` |
| `e2e-real.yml` · `security-dast.yml` | 2 | `\|\| 'sk_test_e2e_dummy'` |
| `scripts/stack-native.sh` | 3 | dos JWT + S3 |
| `scripts/price-provider-parity.sh` | 1 | `StagingAdmin123!` |
| `.env.example` | 7 | valores usables que se copian a `.env` tal cual |

Y **dos más** que una regla basada en NOMBRES no puede ver nunca, encontradas al añadir una
regla por FORMA DEL VALOR: `DATABASE_URL=postgresql://tcg:tcg_local_dev_password@…` en
`.env.example` y en `scripts/purge-synthetic-poc-data.sh` (un script que **borra datos** y
adivinaba a qué base apuntar).

### 50.3 · El punto ciego del preflight del webhook (lado del VALOR)

Seguridad midió que esto **PASABA**:

```
STRIPE_SECRET_KEY=sk_live_…   +   STRIPE_WEBHOOK_SECRET=whsec_e2e_test_secret
```

`whsec_e2e_test_secret` no contiene ninguna palabra de `PATRONES_PUBLICOS` (`dummy`,
`change_me`…) — pero estaba **commiteado** en `backend/test/integration/setup.ts:32`. Una
lista de palabras **adivina**; el hecho que importa es comprobable: *¿está ese valor escrito
en este repositorio?* Ahora `es_publico()` consulta primero el manifiesto (identidad) y solo
después la lista. **Medido: rc=1, aborta.**

**Una vez publicado, publicado para siempre.** El manifiesto se deriva del árbol; si backend
borra su literal, el valor desaparecería del manifiesto pero **no del historial de git ni de
los forks**. Por eso `security/secretos-retirados.sha256` es **append-only** y el manifiesto
es la unión de ambos. Verificado: `whsec_e2e_test_secret` sigue rechazándose **después** de
que backend lo quitara (lo quitó en paralelo, S-88-4).

Y por eso el `--check` del manifiesto es **de una sola dirección**: falla si al árbol le
sobra un literal que el manifiesto no cubre (el agujero), y **no** falla si al manifiesto le
sobran hashes (limpiar código no puede poner el CI en rojo — si lo pusiera, la gente dejaría
de limpiar).

### 50.4 · El gate de dinero que mi propio fail-closed frenó — y lo que eso enseñó

`e2e-real.yml` **run `34498068945`** falló en 13 s. Medido en la API de Actions, **no
supuesto**: falló en el **paso 3, «Resolver STRIPE_TEST_WEBHOOK_SECRET»**; el paso 9
(«Levantar stack real») quedó **`skipped`**. El error de interpolación de compose que se vio
venía de los pasos 22/23 (`Logs del stack…` / `Apagar stack`, que corren con `always()`).

O sea: **el resolver SÍ estaba cableado** y el fallo fue del preflight abortando. Causa real:
hay clave `sk_test_` REAL en los secrets y **no existe el secret `STRIPE_TEST_WEBHOOK_SECRET`**.

Eso obligó a mirar qué defendía la regla «clave real ⇒ secreto de webhook propio». Defiende
**dos cosas distintas**: (a) que nadie firme con un valor público —seguridad—, y (b) que el
operador no crea que los webhooks funcionan cuando no —correctitud. En el **stack efímero de
CI**, (a) se satisface **mejor** con un secreto generado (irrepetible) que con uno real
compartido, y (b) no aplica: ese stack vive en el runner, **sin endpoint público, Stripe no
puede entregarle nada**. Ahí —y solo ahí— se genera uno efímero y se avisa a gritos de que
**ningún webhook entrante se aceptará en esa corrida**.

La excepción **no se concede por accidente**: exige `STRIPE_WEBHOOK_UNREACHABLE=1` explícito
**y** runner de CI (o `SECRETS_ENV=desechable`) **y** ausencia de marcas de plataforma.
Medido en las tres direcciones: sin la marca → `rc=1`; con la marca en CI → resuelve; con la
marca **dentro de Railway** → `rc=1` igualmente.

**Dos defectos más, del mismo día y de la misma familia:**

1. **`echo "VAR=$(preflight resolve)" >> "$GITHUB_ENV"` traga el abort.** Medido: el
   `echo` sale **0** aunque la sustitución aborte, y exporta un valor **vacío**; el rojo
   aparece 8 pasos más tarde, en el `compose`, apuntando al sitio equivocado. Es la ausencia
   degradando en silencio, otra vez. Sustituido en los 4 workflows por capturar-y-comprobar.
2. **Consumidores del compose sin resolver.** Hacer fail-closed el compose obliga a que
   **cada** consumidor resuelva antes. Enumerados —no descubiertos a base de runs rojos—:

   | Consumidor | Estado |
   |---|---|
   | `.github/workflows/e2e-real.yml` | ✅ resolvía; ampliado a la clase |
   | `.github/workflows/security-dast.yml` | ✅ ampliado a la clase |
   | `scripts/dev-up.sh` | ✅ cableado en este pase |
   | `security/scripts/dast-ephemeral.sh` (**ruta local del DAST**) | ❌ **no resolvía** — cerrado en este pase |
   | `security/scripts/dast-selftest.sh` | n/a: su compose no exige secretos |
   | `scripts/seed-synthetic.sh`, `scripts/e2e-capability-gate.sh` | n/a: solo imprimen instrucciones |

   Y —lo que importa— **es ahora un invariante comprobado**, bloque (G) del candado: *quien
   levanta un compose con `${VAR:?}`, resuelve antes*. Un consumidor nuevo que no lo haga
   nace rojo.

### 50.4-bis · CI me refutó: mi «medido en 3 direcciones» había medido DOS comandos de un paso de CUATRO

Reporté que el gate de dinero ya no bloqueaba, «medido en tres direcciones». El
orquestador relanzó sobre mi propio commit `715e4af`: **run `34512132641`, paso 3 en
`failure`, 10 s, pasos 4-17 `skipped`**. Los tres flujos de dinero no corrieron.

**Quién midió mal: yo.** Reproducido en local con el entorno exacto del job:

| Comando del paso 3 | ¿Lo probé antes? | rc |
|---|---|---|
| `webhook-secret-preflight.sh assert` | sí | 0 |
| `webhook-secret-preflight.sh resolve` | sí | 0 |
| `secrets-preflight.sh github-env` | **NO** | **1 — `Falta MINIO_ROOT_PASSWORD y este entorno NO es desechable`** |

Probé dos comandos de un paso que tiene cuatro, y el que no probé era **el que añadí
en ese mismo pase**. Mi medición en verde con el sistema sin arrancar: exactamente el
defecto que este trabajo persigue, cometido por mí, con el canario en 32/32.

**La causa.** `es_desechable()` preguntaba `hay_stripe_real()`. Heredé la señal del
preflight del webhook, donde significa algo preciso —*hay clave real ⇒ se puede mover
dinero ⇒ un webhook forjado cuesta cartas*— y la usé donde no significa nada de eso:
que exista una `sk_test_` **no dice nada** sobre si la contraseña de Postgres de un
stack que vive diez minutos en un runner debe salir de un gestor de secretos. Copié la
señal con su nombre y sin su significado. Resultado: el gate de dinero, que **sí** tiene
clave de Stripe real, se declaraba «entorno real» y abortaba.

#### La decisión de diseño: ¿abortar o generar?

**Generar**, y el argumento es que el secreto que falta sirve para **verificar webhooks
ENTRANTES**. En un stack efímero de CI **no hay ningún webhook entrante real que
verificar**: vive en el localhost del runner y Stripe no puede alcanzarlo. Abortar ahí
no protege nada — solo impide medir los tres flujos de dinero. Y un secreto **generado**
es *estrictamente más seguro* que uno real compartido: es irrepetible y nadie, ni quien
lea el repo, puede firmar contra él.

Lo que cambia es **de dónde sale la decisión**: el resolutor ya no ADIVINA si el entorno
es desechable. **Se lo dicen, o es un runner de CI.** Todo lo demás falla cerrado.

| # | Condición | Desechable |
|---|---|---|
| 1 | `SECRETS_ENV=real\|prod\|production\|staging` | **NO** (lo explícito manda) |
| 2 | Marca de plataforma (Railway/Vercel/Render/Fly/Heroku/K8s) | **NO**, *aunque `CI` esté puesto* |
| 3 | `SECRETS_ENV=desechable\|ephemeral\|local\|ci` | SÍ — lo declara el entrypoint que levanta el stack (`dev-up.sh`, `stack-native.sh`, `dast-ephemeral.sh`) |
| 4 | Runner de CI sin marcas de plataforma | SÍ |
| 5 | Cualquier otra cosa | **NO** — una máquina pelada sin declarar es un servidor hasta que se demuestre |

**La línea, MEDIDA — bloque H del canario, 8 direcciones, 5/5 tiradas.** Y no mide
comandos sueltos: **extrae el `run:` del paso real de `e2e-real.yml` y lo ejecuta
entero**. Si mañana alguien añade un quinto comando al paso, queda ejercitado sin que
nadie actualice el canario — que es justo lo que falló aquí y lo que había fallado con
la mutación NO-OP del canario de P-WH-1.

| Entorno | Paso completo |
|---|---|
| runner CI + clave Stripe REAL + sin whsec *(el run `34512132641`)* | **rc=0** ✔ |
| runner CI + clave REAL + whsec propio | rc=0 ✔ |
| runner CI sin claves de Stripe | rc=0 ✔ |
| runner CI **+ `RAILWAY_ENVIRONMENT`** | rc=1 ✔ |
| runner CI **+ `SECRETS_ENV=real`** | rc=1 ✔ |
| máquina pelada, sin CI ni declaración | rc=1 ✔ |
| runner CI + `VERCEL_ENV` | rc=1 ✔ |
| runner CI + whsec **publicado por el repo** | rc=1 ✔ |

#### Y un daño colateral de S-88-1 que este pase también cierra

Al quitar los literales, **el login de `price-provider-parity.sh` dejó de funcionar**
(paso 13 del mismo gate). Funcionaba por un **accidente**: su literal `Admin123!`
coincidía con la fixture de `backend/prisma/e2e-fixtures.ts:21`, y `StagingAdmin123!`
con el default del compose. Quitados los dos, ningún par tenía contraseña.

- La fixture **se LEE de su única fuente** (`e2e-fixtures.ts`), no se copia: dos fuentes
  para un hecho es cómo se rompe esto en silencio dentro de tres semanas. Si el fichero
  cambia de forma, el par queda vacío y el script dice «no pude entrar».
- El admin **sembrado** se empareja explícitamente: el paso resolver exporta
  `SEED_ADMIN_PASSWORD`/`SEED_ADMIN_EMAIL` al runner desde el mismo valor que recibe el
  contenedor. **Verificado: `STAGING_SEED_ADMIN_PASSWORD == SEED_ADMIN_PASSWORD`.**

#### Lo que NO hace falta pedirle al humano

**Nada.** `STRIPE_TEST_WEBHOOK_SECRET` **no** es necesario para que el gate de dinero
corra: sin él, CI genera uno efímero y los webhooks entrantes se rechazan por firma —
que es el comportamiento correcto para un stack que Stripe no puede alcanzar. Solo haría
falta si algún día se quisieran ejercitar **webhooks REALES de Stripe** contra CI, y eso
hoy no lo pide ningún criterio de aceptación.

### 50.4-ter · El backend arrancaba y moría en silencio: metí en la imagen el catálogo del HOST

Run `34531002011` (`d2df320`): pasos 1-9 en verde —resolver **✅**, stack levantado **✅**—
y **paso 10 en timeout tras 5 minutos**. Del contenedor `backend` no se veía una línea.

**Causa, medida sin demonio de Docker** (§50.4-quater explica cómo):

```
JWT_ACCESS_SECRET: ${STAGING_JWT_ACCESS_SECRET:?…}
└── nombre DENTRO del contenedor   └── nombre en el HOST (interpolación)
```

Materialicé el catálogo del entrypoint desde el **lado izquierdo equivocado**: metí en la
imagen los nombres del **host**. Dentro del contenedor `STAGING_JWT_ACCESS_SECRET` no
existe — solo existe `JWT_ACCESS_SECRET`. Medido: **12 de 15 «ausentes»**, `assert`
abortaba, el `&&` del `CMD` cortaba y **`node` no llegaba a ejecutarse**. Un contenedor
que muere en tres segundos y un job esperando salud durante cinco minutos.

**Arreglo:** el generador emite ahora **dos** catálogos y el candado verifica los dos:

| Fichero | Nombres | Quién lo usa |
|---|---|---|
| `security/secretos-exigidos.txt` | del **host** (15) | `env-file` / `github-env` en el runner |
| `security/secretos-exigidos-contenedor.txt` | del **contenedor** (11) | el `assert` del entrypoint, **dentro de la imagen** |

El del contenedor se deriva de las claves del servicio `backend` cuyo valor referencia un
`${VAR:?}` — no es una lista escrita a mano. **Verificado de punta a punta:** resolver
`rc=0` → `docker compose config` `rc=0` → entrypoint `rc=0` (`node` arrancaría).

### 50.4-quater · «Ese camino no se puede medir sin Docker» era una excusa, y era falsa

Durante **dos pases** escribí en mi lista de NO MEDIDO: *«que el `CMD` de la imagen corre
los preflights (no hay demonio Docker aquí)»*. La causa de `34531002011` estaba
**exactamente ahí**. Un no-medido que se repite dos veces no es una limitación: es un
agujero con una excusa encima.

Y la excusa era falsa. Para probar el entrypoint **no hace falta un demonio** — bloque I
del canario, **48/48 en 5/5 tiradas**:

- el **sistema de ficheros de la imagen** se reconstruye leyendo los `COPY` del **propio
  `Dockerfile.backend`** (si alguien añade uno, entra solo);
- el **entorno del contenedor** sale de `docker compose config`, que es **cliente puro**;
- el **comando** se extrae del **`CMD` del propio Dockerfile**, quedándose con los
  preflights (lo anterior al primer `node`).

Lo único que sigue necesitando demonio es que la imagen **construya**, y eso lo mide el
`build` de CI. Casos del bloque: entorno real → `rc=0`; falta un secreto del contenedor →
aborta; secreto **publicado** → aborta; webhook en blanco → aborta; **sin catálogo en la
imagen** → aborta (nunca verde sin blanco); y **el catálogo del HOST metido en la imagen →
aborta**, que es el bug exacto de este run, ya con su canario.

**El bloque se ganó el sueldo a los cinco minutos de existir:** cazó un `HAY_COMPOSE:
parameter not set` que yo acababa de introducir —la variable se fijaba dentro de
`$(catalogo)`, una subshell, y no volvía al padre— y que habría hecho salir el entrypoint
con `rc=2` en el siguiente deploy.

### 50.4-quinquies · Que el job diga POR QUÉ: `scripts/diagnose-stack-failure.sh`

Coste medido de no tenerlo: **tres relanzamientos de 8 minutos** para una causa que el
propio job tenía delante. Y el orquestador es el único que puede leer esos logs (a mí el
proxy me bloquea el blob storage de Actions), así que cada ida y vuelta cuesta una corrida.

| Antes | Ahora |
|---|---|
| Espera 5 min aunque el contenedor haya muerto a los 3 s | **Corta en cuanto `ps -a` dice `exited`/`dead`** |
| `docker compose logs` ordenado **alfabéticamente**: el backend enterrado tras `createbuckets`, `postgres`, `redis` | El log del **servicio que falló, primero, solo y con cabecera** |
| «no respondió» y punto | **Causa clasificada + ROL dueño** por firma conocida (preflight de secretos, preflight de webhook, sin blanco, `Missing required env vars`, migraciones, `EADDRINUSE`, módulo ausente…) |
| Solo en el log del job (blob storage, inaccesible por el proxy) | Además en **`::error::`** (se lee **por API**, sin descargar el log) y en **`$GITHUB_STEP_SUMMARY`** (se ve en la página) |

Usa `ps -a` y no `ps` a secas: un contenedor **muerto no sale** en `ps`, y el diagnóstico
diría «no hay nada raro» justo sobre lo que falló.

### 50.5 · El canario: la única prueba de que esto es una clase y no siete líneas

`scripts/check-secret-defaults-canary.sh`. Su regla propia:

> ★ **Todas las mutaciones usan nombres de secreto que NO EXISTEN en este repo.** Ni uno de
> los ocho conocidos. El canario **comprueba esa precondición** (`grep -r`) antes de empezar:
> si alguno apareciera en el árbol, volvería a ser el canario de una variable.

`HSM_UNSEAL_KEY`, `VAULT_ROOT_TOKEN`, `SENDGRID_API_KEY`, `PAYOUT_SIGNING_SECRET`,
`KYC_PROVIDER_PASSWORD`, `LEDGER_HMAC`, `TWILIO_AUTH_TOKEN`, `DB_REPLICA_PASSWORD`.

**32/32, 5/5 tiradas.** Incluye el caso que se nos escapó (bloque G) y tres rojos que el
propio canario descubrió mientras se escribía y que valen más que los otros veintinueve:

- **Amputar `FORMA_SECRETO`** dejaba el candado verde con el árbol lleno de literales. Ahora
  el candado **se muerde a sí mismo** primero (bloque 0): 8 sondas que tiene que reconocer y
  5 no-secretos que tiene que descartar.
- **Un COMENTARIO con `:?`** hacía creer al bloque (G) que el compose seguía siendo exigente
  cuando ya no lo era ⇒ bloque sin blanco, verde silencioso.
- **El generador no tenía la guarda de autorreferencia que sí tenía el candado.** Se vio en
  cuanto los ficheros nuevos pasaron de «sin trackear» a **trackeados**: los ocho secretos
  inventados del canario entraron al manifiesto como si fueran credenciales publicadas.
  No lo son —son el dato de prueba— y registrarlos obligaba a regenerar el manifiesto cada
  vez que se toca un canario: fricción que acaba con alguien apagando el candado.
- **Un COMENTARIO que nombra los ocho** (el que explica de dónde salen, en el generador)
  bastaba para poner rojo el canario por su precondición. **Tercera vez en el mismo pase**
  en que explicar el bug rompe el candado del bug. La precondición mira ahora `^[^#]*`:
  lo que se EJECUTA, no lo que se lee.
- **El canario de `P-WH-1` tenía una mutación NO-OP**: anclaba en el título de un paso que yo
  mismo había renombrado. Una mutación que no muta no prueba nada — y encima se lee como rojo.
  (Por eso ahora comprueba que la sustitución ocurrió.) `31/31 → 5/5` tras arreglarla.

### 50.6 · Cómo se levanta cada cosa ahora

```bash
# Local (una orden, igual que antes; los secretos se generan solos)
./scripts/dev-up.sh                       # env-file + preflight del webhook + up

# Staging a mano
./scripts/secrets-preflight.sh env-file .env
docker compose -f docker-compose.staging.yml --profile apps up -d --build

# Ver qué exige el repo / si un valor está publicado
./scripts/secrets-preflight.sh catalogo
./scripts/secrets-preflight.sh publicado "el_valor_que_dudas"

# Los candados (ambos en `ci.yml`, job `stripe-webhook-failclosed`)
./scripts/check-secret-defaults.sh          # la clase
./scripts/check-secret-defaults-canary.sh   # …y que muerde
```

**En la imagen de producción** (`Dockerfile.backend`), el `CMD` corre **los dos** preflights
antes de migrar y arrancar. Con una precaución que aquí ya costó cara una vez: dentro de la
imagen **no hay ficheros de compose**, así que `assert` no tendría blanco y **saldría 0 sin
mirar nada** (§44). Por eso el catálogo viaja materializado en
`security/secretos-exigidos.txt` —generado desde los mismos `${VAR:?}`, verificado al día por
el candado— y `assert` **falla ruidoso si el catálogo sale vacío**.

### 50.7 · Rollback

| Si… | Qué hacer | Coste |
|---|---|---|
| Un entorno no arranca por un `:?` | `./scripts/secrets-preflight.sh env-file .env` (desechable) o cargar el secreto en el gestor (real). El mensaje del `:?` lo dice literalmente. | segundos |
| El candado bloquea un PR legítimo | **No se desactiva.** Si el valor es un placeholder, que se delate (`CHANGE_ME…`); si es un secreto, que salga del repo. | minutos |
| Un secreto propio coincide con uno publicado | Es correcto que aborte: rótalo. `openssl rand -hex 48` / `openssl rand -base64 32`. | minutos |
| Hay que revertir la clase entera | `git revert` de este commit. **Vuelve el hallazgo ALTO**: siete secretos publicados y el punto ciego del preflight. | — |

### 50.8 · Lo que NO está medido aquí

| Afirmación | Estado |
|---|---|
| Que los compose renderizan con secretos resueltos y **fallan sin ellos** | ✅ medido: `docker compose config` (cliente, sin demonio) — falla con el mensaje del `:?`; `rc=0` con el env-file generado |
| Que el `CMD` de la imagen corre los dos preflights | ✅ **MEDIDO** — bloque I del canario, sin demonio: imagen reconstruida desde los `COPY` del Dockerfile, entorno desde `docker compose config`, comando desde el `CMD`. 48/48 en 5/5. Ver §50.4-quater |
| Que la imagen **construya** | ⏳ NO MEDIDO: eso sí necesita demonio. Lo mide el `build` de CI |
| Que `e2e-real.yml` pasa el paso 3 con la excepción nueva | ⏳ **NO MEDIDO**: requiere una corrida en Actions. La lógica del preflight sí está medida en las 3 direcciones |
| Que las variables existen en Railway/Vercel | ⏳ no es medible desde el repo (§49.1). Lo mide el preflight al arrancar |

---

## 51. CORRECCIÓN — «las claves de prueba de Stripe no están configuradas» era FALSO, y lo medí en el sitio equivocado (2026-09-10)

**Esta sección corrige afirmaciones mías repartidas por §31, §32.7, §39 y §49 de este mismo
fichero.** Se escribe aparte y con fecha, en vez de reescribir la historia, porque es
exactamente la clase de nota que manda a alguien a rehacer trabajo ya hecho (O-5).

### Lo que yo afirmé
Que faltaban los secrets `STRIPE_TEST_SECRET_KEY` y `STRIPE_TEST_PUBLISHABLE_KEY`, que por eso
los tres smokes de dinero se saltaban, y que **el hueco era del humano**.

### Cómo lo medí, y por qué la medición no valía
Corriendo `scripts/stripe-test-key-preflight.sh` **en la máquina local**. Ahí los secrets de
GitHub Actions **no existen por definición**: el script no podía ver otra cosa que «ausente».
Medí en el sitio donde la respuesta estaba garantizada de antemano. No era un dato: era el
eco de mi propia suposición.

### Lo que está medido de verdad
| Hecho | Medición |
|---|---|
| Las dos claves de prueba **están** en los secrets de GitHub | Llevan **tres días** puestas |
| El nocturno corrió los flujos críticos en modo **REAL** | run **`34477885121`**, con `MONEY_SKIPPED` **vacío** |
| Las claves se leen bien en el job | Aparecen enmascaradas (`***`) en el entorno del job (run `34498068945`) |
| El dueño **nunca** transaccionó dinero real | La tienda siempre estuvo en modo prueba ⇒ **no hubo ventana de exposición con dinero real** |

### Lo que sí falta (y esto sí está medido)
El secret **`STRIPE_TEST_WEBHOOK_SECRET`** — que es distinto de las dos claves — **no existe**.
Medición: `e2e-real.yml` run `34498068945`, **paso 3** en `failure` (el preflight del webhook,
con una clave `sk_test_` real presente). **Ya no bloquea el gate de dinero**: §50.4 explica por
qué un secreto generado es, en un stack efímero sin endpoint público, estrictamente más seguro
que uno compartido, y el preflight lo genera avisando. Sigue siendo cierto que **sin ese secret
no se pueden probar webhooks REALES de Stripe en CI** — pero eso no es lo mismo que «el gate no
puede correr».

### Peticiones al humano que se RETIRAN
- ~~«Crea los secrets `STRIPE_TEST_SECRET_KEY` y `STRIPE_TEST_PUBLISHABLE_KEY`»~~ — **hecho hace
  tres días**. Cualquier lista de pendientes que la repita está desfasada.
- ~~«Los tres flujos de dinero siguen sin medirse por falta de clave»~~ — **el nocturno
  `34477885121` los corrió en REAL**. Lo que quede abierto de ese punto ya no es «falta la
  clave».

### Peticiones al humano que quedan: NINGUNA
`STRIPE_TEST_WEBHOOK_SECRET` **no hace falta** para que el gate de dinero corra — medido:
run `34512132641` reproducido en local, rc=0 tras el arreglo de §50.4-bis. Sin ese secret, CI
genera uno efímero y los webhooks entrantes se rechazan por firma, que es lo correcto para un
stack que Stripe **no puede alcanzar**. Solo tendría sentido pedirlo el día que un criterio de
aceptación exija ejercitar **webhooks REALES de Stripe** contra CI. Hoy ninguno lo exige, así
que **no se pide**.


---

## 52. `S-CI-1` — el gate deploy-blocking `backend-e2e` llevaba 9 corridas muerto con rc=127, y por qué nadie lo vio (2026-09-11, hallazgo ALTA de seguridad, bloqueante)

### 52.0 · El hallazgo, medido por seguridad y re-medido por mí

`e2e.yml`, job `backend-e2e` (`defaults.run.working-directory: backend`), paso «Resolver
secretos sin literales públicos (P-WH-1 + S-88-1)»: tres invocaciones `./scripts/…` (líneas
225, 232, 235) sin `working-directory: ${{ github.workspace }}`. Los scripts viven en la raíz.
`cd backend && ./scripts/webhook-secret-preflight.sh assert` → **rc=127**. El paso muere, los
ocho siguientes quedan `skipped`, y con ellos **toda** la suite de integración: `webhook-empty-
secret-forge`, `infra-smoke`, `auth-authz`, `auth-throttle`, `guest-chargeback`,
`buylist-pay-verdicts`, `vault-shipments`, `catalog-checkout-webhook`.

El mismo bloque en `ci.yml:122-137` **sí** lleva el override, con mi propio comentario
explicándolo. Y el paso siguiente de `e2e.yml` también lo lleva. Faltaba en tres líneas entre
dos sitios que lo tenían. Lo introduje yo en `88c48c7` (P-WH-1).

**Cuánto duró, medido en la API de runs (`actions/workflows/e2e.yml/runs`):**

| run | commit | `backend-e2e` | paso 4 |
|---|---|---|---|
| #1123 | `707c4f4` | success | (el paso no existía) |
| **#1124** | **`88c48c7`** | **failure** | `Process completed with exit code 127` (job `102934818193`, 21 s) |
| #1126–#1130, #1132–#1134 | `66b7515` … `0417da1` | failure ×8 | rc=127 en todos |
| #1125, #1131 | — | cancelled | (concurrency) |

**Nueve corridas rojas, once commits, ~7 horas.** Seguridad contó «seis commits» porque midió
seis; la API da nueve rojos consecutivos. Es peor de lo que decía el hallazgo, no mejor.

### 52.1 · El arreglo de las tres líneas

`e2e.yml`: `working-directory: ${{ github.workspace }}` en el paso, con el comentario que ya
tenía `ci.yml`. Verificado con el candado nuevo (§52.3): antes del arreglo **3 invocaciones
muertas**, después **0 de 48**.

### 52.2 · La pregunta de método: ¿por qué un rc=127 pudo estar mudo nueve corridas?

Medí cada hipótesis del encargo. Ninguna de las tres primeras era la causa:

| hipótesis | medición | veredicto |
|---|---|---|
| «`e2e-ok` no lo agregaba» | `e2e-ok` = **failure** en los 9 runs (job `102937961579` en #1124, `103075776403` en #1134) | **falsa**: agregaba bien |
| «estaba en `continue-on-error`» | el paso no lo tiene; `frontend-e2e` sí (soft-gate §24), `backend-e2e` no | **falsa** |
| «nadie mira e2e.yml porque `ci-ok` es el que importa» | parcialmente: `ci-ok` **verde** en los 9; el briefing del candidato citó **un** run verde de `E2E real` (`34538020057`) como «los 23 pasos en verde» | **verdadera a medias**: se miró un workflow, no el commit |

Lo que de verdad lo mantuvo mudo, medido:

1. **Nada consumía el rojo.** No hay rulesets (`/rulesets` → `[]`), la protección de `main` no
   es legible con este token (403) y esta rama es una rama de trabajo: ni Railway ni Vercel
   esperan a `e2e-ok` de esta rama (§16.4: los deploys van por integraciones nativas sobre
   `main`/`production`). Un gate «deploy-blocking» que no bloquea ningún deploy real es un
   letrero, y un letrero rojo nueve veces no cambia nada por sí solo.
2. **El rojo tenía una explicación prefabricada y un dueño por defecto equivocado.** §16.4(B)
   (2026-08-16) decía: «`backend-e2e` rojo ⇒ rol backend, si los specs fallan…» y, con
   honestidad, «devops no puede leer los logs». Esa nota llevaba **26 días sin re-medirse**
   (O-5). Cada vez que alguien vio el rojo, ya sabía «de quién era» y que «no podía leerse».
   Nadie preguntó **qué paso** había muerto — y la API de jobs lo decía en texto claro:
   `steps[4].conclusion = failure`, `steps[5..12] = skipped`, anotación «exit code 127».
3. **`e2e-ok` decía «failure» y nada más.** Un rc=127 en el paso 4 y un spec de dinero roto en
   el paso 12 producían el **mismo** resumen: `backend-e2e: failure`. La señal que distingue
   «la suite corrió y falló» de «la suite no corrió» **no existía**.
4. **El mismo commit puso rojo otro gate con otra explicación prefabricada** (`trivy-fs`,
   §53): dos rojos nuevos a la vez, dos historias listas, cero mediciones.

La frase de seguridad es exacta: *un script que no está donde se le busca se tomó por un test
que falla.* La séptima aparición del patrón «la ausencia de una señal se tomó por una señal».

### 52.3 · Qué cierra cada hueco (y cómo se comprueba)

| hueco | cierre | comprobación |
|---|---|---|
| (3) «failure» sin fase | `backend-e2e` tiene `id` por paso y un último paso `always()` que fija `outputs.fase` ∈ {`suite-verde`, `suite-roja`, `infra-muerta`} y `outputs.paso`; emite `::error title=backend-e2e NO MIDIÓ NADA::…` con el paso y **dueño: devops**, o `LA SUITE CORRIÓ y falló` con **dueño: backend**. `e2e-ok` lee la fase y la nombra; `skipped`/`cancelled` tampoco son verde | anotaciones legibles por API de check-runs (§52.4); el resumen del job las repite |
| (3-bis) logs ilegibles para los agentes | el paso de tests hace `tee` al log; un paso posterior convierte cada `FAIL <spec>` de jest en `::error file=backend/<spec>,line=N` con el nombre del primer test rojo; el log sube como artifact `backend-e2e-log` | `scripts/check-candidate-checks.sh <sha>` imprime esas anotaciones |
| (2) dueño por defecto | corrección fechada en §16.4(B); regla nueva: **un rojo de `backend-e2e` no tiene dueño hasta leer la fase** | — |
| (1)+(4) «se miró un workflow, no el commit» | `scripts/check-candidate-checks.sh [sha]`: lista **todos** los check-runs del commit vía API y, para cada rojo, sus anotaciones. Es la llamada que hizo seguridad y que ningún rol había hecho. Sobre `0417da1`: **25 check-runs, 4 en rojo** (`backend-e2e` con «exit code 127», `e2e-ok`, `trivy-fs`, `sast-ok`) | rc=1 sobre `0417da1`; a partir de hoy va en el runbook de release (§52.5) |
| la clase del defecto (script fuera del cwd) | `scripts/check-workflow-cwd.sh`: para cada paso `run:` de cada workflow resuelve las invocaciones `./scripts/…`, `./security/…`, `./…sh` y `${{ github.workspace }}/…sh` contra el cwd **efectivo** (paso → job → raíz) y exige que el fichero exista. rc=2 (nunca 0) sin parser o sin invocaciones. Job `workflow-cwd` en `ci.yml`, `skipped ≠ verde` en `ci-ok` | sobre el árbol roto: **3 invocaciones muertas** (las de seguridad); sobre el arreglado: **48/48 resuelven** |
| «un candado que no se ha visto rojo» | `scripts/check-workflow-cwd-canary.sh`: 8 casos sobre copia, incluido **quitar el override del paso «Resolver secretos» y exigir rojo nombrando `e2e.yml`/`backend-e2e`/`webhook-secret-preflight.sh`** | **8/8** |

Límite declarado del candado: una línea con `cd …` antes de la invocación no se evalúa (se
imprime como «no evaluada», no se finge). Hoy no hay ninguna en el repo.

### 52.4 · Lo que dijo `backend-e2e` al correr por primera vez

Se rellena con el run del commit de esta sección: ver el resumen de cierre de este pase
(reportado al orquestador con número de run). Regla: **si sale rojo por specs, es hallazgo de
backend con fichero y línea** (anotados por el propio job); no se tapa aquí.

### 52.5 · Runbook: qué se mide antes de llamar «verde» a un candidato

1. `./scripts/check-candidate-checks.sh <sha>` → **todos** los check-runs en `success`. Un run
   verde de un workflow **no** es el estado del commit.
2. Si `backend-e2e` está rojo: leer `fase`/`paso` en sus anotaciones. `infra-muerta` → devops;
   `suite-roja` → backend con los `::error file=…` del job.
3. Un rojo que dura más de una corrida sin diagnóstico **es un hallazgo de devops**, sea de
   quien sea la causa: lo que falla es la medición.

---

## 53. `S-SAST-1` — `trivy-fs` rojo 11 corridas: no era P-DEP-1, era el escáner de SECRETOS de trivy sobre mis propios canarios (2026-09-11, bloqueante por regla 10)

### 53.0 · La teoría de todos, y la medición

Seguridad, el briefing y §49.5 (yo) decían lo mismo: `trivy-fs` rojo por `vitest` CRITICAL +
`vite`/`js-yaml` HIGH en las devDependencies del frontend. Seguridad lo infirió con `npm audit`
(«trivy no está disponible aquí»). **Nadie lo midió con trivy.**

Lo medí con trivy v0.74.0 (compilado desde el proxy de Go; el binario y la DB por ghcr están
bloqueados aquí, la DB salió de `mirror.gcr.io/aquasec/trivy-db:2`), con **la configuración
exacta que corría la action en CI**:

| comando | resultado |
|---|---|
| `trivy fs` default (`vuln`+`secret`), severidad HIGH/CRITICAL, `.` | **RC=1 · 0 vulnerabilidades · 5 CRITICAL `stripe-secret-token`** |
| dónde | `scripts/check-secret-defaults-canary.sh:355,364,374,498` · `scripts/check-stripe-webhook-failclosed-canary.sh:280` |
| `trivy fs --scanners vuln` | **RC=0** (backend 0, frontend 0, s3-local 0) |
| `--list-all-pkgs frontend/package-lock.json` | 148 paquetes, **0 dev**; `vitest` ni aparece |
| `--include-dev-deps` | exactamente las 3 advisories fichadas de P-DEP-1 |

Y el A/B temporal: `Security SAST` #1123 (`707c4f4`) verde; **#1124 (`88c48c7`) rojo** —
el commit que **creó esos dos canarios** con `sk_test_…` de ficción. El mismo commit que mató
`backend-e2e` (§52). Las dos explicaciones prefabricadas apuntaban a otro sitio.

Por qué trivy los ve y gitleaks no: `gitleaks.toml:65` tiene la allowlist
`sk_test_[0-9a-zA-Z_]*` (placeholders); el escáner de secretos de trivy no tiene allowlist en
este repo porque **nadie había decidido encenderlo**: `security/trivy.yaml` declaraba
`scanners: [vuln]` desde el día uno, pero (a) la action **no pasaba** ese config y (b) la clave
estaba en el nivel raíz, donde trivy **no la lee** (avisa `deprecated` de `vulnerability.type`
y calla con `scanners`). Exactamente «dos escáneres, dos criterios, uno rojo y uno verde sobre
el mismo hecho» — pero el hecho eran secretos de ficción, no dependencias.

### 53.1 · Lo que se hizo (y lo que NO)

- **Un comando en un sitio:** `security/scripts/trivy-fs.sh` es el gate; lo ejecuta CI (ya no la
  action), local y el self-test. `--scanners vuln` explícito en el comando **y** en
  `trivy.yaml` (esquema corregido: `scan.scanners`, `scan.skip-dirs`, `pkg.types`; verificado
  sin avisos). Los secretos los juzga **gitleaks**, que ya era el escáner de secretos del repo.
- **NO** se bajó severidad, **no** hay `continue-on-error`, **no** entra nada en `.trivyignore`,
  `ignore-unfixed` sigue en false.
- **devDependencies, misma política:** `security/scripts/trivy-dev-fichas.sh` corre trivy con
  `--include-dev-deps` por app, convierte la salida a la forma de `npm audit` y la pasa por **el
  mismo `audit-npm-dev.sh`** (interfaz de fixtures) con **las mismas fichas y fechas**. Medido:
  verde hoy con las 3 fichas; **rojo** fingiendo `2026-09-25` (`js-yaml` caducada). Ahora sí:
  ficha de `npm-audit` = ficha de trivy, misma caducidad.
- **El canario ya no se apaga con un rojo real:** el self-test anota la **línea base** (color y
  CVE) en vez de exigir verde, planta el lockfile y exige rojo por los CVE del canario **que no
  estaban en la base**; además planta un `sk_test_…` de ficción y exige que **no** se reporte, y
  que el job `gitleaks` siga en `needs` de `sast-ok`. Medido: **5/5** tiradas verdes, canario
  retirado; mutación sobre copia (quitar `--scanners vuln` y `scan.scanners`) → self-test
  **rojo** nombrando el escáner de secretos.

### 53.2 · Corrección a §49.5 y al registro de decisiones

§49.5 afirmaba que el rojo de trivy y el de npm audit eran el mismo hecho. **No lo eran.** El
bloque `REGISTRO` de `security/README.md` (el que se publica en cada run) lo dice ahora con las
mediciones. Lo que sí es cierto de §49.5 y se mantiene: P-DEP-1 está fichado hasta 2026-09-24 /
2026-10-10, dueño frontend, y el trinquete —ahora con dos bases de datos— se pone rojo solo al
vencer.

### 53.3 · Pendiente no bloqueante (medido 2026-09-11)

`security-scheduled.yml` evalúa la caducidad de las fichas semanalmente con `npm audit`; el
trinquete de trivy solo corre por push. Como las fechas son las mismas, la caducidad sí se
evalúa por calendario; lo que no se evalúa semanalmente es un hallazgo **nuevo** que solo
trivy vea. Añadirlo exige instalar trivy en el job semanal. Ficha: **devops, revisar antes de
2026-10-10** (misma fecha que las fichas de P-DEP-1).

---

## 54. `S-CLASE-1` — el candado de clase cubre una subclase; lo que se cierra hoy y lo que queda fichado (2026-09-11, MEDIA)

**Medido por seguridad:** 19 formas fuera de las ocho sondas de `check-secret-defaults.sh`;
muerde 3, escapan 16, y 7 escapan también al manifiesto de valores: `${VAR-lit}` (un guion),
`${VAR:=lit}`, `: "${VAR:=lit}"`, nombres `SMTP_PASS`/`DB_PASS`/`ADMIN_PIN`/`RECOVERY_CODE`/
`MASTER_PEPPER`/`SESSION_SEED`/`CLABE_CIPHER`, `.env.staging` versionado, `RUN echo "X=…" >>`,
`environment:` en forma de lista, `VAR=lit` sin `export` / `declare -x`. **Ninguna existe hoy en
el árbol** (seguridad lo midió con `grep`; no lo repito como propio).

**Cerrado hoy:** `.gitignore` pasa de una lista de nombres a `.env.*` con la única excepción
`!.env.example`. Medido con `git check-ignore -v`: `.env.staging`, `.env.local`,
`.env.production.local` → ignorados; `.env.example` → no ignorado y sigue trackeado.

**Ficha (devops, después de publicar, revisar antes de 2026-09-25):** (1) aceptar `${VAR-…}` y
`${VAR:=…}` en el mismo escáner que ya lee `${VAR:-…}`; (2) añadir `PASS|PIN|PEPPER|SEED|CODE|
CIPHER` a `FORMA_SECRETO` en su fuente única (`gen-published-secrets-manifest.sh`); (3) cubrir
`environment:` en lista, `RUN echo … >>` y la asignación sin `export`; (4) **los 7 casos al
canario** (`check-secret-defaults-canary.sh`), para que la frase «ningún secreto —ni los que aún
no existen—» vuelva a medir lo que afirma; hasta entonces, el mensaje del candado debe decir lo
que cubre. Condición de promoción a producción según seguridad (§7.3 de su re-veredicto), no
bloqueante del ALTA.

---

## 55. Cierre por decisión del dueño (2026-09-11): lo que quedó commiteado, lo que quedó fuera, y los hechos medidos del lote de QA

**Contexto:** el dueño decidió publicar sin esperar a que `backend-e2e` corriera en CI; el lote de
once puntos de QA y lo que sigue pasan al frente «andamiaje de CI», que arranca **después** de
publicar. Esta sección existe para que ese frente arranque de un hecho medido, no de un recuerdo.

### 55.1 · `backend-e2e`: la SEGUNDA causa, reproducida y arreglada (commit de esta sección)

Run `34550891573` (#1136, `874ee0c`): `fase=infra-muerta · paso=Resolver secretos`, 13 s. El
`working-directory` sí aterrizó; el paso moría por otra causa. **Reproducido ejecutando el `run:`
real del paso con el env real del job** (`scripts/run-workflow-step.sh`, nuevo):

| paso real ejecutado con `GITHUB_ACTIONS=true`, `sk_test_` de mentira, sin webhook secret | rc |
|---|---|
| `e2e.yml` / `backend-e2e` / «Resolver secretos» (antes del fix) | **1** — «Hay STRIPE_SECRET_KEY real y NO hay STRIPE_WEBHOOK_SECRET» |
| `e2e-real.yml` / `e2e-real` / «Resolver STRIPE_TEST_WEBHOOK_SECRET» | 0 |
| `e2e.yml` tras añadir `STRIPE_WEBHOOK_UNREACHABLE: "1"` al paso | **0** — escribe `STRIPE_WEBHOOK_SECRET`, `JWT_*` efímeros |

La única diferencia de env entre los dos bloques era esa variable (`e2e-real.yml` y
`security-dast.yml:207` la declaran; el bloque de `e2e.yml` se copió sin ella). Es cierta por
construcción: la app corre en el runner sin URL pública.

**Lección de método (tercera vez):** arreglé el cwd, probé el candado estático (8/8) y **no ejecuté
el paso real en el contexto real**. Lo que lo habría cazado es exactamente `run-workflow-step.sh`.
El canario de clase (`check-secret-defaults-canary.sh`, bloque H) ejecuta el paso entero **solo de
`e2e-real.yml`**; los otros dos consumidores del mismo bloque (`e2e.yml/backend-e2e`,
`security-dast.yml/dast`) **no** están cubiertos. Pendiente del siguiente frente: un canario que
corra los tres con `run-workflow-step.sh` (verde con `sk_test`+sin secreto; rojo al quitar
`STRIPE_WEBHOOK_UNREACHABLE` de una copia).

**Observación para seguridad (no arreglada, no bloqueante hoy):** con `STRIPE_WEBHOOK_UNREACHABLE=1`
en CI el preflight también deja pasar una **`sk_live_`** sin secreto (medido: rc=0). El webhook no
es forjable —el stack es inalcanzable— pero una clave live en CI es otro hecho que ese preflight no
distingue.

**Lo que `backend-e2e` dijo al correr por primera vez: todavía nada.** Sigue sin ejecutar la suite;
la primera corrida con este fix es la del commit de esta sección (o la del merge). Si sale
`fase=suite-roja`, los specs quedan anotados con fichero y línea y el dueño es **backend**.

### 55.2 · H1 — confirmado, y matizado

`GET /branches/main` y `/branches/production`: `protected:false`,
`required_status_checks.enforcement_level:off`, `checks:[]`; `/rulesets` → `[]`. **Ningún check
bloquea nada a nivel GitHub.** Confirma la respuesta de QA a la pregunta de método: el rojo de
`backend-e2e` llegaba a `e2e-ok`, y `e2e-ok` no bloquea nada. Matiz medido (§52.2): H1 explica por
qué el rojo **no detuvo** nada; por qué nadie **lo miró** lo explican el dueño por defecto de
§16.4(B), la ausencia de fase y que se citó un run verde de `E2E real` como estado del candidato.

**Required checks a activar (humano, Settings → Branches / Rulesets), nombres exactos de job:**
`ci-ok` · `e2e-ok` · `sast-ok` en `main` **y** `production`. Antes de activarlos, renombrar el job
`ci-ok` de `deploy.yml:152` (colisión de nombre con el de `ci.yml`; pendiente, ver 55.5).

### 55.3 · H2 — medido; las dos afirmaciones falsas, corregidas aquí

| workflow | runs con `event=schedule` | nota |
|---|---|---|
| `security-dast.yml` | **0** | `main` va 87 commits atrás; el cron no existe allí |
| `security-scheduled.yml` | 4 (`main`, 2026-08-24/31, 09-07, success) | es la versión **vieja** de `main`: el `scheduled-dast` no-op de P-77 sigue corriendo cada lunes donde importa |
| `money-gap-nag.yml` | **404** (no existe en la rama por defecto) | 0 runs, 0 issues (`/issues` no tiene ninguno «Dinero SIN MEDIR») |

**Correcciones (O-5):** §36.6 («DAST programado semanal … ✅ CORREGIDO en P-77») es cierto del
**fichero** y falso del **calendario**: hasta el merge a `main` el DAST semanal **no ha corrido
nunca**. §49.6 («`money-gap-nag.yml` hace ruido semanal») es **falso**: nunca corrió, y es obsoleto
(las claves existen, §51). Pendiente: retirarlo con nota (55.5).

### 55.4 · H3 — NO MEDIBLE desde aquí, y la pregunta exacta para el dueño

`ci-ok`/`sast-ok` rojos en `main` y `production` tres pushes seguidos (QA). El proxy de esta sesión
corta el CONNECT a `tcg-vault-mx-production.up.railway.app` y a `tcghunt.mx`, así que no puedo leer
`/api/v1/health` (que lleva el commit servido). **Pregunta para el dueño (dos datos del panel):**
(1) Railway → servicio `backend` → Deployments: **commit y fecha del deploy `Active`** — si es
`e117441` (`production`) o `5f05b08` (`main`), se desplegó con CI en rojo; si es anterior, «Wait for
CI» lo frenó; (2) Settings → Deploy: **¿está activado «Wait for CI»?**

### 55.5 · Estado exacto del lote al parar

| # | punto | estado | evidencia |
|---|---|---|---|
| 1 | `backend-e2e` rc=127 | **commiteado** (`874ee0c`) + segunda causa **commiteada** (esta sección) | 55.1 |
| 2 | `trivy-fs` + self-test | **commiteado** (`874ee0c`); `Security SAST` #1136 **verde** | §53 |
| 3 | `gitleaks-action@v2` / Node 20 | **fuera**. Medido: `gitleaks v8.30.1 git .` sobre el historial completo con `security/gitleaks.toml` → **17 hallazgos**, todos ficción o falso positivo: fixtures de `check-secret-defaults-canary.sh` (:172,:177,:204,:209,:355-375,:505) y `check-stripe-webhook-failclosed-canary.sh` (:200,:298); `backend/test/seed.password.spec.ts:27` (contraseña de test); `pii-crypto.service.ts:152` (`asB64.length`, falso positivo). La action estaba verde porque solo escanea los commits del push. Reemplazo por binario fijado (`v8.30.1`) + `sast-gitleaks.sh` en modo `git` exige antes esa allowlist (por valor, no por fichero) | scratchpad de esta sesión; no persiste |
| 4 | `format-mix` verde sin base / rc=2 | **fuera** (sin tocar `ci.yml`) | — |
| 5 | canarios para 4 jobs sin rojo | **scripts commiteados, NO cableados**: `check-format-mix-canary.sh` (4/4), `check-e2e-provider-incapacitation-canary.sh` (5/5), `check-provenance-gate-canary.sh` (6/6), `security/scripts/sast-semgrep-canary.sh` (4/4 con semgrep 1.177.0; en `sh` POSIX para el contenedor). Cablearlos = un paso en cada job; se dejó fuera para no meter un rojo nuevo en el candidato que se publica. Límite medido del comparador BL-27: un HEAD que **no** es prettier-limpio se **salta sin evaluar** (por diseño: solo juzga commits de reformateo) | ejecutados en local 2026-09-11 |
| 6 | DAST `abrir-issue` solo en `schedule` | **commiteado** (`!= 'pull_request'`) | esta sección |
| 7 | `money-gap-nag.yml` | **fuera** (retirar con nota) | 55.3 |
| 8 | notas :6736 / :9940 | **corregidas aquí** (55.3), no reescritas in situ | — |
| 9 | `deploy.yml` job `ci-ok` duplicado | **fuera** (`deploy.yml:152`, `needs: [ci-ok]` en :175) | — |
| 10 | 22 scripts sin workflow | **fuera**; lista medida (wf=0): `check-candidate-checks.sh`, `check-graded-estimate-dials.sh`, `db-migrate.sh`, `dev-down.sh`, `dev-up.sh`, `e2e-capability-gate.sh`, `gen-published-secrets-manifest.sh`, `m50-rollback-gate.sh`, `new-project.sh`, `purge-synthetic-poc-data.sh`, `rollback-safety-probe.sh`, `seed-synthetic.sh`, `seed.sh`, `vercel-ignore-build.sh`, `security/scripts/{_guard,dast-extra,dast-nuclei,dast-zap-baseline,dast-zap-full,sast-gitleaks,sast-semgrep,trivy-image}.sh` (`trivy-fs.sh` ya está cableado). Varios los invocan otros scripts (`gen-published-secrets-manifest` ×5, `e2e-capability-gate` ×4, `_guard` ×4, `dev-up` ×4); la clasificación manual/cablear/borrar queda para el siguiente frente | `grep` sobre workflows/scripts/Dockerfiles |
| 11 | nombre del workflow programado | se arregla solo al mergear | — |

Nuevos ficheros de este cierre, todos verificados en local y **ninguno invocado por CI todavía**:
`scripts/run-workflow-step.sh`, los cuatro canarios de (5).

---

## 56. Andamiaje de CI (2026-09-11): que un rojo signifique algo y un verde también

Encargo del orquestador sobre `claude/tcg-hunt-orchestration-2` (base `17ce9a9` = `origin/main`;
`origin/production` = `c13f417`). Todo lo de abajo está **medido en este entorno** salvo lo marcado
**NO MEDIDO AQUÍ** (lo mide CI al empujar). Herramientas del scratchpad: gitleaks v8.30.1 (`go install`
del módulo `zricethezav/gitleaks/v8`), actionlint 1.7.12, shellcheck 0.11.0, semgrep de pip, Node
v22.22.2 (`/opt/node22`) y v24.21.0 (tarball de nodejs.org). **No hay demonio de Docker** en este
entorno (`docker ps` → «cannot connect to the docker API»): nada que necesite construir una imagen se
midió aquí.

### 56.1 · Prioridad 1 — Node 20 fuera de los runners el 2026-09-16

**Qué se cambió (commit `e7de08d`):** `node-version: 20` → **`24`** en los 8 sitios que había entonces
(`ci.yml` ×3, `e2e.yml` ×2, `e2e-real.yml`, `security-sast.yml`, `security-scheduled.yml`); hoy son
**9 líneas** porque #5 (`9db7b64`) añadió un `setup-node` en `format-mix-base` para el canario
(`grep -c node-version .github/workflows/*.yml` = 9, re-medido 2026-09-11; corrige QA). Y —esto es lo que de
verdad rompe el 16— las **acciones cuyo runtime es node20** (leído del `action.yml` de cada tag en
raw.githubusercontent.com): `actions/checkout` v4→**v5** (×33), `actions/setup-node` v4→**v5** (×8),
`actions/upload-artifact` v4→**v6** (×7; v5 sigue en node20), `actions/download-artifact` v4→**v7**
(v5 y v6 siguen en node20), `github/codeql-action/upload-sarif` v3→**v4**, `aquasecurity/trivy-action`
v0.33.1→**v0.36.0** (composite; su `actions/cache` interno pasa de v4.2.4/node20 a v5.0.5/node24 y
**sí corre**: `cache` es `true` por defecto), `zaproxy/action-baseline` v0.12.0→v0.15.0 (luego retirado
con `dast-staging`), `gitleaks/gitleaks-action` v2→**v3** (commit `bff043c`, ver 56.3).

**Por qué 24 y no 22:** las dos se midieron sobre COPIA del árbol (`scratchpad/devops-ci/n22`, `n24`):
backend `npm ci` + `npx prisma generate` + `lint` + `typecheck` + `build` → **rc=0 (5/5)** y frontend
`npm ci` + `lint` + `typecheck` + `build` → **rc=0 (4/4)**, con **ambas** versiones. Ni backend ni
frontend declaran `engines` (0 coincidencias en los dos `package.json`); lockfiles v3. Se eligió la LTS
**activa** (24); 22 es mantenimiento hasta 2027-04 y habría obligado a repetir esto en meses.

**Dockerfiles (commit `ca094f2`):** `node:20-alpine` → `node:24-alpine` en `Dockerfile.backend:22` y
`Dockerfile.frontend:22` (el tag existe: HTTP 200 en Docker Hub). **NO MEDIDO AQUÍ:** la construcción
de las dos imágenes (sin demonio). La mide `trivy-image` en la primera corrida (construye ambas con
`--target runtime`; el guard de `rm -rf …/npm` usa las mismas rutas en node:24-alpine).

**Validación:** `actionlint -no-color` sobre los 8 workflows → 0 avisos; `yaml.safe_load` OK ×8.
**NO MEDIDO AQUÍ:** el comportamiento real de cada acción nueva en el runner (setup-node v5 activa caché
automática solo si hay `packageManager` en package.json — no lo hay; checkout v5 «solo cambia el
runtime» según su README).

### 56.2 · Prioridad 2 — `check-candidate-checks.sh` mentía (C5)

**Reproducido (antes):** `./scripts/check-candidate-checks.sh 17ce9a9` → `node: Argument list too
long` (respuesta de 206 KB por `argv`) → rc=2 → «el commit no tiene NINGÚN check-run». Por API:
**49 check-runs, 49 success, 0 sin terminar** (había 47 cuando lo midió el orquestador).

**Arreglo (commit `3503008`):** la respuesta va a fichero temporal por página (`curl -o`) y `node` la
lee de disco; pagina por `total_count` (hasta 10×100); tres ramas de fallo con rc=2 y mensaje propio
(«NO parseable», «respuesta inesperada», «no pude ejecutar el parser»); la rama «NINGÚN check-run»
**solo** con `total_count=0`. **Después:** mismo comando → «Los 49 check-runs de 17ce9a9 están en
verde», rc=0.

**Canario nuevo** `scripts/check-candidate-checks-canary.sh` (sin red: `curl` y `node` de mentira en
PATH, script real copiado a un repo git temporal), 9 casos: verde con 49, con **328 KB** (la respuesta
que rompía `execve`) y con 150 en dos páginas; rc=2+«NINGÚN» solo con `total_count=0`; rc=2+parseo
con HTML, con JSON sin `check_runs` y con un `node` que revienta (la mutación literal del fallo); rc=1
con failure; rc=2 con in_progress. **Medido: 9/9 en 3/3 tiradas** con el script nuevo; **5/9 (rojo)**
contra el script viejo (copia en `scratchpad/devops-ci/mut-c5-old`). No cableado en CI (necesita token
con lectura y no gatea nada: es un instrumento del orquestador; ver 56.7).

### 56.3 · Prioridad 3 — gitleaks: P-GL-FP y C4/S-GL-1 juntos (commit `bff043c`)

**Antes (medido con gitleaks v8.30.1 sobre un clon en el scratchpad, `security/gitleaks.toml` de
`17ce9a9`):**
- rango del run rojo `34554095125` (`git . --log-opts="--no-merges --first-parent 88c48c7^..c9ba265"`,
  20 commits): **9 hallazgos**, todos en `scripts/check-secret-defaults-canary.sh` (:168,:173,:205,:351,
  :360,:370,:371,:505) y `scripts/check-stripe-webhook-failclosed-canary.sh` (:290);
- `git .` historial completo: **12**; `dir .` árbol: **12** (los 9 + 3 de `backend/`, ver abajo);
- y **`sk_test_51QrEaL…` de la línea 498 del canario NO aparecía**: la allowlist `sk_test_[0-9a-zA-Z_]*`
  (sin anclas, con `*`) casaba cualquier `sk_test_` — S-GL-1 literal.

**Cambio en `security/gitleaks.toml`:** (a) `[allowlist] paths` + `^scripts/check-secret-defaults-canary\.sh$`
y `^scripts/check-stripe-webhook-failclosed-canary\.sh$` (por RUTA; ninguna regex se ensancha);
(b) regex `^(sk|pk|rk)_test_(?:[A-Za-z_]+|[A-Za-z0-9_]*(?:dummy|DUMMY|CHANGE_ME|change_me|placeholder|PLACEHOLDER)[A-Za-z0-9_]*)$`
en lugar de `sk_test_…*`/`pk_test_…*`: pasa un placeholder **sin dígitos** o **con palabra
auto-delatora**; una clave real (`sk_test_51`+alfanumérico) no pasa. Placeholders del árbol
comprobados: `sk_test_dummy`, `sk_test_e2e_dummy`, `sk_test_CHANGE_ME`, `sk_test_xxx…`,
`sk_test_dummydummy…`, `sk_test_algo`, `pk_test_ci_dummy`, `pk_test_scan`.

**Después (mismo binario, misma config nueva):** rango `88c48c7^..c9ba265` → **0** (rc=0); rango de la
rama `c13f417..17ce9a9` → **0**; `git .` completo → **3**; `dir .` → **3**. Los 3 que quedan son de
**backend/** y no están en el rango de ningún push reciente (por eso CI estaba verde): `generic-api-key`
en `backend/src/common/crypto/pii-crypto.service.ts:152` (`asB64.length…`, falso positivo) y en
`backend/test/seed.password.spec.ts:27` (contraseña de test), y `generic-api-key-assignment` (regla
propia) en `backend/test/graded-estimate.ingest.spec.ts:504`. **Dueño: backend** (o seguridad decide
allowlist por ruta de `backend/test/`); devops no toca esas rutas.

**Canario nuevo** `security/scripts/sast-gitleaks-canary.sh` (11 casos, modo `dir` y modo `git` —el de
CI—): rojo con `sk_test_51`+32 mixtos en `backend/src` y como `STRIPE_SECRET_KEY=…` en `scripts/`,
con `sk_live_`, con `whsec_`, con el contenido de un canario en OTRA ruta y bajo `tools/scripts/`;
verde con árbol limpio, con los placeholders del repo y con los dos canarios en su ruta exacta.
**Medido: 11/11 en 3/3 tiradas** con la config nueva; **6/11 (rojo)** con la config vieja (mutación
sobre copia: la clave real pasaba y los canarios salían rojos). Cableado en `security-sast.yml` tras
la acción (`!cancelled()`; la acción deja el binario en PATH vía `core.addPath`).

**gitleaks-action v2→v3:** README v3: «no changes to inputs, outputs, or behavior», runtime node24;
`src/gitleaks.js` de v3 sigue escaneando `--log-opts=--no-merges --first-parent base^..head` y dejando
`results.sarif` como artifact ⇒ es la opción que mantiene el comportamiento medido (sustituirlo por
`sast-gitleaks.sh` en modo `git` habría escaneado el historial completo y sacado los 3 de backend).
`GITLEAKS_VERSION: "8.30.1"` fijado. **NO MEDIDO AQUÍ:** la corrida de la acción v3 en el runner.

### 56.4 · Prioridad 4 — el DAST corre sobre lo publicado (P-77 / C2, commit `8267194`)

**Antes:** `security-dast.yml` con `schedule` + `workflow_dispatch` + `workflow_call` + push a
`devops/dast-**`; **nadie** lo invocaba con `uses:`; `checkout` sin `ref:`; 6 runs históricos, todos
por push a `devops/dast-p77`. `deploy.yml` con `dast-staging` (INERTE, `STAGING_BASE_URL` nunca
existió; HECHOS.md: no hay staging).

**Cambio:** `security-dast.yml` gana `inputs.ref` (dispatch y call) e `inputs.report_only` (call);
`SCAN_REF = inputs.ref || github.sha` en env; los tres `checkout` llevan `ref: SCAN_REF`; paso nuevo que
imprime en log y en resumen **qué commit se escanea** (`git rev-parse HEAD`, SCAN_REF, evento,
report_only); el issue cita SCAN_REF. `deploy.yml` gana `on.push.branches: [production]` y el job
**`dast-release`** (`uses: ./.github/workflows/security-dast.yml`, `ref: ${{ github.sha }}`,
`scan_profile: full`, **`report_only: true`**, `secrets: inherit`, `permissions: issues: write`), que
**no depende de `secrets-gate`**: en un push a `production` es lo único que corre (el CD sigue
saltado). `dast-staging` retirado; `promote-production-*` pasan a `needs: [dast-release, e2e-real]` con
`needs.dast-release.outputs.blocking != 'true'`; `STAGING_BASE_URL` fuera de `secrets-gate`/`preflight`.
`scripts/check-provenance-gate.sh` (#5) ahora exige que el bloque `dast-release` llame al DAST con
`ref: github.sha` y que `security-dast.yml` levante con `dast-ephemeral.sh up` (que invoca
`assert-serving-head.sh`); su canario pasa de 6/6 a **9/9 (3/3 tiradas)**.

**Medido:** actionlint 0 avisos; yaml OK; los 6 gates estáticos de `ci.yml` que leen estos ficheros
(`check-dast-gate-live`, `check-workflow-cwd`, `check-secret-defaults`, `check-provenance-gate`,
`check-e2e-harness-gaps`, `check-e2e-provider-incapacitation`) → rc=0 (6/6) sobre el árbol.
**NO MEDIDO AQUÍ:** el run real de `dast-release`. Lo mide el primer push a `production` con esta
`deploy.yml`.

**Dispatch sobre el SHA publicado (lo lanza el orquestador, no devops):**
```
gh workflow run security-dast.yml --ref claude/tcg-hunt-orchestration-2 \
  -f ref=c13f4179be5ea073b91819ce38ee5e87d44ad06f -f scan_profile=full -f report_only=false -f active_max_mins=10
```
(`--ref` = rama con esta versión del workflow; `-f ref` = commit que se escanea = lo publicado.
Con `report_only=false` el candado SÍ bloquea el run: es el primer barrido `full` citable.)

**Corrección tras el run 34560602347 (dispatch con `ref=c13f417`, `failure`):** `actions/checkout`
no acepta un SHA abreviado como `ref` (hace `git fetch … +refs/heads/c13f417*` y falla 3/3). Ahora el
workflow tiene un job previo **`resolver-ref`** que resuelve `inputs.ref || github.sha` a SHA completo
con `GET /repos/{repo}/commits/{ref}` (medido contra la API real: `c13f417` → `c13f4179…`, `production`
→ `c13f4179…`, `no-existe-zzz` → «No commit found», que el job convierte en `::error` y rc=1) y lo
propaga `resolver-ref → selftest.outputs.sha → dast.outputs.sha → abrir-issue` (para que `dast` siga
siendo exactamente `needs: [selftest]`, como exige `check-dast-gate-live.sh`). Los tres checkouts usan
ese sha; el paso «Qué commit se escanea» además comprueba `git rev-parse HEAD == sha`. Desde entonces
el dispatch acepta rama, tag o SHA corto/largo.

### 56.5 · Prioridad 5 — resto del lote §55.5

| # | punto | estado | commit | medición |
|---|---|---|---|---|
| 4 | `format-mix` verde sin base / `exit 0` en rc=2 | **hecho** | `ad00589` | job partido en `format-mix-base` (resuelve base; sin base → `::warning` + resumen «no medido») y `format-mix` (`if: outputs.ref != ''` ⇒ **SKIPPED** explícito; rc=2 ⇒ `::error` + `exit 1`). `ci-ok` imprime ambos y falla si cualquiera es `failure`. actionlint 0; yaml OK (15 jobs). **NO MEDIDO AQUÍ:** el skipped/rojo en el runner. |
| 5 | 4 canarios sueltos | **hecho** | `9db7b64` | `check-format-mix-canary.sh` en `format-mix-base` (corre SIEMPRE, con setup-node para el `npx prettier@3.9.6`); `check-e2e-provider-incapacitation-canary.sh` en `e2e-provider-guard`; `check-provenance-gate-canary.sh` en `provenance-gate`; `sh sast-semgrep-canary.sh` en el job `semgrep` (contenedor). Local: 4/4, 5/5, 9/9 (3/3), semgrep **4/4 con la config local**. **NO MEDIDO AQUÍ:** semgrep con `p/default…` (semgrep.dev → 403 por el proxy). `grep -rl` en workflows: 0 → 2 ficheros. `check-workflow-cwd`: 57/57. **Rojo en CI y arreglo (runs 34559904088 y 34560593892, job `semgrep`):** el gate principal verde (83 reglas, 0 hallazgos) pero el canario 4/4 rojo con «path `security/semgrep.yml` does not exist» (rc=7): `SG_CONFIGS` trae la config **relativa** a la raíz y el canario hace `cd` al árbol temporal. Reproducido en local con la misma invocación (`sh`, cwd raíz, `SG_CONFIGS="--config=security/semgrep.yml"`): rc=1, mismo mensaje, 4/4. Arreglo: el canario sustituye cualquier `--config=…semgrep.yml` de la lista por la ruta **absoluta** `$SEC_DIR/semgrep.yml` (bajo el workspace, que el contenedor tiene montado) y aborta si no existe. Después, misma invocación: **4/4 en 3/3 tiradas**; también 4/4 sin `SG_CONFIGS`. |
| 7 | `money-gap-nag.yml` | **retirado** | `db8f581` | `git rm`; única referencia restante: comentario histórico en `check-stripe-webhook-failclosed.sh:238`. |
| 8 | notas `:6736` y `:9940` | **corregidas in situ** | (este commit) | fila «DAST programado semanal» → «corregido en el fichero, no en el calendario»; fila «tres flujos de dinero» → CERRADO, era falsa, y `money-gap-nag` nunca hizo ruido; fila «DAST contra staging» → describe `dast-release`. |
| 9 | `ci-ok` duplicado en `deploy.yml` | **hecho** | `b0cafe6` | `deploy.yml` job `ci-ok` → `deploy-ci-gate` (`needs` actualizado). Nombres únicos: `ci-ok` solo en `ci.yml`. |
| 10 | scripts sin workflow | **clasificados** (abajo) | — | `grep -rl <nombre> .github/workflows/` = 0 para 24 scripts (los 4 canarios ya no cuentan). |
| H1 | protección de ramas | **propuesta, no activada** (decisión del dueño) | — | re-medido hoy: `main` y `production` `protected: false`; `/rulesets` = `[]`. Ver 56.8. |
| C1 | `check-secret-defaults.sh` cubre una subclase | **hecho** | (este commit) | ver 56.6. |

**#10 · Clasificación de los 24 scripts sin invocación desde un workflow** (medido con `grep -rl` en
workflows y en scripts/Dockerfiles/compose):

*Manual por diseño (no se cablean):* `check-candidate-checks.sh` + su canario (instrumento del
orquestador con token; no gatea), `check-graded-estimate-dials.sh` (lo corre `post-deploy.sh` a mano
en Railway, §32.11), `db-migrate.sh`/`dev-down.sh`/`dev-up.sh`/`seed.sh` (entorno local; los usa
`docker-compose.yml`), `seed-synthetic.sh` (lo invoca `docker-compose.staging.yml` y `price-provider-parity.sh`),
`purge-synthetic-poc-data.sh` (lo invoca `stack-native.sh`), `m50-rollback-gate.sh` +
`rollback-safety-probe.sh` (runbook de rollback, §46.3: se corren a mano ANTES de revertir),
`new-project.sh` (plantilla), `vercel-ignore-build.sh` (Ignored Build Step de Vercel: se configura en el
panel de Vercel, no en Actions — **NO MEDIDO** que el panel lo tenga puesto), `security/scripts/_guard.sh`
(librería de los dast-*), `security/scripts/{dast-extra,dast-nuclei,dast-zap-baseline,dast-zap-full}.sh`
(el pentester/seguridad contra local; la ruta de CI es `dast-ephemeral.sh`), `sast-gitleaks.sh`,
`sast-semgrep.sh`, `trivy-image.sh` (equivalentes locales de los jobs; CI usa la acción/comando directo).

*Invocados por otros scripts que SÍ corren en CI (cableados de forma indirecta):* `e2e-capability-gate.sh`
(`stack-native.sh`, `check-e2e-harness-gaps.sh`), `gen-published-secrets-manifest.sh`
(`check-secret-defaults.sh`, preflights).

*Debería estar cableado:* **ninguno** con coste bajo y valor claro más allá de los 4 canarios de #5.
*Muerto:* ninguno (todos tienen invocador o runbook).

### 56.6 · C1 — el candado de clase cubre la clase (S-CLASE-1)

**Qué se cambió:** `scripts/gen-published-secrets-manifest.sh:90` `FORMA_SECRETO` + `PEPPER|CIPHER|_PASS$|_PIN$|_SEED$|_CODE$`;
`NO_SECRETO` + las familias que esos sufijos arrastran y no son secretos (`HTTP_CODE`, `EXIT_CODE`,
`COUNTRY_CODE`…, `DO_SEED`, `RANDOM_SEED`…, `…_PASS` de render). `scripts/check-secret-defaults.sh`:
(A.1/C) un solo helper `defaults_con_literal` que entiende `${VAR:-lit}`, `${VAR-lit}`, `${VAR:=lit}` y
`${VAR=lit}` (cubre `: "${VAR:=lit}"`); (A.3) `environment:` en forma de **lista** (`- VAR=lit`);
(C) `asignaciones_peladas`: `VAR=lit` **sin `export`**, tras `declare -x`/`readonly`/`local` y dentro
de `echo "VAR=lit" >> /app/.env` (descarta referencias, `%s`, huecos, placeholders, `0/1`, arrays `(`);
(D.2) cualquier `.env*` **versionado** distinto de `.env.example` con un secreto usable ⇒ rojo.
`security/scripts/sast-gitleaks-canary.sh` pasa a autoreferente (planta claves de ficción).

**Medido sobre el árbol (clon limpio de `cb904d4` + estos scripts):** primer pase → 1 falso positivo
(`check-graded-estimate-dials.sh:271` `PENDING_KEYS=(` — array) → corregido; luego «manifiesto
DESFASADO» porque la forma nueva inventaría **1** valor más (`FIXTURE_E2E_PASS`, de
`price-provider-parity.sh`) → manifiesto regenerado en el clon limpio y commiteado
(`security/secretos-publicados.sha256`, +1 línea) → **gate verde (rc=0)**.

**Canario** `scripts/check-secret-defaults-canary.sh`: +6 nombres inventados (`SMTP_RELAY_PASS`,
`VAULT_ADMIN_PIN`, `MASTER_PEPPER`, `SESSION_SEED`, `RECOVERY_CODE`, `CLABE_CIPHER`; comprobado con
`grep` que no existen en config/código) y bloque nuevo «S-CLASE-1» con los 7 casos de seguridad como
**14 mutaciones en rojo** (1 `${VAR-lit}`, 2 `${VAR:=lit}`, 3 `: "${VAR:=lit}"` en .sh, 4a-4f un caso
por sufijo nuevo en compose/script/.env.example/workflow, 5 `.env.staging` versionado, 6 Dockerfile
`RUN echo … >> /app/.env`, 7 lista de environment, 8a sin `export`, 8b `declare -x`) y **4 controles en
verde** (`${VAR-}` vacío, `HTTP_CODE/DO_SEED/EXIT_CODE/COUNTRY_CODE`, array + referencias, `.env.staging`
solo con `CHANGE_ME`). **Proporciones:** **66/66 en 3/3 tiradas** con el gate nuevo (48/48 → 66/66); **52/66 (ROJO)** con el gate viejo sobre copia (`scratchpad/devops-ci/repo-old`, scripts de `cb904d4`): escapan exactamente los 14 casos nuevos y ninguno más.

**Manifiesto regenerado tras los commits de backend del Stream A (re-medido sobre clon limpio de
`c0d1b68`):** `gen-published-secrets-manifest.sh --check` → rc=1 (desfasado) por **8 entradas nuevas**
que el generador inventaría desde `backend/`: los 4 códigos de error de `error-codes.ts:32-40`
(`PASSWORD_CHANGE_REQUIRED`, `PASSWORD_NOT_SET`, `CURRENT_PASSWORD_INCORRECT`, `PASSWORD_SAME_AS_CURRENT`
— constantes, no secretos, pero contienen `PASSWORD` y el generador prefiere sobrar a faltar), los dos
secretos JWT de `backend/test/auth.change-password.spec.ts:34-35` (`unit_access_secret`,
`unit_refresh_secret`: literales en un test, ahora **neutralizados** — ningún entorno real puede
arrancar con ellos) y 2 valores con prefijo de Stripe en ficheros de test. Regenerado y commiteado;
gate sobre el clon limpio con el manifiesto nuevo → **rc=0** (6 respaldos literales ajenos, todos
neutralizados). **Nota para backend:** cada literal de secreto nuevo en `backend/test` obliga a devops
a regenerar el manifiesto; si no se regenera, `stripe-webhook-failclosed` sale rojo por «DESFASADO».

### 56.7 · Lo que NO pude medir aquí y CI medirá al empujar

- Construcción de `Dockerfile.backend`/`Dockerfile.frontend` con `node:24-alpine` (sin demonio) → `trivy-image`.
- Cada acción bumpeada corriendo en el runner (checkout v5, setup-node v5, upload/download-artifact
  v6/v7, upload-sarif v4, trivy-action v0.36.0, gitleaks-action v3) → todos los workflows del push.
- `format-mix` SKIPPED/ROJO reales → `ci.yml` de este push (tiene `event.before`, así que debe correr).
- Canario de semgrep con las configs del registro → job `semgrep`.
- `dast-release` de verdad → primer push a `production`; y el dispatch `full` sobre `c13f417` (56.4).
- Que el panel de Vercel tenga puesto `vercel-ignore-build.sh` como Ignored Build Step.

### 56.8 · H1 — protección de ramas: nombres exactos y JSON del ruleset (decisión del dueño)

Required checks tras #9 (nombres de job únicos, todos en workflows que corren en `push` y
`pull_request` a cualquier rama): **`ci-ok`** (CI), **`sast-ok`** (Security SAST), **`e2e-ok`** (E2E).
No añadir `deploy-ci-gate` ni nada de `deploy.yml`/`security-dast.yml` (no corren en cada push).

Ruleset (API `POST /repos/jcsainz95-cloud/tcg-vault-mx/rulesets`), una sola regla para `main` y
`production`:
```json
{
  "name": "release-gates",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main", "refs/heads/production"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "ci-ok" },
          { "context": "sast-ok" },
          { "context": "e2e-ok" }
        ]
      }
    }
  ],
  "bypass_actors": []
}
```
**Consecuencia que el dueño tiene que aceptar antes:** con `required_status_checks` en un ruleset,
un `git push` directo a `main`/`production` solo pasa si el **SHA empujado ya tiene esos tres checks
en verde** (p. ej. un fast-forward desde la rama de sesión ya verificada). Un merge commit nuevo o un
push «a pelo» se rechaza hasta que llegue por PR (o se añada un `bypass_actor`). Con el flujo actual
(fusionar la rama a `main` y empujar `production` = mismo árbol) funciona si se hace por
fast-forward; si no, hay que pasar a PR. **No activado por devops.**

### 56.9 · Ronda de correcciones tras los gates (2026-09-11) — F1-1…F1-6, shellcheck, gitleaks histórico, manifiesto

Encargo del orquestador tras QA **APROBADO CON CONDICIONES** y techlead **APROBADO CON DEUDA**. Todo
lo de abajo está **medido en este entorno** (misma caja de herramientas que §56: gitleaks v8.30.1,
actionlint del scratchpad, **shellcheck 0.11.0 y yamllint por `pip --target`**, Node 22; sin demonio
de Docker) salvo lo marcado **NO MEDIDO AQUÍ**. Deuda derivada: `docs/TECH_DEBT.md` bloque
«Devops · 2026-09-11 · gates andamiaje de CI» (DO-D1…DO-D8).

| Hallazgo | Commit | Qué cambió | Medición |
|---|---|---|---|
| **F1-1** (techlead, IMPORTANTE) · el gate DAST de promoción estaba **abierto por construcción**: `report_only: true` ⇒ `dast-gate.py` rc=0 ⇒ `blocking = (outcome == 'failure')` siempre `'false'` ⇒ `promote-*` pasaban siempre | `faccdeb` | `dast-gate.py` publica **siempre** el hecho `blocking=true\|false` (`$GITHUB_OUTPUT` + `--blocking-file`) **antes** de decidir el exit; `--report-only` solo toca el exit. `dast-ephemeral.sh gate` pasa `--blocking-file security/reports/dast-blocking.txt`. `security-dast.yml`: `outputs.blocking = steps.gate.outputs.blocking` (vacío si el candado no corrió); `abrir-issue` también con `blocking == 'true'` en report_only. `deploy.yml`: `promote-*` exigen **`== 'false'`** (fail-closed; `!= 'true'` dejaba pasar el vacío); comentarios corregidos. `check-dast-gate-live.sh` **5-bis**: sucio + `--report-only` ⇒ `0\|true\|blocking=true`; limpio ⇒ `0\|false\|blocking=false`; sucio sin flag ⇒ `1\|true\|blocking=true`. **Caducidad:** `scripts/check-dast-report-only-expiry.sh` (aísla el bloque `dast-release`; verde si no hay `report_only: true` o hoy < **2026-10-06**; rc=9 desde esa fecha; rc=2 sin bloque) + canario (8 casos) + job `dast-report-only-expiry` en `ci.yml`, en `ci-ok` con «skipped no es verde» | canario del candado **3/3** verde; **mutación sobre COPIA** (sin `publicar_bloqueantes`) ⇒ **rojo 3/3**, control verde; canario de caducidad **8/8 en 3/3**; gate real hoy: «vigente hasta 2026-10-06, quedan 25 días», rc=0. actionlint (con shellcheck en PATH) 0 avisos en los 3 workflows; yaml OK (16/11/4 jobs); 11 gates estáticos rc=0. **NO MEDIDO AQUÍ:** `blocking` llegando a `promote-*` en un push real a `production` (DO-D2) |
| **F1-2** (techlead, IMPORTANTE) · `check-candidate-checks.sh` sumaba `skipped` al verde sin motivo | `1778b0a` | `skipped` es una **tercera clasificación**: se imprime aparte, no suma al verde; solo se tolera si el job está en la **lista cerrada** `SKIPPED_ESPERADOS` (9 jobs de `deploy.yml` que se saltan por construcción con el CD apagado, cada uno con motivo; `format-mix` **no** entra: su skipped es «sin base», no medido). Fuera de la lista ⇒ **rc=3**. Resumen imprime «saltados sin motivo / esperados» | medido por API: `d2efe07` (26 check-runs), `c13f4179`, `17ce9a9` ⇒ **0 skipped**, siguen rc=0. Canario: 3 casos nuevos (sin motivo ⇒ 3; de la lista ⇒ 0 y «esperado:»; mezcla ⇒ 3) → **12/12 en 3/3**; mutación sobre COPIA (volver a sumar skipped) ⇒ **rojo 3/3**. **NO MEDIDO AQUÍ:** la lista contra un push real a `production` (DO-D3) |
| **F1-3** (techlead, MENOR) · el canario de format-mix hacía `exit 1` con cara de BL-27 si `npx prettier` fallaba por red | `a48f716` | lee `PRETTIER_VERSION` del comparador; binario local solo si tiene ESA versión; si no, `npx` con timeout; si tampoco ⇒ **rc=2** «NO PUEDE MEDIR». El `\|\| { …; exit 1; }` tras `$(…; echo x)` miraba el rc de `echo`: ahora se comprueba el resultado. `ci.yml` distingue rc=2 («canario sin instrumento», sigue rojo) de rc=1 («no muerde») | **4/4 en 3/3** con el local (v3.9.6); sin prettier (binario apartado, PATH sin node) ⇒ **rc=2** con el mensaje nuevo. Residual DO-D7 (no instala del lockfile) |
| **F1-4** (techlead, MENOR) · `gitleaks.toml` eximía `.github/workflows/*.yml` entero | `eb0c528` | **exención retirada**; comentario in situ con la medición y el puntero al control compensatorio (`check-secret-defaults.sh` bloque B) | con y sin la línea, `gitleaks dir .` (32) y `gitleaks git .` historial completo (5): **conjuntos idénticos, 0 en workflows**. Canario 11/11 (3/3) |
| **F1-6** (techlead, MENOR) · filtro literal `Node.js 20 is deprecated` caducado | `1778b0a` | `/Node\.js \d+ .*deprecated/i` | (mismo canario) |
| **shellcheck** (QA) · SC1087 `check-secret-defaults.sh:537`, SC2164 en `check-provenance-gate.sh:48`, `check-secret-defaults.sh:81`, `gen-published-secrets-manifest.sh:52` | `087e0aa` | `${vname}[:=]`; `cd … \|\| exit N`. Solo cambia si el `cd` falla | shellcheck 0.11.0 limpio; canarios `check-secret-defaults-canary` **66/66** y `check-provenance-gate-canary` **9/9**, ambos **3/3**; gates rc=0 |
| **shellcheck dentro de actionlint** (hallazgo propio) · «0 avisos» de §56 se midió sin shellcheck en el PATH de actionlint; con él, `d2efe07` tenía 3 avisos en `ci.yml` y 2 en `security-sast.yml` | `faccdeb` (ci.yml), `security-sast.yml` en el commit de docs de esta ronda | `"origin/main^{commit}"`, backticks → comillas simples; `# shellcheck disable=SC2086` con motivo (`$SG_CONFIGS` se parte a propósito) | `actionlint -no-color .github/workflows/*.yml` con shellcheck en PATH ⇒ **rc=0 en los 7**; yaml OK ×7 |
| **§56.1 «8 sitios»** (QA) | (este commit) | son 9 líneas: `format-mix-base` ganó un `setup-node` en #5 | `grep -c node-version` = 9 |
| **Gitleaks histórico de `backend/`** (orquestador) · backend los neutralizó en el árbol (`a454178`); en modo `git` seguían en `fbb66e1`, `46d76cc`, `e504466` | `12c2fe9` | eximidos **por valor exacto**: `^A-Strong-Secret-123$`, `^asB64\.length$` (global) y `POKEMONPRICETRACKER_API_KEY: 'SUPER-SECRETO-123'` en `[rules.allowlist]` de `generic-api-key-assignment` con `regexTarget = "match"` (esa regla expone el NOMBRE como secreto, la allowlist global no puede eximirla por valor) | `gitleaks git .` ⇒ **0, rc=0**; estrechez: mismo literal en `POKETRACE_API_KEY` ⇒ rojo, otro valor ⇒ rojo; canario 11/11 (3/3). `dir .`: 44 hallazgos, **todos en no versionados** (`.native-stack/`, `frontend/.next*`), 0 versionados (DO-D6) |
| **Manifiesto** (orquestador/backend) · `gen-published-secrets-manifest.sh --check` rc=1 por `frontend/e2e/utils/env.ts:63/68` (`E2E_TEMP_CUSTOMER_PASSWORD` / `E2E_TEMP_OPERATOR_PASSWORD ?? 'Temporal123!'`, hash `cdf12b93…`); dejaba `check-secret-defaults.sh` en rc=1 (también con la versión `d2efe07` del script: no lo causó esta ronda) | commit de cierre de la ronda | manifiesto regenerado y commiteado al final | `--check` rc=0 y `check-secret-defaults.sh` rc=0 tras regenerar. Es el caso vivo de **DO-D1** |

**Mini-ronda de cierre (mismo día, tras aprobar QA y techlead sobre `ba5fd4b`):**

| Hallazgo | Commit | Qué cambió | Medición |
|---|---|---|---|
| **F1-5** (techlead) · `engines` ausente en los dos `package.json` (§56.1 lo había medido: 0 coincidencias) | backend `1a2d394` (`engines.node >=22`, `@types/node` ^24; backend lo subirá a `>=24`), frontend `09bdf43` (`>=24`) | no es de devops; se cita aquí porque §56.9 no lo listaba (N9) | `grep -n '"engines"' backend/package.json frontend/package.json` ⇒ `>=22` / `>=24` |
| **N3** (MEDIA) · `ci-ok` con ocho bloques y dos criterios: un gate nuevo en `needs` sin bloque quedaba skipped = verde | `7007342` | `scripts/check-ci-ok.sh` lee `toJSON(needs)`: **todo exige `success`** salvo OPCIONALES declarados con motivo (backend, frontend, format-mix-base, format-mix: pueden estar skipped, nunca failure). Estática en cada run: todo job de `ci.yml` está en el `needs` de `ci-ok` y OPCIONALES no está desfasada. `ci-ok` = checkout + script + canario | canario `check-ci-ok-canary.sh` **10/10 en 3/3** (incluye «job DESCONOCIDO skipped ⇒ rojo» y «job fuera del needs ⇒ estática roja»); mutación sobre COPIA (quitar un job del needs) ⇒ rc=1 3/3; actionlint 0 ×7; yaml OK (17 jobs) |
| **N4** · `SKIPPED_ESPERADOS` podía desfasarse en silencio | `017e5f8` | cada clave tiene que ser `^  <job>:$` en `deploy.yml`; si no (o sin fichero) ⇒ rc=2 «lista desfasada». Ámbito por workflow **no** (la API de check-runs no trae el workflow sin otra llamada por `check_suite`; DO-D9) | canario **14/14 en 3/3** (casos 13-14 nuevos); `d2efe07` sigue rc=0 |
| **N5** · el comentario decía «el título lleva la rama» y el título era un literal | `b66b3f9` | `TITLE` = «[dast] Hallazgos bloqueantes en el stack efímero — `inputs.ref` (dispatch) \| `github.ref_name`»; el cuerpo cita el evento | actionlint 0; yaml OK. **NO MEDIDO AQUÍ:** el título rendido en un run real |
| **N7** (parte devops) · censo de `mockOnly\|needsSeed\|harnessLimit\|skipIfSeedMissing` en `frontend/e2e/` | `a171a97` (script + baseline + canario), cableado en `7007342` (job `e2e-skip-census`, en `needs` de `ci-ok`) | método fijado: `grep -rwo` por palabra completa + ficheros, `frontend/e2e/**/*.ts`. **Baseline 2026-09-11:** mockOnly **78/17**, needsSeed **30/7**, harnessLimit **4/2**, skipIfSeedMissing **8/3** (120 en 20 ficheros; el **71/18** del techlead es otro método — este script fija el método). Crece ⇒ rc=1 con el comando `--update --motivo "…"` (motivo obligatorio); baja ⇒ verde con aviso | gate rc=0; canario sobre COPIA (+1 `mockOnly` ⇒ rojo; -1 ⇒ verde; sin baseline ⇒ 2; `--update` sin motivo ⇒ 2) **5/5 en 3/3** |

| **PII en el arnés nativo** (backend) · `stack-native.sh` no generaba `PII_ENCRYPTION_KEY`/`PII_HMAC_KEY` ⇒ clave efímera por proceso ⇒ cada reinicio invalidaba la PII local (500 en billing-profile/KYC) | commit «stack-native · PII» (tras `5df5575`) | ambas claves en la misma llamada `env-file` que las JWT (persistidas, aleatorias por máquina) + `export`; `secrets-preflight.sh` genera `*HMAC_KEY` en base64 de 32 bytes; `check-e2e-harness-gaps.sh` **#7** (estático + genera en temporal y exige 32 bytes) | harness-gaps rc=0 3/3; idempotencia sobre `secrets.env` previo (añade sin rotar); mutación sobre COPIA ⇒ rojo 3/3. **NO MEDIDO AQUÍ:** `stack-native.sh up` real (sin Postgres/Redis en este entorno); en máquinas con `secrets.env` previo, la PII cifrada ANTES de este cambio con clave efímera sigue siendo ilegible (borrar esas filas o `down -v`) |

**Corrección del canario del censo (DO-D10, el mismo día, medida en CI):** el primer canario de N7
copiaba `frontend/e2e` y la comparaba contra el **baseline commiteado**. Run **34624748863** (job
`e2e-skip-census`, `18f2b01`): frontend añadió tres specs de Stream B, el baseline quedó corto y el
canario cayó a **3/5** —«copia intacta = baseline» y «-1 needsSeed ⇒ verde»— arrastrando a `ci-ok`.
**Una sola causa apagaba dos señales**, y el rojo no distinguía «el instrumento está roto» de «el
número subió». Arreglado en `cc59a6a`: el canario usa un árbol **sintético** propio con conteos
conocidos y un baseline que fabrica él; del vivo solo comprueba la **estructura** (4 claves bien
formadas), nunca sus números. **La medición que lo demuestra:** con el baseline vivo TODAVÍA
desfasado, canario **13/13 en 3/3** y gate **rc=1** a la vez. Mutaciones sobre COPIA: el gate que
nunca detecta crecimiento ⇒ 10/13 rojo 3/3; el conteo sin `-w` ⇒ 12/13 rojo 3/3; control ⇒ rc=0.
Baseline regenerado con motivo en `0ed2180`: **mockOnly 78→85 en 17→20 ficheros** (checkout-retry 3,
orders-resume 2, m5-transitions 2); las otras tres claves sin cambio. **Lección para el resto de
canarios de este repo:** un canario que se mide contra un número que otro rol mueve no está midiendo
el instrumento — está repitiendo el gate.

**Deuda que queda (con comprobación de cierre en TECH_DEBT):** DO-D9 (N4: ámbito por workflow), DO-D10
(N7: el baseline lo escribe devops y el número es de frontend), DO-D1 (mini-linter + acoplamiento del
manifiesto; F1-7), DO-D2 (F1-1 residual: push real a `production`), DO-D3 (F1-2 residual: lista contra
un push real), DO-D4 (`report_only` hasta que seguridad lo suba; fecha 2026-10-06), DO-D5 (H1, dueño),
DO-D6 (cerrado; residual de `dir` en artefactos locales), DO-D7 (F1-3 residual: prettier por `npx`),
DO-D8 (cerrado; cómo medir «actionlint 0 avisos»).

**Nota sobre la referencia «BE-77» del encargo:** en `TECH_DEBT.md` BE-77 es `BulkPriceRow` /
`sync-all` (backend), no gitleaks; el hallazgo histórico de gitleaks se cita aquí por §56.3 y `a454178`.

---

## 57. `SB-D2` — el candado del defecto de dinero dependía del tamaño de máquina que GitHub diera ese día (2026-09-11, COND-2 del techlead, bloqueante de Stream B)

**El hallazgo (techlead, medido):** `398c58a` corrigió un **500 en la ruta de dinero** —el checkout
pedía DOS conexiones por petición (la que retiene la `tx` + otra para `PricingService.getReference`),
así que con N checkouts concurrentes ≥ pool/2 el pool se agotaba y la petición moría con `Timed out
fetching a new connection`—. Quien hace VISIBLE esa regresión es el **tamaño del pool**: con 5, la
carrera R-3 pasó de **0/10 a 10/10** al corregirlo y la mutación `m-pool` sale roja **3/3**
(`docs/BACKEND_NOTES.md` §B-1f). El problema es que **ese 5 no estaba escrito en ningún sitio**: ni
`.github/workflows/ci.yml:94` ni `.github/workflows/e2e.yml:155` fijaban `connection_limit`, así que
era el **default de Prisma** (`num_cpus*2+1`) sobre el runner del día. Dos consecuencias, las dos
silenciosas:

- **(a) se afloja solo.** Si GitHub cambia el runner (4 vCPU ⇒ 9 conexiones), el candado pierde
  sensibilidad **sin que nadie toque una línea ni vea un diff**.
- **(b) no se reproduce en local.** `scripts/stack-native.sh` tampoco lo fijaba —lo dice el propio
  `398c58a`: «el stack nativo no lo tiene; CI sí»—, así que el siguiente que reintroduzca la regresión
  la ve **verde en su máquina** y roja en CI, sin saber por qué.

Un candado cuya sensibilidad depende del hardware que te toque no es un candado: es una probabilidad
que nadie declara.

### 57.1 · Lo que se fijó (commit `4a8a9b7`)

| Sitio | Antes | Ahora |
|---|---|---|
| `.github/workflows/ci.yml` · job `backend` | `…/tcg_ci?schema=public` | `…?schema=public&connection_limit=5&pool_timeout=10` |
| `.github/workflows/e2e.yml` · job `backend-e2e` | `…/tcg_e2e?schema=public` | `…?schema=public&connection_limit=5&pool_timeout=10` |
| `scripts/stack-native.sh` · `test:integration` | nada (heredaba el pool grande de la Postgres local) | `NATIVE_TEST_CONNECTION_LIMIT=5` / `NATIVE_TEST_POOL_TIMEOUT=10` por defecto, aplicados a `DATABASE_URL` |

Los tres llevan **escrito al lado por qué ese número**: qué vigila el 5, qué pasa si alguien lo sube
(con pool grande sobran conexiones para la segunda pedida ⇒ **R-3 sale verde con el defecto dentro**)
y por qué `pool_timeout` es la otra mitad (subirlo convierte el agotamiento en **espera**: el 500 se
vuelve lentitud y tampoco se ve).

En el arnés nativo el pool se aplica con una función nueva, `with_pool_params`, que **sustituye** los
valores previos en vez de duplicarlos y **no parsea usuario ni contraseña** (opera solo sobre lo que
va detrás del `?`, así que una contraseña con `@`, `:` o `/` no la afecta). La escotilla es explícita
y ruidosa: `NATIVE_TEST_CONNECTION_LIMIT=20 ./scripts/stack-native.sh test:integration` corre, pero
avisa por pantalla de que **esa corrida no sirve como gate**.

### 57.2 · El candado que lo vigila, y su canario

- **`scripts/check-db-pool-limit.sh`** (job `db-pool-limit` de `ci.yml`, en el `needs` de `ci-ok`):
  (1) todo `DATABASE_URL` de los workflows que apunte a una BD **local/de servicio** lleva
  `connection_limit` ≤ 5 y `pool_timeout` ≤ 10, los dos explícitos; (2) los **dos anclajes**
  (`ci.yml`/`backend`, `e2e.yml`/`backend-e2e`) siguen existiendo y pinchados —renombrar el job pone
  rojo **a propósito**, para que el cambio sea consciente—; (3) el arnés nativo fija el mismo pool por
  defecto **y lo aplica** (declararlo sin aplicarlo es el peor caso: *parece* que está); (4) y
  **ejecuta** `with_pool_params` en vez de solo leerla. Techo y no igualdad: **bajar** el pool aprieta
  el candado, subirlo lo afloja; se prohíbe aflojar.
  - Límites dichos: es estático sobre el YAML; **no mira `docker-compose*.yml`** (ahí la URL es la de
    la APP corriendo, no la del arnés que mide R-3 — si algún día la integración corre contra compose,
    hay que ampliarlo); un `DATABASE_URL` **remoto** se declara «no evaluada», nunca verde fingido; sin
    URLs evaluables sale **rc=2**, no 0.
- **`scripts/check-db-pool-limit-canary.sh`**: 11 casos sobre **copia** del árbol, incluida la
  mutación **literal** de SB-D2 (devolver `ci.yml` al estado de `7766296`, sin `connection_limit`),
  subirlo a 20, `pool_timeout=60`, el arnés con default 50, el arnés que lo declara y no lo aplica,
  `with_pool_params` rota, el anclaje renombrado — y los **verdes que deben seguir verdes**
  (apretarlo a 3/5 se permite; una URL remota se declara sin juzgarla; sin workflows, rc=2).

### 57.3 · Mediciones (2026-09-11, este entorno)

| Qué | Resultado |
|---|---|
| `./scripts/check-db-pool-limit.sh` | **rc=0** (2 URLs de CI + los 4 asertos del arnés) |
| `./scripts/check-db-pool-limit-canary.sh` | **11/11, proporción 3/3** |
| Mutación independiente sobre COPIA, *no* cubierta por el canario: mover `DATABASE_URL` a un `env:` de **paso** sin el pin | **rc=1**, y el rojo nombra `job backend · paso 2` |
| `actionlint` **con shellcheck en el PATH** sobre los 7 workflows | **0 avisos** |
| `yaml.safe_load` de `ci.yml` y `e2e.yml` | OK; las dos URLs se leen con el pin |
| `shellcheck` de los dos scripts nuevos | **0** |
| `shellcheck -x scripts/stack-native.sh` | **sin avisos nuevos**: los mismos 6 preexistentes (diff vacío contra la versión de `7766296`) |
| `check-ci-ok.sh --static` | rc=0 — 18 jobs, 17 en `needs`, `db-pool-limit` incluido |
| Canarios vecinos afectados (`ci-ok`, `workflow-cwd`, `secret-defaults`) | rc=0 en **3/3** cada uno (el de `secret-defaults` tarda ~7 min por tirada) |
| `check-secret-defaults.sh` | rc=0 — **mordió primero**: los fixtures de mis dos scripts llevaban `postgresql://u:p@…` y el gate de S-88-1 los marcó como «URL con credencial escrita dentro» (3 líneas). Reescritos sin credencial (`postgresql://sin_credencial@…`) |
| Los demás gates estáticos (`workflow-cwd`, `e2e-harness-gaps`, `provenance-gate`, `dast-gate-live`, `daemon-stdout-leak`, `stripe-webhook-failclosed`, `e2e-skip-census`, `e2e-provider-incapacitation`, `dast-report-only-expiry`) | rc=0 |

**NO MEDIDO AQUÍ:** que la suite de integración siga **verde en CI** con el pool fijado. En este
entorno no hay Postgres levantado, así que la carrera R-3 no se puede correr; lo mide el empuje (job
`backend-e2e` de `e2e.yml`). Queda fichado como **DO-D11** con su comprobación de cierre.

### 57.4 · Lo que vi en el primer `dast-release` sobre un push real (run `34633179107`) y que es de mis rutas

Medido con la API pública (`/actions/runs/34633179107/jobs`), push a `production`, `c8bee65`,
conclusión **success**:

- `secrets-gate` **success**, `dast-release / Resolver el ref` **success**, `dast-release / Autoprueba
  del candado (canario vulnerable)` **success**, `dast-release / DAST contra el stack efímero`
  **success**, `dast-release / Abrir/actualizar issue` **skipped**. O sea: **el DAST corrió de verdad
  en un push real y no encontró bloqueante** — es la primera vez, y es la mitad buena.
- Pero `deploy-ci-gate`, `preflight`, `e2e-real`, `deploy-staging-*`, `staging-serves-head`,
  `staging-provider-parity`, `promote-production-backend` y `promote-production-frontend` salieron
  **skipped**, y el run igualmente **verde**. La causa se deduce del propio YAML, sin necesidad de
  logs: `deploy-ci-gate` tiene `if: needs.secrets-gate.outputs.ready == 'true'` y `secrets-gate`
  terminó en success ⇒ `ready` valía `false`, que es lo que ese job emite cuando faltan los cinco
  secrets de CD (`RAILWAY_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
  `PROD_BASE_URL`). Todo lo demás cuelga de ahí por `needs`.
- **No es un fallo nuevo y no lo toco:** está declarado así desde `§11.D` («los deploys reales van por
  integraciones nativas Vercel/Railway; este CD por Actions queda SALTADO»). Lo que sí cambia es una
  consecuencia que no estaba dicha: **la comprobación de cierre de DO-D2 no se puede cumplir en un
  push real mientras esos cinco secrets no existan**, porque `promote-production-*` nunca llega a
  evaluar `needs.dast-release.outputs.blocking`. Anotado en la ficha.

### 57.5 · El techo del censo E2E sube a lo que hay (commit `7f9527e`), y qué opino del método de conteo

**Qué se hizo:** `scripts/e2e-skip-census.baseline` regenerado con `--update --motivo` sobre
**`8d79c61`**, con el motivo de **frontend** verbatim (dueño del motivo: frontend; del baseline:
devops — lo dice el propio mensaje de rojo del gate). Nuevo techo: `mockOnly 92 22`, `needsSeed 31 8`,
`harnessLimit 4 2`, `skipIfSeedMissing 15 6`.

Sobre `8d79c61` **a propósito**: sobre el commit anterior habría salido `skipIfSeedMissing 16 6` —una
marca por encima de lo que existe— y esa holgura es exactamente lo que este candado existe para
impedir.

| Medición (2026-09-11, este entorno) | Resultado |
|---|---|
| Censo antes de regenerar, medido por mí con el método del script | `mockOnly 92/22` · `needsSeed 31/8` · `harnessLimit 4/2` · `skipIfSeedMissing 15/6` (coincide con lo predicho por frontend y con lo medido por el orquestador) |
| `./scripts/check-e2e-skip-census.sh` tras el `--update` | **rc=0 en 3/3** |
| `./scripts/check-e2e-skip-census-canary.sh` | **13/13 en 3/3** |
| Mutación independiente sobre COPIA de `frontend/e2e` (+1 ocurrencia de `mockOnly`) contra el baseline **nuevo** | **rc=1 en 3/3** (`92 → 93`); control con la copia intacta ⇒ **rc=0** |

**El método (decisión de devops, no petición de frontend).** Frontend observa —y tiene razón— que
`grep -rwo` cuenta **palabras**, no marcas: de sus +15 ocurrencias solo **5** son llamadas. Lo medí por
forma sintáctica, y el desfase es grande y estable:

| Clave | Ocurrencias (lo que gatea hoy) | Sitios de llamada (`X(`) | Resto (importaciones, JSDoc, listas) |
|---|---|---|---|
| `mockOnly` | 92 | **54** | 38 |
| `needsSeed` | 31 | **10** | 21 |
| `harnessLimit` | 4 | **1** | 3 |
| `skipIfSeedMissing` | 15 | **4** | 11 |

**Mi criterio: el método actual se queda, y el rótulo está mal.** Lo que este número vale es que **no
se puede contorsionar**: una sola orden, sin AST, sin parsear TypeScript, sin depender del formato, y
nadie puede bajarlo moviendo una llamada a un helper o a una condición. Un censo «de tests que no
miden» necesitaría o el compilador de TS (dependencia nueva en un script de devops, justo lo que
`DO-D1` ya señala como deuda) o correr Playwright con un reporter —caro, y **se le escapa** lo
dinámico—. O sea: el conteo preciso sería **más exacto y más fácil de esquivar**; el actual es
impreciso y honesto.

Lo que sí está mal es llamarlo «censo de salvaguardas»: no lo es. Es un **detector de huella textual**
—«la palabra que marca un test que no mide aparece más veces que ayer»—, y leerlo como «hay 92 tests
que no miden» es falso. El riesgo de dejarlo así **no es el número, es el hábito**: un rojo que casi
siempre se explica con «10 de esas son prosa» enseña al equipo a firmar el `--update` sin leerlo, y
entonces el candado deja de decir nada (es el defecto de §56, del revés).

**Propuesta, con su costo, para OTRO pase (hoy no se toca: primero se desbloquea la fusión):** añadir
una **segunda línea informativa** por clave con los sitios de llamada
(`grep -rhoE '\bX[[:space:]]*\('`, menos la definición), dejando el **gate** donde está —sobre la
huella textual, que es la que no se puede engañar—. Así el rojo diría «`mockOnly` 92→93 en huella,
llamadas 54→54: es prosa» o «llamadas 54→55: es una marca nueva», y el motivo lo escribiría solo.
Costo medido a ojo sobre el script actual (78 líneas): ~15 líneas más, 4 filas más en el baseline y
2-3 casos más en el canario. Dueño: devops. **No lo decido solo:** el que paga el rojo es frontend, y
la lectura del número la usa el techlead.

#!/usr/bin/env bash
# =============================================================================
# scripts/stack-native.sh — Stack REAL sin Docker (ruta NATIVA)  ·  Propiedad: devops
# TCG Vault MX — Marketplace TCG con Bóveda (Pokémon, México)
# =============================================================================
# POR QUÉ EXISTE (cierre de la brecha de E2E reportada por QA, DEVOPS_NOTES §29.10):
#   La suite Playwright «80/80 en verde» corre contra MOCKS: sin `E2E_BASE_URL`,
#   `frontend/playwright.config.ts` levanta `npm run dev` con `NEXT_PUBLIC_USE_MOCKS=true`.
#   Eso demuestra «la UI es consistente con sus propias simulaciones», NO «frontend y
#   backend concuerdan». La ruta que cierra esa brecha es `e2e-real.yml` /
#   `docker-compose.staging.yml` — pero **en este entorno de trabajo NO hay demonio de
#   Docker** (`/var/run/docker.sock` no existe), así que la ruta documentada en §5.1 no
#   se puede ejecutar aquí. Este script es la ALTERNATIVA SOPORTADA: levanta el mismo
#   stack con los binarios nativos de la máquina.
#
#   Verificado por dos agentes en este entorno y por devops:
#     · QA         → `pg_ctlcluster 16 main start` + `redis-server --daemonize yes` +
#                    `prisma migrate deploy`  ⇒ 126/127 de integración.
#     · pentester  → stack Nest COMPLETO con `ts-node src/main.ts` en :3099 (guards y
#                    pipes activos, no un arnés recortado).
#     · devops     → arranque en :3099 con `GET /api/v1/health` → 200 (`db:up`,`redis:up`).
#
# EQUIVALENCIA CON LA RUTA DOCKER (qué SÍ y qué NO reproduce):
#   SÍ  · Postgres 16 real + Redis 7 real + backend NestJS completo (todos los guards,
#         pipes, interceptores y el scheduler BullMQ) + frontend Next con mocks=false.
#   NO  · MinIO/R2 (subida del INE del buylist). Si el flujo bajo prueba toca `uploads`,
#         usa la ruta Docker o levanta MinIO aparte. Se avisa al final.
#   NO  · La IMAGEN de producción (`Dockerfile.backend`). Aquí corre `ts-node` sobre el
#         fuente: se prueba el CÓDIGO, no el artefacto. El gate del artefacto sigue
#         siendo `e2e-real.yml` en CI, que sí usa la imagen.
#   NO  · Egress a internet. `pokemontcg.io` / `tcgcsv.com` devuelven 403 desde aquí; el
#         `price-ingest` de arranque lo registra y deja los precios STALE (money-safe:
#         no borra, no escribe $0). Es ESPERADO, no un fallo del stack.
#
# USO:
#   ./scripts/stack-native.sh up          # infra + migraciones + backend + frontend
#   ./scripts/stack-native.sh up --infra  # solo Postgres + Redis + migraciones
#   ./scripts/stack-native.sh up --seed   # + `npm run seed:synthetic` (datos E2E)
#   ./scripts/stack-native.sh up --gate   # frontend con `next build` + `next start`
#                                         #   ⇒ el ÚNICO modo válido para una corrida de GATE
#   ./scripts/stack-native.sh status      # qué está arriba y en qué puerto
#   ./scripts/stack-native.sh down        # apaga backend y frontend (deja PG/Redis)
#   ./scripts/stack-native.sh down --all  # + para Postgres y Redis
#
# QUIÉN LO CORRE: **QA** (ejecuta la suite) y cualquier rol que necesite el stack vivo.
#   devops CABLEA el camino; NO ejecuta la suite E2E (CLAUDE.md: las suites las escriben
#   frontend/backend y las corre QA).
#
# VARIABLES (todas con default; ninguna es un secreto real):
#   BACKEND_PORT   3099   — puerto del backend nativo (evita chocar con el 3001 del compose)
#   FRONTEND_PORT  3000   — DEBE estar en la allow-list CORS de APP_BASE_URL
#   FRONTEND_MODE  dev    — `dev` (next dev, cómodo, NO apto para gates) | `build`
#                           (next build + next start). `up --gate` fija `build`.
#                           PARA GATES: SIEMPRE `build`. Ver DEVOPS_NOTES §32.6.
#                           El NODE_ENV del frontend lo fija el modo (build→production),
#                           NO se hereda el `development` del backend. Ver §32.10.
#   PG_CLUSTER     16/main
#   DATABASE_URL   postgresql://tcg:tcg_local_dev_password@localhost:5432/tcg_marketplace
#                  (credenciales de DESARROLLO LOCAL, las mismas de `.env.example`; jamás
#                   se pone aquí un secreto real — ver DEVOPS_NOTES §11)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
RUN_DIR="$ROOT_DIR/.native-stack"

BACKEND_PORT="${BACKEND_PORT:-3099}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
# `dev` (next dev) | `build` (next build + next start). `up --gate` lo fija en `build`.
# Un GATE NUNCA corre sobre `next dev`: compila bajo demanda, se degrada tras varias
# recompilaciones y no es el artefacto que se despliega. Ver DEVOPS_NOTES §32.6.
FRONTEND_MODE="${FRONTEND_MODE:-dev}"
case "$FRONTEND_MODE" in dev|build) ;; *) echo "FRONTEND_MODE debe ser 'dev' o 'build' (recibí '$FRONTEND_MODE')" >&2; exit 1 ;; esac
PG_CLUSTER="${PG_CLUSTER:-16/main}"
PG_VER="${PG_CLUSTER%%/*}"
PG_NAME="${PG_CLUSTER##*/}"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ⚠ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# --- psql como el superusuario `postgres`, SIN interpolar valores en el SQL ---
#   uso:   psql_as_postgres <user> <pass> <db> <<'SQL'
#            SELECT … :'u' … :"n" …
#          SQL
#   El SQL entra por STDIN (`-f -`) desde un heredoc CITADO: el shell no lo toca.
#   Los tres valores llegan por ARGV y psql los expone como variables `u`, `p`, `n`,
#   citándolos él mismo (`:'x'` literal · `:"x"` identificador). Cero SQL construido
#   por concatenación de shell.
#   El `--` NO es decorativo: sin él, `su` (util-linux 2.39) parsea como opción suya
#   cualquier valor que empiece con `-` y aborta con «invalid option».
#   El `_` ocupa el `$0` del shell interno; los valores quedan en $1/$2/$3.
psql_as_postgres() {
  su postgres -s /bin/sh -c \
    'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -v u="$1" -v p="$2" -v n="$3" -f -' \
    -- _ "$1" "$2" "$3"
}

# --- Env de DESARROLLO LOCAL -------------------------------------------------
# NODE_ENV=development es deliberado y es **DEL BACKEND**: `backend/src/config/
# env.validation.ts` exige DATABASE_URL/JWT/STRIPE/APP_BASE_URL/RESEND solo en entornos
# NO-locales. En local degrada seguro (mail → NoopMailAdapter). NUNCA uses este bloque
# para staging/prod.
#
# OJO — `export` alcanza a TODO hijo, incluido `next build`, y ahí NO es inocuo: rompe
# el prerender de las páginas de error y mata el build (BLOQ-1 de QA · §32.10). Por eso
# `start_frontend()` FIJA su propio NODE_ENV por modo (build→production, dev→development)
# en vez de heredar éste. Si tocas esta línea, no deshagas aquella.
export NODE_ENV="${NODE_ENV:-development}"
export PORT="$BACKEND_PORT"
export DATABASE_URL="${DATABASE_URL:-postgresql://tcg:tcg_local_dev_password@localhost:5432/tcg_marketplace?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export APP_BASE_URL="${APP_BASE_URL:-http://localhost:$FRONTEND_PORT}"
# CTA de los correos del buylist (v1.51). MISMA URL que APP_BASE_URL, leída con otro nombre por
# `buylist.service.ts`. ACTIVA desde 2026-09-01: la pantalla `/{locale}/buylist/requests/<id>` ya
# existe y se midió viva (DEVOPS_NOTES §33.4-bis). Espeja a APP_BASE_URL para que no puedan
# divergir. Para volver al degrade (botón -> instrucción de texto): APP_PUBLIC_URL= ./scripts/...
export APP_PUBLIC_URL="${APP_PUBLIC_URL:-http://localhost:$FRONTEND_PORT}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-local_dev_only_access_secret_at_least_32_chars_long}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-local_dev_only_refresh_secret_at_least_32_chars_different}"

mkdir -p "$RUN_DIR"

# -----------------------------------------------------------------------------
# Infra: Postgres + Redis (tolerante a que ya estén arriba)
# -----------------------------------------------------------------------------
start_infra() {
  log "Postgres ($PG_CLUSTER)"
  if pg_isready -q 2>/dev/null; then
    ok "ya estaba aceptando conexiones."
  else
    pg_ctlcluster "$PG_VER" "$PG_NAME" start || die "No pude arrancar el cluster $PG_CLUSTER."
    for i in $(seq 1 30); do pg_isready -q 2>/dev/null && break; sleep 1; done
    pg_isready -q 2>/dev/null || die "Postgres no respondió tras 30s."
    ok "arriba."
  fi

  log "Redis"
  if redis-cli ping >/dev/null 2>&1; then
    ok "ya respondía PONG."
  else
    redis-server --daemonize yes || die "No pude arrancar redis-server."
    for i in $(seq 1 20); do redis-cli ping >/dev/null 2>&1 && break; sleep 1; done
    redis-cli ping >/dev/null 2>&1 || die "Redis no respondió tras 20s."
    ok "arriba."
  fi

  # ---------------------------------------------------------------------------
  # Rol + base. Idempotente: si ya existen, no toca nada (NO borra datos).
  #
  # POR QUÉ ESTÁ ESCRITO ASÍ (MENOR-2 de QA · DEVOPS_NOTES §30.2):
  #   La versión previa interpolaba `$db_user`/`$db_pass` —sacados de DATABASE_URL con
  #   `sed`— dentro de un literal SQL que a su vez viajaba dentro de `su postgres -c "…"`.
  #   Eso son DOS reparsings encadenados (shell interno → SQL): una contraseña con `'`,
  #   `"`, `;`, `$` o backtick rompía el arranque o INYECTABA SQL como superusuario.
  #   Que hoy sea una credencial fija de desarrollo no lo vuelve seguro: lo vuelve
  #   seguro POR SUERTE, y `DATABASE_URL` es una variable de entorno.
  #   Aquí NO se interpola nada en el SQL:
  #     · el SQL es un heredoc CITADO (<<'SQL') que entra por STDIN ⇒ sin expansión;
  #     · los valores viajan como ARGV hasta `psql -v`, y es psql quien los cita:
  #         :'u' / :'p' / :'n'  → literal de cadena escapado
  #         :"u" / :"n"         → identificador escapado
  #   Verificado con la carga `it's; DROP DATABASE tcg_marketplace; --`: psql la
  #   devuelve como DATO, no como sintaxis.
  # ---------------------------------------------------------------------------
  log "Rol y base de datos (idempotente, NO destructivo)"
  local db_user db_pass db_name role_n db_n
  db_user="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^:]+):.*#\1#')"
  db_pass="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://[^:]+:([^@]+)@.*#\1#')"
  db_name="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
  # `sed` sin match devuelve la cadena ENTERA. Sin esta guarda, un DATABASE_URL con
  # otra forma seguiría de largo y crearía un rol/base con nombre basura.
  case "$db_user" in ''|*[!A-Za-z0-9_]*) die "DATABASE_URL: usuario '$db_user' no parsea (se espera [A-Za-z0-9_]+)." ;; esac
  case "$db_name" in ''|*[!A-Za-z0-9_]*) die "DATABASE_URL: base '$db_name' no parsea (se espera [A-Za-z0-9_]+)." ;; esac
  [ -n "$db_pass" ] || die "DATABASE_URL: no pude extraer la contraseña."

  role_n="$(psql_as_postgres "$db_user" "$db_pass" "$db_name" <<'SQL'
SELECT count(*) FROM pg_roles WHERE rolname = :'u';
SQL
  )" || die "psql no respondió al comprobar el rol (¿Postgres arriba?)."
  if [ "$role_n" != "0" ]; then
    ok "rol '$db_user' ya existe."
  else
    psql_as_postgres "$db_user" "$db_pass" "$db_name" >/dev/null <<'SQL'
CREATE ROLE :"u" LOGIN PASSWORD :'p';
SQL
    ok "rol '$db_user' creado."
  fi

  db_n="$(psql_as_postgres "$db_user" "$db_pass" "$db_name" <<'SQL'
SELECT count(*) FROM pg_database WHERE datname = :'n';
SQL
  )" || die "psql no respondió al comprobar la base (¿Postgres arriba?)."
  if [ "$db_n" != "0" ]; then
    ok "base '$db_name' ya existe (datos intactos)."
  else
    psql_as_postgres "$db_user" "$db_pass" "$db_name" >/dev/null <<'SQL'
CREATE DATABASE :"n" OWNER :"u";
SQL
    ok "base '$db_name' creada."
  fi

  log "prisma migrate deploy (idempotente)"
  ( cd "$BACKEND_DIR" && npx prisma migrate deploy )
  ok "Migraciones al día (incluida M-41)."
}

# -----------------------------------------------------------------------------
# Backend nativo: el stack Nest COMPLETO por ts-node (no un arnés recortado)
# -----------------------------------------------------------------------------
start_backend() {
  log "Backend NestJS nativo (ts-node) en :$BACKEND_PORT"
  if curl -sf -m 3 "http://localhost:$BACKEND_PORT/api/v1/health" >/dev/null 2>&1; then
    ok "ya respondía en :$BACKEND_PORT."
    return 0
  fi
  [ -d "$BACKEND_DIR/node_modules" ] || die "Falta $BACKEND_DIR/node_modules. Corre: cd backend && npm ci"
  ( cd "$BACKEND_DIR" && nohup npx ts-node --transpile-only src/main.ts \
      > "$RUN_DIR/backend.log" 2>&1 & echo $! > "$RUN_DIR/backend.pid" )
  # El arranque compila TS en caliente: dale margen (observado ~45-60s en frío).
  for i in $(seq 1 60); do
    curl -sf -m 3 "http://localhost:$BACKEND_PORT/api/v1/health" >/dev/null 2>&1 && break
    kill -0 "$(cat "$RUN_DIR/backend.pid")" 2>/dev/null || {
      tail -40 "$RUN_DIR/backend.log"; die "El backend murió al arrancar. Log: $RUN_DIR/backend.log
     Si es un error de código y no de entorno, el hallazgo es del rol BACKEND (devops no lo corrige)."; }
    sleep 3
  done
  curl -sf -m 3 "http://localhost:$BACKEND_PORT/api/v1/health" >/dev/null 2>&1 \
    || { tail -40 "$RUN_DIR/backend.log"; die "Sin salud tras ~3min. Log: $RUN_DIR/backend.log"; }
  ok "salud: $(curl -sS -m 5 "http://localhost:$BACKEND_PORT/api/v1/health")"
  warn "Al arrancar, el catch-up de \`price-ingest\` intenta salir a pokemontcg.io y aquí da 403."
  warn "Es ESPERADO sin egress y es money-safe: deja los precios STALE, no borra ni escribe \$0."
}

# -----------------------------------------------------------------------------
# Frontend nativo con mocks=false apuntando al backend REAL
# -----------------------------------------------------------------------------
start_frontend() {
  log "Frontend Next (mocks=FALSE, modo $FRONTEND_MODE) en :$FRONTEND_PORT → API :$BACKEND_PORT"

  # -------------------------------------------------------------------------
  # NO REUTILIZAR UN SERVIDOR AJENO EN MODO GATE.
  # Un Next que ya responde en el puerto pudo hornearse con `NEXT_PUBLIC_USE_MOCKS=true`
  # o contra OTRO backend. Reutilizarlo da una corrida verde que no mide lo que dice
  # medir — es exactamente el mismo modo de fallo que `reuseExistingServer: !isCI` de
  # `frontend/playwright.config.ts` (DEVOPS_NOTES §32.6): nueve specs fallaron en bloque
  # porque Playwright reusó un `next dev` suelto y las pruebas hablaron con el backend
  # real en vez de con los datos de prueba. En modo `dev` se sigue reutilizando (es
  # cómodo y no es un gate); en modo `build` se PARA.
  # -------------------------------------------------------------------------
  if curl -sf -m 15 "http://localhost:$FRONTEND_PORT/es" >/dev/null 2>&1; then
    if [ "$FRONTEND_MODE" = "build" ]; then
      die "Ya hay ALGO sirviendo en :$FRONTEND_PORT y esto es una corrida de GATE.
     No se reutiliza: ese proceso pudo hornearse con mocks=true o contra otro backend,
     y un gate que reusa un servidor ajeno mide otra cosa de la que dice medir.
     Apágalo primero:  ./scripts/stack-native.sh down
     (a mano NO basta con pkill -f 'next start -p $FRONTEND_PORT': ese proceso se renombra a
      «next-server (vX.Y.Z)» y ese patrón no lo encuentra. Usa el \`down\`, que ya lo contempla.)"
    fi
    ok "ya respondía en :$FRONTEND_PORT (modo dev: se reutiliza)."
    warn "No se verificó CON QUÉ se horneó ese proceso. Para un GATE usa 'up --gate'."
    return 0
  fi

  [ -d "$FRONTEND_DIR/node_modules" ] || die "Falta $FRONTEND_DIR/node_modules. Corre: cd frontend && npm ci"

  # ---------------------------------------------------------------------------
  # NODE_ENV DEL FRONTEND — NO se hereda el del backend.  (BLOQ-1 de QA, §32.10)
  #
  # La línea 105 exporta `NODE_ENV=development` PARA EL BACKEND: `env.validation.ts`
  # solo exige DATABASE_URL/JWT/STRIPE/APP_BASE_URL/RESEND en entornos NO-locales, y
  # sin esa variable el backend ni arranca aquí. Pero `export` es del PROCESO ENTERO:
  # también llegaba a `npx next build`, y ahí NO es inocuo:
  #     ⚠ You are using a non-standard "NODE_ENV" value in your environment.
  #     Error: <Html> should not be imported outside of pages/_document.
  #     Error occurred prerendering page "/500". Export encountered an error on /_error
  # Con NODE_ENV≠production Next mete el runtime de desarrollo en el prerender estático
  # de las páginas de error y el build MUERE. QA lo reprodujo 2 de 2 (la segunda corrida
  # reventó distinto —`Cannot read properties of null (reading 'useContext')` en
  # /es/forgot-password—: mismo modo de fallo, otra página). Con NODE_ENV=production:
  # exit 0. Es decir: el gate documentado (§32.6) era el ÚNICO camino a una corrida de
  # gate y no existía; QA tuvo que hornear el bundle a mano.
  #
  # CI no estaba afectado: `Dockerfile.frontend` no exporta NODE_ENV en su etapa de
  # build, así que allí resuelve a `production`. El fallo era exclusivo de este arnés.
  #
  # Por eso el valor se fija AQUÍ, por modo, y no se hereda:
  #   build → production  (es el artefacto que se despliega; lo mismo que hace CI)
  #   dev   → development (lo que `next dev` espera de todos modos)
  # El backend, que se lanzó antes en otro subshell, conserva su `development`: son
  # procesos distintos y ninguno pisa al otro.
  # ---------------------------------------------------------------------------
  local NEXT_NODE_ENV

  if [ "$FRONTEND_MODE" = "build" ]; then
    NEXT_NODE_ENV=production
    # `next build` hornea NEXT_PUBLIC_* en el bundle: mocks=false y la URL del backend
    # quedan FIJADAS en el artefacto, no dependen del entorno del runtime.
    log "next build (NODE_ENV=$NEXT_NODE_ENV, mocks=FALSE horneado en el bundle) — tarda unos minutos"
    ( cd "$FRONTEND_DIR" \
      && NODE_ENV="$NEXT_NODE_ENV" \
         NEXT_PUBLIC_USE_MOCKS=false \
         NEXT_PUBLIC_API_BASE_URL="http://localhost:$BACKEND_PORT/api/v1" \
         npx next build > "$RUN_DIR/frontend-build.log" 2>&1 ) \
      || { tail -60 "$RUN_DIR/frontend-build.log"; die "\`next build\` falló. Log: $RUN_DIR/frontend-build.log
     Si es un error de código y no de entorno, el hallazgo es del rol FRONTEND (devops no lo corrige)."; }
    # Detector de REGRESIÓN del propio arnés: si alguien vuelve a dejar filtrar un
    # NODE_ENV no estándar al build, Next lo AVISA pero puede terminar en 0 igualmente
    # (el fallo del prerender es intermitente: QA vio dos páginas distintas romperse).
    # Un build verde horneado con el runtime de desarrollo es peor que uno rojo: el gate
    # correría sobre un artefacto que no es el que se despliega. Aquí se para en seco.
    if grep -q 'non-standard "NODE_ENV"' "$RUN_DIR/frontend-build.log"; then
      die "El build se horneó con un NODE_ENV no estándar (Next lo avisó en $RUN_DIR/frontend-build.log).
     Un GATE no corre sobre ese artefacto. Revisa que nada exporte NODE_ENV por encima de
     este script (\`env | grep NODE_ENV\`) — ver DEVOPS_NOTES §32.10."
    fi
    ok "build listo (NODE_ENV=$NEXT_NODE_ENV, sin aviso de NODE_ENV no estándar)."
    ( cd "$FRONTEND_DIR" \
      && NODE_ENV="$NEXT_NODE_ENV" \
         NEXT_PUBLIC_USE_MOCKS=false \
         NEXT_PUBLIC_API_BASE_URL="http://localhost:$BACKEND_PORT/api/v1" \
         nohup npx next start -p "$FRONTEND_PORT" > "$RUN_DIR/frontend.log" 2>&1 & echo $! > "$RUN_DIR/frontend.pid" )
  else
    NEXT_NODE_ENV=development
    ( cd "$FRONTEND_DIR" \
      && NODE_ENV="$NEXT_NODE_ENV" \
         NEXT_PUBLIC_USE_MOCKS=false \
         NEXT_PUBLIC_API_BASE_URL="http://localhost:$BACKEND_PORT/api/v1" \
         nohup npx next dev -p "$FRONTEND_PORT" > "$RUN_DIR/frontend.log" 2>&1 & echo $! > "$RUN_DIR/frontend.pid" )
  fi

  for i in $(seq 1 40); do
    curl -sf -m 15 "http://localhost:$FRONTEND_PORT/es" >/dev/null 2>&1 && break
    sleep 3
  done
  curl -sf -m 15 "http://localhost:$FRONTEND_PORT/es" >/dev/null 2>&1 \
    || { tail -40 "$RUN_DIR/frontend.log"; die "El frontend no respondió. Log: $RUN_DIR/frontend.log"; }
  ok "arriba en http://localhost:$FRONTEND_PORT (modo $FRONTEND_MODE)"
  if [ "$FRONTEND_MODE" = "dev" ]; then
    warn "Modo \`next dev\`: compila BAJO DEMANDA y se DEGRADA tras varias recompilaciones."
    warn "Sirve para desarrollar. Para un GATE usa 'up --gate' (next build + next start)."
  fi
}

seed_synthetic() {
  log "Seed sintético (datos E2E deterministas, NUNCA datos reales de clientes)"
  ( cd "$BACKEND_DIR" && npm run seed:synthetic )
  ok "Seed cargado."
}

stop_apps() {
  for svc in backend frontend; do
    if [ -f "$RUN_DIR/$svc.pid" ]; then
      local pid; pid="$(cat "$RUN_DIR/$svc.pid")"
      if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; ok "$svc detenido (pid $pid)."
      else warn "$svc ya no corría."; fi
      rm -f "$RUN_DIR/$svc.pid"
    else
      warn "$svc: sin pidfile (¿lo levantaste a mano?)."
    fi
  done
  pkill -f "ts-node --transpile-only src/main.ts" 2>/dev/null || true
  pkill -f "next dev -p $FRONTEND_PORT"           2>/dev/null || true
  pkill -f "next start -p $FRONTEND_PORT"         2>/dev/null || true
  # `next start` se RENOMBRA a «next-server (vX.Y.Z)» en cuanto arranca, así que los dos
  # `pkill` de arriba NO lo matan: sólo matan al `npx` que lo lanzó. Y el pidfile guarda
  # ese `npx`, no al servidor. Resultado observado: `down` decía «frontend detenido»,
  # el pidfile quedaba huérfano y el puerto SEGUÍA sirviendo 200 — con lo que el
  # siguiente `up --gate` moría con «Ya hay ALGO sirviendo en :$FRONTEND_PORT».
  # El arnés dejaba de ser repetible por su propio apagado. (§32.10)
  # El patrón va ANCLADO (`^next-server `): sin el `^`, un `pkill -f next-server` mata
  # también a cualquier shell cuya LÍNEA DE COMANDO mencione la cadena — incluido el
  # `bash -c` que esté ejecutando este mismo `down` desde una sesión de agente. Probado:
  # se suicidó (exit 144). El proceso real se llama literalmente «next-server (v15.5.23)».
  pkill -f "^next-server "                        2>/dev/null || true

  # Verificación de que el apagado APAGÓ. Sin esto, `down` informa éxito por haber
  # ejecutado los kills, no por haber liberado el puerto: el mismo «enforcement de
  # honor» que el techlead señaló en otro sitio, pero aquí en el propio script.
  for i in $(seq 1 10); do
    curl -sf -m 3 "http://localhost:$FRONTEND_PORT/es" >/dev/null 2>&1 || break
    sleep 1
  done
  if curl -sf -m 3 "http://localhost:$FRONTEND_PORT/es" >/dev/null 2>&1; then
    warn "OJO: :$FRONTEND_PORT SIGUE respondiendo tras el apagado — hay un proceso que no lancé yo."
    warn "Identifícalo ANTES de matarlo (puede ser el stack de otro rol):  pgrep -af 'next|node'"
  fi
  if curl -sf -m 3 "http://localhost:$BACKEND_PORT/api/v1/health" >/dev/null 2>&1; then
    warn "OJO: :$BACKEND_PORT SIGUE respondiendo tras el apagado. Mismo criterio: identifícalo antes de matarlo."
  fi
}

print_e2e_instructions() {
  cat <<EOF

──────────────────────────────────────────────────────────────────────────────
 SUITE E2E CONTRA EL STACK VIVO  —  la corre **QA**, no devops
──────────────────────────────────────────────────────────────────────────────
 MODO GATE  —  el ÚNICO que hoy contesta «¿frontend y backend concuerdan?»:

   cd frontend
   E2E_BASE_URL=http://localhost:$FRONTEND_PORT E2E_REAL=1 npm run test:e2e

 · \`E2E_BASE_URL\` presente ⇒ playwright.config NO levanta su webServer de mocks
   (playwright.config.ts:65-73) — ésa es la línea exacta que cierra la brecha.
 · \`E2E_REAL=1\` hace DOS cosas A LA VEZ, y por eso ES el modo gate:
     1. \`grep: /@real/\` (playwright.config.ts:40) ⇒ corre SOLO los specs escritos
        para el stack real (descubren datos del seed, asertan estructura y no montos
        de fixture). Hoy los llevan 8 archivos: catalog · checkout · shipments ·
        buylist · guest-checkout · vault · master-set · pricing-curve.
     2. \`IS_REAL\` (e2e/utils/auth.ts:24) ⇒ \`loginAs()\` canjea las credenciales del
        seed contra \`POST /auth/login\` y persiste el TokenPair REAL del contrato.
 · Número legítimo a esperar: **el subset @real ENTERO en verde**. Un rojo aquí SÍ es
   hallazgo: o el stack no concuerda, o falta \`up --seed\`. Éste es el número que se
   cita en un veredicto.

 MODO SUITE COMPLETA  —  ya autentica de verdad, pero NO es el gate de dinero:

   E2E_BASE_URL=http://localhost:$FRONTEND_PORT npm run test:e2e

 · **ARREGLADO por frontend (24-ago-2026).** Antes este modo NO PODÍA AUTENTICAR por
   construcción: \`E2E_REAL\` era a la vez el selector de specs y el interruptor del
   login real, así que sin ella \`loginAs()\` inyectaba \`'mock.session.token'\` contra
   el backend REAL → 401 → login en bucle. Los **59 rojos de 85** que midió QA eran
   eso, no el stack. Hoy la decisión la toma \`E2E_BASE_URL\`:
     IS_REAL = !FORCE_MOCK && (APP_IS_EXTERNAL || REAL_SUBSET_SELECTED)
   (e2e/utils/auth.ts:55-70) — app levantada por otro ⇒ backend real ⇒ auth real.
 · Número reportado sobre el stack final: **48 verdes · 3 rojos · 35 saltados**. Los
   **3 rojos son los smokes de dinero** (checkout · guest-checkout · shipments) y son
   de ENTORNO, no de producto: sin \`STRIPE_SECRET_KEY\` el backend responde 503
   PAYMENT_PROVIDER_UNAVAILABLE y libera la reserva (money-safe). Frontend NO los
   salta a propósito. Ver DEVOPS_NOTES §31.
 · **Sigue sin ser el gate de dinero**, por dos razones verificadas:
     1. Aquí NO hay egress a api.stripe.com (CONNECT → 403): esos 3 no pueden ponerse
        verdes en esta máquina NI con clave de prueba. El gate vive en CI.
     2. \`guest-checkout.spec.ts:151\` ramifica con \`process.env.E2E_REAL\` CRUDO (no con
        \`IS_REAL\`): sin la bandera toma la rama MOCK de sus asertos contra un modal de
        Stripe real. Por eso \`e2e-real.yml\` fija ahora \`E2E_REAL=1\` (§31.4).
 · **Escotilla que conviene conocer:** \`E2E_MOCKS=1\` fuerza modo mock aunque haya
   \`E2E_BASE_URL\`, y gana sobre todo lo demás. Es deliberada (demo con fixtures); si
   alguna vez aparece en un gate, ese gate deja de medir el stack real. Hoy NO está en
   \`.github/\` (comprobado).

 TRAMPA DEL ARNÉS — \`reuseExistingServer\` (hallazgo de frontend, DEVOPS_NOTES §32.6)
 · \`frontend/playwright.config.ts:71\` usa \`reuseExistingServer: !isCI\`. Si corres la
   suite en modo MOCK (SIN \`E2E_BASE_URL\`) con un \`next dev\` suelto en :$FRONTEND_PORT,
   Playwright REUTILIZA ese servidor en vez de levantar el suyo con mocks=true ⇒ las
   pruebas hablan con el BACKEND REAL en lugar de con los datos de prueba. Nueve specs
   fallaron en bloque exactamente por esto, y el rojo no significaba nada.
 · Regla operativa: **una sola app por puerto, y sabiendo cuál es.** Antes de correr el
   modo MOCK: \`./scripts/stack-native.sh down\` (o exporta \`CI=1\`, que desactiva la
   reutilización). Para el modo GATE no aplica: \`E2E_BASE_URL\` desactiva el webServer.
 · Y para CUALQUIER gate el frontend va horneado, no en \`next dev\`:
   \`./scripts/stack-native.sh up --seed --gate\`  (next build + next start).
   \`next dev\` compila bajo demanda y se DEGRADA tras varias recompilaciones; además
   no es el artefacto que se despliega.

 Chromium: el config usa \`/opt/pw-browsers/chromium\`. Si no existe en esta máquina:
   cd frontend && npx playwright install --with-deps chromium
   (o exporta PLAYWRIGHT_CHROMIUM_PATH=/ruta/al/chromium)

 Logs:  $RUN_DIR/backend.log   ·   $RUN_DIR/frontend.log
 Apagar: ./scripts/stack-native.sh down
EOF
}

case "${1:-up}" in
  up)
    shift || true
    ONLY_INFRA=0; DO_SEED=0
    for a in "$@"; do
      case "$a" in
        --infra) ONLY_INFRA=1 ;;
        --seed)  DO_SEED=1 ;;
        --gate)  FRONTEND_MODE=build ;;
        *) die "Opción desconocida: $a (usa --infra | --seed | --gate)" ;;
      esac
    done
    [ -d "$BACKEND_DIR" ] || die "No existe $BACKEND_DIR."
    start_infra
    # D-g (techlead): `[ cond ] && cmd` bajo `set -e` sólo es seguro por su POSICIÓN
    # (como última sentencia de una función/script, el `[ ]` falso mata al llamador).
    # `if/fi` quita esa carga estructural: mover esta línea ya no puede romper nada.
    if [ "$DO_SEED" = 1 ]; then
      seed_synthetic
    fi
    if [ "$ONLY_INFRA" = 1 ]; then
      log "LISTO (solo infra)."
      echo "  DATABASE_URL: $(printf '%s' "$DATABASE_URL" | sed -E 's#(//[^:]+):[^@]+@#\1:****@#')"
      echo "  Para los tests de integración del backend:  cd backend && npm run test:integration"
      exit 0
    fi
    start_backend
    start_frontend
    warn "SIN MinIO/R2: la subida del INE del buylist (sobre el tope AML) NO se cubre por esta ruta."
    warn "Junto con la falta de STRIPE_TEST_SECRET_KEY son los DOS huecos de entorno que dejan"
    warn "4 smokes de dinero sin verificar en navegador. Ambos siguen ABIERTOS — DEVOPS_NOTES §31/§32.7."
    print_e2e_instructions
    ;;
  status)
    log "Estado del stack nativo"
    pg_isready 2>&1 | sed 's/^/  postgres: /'
    printf '  redis:    %s\n' "$(redis-cli ping 2>/dev/null || echo 'DOWN')"
    # `curl -w` YA imprime 000 al fallar: un `|| echo 000` encadenado imprimiría «000000».
    # Mismo criterio en `post-deploy.sh` (D-h del techlead): ahí se usa `; true`, aquí `; true`.
    printf '  backend:  %s (:%s)\n' "$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "http://localhost:$BACKEND_PORT/api/v1/health" 2>/dev/null; true)" "$BACKEND_PORT"
    # OJO con el timeout del frontend: `next dev` compila BAJO DEMANDA, y una primera
    # petición mientras recompila tarda 10s+ («✓ Compiled /[locale] in 9.6s»). Con -m 3
    # esto imprimía 000 con el proceso VIVO y sirviendo 200 — un falso «caído» que invita
    # a reiniciar el stack sin necesidad. 15s cubre la recompilación; si aun así da 000,
    # confirma con `pgrep -af "next dev"` y `tail .native-stack/frontend.log` ANTES de
    # relanzar nada (puede haber otro rol trabajando contra el stack).
    printf '  frontend: %s (:%s)\n' "$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "http://localhost:$FRONTEND_PORT/es" 2>/dev/null; true)" "$FRONTEND_PORT"
    ;;
  down)
    log "Apagando apps"
    stop_apps
    if [ "${2:-}" = "--all" ]; then
      log "Apagando infra"
      redis-cli shutdown nosave 2>/dev/null || true; ok "Redis detenido."
      pg_ctlcluster "$PG_VER" "$PG_NAME" stop 2>/dev/null || warn "Postgres no se detuvo (¿ya estaba parado?)."
    else
      warn "Postgres y Redis SIGUEN ARRIBA (los datos se conservan). Usa 'down --all' para pararlos."
    fi
    ;;
  *)
    die "Uso: $0 {up [--infra|--seed|--gate] | status | down [--all]}"
    ;;
esac

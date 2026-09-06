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
#   ./scripts/stack-native.sh test:integration   # suite de integración del backend contra
#                                         #   BD REAL, con el env exportado (15/15 · 183/183).
#                                         #   NO uses `npm run test:integration` a secas: ver §37.
#   ./scripts/stack-native.sh verify:head # ¿el stack VIVO sirve el árbol de ahora?
#                                         #   SOLO LEE. Exit 1 si no. CÓRRELO ANTES de
#                                         #   cualquier medición que vayas a citar en un
#                                         #   veredicto (SEC-OPS-1). Admite un SHA:
#                                         #   `verify:head 3b2fc87` = «quiero auditar ÉSE».
#   ./scripts/stack-native.sh status      # qué está arriba, en qué puerto y QUÉ COMMIT sirve
#   ./scripts/stack-native.sh down        # apaga backend y frontend (deja PG/Redis)
#   ./scripts/stack-native.sh down --all  # + para Postgres y Redis
#
# GARANTÍA DE PROCEDENCIA (SEC-OPS-1 · docs/SECURITY_NOTES.md §9 · DEVOPS_NOTES §38):
#   `up` NO reutiliza un backend vivo sin comprobar antes que sirve el árbol de ahora;
#   si no lo sirve, lo REINICIA (y `up` termina probándolo con `verify:head`, no
#   afirmándolo). Reiniciar NO cuesta datos: no se para Postgres/Redis y NO se
#   resiembra — resembrar es SIEMPRE `--seed` explícito, y sí borra (§38.4).
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
#   SEED_OVER_EVIDENCE  (sin default) — `1` deja que `--seed` borre filas de evidencia
#                           de PoC/pentest si las hay. Sin él, `--seed` SE PLANTA y las
#                           lista. No es celo: el 2026-09-06 una resiembra se llevó dos
#                           filas que probaban un hallazgo abierto. Ver DEVOPS_NOTES §38.4.
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

# Enmascara la contraseña de una URL de conexión antes de imprimirla. Aunque aquí la
# credencial sea de desarrollo, el script se copia/pega en sesiones que SÍ acaban en un
# transcript: nunca se imprime un DATABASE_URL entero.
mask_url() { printf '%s' "$1" | sed -E 's#(//[^:]+):[^@]+@#\1:****@#'; }

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
# existe y se midió viva (DEVOPS_NOTES §35.4-bis). Espeja a APP_BASE_URL para que no puedan
# divergir. Para volver al degrade (botón -> instrucción de texto): APP_PUBLIC_URL= ./scripts/...
export APP_PUBLIC_URL="${APP_PUBLIC_URL:-http://localhost:$FRONTEND_PORT}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-local_dev_only_access_secret_at_least_32_chars_long}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-local_dev_only_refresh_secret_at_least_32_chars_different}"

mkdir -p "$RUN_DIR"

# =============================================================================
# PROCEDENCIA DEL BINARIO VIVO — SEC-OPS-1 (docs/SECURITY_NOTES.md §9)
# =============================================================================
# El modo de fallo, DOS veces seguidas, fue éste y sólo éste: `start_backend()`
# preguntaba «¿responde algo en :3099?» y, si sí, REUTILIZABA ese proceso sin
# preguntar QUÉ código estaba sirviendo. Un backend arrancado a las 15:04 siguió
# atendiendo el gate del commit de las 16:16. La vez anterior, 20:10 vs 21:34.
# Las dos veces lo cazó una persona mirando la hora de un PID.
#
# El frontend YA tenía la guarda equivalente («NO REUTILIZAR UN SERVIDOR AJENO EN
# MODO GATE», más abajo). El backend no. Ahora la tiene, y es MÁS fuerte: en vez de
# negarse, REINICIA — porque reiniciar aquí no cuesta nada que importe (ver el
# recuadro de `stop_backend_only`), y una guarda que sólo se puede satisfacer
# acordándose de un comando extra acaba desactivada.
#
# CONTRATO DE DATOS (esto es lo que hace que reiniciar sea gratis):
#   `up` NO resiembra. Nunca. La única forma de tocar los datos es `--seed`
#   EXPLÍCITO, y eso es destructivo de verdad (MEDIDO: `prisma/seed-e2e.ts:129`
#   hace `sellRequest.deleteMany({ where: { userId: { in: ids } } })` sobre los
#   usuarios deterministas del fixture). Seguridad reinició a mano SIN `--seed`
#   justamente por eso, y tenía razón. Ver DEVOPS_NOTES §38.4.
BACKEND_HEALTH_URL="http://localhost:$BACKEND_PORT/api/v1/health"
BACKEND_STAMP="$RUN_DIR/backend.stamp"
FRONTEND_STAMP="$RUN_DIR/frontend.stamp"
ASSERT_HEAD="$SCRIPT_DIR/assert-serving-head.sh"

# Rutas cuyo mtime decide si el proceso vivo sirve o no el árbol de ahora.
# `ts-node --transpile-only` compila AL ARRANCAR y Nest requiere el árbol entero en
# el boot: un fichero editado después NO está en lo que se sirve.
#   · `src`      — el código.
#   · `prisma`   — schema y migraciones (cambian el contrato con la BD).
#   · `package.json` — dependencias y scripts.
# `node_modules`, `dist`, `coverage` y `*.log` los excluye el propio assert.
BACKEND_SOURCE_ARGS=(--source "$BACKEND_DIR/src" --source "$BACKEND_DIR/prisma" --source "$BACKEND_DIR/package.json")

head_sha() { git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo ""; }
short_sha() { printf '%s' "${1:0:12}"; }

# Ficheros de `backend/` con cambios sin commitear. NO es un fallo (aquí se trabaja
# con el árbol sucio todo el rato); se REGISTRA en el sello para que el siguiente
# auditor sepa que «HEAD» no cuenta la historia completa.
dirty_count() { git -C "$ROOT_DIR" status --porcelain -- backend frontend 2>/dev/null | wc -l | tr -d ' '; }

# Instante REAL de arranque del proceso que responde en el puerto, derivado de
# `process.uptime()` que expone `/health` (health.service.ts). Misma derivación que
# `assert-serving-head.sh`; se repite aquí (5 líneas) para que aquel script siga
# siendo autónomo y utilizable desde CI sin este.
live_started_epoch() {
  local url="$1" now body up
  now="$(date +%s)"
  body="$(curl -sS -m 5 "$url" 2>/dev/null)" || return 1
  up="$(printf '%s' "$body" | sed -nE 's/.*"uptime"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' | head -1)"
  case "$up" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$(( now - up ))"
}

# Sello de procedencia. Se escribe DESPUÉS de que el servicio esté sano y, para el
# backend, con el epoch DERIVADO DEL PROCESO (no con la hora a la que lancé el
# comando): así el sello y `/health` hablan del mismo instante y una diferencia
# significa «hay OTRO proceso en el puerto», no «se me fue el reloj».
write_stamp() {
  local file="$1" started="$2" pid="${3:-}" extra="${4:-}"
  {
    printf 'sha=%s\n'        "$(head_sha)"
    printf 'started_at=%s\n' "$started"
    printf 'started_h=%s\n'  "$(date -d "@$started" '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || echo "@$started")"
    printf 'dirty=%s\n'      "$(dirty_count)"
    printf 'pid=%s\n'        "$pid"
    printf 'stamped_by=%s\n' "stack-native.sh"
    [ -z "$extra" ] || printf '%s\n' "$extra"
  } > "$file"
}

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
  # El nombre de la última migración se DERIVA del árbol, no se escribe a mano. La versión
  # previa decía «incluida M-41» y lo siguió diciendo hasta M-46: un mensaje que envejece en
  # silencio es PEOR que no tenerlo, porque se cita en veredictos como si fuera una medición.
  # `migrate deploy` ya aborta el script (set -e) si alguna migración falla, así que si
  # llegamos aquí, la de abajo está aplicada.
  local last_mig
  last_mig="$(ls -1 "$BACKEND_DIR/prisma/migrations" 2>/dev/null | grep -E '^[0-9]{14}_' | sort | tail -1)"
  ok "Migraciones al día (la más reciente del árbol: ${last_mig:-¿ninguna?})."
}

# -----------------------------------------------------------------------------
# Backend nativo: el stack Nest COMPLETO por ts-node (no un arnés recortado)
# -----------------------------------------------------------------------------
# -----------------------------------------------------------------------------
# Apagar SOLO el backend, para poder relanzarlo contra el árbol de ahora.
#
# ⚠️ LO QUE ESTA FUNCIÓN **NO** HACE, Y ES EL PUNTO ENTERO:
#   · NO para Postgres. NO para Redis. NO corre el seed. NO borra una sola fila.
#   Reiniciar para auditar NO PUEDE COSTAR LA EVIDENCIA QUE SE ESTÁ AUDITANDO.
#   Es exactamente lo que hizo seguridad a mano en el pase v1.56 (`down` + `up`
#   deliberadamente SIN `--seed`, para conservar las filas del PoC); aquí queda
#   cableado en vez de depender de que el siguiente auditor lo recuerde.
#   El único camino que toca datos sigue siendo `--seed` EXPLÍCITO.
# -----------------------------------------------------------------------------
stop_backend_only() {
  if [ -f "$RUN_DIR/backend.pid" ]; then
    local pid; pid="$(cat "$RUN_DIR/backend.pid")"
    kill "$pid" 2>/dev/null || true
    rm -f "$RUN_DIR/backend.pid"
  fi
  pkill -f 'ts-node --transpile-only src/main.ts' 2>/dev/null || true
  rm -f "$BACKEND_STAMP"
  for i in $(seq 1 20); do
    curl -sf -m 2 "$BACKEND_HEALTH_URL" >/dev/null 2>&1 || { ok "backend obsoleto detenido."; return 0; }
    sleep 1
  done
  # Si no se libera el puerto NO se puede garantizar qué se está sirviendo, y ése es
  # justo el estado que este script existe para hacer imposible. Se para en seco.
  die "No pude apagar el backend obsoleto de :$BACKEND_PORT (sigue respondiendo tras 20s).
     Hay un proceso que NO lancé yo. Identifícalo ANTES de matarlo — puede ser el stack
     de otro rol:   pgrep -af 'ts-node|node .*main.ts'
     Mientras siga vivo, NADIE puede afirmar qué commit se está midiendo (SEC-OPS-1)."
}

start_backend() {
  log "Backend NestJS nativo (ts-node) en :$BACKEND_PORT"

  # -------------------------------------------------------------------------
  # SEC-OPS-1 — NO REUTILIZAR UN BACKEND SIN SABER QUÉ SIRVE.
  # Aquí es donde se firmaron (casi) dos veredictos contra binarios viejos: la
  # versión anterior de estas 4 líneas era «responde ⇒ ok, return 0».
  # Ahora responder no basta: hay que PROBAR la procedencia.
  # -------------------------------------------------------------------------
  if curl -sf -m 3 "$BACKEND_HEALTH_URL" >/dev/null 2>&1; then
    if "$ASSERT_HEAD" --url "$BACKEND_HEALTH_URL" --label "backend :$BACKEND_PORT" \
         --stamp "$BACKEND_STAMP" "${BACKEND_SOURCE_ARGS[@]}" \
         --remedy "Lo reinicio yo ahora mismo. Postgres/Redis y los datos NO se tocan." --quiet; then
      ok "ya respondía en :$BACKEND_PORT y SIRVE el árbol de ahora ($(short_sha "$(head_sha)")) — se reutiliza."
      return 0
    fi
    warn "El backend vivo NO sirve el árbol de ahora (arriba está el detalle). Lo reinicio."
    warn "Los datos NO se tocan: no se para Postgres/Redis y NO se resiembra."
    stop_backend_only
  fi

  [ -d "$BACKEND_DIR/node_modules" ] || die "Falta $BACKEND_DIR/node_modules. Corre: cd backend && npm ci"
  ( cd "$BACKEND_DIR" && nohup npx ts-node --transpile-only src/main.ts \
      > "$RUN_DIR/backend.log" 2>&1 & echo $! > "$RUN_DIR/backend.pid" )
  # El arranque compila TS en caliente: dale margen (observado ~45-60s en frío).
  for i in $(seq 1 60); do
    curl -sf -m 3 "$BACKEND_HEALTH_URL" >/dev/null 2>&1 && break
    kill -0 "$(cat "$RUN_DIR/backend.pid")" 2>/dev/null || {
      tail -40 "$RUN_DIR/backend.log"; die "El backend murió al arrancar. Log: $RUN_DIR/backend.log
     Si es un error de código y no de entorno, el hallazgo es del rol BACKEND (devops no lo corrige)."; }
    sleep 3
  done
  curl -sf -m 3 "$BACKEND_HEALTH_URL" >/dev/null 2>&1 \
    || { tail -40 "$RUN_DIR/backend.log"; die "Sin salud tras ~3min. Log: $RUN_DIR/backend.log"; }

  # Sello CON EL EPOCH DERIVADO DEL PROCESO (no con `date` de cuando lancé el nohup):
  # el `npx` tarda un par de segundos en llegar al `node`, y si el sello guardara mi
  # reloj en vez del del proceso, la comprobación posterior arrastraría un desfase
  # constante y la tolerancia tendría que taparlo. Así el desfase es CERO por
  # construcción, y cualquier diferencia futura significa de verdad «otro proceso».
  local started; started="$(live_started_epoch "$BACKEND_HEALTH_URL" || true)"
  [ -n "$started" ] || started="$(date +%s)"
  # La BD va en el sello (ENMASCARADA — nunca la contraseña). Un backend puede servir
  # el commit correcto contra la base EQUIVOCADA, y eso también invalida una medición.
  # Sólo se reutiliza un backend que arrancó ESTE script, así que el env es el de la
  # cabecera; el sello deja constancia para que el auditor no tenga que confiar.
  write_stamp "$BACKEND_STAMP" "$started" "$(cat "$RUN_DIR/backend.pid" 2>/dev/null || echo '')" \
    "port=$BACKEND_PORT
db=$(mask_url "$DATABASE_URL")"

  ok "salud: $(curl -sS -m 5 "$BACKEND_HEALTH_URL")"
  # OBSERVABILIDAD (SEC-OPS-1): que el arranque DIGA qué commit sirve, para que el
  # siguiente auditor no tenga que deducirlo de la hora de un PID.
  ok "sirviendo commit $(short_sha "$(head_sha)")$( [ "$(dirty_count)" != "0" ] && printf ' + %s fichero(s) sin commitear' "$(dirty_count)" )  ·  arrancado $(date -d "@$started" '+%H:%M:%S' 2>/dev/null || echo "@$started")"
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

  # Instante de lanzamiento del servidor (para el sello). El frontend NO expone un
  # `/health` con `uptime`, así que aquí NO hay ancla derivada del proceso como en el
  # backend: el sello del frontend se apoya en ESTE reloj y en que el pid siga vivo.
  # Es más débil, y se dice: `verify:head` lo etiqueta como tal.
  local fe_started; fe_started="$(date +%s)"

  for i in $(seq 1 40); do
    curl -sf -m 15 "http://localhost:$FRONTEND_PORT/es" >/dev/null 2>&1 && break
    sleep 3
  done
  curl -sf -m 15 "http://localhost:$FRONTEND_PORT/es" >/dev/null 2>&1 \
    || { tail -40 "$RUN_DIR/frontend.log"; die "El frontend no respondió. Log: $RUN_DIR/frontend.log"; }
  write_stamp "$FRONTEND_STAMP" "$fe_started" "$(cat "$RUN_DIR/frontend.pid" 2>/dev/null || echo '')" "mode=$FRONTEND_MODE
port=$FRONTEND_PORT"
  ok "arriba en http://localhost:$FRONTEND_PORT (modo $FRONTEND_MODE)"
  ok "sirviendo commit $(short_sha "$(head_sha)")  ·  arrancado $(date -d "@$fe_started" '+%H:%M:%S' 2>/dev/null || echo "@$fe_started")"
  if [ "$FRONTEND_MODE" = "dev" ]; then
    warn "Modo \`next dev\`: compila BAJO DEMANDA y se DEGRADA tras varias recompilaciones."
    warn "Sirve para desarrollar. Para un GATE usa 'up --gate' (next build + next start)."
  fi
}

# -----------------------------------------------------------------------------
# verify:head — ¿lo que está vivo es lo que voy a auditar?  (SEC-OPS-1)
#
# SOLO LEE. No arranca, no para, no siembra, no escribe una fila. Pensado para que
# QA / seguridad / el pentester lo corran ANTES de la primera medición y DESPUÉS de
# la última, y para que CI lo use como paso bloqueante.
# Exit 0 = puedes medir.  Exit 1 = lo que midas no vale.
# -----------------------------------------------------------------------------
verify_head() {
  local rc=0 expected; expected="${1:-$(head_sha)}"

  "$ASSERT_HEAD" --url "$BACKEND_HEALTH_URL" --label "backend :$BACKEND_PORT" \
      --stamp "$BACKEND_STAMP" --sha "$expected" "${BACKEND_SOURCE_ARGS[@]}" || rc=1

  # --- Frontend: mismo criterio, evidencia más débil (no hay uptime que consultar) --
  echo ""
  echo "──────────────────────────────────────────────────────────────────────────────"
  echo " PROCEDENCIA DEL BINARIO VIVO — frontend :$FRONTEND_PORT"
  echo "──────────────────────────────────────────────────────────────────────────────"
  if ! curl -sf -m 15 "http://localhost:$FRONTEND_PORT/es" >/dev/null 2>&1; then
    echo "  no responde: no hay nada que verificar."
  elif [ ! -f "$FRONTEND_STAMP" ]; then
    echo "  ⚠ responde pero NO hay sello ($FRONTEND_STAMP): procedencia DESCONOCIDA."
    echo "    Para un gate eso es tan inválido como un binario viejo. Vuelve a levantarlo:"
    echo "      ./scripts/stack-native.sh down && ./scripts/stack-native.sh up --gate"
    rc=1
  else
    local f_sha f_started f_mode f_pid
    f_sha="$(grep -E '^sha='        "$FRONTEND_STAMP" | cut -d= -f2- || true)"
    f_started="$(grep -E '^started_at=' "$FRONTEND_STAMP" | cut -d= -f2- || true)"
    f_mode="$(grep -E '^mode='      "$FRONTEND_STAMP" | cut -d= -f2- || true)"
    f_pid="$(grep -E '^pid='        "$FRONTEND_STAMP" | cut -d= -f2- || true)"
    echo "  commit servido      : ${f_sha:-?}"
    echo "  arrancado           : $(date -d "@${f_started:-0}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "@$f_started")  (modo ${f_mode:-?})"
    if [ -n "$f_pid" ] && ! kill -0 "$f_pid" 2>/dev/null; then
      echo "  ⚠ el pid del sello ($f_pid) ya NO existe: quien responde en el puerto NO es"
      echo "    el proceso sellado. Procedencia DESCONOCIDA."
      rc=1
    fi
    if [ "$f_mode" = "build" ]; then
      # Solo en modo build el artefacto está horneado y puede quedarse viejo.
      # `next dev` recompila bajo demanda, así que un fuente más nuevo NO implica
      # que se esté sirviendo código viejo (sí implica que no es un gate — eso ya
      # lo dice `up --gate`).
      if [ "$f_sha" != "$expected" ]; then
        echo "  ⛔ COMMIT DISTINTO: horneado \`$(short_sha "$f_sha")\`, esperado \`$(short_sha "$expected")\`."
        rc=1
      fi
      local newer
      newer="$(find "$FRONTEND_DIR/src" "$FRONTEND_DIR/messages" "$FRONTEND_DIR/package.json" \
                 \( -name node_modules -o -name .next -o -name coverage \) -prune -o \
                 -type f ! -name '*.log' -newermt "@${f_started:-0}" -print 2>/dev/null | head -8 || true)"
      if [ -n "$newer" ]; then
        echo "  ⛔ hay fuente MÁS NUEVO que el build horneado ⇒ el bundle NO lo incluye:"
        printf '%s\n' "$newer" | sed 's#^#       · #'
        rc=1
      fi
      [ "$rc" = 1 ] || echo "  ✔ el bundle horneado corresponde al árbol de ahora."
    else
      echo "  ⚠ modo \`dev\`: recompila bajo demanda, así que no se puede fechar lo que sirve."
      echo "    NO es un artefacto de gate. Para un gate: 'up --gate'."
    fi
  fi

  echo ""
  if [ "$rc" = 0 ]; then
    ok "VERIFICADO: lo que está vivo es el árbol de ahora ($(short_sha "$expected")). Puedes medir."
  else
    die "NO VERIFICADO (SEC-OPS-1): lo que midas contra este stack NO vale.
     Arréglalo con:   ./scripts/stack-native.sh up          (reinicia apps, NO toca datos)
     Para un gate:    ./scripts/stack-native.sh up --gate   (además hornea el frontend)"
  fi
}

seed_synthetic() {
  # ---------------------------------------------------------------------------
  # GUARDA DE EVIDENCIA (§38.4). El seed NO es «recargar datos de prueba»: es
  # DESTRUCTIVO por diseño. `prisma/seed-e2e.ts:129` hace
  #   sellRequest.deleteMany({ where: { userId: { in: ids } } })
  # sobre los usuarios deterministas del fixture. Si en ese momento hay filas de
  # PoC/pentest colgando de uno de ellos, el seed se las lleva por delante.
  #
  # NO ES HIPOTÉTICO: el 2026-09-06 a las 17:14 una resiembra borró DOS de las tres
  # filas que probaban BL-35 eje 2 (`SPEI-EJE2-NEVER-ARRIVED-001` y `QA-BL35-EJE2`,
  # ambas de `customer@e2e.local`). Sobrevivió solo la del usuario redteam, que no
  # está en el fixture. Ver §38.4.
  #
  # Esta guarda cubre lo que yo controlo: el `--seed` de este script. NO cubre las
  # suites de integración, que llaman a `seedE2E()` directamente en su `beforeAll`
  # (12 specs lo hacen). Eso es `backend/test/` — rol BACKEND. Consecuencia que
  # conviene tener presente: **la BD del fixture no es un sitio seguro para guardar
  # evidencia de una auditoría.**
  # ---------------------------------------------------------------------------
  local ev=""
  if command -v psql >/dev/null 2>&1; then
    ev="$(psql "${DATABASE_URL%%\?*}" -X -q -A -t -c \
      "SELECT count(*) FROM \"SellRequest\" WHERE \"speiReference\" ~ '^(SPEI-DOUBLESPEND|SPEI-EJE2|QA-BL35|PENTEST-|POC-|REDTEAM-)'" 2>/dev/null || true)"
  fi
  if [ -n "$ev" ] && [ "$ev" != "0" ] && [ "${SEED_OVER_EVIDENCE:-0}" != "1" ]; then
    psql "${DATABASE_URL%%\?*}" -X -c \
      "SELECT sr.id, sr.status, sr.\"speiReference\", sr.\"paidAt\", u.email
         FROM \"SellRequest\" sr LEFT JOIN \"User\" u ON u.id = sr.\"userId\"
        WHERE sr.\"speiReference\" ~ '^(SPEI-DOUBLESPEND|SPEI-EJE2|QA-BL35|PENTEST-|POC-|REDTEAM-)'" 2>/dev/null || true
    die "HAY $ev FILA(S) DE EVIDENCIA DE PoC EN LA BD y \`--seed\` LAS BORRARÍA.
     El seed no recarga: BORRA el estado transaccional de los usuarios del fixture
     (seed-e2e.ts:129). Ya pasó una vez (§38.4) y se perdieron dos filas de un
     hallazgo abierto.

     Elige a conciencia:
       · Conservarlas  → NO siembres. \`./scripts/stack-native.sh up\` (sin --seed)
                         reinicia las apps sin tocar un solo dato.
       · Purgarlas     → ./scripts/purge-synthetic-poc-data.sh          (simulacro)
                         ./scripts/purge-synthetic-poc-data.sh --apply  (de verdad)
       · Sembrar igual → SEED_OVER_EVIDENCE=1 ./scripts/stack-native.sh up --seed
                         (dilo en voz alta: estás destruyendo evidencia a propósito)"
  fi
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

  # Los sellos de procedencia mueren con los procesos que describen. Un sello
  # huérfano no puede engañar al comprobador (compara contra el uptime del proceso
  # vivo, no contra el fichero), pero un fichero que dice «sirvo 3b2fc87» junto a un
  # puerto muerto invita a leerlo mal. Se borran.
  rm -f "$BACKEND_STAMP" "$FRONTEND_STAMP"

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

# -----------------------------------------------------------------------------
# El dispatcher SOLO corre si el script se EJECUTA. Si alguien lo `source`ea (para
# reutilizar una función, o por accidente en un shell interactivo), sin esto se
# ejecutaría `up` sin haberlo pedido —el `${1:-up}` de abajo toma `up` por defecto—
# y le reiniciaría el stack en la cara. Idioma estándar, aquí con motivo.
# -----------------------------------------------------------------------------
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then
  return 0 2>/dev/null || true
fi

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
      echo "  DATABASE_URL: $(mask_url "$DATABASE_URL")"
      echo "  Tests de integración del backend (BD real):  ./scripts/stack-native.sh test:integration"
      echo "  (NO uses \`cd backend && npm run test:integration\` a secas: deja 1 suite de 15 en"
      echo "   rojo por env, no por producto. El subcomando exporta el env correcto — ver §37.)"
      exit 0
    fi
    start_backend
    start_frontend
    # -------------------------------------------------------------------------
    # AUTOCOMPROBACIÓN DE CIERRE (SEC-OPS-1). `up` no AFIRMA que sirve el árbol de
    # ahora: lo PRUEBA, con el mismo comprobador que usará el auditor. Si entre el
    # arranque del backend y este punto alguien tocó el fuente (pasa: el frontend
    # tarda minutos en hornear), el `up` termina en ROJO en vez de dejar un stack
    # que parece bueno.
    # -------------------------------------------------------------------------
    log "Autocomprobación: ¿el stack vivo sirve el árbol de ahora? (SEC-OPS-1)"
    verify_head
    warn "SIN MinIO/R2: la subida del INE del buylist (sobre el tope AML) NO se cubre por esta ruta."
    warn "Junto con la falta de STRIPE_TEST_SECRET_KEY son los DOS huecos de entorno que dejan"
    warn "4 smokes de dinero sin verificar en navegador. Ambos siguen ABIERTOS — DEVOPS_NOTES §31/§32.7."
    print_e2e_instructions
    ;;
  test:integration)
    shift || true
    # -------------------------------------------------------------------------
    # POR QUÉ EXISTE ESTE SUBCOMANDO (medido el 2026-09-02 · DEVOPS_NOTES §37)
    #
    # `cd backend && npm run test:integration` A SECAS deja 1 suite de 15 en rojo, y ese
    # rojo NO es del producto: es fontanería de entorno.
    #   · 14 suites arrancan el AppModule, y `ConfigModule.forRoot()` (app.module.ts:39,
    #     SIN `envFilePath` ⇒ default `<cwd>/.env`) carga `backend/.env` dentro de
    #     process.env al IMPORTAR el módulo. Por eso ven la BD y pasan.
    #   · `seed-idempotency.e2e-spec.ts` es la ÚNICA que NO pasa por Nest: hace
    #     `new PrismaClient()` a nivel de módulo, o sea ANTES de que nadie haya cargado
    #     el .env. Revienta con, literal:
    #         PrismaClientInitializationError:
    #           error: Environment variable not found: DATABASE_URL.
    #     Medido: 14 passed / 1 failed · 178 passed / 5 failed · exit 1.
    #   · Con DATABASE_URL EXPORTADA en el entorno del proceso: 15/15 suites ·
    #     183/183 tests · exit 0. Mismo código, mismo commit, árbol limpio.
    #
    # `test/integration/setup.ts` NO tapa este hueco: para DATABASE_URL solo emite un
    # `console.warn` (no pone default, y no podría: no hay una BD "de mentira" válida).
    # Ese warn sale INCLUSO en la corrida verde — es ruido conocido, no un síntoma.
    #
    # Este subcomando no es un atajo ni un arnés distinto: reexporta EL MISMO bloque de
    # env de la cabecera de este script, así que la BD que miden los tests es exactamente
    # la que levanta `up`. Arreglar el spec para que no dependa del proceso sería trabajo
    # del rol BACKEND (es su archivo); devops cierra el hueco por el lado del ENTORNO.
    # -------------------------------------------------------------------------
    pg_isready -q 2>/dev/null || die "Postgres no acepta conexiones. Levanta la infra primero:
     ./scripts/stack-native.sh up --infra"
    redis-cli ping >/dev/null 2>&1 || warn "Redis NO responde: los specs que tocan BullMQ/health degradarán."
    log "Suite de INTEGRACIÓN del backend contra BD REAL (15 specs, --runInBand)"
    echo "  DATABASE_URL: $(mask_url "$DATABASE_URL")"
    warn "Esta suite ESCRIBE en la BD (resiembra el fixture). Si después vas a correr el gate"
    warn "E2E de Playwright, vuelve a sembrar:  ./scripts/stack-native.sh up --seed"
    # -------------------------------------------------------------------------
    # NODE_ENV=test SE FIJA AQUÍ, Y NO ES OPCIONAL. (§37.3 — mismo footgun que §32.10)
    #
    # La cabecera de este script exporta NODE_ENV=development PARA EL BACKEND que corre
    # como servidor. `export` alcanza a todo hijo, y jest solo pone NODE_ENV=test si NADIE
    # lo puso antes — así que ese `development` GANABA sobre el default de jest y se colaba
    # en la suite. Consecuencia medida (corrida real, mismo commit, árbol limpio):
    #     Test Suites: 3 failed, 12 passed · Tests: 25 failed, 158 passed · exit 1
    #     los 13 asertos con literal propio fallaron TODOS con `Received: 429`.
    # Porque `src/config/test-env.ts:28` es `process.env.NODE_ENV === 'test'`, y de ahí
    # cuelgan DOS piezas:
    #   1. `AppThrottlerGuard` (login 5/min por IP, SEC-C1). Con NODE_ENV≠test el guard
    #      NO se omite y la suite —que hace ~10 logins desde 127.0.0.1 en el mismo minuto—
    #      se autoenvenena con 429. Es EXACTAMENTE el fallo de CI del 2026-08-18.
    #   2. El scheduler BullMQ. Con NODE_ENV≠test cada suite registra los crons y un worker
    #      sobre la cola compartida `tcg-daily`, y el catch-up de `price-ingest` encola
    #      trabajo REAL: escrituras de fondo en la BD que se está midiendo, y `afterAll`
    #      colgado esperando a `worker.close()`.
    # O sea: sin esta línea el arnés no solo pinta rojos falsos, es que MIDE OTRA COSA.
    # `PORT` no hace falta neutralizarlo: el harness hace `app.listen(0)` (puerto efímero,
    # helpers/e2e-app.ts:172), no lee PORT, y por eso no choca con el backend de :3099.
    #
    # Con NODE_ENV=test: 15/15 suites · 183/183 tests · exit 0.
    # -------------------------------------------------------------------------
    # `npm run <script> -- args` solo si hay args: sin ellos, el `--` suelto confunde a npm.
    if [ "$#" -gt 0 ]; then
      ( cd "$BACKEND_DIR" && NODE_ENV=test npm run test:integration -- "$@" )
    else
      ( cd "$BACKEND_DIR" && NODE_ENV=test npm run test:integration )
    fi
    ;;
  verify:head)
    shift || true
    # `verify:head [<sha>]` — SOLO LEE. Sin argumento compara contra `git rev-parse HEAD`.
    # Con argumento, contra el SHA que se le pase (útil para «auditar exactamente 3b2fc87»).
    log "Verificación de procedencia del stack vivo (SEC-OPS-1)"
    verify_head "${1:-}"
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
    # PROCEDENCIA (SEC-OPS-1): «arriba» no es una respuesta útil si nadie sabe QUÉ está
    # arriba. `status` dice el commit servido sin que haya que deducirlo de un PID.
    # Ojo: esto INFORMA; el que VERIFICA (y falla) es `verify:head`.
    printf '  HEAD del árbol:  %s%s\n' "$(short_sha "$(head_sha)")" \
      "$( [ "$(dirty_count)" != "0" ] && printf ' (+%s fichero(s) sin commitear en backend/frontend)' "$(dirty_count)" )"
    for svc in backend frontend; do
      st="$RUN_DIR/$svc.stamp"
      if [ -f "$st" ]; then
        printf '  %s sirve:   %s  (arrancado %s)\n' "$svc" \
          "$(short_sha "$(grep -E '^sha=' "$st" | cut -d= -f2-)")" \
          "$(grep -E '^started_h=' "$st" | cut -d= -f2-)"
      else
        printf '  %s sirve:   ¿? sin sello — procedencia DESCONOCIDA (./scripts/stack-native.sh verify:head)\n' "$svc"
      fi
    done
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
    die "Uso: $0 {up [--infra|--seed|--gate] | test:integration [args de jest] | verify:head [<sha>] | status | down [--all]}"
    ;;
esac

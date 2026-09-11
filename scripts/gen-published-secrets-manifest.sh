#!/usr/bin/env bash
#
# gen-published-secrets-manifest.sh — «qué valores de este repo ya son públicos» · devops
# =============================================================================
# POR QUÉ EXISTE (S-88-1, lado del VALOR)
# ---------------------------------------------------------------------------
# El preflight del webhook decidía si un valor era «un no-secreto» preguntándole a
# una LISTA DE PALABRAS (`dummy`, `change_me`, `fake`…). Seguridad midió el agujero
# obvio de esa forma de pensar:
#
#     STRIPE_SECRET_KEY=sk_live_…  +  STRIPE_WEBHOOK_SECRET=whsec_e2e_test_secret
#     → PASABA.
#
# `whsec_e2e_test_secret` no contiene ninguna de las palabras de la lista. Pero está
# COMMITEADO en `backend/test/integration/setup.ts:32` de un repositorio PÚBLICO:
# cualquiera puede leerlo y firmar con él. La lista de palabras adivina; el hecho es
# otro y es comprobable:
#
#     ► un valor que está escrito en este repositorio es un valor que el atacante
#       también tiene. No importa cómo se llame ni a qué se parezca.
#
# Este generador convierte ese hecho en un fichero: el sha256 de cada literal que
# el repo publica. El preflight compara contra él (identidad, no heurística), así
# que cubre por construcción los literales que aún no existen —el que alguien
# commitee mañana entra en el manifiesto en cuanto se regenera— y los que no son
# míos (los de `backend/test/`, que no puedo borrar porque no es mi ruta: quedan
# NEUTRALIZADOS aunque sigan ahí, porque ningún entorno real puede usarlos).
#
# SE GUARDA EL HASH, NO EL VALOR
# ---------------------------------------------------------------------------
# Los valores ya son públicos, así que el hash no protege el secreto: protege que
# este fichero no sea una LISTA DE LA COMPRA cómoda para quien clona el repo.
#
# QUÉ SE COSECHA
#   (a) Asignaciones a nombres con FORMA DE SECRETO en ficheros de configuración y
#       código: `VAR=valor`, `VAR: valor`, `${VAR:-valor}`, `?? 'valor'`, `|| 'valor'`.
#   (b) Cualquier cadena con PREFIJO de secreto conocido (`whsec_`, `sk_live_`,
#       `sk_test_`, `rk_…`, `re_`, `AKIA`, `ghp_`, `xoxb-`, `SG.`, `AIza`) en
#       cualquier fichero versionado, INCLUIDAS las notas de `docs/` — un secreto
#       citado en un informe está igual de publicado que uno en un `.yml`.
#
# Uso:
#   ./scripts/gen-published-secrets-manifest.sh            # reescribe el manifiesto
#   ./scripts/gen-published-secrets-manifest.sh --check    # rc=1 si está desfasado
#
# El candado `scripts/check-secret-defaults.sh` corre `--check`: un literal nuevo
# sin regenerar el manifiesto pone el CI en rojo.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 1

DESTINO="security/secretos-publicados.sha256"
RETIRADOS="security/secretos-retirados.sha256"
# Catálogo de secretos EXIGIDOS (los `${VAR:?}` de los compose). Se materializa en
# un fichero porque dentro de la imagen del backend NO hay ficheros de compose: sin
# esto, `secrets-preflight.sh assert` correría en el arranque de Railway sin nada
# que mirar y saldría 0. Un candado sin blanco es el bug de §44 otra vez.
CATALOGO="security/secretos-exigidos.txt"
# Y el catálogo del CONTENEDOR, que NO es el mismo — y confundirlos tumbó el gate
# de dinero (run 34531002011, 5 min de espera a un contenedor ya muerto):
#
#     JWT_ACCESS_SECRET: ${STAGING_JWT_ACCESS_SECRET:?…}
#     └── nombre DENTRO del contenedor   └── nombre en el HOST (interpolación)
#
# El preflight del entrypoint corre DENTRO, donde `STAGING_JWT_ACCESS_SECRET` no
# existe: solo existe `JWT_ACCESS_SECRET`. Con el catálogo del host metido en la
# imagen, 12 de 15 variables «faltaban», el `assert` abortaba, el `&&` cortaba y
# `node` no llegaba a ejecutarse — un contenedor que muere sin servir nada.
CATALOGO_CONT="security/secretos-exigidos-contenedor.txt"
MODO="${1:-write}"

# --- UNA VEZ PUBLICADO, PUBLICADO PARA SIEMPRE ------------------------------
# El manifiesto se deriva del ÁRBOL DE TRABAJO. Si mañana backend borra el
# `|| 'whsec_e2e_test_secret'` de su helper de tests, ese valor desaparece del
# árbol… y con él desaparecería del manifiesto. Pero **no desaparece del mundo**:
# estuvo commiteado en un repositorio público, así que sigue en el historial de
# git, en los forks y en la caché de quien lo clonó. Un valor que dejó de estar
# publicado es un valor que sigue siendo público.
#
# Por eso hay un segundo fichero, APPEND-ONLY: cuando una entrada sale del árbol,
# se JUBILA aquí en vez de perderse, y el manifiesto final es la unión de las dos.
# Así el rechazo en runtime no se debilita cuando alguien limpia su código.

# --- Nombres con forma de secreto -------------------------------------------
# Fuente ÚNICA de la forma. `check-secret-defaults.sh` la LEE de aquí (no la copia):
# un hecho, un sitio. Si mañana añadimos `PASSPHRASE`, lo añadimos una vez.
# INICIO_FORMA_SECRETO
FORMA_SECRETO='(SECRET|PASSWORD|PASSWD|PASSPHRASE|TOKEN|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|SIGNING|UNSEAL|HMAC|SALT|CREDENTIAL|PEPPER|CIPHER|_KEY$|_KEYS$|_PWD$|_PASS$|_PIN$|_SEED$|_CODE$)'
# FIN_FORMA_SECRETO
# Nombres que CONTIENEN esas palabras y NO son secretos. Se acierta por defecto a
# «es secreto»: una variable de más en el manifiesto no rompe nada; una de menos
# es el agujero entero.
# S-CLASE-1 (2026-09-11): + PEPPER, CIPHER, `_PASS$`, `_PIN$`, `_SEED$`, `_CODE$`
# (seguridad plantó SMTP_PASS, ADMIN_PIN, MASTER_PEPPER, SESSION_SEED,
# RECOVERY_CODE y CLABE_CIPHER y ninguno era «secreto» para esta forma). Las
# familias no-secretas que esos sufijos arrastran (`HTTP_CODE`, `DO_SEED`…)
# van en NO_SECRETO, abajo.
# INICIO_NO_SECRETO
# `SECRETS_ENV` y compañía contienen «SECRET» y NO son secretos: son el SELECTOR de
# modo y las rutas del propio preflight. Sin esta excepción, el candado se pone rojo
# sobre `export SECRETS_ENV=desechable` — la línea con la que un entrypoint DECLARA
# que su stack es de usar y tirar. Un candado que suena por lo que no es, se apaga.
NO_SECRETO='(PUBLISHABLE|NEXT_PUBLIC_|PUBLIC_KEY|_LENGTH$|_TTL$|_DAYS$|_BYTES$|_PATH$|_FILE$|_NAME$|_ID$|GITHUB_TOKEN|GH_TOKEN|_ROTATED|_EXPIRES|^SECRETS_ENV$|^SECRETS_MANIFEST$|^SECRETS_CATALOG$|^SECRETS_PROFILE$|(HTTP|STATUS|ERROR|EXIT|COUNTRY|CURRENCY|LOCALE|LANG|LANGUAGE|ZIP|POSTAL|AREA|DIAL|ISO|REGION|STATE|SKU|CONDITION|GRADE|RETURN|RESULT|REASON|EVENT|TYPE|COLOR|COLOUR|HEX)_CODE$|^(DO|RUN|AUTO|SKIP|NO|WITH|FORCE|RANDOM|FAKER|TEST|DEMO|SYNTHETIC|O)_SEED$|(OUTLINE|FIRST|SECOND|SINGLE|MULTI|RENDER|EACH|PER)_PASS$)'
# FIN_NO_SECRETO

# --- Prefijos de secreto reconocibles ---------------------------------------
PREFIJOS_RE='(whsec_[A-Za-z0-9_]{4,}|sk_live_[A-Za-z0-9_]{4,}|sk_test_[A-Za-z0-9_]{4,}|rk_live_[A-Za-z0-9_]{4,}|rk_test_[A-Za-z0-9_]{4,}|re_[A-Za-z0-9_]{6,}|AKIA[A-Z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9-]{10,}|SG\.[A-Za-z0-9_.-]{10,}|AIza[A-Za-z0-9_-]{20,})'

# --- Ficheros ---------------------------------------------------------------
# Solo versionados: lo que no está en git no está publicado.
# `git ls-files` sobre el árbol real; `find` cuando corremos sobre una COPIA sin
# git (es lo que hace el canario: si esto no funcionara fuera de un repo, el
# candado no sería ejercitable y volveríamos a tener un candado nunca visto rojo).
listar_ficheros() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files
  else
    find . -type f -not -path './.git/*' -not -path '*/node_modules/*' | sed 's|^\./||'
  fi
}
# --- Ficheros que HABLAN de los secretos, y por eso los contienen -------------
# El candado tiene esta guarda desde el principio; el generador NO la tenía, y se
# notó en cuanto los ficheros nuevos pasaron de «sin trackear» a trackeados: los
# ocho secretos INVENTADOS del canario (`HSM_UNSEAL_KEY: ${HSM_UNSEAL_KEY:-…}`) y
# las propias expresiones del generador (`NO_SECRETO='(PUBLISHABLE|…)'`) entraron
# al manifiesto como si fueran credenciales publicadas. No lo son: son el DATO DE
# PRUEBA con el que se demuestra que el candado muerde. Registrarlos no protegía
# nada y obligaba a regenerar el manifiesto cada vez que se toca un canario —
# fricción que acaba con alguien apagando el candado.
es_autoreferente_gen() {
  case "$1" in
    scripts/gen-published-secrets-manifest.sh|scripts/secrets-preflight.sh) return 0 ;;
    scripts/webhook-secret-preflight.sh) return 0 ;;
    scripts/check-secret-defaults.sh|scripts/check-secret-defaults-canary.sh) return 0 ;;
    scripts/check-stripe-webhook-failclosed.sh|scripts/check-stripe-webhook-failclosed-canary.sh) return 0 ;;
    security/secretos-publicados.sha256|security/secretos-retirados.sha256) return 0 ;;
    security/secretos-exigidos.txt) return 0 ;;
  esac
  return 1
}
mapfile -t TODOS < <(listar_ficheros 2>/dev/null)
FILTRADOS=()
for f in "${TODOS[@]}"; do
  es_autoreferente_gen "$f" || FILTRADOS+=("$f")
done
TODOS=("${FILTRADOS[@]}")

hash_de() {  # $1 = valor  → sha256 en minúsculas
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -d' ' -f1
  else
    printf '%s' "$1" | openssl dgst -sha256 | sed 's/.*= *//'
  fi
}

# `valor_util <valor>` → rc=0 si vale la pena meterlo en el manifiesto.
valor_util() {
  local v="$1"
  [ -n "$v" ] || return 1
  [ "${#v}" -ge 4 ] || return 1                      # 3 caracteres no son un secreto
  case "$v" in
    '${'*|'$('*|'$'*)      return 1 ;;                # una referencia, no un valor
    *'${{'*)               return 1 ;;                # expresión de Actions
    'CHANGE_ME')           ;;                         # sí: es un valor publicado
  esac
  # Números puros, booleanos y palabras de configuración: no son credenciales y
  # llenarían el manifiesto de ruido.
  case "$v" in
    [0-9]*) [[ "$v" =~ ^[0-9]+$ ]] && return 1 ;;
  esac
  case "$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')" in
    true|false|null|none|production|development|staging|local|test|manual|auto|es|en|on|off) return 1 ;;
  esac
  return 0
}

TMP="$(mktemp)"; trap 'rm -f "$TMP" "$TMP.pares"' EXIT
: > "$TMP.pares"

# --- (a) Asignaciones a nombres con forma de secreto ------------------------
for f in "${TODOS[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    *.yml|*.yaml|*.sh|*.ts|*.js|*.mjs|*.cjs|*.json|*.env|.env.example|Dockerfile*|*.tf|*.toml|*.ini) ;;
    *) continue ;;
  esac
  # Binario o enorme: fuera.
  [ "$(wc -c < "$f")" -gt 2000000 ] && continue

  # Cuatro idiomas de asignación, un solo pase de awk por fichero.
  awk -v forma="$FORMA_SECRETO" -v nosec="$NO_SECRETO" '
    {
      linea = $0
      # 1) NOMBRE=valor  /  export NOMBRE=valor  (env, sh)
      if (match(linea, /(^|[ \t]|export[ \t]+)[A-Za-z_][A-Za-z0-9_]*=/)) {
        s = substr(linea, RSTART, RLENGTH)
        gsub(/^[ \t]*export[ \t]+|^[ \t]+|=$/, "", s)
        rest = substr(linea, RSTART + RLENGTH)
        emitir(s, rest)
      }
      # 2) NOMBRE: valor  (yaml/compose)
      if (match(linea, /^[ \t-]*[A-Za-z_][A-Za-z0-9_]*:[ \t]/)) {
        s = substr(linea, RSTART, RLENGTH)
        gsub(/^[ \t-]*|:[ \t]*$/, "", s)
        rest = substr(linea, RSTART + RLENGTH)
        emitir(s, rest)
      }
      # 3) ${NOMBRE:-valor}  (compose/sh: el default que gana en ausencia)
      tmp = linea
      while (match(tmp, /\$\{[A-Za-z_][A-Za-z0-9_]*:-[^}]*\}/)) {
        trozo = substr(tmp, RSTART, RLENGTH)
        tmp = substr(tmp, RSTART + RLENGTH)
        split(substr(trozo, 3, length(trozo) - 3), p, ":-")
        nom = p[1]; val = substr(trozo, index(trozo, ":-") + 2, length(trozo) - index(trozo, ":-") - 2)
        emitir(nom, val)
      }
      # 4) process.env.NOMBRE || "valor"   /   ?? "valor"   (ts/js)
      tmp2 = linea
      while (match(tmp2, /[A-Za-z_][A-Za-z0-9_]*[^A-Za-z0-9_]*(\|\||\?\?)[ \t]*["'"'"'][^"'"'"']*["'"'"']/)) {
        trozo = substr(tmp2, RSTART, RLENGTH)
        tmp2 = substr(tmp2, RSTART + RLENGTH)
        if (match(trozo, /^[A-Za-z_][A-Za-z0-9_]*/)) nom = substr(trozo, RSTART, RLENGTH); else nom = ""
        if (match(trozo, /["'"'"'][^"'"'"']*["'"'"']$/)) {
          val = substr(trozo, RSTART + 1, RLENGTH - 2)
          emitir(nom, val)
        }
      }
    }
    function emitir(nom, val,   NOM) {
      # Solo nombres de VARIABLE DE ENTORNO (MAYÚSCULA_CON_GUIONES). Sin esto, las
      # propiedades camelCase del código TS (`passwordHash: "..."`, `tokenHash: …`)
      # entran al manifiesto: ruido, y —peor— el manifiesto se desfasa cada vez que
      # backend toca una cadena suya, con lo que este candado se pondría rojo por
      # algo que no es un secreto. Un candado que suena por lo que no es, se apaga.
      if (nom !~ /^[A-Z][A-Z0-9_]*$/) return
      NOM = toupper(nom)
      if (NOM !~ forma) return
      if (NOM  ~ nosec) return
      # Limpieza del lado derecho: comentario, comillas, espacios.
      sub(/[ \t]+#.*$/, "", val)
      gsub(/^[ \t]+|[ \t\r]+$/, "", val)
      if (val ~ /^".*"$/ || val ~ /^'"'"'.*'"'"'$/) val = substr(val, 2, length(val) - 2)
      gsub(/^[ \t]+|[ \t\r]+$/, "", val)
      if (val == "") return
      print NOM "\t" val
    }
  ' "$f" >> "$TMP.pares"
done

# --- (b) Prefijos de secreto en CUALQUIER fichero versionado ----------------
for f in "${TODOS[@]}"; do
  [ -f "$f" ] || continue
  [ "$(wc -c < "$f")" -gt 4000000 ] && continue
  grep -oE "$PREFIJOS_RE" "$f" 2>/dev/null | sed 's/^/PREFIJO\t/' >> "$TMP.pares"
done

# --- Consolidar: valor → nombres que lo publican ----------------------------
declare -A PISTA
while IFS=$'\t' read -r nom val; do
  [ -n "${val:-}" ] || continue
  valor_util "$val" || continue
  if [ -z "${PISTA[$val]+x}" ]; then
    PISTA[$val]="$nom"
  elif [[ " ${PISTA[$val]} " != *" $nom "* ]]; then
    PISTA[$val]="${PISTA[$val]} $nom"
  fi
done < "$TMP.pares"

# --- Unión con los jubilados ------------------------------------------------
: > "$TMP.union"
if [ -f "$RETIRADOS" ]; then
  grep '^[0-9a-f]' "$RETIRADOS" >> "$TMP.union" 2>/dev/null || true
fi

{
  cat <<'CAB'
# security/secretos-publicados.sha256 — GENERADO. No editar a mano.
#   Regenerar:  ./scripts/gen-published-secrets-manifest.sh
#   Verificar:  ./scripts/gen-published-secrets-manifest.sh --check
#
# Cada línea es el sha256 de un valor que ESTE REPOSITORIO PUBLICA, más una pista
# con el/los nombres de variable bajo los que aparece. El repositorio es público
# (medido por seguridad: HTTP 200 sin credenciales), así que cada uno de estos
# valores lo tiene también cualquiera que lo clone.
#
# Para qué sirve: `scripts/secrets-preflight.sh` y `scripts/webhook-secret-preflight.sh`
# hashean el valor que traiga el entorno y ABORTAN si sale aquí. Es identidad, no
# heurística: cubre `whsec_e2e_test_secret` (que no contiene ninguna palabra
# sospechosa) exactamente igual que `whsec_staging_dummy`.
#
# Se guarda el HASH y no el valor para no dejar una lista de la compra ordenada.
CAB
  {
    for val in "${!PISTA[@]}"; do
      printf '%s  %s\n' "$(hash_de "$val")" "${PISTA[$val]}"
    done
    cat "$TMP.union"
  } | LC_ALL=C sort -u -k1,1
} > "$TMP"

TOTAL="$(grep -c '^[0-9a-f]' "$TMP" || true)"

# Las claves del servicio `backend` cuyo valor referencia un `${VAR:?}`: los nombres
# tal como los ve el proceso DENTRO del contenedor. Se define ANTES del bloque
# `--check` porque ese bloque la usa — definida después, `--check` moría con
# «command not found» y declaraba desfasado un catálogo que estaba bien.
contenedor_exigidos() {
  for f in docker-compose*.yml; do
    [ -f "$f" ] || continue
    awk '
      /^  [A-Za-z_][A-Za-z0-9_-]*:[ \t]*$/ { svc = $1; sub(/:$/, "", svc); inenv = 0 }
      /^    environment:[ \t]*$/            { if (svc == "backend") inenv = 1; next }
      /^    [A-Za-z_]/                      { inenv = 0 }
      inenv && /^      [A-Za-z_][A-Za-z0-9_]*:/ {
        if ($0 ~ /\$\{[A-Za-z_][A-Za-z0-9_]*:\?/) {
          k = $1; sub(/:$/, "", k); print k
        }
      }
    ' "$f"
  done | LC_ALL=C sort -u
}

if [ "$MODO" = "--check" ]; then
  if [ ! -f "$DESTINO" ]; then
    printf '\033[1;31m✗ Falta %s. Genéralo con ./scripts/gen-published-secrets-manifest.sh\033[0m\n' "$DESTINO" >&2
    exit 1
  fi
  # SOLO se comprueba una dirección, y la asimetría es deliberada.
  #   · El manifiesto siendo SUPERCONJUNTO del árbol es SEGURO: sobra un hash, o sea
  #     que se rechaza un valor de más. Pasa cada vez que alguien LIMPIA un literal
  #     de su código — y una limpieza no puede poner el CI en rojo, porque entonces
  #     la gente deja de limpiar (o apaga el candado, que es peor).
  #   · El manifiesto siendo SUBCONJUNTO es el agujero: hay un literal en el árbol
  #     que ningún preflight rechaza. Eso sí es rojo.
  FALTAN="$(comm -23 <(grep -o '^[0-9a-f]*' "$TMP" | LC_ALL=C sort -u) \
                     <(grep -o '^[0-9a-f]*' "$DESTINO" | LC_ALL=C sort -u))"
  if [ -n "$FALTAN" ]; then
    N_FALTAN="$(printf '%s\n' "$FALTAN" | grep -c .)"
    printf '\033[1;31m✗ %s NO cubre %s literal(es) que hay en el árbol.\033[0m\n' "$DESTINO" "$N_FALTAN" >&2
    printf '  Alguien commiteó un literal de secreto y no regeneró el manifiesto. Mientras\n' >&2
    printf '  esté fuera, ese valor NO lo rechaza ningún preflight: sirve en un entorno real.\n' >&2
    printf '  Arreglo:  ./scripts/gen-published-secrets-manifest.sh && git add %s\n\n' "$DESTINO" >&2
    for h in $FALTAN; do
      printf '    %s  %s\n' "$h" "$(grep -m1 "^$h  " "$TMP" | sed 's/^[0-9a-f]*  //')" >&2
    done
    exit 1
  fi
  # El catálogo tiene que reflejar los `:?` de hoy: si un secreto nuevo no está en
  # él, el preflight del contenedor no lo exigiría en Railway.
  ESPERADO="$(for f in docker-compose*.yml; do [ -f "$f" ] || continue; sed -n 's/.*\${\([A-Z][A-Z0-9_]*\):?.*/\1/p' "$f"; done | LC_ALL=C sort -u)"
  ACTUAL="$(grep -v '^#' "$CATALOGO" 2>/dev/null | grep -v '^$' | LC_ALL=C sort -u)"
  if [ "$ESPERADO" != "$ACTUAL" ]; then
    printf '\033[1;31m✗ %s no coincide con los \${VAR:?} de los compose.\033[0m\n' "$CATALOGO" >&2
    printf '  En la imagen del backend NO hay compose: ese fichero es el ÚNICO blanco que\n' >&2
    printf '  tiene el preflight al arrancar en Railway. Desfasado = candado sin blanco.\n' >&2
    printf '  Arreglo:  ./scripts/gen-published-secrets-manifest.sh\n' >&2
    diff <(printf '%s\n' "$ACTUAL") <(printf '%s\n' "$ESPERADO") | head -10 >&2
    exit 1
  fi
  # El catálogo del CONTENEDOR es el que decide si el backend ARRANCA. Si está
  # desfasado, el entrypoint exige variables que no existen ahí dentro (o deja de
  # exigir las que sí) y el contenedor muere sin servir nada.
  ESP_C="$(contenedor_exigidos)"
  ACT_C="$(grep -v '^#' "$CATALOGO_CONT" 2>/dev/null | grep -v '^$' | LC_ALL=C sort -u)"
  if [ "$ESP_C" != "$ACT_C" ]; then
    printf '\033[1;31m✗ %s no coincide con las claves del servicio backend.\033[0m\n' "$CATALOGO_CONT" >&2
    printf '  Ese fichero es el ÚNICO blanco del preflight DENTRO de la imagen, y sus nombres\n' >&2
    printf '  son los del CONTENEDOR, no los del host. Desfasado ⇒ el backend no arranca.\n' >&2
    printf '  Arreglo:  ./scripts/gen-published-secrets-manifest.sh\n' >&2
    diff <(printf '%s\n' "$ACT_C") <(printf '%s\n' "$ESP_C") | head -10 >&2
    exit 1
  fi
  printf '\033[1;32m✓ %s al día (%s valores publicados); %s exigidos en el host, %s en el contenedor.\033[0m\n' \
    "$DESTINO" "$TOTAL" "$(printf '%s\n' "$ACTUAL" | grep -c .)" "$(printf '%s\n' "$ACT_C" | grep -c .)"
  exit 0
fi

mkdir -p "$(dirname "$DESTINO")"
# Jubilación: lo que estaba en el manifiesto anterior y ya no sale del árbol ni
# figura entre los jubilados, se apunta ahora — con la fecha en que se midió que
# salía del árbol (O-5: un apunte sin fecha de medición no afirma nada).
if [ -f "$DESTINO" ]; then
  JUB=0
  while read -r h resto; do
    case "$h" in ''|'#'*) continue ;; esac
    if ! grep -q "^$h  " "$TMP" 2>/dev/null; then
      if [ ! -f "$RETIRADOS" ]; then
        {
          echo "# security/secretos-retirados.sha256 — APPEND-ONLY. Generado por"
          echo "#   scripts/gen-published-secrets-manifest.sh"
          echo "#"
          echo "# Valores que ESTUVIERON publicados en este repositorio público y que ya no"
          echo "# están en el árbol de trabajo. Siguen en el historial de git, en los forks y"
          echo "# en la caché de quien clonó: siguen siendo públicos. Se jubilan aquí para que"
          echo "# el rechazo en runtime NO se debilite cuando alguien limpia su código."
          echo "#"
          echo "# No se borra ninguna línea de este fichero."
        } > "$RETIRADOS"
      fi
      printf '%s  %s (retirado del arbol %s)\n' "$h" "$resto" "$(date -u +%Y-%m-%d)" >> "$RETIRADOS"
      JUB=$((JUB+1))
    fi
  done < "$DESTINO"
  if [ "$JUB" -gt 0 ]; then
    printf '  · %s valor(es) salieron del árbol y se JUBILARON en %s (siguen rechazándose).\n' "$JUB" "$RETIRADOS"
    # Se regenera para que el manifiesto incluya ya a los recién jubilados.
    exec "$0" write
  fi
fi
cp "$TMP" "$DESTINO"

# --- Catálogo de exigidos ----------------------------------------------------
{
  echo "# security/secretos-exigidos.txt — GENERADO. No editar a mano."
  echo "#   Regenerar: ./scripts/gen-published-secrets-manifest.sh"
  echo "#"
  echo "# Los secretos que los docker-compose*.yml EXIGEN con \${VAR:?}. No es una"
  echo "# lista escrita a mano: se deriva del compose, así que el secreto que alguien"
  echo "# añada mañana entra solo. Viaja en la imagen del backend para que"
  echo "# \`secrets-preflight.sh assert\` tenga BLANCO también en Railway, donde no hay"
  echo "# ficheros de compose."
  for f in docker-compose*.yml; do
    [ -f "$f" ] || continue
    sed -n 's/.*\${\([A-Z][A-Z0-9_]*\):?.*/\1/p' "$f"
  done | LC_ALL=C sort -u
} > "$CATALOGO"

# --- Catálogo del CONTENEDOR -------------------------------------------------
# Las claves del servicio `backend` cuyo valor referencia un `${VAR:?}`. Son las
# que, si el host resolvió bien, llegan al contenedor con valor; y si alguna llega
# vacía, el arranque tiene que fallar ruidoso en vez de servir una API a medias.
{
  echo "# security/secretos-exigidos-contenedor.txt — GENERADO. No editar a mano."
  echo "#   Regenerar: ./scripts/gen-published-secrets-manifest.sh"
  echo "#"
  echo "# Los nombres tal como los ve el proceso DENTRO del contenedor, que NO son los"
  echo "# del host. En \`JWT_ACCESS_SECRET: \${STAGING_JWT_ACCESS_SECRET:?…}\` el de la"
  echo "# izquierda es el del contenedor y el de la derecha el del host. Meter la lista"
  echo "# del host en la imagen hizo que 12 de 15 «faltaran», el entrypoint abortara y"
  echo "# el backend muriera sin emitir nada (run 34531002011)."
  contenedor_exigidos
} > "$CATALOGO_CONT"
printf '\033[1;32m✓ %s regenerado: %s valores publicados por el repo.\033[0m\n' "$DESTINO" "$TOTAL"
exit 0

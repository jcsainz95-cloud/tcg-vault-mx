#!/usr/bin/env bash
#
# check-secret-defaults.sh — «ningún secreto puede tener un valor escrito en el
# repo, se llame como se llame»                                        · devops
# =============================================================================
# EL HALLAZGO QUE ORIGINA ESTE CANDADO — S-88-1 (ALTA, bloqueaba el release)
# ---------------------------------------------------------------------------
# P-WH-1 se cerró para `STRIPE_WEBHOOK_SECRET`. Seguridad midió, TRES LÍNEAS MÁS
# ARRIBA del mismo fichero, otros siete secretos con la forma idéntica:
#
#     JWT_ACCESS_SECRET   JWT_REFRESH_SECRET   PII_ENCRYPTION_KEY   PII_HMAC_KEY
#     SEED_ADMIN_PASSWORD (StagingAdmin123!)   Postgres   MinIO
#
# …y midió también que el repositorio es PÚBLICO (`"private": false`, HTTP 200 sin
# credenciales). Con el secreto JWT publicado firmó un `super_admin` — las tres
# rutas `@MoneyOut`. Con la clave PII publicada descifró una CLABE sintética
# usando **solo el literal del repo**. Su diagnóstico, que es lo que este fichero
# intenta no volver a merecer:
#
#     ► «la cirugía fue a una variable, no a la clase.»
#
# POR QUÉ ESTE CANDADO NO ES «SIETE COMPROBACIONES»
# ---------------------------------------------------------------------------
# Porque un candado que conociera las siete variables tendría exactamente el mismo
# defecto que el arreglo que critica: el OCTAVO secreto que alguien escriba mañana
# no estaría en su lista y nacería roto, en silencio, igual que nació el séptimo.
#
# Por eso este candado **no conoce ninguna variable**. Conoce una FORMA DE NOMBRE
# (`…SECRET`, `…PASSWORD`, `…TOKEN`, `…_KEY`, `…HMAC`, `…SALT`…) y una FORMA DE
# ASIGNACIÓN prohibida (un literal no vacío como valor o como respaldo). Cualquier
# variable que alguien invente mañana y que se llame como se llaman los secretos
# queda cubierta el día que se escribe, sin tocar este fichero.
#
# LAS TRES FORMAS ADMITIDAS (y por qué solo estas tres)
# ---------------------------------------------------------------------------
#   1. `${VAR:?mensaje}`  — obligatoria. Si falta, no arranca y lo dice. Es la
#      única forma en la que la AUSENCIA no degrada a algo que no protege.
#   2. `${VAR:-}` / `VAR=` — vacío DECLARADO. Es incapacitación deliberada: sin
#      valor, la función que depende de él se apaga (no se «apaña»).
#      (S-CLASE-1, 2026-09-11: lo prohibido es el DEFAULT con literal en
#      CUALQUIERA de sus grafías — `${VAR:-lit}`, `${VAR-lit}`, `${VAR:=lit}`,
#      `${VAR=lit}` —, la asignación `VAR=lit` con o sin `export`/`declare -x`/
#      `ENV`, dentro de un `echo … >> .env` o en una lista `- VAR=lit` de compose,
#      y un `.env.*` versionado que no sea `.env.example`. Los 7 casos que
#      seguridad midió escapando están en el canario.)
#   3. En `.env.example`, y solo ahí: un placeholder AUTO-DELATOR (`CHANGE_ME`,
#      `dummy`…). `.env.example` es una plantilla que se copia; un placeholder que
#      parece un secreto de verdad es el que nadie cambia.
#
#   Lo prohibido es siempre lo mismo: **un valor que sirva y que esté escrito en
#   un fichero versionado de un repositorio público.**
#
# EL LADO DEL VALOR, QUE ESTE CANDADO NO PUEDE VER SOLO
# ---------------------------------------------------------------------------
# Un candado estático no distingue un secreto de un no-secreto: para un HMAC toda
# cadena es válida. Por eso el bloque (E) exige que `security/secretos-publicados.sha256`
# esté al día — ese manifiesto es lo que permite a los preflights rechazar EN
# RUNTIME un valor publicado aunque venga del gestor de secretos y aunque no se
# parezca a un dummy. Sin manifiesto al día, el lado del valor no existe.
#
# QUÉ NO HACE, A PROPÓSITO
#   · No comprueba que las variables existan en Railway/Vercel: no es medible
#     desde el repo (DEVOPS_NOTES §49.1). Eso lo hace el preflight al arrancar.
#   · No borra los literales de `backend/` ni `frontend/`: no son ruta de devops.
#     Los INVENTARÍA (bloque F) y exige que estén NEUTRALIZADOS por el manifiesto.
#
# Uso:
#   ./scripts/check-secret-defaults.sh [--root DIR]
# Sale 0 si la clase está cerrada; 1 con el fichero:línea exacto.
# Barato: sin red, sin Docker, sin node.
#
# Que este candado MUERDE se demuestra con:
#   scripts/check-secret-defaults-canary.sh   (planta secretos INVENTADOS)
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ] && [ -n "${2:-}" ]; then
  ROOT_DIR="$(cd "$2" && pwd)"
fi
cd "$ROOT_DIR" || exit 2

FALLOS=0
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }
nota() { printf '      %s\n' "$*"; }

# --- La FORMA de un nombre de secreto: fuente única -------------------------
# Se LEE del generador del manifiesto (no se copia): un hecho, un sitio. Si mañana
# añadimos `PASSPHRASE` a la familia, se añade allí y este candado lo hereda.
GEN="scripts/gen-published-secrets-manifest.sh"
if [ -f "$GEN" ]; then
  FORMA_SECRETO="$(sed -n "s/^FORMA_SECRETO='\(.*\)'$/\1/p" "$GEN")"
  NO_SECRETO="$(sed -n "s/^NO_SECRETO='\(.*\)'$/\1/p" "$GEN")"
fi
if [ -z "${FORMA_SECRETO:-}" ] || [ -z "${NO_SECRETO:-}" ]; then
  printf '\033[1;31m✗ No pude leer FORMA_SECRETO/NO_SECRETO de %s.\033[0m\n' "$GEN" >&2
  printf '  Sin la forma, este candado no sabe qué es un secreto: eso YA es el rojo.\n' >&2
  exit 1
fi

es_nombre_de_secreto() {
  # Solo nombres de VARIABLE DE ENTORNO (MAYUSCULA_CON_GUIONES). Sin esto, la clave
  # YAML `secrets: inherit` de un workflow entra como «secreto con literal»: un rojo
  # por algo que no es el bug. Un candado que suena por lo que no es, se apaga.
  [[ "$1" =~ ^[A-Z][A-Z0-9_]*$ ]] || return 1
  local n; n="$1"
  [[ "$n" =~ $FORMA_SECRETO ]] || return 1
  [[ "$n" =~ $NO_SECRETO ]] && return 1
  return 0
}

# --- Placeholders auto-delatores (solo válidos en .env.example) -------------
PATRONES_PUBLICOS="$(sed -n "s/^PATRONES_PUBLICOS='\(.*\)'$/\1/p" scripts/webhook-secret-preflight.sh 2>/dev/null)"
[ -n "$PATRONES_PUBLICOS" ] || PATRONES_PUBLICOS='dummy placeholder change_me changeme fake sample example'
es_autodelator() {
  local v; v="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  for p in $PATRONES_PUBLICOS; do [[ "$v" == *"$p"* ]] && return 0; done
  return 1
}

# Un valor que NO ES un valor: el hueco de una instrucción de ayuda
# (`export STRIPE_TEST_SECRET_KEY=sk_test_…`). No se puede usar para nada, y
# prohibir que la documentación enseñe la FORMA de un secreto sería prohibir
# explicar cómo se configura.
es_hueco() {
  case "$1" in
    *…*|*'<'*|*'>'*|*'***'*|*XXXX*|*xxxx*) return 0 ;;
  esac
  return 1
}

# --- Ficheros que HABLAN del candado ----------------------------------------
# Contienen los patrones prohibidos como ejemplo o como dato. Si no se excluyen,
# el candado se pone rojo por documentarse a sí mismo — y entonces la gente deja
# de documentar, que es peor que el bug.
es_autoreferente() {
  case "$1" in
    scripts/check-secret-defaults.sh|scripts/check-secret-defaults-canary.sh) return 0 ;;
    scripts/gen-published-secrets-manifest.sh|scripts/secrets-preflight.sh) return 0 ;;
    scripts/webhook-secret-preflight.sh) return 0 ;;
    scripts/check-stripe-webhook-failclosed.sh|scripts/check-stripe-webhook-failclosed-canary.sh) return 0 ;;
    security/scripts/sast-gitleaks-canary.sh) return 0 ;;   # planta claves de FICCIÓN por construcción (§56)
    security/secretos-publicados.sha256|security/gitleaks.toml|security/semgrep.yml) return 0 ;;
    *.md) return 0 ;;
  esac
  return 1
}

# --- El punto ciego de una regla basada en NOMBRES ---------------------------
# `DATABASE_URL` no se llama como un secreto y lleva uno dentro:
#     postgresql://tcg:tcg_local_dev_password@localhost:5432/…
# Una regla que solo mira nombres no lo ve nunca. Esta mira la FORMA DEL VALOR:
# una URL con `usuario:contraseña@` es una credencial, se llame la variable como
# se llame. Las dos reglas se cubren los huecos la una a la otra.
tiene_credencial_en_url() {
  [[ "$1" =~ [a-z][a-z0-9+.-]*://[^:/@[:space:]]+:[^@/[:space:]]+@ ]] || return 1
  # `${VAR}` dentro de la URL no es un literal: es la forma correcta.
  [[ "$1" =~ ://[^@[:space:]]*\$ ]] && return 1
  return 0
}

# `limpio <fichero>` → el fichero sin comentarios de línea completa, conservando
# el número de línea (`sed` sustituye por vacío en vez de borrar).
limpio() { sed 's/^[[:space:]]*#.*$//' "$1"; }

# --- S-CLASE-1: la FORMA del default, en todas sus grafías ------------------
# `${VAR:-lit}` era la única que se miraba. Seguridad plantó `${VAR-lit}` (un
# guion, sin `:`; Compose y sh lo aceptan) y `${VAR:=lit}` / `${VAR=lit}`
# (asignar-por-defecto) y las tres escaparon. Es el mismo bug con otra tilde:
# un literal que GANA cuando la variable falta.
RE_DEFAULT='\$\{([A-Za-z_][A-Za-z0-9_]*)(:-|:=|-|=)([^}]*)\}'

# `defaults_con_literal <linea>` → imprime «VAR<TAB>valor» por cada default con
# literal NO vacío y NO referencia (`$…`) que haya en la línea.
defaults_con_literal() {
  local resto="$1" var val
  while [[ "$resto" =~ $RE_DEFAULT ]]; do
    var="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[3]}"
    resto="${resto#*"${BASH_REMATCH[0]}"}"
    [ -z "$val" ] && continue
    [[ "$val" == *'$'* ]] && continue          # `${A:-$B}` es una referencia, no un literal
    printf '%s\t%s\n' "$var" "$val"
  done
}

# `asignaciones_peladas <linea>` → «VAR<TAB>valor» por cada `VAR=valor` con
# literal usable en la línea, esté donde esté: al principio (`LEDGER_HMAC=lit`,
# sin `export`), tras `declare -x`/`readonly`/`local`, o dentro de un
# `echo "VAR=lit" >> /app/.env` (el caso 6 de seguridad: el Dockerfile
# fabricándose un `.env`). Se descartan referencias, huecos, placeholders
# auto-delatores, formatos (`%s`) y `0`/`1`/booleanos.
asignaciones_peladas() {
  local resto="$1" var val
  while [[ "$resto" =~ (^|[[:space:]\"\x27])([A-Za-z_][A-Za-z0-9_]*)=([^[:space:]\"\x27\;\)\&\|]*) ]]; do
    var="${BASH_REMATCH[2]}"; val="${BASH_REMATCH[3]}"
    resto="${resto#*"${BASH_REMATCH[0]}"}"
    [ -n "$val" ] || continue
    [[ "$val" == *'$'* || "$val" == *'%'* ]] && continue
    case "$val" in 0|1|true|false|null|none|'('*) continue ;; esac   # `ARR=(` es un array, no un valor
    es_hueco "$val" && continue
    es_autodelator "$val" && continue
    printf '%s\t%s\n' "$var" "$val"
  done
}

printf '\n\033[1m== ¿Queda algún secreto con valor escrito en el repo? (S-88-1, la CLASE) ==\033[0m\n'

# =============================================================================
# (0) LOS DIENTES DEL CANDADO — que no se los pueda quitar quien no quiera el rojo
# =============================================================================
# `FORMA_SECRETO` se lee de otro fichero, y eso abre una salida que el canario
# encontró: quien tenga prisa puede vaciar la forma («`(NOMBRE_QUE_NO_EXISTE)`»),
# y entonces este candado deja de reconocer cualquier secreto y se queda VERDE con
# el árbol lleno de literales. Sería la misma avería que persigue —un control que
# degrada en silencio a cero— una capa más arriba.
#
# Por eso el candado se muerde a sí mismo antes de empezar: sondas fijas, escritas
# AQUÍ, que tienen que clasificarse bien. No dependen de la forma; la comprueban.
printf '\n\033[1m(0) El candado reconoce lo que dice reconocer\033[0m\n'
DIENTES=0
for sonda in FOO_SECRET FOO_PASSWORD FOO_TOKEN FOO_API_KEY FOO_HMAC FOO_SALT FOO_PRIVATE_KEY FOO_CREDENTIAL; do
  if ! es_nombre_de_secreto "$sonda"; then
    mal "El candado NO reconoce \`$sonda\` como secreto."
    nota "Alguien estrechó FORMA_SECRETO en $GEN. Con la forma amputada, este candado"
    nota "se queda verde sobre un árbol lleno de literales: exactamente el bug que persigue."
    DIENTES=$((DIENTES+1))
  fi
done
for sonda in PORT FOO_PUBLISHABLE_KEY NEXT_PUBLIC_FOO_KEY MIN_JWT_SECRET_LENGTH FOO_KEY_PATH; do
  if es_nombre_de_secreto "$sonda"; then
    mal "El candado toma \`$sonda\` por un secreto: se pondrá rojo sobre lo que no lo es."
    nota "Un candado que suena por lo que no es, se apaga — y entonces no suena por lo que sí."
    DIENTES=$((DIENTES+1))
  fi
done
[ "$DIENTES" -eq 0 ] && ok "8 sondas de secreto reconocidas y 5 no-secretos descartados."


# =============================================================================
# (A) COMPOSE — el sitio exacto del hallazgo
# =============================================================================
printf '\n\033[1m(A) docker-compose*.yml — ni defaults literales ni valores pelados\033[0m\n'
A_MAL=0
for f in docker-compose*.yml; do
  [ -f "$f" ] || continue
  es_autoreferente "$f" && continue
  n=0
  while IFS= read -r linea; do
    n=$((n+1))
    [[ "$linea" =~ ^[[:space:]]*# ]] && continue

    # A.1 — `${VAR:-valor}` / `${VAR-valor}` / `${VAR:=valor}` / `${VAR=valor}`
    # con valor NO vacío. ESTA es la forma del hallazgo (en sus cuatro grafías).
    while IFS=$'\t' read -r var val; do
      [ -n "$var" ] || continue
      if es_nombre_de_secreto "$var"; then
        mal "$f:$n — \`\${$var…$val}\` entrega un literal cuando la variable falta."
        nota "Es la forma de S-88-1: el valor del repo GANA justo cuando el operador creyó configurarlo."
        nota "Formas admitidas: \`\${$var:?mensaje}\` (obligatoria) o \`\${$var:-}\` (vacío declarado)."
        A_MAL=$((A_MAL+1))
      fi
    done < <(defaults_con_literal "$linea")

    # A.2 — `CLAVE: literal` (sin `${…}`): un secreto escrito a pelo.
    if [[ "$linea" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*):[[:space:]]+(.+)$ ]]; then
      clave="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
      val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
      if es_nombre_de_secreto "$clave" && [ -n "$val" ] && [[ "$val" != *'$'* ]]; then
        mal "$f:$n — \`$clave\` lleva un literal escrito a pelo."
        A_MAL=$((A_MAL+1))
      fi
    fi

    # A.3 — `environment:` en forma de LISTA: `- CLAVE=literal` (S-CLASE-1 caso 7).
    # La forma de mapa (`CLAVE: valor`) la ve A.2; ésta se escapaba entera.
    if [[ "$linea" =~ ^[[:space:]]*-[[:space:]]*[\"\']?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      clave="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
      val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
      if es_nombre_de_secreto "$clave" && [ -n "$val" ] && [[ "$val" != *'$'* ]]; then
        mal "$f:$n — \`- $clave=…\` (lista de environment) lleva un literal escrito a pelo."
        A_MAL=$((A_MAL+1))
      fi
    fi
  done < <(cat "$f")
done
[ "$A_MAL" -eq 0 ] && ok "Ningún compose entrega un valor de secreto: todos exigen (\`:?\`) o declaran vacío."

# =============================================================================
# (B) WORKFLOWS — el respaldo `|| 'literal'` es el mismo bug con otra sintaxis
# =============================================================================
printf '\n\033[1m(B) .github/workflows/ — ni literales ni respaldo \`|| '"'"'…'"'"'\`\033[0m\n'
B_MAL=0
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$f" ] || continue
  n=0
  while IFS= read -r linea; do
    n=$((n+1))
    [[ "$linea" =~ ^[[:space:]]*# ]] && continue
    [[ "$linea" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*):[[:space:]]+(.+)$ ]] || continue
    clave="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    es_nombre_de_secreto "$clave" || continue
    val="${val%%#*}"; val="${val%"${val##*[![:space:]]}"}"
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    [ -z "$val" ] && continue

    # B.1 — `${{ secrets.X || 'literal' }}`: el literal gana EN AUSENCIA del secret.
    if [[ "$val" =~ \$\{\{[^}]*(\|\||\&\&)[[:space:]]*[\'\"][^\'\"]+[\'\"] ]]; then
      mal "$f:$n — \`$clave\` tiene respaldo literal dentro de \`\${{ … }}\`."
      nota "Si el secret no está configurado, gana el literal del repo — sin avisar. Ese es el bug."
      nota "Usa \`\${{ secrets.X }}\` a secas y resuelve la ausencia con scripts/secrets-preflight.sh."
      B_MAL=$((B_MAL+1)); continue
    fi
    # B.2 — literal pelado.
    if [[ "$val" != *'${{'* ]] && [[ "$val" != *'${'* ]] && [[ "$val" != '$'* ]]; then
      mal "$f:$n — \`$clave: $val\` es un secreto escrito en el repo."
      nota "En CI usa \`./scripts/secrets-preflight.sh github-env >> \"\$GITHUB_ENV\"\`: aleatorio por corrida."
      B_MAL=$((B_MAL+1))
    fi
  done < <(cat "$f")
done
[ "$B_MAL" -eq 0 ] && ok "Ningún workflow escribe un secreto ni deja un respaldo literal."

# =============================================================================
# (C) scripts/ y Dockerfile* — el mismo idioma, en shell
# =============================================================================
printf '\n\033[1m(C) scripts/ y Dockerfile* — ni \`\${VAR:-literal}\` ni \`export VAR=literal\`\033[0m\n'
C_MAL=0
mapfile -t CFILES < <(ls scripts/*.sh security/scripts/*.sh Dockerfile* 2>/dev/null)
for f in "${CFILES[@]:-}"; do
  [ -f "$f" ] || continue
  es_autoreferente "$f" && continue
  n=0
  while IFS= read -r linea; do
    n=$((n+1))
    [[ "$linea" =~ ^[[:space:]]*# ]] && continue

    # `${VAR:-lit}` / `${VAR-lit}` / `${VAR:=lit}` / `${VAR=lit}` — incluido el
    # idioma `: "${VAR:=lit}"` (S-CLASE-1 casos 1-3).
    while IFS=$'\t' read -r var val; do
      [ -n "$var" ] || continue
      if es_nombre_de_secreto "$var"; then
        mal "$f:$n — \`\${$var…$val}\` entrega un literal cuando la variable falta."
        nota "Un arnés que se apaña con un secreto del repo es un arnés que prueba otra cosa."
        C_MAL=$((C_MAL+1))
      fi
    done < <(defaults_con_literal "$linea")

    # `export VAR=literal` / `ENV VAR=literal` / `ARG VAR=literal`
    if [[ "$linea" =~ ^[[:space:]]*(export|ENV|ARG)[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      var="${BASH_REMATCH[2]}"; val="${BASH_REMATCH[3]}"
      val="${val%%[[:space:]]#*}"                     # comentario al final de la línea
      val="${val%"${val##*[![:space:]]}"}"
      val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
      if es_nombre_de_secreto "$var" && [ -n "$val" ] && [[ "$val" != *'$'* ]] && ! es_hueco "$val"; then
        mal "$f:$n — \`$var=$val\` es un secreto escrito en el repo."
        C_MAL=$((C_MAL+1))
      fi
    # …y la misma asignación SIN `export`, tras `declare -x`/`readonly`/`local`, o
    # dentro de un `echo "VAR=lit" >> /app/.env` (S-CLASE-1 casos 6 y 8). El
    # `export` no es lo que hace público el valor: lo hace el repositorio.
    else
      while IFS=$'\t' read -r var val; do
        [ -n "$var" ] || continue
        if es_nombre_de_secreto "$var"; then
          mal "$f:$n — \`$var=$val\` es un secreto escrito en el repo (sin \`export\` sigue siendo un valor publicado)."
          C_MAL=$((C_MAL+1))
        fi
      done < <(asignaciones_peladas "$linea")
    fi
  done < <(cat "$f")
done
[ "$C_MAL" -eq 0 ] && ok "Ningún script ni Dockerfile lleva un secreto escrito."

# =============================================================================
# (C-bis) URLs con credenciales embebidas — el punto ciego de mirar nombres
# =============================================================================
printf '\n\033[1m(C-bis) Ninguna URL versionada lleva \`usuario:contrasena@\` escrito\033[0m\n'
CB_MAL=0
mapfile -t UFILES < <(ls docker-compose*.yml scripts/*.sh security/scripts/*.sh Dockerfile* .env.example 2>/dev/null; ls .github/workflows/*.yml 2>/dev/null)
for f in "${UFILES[@]:-}"; do
  [ -f "$f" ] || continue
  es_autoreferente "$f" && continue
  n=0
  while IFS= read -r linea; do
    n=$((n+1))
    [[ "$linea" =~ ^[[:space:]]*# ]] && continue
    if tiene_credencial_en_url "$linea"; then
      # Un placeholder que se delata (`CHANGE_ME…`, `dummy…`) dentro de la URL no es
      # una credencial: es el hueco donde va. Mismo criterio que el bloque (D).
      clave_url=""
      if [[ "$linea" =~ ://[^:/@[:space:]]+:([^@/[:space:]]+)@ ]]; then clave_url="${BASH_REMATCH[1]}"; fi
      es_autodelator "$clave_url" && continue
      mal "$f:$n — una URL con credencial escrita dentro."
      nota "El nombre de la variable puede no sonar a secreto (\`DATABASE_URL\`) y llevar una."
      nota "Interpola: \`postgresql://usuario:\${SU_PASSWORD}@host/base\`."
      CB_MAL=$((CB_MAL+1))
    fi
  done < <(cat "$f")
done
[ "$CB_MAL" -eq 0 ] && ok "Ninguna URL versionada lleva credenciales dentro."

# =============================================================================
# (D) .env.example — plantilla: vacío o placeholder que se delata
# =============================================================================
printf '\n\033[1m(D) .env.example — un placeholder que parece un secreto es el que nadie cambia\033[0m\n'
D_MAL=0
if [ -f .env.example ]; then
  n=0
  while IFS= read -r linea; do
    n=$((n+1))
    [[ "$linea" =~ ^[[:space:]]*# ]] && continue
    [[ "$linea" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    var="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    es_nombre_de_secreto "$var" || continue
    [ -z "$val" ] && continue
    if ! es_autodelator "$val"; then
      mal ".env.example:$n — \`$var\` trae un valor que NO se delata como placeholder."
      nota "Se copia a \`.env\` tal cual: el operador lo da por configurado y arranca con un valor público."
      nota "Déjalo vacío, o pon un placeholder con \`CHANGE_ME\`/\`dummy\` en el valor."
      D_MAL=$((D_MAL+1))
    fi
  done < .env.example
else
  mal "No existe .env.example."
  D_MAL=1
fi
[ "$D_MAL" -eq 0 ] && ok "Todos los secretos de la plantilla están vacíos o se delatan como placeholder."

# D.2 — cualquier OTRO `.env*` versionado (S-CLASE-1 caso 5): `.env.staging`,
# `.env.production`… no son plantillas, son entornos. Uno versionado con un
# secreto dentro es un secreto publicado, se llame como se llame el fichero.
printf '\n\033[1m(D.2) Ningún .env.* versionado (salvo .env.example) lleva un secreto\033[0m\n'
D2_MAL=0; D2_VISTOS=0
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mapfile -t ENVFILES < <(git ls-files -z '.env*' '*/.env*' 2>/dev/null | tr '\0' '\n' | grep -v node_modules || true)
else
  mapfile -t ENVFILES < <(find . -maxdepth 3 -name '.env*' -type f -not -path '*/node_modules/*' -not -path './.git/*' 2>/dev/null | sed 's|^\./||' || true)
fi
for f in "${ENVFILES[@]:-}"; do
  [ -n "$f" ] && [ -f "$f" ] || continue
  case "$f" in .env.example|*/.env.example) continue ;; esac
  D2_VISTOS=$((D2_VISTOS+1))
  n=0
  while IFS= read -r linea; do
    n=$((n+1))
    [[ "$linea" =~ ^[[:space:]]*# ]] && continue
    [[ "$linea" =~ ^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    var="${BASH_REMATCH[2]}"; val="${BASH_REMATCH[3]}"
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    es_nombre_de_secreto "$var" || continue
    [ -z "$val" ] && continue
    [[ "$val" == *'$'* ]] && continue
    es_autodelator "$val" && continue
    mal "$f:$n — \`$var\` con valor en un fichero de entorno VERSIONADO."
    nota "Un \`.env.*\` en git no es una plantilla: es un entorno publicado. Sácalo del repo (y del historial) y deja solo \`.env.example\`."
    D2_MAL=$((D2_MAL+1))
  done < "$f"
done
if [ "$D2_MAL" -eq 0 ]; then
  if [ "$D2_VISTOS" -eq 0 ]; then ok "No hay ningún .env.* versionado aparte de .env.example."
  else ok "$D2_VISTOS fichero(s) .env.* versionados, ninguno con un secreto usable (revisa igual por qué están en git)."; fi
fi

# =============================================================================
# (E) El manifiesto de valores publicados, al día
# =============================================================================
printf '\n\033[1m(E) security/secretos-publicados.sha256 — el lado del VALOR\033[0m\n'
if [ -x "$GEN" ] || [ -f "$GEN" ]; then
  if bash "$GEN" --check >/dev/null 2>&1; then
    TOTALM="$(grep -c '^[0-9a-f]' security/secretos-publicados.sha256 2>/dev/null || echo 0)"
    ok "Al día: $TOTALM valores publicados por el repo son rechazables en runtime por identidad."
  else
    mal "El manifiesto está DESFASADO (o falta)."
    nota "Mientras lo esté, un literal recién commiteado NO lo rechaza ningún preflight."
    nota "Arreglo: ./scripts/gen-published-secrets-manifest.sh && git add security/secretos-publicados.sha256"
  fi
else
  mal "Falta $GEN: sin él no hay lado del valor."
fi

# =============================================================================
# (G) CONSUMIDORES DEL COMPOSE — quien lo levanta, lo resuelve antes
# =============================================================================
# DE DÓNDE VIENE ESTE BLOQUE, y por qué no estaba: lo pidió el orquestador con un
# run rojo delante (`e2e-real.yml`, run 34498068945). Hacer `fail-closed` el compose
# tiene un efecto que el candado estático NO veía: **cada sitio que levanta ese
# compose necesita resolver los secretos antes, o muere en la interpolación.**
#
# Los bloques A–F comprueban la FORMA DEL CÓDIGO. Este comprueba que el SISTEMA
# siga pudiendo arrancar, que es la familia de fallo que se nos escapó todo el día:
# un candado en verde y el gate real sin poder levantar.
#
# Regla: si un fichero ejecuta `docker compose … up` sobre un compose que exige
# secretos con `${VAR:?}`, ese mismo fichero tiene que invocar antes un preflight.
printf '\n\033[1m(G) Quien levanta el compose, resuelve antes\033[0m\n'
G_MAL=0; G_VISTOS=0
# ¿Qué composes exigen secretos? (si ninguno, este bloque no tiene blanco)
COMPOSES_EXIGENTES=()
for f in docker-compose*.yml; do
  [ -f "$f" ] || continue
  # `grep ':?'` a secas NO sirve: un COMENTARIO que explique la forma `:?` haría
  # creer al candado que el compose sigue siendo exigente cuando ya no lo es, y el
  # bloque se quedaría verde sin blanco. Lo cazó el canario. Se exige la forma real
  # `${VAR:?` fuera de comentario.
  grep -qE '^[^#]*\$\{[A-Za-z_][A-Za-z0-9_]*:\?' "$f" && COMPOSES_EXIGENTES+=("$f")
done
if [ "${#COMPOSES_EXIGENTES[@]}" -eq 0 ]; then
  mal "Ningún compose exige secretos con \`:?\`: o se revirtió el arreglo, o este bloque perdió su blanco."
  G_MAL=1
else
  mapfile -t GFILES < <(ls .github/workflows/*.yml scripts/*.sh security/scripts/*.sh 2>/dev/null)
  for f in "${GFILES[@]:-}"; do
    [ -f "$f" ] || continue
    es_autoreferente "$f" && continue
    # ¿Levanta un compose EXIGENTE? Dos precisiones que costaron dos falsos
    # positivos al escribir este bloque, y que valen la pena:
    #  · «levanta» es que el COMANDO sea `docker compose … up`, no que la cadena
    #    aparezca en la línea: `scripts/e2e-capability-gate.sh` la escribe dentro
    #    de un mensaje de ayuda («o la ruta Docker: docker compose up -d»).
    #  · importa CUÁL compose: `dast-selftest.sh` levanta uno propio que no exige
    #    secretos, y exigirle un resolver sería un rojo por nada.
    LEVANTA=0
    while IFS= read -r linea; do
      [[ "$linea" =~ ^[[:space:]]*# ]] && continue
      # Primer token ejecutable de la línea (tolera `run:`, `-`, `&&`, `|`).
      cmd="$(sed -E 's/^[[:space:]]*(-[[:space:]]+)?(run:[[:space:]]*)?//; s/^[[:space:]]*//' <<< "$linea")"
      [[ "$cmd" =~ ^docker[[:space:]-]compose ]] || continue
      [[ "$linea" =~ [[:space:]]up([[:space:]]|$) ]] || continue
      # ¿Sobre qué fichero?
      objetivo="docker-compose.yml"
      if [[ "$linea" =~ -f[[:space:]]+\"?([^\"[:space:]]+)\"? ]]; then
        objetivo="${BASH_REMATCH[1]}"
        # `-f "$COMPOSE"` / `-f "${COMPOSE_FILE}"` → se busca su valor en el fichero.
        if [[ "$objetivo" == *'$'* ]]; then
          vname="$(tr -d '${}"' <<< "$objetivo")"
          resuelto="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${vname}[:=]" "$f" \
                        | grep -oE 'docker-compose[A-Za-z0-9._-]*' | head -1)"
          objetivo="${resuelto:-TODOS}"
        fi
      fi
      if [ "$objetivo" = "TODOS" ]; then
        LEVANTA=1
      else
        for ce in "${COMPOSES_EXIGENTES[@]}"; do
          [ "$ce" = "$objetivo" ] && LEVANTA=1
        done
      fi
    done < <(cat "$f")
    [ "$LEVANTA" -eq 1 ] || continue
    G_VISTOS=$((G_VISTOS+1))
    if grep -qE 'secrets-preflight\.sh|webhook-secret-preflight\.sh' "$f"; then
      printf '      · %s levanta el stack y RESUELVE antes.\n' "$f"
    else
      mal "$f levanta un compose con \`\${VAR:?}\` y NO resuelve los secretos antes."
      nota "Morirá en la interpolación sin levantar nada: «required variable … is missing a value»."
      nota "Añade antes del \`up\`:  ./scripts/secrets-preflight.sh env-file <fichero>  (o \`github-env\` en un workflow)."
      G_MAL=$((G_MAL+1))
    fi
  done
  if [ "$G_VISTOS" -eq 0 ]; then
    mal "No se encontró NINGÚN consumidor del compose: este bloque se quedó sin blanco."
    nota "Un candado sin blanco sale en verde sin haber mirado nada (§44)."
    G_MAL=$((G_MAL+1))
  elif [ "$G_MAL" -eq 0 ]; then
    ok "$G_VISTOS consumidor(es) del compose, todos resuelven los secretos antes de levantar."
  fi
fi

# =============================================================================
# (F) INVENTARIO — literales en código de OTROS dueños
# =============================================================================
# CLAUDE.md: devops no toca `backend/` ni `frontend/`. Pero «no lo toco» no puede
# significar «no lo veo»: seguridad midió que quedaban dos `whsec_…` con la forma
# `|| 'literal'` en `backend/test/` y que mi preflight NO los cazaba.
#
# La regla de este bloque es la que se puede sostener: el literal ajeno no bloquea
# el CI de devops —no puedo arreglarlo— pero SÍ tiene que estar NEUTRALIZADO, o
# sea presente en el manifiesto, para que ningún entorno real pueda usarlo. Si un
# literal ajeno NO está en el manifiesto, entonces sí es rojo: significa que no
# está neutralizado por nada.
printf '\n\033[1m(F) Inventario: literales de secreto en código de otros dueños\033[0m\n'
F_MAL=0; F_VISTOS=0
hash_de() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mapfile -t FFILES < <(git ls-files 'backend/**/*.ts' 'frontend/**/*.ts' 'backend/**/*.js' 2>/dev/null | grep -v node_modules || true)
else
  # Copia sin git (el canario). Mismo blanco, otra forma de enumerarlo.
  mapfile -t FFILES < <(find backend frontend -type f \( -name '*.ts' -o -name '*.js' \) -not -path '*/node_modules/*' 2>/dev/null || true)
fi
for f in "${FFILES[@]:-}"; do
  [ -f "$f" ] || continue
  while IFS=: read -r n linea; do
    [ -n "${n:-}" ] || continue
    [[ "$linea" =~ ^[[:space:]]*(//|\*|/\*) ]] && continue
    [[ "$linea" =~ ([A-Za-z_][A-Za-z0-9_]*)[^A-Za-z0-9_]*(\|\||\?\?)[[:space:]]*[\'\"]([^\'\"]+)[\'\"] ]] || continue
    var="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[3]}"
    es_nombre_de_secreto "$var" || continue
    # Tiene que ser una LECTURA DE ENTORNO con respaldo, que es la clase. Sin este
    # filtro entra `settings[GRADING_HOOK_DIAL_KEY] ?? 'off'`: una constante usada
    # como índice y un estado por defecto, que no es un secreto ni tiene respaldo.
    if [[ "$linea" != *"env.$var"* && "$linea" != *"env['$var']"* && "$linea" != *"env[\"$var\"]"* ]]; then
      continue
    fi
    F_VISTOS=$((F_VISTOS+1))
    dueno="backend"; [[ "$f" == frontend/* ]] && dueno="frontend"
    if grep -q "^$(hash_de "$val")  " security/secretos-publicados.sha256 2>/dev/null; then
      printf '      · %s:%s  \033[1m%s\033[0m con respaldo literal → NEUTRALIZADO por el manifiesto.\n' "$f" "$n" "$var"
      printf '        (ruta de %s; devops no la toca. Ningún entorno real puede usar ese valor.)\n' "$dueno"
    else
      mal "$f:$n — \`$var\` con respaldo literal y el valor NO está en el manifiesto."
      nota "Sin manifiesto, ese literal SÍ es usable en un entorno real. Regenera el manifiesto"
      nota "(./scripts/gen-published-secrets-manifest.sh) y enruta el borrado del literal a $dueno."
      F_MAL=$((F_MAL+1))
    fi
  done < <(grep -nE "(\|\||\?\?)[[:space:]]*['\"]" "$f" 2>/dev/null || true)
done
if [ "$F_VISTOS" -eq 0 ]; then
  ok "No queda ningún respaldo literal de secreto en backend/ ni frontend/."
elif [ "$F_MAL" -eq 0 ]; then
  ok "$F_VISTOS respaldos literales ajenos, TODOS neutralizados por el manifiesto (enrutados a su dueño)."
fi

# =============================================================================
printf '\n'
if [ "$FALLOS" -gt 0 ]; then
  printf '\033[1;31m✗ %s incumplimiento(s). La clase S-88-1 NO está cerrada.\033[0m\n' "$FALLOS"
  printf '  La regla es una: un valor que sirva como secreto no puede estar escrito en un\n'
  printf '  fichero versionado de un repositorio público. Ver DEVOPS_NOTES §50.\n\n'
  exit 1
fi
printf '\033[1;32m✓ Clase S-88-1 cerrada: ningún secreto —ni los que aún no existen— puede nacer con un valor del repo.\033[0m\n\n'
exit 0

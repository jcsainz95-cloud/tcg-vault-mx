#!/bin/sh
#
# secrets-preflight.sh — «ningún secreto de este repo nace con un valor escrito
# en el repo»                                                          · devops
# =============================================================================
# POSIX sh a propósito: corre también DENTRO de la imagen del backend (alpine),
# donde no hay bash.
#
# DE DÓNDE VIENE — S-88-1, y por qué NO son «siete `:?`»
# ---------------------------------------------------------------------------
# P-WH-1 se cerró para UNA variable: `STRIPE_WEBHOOK_SECRET` dejó de tener un
# default literal y pasó a `${VAR:?}`. Seguridad midió lo que quedaba TRES LÍNEAS
# MÁS ARRIBA, en el mismo fichero: otros siete secretos con exactamente la misma
# forma `${VAR:-literal}` — JWT de acceso y de refresco, las dos claves PII, la
# contraseña del admin sembrado, Postgres y MinIO. Su frase es el diagnóstico
# entero:
#
#     «la cirugía fue a una variable, no a la clase.»
#
# Y tiene una consecuencia que decide el diseño de este fichero: si el arreglo
# fuese poner `:?` siete veces, **el octavo secreto que alguien añada mañana nace
# con el defecto**, porque nada le impide escribir `${NUEVO:-literal}`. La cirugía
# habría ido a siete variables en vez de a una. Sigue sin ir a la clase.
#
# LO QUE CIERRA LA CLASE — tres piezas que se sostienen entre sí
# ---------------------------------------------------------------------------
#  1. **Los ficheros de compose dejan de poder llevar valores.** Toda variable con
#     forma de secreto se declara `${VAR:?mensaje}`: sin valor, no arranca. Ya no
#     existe el sitio donde escribir el literal.
#  2. **Este script satisface esa exigencia sin literales.** Lee del propio compose
#     QUÉ variables se exigen (no tiene lista: la deriva del `:?`), y las resuelve:
#     · entorno DESECHABLE (local, CI) → valor ALEATORIO por corrida/máquina;
#     · entorno REAL → tiene que venir del gestor de secretos, y si falta, ABORTA.
#     Así el «octavo secreto» de mañana queda cubierto el día que se escribe: le
#     basta con nacer `:?` para que este script lo genere y lo exija.
#  3. **El lado del VALOR** (`security/secretos-publicados.sha256`): cualquier valor
#     que el repo publique se rechaza por identidad, aunque venga del entorno y
#     aunque no se parezca a un dummy. Esto cierra el punto ciego que seguridad
#     midió: `sk_live_… + whsec_e2e_test_secret` **pasaba**, porque la lista de
#     palabras sospechosas no contenía nada de `whsec_e2e_test_secret` — pero ese
#     valor está commiteado en `backend/test/integration/setup.ts:32`.
#
# Y encima de las tres, el candado estático `scripts/check-secret-defaults.sh`
# vigila que nadie reintroduzca la forma prohibida, en CUALQUIER fichero y para
# CUALQUIER nombre con forma de secreto — incluidos los que aún no existen.
#
# MODOS
#   assert                Comprueba el entorno actual. rc=1 si es inseguro.
#   resolve VAR           Imprime un valor usable para VAR (o aborta).
#   env-file [ruta] [VAR…]  Rellena las que falten en un .env (idempotente).
#   github-env [VAR…]       Imprime `VAR=valor` de las que falten (>> $GITHUB_ENV).
#   catalogo              Lista las variables exigidas por los compose.
#   publicado VALOR       rc=0 si VALOR está publicado por este repo.
#
# NUNCA imprime el valor de un secreto en un mensaje de error (sí en `resolve`,
# que es su trabajo, y en `env-file`, que escribe a un fichero ignorado por git).
# =============================================================================
set -u

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="${SECRETS_PREFLIGHT_ROOT:-$(cd "$AQUI/.." && pwd)}"
MANIFIESTO="${SECRETS_MANIFEST:-$RAIZ/security/secretos-publicados.sha256}"

MODO="${1:-assert}"

# =============================================================================
# ¿ESTE ENTORNO ES DESECHABLE?
# =============================================================================
# Desechable = nadie puede perder dinero ni datos si sus secretos son aleatorios y
# se tiran al terminar: el portátil de un dev, un runner de CI con volúmenes
# nuevos. En un entorno desechable GENERAR es estrictamente mejor que un literal:
# nadie puede firmar contra un valor que no existía hace un minuto.
#
# Se acierta hacia «NO desechable»: ante la duda, exigimos secretos de verdad.
#
# CÓMO SE DECIDE, Y POR QUÉ ASÍ (corregido tras el run 34512132641)
# ---------------------------------------------------------------------------
# La primera versión de esta función preguntaba `hay_stripe_real`. La heredé del
# preflight del webhook, donde ESA pregunta significa algo preciso: si hay una
# clave de Stripe real, **se puede mover dinero**, y un webhook forjado cuesta
# cartas. Aquí no significa nada de eso. Que exista una clave `sk_test_` no dice
# absolutamente nada sobre si la contraseña de Postgres de un stack que vive diez
# minutos en un runner tiene que salir de un gestor de secretos. Copié la señal
# con su nombre pero sin su significado, y el resultado fue que el gate de dinero
# —que SÍ tiene clave de Stripe real— se declaraba «entorno real» y abortaba.
#
# La regla nueva no ADIVINA si el entorno es desechable: **se lo tienen que
# decir**, o tiene que ser un runner de CI. Todo lo demás falla cerrado.
#
#   1. `SECRETS_ENV=real|prod|production|staging` → NO. Lo explícito manda siempre.
#   2. Marca de plataforma de despliegue (Railway/Vercel/Render/Fly/Heroku/K8s)
#      → NO, **aunque `CI` esté puesto**. Ésta es la trampa que hay que dejar
#      cerrada: un job de CI que despliega a Railway no puede inventarse secretos.
#   3. `SECRETS_ENV=desechable|ephemeral|local|ci` → SÍ. Lo declara el script cuyo
#      trabajo ES levantar un stack de usar y tirar (dev-up, stack-native,
#      dast-ephemeral). Una declaración del que sabe, no una corazonada del que mira.
#   4. Runner de CI (`GITHUB_ACTIONS`/`CI`) sin marcas de plataforma → SÍ: volúmenes
#      nuevos cada corrida y todo muere con el job.
#   5. Cualquier otra cosa → NO. Una máquina pelada sin declarar es un servidor
#      hasta que se demuestre lo contrario.
es_desechable() {
  # (1) Lo explícito, en el sentido de «esto es real», manda por encima de todo.
  case "${SECRETS_ENV:-}" in
    real|prod|production|staging) return 1 ;;
  esac
  # (2) Plataformas de despliegue: aquí no se genera nada, pase lo que pase.
  [ -n "${RAILWAY_ENVIRONMENT:-}${RAILWAY_SERVICE_ID:-}${RAILWAY_PROJECT_ID:-}" ] && return 1
  [ -n "${VERCEL_ENV:-}${RENDER:-}${FLY_APP_NAME:-}${DYNO:-}${KUBERNETES_SERVICE_HOST:-}" ] && return 1
  # (3) Declaración explícita del entrypoint que levanta el stack desechable.
  case "${SECRETS_ENV:-}" in
    desechable|ephemeral|local|ci) return 0 ;;
  esac
  # (4) Runner de CI: efímero por construcción.
  [ -n "${GITHUB_ACTIONS:-}${CI:-}" ] && return 0
  # (5) Ante la duda, NO.
  return 1
}

# =============================================================================
# ¿ESTE VALOR ESTÁ PUBLICADO POR EL REPO?  (el lado del VALOR)
# =============================================================================
# Identidad, no heurística. Ver la cabecera de
# `scripts/gen-published-secrets-manifest.sh`.
hash_de() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
  else
    printf '%s' "$1" | openssl dgst -sha256 | sed 's/.*= *//'
  fi
}

esta_publicado() {
  v="$1"
  [ -n "$v" ] || return 1
  [ -f "$MANIFIESTO" ] || return 1
  h="$(hash_de "$v")"
  grep -q "^$h  " "$MANIFIESTO" 2>/dev/null && return 0
  # Y también sin espacios alrededor: un secreto pegado desde el portapapeles con
  # un salto de línea es el MISMO secreto publicado.
  vt="$(printf '%s' "$v" | tr -d '[:space:]')"
  [ "$vt" = "$v" ] && return 1
  ht="$(hash_de "$vt")"
  grep -q "^$ht  " "$MANIFIESTO" 2>/dev/null
}

pista_de() {  # nombres bajo los que el repo publica ese valor (para el mensaje)
  h="$(hash_de "$1")"
  grep "^$h  " "$MANIFIESTO" 2>/dev/null | head -1 | sed 's/^[0-9a-f]*  //'
}

# La red de seguridad heredada del preflight del webhook: patrones de no-secreto.
# Se mantiene POR DEBAJO del manifiesto, no por encima: caza el literal que alguien
# escribe en el entorno sin commitearlo (y que por tanto el manifiesto no puede
# conocer). Fuente única de la lista: el preflight del webhook.
PATRONES_PUBLICOS="$(sed -n 's/^PATRONES_PUBLICOS=.\(.*\).$/\1/p' "$AQUI/webhook-secret-preflight.sh" 2>/dev/null)"
[ -n "$PATRONES_PUBLICOS" ] || PATRONES_PUBLICOS='dummy placeholder change_me changeme fake sample example foobar xxxxx'

huele_a_publico() {
  v="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [ -z "$v" ] && return 1
  for p in $PATRONES_PUBLICOS; do
    case "$v" in *"$p"*) return 0 ;; esac
  done
  return 1
}

# Sigue aquí porque el MENSAJE de aborto la usa para dar contexto, y porque el
# preflight del webhook —donde la pregunta sí es la correcta— comparte idioma.
# Lo que ya NO hace es decidir si el entorno es desechable: ver es_desechable().
hay_stripe_real() {
  k="${STRIPE_SECRET_KEY:-}"
  [ -n "$k" ] || k="${STRIPE_TEST_SECRET_KEY:-}"
  k="$(printf '%s' "$k" | tr -d '[:space:]')"
  [ -n "$k" ] || return 1
  case "$k" in sk_live_*|sk_test_*|rk_live_*|rk_test_*) ;; *) return 1 ;; esac
  # Una clave que el propio repo publica NO es una clave real.
  esta_publicado "$k" && return 1
  huele_a_publico "$k" && return 1
  return 0
}

# =============================================================================
# EL CATÁLOGO NO ES UNA LISTA: SE DERIVA DE LOS COMPOSE
# =============================================================================
# Si tuviera una lista de variables, el octavo secreto de mañana no estaría en
# ella y volveríamos al mismo sitio. En vez de eso: **lo que el compose exige con
# `${VAR:?}` es exactamente lo que este script resuelve.** Nace cubierto.
# DENTRO de la imagen los nombres son los del CONTENEDOR, no los del host:
# `JWT_ACCESS_SECRET`, no `STAGING_JWT_ACCESS_SECRET`. Apuntar aquí al catálogo del
# host hizo que 12 de 15 «faltaran», que el entrypoint abortara y que el backend
# muriera sin emitir nada (run 34531002011: 5 minutos esperando a un muerto).
CATALOGO_FICHERO="${SECRETS_CATALOG:-$RAIZ/security/secretos-exigidos-contenedor.txt}"
# Se calcula UNA vez, a nivel de script. Estaba dentro de `catalogo()`, y como esa
# función se invoca con `$(catalogo)` —subshell— la asignación no volvía al padre:
# el mensaje final moría con «HAY_COMPOSE: parameter not set» y el entrypoint salía
# con rc=2. Lo cazó el bloque I del canario a los cinco minutos de escribirlo, que
# es justo lo que ese bloque existe para hacer.
HAY_COMPOSE=0
for _f in "$RAIZ"/docker-compose*.yml; do
  [ -f "$_f" ] && HAY_COMPOSE=1
done

catalogo() {
  if [ "$HAY_COMPOSE" = "1" ]; then
    for f in "$RAIZ"/docker-compose*.yml; do
      [ -f "$f" ] || continue
      sed -n 's/.*\${\([A-Z][A-Z0-9_]*\):?.*/\1/p' "$f"
    done | sort -u
  else
    # DENTRO DE LA IMAGEN no hay compose. El catálogo viaja materializado, generado
    # desde los mismos `:?` por `gen-published-secrets-manifest.sh`. Sin este ramal,
    # `assert` en el arranque de Railway no miraría NADA y saldría 0 — el candado
    # sin blanco de §44, en el sitio donde más caro sale.
    grep -v '^#' "$CATALOGO_FICHERO" 2>/dev/null | grep -v '^$' | sort -u
  fi
}

# =============================================================================
# GENERACIÓN — la forma la dicta el SUFIJO del nombre, no una tabla de variables
# =============================================================================
azar_hex() {  # $1 = bytes
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}
azar_b64_32() {  # base64 de EXACTAMENTE 32 bytes (AES-256; PiiCryptoService crashea si no)
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
  fi
}

# -----------------------------------------------------------------------------
# ENMASCARADO EN ORIGEN (`S-MASK-1`, 2026-09-11)
# -----------------------------------------------------------------------------
# GitHub tapa los secretos REGISTRADOS (los de `secrets.*`), pero NO los que el
# propio workflow genera: nunca pasaron por `::add-mask::`. Medido en el run
# `34650494939` (repo PÚBLICO): el bloque `env:` se imprime en CADA paso y ahí
# salían en claro `POSTGRES_PASSWORD`, `STAGING_JWT_*`, `STAGING_PII_ENCRYPTION_KEY`,
# `STAGING_PII_HMAC_KEY`, `STAGING_SEED_*`, `RESEND_API_KEY`, los `STRIPE…WEBHOOK…`…
# Son efímeros y el stack se destruye, así que el daño directo es BAJO — pero es la
# misma clase que persigue `S-88-1` una capa más abajo: el valor no está en el repo,
# está en el LOG PÚBLICO del repo. Y dos de ellos son la pareja cifrado+HMAC de PII:
# publicarlos enseña el formato exacto y normaliza verlos en claro.
#
# ⚠️ POR QUÉ A `stderr` Y NO A `stdout`: este valor nace DENTRO de una sustitución
# de comandos (`$(generar "$n")` en `github-env` y en `env-file`). Un `::add-mask::`
# por stdout se metería DENTRO del valor y rompería el secreto. `stderr` no lo captura
# `$(...)`, y el runner de Actions procesa los comandos de workflow de AMBOS flujos.
# El candado `scripts/check-secret-masking.sh` comprueba justo eso: que por stdout
# sale el valor limpio y por stderr sale su `::add-mask::`.
enmascarar() {
  [ "${GITHUB_ACTIONS:-}" = "true" ] || return 0
  [ -n "${1:-}" ] || return 0
  printf '::add-mask::%s\n' "$1" >&2
}

generar() {
  # Un solo sitio por el que salen TODOS los valores generados ⇒ un solo sitio que
  # enmascarar. Si mañana nace otra forma, nace ya tapada.
  __v="$(generar_crudo "$1")"
  enmascarar "$__v"
  printf '%s' "$__v"
}

generar_crudo() {
  nombre="$1"
  case "$nombre" in
    # Clave de cifrado PII: base64 de 32 bytes exactos. La del HMAC del índice
    # ciego (PII_HMAC_KEY) igual: PiiCryptoService acepta base64 o texto (>=32
    # bytes) y recomienda base64 (`openssl rand -base64 32`).
    *ENCRYPTION_KEY|*ENCRYPTION_KEYS|*HMAC_KEY) azar_b64_32 ;;
    # Contraseñas de usuarios sembrados: tienen que pasar la política de la app
    # (mayúscula, minúscula, dígito y símbolo). Prefijo y sufijo fijos + azar.
    *PASSWORD) printf 'Ef%s!aA9' "$(azar_hex 16)" ;;
    # Secreto de webhook: se mantiene el prefijo por legibilidad de los logs.
    *WEBHOOK_SECRET) printf 'whsec_efimero_%s' "$(azar_hex 24)" ;;
    # Claves de Stripe: el valor generado NO puede empezar por `sk_`/`rk_`. Si lo
    # hiciera, `hay_stripe_real` lo tomaría por una clave de verdad, el entorno
    # dejaría de ser desechable y este mismo script abortaría por lo que él mismo
    # acaba de generar. Un prefijo que se lee solo evita además que alguien vea
    # un `sk_test_…` en un log y crea que el entorno habla con Stripe.
    *STRIPE*KEY|*STRIPE*SECRET) printf 'sin_stripe_efimero_%s' "$(azar_hex 24)" ;;
    # Resend mantiene su forma `re_…` (el adaptador la usa tal cual; con una clave
    # que no existe, el envío falla — que es justo lo que queremos sin correo real).
    *RESEND*) printf 're_efimero_%s' "$(azar_hex 24)" ;;
    # Todo lo demás (JWT, HMAC, tokens): 48 bytes hex = 96 chars, muy por encima
    # de MIN_JWT_SECRET_LENGTH.
    *) azar_hex 48 ;;
  esac
}

# =============================================================================
# MENSAJES
# =============================================================================
abortar_falta() {
  n="$1"
  echo "" >&2
  echo "✗ PREFLIGHT DE SECRETOS — ARRANQUE ABORTADO (S-88-1)" >&2
  echo "" >&2
  echo "  Falta \`$n\` y este entorno NO es desechable." >&2
  echo "" >&2
  echo "  Antes, aquí ganaba un literal escrito en el repo (\`\${$n:-…}\`). Este" >&2
  echo "  repositorio es PÚBLICO: ese literal lo tiene también quien lo clone, y" >&2
  echo "  ganaba justo en el caso del operador que creyó configurarlo y no lo hizo." >&2
  echo "  Por eso ahora falta ruidosamente en vez de degradar en silencio." >&2
  echo "" >&2
  echo "  QUÉ HACER:" >&2
  echo "    · Railway / Vercel → añade \`$n\` en las variables del servicio." >&2
  echo "    · local / CI       → \`./scripts/secrets-preflight.sh env-file .env\`" >&2
  echo "                         genera uno ALEATORIO de esta máquina/corrida." >&2
  echo "" >&2
  echo "  QUÉ **NO** HACER: escribir un literal en un fichero versionado. Ver" >&2
  echo "  DEVOPS_NOTES §50." >&2
  exit 1
}

abortar_publicado() {
  n="$1"; p="$2"
  echo "" >&2
  echo "✗ PREFLIGHT DE SECRETOS — ARRANQUE ABORTADO (S-88-1)" >&2
  echo "" >&2
  echo "  \`$n\` trae un valor que ESTE REPOSITORIO PUBLICA." >&2
  [ -n "$p" ] && echo "  El mismo valor aparece en el repo como: $p" >&2
  echo "" >&2
  echo "  No importa que lo hayas puesto tú en el entorno: si el valor está escrito" >&2
  echo "  en un fichero versionado de un repo público, lo tiene cualquiera. Con el" >&2
  echo "  secreto JWT publicado se firma un \`super_admin\`; con la clave PII se" >&2
  echo "  descifra una CLABE. Seguridad hizo las dos cosas, no es una hipótesis." >&2
  echo "" >&2
  echo "  QUÉ HACER: genera uno nuevo y ponlo en el gestor de secretos." >&2
  echo "    openssl rand -hex 48            # JWT / HMAC / tokens" >&2
  echo "    openssl rand -base64 32         # claves de cifrado PII (32 bytes)" >&2
  exit 1
}

# =============================================================================
# RESOLUCIÓN DE UNA VARIABLE
# =============================================================================
# Devuelve por stdout el valor a usar. Aborta si el entorno es real y el valor
# falta o está publicado.
valor_de() {  # lee la variable de entorno por nombre, sin `eval` peligroso
  printf '%s' "$(env | sed -n "s/^$1=//p" | head -1)"
}

resolver() {
  n="$1"
  v="$(valor_de "$n")"
  # Espacios en blanco no cuentan como valor: `' '` es truthy y ese fue justo el
  # fallo que backend cazó en P-WH-1.
  [ -n "$(printf '%s' "$v" | tr -d '[:space:]')" ] || v=""

  if [ -n "$v" ]; then
    if esta_publicado "$v"; then
      abortar_publicado "$n" "$(pista_de "$v")"
    fi
    if ! es_desechable && huele_a_publico "$v"; then
      abortar_publicado "$n" "(contiene un patrón de no-secreto: $PATRONES_PUBLICOS)"
    fi
    printf '%s' "$v"
    return 0
  fi

  es_desechable || abortar_falta "$n"
  generar "$n"
}

# =============================================================================
# MODOS
# =============================================================================
case "$MODO" in

  catalogo)
    catalogo
    ;;

  publicado)
    [ $# -ge 2 ] || { echo "uso: $0 publicado VALOR" >&2; exit 2; }
    if esta_publicado "$2"; then
      echo "PUBLICADO — el repo lo expone como: $(pista_de "$2")"
      exit 0
    fi
    echo "no publicado por este repo"
    exit 1
    ;;

  resolve)
    [ $# -ge 2 ] || { echo "uso: $0 resolve VAR" >&2; exit 2; }
    resolver "$2"
    echo ""
    ;;

  assert)
    N=0; GEN=0
    # UN CANDADO SIN BLANCO NO ES UN CANDADO. Si el catálogo sale vacío —porque el
    # fichero no viajó a la imagen, o porque alguien lo borró— este `assert` diría
    # OK sin haber mirado un solo secreto. Se falla ruidoso en vez de en verde.
    if [ -z "$(catalogo)" ]; then
      echo "" >&2
      echo "✗ PREFLIGHT DE SECRETOS — SIN BLANCO (S-88-1)" >&2
      echo "" >&2
      echo "  No hay ni ficheros de compose ni catálogo materializado" >&2
      echo "  ($CATALOGO_FICHERO). Sin blanco, esta comprobación saldría en VERDE" >&2
      echo "  sin haber mirado nada — que es peor que no tenerla." >&2
      echo "" >&2
      echo "  En la imagen: revisa el COPY de security/secretos-exigidos-contenedor.txt" >&2
      echo "  (Dockerfile.backend) y la excepción de .dockerignore." >&2
      exit 1
    fi
    for n in $(catalogo); do
      N=$((N+1))
      v="$(valor_de "$n")"
      [ -n "$(printf '%s' "$v" | tr -d '[:space:]')" ] || v=""
      if [ -n "$v" ]; then
        esta_publicado "$v" && abortar_publicado "$n" "$(pista_de "$v")"
        if ! es_desechable && huele_a_publico "$v"; then
          abortar_publicado "$n" "(patrón de no-secreto)"
        fi
      else
        es_desechable || abortar_falta "$n"
        GEN=$((GEN+1))
      fi
    done
    # De dónde salió la lista importa: dentro de la imagen no hay composes, y decir
    # «exigidos por los compose» ahí sería mentir sobre qué se acaba de comprobar.
    FUENTE="los compose"
    [ "$HAY_COMPOSE" = "1" ] || FUENTE="$CATALOGO_FICHERO (catálogo del contenedor)"
    if es_desechable; then
      echo "· preflight de secretos: OK — $N exigidos por $FUENTE; $GEN sin valor propio (entorno DESECHABLE: se generan aleatorios)."
    else
      echo "· preflight de secretos: OK — $N exigidos por $FUENTE, todos con valor propio y ninguno publicado por el repo."
    fi
    ;;

  env-file)
    DESTINO="${2:-$RAIZ/.env}"
    shift 2>/dev/null || true
    shift 2>/dev/null || true
    LISTA="$*"
    [ -n "$LISTA" ] || LISTA="$(catalogo)"
    touch "$DESTINO"
    NUEVAS=0
    for n in $LISTA; do
      # Ya en el fichero con valor no vacío → se respeta (idempotente: no se
      # rota el secreto de nadie por volver a correr esto).
      if grep -qE "^$n=..*" "$DESTINO" 2>/dev/null; then
        actual="$(sed -n "s/^$n=//p" "$DESTINO" | head -1)"
        if esta_publicado "$actual"; then
          # En un entorno REAL no se «arregla» generando: el operador tiene que
          # enterarse de que su fichero traía un valor público, porque el mismo
          # valor puede estar también en el gestor de secretos de la plataforma.
          es_desechable || abortar_publicado "$n" "$(pista_de "$actual")"
          echo "  · $n: el valor de $DESTINO está PUBLICADO por el repo → se sustituye por uno aleatorio." >&2
          sed "s|^$n=.*|$n=$(generar "$n")|" "$DESTINO" > "$DESTINO.tmp" && mv "$DESTINO.tmp" "$DESTINO"
          NUEVAS=$((NUEVAS+1))
        fi
        continue
      fi
      # Línea presente pero vacía → se rellena.
      if grep -qE "^$n=$" "$DESTINO" 2>/dev/null; then
        sed "s|^$n=$|$n=$(generar "$n")|" "$DESTINO" > "$DESTINO.tmp" && mv "$DESTINO.tmp" "$DESTINO"
      else
        printf '%s=%s\n' "$n" "$(generar "$n")" >> "$DESTINO"
      fi
      NUEVAS=$((NUEVAS+1))
    done
    echo "· secretos en $DESTINO: $NUEVAS generados/renovados (aleatorios de esta máquina). El fichero está en .gitignore."
    ;;

  github-env)
    # Para `... >> "$GITHUB_ENV"`. Solo las que no traen valor del secret store.
    # Sin argumentos resuelve el catálogo derivado de los compose; con argumentos,
    # exactamente las que el workflow declare que necesita. Los nombres viven en el
    # workflow —que es quien los necesita— y no en una lista dentro de este script:
    # una lista aquí sería otra vez «las siete variables» con otro disfraz.
    shift 2>/dev/null || true
    LISTA="$*"
    [ -n "$LISTA" ] || LISTA="$(catalogo)"
    for n in $LISTA; do
      v="$(valor_de "$n")"
      [ -n "$(printf '%s' "$v" | tr -d '[:space:]')" ] || v=""
      if [ -n "$v" ]; then
        esta_publicado "$v" && abortar_publicado "$n" "$(pista_de "$v")"
        continue
      fi
      es_desechable || abortar_falta "$n"
      printf '%s=%s\n' "$n" "$(generar "$n")"
    done
    ;;

  *)
    echo "uso: $0 [assert|resolve VAR|env-file [ruta] [VAR...]|github-env [VAR...]|catalogo|publicado VALOR]" >&2
    exit 2
    ;;
esac
exit 0

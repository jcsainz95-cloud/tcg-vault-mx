#!/usr/bin/env bash
#
# price-provider-parity.sh — MEDIDA INTERINA de `D-PP-2`. Propiedad: devops.
# =============================================================================
# ⏳ ESTE SCRIPT NACE CON FECHA DE MUERTE. Ver «RETIRO» abajo: no es un script de
#    operación, es un PUENTE mientras `D-PP-1` (backend) no aterrice.
#
# QUÉ PROBLEMA TAPA (medido, no supuesto — razón entera en ARCHITECTURE §4.35a(d)):
#   El dial `price_provider` tiene TRES hechos distintos (API_CONTRACT §M10-PP):
#   PRIMARIO (norma), SEED (con qué NACE una BD fresca) y VIGENTE (la fila
#   `ConfigSetting` de UN entorno). Mientras `D-PP-1` siga abierta, el SEED del
#   código NO es el PRIMARIO ⇒ toda BD fresca (CI, dev, staging) arranca en el
#   proveedor LEGACY, que **no es inerte**: corre el barrido y escribe precios
#   APLANADOS (un `market` por carta ⇒ reverse/holo al precio de la normal).
#   Consecuencia: los E2E, el smoke y el DAST contra staging ejercitan un barrido
#   DISTINTO del que corre en producción. Un gate que aprueba un sistema distinto
#   del que se promueve no es un gate.
#
# QUÉ HACE ESTE SCRIPT (y qué NO):
#   · `--ensure`  Lee el VIGENTE del entorno y, si no es el PRIMARIO, lo fija por
#                 la puerta normal: `PUT /admin/settings` con `super_admin`
#                 (VALIDADO + AUDITADO `settings.update`, sin redeploy).
#                 ⛔ NUNCA `UPDATE` directo a la BD (DEVOPS_NOTES §32.3).
#                 ⛔ Solo contra hosts locales / de staging (guarda dura abajo).
#   · `--assert`  Solo lectura. `0` si hay paridad, `20` si no. Para gates.
#   · `--check-expiry`  ⏳ Se pone ROJO cuando `D-PP-1` ya aterrizó Y el cableado
#                 de `--ensure` sigue puesto ⇒ **la parte interina caducó y hay
#                 que quitarla**. Es el mecanismo de retiro: el rojo sale solo,
#                 nadie tiene que acordarse. En cuanto el cableado se quita,
#                 vuelve a verde sin tocar nada más.
#
# QUÉ ES INTERINO Y QUÉ NO (la distinción importa, y la midió este pase):
#   · INTERINO → `--ensure` cableado en el APROVISIONAMIENTO. Muere con D-PP-1.
#   · PERMANENTE → `--assert` en los GATES. No es un apaño: es el candado de
#     `I-PP5`. Y hace falta porque «paridad por construcción» solo alcanza a las
#     BD **frescas**: los seeds MATERIALIZAN fila (`prisma/seed.ts`, `seed-e2e.ts`
#     hacen `upsert(... update:{})`), así que **todo entorno ya sembrado** —el
#     staging hospedado, un volumen de compose que nadie borró con `down -v`—
#     conserva la fila LEGACY aunque el seed del código cambie (ARCHITECTURE
#     §11.0 / DEVOPS_NOTES §32.1). Ahí la paridad se propaga con un PUT, y lo que
#     impide que se olvide es que el gate la MIDE en cada corrida.
#
# ⚠️ LO QUE **NO** FUNCIONA, Y POR QUÉ NO SE INTENTA (DEVOPS_NOTES §23.8):
#   `PRICE_PROVIDER` **como variable de entorno NO FLIPEA NADA**. Verificado en el
#   código: `PriceIngestService.providerFor()` lee `settings.getString(
#   SettingKey.PRICE_PROVIDER)` —la fila `ConfigSetting`— y el ÚNICO consumidor de
#   `process.env.PRICE_PROVIDER` es `config/env.validation.ts` (hint de arranque
#   para exigir la key del proveedor de paga). Fijar la env dejaría el documento
#   mintiendo y el barrido en el proveedor viejo. Por eso esto habla HTTP.
#
# ⚠️ LA CLAVE DEL BODY ES `priceProvider` (camelCase), NO `price_provider`.
#   Verificado: `SettingsService.update()` valida las claves del body contra
#   `SETTING_DTO_MAP` (settings.constants.ts), que solo contiene `priceProvider`;
#   una clave desconocida cae en `422 VALIDATION_ERROR`. (DEVOPS_NOTES §43.4.)
#
# =============================================================================
# RETIRO (§0-B.3 regla 9(b) — «un parche provisional que sobrevive a su causa
# deja de ser provisional»):
#   CONDICIÓN EXACTA: el merge de `D-PP-1` — es decir, cuando
#   `DEFAULT_SETTINGS[SettingKey.PRICE_PROVIDER]` (backend/src/modules/settings/
#   settings.constants.ts) sea el PRIMARIO. En ese momento la paridad se cumple
#   POR CONSTRUCCIÓN (`I-PP1`/`I-PP5`) y este script sobra.
#   CÓMO SE ENTERA EL EQUIPO SIN ACORDARSE: `--check-expiry` corre en `ci.yml` en
#   cada push/PR y se pone ROJO el día del merge de `D-PP-1`, con el comando de
#   retiro en el mensaje.
#   QUÉ SE QUITA: las llamadas a `--ensure` de `scripts/seed-synthetic.sh`,
#   `scripts/stack-native.sh` y `.github/workflows/e2e-real.yml`; y el §43.2 de
#   `docs/DEVOPS_NOTES.md` pasa a RETIRADA con la fecha.
#   QUÉ SE QUEDA: los `--assert` de los gates (`I-PP5`, ver arriba) y este
#   archivo con ellos. El rojo se apaga solo cuando el cableado interino se va.
# =============================================================================
#
# USO:
#   ./scripts/price-provider-parity.sh --ensure   [--api-base URL]
#   ./scripts/price-provider-parity.sh --assert   [--api-base URL]
#   ./scripts/price-provider-parity.sh --check-expiry
#
# ENV:
#   API_BASE         base de la API (default http://localhost:3011/api/v1)
#   ADMIN_JWT        bearer de super_admin. Si falta, se intenta login con:
#   ADMIN_EMAIL / ADMIN_PASSWORD   (defaults: los del fixture sintético y los de
#                    docker-compose.staging.yml, en ese orden)
#   ⛔ Ni el token ni la contraseña se imprimen NUNCA.
#
# CÓDIGOS DE SALIDA:
#   0  paridad (o ya la había, o se acaba de fijar)
#   2  error de entorno / estructura inesperada (no se concluye nada)
#   9  ⏳ la medida CADUCÓ (solo `--check-expiry`): bórrala
#   20 SIN paridad (solo `--assert`): el entorno evalúa otro barrido
#   30 no se pudo fijar (sin credenciales, o el PUT falló)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONSTANTS="${ROOT_DIR}/backend/src/modules/settings/settings.constants.ts"

# -----------------------------------------------------------------------------
# ⚠️ LA ÚNICA COPIA EJECUTABLE DEL LITERAL, Y MUERE CON ESTE ARCHIVO.
# La NORMA es `API_CONTRACT §M10-PP` (`I-PP1`: el SEED **es** el PRIMARIO); los
# documentos la CITAN y no la transcriben, precisamente porque la divergencia
# nació de tener el literal repetido en cinco sitios. Un script no puede citar:
# necesita un valor para comparar. Queda aquí, una vez, y se va con la medida.
# -----------------------------------------------------------------------------
PRIMARY_PROVIDER='tcgcsv_singles'

API_BASE="${API_BASE:-http://localhost:3011/api/v1}"
MODE=""

red()  { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }
ylw()  { printf '\033[1;33m%s\033[0m\n' "$*" >&2; }
grn()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
log()  { printf '  %s\n' "$*"; }
die()  { red "✗ $*"; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ensure|--assert|--check-expiry) MODE="$1" ;;
    --api-base) shift; API_BASE="${1:?--api-base necesita URL}" ;;
    -h|--help) sed -n '2,80p' "$0"; exit 0 ;;
    *) die "Opción desconocida: $1 (usa --ensure | --assert | --check-expiry)" ;;
  esac
  shift
done
[ -n "$MODE" ] || die "Falta el modo (--ensure | --assert | --check-expiry)."
API_BASE="${API_BASE%/}"

# -----------------------------------------------------------------------------
# ⏳ CADUCIDAD. Se lee el SEED del código: es el hecho que decide si esta medida
# sigue teniendo motivo. Se lee el ARTEFACTO, no un párrafo (§0-B.3 regla 2).
# -----------------------------------------------------------------------------
seed_literal() {
  [ -f "$CONSTANTS" ] || die "No encuentro $CONSTANTS (¿árbol incompleto?)."
  local line
  line="$(grep -E "^\s*\[SettingKey\.PRICE_PROVIDER\]:\s*'" "$CONSTANTS" | head -1 || true)"
  [ -n "$line" ] || die "No encuentro el literal del SEED en settings.constants.ts.
     La estructura cambió: NO se concluye nada. Revisa a mano y actualiza este script
     (o bórralo, si D-PP-1 ya aterrizó)."
  printf '%s' "$line" | sed -E "s/.*:\s*'([^']*)'.*/\1/"
}

expired() { [ "$(seed_literal)" = "$PRIMARY_PROVIDER" ]; }

# Call sites del cableado INTERINO (`--ensure` en rutas de aprovisionamiento). Se
# busca en el árbol, no en una lista escrita a mano: una lista se desactualiza.
ensure_wiring() {
  grep -rIl --exclude-dir=.git --exclude="$(basename "$0")" \
    -E 'price-provider-parity\.sh"?[[:space:]]+--ensure' \
    "$ROOT_DIR/scripts" "$ROOT_DIR/.github" 2>/dev/null || true
}

if [ "$MODE" = "--check-expiry" ]; then
  SEED="$(seed_literal)"
  if ! expired; then
    grn "✓ La medida interina SIGUE teniendo motivo (el seed del código aún no es el primario)."
    log "seed en el código: $SEED   ·   primario (§M10-PP I-PP1): $PRIMARY_PROVIDER"
    log "Cuando D-PP-1 mergee, este paso se pondrá ROJO: es el aviso de retiro, no un fallo."
    exit 0
  fi
  WIRING="$(ensure_wiring)"
  if [ -z "$WIRING" ]; then
    grn "✓ Medida interina RETIRADA y seed al día: nada que hacer."
    log "Queda el \`--assert\` de los gates, que NO es interino (candado I-PP5)."
    exit 0
  fi
  red "⏳ PARTE INTERINA CADUCADA — \`D-PP-2\` ya no tiene motivo, y sigue cableada."
  cat >&2 <<EOF

  El SEED del código ya es el PRIMARIO (settings.constants.ts) ⇒ \`D-PP-1\` aterrizó.
  Para toda BD **fresca** la paridad ya se cumple sola (\`I-PP1\`/\`I-PP5\`), así que el
  puente de aprovisionamiento sobra.

  ESTE ROJO ES EL AVISO DE RETIRO. Dueño: **devops**. No lo silencies: quítalo.

  Quita la llamada a \`--ensure\` de estos archivos:
$(printf '    · %s\n' $WIRING)

  ⛔ NO borres los \`--assert\` de los gates: no son interinos (I-PP5), y siguen
     haciendo falta porque los seeds MATERIALIZAN fila — un entorno YA SEMBRADO
     (staging hospedado, volumen de compose sin \`down -v\`) conserva la fila
     LEGACY aunque el seed del código cambie (ARCHITECTURE §11.0, DEVOPS_NOTES §32.1).

  Y marca §43.2 de docs/DEVOPS_NOTES.md como RETIRADA con la fecha de hoy.
  (Por qué el retiro es obligatorio y no opcional: ARCHITECTURE §4.35a(d) y §0-B.3
   regla 9(b) — un apaño que sobrevive a su causa acaba explicando por qué «el seed
   no importa».)
EOF
  exit 9
fi

# -----------------------------------------------------------------------------
# Si la parte interina ya caducó, `--ensure` se vuelve no-op y AVISA (el rojo del
# retiro sale en `--check-expiry`, no aquí: el retiro de un apaño de devops no
# debe tumbar el arranque de un stack ni un gate ajeno).
# ⚠️ `--assert` NO se salta nunca: mide el VIGENTE del entorno, que es otro hecho
# —un entorno ya sembrado conserva su fila legacy aunque el seed cambie—.
# -----------------------------------------------------------------------------
if [ "$MODE" = "--ensure" ] && expired; then
  grn "✓ El seed del código ya es el primario (I-PP1): una BD FRESCA nace con paridad."
  ylw "⏳ Cableado INTERINO caducado — quítalo (\`--check-expiry\` te dirá de dónde)."
  ylw "   Nota: esto NO cubre un entorno ya sembrado; eso lo mide el \`--assert\` del gate."
  exit 0
fi

command -v curl >/dev/null 2>&1 || die "Falta \`curl\`."

# --- Guarda dura: este script ESCRIBE un dial de DINERO -----------------------
# `--ensure` solo contra local/staging. Producción se opera por el panel M10 con
# un humano delante (`I-PP3`), jamás por un script de arranque.
host_of() { printf '%s' "$1" | sed -E 's#^[a-z]+://##; s#[:/].*$##'; }
if [ "$MODE" = "--ensure" ]; then
  H="$(host_of "$API_BASE")"
  case "$H" in
    localhost|127.0.0.1|::1|*staging*|backend|host.docker.internal) : ;;
    *) die "Me niego a ESCRIBIR el dial contra un host que no es local ni de staging: '$H'.
     Esta medida es para entornos que se aprovisionan solos. Un entorno de verdad se
     opera por el panel M10 (PUT /admin/settings, super_admin, auditado — I-PP3)." ;;
  esac
fi

json_field() { # $1 = json, $2 = campo
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$1" | node -e "
      let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
        try { const v=JSON.parse(s)['$2']; process.stdout.write(v==null?'':String(v)); }
        catch { process.stdout.write(''); }
      });"
  else
    printf '%s' "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 |
      sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/'
  fi
}

# --- Token: el que den, o login con las credenciales del seed ----------------
TOKEN="${ADMIN_JWT:-}"
login() {
  local email="$1" pass="$2" body code
  body="$(curl -sS -o /tmp/pp_login.$$ -w '%{http_code}' \
            -X POST "$API_BASE/auth/login" -H 'Content-Type: application/json' \
            --max-time 20 \
            -d "{\"email\":\"$email\",\"password\":\"$pass\"}" 2>/dev/null || true)"
  code="$body"; body="$(cat /tmp/pp_login.$$ 2>/dev/null || true)"; rm -f "/tmp/pp_login.$$"
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    json_field "$body" accessToken
  else
    printf ''
  fi
}
if [ -z "$TOKEN" ]; then
  # Orden: credenciales explícitas > fixture sintético (seed:synthetic) > compose de staging.
  # S-88-1: ninguna de las tres lleva ya contraseña escrita (decían `Admin123!` y
  # `StagingAdmin123!`, ambas publicadas en este repo público). Las contraseñas
  # vienen del entorno; los pares con contraseña vacía se saltan más abajo, así que
  # la ausencia se nota como «no pude entrar» en vez de colarse con la del repo.
  # Máximo 3 intentos: `/auth/login` está limitado a 5/min por IP (SEC-C1).
  for pair in \
    "${ADMIN_EMAIL:-}|${ADMIN_PASSWORD:-}" \
    "admin@e2e.local|${E2E_ADMIN_PASSWORD:-}" \
    "${SEED_ADMIN_EMAIL:-admin@staging.local}|${SEED_ADMIN_PASSWORD:-}"
  do
    E="${pair%%|*}"; P="${pair#*|}"
    [ -n "$E" ] && [ -n "$P" ] || continue
    TOKEN="$(login "$E" "$P")"
    [ -n "$TOKEN" ] && { log "Login como '$E' (super_admin) — OK."; break; }
  done
fi

read_dial() {
  local out code
  out="$(curl -sS -o /tmp/pp_get.$$ -w '%{http_code}' --max-time 20 \
          -H "Authorization: Bearer $TOKEN" "$API_BASE/admin/settings" 2>/dev/null || true)"
  code="$out"; out="$(cat /tmp/pp_get.$$ 2>/dev/null || true)"; rm -f "/tmp/pp_get.$$"
  case "$code" in
    200) json_field "$out" priceProvider ;;
    401|403) red "El token no es de super_admin o expiró (GET /admin/settings es @Roles(super_admin))."; printf '' ;;
    *) red "GET /admin/settings devolvió HTTP $code contra $API_BASE."; printf '' ;;
  esac
}

if [ -z "$TOKEN" ]; then
  red "✗ Sin credenciales de super_admin: NO puedo leer ni fijar el dial en $API_BASE."
  log "Da ADMIN_JWT, o ADMIN_EMAIL + ADMIN_PASSWORD. Ver DEVOPS_NOTES §43.2."
  exit 30
fi

VIGENTE="$(read_dial)"
[ -n "$VIGENTE" ] || { red "✗ No pude leer el dial (ver el error de arriba)."; exit 30; }

if [ "$VIGENTE" = "$PRIMARY_PROVIDER" ]; then
  grn "✓ Paridad: este entorno evalúa el MISMO proveedor que se promueve a producción."
  log "vigente = primario ($PRIMARY_PROVIDER)   ·   norma: API_CONTRACT §M10-PP (I-PP1/I-PP5)"
  exit 0
fi

if [ "$MODE" = "--assert" ]; then
  red "✗ SIN PARIDAD (\`I-PP5\`): este entorno NO evalúa el proveedor primario."
  log "vigente en $API_BASE: '$VIGENTE'   ·   primario: '$PRIMARY_PROVIDER'"
  log "Los E2E / el smoke / el DAST que corran aquí miden OTRO barrido: su verde no es citable"
  log "como gate del sistema que se promueve (ARCHITECTURE §4.35a(d))."
  # ⚠️ Este remedio decía «corre `--ensure`». Desde el retiro de la medida
  # interina (2026-09-10, §45.1) `--ensure` es un NO-OP que sale 0 sin tocar
  # nada, así que ese consejo mandaba a ejecutar un comando muerto — y encima
  # en el único momento en que alguien lee este mensaje: cuando el gate está
  # rojo. Ahora dice la vía real, que es la auditada.
  log "Causa típica: la BD se sembró ANTES de \`D-PP-1\` y conserva la fila legacy."
  log "  (los seeds hacen \`upsert(... update:{})\`: cambiar el seed NO cambia lo ya sembrado)"
  log "Arreglo: panel M10 > proveedor de precio (PUT /admin/settings, auditado, I-PP3)."
  log "  Entorno desechable: recrea la BD desde cero (p. ej. \`compose ... down -v\`) y resiembra."
  log "  ⛔ NUNCA por env (\`PRICE_PROVIDER\` no flipea el dial) ni por SQL directo (§32.4)."
  exit 20
fi

# --- ENSURE: fijar el VIGENTE por la puerta normal (validada + auditada) ------
ylw "→ Sin paridad ('$VIGENTE'). Fijando el dial por PUT /admin/settings (auditado)…"
OUT="$(curl -sS -o /tmp/pp_put.$$ -w '%{http_code}' --max-time 30 \
        -X PUT "$API_BASE/admin/settings" \
        -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        -d "{\"priceProvider\":\"$PRIMARY_PROVIDER\"}" 2>/dev/null || true)"
CODE="$OUT"; OUT="$(cat /tmp/pp_put.$$ 2>/dev/null || true)"; rm -f "/tmp/pp_put.$$"
if [ "$CODE" != "200" ]; then
  red "✗ El PUT falló (HTTP $CODE). El entorno sigue en '$VIGENTE'."
  [ -n "$OUT" ] && log "respuesta: $(printf '%s' "$OUT" | head -c 300)"
  log "Si es 422 con 'unknown setting key', la clave del body cambió: la autoridad es"
  log "SETTING_DTO_MAP en settings.constants.ts (hoy: priceProvider). Reporta a backend."
  exit 30
fi

AFTER="$(json_field "$OUT" priceProvider)"
[ -n "$AFTER" ] || AFTER="$(read_dial)"
if [ "$AFTER" != "$PRIMARY_PROVIDER" ]; then
  red "✗ El PUT devolvió 200 pero el dial quedó en '$AFTER'. NO se concluye paridad."
  exit 30
fi
grn "✓ Dial fijado al primario ($PRIMARY_PROVIDER) — auditado como \`settings.update\`."
log "Es el hecho VIGENTE de ESTE entorno (I-PP3); el SEED del código NO se toca (eso es D-PP-1)."
log "⏳ Medida INTERINA: se retira con el merge de D-PP-1 (DEVOPS_NOTES §43.2)."
exit 0

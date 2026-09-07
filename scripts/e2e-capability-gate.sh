#!/usr/bin/env bash
# =============================================================================
# scripts/e2e-capability-gate.sh — ¿este entorno PUEDE ejercitar COBRO y SUBIDA?
# Propiedad: devops  ·  TCG Vault MX
# =============================================================================
# POR QUÉ EXISTE (hallazgo de QA sobre el release del ciclo de compra, §39)
#
#   QA corrió el subset `@real` contra el stack vivo: **35 pasaron, 3 fallaron**.
#   Los tres rojos —`checkout.spec.ts`, `guest-checkout.spec.ts`,
#   `shipments.spec.ts`— murieron todos en el modal de pago, y la causa estaba en
#   el log del backend: `STRIPE_SECRET_KEY ausente; usando sk_test_dummy`.
#   Veredicto de QA, textual: «no son defecto de producto, pero tampoco los
#   declaro verdes — la ruta de cobro con tarjeta queda SIN VERIFICAR».
#   El segundo hueco del mismo arnés: sin MinIO en la ruta nativa, el smoke de
#   infraestructura se AUTO-SALTABA el PUT presignado (403 → `console.warn` →
#   `return`) ⇒ la subida del INE tampoco se ejercitaba, y la corrida salía verde.
#
#   Las dos cosas son EL MISMO defecto con dos caras: una capacidad ausente del
#   ENTORNO se contabiliza como «no aplica» en vez de como «no verificado». Y
#   lleva DOS releases así. Cita del gate: «una deuda que se acepta cada vez deja
#   de ser una excepción y pasa a ser el estado normal».
#
# QUÉ HACE
#   Mide, ANTES de que nadie corra la suite, si el entorno puede ejercitar:
#     · COBRO   — clave de PRUEBA de Stripe con forma de credencial (se delega en
#                 `scripts/stripe-test-key-preflight.sh`, que ya clasifica por
#                 forma), Y salida de red a `api.stripe.com`. Las DOS: una clave
#                 buena sin egress no monta el modal, y el rojo resultante parece
#                 un bug de producto.
#     · SUBIDA  — object storage que acepta un PUT PRESIGNADO firmado con las
#                 credenciales configuradas, y que RECHAZA uno firmado con otro
#                 secreto. Se comprueban las dos direcciones: un almacén que dice
#                 200 a todo no verifica nada, y un smoke contra él sería otro
#                 verde vacío.
#
#   Y decide un VEREDICTO. En modo `--require` (el de un gate) la capacidad
#   ausente es EXIT 1: el arnés falla A LA VISTA en vez de saltarse el flujo.
#   En modo informe (por defecto) sale 0 y deja el mapa escrito.
#
# QUÉ **NO** HACE
#   · No corre la suite E2E (eso es QA), no toca `frontend/e2e/` ni `backend/`.
#   · No llama a la API de Stripe con la clave (no autentica: mide FORMA + red).
#   · No escribe secretos: sólo prefijo y longitud, nunca el valor.
#
# USO
#   scripts/e2e-capability-gate.sh                      # informe, exit 0
#   scripts/e2e-capability-gate.sh --require-money      # exit 1 si no hay cobro
#   scripts/e2e-capability-gate.sh --require-uploads    # exit 1 si no hay subida
#   scripts/e2e-capability-gate.sh --require-all        # las dos (modo GATE)
#
# VARIABLES QUE LEE (ninguna se escribe en el repo)
#   STRIPE_TEST_SECRET_KEY / STRIPE_TEST_PUBLISHABLE_KEY  (o las STRIPE_* sin TEST_)
#   S3_ENDPOINT · S3_REGION · S3_BUCKET · S3_ACCESS_KEY_ID · S3_SECRET_ACCESS_KEY
#   S3_FORCE_PATH_STYLE
#   CAPABILITY_NODE_MODULES  ruta con @aws-sdk/* (default: backend/node_modules)
#
# SALIDA
#   0 = todo lo EXIGIDO está presente (o no se exigió nada).
#   1 = falta al menos una capacidad EXIGIDA. Mensaje con el motivo exacto.
#   2 = error de uso o no se pudo medir (que NO es lo mismo que «no hay»).
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

REQ_MONEY=0
REQ_UPLOADS=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --require-money)   REQ_MONEY=1; shift ;;
    --require-uploads) REQ_UPLOADS=1; shift ;;
    --require-all)     REQ_MONEY=1; REQ_UPLOADS=1; shift ;;
    -h|--help)         sed -n '2,72p' "$0"; exit 0 ;;
    *) echo "e2e-capability-gate: opción desconocida '$1'" >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
no()   { printf '\033[1;31m  ✖ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ⚠ %s\033[0m\n' "$*"; }

MONEY_OK=0;   MONEY_WHY=""
# `UPLOAD_MEASURED=0` distingue «NO DISPONIBLE» (se midió y no sirve) de «NO MEDIDA»
# (no se pudo mirar). Las dos son rojo cuando la capacidad se EXIGE —fallar cerrado—,
# pero llamarlas igual es la clase de imprecisión que hace que un informe se lea mal:
# «no disponible» invita a arreglar la infra; «no medida» invita a arreglar el medidor.
UPLOAD_OK=0;  UPLOAD_WHY="";  UPLOAD_MEASURED=1

# =============================================================================
# CAPACIDAD 1 — COBRO
# =============================================================================
log "Capacidad COBRO — ¿se puede ejercitar el pago con tarjeta?"

# (a) Forma de las claves. Se REUTILIZA el clasificador que ya existe en vez de
#     escribir un segundo criterio: dos detectores del mismo hecho acaban
#     divergiendo, y el que se queda viejo es el que da el falso verde.
SK="${STRIPE_TEST_SECRET_KEY:-${STRIPE_SECRET_KEY:-}}"
PK="${STRIPE_TEST_PUBLISHABLE_KEY:-${STRIPE_PUBLISHABLE_KEY:-}}"
# `SMOKE_SPECS` lleva un spec de dinero Y uno que no lo es a propósito: si sólo se
# le pasaran los de dinero, el preflight abortaría por «job vacío» (su propia guarda,
# §31.7) y aquí no se distinguiría «no hay clave» de «el preflight se rompió». Aquí
# no se corre ninguna suite: la lista es sólo el material sobre el que el preflight
# emite su veredicto.
PREFLIGHT_OUT="$(STRIPE_TEST_SECRET_KEY="$SK" STRIPE_TEST_PUBLISHABLE_KEY="$PK" \
                 SMOKE_SPECS="catalog.spec.ts checkout.spec.ts" REQUIRE_REAL_STRIPE=false \
                 MONEY_SPECS="checkout.spec.ts" \
                 GITHUB_OUTPUT= GITHUB_ENV= GITHUB_STEP_SUMMARY= \
                 "$SCRIPT_DIR/stripe-test-key-preflight.sh" 2>&1)"
PREFLIGHT_RC=$?
MONEY_GATE="$(printf '%s\n' "$PREFLIGHT_OUT" | sed -nE 's/^::out:: money_gate=(.*)$/\1/p' | tail -1)"

if [ "$PREFLIGHT_RC" -ne 0 ] && [ -z "$MONEY_GATE" ]; then
  MONEY_WHY="el preflight de Stripe abortó (clave live, formato desconocido o similar). Salida:
$(printf '%s\n' "$PREFLIGHT_OUT" | tail -6 | sed 's/^/       /')"
  no "claves de Stripe: NO utilizables."
elif [ "$MONEY_GATE" != "on" ]; then
  MONEY_WHY="STRIPE_TEST_SECRET_KEY / STRIPE_TEST_PUBLISHABLE_KEY no son credenciales
     utilizables (ausentes o de relleno). El backend degrada a \`sk_test_dummy\` y el modal
     de Stripe NO monta: los tres smokes de dinero mueren en el modal y el rojo PARECE un
     defecto de producto sin serlo. Detalle:
$(printf '%s\n' "$PREFLIGHT_OUT" | grep -E '^\| .STRIPE' | sed 's/^/       /')"
  no "claves de Stripe: ausentes o de relleno."
else
  ok "claves de Stripe: con forma de credencial de prueba."
  # (b) Red. Una clave buena sin salida a Stripe da exactamente el mismo rojo.
  #     Se mide, no se supone.
  if curl -sS -o /dev/null -m 12 https://api.stripe.com/v1 >/dev/null 2>&1; then
    ok "salida a api.stripe.com: disponible."
    MONEY_OK=1
  else
    MONEY_WHY="hay clave, pero NO hay salida de red a api.stripe.com desde esta máquina
     (curl falla). Sin egress el modal no monta ni con credencial buena: el gate de dinero
     NO puede vivir aquí, vive en CI (\`e2e-real.yml\`, DEVOPS_NOTES §31.2)."
    no "salida a api.stripe.com: BLOQUEADA."
  fi
fi

# =============================================================================
# CAPACIDAD 2 — SUBIDA (object storage)
# =============================================================================
log "Capacidad SUBIDA — ¿se puede ejercitar el PUT presignado del INE?"

S3_ENDPOINT_V="${S3_ENDPOINT:-}"
if [ -z "$S3_ENDPOINT_V" ]; then
  UPLOAD_WHY="S3_ENDPOINT no está definida: no hay object storage al que subir. La subida del
     INE (\`purpose: kyc_ine\`, única subida del producto y es PII) NO se puede ejercitar."
  no "S3_ENDPOINT: ausente."
else
  NODE_MODULES="${CAPABILITY_NODE_MODULES:-$ROOT_DIR/backend/node_modules}"
  if [ ! -d "$NODE_MODULES/@aws-sdk/s3-request-presigner" ]; then
    warn "no encuentro @aws-sdk/s3-request-presigner en $NODE_MODULES."
    warn "NO puedo medir la capacidad de subida ⇒ se reporta como NO MEDIDA, que no es"
    warn "lo mismo que ausente. (cd backend && npm ci)"
    UPLOAD_WHY="no se pudo MEDIR: falta @aws-sdk/s3-request-presigner en $NODE_MODULES."
    UPLOAD_MEASURED=0
  else
    # La prueba tiene DOS direcciones a propósito:
    #   (+) un PUT firmado con el secreto configurado debe ser aceptado;
    #   (−) un PUT firmado con OTRO secreto debe ser rechazado.
    # Sin la segunda, un almacén que contesta 200 a cualquier cosa pasaría por
    # bueno y el smoke de subida no mediría nada. (Medido: `s3rver` sin la guarda
    # de `scripts/s3-local/server.js` aceptaba el secreto equivocado con 200.)
    RESULT="$(NODE_PATH="$NODE_MODULES" node -e '
      const {S3Client, PutObjectCommand} = require("@aws-sdk/client-s3");
      const {getSignedUrl} = require("@aws-sdk/s3-request-presigner");
      const cfg = (secret) => new S3Client({
        region: process.env.S3_REGION || "us-east-1",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true") === "true",
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || "minioadmin", secretAccessKey: secret },
      });
      const bucket = process.env.S3_BUCKET || "tcg-photos";
      const body = Buffer.from("89504e470d0a1a0a", "hex");
      const put = async (secret, key) => {
        const url = await getSignedUrl(cfg(secret), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "image/png" }), { expiresIn: 300 });
        const r = await fetch(url, { method: "PUT", headers: { "content-type": "image/png" }, body });
        return r.status;
      };
      (async () => {
        const stamp = Date.now();
        const bueno = await put(process.env.S3_SECRET_ACCESS_KEY || "minioadmin_local_dev", `kyc_ine/_capability_${stamp}.png`);
        const malo  = await put("SECRETO_DELIBERADAMENTE_EQUIVOCADO", `kyc_ine/_capability_bad_${stamp}.png`);
        console.log(`OK=${bueno} BAD=${malo}`);
      })().catch((e) => { console.log(`ERR=${(e && e.message) || e}`); });
    ' 2>&1 | tail -1)"

    S_OK="$(printf '%s' "$RESULT" | sed -nE 's/.*OK=([0-9]+).*/\1/p')"
    S_BAD="$(printf '%s' "$RESULT" | sed -nE 's/.*BAD=([0-9]+).*/\1/p')"

    if [ -z "$S_OK" ]; then
      UPLOAD_WHY="no hubo respuesta del object storage en $S3_ENDPOINT_V: $RESULT"
      no "object storage: no responde ($S3_ENDPOINT_V)."
    elif [ "$S_OK" != "200" ] && [ "$S_OK" != "204" ]; then
      UPLOAD_WHY="el PUT presignado CORRECTO devolvió $S_OK (se esperaba 200/204) contra
     $S3_ENDPOINT_V. El almacén está arriba pero mal aprovisionado (bucket ausente, firma
     divergente o credenciales que no cuadran). Eso NO es «no disponible»: es un entorno roto."
      no "PUT presignado correcto: $S_OK."
    elif [ "$S_BAD" = "200" ] || [ "$S_BAD" = "204" ]; then
      UPLOAD_WHY="el object storage de $S3_ENDPOINT_V ACEPTA una firma hecha con OTRO secreto
     (devolvió $S_BAD). No verifica nada: un smoke de subida contra él sería un verde vacío.
     Esto es un DEFECTO DEL ENTORNO, no del producto."
      no "PUT presignado con secreto equivocado: ACEPTADO ($S_BAD) — el almacén no verifica."
    else
      ok "PUT presignado correcto aceptado ($S_OK) y firma inválida rechazada ($S_BAD)."
      UPLOAD_OK=1
    fi
  fi
fi

# =============================================================================
# VEREDICTO
# =============================================================================
printf '\n──────────────────────────────────────────────────────────────────────────────\n'
printf ' CAPACIDADES DEL ARNÉS E2E EN ESTE ENTORNO\n'
printf '──────────────────────────────────────────────────────────────────────────────\n'
printf '  COBRO  (checkout · guest-checkout · shipments) : %s%s\n' \
  "$( [ "$MONEY_OK" = 1 ] && printf 'DISPONIBLE' || printf 'NO DISPONIBLE' )" \
  "$( [ "$REQ_MONEY" = 1 ] && printf '   [EXIGIDA]' )"
printf '  SUBIDA (uploads/presign · INE del buylist)     : %s%s\n' \
  "$( [ "$UPLOAD_OK" = 1 ] && printf 'DISPONIBLE' || { [ "$UPLOAD_MEASURED" = 0 ] && printf 'NO MEDIDA' || printf 'NO DISPONIBLE'; } )" \
  "$( [ "$REQ_UPLOADS" = 1 ] && printf '   [EXIGIDA]' )"

FALTA=0
if [ "$REQ_MONEY" = 1 ] && [ "$MONEY_OK" != 1 ]; then FALTA=1; fi
if [ "$REQ_UPLOADS" = 1 ] && [ "$UPLOAD_OK" != 1 ]; then FALTA=1; fi

if [ "$FALTA" = 0 ]; then
  echo ""
  if [ "$REQ_MONEY" = 0 ] && [ "$REQ_UPLOADS" = 0 ]; then
    warn "Informe SIN exigencias: esto NO es un gate. Para gatear: --require-all."
    [ "$MONEY_OK" = 1 ]  || printf '  · COBRO no disponible: %s\n' "$MONEY_WHY"
    [ "$UPLOAD_OK" = 1 ] || printf '  · SUBIDA no disponible: %s\n' "$UPLOAD_WHY"
  else
    ok "Las capacidades EXIGIDAS están disponibles: la corrida puede ejercitarlas."
  fi
  exit 0
fi

printf '\n\033[1;31m══════════════════════════════════════════════════════════════════════════════\033[0m\n' >&2
printf '\033[1;31m ⛔ ESTE ENTORNO NO PUEDE EJERCITAR UN FLUJO QUE EL GATE EXIGE\033[0m\n' >&2
printf '\033[1;31m══════════════════════════════════════════════════════════════════════════════\033[0m\n' >&2
if [ "$REQ_MONEY" = 1 ] && [ "$MONEY_OK" != 1 ]; then
  printf '  · COBRO: %s\n' "$MONEY_WHY" >&2
fi
if [ "$REQ_UPLOADS" = 1 ] && [ "$UPLOAD_OK" != 1 ]; then
  printf '  · SUBIDA: %s\n' "$UPLOAD_WHY" >&2
fi
cat >&2 <<'EOF'

  ESTO ES ROJO A PROPÓSITO, Y NO ES UN DEFECTO DE PRODUCTO.
  Un flujo que el entorno no puede ejercitar queda SIN VERIFICAR — no «no aplica».
  Se puso en rojo porque la alternativa (saltárselo con un aviso) ya lleva DOS
  releases y dejó de ser una excepción: pasó a ser el estado normal.
  Ver docs/DEVOPS_NOTES.md §39 y docs/TECH_DEBT.md.

  QUÉ HACER (elige, pero decide — no lo dejes en «se salta»):
   · COBRO  → exporta una clave de PRUEBA real ANTES de levantar el stack:
                export STRIPE_TEST_SECRET_KEY=sk_test_…      # del dashboard, modo TEST
                export STRIPE_TEST_PUBLISHABLE_KEY=pk_test_…
              (nunca en un fichero del repo: el repo es público — §39.1)
              y hazlo en una máquina CON salida a api.stripe.com.
   · SUBIDA → ./scripts/stack-native.sh up   (levanta el S3 local en :9000)
              o la ruta Docker: docker compose up -d
   · Si no se puede aquí: NO declares esos flujos verdes. Córrelos en CI
     (`e2e-real.yml` con los secrets puestos) y cita ESE run en el veredicto.
EOF
exit 1

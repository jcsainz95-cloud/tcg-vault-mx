#!/usr/bin/env bash
# =============================================================================
# scripts/check-graded-estimate-dials.sh — Propiedad: devops
# TCG Vault MX — comparador SOLO-LECTURA de los 3 diales de v1.50.3 (§4.38p)
# =============================================================================
# QUÉ HACE (y qué NO hace, que importa más):
#
#   HACE   · `GET /admin/pricing/graded-estimates` contra el entorno destino.
#          · Compara `manualFreshnessDays`, `minSampleCount` y `maxRawMultiple`
#            contra el default NUEVO (30 / 5 / 100) y contra el seed VIEJO
#            (null / 3 / 50).
#          · Clasifica cada clave e IMPRIME el cuerpo exacto del `PUT` a aplicar,
#            conteniendo SOLO las claves que siguen en el seed viejo.
#
#   NO HACE · No escribe NADA. Ni `PUT`, ni `UPDATE`, ni un `curl -X` de escritura.
#            No hay bandera para que lo haga. La decisión de pisar un dial de
#            producción es del OPERADOR, no de un script (ARCHITECTURE §11.0-4).
#
# POR QUÉ EXISTE — la regla general de ARCHITECTURE §11.0:
#   `prisma/seed.ts` hace `upsert` con `update: {}` a propósito: un seed es una
#   CONDICIÓN INICIAL, no un estado deseado. Consecuencia verificada en vivo:
#   corregir un default en `settings.constants.ts` NO cambia ningún entorno ya
#   sembrado —incluida PRODUCCIÓN—. El código nuevo se despliega, los tests pasan
#   en verde, y el dial de prod sigue con el valor viejo. Falso verde.
#   Por eso cambiar el seed de una clave EXISTENTE exige DOS artefactos: el default
#   nuevo (sirve solo a entornos nuevos) Y un paso de despliegue explícito. Este
#   script es la mitad VERIFICABLE y sin riesgo del segundo.
#
# POR QUÉ NO AUTOMATIZA EL `PUT`:
#   `ConfigSetting` guarda un VALOR, no su PROCEDENCIA. «Sigue en el seed viejo» y
#   «el operador lo eligió así» son el MISMO dato, y `null`/`3`/`50` son elecciones
#   de operador perfectamente plausibles. Un `PUT` incondicional pisaría en silencio
#   un ajuste deliberado. Por eso: se compara, se informa, se pregunta.
#
# USO:
#   ADMIN_BASE_URL='https://api.tcghunt.mx/api/v1' \
#   ADMIN_JWT='<bearer de super_admin>' \
#     bash scripts/check-graded-estimate-dials.sh
#
#   Staging:  ADMIN_BASE_URL='https://<staging>/api/v1'
#   Local:    ADMIN_BASE_URL='http://127.0.0.1:3099/api/v1'
#
# CÓDIGOS DE SALIDA (pensados para leerse desde CI o desde post-deploy.sh):
#   0  — los tres diales ya están en su valor de criterio. Nada que hacer.
#   10 — hay claves EN EL SEED VIEJO ⇒ falta el `PUT` (el script lo imprime).
#   20 — hay claves que DIVERGEN de ambos valores ⇒ decisión del HUMANO.
#        (20 gana sobre 10: si algo diverge, se pregunta antes de aplicar nada.)
#   2  — error de uso / de entorno (falta var, falta jq, HTTP != 200, o el DTO
#        no trae una de las claves ⇒ el binario desplegado no es el que creemos).
#        2 gana sobre 20 y sobre 10: si no sabemos qué corre, no se toca nada.
#
# NUNCA imprime el JWT ni ningún secreto.
# =============================================================================
set -uo pipefail

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ⚠ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✖ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 2; }

ADMIN_BASE_URL="${ADMIN_BASE_URL:-}"
ADMIN_JWT="${ADMIN_JWT:-}"

[ -n "$ADMIN_BASE_URL" ] || die "Falta ADMIN_BASE_URL (p.ej. https://api.tcghunt.mx/api/v1)."
[ -n "$ADMIN_JWT" ]      || die "Falta ADMIN_JWT (bearer de super_admin). NO se imprime en la salida."
command -v jq >/dev/null 2>&1 || die \
  "Falta \`jq\`. NO se sustituye por grep a propósito: un parseo frágil puede clasificar mal un dial y llevar a pisar un valor deliberado."

# Normaliza: quita la barra final para no generar `//admin/...`
ADMIN_BASE_URL="${ADMIN_BASE_URL%/}"
ENDPOINT="$ADMIN_BASE_URL/admin/pricing/graded-estimates"

log "PASO 1 — GET $ENDPOINT  (solo lectura)"

OUT="$(mktemp)"; trap 'rm -f "$OUT"' EXIT
HTTP_CODE="$(curl -sS -o "$OUT" -w '%{http_code}' \
  -X GET "$ENDPOINT" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Accept: application/json'; true)"

if [ "$HTTP_CODE" != "200" ]; then
  bad "HTTP $HTTP_CODE — no se pudo leer la config."
  case "$HTTP_CODE" in
    401|403) warn "El token no es de \`super_admin\` o expiró (la ruta es @Roles(super_admin)).";;
    404)     warn "Ruta no encontrada: ¿el backend desplegado ya incluye v1.50 (GradedEstimatesController)?";;
    000)     warn "Ni siquiera conectó: revisa ADMIN_BASE_URL / egress / que el backend esté arriba.";;
  esac
  head -c 500 "$OUT" >&2; echo >&2
  exit 2
fi
jq -e . >/dev/null 2>&1 <"$OUT" || { bad "La respuesta no es JSON válido."; head -c 500 "$OUT" >&2; exit 2; }
ok "Config leída."

# -----------------------------------------------------------------------------
# PASO 2 — clasificar clave por clave.
#   nuevo = default corregido en v1.50.3 (`common/graded-estimate.ts`)
#   viejo = seed que quedó en cualquier base ya sembrada
# -----------------------------------------------------------------------------
log "PASO 2 — comparar contra los defaults nuevos"

# clave | default NUEVO | seed VIEJO | criterio que gobierna
KEYS=(
  "manualFreshnessDays|30|null|criterio 109 — el override manual decae a los 30 días"
  "minSampleCount|5|3|criterio 111(a) / §O.7 — minSalesSample = 5"
  "maxRawMultiple|100|50|criterio 111(c) / §O.7 — maxGradedMultiple = 100x"
)

PENDING_KEYS=()   # en el seed viejo ⇒ candidatas al PUT
PENDING_VALS=()
DIVERGENT=()      # ni lo uno ni lo otro ⇒ decisión del humano
ABSENT=()         # el DTO no la trae ⇒ el deploy no es el que creemos

printf '\n  %-22s %-12s %-12s %s\n' "CLAVE" "VIGENTE" "NUEVO" "ESTADO"
printf '  %-22s %-12s %-12s %s\n' "----------------------" "------------" "------------" "------"

for row in "${KEYS[@]}"; do
  IFS='|' read -r key new old why <<<"$row"
  cur="$(jq -c --arg k "$key" 'if has($k) then .[$k] else "__ABSENT__" end' "$OUT")"
  cur="${cur%\"}"; cur="${cur#\"}"   # desenvuelve el centinela si vino como string

  if [ "$cur" = "__ABSENT__" ]; then
    printf '  %-22s %-12s %-12s ' "$key" "(ausente)" "$new"; bad "el DTO no trae la clave"
    ABSENT+=("$key|$why")
  elif [ "$cur" = "$new" ]; then
    printf '  %-22s %-12s %-12s ' "$key" "$cur" "$new"; ok "AL DÍA"
  elif [ "$cur" = "$old" ]; then
    printf '  %-22s %-12s %-12s ' "$key" "$cur" "$new"; warn "SEED VIEJO ⇒ falta aplicar"
    PENDING_KEYS+=("$key"); PENDING_VALS+=("$new")
  else
    printf '  %-22s %-12s %-12s ' "$key" "$cur" "$new"; bad "DIVERGE ⇒ decisión del HUMANO"
    DIVERGENT+=("$key|$cur|$new|$why")
  fi
done

# -----------------------------------------------------------------------------
# PASO 3 — qué hacer con el resultado.
# -----------------------------------------------------------------------------
RC=0

if [ ${#ABSENT[@]} -gt 0 ]; then
  RC=2
  log "PASO 3a — CLAVE AUSENTE DEL DTO: esto NO es una decisión del humano, es un error"
  cat <<'EOF'
  El `GET` respondió 200 pero no trae la clave. Eso NO significa «no configurada»:
  el DTO la proyecta SIEMPRE (`toGradedEstimateConfigDTO`), aun cuando la fila no
  exista (cae al default de código). Que falte significa que el backend desplegado
  en este entorno es ANTERIOR a v1.50.2, o que el contrato cambió.

  ⇒ Parar. No aplicar ningún `PUT` a ciegas: se estaría configurando un binario que
    no es el que creemos que está corriendo. Verificar qué versión sirve este
    entorno antes de seguir. Hallazgo para BACKEND/arquitecto si el binario es el
    correcto y aun así falta la clave.
EOF
  for a in "${ABSENT[@]}"; do
    IFS='|' read -r k why <<<"$a"
    printf '    · %-22s ausente del DTO  (%s)\n' "$k" "$why"
  done
fi

if [ ${#DIVERGENT[@]} -gt 0 ]; then
  [ "$RC" = 2 ] || RC=20
  log "PASO 3b — DIVERGENCIAS: NO SE PISAN. Se pregunta al dueño."
  cat <<'EOF'
  Un valor que no es ni el default nuevo ni el seed viejo significa que ALGUIEN
  LO AJUSTÓ A PROPÓSITO. `ConfigSetting` guarda un valor, no su procedencia: no
  hay forma de distinguir «se quedó así» de «lo eligió así», y adivinar en la
  dirección equivocada deroga en silencio un criterio de PROJECT.md o tira por
  tierra una decisión del operador.

  ⇒ Este script NO propone `PUT` para estas claves. Se le presentan al dueño con
    el valor actual y el default nuevo delante, y DECIDE ÉL, CLAVE POR CLAVE.
EOF
  for d in "${DIVERGENT[@]}"; do
    IFS='|' read -r k cur new why <<<"$d"
    printf '    · %-22s vigente=%-10s default nuevo=%-6s  (%s)\n' "$k" "$cur" "$new" "$why"
  done
fi

if [ ${#PENDING_KEYS[@]} -gt 0 ]; then
  [ "$RC" = 0 ] && RC=10
  log "PASO 3c — Claves en el SEED VIEJO: este es el \`PUT\` a ejecutar (a mano)"

  BODY='{'
  for i in "${!PENDING_KEYS[@]}"; do
    [ "$i" = 0 ] || BODY="$BODY,"
    BODY="$BODY \"${PENDING_KEYS[$i]}\": ${PENDING_VALS[$i]}"
  done
  BODY="$BODY }"

  cat <<EOF
  Cuerpo PARCIAL — contiene SOLO las claves que siguen en el seed viejo. Las que
  ya estaban al día NO van en el body: reenviarlas es una escritura auditada sin
  cambio, ruido en el AuditLog.

    curl -X PUT "\$ADMIN_BASE_URL/admin/pricing/graded-estimates" \\
         -H "Authorization: Bearer \$ADMIN_JWT" \\
         -H 'Content-Type: application/json' \\
         -d '$BODY'

  ⚠ PROHIBIDO hacerlo con un \`UPDATE\` a la base, aunque sea más rápido:
      · el \`PUT\` queda AUDITADO (AuditLog, M10: quién tocó un dial que gobierna
        una afirmación comercial, y cuándo). El SQL no deja rastro.
      · el \`PUT\` pasa las VALIDACIONES I1–I9. Un \`UPDATE\` puede dejar la clave
        PRESENTE-E-INVÁLIDA, y eso APAGA la feature por fail-closed (§4.38d).
      · el \`PUT\` surte efecto SIN REDEPLOY.
    SQL directo se salta las tres.
EOF
fi

if [ "$RC" = 0 ]; then
  log "PASO 3 — nada que aplicar"
  ok "Los tres diales están en su valor de criterio en este entorno."
fi

log "PASO 4 — verificación de cierre (NO es opcional)"
cat <<'EOF'
  Un `PUT` con HTTP 200 dice que la escritura se aceptó, no que el criterio se
  cumple. Después de aplicar:
    1. Repetir este script: debe salir con código 0 y los tres AL DÍA.
    2. Reiniciar el backend y leer la LÍNEA DE INVENTARIO del arranque (`info`):
         railway logs --service backend | grep 'config inventory'
         grep 'config inventory' .native-stack/backend.log      # stack nativo
       Enumera los diales cuyo valor vigente DIFIERE de su default de código, con
       ambos números. Si estas tres ya no aparecen, el entorno está alineado.
       ⇒ `grep`, no consulta a la BD de prod. Ver DEVOPS_NOTES §32.5.
    3. STAGING (no prod — ver DEVOPS_NOTES §32.5): correr el E2E del criterio 109
         cd backend && DATABASE_URL='<staging>' \
           npx jest --config test/jest-integration.config.js --runInBand \
             test/integration/graded-estimate.e2e-spec.ts -t '8d'
       Ese test ESCRIBE (fija el dial, crea PriceReference sobre una carta fixture
       y envejece filas por SQL). Contra PROD no se corre.
EOF

exit "$RC"

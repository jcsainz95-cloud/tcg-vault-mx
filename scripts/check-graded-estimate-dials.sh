#!/usr/bin/env bash
# =============================================================================
# scripts/check-graded-estimate-dials.sh — Propiedad: devops
# TCG Vault MX — comparador SOLO-LECTURA del gancho de grading
#   · v1.50.3 (§4.38p): los 3 diales de M2 (manualFreshnessDays / minSampleCount /
#     maxRawMultiple) contra su default nuevo.
#   · v1.51  (§4.38r, M-46): el **DIAL ÚNICO** `grading_hook_enabled` — el que
#     gobierna EXHIBICIÓN **Y** OBTENCIÓN (créditos de un proveedor de paga).
# =============================================================================
# QUÉ HACE (y qué NO hace, que importa más):
#
#   HACE   · `GET /admin/settings` → lee `gradingHookEnabled`, **el dial** (v1.51).
#          · `GET /admin/pricing/graded-estimates` → los 10 diales de M2.
#          · Compara `manualFreshnessDays`, `minSampleCount` y `maxRawMultiple`
#            contra el default NUEVO (30 / 5 / 100) y contra el seed VIEJO
#            (null / 3 / 50).
#          · Clasifica cada clave e IMPRIME el cuerpo exacto del `PUT` a aplicar,
#            conteniendo SOLO las claves que siguen en el seed viejo.
#          · Traduce `ingestMaxCardsPerRun` a **créditos/día** (el presupuesto de
#            §4.38r.3.1), porque un tope que nadie tradujo a créditos no es un
#            presupuesto: es un número.
#          · Detecta que el binario desplegado es **PRE-M-46** (proyecta claves
#            retiradas o `ingestEnabled`) y para en seco.
#
#   NO HACE · No escribe NADA. Ni `PUT`, ni `UPDATE`, ni un `curl -X` de escritura.
#            No hay bandera para que lo haga. La decisión de pisar un dial de
#            producción es del OPERADOR, no de un script (ARCHITECTURE §11.0-4).
#            **Y desde v1.51 encender el dial es un acto de DINERO** (§4.38r.3):
#            lo hace EL DUEÑO desde M10, con el aviso delante. Nunca este script.
#
# ⚠️ LA TRAMPA DE DIAGNÓSTICO QUE ESTE SCRIPT EXISTE PARA NO CAER (§4.38r.1)
#   En toda base ya sembrada SOBREVIVEN, huérfanas e inertes, las dos claves que
#   M-46 retiró: `graded_estimates_enabled` y `graded_estimate_ingest_enabled`.
#   No se borran a propósito (borrarlas sería escribir en la config de producción
#   para lograr CERO efecto, §11.0-4; y son lo que mantiene fail-closed al código
#   viejo si hay rollback). El precio es que **mienten a quien lea la tabla a
#   pelo**: el día del incidente alguien ve `graded_estimate_ingest_enabled=off`
#   y concluye que el ingest está apagado **mientras gasta**.
#   Este script NO consulta esas dos claves, y no puede: la API ya no las
#   proyecta. Si alguna aparece en una respuesta, es que el binario desplegado
#   es anterior a M-46 ⇒ se para (rc=2). Para VERLAS —y verlas rotuladas— la vía
#   es la línea de inventario del arranque:
#       railway logs --service backend | grep 'config inventory'
#   que las lista bajo «claves RETIRADAS presentes en la base (INERTES, NO SE
#   LEEN)». Ver DEVOPS_NOTES §32.12.
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
#   0  — los tres diales de M2 están en su valor de criterio. El estado del dial
#        único (`on`/`off`) se REPORTA, no cambia el código: `on` es una decisión
#        legítima del dueño, y `off` es el estado normal antes de que decida.
#   10 — hay claves EN EL SEED VIEJO ⇒ falta el `PUT` (el script lo imprime).
#   20 — hay claves que DIVERGEN de ambos valores ⇒ decisión del HUMANO.
#        (20 gana sobre 10: si algo diverge, se pregunta antes de aplicar nada.)
#        Incluye el dial único con un valor que no es `on` ni `off`.
#   2  — error de uso / de entorno / de CONTRATO (falta var, falta jq, HTTP != 200,
#        el DTO no trae una clave, o trae una que M-46 retiró ⇒ el binario
#        desplegado no es el que creemos). 2 gana sobre 20 y sobre 10: si no
#        sabemos qué corre, no se toca nada.
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
SETTINGS_ENDPOINT="$ADMIN_BASE_URL/admin/settings"

OUT="$(mktemp)"; SET_OUT="$(mktemp)"; trap 'rm -f "$OUT" "$SET_OUT"' EXIT

# `get_json <url> <fichero> <etiqueta>` — GET autenticado, 200 + JSON o muere (rc=2).
get_json() {
  local url="$1" dest="$2" label="$3" code
  code="$(curl -sS -o "$dest" -w '%{http_code}' \
    -X GET "$url" \
    -H "Authorization: Bearer $ADMIN_JWT" \
    -H 'Accept: application/json'; true)"
  if [ "$code" != "200" ]; then
    bad "HTTP $code — no se pudo leer $label."
    case "$code" in
      401|403) warn "El token no es de \`super_admin\` o expiró (la ruta es @Roles(super_admin)).";;
      404)     warn "Ruta no encontrada: ¿el backend desplegado ya incluye v1.50/v1.51?";;
      000)     warn "Ni siquiera conectó: revisa ADMIN_BASE_URL / egress / que el backend esté arriba.";;
    esac
    head -c 500 "$dest" >&2; echo >&2
    exit 2
  fi
  jq -e . >/dev/null 2>&1 <"$dest" || { bad "La respuesta de $label no es JSON válido."; head -c 500 "$dest" >&2; exit 2; }
}

# `field <fichero> <clave>` — valor compacto, o el centinela `__ABSENT__` si la clave
# NO está. Se distingue AUSENTE de `null`: `null` es un valor legítimo
# (`manualFreshnessDays`), AUSENTE significa «este binario no proyecta la clave».
field() {
  local v
  v="$(jq -c --arg k "$2" 'if has($k) then .[$k] else "__ABSENT__" end' "$1")"
  v="${v%\"}"; v="${v#\"}"
  printf '%s' "$v"
}

# =============================================================================
# PASO 0 — EL DIAL ÚNICO (v1.51, M-46). Va PRIMERO porque es el único que gasta.
# =============================================================================
log "PASO 0 — GET $SETTINGS_ENDPOINT  (solo lectura) — el DIAL ÚNICO del gancho"
get_json "$SETTINGS_ENDPOINT" "$SET_OUT" "los diales de M10"

RC=0

# --- 0.a Claves RETIRADAS que el binario no debería proyectar nunca más --------
# `getAllDto()` itera SETTING_DTO_MAP: si una clave está en el mapa, SIEMPRE viaja
# (cae al default cuando no hay fila). Que aparezca ⇒ el mapa aún las tiene ⇒
# binario PRE-M-46. No es una opinión sobre el valor: es sobre QUÉ código corre.
RETIRED_SEEN=()
for dead in gradedEstimatesEnabled gradedEstimateIngestEnabled; do
  [ "$(field "$SET_OUT" "$dead")" = "__ABSENT__" ] || RETIRED_SEEN+=("$dead")
done
if [ ${#RETIRED_SEEN[@]} -gt 0 ]; then
  RC=2
  bad "El DTO de M10 todavía proyecta clave(s) que M-46 RETIRÓ: ${RETIRED_SEEN[*]}"
  cat <<'EOF'
  Este entorno corre un binario ANTERIOR a v1.51 (M-46). Consecuencia que hay que
  decir entera: en ese código HAY DOS DIALES, y el que gobierna el gasto
  (`graded_estimate_ingest_enabled`) NO es el que este script lee. Cualquier
  conclusión de aquí abajo sobre «gasta / no gasta» sería sobre el dial equivocado.

  ⇒ Parar. Verificar qué versión sirve este entorno (§32.12 paso 1) antes de seguir.
EOF
fi

# --- 0.b El dial ---------------------------------------------------------------
DIAL="$(field "$SET_OUT" gradingHookEnabled)"
printf '\n  %-24s %s\n' "gradingHookEnabled" "$DIAL"

case "$DIAL" in
  __ABSENT__)
    RC=2
    bad "El DTO de M10 NO trae \`gradingHookEnabled\`."
    cat <<'EOF'
  AUSENTE NO significa «apagado»: significa que NO SABES en qué estado está el
  gancho en este entorno. La clave viaja SIEMPRE en el DTO (`getAllDto()` recorre
  SETTING_DTO_MAP y cae al default cuando la fila no existe), así que su ausencia
  solo puede querer decir que el binario desplegado es anterior a M-46 (v1.51) o
  que el contrato cambió.

  ⇒ Parar. No se concluye nada sobre el gasto con el dial sin leer.
EOF
    ;;
  off)
    ok "Dial en \`off\` — el gancho está OSCURO: ni exhibe, ni pide al proveedor, ni escribe precios."
    echo "    (Estado normal antes de que EL DUEÑO decida encenderlo. Ausencia de fila ⇒ default \`off\`.)"
    ;;
  on)
    warn "Dial en \`on\` — EL GANCHO ESTÁ ENCENDIDO: publica cifras Y AUTORIZA GASTO."
    cat <<'EOF'
    Con `on`, cada tick del cron `price-ingest` (2×/día) pide datos al proveedor DE
    PAGA y escribe precios estimados. No es un ajuste de vitrina: es dinero corriendo.
    Si esto NO era lo esperado en este entorno, la palanca de apagado es
    `PUT /admin/settings {"gradingHookEnabled":"off"}` desde M10 (auditado), y el
    hallazgo se escala al dueño — NO se apaga por SQL (§11.0-4).
EOF
    ;;
  *)
    [ "$RC" = 2 ] || RC=20
    bad "Dial con valor INESPERADO: \`$DIAL\` (solo \`on\`/\`off\` son válidos)."
    cat <<'EOF'
    El código es fail-closed y ESTRICTO (`v === 'on'`), así que un valor raro se
    comporta como `off`. Pero que ahí haya algo que nadie sabe quién escribió es un
    hallazgo por sí mismo: se corrige por `PUT` de admin (auditado y validado), no
    por SQL, y se pregunta al dueño antes.
EOF
    ;;
esac

cat <<'EOF'

  ── Las claves RETIRADAS por M-46 NO se consultan aquí, y no es un olvido ──
  `graded_estimates_enabled` y `graded_estimate_ingest_enabled` siguen en la tabla
  de cualquier base ya sembrada, INERTES: ningún código las lee. La API ya no las
  proyecta, así que este script NO puede —ni debe— deducir nada de ellas. Para
  verlas, ROTULADAS, está la línea de inventario del arranque:
      railway logs --service backend | grep 'config inventory'
      grep 'config inventory' .native-stack/backend.log      # stack nativo
  ⇒ «graded_estimate_ingest_enabled = off» NO significa que el ingest esté apagado.
    Lo que gobierna la obtención es el dial de arriba. DEVOPS_NOTES §32.12.
EOF

# =============================================================================
# PASO 1 — los 10 diales de M2
# =============================================================================
log "PASO 1 — GET $ENDPOINT  (solo lectura)"
get_json "$ENDPOINT" "$OUT" "la config del gancho"
ok "Config leída."

# --- 1.a `ingestEnabled` tuvo que desaparecer del DTO (§4.38r.1) --------------
if [ "$(field "$OUT" ingestEnabled)" != "__ABSENT__" ]; then
  RC=2
  bad "El DTO de M2 todavía trae \`ingestEnabled\`: binario PRE-M-46 (v1.51 lo retiró)."
  echo "    Mismo diagnóstico que 0.a: en ese código el gasto lo gobierna OTRO dial."
fi

# --- 1.b El espejo tiene que reflejar --------------------------------------------
# `enabled` es el ESPEJO READ-ONLY del dial (`toGradedEstimateConfigDTO`): no lo
# apaga una clave de curaduría corrupta. Que las dos superficies del MISMO dial
# discrepen no es un ajuste del operador: es incoherencia del binario.
MIRROR="$(field "$OUT" enabled)"
case "$DIAL:$MIRROR" in
  on:true|off:false) ok "El espejo \`enabled\`=$MIRROR concuerda con el dial \`$DIAL\`." ;;
  __ABSENT__:*)      : ;;  # ya reportado en 0.b; no se dobla el ruido
  *:__ABSENT__)
    RC=2
    bad "El DTO de M2 no trae \`enabled\` (espejo del dial). Contrato roto ⇒ hallazgo para BACKEND." ;;
  *)
    RC=2
    bad "INCOHERENCIA: dial \`$DIAL\` pero espejo \`enabled\`=$MIRROR."
    echo "    Las dos superficies del mismo dial discrepan. NO se decide nada con esto abierto:"
    echo "    hallazgo para BACKEND/arquitecto (§4.38r.1: \`enabled\` es espejo puro del dial)." ;;
esac

# =============================================================================
# PASO 2 — clasificar clave por clave.
#   nuevo = default corregido en v1.50.3 (`common/graded-estimate.ts`)
#   viejo = seed que quedó en cualquier base ya sembrada
# =============================================================================
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
  cur="$(field "$OUT" "$key")"

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

# =============================================================================
# PASO 3 — EL PRESUPUESTO EN CRÉDITOS (§4.38r.3.1 punto 1)
#   `ingestMaxCardsPerRun` dejó de ser un tope de comodidad: es **la única cota
#   entre un `PUT` y la factura del proveedor**. Aquí se traduce a créditos, con
#   los tres factores a la vista, porque un tope que nadie tradujo a créditos no
#   es un presupuesto: es un número.
# =============================================================================
log "PASO 3 — presupuesto de créditos que autoriza el dial (§4.38r.3.1)"

MAXCARDS="$(field "$OUT" ingestMaxCardsPerRun)"
# Constantes del cálculo, NO configurables por env a propósito: si cambian, cambian
# en el código que las produce y este script debe actualizarse con la fuente delante.
#   · 2 créditos/carta  ← `includeEbay=true` (§4.38h.3, ARCHITECTURE:7947)
#   · 2 corridas/día    ← cron `price-ingest` (§19.3)
CREDITS_PER_CARD=2
RUNS_PER_DAY=2

if [ "$MAXCARDS" = "__ABSENT__" ]; then
  RC=2
  bad "El DTO no trae \`ingestMaxCardsPerRun\`: no se puede calcular el presupuesto."
  echo "    Sin ese número, encender el dial es autorizar un gasto de tope DESCONOCIDO."
elif ! printf '%s' "$MAXCARDS" | grep -Eq '^[0-9]+$'; then
  RC=2
  bad "\`ingestMaxCardsPerRun\` no es un entero (\`$MAXCARDS\`): presupuesto INCALCULABLE."
else
  PER_RUN=$(( MAXCARDS * CREDITS_PER_CARD ))
  PER_DAY=$(( PER_RUN * RUNS_PER_DAY ))
  printf '\n  %s cartas/corrida × %s créditos/carta × %s corridas/día = \033[1m%s créditos/día\033[0m (TECHO)\n' \
    "$MAXCARDS" "$CREDITS_PER_CARD" "$RUNS_PER_DAY" "$PER_DAY"
  printf '  (%s créditos por corrida; %s créditos/mes de 30 días)\n' "$PER_RUN" "$(( PER_DAY * 30 ))"
  cat <<'EOF'

  Es un TECHO, no una previsión: solo se pide por cartas RAW publicadas y en
  alcance, así que el gasto real es ≤ este número. Y es un techo que se mueve sin
  redeploy: `PUT /admin/pricing/graded-estimates {"ingestMaxCardsPerRun": N}`
  multiplica la factura por N/actual en la corrida siguiente. Antes de subirlo, el
  número que manda es el MEDIDO en la primera corrida real, no una estimación.
EOF
fi

# =============================================================================
# PASO 4 — qué hacer con el resultado.
# =============================================================================

if [ ${#ABSENT[@]} -gt 0 ]; then
  RC=2
  log "PASO 4a — CLAVE AUSENTE DEL DTO: esto NO es una decisión del humano, es un error"
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
  log "PASO 4b — DIVERGENCIAS: NO SE PISAN. Se pregunta al dueño."
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
  log "PASO 4c — Claves en el SEED VIEJO: este es el \`PUT\` a ejecutar (a mano)"

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

  ⚠ Este \`PUT\` es de los diales de M2 y NO enciende el gancho. El dial único vive
    en M10 (\`PUT /admin/settings {"gradingHookEnabled":"on"}\`), lo toca EL DUEÑO,
    y encenderlo empieza a gastar (§4.38r.3). Que este script imprima un \`PUT\` no
    autoriza aquel.

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
  log "PASO 4 — nada que aplicar"
  ok "Los tres diales de M2 están en su valor de criterio en este entorno."
  ok "Dial único del gancho: \`$DIAL\` (reportado, no juzgado: encenderlo es del dueño)."
fi

log "PASO 5 — verificación de cierre (NO es opcional)"
cat <<'EOF'
  Un `PUT` con HTTP 200 dice que la escritura se aceptó, no que el criterio se
  cumple. Después de aplicar:
    1. Repetir este script: debe salir con código 0 y los tres AL DÍA.
    2. Reiniciar el backend y leer la LÍNEA DE INVENTARIO del arranque (`info`):
         railway logs --service backend | grep 'config inventory'
         grep 'config inventory' .native-stack/backend.log      # stack nativo
       Enumera los diales cuyo valor vigente DIFIERE de su default de código, con
       ambos números, Y —desde v1.51— las claves RETIRADAS presentes, rotuladas.
       ⇒ `grep`, no consulta a la BD de prod. Ver DEVOPS_NOTES §32.5 y §32.12.
    3. STAGING (no prod — ver DEVOPS_NOTES §32.5): correr el E2E del criterio 109
         cd backend && DATABASE_URL='<staging>' \
           npx jest --config test/jest-integration.config.js --runInBand \
             test/integration/graded-estimate.e2e-spec.ts -t '8d'
       Ese test ESCRIBE (fija el dial, crea PriceReference sobre una carta fixture
       y envejece filas por SQL). Contra PROD no se corre.
    4. v1.51 — VERIFICACIÓN POSITIVA DE AUSENCIA DE GASTO con el dial en `off`:
       disparar `POST /admin/jobs/price-ingest {}` y comprobar en el log
       `graded-estimate-ingest: dial ... = off`, `written=0` y CERO peticiones al
       proveedor. «No vimos cargos» no es una verificación. DEVOPS_NOTES §32.12.
EOF

exit "$RC"

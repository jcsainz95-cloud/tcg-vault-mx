#!/usr/bin/env bash
#
# check-stripe-webhook-failclosed.sh — «la firma del webhook NUNCA se verifica
# con una clave que el atacante conoce (y mucho menos con la vacía)» ·  devops
# =============================================================================
# EL HALLAZGO QUE ORIGINA ESTE CANDADO — P-WH-1 (ALTA, explotado EN VIVO)
# ---------------------------------------------------------------------------
# `backend/src/modules/payments/stripe.service.ts` verificaba la firma así:
#
#     const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
#     return this.stripe.webhooks.constructEvent(payload, signature, secret);
#
# Con el secreto AUSENTE, ese `?? ''` no apaga la verificación: la degrada a una
# clave VACÍA, que cualquiera puede computar. El pentester firmó un
# `payment_intent.succeeded` con clave vacía y **liquidó un pedido y movió la
# carta a la bóveda del comprador sin que entrara un peso** (contra Postgres
# real, no deducido). La guarda de arranque solo miraba `NODE_ENV==='production'`,
# así que cualquier OTRO entorno con Stripe cableado era forjable.
#
# LA FAMILIA A LA QUE PERTENECE: la verificación **degradaba en silencio a cero**.
# No hay rojo, no hay log, no hay excepción: hay un 200 y un pedido liquidado.
# Es el mismo patrón del candado DAST sin blanco (§44) y de la paridad que
# avisaba sin gatear (§48.1) — un control que no puede fallar tampoco puede
# proteger.
#
# QUÉ VIGILA, Y POR QUÉ ESTAS DOS COSAS Y NO OTRAS
# ---------------------------------------------------------------------------
# El invariante es UNO: *la clave con la que se verifica la firma no puede ser
# ni vacía ni un literal que esté escrito en este repo*. Se comprueba por dos
# caminos porque fallan de forma INDEPENDIENTE y cubren universos distintos:
#
#   (A) CÓDIGO — cubre TODOS los entornos, incluidos los que no puedo ver.
#       El repo no sabe —ni puede saber— qué variables tiene puestas el
#       dashboard de Railway (ver DEVOPS_NOTES §49.1: el `NODE_ENV` real del
#       deploy NO es determinable desde aquí). Lo único que vale para un
#       entorno que no puedo inspeccionar es que el CÓDIGO se niegue a
#       degradar. Por eso (A) es la comprobación PRINCIPAL.
#
#   (B) CONFIG — cubre los entornos que SÍ están definidos en el repo
#       (compose local, compose de staging, workflows de CI/E2E, arnés nativo,
#       `.env.example`). Aquí sí puedo exigir que el secreto exista y no pueda
#       resolver a cadena vacía. (B) no sustituye a (A): si mañana alguien
#       levanta el backend a mano sin la variable, (B) no lo ve y (A) sí.
#
# Lo que este candado **NO** comprueba, a propósito:
#   · Que `constructEvent` reciba sus 3 argumentos → eso ya es una regla local
#     de semgrep (`stripe-webhook-verify-signature`, security/semgrep.yml) y no
#     se duplica aquí. Son hechos distintos: semgrep mira que se llame bien;
#     esto mira que el TERCER ARGUMENTO no pueda degradar. Ninguno de los dos
#     veía P-WH-1 antes de existir este fichero.
#   · Qué valor tiene la variable en Railway/Vercel. No es medible desde el
#     repo y este script no lo finge: ver DEVOPS_NOTES §49.1.
#
# Uso:
#   ./scripts/check-stripe-webhook-failclosed.sh            # sobre este repo
#   ./scripts/check-stripe-webhook-failclosed.sh --root DIR # sobre una COPIA
#                                                           # (lo usa el canario)
# Sale 0 si el candado está satisfecho; 1 con el fichero:línea exacto que falla.
# Barato: sin red, sin Docker, sin node. ~0.2 s.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ]; then
  [ -n "${2:-}" ] || { echo "--root necesita un directorio"; exit 2; }
  ROOT_DIR="$(cd "$2" && pwd)"
fi

VAR='STRIPE_WEBHOOK_SECRET'
FALLOS=0
PASADAS=0
ok()   { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }
note() { printf '      %s\n' "$*"; }

printf '\n\033[1m== ¿Puede la firma del webhook de Stripe verificarse con una clave conocida? (P-WH-1) ==\033[0m\n\n'

# Ficheros que hablan DEL candado y por eso contienen sus propios patrones. Si
# se escanearan, el candado se denunciaría a sí mismo. Lista corta y explícita:
# cualquier fichero nuevo que necesite entrar aquí es una señal de que el
# patrón se está copiando a sitios donde no debería estar.
AUTOEXCLUIDOS=(
  "scripts/check-stripe-webhook-failclosed.sh"
  "scripts/check-stripe-webhook-failclosed-canary.sh"
  # S-88-1: el canario de la CLASE le da al preflight, como DATO de prueba, el
  # valor publicado exacto que seguridad usó para demostrar el punto ciego
  # (`sk_live_… + whsec_e2e_test_secret`). Sin esta línea, el candado del webhook
  # se pone rojo por el fichero que demuestra que el candado del webhook funciona.
  "scripts/check-secret-defaults-canary.sh"
  "scripts/check-secret-defaults.sh"
  "scripts/secrets-preflight.sh"
  "scripts/gen-published-secrets-manifest.sh"
)
es_autoexcluido() {
  local f="$1" x
  for x in "${AUTOEXCLUIDOS[@]}"; do [ "$f" = "$x" ] && return 0; done
  return 1
}

# Quita comentarios de línea completa (`#…`) conservando el número de línea.
sin_comentarios() { grep -nv '^[[:space:]]*#' "$1" 2>/dev/null; }

# Igual, para TypeScript: fuera las líneas que son comentario (`//`, `/*`, ` *`)
# y fuera la COLA `// …` de las que mezclan código y comentario. Hace falta de
# verdad: este mismo hallazgo dejó en `stripe.service.ts` un bloque JSDoc que
# CITA el bug (`?? ''`) para explicarlo. Sin este filtro el candado se pondría
# rojo por la documentación del arreglo — o sea, castigaría explicarlo.
# El código a la IZQUIERDA de un `//` se conserva: no se puede esconder un
# fallback detrás de un comentario en la misma línea.
sin_comentarios_ts() {
  grep -n '' "$1" 2>/dev/null \
    | grep -vE '^[0-9]+:[[:space:]]*(//|/\*|\*)' \
    | sed 's|//[^"'"'"']*$||'
}

# -----------------------------------------------------------------------------
# (A) CÓDIGO — la verificación no puede caer a NINGÚN literal.
#
# Se prohíbe cualquier `??`/`||` cuyo lado derecho sea un literal de cadena en
# una línea que hable del secreto del webhook o de `constructEvent`. Nótese que
# se prohíbe el literal VACÍO **y** el no vacío: un `?? 'whsec_dev'` no es mejor
# — es una clave que está escrita en un repo público, o sea, una clave que el
# atacante también tiene. En los dos casos la firma deja de probar nada.
#
# Los ficheros de test (`*.spec.ts`, `test/`) quedan fuera: ahí un literal es
# un fixture, no una degradación de producción.
# -----------------------------------------------------------------------------
printf '\033[1m(A) Código: la clave de verificación no puede caer a un literal\033[0m\n'

CODIGO_SRC="$ROOT_DIR/backend/src"
if [ ! -d "$CODIGO_SRC" ]; then
  bad "No existe backend/src bajo $ROOT_DIR: no puedo comprobar (A). Un candado que no encuentra su blanco NO es verde."
else
  HALLAZGOS_A=""
  while IFS= read -r f; do
    case "$f" in *.spec.ts|*/test/*) continue ;; esac
    rel="${f#"$ROOT_DIR"/}"
    es_autoexcluido "$rel" && continue
    # Línea que menciona el secreto o la verificación Y contiene un fallback a literal.
    hits="$(sin_comentarios_ts "$f" \
      | grep -E "(${VAR}|webhooks\.constructEvent|constructEvent\()" \
      | grep -E "(\?\?|\|\|)[[:space:]]*('[^']*'|\"[^\"]*\"|\`[^\`]*\`)" || true)"
    if [ -n "$hits" ]; then
      while IFS= read -r h; do
        HALLAZGOS_A="${HALLAZGOS_A}${rel}:${h}"$'\n'
      done <<< "$hits"
    fi
  done < <(find "$CODIGO_SRC" -type f -name '*.ts' 2>/dev/null | sort)

  if [ -n "$HALLAZGOS_A" ]; then
    bad "La verificación de la firma puede caer a un literal (P-WH-1 vivo o de vuelta):"
    while IFS= read -r l; do [ -n "$l" ] && note "$l"; done <<< "$HALLAZGOS_A"
    note ""
    note "Qué significa: con el secreto ausente, la firma se verifica con una clave"
    note "que el atacante conoce ⇒ cualquiera puede forjar un evento de Stripe y"
    note "liquidar un pedido sin cobrar (verificado en vivo por el pentester)."
    note "Dueño del arreglo: **backend** (no devops). Lo que se espera ahí es"
    note "fail-closed INCONDICIONAL: sin secreto, no se verifica nada — se RECHAZA,"
    note "en todo NODE_ENV, no solo en producción."
  else
    ok "Ninguna ruta de verificación cae a un literal en backend/src."
  fi
fi

# -----------------------------------------------------------------------------
# (B) CONFIG — en los entornos que este repo define, el secreto no puede
#     resolver a cadena vacía.
#
# «Sin Stripe» y «acepto cualquier firma» son cosas distintas, y hasta P-WH-1 el
# repo las confundía: `docker-compose.yml` pasaba `${STRIPE_WEBHOOK_SECRET}` sin
# default y `stack-native.sh` **no exportaba** la variable cuando venía vacía.
# En ambos casos el backend recibía «ausente» y la verificación se iba a cero.
# La forma correcta es un DEFAULT DECLARADO no vacío (mismo criterio que el
# `:-` de POKEMONPRICETRACKER_API_KEY, DEVOPS_NOTES §32.12): el stack levanta sin
# Stripe, y todo webhook entrante se RECHAZA por firma inválida.
# -----------------------------------------------------------------------------
printf '\n\033[1m(B) Config: en ningún entorno del repo el secreto puede quedar vacío\033[0m\n'

HALLAZGOS_B=""
reportar_b() { HALLAZGOS_B="${HALLAZGOS_B}$1"$'\n'; }

# La lista de patrones de «no-secreto» se LEE del preflight, no se copia: un hecho,
# un sitio. Si alguien añade un placeholder nuevo allí, este candado lo reconoce solo.
PREFLIGHT_REL="scripts/webhook-secret-preflight.sh"
PREFLIGHT="$ROOT_DIR/$PREFLIGHT_REL"
PATRONES_PUBLICOS="$(sed -n '/^PATRONES_PUBLICOS=/s/^PATRONES_PUBLICOS=.\(.*\).$/\1/p' "$PREFLIGHT" 2>/dev/null)"

es_literal_publico() {
  local v; v="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  local pat
  for pat in $PATRONES_PUBLICOS; do
    case "$v" in *"$pat"*) return 0 ;; esac
  done
  return 1
}

# --- B.1 compose: `NOMBRE: valor` --------------------------------------------
# Reglas, y de dónde sale cada una:
#   `${VAR}`          -> VACÍO si falta  ......... P-WH-1 original.
#   `${VAR:-}`        -> vacío declarado ......... igual de malo.
#   `${VAR:-literal}` -> CLAVE COMMITEADA ........ el residual: el literal gana
#                        justo cuando el operador creyó configurar Stripe y no lo
#                        hizo, y está publicado.
#   literal a secas   -> CLAVE COMMITEADA ........ ídem.
#   `${VAR:?...}`     -> ÚNICA forma correcta: falla ruidoso y no inventa nada.
for f in "$ROOT_DIR"/docker-compose*.yml; do
  [ -f "$f" ] || continue
  rel="${f#"$ROOT_DIR"/}"
  while IFS= read -r linea; do
    n="${linea%%:*}"; texto="${linea#*:}"
    valor="${texto#*"${VAR}"}"; valor="${valor#*:}"
    valor="$(printf '%s' "$valor" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//; s/^"//; s/"$//')"
    case "$valor" in
      ''|"''"|'""')
        reportar_b "$rel:$n: valor VACÍO ⇒ el backend recibe el secreto ausente." ;;
      '${'*'}')
        interior="${valor#\$\{}"; interior="${interior%\}}"
        case "$interior" in
          *':?'*) : ;;                                   # correcto
          *':-'*)
            def="${interior#*:-}"
            if [ -z "$def" ]; then
              reportar_b "$rel:$n: \`\${…:-}\` ⇒ default DECLARADO VACÍO."
            elif [ "${def#\$}" = "$def" ]; then
              reportar_b "$rel:$n: default LITERAL (\`${def:0:32}\`) ⇒ es una clave escrita en un repo público, y gana cuando el operador cree tener Stripe y no lo tiene. Usa \`\${…:?mensaje}\`."
            fi ;;
          *) reportar_b "$rel:$n: \`\${$interior}\` SIN default ⇒ compose la pasa VACÍA (esto es P-WH-1)." ;;
        esac ;;
      *) reportar_b "$rel:$n: valor LITERAL (\`${valor:0:32}\`) ⇒ clave de firma commiteada en un repo público." ;;
    esac
  done < <(sin_comentarios "$f" | grep -E "^[0-9]+:[[:space:]]*${VAR}[[:space:]]*:" || true)
done

# --- B.1bis workflows: el secreto NO se escribe, se RESUELVE ------------------
# En un workflow no hay forma segura de escribir este valor:
#   · `${{ secrets.X }}` a secas se resuelve a CADENA VACÍA si el secret no está
#     cargado — y en este repo NO lo está (las claves de prueba de Stripe siguen
#     sin aportarse: quinto pase, `money-gap-nag.yml`).
#   · `${{ secrets.X || 'whsec_…' }}` tapa ese vacío con un literal PÚBLICO, que es
#     el residual completo: el valor que cualquiera puede leer gana precisamente
#     en el caso en que alguien creyó configurar Stripe.
# Por eso la única forma aceptada es que el job lo resuelva con el preflight
# (`webhook-secret-preflight.sh resolve` -> `$GITHUB_ENV`). Se permite la
# referencia pura SOLO dentro de un fichero que además cablea el preflight: ahí el
# vacío no degrada, lo atiende el preflight.
for f in "$ROOT_DIR"/.github/workflows/*.yml; do
  [ -f "$f" ] || continue
  rel="${f#"$ROOT_DIR"/}"
  cablea_preflight=0
  grep -E '^[^#]*(\./|sh )[^#]*webhook-secret-preflight\.sh' "$f" >/dev/null 2>&1 && cablea_preflight=1
  while IFS= read -r linea; do
    n="${linea%%:*}"; texto="${linea#*:}"
    valor="${texto#*WEBHOOK_SECRET}"; valor="${valor#*:}"
    valor="$(printf '%s' "$valor" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    case "$valor" in
      ''|"''"|'""')
        reportar_b "$rel:$n: valor VACÍO." ;;
      '${{'*)
        if printf '%s' "$valor" | grep -q '||'; then
          reportar_b "$rel:$n: \`\${{ … || 'literal' }}\` ⇒ el literal es PÚBLICO y gana cuando el secret NO está cargado. Resuélvelo con \`$PREFLIGHT_REL resolve\` en un paso."
        elif [ "$cablea_preflight" -eq 0 ]; then
          reportar_b "$rel:$n: \`\${{ secrets.… }}\` a secas ⇒ CADENA VACÍA si el secret no está cargado, y este fichero no cablea \`$PREFLIGHT_REL\`."
        fi ;;
      *)
        reportar_b "$rel:$n: valor LITERAL (\`${valor:0:32}\`) ⇒ clave de firma commiteada en un repo público (esto era \`whsec_ci_dummy\`)." ;;
    esac
  done < <(sin_comentarios "$f" | grep -E "^[0-9]+:[[:space:]]*(STRIPE_WEBHOOK_SECRET|STRIPE_TEST_WEBHOOK_SECRET)[[:space:]]*:" || true)
done

# --- B.2 scripts de arranque: asignación/export ------------------------------
for f in "$ROOT_DIR"/scripts/*.sh "$ROOT_DIR"/security/scripts/*.sh; do
  [ -f "$f" ] || continue
  rel="${f#"$ROOT_DIR"/}"
  es_autoexcluido "$rel" && continue
  # `export VAR` a secas (sin `=`): propaga lo que haya, incluida la ausencia.
  while IFS= read -r linea; do
    n="${linea%%:*}"
    reportar_b "$rel:$n: \`export ${VAR}\` sin valor ⇒ propaga la AUSENCIA al backend (el idioma exacto de P-WH-1 en el arnés nativo)."
  done < <(sin_comentarios "$f" | grep -E "^[0-9]+:.*(^|[[:space:];&|]|\|\|[[:space:]]*)export[[:space:]]+${VAR}[[:space:]]*(#|$)" || true)
  # Asignación con default vacío.
  while IFS= read -r linea; do
    n="${linea%%:*}"
    reportar_b "$rel:$n: asignación con default VACÍO (\`\${${VAR}:-}\`) ⇒ el backend recibe el secreto ausente."
  done < <(sin_comentarios "$f" | grep -E "^[0-9]+:[[:space:]]*(export[[:space:]]+)?${VAR}=[\"']?\\\$\{${VAR}:-\}" || true)
  # Asignación a un literal `whsec_…`: clave commiteada.
  while IFS= read -r linea; do
    n="${linea%%:*}"
    reportar_b "$rel:$n: asignación de un literal \`whsec_…\` ⇒ clave de firma commiteada. El arnés debe RESOLVER con \`$PREFLIGHT_REL\`, no escribir un valor."
  done < <(sin_comentarios "$f" | grep -E "^[0-9]+:[[:space:]]*(export[[:space:]]+)?(STRIPE_WEBHOOK_SECRET|STRIPE_TEST_WEBHOOK_SECRET)=[\"']?whsec_[A-Za-z0-9_]" || true)
done

# --- B.3 .env.example: existe, NO vacía, y RECONOCIBLE como no-secreto -------
# El tercer requisito no es cosmético. `.env.example` es una PLANTILLA y su valor
# acaba copiado a `.env` por quien no lo cambia. Si ese valor pareciera un secreto
# de verdad, el preflight lo aceptaría junto a una `sk_live_…` y volveríamos al
# residual. Al ser reconociblemente público, el preflight ABORTA el arranque en el
# único caso peligroso — plantilla + Stripe real — y no molesta en ningún otro.
ENVEX="$ROOT_DIR/.env.example"
if [ ! -f "$ENVEX" ]; then
  reportar_b ".env.example: no existe. Es la documentación normativa de las variables; sin ella nadie sabe que el secreto es obligatorio."
else
  linea="$(sin_comentarios "$ENVEX" | grep -E "^[0-9]+:[[:space:]]*${VAR}=" | head -1 || true)"
  if [ -z "$linea" ]; then
    reportar_b ".env.example: no declara ${VAR}. Debe declararlo y decir que es OBLIGATORIO siempre que haya Stripe cableado."
  else
    n="${linea%%:*}"; valor="${linea#*"${VAR}"=}"
    valor="$(printf '%s' "$valor" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    if [ -z "$valor" ]; then
      reportar_b ".env.example:$n: ${VAR}= VACÍO. Un \`.env\` copiado de aquí deja el stack aceptando cualquier firma."
    elif ! es_literal_publico "$valor"; then
      reportar_b ".env.example:$n: el placeholder \`${valor:0:24}\` NO es reconocible como no-secreto. El preflight lo tomaría por un secreto real y lo dejaría convivir con una clave de Stripe viva. Usa algo que contenga uno de: $PATRONES_PUBLICOS."
    fi
  fi
fi

if [ -n "${HALLAZGOS_B//[[:space:]]/}" ]; then
  bad "Hay entornos del repo donde el secreto del webhook puede quedar vacío:"
  while IFS= read -r l; do [ -n "$l" ] && note "$l"; done <<< "$HALLAZGOS_B"
  note ""
  note "Forma correcta: default DECLARADO y NO vacío (p. ej. \`\${${VAR}:-whsec_local_placeholder}\`)."
  note "Así el arnés levanta SIN Stripe y aun así RECHAZA todo webhook: 'sin Stripe'"
  note "y 'acepto cualquier firma' dejan de ser la misma cosa."
  note "Dueño del arreglo: **devops**."
else
  ok "Todo entorno definido en el repo entrega un secreto no vacío (o falla ruidoso)."
fi

# -----------------------------------------------------------------------------
# (C) EL PREFLIGHT ESTÁ CABLEADO — porque un candado sin cablear no gatea.
#
# Los bloques (A) y (B) son estáticos: dicen qué NO puede haber escrito en el
# repo. Pero el residual de P-WH-1 es un hecho que solo existe en RUNTIME —
# «este entorno tiene una clave de Stripe real Y un secreto de webhook que está
# publicado»— y ningún análisis estático puede verlo, porque el valor de Railway
# no vive aquí. Ese emparejamiento lo comprueba `webhook-secret-preflight.sh` en
# el arranque. Si alguien borra la llamada, el repo sigue pareciendo correcto y
# la protección desaparece sin un solo rojo: es exactamente la avería de §44 (el
# DAST sin blanco). Por eso el cableado se verifica, no se supone.
# -----------------------------------------------------------------------------
printf '\n\033[1m(C) El preflight de emparejamiento (clave real ↔ secreto publicado) sigue cableado\033[0m\n'

HALLAZGOS_C=""
rep_c() { HALLAZGOS_C="${HALLAZGOS_C}$1"$'\n'; }

if [ ! -f "$PREFLIGHT" ]; then
  rep_c "$PREFLIGHT_REL: NO EXISTE. Es lo único que distingue un secreto de un no-secreto; sin él, un entorno con Stripe real y \`whsec_…_dummy\` vuelve a arrancar en verde."
else
  sh -n "$PREFLIGHT" 2>/dev/null || rep_c "$PREFLIGHT_REL: no es sh válido (moriría en el arranque del contenedor, donde no hay bash)."
  [ -n "$PATRONES_PUBLICOS" ] || rep_c "$PREFLIGHT_REL: no encuentro la lista PATRONES_PUBLICOS. Este candado la LEE de ahí; sin ella no puede juzgar los placeholders."
fi

# El arranque del contenedor: cubre compose local, staging y Railway a la vez.
DKF="$ROOT_DIR/Dockerfile.backend"
if [ ! -f "$DKF" ]; then
  rep_c "Dockerfile.backend: no existe."
else
  # OJO: se exige la INVOCACIÓN en el CMD/ENTRYPOINT, no la mención. Un `grep`
  # del nombre a secas daba verde con el COPY y los comentarios intactos y la
  # llamada borrada — lo cazó el canario, no yo.
  grep -E '^\s*(CMD|ENTRYPOINT)\b.*webhook-secret-preflight\.sh' "$DKF" >/dev/null \
    || rep_c "Dockerfile.backend: el CMD/ENTRYPOINT ya NO invoca el preflight ⇒ ningún entorno contenedorizado comprueba el emparejamiento (y Railway es uno de ellos)."
  grep -qE '^\s*COPY .*webhook-secret-preflight\.sh' "$DKF" \
    || rep_c "Dockerfile.backend: falta el COPY del preflight a la imagen."
  if [ -f "$ROOT_DIR/.dockerignore" ] && grep -qE '^\s*scripts\s*$' "$ROOT_DIR/.dockerignore" \
     && ! grep -qE '^\s*!scripts/webhook-secret-preflight\.sh\s*$' "$ROOT_DIR/.dockerignore"; then
    rep_c ".dockerignore: excluye \`scripts\` y NO re-incluye el preflight ⇒ el COPY del Dockerfile falla el build."
  fi
fi

# El arnés nativo (la ruta sin Docker que usan QA y el pentester).
NAT="$ROOT_DIR/scripts/stack-native.sh"
if [ -f "$NAT" ]; then
  # Igual que arriba: invocación, no mención (el fichero HABLA del preflight en
  # sus comentarios, así que un grep del nombre siempre habría dado verde).
  sin_comentarios "$NAT" | grep -E '(sh|bash|\./|source|\.)[^#]*webhook-secret-preflight\.sh' >/dev/null \
    || rep_c "scripts/stack-native.sh: no INVOCA el preflight ⇒ la ruta nativa vuelve a resolver el secreto por su cuenta (de ahí salió P-WH-1)."
fi

# Y al menos un workflow tiene que resolverlo así: si ninguno lo hace, la regla
# de (B.1bis) que permite `${{ secrets.X }}` se queda sin su contrapartida.
if ! grep -rhE '^[^#]*(\./|sh )[^#]*webhook-secret-preflight\.sh' "$ROOT_DIR"/.github/workflows/ >/dev/null 2>&1; then
  rep_c ".github/workflows/: ningún workflow resuelve el secreto con el preflight ⇒ en CI vuelve a haber un hueco entre 'no hay secret' y 'hay literal público'."
fi

if [ -n "${HALLAZGOS_C//[[:space:]]/}" ]; then
  bad "El preflight de emparejamiento NO está cableado donde tiene que estar:"
  while IFS= read -r l; do [ -n "$l" ] && note "$l"; done <<< "$HALLAZGOS_C"
  note ""
  note "Recordatorio de por qué existe (palabras de backend): «el backend puede"
  note "exigir que el secreto EXISTA y no esté vacío; no puede distinguir un"
  note "secreto de un no-secreto». Para un HMAC, cualquier cadena vale."
else
  ok "El preflight existe y lo invocan el contenedor, el arnés nativo y CI."
fi

# -----------------------------------------------------------------------------
printf '\n'
if [ "$FALLOS" -gt 0 ]; then
  printf '\033[1;31m✗ CANDADO ROJO — %s comprobación(es) fallida(s), %s en verde.\033[0m\n' "$FALLOS" "$PASADAS"
  printf '  Referencia: docs/PENTEST_NOTES.md (P-WH-1) y docs/DEVOPS_NOTES.md §49.\n\n'
  exit 1
fi
printf '\033[1;32m✓ La firma del webhook no puede verificarse con una clave conocida ni publicada (%s/%s).\033[0m\n' "$PASADAS" "$PASADAS"
printf '  Esto NO afirma nada sobre el valor de la variable en Railway: eso no es\n'
printf '  medible desde el repo (DEVOPS_NOTES §49.1).\n\n'
exit 0

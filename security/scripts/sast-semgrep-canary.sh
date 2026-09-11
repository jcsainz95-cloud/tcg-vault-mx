#!/bin/sh
#
# sast-semgrep-canary.sh — «¿el gate de semgrep MUERDE?» · devops
# =============================================================================
# QA midió (lote 2026-09-11) que el job `semgrep` lleva 0 rojos en 60 corridas
# y no tiene canario. Un gate que nunca se ha visto rojo no se sabe si «siempre
# pasa» o «no puede fallar». Este canario planta, en un árbol TEMPORAL, dos
# ficheros que violan las DOS reglas locales de severidad ERROR de
# security/semgrep.yml —las que este proyecto escribió por sus propios
# incidentes—, corre EL MISMO comando del gate (mismos configs, `--severity=ERROR
# --error`) y exige rojo nombrando cada regla; luego un fichero limpio y exige
# verde; y un fichero que sólo viola una regla WARNING y exige verde (el gate
# está calibrado a ERROR a propósito, ver security-sast.yml).
#
# En `sh` POSIX a propósito: corre dentro del contenedor de semgrep, que no
# garantiza bash.
#
# Uso:  ./security/scripts/sast-semgrep-canary.sh
#   SG_CONFIGS: lista de `--config=…` del gate (en CI la exporta el job). Si no
#   está, se usa sólo la regla local (sin red).
# =============================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SEC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$SEC_DIR/.." && pwd)"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '  \033[1;32m✔ %s\033[0m\n' "$*"; }
bad() { printf '  \033[1;31m✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

printf '\n\033[1m== ¿El gate de semgrep (severidad ERROR) muerde? ==\033[0m\n\n'
command -v semgrep >/dev/null 2>&1 || { bad "semgrep no está en PATH: el canario no puede medir"; exit 1; }
CONFIGS="${SG_CONFIGS:---config=$SEC_DIR/semgrep.yml}"
# La regla local tiene que estar SIEMPRE entre los configs, venga lo que venga
# de CI: es la que el canario sabe provocar.
case "$CONFIGS" in *semgrep.yml*) ;; *) CONFIGS="--config=$SEC_DIR/semgrep.yml $CONFIGS" ;; esac

T="$(mktemp -d -t semgrep-canary-XXXXXX)"; trap 'rm -rf "$T"' EXIT INT TERM
# Las reglas locales acotan por ruta (`backend/src/**`, `…/payments/**`): el
# canario reproduce esa forma. Y el árbol temporal es un repo git con los
# ficheros AÑADIDOS: semgrep sólo escanea lo que `git ls-files` lista (medido:
# sin esto, «Targets scanned: 0» y tres verdes vacuos).
mkdir -p "$T/backend/src/modules/payments"
( cd "$T" && git init -q && git config user.email c@x && git config user.name canario ) || { bad "no pude crear el repo temporal"; exit 1; }

# gate <dir>: EL MISMO comando que security-sast.yml (paso «Semgrep GATE»).
gate() {
  # shellcheck disable=SC2086
  ( cd "$1" && git add -A && semgrep $CONFIGS --severity=ERROR --error --metrics=off --disable-version-check \
      --exclude=node_modules --exclude=.next --exclude=dist --exclude=coverage backend/ 2>&1 )
}

# 1. prisma-raw-unsafe (inyección SQL) + stripe-webhook-verify-signature (2 args)
cat > "$T/backend/src/modules/payments/canario-webhook.ts" <<'TS'
export function handle(stripe: any, raw: Buffer, sig: string, db: any, id: string) {
  const event = stripe.webhooks.constructEvent(raw, sig);
  const rows = db.$queryRawUnsafe(`SELECT * FROM orders WHERE id = '${id}'`);
  return { event, rows };
}
TS
OUT="$(gate "$T")"; RC=$?
printf '%s' "$OUT" | grep -q 'Targets scanned: 0' && bad "semgrep escaneó 0 ficheros: el canario no está midiendo nada"
if [ "$RC" -eq 0 ]; then bad "dos violaciones ERROR plantadas y el gate salió VERDE (rc=0)"; printf '%s\n' "$OUT" | tail -5
else
  for r in prisma-raw-unsafe stripe-webhook-verify-signature; do
    if printf '%s' "$OUT" | grep -q "$r"; then ok "ROJO y nombra la regla $r"; else bad "ROJO pero NO nombra $r"; fi
  done
fi

# 2. fichero limpio -> verde
rm -f "$T/backend/src/modules/payments/canario-webhook.ts"
cat > "$T/backend/src/modules/payments/canario-limpio.ts" <<'TS'
export function handle(stripe: any, raw: Buffer, sig: string, secret: string, db: any, id: string) {
  const event = stripe.webhooks.constructEvent(raw, sig, secret);
  const rows = db.$queryRaw`SELECT * FROM orders WHERE id = ${id}`;
  return { event, rows };
}
TS
OUT="$(gate "$T")"; RC=$?
printf '%s' "$OUT" | grep -q 'Targets scanned: 0' && bad "semgrep escaneó 0 ficheros en el caso limpio"
if [ "$RC" -eq 0 ]; then ok "fichero correcto (3 args + tagged template) -> VERDE"; else bad "fichero correcto salió ROJO (rc=$RC)"; printf '%s\n' "$OUT" | grep -E 'canario|ERROR' | head -5; fi

# 3. sólo WARNING (no-secret-in-logs) -> el gate ERROR NO se pone rojo
rm -f "$T/backend/src/modules/payments/canario-limpio.ts"
cat > "$T/backend/src/modules/payments/canario-warning.ts" <<'TS'
export function log(logger: any, password: string) {
  logger.info(password);
}
TS
OUT="$(gate "$T")"; RC=$?
printf '%s' "$OUT" | grep -q 'Targets scanned: 0' && bad "semgrep escaneó 0 ficheros en el caso WARNING"
if [ "$RC" -eq 0 ]; then ok "violación sólo WARNING -> VERDE (el gate está calibrado a ERROR, como documenta security-sast.yml)"
else
  if printf '%s' "$OUT" | grep -q 'no-secret-in-logs'; then bad "una regla WARNING puso el gate en rojo: el gate ya no está calibrado a ERROR"; else bad "rojo por otra cosa (rc=$RC)"; printf '%s\n' "$OUT" | tail -5; fi
fi

echo
if [ "$FALLOS" -ne 0 ]; then printf '\033[1;31m✗ Canario de semgrep: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1; fi
printf '\033[1;32m✓ Canario de semgrep: %s/%s — rojo por las dos reglas ERROR locales, verde con código correcto y con WARNING.\033[0m\n' "$PASADAS" "$((PASADAS+FALLOS))"

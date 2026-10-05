#!/usr/bin/env bash
#
# check-s3-local-clone-canary.sh — «¿`start_s3` distingue un s3-local VIVO de
#                                    uno que acepta MIS credenciales?»   · devops
# =============================================================================
# DE DÓNDE VIENE (S3-CLON, 2026-10-05, DEVOPS_NOTES §85.6)
# ---------------------------------------------------------------------------
# `infra-smoke` y `kyc-ine-links` daban 403 en el PUT presignado del INE en la
# rama `claude/arreglos-panel`. Medido en el log del s3-local de :9000: era de
# OTRO clon (`tcg-skyd`) y registraba «403 PUT … la firma NO coincide». Cada
# clon genera su `S3_SECRET_ACCESS_KEY`; `start_s3` reutilizaba cualquier cosa
# viva en el puerto. «Vivo» no es «mío».
#
# QUÉ EJERCE (sin red, sin Docker; necesita node y scripts/s3-local/node_modules)
#   1. La sonda `s3-local/probe-credentials.js` contra un s3-local REAL en un
#      puerto aleatorio: secreto correcto ⇒ rc 0; secreto de otro clon ⇒ rc 1;
#      puerto sin nadie ⇒ rc 2. N tiradas cada una.
#   2. La función `start_s3` REAL, extraída del fichero vivo con sus vecinas
#      (`s3_alive`, `s3_creds_ok`, `s3_ajeno_die`), contra ese servidor:
#      con mis credenciales ⇒ reutiliza; con las de otro clon ⇒ se para con
#      «NO acepta las credenciales».
#   3. Que `S3_ENDPOINT` SIGA a `S3_LOCAL_PORT` (si no, la salida «usa otro
#      puerto» no sirve: el backend seguiría firmando contra :9000).
#   4. MUTACIÓN: se quita `s3_creds_ok` de `start_s3` (la forma de antes) y el
#      caso «otro clon» tiene que salir ROJO — si no, el canario no muerde.
#
# Uso:  ./scripts/check-s3-local-clone-canary.sh [N]   (N = tiradas, def. 3)
# rc 0 todo como debe · 1 algún caso falló · 2 no pudo medir.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
N="${1:-3}"
STACK="$ROOT_DIR/scripts/stack-native.sh"
PROBE="$ROOT_DIR/scripts/s3-local/probe-credentials.js"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "::error::sin node no puedo medir. NO concluyente."; exit 2; }
[ -f "$PROBE" ] || { echo "::error::falta $PROBE"; exit 1; }
[ -d "$ROOT_DIR/scripts/s3-local/node_modules" ] || {
  echo "::error::falta scripts/s3-local/node_modules (cd scripts/s3-local && npm ci). NO concluyente."; exit 2; }

TMP="$(mktemp -d -t s3-clon-XXXXXX)"
SRV=""
trap '[ -n "$SRV" ] && kill "$SRV" 2>/dev/null; rm -rf "$TMP"' EXIT

CLAVE="minioadmin"
SECRETO_A="clonA_$RANDOM$RANDOM$RANDOM"
SECRETO_B="clonB_$RANDOM$RANDOM$RANDOM"

puerto_libre() {
  local p
  for _ in $(seq 1 30); do
    p=$(( 9300 + RANDOM % 500 ))
    node -e 'require("net").connect('"$p"',"127.0.0.1").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))' 2>/dev/null || { echo "$p"; return 0; }
  done
  return 1
}
PUERTO="$(puerto_libre)" || { echo "::error::no encontré puerto libre. NO concluyente."; exit 2; }
S3_LOCAL_HOST=127.0.0.1 S3_LOCAL_PORT="$PUERTO" S3_LOCAL_DIR="$TMP/data" S3_BUCKET=tcg-photos \
  S3_ACCESS_KEY_ID="$CLAVE" S3_SECRET_ACCESS_KEY="$SECRETO_A" \
  node "$ROOT_DIR/scripts/s3-local/server.js" >"$TMP/srv.log" 2>&1 &
SRV=$!
for _ in $(seq 1 40); do
  node -e 'require("net").connect('"$PUERTO"',"127.0.0.1").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))' 2>/dev/null && break
  sleep 0.25
done
kill -0 "$SRV" 2>/dev/null || { cat "$TMP/srv.log"; echo "::error::el s3-local del canario no arrancó. NO concluyente."; exit 2; }

sonda() { # <secreto> <puerto> → rc de la sonda
  S3_LOCAL_HOST=127.0.0.1 S3_LOCAL_PORT="$2" S3_BUCKET=tcg-photos S3_ACCESS_KEY_ID="$CLAVE" \
    S3_SECRET_ACCESS_KEY="$1" node "$PROBE" >/dev/null 2>&1
}

printf '\n\033[1m== S3-CLON · ¿«vivo» se distingue de «acepta mis credenciales»? ==\033[0m\n\n'

# --- 1. la sonda -------------------------------------------------------------
a=0; b=0; c=0
for _ in $(seq 1 "$N"); do
  sonda "$SECRETO_A" "$PUERTO"; [ $? -eq 0 ] && a=$((a+1))
  sonda "$SECRETO_B" "$PUERTO"; [ $? -eq 1 ] && b=$((b+1))
  sonda "$SECRETO_A" 1;         [ $? -eq 2 ] && c=$((c+1))
done
[ "$a" -eq "$N" ] && ok "sonda · mismo secreto ⇒ rc 0 (acepta) · $a/$N" || mal "sonda · mismo secreto ⇒ rc 0 solo $a/$N"
[ "$b" -eq "$N" ] && ok "sonda · secreto de otro clon ⇒ rc 1 (OTRO_SECRETO) · $b/$N" || mal "sonda · otro secreto ⇒ rc 1 solo $b/$N"
[ "$c" -eq "$N" ] && ok "sonda · puerto sin nadie ⇒ rc 2 (no concluyente, nunca «acepta») · $c/$N" || mal "sonda · puerto vacío ⇒ rc 2 solo $c/$N"

# --- 2. start_s3 real, extraído del fichero vivo -----------------------------
extraer() { # <stack.sh> → funciones s3_alive, s3_creds_ok, s3_ajeno_die, start_s3
  awk '/^s3_alive\(\) \{/,/^}/; /^s3_creds_ok\(\) \{/,/^}/; /^s3_ajeno_die\(\) \{/,/^}/; /^start_s3\(\) \{/,/^}/' "$1"
}
extraer "$STACK" > "$TMP/fn.sh"
for f in s3_alive s3_creds_ok s3_ajeno_die start_s3; do
  grep -q "^$f() {" "$TMP/fn.sh" || { echo "::error::no encontré la función $f en stack-native.sh: anclaje desfasado. NO concluyente."; exit 2; }
done

correr_start() { # <fn.sh> <secreto> → salida de start_s3 (rc en la última línea)
  bash -c '
    log(){ echo "LOG $*"; }; ok(){ echo "OK $*"; }; warn(){ echo "WARN $*"; }
    die(){ echo "DIE $*"; exit 9; }
    pids_listening_on(){ :; }
    S3_LOCAL_HOST=127.0.0.1; S3_LOCAL_PORT="$1"; S3_BUCKET=tcg-photos; S3_REGION=us-east-1
    S3_ACCESS_KEY_ID="$2"; S3_SECRET_ACCESS_KEY="$3"; S3_DIR="$4"; ROOT_DIR="$5"; RUN_DIR="$6"
    . "$7"
    start_s3; echo "RC=$?"
  ' _ "$PUERTO" "$CLAVE" "$2" "$ROOT_DIR/scripts/s3-local" "$ROOT_DIR" "$TMP/run" "$1" 2>&1
}
mkdir -p "$TMP/run"
mio=0; ajeno=0
for _ in $(seq 1 "$N"); do
  out="$(correr_start "$TMP/fn.sh" "$SECRETO_A")"
  grep -q "ACEPTA las credenciales" <<<"$out" && grep -q "RC=0" <<<"$out" && mio=$((mio+1))
  out="$(correr_start "$TMP/fn.sh" "$SECRETO_B")"
  grep -q "^DIE .*NO acepta las credenciales" <<<"$out" && ! grep -q "RC=0" <<<"$out" && ajeno=$((ajeno+1))
done
[ "$mio" -eq "$N" ] && ok "start_s3 · servidor de ESTE clon ⇒ se reutiliza · $mio/$N" || mal "start_s3 · servidor propio no se reutilizó ($mio/$N)"
[ "$ajeno" -eq "$N" ] && ok "start_s3 · servidor de OTRO clon ⇒ se para con «NO acepta las credenciales» · $ajeno/$N" \
  || mal "start_s3 · servidor ajeno NO se detectó ($ajeno/$N): volvería el 403 del PUT del INE"

# --- 3. el endpoint sigue al puerto ------------------------------------------
if grep -qE '^export S3_ENDPOINT="\$\{S3_ENDPOINT:-http://\$S3_LOCAL_HOST:\$S3_LOCAL_PORT\}"' "$STACK" \
   && [ "$(grep -n '^S3_LOCAL_PORT=' "$STACK" | head -1 | cut -d: -f1)" -lt "$(grep -n '^export S3_ENDPOINT=' "$STACK" | cut -d: -f1)" ]; then
  ok "S3_ENDPOINT se deriva de S3_LOCAL_PORT (declarado antes): «usa otro puerto» sí mueve al backend"
else
  mal "S3_ENDPOINT NO sigue a S3_LOCAL_PORT: con S3_LOCAL_PORT=9100 el backend seguiría firmando contra :9000"
fi

# --- 4. mutación: la forma de antes (reutilizar sin sonda) -------------------
python3 - "$TMP/fn.sh" "$TMP/fn-mut.sh" <<'PY'
import sys, re
s = open(sys.argv[1]).read()
i = s.index('start_s3() {')
cuerpo = s[i:]
a = cuerpo.index('    s3_creds_ok\n'); b = cuerpo.index('    esac\n') + len('    esac\n')
mut = cuerpo[:a] + '    ok "ya respondía (se reutiliza)"; return 0\n' + cuerpo[b:]
open(sys.argv[2], 'w').write(s[:i] + mut)
PY
rojo=0
for _ in $(seq 1 "$N"); do
  out="$(correr_start "$TMP/fn-mut.sh" "$SECRETO_B")"
  grep -q "^DIE .*NO acepta las credenciales" <<<"$out" || rojo=$((rojo+1))
done
[ "$rojo" -eq "$N" ] && ok "mutación m-s3clon (reutilizar sin sonda) ⇒ el caso «otro clon» sale ROJO · $rojo/$N — el canario muerde" \
  || mal "mutación m-s3clon: solo $rojo/$N rojas — el canario no distingue la forma de antes"

echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m✓ S3-CLON: %s/%s.\033[0m\n' "$PASADAS" "$PASADAS"; exit 0
fi
printf '\033[1;31m✗ S3-CLON: %s fallo(s) de %s.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1

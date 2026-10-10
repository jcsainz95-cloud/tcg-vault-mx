#!/usr/bin/env bash
#
# check-zap-conf.sh — ¿lo que recibe ZAP con `-c` lo puede leer ZAP?  · devops · §96.7
# =============================================================================
# EL DEFECTO (medido: job 114278597979, run 38074441197, sha 00535194). El commit
# 484f8530 añadió a `security/zap/baseline.conf` claves `10055-3/-4/-6` (sub-alertas,
# las entiende dast-gate.py). Ese fichero se le pasaba TAL CUAL a ZAP con `-c`, y ZAP
# hace `int(id)` sobre cada clave (`/zap/zap_common.py:708`): `ValueError`, rc=1 en
# 33 s, SIN informe. El paso de escaneo salió VERDE porque «rc 1 = ZAP encontró
# cosas», y la autoprueba del canario también: un rojo por falta de informe contaba
# como «el candado cierra». Habría roto el DAST bloqueante del deploy a producción.
#
# QUÉ COMPRUEBA (sin red ni Docker, salvo `--real`):
#   1. el EMULADOR del lector de ZAP muerde: una clave `<n>-<n>` sale rc 1 (con su
#      ValueError) y una política solo de enteros sale rc 0;
#   2. la copia filtrada de la política REAL la lee ZAP, y no pierde ninguna regla
#      entera ni ningún OUTOFSCOPE del original;
#   3. todo script que arranca ZAP (security/scripts/*.sh) le pasa la COPIA FILTRADA
#      (`zap_conf_for_zap` + `-c "${ZAP_CONF_MOUNT}/…"`), nunca el original;
#   4. la imagen de ZAP está FIJADA por digest, en un solo sitio (dast-zap-lib.sh);
#   5. CONDUCTA de `dast-ephemeral.sh scan` con un `docker` falso que se comporta
#      como ZAP (lee el fichero que se le monta con -c y revienta si ZAP reventaría):
#        · ZAP que revienta sin informe  ⇒ el paso SALE ROJO y dice «ZAP reventó»;
#        · ZAP que encuentra cosas (rc 1 con informe) ⇒ el paso sale 0 (decide gate);
#   6. `dast-gate.py --expect-red` SIN informe ⇒ FALLO (no «el candado cierra»).
#
#   --real  además arranca el `zap_common` DE VERDAD dentro de la imagen fijada:
#           la copia filtrada tiene que pasar `load_config` + `get_af_output_summary`
#           y la política con una sub-clave plantada tiene que reventar con el mismo
#           ValueError. Lo corre security-dast.yml antes de escanear (necesita Docker).
#
# Uso:  ./scripts/check-zap-conf.sh [--real] [<raíz del repo>]
# Canario: ./scripts/check-zap-conf-canary.sh
# =============================================================================
set -uo pipefail

REAL=0
if [ "${1:-}" = "--real" ]; then REAL=1; shift; fi
ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ROOT_DIR="$(cd "$ROOT_DIR" && pwd)" || exit 2
SEC="$ROOT_DIR/security"
POL="$SEC/scripts/dast-zap-policy.py"
LIB="$SEC/scripts/dast-zap-lib.sh"
CONF="$SEC/zap/baseline.conf"

FALLOS=0
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { FALLOS=$((FALLOS+1)); printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; \
         [ -n "${GITHUB_ACTIONS:-}" ] && printf '::error title=ZAP no podría leer su política (§96.7)::%s\n' "$*"; }
note() { printf '      %s\n' "$*"; }

TMP="$(mktemp -d -t zap-conf-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT

printf '\n\033[1m== §96.7 · ¿lo que recibe ZAP con -c lo puede leer ZAP? ==\033[0m\n\n'

for f in "$POL" "$LIB" "$CONF"; do
  [ -f "$f" ] || { bad "falta ${f#"$ROOT_DIR"/}"; }
done
[ "$FALLOS" -eq 0 ] || exit 1

# --- 1. el emulador muerde ----------------------------------------------------
printf '10020\tFAIL\t(x)\n10055-3\tWARN\t(sub)\n' > "$TMP/sub.conf"
printf '# c\n\n10020\tFAIL\t(x)\n10055\tWARN\t(x)\n' > "$TMP/int.conf"
out="$(python3 "$POL" check "$TMP/sub.conf" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && grep -q "invalid literal for int" <<<"$out"; then
  ok "el emulador del lector de ZAP REVIENTA con una clave <n>-<n> (rc 1, ValueError)"
else
  bad "el emulador NO revienta con '10055-3' (rc $rc): el candado entero sería inerte."
fi
python3 "$POL" check "$TMP/int.conf" >/dev/null 2>&1 \
  && ok "el emulador deja pasar una política solo de enteros (rc 0)" \
  || bad "el emulador rechaza una política solo de enteros: daría rojo siempre."

# --- 2. la copia filtrada de la política REAL ---------------------------------
if python3 "$POL" for-zap "$CONF" "$TMP/for-zap.conf" 2>"$TMP/quitadas.txt"; then
  if out="$(python3 "$POL" check "$TMP/for-zap.conf" 2>&1)"; then
    ok "la copia filtrada de security/zap/baseline.conf la lee ZAP (emulación)"
  else
    bad "la copia filtrada HARÍA REVENTAR a ZAP:"; note "$out"
  fi
  # No pierde reglas: toda clave entera y todo OUTOFSCOPE del original sigue ahí.
  perdidas="$(python3 - "$CONF" "$TMP/for-zap.conf" <<'PY'
import re, sys
def claves(p):
    out = set()
    for l in open(p, encoding="utf-8"):
        if l.startswith("#") or not l.strip() or l.count("\t") < 2:
            continue
        k, v, _ = l.rstrip().split("\t", 2)
        if v == "OUTOFSCOPE" or re.fullmatch(r"[0-9]+", k):
            out.add((k, v))
    return out
print(" ".join("%s=%s" % kv for kv in sorted(claves(sys.argv[1]) - claves(sys.argv[2]))))
PY
)"
  if [ -z "$perdidas" ]; then
    ok "el filtro no se come reglas: todas las enteras y OUTOFSCOPE del original llegan a ZAP"
  else
    bad "el filtro QUITA reglas que ZAP sí entiende: $perdidas"
  fi
  [ -s "$TMP/quitadas.txt" ] && note "quitadas (solo las lee dast-gate.py): $(grep -o "'[^']*'" "$TMP/quitadas.txt" | tr '\n' ' ')"
else
  bad "dast-zap-policy.py for-zap falló sobre la política real"
fi

# --- 3. todo script que arranca ZAP recibe la copia filtrada -------------------
n_zap=0
for s in "$SEC"/scripts/*.sh; do
  [ "$s" = "$LIB" ] && continue
  # Líneas ejecutables (sin comentarios) que lanzan un script de ZAP.
  if ! grep -vE '^\s*#' "$s" | grep -qE 'zap-(full-scan|baseline|api-scan)\.py'; then continue; fi
  n_zap=$((n_zap+1)); rel="${s#"$ROOT_DIR"/}"
  cuerpo="$(grep -vE '^\s*#' "$s")"
  if grep -qE -- '-c[[:space:]]+"?/zap/wrk/conf/' <<<"$cuerpo" \
     || grep -qE -- '-v[[:space:]]+"?\$\{?SEC_DIR\}?/zap:' <<<"$cuerpo" \
     || grep -qE -- 'security/zap:/zap' <<<"$cuerpo"; then
    bad "$rel le pasa a ZAP la política ORIGINAL (con sub-claves que lo revientan)."
  elif grep -qE -- '-c[[:space:]]+"\$\{ZAP_CONF_MOUNT\}/' <<<"$cuerpo" \
       && grep -qE '(^|[[:space:]])zap_conf_for_zap[[:space:]]' <<<"$cuerpo" \
       && grep -qE '^\s*\.\s+"\$\{SCRIPT_DIR\}/dast-zap-lib\.sh"' <<<"$cuerpo"; then
    ok "$rel arranca ZAP con la copia filtrada (zap_conf_for_zap + -c \${ZAP_CONF_MOUNT}/…)"
  else
    bad "$rel arranca ZAP sin la copia filtrada de dast-zap-lib.sh (zap_conf_for_zap / ZAP_CONF_MOUNT)."
  fi
  if grep -qE '^\s*ZAP_IMAGE=' <<<"$cuerpo" || grep -qE 'zaproxy/zaproxy' <<<"$cuerpo"; then
    bad "$rel define su propia imagen de ZAP: la fijada vive SOLO en dast-zap-lib.sh."
  fi
done
[ "$n_zap" -ge 4 ] && ok "$n_zap scripts arrancan ZAP y todos pasan por la misma puerta" \
                   || bad "solo encontré $n_zap scripts que arranquen ZAP (esperaba ≥4): ¿se movió alguno?"

# --- 4. imagen fijada por digest ---------------------------------------------
if grep -qE '^ZAP_IMAGE_FIJADA="ghcr\.io/zaproxy/zaproxy@sha256:[0-9a-f]{64}"$' "$LIB"; then
  ok "ZAP_IMAGE_FIJADA fijada por digest ($(sed -n 's/^ZAP_IMAGE_FIJADA="\(.*\)"$/\1/p' "$LIB" | cut -c1-48)…)"
else
  bad "dast-zap-lib.sh no fija la imagen de ZAP por digest (@sha256:<64 hex>): etiqueta móvil de un tercero."
fi
movil="$(grep -rnE 'zaproxy/zaproxy:[A-Za-z0-9._-]+' "$SEC/scripts" "$ROOT_DIR/.github/workflows" "$ROOT_DIR"/docker-compose*.yml 2>/dev/null \
          | grep -vE ':[0-9]+:\s*#' | grep -v '@sha256:' || true)"
if [ -z "$movil" ]; then
  ok "ninguna línea ejecutable usa una etiqueta móvil de ZAP"
else
  bad "imagen de ZAP por etiqueta móvil:"; note "$movil"
fi

# --- 5. conducta de `dast-ephemeral.sh scan` con un ZAP falso -----------------
# El `docker` falso hace lo que hace ZAP con `-c`: lee el fichero MONTADO y, si el
# lector de ZAP reventaría, revienta igual (rc 1, sin informe). Si no, escribe un
# informe y sale con el rc que pida FAKE_ZAP_RC (1 = «encontró cosas»).
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'FAKE'
#!/usr/bin/env bash
args=("$@"); conf=""; json=""; mounts=(); es_zap=0
for ((i=0;i<${#args[@]};i++)); do
  case "${args[$i]}" in
    -v) mounts+=("${args[$((i+1))]}") ;;
    -c) conf="${args[$((i+1))]}" ;;
    -J) json="${args[$((i+1))]}" ;;
    zap-*.py) es_zap=1 ;;
  esac
done
[ "$es_zap" = 1 ] || exit 0          # nuclei u otro: no aplica aquí
host_of() { local p="$1" m src dst; for m in "${mounts[@]}"; do src="${m%%:*}"; dst="${m#*:}"; dst="${dst%%:*}"
  case "$p" in "$dst"/*) printf '%s%s' "$src" "${p#"$dst"}"; return 0;; esac; done; return 1; }
hc="$(host_of "$conf")" || { echo "fake-zap: -c $conf no está montado" >&2; exit 1; }
[ -f "$hc" ] || { echo "fake-zap: no existe $hc" >&2; exit 1; }
printf '%s\n' "$hc" > "$FAKE_ZAP_SEEN"
if ! python3 "$FAKE_ZAP_POL" check "$hc" >&2; then
  echo "ValueError: invalid literal for int() with base 10 (fake-zap, como /zap/zap_common.py:708)" >&2
  exit 1
fi
hj="$(host_of "$json")" || exit 3
printf '{"@version":"fake","site":[]}\n' > "$hj"
exit "${FAKE_ZAP_RC:-0}"
FAKE
chmod +x "$TMP/bin/docker"

scan() { # <rc_zap>  → imprime salida, devuelve rc del paso scan
  rm -rf "$TMP/rep"; mkdir -p "$TMP/rep"
  PATH="$TMP/bin:$PATH" FAKE_ZAP_POL="$POL" FAKE_ZAP_SEEN="$TMP/seen" FAKE_ZAP_RC="$1" \
  REPORT_DIR="$TMP/rep" ZAP_TARGETS="http://127.0.0.1:9" NUCLEI_TARGETS="" \
  SCAN_PROFILE=baseline SPIDER_MINS=1 ACTIVE_MAX_MINS=1 GITHUB_ACTIONS='' \
    bash "$SEC/scripts/dast-ephemeral.sh" scan 2>&1
}
: > "$TMP/seen"
out="$(scan 1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -s "$TMP/rep/zap-127-0-0-1-9.json" ]; then
  ok "dast-ephemeral scan: ZAP lee su política y rc 1 CON informe ⇒ paso 0 (lo decide el candado)"
else
  bad "dast-ephemeral scan con la política actual no produce informe o sale rc $rc:"
  note "$(tail -5 <<<"$out")"
fi
visto="$(cat "$TMP/seen" 2>/dev/null)"
if [ -n "$visto" ] && [ "$(cd "$(dirname "$visto")" && pwd)/$(basename "$visto")" != "$CONF" ]; then
  ok "lo que ZAP recibió con -c NO es el original (${visto#"$TMP"/})"
else
  bad "ZAP recibió con -c el fichero ORIGINAL de la política ($visto)"
fi
# El mismo paso, con un ZAP que revienta: se le monta una política con sub-clave.
cp -r "$SEC/scripts" "$TMP/sec-scripts-copia" 2>/dev/null
python3 - "$TMP/sec-scripts-copia/dast-zap-policy.py" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = '        if val == "OUTOFSCOPE" or _es_entero(key):'
assert a in s, "anclaje del filtro"
open(p, "w").write(s.replace(a, '        if True:'))
PY
mkdir -p "$TMP/arbol/security"; cp -r "$SEC/zap" "$TMP/arbol/security/zap"
cp -r "$TMP/sec-scripts-copia" "$TMP/arbol/security/scripts"
# Se usa el emulador REAL para el ZAP falso: el filtro roto es el de la copia.
rm -rf "$TMP/rep"; mkdir -p "$TMP/rep"
out="$(PATH="$TMP/bin:$PATH" FAKE_ZAP_POL="$POL" FAKE_ZAP_SEEN="$TMP/seen" FAKE_ZAP_RC=1 \
  REPORT_DIR="$TMP/rep" ZAP_TARGETS="http://127.0.0.1:9" NUCLEI_TARGETS="" \
  SCAN_PROFILE=baseline SPIDER_MINS=1 ACTIVE_MAX_MINS=1 GITHUB_ACTIONS='' \
  bash "$TMP/arbol/security/scripts/dast-ephemeral.sh" scan 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && grep -qE 'ZAP reventó|política para ZAP' <<<"$out"; then
  ok "con una política que ZAP no puede leer, el paso scan SALE ROJO y lo dice (rc $rc), no «encontró cosas»"
else
  bad "con una política que revienta a ZAP, el paso scan sale rc $rc sin decir «ZAP reventó»: el falso verde de §96.7."
  note "$(tail -4 <<<"$out")"
fi
# Y si el que falla es el propio ZAP (no el filtro): rc 1 sin informe ⇒ rojo propio.
cat > "$TMP/bin/docker-crash" <<'FAKE'
#!/usr/bin/env bash
for a in "$@"; do case "$a" in zap-*.py) echo "ValueError (fake)" >&2; exit 1;; esac; done; exit 0
FAKE
mkdir -p "$TMP/bin2"; cp "$TMP/bin/docker-crash" "$TMP/bin2/docker"; chmod +x "$TMP/bin2/docker"
rm -rf "$TMP/rep"; mkdir -p "$TMP/rep"
out="$(PATH="$TMP/bin2:$PATH" REPORT_DIR="$TMP/rep" ZAP_TARGETS="http://127.0.0.1:9" NUCLEI_TARGETS="" \
  SCAN_PROFILE=baseline SPIDER_MINS=1 ACTIVE_MAX_MINS=1 GITHUB_ACTIONS='' \
  bash "$SEC/scripts/dast-ephemeral.sh" scan 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && grep -q 'ZAP reventó' <<<"$out"; then
  ok "ZAP que sale rc 1 SIN informe ⇒ el paso scan sale ROJO con «ZAP reventó» (rc $rc)"
else
  bad "ZAP rc 1 sin informe ⇒ paso scan rc $rc sin «ZAP reventó»: se confunde con «encontró cosas»."
fi

# --- 6. la autoprueba no celebra un rojo sin informe ---------------------------
GITHUB_ACTIONS='' python3 "$SEC/scripts/dast-gate.py" --policy "$CONF" \
  --zap-json "$TMP/no-existe.json" --expect-red --summary "$TMP/st.md" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && ok "dast-gate --expect-red SIN informe ⇒ FALLO (rc $rc): un canario sin escanear no prueba nada" \
                || bad "dast-gate --expect-red SIN informe ⇒ rc 0: la autoprueba celebra que ZAP reventó."

# --- 7 (--real). el zap_common DE VERDAD, dentro de la imagen fijada ----------
if [ "$REAL" = 1 ]; then
  # shellcheck source=security/scripts/dast-zap-lib.sh
  . "$LIB"
  cp "$TMP/for-zap.conf" "$TMP/real-ok.conf"
  { cat "$CONF"; printf '99999-1\tWARN\t(canario §96.7: sub-clave plantada)\n'; } > "$TMP/real-sub.conf"
  chmod 755 "$TMP"; chmod 644 "$TMP"/real-*.conf
  PYZ='import sys; sys.path.insert(0, "/zap"); import zap_common as z
d, m, o = {}, {}, {}
z.load_config(open(sys.argv[1]), d, m, o)
z.get_af_output_summary("short", "/tmp/x", d, m)
print("ZAP-OK", len(d))'
  real() { docker run --rm --network none --entrypoint python3 -v "$TMP:/c:ro" "$ZAP_IMAGE" -c "$PYZ" "/c/$1" 2>&1; }
  out="$(real real-ok.conf)"; rc=$?
  if [ "$rc" -eq 0 ] && grep -q '^ZAP-OK' <<<"$out"; then
    ok "ZAP REAL ($ZAP_IMAGE) lee la copia filtrada: $(grep '^ZAP-OK' <<<"$out")"
  else
    bad "ZAP REAL no lee la copia filtrada (rc $rc):"; note "$(tail -4 <<<"$out")"
  fi
  out="$(real real-sub.conf)"; rc=$?
  if [ "$rc" -ne 0 ] && grep -q "invalid literal for int" <<<"$out"; then
    ok "ZAP REAL revienta con la sub-clave plantada (rc $rc, ValueError): el instrumento muerde"
  else
    bad "ZAP REAL NO revienta con '99999-1' (rc $rc): o cambió el lector de ZAP, o esta prueba no lo ejercita."
    note "$(tail -4 <<<"$out")"
  fi
fi

echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m✓ §96.7: ZAP recibe una política que puede leer, fijada y vigilada.\033[0m\n'; exit 0
fi
printf '\033[1;31m✗ §96.7: %s fallo(s). Dueño: devops (security/scripts, security/zap).\033[0m\n' "$FALLOS"; exit 1

#!/usr/bin/env bash
#
# check-gate-parity-canary.sh — «¿la paridad I-PP5 TUMBA el gate?»   ·  devops
# =============================================================================
# LA MEDICIÓN QUE ORIGINA ESTA GUARDA (§48.1, 2026-09-10 — hallazgo de QA)
# ---------------------------------------------------------------------------
# QA corrió `stack-native.sh up --seed --gate` sobre un stack cuyo dial vivo era
# `pokemontcg_io` (el proveedor LEGACY, el que aplana los acabados). El script
# imprimió, literal:
#
#     ✗ SIN PARIDAD (I-PP5)
#
# ...y SIGUIÓ ADELANTE. El `rc=1` que QA recibió no venía de ahí: venía del gate
# de capacidades (§39), que en esa máquina falla por no haber claves de Stripe.
# Es decir: **con las claves puestas, ese mismo `up --gate` habría salido 0**
# sobre un stack que el propio script declara no citable («Un E2E/DAST verde aquí
# NO es citable como gate del sistema que se promueve»). El aviso no cambiaba el
# código de salida — exactamente lo que el §39 prohíbe veinte líneas más abajo.
#
# QUÉ PRUEBA ESTE CANARIO (y por qué no basta con leer el código)
# ---------------------------------------------------------------------------
# Un candado sin una prueba que lo vea CERRARSE es una intención. Aquí se
# ejercita el bloque de decisión REAL de `stack-native.sh` —copiado byte a byte,
# sin reescribirlo— con los dos hijos que consulta (`price-provider-parity.sh` y
# `e2e-capability-gate.sh`) sustituidos por dobles cuyo código de salida se
# dicta desde fuera. Se comprueban los SEIS desenlaces que importan:
#
#   1. paridad ROJA  + capacidades OK  + `--gate`  →  rc ≠ 0   (el hallazgo)
#   2. paridad ROJA  + capacidades OK  + `up`      →  rc = 0   (informe: `up` a
#      secas es un stack de trabajo, no un gate; si esto se pusiera rojo, la
#      gente dejaría de usar `up` y el candado se volvería en contra)
#   3. paridad VERDE + capacidades OK  + `--gate`  →  rc = 0   (un candado que
#      siempre cierra tampoco es un candado: hay que poder pasar)
#   4. paridad VERDE + capacidades ROJAS + `--gate`→  rc ≠ 0   (no-regresión del
#      gate de capacidades, §39, que antes era el ÚNICO que teñía de rojo)
#   5. paridad ROJA  + capacidades ROJAS + `--gate`→  rc ≠ 0 y el veredicto
#      NOMBRA LOS DOS motivos (antes el primero abortaba y tapaba al segundo)
#   6. paridad SIN MEDIR (asertor rc=30) + `--gate` →  rc ≠ 0, y el veredicto NO
#      afirma que el dial esté mal: dice que no se midió (fail-closed sin
#      inventarse el hecho — ver §48.1)
#
# Además comprueba que el bloque de decisión del sandbox es IDÉNTICO al del
# script real: si alguien cambia la lógica, el canario deja de estar probando lo
# que dice probar y se pone rojo.
#
# QUÉ **NO** PRUEBA: que el dial vivo de un entorno concreto esté en el primario.
# Eso lo mide `price-provider-parity.sh --assert` contra ese entorno, y lo corre
# el propio `up`. Esto prueba el CABLE, no el valor.
#
# Uso:   ./scripts/check-gate-parity-canary.sh
# Sale 0 si el candado está vivo; 1 con el caso exacto que falló.
# Barato: sin red, sin Docker, sin Postgres. ~1 s.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REAL="$ROOT_DIR/scripts/stack-native.sh"

FALLOS=0
PASADAS=0
ok()   { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }
note() { printf '      %s\n' "$*"; }

printf '\n\033[1m== ¿La paridad I-PP5 TUMBA el gate? (canario del §48.1) ==\033[0m\n\n'

[ -f "$REAL" ] || { bad "No existe $REAL."; exit 1; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/scripts" "$SANDBOX/backend" "$SANDBOX/frontend"

# -----------------------------------------------------------------------------
# 1. COPIA NEUTRALIZADA. Se sustituye el CUERPO de las funciones que arrancan
#    procesos de verdad (Postgres, Nest, Next) por un stub. La transformación es
#    mecánica y acotada: de `^nombre() {` hasta la primera línea que sea `}` en
#    columna 0 — el estilo de todo el fichero. NADA del bloque de decisión del
#    `case up)` se toca, y eso se VERIFICA abajo (paso 2).
# -----------------------------------------------------------------------------
STUBBED="start_infra seed_synthetic start_backend start_frontend verify_head print_e2e_instructions"
awk -v names="$STUBBED" '
  BEGIN { n = split(names, a, " "); for (i = 1; i <= n; i++) stub[a[i]] = 1 }
  /^[a-zA-Z_][a-zA-Z0-9_]*\(\)[ ]*\{/ {
    fn = $0; sub(/\(\).*/, "", fn)
    if (fn in stub) { print fn "() { printf \"  [canario] " fn " (neutralizada)\\n\"; return 0; }"; skipping = 1; found[fn] = 1; next }
  }
  skipping && /^\}/ { skipping = 0; next }
  skipping { next }
  { print }
  END {
    for (i = 1; i <= n; i++)
      if (!(a[i] in found)) { print "AWK_MISSING:" a[i] > "/dev/stderr"; rc = 1 }
    exit rc
  }
' "$REAL" > "$SANDBOX/scripts/stack-native.sh" 2> "$SANDBOX/awk.err"
AWK_RC=$?
if [ "$AWK_RC" -ne 0 ] || [ -s "$SANDBOX/awk.err" ]; then
  bad "No pude neutralizar alguna función del script real (¿le cambiaron el nombre?):"
  sed 's/^/      /' "$SANDBOX/awk.err"
  note "Dueño: devops. Ajusta \$STUBBED en este canario."
  exit 1
fi
chmod +x "$SANDBOX/scripts/stack-native.sh"
bash -n "$SANDBOX/scripts/stack-native.sh" \
  || { bad "La copia neutralizada no es sintácticamente válida."; exit 1; }
ok "copia neutralizada del script real (stubs: $STUBBED)"

# -----------------------------------------------------------------------------
# 2. EL BLOQUE DE DECISIÓN DEL SANDBOX ES EL DEL SCRIPT REAL, BYTE A BYTE.
#    Sin esto, el canario podría estar aprobando una lógica que ya no existe.
# -----------------------------------------------------------------------------
extract_gate_lines() {  # las líneas que DECIDEN, en orden, sin comentarios ni espacios
  grep -nE 'gate_fail |gate_verdict$|price-provider-parity\.sh" --assert|e2e-capability-gate\.sh" --require-all|GATE_MODE=1|\[ "\$GATE_MODE" = 1 \]' "$1" \
    | sed -E 's/^[0-9]+://; s/^[[:space:]]+//'
}
if diff <(extract_gate_lines "$REAL") <(extract_gate_lines "$SANDBOX/scripts/stack-native.sh") >/dev/null; then
  ok "el bloque de decisión del sandbox es idéntico al del script real"
else
  bad "El sandbox NO conserva la lógica de decisión del script real."
  diff <(extract_gate_lines "$REAL") <(extract_gate_lines "$SANDBOX/scripts/stack-native.sh") | sed 's/^/      /'
  exit 1
fi

# -----------------------------------------------------------------------------
# 3. DOBLES de los dos hijos que consulta el gate. Su rc lo dicta el caso.
#    `price-provider-parity.sh --assert` sale 20 cuando NO hay paridad; el doble
#    imita ese contrato (cualquier ≠0 vale para el `if !`, pero se usa el real).
# -----------------------------------------------------------------------------
cat > "$SANDBOX/scripts/price-provider-parity.sh" <<'STUB'
#!/usr/bin/env bash
# CANARY_PARITY_OK: 1 = paridad (0) · 0 = SIN paridad (20) · 30 = no se pudo MEDIR (30)
case "${CANARY_PARITY_OK:-1}" in
  1)  echo "  [doble] ✓ Paridad: vigente = primario"; exit 0 ;;
  30) echo "  [doble] ✗ Sin credenciales de super_admin: NO puedo leer el dial."; exit 30 ;;
  *)  echo "  [doble] ✗ SIN PARIDAD (\`I-PP5\`): este entorno NO evalúa el proveedor primario."; exit 20 ;;
esac
STUB
cat > "$SANDBOX/scripts/e2e-capability-gate.sh" <<'STUB'
#!/usr/bin/env bash
if [ "${CANARY_CAPS_OK:-1}" = "1" ]; then
  echo "  [doble] ✔ capacidades: COBRO y SUBIDA disponibles"; exit 0
fi
echo "  [doble] ✗ capacidades: falta COBRO"; exit 1
STUB
chmod +x "$SANDBOX/scripts/price-provider-parity.sh" "$SANDBOX/scripts/e2e-capability-gate.sh"

# -----------------------------------------------------------------------------
# 4. LOS SEIS DESENLACES.
# -----------------------------------------------------------------------------
# caso <nombre> <paridad_ok> <caps_ok> <rc_esperado> <patrón_exigido|-> [args…]
caso() {
  local nombre="$1" par="$2" caps="$3" want="$4" pat="$5"; shift 5
  local out rc
  out="$(CANARY_PARITY_OK="$par" CANARY_CAPS_OK="$caps" \
         "$SANDBOX/scripts/stack-native.sh" "$@" 2>&1)"; rc=$?
  printf '%s\n' "$out" > "$SANDBOX/last.log"
  local problema=""
  if [ "$want" = "0" ] && [ "$rc" -ne 0 ]; then problema="esperaba rc=0 y salió rc=$rc"; fi
  if [ "$want" != "0" ] && [ "$rc" -eq 0 ]; then problema="esperaba rc≠0 y salió rc=0"; fi
  if [ -z "$problema" ] && [ "$pat" != "-" ] && ! printf '%s' "$out" | grep -qE "$pat"; then
    problema="rc correcto ($rc) pero el veredicto NO menciona /$pat/"
  fi
  if [ -z "$problema" ]; then
    ok "$nombre → rc=$rc"
  else
    bad "$nombre → $problema"
    printf '%s\n' "$out" | tail -25 | sed 's/^/      | /'
  fi
}

printf '\n\033[1m-- los seis desenlaces --\033[0m\n'

# 1. EL HALLAZGO. Paridad roja, capacidades OK (= la máquina de CI con claves de
#    Stripe puestas): antes rc=0, ahora tiene que ser rojo.
caso "paridad ROJA + caps OK + --gate  ⇒ ROJO" 0 1 1 'PARIDAD I-PP5' up --gate

# 2. `up` a secas sigue siendo un informe: rc=0, pero el aviso tiene que estar.
caso "paridad ROJA + caps OK + up      ⇒ verde con aviso" 0 1 0 'NO está en el proveedor primario' up

# 3. El candado puede ABRIRSE (si no, no es un candado, es un muro).
caso "paridad VERDE + caps OK + --gate ⇒ VERDE" 1 1 0 '-' up --gate

# 4. No-regresión del gate de capacidades (§39).
caso "paridad VERDE + caps ROJAS + --gate ⇒ ROJO" 1 0 1 'CAPACIDADES' up --gate

# 5. Los dos motivos salen JUNTOS en el veredicto (antes el primero abortaba).
caso "paridad ROJA + caps ROJAS + --gate ⇒ ROJO con AMBOS" 0 0 1 'PARIDAD I-PP5' up --gate
if ! grep -q 'CAPACIDADES' "$SANDBOX/last.log"; then
  bad "el veredicto doble NO nombra el motivo de capacidades (se perdió un motivo)"
else
  ok "…y el veredicto nombra también el motivo de capacidades"
fi
if ! grep -qE '2 motivo' "$SANDBOX/last.log"; then
  bad "el veredicto no cuenta los 2 motivos"
else
  ok "…y los cuenta: «2 motivo(s)»"
fi

# 6. «NO MEDIDO» tampoco es verde, y NO se narra como «el dial está mal».
#    (Salió en la propia demostración del §48.1: al repetir el gate, `/auth/login`
#    limitó a 5/min y el asertor devolvió 30. Rojo sí — pero por otro motivo, y
#    afirmar «el dial NO está en el primario» habría sido inventarse un hecho.)
caso "paridad SIN MEDIR (rc=30) + caps OK + --gate ⇒ ROJO" 30 1 1 'SIN MEDIR' up --gate
if grep -q 'el dial vivo NO es el proveedor primario' "$SANDBOX/last.log"; then
  bad "con rc=30 el veredicto AFIRMA que el dial está mal, y eso no se midió"
else
  ok "…y no afirma nada sobre el valor del dial (no se midió)"
fi

# 7. `FRONTEND_MODE=build` (sin `--gate`) pide un artefacto de gate ⇒ mismo listón.
printf '\n\033[1m-- equivalencia FRONTEND_MODE=build ≡ --gate --\033[0m\n'
OUT="$(CANARY_PARITY_OK=0 CANARY_CAPS_OK=1 FRONTEND_MODE=build \
       "$SANDBOX/scripts/stack-native.sh" up 2>&1)"; RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q 'PARIDAD I-PP5'; then
  ok "FRONTEND_MODE=build + paridad ROJA ⇒ rc=$RC (mismo listón que --gate)"
else
  bad "FRONTEND_MODE=build no aplica el listón de gate (rc=$RC)"
  printf '%s\n' "$OUT" | tail -15 | sed 's/^/      | /'
fi

# -----------------------------------------------------------------------------
# 8. VEREDICTO
# -----------------------------------------------------------------------------
printf '\n'
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m== CANDADO VIVO: un fallo de paridad TUMBA `up --gate` (%s comprobaciones) ==\033[0m\n\n' "$PASADAS"
  exit 0
fi
printf '\033[1;31m== CANDADO ROTO: %s comprobación(es) en rojo ==\033[0m\n' "$FALLOS"
printf '  Dueño del arreglo: devops (scripts/stack-native.sh, bloque `case up)`).\n'
printf '  Contexto: docs/DEVOPS_NOTES.md §48.1.\n\n'
exit 1

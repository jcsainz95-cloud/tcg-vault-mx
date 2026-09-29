#!/usr/bin/env bash
#
# check-stack-kill-scope.sh — «¿el apagado de `stack-native.sh` mata SOLO lo mío?»
# canario de I-QA2 · devops (2026-09-22)
# =============================================================================
# DE DÓNDE VIENE — dos daños MEDIDOS el mismo día, por dos agentes distintos:
#   · el pentester corrió `pkill -f "src/main.ts"` de limpieza y mató el BACKEND
#     DE QA a mitad de su gate;
#   · QA corrió `down` con FRONTEND_PORT=3200 y mató el `next-server` huérfano de
#     :3000, que era de OTRO clon.
# Los patrones de antes (`ts-node --transpile-only src/main.ts`, `^next-server `,
# `s3-local/server.js`) describen el PROGRAMA, no MI instancia: con dos sesiones
# en paralelo sobre puertos distintos, el mecanismo para matarse entre sí estaba
# cableado dentro del propio script. Es O-8/O-14 en el recurso «stack».
#
# QUÉ MIDE ESTO, y por qué no es una lectura de código:
#   extrae el bloque `>>> APAGADO-ACOTADO … <<<` DEL FICHERO VIVO, levanta
#   PROCESOS DE VERDAD que escuchan en puertos de verdad, llama a `stop_scoped`
#   y mira quién quedó vivo. Si alguien «simplifica» el filtro, esto se cae.
#
#   1. DOS STACKS, DOS PUERTOS: apago el mío ⇒ el ajeno SIGUE VIVO.
#      (el caso exacto que QA sufrió; se repite N veces — una tirada no verifica
#      nada de esta clase, O-3)
#   2. ...y apagar apaga: el mío MUERE. El fallo inverso (no matar nada) dejaría
#      el puerto ocupado y `up --gate` serviría un binario viejo (SEC-OPS-1).
#   3. PATRÓN + OTRO CLON + OTRO PUERTO ⇒ SOBREVIVE (es el `pkill` del pentester).
#   4. PATRÓN + MI CLON, SIN PUERTO ABIERTO ⇒ MUERE (backend que murió al
#      arrancar: el filtro por puerto solo no lo ve, y hay que barrerlo).
#  5bis. MI PUERTO ocupado por OTRO clon ⇒ MUERE (reclamo el puerto o el gate
#      siguiente no arranca) pero el apagado lo NOMBRA con su cwd. Dos clones con
#      el MISMO puerto por defecto no se pueden separar por puerto; lo que se
#      puede es que la muerte sea explicable.
#   6. ESTÁTICO: `stack-native.sh` no ejecuta ni un `pkill` (los `pkill` que
#      queden solo pueden estar en comentarios).
#
# Uso:  ./scripts/check-stack-kill-scope.sh [N]     (N repeticiones del caso 1; 3 por defecto)
# rc: 0 todo pasa · 1 alguna falla · 2 no concluyente (no pude medir)
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT_DIR/scripts/stack-native.sh"
N="${1:-3}"
FALLOS=0; PASADAS=0
ok()   { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ⚠ %s\033[0m\n' "$*"; }   # lo usa stop_scoped
nc()   { printf '\n\033[1;33m∅ NO CONCLUYENTE: %s\033[0m\n' "$*"; exit 2; }

printf '\n\033[1m== ¿El apagado del stack mata SOLO lo mío? (canario de I-QA2) ==\033[0m\n'
printf '   procesos y puertos DE VERDAD; el bloque se extrae del stack-native.sh vivo\n\n'

command -v python3 >/dev/null 2>&1 || nc "no hay python3 para levantar los procesos señuelo."
# Sin `lsof` ni `fuser` no hay forma de saber QUIÉN escucha en un puerto: el filtro
# por puerto se degrada a nada y este canario mediría otra cosa. NO CONCLUYENTE,
# nunca verde por no poder medir (y nunca rojo por falta de herramienta).
command -v lsof >/dev/null 2>&1 || command -v fuser >/dev/null 2>&1 \
  || nc "ni lsof ni fuser en esta máquina: no puedo resolver el dueño de un puerto."
[ -f "$STACK" ] || nc "no existe $STACK."

# --- 1. Extraer el bloque VIVO (no una copia que se quede atrás) --------------
BLOQUE="$(sed -n '/^# >>> APAGADO-ACOTADO/,/^# <<< APAGADO-ACOTADO/p' "$STACK")"
grep -q 'stop_scoped()' <<<"$BLOQUE" || nc "no encontré el bloque APAGADO-ACOTADO en $STACK (¿marcas movidas?)."
eval "$BLOQUE" || nc "el bloque APAGADO-ACOTADO no evalúa."

TMP="$(mktemp -d -t stack-kill-scope-XXXXXX)"
CLON_AJENO="$TMP/otro-clon"; mkdir -p "$CLON_AJENO"
PIDS_LANZADOS=""
limpiar() { for p in $PIDS_LANZADOS; do kill -9 "$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap limpiar EXIT

MARCA="canario-kill-scope-$$"

puerto_libre() { # imprime un puerto TCP libre
  python3 - <<'PY'
import socket
s = socket.socket(); s.bind(('127.0.0.1', 0)); print(s.getsockname()[1]); s.close()
PY
}

# Señuelo que ESCUCHA en un puerto, con `cwd` elegido y la MARCA en su cmdline.
lanzar_listener() { # <cwd> <puerto> → pid
  local cwd="$1" port="$2" pid
  ( cd "$cwd" && exec python3 -c "
import socket, sys, time
# $MARCA ts-node --transpile-only src/main.ts
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', int(sys.argv[1]))); s.listen(5); time.sleep(600)
" "$port" >/dev/null 2>&1 ) &
  pid=$!
  PIDS_LANZADOS="$PIDS_LANZADOS $pid"
  printf '%s' "$pid"
}

# Señuelo SIN puerto: solo casa el patrón (el backend que murió al arrancar).
lanzar_mudo() { # <cwd> → pid
  local cwd="$1" pid
  ( cd "$cwd" && exec python3 -c "
import time
# $MARCA ts-node --transpile-only src/main.ts
time.sleep(600)
" >/dev/null 2>&1 ) &
  pid=$!
  PIDS_LANZADOS="$PIDS_LANZADOS $pid"
  printf '%s' "$pid"
}

vivo()  { kill -0 "$1" 2>/dev/null; }
esperar_arranque() { # <pid> <puerto>
  for _ in $(seq 1 40); do
    vivo "$1" || return 1
    python3 -c "
import socket,sys
s=socket.socket(); s.settimeout(0.3)
sys.exit(0 if s.connect_ex(('127.0.0.1', int(sys.argv[1])))==0 else 1)" "$2" && return 0
    sleep 0.1
  done
  return 1
}
asentar() { for _ in $(seq 1 30); do vivo "$1" || return 0; sleep 0.1; done; return 1; }

# --- CASO 1 y 2: dos stacks, dos puertos, N veces -----------------------------
SOBREVIVIO=0; MURIO_EL_MIO=0
for i in $(seq 1 "$N"); do
  P_MIO="$(puerto_libre)"; P_AJENO="$(puerto_libre)"
  [ "$P_MIO" != "$P_AJENO" ] || { warn "tirada $i: mismo puerto dos veces, la repito"; continue; }
  PID_MIO="$(lanzar_listener "$ROOT_DIR" "$P_MIO")"
  PID_AJENO="$(lanzar_listener "$CLON_AJENO" "$P_AJENO")"
  if ! esperar_arranque "$PID_MIO" "$P_MIO" || ! esperar_arranque "$PID_AJENO" "$P_AJENO"; then
    nc "no pude levantar los dos señuelos en la tirada $i (puertos $P_MIO/$P_AJENO)."
  fi
  stop_scoped "canario" "$P_MIO" "$MARCA" >/dev/null 2>&1
  asentar "$PID_MIO" >/dev/null 2>&1
  vivo "$PID_AJENO" && SOBREVIVIO=$((SOBREVIVIO+1))
  vivo "$PID_MIO"   || MURIO_EL_MIO=$((MURIO_EL_MIO+1))
  kill -9 "$PID_AJENO" 2>/dev/null || true
  wait "$PID_MIO" "$PID_AJENO" 2>/dev/null || true
done
[ "$SOBREVIVIO" -eq "$N" ] \
  && ok "dos stacks en puertos distintos: apago el MÍO y el AJENO sigue vivo — $SOBREVIVIO/$N" \
  || bad "el stack AJENO murió en $((N-SOBREVIVIO)) de $N tiradas (esto es exactamente lo que QA sufrió)"
[ "$MURIO_EL_MIO" -eq "$N" ] \
  && ok "…y apagar APAGA: el stack propio muere — $MURIO_EL_MIO/$N (un «down» que no apaga deja el puerto y rompe SEC-OPS-1)" \
  || bad "el stack PROPIO sobrevivió en $((N-MURIO_EL_MIO)) de $N tiradas: «down» no apaga"

# --- CASO 3: patrón + otro clon + otro puerto ⇒ SOBREVIVE ---------------------
P_MIO="$(puerto_libre)"; P_AJENO="$(puerto_libre)"
PID_MIO="$(lanzar_listener "$ROOT_DIR" "$P_MIO")"
PID_AJENO="$(lanzar_listener "$CLON_AJENO" "$P_AJENO")"
esperar_arranque "$PID_MIO" "$P_MIO" && esperar_arranque "$PID_AJENO" "$P_AJENO" \
  || nc "no pude levantar los señuelos del caso 3."
SALIDA="$(stop_scoped "canario" "$P_MIO" "$MARCA" 2>&1)"
asentar "$PID_MIO" >/dev/null 2>&1
if vivo "$PID_AJENO"; then
  ok "el proceso que CASA EL PATRÓN pero vive en otro clon y otro puerto NO se toca (el pkill del pentester)"
  grep -q "NO es de este clon" <<<"$SALIDA" \
    && ok "…y lo NOMBRA en un aviso, en vez de callarlo (quien mire sabe que sigue vivo y de quién es)" \
    || bad "no avisó de que dejaba vivo un proceso ajeno: $(tr -d '\033' <<<"$SALIDA" | tail -1)"
else
  bad "mató un proceso de OTRO clon en OTRO puerto — el filtro no filtra"
  PASADAS=$PASADAS
fi
kill -9 "$PID_AJENO" 2>/dev/null || true
wait "$PID_MIO" "$PID_AJENO" 2>/dev/null || true

# --- CASO 4: patrón + MI clon, sin puerto ⇒ MUERE -----------------------------
P_MIO="$(puerto_libre)"
PID_MUDO="$(lanzar_mudo "$ROOT_DIR")"
sleep 0.3
vivo "$PID_MUDO" || nc "el señuelo mudo no arrancó."
stop_scoped "canario" "$P_MIO" "$MARCA" >/dev/null 2>&1
asentar "$PID_MUDO" >/dev/null 2>&1
vivo "$PID_MUDO" \
  && bad "el backend a medio arrancar de MI clon (sin puerto abierto) sobrevivió: el barrido por patrón dejó de funcionar" \
  || ok "el proceso de MI clon que casa el patrón SIN puerto abierto sí muere (arranque a medias)"
wait "$PID_MUDO" 2>/dev/null || true

# --- CASO 5bis: MI puerto ocupado por OTRO clon ⇒ muere, pero SE NOMBRA --------
# Medido el 2026-09-22: el s3-local de QA escuchaba en el :9000 por defecto desde
# su clon del scratchpad. Los dos clones usan el MISMO puerto por defecto, así que
# acotar por puerto no puede salvar ese caso: no hay dos puertos que separar. Lo
# que sí se exige es que el apagado lo DIGA — un gate ajeno que muere sin
# explicación es el peor de los dos fallos.
P_MIO="$(puerto_libre)"
PID_AJENO_MI_PUERTO="$(lanzar_listener "$CLON_AJENO" "$P_MIO")"
esperar_arranque "$PID_AJENO_MI_PUERTO" "$P_MIO" || nc "no pude levantar el señuelo del caso 5bis."
SALIDA="$(stop_scoped "canario" "$P_MIO" "$MARCA" 2>&1)"
asentar "$PID_AJENO_MI_PUERTO" >/dev/null 2>&1
vivo "$PID_AJENO_MI_PUERTO" \
  && bad "no reclamó su propio puerto: quedaría ocupado y el siguiente «up --gate» moriría" \
  || ok "reclamar MI puerto sí mata a quien lo ocupe, aunque sea de otro clon (si no, el puerto queda tomado)"
grep -q "es de OTRO clon" <<<"$SALIDA" \
  && ok "…y lo DICE con su cwd, para que la muerte de un gate ajeno sea explicable y no un misterio" \
  || bad "se llevó por delante un proceso de otro clon SIN decirlo: $(tr -d '\033' <<<"$SALIDA" | tail -1)"
wait "$PID_AJENO_MI_PUERTO" 2>/dev/null || true

# --- CASO 5: estático, no queda ni un `pkill` ejecutable ----------------------
# Un `pkill` EJECUTABLE empieza una sentencia: principio de línea (con sangría) o
# tras `;`/`&&`/`||`/`then`/`do`. Los `pkill` que quedan en el fichero están en
# comentarios y dentro del heredoc de instrucciones (prosa que cuenta la historia
# y le dice al humano qué NO basta a mano) — y esa distinción la tuvo que aprender
# este canario: su primera versión llamó rojo a una línea de ayuda (línea 764).
PKILL_VIVO="$(grep -nE '(^|[;&|]|\bthen\b|\bdo\b)[[:space:]]*pkill[[:space:]]' "$STACK" | grep -vE '^[0-9]+:[[:space:]]*#' || true)"
[ -z "$PKILL_VIVO" ] \
  && ok "no queda ni un \`pkill\` EJECUTABLE en stack-native.sh (los que hay están en comentarios, contando la historia)" \
  || bad "vuelve a haber pkill sin acotar: $PKILL_VIVO"

TOTAL=$((PASADAS+FALLOS)); echo
[ "$FALLOS" -eq 0 ] && { printf '\033[1;32m✓ Apagado acotado: %s/%s — un `down` mío no mata el stack de otra sesión.\033[0m\n' "$PASADAS" "$TOTAL"; exit 0; }
printf '\033[1;31m✗ Apagado acotado: %s/%s — el apagado puede volver a matar trabajo ajeno (I-QA2).\033[0m\n' "$PASADAS" "$TOTAL"; exit 1

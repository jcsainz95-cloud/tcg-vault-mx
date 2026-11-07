#!/usr/bin/env bash
#
# ci-install-chromium.sh — instala el Chromium de Playwright (con sus deps de
# sistema) en un runner de GitHub Actions SIN pelearse con el apt del runner · devops
# =============================================================================
# POR QUÉ EXISTE — CI-APT-LOCK (2026-11-06, runs 42270439578 y 42293757193)
# ---------------------------------------------------------------------------
# Al arrancar el runner, unattended-upgrades (u otro apt-get de la imagen) tiene
# tomado /var/lib/dpkg/lock-frontend. `playwright install --with-deps` llama a
# `apt-get` por dentro, que muere AL INSTANTE con «E: Could not get lock
# /var/lib/dpkg/lock-frontend. It is held by process … (apt-get)». Los 3
# reintentos de antes (sleep 10) caían en < 15 s y se agotaban con el apt ajeno
# todavía trabajando. Arreglo de raíz, en UN solo sitio (lo llaman e2e.yml ×2,
# e2e-real.yml, home-perf.yml y csp-stripe-probe.yml):
#   1. `DPkg::Lock::Timeout` en /etc/apt/apt.conf.d: el apt-get que lanza
#      Playwright ESPERA el candado en vez de morir (cubre la carrera entre
#      nuestra comprobación y su arranque).
#   2. Antes de cada intento se espera (con tope) a que nadie tenga los candados
#      de dpkg/apt; el apt ajeno NO se mata: se le deja terminar.
#   3. Backoff real entre intentos (30 s, 60 s), no 10 s fijos.
#   4. Cada intento en su propio grupo (`setsid` + `timeout -k`): al vencer,
#      SIGTERM y a los 10 s SIGKILL al grupo entero (npx → playwright → apt-get),
#      para que el intento N no deje un apt huérfano con el candado al N+1
#      (run 41868820215). Solo si tras esperar el candado SIGUE tomado después de
#      un intento fallido se recurre a matar apt-get/dpkg (lo de antes, último
#      recurso) y `dpkg --configure -a`.
#   5. Presupuesto total (CHROMIUM_INSTALL_BUDGET_S): ningún intento ni espera
#      empieza si no cabe; el paso falla con su nombre ANTES de que lo corte el
#      `timeout-minutes` del workflow (que debe ser ≥ presupuesto + 60 s).
#
# No cambia QUÉ se instala: `npx playwright install --with-deps chromium`, con
# la versión de Playwright fijada en frontend/package-lock.json.
#
# Uso (desde el directorio con node_modules de Playwright, p. ej. frontend/):
#   CHROMIUM_INSTALL_BUDGET_S=1440 bash "$GITHUB_WORKSPACE/scripts/ci-install-chromium.sh"
# Candado: scripts/check-chromium-install.sh (+ canario).
# =============================================================================
set -uo pipefail

APT_LOCK_TIMEOUT_S=300          # DPkg::Lock::Timeout del apt-get de Playwright
LOCK_WAIT_MAX_S=300             # tope de cada espera previa por el candado
INTENTO_S=420                   # tope de cada `playwright install`
INTENTOS=3
BUDGET_S="${CHROMIUM_INSTALL_BUDGET_S:-1440}"
case "$BUDGET_S" in ''|*[!0-9]*) echo "::error::CHROMIUM_INSTALL_BUDGET_S no es un entero: '$BUDGET_S'"; exit 2;; esac

INICIO=$SECONDS
restante() { echo $(( BUDGET_S - (SECONDS - INICIO) )); }

LOCKS=(/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock)
candado_tomado() {
  if command -v fuser >/dev/null 2>&1; then
    sudo fuser "${LOCKS[@]}" >/dev/null 2>&1
  else
    pgrep -x 'apt-get|apt|dpkg|unattended-upgr' >/dev/null 2>&1
  fi
}

# esperar_candado <tope_s>: 0 si queda libre, 1 si sigue tomado al tope.
esperar_candado() {
  local tope="$1" t0=$SECONDS avisado=0
  while candado_tomado; do
    if [ $(( SECONDS - t0 )) -ge "$tope" ]; then
      echo "::warning title=Candado de apt tomado::Sigue tomado tras ${tope} s de espera."
      return 1
    fi
    if [ "$avisado" = 0 ]; then
      echo "::notice title=Candado de apt tomado::Otro apt/dpkg del runner tiene el candado; espero a que termine (tope ${tope} s)."
      sudo fuser -v "${LOCKS[@]}" 2>&1 | sed 's/^/    /' || true
      avisado=1
    fi
    sleep 5
  done
  [ "$avisado" = 1 ] && echo "Candado de apt libre tras $(( SECONDS - t0 )) s."
  return 0
}

min() { [ "$1" -lt "$2" ] && echo "$1" || echo "$2"; }

# 1. Que el apt-get interno de Playwright espere el candado en vez de morir.
echo "DPkg::Lock::Timeout \"$APT_LOCK_TIMEOUT_S\";" | sudo tee /etc/apt/apt.conf.d/99-ci-dpkg-lock-timeout >/dev/null \
  || echo "::warning::No se pudo escribir DPkg::Lock::Timeout; sigo con la espera previa."

for intento in $(seq 1 "$INTENTOS"); do
  # 2. Espera previa (con el presupuesto que quede, dejando sitio a un intento).
  r=$(restante)
  esperar_candado "$(min "$LOCK_WAIT_MAX_S" $(( r > 120 ? r - 120 : 0 )))" || true

  r=$(restante)
  if [ "$r" -lt 60 ]; then
    echo "::error title=No se pudo instalar Chromium::Presupuesto de ${BUDGET_S} s agotado antes del intento $intento."
    exit 1
  fi
  t=$(min "$INTENTO_S" "$r")
  echo "Intento $intento/$INTENTOS de instalar Chromium (tope ${t} s; quedan ${r} s de presupuesto)."
  if setsid -w timeout -k 10 "$t" npx playwright install --with-deps chromium; then
    exit 0
  fi
  if [ "$intento" = "$INTENTOS" ]; then
    echo "::error title=No se pudo instalar Chromium::$INTENTOS intentos agotados."
    exit 1
  fi
  echo "::warning title=Instalacion de Chromium fallida::Intento $intento fallido o agotado; espero el candado y reintento con backoff."

  # 4. Si tras esperar el candado sigue tomado, último recurso (lo de antes).
  r=$(restante)
  if ! esperar_candado "$(min 120 $(( r > 120 ? r - 120 : 0 )))"; then
    sudo pkill -x apt-get 2>/dev/null || true
    sudo pkill -x dpkg 2>/dev/null || true
    sleep 5
  fi
  sudo dpkg --configure -a >/dev/null 2>&1 || true

  # 3. Backoff real: 30 s, 60 s…
  espera=$(( 30 * intento ))
  r=$(restante)
  [ "$r" -gt $(( espera + 60 )) ] || espera=0
  echo "Backoff de ${espera} s antes del intento $(( intento + 1 ))."
  sleep "$espera"
done

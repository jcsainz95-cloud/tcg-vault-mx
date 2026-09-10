#!/usr/bin/env bash
# =============================================================================
# check-daemon-stdout-leak.sh — el candado contra el CUELGUE SILENCIOSO del arnés.
#
# QUÉ IMPIDE, EN UNA FRASE
#   Que un script de `scripts/` lance un daemon de forma que el daemon (o un
#   subshell intermediario) se quede con el **stdout del script**. Cuando eso
#   pasa y alguien invoca `script | tail`, `tail` NUNCA ve EOF: el comando
#   parece colgado y no imprime NADA hasta que el daemon muera — es decir,
#   nunca.
#
# POR QUÉ ES UN CANDADO Y NO UN LINT DE ESTILO (2026-09-10, DEVOPS_NOTES §46.2)
#   QA perdió ~36 minutos con `./scripts/stack-native.sh up --seed | tail`
#   bloqueado, sin un solo byte de salida, antes de que Playwright arrancara.
#   En CI esto NO da rojo: da un job que **parece «corriendo»** y no está
#   midiendo nada. Es peor que un falso rojo — un falso «en curso» no se ve
#   nunca: no hay artefacto, no hay línea de log, no hay a quién culpar. Sólo
#   un job que se come el presupuesto de minutos y luego lo mata el runner.
#
# ⚠️⚠️ Y EL `timeout` NO SALVA. Está MEDIDO en el MODO 1 de este mismo script:
#   `timeout 10 script-que-fuga | cat`  →  **rc=0 a los 45 s** (la vida del
#   daemon), no rc=124 a los 10 s. `timeout` mata al SCRIPT; el lector del pipe
#   sigue esperando EOF de un descriptor que ya no tiene dueño visible, y al
#   final el pipeline reporta **ÉXITO**. Un `timeout N cmd | tail` en un
#   workflow no acota nada y encima miente sobre el resultado.
#   El idioma correcto cuando hay que acotar un PIPELINE entero es:
#       timeout N bash -c 'cmd | tail'
#   (el timeout envuelve al pipeline, no al primer eslabón).
#
# LOS DOS MODOS
#   MODO 1 — AUTOPRUEBA (siempre): monta tres daemons de maqueta con los tres
#     patrones y MIDE cuál fuga. Si la autoprueba no reprodujera la fuga, este
#     script se declara NO CONCLUYENTE y sale ≠0: un candado que ya no puede
#     detectar lo que vigila es un candado roto, no un candado verde (§44).
#   MODO 2 — BARRIDO ESTÁTICO: aplica sobre `scripts/*.sh` la regla que el
#     MODO 1 acaba de justificar.
#
# LA REGLA (la que el MODO 1 justifica, para que no dependa del criterio de
# quien esté de guardia):
#   Un lanzamiento en segundo plano de un daemon debe cumplir LAS DOS cosas:
#     (a) NO ir envuelto en un `( … )` de agrupación. El subshell envolvente es
#         EL CULPABLE: sobrevive como padre del daemon y hereda el stdout. Da
#         igual `nohup` o `setsid` — medido, ambos fugan dentro de `( … )`.
#         Para cambiar de directorio sin subshell: `env -C "$DIR" …`.
#     (b) Llevar LAS TRES redirecciones: `> log 2>&1 < /dev/null`.
#   Efecto colateral, igual de importante: con (a), `$!` guarda **el daemon** y
#   no el `bash` intermediario, así que el pidfile sirve para apagarlo.
#
# USO
#   ./scripts/check-daemon-stdout-leak.sh              # autoprueba + barrido
#   ./scripts/check-daemon-stdout-leak.sh --self-test  # sólo autoprueba
#   ./scripts/check-daemon-stdout-leak.sh --static     # sólo barrido
#
# LÍMITE DECLARADO (devops, sin adornos): el barrido es SINTÁCTICO. Cubre los
# patrones de lanzamiento que este repo usa hoy; no es un analizador de bash y
# no puede probar la ausencia de fugas por vías que aún no existen. La prueba
# de que la fuga concreta ya no está en el arnés real es la corrida de
# `stack-native.sh up` bajo tubería que se documenta en §46.2.
# =============================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLD=$'\033[1m'; RST=$'\033[0m'
[ -t 1 ] || { RED=""; GRN=""; YEL=""; BLD=""; RST=""; }

log()  { printf '%s==>%s %s\n' "$BLD" "$RST" "$*"; }
ok()   { printf '  %s✔%s %s\n' "$GRN" "$RST" "$*"; }
bad()  { printf '  %s✘%s %s\n' "$RED" "$RST" "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$*"; }

MODE="all"
case "${1:-}" in
  --self-test) MODE="self" ;;
  --static)    MODE="static" ;;
  ""|--all)    MODE="all" ;;
  *) echo "Uso: $0 [--self-test|--static|--all]" >&2; exit 2 ;;
esac

FAILED=0

# -----------------------------------------------------------------------------
# MODO 1 — AUTOPRUEBA. Se mide, no se afirma.
#
# `LIFE` es la vida del daemon de maqueta. `BOUND` es cuánto se le concede al
# pipeline para cerrar. LIFE debe ser MUY superior a BOUND: así, «el pipeline
# tardó más que BOUND» sólo puede significar «se quedó esperando al daemon».
# -----------------------------------------------------------------------------
LIFE=20
BOUND=5

# Corre un script de maqueta CON SU STDOUT EN UNA TUBERÍA y devuelve los
# segundos que tardó el PIPELINE ENTERO en cerrar. Ése es el número que importa:
# no cuánto tarda el script, sino cuánto tarda `tail` en ver EOF.
elapsed_piped() {
  local script="$1" t0 t1
  t0=$(date +%s)
  # `| cat` reproduce exactamente lo que hace `| tail` respecto al EOF, sin
  # tragarse la salida. El `|| true` es a propósito: aquí NO se juzga el rc,
  # se juzga el RELOJ (y el rc es justamente lo que miente — ver cabecera).
  bash "$script" 2>&1 | cat >/dev/null || true
  t1=$(date +%s)
  echo $(( t1 - t0 ))
}

self_test() {
  log "MODO 1 — autoprueba: ¿este candado todavía sabe detectar la fuga?"
  local tmp; tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  # (A) EL PATRÓN MALO — el que tenían `start_backend` y `start_frontend`.
  cat > "$tmp/a.sh" <<EOF
#!/usr/bin/env bash
( cd /tmp && nohup sleep $LIFE > "$tmp/a.log" 2>&1 & echo \$! > "$tmp/a.pid" )
EOF
  # (B) `setsid` PERO TODAVÍA DENTRO DE `( … )` — la trampa: parece arreglado.
  cat > "$tmp/b.sh" <<EOF
#!/usr/bin/env bash
( cd /tmp && setsid sleep $LIFE > "$tmp/b.log" 2>&1 < /dev/null & echo \$! > "$tmp/b.pid" )
EOF
  # (C) EL PATRÓN BUENO — sin subshell, con las tres redirecciones.
  cat > "$tmp/c.sh" <<EOF
#!/usr/bin/env bash
setsid env -C /tmp sleep $LIFE > "$tmp/c.log" 2>&1 < /dev/null &
echo \$! > "$tmp/c.pid"
EOF

  local ea eb ec pa pb pc
  ea="$(elapsed_piped "$tmp/a.sh")"; pa="$(ps -o comm= -p "$(cat "$tmp/a.pid")" 2>/dev/null || echo '<muerto>')"
  eb="$(elapsed_piped "$tmp/b.sh")"; pb="$(ps -o comm= -p "$(cat "$tmp/b.pid")" 2>/dev/null || echo '<muerto>')"
  ec="$(elapsed_piped "$tmp/c.sh")"; pc="$(ps -o comm= -p "$(cat "$tmp/c.pid")" 2>/dev/null || echo '<muerto>')"

  printf '     %-46s %8s %14s\n' "patrón" "pipe(s)" "pidfile apunta a"
  printf '     %-46s %8s %14s\n' "(A) ( cd && nohup CMD > log 2>&1 & echo \$! )" "$ea" "$pa"
  printf '     %-46s %8s %14s\n' "(B) ( cd && setsid CMD 3-redir & echo \$! )"  "$eb" "$pb"
  printf '     %-46s %8s %14s\n' "(C) setsid env -C DIR CMD 3-redir &"          "$ec" "$pc"

  pkill -f "sleep $LIFE" 2>/dev/null || true

  local conclusive=1
  if [ "$ea" -lt "$BOUND" ]; then
    bad "(A) NO fugó ($ea s < $BOUND s). El candado ya no reproduce lo que vigila."
    conclusive=0
  else
    ok "(A) fuga reproducida: el pipeline tardó ${ea}s (vida del daemon = ${LIFE}s)."
  fi
  if [ "$eb" -lt "$BOUND" ]; then
    bad "(B) NO fugó ($eb s). Entonces la regla (a) —«nada de subshell envolvente»— ya no está justificada."
    conclusive=0
  else
    ok "(B) fuga reproducida con \`setsid\` DENTRO de \`( … )\`: ${eb}s ⇒ el culpable es el SUBSHELL, no \`nohup\`."
  fi
  if [ "$ec" -ge "$BOUND" ]; then
    bad "(C) el patrón que este candado exige TAMBIÉN fugó (${ec}s). La regla no sirve: PARAR y rediseñarla."
    conclusive=0
  else
    ok "(C) el patrón exigido cierra la tubería en ${ec}s (< ${BOUND}s) y el pidfile apunta al daemon ('$pc')."
  fi

  if [ "$conclusive" = 0 ]; then
    bad "AUTOPRUEBA NO CONCLUYENTE ⇒ este candado NO puede declarar verde a nadie."
    echo "     Un candado que dejó de detectar su propio defecto es un candado ROTO."
    echo "     Revísalo ANTES de tocar el barrido estático (DEVOPS_NOTES §46.2)."
    FAILED=1
    return 1
  fi
  ok "autoprueba CONCLUYENTE: el candado mide lo que dice medir."
}

# -----------------------------------------------------------------------------
# MODO 2 — BARRIDO ESTÁTICO sobre scripts/*.sh
#
# Se unen las continuaciones de línea (`\` al final) para que un lanzamiento
# repartido en 5 líneas se juzgue como UNA sentencia — que es como bash lo ve.
# -----------------------------------------------------------------------------
static_scan() {
  log "MODO 2 — barrido estático de scripts/*.sh"
  local files f n=0 launches=0
  # EXCLUSIÓN DECLARADA, UNA Y CON MOTIVO: este mismo fichero. Su MODO 1 escribe
  # los patrones MALOS a propósito (son la maqueta con la que se autoprueba), así
  # que barrerlo daría rojo por su propia evidencia. No se excluye «porque da
  # ruido»: se excluye porque su corrección la demuestra el MODO 1, que es una
  # medición y no una lectura. Cualquier OTRO fichero de scripts/ sí se barre.
  mapfile -t files < <(find "$ROOT_DIR/scripts" -maxdepth 1 -name '*.sh' -type f \
                         ! -name 'check-daemon-stdout-leak.sh' | sort)
  for f in "${files[@]}"; do
    # Une continuaciones y conserva el número de la PRIMERA línea de cada
    # sentencia, para poder señalar el sitio exacto.
    while IFS=$'\t' read -r lineno stmt; do
      [ -n "$stmt" ] || continue

      # (0) LOS COMENTARIOS NO SE JUZGAN. Este repo documenta el patrón MALO
      #     dentro de comentarios (justo para que nadie lo repita); confundir la
      #     advertencia con el defecto es la misma familia de falso rojo que se
      #     cazó en §45. Se descarta la sentencia si empieza por `#`.
      [[ "$stmt" =~ ^[[:space:]]*# ]] && continue

      # (1) ¿HAY UN `&` DE FONDO DE VERDAD? No basta con que la línea contenga
      #     el carácter: `2>&1` y `&&` lo contienen y NO ponen nada en segundo
      #     plano. El operador real sólo cuenta si CIERRA la sentencia o si va
      #     seguido del `echo $!` que captura el pid.
      [[ "$stmt" =~ \&[[:space:]]*$ || "$stmt" =~ \&[[:space:]]*echo[[:space:]]+\$! ]] || continue

      # (2) ¿Es un DAEMON y no un `curl`/`sleep` efímero? Se juzga sólo lo que
      #     se lanza con `nohup`/`setsid` o cuyo pid se guarda para apagarlo.
      case "$stmt" in
        *nohup*|*setsid*|*'echo $!'*) ;;
        *) continue ;;
      esac
      launches=$((launches+1))

      local rel="${f#"$ROOT_DIR"/}"

      # (a) subshell envolvente
      if [[ "$stmt" =~ ^[[:space:]]*\( ]]; then
        bad "$rel:$lineno — lanzamiento de daemon DENTRO de un \`( … )\` envolvente."
        echo "        $(echo "$stmt" | cut -c1-120)"
        echo "        ⇒ el subshell hereda el stdout del script: \`$rel | tail\` no verá EOF nunca,"
        echo "          y \`\$!\` guardará el \`bash\` intermediario en vez del daemon."
        echo "        ARREGLO: sácalo del \`( … )\` y cambia de directorio con \`env -C \"\$DIR\" …\`:"
        echo "            setsid env -C \"\$DIR\" CMD > \"\$LOG\" 2>&1 < /dev/null &"
        echo "            echo \$! > \"\$PIDFILE\""
        FAILED=1; n=$((n+1)); continue
      fi

      # (b) las tres redirecciones
      local miss=""
      [[ "$stmt" == *'>'* ]]        || miss="$miss stdout"
      [[ "$stmt" == *'2>&1'* ]]     || miss="$miss stderr(2>&1)"
      [[ "$stmt" == *'< /dev/null'* || "$stmt" == *'</dev/null'* ]] || miss="$miss stdin(</dev/null)"
      if [ -n "$miss" ]; then
        bad "$rel:$lineno — daemon en segundo plano SIN las tres redirecciones (falta:$miss)."
        echo "        $(echo "$stmt" | cut -c1-120)"
        echo "        ⇒ cualquier descriptor heredado mantiene viva la tubería del invocador."
        FAILED=1; n=$((n+1)); continue
      fi

      ok "$rel:$lineno — lanzamiento limpio (sin subshell, tres redirecciones)."
    done < <(awk '
      { if (buf == "") first = NR; }
      /\\[[:space:]]*$/ { sub(/\\[[:space:]]*$/, " "); buf = buf $0; next }
      { buf = buf $0; gsub(/\t/, " ", buf); print first "\t" buf; buf = "" }
    ' "$f")
  done
  if [ "$launches" = 0 ]; then
    # Un barrido que no encontró NADA que juzgar no es un verde: es un candado
    # que perdió su blanco (mismo criterio que §44 con el DAST). Se dice y falla.
    bad "el barrido no localizó NI UN SOLO lanzamiento de daemon en scripts/*.sh."
    echo "        O el arnés dejó de lanzar daemons, o el detector se quedó ciego."
    echo "        En ambos casos este verde NO es citable. Revisa el predicado (paso 1/2)."
    FAILED=1
  elif [ "$n" = 0 ]; then
    ok "$launches lanzamiento(s) de daemon inspeccionado(s) en ${#files[@]} script(s): 0 con fuga."
  else
    bad "$n de $launches lanzamiento(s) con fuga."
  fi
}

case "$MODE" in
  self)   self_test ;;
  static) static_scan ;;
  all)    self_test && static_scan ;;
esac

echo
if [ "$FAILED" = 0 ]; then
  printf '%s✔ SIN FUGA DE STDOUT%s — `scripts/*.sh | tail` cierra la tubería al terminar.\n' "$GRN" "$RST"
  exit 0
fi
printf '%s✘ FUGA DE STDOUT%s — un `| tail` sobre esos scripts se cuelga en SILENCIO.\n' "$RED" "$RST"
echo "  Recuerda: \`timeout N cmd | tail\` NO lo acota (medido: rc=0 tras la vida entera"
echo "  del daemon). Si necesitas acotar un pipeline: \`timeout N bash -c 'cmd | tail'\`."
exit 1

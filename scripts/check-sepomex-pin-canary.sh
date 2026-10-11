#!/usr/bin/env bash
#
# check-sepomex-pin-canary.sh — ¿el candado `sepomex-pin` se pone ROJO cuando alguien altera el catálogo de CP? · devops
# =============================================================================
# Copia lo que el candado lee a un repositorio git temporal, exige VERDE en el prístino (si no, todo rojo de abajo es
# ruido) y planta, una por una, las formas de alterar el catálogo o su huella. Cada mutación tiene que dar ROJO **y**
# nombrar el bloque correcto. Determinista (sin carreras ni reloj): una corrida por caso basta (O-3 no aplica).
# Copia ~15 MB por caso y la borra al acabar el caso. DEVOPS_NOTES §92.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE_REL="scripts/check-sepomex-pin.sh"
DATA_REL="scripts/geo/data"
[ -f "$ROOT_DIR/$GATE_REL" ] || { printf '✗ No existe %s: el candado desapareció, eso ya es el rojo.\n' "$GATE_REL"; exit 1; }

FALLOS=0
PASADAS=0
ok()   { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }
note() { printf '      %s\n' "$*"; }

BASE="$(mktemp -d -t sepomex-pin-canario-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT

preparar() { # preparar <dir>: el árbol mínimo que lee el candado, como repositorio git con el archivo en el índice
  local d="$1"
  mkdir -p "$d/scripts" "$d/$DATA_REL"
  cp "$ROOT_DIR/$GATE_REL" "$d/$GATE_REL"
  cp "$ROOT_DIR/.gitattributes" "$d/.gitattributes"
  cp "$ROOT_DIR/.gitignore" "$d/.gitignore"
  cp "$ROOT_DIR/$DATA_REL/CPdescarga.txt" "$ROOT_DIR/$DATA_REL/CPdescarga.txt.sha256" "$ROOT_DIR/$DATA_REL/CPdescarga.manifest.json" "$d/$DATA_REL/"
  git -C "$d" init -q
  git -C "$d" add -- .gitattributes "$DATA_REL/CPdescarga.txt"
}

correr() { bash "$1/$GATE_REL" --root "$1" 2>&1; }

caso() { # caso ROJO|VERDE <nombre> <texto que el rojo debe nombrar|-> <mutador>
  local esperado="$1" nombre="$2" debe="$3" mutador="$4"
  local dir="$BASE/caso"
  rm -rf "$dir"; preparar "$dir"
  "$mutador" "$dir"
  local salida rc
  salida="$(correr "$dir")"; rc=$?
  if [ "$esperado" = VERDE ]; then
    [ "$rc" -eq 0 ] && ok "VERDE  $nombre" || { bad "debía ser VERDE y dio rc=$rc: $nombre"; printf '%s\n' "$salida" | grep '✗' | sed 's/^/      /'; }
  else
    if [ "$rc" -ne 0 ] && printf '%s\n' "$salida" | grep -q -- "✗ $debe"; then
      ok "ROJO   $nombre  (nombra «$debe»)"
    else
      bad "debía ser ROJO nombrando «$debe» y dio rc=$rc: $nombre"; printf '%s\n' "$salida" | grep '✗' | sed 's/^/      /'
    fi
  fi
  rm -rf "$dir"
}

F="$DATA_REL/CPdescarga.txt"
nada()            { :; }
byte_cambiado()   { printf 'X' | dd of="$1/$F" bs=1 seek=5000000 conv=notrunc status=none; }
crlf_a_lf()       { sed -i 's/\r$//' "$1/$F"; }
fila_de_mas()     { printf '99999|Colonia Inventada|Colonia|Nada|Nada|Nada|99999||99999|99|99|99||09|||9999|Urbano|99|\r\n' >> "$1/$F"; }
sin_archivo()     { rm -f "$1/$F"; git -C "$1" rm -q --cached -- "$F"; }
# La alteración «coherente»: archivo cambiado, .sha256 y manifiesto re-fijados, pero NO las constantes del script.
refijado_sin_codigo() {
  fila_de_mas "$1"
  local s; s="$(sha256sum "$1/$F" | awk '{print $1}')"
  printf '%s  CPdescarga.txt\n' "$s" > "$1/$F.sha256"
  sed -i "s/^  \"fileSha256\": \"[0-9a-f]*\"/  \"fileSha256\": \"$s\"/" "$1/$DATA_REL/CPdescarga.manifest.json"
  git -C "$1" add -- "$F"
}
sha256_alterado() { sed -i 's/^071f/171f/' "$1/$F.sha256"; }
sha256_dos_lin()  { echo "deadbeef  otro.txt" >> "$1/$F.sha256"; }
mani_filesha()    { sed -i 's/"fileSha256": "071f/"fileSha256": "171f/' "$1/$DATA_REL/CPdescarga.manifest.json"; }
mani_setdigest()  { sed -i 's/"setDigest": "20cd/"setDigest": "30cd/' "$1/$DATA_REL/CPdescarga.manifest.json"; }
sin_manifiesto()  { rm -f "$1/$DATA_REL/CPdescarga.manifest.json"; }
sin_regla()       { sed -i '/^scripts\/geo\/data\/CPdescarga.txt/d' "$1/.gitattributes"; }
regla_text()      { sed -i 's|^scripts/geo/data/CPdescarga.txt binary$|scripts/geo/data/CPdescarga.txt text eol=lf|' "$1/.gitattributes"; }
regla_solo_diff() { sed -i 's|^scripts/geo/data/CPdescarga.txt binary$|scripts/geo/data/CPdescarga.txt -diff|' "$1/.gitattributes"; }
indice_distinto() { fila_de_mas "$1"; git -C "$1" add -- "$F"; crlf_a_lf "$1"; } # el índice tiene otra cosa que el árbol
sin_excepcion()   { sed -i '/^!scripts\/geo\/data\/$/d' "$1/.gitignore"; }
comentario()      { printf '# un comentario más no cambia nada\n' >> "$1/.gitattributes"; }

printf '\n\033[1m== Canario de sepomex-pin ==\033[0m\n\n'
caso VERDE "prístino"                                                  -     nada
caso ROJO  "un byte del archivo cambiado"                             "\[A\]" byte_cambiado
caso ROJO  "CRLF→LF (lo que haría git sin la regla binary)"           "\[A\]" crlf_a_lf
caso ROJO  "una fila añadida"                                         "\[A\]" fila_de_mas
caso ROJO  "archivo borrado"                                          "\[A\]" sin_archivo
caso ROJO  "archivo + .sha256 + manifiesto re-fijados, código no"     "\[A\]" refijado_sin_codigo
caso ROJO  ".sha256 alterado"                                         "\[B\]" sha256_alterado
caso ROJO  ".sha256 con una segunda línea"                            "\[B\]" sha256_dos_lin
caso ROJO  "manifiesto: fileSha256 alterado"                          "\[C\]" mani_filesha
caso ROJO  "manifiesto: setDigest alterado"                           "\[C\]" mani_setdigest
caso ROJO  "manifiesto borrado"                                       "\[C\]" sin_manifiesto
caso ROJO  ".gitattributes sin la regla"                              "\[D\]" sin_regla
caso ROJO  ".gitattributes: text eol=lf"                              "\[D\]" regla_text
caso ROJO  ".gitattributes: solo -diff (text sin fijar)"              "\[D\]" regla_solo_diff
caso ROJO  "índice con otros bytes que el árbol"                      "\[E\]" indice_distinto
caso ROJO  ".gitignore sin la excepción !scripts/geo/data/"        "\[F\]" sin_excepcion
caso VERDE "un comentario más en .gitattributes"                       -     comentario

echo
TOTAL=$((PASADAS+FALLOS))
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32mCanario OK — %d/%d casos como se esperaba.\033[0m\n' "$PASADAS" "$TOTAL"; exit 0
fi
printf '\033[1;31mCanario ROJO — %d/%d casos fallaron: el candado no muerde donde debe.\033[0m\n' "$FALLOS" "$TOTAL"
exit 1
